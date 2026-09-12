// ══════════════════════════════════
// teacher-students.js — 学生管理模块
// 考学进度 / 面谈查询 / 出席・作业记录 / 学生档案（含筛选、节点总结、计划书内容渲染）
// 依赖：shared/constants.js、shared/supabase.js、teacher.js（须在其后加载）
// ══════════════════════════════════

let teacherProgressFilter = '';
let tpMajorFilter = '';   // '' 全部 | keiei | keizai | shakai_group | shakai | fukushi | shinpan
let tpSourceFilter = '';  // '' 全部 | 唯新 | 新世界 | 校内塾 | 杭州校
let teacherProgressData = { students: [], timeline: {}, schoolPlans: {}, planDrafts: {} };

// 专业筛选 chips（按老师可见范围裁剪）；setterName 为点击时调用的全局函数名
function tpMajorChipsHtml(cur, setterName) {
  const set = tsaAllowedSet();
  const opts = [['','全部专业'], ...majorFilterKeys().map(k => [k, majorLabel(k)])];
  return opts.filter(([k]) => {
    if (!k || !set) return true;
    if (k === 'shakai_group') return SHAKAI_GROUP.some(m => set.has(m));
    return set.has(k);
  }).map(([k, l]) => `<div class="filter-chip ${cur === k ? 'active' : ''}" onclick="${setterName}('${k}')" style="padding:3px 10px;font-size:10px">${l}</div>`).join('');
}

const TP_SOURCES = ['唯新','新世界','校内塾','杭州校'];

// 姓名搜索：先按共享 matchesPinyin 严格匹配（汉字 includes / 拼音首字母逐字），
// 多字母拼音在名字用字上匹配不到时，退回按第一个字母匹配姓氏（如 zs 也能命中张三）
function tpNameMatch(name, q) {
  q = (q || '').trim();
  if (!q) return true;
  if (matchesPinyin(name || '', q)) return true;
  if (/^[a-zA-Z]{2,3}$/.test(q)) return matchesPinyin(name || '', q[0].toLowerCase());
  return false;
}

// 按专业筛选值展开成实际专业列表
function tpMajorMatch(major, filterVal) {
  if (!filterVal) return true;
  if (filterVal === 'shakai_group') return SHAKAI_GROUP.includes(major) || major === 'shakai_group';
  return major === filterVal;
}

async function renderTeacherStudyProgress(mc) {
  mc.innerHTML = '<div class="empty">加载中…</div>';

  // 与 admin 学生档案同步：显示允许专业范围内的全部在籍学生（数据只在进入时拉取一次，筛选纯前端）
  let students = [];
  try {
    const all = await sb('/rest/v1/students?select=*&order=name.asc&limit=2000');
    const set = (typeof tsaAllowedSet === 'function') ? tsaAllowedSet() : null;
    students = (set ? (all || []).filter(s => set.has(s.major)) : (all || [])).filter(s => !s.status || s.status === 'active');
    if (tsaGuaranteedLock()) students = students.filter(tsaIsGuaranteed);
  } catch (e) { mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }

  if (!students.length) {
    mc.innerHTML = '<div class="empty">可见范围内暂无在籍学生</div>';
    return;
  }

  // 分批拉取时间线/志望校/计划书（每批80个学生，避免URL过长）
  const stuIds = students.map(s => s.id);
  const chunkFetch = async build => {
    let out = [];
    for (let i = 0; i < stuIds.length; i += 80) {
      const ids = stuIds.slice(i, i + 80).map(id => `"${id}"`).join(',');
      const batch = await sb(build(ids)).catch(() => []);
      out = out.concat(batch || []);
    }
    return out;
  };
  const [allTimeline, allPlans, allDrafts] = await Promise.all([
    chunkFetch(ids => `/rest/v1/student_progress_timeline?student_id=in.(${ids})&select=*&order=created_at.asc`),
    chunkFetch(ids => `/rest/v1/student_school_plans?student_id=in.(${ids})&select=*&order=level.asc`),
    chunkFetch(ids => `/rest/v1/student_plan_drafts?student_id=in.(${ids})&select=*&order=updated_at.desc`),
  ]);

  const timelineMap = {}, plansMap = {}, draftsMap = {};
  allTimeline.forEach(t => { if (!timelineMap[t.student_id]) timelineMap[t.student_id] = []; timelineMap[t.student_id].push(t); });
  allPlans.forEach(p => { if (!plansMap[p.student_id]) plansMap[p.student_id] = []; plansMap[p.student_id].push(p); });
  allDrafts.forEach(d => { if (!draftsMap[d.student_id]) draftsMap[d.student_id] = d; });

  teacherProgressData = { students, timelineMap, plansMap, draftsMap };
  tpRenderShell();
}

// 外壳：标题/搜索/专业/来源筛选 + 列表容器（切换筛选时重绘外壳，搜索输入只刷新列表保持焦点）
function tpRenderShell() {
  const box = document.getElementById('sm_content') || document.getElementById('mainContent');
  if (!box || !teacherProgressData) return;
  box.innerHTML = `
  <div class="page-header">
    <div class="section-title">考学进度 <span class="badge-count" id="tp_count"></span></div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px">
    <span style="font-size:10px;color:var(--text-3)">专业：</span>${tpMajorChipsHtml(tpMajorFilter, 'tpSetMajor')}
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">
    <span style="font-size:10px;color:var(--text-3)">来源：</span>${tpSourceChipsHtml(tpSourceFilter, 'tpSetSource')}
  </div>
  <div class="search-bar" style="margin-bottom:10px">
    <input placeholder="搜索学生姓名（汉字 / 拼音首字母）或来源…" value="${tsaEsc(teacherProgressFilter)}"
      oninput="teacherProgressFilter=this.value;tpRenderProgressList()">
  </div>
  <div id="tp_list"></div>`;
  tpRenderProgressList();
}

function tpSetMajor(v) { tpMajorFilter = v; tpRenderShell(); }
function tpSetSource(v) { tpSourceFilter = v; tpRenderShell(); }

// 来源筛选 chips
function tpSourceChipsHtml(cur, setterName) {
  return [['','全部'], ...TP_SOURCES.map(x => [x, x])]
    .map(([k, l]) => `<div class="filter-chip ${cur === k ? 'active' : ''}" onclick="${setterName}('${k}')" style="padding:3px 10px;font-size:10px">${l}</div>`).join('');
}

function tpFilteredStudents() {
  const { students } = teacherProgressData;
  let list = students.filter(s => tpMajorMatch(s.major, tpMajorFilter));
  if (tpSourceFilter) list = list.filter(s => (s.source || '') === tpSourceFilter);
  const q = teacherProgressFilter.trim();
  if (q) list = list.filter(s => tpNameMatch(s.name, q) || (s.source || '').includes(q));
  return list;
}

// 备考节点文字总结（与学生学习记录页的备考规划同一套逻辑，按学生所选考试路线）
function tpNodeSummaryHtml(s, latest, plans, draft) {
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const route = s.prep_model === 'winter' ? 'winter' : s.prep_model === 'next_summer' ? 'next_summer' : 'summer';
  const examMonth = route === 'winter' ? 1 : 8;
  let examIdx = now.getFullYear() * 12 + (examMonth - 1);
  while (examIdx < nowIdx) examIdx += 12;
  if (route === 'next_summer') examIdx += 12; // 次年路线：跳过最近一轮
  // 各项目最晚节点偏移（次年路线：语言按冬季要求、草稿提前到12月）
  const DL = route === 'next_summer'
    ? { japanese:-7, english:-7, plan:-8, school:-3, apply:-1, kakomon:0, exam:0 }
    : { japanese:-1, english:-1, plan:-3, school:-2, apply:-1, kakomon:0, exam:0 };
  const ymStr = i => `${Math.floor(i/12)}年${i%12+1}月`;
  let refs = 0;
  try { refs = draft && draft.prior_research_list ? JSON.parse(draft.prior_research_list).length : 0; } catch (e) {}
  const draftUploaded = !!(draft && draft.draft_file_url);
  let draftFilled = false;
  try {
    const df1 = draft && draft.draft_fields ? JSON.parse(draft.draft_fields) : {};
    draftFilled = Object.values(df1).some(v => Array.isArray(v) ? v.length : String(v || '').trim());
  } catch (e) {}
  if (!draftFilled && draft) draftFilled = ['research_question','methodology','draft_notes'].some(f => String(draft[f] || '').trim());
  const dn = (k, v) => typeof PROGRESS_DONE !== 'undefined' && (PROGRESS_DONE[k] || []).includes(v);
  const jp = latest.japanese || '', en = latest.english || '', plan = latest.plan || '', apply = latest.apply || '', exam = latest.exam || '';
  // 逐校推进统计（来自志望校的状态与过去问/面试稿标记）
  const profOkN = plans.filter(p => ['prof_ok','applied','passed'].includes(p.status)).length;
  const contactedN = plans.filter(p => p.status === 'contacted').length;
  const appliedN = plans.filter(p => ['applied','passed'].includes(p.status)).length;
  const passedN = plans.filter(p => p.status === 'passed').length;
  const kakomonN = plans.filter(p => p.kakomon_started).length;
  const interviewN = plans.filter(p => p.interview_draft_done).length;
  const dlSuffix = route === 'next_summer' ? '（次年路线）' : '';
  const items = [
    { label:'日语', cur:[jp || '未填写', s.japanese_score || ''].filter(Boolean).join(' · '), done: dn('japanese', jp), dl:DL.japanese, dlName:'成绩确定最晚' + dlSuffix },
    { label:'英语', cur:[en || '未填写', s.english_score || ''].filter(Boolean).join(' · '), done: dn('english', en), dl:DL.english, dlName:'成绩确定最晚' + dlSuffix },
    { label:'研究计划书', cur:[plan || (draftUploaded ? '已完成' : draftFilled ? '撰写中' : refs ? '在收集材料' : '未填写'), refs ? `文献 ${refs} 条` : '', draftUploaded ? '📎 完成稿已上传' : ''].filter(Boolean).join(' · '), done: plan === '已完成' || draftUploaded, dl:DL.plan, dlName:'草稿完成最晚' + dlSuffix },
    { label:'择校・联系教授', cur: (plans.length ? `已选 ${plans.length}/6 校` : '未选校') + (contactedN ? ` · 已发邮件 ${contactedN} 校` : '') + (profOkN ? ` · 教授OK ${profOkN} 校` : '') + (apply ? ' · ' + apply : ''), done: profOkN > 0, dl:DL.school, dlName:'锁定教授最晚' },
    { label:'出愿', cur: appliedN ? `已出愿 ${appliedN} 校` : (apply || '未开始'), done: appliedN > 0 || ['已出愿','已合格'].includes(apply), dl:DL.apply, dlName:'出愿' },
    { label:'过去问・面试稿', cur: [(kakomonN ? `过去问已开始 ${kakomonN} 校` : ''), (interviewN ? `面试稿完成 ${interviewN} 校` : ''), exam || ''].filter(Boolean).join(' · ') || '未开始', done: dn('exam', exam), dl:DL.kakomon, dlName:'完成最晚' },
    { label:'大学院考试', cur: passedN ? `合格 ${passedN} 校` : apply === '已合格' ? '已合格' : appliedN ? `已出愿 ${appliedN} 校・待考试` : '—', done: passedN > 0 || apply === '已合格', dl:DL.exam, dlName:'考试' },
  ];
  return items.map(it => {
    const dlIdx = examIdx + it.dl, left = dlIdx - nowIdx;
    let v, c;
    if (it.done) { v = it.label === '大学院考试' ? '🎉 已合格' : '✓ 已完成'; c = 'var(--ok,#2a9e6a)'; }
    else if (left > 1)   { v = `距${it.dlName}（${ymStr(dlIdx)}）还剩 ${left} 个月`; c = 'var(--text-2,#666)'; }
    else if (left === 1) { v = `⚠ 距${it.dlName}仅剩 1 个月`; c = 'var(--warn,#b8860b)'; }
    else if (left === 0) { v = `⚠ ${it.dlName}就在本月`; c = 'var(--danger,#b03a2e)'; }
    else                 { v = `✗ 已超${it.dlName} ${-left} 个月`; c = 'var(--danger,#b03a2e)'; }
    return `<div style="font-size:11px;line-height:1.9"><span style="font-weight:600">${it.label}</span>：<span style="color:var(--text-2)">${tsaEsc(it.cur)}</span> —— <span style="color:${c}">${v}</span></div>`;
  }).join('');
}

function tpRenderProgressList() {
  const listBox = document.getElementById('tp_list');
  if (!listBox || !teacherProgressData) return;
  const { timelineMap, plansMap, draftsMap } = teacherProgressData;
  const filtered = tpFilteredStudents();
  const cnt = document.getElementById('tp_count');
  if (cnt) cnt.textContent = filtered.length;

  const cards = filtered.map(s => {
    const timeline = timelineMap[s.id] || [];
    const latest = getLatestProgress(timeline);
    const plans = plansMap[s.id] || [];
    const draft = draftsMap[s.id];
    const levelLabel = { 1:'🔴', 2:'🟡', 3:'🟢' };
    const routeLabel = s.prep_model === 'winter' ? '冬季路线・12月出愿1月考试'
      : s.prep_model === 'next_summer' ? '次年夏季路线・语言按冬季要求・次年7月出愿8月考试'
      : '夏季路线・7月出愿8月考试';

    const statusRow = Object.entries(PROGRESS_LABELS).map(([k]) => {
      const val = k === 'japanese' ? (latest[k] || (s.japanese_score ? '有成绩' : '')) :
                  k === 'english' ? (latest[k] || (s.english_score ? '有成绩' : '')) :
                  latest[k];
      if (!val) return '';
      const done = isProgressDone(k, latest[k]);
      const scoreHint = k==='japanese'&&s.japanese_score ? ` · ${s.japanese_score}` : k==='english'&&s.english_score ? ` · ${s.english_score}` : '';
      return `<span style="font-size:10px;background:${done?'var(--ok-bg)':'var(--warn-bg)'};color:${done?'var(--ok)':'var(--warn)'};padding:1px 6px;border-radius:2px;white-space:nowrap">${PROGRESS_ICONS[k]} ${latest[k]||''}${scoreHint}</span>`;
    }).join('');

    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer" onclick="toggleTeacherProgressCard('${s.id}')">
        <div style="flex:1">
          <span style="font-size:13px;font-weight:600">${tsaEsc(s.name)}</span>
          <span style="font-size:11px;color:var(--text-3);margin-left:8px">${MAJORS[s.major]||s.major||''}</span>
          ${s.source?`<span style="font-size:10px;color:var(--accent);margin-left:6px;border:1px solid var(--border);border-radius:2px;padding:0 5px">${tsaEsc(s.source)}</span>`:''}
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:60%">
          ${statusRow || '<span style="font-size:10px;color:var(--text-3)">暂无进度</span>'}
        </div>
      </div>
      <div id="tprog_${s.id}" style="display:none;border-top:1px solid var(--border-light);background:var(--bg)">
        <!-- 备考节点文字总结 -->
        <div style="padding:12px 14px 0">
          <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">📅 备考节点总结（${routeLabel}）</div>
          <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:8px 12px">
            ${tpNodeSummaryHtml(s, latest, plans, draft)}
          </div>
        </div>
        <div style="padding:12px 14px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <!-- 语言成绩 -->
          <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px">
            <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">🗣 日语　📝 英语</div>
            <div style="font-size:11px">${s.japanese_score||'未填写'}</div>
            <div style="font-size:11px;color:var(--text-2)">${s.english_score||'未填写'}</div>
          </div>
          <!-- 计划书 -->
          <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px">
            <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">📄 计划书进度</div>
            ${draft ? `
            ${tDraftSummaryHtml(draft)}
            ${draft.draft_file_url?`<a href="${draft.draft_file_url}" target="_blank" style="font-size:10px;color:var(--accent)">📎 草稿文件</a>`:''}
            <button onclick="openTeacherDraftComment('${s.id}','${s.name}')" style="margin-top:6px;font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;display:block">
              ${draft.teacher_comment?'查看・评估计划书/先行研究':'查看・评估计划书/先行研究'}
            </button>
            ` : '<div style="font-size:11px;color:var(--text-3)">学生尚未填写</div>'}
          </div>
        </div>
        <!-- 志望校 -->
        <div style="padding:0 14px 12px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <div style="font-size:10px;color:var(--text-3)">🏫 志望校（${plans.length}所）· 状态与过去问/面试稿可直接修改，即时保存并与学生端同步</div>
            <button onclick="event.stopPropagation();tpAddSchool('${s.id}','${(s.name||'').replace(/'/g,'')}','${s.major||''}')" style="margin-left:auto;font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit;white-space:nowrap">＋ 添加志望校</button>
          </div>
          ${plans.length ? `
          <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;background:var(--surface);border:1px solid var(--border-light)">
            <thead><tr style="background:var(--bg)">
              ${['No.','级别','学校名 · 研究科','教授','出愿期间','该校进度','过去问','面试稿'].map(h=>`<th style="padding:5px 8px;text-align:left;font-weight:600;color:var(--text-3);border-bottom:1px solid var(--border);white-space:nowrap">${h}</th>`).join('')}
            </tr></thead>
            <tbody>
              ${plans.map((p,pi)=>{const st=schoolStatusLabel(p.status);return `<tr style="border-bottom:1px solid var(--border-light)">
                <td style="padding:5px 8px;color:var(--text-3)">${pi+1}</td>
                <td style="padding:5px 8px;white-space:nowrap">${levelLabel[p.level]||''}</td>
                <td style="padding:5px 8px"><span style="font-weight:600">${tsaEsc(p.school_name)}</span>${p.faculty?`<span style="color:var(--text-3);margin-left:4px;font-size:10px">${tsaEsc(p.faculty)}</span>`:''}</td>
                <td style="padding:5px 8px;white-space:nowrap">${tsaEsc(p.professor)||'—'}</td>
                <td style="padding:5px 8px;font-size:10px;color:var(--accent);white-space:nowrap">${tsaEsc(p.application_period)||'—'}</td>
                <td style="padding:5px 8px">
                  <select onchange="tpPlanSet('${p.id}','status',this.value,this)" onclick="event.stopPropagation()" style="font-size:10px;padding:2px 4px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;color:${st.c};font-weight:600">
                    ${Object.entries(SCHOOL_STATUS_LABELS).filter(([k])=>k!=='failed'||p.status==='failed').map(([k,v])=>`<option value="${k}" ${p.status===k?'selected':''}>${v.t}</option>`).join('')}
                  </select>
                </td>
                <td style="padding:5px 8px"><button onclick="event.stopPropagation();tpPlanFlag('${p.id}','kakomon_started',this)" data-on="${p.kakomon_started?'1':'0'}" style="font-size:10px;border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;border:1px solid ${p.kakomon_started?'var(--ok)':'var(--border)'};background:${p.kakomon_started?'var(--ok-bg)':'var(--bg)'};color:${p.kakomon_started?'var(--ok)':'var(--text-3)'}">${p.kakomon_started?'✓ 已开始':'未开始'}</button></td>
                <td style="padding:5px 8px"><button onclick="event.stopPropagation();tpPlanFlag('${p.id}','interview_draft_done',this)" data-on="${p.interview_draft_done?'1':'0'}" style="font-size:10px;border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;border:1px solid ${p.interview_draft_done?'var(--ok)':'var(--border)'};background:${p.interview_draft_done?'var(--ok-bg)':'var(--bg)'};color:${p.interview_draft_done?'var(--ok)':'var(--text-3)'}">${p.interview_draft_done?'✓ 已完成':'未完成'}</button></td>
              </tr>`;}).join('')}
            </tbody>
          </table></div>` : '<div style="font-size:11px;color:var(--text-3)">学生尚未填写志望校</div>'}
        </div>
        ${(s.course_type||'').includes('保录') ? `
        <!-- 保录学校 -->
        <div style="padding:0 14px 12px">
          <div style="font-size:10px;color:#8a5010;margin-bottom:6px;font-weight:600">🎓 保录学校（${(Array.isArray(s.guaranteed_schools)?s.guaranteed_schools.length:0)}所）</div>
          ${(Array.isArray(s.guaranteed_schools)&&s.guaranteed_schools.length) ? `<div style="display:flex;flex-direction:column;gap:4px">${s.guaranteed_schools.map(g=>`<div style="font-size:11px;padding:5px 10px;border:1px solid #e8d9b8;border-radius:4px;background:#fdfaf5"><span style="font-weight:600">${tsaEsc(g.university)}</span>${g.program?` <span style="color:var(--text-3)">· ${tsaEsc(g.program)}</span>`:''}</div>`).join('')}</div>` : '<div style="font-size:11px;color:var(--text-3)">尚无保录学校（可在管理端录入）</div>'}
        </div>` : ''}
        <!-- 老师评估记录（学生不可见） -->
        <div style="padding:0 14px 12px">
          <div onclick="event.stopPropagation();tpNotesToggle('${s.id}','${tsaEsc(s.name)}',this)" style="font-size:10px;color:var(--text-3);margin-bottom:6px;cursor:pointer;user-select:none">📝 老师评估记录（学生不可见，仅老师与 admin）<span class="arr" style="margin-left:4px">▸</span></div>
          <div id="tpnotes_${s.id}" style="display:none"></div>
        </div>
        <!-- 进度时间线（默认收起） -->
        <div style="padding:0 14px 12px">
          <div onclick="event.stopPropagation();const el=document.getElementById('tptl_${s.id}');const open=el.style.display==='none';el.style.display=open?'block':'none';this.querySelector('.arr').textContent=open?'▾':'▸'" style="font-size:10px;color:var(--text-3);margin-bottom:6px;cursor:pointer;user-select:none">进度时间线（${timeline.length}条）<span class="arr" style="margin-left:4px">▸</span></div>
          <div id="tptl_${s.id}" style="display:none">
            ${timeline.length ? [...timeline].reverse().map(entry => renderProgressTimelineEntry(entry, false)).join('') : '<div style="font-size:11px;color:var(--text-3)">暂无记录</div>'}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  listBox.innerHTML = cards || '<div class="empty">没有符合筛选条件的学生</div>';
}

function toggleTeacherProgressCard(id) {
  const el = document.getElementById(`tprog_${id}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ══ 老师侧：计划书 / 先行研究 查看・评估 ══
// 老师标注存 student_plan_drafts.teacher_ref_notes（与学生自填的 prior_research_list 分离，互不覆盖）
const T_REF_TAG_LIB = [
  ['重要度', ['核心文献', '重要参考', '一般参考']],
  ['研究方法', ['量的研究', '质的研究', '理论研究', '个案研究', '比较研究']],
  ['阅读建议', ['需精读', '可略读', '仅看结论', '需补充同类文献']],
];
let tdcStudentId = null, tdcDraft = null, tdcNotes = {}, tdcTab = 'refs';

function tRefKey(r, i) { return String((r && (r.title || r.keyword)) || '').trim() || ('#' + i); }
function tParseNotes(draft) {
  const v = draft && draft.teacher_ref_notes;
  if (!v) return {};
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return {}; }
}
function tdcNoteOf(key) { return tdcNotes[key] || (tdcNotes[key] = { tags: [], comment: '', rating: '' }); }

function openTeacherDraftComment(studentId, studentName) {
  const draft = teacherProgressData.draftsMap?.[studentId];
  if (!draft) return;
  tdcStudentId = studentId; tdcDraft = draft; tdcNotes = tParseNotes(draft); tdcTab = 'refs';
  const existing = document.getElementById('teacherDraftCommentModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'teacherDraftCommentModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div id="tdcBody" style="background:var(--surface);border-radius:6px;padding:20px;max-width:760px;width:100%;max-height:90vh;overflow-y:auto"></div>';
  document.body.appendChild(modal);
  tdcRender(studentName);
}

function tdcRender(studentName) {
  const box = document.getElementById('tdcBody');
  if (!box) return;
  const draft = tdcDraft;
  const refs = tDraftRefs(draft);
  const tab = (id, label, n) => `<button onclick="tdcTab='${id}';tdcRender('${tsaEsc(studentName)}')" style="font-size:12px;padding:6px 16px;border:none;border-bottom:2px solid ${tdcTab === id ? 'var(--accent)' : 'transparent'};background:none;cursor:pointer;font-family:inherit;color:${tdcTab === id ? 'var(--text)' : 'var(--text-3)'};font-weight:${tdcTab === id ? '600' : '400'}">${label}${n ? ` <span style="font-size:10px;color:var(--text-3)">${n}</span>` : ''}</button>`;

  const refsHtml = refs.length ? refs.map((r, i) => {
    const key = tRefKey(r, i);
    const n = tdcNotes[key] || { tags: [], comment: '', rating: '' };
    const info = Object.entries(r).filter(([k, v]) => v).map(([k, v]) => `<span style="color:var(--text-3)">${T_REF_LABELS[k] || k}：</span>${tsaEsc(v)}`).join('　');
    return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:9px 11px;margin-bottom:7px;background:var(--bg)">
      <div style="font-size:11px;line-height:1.9;margin-bottom:6px">${i + 1}. ${info}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:5px">
        ${T_REF_TAG_LIB.map(([grp, tags]) => `<span style="font-size:9px;color:var(--text-3)">${grp}</span>` + tags.map(t => `<span onclick="tdcToggleTag('${tsaEsc(key)}','${tsaEsc(t)}','${tsaEsc(studentName)}')" style="cursor:pointer;font-size:10px;border:1px solid ${(n.tags || []).includes(t) ? 'var(--accent)' : 'var(--border)'};background:${(n.tags || []).includes(t) ? 'var(--accent)' : 'transparent'};color:${(n.tags || []).includes(t) ? '#fff' : 'var(--text-2)'};border-radius:2px;padding:1px 8px">${t}</span>`).join('')).join('')}
      </div>
      ${(n.tags || []).filter(t => !T_REF_TAG_LIB.some(([, ts]) => ts.includes(t))).length ? `<div style="margin-bottom:5px">${(n.tags || []).filter(t => !T_REF_TAG_LIB.some(([, ts]) => ts.includes(t))).map(t => `<span style="font-size:10px;background:var(--accent);color:#fff;border-radius:2px;padding:1px 8px;margin-right:4px">${tsaEsc(t)}<span onclick="tdcToggleTag('${tsaEsc(key)}','${tsaEsc(t)}','${tsaEsc(studentName)}')" style="cursor:pointer;margin-left:5px">✕</span></span>`).join('')}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <input id="tdc_newtag_${i}" placeholder="自定义关键词" style="font-size:10px;padding:3px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface);width:130px">
        <button onclick="tdcAddTag('${tsaEsc(key)}',${i},'${tsaEsc(studentName)}')" style="font-size:10px;border:1px solid var(--border);background:none;border-radius:2px;padding:3px 9px;cursor:pointer;font-family:inherit">＋ 添加</button>
        <input value="${tsaEsc(n.comment || '')}" onchange="tdcSetComment('${tsaEsc(key)}',this.value)" placeholder="对该文献的评语（可选）" style="flex:1;min-width:160px;font-size:10px;padding:3px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      </div>
    </div>`;
  }).join('') : '<div style="font-size:11px;color:var(--text-3);padding:10px 0">学生尚未整理先行研究</div>';

  box.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:3px">📄 计划书 · 先行研究　—　${tsaEsc(studentName)}</div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">关键词与评语会同步显示给学生；学生自己的文献列表不会被覆盖</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      ${draft.draft_file_url ? `<a href="${draft.draft_file_url}" target="_blank" style="font-size:11px;background:var(--accent);color:#fff;border-radius:3px;padding:6px 14px;text-decoration:none">⬇ 下载完成稿</a>` : '<span style="font-size:11px;color:var(--text-3)">学生尚未上传完成稿</span>'}
      ${refs.length ? `<button onclick="tdcExportRefs('${tsaEsc(studentName)}')" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">⬇ 导出先行研究(CSV)</button>` : ''}
    </div>
    <div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px">
      ${tab('refs', '先行研究', refs.length)}
      ${tab('draft', '计划书全文')}
    </div>
    ${tdcTab === 'refs' ? refsHtml : `<div style="background:var(--bg);border-radius:3px;padding:12px;font-size:11px;color:var(--text-2);line-height:1.9;max-height:46vh;overflow-y:auto">${tDraftFullHtml(draft)}</div>`}
    <div class="form-group" style="margin-top:12px">
      <label class="form-label">整体批注（针对计划书）</label>
      <textarea id="tdc_comment" rows="3" placeholder="针对计划书内容的反馈和建议…">${tsaEsc(draft.teacher_comment || '')}</textarea>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="saveTeacherDraftComment('${draft.id}','${tdcStudentId}')" style="flex:1;background:var(--ok);color:#fff;border:none;border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">保存批注与标注</button>
      <button onclick="document.getElementById('teacherDraftCommentModal').remove()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:10px 14px;font-size:12px;cursor:pointer;font-family:inherit">关闭</button>
    </div>`;
}

function tdcToggleTag(key, tag, studentName) {
  const n = tdcNoteOf(key);
  n.tags = n.tags || [];
  const i = n.tags.indexOf(tag);
  if (i >= 0) n.tags.splice(i, 1); else n.tags.push(tag);
  tdcRender(studentName);
}
function tdcAddTag(key, idx, studentName) {
  const el = document.getElementById('tdc_newtag_' + idx);
  const v = el ? el.value.trim() : '';
  if (!v) return;
  const n = tdcNoteOf(key);
  n.tags = n.tags || [];
  if (!n.tags.includes(v)) n.tags.push(v);
  tdcRender(studentName);
}
function tdcSetComment(key, v) { tdcNoteOf(key).comment = v; }

// 先行研究导出 CSV（含老师标注），Excel 可直接打开
function tdcExportRefs(studentName) {
  const refs = tDraftRefs(tdcDraft);
  if (!refs.length) return;
  const cols = [...new Set(refs.flatMap(r => Object.keys(r)))];
  const head = [...cols.map(c => T_REF_LABELS[c] || c), '老师关键词', '老师评语'];
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = refs.map((r, i) => {
    const n = tdcNotes[tRefKey(r, i)] || {};
    return [...cols.map(c => r[c] || ''), (n.tags || []).join('、'), n.comment || ''].map(esc).join(',');
  });
  const csv = '\ufeff' + [head.map(esc).join(','), ...rows].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${studentName}_先行研究整理.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

async function saveTeacherDraftComment(draftId, studentId) {
  const comment = (document.getElementById('tdc_comment')?.value || '').trim();
  // 清掉空标注，避免存一堆空对象
  const notes = {};
  Object.entries(tdcNotes || {}).forEach(([k, v]) => {
    if (v && ((v.tags || []).length || (v.comment || '').trim() || (v.rating || '').trim())) notes[k] = v;
  });
  if (!comment && !Object.keys(notes).length) { alert('请填写批注内容，或为文献添加关键词/评语'); return; }
  try {
    const patch = {
      teacher_comment: comment, teacher_ref_notes: notes,
      teacher_comment_by: (typeof teacherName !== 'undefined' ? teacherName : null),
      teacher_comment_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await sb(`/rest/v1/student_plan_drafts?id=eq.${draftId}`, 'PATCH', patch);
    if (teacherProgressData.draftsMap?.[studentId]) {
      Object.assign(teacherProgressData.draftsMap[studentId], patch);
    }
    document.getElementById('teacherDraftCommentModal').remove();
    renderTeacherStudyProgress(document.getElementById('sm_content')||document.getElementById('mainContent'));
  } catch(e) { alert('保存失败：' + e.message); }
}

// ══════════════════════════════════
// 学生管理（需 admin 授予 student_mgmt 权限，子项由 student_mgmt_items 控制）
// 子项：progress 考学进度（沿用原页面，按老师负责的面谈学生显示）
//       records  出席・作业记录（按 student_majors 允许专业查看）
//       profile  学生档案录入（与 admin 学生档案同一张表实时同步；按 student_majors 允许专业查看）
// ══════════════════════════════════
let smTab = '';
const SM_ITEMS = [['progress','📊 考学进度'], ['meetings','💬 面谈查询'], ['records','🗒 出席・作业记录'], ['profile','👤 学生档案']];

function smAllowedItems() {
  const p = (teacherData && teacherData.permissions) || {};
  const items = (p.student_mgmt && Array.isArray(p.student_mgmt_items)) ? p.student_mgmt_items : [];
  const allowed = SM_ITEMS.filter(([k]) => items.includes(k));
  // 重点关注：汇总已有数据的另一种展示，只要有考学进度/学生档案/面谈任一权限就提供
  if (items.includes('progress') || items.includes('profile') || items.includes('meetings')) {
    allowed.push(['focus', '⭐ 重点关注']);
  }
  return allowed;
}

function renderStudentMgmt(mc) {
  const allowed = smAllowedItems();
  if (!allowed.length) { mc.innerHTML = '<div class="empty">未开通任何学生管理子项，请联系管理员</div>'; return; }
  if (!allowed.find(([k]) => k === smTab)) smTab = allowed[0][0];
  mc.innerHTML = `<div>
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
      ${allowed.map(([k, l]) => `<button onclick="smTab='${k}';renderStudentMgmt(document.getElementById('mainContent'))" style="font-size:11px;padding:5px 14px;border-radius:3px;cursor:pointer;font-family:inherit;border:1px solid ${smTab===k?'var(--accent)':'var(--border)'};background:${smTab===k?'var(--accent)':'var(--surface)'};color:${smTab===k?'#fff':'var(--text-2)'}">${l}</button>`).join('')}
    </div>
    <div id="sm_content"><div class="empty">加载中…</div></div>
  </div>`;
  const box = document.getElementById('sm_content');
  if (smTab === 'progress') renderTeacherStudyProgress(box);
  else if (smTab === 'records') renderTsaRecords(box);
  else if (smTab === 'meetings') renderTsaMeetings(box);
  else if (smTab === 'focus') renderTeacherFocus(box);
  else renderTeacherStudents(box);
}

// ── 共用：允许专业集合（三个子项统一使用；与面谈预约逻辑完全无关） ──
// 判定顺序：admin 显式勾选的 student_majors > 老师档案自身的 majors > 全部可见（兜底）
// admin 是否把此老师的学生管理限定为"仅保录学生"
function tsaGuaranteedLock() { return !!(teacherData && teacherData.permissions && teacherData.permissions.guaranteed_only); }
function tsaIsGuaranteed(s) { return ((s && s.course_type) || '').includes('保录'); }

function tsaAllowedSet() {
  const p = (teacherData && teacherData.permissions) || {};
  let allowed = (Array.isArray(p.student_majors) && p.student_majors.length)
    ? p.student_majors
    : (Array.isArray(teacherData && teacherData.majors) ? teacherData.majors : []);
  if (!allowed.length) return null;
  const set = new Set(allowed);
  if (set.has('shakai_group') && typeof SHAKAI_GROUP !== 'undefined') SHAKAI_GROUP.forEach(m => set.add(m));
  return set;
}

function tsaEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// ══ 子项1：学生档案（录入 + 查看） ══
let tsaStudents = [];
let tsaFormOpen = false;
let tsaExpandedId = null;
let tsaSearch = '';
let tsaMajorFilter = 'all';
let tsaGuaranteedOnly = false;  // 只看保录学生（course_type 含"保录"），与专业筛选平级

async function renderTeacherStudents(box) {
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const all = await sb('/rest/v1/students?select=*&order=created_at.desc&limit=2000');
    const set = tsaAllowedSet();
    tsaStudents = set ? (all || []).filter(s => set.has(s.major)) : (all || []);
    // admin 限定"仅保录"：数据层就只保留保录学生，彻底看不到其他学生
    if (teacherData && teacherData.permissions && teacherData.permissions.guaranteed_only) {
      tsaStudents = tsaStudents.filter(s => (s.course_type || '').includes('保录'));
      tsaGuaranteedOnly = true;
    }
  } catch (e) { box.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }
  tsaRender();
}

function tsaGenCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function tsaMajorOptions(sel) {
  const set = tsaAllowedSet();
  return Object.entries(MAJORS)
    .filter(([k]) => k !== 'shakai_group' && (!set || set.has(k)))
    .map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
}

function tsaListHtml() {
  const kw = tsaSearch.trim().toLowerCase();
  let list = tsaMajorFilter === 'all' ? tsaStudents : tsaStudents.filter(s => s.major === tsaMajorFilter);
  if (tsaGuaranteedOnly) list = list.filter(s => (s.course_type || '').includes('保录'));
  if (kw) list = list.filter(s => (s.name || '').toLowerCase().includes(kw) || (s.university || '').toLowerCase().includes(kw));
  const stLabel = v => ({ active:'在籍', graduated:'已合格', expired:'已到期', stopped:'停课', withdrawn:'退学' }[v] || v || '');
  return `<table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr style="background:var(--bg)">
      ${['姓名','专业','等级','日语','英语','目标入学','到期','状态'].map(h => `<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--text-3);border-bottom:1px solid var(--border)">${h}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${list.length ? list.map(s => `
      <tr onclick="tsaExpandedId=tsaExpandedId==='${s.id}'?null:'${s.id}';tsaRenderList()" style="cursor:pointer;border-bottom:1px solid var(--border)${tsaExpandedId === s.id ? ';background:var(--bg)' : ''}">
        <td style="padding:7px 8px;font-weight:600">${tsaEsc(s.name)}</td>
        <td style="padding:7px 8px">${MAJORS[s.major] || s.major || ''}</td>
        <td style="padding:7px 8px">${tsaEsc(s.level)}</td>
        <td style="padding:7px 8px">${tsaEsc(s.japanese_score)}</td>
        <td style="padding:7px 8px">${tsaEsc(s.english_score)}</td>
        <td style="padding:7px 8px">${tsaEsc(s.target_enrollment)}</td>
        <td style="padding:7px 8px">${tsaEsc(s.expiry_date)}</td>
        <td style="padding:7px 8px">${stLabel(s.status)}</td>
      </tr>
      ${tsaExpandedId === s.id ? `<tr><td colspan="8" style="padding:10px 14px;background:var(--bg);border-bottom:1px solid var(--border)">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 16px;font-size:11px">
          ${[['属性',s.student_type],['来源',s.source],['课程属性',s.course_type],['出身大学',s.university],['学部/专业',s.faculty],['GPA/履历',s.gpa],['毕业论文',s.thesis],['毕业时间',s.graduation_date],['赴日时间',s.japan_arrival],['报名时间',s.signup_date],['上课方式',s.default_mode==='offline'?'线下':'线上'],['查询码',s.student_code]].map(([l,v]) => `<div><span style="color:var(--text-3)">${l}：</span>${tsaEsc(v) || '—'}</div>`).join('')}
        </div>
        ${(teacherData.permissions.student_mgmt_items||[]).includes('profile_edit')?`<button onclick="event.stopPropagation();tseOpen('${s.id}')" style="margin-top:8px;font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">✏ 修改档案</button>`:''}
      </td></tr>` : ''}`).join('') : `<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--text-3)">暂无学生</td></tr>`}
    </tbody>
  </table>`;
}

function tsaRenderList() {
  const box = document.getElementById('tsa_list');
  if (box) box.innerHTML = tsaListHtml();
}

function tsaRender() {
  const mc = document.getElementById('sm_content') || document.getElementById('mainContent');
  const set = tsaAllowedSet();
  const inpStyle = 'width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const fld = (id, label, ctrl) => `<div><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">${label}</label>${ctrl}</div>`;
  const inp = (id, label, ph) => fld(id, label, `<input id="${id}" placeholder="${ph || ''}" style="${inpStyle}">`);

  mc.innerHTML = `<div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <div style="font-size:12px;font-weight:600">👤 学生档案（${tsaStudents.length}人）<span style="font-size:10px;font-weight:400;color:var(--text-3);margin-left:6px">${set ? '可见专业：' + [...set].map(m => MAJORS[m] || m).join('・') : '可见全部专业'}</span></div>
      ${(() => { const ms = [...new Set(tsaStudents.map(s => s.major).filter(Boolean))]; return ms.length > 1 ? `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;width:100%">
        <div class="filter-chip ${tsaMajorFilter==='all'?'active':''}" onclick="tsaMajorFilter='all';tsaRender()" style="padding:2px 9px;font-size:10px">全部</div>
        ${ms.map(m => `<div class="filter-chip ${tsaMajorFilter===m?'active':''}" onclick="tsaMajorFilter='${m}';tsaRender()" style="padding:2px 9px;font-size:10px">${MAJORS[m]||m}</div>`).join('')}
      </div>` : ''; })()}
      <div style="display:flex;gap:6px;align-items:center">
        ${(teacherData && teacherData.permissions && teacherData.permissions.guaranteed_only)
          ? `<div style="font-size:10px;padding:2px 10px;border-radius:12px;background:#8a5010;color:#fff;white-space:nowrap">🎓 仅保录学生（管理员限定）</div>`
          : `<div class="filter-chip ${tsaGuaranteedOnly?'active':''}" onclick="tsaGuaranteedOnly=!tsaGuaranteedOnly;tsaRender()" style="padding:2px 10px;font-size:10px;white-space:nowrap;${tsaGuaranteedOnly?'background:#8a5010;color:#fff;border-color:#8a5010':''}">🎓 只看保录</div>`}
        <input placeholder="搜索姓名/大学…" value="${tsaEsc(tsaSearch)}" oninput="tsaSearch=this.value;tsaRenderList()" style="font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;width:150px">
        <button onclick="tsaFormOpen=!tsaFormOpen;tsaRender()" style="font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">${tsaFormOpen ? '收起表单' : '＋ 添加学生'}</button>
      </div>
    </div>

    ${tsaFormOpen ? `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:600;margin-bottom:10px">添加学生（与 admin 学生档案同步，保存后自动生成查询码）</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:10px">
        ${inp('tsa_name', '姓名 *', '学生姓名')}
        ${fld('tsa_major', '专业 *', `<select id="tsa_major" style="${inpStyle}">${tsaMajorOptions('')}</select>`)}
        ${fld('tsa_type', '属性', `<select id="tsa_type" style="${inpStyle}"><option value="">请选择</option><option>本科</option><option>专科</option><option>专升本</option></select>`)}
        ${fld('tsa_source', '来源', `<select id="tsa_source" style="${inpStyle}"><option value="">请选择</option><option>唯新</option><option>新世界</option><option>校内塾</option><option>杭州校</option></select>`)}
        ${inp('tsa_course', '课程属性', '大课 / VIP / 保录…')}
        ${fld('tsa_level', '等级', `<select id="tsa_level" style="${inpStyle}"><option value="">请选择</option><option>A</option><option>B</option><option>C</option><option>D</option></select>`)}
        ${inp('tsa_japanese', '日语成绩', 'N1 120 / 备考…')}
        ${inp('tsa_english', '英语成绩', '托业 800 / 托福 90…')}
        ${inp('tsa_university', '出身大学', '')}
        ${inp('tsa_faculty', '学部 / 专业', '')}
        ${inp('tsa_gpa', 'GPA / 其他履历', '')}
        ${inp('tsa_thesis', '毕业论文方向', '论文题目或方向')}
        ${inp('tsa_graduation', '毕业时间', '25年6月')}
        ${inp('tsa_enrollment', '期待入学时间', '27年4月')}
        ${inp('tsa_arrival', '赴日时间', '26年7月')}
        ${inp('tsa_signup', '报名时间', '26年4月')}
        ${inp('tsa_expiry', '到期时间', '27年3月')}
        ${fld('tsa_mode', '默认上课方式', `<select id="tsa_mode" style="${inpStyle}"><option value="online">线上</option><option value="offline">线下</option></select>`)}
      </div>
      <button onclick="tsaSaveStudent()" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 18px;cursor:pointer;font-family:inherit">保存</button>
      <span id="tsa_save_msg" style="font-size:11px;margin-left:10px"></span>
    </div>` : ''}

    <div id="tsa_list" style="border:1px solid var(--border);border-radius:4px;overflow:hidden;overflow-x:auto">${tsaListHtml()}</div>
    <div style="font-size:9px;color:var(--text-3);margin-top:6px">数据与 admin 学生档案为同一数据库、实时同步；此处可录入与查看，修改或删除请联系 admin。</div>
  </div>`;
}

async function tsaSaveStudent() {
  const name = document.getElementById('tsa_name').value.trim();
  const major = document.getElementById('tsa_major').value;
  if (!name) { alert('请填写姓名'); return; }
  if (tsaStudents.find(s => s.name === name)) { if (!confirm(`已存在同名学生「${name}」，确定继续添加？`)) return; }
  const msg = document.getElementById('tsa_save_msg');
  if (msg) msg.textContent = '保存中…';
  const g = id => document.getElementById(id).value;
  const data = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name, major,
    student_type: g('tsa_type'), source: g('tsa_source'), course_type: g('tsa_course').trim(),
    level: g('tsa_level'), japanese_score: g('tsa_japanese').trim(), english_score: g('tsa_english').trim(),
    university: g('tsa_university').trim(), faculty: g('tsa_faculty').trim(), gpa: g('tsa_gpa').trim(),
    thesis: g('tsa_thesis').trim(), graduation_date: g('tsa_graduation').trim(),
    target_enrollment: g('tsa_enrollment').trim(), japan_arrival: g('tsa_arrival').trim(),
    signup_date: g('tsa_signup').trim(), expiry_date: g('tsa_expiry').trim(),
    default_mode: g('tsa_mode'), status: 'active',
    student_code: tsaGenCode(),
  };
  try {
    const res = await sb('/rest/v1/students', 'POST', data);
    tsaStudents.unshift(Array.isArray(res) ? res[0] : data);
    tsaFormOpen = false;
    tsaRender();
    alert(`已添加「${name}」\n查询码：${data.student_code}\n请转达学生，用于学习记录等页面登录。`);
  } catch (e) { if (msg) msg.textContent = ''; alert('保存失败：' + e.message); }
}

// ══ 子项2：出席・作业记录 ══
let tsrStudents = [];
let tsrSearch = '';
let tsrExpandedId = null;
let tsrRecCache = {};

async function renderTsaRecords(box) {
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const all = await sb('/rest/v1/students?select=id,name,major,level,status,course_type&order=name.asc&limit=2000');
    const set = tsaAllowedSet();
    tsrStudents = (set ? (all || []).filter(s => set.has(s.major)) : (all || [])).filter(s => !s.status || s.status === 'active');
    if (tsaGuaranteedLock()) tsrStudents = tsrStudents.filter(tsaIsGuaranteed);
  } catch (e) { box.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }
  tsrRender();
}

function tsrAtt(v) {
  if (!v) return { t:'缺席', c:'var(--danger,#b03a2e)' };
  return ({
    offline: { t:'线下出席', c:'var(--ok,#2a9e6a)' },
    online:  { t:'线上出席', c:'#2a6aad' },
    replay:  { t:'录播回看', c:'var(--warn,#b8860b)' },
    leave:   { t:'请假',     c:'var(--text-3,#999)' },
  })[v] || { t:v, c:'var(--text-2,#666)' };
}

function tsrRender() {
  const box = document.getElementById('sm_content');
  if (!box) return;
  const kw = tsrSearch.trim().toLowerCase();
  const list = kw ? tsrStudents.filter(s => (s.name || '').toLowerCase().includes(kw)) : tsrStudents;
  const set = tsaAllowedSet();

  box.innerHTML = `<div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <div style="font-size:12px;font-weight:600">🗒 出席・作业记录（在籍 ${list.length} 人）<span style="font-size:10px;font-weight:400;color:var(--text-3);margin-left:6px">${set ? '可见专业：' + [...set].map(m => MAJORS[m] || m).join('・') : '可见全部专业'}</span></div>
      <input placeholder="搜索学生姓名…" value="${tsaEsc(tsrSearch)}" oninput="tsrSearch=this.value;tsrRender()" style="font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;width:150px">
    </div>
    <div style="border:1px solid var(--border);border-radius:4px;overflow:hidden">
      ${list.length ? list.map(s => {
        const recs = tsrRecCache[s.id];
        let sum = '';
        if (recs) {
          const present = recs.filter(r => ['offline','online','replay'].includes(r.attendance_status)).length;
          const leave = recs.filter(r => r.attendance_status === 'leave').length;
          const hw = recs.filter(r => r.homework_submitted || r.homework_file_url).length;
          sum = recs.length
            ? `共 ${recs.length} 课次 · 出席 ${present} · 请假 ${leave} · 缺席 ${recs.length - present - leave} · 作业已交 ${hw}`
            : '暂无记录';
        }
        return `<div>
        <div onclick="tsrToggle('${s.id}')" style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);${tsrExpandedId === s.id ? 'background:var(--bg)' : ''}">
          <span style="font-size:12px;font-weight:600">${tsaEsc(s.name)}</span>
          <span style="font-size:10px;color:var(--text-3)">${MAJORS[s.major] || s.major || ''}${s.level ? ' · ' + s.level : ''}</span>
          <span style="font-size:10px;color:var(--text-2);margin-left:auto">${sum || '点击查看记录'}</span>
          <span style="font-size:10px;color:var(--text-3)">${tsrExpandedId === s.id ? '▲' : '▼'}</span>
        </div>
        ${tsrExpandedId === s.id ? `<div style="padding:8px 12px;background:var(--bg);border-bottom:1px solid var(--border)">
          ${!recs ? '<div style="font-size:11px;color:var(--text-3);padding:6px">加载中…</div>' : !recs.length ? '<div style="font-size:11px;color:var(--text-3);padding:6px">暂无出席・作业记录</div>' : `
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr>${['日期','课程','出席','作业'].map(h => `<th style="padding:4px 8px;text-align:left;font-weight:600;color:var(--text-3);border-bottom:1px solid var(--border)">${h}</th>`).join('')}</tr></thead>
            <tbody>${recs.map(r => {
              const a = tsrAtt(r.attendance_status);
              const hw = (r.homework_submitted || r.homework_file_url)
                ? (r.homework_file_url ? `<a href="${r.homework_file_url}" target="_blank" onclick="event.stopPropagation()" style="color:var(--accent)">✓ 已交（查看）</a>` : '<span style="color:var(--ok,#2a9e6a)">✓ 已交</span>')
                : '<span style="color:var(--text-3)">—</span>';
              return `<tr style="border-bottom:1px solid var(--border)">
                <td style="padding:5px 8px;white-space:nowrap">${r.session_date || ''}</td>
                <td style="padding:5px 8px">${tsaEsc(r.course_name || '')}</td>
                <td style="padding:5px 8px;color:${a.c}">${a.t}</td>
                <td style="padding:5px 8px">${hw}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>`}
        </div>` : ''}
      </div>`;
      }).join('') : '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:11px">暂无学生</div>'}
    </div>
  </div>`;
}

async function tsrToggle(id) {
  tsrExpandedId = tsrExpandedId === id ? null : id;
  tsrRender();
  if (tsrExpandedId !== id || tsrRecCache[id]) return;
  const s = tsrStudents.find(x => x.id === id);
  if (!s) return;
  try {
    const recs = await sb(`/rest/v1/session_records?student_name=eq.${encodeURIComponent(s.name)}&select=*&order=session_date.desc&limit=200`).catch(() => []);
    // 补课程名（通过 session_id 查 course_sessions）
    const sids = [...new Set(recs.map(r => r.session_id).filter(Boolean))];
    const sesMap = {};
    for (let i = 0; i < sids.length; i += 80) {
      const chunk = sids.slice(i, i + 80);
      const batch = await sb(`/rest/v1/course_sessions?id=in.(${chunk.map(x => `"${x}"`).join(',')})&select=id,course_name`).catch(() => []);
      (batch || []).forEach(cs => sesMap[cs.id] = cs);
    }
    tsrRecCache[id] = recs.map(r => Object.assign({}, r, { course_name: r.course_name || (sesMap[r.session_id] && sesMap[r.session_id].course_name) || '' }));
  } catch (e) { tsrRecCache[id] = []; }
  if (tsrExpandedId === id) tsrRender();
}

// ══ 计划书内容渲染（供考学进度卡片与批注弹窗使用） ══
// 草稿字段标签（经济/经营/社会人文三套模板字段的并集）
const T_DRAFT_LABELS = {
  theme:'研究テーマ', field:'志望分野', data_source:'データ出処', data_type:'データ種類',
  prior_lit:'先行文献', hypothesis:'仮説', difference:'先行研究との違い',
  var_y:'被説明変数Y', var_x:'説明変数X', var_ctrl:'コントロール変数',
  model:'モデル', model_other:'その他', regression:'回帰式',
  background:'一、研究背景', prior:'二、先行研究', purpose:'三、研究目的',
  method:'四、研究方法', significance:'五、研究意義',
};
// 先行研究字段标签（两套整理格式的并集）
const T_REF_LABELS = {
  keyword:'キーワード', title:'題目/テーマ', author:'著者', year:'年', journal:'刊行物',
  data:'研究対象/データ', method:'研究方法', summary:'概要', awareness:'問題意識',
  conclusion:'結論', citation:'引用', evaluation:'評価', note:'備考',
};

function tDraftRefs(draft) { try { return draft && draft.prior_research_list ? JSON.parse(draft.prior_research_list) : []; } catch (e) { return []; } }
function tDraftFields(draft) { try { return draft && draft.draft_fields ? JSON.parse(draft.draft_fields) : {}; } catch (e) { return {}; } }
function tFieldVal(v) { return Array.isArray(v) ? v.join('、') : (v == null ? '' : String(v)); }

// 卡片内摘要：先行研究条数 + 前几个已填字段
function tDraftSummaryHtml(draft) {
  const refs = tDraftRefs(draft);
  const filled = Object.entries(tDraftFields(draft)).filter(([k, v]) => tFieldVal(v).trim());
  const lines = [`<div style="font-size:11px;color:var(--text-2)">📚 先行研究：${refs.length ? `已整理 ${refs.length} 条` : '未整理'}</div>`];
  filled.slice(0, 3).forEach(([k, v]) => {
    const t = tFieldVal(v).replace(/\n/g, ' ');
    lines.push(`<div style="font-size:11px;color:var(--text-2)">${T_DRAFT_LABELS[k] || k}：${tsaEsc(t.length > 26 ? t.slice(0, 26) + '…' : t)}</div>`);
  });
  if (!filled.length) {
    if (draft.research_question) lines.push(`<div style="font-size:11px;color:var(--text-2)">问题：${tsaEsc(draft.research_question.slice(0, 40))}…</div>`);
    if (draft.methodology) lines.push(`<div style="font-size:11px;color:var(--text-2)">方法：${tsaEsc(draft.methodology.slice(0, 30))}…</div>`);
  }
  if (filled.length > 3) lines.push(`<div style="font-size:10px;color:var(--text-3)">…共 ${filled.length} 项已填，点击下方查看全文</div>`);
  return lines.join('');
}

// 弹窗内全文：先行研究逐条 + 草稿字段逐项 + 旧字段兼容
function tDraftFullHtml(draft) {
  const refs = tDraftRefs(draft);
  const filled = Object.entries(tDraftFields(draft)).filter(([k, v]) => tFieldVal(v).trim());
  let h = '';
  if (refs.length) {
    h += `<div style="font-weight:600;margin-bottom:4px">📚 先行研究（${refs.length}条）</div>`;
    h += refs.map((r, i) => {
      const parts = Object.entries(r).filter(([k, v]) => v).map(([k, v]) => `<span style="color:var(--text-3)">${T_REF_LABELS[k] || k}：</span>${tsaEsc(v)}`).join('　');
      return `<div style="margin-bottom:5px;padding-bottom:5px;border-bottom:1px dashed var(--border)">${i + 1}. ${parts}</div>`;
    }).join('');
  }
  if (filled.length) {
    h += `<div style="font-weight:600;margin:8px 0 4px">📄 计划书草稿</div>`;
    h += filled.map(([k, v]) => `<div style="margin-bottom:5px"><span style="color:var(--text-3)">${T_DRAFT_LABELS[k] || k}：</span>${tsaEsc(tFieldVal(v)).replace(/\n/g, '<br>')}</div>`).join('');
  }
  if (draft.research_question) h += `<div style="margin-bottom:4px"><span style="color:var(--text-3)">问题意识：</span>${tsaEsc(draft.research_question)}</div>`;
  if (draft.methodology) h += `<div style="margin-bottom:4px"><span style="color:var(--text-3)">研究方法：</span>${tsaEsc(draft.methodology)}</div>`;
  if (draft.draft_notes) h += `<div style="margin-bottom:4px"><span style="color:var(--text-3)">进展说明：</span>${tsaEsc(draft.draft_notes)}</div>`;
  return h || '<div style="color:var(--text-3)">暂无填写内容</div>';
}

// ══════════════════════════════════
// 面谈查询（学生管理子项 meetings）
// 已完成面谈的完整文字记录 + 历史；查询逻辑与考学进度一致（汉字/拼音首字母 + 专业 + 来源）
// ══════════════════════════════════
let tmSearch = '';
let tmView = 'has'; // has=有面谈记录 | none=无面谈记录（发提醒用）| contacted=已联系确认
let tmContactByName = {}; // 学生姓名 → 联系确认记录[]
let tmMajorFilter = '';
let tmSourceFilter = '';
let tmExpandedName = null;
let tmData = null; // { groups: [{name, major, source, list:[booking...]}] }

async function renderTsaMeetings(box) {
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const set = tsaAllowedSet();
    const [allStu, allBk, allContact] = await Promise.all([
      sb('/rest/v1/students?select=id,name,major,source,status,course_type&limit=2000').catch(() => []),
      sb('/rest/v1/bookings?daily_record=not.is.null&select=*&order=slot_date.desc&limit=1500').catch(() => []),
      sb('/rest/v1/student_contact_logs?select=*&order=created_at.desc&limit=3000').catch(() => []),
    ]);
    tmContactByName = {};
    (allContact || []).forEach(c => { (tmContactByName[c.student_name] = tmContactByName[c.student_name] || []).push(c); });
    const stuByName = {};
    (allStu || []).forEach(s => { if (!stuByName[s.name]) stuByName[s.name] = s; });
    // 只保留填写过记录内容的面谈（不限定预约状态，批量同步的历史记录同样纳入），专业按学生档案（无档案时按预约的 major 字段）过滤
    const withRec = (allBk || []).filter(b => b.daily_record && Object.values(b.daily_record).some(v => v && (typeof v === 'string' ? v : Object.values(v).some(x => x))));
    const groups = {};
    withRec.forEach(b => {
      const stu = stuByName[b.name];
      const major = (stu && stu.major) || b.major || '';
      if (set && !set.has(major)) return;
      if (tsaGuaranteedLock() && !tsaIsGuaranteed(stu)) return;
      if (!groups[b.name]) groups[b.name] = { name: b.name, major, source: (stu && stu.source) || '', list: [] };
      groups[b.name].list.push(b);
    });
    let myStudents = (allStu || []).filter(s => (!set || set.has(s.major)) && (!s.status || s.status === 'active'));
    if (tsaGuaranteedLock()) myStudents = myStudents.filter(tsaIsGuaranteed);
    tmData = {
      groups: Object.values(groups).sort((a, b) => (b.list[0].slot_date || '').localeCompare(a.list[0].slot_date || '')),
      students: myStudents,
    };
  } catch (e) { box.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }
  tmRenderShell();
}

function tmRenderShell() {
  const box = document.getElementById('sm_content');
  if (!box || !tmData) return;
  box.innerHTML = `
  <div class="page-header">
    <div class="section-title">面谈查询 <span class="badge-count" id="tm_count"></span></div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px">
    <span style="font-size:10px;color:var(--text-3)">显示：</span>
    <div class="filter-chip ${tmView==='has'?'active':''}" onclick="tmSetView('has')" style="padding:3px 10px;font-size:10px">有面谈记录</div>
    <div class="filter-chip ${tmView==='none'?'active':''}" onclick="tmSetView('none')" style="padding:3px 10px;font-size:10px">⚠ 无面谈记录</div>
    <div class="filter-chip ${tmView==='contacted'?'active':''}" onclick="tmSetView('contacted')" style="padding:3px 10px;font-size:10px;${tmView==='contacted'?'background:#1a6d3a;color:#fff;border-color:#1a6d3a':''}">✓ 已联系确认</div>
    ${tmView==='none' ? `<button onclick="tmBatchReminder()" style="font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:4px 12px;cursor:pointer;font-family:inherit;margin-left:auto">✉ 按专业批量生成提醒</button>` : `<button onclick="tmContactModal('','','')" style="font-size:10px;background:#1a6d3a;color:#fff;border:none;border-radius:2px;padding:4px 12px;cursor:pointer;font-family:inherit;margin-left:auto">＋ 补充记录（手输姓名）</button>`}
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px">
    <span style="font-size:10px;color:var(--text-3)">专业：</span>${tpMajorChipsHtml(tmMajorFilter, 'tmSetMajor')}
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">
    <span style="font-size:10px;color:var(--text-3)">来源：</span>${tpSourceChipsHtml(tmSourceFilter, 'tmSetSource')}
  </div>
  <div class="search-bar" style="margin-bottom:10px">
    <input placeholder="搜索学生姓名（汉字 / 拼音首字母）或来源…" value="${tsaEsc(tmSearch)}"
      oninput="tmSearch=this.value;tmRenderList()">
  </div>
  <div id="tm_list"></div>`;
  tmRenderList();
}

function tmSetMajor(v) { tmMajorFilter = v; tmRenderShell(); }
function tmSetView(v) { tmView = v; tmRenderShell(); }

// 当前筛选条件下「没有任何面谈记录、且没有联系确认记录」的在籍学生（真正被忽略的）
function tmNoRecStudents() {
  const recNames = new Set(tmData.groups.map(g => g.name));
  const q = tmSearch.trim();
  return (tmData.students || []).filter(s => !recNames.has(s.name)
    && !(tmContactByName[s.name] && tmContactByName[s.name].length)
    && tpMajorMatch(s.major, tmMajorFilter)
    && (!tmSourceFilter || (s.source || '') === tmSourceFilter)
    && (!q || tpNameMatch(s.name, q) || (s.source || '').includes(q)));
}

// 无面谈、但已有联系确认记录的学生
function tmContactedStudents() {
  const recNames = new Set(tmData.groups.map(g => g.name));
  const q = tmSearch.trim();
  return (tmData.students || []).filter(s => !recNames.has(s.name)
    && (tmContactByName[s.name] && tmContactByName[s.name].length)
    && tpMajorMatch(s.major, tmMajorFilter)
    && (!tmSourceFilter || (s.source || '') === tmSourceFilter)
    && (!q || tpNameMatch(s.name, q) || (s.source || '').includes(q)));
}
function tmSetSource(v) { tmSourceFilter = v; tmRenderShell(); }
function tmToggle(name) { tmExpandedName = tmExpandedName === name ? null : name; tmRenderList(); }

function tmRenderList() {
  const listBox = document.getElementById('tm_list');
  if (!listBox || !tmData) return;

  // 无面谈记录视图：真正被忽略的学生（无面谈+无联系记录），可发提醒 或 记录已联系
  if (tmView === 'none') {
    const noRec = tmNoRecStudents();
    const cnt0 = document.getElementById('tm_count');
    if (cnt0) cnt0.textContent = noRec.length;
    listBox.innerHTML = noRec.length ? noRec.map(s => `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surface);border:1px dashed var(--border);border-radius:4px;padding:10px 14px;margin-bottom:8px">
      <span style="font-size:13px;font-weight:600">${tsaEsc(s.name)}</span>
      <span style="font-size:11px;color:var(--text-3)">${MAJORS[s.major]||s.major||''}</span>
      ${s.source?`<span style="font-size:10px;color:var(--accent);border:1px solid var(--border);border-radius:2px;padding:0 5px">${tsaEsc(s.source)}</span>`:''}
      <span style="font-size:11px;color:var(--warn,#b8860b)">⚠ 近期没有预约面谈</span>
      <button onclick="tmContactModal('${s.id||''}','${tsaEsc(s.name)}','${s.major||''}')" style="margin-left:auto;font-size:10px;background:#1a6d3a;color:#fff;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit">✓ 记录已联系</button>
      <button onclick="tmGenReminder('${tsaEsc(s.name)}','${s.major||''}')" style="font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit">✉ 生成提醒文字</button>
    </div>`).join('') : '<div class="empty">当前筛选范围内的学生都已有面谈或联系记录 🎉</div>';
    return;
  }

  // 已联系确认视图：无面谈但已记录联系的学生 + 备注/截图
  if (tmView === 'contacted') {
    const list = tmContactedStudents();
    const cnt1 = document.getElementById('tm_count');
    if (cnt1) cnt1.textContent = list.length;
    listBox.innerHTML = list.length ? list.map(s => {
      const logs = (tmContactByName[s.name] || []);
      const logHtml = logs.map(l => `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid var(--border-light)">
        ${l.image_url ? `<img src="${l.image_url}" onclick="tmImgLightbox('${l.image_url}')" style="flex-shrink:0;width:52px;height:52px;object-fit:cover;border-radius:4px;border:1px solid var(--border);cursor:zoom-in">` : ''}
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;color:var(--text-1);white-space:pre-wrap;line-height:1.5">${tsaEsc(l.note)||'（无备注）'}</div>
          <div style="font-size:9px;color:var(--text-3);margin-top:3px">${(l.teacher_name||'')} · ${(l.created_at||'').slice(0,10)}</div>
        </div>
        <span onclick="tmDeleteContact('${l.id}')" style="flex-shrink:0;font-size:9px;color:var(--danger);cursor:pointer">删除</span>
      </div>`).join('');
      return `<div style="background:var(--surface);border:1px solid #cfe8d8;border-left:3px solid #1a6d3a;border-radius:4px;padding:10px 14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
          <span style="font-size:13px;font-weight:600">${tsaEsc(s.name)}</span>
          <span style="font-size:11px;color:var(--text-3)">${MAJORS[s.major]||s.major||''}</span>
          ${s.source?`<span style="font-size:10px;color:var(--accent);border:1px solid var(--border);border-radius:2px;padding:0 5px">${tsaEsc(s.source)}</span>`:''}
          <span style="font-size:10px;color:#1a6d3a">✓ 已联系 ${logs.length} 次</span>
          <button onclick="tmContactModal('${s.id||''}','${tsaEsc(s.name)}','${s.major||''}')" style="margin-left:auto;font-size:10px;background:#1a6d3a;color:#fff;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit">＋ 追加记录</button>
        </div>
        ${logHtml}
      </div>`;
    }).join('') : '<div class="empty">还没有"已联系确认"的记录。在「无面谈记录」里点某个学生的「✓ 记录已联系」即可。</div>';
    return;
  }

  let list = tmData.groups.filter(g => tpMajorMatch(g.major, tmMajorFilter));
  if (tmSourceFilter) list = list.filter(g => (g.source || '') === tmSourceFilter);
  const q = tmSearch.trim();
  if (q) list = list.filter(g => tpNameMatch(g.name, q) || (g.source || '').includes(q));
  // 搜索时：命中的「没有面谈记录」的在籍学生单独提示（默认页面不显示他们）
  let noRec = [];
  if (q) {
    const recNames = new Set(tmData.groups.map(g => g.name));
    noRec = (tmData.students || []).filter(s => !recNames.has(s.name)
      && tpMajorMatch(s.major, tmMajorFilter)
      && (!tmSourceFilter || (s.source || '') === tmSourceFilter)
      && (tpNameMatch(s.name, q) || (s.source || '').includes(q)));
  }
  const cnt = document.getElementById('tm_count');
  if (cnt) cnt.textContent = list.length;

  const noRecHtml = noRec.map(s => `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surface);border:1px dashed var(--border);border-radius:4px;padding:10px 14px;margin-bottom:8px">
    <span style="font-size:13px;font-weight:600">${tsaEsc(s.name)}</span>
    <span style="font-size:11px;color:var(--text-3)">${MAJORS[s.major]||s.major||''}</span>
    ${s.source?`<span style="font-size:10px;color:var(--accent);border:1px solid var(--border);border-radius:2px;padding:0 5px">${tsaEsc(s.source)}</span>`:''}
    <span style="font-size:11px;color:var(--warn,#b8860b)">⚠ 该学生近期没有预约面谈，可提醒学生预约面谈</span>
    <button onclick="tmGenReminder('${tsaEsc(s.name)}','${s.major||''}')" style="margin-left:auto;font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit">✉ 生成提醒文字</button>
  </div>`).join('');

  listBox.innerHTML = (list.length || noRec.length) ? (list.map(g => {
    const open = tmExpandedName === g.name;
    const lastDate = g.list[0].slot_date || '';
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden;margin-bottom:8px">
      <div onclick="tmToggle('${tsaEsc(g.name)}')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;${open?'background:var(--bg)':''}">
        <span style="font-size:13px;font-weight:600">${tsaEsc(g.name)}</span>
        <span style="font-size:11px;color:var(--text-3)">${MAJORS[g.major]||g.major||''}</span>
        ${g.source?`<span style="font-size:10px;color:var(--accent);border:1px solid var(--border);border-radius:2px;padding:0 5px">${tsaEsc(g.source)}</span>`:''}
        <span style="font-size:10px;color:var(--text-2);margin-left:auto">共 ${g.list.length} 次面谈 · 最近 ${lastDate}</span>
        <span style="font-size:10px;color:var(--text-3)">${open?'▲':'▼'}</span>
      </div>
      ${open ? `<div style="border-top:1px solid var(--border-light);background:var(--bg);padding:10px 14px">
        ${g.list.map(b => `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px;margin-bottom:8px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">📅 ${b.slot_date}${b.slot_time_range?' '+b.slot_time_range:''}${b.actual_duration?' · '+b.actual_duration+'min':''}${b.assigned_teacher?' · '+tsaEsc(b.assigned_teacher)+'老师':''}${b.type?' · '+(typeof typeLabel==='function'?typeLabel(b.type):b.type):''}</div>
          <pre style="font-size:11px;line-height:1.8;white-space:pre-wrap;font-family:inherit;margin:0;color:var(--text-2)">${tsaEsc(buildRecordText(b))}</pre>
        </div>`).join('')}
        ${tmContactBlockHtml(g.name, g.major, (tmData.students.find(s => s.name === g.name) || {}).id || '')}
      </div>` : ''}
    </div>`;
  }).join('') + noRecHtml) : '<div class="empty">没有符合筛选条件的面谈记录</div>';
}

// 批量提醒：把当前筛选下无面谈记录的学生按专业分组，每个专业一段通用文案（不带姓名）+ 对应预约链接
function tmBatchReminder() {
  const noRec = tmNoRecStudents();
  if (!noRec.length) { alert('当前筛选范围内没有「无面谈记录」的学生'); return; }
  const byMajor = {};
  noRec.forEach(s => { const m = s.major || ''; if (!byMajor[m]) byMajor[m] = []; byMajor[m].push(s.name); });
  const blocks = Object.entries(byMajor).map(([m, names], i) => {
    const link = `https://edsched.github.io/transform/student/index.html?major=${encodeURIComponent(m)}`;
    const text = `同学，你最近都一直没有预约面谈，学习上有什么问题吗？麻烦填写一下面谈预约噢。\n预约链接：${link}`;
    return `<div style="border:1px solid var(--border-light);border-radius:4px;padding:12px;margin-bottom:10px">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px">${MAJORS[m]||m||'未设专业'}（${names.length}人未面谈）</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">${names.map(n=>tsaEsc(n)).join('、')}</div>
      <textarea id="tmb_${i}" rows="3" style="width:100%;font-size:12px;line-height:1.8;padding:8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit;resize:vertical">${tsaEsc(text)}</textarea>
      <button onclick="navigator.clipboard.writeText(document.getElementById('tmb_${i}').value).then(()=>{this.textContent='✓ 已复制';setTimeout(()=>this.textContent='📋 复制这段',2000)})" style="margin-top:6px;font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:5px 12px;cursor:pointer;font-family:inherit">📋 复制这段</button>
    </div>`;
  }).join('');
  const existing = document.getElementById('tmBatchModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'tmBatchModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:560px;width:100%;max-height:85vh;display:flex;flex-direction:column">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">✉ 批量面谈提醒（共 ${noRec.length} 人未面谈）</div>
    <div style="overflow-y:auto;flex:1">${blocks}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:8px">
      <button onclick="document.getElementById('tmBatchModal').remove()" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:8px 18px;cursor:pointer;font-family:inherit">关闭</button>
    </div>
  </div>`;
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
}

// 生成面谈提醒文字（含该学生专业对应的预约链接），弹窗显示并自动复制
function tmGenReminder(name, major) {
  const link = `https://edsched.github.io/transform/student/index.html?major=${encodeURIComponent(major || '')}`;
  const text = `${name}同学，你最近都一直没有预约面谈，学习上有什么问题吗？麻烦填写一下面谈预约噢。\n预约链接：${link}`;
  const existing = document.getElementById('tmReminderModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'tmReminderModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:460px;width:100%">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">✉ 面谈提醒 · ${tsaEsc(name)}</div>
    <textarea id="tmReminderText" rows="5" style="width:100%;font-size:12px;line-height:1.8;padding:10px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit;resize:vertical">${tsaEsc(text)}</textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button onclick="navigator.clipboard.writeText(document.getElementById('tmReminderText').value).then(()=>{this.textContent='✓ 已复制';setTimeout(()=>this.textContent='📋 复制',2000)})" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:8px 14px;cursor:pointer;font-family:inherit">📋 复制</button>
      <button onclick="document.getElementById('tmReminderModal').remove()" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:8px 18px;cursor:pointer;font-family:inherit">关闭</button>
    </div>
  </div>`;
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
  try { navigator.clipboard.writeText(text).catch(() => {}); } catch (e) {}
}

// ══ 志望校行内修改（老师端；与学生端同一张表即时同步） ══
async function tpPlanSet(planId, field, value, el) {
  try {
    await sb(`/rest/v1/student_school_plans?id=eq.${planId}`, 'PATCH', { [field]: value });
    Object.values(teacherProgressData.plansMap || {}).forEach(list => {
      const p = (list || []).find(x => x.id === planId);
      if (p) p[field] = value;
    });
    if (el && field === 'status') { const st = schoolStatusLabel(value); el.style.color = st.c; }
    if (el) { el.style.outline = '1px solid var(--ok)'; setTimeout(() => el.style.outline = '', 800); }
  } catch (e) { alert('保存失败：' + e.message); }
}

async function tpPlanFlag(planId, field, btn) {
  const next = btn.dataset.on !== '1';
  try {
    await sb(`/rest/v1/student_school_plans?id=eq.${planId}`, 'PATCH', { [field]: next });
    Object.values(teacherProgressData.plansMap || {}).forEach(list => {
      const p = (list || []).find(x => x.id === planId);
      if (p) p[field] = next;
    });
    btn.dataset.on = next ? '1' : '0';
    btn.textContent = next ? (field === 'kakomon_started' ? '✓ 已开始' : '✓ 已完成') : (field === 'kakomon_started' ? '未开始' : '未完成');
    btn.style.border = `1px solid ${next ? 'var(--ok)' : 'var(--border)'}`;
    btn.style.background = next ? 'var(--ok-bg)' : 'var(--bg)';
    btn.style.color = next ? 'var(--ok)' : 'var(--text-3)';
  } catch (e) { alert('保存失败：' + e.message); }
}

// ══ 老师评估记录（teacher_student_notes；学生端不读取此表） ══
const tpNotesCache = {};

async function tpNotesToggle(sid, sname, head) {
  const box = document.getElementById('tpnotes_' + sid);
  if (!box) return;
  const open = box.style.display === 'none';
  box.style.display = open ? 'block' : 'none';
  const arr = head.querySelector('.arr');
  if (arr) arr.textContent = open ? '▾' : '▸';
  if (open) {
    if (!tpNotesCache[sid]) {
      box.innerHTML = '<div style="font-size:10px;color:var(--text-3)">加载中…</div>';
      try {
        tpNotesCache[sid] = await sb(`/rest/v1/teacher_student_notes?student_id=eq.${sid}&select=*&order=created_at.desc`);
      } catch (e) { box.innerHTML = `<div style="font-size:10px;color:var(--danger)">加载失败：${e.message}</div>`; return; }
    }
    tpNotesRender(sid, sname);
  }
}

function tpNotesRender(sid, sname) {
  const box = document.getElementById('tpnotes_' + sid);
  if (!box) return;
  const notes = tpNotesCache[sid] || [];
  box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px">
    <textarea id="tpnote_input_${sid}" rows="2" placeholder="记录该学生的评估、注意事项、交接备注…（如：笔试水平待评估；临近出愿需主动跟进）" onclick="event.stopPropagation()"
      style="width:100%;font-size:11px;line-height:1.8;padding:7px 9px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical"></textarea>
    <button onclick="event.stopPropagation();tpNoteSave('${sid}','${tsaEsc(sname)}')" style="margin-top:5px;font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">保存记录</button>
    <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px">
      ${notes.length ? notes.map(n => `<div style="font-size:11px;border-top:1px dashed var(--border-light);padding-top:6px">
        <span style="color:var(--accent);font-weight:600">${tsaEsc(n.teacher_name)}</span>
        <span style="color:var(--text-3);font-size:9px;margin-left:6px">${(n.created_at || '').slice(0, 16).replace('T', ' ')}</span>
        ${n.teacher_name === teacherData.name ? `<span onclick="event.stopPropagation();tpNoteDel('${n.id}','${sid}','${tsaEsc(sname)}')" style="float:right;font-size:9px;color:var(--danger);cursor:pointer">删除</span>` : ''}
        <div style="color:var(--text-2);line-height:1.8;white-space:pre-wrap;margin-top:2px">${tsaEsc(n.content)}</div>
      </div>`).join('') : '<div style="font-size:10px;color:var(--text-3)">暂无记录</div>'}
    </div>
  </div>`;
}

async function tpNoteSave(sid, sname) {
  const ta = document.getElementById('tpnote_input_' + sid);
  const content = (ta ? ta.value : '').trim();
  if (!content) { alert('请填写记录内容'); return; }
  const row = { id: `tn-${Date.now()}-${Math.random().toString(36).slice(2,5)}`, student_id: sid, student_name: sname, teacher_name: teacherData.name, content };
  try {
    await sb('/rest/v1/teacher_student_notes', 'POST', row);
    row.created_at = new Date().toISOString();
    tpNotesCache[sid] = [row, ...(tpNotesCache[sid] || [])];
    tpNotesRender(sid, sname);
  } catch (e) { alert('保存失败：' + e.message); }
}

async function tpNoteDel(id, sid, sname) {
  if (!confirm('删除这条评估记录？')) return;
  try {
    await sb(`/rest/v1/teacher_student_notes?id=eq.${id}`, 'DELETE');
    tpNotesCache[sid] = (tpNotesCache[sid] || []).filter(n => n.id !== id);
    tpNotesRender(sid, sname);
  } catch (e) { alert('删除失败：' + e.message); }
}

// ══ 学生档案修改（需 admin 授予「档案修改」子项；修改留痕，admin 可恢复） ══
const TSE_FIELDS = [
  ['name','姓名','input'],['major','专业','major'],['level','等级','input'],
  ['japanese_score','日语成绩','input'],['english_score','英语成绩','input'],
  ['target_enrollment','目标入学','input'],['expiry_date','到期日(YYYY-MM-DD)','input'],
  ['status','状态','status'],['student_type','属性','input'],['source','来源','input'],
  ['course_type','课程属性','input'],['university','出身大学','input'],['faculty','学部/专业','input'],
  ['gpa','GPA/履历','input'],['thesis','毕业论文','input'],['graduation_date','毕业时间','input'],
  ['japan_arrival','赴日时间','input'],['signup_date','报名时间','input'],
];

function tseOpen(sid) {
  const s = tsaStudents.find(x => x.id === sid);
  if (!s) return;
  const existing = document.getElementById('tseModal');
  if (existing) existing.remove();
  const inp = 'width:100%;font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const ctrl = (k, type, v) => {
    if (type === 'major') return `<select id="tse_${k}" style="${inp}">${tsaMajorOptions(v)}</select>`;
    if (type === 'status') return `<select id="tse_${k}" style="${inp}">${[['active','在籍'],['graduated','已合格'],['expired','已到期'],['stopped','停课'],['withdrawn','退学']].map(([kk,vv])=>`<option value="${kk}" ${v===kk?'selected':''}>${vv}</option>`).join('')}</select>`;
    return `<input id="tse_${k}" value="${tsaEsc(v)}" style="${inp}">`;
  };
  const modal = document.createElement('div');
  modal.id = 'tseModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:640px;width:100%;max-height:88vh;overflow-y:auto">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">✏ 修改学生档案 — ${tsaEsc(s.name)}</div>
    <div style="font-size:10px;color:var(--warn,#b8860b);margin-bottom:12px">⚠ 修改将直接覆盖 admin 学生档案的数据，并留下修改记录（admin 可查看与恢复），请谨慎操作。</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:12px">
      ${TSE_FIELDS.map(([k,l,t]) => `<div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">${l}</label>${ctrl(k, t, s[k])}</div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('tseModal').remove()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 16px;cursor:pointer;font-family:inherit">取消</button>
      <button onclick="tseSave('${sid}')" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 20px;cursor:pointer;font-family:inherit">保存修改</button>
    </div>
  </div>`;
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
}

async function tseSave(sid) {
  const s = tsaStudents.find(x => x.id === sid);
  if (!s) return;
  const patch = {}, changes = {}, prev = {};
  TSE_FIELDS.forEach(([k]) => {
    const v = ((document.getElementById('tse_' + k) || {}).value || '').trim();
    const old = s[k] == null ? '' : String(s[k]);
    if (v !== old) { patch[k] = v; changes[k] = { from: old, to: v }; prev[k] = s[k]; }
  });
  if (!Object.keys(patch).length) { alert('没有任何修改'); return; }
  if (!confirm(`该修改将覆盖学生档案的数据（共 ${Object.keys(patch).length} 项变更），是否操作？`)) return;
  try {
    await sb(`/rest/v1/students?id=eq.${sid}`, 'PATCH', patch);
    await sb('/rest/v1/student_profile_edits', 'POST', {
      id: `spe-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      student_id: sid, student_name: s.name, teacher_name: teacherData.name,
      changes, prev,
    }).catch(() => {});
    Object.assign(s, patch);
    document.getElementById('tseModal')?.remove();
    tsaRender();
    alert('已保存，修改记录已同步给 admin');
  } catch (e) { alert('保存失败：' + e.message); }
}


// ── 老师端：考学进度里添加志望校（沿用 admin 的 student_school_plans 表与字段）──
function tpAddSchool(sid, sname, major) {
  const ex = document.getElementById('tpSchoolModal'); if (ex) ex.remove();
  const statusOpts = (typeof SCHOOL_STATUS_LABELS !== 'undefined')
    ? Object.entries(SCHOOL_STATUS_LABELS).filter(([k]) => k !== 'failed').map(([k, v]) => `<option value="${k}">${v.t}</option>`).join('')
    : '<option value="preparing">准备中</option>';
  const m = document.createElement('div');
  m.id = 'tpSchoolModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:18px;max-width:420px;width:100%;max-height:90vh;overflow-y:auto">
      <div style="font-size:13px;font-weight:600;margin-bottom:12px">＋ 添加志望校 — ${tsaEsc(sname)}</div>
      <div class="form-group"><label class="form-label">级别</label><select id="tps_level" style="font-size:12px;width:100%"><option value="1">1（冲刺）</option><option value="2" selected>2（适中）</option><option value="3">3（保底）</option></select></div>
      <div class="form-group"><label class="form-label">学校名 *</label><input id="tps_school" placeholder="如 東京大学" style="width:100%"></div>
      <div class="form-group"><label class="form-label">研究科 / 学部</label><input id="tps_faculty" placeholder="如 総合文化研究科" style="width:100%"></div>
      <div class="form-group"><label class="form-label">教授</label><input id="tps_prof" style="width:100%"></div>
      <div class="form-group"><label class="form-label">出愿期间</label><input id="tps_period" placeholder="如 2026/7" style="width:100%"></div>
      <div class="form-group"><label class="form-label">该校进度</label><select id="tps_status" style="font-size:12px;width:100%">${statusOpts}</select></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button onclick="document.getElementById('tpSchoolModal').remove()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">取消</button>
        <button onclick="tpSaveSchool('${sid}','${(sname || '').replace(/'/g, '')}','${major || ''}')" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 16px;cursor:pointer;font-family:inherit;font-weight:500">保存</button>
      </div>
    </div>`;
  document.body.appendChild(m);
}

async function tpSaveSchool(sid, sname, major) {
  const g = id => (document.getElementById(id) || {}).value || '';
  const school_name = g('tps_school').trim();
  if (!school_name) { alert('请填写学校名'); return; }
  const row = {
    id: `ssp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    student_id: sid, student_name: sname, major,
    school_name, faculty: g('tps_faculty').trim(), professor: g('tps_prof').trim(),
    level: parseInt(g('tps_level')) || 2, application_period: g('tps_period').trim(),
    status: g('tps_status') || 'preparing',
  };
  try {
    await sb('/rest/v1/student_school_plans', 'POST', row);
    document.getElementById('tpSchoolModal')?.remove();
    renderTeacherStudyProgress(document.getElementById('sm_content') || document.getElementById('mainContent'));
  } catch (e) { alert('保存失败：' + e.message); }
}


// ── 无面谈学生的"已联系确认"记录（备注 + 可选截图，支持 Ctrl+V 粘贴）──
let tmPendingImg = null; // 待上传的截图（已压缩）

async function tmCompressImg(file, maxSide, quality) {
  if (!/^image\//.test(file.type)) return file;
  if (file.size <= 300 * 1024) return file;
  try {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { bmp = await createImageBitmap(file); }
    const scale = Math.min(1, (maxSide || 1400) / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality || 0.8));
    if (!blob) return file;
    return new File([blob], 'shot.jpg', { type: 'image/jpeg' });
  } catch (e) { return file; }
}

function tmContactModal(sid, name, major) {
  tmPendingImg = null;
  const ex = document.getElementById('tmContactModal'); if (ex) ex.remove();
  const m = document.createElement('div');
  m.id = 'tmContactModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  const fixed = !!name;
  m.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:18px;max-width:440px;width:100%;max-height:90vh;overflow-y:auto">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">${name ? '补充记录 — ' + tsaEsc(name) : '补充学生记录'}</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:12px">记录该学生的情况或补充信息（例：已发提醒未回复、某些重点信息）。可直接 Ctrl+V 粘贴截图。</div>
      <div class="form-group">
        <label class="form-label">学生姓名</label>
        <input id="tm_contact_name" value="${tsaEsc(name) || ''}" placeholder="输入学生姓名（汉字）" ${fixed ? 'readonly' : ''} style="width:100%;font-size:12px;${fixed ? 'background:var(--bg);color:var(--text-2)' : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">备注 / 内容</label>
        <textarea id="tm_contact_note" rows="3" placeholder="如：已在微信发面谈提醒，学生未回复… / 该生近期状态…" onpaste="tmHandlePaste(event)" style="width:100%;font-size:12px"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">截图证据（可选，Ctrl+V 粘贴或选择文件）</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="file" id="tm_contact_file" accept="image/*" onchange="tmPickFile(event)" style="font-size:11px">
        </div>
        <div id="tm_contact_preview" style="margin-top:8px"></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
        <button onclick="document.getElementById('tmContactModal').remove()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">取消</button>
        <button id="tm_contact_save" onclick="tmSaveContact('${sid || ''}','${major || ''}')" style="font-size:12px;background:#1a6d3a;color:#fff;border:none;border-radius:3px;padding:7px 16px;cursor:pointer;font-family:inherit;font-weight:500">保存</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  setTimeout(() => { const t = document.getElementById('tm_contact_note'); if (t) t.focus(); }, 50);
}

async function tmHandlePaste(e) {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.type && it.type.indexOf('image') === 0) {
      e.preventDefault();
      const f = it.getAsFile();
      if (f) await tmSetImg(f);
      return;
    }
  }
}
async function tmPickFile(e) {
  const f = e.target.files && e.target.files[0];
  if (f) await tmSetImg(f);
}
async function tmSetImg(file) {
  tmPendingImg = await tmCompressImg(file);
  const prev = document.getElementById('tm_contact_preview');
  if (prev) {
    const url = URL.createObjectURL(tmPendingImg);
    prev.innerHTML = `<div style="display:inline-flex;align-items:center;gap:8px"><img src="${url}" style="max-width:160px;max-height:120px;border-radius:4px;border:1px solid var(--border)"><span onclick="tmPendingImg=null;document.getElementById('tm_contact_preview').innerHTML='';document.getElementById('tm_contact_file').value=''" style="font-size:10px;color:var(--danger);cursor:pointer">移除</span></div>`;
  }
}

async function tmSaveContact(sid, major) {
  const name = (document.getElementById('tm_contact_name').value || '').trim();
  const note = (document.getElementById('tm_contact_note').value || '').trim();
  if (!name) { alert('请填写学生姓名'); return; }
  if (!note && !tmPendingImg) { alert('请填写备注，或粘贴一张截图'); return; }
  // 手动输入姓名时，按姓名从已加载学生里补出 id/专业
  if (!sid || !major) {
    const st = (tmData.students || []).find(s => s.name === name);
    if (st) { sid = sid || st.id; major = major || st.major; }
  }
  const btn = document.getElementById('tm_contact_save');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  let imageUrl = '';
  try {
    if (tmPendingImg) {
      imageUrl = await sbUpload('teacher-files', `contact/${(sid || 'x')}-${Date.now()}.jpg`, tmPendingImg);
    }
    await sb('/rest/v1/student_contact_logs', 'POST', [{
      id: 'sclog-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      student_id: sid || null, student_name: name, major: major || '',
      teacher_name: (typeof teacherData !== 'undefined' && teacherData ? teacherData.name : '') || '',
      note, image_url: imageUrl || null,
    }]);
    document.getElementById('tmContactModal')?.remove();
    renderTsaMeetings(document.getElementById('sm_content') || document.getElementById('mainContent'));
  } catch (e) {
    alert('保存失败：' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}

async function tmDeleteContact(id) {
  if (!confirm('确认删除这条联系记录？')) return;
  try {
    await sb(`/rest/v1/student_contact_logs?id=eq.${id}`, 'DELETE');
    renderTsaMeetings(document.getElementById('sm_content') || document.getElementById('mainContent'));
  } catch (e) { alert('删除失败：' + e.message); }
}

// 页面内查看截图大图（点任意处或×关闭，不再开新标签页）
function tmImgLightbox(url) {
  const ex = document.getElementById('tmLightbox'); if (ex) ex.remove();
  const o = document.createElement('div');
  o.id = 'tmLightbox';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';
  o.onclick = () => o.remove();
  o.innerHTML = `<img src="${url}" style="max-width:92vw;max-height:88vh;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,.5)"><div style="position:absolute;top:14px;right:22px;color:#fff;font-size:30px;line-height:1;cursor:pointer">×</div>`;
  document.body.appendChild(o);
}


// ══════════════════════════════════════════════════════════
// 重点关注：按到期临近筛选 + 学生学习概要汇总（换一种展示方式）
// ══════════════════════════════════════════════════════════
let focusStudents = [];
let focusUrgency = 'all';   // all | half | q3 | near | expired
let focusSearch = '';

function focusParseDate(str) {
  if (!str) return null;
  const s = String(str).replace(/\s/g, '');
  let m = s.match(/(\d{4}|\d{2})[年\/\-\.](\d{1,2})/);
  if (m) { let y = parseInt(m[1]); if (y < 100) y += 2000; return new Date(y, parseInt(m[2]) - 1, 1); }
  m = s.match(/(20\d{2})/);
  if (m) return new Date(parseInt(m[1]), 3, 1);   // 只有年份→默认4月入学
  return null;
}
function focusMonthsUntil(str) {
  const d = focusParseDate(str); if (!d) return null;
  const now = new Date();
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
}
function focusBucket(months) {
  if (months == null) return null;
  if (months < 0) return 'expired';
  if (months <= 1) return 'near';
  if (months <= 3) return 'q3';
  if (months <= 6) return 'half';
  return 'far';
}
const FOCUS_URG = {
  expired: { t: '已过期', bg: '#fdecea', c: '#c0392b' },
  near: { t: '到期临近', bg: '#fbeee0', c: '#b8560b' },
  q3: { t: '三个月内', bg: '#fef5e0', c: '#8a6d10' },
  half: { t: '半年内', bg: '#eef5ea', c: '#4a7a2a' },
  far: { t: '远期', bg: '#eef1f5', c: '#5a6a7a' },
};

async function renderTeacherFocus(box) {
  box.innerHTML = '<div class="empty">加载中…</div>';
  const all = await sb('/rest/v1/students?select=*&order=created_at.desc&limit=2000').catch(() => []);
  const set = tsaAllowedSet();
  let list = (set ? (all || []).filter(s => set.has(s.major)) : (all || [])).filter(s => !s.status || s.status === 'active');
  if (tsaGuaranteedLock()) list = list.filter(tsaIsGuaranteed);
  focusStudents = list;
  focusRender();
}

function focusRender() {
  const box = document.getElementById('sm_content') || document.getElementById('mainContent');
  if (!box) return;
  const rows = focusStudents.map(s => { const months = focusMonthsUntil(s.expiry_date); return { s, months, bucket: focusBucket(months) }; });
  const q = focusSearch.trim();
  let filtered = rows.filter(r => {
    if (q) return tpNameMatch(r.s.name, q) || (r.s.university || '').includes(q);
    if (focusUrgency === 'all') return true;
    if (focusUrgency === 'expired') return r.bucket === 'expired';
    if (focusUrgency === 'near') return ['near', 'expired'].includes(r.bucket);
    if (focusUrgency === 'q3') return ['near', 'q3', 'expired'].includes(r.bucket);
    if (focusUrgency === 'half') return ['near', 'q3', 'half', 'expired'].includes(r.bucket);
    return true;
  });
  const ord = { expired: 0, near: 1, q3: 2, half: 3, far: 4 };
  filtered.sort((a, b) => ((ord[a.bucket] ?? 5) - (ord[b.bucket] ?? 5)) || ((a.months ?? 9999) - (b.months ?? 9999)));

  const chip = (k, l) => `<div class="filter-chip ${focusUrgency === k ? 'active' : ''}" onclick="focusUrgency='${k}';focusSearch='';focusRender()" style="padding:3px 10px;font-size:10px;cursor:pointer">${l}</div>`;
  const cards = filtered.length ? filtered.map(r => {
    const u = r.bucket ? FOCUS_URG[r.bucket] : null;
    const badge = u ? `<span style="font-size:10px;padding:1px 8px;border-radius:10px;background:${u.bg};color:${u.c};white-space:nowrap">${u.t}${r.months != null && r.months >= 0 ? '·' + r.months + '个月' : (r.months != null ? '·超' + (-r.months) + '月' : '')}</span>` : '<span style="font-size:10px;color:var(--text-3)">无到期时间</span>';
    return `<div onclick="focusOpenSummary('${r.s.id}')" style="cursor:pointer;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:10px 14px;margin-bottom:7px" onmouseover="this.style.borderColor='var(--text-2)'" onmouseout="this.style.borderColor='var(--border)'">
      <span style="font-size:13px;font-weight:600">${tsaEsc(r.s.name)}</span>
      <span style="font-size:11px;color:var(--text-3)">${MAJORS[r.s.major] || r.s.major || ''}</span>
      ${badge}
      <span style="font-size:10px;color:var(--text-3)">到期 ${tsaEsc(r.s.expiry_date) || '—'}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--accent)">查看概要 ›</span>
    </div>`;
  }).join('') : '<div class="empty">当前筛选下没有学生</div>';

  box.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      ${chip('all', '全部')}${chip('half', '半年内')}${chip('q3', '三个月内')}${chip('near', '临近')}${chip('expired', '已过期')}
      <input placeholder="搜索姓名查看概要…" value="${tsaEsc(focusSearch)}" oninput="focusSearch=this.value;focusRender()" style="margin-left:auto;font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;width:170px">
    </div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:8px">共 ${filtered.length} 人 · 点学生查看完整学习概要（可打印）。到期依据「到期时间」自动推算。</div>
    <div>${cards}</div>`;
}

async function focusOpenSummary(sid) {
  const s = focusStudents.find(x => x.id === sid);
  if (!s) return;
  if (!document.getElementById('focusPrintStyle')) {
    const st = document.createElement('style');
    st.id = 'focusPrintStyle';
    st.textContent = '@media print{body>*:not(#focusSummary){display:none!important}#focusSummary{position:static!important;background:#fff!important;padding:0!important;overflow:visible!important;display:block!important}#focusSummary .focus-noprint{display:none!important}#focusReport{box-shadow:none!important;max-width:none!important;padding:0!important}}';
    document.head.appendChild(st);
  }
  const ex = document.getElementById('focusSummary'); if (ex) ex.remove();
  const o = document.createElement('div');
  o.id = 'focusSummary';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto';
  o.innerHTML = '<div style="background:#fff;border-radius:8px;max-width:820px;width:100%;padding:28px;margin:auto"><div style="text-align:center;color:#888;padding:30px">加载概要中…</div></div>';
  document.body.appendChild(o);

  const enc = encodeURIComponent;
  const [timeline, plans, bks, contacts] = await Promise.all([
    sb(`/rest/v1/student_progress_timeline?student_id=eq.${sid}&select=*&order=created_at.asc`).catch(() => []),
    sb(`/rest/v1/student_school_plans?student_id=eq.${sid}&select=*&order=level.asc`).catch(() => []),
    sb(`/rest/v1/bookings?name=eq.${enc(s.name)}&daily_record=not.is.null&select=slot_date,daily_record,teacher_name&order=slot_date.desc&limit=200`).catch(() => []),
    sb(`/rest/v1/student_contact_logs?student_name=eq.${enc(s.name)}&select=*&order=created_at.desc`).catch(() => []),
  ]);

  const months = focusMonthsUntil(s.expiry_date);
  const u = focusBucket(months) ? FOCUS_URG[focusBucket(months)] : null;
  const kv = (k, v) => v ? `<div style="font-size:12px;padding:3px 0"><span style="color:#888;display:inline-block;width:78px">${k}</span>${tsaEsc(v)}</div>` : '';
  const lvl = { 1: '🔴 冲刺', 2: '🟡 匹配', 3: '🟢 保底' };

  // 志望校
  const schoolsHtml = plans.length ? plans.map(p => {
    const st = (typeof SCHOOL_STATUS_LABELS !== 'undefined' && SCHOOL_STATUS_LABELS[p.status]) ? SCHOOL_STATUS_LABELS[p.status].t : (p.status || '');
    return `<div style="font-size:12px;padding:5px 0;border-top:1px solid #eee"><span style="font-weight:600">${tsaEsc(p.school_name)}</span>${p.faculty ? ' · ' + tsaEsc(p.faculty) : ''}${p.professor ? ' · ' + tsaEsc(p.professor) : ''} <span style="color:#888">[${lvl[p.level] || p.level || ''}]</span> <span style="color:#2a6a9a">${st}</span>${p.application_period ? ' <span style="color:#888;font-size:11px">出愿 ' + tsaEsc(p.application_period) + '</span>' : ''}</div>`;
  }).join('') : '<div style="font-size:11px;color:#aaa">暂无志望校</div>';

  // 考学进度时间线
  const tlHtml = timeline.length ? timeline.map(t => {
    const d = (t.created_at || '').slice(0, 10);
    const bits = Object.entries(t).filter(([k, v]) => !['id', 'student_id', 'student_name', 'created_at', 'updated_at', 'major'].includes(k) && v && typeof v === 'string').map(([k, v]) => `${tsaEsc(v)}`);
    const note = t.note || t.summary || bits.join(' / ');
    return `<div style="font-size:12px;padding:5px 0;border-top:1px solid #eee"><span style="color:#2a6a9a;font-family:monospace">${d}</span> ${tsaEsc(note) || '（进度更新）'}</div>`;
  }).join('') : '<div style="font-size:11px;color:#aaa">暂无进度记录</div>';

  // 面谈记录
  const mtgHtml = bks.length ? bks.map(b => {
    let txt = '';
    const dr = b.daily_record;
    if (dr && typeof dr === 'object') txt = Object.values(dr).filter(v => typeof v === 'string' && v.trim()).join(' / ');
    return `<div style="font-size:12px;padding:5px 0;border-top:1px solid #eee"><span style="color:#2a6a9a;font-family:monospace">${b.slot_date || ''}</span> ${b.teacher_name ? '<span style="color:#888">' + tsaEsc(b.teacher_name) + '</span> ' : ''}${tsaEsc(txt.slice(0, 200))}</div>`;
  }).join('') : '<div style="font-size:11px;color:#aaa">暂无面谈记录</div>';

  // 联系记录
  const contactHtml = contacts.length ? contacts.map(c => `<div style="font-size:12px;padding:5px 0;border-top:1px solid #eee"><span style="color:#2a6a9a;font-family:monospace">${(c.created_at || '').slice(0, 10)}</span> ${tsaEsc(c.note) || ''}${c.image_url ? ' <span style="color:#1a6d3a">[有截图]</span>' : ''}</div>`).join('') : '';

  const sec = (title, html) => `<div style="margin-top:18px"><div style="font-size:12px;font-weight:600;color:#1a3a5a;border-bottom:2px solid #dbe4ec;padding-bottom:4px;margin-bottom:6px">${title}</div>${html}</div>`;

  o.innerHTML = `
  <div id="focusReport" style="background:#fff;border-radius:8px;max-width:820px;width:100%;padding:28px;margin:auto">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:2px solid #1a3a5a;padding-bottom:12px">
      <div>
        <div style="font-family:'Noto Serif SC',serif;font-size:20px;font-weight:600">${tsaEsc(s.name)}<span style="font-size:13px;color:#888;font-weight:400;margin-left:10px">${MAJORS[s.major] || s.major || ''}</span></div>
        <div style="font-size:12px;color:#666;margin-top:3px">到期 ${tsaEsc(s.expiry_date) || '—'}${s.target_enrollment?' · 入学目标 '+tsaEsc(s.target_enrollment):''} ${u ? `<span style="padding:1px 8px;border-radius:10px;background:${u.bg};color:${u.c};margin-left:6px">${u.t}${months != null && months >= 0 ? '·还有' + months + '个月' : ''}</span>` : ''}</div>
      </div>
      <div style="display:flex;gap:8px" class="focus-noprint">
        <button onclick="window.print()" style="font-size:12px;background:#1a3a5a;color:#fff;border:none;border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">🖨 打印 / 存PDF</button>
        <button onclick="document.getElementById('focusSummary').remove()" style="font-size:12px;background:none;border:1px solid #ccc;border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">关闭</button>
      </div>
    </div>

    ${sec('基本信息', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px">
      ${kv('等级', lvl[s.level] || s.level)}${kv('属性', s.course_type)}
      ${kv('出身大学', s.university)}${kv('GPA', s.gpa)}
      ${kv('毕业时间', s.graduation_date)}${kv('期待入学', s.target_enrollment)}
      ${kv('赴日', s.japan_arrival)}${kv('来源', s.source)}
      ${kv('VIP课时', s.vip_hours_total ? (s.vip_hours_used || 0) + '/' + s.vip_hours_total : '')}${kv('研究方向', s.thesis)}
    </div>`)}

    ${sec('语言成绩', `<div style="display:flex;gap:24px;font-size:13px"><div><span style="color:#888">日语　</span>${tsaEsc(s.japanese_score) || '—'}</div><div><span style="color:#888">英语　</span>${tsaEsc(s.english_score) || '—'}</div></div>`)}

    ${sec('志望校', schoolsHtml)}
    ${sec('考学进度时间线', tlHtml)}
    ${sec('面谈记录（' + bks.length + '次）', mtgHtml)}
    ${contacts.length ? sec('联系确认记录', contactHtml) : ''}

    <div style="margin-top:20px;font-size:10px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:8px">唯新教育 · 学生学习概要 · 生成于 ${new Date().toLocaleDateString('zh-CN')}</div>
  </div>`;
}

// 学生名下的"补充记录"块（追加按钮 + 已有联系/补充记录）——用于「有面谈记录」展开处
function tmContactBlockHtml(name, major, sid) {
  const logs = tmContactByName[name] || [];
  const logHtml = logs.map(l => `<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-top:1px solid var(--border-light)">
    ${l.image_url ? `<img src="${l.image_url}" onclick="tmImgLightbox('${l.image_url}')" style="flex-shrink:0;width:44px;height:44px;object-fit:cover;border-radius:4px;border:1px solid var(--border);cursor:zoom-in">` : ''}
    <div style="flex:1;min-width:0"><div style="font-size:11px;white-space:pre-wrap;line-height:1.5">${tsaEsc(l.note) || '（无备注）'}</div><div style="font-size:9px;color:var(--text-3);margin-top:2px">${l.teacher_name || ''} · ${(l.created_at || '').slice(0, 10)}</div></div>
    <span onclick="tmDeleteContact('${l.id}')" style="flex-shrink:0;font-size:9px;color:var(--danger);cursor:pointer">删除</span>
  </div>`).join('');
  return `<div style="border-top:1px dashed var(--border);margin-top:2px;padding-top:8px">
    <div style="display:flex;align-items:center;gap:8px;${logs.length ? 'margin-bottom:4px' : ''}">
      <span style="font-size:10px;color:#1a6d3a;font-weight:600">📝 补充记录${logs.length ? '（' + logs.length + '）' : ''}</span>
      <button onclick="tmContactModal('${sid}','${tsaEsc(name)}','${major || ''}')" style="margin-left:auto;font-size:10px;background:#1a6d3a;color:#fff;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit">＋ 追加记录</button>
    </div>
    ${logHtml}
  </div>`;
}
