// 合格海报：遮盖隐私 → 填信息 → 自动合成 → 预览 / 导出
// 依赖 admin/results-admin.js 里的：raSbFetch、raAuthHeaders（请求统一走 admin 的 sb()）、raPhGet、raArMajors、
//   raArRenderMajor/raArGetMajor、raArUploadPhoto、raArSetPhoto、raArEnsurePhotoMap、raArPhotoRef、raArResolveSrc、raArDeleteResultPhotos、
//   raArStripNotePhoto、raArRealName、raArEsc、raToast、raLoadPhotos、raPstOnClose；
//   以及 shared/search.js 的 pinyinInitialsOf、shared/supabase.js 的 SB_URL / SB_KEY。
// 背景图 / 排版文件在 results/poster/（bg.png、layout.json），路径相对 admin 页面。
// 全局名字一律以 pst 开头。
const PST_BUCKET = 'admission-photos';
const PST_PREVIEW_W = 540;     // 预览
const PST_WEB_W = 1080;        // 网络版
const PST_PRINT_W = 2480;      // 印刷版 A4 300dpi
const PST_THUMB_W = 360;       // 缩略图
const PST_SMALL_EDGE = 1200;   // 预览用的截图长边

let pstLayout = null, pstBg = null, pstSt = null, pstTimer = null, pstBusy = false;

// ── 基础 ──
function pstLoadImg(url, cors) {
  return new Promise((ok, ng) => {
    const im = new Image();
    if (cors) im.crossOrigin = 'anonymous';
    im.onload = () => ok(im);
    im.onerror = () => ng(new Error('图片加载失败'));
    im.src = url;
  });
}
const PST_DIR = '../results/poster/';   // 相对 admin 页面
// 海报用的 Google 字体（Noto Sans JP / SC）只在第一次用到海报时才加载，等样式表就绪再往下走
let pstFontsP = null;
function pstLoadFonts() {
  if (pstFontsP) return pstFontsP;
  pstFontsP = new Promise(ok => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700;900&family=Noto+Sans+SC:wght@400;900&display=swap';
    l.onload = ok; l.onerror = ok;   // 字体加载失败不拦着：退回系统字体
    document.head.appendChild(l);
    setTimeout(ok, 8000);
  });
  return pstFontsP;
}
async function pstInit() {
  pstLoadFonts();
  if (!pstLayout) pstLayout = await (await fetch(PST_DIR + 'layout.json?v=' + Date.now())).json();
  if (!pstBg) pstBg = await pstLoadImg(PST_DIR + pstLayout.bg + '?v=' + Date.now(), false);
  await pstFontsP;
}
function pstClamp(v) { return Math.max(0, Math.min(1, v)); }
function pstNum(v) { return Number(v) || 0; }
function pstFilePart(s) { return String(s || '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 30); }
function pstFileName(ext, st) {
  st = st || pstSt;
  const f = st.fields, y = st.year, m = String(st.month || '').padStart(2, '0');
  return `合格海报_${pstFilePart(st.row.univ)}_${pstFilePart(f.name_line)}_${y}${m}.${ext}`;
}
function pstDownload(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function pstToBlob(canvas, q) { return new Promise(r => canvas.toBlob(r, 'image/jpeg', q)); }

// ── 渲染：预览 / 网络版 / 印刷版 共用 ──
// src：Image 或 canvas（预览用缩小版，导出用原图全分辨率）；masks/crop 都是相对原图的 0–1 比例
function pstMaskedCanvas(src, masks, crop) {
  const nw = src.naturalWidth || src.width, nh = src.naturalHeight || src.height;
  const c = crop && crop.w > 0 && crop.h > 0 ? crop : { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.round(c.x * nw), sy = Math.round(c.y * nh);
  const sw = Math.max(1, Math.round(c.w * nw)), sh = Math.max(1, Math.round(c.h * nh));
  const tmp = document.createElement('canvas'); tmp.width = sw; tmp.height = sh;
  const g = tmp.getContext('2d');
  g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  // 先把遮盖框填实，之后才缩放进海报；输出是一整张像素图，遮住的内容恢复不了
  (masks || []).forEach(m => {
    g.fillStyle = m.color === 'white' ? '#fff' : '#000';
    g.fillRect(Math.floor(m.x * nw - sx), Math.floor(m.y * nh - sy), Math.ceil(m.w * nw) + 1, Math.ceil(m.h * nh) + 1);
  });
  return tmp;
}
function pstTextOf(st, t) { return t.key ? (st.fields[t.key] || '') : (t.text || ''); }
async function pstFonts(st) {
  const jobs = [];
  pstLayout.texts.forEach(t => { const s = pstTextOf(st, t); if (s) jobs.push(document.fonts.load(`${t.weight} 40px "${t.font}"`, s).catch(() => {})); });
  await Promise.all(jobs);
}
// 返回画好的 canvas，调用方用完要 canvas.width = 0 释放
async function pstRender(targetW, opts) {
  opts = opts || {};
  const st = opts.st || pstSt, L = pstLayout;   // opts.st：不开编辑器、直接按已保存的海报合成（海报管理页用）
  await pstFonts(st);
  const W = targetW, H = Math.round(W * L.ratio[1] / L.ratio[0]);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(pstBg, 0, 0, W, H);
  // 截图（遮盖后）放进 slot：contain、居中、空白填白、细黑框
  const sl = L.slot, sx = sl.x * W, sy = sl.y * H, sw = sl.w * W, sh = sl.h * H;
  g.fillStyle = sl.pad || '#fff'; g.fillRect(sx, sy, sw, sh);
  const src = opts.full ? st.img : st.small;
  if (src) {
    const tmp = pstMaskedCanvas(src, st.masks, st.crop);
    const k = Math.min(sw / tmp.width, sh / tmp.height);
    const dw = tmp.width * k, dh = tmp.height * k;
    g.drawImage(tmp, sx + (sw - dw) / 2, sy + (sh - dh) / 2, dw, dh);
    tmp.width = 0;
  }
  g.strokeStyle = sl.border || '#222'; g.lineWidth = Math.max(1, (sl.borderW || 0.0015) * W);
  g.strokeRect(sx, sy, sw, sh);
  // 文字：y 是垂直中心，size 占 H 的比例，超过 maxW 自动缩小
  L.texts.forEach(t => {
    const s = pstTextOf(st, t); if (!s) return;
    let px = t.size * H;
    const fam = `"${t.font}","Noto Sans SC","Noto Sans JP",sans-serif`;
    g.font = `${t.weight} ${px}px ${fam}`;
    const w = g.measureText(s).width, mw = t.maxW * W;
    if (w > mw) { px = px * mw / w; g.font = `${t.weight} ${px}px ${fam}`; }
    g.fillStyle = t.color; g.textAlign = t.align || 'center'; g.textBaseline = 'middle';
    g.fillText(s, t.x * W, t.y * H);
  });
  return cv;
}

// ── 预览（防抖 150ms）──
function pstRefresh() {
  clearTimeout(pstTimer);
  pstTimer = setTimeout(async () => {
    if (!pstSt) return;
    const cv = await pstRender(PST_PREVIEW_W);
    const box = document.getElementById('pst-prev'); if (!box) { cv.width = 0; return; }
    box.width = cv.width; box.height = cv.height;
    box.getContext('2d').drawImage(cv, 0, 0);
    cv.width = 0;
  }, 150);
}

// ── 打开编辑窗 ──
// kind = 'grad'（大学院，admission_results）| 'ug'（学部，undergrad_results）
const PST_TABLE = { grad: 'admission_results', ug: 'undergrad_results' };
const PST_FOLDER = { grad: 'grad', ug: 'ug' };
async function pstOpen(kind, resultId) {
  if (pstSt) return;
  kind = kind === 'ug' ? 'ug' : 'grad';
  let row = (typeof raPhGet === 'function' ? raPhGet(kind).rows : []).find(r => String(r.id) === String(resultId));
  raToast('正在打开海报编辑…');
  try {
    if (!row) {   // 不是从合格写真页进来的（例如海报管理页）：直接按编号读这条合格记录
      const r = await raSbFetch(`${PST_TABLE[kind]}?id=eq.${encodeURIComponent(resultId)}&select=*`).catch(() => []);
      row = r && r[0];
    }
    if (!row) { raToast('找不到这条合格记录', false); return; }
    await pstInit();
    const enc = encodeURIComponent;
    const posters = await raSbFetch(`pass_posters?result_kind=eq.${kind}&result_id=eq.${enc(row.id)}&select=*`).catch(() => null);
    if (posters === null) { raToast('读取海报表失败：请先执行 seed/pass_posters.sql', false); return; }
    const poster = posters[0] || null;
    let srcUrl = '';
    if (poster) { const s = await raSbFetch(`pass_poster_sources?poster_id=eq.${enc(poster.id)}&select=src_url`).catch(() => []); srcUrl = (s && s[0] && s[0].src_url) || ''; }
    srcUrl = srcUrl || await raArPhotoRef(kind, row);   // 私有桶路径（或迁移前的旧链接）
    // 默认值
    let en = '';
    if (!poster) {
      const e = await raSbFetch(`univ_en_names?univ_ja=eq.${enc((row.univ || '').trim())}&select=univ_en`).catch(() => []);
      en = (e && e[0] && e[0].univ_en) || '';
    }
    let major = (poster && poster.major) || row.our_major || '';
    if (!major && row.student_id) {
      const s = await raSbFetch(`students?id=eq.${enc(row.student_id)}&select=major`).catch(() => []);
      major = (s && s[0] && s[0].major) || '';
    }
    const now = new Date();
    const f = poster ? (poster.fields || {}) : {
      univ_ja: row.univ || '', univ_en: en,
      dept_line: kind === 'ug' ? [row.dept, row.spec].filter(Boolean).join('　') : (row.dept ? '大学院　' + row.dept : '大学院'),
      name_line: pstDefaultName(row.student),
    };
    pstSt = {
      kind, row, poster, srcUrl, img: null, small: null, imgErr: '',
      masks: poster ? (poster.masks || []) : [], crop: poster ? poster.crop : null,
      fields: Object.assign({ univ_ja: '', univ_en: '', dept_line: '', name_line: '', date_text: '' }, f),
      year: poster && poster.pass_year || now.getFullYear(), month: poster && poster.pass_month || (now.getMonth() + 1),
      major, color: 'black', mode: 'mask', sel: -1, drag: null,
    };
    pstBuildUi();
    await pstLoadSource();
  } catch (e) { pstSt = null; raToast('打开失败：' + e.message, false); }
}
function pstDefaultName(student) {
  student = (student || '').trim();
  if (!student) return '';
  if (typeof raArRealName === 'function' && !raArRealName(student)) return student;   // 已经是 A同学 这种缩写
  const ini = typeof pinyinInitialsOf === 'function' ? pinyinInitialsOf(Array.from(student)[0]) : null;
  const ch = ini ? String(ini)[0].toUpperCase() : '';
  return ch ? ch + '同学' : student;
}
async function pstLoadSource() {
  const st = pstSt; st.img = null; st.small = null; st.imgErr = '';
  try {
    if (!st.srcUrl) throw new Error('这条记录没有截图');
    const im = await pstLoadImg(await raArResolveSrc(st.srcUrl), true);   // 私有桶：先换临时链接；crossOrigin：不然画布不能导出
    st.img = im;
    const nw = im.naturalWidth, nh = im.naturalHeight, k = Math.min(1, PST_SMALL_EDGE / Math.max(nw, nh));
    const sm = document.createElement('canvas'); sm.width = Math.round(nw * k); sm.height = Math.round(nh * k);
    sm.getContext('2d').drawImage(im, 0, 0, sm.width, sm.height);
    st.small = sm;
  } catch (e) { st.imgErr = e.message || '图片加载失败'; }
  pstDrawEdit(); pstRefresh();
  const msg = document.getElementById('pst-imgmsg');
  if (msg) msg.textContent = st.imgErr ? st.imgErr + '。可以点「重新上传截图」。' : '';
}

// ── 界面 ──
function pstBuildUi() {
  document.getElementById('pst-overlay')?.remove();
  const st = pstSt, f = st.fields;
  const o = document.createElement('div');
  o.id = 'pst-overlay';
  o.className = 'ra-vars';   // 合格实绩页的颜色变量（弹层挂在 body 上，不在 #ra-root 里）
  o.style.cssText = 'position:fixed;inset:0;z-index:900;background:#f7f5f0;display:grid;grid-template-columns:minmax(260px,1fr) minmax(260px,1fr) 340px;gap:12px;padding:12px;overflow:hidden;font-family:inherit';
  const inp = 'width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-family:inherit;font-size:12px;background:#fff';
  const lab = 'font-size:10px;color:var(--text-muted);display:block;margin:8px 0 2px';
  const btn = 'padding:7px 12px;border:1px solid var(--border);background:#fff;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px';
  o.innerHTML = `
  <div style="display:flex;flex-direction:column;min-height:0">
    <div style="font-size:12px;font-weight:600;margin-bottom:6px">1. 遮盖隐私 / 裁切</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px" id="pst-tools"></div>
    <div id="pst-editwrap" style="flex:1;min-height:0;overflow:auto;background:#e8e5de;border:1px solid var(--border);border-radius:4px;display:flex;align-items:flex-start;justify-content:center;padding:6px">
      <canvas id="pst-edit" style="touch-action:none;cursor:crosshair;background:#fff"></canvas>
    </div>
    <div id="pst-imgmsg" style="font-size:11px;color:var(--red);margin-top:4px"></div>
    <div style="margin-top:4px"><button style="${btn}" onclick="document.getElementById('pst-reup').click()">重新上传截图</button>
      <input id="pst-reup" type="file" accept="image/*" style="display:none" onchange="pstReupload(this)"></div>
  </div>
  <div style="display:flex;flex-direction:column;min-height:0">
    <div style="font-size:12px;font-weight:600;margin-bottom:6px">2. 海报预览</div>
    <div style="flex:1;min-height:0;overflow:auto;background:#e8e5de;border:1px solid var(--border);border-radius:4px;display:flex;align-items:flex-start;justify-content:center;padding:6px">
      <canvas id="pst-prev" style="max-width:100%;max-height:100%;height:auto;background:#fff"></canvas>
    </div>
  </div>
  <div style="display:flex;flex-direction:column;min-height:0;overflow:auto">
    <div style="font-size:12px;font-weight:600">3. 信息 <span id="pst-state" style="font-weight:400;font-size:10px;color:var(--text-muted)"></span></div>
    <label style="${lab}">大学名（大字）</label><input style="${inp}" id="pst-f-univ_ja" value="${raArEsc(f.univ_ja)}" oninput="pstSetField('univ_ja',this.value)">
    <label style="${lab}">大学英文名 *（必填，会记住，下次自动带出）</label><input style="${inp}" id="pst-f-univ_en" value="${raArEsc(f.univ_en)}" oninput="pstSetField('univ_en',this.value)">
    <label style="${lab}">研究科行</label><input style="${inp}" id="pst-f-dept_line" value="${raArEsc(f.dept_line)}" oninput="pstSetField('dept_line',this.value)">
    <label style="${lab}">合格者（可改成 WU同学）</label><input style="${inp}" id="pst-f-name_line" value="${raArEsc(f.name_line)}" oninput="pstSetField('name_line',this.value)">
    <label style="${lab}">合格时间（年 / 月）</label>
    <div style="display:flex;gap:6px;align-items:center"><input style="${inp};width:80px" id="pst-year" type="number" value="${st.year}" oninput="pstSetDate()"><span>年</span><input style="${inp};width:60px" id="pst-month" type="number" min="1" max="12" value="${st.month}" oninput="pstSetDate()"><span>月</span></div>
    <label style="${lab}">本校专业 *（不上海报，老师端按它筛选）</label><div id="pst-major-box"></div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-top:14px">
      <button style="${btn};background:var(--accent);color:#fff;border-color:var(--accent)" onclick="pstSave(false)">保存</button>
      <button style="${btn};background:var(--accent);color:#fff;border-color:var(--accent)" onclick="pstSave(true)">保存并发布</button>
      <button style="${btn}" onclick="pstExportWeb()">下载网络版 JPG</button>
      <button style="${btn}" onclick="pstExportPdf()">下载印刷版 PDF</button>
      <button style="${btn}" onclick="pstClose()">关闭</button>
    </div>
    <div id="pst-busy" style="font-size:11px;color:var(--text-muted);margin-top:8px"></div>
  </div>`;
  document.body.appendChild(o);
  st.fields.date_text = `${st.year}年${st.month}月`;
  raArRenderMajor('pst', st.major);
  const mb = document.getElementById('pst-our-major'); if (mb) mb.addEventListener('change', () => { st.major = mb.value; });
  pstBuildTools();
  const cv = document.getElementById('pst-edit');
  cv.addEventListener('pointerdown', pstDown); cv.addEventListener('pointermove', pstMove);
  cv.addEventListener('pointerup', pstUp); cv.addEventListener('pointercancel', pstUp);
  document.addEventListener('keydown', pstKey);
  window.addEventListener('resize', pstDrawEdit);
  pstUpdateState();
}
function pstUpdateState() {
  const el = document.getElementById('pst-state'); if (!el) return;
  const p = pstSt.poster;
  el.textContent = p ? (p.web_url ? '（已保存 · 已发布）' : '（已保存 · 未发布）') : '（新海报）';
}
function pstBuildTools() {
  const st = pstSt; const box = document.getElementById('pst-tools'); if (!box) return;
  const chip = (on, label, fn) => `<span onclick="${fn}" style="padding:3px 10px;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : '#fff'};color:${on ? '#fff' : 'var(--text-secondary)'};border-radius:12px;font-size:11px;cursor:pointer">${label}</span>`;
  box.innerHTML = chip(st.mode === 'mask', '遮盖', "pstSetMode('mask')") + chip(st.mode === 'crop', '裁切', "pstSetMode('crop')")
    + '<span style="width:8px"></span>'
    + chip(st.color === 'black', '黑', "pstSetColor('black')") + chip(st.color === 'white', '白', "pstSetColor('white')")
    + '<span style="width:8px"></span>'
    + chip(false, '删除这个框', 'pstDelSel()') + chip(false, '清除全部', 'pstClearMasks()')
    + (st.crop ? chip(false, '取消裁切', 'pstClearCrop()') : '');
}
function pstSetMode(m) { pstSt.mode = m; pstBuildTools(); }
function pstSetColor(c) { const st = pstSt; st.color = c; if (st.sel >= 0 && st.masks[st.sel]) st.masks[st.sel].color = c; pstBuildTools(); pstDrawEdit(); pstRefresh(); }
function pstDelSel() { const st = pstSt; if (st.sel >= 0) { st.masks.splice(st.sel, 1); st.sel = -1; pstDrawEdit(); pstRefresh(); } }
function pstClearMasks() { if (pstSt.masks.length && confirm('清除全部遮盖框？')) { pstSt.masks = []; pstSt.sel = -1; pstDrawEdit(); pstRefresh(); } }
function pstClearCrop() { pstSt.crop = null; pstBuildTools(); pstDrawEdit(); pstRefresh(); }
function pstSetField(k, v) { pstSt.fields[k] = v; pstRefresh(); }
function pstSetDate() {
  const st = pstSt;
  st.year = parseInt(document.getElementById('pst-year').value, 10) || 0;
  st.month = parseInt(document.getElementById('pst-month').value, 10) || 0;
  st.fields.date_text = st.year && st.month ? `${st.year}年${st.month}月` : '';
  pstRefresh();
}
function pstKey(e) {
  if (!pstSt) return;
  const t = (e.target && e.target.tagName) || '';
  if (/INPUT|SELECT|TEXTAREA/.test(t)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); pstDelSel(); }
}
function pstClose() {
  if (pstBusy) return;
  document.removeEventListener('keydown', pstKey);
  window.removeEventListener('resize', pstDrawEdit);
  document.getElementById('pst-overlay')?.remove();
  const st = pstSt; pstSt = null;
  if (st) { if (st.small) st.small.width = 0; st.img = null; }
  if (typeof raLoadPhotos === 'function') raLoadPhotos(st ? st.kind : 'grad');
  if (typeof raPstOnClose === 'function') raPstOnClose(st);   // 海报管理页刷新列表用
}

// ── 左栏画布：显示原截图 + 遮盖框 ──
function pstDrawEdit() {
  const st = pstSt; const cv = document.getElementById('pst-edit'); if (!st || !cv) return;
  const wrap = document.getElementById('pst-editwrap');
  const g = cv.getContext('2d');
  if (!st.small) { cv.width = 300; cv.height = 200; g.fillStyle = '#fff'; g.fillRect(0, 0, 300, 200); g.fillStyle = '#9a9590'; g.font = '13px sans-serif'; g.fillText('没有可用的截图', 90, 105); return; }
  const aw = Math.max(200, wrap.clientWidth - 14), ah = Math.max(200, wrap.clientHeight - 14);
  const k = Math.min(aw / st.small.width, ah / st.small.height);
  const w = Math.round(st.small.width * k), h = Math.round(st.small.height * k);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  g.clearRect(0, 0, w, h);
  g.drawImage(st.small, 0, 0, w, h);
  st.masks.forEach((m, i) => {
    g.globalAlpha = 0.78; g.fillStyle = m.color === 'white' ? '#fff' : '#000'; g.fillRect(m.x * w, m.y * h, m.w * w, m.h * h); g.globalAlpha = 1;
    g.strokeStyle = i === st.sel ? '#e0482b' : '#2c4a8a'; g.lineWidth = i === st.sel ? 2 : 1; g.strokeRect(m.x * w, m.y * h, m.w * w, m.h * h);
    if (i === st.sel) { g.fillStyle = '#e0482b'; pstCorners(m).forEach(c => g.fillRect(c.x * w - 4, c.y * h - 4, 8, 8)); }
  });
  if (st.crop && st.crop.w > 0) {
    const c = st.crop;
    g.fillStyle = 'rgba(0,0,0,.4)';
    g.fillRect(0, 0, w, c.y * h); g.fillRect(0, (c.y + c.h) * h, w, h - (c.y + c.h) * h);
    g.fillRect(0, c.y * h, c.x * w, c.h * h); g.fillRect((c.x + c.w) * w, c.y * h, w - (c.x + c.w) * w, c.h * h);
    g.setLineDash([6, 4]); g.strokeStyle = '#1e90ff'; g.lineWidth = 2; g.strokeRect(c.x * w, c.y * h, c.w * w, c.h * h); g.setLineDash([]);
  }
}
function pstCorners(m) { return [{ n: 'tl', x: m.x, y: m.y }, { n: 'tr', x: m.x + m.w, y: m.y }, { n: 'bl', x: m.x, y: m.y + m.h }, { n: 'br', x: m.x + m.w, y: m.y + m.h }]; }
function pstPos(e) {
  const cv = document.getElementById('pst-edit'), r = cv.getBoundingClientRect();
  return { x: pstClamp((e.clientX - r.left) / r.width), y: pstClamp((e.clientY - r.top) / r.height) };
}
function pstDown(e) {
  const st = pstSt; if (!st || !st.small) return;
  const cv = e.target; cv.setPointerCapture(e.pointerId);
  const p = pstPos(e), r = cv.getBoundingClientRect();
  const hx = 9 / r.width, hy = 9 / r.height;
  if (st.mode === 'crop') { st.drag = { type: 'crop', x0: p.x, y0: p.y }; st.crop = { x: p.x, y: p.y, w: 0, h: 0 }; return; }
  if (st.sel >= 0 && st.masks[st.sel]) {
    const m = st.masks[st.sel];
    const c = pstCorners(m).find(c => Math.abs(c.x - p.x) < hx && Math.abs(c.y - p.y) < hy);
    if (c) { st.drag = { type: 'resize', corner: c.n, orig: { ...m } }; return; }
  }
  for (let i = st.masks.length - 1; i >= 0; i--) {
    const m = st.masks[i];
    if (p.x >= m.x && p.x <= m.x + m.w && p.y >= m.y && p.y <= m.y + m.h) {
      st.sel = i; st.drag = { type: 'move', dx: p.x - m.x, dy: p.y - m.y }; pstDrawEdit(); return;
    }
  }
  st.masks.push({ x: p.x, y: p.y, w: 0, h: 0, color: st.color });
  st.sel = st.masks.length - 1; st.drag = { type: 'new', x0: p.x, y0: p.y };
  pstDrawEdit();
}
function pstMove(e) {
  const st = pstSt; if (!st || !st.drag) return;
  const p = pstPos(e), d = st.drag;
  if (d.type === 'crop') { st.crop = { x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) }; }
  else {
    const m = st.masks[st.sel]; if (!m) return;
    if (d.type === 'new') { m.x = Math.min(d.x0, p.x); m.y = Math.min(d.y0, p.y); m.w = Math.abs(p.x - d.x0); m.h = Math.abs(p.y - d.y0); }
    else if (d.type === 'move') { m.x = pstClamp(Math.min(p.x - d.dx, 1 - m.w)); m.y = pstClamp(Math.min(p.y - d.dy, 1 - m.h)); if (m.x < 0) m.x = 0; if (m.y < 0) m.y = 0; }
    else if (d.type === 'resize') {
      const o = d.orig, fx = d.corner[1] === 'l' ? o.x + o.w : o.x, fy = d.corner[0] === 't' ? o.y + o.h : o.y;
      m.x = Math.min(fx, p.x); m.y = Math.min(fy, p.y); m.w = Math.abs(p.x - fx); m.h = Math.abs(p.y - fy);
    }
  }
  pstDrawEdit(); pstRefresh();
}
function pstUp() {
  const st = pstSt; if (!st || !st.drag) return;
  const d = st.drag; st.drag = null;
  if (d.type === 'new') { const m = st.masks[st.sel]; if (!m || m.w < 0.004 || m.h < 0.004) { st.masks.pop(); st.sel = -1; } }
  if (d.type === 'crop' && (!st.crop || st.crop.w < 0.02 || st.crop.h < 0.02)) st.crop = null;
  if (d.type === 'crop') pstBuildTools();
  pstDrawEdit(); pstRefresh();
}
async function pstReupload(inp) {
  const f = inp.files[0]; if (!f) return;
  const st = pstSt;
  if ((st.masks.length || st.crop) && !confirm('换了截图后，现有的遮盖框和裁切位置会清掉，继续？')) { inp.value = ''; return; }
  try {
    pstSetBusy('上传截图中…');
    const path = await raArUploadPhoto(f, PST_FOLDER[st.kind]);   // 管理员身份存到私有桶 admission-private/grad/… 或 ug/…
    const row = st.row;
    const note = raArStripNotePhoto(row.note) || null;
    await raArEnsurePhotoMap(st.kind);
    await raArSetPhoto(st.kind, row.id, path, row);   // 写 result_photos，删旧文件
    if (row.photo_url || raArStripNotePhoto(row.note) !== (row.note || '').trim()) {   // 迁移前的旧链接作废
      await raSbFetch(`${PST_TABLE[st.kind]}?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', body: { photo_url: null, note }, prefer: 'return=minimal', headers: {} });
    }
    row.photo_url = null; row.note = note;
    if (st.poster) await raSbFetch(`pass_poster_sources?poster_id=eq.${encodeURIComponent(st.poster.id)}`, { method: 'PATCH', body: { src_url: path }, prefer: 'return=minimal', headers: {} });   // 旧文件已删，来源指向新路径
    st.srcUrl = path; st.masks = []; st.crop = null; st.sel = -1;
    pstBuildTools();
    await pstLoadSource();
  } catch (e) { raToast('上传失败：' + e.message, false); }
  pstSetBusy('');
  inp.value = '';
}

// ── 保存 / 发布 / 导出 ──
function pstSetBusy(msg) { pstBusy = !!msg; const el = document.getElementById('pst-busy'); if (el) el.textContent = msg || ''; }
function pstDomainOf(major) { return ((typeof raArMajors !== 'undefined' ? raArMajors : []).find(m => m.key === major) || {}).domain || ''; }
function pstCheck() {
  const st = pstSt, f = st.fields;
  st.major = (typeof raArGetMajor === 'function' && raArGetMajor('pst')) || st.major;
  if (!(f.univ_en || '').trim()) { raToast('请填大学英文名', false); return false; }
  if (!st.major) { raToast('请选择本校专业', false); return false; }
  if (!st.year || st.month < 1 || st.month > 12) { raToast('请填写正确的合格年月', false); return false; }
  return true;
}
async function pstSave(publish) {
  if (pstBusy || !pstCheck()) return;
  const st = pstSt, row = st.row, enc = encodeURIComponent;
  try {
    pstSetBusy('保存中…');
    const body = {
      result_id: String(row.id), result_kind: st.kind, student_id: row.student_id || null,
      masks: st.masks, crop: st.crop, fields: st.fields,
      univ: row.univ || null, dept: row.dept || null, spec: row.spec || null,
      major: st.major, domain: pstDomainOf(st.major) || null,
      pass_year: st.year, pass_month: st.month, updated_at: new Date().toISOString(),
    };
    const res = await raSbFetch('pass_posters?on_conflict=result_kind,result_id', { method: 'POST', body, prefer: 'resolution=merge-duplicates,return=representation' });
    st.poster = Array.isArray(res) ? res[0] : res;
    await raSbFetch('pass_poster_sources?on_conflict=poster_id', { method: 'POST', body: { poster_id: st.poster.id, src_url: st.srcUrl }, prefer: 'resolution=merge-duplicates,return=minimal', headers: {} });
    const k = (row.univ || '').trim();
    if (k) await raSbFetch('univ_en_names?on_conflict=univ_ja', { method: 'POST', body: { univ_ja: k, univ_en: st.fields.univ_en.trim() }, prefer: 'resolution=merge-duplicates,return=minimal', headers: {} });
    if (publish) {
      pstSetBusy('生成并上传网络版…');
      Object.assign(st.poster, await pstPublishFiles(st, st.poster.id));
    }
    pstUpdateState();
    raToast(publish ? '✓ 已保存并发布' : '✓ 已保存');
  } catch (e) { raToast('保存失败：' + e.message, false); }
  pstSetBusy('');
}
// 生成网络版 JPG（1080）和缩略图（360）→ 上传 → 写 web_url / thumb_url；返回 { web_url, thumb_url }
async function pstPublishFiles(st, posterId) {
  const web = await pstRender(PST_WEB_W, { full: true, st }); const wb = await pstToBlob(web, 0.9); web.width = 0;
  const th = await pstRender(PST_THUMB_W, { st }); const tb = await pstToBlob(th, 0.8); th.width = 0;
  const base = `posters/${posterId}`;
  await pstUpload(`${base}/web.jpg`, wb); await pstUpload(`${base}/thumb.jpg`, tb);
  const v = '?v=' + Date.now(), pub = `${SB_URL}/storage/v1/object/public/${PST_BUCKET}/${base}`;
  const upd = { web_url: `${pub}/web.jpg${v}`, thumb_url: `${pub}/thumb.jpg${v}` };
  await raSbFetch(`pass_posters?id=eq.${encodeURIComponent(posterId)}`, { method: 'PATCH', body: upd, prefer: 'return=minimal', headers: {} });
  return upd;
}
async function pstUpload(path, blob) {
  const put = h => fetch(`${SB_URL}/storage/v1/object/${PST_BUCKET}/${path}`, { method: 'POST', headers: { ...h, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: blob });
  let r = await put(await raAuthHeaders());
  if (!r.ok) r = await put({ apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY });
  if (!r.ok) throw new Error('上传失败：' + (await r.text()).slice(0, 120));
}
async function pstExportWeb() {
  if (pstBusy || !pstCheck()) return;
  try {
    pstSetBusy('生成网络版…');
    const cv = await pstRender(PST_WEB_W, { full: true }); const b = await pstToBlob(cv, 0.9); cv.width = 0;
    pstDownload(b, pstFileName('jpg'));
  } catch (e) { raToast('导出失败：' + e.message, false); }
  pstSetBusy('');
}
function pstLoadJsPdf() {
  if (window.jspdf) return Promise.resolve();
  return new Promise((ok, ng) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = ok; s.onerror = () => ng(new Error('PDF 组件加载失败，请检查网络后重试'));
    document.head.appendChild(s);
  });
}
async function pstExportPdf() {
  if (pstBusy || !pstCheck()) return;
  if (!pstSt.img) { raToast('原截图没有加载成功，无法导出印刷版', false); return; }
  try {
    pstSetBusy('生成印刷版（较慢）…');
    await pstLoadJsPdf();
    const cv = await pstRender(PST_PRINT_W, { full: true });   // 截图用原图全分辨率
    const data = cv.toDataURL('image/jpeg', 0.95); cv.width = 0;
    const pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    pdf.addImage(data, 'JPEG', 0, 0, 210, 297);   // 整页一张 JPG，没有图层和文字
    pdf.save(pstFileName('pdf'));
  } catch (e) { raToast('导出失败：' + e.message, false); }
  pstSetBusy('');
}

// ── 删除合格记录 / 照片时一并删原截图和海报（原截图 + 海报行 + pass_poster_sources 行 + posters 文件夹里的两张图）──
// 学部没有外键，所以删合格记录前必须调用这个；ids 很多时（全件削除）只取一次海报列表再对照
async function pstDeleteForResults(kind, ids) {
  ids = (ids || []).map(String);
  if (!ids.length) return;
  await raArDeleteResultPhotos(kind, ids);   // 原截图：result_photos 行 + 私有桶文件
  const enc = encodeURIComponent;
  let ps;
  try {
    ps = ids.length === 1
      ? await raSbFetch(`pass_posters?result_kind=eq.${kind}&result_id=eq.${enc(ids[0])}&select=id,result_id`)
      : (await raSbFetch(`pass_posters?result_kind=eq.${kind}&select=id,result_id`) || []).filter(p => ids.includes(String(p.result_id)));
  } catch (e) { return; }   // 海报表还没建
  for (const p of (ps || [])) {
    await raSbFetch(`pass_poster_sources?poster_id=eq.${enc(p.id)}`, { method: 'DELETE', prefer: 'return=minimal', headers: {} }).catch(() => {});
    await raSbFetch(`pass_posters?id=eq.${enc(p.id)}`, { method: 'DELETE', prefer: 'return=minimal', headers: {} });
    for (const n of ['web.jpg', 'thumb.jpg']) {
      await fetch(`${SB_URL}/storage/v1/object/${PST_BUCKET}/posters/${p.id}/${n}`, { method: 'DELETE', headers: await raAuthHeaders() }).catch(() => {});
    }
  }
}

// ── 海报管理页用：不开编辑器，按已保存的海报在后台合成 / 发布 / 取消发布 ──
// 读海报的完整设置和未遮盖原图（原图在私有桶，只有管理员读得到；这里换成临时链接再加载），拼成和编辑器同样的状态
async function pstLoadState(poster) {
  await pstInit();
  const enc = encodeURIComponent;
  const full = (await raSbFetch(`pass_posters?id=eq.${enc(poster.id)}&select=*`))[0];
  if (!full) throw new Error('找不到这张海报');
  const kind = full.result_kind === 'ug' ? 'ug' : 'grad';
  let srcUrl = '';
  const s = await raSbFetch(`pass_poster_sources?poster_id=eq.${enc(full.id)}&select=src_url`).catch(() => []);
  srcUrl = (s && s[0] && s[0].src_url) || '';
  if (!srcUrl) { const r = await raSbFetch(`${PST_TABLE[kind]}?id=eq.${enc(full.result_id)}&select=id,note,photo_url`).catch(() => []); srcUrl = await raArPhotoRef(kind, r && r[0]); }
  if (!srcUrl) throw new Error('这张海报没有原截图');
  const im = await pstLoadImg(await raArResolveSrc(srcUrl), true);
  const k = Math.min(1, PST_SMALL_EDGE / Math.max(im.naturalWidth, im.naturalHeight));
  const sm = document.createElement('canvas'); sm.width = Math.round(im.naturalWidth * k); sm.height = Math.round(im.naturalHeight * k);
  sm.getContext('2d').drawImage(im, 0, 0, sm.width, sm.height);
  return { kind, row: { univ: full.univ, dept: full.dept, spec: full.spec }, poster: full, img: im, small: sm,
    masks: full.masks || [], crop: full.crop, fields: full.fields || {}, year: full.pass_year, month: full.pass_month, major: full.major };
}
function pstFreeState(st) { if (st && st.small) st.small.width = 0; if (st) st.img = null; }
// 网络版 JPG（1080）
async function pstWebBlobFor(poster) {
  const st = await pstLoadState(poster);
  try { const cv = await pstRender(PST_WEB_W, { full: true, st }); const b = await pstToBlob(cv, 0.9); cv.width = 0; return b; }
  finally { pstFreeState(st); }
}
// 大图预览用：返回一个 blob 链接（用完要 revokeObjectURL）
async function pstPreviewUrlFor(poster) { return URL.createObjectURL(await pstWebBlobFor(poster)); }
// 印刷版 PDF（A4，2480 宽，原图全分辨率；整页一张 JPG）
async function pstPdfBlobFor(poster) {
  await pstLoadJsPdf();
  const st = await pstLoadState(poster);
  try {
    const cv = await pstRender(PST_PRINT_W, { full: true, st });
    const data = cv.toDataURL('image/jpeg', 0.95); cv.width = 0;
    const pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    pdf.addImage(data, 'JPEG', 0, 0, 210, 297);
    return pdf.output('blob');
  } finally { pstFreeState(st); }
}
async function pstDownloadPdfFor(poster) {
  const st = await pstLoadState(poster);
  const name = pstFileName('pdf', st); pstFreeState(st);
  pstDownload(await pstPdfBlobFor(poster), name);
}
async function pstPublishFor(poster) {
  const st = await pstLoadState(poster);
  try { const upd = await pstPublishFiles(st, poster.id); Object.assign(poster, upd); return upd; } finally { pstFreeState(st); }
}
// 取消发布：清空 web_url / thumb_url，删掉两张图；海报的设置保留
async function pstUnpublishFor(poster) {
  await raSbFetch(`pass_posters?id=eq.${encodeURIComponent(poster.id)}`, { method: 'PATCH', body: { web_url: null, thumb_url: null }, prefer: 'return=minimal', headers: {} });
  for (const n of ['web.jpg', 'thumb.jpg']) {
    await fetch(`${SB_URL}/storage/v1/object/${PST_BUCKET}/posters/${poster.id}/${n}`, { method: 'DELETE', headers: await raAuthHeaders() }).catch(() => {});
  }
  poster.web_url = null; poster.thumb_url = null;
}
async function pstRemoveFor(poster) { await pstDeleteForResults(poster.result_kind === 'ug' ? 'ug' : 'grad', [poster.result_id]); }
