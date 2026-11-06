// 管理端和排课共用：单回（course_sessions）和教室占用（sched_bookings）对齐
// 依赖 shared/constants.js（timeRangesSpan）。管理端用 sb，排课用 sbGet / sbInsert / sbUpdate / sbDelete，这里自动认。
//
// 规则（排课只管教室，日期归管理端）：
//   · 每一回都要被这门课的占用覆盖：同一天有按周占用（那天没被释放）或临时占用，且时间包住这一回的上课时间
//   · 按周占用落在、但没有对应单回的日子 → 写进 auto_off_dates（每次整体重算，人工释放的 manual_off_dates 不碰）
//   · 没被覆盖的单回 → 在原教室建一条临时占用（kind:'course', recurrence:'once', auto_sync:true）；
//     原教室那天被占，或这门课分不出用哪间教室 → 不硬占，往 sched_change_log 写一条 session_room 提醒
//   · 过期的自动临时占用（单回没了 / 改了日期 / 已被按周占用覆盖）删掉
//   · 那天在 manual_off_dates 里的单回：人已经处理过，跳过

const CRS_ADMIN = () => typeof sbAll === 'function';
async function crsGet(table, q) { return CRS_ADMIN() ? sb(`/rest/v1/${table}?${q}`) : sbGet(table, q); }
async function crsInsert(table, row) { return CRS_ADMIN() ? sb(`/rest/v1/${table}`, 'POST', [row]) : sbInsert(table, row); }
async function crsPatch(table, id, obj) { return CRS_ADMIN() ? sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, 'PATCH', obj) : sbUpdate(table, id, obj); }
async function crsDelete(table, id) { return CRS_ADMIN() ? sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, 'DELETE') : sbDelete(table, id); }

const crsT5 = t => String(t || '').slice(0, 5);
const crsSplit = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
function crsWeekday(d) { const w = new Date(d + 'T00:00:00').getDay(); return w === 0 ? 7 : w; }
function crsAddDays(d, n) { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
const crsOverlap = (aS, aE, bS, bE) => crsT5(aS) < crsT5(bE) && crsT5(bS) < crsT5(aE);
const crsContains = (b, s, e) => !s || !e || (crsT5(b.start_time) <= crsT5(s) && crsT5(b.end_time) >= crsT5(e));
const crsWeekdayName = d => '周' + '日一二三四五六'[new Date(d + 'T00:00:00').getDay()];

// 按周占用那天算不算占（可选忽略系统自动释放的日子，因为自动释放是每次重算的）
function crsWeeklyOn(b, d, withAuto) {
  if (b.recurrence !== 'weekly') return false;
  if (b.start_date && d < b.start_date) return false;
  if (b.end_date && d > b.end_date) return false;
  if (Number(b.weekday) !== crsWeekday(d)) return false;
  if (crsSplit(b.manual_off_dates).includes(d)) return false;
  if (withAuto && crsSplit(b.auto_off_dates).includes(d)) return false;
  return true;
}
const crsOnDate = (b, d) => b.recurrence === 'weekly' ? crsWeeklyOn(b, d, true) : b.booking_date === d;

async function crsRemind(co, s, date, span, reason) {
  const key = s.id + '|' + date;
  if (date < new Date().toISOString().slice(0, 10)) return false;   // 过去的日子不提醒
  try {
    const old = await crsGet('sched_change_log', 'select=changes&action=eq.session_room&order=created_at.desc&limit=500');
    if ((old || []).some(l => (l.changes || []).some(x => x && x.key === key && !x.resolved_at))) return false;
  } catch (e) { /* 读不到就照写，宁可多一条 */ }
  const timeTxt = span.start ? `${span.start}-${span.end}` : '';
  const msg = `《${co.name}》第 ${s.session_number || '?'} 回改到 ${date.slice(5).replace('-', '/')}（${crsWeekdayName(date)}）${timeTxt}，${reason}，请安排`;
  const role = (typeof ROLE !== 'undefined' && ROLE) ? ROLE : null;
  await crsInsert('sched_change_log', {
    course_id: null, course_name: co.name, actor_role: (role && role.role) || 'admin', actor_label: (role && (role.label || role.role)) || '单回改期',
    action: 'session_room', acked_by: '',
    changes: [{ key, field: 'session_room', label: '单回教室', from: '', to: msg, course_id: co.id, session_id: s.id, date, reason }],
  });
  return true;
}

async function courseRoomSync(courseId) {
  const out = await courseRoomSyncCore(courseId);
  try { out.resolved = await crsResolveReminders(courseId); } catch (e) { console.warn('单回教室提醒标记失败', e); out.resolved = []; }
  return out;
}

// 这门课还没处理的 session_room 提醒：补上了 / 不需要了 → 标「已处理」，返回 [{ key, kind:'occupied'|'gone', note }]
async function crsResolveReminders(courseId) {
  const res = [];
  const logs = (await crsGet('sched_change_log', 'select=id,changes&action=eq.session_room&order=created_at.desc&limit=500') || [])
    .filter(l => { const x = (l.changes || [])[0]; return x && !x.resolved_at && String(x.course_id) === String(courseId); });
  if (!logs.length) return res;
  const cid = encodeURIComponent(courseId);
  const co = (await crsGet('courses', `select=id,time_range&id=eq.${cid}&limit=1`))[0];
  const sessions = await crsGet('course_sessions', `select=id,session_date,time_range,is_cancelled&course_id=eq.${cid}&limit=2000`);
  const bks = (await crsGet('sched_bookings', `select=*&kind=eq.course&course_id=eq.${cid}&limit=2000`)).filter(b => b.status !== 'rejected');
  for (const l of logs) {
    const x = l.changes[0];
    const s = sessions.find(v => String(v.id) === String(x.session_id));
    let note = '', kind = '';
    if (!s || s.is_cancelled === true || s.session_date !== x.date) { kind = 'gone'; note = '这一回已不需要（日期已变或已取消）'; }
    else {
      const sp = timeRangesSpan(s.time_range || (co && co.time_range) || '');
      const hit = bks.find(b => (b.recurrence === 'weekly' ? crsWeeklyOn(b, x.date, true) : b.booking_date === x.date) && crsContains(b, sp.start, sp.end));
      if (hit) {
        let name = '';
        if (hit.room_id != null && hit.room_id !== '') { try { const r = (await crsGet('sched_rooms', `select=name&id=eq.${encodeURIComponent(hit.room_id)}&limit=1`))[0]; name = r ? r.name : ''; } catch (e) { /* 忽略 */ } }
        kind = 'occupied'; note = '已自动占用 ' + (name || '原教室');
      }
    }
    if (!kind) continue;
    await crsPatch('sched_change_log', l.id, { changes: [Object.assign({}, x, { resolved_at: new Date().toISOString(), resolved_note: note }), ...l.changes.slice(1)] });
    res.push({ key: x.key, kind, note });
  }
  return res;
}

async function courseRoomSyncCore(courseId) {
  const out = { released: 0, created: 0, removed: 0, reminders: 0, notes: [] };
  const cid = encodeURIComponent(courseId);
  const co = (await crsGet('courses', `select=id,name,time_range,sched_merge_group&id=eq.${cid}&limit=1`))[0];
  if (!co) return out;
  const sessions = await crsGet('course_sessions', `select=id,session_number,session_date,time_range,is_cancelled&course_id=eq.${cid}&limit=2000`);
  const bks = await crsGet('sched_bookings', `select=*&kind=eq.course&course_id=eq.${cid}&limit=2000`);
  const autos = bks.filter(b => b.auto_sync === true);
  if (!sessions.length) { out.notes.push('这门课没有单回记录'); return out; }
  const active = sessions.filter(s => s.is_cancelled !== true && s.session_date);
  const weekly = bks.filter(b => b.recurrence === 'weekly' && b.status === 'confirmed');
  const temps = bks.filter(b => b.recurrence === 'once');
  const spanOf = s => timeRangesSpan(s.time_range || co.time_range || '');

  // 1) 过期的自动临时占用
  const keepTemps = [];
  for (const t of temps) {
    if (t.auto_sync !== true) { keepTemps.push(t); continue; }
    const s = active.find(x => x.id === t.session_id);
    let stale = !s || s.session_date !== t.booking_date;
    if (!stale) {
      const sp = spanOf(s);
      stale = weekly.some(b => crsWeeklyOn(b, s.session_date, false) && crsContains(b, sp.start, sp.end)) || !crsContains(t, sp.start, sp.end);
    }
    if (stale) { await crsDelete('sched_bookings', t.id); out.removed++; } else keepTemps.push(t);
  }

  // 2) 按周占用的自动释放：整体重算
  for (const b of weekly) {
    const off = [];
    if (b.start_date && b.end_date) {
      for (let d = b.start_date, g = 0; d <= b.end_date && g < 800; d = crsAddDays(d, 1), g++) {
        if (!crsWeeklyOn(b, d, false)) continue;
        const hit = active.some(s => {
          if (s.session_date !== d) return false;
          const sp = spanOf(s); return crsContains(b, sp.start, sp.end);
        });
        if (!hit) off.push(d);
      }
    }
    const before = crsSplit(b.auto_off_dates);
    const now = off.join(',');
    if (now !== before.join(',')) {
      await crsPatch('sched_bookings', b.id, { auto_off_dates: now || null });
      out.released += off.filter(d => !before.includes(d)).length;
      b.auto_off_dates = now || null;
    }
  }

  // 3) 没被覆盖的单回
  const need = [];
  for (const s of active) {
    const sp = spanOf(s), d = s.session_date;
    if (weekly.some(b => crsWeeklyOn(b, d, false) && crsContains(b, sp.start, sp.end))) continue;
    if (keepTemps.some(t => t.booking_date === d && crsContains(t, sp.start, sp.end))) continue;
    if (weekly.some(b => crsSplit(b.manual_off_dates).includes(d))) continue;   // 人已处理过
    need.push({ s, sp, d });
  }
  if (!need.length) { out.notes.push('每一回都已有教室占用，无需处理'); return out; }
  if (!weekly.length) { out.notes.push(`有 ${need.length} 回没有占用（${need.map(x => x.d.slice(5)).join('、')}），但这门课没有「已确认」的每周教室占用，系统不知道用哪间，没处理`); return out; }
  const rooms = [...new Set(weekly.map(b => String(b.room_id == null ? '' : b.room_id)))];
  const accs = [...new Set(weekly.map(b => String(b.uses_meeting && b.meeting_account_id != null ? b.meeting_account_id : '')))];
  const tpl = weekly[0];
  const online = rooms.length === 1 && rooms[0] === '';
  const single = online ? accs.length === 1 && accs[0] !== '' : rooms.length === 1;
  // 同一合并组的课共用教室，不算冲突
  let ownIds = new Set([String(courseId)]);
  if (co.sched_merge_group) {
    try { (await crsGet('courses', `select=id&sched_merge_group=eq.${encodeURIComponent(co.sched_merge_group)}&limit=200`)).forEach(x => ownIds.add(String(x.id))); } catch (e) { /* 忽略 */ }
  }
  let roomName = '';
  if (single && !online) { try { const r = (await crsGet('sched_rooms', `select=name&id=eq.${encodeURIComponent(rooms[0])}&limit=1`))[0]; roomName = r ? r.name : ''; } catch (e) { /* 忽略 */ } }
  let pool = [];
  if (single) {
    const minD = need.reduce((m, x) => (x.d < m ? x.d : m), need[0].d);
    const q = online ? `meeting_account_id=eq.${encodeURIComponent(accs[0])}` : `room_id=eq.${encodeURIComponent(rooms[0])}`;
    pool = (await crsGet('sched_bookings', `select=*&${q}&status=neq.rejected&limit=5000`))
      .filter(b => !ownIds.has(String(b.course_id)) || b.kind !== 'course')
      .filter(b => b.recurrence === 'weekly' ? (!b.end_date || b.end_date >= minD) : (b.booking_date || '') >= minD);
    if (!online && tpl.uses_meeting && tpl.meeting_account_id != null) {
      const more = await crsGet('sched_bookings', `select=*&meeting_account_id=eq.${encodeURIComponent(tpl.meeting_account_id)}&status=neq.rejected&limit=5000`);
      more.filter(b => !ownIds.has(String(b.course_id)) || b.kind !== 'course').forEach(b => { if (!pool.some(p => p.id === b.id)) pool.push(b); });
    }
  }
  for (const { s, sp, d } of need) {
    const st = sp.start || crsT5(tpl.start_time), en = sp.end || crsT5(tpl.end_time);
    let reason = '', who = '';
    if (!single) reason = '这门课有好几间教室，分不出用哪间';
    else {
      const hit = pool.filter(b => crsOnDate(b, d) && crsOverlap(st, en, b.start_time, b.end_time) &&
        ((!online && String(b.room_id) === rooms[0]) || (tpl.uses_meeting && b.uses_meeting && String(b.meeting_account_id) === String(tpl.meeting_account_id))));
      if (hit.length) {
        reason = online ? '原会议账号当天被占' : `原教室 ${roomName || rooms[0]} 当天被占`;
        who = hit.map(b => `${b.title || b.entry_name || '占用'}（${b.user_name || '未填占用人'}，${crsT5(b.start_time)}-${crsT5(b.end_time)}，${b.recurrence === 'weekly' ? '每周固定' : '临时'}${b.status === 'pending' ? '，待批准' : ''}）`).join('、');
      }
    }
    if (reason) {
      const wrote = await crsRemind(co, s, d, { start: st, end: en }, reason);
      if (wrote) out.reminders++;
      out.notes.push(`${d.slice(5)}：${reason}${who ? '，被 ' + who + ' 占着' : ''}，${wrote ? '已写提醒' : (d < new Date().toISOString().slice(0, 10) ? '日期已过，不提醒' : '已有未处理的提醒')}`);
      continue;
    }
    await crsInsert('sched_bookings', {
      room_id: tpl.room_id, kind: 'course', course_id: tpl.course_id, title: tpl.title, user_name: tpl.user_name,
      recurrence: 'once', booking_date: d, start_time: st, end_time: en,
      uses_meeting: tpl.uses_meeting, meeting_account_id: tpl.meeting_account_id,
      status: 'confirmed', created_by: tpl.created_by || 'admin', entry_name: '单回改期自动占用', note: '单回改期自动占用',
      session_id: s.id, auto_sync: true,
    });
    out.created++;
    out.notes.push(`${d.slice(5)}：已占用`);
  }
  return out;
}

// 删除课程 / 移出排课时：只删它的自动临时占用（按周占用由原来的流程处理）
async function courseRoomClear(courseId) {
  const rows = await crsGet('sched_bookings', `select=id&kind=eq.course&auto_sync=is.true&course_id=eq.${encodeURIComponent(courseId)}&limit=2000`);
  for (const r of rows) await crsDelete('sched_bookings', r.id);
  return rows.length;
}

// 提醒还没补上时，查清楚是谁占着：返回文字行 [ '3A 当天被占：', '《xx》（某某，18:30-20:00，每周固定）' ]
async function courseRoomWhyBlocked(courseId, x) {
  const cid = encodeURIComponent(courseId);
  const co = (await crsGet('courses', `select=id,time_range,sched_merge_group&id=eq.${cid}&limit=1`))[0];
  const s = (await crsGet('course_sessions', `select=id,time_range&id=eq.${encodeURIComponent(x.session_id)}&limit=1`))[0];
  const own = await crsGet('sched_bookings', `select=*&kind=eq.course&course_id=eq.${cid}&recurrence=eq.weekly&limit=50`);
  const tpl = own.find(b => b.status === 'confirmed');
  if (!co || !tpl) return ['找不到这门课的原教室占用'];
  const sp = timeRangesSpan((s && s.time_range) || co.time_range || '');
  const st = sp.start || crsT5(tpl.start_time), en = sp.end || crsT5(tpl.end_time);
  const ownIds = new Set([String(courseId)]);
  if (co.sched_merge_group) { try { (await crsGet('courses', `select=id&sched_merge_group=eq.${encodeURIComponent(co.sched_merge_group)}&limit=200`)).forEach(v => ownIds.add(String(v.id))); } catch (e) { /* 忽略 */ } }
  let roomName = '原教室';
  if (tpl.room_id != null && tpl.room_id !== '') { try { const r = (await crsGet('sched_rooms', `select=name&id=eq.${encodeURIComponent(tpl.room_id)}&limit=1`))[0]; if (r) roomName = r.name; } catch (e) { /* 忽略 */ } }
  const q = tpl.room_id != null && tpl.room_id !== '' ? `room_id=eq.${encodeURIComponent(tpl.room_id)}` : `meeting_account_id=eq.${encodeURIComponent(tpl.meeting_account_id)}`;
  const hit = (await crsGet('sched_bookings', `select=*&${q}&status=neq.rejected&limit=5000`))
    .filter(b => !(ownIds.has(String(b.course_id)) && b.kind === 'course'))
    .filter(b => crsOnDate(b, x.date) && crsOverlap(st, en, b.start_time, b.end_time));
  if (!hit.length) return [];
  return [`${roomName} ${x.date.slice(5).replace('-', '/')} ${st}-${en} 被这些占着：`].concat(hit.map(b =>
    `${b.title || b.entry_name || '占用'}（${b.user_name || '未填占用人'}，${crsT5(b.start_time)}-${crsT5(b.end_time)}，${b.recurrence === 'weekly' ? '每周固定' : '临时'}${b.status === 'pending' ? '，待批准' : ''}）`));
}

// 调用方用：失败不阻断，只在控制台记一下
async function courseRoomSyncSafe(courseId) {
  let r = null;
  try { r = await courseRoomSync(courseId); } catch (e) { console.warn('单回教室核对失败', courseId, e); window.__crsLastError = e && e.message ? e.message : String(e); }
  // 管理端：这门课改期可能让出别的课等着的教室（不阻塞）
  if (CRS_ADMIN() && !CRS_RETRYING) courseRoomRetryPending().catch(() => {});
  return r;
}

// 空出教室后，替所有等着教室的课补占。返回补占天数。同一页面防重入。
let CRS_RETRYING = false;
async function courseRoomRetryPending() {
  if (CRS_RETRYING) return 0;
  CRS_RETRYING = true;
  let n = 0;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const logs = await crsGet('sched_change_log', 'select=changes&action=eq.session_room&order=created_at.desc&limit=500');
    const ids = [...new Set((logs || []).map(l => (l.changes || [])[0]).filter(x => x && !x.resolved_at && x.course_id && (x.date || '') >= today).map(x => String(x.course_id)))];
    for (const id of ids) { const r = await courseRoomSyncSafe(id); if (r) n += r.created || 0; }
  } catch (e) { console.warn('补占等待中的单回失败', e); }
  finally { CRS_RETRYING = false; }
  return n;
}

// 排课页面用：占用被删除 / 挪动 / 释放后，后台补占，有补占就回调 onFilled(天数)
function courseRoomWatchBookings(onFilled) {
  const KEYS = ['booking_date', 'start_time', 'end_time', 'room_id', 'status', 'manual_off_dates', 'end_date'];
  let timer = null;
  const kick = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => { const n = await courseRoomRetryPending(); if (n && onFilled) onFilled(n); }, 800);
  };
  const od = window.sbDelete, ou = window.sbUpdate;
  window.sbDelete = async function (table, id) { const r = await od.apply(this, arguments); if (table === 'sched_bookings' && !CRS_RETRYING) kick(); return r; };
  window.sbUpdate = async function (table, id, patch) { const r = await ou.apply(this, arguments); if (table === 'sched_bookings' && !CRS_RETRYING && patch && KEYS.some(k => k in patch)) kick(); return r; };
}
