// ══════════════════════════════════
// 学习记录独立页面 study.js
// ══════════════════════════════════

const STUDY_STORAGE_KEY = 'txe_study_login';
const STUDY_DAYS = 30;

let studyStudent = null;
let studyTab = 'schools';
let studyData = { timeline:[], schoolPlans:[], planDraft:null, sharedLists:[], sharedSchools:[], bookings:[], sessionRecs:[] };
let schoolSortBy = 'application_period'; // application_period | japanese_required | english_required
let studyProgressView = 'roadmap'; // roadmap（备考规划月份表） | timeline（进度时间线）
let studySchoolListOpen = null; // 参考学校列表展开状态：null=自动（未填志望校时展开）
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
      if (Date.now() - info.ts < STUDY_DAYS * 86400000) {
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
  // 学习记录页内容绑定学生档案里的真实专业；URL 的 major 仅作后备
  const shareMajor = studyStudent.major || studyMajor;
  const [timeline, schoolPlans, planDraftArr, sharedLists, bookings, sessionRecs] = await Promise.all([
    sb(`/rest/v1/student_progress_timeline?student_id=eq.${id}&select=*&order=created_at.desc`).catch(()=>[]),
    sb(`/rest/v1/student_school_plans?student_id=eq.${id}&select=*&order=level.asc`).catch(()=>[]),
    sb(`/rest/v1/student_plan_drafts?student_id=eq.${id}&select=*&order=updated_at.desc&limit=1`).catch(()=>[]),
    sb(`/rest/v1/teacher_school_shares?major=eq.${shareMajor}&select=*&order=created_at.desc&limit=3`).catch(()=>[]),
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
    { id:'homework', label:'📝 作业' },
    { id:'schedule', label:'🗓 课程表' },
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
  ${badges?`<div class="study-badgebar" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px">${badges}</div>`:''}
  <div class="study-tabbar" style="display:flex;gap:0;border-bottom:2px solid var(--border-light);margin-bottom:18px">
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
  else if (studyTab === 'homework') { el.innerHTML = renderHomeworkTab(); setTimeout(() => loadStudyHwSessions(0), 50); }
  else if (studyTab === 'schedule') { el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">课程表加载中…</div>'; loadStudySchedule(); }
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
        <input placeholder="学校名 *" value="${escA(p.school_name)}" data-field="school_name" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="研究科" value="${escA(p.faculty)}" data-field="faculty" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="専攻/コース" value="${escA(p.department)}" data-field="department" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="出愿时间（精确）" value="${escA(p.application_period)}" data-field="application_period" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="考试日期" value="${escA(p.exam_date)}" data-field="exam_date" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="必要书类（推荐信等）" value="${escA(p.documents_required)}" data-field="documents_required" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">👤 教授（每校尽量2位）</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px">
        <input placeholder="教授1姓名" value="${escA(p.professor)}" data-field="professor" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="教授1研究内容URL" value="${escA(p.professor_url)}" data-field="professor_url" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="教授2姓名" value="${escA(p.professor2)}" data-field="professor2" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="教授2研究内容URL" value="${escA(p.professor2_url)}" data-field="professor2_url" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
        <input placeholder="计划书要求（字数/格式）" value="${escA(p.plan_requirement)}" data-field="plan_requirement" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="研究课题（目前方向）" value="${escA(p.research_theme)}" data-field="research_theme" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin:6px 0 4px">📌 该校进度</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">
        <select data-field="status" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface);flex:1;min-width:180px">
          ${Object.entries(SCHOOL_STATUS_LABELS).map(([k,v])=>`<option value="${k}" ${(p.status||'preparing')===k?'selected':''}>${v.t}</option>`).join('')}
        </select>
        ${[['kakomon_started','✏️ 过去问已开始'],['interview_draft_done','🎤 面试稿已完成']].map(([f,l])=>{
          const on = !!p[f];
          return `<span onclick="studyToggleChip(this)" data-field="${f}" data-on="${on?1:0}" style="font-size:11px;padding:4px 10px;border-radius:2px;cursor:pointer;user-select:none;border:1px solid ${on?'var(--accent)':'var(--border)'};background:${on?'var(--accent)':'var(--surface)'};color:${on?'#fff':'var(--text-secondary)'}">${l}</span>`;
        }).join('')}
      </div>
      <input type="hidden" value="${escA(p.id)}" data-field="id">
    </div>`;
  }

  const levelGroups = [
    { lv:1, label:'🔴 冲刺（挑战）', plans: schoolPlans.filter(p=>p.level===1) },
    { lv:2, label:'🟡 匹配（目标）', plans: schoolPlans.filter(p=>p.level===2) },
    { lv:3, label:'🟢 保底', plans: schoolPlans.filter(p=>p.level===3) },
  ];

  let editHtml = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
    <div style="font-size:12px;font-weight:600">我的志望校 (${schoolPlans.length}/6)</div>
    <div style="display:flex;align-items:center;gap:8px">
      <span id="ssp_save_msg" style="font-size:11px;color:var(--ok)"></span>
      <button onclick="saveStudySchoolPlans()" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:6px 16px;cursor:pointer;font-family:inherit;font-weight:500">保存</button>
    </div>
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

  // 左右分栏（宽屏并排，手机横向滑动翻页），右栏独立上下滚动
  // 已填志望校后参考列表默认收起，主视图聚焦「我的志望校」的逐校推进；可手动展开查找
  const listOpen = studySchoolListOpen === null ? schoolPlans.length === 0 : studySchoolListOpen;
  if (!listOpen) {
    return `<div>
      <div onclick="studySchoolListOpen=true;switchStudyTab('schools')" style="font-size:11px;color:var(--text-secondary);background:var(--surface);border:1px dashed var(--border);border-radius:3px;padding:8px 12px;margin-bottom:10px;cursor:pointer;user-select:none">📋 参考学校列表（已收起）— 点击展开查找学校 ▸</div>
      ${editHtml}
    </div>`;
  }
  return `<div class="study-split">
    <div>
      <div onclick="studySchoolListOpen=false;switchStudyTab('schools')" style="font-size:10px;color:var(--text-muted);text-align:right;cursor:pointer;user-select:none;margin-bottom:4px">收起列表 ◂</div>
      ${sharedTableHtml || '<div style="font-size:11px;color:var(--text-muted)">暂无共享学校列表</div>'}
    </div>
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
  // 出願期不自动带入：共享列表多为「8月上旬」类概略值，保留学生手填的精确日期
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


// 从出愿时间文本推导出愿季节（5〜9月=夏季，10〜1月=冬季，2〜4月=次年；
// 无法解析时按学生所选考试路线，再不行留空）
function studyExamSeason(period) {
  const t = String(period || '');
  let mo = null, m;
  if ((m = /(\d{4})[年\-\/\.](\d{1,2})/.exec(t))) mo = +m[2];
  else if ((m = /(?:^|[^\d])(\d{1,2})\s*月/.exec(t))) mo = +m[1];
  if (mo == null || mo < 1 || mo > 12) {
    const pm = studyStudent && studyStudent.prep_model;
    return pm === 'winter' ? 'winter' : pm === 'summer' ? 'summer' : '';
  }
  if (mo >= 5 && mo <= 9) return 'summer';
  if (mo >= 10 || mo === 1) return 'winter';
  return 'next_year';
}

async function saveStudySchoolPlans() {
  const msg = document.getElementById('ssp_save_msg');
  try {
    const rows = [...document.querySelectorAll('#studySchoolRows [data-level]')];
    if (!rows.length) { alert('页面加载中，请稍后再试'); return; }
    const plans = rows.map(row => {
      const inputs = [...row.querySelectorAll('input[data-field], select[data-field]')];
      const get = f => {
        const el = inputs.find(i => i.dataset.field === f);
        return el ? el.value.trim() : '';
      };
      const lv = parseInt(row.dataset.level||'2');
      const chip = f => { const el = row.querySelector(`span[data-field="${f}"]`); return el ? el.dataset.on === '1' : false; };
      return { id:get('id'), level:lv, status:get('status')||'preparing', kakomon_started:chip('kakomon_started'), interview_draft_done:chip('interview_draft_done'), school_name:get('school_name'), faculty:get('faculty'), department:get('department'), application_period:get('application_period'), exam_date:get('exam_date'), professor:get('professor'), professor_url:get('professor_url'), professor2:get('professor2'), professor2_url:get('professor2_url'), plan_requirement:get('plan_requirement'), research_theme:get('research_theme'), documents_required:get('documents_required') };
    }).filter(p => p.school_name);

    if (!plans.length) { alert('请至少填写一所学校的学校名'); return; }

    if (msg) msg.textContent = '保存中…';
    await sb(`/rest/v1/student_school_plans?student_id=eq.${studyStudent.id}`, 'DELETE');
    const toInsert = plans.map((p, i) => ({
      id: p.id || `ssp-${Date.now()}-${i}-${Math.random().toString(36).slice(2,6)}`,
      student_id: studyStudent.id, student_name: studyStudent.name, major: studyStudent.major,
      school_name:p.school_name, faculty:p.faculty, department:p.department,
      professor:p.professor, professor_url:p.professor_url,
      professor2:p.professor2, professor2_url:p.professor2_url,
      application_period:p.application_period, exam_date:p.exam_date,
      exam_season: studyExamSeason(p.application_period),
      plan_requirement:p.plan_requirement, research_theme:p.research_theme,
      documents_required:p.documents_required,
      level:p.level, status:p.status || 'preparing',
      kakomon_started:!!p.kakomon_started, interview_draft_done:!!p.interview_draft_done,
    }));
    await sb('/rest/v1/student_school_plans', 'POST', toInsert);
    studyData.schoolPlans = toInsert;
    switchStudyTab('schools');
    const m2 = document.getElementById('ssp_save_msg');
    if (m2) { m2.textContent = '✓ 已保存'; setTimeout(()=>{ if (m2.textContent === '✓ 已保存') m2.textContent = ''; }, 2500); }
  } catch(e) { if (msg) msg.textContent = ''; alert('保存失败：' + e.message); }
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
// 计划书：按专业区分的配置
// ══════════════════════════════════

// HTML 属性/文本转义
function escA(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// 专业分类：优先用学生档案里的真实专业，其次页面 URL 的 major 参数
function studyPlanCat() {
  const m = (studyStudent && studyStudent.major) || studyMajor || '';
  if (m === 'keiei') return 'keiei';
  if (m === 'keizai') return 'keizai';
  if (m === 'shakai_group' || (typeof SHAKAI_GROUP !== 'undefined' && SHAKAI_GROUP.includes(m))) return 'shakai';
  return 'generic';
}

// 先行研究整理字段（经营/经济一套，社会人文一套，其余保持原有字段）
const STUDY_REF_FIELDS = {
  biz: [
    { k:'keyword',    label:'先行研究分類（キーワード）' },
    { k:'title',      label:'タイトル' },
    { k:'author',     label:'著者' },
    { k:'year',       label:'年' },
    { k:'data',       label:'研究対象／分析に使用するデータ' },
    { k:'method',     label:'研究方法／モデル／分析手法' },
    { k:'conclusion', label:'得られた結論' },
    { k:'note',       label:'備考（自分との研究の関連、この研究の問題点など）' },
  ],
  shakai: [
    { k:'keyword',    label:'研究分野（キーワード）' },
    { k:'title',      label:'テーマ' },
    { k:'author',     label:'著者' },
    { k:'year',       label:'年' },
    { k:'journal',    label:'刊行物' },
    { k:'summary',    label:'概要' },
    { k:'awareness',  label:'問題意識' },
    { k:'conclusion', label:'結論' },
    { k:'method',     label:'研究方法・データの収集' },
    { k:'citation',   label:'引用' },
    { k:'evaluation', label:'評価' },
  ],
  generic: [
    { k:'author',  label:'作者名' },
    { k:'year',    label:'发表年份' },
    { k:'title',   label:'文献题目' },
    { k:'journal', label:'期刊/出版社' },
    { k:'note',    label:'与研究的关联' },
  ],
};

function studyRefFields() {
  const cat = studyPlanCat();
  if (cat === 'keiei' || cat === 'keizai') return STUDY_REF_FIELDS.biz;
  if (cat === 'shakai') return STUDY_REF_FIELDS.shakai;
  return STUDY_REF_FIELDS.generic;
}

// 计划书草稿模板（按专业；generic 为 null 时沿用原有三个文本框）
const STUDY_DRAFT_FIELDS = {
  keizai: [
    { k:'theme',       label:'研究テーマ', type:'input' },
    { k:'field',       label:'志望分野（複数選択可，点击选中/取消）', type:'chips', options:['労働','教育','開発','都市','医療','環境','産業','公共','政治','国際'] },
    { k:'data_source', label:'データ出処', type:'input' },
    { k:'data_type',   label:'データ種類', type:'select', options:['横断面データ','パネルデータ'] },
    { k:'prior_lit',   label:'先行文献', type:'textarea', rows:2 },
    { k:'hypothesis',  label:'仮説', type:'textarea', rows:2 },
    { k:'difference',  label:'先行研究との違い', type:'textarea', rows:2 },
    { k:'var_y',       label:'被説明変数Y', type:'input' },
    { k:'var_x',       label:'説明変数X', type:'input' },
    { k:'var_ctrl',    label:'その他コントロール変数', type:'input' },
    { k:'model',       label:'モデル', type:'select', options:['固定効果モデル','RDモデル','重回帰モデル','操作変数法'] },
    { k:'model_other', label:'その他', type:'input' },
    { k:'regression',  label:'回帰式（添字までしっかり書くこと、添字の説明も）', type:'textarea', rows:2 },
  ],
  keiei: [
    { k:'theme',       label:'研究テーマ', type:'input' },
    { k:'field',       label:'志望分野', type:'select', options:['企業戦略','企業組織','マーケティング'] },
    { k:'data_source', label:'データ出処', type:'input' },
    { k:'prior_lit',   label:'先行文献', type:'textarea', rows:2 },
    { k:'hypothesis',  label:'仮説', type:'textarea', rows:2 },
    { k:'difference',  label:'先行研究との違い', type:'textarea', rows:2 },
    { k:'var_y',       label:'被説明変数Y', type:'input' },
    { k:'var_x',       label:'説明変数X', type:'input' },
    { k:'var_ctrl',    label:'その他コントロール変数', type:'input' },
    { k:'regression',  label:'回帰式（添字までしっかり書くこと、添字の説明も）', type:'textarea', rows:2 },
  ],
  shakai: [
    { k:'theme', label:'研究テーマ', type:'input' },
    { k:'background', label:'一、研究背景', type:'textarea', rows:4, hint:'１、現在、自分の研究対象の現状について、どのような変化があるか？\n２、特に、研究対象や背景について、何か特徴を持っているのか？\n３、問題提起（問題意識）：その現状について、あなたはどう思う？さらに、何を知りたく？明らかにしたいか？\n４、その問題提起は如何に重要なのか？' },
    { k:'prior', label:'二、先行研究', type:'textarea', rows:3, hint:'１、現時点で、他の研究者はあなたが関心をもつ問題について、何を中心に研究を行ったか？\n２、他の研究者の研究の欠点とあなたの疑問点。（また分からないところは何か？）' },
    { k:'purpose', label:'三、研究目的', type:'textarea', rows:3, hint:'１、先行研究を踏まえて、一体何を明らかにしたい？\n２、もしそのことを明らかにすれば、何が分かるか？' },
    { k:'method', label:'四、研究方法', type:'textarea', rows:4, hint:'１、なぜその地域を選んだのか？\n２、どのような調査を行いたい？\n３、具体的な方法は何か？（調査対象／手順／準備調査／調査実行）\n４、予想できる困難があるか？' },
    { k:'significance', label:'五、研究意義', type:'textarea', rows:3, hint:'１、自分の研究はどうのように位置づけられる？\n２、自分の研究はどのような価値がある？（個人的、社会的、学術的を分けて述べてみよう）' },
  ],
};

// 单个草稿字段渲染
function studyDraftFieldHtml(f, df) {
  const v = df[f.k];
  const base = 'width:100%;font-size:12px;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  let ctrl = '';
  if (f.type === 'chips') {
    const sel = Array.isArray(v) ? v : (v ? [v] : []);
    ctrl = `<div id="spd_f_${f.k}" style="display:flex;flex-wrap:wrap;gap:5px">` + f.options.map((o, i) => {
      const on = sel.includes(o);
      return `<span onclick="studyToggleChip(this)" data-val="${escA(o)}" data-on="${on?1:0}" style="font-size:11px;padding:3px 10px;border-radius:2px;cursor:pointer;user-select:none;border:1px solid ${on?'var(--accent)':'var(--border)'};background:${on?'var(--accent)':'var(--surface)'};color:${on?'#fff':'var(--text-secondary)'}">${i+1}. ${o}</span>`;
    }).join('') + `</div>`;
  } else if (f.type === 'select') {
    ctrl = `<select id="spd_f_${f.k}" style="${base}"><option value="">— 選択 —</option>${f.options.map(o => `<option value="${escA(o)}" ${v===o?'selected':''}>${o}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    ctrl = `<textarea id="spd_f_${f.k}" rows="${f.rows||2}" style="${base};resize:vertical">${escA(v||'')}</textarea>`;
  } else {
    ctrl = `<input id="spd_f_${f.k}" value="${escA(v||'')}" style="${base}">`;
  }
  return `<div class="${(f.type==='textarea'||f.type==='chips')?'sc-full':''}" style="margin-bottom:10px">
    <label style="font-size:10px;color:var(--text-secondary);font-weight:600;display:block;margin-bottom:3px">${f.label}</label>
    ${f.hint?`<div style="font-size:10px;color:var(--text-secondary);white-space:pre-line;line-height:1.7;margin-bottom:4px">${f.hint}</div>`:''}
    ${ctrl}
  </div>`;
}

function studyToggleChip(el) {
  const on = el.dataset.on === '1';
  el.dataset.on = on ? '0' : '1';
  el.style.border = '1px solid ' + (on ? 'var(--border)' : 'var(--accent)');
  el.style.background = on ? 'var(--surface)' : 'var(--accent)';
  el.style.color = on ? 'var(--text-secondary)' : '#fff';
}

// ══════════════════════════════════
// 计划书 Tab（三步骤）
// ══════════════════════════════════

function renderPlanTab() {
  const d = studyData.planDraft || {};
  let refs = [];
  try { refs = d.prior_research_list ? JSON.parse(d.prior_research_list) : []; } catch(e) {}
  const refFields = studyRefFields();
  const cat = studyPlanCat();
  let df = {};
  try { df = d.draft_fields ? JSON.parse(d.draft_fields) : {}; } catch(e) {}
  const draftDefs = STUDY_DRAFT_FIELDS[cat] || null;

  return `<div>
    <!-- 步骤1：先行研究 -->
    <div style="margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid var(--border-light)">
        Step 1 · 先行研究整理
      </div>

      <!-- 添加文献 -->
      <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px;margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">按以下格式添加已读文献：</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:6px;margin-bottom:8px">
          ${refFields.map(f => `<input id="ref_f_${f.k}" placeholder="${escA(f.label)}" style="font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg)">`).join('')}
        </div>
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
        <div style="border:1px solid var(--border-light);border-radius:3px;overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:var(--bg)">
              ${refFields.map(f => `<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border-light)">${f.label}</th>`).join('')}
              <th style="padding:4px;border-bottom:1px solid var(--border-light)"></th>
            </tr></thead>
            <tbody>
              ${refs.map((r,i) => `<tr style="border-bottom:1px solid var(--border-light);background:${i%2===0?'var(--surface)':'var(--bg)'}">
                ${refFields.map(f => `<td style="padding:7px 8px;font-size:10px">${escA(r[f.k]||'')}</td>`).join('')}
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
        <div class="study-cols2">
        ${draftDefs ? draftDefs.map(f => studyDraftFieldHtml(f, df)).join('') : `
        <div class="sc-full" style="margin-bottom:10px">
          <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">问题意识（你的研究问题是什么？）</label>
          <textarea id="spd_q" rows="3" style="width:100%;font-size:12px;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${escA(d.research_question||'')}</textarea>
        </div>
        <div class="sc-full" style="margin-bottom:10px">
          <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">研究方法</label>
          <textarea id="spd_m" rows="2" style="width:100%;font-size:12px;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${escA(d.methodology||'')}</textarea>
        </div>`}
        </div>
        <div style="margin-bottom:10px">
          <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">草稿进展说明（进展情况、遇到的问题等）</label>
          <textarea id="spd_dn" rows="2" style="width:100%;font-size:12px;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${escA(d.draft_notes||'')}</textarea>
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
  const fields = studyRefFields();
  const ref = {};
  fields.forEach(f => { const el = document.getElementById('ref_f_' + f.k); ref[f.k] = el ? el.value.trim() : ''; });
  if (!ref.author && !ref.title) { alert('请至少填写著者或题目'); return; }
  const d = studyData.planDraft || {};
  let refs = [];
  try { refs = d.prior_research_list ? JSON.parse(d.prior_research_list) : []; } catch(e) {}
  refs.push(ref);
  await studySavePlanField({ prior_research_list: JSON.stringify(refs) });
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
  const dn = document.getElementById('spd_dn')?.value.trim() || '';
  const msg = document.getElementById('spd_save_msg');
  if (msg) msg.textContent = '保存中…';
  const cat = studyPlanCat();
  const defs = STUDY_DRAFT_FIELDS[cat] || null;
  const payload = { draft_notes: dn };
  if (defs) {
    const df = {};
    defs.forEach(f => {
      if (f.type === 'chips') {
        df[f.k] = [...document.querySelectorAll(`#spd_f_${f.k} [data-on="1"]`)].map(el => el.dataset.val);
      } else {
        const el = document.getElementById(`spd_f_${f.k}`);
        df[f.k] = el ? el.value.trim() : '';
      }
    });
    payload.draft_fields = JSON.stringify(df);
  } else {
    payload.research_question = document.getElementById('spd_q')?.value.trim() || '';
    payload.methodology = document.getElementById('spd_m')?.value.trim() || '';
  }
  await studySavePlanField(payload);
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
// ── 备考规划：考试周期模型 ──
// 修士考试每年两轮：夏季（7月出愿・8月考试）、冬季（12月出愿・次年1月考试）。
// 各节点相对考试月 E 偏移固定：E-3 完成计划书草稿（最晚）、E-2 针对教授修改・参加说明会、
// E-1 出愿・过去问刷题、E 面试稿・考试、E+1〜E+2 等待结果・合格发表。
// 夏季对应 5/6/7/8 月，冬季对应 10/11/12/1 月，与通年进度安排一致。
const STUDY_PREP_MODELS = {
  summer: { label:'夏季考试路线（7月出愿・8月考试）', examMonth: 8 },
  winter: { label:'冬季考试路线（12月出愿・次年1月考试）', examMonth: 1 },
  next_summer: { label:'次年夏季路线（先打基础・次年7月出愿8月考试）', examMonth: 8, skipOne: true },
};

// 七个项目（与通年进度表一致）：月度节点（相对考试月E的偏移 → 内容）；red 中的偏移红底强调
// dl = 最晚节点偏移，dlName = 节点名称（用于倒计时文案）
const STUDY_ROADMAP_ROWS = [
  { key:'japanese', icon:'🈴', label:'日语', dl:-1, dlName:'成绩送分最晚',
    ms:{ '-2':'EJU 考试', '-1':'JLPT 考试・成绩送分', '0':'日语成绩确定' },
    ms2:{ '-9':'EJU 考试', '-8':'JLPT 考试（按冬季）', '-7':'日语成绩确定' }, dl2:-7, dlName2:'成绩确定最晚（按冬季要求）' },
  { key:'english', icon:'🔤', label:'英语', dl:-1, dlName:'成绩送分最晚',
    ms:{ '-3':'托福考试', '-2':'托业考试', '-1':'英语送分' },
    ms2:{ '-9':'托福考试', '-8':'托业考试（按冬季）', '-7':'英语成绩确定' }, dl2:-7, dlName2:'成绩确定最晚（按冬季要求）' },
  { key:'plan', icon:'📄', label:'研究计划书', dl:-3, dlName:'草稿完成最晚',
    ms:{ '-4':'问题意识・先行研究', '-3':'完成草稿（最晚）', '-2':'zemi 发表・针对教授修改', '-1':'针对出愿学校修改' },
    ms2:{ '-10':'问题意识・先行研究', '-8':'完成草稿（最晚12月）', '-6':'反复修改・zemi 发表', '-1':'针对出愿学校修改' }, dl2:-8, dlName2:'草稿完成最晚（提前至12月）' },
  { key:'school', icon:'🏫', label:'择校相关', dl:-2, dlName:'锁定教授最晚',
    ms:{ '-4':'完成初版出愿 list', '-3':'锁定教授', '-2':'针对教授修改计划书' },
    ms2:{ '-7':'完成初版出愿 list', '-3':'锁定教授', '-2':'针对教授修改计划书' }, dl2:-3 },
  { key:'apply', icon:'📮', label:'出愿相关', dl:-1, dlName:'出愿',
    ms:{ '-4':'准备相关证明', '-3':'联系教授', '-2':'参加说明会', '-1':'出愿' }, red:['-1'] },
  { key:'kakomon', icon:'✏️', label:'过去问备考', dl:0, dlName:'面试稿完成最晚',
    ms:{ '-3':'阅读教授论文', '-2':'笔试练习开始', '-1':'过去问刷题', '0':'面试稿・面试训练' } },
  { key:'exam', icon:'🎓', label:'大学院考试', dl:0, dlName:'考试',
    ms:{ '0':'考试期间', '1':'等待结果', '2':'合格发表' }, red:['0'] },
];

function studyPrepModelKey() {
  if (STUDY_PREP_MODELS[studyStudent && studyStudent.prep_model]) return studyStudent.prep_model;
  // 未手动选择时：按面谈预约里填写的出愿时期推导（夏季/冬季/次年）
  const bs = (studyData && studyData.bookings) || [];
  for (const b of bs) {
    if (b.exam_period === '次年出愿') return 'next_summer';
    if (b.exam_period === '冬季出愿') return 'winter';
    if (b.exam_period === '夏季出愿') return 'summer';
  }
  return 'summer';
}

async function studySetPrepModel(v) {
  if (!STUDY_PREP_MODELS[v]) return;
  studyStudent.prep_model = v;
  renderStudyTab();
  try { await sb(`/rest/v1/students?id=eq.${studyStudent.id}`, 'PATCH', { prep_model: v }); } catch(e) {}
}

// 解析 "26年4月" / "2026年4月" / "2026-04" → 月序号
function studyParseYm(str) {
  let m = /(\d{2,4})\s*年\s*(\d{1,2})\s*月/.exec(str || '');
  if (!m) m = /(\d{4})[\-\/\.](\d{1,2})/.exec(str || '');
  if (!m) return null;
  let y = +m[1]; if (y < 100) y += 2000;
  const mo = +m[2];
  return (mo >= 1 && mo <= 12) ? y * 12 + mo - 1 : null;
}

function buildStudyRoadmap() {
  const s = studyStudent;
  const latest = getLatestProgress(studyData.timeline);
  const plans = studyData.schoolPlans || [];
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const ymStr = i => `${Math.floor(i/12)}年${i%12+1}月`;

  // 在学期间：报名时间 signup_date（缺失时退回档案创建 created_at）〜到期 expiry_date
  // 到期缺失时按开始+11个月；两者都缺失时按本学年4月起显示12个月
  let ws = studyParseYm(s.signup_date);
  if (ws == null) ws = studyParseYm(s.contract_start);
  if (ws == null) ws = studyParseYm(s.created_at);
  let we = studyParseYm(s.expiry_date);
  if (we == null) we = studyParseYm(s.contract_end);
  const contractKnown = ws != null || we != null;
  if (ws == null && we != null) ws = we - 11;
  if (ws == null) { const y = now.getFullYear(), m = now.getMonth() + 1; ws = (m >= 4 ? y : y - 1) * 12 + 3; }
  if (we == null || we < ws) we = ws + 11;
  const total = we - ws + 1;
  // 显示窗口：超过14个月的合同期截取当前周期附近
  let dispS = ws, dispE = we;
  if (total > 14) { dispS = Math.max(ws, Math.min(nowIdx - 2, we - 13)); dispE = Math.min(we, dispS + 13); }

  // 当前考试周期：所选路线下一次考试月
  const modelKey = studyPrepModelKey();
  const model = STUDY_PREP_MODELS[modelKey];
  const nextExamIdx = examMonth => { let e = now.getFullYear() * 12 + (examMonth - 1); while (e < nowIdx) e += 12; return e; };
  let examIdx = nextExamIdx(model.examMonth);
  if (model.skipOne) examIdx += 12; // 次年路线：跳过最近一轮
  const otherKey = modelKey === 'winter' ? 'summer' : 'winter';
  const altExamIdx = nextExamIdx(STUDY_PREP_MODELS[otherKey].examMonth);

  // 各项目状态与当前进度文字（来自进度记录/计划书/志望校/学生档案）
  const jp = latest.japanese || '', en = latest.english || '', plan = latest.plan || '', apply = latest.apply || '', exam = latest.exam || '';
  const isDone = (k, v) => typeof PROGRESS_DONE !== 'undefined' && (PROGRESS_DONE[k] || []).includes(v);
  let refsCount = 0;
  try { refsCount = studyData.planDraft && studyData.planDraft.prior_research_list ? JSON.parse(studyData.planDraft.prior_research_list).length : 0; } catch(e) {}
  // 逐校推进与计划书填写实况（与考学进度卡片同一套推导，保证两处一致）
  const dObj = studyData.planDraft || {};
  const draftUploaded = !!dObj.draft_file_url;
  let draftFilled = false;
  try {
    const df1 = dObj.draft_fields ? JSON.parse(dObj.draft_fields) : {};
    draftFilled = Object.values(df1).some(v => Array.isArray(v) ? v.length : String(v || '').trim());
  } catch(e) {}
  if (!draftFilled) draftFilled = ['research_question','methodology','draft_notes'].some(f => String(dObj[f] || '').trim());
  const profOkN = plans.filter(p => ['prof_ok','applied','passed'].includes(p.status)).length;
  const contactedN = plans.filter(p => p.status === 'contacted').length;
  const appliedN = plans.filter(p => ['applied','passed'].includes(p.status)).length;
  const passedN = plans.filter(p => p.status === 'passed').length;
  const kakomonN = plans.filter(p => p.kakomon_started).length;
  const interviewN = plans.filter(p => p.interview_draft_done).length;
  const stateOf = {
    japanese: { done: isDone('japanese', jp), active: !!jp, cur: [jp || '未填写', s.japanese_score || ''].filter(Boolean).join(' · ') },
    english:  { done: isDone('english', en), active: !!en, cur: [en || '未填写', s.english_score || ''].filter(Boolean).join(' · ') },
    plan:     { done: plan === '已完成' || draftUploaded,
                active: ['收集资料中','在收集材料','撰写中','修改中'].includes(plan) || draftFilled || refsCount > 0,
                cur: [plan || (draftUploaded ? '已完成' : draftFilled ? '撰写中' : refsCount ? '在收集材料' : '未填写'), refsCount ? `文献 ${refsCount} 条` : '', draftUploaded ? '📎 完成稿已上传' : ''].filter(Boolean).join(' · ') },
    school:   { done: profOkN > 0, active: plans.length > 0 || ['择校确认中','联系教授中'].includes(apply),
                cur: (plans.length ? `已选 ${plans.length}/6 校` : '未选校') + (contactedN ? ` · 已发邮件 ${contactedN} 校` : '') + (profOkN ? ` · 教授OK ${profOkN} 校` : '') },
    apply:    { done: appliedN > 0 || ['已出愿','已合格'].includes(apply), active: ['联系教授中','材料准备中'].includes(apply) || contactedN > 0,
                cur: appliedN ? `已出愿 ${appliedN} 校` : (apply || '未开始') },
    kakomon:  { done: isDone('exam', exam), active: !!exam || kakomonN > 0 || interviewN > 0,
                cur: [(kakomonN ? `过去问已开始 ${kakomonN} 校` : ''), (interviewN ? `面试稿完成 ${interviewN} 校` : ''), exam || ''].filter(Boolean).join(' · ') || '未开始' },
    exam:     { done: passedN > 0 || apply === '已合格', active: appliedN > 0 || apply === '已出愿',
                cur: passedN ? `合格 ${passedN} 校 🎉` : apply === '已合格' ? '已合格' : appliedN ? `已出愿 ${appliedN} 校・待考试` : '—' },
  };

  // 倒计时与判定：提前完成→鼓励；剩1个月/本月→紧急提醒；超期→红色标注
  const useAlt = !!model.skipOne;
  const rows = STUDY_ROADMAP_ROWS.map(r0 => {
    const r = Object.assign({}, r0, useAlt ? {
      ms: r0.ms2 || r0.ms,
      dl: (r0.dl2 != null ? r0.dl2 : r0.dl),
      dlName: r0.dlName2 || r0.dlName,
    } : {});
    const st = stateOf[r.key];
    const dlIdx = examIdx + r.dl;
    const left = dlIdx - nowIdx;
    let vt, vc;
    if (st.done) {
      vt = r.key === 'exam' ? '🎉 已合格，恭喜！' : left > 0 ? '✓ 已完成，进度领先，继续保持！' : '✓ 已完成';
      vc = 'var(--success)';
    }
    else if (left > 1)   { vt = `距${r.dlName}（${ymStr(dlIdx)}）还剩 ${left} 个月`; vc = st.active ? 'var(--success)' : 'var(--text-secondary)'; }
    else if (left === 1) { vt = `⚠ 距${r.dlName}仅剩 1 个月，请抓紧`; vc = 'var(--warning)'; }
    else if (left === 0) { vt = `⚠ ${r.dlName}就在本月！`; vc = 'var(--danger)'; }
    else                 { vt = `✗ 已超${r.dlName} ${-left} 个月`; vc = 'var(--danger)'; }
    return Object.assign({}, r, { dlIdx, left, status: st.done ? 'done' : st.active ? 'active' : 'todo', cur: st.cur, vt, vc });
  });

  // 面谈分布（每月次数）
  const meetDots = {};
  (studyData.bookings || []).filter(b => b.status !== 'cancelled' && b.slot_date).forEach(b => {
    const m2 = /^(\d{4})-(\d{2})/.exec(b.slot_date); if (!m2) return;
    const i = (+m2[1]) * 12 + (+m2[2]) - 1; if (i >= dispS && i <= dispE) meetDots[i] = (meetDots[i] || 0) + 1;
  });

  // 错过本轮时推荐更近的考试时间点
  let banner = '';
  if (altExamIdx < examIdx) {
    banner = `💡 距离所选路线的下一次考试（${ymStr(examIdx)}）还有 ${examIdx - nowIdx} 个月；更近的考试机会是${STUDY_PREP_MODELS[otherKey].label}——${ymStr(altExamIdx - 1)}出愿・${ymStr(altExamIdx)}考试。如需转换请在右上角切换路线。`;
  }

  return { ws, we, total, contractKnown, dispS, dispE, nowIdx, examIdx, rows, meetDots, ymStr, modelKey, banner };
}

function renderStudyRoadmap() {
  const R = buildStudyRoadmap();
  const months = []; for (let i = R.dispS; i <= R.dispE; i++) months.push(i);

  const headCells = months.map(i => {
    const y = Math.floor(i/12), m = i%12+1;
    const isNow = i === R.nowIdx;
    const yearMark = (i === R.dispS || m === 1) ? `<div style="font-size:8px;color:var(--text-muted)">'${String(y).slice(2)}</div>` : '<div style="font-size:8px">&nbsp;</div>';
    return `<th style="padding:4px 3px;text-align:center;font-weight:${isNow?'700':'600'};color:${isNow?'var(--accent)':'var(--text-secondary)'};border-bottom:1px solid var(--border-light);border-left:1px solid var(--border-light);${isNow?'background:var(--accent-light)':''}">${yearMark}${m}月${isNow?'<div style="font-size:8px">本月</div>':''}</th>`;
  }).join('');

  const bodyRows = R.rows.map(r => {
    const cells = months.map(i => {
      const isNow = i === R.nowIdx;
      const off = String(i - R.examIdx);
      const text = r.ms[off] || '';
      const isRed = text && (r.red || []).includes(off);
      const cell = text
        ? (isRed
          ? `<div style="margin:3px 2px;padding:4px 3px;border-radius:2px;background:var(--danger);color:#fff;font-weight:700;font-size:9px;text-align:center;line-height:1.4">${text}</div>`
          : `<div style="margin:3px 2px;padding:4px 3px;border-radius:2px;background:var(--bg);border:1px solid var(--border-light);font-size:9px;text-align:center;line-height:1.4;color:var(--text-primary)">${text}</div>`)
        : '';
      return `<td style="padding:0;vertical-align:middle;border-bottom:1px solid var(--border-light);border-left:1px solid var(--border-light);${isNow?'background:var(--accent-light)':''}">${cell}</td>`;
    }).join('');
    return `<tr>
      <td style="padding:6px 8px;white-space:nowrap;border-bottom:1px solid var(--border-light)">
        <div style="font-size:11px;color:var(--text-primary);font-weight:600">${r.icon} ${r.label}</div>
        <div style="font-size:9px;color:${r.vc};margin-top:1px">${r.vt}</div>
        <div style="font-size:9px;color:var(--text-secondary);margin-top:1px">当前：${r.cur}</div>
      </td>${cells}</tr>`;
  }).join('');

  const meetCells = months.map(i => {
    const n = R.meetDots[i] || 0;
    const isNow = i === R.nowIdx;
    return `<td style="padding:4px 0;text-align:center;font-size:10px;color:var(--accent);border-left:1px solid var(--border-light);${isNow?'background:var(--accent-light)':''}">${n ? '●' + (n>1?'×'+n:'') : ''}</td>`;
  }).join('');

  const bmRows = R.rows.map(r => `<tr>
    <td style="padding:6px 8px;white-space:nowrap;font-size:10px;border-bottom:1px solid var(--border-light)">${r.icon} ${r.label}</td>
    <td style="padding:6px 8px;white-space:nowrap;font-size:10px;color:var(--text-secondary);border-bottom:1px solid var(--border-light)">${r.dlName} · ${R.ymStr(r.dlIdx)}</td>
    <td style="padding:6px 8px;font-size:10px;border-bottom:1px solid var(--border-light)">${r.cur}</td>
    <td style="padding:6px 8px;font-size:10px;color:${r.vc};border-bottom:1px solid var(--border-light)">${r.vt}</td>
  </tr>`).join('');

  const stayed = Math.min(Math.max(R.nowIdx - R.ws + 1, 0), R.total);
  return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:600">📅 备考规划　<span style="font-weight:400;color:var(--text-secondary)">在学期间：${R.ymStr(R.ws)} 〜 ${R.ymStr(R.we)}（共 ${R.total} 个月・已在学 ${stayed} 个月）</span></div>
      <label style="font-size:10px;color:var(--text-secondary)">考试路线：<select onchange="studySetPrepModel(this.value)" style="font-size:10px;padding:2px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface);width:auto">
        ${Object.entries(STUDY_PREP_MODELS).map(([k,m]) => `<option value="${k}" ${R.modelKey===k?'selected':''}>${m.label}</option>`).join('')}
      </select></label>
    </div>
    ${R.contractKnown ? '' : '<div style="font-size:10px;color:var(--warning);margin-bottom:6px">⚠ 档案中未登记到期时间，暂按本学年（4月起）显示。请联系老师在学生档案中填写「到期时间」。</div>'}
    ${R.banner ? `<div style="font-size:10px;color:var(--text-primary);background:var(--accent-light);border:1px solid var(--border-light);border-radius:3px;padding:7px 10px;margin-bottom:8px">${R.banner}</div>` : ''}
    ${R.total > (R.dispE - R.dispS + 1) ? `<div style="font-size:9px;color:var(--text-secondary);margin-bottom:6px">合同期较长，当前显示 ${R.ymStr(R.dispS)} 〜 ${R.ymStr(R.dispE)}</div>` : ''}
    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;width:100%;min-width:${160 + months.length * 62}px;font-size:10px">
        <thead><tr><th style="padding:4px 8px;text-align:left;font-weight:600;color:var(--text-secondary);border-bottom:1px solid var(--border-light);min-width:150px">项目</th>${headCells}</tr></thead>
        <tbody>${bodyRows}
          <tr><td style="padding:5px 8px;white-space:nowrap;font-size:11px;color:var(--text-primary)">💬 面谈记录</td>${meetCells}</tr>
        </tbody>
      </table>
    </div>
    <div style="font-size:11px;font-weight:600;margin:12px 0 6px">节点对标（${STUDY_PREP_MODELS[R.modelKey].label}）</div>
    <div style="overflow-x:auto;border:1px solid var(--border-light);border-radius:3px">
      <table style="border-collapse:collapse;width:100%;min-width:560px">
        <thead><tr style="background:var(--bg)">
          ${['项目','最晚节点','当前进度','判定'].map(h => `<th style="padding:5px 8px;text-align:left;font-size:10px;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border-light)">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${bmRows}</tbody>
      </table>
    </div>
    <div style="font-size:9px;color:var(--text-secondary);margin-top:6px">节点按所选考试路线自动排布（夏季：5月草稿・7月出愿・8月考试；冬季：10月草稿・12月出愿・1月考试；次年夏季：语言按冬季要求、12月完成草稿、次年7月出愿8月考试）。未手动选择时按面谈填写的出愿时期自动判断。红底为关键节点；各项目状态由进度记录、计划书、志望校与面谈数据自动汇总。</div>
  </div>`;
}
function renderProgressTab() {
  const { timeline } = studyData;
  const s = studyStudent;
  const latest = getLatestProgress(timeline);

  // 志望校流水线细节：填充进计划书/出愿/备考三张卡
  const plansL = studyData.schoolPlans || [];
  let refsN = 0, draftN = 0;
  try {
    const d0 = studyData.planDraft || {};
    refsN = d0.prior_research_list ? JSON.parse(d0.prior_research_list).length : 0;
    const df0 = d0.draft_fields ? JSON.parse(d0.draft_fields) : {};
    draftN = Object.values(df0).filter(v => Array.isArray(v) ? v.length : String(v || '').trim()).length;
  } catch(e) {}
  // 时间线没有记录时，从志望校推进/计划书数据自动推导徽章（避免明明已推进却显示「未填写」）
  const derived = {};
  if (plansL.some(p => p.status === 'passed')) derived.apply = '已合格';
  else if (plansL.some(p => ['applied'].includes(p.status))) derived.apply = '已出愿';
  else if (plansL.some(p => ['prof_ok','contacted'].includes(p.status))) derived.apply = '联系教授中';
  else if (plansL.length) derived.apply = '择校确认中';
  if (plansL.some(p => p.interview_draft_done)) derived.exam = '在准备面试稿';
  else if (plansL.some(p => p.kakomon_started)) derived.exam = '在写过去问';
  const d0f = studyData.planDraft || {};
  const legacyFilled = ['research_question','methodology','draft_notes'].some(f => String(d0f[f] || '').trim());
  if (d0f.draft_file_url) derived.plan = '已完成';
  else if (draftN > 0 || legacyFilled) derived.plan = '撰写中';
  else if (refsN > 0) derived.plan = '在收集材料';

  const cardDetail = k => {
    if (k === 'plan') {
      const parts = [];
      if (refsN) parts.push(`📚 先行研究已整理 ${refsN} 条`);
      if (draftN) parts.push(`草稿已填 ${draftN} 项`);
      if ((studyData.planDraft || {}).draft_file_url) parts.push('📎 完成稿已上传');
      return parts.length ? `<div style="font-size:10px;color:var(--text-secondary);margin-top:4px;line-height:1.7">${parts.join(' · ')}</div>` : '';
    }
    if (k === 'apply') {
      if (!plansL.length) return '';
      return `<div style="margin-top:4px">${plansL.map(p => {
        const st = schoolStatusLabel(p.status);
        return `<div style="font-size:10px;line-height:1.7"><span style="color:var(--text-secondary)">${escA(p.school_name)}${p.professor ? ' · ' + escA(p.professor) : ''}</span> — <span style="color:${st.c}">${st.t}</span></div>`;
      }).join('')}</div>`;
    }
    if (k === 'exam') {
      const rel = plansL.filter(p => ['prof_ok','applied','passed'].includes(p.status));
      if (!rel.length) return '';
      return `<div style="margin-top:4px">${rel.map(p =>
        `<div style="font-size:10px;line-height:1.7;color:var(--text-secondary)">${escA(p.school_name)}：过去问 ${p.kakomon_started ? '<span style="color:var(--success)">✓ 已开始</span>' : '—'} · 面试稿 ${p.interview_draft_done ? '<span style="color:var(--success)">✓ 已完成</span>' : '—'}</div>`
      ).join('')}</div>`;
    }
    return '';
  };

  let html = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:16px">
    ${Object.entries(PROGRESS_LABELS).map(([k,label]) => {
      const val = latest[k];
      const score = k==='japanese'&&s.japanese_score?s.japanese_score:k==='english'&&s.english_score?s.english_score:'';
      return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:5px">${PROGRESS_ICONS[k]} ${label}</div>
        ${val?renderProgressBadge(k,val):derived[k]?renderProgressBadge(k,derived[k])+`<span style="font-size:9px;color:var(--text-muted);margin-left:4px">按填写自动判断</span>`:`<span style="font-size:11px;color:var(--text-muted)">未填写</span>`}
        ${score?`<div style="font-size:11px;color:var(--text-secondary);margin-top:4px">${score}</div>`:''}
        ${cardDetail(k)}
      </div>`;
    }).join('')}
  </div>`;

  // 视图切换：备考规划（月份表） / 进度时间线
  html += `<div style="display:flex;gap:6px;margin-bottom:12px">
    ${[['roadmap','📅 备考规划'],['timeline',`📜 进度时间线（${timeline.length}条）`]].map(([v,l]) =>
      `<button onclick="studyProgressView='${v}';renderStudyTab()" style="font-size:11px;padding:5px 14px;border-radius:3px;cursor:pointer;font-family:inherit;border:1px solid ${studyProgressView===v?'var(--accent)':'var(--border)'};background:${studyProgressView===v?'var(--accent)':'var(--surface)'};color:${studyProgressView===v?'#fff':'var(--text-secondary)'}">${l}</button>`
    ).join('')}
  </div>`;

  if (studyProgressView === 'roadmap') return html + renderStudyRoadmap();

  if (!timeline.length) return html + `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">暂无进度记录</div>`;
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


function renderRecordsTab() {
  const { bookings } = studyData;
  const validBookings = bookings.filter(b => b.daily_record && Object.values(b.daily_record).some(v=>v));
  if (!validBookings.length) return '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">暂无面谈记录</div>';
  return `<div style="font-size:11px;font-weight:600;margin-bottom:10px">📋 面谈记录（${validBookings.length}条）</div>
  <div class="study-cols2" style="gap:12px 20px">
    ${validBookings.map(b => `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:12px;margin-bottom:8px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${b.slot_date}${b.actual_duration?' · '+b.actual_duration+'min':''} ${b.assigned_teacher?'· '+b.assigned_teacher+'老师':''}</div>
      <pre style="font-size:11px;line-height:1.8;white-space:pre-wrap;font-family:inherit;margin:0;color:var(--text-secondary)">${buildRecordText(b)}</pre>
    </div>`).join('')}
  </div>`;
}

// ── 作业页：左=资料/题目预览，右=作业列表与作答 ──
function renderHomeworkTab() {
  const validHomework = (studyData.sessionRecs || []).filter(r => r.teacher_file_url);
  return `
  <div class="split-hint">← 左右滑动切换「资料」与「作答」 →</div>
  <div class="study-split">
    <div style="min-width:0">
      <div style="font-size:11px;font-weight:600;margin-bottom:6px">📄 资料 / 题目预览</div>
      <div id="study_hw_viewer" style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;min-height:420px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:11px;text-align:center;padding:20px">
        点击右侧作业中的「参考资料」或「查看题目」<br>即可在此预览，边看边作答
      </div>
    </div>
    <div style="min-width:0">
      <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px;margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;margin-bottom:10px">📝 作业</div>
        <div id="study_hw_sessions_wrap"><div style="font-size:11px;color:var(--text-muted)">加载中…</div></div>
        <div id="study_hw_err" style="font-size:10px;color:var(--danger);margin-top:6px"></div>
      </div>
      <div id="study_hw_archive"></div>
      ${validHomework.length?`<div style="font-size:11px;font-weight:600;margin:14px 0 8px">✅ 历史批改文件（${validHomework.length}条）</div>
      ${validHomework.map(r=>`<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px;margin-bottom:6px">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">${r.session_date} · ${r.course_name||''}</div>
        ${r.feedback_knowledge?`<div style="font-size:11px;margin-bottom:3px">${escA(r.feedback_knowledge)}</div>`:''}
        ${r.feedback_suggestions?`<div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">💡 ${escA(r.feedback_suggestions)}</div>`:''}
        <a href="${escA(r.teacher_file_url)}" target="_blank" style="font-size:11px;color:var(--accent)">📎 下载批改文件</a>
      </div>`).join('')}`:''}
    </div>
  </div>`;
}

// 在左栏预览 PDF / 图片（同页边看边写）
function hwPreview(url, name) {
  const box = document.getElementById('study_hw_viewer');
  if (!box) { window.open(url, '_blank'); return; }
  const isPdf = /\.pdf(\?|$)/i.test(url);
  const narrow = window.innerWidth < 1200;   // 手机/窄屏：PDF 内嵌无法缩放，改为点击打开
  box.style.display = 'block';
  box.style.padding = '0';
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--border-light)">
      <span style="font-size:10px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escA(name||'资料')}</span>
      <a href="${escA(url)}" target="_blank" style="margin-left:auto;font-size:10px;color:var(--accent);white-space:nowrap">↗ 新窗口打开</a>
    </div>
    ${isPdf
      ? (narrow
        ? `<div style="padding:24px 18px;text-align:center">
             <div style="font-size:34px;margin-bottom:8px">📄</div>
             <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">${escA(name||'资料')}</div>
             <div style="font-size:10px;color:var(--text-muted);margin-bottom:14px">手机上内嵌 PDF 无法缩放，请点击下方按钮打开（可放大、可保存）</div>
             <a href="${escA(url)}" target="_blank" style="display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-size:12px;padding:9px 24px;border-radius:3px">打开 PDF 查看题目</a>
           </div>`
        : `<iframe src="${escA(url)}" style="width:100%;height:72vh;border:none;display:block"></iframe>`)
      : `<div style="padding:8px">
           <img src="${escA(url)}" style="max-width:100%;display:block;cursor:zoom-in" onclick="window.open('${escA(url)}','_blank')">
           <div style="text-align:center;margin-top:8px">
             <a href="${escA(url)}" target="_blank" style="display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-size:11px;padding:7px 18px;border-radius:3px">🔍 全屏查看 / 放大</a>
           </div>
         </div>`}`;
  // 窄屏：预览在左屏，自动滑过去，否则点了看不到变化
  try {
    const split = box.closest('.study-split');
    if (split && window.innerWidth < 1200) split.scrollTo({ left: 0, behavior: 'smooth' });
    else box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {}
}

// ── 作业状态 ──
let hwSessions = [];      // 有题目的课次
let hwSubs = {};          // session_id → 提交记录
let hwOpenId = null;      // 展开作答的课次
let hwDraft = {};         // { unitKey: { text, images:[{url,name}] } }
let hwLevelPick = {};     // session_id → 选中的级别索引
let hwWholeFile = null;   // 整份作业文件
let hwCalcExpand = {};    // 计算题「分问上传」展开状态
let hwPicked = {};        // 选做题：勾选要作答的题号
let hwLoaded = false;

async function loadStudyHwSessions(retry) {
  const wrap = document.getElementById('study_hw_sessions_wrap');
  if (!wrap) { if ((retry || 0) < 8) setTimeout(() => loadStudyHwSessions((retry || 0) + 1), 120); return; }
  if (hwLoaded) { renderHwList(); return; }   // 已有数据直接重绘
  const myMajor = studyStudent.major || studyMajor;
  const acceptMajors = myMajor === 'shakai_group'
    ? ['shakai_group', ...SHAKAI_GROUP]
    : SHAKAI_GROUP.includes(myMajor) ? [myMajor, 'shakai_group'] : [myMajor];
  try {
    const today = new Date();
    const from = new Date(today); from.setDate(today.getDate() - 60);
    const to = new Date(today); to.setDate(today.getDate() + 21);
    const fmt = d => d.toISOString().slice(0, 10);
    const [sessions, subs] = await Promise.all([
      sb(`/rest/v1/course_sessions?session_date=gte.${fmt(from)}&session_date=lte.${fmt(to)}&homework_enabled=is.true&select=*&order=session_date.desc`).catch(() => []),
      sb(`/rest/v1/homework_submissions?student_name=eq.${encodeURIComponent(studyStudent.name)}&select=*`).catch(() => []),
    ]);
    hwSessions = (sessions || []).filter(s => {
      // 兼容新结构 {version:2,levels:[]} 与旧数组格式
      const q = s.homework_questions;
      const hasQ = Array.isArray(q) ? q.length > 0 : !!(q && Array.isArray(q.levels) && q.levels.length);
      if (!hasQ) return false;
      const sm = Array.isArray(s.major) ? s.major : [s.major || ''];
      return !myMajor || sm.some(m => acceptMajors.includes(m));
    });
    hwSubs = {};
    (subs || []).forEach(x => hwSubs[x.session_id] = x);
    hwLoaded = true;
  } catch (e) {
    wrap.innerHTML = `<div style="font-size:11px;color:var(--danger)">加载失败：${e.message}</div>`;
    return;
  }
  try { renderHwList(); }
  catch (e) {
    wrap.innerHTML = `<div style="font-size:11px;color:var(--danger)">显示出错：${e.message}</div>`;
    const eb = document.getElementById('study_hw_err');
    if (eb) eb.textContent = String((e && e.stack) || e).slice(0, 300);
  }
}

function hwGraded(sub) { return !!(sub && (sub.teacher_feedback || sub.feedback_knowledge || sub.feedback_attitude || sub.feedback_suggestions)); }

function renderHwList() {
  const wrap = document.getElementById('study_hw_sessions_wrap');
  if (!wrap) return;
  if (!hwSessions.length) { wrap.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:10px 0">暂无布置的作业</div>'; return; }
  wrap.innerHTML = hwSessions.map(s => {
    const sub = hwSubs[s.id];
    const open = hwOpenId === s.id;
    const graded = hwGraded(sub);
    return `<div style="border:1px solid ${graded?'var(--ok)':sub?'var(--accent)':'var(--border)'};border-radius:4px;margin-bottom:6px;overflow:hidden;background:var(--surface)">
      <div onclick="hwToggle('${s.id}')" style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;${open?'background:var(--bg)':''}">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600">${escA(s.course_name||'')}${s.session_number?` 第${s.session_number}回`:''}</div>
          <div style="font-size:10px;color:var(--text-muted)">${s.session_date||''}${s.session_title?' · '+escA(s.session_title):''}${hwCountLabel(s)}</div>
        </div>
        <span style="font-size:10px;white-space:nowrap;color:${graded?'var(--ok)':sub?'var(--accent)':'var(--text-muted)'}">${graded?'✓ 已批改':sub?'✓ 已提交':'未提交'}</span>
        <span style="font-size:10px;color:var(--text-muted)">${open?'▾':'▸'}</span>
      </div>
      ${open?`<div style="border-top:1px solid var(--border-light);padding:12px 14px;background:var(--bg)">${hwDetailHtml(s, sub)}</div>`:''}
    </div>`;
  }).join('');
  renderHwArchive();
}

function hwToggle(sid) {
  if (hwOpenId === sid) { hwOpenId = null; renderHwList(); return; }
  hwOpenId = sid;
  hwDraft = {}; hwWholeFile = null;
  renderHwList();
}

// 归一化题目结构（兼容旧的简单题目列表）
function hwNorm(s) {
  const q = s.homework_questions;
  if (q && !Array.isArray(q) && q.version === 2) return { levels: q.levels || [], refs: q.refs || [] };
  if (Array.isArray(q) && q.length) return { levels: [{ key:'', blocks:[{ type:'free', title:'', items:q.map(x=>({num:x.num,text:x.text})) }] }], refs: [] };
  return { levels: [], refs: [] };
}
// 生成某级别下所有作答单元：{ key, label, allowText, allowImg }
function hwUnits(level) {
  const out = [];
  (level.blocks || []).forEach((b, bi) => {
    const T = { choice:'选择题', calc:'计算题', term:'名词解释', essay:'论述题', free:'' }[b.type] || '';
    const head = b.title || T || `区块${bi+1}`;
    if (b.type === 'choice') {
      for (let i = 1; i <= (b.count || 0); i++) out.push({ key:`${bi}-${i}`, block:bi, head, label:`第${i}题`, mode:'answer' });
    } else if (b.type === 'calc') {
      // 每道大题一个上传单元，可传多张图（按顺序）；兼容旧的分问数据
      const qs = b.count ? Array.from({length:b.count}, (_,i)=>({num:i+1, subs:1})) : (b.questions || []);
      qs.forEach(q => {
        out.push({ key:`${bi}-${q.num}-all`, block:bi, head, label:`第${q.num}题`, mode:'img', calcWhole:true, qnum:q.num, subs:q.subs||1 });
        if ((q.subs || 1) > 1) for (let j = 1; j <= q.subs; j++) out.push({ key:`${bi}-${q.num}-${j}`, block:bi, head, label:`第${q.num}题 问${j}`, mode:'img', calcSub:true, qnum:q.num });
      });
    } else if (b.type === 'term' || b.type === 'essay') {
      const unit = b.type === 'term' ? '问' : '题';
      const items = (b.items && b.items.length) ? b.items : Array.from({length:b.count||0}, (_,i)=>({num:i+1, text:''}));
      items.forEach(it => out.push({
        key:`${bi}-${it.num}`, block:bi, head,
        label: b.type === 'term' ? `问${it.num}` : `第${it.num}题`,
        text: it.text || '', mode: b.type === 'term' ? 'text' : 'both',
        pickable: (b.pick||0) > 0, unit,
      }));
      // 名词解释：整块一个图片上传（手写答案一张图即可）
      if (b.type === 'term') out.push({ key:`${bi}-img`, block:bi, head, label:'整题', mode:'img', blockImg:true });
    } else {
      // 自由题：默认整块统一作答（小问同属一个大题，一处作答/上传）
      if ((b.answerMode || 'whole') === 'whole') {
        out.push({ key:`${bi}-all`, block:bi, head, label:'作答', whole:true,
          text:(b.items||[]).map(it=>`${it.num}. ${it.text}`).join('\n'), mode:'both' });
      } else {
        (b.items || []).forEach(it => out.push({ key:`${bi}-${it.num}`, block:bi, head, label:`${it.num}.`, text:it.text, mode:'both' }));
      }
    }
  });
  return out;
}

function hwDetailHtml(s, sub) {
  const N = hwNorm(s);
  const locked = !!sub;
  // 级别选择
  const levels = N.levels;
  if (!levels.length) return '<div style="font-size:11px;color:var(--text-muted)">题目尚未设置</div>';
  let li = 0;
  if (locked && sub.level) { const idx = levels.findIndex(L => L.key === sub.level); if (idx >= 0) li = idx; }
  else if (hwLevelPick[s.id] != null) li = hwLevelPick[s.id];
  else { const my = (studyStudent.level || '').trim(); const idx = levels.findIndex(L => L.key && my.includes(L.key)); if (idx >= 0) li = idx; }
  const L = levels[li] || levels[0];
  const units = hwUnits(L);
  const ansOf = k => locked ? (((sub.answers || []).find(x => x.k === k)) || {}) : (hwDraft[k] || {});

  return `
  ${s.homework_note?`<div style="font-size:11px;color:var(--text-2);background:var(--surface);border-left:3px solid var(--accent);padding:8px 12px;margin-bottom:10px;white-space:pre-wrap">${escA(s.homework_note)}</div>`:''}
  ${N.refs.length?`<div style="font-size:11px;margin-bottom:10px">📚 参考资料：${N.refs.map(r=>`<span onclick="hwPreview('${escA(r.url)}','${escA(r.name||'资料')}')" style="color:var(--accent);margin-right:10px;cursor:pointer;text-decoration:underline">${escA(r.name||'资料')}</span>`).join('')}</div>`:''}
  ${hwGraded(sub)?`<div style="background:var(--ok-bg);border:1px solid var(--ok);border-radius:3px;padding:10px 12px;margin-bottom:10px">
    <div style="font-size:10px;color:var(--ok);font-weight:600;margin-bottom:4px">✓ 老师批改${sub.score?` · ${escA(sub.score)}`:''}</div>
    ${sub.feedback_knowledge?`<div style="font-size:11px;color:var(--text-2);line-height:1.9"><span style="color:var(--text-muted)">知识掌握：</span>${escA(sub.feedback_knowledge)}</div>`:''}
    ${sub.feedback_attitude?`<div style="font-size:11px;color:var(--text-2);line-height:1.9"><span style="color:var(--text-muted)">学习态度：</span>${escA(sub.feedback_attitude)}</div>`:''}
    ${sub.feedback_suggestions?`<div style="font-size:11px;color:var(--text-2);line-height:1.9"><span style="color:var(--text-muted)">改进建议：</span>${escA(sub.feedback_suggestions)}</div>`:''}
    ${sub.teacher_feedback&&!sub.feedback_knowledge?`<div style="font-size:11px;color:var(--text-2);line-height:1.9;white-space:pre-wrap">${escA(sub.teacher_feedback)}</div>`:''}
    ${sub.teacher_file_url?`<a href="${escA(sub.teacher_file_url)}" target="_blank" style="font-size:10px;color:var(--accent);display:inline-block;margin-top:6px">📎 下载批改文件</a>`:''}
  </div>`:''}
  ${levels.length>1?`<div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
    <span style="font-size:10px;color:var(--text-muted)">作业级别：</span>
    ${levels.map((x,i)=>`<span onclick="${locked?'':`hwLevelPick['${s.id}']=${i};renderHwList()`}" style="font-size:10px;padding:3px 10px;border-radius:2px;cursor:${locked?'default':'pointer'};border:1px solid ${i===li?'var(--accent)':'var(--border)'};background:${i===li?'var(--accent)':'var(--surface)'};color:${i===li?'#fff':'var(--text-secondary)'}">${escA(x.key||'不分级别')}</span>`).join('')}
  </div>`:''}

  ${(L.blocks||[]).map((b, bi) => {
    const T = { choice:'选择题', calc:'计算题', term:'名词解释', essay:'论述题', free:'' }[b.type] || '';
    const bUnits = units.filter(u => u.block === bi);
    return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px">${T?`【${T}】`:''}${escA(b.title||'')}
        ${b.file?`<span onclick="hwPreview('${escA(b.file.url)}','${escA(b.file.name||'题目')}')" style="font-size:10px;color:var(--accent);margin-left:8px;font-weight:400;cursor:pointer;text-decoration:underline">📎 查看题目（${escA(b.file.name||'文件')}）</span>
          <a href="${escA(b.file.url)}" target="_blank" style="font-size:10px;color:var(--text-muted);margin-left:6px;font-weight:400">↗ 新窗口</a>`:''}
      </div>
      ${(b.pick||0)>0&&!locked?`<div style="font-size:10px;color:var(--warn,#b8860b);margin-bottom:6px">✍ 以上${b.type==='term'?'问':'题'}中任选 <b>${b.pick}</b> ${b.type==='term'?'问':'题'}作答，请先点左侧「选做」标记你要回答的${b.type==='term'?'问':'题'}号</div>`:''}
      ${b.type==='choice'
        ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px">
            ${bUnits.map(u=>`<div style="display:flex;align-items:center;gap:4px">
              <span style="font-size:10px;color:var(--text-muted);white-space:nowrap">${u.label}</span>
              ${locked?`<span style="font-size:11px;font-weight:600">${escA(ansOf(u.key).text||'—')}</span>`
                :`<input value="${escA(ansOf(u.key).text||'')}" oninput="hwSetAns('${u.key}',this.value)" placeholder="答案" style="width:100%;font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit">`}
            </div>`).join('')}
          </div>`
        : b.type==='term'
        ? (() => {
            const qUnits = bUnits.filter(u => !u.blockImg);
            const imgU = bUnits.find(u => u.blockImg);
            const ia = imgU ? ansOf(imgU.key) : {}; const iImgs = ia.images || [];
            return `${qUnits.map(u => {
              const a = ansOf(u.key);
              const picked = !locked && u.pickable ? !!hwPicked[u.key] : true;
              return `<div style="border-top:1px dashed var(--border-light);padding:7px 0;${(!locked&&u.pickable&&!picked)?'opacity:.55':''}">
                <div style="font-size:11px;font-weight:600;margin-bottom:4px;display:flex;gap:6px;align-items:flex-start">
                  ${(!locked&&u.pickable)?`<span onclick="hwTogglePick('${u.key}')" style="cursor:pointer;user-select:none;font-size:10px;border:1px solid ${picked?'var(--accent)':'var(--border)'};background:${picked?'var(--accent)':'transparent'};color:${picked?'#fff':'var(--text-muted)'};border-radius:2px;padding:1px 7px;white-space:nowrap;flex-shrink:0">${picked?'✓ 作答':'选做'}</span>`:''}
                  <span>${u.label}${u.text?` <span style="font-weight:400;white-space:pre-wrap">${escA(u.text)}</span>`:''}</span>
                </div>
                ${locked
                  ? (a.text?`<div style="font-size:11px;color:var(--text-2);line-height:1.9;white-space:pre-wrap;background:var(--bg);border-radius:2px;padding:6px 8px">${escA(a.text)}</div>`:'')
                  : (picked?`<textarea rows="2" placeholder="在此作答（也可用下方整题上传照片）" oninput="hwSetAns('${u.key}',this.value)" style="width:100%;font-size:12px;line-height:1.9;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${escA(a.text||'')}</textarea>`:'')}
              </div>`;
            }).join('')}
            <div style="border-top:1px dashed var(--border-light);padding:8px 0 2px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${locked
                ? (iImgs.length?`<span style="font-size:10px;color:var(--text-muted)">手写作答：</span>${iImgs.map((im,i)=>`<a href="${escA(im.url)}" target="_blank" style="font-size:10px;color:var(--accent);border:1px solid var(--border);border-radius:2px;padding:2px 8px">📷 图${i+1}</a>`).join('')}`:'')
                : `<label style="font-size:10px;color:var(--accent);cursor:pointer;border:1px solid var(--border);border-radius:2px;padding:3px 12px">📷 整题上传照片（可多张）
                     <input type="file" accept="image/*" multiple style="display:none" onchange="hwPickImages('${imgU.key}', this)"></label>
                   <span id="hwimg_${imgU.key}" style="font-size:10px;color:var(--text-muted)">${iImgs.length?iImgs.map((x,i)=>`图${i+1}`).join('・'):'尚未上传'}</span>
                   <span style="font-size:9px;color:var(--text-muted)">手写在纸上的话，整块拍一张即可</span>`}
            </div>`;
          })()
        : b.type==='calc'
        ? (b.count ? Array.from({length:b.count},(_,i)=>({num:i+1,subs:1})) : (b.questions||[])).map(q => {
            const wu = bUnits.find(u => u.calcWhole && u.qnum === q.num);
            const subs = bUnits.filter(u => u.calcSub && u.qnum === q.num);
            const wa = ansOf(wu.key); const wImgs = wa.images || [];
            const expKey = `${s.id}-${bi}-${q.num}`;
            const expanded = !!hwCalcExpand[expKey];
            const subHasImg = subs.some(u => (ansOf(u.key).images||[]).length);
            return `<div style="border-top:1px dashed var(--border-light);padding:8px 0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="font-size:11.5px;font-weight:600">第${q.num}题${q.subs>1?`<span style="font-weight:400;color:var(--text-muted);font-size:10px">（共${q.subs}问）</span>`:''}</span>
                ${locked?'':`<label style="font-size:10px;color:var(--accent);cursor:pointer;border:1px solid var(--border);border-radius:2px;padding:3px 10px">📷 上传照片（可多张，按顺序）
                  <input type="file" accept="image/*" multiple style="display:none" onchange="hwPickImages('${wu.key}', this)"></label>`}
                <span id="hwimg_${wu.key}" style="font-size:10px;color:var(--text-muted)">${wImgs.length?wImgs.map((x,i)=>`图${i+1}`).join('・'):(locked?'未上传':'尚未上传')}</span>
                ${q.subs>1&&!locked?`<span onclick="hwCalcExpand['${expKey}']=!hwCalcExpand['${expKey}'];renderHwList()" style="margin-left:auto;font-size:10px;color:var(--text-muted);cursor:pointer">${expanded?'▾ 收起分问上传':'▸ 分问上传'}</span>`:''}
              </div>
              ${locked
                ? `${wImgs.length?`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${wImgs.map((im,i)=>`<a href="${escA(im.url)}" target="_blank" style="font-size:10px;color:var(--accent);border:1px solid var(--border);border-radius:2px;padding:2px 8px">📷 图${i+1}</a>`).join('')}</div>`:''}
                   ${subs.filter(u=>(ansOf(u.key).images||[]).length).map(u=>`<div style="margin-top:4px"><span style="font-size:10px;color:var(--text-muted)">${u.label.replace(`第${q.num}题 `,'')}：</span>${(ansOf(u.key).images||[]).map((im,i)=>`<a href="${escA(im.url)}" target="_blank" style="font-size:10px;color:var(--accent);border:1px solid var(--border);border-radius:2px;padding:2px 8px;margin-right:4px">📷 图${i+1}</a>`).join('')}</div>`).join('')}`
                : (expanded||subHasImg)&&q.subs>1
                  ? `<div style="margin-top:6px;padding-left:10px;border-left:2px solid var(--border-light)">
                      ${subs.map(u=>{const a=ansOf(u.key);const im=a.images||[];return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
                        <span style="font-size:10px;color:var(--text-muted);min-width:32px">问${u.label.split('问')[1]||''}</span>
                        <label style="font-size:10px;color:var(--accent);cursor:pointer;border:1px solid var(--border);border-radius:2px;padding:2px 9px">📷 上传
                          <input type="file" accept="image/*" multiple style="display:none" onchange="hwPickImages('${u.key}', this)"></label>
                        <span id="hwimg_${u.key}" style="font-size:10px;color:var(--text-muted)">${im.length?im.map((x,i)=>`图${i+1}`).join('・'):'—'}</span>
                      </div>`;}).join('')}
                    </div>`
                  : ''}
            </div>`;
          }).join('')
        : bUnits.map(u => {
            const a = ansOf(u.key); const imgs = a.images || [];
            const picked = !locked && u.pickable ? !!hwPicked[u.key] : true;
            return `<div style="border-top:1px dashed var(--border-light);padding:7px 0;${(!locked&&u.pickable&&!picked)?'opacity:.62':''}">
              ${u.whole
                ? `<div style="font-size:11.5px;line-height:1.9;white-space:pre-wrap;margin-bottom:6px">${escA(u.text||'')}</div>`
                : `<div style="font-size:11px;font-weight:600;margin-bottom:4px;display:flex;gap:6px;align-items:flex-start">
                     ${(!locked&&u.pickable)?`<span onclick="hwTogglePick('${u.key}')" style="cursor:pointer;user-select:none;font-size:10px;border:1px solid ${picked?'var(--accent)':'var(--border)'};background:${picked?'var(--accent)':'transparent'};color:${picked?'#fff':'var(--text-muted)'};border-radius:2px;padding:1px 7px;white-space:nowrap;flex-shrink:0">${picked?'✓ 作答':'选做'}</span>`:''}
                     <span>${u.label}${u.text?` <span style="font-weight:400;white-space:pre-wrap">${escA(u.text)}</span>`:''}</span>
                   </div>`}
              ${locked
                ? `${a.text?`<div style="font-size:11px;color:var(--text-2);line-height:1.9;white-space:pre-wrap;background:var(--bg);border-radius:2px;padding:6px 8px">${escA(a.text)}</div>`:''}
                   ${imgs.length?`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${imgs.map((im,i)=>`<a href="${escA(im.url)}" target="_blank" style="font-size:10px;color:var(--accent);border:1px solid var(--border);border-radius:2px;padding:2px 8px">${im.kind==='doc'?`📎 ${escA(im.name||'文件')}`:`📷 图${i+1}`}</a>`).join('')}</div>`:''}
                   ${!a.text&&!imgs.length?'<div style="font-size:10px;color:var(--text-muted)">未作答</div>':''}`
                : `${u.mode!=='img'?`<textarea rows="${u.mode==='both'?3:2}" placeholder="在此作答（也可只上传照片）" oninput="hwSetAns('${u.key}',this.value)" style="width:100%;font-size:12px;line-height:1.9;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${escA(a.text||'')}</textarea>`:''}
                   <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
                     <label style="font-size:10px;color:var(--accent);cursor:pointer;border:1px solid var(--border);border-radius:2px;padding:3px 10px">📷 ${u.whole?'上传作答照片（可多张）':`上传${u.label}照片`}
                       <input type="file" accept="image/*" multiple style="display:none" onchange="hwPickImages('${u.key}', this)"></label>
                     <span id="hwimg_${u.key}" style="font-size:10px;color:var(--text-muted)">${imgs.length?imgs.map((x,i)=>`图${i+1}`).join('・'):'尚未上传'}</span>
                   </div>`}
            </div>`;
          }).join('')}
    </div>`;
  }).join('')}

  ${locked
    ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
         <span style="font-size:10px;color:var(--text-muted)">已于 ${(sub.submitted_at||'').slice(0,16).replace('T',' ')} 提交${hwGraded(sub)?'':'，等待老师批改'}${sub.whole_file_url?` · <a href="${escA(sub.whole_file_url)}" target="_blank" style="color:var(--accent)">📎 整份作业文件</a>`:''}</span>
         ${!hwGraded(sub)?`<button onclick="hwWithdraw('${s.id}')" style="margin-left:auto;font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit;color:var(--text-secondary)">↺ 撤回重做</button>`:''}
       </div>`
    : `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:9px 12px;margin-bottom:8px">
         <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">📄 整份作业上传（Word / PDF / 照片）——写在 Word 里的作业在此提交即可，可与上方逐题作答并用</div>
         <label style="font-size:10px;color:var(--accent);cursor:pointer;border:1px solid var(--border);border-radius:2px;padding:3px 10px">📎 上传整份作业
           <input type="file" accept=".doc,.docx,.pdf,image/*" style="display:none" onchange="hwPickWhole(this)"></label>
         <span id="hw_whole_tip" style="font-size:10px;color:var(--text-muted);margin-left:8px">${hwWholeFile?escA(hwWholeFile.name):'尚未上传'}</span>
       </div>
       <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">💡 手写作业请按题号/问号上传，同一题可传多张（按拍摄顺序）；提交后不可修改</div>
       <button onclick="hwSubmit('${s.id}','${escA(L.key||'')}')" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:8px 22px;cursor:pointer;font-family:inherit">提交作业</button>`}`;
}

function hwSetAns(key, text) {
  hwDraft[key] = hwDraft[key] || { images: [] };
  hwDraft[key].text = text;
}

async function hwPickWhole(input) {
  const f = input.files[0];
  if (!f) return;
  const tip = document.getElementById('hw_whole_tip');
  if (tip) tip.textContent = '上传中…';
  try {
    const packed = await hwCompressImage(f, 2000, 0.85);
    const ext = (packed.name.split('.').pop()||'pdf').toLowerCase();
    const url = await sbUpload('homework', `${studyStudent.id}/whole-${Date.now()}.${ext}`, packed);
    hwWholeFile = { url, name: f.name };
    if (tip) tip.textContent = `✓ ${f.name}（${hwSizeLabel(packed.size)}）`;
  } catch (e) { if (tip) tip.textContent = '上传失败：' + e.message; }
  input.value = '';
}

// 上传前压缩：手机直出照片常有 3-8MB，压到长边 1600px / JPEG 82% 后通常 200-500KB
// 非图片（Word/PDF）与体积已很小的图片原样上传
async function hwCompressImage(file, maxSide, quality) {
  if (!/^image\//.test(file.type) || /heic|heif/i.test(file.type)) {
    // HEIC 等浏览器无法解码的格式：原样上传（Safari 上传时通常已自动转 JPEG）
    if (!/^image\//.test(file.type)) return file;
  }
  if (file.size <= 400 * 1024) return file;   // 已经很小，不必处理
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, (maxSide || 1600) / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality || 0.82));
    if (!blob || blob.size >= file.size) return file;   // 压不小就用原图
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (e) {
    return file;   // 任何解码失败都退回原文件，保证能交上作业
  }
}

function hwSizeLabel(n) { return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB'; }

async function hwPickImages(key, input) {
  const files = [...(input.files||[])];
  if (!files.length) return;
  const tip = document.getElementById('hwimg_' + key);
  if (tip) tip.textContent = '上传中…';
  hwDraft[key] = hwDraft[key] || { text:'', images:[] };
  hwDraft[key].images = hwDraft[key].images || [];
  try {
    let saved = 0;
    for (let i = 0; i < files.length; i++) {
      const raw = files[i];
      if (tip) tip.textContent = `处理中 ${i+1}/${files.length}…`;
      const f = await hwCompressImage(raw, 1600, 0.82);
      saved += Math.max(0, raw.size - f.size);
      if (tip) tip.textContent = `上传中 ${i+1}/${files.length}（${hwSizeLabel(f.size)}）…`;
      const ext = (f.name.split('.').pop()||'jpg').toLowerCase();
      const path = `${studyStudent.id}/${Date.now()}-${key}-${hwDraft[key].images.length+1}.${ext}`;
      const url = await sbUpload('homework', path, f);
      hwDraft[key].images.push({ url, name: raw.name, kind: /\.(jpe?g|png|gif|webp|heic)$/i.test(raw.name) ? 'img' : 'doc' });
    }
    if (tip) tip.textContent = hwDraft[key].images.map((x,i)=> x.kind === 'doc' ? (x.name||'文件') : `图${i+1}`).join('・')
      + (saved > 200*1024 ? `（已压缩，省 ${hwSizeLabel(saved)}）` : '');
  } catch (e) {
    if (tip) tip.textContent = '上传失败：' + e.message;
  }
  input.value = '';
}

async function hwSubmit(sid, levelKey) {
  const s = hwSessions.find(x => x.id === sid);
  if (!s) return;
  const N = hwNorm(s);
  const L = (N.levels.find(x => (x.key||'') === (levelKey||'')) || N.levels[0] || { blocks: [] });
  const units = hwUnits(L);
  const answersAll = units.map(u => ({
    k: u.key, label: `${u.head?u.head+' ':''}${u.label}`,
    q: u.text || '',                       // 题干随答案一并保存，便于老师对照批改
    picked: u.pickable ? !!hwPicked[u.key] : undefined,
    text: (hwDraft[u.key] && hwDraft[u.key].text || '').trim(),
    images: (hwDraft[u.key] && hwDraft[u.key].images) || [],
  }));
  // 只保留有内容的作答单元（计算题的整题/分问二选一，空的不入库）
  const answers = answersAll.filter(a => a.text || a.images.length);
  const answered = answers.length;
  // 必答数：选做区块按 pick 计，其余按单元数；计算题分问不计
  let totalNeed = 0;
  (L.blocks || []).forEach((b, bi) => {
    if ((b.pick || 0) > 0) { totalNeed += b.pick; return; }
    totalNeed += units.filter(u => u.block === bi && !u.calcSub && !u.blockImg).length;
  });
  if (!answered && !hwWholeFile) { alert('请至少作答一题，或上传整份作业文件'); return; }
  if (answered < totalNeed && !hwWholeFile && !confirm(`还有 ${totalNeed-answered} 处未作答，确认提交？提交后不可修改。`)) return;
  if ((answered >= totalNeed || hwWholeFile) && !confirm('确认提交作业？提交后不可修改。')) return;
  try {
    const row = {
      id: `hws-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      session_id: sid, course_name: s.course_name || '', session_number: s.session_number || null,
      session_date: s.session_date || null, level: levelKey || null,
      student_id: studyStudent.id, student_name: studyStudent.name, major: studyStudent.major || studyMajor || '',
      answers, whole_file_url: hwWholeFile ? hwWholeFile.url : null,
    };
    await sb('/rest/v1/homework_submissions', 'POST', row);
    row.submitted_at = new Date().toISOString();
    hwSubs[sid] = row;
    hwDraft = {}; hwWholeFile = null;
    renderHwList();
    alert('作业已提交');
  } catch (e) { alert('提交失败：' + e.message); }
}
// ══════════════════════════════════
// 课程表（admin 在课程安排里挑选发布；按学生专业取最新一份）
// UI 仿 Econschedule：图例色点 + 日历视图（周网格）/ 课程汇总 切换
// ══════════════════════════════════
let studySchedData = null;
let studySchedView = 'cal';

const SSCHED_COLORS = [
  ['#8a5a2b','#f5ead9'], ['#2a6aad','#e4eef8'], ['#2a9e6a','#e2f3ea'], ['#b03a2e','#f8e4dc'],
  ['#7a4a8a','#efe4f4'], ['#b8860b','#f8f0d8'], ['#3a7a7a','#e0f0f0'], ['#6b5c4e','#eee8e0'],
];

async function loadStudySchedule() {
  const el = document.getElementById('studyTabContent');
  if (!el) return;
  if (studySchedData) { el.innerHTML = renderScheduleTab(); return; }
  try {
    const myMajor = studyStudent.major || '';
    const keys = [myMajor];
    if (typeof SHAKAI_GROUP !== 'undefined' && SHAKAI_GROUP.includes(myMajor)) keys.push('shakai_group');
    const shares = await sb(`/rest/v1/course_schedule_shares?major=in.(${keys.map(k=>`"${k}"`).join(',')})&select=*&order=created_at.desc&limit=1`);
    const share = (shares || [])[0];
    if (!share || !(share.course_ids || []).length) { studySchedData = { share: null, sessions: [], courses: [] }; el.innerHTML = renderScheduleTab(); return; }
    const ids = share.course_ids;
    let sessions = [];
    for (let i = 0; i < ids.length; i += 40) {
      const batch = await sb(`/rest/v1/course_sessions?course_id=in.(${ids.slice(i,i+40).map(x=>`"${x}"`).join(',')})&select=*&order=session_date.asc`).catch(() => []);
      sessions = sessions.concat(batch || []);
    }
    // 课程详情（上课链接/校区/形式）
    const courseInfoArr = await sb(`/rest/v1/courses?id=in.(${ids.map(x=>`"${x}"`).join(',')})&select=id,name,meeting_url,campus,delivery,weekdays,time_range`).catch(() => []);
    const courseInfoMap = {};
    (courseInfoArr || []).forEach(c => courseInfoMap[c.id] = c);
    // 课程顺序按首回日期，分配颜色
    const byCourse = {};
    sessions.forEach(s => { if (!byCourse[s.course_id]) byCourse[s.course_id] = []; byCourse[s.course_id].push(s); });
    const courses = Object.entries(byCourse)
      .map(([id, list]) => ({ id, name: list[0].course_name || '', first: list[0].session_date || '' }))
      .sort((a, b) => a.first.localeCompare(b.first))
      .map((c, i) => Object.assign(c, { color: SSCHED_COLORS[i % SSCHED_COLORS.length], info: courseInfoMap[c.id] || {} }));
    studySchedData = { share, sessions, courses };
  } catch (e) {
    studySchedData = { share: null, sessions: [], courses: [], error: e.message };
  }
  el.innerHTML = renderScheduleTab();
}

function sschedColor(courseId) {
  const c = (studySchedData.courses || []).find(x => x.id === courseId);
  return c ? c.color : SSCHED_COLORS[7];
}

function renderScheduleTab() {
  const D = studySchedData || {};
  if (D.error) return `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">课程表加载失败：${D.error}</div>`;
  if (!D.share) return '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">暂无发布的课程表，请等待教务发布</div>';

  const legend = `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:10px 14px;margin-bottom:12px">
    ${D.courses.map(c => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-secondary)"><span style="width:10px;height:10px;border-radius:2px;background:${c.color[1]};border:1px solid ${c.color[0]};display:inline-block"></span>${escA(c.name)}</span>`).join('')}
  </div>`;

  const dvL = v => v === '线下＋线上' ? '线上线下同步' : (v || '');
  const infoBar = `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:8px 14px;margin-bottom:12px">
    ${D.courses.map(c => {
      const inf = c.info || {};
      return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:10px;padding:4px 0;border-bottom:1px dashed var(--border-light)">
        <span style="display:inline-flex;align-items:center;gap:5px;color:var(--text-secondary);min-width:120px"><span style="width:8px;height:8px;border-radius:2px;background:${c.color[1]};border:1px solid ${c.color[0]};display:inline-block"></span>${escA(c.name)}</span>
        ${inf.delivery?`<span style="color:var(--text-secondary)">${dvL(inf.delivery)}</span>`:''}
        ${inf.campus?`<span style="color:var(--text-muted)">📍 ${escA(inf.campus)}</span>`:''}
        ${inf.meeting_url?`<a href="${escA(inf.meeting_url)}" target="_blank" style="color:var(--accent)">🔗 上课链接</a>`:''}
      </div>`;
    }).join('')}
  </div>`;
  const toggle = `<div style="display:flex;gap:0;margin-bottom:12px;border:1px solid var(--border);border-radius:3px;overflow:hidden;width:fit-content">
    ${[['cal','日历视图'],['sum','课程汇总']].map(([k,l]) => `<button onclick="studySchedView='${k}';document.getElementById('studyTabContent').innerHTML=renderScheduleTab()" style="font-size:11px;padding:6px 16px;border:none;cursor:pointer;font-family:inherit;background:${studySchedView===k?'var(--accent)':'var(--surface)'};color:${studySchedView===k?'#fff':'var(--text-secondary)'}">${l}</button>`).join('')}
  </div>`;

  return `<div>
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">🗓 ${escA(D.share.title || '课程表')}</div>
    ${legend}${infoBar}${toggle}
    ${studySchedView === 'cal' ? sschedCalHtml() : sschedSumHtml()}
  </div>`;
}

// 日历视图：按周分块，列=当周有课的日期，行=时间段
function sschedCalHtml() {
  const sessions = studySchedData.sessions.filter(s => s.session_date);
  if (!sessions.length) return '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:12px">暂无课次</div>';
  const monday = ds => { const d = new Date(ds + 'T00:00:00'); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0,10); };
  const weeks = {};
  sessions.forEach(s => { const m = monday(s.session_date); if (!weeks[m]) weeks[m] = []; weeks[m].push(s); });
  const wd = ['日','一','二','三','四','五','六'];

  return Object.keys(weeks).sort().map((mon, wi) => {
    const list = weeks[mon];
    const dates = [...new Set(list.map(s => s.session_date))].sort();
    const times = [...new Set(list.map(s => s.time_range || ''))].sort();
    const cols = `78px repeat(${dates.length}, minmax(0,1fr))`;
    let h = `<div style="margin-bottom:20px">
      <div style="font-size:10px;color:var(--text-muted);letter-spacing:.08em;margin-bottom:5px">第 ${wi+1} 周</div>
      <div style="display:grid;grid-template-columns:${cols};border:1px solid var(--border);border-radius:4px;overflow:hidden;background:var(--surface)">`;
    // 表头
    h += `<div style="background:var(--bg);padding:6px 8px;border-bottom:1px solid var(--border)"></div>`;
    dates.forEach(ds => {
      const d = new Date(ds + 'T00:00:00');
      const isWk = d.getDay() === 0 || d.getDay() === 6;
      h += `<div style="background:var(--bg);padding:6px 4px;border-bottom:1px solid var(--border);border-left:1px solid var(--border-light);text-align:center">
        <div style="font-size:11px;font-weight:600;color:${isWk?'var(--accent)':'var(--text-secondary)'}">${d.getMonth()+1}/${d.getDate()}</div>
        <div style="font-size:9px;color:var(--text-muted)">周${wd[d.getDay()]}</div>
      </div>`;
    });
    // 每个时间段一行
    times.forEach(t => {
      h += `<div style="padding:8px;border-bottom:1px solid var(--border-light);font-size:9px;color:var(--text-muted);font-family:'DM Mono',monospace;display:flex;align-items:center">${t}</div>`;
      dates.forEach(ds => {
        const evs = list.filter(s => s.session_date === ds && (s.time_range || '') === t);
        h += `<div style="padding:4px 3px;border-bottom:1px solid var(--border-light);border-left:1px solid var(--border-light);display:flex;flex-direction:column;gap:3px;justify-content:center">`;
        evs.forEach(s => {
          const cancelled = s.session_title === '休讲';
          const col = sschedColor(s.course_id);
          h += cancelled
            ? `<div style="font-size:9px;text-align:center;padding:4px 2px;border-radius:2px;background:var(--bg);color:var(--text-muted);border:1px dashed var(--border)">${escA(s.course_name||'')} 休讲</div>`
            : `<div style="font-size:9px;text-align:center;padding:4px 2px;border-radius:2px;background:${col[1]};color:${col[0]};border:1px solid ${col[0]};line-height:1.4">${escA(s.course_name||'')}${s.session_number?`<div style="font-size:8px;opacity:.75">第${s.session_number}回${s.session_title?' '+escA(s.session_title):''}</div>`:''}</div>`;
        });
        h += `</div>`;
      });
    });
    h += `</div></div>`;
    return h;
  }).join('');
}

// 课程汇总视图：每门课一张卡，逐回列出
function sschedSumHtml() {
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
    ${studySchedData.courses.map(c => {
      const list = studySchedData.sessions.filter(s => s.course_id === c.id);
      return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;overflow:hidden">
        <div style="padding:9px 12px;border-bottom:1px solid var(--border-light)">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;padding:2px 10px;border-radius:2px;background:${c.color[1]};color:${c.color[0]};border:1px solid ${c.color[0]};font-weight:600">${escA(c.name)}</span>
            <span style="font-size:10px;color:var(--text-muted);margin-left:auto">${list.filter(s=>s.session_title!=='休讲').length} 课次</span>
          </div>
          ${(c.info&&(c.info.delivery||c.info.campus||c.info.meeting_url))?`<div style="font-size:10px;color:var(--text-muted);margin-top:4px;display:flex;flex-wrap:wrap;gap:8px">
            ${c.info.delivery?`<span>${c.info.delivery==='线下＋线上'?'线上线下同步':c.info.delivery}</span>`:''}
            ${c.info.campus?`<span>📍 ${escA(c.info.campus)}</span>`:''}
            ${c.info.meeting_url?`<a href="${escA(c.info.meeting_url)}" target="_blank" style="color:var(--accent)">🔗 上课链接</a>`:''}
          </div>`:''}
        </div>
        <div style="padding:6px 12px;max-height:260px;overflow-y:auto">
          ${list.map(s => {
            const d = new Date(s.session_date + 'T00:00:00');
            const cancelled = s.session_title === '休讲';
            return `<div style="display:flex;gap:8px;font-size:10px;padding:4px 0;border-bottom:1px dashed var(--border-light);${cancelled?'opacity:.5':''}">
              <span style="font-family:'DM Mono',monospace;color:var(--text-muted);white-space:nowrap">${s.session_date.slice(5)}(${['日','一','二','三','四','五','六'][d.getDay()]}) ${s.time_range||''}</span>
              <span style="color:var(--text-secondary)">${cancelled?'休讲':`${s.session_number?`第${s.session_number}回`:''}${s.session_title?' '+escA(s.session_title):''}`}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── 作业档案（成长回顾）：按课程分组的历史作业与老师反馈 ──
function renderHwArchive() {
  const box = document.getElementById('study_hw_archive');
  if (!box) return;
  const done = Object.values(hwSubs).filter(x => hwGraded(x));
  if (!done.length) { box.innerHTML = ''; return; }
  const byCourse = {};
  done.forEach(x => { (byCourse[x.course_name || '其他'] = byCourse[x.course_name || '其他'] || []).push(x); });
  box.innerHTML = `<div style="margin-top:14px">
    <div style="font-size:12px;font-weight:600;margin-bottom:8px">📚 作业档案（已批改 ${done.length} 次）</div>
    ${Object.entries(byCourse).map(([cname, list]) => `
    <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:10px 12px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:600;margin-bottom:6px">${escA(cname)}<span style="font-size:9px;color:var(--text-muted);font-weight:400;margin-left:6px">${list.length} 次</span></div>
      ${list.sort((a,b)=>String(a.session_date).localeCompare(String(b.session_date))).map(x => `
      <div style="font-size:10px;line-height:1.9;padding:5px 0;border-top:1px dashed var(--border-light)">
        <span style="color:var(--text-muted)">${x.session_date||''}${x.session_number?` 第${x.session_number}回`:''}</span>
        ${x.score?`<span style="background:var(--ok-bg);color:var(--ok);border-radius:2px;padding:0 6px;margin-left:6px;font-weight:600">${escA(x.score)}</span>`:''}
        <div style="color:var(--text-secondary);white-space:pre-wrap;margin-top:2px">${escA(x.feedback_knowledge||x.teacher_feedback||'')}${x.feedback_suggestions?`\n💡 ${escA(x.feedback_suggestions)}`:''}</div>
      </div>`).join('')}
    </div>`).join('')}
  </div>`;
}

// 作答单元数量标签（新旧结构通用）
function hwCountLabel(s) {
  const N = hwNorm(s);
  if (!N.levels.length) return '';
  if (N.levels.length > 1) return ` · ${N.levels.length}个级别`;
  const n = hwUnits(N.levels[0]).length;
  return n ? ` · ${n}题` : '';
}

// 撤回重做（老师尚未批改时可用；删除提交记录后重新作答）
async function hwWithdraw(sid) {
  const sub = hwSubs[sid];
  if (!sub) return;
  if (hwGraded(sub)) { alert('老师已批改，如需重做请联系老师'); return; }
  if (!confirm('撤回这次提交并重新作答？已上传的内容将被清除。')) return;
  try {
    await sb(`/rest/v1/homework_submissions?id=eq.${sub.id}`, 'DELETE');
    delete hwSubs[sid];
    hwDraft = {}; hwWholeFile = null;
    renderHwList();
  } catch (e) { alert('撤回失败：' + e.message); }
}

// 选做题勾选
function hwTogglePick(key) {
  hwPicked[key] = !hwPicked[key];
  renderHwList();
}
