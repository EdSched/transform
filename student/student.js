function locationShort(loc) {
  if (!loc || loc === 'online') return '';
  if (loc === 'offline_takadanobaba') return '线下·高马';
  if (loc === 'offline_ichigaya') return '线下·市谷';
  if (loc === 'both_takadanobaba') return '线上/线下·高马';
  if (loc === 'both_ichigaya') return '线上/线下·市谷';
  return '';
}
function locationLong(loc) {
  if (!loc || loc === 'online') return '';
  if (loc === 'offline_takadanobaba') return '线下 · 高田马场';
  if (loc === 'offline_ichigaya') return '线下 · 市谷';
  if (loc === 'both_takadanobaba') return '线上 / 线下均可 · 高田马场';
  if (loc === 'both_ichigaya') return '线上 / 线下均可 · 市谷';
  return '';
}
function locationColor(loc) {
  if (!loc || loc === 'online') return '#2a6aad';
  if (loc.startsWith('both')) return '#2a7a4a';
  return '#2a6aad';
}
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
  // 有保存信息时自动收起步骤1和2
  collapseCard('basicCardBody', 'basicCardArrow');
  collapseCard('progressCardBody', 'progressCardArrow');
  // show reminder banner
  const expiry = new Date(info.ts + STORAGE_DAYS * 24 * 60 * 60 * 1000);
  const expiryStr = `${expiry.getMonth() + 1}月${expiry.getDate()}日`;
  const banner = document.getElementById('infoBanner');
  if (banner) {
    banner.style.display = 'block';
    banner.innerHTML = `📋 已自动填入上次保留的信息（保留至 ${expiryStr}）。如有进度更新请修改后再提交。
      <button onclick="expandCards()" style="margin-left:6px;font-size:10px;color:var(--accent);background:none;border:1px solid var(--accent);border-radius:2px;padding:1px 6px;cursor:pointer;font-family:inherit">展开修改</button>
      <button onclick="clearStoredInfo()" style="margin-left:6px;font-size:10px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:2px;padding:1px 6px;cursor:pointer;font-family:inherit">清除</button>`;
  }
}

function toggleCard(bodyId, arrowId) {
  const body = document.getElementById(bodyId);
  const arrow = document.getElementById(arrowId);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.style.transform = isOpen ? 'rotate(-90deg)' : '';
}

function collapseCard(bodyId, arrowId) {
  const body = document.getElementById(bodyId);
  const arrow = document.getElementById(arrowId);
  if (body) body.style.display = 'none';
  if (arrow) arrow.style.transform = 'rotate(-90deg)';
}

function expandCards() {
  const body1 = document.getElementById('basicCardBody');
  const body2 = document.getElementById('progressCardBody');
  const arr1 = document.getElementById('basicCardArrow');
  const arr2 = document.getElementById('progressCardArrow');
  if (body1) body1.style.display = '';
  if (body2) body2.style.display = '';
  if (arr1) arr1.style.transform = '';
  if (arr2) arr2.style.transform = '';
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

// 按 slot_id 分批拉取预约（每批100个，避免 URL 过长）
async function fetchBookingsBySlots(slotIds) {
  let all = [];
  for (let i = 0; i < slotIds.length; i += 100) {
    const chunk = slotIds.slice(i, i + 100);
    const batch = await sb(`/rest/v1/bookings?select=*&slot_id=in.(${chunk.map(id => `"${id}"`).join(',')})&order=slot_date.asc`).catch(() => []);
    all = all.concat(batch);
  }
  return all;
}

async function initMajor() {
  const p = new URLSearchParams(window.location.search);
  major = p.get('major');
  if (major && (MAJORS[major] || major === 'shakai_group')) {
    document.getElementById('headerContent').innerHTML = `
      <div class="header-major">面谈预约</div>
      <div class="header-sub">唯新教育</div>
      <div class="header-locked">📌 ${major === 'shakai_group' ? '社会人文' : MAJORS[major]}</div>
      <a href="../vip/" style="display:inline-block;margin-top:8px;font-size:11px;color:var(--accent);border:1px solid var(--accent);border-radius:3px;padding:4px 12px;text-decoration:none">⭐ 我有VIP课程 →</a>`;
    try {
      teacherDisplayNames = {};
      // 每个页面只显示「发布时选择了该专业」的时间槽：
      // 社会人文页只显示发布为社会人文的槽；各专业页只显示本专业的槽，互不混排
      cachedSlots = await sb(`/rest/v1/slots?select=*&major=eq.${major}&or=(locked.is.null,locked.is.false)&order=date.asc,time_range.asc`);
      // 预约记录的 major 会被覆盖为学生真实专业，按专业过滤会漏算名额，
      // 因此按本页时间槽的 slot_id 拉取预约，保证名额统计与公开列表准确
      cachedBookings = await fetchBookingsBySlots(cachedSlots.map(s => s.id));
      // VIP 时间槽走独立的 /vip/ 页面预约，不在普通面谈预约里出现
      cachedSlots = cachedSlots.filter(s => !(Array.isArray(s.type) ? s.type : [s.type]).includes('vip'));
      cachedBookings = cachedBookings.filter(b => b.type !== 'vip');
      const teacherNames = [...new Set(cachedSlots.map(s => s.teacher_name).filter(Boolean))];
      if (teacherNames.length) {
        const teachers = await sb(`/rest/v1/teachers?name=in.(${teacherNames.map(n=>`"${n}"`).join(',')})&select=name,display_name`).catch(() => []);
        teachers.forEach(t => { if (t.display_name) teacherDisplayNames[t.name] = t.display_name; });
      }
      buildForm();
      loadSchoolPlanBanner(); // 检查是否有共享的学校列表
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
  const stepType = ++step; // 面谈类型
  const stepSlot = ++step;        // 选择预约时间
  const stepNeeds = ++step;       // 具体需求

  document.getElementById('mainWrap').innerHTML = `
  <div class="success-banner" id="successBanner">
    <div class="success-banner-title">✓ 预约申请已提交</div>
    <div class="success-banner-text">请等待老师确认，可在下方查看预约状态。</div>
  </div>
  <!-- 统一提醒条 -->
  <div id="reminderStrip" style="display:none;background:#eef3fb;border:1px solid #2c4a7c;border-radius:3px;padding:12px 14px;margin-bottom:12px">
    <div id="reminderItems" style="font-size:11px;color:#2c4a7c;line-height:2;margin-bottom:10px"></div>
    <a href="../student/study.html?major=${major}" style="font-size:12px;background:#2c4a7c;color:#fff;border-radius:3px;padding:8px 18px;text-decoration:none;display:inline-block;font-weight:500">→ 前往学习记录完成</a>
  </div>
  <div id="infoBanner" style="display:none;background:var(--warning-light);border:1px solid var(--warning);border-radius:3px;padding:9px 12px;margin-bottom:12px;font-size:11px;color:var(--warning);line-height:1.6"></div>
  <div class="card">
    <div class="card-title" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between" onclick="toggleCard('basicCardBody','basicCardArrow')">
      <span><span class="step-num">${stepBasic}</span>基本信息</span>
      <span id="basicCardArrow" style="font-size:12px;color:var(--text-3);transition:transform .2s">▾</span>
    </div>
    <div id="basicCardBody">
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
    </div><!-- /basicCardBody -->
  </div>
  <div class="card">
    <div class="card-title" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between" onclick="toggleCard('progressCardBody','progressCardArrow')">
      <span><span class="step-num">${stepProgress}</span>当前学习进程</span>
      <span id="progressCardArrow" style="font-size:12px;color:var(--text-3);transition:transform .2s">▾</span>
    </div>
    <div id="progressCardBody">
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
    </div><!-- /progressCardBody -->
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
    <div style="font-size:10px;color:var(--text-muted);margin-top:6px;line-height:1.6">📌 标注「线下」的时间槽需线下出席；标注「线上/线下均可」的可根据自身情况选择，请在具体需求中注明。未标注地点默认线上进行，如有疑问请提前联系老师确认。</div>
  </div>
  <div class="card" id="contentCard" style="display:none">
    <div class="card-title">📎 提交内容（可选）</div>
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">如需要老师查看 / 修改计划书或面试稿件，可粘贴文字内容，或直接上传文件（如含公式的Word文档），二者均可</div>
    <textarea id="studentContent" rows="6" placeholder="粘贴计划书草稿、面试稿等文字内容…"></textarea>
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-light)">
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">或上传文件（Word / PDF / 图片，最大50MB）</div>
      <input type="file" id="studentFileUpload" accept=".doc,.docx,.pdf,image/*">
    </div>
  </div>
  <button class="btn btn-primary" onclick="submitBooking()">提交预约申请 →</button>
  <div class="section-sep"><div class="section-sep-line"></div><div class="section-sep-label">本月预约情况</div><div class="section-sep-line"></div></div>
  <div class="refresh-row">
    <div class="refresh-meta" id="refreshMeta"></div>
    <button class="btn btn-outline" style="font-size:11px;padding:5px 10px" onclick="reloadPublicList()">↺ 刷新</button>
  </div>
  <div class="booking-list" id="publicBookingList"><div class="loading">加载中…</div></div>
  <div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid var(--border-light)">
    <a href="../student/study.html?major=${major}" style="font-size:10px;color:var(--text-muted);text-decoration:underline;cursor:pointer">查询学习记录 →</a>
    <div id="retrievalPanel" style="display:none;margin-top:10px;text-align:left;background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:12px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
        <input type="text" id="rt_name" placeholder="姓名">
        <input type="text" id="rt_code" placeholder="查询码" style="text-transform:uppercase">
      </div>
      <button class="btn btn-outline btn-full" onclick="lookupRetrieval()">查询</button>
      <div id="retrievalResult" style="margin-top:10px"></div>
    </div>
  </div>
  </div>`;

  updateTypeOptions();
  renderSlots();
  renderPublicList();
  // restore saved info
  applyStoredInfo(loadStudentInfo());
  // 检查出愿共享banner（DOM重建后重新执行）
  setTimeout(() => loadSchoolPlanBanner(), 200);
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
          ${locationLong(s.location)?`<div style="font-size:10px;color:${locationColor(s.location)}">📍 ${locationLong(s.location)}</div>`:''}
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

  // 检查是否有未完成的预约（按姓名实时查询，跨专业页面均可拦截；已完成 completed 的不拦截）
  let activeBooking = null;
  try {
    const act = await sb(`/rest/v1/bookings?name=eq.${encodeURIComponent(name)}&status=in.("pending","confirmed")&select=slot_date,slot_time_range,status&limit=1`);
    activeBooking = (act && act.length) ? act[0] : null;
  } catch (e) {
    activeBooking = cachedBookings.find(b =>
      b.name === name && (b.status === 'pending' || b.status === 'confirmed')
    ) || null;
  }
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

  // 若该学生在学生档案中已有真实专业记录，优先使用真实专业（避免社会人文分组链接覆盖真实专业）
  let bookingMajor = slot.major || major;
  try {
    const existingStudent = await sb(`/rest/v1/students?name=eq.${encodeURIComponent(name)}&select=major&limit=1`);
    if (existingStudent && existingStudent.length && existingStudent[0].major) {
      bookingMajor = existingStudent[0].major;
    }
  } catch (e) { /* 查询失败时退回原逻辑，不阻断预约流程 */ }

  // 若学生选择了上传文件，先上传（文件名用专业+时间戳拼接，避免中文文件名导致的存储路径问题）
  let studentFileUrl = null;
  const fileInput = document.getElementById('studentFileUpload');
  const file = fileInput?.files[0];
  if (file) {
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      const path = `${bookingMajor || 'general'}/${Date.now()}.${ext}`;
      studentFileUrl = await sbUpload('student-files', path, file);
    } catch (e) {
      alert('文件上传失败：' + e.message + '\n您可以改为粘贴文字内容，或稍后重试');
      return;
    }
  }

  const booking = {
    id: Date.now().toString(), name, major: bookingMajor, exam_period: examPeriod,
    specialty_status: document.getElementById('specialtyStatus').value,
    target_school: document.getElementById('targetSchool').value,
    contact_prof: document.getElementById('contactProf').value,
    plan_status: planStatus, application_status: document.getElementById('applicationStatus').value,
    written_exam: document.getElementById('writtenExam').value,
    interview_status: interviewStatus, type: selectedType || (Array.isArray(slot.type)?slot.type[0]:slot.type), slot_id: selectedSlotId,
    slot_date: slot.date, slot_time_range: slot.time_range,
    duration: parseInt(duration), urgency, needs, status: 'pending', actual_time: '', note: null, daily_record: null,
    english_score: buildEnglishText(), japanese_score: buildJapaneseText(),
    student_content: document.getElementById('studentContent')?.value.trim() || null,
    student_file_url: studentFileUrl,
    teacher_file_url: null, retrieval_code: null
  };
  try {
    const res = await sb('/rest/v1/bookings', 'POST', booking);
    cachedBookings.push(Array.isArray(res) ? res[0] : booking);

    // 同步进度时间线
    try {
      const stuMatch = await sb(`/rest/v1/students?name=eq.${encodeURIComponent(name)}&select=id,major`).catch(()=>[]);
      if (stuMatch.length) {
        const stu = stuMatch[0];
        const planMap = {'尚未开始':'未开始','初步构思阶段':'收集资料中','草稿撰写中':'撰写中','已完成初稿':'修改中','已定稿':'已完成'};
        const applyMap = {'尚未确认志望校':'择校确认中','正在确认志望校':'择校确认中','已确认志望校':'联系教授中','正在准备出愿材料':'材料准备中','已出愿':'已出愿'};
        const jaText = buildJapaneseText();
        const enText = buildEnglishText();
        const entry = makeProgressEntry({
          studentId: stu.id, studentName: name,
          major: booking.major || stu.major,
          source: 'student', sourceName: name,
          japanese: mapJapaneseScore(jaText),
          english: mapEnglishScore(enText),
          plan: planMap[planStatus] || '',
          apply: applyMap[booking.application_status] || '',
          notes: [jaText?`日语：${jaText}`:'', enText?`英语：${enText}`:'', booking.target_school?`目标：${booking.target_school}`:''].filter(Boolean).join('　'),
        });
        if (entry.japanese||entry.english||entry.plan||entry.apply||entry.notes) {
          sb('/rest/v1/student_progress_timeline','POST',entry).catch(()=>{});
        }
      }
    } catch(e) { /* 进度同步失败不阻断预约 */ }

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
    cachedBookings = await fetchBookingsBySlots(cachedSlots.map(s => s.id));
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
          <span class="status-badge status-${b.status}">${b.status === 'pending' ? '待确认' : b.status === 'completed' ? '已完成' : b.status === 'confirmed' ? '已确认' : '已取消'}</span>
        </div>
      </div>
      ${b.needs ? `<div class="booking-row-needs">💬 ${b.needs}</div>` : ''}
      ${confirmedTime}
    </div>`;
  }).join('');
}

// ── 查询面谈记录 ──
function scrollToRetrieval() {
  const panel = document.getElementById('retrievalPanel');
  if (panel) { panel.style.display = 'block'; panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

async function loadSchoolPlanBanner() {
  try {
    const name = localStorage.getItem('txe_student_name') || '';
    const code = localStorage.getItem('txe_student_code') || '';
    const reminders = [];

    // 先查学生档案：出愿共享列表绑定学生真实专业；查不到学生时退回页面 major
    let stu = null;
    if (name && code) {
      const stuMatch = await sb(`/rest/v1/students?name=eq.${encodeURIComponent(name)}&student_code=eq.${encodeURIComponent(code.toUpperCase())}&select=id,major`).catch(()=>[]);
      if (stuMatch.length) stu = stuMatch[0];
    }
    const shareMajor = (stu && stu.major) || major;
    const shares = await sb(`/rest/v1/teacher_school_shares?major=eq.${shareMajor}&select=*&order=created_at.desc&limit=1`).catch(()=>[]);
    if (shares.length) {
      let schoolFilled = false;
      if (stu) {
        // 志望校
        const plans = await sb(`/rest/v1/student_school_plans?student_id=eq.${stu.id}&select=id&limit=1`).catch(()=>[]);
        schoolFilled = plans.length > 0;
        // 计划书
        const drafts = await sb(`/rest/v1/student_plan_drafts?student_id=eq.${stu.id}&select=id&limit=1`).catch(()=>[]);
        if (!drafts.length) reminders.push('📄 计划书进度尚未填写');
      }
      if (!schoolFilled) reminders.push(`🏫 ${shares[0].title} · 待填写志望校`);
    }

    if (window._hwReminders && window._hwReminders.length) {
      window._hwReminders.forEach(r => reminders.push(r));
    }

    if (!reminders.length) return;
    const strip = document.getElementById('reminderStrip');
    const items = document.getElementById('reminderItems');
    if (strip && items) {
      strip.style.display = 'block';
      items.innerHTML = reminders.map(r => `· ${r}`).join('<br>');
    }
  } catch(e) { /* 静默失败 */ }
}

function toggleRetrievalPanel() {
  const p = document.getElementById('retrievalPanel');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

async function openSchoolPlanEditor(studentId, studentName, major) {
  const result = document.getElementById('retrievalResult');
  const sharedLists = result._sharedLists || [];
  const existing = await sb(`/rest/v1/student_school_plans?student_id=eq.${studentId}&select=*&order=level.asc`).catch(()=>[]);

  // 拉取TA共享的学校详情
  let sharedSchools = [];
  if (sharedLists.length) {
    const allIds = sharedLists.flatMap(sl => sl.school_ids || []);
    if (allIds.length) {
      sharedSchools = await sb(`/rest/v1/admission_schools?id=in.(${allIds.map(id=>`"${id}"`).join(',')})&select=*`).catch(()=>[]);
    }
  }

  const modal = document.createElement('div');
  modal.id = 'schoolPlanModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';

  const levelLabel = { 1:'🔴 冲刺（挑战）', 2:'🟡 匹配（目标）', 3:'🟢 保底' };

  const schoolRows = existing.map((s,i) => `
    <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px;margin-bottom:8px" id="school_row_${i}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <select onchange="this.closest('[id]').dataset.level=this.value" style="font-size:11px;padding:3px 6px;font-family:inherit">
          ${[1,2,3].map(lv=>`<option value="${lv}" ${s.level===lv?'selected':''}>${levelLabel[lv]}</option>`).join('')}
        </select>
        <button onclick="this.closest('[id]').remove()" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 8px;cursor:pointer;color:var(--danger)">删除</button>
      </div>
      <input placeholder="学校名 *" value="${s.school_name||''}" style="font-size:11px;width:100%;margin-bottom:6px" data-field="school_name">
      <input placeholder="研究科" value="${s.faculty||''}" style="font-size:11px;width:100%;margin-bottom:6px" data-field="faculty">
      <input placeholder="専攻/コース" value="${s.department||''}" style="font-size:11px;width:100%;margin-bottom:6px" data-field="department">
      <input placeholder="志望教授名" value="${s.professor||''}" style="font-size:11px;width:100%;margin-bottom:6px" data-field="professor">
      <input placeholder="教授研究内容URL或说明" value="${s.professor_url||''}" style="font-size:11px;width:100%;margin-bottom:6px" data-field="professor_url">
      <input placeholder="出愿期间（当年实际时间）" value="${s.application_period||''}" style="font-size:11px;width:100%;margin-bottom:6px" data-field="application_period">
      <input placeholder="备注" value="${s.notes||''}" style="font-size:11px;width:100%" data-field="notes">
      <input type="hidden" value="${s.id||''}" data-field="id">
    </div>
  `).join('');

  modal.innerHTML = `
    <div style="background:var(--surface,#fff);border-radius:6px;padding:20px;max-width:480px;width:100%;margin:auto">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">🏫 志望校列表 · ${studentName}</div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:14px">每个等级建议2所，共最多6所。教授建议每校找2位。</div>
      ${sharedSchools.length ? `
      <div style="margin-bottom:14px">
        <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">老师共享的学校（点选添加）</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${sharedSchools.map(s=>`<button onclick="addSharedSchool('${s.id}','${s.university}','${(s.faculty||'').replace(/'/g,"\'")}','${(s.department||'').replace(/'/g,"\'")}','${s.english_required||''}','${s.japanese_required||''}','${s.application_period||''}')" style="font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:2px;padding:3px 8px;cursor:pointer;font-family:inherit">${s.university} ${s.department||''}</button>`).join('')}
        </div>
      </div>` : ''}
      <div id="schoolRowsContainer">${schoolRows}</div>
      <button onclick="addSchoolRow()" style="width:100%;background:none;border:1px dashed var(--border);border-radius:3px;padding:8px;font-size:11px;cursor:pointer;font-family:inherit;color:var(--text-3);margin-bottom:14px">＋ 手动添加学校</button>
      <div style="display:flex;gap:8px">
        <button onclick="saveSchoolPlans('${studentId}','${studentName}','${major}')" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">保存</button>
        <button onclick="document.getElementById('schoolPlanModal').remove()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:10px 14px;font-size:12px;cursor:pointer;font-family:inherit">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function addSchoolRow(schoolName='', faculty='', department='', engReq='', jpReq='', appPeriod='') {
  const container = document.getElementById('schoolRowsContainer');
  const count = container.children.length;
  if (count >= 6) { alert('最多6所学校，如需更多请在备注中说明理由'); return; }
  const i = Date.now();
  const levelLabel = { 1:'🔴 冲刺（挑战）', 2:'🟡 匹配（目标）', 3:'🟢 保底' };
  const div = document.createElement('div');
  div.style.cssText = 'background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px;margin-bottom:8px';
  div.id = `school_row_${i}`;
  div.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <select style="font-size:11px;padding:3px 6px;font-family:inherit">
        ${[1,2,3].map(lv=>`<option value="${lv}">${levelLabel[lv]}</option>`).join('')}
      </select>
      <button onclick="this.closest('[id]').remove()" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 8px;cursor:pointer;color:var(--danger)">删除</button>
    </div>
    <input placeholder="学校名 *" value="${schoolName}" style="font-size:11px;width:100%;margin-bottom:6px" data-field="school_name">
    <input placeholder="研究科" value="${faculty}" style="font-size:11px;width:100%;margin-bottom:6px" data-field="faculty">
    <input placeholder="専攻/コース" value="${department}" style="font-size:11px;width:100%;margin-bottom:6px" data-field="department">
    <input placeholder="志望教授名" value="" style="font-size:11px;width:100%;margin-bottom:6px" data-field="professor">
    <input placeholder="教授研究内容URL或说明" value="" style="font-size:11px;width:100%;margin-bottom:6px" data-field="professor_url">
    <input placeholder="出愿期间" value="${appPeriod}" style="font-size:11px;width:100%;margin-bottom:6px" data-field="application_period">
    <input placeholder="备注" value="" style="font-size:11px;width:100%" data-field="notes">
    <input type="hidden" value="" data-field="id">`;
  container.appendChild(div);
}

function addSharedSchool(schoolId, name, faculty, department, engReq, jpReq, appPeriod) {
  const container = document.getElementById('schoolRowsContainer');
  if (container.children.length >= 6) { alert('最多6所，如需更多请手动添加并在备注说明理由'); return; }
  addSchoolRow(name, faculty, department, engReq, jpReq, appPeriod);
}

async function saveSchoolPlans(studentId, studentName, major) {
  const container = document.getElementById('schoolRowsContainer');
  const rows = [...container.children];
  const plans = rows.map(row => {
    const get = f => row.querySelector(`[data-field="${f}"]`)?.value?.trim() || '';
    const level = parseInt(row.querySelector('select')?.value || '2');
    return { id: get('id'), school_name: get('school_name'), faculty: get('faculty'), department: get('department'), professor: get('professor'), professor_url: get('professor_url'), application_period: get('application_period'), notes: get('notes'), level };
  }).filter(p => p.school_name);

  if (!plans.length) { alert('请至少填写一所学校'); return; }

  try {
    // 先删除该学生所有旧记录，再全量插入
    await sb(`/rest/v1/student_school_plans?student_id=eq.${studentId}`, 'DELETE');
    const toInsert = plans.map(p => ({
      id: p.id || `ssp-${Date.now()}-${Math.random().toString(36).slice(2,4)}`,
      student_id: studentId, student_name: studentName, major,
      school_name: p.school_name, faculty: p.faculty, department: p.department,
      professor: p.professor, professor_url: p.professor_url,
      application_period: p.application_period, notes: p.notes,
      level: p.level, status: 'preparing',
    }));
    await sb('/rest/v1/student_school_plans', 'POST', toInsert);
    document.getElementById('schoolPlanModal').remove();
    lookupRetrieval();
  } catch(e) { alert('保存失败：' + e.message); }
}

// ── 计划书进度编辑器 ──
async function openPlanDraftEditor(studentId, studentName, major) {
  const existing = await sb(`/rest/v1/student_plan_drafts?student_id=eq.${studentId}&select=*&order=created_at.desc&limit=1`).catch(()=>[]);
  const d = existing[0] || {};
  const modal = document.createElement('div');
  modal.id = 'planDraftModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';
  modal.innerHTML = `
    <div style="background:var(--surface,#fff);border-radius:6px;padding:20px;max-width:480px;width:100%;margin:auto">
      <div style="font-size:14px;font-weight:600;margin-bottom:14px">📄 计划书进度 · ${studentName}</div>
      <div class="form-group"><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px">问题意识</label>
        <textarea id="pd_question" rows="3" placeholder="你的研究问题是什么？">${d.research_question||''}</textarea></div>
      <div class="form-group"><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px">先行研究整理</label>
        <textarea id="pd_prior" rows="3" placeholder="已读过哪些相关文献？">${d.prior_research||''}</textarea></div>
      <div class="form-group"><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px">先行研究链接（可选）</label>
        <input id="pd_prior_url" value="${d.prior_research_url||''}" placeholder="相关文献/参考资料链接"></div>
      <div class="form-group"><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px">研究方法</label>
        <textarea id="pd_method" rows="2" placeholder="打算用什么研究方法？">${d.methodology||''}</textarea></div>
      <div class="form-group"><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px">草稿文件上传（可选）</label>
        <input type="file" id="pd_file" accept=".doc,.docx,.pdf,.txt"></div>
      ${d.draft_file_url?`<div style="margin-bottom:10px"><a href="${d.draft_file_url}" target="_blank" style="font-size:11px;color:var(--accent)">📎 当前草稿文件</a></div>`:''}
      ${d.teacher_comment?`<div style="background:var(--ok-bg);border-radius:3px;padding:8px;font-size:11px;color:var(--ok);margin-bottom:10px">💬 老师批注：${d.teacher_comment}</div>`:''}
      <div style="display:flex;gap:8px">
        <button onclick="savePlanDraft('${studentId}','${studentName}','${major}','${d.id||''}')" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">保存</button>
        <button onclick="document.getElementById('planDraftModal').remove()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:10px 14px;font-size:12px;cursor:pointer;font-family:inherit">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function savePlanDraft(studentId, studentName, major, existingId) {
  const question = document.getElementById('pd_question').value.trim();
  const prior = document.getElementById('pd_prior').value.trim();
  const priorUrl = document.getElementById('pd_prior_url').value.trim();
  const method = document.getElementById('pd_method').value.trim();
  if (!question && !prior && !method) { alert('请至少填写一项内容'); return; }

  let draftFileUrl = '';
  const fileEl = document.getElementById('pd_file');
  if (fileEl?.files[0]) {
    const f = fileEl.files[0];
    const ext = f.name.split('.').pop().toLowerCase();
    const path = `${major||'plan'}/${Date.now()}_draft.${ext}`;
    draftFileUrl = await sbUpload('student-files', path, f).catch(e => { alert('文件上传失败：' + e.message); return ''; });
    if (!draftFileUrl) return;
  }

  const data = {
    student_id: studentId, student_name: studentName, major,
    research_question: question, prior_research: prior,
    prior_research_url: priorUrl, methodology: method,
    draft_file_url: draftFileUrl || undefined,
    status: 'drafting', updated_at: new Date().toISOString(),
  };

  try {
    if (existingId) {
      await sb(`/rest/v1/student_plan_drafts?id=eq.${existingId}`, 'PATCH', data);
    } else {
      data.id = `spd-${Date.now()}-${Math.random().toString(36).slice(2,4)}`;
      await sb('/rest/v1/student_plan_drafts', 'POST', data);
    }
    document.getElementById('planDraftModal').remove();
    lookupRetrieval();
  } catch(e) { alert('保存失败：' + e.message); }
}


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
    const students = await sb(`/rest/v1/students?name=eq.${encodeURIComponent(name)}&student_code=eq.${encodeURIComponent(code)}&select=*`);
    if (!students.length) {
      result.innerHTML = '<div style="font-size:11px;color:var(--danger)">未找到匹配记录，请确认姓名和查询码是否正确</div>';
      return;
    }
    const student = students[0];

    const [bookings, sessionRecs, timeline, schoolPlans, planDrafts, sharedLists] = await Promise.all([
      sb(`/rest/v1/bookings?name=eq.${encodeURIComponent(name)}&status=in.("confirmed","completed")&select=*&order=slot_date.desc`).catch(()=>[]),
      sb(`/rest/v1/session_records?student_name=eq.${encodeURIComponent(name)}&select=*&order=session_date.desc`).catch(()=>[]),
      sb(`/rest/v1/student_progress_timeline?student_id=eq.${student.id}&select=*&order=created_at.desc&limit=5`).catch(()=>[]),
      sb(`/rest/v1/student_school_plans?student_id=eq.${student.id}&select=*&order=level.asc`).catch(()=>[]),
      sb(`/rest/v1/student_plan_drafts?student_id=eq.${student.id}&select=*&order=created_at.desc&limit=1`).catch(()=>[]),
      sb(`/rest/v1/teacher_school_shares?major=eq.${major}&select=*&order=created_at.desc&limit=3`).catch(()=>[]),
    ]);

    const validBookings = bookings.filter(b => b.daily_record && Object.values(b.daily_record).some(v=>v));
    const validHomework = sessionRecs.filter(r => r.teacher_file_url);
    const examSeasons = [...new Set(bookings.map(b => b.exam_period).filter(Boolean))];

    let html = `<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:14px;padding-bottom:10px;border-top:1px solid var(--border-light);padding-top:14px">👤 ${name} 的学习记录</div>`;

    // ── 1. 考学进度快照 ──
    if (timeline.length || student.japanese_score || student.english_score) {
      html += `<div style="margin-bottom:16px">
        <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;margin-bottom:8px">📊 考学进度</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">
          ${student.japanese_score?`<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:6px 8px"><span style="color:var(--text-3)">🗣 日语</span><br>${student.japanese_score}</div>`:''}
          ${student.english_score?`<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:6px 8px"><span style="color:var(--text-3)">📝 英语</span><br>${student.english_score}</div>`:''}
        </div>
        ${timeline.length?`<div style="margin-top:8px;font-size:11px;color:var(--text-2)">${timeline[0].plan?`📄 计划书：${timeline[0].plan}　`:''}${timeline[0].apply?`🏫 出愿：${timeline[0].apply}`:''}${timeline[0].notes?`<br>💬 ${timeline[0].notes}`:''}</div>`:''}
        ${examSeasons.length?`<div style="margin-top:6px;font-size:10px;color:var(--accent)">📅 出愿季度：${examSeasons.join('、')}</div>`:''}
      </div>`;
    }

    // ── 2. 志望校列表 ──
    html += `<div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em">🏫 志望校列表 <span style="font-weight:400">(${schoolPlans.length}/6)</span></div>
        <button onclick="openSchoolPlanEditor('${student.id}','${name}','${student.major}')" style="font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit">＋ 编辑志望校</button>
      </div>`;
    if (schoolPlans.length) {
      const levelLabel = { 1:'🔴 冲刺', 2:'🟡 匹配', 3:'🟢 保底' };
      [1,2,3].forEach(lv => {
        const lvSchools = schoolPlans.filter(s => s.level === lv);
        if (!lvSchools.length) return;
        html += `<div style="font-size:10px;color:var(--text-3);margin:6px 0 4px">${levelLabel[lv]}</div>`;
        lvSchools.forEach(s => {
          html += `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:8px;margin-bottom:6px;font-size:11px">
            <div style="font-weight:600">${s.school_name}</div>
            <div style="color:var(--text-2)">${[s.faculty,s.department].filter(Boolean).join(' · ')}</div>
            ${s.professor?`<div style="color:var(--text-3);margin-top:2px">👤 ${s.professor}</div>`:''}
            ${s.application_period?`<div style="color:var(--accent);margin-top:2px">📅 ${s.application_period}</div>`:''}
          </div>`;
        });
      });
    } else if (sharedLists.length) {
      const sl = sharedLists[0];
      html += `<div style="background:var(--warn-bg);border:1px solid var(--warn);border-radius:3px;padding:10px;font-size:11px;color:var(--warn)">
        ⚠ 老师已共享「${sl.title}」，请点击「编辑志望校」完成填写${sl.notes?`<br><span style="font-size:10px">${sl.notes}</span>`:''}
      </div>`;
    } else {
      html += `<div style="font-size:11px;color:var(--text-3);padding:8px 0">暂无志望校记录，请等待老师共享学校列表</div>`;
    }
    html += `</div>`;

    // ── 3. 计划书进度 ──
    const d = planDrafts[0];
    html += `<div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em">📄 计划书进度</div>
        <button onclick="openPlanDraftEditor('${student.id}','${name}','${student.major}')" style="font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit">${d?'更新':'开始填写'}</button>
      </div>
      ${d ? `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px;font-size:11px">
        ${d.research_question?`<div style="margin-bottom:6px"><span style="color:var(--text-3)">问题意识：</span>${d.research_question}</div>`:''}
        ${d.prior_research?`<div style="margin-bottom:6px"><span style="color:var(--text-3)">先行研究：</span>${d.prior_research}</div>`:''}
        ${d.methodology?`<div style="margin-bottom:6px"><span style="color:var(--text-3)">研究方法：</span>${d.methodology}</div>`:''}
        ${d.draft_file_url?`<a href="${d.draft_file_url}" target="_blank" style="color:var(--accent)">📎 草稿文件</a>`:''}
        ${d.teacher_comment?`<div style="background:var(--ok-bg);border-radius:2px;padding:6px;color:var(--ok);margin-top:6px">💬 老师批注：${d.teacher_comment}</div>`:''}
      </div>` : `<div style="font-size:11px;color:var(--text-3)">暂无计划书记录，点击「开始填写」</div>`}
    </div>`;

    // ── 4. 面谈记录 ──
    if (validBookings.length) {
      html += `<div style="margin-bottom:16px">
        <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;margin-bottom:8px">📋 面谈记录（${validBookings.length}条）</div>`;
      validBookings.slice(0,3).forEach(b => {
        html += `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px;margin-bottom:8px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">${b.slot_date} · ${b.actual_duration?b.actual_duration+'min':''}</div>
          <pre style="font-size:11px;line-height:1.7;white-space:pre-wrap;font-family:inherit;margin:0;color:var(--text-2)">${buildRecordText(b)}</pre>
        </div>`;
      });
      if (validBookings.length > 3) html += `<div style="font-size:11px;color:var(--text-3);text-align:center">还有 ${validBookings.length-3} 条…</div>`;
      html += `</div>`;
    }

    // ── 5. 作业批改 ──
    if (validHomework.length) {
      html += `<div style="margin-bottom:16px">
        <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;margin-bottom:8px">✏ 作业批改（${validHomework.length}条）</div>`;
      validHomework.slice(0,3).forEach(r => {
        html += `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px;margin-bottom:8px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">${r.session_date} · ${r.course_name||''}</div>
          ${r.feedback_knowledge?`<div style="font-size:11px;color:var(--text-2);margin-bottom:4px">${r.feedback_knowledge}</div>`:''}
          <a href="${r.teacher_file_url}" target="_blank" style="font-size:11px;color:var(--accent)">📎 下载批改文件</a>
        </div>`;
      });
      html += `</div>`;
    }

    result.innerHTML = html;
    result._studentId = student.id;
    result._studentName = name;
    result._studentMajor = student.major;
    result._sharedLists = sharedLists;

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
