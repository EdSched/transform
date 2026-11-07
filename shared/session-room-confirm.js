// 管理端「课程安排」改单回后：弹框让人确认这几回的教室要不要跟着调整（只给管理端用，不引用 sched/ 下任何文件）
// 依赖：shared/supabase.js（sb）、shared/constants.js（timeRangesSpan）、shared/course-confirm.js（ccOverlay / CC_BOX / ccEsc / ccMD / CC_WD）
//
// 规则：
//   · 只处理这次改动的那几回；人点「确认」才写；点「先不处理」/ 关掉 = 什么都不写
//   · 不改每周占用的 start_time / end_time / weekday / room_id / start_date / end_date / status
//   · 释放某一天 = 往每周占用的 manual_off_dates 里加这一天；新的日子 = 建一条临时占用（recurrence='once'）
//   · 不使用 auto_off_dates，不在后台 / 打开页面时跑

const SRM_NOTE = '课程安排改单回';
const srmT5 = t => String(t || '').slice(0, 5);
const srmSplit = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const srmOverlap = (aS, aE, bS, bE) => srmT5(aS) < srmT5(bE) && srmT5(bS) < srmT5(aE);
const srmContains = (b, s, e) => !s || !e || (srmT5(b.start_time) <= srmT5(s) && srmT5(b.end_time) >= srmT5(e));
function srmWeekday(d) { const w = new Date(d + 'T12:00:00').getDay(); return w === 0 ? 7 : w; }
function srmMDW(d) { return `${ccMD(d)}（${CC_WD[new Date(d + 'T12:00:00').getDay()]}）`; }
function srmSpan(tr, courseTr) { const sp = timeRangesSpan(tr || courseTr || ''); return { start: sp.start || '', end: sp.end || '' }; }
function srmTxt(date, sp) { return srmMDW(date) + (sp.start ? `${sp.start}-${sp.end}` : ''); }
// 每周占用在 d 这天算不算占着（不看 status：调用方自己筛）
function srmWeeklyOn(b, d) {
  if (b.recurrence !== 'weekly') return false;
  if (b.start_date && d < b.start_date) return false;
  if (b.end_date && d > b.end_date) return false;
  if (Number(b.weekday) !== srmWeekday(d)) return false;
  return !srmSplit(b.manual_off_dates).includes(d);
}
const srmOn = (b, d) => b.recurrence === 'weekly' ? srmWeeklyOn(b, d) : b.booking_date === d;
const srmGet = path => sb(path, 'GET', null, { cache: 'no-store' });

// 这门课现有的每周占用时间（给「课程整体改了上课时间」的提示用）。读不到返回 []
async function srmWeeklyTimes(courseId) {
  try {
    const rows = (await srmGet(`/rest/v1/sched_bookings?kind=eq.course&recurrence=eq.weekly&status=eq.confirmed&course_id=eq.${encodeURIComponent(courseId)}&select=start_time,end_time`)) || [];
    return [...new Set(rows.map(b => `${srmT5(b.start_time)}-${srmT5(b.end_time)}`))];
  } catch (e) { return []; }
}

// 只查这一间、这一天：返回占着的人 [{ b, title, who, time }]
async function srmBlockers(roomId, date, sp) {
  const rows = (await srmGet(`/rest/v1/sched_bookings?room_id=eq.${encodeURIComponent(roomId)}&status=neq.rejected&or=(booking_date.eq.${date},recurrence.eq.weekly)&select=id,recurrence,booking_date,weekday,start_date,end_date,manual_off_dates,start_time,end_time,title,user_name,status`)) || [];
  return rows.filter(b => srmOn(b, date) && srmOverlap(sp.start, sp.end, b.start_time, b.end_time))
    .map(b => ({ b, title: b.title || '', who: b.user_name || '', time: `${srmT5(b.start_time)}-${srmT5(b.end_time)}` }));
}

// opts: { course, changes:[{ id, num, from:{date,time,cancelled}|null, to:{date,time,cancelled} }], sessions:[该课现在全部单回] }
// 返回 Promise：窗口关掉后 resolve（有没有执行都 resolve，不抛错）
async function srmOpen(opts) {
  const course = opts.course || {};
  const changes = (opts.changes || []).filter(Boolean);
  if (!course.id || !changes.length) return;
  let bks, rooms;
  try {
    bks = ((await srmGet(`/rest/v1/sched_bookings?kind=eq.course&course_id=eq.${encodeURIComponent(course.id)}&select=*`)) || []).filter(b => b.status === 'confirmed');
    const rids = [...new Set(bks.map(b => b.room_id).filter(v => v != null && v !== ''))];
    rooms = rids.length ? ((await srmGet(`/rest/v1/sched_rooms?id=in.(${rids.map(encodeURIComponent).join(',')})&select=id,name`)) || []) : [];
  } catch (e) { console.warn('读取教室占用失败', e); return; }
  const roomName = id => { const r = rooms.find(x => String(x.id) === String(id)); return r ? r.name : '教室'; };
  const weeklyRooms = [...new Set(bks.filter(b => b.recurrence === 'weekly').map(b => String(b.room_id)))];
  const allSess = (opts.sessions || []).filter(s => !s.is_cancelled);

  // ── 先算每一回有哪些项 ──
  const blocks = [];
  const relKeys = new Set();   // 同一条每周占用同一天只释放一次
  for (const ch of changes) {
    const blk = { ch, items: [], notes: [] };
    const f = ch.from, t = ch.to;
    const fsp = f ? srmSpan(f.time) : null, tsp = t ? srmSpan(t.time) : null;
    const toLive = t && !t.cancelled;
    // 原来的日子：释放
    if (f && !f.cancelled) {
      const otherOnDay = allSess.some(s => s.id !== ch.id && s.session_date === f.date);
      const stillCovered = toLive && t.date === f.date;   // 同一天改时间：新时间被原占用包住就不用释放
      const hitW = bks.find(b => b.recurrence === 'weekly' && srmWeeklyOn(b, f.date) && srmOverlap(fsp.start, fsp.end, b.start_time, b.end_time));
      const hitO = bks.find(b => b.recurrence === 'once' && b.booking_date === f.date && srmOverlap(fsp.start, fsp.end, b.start_time, b.end_time));
      if (!otherOnDay) {
        if (hitW && !(stillCovered && srmContains(hitW, tsp.start, tsp.end))) {
          const key = hitW.id + '|' + f.date;
          if (!relKeys.has(key)) { relKeys.add(key); blk.items.push({ kind: 'off', b: hitW, date: f.date, on: true, label: `释放 ${srmMDW(f.date)}${fsp.start ? fsp.start + '-' + fsp.end : ''} 的 ${roomName(hitW.room_id)} 教室（每周占用）` }); }
        } else if (hitO && !(stillCovered && srmContains(hitO, tsp.start, tsp.end))) {
          blk.items.push({ kind: 'del', b: hitO, date: f.date, on: true, label: `删除 ${srmMDW(f.date)} 的临时占用（${roomName(hitO.room_id)}）` });
        }
      }
    }
    // 新的日子：临时占用
    if (toLive) {
      const covered = bks.some(b => srmOn(b, t.date) && srmContains(b, tsp.start, tsp.end));
      if (!tsp.start) blk.notes.push('这一回没有上课时间，不能判断教室，请到排课安排');
      else if (!covered) {
        if (!weeklyRooms.length) blk.notes.push('这门课没有每周占用，不能确定用哪间教室，请到排课安排');
        else {
          const fromW = f && bks.find(b => b.recurrence === 'weekly' && srmOn(b, f.date) && srmOverlap(fsp.start, fsp.end, b.start_time, b.end_time));
          const fromO = f && bks.find(b => b.recurrence === 'once' && b.booking_date === f.date && srmOverlap(fsp.start, fsp.end, b.start_time, b.end_time));
          const dflt = String((fromW || fromO || {}).room_id || weeklyRooms[0]);
          blk.items.push({ kind: 'new', date: t.date, sp: tsp, room: weeklyRooms.includes(dflt) ? dflt : weeklyRooms[0], on: true, label: '' });
        }
      }
    }
    if (blk.items.length || blk.notes.length) blocks.push(blk);
  }
  if (!blocks.some(b => b.items.length)) return;   // 没有可做的事就不弹

  // 每个「新日子」按所选教室查冲突（缓存 房间|日期）
  const cache = new Map();
  const blockersOf = async it => {
    const k = it.room + '|' + it.date;
    if (!cache.has(k)) cache.set(k, await srmBlockers(it.room, it.date, it.sp));
    return cache.get(k);
  };

  await new Promise(resolve => {
    const ov = ccOverlay('srmOv');
    let busy = false, done = null, undone = false;
    const e = ccEsc;
    const allItems = () => blocks.flatMap(b => b.items);
    // 这一项被谁占着；被「已勾选的释放项」释放掉的每周占用不算
    const realBlockers = it => (it.blockers || []).filter(x => !allItems().some(o => o.kind === 'off' && o.on && o.b.id === x.b.id && o.date === it.date));
    const free = it => realBlockers(it).length === 0;
    const close = () => { ov.remove(); delete window.__srmToggle; delete window.__srmRoom; resolve(); };

    const draw = () => {
      const head = ch => {
        const f = ch.from, t = ch.to;
        const a = f ? srmTxt(f.date, srmSpan(f.time)) : '新增';
        const b = t.cancelled ? (t.removed ? '删除' : '休讲') : srmTxt(t.date, srmSpan(t.time));
        return `${ch.num ? '第 ' + e(ch.num) + ' 回　' : ''}${e(a)}　→　${e(b)}`;
      };
      const row = (bi, ii, it) => {
        if (it.kind === 'new') {
          const bl = realBlockers(it);
          const roomChips = weeklyRooms.length > 1 ? `　${weeklyRooms.map(r => `<span class="filter-chip${String(it.room) === r ? ' active' : ''}" onclick="__srmRoom(${bi},${ii},'${e(r)}')" style="cursor:pointer;font-size:11px;padding:2px 8px">${e(roomName(r))}</span>`).join('')}` : '';
          const txt = `${e(srmMDW(it.date))}${e(it.sp.start)}-${e(it.sp.end)} 临时占用 ${e(roomName(it.room))}`;
          if (bl.length) {
            const x = bl[0];
            return `<div style="padding:4px 8px;margin:3px 0;border:1px solid var(--border,#e2ded6);border-radius:3px;color:#999"><div>${txt}${roomChips}</div><div style="color:#a33;font-size:11px">被《${e(x.title)}》（${e(x.who || '—')}，${e(x.time)}）占着，请到排课另找教室</div></div>`;
          }
          return `<div style="padding:4px 8px;margin:3px 0;border:1px solid ${it.on ? '#b8953a' : 'var(--border,#e2ded6)'};background:${it.on ? '#faf3e0' : 'transparent'};border-radius:3px"><span onclick="__srmToggle(${bi},${ii})" style="cursor:pointer">${it.on ? '✓ ' : '○ '}${txt}　<span style="color:#2a7a3a">当天空着</span></span>${roomChips}</div>`;
        }
        return `<div onclick="__srmToggle(${bi},${ii})" style="cursor:pointer;padding:4px 8px;margin:3px 0;border:1px solid ${it.on ? '#b8953a' : 'var(--border,#e2ded6)'};background:${it.on ? '#faf3e0' : 'transparent'};border-radius:3px">${it.on ? '✓ ' : '○ '}${e(it.label)}</div>`;
      };
      let body;
      if (done) {
        body = `<div style="margin-bottom:6px">${undone ? '已撤销刚才的操作。' : '已处理：'}</div>` + done.map(l => `<div style="padding:2px 0">${l}</div>`).join('');
      } else {
        body = blocks.map((blk, bi) => `<div style="border-bottom:1px solid var(--border-light,#eee);padding:6px 0"><div style="font-weight:600">${head(blk.ch)}</div>${blk.items.map((it, ii) => row(bi, ii, it)).join('')}${blk.notes.map(n => `<div style="color:#7a5b00;font-size:11px">${e(n)}</div>`).join('')}</div>`).join('');
      }
      const foot = done
        ? `${!undone && done.undo ? '<button type="button" id="srmUndo" class="btn btn-outline btn-sm" style="padding:6px 16px;cursor:pointer">撤销刚才的操作</button>' : ''}<button type="button" id="srmClose" class="btn btn-primary btn-sm" style="padding:6px 16px;cursor:pointer">关闭</button>`
        : `<span style="flex:1"><button type="button" id="srmAll" class="btn btn-outline btn-sm" style="padding:3px 10px;cursor:pointer">全部勾上</button> <button type="button" id="srmNone" class="btn btn-outline btn-sm" style="padding:3px 10px;cursor:pointer">全部取消</button></span><button type="button" id="srmSkip" class="btn btn-outline btn-sm" style="padding:6px 16px;cursor:pointer">先不处理</button><button type="button" id="srmOk" class="btn btn-primary btn-sm" style="padding:6px 16px;cursor:pointer"${busy ? ' disabled' : ''}>${busy ? '处理中…' : '确认'}</button>`;
      ov.innerHTML = `<div style="${CC_BOX}"><div style="padding:14px 18px;border-bottom:1px solid var(--border,#e2ded6);font-size:15px;font-weight:600">${done ? '教室处理结果' : '这几回的教室要不要跟着调整？'}</div><div style="padding:12px 18px;overflow:auto;flex:1">${body}</div><div style="padding:10px 18px;border-top:1px solid var(--border,#e2ded6);display:flex;gap:8px;justify-content:flex-end;align-items:center">${foot}</div></div>`;
      const $ = id => ov.querySelector(id);
      if (done) { $('#srmClose').onclick = close; if ($('#srmUndo')) $('#srmUndo').onclick = undo; return; }
      $('#srmSkip').onclick = close;
      $('#srmAll').onclick = () => { allItems().forEach(it => { if (it.kind !== 'new') it.on = true; }); allItems().forEach(it => { if (it.kind === 'new' && free(it)) it.on = true; }); draw(); };
      $('#srmNone').onclick = () => { allItems().forEach(it => { it.on = false; }); draw(); };
      $('#srmOk').onclick = run;
    };
    window.__srmToggle = (bi, ii) => { if (busy) return; const it = blocks[bi].items[ii]; if (it.kind === 'new' && !free(it)) return; it.on = !it.on; refresh(); };
    window.__srmRoom = async (bi, ii, r) => { if (busy) return; const it = blocks[bi].items[ii]; it.room = r; await load(it); refresh(); };
    const load = async it => { try { it.blockers = it.kind === 'new' ? await blockersOf(it) : []; } catch (er) { it.blockers = []; } if (it.kind === 'new' && !free(it)) it.on = false; };
    // 释放项的勾选变了，新日子的可用状态跟着变：被占就取消勾选
    const refresh = () => { allItems().forEach(it => { if (it.kind === 'new' && !free(it)) it.on = false; }); draw(); };

    const ops = [];   // 这一次做过的事，撤销用
    const run = async () => {
      if (busy) return; busy = true; draw();
      const lines = []; let any = false;
      const picks = allItems().filter(it => it.on);
      // 先释放 / 删除，再建临时占用
      for (const it of picks.filter(x => x.kind !== 'new')) {
        try {
          if (it.kind === 'off') {
            const cur = ((await srmGet(`/rest/v1/sched_bookings?id=eq.${it.b.id}&select=id,manual_off_dates`)) || [])[0];
            if (!cur) { lines.push(`跳过：${e(it.label)}（占用已不存在）`); continue; }
            const set = srmSplit(cur.manual_off_dates);
            if (!set.includes(it.date)) {
              set.push(it.date);
              await sb(`/rest/v1/sched_bookings?id=eq.${it.b.id}`, 'PATCH', { manual_off_dates: set.sort().join(',') });
              ops.push({ t: 'off', id: it.b.id, date: it.date });
            }
            lines.push('已做：' + e(it.label)); any = true;
          } else {
            const cur = ((await srmGet(`/rest/v1/sched_bookings?id=eq.${it.b.id}&select=*`)) || [])[0];
            if (!cur) { lines.push(`跳过：${e(it.label)}（占用已不存在）`); continue; }
            await sb(`/rest/v1/sched_bookings?id=eq.${it.b.id}`, 'DELETE');
            ops.push({ t: 'del', row: cur });
            lines.push('已做：' + e(it.label)); any = true;
          }
        } catch (er) { lines.push(`跳过：${e(it.label)}（${e(er.message || '失败')}）`); }
      }
      for (const it of picks.filter(x => x.kind === 'new')) {
        const lab = `${srmMDW(it.date)}${it.sp.start}-${it.sp.end} 临时占用 ${roomName(it.room)}`;
        try {
          const bl = await srmBlockers(it.room, it.date, it.sp);   // 写之前再查一次
          if (bl.length) { lines.push(`跳过：${e(lab)}（被《${e(bl[0].title)}》${e(bl[0].who)} ${e(bl[0].time)} 占着）`); continue; }
          const tpl = bks.find(b => b.recurrence === 'weekly' && String(b.room_id) === String(it.room)) || {};
          const ch = blocks.find(b => b.items.includes(it)).ch;
          const rec = { room_id: tpl.room_id != null ? tpl.room_id : it.room, kind: 'course', recurrence: 'once', booking_date: it.date, start_time: it.sp.start, end_time: it.sp.end,
            course_id: course.id, session_id: ch.id, title: tpl.title || course.name || '', user_name: tpl.user_name || '', status: 'confirmed', entry_name: SRM_NOTE, note: SRM_NOTE, auto_sync: false };
          const ins = await sb('/rest/v1/sched_bookings', 'POST', [rec]);
          const nid = Array.isArray(ins) && ins[0] ? ins[0].id : null;
          if (nid != null) ops.push({ t: 'new', id: nid });
          lines.push('已做：' + e(lab)); any = true;
        } catch (er) { lines.push(`跳过：${e(lab)}（${e(er.message || '失败')}）`); }
      }
      done = lines.length ? lines : ['没有勾选任何项，什么都没改。'];
      done.undo = ops.length > 0;
      busy = false; draw();
    };
    const undo = async () => {
      const fail = [];
      for (const o of ops.slice().reverse()) {
        try {
          if (o.t === 'new') await sb(`/rest/v1/sched_bookings?id=eq.${o.id}`, 'DELETE');
          else if (o.t === 'off') {
            const cur = ((await srmGet(`/rest/v1/sched_bookings?id=eq.${o.id}&select=id,manual_off_dates`)) || [])[0];
            if (cur) await sb(`/rest/v1/sched_bookings?id=eq.${o.id}`, 'PATCH', { manual_off_dates: srmSplit(cur.manual_off_dates).filter(d => d !== o.date).join(',') });
          } else if (o.t === 'del') await sb('/rest/v1/sched_bookings', 'POST', [o.row]);
        } catch (er) { fail.push(er.message || '失败'); }
      }
      ops.length = 0; undone = true;
      done = fail.length ? ['撤销时有 ' + fail.length + ' 项失败：' + e(fail[0])] : ['已恢复成改之前的样子。'];
      done.undo = false; draw();
    };

    // 先把所有「新日子」的冲突查出来再画
    Promise.all(allItems().map(load)).then(() => { refresh(); });
    ov.innerHTML = '<div style="' + CC_BOX + '"><div style="padding:24px;text-align:center">正在检查教室…</div></div>';
  });
}
