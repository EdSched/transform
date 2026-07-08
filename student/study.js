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
    { id:'records', label:'📋 面谈记录' },
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
  else if (schoolFilterLang === 'opt_english') displaySchools = displaySchools.filter(s => s.english_required === '任意');
  else if (schoolFilterLang === 'opt_japanese') displaySchools = displaySchools.filter(s => s.japanese_required === '任意');

  const langOrder = v => v==='不要'?0:v==='任意'?1:2;
  if (schoolSortBy === 'application_period') displaySchools.sort((a,b) => (a.application_period||'').localeCompare(b.application_period||''));
  else if (schoolSortBy === 'english_required') displaySchools.sort((a,b) => langOrder(a.english_required)-langOrder(b.english_required));
  else if (schoolSortBy === 'japanese_required') displaySchools.sort((a,b) => langOrder(a.japanese_required)-langOrder(b.japanese_required));

  // 共享学校表格HTML
  const sharedTableHtml = sharedLists.length ? `
    <div style="margin-bottom:10px">
      <div style="font-size:12px;font-weight:600;color:#2c4a7c;margin-bottom:2px">📋 ${sharedLists[0].title}</div>
      ${sharedLists[0].notes?`<div style="font-size:11px;color:#2c4a7c;opacity:.8;margin-bottom:8px">${sharedLists[0].notes}</div>`:''}
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <select onchange="schoolFilterLang=this.value;renderStudyTab()" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
          <option value="all" ${schoolFilterLang==='all'?'selected':''}>语言：全部</option>
          <option value="no_english" ${schoolFilterLang==='no_english'?'selected':''}>英语：不要</option>
          <option value="no_japanese" ${schoolFilterLang==='no_japanese'?'selected':''}>日语：不要</option>
          <option value="no_both" ${schoolFilterLang==='no_both'?'selected':''}>英日：均不要</option>
          <option value="opt_english" ${schoolFilterLang==='opt_english'?'selected':''}>英语：任意</option>
          <option value="opt_japanese" ${schoolFilterLang==='opt_japanese'?'selected':''}>日语：任意</option>
        </select>
        <select onchange="schoolSortBy=this.value;renderStudyTab()" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
          <option value="application_period" ${schoolSortBy==='application_period'?'selected':''}>按出愿期排序</option>
          <option value="japanese_required" ${schoolSortBy==='japanese_required'?'selected':''}>日语要求排序</option>
          <option value="english_required" ${schoolSortBy==='english_required'?'selected':''}>英语要求排序</option>
        </select>
      </div>
      <div style="border:1px solid #c5d9f0;border-radius:4px;overflow-x:auto">
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

  // 左右分栏布局（整体可滚动，两栏等高）
  return `<div style="display:flex;gap:16px;align-items:flex-start;overflow-x:auto;min-height:0">
    <div style="min-width:320px;flex:1">${sharedTableHtml || '<div style="font-size:11px;color:var(--text-muted)">暂无共享学校列表</div>'}</div>
    <div style="min-width:340px;flex:1">${editHtml}</div>
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
  if (allRows >= 6) {
    if (!confirm(`你已选择${allRows}所学校，超过建议上限6所。\n\n请注意：\n・确认出愿时间不冲突\n・合理分配准备时间和精力\n\n确认继续添加？`)) return;
  }
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
  const plans = rows.map(row => {
    const get = f => row.querySelector(`[data-field="${f}"]`)?.value?.trim()||'';
    const lv = parseInt(row.dataset.level||'2');
    return { id:get('id'), level:lv, school_name:get('school_name'), faculty:get('faculty'), department:get('department'), application_period:get('application_period'), exam_date:get('exam_date'), professor:get('professor'), professor_url:get('professor_url'), professor2:get('professor2'), professor2_url:get('professor2_url'), plan_requirement:get('plan_requirement'), research_theme:get('research_theme'), documents_required:get('documents_required') };
  }).filter(p => p.school_name);

  if (!plans.length) { alert('请至少填写一所学校'); return; }

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
    document.getElementById('studySchoolModal').remove();
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
