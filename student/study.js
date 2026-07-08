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

  if (schoolSortBy === 'application_period') displaySchools.sort((a,b) => (a.application_period||'').localeCompare(b.application_period||''));
  else if (schoolSortBy === 'english_required') displaySchools.sort((a,b) => (a.english_required==='不要'?0:1)-(b.english_required==='不要'?0:1));
  else if (schoolSortBy === 'japanese_required') displaySchools.sort((a,b) => (a.japanese_required==='不要'?0:1)-(b.japanese_required==='不要'?0:1));

  let html = '';

  // 共享学校列表（表格形式）
  if (sharedLists.length) {
    const sl = sharedLists[0];
    html += `<div style="margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:12px;font-weight:600;color:#2c4a7c">📋 ${sl.title}</div>
          ${sl.notes?`<div style="font-size:11px;color:#2c4a7c;opacity:.8">${sl.notes}</div>`:''}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
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
      </div>
      <div style="border:1px solid #c5d9f0;border-radius:4px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead>
            <tr style="background:#ddeaf9">
              <th style="padding:7px 10px;text-align:left;font-weight:600;color:#2c4a7c;border-bottom:1px solid #c5d9f0">大学</th>
              <th style="padding:7px 10px;text-align:left;font-weight:600;color:#2c4a7c;border-bottom:1px solid #c5d9f0">研究科/専攻</th>
              <th style="padding:7px 8px;text-align:center;font-weight:600;color:#2c4a7c;border-bottom:1px solid #c5d9f0;white-space:nowrap">出愿期间</th>
              <th style="padding:7px 8px;text-align:center;font-weight:600;color:#2c4a7c;border-bottom:1px solid #c5d9f0">日语</th>
              <th style="padding:7px 8px;text-align:center;font-weight:600;color:#2c4a7c;border-bottom:1px solid #c5d9f0">英语</th>
            </tr>
          </thead>
          <tbody>
            ${displaySchools.map((s,i) => {
              const jpColor = s.japanese_required==='不要'?'#27ae60':s.japanese_required==='必須'?'#c0392b':'#856404';
              const enColor = s.english_required==='不要'?'#27ae60':s.english_required==='必須'?'#c0392b':'#856404';
              return `<tr style="border-bottom:1px solid #e8f0fb;background:${i%2===0?'#fff':'#f5f9ff'}">
                <td style="padding:7px 10px;font-weight:600">${s.university}</td>
                <td style="padding:7px 10px;color:#444">${[s.faculty,s.department,s.course].filter(Boolean).join(' · ')}</td>
                <td style="padding:7px 8px;text-align:center;color:var(--accent)">${s.application_period||'-'}</td>
                <td style="padding:7px 8px;text-align:center;color:${jpColor};font-weight:600">${s.japanese_required||'-'}</td>
                <td style="padding:7px 8px;text-align:center;color:${enColor};font-weight:600">${s.english_required||'-'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // 已选志望校
  html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
    <div style="font-size:12px;font-weight:600">我的志望校 (${schoolPlans.length}/6)</div>
    <button onclick="openStudySchoolEditor()" style="font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:5px 14px;cursor:pointer;font-family:inherit">✏ 编辑</button>
  </div>`;

  if (!schoolPlans.length) {
    html += `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px;border:1px dashed var(--border);border-radius:3px">参考上方列表，点击「编辑」填写志望校</div>`;
    return html;
  }

  [1,2,3].forEach(lv => {
    const lvPlans = schoolPlans.filter(p => p.level === lv);
    if (!lvPlans.length) return;
    html += `<div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:600;margin-bottom:8px">${levelLabel[lv]}</div>`;
    lvPlans.forEach(p => {
      html += `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px;margin-bottom:8px;font-size:11px">
        <div style="font-weight:600;font-size:13px;margin-bottom:4px">${p.school_name}</div>
        <div style="color:var(--text-secondary);margin-bottom:6px">${[p.faculty,p.department].filter(Boolean).join(' · ')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;color:var(--text-muted)">
          ${p.professor?`<div>👤 教授1：${p.professor}</div>`:''}
          ${p.professor2?`<div>👤 教授2：${p.professor2}</div>`:''}
          ${p.professor_url?`<div><a href="${p.professor_url}" target="_blank" style="color:var(--accent)">🔗 教授1研究内容</a></div>`:''}
          ${p.professor2_url?`<div><a href="${p.professor2_url}" target="_blank" style="color:var(--accent)">🔗 教授2研究内容</a></div>`:''}
          ${p.application_period?`<div>📅 出愿：${p.application_period}</div>`:''}
          ${p.exam_date?`<div>📝 考试：${p.exam_date}</div>`:''}
          ${p.documents_required?`<div style="grid-column:1/-1">📋 必要书类：${p.documents_required}</div>`:''}
          ${p.plan_requirement?`<div style="grid-column:1/-1">📄 计划书要求：${p.plan_requirement}</div>`:''}
          ${p.research_theme?`<div style="grid-column:1/-1">🔬 研究课题：${p.research_theme}</div>`:''}
        </div>
        ${p.notes?`<div style="color:var(--text-muted);margin-top:4px;font-style:italic">${p.notes}</div>`:''}
      </div>`;
    });
    html += `</div>`;
  });
  return html;
}

// ══════════════════════════════════
// 计划书 Tab（拆成先行研究+草稿）
// ══════════════════════════════════
function renderPlanTab() {
  const d = studyData.planDraft;
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <div style="font-size:12px;font-weight:600">计划书进度</div>
    <button onclick="openStudyPlanEditor()" style="font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:5px 14px;cursor:pointer;font-family:inherit">${d?'✏ 更新':'＋ 开始填写'}</button>
  </div>`;

  if (!d) return html + `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px;border:1px dashed var(--border);border-radius:3px">点击「开始填写」记录研究进展</div>`;

  // 先行研究部分
  if (d.research_question || d.prior_research || d.methodology || d.prior_research_url) {
    html += `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:10px;letter-spacing:.06em">先行研究</div>
      ${d.research_question?`<div style="margin-bottom:10px"><div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">问题意识</div><div style="font-size:12px;line-height:1.8">${d.research_question}</div></div>`:''}
      ${d.prior_research?`<div style="margin-bottom:10px"><div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">先行研究整理</div><div style="font-size:12px;line-height:1.8">${d.prior_research}</div></div>`:''}
      ${d.methodology?`<div style="margin-bottom:10px"><div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">研究方法</div><div style="font-size:12px;line-height:1.8">${d.methodology}</div></div>`:''}
      ${d.prior_research_url?`<div><a href="${d.prior_research_url}" target="_blank" style="font-size:12px;color:var(--accent)">🔗 参考文献链接</a></div>`:''}
    </div>`;
  }

  // 草稿部分
  if (d.draft_file_url || d.draft_notes) {
    html += `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:10px;letter-spacing:.06em">计划书草稿</div>
      ${d.draft_notes?`<div style="font-size:12px;line-height:1.8;margin-bottom:8px">${d.draft_notes}</div>`:''}
      ${d.draft_file_url?`<a href="${d.draft_file_url}" target="_blank" style="font-size:12px;color:var(--accent)">📎 下载草稿文件</a>`:''}
    </div>`;
  }

  // 老师批注
  if (d.teacher_comment) {
    html += `<div style="background:var(--ok-bg);border:1px solid var(--ok);border-radius:4px;padding:12px">
      <div style="font-size:11px;font-weight:600;color:var(--ok);margin-bottom:6px">💬 老师批注</div>
      <div style="font-size:12px;line-height:1.8;color:var(--ok)">${d.teacher_comment}</div>
    </div>`;
  }

  html += `<div style="font-size:10px;color:var(--text-muted);margin-top:10px">最后更新：${d.updated_at?.slice(0,10)||''}</div>`;
  return html;
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
// 面谈记录 Tab
// ══════════════════════════════════
function renderRecordsTab() {
  const { bookings, sessionRecs } = studyData;
  const validBookings = bookings.filter(b => b.daily_record && Object.values(b.daily_record).some(v=>v));
  const validHomework = sessionRecs.filter(r => r.teacher_file_url);

  if (!validBookings.length && !validHomework.length) return `<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:12px">暂无面谈记录</div>`;

  let html = '';
  if (validBookings.length) {
    html += `<div style="font-size:11px;font-weight:600;margin-bottom:10px">面谈记录（${validBookings.length}条）</div>`;
    validBookings.forEach(b => {
      html += `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:12px;margin-bottom:10px">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${b.slot_date}${b.actual_duration?' · '+b.actual_duration+'min':''} ${b.assigned_teacher?'· '+b.assigned_teacher+'老师':''}</div>
        <pre style="font-size:11px;line-height:1.8;white-space:pre-wrap;font-family:inherit;margin:0;color:var(--text-secondary)">${buildRecordText(b)}</pre>
      </div>`;
    });
  }
  if (validHomework.length) {
    html += `<div style="font-size:11px;font-weight:600;margin:14px 0 10px">作业批改（${validHomework.length}条）</div>`;
    validHomework.forEach(r => {
      html += `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:12px;margin-bottom:10px">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">${r.session_date} · ${r.course_name||''}</div>
        ${r.feedback_knowledge?`<div style="font-size:12px;margin-bottom:6px">${r.feedback_knowledge}</div>`:''}
        <a href="${r.teacher_file_url}" target="_blank" style="font-size:12px;color:var(--accent)">📎 下载批改文件</a>
      </div>`;
    });
  }
  return html;
}

// ══════════════════════════════════
// 志望校编辑器（严格按Excel格式）
// ══════════════════════════════════
async function openStudySchoolEditor() {
  const existing = studyData.schoolPlans;
  const { sharedSchools } = studyData;
  const modal = document.createElement('div');
  modal.id = 'studySchoolModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:12px;overflow-y:auto';

  // 共享学校下拉选项
  const schoolOptions = sharedSchools.map(s =>
    `<option value="${s.id}" data-name="${s.university}" data-faculty="${s.faculty||''}" data-dept="${s.department||''}" data-period="${s.application_period||''}">${s.university} ${s.department||''} (${s.application_period||''})</option>`
  ).join('');

  // 每个等级建2行（共6行）
  const levelGroups = [
    { lv:1, label:'🔴 冲刺（挑战）', plans: existing.filter(p=>p.level===1) },
    { lv:2, label:'🟡 匹配（目标）', plans: existing.filter(p=>p.level===2) },
    { lv:3, label:'🟢 保底', plans: existing.filter(p=>p.level===3) },
  ];

  function buildRow(p={}, lv, idx) {
    return `<div style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:12px;margin-bottom:10px" data-level="${lv}">
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px;font-weight:600">第${idx+1}校（${lv===1?'冲刺':lv===2?'匹配':'保底'}）</div>
      <div style="margin-bottom:8px">
        <label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px">从共享列表选择（或手动输入）</label>
        <select onchange="studyApplySharedSchool(this,${lv},${idx})" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface);width:100%;margin-bottom:6px">
          <option value="">手动输入</option>
          ${schoolOptions}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
        <input placeholder="学校名 *" value="${p.school_name||''}" data-field="school_name" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="研究科" value="${p.faculty||''}" data-field="faculty" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="専攻/コース" value="${p.department||''}" data-field="department" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="出愿时间（精确）" value="${p.application_period||''}" data-field="application_period" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="考试日期" value="${p.exam_date||''}" data-field="exam_date" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="必要书类（推荐信等）" value="${p.documents_required||''}" data-field="documents_required" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:5px;font-weight:600">教授信息（每校尽量找2位）</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
        <input placeholder="教授1姓名" value="${p.professor||''}" data-field="professor" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="教授1研究内容URL" value="${p.professor_url||''}" data-field="professor_url" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="教授2姓名" value="${p.professor2||''}" data-field="professor2" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="教授2研究内容URL" value="${p.professor2_url||''}" data-field="professor2_url" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <input placeholder="计划书要求（字数/格式）" value="${p.plan_requirement||''}" data-field="plan_requirement" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
        <input placeholder="研究课题（目前方向）" value="${p.research_theme||''}" data-field="research_theme" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      </div>
      <input type="hidden" value="${p.id||''}" data-field="id">
    </div>`;
  }

  let rowsHtml = '';
  levelGroups.forEach(g => {
    rowsHtml += `<div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border-light)">${g.label}（推荐2校）</div>`;
    // 显示已有的，不足2行则补空行
    const rows = g.plans.length ? g.plans : [{}];
    rows.forEach((p,i) => { rowsHtml += buildRow(p, g.lv, i); });
    if (g.plans.length < 2) rowsHtml += buildRow({}, g.lv, g.plans.length);
    // 手动添加按钮
    rowsHtml += `<button onclick="studyAddSchoolRowToGroup(${g.lv})" style="font-size:10px;background:none;border:1px dashed var(--border);border-radius:2px;padding:4px 10px;cursor:pointer;color:var(--text-muted);font-family:inherit">＋ 再添加一校</button>
    </div>`;
  });

  modal.innerHTML = `
  <div style="background:var(--surface,#fff);border-radius:6px;padding:20px;max-width:600px;width:100%;margin:auto">
    <div style="font-size:15px;font-weight:600;margin-bottom:4px">🏫 编辑志望校</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:16px">每个等级建议2校，共最多6所。每校务必找2位教授，填写精确出愿时间和考试日期。</div>
    <div id="studySchoolRows">${rowsHtml}</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button onclick="saveStudySchoolPlans()" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:4px;padding:11px;font-size:13px;cursor:pointer;font-family:inherit">保存</button>
      <button onclick="document.getElementById('studySchoolModal').remove()" style="background:none;border:1px solid var(--border);border-radius:4px;padding:11px 18px;font-size:12px;cursor:pointer;font-family:inherit">取消</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function studyApplySharedSchool(sel, lv, idx) {
  if (!sel.value) return;
  const opt = sel.options[sel.selectedIndex];
  const row = sel.closest('[data-level]');
  if (!row) return;
  const set = (f,v) => { const el = row.querySelector(`[data-field="${f}"]`); if(el) el.value = v; };
  set('school_name', opt.dataset.name || '');
  set('faculty', opt.dataset.faculty || '');
  set('department', opt.dataset.dept || '');
  set('application_period', opt.dataset.period || '');
}

function studyAddSchoolRowToGroup(lv) {
  // Count existing rows for this level
  const rows = document.querySelectorAll(`#studySchoolRows [data-level="${lv}"]`);
  const totalRows = document.querySelectorAll('#studySchoolRows [data-level]').length;
  if (totalRows >= 6) { alert('最多6所学校'); return; }
  const div = document.createElement('div');
  div.innerHTML = `<div style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:12px;margin-bottom:10px" data-level="${lv}">
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px;font-weight:600">新增校（${lv===1?'冲刺':lv===2?'匹配':'保底'}）</div>
    <select onchange="studyApplySharedSchool(this,${lv},99)" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface);width:100%;margin-bottom:6px">
      <option value="">手动输入</option>
      ${studyData.sharedSchools.map(s=>`<option value="${s.id}" data-name="${s.university}" data-faculty="${s.faculty||''}" data-dept="${s.department||''}" data-period="${s.application_period||''}">${s.university} ${s.department||''}</option>`).join('')}
    </select>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
      <input placeholder="学校名 *" data-field="school_name" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="研究科" data-field="faculty" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="専攻/コース" data-field="department" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="出愿时间（精确）" data-field="application_period" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="考试日期" data-field="exam_date" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="必要书类" data-field="documents_required" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
      <input placeholder="教授1姓名" data-field="professor" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="教授1研究内容URL" data-field="professor_url" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="教授2姓名" data-field="professor2" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="教授2研究内容URL" data-field="professor2_url" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <input placeholder="计划书要求" data-field="plan_requirement" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      <input placeholder="研究课题" data-field="research_theme" style="font-size:11px;padding:5px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
    </div>
    <input type="hidden" value="" data-field="id">
  </div>`;
  // Insert before the add button for this level group
  const btn = [...document.querySelectorAll('#studySchoolRows button')].find(b => b.textContent.includes('再添加') && b.getAttribute('onclick')?.includes(`(${lv})`));
  if (btn) btn.parentElement.insertBefore(div.firstElementChild, btn);
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
