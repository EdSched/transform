// ══════════════════════════════════
// shared/progress-card.js — 考学进度卡片（管理端 admin/students.js、老师端 teacher/teacher-students.js 共用）
// 从上到下：标题行 → 节点进度 → 当前进度明细 → 志望校 → 计划书/志望理由书 → 出愿材料 → 保录学校 → 老师评估记录 → 进度时间线
// 每块同一框体、同一标题样式、同一内边距；两端只在 opts 里给不同的操作函数名（管理端多出编辑按钮）。
// 全局名字一律以 pgc / PGC_ 开头。
// 依赖：shared/constants.js（PROGRESS_*、getLatestProgress、schoolStatusLabel…）、riyu.js、materials.js、schoolplan.js
// ══════════════════════════════════

function pgcEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
// 放进 onclick='...' 里的字符串参数：去掉引号和反斜杠
function pgcJs(v) { return pgcEsc(String(v == null ? '' : v).replace(/['"\\\n]/g, '')); }

function pgcParseYear(str) {
  if (!str) return null;
  const m = String(str).match(/(20\d{2}|\d{2})\s*年?/);
  if (!m) return null;
  let y = parseInt(m[1]); if (y < 100) y += 2000;
  return (y < 2020 || y > 2100) ? null : y;
}

// 节点计算：各项目的「现状」和「距最晚节点还剩几个月」。返回 { route, items:[{label,cur,txt,color}] }
// ctx.riyuSubsMap：学部志望理由书的提交记录
function pgcNodes(s, latest, plans, draft, ctx) {
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const enrollY = pgcParseYear(s.target_enrollment);
  const manualRoute = s.prep_model === 'winter' ? 'winter' : s.prep_model === 'next_summer' ? 'next_summer' : (s.prep_model === 'summer' ? 'summer' : null);
  let route, examIdx;
  if (enrollY) {
    const baseY = enrollY - 1;
    const summerIdx = baseY * 12 + 7, winterIdx = (baseY + 1) * 12, nextSummerIdx = (baseY + 1) * 12 + 7;
    if (manualRoute) { route = manualRoute; examIdx = route === 'winter' ? winterIdx : route === 'next_summer' ? nextSummerIdx : summerIdx; }
    else {
      if (winterIdx < nowIdx) { route = 'summer'; examIdx = nextSummerIdx; }
      else if (now.getMonth() + 1 < 8 && summerIdx >= nowIdx) { route = 'summer'; examIdx = summerIdx; }
      else { route = 'winter'; examIdx = winterIdx; }
    }
  } else {
    route = manualRoute || 'summer';
    examIdx = now.getFullYear() * 12 + ((route === 'winter' ? 1 : 8) - 1);
    while (examIdx < nowIdx) examIdx += 12;
    if (route === 'next_summer') examIdx += 12;
  }
  s._computedRoute = route;
  // 各项目最晚节点偏移（次年路线：语言按冬季要求、草稿提前到12月）
  const DL = route === 'next_summer'
    ? { japanese: -7, english: -7, plan: -8, school: -3, apply: -1, kakomon: 0, exam: 0 }
    : { japanese: -1, english: -1, plan: -3, school: -2, apply: -1, kakomon: 0, exam: 0 };
  const ymStr = i => `${Math.floor(i / 12)}年${i % 12 + 1}月`;
  let refs = 0;
  try { refs = draft && draft.prior_research_list ? JSON.parse(draft.prior_research_list).length : 0; } catch (e) {}
  const draftUploaded = !!(draft && draft.draft_file_url);
  let draftFilled = false;
  try {
    const df1 = draft && draft.draft_fields ? JSON.parse(draft.draft_fields) : {};
    draftFilled = Object.values(df1).some(v => Array.isArray(v) ? v.length : String(v || '').trim());
  } catch (e) {}
  if (!draftFilled && draft) draftFilled = ['research_question', 'methodology', 'draft_notes'].some(f => String(draft[f] || '').trim());
  const dn = (k, v) => typeof PROGRESS_DONE !== 'undefined' && (PROGRESS_DONE[k] || []).includes(v);
  const jp = latest.japanese || '', en = latest.english || '', plan = latest.plan || '', apply = latest.apply || '', exam = latest.exam || '';
  const profOkN = plans.filter(p => ['prof_ok', 'applied', 'passed'].includes(p.status)).length;
  const contactedN = plans.filter(p => p.status === 'contacted').length;
  const appliedN = plans.filter(p => ['applied', 'passed'].includes(p.status)).length;
  const passedN = plans.filter(p => p.status === 'passed').length;
  const kakomonN = plans.filter(p => p.kakomon_started).length;
  const interviewN = plans.filter(p => p.interview_draft_done).length;
  const dlSuffix = route === 'next_summer' ? '（次年路线）' : '';
  const gakubu = (typeof isGakubuStudent === 'function') && isGakubuStudent(s);   // 学部：计划书节点 = 志望理由书
  const riyuC = (typeof riyuCounts === 'function') ? riyuCounts(plans, ((ctx && ctx.riyuSubsMap) || {})[s.id], 'gakubu_riyu') : { total: plans.length, submitted: 0, reviewed: 0 };
  const planItem = gakubu
    ? { label: '志望理由书', cur: riyuCountText(riyuC), done: riyuC.total > 0 && riyuC.reviewed >= riyuC.total, dl: DL.plan, dlName: '完成最晚' + dlSuffix }
    : { label: '研究计划书', cur: [plan || (draftUploaded ? '已完成' : draftFilled ? '撰写中' : refs ? '在收集材料' : '未填写'), refs ? `文献 ${refs} 条` : '', draftUploaded ? '📎 完成稿已上传' : ''].filter(Boolean).join(' · '), done: plan === '已完成' || draftUploaded, dl: DL.plan, dlName: '草稿完成最晚' + dlSuffix };
  const defs = [
    { label: '日语', cur: [jp || '未填写', s.japanese_score || ''].filter(Boolean).join(' · '), done: dn('japanese', jp), dl: DL.japanese, dlName: '成绩确定最晚' + dlSuffix },
    { label: '英语', cur: [en || '未填写', s.english_score || ''].filter(Boolean).join(' · '), done: dn('english', en), dl: DL.english, dlName: '成绩确定最晚' + dlSuffix },
    planItem,
    { label: '择校・联系教授', cur: (plans.length ? `已选 ${plans.length}/6 校` : '未选校') + (contactedN ? ` · 已发邮件 ${contactedN} 校` : '') + (profOkN ? ` · 教授OK ${profOkN} 校` : '') + (apply ? ' · ' + apply : ''), done: profOkN > 0, dl: DL.school, dlName: '锁定教授最晚' },
    { label: '出愿', cur: appliedN ? `已出愿 ${appliedN} 校` : (apply || '未开始'), done: appliedN > 0 || ['已出愿', '已合格'].includes(apply), dl: DL.apply, dlName: '出愿' },
    { label: '过去问・面试稿', cur: [(kakomonN ? `过去问已开始 ${kakomonN} 校` : ''), (interviewN ? `面试稿完成 ${interviewN} 校` : ''), exam || ''].filter(Boolean).join(' · ') || '未开始', done: dn('exam', exam), dl: DL.kakomon, dlName: '完成最晚' },
    { label: '大学院考试', cur: passedN ? `合格 ${passedN} 校` : apply === '已合格' ? '已合格' : appliedN ? `已出愿 ${appliedN} 校・待考试` : '—', done: passedN > 0 || apply === '已合格', dl: DL.exam, dlName: '考试' },
  ];
  const items = defs.map(it => {
    const dlIdx = examIdx + it.dl, left = dlIdx - nowIdx;
    let txt, color;
    if (it.done) { txt = it.label === '大学院考试' ? '已合格' : '✓ 已完成'; color = 'var(--ok,#2a9e6a)'; }
    else if (left > 1) { txt = `距${it.dlName}（${ymStr(dlIdx)}）还剩 ${left} 个月`; color = 'var(--text-2,#666)'; }
    else if (left === 1) { txt = `⚠ 距${it.dlName}仅剩 1 个月`; color = 'var(--warn,#b8860b)'; }
    else if (left === 0) { txt = `⚠ ${it.dlName}就在本月`; color = 'var(--danger,#b03a2e)'; }
    else { txt = `✗ 已超${it.dlName} ${-left} 个月`; color = 'var(--danger,#b03a2e)'; }
    return { label: it.label, cur: it.cur, txt, color };
  });
  return { route, items };
}

// 展开/收起整张卡片
function pgcToggle(id) {
  const el = document.getElementById('pgc_' + id);
  if (!el) return;
  const open = el.style.display === 'none';
  el.style.display = open ? 'block' : 'none';
  const hdr = el.previousElementSibling, arr = hdr && hdr.querySelector('.pgc-arr');
  if (arr) arr.textContent = open ? '▾' : '▸';
}
function pgcFold(btn, id) {
  const el = document.getElementById(id); if (!el) return;
  const open = el.style.display === 'none';
  el.style.display = open ? 'block' : 'none';
  const arr = btn.querySelector('.arr'); if (arr) arr.textContent = open ? '▾' : '▸';
}

function pgcEnsureCss() {
  if (document.getElementById('pgc_css')) return;
  const st = document.createElement('style'); st.id = 'pgc_css';
  st.textContent = `
.pgc-card{background:var(--surface);border:1px solid var(--border);border-radius:6px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.pgc-card.focus{border-color:var(--accent)}
.pgc-head{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer}
.pgc-head .who{flex:1;min-width:0;font-size:11px;color:var(--text-3)}
.pgc-head .who b{font-size:13px;color:var(--text)}
.pgc-head .who span{margin-left:8px}
.pgc-chips{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end;max-width:56%}
.pgc-chip{font-size:10px;padding:2px 9px;border-radius:10px;white-space:nowrap}
.pgc-body{border-top:1px solid var(--border-light);background:var(--bg)}
.pgc-stack{padding:14px;display:flex;flex-direction:column;gap:12px}
.pgc-sec{background:var(--surface);border:1px solid var(--border-light);border-radius:6px;padding:12px 14px;min-width:0}
.pgc-title{display:flex;align-items:center;gap:8px;min-height:24px;margin-bottom:10px;font-size:11px;font-weight:600;color:var(--text-2);letter-spacing:.02em}
.pgc-title .sub{font-weight:400;color:var(--text-3)}
.pgc-title .act{margin-left:auto;display:flex;gap:6px;align-items:center}
.pgc-fold{cursor:pointer;user-select:none}
.pgc-fold .arr{margin-left:4px;color:var(--text-3)}
.pgc-btn{font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;font-family:inherit;white-space:nowrap}
.pgc-btn.ghost{background:none;color:var(--text-2);border:1px solid var(--border)}
.pgc-node{display:grid;grid-template-columns:112px minmax(0,1fr) 250px;gap:10px;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--border-light);font-size:11px;line-height:1.6}
.pgc-node:last-child{border-bottom:none}
.pgc-node .nm{font-weight:600;white-space:nowrap}
.pgc-node .cur{color:var(--text-2);word-break:break-all}
.pgc-node .left{text-align:left}
.pgc-tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.pgc-tbl{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}
.pgc-tbl th{padding:6px 8px;text-align:left;font-weight:600;color:var(--text-3);border-bottom:1px solid var(--border);background:var(--bg);white-space:nowrap}
.pgc-tbl td{padding:6px 8px;border-bottom:1px solid var(--border-light);vertical-align:middle;word-break:break-word;overflow-wrap:anywhere}
.pgc-tbl.fixh td{height:40px}
.pgc-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.45}
.pgc-tl{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-light);font-size:11px}
.pgc-tl:last-child{border-bottom:none}
.pgc-tl .d{font-size:10px;color:var(--text-3)}
@media (max-width:640px){
  .pgc-head{flex-wrap:wrap}.pgc-chips{max-width:100%;justify-content:flex-start}
  .pgc-node{grid-template-columns:96px minmax(0,1fr)}.pgc-node .left{grid-column:1 / -1}
  .pgc-stack{padding:10px}
}
`;
  document.head.appendChild(st);
}

const PGC_SRC_LABEL = { student: '学生填写', teacher: '老师面谈', admin: 'admin录入', booking: '面谈记录' };

// 一张学生考学进度卡片
// ctx：{ timelineMap, plansMap, draftsMap, riyuSubsMap, matItems, matsMap, bkMap }
// o：{ mode:'admin'|'teacher', open:是否默认展开,
//      h:{ planSet, planFlag, schoolAdd, schoolEdit, schoolDel }  志望校操作的全局函数名
//      notesFn:'tpNotesToggle'|'spNotesToggle'（笔记容器 id 固定为 pgcnotes_<学生id>）
//      riyuChanged:(sub)=>void  志望理由书批复版上传后的回调
//      progressAdd:s=>js  timelineEdit:(entry,s)=>js  guaranteedEdit:true（保录学校可编辑）
//      passEntry:(p,s)=>html  合格志望校的额外按钮 }
function pgcCardHtml(s, ctx, o) {
  pgcEnsureCss();
  const timeline = (ctx.timelineMap || {})[s.id] || [];
  const latest = getLatestProgress(timeline);
  const plans = (ctx.plansMap || {})[s.id] || [];
  const draft = (ctx.draftsMap || {})[s.id];
  const subs = ((ctx.riyuSubsMap = ctx.riyuSubsMap || {})[s.id] = (ctx.riyuSubsMap[s.id] || []));
  const gakubu = (typeof isGakubuStudent === 'function') && isGakubuStudent(s);
  const nodes = pgcNodes(s, latest, plans, draft, ctx);
  const h = o.h || {};
  const sname = pgcJs(s.name);

  // ── 1. 标题行 ──
  const routeShort = (nodes.route === 'winter' ? '冬季路线' : nodes.route === 'next_summer' ? '次年夏季路线' : '夏季路线') + (!s.prep_model ? '（自动）' : '');
  const anyPassed = plans.some(p => p.status === 'passed');
  const anyApplied = plans.some(p => ['applied', 'passed'].includes(p.status));
  const applyDisplay = anyPassed ? '已合格' : (latest.apply || (anyApplied ? '已出愿' : ''));
  const chip = (icon, text, done) => `<span class="pgc-chip" style="background:${done ? 'var(--ok-bg,#e8f4ea)' : 'var(--bg,#f7f5f0)'};color:${done ? 'var(--ok,#2a5a30)' : 'var(--text-2,#5a5650)'};border:1px solid ${done ? 'var(--ok,#b8d8bc)' : 'var(--border-light,#ede9e2)'}">${icon} ${pgcEsc(text)}</span>`;
  const chips = Object.keys(PROGRESS_LABELS).map(k => {
    let val, done;
    if (k === 'apply') { val = applyDisplay; done = anyPassed || latest.apply === '已合格'; }
    else if (k === 'japanese') { val = latest[k] || (s.japanese_score ? '有成绩' : ''); done = isProgressDone(k, latest[k]); }
    else if (k === 'english') { val = latest[k] || (s.english_score ? '有成绩' : ''); done = isProgressDone(k, latest[k]); }
    else { val = latest[k]; done = isProgressDone(k, latest[k]); }
    if (!val) return '';
    const hint = k === 'japanese' && s.japanese_score ? ' · ' + s.japanese_score : k === 'english' && s.english_score ? ' · ' + s.english_score : '';
    return chip(PROGRESS_ICONS[k], val + hint, done);
  }).join('');
  const head = `<div class="pgc-head" onclick="pgcToggle('${pgcJs(s.id)}')">
    <div class="who"><b>${pgcEsc(s.name)}</b><span>${pgcEsc((typeof MAJORS !== 'undefined' && MAJORS[s.major]) || s.major || '')}</span>${s.target_enrollment ? `<span>入学目标 ${pgcEsc(s.target_enrollment)}</span>` : ''}<span>${routeShort}</span>${s.source ? `<span style="border:1px solid var(--border-light);border-radius:3px;padding:0 6px;font-size:10px">${pgcEsc(s.source)}</span>` : ''}</div>
    <div class="pgc-chips">${chips || '<span style="font-size:10px;color:var(--text-3)">暂无进度</span>'}</div>
    <span class="pgc-arr" style="font-size:11px;color:var(--text-3);flex-shrink:0">${o.open ? '▾' : '▸'}</span>
  </div>`;

  // ── 2. 节点进度（项目名｜现状｜距最晚节点，三列对齐）──
  const secNodes = `<div class="pgc-sec"><div class="pgc-title">节点进度 <span class="sub">· ${routeShort}${nodes.route === 'winter' ? '・12月出愿1月考试' : nodes.route === 'next_summer' ? '・语言按冬季要求・次年7月出愿8月考试' : '・7月出愿8月考试'}</span></div>
    ${nodes.items.map(it => `<div class="pgc-node"><span class="nm">${pgcEsc(it.label)}</span><span class="cur">${pgcEsc(it.cur)}</span><span class="left" style="color:${it.color}">${pgcEsc(it.txt)}</span></div>`).join('')}</div>`;

  // ── 3. 当前进度明细（项目 | 现状 | 数据来源 | 更新时间 | 详情）──
  const sortedTl = [...timeline].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const lastOf = k => { for (let i = sortedTl.length - 1; i >= 0; i--) if (sortedTl[i][k]) return sortedTl[i]; return null; };
  let refsN = 0, draftN = 0;
  try {
    refsN = draft && draft.prior_research_list ? JSON.parse(draft.prior_research_list).length : 0;
    const df0 = draft && draft.draft_fields ? JSON.parse(draft.draft_fields) : {};
    draftN = Object.entries(df0).filter(([k, v]) => k !== 'riyu' && (Array.isArray(v) ? v.length : String(v || '').trim())).length;
  } catch (e) {}
  const riyuC = riyuCounts(plans, subs, 'gakubu_riyu');
  const legacy = draft && ['research_question', 'methodology', 'draft_notes'].some(f => String(draft[f] || '').trim());
  // 时间线没有记录时，从志望校推进/计划书数据自动推导
  const derived = {};
  if (plans.some(p => p.status === 'passed')) derived.apply = '已合格';
  else if (plans.some(p => p.status === 'applied')) derived.apply = '已出愿';
  else if (plans.some(p => ['prof_ok', 'contacted'].includes(p.status))) derived.apply = '联系教授中';
  else if (plans.length) derived.apply = '择校确认中';
  if (plans.some(p => p.interview_draft_done)) derived.exam = '在准备面试稿';
  else if (plans.some(p => p.kakomon_started)) derived.exam = '在写过去问';
  if (gakubu) { if (riyuC.submitted > 0) derived.plan = riyuC.total && riyuC.reviewed >= riyuC.total ? '已完成' : '撰写中'; }
  else if (draft && draft.draft_file_url) derived.plan = '已完成';
  else if (draftN > 0 || legacy) derived.plan = '撰写中';
  else if (refsN > 0) derived.plan = '在收集材料';
  const detailOf = k => {
    if (k === 'plan') {
      const p = [];
      if (gakubu) { if (plans.length) p.push(riyuCountText(riyuC)); }
      else { if (refsN) p.push(`先行研究 ${refsN} 条`); if (draftN) p.push(`草稿已填 ${draftN} 项`); if (draft && draft.draft_file_url) p.push('完成稿已上传'); }
      return p.join(' · ');
    }
    if (k === 'apply') return plans.map(p => `${p.school_name || ''}${p.professor ? '・' + p.professor : ''}：${schoolStatusLabel(p.status).t}`).join('；');
    if (k === 'exam') return plans.filter(p => ['prof_ok', 'applied', 'passed'].includes(p.status)).map(p => `${p.school_name || ''}：过去问${p.kakomon_started ? '✓' : '—'} 面试稿${p.interview_draft_done ? '✓' : '—'}`).join('；');
    return '';
  };
  const detailRows = Object.keys(PROGRESS_LABELS).map(k => {
    const label = (gakubu && k === 'plan') ? '志望理由书' : PROGRESS_LABELS[k];
    const score = k === 'japanese' ? s.japanese_score : k === 'english' ? s.english_score : '';
    const le = lastOf(k);
    const src = latest[k] ? (PGC_SRC_LABEL[le && le.source] || (le && le.source) || '记录') : derived[k] ? '按填写推导' : '';
    const when = le ? (le.recorded_at || (le.created_at || '').slice(0, 10)) : '';
    const badge = latest[k] ? renderProgressBadge(k, latest[k]) : derived[k] ? renderProgressBadge(k, derived[k]) : '<span style="font-size:10px;color:var(--text-3)">未填写</span>';
    const det = [score, detailOf(k)].filter(Boolean).join(' · ');
    return `<tr><td style="font-weight:600;color:var(--text-2)">${PROGRESS_ICONS[k]} ${label}</td><td>${badge}</td><td style="font-size:10px;color:var(--text-3)">${src || '—'}</td><td style="font-size:10px;color:var(--text-3)">${pgcEsc(when) || '—'}</td><td><div class="pgc-clamp" title="${pgcEsc(det)}" style="color:var(--text-2)">${pgcEsc(det) || '—'}</div></td></tr>`;
  }).join('');
  const secDetail = `<div class="pgc-sec"><div class="pgc-title">当前进度明细${o.progressAdd ? `<span class="act"><button class="pgc-btn" onclick="event.stopPropagation();${o.progressAdd(s)}">＋ 更新进度</button></span>` : ''}</div>
    <div class="pgc-tbl-wrap"><table class="pgc-tbl fixh" style="min-width:560px"><colgroup><col style="width:104px"><col style="width:132px"><col style="width:84px"><col style="width:100px"><col></colgroup>
    <thead><tr><th>项目</th><th>现状</th><th>数据来源</th><th>更新时间</th><th>详情</th></tr></thead><tbody>${detailRows}</tbody></table></div></div>`;

  // ── 4. 志望校（No. | 级别 | 学校·研究科 | 教授 | 出愿期间 | 进度 | 过去问 | 面试稿 | 操作）──
  const flagBtn = (p, field, onTxt, offTxt) => {
    const on = !!p[field];
    return `<button onclick="event.stopPropagation();${h.planFlag}('${p.id}','${field}',this)" data-on="${on ? '1' : '0'}" style="font-size:10px;border-radius:3px;padding:3px 7px;cursor:pointer;font-family:inherit;white-space:nowrap;border:1px solid ${on ? 'var(--ok)' : 'var(--border)'};background:${on ? 'var(--ok-bg)' : 'var(--bg)'};color:${on ? 'var(--ok)' : 'var(--text-3)'}">${on ? onTxt : offTxt}</button>`;
  };
  const warn = (typeof spChosenWarnHtml === 'function') ? spChosenWarnHtml((ctx.bkMap || {})[s.id], plans.length, `${h.schoolAdd}('${pgcJs(s.id)}')`) : '';
  const schoolRows = plans.map((p, i) => {
    const st = schoolStatusLabel(p.status);
    return `<tr>
      <td style="color:var(--text-3)">${i + 1}</td>
      <td style="white-space:nowrap">${schoolLevelHtml(p.level)}</td>
      <td><span style="font-weight:600">${pgcEsc(p.school_name)}</span>${p.faculty ? `<span style="color:var(--text-3);margin-left:4px;font-size:10px">${pgcEsc(p.faculty)}</span>` : ''}</td>
      <td>${pgcEsc(p.professor) || '—'}</td>
      <td style="font-size:10px;color:var(--accent)">${pgcEsc(p.application_period) || '—'}</td>
      <td><select onchange="event.stopPropagation();${h.planSet}('${p.id}','status',this.value,this)" onclick="event.stopPropagation()" style="width:100%;font-size:10px;padding:3px 2px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit;color:${st.c};font-weight:600">
        ${Object.entries(SCHOOL_STATUS_LABELS).filter(([k]) => k !== 'failed' || p.status === 'failed').map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v.t}</option>`).join('')}</select></td>
      <td>${flagBtn(p, 'kakomon_started', '✓ 已开始', '未开始')}</td>
      <td>${flagBtn(p, 'interview_draft_done', '✓ 已完成', '未完成')}</td>
      <td style="white-space:nowrap"><span onclick="event.stopPropagation();${h.schoolEdit}('${p.id}')" style="font-size:10px;color:var(--accent);cursor:pointer;margin-right:6px">编辑</span><span onclick="event.stopPropagation();${h.schoolDel}('${p.id}')" style="font-size:10px;color:var(--danger);cursor:pointer">删除</span>${o.passEntry && p.status === 'passed' ? o.passEntry(p, s) : ''}</td>
    </tr>`;
  }).join('');
  const secSchools = `<div class="pgc-sec"><div class="pgc-title">志望校 <span class="sub">（${plans.length}所）· 状态/过去问/面试稿可直接改，即时与学生端同步</span><span class="act"><button class="pgc-btn" onclick="event.stopPropagation();${h.schoolAdd}('${pgcJs(s.id)}')">＋ 添加志望校</button></span></div>
    ${warn}${plans.length ? `<div class="pgc-tbl-wrap"><table class="pgc-tbl" style="min-width:820px"><colgroup><col style="width:36px"><col style="width:52px"><col><col style="width:90px"><col style="width:110px"><col style="width:150px"><col style="width:70px"><col style="width:70px"><col style="width:${o.passEntry ? 150 : 96}px"></colgroup>
    <thead><tr>${['No.', '级别', '学校 · 研究科', '教授', '出愿期间', '进度', '过去问', '面试稿', '操作'].map(t => `<th>${t}</th>`).join('')}</tr></thead><tbody>${schoolRows}</tbody></table></div>`
      : '<div style="font-size:11px;color:var(--text-3)">尚无志望校，点右上「＋ 添加志望校」录入</div>'}</div>`;

  // ── 5. 计划书 / 志望理由书 ──
  let planInner;
  if (gakubu) {
    planInner = riyuStaffListHtml(s, plans, subs, 'gakubu_riyu', o.riyuChanged || (() => {}))
      + (typeof openTeacherDraftComment === 'function' && draft ? `<button onclick="event.stopPropagation();openTeacherDraftComment('${pgcJs(s.id)}','${sname}')" class="pgc-btn ghost" style="margin-top:8px;display:block">整体评语・旧版草稿</button>` : '')
      + ((typeof riyuFilledCount === 'function' && riyuFilledCount(draft, plans)) && typeof openTeacherDraftComment !== 'function' ? `<details style="margin-top:6px;font-size:11px"><summary style="cursor:pointer;color:var(--text-3)">旧版草稿（参考）</summary>${renderRiyuView(draft, plans)}</details>` : '');
  } else if (draft) {
    planInner = (typeof tDraftSummaryHtml === 'function' ? tDraftSummaryHtml(draft)
      : `<div style="font-size:11px;color:var(--text-2)">先行研究：${refsN ? `已整理 ${refsN} 条` : '未整理'}；草稿已填 ${draftN} 项</div>`)
      + (draft.draft_file_url ? `<a href="${pgcEsc(draft.draft_file_url)}" target="_blank" style="font-size:10px;color:var(--accent);display:inline-block;margin-top:4px">📎 草稿文件</a>` : '')
      + (typeof openTeacherDraftComment === 'function' ? `<button onclick="event.stopPropagation();openTeacherDraftComment('${pgcJs(s.id)}','${sname}')" class="pgc-btn" style="margin-top:8px;display:block">查看・评估计划书/先行研究</button>` : '');
  } else planInner = '<div style="font-size:11px;color:var(--text-3)">学生尚未填写</div>';
  const secPlan = `<div class="pgc-sec"><div class="pgc-title">${gakubu ? '志望理由书' : '研究计划书'}${gakubu ? `<span class="sub">· ${pgcEsc(riyuCountText(riyuC))}</span>` : ''}</div>${planInner}</div>`;

  // ── 6. 出愿材料（卡片网格等宽，每行 4 张，窄屏 2 张）──
  const secMaterials = (typeof matStaffNodeHtml === 'function') ? (() => {
    const track = matTrackOf(s);
    const items = (ctx.matItems || []).filter(it => it.track === track);
    const mm = (ctx.matsMap = ctx.matsMap || {});
    return `<div class="pgc-sec"><div class="pgc-title">出愿材料</div>${matStaffNodeHtml(s, items, (mm[s.id] = mm[s.id] || []), plans, subs)}</div>`;
  })() : '';

  // ── 7. 保录学校（仅保录学生）──
  const guar = (s.course_type || '').includes('保录');
  const secGuar = guar ? `<div class="pgc-sec"><div class="pgc-title" style="color:#8a5010">保录学校<span class="sub">${o.guaranteedEdit ? '保录方案专用名单，独立于志望校' : ''}</span>${o.guaranteedEdit ? `<span class="act"><button class="pgc-btn" style="background:#8a5010" onclick="event.stopPropagation();gsAdd('${pgcJs(s.id)}')">＋ 添加保录学校</button></span>` : ''}</div>
    ${o.guaranteedEdit ? `<div id="gs_list_${pgcEsc(s.id)}">${gsRenderList(s.id)}</div>`
      : ((Array.isArray(s.guaranteed_schools) && s.guaranteed_schools.length)
        ? `<div style="display:flex;flex-direction:column;gap:5px">${s.guaranteed_schools.map(g => `<div style="font-size:11px;padding:6px 10px;border:1px solid #e8d9b8;border-radius:4px;background:#fdfaf5"><span style="font-weight:600">${pgcEsc(g.university)}</span>${g.program ? ` <span style="color:var(--text-3)">· ${pgcEsc(g.program)}</span>` : ''}</div>`).join('')}</div>`
        : '<div style="font-size:11px;color:var(--text-3)">尚无保录学校（可在管理端录入）</div>')}</div>` : '';

  // ── 8. 老师评估记录（折叠）──
  const secNotes = `<div class="pgc-sec"><div class="pgc-title pgc-fold" style="margin-bottom:0" onclick="event.stopPropagation();${o.notesFn}('${pgcJs(s.id)}','${sname}',this)">老师评估记录 <span class="sub">（学生不可见，仅老师与 admin）</span><span class="arr">▸</span></div>
    <div id="pgcnotes_${pgcEsc(s.id)}" style="display:none;margin-top:10px"></div></div>`;

  // ── 9. 进度时间线（折叠；左：日期+来源标签固定宽度，右：内容）──
  const tlHtml = timeline.length ? [...timeline].reverse().map(e => {
    const src = PROGRESS_SOURCE_LABEL[e.source] || PROGRESS_SOURCE_LABEL.admin;
    const dims = ['japanese', 'english', 'plan', 'apply', 'exam'].filter(k => e[k]);
    const edit = o.timelineEdit ? o.timelineEdit(e, s) : '';
    return `<div class="pgc-tl">
      <div><div class="d">${pgcEsc(e.recorded_at || (e.created_at || '').slice(0, 10))}</div><span style="font-size:10px;background:${src.bg};color:${src.color};padding:1px 6px;border-radius:2px;display:inline-block;margin-top:3px">${src.label}</span>${e.source_name ? `<div style="font-size:9px;color:var(--text-3);margin-top:2px">${pgcEsc(e.source_name)}</div>` : ''}</div>
      <div><div style="display:flex;flex-wrap:wrap;gap:4px 10px">${dims.map(k => `<div>${PROGRESS_ICONS[k]} ${PROGRESS_LABELS[k]}：${renderProgressBadge(k, e[k])}</div>`).join('')}</div>${e.notes ? `<div style="color:var(--text-2);margin-top:4px">💬 ${pgcEsc(e.notes)}</div>` : ''}</div>
      <div>${edit ? `<button onclick="event.stopPropagation();${edit}" class="pgc-btn ghost" style="color:var(--text-3)">编辑</button>` : ''}</div>
    </div>`;
  }).join('') : '<div style="font-size:11px;color:var(--text-3)">暂无记录</div>';
  const secTimeline = `<div class="pgc-sec"><div class="pgc-title pgc-fold" style="margin-bottom:0" onclick="event.stopPropagation();pgcFold(this,'pgctl_${pgcEsc(s.id)}')">进度时间线 <span class="sub">（${timeline.length}条）</span><span class="arr">▸</span></div>
    <div id="pgctl_${pgcEsc(s.id)}" style="display:none;margin-top:10px">${tlHtml}</div></div>`;

  return `<div class="pgc-card${o.focus ? ' focus' : ''}">${head}<div class="pgc-body" id="pgc_${pgcEsc(s.id)}" style="display:${o.open ? 'block' : 'none'}"><div class="pgc-stack">${secNodes}${secDetail}${secSchools}${secPlan}${secMaterials}${secGuar}${secNotes}${secTimeline}</div></div></div>`;
}
