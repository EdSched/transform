// ══════════════════════════════════
// artworks.js — 学部美术「作业收集」（拍照上传作品，表 art_works）
// 老师端：出席作业页的「🎨 作业收集」（拍照 → 点学生名字提交 → 本周已收集 / 批改）
// 学生端：作业标签里的「🎨 我的作品」（按周列出，自己也能上传）
// 月度学习情况：awMonthWorks() 取某月作品图片
// 依赖：shared/supabase.js、shared/constants.js（weekRange / hwFeedbacks / hwFeedbackCardsHtml / matchesStudentSearch）
// ══════════════════════════════════

function awEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
// 学部美术专业：领域是学部、且领域名含「美术」（MAJOR_DOMAIN 由 DB 加载）；兜底看 key
function awIsArtMajor(k) {
  if (!k) return false;
  const dom = (typeof MAJOR_DOMAIN !== 'undefined' && MAJOR_DOMAIN[k]) || '';
  if (dom) return isGakubuMajor(k) && /美术|美術/.test(dom);
  return /^gakubu_/.test(k) && /bijutsu|art|design/i.test(k);
}
function awImgs(w) { let v = w && w.image_urls; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = []; } } return Array.isArray(v) ? v : []; }
function awShiftWeek(start, n) { const [y, m, d] = start.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + 7 * n)); return weekRange(t.toISOString().slice(0, 10)); }

// 上传前压缩：长边 1600px、JPEG 82%，按 EXIF 方向（与学生作业上传同一套做法）
async function awCompress(file) {
  if (!/^image\//.test(file.type) || file.size <= 400 * 1024) return file;
  try {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { bmp = await createImageBitmap(file); }
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], 'work.jpg', { type: 'image/jpeg' });
  } catch (e) { return file; }
}
// 上传一张作品照片；文件名只用 ASCII。老师用 teacher-files，学生用 homework（学生作业同一个 bucket）
async function awUploadOne(file, studentId, bucket) {
  const f = await awCompress(file);
  const ext = /jpe?g/i.test(f.type) ? 'jpg' : ((f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg');
  const path = `artworks/${String(studentId).replace(/[^A-Za-z0-9_-]/g, '_')}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const url = await sbUpload(bucket, path, f);
  return { url, name: file.name || 'photo.jpg' };
}

// 月度学习情况：某月（week_start 落在该月）的作品图片 [{url, date}]
const awMonthCache = {};
async function awMonthWorks(studentId, ym) {
  const k = studentId + '|' + ym;
  if (awMonthCache[k]) return awMonthCache[k];
  const [y, m] = ym.split('-').map(Number);
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const rows = await sb(`/rest/v1/art_works?student_id=eq.${encodeURIComponent(studentId)}&week_start=gte.${ym}-01&week_start=lt.${next}&select=week_start,image_urls&order=week_start.asc`).catch(() => []);
  const out = [];
  (rows || []).forEach(r => awImgs(r).forEach(im => out.push({ url: im.url, date: r.week_start, art: true })));
  awMonthCache[k] = out;
  return out;
}

// ── 批改（与作业批改同一结构，写入 art_works.feedbacks）──
function awFeedbackFormHtml(w, me) {
  const mine = hwFeedbacks(w).filter(f => f.by === me).pop() || null;
  const v = k => awEsc(mine ? (mine[k] || '') : '');
  const ta = 'width:100%;box-sizing:border-box;font-size:11px;line-height:1.8;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical';
  return `<div style="font-size:11px;font-weight:600;margin:10px 0 6px">${mine ? '✍ 编辑我的评价' : '✍ 添加我的评价'}（学生可见）</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">📚 技法 / 知识掌握</label><textarea id="aw_fb_know" rows="3" style="${ta}">${v('knowledge')}</textarea></div>
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">🧭 学习态度</label><textarea id="aw_fb_att" rows="3" style="${ta}">${v('attitude')}</textarea></div>
    </div>
    <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">💡 改进建议</label>
    <textarea id="aw_fb_sug" rows="2" style="${ta};margin-bottom:6px">${v('suggestions')}</textarea>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="aw_fb_score" value="${v('score')}" placeholder="评价/分数（可选）" style="font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;width:140px">
      <button onclick="awSaveFeedback('${awEsc(w.id)}')" style="margin-left:auto;font-size:12px;background:var(--accent,#b8953a);color:#fff;border:none;border-radius:3px;padding:7px 18px;cursor:pointer;font-family:inherit">${mine ? '保存修改' : '保存评价'}</button>
    </div>`;
}

// ══════════════════════════════════
// 老师端：🎨 作业收集
// ══════════════════════════════════
const awT = { week: '', pending: [], search: '', works: null, openId: null, busy: false, students: [] };
function awTeacherIsArt() {
  const ms = new Set([...(((typeof teacherData !== 'undefined' && teacherData) || {}).majors || [])]);
  try { const set = (typeof tsaAllowedSet === 'function') ? tsaAllowedSet() : null; if (set) set.forEach(m => ms.add(m)); } catch (e) {}
  return [...ms].some(awIsArtMajor);
}
// students：这位老师可见的学生（函数内再筛学部美术）
function awTeacherMount(boxId, students) {
  awT.students = (students || []).filter(s => awIsArtMajor(s.major));
  awT.boxId = boxId;
  if (!awT.week) awT.week = weekRange().start;
  awTRender();
  if (!awT.works) awTLoad();
}
async function awTLoad() {
  const wk = awShiftWeek(awT.week, 0);
  awT.works = null;
  const rows = await sb(`/rest/v1/art_works?week_start=eq.${wk.start}&select=*&order=created_at.desc`).catch(e => { awT.err = e.message; return []; });
  const ids = new Set(awT.students.map(s => String(s.id)));
  awT.works = (rows || []).filter(r => ids.has(String(r.student_id)));
  awTRender();
}
function awTWeekGo(n) { awT.week = awShiftWeek(awT.week, n).start; awT.openId = null; awTLoad(); awTRender(); }
function awTPick(input) {
  [...(input.files || [])].forEach(f => { if (/^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name)) awT.pending.push({ file: f, preview: URL.createObjectURL(f) }); });
  input.value = '';
  awTRender();
}
function awTDropPending(i) { const p = awT.pending.splice(i, 1)[0]; if (p) URL.revokeObjectURL(p.preview); awTRender(); }
async function awTSubmit(sid) {
  if (awT.busy || !awT.pending.length) return;
  const s = awT.students.find(x => String(x.id) === String(sid)); if (!s) return;
  const wk = awShiftWeek(awT.week, 0);
  awT.busy = true; awTRender();
  const tip = document.getElementById('aw_t_tip');
  try {
    const imgs = [];
    for (let i = 0; i < awT.pending.length; i++) {
      if (tip) tip.textContent = `上传中 ${i + 1}/${awT.pending.length}…`;
      imgs.push(await awUploadOne(awT.pending[i].file, s.id, 'teacher-files'));
    }
    const row = { id: `aw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, student_id: s.id, student_name: s.name, major: s.major, week_start: wk.start,
      image_urls: imgs, source: 'teacher', uploaded_by: (typeof teacherName !== 'undefined' && teacherName) || '', feedbacks: [] };
    const r = await sb('/rest/v1/art_works', 'POST', row);
    (awT.works = awT.works || []).unshift((r || [])[0] || row);
    awT.pending.forEach(p => URL.revokeObjectURL(p.preview));
    awT.pending = []; awT.search = '';
    awT.flash = `✓ 已提交：${s.name} · ${imgs.length} 张`;
  } catch (e) { alert('提交失败：' + e.message); }
  awT.busy = false; awTRender();
}
function awTRender() {
  const box = document.getElementById(awT.boxId); if (!box) return;
  const wk = awShiftWeek(awT.week, 0), isCur = wk.start === weekRange().start;
  const kw = awT.search.trim();
  const pool = kw ? awT.students.filter(s => (typeof matchesStudentSearch === 'function') ? matchesStudentSearch(s, kw) : (s.name || '').includes(kw)) : awT.students;
  const works = awT.works || [];
  const btn = 'font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg);cursor:pointer;font-family:inherit';
  box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin:6px 0 12px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <div style="font-size:13px;font-weight:600">🎨 作业收集</div>
      <span style="font-size:12px;color:var(--text-2)">${isCur ? '本周作业' : '作业'} · ${wk.label}</span>
      <span style="margin-left:auto;display:flex;gap:4px"><button onclick="awTWeekGo(-1)" style="${btn}">◀ 上一周</button>${isCur ? '' : `<button onclick="awT.week=weekRange().start;awT.openId=null;awTLoad()" style="${btn}">本周</button>`}<button onclick="awTWeekGo(1)" style="${btn}">下一周 ▶</button></span>
    </div>
    ${!awT.students.length ? '<div style="font-size:11px;color:var(--text-3)">你的可见范围内没有学部美术学生</div>' : `
    <label style="display:block;text-align:center;font-size:15px;font-weight:600;color:#fff;background:var(--accent,#b8953a);border-radius:8px;padding:14px;cursor:pointer;margin-bottom:8px">📷 拍摄 / 选择作品照片
      <input type="file" accept="image/*" capture="environment" multiple onchange="awTPick(this)" style="display:none"></label>
    ${awT.flash ? `<div style="font-size:11px;color:var(--ok,#2a9e6a);margin-bottom:6px">${awEsc(awT.flash)}</div>` : ''}
    ${awT.pending.length ? `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${awT.pending.map((p, i) => `<div style="position:relative;width:74px;height:74px"><img src="${p.preview}" style="width:74px;height:74px;object-fit:cover;border-radius:4px;border:1px solid var(--border)"><span onclick="awTDropPending(${i})" title="删掉这张" style="position:absolute;top:-6px;right:-6px;background:var(--danger,#b03a2e);color:#fff;border-radius:50%;width:20px;height:20px;font-size:12px;line-height:20px;text-align:center;cursor:pointer">✕</span></div>`).join('')}</div>
      <div style="font-size:11px;color:var(--text-2);margin-bottom:6px">这 ${awT.pending.length} 张是谁的作品？点名字即提交 <span id="aw_t_tip" style="color:var(--text-3)">${awT.busy ? '上传中…' : ''}</span></div>
      <input id="aw_t_search" value="${awEsc(awT.search)}" placeholder="搜索姓名 / 拼音首字母" oninput="awT.search=this.value;awTRender();const e=document.getElementById('aw_t_search');e.focus();e.setSelectionRange(e.value.length,e.value.length)" style="width:100%;box-sizing:border-box;font-size:12px;padding:6px 10px;border:1px solid var(--border);border-radius:4px;margin-bottom:6px">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px;max-height:40vh;overflow-y:auto;${awT.busy ? 'opacity:.5;pointer-events:none' : ''}">
        ${pool.length ? pool.map(s => `<button onclick="awTSubmit('${awEsc(s.id)}')" style="font-family:'Noto Serif SC',serif;font-size:13px;font-weight:600;padding:11px 4px;border:1px solid var(--border);border-radius:8px;background:var(--surface);cursor:pointer;color:var(--text)">${awEsc(s.name)}</button>`).join('') : '<div style="grid-column:1/-1;font-size:11px;color:var(--text-3);text-align:center;padding:10px">无匹配</div>'}
      </div>` : ''}
    <div style="font-size:12px;font-weight:600;margin:6px 0">${isCur ? '本周' : '这周'}已收集（${works.length}）</div>
    ${awT.works === null ? '<div style="font-size:11px;color:var(--text-3)">加载中…</div>' : works.length ? works.map(w => {
      const imgs = awImgs(w), fbs = hwFeedbacks(w), open = awT.openId === w.id;
      return `<div style="border:1px solid ${open ? 'var(--accent,#b8953a)' : 'var(--border-light)'};border-radius:5px;padding:7px 9px;margin-bottom:6px">
        <div onclick="awT.openId=${open ? 'null' : `'${awEsc(w.id)}'`};awTRender()" style="display:flex;align-items:center;gap:8px;cursor:pointer;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:600">${awEsc(w.student_name)}</span>
          <span style="font-size:10px;color:var(--text-3)">${imgs.length} 张 · ${w.source === 'student' ? '学生上传' : '老师上传' + (w.uploaded_by ? '（' + awEsc(w.uploaded_by) + '）' : '')}</span>
          ${fbs.length ? `<span style="font-size:10px;color:var(--ok,#2a9e6a)">✓ ${awEsc([...new Set(fbs.map(f => f.by))].join('、'))}</span>` : '<span style="font-size:10px;color:var(--warn,#b8860b)">待评价</span>'}
          <span style="margin-left:auto;display:flex;gap:3px">${imgs.slice(0, 4).map(im => `<img src="${awEsc(im.url)}" loading="lazy" style="width:34px;height:34px;object-fit:cover;border-radius:3px">`).join('')}</span>
        </div>
        ${open ? awTDetailHtml(w) : ''}
      </div>`;
    }).join('') : '<div style="font-size:11px;color:var(--text-3)">还没有收集到作品</div>'}`}
  </div>`;
}
function awTDetailHtml(w) {
  const imgs = awImgs(w);
  return `<div style="border-top:1px solid var(--border-light);margin-top:7px;padding-top:7px">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;margin-bottom:6px">
      ${imgs.map((im, i) => `<div style="position:relative"><a href="${awEsc(im.url)}" target="_blank"><img src="${awEsc(im.url)}" loading="lazy" style="width:100%;height:110px;object-fit:cover;border-radius:4px;border:1px solid var(--border)"></a>
        <span onclick="awDelPhoto('${awEsc(w.id)}',${i})" title="删除这张" style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,.55);color:#fff;border-radius:3px;font-size:10px;padding:0 5px;cursor:pointer">✕</span></div>`).join('')}
    </div>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
      <label style="font-size:11px;color:var(--accent,#b8953a);border:1px solid var(--border);border-radius:3px;padding:4px 10px;cursor:pointer">＋ 追加照片<input type="file" accept="image/*" capture="environment" multiple onchange="awAddPhotos('${awEsc(w.id)}',this,'teacher-files')" style="display:none"></label>
      <span id="aw_add_tip_${awEsc(w.id)}" style="font-size:10px;color:var(--text-3)"></span>
      <span onclick="awDelWork('${awEsc(w.id)}')" style="margin-left:auto;font-size:11px;color:var(--danger,#b03a2e);cursor:pointer">删除这条作品</span>
    </div>
    ${hwFeedbackCardsHtml(w, { mine: (typeof teacherData !== 'undefined' && teacherData && teacherData.name) || '' })}
    ${awFeedbackFormHtml(w, (typeof teacherData !== 'undefined' && teacherData && teacherData.name) || '')}
  </div>`;
}

// ── 共用操作（老师端 / 学生端）──
function awFind(id) {
  // 老师端「作业批改」页里的作品收集（teacher-homework.js）优先用那边的数据
  if (typeof thwArtWorks !== 'undefined' && thwArtWorks[id] && document.getElementById('thw_main')) return thwArtWorks[id];
  return (awT.works || []).find(x => x.id === id) || (awS.works || []).find(x => x.id === id) || null;
}
function awRerender() { if (typeof awTRender === 'function') awTRender(); if (typeof awSRender === 'function') awSRender(); if (typeof thwArtRerender === 'function') thwArtRerender(); }
async function awAddPhotos(id, input, bucket) {
  const w = awFind(id); if (!w) return;
  const files = [...(input.files || [])]; input.value = '';
  if (!files.length) return;
  const tip = document.getElementById('aw_add_tip_' + id);
  try {
    const imgs = awImgs(w).slice();
    for (let i = 0; i < files.length; i++) { if (tip) tip.textContent = `上传中 ${i + 1}/${files.length}…`; imgs.push(await awUploadOne(files[i], w.student_id, bucket)); }
    await sb(`/rest/v1/art_works?id=eq.${encodeURIComponent(id)}`, 'PATCH', { image_urls: imgs });
    w.image_urls = imgs;
    awRerender();
  } catch (e) { if (tip) tip.textContent = '上传失败：' + e.message; }
}
async function awDelPhoto(id, i) {
  const w = awFind(id); if (!w) return;
  const imgs = awImgs(w).slice();
  if (imgs.length <= 1) { return awDelWork(id); }
  if (!confirm('删除这张照片？')) return;
  imgs.splice(i, 1);
  try { await sb(`/rest/v1/art_works?id=eq.${encodeURIComponent(id)}`, 'PATCH', { image_urls: imgs }); w.image_urls = imgs; awRerender(); }
  catch (e) { alert('删除失败：' + e.message); }
}
async function awDelWork(id) {
  const w = awFind(id); if (!w) return;
  if (!confirm(`删除「${w.student_name || ''}」这条作品记录（${awImgs(w).length} 张）？`)) return;
  try {
    await sb(`/rest/v1/art_works?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (awT.works) awT.works = awT.works.filter(x => x.id !== id);
    if (awS.works) awS.works = awS.works.filter(x => x.id !== id);
    if (typeof thwArtDrop === 'function') thwArtDrop(id);
    awRerender();
  } catch (e) { alert('删除失败：' + e.message); }
}
async function awSaveFeedback(id) {
  const w = awFind(id); if (!w) return;
  const g = k => ((document.getElementById(k) || {}).value || '').trim();
  const know = g('aw_fb_know'), att = g('aw_fb_att'), sug = g('aw_fb_sug'), score = g('aw_fb_score');
  if (!know && !att && !sug) { alert('请至少填写一项评价'); return; }
  const me = (typeof teacherData !== 'undefined' && teacherData && teacherData.name) || '老师', now = new Date().toISOString();
  const list = hwFeedbacks(w).map(f => Object.assign({}, f));
  let mine = null;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].by === me) { mine = list[i]; break; }
  const fields = { knowledge: know, attitude: att, suggestions: sug, score };
  if (mine) Object.assign(mine, fields, { edited_at: now });
  else list.push(Object.assign({ id: 'fb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), by: me, at: now, file_url: '', file_name: '' }, fields));
  try { await sb(`/rest/v1/art_works?id=eq.${encodeURIComponent(id)}`, 'PATCH', { feedbacks: list }); w.feedbacks = list; awRerender(); }
  catch (e) { alert('保存失败：' + e.message); }
}

// ══════════════════════════════════
// 学生端：🎨 我的作品
// ══════════════════════════════════
const awS = { works: null, boxId: '', student: null, busy: false, err: '' };
async function awStudentMount(boxId, student) {
  awS.boxId = boxId; awS.student = student;
  awSRender();
  const rows = await sb(`/rest/v1/art_works?student_id=eq.${encodeURIComponent(student.id)}&select=*&order=week_start.desc,created_at.desc`).catch(e => { awS.err = e.message; return []; });
  awS.works = rows || [];
  awSRender();
}
async function awSUpload(input) {
  const files = [...(input.files || [])]; input.value = '';
  if (!files.length || awS.busy) return;
  const st = awS.student; if (!st) return;
  awS.busy = true; awSRender();
  const tip = document.getElementById('aw_s_tip');
  try {
    const imgs = [];
    for (let i = 0; i < files.length; i++) { if (tip) tip.textContent = `上传中 ${i + 1}/${files.length}…`; imgs.push(await awUploadOne(files[i], st.id, 'homework')); }
    const row = { id: `aw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, student_id: st.id, student_name: st.name, major: st.major, week_start: weekRange().start,
      image_urls: imgs, source: 'student', uploaded_by: st.name, feedbacks: [] };
    const r = await sb('/rest/v1/art_works', 'POST', row);
    (awS.works = awS.works || []).unshift((r || [])[0] || row);
  } catch (e) { alert('上传失败：' + e.message); }
  awS.busy = false; awSRender();
}
function awSRender() {
  const box = document.getElementById(awS.boxId); if (!box) return;
  const cur = weekRange();
  const works = awS.works || [];
  const weeks = [...new Set([cur.start, ...works.map(w => w.week_start)])].sort((a, b) => b.localeCompare(a));
  box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px;margin-bottom:14px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <div style="font-size:12px;font-weight:600">🎨 我的作品</div>
      <label style="margin-left:auto;font-size:12px;font-weight:600;color:#fff;background:var(--accent,#b8953a);border-radius:5px;padding:7px 14px;cursor:pointer;${awS.busy ? 'opacity:.6;pointer-events:none' : ''}">📷 上传本周作品<input type="file" accept="image/*" capture="environment" multiple onchange="awSUpload(this)" style="display:none"></label>
      <span id="aw_s_tip" style="font-size:10px;color:var(--text-muted,#999)">${awS.busy ? '上传中…' : ''}</span>
    </div>
    ${awS.err ? `<div style="font-size:11px;color:var(--danger)">读取失败：${awEsc(awS.err)}</div>` : awS.works === null ? '<div style="font-size:11px;color:var(--text-muted,#999)">加载中…</div>' :
    weeks.map(ws => {
      const wk = weekRange(ws), list = works.filter(w => w.week_start === ws);
      return `<div style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:600;color:var(--text-secondary,#5a5650);margin-bottom:6px">${ws === cur.start ? '本周 · ' : ''}${wk.label}</div>
        ${list.length ? list.map(w => `<div style="border:1px solid var(--border-light);border-radius:5px;padding:8px 10px;margin-bottom:6px">
          <div style="font-size:10px;color:var(--text-muted,#999);margin-bottom:5px">${awImgs(w).length} 张 · ${w.source === 'student' ? '自己上传' : '老师上传' + (w.uploaded_by ? '（' + awEsc(w.uploaded_by) + '）' : '')}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px;margin-bottom:6px">${awImgs(w).map(im => `<a href="${awEsc(im.url)}" target="_blank"><img src="${awEsc(im.url)}" loading="lazy" style="width:100%;height:100px;object-fit:cover;border-radius:4px;border:1px solid var(--border)"></a>`).join('')}</div>
          ${hwFeedbackCardsHtml(w)}
        </div>`).join('') : '<div style="font-size:11px;color:var(--text-muted,#999)">这周还没有作品</div>'}
      </div>`;
    }).join('')}
  </div>`;
}
