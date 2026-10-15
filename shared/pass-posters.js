// 合格海报列表（老师端「合格海报」和合格实绩管理端「合格海报」共用）：
// 筛选 chips + 搜索 / 缩略图网格 / 大图查看（左右切换、滑动）/ 多选 / 批量查看 / 批量 ZIP 下载。
// 入口：ppsMount(container, opts)；数据变了调用 ppsReload()。依赖的东西都从 opts 传进来：
//   mode           'teacher' | 'admin'
//   loadRows()     读海报行的函数，返回数组；字段：id,result_kind,result_id,univ,dept,spec,major,domain,pass_year,pass_month,fields,web_url,thumb_url
//   majorName(k)   专业 key → 显示名
//   defaultDomains 打开时默认选中的领域（只取有海报的）；年份默认选最新一年
//   cls            页面用的样式名 { header, title, search, btn, empty, loading }
//   chipFold       可选：传了就用页面自带的 chip 样式和折叠（老师端）；不传用本文件自带的
//   admin          仅 mode='admin'：{ edit(row), pdfBlob(row), webBlob(row), previewUrl(row), publish(row), unpublish(row), remove(row), downloadPdf(row) }
// 依赖页面里已有：searchMatch / searchBox（shared/search.js）；批量 ZIP 需要 JSZip。
// 全局名字一律以 pps 开头（pp 开头的已被老师端进度规划占用）。
const ppsS = { o: null, root: null, rows: null, loading: false, f: { kind: '', doms: new Set(), major: '', year: '', univ: '', status: '' }, q: '', pick: false, picked: new Set(), inited: false, busy: '', list: [], view: null, pv: {}, more: {} };

function ppsEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function ppsAttr(v) { return ppsEsc(v).replace(/'/g, '&#39;'); }
function ppsKind(r) { return r.result_kind === 'grad' || !r.result_kind ? 'grad' : 'ug'; }
function ppsYm(r) { return r.pass_year ? `${r.pass_year}年${r.pass_month ? r.pass_month + '月' : ''}` : ''; }
function ppsName(r) { return (r.fields && r.fields.name_line) || ''; }
function ppsAdmin() { return ppsS.o && ppsS.o.mode === 'admin'; }
function ppsFile(r, ext) {
  const clean = s => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 30);
  const ym = r.pass_year ? `${r.pass_year}${String(r.pass_month || '').padStart(2, '0')}` : '';
  return [r.univ, r.dept, ppsName(r), ym].map(clean).filter(Boolean).join('_') + '.' + (ext || 'jpg');
}

// ── 入口 ──
function ppsMount(container, opts) {
  ppsS.o = Object.assign({ cls: {}, defaultDomains: [], majorName: k => k }, opts);
  ppsS.root = container;
  if (opts.keep && ppsS.rows) { ppsShell(); return Promise.resolve(); }   // 切回这个标签：沿用已读的数据和筛选
  ppsS.rows = null; ppsS.inited = false; ppsS.picked.clear(); ppsS.pick = false;
  if (!document.getElementById('pps-style')) {
    const st = document.createElement('style'); st.id = 'pps-style';
    st.textContent = `.pps-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
.pps-card{background:var(--surface,#fff);border:1px solid var(--border);border-radius:4px;overflow:hidden;cursor:pointer;position:relative}
.pps-card img,.pps-ph{width:100%;aspect-ratio:210/297;object-fit:cover;display:block;background:#eee}
.pps-ph{display:flex;align-items:center;justify-content:center;color:#888;font-size:12px;background:#e6e4df}
.pps-cap{padding:5px 7px;font-size:10px;line-height:1.4;color:var(--text-2,#5a5650)}
.pps-card.on{outline:3px solid var(--accent)}
.pps-tick{position:absolute;top:6px;right:6px;background:var(--accent);color:#fff;border-radius:10px;font-size:10px;padding:1px 7px}
.pps-flag{position:absolute;top:6px;left:6px;background:#8a7a68;color:#fff;border-radius:10px;font-size:10px;padding:1px 7px}
.pps-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px}
.pps-lab{font-size:10px;color:var(--text-3,#9a9590);min-width:44px}
@media(max-width:600px){.pps-grid{grid-template-columns:repeat(2,1fr)}}`;
    document.head.appendChild(st);
  }
  return ppsReload();
}
async function ppsReload() {
  const o = ppsS.o, mc = ppsS.root; if (!o || !mc) return;
  if (ppsS.rows === null) mc.innerHTML = `<div class="${o.cls.loading || ''}" style="padding:20px;color:var(--text-3,#9a9590)">加载中…</div>`;
  try { ppsS.rows = (await o.loadRows() || []).filter(r => ppsAdmin() || r.web_url); }
  catch (e) { mc.innerHTML = `<div class="${o.cls.empty || ''}" style="padding:20px">读取失败：${ppsEsc(e.message || '')}</div>`; ppsS.rows = null; return; }
  const ids = new Set(ppsS.rows.map(r => r.id)); [...ppsS.picked].forEach(id => { if (!ids.has(id)) ppsS.picked.delete(id); });
  if (!ppsS.inited) {
    ppsS.inited = true;
    // 默认：领域 = 负责领域（只取有海报的），年份 = 最新一年；不要一打开就全部列出
    const have = new Set(ppsS.rows.map(r => r.domain).filter(Boolean));
    (o.defaultDomains || []).filter(d => have.has(d)).forEach(d => ppsS.f.doms.add(d));
    const years = ppsS.rows.map(r => r.pass_year).filter(Boolean);
    ppsS.f.year = years.length ? String(Math.max(...years)) : '';
  }
  ppsShell();
}
function ppsShell() {
  const o = ppsS.o, mc = ppsS.root, keepQ = ppsS.q;
  // 标题和搜索框放在列表容器外面，输入搜索时只重画下面的 #pps_body，输入框不会丢焦点
  mc.innerHTML = `<div class="${o.cls.header || ''}" style="${o.cls.header ? '' : 'margin-bottom:8px'}"><div class="${o.cls.title || ''}" style="${o.cls.title ? '' : 'font-size:14px;font-weight:600'}">🖼 合格海报</div></div>
    <div class="${o.cls.search || ''}" style="margin-bottom:8px"><input id="pps_q" placeholder="搜索学校 / 研究科 / 专攻 / 合格者（汉字 / 拼音首字母）" value="${ppsEsc(keepQ)}" oninput="searchBox(this,ppsOnSearch)" style="padding:6px 10px;border:1px solid var(--border);border-radius:3px;font-family:inherit;font-size:12px;width:min(420px,100%)"></div>
    <div id="pps_body"></div>`;
  ppsRender();
}

// ── 筛选 ──
function ppsRowOk(r, skip) {
  const f = ppsS.f;
  if (skip !== 'kind' && f.kind && ppsKind(r) !== f.kind) return false;
  if (skip !== 'dom' && f.doms.size && !f.doms.has(r.domain)) return false;
  if (skip !== 'major' && f.major && r.major !== f.major) return false;
  if (skip !== 'year' && f.year && String(r.pass_year) !== f.year) return false;
  if (skip !== 'univ' && f.univ && r.univ !== f.univ) return false;
  if (skip !== 'status' && f.status && (f.status === 'pub') !== !!r.web_url) return false;
  return true;
}
function ppsSearchOk(r) {
  const q = ppsS.q.trim();
  return !q || searchMatch(q, [r.univ, r.dept, r.spec, ppsName(r), r.fields && r.fields.univ_en]);
}
// 有搜索词时，搜索不受其他筛选限制
function ppsResult() {
  const q = ppsS.q.trim();
  return ppsS.rows.filter(r => q ? ppsSearchOk(r) : ppsRowOk(r, ''));
}
function ppsSet(k, v) {
  const f = ppsS.f;
  if (k === 'dom') { f.doms.has(v) ? f.doms.delete(v) : f.doms.add(v); f.major = ''; }
  else f[k] = f[k] === v ? '' : v;
  ppsRender();
}
function ppsDomAll() { ppsS.f.doms.clear(); ppsS.f.major = ''; ppsRender(); }
function ppsClear() { const f = ppsS.f; f.kind = ''; f.doms.clear(); f.major = ''; f.year = ''; f.univ = ''; f.status = ''; ppsS.q = ''; const el = document.getElementById('pps_q'); if (el) el.value = ''; ppsRender(); }
function ppsOnSearch(q) { ppsS.q = q; ppsRender(); }
function ppsMoreToggle(g) { ppsS.more[g] = !ppsS.more[g]; ppsRender(); }

function ppsChip(on, label, fn) {
  if (ppsS.o.chipFold) return { on, html: `<div class="filter-chip${on ? ' active' : ''}" onclick="${fn}">${label}</div>` };
  return { on, html: `<span onclick="${fn}" style="display:inline-block;padding:3px 10px;margin:0 4px 4px 0;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'var(--surface,#fff)'};color:${on ? '#fff' : 'var(--text-secondary,#5a5650)'};border-radius:12px;font-size:11px;cursor:pointer">${label}</span>` };
}
function ppsFold(group, items) {
  const o = ppsS.o;
  if (o.chipFold) return o.chipFold(items);
  const MAX = 12;
  if (items.length <= MAX) return items.map(i => i.html).join('');
  const open = !!ppsS.more[group];
  const shown = items.filter((it, i) => open || i < MAX || it.on);
  const btn = ppsChip(false, open ? '收起 ▴' : `更多 ▾ ${items.length - shown.length}`, `ppsMoreToggle('${group}')`).html;
  return shown.map(i => i.html).join('') + btn;
}
function ppsBtn(label, fn, extra) { return `<button class="${ppsS.o.cls.btn || ''}" style="${ppsS.o.cls.btn ? '' : 'padding:4px 10px;border:1px solid var(--border);background:var(--surface,#fff);border-radius:3px;cursor:pointer;font-family:inherit;font-size:11px;'}" onclick="${fn}"${extra || ''}>${label}</button>`; }

function ppsRender() {
  const body = document.getElementById('pps_body');
  if (!body || !ppsS.rows) return;
  const f = ppsS.f, rows = ppsS.rows, o = ppsS.o;
  const chip = ppsChip;
  const opts = (skip, key) => [...new Set(rows.filter(r => ppsRowOk(r, skip)).map(r => r[key]).filter(v => v != null && v !== ''))];
  // 领域：只列有海报的；专业 chips 跟着已选领域走
  const doms = [...new Set(rows.map(r => r.domain).filter(Boolean))];
  const majors = [...new Set(rows.filter(r => !f.doms.size || f.doms.has(r.domain)).map(r => r.major).filter(Boolean))];
  const years = opts('year', 'pass_year').sort((a, b) => b - a);
  const univs = opts('univ', 'univ').sort((a, b) => a.localeCompare(b, 'ja'));
  const row = (lab, items) => `<div class="pps-row"><span class="pps-lab">${lab}</span>${items}</div>`;
  let h = `<div style="display:flex;justify-content:flex-end;margin-bottom:6px">${ppsBtn(ppsS.pick ? '退出选择' : '选择', 'ppsTogglePick()')}</div>`;
  h += row('类别', ppsFold('kind', [chip(!f.kind, '全部', "ppsSet('kind','')"), chip(f.kind === 'grad', '大学院', "ppsSet('kind','grad')"), chip(f.kind === 'ug', '学部', "ppsSet('kind','ug')")]));
  if (ppsAdmin()) h += row('状态', ppsFold('status', [chip(!f.status, '全部', "ppsSet('status','')"), chip(f.status === 'pub', '已发布', "ppsSet('status','pub')"), chip(f.status === 'draft', '未发布', "ppsSet('status','draft')")]));
  if (doms.length) h += row('领域', ppsFold('dom', [chip(!f.doms.size, '全部', 'ppsDomAll()'), ...doms.map(d => chip(f.doms.has(d), ppsEsc(d), `ppsSet('dom','${ppsAttr(d)}')`))]));
  if (majors.length) h += row('专业', ppsFold('major', [chip(!f.major, '全部', "ppsSet('major','')"), ...majors.map(m => chip(f.major === m, ppsEsc(o.majorName(m)), `ppsSet('major','${ppsAttr(m)}')`))]));
  if (years.length) h += row('年份', ppsFold('year', [chip(!f.year, '全部', "ppsSet('year','')"), ...years.map(y => chip(f.year === String(y), y + '年', `ppsSet('year','${y}')`))]));
  if (univs.length) h += row('学校', ppsFold('univ', [chip(!f.univ, '全部', "ppsSet('univ','')"), ...univs.map(u => chip(f.univ === u, ppsEsc(u), `ppsSet('univ','${ppsAttr(u)}')`))]));
  const list = ppsResult();
  ppsS.list = list;
  h += `<div style="font-size:11px;color:var(--text-3,#9a9590);margin:8px 0">共 ${list.length} 张${ppsS.q.trim() ? '（搜索不受上面筛选限制）' : ''} · <span style="color:var(--accent);cursor:pointer" onclick="ppsClear()">清除筛选</span></div>`;
  if (ppsS.pick) {
    const n = list.filter(r => ppsS.picked.has(r.id)).length, total = ppsS.picked.size;
    const dis = total ? '' : ' disabled';
    h += `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 10px;margin-bottom:8px;background:var(--bg,#f7f5f0);border:1px solid var(--border);border-radius:4px;font-size:11px">
      <b>已选 ${total} 张</b>${total !== n ? `<span style="color:var(--text-3,#9a9590)">（当前结果里 ${n} 张）</span>` : ''}
      ${ppsBtn('全选当前结果', 'ppsPickAll()')}${ppsBtn('清空', 'ppsPickClear()')}
      ${ppsBtn('批量查看', 'ppsBatchView()', dis)}${ppsBtn(ppsAdmin() ? '批量下载网络版' : '批量下载', 'ppsBatchWeb()', dis)}
      ${ppsAdmin() ? ppsBtn('批量下载印刷版 PDF', 'ppsBatchPdf()', dis) + ppsBtn('批量发布', 'ppsBatchPublish()', dis) : ''}
      <span id="pps_busy" style="color:var(--text-3,#9a9590)">${ppsEsc(ppsS.busy)}</span></div>`;
  }
  if (!list.length) h += `<div class="${o.cls.empty || ''}" style="padding:16px;color:var(--text-3,#9a9590)">该条件下没有海报</div>`;
  else h += '<div class="pps-grid">' + list.map((r, i) => {
    const on = ppsS.picked.has(r.id);
    const img = r.web_url ? `<img src="${ppsEsc(r.thumb_url || r.web_url)}" loading="lazy" alt="">` : '<div class="pps-ph">未发布</div>';
    return `<div class="pps-card${ppsS.pick && on ? ' on' : ''}" onclick="ppsCardClick(${i})">
      ${img}${ppsS.pick && on ? '<span class="pps-tick">已选</span>' : ''}${!r.web_url ? '<span class="pps-flag">未发布</span>' : ''}
      <div class="pps-cap">${[r.univ, r.dept, ppsYm(r)].filter(Boolean).map(ppsEsc).join(' · ')}</div></div>`;
  }).join('') + '</div>';
  body.innerHTML = h;
}

// ── 多选 ──
function ppsTogglePick() { ppsS.pick = !ppsS.pick; if (!ppsS.pick) ppsS.picked.clear(); ppsRender(); }
function ppsPickAll() { ppsS.list.forEach(r => ppsS.picked.add(r.id)); ppsRender(); }
function ppsPickClear() { ppsS.picked.clear(); ppsRender(); }
function ppsCardClick(i) {
  const r = ppsS.list[i]; if (!r) return;
  if (ppsS.pick) { ppsS.picked.has(r.id) ? ppsS.picked.delete(r.id) : ppsS.picked.add(r.id); ppsRender(); return; }
  ppsOpen(ppsS.list, i);
}
function ppsPickedRows() { return ppsS.rows.filter(r => ppsS.picked.has(r.id)); }
function ppsBatchView() { const l = ppsPickedRows(); if (l.length) ppsOpen(l, 0); }

// ── 大图查看（左右箭头 / 滑动 / 键盘）──
function ppsOpen(list, i) {
  ppsS.view = { list, i };
  document.getElementById('pps-viewer')?.remove();
  const v = document.createElement('div');
  v.id = 'pps-viewer';
  v.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#000;display:flex;align-items:center;justify-content:center;touch-action:pan-y';
  const tb = 'padding:6px 12px;border:1px solid #fff;background:rgba(255,255,255,.15);color:#fff;border-radius:4px;font-size:12px;cursor:pointer;white-space:nowrap';
  const adminBtns = ppsAdmin() ? `<button onclick="ppsViewDownloadPdf()" style="${tb}">下载 PDF</button><button onclick="ppsViewEdit()" style="${tb}">编辑海报</button><button id="pps-unpub" onclick="ppsViewUnpublish()" style="${tb}">取消发布</button><button onclick="ppsViewRemove()" style="${tb}">删除海报</button>` : '';
  v.innerHTML = `<img id="pps-big" style="max-width:100%;max-height:100%;object-fit:contain;user-select:none" alt="">
    <div id="pps-wait" style="position:absolute;color:#fff;font-size:12px;display:none">生成预览中…</div>
    <div style="position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:6px;padding:10px 12px;background:linear-gradient(rgba(0,0,0,.6),transparent);color:#fff;font-size:12px;flex-wrap:wrap">
      <span id="pps-cnt"></span><span id="pps-title" style="flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85"></span>
      <button onclick="ppsDownloadOne()" style="${tb}">下载${ppsAdmin() ? ' JPG' : ''}</button>${adminBtns}
      <button onclick="ppsClose()" style="${tb}">关闭</button></div>
    <div onclick="ppsStep(-1)" style="position:absolute;left:0;top:15%;bottom:15%;width:12%;min-width:44px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:34px;cursor:pointer;opacity:.7">‹</div>
    <div onclick="ppsStep(1)" style="position:absolute;right:0;top:15%;bottom:15%;width:12%;min-width:44px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:34px;cursor:pointer;opacity:.7">›</div>`;
  let x0 = null;
  v.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  v.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) ppsStep(dx < 0 ? 1 : -1); }, { passive: true });
  document.body.appendChild(v);
  document.addEventListener('keydown', ppsKey);
  ppsShow();
}
async function ppsShow() {
  const t = ppsS.view; if (!t) return;
  const r = t.list[t.i];
  document.getElementById('pps-cnt').textContent = `${t.i + 1} / ${t.list.length}`;
  document.getElementById('pps-title').textContent = [r.univ, r.dept, ppsName(r), ppsYm(r), r.web_url ? '' : '（未发布）'].filter(Boolean).join(' · ');
  const un = document.getElementById('pps-unpub'); if (un) un.style.display = r.web_url ? '' : 'none';
  const img = document.getElementById('pps-big'), wait = document.getElementById('pps-wait');
  if (r.web_url) { wait.style.display = 'none'; img.src = r.web_url; return; }
  // 未发布：没有网络版，用编辑器同一套渲染函数在后台合成一张预览
  img.removeAttribute('src'); wait.style.display = '';
  try {
    if (!ppsS.pv[r.id]) ppsS.pv[r.id] = await ppsS.o.admin.previewUrl(r);
    if (ppsS.view && ppsS.view.list[ppsS.view.i] === r) { img.src = ppsS.pv[r.id]; wait.style.display = 'none'; }
  } catch (e) { wait.textContent = '预览失败：' + (e.message || ''); }
}
function ppsStep(d) { const t = ppsS.view; if (!t) return; t.i = (t.i + d + t.list.length) % t.list.length; ppsShow(); }
function ppsKey(e) {
  if (!ppsS.view) return;
  if (e.key === 'ArrowLeft') ppsStep(-1); else if (e.key === 'ArrowRight') ppsStep(1); else if (e.key === 'Escape') ppsClose();
}
function ppsClose() {
  ppsS.view = null; document.removeEventListener('keydown', ppsKey); document.getElementById('pps-viewer')?.remove();
  Object.values(ppsS.pv).forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} }); ppsS.pv = {};
}
function ppsCur() { const t = ppsS.view; return t ? t.list[t.i] : null; }
// 管理端大图里的操作：先关掉大图再做，做完刷新列表
async function ppsViewEdit() { const r = ppsCur(); if (!r) return; ppsClose(); await ppsS.o.admin.edit(r); }
async function ppsViewDownloadPdf() {
  const r = ppsCur(); if (!r) return;
  ppsSetBusyView(true);
  try { await ppsS.o.admin.downloadPdf(r); } catch (e) { alert('导出失败：' + e.message); }
  ppsSetBusyView(false);
}
function ppsSetBusyView(on) { const w = document.getElementById('pps-wait'); if (!w) return; w.textContent = '处理中…'; w.style.display = on ? '' : 'none'; }
async function ppsViewUnpublish() {
  const r = ppsCur(); if (!r || !r.web_url) return;
  if (!confirm('取消发布？老师端会立刻看不到这张，海报的设置保留。')) return;
  try { await ppsS.o.admin.unpublish(r); ppsClose(); await ppsReload(); } catch (e) { alert('取消发布失败：' + e.message); }
}
async function ppsViewRemove() {
  const r = ppsCur(); if (!r) return;
  if (!confirm('删除这张海报？（合格数据和照片保留，只删海报和它的设置）')) return;
  try { await ppsS.o.admin.remove(r); ppsClose(); await ppsReload(); } catch (e) { alert('删除失败：' + e.message); }
}

// ── 下载 ──
function ppsSave(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
async function ppsFetchBlob(url) { const r = await fetch(url); if (!r.ok) throw new Error('下载失败 ' + r.status); return r.blob(); }
// 网络版 JPG：已发布直接取 web_url；未发布（只有管理端会遇到）后台合成
async function ppsWebBlob(r) { return r.web_url ? ppsFetchBlob(r.web_url) : ppsS.o.admin.webBlob(r); }
async function ppsDownloadOne() {
  const r = ppsCur(); if (!r) return;
  try { ppsSave(await ppsWebBlob(r), ppsFile(r, 'jpg')); }
  catch (e) { if (r.web_url) window.open(r.web_url, '_blank'); else alert('导出失败：' + e.message); }   // 取不到文件就退回新窗口打开，可长按保存
}
function ppsSetMsg(m) { ppsS.busy = m; const el = document.getElementById('pps_busy'); if (el) el.textContent = m; }
function ppsDone(m) { ppsSetMsg(m); setTimeout(() => { if (ppsS.busy === m) ppsSetMsg(''); }, 4000); }
function ppsDateStr() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }
async function ppsZip(list, getBlob, ext, label) {
  if (typeof JSZip === 'undefined') { alert('打包组件没有加载成功，请刷新页面后重试'); return; }
  const zip = new JSZip(), used = {}; let done = 0, fail = 0;
  for (const r of list) {
    ppsSetMsg(`${label} ${done + 1} / ${list.length}…`);
    try {
      let n = ppsFile(r, ext); if (used[n]) { const k = ++used[n]; n = n.replace(new RegExp('\\.' + ext + '$'), `_${k}.${ext}`); } else used[n] = 1;
      zip.file(n, await getBlob(r));
    } catch (e) { fail++; }
    done++;
  }
  ppsSetMsg('打包中…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  ppsSave(blob, `合格海报${ext === 'pdf' ? '_印刷版' : ''}_${ppsDateStr()}.zip`);
  ppsDone(fail ? `完成，${fail} 张失败` : '✓ 已打包下载');
}
async function ppsBatchWeb() {
  const list = ppsPickedRows(); if (!list.length || ppsS.busy) return;
  if (list.length > 30 && !confirm(`一共 ${list.length} 张，较多，下载需要一点时间，继续？`)) return;
  try { await ppsZip(list, ppsWebBlob, 'jpg', '下载中'); } catch (e) { ppsSetMsg(''); alert('批量下载失败：' + e.message); }
}
async function ppsBatchPdf() {
  const list = ppsPickedRows(); if (!list.length || ppsS.busy) return;
  if (list.length > 20) { alert(`印刷版一次最多 20 张，现在选了 ${list.length} 张，请分批。`); return; }
  try { await ppsZip(list, r => ppsS.o.admin.pdfBlob(r), 'pdf', '合成印刷版'); } catch (e) { ppsSetMsg(''); alert('批量下载失败：' + e.message); }
}
async function ppsBatchPublish() {
  const list = ppsPickedRows().filter(r => !r.web_url); if (ppsS.busy) return;
  if (!list.length) { alert('选中的海报都已经发布了'); return; }
  if (!confirm(`发布选中的 ${list.length} 张未发布海报？发布后老师端就能看到。`)) return;
  let ok = 0, fail = 0;
  for (const r of list) {
    ppsSetMsg(`发布中 ${ok + fail + 1} / ${list.length}…`);
    try { await ppsS.o.admin.publish(r); ok++; } catch (e) { fail++; }
  }
  ppsSetMsg(''); await ppsReload();
  ppsDone(fail ? `已发布 ${ok} 张，${fail} 张失败` : `✓ 已发布 ${ok} 张`);
}
