// ══════════════════════════════════
// studentfiles.js — 学生管理文件：按学生列出全部文件，并在浏览器里打成 zip 下载
// 入口：① 学生档案详细「📁 学生文件」→ sflOpen(学生id)；② 管控台「学生管理文件」页面上半部分（批量）
// 文件清单从数据库读地址（不靠存储路径），所以旧文件也能列出来。只读、只下载，不删除任何文件，不在服务器上生成文件。
// 来源：student_doc_versions（计划书 / 面试稿，学生每版 + 老师批复）、旧 student_plan_drafts 文件、riyu_submissions（在线稿生成 Word + 批复）、
//       homework_submissions（作业）、inclass_submissions（随堂作业）、art_works（美术作业）、bookings（面谈附件）、student_materials（出愿材料里的文件，若有）
// 依赖：shared/supabase.js（sb / sbAll）、shared/constants.js、shared/riyu.js（riyuWordBuild）、JSZip（打包时才从 cdnjs 加载）
// ══════════════════════════════════
const SFL_CATS = ['计划书', '面试稿', '志望理由书', '联系教授邮件', '问询邮件', '作业', '随堂作业', '美术作业', '面谈附件', '出愿材料'];
const SFL_KIND_CAT = { gakubu_riyu: '志望理由书', grad_riyu: '志望理由书', grad_prof_mail: '联系教授邮件', grad_inquiry_mail: '问询邮件', grad_interview: '面试稿' };
const SFL_STATUS = [['active', '在籍'], ['graduated', '已合格'], ['expired', '已到期'], ['stopped', '停课'], ['withdrawn', '退学']];
const SFL_PAGE = 30;
const SFL = { students: null, loading: false, loadErr: '', cache: {}, q: '', status: 'active', shown: SFL_PAGE, sel: new Set(), sizes: {}, busy: false, queue: [], queueRun: 0, root: null, zipMsg: '' };

function sflEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function sflSizeText(n) { return n >= 1024 * 1024 * 1024 ? (n / 1024 / 1024 / 1024).toFixed(2) + ' GB' : n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : n > 0 ? Math.max(1, Math.round(n / 1024)) + ' KB' : '0 KB'; }
function sflDate(t) {
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(t))) return String(t);
  const d = new Date(t); if (isNaN(d)) return String(t).slice(0, 10);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}
function sflExt(url, name) {
  const m = String(name || '').match(/\.([A-Za-z0-9]{1,5})$/) || String(url || '').split('?')[0].match(/\.([A-Za-z0-9]{1,5})$/);
  return m ? m[1].toLowerCase() : '';
}
function sflClean(s) { return String(s == null ? '' : s).replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80) || '_'; }
function sflArr(v) { if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = []; } } return Array.isArray(v) ? v : []; }

// ── 读取一个学生的全部文件 ──
// 返回 { files: [{ cat, sub, label, date, url, ext, gen, text }], failed: [表名] }
async function sflCollect(stu) {
  const id = encodeURIComponent(stu.id);
  const failed = [];
  const get = (tbl, path) => sbAll(path, { cache: 'no-store' }).catch(e => { failed.push(`${tbl}：${String((e && e.message) || e).slice(0, 300)}`); return []; });   // 记下数据库返回的错误原文，方便排查
  const [vers, riyu, drafts, hws, ics, arts, bks, mats] = await Promise.all([
    get('计划书/面试稿版本', `/rest/v1/student_doc_versions?student_id=eq.${id}&select=*&order=submitted_at.asc`),
    get('志望理由书・邮件', `/rest/v1/riyu_submissions?student_id=eq.${id}&select=*&order=submitted_at.asc.nullslast`),
    get('旧计划书', `/rest/v1/student_plan_drafts?student_id=eq.${id}&select=*`),
    get('作业', `/rest/v1/homework_submissions?student_id=eq.${id}&select=*&order=submitted_at.asc`),
    get('随堂作业', `/rest/v1/inclass_submissions?student_id=eq.${id}&select=*&order=submitted_at.asc`),
    get('美术作业', `/rest/v1/art_works?student_id=eq.${id}&select=*&order=week_start.asc`),
    get('面谈', `/rest/v1/bookings?or=(student_id.eq.${id},and(student_id.is.null,name.eq.${encodeURIComponent(stu.name || '')}))&select=*&order=slot_date.asc`),
    get('出愿材料', `/rest/v1/student_materials?student_id=eq.${id}&select=*`),
  ]);
  // 作业 / 随堂作业的课程名、第几回、上课日期：提交记录里有就用，没有的按 session_id 查 course_sessions（和老师端作业页同样的取法）
  const sids = [...new Set([...hws, ...ics].filter(h => h.session_id && (!h.course_name || !h.session_number || !h.session_date)).map(h => h.session_id))];
  const sess = {};
  for (let k = 0; k < sids.length; k += 80) {
    const part = sids.slice(k, k + 80).map(x => `"${String(x).replace(/"/g, '')}"`).join(',');
    (await get('课程回次', `/rest/v1/course_sessions?id=in.(${part})&select=id,course_id,course_name,session_number,session_date`)).forEach(x => { sess[x.id] = x; });
  }
  const sinfo = h => { const x = sess[h.session_id] || {}; return { course_name: h.course_name || x.course_name, session_number: h.session_number || x.session_number, session_date: h.session_date || x.session_date }; };
  const files = [];
  const seen = new Set();
  const add = f => {
    if (!f.gen && !f.text && !f.url) return;
    if (f.url) { if (seen.has(f.url)) return; seen.add(f.url); }
    files.push(Object.assign({ sub: '', ext: f.gen ? 'doc' : f.text != null ? 'txt' : sflExt(f.url, f.fname), date: '' }, f));
  };

  // 计划书 / 面试稿：学生每版 + 老师每版批复
  const purpose = v => (v.school_key ? ((v.school_name || '').trim() || String(v.school_key).split('|').filter(Boolean).join(' ')) + '版' : '通用版');
  vers.forEach(v => {
    const cat = v.doc_type === 'interview' ? '面试稿' : '计划书';
    const base = `${purpose(v)}_第${v.version_no}版`;
    add({ cat, label: base, date: sflDate(v.submitted_at), url: v.file_url, fname: v.file_name });
    if (v.review_file_url) add({ cat, label: base + '_老师批复', date: sflDate(v.reviewed_at || v.submitted_at), url: v.review_file_url, fname: v.review_file_name });
  });
  // 还没迁成版本的旧文件（地址不在任何版本里）
  (drafts || []).forEach(d => {
    if (d.draft_file_url) add({ cat: '计划书', label: '旧_计划书完成稿', date: sflDate(d.updated_at), url: d.draft_file_url });
    if (d.reviewed_file_url) add({ cat: '计划书', label: '旧_计划书完成稿_老师批复', date: sflDate(d.reviewed_at || d.updated_at), url: d.reviewed_file_url, fname: d.reviewed_file_name });
  });

  // 志望理由书 / 邮件 / 在线面试稿：在线内容生成 Word + 批复文件
  riyu.forEach(r => {
    const cat = SFL_KIND_CAT[r.kind] || '志望理由书';
    const school = [r.school_name, r.faculty, r.department].filter(Boolean).join('_') || '不指定学校';
    const date = sflDate(r.submitted_at || r.updated_at || r.created_at);
    const secs = typeof riyuSecs === 'function' ? riyuSecs(r) : (r.sections || {});
    if (Object.values(secs || {}).some(x => String(x || '').trim())) add({ cat, label: `${school}_${date}`, date, gen: { type: 'riyu', sub: r } });
    const revs = sflArr(r.history).filter(h => h && h.action === 'review' && h.file_url);
    if (r.reviewed_file_url && !revs.some(h => h.file_url === r.reviewed_file_url)) revs.push({ file_url: r.reviewed_file_url, file_name: r.reviewed_file_name, at: r.reviewed_at });
    revs.forEach((h, i) => add({ cat, label: `${school}_${sflDate(h.at || r.reviewed_at || r.updated_at)}_批复${revs.length > 1 ? (i + 1) : ''}`, date: sflDate(h.at || r.reviewed_at || r.updated_at), url: h.file_url, fname: h.file_name }));
  });

  // 作业：学生提交的图片 / 文件 + 整份 + 老师批改文件
  hws.forEach(h0 => {
    const h = Object.assign({}, h0, sinfo(h0));
    const sub = sflClean(h.course_name || '作业'), date = sflDate(h.session_date || h.submitted_at), n = h.session_number ? `第${h.session_number}回` : '';
    const stem = [date, n].filter(Boolean).join('_');
    let i = 0;
    sflArr(h.answers).forEach(a => sflArr(a && a.images).forEach(im => { if (im && im.url) add({ cat: '作业', sub, label: `${stem}_${++i}`, date, url: im.url, fname: im.name }); }));
    if (h.whole_file_url) add({ cat: '作业', sub, label: `${stem}_整份`, date, url: h.whole_file_url });
    const fbs = sflArr(h.feedbacks).filter(f => f && f.file_url);
    fbs.forEach((f, k) => add({ cat: '作业', sub, label: `${stem}_批改${fbs.length > 1 ? (k + 1) : ''}`, date, url: f.file_url, fname: f.file_name }));
    if (h.teacher_file_url) add({ cat: '作业', sub, label: `${stem}_批改`, date, url: h.teacher_file_url });
  });
  ics.forEach(h0 => {
    const h = Object.assign({}, h0, sinfo(h0));
    const sub = sflClean(h.course_name || '随堂作业'), date = sflDate(h.session_date || h.submitted_at), n = h.session_number ? `第${h.session_number}回` : '';
    const stem = [date, n].filter(Boolean).join('_');
    sflArr(h.images).forEach((im, i) => { if (im && im.url) add({ cat: '随堂作业', sub, label: `${stem}_${i + 1}`, date, url: im.url, fname: im.name }); });
    const fbs = sflArr(h.feedbacks).filter(f => f && f.file_url);
    fbs.forEach((f, k) => add({ cat: '随堂作业', sub, label: `${stem}_批改${fbs.length > 1 ? (k + 1) : ''}`, date, url: f.file_url, fname: f.file_name }));
  });
  arts.forEach(w => {
    const date = sflDate(w.week_start || w.created_at);
    sflArr(w.image_urls).forEach((im, i) => { const u = typeof im === 'string' ? im : im && im.url; if (u) add({ cat: '美术作业', label: `${date}_${i + 1}`, date, url: u, fname: im && im.name }); });
    const fbs = sflArr(w.feedbacks).filter(f => f && f.file_url);
    fbs.forEach((f, k) => add({ cat: '美术作业', label: `${date}_批改${fbs.length > 1 ? (k + 1) : ''}`, date, url: f.file_url, fname: f.file_name }));
  });

  // 面谈附件：学生文件 / 文字内容（存成 .txt）/ 老师修改文件 / VIP 作业
  bks.forEach(b => {
    const date = sflDate(b.slot_date || b.created_at), ty = sflClean(b.type ? (typeof typeLabel === 'function' ? typeLabel(b.type) : (Array.isArray(b.type) ? b.type.join('・') : b.type)) : '面谈');
    if (b.student_file_url) add({ cat: '面谈附件', label: `${date}_${ty}`, date, url: b.student_file_url });
    if (b.student_content && String(b.student_content).trim()) add({ cat: '面谈附件', label: `${date}_${ty}_文字内容`, date, text: String(b.student_content) });
    if (b.teacher_file_url) add({ cat: '面谈附件', label: `${date}_${ty}_老师修改文件`, date, url: b.teacher_file_url });
    if (b.vip_homework_file_url) add({ cat: '作业', sub: 'VIP', label: `${date}_VIP作业`, date, url: b.vip_homework_file_url });
  });

  // 出愿材料里上传的文件（目前材料只记录准备情况；如果有 file_url / files 字段就一并收进来）
  mats.forEach(m => {
    const date = sflDate(m.updated_at || m.created_at), nm = sflClean(m.item_name || m.item_id || '材料');
    if (m.file_url) add({ cat: '出愿材料', label: `${date}_${nm}`, date, url: m.file_url, fname: m.file_name });
    sflArr(m.files).forEach((f, i) => { const u = typeof f === 'string' ? f : f && f.url; if (u) add({ cat: '出愿材料', label: `${date}_${nm}_${i + 1}`, date, url: u, fname: f && f.name }); });
  });
  return { files, failed };
}

async function sflGet(stu, force) {
  if (!force && SFL.cache[stu.id]) return SFL.cache[stu.id];
  const r = await sflCollect(stu);
  SFL.cache[stu.id] = r;
  return r;
}
// 给每个文件分配 zip 里的路径：分类/[子文件夹/]日期_名称.扩展名；重名加 _2
function sflAssignPaths(files) {
  const used = new Set();
  files.forEach(f => {
    const dir = [f.cat, f.sub ? sflClean(f.sub) : ''].filter(Boolean).join('/');
    const stem = sflClean(f.date && !String(f.label).includes(f.date) ? `${f.date}_${f.label}` : f.label);
    const ext = f.ext ? '.' + f.ext : '';
    let p = `${dir}/${stem}${ext}`, n = 2;
    while (used.has(p.toLowerCase())) p = `${dir}/${stem}_${n++}${ext}`;
    used.add(p.toLowerCase());
    f.path = p;
  });
  return files;
}
function sflStudentOf(id) { return (SFL.students || []).find(s => s.id === id) || (typeof cachedStudents !== 'undefined' ? cachedStudents : []).find(s => s.id === id) || null; }
function sflFolderName(stu) {
  const d = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(/-/g, '');
  return sflClean(`${stu.name || '学生'}_${(typeof majorLabel === 'function' ? majorLabel(stu.major) : stu.major) || ''}_${d}`);
}

// ── 文件大小：HEAD 请求读 Content-Length（只读，不下载内容）──
async function sflHeadSize(url) {
  if (url in SFL.sizes) return SFL.sizes[url];
  let n = null;
  try { const r = await fetch(url, { method: 'HEAD' }); const l = r.ok ? r.headers.get('content-length') : null; if (l != null) n = Number(l); } catch (e) { n = null; }
  SFL.sizes[url] = n;
  return n;
}
async function sflSizeAll(files, onStep) {
  const list = files.filter(f => f.url && !(f.url in SFL.sizes));
  let i = 0;
  const worker = async () => { while (i < list.length) { const f = list[i++]; await sflHeadSize(f.url); if (onStep) onStep(); } };
  await Promise.all(Array.from({ length: 6 }, worker));
}
function sflTotalSize(files) { let n = 0, known = 0, unk = 0; files.forEach(f => { if (!f.url) return; const s = SFL.sizes[f.url]; if (s == null) unk++; else { n += s; known++; } }); return { bytes: n, known, unknown: unk }; }

// ── 打包下载 ──
function sflLoadZip() {
  if (window.JSZip) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const urls = ['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'];
    let i = 0;
    const next = () => {
      if (i >= urls.length) return reject(new Error('无法加载打包组件（JSZip），请检查网络后重试'));
      const sc = document.createElement('script');
      sc.src = urls[i++]; sc.onload = () => resolve(); sc.onerror = () => { sc.remove(); next(); };
      document.head.appendChild(sc);
    };
    next();
  });
}
async function sflFileBlob(f, stu) {
  if (f.text != null) return new Blob(['﻿', f.text], { type: 'text/plain;charset=utf-8' });
  if (f.gen) {
    if (typeof riyuWordBuild !== 'function') throw new Error('缺少 Word 生成组件');
    return (await riyuWordBuild(f.gen.sub, stu)).blob;
  }
  const r = await fetch(f.url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.blob();
}
// 把一个学生的文件打成 zip 并触发下载。progress(text) 实时汇报。返回 { total, failed: [{path, err}] }
async function sflZipStudent(stu, progress) {
  progress('读取文件清单…');
  const { files } = await sflGet(stu, true);
  if (!files.length) { progress('没有文件'); return { total: 0, failed: [] }; }
  await sflLoadZip();
  sflAssignPaths(files);
  const root = sflFolderName(stu);
  const zip = new JSZip();
  const failed = [];
  let done = 0, i = 0;
  const worker = async () => {
    while (i < files.length) {
      const f = files[i++];
      try { zip.file(`${root}/${f.path}`, await sflFileBlob(f, stu)); }
      catch (e) { failed.push({ path: f.path, err: (e && e.message) || String(e) }); }
      done++; progress(`正在下载 ${done} / ${files.length}`);
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  progress('正在打包…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = root + '.zip';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return { total: files.length, failed };
}

// ══ 单个学生：文件清单弹窗 ══
async function sflOpen(studentId) {
  const stu = sflStudentOf(studentId); if (!stu) { alert('找不到这个学生'); return; }
  document.getElementById('sflModal')?.remove();
  const ov = document.createElement('div');
  ov.id = 'sflModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10001;display:flex;align-items:flex-start;justify-content:center;padding:30px 16px;overflow-y:auto';
  ov.innerHTML = `<div style="background:var(--surface,#fff);border-radius:6px;padding:18px 20px;max-width:760px;width:100%">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="font-size:14px;font-weight:600;flex:1">学生文件　—　${sflEsc(stu.name)}</div>
      <button onclick="document.getElementById('sflModal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-3,#999)">×</button></div>
    <div id="sflBody"><div class="loading">读取中…</div></div></div>`;
  document.body.appendChild(ov);
  try {
    const { files, failed } = await sflGet(stu, true);
    sflAssignPaths(files);
    sflModalRender(stu, files, failed);
    sflSizeAll(files, () => sflModalSizeUpdate(files)).then(() => sflModalSizeUpdate(files));
  } catch (e) { document.getElementById('sflBody').innerHTML = `<div style="color:var(--danger)">读取失败：${sflEsc(e.message || e)}</div>`; }
}
function sflModalSizeUpdate(files) {
  const t = document.getElementById('sflTotal'); if (!t) return;
  const s = sflTotalSize(files);
  t.textContent = `共 ${files.length} 个文件，约 ${sflSizeText(s.bytes)}${s.unknown ? `（${s.unknown} 个文件大小未知或统计中）` : ''}`;
  files.forEach((f, i) => { const e = document.getElementById('sflsz_' + i); if (e && f.url && SFL.sizes[f.url] != null) e.textContent = sflSizeText(SFL.sizes[f.url]); });
}
function sflModalRender(stu, files, failed) {
  const box = document.getElementById('sflBody'); if (!box) return;
  const cats = SFL_CATS.map(c => [c, files.map((f, i) => ({ f, i })).filter(x => x.f.cat === c)]).filter(x => x[1].length);
  box.innerHTML = `
    ${failed.length ? `<div style="font-size:11px;color:var(--danger);margin-bottom:6px">有 ${failed.length} 类数据读取失败，下面的清单可能不完整：<br>${failed.map(sflEsc).join('<br>')}</div>` : ''}
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <span id="sflTotal" style="font-size:12px;font-weight:600">共 ${files.length} 个文件，统计大小中…</span>
      <button class="btn btn-primary btn-sm" id="sflZipBtn" onclick="sflZipOne('${sflEsc(stu.id)}')" ${files.length ? '' : 'disabled'} style="margin-left:auto">⬇ 全部打包下载</button>
    </div>
    <div id="sflProg" style="font-size:12px;color:var(--text-2);margin-bottom:8px;white-space:pre-wrap"></div>
    ${cats.length ? cats.map(([c, list]) => `<details style="border:1px solid var(--border-light,#ede9e2);border-radius:4px;margin-bottom:6px" ${cats.length === 1 ? 'open' : ''}>
      <summary style="cursor:pointer;padding:7px 10px;font-size:12px;font-weight:600">${c} <span style="font-weight:400;color:var(--text-3)">${list.length} 个</span></summary>
      <div style="padding:2px 10px 8px">${list.map(({ f, i }) => `<div style="display:flex;align-items:center;gap:8px;font-size:11px;padding:3px 0;border-top:1px dashed var(--border-light,#ede9e2)">
        <span style="flex:1;word-break:break-all">${sflEsc((f.sub ? f.sub + ' / ' : '') + f.label)}${f.ext ? '.' + sflEsc(f.ext) : ''}</span>
        <span style="color:var(--text-3)">${sflEsc(f.date)}</span>
        <span id="sflsz_${i}" style="color:var(--text-3);min-width:54px;text-align:right">${f.url && SFL.sizes[f.url] != null ? sflSizeText(SFL.sizes[f.url]) : '—'}</span>
        ${f.url ? `<a href="${sflEsc(f.url)}" target="_blank" style="color:var(--accent)">⬇</a>` : `<a href="javascript:void(0)" onclick="sflDownloadOne('${sflEsc(stu.id)}',${i})" style="color:var(--accent)">⬇</a>`}
      </div>`).join('')}</div></details>`).join('') : '<div class="empty">这个学生没有找到任何文件</div>'}`;
  sflModalSizeUpdate(files);
}
async function sflDownloadOne(studentId, i) {   // 在线稿 / 文字内容：临时生成再下载
  const stu = sflStudentOf(studentId), c = SFL.cache[studentId]; if (!stu || !c || !c.files[i]) return;
  const f = c.files[i];
  try {
    const blob = await sflFileBlob(f, stu);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = sflClean(f.label) + (f.ext ? '.' + f.ext : '');
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  } catch (e) { alert('生成失败：' + (e.message || e)); }
}
function sflFailedHtml(failed) {
  return failed.length ? `<div style="color:var(--danger);margin-top:4px">有 ${failed.length} 个文件下载失败（已跳过，其余已打包）：<br>${failed.map(x => sflEsc(x.path) + '（' + sflEsc(x.err) + '）').join('<br>')}</div>` : '';
}
async function sflZipOne(studentId) {
  if (SFL.busy) { alert('正在打包中，请等当前任务完成'); return; }
  const stu = sflStudentOf(studentId); if (!stu) return;
  const prog = document.getElementById('sflProg'), btn = document.getElementById('sflZipBtn');
  SFL.busy = true; if (btn) btn.disabled = true;
  try {
    const r = await sflZipStudent(stu, t => { if (prog) prog.textContent = t; });
    if (prog) prog.innerHTML = `完成：共 ${r.total} 个文件，成功 ${r.total - r.failed.length} 个。${sflFailedHtml(r.failed)}`;
  } catch (e) { if (prog) prog.innerHTML = `<span style="color:var(--danger)">打包失败：${sflEsc(e.message || e)}</span>`; }
  SFL.busy = false; if (btn) btn.disabled = false;
}

// ══ 批量：管控台「学生管理文件」页面上半部分 ══
function sflMount(root) {
  SFL.root = root;
  // 中枢台打开时学生名单还没加载过（cachedStudents 是空的）：自己读一次
  if (!SFL.students && !(typeof cachedStudents !== 'undefined' && cachedStudents.length)) sflLoadStudents();
  sflRender();
}
async function sflLoadStudents() {
  if (SFL.loading) return;
  SFL.loading = true; SFL.loadErr = ''; sflRender();
  try { SFL.students = await sbAll('/rest/v1/students?select=*&order=name.asc', { cache: 'no-store' }); }
  catch (e) { SFL.loadErr = String((e && e.message) || e); }
  SFL.loading = false;
  sflRender();
}
function sflList() {
  const pool = SFL.students || (typeof cachedStudents !== 'undefined' ? cachedStudents : []);
  return pool.filter(s => typeof scopeStudent !== 'function' || scopeStudent(s));
}
function sflRender() {
  const root = SFL.root || document.getElementById('sfl_root'); if (!root) return;
  if (SFL.loading || SFL.loadErr) {
    root.innerHTML = `<div style="max-width:900px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px 18px;margin-bottom:18px">
      <div style="font-size:14px;font-weight:600;margin-bottom:8px">学生管理文件</div>
      ${SFL.loading ? '<div class="loading">读取学生名单…</div>' : `<div style="color:var(--danger);font-size:12px">学生名单读取失败：${sflEsc(SFL.loadErr)}　<a href="javascript:void(0)" onclick="sflLoadStudents()" style="color:var(--accent)">重试</a></div>`}</div>`;
    return;
  }
  const base = sflList();
  const bar = typeof domMajorFilterHtml === 'function'
    ? domMajorFilterHtml(DMF, "SFL.shown=SFL_PAGE;sflRender()", base, { extra: true, also: s => !SFL.status || (s.status || 'active') === SFL.status })
    : '';
  const filtered = typeof dmfFilter === 'function' ? dmfFilter(base, { extra: true }) : base;
  const cnt = st => filtered.filter(s => (s.status || 'active') === st).length;
  const idle = !SFL.q.trim() && !DMF.domain && !DMF.major;   // 打开时不默认列出全部
  let list = filtered.filter(s => !SFL.status || (s.status || 'active') === SFL.status);
  if (SFL.q.trim()) list = (typeof matchesStudentSearch === 'function' ? base.filter(s => matchesStudentSearch(s, SFL.q.trim()) && (!SFL.status || (s.status || 'active') === SFL.status)) : list);
  const shown = list.slice(0, SFL.shown);
  const chip = (on, label, js) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${js}">${label}</div>`;
  const nSel = [...SFL.sel].filter(id => base.some(s => s.id === id)).length;
  root.innerHTML = `<div style="max-width:900px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px 18px;margin-bottom:18px">
    <div style="font-size:14px;font-weight:600;margin-bottom:4px">学生管理文件</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:10px">按学生打包下载全部文件（计划书、面试稿、志望理由书、作业、面谈附件等）。只下载，不会删除任何文件；打包在你的浏览器里完成，不经过服务器。</div>
    <div class="search-bar"><input id="sfl_q" placeholder="搜索学生（汉字 / 拼音首字母）…" value="${sflEsc(SFL.q)}" oninput="searchBox(this,sflSearch)"></div>
    ${bar}
    <div class="filter-row"><span style="font-size:10px;color:var(--text-3);min-width:30px;align-self:center">状态</span>${SFL_STATUS.map(([v, l]) => chip(SFL.status === v, `${l} ${cnt(v)}`, `SFL.status=SFL.status==='${v}'?'':'${v}';SFL.shown=SFL_PAGE;sflRender()`)).join('')}</div>
    ${idle ? '<div class="empty" style="color:var(--text-3)">请先搜索，或选择领域 / 专业，再显示学生列表</div>' : `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0">
      <span style="font-size:11px;color:var(--text-3)">共 ${list.length} 人${nSel ? `，已选 ${nSel} 人` : '（点学生所在行选择）'}</span>
      <button class="btn btn-outline btn-sm" onclick="sflSelect('all')">全选当前显示</button>
      <button class="btn btn-outline btn-sm" onclick="sflSelect('none')">清除选择</button>
      <button class="btn btn-primary btn-sm" onclick="sflZipBatch()" ${nSel ? '' : 'disabled'} style="margin-left:auto">依次打包下载（${nSel} 人）</button>
    </div>
    <div id="sflBatchProg" style="font-size:12px;color:var(--text-2);margin-bottom:6px;white-space:pre-wrap">${SFL.zipMsg || ''}</div>
    <div style="display:flex;flex-direction:column;gap:5px">${shown.map(s => {
      const on = SFL.sel.has(s.id), c = SFL.cache[s.id];
      const st = (SFL_STATUS.find(x => x[0] === (s.status || 'active')) || ['', s.status])[1];
      return `<div onclick="sflToggle('${sflEsc(s.id)}')" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid ${on ? 'var(--accent,#b8953a)' : 'var(--border-light,#ede9e2)'};background:${on ? '#fbf6e6' : 'var(--surface,#fff)'};border-radius:5px;padding:7px 10px;cursor:pointer">
        <span style="font-size:12px;font-weight:600;min-width:70px">${sflEsc(s.name)}</span>
        <span style="font-size:10px;color:var(--text-3)">${sflEsc((typeof majorLabel === 'function' ? majorLabel(s.major) : s.major) || '')} · ${sflEsc(st)}</span>
        <span id="sflc_${sflEsc(s.id)}" style="font-size:11px;color:var(--text-2);margin-left:auto">${sflRowInfo(s.id)}</span>
        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();sflOpen('${sflEsc(s.id)}')">查看</button>
        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();sflZipRow('${sflEsc(s.id)}')">打包下载</button>
      </div>`;
    }).join('') || '<div class="empty">没有符合条件的学生</div>'}</div>
    ${list.length > shown.length ? `<div onclick="SFL.shown+=SFL_PAGE;sflRender()" style="text-align:center;padding:10px;margin:8px 0;font-size:11px;color:var(--accent);border:1px dashed var(--border);border-radius:4px;cursor:pointer">显示更多（还有 ${list.length - shown.length} 人）</div>` : ''}`}
  </div>`;
  if (!idle) sflQueueCounts(shown.map(s => s.id));
}
function sflRowInfo(id) {
  const c = SFL.cache[id];
  if (!c) return '<span style="color:var(--text-3)">统计中…</span>';
  const s = sflTotalSize(c.files);
  const sz = c.files.some(f => f.url) ? (s.unknown ? `<a href="javascript:void(0)" onclick="event.stopPropagation();sflRowSize('${sflEsc(id)}')" style="color:var(--accent)">算大小</a>` : '约 ' + sflSizeText(s.bytes)) : '';
  return `${c.files.length} 个文件 ${sz}${c.failed.length ? ' <span style="color:var(--danger)">（部分读取失败）</span>' : ''}`;
}
function sflRowUpdate(id) { const e = document.getElementById('sflc_' + id); if (e) e.innerHTML = sflRowInfo(id); }
async function sflRowSize(id) {
  const c = SFL.cache[id]; if (!c) return;
  const e = document.getElementById('sflc_' + id); if (e) e.textContent = '计算中…';
  await sflSizeAll(c.files, () => {});
  sflRowUpdate(id);
}
// 当前显示的学生：后台依次统计文件数（每次 2 个并发，读过的有缓存）
function sflQueueCounts(ids) {
  const stamp = ++SFL.queueRun;
  const todo = ids.filter(id => !SFL.cache[id]);
  let i = 0;
  const worker = async () => {
    while (i < todo.length && stamp === SFL.queueRun) {
      const id = todo[i++], stu = sflStudentOf(id); if (!stu) continue;
      try { await sflGet(stu); } catch (e) { SFL.cache[id] = { files: [], failed: ['读取'] }; }
      sflRowUpdate(id);
    }
  };
  Promise.all([worker(), worker()]);
}
function sflSearch(q) {
  SFL.q = q || ''; SFL.shown = SFL_PAGE;
  sflRender();
  const el = document.getElementById('sfl_q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
function sflToggle(id) { if (SFL.sel.has(id)) SFL.sel.delete(id); else SFL.sel.add(id); sflRender(); }
function sflSelect(mode) {
  if (mode === 'none') SFL.sel.clear();
  else document.querySelectorAll('[id^="sflc_"]').forEach(e => SFL.sel.add(e.id.slice(5)));
  sflRender();
}
async function sflZipRow(id) {
  if (SFL.busy) { alert('正在打包中，请等当前任务完成'); return; }
  const stu = sflStudentOf(id); if (!stu) return;
  const prog = document.getElementById('sflBatchProg');
  SFL.busy = true;
  try {
    const r = await sflZipStudent(stu, t => { if (prog) prog.textContent = `${stu.name}：${t}`; });
    if (prog) prog.innerHTML = `${sflEsc(stu.name)}：完成，共 ${r.total} 个文件，成功 ${r.total - r.failed.length} 个。${sflFailedHtml(r.failed)}`;
    sflRowUpdate(id);
  } catch (e) { if (prog) prog.innerHTML = `<span style="color:var(--danger)">${sflEsc(stu.name)} 打包失败：${sflEsc(e.message || e)}</span>`; }
  SFL.busy = false;
}
// 勾选多个学生：一个学生一个 zip，一个下完再下一个
async function sflZipBatch() {
  if (SFL.busy) { alert('正在打包中，请等当前任务完成'); return; }
  const ids = [...SFL.sel].filter(id => sflStudentOf(id));
  if (!ids.length) return;
  if (!confirm(`将依次为 ${ids.length} 名学生各打包下载一个 zip（一个下完再下一个）。浏览器可能会询问是否允许下载多个文件，请选择允许。继续？`)) return;
  const prog = document.getElementById('sflBatchProg');
  SFL.busy = true;
  const report = [];
  for (let k = 0; k < ids.length; k++) {
    const stu = sflStudentOf(ids[k]);
    try {
      const r = await sflZipStudent(stu, t => { if (prog) prog.textContent = `第 ${k + 1} / ${ids.length} 个：${stu.name}　${t}`; });
      report.push(`${stu.name}：${r.total} 个文件${r.failed.length ? `，${r.failed.length} 个失败` : ''}`);
      if (r.failed.length) report.push(...r.failed.map(x => `　失败：${stu.name} / ${x.path}`));
    } catch (e) { report.push(`${stu.name}：打包失败（${(e && e.message) || e}）`); }
    sflRowUpdate(ids[k]);
  }
  SFL.busy = false;
  SFL.zipMsg = '';
  if (prog) prog.innerHTML = '全部完成：<br>' + report.map(sflEsc).join('<br>');
}
