// 每门课每一回在哪个教室（只读）＋「换教室」教室列表（排课和管理端共用）＋换教室的写入（管理端用）
// 依赖：shared/supabase.js（sb / sbAll）。排课页只用其中不依赖 sb 的纯函数（crvRoomPickHtml）。
// 规则：每周占用（kind=course, recurrence=weekly）= 固定教室；临时占用（recurrence=once）= 那一回换了教室。
//       临时占用只在「这门课那天真的有没取消的单回」时才算数（跟排课「直接读管理端课程」一致）。
const CRV = { bks: [], rooms: {}, roomList: [], loaded: false };
const crvEsc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const crvT5 = t => String(t || '').slice(0, 5);
const crvWd = d => { const w = new Date(d + 'T12:00:00').getDay(); return w === 0 ? 7 : w; };
const crvWdName = ['日', '一', '二', '三', '四', '五', '六'];
const crvMD = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const crvMDW = d => `${crvMD(d)}（${crvWdName[new Date(d + 'T12:00:00').getDay()]}）`;
const crvOverlap = (aS, aE, bS, bE) => crvT5(aS) < crvT5(bE) && crvT5(bS) < crvT5(aE);
const crvSplit = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
function crvAddDays(d, n) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
function crvToday() { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; }

// courseIds 不传 = 读所有课的占用
async function crvLoad(courseIds) {
  let bks = [];
  const sel = 'id,course_id,room_id,recurrence,weekday,booking_date,start_time,end_time,manual_off_dates,status,uses_meeting,meeting_account_id,title,user_name,created_by';
  const base = '/rest/v1/sched_bookings?kind=eq.course&status=neq.rejected&select=' + sel;
  if (courseIds && courseIds.length) {
    const ids = [...new Set(courseIds.map(String))];
    for (let i = 0; i < ids.length; i += 40) bks = bks.concat(await sbAll(`${base}&course_id=in.(${ids.slice(i, i + 40).map(encodeURIComponent).join(',')})`, { cache: 'no-store' }));
  } else bks = await sbAll(base, { cache: 'no-store' });
  const rooms = await sbAll('/rest/v1/sched_rooms?select=id,name,campus,capacity,active,sort&order=campus,sort', { cache: 'no-store' });
  CRV.bks = bks; CRV.roomList = rooms; CRV.rooms = {}; rooms.forEach(r => { CRV.rooms[String(r.id)] = r; });
  CRV.loaded = true;
}
function crvRoomLabel(id) {
  if (id == null || id === '') return '线上';
  const r = CRV.rooms[String(id)]; if (!r) return '教室';
  return ((r.campus || '') + ' ' + (r.name || '')).trim();
}
const crvWeekly = courseId => CRV.bks.filter(b => String(b.course_id) === String(courseId) && b.recurrence === 'weekly');
const crvOnce = courseId => CRV.bks.filter(b => String(b.course_id) === String(courseId) && b.recurrence === 'once');
// 固定教室的文字：「高马 C」；好几间 =「高马 C（周六）/ 市谷 3A（周日）」；没排 = ''
function crvFixed(courseId, course) {
  const w = crvWeekly(courseId);
  if (!w.length) return (course && course.delivery === '线上') ? '线上' : '';
  const keyOf = b => String(b.room_id == null ? '' : b.room_id);
  const distinct = [...new Set(w.map(keyOf))];
  if (distinct.length === 1) return crvRoomLabel(w[0].room_id);
  const seen = new Set(), out = [];
  w.slice().sort((a, b) => Number(a.weekday) - Number(b.weekday)).forEach(b => {
    const k = keyOf(b) + '|' + b.weekday; if (seen.has(k)) return; seen.add(k);
    out.push(`${crvRoomLabel(b.room_id)}（周${crvWdName[Number(b.weekday) % 7]}）`);
  });
  return out.join(' / ');
}
function crvFixedRoomIds(courseId) { return new Set(crvWeekly(courseId).map(b => String(b.room_id == null ? '' : b.room_id))); }
// 这一天这门课用的每周占用（星期对得上优先；单回改到别的星期时算第一条）；那天被人工释放的不算
function crvPickWeekly(courseId, date) {
  const w = crvWeekly(courseId).filter(b => !crvSplit(b.manual_off_dates).includes(date));
  return w.find(b => Number(b.weekday) === crvWd(date)) || (w.length ? w[0] : null);
}
// 这一回实际在哪个教室：{ roomId, label, changed } 或 { none:true }；session 要有 session_date，休讲的回返回 { cancelled:true }
function crvRoomOn(courseId, session) {
  if (!session || session.is_cancelled) return { cancelled: true };
  const d = session.session_date;
  const t = crvOnce(courseId).find(b => b.booking_date === d);
  if (t) return { roomId: t.room_id, label: crvRoomLabel(t.room_id), changed: true, bk: t };
  const w = crvPickWeekly(courseId, d);
  if (w) return { roomId: w.room_id, label: crvRoomLabel(w.room_id), changed: false, bk: w };
  return { none: true };
}
// 某回相对固定教室的状态：'' 一样 / 'moved' 换了 / 'none' 没教室
function crvSessionState(courseId, session, course) {
  const r = crvRoomOn(courseId, session);
  if (r.cancelled) return { kind: '' };
  const has = crvWeekly(courseId).length > 0;
  if (r.none) return has ? { kind: 'none', r } : { kind: '' };
  if (r.changed && !crvFixedRoomIds(courseId).has(String(r.roomId == null ? '' : r.roomId))) return { kind: 'moved', r, label: r.label };
  return { kind: '', r };
}
// 今天以后的所有变动 [{ session, kind:'moved'|'none', label }]
function crvChangesFor(courseId, sessions, course, fromDate) {
  const from = fromDate || crvToday();
  return (sessions || []).filter(s => s && !s.is_cancelled && s.session_date >= from)
    .sort((a, b) => a.session_date.localeCompare(b.session_date))
    .map(s => ({ session: s, st: crvSessionState(courseId, s, course) })).filter(x => x.st.kind)
    .map(x => ({ session: x.session, kind: x.st.kind, label: x.st.label || '' }));
}

/* ───── 换教室：教室列表（纯 HTML，排课和管理端共用） ─────
   rows: [{ room:{id,name,campus,capacity}, blockers:[{title,who,time}] }]；curRoomId：现在用的那间
   空教室带 data-room，调用方自己绑点击。 */
function crvRoomPickHtml(rows, curRoomId) {
  const e = crvEsc;
  const camps = [...new Set(rows.map(x => x.room.campus || ''))];
  return camps.map(cp => `<div style="margin-top:6px"><span style="font-size:12px;color:#888">${e(cp || '未分校区')}</span><div>` + rows.filter(x => (x.room.campus || '') === cp).map(({ room: r, blockers: bl }) => {
    const nm = e(r.name) + (r.capacity ? `（${r.capacity}人）` : '');
    const base = 'display:inline-block;margin:3px;padding:4px 10px;border-radius:14px;font-size:12px;border:1px solid #ddd;';
    if (curRoomId != null && curRoomId !== '' && String(r.id) === String(curRoomId)) return `<span style="${base}background:#eee;color:#888">${nm} · 现在用</span>`;
    if (bl && bl.length) return `<span style="${base}background:#f1f1f1;color:#999">${nm} <small>被${e(bl.map(x => `《${x.title || '占用'}》（${x.who || '—'}，${x.time}）`).join('、'))}占</small></span>`;
    return `<span data-room="${e(r.id)}" style="${base}cursor:pointer;background:#fff;color:#222">✓ ${nm}</span>`;
  }).join('') + '</div></div>').join('');
}

/* ───── 以下用 sb，只给管理端 ───── */
const CRV_MEMO = {};
// 某天某时段：每间教室被谁占（不算 excludeCourseId 这门课自己）。返回 rows 给 crvRoomPickHtml
async function crvRoomStatus(date, sp, excludeCourseId) {
  const memo = CRV_MEMO.base && Date.now() - CRV_MEMO.at < 30000 ? CRV_MEMO.base : null;
  const base = memo || await (async () => {
    const rooms = (await sbAll('/rest/v1/sched_rooms?select=id,name,campus,capacity,active,sort,meeting_account_id&order=campus,sort', { cache: 'no-store' })).filter(r => r.active !== false);
    const bks = await sbAll(`/rest/v1/sched_bookings?status=neq.rejected&room_id=not.is.null&or=(recurrence.eq.weekly,booking_date.gte.${crvAddDays(crvToday(), -1)})&select=id,kind,course_id,room_id,recurrence,booking_date,weekday,start_date,end_date,manual_off_dates,start_time,end_time,title,user_name`, { cache: 'no-store' });
    return CRV_MEMO.base = { rooms, bks }, CRV_MEMO.at = Date.now(), CRV_MEMO.base;
  })();
  const sess = {}, hasData = new Set();
  try {
    (await sbAll(`/rest/v1/course_sessions?session_date=gte.${crvAddDays(date, -45)}&session_date=lte.${crvAddDays(date, 45)}&select=course_id,session_date,time_range,is_cancelled`, { cache: 'no-store' })).forEach(x => {
      hasData.add(String(x.course_id)); if (x.session_date === date && !x.is_cancelled) sess[String(x.course_id)] = x.time_range || '';
    });
  } catch (er) { /* 读不到就按记录算 */ }
  const validOnce = new Set();      // 那天真有单回（或没有单回数据的老课）的临时占用
  base.bks.forEach(b => { if (b.kind === 'course' && b.recurrence === 'once' && b.booking_date === date && b.course_id) { const c = String(b.course_id); if (!hasData.has(c) || c in sess) validOnce.add(c); } });
  const ruleOk = (b, d) => !(b.start_date && d < b.start_date) && !(b.end_date && d > b.end_date) && Number(b.weekday) === crvWd(d);
  const blockersOf = roomId => {
    const out = [];
    base.bks.filter(b => String(b.room_id) === String(roomId) && !(b.course_id && excludeCourseId != null && String(b.course_id) === String(excludeCourseId))).forEach(b => {
      let s = b.start_time, e = b.end_time;
      if (b.recurrence === 'weekly') {
        if (crvSplit(b.manual_off_dates).includes(date)) return;
        if (b.kind === 'course' && b.course_id) {
          const c = String(b.course_id);
          if (validOnce.has(c)) return;
          if (hasData.has(c)) { if (!(c in sess)) return; const m = String(sess[c]).match(/\d{1,2}:\d{2}/g); if (m && m.length >= 2) { s = m[0]; e = m[m.length - 1]; } }
          else if (!ruleOk(b, date)) return;
        } else if (!ruleOk(b, date)) return;
      } else {
        if (b.booking_date !== date) return;
        if (b.kind === 'course' && b.course_id && !validOnce.has(String(b.course_id))) return;
      }
      if (crvOverlap(sp.start, sp.end, s, e)) out.push({ title: b.title || '', who: b.user_name || '', time: `${crvT5(s)}-${crvT5(e)}` });
    });
    return out;
  };
  return base.rooms.map(r => ({ room: r, blockers: blockersOf(r.id) }));
}
// 把这门课这一回（date）换到 toRoom：已有临时占用 → 改过去；没有 → 新建一条临时占用并在每周占用那天记 manual_off_dates
// o: { courseId, date, sp:{start,end}, toRoom:{id,meeting_account_id}, entryName }；返回撤销用的步骤
async function crvSwapRoom(o) {
  const bks = (await sb(`/rest/v1/sched_bookings?kind=eq.course&course_id=eq.${encodeURIComponent(o.courseId)}&status=neq.rejected&select=*`, 'GET', null, { cache: 'no-store' })) || [];
  const r = o.toRoom, undo = [];
  const um = tpl => ({ uses_meeting: !!r.meeting_account_id && !!tpl.uses_meeting, meeting_account_id: (tpl.uses_meeting && r.meeting_account_id) || null });
  const temp = bks.find(b => b.recurrence === 'once' && b.booking_date === o.date);
  if (temp) {
    await sb(`/rest/v1/sched_bookings?id=eq.${temp.id}`, 'PATCH', Object.assign({ room_id: r.id }, um(temp)));
    undo.push({ upd: temp.id, patch: { room_id: temp.room_id, uses_meeting: temp.uses_meeting, meeting_account_id: temp.meeting_account_id } });
  } else {
    const wk = bks.filter(b => b.recurrence === 'weekly' && !crvSplit(b.manual_off_dates).includes(o.date));
    const chosen = wk.find(b => Number(b.weekday) === crvWd(o.date)) || wk[0] || null;
    if (chosen) {
      const a = crvSplit(chosen.manual_off_dates); a.push(o.date);
      await sb(`/rest/v1/sched_bookings?id=eq.${chosen.id}`, 'PATCH', { manual_off_dates: a.sort().join(',') });
      undo.push({ upd: chosen.id, patch: { manual_off_dates: chosen.manual_off_dates || null } });
    }
    const tpl = chosen || bks[0] || {};
    const ins = await sb('/rest/v1/sched_bookings', 'POST', [Object.assign({
      room_id: r.id, kind: 'course', course_id: o.courseId, title: tpl.title || '', user_name: tpl.user_name || null,
      recurrence: 'once', booking_date: o.date, start_time: o.sp.start, end_time: o.sp.end
    }, um(tpl), { status: 'confirmed', created_by: tpl.created_by || 'admin', entry_name: o.entryName || '课程安排改单回', note: o.entryName || '课程安排改单回', auto_sync: false })]);
    if (ins && ins[0]) undo.push({ del: ins[0].id });
  }
  delete CRV_MEMO.base;
  return undo;
}
