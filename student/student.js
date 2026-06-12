// Note: sb() is in shared/supabase.js
// Note: MAJORS, typeLabel, typeTag, slotCap, DAYS_CN are in shared/constants.js

const STORAGE_KEY = 'txe_student_info';
const STORAGE_DAYS = 30;

function saveStudentInfo() {
  const info = {
    ts: Date.now(),
    name: document.getElementById('name')?.value || '',
    examPeriod: document.querySelector('input[name=examPeriod]:checked')?.value || '',
    specialtyStatus: document.getElementById('specialtyStatus')?.value || '',
    targetSchool: document.getElementById('targetSchool')?.value || '',
    contactProf: document.getElementById('contactProf')?.value || '',
    planStatus: document.getElementById('planStatus')?.value || '',
    applicationStatus: document.getElementById('applicationStatus')?.value || '',
    writtenExam: document.getElementById('writtenExam')?.value || '',
    interviewStatus: document.getElementById('interviewStatus')?.value || '',
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
}

function loadStudentInfo() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const info = JSON.parse(raw);
    if (Date.now() - info.ts > STORAGE_DAYS * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return info;
  } catch { return null; }
}

function applyStoredInfo(info) {
  if (!info) return;
  if (info.name) document.getElementById('name').value = info.name;
  if (info.examPeriod) {
    const ep = document.querySelector(`input[name=examPeriod][value="${info.examPeriod}"]`);
    if (ep) ep.checked = true;
  }
  const selects = {
    specialtyStatus: info.specialtyStatus, targetSchool: info.targetSchool,
    contactProf: info.contactProf, planStatus: info.planStatus,
    applicationStatus: info.applicationStatus, writtenExam: info.writtenExam,
    interviewStatus: info.interviewStatus,
  };
  for (const [id, val] of Object.entries(selects)) {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  }
  updateTypeOptions();
  // show reminder banner
  const expiry = new Date(info.ts + STORAGE_DAYS * 24 * 60 * 60 * 1000);
  const expiryStr = `${expiry.getMonth() + 1}月${expiry.getDate()}日`;
  const banner = document.getElementById('infoBanner');
  if (banner) {
    banner.style.display = 'block';
    banner.innerHTML = `📋 已自动填入上次保留的信息（保留至 ${expiryStr}）。如有进度更新请修改后再提交。
      <button onclick="clearStoredInfo()" style="margin-left:10px;font-size:10px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:2px;padding:1px 6px;cursor:pointer;font-family:inherit">清除</button>`;
  }
}

function clearStoredInfo() {
  localStorage.removeItem(STORAGE_KEY);
  const banner = document.getElementById('infoBanner');
  if (banner) banner.style.display = 'none';
}
let major = null, selectedType = null, selectedSlotId = null;
let slotViewYear = new Date().getFullYear(), slotViewMonth = new Date().getMonth();
let cachedSlots = [], cachedBookings = [];
let teacherDisplayNames = {};

async function initMajor() {
  const p = new URLSearchParams(window.location.search);
  major = p.get('major');
  if (major && (MAJORS[major] || major === 'shakai_group')) {
    document.getElementById('headerContent').innerHTML = `
      <div class="header-major">面谈预约</div>
      <div class="header-sub">唯新教育</div>
      <div class="header-locked">📌 ${major === 'shakai_group' ? '社会人文' : MAJORS[major]}</div>`;
    try {
      teacherDisplayNames = {};
[cachedSlots, cachedBookings] = await Promise.all([
  sb(`/rest/v1/slots?select=*&major=in.(shakai,shinpan,fukushi,shakai_group)&or=(locked.is.null,locked.is.false)&order=date.asc,time_range.asc`),
  sb(`/rest/v1/bookings?select=*&major=eq.${major}&order=slot_date.asc`)
]);
      const teacherNames = [...new Set(cachedSlots.map(s => s.teacher_name).filter(Boolean))];
if (teacherNames.length) {
  const teachers = await sb(`/rest/v1/teachers?name=in.(${teacherNames.map(n=>`"${n}"`).join(',')})&select=name,display_name`).catch(() => []);
  teachers.forEach(t => { if (t.display_name) teacherDisplayNames[t.name] = t.display_name; });
}
      buildForm();
    } catch(e) {
      document.getElementById('mainWrap').innerHTML = `<div class="no-major-banner"><div class="no-major-title">加载失败</div><div class="no-major-text">${e.message}</div></div>`;
    }
  } else {
    document.getElementById('mainWrap').innerHTML = `
      <div class="no-major-banner">
        <div class="no-major-title">请通过专业链接访问</div>
        <div class="no-major-text">请联系老师获取您所在专业的预约链接</div>
      </div>`;
  }
}

function buildForm() {
  document.getElementById('mainWrap').innerHTML = `
  <div class="success-banner" id="successBanner">
    <div class="success-banner-title">✓ 预约申请已提交</div>
    <div class="success-banner-text">请等待老师确认，可在下方查看预约状态。</div>
  </div>
  <div id="infoBanner" style="display:none;background:var(--warning-light);border:1px solid var(--warning);border-radius:3px;padding:9px 12px;margin-bottom:12px;font-size:11px;color:var(--warning);line-height:1.6"></div>
  <div class="card">
    <div class="card-title"><span class="step-num">1</span>基本信息</div>
    <div class="form-group"><label class="form-label">姓名 <span class="required">*</span></label><input type="text" id="name" placeholder="请输入姓名"></div>
    <div class="form-group"><label class="form-label">出愿期间 <span class="required">*</span></label>
      <div class="radio-group">
        <div class="radio-option"><input type="radio" name="examPeriod" id="ep1" value="夏季出愿" onchange="updateTypeOptions()"><label for="ep1">夏季出愿</label></div>
        <div class="radio-option"><input type="radio" name="examPeriod" id="ep2" value="冬季出愿" onchange="updateTypeOptions()"><label for="ep2">冬季出愿</label></div>
        <div class="radio-option"><input type="radio" name="examPeriod" id="ep3" value="次年出愿" onchange="updateTypeOptions()"><label for="ep3">次年出愿</label></div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-title"><span class="step-num">2</span>当前学习进程</div>
    <div class="progress-grid">
      <div class="form-group"><label class="form-label">专业知识</label>
        <select id="specialtyStatus" onchange="updateTypeOptions()"><option value="">请选择</option><option>刚开始</option><option>学习中</option><option>完成一期</option></select></div>
      <div class="form-group"><label class="form-label">目标学校</label>
        <select id="targetSchool"><option value="">请选择</option><option>已择校</option><option>择校中</option><option>未择校</option></select></div>
      <div class="form-group"><label class="form-label">联系教授</label>
        <select id="contactProf"><option value="">请选择</option><option>已联系</option><option>写邮件中</option><option>未选定教授</option></select></div>
      <div class="form-group"><label class="form-label">研究计划书 <span class="required">*</span></label>
        <select id="planStatus" onchange="updateTypeOptions()"><option value="">请选择</option><option>已完成</option><option>待修改</option><option>收集先行研究中</option><option>已定好方向</option><option>未开始</option></select></div>
      <div class="form-group"><label class="form-label">出愿进度</label>
        <select id="applicationStatus"><option value="">请选择</option><option>已出愿</option><option>出愿中</option><option>准备材料中</option><option>未开始</option></select></div>
      <div class="form-group"><label class="form-label">笔试准备</label>
        <select id="writtenExam"><option value="">请选择</option><option>已开始</option><option>练习笔试中</option><option>未开始</option></select></div>
      <div class="form-group" style="grid-column:1/-1"><label class="form-label">面试准备 <span class="required">*</span></label>
        <select id="interviewStatus" onchange="updateTypeOptions()"><option value="">请选择</option><option>已完成面试稿</option><option>面试稿撰写中</option><option>模拟面试中</option><option>未开始</option></select></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title"><span class="step-num">3</span>面谈类型 <span style="font-size:10px;color:var(--text-muted);font-weight:400">（点击可筛选时间槽）</span></div>
    <div class="type-grid" id="typeGrid">
      <div class="type-card" id="type-daily" onclick="selectType('daily')"><div class="type-card-name">日常学习面谈</div><div class="type-card-desc">TA老师负责</div></div>
      <div class="type-card locked" id="type-plan" onclick="selectTypeIfUnlocked('plan')"><div class="type-card-name">计划书相关</div><div class="type-card-desc">专业课老师</div><div class="type-card-lock">🔒</div></div>
      <div class="type-card locked" id="type-mock" onclick="selectTypeIfUnlocked('mock')"><div class="type-card-name">模拟面试</div><div class="type-card-desc">按情况安排</div><div class="type-card-lock">🔒</div></div>
    </div>
    <div id="lockNotice" class="locked-notice" style="display:none"></div>
  </div>
  <div class="card">
    <div class="card-title"><span class="step-num">4</span>选择预约时间</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:11px;font-weight:600;letter-spacing:.04em" id="slotMonthLabel"></div>
      <div style="display:flex;gap:4px">
        <button onclick="slotMonthShift(-1)" style="background:none;border:1px solid var(--border);border-radius:2px;width:24px;height:24px;cursor:pointer;font-size:12px;color:var(--text-primary);display:flex;align-items:center;justify-content:center">‹</button>
        <button onclick="slotMonthShift(1)"  style="background:none;border:1px solid var(--border);border-radius:2px;width:24px;height:24px;cursor:pointer;font-size:12px;color:var(--text-primary);display:flex;align-items:center;justify-content:center">›</button>
      </div>
    </div>
    <div class="slot-grid" id="slotGrid"><div class="no-slots">加载中…</div></div>
    <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="margin:0"><label class="form-label">面谈时长</label>
        <div class="radio-group">
          <div class="radio-option"><input type="radio" name="duration" id="d15" value="15" checked><label for="d15">15 min</label></div>
          <div class="radio-option"><input type="radio" name="duration" id="d30" value="30"><label for="d30">30 min</label></div>
        </div>
      </div>
      <div class="form-group" style="margin:0"><label class="form-label">紧急程度</label>
        <div class="radio-group">
          <div class="radio-option"><input type="radio" name="urgency" id="uh" value="high"><label for="uh">紧急</label></div>
          <div class="radio-option"><input type="radio" name="urgency" id="um" value="mid"><label for="um">适中</label></div>
          <div class="radio-option"><input type="radio" name="urgency" id="ul" value="low" checked><label for="ul">一般</label></div>
        </div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-title"><span class="step-num">5</span>具体需求</div>
    <textarea id="needs" rows="3" placeholder="希望解决的问题，或需要老师重点关注的内容…"></textarea>
  </div>
  <button class="btn btn-primary" onclick="submitBooking()">提交预约申请 →</button>
  <div class="section-sep"><div class="section-sep-line"></div><div class="section-sep-label">本月预约情况</div><div class="section-sep-line"></div></div>
  <div class="refresh-row">
    <div class="refresh-meta" id="refreshMeta"></div>
    <button class="btn btn-outline" style="font-size:11px;padding:5px 10px" onclick="reloadPublicList()">↺ 刷新</button>
  </div>
  <div class="booking-list" id="publicBookingList"><div class="loading">加载中…</div></div>`;

  updateTypeOptions();
  renderSlots();
  renderPublicList();
  // restore saved info
  applyStoredInfo(loadStudentInfo());
}

function getPlanStatus() { return document.getElementById('planStatus')?.value || ''; }
function getInterviewStatus() { return document.getElementById('interviewStatus')?.value || ''; }
function canSelectPlan() {
  const p = getPlanStatus(), ep = document.querySelector('input[name=examPeriod]:checked')?.value || '';
  if (ep === '次年出愿') return false;
  if (p === '' || p === '未开始') return false;
  return true;
}
function canSelectMock() {
  const p = getPlanStatus(), i = getInterviewStatus();
  return p === '已完成' && (i === '已完成面试稿' || i === '面试稿撰写中' || i === '模拟面试中');
}

function updateTypeOptions() {
  const planOk = canSelectPlan(), mockOk = canSelectMock();
  const planCard = document.getElementById('type-plan'), mockCard = document.getElementById('type-mock');
  if (!planCard) return;
  planCard.classList.toggle('locked', !planOk); planCard.querySelector('.type-card-lock').style.display = planOk ? 'none' : 'block';
  mockCard.classList.toggle('locked', !mockOk); mockCard.querySelector('.type-card-lock').style.display = mockOk ? 'none' : 'block';
  const notices = [];
  if (!planOk) notices.push('计划书相关：请先通过日常学习面谈确定研究方向，再预约专业课老师');
  if (!mockOk) notices.push('模拟面试：研究计划书需为「已完成」且面试准备已推进');
  const n = document.getElementById('lockNotice');
  if (notices.length && (getPlanStatus() || document.querySelector('input[name=examPeriod]:checked'))) {
    n.style.display = 'block'; n.innerHTML = '🔒 ' + notices.join('<br>🔒 ');
  } else n.style.display = 'none';
  if (selectedType === 'plan' && !planOk) { selectedType = null; document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected')); }
  if (selectedType === 'mock' && !mockOk) { selectedType = null; document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected')); }
  renderSlots();
}
function selectType(type) {
  selectedType = (selectedType === type) ? null : type;
  document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
  if (selectedType) document.getElementById('type-' + selectedType)?.classList.add('selected');
  renderSlots();
}
function selectTypeIfUnlocked(type) {
  if (type === 'plan' && !canSelectPlan()) return;
  if (type === 'mock' && !canSelectMock()) return;
  selectType(type);
}
function slotMonthShift(d) {
  slotViewMonth += d;
  if (slotViewMonth > 11) { slotViewMonth = 0; slotViewYear++; }
  if (slotViewMonth < 0) { slotViewMonth = 11; slotViewYear--; }
  renderSlots();
}

function renderSlots() {
  const lbl = document.getElementById('slotMonthLabel'), grid = document.getElementById('slotGrid');
  if (!lbl || !grid) return;
  lbl.textContent = `${slotViewYear}年${slotViewMonth + 1}月`;
  const ym = `${slotViewYear}-${String(slotViewMonth + 1).padStart(2, '0')}`;
  let allSlots = cachedSlots.filter(s => s.date.startsWith(ym));
  allSlots.sort((a, b) => a.date.localeCompare(b.date) || a.time_range.localeCompare(b.time_range));
  const slotBookedCount = {};
  cachedBookings.filter(b => b.status !== 'cancelled').forEach(b => { slotBookedCount[b.slot_id] = (slotBookedCount[b.slot_id] || 0) + 1; });
  if (!allSlots.length) { grid.innerHTML = '<div class="no-slots">本月暂无可预约时间槽<br><span style="font-size:10px">请联系老师确认排期</span></div>'; return; }
  const visible = selectedType ? allSlots.filter(s => s.type === selectedType) : allSlots;
  const dimmed = selectedType ? allSlots.filter(s => s.type !== selectedType) : [];
  const renderSlot = (s, isDimmed) => {
    const d = new Date(s.date), dow = DAYS_CN[d.getDay()];
    const dc = d.getDay() === 6 ? 'var(--sat)' : d.getDay() === 0 ? 'var(--sun)' : 'var(--text-secondary)';
    const cap = slotCap(s.time_range), booked = slotBookedCount[s.id] || 0, remaining = cap - booked, full = remaining <= 0;
    const disabled = full || isDimmed;
    const remainLabel = full ? '<div class="slot-remain" style="color:var(--danger)">已满</div>' : `<div class="slot-remain" style="color:var(--success)">剩余 ${remaining} 名额</div>`;
    return `<div class="slot-option${disabled ? ' taken' : ''}">
      <input type="radio" name="slotPick" id="slot-${s.id}" value="${s.id}" ${disabled ? 'disabled' : ''} onchange="selectedSlotId='${s.id}'">
      <label for="slot-${s.id}">
        <div style="display:flex;align-items:center;gap:4px">
          <span class="slot-date-r">${s.date.slice(5).replace('-', '/')}</span>
          <span class="slot-dow-r" style="color:${dc}">${dow}</span>
          <span class="tag ${typeTag(s.type)}" style="margin-left:auto;font-size:9px">${s.type === 'daily' ? '日常' : s.type === 'plan' ? '计划书' : '模拟'}</span>
        </div>
        <div class="slot-time-r">${s.time_range}</div>
${s.teacher_name ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">👤 ${teacherDisplayNames[s.teacher_name] || s.teacher_name}</div>` : ''}
        ${isDimmed ? '' : remainLabel}
      </label>
    </div>`;
  };
  selectedSlotId = null;
  grid.innerHTML = [...visible.map(s => renderSlot(s, false)), ...dimmed.map(s => renderSlot(s, true))].join('');
}

async function submitBooking() {
  const name = document.getElementById('name').value.trim();
  const examPeriod = document.querySelector('input[name=examPeriod]:checked')?.value;
  const planStatus = getPlanStatus(), interviewStatus = getInterviewStatus();
  const duration = document.querySelector('input[name=duration]:checked')?.value;
  const urgency = document.querySelector('input[name=urgency]:checked')?.value;
  const needs = document.getElementById('needs').value.trim();
  if (!name) { alert('请填写姓名'); return; }
  if (!examPeriod) { alert('请选择出愿期间'); return; }
  if (!planStatus) { alert('请选择研究计划书状态'); return; }
  if (!selectedSlotId) { alert('请选择预约时间'); return; }

  // 检查是否有未完成的预约
  const majorList = major === 'shakai_group' ? ['shakai','shinpan','fukushi','shakai_group'] : [major];
const activeBooking = cachedBookings.find(b =>
  b.name === name && majorList.includes(b.major) &&
    (b.status === 'pending' || b.status === 'confirmed')
  );
  if (activeBooking) {
    alert(`您好 ${name} 同学，您有一个面谈尚未完成（${activeBooking.slot_date} ${activeBooking.slot_time_range || ''}，状态：${activeBooking.status === 'pending' ? '待确认' : '已确认'}）。\n\n请在本次面谈完成后再提交新的预约申请。`);
    return;
  }

  const slot = cachedSlots.find(s => s.id === selectedSlotId);
  if (!slot) { alert('时间槽不存在，请刷新后重试'); return; }
  if (slot.type === 'plan' && !canSelectPlan()) { alert('当前进程不符合计划书相关面谈的条件'); return; }
  if (slot.type === 'mock' && !canSelectMock()) { alert('当前进程不符合模拟面试的条件'); return; }
  const cap = slotCap(slot.time_range);
  const booked = cachedBookings.filter(b => b.slot_id === selectedSlotId && b.status !== 'cancelled').length;
  if (booked >= cap) { alert('该时间段名额已满，请选择其他时间'); renderSlots(); return; }

  const booking = {
    id: Date.now().toString(), name, major: slot.major || major, exam_period: examPeriod,
    specialty_status: document.getElementById('specialtyStatus').value,
    target_school: document.getElementById('targetSchool').value,
    contact_prof: document.getElementById('contactProf').value,
    plan_status: planStatus, application_status: document.getElementById('applicationStatus').value,
    written_exam: document.getElementById('writtenExam').value,
    interview_status: interviewStatus, type: slot.type, slot_id: selectedSlotId,
    slot_date: slot.date, slot_time_range: slot.time_range,
    duration: parseInt(duration), urgency, needs, status: 'pending', actual_time: '', note: null, daily_record: null
  };
  try {
    const res = await sb('/rest/v1/bookings', 'POST', booking);
    cachedBookings.push(Array.isArray(res) ? res[0] : booking);
    // 保存信息到 localStorage
    saveStudentInfo();
    document.getElementById('successBanner').classList.add('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderSlots(); renderPublicList();
  } catch(e) { alert('提交失败：' + e.message); }
}

function urgencySpan(u) {
  return u === 'high' ? '<span class="urgency-high">紧急</span>' : u === 'mid' ? '<span class="urgency-mid">适中</span>' : '<span class="urgency-low">一般</span>';
}

async function reloadPublicList() {
  try {
    cachedBookings = await sb(`/rest/v1/bookings?select=*&major=eq.${major}&order=slot_date.asc`);
    renderSlots(); renderPublicList();
  } catch(e) { console.error(e); }
}

function renderPublicList() {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const bookings = cachedBookings.filter(b => b.slot_date && b.slot_date.startsWith(ym));
  bookings.sort((a, b) => (a.slot_date + a.slot_time_range).localeCompare(b.slot_date + b.slot_time_range));
  const meta = document.getElementById('refreshMeta');
  if (meta) meta.textContent = `共 ${bookings.length} 条 · ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} 更新`;
  const list = document.getElementById('publicBookingList');
  if (!list) return;
  if (!bookings.length) { list.innerHTML = '<div class="no-slots">暂无预约记录</div>'; return; }
  list.innerHTML = bookings.map(b => {
    const confirmedTime = b.status === 'confirmed' && b.actual_time
      ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-light);font-size:11px;color:var(--success)">✓ 确认面谈时间：${b.actual_time.replace('T', ' ')}</div>`
      : b.status === 'confirmed'
      ? '<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-light);font-size:11px;color:var(--text-muted)">⏳ 老师将尽快确认具体时间</div>'
      : '';
    return `<div class="booking-row">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div>
          <span class="booking-row-name">${b.name}</span>
          <div class="booking-row-meta">${b.slot_date.slice(5).replace('-', '/')} ${b.slot_time_range || ''} · ${b.duration}min · ${urgencySpan(b.urgency)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          <span class="tag ${typeTag(b.type)}">${typeLabel(b.type)}</span>
          <span class="status-badge status-${b.status}">${b.status === 'pending' ? '待确认' : b.status === 'confirmed' ? '已确认' : '已取消'}</span>
        </div>
      </div>
      ${b.needs ? `<div class="booking-row-needs">💬 ${b.needs}</div>` : ''}
      ${confirmedTime}
    </div>`;
  }).join('');
}

initMajor();
