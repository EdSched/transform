// ══════════════════════════════════
// mgmt.js — 管理可视化（第一阶段）
//   admin 全局层：中枢台卡片 → 全屏页 #mgmtOverlay（按领域看 / 按项目看）
//   负责人层：侧栏「管理可视化」页（curPage==='mgmt'），范围 = 当前视角；管理模式下可切「全部管理范围 / 我名下」
// 界面原则：一屏只做一件事，逐级进入（方块 → 方块 → 列表 → 详情），顶部面包屑可回到任意上一级；不默认展开任何东西
// 指标定义、范围、缓存在 shared/mgmt-metrics.js；这里只管界面
// 依赖：shared/mgmt-metrics.js、shared/constants.js、admin.js（showHub、openStudentDetail）
// ══════════════════════════════════
const MG_COL = { bg: '#fcf8f4', card: '#ffffff', text: '#3a342e', mute: '#8a8076', line: '#e8dfd5', border: '#d9cfc4', hover: '#b9ab9b', blue: '#4f7194', green: '#5b7f55', sand: '#c9a37a', track: '#ece4d9', red: '#c4646a' };
const MG_PAGE = 20;                                                                                  // 名单每页条数
const mgE = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let mgS = { tab: 'domain', dom: '', grp: '', met: '', data: {}, tbl: {}, busy: {} };               // 全局层状态：data[领域]=各大项结果；tbl[大项|指标]=各领域结果
let mgPage = { mine: false, grp: '', met: '', rows: null, label: '' };                              // 负责人层状态
let mgDet = { open: '', page: 0 };                                                                   // 详情页：展开的老师分组、当前页
let mgMode = 'o';                                                                                    // 最近一次渲染的是哪一层：'o' 全局层 / 'p' 负责人层
let mgSeqP = 0;

function mgEnsureStyle() {
  if (document.getElementById('mgStyle')) return;
  const st = document.createElement('style'); st.id = 'mgStyle';
  st.textContent = `
  .mg-wrap{color:${MG_COL.text};font-size:13px}
  .mg-num{font-variant-numeric:tabular-nums}
  .mg-btn{background:#fff;border:1px solid ${MG_COL.border};color:${MG_COL.text};padding:5px 14px;font-size:12px;border-radius:3px;cursor:pointer;font-family:inherit}
  .mg-btn:hover{border-color:${MG_COL.hover}}
  .mg-seg{display:flex;border-bottom:1px solid ${MG_COL.line};margin:10px 0 8px}
  .mg-seg span{width:130px;text-align:center;padding:7px 0;font-size:13px;cursor:pointer;color:${MG_COL.mute};border-bottom:2px solid transparent;margin-bottom:-1px}
  .mg-seg span.on{color:${MG_COL.text};font-weight:700;border-bottom-color:${MG_COL.blue}}
  .mg-seg.sm{border:0;margin:0}.mg-seg.sm span{width:auto;padding:4px 12px;font-size:12px}
  .mg-crumb{font-size:12px;color:${MG_COL.mute};margin:4px 0 14px}
  .mg-crumb a{color:${MG_COL.blue};cursor:pointer}.mg-crumb a:hover{text-decoration:underline}
  .mg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
  .mg-tile{min-height:96px;box-sizing:border-box;padding:18px;border-radius:6px;background:${MG_COL.card};border:1px solid ${MG_COL.border};cursor:pointer;display:flex;flex-direction:column;justify-content:center;gap:6px}
  .mg-tile:hover{border-color:${MG_COL.hover}}
  .mg-tile b{font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600}
  .mg-tile small{font-size:12px;color:${MG_COL.mute}}
  .mg-tile.na{border-style:dashed}.mg-tile.na b,.mg-tile.na small{color:#b3aa9f}
  .mg-tile.done{border-left:3px solid ${MG_COL.green}}.mg-tile.done small{color:${MG_COL.green}}
  .mg-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 14px;background:${MG_COL.card};border:1px solid ${MG_COL.line};border-top:0;cursor:pointer}
  .mg-row:first-child{border-top:1px solid ${MG_COL.line}}.mg-row:hover{background:#fdfbf8}
  .mg-row .l{flex:1;min-width:0}.mg-row .l small{display:block;font-size:11px;color:${MG_COL.mute};margin-top:2px}
  .mg-row .r{width:150px;text-align:right;flex-shrink:0}
  .mg-bar{height:4px;background:${MG_COL.track};border-radius:2px;margin-top:5px;overflow:hidden}.mg-bar i{display:block;height:100%}
  .mg-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:${MG_COL.red};margin-right:6px;vertical-align:middle}
  .mg-sum{display:grid;grid-template-columns:1fr 1fr;gap:12px 28px;background:${MG_COL.card};border:1px solid ${MG_COL.line};border-radius:6px;padding:16px 18px;margin-bottom:14px}
  .mg-sum label{display:block;font-size:11px;color:${MG_COL.mute};margin-bottom:2px}
  .mg-sum .big{font-size:20px;font-weight:600}
  .mg-grp{display:flex;justify-content:space-between;padding:10px 14px;background:${MG_COL.card};border:1px solid ${MG_COL.line};border-top:0;cursor:pointer}
  .mg-sum + .mg-grp{border-top:1px solid ${MG_COL.line}}.mg-grp:hover{background:#fdfbf8}
  .mg-li{display:flex;gap:8px;align-items:baseline;padding:6px 14px;border-bottom:1px solid ${MG_COL.line};font-size:12px;background:#fff}
  .mg-li .nm{font-weight:600}.mg-li a{color:${MG_COL.blue};text-decoration:underline;cursor:pointer}
  .mg-li .nt{flex:1;color:${MG_COL.mute}}
  .mg-pg{display:flex;gap:10px;align-items:center;justify-content:flex-end;padding:8px 14px;font-size:11px;color:${MG_COL.mute};background:#fff;border-bottom:1px solid ${MG_COL.line}}
  .mg-say{font-size:12px;color:${MG_COL.mute};padding:6px 0}`;
  document.head.appendChild(st);
}

// ── 通用小部件 ──
const mgTile = (name, sub, js, cls) => `<div class="mg-tile ${cls || ''}" onclick="${js}"><b>${mgE(name)}</b><small>${mgE(sub)}</small></div>`;
const mgCrumb = parts => parts.length ? `<div class="mg-crumb">` + parts.map(p => p.js ? `<a onclick="${p.js}">${mgE(p.t)}</a>` : `<span style="color:${MG_COL.text}">${mgE(p.t)}</span>`).join(' / ') + `</div>` : '';
const mgBar = (d, t) => `<div class="mg-bar"><i style="width:${t ? Math.min(100, Math.round(d / t * 100)) : 100}%;background:${d >= t ? MG_COL.green : MG_COL.sand}"></i></div>`;
// 一个结果的「右侧读数」：18/25 + 细进度条 / 待处理 N 人 / 未接入 / 读取失败
function mgReading(r) {
  const st = mgmState(r);
  if (st === 'err') return `<span class="mg-dot"></span>读取失败`;
  if (st === 'na') return `<span style="color:${MG_COL.mute}">未接入</span>`;
  if (r.kind === 'list') return r.count ? `<span class="mg-dot"></span>待处理 ${r.count} 人` : `待处理 0 人`;
  return `<b class="mg-num" style="font-weight:600">${r.done}/${r.total}</b>${mgBar(r.done, r.total)}`;
}
// 大项方块（sum 为空 = 还没读取）
function mgGroupTile(g, rows, js) {
  if (g.na) return mgTile(g.label, '暂未接入', js, 'na');
  if (!rows) return mgTile(g.label, '点击查看', js);
  const s = mgmGroupSum(g, rows);
  if (s.state === 'gray') return mgTile(g.label, '暂无可统计项', js, 'na');
  return mgTile(g.label, s.state === 'done' ? '已完成' : `${s.done}/${s.total} 项完成`, js, s.state === 'done' ? 'done' : '');
}
// 指标列表（一行一个指标）
function mgMetricList(rows, js) {
  return `<div>` + rows.map(x => {
    const r = x.r, st = mgmState(r), sub = st === 'err' ? r.err : st === 'na' ? r.note : [r.denom && '分母：' + r.denom, r.period && '周期：' + r.period].filter(Boolean).join(' · ');
    return `<div class="mg-row" onclick="${js(x.m.key)}"><div class="l">${mgE(x.m.label)}<small>${mgE(sub)}</small></div><div class="r">${mgReading(r)}</div></div>`;
  }).join('') + `</div>`;
}

// ── 详情页 ──
// 名单按负责老师分组；没有负责老师的归「未指定」
function mgGroups(items) {
  const m = new Map();
  items.forEach(x => { [...new Set((x.owners && x.owners.length) ? x.owners : ['未指定'])].forEach(o => { if (!m.has(o)) m.set(o, []); m.get(o).push(x); }); });
  return [...m.entries()].sort((a, b) => (a[0] === '未指定') - (b[0] === '未指定') || b[1].length - a[1].length);
}
function mgPaged(items) {
  const pages = Math.max(1, Math.ceil(items.length / MG_PAGE)), pg = Math.min(mgDet.page, pages - 1), from = pg * MG_PAGE;
  let h = items.slice(from, from + MG_PAGE).map(x => `<div class="mg-li"><i class="mg-dot"></i>${x.sid ? `<a class="nm" onclick="mgOpenStu('${mgE(x.sid)}')">${mgE(x.name)}</a>` : `<span class="nm">${mgE(x.name)}</span>`}<span class="nt">${mgE(x.note)}</span></div>`).join('');
  if (pages > 1) h += `<div class="mg-pg"><span>第 ${pg + 1} / ${pages} 页（共 ${items.length} 条）</span>
    <button class="mg-btn" ${pg === 0 ? 'disabled style="opacity:.4;cursor:default"' : ''} onclick="mgDetPage(-1)">上一页</button>
    <button class="mg-btn" ${pg >= pages - 1 ? 'disabled style="opacity:.4;cursor:default"' : ''} onclick="mgDetPage(1)">下一页</button></div>`;
  return h;
}
function mgDetailHtml(r) {
  const st = mgmState(r);
  if (st === 'err') return `<div class="mg-say"><span class="mg-dot"></span>读取失败：${mgE(r && r.err)}</div>`;
  if (st === 'na') return `<div class="mg-say">未接入${r.note ? '：' + mgE(r.note) : ''}</div>`;
  const big = r.kind === 'list' ? `待处理 ${r.count} 人` : `<span class="mg-num">${r.done}/${r.total}</span>`;
  const pct = r.kind === 'list' ? '' : `<div style="font-size:11px;color:${MG_COL.mute}" class="mg-num">${r.total ? Math.round(r.done / r.total * 100) : 100}%</div>`;
  let h = `<div class="mg-sum"><div><label>完成情况</label><div class="big">${big}</div>${pct}</div><div><label>分母</label>${mgE(r.denom)}</div>
    <div><label>统计周期</label>${mgE(r.period)}</div><div><label>说明</label>${mgE(r.desc)}</div></div>`;
  if (!r.items.length) return h + `<div class="mg-say">没有需要处理的</div>`;
  const groups = mgGroups(r.items);
  if (groups.length < 2) return h + mgPaged(r.items);
  groups.forEach(([o, list], i) => {
    const on = mgDet.open === o;
    h += `<div class="mg-grp" onclick="mgDetToggle(${i})"><span>${mgE(o)}</span><span class="mg-num" style="color:${MG_COL.mute}">${list.length} 项　${on ? '▾' : '▸'}</span></div>`;
    if (on) h += mgPaged(list);
  });
  return h;
}
function mgDetToggle(i) {
  const r = mgCurResult(); if (!r || !r.items) return;
  const g = mgGroups(r.items)[i]; if (!g) return;
  mgDet = { open: mgDet.open === g[0] ? '' : g[0], page: 0 };   // 同时只展开一组
  mgRerender();
}
function mgDetPage(d) { mgDet.page = Math.max(0, mgDet.page + d); mgRerender(); }
// 学生详情的弹窗层级比全屏页低，从全屏页打开时要抬高
function mgOpenStu(sid) {
  const ov = document.getElementById('mgmtOverlay'), m = document.getElementById('studentDetailModal');
  if (m) m.style.zIndex = (ov && ov.style.display !== 'none') ? '1000' : '';
  openStudentDetail(sid);
}

// ── 当前正在看的指标结果（给详情页翻页 / 展开用）──
function mgCurResult() {
  if (mgMode === 'p') {
    const gi = MGM_GROUPS.findIndex(g => g.key === mgPage.grp); if (gi < 0 || !mgPage.rows) return null;
    const x = mgPage.rows[gi].find(y => y.m.key === mgPage.met); return x && x.r;
  }
  if (mgS.tab === 'domain') {
    const gi = MGM_GROUPS.findIndex(g => g.key === mgS.grp), rows = mgS.data[mgS.dom]; if (gi < 0 || !rows) return null;
    const x = rows[gi].find(y => y.m.key === mgS.met); return x && x.r;
  }
  const t = mgS.tbl[mgS.grp + '|' + mgS.met], di = DOMAINS.findIndex(d => d.label === mgS.dom); return t && di >= 0 ? t[di] : null;
}
function mgRerender() { if (mgMode === 'p') mgPageRender(); else mgRender(); }

// ══════════ 全局层（admin 中枢台）══════════
function mgEnsureOverlay() {
  mgEnsureStyle();
  let el = document.getElementById('mgmtOverlay');
  if (!el) {
    el = document.createElement('div'); el.id = 'mgmtOverlay';
    el.style.cssText = `display:none;position:fixed;inset:0;z-index:940;background:${MG_COL.bg};overflow:auto`;
    document.body.appendChild(el);
  }
  return el;
}
function mgOpen() {
  const el = mgEnsureOverlay(), hub = document.getElementById('hubOverlay'); if (hub) hub.style.display = 'none';
  el.style.display = 'block'; mgS = { tab: 'domain', dom: '', grp: '', met: '', data: {}, tbl: {}, busy: {} }; mgDet = { open: '', page: 0 }; mgRender();
}
function mgClose() {
  const el = document.getElementById('mgmtOverlay'); if (el) el.style.display = 'none';
  const m = document.getElementById('studentDetailModal'); if (m) m.style.zIndex = '';
  showHub();
}
function mgTab(t) { if (mgS.tab === t) return; mgS = Object.assign(mgS, { tab: t, dom: '', grp: '', met: '' }); mgDet = { open: '', page: 0 }; mgRender(); }
function mgRefresh() { mgmClearCache(); mgS.data = {}; mgS.tbl = {}; mgS.busy = {}; mgRender(); mgEnsure(); }
// 跳到某一级（面包屑和方块都走这里）；字段含义随页签变：按领域看 = 领域→大项→指标；按项目看 = 大项→指标→领域
function mgSet(d, g, m) { mgS.dom = d; mgS.grp = g; mgS.met = m; mgDet = { open: '', page: 0 }; mgRender(); mgEnsure(); }
// 需要数据的层级才读取
function mgEnsure() {
  if (mgS.tab === 'domain') { if (mgS.dom && !mgS.data[mgS.dom] && !mgS.busy['d' + mgS.dom]) mgLoadDom(mgS.dom); }
  else if (mgS.grp && mgS.met && !mgS.tbl[mgS.grp + '|' + mgS.met] && !mgS.busy['i' + mgS.grp + mgS.met]) mgLoadMetric(mgS.grp, mgS.met);
}
async function mgLoadDom(dom) {
  const k = 'd' + dom; mgS.busy[k] = 1;
  const sc = mgmScope({ kind: 'domain', domain: dom });
  const rows = await Promise.all(MGM_GROUPS.map(g => mgmRunGroup(sc, g)));
  delete mgS.busy[k]; mgS.data[dom] = rows; if (mgMode === 'o' && mgS.tab === 'domain' && mgS.dom === dom) mgRender();
}
async function mgLoadMetric(gk, mk) {
  const k = 'i' + gk + mk; mgS.busy[k] = 1;
  const m = MGM_GROUPS.find(g => g.key === gk).metrics.find(x => x.key === mk);
  const rs = await Promise.all(DOMAINS.map(d => mgmRun(mgmScope({ kind: 'domain', domain: d.label }), m)));
  delete mgS.busy[k]; mgS.tbl[gk + '|' + mk] = rs; if (mgMode === 'o' && mgS.tab === 'item' && mgS.grp === gk && mgS.met === mk) mgRender();
}
function mgRender() {
  mgMode = 'o';
  const el = mgEnsureOverlay(), T = mgS.tab, root = { t: '管理可视化', js: "mgSet('','','')" };
  const lab = (arr, key) => (arr.find(x => x.key === key) || { label: key }).label;
  let crumbs = [], body = '';
  if (T === 'domain') {
    const g = MGM_GROUPS.find(x => x.key === mgS.grp), rows = mgS.data[mgS.dom];
    if (!mgS.dom) body = `<div class="mg-grid">` + DOMAINS.map(d => mgTile(d.label, '点击查看', `mgSet('${d.label}','','')`)).join('') + `</div>`;
    else if (!rows) { crumbs = [root, { t: mgS.dom }]; body = `<div class="mg-say">读取 ${mgE(mgS.dom)} 的数据中…</div>`; }
    else if (!g) { crumbs = [root, { t: mgS.dom }]; body = `<div class="mg-grid">` + MGM_GROUPS.map((x, i) => mgGroupTile(x, rows[i], `mgSet('${mgS.dom}','${x.key}','')`)).join('') + `</div>`; }
    else if (!mgS.met) {
      crumbs = [root, { t: mgS.dom, js: `mgSet('${mgS.dom}','','')` }, { t: g.label }];
      body = (g.na || !g.metrics.length) ? `<div class="mg-say">${g.label}：未接入，不算完成也不算未完成</div>` : mgMetricList(rows[MGM_GROUPS.indexOf(g)], k => `mgSet('${mgS.dom}','${g.key}','${k}')`);
    } else {
      const m = g.metrics.find(x => x.key === mgS.met), r = mgCurResult();
      crumbs = [root, { t: mgS.dom, js: `mgSet('${mgS.dom}','','')` }, { t: g.label, js: `mgSet('${mgS.dom}','${g.key}','')` }, { t: m.label }];
      body = mgDetailHtml(r);
    }
  } else {
    const g = MGM_GROUPS.find(x => x.key === mgS.grp), m = g && g.metrics.find(x => x.key === mgS.met);
    if (!g) body = `<div class="mg-grid">` + MGM_GROUPS.map(x => x.na ? mgTile(x.label, '暂未接入', `mgSet('','${x.key}','')`, 'na') : mgTile(x.label, '点击查看', `mgSet('','${x.key}','')`)).join('') + `</div>`;
    else if (!m) {
      crumbs = [root, { t: g.label }];
      body = (g.na || !g.metrics.length) ? `<div class="mg-say">${g.label}：未接入，不算完成也不算未完成</div>` : `<div class="mg-grid">` + g.metrics.map(x => mgTile(x.label, '点击查看', `mgSet('','${g.key}','${x.key}')`)).join('') + `</div>`;
    } else {
      const tbl = mgS.tbl[g.key + '|' + m.key], base = [root, { t: g.label, js: `mgSet('','${g.key}','')` }];
      if (!mgS.dom) {
        crumbs = base.concat([{ t: m.label }]);
        if (!tbl) body = `<div class="mg-say">读取「${mgE(m.label)}」在各领域的情况中…</div>`;
        else {
          body = `<div>` + DOMAINS.map((d, i) => `<div class="mg-row" onclick="mgSet('${d.label}','${g.key}','${m.key}')"><div class="l">${mgE(d.label)}</div><div class="r">${mgReading(tbl[i])}</div></div>`).join('') + `</div>`
            + (m.key === 'room' ? `<div class="mg-say">排教室不分领域，各领域显示的是同一个全局数字。</div>` : '')
            + (m.fn && tbl[0] && tbl[0].denom ? `<div class="mg-say">分母：${mgE(tbl[0].denom)} · 统计周期：${mgE(tbl[0].period)}</div>` : '');
        }
      } else {
        crumbs = base.concat([{ t: m.label, js: `mgSet('','${g.key}','${m.key}')` }, { t: mgS.dom }]);
        body = tbl ? mgDetailHtml(mgCurResult()) : `<div class="mg-say">读取中…</div>`;
      }
    }
  }
  el.innerHTML = `<div class="mg-wrap" style="max-width:1000px;margin:0 auto;padding:22px 20px 60px">
    <div style="display:flex;align-items:center;gap:10px"><div style="font-family:'Noto Serif SC',serif;font-size:1.25rem;font-weight:600;flex:1">管理可视化</div>
      <button class="mg-btn" onclick="mgRefresh()">刷新</button><button class="mg-btn" onclick="mgClose()">返回中枢台</button></div>
    <div class="mg-seg"><span class="${T === 'domain' ? 'on' : ''}" onclick="mgTab('domain')">按领域看</span><span class="${T === 'item' ? 'on' : ''}" onclick="mgTab('item')">按项目看</span></div>
    <div style="font-size:11px;color:${MG_COL.mute};margin-bottom:6px">每个数字都写明分母和统计周期；只检测业务上真的做了没有。点开才读取数据，60 秒内不重复计算。</div>
    ${mgCrumb(crumbs)}<div style="margin-top:${crumbs.length ? 0 : 14}px">${body}</div></div>`;
}

// ══════════ 负责人层（侧栏页）══════════
async function renderMgmtPage(mc) {
  mgEnsureStyle();
  const seq = ++mgSeqP, asT = typeof ACCESS_KEY !== 'undefined' && ACCESS_KEY && ACCESS_KEY._asTeacher;
  if (!asT) mgPage.mine = false;
  const mine = asT && mgPage.mine ? asT.name : '';
  mgPage.rows = null; mgPage.label = '';
  mgPageRender();
  const sc = mgmScope({ kind: 'view', mine });
  const rows = await Promise.all(MGM_GROUPS.map(g => mgmRunGroup(sc, g)));
  if (seq !== mgSeqP || curPage !== 'mgmt') return;
  mgPage.rows = rows; mgPage.label = sc.label; mgPageRender();
}
function mgPageRender() {
  mgMode = 'p';
  const mc = document.getElementById('mainContent'); if (!mc) return;
  const asT = typeof ACCESS_KEY !== 'undefined' && ACCESS_KEY && ACCESS_KEY._asTeacher, P = mgPage, root = { t: '管理可视化', js: "mgPSet('','')" };
  const g = MGM_GROUPS.find(x => x.key === P.grp);
  let crumbs = [], body = '';
  if (!P.rows) body = `<div class="mg-say">读取中…</div>`;
  else if (!g) body = `<div class="mg-grid">` + MGM_GROUPS.map((x, i) => mgGroupTile(x, P.rows[i], `mgPSet('${x.key}','')`)).join('') + `</div>`;
  else if (!P.met) {
    crumbs = [root, { t: g.label }];
    body = (g.na || !g.metrics.length) ? `<div class="mg-say">${g.label}：未接入，不算完成也不算未完成</div>` : mgMetricList(P.rows[MGM_GROUPS.indexOf(g)], k => `mgPSet('${g.key}','${k}')`);
  } else {
    const m = g.metrics.find(x => x.key === P.met);
    crumbs = [root, { t: g.label, js: `mgPSet('${g.key}','')` }, { t: m.label }];
    body = mgDetailHtml(mgCurResult());
  }
  mc.innerHTML = `<div class="mg-wrap" style="max-width:1000px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div style="font-family:'Noto Serif SC',serif;font-size:1.2rem;font-weight:600;flex:1;min-width:140px">管理可视化</div>
      ${asT ? `<div class="mg-seg sm"><span class="${!P.mine ? 'on' : ''}" onclick="mgPageMine(false)">全部管理范围</span><span class="${P.mine ? 'on' : ''}" onclick="mgPageMine(true)">我名下</span></div>` : ''}
      <button class="mg-btn" onclick="mgPageRefresh()">刷新</button></div>
    <div style="font-size:11px;color:${MG_COL.mute};margin:8px 0 6px">范围：${mgE(P.label || (typeof scopeSummary === 'function' ? scopeSummary() : ''))}${P.mine ? '（任课·班主任·专业负责）' : ''}。每个数字都写明分母和统计周期。</div>
    ${mgCrumb(crumbs)}<div style="margin-top:${crumbs.length ? 0 : 10}px">${body}</div></div>`;
}
function mgPSet(g, m) { mgPage.grp = g; mgPage.met = m; mgDet = { open: '', page: 0 }; mgPageRender(); }
function mgPageMine(on) { mgPage.mine = !!on; mgPage.grp = ''; mgPage.met = ''; mgDet = { open: '', page: 0 }; renderMgmtPage(document.getElementById('mainContent')); }
function mgPageRefresh() { mgmClearCache(); renderMgmtPage(document.getElementById('mainContent')); }
