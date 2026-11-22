/* 课程 / 教室一致性体检（只读，纯计算；页面在 sched/index.html，写操作和确认也在那里）
   依赖 sched/common.js：bookingOnDate / bookingTimeOn / skipHides / overlap / addDays / _clk5
   输入：bookings 必须已经过 linkCourseBookings（占用的显示时间 = 这一回的时间；原始时间在 b._orig）；link = window.COURSE_LINK；range = window.COURSE_LINK_RANGE
   四项：
     orphans      单日占用所在的那一天，这门课没有没休讲的单回（遗留占用）
     timeMismatch 单日占用存的时间和这一回的时间不一致
     uncovered    课程有每周占用，但今天以后的某个上课日既没有每周占用覆盖、也没有单日占用
     overlaps     同一教室同一时间被两条占用重叠（按每一回的实际时间算，不是看原始字段）*/
function hcRawTime(b){ const o = b._orig || b; return [_clk5(o.start_time), _clk5(o.end_time)]; }
function hcCheck(o){
  const today = o.today, range = o.range || window.COURSE_LINK_RANGE, L = o.link || {};
  const out = { orphans:[], timeMismatch:[], uncovered:[], overlaps:[] };
  const all = (o.bookings || []).filter(b => b.status !== 'rejected');
  const cbks = all.filter(b => b.kind === 'course' && b.course_id);
  // 1 / 2：单日占用
  cbks.filter(b => b.recurrence === 'once' && b.booking_date && b.booking_date >= today).forEach(b => {
    const e = L[String(b.course_id)];
    if(!e || !e.days || !e.days.size) return;                                           // 这门课没有单回数据：不判断
    if(range && (b.booking_date < range[0] || b.booking_date > range[1])) return;
    const t = e.days.get(b.booking_date);
    if(!t){ out.orphans.push({ b, cid:String(b.course_id), date:b.booking_date }); return; }
    const raw = hcRawTime(b);
    if(raw[0] !== t[0] || raw[1] !== t[1]) out.timeMismatch.push({ b, cid:String(b.course_id), date:b.booking_date, from:raw, to:t });
  });
  // 3：有每周占用的课，今天以后的上课日没人占
  const weeklyCids = new Set(cbks.filter(b => b.recurrence === 'weekly').map(b => String(b.course_id)));
  weeklyCids.forEach(cid => {
    const e = L[cid]; if(!e || !e.days) return;
    const mine = cbks.filter(b => String(b.course_id) === cid);
    [...e.days.keys()].filter(d => d >= today).sort().forEach(d => {
      if(e.online && e.online.has(d)) return;   // 这一回单独改成线上：不需要教室
      if(!mine.some(b => bookingOnDate(b, d))) out.uncovered.push({ cid, date:d, time:e.days.get(d) });
    });
  });
  // 4：同教室同一时间重叠（今天起 o.days 天内，按每一回的实际时间）
  const byRoom = {};
  all.forEach(b => { if(b.room_id != null && b.room_id !== '') (byRoom[String(b.room_id)] = byRoom[String(b.room_id)] || []).push(b); });
  const seen = new Map();
  Object.keys(byRoom).forEach(rid => {
    const rb = byRoom[rid]; if(rb.length < 2) return;
    for(let i = 0, d = today; i < (o.days || 90); i++, d = addDays(d, 1)){
      const on = rb.filter(b => bookingOnDate(b, d) && !skipHides(b, d));
      if(on.length < 2) continue;
      for(let x = 0; x < on.length; x++) for(let y = x + 1; y < on.length; y++){
        const a = on[x], b = on[y];
        if(!overlap(...bookingTimeOn(a, d), ...bookingTimeOn(b, d))) continue;
        const k = rid + '|' + [a.id, b.id].sort().join('|');
        const it = seen.get(k) || { roomId:rid, a, b, days:[] };
        it.days.push(d); seen.set(k, it);
      }
    }
  });
  seen.forEach(v => out.overlaps.push(v));
  out.total = out.orphans.length + out.timeMismatch.length + out.uncovered.length + out.overlaps.length;
  return out;
}

/* 排不下预警（容量判断，纯计算）
   同一校区、同一个上课日、同一个时间段：需要教室的课（同一系列算一门）> 这个校区这个时段可用的教室数 → 报一条「教室可能不够」。
   可用教室 = 该校区在用的教室 − 被别的占用（临时 / 租用 / 开会等非课程占用）占住的教室。
   输入：courses（排课里的课）、rooms、bookings（已经过 linkCourseBookings）、link（window.COURSE_LINK）、today、to、campus（可空）、scope（函数，可空）
   输出：[{ campus, date, slot:'14:00-17:00', need, avail, short, courses:[{id,name}] }]，按日期、校区排序 */
function hcCapacity(o){
  const today = o.today, to = o.to || addDays(today, 90), L = o.link || {};
  const rooms = (o.rooms || []).filter(r => r.active !== false);
  const nonCourse = (o.bookings || []).filter(b => b.status !== 'rejected' && b.kind !== 'course' && b.room_id != null && b.room_id !== '');
  const byCD = {};   // 校区|日期 → [{ key, id, name, s, e }]
  (o.courses || []).forEach(c => {
    if(!c || c.mode === '线上' || c.campus === '线上' || !c.campus) return;
    if(o.campus && c.campus !== o.campus) return;
    if(typeof o.scope === 'function' && !o.scope(c)) return;
    const e = L[String(c.id)];
    let days;
    if(e && e.days && e.days.size) days = [...e.days.entries()].filter(x => x[0] >= today && x[0] <= to);
    else {
      if(!c.weekdays || !c.start_time || !c.start_date || !c.end_date) return;
      const wds = parseWeekdaysSched(c.weekdays), skip = new Set(String(c.skip_dates || '').split(',').map(x => x.trim()).filter(Boolean));
      days = [];
      for(let d = [c.start_date, today].sort().pop(), g = 0; d <= c.end_date && d <= to && g < 800; d = addDays(d, 1), g++)
        if(wds.includes(weekdayOf(d)) && !skip.has(d)) days.push([d, [_clk5(c.start_time), _clk5(c.end_time)]]);
    }
    days.forEach(([d, t]) => { if(!t || !t[0] || !t[1]) return; (byCD[c.campus + '|' + d] = byCD[c.campus + '|' + d] || []).push({ key: c.merge_group ? 'g' + c.merge_group : 'c' + c.id, id: String(c.id), name: c.name || '', s: _clk5(t[0]), e: _clk5(t[1]) }); });
  });
  const out = [];
  Object.keys(byCD).forEach(k => {
    const [campus, date] = k.split('|'), items = byCD[k];
    const cr = rooms.filter(r => r.campus === campus); if(!cr.length) return;
    const crIds = new Set(cr.map(r => String(r.id)));
    const occ = nonCourse.filter(b => crIds.has(String(b.room_id)) && bookingOnDate(b, date) && !skipHides(b, date));
    [...new Set(items.map(i => i.s + '-' + i.e))].sort().forEach(slot => {
      const [s, e] = slot.split('-');
      const mine = items.filter(i => overlap(i.s, i.e, s, e));
      const need = new Set(mine.map(i => i.key)).size;
      const used = new Set(occ.filter(b => { const t = bookingTimeOn(b, date); return overlap(_clk5(t[0]), _clk5(t[1]), s, e); }).map(b => String(b.room_id))).size;
      const avail = Math.max(0, cr.length - used);
      if(need > avail){
        const seen = new Set(), cs = [];
        mine.forEach(i => { if(!seen.has(i.id)){ seen.add(i.id); cs.push({ id: i.id, name: i.name }); } });
        out.push({ campus, date, slot, need, avail, short: need - avail, courses: cs });
      }
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.campus.localeCompare(b.campus) || a.slot.localeCompare(b.slot));
}
/* 「确认无碍」的键：校区 + 日期 + 时间段；需求数 / 可用数变了 = 内容变了 = 重新提示 */
function hcCapKey(x){ return 'cap|' + x.campus + '|' + x.date + '|' + x.slot; }
function hcCapAcked(x, acks){ return (acks || []).some(a => a.key === hcCapKey(x) && Number(a.need) === x.need && Number(a.avail) === x.avail); }

/* 管理端已通知总务、但等了超过 2 天还没处理的「需要协调教室」（输入是 coordBuild() 的 groups）
   输出：[{ name, nums:['第 3 回','11/23'…], days }]，等得最久的在前 */
function hcStale(groups, now, minDays){
  const lim = (minDays == null ? 2 : minDays) * 864e5, out = [];
  (groups || []).forEach(g => {
    const todo = (g.act || []).filter(it => !it.fb);
    if(!todo.length) return;
    let oldest = Infinity;
    todo.forEach(it => (it.logs || [it.l]).forEach(l => { const t = Date.parse(l && l.created_at); if(t && t < oldest) oldest = t; }));
    if(oldest === Infinity || now - oldest <= lim) return;
    out.push({ name: g.name || '', nums: todo.map(it => it.x.num ? '第 ' + it.x.num + ' 回' : String(it.x.date || '').slice(5).replace('-', '/')), days: Math.floor((now - oldest) / 864e5) });
  });
  return out.sort((a, b) => b.days - a.days);
}
