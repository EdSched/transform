// ══════════════════════════════════
// interview-export.js — 下载学生保存的面试回答（Word / PDF）
// 学生端（学习页「面试准备」）、管理端 / 老师端（riyuStaffListHtml 的面试稿列表、riyuStaffView 弹窗）共用
// 内容：文件头（学生 / 专业 / 下载日期）→「老师补充的问题」（最前面，带老师要点）→ 各志望校一节（志望校题）→ 共用题一节；
//       每题「题目 + 回答」，没写的写「（未填写）」；关键词题（只读）不放进去
// 范围 scope：'current' 当前这所志望校 ｜ 'all' 全部志望校 + 共用题；格式 format：'word' ｜ 'pdf'（新窗口加载 Noto 字体后 window.print()，选「存为 PDF」）
// 依赖：shared/supabase.js（sbAll）、shared/riyu.js（riyuEsc / riyuKeyOf / riyuSecs）、shared/interview-bank.js
// 老师只能下载自己范围内的学生：teacher 页面里有 tsaStudentOk（shared/constants.js 的 teacherScope）就按它判断，数据库 RLS 另有一层
// ══════════════════════════════════
const IVX_STU = {};                                   // 学生 id → 学生对象（按钮只带 id）
const IVX_DLG = { student: null, school: '', scope: 'all', format: 'word', busy: false };

function ivxCanExport(student) { return !!student && !!student.id && (typeof tsaStudentOk !== 'function' || !!tsaStudentOk(student)); }
function ivxFileSafe(s) { return String(s == null ? '' : s).replace(/[\\/:*?"<>|]/g, '_'); }
function ivxDateStr(d) { d = d || new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }
function ivxDateText(d) { d = d || new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function ivxPlanName(p) { return [p.school_name, p.faculty, p.department].filter(Boolean).join(' · '); }
function ivxMajorName(student) { return (typeof MAJORS !== 'undefined' && MAJORS[student.major]) || student.major || ''; }

// ── 数据 ──
async function ivxLoadData(student) {
  const sid = encodeURIComponent(student.id), nc = { cache: 'no-store' };
  const [subs, plans, extras] = await Promise.all([
    sbAll(`/rest/v1/riyu_submissions?student_id=eq.${sid}&kind=eq.${RIYU_INTERVIEW_KIND}&select=*`, nc),
    sbAll(`/rest/v1/student_school_plans?student_id=eq.${sid}&select=*&order=level.asc`, nc).catch(() => []),
    ivbExtrasLoad(student.id),
  ]);
  await ivbLoadPublishedKeys();
  const key = ivbKeyFor(student), banks = {};
  const variantOf = p => (key ? ivbVariantFor(student, p, null, key) : '');
  if (key) for (const v of new Set([''].concat(plans.map(variantOf)).map(x => x || ''))) { banks[v] = await ivbLoad(key, false, v); }
  const bankOf = p => (key ? (banks[variantOf(p) || ''] || banks[''] || null) : null);
  return { subs, plans, extras, bankOf };
}

// ── 模型（纯函数，方便测试）──
// data = { subs, plans, extras, bankOf(plan|null) → bank | null }
// 返回 { studentName, major, date, scopeText, groups:[{ kind:'extra'|'school'|'common', title, sections:[{ title, items:[{ q, a, note }] }] }], empty }
function ivxChapterSection(bank, ch, subs, rowKey) {
  const items = ivbVisibleItems(ch).filter(it => ivbAnswerable(ch, it)).map(it => ({ q: it.q, a: ivbAnswer(subs, rowKey, it.key, null).trim(), note: '' }));
  return items.length ? { title: ch.title, items } : null;
}
function ivxBuildModel(student, scope, schoolKey, data, now) {
  const subs = data.subs || [], plans = (data.plans || []).slice().sort((a, b) => (a.level || 2) - (b.level || 2));
  const cur = scope === 'current' ? plans.find(p => riyuKeyOf(p) === schoolKey) : null;
  const all = !cur;
  const groups = [];
  // ① 老师补充的问题（最前面；当前志望校 = 属于这所校和共用行的；全部 = 全部）
  const exs = (all ? (data.extras || []).filter(e => e && e.item_key) : ivbExtrasFor(data.extras, schoolKey));
  if (exs.length) groups.push({ kind: 'extra', title: IVB_EXTRA_TITLE, sections: [{ title: '', items: exs.map(e => ({ q: e.q, a: ivbAnswer(subs, e.row_key, e.item_key, null).trim(), note: String(e.teacher_note || '').trim() })) }] });
  // ② 各志望校（志望校题）
  (all ? plans : [cur]).forEach(p => {
    const bank = data.bankOf(p); if (!bank) return;
    const rk = riyuKeyOf(p);
    const secs = bank.chapters.filter(ch => ch.scope === 'school').map(ch => ivxChapterSection(bank, ch, subs, rk)).filter(Boolean);
    if (!secs.length && cur) {   // 当前这所校的题库没有各校章：退回共用章，避免导出空文件
      bank.chapters.filter(ch => ch.scope !== 'school').forEach(ch => { const s = ivxChapterSection(bank, ch, subs, ivbCommonKey(bank.variant)); if (s) secs.push(s); });
    }
    if (secs.length) groups.push({ kind: 'school', title: ivxPlanName(p) || '（未命名学校）', sections: secs });
  });
  // ③ 共用题（只在「全部」里；多个版本各一节）
  if (all) {
    const seen = new Set(), banks = [];
    (plans.length ? plans : [null]).forEach(p => { const b = data.bankOf(p); if (b && !seen.has(b.variant || '')) { seen.add(b.variant || ''); banks.push(b); } });
    banks.forEach(bank => {
      const secs = bank.chapters.filter(ch => ch.scope !== 'school').map(ch => ivxChapterSection(bank, ch, subs, ivbCommonKey(bank.variant))).filter(Boolean);
      if (secs.length) groups.push({ kind: 'common', title: '共用题' + (banks.length > 1 ? ' · ' + ivbVariantLabel(bank) : ''), sections: secs });
    });
  }
  return { studentName: student.name || '', major: ivxMajorName(student), date: ivxDateText(now), scopeText: all ? '全部志望校 + 共用题' : ivxPlanName(cur), schoolForFile: all ? '全部' : (cur.school_name || ivxPlanName(cur)), groups, empty: !groups.length };
}

// ── 排版（Word 和 PDF 共用）──
function ivxBodyHtml(m) {
  const e = s => riyuEsc(s).replace(/\n/g, '<br>');
  const grp = m.groups.map((g, gi) => {
    const brk = g.kind === 'school' && gi > 0;   // 每所学校从新的一页开始（第一节本身不换页）
    return `<div class="grp${brk ? ' brk' : ''}"${brk ? ' style="page-break-before:always"' : ''}><h2>${e(g.title)}</h2>${g.sections.map(s => `${s.title ? `<h3>${e(s.title)}</h3>` : ''}${s.items.map(it => `<div class="qa"><p class="q">${e(it.q)}</p>${it.note ? `<p class="note">老师要点：${e(it.note)}</p>` : ''}<p class="a${it.a ? '' : ' empty'}">${e(it.a || '（未填写）')}</p></div>`).join('')}`).join('')}</div>`;
  }).join('');
  return `<h1>面试回答</h1>
    <table class="meta"><tr><td class="k">学生</td><td>${e(m.studentName)}</td></tr><tr><td class="k">专业</td><td>${e(m.major || '—')}</td></tr><tr><td class="k">范围</td><td>${e(m.scopeText)}</td></tr><tr><td class="k">下载日期</td><td>${e(m.date)}</td></tr></table>${grp}`;
}
function ivxWordBuild(m) {
  const css = `body{font-family:'Noto Serif SC','MS Mincho',serif;font-size:11pt;line-height:1.8}h1{text-align:center;font-size:16pt}h2{font-size:14pt;border-bottom:1pt solid #b8953a;padding-bottom:2pt;margin:16pt 0 6pt}h3{font-size:12pt;margin:12pt 0 4pt}.meta{border-collapse:collapse;font-size:11pt;margin-bottom:12pt}.meta td{padding:2pt 10pt 2pt 0}.meta .k{color:#666}p{margin:0}.q{font-weight:bold;margin-top:8pt}.note{color:#8a6a1b;font-size:10pt}.empty{color:#999}`;
  const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>${css}</style></head><body>${ivxBodyHtml(m)}</body></html>`;
  const name = `面试回答_${ivxFileSafe(m.studentName)}_${ivxFileSafe(m.schoolForFile)}_${ivxDateStr()}.doc`;
  return { blob: new Blob(['﻿', html], { type: 'application/msword' }), name, html };
}
function ivxPrintHtml(m) {
  const title = ivxFileSafe(`面试回答_${m.studentName}_${m.schoolForFile}_${ivxDateStr()}`);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&family=Noto+Sans+SC:wght@400;500&display=swap" rel="stylesheet"><title>${riyuEsc(title)}</title>
<style>
@page{size:A4;margin:16mm}
*{box-sizing:border-box}
body{font-family:'Noto Sans SC',system-ui,sans-serif;color:#1a1814;background:#fff;line-height:1.8;font-size:13px;max-width:760px;margin:0 auto;padding:16px}
h1{font-family:'Noto Serif SC',serif;font-size:24px;text-align:center;border-bottom:2px solid #b8953a;padding-bottom:10px;margin:0 0 14px}
h2{font-family:'Noto Serif SC',serif;font-size:17px;color:#b8953a;border-bottom:1px solid #e2ded6;padding-bottom:3px;margin:22px 0 8px}
h3{font-family:'Noto Serif SC',serif;font-size:14px;margin:14px 0 4px}
.meta{border-collapse:collapse;margin-bottom:8px;font-size:13px}.meta td{padding:2px 14px 2px 0}.meta .k{color:#9a9590}
p{margin:0}.qa{page-break-inside:avoid;break-inside:avoid;margin-bottom:10px}.q{font-weight:600;margin-top:6px}
.note{font-size:12px;color:#8a6a1b;background:#faf6ec;border:1px solid #efe4c8;border-radius:3px;padding:3px 8px;margin:3px 0}
.a{white-space:normal;color:#3a352e}.a.empty{color:#9a9590}
@media print{body{padding:0}.grp.brk{page-break-before:always;break-before:page}}
</style></head><body>${ivxBodyHtml(m)}
<script>window.onload=function(){ if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){setTimeout(function(){window.print()},400)})}else{setTimeout(function(){window.print()},1200)} }<\/script>
</body></html>`;
}

// ── 导出入口 ──
// opts: { school: 当前志望校 key, returnOnly: true 时不下载 / 不开窗口，只返回 { blob, name, html }（测试用）}
async function ivbAnswersExport(student, scope, format, opts) {
  opts = opts || {};
  let w = null;
  if (format === 'pdf' && !opts.returnOnly) {   // 必须在点击的同一时刻开窗口（异步之后再开会被浏览器拦截）
    w = window.open('', '_blank');
    if (!w) { alert('浏览器拦截了新窗口，请允许弹出窗口后重试'); return null; }
    w.document.write('<p style="font:14px sans-serif;padding:20px">正在生成…</p>');
  }
  try {
    const data = opts.data || await ivxLoadData(student);
    const m = ivxBuildModel(student, scope, opts.school || '', data);
    if (m.empty) throw new Error('这位学生还没有可下载的面试题');
    if (format === 'pdf') {
      const html = ivxPrintHtml(m);
      if (w) { w.document.open(); w.document.write(html); w.document.close(); }
      return { html };
    }
    const r = ivxWordBuild(m);
    if (!opts.returnOnly) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.blob); a.download = r.name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    return r;
  } catch (err) {
    if (w) { try { w.close(); } catch (e2) { /* ignore */ } }
    if (opts.returnOnly) throw err;
    alert('下载失败：' + (err && err.message || err));
    return null;
  }
}

// ── 选择弹窗：范围 / 格式（chip，不用 radio）──
function ivxBtnHtml(student, schoolKey, label, style) {
  if (!ivxCanExport(student)) return '';
  IVX_STU[student.id] = student;
  return `<button onclick="event.stopPropagation();ivxOpenById('${riyuEsc(student.id)}','${riyuEsc(schoolKey || '')}')" style="${style || 'font-size:10px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--surface,#fff);padding:2px 8px;cursor:pointer;font-family:inherit;white-space:nowrap'}">${riyuEsc(label || '下载面试回答')}</button>`;
}
function ivxOpenById(id, schoolKey) { const s = IVX_STU[id] || (typeof RIYU_STAFF !== 'undefined' && RIYU_STAFF.students[id]); if (s) ivxOpen(s, schoolKey); }
async function ivxOpen(student, schoolKey) {
  if (!ivxCanExport(student)) return;
  const isSchool = schoolKey && !ivbIsCommonKey(schoolKey);
  Object.assign(IVX_DLG, { student, school: isSchool ? schoolKey : '', scope: isSchool ? 'current' : 'all', format: 'word', busy: false, curName: '' });
  ivxDlgDraw();
  if (isSchool) {   // 读志望校名字给「当前志望校」chip 用
    try {
      const rows = await sbAll(`/rest/v1/student_school_plans?student_id=eq.${encodeURIComponent(student.id)}&select=*`, { cache: 'no-store' });
      const p = rows.find(x => riyuKeyOf(x) === schoolKey);
      if (p) IVX_DLG.curName = ivxPlanName(p); else { IVX_DLG.school = ''; IVX_DLG.scope = 'all'; }
    } catch (e) { /* 读不到就只显示「当前志望校」 */ }
    ivxDlgDraw();
  }
}
function ivxChip(label, on, click) {
  return `<span onclick="${click}" style="cursor:pointer;padding:5px 13px;border-radius:3px;font-size:12px;white-space:nowrap;border:1px solid ${on ? 'var(--accent,#b8953a)' : 'var(--border,#e2ded6)'};background:${on ? 'var(--btn-bg,#efe9e1)' : 'var(--surface,#fff)'};color:${on ? 'var(--btn-fg,#3a2e24)' : 'var(--text-secondary,#5a5650)'};font-weight:${on ? 600 : 400}">${riyuEsc(label)}</span>`;
}
function ivxDlgDraw() {
  const d = IVX_DLG; if (!d.student) return;
  let ov = document.getElementById('ivxModal');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'ivxModal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.onclick = e => { if (e.target === ov) ivxClose(); };
    document.body.appendChild(ov);
  }
  const lbl = 'font-size:11px;color:var(--text-muted,#999);margin:12px 0 6px';
  ov.innerHTML = `<div style="background:var(--surface,#fff);border-radius:6px;padding:18px 20px;max-width:440px;width:100%">
    <div style="font-size:14px;font-weight:600;margin-bottom:2px">下载面试回答</div>
    <div style="font-size:11px;color:var(--text-secondary,#5a5650)">${riyuEsc(d.student.name || '')}</div>
    <div style="${lbl}">范围</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${d.school ? ivxChip('当前志望校' + (d.curName ? '：' + d.curName : ''), d.scope === 'current', "ivxSet('scope','current')") : ''}${ivxChip('全部志望校 + 共用题', d.scope === 'all', "ivxSet('scope','all')")}</div>
    <div style="${lbl}">格式</div>
    <div style="display:flex;gap:6px">${ivxChip('Word', d.format === 'word', "ivxSet('format','word')")}${ivxChip('PDF', d.format === 'pdf', "ivxSet('format','pdf')")}</div>
    <div style="font-size:10px;color:var(--text-muted,#999);margin-top:8px">${d.format === 'pdf' ? '会打开新窗口，在打印窗口里选「另存为 PDF」。' : ''}老师补充的问题放在最前面；没写的题显示「（未填写）」。</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button onclick="ivxClose()" style="font-size:12px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--surface,#fff);padding:6px 16px;cursor:pointer;font-family:inherit">取消</button>
      <button onclick="ivxGo()" ${d.busy ? 'disabled' : ''} style="font-size:12px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:3px;padding:6px 18px;cursor:pointer;font-family:inherit">${d.busy ? '生成中…' : '下载'}</button></div></div>`;
}
function ivxSet(k, v) { IVX_DLG[k] = v; ivxDlgDraw(); }
function ivxClose() { const ov = document.getElementById('ivxModal'); if (ov) ov.remove(); }
async function ivxGo() {
  const d = IVX_DLG; if (!d.student || d.busy) return;
  const { student, scope, format, school } = d;
  if (format === 'pdf') { ivxClose(); await ivbAnswersExport(student, scope, format, { school }); return; }   // PDF：先开窗口，不能先 await
  d.busy = true; ivxDlgDraw();
  const r = await ivbAnswersExport(student, scope, format, { school });
  d.busy = false;
  if (r) ivxClose(); else ivxDlgDraw();
}
