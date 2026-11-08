// 管理端「课程安排」改单回后：弹框只做检查——新日子这门课用的教室（线上课还有会议账号）空不空，被占就能一键通知总务（只给管理端用，不引用 sched/ 下任何文件）
// 依赖：shared/supabase.js（sb）、shared/constants.js（timeRangesSpan）、shared/course-confirm.js（ccOverlay / CC_BOX / ccEsc / ccMD / CC_WD）
//
// 规则：
//   · 排课已经直接读管理端单回的日期和时间，所以这里不再释放、不再建临时占用、不再撤销
//   · 弹框里唯一的写入：点「通知总务」往 sched_change_log 写一条 action='room_coord'（同一回同一天不重复写）
//   · 空不空的判断：课程占用按那门课当天有没有单回（和单回自己的时间）；临时占用按日期；manual_off_dates、rejected 排除；不算这门课自己

const srmT5 = t => String(t || '').slice(0, 5);
const srmSplit = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const srmOverlap = (aS, aE, bS, bE) => srmT5(aS) < srmT5(bE) && srmT5(bS) < srmT5(aE);
function srmWeekday(d) { const w = new Date(d + 'T12:00:00').getDay(); return w === 0 ? 7 : w; }
function srmMDW(d) { return `${ccMD(d)}（${CC_WD[new Date(d + 'T12:00:00').getDay()]}）`; }
function srmSpan(tr, courseTr) { const sp = timeRangesSpan(tr || courseTr || ''); return { start: sp.start || '', end: sp.end || '' }; }
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
  const wc = [...new Set(rows.filter(b => b.kind === 'course' && b.recurrence === 'weekly' && b.course_id).map(b => String(b.course_id)))];
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

// opts: { course, changes:[{ id, num, from:{date,time,cancelled}|null, to:{date,time,cancelled} }], sessions:[该课现在全部单回] }
// 返回 Promise：窗口关掉后 resolve（不抛错）
async function srmOpen(opts) {
  const course = opts.course || {};
  const changes = (opts.changes || []).filter(c => c && c.to && !c.to.cancelled);
  if (!course.id || !changes.length) return;
  let bks, rooms = [], accts = [];
  try {
    bks = ((await srmGet(`/rest/v1/sched_bookings?kind=eq.course&course_id=eq.${encodeURIComponent(course.id)}&select=*`)) || []).filter(b => b.status === 'confirmed' && b.recurrence === 'weekly');
    const rids = [...new Set(bks.map(b => b.room_id).filter(v => v != null && v !== ''))];
    if (rids.length) rooms = (await srmGet(`/rest/v1/sched_rooms?id=in.(${rids.map(encodeURIComponent).join(',')})&select=id,name`)) || [];
    const aids = [...new Set(bks.filter(b => b.uses_meeting && b.meeting_account_id != null && b.meeting_account_id !== '').map(b => b.meeting_account_id))];
    if (aids.length) accts = (await srmGet(`/rest/v1/sched_meeting_accounts?id=in.(${aids.map(encodeURIComponent).join(',')})&select=id,name`)) || [];
  } catch (e) { console.warn('读取教室占用失败', e); return; }
  const roomName = id => { const r = rooms.find(x => String(x.id) === String(id)); return r ? r.name : '教室'; };
  const acctName = id => { const a = accts.find(x => String(x.id) === String(id)); return a ? (a.name || '会议账号') : '会议账号'; };
  const withRoom = bks.filter(b => b.room_id != null && b.room_id !== '');

  // ── 每一回：用哪间教室 / 哪个会议账号，空不空 ──
  const rows = [];
  for (const ch of changes) {
    const f = ch.from, t = ch.to;
    const sp = srmSpan(t.time);
    const row = { ch, sp, checks: [], note: '', key: `${course.id}|${ch.id}|${t.date}` };
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

  await new Promise(resolve => {
    const ov = ccOverlay('srmOv');
    const e = ccEsc;
    const notified = new Set();
    const problems = r => r.checks.filter(c => c.none || (c.blockers && c.blockers.length));
    const close = () => { ov.remove(); delete window.__srmNotify; delete window.__srmNotifyAll; resolve(); };
    const who = () => (typeof ADMIN_EMAIL !== 'undefined' && ADMIN_EMAIL) ? ADMIN_EMAIL : '管理员';

    // 写一条 room_coord；同一回同一天已有没处理的就不再写
    const notifyOne = async r => {
      if (notified.has(r.key)) return;
      const pr = problems(r)[0]; if (!pr) return;
      const t = r.ch.to;
      const blocker = pr.none ? '' : pr.blockers.map(x => `《${x.title}》（${x.who || '—'}，${x.time}）`).join('、');
      const change = {
        field: 'room_coord', label: `第 ${r.ch.num || '?'} 回`, num: r.ch.num || null, session_id: r.ch.id, course_uuid: course.id,
        from: r.ch.from ? `${r.ch.from.date} ${r.ch.from.time || ''}`.trim() : '（新增）', to: `${t.date} ${r.sp.start ? r.sp.start + '-' + r.sp.end : ''}`.trim(),
        date: t.date, time: r.sp.start ? `${r.sp.start}-${r.sp.end}` : '', room_name: pr.none ? '' : pr.label, blocker, reason: pr.none ? 'no_room' : 'blocked'
      };
      let dup = false;
      try {
        const old = (await srmGet(`/rest/v1/sched_change_log?action=eq.room_coord&course_name=eq.${encodeURIComponent(course.merge_name || course.name || '')}&select=id,changes,acked_by&order=created_at.desc&limit=100`)) || [];
        dup = old.some(l => !String(l.acked_by || '').trim() && Array.isArray(l.changes) && l.changes.some(x => x && x.session_id === r.ch.id && x.date === t.date));
      } catch (er) { /* 查不到就照写 */ }
      if (!dup) {
        await sb('/rest/v1/sched_change_log', 'POST', [{
          course_id: course.legacy_sched_id != null ? course.legacy_sched_id : null, course_name: course.merge_name || course.name || '',
          actor_role: 'admin', actor_label: who(), action: 'room_coord', changes: [change], acked_by: ''
        }]);
      }
      notified.add(r.key);
    };
    let err = '';
    window.__srmNotify = async i => { try { err = ''; await notifyOne(rows[i]); } catch (er) { err = '通知失败：' + (er.message || er); } draw(); };
    window.__srmNotifyAll = async () => {
      err = '';
      for (const r of rows) { try { await notifyOne(r); } catch (er) { err = '通知失败：' + (er.message || er); break; } }
      draw();
    };

    const draw = () => {
      const body = rows.map((r, i) => {
        const f = r.ch.from, t = r.ch.to;
        const a = f ? srmMDW(f.date) : '新增';
        const b = srmMDW(t.date) + (r.sp.start ? `${r.sp.start}-${r.sp.end}` : '');
        const head = `${r.ch.num ? '第 ' + e(r.ch.num) + ' 回　' : ''}${e(a)} → ${e(b)}`;
        const pr = problems(r);
        let lines;
        if (r.note) lines = `<div style="color:#7a5b00">${e(r.note)}</div>`;
        else lines = r.checks.map(c => {
          if (c.none) return `<div><span style="color:#a33">还没排教室</span></div>`;
          if (c.blockers && c.blockers.length) { const x = c.blockers[0]; return `<div>${e(c.label)}　<span style="color:#a33">✗ 被《${e(x.title)}》（${e(x.who || '—')}，${e(x.time)}）占着${c.blockers.length > 1 ? ' 等' + c.blockers.length + '处' : ''}</span></div>`; }
          return `<div>${e(c.label)}　<span style="color:#2a7a3a">✓ 空着</span>${c.err ? '（检查失败，仅供参考）' : ''}</div>`;
        }).join('');
        const btn = pr.length ? (notified.has(r.key) ? '<span style="color:#2a7a3a;white-space:nowrap">已通知 ✓</span>' : `<button type="button" class="btn btn-outline btn-sm" style="padding:2px 10px;cursor:pointer;white-space:nowrap" onclick="__srmNotify(${i})">通知总务</button>`) : '';
        return `<div style="border-bottom:1px solid var(--border-light,#eee);padding:6px 0;display:flex;gap:10px;align-items:flex-start"><div style="flex:1;min-width:0"><div style="font-weight:600">${head}</div>${lines}</div>${btn}</div>`;
      }).join('');
      const todo = rows.filter(r => problems(r).length && !notified.has(r.key)).length;
      ov.innerHTML = `<div style="${CC_BOX}"><div style="padding:14px 18px;border-bottom:1px solid var(--border,#e2ded6);font-size:15px;font-weight:600">这几回的教室检查</div><div style="padding:12px 18px;overflow:auto;flex:1">${body}${err ? `<div style="color:#a33;margin-top:6px">${e(err)}</div>` : ''}</div><div style="padding:10px 18px;border-top:1px solid var(--border,#e2ded6);display:flex;gap:8px;justify-content:flex-end;align-items:center"><span style="flex:1"></span>${todo ? '<button type="button" class="btn btn-outline btn-sm" style="padding:6px 16px;cursor:pointer" onclick="__srmNotifyAll()">全部通知总务</button>' : ''}<button type="button" id="srmClose" class="btn btn-primary btn-sm" style="padding:6px 16px;cursor:pointer">关闭</button></div></div>`;
      ov.querySelector('#srmClose').onclick = close;
    };
    draw();
  });
}
