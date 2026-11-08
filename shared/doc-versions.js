// ══════════════════════════════════
// doc-versions.js — 学生文件分版本（计划书 plan / 面试稿 interview）
// 表 student_doc_versions：一次上传 = 一行（只追加，不覆盖）；批复写在同一行的 review_*。
// 「用途」= school_key 为空是通用版；否则是某个志望校（key 用 riyuKeyOf）。version_no 在同一学生・同一类型・同一用途内递增。
// 依赖：shared/supabase.js（sb / sbUpload）。riyuReviewerName / riyuFmtTime 来自 riyu.js（有就用，没有就退回默认）。
// ══════════════════════════════════
const DOCV = { rows: {}, onChange: null, mounts: {} };

function docvEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function docvMD(t) { const d = t ? new Date(t) : null; return d && !isNaN(d) ? `${d.getMonth() + 1}/${d.getDate()}` : ''; }
function docvPurpose(v) {
  if (!v || !v.school_key) return '通用版';
  const nm = (v.school_name || '').trim() || String(v.school_key).split('|').filter(Boolean).join(' ');
  return nm + '版';
}
function docvTitle(v) { return `${docvPurpose(v)} 第 ${v.version_no} 版`; }
function docvTypeName(t) { return t === 'interview' ? '面试稿' : '计划书'; }

// 存储文件名只能是 ASCII：原文件名里的非 ASCII 字符去掉，真名放在 file_name 列里
function docvStoreName(file) {
  const raw = String(file && file.name || 'file');
  const dot = raw.lastIndexOf('.');
  const ext = (dot >= 0 ? raw.slice(dot + 1) : 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const base = (dot >= 0 ? raw.slice(0, dot) : raw).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'file';
  return `${Date.now()}_${base}.${ext}`;
}
function docvDir(sid, docType) { return `students/${String(sid).replace(/[^A-Za-z0-9_-]/g, '_')}/${docType === 'interview' ? 'interview' : 'plan'}`; }

async function docvLoad(sid, docType) {
  const q = `student_id=eq.${encodeURIComponent(sid)}${docType ? `&doc_type=eq.${docType}` : ''}`;
  const rows = await sb(`/rest/v1/student_doc_versions?${q}&select=*&order=submitted_at.desc`, 'GET', null, { cache: 'no-store' });
  (rows || []).forEach(r => { DOCV.rows[r.id] = r; });
  return rows || [];
}
async function docvGetMany(ids) {
  const need = [...new Set(ids)].filter(i => i != null && !DOCV.rows[i]);
  if (need.length) {
    const rows = await sb(`/rest/v1/student_doc_versions?id=in.(${need.join(',')})&select=*`, 'GET', null, { cache: 'no-store' }).catch(() => []);
    (rows || []).forEach(r => { DOCV.rows[r.id] = r; });
  }
  return ids.map(i => DOCV.rows[i]).filter(Boolean);
}

// 学生上传一个新版本。opts: { student:{id,name,major}, docType, schoolKey, schoolName, file, note, source, bookingId }
// 返回新建的版本行。计划书同时把 student_plan_drafts.draft_file_url 改成最新一版（考学进度、任务检查、月报仍读这个字段）。
async function docvCreate(opts) {
  const { student, docType = 'plan', schoolKey = '', schoolName = '', file, note = '', source = 'upload', bookingId = null } = opts;
  if (!student || !student.id || !file) throw new Error('缺少学生或文件');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['doc', 'docx', 'pdf'].includes(ext)) throw new Error('只能上传 Word（doc / docx）或 PDF');
  const fresh = await docvLoad(student.id, docType);   // 上传前再读一次，版本号不会撞
  const key = schoolKey || '';
  const no = fresh.filter(r => (r.school_key || '') === key).reduce((m, r) => Math.max(m, r.version_no || 0), 0) + 1;
  const url = await sbUpload('student-files', `${docvDir(student.id, docType)}/${docvStoreName(file)}`, file);
  const row = {
    student_id: String(student.id), doc_type: docType, version_no: no,
    school_key: key || null, school_name: key ? (schoolName || null) : null,
    file_url: url, file_name: file.name, source, booking_id: bookingId ? String(bookingId) : null,
    student_note: (note || '').trim() || null, submitted_at: new Date().toISOString(),
  };
  const ins = await sb('/rest/v1/student_doc_versions', 'POST', row);
  const saved = (ins && ins[0]) || row;
  DOCV.rows[saved.id] = saved;
  if (docType === 'plan') await docvSyncDraft(student, url);
  return saved;
}
// 兼容旧字段：最新一版的地址写回 student_plan_drafts.draft_file_url（没有草稿行就新建）。返回草稿行。
async function docvSyncDraft(student, url) {
  const now = new Date().toISOString();
  const cur = await sb(`/rest/v1/student_plan_drafts?student_id=eq.${encodeURIComponent(student.id)}&select=*&order=updated_at.desc&limit=1`, 'GET', null, { cache: 'no-store' }).catch(() => []);
  const d = (cur || [])[0];
  if (d) {
    const patch = { draft_file_url: url, updated_at: now };
    await sb(`/rest/v1/student_plan_drafts?id=eq.${d.id}`, 'PATCH', patch);
    return { ...d, ...patch };
  }
  const data = { id: `spd-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`, student_id: student.id, student_name: student.name, major: student.major, draft_file_url: url, status: 'drafting', updated_at: now };
  await sb('/rest/v1/student_plan_drafts', 'POST', data);
  return data;
}

// 按用途分组：通用版在前，其余按最近一次提交倒序；组内新版在上
function docvGroups(rows) {
  const m = new Map();
  (rows || []).forEach(r => { const k = r.school_key || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  const gs = [...m.entries()].map(([k, list]) => ({ key: k, list: list.sort((a, b) => (b.version_no || 0) - (a.version_no || 0)) }));
  gs.sort((a, b) => (a.key ? 1 : 0) - (b.key ? 1 : 0) || String(b.list[0].submitted_at).localeCompare(String(a.list[0].submitted_at)));
  return gs;
}
function docvStamp(r) {
  const by = r.reviewed_by ? ` · ${docvEsc(r.reviewed_by)}` : '';
  return `${docvEsc(docvMD(r.reviewed_at))}${by}`;
}

// ── 学生端：全部版本（按用途分组，新的在上）。只读，不含上传控件 ──
function docvStudentListHtml(rows) {
  if (!rows || !rows.length) return '<div style="font-size:11px;color:var(--text-muted,#999);padding:8px 0">还没有上传过</div>';
  return docvGroups(rows).map(g => `<div style="margin-top:10px">
    <div style="font-size:11px;font-weight:600;margin-bottom:4px">${docvEsc(docvPurpose(g.list[0]))}</div>
    ${g.list.map(r => {
      const done = !!r.review_file_url;
      return `<div style="border:1px solid var(--border-light,#ede9e2);border-radius:3px;padding:6px 9px;margin-bottom:4px;font-size:11px;background:var(--surface,#fff)">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span style="font-weight:600">第 ${r.version_no} 版</span>
          <span style="color:var(--text-muted,#999)">${docvEsc(docvMD(r.submitted_at))}</span>
          <a href="${docvEsc(r.file_url)}" target="_blank" style="color:var(--accent,#b8953a)">${docvEsc(r.file_name || '文件')} ⬇</a>
          <span style="margin-left:auto;padding:1px 8px;border-radius:10px;font-size:10px;background:${done ? '#e4f0e8' : '#fdf6e3'};color:${done ? '#2a7a4a' : '#b8860b'}">${done ? '已批复' : '待批复'}</span>
        </div>
        ${r.student_note ? `<div style="color:var(--text-muted,#999);margin-top:3px">说明：${docvEsc(r.student_note)}</div>` : ''}
        ${done ? `<div style="margin-top:4px;background:#e4f0e8;border-radius:3px;padding:5px 8px;color:#1f5a36">老师批复：<a href="${docvEsc(r.review_file_url)}" target="_blank" style="color:#1f5a36;font-weight:600">${docvEsc(r.review_file_name || '批复文件')} ⬇</a>${r.review_note ? ` · ${docvEsc(r.review_note)}` : ''} · ${docvStamp(r)}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`).join('');
}

// ── 老师端 / 管理端：版本列表，每版一行，右边「上传批复」 ──
// opts: { focusId, docType }
function docvStaffHtml(rows, opts) {
  opts = opts || {};
  if (!rows || !rows.length) return `<div style="font-size:11px;color:var(--text-3,#999);margin-bottom:10px">学生尚未上传${docvTypeName(opts.docType)}文件</div>`;
  const line = r => {
    const done = !!r.review_file_url;
    const focus = String(opts.focusId) === String(r.id);
    return `<div id="docv_row_${r.id}" style="border:1px solid ${focus ? 'var(--accent,#b8953a)' : 'var(--border-light,#ede9e2)'};background:${focus ? '#fbf6e6' : 'var(--surface,#fff)'};border-radius:3px;padding:6px 9px;margin-bottom:4px;font-size:11px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span style="font-weight:600">${docvEsc(docvTitle(r))}</span>
        <span style="color:var(--text-3,#999)">${docvEsc(docvMD(r.submitted_at))}</span>
        <a href="${docvEsc(r.file_url)}" target="_blank" style="color:var(--accent,#b8953a)">学生文件 ⬇</a>
        <span style="padding:1px 8px;border-radius:10px;font-size:10px;background:${done ? '#e4f0e8' : '#fdf6e3'};color:${done ? '#2a7a4a' : '#b8860b'}">${done ? '已批复' : '待批复'}</span>
        <button onclick="docvReviewOpen(${r.id})" style="margin-left:auto;font-size:11px;padding:3px 12px;border:1px solid var(--accent,#b8953a);border-radius:3px;background:none;color:var(--accent,#b8953a);cursor:pointer;font-family:inherit">${done ? '重新上传批复' : '上传批复'}</button>
      </div>
      ${r.student_note ? `<div style="color:var(--text-3,#999);margin-top:3px">学生说明：${docvEsc(r.student_note)}</div>` : ''}
      ${done ? `<div style="margin-top:3px;color:#1f5a36">批复：<a href="${docvEsc(r.review_file_url)}" target="_blank" style="color:#1f5a36">${docvEsc(r.review_file_name || '批复文件')} ⬇</a>${r.review_note ? ` · ${docvEsc(r.review_note)}` : ''} · ${docvStamp(r)}</div>` : ''}
    </div>`;
  };
  return `<div style="margin-bottom:10px">${docvGroups(rows).map(g => {
    const open = g.list.slice(0, 3), rest = g.list.slice(3);
    const hasFocus = rest.some(r => String(r.id) === String(opts.focusId));
    return `<div style="margin-bottom:6px">${open.map(line).join('')}${rest.length ? `<details${hasFocus ? ' open' : ''}><summary style="cursor:pointer;font-size:10px;color:var(--text-3,#999);margin-bottom:4px">更早的 ${rest.length} 版</summary>${rest.map(line).join('')}</details>` : ''}</div>`;
  }).join('')}</div>`;
}

function docvReviewOpen(id) {
  const v = DOCV.rows[id]; if (!v) return;
  document.getElementById('docvRvModal')?.remove();
  const ov = document.createElement('div');
  ov.id = 'docvRvModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
  const inp = 'width:100%;box-sizing:border-box;font-size:12px;padding:7px 9px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--bg,#f7f5f0);font-family:inherit';
  ov.innerHTML = `<div style="background:var(--surface,#fff);border-radius:6px;padding:18px 20px;max-width:460px;width:100%">
    <div style="font-size:14px;font-weight:600;margin-bottom:4px">上传批复 · ${docvEsc(docvTitle(v))}</div>
    <div style="font-size:10px;color:var(--text-3,#999);margin-bottom:12px">${v.review_file_url ? '这一版已有批复，重新上传会覆盖它（只影响这一版）' : '批复只对应这一版'}</div>
    <label style="font-size:10px;color:var(--text-3,#999);display:block;margin-bottom:3px">批复文件（Word / PDF）</label>
    <input type="file" id="docvRvFile" accept=".doc,.docx,.pdf" style="${inp};margin-bottom:10px">
    <label style="font-size:10px;color:var(--text-3,#999);display:block;margin-bottom:3px">批复备注（可选，学生能看到）</label>
    <textarea id="docvRvNote" rows="2" style="${inp};resize:vertical;margin-bottom:12px">${docvEsc(v.review_note || '')}</textarea>
    <div id="docvRvMsg" style="font-size:11px;color:var(--danger,#b03a2e);min-height:14px;margin-bottom:6px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('docvRvModal').remove()" style="font-size:12px;padding:7px 14px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:none;cursor:pointer;font-family:inherit">取消</button>
      <button id="docvRvBtn" onclick="docvReviewDo(${id})" style="font-size:12px;padding:7px 18px;border:none;border-radius:3px;background:var(--accent,#b8953a);color:#fff;cursor:pointer;font-family:inherit">上传</button>
    </div></div>`;
  document.body.appendChild(ov);
}
async function docvReviewDo(id) {
  const v = DOCV.rows[id]; if (!v) return;
  const f = document.getElementById('docvRvFile')?.files?.[0];
  const msg = document.getElementById('docvRvMsg');
  if (!f) { msg.textContent = '请选择文件'; return; }
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (!['doc', 'docx', 'pdf'].includes(ext)) { msg.textContent = '只能上传 Word（doc / docx）或 PDF'; return; }
  const btn = document.getElementById('docvRvBtn'); btn.disabled = true; btn.textContent = '上传中…';
  try {
    const url = await sbUpload('teacher-files', `${docvDir(v.student_id, v.doc_type)}/${docvStoreName(f)}`, f);
    const patch = {
      review_file_url: url, review_file_name: f.name,
      review_note: (document.getElementById('docvRvNote')?.value || '').trim() || null,
      reviewed_by: typeof riyuReviewerName === 'function' ? riyuReviewerName() : '管理员',
      reviewed_at: new Date().toISOString(),
    };
    await sb(`/rest/v1/student_doc_versions?id=eq.${id}`, 'PATCH', patch);
    Object.assign(v, patch);
    document.getElementById('docvRvModal')?.remove();
    Object.keys(DOCV.mounts).forEach(docvMountFill);   // 嵌在卡片 / 弹窗里的版本列表一起刷新
    if (typeof DOCV.onChange === 'function') DOCV.onChange(v);
  } catch (e) {
    msg.textContent = '上传失败：' + e.message;
    btn.disabled = false; btn.textContent = '上传';
  }
}

// ── 嵌入式版本列表（考学进度卡片里的面试稿、学生提交里打开的弹窗）：先放占位，再读库填进去 ──
function docvMountHtml(sid, docType, focusId) {
  const id = `docvbox_${String(sid).replace(/[^A-Za-z0-9_-]/g, '_')}_${docType}`;
  DOCV.mounts[id] = { sid, docType, focusId: focusId || null };
  setTimeout(() => docvMountFill(id), 0);
  return `<div id="${id}"><div style="font-size:11px;color:var(--text-3,#999)">加载中…</div></div>`;
}
async function docvMountFill(id) {
  const m = DOCV.mounts[id], el = document.getElementById(id);
  if (!m) return;
  if (!el) { delete DOCV.mounts[id]; return; }
  try { el.innerHTML = docvStaffHtml(await docvLoad(m.sid, m.docType), { docType: m.docType, focusId: m.focusId }); }
  catch (e) { el.innerHTML = '<div style="font-size:11px;color:var(--text-3,#999)">版本记录读取失败</div>'; }
}
// 单独打开某个学生某类文件的版本列表（计划书以外，如面试稿；从「学生提交」点进来）
function docvOpenStaffModal(sid, name, docType, focusId) {
  document.getElementById('docvListModal')?.remove();
  const ov = document.createElement('div');
  ov.id = 'docvListModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div style="background:var(--surface,#fff);border-radius:6px;padding:18px 20px;max-width:640px;width:100%;max-height:88vh;overflow-y:auto">
    <div style="display:flex;align-items:center;margin-bottom:10px"><div style="font-size:14px;font-weight:600;flex:1">${docvEsc(docvTypeName(docType))} · 版本　—　${docvEsc(name)}</div>
    <button onclick="document.getElementById('docvListModal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-3,#999)">×</button></div>
    ${docvMountHtml(sid, docType, focusId)}</div>`;
  document.body.appendChild(ov);
  setTimeout(() => { const e = document.getElementById('docv_row_' + focusId); if (e) e.scrollIntoView({ block: 'center' }); }, 400);
}

// ── 面谈卡片：「📄 计划书 通用版 第 3 版 ⬇」，点开直接定位到这一版的批复弹窗 ──
// 卡片是同步渲染的，先放占位，再统一补全版本信息
function docvBookingLinkHtml(b) {
  if (!b || !b.plan_version_id) return '';
  setTimeout(docvFillBookingLinks, 60); setTimeout(docvFillBookingLinks, 800);
  return `<div data-docv-pv="${docvEsc(b.plan_version_id)}" data-name="${docvEsc(b.name || '')}" style="font-size:11px;margin-bottom:8px;color:var(--text-3,#999)">📄 计划书（读取中…）</div>`;
}
async function docvFillBookingLinks() {
  const els = [...document.querySelectorAll('[data-docv-pv]:not([data-done])')];
  if (!els.length) return;
  const rows = await docvGetMany(els.map(e => Number(e.dataset.docvPv)));
  els.forEach(el => {
    const v = DOCV.rows[Number(el.dataset.docvPv)];
    el.dataset.done = '1';
    if (!v) { el.textContent = '📄 计划书（版本已不存在）'; return; }
    const nm = (el.dataset.name || '').replace(/'/g, "\\'");
    el.innerHTML = `📄 计划书 ${docvEsc(docvTitle(v))} <a href="${docvEsc(v.file_url)}" target="_blank" style="color:var(--accent,#b8953a)">⬇</a>
      <a href="javascript:void(0)" onclick="docvOpenFromBooking(${v.id},'${docvEsc(nm)}')" style="color:var(--accent,#b8953a);margin-left:8px">批复 ›</a>`;
    el.style.color = 'var(--text-2,#5a5650)';
  });
}
function docvOpenFromBooking(vid, name) {
  const v = DOCV.rows[vid]; if (!v) return;
  if (typeof openTeacherDraftComment === 'function') openTeacherDraftComment(v.student_id, name || '', { versionId: v.id });
  else window.open(v.file_url, '_blank');
}
