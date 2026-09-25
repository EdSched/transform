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

// 按 slot_id 分批拉取预约（每批100个，避免 URL 过长）——只取名额统计需要的字段，不取姓名/需求
async function fetchBookingsBySlots(slotIds) {
  let all = [];
  for (let i = 0; i < slotIds.length; i += 100) {
    const chunk = slotIds.slice(i, i + 100);
    const batch = await sb(`/rest/v1/bookings?select=slot_id,status,type&slot_id=in.(${chunk.map(id => `"${id}"`).join(',')})&order=slot_date.asc`).catch(() => []);
    all = all.concat(batch);
  }
  return all;
}

// 页面模式：login=登录框 | new=新同学预约（手填姓名，不绑定学生）| member=已登录学生（内嵌在学习页）
let bkMode = 'login';
let bkStudent = null;   // member 模式下的学生档案 { id, name, major, ... }
let bkIsEmbed = false;

function bkEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function bkStudyUrl() { return `../student/study.html?major=${encodeURIComponent(major)}&tab=reserve`; }
function bkMsg(title, text) {
  document.getElementById('mainWrap').innerHTML = `<div class="no-major-banner"><div class="no-major-title">${title}</div><div class="no-major-text">${text}</div></div>`;
}

async function initMajor() {
  if (typeof loadMajorsFromDB === 'function') await loadMajorsFromDB();
  const p = new URLSearchParams(window.location.search);
  major = p.get('major');
  // embed=1：内嵌在学习页「面谈预约」标签里，身份从本机登录信息读取（同源 localStorage）
  bkIsEmbed = p.get('embed') === '1';
  if (!(major && (MAJORS[major] || major === 'shakai_group'))) {
    bkMsg('请通过专业链接访问', '请联系老师获取您所在专业的预约链接');
    return;
  }
  document.getElementById('headerContent').innerHTML = `
    <div class="header-major">面谈预约</div>
    <div class="header-sub">唯新教育</div>
    <div class="header-locked">📌 ${major === 'shakai_group' ? '社会人文' : MAJORS[major]}</div>
    ${bkIsEmbed ? '' : `<a href="../vip/" style="display:inline-block;margin-top:8px;font-size:11px;color:var(--accent);border:1px solid var(--accent);border-radius:3px;padding:4px 12px;text-decoration:none">⭐ 我有VIP课程 →</a>`}`;

  if (bkIsEmbed) {
    const info = studentLoginLoad();
    if (!info) { bkMsg('请先登录', `<a href="${bkStudyUrl()}" target="_top" style="color:var(--accent)">点这里用姓名＋查询码登录</a>`); return; }
    const say = t => { document.getElementById('mainWrap').innerHTML = `<div class="loading">${t}</div>`; };
    const r = await studentLogin(info.name, info.code, say);
    if (!r.ok) {
      if (r.reason === 'not_found') bkMsg('登录信息已失效', `<a href="${bkStudyUrl()}" target="_top" style="color:var(--accent)">请重新登录</a>`);
      else bkMsg('网络连接不稳定', '身份验证未完成，请稍后刷新页面重试');
      return;
    }
    bkStudent = r.student;
    bkMode = 'member';
    await loadBookingPage();
    return;
  }

  // 本机已登录过 → 直接进入学习页的「面谈预约」标签
  if (studentLoginLoad()) { location.replace(bkStudyUrl()); return; }
  renderBookingLogin();
}

function renderBookingLogin() {
  bkMode = 'login';
  const inp = 'width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:2px;background:var(--bg)';
  document.getElementById('mainWrap').innerHTML = `
  <div class="card" style="max-width:380px;margin:20px auto 12px">
    <div class="card-title">登录后预约面谈</div>
    <div class="form-group"><label class="form-label">姓名</label><input id="bl_name" placeholder="真实姓名" style="${inp}"></div>
    <div class="form-group"><label class="form-label">查询码</label><input id="bl_code" placeholder="查询码" style="${inp};text-transform:uppercase" onkeydown="if(event.key==='Enter')bookingLoginSubmit()"></div>
    <div id="bl_error" style="font-size:11px;color:var(--danger);min-height:16px;margin-bottom:10px"></div>
    <button id="bl_btn" class="btn btn-primary" style="width:100%" onclick="bookingLoginSubmit()">登录 →</button>
    <div style="font-size:10px;color:var(--text-muted);margin-top:8px;text-align:center">查询码由老师/管理员提供；登录一次后，本机以后打开预约链接会自动进入</div>
  </div>
  <div onclick="enterNewStudentMode()" style="max-width:380px;margin:0 auto;cursor:pointer;background:var(--surface);border:1px dashed var(--accent);border-radius:4px;padding:14px 16px">
    <div style="font-size:13px;font-weight:600;color:var(--accent);margin-bottom:4px">新同学第一次面谈？</div>
    <div style="font-size:11px;color:var(--text-secondary);line-height:1.7">直接在这里预约，面谈时向老师领取查询码，以后就能登录查看学习记录。</div>
    <div style="font-size:11px;color:var(--accent);margin-top:6px">进入新同学预约 →</div>
  </div>`;
}

async function bookingLoginSubmit() {
  const name = document.getElementById('bl_name').value.trim();
  const code = document.getElementById('bl_code').value.trim().toUpperCase();
  const errEl = document.getElementById('bl_error');
  const btn = document.getElementById('bl_btn');
  if (!name || !code) { errEl.style.color = 'var(--danger)'; errEl.textContent = '请填写姓名和查询码'; return; }
  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
  const r = await studentLogin(name, code, t => { errEl.style.color = 'var(--text-muted)'; errEl.textContent = t; });
  if (r.ok) {
    studentLoginSave({ id: r.student.id, name, code, major });   // 与学习页同一个 key、同一格式
    errEl.textContent = '登录成功，正在进入…';
    location.href = bkStudyUrl();
    return;
  }
  if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  errEl.style.color = 'var(--danger)';
  errEl.textContent = r.reason === 'not_found'
    ? '未找到匹配记录，请确认姓名和查询码是否正确'
    : '网络连接不稳定，账号验证未完成，请稍后再点一次「登录」';
}

async function enterNewStudentMode() {
  bkMode = 'new';
  bkStudent = null;
  document.getElementById('mainWrap').innerHTML = '<div class="loading">加载中…</div>';
  await loadBookingPage();
  window.scrollTo({ top: 0 });
}

// 拉取本专业时间槽与名额，并显示预约表单
async function loadBookingPage() {
  try {
    teacherDisplayNames = {};
    // 每个页面只显示「发布时选择了该专业」的时间槽：
    // 社会人文页只显示发布为社会人文的槽；各专业页只显示本专业的槽，互不混排
    cachedSlots = await sb(`/rest/v1/slots?select=*&major=eq.${major}&or=(locked.is.null,locked.is.false)&order=date.asc,time_range.asc`);
    // 按本页时间槽的 slot_id 拉取预约（只用于名额统计）
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
    // 已登录学生：姓名以本人档案为准并锁定（buildForm 内已执行 applyStoredInfo，这里覆盖）
    if (bkMode === 'member' && bkStudent) {
      const nameEl = document.getElementById('name');
      if (nameEl) {
        nameEl.value = bkStudent.name || '';
        nameEl.readOnly = true;
        nameEl.style.background = 'var(--bg)';
        nameEl.style.cursor = 'not-allowed';
        const hint = nameEl.parentElement && nameEl.parentElement.querySelector('div');
        if (hint) hint.textContent = '已按你的登录身份自动填入姓名';
      }
    }
    loadSchoolPlanBanner(); // 检查是否有共享的学校列表
  } catch(e) {
    bkMsg('加载失败', bkEsc(e.message));
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
    <div class="success-banner-text">${bkMode === 'new'
      ? '请等待老师确认。面谈时请向老师领取查询码，以后用姓名＋查询码登录，就能查看预约状态和学习记录。'
      : '请等待老师确认，可在「面谈记录」标签查看。'}</div>
  </div>
  ${bkMode === 'new' ? `<div style="background:var(--surface);border:1px solid var(--accent);border-radius:4px;padding:12px 14px;margin-bottom:12px">
    <div style="font-size:13px;font-weight:600;color:var(--accent);margin-bottom:4px">新同学预约</div>
    <div style="font-size:11px;color:var(--text-secondary);line-height:1.7">请填写中文真实姓名。面谈时向老师领取查询码，以后就能登录查看学习记录。</div>
    <a onclick="renderBookingLogin()" style="display:inline-block;margin-top:6px;font-size:11px;color:var(--accent);cursor:pointer;text-decoration:underline">已有查询码？请登录</a>
  </div>` : ''}
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
  ${bkMode === 'new' ? `<div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid var(--border-light)">
    <a onclick="renderBookingLogin()" style="font-size:11px;color:var(--text-muted);text-decoration:underline;cursor:pointer">已有查询码？请登录</a>
  </div>` : ''}
  </div>`;

  updateTypeOptions();
  renderSlots();
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
  const isMember = bkMode === 'member' && bkStudent;
  // 已登录学生：姓名以档案为准；新同学：手填
  const name = isMember ? (bkStudent.name || '') : document.getElementById('name').value.trim();
  const examPeriod = document.querySelector('input[name=examPeriod]:checked')?.value;
  const planStatus = getPlanStatus(), interviewStatus = getInterviewStatus();
  const duration = document.querySelector('input[name=duration]:checked')?.value;
  const urgency = document.querySelector('input[name=urgency]:checked')?.value;
  const needs = document.getElementById('needs').value.trim();
  if (!name) { alert('请填写姓名'); return; }
  if (!examPeriod) { alert('请选择出愿期间'); return; }
  if (!planStatus) { alert('请选择研究计划书状态'); return; }
  if (!selectedSlotId) { alert('请选择预约时间'); return; }

  // 检查是否有未完成的预约（已完成 completed 的不拦截）
  // 已登录：按学生 id 查（旧记录还没补 student_id，同时按档案姓名兜底）；新同学：按手填姓名查
  let activeBooking = null;
  try {
    const who = isMember
      ? `or=(student_id.eq.${encodeURIComponent(bkStudent.id)},name.eq.${encodeURIComponent(name)})`
      : `name=eq.${encodeURIComponent(name)}`;
    const act = await sb(`/rest/v1/bookings?${who}&status=in.("pending","confirmed")&select=slot_date,slot_time_range,status&limit=1`);
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
  // 资格校验只看学生选择的预约类型，与时间槽的复合类型无关
  // （老师发布的槽可同时接受多种类型：选了日常学习面谈就按日常处理，不受计划书/模拟条件限制）
  const slotTypes = Array.isArray(slot.type) ? slot.type : [slot.type];
  if (selectedType && !slotTypes.includes(selectedType)) { alert('该时间槽不接受当前选择的面谈类型，请换一个时间'); return; }
  if (selectedType === 'plan' && !canSelectPlan()) { alert('当前进程不符合计划书相关面谈的条件'); return; }
  if (selectedType === 'mock' && !canSelectMock()) { alert('当前进程不符合模拟面试的条件'); return; }
  const cap = slotCap(slot.time_range);
  const booked = cachedBookings.filter(b => b.slot_id === selectedSlotId && b.status !== 'cancelled').length;
  if (booked >= cap) { alert('该时间段名额已满，请选择其他时间'); renderSlots(); return; }

  // 已登录学生用档案里的真实专业（避免社会人文分组链接覆盖真实专业）；新同学用时间槽/页面的专业
  const bookingMajor = (isMember && bkStudent.major) || slot.major || major;

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
  // 已登录学生写入 student_id；新同学不带该字段（留空，老师确认时再认领/建档）
  if (isMember) booking.student_id = bkStudent.id;
  try {
    const res = await sb('/rest/v1/bookings', 'POST', booking);
    cachedBookings.push(Array.isArray(res) ? res[0] : booking);

    // 同步进度时间线（仅已登录学生：用当前学生 id 写入；新同学没有档案，跳过）
    try {
      if (isMember) {
        const stu = bkStudent;
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
          // 出愿进度未填时，退回「择校状况」的映射（已择校→联系教授中，择校中→择校确认中）
          apply: applyMap[booking.application_status] || ({'已择校':'联系教授中','择校中':'择校确认中'}[booking.target_school] || ''),
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
    renderSlots();
  } catch(e) { alert('提交失败：' + e.message); }
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

    // 作业提醒（预约页公开，不区分个人提交状态）：该专业近期已布置的作业
    try {
      const today = new Date();
      const from = new Date(today); from.setDate(today.getDate() - 14);
      const to = new Date(today); to.setDate(today.getDate() + 7);
      const fmt = d => d.toISOString().slice(0, 10);
      const myMajor = shareMajor;
      const accept = myMajor === 'shakai_group'
        ? ['shakai_group', 'shakai', 'shinpan', 'fukushi']
        : ['shakai', 'shinpan', 'fukushi'].includes(myMajor) ? [myMajor, 'shakai_group'] : [myMajor];
      const sessions = await sb(`/rest/v1/course_sessions?session_date=gte.${fmt(from)}&session_date=lte.${fmt(to)}&homework_enabled=is.true&select=course_name,session_number,session_date,major,homework_questions&order=session_date.desc`).catch(() => []);
      const withHw = (sessions || []).filter(s => {
        const q = s.homework_questions;
        const hasQ = Array.isArray(q) ? q.length > 0 : !!(q && Array.isArray(q.levels) && q.levels.length);
        if (!hasQ) return false;
        const sm = Array.isArray(s.major) ? s.major : [s.major || ''];
        return sm.some(m => accept.includes(m));
      });
      if (withHw.length) {
        const f = withHw[0];
        reminders.push(`📝 ${f.course_name || ''}${f.session_number ? ` 第${f.session_number}回` : ''} 已布置作业${withHw.length > 1 ? ` 等 ${withHw.length} 次` : ''}，请登录学习记录完成提交`);
      }
    } catch (e) {}

    if (!reminders.length) return;
    const strip = document.getElementById('reminderStrip');
    const items = document.getElementById('reminderItems');
    if (strip && items) {
      strip.style.display = 'block';
      items.innerHTML = reminders.map(r => `· ${r}`).join('<br>');
    }
  } catch(e) { /* 静默失败 */ }
}

initMajor();
