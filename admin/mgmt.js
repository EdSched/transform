// ══════════════════════════════════
// mgmt.js — 管理可视化（第一阶段）
//   admin 全局层：中枢台卡片 → 全屏页 #mgmtOverlay（按领域看 / 按项目看；点了才读数据）
//   负责人层：侧栏「管理可视化」页（curPage==='mgmt'），范围 = 当前视角；管理模式下可切「全部管理范围 / 我名下」
// 指标定义、范围、缓存都在 shared/mgmt-metrics.js；这里只管界面
// 依赖：shared/mgmt-metrics.js、shared/constants.js、admin.js（showHub、openStudentDetail）
// ══════════════════════════════════
const MG_COL = { text: '#3a342e', mute: '#8a7f73', line: '#d9cfc4', line2: '#e8dfd5', blue: '#4f7194', green: '#5b7f55', orange: '#c9831f', red: '#c4646a', bg: '#fcf8f4' };
const mgE = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let mgS = { tab: 'domain', dom: '', grp: '', item: '', data: null, table: null, open: '' };   // 全局层状态
let mgPage = { mine: false, open: '', rows: null, label: '' };                                    // 负责人层状态
let mgCtx = [];                                                                                     // 详情上下文（点击时按序号取）
let mgSeq = 0, mgSeqP = 0;
const mgStC = s => s === 'done' ? MG_COL.green : s === 'todo' ? MG_COL.orange : s === 'err' ? MG_COL.red : MG_COL.mute;

// ── 详情面板 ──
function mgCtxAdd(title, r) { mgCtx.push({ title, r }); return mgCtx.length - 1; }
function mgDetail(i, oi, host) {
  const el = document.getElementById(host), c = mgCtx[i]; if (!el || !c) return;
  const r = c.r, st = mgmState(r);
  const line = (k, v) => v ? `<div style="font-size:11px;margin:3px 0"><span style="color:${MG_COL.mute};display:inline-block;min-width:56px">${k}</span>${mgE(v)}</div>` : '';
  let h = `<div style="border:1px solid ${MG_COL.line};border-radius:4px;background:#fff;padding:12px 14px;margin-top:12px">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div style="font-weight:600;font-size:13px">${mgE(c.title)}</div>
    <button class="btn btn-outline btn-sm" onclick="document.getElementById('${host}').innerHTML=''">关闭</button></div>`;
  if (st === 'err') h += `<div style="color:${MG_COL.red};font-size:12px;margin-top:6px">读取失败：${mgE(r && r.err)}</div>`;
  else if (st === 'na') h += `<div style="color:${MG_COL.mute};font-size:12px;margin-top:6px">未接入${r.note ? '：' + mgE(r.note) : ''}</div>`;
  else {
    const pct = r.kind === 'list' ? '' : `（${r.total ? Math.round(r.done / r.total * 100) : 100}%）`;
    h += `<div style="margin-top:6px"><span style="font-size:18px;font-weight:700;color:${mgStC(st)}">${mgE(mgmText(r))}</span><span style="font-size:11px;color:${MG_COL.mute}"> ${pct}</span></div>`
      + line('分母', r.denom) + line('统计周期', r.period) + line('说明', r.desc);
    const owners = [...new Set(r.items.flatMap(x => x.owners || []))].sort();
    let items = r.items;
    if (owners.length >= 2) {
      h += `<div style="display:flex;gap:5px;flex-wrap:wrap;margin:8px 0 2px">` + [['全部', -1]].concat(owners.map((o, k) => [o, k])).map(([t, k]) =>
        `<span onclick="mgDetail(${i},${k},'${host}')" style="cursor:pointer;font-size:10px;padding:2px 9px;border-radius:10px;border:1px solid ${k === (oi == null ? -1 : oi) ? MG_COL.blue : MG_COL.line};${k === (oi == null ? -1 : oi) ? `background:${MG_COL.blue};color:#fff` : `background:#fff;color:${MG_COL.text}`}">${mgE(t)}</span>`).join('') + `</div>`;
      if (oi != null && oi >= 0) items = items.filter(x => (x.owners || []).includes(owners[oi]));
    }
    h += `<div style="margin-top:8px;border-top:1px solid ${MG_COL.line2}">`;
    if (!items.length) h += `<div style="font-size:11px;color:${MG_COL.mute};padding:6px 0">没有需要处理的</div>`;
    items.slice(0, 150).forEach(x => {
      h += `<div style="display:flex;gap:8px;padding:4px 2px;border-bottom:1px solid ${MG_COL.line2};font-size:11px;align-items:baseline">
        <span ${x.sid ? `onclick="mgOpenStu('${mgE(x.sid)}')"` : ''} style="font-weight:600;${x.sid ? `cursor:pointer;color:${MG_COL.blue}` : ''}">${mgE(x.name)}</span>
        <span style="color:${MG_COL.mute};flex:1">${mgE(x.note)}</span>
        <span style="color:${MG_COL.mute};font-size:10px">${mgE((x.owners || []).join('、'))}</span></div>`;
    });
    if (items.length > 150) h += `<div style="font-size:10px;color:${MG_COL.mute};padding:6px 0">只显示前 150 条，共 ${items.length} 条</div>`;
    h += `</div>`;
  }
  el.innerHTML = h + `</div>`;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// 学生详情的弹窗层级比全屏页低，从全屏页打开时要抬高
function mgOpenStu(sid) {
  const ov = document.getElementById('mgmtOverlay'), m = document.getElementById('studentDetailModal');
  if (m) m.style.zIndex = (ov && ov.style.display !== 'none') ? '1000' : '';
  openStudentDetail(sid);
}

// ── 卡片 ──
function mgMetricRow(title, m, r, host) {
  const st = mgmState(r), i = mgCtxAdd(`${title} · ${m.label}`, r);
  const sub = st === 'err' ? (r && r.err) : st === 'na' ? r.note : [r.denom && '分母：' + r.denom, r.period && '周期：' + r.period].filter(Boolean).join(' · ');
  return `<div onclick="mgDetail(${i},-1,'${host}')" style="cursor:pointer;padding:6px 4px;border-top:1px solid ${MG_COL.line2}">
    <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px"><span>${mgE(m.label)}</span><span style="font-weight:700;color:${mgStC(st)};white-space:nowrap">${mgE(mgmText(r))}</span></div>
    <div style="font-size:10px;color:${MG_COL.mute};margin-top:1px">${mgE(sub)}</div></div>`;
}
function mgGroupCard(g, rows, open, toggleJs, title, host) {
  const sum = mgmGroupSum(g, rows || []);
  const color = sum.state === 'done' ? MG_COL.green : sum.state === 'gray' ? MG_COL.mute : MG_COL.orange;
  const txt = sum.state === 'gray' ? (g.na ? '暂未接入' : '暂无可统计项') : `${sum.done}/${sum.total} 项完成`;
  const bg = sum.state === 'done' ? '#eef3ec' : sum.state === 'gray' ? '#f3efea' : '#fff';
  let h = `<div style="border:1px solid ${sum.state === 'done' ? MG_COL.green : MG_COL.line};border-radius:4px;background:${bg};padding:10px 12px;${open ? 'grid-column:1/-1' : ''}">
    <div onclick="${toggleJs}" style="cursor:pointer;display:flex;justify-content:space-between;align-items:baseline;gap:8px">
      <span style="font-family:'Noto Serif SC',serif;font-weight:600;font-size:13px">${mgE(g.label)}</span><span style="font-size:11px;font-weight:600;color:${color}">${txt}</span></div>`;
  if (open) {
    if (g.na || !g.metrics.length) h += `<div style="font-size:11px;color:${MG_COL.mute};padding:8px 0 2px">未接入：这一项还没有可检测的数据，不算完成也不算未完成</div>`;
    else h += (rows || []).map(x => mgMetricRow(title, x.m, x.r, host)).join('');
  }
  return h + `</div>`;
}
const mgGrid = inner => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;align-items:start">${inner}</div>`;
const mgBtn = (on, label, js) => `<span onclick="${js}" style="cursor:pointer;font-size:12px;padding:5px 14px;border-radius:14px;border:1px solid ${on ? MG_COL.blue : MG_COL.line};background:${on ? MG_COL.blue : '#fff'};color:${on ? '#fff' : MG_COL.text}">${label}</span>`;

// ══════════ 全局层（admin 中枢台）══════════
function mgEnsureOverlay() {
  let el = document.getElementById('mgmtOverlay');
  if (!el) {
    el = document.createElement('div'); el.id = 'mgmtOverlay';
    el.style.cssText = `display:none;position:fixed;inset:0;z-index:940;background:${MG_COL.bg};overflow:auto;color:${MG_COL.text}`;
    document.body.appendChild(el);
  }
  return el;
}
function mgOpen() {
  const el = mgEnsureOverlay(), hub = document.getElementById('hubOverlay'); if (hub) hub.style.display = 'none';
  el.style.display = 'block'; mgS = { tab: 'domain', dom: '', grp: '', item: '', data: null, table: null, open: '' }; mgRender();
}
function mgClose() {
  const el = document.getElementById('mgmtOverlay'); if (el) el.style.display = 'none';
  const m = document.getElementById('studentDetailModal'); if (m) m.style.zIndex = '';
  showHub();
}
function mgTab(t) { if (mgS.tab === t) return; mgSeq++; mgS = { tab: t, dom: '', grp: '', item: '', data: null, table: null, open: '' }; mgRender(); }
function mgRefresh() {
  mgmClearCache(); const dom = mgS.dom, item = mgS.item; mgSeq++; mgS.data = null; mgS.table = null;
  mgRender(); if (mgS.tab === 'domain' && dom) mgLoadDom(dom); else if (mgS.tab === 'item' && item) mgLoadItem(item);
}
async function mgPickDom(dom) {
  mgSeq++;
  if (mgS.dom === dom) { mgS.dom = ''; mgS.data = null; mgS.open = ''; mgRender(); return; }
  mgS.dom = dom; mgS.data = null; mgS.open = ''; mgRender(); mgLoadDom(dom);
}
async function mgLoadDom(dom) {
  const seq = ++mgSeq, sc = mgmScope({ kind: 'domain', domain: dom });
  const rows = await Promise.all(MGM_GROUPS.map(g => mgmRunGroup(sc, g)));
  if (seq !== mgSeq) return; mgS.data = rows; mgRender();
}
async function mgPickItem(key) {
  mgSeq++;
  if (mgS.item === key) { mgS.item = ''; mgS.table = null; mgRender(); return; }
  mgS.item = key; mgS.table = null; mgRender(); mgLoadItem(key);
}
async function mgLoadItem(key) {
  const seq = ++mgSeq, g = MGM_GROUPS.find(x => x.key === key); if (!g) return;
  const doms = DOMAINS.map(d => d.label);
  const table = await Promise.all(doms.map(d => mgmRunGroup(mgmScope({ kind: 'domain', domain: d }), g)));
  if (seq !== mgSeq) return; mgS.table = table; mgRender();
}
function mgRender() {
  const el = mgEnsureOverlay(); mgCtx = [];
  let h = `<div style="max-width:1100px;margin:0 auto;padding:20px 20px 60px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
      <div style="font-family:'Noto Serif SC',serif;font-size:1.2rem;font-weight:600;flex:1;min-width:160px">管理可视化</div>
      ${mgBtn(mgS.tab === 'domain', '按领域看', "mgTab('domain')")}${mgBtn(mgS.tab === 'item', '按项目看', "mgTab('item')")}
      <button class="btn btn-outline btn-sm" onclick="mgRefresh()">刷新</button>
      <button class="btn btn-outline btn-sm" onclick="mgClose()">返回中枢台</button></div>
    <div style="font-size:10px;color:${MG_COL.mute};margin-bottom:14px">每个数字都写明分母和统计周期；只检测业务上真的做了没有。点开才读取数据，60 秒内不重复计算。</div>`;
  if (mgS.tab === 'domain') {
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:14px">` + DOMAINS.map(d => {
      const on = mgS.dom === d.label;
      return `<div onclick="mgPickDom('${d.label}')" style="cursor:pointer;text-align:center;padding:12px 8px;border-radius:4px;font-size:13px;border:1px solid ${on ? MG_COL.blue : MG_COL.line};background:${on ? MG_COL.blue : '#fff'};color:${on ? '#fff' : MG_COL.text}">${d.label}</div>`;
    }).join('') + `</div>`;
    if (mgS.dom) {
      if (!mgS.data) h += `<div style="font-size:12px;color:${MG_COL.mute}">读取 ${mgE(mgS.dom)} 的数据中…</div>`;
      else h += mgGrid(MGM_GROUPS.map((g, i) => mgGroupCard(g, mgS.data[i], mgS.open === g.key, `mgOpenGrp('${g.key}')`, mgS.dom, 'mgDetailO')).join(''));
    } else h += `<div style="font-size:12px;color:${MG_COL.mute}">请先选择一个领域</div>`;
  } else {
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:14px">` + MGM_GROUPS.map(g => {
      const on = mgS.item === g.key;
      return `<div onclick="mgPickItem('${g.key}')" style="cursor:pointer;text-align:center;padding:12px 8px;border-radius:4px;font-size:13px;border:1px solid ${on ? MG_COL.blue : MG_COL.line};background:${on ? MG_COL.blue : g.na ? '#f3efea' : '#fff'};color:${on ? '#fff' : g.na ? MG_COL.mute : MG_COL.text}">${g.label}${g.na ? '<div style="font-size:9px">未接入</div>' : ''}</div>`;
    }).join('') + `</div>`;
    const g = MGM_GROUPS.find(x => x.key === mgS.item);
    if (!g) h += `<div style="font-size:12px;color:${MG_COL.mute}">请先选择一个大项</div>`;
    else if (g.na || !g.metrics.length) h += `<div style="font-size:12px;color:${MG_COL.mute}">${g.label}：未接入，不算完成也不算未完成</div>`;
    else if (!mgS.table) h += `<div style="font-size:12px;color:${MG_COL.mute}">读取${g.label}的数据中…</div>`;
    else {
      h += `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:12px;background:#fff"><tr><th style="text-align:left;padding:6px 8px;border:1px solid ${MG_COL.line2};background:#f3efea">领域</th>`
        + g.metrics.map(m => `<th style="text-align:left;padding:6px 8px;border:1px solid ${MG_COL.line2};background:#f3efea">${mgE(m.label)}</th>`).join('') + `</tr>`;
      DOMAINS.forEach((d, di) => {
        h += `<tr><td style="padding:6px 8px;border:1px solid ${MG_COL.line2};font-weight:600;white-space:nowrap">${d.label}</td>`;
        g.metrics.forEach((m, mi) => {
          const r = mgS.table[di][mi].r, st = mgmState(r), i = mgCtxAdd(`${d.label} · ${g.label} · ${m.label}`, r);
          h += `<td onclick="mgDetail(${i},-1,'mgDetailO')" style="cursor:pointer;padding:6px 8px;border:1px solid ${MG_COL.line2};font-weight:700;color:${mgStC(st)};background:${st === 'done' ? '#eef3ec' : '#fff'}">${mgE(mgmText(r))}</td>`;
        });
        h += `</tr>`;
      });
      h += `</table></div><div style="font-size:10px;color:${MG_COL.mute};margin-top:6px">格子 = 已完成/应完成（或待处理人数）；点格子看分母、统计周期和名单。` + (g.metrics.some(m => m.key === 'room') ? '「排教室」不分领域，各领域显示的是同一个全局数字。' : '') + `</div>`;
    }
  }
  el.innerHTML = h + `<div id="mgDetailO"></div></div>`;
}
function mgOpenGrp(key) { mgS.open = mgS.open === key ? '' : key; mgRender(); }

// ══════════ 负责人层（侧栏页）══════════
async function renderMgmtPage(mc) {
  const seq = ++mgSeqP, asT = typeof ACCESS_KEY !== 'undefined' && ACCESS_KEY && ACCESS_KEY._asTeacher;
  if (!asT) mgPage.mine = false;
  const mine = asT && mgPage.mine ? asT.name : '';
  mgPage.rows = null; mgPage.label = '';
  mgPageHtml(mc, asT);
  const sc = mgmScope({ kind: 'view', mine });
  const rows = await Promise.all(MGM_GROUPS.map(g => mgmRunGroup(sc, g)));
  if (seq !== mgSeqP || curPage !== 'mgmt') return;
  mgPage.rows = rows; mgPage.label = sc.label; mgPageHtml(mc, asT);
}
function mgPageHtml(mc, asT) {
  mgCtx = [];
  let h = `<div style="max-width:1000px;color:${MG_COL.text}">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
      <div style="font-family:'Noto Serif SC',serif;font-size:1.15rem;font-weight:600;flex:1;min-width:140px">管理可视化</div>
      ${asT ? mgBtn(!mgPage.mine, '全部管理范围', 'mgPageMine(false)') + mgBtn(mgPage.mine, '我名下（任课·班主任·专业负责）', 'mgPageMine(true)') : ''}
      <button class="btn btn-outline btn-sm" onclick="mgPageRefresh()">刷新</button></div>
    <div style="font-size:11px;color:${MG_COL.mute};margin-bottom:12px">范围：${mgE(mgPage.label || (typeof scopeSummary === 'function' ? scopeSummary() : ''))}。每个数字都写明分母和统计周期；点大项展开，点指标看名单。</div>`;
  if (!mgPage.rows) h += `<div style="font-size:12px;color:${MG_COL.mute}">读取中…</div>`;
  else h += mgGrid(MGM_GROUPS.map((g, i) => mgGroupCard(g, mgPage.rows[i], mgPage.open === g.key, `mgPageOpen('${g.key}')`, mgPage.label, 'mgDetailP')).join(''));
  mc.innerHTML = h + `<div id="mgDetailP"></div></div>`;
}
function mgPageMine(on) { mgPage.mine = !!on; mgPage.open = ''; renderMgmtPage(document.getElementById('mainContent')); }
function mgPageOpen(key) {
  mgPage.open = mgPage.open === key ? '' : key;
  mgPageHtml(document.getElementById('mainContent'), typeof ACCESS_KEY !== 'undefined' && ACCESS_KEY && ACCESS_KEY._asTeacher);
}
function mgPageRefresh() { mgmClearCache(); renderMgmtPage(document.getElementById('mainContent')); }
