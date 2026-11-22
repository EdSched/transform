// 「这一回改成线上」：管理端课程安排（确认窗口）和排课系统（总务）共用的写入逻辑。
// 依赖：shared/course-sessions.js（csGet / csPatch / csInsert / csDelete，管理端用 sb，排课用 sbGet 等，自动认）。
//
// 规则：
//   · 只改「这一回」：写 course_sessions 的 delivery / campus / delivery_set / meeting_url；课程本身和别的回不动
//   · delivery_set=true 是「单独设过」标记：课程以后改上课方式时（courseSyncSessionFields / csRegen）不会把这一回改回去
//   · 两种方式：'link' 自备腾讯会议链接（不占教室、不占会议账号）；'acct' 占一个会议账号（只在这一天这个时段占，不占实体教室）
//   · 原来这一回占的实体教室释放：删这一天的临时占用（recurrence='once'），每周占用在这一天写进 manual_off_dates（和 crvSwapRoom 一样）
//   · 写到一半失败：已写的部分全部撤回，这一回保持原样

const SOL_ONLINE = '线上';
const solSplit = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const solWd = d => { const w = new Date(d + 'T12:00:00').getDay(); return w === 0 ? 7 : w; };
const solEnc = encodeURIComponent;

// 这一回是不是单独改成线上了（列还不存在时读到 undefined，当没设过）
function solIsOnline(s) { return !!(s && s.delivery_set && s.delivery === SOL_ONLINE); }
function solLinkOk(u) { return /^https?:\/\/\S+/i.test(String(u || '').trim()); }
// 链接可以先不填：自备链接没填 / 选了备用（临时）账号时 meeting_url 存空字符串 ''（固定账号存 null）= 「线上 · 待补链接」。不需要新列。
function solNeedLink(s) { return solIsOnline(s) && s.meeting_url === ''; }
// 链接格式：留空 = 可以；填了必须 http 开头
function solLinkValid(u) { const v = String(u || '').trim(); return !v || solLinkOk(v); }

async function solGet(table, q) {
  if (typeof sbAll === 'function') return (await sb(`/rest/v1/${table}?${q}`, 'GET', null, { cache: 'no-store' })) || [];
  return (await sbGet(table, q)) || [];
}
// 列还没建好的报错 → 一句人话
function solColErr(er) {
  const m = String((er && er.message) || er || '');
  if (/delivery_set|meeting_url|host_key/.test(m) && /column|schema|PGRST/i.test(m)) return new Error('数据库还没有「单回线上」需要的列，请先让管理员执行 seed/session_online.sql');
  return er;
}

// o: { course:{id,name,delivery,campus,merge_name,legacy_sched_id}, session:{id,session_date,session_number,time_range,delivery,campus,delivery_set,meeting_url},
//      ackAdmin:true（管理端自己改的，记录不再给管理员弹「排课改过」提示）, sp:{start,end}, mode:'link'|'acct', url, acctRoom:{id,name,campus,meeting_account_id}（acct 时必填）,
//      who:'操作人', role:'admin'|总务角色, bkExtra:{...}（排课端写 sched_bookings 时要带的字段，可不传） }
// 返回 { text }。失败抛 Error（已写的部分已撤回）
async function solSetOnline(o) {
  const undo = [], cid = String(o.course.id), s = o.session, d = s.session_date, ex = o.bkExtra || {};
  const url = String(o.url || '').trim();
  if (o.mode === 'link' && !solLinkValid(url)) throw new Error('会议链接要以 http 开头（也可以先不填，之后补）');
  if (o.mode === 'acct' && !(o.acctRoom && o.acctRoom.meeting_account_id)) throw new Error('请选一个会议账号');
  if (!o.sp || !o.sp.start) throw new Error('这一回没有上课时间，不能占会议账号');
  try {
    const bks = (await solGet('sched_bookings', `select=*&kind=eq.course&course_id=eq.${solEnc(cid)}&status=neq.rejected`));
    // 1) 释放实体教室
    const temps = bks.filter(b => b.recurrence === 'once' && b.booking_date === d);
    for (const t of temps) { await csDelete('sched_bookings', [t.id]); undo.push({ ins: t }); }
    const wk = bks.filter(b => b.recurrence === 'weekly' && !solSplit(b.manual_off_dates).includes(d));
    const chosen = temps.length ? null : (wk.find(b => Number(b.weekday) === solWd(d)) || wk[0] || null);
    if (chosen) {
      const a = solSplit(chosen.manual_off_dates); a.push(d);
      await csPatch('sched_bookings', chosen.id, Object.assign({ manual_off_dates: a.sort().join(',') }, ex));
      undo.push({ upd: chosen.id, patch: { manual_off_dates: chosen.manual_off_dates || null } });
    }
    // 2) 占会议账号：这一天一条临时占用
    let acctName = '';
    if (o.mode === 'acct') {
      const r = o.acctRoom, tpl = chosen || temps[0] || wk[0] || bks[0] || {};
      acctName = r.name || '';
      const ins = await csInsert('sched_bookings', [Object.assign({
        room_id: r.noRoom ? null : r.id, kind: 'course', course_id: cid,   // 备用（临时）账号不绑教室：room_id 为空，只用会议账号 title: tpl.title || o.course.name || '', user_name: tpl.user_name || null,
        recurrence: 'once', booking_date: d, start_time: o.sp.start, end_time: o.sp.end,
        uses_meeting: true, meeting_account_id: r.meeting_account_id,
        status: 'confirmed', created_by: tpl.created_by || 'admin', entry_name: '单回改成线上', note: '单回改成线上', auto_sync: false
      }, ex)]);
      if (ins && ins[0]) undo.push({ del: ins[0].id });
    }
    // 3) 这一回改成线上
    const back = { delivery: s.delivery == null ? null : s.delivery, campus: s.campus == null ? null : s.campus, delivery_set: !!s.delivery_set, meeting_url: s.meeting_url == null ? null : s.meeting_url, host_key: s.host_key == null ? null : s.host_key };
    try { await csPatch('course_sessions', s.id, Object.assign({ delivery: SOL_ONLINE, campus: SOL_ONLINE, delivery_set: true, meeting_url: o.mode === 'link' ? url : (o.acctRoom && o.acctRoom.noRoom ? '' : null) }, String(o.hostKey || '').trim() ? { host_key: String(o.hostKey).trim() } : {})); }   // 链接还没填：存 ''（待补链接）；备用账号也要建会议、要补链接；固定账号不需要
    catch (er) { throw solColErr(er); }
    undo.push({ ses: s.id, patch: back });
    const text = `改成线上（${o.mode === 'acct' ? '会议账号 ' + acctName : (url ? '自备链接' : '自备链接，待补')}）`;
    // 4) 记录 + 把总务那条没处理的「需要协调教室」标成已处理（失败只提醒，不回滚）
    const warn = [];
    try { await solLog(o, text, temps, wk, chosen); } catch (er) { warn.push('写修改记录失败：' + (er.message || er)); }
    try { await solAckCoord(o, text); } catch (er) { warn.push('总务那条提示没能标成已处理：' + (er.message || er)); }
    if (typeof CRV_MEMO !== 'undefined') delete CRV_MEMO.base;
    return { text, warn };
  } catch (er) {
    for (const u of undo.slice().reverse()) {
      try {
        if (u.ins) await csInsert('sched_bookings', [u.ins]);
        else if (u.del) await csDelete('sched_bookings', [u.del]);
        else if (u.ses) await csPatch('course_sessions', u.ses, u.patch);
        else await csPatch('sched_bookings', u.upd, u.patch);
      } catch (e2) { console.warn('撤回失败', e2); }
    }
    if (typeof CRV_MEMO !== 'undefined') delete CRV_MEMO.base;
    const m = String((er && er.message) || er || '');
    if (/教室已被占用|重复预约|exclusion_violation|unique_violation/.test(m)) throw new Error(`这个会议账号这段时间刚被别人占了，没有改成功，这一回保持原样。请换一个账号再试（${m.match(/「([^」]*)」/) ? '占用：《' + m.match(/「([^」]*)」/)[1] + '》' : '请刷新后再选'}）`);
    throw er;
  }
}

async function solLog(o, text, temps, wk, chosen) {
  const s = o.session, c = o.course;
  const from = temps.length ? '原教室' : (chosen ? '每周教室' : '未排教室');
  await csInsert('sched_change_log', [{
    course_id: c.legacy_sched_id != null ? c.legacy_sched_id : null, course_name: c.merge_name || c.name || '',
    actor_role: o.role || 'admin', actor_label: o.who || '管理员', action: 'edit',
    changes: [{ field: 'session_online', course_uuid: String(c.id), session_id: s.id, num: s.session_number || null, date: s.session_date,
      label: `第 ${s.session_number || '?'} 回 ${solMD(s.session_date)}`, from, to: text, url: o.mode === 'link' ? String(o.url || '').trim() : '' }],
    acked_by: o.ackAdmin ? 'admin' : ''
  }]);
}
const solMD = d => { const p = String(d || '').split('-'); return p.length === 3 ? `${+p[1]}/${+p[2]}` : String(d || ''); };

// 这一回在总务那里没处理的 room_coord → 标成已处理（备注写明）
async function solAckCoord(o, text) {
  const sid = String(o.session.id), cu = String(o.course.id);
  const rows = (await solGet('sched_change_log', 'select=id,changes,acked_by&action=eq.room_coord&or=(acked_by.is.null,acked_by.eq.)&order=created_at.desc&limit=200')) || [];
  const now = new Date().toISOString();
  for (const l of rows) {
    const ch = Array.isArray(l.changes) ? l.changes : [];
    if (!ch.some(x => x && x.field === 'room_coord' && String(x.session_id) === sid && (!x.course_uuid || String(x.course_uuid) === cu))) continue;
    const chg = ch.map(x => x && x.field === 'room_coord' && String(x.session_id) === sid ? Object.assign({}, x, { done_room: text, done_by: o.who || '管理员', done_at: now, note: ((x.note ? x.note + '；' : '') + ((o.role && o.role !== 'admin') ? '总务改成线上' : '负责人改成线上')) }) : x);
    await csPatch('sched_change_log', l.id, { acked_by: (o.role && o.role !== 'admin') ? o.role : '系统', changes: chg });
  }
}

// 撤回线上：这一回改回课程原来的上课方式，清链接 / 会议账号占用。返回 { ok }
// o: { course, session, bkExtra }。调用方撤回后自己再走教室检查（srmOpen）
async function solRevertOnline(o) {
  const s = o.session, c = o.course, d = s.session_date, ex = o.bkExtra || {};
  try { await csPatch('course_sessions', s.id, { delivery: c.delivery == null ? null : c.delivery, campus: c.campus == null ? null : c.campus, delivery_set: false, meeting_url: null, host_key: null }); }
  catch (er) { throw solColErr(er); }
  // 会议账号的临时占用（这一回改成线上时建的）清掉；每周占用这一天的「让位」标记还回去
  const bks = await solGet('sched_bookings', `select=*&kind=eq.course&course_id=eq.${solEnc(String(c.id))}&status=neq.rejected`);
  const mine = bks.filter(b => b.recurrence === 'once' && b.booking_date === d && b.entry_name === '单回改成线上');
  if (mine.length) await csDelete('sched_bookings', mine.map(b => b.id));
  for (const w of bks.filter(b => b.recurrence === 'weekly' && solSplit(b.manual_off_dates).includes(d))) {
    const a = solSplit(w.manual_off_dates).filter(x => x !== d);
    await csPatch('sched_bookings', w.id, Object.assign({ manual_off_dates: a.length ? a.join(',') : null }, ex));
  }
  try {
    await csInsert('sched_change_log', [{
      course_id: c.legacy_sched_id != null ? c.legacy_sched_id : null, course_name: c.merge_name || c.name || '',
      actor_role: o.role || 'admin', actor_label: o.who || '管理员', action: 'edit',
      changes: [{ field: 'session_online', course_uuid: String(c.id), session_id: s.id, num: s.session_number || null, date: d, label: `第 ${s.session_number || '?'} 回 ${solMD(d)}`, from: '线上', to: '撤回线上，恢复课程原来的上课方式', url: '' }],
      acked_by: o.ackAdmin ? 'admin' : ''
    }]);
  } catch (er) { console.warn('写撤回记录失败', er); }
  if (typeof CRV_MEMO !== 'undefined') delete CRV_MEMO.base;
  return { ok: true };
}

// 会议账号列表（给选择面板用）：固定账号 = statusRows（crvRoomStatus 的结果 [{room, blockers}]，只留有会议账号的项）
// ＋ 备用（临时）账号（sched_meeting_accounts.kind='临时' 且在用，不绑教室）放在后面。
// blockerFn(acctId) 可选：再按「会议账号」本身查一遍谁占着（同一个账号可能挂在别的教室名下；临时账号只能靠它）
function solTempRow(a, blockers) {
  return { room: { id: 'acct:' + a.id, name: '备用 · ' + (a.name || '临时账号') + (a.note ? '（' + a.note + '）' : ''), meeting_account_id: a.id, noRoom: true }, blockers: blockers || [] };
}
async function solAcctRows(statusRows, blockerFn) {
  const rows = (statusRows || []).filter(x => x.room && x.room.meeting_account_id != null && x.room.meeting_account_id !== '');
  for (const x of rows) {
    if (!blockerFn) break;
    try { const more = await blockerFn(x.room.meeting_account_id); (more || []).forEach(b => { if (!x.blockers.some(y => y.title === b.title && y.time === b.time)) x.blockers.push(b); }); } catch (er) { /* 查不到就按原样 */ }
  }
  let temps = [];
  try { temps = await solGet('sched_meeting_accounts', 'select=id,name,note&kind=eq.临时&active=eq.true&order=id'); } catch (er) { /* 读不到就只列固定账号 */ }
  for (const a of temps) {
    let bl = [];
    try { bl = blockerFn ? ((await blockerFn(a.id)) || []) : []; } catch (er) { /* 查不到按空着算，写入时数据库还会拦 */ }
    rows.push(solTempRow(a, bl));
  }
  return rows;
}
// 补链接：填了才存（必须 http 开头）；返回存下的链接
async function solSetLink(session, url, hostKey) {
  const v = String(url || '').trim();
  if (!solLinkOk(v)) throw new Error('会议链接要以 http 开头');
  try { await csPatch('course_sessions', session.id, { meeting_url: v, host_key: String(hostKey || '').trim() || null }); session.host_key = String(hostKey || '').trim() || null; } catch (er) { throw solColErr(er); }
  return v;
}
// 面板里的账号小方块：空着的 data-acct 可点；被占的灰显并写明被谁占
function solAcctHtml(rows, pickedId) {
  const e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  if (!rows.length) return '<div style="color:#a33;font-size:12px">没有可用的会议账号</div>';
  const base = 'display:inline-block;margin:3px;padding:4px 10px;border-radius:14px;font-size:12px;border:1px solid #ddd;';
  return rows.map(({ room: r, blockers: bl }) => {
    const nm = e(r.name);
    if (bl && bl.length) return `<span style="${base}background:#f2f2f2;color:#999">${nm} · 被${e(bl.map(x => `《${x.title || '占用'}》（${x.who || '—'}，${x.time}）`).join('、'))}占着</span>`;
    const on = pickedId != null && String(pickedId) === String(r.id);
    return `<span data-acct="${e(r.id)}" style="${base}cursor:pointer;${on ? 'background:#b8953a;color:#fff;border-color:#b8953a' : 'background:#fff;color:#222'}">空着 · ${nm}</span>`;
  }).join('');
}
