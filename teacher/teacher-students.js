// 兜底：若 shared/constants.js 尚未更新到含 schoolLevelHtml，就地补一个，避免整页卡「加载中」
if (typeof window !== "undefined" && typeof window.schoolLevelHtml !== "function") {
  window.schoolLevelHtml = function (lv) { var m = ({1:{t:"冲刺",c:"#c0392b"},2:{t:"匹配",c:"#b8860b"},3:{t:"保底",c:"#2a7a3a"}})[lv]; return m ? "<span style=\"color:" + m.c + ";font-weight:600\">" + m.t + "</span>" : ""; };
}
// ══════════════════════════════════
// teacher-students.js — 学生管理模块
// 考学进度 / 面谈查询 / 出席・作业记录 / 学生档案（含筛选、节点总结、计划书内容渲染）
// 依赖：shared/constants.js、shared/supabase.js、teacher.js（须在其后加载）
// ══════════════════════════════════

let teacherProgressData = { students: [], timeline: {}, schoolPlans: {}, planDrafts: {} };

const TP_SOURCES = STUDENT_SOURCES_ALL;   // 共用 shared/constants.js（含已停用的：筛选已有学生用；新建学生用 STUDENT_SOURCES）

// 按专业筛选值展开成实际专业列表
function tpMajorMatch(major, filterVal) {
  if (!filterVal) return true;
  if (isMajorGroup(filterVal)) return groupMajors(filterVal).includes(major) || major === filterVal;
  return major === filterVal;
}

async function renderTeacherStudyProgress(mc) {
  mc.innerHTML = '<div class="empty">加载中…</div>';

  // 与 admin 学生档案同步：显示允许专业范围内的全部在籍学生（数据只在进入时拉取一次，筛选纯前端）
  let students = [];
  try {
    const all = await sb('/rest/v1/students?select=*&order=name.asc&limit=2000');
    students = tsaFilterStudents(all);   // 全部状态；由全局「状态」筛选
    if (tsaGuaranteedLock()) students = students.filter(tsaIsGuaranteed);
  } catch (e) { mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }

  if (!students.length) {
    mc.innerHTML = `<div class="empty">${tsaScope().vipOnly ? '暂无你指导的 VIP 学生' : '可见范围内暂无学生'}</div>`;
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
  await docScopeLoad(stuIds);   // 哪些学生的文书我能看内容，其余只显示状态（seed/student_docs_scope.sql）
  const [allTimeline, allPlans, allDrafts, allRiyu] = await Promise.all([
    chunkFetch(ids => `/rest/v1/student_progress_timeline?student_id=in.(${ids})&select=*&order=created_at.asc`),
    chunkFetch(ids => `/rest/v1/student_school_plans?student_id=in.(${ids})&select=*&order=level.asc`),
    chunkFetch(ids => `/rest/v1/student_plan_drafts?student_id=in.(${ids})&select=*&order=updated_at.desc`),
    chunkFetch(ids => `/rest/v1/riyu_submissions?student_id=in.(${ids})&select=*`),   // 新版志望理由书（表未建时为空）
    (typeof riyuMailSavedLoad === 'function' ? riyuMailSavedLoad() : Promise.resolve()).catch(() => {}),   // 联系教授邮件 / 问询邮件有没有保存过指导
  ]);
  // 出愿材料：清单 + 各学生准备情况（表未建时为空）
  const [matItems, allMats] = await Promise.all([
    (typeof matLoadItems === 'function' ? matLoadItems('') : Promise.resolve([])).catch(() => []),
    chunkFetch(ids => `/rest/v1/student_materials?student_id=in.(${ids})&select=*`),
  ]);
  const matsMap = {};
  (allMats || []).forEach(r => { (matsMap[r.student_id] = matsMap[r.student_id] || []).push(r); });
  // 面谈预约里的「目标校」栏是择校状态（已择校 / 择校中 / 未择校）：用于「已择校但没填志望校」提醒
  const allBk = await chunkFetch(ids => `/rest/v1/bookings?student_id=in.(${ids})&target_school=not.is.null&select=student_id,target_school,slot_date&order=slot_date.desc`);
  const bkMap = {};
  (allBk || []).forEach(b => { (bkMap[b.student_id] = bkMap[b.student_id] || []).push(b); });

  const timelineMap = {}, plansMap = {}, draftsMap = {}, riyuSubsMap = {};
  (allRiyu || []).forEach(r => { (riyuSubsMap[r.student_id] = riyuSubsMap[r.student_id] || []).push(r); });
  allTimeline.forEach(t => { if (!timelineMap[t.student_id]) timelineMap[t.student_id] = []; timelineMap[t.student_id].push(t); });
  allPlans.forEach(p => { if (!plansMap[p.student_id]) plansMap[p.student_id] = []; plansMap[p.student_id].push(p); });
  allDrafts.forEach(d => { if (!draftsMap[d.student_id]) draftsMap[d.student_id] = d; });

  teacherProgressData = { students, timelineMap, plansMap, draftsMap, riyuSubsMap, matItems: matItems || [], matsMap, bkMap };
  try { tpRenderShell(); }
  catch (e) { mc.innerHTML = `<div class="empty" style="color:var(--danger)">考学进度渲染失败：${(e && e.message) || e}</div>`; console.error('tpRenderShell error:', e); }
}

let tpSoloId = null;          // 单人模式：只显示这一个学生（筛选保持原值，不显示筛选栏）
let tpOpenIds = null;         // 返回列表时恢复展开的卡片
function tpSolo(sid, back, section) {
  const box = document.getElementById('tp_list') || document.getElementById('sm_content'); if (!box) return;
  const snap = pgsSnap(box);
  const openIds = [...box.querySelectorAll('.pgc-body')].filter(e => e.style.display !== 'none').map(e => e.id.slice(4));
  tpSoloId = sid;
  const sf = document.getElementById('sm_filter'); if (sf) sf.style.display = 'none';
  pgsEnter(sid, back || { label: '返回全部学生', restore: async () => {
    tpSoloId = null; const f = document.getElementById('sm_filter'); if (f) f.style.display = '';
    tpOpenIds = new Set(openIds);
    tpRenderShell(); pgsRestore(snap); pgsMark(sid);
  } });
  tpRenderShell();
  if (section) pgsGoto(sid, section); else { const sc = pgsScrollEl(box); sc.scrollTop = 0; window.scrollTo(0, 0); }
}
function tpSoloHtml() {
  const s = (teacherProgressData.students || []).find(x => x.id === tpSoloId);
  if (!s) { tpSoloId = null; return ''; }
  return pgsBarHtml(s, PGS.back) + `<div style="display:flex;flex-direction:column;gap:10px">${pgcCardHtml(s, teacherProgressData, tpCardOpts({ open: true, focus: true }))}</div>`;
}
function tpCardOpts(extra) {
  return Object.assign({
    mode: 'teacher',
    h: { planSet: 'tpPlanSet', planFlag: 'tpPlanFlag', schoolAdd: 'tpAddSchool', schoolEdit: 'tpEditSchool', schoolDel: 'tpDelSchool' },
    notesFn: 'tpNotesToggle',
    riyuChanged: tpRiyuChanged,
  }, extra || {});
}
let tpViewMode = 'student';   // 'student' 学生视角 | 'submissions' 学生提交（shared/submissions.js）
// 学生提交：只列老师能看的在读学生（teacherProgressData.students 已按 teacherScope 过滤），再叠加全局筛选和「我负责的」
function tpRenderSubmissions(listBox) {
  const cnt = document.getElementById('tp_count'); if (cnt) cnt.textContent = '';
  if (tpOwnerFilter === '') tpOwnerFilter = tpHasMine() ? 'mine' : 'all';
  sbmRender(listBox, {
    students: () => (teacherProgressData.students || []).filter(s => (s.status || 'active') === 'active'),
    pass: s => tsmMatch(s, null, true) && (tpOwnerFilter !== 'mine' || tpIsMine(s)),
    openPlan: (sid, name, o) => openTeacherDraftComment(sid, name, o),
  });
}

// 外壳：标题/搜索/专业/来源筛选 + 列表容器（切换筛选时重绘外壳，搜索输入只刷新列表保持焦点）
function tpRenderShell() {
  const box = document.getElementById('sm_content') || document.getElementById('mainContent');
  if (!box || !teacherProgressData) return;
  if (tpSoloId) { box.innerHTML = '<div id="tp_list"></div>'; tpRenderProgressList(); return; }
  box.innerHTML = `
  <div class="page-header">
    <div class="section-title">考学进度 <span class="badge-count" id="tp_count"></span></div>
  </div>
  ${tpHasMine() ? `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px">
    <span style="font-size:10px;color:var(--text-3)">范围：</span>
    <div class="filter-chip ${tpOwnerFilter==='mine'?'active':''}" onclick="tpSetOwner('mine')" style="padding:3px 10px;font-size:10px">⭐ 我负责的</div>
    <div class="filter-chip ${tpOwnerFilter==='all'?'active':''}" onclick="tpSetOwner('all')" style="padding:3px 10px;font-size:10px">全部（可见范围）</div>
  </div>` : ''}
  <div style="display:flex;gap:4px;margin-bottom:8px">${[['student', '👤 学生视角'], ['submissions', '📥 学生提交']].map(([k, l]) => `<button class="btn btn-sm ${tpViewMode === k ? 'btn-primary' : 'btn-outline'}" onclick="tpViewMode='${k}';tpRenderShell()">${l}</button>`).join('')}</div>
  <div id="tp_list"></div>`;
  tpRenderProgressList();
}

// 「我负责的」：owner_teachers 或 vip_teachers 含当前老师姓名（两者平级，均在可读范围内）
let tpOwnerFilter = '';   // '' 未初始化 | 'mine' | 'all'
function tpIsMine(s) {
  const me = (teacherData && teacherData.name) || '';
  if (!me) return false;
  return (Array.isArray(s.owner_teachers) && s.owner_teachers.includes(me))
      || (Array.isArray(s.vip_teachers) && s.vip_teachers.includes(me));
}
// 当前老师在可读范围内是否有被指派/带VIP的学生（决定默认档）
function tpHasMine() { return (teacherProgressData.students || []).some(tpIsMine); }

function tpFilteredStudents() {
  const { students } = teacherProgressData;
  // 首次进入时定默认档：有负责/VIP学生 → 我负责的，否则 全部
  if (tpOwnerFilter === '') tpOwnerFilter = tpHasMine() ? 'mine' : 'all';
  let list = tsmFilterStudents(students);   // 领域 / 专业 / 状态 / 来源 / 搜索：全局筛选
  if (tpOwnerFilter === 'mine') list = list.filter(tpIsMine);
  return list;
}
function tpSetOwner(v) { tpOwnerFilter = v; tpRenderShell(); }

// 备考节点的计算、卡片画法在 shared/progress-card.js（pgcNodes / pgcCardHtml），管理端和老师端共用

// 上传批复版后：更新缓存里的提交记录并重绘列表
function tpRiyuChanged(sub) {
  const m = (teacherProgressData && teacherProgressData.riyuSubsMap) || {};
  const list = m[sub.student_id] || (m[sub.student_id] = []);
  const i = list.findIndex(x => x.id === sub.id);
  if (i >= 0) list[i] = sub; else list.push(sub);
  tpRenderProgressList();
}

function tpRenderProgressList() {
  const listBox = document.getElementById('tp_list');
  if (!listBox || !teacherProgressData) return;
  if (tpSoloId) {   // 单人模式：操作后的刷新也留在这里，位置不动
    const snap = pgsSnap(listBox);
    const h = tpSoloHtml();
    if (h) { listBox.innerHTML = h; pgsRestore(snap); return; }
  }
  if (tpViewMode === 'submissions') { tpRenderSubmissions(listBox); return; }
  const filteredAll = tpFilteredStudents();
  const filtered = tsmSlice(filteredAll);
  const cnt = document.getElementById('tp_count');
  if (cnt) cnt.textContent = filteredAll.length;
  // 重绘前记下已展开的卡片，重绘后保持展开（首次进入不展开任何卡片）
  const openIds = new Set([...listBox.querySelectorAll('.pgc-body')].filter(e => e.style.display !== 'none').map(e => e.id.slice(4)));
  const o = tpCardOpts({ solo: st => `tpSolo('${pgcJs(st.id)}')` });
  const restoreOpen = tpOpenIds; tpOpenIds = null;
  const cards = filtered.map(s => pgcCardHtml(s, teacherProgressData, { ...o, open: openIds.has(s.id) || !!(restoreOpen && restoreOpen.has(s.id)) })).join('');
  listBox.innerHTML = (cards ? `<div style="display:flex;flex-direction:column;gap:10px">${cards}</div>` + tsmMoreHtml(filteredAll.length) : '') || `<div class="empty">${(tsmPool || []).length ? '没有符合筛选条件的学生' : (tsaScope().vipOnly ? '暂无你指导的 VIP 学生' : '没有符合筛选条件的学生')}</div>`;
}

// 计划书批复弹窗（openTeacherDraftComment 等）已挪到 shared/plan-review.js，老师端和管理端共用


// ══════════════════════════════════
// 学生管理（需 admin 授予 student_mgmt 权限，子项由 student_mgmt_items 控制）
// 子项：progress 考学进度（沿用原页面，按老师负责的面谈学生显示）
//       records  出席・作业记录（按 student_majors 允许专业查看）
//       profile  学生档案录入（与 admin 学生档案同一张表实时同步；按 student_majors 允许专业查看）
// ══════════════════════════════════
let smTab = '';
const SM_ITEMS = [['progress','📊 考学进度'], ['meetings','💬 面谈查询'], ['records','🗒 出席・作业记录'], ['profile','👤 学生档案']];
// 出席・作业记录拆成两项：records_view 查看 / records_entry 登记；旧的 records 当作两项都开
function smRecPerm(items) {
  const it = Array.isArray(items) ? items : ((((teacherData && teacherData.permissions) || {}).student_mgmt_items) || []);
  const legacy = it.includes('records');
  return { view: legacy || it.includes('records_view'), entry: legacy || it.includes('records_entry') };
}

function smAllowedItems() {
  const p = (teacherData && teacherData.permissions) || {};
  const items = (p.student_mgmt && Array.isArray(p.student_mgmt_items)) ? p.student_mgmt_items : [];
  const rp = smRecPerm(items);
  const allowed = SM_ITEMS.filter(([k]) => k === 'records' ? (rp.view || rp.entry) : items.includes(k));
  // 重点关注：汇总已有数据的另一种展示，只要有考学进度/学生档案/面谈任一权限就提供
  if (items.includes('progress') || items.includes('profile') || items.includes('meetings')) {
    allowed.push(['focus', '⭐ 重点关注']);
    allowed.push(['monthly', '📅 月度学习情况']);  // 月度：跟重点关注一样自动出现
  }
  // 若已在 student_mgmt_items 显式勾了 monthly 也不重复

  return allowed;
}

// ══ 全局筛选（学生管理所有子页面共用）：领域 / 专业 / 状态 / 来源 / 搜索，五个条件取交集 ══
// 筛选只缩小范围：学生池 tsmPool 已按 tsaAllowedSet()（以及保录限定）裁剪，筛选不会超出权限。
const TSM_STATUS = [['active', '在籍'], ['graduated', '已合格'], ['expired', '已到期'], ['stopped', '停课'], ['withdrawn', '退学'], ['', '全部']];
const tsmDefault = () => ({ domain: tsmDefaultDomain(), major: '', status: 'active', source: '', q: '' });
let tsm = tsmDefault();
let tsmDomainInited = false;   // 首次加载学生池后，才能按可见学生判断默认领域
// 默认领域：老师自己的领域（managed_by 第一个；没有就取负责专业所属领域里人数最多的）；都没有（营业老师等）→ 留空，让老师自己选。绝不默认「全部」
function tsmDefaultDomain() {
  if (typeof teacherData === 'undefined' || !teacherData) return '';
  const pool = tsmPool || [];
  const present = new Set(pool.map(s => tsmDomainOf(s.major)).filter(Boolean));
  tsmScopeDomains().forEach(d => present.add(d));
  const ok = d => d && (!tsmPool || present.has(d));
  const isSales = typeof canSeeAllStudents === 'function' && canSeeAllStudents(teacherData);
  if (!isSales) {
    const mb = (teacherData.managed_by || []).filter(Boolean);
    const own = (teacherData.domains || []).filter(Boolean);
    if (own.length && ok(own[0])) return own[0];
    if (mb.length && ok(mb[0])) return mb[0];
    const cntBy = {};
    (teacherData.majors || []).forEach(m => { const d = tsmDomainOf(m); if (d) cntBy[d] = (cntBy[d] || 0) + pool.filter(s => tpMajorMatch(s.major, m)).length + 0.001; });
    const best = Object.keys(cntBy).sort((a, b) => cntBy[b] - cntBy[a])[0];
    if (ok(best)) return best;
  }
  // 指定了营业范围、只有一个领域：就用它
  { const sd = typeof salesScopeDomains === 'function' ? salesScopeDomains(teacherData) : []; if (sd.length === 1 && ok(sd[0])) return sd[0]; }
  // 没有所属领域（营业老师等）：不替他选，留空，页面提示「请先选择领域」（见 tsmNeed）
  return '';
}
// 逐级选择：领域 → 专业，每一级都要老师自己点了才显示学生（点「全部」也算选了）；没选完就只提示，不显示任何学生
let tsmDomPicked = true, tsmMajPicked = false;
// 领域筛选里要列出的领域：可见学生里出现的 ∪ 负责的整个领域 ∪ 范围内专业所属领域（领域下暂时没有学生也要列出，数字 0）
function tsmScopeDomains() {
  const sc = tsaScope(), set = new Set();
  if (sc.all) return set;
  sc.domains.forEach(d => set.add(d));
  sc.majors.forEach(m => { const d = tsmDomainOf(m); if (d) set.add(d); });
  return set;
}
function tsmDomainsPresent() { const sd = tsmScopeDomains(); return DOMAINS.map(d => d.label).filter(d => sd.has(d) || (tsmPool || []).some(s => tsmDomainOf(s.major) === d)); }
function tsmDomCount() { return tsmDomainsPresent().length; }
function tsmEffDomain() { const doms = tsmDomainsPresent(); return tsm.domain || (doms.length === 1 ? doms[0] : ''); }
function tsmDomMajorKeys(dom) {
  const present = new Set((tsmPool || []).map(s => s.major).filter(Boolean));
  const keys = majorFilterKeys().filter(k => isMajorGroup(k) ? groupMajors(k).some(m => present.has(m)) : present.has(k));
  [...present].forEach(k => { if (!keys.includes(k)) keys.push(k); });
  return keys.filter(k => tsmDomainOf(k) === dom);
}
// 还差哪一级没选：'domain' | 'major' | ''（都选了）
function tsmNeed() {
  if (!tsmDomPicked) return 'domain';
  const ed = tsmEffDomain();
  if (ed && !tsmMajPicked && tsmDomMajorKeys(ed).length > 1) return 'major';
  return '';
}
function tsmPickHtml() { return `<div class="empty" style="padding:40px">${tsmNeed() === 'major' ? '请先在上面选择专业（或点「全部」）后再查看学生' : '请先在上面选择领域（或点「全部」）后再查看学生'}</div>`; }
// 学生列表分页：每次先显示 30 人，「显示更多」再加 30；筛选/切页时重置
const TSM_PAGE = LIST_PAGE;
let tsmShown = TSM_PAGE;
function tsmSlice(list) { return list.slice(0, tsmShown); }
function tsmMoreHtml(total) {
  if (total <= tsmShown) return '';
  return `<div onclick="tsmShowMore()" style="text-align:center;padding:10px;margin:6px 0;font-size:11px;color:var(--accent);border:1px dashed var(--border);border-radius:4px;cursor:pointer">加载更多（还有 ${total - tsmShown} 人）</div>`;
}
function tsmShowMore() { tsmShown += TSM_PAGE; tsmRefreshPage(true); }
let tsmPool = null, tsmPoolAt = 0;   // 可见学生（全部状态）[{id,name,major,level,status,course_type,student_type,source}]

// 一个学生（或带 name/major/source/status 的对象，如面谈分组）是否符合全局筛选；skip = 统计某一行人数时忽略的那一项，noQ = 忽略搜索
function tsmMatch(s, skip, noQ) {
  if (skip !== 'domain' && tsm.domain && tsmDomainOf(s.major) !== tsm.domain) return false;
  if (skip !== 'major' && tsm.major && !tpMajorMatch(s.major, tsm.major)) return false;
  if (skip !== 'status' && tsm.status && (s.status || 'active') !== tsm.status) return false;
  if (skip !== 'source' && tsm.source && (s.source || '') !== tsm.source) return false;
  const q = tsm.q.trim();
  if (!noQ && q && !searchMatch(q, studentSearchFields(s).concat([s.source]))) return false;
  return true;
}
function tsmFilterStudents(list) { return (list || []).filter(s => tsmMatch(s)); }

async function tsmLoadPool(force) {
  if (!force && tsmPool && Date.now() - tsmPoolAt < 60000) return tsmPool;
  let all = [];
  try { all = await sbAll('/rest/v1/students?select=id,name,major,level,status,course_type,student_type,source,class_ids,vip_teachers,owner_teachers,is_vip_course&order=name.asc'); } catch (e) { all = tsmPool || []; }
  let list = tsaFilterStudents(all);
  if (tsaGuaranteedLock()) list = list.filter(tsaIsGuaranteed);
  tsmPool = list; tsmPoolAt = Date.now();
  if (!tsmDomainInited) { tsmDomainInited = true; tsm.domain = tsmDefaultDomain(); tsmDomPicked = !!tsm.domain || tsmDomCount() <= 1; tsmMajPicked = false; }
  return tsmPool;
}

const tsmFuTab = () => smTab === 'meetings' || smTab === 'focus';   // 这两页只看在籍：不显示状态筛选，人数只算在籍
function tsmBarHtml() {
  const fu = tsmFuTab();
  const pool = fu ? fuOnlyActive(tsmPool || []) : (tsmPool || []);
  const tsmMatch = (s, skip, noQ) => { if (!fu) return window.tsmMatch(s, skip, noQ); const o = tsm.status; tsm.status = ''; try { return window.tsmMatch(s, skip, noQ); } finally { tsm.status = o; } };   // 忽略状态筛选
  const chip = (on, label, n, fn) => `<div class="filter-chip ${on ? 'active' : ''}" onclick="${fn}" style="padding:3px 10px;font-size:10px;${n === 0 && !on ? 'opacity:.45' : ''}">${label}${n == null ? '' : ' ' + n}</div>`;
  const cnt = (skip, test) => pool.filter(s => tsmMatch(s, skip, true) && test(s)).length;
  const row = (label, inner) => `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px"><span style="font-size:10px;color:var(--text-3);min-width:30px">${label}</span>${inner}</div>`;
  let h = '';
  // 领域：只列可见学生里实际出现的；只有一个领域时不显示
  const doms = tsmDomainsPresent();
  if (doms.length > 1) h += row('领域', chipFold([{ on: !tsm.domain && tsmDomPicked, html: chip(!tsm.domain && tsmDomPicked, '全部', cnt('domain', () => true), `tsmSet('domain','')`) }]
    .concat(doms.map(d => ({ on: tsm.domain === d, html: chip(tsm.domain === d, d, cnt('domain', s => tsmDomainOf(s.major) === d), `tsmSet('domain','${d}')`) })))));
  // 专业：逐级展开——选了具体领域才显示，只列该领域的专业；领域选「全部」时只给一行提示（只有一个领域时直接列该领域专业）
  const effDom = tsmEffDomain();
  const present = new Set(pool.map(s => s.major).filter(Boolean));
  if (effDom) {
    const dkeys = tsmDomMajorKeys(effDom);
    if (dkeys.length > 1) {
      const mchip = k => ({ on: tsm.major === k, html: chip(tsm.major === k, majorLabel(k), cnt('major', s => tpMajorMatch(s.major, k)), `tsmSet('major','${k}')`) });
      h += row('专业', chipFold([{ on: !tsm.major && tsmMajPicked, html: chip(!tsm.major && tsmMajPicked, '全部', cnt('major', () => true), `tsmSet('major','')`) }].concat(dkeys.map(mchip))));
    }
  } else if (present.size > 1) {
    h += row('专业', '<span style="font-size:10px;color:var(--text-3)">选择领域后可按专业筛选</span>');
  }
  if (!fu) h += row('状态', TSM_STATUS.map(([k, l]) => chip(tsm.status === k, l, cnt('status', s => !k || (s.status || 'active') === k), `tsmSet('status','${k}')`)).join(''));
  h += row('来源', chip(!tsm.source, '全部', cnt('source', () => true), `tsmSet('source','')`) + TP_SOURCES.filter(x => sourceAllowed({ source: x }, teacherData && teacherData.student_sources)).map(x => chip(tsm.source === x, x, cnt('source', s => (s.source || '') === x), `tsmSet('source','${x}')`)).join(''));
  const n = pool.filter(s => tsmMatch(s)).length;
  h += `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px">
    <input id="tsm_q" placeholder="搜索姓名（汉字 / 拼音首字母）/ 专业 / 来源…" value="${tsaEsc(tsm.q)}" oninput="searchBox(this,tsmSearchInput)" style="font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;width:240px;max-width:100%">
    <span style="margin-left:auto;font-size:11px;color:var(--text-2)">符合条件 <b id="tsm_n">${tsmNeed() ? '—' : n}</b> 人</span>
    <span onclick="tsmClear()" style="font-size:10px;color:var(--accent);cursor:pointer">清除筛选</span></div>`;
  return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:10px 12px;margin-bottom:12px">${h}</div>`;
}
function tsmRenderBar() { const el = document.getElementById('sm_filter'); if (el) el.innerHTML = tsmBarHtml(); }
function tsmSet(k, v) {
  const wasNeed = tsmNeed();   // 之前因为没选完而没加载列表 → 这次选完要整页重新加载
  if (k === 'domain') { tsmDomPicked = true; if (v !== tsm.domain) tsmMajPicked = false; }
  if (k === 'major') tsmMajPicked = true;
  tsm[k] = v;
  if (k === 'domain' && tsm.major && (!v || tsmDomainOf(tsm.major) !== v)) tsm.major = '';   // 换领域时，不属于该领域的专业选择清掉
  if (wasNeed) { tsmShown = TSM_PAGE; renderStudentMgmt(document.getElementById('mainContent')); return; }
  tsmChanged();
}
function tsmClear() {
  const wasNeed = tsmNeed();
  tsm = tsmDefault(); tsmDomPicked = !!tsm.domain || tsmDomCount() <= 1; tsmMajPicked = false;
  if (wasNeed) { tsmShown = TSM_PAGE; renderStudentMgmt(document.getElementById('mainContent')); } else tsmChanged();
}
function tsmChanged() { tsmShown = TSM_PAGE; tsmRenderBar(); tsmRefreshPage(false); }
function tsmSearchInput(v) {   // 输入搜索时不重画筛选栏（保持输入焦点），只更新人数和当前页
  tsm.q = v; tsmShown = TSM_PAGE;
  const n = document.getElementById('tsm_n'); if (n) n.textContent = tsmNeed() ? '—' : (tsmFuTab() ? fuOnlyActive(tsmPool || []).filter(s => tsmMatch(s, 'status')) : (tsmPool || []).filter(s => tsmMatch(s))).length;
  tsmRefreshPage(true);
}
// 筛选变化后刷新当前子页面（数据已缓存，不重新拉取）；light=只刷新列表，保持页头不动
function tsmRefreshPage(light) {
  const box = document.getElementById('sm_content'); if (!box) return;
  if (tsmNeed()) { box.innerHTML = tsmPickHtml(); return; }
  if (smTab === 'progress') { if (light && document.getElementById('tp_list')) tpRenderProgressList(); else tpRenderShell(); }
  else if (smTab === 'meetings') { if (light && document.getElementById('tm_list')) tmRenderList(); else tmRenderShell(); }
  else if (smTab === 'records') { if (light && document.getElementById('tsr_list')) tsrRenderList(); else tsrRender(); }
  else if (smTab === 'monthly') renderMonthlyReport(box);
  else if (smTab === 'focus') focusRender();
  else if (light && document.getElementById('tsa_list')) tsaRenderList();
  else tsaRender();
}

function renderStudentMgmt(mc) {
  tpSoloId = null;   // 切到别的子页面 / 重新进入：退出考学进度单人模式
  const allowed = smAllowedItems();
  if (!allowed.length) { mc.innerHTML = '<div class="empty">未开通任何学生管理子项，请联系管理员</div>'; return; }
  if (!allowed.find(([k]) => k === smTab)) smTab = allowed[0][0];
  mc.innerHTML = `<div>
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
      ${allowed.map(([k, l]) => `<button onclick="smTab='${k}';renderStudentMgmt(document.getElementById('mainContent'))" style="font-size:11px;padding:5px 14px;border-radius:3px;cursor:pointer;font-family:inherit;border:1px solid ${smTab===k?'var(--accent)':'var(--border)'};background:${smTab===k?'var(--accent)':'var(--surface)'};color:${smTab===k?'#fff':'var(--text-2)'}">${l}</button>`).join('')}
    </div>
    <div id="sm_filter"></div>
    <div id="sm_content"><div class="empty">加载中…</div></div>
  </div>`;
  const box = document.getElementById('sm_content');
  const tab = smTab;
  tsmShown = TSM_PAGE;
  tsmLoadPool(true).then(() => {
    if (smTab !== tab || !document.getElementById('sm_content')) return;   // 加载期间已切走
    if (tsaScopeEmpty()) { const f = document.getElementById('sm_filter'); if (f) f.innerHTML = ''; box.innerHTML = tsaEmptyHtml(); return; }
    tsmRenderBar();
    if (tsmNeed()) { box.innerHTML = tsmPickHtml(); return; }
    if (tab === 'progress') renderTeacherStudyProgress(box);
    else if (tab === 'records') renderTsaRecords(box);
    else if (tab === 'meetings') renderTsaMeetings(box);
    else if (tab === 'monthly') renderMonthlyReport(box);
    else if (tab === 'focus') renderTeacherFocus(box);
    else renderTeacherStudents(box);
  });
}

// ── 共用：允许专业集合（三个子项统一使用；与面谈预约逻辑完全无关） ──
// 范围由 shared/constants.js 的 teacherScope() 统一算（营业/对接=全部；其他=负责专业/领域/管理范围/班主任班级，减去「排除的专业」）。
// 没有范围 = 一个学生都看不到（不再"没设就全部"）。
// admin 是否把此老师的学生管理限定为"仅保录学生"
function tsaGuaranteedLock() { return !!(teacherData && teacherData.permissions && teacherData.permissions.guaranteed_only); }
function tsaIsGuaranteed(s) { return ((s && s.course_type) || '').includes('保录'); }

function tsaScope() { return teacherScope(teacherData, 'student'); }
// 专业集合：null = 看全部；Set（可能为空）= 按专业；班主任班级的学生另外用 tsaStudentOk 判断
function tsaAllowedSet() {
  const sc = tsaScope();
  return sc.all ? null : sc.majors;
}
// 学生行是否在这位老师的范围里（专业命中，或在班主任负责的班级里）
function tsaStudentOk(s) { return teacherScopeHasStudent(tsaScope(), s); }
// 某个专业在不在范围内（专业命中或所属领域整个负责）
function tsaMajorOk(k) { return teacherScopeHasStudent(Object.assign({}, tsaScope(), { studentSources: [] }), { major: k }); }   // 只问专业，不看来源
function tsaScopeEmpty() { return teacherScopeEmpty(tsaScope()); }
function tsaFilterStudents(list) { const sc = tsaScope(); return (sc.all && !sc.studentSources.length) ? (list || []) : (list || []).filter(s => teacherScopeHasStudent(sc, s)); }   // 有来源限制时 all 也要过滤
function tsaScopeText() {
  const sc = tsaScope();
  if (sc.all) return '可见全部专业';
  const parts = [];
  if (sc.domains.size) parts.push('整个领域：' + [...sc.domains].join('・'));
  if (sc.majors.size) parts.push('可见专业：' + [...sc.majors].map(m => MAJORS[m] || m).join('・'));
  if (sc.classIds.size) parts.push('含班主任班级学生');
  return parts.join('；');
}
function tsaEmptyHtml() { return `<div class="empty">${TEACHER_SCOPE_EMPTY_MSG}</div>`; }

function tsaEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// ══ 子项1：学生档案（录入 + 查看） ══
let tsaStudents = [];
let tsaFormOpen = false;
let tsaExpandedId = null;
let tsaGuaranteedOnly = false;  // 只看保录学生（course_type 含"保录"），与专业筛选平级

async function renderTeacherStudents(box) {
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const all = await sb('/rest/v1/students?select=*&order=created_at.desc&limit=2000');
    tsaStudents = tsaFilterStudents(all);   // 全部状态；由全局「状态」筛选
    // admin 限定"仅保录"：数据层就只保留保录学生，彻底看不到其他学生
    if (teacherData && teacherData.permissions && teacherData.permissions.guaranteed_only) {
      tsaStudents = tsaStudents.filter(s => (s.course_type || '').includes('保录'));
      tsaGuaranteedOnly = true;
    }
  } catch (e) { box.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }
  tsaRender();
}

function tsaMajorOptions(sel) {
  return Object.entries(MAJORS)
    .filter(([k]) => !isMajorGroup(k) && tsaMajorOk(k))
    .map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
}

function tsaListHtml() {
  let list = tsmFilterStudents(tsaStudents);
  if (tsaGuaranteedOnly) list = list.filter(s => (s.course_type || '').includes('保录'));
  // 表格本体（列、排序、表头筛选）用 shared/student-table.js，和管理端同一套
  return sttHtml('teacher', list, {
    mode: 'teacher',
    slice: tsmSlice, more: tsmMoreHtml,
    rowClick: s => `tsaExpandedId=tsaExpandedId==='${s.id}'?null:'${s.id}';tsaRenderList()`,
    expand: s => tsaExpandedId !== s.id ? '' : `<div style="font-size:11px;margin-bottom:6px"><span style="color:var(--text-3)">上课方式：</span>${s.default_mode === 'offline' ? '线下' : '线上'}</div>
        ${[['目标学校', s.target_school], ['补充备注', s.notes]].filter(x => x[1]).map(x => `<div style="font-size:11px;margin-bottom:6px;white-space:pre-wrap"><span style="color:var(--text-3)">${x[0]}：</span>${tsaEsc(x[1])}</div>`).join('')}
        <button onclick="event.stopPropagation();tsaCodeNotice('${s.id}')" style="margin-right:6px;font-size:10px;background:none;border:1px solid var(--accent);color:var(--accent);border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">✉ 查询码通知</button>
        ${(teacherData.permissions.student_mgmt_items||[]).includes('profile_edit')?`<button onclick="event.stopPropagation();tseOpen('${s.id}')" style="font-size:10px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">✏ 修改档案</button>`:''}`
  });
}

// 查询码通知（文案 A）：只对本老师能看到的学生（tsaStudents 已按可见范围过滤）
function tsaCodeNotice(id) {
  const st = tsaStudents.find(x => x.id === id);
  if (!st) return;
  openStudentCodeNotice(st, () => tsaRenderList());
}

function tsaRenderList() {
  const box = document.getElementById('tsa_list');
  if (box) box.innerHTML = tsaListHtml();
}

function tsaRender() {
  const mc = document.getElementById('sm_content') || document.getElementById('mainContent');
  const inpStyle = 'width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const fld = (id, label, ctrl) => `<div><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">${label}</label>${ctrl}</div>`;
  const inp = (id, label, ph) => fld(id, label, `<input id="${id}" placeholder="${ph || ''}" style="${inpStyle}">`);

  mc.innerHTML = `<div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <div style="font-size:12px;font-weight:600">👤 学生档案（${tsmFilterStudents(tsaStudents).length}人）<span style="font-size:10px;font-weight:400;color:var(--text-3);margin-left:6px">${tsaScopeText()}</span></div>
      <div style="display:flex;gap:6px;align-items:center">
        ${(teacherData && teacherData.permissions && teacherData.permissions.guaranteed_only)
          ? `<div style="font-size:10px;padding:2px 10px;border-radius:12px;background:#8a5010;color:#fff;white-space:nowrap">🎓 仅保录学生（管理员限定）</div>`
          : `<div class="filter-chip ${tsaGuaranteedOnly?'active':''}" onclick="tsaGuaranteedOnly=!tsaGuaranteedOnly;tsaRender()" style="padding:2px 10px;font-size:10px;white-space:nowrap;${tsaGuaranteedOnly?'background:#8a5010;color:#fff;border-color:#8a5010':''}">🎓 只看保录</div>`}
        <button onclick="tsaFormOpen=!tsaFormOpen;tsaRender()" style="font-size:11px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">${tsaFormOpen ? '收起表单' : '＋ 添加学生'}</button>
      </div>
    </div>

    ${tsaFormOpen ? `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:600;margin-bottom:10px">添加学生（与 admin 学生档案同步，保存后自动生成查询码）</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:10px">
        ${inp('tsa_name', '姓名 *', '学生姓名')}
        ${fld('tsa_major', '专业 *', `<select id="tsa_major" style="${inpStyle}">${tsaMajorOptions('')}</select>`)}
        ${fld('tsa_type', '属性', `<select id="tsa_type" style="${inpStyle}"><option value="">请选择</option><option>本科</option><option>专科</option><option>专升本</option></select>`)}
        ${fld('tsa_source', '来源', `<select id="tsa_source" style="${inpStyle}">${(teacherData.student_sources || []).length ? '' : '<option value="">请选择</option>'}${STUDENT_SOURCES.filter(x => sourceAllowed({ source: x }, teacherData.student_sources)).map(x => `<option>${x}</option>`).join('')}</select>`)}
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
        <div style="grid-column:1/-1"><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">目标学校</label><textarea id="tsa_target_school" rows="3" placeholder="想考的学校，随便写。到考学进度里可以从这里找学校加入志望校" style="${inpStyle};resize:vertical"></textarea></div>
        <div style="grid-column:1/-1"><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">补充备注</label><textarea id="tsa_notes" rows="3" placeholder="其他需要记下的情况" style="${inpStyle};resize:vertical"></textarea></div>
      </div>
      <button onclick="tsaSaveStudent()" style="font-size:12px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:3px;padding:7px 18px;cursor:pointer;font-family:inherit">保存</button>
      <span id="tsa_save_msg" style="font-size:11px;margin-left:10px"></span>
    </div>` : ''}

    <div id="tsa_list">${tsaListHtml()}</div>
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
    target_school: g('tsa_target_school').trim() || null, notes: g('tsa_notes').trim() || null,
  };
  try {
    const res = await sb('/rest/v1/students', 'POST', data);
    const row = Array.isArray(res) && res[0] ? res[0] : data;
    // 查询码交给服务端生成：同时写入 student_login（触发器自动建登录账号），学生才能登录
    const r = await ensureStudentCode(row);
    tsaStudents.unshift(row);
    tsaFormOpen = false;
    tsaRender();
    if (r.code) alert(`已添加「${name}」\n查询码：${r.code}\n请转达学生，用于学习记录、面谈预约等页面登录。`);
    else alert(`已添加「${name}」，但${r.error || '查询码生成失败'}。\n请稍后在学生详情里点「✉ 查询码通知」重试，或联系管理员生成。`);
  } catch (e) { if (msg) msg.textContent = ''; alert('保存失败：' + e.message); }
}

// ══ 子项：月度学习情况（学部美术）——汇总出勤/作业 + 老师评价 + 作品展示 ══
let mrStudentId = '';   // 当前选中学生
let mrYearMonth = '';   // 当前选中月份 YYYY-MM
let mrCache = {};       // student_id -> session_records
let mrReviewCache = {}; // `${sid}|${ym}` -> monthly_reviews row
let mrStudentsCache = [];

function renderMonthlyReport(mc){
  // 学生范围 = 全局筛选后的学生（pool 已按老师可见范围裁剪）
  const list = tsmFilterStudents(tsmPool || []);
  if (!list.some(x => x.id === mrStudentId)) mrStudentId = list.length ? list[0].id : '';
  if (!mrYearMonth){ const d=new Date(); mrYearMonth = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  if (!list.length) { mc.innerHTML = '<div class="empty">当前筛选下没有学生</div>'; mrStudentsCache = []; return; }
  mc.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div style="font-size:12px;font-weight:600">📅 月度学习情况</div>
        <select id="mr_stu" onchange="mrStudentId=this.value;renderMonthlyReport(document.getElementById('sm_content')||document.getElementById('mainContent'))" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:4px">
          ${list.map(s=>`<option value="${s.id}" ${mrStudentId===s.id?'selected':''}>${s.name}${s.student_type?' · '+s.student_type:''}</option>`).join('')}
        </select>
        <input type="month" id="mr_ym" value="${mrYearMonth}" onchange="mrYearMonth=this.value;renderMonthlyReport(document.getElementById('sm_content')||document.getElementById('mainContent'))" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:4px">
      </div>
      <div id="mr_body"><div style="font-size:11px;color:var(--text-3);padding:20px">加载中…</div></div>`;
  mrStudentsCache = list; if (mrStudentId) mrLoadAndRender(list.find(x=>x.id===mrStudentId));
}



// 谁能填班主任 / TA 评价（老师端；管理端全部可填）
function mrCanHr(stu) {
  if (isGakubuMajor(stu.major)) return (typeof tpIsMine === 'function') ? tpIsMine(stu) : false;
  return !!(teacherData && Array.isArray(teacherData.roles) && teacherData.roles.includes('ta')) && tsaStudentOk(stu);
}

async function mrLoadAndRender(stu){
  if(!stu) return;
  const body = document.getElementById('mr_body'); if(!body) return;
  // 拉该生所有 session_records（按名字）+ 该月评价
  if(!mrCache[stu.id]){
    mrCache[stu.id] = await sb(`/rest/v1/session_records?student_name=eq.${encodeURIComponent(stu.name)}&select=*&order=session_date.desc&limit=500`).catch(()=>[]);
  }
  const recs = mrCache[stu.id] || [];
  // 过滤本月
  const monthRecs = recs.filter(r => (r.session_date||'').slice(0,7) === mrYearMonth);
  // 统计 / 本月课程 / 本月进展 / 作业展示：与管理端共用 shared/monthly-report.js
  let summary;
  try { summary = await mrSummaryHtml(stu, mrYearMonth, monthRecs); }
  catch (e) { body.innerHTML = `<div style="font-size:11px;color:var(--danger);padding:20px">统计加载失败：${(e&&e.message)||e}</div>`; return; }
  const hrl = mrHrLabel(stu);
  // 拉评价
  const key = `${stu.id}|${mrYearMonth}`;
  if(mrReviewCache[key]===undefined){
    const rv = await sb(`/rest/v1/monthly_reviews?student_id=eq.${encodeURIComponent(stu.id)}&year_month=eq.${mrYearMonth}&select=*&limit=1`).catch(()=>[]);
    mrReviewCache[key] = (rv&&rv[0])||null;
  }
  const rev = mrReviewCache[key];
  const esc = v => String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  // 谁能填：班主任=我负责的学生(owner/vip含我)；专业老师=有"专业课"标签且该生在我可见专业范围
  const canHome = mrCanHr(stu);
  const isProfTeacher = !!(teacherData && Array.isArray(teacherData.tags) && teacherData.tags.some(t=>String(t).includes('专业课')));
  const canProf = isProfTeacher && tsaStudentOk(stu);
  body.innerHTML = `
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:18px 20px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px">
      <div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600">${esc(stu.name)} · ${mrYearMonth.replace('-','年')}月 学习情况</div>
    </div>
    ${summary}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="background:var(--bg);border:1px solid var(--border-light);border-radius:6px;padding:12px">
        <div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">专业老师评价 ${canProf?'<span style="font-size:9px;color:var(--accent,#b8953a)">· 你可填写</span>':''}</div>
        ${canProf ? `<textarea id="mr_teacher_review" rows="5" style="width:100%;font-size:12px;line-height:1.7;padding:8px;border:1px solid var(--border);border-radius:4px;background:var(--surface);font-family:inherit;resize:vertical" placeholder="填写本月专业指导评价…">${rev&&rev.teacher_review?esc(rev.teacher_review):''}</textarea>`
          : `<div style="font-size:12px;line-height:1.7;color:var(--text-2);white-space:pre-wrap;min-height:40px">${rev&&rev.teacher_review?esc(rev.teacher_review):'<span style="color:var(--text-3)">（待专业老师填写）</span>'}</div>`}
        ${rev&&rev.teacher_review_by?`<div style="font-size:10px;color:var(--text-3);margin-top:6px;text-align:right">— ${esc(rev.teacher_review_by)}</div>`:''}
      </div>
      <div style="background:var(--bg);border:1px solid var(--border-light);border-radius:6px;padding:12px">
        <div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">${hrl}评价 ${canHome?'<span style="font-size:9px;color:var(--accent,#b8953a)">· 你可填写</span>':''}</div>
        ${canHome ? `<textarea id="mr_homeroom_review" rows="5" style="width:100%;font-size:12px;line-height:1.7;padding:8px;border:1px solid var(--border);border-radius:4px;background:var(--surface);font-family:inherit;resize:vertical" placeholder="填写本月${hrl}评价…">${rev&&rev.homeroom_review?esc(rev.homeroom_review):''}</textarea>`
          : `<div style="font-size:12px;line-height:1.7;color:var(--text-2);white-space:pre-wrap;min-height:40px">${rev&&rev.homeroom_review?esc(rev.homeroom_review):'<span style="color:var(--text-3)">（待${hrl}填写）</span>'}</div>`}
        ${rev&&rev.homeroom_review_by?`<div style="font-size:10px;color:var(--text-3);margin-top:6px;text-align:right">— ${esc(rev.homeroom_review_by)}</div>`:''}
      </div>
    </div>
    ${(canProf||canHome) ? `<div style="margin-top:12px;display:flex;gap:8px;align-items:center">
      <button onclick="mrSaveReview('${stu.id}','${esc(stu.name)}')" style="background:var(--accent,#b8953a);color:#fff;border:none;border-radius:5px;padding:8px 18px;font-size:12px;cursor:pointer;font-family:inherit">💾 保存评价</button>
      <button onclick="mrGeneratePdf('${stu.id}')" class="btn btn-outline btn-sm">📄 生成家长版PDF</button>
      <span id="mr_save_hint" style="font-size:11px;color:var(--ok,#2a9e6a)"></span>
    </div>` : `<div style="margin-top:12px"><button onclick="mrGeneratePdf('${stu.id}')" class="btn btn-outline btn-sm">📄 生成家长版PDF</button></div>`}
  </div>`;
}

// 保存月度评价（按身份只写自己那栏 + 署名；upsert monthly_reviews）
async function mrSaveReview(sid, sname){
  const me = (teacherData && teacherData.name) || '';
  const key = `${sid}|${mrYearMonth}`;
  const existing = mrReviewCache[key] || null;
  const tEl = document.getElementById('mr_teacher_review');
  const hEl = document.getElementById('mr_homeroom_review');
  const row = {
    id: (existing && existing.id) || `mr-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
    student_id: sid, student_name: sname, year_month: mrYearMonth,
    updated_at: new Date().toISOString(),
  };
  // 保留另一栏已有内容，只覆盖自己能填的
  row.teacher_review = existing ? existing.teacher_review : null;
  row.teacher_review_by = existing ? existing.teacher_review_by : null;
  row.homeroom_review = existing ? existing.homeroom_review : null;
  row.homeroom_review_by = existing ? existing.homeroom_review_by : null;
  row.selected_works = existing ? existing.selected_works : [];
  if (tEl){ row.teacher_review = tEl.value.trim() || null; row.teacher_review_by = row.teacher_review ? me : row.teacher_review_by; }
  if (hEl){ row.homeroom_review = hEl.value.trim() || null; row.homeroom_review_by = row.homeroom_review ? me : row.homeroom_review_by; }
  const hint = document.getElementById('mr_save_hint');
  try{
    // upsert：有则 PATCH，无则 POST
    if (existing){
      await sb(`/rest/v1/monthly_reviews?id=eq.${existing.id}`, 'PATCH', row);
    } else {
      await sb('/rest/v1/monthly_reviews', 'POST', row);
    }
    mrReviewCache[key] = row;
    if(hint){ hint.textContent='✓ 已保存'; setTimeout(()=>{if(hint)hint.textContent='';},2000); }
  }catch(e){ alert('保存失败：'+e.message); }
}

// 生成家长版月度学习情况 PDF（米色系，完整）
async function mrGeneratePdf(sid){
  const stu = (mrStudentsCache||[]).find(x=>x.id===sid) || {id:sid, name:''};
  const monthRecs = (mrCache[sid] || []).filter(r => (r.session_date||'').slice(0,7) === mrYearMonth);
  await mrOpenPdf(stu, mrYearMonth, monthRecs, mrReviewCache[`${sid}|${mrYearMonth}`] || {});   // 页面与 PDF 生成见 shared/monthly-report.js
}

// ══ 子项2：出席・作业记录 ══
let tsrStudents = [];
// 大课的出席・作业只看有大课的学生：纯 VIP（is_vip_course = 'VIP'）没有大课，不出现在这里（他们的课看 VIP 页）
const tsrBigStudents = () => tsrStudents.filter(s => !isPureVipStudent(s));
let tsrExpandedId = null;
let tsrRecCache = {};

// ══════════ 出席签到（老师端，复刻 admin：选课→点名字签到）══════════
let tatRange='today';       // today | week | all
let tatSessions=[];         // 可见专业下待记出席的课次
let tatCurSession=null;     // 当前签到的课次
let tatPre=[];              // 报名时间晚于这节课的学生（折叠的「未报名」分区，不算缺席）
let tatPreOpen=false;
let tatStudents=[];         // 当前课次的学生
let tatElectives=[];       // 组内开放的课：同组其他专业（选修）可点名的学生
let tatElOpen=false;
let tatEdits={};            // student_id -> {attendance_status, student_mode}
let tatState='present', tatMode='offline';

// 顶部：课次签到区（渲染进 renderTsaRecords 顶部）
// 课次分两组：待记录 / 已记录（记过出席的课次也能找到，点「修改出席」带出原来的记录再改，例如迟到、事后请假）
let tatView='todo';         // todo 待记录 | done 已记录
let tatLimit=LIST_PAGE;            // 列表每次显示的条数（显示更多 +30）
let tatBar={ pending:[], done:[], stats:{} };   // 当前范围内的课次（已按可见专业过滤）和各课次出席统计
let tatExisting={};         // 当前打开课次已有的记录：student_id -> 最早的一条
let tatEditing=false;       // 当前是否在修改已有记录
const tatYmd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const tatIsCancelled=se=>!!(se&&(se.is_cancelled||se.session_title==='休讲'));   // 与 student/study.js 同一个判断
async function tatRenderSessionBar(){
  const bar=document.getElementById('tat_session_bar'); if(!bar) return;
  const set=tsaAllowedSet();
  const today=new Date(); const todayStr=tatYmd(today);
  // 本周 = 本周一到周日（能看到本周已经上过的课）
  const mon=new Date(today.getFullYear(),today.getMonth(),today.getDate()-((today.getDay()+6)%7));
  const sun=new Date(mon.getFullYear(),mon.getMonth(),mon.getDate()+6);
  // 拉可见专业的课次（course_sessions），按范围过滤；「全部」按日期倒序
  let q=`/rest/v1/course_sessions?select=id,course_name,course_id,session_number,session_date,session_title,time_range,major,is_cancelled&order=session_date.${tatRange==='all'?'desc':'asc'}&limit=1000`;
  if(tatRange==='today') q+=`&session_date=eq.${todayStr}`;
  else if(tatRange==='week') q+=`&session_date=gte.${tatYmd(mon)}&session_date=lte.${tatYmd(sun)}`;
  let all=await sb(q).catch(()=>[]);
  // 「不记出席」的课不出现在点名列表里（还没加这一列时查询会失败，当作都要点名）
  const noAtt=new Set((await sb('/rest/v1/courses?attendance_mode=eq.none&select=id').catch(()=>[])||[]).map(c=>String(c.id)));
  if(noAtt.size) all=all.filter(se=>!noAtt.has(String(se.course_id)));
  all=all.filter(se=>!tatIsCancelled(se));   // 休讲的回次不点名
  // 专业过滤（可见专业）
  if(set){ all=all.filter(se=>{ const mj=se.major||[]; return (Array.isArray(mj)?mj:[mj]).some(m=>tsaMajorOk(m)|| (isMajorGroup(m)&&groupMajors(m).some(x=>tsaMajorOk(x)))); }); }
  // 各课次已有的出席记录 → 区分待记录 / 已记录，并统计
  const stats={};
  const chunks=[]; for(let i=0;i<all.length;i+=100) chunks.push(all.slice(i,i+100).map(se=>`"${se.id}"`).join(','));
  try{
    const parts=await Promise.all(chunks.map(ids=>sbAll(`/rest/v1/session_records?session_id=in.(${ids})&select=id,session_id,student_id,attendance_status`).catch(()=>[])));
    parts.flat().forEach(r=>{
      const st=stats[r.session_id]||(stats[r.session_id]={present:0,late:0,leave:0,absent:0,n:0}); st.n++;
      const v=r.attendance_status||'';
      if(['offline','online','replay'].includes(v)) st.present++; else if(v==='offline_late'||v==='online_late') st.late++; else if(v==='leave') st.leave++; else st.absent++;
    });
  }catch(e){}
  tatBar={ pending:all.filter(se=>!stats[se.id]), done:all.filter(se=>stats[se.id]), stats };
  tatSessions=tatBar.pending.concat(tatBar.done);
  tatBarRender();
}
function tatBarRender(){
  const bar=document.getElementById('tat_session_bar'); if(!bar) return;
  const list=tatView==='done'?tatBar.done:tatBar.pending, shown=list.slice(0,tatLimit);
  const btn=(on,oc,l)=>`<button onclick="${oc}" style="font-size:12px;padding:5px 14px;border:1px solid var(--border);border-radius:5px;cursor:pointer;font-family:inherit;background:${on?'var(--accent,#b8953a)':'var(--bg)'};color:${on?'#fff':'var(--text-2)'}">${l}</button>`;
  const rng=tatRange==='today'?'今天':tatRange==='week'?'本周':'';
  bar.innerHTML=`
    <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">
      ${[['today','今天'],['week','本周'],['all','全部']].map(([k,l])=>btn(tatRange===k,`tatRange='${k}';tatLimit=LIST_PAGE;tatRenderSessionBar()`,l)).join('')}
    </div>
    <div style="display:flex;gap:6px;margin-bottom:10px;align-items:center;flex-wrap:wrap">
      ${btn(tatView==='todo',`tatView='todo';tatLimit=LIST_PAGE;tatBarRender()`,`待记录 ${tatBar.pending.length}`)}${btn(tatView==='done',`tatView='done';tatLimit=LIST_PAGE;tatBarRender()`,`已记录 ${tatBar.done.length}`)}
    </div>
    ${shown.length? `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">${shown.map(se=>{
      const d=new Date(se.session_date+'T12:00:00'); const dow='日一二三四五六'[d.getDay()];
      const st=tatBar.stats[se.id];
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600;color:var(--text)">${(d.getMonth()+1)}/${d.getDate()} <span style="font-size:10px;color:var(--text-3)">周${dow}</span></span>
        <span style="font-size:12px">${tsaEsc(se.course_name)} <span style="font-size:10px;color:var(--text-3)">第${se.session_number}回${se.session_title?' · '+tsaEsc(se.session_title):''}</span></span>
        ${st?`<span style="font-size:10px;color:var(--text-2)">已记录 · 出席 ${st.present} / 迟到 ${st.late} / 请假 ${st.leave} / 缺席 ${st.absent}</span>`:''}
        <button onclick="tatOpen('${se.id}')" style="margin-left:auto;font-size:12px;padding:5px 14px;background:var(--accent,#b8953a);color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit">${st?'✏ 修改出席':'📝 记录出席'}</button>
      </div>`;
    }).join('')}</div>
    ${list.length>shown.length?`<div style="text-align:center;margin:-6px 0 14px"><button onclick="tatLimit+=LIST_PAGE;tatBarRender()" style="font-size:12px;padding:5px 18px;border:1px solid var(--border);border-radius:5px;background:var(--bg);cursor:pointer;font-family:inherit">加载更多（还有 ${list.length-shown.length} 节）</button></div>`:''}`
    : `<div style="font-size:12px;color:var(--text-3);padding:12px;text-align:center;margin-bottom:14px">${rng}没有${tatView==='done'?'已记录':'待记录'}的课次${tatView==='todo'&&tatBar.done.length?'（记过的在「已记录」里，可以修改）':''}</div>`}
  `;
}

async function tatOpen(sessionId){
  const se=tatSessions.find(x=>x.id===sessionId)||await sb(`/rest/v1/course_sessions?id=eq.${sessionId}&select=*`).then(r=>r&&r[0]).catch(()=>null);
  if(!se){ alert('课次未找到'); return; }
  tatCurSession=se;
  if(tatIsCancelled(se)){
    let ov=document.getElementById('tatOverlay');
    if(!ov){ov=document.createElement('div');ov.id='tatOverlay';ov.style.cssText='position:fixed;inset:0;z-index:980;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:16px';document.body.appendChild(ov);}
    ov.style.display='flex';
    ov.innerHTML=`<div style="background:var(--surface);border-radius:10px;padding:16px 18px;width:min(420px,96vw);margin:auto">
      <div style="font-size:15px;font-weight:600;margin-bottom:4px">${tsaEsc(se.course_name)} 第${se.session_number}回</div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">${se.session_date}</div>
      <div style="font-size:13px;color:var(--text-2);margin-bottom:14px">这一回是休讲，不记出席</div>
      <button onclick="document.getElementById('tatOverlay').style.display='none'" style="font-size:12px;padding:5px 14px;border:1px solid var(--border);border-radius:5px;background:var(--bg);cursor:pointer;font-family:inherit">关闭</button>
    </div>`;
    return;
  }
  // 该课的成员学生（全部，不受可见范围限制——记出席要全班；成员规则见 shared/constants.js 的 courseMemberIds）
  const majors=Array.isArray(se.major)?se.major:(se.major?[se.major]:[]);
  const [all,crs,cms,recs]=await Promise.all([
    sbAll('/rest/v1/students?select=*&status=eq.active&order=name.asc').catch(()=>[]),
    se.course_id?sb(`/rest/v1/courses?id=eq.${encodeURIComponent(se.course_id)}&select=*`).catch(()=>[]):Promise.resolve([]),
    se.course_id?sb(`/rest/v1/course_members?course_id=eq.${encodeURIComponent(se.course_id)}&select=course_id,student_id,kind`).catch(()=>[]):Promise.resolve([]),
    sbAll(`/rest/v1/session_records?session_id=eq.${encodeURIComponent(se.id)}&select=*`).catch(()=>[])
  ]);
  const c=(crs||[])[0]||{};
  const course=Object.assign({id:se.course_id},c,{major:majors.length?majors:(c.major||[])});
  const ids=courseRequiredIds(course,all||[],cms||[]);
  tatStudents=(all||[]).filter(s=>ids.has(String(s.id)));
  // 组内开放的课：同专业组、不是成员的在读学生 = 选修（只记来了的人）
  const elIds=courseElectiveIds(course,all||[],cms||[]);
  tatElectives=(all||[]).filter(s=>elIds.has(String(s.id))).map(s=>Object.assign({},s,{_elective:true}));
  tatElOpen=false;
  // 已有记录：每个学生取最早的一条（以前重复保存留下的多条，只更新最早那条）
  tatExisting={};
  (recs||[]).slice().sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id).localeCompare(String(b.id))).forEach(r=>{ if(r.student_id&&!tatExisting[r.student_id]) tatExisting[r.student_id]=r; });
  // 有记录、但现在已不在成员名单 / 不在籍的学生也要带出来，不然改不了
  const missing=Object.keys(tatExisting).filter(id=>!tatStudents.some(s=>String(s.id)===String(id))&&!tatElectives.some(s=>String(s.id)===String(id)));
  if(missing.length){ const extra=await sb(`/rest/v1/students?id=in.(${missing.map(x=>`"${x}"`).join(',')})&select=*`).catch(()=>[]); tatStudents=tatStudents.concat(extra||[]); }
  tatStudents.sort((a,b)=>a.name.localeCompare(b.name,'zh'));
  tatPre=tatStudents.filter(x=>!sessionCountsFor(x,se.session_date)); tatPreOpen=false;
  if(tatPre.length) tatStudents=tatStudents.filter(x=>sessionCountsFor(x,se.session_date));
  tatElectives.sort((a,b)=>a.name.localeCompare(b.name,'zh'));
  tatEditing=Object.keys(tatExisting).length>0;
  tatEdits={}; tatState='present'; tatMode='offline';
  tatStudents.concat(tatElectives,tatPre).forEach(s=>{ const r=tatExisting[s.id]; if(r&&r.attendance_status) tatEdits[s.id]={attendance_status:r.attendance_status,student_mode:r.student_mode||s.default_mode||'offline'}; });
  tatRenderModal();
}

function tatCurStatus(){ if(tatState==='leave')return'leave'; if(tatState==='late')return tatMode==='online'?'online_late':'offline_late'; return tatMode==='online'?'online':'offline'; }
function tatStatusFull(v){const m={online:{t:'线上出席',c:'#2a6aad'},offline:{t:'线下出席',c:'var(--ok,#2a9e6a)'},replay:{t:'录播回看',c:'var(--warn,#b8860b)'},online_late:{t:'线上迟到',c:'#b8860b'},offline_late:{t:'线下迟到',c:'#b8860b'},leave:{t:'请假',c:'var(--text-3,#999)'}};return m[v]||{t:v||'缺席',c:'var(--danger,#b03a2e)'};}
function tatPickState(st){tatState=st;['present','late','leave'].forEach(k=>{const b=document.getElementById('tat_st_'+k);if(b){const on=k===st;b.style.background=on?'var(--accent,#b8953a)':'var(--bg)';b.style.color=on?'#fff':'var(--text-2)';}});const mw=document.getElementById('tat_mode_wrap');if(mw)mw.style.display=(st==='leave')?'none':'flex';}
function tatPickMode(md){tatMode=md;['offline','online'].forEach(k=>{const b=document.getElementById('tat_md_'+k);if(b){const on=k===md;b.style.background=on?'#2a6aad':'var(--bg)';b.style.color=on?'#fff':'var(--text-2)';}});}
function tatMark(sid){const s=tatStudents.concat(tatElectives,tatPre).find(x=>x.id===sid);if(!s)return;if(!tatEdits[sid])tatEdits[sid]={};tatEdits[sid].attendance_status=tatCurStatus();tatEdits[sid].student_mode=(tatState==='leave')?(s.default_mode||'offline'):tatMode;tatRenderRows();}
function tatUnmark(sid){if(tatEdits[sid])tatEdits[sid].attendance_status='';tatRenderRows();}

function tatRenderModal(){
  let ov=document.getElementById('tatOverlay');
  if(!ov){ov=document.createElement('div');ov.id='tatOverlay';ov.style.cssText='position:fixed;inset:0;z-index:980;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:16px';document.body.appendChild(ov);}
  ov.style.display='flex';
  const se=tatCurSession; const d=new Date(se.session_date+'T12:00:00');
  ov.innerHTML=`<div style="background:var(--surface);border-radius:10px;padding:16px 18px;width:min(560px,96vw);margin:auto">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
      <div><div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600">${tsaEsc(se.course_name)} 第${se.session_number}回${tatEditing?' <span style="font-family:inherit;font-size:10px;font-weight:500;color:var(--accent,#b8953a);border:1px solid var(--accent,#b8953a);border-radius:3px;padding:1px 6px;vertical-align:middle">修改已有记录</span>':''}</div>
      <div style="font-size:11px;color:var(--text-3)">${se.session_date} ${se.time_range||''}</div></div>
      <button onclick="document.getElementById('tatOverlay').style.display='none'" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:5px;background:var(--bg);cursor:pointer;font-family:inherit">关闭</button>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <div style="display:flex;border:1px solid var(--border);border-radius:5px;overflow:hidden">
        <button id="tat_st_present" onclick="tatPickState('present')" style="font-size:12px;padding:5px 12px;border:none;cursor:pointer;font-family:inherit;background:var(--accent,#b8953a);color:#fff">出席</button>
        <button id="tat_st_late" onclick="tatPickState('late')" style="font-size:12px;padding:5px 12px;border:none;border-left:1px solid var(--border);cursor:pointer;font-family:inherit;background:var(--bg);color:var(--text-2)">迟到</button>
        <button id="tat_st_leave" onclick="tatPickState('leave')" style="font-size:12px;padding:5px 12px;border:none;border-left:1px solid var(--border);cursor:pointer;font-family:inherit;background:var(--bg);color:var(--text-2)">请假</button>
      </div>
      <div id="tat_mode_wrap" style="display:flex;border:1px solid var(--border);border-radius:5px;overflow:hidden">
        <button id="tat_md_offline" onclick="tatPickMode('offline')" style="font-size:12px;padding:5px 12px;border:none;cursor:pointer;font-family:inherit;background:#2a6aad;color:#fff">线下</button>
        <button id="tat_md_online" onclick="tatPickMode('online')" style="font-size:12px;padding:5px 12px;border:none;border-left:1px solid var(--border);cursor:pointer;font-family:inherit;background:var(--bg);color:var(--text-2)">线上</button>
      </div>
      <button onclick="tatSummary()" style="font-size:11px;padding:5px 10px;border:1px solid var(--border);border-radius:5px;background:var(--bg);cursor:pointer;font-family:inherit;margin-left:auto">📋汇总</button>
    </div>
    <input id="tat_search" placeholder="搜索姓名（汉字 / 拼音首字母）/ 专业…" oninput="searchBox(this,tatRenderRows)" style="font-size:12px;padding:6px 10px;width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;margin-bottom:8px">
    <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">未点名 <span id="tat_cnt"></span>（点名字=当前状态）</div>
    <div id="tat_body" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px;max-height:42vh;overflow-y:auto"></div>
    <div id="tat_el_wrap"></div>
    <div id="tat_marked" style="border-top:1px solid var(--border);padding-top:8px;margin-bottom:12px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('tatOverlay').style.display='none'" style="font-size:12px;padding:8px 16px;border:1px solid var(--border);border-radius:5px;background:var(--bg);cursor:pointer;font-family:inherit">关闭</button>
      <button onclick="tatSave()" id="tat_save" style="font-size:12px;padding:8px 18px;border:none;border-radius:5px;background:var(--accent,#b8953a);color:#fff;cursor:pointer;font-family:inherit">保存全部</button>
    </div>
  </div>`;
  tatPickState('present'); tatPickMode('offline'); tatRenderRows();
}

function tatRenderRows(){
  const kw=(document.getElementById('tat_search')?.value||'').trim();
  const marked=tatStudents.concat(tatElectives,tatPre).filter(s=>tatEdits[s.id]&&tatEdits[s.id].attendance_status);
  const unmarked=tatStudents.filter(s=>!(tatEdits[s.id]&&tatEdits[s.id].attendance_status));
  const shown=kw?unmarked.filter(s=>matchesStudentSearch(s,kw)):unmarked;
  const body=document.getElementById('tat_body');
  if(body) body.innerHTML=shown.length?shown.map(s=>`<button onclick="tatMark('${s.id}')" style="font-family:'Noto Serif SC',serif;font-size:13px;font-weight:600;padding:11px 4px;border:1px solid var(--border);border-radius:8px;background:var(--surface);cursor:pointer;color:var(--text)">${s.name}</button>`).join(''):`<div style="grid-column:1/-1;font-size:12px;color:var(--text-3);padding:16px;text-align:center">${kw?'无匹配':'全部已点 ✓'}</div>`;
  const cnt=document.getElementById('tat_cnt'); if(cnt)cnt.textContent=`剩 ${unmarked.length} 人`;
  const elw=document.getElementById('tat_el_wrap');
  if(elw){
    let preHtml='';
    const preLeft=tatPre.filter(s=>!(tatEdits[s.id]&&tatEdits[s.id].attendance_status));
    if(preLeft.length){
      const popen=tatPreOpen||!!kw;
      const pshown=kw?preLeft.filter(s=>matchesStudentSearch(s,kw)):preLeft;
      preHtml=`<div style="margin-bottom:10px"><div onclick="tatPreOpen=!tatPreOpen;tatRenderRows()" style="font-size:12px;color:var(--text-2);cursor:pointer;padding:6px 0">未报名（这节课在报名之前）· ${preLeft.length} 人 ${popen?'▾':'▸'}</div>`+(popen?`<div style="font-size:10px;color:var(--text-3);margin-bottom:6px">不算缺席；来旁听的点一下即可记录</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-height:28vh;overflow-y:auto">${pshown.length?pshown.map(s=>`<button onclick="tatMark('${s.id}')" style="font-family:'Noto Serif SC',serif;font-size:13px;font-weight:600;padding:9px 4px;border:1px dashed var(--border);border-radius:8px;background:var(--surface);cursor:pointer;color:var(--text)">${s.name}<span style="display:block;font-size:9px;font-weight:400;color:var(--text-3)">${signupNote(s,'9999')}</span></button>`).join(''):`<div style="grid-column:1/-1;font-size:12px;color:var(--text-3);padding:10px;text-align:center">无匹配</div>`}</div>`:'')+`</div>`;
    }
    if(!tatElectives.length) elw.innerHTML=preHtml;
    else{
      const elLeft=tatElectives.filter(s=>!(tatEdits[s.id]&&tatEdits[s.id].attendance_status));
      const elShown=kw?elLeft.filter(s=>matchesStudentSearch(s,kw)):elLeft;
      const open=tatElOpen||!!kw;
      elw.innerHTML=preHtml+`<div style="margin-bottom:10px"><div onclick="tatElOpen=!tatElOpen;tatRenderRows()" style="font-size:12px;color:var(--text-2);cursor:pointer;padding:6px 0">同组其他专业（选修）· ${tatElectives.length} 人 ${open?'▾':'▸'}</div>`+
        (open?`<div style="font-size:10px;color:var(--text-3);margin-bottom:6px">只点来了的人，没来的不用点（不算缺席）</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-height:28vh;overflow-y:auto">${elShown.length?elShown.map(s=>`<button onclick="tatMark('${s.id}')" style="font-family:'Noto Serif SC',serif;font-size:13px;font-weight:600;padding:9px 4px;border:1px dashed var(--border);border-radius:8px;background:var(--surface);cursor:pointer;color:var(--text)">${s.name}<span style="display:block;font-size:9px;font-weight:400;color:var(--text-3)">${tsaEsc(MAJORS[s.major]||s.major||'')}</span></button>`).join(''):`<div style="grid-column:1/-1;font-size:12px;color:var(--text-3);padding:10px;text-align:center">${kw?'无匹配':'没有更多了'}</div>`}</div>`:'')+`</div>`;
    }
  }
  const area=document.getElementById('tat_marked');
  if(area){const g={};marked.forEach(s=>{const st=tatEdits[s.id].attendance_status;(g[st]=g[st]||[]).push(s);});
    const order=['offline','online','replay','offline_late','online_late','leave'];const keys=Object.keys(g).sort((a,b)=>order.indexOf(a)-order.indexOf(b));
    area.innerHTML=`<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">已点 ${marked.length} · 未点 ${unmarked.length}（记为缺席）</div>`+(keys.map(st=>{const i=tatStatusFull(st);return `<div style="margin-bottom:8px"><span style="font-size:11px;font-weight:600;color:${i.c}">${i.t}（${g[st].length}）</span> <span style="display:inline-flex;flex-wrap:wrap;gap:6px">${g[st].map(s=>`<span onclick="tatUnmark('${s.id}')" style="font-size:12px;padding:3px 10px;border-radius:12px;background:var(--bg);border:1px solid ${i.c};color:${i.c};cursor:pointer">${s.name}${s._elective?'（选修）':''} ✕</span>`).join('')}</span></div>`;}).join('')||'<div style="font-size:11px;color:var(--text-3)">还没点名</div>');}
}

function tatSummary(){
  const g={present_off:[],present_on:[],late:[],leave:[],absent:[]};
  tatStudents.concat(tatElectives.filter(s=>(tatEdits[s.id]||{}).attendance_status),tatPre.filter(s=>(tatEdits[s.id]||{}).attendance_status)).forEach(s=>{const st=(tatEdits[s.id]||{}).attendance_status||'';if(st==='offline')g.present_off.push(s.name);else if(st==='online')g.present_on.push(s.name);else if(st==='offline_late'||st==='online_late')g.late.push(s.name);else if(st==='leave')g.leave.push(s.name);else g.absent.push(s.name);});
  let ov=document.getElementById('tatSumOv');if(!ov){ov=document.createElement('div');ov.id='tatSumOv';ov.style.cssText='position:fixed;inset:0;z-index:995;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px';document.body.appendChild(ov);}
  ov.style.display='flex';
  ov.innerHTML=`<div style="background:#fff;border-radius:8px;padding:20px;max-width:520px;width:100%;max-height:82vh;overflow:auto">
    <div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600;margin-bottom:4px">${tsaEsc(tatCurSession.course_name)} 第${tatCurSession.session_number}回</div>
    <div style="font-size:11px;color:#999;margin-bottom:12px">📸 可截图对照</div>
    ${[['线下出席',g.present_off,'#2a9e6a'],['线上出席',g.present_on,'#2a6aad'],['迟到',g.late,'#b8860b'],['请假',g.leave,'#999'],['缺席',g.absent,'#b03a2e']].map(([l,a,c])=>`<div style="margin-bottom:10px"><div style="font-size:12px;font-weight:600;color:${c};margin-bottom:3px">${l}（${a.length}人）</div><div style="font-size:13px;line-height:1.9;color:#333">${a.join('、')||'—'}</div></div>`).join('')}
    <button onclick="document.getElementById('tatSumOv').style.display='none'" style="font-size:12px;padding:7px 16px;border:none;border-radius:5px;background:var(--accent,#b8953a);color:#fff;cursor:pointer;font-family:inherit">关闭</button>
  </div>`;
}

async function tatSave(){
  const se=tatCurSession; const btn=document.getElementById('tat_save');
  if(btn){btn.textContent='保存中…';btn.disabled=true;}
  try{
    const news=[], updates=[], dels=[];
    tatStudents.concat(tatElectives,tatPre).forEach(s=>{
      const e=tatEdits[s.id]||{};
      if(s._elective&&!e.attendance_status){   // 选修：没来的人不建记录；撤回已点的就删掉记录
        if(tatExisting[s.id]) dels.push(tatExisting[s.id].id);
        return;
      }
      const status=e.attendance_status||'', mode=e.student_mode||s.default_mode||'offline';
      const old=tatExisting[s.id];
      if(old){   // 已有记录：只更新出席状态和上课方式，不动作业相关字段（homework_submitted / homework_file_url 等）
        if((old.attendance_status||'')!==status||(old.student_mode||'')!==mode) updates.push({id:old.id,patch:{attendance_status:status,student_mode:mode}});
      } else news.push({
        id:`r-${Date.now()}-${Math.random().toString(36).slice(2,5)}-${s.id.slice(-3)}`,
        session_id:se.id, course_name:se.course_name, session_date:se.session_date,
        student_id:s.id, student_name:s.name, major:s.major,
        student_mode:mode, attendance_status:status,
      });
    });
    for(const id of dels){ await sb(`/rest/v1/session_records?id=eq.${encodeURIComponent(id)}`,'DELETE'); }
    // 分批 PATCH 已有记录
    for(let i=0;i<updates.length;i+=10){ await Promise.all(updates.slice(i,i+10).map(u=>sb(`/rest/v1/session_records?id=eq.${encodeURIComponent(u.id)}`,'PATCH',u.patch))); }
    // 分批 POST 新记录
    for(let i=0;i<news.length;i+=20){ await sb('/rest/v1/session_records','POST',news.slice(i,i+20)); }
    document.getElementById('tatOverlay').style.display='none';
    alert(`✓ 已${tatEditing?'更新':'保存'} ${se.course_name} 第${se.session_number}回 出席（${tatStudents.length} 人${tatEditing?`，修改 ${updates.length} 条、新增 ${news.length} 条`:''}）`);
    tsrRecCache={}; smsCtxCache={}; tsrAllCtx=null;   // 学生出席历史、月度统计缓存作废
    if(document.getElementById('tsr_list')) tsrLoadStats();   // 列表上的统计立刻刷新
    tatRenderSessionBar();  // 刷新课次列表（这一节出现在「已记录」，统计更新）
  }catch(e){ alert('保存失败：'+e.message); if(btn){btn.textContent='保存全部';btn.disabled=false;} }
}

async function renderTsaRecords(box) {
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    tsrStudents = (await tsmLoadPool()).slice();   // 全部状态（已按可见范围裁剪）；由全局「状态」筛选
    smsCtxCache = {}; tsrCtx = null; tsrAllCtx = null;   // 每次进入页面都重新读最新的出席・作业
  } catch (e) { box.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }
  tsrRender();
}

let tsrHistOpen=true;
let tsrYm=null;          // 统计月份：'YYYY-MM'，'' = 全部；null = 还没选过（默认本月）
let tsrCtx=null;         // 当前月份的统计数据（smsLoad）；null = 加载中
let tsrCtxErr='';
let tsrAllCtx=null;      // 全部（2026年10月期起）的统计数据：当前期缺席提醒、「全部」视图用
function tsrAtt(v) {
  if (!v) return { t:'缺席', c:'var(--danger,#b03a2e)' };
  return ({
    offline: { t:'线下出席', c:'var(--ok,#2a9e6a)' },
    online:  { t:'线上出席', c:'#2a6aad' },
    replay:  { t:'录播回看', c:'var(--warn,#b8860b)' },
    leave:   { t:'请假',     c:'var(--text-3,#999)' },
  })[v] || { t:v, c:'var(--text-2,#666)' };
}


// 打开页面 / 换月份时，一次性批量加载统计（不再逐个学生点开才加载）
async function tsrLoadStats() {
  const ym = tsrYm;
  tsrCtx = null; tsrCtxErr = '';
  try { const c = await smsLoad(ym); if (tsrYm === ym) tsrCtx = c; }
  catch (e) { if (tsrYm === ym) tsrCtxErr = (e && e.message) || String(e); }
  if (tsrYm === ym) tsrRenderList();
  if (!tsrAllCtx) { try { tsrAllCtx = await smsLoad(''); if (tsrYm === ym) tsrRenderList(); } catch (e) { /* 缺席提醒暂不可用 */ } }
}
function tsrSetYm(ym) { tsrYm = ym; tsmShown = TSM_PAGE; tsrRender(); }

// 大课 / VIP 切换；VIP 部分用 shared/vip-lessons.js（和 admin 同一套，只查看）
let tsrKind = 'big';
function tsrSetKind(k) { tsrKind = k; tsrRender(); }
// 有查看权限：照学生范围（含来源限制）；只有登记权限（只是上 VIP 课的老师）：只看自己上的课
function tsrRenderVip(box, kindBar, rp) {
  box.innerHTML = `<div>${kindBar}${rp.view ? '' : '<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">这里只显示你自己上的 VIP 课</div>'}<div id="tsr_vip_box"></div></div>`;
  const mine = b => b.assigned_teacher ? b.assigned_teacher === teacherName : (cachedTeacherSlots || []).some(sl => sl.id === b.slot_id);
  vlMount(document.getElementById('tsr_vip_box'), {
    requireStudent: rp.view,
    students: () => tsaFilterStudents(tsrStudents),
    bookingOk: rp.view ? null : mine,
    // 补记录 / 修改：跳到现有的 VIP 上课记录弹窗（保存后让下次重新读取）
    recordBtn: b => (b.status !== 'cancelled' && (cachedTeacherBookings || []).some(x => x.id === b.id))
      ? `<button class="btn btn-outline btn-sm" onclick="VL.loadedYm='';openVipSessionRecord('${b.id}')">去上课记录</button>` : '',
  });
}
function tsrRender() {
  const box = document.getElementById('sm_content');
  if (!box) return;
  if (tsrYm === null) tsrYm = tmCurYm();
  const rp = smRecPerm();   // view 查看 / entry 登记
  if (tsrKind === 'big' && tsrStudents.length && !tsrBigStudents().length) tsrKind = 'vip';   // 名下全是纯 VIP（没有大课）：直接看 VIP
  const kindBar = `<div style="display:flex;gap:5px;margin-bottom:10px">${[['big','大课'],['vip','VIP']].map(([k,l])=>`<div class="filter-chip${tsrKind===k?' active':''}" onclick="tsrSetKind('${k}')" style="padding:4px 14px">${l}</div>`).join('')}</div>`;
  if (tsrKind === 'vip') { tsrRenderVip(box, kindBar, rp); return; }
  const cur = tmCurYm();
  const arrow = (n, tx) => tsrYm ? `<span onclick="tsrSetYm('${tmShiftYm(tsrYm, n)}')" style="cursor:pointer;user-select:none;font-size:13px;padding:2px 10px;border:1px solid var(--border);border-radius:3px;background:var(--surface)">${tx}</span>` : '';

  box.innerHTML = `<div>
    ${kindBar}
    <!-- 签到区（选课→点名字记出席），只有登记权限才显示 -->
    ${rp.entry ? '<div id="tat_session_bar" style="margin-bottom:6px"></div>' : ''}
    ${(rp.entry && typeof awTeacherIsArt === 'function' && awTeacherIsArt()) ? '<div id="aw_teacher_box"></div>' : ''}
    <!-- 学生出席统计（可收起），只有查看权限才显示 -->
    ${rp.view ? `<div onclick="tsrHistOpen=!tsrHistOpen;tsrRender()" style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-2);padding:8px 0;border-top:1px solid var(--border);user-select:none">${tsrHistOpen?'▾':'▸'} 学生出席・作业（<span id="tsr_n">${tsmFilterStudents(tsrBigStudents()).length}</span> 人，点击${tsrHistOpen?'收起':'展开'}）</div>
    <div style="display:${tsrHistOpen?'block':'none'}">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      ${arrow(-1, '‹')}<span style="font-size:13px;font-weight:600;min-width:92px;text-align:center">${tsrYm ? tsrYm.replace('-', '年') + '月' : '全部月份'}</span>${arrow(1, '›')}
      ${tsrYm ? `<div class="filter-chip" onclick="tsrSetYm('')" style="padding:3px 10px;font-size:10px">全部</div>` : `<div class="filter-chip active" style="padding:3px 10px;font-size:10px">全部</div>`}
      ${tsrYm === cur ? '' : `<span onclick="tsrSetYm('${cur}')" style="font-size:10px;color:var(--accent);cursor:pointer">回到本月</span>`}
      <span style="font-size:10px;color:var(--text-3)">已上 = 已点过名的课次（没点名的不算缺席，单独提示）；出勤率 = (出席+迟到) ÷ 已上，低于 80% 标橙色；「全部」按期数列出（2026年10月期起）</span>
    </div>
    <div id="tsr_list"></div>
  </div>` : ''}
  </div>`;
  if (rp.view && tsrHistOpen) { tsrRenderList(); if (!tsrCtx || tsrCtx.ym !== tsrYm) tsrLoadStats(); }
  if(rp.entry && typeof tatRenderSessionBar==='function') tatRenderSessionBar();
  if(document.getElementById('aw_teacher_box')) awTeacherMount('aw_teacher_box', tsmFilterStudents(tsrBigStudents()));   // 学部美术：🎨 作业收集
}

function tsrStatsHtml(s) {
  if (tsrCtxErr) return `<span style="font-size:10px;color:var(--danger)">统计加载失败</span>`;
  if (!tsrCtx || tsrCtx.ym !== tsrYm) return `<span style="font-size:10px;color:var(--text-3)">统计加载中…</span>`;
  const st = tsrYm ? studentMonthStats(s, tsrCtx) : studentPeriodStats(s, tsrCtx).cur;   // 「全部」视图：列表行显示当前期
  const word = tsrYm ? '本月' : '本期';
  let abs = '';
  if (tsrAllCtx) { const a = smsCurAbsent(s, tsrAllCtx); if (a.n >= 3) abs = `<span style="font-size:10px;padding:1px 8px;border-radius:10px;background:#fdecea;color:#c0392b;white-space:nowrap">⚠ 缺席 ${a.n} 次</span>`; }
  if (!st.total) return `${abs}<span style="font-size:10px;color:var(--text-3)">${word}无课次</span>${smsElectiveText(st) ? `<span style="font-size:11px;color:var(--text-3)">${smsElectiveText(st)}</span>` : ''}`;
  const low = st.rate != null && st.rate < 80;
  const marks = st.marks.slice(-40).map(m => { const d = TSR_MARK[m.mark]; return `<span title="${tsaEsc(m.date)} ${tsaEsc(m.course)}：${d[3]}${m.hw ? (m.hw === 'done' ? ' · 作业已交' : ' · 作业未交') : ''}" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:3px;font-size:9px;border:1px solid ${d[1]};background:${d[2]};color:${d[1]}">${d[0]}</span>`; }).join('');
  return `${abs}<span style="font-size:11px;color:var(--text-2)"><span style="${low ? 'color:#c9731a;font-weight:600' : ''}">${smsAttText(st)}</span> · 请假 ${st.leave} · 缺席 ${st.absent} · ${smsHwText(st, word)}${smsElectiveText(st) ? ` · <span style="color:var(--text-3)">${smsElectiveText(st)}</span>` : ''}${st.untaken ? ` <span style="font-size:10px;color:var(--text-3)">· 未点名 ${st.untaken} 回</span>` : ''}</span><span style="display:inline-flex;gap:2px;flex-wrap:wrap">${marks}</span>`;
}
// 「全部」视图展开：按期数各一行 + 总计
function tsrPeriodsHtml(s) {
  if (!tsrCtx || tsrCtx.ym !== tsrYm) return '';
  const ps = studentPeriodStats(s, tsrCtx);
  if (!ps.periods.length) return '';
  const row = (name, st, bold) => `<div style="font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-light);${bold ? 'font-weight:600' : ''}"><span style="display:inline-block;min-width:100px">${tsaEsc(name)}</span>${smsAttText(st)} · ${smsHwText(st)}${st.untaken ? ` <span style="font-size:10px;color:var(--text-3)">· 未点名 ${st.untaken} 回</span>` : ''}</div>`;
  return `<div style="margin-bottom:10px">${ps.periods.map(p => row(p.key, p.st)).join('')}${row('总计', ps.total, true)}</div>`;
}

function tsrRenderList() {
  const el = document.getElementById('tsr_list'); if (!el) return;
  const listAll = tsmFilterStudents(tsrBigStudents());
  const list = tsmSlice(listAll);
  const n = document.getElementById('tsr_n'); if (n) n.textContent = listAll.length;
  el.innerHTML = `<div style="border:1px solid var(--border);border-radius:4px;overflow:hidden">
      ${list.length ? list.map(s => {
        const recs = tsrRecCache[s.id];
        return `<div>
        <div onclick="tsrToggle('${s.id}')" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);${tsrExpandedId === s.id ? 'background:var(--bg)' : ''}">
          <span style="font-size:12px;font-weight:600">${tsaEsc(s.name)}</span>
          <span style="font-size:10px;color:var(--text-3)">${MAJORS[s.major] || s.major || ''}${s.level ? ' · ' + s.level : ''}</span>
          <span style="margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${tsrStatsHtml(s)}</span>
          <span style="font-size:10px;color:var(--text-3)">${tsrExpandedId === s.id ? '▲' : '▼'}</span>
        </div>
        ${tsrExpandedId === s.id ? `<div style="padding:8px 12px;background:var(--bg);border-bottom:1px solid var(--border)">
          ${tsrYm ? '' : tsrPeriodsHtml(s)}
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
    ${tsmMoreHtml(listAll.length)}`;
}

async function tsrToggle(id) {
  tsrExpandedId = tsrExpandedId === id ? null : id;
  tsrRenderList();
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
    tsrRecCache[id] = recs.filter(r => sessionCountsFor(s, r.session_date) || ['offline', 'online', 'replay', 'offline_late', 'online_late'].includes(r.attendance_status))   // 报名前没出席的记录不显示
      .map(r => Object.assign({}, r, { course_name: r.course_name || (sesMap[r.session_id] && sesMap[r.session_id].course_name) || '' }));
  } catch (e) { tsrRecCache[id] = []; }
  if (tsrExpandedId === id) tsrRenderList();
}

// 面谈跟进（读取数据 / 月份状态 / 列表 / 补充记录弹窗）已挪到 shared/follow-up.js，老师端和管理端共用；这里只留老师端自己的入口

// 宿主：共用的面谈跟进读老师端全局筛选（领域 / 专业 / 状态 / 来源 / 搜索）和分页
fuSetHost({
  filter: l => fuOnlyActive(l).filter(s => tsmMatch(s, 'status')), query: () => tsm.q, slice: l => tsmSlice(l), more: n => tsmMoreHtml(n), reset: () => { tsmShown = TSM_PAGE; },
  box: () => document.getElementById('sm_content'),
  reload: () => renderTsaMeetings(document.getElementById('sm_content') || document.getElementById('mainContent')),
});
async function renderTsaMeetings(box) {
  box.innerHTML = '<div class="empty">加载中…</div>';
  if (!tmYm) tmYm = tmCurYm();
  try {
    const allStu = await sb('/rest/v1/students?select=id,name,major,source,status,course_type,student_code,class_ids,vip_teachers,owner_teachers,is_vip_course&limit=2000').catch(() => []);
    let myStudents = tsaFilterStudents(allStu);   // 全部状态；由全局「状态」筛选
    if (tsaGuaranteedLock()) myStudents = myStudents.filter(tsaIsGuaranteed);
    tmData = await tmLoadFollow(myStudents);
  } catch (e) { box.innerHTML = `<div class="empty">加载失败：${tsaEsc(e.message)}</div>`; return; }
  tmRenderShell();
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
  const box = document.getElementById('pgcnotes_' + sid);
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
  const box = document.getElementById('pgcnotes_' + sid);
  if (!box) return;
  const notes = tpNotesCache[sid] || [];
  box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px">
    <textarea id="tpnote_input_${sid}" rows="2" placeholder="记录该学生的评估、注意事项、交接备注…（如：笔试水平待评估；临近出愿需主动跟进）" onclick="event.stopPropagation()"
      style="width:100%;font-size:11px;line-height:1.8;padding:7px 9px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical"></textarea>
    <button onclick="event.stopPropagation();tpNoteSave('${sid}','${tsaEsc(sname)}')" style="margin-top:5px;font-size:10px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">保存记录</button>
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
  ['target_school','目标学校','textarea'],['notes','补充备注','textarea'],
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
    if (type === 'textarea') return `<textarea id="tse_${k}" rows="3" style="${inp};resize:vertical">${tsaEsc(v)}</textarea>`;
    return `<input id="tse_${k}" value="${tsaEsc(v)}" style="${inp}">`;
  };
  const modal = document.createElement('div');
  modal.id = 'tseModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:640px;width:100%;max-height:88vh;overflow-y:auto">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">✏ 修改学生档案 — ${tsaEsc(s.name)}</div>
    <div style="font-size:10px;color:var(--warn,#b8860b);margin-bottom:12px">⚠ 修改将直接覆盖 admin 学生档案的数据，并留下修改记录（admin 可查看与恢复），请谨慎操作。</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:12px">
      ${TSE_FIELDS.map(([k,l,t]) => `<div${t === 'textarea' ? ' style="grid-column:1/-1"' : ''}><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">${l}</label>${ctrl(k, t, s[k])}</div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('tseModal').remove()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 16px;cursor:pointer;font-family:inherit">取消</button>
      <button onclick="tseSave('${sid}')" style="font-size:12px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:3px;padding:7px 20px;cursor:pointer;font-family:inherit">保存修改</button>
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


// ── 老师端：考学进度里的志望校（添加 / 编辑 / 删除；表单与学生端共用 shared/schoolplan.js）──
function tpStudentOf(sid) { return ((teacherProgressData && teacherProgressData.students) || []).find(x => x.id === sid) || null; }
function tpPlanOf(planId) {
  let hit = null;
  Object.values((teacherProgressData && teacherProgressData.plansMap) || {}).forEach(list => { list.forEach(p => { if (p.id === planId) hit = p; }); });
  return hit;
}
function tpOperatorName() { return (typeof teacherData !== 'undefined' && teacherData && teacherData.name) || (typeof teacherName !== 'undefined' ? teacherName : '') || '老师'; }
// 保存 / 删除后只重读这个学生的志望校和时间线，重绘列表并保持卡片展开
async function tpReloadStudentPlans(sid) {
  const [plans, tl] = await Promise.all([
    sb(`/rest/v1/student_school_plans?student_id=eq.${encodeURIComponent(sid)}&select=*&order=level.asc`).catch(() => null),
    sb(`/rest/v1/student_progress_timeline?student_id=eq.${encodeURIComponent(sid)}&select=*&order=created_at.asc`).catch(() => null),
  ]);
  if (plans) teacherProgressData.plansMap[sid] = plans;
  if (tl) teacherProgressData.timelineMap[sid] = tl;
  tpRenderProgressList();
  const el = document.getElementById(`pgc_${sid}`);
  if (el && el.style.display === 'none') pgcToggle(sid);
}
function tpAddSchool(sid, prefill) {
  const stu = tpStudentOf(sid); if (!stu) return;
  spOpenModal({ student: stu, prefill, plans: teacherProgressData.plansMap[sid] || [], onDone: () => tpReloadStudentPlans(sid) });
}
function tpEditSchool(planId) {
  const plan = tpPlanOf(planId), stu = plan && tpStudentOf(plan.student_id);
  if (!plan || !stu) return;
  spOpenModal({ student: stu, plan, plans: teacherProgressData.plansMap[stu.id] || [], onDone: () => tpReloadStudentPlans(stu.id) });
}
function tpDelSchool(planId) {
  const plan = tpPlanOf(planId), stu = plan && tpStudentOf(plan.student_id);
  if (!plan || !stu) return;
  spDeletePlan(stu, plan, 'teacher', tpOperatorName(), () => tpReloadStudentPlans(stu.id));
}


// 重点关注（读取数据 / 列表 / 学生概要）已挪到 shared/follow-up.js，老师端和管理端共用；这里只留老师端自己的入口
async function renderTeacherFocus(box) {
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const all = await sb('/rest/v1/students?select=*&order=created_at.desc&limit=2000').catch(() => []);
    let list = tsaFilterStudents(all);   // 全部状态；由全局「状态」筛选
    if (tsaGuaranteedLock()) list = list.filter(tsaIsGuaranteed);
    await focusLoad(list);
    focusRender();
  } catch (e) {
    box.innerHTML = `<div class="empty" style="color:var(--danger)">重点关注加载失败：${(e && e.message) || e}</div>`;
    console.error('renderTeacherFocus error:', e);
  }
}
