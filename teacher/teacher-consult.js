// ══════════════════════════════════
// teacher-consult.js — 🧭 咨询（营业咨询台，需 permissions.consult）
// 营业开会议共享屏幕给潜在学生看。4 步：① 学生信息 → ② 专业与院校 → ③ 课程与方案 → ④ 最终升学计划
// 数据：consult_leads（咨询者档案，一人一行，RLS 只有录入人自己和管理员能看）、faq（常见问题）
// 复用现有数据：admission_schools（出愿）、courses（课程）、price_packages（价目）、success_cases（合格案例）、promo_content / promo_videos（专业介绍）
// 院校 4 种状态全部按规则判断，不用 AI。4-1 规划老师评语是 5 个分项：上半部分自动列出学生现状（只读），下半部分老师手填（consult_leads.comments）。
// 差距 → 课程 / 介绍：用内置关键词去现有宣传内容（课程介绍、课程安排、通用宣传）里找，不需要管理员配规则。
// 也可以单独打开：consult/?tid=xxx（window.__CONSULT_STANDALONE__），不经过老师端。
// 显示方式：进入咨询后整页只显示咨询台（body.consult-mode，样式在 teacher/consult.css，全部限定在 .cst-root 下）；首页是咨询者卡片，进入一位后「一项一页」，顶部进度条。
// 全局名字统一用 cst / CST_ 前缀。依赖：shared/constants.js、shared/supabase.js、teacher.js
// ══════════════════════════════════
let cst = {
  loaded: false, err: '', list: [], cur: null, step: 1, show: false, q: '', saving: '',
  adm: [], admKey: '', admLoading: false, admLimit: 30,
  courses: null, pkgs: null, profs: null, media: null, mediaTab: 'textbook', mediaQ: '', common: null, commonDom: '', profiles: null, tiers: null, cases: null, faqs: null, intro: null, introKey: '',
  open: {}, item: '1-1', overlay: '', faqQ: '', crsQ: '', crsLimit: 30, crsPer: 'next', crsScope: 'major', crsOther: '', crsCampus: '', dirty: {}, timer: null,
};

const CST_STEPS = [[1, '学生信息'], [2, '专业与院校'], [3, '课程与方案'], [4, '最终升学计划']];
const CST_STAGE = { 1: '信息采集', 2: '选校', 3: '课程', 4: '入学后' };
const CST_EDU = ['专科', '本科在读', '本科毕业', '硕士在读', '硕士毕业', '其他'];
const CST_JP_EXAMS = ['JLPT', 'J-TEST', 'EJU', 'BJT', '其他'];
const CST_EN_EXAMS = ['TOEFL', 'IELTS', 'TOEIC', '其他'];
const CST_LANG_ST = [['have', '已有成绩'], ['none', '未参加'], ['unrecorded', '有成绩未录入']];
const CST_KINDS = ['冲刺', '主申', '保底'];
const CST_ST = {
  ok: ['当前条件符合', '#1a5a3a', 'var(--ok-bg,#e6f2ea)'],
  short: ['补足条件后可考虑', '#8a6a1a', '#f6edd2'],
  manual: ['需要人工确认', '#4a4a8a', '#e8e8f4'],
  unfit: ['当前条件不符合', '#a03a2e', '#f6e2de'],
};
const CST_TIERS = [['0', 'T0 — 旧帝・一橋・東科大・早慶上智'], ['1', 'T1 — G-MARCH・関関同立・地方国公立'], ['2', 'T2 — 日駒東専・重点女子大・地方私立'], ['3', 'T3 — 其他']];
const CST_GAPS = [['jp', '日语成绩'], ['en', '英语成绩'], ['plan', '研究计划书・志望理由书'], ['interview', '面试'], ['written', '笔试'], ['specialty', '专业能力（跨专业补课）']];
const CST_ST_ORDER = { ok: 0, short: 1, manual: 2, unfit: 3 };

const cstE = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cstJ = v => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
const cstYen = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const cstMajorName = k => (typeof ADMISSION_MAJORS !== 'undefined' && ADMISSION_MAJORS[k]) || (typeof majorLabel === 'function' ? majorLabel(k) : '') || k || '';
const cstMajorKeys = () => Object.keys(ADMISSION_MAJORS).filter(k => typeof salesMajorOkMe !== 'function' || salesMajorOkMe(k));
const cstYm = d => d.getFullYear() * 12 + d.getMonth();
const cstYmLabel = i => `${Math.floor(i / 12)}.${String(i % 12 + 1).padStart(2, '0')}`;
function cstCoursesObj(l) {   // lead.courses 兼容旧的数组写法：{ items, pkgs, custom }
  if (!l.courses || Array.isArray(l.courses)) l.courses = { items: Array.isArray(l.courses) ? l.courses : [], pkgs: [], custom: [] };
  const c = l.courses; c.items = c.items || []; c.pkgs = c.pkgs || []; c.custom = c.custom || [];
  return c;
}
function cstFilters(l) { if (!l.filters || Array.isArray(l.filters)) l.filters = {}; const f = l.filters; f.status = f.status || []; return f; }
function cstEnroll(l) { const m = String(l.target_enroll || '').match(/^(\d{4})-(\d{2})$/); return m ? { y: +m[1], m: +m[2] } : null; }

// ── 学校等级：沿用合格实绩里的 Tier（T0–T3）：大学在 Tier 管理里手动设过的用手动值，没设的按名单自动算 ──
async function cstLoadTiers() {
  if (cst.tiers) return; cst.tiers = {};
  try { (await sbAll('/rest/v1/admission_results?select=univ,tier&tier=not.is.null')).forEach(r => { const k = String(r.univ || '').replace(/\s/g, ''); if (k && !(k in cst.tiers)) cst.tiers[k] = r.tier; }); } catch (e) {}
  cstRefresh();
}
function cstTier(univ) {
  const k = String(univ || '').replace(/\s/g, '');
  if (cst.tiers && k in cst.tiers) return cst.tiers[k];
  return typeof raTierOf === 'function' ? raTierOf(k) : null;
}
const cstTierTag = u => { const t = cstTier(u); return t == null ? '' : `<span style="font-size:10px;padding:1px 6px;border-radius:2px;background:#e8edf8;color:#2c4a8a">T${t}</span>`; };

// ── 加载 / 保存 ──
async function renderConsult(mc) {
  mc.innerHTML = '<div class="loading">加载中…</div>';
  if (!cst.loaded) {
    try { cst.list = await sbAll('/rest/v1/consult_leads?select=*&order=updated_at.desc', { cache: 'no-store' }); cst.err = ''; cst.loaded = true; }
    catch (e) { cst.err = e.message; }
  }
  cstRender();
}
async function cstNew() {
  try {
    const r = await sb('/rest/v1/consult_leads', 'POST', { status: 'active', step: 1 });
    const row = Array.isArray(r) ? r[0] : r; if (!row) throw new Error('没有返回新档案');
    cst.list.unshift(row); cstEnter(row);
  } catch (e) { alert('新建失败：' + e.message); }
}
function cstPick(id) { const l = cst.list.find(x => x.id === id); if (!l) return; cstFlush(); cstEnter(l); }
function cstEnter(l) {
  cst.cur = l; cst.adm = []; cst.admKey = ''; cst.open = {}; cst.admLimit = 30; cst.crsLimit = 30; cst.intro = null; cst.introKey = '';
  const p = cstProg(l), at = Math.min(cstItemIdx(p.at), cstFrontier(l)); cst.item = CST_ITEMS[at < 0 ? 0 : at].id; cst.step = cstItemOf(cst.item).g;
  cstRender(); window.scrollTo(0, 0);
}
function cstSet(k, v, rerender) {
  const l = cst.cur; if (!l) return;
  l[k] = (v === '' ? null : v); cst.dirty[k] = true; cst.saving = '保存中…';
  const st = document.getElementById('cst_state'); if (st) st.textContent = cst.saving;
  clearTimeout(cst.timer); cst.timer = setTimeout(cstFlush, 700);
  if (rerender) cstRender();
}
async function cstFlush() {
  clearTimeout(cst.timer);
  const l = cst.cur, keys = Object.keys(cst.dirty); if (!l || !keys.length) return;
  const body = { updated_at: new Date().toISOString() }; keys.forEach(k => { body[k] = l[k]; }); cst.dirty = {};
  try {
    await sb(`/rest/v1/consult_leads?id=eq.${encodeURIComponent(l.id)}`, 'PATCH', body);
    l.updated_at = body.updated_at; cst.saving = '已保存';
  } catch (e) { keys.forEach(k => { cst.dirty[k] = true; }); cst.saving = '保存失败：' + e.message; }
  const st = document.getElementById('cst_state'); if (st) st.textContent = cst.saving;
}
async function cstDelete() {
  const l = cst.cur; if (!l || !confirm(`删除「${l.name || '未命名'}」的咨询档案？删除后不能恢复。`)) return;
  try {
    await sb(`/rest/v1/consult_leads?id=eq.${encodeURIComponent(l.id)}`, 'DELETE');
    cst.list = cst.list.filter(x => x.id !== l.id); cst.cur = null; cst.dirty = {}; cstRender();
  } catch (e) { alert('删除失败：' + e.message); }
}
const cstChip = (on, label, click, extra) => `<span class="filter-chip${on ? ' active' : ''}" onclick="${click}" ${extra || ''}>${label}</span>`;

// ══════════ 总框架：首页（咨询者卡片）+ 流程页（一项一页，顶部进度条）══════════
const CST_GROUPS = [[1, '学生信息', '#4f7194'], [2, '专业与院校', '#5b7f55'], [3, '课程与方案', '#c9831f'], [4, '最终升学计划', '#b25a74']];
const CST_ITEMS = [
  { id: '1-1', g: 1, name: '基本情况', lead: '先了解一下你的基本情况', fn: () => cstP11() },
  { id: '1-2', g: 1, name: '语言成绩', lead: '你目前的日语和英语水平', fn: () => cstP12() },
  { id: '1-3', g: 1, name: '时间计划', lead: '你打算什么时候赴日、什么时候入学，我们据此排出大致的升学时间轴', fn: () => cstP13() },
  { id: '2-1', g: 2, name: '专业介绍', lead: '这个专业学什么，需要什么样的语言和专业能力', fn: () => cstP21() },
  { id: '2-2', g: 2, name: '可考虑的院校', lead: '根据你目前的条件，这些学校可以考虑', fn: () => cstP22() },
  { id: '2-3', g: 2, name: '确定目标', lead: '选出你想冲刺、主申和保底的学校，可以选多个', fn: () => cstP23() },
  { id: '2-4', g: 2, name: '课程介绍', lead: '这个专业有哪些课程', fn: () => cstP24() },
  { id: '2-5', g: 2, name: '讲师介绍', lead: '给你上课的老师', fn: () => cstP25() },
  { id: '2-6', g: 2, name: '相关合格案例', lead: '和你背景相近的同学是怎么合格的', fn: () => cstP26() },
  { id: '3-1', g: 3, name: '需要补足的差距与推荐课程', lead: '离目标学校的要求还差什么，我们怎么帮你补上', fn: () => cstP31() },
  { id: '3-2', g: 3, name: '选择课程', lead: '为你挑选合适的课程', fn: () => cstP32() },
  { id: '3-3', g: 3, name: '套餐与价格', lead: '课程套餐包含什么、费用是多少', fn: () => cstP33() },
  { id: '3-4', g: 3, name: '详细时间轴', lead: '把课程和考试、出愿的时间排在一起', fn: () => cstP34() },
  { id: '4-1', g: 4, name: '规划老师评语', lead: '规划老师给你的建议', fn: () => cstP41() },
  { id: '4-2', g: 4, name: '升学计划', lead: '你的升学计划，确认后可以保存、导出', fn: () => cstP42() },
];
const cstItemOf = id => CST_ITEMS.find(i => i.id === id) || CST_ITEMS[0];
const cstItemIdx = id => CST_ITEMS.findIndex(i => i.id === id);
const cstGroupOf = g => CST_GROUPS.find(x => x[0] === g);
// 进度：{ done:[], skipped:[], at } 存在 consult_leads.progress；旧档案没有就按 step 推算（该大步骤之前的项都算完成）
function cstProg(l) {
  let p = l.progress;
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    const g = l.step || 1;
    p = { done: CST_ITEMS.filter(i => i.g < g).map(i => i.id), skipped: [], at: (CST_ITEMS.find(i => i.g === g) || CST_ITEMS[0]).id };
    l.progress = p;
  }
  p.done = p.done || []; p.skipped = p.skipped || [];
  if (cstItemIdx(p.at) < 0) p.at = CST_ITEMS[0].id;
  return p;
}
function cstFrontier(l) {   // 第一个还没完成也没跳过的项；它和它之前的项可以点
  const p = cstProg(l), i = CST_ITEMS.findIndex(it => !p.done.includes(it.id) && !p.skipped.includes(it.id));
  return i < 0 ? CST_ITEMS.length - 1 : i;
}
function cstMissing(id) {
  const l = cst.cur, m = [];
  if (id === '1-1') { if (!String(l.name || '').trim()) m.push('姓名'); if (!l.target_level) m.push('升学层次'); if (!l.target_major) m.push('目标专业'); }
  if (id === '1-3' && !l.target_enroll) m.push('目标入学时间');
  if (id === '2-3' && !(l.goals || []).length) m.push('至少一个目标学校');
  return m;
}
function cstGoItem(id) {
  const l = cst.cur; if (!l) return;
  if (cstItemIdx(id) > cstFrontier(l)) return;
  const p = cstProg(l); p.at = id; cst.item = id; cst.step = cstItemOf(id).g; cst.admLimit = 30; cst.crsLimit = 30;
  cstSet('progress', p); cstSet('step', cst.step); cstRender(); window.scrollTo(0, 0);
}
function cstNext() {
  const l = cst.cur, p = cstProg(l), id = cst.item; if (cstMissing(id).length) return;
  if (!p.done.includes(id)) p.done.push(id);
  p.skipped = p.skipped.filter(x => x !== id);
  const i = cstItemIdx(id);
  if (i >= CST_ITEMS.length - 1) { cstSet('progress', p); cstFlush(); cstHome(); return; }
  p.at = CST_ITEMS[i + 1].id; cstSet('progress', p); cstGoItem(p.at);
}
function cstSkip() {   // 只有「确定目标」可以暂不确定
  const l = cst.cur, p = cstProg(l), id = cst.item, i = cstItemIdx(id);
  p.done = p.done.filter(x => x !== id); if (!p.skipped.includes(id)) p.skipped.push(id);
  p.at = CST_ITEMS[i + 1].id; cstSet('progress', p); cstGoItem(p.at);
}
function cstPrev() { const i = cstItemIdx(cst.item); if (i > 0) cstGoItem(CST_ITEMS[i - 1].id); }
function cstHome() { cstFlush(); cst.cur = null; cst.overlay = ''; cstRender(); window.scrollTo(0, 0); }
function cstExit() { cstFlush(); if (window.__CONSULT_STANDALONE__) { cstHome(); return; } document.body.classList.remove('consult-mode'); if (typeof switchTab === 'function') switchTab('todo'); }
// 顶栏 logo：美术领域的咨询者用美术 logo，其余（含首页列表）用普通 logo；图片加载失败时隐藏，只留文字「唯新学院」
const cstIsArt = l => !!l && !!l.target_major && /美术/.test(admissionMajorDomain(l.target_major) || '');
const cstLogoSrc = l => `../shared/img/${cstIsArt(l) ? 'artlogo' : 'logo'}-nav.png?v=20270218`;
const cstLogoHtml = l => `<span class="cst-brand"><img class="cst-logo" src="${cstLogoSrc(l)}" alt="唯新学院" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="cst-logo-fb" style="display:none">唯新学院</span><span class="cst-brand-t"><b>唯新学院</b><i>TRANSFORM EDUCATION</i></span></span>`;
const cstFootHtml = () => `<footer class="cst-foot"><span class="cst-foot-brand">TRANSFORM EDUCATION</span><span>唯新学院 · 升学咨询</span><span class="cst-foot-note">具备报考资格，就已经迈出了第一步。接下来认真准备、一起加油！</span></footer>`;
const cstBackBtn = () => window.__CONSULT_STANDALONE__ ? '' : '<button class="btn btn-sm" onclick="cstExit()">← 返回老师端</button>';
function cstRefresh() { if (cst.cur || cst.overlay) cstRender(); }
function cstToggleShow() { cst.show = !cst.show; cstRender(); }
function cstProgText(l) {
  const p = cstProg(l), at = cstItemOf(p.at);
  return `做到 ${at.id} ${at.name} · 已完成 ${p.done.length} / ${CST_ITEMS.length} 项`;
}

function cstRender() {
  const mc = document.getElementById('mainContent'); if (!mc) return;
  document.body.classList.add('consult-mode');
  if (cst.err) { mc.innerHTML = `<div class="cst-root"><header class="cst-top">${cstLogoHtml(null)}<span class="cst-top-r">${cstBackBtn()}</span></header><div class="empty">加载失败：${cstE(cst.err)}<br><span style="font-size:11px">（如果提示表不存在，请联系管理员先执行咨询台的建表 SQL）</span></div></div>`; return; }
  mc.innerHTML = `<div class="cst-root">${cst.cur ? cstFlowHtml() : cstHomeHtml()}${cst.overlay ? cstOverlayHtml() : ''}</div>`;
}
function cstTopHtml(l) {
  return `<header class="cst-top">
    ${cstLogoHtml(l)}
    ${l ? `<button class="btn btn-sm" onclick="cstHome()">咨询者列表</button><span class="cst-who">${cstE(l.name || '未命名咨询者')}</span>${cst.show ? '' : `<span id="cst_state" class="cst-state">${cstE(cst.saving)}</span>`}` : '<span class="cst-who">咨询台</span>'}
    <span class="cst-top-r">
      <button class="btn btn-sm" onclick="cstOpenAbout()">关于唯新</button>
      <button class="btn btn-sm" onclick="cstOpenMedia()">教材・校区</button>
      <button class="btn btn-sm" onclick="cstOpenFaq()">常见问题</button>
      ${l ? `<button class="btn btn-sm ${cst.show ? 'btn-primary' : ''}" onclick="cstToggleShow()">展示模式${cst.show ? '：开' : '：关'}</button>${cst.show ? '' : '<button class="btn btn-sm cst-del" onclick="cstDelete()">删除</button>'}` : ''}
      ${cstBackBtn()}
    </span></header>`;
}
function cstHomeHtml() {
  const q = cst.q.trim().toLowerCase();
  const list = cst.list.filter(l => !q || [l.name, l.target_major && cstMajorName(l.target_major), l.orig_major].join(' ').toLowerCase().includes(q));
  return `${cstTopHtml(null)}<main class="cst-home">
    <div class="cst-home-h"><h1>咨询者</h1><input placeholder="搜索咨询者" value="${cstE(cst.q)}" oninput="cst.q=this.value;cstHomeList()"><button class="btn btn-primary" onclick="cstNew()">＋ 新咨询</button></div>
    <div id="cst_cards" class="cst-cards">${cstCardsHtml(list)}</div></main>${cstFootHtml()}`;
}
function cstHomeList() {
  const q = cst.q.trim().toLowerCase(), el = document.getElementById('cst_cards'); if (!el) return;
  el.innerHTML = cstCardsHtml(cst.list.filter(l => !q || [l.name, l.target_major && cstMajorName(l.target_major), l.orig_major].join(' ').toLowerCase().includes(q)));
}
function cstCardsHtml(list) {
  if (!list.length) return '<div class="cst-empty">还没有咨询者，点右上角「＋ 新咨询」开始。</div>';
  return list.map(x => {
    const d = new Date(x.updated_at || x.created_at || Date.now()), p = cstProg(x), g = cstGroupOf(cstItemOf(p.at).g);
    return `<div class="cst-lead" style="--c:${g[2]}" onclick="cstPick('${cstJ(x.id)}')">
      <div class="cst-lead-n">${cstE(x.name || '未命名')}</div>
      <div class="cst-lead-m">${cstE([x.target_major ? cstMajorName(x.target_major) : '', x.target_level === 'gakubu' ? '学部' : (x.target_level === 'daigakuin' ? '大学院' : '')].filter(Boolean).join(' · ') || '还没选专业')}</div>
      <div class="cst-lead-p"><i></i>${cstE(cstProgText(x))}</div>
      <div class="cst-lead-d">最后更新 ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}</div></div>`;
  }).join('');
}
function cstProgressHtml() {
  const l = cst.cur, p = cstProg(l), fr = cstFrontier(l), it = cstItemOf(cst.item), g = cstGroupOf(it.g);
  const dot = i => {
    const idx = cstItemIdx(i.id), cur = i.id === cst.item, locked = idx > fr;
    const st = cur ? 'cur' : (p.done.includes(i.id) ? 'done' : (p.skipped.includes(i.id) ? 'skip' : (locked ? 'lock' : 'todo')));
    return `<button class="cst-dot ${st}" title="${i.id} ${cstE(i.name)}" ${locked ? 'disabled' : `onclick="cstGoItem('${i.id}')"`}>${st === 'done' ? '✓' : (st === 'skip' ? '跳' : i.id)}</button>`;
  };
  return `<nav class="cst-prog"><div class="cst-groups">${CST_GROUPS.map(([n, name, c]) => {
    const items = CST_ITEMS.filter(i => i.g === n), all = items.every(i => p.done.includes(i.id)), handled = items.every(i => p.done.includes(i.id) || p.skipped.includes(i.id));
    return `<div class="cst-pg${n === it.g ? ' on' : ''}" style="--c:${c}"><div class="cst-pg-h"><span>${'①②③④'[n - 1]} ${name}</span>${all ? '<i>已完成</i>' : (handled ? '<i class="y">已完成（含跳过）</i>' : '')}</div><div class="cst-dots">${items.map(dot).join('')}</div></div>`;
  }).join('')}</div>
    <div class="cst-prog-sum">第 ${it.g} 步 · ${g[1]} ｜ ${it.id} ${cstE(it.name)}　·　已完成 ${p.done.length} / ${CST_ITEMS.length} 项</div></nav>`;
}
function cstFlowHtml() {
  const l = cst.cur, it = cstItemOf(cst.item), g = cstGroupOf(it.g), i = cstItemIdx(it.id), next = CST_ITEMS[i + 1], miss = cstMissing(it.id);
  return `${cstTopHtml(l)}${cstProgressHtml()}
    <main class="cst-page"><div class="cst-title" style="--c:${g[2]}"><div class="cst-title-bar"></div><div><div class="cst-kicker">第 ${it.g} 步 · ${g[1]}</div><h1>${cstE(it.name)}</h1><p>${cstE(it.lead)}</p></div></div>
      <div class="cst-card">${it.fn()}</div></main>${cstFootHtml()}
    <footer class="cst-bar">
      ${i > 0 ? `<button class="btn" onclick="cstPrev()">← 上一项：${cstE(CST_ITEMS[i - 1].name)}</button>` : '<span></span>'}
      <span class="cst-bar-r">${miss.length ? `<span class="cst-miss">请先填写：${miss.join('、')}</span>` : ''}
        ${it.id === '2-3' && miss.length ? '<button class="btn" onclick="cstSkip()">暂不确定，先往下</button>' : ''}
        <button class="btn btn-primary cst-next" ${miss.length ? 'disabled' : ''} onclick="cstNext()">${next ? `下一步：${cstE(next.name)} →` : '完成，回到咨询者列表'}</button></span></footer>`;
}

// ══════════ 第 1 步：学生信息 + 简易时间轴 ══════════
function cstSel(k, opts, ph) {
  const l = cst.cur, o = opts.map(x => Array.isArray(x) ? x : [x, x]);
  return `<select onchange="cstSet('${k}',this.value,true)" style="width:100%;font-size:12px;padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit"><option value="">${ph || '请选择'}</option>${o.map(([v, t]) => `<option value="${cstE(v)}" ${l[k] === v ? 'selected' : ''}>${cstE(t)}</option>`).join('')}</select>`;
}
function cstInp(k, type, ph) {
  return `<input type="${type || 'text'}" value="${cstE(cst.cur[k])}" placeholder="${cstE(ph || '')}" onchange="cstSet('${k}',this.value,${k === 'name' ? 'true' : 'false'})" style="width:100%;font-size:12px;padding:6px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box;font-family:inherit">`;
}
const cstField = (label, html, wide) => `<div style="${wide ? 'grid-column:1/-1' : ''}"><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">${label}</div>${html}</div>`;
function cstEnrollOpts() {
  const y = new Date().getFullYear(), out = [];
  for (let i = 0; i < 4; i++) { out.push([`${y + i}-04`, `${y + i}年4月`]); out.push([`${y + i}-10`, `${y + i}年10月`]); }
  return out.filter(([v]) => v >= new Date().toISOString().slice(0, 7));
}
const cstGrid = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px';
function cstP11() {
  const l = cst.cur;
  return `<div style="${cstGrid}">
      ${cstField('姓名 *', cstInp('name'))}
      ${cst.show ? '' : cstField('联系方式（内部）', cstInp('contact'))}
      ${cstField('学历', cstSel('edu_level', CST_EDU))}
      ${cstField('教育年限（年）', cstInp('edu_years', 'number'))}
      ${cstField('是否毕业', `<select onchange="cstSet('graduated',this.value===''?null:this.value==='true')" style="width:100%;font-size:12px;padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit"><option value="">请选择</option><option value="true" ${l.graduated === true ? 'selected' : ''}>已毕业</option><option value="false" ${l.graduated === false ? 'selected' : ''}>未毕业</option></select>`)}
      ${cstField('原专业', cstInp('orig_major'))}
      ${cstField('升学层次 *', cstSel('target_level', [['daigakuin', '大学院'], ['gakubu', '学部']]))}
      ${cstField('文理艺', cstSel('arts_sci', ['文科', '理科', '艺术']))}
      ${cstField('目标专业 *', cstSel('target_major', cstMajorKeys().map(k => [k, cstMajorName(k)])))}
      ${cstField('本专业 / 跨专业', cstSel('major_match', ['本专业', '跨专业']))}
    </div>`;
}
function cstP12() {
  const l = cst.cur, jp = l.jp_status === 'have' || l.jp_status === 'unrecorded', en = l.en_status === 'have' || l.en_status === 'unrecorded';
  return `<div style="${cstGrid}">
      ${cstField('日语', cstSel('jp_status', CST_LANG_ST))}
      ${jp ? cstField('日语考试', cstSel('jp_exam', CST_JP_EXAMS)) + cstField('日语成绩（如 N2 / 250）', cstInp('jp_score')) : ''}
    </div><div style="${cstGrid};margin-top:18px">
      ${cstField('英语', cstSel('en_status', CST_LANG_ST))}
      ${en ? cstField('英语考试', cstSel('en_exam', CST_EN_EXAMS)) + cstField('英语成绩（如 90）', cstInp('en_score')) : ''}
    </div>`;
}
function cstP13() {
  cstLoadAdm();
  const l = cst.cur;
  return `<div style="${cstGrid}">
      ${cstField('赴日时间', cstInp('arrive_date', 'date'))}
      ${cstField('目标入学时间 *', cstSel('target_enroll', cstEnrollOpts()))}
      ${cstField('目标学校等级（只用来排序，不隐藏学校）', cstSel('school_grade', CST_TIERS))}
    </div>${cst.show ? '' : `<div style="margin-top:14px">${cstField('内部备注（展示模式下隐藏）', `<textarea onchange="cstSet('note',this.value)" rows="2" style="width:100%;font-size:12px;padding:6px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box;font-family:inherit">${cstE(l.note)}</textarea>`, true)}</div>`}
    <div class="cst-sub">简易升学时间轴</div>${cstTimelineSimple()}`;
}
// 简易时间轴：没选目标校前是「预计」；选了目标校后换成数据库里的日程（已公布）
function cstTimelineSimple() {
  const l = cst.cur, en = cstEnroll(l);
  if (!en) return '<div style="font-size:11px;color:var(--text-3)">先选「目标入学时间」，这里会生成时间轴。</div>';
  const spring = en.m <= 6, rows = [];
  const tag = t => `<span style="font-size:9px;padding:1px 6px;border-radius:2px;background:${t === '已公布' ? '#e6f2ea' : '#f0ede4'};color:${t === '已公布' ? '#1a5a3a' : 'var(--text-3)'}">${t}</span>`;
  if (spring) {
    rows.push(['语言考试', `${en.y - 1}年6月（EJU）～ ${en.y - 1}年12月（JLPT）`, '预计', en.y - 1, 12]);
    rows.push(['出愿', `${en.y - 1}年6–9月（夏季）或 ${en.y - 1}年11月–${en.y}年1月（冬季）`, '预计', en.y - 1, 9]);
    rows.push(['校内考', `${en.y - 1}年8–9月（夏季）或 ${en.y}年1–2月（冬季）`, '预计', en.y - 1, 9]);
  } else {
    rows.push(['语言考试', `${en.y - 1}年12月（JLPT）～ ${en.y}年7月`, '预计', en.y, 7]);
    rows.push(['出愿', `${en.y}年3–6月`, '预计', en.y, 6]);
    rows.push(['校内考', `${en.y}年6–7月`, '预计', en.y, 7]);
  }
  rows.push(['入学', `${en.y}年${en.m}月`, '预计', en.y, en.m]);
  const goals = (l.goals || []).map(g => cst.adm.find(a => a.id === g.id)).filter(Boolean);
  goals.forEach(a => {
    if (a.application_period) rows.push([`出愿：${a.university}`, a.application_period, '已公布']);
    if (a.written_exam || a.oral_exam) rows.push([`校内考：${a.university}`, [a.written_exam && '笔试 ' + a.written_exam, a.oral_exam && '面试 ' + a.oral_exam].filter(Boolean).join(' / '), '已公布']);
    if (a.result_date) rows.push([`发表：${a.university}`, a.result_date, '已公布']);
  });
  const now = new Date(), first = rows.find(r => r[0] === '语言考试');
  const tight = first && cstYm(now) > first[3] * 12 + first[4] - 1 ? `<div style="background:#f6e2de;color:#a03a2e;font-size:11px;padding:7px 10px;border-radius:3px;margin-bottom:8px">时间紧：预计的语言考试时间已经过了，需要确认能赶上哪一次考试或调整入学时间。</div>` : '';
  return `${tight}<table style="width:100%;border-collapse:collapse;font-size:12px">${rows.map(r => `<tr style="border-bottom:1px solid var(--border-light)"><td style="padding:7px 4px;width:34%;font-weight:600">${cstE(r[0])}</td><td style="padding:7px 4px">${cstE(r[1])}</td><td style="padding:7px 4px;width:60px;text-align:right">${tag(r[2])}</td></tr>`).join('')}</table>
    <div style="font-size:10px;color:var(--text-3);margin-top:6px">「预计」是按常规日程估算；选了目标校后会换成出愿数据库里的日程（已公布）。</div>`;
}

// ══════════ 院校状态：按规则判断，不用 AI ══════════
const CST_NORM = { 'TOEFL IBT': 'TOEFL', 'TOEFL': 'TOEFL', 'IELTS': 'IELTS', 'TOEIC': 'TOEIC', 'EJU': 'EJU', 'J-TEST': 'J-TEST', 'JTEST': 'J-TEST', 'BJT': 'BJT', 'JLPT': 'JLPT' };
function cstParseReq(detail) {
  const t = String(detail || ''), alts = [];
  let m; const re1 = /(EJU|J-?TEST|BJT|TOEFL(?:\s*iBT)?|IELTS|TOEIC)[^0-9N]{0,8}?(\d+(?:\.\d+)?)/gi;
  while ((m = re1.exec(t))) alts.push({ exam: CST_NORM[m[1].toUpperCase().replace(/\s+/g, ' ')] || CST_NORM[m[1].toUpperCase().replace(/\s+/g, '')] || m[1].toUpperCase(), min: parseFloat(m[2]) });
  const re2 = /N([1-5])/gi; while ((m = re2.exec(t))) alts.push({ exam: 'JLPT', lvl: +m[1] });
  return alts;
}
// 出愿数据库的「语言明细」（english_tests / japanese_tests，如 { TOEFL:'〇（必須）', 'JLPT-N1':'〇', EJU:'〇（250）' }）：有明细就按明细判断
function cstTestsCheck(label, tests, status, exam, score) {
  const ok = v => { v = String(v == null ? '' : v).trim(); return !!v && !/^[×✕✗xX\-－―]+$/.test(v) && v !== 'なし'; };
  const acc = Object.entries(tests || {}).filter(([k, v]) => k !== 'その他' && ok(v));
  if (!acc.length) return null;
  const names = acc.map(([k, v]) => k.replace(/^JLPT-/, '') + (/[（(]\s*\d/.test(v) ? String(v).match(/[（(](.+?)[）)]/)[0] : '')).join('、');
  const need = `${label}需取得其中一项：${names}`;
  if (status === 'unrecorded') return { st: 'manual', note: `${label}成绩待录入后再判断` };
  if (status !== 'have') return { st: 'short', note: need };
  const ex = String(exam || '').toUpperCase(), sc = String(score || '').trim(), lvl = +((sc.match(/N([1-5])/i) || [])[1] || 0), num = parseFloat(sc);
  let hit = false, low = null;
  acc.forEach(([k, v]) => {
    const kk = k.toUpperCase();
    if (kk.startsWith('JLPT-N')) { if (ex === 'JLPT' && lvl && lvl <= +kk.slice(-1)) hit = true; return; }
    if (kk !== ex) return;
    const min = parseFloat(((String(v).match(/[（(]\s*(\d+(?:\.\d+)?)/) || [])[1]));
    if (isNaN(min)) { hit = true; return; }
    if (isNaN(num)) { low = low || 'x'; return; }
    if (num >= min) hit = true; else low = `目前 ${sc}，要求 ${min}`;
  });
  if (hit) return { st: 'ok' };
  if (low === 'x') return { st: 'manual', note: `${label}成绩（${sc || '未填'}）读不出分数，需人工确认` };
  return { st: 'short', note: low ? `${label}分数不够（${low}）` : `${need}（目前 ${exam || '其他考试'}${sc ? ' ' + sc : ''}）` };
}
function cstLangCheck(label, req, detail, status, exam, score, tests) {
  const r = String(req || '').trim();
  if (!r) return { st: 'manual', note: `${label}要求没有录入` };
  if (r !== '必須') return { st: 'ok' };
  const byTests = cstTestsCheck(label, tests, status, exam, score); if (byTests) return byTests;
  const alts = cstParseReq(detail);
  if (!alts.length) return { st: 'manual', note: `${label}要求是文字说明（${detail || '无详细'}），需人工确认` };
  const need = `${label}需取得 ${detail}`;
  if (status === 'unrecorded') return { st: 'manual', note: `${label}成绩待录入后再判断` };
  if (status !== 'have') return { st: 'short', note: need };
  const ex = CST_NORM[String(exam || '').toUpperCase().replace(/\s+/g, ' ')] || String(exam || '').toUpperCase();
  const sc = String(score || '').trim(), lvl = (sc.match(/N([1-5])/i) || [])[1], num = parseFloat(sc);
  const same = alts.filter(a => a.exam === ex);
  if (!same.length) return { st: 'short', note: `${need}（目前是 ${exam || '其他考试'}）` };
  const ok = same.some(a => a.exam === 'JLPT' ? (lvl && +lvl <= a.lvl) : (!isNaN(num) && num >= a.min));
  if (ok) return { st: 'ok' };
  if (ex === 'JLPT' ? !lvl : isNaN(num)) return { st: 'manual', note: `${label}成绩（${sc || '未填'}）读不出分数，需人工确认` };
  return { st: 'short', note: `${need}（目前 ${sc}）` };
}
// 出愿时间：取出愿月份里最晚的一个，按目标入学时间推算是哪一年
function cstDeadline(a, l) {
  const en = cstEnroll(l); if (!en) return null;
  const ms = (String(a.application_period || '').match(/(\d{1,2})月/g) || []).map(x => parseInt(x)); if (!ms.length) return null;
  const m = Math.max(...ms), y = m < en.m ? en.y : en.y - 1;
  return new Date(y, m, 0);
}
function cstEval(a) {
  const l = cst.cur, notes = [];
  let st = 'ok';
  const j = cstLangCheck('日语', a.japanese_required, a.japanese_detail, l.jp_status, l.jp_exam, l.jp_score, a.japanese_tests);
  const e = cstLangCheck('英语', a.english_required, a.english_detail, l.en_status, l.en_exam, l.en_score, a.english_tests);
  [j, e].forEach(x => { if (x.note) notes.push(x.note); });
  const hasMan = j.st === 'manual' || e.st === 'manual', hasShort = j.st === 'short' || e.st === 'short';
  if (/資格審査|资格审查/.test([a.notes, a.exam_style, a.admission_type].join(' '))) { notes.push('有资格审查'); st = 'manual'; }
  else if (hasMan) st = 'manual'; else if (hasShort) st = 'short';
  if (!a.application_period && !a.written_exam && !a.japanese_required && !a.english_required) { notes.push('学校关键信息为空'); st = 'manual'; }
  const dl = cstDeadline(a, l);
  if (dl && dl < new Date()) { notes.unshift('该期出愿时间已过'); st = 'unfit'; }
  return { st, notes, gaps: [j.st === 'short' ? 'jp' : '', e.st === 'short' ? 'en' : ''].filter(Boolean) };
}
const cstNone = s => { const t = String(s || '').trim(); return !t || /^(无|無|なし|不要|-|—|×)$/.test(t); };
function cstAdmFiltered(skip) {
  const l = cst.cur, f = cstFilters(l);
  let rows = cst.adm.map(a => ({ a, ev: cstEval(a) }));
  const tests = {
    q: r => !f.q || [r.a.university, r.a.faculty, r.a.department, r.a.course].join(' ').toLowerCase().includes(f.q.toLowerCase()),
    noEn: r => !f.noEn || r.a.english_required === '不要',
    noJp: r => !f.noJp || r.a.japanese_required === '不要',
    noWr: r => !f.noWr || cstNone(r.a.written_exam),
    noOr: r => !f.noOr || cstNone(r.a.oral_exam),
    status: r => !f.status.length || f.status.includes(r.ev.st),
    tier: r => !(f.tiers || []).length || f.tiers.includes(String(cstTier(r.a.university))),
    month: r => {
      if (!f.mFrom && !f.mTo) return true;
      const ms = (String(r.a.application_period || '').match(/(\d{1,2})月/g) || []).map(x => parseInt(x)); if (!ms.length) return false;
      return !((f.mFrom && Math.max(...ms) < f.mFrom) || (f.mTo && Math.min(...ms) > f.mTo));
    },
  };
  Object.entries(tests).forEach(([k, fn]) => { if (k !== skip) rows = rows.filter(fn); });
  return rows;
}
async function cstLoadAdm() {
  const l = cst.cur, k = l && l.target_major; if (!k || cst.admKey === k) return;
  cst.admKey = k; cst.adm = []; cst.admLoading = true;
  try { cst.adm = await sbAll(`/rest/v1/admission_schools?major=eq.${encodeURIComponent(k)}&select=*&order=university.asc`); } catch (e) { cst.adm = []; cst.admErr = e.message; }
  cst.admLoading = false; if (cst.cur && cst.cur.target_major === k) cstRender();
}
function cstSetF(k, v) { const f = cstFilters(cst.cur); f[k] = v; cst.admLimit = 30; cstSet('filters', f); cstRender(); }
function cstToggleF(k) { const f = cstFilters(cst.cur); cstSetF(k, !f[k]); }
function cstToggleTier(t) { const f = cstFilters(cst.cur); f.tiers = f.tiers || []; const i = f.tiers.indexOf(t); if (i >= 0) f.tiers.splice(i, 1); else f.tiers.push(t); cstSetF('tiers', f.tiers); }
function cstToggleStatus(s) { const f = cstFilters(cst.cur), i = f.status.indexOf(s); if (i >= 0) f.status.splice(i, 1); else f.status.push(s); cstSetF('status', f.status); }

// ══════════ 第 2 步：专业与院校 ══════════
async function cstLoadIntro() {
  const k = cst.cur && cst.cur.target_major; if (!k || cst.introKey === k) return;
  cst.introKey = k; cst.intro = null;
  try {
    const [blocks, videos] = await Promise.all([
      sb(`/rest/v1/promo_content?major=eq.${encodeURIComponent(k)}&select=*&order=sort_order.asc,created_at.asc`).catch(() => []),
      sb(`/rest/v1/promo_videos?major=eq.${encodeURIComponent(k)}&published=is.true&select=*&order=sort_order.asc`).catch(() => []),
    ]);
    cst.intro = { blocks: blocks || [], videos: videos || [] };
  } catch (e) { cst.intro = { blocks: [], videos: [] }; }
  cstRefresh();
}
// 通用宣传（宣传册转好的内容，按领域；表 promo_common，和「宣传相关 → 通用宣传」同一份）
async function cstLoadCommon() {
  const dom = admissionMajorDomain(cst.cur && cst.cur.target_major); if (!dom || (cst.common && cst.commonDom === dom)) return;
  cst.commonDom = dom; cst.common = [];
  try { cst.common = (await sbAll('/rest/v1/promo_common?or=(published.is.null,published.is.true)&select=*&order=sort_order.asc,updated_at.asc')).filter(r => r.domain === dom && salesDomOkMe(r.domain)); } catch (e) { cst.common = []; }
  cstRefresh();
}
// 教授资料（管理员在「管控台 → 咨询台 → 教授资料」维护）
async function cstLoadProfs() {
  if (cst.profs) return; cst.profs = [];
  try { cst.profs = await sbAll('/rest/v1/consult_professors?published=is.true&select=*&order=university.asc,name.asc'); } catch (e) { cst.profs = []; }
  cstRefresh();
}
const cstUniKey = u => String(u || '').replace(/\s|大学$/g, '');
// 某个大学的教授资料（院校列表里点「教授」展开）
function cstProfsOf(uni) { const u = cstUniKey(uni); return (cst.profs || []).filter(p => u && (cstUniKey(p.university).includes(u) || u.includes(cstUniKey(p.university)))); }
function cstProfCards(rows) {
  return rows.map(p => `<div style="border:1px solid var(--border-light);border-radius:3px;padding:9px 12px;margin-bottom:6px">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:13px;font-weight:600">${cstE(p.name)}</span><span style="font-size:11px;color:var(--text-2)">${cstE([p.university, p.department].filter(Boolean).join(' '))}</span>${p.unconfirmed ? '<span style="font-size:10px;padding:1px 7px;border-radius:2px;background:#f6edd2;color:#8a6a1a">待确认</span>' : ''}</div>
    ${p.research ? `<div style="font-size:11px;color:var(--text-2);margin-top:4px;line-height:1.8"><span style="color:var(--text-3)">研究方向：</span>${cstE(p.research)}</div>` : ''}
    ${p.contact_req ? `<div style="font-size:11px;color:var(--text-2);line-height:1.8"><span style="color:var(--text-3)">联系要求：</span>${cstE(p.contact_req)}</div>` : ''}
    <div style="font-size:10px;color:var(--text-3);margin-top:3px">来源：${p.source_url ? `<a href="${cstE(p.source_url)}" target="_blank" style="color:var(--accent)">${cstE(p.source || '链接')}</a>` : cstE(p.source || '未注明')}${p.updated_on ? ' · 更新 ' + cstE(p.updated_on) : ''}</div>
    ${!cst.show && p.notes ? `<div style="font-size:10px;color:var(--text-3);margin-top:2px">备注：${cstE(p.notes)}</div>` : ''}</div>`).join('');
}
// 讲师资料：沿用「讲师信息」（teacher_profiles），按课程安排里的老师名对上
async function cstLoadProfiles() {
  if (cst.profiles) return; cst.profiles = [];
  try {
    const [pf, th] = await Promise.all([sbAll('/rest/v1/teacher_profiles?select=*&order=sort_order.asc,created_at.asc'), sb('/rest/v1/teachers?select=name,public_name').catch(() => [])]);
    cst.profiles = pf.filter(p => salesDomOkMe(profileDomain(p)));
    if (typeof tsPubMap !== 'undefined' && !tsPubMap) { tsPubMap = {}; (th || []).forEach(t => { const pub = String(t.public_name || '').trim(); if (pub) tsPubMap[t.name] = pub; }); }
  } catch (e) { cst.profiles = []; }
  cstRefresh();
}
function cstProfilesOf(teacher) {
  const nrm = x => String(x || '').replace(/老师|先生|様|さん/g, '').trim(), names = String(teacher || '').split(/[、,，\/\s]+/).map(nrm).filter(Boolean);
  const out = [], seen = new Set();
  (cst.profiles || []).forEach(p => { if (names.includes(nrm(p.name)) || (p.real_name && names.includes(nrm(p.real_name)))) { if (!seen.has(p.name)) { seen.add(p.name); out.push(p); } } });
  return out;
}
function cstTeacherCard(x) {
  const profs = cstProfilesOf(x.teacher); if (!profs.length || typeof tsCardsGridHtml !== 'function') return '';
  const key = 'tc_' + x.id, open = key in cst.open ? cst.open[key] : false;
  return `<span class="filter-chip${open ? ' active' : ''}" style="margin-left:6px" onclick="cst.open['${cstJ(key)}']=${!open};cstRender()">讲师资料</span>` +
    (open ? `<div style="flex-basis:100%;margin-top:6px">${cst.show ? tsCardsGridHtml(profs, '', false) : tsInfoHtml(profs)}</div>` : '');
}
async function cstLoadCases() {
  if (cst.cases) return;
  cst.cases = [];
  try { cst.cases = (await sbAll('/rest/v1/success_cases?select=*&order=updated_at.desc')).filter(c => c.published !== false); } catch (e) { cst.cases = []; }
  cstRefresh();
}
const cstGakubuNote = () => { const l = cst.cur; return (l.target_level === 'gakubu' || l.arts_sci === '理科' || l.arts_sci === '艺术') ? `<div style="background:#f6edd2;color:#8a6a1a;font-size:11px;padding:7px 10px;border-radius:3px;margin-bottom:10px">出愿数据库目前只覆盖大学院文科，学部 / 理科 / 艺术的院校列表可能不全。</div>` : ''; };
function cstP21() { cstLoadIntro(); return cstGakubuNote() + cstIntroHtml(); }
function cstP22() { cstLoadAdm(); cstLoadTiers(); cstLoadProfs(); return cstGakubuNote() + cstAdmHtml(); }
function cstP23() {
  cstLoadAdm(); cstLoadTiers();
  return cstGoalsHtml() + `<div style="margin-top:12px"><button class="btn btn-sm" onclick="cstGoItem('2-2')">← 回到院校列表继续选</button></div>`;
}
function cstP24() { cstLoadIntro(); return cstPromoBlocks('course'); }
function cstP25() { cstLoadIntro(); cstLoadProfiles(); cstLoadCourses(); return cstPromoBlocks('lecturer'); }
function cstP26() { cstLoadCases(); return cstCasesHtml(); }
function cstIntroHtml() {
  if (!cst.intro) return '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  const { blocks, videos } = cst.intro, md = typeof prMd === 'function' ? prMd : cstE;
  const intro = blocks.filter(b => !b.section || b.section === 'major_intro');
  const isAbil = b => /需要的语言|语言.*能力|专业能力/.test(b.title || ''), isCross = b => /跨专业/.test(b.title || '');
  const abil = intro.filter(isAbil), cross = intro.filter(b => !isAbil(b) && isCross(b)), rest = intro.filter(b => !isAbil(b) && !isCross(b));
  const blk = (b, mark) => `<div style="margin-bottom:12px;${mark ? 'border-left:3px solid var(--accent);padding-left:10px' : ''}"><div style="font-weight:600;font-size:12px;margin-bottom:4px">${cstE(b.title)}</div><div style="font-size:12px;line-height:1.9;color:var(--text-2)">${md(b.body)}</div></div>`;
  const fixed = (label, arr, title) => arr.length ? arr.map(b => blk(b, true)).join('') : `<div style="font-size:11px;color:var(--text-3);margin-bottom:10px;border-left:3px solid var(--border);padding-left:10px">「${label}」还没有填写（管理员在「宣传介绍」的专业介绍里新增一条，标题写「${title}」）</div>`;
  const vk = { intro: '学科介绍', lesson: '正课体验', other: '其他' };
  return fixed('需要的语言与专业能力', abil, '需要的语言与专业能力') + (cst.cur.major_match === '跨专业' || cross.length ? fixed('跨专业要补什么', cross, '跨专业要补什么') : '') +
    rest.map(b => blk(b)).join('') +
    (videos.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${videos.map(v => `<a href="${cstE(v.url)}" target="_blank" class="filter-chip" style="text-decoration:none">${cstE(vk[v.kind] || '视频')}：${cstE(v.title)}${v.duration ? '（' + cstE(v.duration) + '）' : ''}</a>`).join('')}</div>` : (!intro.length ? '<div style="font-size:11px;color:var(--text-3)">这个专业在「宣传相关」里还没有介绍内容。</div>' : ''));
}
// 课程介绍 / 讲师介绍：和「宣传相关」同一套版式（shared/promo-render.js）
function cstPromoBlocks(section) {
  if (!cst.intro) return '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  const list = cst.intro.blocks.filter(b => b.section === section);
  if (!list.length) return '<div style="font-size:11px;color:var(--text-3)">这个专业在「宣传相关」里还没有这部分内容。</div>';
  if (typeof pmrEnsureCss !== 'function') return list.map(b => `<div style="margin-bottom:10px"><b>${cstE(b.title)}</b></div>`).join('');
  pmrEnsureCss();
  return `<div class="pm">${section === 'course' ? pmrCoursesHtml(list, {}) : pmrLecturersHtml(list, { extraFor: cstLectCourses })}</div>`;
}
// ── 讲师卡片下的「负责课程」：讲师档案的担当课程 + 课程安排里当期 / 下一期他上的课 ──
const cstNrm = x => String(x || '').replace(/老师|先生|様|さん/g, '').trim();
const cstTeachNames = t => String(t || '').split(/[、,，\/\s]+/).map(cstNrm).filter(Boolean);
const cstMajorsOf = c => (Array.isArray(c.major) ? c.major : [c.major]).filter(Boolean);
function cstLectNames(row) {
  const t = String(row.title || '').trim(), m = t.match(/^(\S+)[\s　]+(.+)$/), n = cstNrm(m ? m[1] : t), set = new Set([n]);
  cstProfilesOf(n).forEach(p => { set.add(cstNrm(p.name)); if (p.real_name) set.add(cstNrm(p.real_name)); });
  if (typeof prPubMap !== 'undefined' && prPubMap) Object.keys(prPubMap).forEach(k => { if (cstNrm(prPubMap[k]) === n) set.add(k); });
  set.delete(''); return set;
}
function cstPeriodCourses(per) {   // 某一期（cur / next）的课，不含 VIP
  const p = prPeriodKeys()[per];
  return (cst.courses || []).filter(c => !String(c.course_type || '').includes('VIP') && c.first_session_date && c.first_session_date.startsWith(String(p.year)) && effectivePeriod(c) === p.name)
    .sort((a, b) => (a.first_session_date || '').localeCompare(b.first_session_date || ''));
}
const cstDeliv = c => [c.delivery === '线下＋线上' ? '线上线下同步' : c.delivery, c.campus].filter(Boolean).join(' · ');
const cstCrsMeta = c => [prPubTeacher(c.teacher), c.weekdays, c.time_range, c.total_sessions && (c.total_sessions + ' 回'), cstDeliv(c), c.first_session_date && (c.first_session_date + ' 开课')].filter(Boolean).join(' · ');
function cstAddBtn(id) {
  const on = cstCoursesObj(cst.cur).items.some(x => x.id === id);
  return on ? '<span style="font-size:11px;color:#1a5a3a;white-space:nowrap">已加入方案</span>' : `<button class="btn btn-outline btn-sm" style="white-space:nowrap" onclick="cstCrsAdd('${cstJ(id)}')">＋ 加入方案</button>`;
}
function cstLectCourses(row) {
  const names = cstLectNames(row), profs = cstProfilesOf([...names].join('、'));
  const own = [...new Set(profs.flatMap(p => String(p.courses || '').split(/[,，、\/\s]+/).filter(Boolean)))];
  const k = prPeriodKeys(), rows = [];
  ['cur', 'next'].forEach(per => cstPeriodCourses(per).forEach(c => { if (cstTeachNames(c.teacher).some(x => names.has(x))) rows.push([c, per === 'cur' ? '当期' : '下一期']); }));
  if (!own.length && !rows.length) return '';
  return `<div><div class="pm-llabel">负责课程</div><div class="pm-lcontent">
    ${own.length ? `<div class="pm-chips">${own.map(c => `<span class="pm-chip">${pmPlain(c)}</span>`).join('')}</div>` : ''}
    ${rows.map(([c, tag]) => `<div style="display:flex;gap:8px;align-items:center;border-top:1px solid #eee4d8;padding:6px 0;margin-top:6px"><div style="flex:1;min-width:0"><b>${pmPlain(c.name)}</b> <span style="font-size:12px;color:#8a7f73">${pmEsc(tag)} ${pmEsc(k[tag === '当期' ? 'cur' : 'next'].name)}</span><div style="font-size:12px;color:#8a7f73">${pmEsc([c.weekdays, c.time_range, cstDeliv(c)].filter(Boolean).join(' · '))}</div></div>${cst.show ? '' : cstAddBtn(c.id)}</div>`).join('')}</div></div>`;
}
function cstCommonHtml() {
  if (!cst.common) return '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  if (!cst.common.length) return '<div style="font-size:11px;color:var(--text-3)">该领域暂无通用宣传内容。</div>';
  const md = typeof prMd === 'function' ? prMd : cstE;
  return cst.common.map(r => { const k = 'cm_' + r.id, open = k in cst.open ? cst.open[k] : false;
    return `<div style="border:1px solid var(--border-light);border-radius:3px;margin-bottom:6px"><div onclick="cst.open['${cstJ(k)}']=${!open};cstRender()" style="padding:8px 12px;cursor:pointer;font-size:12px;font-weight:600">${cstE(r.title)} <span style="font-size:10px;font-weight:400;color:var(--text-3)">${open ? '▾' : '▸'}</span></div>${open ? `<div style="padding:0 12px 10px;font-size:12px;line-height:1.9;color:var(--text-2)">${md(r.body)}</div>` : ''}</div>`; }).join('');
}
function cstAdmHtml() {
  const l = cst.cur, f = cstFilters(l);
  if (cst.admLoading) return '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  if (!cst.adm.length) return `<div style="font-size:11px;color:var(--text-3)">出愿数据库里还没有「${cstE(cstMajorName(l.target_major))}」的数据。${cst.admErr ? '（' + cstE(cst.admErr) + '）' : ''}</div>`;
  const pref = l.school_grade != null ? String(l.school_grade) : '';
  const rows = cstAdmFiltered().sort((x, y) => CST_ST_ORDER[x.ev.st] - CST_ST_ORDER[y.ev.st] || ((String(cstTier(y.a.university)) === pref) - (String(cstTier(x.a.university)) === pref)) || (cstTier(x.a.university) - cstTier(y.a.university)) || String(x.a.university).localeCompare(String(y.a.university), 'ja'));
  const cnt = {}; cst.adm.forEach(a => { const s = cstEval(a).st; cnt[s] = (cnt[s] || 0) + 1; });
  const mSel = (k, ph) => `<select onchange="cstSetF('${k}',parseInt(this.value)||0)" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg)"><option value="0">${ph}</option>${[...Array(12)].map((_, i) => `<option value="${i + 1}" ${f[k] === i + 1 ? 'selected' : ''}>${i + 1}月</option>`).join('')}</select>`;
  const chips = [['noEn', '不要英语'], ['noJp', '不要日语'], ['noWr', '无笔试'], ['noOr', '无面试']].map(([k, t]) => cstChip(!!f[k], t, `cstToggleF('${k}')`)).join('') +
    Object.keys(CST_ST).map(s => cstChip(f.status.includes(s), `${CST_ST[s][0]} ${cnt[s] || 0}`, `cstToggleStatus('${s}')`)).join('') +
    '<span style="width:1px;background:var(--border);margin:0 4px"></span>' + CST_TIERS.map(([k]) => cstChip((f.tiers || []).includes(k), 'T' + k, `cstToggleTier('${k}')`)).join('');
  let empty = '';
  if (!rows.length) {
    const hints = [['q', '搜索词'], ['noEn', '不要英语'], ['noJp', '不要日语'], ['noWr', '无笔试'], ['noOr', '无面试'], ['status', '状态'], ['tier', '学校等级'], ['month', '出愿月份']].filter(([k]) => cstAdmFiltered(k).length).map(x => x[1]);
    empty = `<div style="padding:16px;text-align:center;font-size:12px;color:var(--text-3)">没有符合的院校。${hints.length ? `去掉「${hints.join('」或「')}」条件就会有结果。` : '请放宽条件。'}</div>`;
  }
  const shown = rows.slice(0, cst.admLimit);
  const goalIds = (l.goals || []).map(g => g.id);
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <input placeholder="搜索学校 / 研究科" value="${cstE(f.q || '')}" onchange="cstSetF('q',this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;width:170px">
      <span style="font-size:10px;color:var(--text-3)">出愿月份</span>${mSel('mFrom', '从')}<span style="font-size:11px">—</span>${mSel('mTo', '至')}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${chips}</div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">共 ${rows.length} 条（出愿数据库里每个学校每一期各一条；T0–T3 学校等级沿用合格实绩，只用来排序和筛选）</div>
    ${empty}${shown.map(({ a, ev }) => {
      const c = CST_ST[ev.st], isG = goalIds.includes(a.id), profs = cstProfsOf(a.university), pk = 'pf_' + a.id, pOpen = pk in cst.open ? cst.open[pk] : false;
      return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:9px 12px;margin-bottom:6px;background:var(--surface)">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:600">${cstE(a.university)}</span>${cstTierTag(a.university)}
          <span style="font-size:11px;color:var(--text-2)">${cstE([a.faculty, a.department, a.course].filter(Boolean).join(' '))}</span>
          <span style="font-size:10px;padding:1px 7px;border-radius:2px;background:${c[2]};color:${c[1]}">${c[0]}</span>
          ${profs.length ? `<button class="btn btn-sm btn-outline" style="margin-left:auto" onclick="cst.open['${cstJ(pk)}']=${!pOpen};cstRender()">教授 ${profs.length} ${pOpen ? '▾' : '▸'}</button>` : ''}
          <button class="btn btn-sm ${isG ? 'btn-primary' : 'btn-outline'}" style="${profs.length ? '' : 'margin-left:auto'}" onclick="cstToggleGoal('${cstJ(a.id)}')">${isG ? '已设为目标' : '设为目标'}</button></div>
        <div style="font-size:11px;color:var(--text-3);margin-top:4px;line-height:1.8">出愿 ${cstE(a.application_period || '-')} · 笔试 ${cstE(a.written_exam || '-')} · 面试 ${cstE(a.oral_exam || '-')} · 英语 ${cstE(a.english_required || '-')}${a.english_detail ? '（' + cstE(a.english_detail) + '）' : ''} · 日语 ${cstE(a.japanese_required || '-')}${a.japanese_detail ? '（' + cstE(a.japanese_detail) + '）' : ''}</div>
        ${ev.notes.length ? `<div style="font-size:11px;color:${c[1]};margin-top:3px">${cstE(ev.notes.join('；'))}</div>` : ''}${pOpen && profs.length ? `<div style="margin-top:8px">${cstProfCards(profs)}</div>` : ''}</div>`;
    }).join('')}
    ${rows.length > cst.admLimit ? `<div onclick="cst.admLimit+=30;cstRender()" style="text-align:center;padding:10px;font-size:11px;color:var(--accent);border:1px dashed var(--border);border-radius:4px;cursor:pointer">显示更多（还有 ${rows.length - cst.admLimit} 条）</div>` : ''}
    <div style="font-size:10px;color:var(--text-3);margin-top:8px">具备报考资格，就已经迈出了第一步，一起加油！「出愿时间已过」按目标入学时间推算，仅供参考。</div>`;
}
function cstGoalLabel(a) { return [a.university, a.faculty, a.department || a.course].filter(Boolean).join(' '); }
function cstToggleGoal(id) {
  const l = cst.cur, a = cst.adm.find(x => x.id === id); if (!a) return;
  const g = (l.goals || []).slice(), i = g.findIndex(x => x.id === id);
  if (i >= 0) g.splice(i, 1); else g.push({ id, label: cstGoalLabel(a), uni: a.university, kind: '主申' });
  cstSet('goals', g); cstRender();
}
function cstGoalKind(id, v) { const g = (cst.cur.goals || []).slice(), x = g.find(y => y.id === id); if (x) x.kind = v; cstSet('goals', g); cstRender(); }
function cstGoalsHtml() {
  const l = cst.cur, goals = l.goals || [];
  if (!goals.length) return '<div style="font-size:11px;color:var(--text-3)">还没有目标。在上面的院校列表里点「设为目标」，可选多个，每个标冲刺 / 主申 / 保底。</div>';
  return goals.map(g => {
    const a = cst.adm.find(x => x.id === g.id), ev = a ? cstEval(a) : null, c = ev && CST_ST[ev.st];
    const nowCond = [l.jp_status === 'have' ? `日语 ${l.jp_exam || ''} ${l.jp_score || ''}` : (l.jp_status === 'none' ? '日语未参加' : '日语待录入'), l.en_status === 'have' ? `英语 ${l.en_exam || ''} ${l.en_score || ''}` : (l.en_status === 'none' ? '英语未参加' : '英语待录入')].join('，');
    return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:9px 12px;margin-bottom:6px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:13px;font-weight:600">${cstE(g.label)}</span>${cstTierTag(g.uni)}
        ${CST_KINDS.map(k => cstChip(g.kind === k, k, `cstGoalKind('${cstJ(g.id)}','${k}')`)).join('')}
        <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="cstToggleGoal('${cstJ(g.id)}')">移除</button></div>
      ${a ? `<div style="font-size:11px;color:var(--text-2);margin-top:5px;line-height:1.8">要求：英语 ${cstE(a.english_required || '-')}${a.english_detail ? '（' + cstE(a.english_detail) + '）' : ''}，日语 ${cstE(a.japanese_required || '-')}${a.japanese_detail ? '（' + cstE(a.japanese_detail) + '）' : ''}，出愿 ${cstE(a.application_period || '-')}<br>当前条件：${cstE(nowCond)}<br>差距：<span style="color:${c[1]}">${c[0]}${ev.notes.length ? '——' + cstE(ev.notes.join('；')) : ''}</span></div>` : '<div style="font-size:10px;color:var(--text-3);margin-top:4px">（院校数据还没加载，选了对应专业后会显示要求和差距）</div>'}</div>`;
  }).join('');
}
function cstCasesHtml() {
  const l = cst.cur; if (!cst.cases) return '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  const unis = (l.goals || []).map(g => g.uni).filter(Boolean);
  const hit = cst.cases.filter(c => (c.majors || []).includes(l.target_major) || unis.some(u => (c.schools || []).some(s => String(s.label || s).includes(u)) || String(c.result || '').includes(u)));
  if (!hit.length) return '<div style="font-size:11px;color:var(--text-3)">暂时没有和这位咨询者的专业 / 目标校相关的已发布案例。</div>';
  return hit.slice(0, 12).map(c => `<div style="border:1px solid var(--border-light);border-radius:3px;padding:9px 12px;margin-bottom:6px"><div style="font-weight:600;font-size:12px">${cstE(c.alias || '')} <span style="font-weight:400;color:var(--text-3)">${cstE(c.tagline || '')}</span></div><div style="font-size:11px;color:var(--text-2);line-height:1.8;margin-top:3px">${cstE(c.background || '')}</div><div style="font-size:11px;color:var(--accent);margin-top:3px">合格：${cstE(c.result || '')}</div></div>`).join('');
}

// ══════════ 第 3 步：课程与方案 ══════════
async function cstLoadCourses() {
  if (cst.courses) return; cst.courses = [];
  try {
    if (typeof PERIODS !== 'undefined' && !PERIODS.length && typeof loadPeriodsFromDB === 'function') await loadPeriodsFromDB();   // 算「当期 / 下一期」要用
    const [cs, pk, th] = await Promise.all([
      sbAll('/rest/v1/courses?select=id,name,major,period,period_override,course_type,domain,teacher,weekdays,time_range,delivery,campus,total_sessions,first_session_date&order=first_session_date.desc'),
      sbAll('/rest/v1/price_packages?active=is.true&select=*&order=sort_order.asc').catch(() => []),
      typeof prPubMap !== 'undefined' && prPubMap ? Promise.resolve(null) : sb('/rest/v1/teachers?select=name,public_name').catch(() => []),
    ]);
    if (th) { prPubMap = {}; th.forEach(t => { const k = cstNrm(t.name), pub = String(t.public_name || '').trim(); if (k && pub) prPubMap[k] = pub; }); }   // 老师对外名称（同「宣传相关 → 课程表」）
    if (typeof prCourses !== 'undefined' && !prCourses) prCourses = cs;
    cst.courses = cs; cst.pkgs = pk.filter(p => salesDomOkMe(p.domain || (DOMAINS.some(d => d.label === p.track) ? p.track : '')));
  } catch (e) { cst.courses = []; cst.pkgs = []; }
  cstRefresh();
}
function cstCourseEnd(c) {
  if (!c.first_session_date) return null;
  const d = new Date(c.first_session_date + 'T00:00:00'), per = Math.max(1, String(c.weekdays || '').split(/[,，、\s]+/).filter(Boolean).length);
  d.setDate(d.getDate() + Math.max(0, Math.ceil((c.total_sessions || 1) / per) - 1) * 7); return d;
}
function cstCrsAdd(id) {
  const co = cstCoursesObj(cst.cur), c = (cst.courses || []).find(x => x.id === id); if (!c || co.items.some(x => x.id === id)) return;
  const end = cstCourseEnd(c);
  co.items.push({ id, name: c.name, teacher: c.teacher || '', start: c.first_session_date || '', end: end ? end.toISOString().slice(0, 10) : '', reason: '' });
  cstSet('courses', co); cstRender();
}
// 差距 → 课程 / 介绍：差距按目标校和咨询者条件算出来；再用内置关键词去现有宣传内容里找（不需要管理员配置）
function cstGaps() {
  const l = cst.cur, set = new Set(), goals = (l.goals || []).map(g => cst.adm.find(a => a.id === g.id)).filter(Boolean);
  goals.forEach(a => { cstEval(a).gaps.forEach(x => set.add(x)); if (!cstNone(a.oral_exam)) set.add('interview'); if (!cstNone(a.written_exam)) set.add('written'); });
  if (goals.length && l.target_level !== 'gakubu') set.add('plan');
  if (l.major_match === '跨专业') set.add('specialty');
  return CST_GAPS.filter(([k]) => set.has(k));
}
const CST_GAP_KW = {
  plan: ['zemi', 'ゼミ', '计划书', '計画書', '研究计划', '志望理由'],
  written: ['过去问', '過去問', '演习', '演習', '笔试', '筆記', '专业课'],
  interview: ['面试', '面接', '口述', '口頭'],
  jp: ['日语', '日本語', '日本语', 'jlpt', 'n1', 'n2', 'eju'],
  en: ['英语', '英語', 'toeic', 'toefl', 'ielts'],
  specialty: ['基础', '入门', '概论', '専門基礎', '专业课'],
};
const cstKwHit = (gap, text) => { const t = String(text || '').toLowerCase(); return (CST_GAP_KW[gap] || []).some(k => t.includes(k)); };
const CST_GAP_LANG = { jp: 'nihongo', en: 'eigo' };
function cstCrsCovers(gap, x) {   // 已选的某门课是否覆盖这个差距：课程名命中关键词；日语 / 英语差距也认语言课
  if (cstKwHit(gap, x.name)) return true;
  const c = (cst.courses || []).find(y => y.id === x.id);
  return !!(c && CST_GAP_LANG[gap] && typeof prLangKind === 'function' && prLangKind(c) === CST_GAP_LANG[gap]);
}
function cstCoveredGaps(items) { const out = new Set(); CST_GAPS.forEach(([k]) => { if (items.some(x => cstCrsCovers(k, x))) out.add(k); }); return out; }
function cstCrsDel(id) {
  const co = cstCoursesObj(cst.cur), after = co.items.filter(x => x.id !== id), need = new Set(cstGaps().map(g => g[0]));
  const before = cstCoveredGaps(co.items), now = cstCoveredGaps(after);
  const lost = CST_GAPS.filter(([k]) => need.has(k) && before.has(k) && !now.has(k)).map(g => g[1]);
  if (lost.length && !confirm(`删掉这门课后，「${lost.join('」「')}」这个差距就没有课程覆盖了。确定删除吗？`)) return;
  co.items = after; cstSet('courses', co); cstRender();
}
function cstCrsReason(id, v) { const co = cstCoursesObj(cst.cur), x = co.items.find(y => y.id === id); if (x) x.reason = v; cstSet('courses', co); }
function cstPkgAdd(id) { const co = cstCoursesObj(cst.cur); if (id && !co.pkgs.includes(id)) co.pkgs.push(id); cstSet('courses', co); cstRender(); }
function cstPkgDel(id) { const co = cstCoursesObj(cst.cur); co.pkgs = co.pkgs.filter(x => x !== id); cstSet('courses', co); cstRender(); }
function cstCustomAdd() {
  const n = document.getElementById('cst_cn'), y = document.getElementById('cst_cy'); if (!n || !n.value.trim()) return;
  const co = cstCoursesObj(cst.cur); co.custom.push({ name: n.value.trim(), yen: Math.round(Number(y.value) || 0) }); cstSet('courses', co); cstRender();
}
function cstCustomDel(i) { const co = cstCoursesObj(cst.cur); co.custom.splice(i, 1); cstSet('courses', co); cstRender(); }
function cstPriceLines() {
  const co = cstCoursesObj(cst.cur), lines = [];
  co.pkgs.forEach(id => { const p = (cst.pkgs || []).find(x => x.id === id); if (p) lines.push({ name: p.name, detail: [p.track, p.period].filter(Boolean).join(' · '), yen: Math.round(Number(p.price_man_yen) * 10000), del: `cstPkgDel('${cstJ(id)}')` }); });
  co.custom.forEach((c, i) => lines.push({ name: c.name, detail: '其他', yen: c.yen, del: `cstCustomDel(${i})` }));
  return { lines, total: lines.reduce((s, x) => s + x.yen, 0) };
}
function cstP31() { cstLoadCourses(); cstLoadAdm(); cstLoadIntro(); cstLoadCommon(); return cstGapHtml(); }
function cstP32() {
  cstLoadCourses(); cstLoadProfiles(); cstLoadIntro();
  if (!cst.courses) return '<div class="empty">加载中…</div>';
  return `<div class="cst-sub" style="margin-top:0">已选的课程（${cstCoursesObj(cst.cur).items.length}）</div>${cstPickedHtml()}<div class="cst-sub">添加课程<span>来自「课程安排」里已开的班级</span></div>${cstCrsFilterHtml()}<div id="cst_crs_list">${cstCrsListHtml()}</div>`;
}
function cstP33() { cstLoadCourses(); return cstPriceHtml(); }
function cstP34() { cstLoadCourses(); cstLoadAdm(); return cstTimelineHtml(); }
// 某个差距在现有内容里能找到什么：课程介绍（宣传相关）、当期 / 下一期开课班级、通用宣传（关于唯新）
function cstGapFind(gap) {
  const l = cst.cur, picked = cstCoursesObj(l).items.map(x => x.id), tgt = [l.target_major, typeof groupOf === 'function' ? groupOf(l.target_major) : ''].filter(Boolean);
  const intros = ((cst.intro && cst.intro.blocks) || []).filter(b => b.section === 'course' && cstKwHit(gap, b.title + ' ' + b.body));
  const crs = [], seen = new Set();
  ['next', 'cur'].forEach(per => cstPeriodCourses(per).forEach(c => {
    if (seen.has(c.id) || picked.includes(c.id)) return;
    const mine = cstMajorsOf(c).some(m => tgt.includes(m)), lang = typeof prLangKind === 'function' ? prLangKind(c) : '';
    const hit = CST_GAP_LANG[gap] ? (lang === CST_GAP_LANG[gap]) : (mine && cstKwHit(gap, c.name));
    if (hit) { seen.add(c.id); crs.push(c); }
  }));
  const commons = (cst.common || []).filter(r => cstKwHit(gap, r.title + ' ' + r.body));
  return { intros, crs, commons };
}
function cstIntroBrief(b) {
  const s = typeof pmSplit === 'function' ? pmSplit(b.body, PMR_COURSE_LABELS) : null, t = String((s && s.known && s.vals['课程描述']) || b.body || '').replace(/\*\*|__/g, '').split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
  return t.length > 70 ? t.slice(0, 70) + '…' : t;
}
function cstGapHtml() {
  const l = cst.cur, gaps = cstGaps(), picked = cstCoursesObj(l).items, cov = cstCoveredGaps(picked);
  if (!(l.goals || []).length) return '<div style="font-size:11px;color:var(--text-3)">先在第 ② 步设好目标校，这里会列出要补足的差距，并找出对应的课程和介绍。</div>';
  if (!gaps.length) return '<div style="font-size:11px;color:var(--text-3)">按目标校的要求，暂时没有需要补足的差距。</div>';
  const md = typeof prMd === 'function' ? prMd : cstE, tog = (k, open) => `cst.open['${cstJ(k)}']=${!open};cstRender()`;
  return gaps.map(([k, t]) => {
    const ok = cov.has(k), f = cstGapFind(k), none = !f.intros.length && !f.crs.length && !f.commons.length;
    const intros = f.intros.map(b => { const ok2 = 'gi_' + k + b.id, open = ok2 in cst.open ? cst.open[ok2] : false;
      return `<div style="margin-top:6px;border-left:3px solid var(--border);padding-left:10px"><div onclick="${tog(ok2, open)}" style="cursor:pointer;font-size:12px"><b>${cstE(String(b.title || '').replace(/\*\*|__/g, ''))}</b> <span style="color:var(--text-3)">${cstE(cstIntroBrief(b))}</span> <span style="font-size:10px;color:var(--accent)">${open ? '▾ 收起' : '▸ 看完整介绍'}</span></div>${open && typeof pmrCoursesHtml === 'function' ? (pmrEnsureCss(), `<div class="pm" style="margin-top:6px">${pmrCoursesHtml([b], { print: true })}</div>`) : ''}</div>`; }).join('');
    const crs = f.crs.slice(0, 8).map(c => `<div style="display:flex;gap:8px;align-items:center;margin-top:6px;font-size:12px"><div style="flex:1;min-width:0"><b>${cstE(c.name)}</b> <span style="color:var(--text-3)">${cstE(prPeriodKeys()[cstPeriodCourses('cur').some(x => x.id === c.id) ? 'cur' : 'next'].label)}</span><div style="font-size:11px;color:var(--text-3)">${cstE(cstCrsMeta(c))}</div></div>${cstAddBtn(c.id)}</div>`).join('') + (f.crs.length > 8 ? `<div style="font-size:11px;color:var(--text-3);margin-top:4px">还有 ${f.crs.length - 8} 个班级，在「选择课程」里查看</div>` : '');
    const comm = f.commons.map(r => { const ck = 'gc_' + k + r.id, open = ck in cst.open ? cst.open[ck] : false;
      return `<div style="margin-top:6px;border-left:3px solid var(--border);padding-left:10px"><div onclick="${tog(ck, open)}" style="cursor:pointer;font-size:12px"><b>${cstE(String(r.title || '').replace(/\*\*|__/g, ''))}</b> <span style="font-size:10px;color:var(--text-3)">关于唯新</span> <span style="font-size:10px;color:var(--accent)">${open ? '▾ 收起' : '▸ 展开全文'}</span></div>${open ? `<div style="font-size:12px;line-height:1.9;color:var(--text-2);margin-top:4px">${md(r.body)}</div>` : ''}</div>`; }).join('');
    return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:8px 12px;margin-bottom:8px">
      <div style="display:flex;gap:8px;align-items:center"><span style="font-size:12px;font-weight:600">${t}</span><span style="font-size:10px;padding:1px 7px;border-radius:2px;background:${ok ? '#e6f2ea' : '#f6e2de'};color:${ok ? '#1a5a3a' : '#a03a2e'}">${ok ? '已有课程覆盖' : '还没选课程'}</span></div>
      ${none ? '<div style="font-size:11px;color:var(--text-3);margin-top:4px">目前宣传内容里没有找到对应介绍，可以在「选择课程」里手动添加。</div>' : intros + crs + comm}</div>`;
  }).join('');
}
function cstPickedHtml() {
  const items = cstCoursesObj(cst.cur).items, lv = ((cst.intro && cst.intro.videos) || []).filter(v => v.kind === 'lesson');
  const lvHtml = lv.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><span style="font-size:10px;color:var(--text-3);align-self:center">试听 / 正课体验视频</span>${lv.map(v => `<a href="${cstE(v.url)}" target="_blank" class="filter-chip" style="text-decoration:none">${cstE(v.title)}${v.duration ? '（' + cstE(v.duration) + '）' : ''}</a>`).join('')}</div>` : '';
  if (!items.length) return lvHtml + '<div style="font-size:11px;color:var(--text-3)">还没有选课程。在下面「添加课程」里选；每门课写一句选择理由，方便后面生成方案。</div>';
  return lvHtml + items.map(x => `<div style="border:1px solid var(--border-light);border-radius:3px;padding:8px 12px;margin-bottom:6px">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:12px;font-weight:600">${cstE(x.name)}</span><span style="font-size:10px;color:var(--text-3)">${cstE([x.teacher, x.start && (x.start + ' 起')].filter(Boolean).join(' · '))}</span>${cstTeacherCard(x)}
    <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="cstCrsDel('${cstJ(x.id)}')">删除</button></div>
    <input placeholder="选择理由（例如：补足计划书、日语 N1）" value="${cstE(x.reason)}" onchange="cstCrsReason('${cstJ(x.id)}',this.value)" style="width:100%;margin-top:6px;font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box"></div>`).join('');
}
// 选择课程：和「宣传相关 → 课程表」同一套——期数、本专业 / 日语 / 英语 / 同领域其他专业；搜索框输入即搜，搜全部当期 / 下一期课程
function cstOtherMajors() {
  const l = cst.cur, dom = admissionMajorDomain(l.target_major) || (typeof MAJOR_DOMAIN !== 'undefined' ? MAJOR_DOMAIN[l.target_major] : ''), all = typeof allMajorKeys === 'function' ? allMajorKeys() : Object.keys(MAJORS);
  return all.filter(k => k !== l.target_major && !isMajorGroup(k) && dom && MAJOR_DOMAIN[k] === dom && salesMajorOkMe(k));
}
function cstCrsPool() {   // 当前范围的课（还没按搜索筛）
  const l = cst.cur, per = cst.crsPer, tgt = [l.target_major, typeof groupOf === 'function' ? groupOf(l.target_major) : ''].filter(Boolean);
  const pool = cstPeriodCourses(per), lang = c => (typeof prLangKind === 'function' ? prLangKind(c) : '');
  if (cst.crsScope === 'nihongo' || cst.crsScope === 'eigo') return pool.filter(c => lang(c) === cst.crsScope && (!cst.crsCampus || (c.campus || '') === cst.crsCampus));
  if (cst.crsScope === 'other') return cst.crsOther ? pool.filter(c => !lang(c) && cstMajorsOf(c).includes(cst.crsOther)) : [];
  return pool.filter(c => !lang(c) && cstMajorsOf(c).some(m => tgt.includes(m)));
}
function cstCrsSet(k, v) { cst[k] = v; if (k === 'crsScope') { cst.crsCampus = ''; if (v !== 'other') cst.crsOther = ''; } if (k === 'crsPer') cst.crsCampus = ''; cst.crsLimit = 30; cstRender(); }
function cstCrsRefresh() { const el = document.getElementById('cst_crs_list'); if (el) el.innerHTML = cstCrsListHtml(); }
function cstCrsSearch(q) { cst.crsQ = q; cst.crsLimit = 30; cstCrsRefresh(); }
function cstCrsFilterHtml() {
  const k = prPeriodKeys(), q = cst.crsQ.trim(), row = (label, inner) => `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px"><span style="font-size:11px;color:var(--text-3)">${label}</span>${inner}</div>`;
  const scope = [['major', '本专业'], ['nihongo', '日语'], ['eigo', '英语'], ['other', '同领域其他专业']];
  const camp = (cst.crsScope === 'nihongo' || cst.crsScope === 'eigo') ? [...new Set(cstPeriodCourses(cst.crsPer).filter(c => prLangKind(c) === cst.crsScope).map(c => c.campus || '').filter(Boolean))] : [];
  return `<input placeholder="搜索课程 / 老师（搜全部当期、下一期课程，不受下面筛选限制）" value="${cstE(cst.crsQ)}" oninput="searchBox(this,cstCrsSearch)" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box;margin-bottom:8px">
    ${row('期数', cstChip(cst.crsPer === 'next', `下一期（${k.next.label}）`, `cstCrsSet('crsPer','next')`) + cstChip(cst.crsPer === 'cur', `当期（${k.cur.label}）`, `cstCrsSet('crsPer','cur')`))}
    ${row('范围', scope.map(([v, t]) => cstChip(cst.crsScope === v, t, `cstCrsSet('crsScope','${v}')`)).join(''))}
    ${cst.crsScope === 'other' ? row('专业', chipFold(cstOtherMajors().map(m => ({ on: cst.crsOther === m, html: cstChip(cst.crsOther === m, cstE(cstMajorName(m)), `cstCrsSet('crsOther','${cstJ(m)}')`) })))) : ''}
    ${camp.length ? row('校区', cstChip(!cst.crsCampus, '全部', `cstCrsSet('crsCampus','')`) + chipFold(camp.map(c => ({ on: cst.crsCampus === c, html: cstChip(cst.crsCampus === c, cstE(c), `cstCrsSet('crsCampus','${cstJ(c)}')`) })))) : ''}
    ${q ? '<div style="font-size:11px;color:var(--accent);margin-bottom:4px">正在搜索全部当期 / 下一期课程；清空搜索框回到上面的筛选</div>' : ''}`;
}
function cstCrsListHtml() {
  const picked = cstCoursesObj(cst.cur).items.map(x => x.id), q = cst.crsQ.trim(), k = prPeriodKeys();
  let rows;
  if (q) rows = [...cstPeriodCourses('next'), ...cstPeriodCourses('cur')].filter(c => searchMatch(q, [c.name, c.teacher, prPubTeacher(c.teacher), cstMajorsOf(c).map(cstMajorName).join(' ')]));
  else rows = cstCrsPool();
  rows = rows.filter(c => !picked.includes(c.id));
  const total = rows.length, empty = !q && cst.crsScope === 'other' && !cst.crsOther ? '先选一个专业' : '这一期没有符合条件的课程';
  const perOf = c => cstPeriodCourses('cur').some(x => x.id === c.id) ? k.cur.name : k.next.name;
  return rows.slice(0, cst.crsLimit).map(c => `<div style="display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--border-light);padding:6px 2px;font-size:12px"><div style="flex:1;min-width:0"><div style="font-weight:600">${cstE(c.name)}${q ? ` <span style="font-weight:400;font-size:10px;color:var(--text-3)">${cstE(perOf(c))}</span>` : ''}</div><div style="font-size:10px;color:var(--text-3)">${cstE(cstCrsMeta(c))}</div></div><button class="btn btn-outline btn-sm" onclick="cstCrsAdd('${cstJ(c.id)}')">＋ 加入方案</button></div>`).join('') || `<div style="font-size:11px;color:var(--text-3)">${empty}。</div>`
    + (total > cst.crsLimit ? `<div onclick="cst.crsLimit+=30;cstCrsRefresh()" style="text-align:center;padding:10px;font-size:11px;color:var(--accent);cursor:pointer">显示更多（还有 ${total - cst.crsLimit} 门）</div>` : '');
}
function cstPriceHtml() {
  const co = cstCoursesObj(cst.cur), { lines, total } = cstPriceLines();
  const opts = (cst.pkgs || []).filter(p => !co.pkgs.includes(p.id));
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <select id="cst_pk" style="font-size:12px;padding:5px;border:1px solid var(--border);border-radius:3px;max-width:100%"><option value="">选择大课套餐…</option>${opts.map(p => `<option value="${cstE(p.id)}">${cstE(p.track)} · ${cstE(p.name)}（${Number(p.price_man_yen)}万）</option>`).join('')}</select>
      <button class="btn btn-outline btn-sm" onclick="cstPkgAdd(document.getElementById('cst_pk').value)">＋ 加入</button>
      <input id="cst_cn" placeholder="其他项目（如 VIP 课、优惠）" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;width:170px"><input id="cst_cy" type="number" placeholder="日元（优惠填负数）" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;width:150px">
      <button class="btn btn-outline btn-sm" onclick="cstCustomAdd()">＋ 加入</button></div>
    ${lines.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px">${lines.map(x => {
      const del = x.del;
      return `<tr style="border-bottom:1px solid var(--border-light)"><td style="padding:6px 4px"><div style="font-weight:600">${cstE(x.name)}</div><div style="font-size:10px;color:var(--text-3)">${cstE(x.detail)}</div></td><td style="padding:6px 4px;text-align:right;font-family:'DM Mono',monospace;color:${x.yen < 0 ? '#a03a2e' : 'inherit'}">${cstYen(x.yen)}</td><td style="width:50px;text-align:right"><span style="font-size:10px;color:var(--text-3);cursor:pointer" onclick="${del}">删除</span></td></tr>`;
    }).join('')}</table>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px;padding-top:8px;border-top:2px solid var(--accent)"><span style="font-weight:600">总价</span><span><b style="font-size:18px;color:var(--accent);font-family:'DM Mono',monospace">${cstYen(total)}</b> 日元</span></div>` : '<div style="font-size:11px;color:var(--text-3)">还没选套餐。价格来自中枢「价目」里的大课套餐；VIP、助教等用「其他项目」手填，算不出来的请标注「需人工确认」。</div>'}
    ${cstPriceWarn()}${cstPkgBlocks()}`;
}
// 套餐「包含 / 另购 / 不包含」：包含 = 价目里标 ○，另购 = 标 △，不包含 = 同一价目表其他套餐有、这个套餐没有的项目
function cstPkgInfo(p) {
  const inc = Array.isArray(p.included) ? p.included : [], key = x => (x.group || '') + '\u0001' + (x.item || ''), mine = new Set(inc.map(key)), uni = new Map();
  (cst.pkgs || []).filter(q => q.track === p.track).forEach(q => (Array.isArray(q.included) ? q.included : []).forEach(x => uni.set(key(x), x)));
  const have = [], opt = [], exc = [];
  inc.forEach(x => (String(x.mark || '○') === '△' ? opt : have).push(x));
  uni.forEach((x, k) => { if (!mine.has(k)) exc.push(x); });
  return { have, opt, exc };
}
function cstGroupLines(list, color, mark) {
  const g = new Map(); list.forEach(x => { const k = x.group || ''; if (!g.has(k)) g.set(k, []); g.get(k).push(x.item); });
  return [...g.entries()].map(([k, items]) => `<div style="font-size:11px;line-height:1.8;color:${color}">${k ? `<span style="font-size:10px;opacity:.7">${cstE(k)}　</span>` : ''}${items.map(i => `${mark} ${cstE(i)}`).join('　')}</div>`).join('');
}
function cstPkgBlocks() {
  const co = cstCoursesObj(cst.cur), sel = co.pkgs.map(id => (cst.pkgs || []).find(p => p.id === id)).filter(Boolean);
  if (!sel.length) return '';
  return sel.map(p => {
    const { have, opt, exc } = cstPkgInfo(p), open = ('pk_' + p.id) in cst.open ? cst.open['pk_' + p.id] : false;
    return `<div style="border:1px solid var(--border-light);border-radius:3px;margin-top:8px"><div onclick="cst.open['pk_${cstJ(p.id)}']=${!open};cstRender()" style="padding:7px 12px;cursor:pointer;font-size:12px;font-weight:600">${cstE(p.name)} 的内容 <span style="font-size:10px;font-weight:400;color:var(--text-3)">包含 ${have.length} · 另购 ${opt.length} · 不包含 ${exc.length}　${open ? '▾' : '▸'}</span></div>
      ${open ? `<div style="padding:0 12px 10px">${cstGroupLines(have, '#1a3a1a', '✓')}${opt.length ? `<div style="font-size:10px;color:var(--text-3);margin-top:6px">另购 / 可选</div>${cstGroupLines(opt, '#8a6a1a', '△')}` : ''}${exc.length ? `<div style="font-size:10px;color:var(--text-3);margin-top:6px">不包含</div>${cstGroupLines(exc, '#aaa', '—')}` : ''}${p.period ? `<div style="font-size:10px;color:var(--text-3);margin-top:6px">期限：${cstE(p.period)}</div>` : ''}</div>` : ''}</div>`;
  }).join('');
}
// 改课程后价格是否还对得上：课程在所选套餐的包含项目里找不到对应项，就提示需人工确认
function cstPriceWarn() {
  const co = cstCoursesObj(cst.cur), items = co.items; if (!items.length) return '';
  const sel = co.pkgs.map(id => (cst.pkgs || []).find(p => p.id === id)).filter(Boolean);
  let msg = '';
  if (!sel.length) msg = `已选了 ${items.length} 门课程，但还没有选套餐：价格需人工确认。`;
  else {
    const names = sel.flatMap(p => (Array.isArray(p.included) ? p.included : []).map(x => x.item || '')).filter(Boolean);
    if (names.length) {
      const miss = items.filter(x => !names.some(n => n.includes(x.name) || x.name.includes(n))).map(x => x.name);
      if (miss.length) msg = `这些课程在所选套餐的包含项目里没找到对应项，是否另计价格需人工确认：${miss.join('、')}`;
    }
  }
  return msg ? `<div style="background:#e8e8f4;color:#4a4a8a;font-size:11px;padding:7px 10px;border-radius:3px;margin-top:8px;line-height:1.8">${cstE(msg)}</div>` : '';
}
// 详细时间轴：按月排课程、目标校出愿、入学；课程结束晚于出愿截止的标红
function cstTimelineHtml() {
  const l = cst.cur, en = cstEnroll(l), items = cstCoursesObj(l).items;
  if (!en) return '<div style="font-size:11px;color:var(--text-3)">先在第 ① 步选「目标入学时间」。</div>';
  const now = new Date(), s0 = cstYm(now), e0 = en.y * 12 + en.m - 1, span = Math.min(Math.max(e0 - s0, 3), 30);
  const months = [...Array(span + 1)].map((_, i) => s0 + i);
  const goals = (l.goals || []).map(g => ({ g, a: cst.adm.find(x => x.id === g.id) })).filter(x => x.a);
  const dls = goals.map(({ a }) => cstDeadline(a, l)).filter(Boolean), firstDl = dls.length ? Math.min(...dls.map(d => cstYm(d))) : null;
  const rows = [];
  items.forEach(x => {
    if (!x.start) return;
    const s = cstYm(new Date(x.start + 'T00:00:00')), e = x.end ? cstYm(new Date(x.end + 'T00:00:00')) : s;
    rows.push({ name: x.name, from: s, to: e, color: '#b8953a', bad: firstDl != null && e > firstDl, note: firstDl != null && e > firstDl ? '课程结束晚于最早的出愿截止' : '' });
  });
  goals.forEach(({ g, a }) => {
    const ms = (String(a.application_period || '').match(/(\d{1,2})月/g) || []).map(x => parseInt(x)); if (!ms.length) return;
    const dl = cstDeadline(a, l); if (!dl) return;
    const to = cstYm(dl), from = to - (Math.max(...ms) - Math.min(...ms));
    rows.push({ name: `出愿：${g.uni}（${g.kind}）`, from, to, color: '#3a6a9a', bad: dl < now, note: dl < now ? '出愿时间已过' : '' });
  });
  rows.push({ name: '入学', from: e0, to: e0, color: '#1a5a3a' });
  const warns = rows.filter(r => r.note).map(r => `${r.name}：${r.note}`);
  if (!rows.length || (!items.length && !goals.length)) return '<div style="font-size:11px;color:var(--text-3)">选了课程和目标校后，这里会把它们排在同一条按月时间轴上。</div>' + '';
  return `${warns.length ? `<div style="background:#f6e2de;color:#a03a2e;font-size:11px;padding:7px 10px;border-radius:3px;margin-bottom:8px;line-height:1.8">${warns.map(cstE).join('<br>')}</div>` : ''}
    <div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:10px;min-width:100%"><tr><td style="padding:3px 6px;min-width:160px"></td>${months.map(m => `<td style="padding:3px 2px;text-align:center;color:var(--text-3);min-width:34px">${cstYmLabel(m)}</td>`).join('')}</tr>
    ${rows.map(r => `<tr style="border-top:1px solid var(--border-light)"><td style="padding:5px 6px;font-size:11px">${cstE(r.name)}</td>${months.map(m => `<td style="padding:2px;${m >= r.from && m <= r.to ? `background:${r.bad ? '#a03a2e' : r.color};` : ''}height:18px"></td>`).join('')}</tr>`).join('')}</table></div>
    <div style="font-size:10px;color:var(--text-3);margin-top:6px">金色=课程，蓝色=目标校出愿，绿色=入学，红色=冲突或已过。课程结束日按开课日和课次估算。</div>`;
}

// ══════════ 第 4 步：最终升学计划 ══════════
function cstPlanData() {
  const l = cst.cur, co = cstCoursesObj(l), { lines, total } = cstPriceLines(), en = cstEnroll(l);
  const lang = (st, ex, sc) => st === 'have' ? `${ex || ''} ${sc || ''}`.trim() || '已有成绩' : (st === 'none' ? '未参加' : (st === 'unrecorded' ? '有成绩，待录入' : '待确认'));
  const out = {
    '学生情况': [l.name, l.edu_level, l.edu_years && `教育年限 ${l.edu_years} 年`, l.graduated === true ? '已毕业' : (l.graduated === false ? '未毕业' : ''), l.orig_major && `原专业 ${l.orig_major}`].filter(Boolean).join('，') || '待确认',
    '升学方向': [l.target_level === 'gakubu' ? '学部' : (l.target_level === 'daigakuin' ? '大学院' : ''), l.arts_sci, l.target_major && cstMajorName(l.target_major), l.major_match].filter(Boolean).join(' · ') || '待确认',
    '语言现状': `日语：${lang(l.jp_status, l.jp_exam, l.jp_score)}；英语：${lang(l.en_status, l.en_exam, l.en_score)}`,
    '时间计划': [l.arrive_date && `赴日 ${l.arrive_date}`, en && `目标入学 ${en.y}年${en.m}月`].filter(Boolean).join('，') || '待确认',
    '目标院校': (l.goals || []).map(g => {
      const a = cst.adm.find(x => x.id === g.id), ev = a ? cstEval(a) : null;
      return `${g.kind}：${g.label}（T${cstTier(g.uni)}）${a ? `（出愿 ${a.application_period || '-'}；${CST_ST[ev.st][0]}${ev.notes.length ? '：' + ev.notes.join('；') : ''}）` : ''}`;
    }),
    '课程方案': co.items.map(x => `${x.name}${x.teacher ? '（' + x.teacher + '）' : ''}${x.start ? ' ' + x.start + ' 起' : ''}${x.reason ? '——' + x.reason : ''}`),
    '需补足的差距': cstGaps().map(([k, t]) => `${t}：${cstCoveredGaps(co.items).has(k) ? '已有课程覆盖' : '还没有课程覆盖，需人工安排'}`),
    '费用': lines.map(x => `${x.name}：${cstYen(x.yen)} 日元`).concat(lines.length ? [`合计：${cstYen(total)} 日元`] : []).concat(co.pkgs.map(id => (cst.pkgs || []).find(p => p.id === id)).filter(Boolean).map(p => { const i = cstPkgInfo(p); const f = a => a.map(x => x.item).join('、'); return `${p.name}｜包含：${f(i.have) || '无'}${i.opt.length ? '｜另购：' + f(i.opt) : ''}${i.exc.length ? '｜不包含：' + f(i.exc) : ''}`; })),
  };
  CST_COMMENTS.forEach(([k, t]) => { const v = String((l.comments || {})[k] || '').trim(); if (v) out[t] = v; });
  return out;
}
function cstSavePlan() {
  const l = cst.cur; if (!confirm('把当前内容保存为一个方案版本？之后后台改了课程或价格，这个版本不会跟着变。')) return;
  cstSet('final_plan', { saved_at: new Date().toISOString(), data: cstPlanData() }); cstSet('plan_saved_at', new Date().toISOString());
  cstRender();
}
const CST_COMMENTS = [['lang', '应在什么时间前取得什么语言成绩'], ['material', '应在什么阶段准备哪些材料'], ['skill', '哪些专业知识或能力需要重点加强'], ['self', '学生需要自行投入的学习与准备'], ['fallback', '若未按计划完成，可能需要怎样调整目标']];
function cstComment(k, v) { const l = cst.cur; l.comments = Object.assign({}, l.comments || {}, { [k]: v }); cstSet('comments', l.comments); }
function cstLangText(st, ex, sc) { return st === 'have' ? (`${ex || ''} ${sc || ''}`.trim() || '已有成绩') : (st === 'none' ? '未参加' : (st === 'unrecorded' ? '有成绩，待录入' : '待确认')); }
// 4-1 每个分项上半部分自动列出的学生现状（只读）
function cstAutoLines(key) {
  const l = cst.cur, goals = (l.goals || []).map(g => ({ g, a: cst.adm.find(x => x.id === g.id) })), co = cstCoursesObj(l), en = cstEnroll(l), out = [];
  const kind = g => g.kind || '';
  if (key === 'lang') {
    out.push(`日语：${cstLangText(l.jp_status, l.jp_exam, l.jp_score)}；英语：${cstLangText(l.en_status, l.en_exam, l.en_score)}`);
    goals.forEach(({ g, a }) => { if (a) out.push(`${kind(g)}｜${g.label}：日语 ${a.japanese_required || '未录入'}${a.japanese_detail ? '（' + a.japanese_detail + '）' : ''}；英语 ${a.english_required || '未录入'}${a.english_detail ? '（' + a.english_detail + '）' : ''}`); });
    const dl = goals.filter(x => x.a).map(x => ({ x, d: cstDeadline(x.a, l) })).filter(y => y.d).sort((p, q) => p.d - q.d)[0];
    if (dl) out.push(`最早的出愿时间：${dl.x.a.university} ${dl.x.a.application_period}`);
    else if (goals.some(x => x.a && x.a.application_period)) out.push('出愿时间：' + goals.filter(x => x.a && x.a.application_period).map(x => `${x.a.university} ${x.a.application_period}`).join('；'));
  } else if (key === 'material') {
    goals.forEach(({ g, a }) => { if (a) out.push(`${kind(g)}｜${g.label}：出愿 ${a.application_period || '-'}；推薦状 ${a.recommendation || '-'}；卒業論文 ${a.thesis || '-'}；考试方式 ${a.exam_style || '-'}`); });
    out.push(l.target_level === 'gakubu' ? '学部：一般不需要研究计划书' : (goals.length ? '大学院：需要研究计划书 / 志望理由书' : '研究计划书 / 志望理由书：选好目标校后确认'));
  } else if (key === 'skill') {
    out.push([l.major_match || '本专业 / 跨专业待确认', l.orig_major && `原专业 ${l.orig_major}`].filter(Boolean).join('；'));
    const cov = cstCoveredGaps(co.items); cstGaps().forEach(([k, t]) => out.push(`${t}：${cov.has(k) ? '已有课程覆盖' : '还没选课程'}`));
  } else if (key === 'self') {
    co.items.forEach(x => { const c = (cst.courses || []).find(y => y.id === x.id); out.push(`${x.name}${c ? '｜' + effectivePeriod(c) + (c.weekdays || c.time_range ? '｜' + [c.weekdays, c.time_range].filter(Boolean).join(' ') : '') : ''}${x.start ? '｜' + x.start + ' ～ ' + (x.end || '') : ''}`); });
    if (!co.items.length) out.push('还没有选课程');
    out.push([l.arrive_date && `赴日 ${l.arrive_date}`, en && `目标入学 ${en.y}年${en.m}月`].filter(Boolean).join('；') || '赴日 / 入学时间待确认');
  } else if (key === 'fallback') {
    CST_KINDS.forEach(k => goals.filter(x => x.g.kind === k).forEach(({ g, a }) => out.push(`${k}｜${g.label}：${a ? CST_ST[cstEval(a).st][0] : '待确认'}`)));
    if (!goals.length) out.push('还没有确定目标校');
  }
  return out.filter(Boolean);
}
function cstP41() {
  const l = cst.cur; cstLoadAdm(); cstLoadCourses();
  const old = l.teacher_comment ? `<div style="margin-bottom:14px;padding:8px 12px;background:#f3efe9;border-radius:6px;font-size:12px;color:var(--text-3);line-height:1.8;white-space:pre-wrap"><div style="font-size:10px;margin-bottom:2px">之前的评语（只读，不会自动拆进下面的分项）</div>${cstE(l.teacher_comment)}</div>` : '';
  return old + CST_COMMENTS.map(([k, t], i) => `<div style="margin-bottom:18px"><div style="font-size:13px;font-weight:600;margin-bottom:6px">${i + 1}. ${t}</div>
    <div style="background:#f7f1e8;border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:12px;line-height:1.9;color:var(--text-2)">${cstAutoLines(k).map(x => `<div>· ${cstE(x)}</div>`).join('')}</div>
    <textarea oninput="cstComment('${k}',this.value)" rows="${cst.show ? 3 : 4}" placeholder="老师填写" style="width:100%;font-size:12px;line-height:1.8;padding:8px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box;font-family:inherit">${cstE((l.comments || {})[k])}</textarea></div>`).join('');
}
function cstP42() {
  const l = cst.cur; cstLoadAdm(); cstLoadCourses();
  const data = l.final_plan && l.final_plan.data ? l.final_plan.data : cstPlanData(), saved = !!(l.final_plan && l.final_plan.data);
  const secs = Object.entries(data).filter(([k]) => k !== '规划老师评语').map(([k, v]) => `<div style="margin-bottom:12px"><div style="font-size:11px;color:var(--text-3);margin-bottom:3px">${k}</div>${Array.isArray(v) ? (v.length ? v.map(x => `<div style="font-size:12px;line-height:1.9">· ${cstE(x)}</div>`).join('') : '<div style="font-size:12px;color:var(--text-3)">待确认</div>') : `<div style="font-size:12px;line-height:1.9">${cstE(v)}</div>`}</div>`).join('');
  const cm = data['规划老师评语'] ? `<div style="margin-bottom:12px"><div style="font-size:11px;color:var(--text-3);margin-bottom:3px">规划老师评语</div><div style="font-size:12px;line-height:1.9;white-space:pre-wrap">${cstE(data['规划老师评语'])}</div></div>` : '';
  return `<div style="font-size:10px;color:${saved ? '#1a5a3a' : 'var(--text-3)'};margin-bottom:10px">${saved ? '已保存的方案版本（' + cstE(String(l.final_plan.saved_at).slice(0, 16).replace('T', ' ')) + '），后台改动不会影响它' : '实时内容，还没保存成版本'}</div>${secs}${cm}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick="cstSavePlan()">${saved ? '重新保存为新版本' : '保存方案版本'}</button><button class="btn btn-sm" onclick="cstExportPdf()">导出 PDF</button></div>
      <div style="font-size:10px;color:var(--text-3);margin-top:10px">具备报考资格，就已经迈出了第一步。接下来认真准备、一起加油！</div>`;
}
async function cstOpenMedia() {
  cst.overlay = 'media'; cstRender();
  if (!cst.media) { cst.media = []; try { cst.media = await sbAll('/rest/v1/consult_media?published=is.true&select=*&order=sort.asc,created_at.asc'); } catch (e) { cst.media = []; } if (cst.overlay === 'media') cstRender(); }
}
function cstMediaHtml() {
  if (!cst.media) return '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  const q = cst.mediaQ.trim().toLowerCase(), rows = cst.media.filter(m => m.kind === cst.mediaTab && (!q || [m.title, m.caption, m.course_key].join(' ').toLowerCase().includes(q)));
  const one = m => {
    const u = cstE(m.url);
    const body = m.media_type === 'image' ? `<a href="${u}" target="_blank"><img src="${u}" loading="lazy" style="width:100%;border-radius:3px;display:block"></a>`
      : (m.media_type === 'video' && /\.(mp4|webm|mov)(\?|$)/i.test(m.url)) ? `<video src="${u}" controls preload="none" style="width:100%;border-radius:3px"></video>`
      : `<a href="${u}" target="_blank" class="filter-chip" style="text-decoration:none">${m.media_type === 'pdf' ? '打开 PDF' : (m.media_type === 'video' ? '播放视频' : '打开链接')}</a>`;
    return `<div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;background:var(--surface)">${body}<div style="font-size:12px;font-weight:600;margin-top:6px">${cstE(m.title)}</div>${m.caption ? `<div style="font-size:11px;color:var(--text-2);line-height:1.7;margin-top:2px">${cstE(m.caption)}</div>` : ''}</div>`;
  };
  return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px">${[['textbook', '教材'], ['campus', '校区']].map(([k, t]) => cstChip(cst.mediaTab === k, t, `cst.mediaTab='${k}';cstRender()`)).join('')}<input placeholder="搜索" value="${cstE(cst.mediaQ)}" onchange="cst.mediaQ=this.value;cstRender()" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;margin-left:auto;width:140px"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">${rows.map(one).join('') || '<div style="font-size:11px;color:var(--text-3)">还没有内容（管理员在「管控台 → 咨询台 → 教材・校区」里添加）</div>'}</div>`;
}
function cstOpenAbout() { cst.overlay = 'about'; cstRender(); cstLoadCommon(); }
function cstAboutHtml() {
  const l = cst.cur;
  if (!l || !l.target_major) return '<div style="font-size:11px;color:var(--text-3)">先选一位咨询者，并在「基本情况」里选好目标专业，这里会显示对应领域的通用宣传内容。</div>';
  return `<div style="font-size:10px;color:var(--text-3);margin-bottom:8px">${cstE(admissionMajorDomain(l.target_major) || '')} 通用宣传</div>` + cstCommonHtml();
}
function cstOpenFaq() { cst.overlay = 'faq'; cst.faqQ = ''; cstRender(); if (!cst.faqs) cstLoadFaq(); }
function cstCloseOverlay() { cst.overlay = ''; cstRender(); }
async function cstLoadFaq() {
  try { cst.faqs = await sbAll('/rest/v1/faq?select=*&order=sort.asc,created_at.asc'); } catch (e) { cst.faqs = []; cst.faqErr = e.message; }
  if (cst.overlay === 'faq') cstRender();
}
function cstOverlayHtml() {
  const l = cst.cur, wrap = (title, inner, w) => `<div onclick="if(event.target===this)cstCloseOverlay()" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px"><div style="background:var(--bg);border-radius:6px;max-width:${w || 720}px;width:100%;max-height:88vh;overflow:auto;padding:16px 18px"><div style="display:flex;align-items:center;margin-bottom:10px"><b style="font-size:14px;font-family:'Noto Serif SC',serif">${title}</b><button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="cstCloseOverlay()">关闭</button></div>${inner}</div></div>`;
  if (cst.overlay === 'about') return wrap('关于唯新', cstAboutHtml(), 860);
  if (cst.overlay === 'media') return wrap('教材・校区', cstMediaHtml(), 1000);
  const q = cst.faqQ.trim().toLowerCase(), stage = CST_STAGE[cst.step];
  let rows = (cst.faqs || []).filter(f => f.published !== false);
  const fit = f => (!(f.levels || []).length || !l || (f.levels || []).includes(l.target_level)) && (!(f.majors || []).length || !l || (f.majors || []).includes(l.target_major)) && (!(f.stages || []).length || (f.stages || []).includes(stage));
  rows = q ? rows.filter(f => (f.question + ' ' + f.answer).toLowerCase().includes(q)) : rows.filter(fit);
  return wrap('常见问题', `<input placeholder="搜索问题" value="${cstE(cst.faqQ)}" oninput="cst.faqQ=this.value;cstFaqList()" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box;margin-bottom:6px"><div style="font-size:10px;color:var(--text-3);margin-bottom:8px">不搜索时，按这位咨询者的层次、专业和当前步骤（${stage}）自动筛选</div><div id="cst_faq">${cstFaqHtml(rows)}</div>`);
}
function cstFaqHtml(rows) {
  if (!cst.faqs) return '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  if (!rows.length) return `<div style="font-size:11px;color:var(--text-3)">${cst.faqErr ? '读取失败：' + cstE(cst.faqErr) : '没有相关的问题。可以在上面搜索全部问题。'}</div>`;
  return rows.map(f => `<div style="border-bottom:1px solid var(--border-light);padding:8px 2px"><div style="font-size:12px;font-weight:600">${cstE(f.question)}</div><div style="font-size:12px;line-height:1.9;color:var(--text-2);margin-top:3px;white-space:pre-wrap">${cstE(f.answer)}</div></div>`).join('');
}
function cstFaqList() {
  const el = document.getElementById('cst_faq'); if (!el) return;
  const q = cst.faqQ.trim().toLowerCase(), l = cst.cur, stage = CST_STAGE[cst.step];
  let rows = (cst.faqs || []).filter(f => f.published !== false);
  rows = q ? rows.filter(f => (f.question + ' ' + f.answer).toLowerCase().includes(q)) : rows.filter(f => (!(f.levels || []).length || !l || f.levels.includes(l.target_level)) && (!(f.majors || []).length || !l || f.majors.includes(l.target_major)) && (!(f.stages || []).length || f.stages.includes(stage)));
  el.innerHTML = cstFaqHtml(rows);
}
// 导出 PDF：新窗口里排版，加载 Noto 字体后调用浏览器打印（另存为 PDF）
function cstExportPdf() {
  const l = cst.cur, data = l.final_plan && l.final_plan.data ? l.final_plan.data : cstPlanData();
  const sec = ([k, v]) => `<div class="s"><div class="k">${cstE(k)}</div>${Array.isArray(v) ? (v.length ? v.map(x => `<p>· ${cstE(x)}</p>`).join('') : '<p class="mute">待确认</p>') : `<p style="white-space:pre-wrap">${cstE(v) || '<span class="mute">待确认</span>'}</p>`}</div>`;
  const w = window.open('', '_blank'); if (!w) { alert('浏览器拦截了新窗口，请允许弹出窗口后再试'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>升学计划</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&family=Noto+Sans+SC:wght@400;500&display=swap" rel="stylesheet">
<style>body{font-family:'Noto Sans SC',sans-serif;color:#1a1814;background:#f7f5f0;max-width:760px;margin:24px auto;padding:0 20px;font-size:13px;line-height:1.9}h1{font-family:'Noto Serif SC',serif;font-size:22px;margin-top:6px;border-bottom:2px solid #b8953a;padding-bottom:8px}.brand img{height:56px;width:auto;display:block}.s{border-bottom:1px solid #e2ded6;padding:8px 0}.k{font-family:'Noto Serif SC',serif;font-weight:600;color:#b8953a;font-size:13px}p{margin:2px 0}.mute{color:#999}.f{font-size:11px;color:#777;margin-top:18px}@media print{body{background:#fff;margin:0}}</style></head><body>
<div class="brand"><img src="${cstE(new URL(cstLogoSrc(l), location.href).href)}" alt="唯新学院" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span style="display:none;font-family:'Noto Serif SC',serif;font-weight:600">唯新学院</span></div><h1>升学计划${l.name ? ' · ' + cstE(l.name) : ''}</h1>${Object.entries(data).map(sec).join('')}<div class="f">具备报考资格，就已经迈出了第一步。接下来认真准备、一起加油！生成于 ${new Date().toISOString().slice(0, 10)}</div></body></html>`);
  w.document.close();
  const go = () => { try { w.focus(); w.print(); } catch (e) {} };
  const imgs = () => Promise.all([...w.document.images].map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; })));   // logo 加载完再打印
  setTimeout(() => { (w.document.fonts && w.document.fonts.ready ? w.document.fonts.ready : Promise.resolve()).then(imgs).then(go, go); }, 400);
}
