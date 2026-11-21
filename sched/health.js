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
