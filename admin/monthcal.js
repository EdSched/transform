// ══════════════════════════════════
// monthcal.js — 课程安排「🗓 导出月课表」：按月把选中课程的单回排成月历，打印 / 另存为 PDF
// 数据：cachedCourses / cachedSessions（课程安排页已加载，已按领域视角过滤）
// 排版参照「2026年9月课表 · 纯艺设计班」（A4 横向一页，周一开始）；配色照 Sensis 课表封面：暖白底、细浅线、柔和黄表头、衬线标题
// ══════════════════════════════════

// [key, 名称, 文字色, 课程块底色（约 10% 浓度）]
const MCX_COLORS = [
  ['black', '深灰（默认）', '#3a342e', '#f3ece4'],
  ['blue', '雾蓝', '#4f7194', '#e9eef3'],
  ['pink', '豆沙粉', '#b25a74', '#f6e8ec'],
  ['green', '苔绿', '#5b7f55', '#ebf0e8'],
  ['orange', '橘黄', '#c9831f', '#f8eedd'],
  ['purple', '淡紫', '#7a68a3', '#eeebf4'],
];
let mcxState = { ym: '', sel: new Set(), titleEdited: false, filter: '', oneOff: {}, sameName: true };

// ── 单回颜色 ──
// 按「课程 + 单回标题」记在本机（localStorage），下次导出同一门课沿用；只改某一回（关掉「同名一起改」）只对这一次导出有效
const MCX_STORE = 'mcx_title_colors_v1';
let mcxTitleColors = {};   // { courseId: { 单回标题: colorKey } }
function mcxLoadColors() { try { mcxTitleColors = JSON.parse(localStorage.getItem(MCX_STORE) || '{}') || {}; } catch (e) { mcxTitleColors = {}; } }
function mcxSaveColors() { try { localStorage.setItem(MCX_STORE, JSON.stringify(mcxTitleColors)); } catch (e) {} }
function mcxPal(key) { return MCX_COLORS.find(x => x[0] === key) || MCX_COLORS[0]; }
// 单回显示的名字（单回标题优先，没有就用课程名），同名一起改也按它判断
function mcxItemName(s, c) { return (s.session_title || '').trim() || (c && c.name) || s.course_name || ''; }
function mcxColorOf(s, c) {
  return mcxState.oneOff[s.id] || ((mcxTitleColors[c.id] || {})[mcxItemName(s, c)]) || 'black';
}

function mcxEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function mcxYmLabel(ym) { const [y, m] = ym.split('-').map(Number); return `${y}年${m}月`; }
function mcxShiftYm(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
// 单回是否休讲
function mcxCancelled(s) { return !!s.is_cancelled || (s.session_title || '').trim() === '休讲'; }
// 单回的时间段（多个时间段用 / 分隔）
function mcxRanges(s, c) {
  const tr = (s && s.time_range) || (c && c.time_range) || '';
  return parseTimeRanges(tr);
}
// 这个月里有单回（不含休讲）的课程（受当前领域视角限制：cachedCourses 已按领域过滤；专业钥匙再按专业过滤）
function mcxCoursesOfMonth(ym) {
  const byCourse = {};
  (cachedSessions || []).forEach(s => {
    if (!s.session_date || !s.session_date.startsWith(ym) || mcxCancelled(s)) return;
    (byCourse[s.course_id] = byCourse[s.course_id] || []).push(s);
  });
  return (cachedCourses || []).filter(c => byCourse[c.id] && (!CURRENT_MAJOR || (c.major || []).includes(CURRENT_MAJOR)))
    .map(c => ({ c, sessions: byCourse[c.id] }))
    .sort((a, b) => String(a.c.name || '').localeCompare(String(b.c.name || ''), 'zh'));
}
// 快速筛选的候选：专业（按班级的筛选见 mcxClassFilters，学部美术班级功能加载后才有）
function mcxFilterOptions(list) {
  const opts = [];
  if (typeof mcxClassFilters === 'function') opts.push(...mcxClassFilters(list));
  const majors = [...new Set(list.flatMap(x => x.c.major || []))];
  majors.forEach(m => opts.push({ key: 'major:' + m, label: majorLabel(m), test: c => (c.major || []).includes(m) }));
  return opts;
}
function mcxDefaultTitle() {
  const base = `${mcxYmLabel(mcxState.ym)}课表`;
  const f = mcxFilterOptions(mcxCoursesOfMonth(mcxState.ym)).find(o => o.key === mcxState.filter);
  return f && f.key.indexOf('class:') === 0 ? `${base} · ${f.label}` : base;
}

function openMonthCalExport() {
  document.getElementById('mcxModal')?.remove();
  const now = new Date();
  mcxLoadColors();
  mcxState = { ym: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'), sel: new Set(), titleEdited: false, filter: '', oneOff: {}, sameName: true };
  mcxState.sel = new Set(mcxCoursesOfMonth(mcxState.ym).map(x => String(x.c.id)));
  const m = document.createElement('div');
  m.id = 'mcxModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<style>
    #mcxModal .mcx-box{background:var(--surface);border-radius:6px;padding:16px 18px;max-width:1000px;width:100%;height:90vh;display:flex;flex-direction:column}
    #mcxModal .mcx-cols{flex:1;min-height:0;display:flex;gap:14px}
    #mcxModal .mcx-left{width:260px;flex-shrink:0;overflow-y:auto;min-height:0}
    #mcxModal .mcx-right{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
    #mcxModal .mcx-row{display:flex;align-items:center;gap:6px;padding:6px 8px;margin-bottom:4px;border-radius:3px;cursor:pointer;white-space:nowrap;overflow:hidden}
    #mcxModal .mcx-row b{overflow:hidden;text-overflow:ellipsis;min-width:0;font-size:12px}
    @media (max-width:760px){ #mcxModal .mcx-cols{flex-direction:column;overflow-y:auto} #mcxModal .mcx-left{width:auto;overflow:visible} #mcxModal .mcx-right{min-height:360px} }
  </style>
  <div class="mcx-box">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">🗓 导出月课表</div>
    <div class="mcx-cols">
      <div class="mcx-left" id="mcx_body"></div>
      <div class="mcx-right">
        <div id="mcx_changed" style="font-size:11px;color:var(--text-2);margin-bottom:6px;min-height:16px"></div>
        <div id="mcx_prev_wrap" style="flex:1;min-height:0;position:relative;overflow:hidden;border:1px solid var(--border-light);border-radius:4px;background:#fcf8f4">
          <iframe id="mcx_prev" title="月课表预览" style="position:absolute;left:0;top:0;border:none;transform-origin:0 0;background:#fcf8f4"></iframe>
        </div>
        <div style="font-size:10px;color:var(--text-3);margin-top:4px">点预览里的某一回课，可以换颜色</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('mcxModal').remove()">关闭</button>
      <button class="btn btn-primary btn-sm" onclick="mcxGenerate()">生成 PDF</button>
    </div>
  </div>`;
  m.addEventListener('click', e => { if (!e.target.closest('#mcx_pick')) mcxPickClose(); });
  document.body.appendChild(m);
  mcxRender();
}
function mcxRender() {
  const box = document.getElementById('mcx_body'); if (!box) return;
  const list = mcxCoursesOfMonth(mcxState.ym);
  const fopts = mcxFilterOptions(list);
  if (!mcxState.titleEdited) mcxState.title = mcxDefaultTitle();
  const months = []; for (let i = -6; i <= 6; i++) months.push(mcxShiftYm(new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'), i));
  const inp = 'font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;width:100%;box-sizing:border-box';
  const chip = (on, js, t) => `<span onclick="${js}" style="font-size:11px;padding:2px 9px;border-radius:12px;cursor:pointer;user-select:none;white-space:nowrap;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'var(--surface)'};color:${on ? '#fff' : 'var(--text-2)'}">${t}</span>`;
  box.innerHTML = `
    <label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">月份</label>
    <select onchange="mcxSetMonth(this.value)" style="${inp};margin-bottom:8px">${months.map(ym => `<option value="${ym}" ${ym === mcxState.ym ? 'selected' : ''}>${mcxYmLabel(ym)}</option>`).join('')}</select>
    <label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">标题</label>
    <input id="mcx_title" value="${mcxEsc(mcxState.title)}" oninput="mcxState.title=this.value;mcxState.titleEdited=true;mcxPreviewSoon()" style="${inp};margin-bottom:10px">
    <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
      ${chip(false, 'mcxSelAll(true)', '全选')}${chip(false, 'mcxSelAll(false)', '清空')}
      ${fopts.map(o => chip(mcxState.filter === o.key, `mcxApplyFilter('${mcxEsc(o.key)}')`, mcxEsc(o.label))).join('')}
    </div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">点一下选中 / 取消（已选 ${list.filter(x => mcxState.sel.has(String(x.c.id))).length} / ${list.length} 门）</div>
    ${list.length ? list.map(({ c, sessions }) => {
      const on = mcxState.sel.has(String(c.id));
      return `<div class="mcx-row" title="${mcxEsc(c.name)}" onclick="mcxToggle('${mcxEsc(c.id)}')" style="border:1px solid ${on ? 'var(--accent)' : 'var(--border-light)'};background:${on ? 'var(--accent-light,#f5efe0)' : 'var(--surface)'};${on ? '' : 'opacity:.6'}">
        <b>${mcxEsc(c.name)}</b>
        <span style="font-size:10px;color:var(--text-3);flex-shrink:0">本月 ${sessions.length} 回</span>
        <span style="flex-shrink:0">${typeof mcxClassTagHtml === 'function' ? mcxClassTagHtml(c) : ''}</span>
      </div>`;
    }).join('') : '<div style="font-size:12px;color:var(--text-3);padding:20px 0;text-align:center">这个月没有排课</div>'}`;
  mcxRenderPreview();
}
// ── 右侧预览：和 PDF 同一个函数生成，只是缩小显示 ──
let mcxPrevTimer = null;
function mcxPreviewSoon() { clearTimeout(mcxPrevTimer); mcxPrevTimer = setTimeout(mcxRenderPreview, 300); }
function mcxRenderPreview() {
  mcxRenderChanged();
  const fr = document.getElementById('mcx_prev'), wrap = document.getElementById('mcx_prev_wrap');
  if (!fr || !wrap) return;
  const doc = mcxBuildDoc({ preview: true });
  const W = 1123, H = 794;   // A4 横向（297mm × 210mm）的像素大小
  const k = Math.min(wrap.clientWidth / W, wrap.clientHeight / H) || 0.6;
  fr.style.width = W + 'px'; fr.style.height = H + 'px'; fr.style.transform = `scale(${k})`;
  fr.dataset.k = k;
  fr.srcdoc = doc || `<body style="font-family:sans-serif;color:#8a7f74;font-size:28px;display:flex;align-items:center;justify-content:center;height:90vh;margin:0;background:#fcf8f4">请在左边选择课程</body>`;
}
// 预览上方：改了哪些颜色 + 全部恢复默认
function mcxRenderChanged() {
  const el = document.getElementById('mcx_changed'); if (!el) return;
  const chosen = mcxCoursesOfMonth(mcxState.ym).filter(x => mcxState.sel.has(String(x.c.id)));
  const parts = [];
  chosen.forEach(({ c, sessions }) => {
    const names = new Set(sessions.map(s => mcxItemName(s, c)));
    Object.entries(mcxTitleColors[c.id] || {}).forEach(([t, k]) => { if (names.has(t)) parts.push(`${mcxEsc(t)}（<span style="color:${mcxPal(k)[2]}">${mcxEsc(mcxPal(k)[1])}</span>）`); });
    sessions.forEach(s => { const k = mcxState.oneOff[s.id]; if (k) parts.push(`${+s.session_date.slice(5, 7)}/${+s.session_date.slice(8, 10)} ${mcxEsc(mcxItemName(s, c))}（<span style="color:${mcxPal(k)[2]}">${mcxEsc(mcxPal(k)[1])}</span>·仅此回）`); });
  });
  el.innerHTML = parts.length ? `已改色：${parts.join(' · ')} <span onclick="mcxResetColors()" style="margin-left:6px;color:var(--accent);cursor:pointer;text-decoration:underline">全部恢复默认</span>` : '<span style="color:var(--text-3)">没有改过颜色（点预览里的某一回课可以换颜色）</span>';
}
function mcxResetColors() {
  mcxCoursesOfMonth(mcxState.ym).filter(x => mcxState.sel.has(String(x.c.id))).forEach(({ c }) => { delete mcxTitleColors[c.id]; });
  mcxState.oneOff = {};
  mcxSaveColors(); mcxRenderPreview();
}
// ── 点预览里的一回课：小色板 ──
let mcxPickCtx = null;
function mcxPick(sid, x, y) {
  const hit = mcxFindSession(sid); if (!hit) return;
  mcxPickCtx = hit;
  const fr = document.getElementById('mcx_prev'), r = fr.getBoundingClientRect(), k = +fr.dataset.k || 1;
  mcxPickRender(r.left + x * k, r.top + y * k);
}
function mcxFindSession(sid) {
  for (const { c, sessions } of mcxCoursesOfMonth(mcxState.ym)) { const s = sessions.find(z => String(z.id) === String(sid)); if (s) return { c, s }; }
  return null;
}
function mcxPickRender(px, py) {
  let p = document.getElementById('mcx_pick');
  if (!p) { p = document.createElement('div'); p.id = 'mcx_pick'; document.getElementById('mcxModal').appendChild(p); }
  if (px != null) p.style.cssText = `position:fixed;left:${Math.min(px, window.innerWidth - 230)}px;top:${Math.min(py + 8, window.innerHeight - 110)}px;z-index:10001;background:var(--surface,#fff);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:10px 12px;width:220px`;
  const { c, s } = mcxPickCtx, cur = mcxColorOf(s, c), same = mcxState.sameName;
  p.innerHTML = `<div style="font-size:11px;font-weight:600;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${+s.session_date.slice(5, 7)}/${+s.session_date.slice(8, 10)} ${mcxEsc(mcxItemName(s, c))}</div>
    <div style="display:flex;gap:8px;margin-bottom:9px">${MCX_COLORS.map(([key, name, fg]) => `<span title="${mcxEsc(name)}" onclick="mcxPickSet('${key}')" style="width:22px;height:22px;border-radius:50%;cursor:pointer;background:${fg};box-shadow:${key === cur ? `0 0 0 2px #fff,0 0 0 4px ${fg}` : 'none'}"></span>`).join('')}</div>
    <span onclick="mcxState.sameName=!mcxState.sameName;mcxPickRender()" style="display:inline-block;font-size:11px;padding:2px 10px;border-radius:12px;cursor:pointer;user-select:none;border:1px solid ${same ? 'var(--accent)' : 'var(--border)'};background:${same ? 'var(--accent)' : 'var(--surface)'};color:${same ? '#fff' : 'var(--text-2)'}">同名单回一起改</span>`;
}
function mcxPickClose() { document.getElementById('mcx_pick')?.remove(); mcxPickCtx = null; }
function mcxPickSet(key) {
  const { c, s } = mcxPickCtx || {}; if (!s) return;
  const name = mcxItemName(s, c);
  if (mcxState.sameName) {
    const m = mcxTitleColors[c.id] = mcxTitleColors[c.id] || {};
    if (key === 'black') delete m[name]; else m[name] = key;
    if (!Object.keys(m).length) delete mcxTitleColors[c.id];
    // 同名的单回里单独改过的，一起跟着这次的颜色
    mcxCoursesOfMonth(mcxState.ym).filter(x => x.c.id === c.id).forEach(x => x.sessions.forEach(z => { if (mcxItemName(z, c) === name) delete mcxState.oneOff[z.id]; }));
    mcxSaveColors();
  } else {
    const base = (mcxTitleColors[c.id] || {})[name] || 'black';
    if (key === base) delete mcxState.oneOff[s.id]; else mcxState.oneOff[s.id] = key;
  }
  mcxPickClose();
  mcxRenderPreview();
}
function mcxSetMonth(ym) {
  mcxState.ym = ym; mcxState.filter = '';
  mcxState.sel = new Set(mcxCoursesOfMonth(ym).map(x => String(x.c.id)));
  mcxRender();
}
function mcxToggle(id) { id = String(id); if (mcxState.sel.has(id)) mcxState.sel.delete(id); else mcxState.sel.add(id); mcxRender(); }
function mcxSelAll(on) { mcxState.filter = ''; mcxState.sel = new Set(on ? mcxCoursesOfMonth(mcxState.ym).map(x => String(x.c.id)) : []); mcxRender(); }
function mcxApplyFilter(key) {
  const list = mcxCoursesOfMonth(mcxState.ym);
  const o = mcxFilterOptions(list).find(x => x.key === key);
  if (!o || mcxState.filter === key) { mcxState.filter = ''; mcxState.sel = new Set(list.map(x => String(x.c.id))); }
  else { mcxState.filter = key; mcxState.sel = new Set(list.filter(x => o.test(x.c)).map(x => String(x.c.id))); }
  mcxRender();
}

// ── 生成打印页 ──
// 预览和 PDF 共用：生成整页 HTML（opts.preview=true 时不自动打印，单回可以点击改色）；没选课程时返回空
function mcxBuildDoc(opts) {
  opts = opts || {};
  const ym = mcxState.ym, [y, mo] = ym.split('-').map(Number);
  const title = (document.getElementById('mcx_title') || {}).value || mcxDefaultTitle();
  const chosen = mcxCoursesOfMonth(ym).filter(x => mcxState.sel.has(String(x.c.id)));
  if (!chosen.length) return '';
  const byDate = {};
  chosen.forEach(({ c, sessions }) => sessions.forEach(s => {
    const ranges = mcxRanges(s, c);
    (byDate[s.session_date] = byDate[s.session_date] || []).push({
      id: s.id, name: mcxItemName(s, c),
      ranges, teacher: s.session_teacher || s.teacher || c.teacher || '',
      pal: mcxPal(mcxColorOf(s, c)),
      sortKey: timeRangesSortKey((s && s.time_range) || c.time_range),
    });
  }));
  Object.values(byDate).forEach(l => l.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey))));
  const days = new Date(y, mo, 0).getDate(), lead = (new Date(y, mo - 1, 1).getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks = []; for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const cellHtml = (d, col) => {
    if (!d) return '<td class="empty"></td>';
    const list = byDate[`${ym}-${String(d).padStart(2, '0')}`] || [];
    return `<td class="${col >= 5 ? 'we' : ''}"><div class="dn">${d}</div><div class="items">${list.map(it => `<div class="it" data-sid="${mcxEsc(it.id)}" style="color:${it.pal[2]};background:${it.pal[3]}">
        <div>${mcxEsc(it.name)}</div>
        ${it.ranges.map(r => `<div>${mcxEsc(r.end ? `${r.start}-${r.end}` : r.start)}</div>`).join('')}
        ${it.teacher ? `<div>${mcxEsc(it.teacher)}老师</div>` : ''}
      </div>`).join('')}</div></td>`;
  };
  // 学部美术用「唯新美術」的 logo，其他领域用唯新 logo
  const artLogo = isGakubuArtDomain(CURRENT_DOMAIN) || chosen.every(x => isGakubuArtCourse(x.c));
  const logo = new URL(artLogo ? '../sched/artlogo.png' : '../sched/logo.png', location.href).href;
  const dots = (pos, cols) => `<div class="dots" style="${pos}">${cols.map(c => `<i style="background:${c}"></i>`).join('')}</div>`;
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${mcxEsc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@500;700&family=Noto+Serif+SC:wght@700&display=swap" rel="stylesheet">
<style>
@page{size:A4 landscape;margin:8mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fcf8f4;color:#3a342e;font-family:'Noto Sans SC',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:281mm;height:192mm;display:flex;flex-direction:column;position:relative}
.head{display:flex;flex-direction:column;align-items:center;margin-bottom:3mm;position:relative;z-index:1}
.ttl{display:flex;align-items:center;gap:3mm}
.ttl img{height:11mm;width:auto}
h1{margin:0;font-family:'Noto Serif SC',serif;font-size:25px;font-weight:700;color:#2e2924;letter-spacing:.06em}
.rule{display:flex;align-items:center;width:62%;margin-top:2mm}
.rule span{flex:1;height:1px;background:#d9cfc4}
.rule b{width:6px;height:6px;display:block;flex-shrink:0}
.dots{position:absolute;display:grid;grid-template-columns:repeat(3,5px);gap:4px}
.dots i{width:5px;height:5px;border-radius:50%;display:block}
.wrap{flex:1;min-height:0;overflow:hidden}
table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed;border:1.2px solid #d9cfc4;background:#fffdfa}
th{background:#f8eac2;color:#2e2924;font-size:14px;font-weight:700;padding:4px 0;border:0.8px solid #e8dfd5;border-bottom:2px solid #f2a93b}
th.we{color:#c4646a}
td{border:0.8px solid #e8dfd5;vertical-align:top;padding:2px 3px;position:relative}
td.empty{background:#f7f1ea}
.dn{text-align:right;font-weight:700;font-size:.85em;line-height:1.1;color:#8a7f74}
td.we .dn{color:#c4646a}
.items{text-align:center;font-weight:700;line-height:1.25}
.it{border-radius:4px;padding:.25em .3em;margin:.15em .1em 0}
.it+.it{margin-top:.35em}
.noprint{position:fixed;top:8px;right:8px;z-index:5}
@media print{.noprint{display:none}}
${opts.preview ? 'body{padding:8mm}.it{cursor:pointer}.it:hover{outline:1.5px solid #f2a93b}' : ''}
</style></head><body>
${opts.preview ? '' : '<div class="noprint"><button onclick="window.print()" style="font-size:13px;padding:8px 20px;cursor:pointer">🖨 打印 / 保存为 PDF</button></div>'}
<div class="page">
  ${dots('top:0;left:0', ['#efc9cc', '#c4d2e0', '#e6d6bf', '#d7cde6', '#efc9cc', '#c4d2e0'])}
  ${dots('top:0;right:0', ['#c4d2e0', '#e6d6bf', '#efc9cc', '#e6d6bf', '#d7cde6', '#c4d2e0'])}
  <div class="head">
    <div class="ttl"><img src="${logo}" alt="" onerror="this.style.display='none'"><h1>${mcxEsc(title)}</h1></div>
    <div class="rule"><b style="background:#efc9cc"></b><span></span><b style="background:#c4d2e0"></b></div>
  </div>
  <div class="wrap" id="wrap"><table id="cal">
    <thead><tr>${['月', '火', '水', '木', '金', '土', '日'].map((t, i) => `<th class="${i >= 5 ? 'we' : ''}">${t}</th>`).join('')}</tr></thead>
    <tbody>${weeks.map(w => `<tr style="height:${(100 / weeks.length).toFixed(2)}%">${w.map((d, i) => cellHtml(d, i)).join('')}</tr>`).join('')}</tbody>
  </table></div>
</div>
<script>
// 内容多时自动缩小字号，保证整个月在一页之内
function fit(){
  var wrap=document.getElementById('wrap'), cal=document.getElementById('cal'), fs=15;
  cal.style.fontSize=fs+'px';
  while(fs>6 && cal.offsetHeight>wrap.clientHeight+1){ fs-=0.5; cal.style.fontSize=fs+'px'; }
}
${opts.preview ? `document.addEventListener('click',function(e){var it=e.target.closest('.it');if(it&&parent.mcxPick){e.stopPropagation();parent.mcxPick(it.dataset.sid,e.clientX,e.clientY);}else if(parent.mcxPickClose){parent.mcxPickClose();}});
window.onload=function(){ fit(); if(document.fonts&&document.fonts.ready){ document.fonts.ready.then(fit); } };` : `window.onload=function(){
  var done=false, go=function(){ if(done) return; done=true; fit(); setTimeout(function(){ window.print(); }, 400); };
  fit();
  if(document.fonts&&document.fonts.ready){ document.fonts.ready.then(go); }
  setTimeout(go, 4000);   // 字体迟迟加载不完时也照样打印
};`}
<\/script></body></html>`;
  return html;
}
function mcxGenerate() {
  const html = mcxBuildDoc();
  if (!html) { alert('请至少选择一门课程'); return; }
  const w = window.open('', '_blank');
  if (!w) { alert('请允许弹出窗口'); return; }
  w.document.write(html); w.document.close();
}
