// 老师端「合格海报」：只读已发布的海报，筛选 / 点开大图 / 批量查看 / 批量下载
// 数据：pass_posters（web_url 不为空）。不取 src_url（未遮盖的原图，老师端不该看到，数据库里也只有管理员能读）。
// 全局名字一律以 tpo 开头。
const tpoS = { rows: null, loading: false, f: { kind: '', doms: new Set(), major: '', year: '', univ: '' }, q: '', pick: false, picked: new Set(), inited: false, univMore: false, busy: '' };
let tpoView = null;   // 大图查看：{ list, i }

function tpoEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function tpoKind(r) { return r.result_kind === 'grad' || !r.result_kind ? 'grad' : 'ug'; }
function tpoMajorName(k) { return (typeof MAJORS !== 'undefined' && MAJORS[k]) || k || '未设专业'; }
function tpoYm(r) { return r.pass_year ? `${r.pass_year}年${r.pass_month ? r.pass_month + '月' : ''}` : ''; }
function tpoName(r) { return (r.fields && r.fields.name_line) || ''; }
function tpoFile(r) {
  const clean = s => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 30);
  const ym = r.pass_year ? `${r.pass_year}${String(r.pass_month || '').padStart(2, '0')}` : '';
  return [r.univ, r.dept, tpoName(r), ym].map(clean).filter(Boolean).join('_') + '.jpg';
}

async function renderTeacherPosters(mc) {
  if (!document.getElementById('tpo-style')) {
    const st = document.createElement('style'); st.id = 'tpo-style';
    st.textContent = `.tpo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
.tpo-card{background:var(--surface,#fff);border:1px solid var(--border);border-radius:4px;overflow:hidden;cursor:pointer;position:relative}
.tpo-card img{width:100%;aspect-ratio:210/297;object-fit:cover;display:block;background:#eee}
.tpo-cap{padding:5px 7px;font-size:10px;line-height:1.4;color:var(--text-2)}
.tpo-card.on{outline:3px solid var(--accent)}
.tpo-tick{position:absolute;top:6px;right:6px;background:var(--accent);color:#fff;border-radius:10px;font-size:10px;padding:1px 7px}
.tpo-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px}
.tpo-lab{font-size:10px;color:var(--text-3);min-width:44px}
@media(max-width:600px){.tpo-grid{grid-template-columns:repeat(2,1fr)}}`;
    document.head.appendChild(st);
  }
  if (tpoS.rows === null && !tpoS.loading) {
    mc.innerHTML = '<div class="loading">加载中…</div>';
    tpoS.loading = true;
    try {
      const rows = await sbAll('/rest/v1/pass_posters?web_url=not.is.null&select=id,result_kind,univ,dept,spec,major,domain,pass_year,pass_month,fields,web_url,thumb_url&order=pass_year.desc,pass_month.desc');
      tpoS.rows = (rows || []).filter(r => r.web_url);
    } catch (e) {
      tpoS.loading = false;
      mc.innerHTML = `<div class="empty">读取失败：${tpoEsc(e.message || '')}</div>`;
      return;
    }
    tpoS.loading = false;
  }
  if (tpoS.rows === null) return;
  if (!tpoS.inited) {
    tpoS.inited = true;
    // 默认：领域 = 这位老师的负责领域（只取有海报的），年份 = 最新一年；不要一打开就全部列出
    const mine = (typeof salesScopeDomains === 'function' && typeof teacherData !== 'undefined') ? salesScopeDomains(teacherData) : [];
    const have = new Set(tpoS.rows.map(r => r.domain).filter(Boolean));
    mine.filter(d => have.has(d)).forEach(d => tpoS.f.doms.add(d));
    const years = tpoS.rows.map(r => r.pass_year).filter(Boolean);
    if (years.length) tpoS.f.year = String(Math.max(...years));
  }
  // 标题和搜索框放在列表容器外面，输入搜索时只重画下面的 #tpo_body，输入框不会丢焦点
  mc.innerHTML = `<div class="page-header"><div class="section-title">🖼 合格海报</div></div>
    <div class="search-bar"><input id="tpo_q" placeholder="搜索学校 / 研究科 / 专攻 / 合格者（汉字 / 拼音首字母）" value="${tpoEsc(tpoS.q)}" oninput="searchBox(this,tpoOnSearch)"></div>
    <div id="tpo_body"></div>`;
  tpoRender();
}

// ── 筛选 ──
function tpoRowOk(r, skip) {
  const f = tpoS.f;
  if (skip !== 'kind' && f.kind && tpoKind(r) !== f.kind) return false;
  if (skip !== 'dom' && f.doms.size && !f.doms.has(r.domain)) return false;
  if (skip !== 'major' && f.major && r.major !== f.major) return false;
  if (skip !== 'year' && f.year && String(r.pass_year) !== f.year) return false;
  if (skip !== 'univ' && f.univ && r.univ !== f.univ) return false;
  return true;
}
function tpoSearchOk(r) {
  const q = tpoS.q.trim();
  return !q || searchMatch(q, [r.univ, r.dept, r.spec, tpoName(r), r.fields && r.fields.univ_en]);
}
// 有搜索词时，搜索不受其他筛选限制
function tpoResult() {
  const q = tpoS.q.trim();
  return tpoS.rows.filter(r => q ? tpoSearchOk(r) : tpoRowOk(r, ''));
}
function tpoSet(k, v) {
  const f = tpoS.f;
  if (k === 'dom') { f.doms.has(v) ? f.doms.delete(v) : f.doms.add(v); f.major = ''; }
  else if (k === 'kind') { f.kind = f.kind === v ? '' : v; }
  else { f[k] = f[k] === v ? '' : v; }
  tpoRender();
}
function tpoDomAll() { tpoS.f.doms.clear(); tpoS.f.major = ''; tpoRender(); }
function tpoClear() { const f = tpoS.f; f.kind = ''; f.doms.clear(); f.major = ''; f.year = ''; f.univ = ''; tpoS.q = ''; tpoRender(); }
function tpoRender() {
  const body = document.getElementById('tpo_body');
  if (!body || !tpoS.rows) return;
  const f = tpoS.f, rows = tpoS.rows;
  const chip = (on, label, fn) => ({ on, html: `<div class="filter-chip${on ? ' active' : ''}" onclick="${fn}">${label}</div>` });
  const opts = (skip, key) => [...new Set(rows.filter(r => tpoRowOk(r, skip)).map(r => r[key]).filter(v => v != null && v !== ''))];
  // 领域：只列有海报的；专业 chips 跟着已选领域走
  const doms = [...new Set(rows.map(r => r.domain).filter(Boolean))];
  const majors = [...new Set(rows.filter(r => (!f.doms.size || f.doms.has(r.domain))).map(r => r.major).filter(Boolean))];
  const years = opts('year', 'pass_year').sort((a, b) => b - a);
  const univs = opts('univ', 'univ').sort((a, b) => a.localeCompare(b, 'ja'));
  const row = (lab, items) => `<div class="tpo-row"><span class="tpo-lab">${lab}</span>${items}</div>`;
  let h = `<div style="display:flex;justify-content:flex-end;margin-bottom:6px"><button class="btn btn-outline btn-sm" onclick="tpoTogglePick()">${tpoS.pick ? '退出选择' : '选择'}</button></div>`;
  h += row('类别', chipFold([chip(!f.kind, '全部', "tpoSet('kind','')"), chip(f.kind === 'grad', '大学院', "tpoSet('kind','grad')"), chip(f.kind === 'ug', '学部', "tpoSet('kind','ug')")]));
  if (doms.length) h += row('领域', chipFold([chip(!f.doms.size, '全部', 'tpoDomAll()'), ...doms.map(d => chip(f.doms.has(d), tpoEsc(d), `tpoSet('dom','${tpoEsc(d).replace(/'/g, '&#39;')}')`))]));
  if (majors.length) h += row('专业', chipFold([chip(!f.major, '全部', "tpoSet('major','')"), ...majors.map(m => chip(f.major === m, tpoEsc(tpoMajorName(m)), `tpoSet('major','${tpoEsc(m)}')`))]));
  if (years.length) h += row('年份', chipFold([chip(!f.year, '全部', "tpoSet('year','')"), ...years.map(y => chip(f.year === String(y), y + '年', `tpoSet('year','${y}')`))]));
  if (univs.length) h += row('学校', chipFold([chip(!f.univ, '全部', "tpoSet('univ','')"), ...univs.map(u => chip(f.univ === u, tpoEsc(u), `tpoSet('univ','${tpoEsc(u).replace(/'/g, '&#39;')}')`))]));
  const list = tpoResult();
  tpoS.list = list;
  h += `<div style="font-size:11px;color:var(--text-3);margin:8px 0">共 ${list.length} 张${tpoS.q.trim() ? '（搜索不受上面筛选限制）' : ''} · <span style="color:var(--accent);cursor:pointer" onclick="tpoClear()">清除筛选</span></div>`;
  if (tpoS.pick) {
    const n = list.filter(r => tpoS.picked.has(r.id)).length, total = tpoS.picked.size;
    h += `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 10px;margin-bottom:8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;font-size:11px">
      <b>已选 ${total} 张</b>${total !== n ? `<span style="color:var(--text-3)">（当前结果里 ${n} 张）</span>` : ''}
      <button class="btn btn-outline btn-sm" onclick="tpoPickAll()">全选当前结果</button>
      <button class="btn btn-outline btn-sm" onclick="tpoPickClear()">清空</button>
      <button class="btn btn-outline btn-sm" onclick="tpoBatchView()"${total ? '' : ' disabled'}>批量查看</button>
      <button class="btn btn-outline btn-sm" onclick="tpoBatchDownload()"${total ? '' : ' disabled'}>批量下载</button>
      <span id="tpo_busy" style="color:var(--text-3)">${tpoEsc(tpoS.busy)}</span></div>`;
  }
  if (!list.length) h += '<div class="empty">该条件下没有海报</div>';
  else h += '<div class="tpo-grid">' + list.map((r, i) => {
    const on = tpoS.picked.has(r.id);
    return `<div class="tpo-card${tpoS.pick && on ? ' on' : ''}" onclick="tpoCardClick(${i})">
      <img src="${tpoEsc(r.thumb_url || r.web_url)}" loading="lazy" alt="">${tpoS.pick && on ? '<span class="tpo-tick">已选</span>' : ''}
      <div class="tpo-cap">${[r.univ, r.dept, tpoYm(r)].filter(Boolean).map(tpoEsc).join(' · ')}</div></div>`;
  }).join('') + '</div>';
  body.innerHTML = h;
}
function tpoOnSearch(q) { tpoS.q = q; tpoRender(); }

// ── 多选 ──
function tpoTogglePick() { tpoS.pick = !tpoS.pick; if (!tpoS.pick) tpoS.picked.clear(); tpoRender(); }
function tpoPickAll() { tpoS.list.forEach(r => tpoS.picked.add(r.id)); tpoRender(); }
function tpoPickClear() { tpoS.picked.clear(); tpoRender(); }
function tpoCardClick(i) {
  const r = tpoS.list[i]; if (!r) return;
  if (tpoS.pick) { tpoS.picked.has(r.id) ? tpoS.picked.delete(r.id) : tpoS.picked.add(r.id); tpoRender(); return; }
  tpoOpen(tpoS.list, i);
}
function tpoPickedRows() { return tpoS.rows.filter(r => tpoS.picked.has(r.id)); }
function tpoBatchView() { const l = tpoPickedRows(); if (l.length) tpoOpen(l, 0); }

// ── 大图查看（左右箭头 / 滑动 / 键盘）──
function tpoOpen(list, i) {
  tpoView = { list, i };
  document.getElementById('tpo-viewer')?.remove();
  const v = document.createElement('div');
  v.id = 'tpo-viewer';
  v.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#000;display:flex;align-items:center;justify-content:center;touch-action:pan-y';
  v.innerHTML = `<img id="tpo-big" style="max-width:100%;max-height:100%;object-fit:contain;user-select:none" alt="">
    <div style="position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(rgba(0,0,0,.6),transparent);color:#fff;font-size:12px">
      <span id="tpo-cnt"></span><span id="tpo-title" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85"></span>
      <button onclick="tpoDownloadOne()" style="padding:6px 14px;border:1px solid #fff;background:rgba(255,255,255,.15);color:#fff;border-radius:4px;font-size:12px;cursor:pointer">下载</button>
      <button onclick="tpoClose()" style="padding:6px 12px;border:1px solid #fff;background:rgba(255,255,255,.15);color:#fff;border-radius:4px;font-size:12px;cursor:pointer">关闭</button></div>
    <div onclick="tpoStep(-1)" style="position:absolute;left:0;top:15%;bottom:15%;width:12%;min-width:44px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:34px;cursor:pointer;opacity:.7">‹</div>
    <div onclick="tpoStep(1)" style="position:absolute;right:0;top:15%;bottom:15%;width:12%;min-width:44px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:34px;cursor:pointer;opacity:.7">›</div>`;
  let x0 = null;
  v.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  v.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) tpoStep(dx < 0 ? 1 : -1); }, { passive: true });
  document.body.appendChild(v);
  document.addEventListener('keydown', tpoKey);
  tpoShow();
}
function tpoShow() {
  const t = tpoView; if (!t) return;
  const r = t.list[t.i];
  document.getElementById('tpo-big').src = r.web_url;
  document.getElementById('tpo-cnt').textContent = `${t.i + 1} / ${t.list.length}`;
  document.getElementById('tpo-title').textContent = [r.univ, r.dept, tpoName(r), tpoYm(r)].filter(Boolean).join(' · ');
}
function tpoStep(d) { const t = tpoView; if (!t) return; t.i = (t.i + d + t.list.length) % t.list.length; tpoShow(); }
function tpoKey(e) {
  if (!tpoView) return;
  if (e.key === 'ArrowLeft') tpoStep(-1); else if (e.key === 'ArrowRight') tpoStep(1); else if (e.key === 'Escape') tpoClose();
}
function tpoClose() { tpoView = null; document.removeEventListener('keydown', tpoKey); document.getElementById('tpo-viewer')?.remove(); }

// ── 下载 ──
function tpoSave(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
async function tpoBlob(url) { const r = await fetch(url); if (!r.ok) throw new Error('下载失败 ' + r.status); return r.blob(); }
async function tpoDownloadOne() {
  const t = tpoView; if (!t) return;
  const r = t.list[t.i];
  try { tpoSave(await tpoBlob(r.web_url), tpoFile(r)); }
  catch (e) { window.open(r.web_url, '_blank'); }   // 取不到文件就退回新窗口打开，可长按保存
}
async function tpoBatchDownload() {
  const list = tpoPickedRows(); if (!list.length || tpoS.busy) return;
  if (typeof JSZip === 'undefined') { alert('打包组件没有加载成功，请刷新页面后重试'); return; }
  if (list.length > 30 && !confirm(`一共 ${list.length} 张，较多，下载需要一点时间，继续？`)) return;
  const setMsg = m => { tpoS.busy = m; const el = document.getElementById('tpo_busy'); if (el) el.textContent = m; };
  try {
    const zip = new JSZip(), used = {}; let done = 0, fail = 0;
    for (const r of list) {
      setMsg(`下载中 ${done}/${list.length}…`);
      try {
        let n = tpoFile(r); if (used[n]) { const k = ++used[n]; n = n.replace(/\.jpg$/, `_${k}.jpg`); } else used[n] = 1;
        zip.file(n, await tpoBlob(r.web_url));
      } catch (e) { fail++; }
      done++;
    }
    setMsg('打包中…');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const d = new Date(), ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    tpoSave(blob, `合格海报_${ymd}.zip`);
    setMsg(fail ? `完成，${fail} 张下载失败` : '✓ 已打包下载');
  } catch (e) { setMsg(''); alert('批量下载失败：' + e.message); return; }
  setTimeout(() => { tpoS.busy = ''; const el = document.getElementById('tpo_busy'); if (el) el.textContent = ''; }, 4000);
}
