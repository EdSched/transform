// 作业批改共用部分（老师端「作业批改」/ 管理端「出席・作业」共用）：
// 照片旋转与放大、整合答卷（thwPaperHtml）、批改表单、保存批改（homework_submissions.feedbacks）、上传批改文件、随堂作业批改。
// 署名 hwrMe()：老师端 = 老师名，管理端 = 「管理员」。老师端的课次列表 / 打印 / 导出 Word 仍在 teacher/teacher-homework.js。
// 依赖：shared/supabase.js（sb / sbUpload）、shared/constants.js（hwFeedbacks / hwFeedbackCardsHtml / hwGradedBy）、fmtJst（两端各自有）
const HWR = { reg: {} };   // 提交 id → 提交对象（旋转 / 放大用）
let thwPendingFile = null;   // 本次批改待保存的批改文件 {url, name}
function thwEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function hwrMe() { return (typeof teacherData !== 'undefined' && teacherData && teacherData.name) || '管理员'; }
// 按 id 找回提交：先看登记过的（渲染时登记），再看老师端自己的列表
function hwrSubById(id) {
  if (HWR.reg[id]) return HWR.reg[id];
  let x = null;
  if (typeof thwSubs !== 'undefined' && typeof thwOpenSession !== 'undefined') x = (thwSubs[thwOpenSession] || []).find(y => y.id === id);
  if (!x && typeof thwIc !== 'undefined' && typeof thwIcOpen !== 'undefined') x = (thwIc.subs[thwIcOpen] || []).find(y => y.id === id);
  return x || null;
}

// ── 照片旋转：im.rotate = 0/90/180/270，存在 homework_submissions.answers 的图片对象里 ──
const thwRotNorm = r => (((parseInt(r) || 0) % 360) + 360) % 360;
// 电脑端（≥768px）：不放大时图片按预览区可用宽度铺满（最宽 900px），不限高度；手机端不变
(function () {
  if (document.getElementById('thw_fit_css')) return;
  const st = document.createElement('style'); st.id = 'thw_fit_css';
  st.textContent = '@media (min-width:768px){.thw-fit[data-rot="0"],.thw-fit[data-rot="180"]{display:block!important;width:100%!important;max-width:900px!important}'
    + '.thw-fit[data-rot="0"] img,.thw-fit[data-rot="180"] img{width:100%!important;height:auto!important;max-width:100%!important;max-height:none!important}}';
  document.head.appendChild(st);
})();
const thwDesktop = () => window.matchMedia && window.matchMedia('(min-width:768px)').matches;
const THW_ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3];
const thwZ = {};   // 放大缩小只影响当前查看，不保存：{ [图片框 id]: { z, ... } }
function thwRotImg(subId, ai, i, im, forPrint, imgStyle) {
  const rot = thwRotNorm(im.rotate), side = rot === 90 || rot === 270;
  const id = `thwimg_${subId}_${ai}_${i}`;
  const wrap = side
    ? `display:flex;align-items:center;justify-content:center;width:100%;${forPrint ? 'height:440px' : ''}`
    : 'display:inline-block;max-width:100%';
  if (forPrint) return `<div id="${id}" data-rot="${rot}" style="position:relative;${wrap}"><img src="${thwEsc(im.url)}" width="440" style="${imgStyle}${rot ? `;transform:rotate(${rot}deg)` : ''}"></div>`;
  const btn = (js, t) => `<span onclick="${js}" style="cursor:pointer;background:rgba(0,0,0,.55);color:#fff;border-radius:3px;padding:1px 7px;font-size:13px;line-height:1.5;user-select:none">${t}</span>`;
  const ctl = `<div style="position:absolute;top:10px;right:6px;z-index:2;display:flex;gap:4px;align-items:center">${btn(`thwRotate('${subId}',${ai},${i},-90)`, '↺')}${btn(`thwRotate('${subId}',${ai},${i},90)`, '↻')}${btn(`thwZoomStep('${id}',1)`, '＋')}<span id="${id}_pct" style="background:rgba(0,0,0,.55);color:#fff;border-radius:3px;padding:1px 5px;font-size:11px;line-height:1.7;min-width:34px;text-align:center;user-select:none">100%</span>${btn(`thwZoomStep('${id}',-1)`, '－')}${btn(`thwZoomSet('${id}',1)`, '1:1')}</div>`;
  return `<div id="${id}" class="thw-fit" data-rot="${rot}" style="position:relative;${wrap}">${ctl}<div id="${id}_s" style="display:contents"><div id="${id}_g" style="display:contents"><img src="${thwEsc(im.url)}" onload="thwFitRot('${id}');thwBindPan('${id}')" onclick="thwImgClick(event,'${subId}',${ai},${i})" style="${imgStyle}${rot ? `;transform:rotate(${rot}deg)` : ''};cursor:zoom-in"></div></div></div>`;
}
// 横向时外框高度 = 图片显示宽度，避免和下面的内容重叠
function thwFitRot(id) {
  const w = document.getElementById(id); if (!w) return;
  if (thwZ[id] && thwZ[id].z !== 1) return;
  const img = w.querySelector('img'), rot = parseInt(w.dataset.rot) || 0, side = rot === 90 || rot === 270;
  // 电脑端横向：旋转后的可见宽度 = 可用宽度（图片排版高度取该宽度，外框高度 = 图片排版宽度）
  if (side && thwDesktop()) {
    const aw = Math.min(900, w.parentElement.clientWidth || 900);
    img.style.width = 'auto'; img.style.height = aw + 'px'; img.style.maxWidth = 'none'; img.style.maxHeight = 'none';
    w.style.maxWidth = '900px';
  } else {
    img.style.width = img.style.height = ''; img.style.maxWidth = '100%'; img.style.maxHeight = '60vh'; img.style.width = 'auto';
    w.style.maxWidth = '';
  }
  w.style.height = side ? (img.offsetWidth + 'px') : '';
}
// 不放大时的外框样式（和旋转逻辑一致）
function thwWrapStyle(w, rot) {
  const side = rot === 90 || rot === 270;
  w.dataset.rot = rot;
  w.style.display = side ? 'flex' : 'inline-block';
  w.style.alignItems = w.style.justifyContent = side ? 'center' : '';
  w.style.width = side ? '100%' : '';
  w.style.height = '';
  w.style.overflow = '';
}
// 放大 / 缩小：外框大小不变，图片在框里滚动。z=1 时回到原来的显示方式。
function thwZoomApply(id) {
  const w = document.getElementById(id); if (!w) return;
  const st = thwZ[id] || (thwZ[id] = { z: 1 });
  const sc = document.getElementById(id + '_s'), stg = document.getElementById(id + '_g'), img = w.querySelector('img');
  const rot = parseInt(w.dataset.rot) || 0, side = rot === 90 || rot === 270;
  const pct = document.getElementById(id + '_pct'); if (pct) pct.textContent = Math.round(st.z * 100) + '%';
  if (st.z === 1) {
    if (!st.on) return;
    st.on = false; w.classList.add('thw-fit');
    sc.style.cssText = 'display:contents'; stg.style.cssText = 'display:contents';
    img.setAttribute('style', st.imgCss);
    img.style.transform = rot ? `rotate(${rot}deg)` : '';
    thwWrapStyle(w, rot); thwFitRot(id);
    return;
  }
  if (!st.on) {
    st.on = true;
    st.imgCss = img.getAttribute('style');
    st.bw = img.offsetWidth; st.bh = img.offsetHeight;   // 先量（铺满后的大小就是 100%），再去掉铺满样式
    w.classList.remove('thw-fit');
    const vw = side ? st.bh : st.bw, vh = side ? st.bw : st.bh;
    st.fw = Math.min(vw, w.parentElement.clientWidth || vw); st.fh = vh;
  }
  w.style.cssText = `position:relative;display:block;width:${st.fw}px;height:${st.fh}px;max-width:100%;overflow:hidden`;
  sc.style.cssText = 'display:flex;width:100%;height:100%;overflow:auto;touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch';
  const iw = st.bw * st.z, ih = st.bh * st.z;
  stg.style.cssText = `flex:none;margin:auto;position:relative;width:${side ? ih : iw}px;height:${side ? iw : ih}px`;
  img.setAttribute('style', `position:absolute;left:50%;top:50%;width:${iw}px;height:${ih}px;max-width:none;max-height:none;margin:0;box-sizing:border-box;border:1px solid var(--border-light);transform:translate(-50%,-50%) rotate(${rot}deg);cursor:grab`);
}
function thwZoomSet(id, z) {
  const st = thwZ[id] || (thwZ[id] = { z: 1 });
  st.z = Math.max(0.5, Math.min(3, z));
  if (Math.abs(st.z - 1) < 0.02) st.z = 1;
  thwZoomApply(id);
}
function thwZoomNext(z, dir) {
  const L = THW_ZOOMS;
  return dir > 0 ? (L.find(x => x > z + 0.01) || L[L.length - 1]) : ([...L].reverse().find(x => x < z - 0.01) || L[0]);
}
function thwZoomStep(id, dir) { thwZoomSet(id, thwZoomNext((thwZ[id] || { z: 1 }).z, dir)); }
// 电脑上按住拖动、手机上双指缩放（单指拖动靠浏览器自带滚动）
function thwBindPan(id, el, getZ, setZ, onTap) {
  el = el || document.getElementById(id + '_s');
  if (!el || el._thwBound) return;
  getZ = getZ || (() => (thwZ[id] || { z: 1 }).z);
  setZ = setZ || (z => thwZoomSet(id, z));
  el._thwBound = true;
  let drag = null, moved = false, pinch = null;
  el.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop }; moved = false;
    if (getZ() !== 1) e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) moved = true;
    el.scrollLeft = drag.l - (e.clientX - drag.x); el.scrollTop = drag.t - (e.clientY - drag.y);
  });
  window.addEventListener('mouseup', () => { drag = null; });
  el._thwWasDrag = () => moved;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  el.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = { d: dist(e.touches), z: getZ() }; }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinch) { e.preventDefault(); setZ(pinch.z * dist(e.touches) / pinch.d); }
  }, { passive: false });
  el.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; }, { passive: true });
}
// 点图片：全屏黑底大图（可放大缩小、旋转、左右切换同一份作业的其他照片）
function thwImgClick(ev, subId, ai, i) {
  const sc = document.getElementById(`thwimg_${subId}_${ai}_${i}_s`);
  if (sc && sc._thwWasDrag && sc._thwWasDrag()) return;
  const sub = hwrSubById(subId); if (!sub) return;
  const list = []; let idx = 0;
  (sub.answers || []).forEach((a, x) => (a.images || []).forEach((im, y) => {
    if (im.kind === 'doc') return;
    if (x === ai && y === i) idx = list.length;
    list.push({ url: im.url, rot: thwRotNorm(im.rotate) });
  }));
  thwLightbox(list, idx);
}
function thwLightbox(list, idx) {
  const old = document.getElementById('thw_lb'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'thw_lb';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#000;color:#fff;display:flex;flex-direction:column';
  const b = 'cursor:pointer;background:rgba(255,255,255,.18);border-radius:3px;padding:3px 10px;font-size:15px;user-select:none';
  ov.innerHTML = `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;padding:8px 10px;flex:none">
    <span id="thw_lb_n" style="margin-right:auto;font-size:12px;opacity:.8"></span>
    <span data-a="prev" style="${b}">‹</span><span data-a="next" style="${b}">›</span>
    <span data-a="rl" style="${b}">↺</span><span data-a="rr" style="${b}">↻</span>
    <span data-a="in" style="${b}">＋</span><span id="thw_lb_p" style="font-size:12px;min-width:38px;text-align:center"></span><span data-a="out" style="${b}">－</span><span data-a="one" style="${b}">1:1</span>
    <span data-a="x" style="${b};margin-left:8px">×</span></div>
    <div id="thw_lb_s" style="flex:1;min-height:0;display:flex;overflow:auto;touch-action:pan-x pan-y"><div id="thw_lb_g" style="flex:none;margin:auto;position:relative"><img id="thw_lb_i" style="position:absolute;left:50%;top:50%;max-width:none;user-select:none;-webkit-user-drag:none;cursor:grab" draggable="false"></div></div>`;
  document.body.appendChild(ov);
  const sc = ov.querySelector('#thw_lb_s'), stg = ov.querySelector('#thw_lb_g'), img = ov.querySelector('#thw_lb_i');
  const S = { z: 1, rot: 0 };
  const draw = () => {
    const side = S.rot === 90 || S.rot === 270, nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
    const aw = sc.clientWidth, ah = sc.clientHeight;
    const fit = Math.min(1, side ? Math.min(aw / nh, ah / nw) : Math.min(aw / nw, ah / nh));
    const iw = nw * fit * S.z, ih = nh * fit * S.z;
    stg.style.width = (side ? ih : iw) + 'px'; stg.style.height = (side ? iw : ih) + 'px';
    img.style.width = iw + 'px'; img.style.height = ih + 'px';
    img.style.transform = `translate(-50%,-50%) rotate(${S.rot}deg)`;
    ov.querySelector('#thw_lb_p').textContent = Math.round(S.z * 100) + '%';
  };
  const show = n => {
    idx = (n + list.length) % list.length; S.z = 1; S.rot = list[idx].rot;
    ov.querySelector('#thw_lb_n').textContent = `${idx + 1} / ${list.length}`;
    img.onload = draw; img.src = list[idx].url; sc.scrollLeft = sc.scrollTop = 0; draw();
  };
  const setZ = z => { S.z = Math.max(0.5, Math.min(5, z)); draw(); };
  const act = a => {
    if (a === 'x') return close();
    if (a === 'prev') return show(idx - 1);
    if (a === 'next') return show(idx + 1);
    if (a === 'rl') S.rot = thwRotNorm(S.rot - 90);
    else if (a === 'rr') S.rot = thwRotNorm(S.rot + 90);
    else if (a === 'in') S.z = Math.min(5, thwZoomNext(S.z, 1) === S.z ? S.z * 1.5 : thwZoomNext(S.z, 1));
    else if (a === 'out') S.z = thwZoomNext(S.z, -1);
    else if (a === 'one') S.z = 1;
    draw();
  };
  const onKey = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') act('prev');
    else if (e.key === 'ArrowRight') act('next');
    else if (e.key === '+' || e.key === '=') act('in');
    else if (e.key === '-') act('out');
  };
  function close() { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', draw); ov.remove(); }
  ov.addEventListener('click', e => { const a = e.target.getAttribute && e.target.getAttribute('data-a'); if (a) act(a); });
  document.addEventListener('keydown', onKey); window.addEventListener('resize', draw);
  thwBindPan('', sc, () => S.z, setZ);
  if (list.length < 2) ov.querySelectorAll('[data-a=prev],[data-a=next]').forEach(x => x.style.display = 'none');
  show(idx);
}
const thwRotTimers = {};
function thwRotate(subId, ai, i, d) {
  const sub = hwrSubById(subId);
  const im = sub && sub.answers && sub.answers[ai] && (sub.answers[ai].images || [])[i];
  if (!im) return;
  im.rotate = thwRotNorm((im.rotate || 0) + d);
  const w = document.getElementById(`thwimg_${subId}_${ai}_${i}`);
  if (w) {
    thwWrapStyle(w, im.rotate);
    w.querySelector('img').style.transform = im.rotate ? `rotate(${im.rotate}deg)` : '';
    thwFitRot(w.id);
    thwZoomApply(w.id);
  }
  // 稍等一下再保存（连点几次只存一次）；保存失败只在本次预览里生效，不打扰老师
  clearTimeout(thwRotTimers[subId]);
  thwRotTimers[subId] = setTimeout(() => { sb(`/rest/v1/homework_submissions?id=eq.${subId}`, 'PATCH', { answers: sub.answers }).catch(() => {}); }, 600);
}
// Word 不认 CSS 旋转：只把转过的图片用 canvas 转好（失败 / 跨域读不出就退回原图）
function thwRotateDataUrl(url, rot) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const sc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
        const side = rot === 90 || rot === 270;
        const cv = document.createElement('canvas');
        cv.width = side ? h : w; cv.height = side ? w : h;
        const ctx = cv.getContext('2d');
        ctx.translate(cv.width / 2, cv.height / 2);
        ctx.rotate(rot * Math.PI / 180);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
async function thwRotatedMap(subs) {
  const map = {}, jobs = [];
  subs.forEach(sub => (sub.answers || []).forEach(a => (a.images || []).forEach(im => {
    const rot = thwRotNorm(im.rotate), key = im.url + '|' + rot;
    if (!rot || im.kind === 'doc' || key in map) return;
    map[key] = null;
    jobs.push(thwRotateDataUrl(im.url, rot).then(d => { map[key] = d; }));
  })));
  await Promise.all(jobs);
  return map;
}

// ── 整合答卷：按作答单元顺序展示（题目 + 文字答案 + 顺序照片） ──
function thwPaperHtml(s, sub, forPrint) {
  HWR.reg[sub.id] = sub;   // 旋转 / 放大按 id 找回这份提交（同一个对象，旋转结果直接写进去）
  const imgStyle = forPrint
    ? 'max-width:100%;max-height:16cm;width:auto;height:auto;display:block;margin:6px 0;border:1px solid #ddd'
    : 'max-width:100%;max-height:60vh;width:auto;display:block;margin:6px 0;border:1px solid var(--border-light);border-radius:2px';
  const answers = sub.answers || [];
  // 按 head 分组保持题型区块结构
  const groups = [];
  answers.forEach((a, ai) => {
    const label = a.label || a.k || '';
    const sp = label.indexOf(' ');
    const head = sp > 0 ? label.slice(0, sp) : '';
    let sub2 = sp > 0 ? label.slice(sp + 1) : label;
    if (sub2 === '作答') sub2 = '';  // 整块统一作答：不重复显示「作答」二字
    if (sub2 === '整题') sub2 = '手写作答';  // 名词解释的整块图片
    let g = groups.find(x => x.head === head);
    if (!g) { g = { head, items: [] }; groups.push(g); }
    g.items.push({ ...a, sub: sub2, _ai: ai });
  });
  return `
  ${forPrint ? `<div style="border-bottom:2px solid #5a3e28;padding-bottom:8px;margin-bottom:14px">
    <div style="font-size:16px;font-weight:700">${thwEsc(sub.student_name)} — ${thwEsc(s.course_name||'')} 第${s.session_number||''}回 作业${sub.level?`（${thwEsc(sub.level)}级）`:''}</div>
    <div style="font-size:11px;color:#666;margin-top:3px">${s.session_date||''}${s.session_title?' · '+thwEsc(s.session_title):''}　提交时间：${fmtJst(sub.submitted_at)}</div>
  </div>` : ''}
  ${sub.whole_file_url ? `<div style="font-size:11px;margin-bottom:10px">📎 学生上传的整份作业：<a href="${thwEsc(sub.whole_file_url)}" target="_blank" style="color:#5a3e28">下载查看</a></div>` : ''}
  ${groups.map(g => `<div style="margin-bottom:${forPrint?'16px':'12px'}">
    ${g.head ? `<div style="font-size:${forPrint?'13px':'12px'};font-weight:700;margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid ${forPrint?'#ccc':'var(--border-light)'}">${thwEsc(g.head)}</div>` : ''}
    ${g.items.every(it => !(it.images||[]).length && !(it.q||'') && (it.text||'').length <= 8)
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:4px">
          ${g.items.map(it => `<div style="font-size:11px"><span style="color:#999">${thwEsc(it.sub)}</span> <b>${thwEsc(it.text||'—')}</b></div>`).join('')}
        </div>`
      : g.items.map(it => `<div style="margin-bottom:${forPrint?'12px':'8px'};page-break-inside:avoid">
          ${(it.sub||it.q)?`<div style="font-size:${forPrint?'12px':'11.5px'};font-weight:600;margin-bottom:3px">${thwEsc(it.sub)}${it.q?` <span style="font-weight:400">${thwEsc(it.q)}</span>`:''}</div>`:''}
          ${it.text ? `<div style="font-size:${forPrint?'12px':'11.5px'};line-height:1.9;white-space:pre-wrap;padding:6px 8px;background:${forPrint?'#fafafa':'var(--surface)'};border-radius:2px">${thwEsc(it.text)}</div>` : ''}
          ${(it.images||[]).map((im, i) => im.kind==='doc'
            ? `<div style="font-size:11px;margin-top:4px">📎 <a href="${thwEsc(im.url)}" target="_blank" style="color:#5a3e28">${thwEsc(im.name||'附件')}</a></div>`
            : `<div><div style="font-size:9px;color:#999;margin-top:4px">${thwEsc(it.sub)} · 图${i+1}</div>${thwRotImg(sub.id, it._ai, i, im, forPrint, imgStyle)}</div>`).join('')}
          ${!it.text && !(it.images||[]).length ? `<div style="font-size:11px;color:#aaa">（未作答）</div>` : ''}
        </div>`).join('')}
  </div>`).join('')}`;
}


async function thwUploadFile(subId, input) {
  const f = input.files[0];
  if (!f) return;
  const tip = document.getElementById('thw_file_tip');
  if (tip) tip.textContent = '上传中…';
  try {
    const ext = (f.name.split('.').pop() || 'docx').toLowerCase().replace(/[^a-z0-9]/g, '') || 'docx';
    const url = await sbUpload('teacher-files', `hw/${subId}-${Date.now()}.${ext}`, f);
    thwPendingFile = { url, name: f.name };   // 点「保存」时写进我的这条批改
    if (tip) tip.textContent = '✓ 已上传批改文件（保存后生效）';
  } catch (e) { if (tip) tip.textContent = '上传失败：' + e.message; }
  input.value = '';
}


function thwIcImgsHtml(sub, big) {
  const imgs = Array.isArray(sub.images) ? sub.images : [];
  const sz = big ? 'max-width:100%;max-height:360px' : 'width:56px;height:56px;object-fit:cover';
  return imgs.map((im, i) => `<img src="${thwEsc(big ? im.url : (im.thumb || im.url))}" onclick="event.stopPropagation();thwIcView('${sub.id}',${i})" style="${sz};border-radius:3px;border:1px solid var(--border-light);cursor:zoom-in" loading="lazy">`).join('');
}
function thwIcView(subId, idx) {   // 放大、旋转：沿用作业的查看器
  const sub = hwrSubById(subId);
  const imgs = (sub && sub.images) || [];
  if (imgs.length) thwLightbox(imgs.map(im => ({ url: im.url, rot: thwRotNorm(im.rotate) })), idx);
}

// 多位老师共同批改：每位老师一条（feedbacks 追加；自己的那条可修改），旧字段同步写入最新一条，兼容别处的读取
// 保存成功返回 true（提示 / 刷新由调用方处理）
async function hwrSaveFeedback(sub, table) {
  const g = id => ((document.getElementById(id) || {}).value || '').trim();
  const know = g('thw_know'), att = g('thw_att'), sug = g('thw_sug'), score = g('thw_score');
  if (!know && !att && !sug) { alert('请至少填写一项反馈'); return false; }
  const me = hwrMe(), now = new Date().toISOString();
  const list = hwFeedbacks(sub).map(f => Object.assign({}, f));
  let mine = null;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].by === me) { mine = list[i]; break; }
  const fields = { knowledge: know, attitude: att, suggestions: sug, score, text: '' };
  if (thwPendingFile) { fields.file_url = thwPendingFile.url; fields.file_name = thwPendingFile.name; }
  if (mine) Object.assign(mine, fields, { edited_at: now });
  else list.push(Object.assign({ id: 'fb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), by: me, at: now, file_url: '', file_name: '' }, fields));
  if (mine && mine.id === 'legacy') mine.id = 'fb-legacy';
  const latest = list.slice().sort((a, b) => String(a.edited_at || a.at || '').localeCompare(String(b.edited_at || b.at || ''))).pop();
  const legacy = {
    feedback_knowledge: latest.knowledge || null, feedback_attitude: latest.attitude || null, feedback_suggestions: latest.suggestions || null,
    teacher_feedback: [latest.knowledge && '知识掌握：' + latest.knowledge, latest.attitude && '学习态度：' + latest.attitude, latest.suggestions && '改进建议：' + latest.suggestions].filter(Boolean).join('\n') || latest.text || '',
    score: latest.score || null, graded_by: latest.by, graded_at: latest.edited_at || latest.at,
  };
  if (latest.file_url) legacy.teacher_file_url = latest.file_url;
  try {
    let patch = Object.assign({ feedbacks: list }, legacy);
    try { await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(sub.id)}`, 'PATCH', patch); }
    catch (e) {
      // feedbacks 字段还没建（SQL 未执行）时，退回只写旧字段
      if (!/feedbacks/.test(e.message)) throw e;
      patch = legacy;
      await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(sub.id)}`, 'PATCH', patch);
    }
    Object.assign(sub, patch);
    thwPendingFile = null;
    return true;
  } catch (e) { alert('保存失败：' + e.message); return false; }
}
// 随堂作业批改（inclass_submissions）：评语 + 分数，每位老师一条，可改自己的
async function hwrIcSaveFeedback(sub) {
  const text = ((document.getElementById('thw_ic_text') || {}).value || '').trim();
  const score = ((document.getElementById('thw_ic_score') || {}).value || '').trim();
  if (!text && !score) { alert('请写评语或分数'); return false; }
  const me = hwrMe(), now = new Date().toISOString();
  const list = hwFeedbacks(sub).map(f => Object.assign({}, f));
  let mine = null;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].by === me) { mine = list[i]; break; }
  if (mine) Object.assign(mine, { text, score, edited_at: now });
  else list.push({ id: 'fb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), by: me, at: now, text, score });
  try {
    await sb(`/rest/v1/inclass_submissions?id=eq.${encodeURIComponent(sub.id)}`, 'PATCH', { feedbacks: list });
    sub.feedbacks = list;
    return true;
  } catch (e) { alert('保存失败：' + e.message); return false; }
}

// 批改表单：已有批改卡片 + 我的批改（知识掌握 / 学习态度 / 改进建议 / 分数 / 上传批改文件）
function hwrFeedbackBlockHtml(sub) {
  return `    <div style="margin-top:12px;border-top:1px solid var(--border-light);padding-top:10px">
      ${(() => {
        const all = hwFeedbacks(sub);
        return all.length ? `<div style="font-size:11px;font-weight:600;margin-bottom:6px">已有批改（${all.length}）</div>${hwFeedbackCardsHtml(all, { mine: hwrMe() })}` : '';
      })()}
      ${(() => {
        const mine = hwFeedbacks(sub).filter(f => f.by === hwrMe()).pop() || null;
        const v = k => thwEsc(mine ? (mine[k] || '') : '');
        const hasFile = thwPendingFile || (mine && mine.file_url);
        return `<div style="font-size:11px;font-weight:600;margin:8px 0">${mine ? '✍ 编辑我的批改（学生可见）' : '✍ 添加我的批改（学生可见）'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">📚 知识掌握情况</label>
          <textarea id="thw_know" rows="3" placeholder="例：基本概念掌握扎实，第3题的模型推导仍有偏差" style="width:100%;font-size:11px;line-height:1.8;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${v('knowledge')}</textarea></div>
        <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">🧭 学习态度</label>
          <textarea id="thw_att" rows="3" placeholder="例：书写工整、按时提交；部分题目略显敷衍" style="width:100%;font-size:11px;line-height:1.8;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${v('attitude')}</textarea></div>
      </div>
      <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">💡 改进建议 / 下一步</label>
      <textarea id="thw_sug" rows="3" placeholder="例：建议复习教材第4章，下次作业前完成过去问2015年第2题" style="width:100%;font-size:11px;line-height:1.8;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical;margin-bottom:8px">${v('suggestions')}</textarea>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="thw_score" value="${v('score')}" placeholder="评价/分数（可选）" style="font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;width:140px">
        <label style="font-size:10px;color:var(--accent);cursor:pointer;border:1px solid var(--border);border-radius:2px;padding:5px 12px">📎 上传批改文件（可带批注的 Word）
          <input type="file" accept=".doc,.docx,.pdf,image/*" style="display:none" onchange="thwUploadFile('${sub.id}', this)"></label>
        <span id="thw_file_tip" style="font-size:10px;color:var(--text-3)">${hasFile ? '✓ 已上传批改文件' + (thwPendingFile ? '（保存后生效）' : '') : ''}</span>
        <button onclick="thwSaveFeedback('${sub.id}')" style="margin-left:auto;font-size:12px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:3px;padding:7px 20px;cursor:pointer;font-family:inherit">${mine ? '保存修改' : '保存我的批改'}</button>
      </div>`;
      })()}
    </div>`;
}
// 随堂作业的批改表单（all = 已有批改，mine = 我的那条）
function hwrIcFeedbackBlockHtml(sub, all, mine) {
  HWR.reg[sub.id] = sub;
  return `    <div style="margin-top:12px;border-top:1px solid var(--border-light);padding-top:10px">
      ${all.length ? `<div style="font-size:11px;font-weight:600;margin-bottom:6px">已有批改（${all.length}）</div>${hwFeedbackCardsHtml(all, { mine: hwrMe() })}` : ''}
      <div style="font-size:11px;font-weight:600;margin:8px 0">${mine ? '编辑我的批改（学生可见）' : '添加我的批改（学生可见）'}</div>
      <textarea id="thw_ic_text" rows="4" placeholder="评语" style="width:100%;font-size:11px;line-height:1.8;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical;margin-bottom:8px;box-sizing:border-box">${thwEsc(mine ? (mine.text || '') : '')}</textarea>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="thw_ic_score" value="${thwEsc(mine ? (mine.score || '') : '')}" placeholder="分数（可选）" style="font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;width:120px">
        <button onclick="thwIcSave('${sub.id}')" style="margin-left:auto;font-size:12px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:3px;padding:7px 20px;cursor:pointer;font-family:inherit">${mine ? '保存修改' : '保存我的批改'}</button>
      </div>
    </div>`;
}

// ── 管理端用：弹窗里批改一份提交（作业 kind='hw' / 随堂作业 kind='ic'），署名「管理员」 ──
let hwrModal = null;   // { kind, sid, sub, s, after }
function hwrOpenModal(kind, s, sub, after) {
  hwrModal = { kind, sub, s, after }; thwPendingFile = null; HWR.reg[sub.id] = sub;
  document.getElementById('hwrModal')?.remove();
  const m = document.createElement('div');
  m.id = 'hwrModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = '<div id="hwrBody" style="background:var(--surface,#fff);border-radius:6px;padding:16px 18px;max-width:900px;width:100%;margin:auto"></div>';
  document.body.appendChild(m);
  hwrModalRender();
}
function hwrModalRender() {
  const box = document.getElementById('hwrBody'); if (!box || !hwrModal) return;
  const { kind, s, sub } = hwrModal;
  const title = `${thwEsc(s.course_name || '')}${s.session_number ? ` 第${s.session_number}回` : ''}`;
  let body;
  if (kind === 'ic') {
    const all = hwFeedbacks(sub), mine = all.filter(f => f.by === hwrMe()).pop() || null;
    body = `${sub.text ? `<div style="font-size:12px;line-height:1.9;white-space:pre-wrap;margin-bottom:8px">${thwEsc(sub.text)}</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">${thwIcImgsHtml(sub, true)}</div>
      <div style="font-size:9px;color:var(--text-3);margin-top:6px">点图片放大、旋转</div>`;
    box.innerHTML = hwrModalFrame(title, sub, body) + hwrIcFeedbackBlockHtml(sub, all, mine);
  } else {
    box.innerHTML = hwrModalFrame(title, sub, thwPaperHtml(s, sub, false)) + hwrFeedbackBlockHtml(sub);
  }
}
function hwrModalFrame(title, sub, bodyHtml) {
  const t = typeof fmtJst === 'function' ? fmtJst(sub.submitted_at) : '';
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <span style="font-size:13px;font-weight:600">${thwEsc(sub.student_name)}</span>
      <span style="font-size:10px;color:var(--text-3)">${title} · ${thwEsc(t)}</span>
      <button onclick="document.getElementById('hwrModal').remove()" style="margin-left:auto;font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 14px;cursor:pointer;font-family:inherit">关闭</button>
    </div>
    <div style="border:1px solid var(--border-light);border-radius:3px;padding:12px;background:var(--bg);max-height:52vh;overflow-y:auto">${bodyHtml}</div>`;
}
// 弹窗里的「保存」：thwSaveFeedback / thwIcSave 在管理端没有老师端的列表状态，所以弹窗开着时走这里
async function hwrModalSave() {
  if (!hwrModal) return;
  const { kind, sub, after } = hwrModal;
  const ok = kind === 'ic' ? await hwrIcSaveFeedback(sub) : await hwrSaveFeedback(sub, 'homework_submissions');
  if (!ok) return;
  alert('批改已保存，学生可见');
  document.getElementById('hwrModal')?.remove();
  if (after) after();
}
