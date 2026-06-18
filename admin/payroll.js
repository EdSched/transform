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
function parseTimeRange(dateStr, timeRange) {
  if (!dateStr || !timeRange) return { start: '', end: '', hours: 0 };
  const parts = timeRange.split(/[–\-]/);
  if (parts.length < 2) return { start: '', end: '', hours: 0 };
  const startT = parts[0].trim();
  const endT = parts[1].trim();
  const [sh, sm] = startT.split(':').map(Number);
  const [eh, em] = endT.split(':').map(Number);
  const hours = Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 60 * 10) / 10;
  const d = new Date(dateStr + 'T12:00:00');
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
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
  return { start: fmt(d), end: fmt(endD), hours: Math.round(mins / 60 * 10) / 10 };
}

// ── 生成课程行 ──
function buildCourseRows(sessions, teacherName) {
  return sessions
    .filter(s => (s.teacher === teacherName || s.session_teacher === teacherName))
    .map(s => {
      const { start, end, hours } = parseTimeRange(s.session_date, s.time_range);
      return {
        type: 'course',
        source_id: s.id,
        姓名: teacherName,
        开始时间: start,
        结束时间: end,
        时长: hours,
        工作内容: payrollWorkType(s.course_type),
        工作地点: payrollLocation(s.delivery, s.campus),
        备注: `${s.course_name} 第${s.session_number}回`,
        _date: s.session_date
      };
    });
}

// ── 生成面谈行 ──
function buildBookingRows(bookings, slots, teacherName) {
  const teacherSlotIds = new Set(
    slots.filter(s => s.teacher_name === teacherName).map(s => s.id)
  );
  return bookings
    .filter(b => b.status !== 'cancelled' && b.actual_time && teacherSlotIds.has(b.slot_id))
    .map(b => {
      const { start, end, hours } = bookingTimes(b);
      const slot = slots.find(s => s.id === b.slot_id);
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
        备注: `${b.name}的面谈预约`,
        _date: (b.actual_time || b.slot_date || '').slice(0, 10)
      };
    });
}

// ── Excel 导出 ──
function exportPayrollExcel(rows, teacherName, dateRange) {
  const headers = ['姓名', '开始时间', '结束时间', '时长', '工作内容', '工作地点', '备注'];
  const csvRows = [headers.join('\t')];
  rows.forEach(r => csvRows.push(headers.map(h => r[h] ?? '').join('\t')));
  const blob = new Blob(['\ufeff' + csvRows.join('\n')], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `工资核算_${teacherName}_${dateRange}.xls`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ══════════════════════════════════
// 渲染工资核算区块
// ══════════════════════════════════

let payrollTeacher = '';
let payrollStart = '';
let payrollEnd = '';
let payrollRows = [];

function renderPayrollSection(container) {
  const today = new Date();
  if (!payrollStart) payrollStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  if (!payrollEnd) payrollEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

  container.innerHTML = `
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:16px;margin-top:16px">
    <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:14px;letter-spacing:.05em;text-transform:uppercase">工资核算</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px">
      <div class="form-group" style="margin:0;min-width:140px">
        <label class="form-label">老师</label>
        <select id="pr_teacher">
          <option value="">请选择老师</option>
          ${cachedTeachers.map(t => `<option value="${t.name}" ${payrollTeacher === t.name ? 'selected' : ''}>${t.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">开始日期</label>
        <input type="date" id="pr_start" value="${payrollStart}" style="width:140px">
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">结束日期</label>
        <input type="date" id="pr_end" value="${payrollEnd}" style="width:140px">
      </div>
      <button class="btn btn-primary btn-sm" onclick="runPayroll()">生成</button>
    </div>
    <div id="pr_result"></div>
  </div>`;
}

async function runPayroll() {
  const teacherName = document.getElementById('pr_teacher').value;
  const start = document.getElementById('pr_start').value;
  const end = document.getElementById('pr_end').value;
  if (!teacherName) { alert('请选择老师'); return; }
  if (!start || !end || start > end) { alert('请选择有效日期范围'); return; }
  payrollTeacher = teacherName;
  payrollStart = start;
  payrollEnd = end;

  const res = document.getElementById('pr_result');
  res.innerHTML = '<div style="font-size:12px;color:var(--text-3)">加载中…</div>';

  try {
    const [sessions, bookings, slots] = await Promise.all([
      sb(`/rest/v1/course_sessions?select=*&session_date=gte.${start}&session_date=lte.${end}&order=session_date.asc`),
      sb(`/rest/v1/bookings?select=*&slot_date=gte.${start}&slot_date=lte.${end}&order=slot_date.asc`),
      sb(`/rest/v1/slots?select=*&date=gte.${start}&date=lte.${end}`)
    ]);

    const courseRows = buildCourseRows(sessions, teacherName);
    const bookingRows = buildBookingRows(bookings, slots, teacherName);
    payrollRows = [...courseRows, ...bookingRows].sort((a, b) => a._date.localeCompare(b._date));

    if (!payrollRows.length) {
      res.innerHTML = '<div style="font-size:12px;color:var(--text-3);padding:12px 0">该时间段内无数据</div>';
      return;
    }

    const totalHours = Math.round(payrollRows.reduce((s, r) => s + (r.时长 || 0), 0) * 10) / 10;
    const courseCount = courseRows.length;
    const bookingCount = bookingRows.length;
    const dateRange = `${start.slice(0, 7).replace('-', '年')}月`;

    res.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-size:11px;color:var(--text-3)">
        大课 <strong style="color:var(--text)">${courseCount}</strong> 节 ·
        面谈 <strong style="color:var(--text)">${bookingCount}</strong> 次 ·
        合计 <strong style="color:var(--text)">${totalHours}</strong> 小时
      </div>
      <button class="btn btn-outline btn-sm" onclick="exportPayrollExcel(payrollRows,'${teacherName}','${dateRange}')">↓ 导出 Excel</button>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr style="background:var(--bg)">
            ${['姓名','开始时间','结束时间','时长(h)','工作内容','工作地点','备注'].map(h =>
              `<th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600;color:var(--text-2);white-space:nowrap">${h}</th>`
            ).join('')}
          </tr>
        </thead>
        <tbody>
          ${payrollRows.map((r, i) => `
          <tr style="border-bottom:1px solid var(--border-light);background:${r.type === 'booking' ? 'rgba(42,106,173,0.03)' : 'transparent'}">
            <td style="padding:6px 8px;white-space:nowrap">${r.姓名}</td>
            <td style="padding:6px 8px;white-space:nowrap;color:var(--text-2)">${r.开始时间}</td>
            <td style="padding:6px 8px;white-space:nowrap;color:var(--text-2)">${r.结束时间}</td>
            <td style="padding:6px 8px;text-align:center;font-weight:600">${r.时长}</td>
            <td style="padding:6px 8px"><span style="font-size:10px;background:${r.type === 'booking' ? '#e8f0fb' : 'var(--bg)'};border:1px solid var(--border-light);border-radius:2px;padding:1px 6px">${r.工作内容}</span></td>
            <td style="padding:6px 8px;color:var(--text-2)">${r.工作地点}</td>
            <td style="padding:6px 8px;color:var(--text-2)">${r.备注}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  } catch(e) {
    res.innerHTML = `<div style="font-size:12px;color:var(--danger)">加载失败：${e.message}</div>`;
  }
}
