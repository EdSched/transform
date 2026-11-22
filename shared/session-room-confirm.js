// 管理端「课程安排」改单回后检查新日子的教室：全空着 → 不弹框，页面上方提示一行；有被占 → 弹框只列有问题的回，当场选空教室（shared/course-room-view.js），或交给总务（只给管理端用，不引用 sched/ 下任何文件）
// 依赖：shared/session-online.js（sol*，「改成线上」）、shared/course-room-view.js（crv*）、shared/supabase.js（sb）、shared/constants.js（timeRangesSpan）、shared/course-confirm.js（ccOverlay / CC_BOX / ccEsc / ccMD / CC_WD）
//
// 规则：
//   · 排课已经直接读管理端单回的日期和时间，所以这里不再释放、不再建临时占用、不再撤销
//   · 弹框里唯一的写入：点「交给总务」往 sched_change_log 写一条 action='room_coord'。同一门课的同一回（不管改到哪天）只留一条：
//       没处理的已经有就更新那一条（新日期、新原因），多出来的旧记录标成「系统」已处理，不再新增
//   · 单回挪走 / 休讲 / 撤回之后，把这门课在「原来那天」留下的临时占用清掉（srmReleaseOldTemps），不再留遗留占用
//   · 空不空的判断：课程占用按那门课当天有没有单回（和单回自己的时间）；临时占用按日期；manual_off_dates、rejected 排除；不算这门课自己

const srmSplit = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const srmT5 = t => { const s = String(t || '').slice(0, 5); return /^\d:\d{2}$/.test(s) ? '0' + s : s; };
const srmOverlap = (aS, aE, bS, bE) => srmT5(aS) < srmT5(bE) && srmT5(bS) < srmT5(aE);
function srmWeekday(d) { const w = new Date(d + 'T12:00:00').getDay(); return w === 0 ? 7 : w; }
function srmMDW(d) { return `${ccMD(d)}（${CC_WD[new Date(d + 'T12:00:00').getDay()]}）`; }
function srmSpan(tr, courseTr) { const sp = timeRangesSpan(tr || courseTr || ''); return { start: srmT5(sp.start), end: srmT5(sp.end) }; }
function srmAddDays(d, n) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
const srmGet = path => sb(path, 'GET', null, { cache: 'no-store' });

// 这门课现有的每周占用时间（给「课程整体改了上课时间」的提示用）。读不到返回 []
async function srmWeeklyTimes(courseId) {
  try {
    const rows = (await srmGet(`/rest/v1/sched_bookings?kind=eq.course&recurrence=eq.weekly&status=eq.confirmed&course_id=eq.${encodeURIComponent(courseId)}&select=start_time,end_time`)) || [];
    return [...new Set(rows.map(b => `${srmT5(b.start_time)}-${srmT5(b.end_time)}`))];
  } catch (e) { return []; }
}

// 某间教室（col='room_id'）或某个会议账号（col='meeting_account_id'）在 date 这天、sp 时段被谁占着（不算 courseId 这门课自己）
// 返回 [{ title, who, time }]
async function srmBlockers(col, id, date, sp, courseId) {
  const extra = col === 'meeting_account_id' ? '&uses_meeting=eq.true' : '';
  const rows = ((await srmGet(`/rest/v1/sched_bookings?${col}=eq.${encodeURIComponent(id)}${extra}&status=neq.rejected&or=(booking_date.eq.${date},recurrence.eq.weekly)&select=id,kind,course_id,recurrence,booking_date,weekday,start_date,end_date,manual_off_dates,start_time,end_time,title,user_name`)) || [])
    .filter(b => !(b.course_id && String(b.course_id) === String(courseId)));
  // 别的课的每周占用：看那门课当天有没有单回（及单回时间）；那天另有它自己的临时占用时以临时为准
  const wc = [...new Set(rows.filter(b => b.kind === 'course' && b.course_id).map(b => String(b.course_id)))];
  const sess = {}, hasData = new Set(), onceDay = new Set();
  if (wc.length) {
    const inList = wc.map(encodeURIComponent).join(',');
    try {
      const ss = (await srmGet(`/rest/v1/course_sessions?course_id=in.(${inList})&session_date=gte.${srmAddDays(date, -45)}&session_date=lte.${srmAddDays(date, 45)}&select=course_id,session_date,time_range,is_cancelled`)) || [];
      ss.forEach(x => { hasData.add(String(x.course_id)); if (x.session_date === date && !x.is_cancelled) sess[String(x.course_id)] = x.time_range || ''; });
    } catch (e) { /* 读不到就按记录算 */ }
    try {
      ((await srmGet(`/rest/v1/sched_bookings?kind=eq.course&recurrence=eq.once&booking_date=eq.${date}&status=neq.rejected&course_id=in.(${inList})&select=course_id`)) || []).forEach(x => onceDay.add(String(x.course_id)));
    } catch (e) { /* ignore */ }
  }
  const out = [];
  rows.forEach(b => {
    let s = b.start_time, e = b.end_time;
    if (b.recurrence === 'weekly') {
      if (srmSplit(b.manual_off_dates).includes(date)) return;
      if (b.kind === 'course' && b.course_id) {
        const cid = String(b.course_id);
        if (onceDay.has(cid)) return;
        if (hasData.has(cid)) {
          if (!(cid in sess)) return;
          const sp2 = srmSpan(sess[cid]); if (sp2.start) { s = sp2.start; e = sp2.end; }
        } else if (!srmWeeklyRule(b, date)) return;
      } else if (!srmWeeklyRule(b, date)) return;
    } else if (b.booking_date !== date) return;
    else if (b.kind === 'course' && b.course_id) {
      // 课程临时占用：只决定教室，时间按那门课当天的单回；当天没有单回就不算占用
      const cid = String(b.course_id);
      if (hasData.has(cid)) {
        if (!(cid in sess)) return;
        const sp2 = srmSpan(sess[cid]); if (sp2.start) { s = sp2.start; e = sp2.end; }
      }
    }
    if (!srmOverlap(sp.start, sp.end, s, e)) return;
    out.push({ title: b.title || '', who: b.user_name || '', time: `${srmT5(s)}-${srmT5(e)}` });
  });
  return out;
}
function srmWeeklyRule(b, d) {
  if (b.start_date && d < b.start_date) return false;
  if (b.end_date && d > b.end_date) return false;
  return Number(b.weekday) === srmWeekday(d);
}

// 同一门课、同一回：已有没处理的 room_coord → 更新那一条；多出来的旧记录标成已处理（acked_by='系统'）；没有才新增
// 以前按「课程名 + 这一回 + 这一天」判重：同一回改了两次日期（11/23 → 12/14）就判成两条，旧的永远留着，总务看到的就是重复提示
async function srmCoordWrite(course, change, actorLabel) {
  const nm = course.merge_name || course.name || '';
  let rows = [];
  try { rows = (await srmGet('/rest/v1/sched_change_log?action=eq.room_coord&select=id,course_name,changes,acked_by,created_at&order=created_at.desc&limit=200')) || []; } catch (er) { /* 查不到就照写 */ }
  const same = x => x && x.field === 'room_coord' && (change.session_id && x.session_id ? String(x.session_id) === String(change.session_id) : (x.num == change.num && x.date === change.date))
    && (x.course_uuid ? String(x.course_uuid) === String(course.id) : true);
  const mine = rows.filter(l => !String(l.acked_by || '').trim() && Array.isArray(l.changes) && l.changes.some(same)
    && (l.changes.some(x => x && x.course_uuid) || l.course_name === nm || l.course_name === course.name));
  if (mine.length) {
    await sb(`/rest/v1/sched_change_log?id=eq.${mine[0].id}`, 'PATCH', { changes: [change], actor_label: actorLabel, course_name: nm });
    for (const l of mine.slice(1)) { try { await sb(`/rest/v1/sched_change_log?id=eq.${l.id}`, 'PATCH', { acked_by: '系统' }); } catch (er) { /* ignore */ } }
    return;
  }
  await sb('/rest/v1/sched_change_log', 'POST', [{
    course_id: course.legacy_sched_id != null ? course.legacy_sched_id : null, course_name: nm,
    actor_role: 'admin', actor_label: actorLabel, action: 'room_coord', changes: [change], acked_by: ''
  }]);
}

// 单回挪走 / 休讲 / 撤回之后：这门课在「原来那天」已经没有课了 → 删掉那天留下的临时占用（以前没人清，就成了遗留占用）
// 那天每周占用让位时记下的日期（manual_off_dates）也还回去。只处理 changes[].from.date；sessions 是改完以后这门课的全部单回
async function srmReleaseOldTemps(course, changes, sessions) {
  if (!course || !course.id) return;
  const live = new Set((sessions || []).filter(s => s && !s.is_cancelled && String(s.course_id) === String(course.id)).map(s => s.session_date));
  const dates = [...new Set((changes || []).map(c => c && c.from && c.from.date).filter(d => d && !live.has(d)))];
  if (!dates.length) return;
  try {
    const bks = (await srmGet(`/rest/v1/sched_bookings?kind=eq.course&course_id=eq.${encodeURIComponent(course.id)}&status=neq.rejected&select=id,recurrence,booking_date,manual_off_dates`)) || [];
    for (const d of dates) {
      const temps = bks.filter(b => b.recurrence === 'once' && b.booking_date === d);
      if (!temps.length) continue;
      for (const t of temps) await sb(`/rest/v1/sched_bookings?id=eq.${t.id}`, 'DELETE');
      for (const w of bks.filter(b => b.recurrence === 'weekly' && srmSplit(b.manual_off_dates).includes(d))) {
        const a = srmSplit(w.manual_off_dates).filter(x => x !== d);
        await sb(`/rest/v1/sched_bookings?id=eq.${w.id}`, 'PATCH', { manual_off_dates: a.length ? a.join(',') : null });
        w.manual_off_dates = a.join(',');
      }
    }
    if (typeof CRV_MEMO !== 'undefined') delete CRV_MEMO.base;
  } catch (e) { console.warn('清理原日期的临时占用失败', e); }
}

// 「稍后调整另一门」的提示条：{ key, courseId, col, id, date, sp, bar }。每次再检查时，冲突没了就自动撤掉
const SRM_LATER = [];
function srmLaterAdd(ent, text) {
  const old = SRM_LATER.findIndex(x => x.key === ent.key);
  if (old >= 0) { try { SRM_LATER[old].bar.remove(); } catch (e) { /* ignore */ } SRM_LATER.splice(old, 1); }
  ent.bar = srmBar(text, true);
  SRM_LATER.push(ent);
}
async function srmRecheckLater() {
  for (let i = SRM_LATER.length - 1; i >= 0; i--) {
    const x = SRM_LATER[i];
    if (!x.bar || !x.bar.isConnected) { SRM_LATER.splice(i, 1); continue; }   // 手动关掉了
    try {
      const bl = await srmBlockers(x.col, x.id, x.date, x.sp, x.courseId);
      if (!bl.length) { x.bar.remove(); SRM_LATER.splice(i, 1); }
    } catch (e) { /* 读不到就先留着 */ }
  }
}

// ── 自动通知总务（课程整体改日期 / 时间后用；opts.auto=true）──
// 今天以后、有教室的回：不管原教室空不空，都自动写一条 room_coord（同一回只留一条，srmCoordWrite）。原教室在新时间被占：reason='blocked'，总务面板会推荐空教室；没被占：reason='changed'，总务确认即可。
// 没有教室占用的课（还没排教室）不发，交给现有「排课提醒」
const srmToday = () => (typeof jstToday === 'function' ? jstToday() : new Date().toISOString().slice(0, 10));
function srmChangeText(f, t) {
  if (!f) return '新增的一回';
  const parts = [];
  if (f.date !== t.date) parts.push(`日期由 ${srmMDW(f.date)} 改为 ${srmMDW(t.date)}`);
  const a = srmSpan(f.time), b = srmSpan(t.time);
  if (a.start !== b.start || a.end !== b.end) parts.push(`上课时间由 ${a.start}-${a.end} 改为 ${b.start}-${b.end}`);
  return parts.join('；') || '日期 / 时间有调整';
}
// 返回要通知的回：[{ ch, sp, room:{id,name}, blockers, text, change }]（只计算 + 读冲突，不写库）
async function srmAutoPlan(course, changes, bks, roomName, today) {
  const withRoom = (bks || []).filter(b => b.room_id != null && b.room_id !== '');
  const out = [];
  if (!withRoom.length) return out;
  for (const ch of changes) {
    const f = ch.from, t = ch.to;
    if (!t || t.cancelled || !t.date || t.date < today) continue;       // 只通知今天以后的回
    const sp = srmSpan(t.time);
    if (!sp.start) continue;
    const fsp = f ? srmSpan(f.time) : null;
    const pick = (f && withRoom.find(b => srmWeeklyRule(b, f.date) && srmOverlap(fsp.start, fsp.end, b.start_time, b.end_time)))
      || withRoom.find(b => Number(b.weekday) === srmWeekday(t.date)) || withRoom[0];
    let blockers = [];
    try { blockers = await srmBlockers('room_id', pick.room_id, t.date, sp, course.id); } catch (er) { blockers = []; }
    const rn = roomName(pick.room_id);
    const text = srmChangeText(f, t);
    const blockerTxt = blockers.map(x => `《${x.title}》（${x.who || '—'}，${x.time}）`).join('、');
    out.push({ ch, sp, room: { id: pick.room_id, name: rn }, blockers, text,
      change: { field: 'room_coord', label: `第 ${ch.num || '?'} 回`, num: ch.num || null, session_id: ch.id, course_uuid: course.id,
        from: f ? `${f.date} ${f.time || ''}`.trim() : '（新增）', to: `${t.date} ${sp.start}-${sp.end}`, date: t.date, time: `${sp.start}-${sp.end}`,
        room_name: rn, room_id: pick.room_id, blocker: blockerTxt, reason: blockers.length ? 'blocked' : 'changed', note: text } });
  }
  return out;
}
async function srmAutoOpen(course, changes, bks, roomName) {
  const plan = await srmAutoPlan(course, changes, bks, roomName, srmToday());
  if (!plan.length) return { notified: 0 };
  const who = () => (typeof csWho === 'function' ? csWho() : ((typeof ADMIN_EMAIL !== 'undefined' && ADMIN_EMAIL) ? ADMIN_EMAIL : '管理员'));
  const failed = [];
  for (const it of plan) { try { await srmCoordWrite(course, it.change, who()); } catch (er) { failed.push(er.message || String(er)); } }
  const ok = plan.length - failed.length;
  await new Promise(resolve => {
    const ov = ccOverlay('srmOv'), e = ccEsc;
    let memo = '', err = failed.length ? `有 ${failed.length} 回通知失败：${failed[0]}` : '', busy = false;
    const close = () => { ov.remove(); resolve(); };
    const writeAll = async extra => {
      failed.length = 0; err = '';
      for (const it of plan) { try { await srmCoordWrite(course, Object.assign({}, it.change, extra), who()); } catch (er) { failed.push(er.message || String(er)); } }
      if (failed.length) err = `有 ${failed.length} 回通知失败：${failed[0]}`;
    };
    const draw = () => {
      const body = plan.map(it => {
        const t = it.ch.to, n = it.ch.num ? '第 ' + e(it.ch.num) + ' 回' : '新增一回';
        const st = it.blockers.length
          ? `<span style="color:#a33">原教室 ${e(it.room.name)} 在新时间已被《${e(it.blockers[0].title)}》（${e(it.blockers[0].who || '—')}，${e(it.blockers[0].time)}）占用${it.blockers.length > 1 ? ' 等' + it.blockers.length + '处' : ''}，总务会推荐空教室</span>`
          : `<span style="color:#2a7a3a">原教室 ${e(it.room.name)} 新时间空着，请总务确认</span>`;
        return `<div style="border-bottom:1px solid var(--border-light,#eee);padding:6px 0"><div style="font-weight:600">${n} → ${e(srmMDW(t.date))}${e(it.sp.start)}-${e(it.sp.end)}</div><div style="font-size:12px;color:#666">${e(it.text)}</div><div>${st}</div></div>`;
      }).join('');
      ov.innerHTML = `<div style="${CC_BOX}"><div style="padding:14px 18px;border-bottom:1px solid var(--border,#e2ded6);font-size:15px;font-weight:600">${failed.length ? '通知没发完整' : `已通知总务（${plan.length - failed.length} 回），请核对`}</div><div style="padding:12px 18px;overflow:auto;flex:1"><div style="font-size:12px;color:#888;margin-bottom:4px">《${e(course.merge_name || course.name || '')}》今天以后、有教室的回，已自动发给总务，不用再点「交给总务」。已上过的回没有通知。</div>${body}<div style="margin-top:10px"><div style="font-size:12px;color:#888;margin-bottom:3px">给总务补充一句备注（可不填，会写进同一条通知）</div><input id="srmMemo" type="text" value="${e(memo)}" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--border,#e2ded6);border-radius:6px"></div>${err ? `<div style="color:#a33;margin-top:6px">${e(err)}</div>` : ''}</div><div style="padding:10px 18px;border-top:1px solid var(--border,#e2ded6);display:flex;gap:8px;justify-content:flex-end"><button type="button" id="srmRetry" class="btn btn-outline btn-sm" style="padding:6px 16px;cursor:pointer;${failed.length ? '' : 'display:none'}">重新通知</button><button type="button" id="srmClose" class="btn btn-primary btn-sm" style="padding:6px 16px;cursor:pointer">${busy ? '保存中…' : '完成'}</button></div></div>`;
      const inp = ov.querySelector('#srmMemo'); inp.oninput = () => { memo = inp.value; };
      ov.querySelector('#srmRetry').onclick = async () => { await writeAll(memo.trim() ? { memo: memo.trim() } : {}); draw(); };
      ov.querySelector('#srmClose').onclick = async () => {
        if (busy) return;
        const m = memo.trim();
        if (m) { busy = true; draw(); await writeAll({ memo: m }); busy = false; if (failed.length) { draw(); return; } }
        close();
      };
    };
    draw();
  });
  return { notified: ok, total: plan.length };
}

// opts: { course, changes:[{ id, num, from:{date,time,cancelled}|null, to:{date,time,cancelled} }], sessions:[该课现在全部单回] }
// 返回 Promise：窗口关掉后 resolve（不抛错）
async function srmOpen(opts) {
  await srmRecheckLater();     // 先看以前「稍后处理」的提示，冲突没了的自动消失
  const course = opts.course || {};
  await srmReleaseOldTemps(course, opts.changes, opts.sessions);   // 原来那天已经没课了：把那天留下的临时占用一起清掉
  const changes = (opts.changes || []).filter(c => c && c.to && !c.to.cancelled);
  if (!course.id || !changes.length) return { notified: 0 };
  let bks, rooms = [], accts = [];
  try {
    bks = ((await srmGet(`/rest/v1/sched_bookings?kind=eq.course&course_id=eq.${encodeURIComponent(course.id)}&select=*`)) || []).filter(b => b.status === 'confirmed' && b.recurrence === 'weekly');
    const rids = [...new Set(bks.map(b => b.room_id).filter(v => v != null && v !== ''))];
    if (rids.length) rooms = (await srmGet(`/rest/v1/sched_rooms?id=in.(${rids.map(encodeURIComponent).join(',')})&select=id,name`)) || [];
    const aids = [...new Set(bks.filter(b => b.uses_meeting && b.meeting_account_id != null && b.meeting_account_id !== '').map(b => b.meeting_account_id))];
    if (aids.length) accts = (await srmGet(`/rest/v1/sched_meeting_accounts?id=in.(${aids.map(encodeURIComponent).join(',')})&select=id,name`)) || [];
  } catch (e) { console.warn('读取教室占用失败', e); return { notified: 0 }; }
  const roomName = id => { const r = rooms.find(x => String(x.id) === String(id)); return r ? r.name : '教室'; };
  if (opts.auto) return srmAutoOpen(course, changes, bks, roomName);   // 课程整体改日期 / 时间：自动通知总务，弹框只是确认 + 备注
  const acctName = id => { const a = accts.find(x => String(x.id) === String(id)); return a ? (a.name || '会议账号') : '会议账号'; };
  const withRoom = bks.filter(b => b.room_id != null && b.room_id !== '');

  // ── 每一回：用哪间教室 / 哪个会议账号，空不空 ──
  const rows = [];
  for (const ch of changes) {
    const f = ch.from, t = ch.to;
    const sp = srmSpan(t.time);
    const ses = (opts.sessions || []).find(x => x && String(x.id) === String(ch.id)) || null;
    if (ses && typeof solIsOnline === 'function' && solIsOnline(ses)) continue;   // 这一回单独改成线上：不需要教室
    const row = { ch, sp, ses, checks: [], note: '', key: `${course.id}|${ch.id}|${t.date}`, sol: { open: false, mode: 'link', url: '', acct: null, rows: null, busy: false } };
    if (!sp.start) row.note = '这一回没有上课时间，不能判断教室';
    else {
      // 教室：和原来那天占的教室一致，其次同星期的每周占用，再其次第一条
      const fsp = f ? srmSpan(f.time) : null;
      const pick = (f && withRoom.find(b => srmWeeklyRule(b, f.date) && srmOverlap(fsp.start, fsp.end, b.start_time, b.end_time)))
        || withRoom.find(b => Number(b.weekday) === srmWeekday(t.date)) || withRoom[0];
      const acctIds = [...new Set(bks.filter(b => b.uses_meeting && b.meeting_account_id != null && b.meeting_account_id !== '').map(b => String(b.meeting_account_id)))];
      if (!pick && !acctIds.length) row.checks.push({ label: '', none: true });
      if (pick) row.checks.push({ label: roomName(pick.room_id), col: 'room_id', id: pick.room_id });
      acctIds.forEach(a => row.checks.push({ label: acctName(a) + '（会议账号）', col: 'meeting_account_id', id: a }));
      for (const c of row.checks) {
        if (c.none) continue;
        try { c.blockers = await srmBlockers(c.col, c.id, t.date, sp, course.id); } catch (er) { c.blockers = []; c.err = true; }
      }
    }
    rows.push(row);
  }
  if (!rows.length) return;

  if (!rows.length) return;
  const problems = r => r.checks.filter(c => c.none || (c.blockers && c.blockers.length));
  const probRows = rows.filter(r => !r.note && problems(r).length);
  const noteRows = rows.filter(r => r.note);
  // 全部空着：不弹框，页面上方提示一行
  if (!probRows.length && !noteRows.length) {
    srmBar(rows.map(r => {
      const t = r.ch.to;
      return `已改：${r.ch.num ? '第 ' + ccEsc(r.ch.num) + ' 回' : '新增一回'} → ${ccEsc(srmMDW(t.date))}${ccEsc(r.sp.start)}，` + r.checks.map(c => `${c.col === 'room_id' ? '原教室 ' : ''}${ccEsc(c.label.replace('（会议账号）', ' 会议账号'))} 空着 ✓`).join('；');
    }).join('<br>'));
    return;
  }
  rows.forEach(r => { r.picked = null; });

  await new Promise(resolve => {
    const ov = ccOverlay('srmOv');
    const e = ccEsc;
    const notified = new Set();
    const close = () => {
      ov.remove(); ['__srmOnlineToggle', '__srmOnlineMode', '__srmOnlineUrl', '__srmOnlineAcct', '__srmOnlineHost', '__srmOnlineGo'].forEach(k => { delete window[k]; });
      if (rows.some(x => x.online) && typeof renderCoursesPage === 'function' && document.getElementById('mainContent')) { try { renderCoursesPage(document.getElementById('mainContent')); } catch (er) { /* ignore */ } }
      delete window.__srmNotify; delete window.__srmNotifyAll; delete window.__srmPick; delete window.__srmLater; delete window.__srmLaterAll; resolve(); };
    const who = () => (typeof csWho === 'function' ? csWho() : ((typeof ADMIN_EMAIL !== 'undefined' && ADMIN_EMAIL) ? ADMIN_EMAIL : '管理员'));
    const todoRows = () => (probRows.concat(noteRows)).filter(r => !r.picked && !r.later && !r.online);
    // 稍后调整另一门：这一回收起，标成「稍后处理」，页面上方留一条提示（另一门调整完自动消失）
    const laterOne = r => {
      if (r.picked || r.later) return;
      const c = problems(r).find(x => !x.none && x.blockers && x.blockers.length); if (!c) return;
      const t = r.ch.to, x = c.blockers[0];
      r.later = true;
      srmLaterAdd({ key: r.key, courseId: course.id, col: c.col, id: c.id, date: t.date, sp: r.sp },
        `${ccEsc(ccMD(t.date))} 第 ${ccEsc(r.ch.num || '?')} 回在 ${ccEsc(c.label.replace('（会议账号）', ' 会议账号'))} 跟《${ccEsc(x.title)}》${ccEsc(x.time)} 撞了，调整另一门以后会自动消失。`);
    };
    window.__srmLater = i => { laterOne(rows[i]); draw(); };
    window.__srmLaterAll = () => { todoRows().forEach(laterOne); draw(); };

    // 写一条 room_coord；同一回已有没处理的就更新那一条（srmCoordWrite）
    const notifyOne = async r => {
      if (notified.has(r.key) || r.picked || r.online) return;
      const pr = problems(r)[0]; if (!pr) return;
      const t = r.ch.to;
      const blocker = pr.none ? '' : pr.blockers.map(x => `《${x.title}》（${x.who || '—'}，${x.time}）`).join('、');
      const change = {
        field: 'room_coord', label: `第 ${r.ch.num || '?'} 回`, num: r.ch.num || null, session_id: r.ch.id, course_uuid: course.id,
        from: r.ch.from ? `${r.ch.from.date} ${r.ch.from.time || ''}`.trim() : '（新增）', to: `${t.date} ${r.sp.start ? r.sp.start + '-' + r.sp.end : ''}`.trim(),
        date: t.date, time: r.sp.start ? `${r.sp.start}-${r.sp.end}` : '', room_name: pr.none ? '' : pr.label, room_id: pr.none ? null : pr.id, blocker, reason: pr.none ? 'no_room' : 'blocked'
      };
      await srmCoordWrite(course, change, who());
      notified.add(r.key);
    };
    let err = '';
    window.__srmNotify = async i => { try { err = ''; await notifyOne(rows[i]); } catch (er) { err = '通知失败：' + (er.message || er); } draw(); };
    window.__srmNotifyAll = async () => {
      err = '';
      for (const r of todoRows()) { try { await notifyOne(r); } catch (er) { err = '通知失败：' + (er.message || er); break; } }
      draw();
    };
    // 点一间空教室 → 确认 → 建临时占用
    window.__srmPick = async (i, roomId) => {
      const r = rows[i], t = r.ch.to;
      const room = (r.pickRows || []).map(x => x.room).find(x => String(x.id) === String(roomId)); if (!room) return;
      const busy = ((r.pickRows || []).find(x => String(x.room.id) === String(roomId)) || {}).blockers || [];
      if (busy.length) { if (!confirm(crvBusyConfirmText(room, t.date, r.sp, busy))) return; }
      else if (!confirm(`第 ${r.ch.num || '?'} 回 ${ccMD(t.date)} 改在 ${((room.campus || '') + ' ' + room.name).trim()}？`)) return;
      try {
        err = '';
        await crvSwapRoom({ courseId: course.id, date: t.date, sp: r.sp, toRoom: room, entryName: '课程安排改单回' });
        r.picked = ((room.campus || '') + ' ' + room.name).trim();
        if (busy.length) srmLaterAdd({ key: r.key + '|pick', courseId: course.id, col: 'room_id', id: room.id, date: t.date, sp: r.sp },
          `${ccEsc(ccMD(t.date))} 第 ${ccEsc(r.ch.num || '?')} 回在 ${ccEsc(room.name)} 跟《${ccEsc(busy[0].title)}》${ccEsc(busy[0].time)} 撞了，调整另一门以后会自动消失。`);
      } catch (er) { err = /^数据库认为/.test(er.message || '') ? er.message : '换教室失败：' + (er.message || er); }
      draw();
    };
    // ── 这一回改成线上 ──
    const loadAcct = async r => {
      const d = r.ch.to.date;
      try {
        const st = await crvRoomStatus(d, r.sp, course.id);
        r.sol.rows = await solAcctRows(st, aid => srmBlockers('meeting_account_id', aid, d, r.sp, course.id));
        if (r.sol.acct && !(r.sol.rows.find(x => String(x.room.id) === String(r.sol.acct) && !x.blockers.length))) r.sol.acct = null;
      } catch (er) { r.sol.rows = []; r.sol.rowsErr = true; }
      draw();
    };
    window.__srmOnlineToggle = i => { const r = rows[i]; r.sol.open = !r.sol.open; draw(); };
    window.__srmOnlineMode = (i, v) => { const r = rows[i]; r.sol.mode = v; draw(); if (v === 'acct' && !r.sol.rows) loadAcct(r); };
    window.__srmOnlineUrl = (i, v) => {
      const r = rows[i]; r.sol.url = v;
      const b = document.getElementById('solOk' + i); if (b) b.disabled = !solLinkValid(v);
      const h = document.getElementById('solHint' + i); if (h) h.style.display = solLinkValid(v) ? 'none' : 'block';
    };
    window.__srmOnlineHost = (i, v) => { rows[i].sol.host = v; };
    window.__srmOnlineAcct = (i, id) => { rows[i].sol.acct = id; draw(); };
    window.__srmOnlineGo = async i => {
      const r = rows[i], S = r.sol, t = r.ch.to;
      if (S.busy) return;
      if (!r.ses) { err = '找不到这一回的单回数据，请刷新页面后再试'; draw(); return; }
      const acct = S.mode === 'acct' ? ((S.rows || []).map(x => x.room).find(x => String(x.id) === String(S.acct)) || null) : null;
      if (S.mode === 'acct' && !acct) return;
      if (S.mode === 'link' && !solLinkValid(S.url)) return;
      const how = S.mode === 'acct' ? `会议账号 ${acct.name}` : (S.url.trim() ? '自备链接' : '自备链接，之后补');
      if (!confirm(`第 ${r.ch.num || '?'} 回 ${ccMD(t.date)} 改成线上（${how}）；原来占的教室会释放`)) return;
      S.busy = true; err = ''; draw();
      try {
        const res = await solSetOnline({ course, session: r.ses, sp: r.sp, mode: S.mode, url: S.url, acctRoom: acct, hostKey: S.host, who: who(), ackAdmin: true });
        r.online = res.text;
        r.onlineWarn = (res.warn || []).join('；');
        Object.assign(r.ses, { delivery: '线上', campus: '线上', delivery_set: true, meeting_url: S.mode === 'link' ? S.url.trim() : null });
        if (typeof srmRecheckLater === 'function') srmRecheckLater();
      } catch (er) { err = er.message || String(er); if (S.mode === 'acct') { S.rows = null; loadAcct(r); } }
      S.busy = false; draw();
    };
    const loadPick = async r => {
      const pr = problems(r).find(c => c.none || c.col === 'room_id'); if (!pr) return;
      try { r.pickRows = await crvRoomStatus(r.ch.to.date, r.sp, course.id); r.curRoomId = pr.none ? null : pr.id; } catch (er) { r.pickErr = true; }
      draw();
    };

    const draw = () => {
      const list = probRows.concat(noteRows);
      const body = list.map(r => {
        const i = rows.indexOf(r);
        const f = r.ch.from, t = r.ch.to;
        const b = srmMDW(t.date) + (r.sp.start ? r.sp.start : '');
        const head = `${r.ch.num ? '第 ' + e(r.ch.num) + ' 回' : '新增一回'} → ${e(b)}`;
        if (r.online) return `<div style="border-bottom:1px solid var(--border-light,#eee);padding:6px 0"><div style="font-weight:600">${head}</div><div style="color:#2a6fb0">已${e(r.online)} ✓</div>${r.onlineWarn ? `<div style="color:#7a5b00;font-size:12px">${e(r.onlineWarn)}</div>` : ''}</div>`;
        if (r.picked) return `<div style="border-bottom:1px solid var(--border-light,#eee);padding:6px 0"><div style="font-weight:600">${head}</div><div style="color:#2a7a3a">已安排在 ${e(r.picked)} ✓</div></div>`;
        if (r.later) return `<div style="border-bottom:1px solid var(--border-light,#eee);padding:6px 0"><div style="font-weight:600">${head}</div><div style="color:#7a5b00">稍后处理（调整另一门后，这条提示会自动消失）</div></div>`;
        const pr = problems(r);
        let lines;
        if (r.note) lines = `<div style="color:#7a5b00">${e(r.note)}</div>`;
        else lines = r.checks.map(c => {
          if (c.none) return `<div><span style="color:#a33">这门课还没排教室</span></div>`;
          if (c.blockers && c.blockers.length) { const x = c.blockers[0]; return `<div>${e(c.label)}　<span style="color:#a33">被《${e(x.title)}》（${e(x.who || '—')}，${e(x.time)}）占着${c.blockers.length > 1 ? ' 等' + c.blockers.length + '处' : ''}</span></div>`; }
          return `<div>${e(c.label)}　<span style="color:#2a7a3a">✓ 空着</span></div>`;
        }).join('');
        const picker = r.pickRows ? `<div style="font-size:12px;color:#888;margin-top:4px">${e(srmMDW(t.date))}${e(r.sp.start)}-${e(r.sp.end)} 各教室（✓ 空着，点一间就改在那里）：</div><div class="srmPick" data-i="${i}">${crvRoomPickHtml(r.pickRows, r.curRoomId)}</div>` : (r.pickErr ? '<div style="color:#a33;font-size:12px">教室列表读取失败</div>' : (pr.length ? '<div style="color:#888;font-size:12px;margin-top:4px">读取教室列表…</div>' : ''));
        const hasBlock = pr.some(c => !c.none && c.blockers && c.blockers.length);
        const laterBtn = hasBlock ? `<button type="button" class="btn btn-outline btn-sm" style="padding:2px 10px;cursor:pointer;white-space:nowrap" onclick="__srmLater(${i})">稍后调整另一门</button>` : '';
        const onlineBtn = pr.length && r.ses ? `<button type="button" class="btn btn-outline btn-sm" style="padding:2px 10px;cursor:pointer;white-space:nowrap" onclick="__srmOnlineToggle(${i})">${r.sol.open ? '收起线上' : '改成线上'}</button>` : '';
        const S = r.sol;
        const okOn = S.mode === 'acct' ? !!S.acct : solLinkValid(S.url);
        const onlinePanel = pr.length && r.ses && S.open ? `<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--border,#e2ded6);border-radius:6px;background:#faf8f3">
          <div style="font-size:12px;color:#888;margin-bottom:4px">只改这一回，课程和别的回不变</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:12px">线上方式</span><select onchange="__srmOnlineMode(${i},this.value)" style="padding:4px 8px;border:1px solid var(--border,#e2ded6);border-radius:6px"><option value="link"${S.mode === 'link' ? ' selected' : ''}>自备腾讯会议链接</option><option value="acct"${S.mode === 'acct' ? ' selected' : ''}>占用一个会议账号</option></select></div>
          ${S.mode === 'link'
            ? `<input type="text" value="${e(S.url)}" oninput="__srmOnlineUrl(${i},this.value)" placeholder="https://meeting.tencent.com/…" style="width:100%;box-sizing:border-box;margin-top:6px;padding:6px 8px;border:1px solid var(--border,#e2ded6);border-radius:6px"><div style="font-size:11px;color:#888;margin-top:2px">可以先不填，之后在课程安排里补。填了要以 http 开头。不占教室，也不占会议账号。</div><div id="solHint${i}" style="font-size:11px;color:#a33;margin-top:2px;display:${solLinkValid(S.url) ? 'none' : 'block'}">链接格式不对，要以 http 开头</div><input type="text" value="${e(S.host || '')}" oninput="__srmOnlineHost(${i},this.value)" placeholder="主持人密钥（选填，只用于这一回）" style="width:100%;box-sizing:border-box;margin-top:6px;padding:6px 8px;border:1px solid var(--border,#e2ded6);border-radius:6px">`
            : `<div style="font-size:12px;color:#888;margin-top:6px">${e(srmMDW(t.date))}${e(r.sp.start)}-${e(r.sp.end)} 各会议账号（点一个空着的）：</div><div class="srmAcct" data-i="${i}">${S.rows ? solAcctHtml(S.rows, S.acct) : (S.rowsErr ? '<span style="color:#a33;font-size:12px">会议账号读取失败</span>' : '<span style="color:#888;font-size:12px">读取中…</span>')}</div>`}
          <div style="margin-top:8px;text-align:right"><button type="button" id="solOk${i}" class="btn btn-primary btn-sm" style="padding:4px 14px;cursor:pointer" ${okOn && !S.busy ? '' : 'disabled'} onclick="__srmOnlineGo(${i})">${S.busy ? '保存中…' : '确认改成线上'}</button></div></div>` : '';
        const btn = pr.length ? `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">${onlineBtn}${notified.has(r.key) ? '<span style="color:#2a7a3a;white-space:nowrap">已交给总务 ✓</span>' : `<button type="button" class="btn btn-outline btn-sm" style="padding:2px 10px;cursor:pointer;white-space:nowrap" onclick="__srmNotify(${i})">交给总务</button>`}${laterBtn}</div>` : '';
        return `<div style="border-bottom:1px solid var(--border-light,#eee);padding:6px 0;display:flex;gap:10px;align-items:flex-start"><div style="flex:1;min-width:0"><div style="font-weight:600">${head}</div>${lines}${pr.length ? picker : ''}${onlinePanel}</div>${btn}</div>`;
      }).join('');
      const todo = todoRows().filter(r => !notified.has(r.key) && problems(r).length).length;
      const laterTodo = todoRows().filter(r => problems(r).some(c => !c.none && c.blockers && c.blockers.length)).length;
      ov.innerHTML = `<div style="${CC_BOX}"><div style="padding:14px 18px;border-bottom:1px solid var(--border,#e2ded6);font-size:15px;font-weight:600">这几回的教室需要处理</div><div style="padding:12px 18px;overflow:auto;flex:1">${body}${err ? `<div style="color:#a33;margin-top:6px">${e(err)}</div>` : ''}<div style="font-size:11px;color:#888;margin-top:8px">点「完成」时，还没处理的回（没换教室、没点「稍后」）会自动交给总务；点「稍后调整另一门」会在页面上方留提示，另一门调整完自动消失。</div></div><div style="padding:10px 18px;border-top:1px solid var(--border,#e2ded6);display:flex;gap:8px;justify-content:flex-end;align-items:center"><span style="flex:1"></span>${laterTodo ? '<button type="button" class="btn btn-outline btn-sm" style="padding:6px 16px;cursor:pointer" onclick="__srmLaterAll()">全部稍后处理</button>' : ''}${todo ? '<button type="button" class="btn btn-outline btn-sm" style="padding:6px 16px;cursor:pointer" onclick="__srmNotifyAll()">全部交给总务</button>' : ''}<button type="button" id="srmClose" class="btn btn-primary btn-sm" style="padding:6px 16px;cursor:pointer">完成</button></div></div>`;
      // 点「完成」：还没处理的回（没换教室、没点「稍后」）自动交给总务，不再「关掉弹窗 = 什么都不发」
      ov.querySelector('#srmClose').onclick = async () => {
        const rest = todoRows().filter(r => !notified.has(r.key) && problems(r).some(c => !c.none && c.blockers && c.blockers.length));
        for (const r of rest) { try { await notifyOne(r); } catch (er) { err = '通知失败：' + (er.message || er); draw(); return; } }
        close();
      };
      ov.querySelectorAll('.srmAcct').forEach(box => box.querySelectorAll('[data-acct]').forEach(x => x.onclick = () => __srmOnlineAcct(+box.dataset.i, x.dataset.acct)));
      ov.querySelectorAll('.srmPick').forEach(box => box.querySelectorAll('[data-room]').forEach(x => x.onclick = () => __srmPick(+box.dataset.i, x.dataset.room)));
    };
    draw();
    probRows.forEach(r => { loadPick(r); });
  });
}

// 页面上方提示一行（点 × 关掉，不自动消失）
function srmBar(html, warn) {
  let box = document.getElementById('srmBars');
  if (!box) { box = document.createElement('div'); box.id = 'srmBars'; box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9000;display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px;pointer-events:none'; document.body.appendChild(box); }
  const bar = document.createElement('div');
  bar.style.cssText = 'pointer-events:auto;max-width:760px;width:100%;' + (warn ? 'background:#fbf3dc;border:1px solid #e3d3a6;color:#7a5b00;' : 'background:#eaf6ec;border:1px solid #9fcfa8;color:#1f5a2c;') + 'border-radius:8px;padding:8px 12px;font-size:13px;line-height:1.5;display:flex;gap:10px;align-items:flex-start;box-shadow:0 4px 14px rgba(0,0,0,.15)';
  bar.innerHTML = `<div style="flex:1;min-width:0">${html}</div><button type="button" style="cursor:pointer;border:none;background:none;font-size:16px;line-height:1">×</button>`;
  bar.querySelector('button').onclick = () => bar.remove();
  box.appendChild(bar);
  return bar;
}
