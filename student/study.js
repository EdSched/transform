// ══════════════════════════════════
// 学习记录独立页面 study.js
// ══════════════════════════════════

const STUDY_STORAGE_KEY = 'txe_study_login';
const STUDY_DAYS = 30;

let studyStudent = null;
let studyTab = 'schools';
let studyData = { timeline:[], schoolPlans:[], planDraft:null, sharedLists:[], sharedSchools:[], bookings:[], sessionRecs:[] };
let schoolSortBy = 'application_period'; // application_period | japanese_required | english_required
let schoolFilterLang = 'all'; // all | no_english | no_japanese | no_both

const studyParams = new URLSearchParams(location.search);
const studyMajor = studyParams.get('major') || '';

// ── 初始化 ──
async function initStudy() {
  const wrap = document.getElementById('mainWrap');
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
  <div style="max-width:360px;margin:40px auto;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:24px">
    <div style="font-size:15px;font-weight:600;margin-bottom:18px">学习记录查询</div>
    <div style="margin-bottom:12px">
      <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px">姓名</label>
      <input id="sl_name" placeholder="真实姓名" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:2px;background:var(--bg)">
    </div>
    <div style="margin-bottom:14px">
      <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px">查询码</label>
      <input id="sl_code" placeholder="查询码" style="width:100%;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);text-transform:uppercase" onkeydown="if(event.key==='Enter')studyLoginSubmit()">
    </div>
    <div id="sl_error" style="font-size:11px;color:var(--danger);min-height:16px;margin-bottom:10px"></div>
    <button onclick="studyLoginSubmit()" style="width:100%;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:11px;font-size:13px;cursor:pointer;font-family:inherit">查询 →</button>
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
  } catch(e) { if (!silent) console.error(e); return false; }
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
  let sharedSchools = [];
  if (sharedLists.length) {
    const allIds = sharedLists.flatMap(sl => sl.school_ids || []);
    if (allIds.length) {
      sharedSchools = await sb(`/rest/v1/admission_schools?id=in.(${allIds.map(id=>`"${id}"`).join(',')})&select=id,university,faculty,department,course,application_period,english_required,japanese_required,written_exam,oral_exam,result_date&order=application_period.asc`).catch(()=>[]);
    }
  }
  studyData = { timeline, schoolPlans, planDraft: planDraftArr[0]||null, sharedLists, sharedSchools, bookings, sessionRecs };
}

// ══════════════════════════════════
// 主页面
// ══════════════════════════════════
function renderStudyMain() {
  const s = studyStudent;
  const latest = getLatestProgress(studyData.timeline);
  const tabs = [
    { id:'schools', label:`🏫 志望校 (${studyData.schoolPlans.length}/6)` },
    { id:'plan', label:'📄 计划书' },
    { id:'progress', label:'📊 考学进度' },
    { id:'records', label:'📋 面谈 & 作业' },
  ];

  // 进度概览 badges
  const badges = Object.entries(PROGRESS_LABELS).map(([k]) => {
    const val = latest[k] || (k==='japanese'&&s.japanese_score?'有成绩':k==='english'&&s.english_score?'有成绩':'');
    if (!val) return '';
    const score = k==='japanese'&&s.japanese_score?` · ${s.japanese_score}`:k==='english'&&s.english_score?` · ${s.english_score}`:'';
    const done = isProgressDone(k, latest[k]);
    return `<span style="font-size:11px;background:${done?'var(--ok-bg)':'var(--warn-bg)'};color:${done?'var(--ok)':'var(--warn)'};padding:2px 8px;border-radius:2px">${PROGRESS_ICONS[k]} ${latest[k]||''}${score}</span>`;
  }).filter(Boolean).join('');

  document.getElementById('mainWrap').innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
    <div>
      <span style="font-size:16px;font-weight:600">${s.name}</span>
      <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${MAJORS[s.major]||s.major||''}${s.target_enrollment?` · 目标：${s.target_enrollment}`:''}</span>
    </div>
    <button onclick="studyLogout()" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit;color:var(--text-muted)">退出</button>
  </div>
  ${badges?`<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px">${badges}</div>`:''}
  <div style="display:flex;gap:0;border-bottom:2px solid var(--border-light);margin-bottom:18px">
    ${tabs.map(t=>`<button onclick="switchStudyTab('${t.id}')" style="padding:7px 14px;font-size:12px;background:none;border:none;border-bottom:2px solid ${studyTab===t.id?'var(--accent)':'transparent'};margin-bottom:-2px;cursor:pointer;font-family:inherit;color:${studyTab===t.id?'var(--accent)':'var(--text-muted)'};font-weight:${studyTab===t.id?'600':'400'};white-space:nowrap">${t.label}</button>`).join('')}
  </div>
  <div id="studyTabContent"></div>`;
  renderStudyTab();
}

function switchStudyTab(tab) {
  studyTab = tab;
  renderStudyMain();
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
  const { schoolPlans, sharedLists, sharedSchools } = studyData;
  const levelLabel = { 1:'🔴 冲刺', 2:'🟡 匹配', 3:'🟢 保底' };

  // 排序+筛选共享学校
  let displaySchools = [...sharedSchools];
  if (schoolFilterLang === 'no_english') displaySchools = displaySchools.filter(s => s.english_required === '不要');
  else if (schoolFilterLang === 'no_japanese') displaySchools = displaySchools.filter(s => s.japanese_required === '不要');
  else if (schoolFilterLang === 'no_both') displaySchools = displaySchools.filter(s => s.english_required === '不要' && s.japanese_required === '不要');

  if (schoolSortBy === 'application_period') displaySchools.sort((a,b) => (a.application_period||'').localeCompare(b.application_period||''));
  else if (schoolSortBy === 'english_required') displaySchools.sort((a,b) => (a.english_required==='不要'?0:1)-(b.english_required==='不要'?0:1));
  else if (schoolSortBy === 'japanese_required') displaySchools.sort((a,b) => (a.japanese_required==='不要'?0:1)-(b.japanese_required==='不要'?0:1));

  // 共享学校表格HTML
  const sharedTableHtml = sharedLists.length ? `
    <div style="margin-bottom:10px">
      <div style="font-size:12px;font-weight:600;color:#2c4a7c;margin-bottom:2px">📋 ${sharedLists[0].title}</div>
      ${sharedLists[0].notes?`<div style="font-size:11px;color:#2c4a7c;opacity:.8;margin-bottom:8px">${sharedLists[0].notes}</div>`:''}
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <select onchange="schoolFilterLang=this.value;renderStudyTab()" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
          <option value="all" ${schoolFilterLang==='all'?'selected':''}>全部</option>
          <option value="no_english" ${schoolFilterLang==='no_english'?'selected':''}>不要英语</option>
          <option value="no_japanese" ${schoolFilterLang==='no_japanese'?'selected':''}>不要日语</option>
          <option value="no_both" ${schoolFilterLang==='no_both'?'selected':''}>均不要</option>
        </select>
        <select onchange="schoolSortBy=this.value;renderStudyTab()" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
          <option value="application_period" ${schoolSortBy==='application_period'?'selected':''}>按出愿期排序</option>
          <option value="english_required" ${schoolSortBy==='english_required'?'selected':''}>英语不要优先</option>
          <option value="japanese_required" ${schoolSortBy==='japanese_required'?'selected':''}>日语不要优先</option>
        </select>
      </div>
      <div style="border:1px solid #c5d9f0;border-radius:4px;overflow-y:auto;max-height:calc(100vh - 200px)">
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead style="position:sticky;top:0;z-index:1">
            <tr style="background:#ddeaf9">
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:#2c4a7c;border-bottom:1px solid #c5d9f0;white-space:nowrap">大学</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:#2c4a7c;border-bottom:1px solid #c5d9f0">研究科/専攻</th>
              <th style="padding:6px 6px;text-align:center;font-weight:600;color:#2c4a7c;border-bottom:1px solid #c5d9f0;white-space:nowrap">出愿</th>
              <th style="padding:6px 4px;text-align:center;font-weight:600;color:#2c4a7c;border-bottom:1px solid #c5d9f0">日</th>
              <th style="padding:6px 4px;text-align:center;font-weight:600;color:#2c4a7c;border-bottom:1px solid #c5d9f0">英</th>
            </tr>
          </thead>
          <tbody>
            ${displaySchools.map((s,i) => {
              const jpColor = s.japanese_required==='不要'?'#27ae60':s.japanese_required==='必須'?'#c0392b':'#856404';
              const enColor = s.english_required==='不要'?'#27ae60':s.english_required==='必須'?'#c0392b':'#856404';
              return `<tr style="border-bottom:1px solid #e8f0fb;background:${i%2===0?'#fff':'#f5f9ff'}">
                <td style="padding:6px 8px;font-weight:600;white-space:nowrap">${s.university}</td>
                <td style="padding:6px 8px;color:#444;font-size:10px">${[s.faculty,s.department,s.course].filter(Boolean).join(' · ')}</td>
                <td style="padding:6px 6px;text-align:center;color:var(--accent);white-space:nowrap;font-size:10px">${s.application_period||'-'}</td>
                <td style="padding:6px 4px;text-align:center;color:${jpColor};font-weight:600;font-size:10px">${s.japanese_required==='不要'?'不要':s.japanese_required==='必須'?'必須':'任意'}</td>
                <td style="padding:6px 4px;text-align:center;color:${enColor};font-weight:600;font-size:10px">${s.english_required==='不要'?'不要':s.english_required==='必須'?'必須':'任意'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  // 志望校编辑区（内联，不弹窗）
  const schoolOptions = sharedSchools.map(s =>
    `<option value="${s.id}" data-name="${s.university}" data-faculty="${s.faculty||''}" data-dept="${s.department||''}" data-period="${s.application_period||''}">${s.university} ${[s.department,s.course].filter(Boolean).join(' ')}</option>`
  ).join('');

  function buildRow(p={}, lv, idx) {
    return `<div style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:10px;margin-bottom:8px" data-level="${lv}" id="sr_${lv}_${idx}">
      <div style="font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:6px">第${idx+1}校</div>
      <select onchange="studyApplySharedSchool(this)" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface);width:100%;margin-bottom:6px">
        <option value="">— 从共享列表选择 —</option>
        ${schoolOptions}
      </select>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px">
        <input placeholder="学校名 *" value="${p.school_name||''}" data-field="school_name" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="研究科" value="${p.faculty||''}" data-field="faculty" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="専攻/コース" value="${p.department||''}" data-field="department" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="出愿时间（精确）" value="${p.application_period||''}" data-field="application_period" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="考试日期" value="${p.exam_date||''}" data-field="exam_date" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="必要书类（推荐信等）" value="${p.documents_required||''}" data-field="documents_required" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">👤 教授（每校尽量2位）</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px">
        <input placeholder="教授1姓名" value="${p.professor||''}" data-field="professor" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="教授1研究内容URL" value="${p.professor_url||''}" data-field="professor_url" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="教授2姓名" value="${p.professor2||''}" data-field="professor2" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="教授2研究内容URL" value="${p.professor2_url||''}" data-field="professor2_url" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
        <input placeholder="计划书要求（字数/格式）" value="${p.plan_requirement||''}" data-field="plan_requirement" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="研究课题（目前方向）" value="${p.research_theme||''}" data-field="research_theme" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      </div>
      <input type="hidden" value="${p.id||''}" data-field="id">
    </div>`;
  }

  const levelGroups = [
    { lv:1, label:'🔴 冲刺（挑战）', plans: schoolPlans.filter(p=>p.level===1) },
    { lv:2, label:'🟡 匹配（目标）', plans: schoolPlans.filter(p=>p.level===2) },
    { lv:3, label:'🟢 保底', plans: schoolPlans.filter(p=>p.level===3) },
  ];

  let editHtml = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
    <div style="font-size:12px;font-weight:600">我的志望校 (${schoolPlans.length}/6)</div>
    <button onclick="saveStudySchoolPlans()" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:6px 16px;cursor:pointer;font-family:inherit;font-weight:500">保存</button>
  </div>
  <div id="studySchoolRows">`;

  levelGroups.forEach(g => {
    editHtml += `<div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:600;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid var(--border-light)">${g.label}（推荐2校）</div>`;
    const rows = g.plans.length >= 2 ? g.plans : [...g.plans, ...Array(2-g.plans.length).fill({})];
    rows.forEach((p,i) => { editHtml += buildRow(p, g.lv, i); });
    editHtml += `<button onclick="studyAddSchoolRowToGroup(${g.lv})" style="font-size:10px;background:none;border:1px dashed var(--border);border-radius:2px;padding:3px 10px;cursor:pointer;color:var(--text-muted);font-family:inherit">＋ 再添加一校</button>
    </div>`;
  });
  editHtml += `</div>`;

  // 左右分栏，各自独立上下滚动
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
    <div>${sharedTableHtml || '<div style="font-size:11px;color:var(--text-muted)">暂无共享学校列表</div>'}</div>
    <div style="overflow-y:auto;max-height:calc(100vh - 160px);padding-right:4px">${editHtml}</div>
  </div>`;
}

function studyApplySharedSchool(sel) {
  if (!sel.value) return;
  const opt = sel.options[sel.selectedIndex];
  const row = sel.closest('[data-level]');
  if (!row) return;
  const set = (f,v) => { const el = row.querySelector(`[data-field="${f}"]`); if(el) el.value = v; };
  set('school_name', opt.dataset.name || '');
  set('faculty', opt.dataset.faculty || '');
  set('department', opt.dataset.dept || '');
  set('application_period', opt.dataset.period || '');
  // 选择后重置下拉，让用户知道已带入
  sel.value = '';
}

function studyAddSchoolRowToGroup(lv) {
  const allRows = document.querySelectorAll('#studySchoolRows [data-level]').length;
  if (allRows >= 6) { alert('最多6所学校'); return; }
  const schoolOptions = studyData.sharedSchools.map(s =>
    `<option value="${s.id}" data-name="${s.university}" data-faculty="${s.faculty||''}" data-dept="${s.department||''}" data-period="${s.application_period||''}">${s.university} ${[s.department,s.course].filter(Boolean).join(' ')}</option>`
  ).join('');
  const lvRows = document.querySelectorAll(`#studySchoolRows [data-level="${lv}"]`).length;
  const div = document.createElement('div');
  div.setAttribute('data-level', lv);
  div.style.cssText = 'background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:10px;margin-bottom:8px';
  div.innerHTML = `
    <div style="font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:6px">第${lvRows+1}校</div>
    <select onchange="studyApplySharedSchool(this)" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface);width:100%;margin-bottom:6px">
      <option value="">— 从共享列表选择 —</option>
      ${schoolOptions}
    </select>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px">
      <input placeholder="学校名 *" data-field="school_name" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="研究科" data-field="faculty" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="専攻/コース" data-field="department" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="出愿时间（精确）" data-field="application_period" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="考试日期" data-field="exam_date" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="必要书类" data-field="documents_required" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
    </div>
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">👤 教授</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px">
      <input placeholder="教授1姓名" data-field="professor" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="教授1研究内容URL" data-field="professor_url" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="教授2姓名" data-field="professor2" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="教授2研究内容URL" data-field="professor2_url" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
      <input placeholder="计划书要求" data-field="plan_requirement" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="研究课题" data-field="research_theme" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
    </div>
    <input type="hidden" value="" data-field="id">`;
  // Insert before add button
  const btn = [...document.querySelectorAll('#studySchoolRows button')].find(b => b.onclick?.toString().includes(`(${lv})`));
  if (btn) btn.parentElement.insertBefore(div, btn);
}


async function saveStudySchoolPlans() {
  const rows = [...document.querySelectorAll('#studySchoolRows [data-level]')];
  if (!rows.length) { alert('页面加载中，请稍后再试'); return; }
  const plans = rows.map(row => {
    const inputs = [...row.querySelectorAll('input[data-field], select[data-field]')];
    const get = f => {
      const el = inputs.find(i => i.dataset.field === f);
      return el ? el.value.trim() : '';
    };
    const lv = parseInt(row.dataset.level||'2');
    return { id:get('id'), level:lv, school_name:get('school_name'), faculty:get('faculty'), department:get('department'), application_period:get('application_period'), exam_date:get('exam_date'), professor:get('professor'), professor_url:get('professor_url'), professor2:get('professor2'), professor2_url:get('professor2_url'), plan_requirement:get('plan_requirement'), research_theme:get('research_theme'), documents_required:get('documents_required') };
  }).filter(p => p.school_name);

  if (!plans.length) { alert('请至少填写一所学校的学校名'); return; }

  try {
    await sb(`/rest/v1/student_school_plans?student_id=eq.${studyStudent.id}`, 'DELETE');
    const toInsert = plans.map(p => ({
      id: p.id || `ssp-${Date.now()}-${Math.random().toString(36).slice(2,4)}`,
      student_id: studyStudent.id, student_name: studyStudent.name, major: studyStudent.major,
      school_name:p.school_name, faculty:p.faculty, department:p.department,
      professor:p.professor, professor_url:p.professor_url,
      professor2:p.professor2, professor2_url:p.professor2_url,
      application_period:p.application_period, exam_date:p.exam_date,
      plan_requirement:p.plan_requirement, research_theme:p.research_theme,
      documents_required:p.documents_required,
      level:p.level, status:'preparing',
    }));
    await sb('/rest/v1/student_school_plans', 'POST', toInsert);
    studyData.schoolPlans = toInsert;
    switchStudyTab('schools');
  } catch(e) { alert('保存失败：' + e.message); }
}

// ══════════════════════════════════
// 计划书编辑器（先行研究+草稿两部分）
// ══════════════════════════════════
function openStudyPlanEditor() {
  const d = studyData.planDraft || {};
  const modal = document.createElement('div');
  modal.id = 'studyPlanModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:12px;overflow-y:auto';
  modal.innerHTML = `
  <div style="background:var(--surface,#fff);border-radius:6px;padding:20px;max-width:520px;width:100%;margin:auto">
    <div style="font-size:15px;font-weight:600;margin-bottom:14px">📄 计划书进度</div>

    <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:.06em;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border-light)">先行研究</div>
    <div style="margin-bottom:10px">
      <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">问题意识</label>
      <textarea id="spd_q" rows="3" style="width:100%;font-size:12px;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${d.research_question||''}</textarea>
    </div>
    <div style="margin-bottom:10px">
      <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">先行研究整理（已读过哪些文献？）</label>
      <textarea id="spd_p" rows="4" style="width:100%;font-size:12px;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${d.prior_research||''}</textarea>
    </div>
    <div style="margin-bottom:10px">
      <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">先行研究链接（文献URL或参考资料）</label>
      <input id="spd_pu" value="${d.prior_research_url||''}" placeholder="https://…" style="width:100%;font-size:12px;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg)">
    </div>
    <div style="margin-bottom:16px">
      <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">研究方法</label>
      <textarea id="spd_m" rows="2" style="width:100%;font-size:12px;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${d.methodology||''}</textarea>
    </div>

    <div style="font-size:11px;font-weight:600;color:var(--text-muted);letter-spacing:.06em;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border-light)">计划书草稿</div>
    <div style="margin-bottom:10px">
      <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">草稿说明（进展情况、遇到的问题等）</label>
      <textarea id="spd_dn" rows="3" style="width:100%;font-size:12px;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${d.draft_notes||''}</textarea>
    </div>
    <div style="margin-bottom:14px">
      <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">上传草稿文件（可选）</label>
      <input type="file" id="spd_file" accept=".doc,.docx,.pdf,.txt" style="font-size:11px">
      ${d.draft_file_url?`<div style="margin-top:5px"><a href="${d.draft_file_url}" target="_blank" style="font-size:11px;color:var(--accent)">📎 当前草稿</a></div>`:''}
    </div>

    ${d.teacher_comment?`<div style="background:var(--ok-bg);border-radius:3px;padding:10px;font-size:11px;color:var(--ok);margin-bottom:14px">💬 老师批注：${d.teacher_comment}</div>`:''}

    <div style="display:flex;gap:8px">
      <button onclick="saveStudyPlanDraft('${d.id||''}')" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:4px;padding:11px;font-size:13px;cursor:pointer;font-family:inherit">保存</button>
      <button onclick="document.getElementById('studyPlanModal').remove()" style="background:none;border:1px solid var(--border);border-radius:4px;padding:11px 18px;font-size:12px;cursor:pointer;font-family:inherit">取消</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

async function saveStudyPlanDraft(existingId) {
  const q = document.getElementById('spd_q').value.trim();
  const p = document.getElementById('spd_p').value.trim();
  const pu = document.getElementById('spd_pu').value.trim();
  const m = document.getElementById('spd_m').value.trim();
  const dn = document.getElementById('spd_dn').value.trim();
  if (!q && !p && !m && !dn) { alert('请至少填写一项内容'); return; }

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
    draft_notes: dn, draft_file_url: fileUrl || undefined,
    status: 'drafting', updated_at: new Date().toISOString(),
  };
  try {
    if (existingId) { await sb(`/rest/v1/student_plan_drafts?id=eq.${existingId}`, 'PATCH', data); }
    else { data.id = `spd-${Date.now()}-${Math.random().toString(36).slice(2,4)}`; await sb('/rest/v1/student_plan_drafts', 'POST', data); }
    studyData.planDraft = { ...(studyData.planDraft||{}), ...data };
    document.getElementById('studyPlanModal').remove();
    switchStudyTab('plan');
  } catch(e) { alert('保存失败：' + e.message); }
}

function studyLogout() {
  localStorage.removeItem(STUDY_STORAGE_KEY);
  studyStudent = null;
  studyData = { timeline:[], schoolPlans:[], planDraft:null, sharedLists:[], sharedSchools:[], bookings:[], sessionRecs:[] };
  renderStudyLogin(document.getElementById('mainWrap'));
}

initStudy();

// ══════════════════════════════════
// 计划书 Tab（三步骤）
// ══════════════════════════════════

function renderPlanTab() {
  const d = studyData.planDraft || {};
  const refs = d.prior_research_list ? JSON.parse(d.prior_research_list) : [];

  return `<div>
    <!-- 步骤1：先行研究 -->
    <div style="margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid var(--border-light)">
        Step 1 · 先行研究整理
      </div>

      <!-- 添加文献 -->
      <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">按以下格式添加已读文献：</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
          <input id="ref_author" placeholder="作者名" style="font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg)">
          <input id="ref_year" placeholder="发表年份（如 2023）" style="font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg)">
          <input id="ref_title" placeholder="文献题目" style="font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg)">
          <input id="ref_journal" placeholder="期刊/出版社" style="font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg)">
        </div>
        <input id="ref_note" placeholder="与研究的关联（这篇文献和你研究的关系是什么？）" style="font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);width:100%;margin-bottom:8px">
        <button onclick="studyAddRef()" style="font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">＋ 添加</button>
      </div>

      <!-- 文献列表 -->
      <div id="study_ref_list">
        ${refs.length ? `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:11px;font-weight:600">已整理文献（${refs.length}条）</div>
          <select onchange="studySortRefs(this.value)" style="font-size:10px;padding:2px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
            <option value="order">添加顺序</option>
            <option value="year">按年份</option>
            <option value="author">按作者</option>
          </select>
        </div>
        <div style="border:1px solid var(--border-light);border-radius:3px;overflow:hidden">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:var(--bg)">
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border-light)">作者</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border-light)">年份</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border-light)">题目</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border-light)">期刊</th>
              <th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border-light)">与研究关联</th>
              <th style="padding:4px;border-bottom:1px solid var(--border-light)"></th>
            </tr></thead>
            <tbody>
              ${refs.map((r,i) => `<tr style="border-bottom:1px solid var(--border-light);background:${i%2===0?'var(--surface)':'var(--bg)'}">
                <td style="padding:7px 8px">${r.author||''}</td>
                <td style="padding:7px 8px;white-space:nowrap">${r.year||''}</td>
                <td style="padding:7px 8px">${r.title||''}</td>
                <td style="padding:7px 8px;font-size:10px;color:var(--text-muted)">${r.journal||''}</td>
                <td style="padding:7px 8px;font-size:10px;color:var(--text-secondary)">${r.note||''}</td>
                <td style="padding:4px 6px"><button onclick="studyDeleteRef(${i})" style="font-size:10px;background:none;border:none;cursor:pointer;color:var(--danger)">✕</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:11px;border:1px dashed var(--border);border-radius:3px">暂无文献，请在上方添加</div>'}
      </div>
    </div>

    <!-- 步骤2：草稿撰写 -->
    <div style="margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid var(--border-light)">
        Step 2 · 计划书草稿
      </div>
      <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px">
        <div style="margin-bottom:10px">
          <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">问题意识（你的研究问题是什么？）</label>
          <textarea id="spd_q" rows="3" style="width:100%;font-size:12px;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${d.research_question||''}</textarea>
        </div>
        <div style="margin-bottom:10px">
          <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">研究方法</label>
          <textarea id="spd_m" rows="2" style="width:100%;font-size:12px;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${d.methodology||''}</textarea>
        </div>
        <div style="margin-bottom:10px">
          <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">草稿进展说明</label>
          <textarea id="spd_dn" rows="2" style="width:100%;font-size:12px;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${d.draft_notes||''}</textarea>
        </div>
        <button onclick="studySaveDraft()" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 18px;cursor:pointer;font-family:inherit">保存草稿</button>
        <span id="spd_save_msg" style="font-size:11px;margin-left:10px"></span>
        ${d.teacher_comment?`<div style="background:var(--ok-bg);border-radius:3px;padding:10px;margin-top:10px;font-size:11px;color:var(--ok)">💬 老师批注：${d.teacher_comment}</div>`:''}
      </div>
    </div>

    <!-- 步骤3：完成稿上传 -->
    <div>
      <div style="font-size:12px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid var(--border-light)">
        Step 3 · 完成稿上传
      </div>
      <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px">
        ${d.draft_file_url?`<div style="margin-bottom:10px"><a href="${d.draft_file_url}" target="_blank" style="font-size:12px;color:var(--accent)">📎 当前上传的文件</a></div>`:''}
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">上传计划书文件（.doc / .docx / .pdf）</div>
        <input type="file" id="spd_file" accept=".doc,.docx,.pdf" style="font-size:11px;margin-bottom:10px">
        <button onclick="studyUploadDraft()" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 18px;cursor:pointer;font-family:inherit">上传</button>
        <span id="spd_upload_msg" style="font-size:11px;margin-left:10px"></span>
      </div>
    </div>
  </div>`;
}

async function studyAddRef() {
  const get = id => document.getElementById(id)?.value.trim() || '';
  const author = get('ref_author'), year = get('ref_year'), title = get('ref_title'), journal = get('ref_journal'), note = get('ref_note');
  if (!author && !title) { alert('请至少填写作者名或题目'); return; }
  const d = studyData.planDraft || {};
  const refs = d.prior_research_list ? JSON.parse(d.prior_research_list) : [];
  refs.push({ author, year, title, journal, note });
  await studySavePlanField({ prior_research_list: JSON.stringify(refs) });
  ['ref_author','ref_year','ref_title','ref_journal','ref_note'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  switchStudyTab('plan');
}

async function studyDeleteRef(idx) {
  const d = studyData.planDraft || {};
  const refs = d.prior_research_list ? JSON.parse(d.prior_research_list) : [];
  refs.splice(idx, 1);
  await studySavePlanField({ prior_research_list: JSON.stringify(refs) });
  switchStudyTab('plan');
}

function studySortRefs(by) {
  const d = studyData.planDraft || {};
  const refs = d.prior_research_list ? JSON.parse(d.prior_research_list) : [];
  if (by === 'year') refs.sort((a,b) => (a.year||'').localeCompare(b.year||''));
  else if (by === 'author') refs.sort((a,b) => (a.author||'').localeCompare(b.author||''));
  studyData.planDraft = { ...d, prior_research_list: JSON.stringify(refs) };
  switchStudyTab('plan');
}

async function studySaveDraft() {
  const q = document.getElementById('spd_q')?.value.trim() || '';
  const m = document.getElementById('spd_m')?.value.trim() || '';
  const dn = document.getElementById('spd_dn')?.value.trim() || '';
  const msg = document.getElementById('spd_save_msg');
  if (msg) msg.textContent = '保存中…';
  await studySavePlanField({ research_question:q, methodology:m, draft_notes:dn });
  if (msg) { msg.textContent = '✓ 已保存'; setTimeout(()=>{ if(msg) msg.textContent=''; }, 2000); }
}

async function studyUploadDraft() {
  const fileEl = document.getElementById('spd_file');
  const msg = document.getElementById('spd_upload_msg');
  if (!fileEl?.files[0]) { if(msg) msg.textContent = '请先选择文件'; return; }
  if (msg) msg.textContent = '上传中…';
  try {
    const f = fileEl.files[0];
    const ext = f.name.split('.').pop().toLowerCase();
    const fileUrl = await sbUpload('student-files', `${studyStudent.major||'plan'}/${Date.now()}_draft.${ext}`, f);
    await studySavePlanField({ draft_file_url: fileUrl });
    if (msg) msg.textContent = '✓ 上传成功';
    fileEl.value = '';
    switchStudyTab('plan');
  } catch(e) { if(msg) msg.textContent = '上传失败：' + e.message; }
}

async function studySavePlanField(fields) {
  const d = studyData.planDraft;
  const data = { student_id: studyStudent.id, student_name: studyStudent.name, major: studyStudent.major, updated_at: new Date().toISOString(), ...fields };
  try {
    if (d?.id) {
      await sb(`/rest/v1/student_plan_drafts?id=eq.${d.id}`, 'PATCH', data);
      studyData.planDraft = { ...d, ...data };
    } else {
      data.id = `spd-${Date.now()}-${Math.random().toString(36).slice(2,4)}`;
      data.status = 'drafting';
      await sb('/rest/v1/student_plan_drafts', 'POST', data);
      studyData.planDraft = data;
    }
  } catch(e) { alert('保存失败：' + e.message); }
}


// ══════════════════════════════════
// 考学进度 Tab
// ══════════════════════════════════
function renderProgressTab() {
  const { timeline } = studyData;
  const s = studyStudent;
  const latest = getLatestProgress(timeline);
  let html = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px">
    ${Object.entries(PROGRESS_LABELS).map(([k,label]) => {
      const val = latest[k];
      const score = k==='japanese'&&s.japanese_score?s.japanese_score:k==='english'&&s.english_score?s.english_score:'';
      return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:5px">${PROGRESS_ICONS[k]} ${label}</div>
        ${val?renderProgressBadge(k,val):`<span style="font-size:11px;color:var(--text-muted)">未填写</span>`}
        ${score?`<div style="font-size:11px;color:var(--text-secondary);margin-top:4px">${score}</div>`:''}
      </div>`;
    }).join('')}
  </div>`;
  if (!timeline.length) return html + `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">暂无进度记录</div>`;
  html += `<div style="font-size:11px;font-weight:600;margin-bottom:10px">进度时间线（${timeline.length}条）</div>`;
  html += timeline.map(entry => {
    const src = PROGRESS_SOURCE_LABEL[entry.source] || PROGRESS_SOURCE_LABEL.admin;
    const dims = ['japanese','english','plan','apply','exam'].filter(k => entry[k]);
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border-light);display:flex;gap:10px">
      <div style="min-width:56px;text-align:right">
        <span style="font-size:10px;background:${src.bg};color:${src.color};padding:1px 6px;border-radius:2px">${src.label}</span>
        ${entry.source_name?`<div style="font-size:9px;color:var(--text-muted);margin-top:2px">${entry.source_name}</div>`:''}
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
// 面谈 & 作业 Tab
// ══════════════════════════════════
let studyHwSession = null;
let studyHwData = {};

function renderRecordsTab() {
  const { bookings, sessionRecs } = studyData;
  const validBookings = bookings.filter(b => b.daily_record && Object.values(b.daily_record).some(v=>v));
  const validHomework = sessionRecs.filter(r => r.teacher_file_url);

  let html = `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px;margin-bottom:16px">
    <div style="font-size:12px;font-weight:600;margin-bottom:10px">📝 提交作业</div>
    <div id="study_hw_sessions_wrap"><div style="font-size:11px;color:var(--text-muted)">加载中…</div></div>
    <div id="study_hw_upload" style="display:none;margin-top:10px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">上传作业文件（图片 / PDF / Word，最大50MB）</div>
      <input type="file" id="study_hw_file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="font-size:11px;margin-bottom:8px">
      <button onclick="studySubmitHomework()" style="background:var(--accent);color:#fff;border:none;border-radius:3px;padding:8px 16px;font-size:12px;cursor:pointer;font-family:inherit;width:100%">提交作业</button>
      <div id="study_hw_result" style="margin-top:8px;font-size:11px"></div>
    </div>
  </div>`;

  if (validHomework.length) {
    html += `<div style="font-size:11px;font-weight:600;margin-bottom:10px">✅ 已批改作业（${validHomework.length}条）</div>`;
    validHomework.forEach(r => {
      html += `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:12px;margin-bottom:8px">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${r.session_date} · ${r.course_name||''}</div>
        ${r.feedback_knowledge?`<div style="font-size:12px;margin-bottom:4px">${r.feedback_knowledge}</div>`:''}
        ${r.feedback_suggestions?`<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">💡 ${r.feedback_suggestions}</div>`:''}
        <a href="${r.teacher_file_url}" target="_blank" style="font-size:12px;color:var(--accent)">📎 下载批改文件</a>
      </div>`;
    });
  }

  if (validBookings.length) {
    html += `<div style="font-size:11px;font-weight:600;margin:16px 0 10px">📋 面谈记录（${validBookings.length}条）</div>`;
    validBookings.forEach(b => {
      html += `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:12px;margin-bottom:8px">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${b.slot_date}${b.actual_duration?' · '+b.actual_duration+'min':''} ${b.assigned_teacher?'· '+b.assigned_teacher+'老师':''}</div>
        <pre style="font-size:11px;line-height:1.8;white-space:pre-wrap;font-family:inherit;margin:0;color:var(--text-secondary)">${buildRecordText(b)}</pre>
      </div>`;
    });
  }

  if (!validBookings.length && !validHomework.length) {
    html += `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px">暂无面谈记录</div>`;
  }

  // 渲染后加载课程列表
  setTimeout(() => loadStudyHwSessions(), 100);
  return html;
}

async function loadStudyHwSessions() {
  const wrap = document.getElementById('study_hw_sessions_wrap');
  if (!wrap) return;
  const name = studyStudent.name;
  const major = studyMajor;
  try {
    const today = new Date();
    const from = new Date(today); from.setDate(today.getDate() - 7);
    const to = new Date(today); to.setDate(today.getDate() + 14);
    const fmt = d => d.toISOString().slice(0,10);
    const [sessions, records] = await Promise.all([
      sb(`/rest/v1/course_sessions?session_date=gte.${fmt(from)}&session_date=lte.${fmt(to)}&homework_enabled=is.true&select=*&order=session_date.desc`).catch(()=>[]),
      sb(`/rest/v1/session_records?student_name=eq.${encodeURIComponent(name)}&select=session_id,homework_submitted,homework_file_url`).catch(()=>[]),
    ]);
    const relevant = sessions.filter(s => {
      const sm = Array.isArray(s.major) ? s.major : [s.major||''];
      if (!major) return true;
      if (major === 'shakai_group') return sm.some(m => ['shakai','shinpan','fukushi'].includes(m));
      return sm.includes(major);
    });
    if (!relevant.length) {
      wrap.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">近期暂无需提交作业的课程</div>';
      return;
    }
    const submittedIds = new Set(records.filter(r => r.homework_submitted || r.homework_file_url).map(r => r.session_id));
    wrap.innerHTML = '';
    relevant.forEach(s => {
      const submitted = submittedIds.has(s.id);
      const label = `${s.session_date} · ${s.course_name}${s.session_title?' · '+s.session_title:''}`;
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:var(--bg);border:1px solid ${submitted?'var(--ok)':'var(--border)'};border-radius:3px;cursor:${submitted?'default':'pointer'};margin-bottom:4px`;
      row.dataset.id = s.id; row.dataset.name = s.course_name; row.dataset.date = s.session_date;
      if (!submitted) row.addEventListener('click', function() { studySelectHwSession(this); });
      row.innerHTML = `<span style="font-size:12px;color:var(--text-2)">${label}</span><span style="font-size:10px;color:${submitted?'var(--ok)':'var(--text-muted)'};margin-left:12px">${submitted?'✓ 已提交':'未提交'}</span>`;
      wrap.appendChild(row);
    });
  } catch(e) {
    if (wrap) wrap.innerHTML = `<div style="font-size:11px;color:var(--danger)">加载失败：${e.message}</div>`;
  }
}

function studySelectHwSession(el) {
  const id = el.dataset.id;
  const upload = document.getElementById('study_hw_upload');
  if (studyHwSession === id) {
    studyHwSession = null; studyHwData = {};
    el.style.background = 'var(--bg)'; el.style.borderColor = 'var(--border)';
    if (upload) upload.style.display = 'none';
    return;
  }
  studyHwSession = id;
  studyHwData = { id, name: el.dataset.name, date: el.dataset.date };
  el.closest('#study_hw_sessions_wrap').querySelectorAll('[data-id]').forEach(d => {
    d.style.background = 'var(--bg)'; d.style.borderColor = 'var(--border)';
  });
  el.style.background = '#f0f7ff'; el.style.borderColor = 'var(--accent)';
  if (upload) upload.style.display = 'block';
}

async function studySubmitHomework() {
  const fileEl = document.getElementById('study_hw_file');
  const result = document.getElementById('study_hw_result');
  const name = studyStudent.name;
  if (!studyHwSession) { result.innerHTML = '<span style="color:var(--danger)">请选择课程</span>'; return; }
  if (!fileEl?.files[0]) { result.innerHTML = '<span style="color:var(--danger)">请选择文件</span>'; return; }
  const file = fileEl.files[0];
  result.innerHTML = '<span style="color:var(--text-muted)">上传中…</span>';
  try {
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `${studyMajor||'general'}/${studyHwData.date}_${Date.now()}.${ext}`;
    const fileUrl = await sbUpload('homework', path, file);
    const existing = await sb(`/rest/v1/session_records?session_id=eq.${studyHwSession}&student_name=eq.${encodeURIComponent(name)}&select=id`).catch(()=>[]);
    if (existing.length) {
      await sb(`/rest/v1/session_records?id=eq.${existing[0].id}`, 'PATCH', { homework_submitted:true, homework_file_url:fileUrl });
    } else {
      const sess = await sb(`/rest/v1/course_sessions?id=eq.${studyHwSession}&select=*`).catch(()=>[]);
      const s = sess[0] || {};
      await sb('/rest/v1/session_records', 'POST', {
        id: `r-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
        session_id: studyHwSession, course_name: s.course_name||studyHwData.name,
        session_date: studyHwData.date, student_name: name,
        major: studyMajor||s.major||'', homework_submitted:true, homework_file_url:fileUrl,
      });
    }
    result.innerHTML = '<span style="color:var(--ok)">✓ 提交成功！老师批改后可在此查看反馈。</span>';
    fileEl.value = ''; studyHwSession = null; studyHwData = {};
    await loadStudyHwSessions();
  } catch(e) { result.innerHTML = `<span style="color:var(--danger)">提交失败：${e.message}</span>`; }
}
