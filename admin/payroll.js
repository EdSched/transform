// ══════════════════════════════════
// PAYROLL.JS  工资核算
// 依赖：admin.js 中的 sb()、cachedTeachers
// ══════════════════════════════════

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
// 提交 / 读取工作记录时按视角过滤用：总览不限；否则只要视角涉及的领域
function payrollDomainQs() {
  if (typeof scopeAll === 'function' && scopeAll()) return '';
  const ds = scopeDomainList();
  return '&domain=in.(' + encodeURIComponent(ds.map(d => '"' + d + '"').join(',')) + ')';
}

function buildCourseRows(sessions, teacherName, courses) {
  // courses 用于 time_range/actual_hours fallback（旧课次可能没有该字段）
  const courseMap = {};
  (courses || []).forEach(c => { courseMap[c.id] = c; });
  return sessions
    .filter(s => !s.is_cancelled && (s.teacher === teacherName || s.session_teacher === teacherName))
    .filter(s => {
      const c = courseMap[s.course_id] || {};
      return scopeCourse({ domain: c.domain, major: c.major || s.major, class_ids: c.class_ids });   // 只算本领域 / 本专业的课
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
function buildBookingRows(bookings, slots, teacherName, students) {
  const slotMap = {};
  slots.forEach(s => { slotMap[s.id] = s; });
  const stuMap = payrollStuMap(students);
  return bookings
    .filter(b => {
      if (b.type === 'vip') return false;   // VIP 一对一走 buildVipRows
      if (b.status === 'cancelled' || b.status === 'pending' || !b.actual_time) return false;
      if (!scopeMajor(payrollBookingMajor(b, stuMap))) return false;   // 只算本领域 / 本专业学生的面谈
      // 优先用该预约自己分配的老师；若从未单独分配过，则退回看时间槽默认老师
      const owner = b.assigned_teacher || slotMap[b.slot_id]?.teacher_name || '';
      return owner === teacherName;
    })
    .map(b => {
      const { start, end, hours } = bookingTimes(b);
      const slot = slotMap[b.slot_id];
      const loc = b.location || slot?.location || 'online';
      return {
        type: 'booking',
        source_id: b.id,
        姓名: teacherName,
        开始时间: start,
        结束时间: end,
        时长: hours,
        工作内容: '教研工作',
        工作地点: payrollLocation(loc, ''),
        备注: `${b.name}的面谈预约${b.manual_entry ? '（教务补录）' : ''}`,
        _date: (b.actual_time || b.slot_date || '').slice(0, 10),
        _domain: payrollMajorDomain(payrollBookingMajor(b, stuMap))
      };
    });
}

// ── 老师的工资申告（work_records, source='declare'）→ 工资行 ──
async function payrollLoadDeclares(names, start, end) {
  const lo = start.slice(0, 4) + '年' + start.slice(5, 7) + '月' + start.slice(8, 10) + '日 00:00';
  const hi = end.slice(0, 4) + '年' + end.slice(5, 7) + '月' + end.slice(8, 10) + '日 23:59';
  const rows = await sbAll(`/rest/v1/work_records?source=eq.declare&start_time=gte.${encodeURIComponent(lo)}&start_time=lte.${encodeURIComponent(hi)}&select=*`);
  const set = new Set(names);
  return rows.filter(r => set.has(r.teacher_name));
}
function buildDeclareRows(decls, teacherName) {
  return (decls || []).filter(r => r.teacher_name === teacherName).map(r => {
    const dt = payrollDT(r.start_time);
    return {
      type: 'declare', source_id: r.id, 姓名: teacherName,
      开始时间: r.start_time, 结束时间: r.end_time, 时长: payrollRound(r.duration),
      工作内容: r.work_type, 工作地点: r.location, 备注: r.notes || '',
      _date: String(r.start_time).slice(0, 4) + '-' + String(r.start_time).slice(5, 7) + '-' + String(r.start_time).slice(8, 10),
      _domain: r.domain || '', _rec: r
    };
  });
}
// 申告撞上这位老师自己的大课 / 面谈 / VIP 行 → 返回撞上的类别（没有撞 = ''）
const PAYROLL_TYPE_LABEL = { course: '大课', booking: '面谈', vip: 'VIP' };
function payrollDeclareOverlap(r, rows) {
  const span = x => {
    const a = String(x.开始时间).match(/(\d{4}年\d{2}月\d{2}日)\s*(\d{1,2}):(\d{2})/), b = String(x.结束时间).match(/(\d{1,2}):(\d{2})\s*$/);
    return a && b ? { d: a[1], s: (+a[2]) * 60 + (+a[3]), e: (+b[1]) * 60 + (+b[2]) } : null;
  };
  const me = span(r);
  if (!me) return '';
  for (const x of rows) {
    if (!PAYROLL_TYPE_LABEL[x.type] || x.姓名 !== r.姓名) continue;
    const o = span(x);
    if (o && o.d === me.d && o.s < me.e && o.e > me.s) return PAYROLL_TYPE_LABEL[x.type];
  }
  return '';
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
function buildVipRows(bookings, teacherName, slots, students) {
  const slotMap = {};
  (slots || []).forEach(s => { slotMap[s.id] = s; });
  const stuMap = payrollStuMap(students);
  return (bookings || [])
    .filter(b => {
      if (b.type !== 'vip' || b.status !== 'completed' || b.student_confirmed !== true) return false;
      if (payrollVipOwner(b, slotMap) !== teacherName) return false;
      return scopeMajor(payrollBookingMajor(b, stuMap));
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
function buildVipPending(pending, teacherName, slots, students) {
  const slotMap = {};
  (slots || []).forEach(s => { slotMap[s.id] = s; });
  const stuMap = payrollStuMap(students);
  return (pending || []).filter(b => b.type === 'vip' && b.status === 'completed' && b.student_confirmed !== true
      && payrollVipOwner(b, slotMap) === teacherName && scopeMajor(payrollBookingMajor(b, stuMap)))
    .map(b => { window.__bkProxyExtra[b.id] = b; return { id: b.id, name: b.name, date: b.slot_date || '', range: b.slot_time_range || '', hours: parseFloat(b.vip_hours_used) || 0, teacher: teacherName }; })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// 一次读齐生成工资核算要用的数据
async function payrollLoadData(start, end) {
  // VIP：按「学生确认的时间」（东京时间）落在日期范围内取；另外取已上课、还没确认的（待学生确认，不计入工资）
  const nextDay = new Date(new Date(end + 'T12:00:00Z').getTime() + 864e5).toISOString().slice(0, 10);
  const enc = encodeURIComponent;
  const [sessions, bookings, slots, courses, students, vipConfirmed, vipPending] = await Promise.all([
    sb(`/rest/v1/course_sessions?select=*&session_date=gte.${start}&session_date=lte.${end}&order=session_date.asc`),
    sb(`/rest/v1/bookings?select=*&slot_date=gte.${start}&slot_date=lte.${end}&order=slot_date.asc`),
    sb(`/rest/v1/slots?select=*&date=gte.${start}&date=lte.${end}`),
    sb(`/rest/v1/courses?select=id,time_range,course_type,delivery,campus,actual_hours,domain,major,class_ids`),
    sbAll(`/rest/v1/students?select=id,major,extra_majors,class_ids`),
    sbAll(`/rest/v1/bookings?type=eq.vip&status=eq.completed&student_confirmed=is.true&student_confirmed_at=gte.${enc(start + 'T00:00:00+09:00')}&student_confirmed_at=lt.${enc(nextDay + 'T00:00:00+09:00')}&select=*`),
    sbAll(`/rest/v1/bookings?type=eq.vip&status=eq.completed&or=(student_confirmed.is.null,student_confirmed.is.false)&slot_date=lte.${end}&select=*`)
  ]);
  return { sessions, bookings, slots, courses, students, vipConfirmed, vipPending };
}
// ══════════════════════════════════
// 工资核算：一张表（生成 → 核对 / 勾选 / 改 → 下载 Excel 或确定发布）
// ══════════════════════════════════

const PAYROLL_HEADERS = ['姓名', '开始时间', '结束时间', '时长', '工作内容', '工作地点', '备注'];
const payrollRound = n => Math.round((parseFloat(n) || 0) * 100) / 100;
const payrollPad = n => String(n).padStart(2, '0');

// ── Excel：多位老师 = 一人一个工作表 + 汇总；rows 用 {姓名, 开始时间, …} 格式 ──
function payrollBuildWorkbook(rows) {
  const names = [...new Set(rows.map(r => r.姓名))];
  const wb = XLSX.utils.book_new();
  const cols = [{wch:10},{wch:20},{wch:20},{wch:8},{wch:10},{wch:14},{wch:40}];
  const addSheet = (name, list) => {
    const ws = XLSX.utils.aoa_to_sheet([PAYROLL_HEADERS, ...list.map(r => PAYROLL_HEADERS.map(h => r[h] ?? ''))]);
    ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  if (names.length <= 1) { addSheet('工资核算', rows); return wb; }
  const summary = [['姓名', '节数', '总时长(h)']];
  names.forEach(n => {
    const list = rows.filter(r => r.姓名 === n);
    summary.push([n, list.length, payrollRound(list.reduce((s, r) => s + (parseFloat(r.时长) || 0), 0))]);
  });
  const sws = XLSX.utils.aoa_to_sheet(summary);
  sws['!cols'] = [{wch:14},{wch:8},{wch:12}];
  XLSX.utils.book_append_sheet(wb, sws, '汇总');
  const used = new Set(['汇总']);
  names.forEach(n => {
    let sn = String(n).replace(/[\[\]:*?\/\\]/g, '_').slice(0, 28) || '老师', k = 2, cand = sn;
    while (used.has(cand)) cand = sn + k++;
    used.add(cand);
    addSheet(cand, rows.filter(r => r.姓名 === n));
  });
  return wb;
}
function payrollDownload(rows, label, who) {
  if (!rows.length) { alert('没有可下载的行'); return; }
  XLSX.writeFile(payrollBuildWorkbook(rows), `工资核算_${label}_${who}.xlsx`);
}
// work_records 一行 → Excel 行
const payrollRecToRow = r => ({ 姓名: r.teacher_name, 开始时间: r.start_time, 结束时间: r.end_time, 时长: r.duration, 工作内容: r.work_type, 工作地点: r.location, 备注: r.notes });

// ── 状态 ──
let payrollMonth = '';          // 'YYYY-MM'；空 = 自定义日期
let payrollCustomOpen = false;
let payrollStart = '';
let payrollEnd = '';
let payrollMode = '';           // 'teacher' | 'major' | 'all'
let payrollModeVal = '';        // 老师名 / 专业 key
let payrollRows = [];           // 生成出来的所有行（含勾选、改动）
let payrollCtx = null;          // { label, who, teachers, pending, pub }
let payrollFilter = 'all';      // all | new | changed | published | missing
let payrollQuery = '';
let payrollCollapsed = {};
let payrollPubOpen = false;

const payrollKey = (type, id) => type + ':' + id;
function payrollMonthList() {
  const out = [], d = new Date();
  for (let i = 0; i < 6; i++) { out.push(d.getFullYear() + '-' + payrollPad(d.getMonth() + 1)); d.setMonth(d.getMonth() - 1, 1); }
  return out;
}
function payrollRange() {
  if (payrollMonth) {
    const [y, m] = payrollMonth.split('-').map(Number);
    return { start: payrollMonth + '-01', end: payrollMonth + '-' + payrollPad(new Date(y, m, 0).getDate()) };
  }
  return { start: payrollStart, end: payrollEnd };
}
function payrollRangeLabel(start, end) {
  if (start.slice(0, 7) === end.slice(0, 7)) return start.slice(0, 4) + '年' + start.slice(5, 7) + '月';
  return start + '至' + end;
}
function payrollTeacherBase() { return (typeof teacherFilteredList === 'function') ? teacherFilteredList() : cachedTeachers; }

// 日期 / 时间显示：「2026年10月05日 13:00」→ 10-05、13:00
function payrollDT(s) {
  const m = String(s || '').match(/(\d{4})年(\d{2})月(\d{2})日\s*(\d{1,2}:\d{2})/);
  return m ? { d: m[2] + '-' + m[3], t: m[4] } : { d: '', t: String(s || '') };
}

// 行状态：new 未发布 / changed 有变化 / published 已发布
function payrollStatusOf(r) {
  const p = payrollCtx && payrollCtx.pub[payrollKey(r.type, r.source_id)];
  if (r.type === 'declare' && p && p.status === 'rejected') return 'rejected';
  if (!p || p.status !== 'approved') return 'new';
  return (payrollRound(p.duration) !== payrollRound(r.时长) || String(p.notes || '') !== String(r.备注 || '')) ? 'changed' : 'published';
}

// 已有的工作记录（任意状态），按 来源+source_id 对应
async function payrollLoadPub(rows) {
  const ids = [...new Set(rows.map(r => r.source_id))];
  const pub = {};
  for (let i = 0; i < ids.length; i += 60) {
    const part = await sb(`/rest/v1/work_records?source_id=in.(${ids.slice(i, i + 60).map(x => `"${x}"`).join(',')})&select=*`, 'GET', undefined, { cache: 'no-store' }) || [];
    part.forEach(p => {
      const k = payrollKey(p.source, p.source_id);
      if (!pub[k] || p.status === 'approved') pub[k] = p;
    });
  }
  return pub;
}

// ══════════════════════════════════
// 页面
// ══════════════════════════════════
function renderPayrollSection(container) {
  if (!payrollMonth && !payrollStart) payrollMonth = payrollMonthList()[0];
  container.innerHTML = `
  <div id="pr_legacy"></div>
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:16px;margin-top:16px">
    <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:12px;letter-spacing:.05em;text-transform:uppercase">工资核算</div>
    <div id="pr_pick"></div>
    <div id="pr_result" style="margin-top:14px"></div>
  </div>
  <div id="pr_published"></div>`;
  payrollRenderPick();
  payrollRenderResult();
  payrollRenderPublished();
  payrollLoadLegacy();
}

function payrollRenderPick() {
  const el = document.getElementById('pr_pick');
  if (!el) return;
  const rg = payrollRange();
  const chip = (on, click, text) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${click}">${text}</div>`;
  const teachers = payrollTeacherBase();
  el.innerHTML = `
  <div style="margin-bottom:12px">
    <label class="form-label">月份</label>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px">
      ${payrollMonthList().map(m => chip(payrollMonth === m, `payrollPickMonth('${m}')`, m.slice(0, 4) + '年' + m.slice(5) + '月')).join('')}
      ${chip(!payrollMonth, 'payrollToggleCustom()', '自定义日期 ' + (payrollCustomOpen || !payrollMonth ? '▴' : '▾'))}
    </div>
    <div style="display:${payrollCustomOpen || !payrollMonth ? 'flex' : 'none'};gap:8px;align-items:center;margin-top:8px">
      <input type="date" id="pr_start" value="${rg.start}" style="width:140px" onchange="payrollCustomDate()">
      <span style="font-size:11px;color:var(--text-3)">至</span>
      <input type="date" id="pr_end" value="${rg.end}" style="width:140px" onchange="payrollCustomDate()">
    </div>
  </div>
  <div style="margin-bottom:12px">
    <label class="form-label">老师</label>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:4px">
      <input id="pr_teacher" list="pr_teacher_list" placeholder="输入或选择老师" value="${payrollMode === 'teacher' ? escTM(payrollModeVal) : ''}" style="width:180px" onchange="payrollPickTeacher(this.value)">
      <datalist id="pr_teacher_list">${teachers.map(t => `<option value="${escTM(t.name)}"></option>`).join('')}</datalist>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center">
      <span style="font-size:10px;color:var(--text-3)">按专业</span>
      ${chipFold(majorFilterKeys().map(key => {
        const on = payrollMode === 'major' && payrollModeVal === key;
        return { on, html: chip(on, `payrollPickMode('major','${key}')`, escTM(majorLabel(key))) };
      }))}
      ${chip(payrollMode === 'all', "payrollPickMode('all','')", '全部老师')}
    </div>
  </div>
  <button class="btn btn-primary btn-sm" onclick="payrollGenerate()">生成</button>`;
}
function payrollPickMonth(m) { payrollMonth = m; payrollRenderPick(); }
function payrollToggleCustom() {
  if (!payrollMonth) { return; }
  const rg = payrollRange();
  payrollStart = rg.start; payrollEnd = rg.end;
  payrollMonth = '';
  payrollCustomOpen = true;
  payrollRenderPick();
}
function payrollCustomDate() {
  payrollStart = document.getElementById('pr_start').value;
  payrollEnd = document.getElementById('pr_end').value;
  payrollMonth = '';
}
function payrollPickTeacher(v) {
  v = String(v || '').trim();
  if (!v) { if (payrollMode === 'teacher') { payrollMode = ''; payrollModeVal = ''; } return; }
  if (!payrollTeacherBase().some(t => t.name === v)) { alert('没有这位老师：' + v); document.getElementById('pr_teacher').value = ''; return; }
  payrollMode = 'teacher'; payrollModeVal = v;
  payrollRenderPick();
}
function payrollPickMode(mode, val) { payrollMode = mode; payrollModeVal = val; payrollRenderPick(); }

async function payrollGenerate(keepEdits) {
  const rg = payrollRange();
  if (!rg.start || !rg.end || rg.start > rg.end) { alert('请选择有效日期范围'); return; }
  if (!payrollMode) { alert('请选择老师，或按专业 / 全部老师'); return; }
  const base = payrollTeacherBase();
  let names, who;
  if (payrollMode === 'teacher') { names = [payrollModeVal]; who = payrollModeVal; }
  else if (payrollMode === 'all') { names = base.map(t => t.name); who = '全部'; }
  else { names = base.filter(t => majorListHas(t.majors, payrollModeVal)).map(t => t.name); who = majorLabel(payrollModeVal); }
  if (!names.length) { alert('该专业下暂无老师'); return; }

  const snap = {};
  if (keepEdits) payrollRows.forEach(r => { snap[payrollKey(r.type, r.source_id)] = r; });
  const res = document.getElementById('pr_result');
  res.innerHTML = '<div style="font-size:12px;color:var(--text-3)">加载中…</div>';
  try {
    const { sessions, bookings, slots, courses, students, vipConfirmed, vipPending } = await payrollLoadData(rg.start, rg.end);
    const vipMap = {};
    vipConfirmed.forEach(b => { vipMap[b.id] = b; });
    const decls = await payrollLoadDeclares(names, rg.start, rg.end).catch(() => []);
    const rows = [], pending = {};
    names.forEach(n => {
      const auto = [
        ...buildCourseRows(sessions, n, courses),
        ...buildBookingRows(bookings, slots, n, students),
        ...buildVipRows(vipConfirmed, n, slots, students)
      ];
      const dl = buildDeclareRows(decls, n);
      dl.forEach(r => { r._overlap = payrollDeclareOverlap(r, auto); });
      const list = [...auto, ...dl].sort((a, b) => a._date.localeCompare(b._date) || a.开始时间.localeCompare(b.开始时间));
      list.forEach(r => { r._missing = r.type === 'vip' ? payrollVipMissing(vipMap[r.source_id]) : []; });
      rows.push(...list);
      const pl = buildVipPending(vipPending, n, slots, students);
      if (pl.length) pending[n] = pl;
    });
    const pub = await payrollLoadPub(rows);
    payrollCtx = { label: payrollRangeLabel(rg.start, rg.end), who, teachers: names.filter(n => rows.some(r => r.姓名 === n) || pending[n]), pending, pub };
    payrollRows = rows;
    payrollRows.forEach(r => {
      const old = snap[payrollKey(r.type, r.source_id)];
      if (old) { r.时长 = old.时长; r.备注 = old.备注; r._sel = old._sel; }
      else r._sel = payrollStatusOf(r) === 'new' && !r._overlap;   // 申告撞上大课 / 面谈 / VIP 的默认不勾
    });
    payrollFilter = 'all'; payrollQuery = '';
    payrollRenderResult();
  } catch (e) {
    res.innerHTML = `<div style="font-size:12px;color:var(--danger)">加载失败：${escTM(e.message)}</div>`;
  }
}

// ── 表 ──
function payrollRenderResult() {
  const res = document.getElementById('pr_result');
  if (!res) return;
  if (!payrollCtx) { res.innerHTML = '<div style="font-size:12px;color:var(--text-3)">选好月份和老师，点「生成」。</div>'; return; }
  const counts = { all: payrollRows.length, new: 0, changed: 0, published: 0, missing: 0, rejected: 0, declpend: 0 };
  payrollRows.forEach(r => { counts[payrollStatusOf(r)]++; if (r._missing.length) counts.missing++; if (r.type === 'declare' && payrollStatusOf(r) === 'new') counts.declpend++; });
  if (!payrollRows.length && !Object.keys(payrollCtx.pending).length) {
    res.innerHTML = '<div style="font-size:12px;color:var(--text-3);padding:12px 0">该时间段内无数据</div>';
    return;
  }
  const fchip = (k, t) => `<div class="filter-chip${payrollFilter === k ? ' active' : ''}" onclick="payrollSetFilter('${k}')">${t} ${counts[k]}</div>`;
  res.innerHTML = `
  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px">
    <span style="font-size:11px;color:var(--text-2)">${escTM(payrollCtx.label)} · ${escTM(payrollCtx.who)}</span>
    <button class="btn btn-outline btn-sm" onclick="payrollSelectVisible(true)">全选</button>
    <button class="btn btn-outline btn-sm" onclick="payrollSelectVisible(false)">全不选</button>
    ${fchip('all', '全部')}${fchip('new', '未发布')}${fchip('changed', '有变化')}${fchip('published', '已发布')}${fchip('missing', '记录不全')}${fchip('declpend', '申告待审批')}
    <input id="pr_q" placeholder="搜索备注、学生名" value="${escTM(payrollQuery)}" style="width:160px;margin-left:auto" oninput="payrollSetQuery(this.value)">
  </div>
  <div id="pr_groups"></div>
  <div id="pr_bar" style="position:sticky;bottom:0;z-index:5;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:10px 12px;margin-top:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;box-shadow:0 -2px 8px rgba(0,0,0,.06)"></div>`;
  payrollRenderGroups();
  payrollRenderBar();
}
function payrollSetFilter(k) { payrollFilter = k; payrollRenderResult(); }
function payrollSetQuery(v) { payrollQuery = v; payrollRenderGroups(); }
function payrollRowVisible(r) {
  if (payrollFilter === 'missing') { if (!r._missing.length) return false; }
  else if (payrollFilter === 'declpend') { if (r.type !== 'declare' || payrollStatusOf(r) !== 'new') return false; }
  else if (payrollFilter !== 'all' && payrollStatusOf(r) !== payrollFilter) return false;
  const q = payrollQuery.trim().toLowerCase();
  return !q || (String(r.备注) + ' ' + r.工作内容).toLowerCase().includes(q);
}
function payrollSelectVisible(on) {
  payrollRows.forEach(r => { if (payrollRowVisible(r)) r._sel = on; });
  payrollRenderGroups(); payrollRenderBar();
}

function payrollRowHtml(r, i) {
  const st = payrollStatusOf(r);
  const dt = payrollDT(r.开始时间), de = payrollDT(r.结束时间);
  const td = 'padding:5px 8px;';
  const badge = st === 'published' ? '<span style="font-size:10px;background:#e6e6e6;color:#666;border-radius:2px;padding:1px 6px">已发布</span>'
    : st === 'changed' ? '<span style="font-size:10px;background:#ffe8cc;color:#9a5a00;border-radius:2px;padding:1px 6px">有变化</span>'
    : st === 'rejected' ? '<span style="font-size:10px;background:#f8e0e0;color:#8a1a1a;border-radius:2px;padding:1px 6px">已驳回</span>'
    : r.type === 'declare' ? '<span style="font-size:10px;background:#fff3cd;color:#856404;border-radius:2px;padding:1px 6px">待审批</span>' : '';
  const isDecl = r.type === 'declare';
  const declTag = isDecl ? '<span style="font-size:10px;background:#e8f0fb;border:1px solid var(--border-light);border-radius:2px;padding:1px 5px;margin-right:4px">申告</span>' : '';
  const declNote = isDecl ? ((r._overlap ? `<div style="font-size:10px;color:#c0392b;margin-top:2px">和${escTM(r._overlap)}重叠</div>` : '')
    + (st === 'rejected' ? `<div style="font-size:10px;color:#8a1a1a;margin-top:2px">驳回原因：${escTM((payrollCtx.pub[payrollKey(r.type, r.source_id)] || {}).admin_note || '')}</div>` : '')) : '';
  const rejBtn = isDecl && st !== 'published' && st !== 'rejected' ? `<button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none;margin-left:6px" onclick="payrollRejectDeclare(${i})">驳回</button>` : '';
  const miss = r._missing.length ? `<div style="font-size:10px;color:#9a5a00;margin-top:2px">记录不全：缺 ${escTM(r._missing.join('、'))}</div>` : '';
  return `<tr style="border-bottom:1px solid var(--border-light);${st === 'published' ? 'color:#888;background:rgba(0,0,0,.025)' : st === 'rejected' ? 'color:#888;background:#fbeeee' : r._overlap ? 'background:#fdecec' : r._missing.length ? 'background:#fffbe8' : ''}">
    <td style="${td}width:24px"><input type="checkbox" ${r._sel ? 'checked' : ''} onchange="payrollToggleRow(${i},this.checked)"></td>
    <td style="${td}white-space:nowrap">${escTM(dt.d || r._date.slice(5))}</td>
    <td style="${td}white-space:nowrap;color:var(--text-2)">${escTM(dt.t)}${de.t ? '–' + escTM(de.t) : ''}</td>
    <td style="${td}"><input type="number" step="0.25" min="0" value="${r.时长}" style="width:64px;font-size:11px;padding:2px 4px" onchange="payrollEditHours(${i},this.value)"></td>
    <td style="${td}white-space:nowrap">${declTag}${escTM(r.工作内容)}</td>
    <td style="${td}white-space:nowrap;color:var(--text-2)">${escTM(r.工作地点)}</td>
    <td style="${td}min-width:200px"><input value="${escTM(r.备注)}" style="width:100%;font-size:11px;padding:2px 4px" onchange="payrollEditNote(${i},this.value)">${miss}${declNote}</td>
    <td style="${td}white-space:nowrap">${badge}${rejBtn}</td>
  </tr>`;
}
function payrollRenderGroups() {
  const box = document.getElementById('pr_groups');
  if (!box || !payrollCtx) return;
  box.innerHTML = payrollCtx.teachers.map((n, ti) => {
    const all = payrollRows.map((r, i) => ({ r, i })).filter(x => x.r.姓名 === n);
    const shown = all.filter(x => payrollRowVisible(x.r));
    const hours = payrollRound(all.filter(x => payrollStatusOf(x.r) !== 'rejected').reduce((s, x) => s + (parseFloat(x.r.时长) || 0), 0));
    const sel = all.filter(x => x.r._sel).length;
    const closed = payrollCollapsed[n];
    const head = `<div onclick="payrollToggleGroup(${ti})" style="cursor:pointer;font-size:12px;font-weight:600;padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:6px">${closed ? '▸' : '▾'} ${escTM(n)}
      <span style="font-weight:400;font-size:11px;color:var(--text-2);margin-left:8px">${all.length} 节 · ${hours} 小时 · 已勾选 ${sel} 条</span></div>`;
    const body = closed ? '' : (shown.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:var(--bg)">${['', '日期', '时间', '时长(h)', '工作内容', '地点', '备注', ''].map(h => `<th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600;color:var(--text-2);white-space:nowrap">${h}</th>`).join('')}</tr></thead>
      <tbody>${shown.map(x => payrollRowHtml(x.r, x.i)).join('')}</tbody></table></div>`
      : `<div style="font-size:11px;color:var(--text-3);padding:6px 0">${all.length ? '当前筛选下没有行' : '该时间段内没有可发布的记录'}</div>`);
    return `<div style="margin-bottom:16px">${head}${body}${closed ? '' : payrollPendingHtml(payrollCtx.pending[n] || [])}</div>`;
  }).join('');
}
function payrollToggleGroup(ti) { const n = payrollCtx.teachers[ti]; payrollCollapsed[n] = !payrollCollapsed[n]; payrollRenderGroups(); }
function payrollToggleRow(i, on) { payrollRows[i]._sel = on; payrollRenderGroups(); payrollRenderBar(); }
function payrollEditHours(i, v) {
  const r = payrollRows[i], n = parseFloat(v);
  if (!(n >= 0)) { payrollRenderGroups(); return; }
  r.时长 = payrollRound(n);
  if (payrollStatusOf(r) === 'changed') r._sel = true;
  payrollRenderGroups(); payrollRenderBar();
}
function payrollEditNote(i, v) {
  const r = payrollRows[i];
  r.备注 = v;
  if (payrollStatusOf(r) === 'changed') r._sel = true;
  payrollRenderGroups(); payrollRenderBar();
}

// 驳回申告：必须写原因，老师端马上能看到
async function payrollRejectDeclare(i) {
  const r = payrollRows[i];
  if (!r || r.type !== 'declare') return;
  const why = (prompt(`驳回「${r.姓名} · ${r.工作内容}」这条申告，请写驳回原因：`) || '').trim();
  if (!why) { alert('驳回必须写原因'); return; }
  try {
    await sb(`/rest/v1/work_records?id=eq.${encodeURIComponent(r.source_id)}`, 'PATCH', { status: 'rejected', admin_note: why, updated_at: new Date().toISOString() });
    payrollCtx.pub = await payrollLoadPub(payrollRows);
    r._sel = false;
    payrollRenderResult();
  } catch (e) { alert('驳回失败：' + e.message); }
}

// 待学生确认（不计入本月）：每位老师组下面
function payrollPendingHtml(list) {
  if (!list.length) return '';
  const total = payrollRound(list.reduce((t, x) => t + x.hours, 0));
  return `<div style="margin-top:8px;background:#fff8e1;border:1px solid #e6a817;border-radius:3px;padding:9px 12px">
    <div style="font-size:12px;font-weight:600;color:#856404">待学生确认（不计入本月）：${list.length} 节 · ${total} 课时</div>
    <div style="font-size:10px;color:var(--text-3);margin:2px 0 6px">老师已填上课记录，学生确认并评价（教务可代确认）之后，按确认的日期算进当月工资。</div>
    ${list.map(x => `<div style="font-size:11px;padding:3px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span>${escTM(x.name)} · ${escTM(x.date)} ${escTM(x.range)}${x.hours ? ' · ' + x.hours + 'h' : ''}</span>
      <button class="btn btn-outline btn-sm" onclick="payrollProxyConfirm('${escTM(x.id)}')">代学生确认</button></div>`).join('')}
  </div>`;
}
// 用管理端 booking.js 的同一个代确认弹窗，确认后重新生成（保留已改的时长、备注和勾选）
function payrollProxyConfirm(id) {
  bkBfProxyOpen(id, () => payrollGenerate(true));
}

// ── 底部操作栏 ──
function payrollSelected() { return payrollRows.filter(r => r._sel); }
function payrollRenderBar() {
  const bar = document.getElementById('pr_bar');
  if (!bar) return;
  const sel = payrollSelected();
  const hours = payrollRound(sel.reduce((s, r) => s + (parseFloat(r.时长) || 0), 0));
  const tn = new Set(sel.map(r => r.姓名)).size;
  bar.innerHTML = `<span style="font-size:12px">已勾选 <strong>${sel.length}</strong> 条 · 合计 <strong>${hours}</strong> 小时 · 涉及 <strong>${tn}</strong> 位老师</span>
    <span style="margin-left:auto;display:flex;gap:8px">
      <button class="btn btn-outline btn-sm" onclick="payrollDownloadSelected()">↓ 下载 Excel</button>
      <button class="btn btn-primary btn-sm" onclick="payrollPublish()">✓ 确定发布</button>
    </span>`;
}
function payrollDownloadSelected() {
  const sel = payrollSelected();
  if (!sel.length) { alert('请先勾选要下载的行'); return; }
  // 多位老师按老师分表：保持老师顺序
  const order = payrollCtx.teachers;
  const rows = [...sel].sort((a, b) => order.indexOf(a.姓名) - order.indexOf(b.姓名));
  payrollDownload(rows, payrollCtx.label, payrollCtx.who);
}

// ── 确定发布：直接 approved；同 source_id 有变化就更新，没变化跳过 ──
async function payrollPublish() {
  const sel = payrollSelected();
  if (!sel.length) { alert('请先勾选要发布的行'); return; }
  const toNew = [], toUpd = [];
  let skipped = 0;
  sel.forEach(r => {
    const p = payrollCtx.pub[payrollKey(r.type, r.source_id)];
    if (!p) toNew.push(r);
    else if (payrollStatusOf(r) === 'published') skipped++;
    else toUpd.push({ r, p });
  });
  if (!toNew.length && !toUpd.length) { alert('勾选的行都已发布且没有变化，无需重复发布'); return; }
  if (!confirm(`发布后老师在老师端能看到这些工作记录。共 ${toNew.length + toUpd.length} 条，其中新增 ${toNew.length}、更新 ${toUpd.length}${skipped ? `（另有 ${skipped} 条已发布且无变化，跳过）` : ''}`)) return;
  const now = new Date().toISOString();
  const fields = r => ({
    teacher_name: r.姓名, start_time: r.开始时间, end_time: r.结束时间, duration: r.时长,
    work_type: r.工作内容, location: r.工作地点, notes: r.备注, source: r.type, source_id: r.source_id,
    domain: r._domain || null, status: 'approved'
  });
  try {
    const ins = toNew.map(r => ({ id: `wr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}-${Math.random().toString(36).slice(2, 5)}`, ...fields(r) }));
    for (let i = 0; i < ins.length; i += 20) await sb('/rest/v1/work_records', 'POST', ins.slice(i, i + 20));
    for (let i = 0; i < toUpd.length; i += 10) {
      await Promise.all(toUpd.slice(i, i + 10).map(({ r, p }) =>
        sb(`/rest/v1/work_records?id=eq.${encodeURIComponent(p.id)}`, 'PATCH', { ...fields(r), admin_note: null, updated_at: now })));
    }
    payrollCtx.pub = await payrollLoadPub(payrollRows);
    payrollRows.forEach(r => { if (payrollStatusOf(r) === 'published') r._sel = false; });
    alert(`已发布：新增 ${toNew.length}、更新 ${toUpd.length}`);
    payrollRenderResult();
    payrollRenderPublished();
  } catch (e) { alert('发布失败：' + e.message); }
}

// ══════════════════════════════════
// 已发布记录：按月份 → 老师；只看、可下载、可撤回
// ══════════════════════════════════
let payrollPubRecords = null;
let payrollPubOpenKeys = {};
const payrollRecMonth = r => { const m = String(r.start_time || '').match(/(\d{4})年(\d{2})月/); return m ? m[1] + '-' + m[2] : '未知月份'; };
const payrollFmtTime = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : `${d.getFullYear()}-${payrollPad(d.getMonth() + 1)}-${payrollPad(d.getDate())} ${payrollPad(d.getHours())}:${payrollPad(d.getMinutes())}`;
};

async function payrollRenderPublished() {
  const box = document.getElementById('pr_published');
  if (!box) return;
  const head = `<div onclick="payrollTogglePublished()" style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-2);letter-spacing:.05em;margin:20px 0 10px">${payrollPubOpen ? '▾' : '▸'} 已发布记录</div>`;
  if (!payrollPubOpen) { box.innerHTML = head; return; }
  box.innerHTML = head + '<div style="font-size:12px;color:var(--text-3)">加载中…</div>';
  try {
    payrollPubRecords = await sbAll(`/rest/v1/work_records?status=eq.approved&order=start_time.asc${payrollDomainQs()}`);
    payrollRenderPublishedBody();
  } catch (e) {
    box.innerHTML = head + `<div style="font-size:12px;color:var(--danger)">加载失败：${escTM(e.message)}</div>`;
  }
}
function payrollTogglePublished() { payrollPubOpen = !payrollPubOpen; payrollRenderPublished(); }
// 分组：月份 → 老师
function payrollPubGroups() {
  const g = {};
  (payrollPubRecords || []).forEach(r => {
    const m = payrollRecMonth(r);
    ((g[m] = g[m] || {})[r.teacher_name] = g[m][r.teacher_name] || []).push(r);
  });
  return g;
}
function payrollRenderPublishedBody() {
  const box = document.getElementById('pr_published');
  if (!box) return;
  const head = `<div onclick="payrollTogglePublished()" style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-2);letter-spacing:.05em;margin:20px 0 10px">▾ 已发布记录</div>`;
  const g = payrollPubGroups();
  const months = Object.keys(g).sort().reverse();
  if (!months.length) { box.innerHTML = head + '<div style="font-size:12px;color:var(--text-3)">暂无已发布的记录</div>'; return; }
  box.innerHTML = head + months.map(m => `
    <div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px">${m.length === 7 ? m.slice(0, 4) + '年' + m.slice(5) + '月' : m}</div>
      ${Object.keys(g[m]).sort().map(n => {
        const list = g[m][n];
        const k = m + '|' + n;
        const open = payrollPubOpenKeys[k];
        const hours = payrollRound(list.reduce((s, r) => s + (parseFloat(r.duration) || 0), 0));
        const last = list.map(r => r.updated_at || r.created_at || '').sort().pop();
        const ek = escTM(k);
        return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:8px 12px;margin-bottom:6px;font-size:11px">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
            <span style="font-weight:600;min-width:80px">${escTM(n)}</span>
            <span>${list.length} 节 · ${hours} 小时</span>
            <span style="color:var(--text-3)">${last ? '发布于 ' + payrollFmtTime(last) : ''}</span>
            <span style="margin-left:auto;display:flex;gap:6px">
              <button class="btn btn-outline btn-sm" data-k="${ek}" onclick="payrollPubToggle(this.dataset.k)">${open ? '收起' : '展开'}</button>
              <button class="btn btn-outline btn-sm" data-k="${ek}" onclick="payrollPubDownload(this.dataset.k)">↓ 下载</button>
              <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" data-k="${ek}" onclick="payrollPubRetract(this.dataset.k)">撤回</button>
            </span>
          </div>
          ${open ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-light)">${list.map(r => `<div style="padding:2px 0;color:var(--text-2)">${escTM(r.start_time)} → ${escTM(payrollDT(r.end_time).t)} · ${r.duration}h · ${escTM(r.work_type)} · ${escTM(r.location)} · ${escTM(r.notes)}</div>`).join('')}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`).join('');
}
function payrollPubList(k) { const [m, n] = k.split('|'); return ((payrollPubGroups()[m] || {})[n]) || []; }
function payrollPubToggle(k) { payrollPubOpenKeys[k] = !payrollPubOpenKeys[k]; payrollRenderPublishedBody(); }
function payrollPubDownload(k) {
  const list = payrollPubList(k);
  if (!list.length) return;
  const [m, n] = k.split('|');
  payrollDownload(list.map(payrollRecToRow), m.length === 7 ? m.slice(0, 4) + '年' + m.slice(5) + '月' : m, n);
}
async function payrollPubRetract(k) {
  const list = payrollPubList(k);
  if (!list.length) return;
  const [m, n] = k.split('|');
  if (!confirm(`撤回「${n}」${m.length === 7 ? m.slice(0, 4) + '年' + m.slice(5) + '月' : m}已发布的 ${list.length} 条记录？\n撤回后会删除这些记录，老师端随即看不到。`)) return;
  try {
    const ids = list.map(r => r.id);
    for (let i = 0; i < ids.length; i += 50) {
      await sb(`/rest/v1/work_records?id=in.(${ids.slice(i, i + 50).map(x => `"${x}"`).join(',')})`, 'DELETE');
    }
    if (payrollCtx) {
      payrollCtx.pub = await payrollLoadPub(payrollRows);
      payrollRenderResult();
    }
    payrollRenderPublished();
  } catch (e) { alert('撤回失败：' + e.message); }
}

// ══════════════════════════════════
// 旧数据：改版前提交、还停在待审核 / 已驳回的记录
// ══════════════════════════════════
async function payrollLoadLegacy() {
  const box = document.getElementById('pr_legacy');
  if (!box) return;
  try {
    const rows = await sbAll(`/rest/v1/work_records?status=in.(pending,rejected)&or=(source.is.null,source.neq.declare)&select=id${payrollDomainQs()}`);
    if (!rows.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div style="background:#fff8e1;border:1px solid #e6a817;border-radius:3px;padding:10px 12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <span style="font-size:12px;color:#856404;font-weight:600">有 ${rows.length} 条旧的待审核记录（改版前提交的）</span>
      <span style="margin-left:auto;display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" onclick="payrollLegacyPublish()">全部发布</button>
        <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="payrollLegacyDelete()">全部删除</button>
      </span></div>`;
    box.dataset.ids = JSON.stringify(rows.map(r => r.id));
  } catch (e) { box.innerHTML = ''; }
}
function payrollLegacyIds() { try { return JSON.parse(document.getElementById('pr_legacy').dataset.ids || '[]'); } catch (e) { return []; } }
async function payrollLegacyPublish() {
  const ids = payrollLegacyIds();
  if (!ids.length || !confirm(`把这 ${ids.length} 条旧记录全部发布？发布后老师在老师端能看到。`)) return;
  try {
    const now = new Date().toISOString();
    for (let i = 0; i < ids.length; i += 50) {
      await sb(`/rest/v1/work_records?id=in.(${ids.slice(i, i + 50).map(x => `"${x}"`).join(',')})`, 'PATCH', { status: 'approved', admin_note: null, updated_at: now });
    }
    payrollLoadLegacy(); payrollRenderPublished();
  } catch (e) { alert('操作失败：' + e.message); }
}
async function payrollLegacyDelete() {
  const ids = payrollLegacyIds();
  if (!ids.length || !confirm(`删除这 ${ids.length} 条旧的待审核记录？删除后无法恢复。`)) return;
  try {
    for (let i = 0; i < ids.length; i += 50) {
      await sb(`/rest/v1/work_records?id=in.(${ids.slice(i, i + 50).map(x => `"${x}"`).join(',')})`, 'DELETE');
    }
    payrollLoadLegacy();
  } catch (e) { alert('操作失败：' + e.message); }
}

// ── VIP 记录完整度（读自预约本身） ──
function payrollVipMissing(b) {
  if (!b) return ['对应的 VIP 预约（已被删除？）'];
  const t = v => String(v == null ? '' : v).trim();
  const hwOk = t(b.vip_homework) || (Array.isArray(b.vip_homework_questions) ? b.vip_homework_questions.length : b.vip_homework_questions && Object.keys(b.vip_homework_questions).length);
  const out = [];
  if (!t(b.vip_content)) out.push('本次内容');
  if (!t(b.vip_session_notes)) out.push('上课内容');
  if (!t(b.vip_student_status)) out.push('学生状态/评价');
  if (!hwOk) out.push('布置作业');
  if (!(parseFloat(b.vip_hours_used) > 0)) out.push('本次耗时');
  return out;
}

function renderPayrollPage(mc){
  mc.innerHTML = `
  <div class="page-section">
    <div class="section-title">工作管理</div>
    <div class="section-sub">工资核算：生成 → 核对 → 下载 Excel 或发布给老师</div>
  </div>
  <div id="payrollContainer"></div>`;
  renderPayrollSection(document.getElementById('payrollContainer'));
}
