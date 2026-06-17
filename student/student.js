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
let major = null, selectedType = null, selectedSlotId = null, vipMode = false;
let slotViewYear = new Date().getFullYear(), slotViewMonth = new Date().getMonth();
let cachedSlots = [], cachedBookings = [];
let teacherDisplayNames = {};

async function initMajor() {
  const p = new URLSearchParams(window.location.search);
  major = p.get('major');
  vipMode = p.get('mode') === 'vip';
  if (major && (MAJORS[major] || major === 'shakai_group')) {
    document.getElementById('headerContent').innerHTML = `
      <div class="header-major">${vipMode ? 'VIP预约' : '面谈预约'}</div>
      <div class="header-sub">唯新教育</div>
      <div class="header-locked">📌 ${major === 'shakai_group' ? '社会人文' : MAJORS[major]}</div>`;
    try {
      teacherDisplayNames = {};
      const slotMajorFilter = major === 'shakai_group'
        ? 'major=in.(shakai,shinpan,fukushi,shakai_group)'
        : `major=eq.${major}`;
      [cachedSlots, cachedBookings] = await Promise.all([
        sb(`/rest/v1/slots?select=*&${slotMajorFilter}&or=(locked.is.null,locked.is.false)&order=date.asc,time_range.asc`),
        sb(`/rest/v1/bookings?select=*&major=eq.${major}&order=slot_date.asc`)
      ]);
      if (vipMode) {
        cachedSlots = cachedSlots.filter(s => (Array.isArray(s.type) ? s.type : [s.type]).includes('vip'));
        cachedBookings = cachedBookings.filter(b => b.type === 'vip');
      }
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
  let step = 0;
  const stepBasic = ++step;       // 基本信息
  const stepProgress = ++step;    // 当前学习进程
  const stepType = vipMode ? null : ++step; // 面谈类型（VIP模式跳过）
  const stepSlot = ++step;        // 选择预约时间
  const stepNeeds = ++step;       // 具体需求

  document.getElementById('mainWrap').innerHTML = `
  <div class="success-banner" id="successBanner">
    <div class="success-banner-title">✓ 预约申请已提交</div>
    <div class="success-banner-text">请等待老师确认，可在下方查看预约状态。</div>
  </div>
  <div id="infoBanner" style="display:none;background:var(--warning-light);border:1px solid var(--warning);border-radius:3px;padding:9px 12px;margin-bottom:12px;font-size:11px;color:var(--warning);line-height:1.6"></div>
  <div class="card">
    <div class="card-title"><span class="step-num">${stepBasic}</span>基本信息</div>
    <div class="form-group"><label class="form-label">姓名 <span class="required">*</span></label><input type="text" id="name" placeholder="请输入中文真实姓名">
    <div style="font-size:10px;color:var(--text-muted);margin-top:3px">⚠ 请填写中文真实姓名，使用昵称或日文名将不予预约</div></div>
    <div class="form-group"><label class="form-label">出愿期间 <span class="required">*</span></label>
      <div class="radio-group">
        <div class="radio-option"><input type="radio" name="examPeriod" id="ep1" value="夏季出愿" onchange="updateTypeOptions()"><label for="ep1">夏季出愿</label></div>
        <div class="radio-option"><input type="radio" name="examPeriod" id="ep2" value="冬季出愿" onchange="updateTypeOptions()"><label for="ep2">冬季出愿</label></div>
        <div class="radio-option"><input type="radio" name="examPeriod" id="ep3" value="次年出愿" onchange="updateTypeOptions()"><label for="ep3">次年出愿</label></div>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:0">
      <label class="form-label">语言能力（选填）</label>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <div style="font-size:11px;font-weight:600;margin-bottom:8px">英语</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <div><div class="sub-label">已有成绩</div>
              <select id="en_have_type">
                <option value="">无</option>
                <option value="TOEFL">托福 TOEFL</option>
                <option value="TOEIC">托业 TOEIC</option>
                <option value="IELTS">雅思 IELTS</option>
              </select>
            </div>
            <div><div class="sub-label">分数</div><input type="number" id="en_have_score" placeholder="分数"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <div><div class="sub-label">待考</div>
              <select id="en_upcoming_type">
                <option value="">无</option>
                <option value="TOEFL">托福 TOEFL</option>
                <option value="TOEIC">托业 TOEIC</option>
                <option value="IELTS">雅思 IELTS</option>
              </select>
            </div>
            <div><div class="sub-label">状态</div>
              <select id="en_upcoming_status">
                <option value="备考">备考中</option>
                <option value="等成绩">等成绩</option>
              </select>
            </div>
          </div>
          <div><div class="sub-label">待考月份（备考填考试月份 / 等成绩填出分月份）</div><input type="month" id="en_upcoming_date"></div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:600;margin-bottom:8px">日语</div>
          <div style="margin-bottom:8px">
            <div class="sub-label">已有成绩</div>
            <select id="ja_have_type" onchange="onJaHaveTypeChange()">
              <option value="">无</option>
              <option value="JLPT">JLPT</option>
              <option value="EJU">EJU</option>
              <option value="其他">其他</option>
            </select>
          </div>
          <div id="ja_have_jlpt_row" style="display:none;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <div><div class="sub-label">级别</div><select id="ja_have_jlpt_level"><option>N1</option><option>N2</option><option>N3</option><option>N4</option><option>N5</option></select></div>
            <div><div class="sub-label">分数</div><input type="number" id="ja_have_jlpt_score" placeholder="分数"></div>
          </div>
          <div id="ja_have_eju_row" style="display:none;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <div><div class="sub-label">日语成绩</div><input type="number" id="ja_have_eju_japanese" placeholder="日语成绩"></div>
            <div><div class="sub-label">记述分数</div><input type="number" id="ja_have_eju_writing" placeholder="记述分数"></div>
          </div>
          <div id="ja_have_other_row" style="display:none;margin-bottom:8px">
            <div class="sub-label">说明</div><input type="text" id="ja_have_other_text" placeholder="请说明">
          </div>
          <div style="margin-bottom:8px">
            <div class="sub-label">待考</div>
            <select id="ja_upcoming_type" onchange="onJaUpcomingTypeChange()">
              <option value="">无</option>
              <option value="JLPT">JLPT</option>
              <option value="EJU">EJU</option>
              <option value="其他">其他</option>
            </select>
          </div>
          <div id="ja_upcoming_jlpt_row" style="display:none;margin-bottom:8px">
            <div class="sub-label">目标级别</div><select id="ja_upcoming_jlpt_level"><option>N1</option><option>N2</option><option>N3</option><option>N4</option><option>N5</option></select>
          </div>
          <div id="ja_upcoming_other_row" style="display:none;margin-bottom:8px">
            <div class="sub-label">说明</div><input type="text" id="ja_upcoming_other_text" placeholder="请说明">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div><div class="sub-label">状态</div>
              <select id="ja_upcoming_status">
                <option value="备考">备考中</option>
                <option value="等成绩">等成绩</option>
              </select>
            </div>
            <div><div class="sub-label">月份</div><input type="month" id="ja_upcoming_date"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-title"><span class="step-num">${stepProgress}</span>当前学习进程</div>
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
  ${stepType ? `<div class="card">
    <div class="card-title"><span class="step-num">${stepType}</span>面谈类型 <span style="font-size:10px;color:var(--text-muted);font-weight:400">（点击可筛选时间槽）</span></div>
    <div class="type-grid" id="typeGrid">
      <div class="type-card" id="type-daily" onclick="selectType('daily')"><div class="type-card-name">日常学习面谈</div><div class="type-card-desc">TA老师负责</div></div>
      <div class="type-card locked" id="type-plan" onclick="selectTypeIfUnlocked('plan')"><div class="type-card-name">计划书相关</div><div class="type-card-desc">专业课老师</div><div class="type-card-lock">🔒</div></div>
      <div class="type-card locked" id="type-mock" onclick="selectTypeIfUnlocked('mock')"><div class="type-card-name">模拟面试</div><div class="type-card-desc">按情况安排</div><div class="type-card-lock">🔒</div></div>
    </div>
    <div id="lockNotice" class="locked-notice" style="display:none"></div>
  </div>` : ''}
  <div class="card">
    <div class="card-title"><span class="step-num">${stepSlot}</span>选择预约时间</div>
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
    <div class="card-title"><span class="step-num">${stepNeeds}</span>具体需求</div>
    <textarea id="needs" rows="3" placeholder="希望解决的问题，或需要老师重点关注的内容…"></textarea>
    <div style="font-size:10px;color:var(--text-muted);margin-top:6px;line-height:1.6">⚠ 非老师明确指定的线下面谈，一律默认线上进行。请确认好选择的日期和地点，如有疑问请及时和老师联系。</div>
  </div>
  <div class="card" id="contentCard" style="display:none">
    <div class="card-title">📎 提交内容（可选）</div>
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">如需要老师查看 / 修改计划书或面试稿件，可在此粘贴文字内容（老师可下载为Word文件进行批注）</div>
    <textarea id="studentContent" rows="6" placeholder="粘贴计划书草稿、面试稿等文字内容…"></textarea>
  </div>
  <button class="btn btn-primary" onclick="submitBooking()">提交预约申请 →</button>
  <div class="section-sep"><div class="section-sep-line"></div><div class="section-sep-label">${vipMode ? '本月VIP预约情况' : '本月预约情况'}</div><div class="section-sep-line"></div></div>
  <div class="refresh-row">
    <div class="refresh-meta" id="refreshMeta"></div>
    <button class="btn btn-outline" style="font-size:11px;padding:5px 10px" onclick="reloadPublicList()">↺ 刷新</button>
  </div>
  <div class="booking-list" id="publicBookingList"><div class="loading">加载中…</div></div>
  <div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid var(--border-light)">
    <a href="javascript:void(0)" onclick="toggleRetrievalPanel()" style="font-size:10px;color:var(--text-muted);text-decoration:underline;cursor:pointer">查询学习记录</a>
    <div id="retrievalPanel" style="display:none;margin-top:10px;text-align:left;background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:12px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
        <input type="text" id="rt_name" placeholder="姓名">
        <input type="text" id="rt_code" placeholder="查询码" style="text-transform:uppercase">
      </div>
      <button class="btn btn-outline btn-full" onclick="lookupRetrieval()">查询</button>
      <div id="retrievalResult" style="margin-top:10px"></div>
    </div>
  </div>`;

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

// ── 语言能力 ──
function onJaHaveTypeChange() {
  const type = document.getElementById('ja_have_type')?.value;
  const jlpt = document.getElementById('ja_have_jlpt_row');
  const eju = document.getElementById('ja_have_eju_row');
  const other = document.getElementById('ja_have_other_row');
  if (jlpt) jlpt.style.display = type === 'JLPT' ? 'grid' : 'none';
  if (eju) eju.style.display = type === 'EJU' ? 'grid' : 'none';
  if (other) other.style.display = type === '其他' ? 'block' : 'none';
}
function onJaUpcomingTypeChange() {
  const type = document.getElementById('ja_upcoming_type')?.value;
  const jlpt = document.getElementById('ja_upcoming_jlpt_row');
  const other = document.getElementById('ja_upcoming_other_row');
  if (jlpt) jlpt.style.display = type === 'JLPT' ? 'block' : 'none';
  if (other) other.style.display = type === '其他' ? 'block' : 'none';
}
function buildEnglishText() {
  const parts = [];
  const haveType = document.getElementById('en_have_type')?.value || '';
  if (haveType) {
    const score = document.getElementById('en_have_score')?.value || '';
    parts.push(score ? `${haveType} ${score}分` : haveType);
  }
  const upType = document.getElementById('en_upcoming_type')?.value || '';
  if (upType) {
    const status = document.getElementById('en_upcoming_status')?.value || '';
    const date = document.getElementById('en_upcoming_date')?.value || '';
    let s = `待考 ${upType}`;
    const inner = [status, date].filter(Boolean).join('，');
    if (inner) s += `（${inner}）`;
    parts.push(s);
  }
  return parts.join('；');
}
function buildJapaneseText() {
  const parts = [];
  const haveType = document.getElementById('ja_have_type')?.value || '';
  if (haveType === 'JLPT') {
    const level = document.getElementById('ja_have_jlpt_level')?.value || '';
    const score = document.getElementById('ja_have_jlpt_score')?.value || '';
    parts.push(score ? `JLPT ${level} ${score}分` : `JLPT ${level}`);
  } else if (haveType === 'EJU') {
    const jp = document.getElementById('ja_have_eju_japanese')?.value || '';
    const wr = document.getElementById('ja_have_eju_writing')?.value || '';
    const bits = [];
    if (jp) bits.push(`日语 ${jp}分`);
    if (wr) bits.push(`记述 ${wr}分`);
    parts.push(bits.length ? `EJU（${bits.join('，')}）` : 'EJU');
  } else if (haveType === '其他') {
    const text = document.getElementById('ja_have_other_text')?.value || '';
    parts.push(text ? `其他：${text}` : '其他');
  }
  const upType = document.getElementById('ja_upcoming_type')?.value || '';
  if (upType) {
    let label = '';
    if (upType === 'JLPT') {
      const level = document.getElementById('ja_upcoming_jlpt_level')?.value || '';
      label = `JLPT ${level}`;
    } else if (upType === 'EJU') {
      label = 'EJU';
    } else {
      const text = document.getElementById('ja_upcoming_other_text')?.value || '';
      label = text ? `其他：${text}` : '其他';
    }
    const status = document.getElementById('ja_upcoming_status')?.value || '';
    const date = document.getElementById('ja_upcoming_date')?.value || '';
    let s = `待考 ${label}`;
    const inner = [status, date].filter(Boolean).join('，');
    if (inner) s += `（${inner}）`;
    parts.push(s);
  }
  return parts.join('；');
}

function updateContentCardVisibility() {
  const card = document.getElementById('contentCard');
  if (card) card.style.display = (selectedType === 'plan' || selectedType === 'mock') ? 'block' : 'none';
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
  updateContentCardVisibility();
  renderSlots();
}
function selectType(type) {
  selectedType = (selectedType === type) ? null : type;
  document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
  if (selectedType) document.getElementById('type-' + selectedType)?.classList.add('selected');
  updateContentCardVisibility();
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
  expandedDateKey = null;
  renderSlots();
}

// 当前展开的日期key
let expandedDateKey = null;

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

  // 筛选类型
  const filtered = selectedType
    ? allSlots.filter(s => Array.isArray(s.type) ? s.type.includes(selectedType) : s.type === selectedType)
    : allSlots;

  if (!filtered.length) { grid.innerHTML = '<div class="no-slots">该类型暂无可预约时间槽</div>'; return; }

  // 按日期分组
  const byDate = {};
  filtered.forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  });

  selectedSlotId = null;

  const rows = Object.entries(byDate).map(([date, slots]) => {
    const d = new Date(date + 'T12:00:00');
    const dow = DAYS_CN[d.getDay()];
    const dowColor = d.getDay() === 6 ? 'var(--sat)' : d.getDay() === 0 ? 'var(--sun)' : 'var(--text-secondary)';
    const allFull = slots.every(s => {
      const cap = slotCap(s.time_range), booked = slotBookedCount[s.id] || 0;
      return booked >= cap;
    });
    const totalRemaining = slots.reduce((sum, s) => {
      const cap = slotCap(s.time_range), booked = slotBookedCount[s.id] || 0;
      return sum + Math.max(0, cap - booked);
    }, 0);
    const isOpen = expandedDateKey === date;

    const slotItems = slots.map(s => {
      const cap = slotCap(s.time_range), booked = slotBookedCount[s.id] || 0, remaining = cap - booked, full = remaining <= 0;
      const types = Array.isArray(s.type) ? s.type : [s.type];
      return `<div class="slot-option${full ? ' taken' : ''}" style="border:none;border-top:1px solid var(--border-light);border-radius:0;padding:10px 14px">
        <input type="radio" name="slotPick" id="slot-${s.id}" value="${s.id}" ${full ? 'disabled' : ''} onchange="selectedSlotId='${s.id}'">
        <label for="slot-${s.id}" style="display:flex;flex-direction:column;gap:3px">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:13px;font-weight:600;font-family:'DM Mono',monospace">${s.time_range}</span>
            <span class="tag ${typeTag(types[0])}" style="font-size:9px">${types.map(t=>t==='daily'?'日常':t==='plan'?'计划书':t==='vip'?'VIP':'模拟').join('・')}</span>
            <span style="margin-left:auto;font-size:10px;color:${full?'var(--danger)':'var(--success)'}">${full?'已满':`剩余 ${remaining}`}</span>
          </div>
          ${s.teacher_name ? `<div style="font-size:10px;color:var(--text-muted)">👤 ${teacherDisplayNames[s.teacher_name] || s.teacher_name}</div>` : ''}
          ${s.location && s.location !== 'online' ? `<div style="font-size:10px;color:#2a6aad">📍 ${s.location==='offline_takadanobaba'?'线下 · 高田马场':'线下 · 市谷'}</div>` : ''}
        </label>
      </div>`;
    }).join('');

    return `<div style="border:1px solid ${isOpen?'var(--accent)':'var(--border)'};border-radius:4px;overflow:hidden;margin-bottom:6px${allFull?';opacity:.55':''}">
      <div onclick="toggleDateSlots('${date}')" style="display:flex;align-items:center;padding:11px 14px;cursor:${allFull?'default':'pointer'};background:${isOpen?'var(--accent-light)':'var(--surface)'}">
        <span style="font-size:15px;font-weight:600;font-family:'DM Mono',monospace;min-width:44px">${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}</span>
        <span style="font-size:12px;font-weight:600;color:${dowColor};margin-left:6px">${dow}</span>
        <span style="margin-left:10px;font-size:11px;color:var(--text-muted)">${slots.length}个时段</span>
        <span style="margin-left:auto;font-size:11px;color:${allFull?'var(--danger)':'var(--text-2)'}">
          ${allFull ? '全部已满' : `${totalRemaining} 名额 ›`}
        </span>
      </div>
      ${isOpen ? `<div style="background:var(--bg)">${slotItems}</div>` : ''}
    </div>`;
  });

  grid.innerHTML = rows.join('');
}

function toggleDateSlots(date) {
  // 点击已展开的 → 收起；点击新日期 → 展开
  expandedDateKey = (expandedDateKey === date) ? null : date;
  // 清除已选时间槽（切换日期时重置）
  if (expandedDateKey !== date) selectedSlotId = null;
  renderSlots();
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
  if ((Array.isArray(slot.type)?slot.type:[slot.type]).includes('plan') && !canSelectPlan()) { alert('当前进程不符合计划书相关面谈的条件'); return; }
  if ((Array.isArray(slot.type)?slot.type:[slot.type]).includes('mock') && !canSelectMock()) { alert('当前进程不符合模拟面试的条件'); return; }
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
    interview_status: interviewStatus, type: vipMode ? 'vip' : (selectedType || (Array.isArray(slot.type)?slot.type[0]:slot.type)), slot_id: selectedSlotId,
    slot_date: slot.date, slot_time_range: slot.time_range,
    duration: parseInt(duration), urgency, needs, status: 'pending', actual_time: '', note: null, daily_record: null,
    english_score: buildEnglishText(), japanese_score: buildJapaneseText(),
    student_content: document.getElementById('studentContent')?.value.trim() || null,
    teacher_file_url: null, retrieval_code: null
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

// ── 查询面谈记录 ──
function toggleRetrievalPanel() {
  const p = document.getElementById('retrievalPanel');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}
async function lookupRetrieval() {
  const name = document.getElementById('rt_name').value.trim();
  const code = document.getElementById('rt_code').value.trim().toUpperCase();
  const result = document.getElementById('retrievalResult');
  if (!name || !code) { result.innerHTML = '<div style="font-size:11px;color:var(--danger)">请输入姓名和查询码</div>'; return; }
  result.innerHTML = '<div class="loading">查询中…</div>';
  try {
    // 用 student_code 验证身份
    const students = await sb(`/rest/v1/students?name=eq.${encodeURIComponent(name)}&student_code=eq.${encodeURIComponent(code)}&select=id,name,student_code`);
    if (!students.length) {
      // 兼容旧的 bookings.retrieval_code 逻辑
      const oldMatches = await sb(`/rest/v1/bookings?name=eq.${encodeURIComponent(name)}&retrieval_code=eq.${encodeURIComponent(code)}&select=*`);
      if (!oldMatches.length) {
        result.innerHTML = '<div style="font-size:11px;color:var(--danger)">未找到匹配记录，请确认姓名和查询码是否正确</div>';
        return;
      }
      // 旧逻辑：只显示单条面谈
      const b = oldMatches[0];
      let html = renderSingleBookingResult(b);
      result.innerHTML = html;
      return;
    }

    // 新逻辑：显示该学生所有老师共享的内容
    const student = students[0];
    const [bookings, sessionRecs] = await Promise.all([
      sb(`/rest/v1/bookings?name=eq.${encodeURIComponent(name)}&status=eq.confirmed&select=*&order=slot_date.desc`),
      sb(`/rest/v1/session_records?student_name=eq.${encodeURIComponent(name)}&select=*&order=session_date.desc`)
    ]);

    // 只显示有面谈记录或文件的条目
    const validBookings = bookings.filter(b => b.daily_record && Object.values(b.daily_record).some(v=>v));
    const validHomework = sessionRecs.filter(r => r.teacher_file_url);

    if (!validBookings.length && !validHomework.length) {
      result.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:12px 0">暂无可查询的记录，请等待老师共享</div>';
      return;
    }

    let html = `<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:12px">👤 ${name} 的学习记录</div>`;

    // 面谈记录
    if (validBookings.length) {
      html += `<div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">面谈记录（${validBookings.length}条）</div>`;
      validBookings.forEach(b => {
        html += `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px;margin-bottom:8px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">${b.slot_date} · ${typeLabel(b.type)}${b.actual_duration?' · '+b.actual_duration+'min':''}</div>
          <pre style="font-size:11px;line-height:1.7;white-space:pre-wrap;font-family:'DM Mono',monospace;margin:0;color:var(--text-2)">${buildRecordText(b)}</pre>
          ${b.teacher_file_url?`<a href="${b.teacher_file_url}" target="_blank" style="font-size:11px;color:var(--accent);display:block;margin-top:8px">📎 下载老师修改文件</a>`:''}
        </div>`;
      });
    }

    // 作业批改
    if (validHomework.length) {
      html += `<div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;margin-top:${validBookings.length?'12px':'0'}">作业批改（${validHomework.length}条）</div>`;
      validHomework.forEach(r => {
        html += `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px;margin-bottom:8px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">${r.session_date} · ${r.course_name}</div>
          ${r.feedback_knowledge?`<div style="font-size:11px;color:var(--text-2);margin-bottom:4px">📚 ${r.feedback_knowledge}</div>`:''}
          ${r.feedback_suggestions?`<div style="font-size:11px;color:var(--text-2);margin-bottom:6px">💡 ${r.feedback_suggestions}</div>`:''}
          <a href="${r.teacher_file_url}" target="_blank" style="font-size:11px;color:var(--accent)">📎 下载批改文件</a>
        </div>`;
      });
    }

    result.innerHTML = html;
  } catch(e) {
    result.innerHTML = `<div style="font-size:11px;color:var(--danger)">查询失败：${e.message}</div>`;
  }
}

function renderSingleBookingResult(b) {
  let html = `<div style="font-size:11px;color:var(--text-2);margin-bottom:8px">${b.slot_date} · ${typeLabel(b.type)}</div>`;
  if (b.daily_record) {
    html += `<pre style="font-size:11px;line-height:1.7;white-space:pre-wrap;background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:8px;margin-bottom:8px;font-family:'DM Mono',monospace">${buildRecordText(b)}</pre>`;
  }
  if (b.teacher_file_url) {
    html += `<a href="${b.teacher_file_url}" target="_blank" class="btn btn-primary btn-full" style="text-decoration:none;display:block;text-align:center;box-sizing:border-box">📎 下载老师修改文件</a>`;
  } else {
    html += `<div style="font-size:11px;color:var(--text-muted)">老师暂未上传修改文件</div>`;
  }
  return html;
}

initMajor();
