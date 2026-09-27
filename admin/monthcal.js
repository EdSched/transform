// ══════════════════════════════════
// monthcal.js — 课程安排「🗓 导出月课表」：按月把选中课程的单回排成月历，打印 / 另存为 PDF
// 数据：cachedCourses / cachedSessions（课程安排页已加载，已按领域视角过滤）
// 样式参照「2026年9月课表 · 纯艺设计班」：A4 横向一页，周一开始，表头浅黄，土日红字
// ══════════════════════════════════

const MCX_COLORS = [['black', '黑', '#111111'], ['blue', '蓝', '#1f4fd1'], ['pink', '粉', '#e0457b'], ['green', '绿', '#1e8a4c'], ['orange', '橙', '#e07b12']];
let mcxState = { ym: '', sel: new Set(), colors: {}, titleEdited: false, filter: '' };

function mcxEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function mcxYmLabel(ym) { const [y, m] = ym.split('-').map(Number); return `${y}年${m}月`; }
function mcxShiftYm(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
// 单回是否休讲
function mcxCancelled(s) { return !!s.is_cancelled || (s.session_title || '').trim() === '休讲'; }
// 单回的时间段（多个时间段用 / 分隔）
function mcxRanges(s, c) {
  const tr = (s && s.time_range) || (c && c.time_range) || '';
  return (typeof parseTimeRanges === 'function') ? parseTimeRanges(tr) : String(tr).split(/[\/／、,，]/).map(x => x.trim()).filter(Boolean).map(x => { const p = x.split(/\s*[-–~〜～]\s*/); return { start: p[0] || '', end: p[1] || '' }; });
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
  mcxState = { ym: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'), sel: new Set(), colors: {}, titleEdited: false, filter: '' };
  mcxState.sel = new Set(mcxCoursesOfMonth(mcxState.ym).map(x => String(x.c.id)));
  const m = document.createElement('div');
  m.id = 'mcxModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:18px;max-width:640px;width:100%;max-height:90vh;display:flex;flex-direction:column">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">🗓 导出月课表</div>
    <div id="mcx_body" style="flex:1;overflow-y:auto;min-height:0"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('mcxModal').remove()">关闭</button>
      <button class="btn btn-primary btn-sm" onclick="mcxGenerate()">生成 PDF</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  mcxRender();
}
function mcxRender() {
  const box = document.getElementById('mcx_body'); if (!box) return;
  const list = mcxCoursesOfMonth(mcxState.ym);
  const fopts = mcxFilterOptions(list);
  if (!mcxState.titleEdited) mcxState.title = mcxDefaultTitle();
  const months = []; for (let i = -6; i <= 6; i++) months.push(mcxShiftYm(new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'), i));
  const inp = 'font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const chip = (on, js, t) => `<span onclick="${js}" style="font-size:11px;padding:3px 10px;border-radius:12px;cursor:pointer;user-select:none;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'var(--surface)'};color:${on ? '#fff' : 'var(--text-2)'}">${t}</span>`;
  box.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
      <div><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">月份</label>
        <select onchange="mcxSetMonth(this.value)" style="${inp}">${months.map(ym => `<option value="${ym}" ${ym === mcxState.ym ? 'selected' : ''}>${mcxYmLabel(ym)}</option>`).join('')}</select></div>
      <div style="flex:1;min-width:200px"><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">标题</label>
        <input id="mcx_title" value="${mcxEsc(mcxState.title)}" oninput="mcxState.title=this.value;mcxState.titleEdited=true" style="${inp};width:100%;box-sizing:border-box"></div>
    </div>
    <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      ${chip(false, 'mcxSelAll(true)', '全选')}${chip(false, 'mcxSelAll(false)', '清空')}
      ${fopts.length ? `<span style="font-size:10px;color:var(--text-3);margin-left:6px">快速筛选：</span>${fopts.map(o => chip(mcxState.filter === o.key, `mcxApplyFilter('${mcxEsc(o.key)}')`, mcxEsc(o.label))).join('')}` : ''}
    </div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">点击课程行选中 / 取消（已选 ${list.filter(x => mcxState.sel.has(String(x.c.id))).length} / ${list.length} 门）；右侧可以给特殊课程换文字颜色</div>
    ${list.length ? list.map(({ c, sessions }) => {
      const on = mcxState.sel.has(String(c.id));
      const col = mcxState.colors[c.id] || 'black';
      return `<div onclick="mcxToggle('${mcxEsc(c.id)}')" style="display:flex;align-items:center;gap:8px;padding:6px 9px;margin-bottom:4px;border-radius:3px;cursor:pointer;border:1px solid ${on ? 'var(--accent)' : 'var(--border-light)'};background:${on ? 'var(--accent-light,#f5efe0)' : 'var(--surface)'};${on ? '' : 'opacity:.6'}">
        <span style="flex:1;min-width:0;font-size:12px"><b>${mcxEsc(c.name)}</b> <span style="color:var(--text-3);font-size:11px">· ${mcxEsc(c.teacher || '')} · 本月 ${sessions.length} 回${typeof mcxClassTagHtml === 'function' ? mcxClassTagHtml(c) : ''}</span></span>
        <select onclick="event.stopPropagation()" onchange="mcxState.colors['${mcxEsc(c.id)}']=this.value" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:2px;background:var(--bg);color:${MCX_COLORS.find(x => x[0] === col)[2]}">
          ${MCX_COLORS.map(([k, l, hex]) => `<option value="${k}" ${k === col ? 'selected' : ''} style="color:${hex}">${l}</option>`).join('')}
        </select>
      </div>`;
    }).join('') : '<div style="font-size:12px;color:var(--text-3);padding:20px 0;text-align:center">这个月没有排课</div>'}`;
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
function mcxGenerate() {
  const ym = mcxState.ym, [y, mo] = ym.split('-').map(Number);
  const title = (document.getElementById('mcx_title') || {}).value || mcxDefaultTitle();
  const chosen = mcxCoursesOfMonth(ym).filter(x => mcxState.sel.has(String(x.c.id)));
  if (!chosen.length) { alert('请至少选择一门课程'); return; }
  const byDate = {};
  chosen.forEach(({ c, sessions }) => sessions.forEach(s => {
    const ranges = mcxRanges(s, c);
    (byDate[s.session_date] = byDate[s.session_date] || []).push({
      name: (s.session_title || '').trim() || c.name || s.course_name || '',
      ranges, teacher: s.session_teacher || s.teacher || c.teacher || '',
      color: (MCX_COLORS.find(x => x[0] === (mcxState.colors[c.id] || 'black')) || MCX_COLORS[0])[2],
      sortKey: (ranges[0] && ranges[0].start) || '99:99',
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
    return `<td class="${col >= 5 ? 'we' : ''}"><div class="dn">${d}</div><div class="items">${list.map(it => `<div class="it" style="color:${it.color}">
        <div>${mcxEsc(it.name)}</div>
        ${it.ranges.map(r => `<div>${mcxEsc(r.end ? `${r.start}-${r.end}` : r.start)}</div>`).join('')}
        ${it.teacher ? `<div>${mcxEsc(it.teacher)}老师</div>` : ''}
      </div>`).join('')}</div></td>`;
  };
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${mcxEsc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@500;700;900&display=swap" rel="stylesheet">
<style>
@page{size:A4 landscape;margin:8mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#111;font-family:'Noto Sans SC',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:281mm;height:192mm;display:flex;flex-direction:column}
h1{margin:0 0 3mm;text-align:center;font-size:26px;font-weight:900;letter-spacing:.04em}
.wrap{flex:1;min-height:0;overflow:hidden}
table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed;border:2.5px solid #111}
th{background:#fdf98c;font-size:15px;font-weight:900;padding:4px 0;border:1.5px solid #111}
th.we{color:#e0201b}
td{border:1.5px solid #111;vertical-align:top;padding:2px 3px;position:relative}
td.empty{background:#fff}
.dn{text-align:right;font-weight:900;font-size:1em;line-height:1.1}
td.we .dn{color:#e0201b}
.items{text-align:center;font-weight:700;line-height:1.25}
.it+.it{margin-top:.5em}
.noprint{position:fixed;top:8px;right:8px}
@media print{.noprint{display:none}}
</style></head><body>
<div class="noprint"><button onclick="window.print()" style="font-size:13px;padding:8px 20px;cursor:pointer">🖨 打印 / 保存为 PDF</button></div>
<div class="page">
  <h1>${mcxEsc(title)}</h1>
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
window.onload=function(){
  var done=false, go=function(){ if(done) return; done=true; fit(); setTimeout(function(){ window.print(); }, 400); };
  fit();
  if(document.fonts&&document.fonts.ready){ document.fonts.ready.then(go); }
  setTimeout(go, 4000);   // 字体迟迟加载不完时也照样打印
};
<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('请允许弹出窗口'); return; }
  w.document.write(html); w.document.close();
}
