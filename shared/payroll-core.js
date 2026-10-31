// 工资核算的核算函数：管理端「工作管理」生成工资表和老师端「工作记录」共用同一套算法。
// 依赖 shared/constants.js（scope*、MAJOR_DOMAIN 等）、shared/workrec-table.js、shared/supabase.js 的 sb / sbAll。

// ── 工作内容映射 ──
function payrollWorkType(courseType) {
  if (!courseType) return '大课';
  if (courseType.includes('VIP')) return 'VIP授课';
  if (courseType.includes('共通')) return '共通课';
  return '大课';
}

// ── 地点映射 ──
function payrollLocation(loc, campus) {
  if (!loc || loc === 'online') return '线上';
  if (loc.includes('ichigaya')) return '市谷校区';
  if (loc.includes('takadanobaba')) return '高马校区';
  if (campus) {
    if (campus.includes('市谷')) return '市谷校区';
    if (campus.includes('高马') || campus.includes('高田')) return '高马校区';
    return campus;
  }
  return '线下';
}

// ── 时间段解析 → 开始/结束/时长 ──
function parseTimeRange(dateStr, timeRange, actualHours) {
  if (!dateStr || !timeRange) return { start: '', end: '', hours: actualHours || 0 };
  // 同一单回多个时间段（14:00-17:00/18:00-21:00）：开始=第一段开始，结束=最后一段结束，时长=各段相加
  if (typeof parseTimeRanges === 'function' && parseTimeRanges(timeRange).length > 1) {
    const d0 = new Date(dateStr + 'T12:00:00');
    const pre = `${d0.getFullYear()}年${String(d0.getMonth() + 1).padStart(2, '0')}月${String(d0.getDate()).padStart(2, '0')}日 `;
    const sp = timeRangesSpan(timeRange);
    return { start: pre + sp.start, end: pre + sp.end, hours: timeRangesHours(timeRange) };
  }
  const parts = timeRange.split(/[–\-]/);
  if (parts.length < 2) return { start: timeRange, end: '', hours: actualHours || 0 };
  const startT = parts[0].trim();
  const endT = parts[1].trim();
  const [sh, sm] = startT.split(':').map(Number);
  const d = new Date(dateStr + 'T12:00:00');
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  // 起始时间解析失败时，直接退回原始字符串，避免 NaN:NaN
  if (isNaN(sh) || isNaN(sm)) {
    return {
      start: `${y}年${mo}月${day}日 ${startT}`,
      end: `${y}年${mo}月${day}日 ${endT}`,
      hours: actualHours || 0
    };
  }

  // 若填写了实际课时（小时），用「开始时间 + 课时」反推结束时间；否则用 time_range 字面差值
  if (actualHours != null && !isNaN(actualHours) && actualHours > 0) {
    const totalStartMin = sh * 60 + sm;
    const totalEndMin = totalStartMin + Math.round(actualHours * 60);
    const eh2 = Math.floor(totalEndMin / 60) % 24;
    const em2 = totalEndMin % 60;
    const endT2 = `${String(eh2).padStart(2,'0')}:${String(em2).padStart(2,'0')}`;
    return {
      start: `${y}年${mo}月${day}日 ${startT}`,
      end: `${y}年${mo}月${day}日 ${endT2}`,
      hours: Math.round(actualHours * 100) / 100
    };
  }

  const [eh, em] = endT.split(':').map(Number);
  const hours = Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 60 * 100) / 100;
  return {
    start: `${y}年${mo}月${day}日 ${startT}`,
    end: `${y}年${mo}月${day}日 ${endT}`,
    hours
  };
}

// ── 面谈开始/结束时间 ──
function bookingTimes(b) {
  const startRaw = b.actual_time || (b.slot_date + 'T' + (b.slot_time_range || '00:00').split(/[–\-]/)[0].trim());
  const d = new Date(startRaw);
  if (isNaN(d)) return { start: '', end: '', hours: 0 };
  const mins = b.actual_duration || b.duration || 30;
  const endD = new Date(d.getTime() + mins * 60000);
  const fmt = dt => {
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return `${y}年${mo}月${day}日 ${hh}:${mm}`;
  };
  return { start: fmt(d), end: fmt(endD), hours: Math.round(mins / 60 * 100) / 100 };
}

// ── 生成课程行 ──
// ── 视角（领域 / 专业）判断：工作核算只算当前视角内的 ──
// 专业 → 所属领域（分组代码取第一个成员）
function payrollMajorDomain(m) {
  if (!m) return '';
  if (isMajorGroup(m)) return groupDomain(m) || MAJOR_DOMAIN[groupMajors(m)[0]] || '';
  return MAJOR_DOMAIN[m] || '';
}
// 大课所属领域：courses.domain，没有就按课程专业
function payrollCourseDomain(c) {
  if (!c) return '';
  if (c.domain) return c.domain;
  const ms = Array.isArray(c.major) ? c.major : (c.major ? [c.major] : []);
  for (const m of ms) { const d = payrollMajorDomain(m); if (d) return d; }
  return '';
}
// opt.noScope = true：不按管理范围（领域 / 专业）过滤——老师端看的是自己的全部工作；管理端不传 opt，照常按范围过滤
function buildCourseRows(sessions, teacherName, courses, opt) {
  // courses 用于 time_range/actual_hours fallback（旧课次可能没有该字段）
  const courseMap = {};
  (courses || []).forEach(c => { courseMap[c.id] = c; });
  return sessions
    .filter(s => !s.is_cancelled && (s.teacher === teacherName || s.session_teacher === teacherName))
    .filter(s => {
      const c = courseMap[s.course_id] || {};
      return (opt && opt.noScope) || scopeCourse({ domain: c.domain, major: c.major || s.major, class_ids: c.class_ids });   // 只算本领域 / 本专业的课
    })
    .map(s => {
      const tr = s.time_range || courseMap[s.course_id]?.time_range || '';
      const actualHours = (s.actual_hours != null ? s.actual_hours : courseMap[s.course_id]?.actual_hours);
      const { start, end, hours } = parseTimeRange(s.session_date, tr, actualHours);
      return {
        type: 'course',
        source_id: s.id,
        姓名: teacherName,
        开始时间: start,
        结束时间: end,
        时长: hours,
        工作内容: payrollWorkType(s.course_type || courseMap[s.course_id]?.course_type),
        工作地点: payrollLocation(s.delivery || courseMap[s.course_id]?.delivery, s.campus || courseMap[s.course_id]?.campus),
        备注: `${s.course_name} 第${s.session_number}回`,
        _date: s.session_date,
        _domain: payrollCourseDomain({ domain: courseMap[s.course_id]?.domain, major: courseMap[s.course_id]?.major || s.major })
      };
    });
}

// ── 生成面谈行 ──
// 面谈（非 VIP）进工资要同时满足：status = completed + 面谈记录有内容。
// 算哪个月：按填写面谈记录的日期（record_done_at，东京时间）；旧数据没有就用面谈日期。取数时已按这个日期限定了范围（payrollLoadData）。
const PAYROLL_INTERVIEW_GATE_START = '2026-10-01';   // 待填写只看这天以后的面谈，避免把很早以前的旧预约全翻出来
// 与 shared/task-checks.js 的 _tkHasRec 同一个判断，不依赖它是否加载
const payrollHasRecord = b => !!(b && b.daily_record && typeof b.daily_record === 'object' && Object.values(b.daily_record).some(v => v && (typeof v === 'string' ? v.trim() : Object.values(v).some(x => x))));
const payrollInterviewDate = b => ((b.actual_time || b.slot_date || '') + '').slice(0, 10);
const payrollInterviewDone = b => !!b && b.type !== 'vip' && b.status === 'completed' && payrollHasRecord(b);
const payrollTodayJst = () => payrollJstDate(new Date().toISOString());
// 工资月份用的日期：填写记录的日期；旧数据用面谈日期
const payrollInterviewPayDate = b => payrollJstDate(b.record_done_at) || payrollInterviewDate(b);
function payrollInterviewOwner(b, slotMap) { return b.assigned_teacher || slotMap[b.slot_id]?.teacher_name || ''; }
function buildBookingRows(bookings, slots, teacherName, students, opt) {
  const slotMap = {};
  slots.forEach(s => { slotMap[s.id] = s; });
  const stuMap = payrollStuMap(students);
  return bookings
    .filter(b => {
      if (!payrollInterviewDone(b)) return false;   // VIP 走 buildVipRows；没完成 / 没填记录的走 buildInterviewPending
      if (!(opt && opt.noScope) && !scopeMajor(payrollBookingMajor(b, stuMap))) return false;   // 只算本领域 / 本专业学生的面谈
      // 优先用该预约自己分配的老师；若从未单独分配过，则退回看时间槽默认老师
      return payrollInterviewOwner(b, slotMap) === teacherName;
    })
    .map(b => {
      const { start, end, hours } = bookingTimes(b);
      const slot = slotMap[b.slot_id];
      const loc = b.location || slot?.location || 'online';
      const pay = payrollInterviewPayDate(b), iv = payrollInterviewDate(b);
      return {
        type: 'booking',
        source_id: b.id,
        姓名: teacherName,
        开始时间: start,
        结束时间: end,
        时长: hours,
        工作内容: '教研工作',
        工作地点: payrollLocation(loc, ''),
        备注: `${b.name}的面谈预约${b.manual_entry ? '（教务补录）' : ''}${pay && iv && pay !== iv ? '（' + +pay.slice(5, 7) + '月' + +pay.slice(8, 10) + '日填写记录）' : ''}`,
        _date: pay,
        _domain: payrollMajorDomain(payrollBookingMajor(b, stuMap))
      };
    });
}
// 没完成或没填记录的面谈：不计入工资，单独列出来，好提醒老师
function buildInterviewPending(list, teacherName, slots, students, opt) {
  const slotMap = {};
  (slots || []).forEach(s => { slotMap[s.id] = s; });
  const stuMap = payrollStuMap(students);
  const last = opt && opt.end && opt.end < payrollTodayJst() ? opt.end : payrollTodayJst();
  return (list || []).filter(b => {
      if (!b || b.type === 'vip' || b.status === 'cancelled' || payrollInterviewDone(b)) return false;
      const d = (b.slot_date || '') + '';
      if (!d || d < PAYROLL_INTERVIEW_GATE_START || d > last) return false;
      if (payrollInterviewOwner(b, slotMap) !== teacherName) return false;
      return (opt && opt.noScope) || scopeMajor(payrollBookingMajor(b, stuMap));
    })
    .map(b => {
      const slot = slotMap[b.slot_id];
      const tr = (b.slot_time_range || slot?.time_range || '').split(/[–\-~～]/)[0].trim();
      return { id: b.id, name: b.name, date: (b.slot_date || '') + '', time: tr, reason: b.status === 'completed' ? '还没填写面谈记录' : '还没完成面谈', teacher: teacherName };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}
// 面谈列表（管理端 / 老师端共用）里每条面谈只落在一个状态：
//   cancelled 已取消 | done 已完成 | need_record 待补记录（面谈日早于今天，10/1 以后）| pending 待确认 | confirmed 已确认 | old 未记录（旧，只在「全部」里出现）
// 和工资页的区别：工资页把今天的面谈也算进待填写；列表里今天的面谈还算待确认 / 已确认
const INTERVIEW_STATE_LABEL = { cancelled: '已取消', done: '已完成', need_record: '待补记录', pending: '待确认', confirmed: '已确认', old: '未记录（旧）' };
function interviewState(b) {
  if (!b) return 'confirmed';
  if (b.status === 'cancelled') return 'cancelled';
  if (payrollInterviewDone(b)) return 'done';
  const d = payrollInterviewDate(b);
  if (d && d < payrollTodayJst()) return d >= PAYROLL_INTERVIEW_GATE_START ? 'need_record' : 'old';
  return b.status === 'pending' ? 'pending' : 'confirmed';
}
// 待补记录的原因（与 buildInterviewPending 一致）
const interviewNeedReason = b => (b && b.status === 'completed') ? '还没填写面谈记录' : '还没完成面谈';
// 面谈日是今天或已过：可以点「完成・填记录」
const interviewCanFinish = b => { const d = payrollInterviewDate(b); return !!d && d <= payrollTodayJst(); };
// 提醒老师的文字
function interviewRemindText(teacherName, list) {
  const wd = '日一二三四五六';
  const nm = String(teacherName || '').endsWith('老师') ? teacherName : teacherName + '老师';
  const lines = (list || []).map((x, i) => {
    const d = new Date(x.date + 'T12:00:00');
    const ds = isNaN(d) ? x.date : `${d.getMonth() + 1}月${d.getDate()}日（周${wd[d.getDay()]}）`;
    return `${i + 1}. ${ds}${x.time ? ' ' + x.time : ''}　${x.name}（${x.reason}）`;
  });
  return `【面谈记录待填写】${nm}，以下面谈还没有完成，或还没有填写面谈记录。填好之后才会计入工资：\n${lines.join('\n')}\n请到老师端「面谈预约」里完成面谈、填写面谈记录。`;
}

function payrollStuMap(students) {
  const m = {};
  (students || []).forEach(x => { m[x.id] = x; });
  return m;
}
// 预约的真实专业：学生档案优先，没有 student_id 才用预约上的 major
function payrollBookingMajor(b, stuMap) {
  const st = b.student_id && stuMap ? stuMap[b.student_id] : null;
  return (st && st.major) || b.major || '';
}

// ── 生成 VIP 一对一行 ──
// 一节 VIP 课进工资要同时满足：老师填了上课记录（status = completed）+ 学生课后确认并评价（student_confirmed，教务代确认也算）。
// 算哪个月：按最终确认的时间（student_confirmed_at，东京时间），不再按上课日。例：10 月 30 日的课，学生 11 月 2 日才确认 → 算 11 月工资。
// 取数时已经按确认时间限定了日期范围（payrollLoadData 的 vipConfirmed），所以这里不再按上课日过滤。
const payrollJstDate = iso => iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : '';
function payrollVipOwner(b, slotMap) { return b.assigned_teacher || slotMap[b.slot_id]?.teacher_name || ''; }
function buildVipRows(bookings, teacherName, slots, students, opt) {
  const slotMap = {};
  (slots || []).forEach(s => { slotMap[s.id] = s; });
  const stuMap = payrollStuMap(students);
  return (bookings || [])
    .filter(b => {
      if (b.type !== 'vip' || b.status !== 'completed' || b.student_confirmed !== true) return false;
      if (payrollVipOwner(b, slotMap) !== teacherName) return false;
      return (opt && opt.noScope) || scopeMajor(payrollBookingMajor(b, stuMap));
    })
    .map(b => {
      const tr = parseTimeRange(b.slot_date, b.slot_time_range || '');
      const used = parseFloat(b.vip_hours_used);
      const hours = used > 0 ? Math.round(used * 100) / 100 : (tr.hours || 0);
      const cf = payrollJstDate(b.student_confirmed_at) || b.slot_date || '';
      return {
        type: 'vip',
        source_id: b.id,
        姓名: teacherName,
        开始时间: tr.start,
        结束时间: tr.end,
        时长: hours,
        工作内容: 'VIP授课',
        工作地点: payrollLocation(b.location || slotMap[b.slot_id]?.location || 'online', ''),
        备注: `${b.name} · VIP${b.vip_content ? ' · ' + b.vip_content : ''}${b.manual_entry ? '（教务补录）' : ''}${cf && cf !== (b.slot_date || '') ? '（' + cf.slice(5).replace('-', '月') + '日确认）' : ''}`,
        _date: cf,   // 排序 / 月份按确认日期
        _domain: payrollMajorDomain(payrollBookingMajor(b, stuMap))
      };
    });
}
// 已上课、学生还没确认的 VIP 课：不计入工资，单独列出来，好去催学生确认
function buildVipPending(pending, teacherName, slots, students, opt) {
  const slotMap = {};
  (slots || []).forEach(s => { slotMap[s.id] = s; });
  const stuMap = payrollStuMap(students);
  return (pending || []).filter(b => b.type === 'vip' && b.status === 'completed' && b.student_confirmed !== true
      && payrollVipOwner(b, slotMap) === teacherName && ((opt && opt.noScope) || scopeMajor(payrollBookingMajor(b, stuMap))))
    .map(b => { if (window.__bkProxyExtra) window.__bkProxyExtra[b.id] = b; return { id: b.id, name: b.name, date: b.slot_date || '', range: b.slot_time_range || '', hours: parseFloat(b.vip_hours_used) || 0, teacher: teacherName }; })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// 面谈预约取数后的整理：已完成的按「填写记录日期」留在区间内；待填写的另外收集
function payrollSplitInterviews(all, start, end) {
  const nonVip = (all || []).filter(b => b.type !== 'vip');
  const rank = { completed: 3, confirmed: 2, pending: 1 };   // 同一条预约读到多份时，留状态更靠后的，不让旧数据盖掉已完成
  const byId = {};
  nonVip.forEach(b => { const o = byId[b.id]; if (!o || (rank[b.status] || 0) > (rank[o.status] || 0)) byId[b.id] = b; });
  const uniq = Object.values(byId);
  const bookings = uniq.filter(b => { if (!payrollInterviewDone(b)) return false; const d = payrollInterviewPayDate(b); return d >= start && d <= end; });
  const interviewPending = uniq.filter(b => !payrollInterviewDone(b) && b.status !== 'cancelled');
  return { bookings, interviewPending };
}
const payrollPendEnd = end => (end < payrollTodayJst() ? end : payrollTodayJst());

// 一次读齐生成工资核算要用的数据
async function payrollLoadData(start, end) {
  // VIP：按「学生确认的时间」（东京时间）落在日期范围内取；另外取已上课、还没确认的（待学生确认，不计入工资）
  const nextDay = new Date(new Date(end + 'T12:00:00Z').getTime() + 864e5).toISOString().slice(0, 10);
  const enc = encodeURIComponent;
  const pendEnd = payrollPendEnd(end);
  const [sessions, bkInRange, slots, courses, students, vipConfirmed, vipPending, bkByRecord, bkPend] = await Promise.all([
    sb(`/rest/v1/course_sessions?select=*&session_date=gte.${start}&session_date=lte.${end}&order=session_date.asc`, 'GET', undefined, { cache: 'no-store' }),
    sb(`/rest/v1/bookings?select=*&slot_date=gte.${start}&slot_date=lte.${end}&order=slot_date.asc`, 'GET', undefined, { cache: 'no-store' }),
    sb(`/rest/v1/slots?select=*&date=gte.${start}&date=lte.${end}`, 'GET', undefined, { cache: 'no-store' }),
    sb(`/rest/v1/courses?select=id,time_range,course_type,delivery,campus,actual_hours,domain,major,class_ids`, 'GET', undefined, { cache: 'no-store' }),
    sbAll(`/rest/v1/students?select=id,major,extra_majors,class_ids`, { cache: 'no-store' }),
    sbAll(`/rest/v1/bookings?type=eq.vip&status=eq.completed&student_confirmed=is.true&student_confirmed_at=gte.${enc(start + 'T00:00:00+09:00')}&student_confirmed_at=lt.${enc(nextDay + 'T00:00:00+09:00')}&select=*`, { cache: 'no-store' }),
    sbAll(`/rest/v1/bookings?type=eq.vip&status=eq.completed&or=(student_confirmed.is.null,student_confirmed.is.false)&slot_date=lte.${end}&select=*`, { cache: 'no-store' }),
    // 面谈填写记录的日期落在区间内（面谈日期可能在更早的月份）
    sbAll(`/rest/v1/bookings?status=eq.completed&record_done_at=gte.${enc(start + 'T00:00:00+09:00')}&record_done_at=lt.${enc(nextDay + 'T00:00:00+09:00')}&select=*`, { cache: 'no-store' }),
    // 待填写：从起算日到区间结束日（不超过今天）、没取消的面谈，最后在 JS 里精确判断
    pendEnd >= PAYROLL_INTERVIEW_GATE_START ? sbAll(`/rest/v1/bookings?status=neq.cancelled&slot_date=gte.${PAYROLL_INTERVIEW_GATE_START}&slot_date=lte.${pendEnd}&select=*`, { cache: 'no-store' }) : Promise.resolve([])
  ]);
  const { bookings, interviewPending } = payrollSplitInterviews([...bkInRange, ...bkByRecord, ...bkPend], start, end);
  // 补齐「填写日期在区间内、但面谈日期在更早月份」那些预约的时间槽（面谈地点、老师要用）
  const have = new Set(slots.map(x => x.id));
  const needIds = [...new Set([...bookings, ...interviewPending].map(b => b.slot_id).filter(x => x != null && !have.has(x)))];
  const extra = [];
  for (let i = 0; i < needIds.length; i += 80) extra.push(...await sb(`/rest/v1/slots?select=*&id=in.${enc('(' + needIds.slice(i, i + 80).map(x => '"' + x + '"').join(',') + ')')}`, 'GET', undefined, { cache: 'no-store' }).catch(() => []));
  return { sessions, bookings, slots: [...slots, ...extra], courses, students, vipConfirmed, vipPending, interviewPending };
}

// ── 老师端用：只读这一位老师自己的课次 / 面谈 / VIP，返回值和 payrollLoadData 一样 ──
async function payrollLoadTeacherData(start, end, name) {
  const enc = encodeURIComponent, q = '"' + String(name).replace(/"/g, '\\"') + '"';
  const nextDay = new Date(new Date(end + 'T12:00:00Z').getTime() + 864e5).toISOString().slice(0, 10);
  const chunks = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
  const inList = a => '(' + a.map(x => '"' + x + '"').join(',') + ')';
  const pendEnd = payrollPendEnd(end), hasPend = pendEnd >= PAYROLL_INTERVIEW_GATE_START;
  const recQ = `status=eq.completed&record_done_at=gte.${enc(start + 'T00:00:00+09:00')}&record_done_at=lt.${enc(nextDay + 'T00:00:00+09:00')}`;   // 面谈：填写记录的日期落在本期
  const pendQ = `status=neq.cancelled&slot_date=gte.${PAYROLL_INTERVIEW_GATE_START}&slot_date=lte.${pendEnd}`;   // 面谈：待填写的候选
  const [sessions, mySlots, assigned, ivRecA, ivPendA] = await Promise.all([
    sbAll(`/rest/v1/course_sessions?select=*&session_date=gte.${start}&session_date=lte.${end}&or=${enc(`(teacher.eq.${q},session_teacher.eq.${q})`)}&order=session_date.asc`, { cache: 'no-store' }),
    sbAll(`/rest/v1/slots?select=*&teacher_name=eq.${enc(name)}`, { cache: 'no-store' }),
    sbAll(`/rest/v1/bookings?select=*&assigned_teacher=eq.${enc(name)}&or=${enc(`(and(slot_date.gte.${start},slot_date.lte.${end}),and(type.eq.vip,status.eq.completed,or(student_confirmed.is.null,student_confirmed.is.false,and(student_confirmed_at.gte.${start}T00:00:00+09:00,student_confirmed_at.lt.${nextDay}T00:00:00+09:00))))`)}`, { cache: 'no-store' }),
    sbAll(`/rest/v1/bookings?select=*&assigned_teacher=eq.${enc(name)}&${recQ}`, { cache: 'no-store' }),
    hasPend ? sbAll(`/rest/v1/bookings?select=*&assigned_teacher=eq.${enc(name)}&${pendQ}`, { cache: 'no-store' }) : Promise.resolve([])
  ]);
  // 我的时间槽上、没单独分配过老师的预约：面谈按本期的槽，VIP 按全部的槽（确认月份可能晚于上课日）
  const ids = rows => rows.map(x => x.id);
  const rangeSlotIds = ids(mySlots.filter(x => x.date >= start && x.date <= end));
  const pickBy = async (qs, slotIds) => {
    const parts = await Promise.all(chunks(slotIds, 80).map(c => sb(`/rest/v1/bookings?select=*&slot_id=in.${enc(inList(c))}&${qs}`, 'GET', undefined, { cache: 'no-store' })));
    return parts.flat();
  };
  const [onSlot, vipConfirmedSlot, vipPendingSlot, ivRecS, ivPendS] = await Promise.all([
    pickBy(`slot_date=gte.${start}&slot_date=lte.${end}&order=slot_date.asc`, rangeSlotIds),
    pickBy(`type=eq.vip&status=eq.completed&student_confirmed=is.true&student_confirmed_at=gte.${enc(start + 'T00:00:00+09:00')}&student_confirmed_at=lt.${enc(nextDay + 'T00:00:00+09:00')}`, ids(mySlots)),
    pickBy(`type=eq.vip&status=eq.completed&or=(student_confirmed.is.null,student_confirmed.is.false)&slot_date=lte.${end}`, ids(mySlots.filter(x => x.date <= end))),
    pickBy(recQ, ids(mySlots)),
    hasPend ? pickBy(pendQ, ids(mySlots.filter(x => x.date >= PAYROLL_INTERVIEW_GATE_START && x.date <= pendEnd))) : Promise.resolve([])
  ]);
  const dedupe = list => { const m = {}; list.forEach(b => { m[b.id] = b; }); return Object.values(m); };
  const allB = dedupe([...assigned, ...onSlot, ...vipConfirmedSlot, ...vipPendingSlot]);
  const iv = payrollSplitInterviews([...assigned, ...onSlot, ...ivRecA, ...ivPendA, ...ivRecS, ...ivPendS], start, end);
  const bookings = iv.bookings, interviewPending = iv.interviewPending;   // 面谈工资按填写记录的日期取；VIP 工资另按确认日期取（vipConfirmed）
  const vipConfirmed = allB.filter(b => b.type === 'vip' && b.status === 'completed' && b.student_confirmed === true && b.student_confirmed_at
    && payrollJstDate(b.student_confirmed_at) >= start && payrollJstDate(b.student_confirmed_at) <= end);
  const vipPending = allB.filter(b => b.type === 'vip' && b.status === 'completed' && b.student_confirmed !== true && (b.slot_date || '') <= end);
  // 用到的课程、学生、时间槽（别人开的槽也要补，面谈地点要用）
  const slotById = {}; mySlots.forEach(x => { slotById[x.id] = x; });
  const needSlots = [...new Set([...bookings, ...interviewPending, ...vipConfirmed, ...vipPending].map(b => b.slot_id).filter(x => x != null && !slotById[x]))];
  const [extraSlots, courses, students] = await Promise.all([
    Promise.all(chunks(needSlots, 80).map(c => sb(`/rest/v1/slots?select=*&id=in.${enc(inList(c))}`, 'GET', undefined, { cache: 'no-store' }))).then(r => r.flat()),
    Promise.all(chunks([...new Set(sessions.map(x => x.course_id).filter(Boolean))], 80).map(c => sb(`/rest/v1/courses?select=id,time_range,course_type,delivery,campus,actual_hours,domain,major,class_ids&id=in.${enc(inList(c))}`, 'GET', undefined, { cache: 'no-store' }))).then(r => r.flat()),
    Promise.all(chunks([...new Set([...bookings, ...interviewPending, ...vipConfirmed, ...vipPending].map(b => b.student_id).filter(Boolean))], 80).map(c => sb(`/rest/v1/students?select=id,major,extra_majors,class_ids&id=in.${enc(inList(c))}`, 'GET', undefined, { cache: 'no-store' }).catch(() => []))).then(r => r.flat())
  ]);
  return { sessions, bookings, slots: [...mySlots, ...extraSlots], courses, students, vipConfirmed, vipPending, interviewPending };
}
