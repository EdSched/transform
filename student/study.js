// ══════════════════════════════════
// 学习记录独立页面 study.js
// ══════════════════════════════════

const STUDY_STORAGE_KEY = 'txe_study_login';
const STUDY_DAYS = 30;

let studyStudent = null;
let studyTab = 'schools'; // schools | plan | progress | records
let studyData = { timeline: [], schoolPlans: [], planDraft: null, sharedLists: [], bookings: [], sessionRecs: [] };

// ── 从URL获取专业 ──
const studyParams = new URLSearchParams(location.search);
const studyMajor = studyParams.get('major') || '';

// ── 初始化 ──
async function initStudy() {
  const wrap = document.getElementById('mainWrap');

  // 尝试从 localStorage 恢复登录
  try {
    const raw = localStorage.getItem(STUDY_STORAGE_KEY);
    if (raw) {
      const info = JSON.parse(raw);
      if (Date.now() - info.ts < STUDY_DAYS * 86400000 && info.major === studyMajor) {
        const ok = await studyLogin(info.name, info.code, true);
        if (ok) return;
      }
    }
  } catch(e) {}

  renderStudyLogin(wrap);
}

function renderStudyLogin(wrap) {
  wrap.innerHTML = `
  <div class="card" style="max-width:360px;margin:40px auto">
    <div class="card-title" style="font-size:15px;margin-bottom:16px">学习记录查询</div>
    <div class="form-group">
      <label class="form-label">姓名</label>
      <input id="sl_name" placeholder="真实姓名" autocomplete="name">
    </div>
    <div class="form-group">
      <label class="form-label">查询码</label>
      <input id="sl_code" placeholder="查询码" style="text-transform:uppercase" autocomplete="off"
        onkeydown="if(event.key==='Enter')studyLoginSubmit()">
    </div>
    <div id="sl_error" style="font-size:11px;color:var(--danger);min-height:16px;margin-bottom:8px"></div>
    <button onclick="studyLoginSubmit()" class="btn btn-primary btn-full">查询 →</button>
    <div style="font-size:10px;color:var(--text-muted);margin-top:10px;text-align:center">查询码由老师/管理员提供</div>
  </div>`;
}

async function studyLoginSubmit() {
  const name = document.getElementById('sl_name').value.trim();
  const code = document.getElementById('sl_code').value.trim().toUpperCase();
  const errEl = document.getElementById('sl_error');
  if (!name || !code) { errEl.textContent = '请填写姓名和查询码'; return; }
  errEl.textContent = '查询中…';
  const ok = await studyLogin(name, code, false);
  if (!ok) errEl.textContent = '未找到匹配记录，请确认姓名和查询码是否正确';
}

async function studyLogin(name, code, silent) {
  try {
    const students = await sb(`/rest/v1/students?name=eq.${encodeURIComponent(name)}&student_code=eq.${encodeURIComponent(code)}&select=*`);
    if (!students.length) return false;
    studyStudent = students[0];
    localStorage.setItem(STUDY_STORAGE_KEY, JSON.stringify({ name, code, major: studyMajor, ts: Date.now() }));
    await loadStudyData();
    renderStudyMain();
    return true;
  } catch(e) {
    if (!silent) console.error(e);
    return false;
  }
}

async function loadStudyData() {
  const id = studyStudent.id;
  const name = studyStudent.name;
  const [timeline, schoolPlans, planDraftArr, sharedLists, bookings, sessionRecs] = await Promise.all([
    sb(`/rest/v1/student_progress_timeline?student_id=eq.${id}&select=*&order=created_at.desc`).catch(()=>[]),
    sb(`/rest/v1/student_school_plans?student_id=eq.${id}&select=*&order=level.asc`).catch(()=>[]),
    sb(`/rest/v1/student_plan_drafts?student_id=eq.${id}&select=*&order=updated_at.desc&limit=1`).catch(()=>[]),
    sb(`/rest/v1/teacher_school_shares?major=eq.${studyMajor}&select=*&order=created_at.desc&limit=3`).catch(()=>[]),
    sb(`/rest/v1/bookings?name=eq.${encodeURIComponent(name)}&status=in.("confirmed","completed")&select=*&order=slot_date.desc`).catch(()=>[]),
    sb(`/rest/v1/session_records?student_name=eq.${encodeURIComponent(name)}&select=*&order=session_date.desc`).catch(()=>[]),
  ]);
  studyData = { timeline, schoolPlans, planDraft: planDraftArr[0]||null, sharedLists, bookings, sessionRecs };
}

// ══════════════════════════════════
// 主页面渲染
// ══════════════════════════════════
function renderStudyMain() {
  const s = studyStudent;
  const latest = getLatestProgress(studyData.timeline);

  document.getElementById('mainWrap').innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <div>
      <div style="font-size:16px;font-weight:600">${s.name}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${MAJORS[s.major]||s.major||''}${s.target_enrollment?` · 目标入学：${s.target_enrollment}`:''}</div>
    </div>
    <button onclick="studyLogout()" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit;color:var(--text-muted)">退出</button>
  </div>

  <!-- 快速进度概览 -->
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
    ${Object.entries(PROGRESS_LABELS).map(([k,label]) => {
      const val = k==='japanese'&&!latest[k]&&s.japanese_score ? '有成绩' : k==='english'&&!latest[k]&&s.english_score ? '有成绩' : latest[k];
      if (!val) return '';
      const done = isProgressDone(k, latest[k]);
      const score = k==='japanese'&&s.japanese_score ? ` · ${s.japanese_score}` : k==='english'&&s.english_score ? ` · ${s.english_score}` : '';
      return `<span style="font-size:10px;background:${done?'var(--success-light)':'var(--warning-light)'};color:${done?'var(--success)':'var(--warning)'};padding:2px 8px;border-radius:2px">${PROGRESS_ICONS[k]} ${latest[k]||''}${score}</span>`;
    }).join('')}
  </div>

  <!-- 标签导航 -->
  <div class="study-nav">
    <button class="study-tab ${studyTab==='schools'?'active':''}" onclick="switchStudyTab('schools')">🏫 志望校 (${studyData.schoolPlans.length})</button>
    <button class="study-tab ${studyTab==='plan'?'active':''}" onclick="switchStudyTab('plan')">📄 计划书</button>
    <button class="study-tab ${studyTab==='progress'?'active':''}" onclick="switchStudyTab('progress')">📊 考学进度</button>
    <button class="study-tab ${studyTab==='records'?'active':''}" onclick="switchStudyTab('records')">📋 面谈记录</button>
  </div>

  <div id="studyTabContent"></div>`;

  renderStudyTab();
}

function switchStudyTab(tab) {
  studyTab = tab;
  document.querySelectorAll('.study-tab').forEach(b => b.classList.toggle('active', b.textContent.includes(tab==='schools'?'志望':tab==='plan'?'计划':tab==='progress'?'考学':'面谈')));
  renderStudyTab();
}

function renderStudyTab() {
  const el = document.getElementById('studyTabContent');
  if (!el) return;
  if (studyTab === 'schools') el.innerHTML = renderSchoolsTab();
  else if (studyTab === 'plan') el.innerHTML = renderPlanTab();
  else if (studyTab === 'progress') el.innerHTML = renderProgressTab();
  else if (studyTab === 'records') el.innerHTML = renderRecordsTab();
}

// ══════════════════════════════════
// 志望校 Tab
// ══════════════════════════════════
function renderSchoolsTab() {
  const { schoolPlans, sharedLists } = studyData;
  const levelLabel = { 1:'🔴 冲刺（挑战）', 2:'🟡 匹配（目标）', 3:'🟢 保底' };
  const levelColor = { 1:'#c0392b', 2:'#d4ac0d', 3:'#27ae60' };

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
    <div class="section-label" style="margin:0">志望校列表 (${schoolPlans.length}/6)</div>
    <button onclick="openStudySchoolEditor()" style="font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:5px 12px;cursor:pointer;font-family:inherit">✏ 编辑志望校</button>
  </div>`;

  // 老师共享的学校提示
  if (sharedLists.length && schoolPlans.length < 6) {
    const sl = sharedLists[0];
    html += `<div style="background:#eef3fb;border:1px solid #2c4a7c;border-radius:3px;padding:10px 12px;margin-bottom:14px;font-size:11px">
      <div style="font-weight:600;color:#2c4a7c;margin-bottom:3px">📋 ${sl.title}</div>
      ${sl.notes?`<div style="color:var(--text-secondary)">${sl.notes}</div>`:''}
    </div>`;
  }

  if (!schoolPlans.length) {
    return html + `<div class="empty-tip">暂未填写志望校<br>点击「编辑志望校」开始填写</div>`;
  }

  [1,2,3].forEach(lv => {
    const lvPlans = schoolPlans.filter(p => p.level === lv);
    if (!lvPlans.length) return;
    html += `<div class="level-section">
      <div class="level-header"><span style="color:${levelColor[lv]}">${levelLabel[lv]}</span><span style="font-size:10px;color:var(--text-muted);font-weight:400">${lvPlans.length}所</span></div>`;
    lvPlans.forEach(p => {
      const statusMap = { preparing:'准备中', applied:'已出愿', passed:'✅ 合格', failed:'❌ 不合格' };
      html += `<div class="school-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between">
          <div class="school-card-name">${p.school_name}</div>
          ${p.status&&p.status!=='preparing'?`<span class="badge ${p.status==='passed'?'badge-ok':'badge-warn'}">${statusMap[p.status]||p.status}</span>`:''}
        </div>
        ${p.faculty||p.department?`<div class="school-card-sub">${[p.faculty,p.department].filter(Boolean).join(' · ')}</div>`:''}
        ${p.professor?`<div class="school-card-detail">👤 ${p.professor}</div>`:''}
        ${p.professor_url?`<div class="school-card-detail" style="margin-top:3px"><a href="${p.professor_url}" target="_blank" style="color:var(--accent);font-size:10px">🔗 教授研究内容</a></div>`:''}
        ${p.application_period?`<div style="font-size:11px;color:var(--accent);margin-top:4px">📅 ${p.application_period}</div>`:''}
        ${p.notes?`<div class="school-card-detail" style="margin-top:4px;font-style:italic">${p.notes}</div>`:''}
      </div>`;
    });
    html += `</div>`;
  });

  return html;
}

// ══════════════════════════════════
// 计划书 Tab
// ══════════════════════════════════
function renderPlanTab() {
  const d = studyData.planDraft;
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
    <div class="section-label" style="margin:0">计划书进度</div>
    <button onclick="openStudyPlanEditor()" style="font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:5px 12px;cursor:pointer;font-family:inherit">${d?'✏ 更新':'＋ 开始填写'}</button>
  </div>`;

  if (!d) return html + `<div class="empty-tip">暂未填写计划书进度<br>点击「开始填写」记录你的研究进展</div>`;

  html += `<div class="card">`;
  if (d.research_question) html += `<div style="margin-bottom:12px"><div class="section-label">问题意识</div><div style="font-size:12px;line-height:1.8">${d.research_question}</div></div>`;
  if (d.prior_research) html += `<div style="margin-bottom:12px"><div class="section-label">先行研究</div><div style="font-size:12px;line-height:1.8">${d.prior_research}</div></div>`;
  if (d.prior_research_url) html += `<div style="margin-bottom:12px"><div class="section-label">先行研究链接</div><a href="${d.prior_research_url}" target="_blank" style="font-size:12px;color:var(--accent)">🔗 ${d.prior_research_url}</a></div>`;
  if (d.methodology) html += `<div style="margin-bottom:12px"><div class="section-label">研究方法</div><div style="font-size:12px;line-height:1.8">${d.methodology}</div></div>`;
  if (d.draft_file_url) html += `<div style="margin-bottom:12px"><div class="section-label">草稿文件</div><a href="${d.draft_file_url}" target="_blank" style="font-size:12px;color:var(--accent)">📎 下载草稿文件</a></div>`;
  if (d.teacher_comment) html += `<div style="background:var(--success-light);border-radius:3px;padding:10px 12px;margin-top:8px"><div style="font-size:10px;color:var(--success);font-weight:600;margin-bottom:4px">💬 老师批注</div><div style="font-size:12px;line-height:1.8;color:var(--success)">${d.teacher_comment}</div></div>`;
  html += `<div style="font-size:10px;color:var(--text-muted);margin-top:10px">最后更新：${d.updated_at?.slice(0,10)||''}</div>`;
  html += `</div>`;
  return html;
}

// ══════════════════════════════════
// 考学进度 Tab
// ══════════════════════════════════
function renderProgressTab() {
  const { timeline } = studyData;
  const s = studyStudent;
  const latest = getLatestProgress(timeline);

  let html = `<div style="margin-bottom:14px">
    <div class="section-label">当前进度</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      ${Object.entries(PROGRESS_LABELS).map(([k,label]) => {
        const val = latest[k];
        const score = k==='japanese'&&s.japanese_score ? s.japanese_score : k==='english'&&s.english_score ? s.english_score : '';
        return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:5px">${PROGRESS_ICONS[k]} ${label}</div>
          ${val ? renderProgressBadge(k, val) : '<span style="font-size:11px;color:var(--text-muted)">未填写</span>'}
          ${score?`<div style="font-size:11px;color:var(--text-secondary);margin-top:4px">${score}</div>`:''}
        </div>`;
      }).join('')}
    </div>
  </div>
  <div class="section-label">进度时间线（${timeline.length}条）</div>`;

  if (!timeline.length) return html + `<div class="empty-tip">暂无进度记录</div>`;

  html += timeline.map(entry => {
    const src = PROGRESS_SOURCE_LABEL[entry.source] || PROGRESS_SOURCE_LABEL.admin;
    const dims = ['japanese','english','plan','apply','exam'].filter(k => entry[k]);
    return `<div class="timeline-entry">
      <div>
        <span class="timeline-source" style="background:${src.bg};color:${src.color}">${src.label}</span>
        ${entry.source_name?`<div style="font-size:9px;color:var(--text-muted);margin-top:2px;text-align:center">${entry.source_name}</div>`:''}
      </div>
      <div style="flex:1">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">${entry.recorded_at||entry.created_at?.slice(0,10)||''}</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:3px">
          ${dims.map(k=>`<span style="font-size:11px">${PROGRESS_ICONS[k]} ${PROGRESS_LABELS[k]}：${renderProgressBadge(k,entry[k])}</span>`).join('')}
        </div>
        ${entry.notes?`<div style="font-size:11px;color:var(--text-secondary)">💬 ${entry.notes}</div>`:''}
      </div>
    </div>`;
  }).join('');

  return html;
}

// ══════════════════════════════════
// 面谈记录 Tab
// ══════════════════════════════════
function renderRecordsTab() {
  const { bookings, sessionRecs } = studyData;
  const validBookings = bookings.filter(b => b.daily_record && Object.values(b.daily_record).some(v=>v));
  const validHomework = sessionRecs.filter(r => r.teacher_file_url);

  let html = '';

  if (!validBookings.length && !validHomework.length) return `<div class="empty-tip">暂无面谈记录</div>`;

  if (validBookings.length) {
    html += `<div class="section-label">面谈记录（${validBookings.length}条）</div>`;
    validBookings.forEach(b => {
      html += `<div class="card" style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${b.slot_date}${b.actual_duration?' · '+b.actual_duration+'min':''} · ${b.assigned_teacher||''}老师</div>
        <pre style="font-size:11px;line-height:1.8;white-space:pre-wrap;font-family:inherit;margin:0;color:var(--text-secondary)">${buildRecordText(b)}</pre>
      </div>`;
    });
  }

  if (validHomework.length) {
    html += `<div class="section-label" style="margin-top:16px">作业批改（${validHomework.length}条）</div>`;
    validHomework.forEach(r => {
      html += `<div class="card" style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">${r.session_date} · ${r.course_name||''}</div>
        ${r.feedback_knowledge?`<div style="font-size:12px;margin-bottom:6px">${r.feedback_knowledge}</div>`:''}
        ${r.feedback_suggestions?`<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">💡 ${r.feedback_suggestions}</div>`:''}
        <a href="${r.teacher_file_url}" target="_blank" style="font-size:12px;color:var(--accent)">📎 下载批改文件</a>
      </div>`;
    });
  }

  return html;
}

// ══════════════════════════════════
// 志望校编辑器
// ══════════════════════════════════
async function openStudySchoolEditor() {
  const existing = studyData.schoolPlans;
  const sharedLists = studyData.sharedLists;

  // 拉取共享学校详情
  let sharedSchools = [];
  if (sharedLists.length) {
    const allIds = sharedLists.flatMap(sl => sl.school_ids || []);
    if (allIds.length) {
      sharedSchools = await sb(`/rest/v1/admission_schools?id=in.(${allIds.map(id=>`"${id}"`).join(',')})&select=id,university,faculty,department,application_period,english_required,japanese_required`).catch(()=>[]);
    }
  }

  const modal = document.createElement('div');
  modal.id = 'studySchoolModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';

  const levelLabel = { 1:'🔴 冲刺（挑战）', 2:'🟡 匹配（目标）', 3:'🟢 保底' };

  // 共享学校区块
  const sharedHtml = sharedSchools.length ? `
  <div style="margin-bottom:16px">
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">老师共享的学校（点选添加，最多6所）</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      ${sharedSchools.map(s => `<button onclick="studyAddSharedSchool('${s.id}','${(s.university||'').replace(/'/g,"\\'")}','${(s.faculty||'').replace(/'/g,"\\'")}','${(s.department||'').replace(/'/g,"\\'")}','${s.application_period||''}')" class="school-chip">
        <span>${s.university}</span>
        <span style="color:var(--text-muted);font-size:10px">${s.department||''}</span>
        ${s.application_period?`<span class="school-period">${s.application_period}</span>`:''}
      </button>`).join('')}
    </div>
  </div>` : '';

  const rowsHtml = existing.map((s,i) => buildSchoolRow(s, i)).join('');

  modal.innerHTML = `
  <div style="background:var(--surface,#fff);border-radius:6px;padding:20px;max-width:520px;width:100%;margin:auto">
    <div style="font-size:15px;font-weight:600;margin-bottom:4px">🏫 编辑志望校</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:16px">每个等级建议2所，共最多6所。每校建议找2位教授。</div>
    ${sharedHtml}
    <div class="section-label">已选志望校</div>
    <div id="studySchoolRows">${rowsHtml}</div>
    <button onclick="studyAddSchoolRow()" style="width:100%;background:none;border:1px dashed var(--border);border-radius:3px;padding:8px;font-size:11px;cursor:pointer;font-family:inherit;color:var(--text-muted);margin-bottom:16px">＋ 手动添加学校</button>
    <div style="display:flex;gap:8px">
      <button onclick="saveStudySchoolPlans()" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:4px;padding:11px;font-size:12px;cursor:pointer;font-family:inherit">保存</button>
      <button onclick="document.getElementById('studySchoolModal').remove()" style="background:none;border:1px solid var(--border);border-radius:4px;padding:11px 16px;font-size:12px;cursor:pointer;font-family:inherit">取消</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function buildSchoolRow(s={}, i=Date.now()) {
  const levelLabel = { 1:'🔴 冲刺（挑战）', 2:'🟡 匹配（目标）', 3:'🟢 保底' };
  return `<div style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:12px;margin-bottom:10px" id="sr_${i}">
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <select style="font-size:11px;padding:4px 6px;font-family:inherit;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        ${[1,2,3].map(lv=>`<option value="${lv}" ${(s.level||2)===lv?'selected':''}>${levelLabel[lv]}</option>`).join('')}
      </select>
      <button onclick="this.closest('[id]').remove()" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 8px;cursor:pointer;color:var(--danger)">删除</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <input placeholder="学校名 *" value="${s.school_name||''}" data-field="school_name" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="研究科" value="${s.faculty||''}" data-field="faculty" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="専攻/コース" value="${s.department||''}" data-field="department" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="出愿期间" value="${s.application_period||''}" data-field="application_period" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
    </div>
    <input placeholder="志望教授名" value="${s.professor||''}" data-field="professor" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface);width:100%;margin-top:6px">
    <input placeholder="教授研究内容URL或说明" value="${s.professor_url||''}" data-field="professor_url" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface);width:100%;margin-top:6px">
    <input placeholder="备注" value="${s.notes||''}" data-field="notes" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface);width:100%;margin-top:6px">
    <input type="hidden" value="${s.id||''}" data-field="id">
  </div>`;
}

function studyAddSchoolRow(name='', faculty='', dept='', period='') {
  const c = document.getElementById('studySchoolRows');
  if (c.children.length >= 6) { alert('最多6所，如需更多请在备注中说明'); return; }
  const div = document.createElement('div');
  div.innerHTML = buildSchoolRow({ school_name:name, faculty, department:dept, application_period:period });
  c.appendChild(div.firstElementChild);
}

function studyAddSharedSchool(id, name, faculty, dept, period) {
  const c = document.getElementById('studySchoolRows');
  if (c.children.length >= 6) { alert('最多6所'); return; }
  studyAddSchoolRow(name, faculty, dept, period);
}

async function saveStudySchoolPlans() {
  const rows = [...document.querySelectorAll('#studySchoolRows > div')];
  const plans = rows.map(row => {
    const get = f => row.querySelector(`[data-field="${f}"]`)?.value?.trim()||'';
    return { id:get('id'), school_name:get('school_name'), faculty:get('faculty'), department:get('department'), professor:get('professor'), professor_url:get('professor_url'), application_period:get('application_period'), notes:get('notes'), level:parseInt(row.querySelector('select')?.value||'2') };
  }).filter(p => p.school_name);

  if (!plans.length) { alert('请至少填写一所学校'); return; }

  try {
    await sb(`/rest/v1/student_school_plans?student_id=eq.${studyStudent.id}`, 'DELETE');
    const toInsert = plans.map(p => ({
      id: p.id || `ssp-${Date.now()}-${Math.random().toString(36).slice(2,4)}`,
      student_id: studyStudent.id, student_name: studyStudent.name, major: studyStudent.major,
      school_name:p.school_name, faculty:p.faculty, department:p.department,
      professor:p.professor, professor_url:p.professor_url,
      application_period:p.application_period, notes:p.notes,
      level:p.level, status:'preparing',
    }));
    await sb('/rest/v1/student_school_plans', 'POST', toInsert);
    studyData.schoolPlans = toInsert;
    document.getElementById('studySchoolModal').remove();
    renderStudyTab();
  } catch(e) { alert('保存失败：' + e.message); }
}

// ══════════════════════════════════
// 计划书编辑器
// ══════════════════════════════════
function openStudyPlanEditor() {
  const d = studyData.planDraft || {};
  const modal = document.createElement('div');
  modal.id = 'studyPlanModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';
  modal.innerHTML = `
  <div style="background:var(--surface,#fff);border-radius:6px;padding:20px;max-width:500px;width:100%;margin:auto">
    <div style="font-size:15px;font-weight:600;margin-bottom:14px">📄 计划书进度</div>
    <div style="margin-bottom:10px"><label class="section-label">问题意识</label>
      <textarea id="spd_q" rows="3" placeholder="你的研究问题是什么？" style="width:100%;font-size:12px;padding:8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${d.research_question||''}</textarea></div>
    <div style="margin-bottom:10px"><label class="section-label">先行研究整理</label>
      <textarea id="spd_p" rows="3" placeholder="已读过哪些相关文献？" style="width:100%;font-size:12px;padding:8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${d.prior_research||''}</textarea></div>
    <div style="margin-bottom:10px"><label class="section-label">先行研究链接（可选）</label>
      <input id="spd_pu" value="${d.prior_research_url||''}" placeholder="相关文献/参考资料URL" style="width:100%;font-size:12px;padding:8px;border:1px solid var(--border);border-radius:2px;background:var(--bg)"></div>
    <div style="margin-bottom:10px"><label class="section-label">研究方法</label>
      <textarea id="spd_m" rows="2" placeholder="打算用什么研究方法？" style="width:100%;font-size:12px;padding:8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${d.methodology||''}</textarea></div>
    <div style="margin-bottom:14px"><label class="section-label">草稿文件上传（可选）</label>
      <input type="file" id="spd_file" accept=".doc,.docx,.pdf,.txt" style="font-size:11px">
      ${d.draft_file_url?`<div style="margin-top:6px"><a href="${d.draft_file_url}" target="_blank" style="font-size:11px;color:var(--accent)">📎 当前草稿</a></div>`:''}</div>
    ${d.teacher_comment?`<div style="background:var(--success-light);border-radius:3px;padding:10px;font-size:11px;color:var(--success);margin-bottom:14px">💬 老师批注：${d.teacher_comment}</div>`:''}
    <div style="display:flex;gap:8px">
      <button onclick="saveStudyPlanDraft('${d.id||''}')" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:4px;padding:11px;font-size:12px;cursor:pointer;font-family:inherit">保存</button>
      <button onclick="document.getElementById('studyPlanModal').remove()" style="background:none;border:1px solid var(--border);border-radius:4px;padding:11px 16px;font-size:12px;cursor:pointer;font-family:inherit">取消</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

async function saveStudyPlanDraft(existingId) {
  const q = document.getElementById('spd_q').value.trim();
  const p = document.getElementById('spd_p').value.trim();
  const pu = document.getElementById('spd_pu').value.trim();
  const m = document.getElementById('spd_m').value.trim();
  if (!q && !p && !m) { alert('请至少填写一项内容'); return; }

  let fileUrl = '';
  const fileEl = document.getElementById('spd_file');
  if (fileEl?.files[0]) {
    const f = fileEl.files[0];
    const ext = f.name.split('.').pop().toLowerCase();
    fileUrl = await sbUpload('student-files', `${studyStudent.major||'plan'}/${Date.now()}_draft.${ext}`, f).catch(e => { alert('文件上传失败：'+e.message); return ''; });
    if (!fileUrl) return;
  }

  const data = {
    student_id: studyStudent.id, student_name: studyStudent.name, major: studyStudent.major,
    research_question: q, prior_research: p, prior_research_url: pu, methodology: m,
    draft_file_url: fileUrl || undefined, status: 'drafting', updated_at: new Date().toISOString(),
  };
  try {
    if (existingId) { await sb(`/rest/v1/student_plan_drafts?id=eq.${existingId}`, 'PATCH', data); }
    else { data.id = `spd-${Date.now()}-${Math.random().toString(36).slice(2,4)}`; await sb('/rest/v1/student_plan_drafts', 'POST', data); }
    studyData.planDraft = { ...studyData.planDraft, ...data };
    document.getElementById('studyPlanModal').remove();
    renderStudyTab();
  } catch(e) { alert('保存失败：' + e.message); }
}

function studyLogout() {
  localStorage.removeItem(STUDY_STORAGE_KEY);
  studyStudent = null;
  studyData = { timeline:[], schoolPlans:[], planDraft:null, sharedLists:[], bookings:[], sessionRecs:[] };
  renderStudyLogin(document.getElementById('mainWrap'));
}

// 启动
initStudy();
