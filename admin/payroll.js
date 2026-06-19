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
function buildCourseRows(sessions, teacherName, courses) {
  // courses 用于 time_range/actual_hours fallback（旧课次可能没有该字段）
  const courseMap = {};
  (courses || []).forEach(c => { courseMap[c.id] = c; });
  return sessions
    .filter(s => (s.teacher === teacherName || s.session_teacher === teacherName))
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
let payrollTeachers = [];
let payrollStart = '';
let payrollEnd = '';
let payrollRows = [];

function renderPayrollSection(container) {
  const today = new Date();
  if (!payrollStart) payrollStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  if (!payrollEnd) payrollEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

  const majorList = [['keiei','経営学'],['keizai','経済学'],['shakai','社会学'],['shinpan','新闻传播学'],['fukushi','社会福祉学']];

  container.innerHTML = `
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:16px;margin-top:16px">
    <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:14px;letter-spacing:.05em;text-transform:uppercase">工资核算</div>

    <div style="margin-bottom:10px">
      <label class="form-label">按专业快速选择老师</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
        ${majorList.map(([key,label]) => `<button class="btn btn-outline btn-sm" onclick="selectTeachersByMajor('${key}')">${label}</button>`).join('')}
        <button class="btn btn-outline btn-sm" onclick="selectAllTeachers()">全选</button>
        <button class="btn btn-outline btn-sm" onclick="clearTeacherSelection()">清空</button>
      </div>
    </div>

    <div style="margin-bottom:14px">
      <label class="form-label">老师（可多选）</label>
      <div id="pr_teacher_list" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;padding:10px;background:var(--bg);border:1px solid var(--border-light);border-radius:3px;max-height:140px;overflow-y:auto">
        ${cachedTeachers.map(t => `
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;background:var(--surface);border:1px solid var(--border);border-radius:2px;padding:3px 8px;cursor:pointer">
            <input type="checkbox" class="pr_teacher_cb" value="${t.name}" ${payrollTeachers.includes(t.name)?'checked':''} style="margin:0">
            ${t.name}
          </label>`).join('')}
      </div>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px">
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
    <div id="pr_submit_bar" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-light)">
      <button class="btn btn-primary btn-sm" onclick="submitWorkRecords()">↑ 提交到工作记录</button>
      <span style="font-size:11px;color:var(--text-3);margin-left:8px">提交后可在下方审核，老师端可查看已通过的记录</span>
    </div>
  </div>
  <div id="pr_records"></div>`;

  renderWorkRecordsAdmin(document.getElementById('pr_records'));
}

function selectTeachersByMajor(majorKey) {
  document.querySelectorAll('.pr_teacher_cb').forEach(cb => {
    const t = cachedTeachers.find(x => x.name === cb.value);
    cb.checked = !!(t && (t.majors || []).includes(majorKey));
  });
}
function selectAllTeachers() {
  document.querySelectorAll('.pr_teacher_cb').forEach(cb => cb.checked = true);
}
function clearTeacherSelection() {
  document.querySelectorAll('.pr_teacher_cb').forEach(cb => cb.checked = false);
}
function getSelectedTeachers() {
  return [...document.querySelectorAll('.pr_teacher_cb:checked')].map(cb => cb.value);
}

async function runPayroll() {
  const teacherNames = getSelectedTeachers();
  const start = document.getElementById('pr_start').value;
  const end = document.getElementById('pr_end').value;
  if (!teacherNames.length) { alert('请至少选择一位老师'); return; }
  if (!start || !end || start > end) { alert('请选择有效日期范围'); return; }
  payrollTeachers = teacherNames;
  payrollStart = start;
  payrollEnd = end;

  const res = document.getElementById('pr_result');
  res.innerHTML = '<div style="font-size:12px;color:var(--text-3)">加载中…</div>';

  try {
    const [sessions, bookings, slots, courses] = await Promise.all([
      sb(`/rest/v1/course_sessions?select=*&session_date=gte.${start}&session_date=lte.${end}&order=session_date.asc`),
      sb(`/rest/v1/bookings?select=*&slot_date=gte.${start}&slot_date=lte.${end}&order=slot_date.asc`),
      sb(`/rest/v1/slots?select=*&date=gte.${start}&date=lte.${end}`),
      sb(`/rest/v1/courses?select=id,time_range,course_type,delivery,campus,actual_hours`)
    ]);

    payrollRows = [];
    teacherNames.forEach(teacherName => {
      const courseRows = buildCourseRows(sessions, teacherName, courses);
      const bookingRows = buildBookingRows(bookings, slots, teacherName);
      payrollRows.push(...courseRows, ...bookingRows);
    });
    payrollRows.sort((a, b) => a.姓名.localeCompare(b.姓名) || a._date.localeCompare(b._date));

    if (!payrollRows.length) {
      res.innerHTML = '<div style="font-size:12px;color:var(--text-3);padding:12px 0">该时间段内无数据</div>';
      return;
    }

    const courseCount = payrollRows.filter(r => r.type === 'course').length;
    const bookingCount = payrollRows.filter(r => r.type === 'booking').length;
    const totalHours = Math.round(payrollRows.reduce((s, r) => s + (r.时长 || 0), 0) * 100) / 100;
    const dateRange = `${start.slice(0, 7).replace('-', '年')}月`;
    const submitBar = document.getElementById('pr_submit_bar');
    if (submitBar) submitBar.style.display = 'block';

    // 按老师分组小计
    const byTeacher = {};
    payrollRows.forEach(r => { (byTeacher[r.姓名] = byTeacher[r.姓名] || []).push(r); });

    res.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-size:11px;color:var(--text-3)">
        ${teacherNames.length} 位老师 ·
        大课 <strong style="color:var(--text)">${courseCount}</strong> 节 ·
        面谈 <strong style="color:var(--text)">${bookingCount}</strong> 次 ·
        合计 <strong style="color:var(--text)">${totalHours}</strong> 小时
      </div>
      <button class="btn btn-outline btn-sm" onclick="exportPayrollExcel(payrollRows,'${teacherNames.length>1?'批量':teacherNames[0]}','${dateRange}')">↓ 导出 Excel（全部）</button>
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

// ══════════════════════════════════
// 工作记录 — Admin 审核
// ══════════════════════════════════

// 把 payrollRows 提交固化到 work_records 表
async function submitWorkRecords() {
  if (!payrollRows.length) { alert('请先生成工资核算数据'); return; }
  const teacherNames = [...new Set(payrollRows.map(r => r.姓名))];
  const existing = await sb(`/rest/v1/work_records?teacher_name=in.(${teacherNames.map(n=>`"${n}"`).join(',')})&select=source_id`);
  const existingIds = new Set((existing || []).map(r => r.source_id));
  const toInsert = payrollRows
    .filter(r => !existingIds.has(r.source_id))
    .map(r => ({
      id: `wr-${Date.now()}-${Math.random().toString(36).slice(2,5)}-${Math.random().toString(36).slice(2,5)}`,
      teacher_name: r.姓名,
      start_time: r.开始时间,
      end_time: r.结束时间,
      duration: r.时长,
      work_type: r.工作内容,
      location: r.工作地点,
      notes: r.备注,
      source: r.type,
      source_id: r.source_id,
      status: 'pending'
    }));
  if (!toInsert.length) { alert('所有记录已提交过，无新增'); return; }
  try {
    for (let i = 0; i < toInsert.length; i += 20) {
      await sb('/rest/v1/work_records', 'POST', toInsert.slice(i, i + 20));
    }
    alert(`已提交 ${toInsert.length} 条记录（${teacherNames.length} 位老师），待审核`);
    renderWorkRecordsAdmin(document.getElementById('pr_records'));
  } catch(e) { alert('提交失败：' + e.message); }
}

// Admin 审核界面
async function renderWorkRecordsAdmin(container) {
  if (!container) return;
  container.innerHTML = '<div style="font-size:12px;color:var(--text-3)">加载中…</div>';
  try {
    const records = await sb(`/rest/v1/work_records?order=start_time.asc`);
    if (!records.length) {
      container.innerHTML = '<div style="font-size:12px;color:var(--text-3);padding:12px 0">暂无工作记录</div>';
      return;
    }
    // 按老师分组
    const byTeacher = {};
    records.forEach(r => { if (!byTeacher[r.teacher_name]) byTeacher[r.teacher_name] = []; byTeacher[r.teacher_name].push(r); });

    container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin:20px 0 12px">
      <div style="font-size:12px;font-weight:600;color:var(--text-2);letter-spacing:.05em;text-transform:uppercase">工作记录审核</div>
      <button class="btn btn-outline btn-sm" onclick="exportAllWorkRecordsExcel()">↓ 全部导出（已通过）</button>
    </div>
    ${Object.entries(byTeacher).map(([name, rows]) => {
      const pending = rows.filter(r => r.status === 'pending').length;
      const approved = rows.filter(r => r.status === 'approved').length;
      const safeId = name.replace(/[^a-zA-Z0-9]/g, '_');
      return `
      <div style="margin-bottom:16px">
        <div style="font-size:11px;font-weight:600;color:var(--text);padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="cursor:pointer" onclick="toggleWrGroup('${safeId}')">▾ ${name}</span>
          ${pending ? `<span style="font-size:10px;background:#fff3cd;color:#856404;border-radius:2px;padding:1px 6px">${pending} 待审核</span>` : ''}
          ${pending ? `<button class="btn btn-sm" style="background:#ddf0e0;color:#1a4a28;border:1px solid #b0d8b8" onclick="approveAllWorkRecords('${name}')">全部通过</button>` : ''}
          <div style="display:flex;gap:4px;margin-left:auto">
            <button class="btn btn-outline btn-sm" onclick="exportWorkRecordsExcel('${name}')">↓ 导出</button>
            ${approved ? `<button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="deleteApprovedWorkRecords('${name}')">删除已通过</button>` : ''}
            <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="deleteAllWorkRecords('${name}')">全部删除</button>
          </div>
        </div>
        <div id="wr_group_${safeId}">
          ${rows.map(r => renderWorkRecordRow(r)).join('')}
        </div>
      </div>`;
    }).join('')}`;
  } catch(e) {
    container.innerHTML = `<div style="font-size:12px;color:var(--danger)">加载失败：${e.message}</div>`;
  }
}

function renderWorkRecordRow(r) {
  const statusColor = r.status === 'approved' ? '#1a4a28' : r.status === 'rejected' ? '#8a1a1a' : '#856404';
  const statusBg = r.status === 'approved' ? '#ddf0e0' : r.status === 'rejected' ? '#f8e0e0' : '#fff3cd';
  const statusLabel = r.status === 'approved' ? '已通过' : r.status === 'rejected' ? '已驳回' : '待审核';
  return `
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:10px 12px;margin-bottom:6px;font-size:11px" id="wr_row_${r.id}">
    <div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
          <span style="font-weight:600">${r.start_time}</span>
          <span style="color:var(--text-3)">→ ${r.end_time}</span>
          <span style="font-weight:600;color:var(--accent)">${r.duration}h</span>
          <span style="background:var(--bg);border:1px solid var(--border-light);border-radius:2px;padding:1px 5px">${r.work_type}</span>
          <span style="background:${statusBg};color:${statusColor};border-radius:2px;padding:1px 5px">${statusLabel}</span>
        </div>
        <div style="color:var(--text-3)">${r.location} · ${r.notes}</div>
        ${r.admin_note ? `<div style="margin-top:4px;color:var(--text-2);font-style:italic">备注：${r.admin_note}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
        <div style="display:flex;gap:4px">
          <button class="btn btn-outline btn-sm" onclick="openEditWorkRecord('${r.id}')">编辑</button>
          <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger)" onclick="deleteWorkRecord('${r.id}')">删除</button>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm" style="background:#ddf0e0;color:#1a4a28;border:1px solid #b0d8b8" onclick="approveWorkRecord('${r.id}')">通过</button>
          <button class="btn btn-sm" style="background:#f8e0e0;color:#8a1a1a;border:1px solid #d8b0b0" onclick="rejectWorkRecord('${r.id}')">驳回</button>
        </div>
      </div>
    </div>
    <div id="wr_edit_${r.id}" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-light)">
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div class="form-group" style="margin:0;flex:1;min-width:120px"><label class="form-label">开始时间</label><input id="wr_start_${r.id}" value="${r.start_time}" style="font-size:11px"></div>
        <div class="form-group" style="margin:0;flex:1;min-width:120px"><label class="form-label">结束时间</label><input id="wr_end_${r.id}" value="${r.end_time}" style="font-size:11px"></div>
        <div class="form-group" style="margin:0;width:80px"><label class="form-label">时长(h)</label><input id="wr_dur_${r.id}" value="${r.duration}" type="number" step="0.5" style="font-size:11px"></div>
        <div class="form-group" style="margin:0;flex:1;min-width:100px"><label class="form-label">工作内容</label><input id="wr_type_${r.id}" value="${r.work_type}" style="font-size:11px"></div>
        <div class="form-group" style="margin:0;flex:1;min-width:100px"><label class="form-label">工作地点</label><input id="wr_loc_${r.id}" value="${r.location}" style="font-size:11px"></div>
        <div class="form-group" style="margin:0;flex:2;min-width:160px"><label class="form-label">备注</label><input id="wr_notes_${r.id}" value="${r.notes}" style="font-size:11px"></div>
        <div class="form-group" style="margin:0;flex:2;min-width:160px"><label class="form-label">审批理由</label><input id="wr_anote_${r.id}" value="${r.admin_note||''}" placeholder="可选" style="font-size:11px"></div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="saveWorkRecord('${r.id}')">保存</button>
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('wr_edit_${r.id}').style.display='none'">取消</button>
    </div>
  </div>`;
}

function openEditWorkRecord(id) {
  const el = document.getElementById(`wr_edit_${id}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function saveWorkRecord(id) {
  const patch = {
    start_time: document.getElementById(`wr_start_${id}`).value,
    end_time: document.getElementById(`wr_end_${id}`).value,
    duration: parseFloat(document.getElementById(`wr_dur_${id}`).value) || 0,
    work_type: document.getElementById(`wr_type_${id}`).value,
    location: document.getElementById(`wr_loc_${id}`).value,
    notes: document.getElementById(`wr_notes_${id}`).value,
    admin_note: document.getElementById(`wr_anote_${id}`).value,
    updated_at: new Date().toISOString()
  };
  try {
    await sb(`/rest/v1/work_records?id=eq.${id}`, 'PATCH', patch);
    renderWorkRecordsAdmin(document.getElementById('pr_records'));
  } catch(e) { alert('保存失败：' + e.message); }
}

async function approveWorkRecord(id) {
  try {
    await sb(`/rest/v1/work_records?id=eq.${id}`, 'PATCH', { status: 'approved', updated_at: new Date().toISOString() });
    renderWorkRecordsAdmin(document.getElementById('pr_records'));
  } catch(e) { alert('操作失败：' + e.message); }
}

async function approveAllWorkRecords(teacherName) {
  if (!confirm(`确定将「${teacherName}」所有待审核记录全部通过？`)) return;
  try {
    await sb(`/rest/v1/work_records?teacher_name=eq.${encodeURIComponent(teacherName)}&status=eq.pending`, 'PATCH', { status: 'approved', updated_at: new Date().toISOString() });
    renderWorkRecordsAdmin(document.getElementById('pr_records'));
  } catch(e) { alert('操作失败：' + e.message); }
}

function toggleWrGroup(safeId) {
  const el = document.getElementById(`wr_group_${safeId}`);
  if (!el) return;
  const arrow = el.previousElementSibling?.querySelector('span[style*="cursor"]');
  if (el.style.display === 'none') {
    el.style.display = 'block';
    if (arrow) arrow.textContent = arrow.textContent.replace('▸', '▾');
  } else {
    el.style.display = 'none';
    if (arrow) arrow.textContent = arrow.textContent.replace('▾', '▸');
  }
}

async function deleteApprovedWorkRecords(teacherName) {
  if (!confirm(`确定删除「${teacherName}」所有已通过的工作记录？`)) return;
  try {
    await sb(`/rest/v1/work_records?teacher_name=eq.${encodeURIComponent(teacherName)}&status=eq.approved`, 'DELETE');
    renderWorkRecordsAdmin(document.getElementById('pr_records'));
  } catch(e) { alert('删除失败：' + e.message); }
}

async function deleteAllWorkRecords(teacherName) {
  if (!confirm(`确定删除「${teacherName}」全部工作记录（包括待审核和已通过）？`)) return;
  try {
    await sb(`/rest/v1/work_records?teacher_name=eq.${encodeURIComponent(teacherName)}`, 'DELETE');
    renderWorkRecordsAdmin(document.getElementById('pr_records'));
  } catch(e) { alert('删除失败：' + e.message); }
}

async function rejectWorkRecord(id) {
  const note = prompt('驳回理由（可选）：') ?? '';
  try {
    await sb(`/rest/v1/work_records?id=eq.${id}`, 'PATCH', { status: 'rejected', admin_note: note || null, updated_at: new Date().toISOString() });
    renderWorkRecordsAdmin(document.getElementById('pr_records'));
  } catch(e) { alert('操作失败：' + e.message); }
}

async function deleteWorkRecord(id) {
  if (!confirm('确定删除这条工作记录？')) return;
  try {
    await sb(`/rest/v1/work_records?id=eq.${id}`, 'DELETE');
    renderWorkRecordsAdmin(document.getElementById('pr_records'));
  } catch(e) { alert('删除失败：' + e.message); }
}

// 导出某老师所有 approved 记录为 Excel
async function exportWorkRecordsExcel(teacherName) {
  const records = await sb(`/rest/v1/work_records?teacher_name=eq.${encodeURIComponent(teacherName)}&status=eq.approved&order=start_time.asc`);
  if (!records.length) { alert('该老师暂无已通过的工作记录'); return; }
  const headers = ['姓名', '开始时间', '结束时间', '时长', '工作内容', '工作地点', '备注'];
  const csvRows = [headers.join('\t')];
  records.forEach(r => csvRows.push([r.teacher_name, r.start_time, r.end_time, r.duration, r.work_type, r.location, r.notes].join('\t')));
  const blob = new Blob(['\ufeff' + csvRows.join('\n')], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `工作记录_${teacherName}.xls`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 导出全部老师所有 approved 记录为一张 Excel
async function exportAllWorkRecordsExcel() {
  const records = await sb(`/rest/v1/work_records?status=eq.approved&order=teacher_name.asc,start_time.asc`);
  if (!records.length) { alert('暂无已通过的工作记录'); return; }
  const headers = ['姓名', '开始时间', '结束时间', '时长', '工作内容', '工作地点', '备注'];
  const csvRows = [headers.join('\t')];
  records.forEach(r => csvRows.push([r.teacher_name, r.start_time, r.end_time, r.duration, r.work_type, r.location, r.notes].join('\t')));
  const blob = new Blob(['\ufeff' + csvRows.join('\n')], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const today = new Date().toISOString().slice(0,10);
  a.download = `工作记录_全部老师_${today}.xls`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
