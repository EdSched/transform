// ══════════════════════════════════
// consult-admin.js — 管控台「咨询台」：维护常见问题（faq）和课程推荐规则（consult_rules）
// 老师端「咨询」（teacher/teacher-consult.js）读取这两张表。只有管理员能改（RLS 见 seed/consult_phase2.sql）。
// 全局名字统一用 csa / CSA_ 前缀。依赖：shared/constants.js、shared/supabase.js、admin.js（switchConsoleTab）
// ══════════════════════════════════
const CSA_STAGES = ['信息采集', '选校', '课程', '价格', '入学后'];
const CSA_LEVELS = [['daigakuin', '大学院'], ['gakubu', '学部']];
const CSA_GAPS = [['jp', '日语成绩'], ['en', '英语成绩'], ['plan', '研究计划书・志望理由书'], ['interview', '面试'], ['written', '笔试'], ['specialty', '专业能力（跨专业补课）']];
let csa = { tab: 'faq', faq: null, rules: null, files: null, leads: null, teachers: [], lq: '', edit: null, body: null, err: '' };
const csaE = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const csaJ = v => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');

async function csaMount(body) {
  csa.body = body || csa.body; csa.edit = null;
  csa.body.innerHTML = '<div style="padding:20px;color:var(--text-3);font-size:12px">加载中…</div>';
  try {
    [csa.faq, csa.rules, csa.files, csa.leads, csa.teachers] = await Promise.all([
      sbAll('/rest/v1/faq?select=*&order=sort.asc,created_at.asc', { cache: 'no-store' }),
      sbAll('/rest/v1/consult_rules?select=*&order=sort.asc,created_at.asc', { cache: 'no-store' }).catch(() => null),
      sbAll('/rest/v1/consult_files?select=*&order=sort.asc,created_at.asc', { cache: 'no-store' }).catch(() => null),
      sbAll('/rest/v1/consult_leads?select=*&order=updated_at.desc', { cache: 'no-store' }).catch(() => []),
      sb('/rest/v1/teachers?select=id,name').catch(() => []),
    ]);
    csa.err = '';
  } catch (e) { csa.err = e.message; }
  csaRender();
}
const csaChip = (on, label, click) => `<span class="filter-chip${on ? ' active' : ''}" onclick="${click}">${label}</span>`;
function csaRender() {
  const b = csa.body; if (!b) return;
  if (csa.err) { b.innerHTML = `<div style="padding:20px;color:var(--danger,#b03a2e);font-size:12px">读取失败：${csaE(csa.err)}</div>`; return; }
  const tabs = [['faq', '常见问题'], ['rules', '课程推荐规则'], ['brochure', '宣传册'], ['trial', '试讲视频'], ['leads', '咨询者']].map(([k, t]) => csaChip(csa.tab === k, t, `csa.tab='${k}';csa.edit=null;csaRender()`)).join('');
  b.innerHTML = `<div style="padding:14px 18px;max-width:900px"><div style="display:flex;gap:6px;margin-bottom:12px">${tabs}</div>${csa.tab === 'faq' ? csaFaqHtml() : csa.tab === 'rules' ? csaRulesHtml() : csa.tab === 'leads' ? csaLeadsHtml() : csaFilesHtml()}</div>`;
}
function csaToggle(k, v) { const a = csa.edit[k], i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); csaCapture(); csaRender(); }
function csaCapture() {
  const g = id => { const el = document.getElementById(id); return el ? el.value : undefined; }, e = csa.edit; if (!e) return;
  if (csa.tab === 'faq') { const q = g('csa_q'), a = g('csa_a'), s = g('csa_s'); if (q !== undefined) { e.question = q; e.answer = a; e.sort = parseInt(s) || 0; } }
  else if (csa.tab === 'brochure' || csa.tab === 'trial') { const t = g('csa_ft'), u = g('csa_fu'), te = g('csa_fe'), k = g('csa_fk'), m = g('csa_fm'), s = g('csa_s'); if (t !== undefined) { e.title = t; e.url = u; e.teacher = te; e.keyword = k; e.major = m; e.sort = parseInt(s) || 0; } }
  else { const t = g('csa_t'), k = g('csa_k'), gp = g('csa_g'), s = g('csa_s'); if (t !== undefined) { e.title = t; e.keywords_text = k; e.gap = gp; e.sort = parseInt(s) || 0; } }
}
const csaIn = 'width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box;font-family:inherit';
const csaMajorKeys = () => Object.keys(ADMISSION_MAJORS);

// ── 常见问题 ──
function csaFaqNew() { csa.edit = { id: '', question: '', answer: '', levels: [], majors: [], stages: [], sort: (csa.faq.length + 1) * 10, published: true }; csaRender(); }
function csaFaqOpen(id) { const f = csa.faq.find(x => x.id === id); if (!f) return; csa.edit = { ...f, levels: [...(f.levels || [])], majors: [...(f.majors || [])], stages: [...(f.stages || [])] }; csaRender(); }
function csaFaqHtml() {
  const e = csa.edit;
  if (e) return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:14px">
    <div style="font-size:11px;color:var(--text-3);margin-bottom:3px">问题</div><input id="csa_q" value="${csaE(e.question)}" style="${csaIn}">
    <div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">回答</div><textarea id="csa_a" rows="6" style="${csaIn}">${csaE(e.answer)}</textarea>
    <div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">适用层次（不选 = 全部）</div><div style="display:flex;gap:6px;flex-wrap:wrap">${CSA_LEVELS.map(([k, t]) => csaChip(e.levels.includes(k), t, `csaToggle('levels','${k}')`)).join('')}</div>
    <div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">适用专业（不选 = 全部）</div><div style="display:flex;gap:6px;flex-wrap:wrap">${csaMajorKeys().map(k => csaChip(e.majors.includes(k), csaE(ADMISSION_MAJORS[k]), `csaToggle('majors','${k}')`)).join('')}</div>
    <div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">适用阶段（不选 = 全部）</div><div style="display:flex;gap:6px;flex-wrap:wrap">${CSA_STAGES.map(k => csaChip(e.stages.includes(k), k, `csaToggle('stages','${k}')`)).join('')}</div>
    <div style="display:flex;gap:10px;align-items:center;margin-top:12px"><span style="font-size:11px;color:var(--text-3)">排序（小的在前）</span><input id="csa_s" type="number" value="${e.sort}" style="${csaIn};width:90px">
      ${csaChip(e.published, e.published ? '已发布' : '未发布（老师看不到）', `csaCapture();csa.edit.published=!csa.edit.published;csaRender()`)}</div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-primary btn-sm" onclick="csaFaqSave()">保存</button><button class="btn btn-outline btn-sm" onclick="csa.edit=null;csaRender()">取消</button>
      ${e.id ? `<button class="btn btn-outline btn-sm" style="margin-left:auto;color:var(--danger,#b03a2e)" onclick="csaDel('faq','${csaJ(e.id)}')">删除</button>` : ''}</div></div>`;
  return `<div style="display:flex;align-items:center;margin-bottom:10px"><span style="font-size:11px;color:var(--text-3)">共 ${csa.faq.length} 条。老师在咨询页右上角「常见问题」里看到，按咨询者的层次、专业、步骤自动筛选。</span><button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="csaFaqNew()">＋ 新增问题</button></div>
    ${csa.faq.map(f => `<div onclick="csaFaqOpen('${csaJ(f.id)}')" style="border:1px solid var(--border-light);border-radius:4px;padding:8px 12px;margin-bottom:6px;cursor:pointer;background:var(--surface)">
      <div style="font-size:12px;font-weight:600">${csaE(f.question)}${f.published === false ? ' <span style="font-size:10px;color:var(--text-3)">（未发布）</span>' : ''}</div>
      <div style="font-size:10px;color:var(--text-3);margin-top:2px">${csaE([(f.levels || []).map(k => (CSA_LEVELS.find(x => x[0] === k) || [0, k])[1]).join('/'), (f.majors || []).map(k => ADMISSION_MAJORS[k] || k).join('/'), (f.stages || []).join('/')].filter(Boolean).join(' · ') || '全部适用')}</div></div>`).join('') || '<div class="empty">还没有常见问题</div>'}`;
}
async function csaFaqSave() {
  csaCapture(); const e = csa.edit; if (!e.question.trim()) { alert('请填写问题'); return; }
  const rec = { question: e.question.trim(), answer: e.answer || '', levels: e.levels, majors: e.majors, stages: e.stages, sort: e.sort || 0, published: !!e.published, updated_at: new Date().toISOString() };
  try {
    if (e.id) await sb(`/rest/v1/faq?id=eq.${encodeURIComponent(e.id)}`, 'PATCH', rec); else await sb('/rest/v1/faq', 'POST', rec);
    await csaMount();
  } catch (err) { alert('保存失败：' + err.message); }
}

// ── 课程推荐规则：差距 → 课程（课程名里含任一关键词，就算覆盖这个差距）──
function csaRuleNew() { csa.edit = { id: '', gap: 'jp', title: '', keywords_text: '', majors: [], sort: (csa.rules.length + 1) * 10, published: true }; csaRender(); }
function csaRuleOpen(id) { const r = csa.rules.find(x => x.id === id); if (!r) return; csa.edit = { ...r, keywords_text: (r.keywords || []).join('、'), majors: [...(r.majors || [])] }; csaRender(); }
function csaRulesHtml() {
  const e = csa.edit;
  if (csa.rules === null) return '<div class="empty">还没有 consult_rules 表，请先执行 seed/consult_phase2.sql</div>';
  if (e) return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:14px">
    <div style="font-size:11px;color:var(--text-3);margin-bottom:3px">对应的差距</div>
    <select id="csa_g" style="${csaIn}">${CSA_GAPS.map(([k, t]) => `<option value="${k}" ${e.gap === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">规则名称（老师看到的说明，如「日语 N1 冲刺课」）</div><input id="csa_t" value="${csaE(e.title)}" style="${csaIn}">
    <div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">课程名关键词（用顿号或逗号分开；课程名里含任一个，就算覆盖这个差距）</div><input id="csa_k" value="${csaE(e.keywords_text)}" placeholder="例如：日语、N1、JLPT" style="${csaIn}">
    <div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">适用专业（不选 = 全部）</div><div style="display:flex;gap:6px;flex-wrap:wrap">${csaMajorKeys().map(k => csaChip(e.majors.includes(k), csaE(ADMISSION_MAJORS[k]), `csaToggle('majors','${k}')`)).join('')}</div>
    <div style="display:flex;gap:10px;align-items:center;margin-top:12px"><span style="font-size:11px;color:var(--text-3)">排序</span><input id="csa_s" type="number" value="${e.sort}" style="${csaIn};width:90px">
      ${csaChip(e.published, e.published ? '启用' : '停用', `csaCapture();csa.edit.published=!csa.edit.published;csaRender()`)}</div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-primary btn-sm" onclick="csaRuleSave()">保存</button><button class="btn btn-outline btn-sm" onclick="csa.edit=null;csaRender()">取消</button>
      ${e.id ? `<button class="btn btn-outline btn-sm" style="margin-left:auto;color:var(--danger,#b03a2e)" onclick="csaDel('consult_rules','${csaJ(e.id)}')">删除</button>` : ''}</div></div>`;
  return `<div style="display:flex;align-items:center;margin-bottom:10px"><span style="font-size:11px;color:var(--text-3)">差距 → 课程。咨询页会按这里的规则，给每个差距推荐课程；删掉课程导致某个差距没有课程覆盖时会提示。</span><button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="csaRuleNew()">＋ 新增规则</button></div>
    ${CSA_GAPS.map(([k, t]) => { const rs = csa.rules.filter(r => r.gap === k); return `<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:600;margin-bottom:4px">${t}</div>${rs.map(r => `<div onclick="csaRuleOpen('${csaJ(r.id)}')" style="border:1px solid var(--border-light);border-radius:4px;padding:7px 12px;margin-bottom:5px;cursor:pointer;background:var(--surface)"><span style="font-size:12px">${csaE(r.title)}</span> <span style="font-size:10px;color:var(--text-3)">关键词：${csaE((r.keywords || []).join('、'))}${(r.majors || []).length ? ' · ' + csaE(r.majors.map(m => ADMISSION_MAJORS[m] || m).join('/')) : ''}${r.published === false ? ' · 停用' : ''}</span></div>`).join('') || '<div style="font-size:10px;color:var(--text-3)">还没有规则</div>'}</div>`; }).join('')}`;
}
async function csaRuleSave() {
  csaCapture(); const e = csa.edit; if (!e.title.trim()) { alert('请填写规则名称'); return; }
  const kws = String(e.keywords_text || '').split(/[、,，;；\s]+/).map(x => x.trim()).filter(Boolean);
  if (!kws.length) { alert('请至少填一个课程名关键词'); return; }
  const rec = { gap: e.gap, title: e.title.trim(), keywords: kws, majors: e.majors, sort: e.sort || 0, published: !!e.published };
  try {
    if (e.id) await sb(`/rest/v1/consult_rules?id=eq.${encodeURIComponent(e.id)}`, 'PATCH', rec); else await sb('/rest/v1/consult_rules', 'POST', rec);
    await csaMount();
  } catch (err) { alert('保存失败：' + err.message); }
}
async function csaDel(table, id) {
  if (!confirm('确定删除？删除后不能恢复。')) return;
  try { await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, 'DELETE'); await csaMount(); } catch (err) { alert('删除失败：' + err.message); }
}

// ── 宣传册（按专业）/ 讲师试讲视频（按老师和课程）──
function csaFileNew() { csa.edit = { id: '', kind: csa.tab, major: '', title: '', url: '', teacher: '', keyword: '', sort: (csa.files.length + 1) * 10, published: true }; csaRender(); }
function csaFileOpen(id) { const f = csa.files.find(x => x.id === id); if (f) { csa.edit = { ...f }; csaRender(); } }
async function csaFileUpload(inp) {
  const f = inp.files && inp.files[0]; if (!f) return;
  const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const st = document.getElementById('csa_up'); if (st) st.textContent = '上传中…';
  try {
    const url = await sbUpload('admission-photos', `consult/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`, f);
    csaCapture(); csa.edit.url = url; if (!csa.edit.title) csa.edit.title = f.name.replace(/\.[^.]+$/, ''); csaRender();
  } catch (e) { if (st) st.textContent = ''; alert('上传失败：' + e.message); }
}
function csaFilesHtml() {
  const kind = csa.tab, isB = kind === 'brochure', e = csa.edit;
  if (csa.files === null) return '<div class="empty">还没有 consult_files 表，请先执行 seed/consult_phase2b.sql</div>';
  if (e) return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:14px">
    ${isB ? `<div style="font-size:11px;color:var(--text-3);margin-bottom:3px">专业</div><select id="csa_fm" style="${csaIn}"><option value="">请选择</option>${csaMajorKeys().map(k => `<option value="${k}" ${e.major === k ? 'selected' : ''}>${csaE(ADMISSION_MAJORS[k])}</option>`).join('')}</select>` : `<input type="hidden" id="csa_fm" value="">`}
    <div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">标题</div><input id="csa_ft" value="${csaE(e.title)}" style="${csaIn}">
    ${isB ? `<div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">文件（PDF 或图片）：上传，或直接填链接</div><input type="file" accept=".pdf,image/*" onchange="csaFileUpload(this)" style="font-size:12px"> <span id="csa_up" style="font-size:11px;color:var(--text-3)"></span>
      <input id="csa_fu" value="${csaE(e.url)}" placeholder="https://…" style="${csaIn};margin-top:6px"><input type="hidden" id="csa_fe" value=""><input type="hidden" id="csa_fk" value="">`
      : `<div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">视频链接</div><input id="csa_fu" value="${csaE(e.url)}" placeholder="https://…" style="${csaIn}">
      <div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">老师姓名（要和「课程安排」里的老师名一致）</div><input id="csa_fe" value="${csaE(e.teacher)}" style="${csaIn}">
      <div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">课程名关键词（可留空 = 这位老师的所有课程都显示这个试讲视频）</div><input id="csa_fk" value="${csaE(e.keyword)}" style="${csaIn}">`}
    <div style="display:flex;gap:10px;align-items:center;margin-top:12px"><span style="font-size:11px;color:var(--text-3)">排序</span><input id="csa_s" type="number" value="${e.sort}" style="${csaIn};width:90px">
      ${csaChip(e.published, e.published ? '已发布' : '未发布', `csaCapture();csa.edit.published=!csa.edit.published;csaRender()`)}</div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-primary btn-sm" onclick="csaFileSave()">保存</button><button class="btn btn-outline btn-sm" onclick="csa.edit=null;csaRender()">取消</button>
      ${e.id ? `<button class="btn btn-outline btn-sm" style="margin-left:auto;color:var(--danger,#b03a2e)" onclick="csaDel('consult_files','${csaJ(e.id)}')">删除</button>` : ''}</div></div>`;
  const rows = csa.files.filter(f => f.kind === kind);
  return `<div style="display:flex;align-items:center;margin-bottom:10px"><span style="font-size:11px;color:var(--text-3)">${isB ? '按专业上传宣传册。咨询页第 ② 步「专业介绍」里可以打开查看。' : '讲师试讲视频：老师在咨询页被选中的课程旁边会显示。'}</span><button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="csaFileNew()">＋ 新增</button></div>
    ${isB ? `<div style="font-size:11px;color:var(--text-3);background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:8px 12px;margin-bottom:10px;line-height:1.8">专业介绍里的「需要的语言与专业能力」「跨专业要补什么」两个固定小节：在「宣传介绍」的专业介绍里新增两条内容，标题分别写 <b>需要的语言与专业能力</b> 和 <b>跨专业要补什么</b>，咨询页会自动放到专业介绍最前面。</div>` : ''}
    ${rows.map(f => `<div onclick="csaFileOpen('${csaJ(f.id)}')" style="border:1px solid var(--border-light);border-radius:4px;padding:8px 12px;margin-bottom:6px;cursor:pointer;background:var(--surface)"><span style="font-size:12px;font-weight:600">${csaE(f.title)}</span> <span style="font-size:10px;color:var(--text-3)">${csaE(isB ? (ADMISSION_MAJORS[f.major] || f.major || '') : [f.teacher, f.keyword].filter(Boolean).join(' · '))}${f.published === false ? ' · 未发布' : ''}</span></div>`).join('') || '<div class="empty">还没有内容</div>'}`;
}
async function csaFileSave() {
  csaCapture(); const e = csa.edit;
  if (!e.title.trim() || !String(e.url || '').trim()) { alert('请填写标题和文件 / 视频链接'); return; }
  if (e.kind === 'brochure' && !e.major) { alert('请选择专业'); return; }
  if (e.kind === 'trial' && !String(e.teacher || '').trim()) { alert('请填写老师姓名'); return; }
  const rec = { kind: e.kind, major: e.kind === 'brochure' ? e.major : null, title: e.title.trim(), url: e.url.trim(), teacher: (e.teacher || '').trim() || null, keyword: (e.keyword || '').trim() || null, sort: e.sort || 0, published: !!e.published };
  try {
    if (e.id) await sb(`/rest/v1/consult_files?id=eq.${encodeURIComponent(e.id)}`, 'PATCH', rec); else await sb('/rest/v1/consult_files', 'POST', rec);
    await csaMount();
  } catch (err) { alert('保存失败：' + err.message); }
}

// ── 咨询者：管理员能看到所有营业录入的咨询者；报名后一键转成学生档案 ──
const csaYm = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})/); return m ? `${m[1].slice(2)}年${+m[2]}月` : ''; };
const csaLang = (st, ex, sc) => st === 'have' ? `${ex || ''} ${sc || ''}`.trim() : (st === 'none' ? '未参加' : '');
function csaLeadsHtml() {
  const q = csa.lq.trim().toLowerCase(), tn = id => ((csa.teachers || []).find(t => String(t.id) === String(id)) || {}).name || id || '';
  const rows = (csa.leads || []).filter(l => !q || [l.name, tn(l.created_by)].join(' ').toLowerCase().includes(q));
  return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><input placeholder="搜索咨询者 / 录入人" value="${csaE(csa.lq)}" oninput="csa.lq=this.value;csaRender()" style="${csaIn};width:220px"><span style="font-size:11px;color:var(--text-3)">共 ${rows.length} 人。「转为学生」会新建学生档案（不带查询码），请到「学生档案」补全信息，再用「查询码通知」生成查询码。</span></div>
    ${rows.map(l => `<div style="border:1px solid var(--border-light);border-radius:4px;padding:8px 12px;margin-bottom:6px;background:var(--surface);display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:600">${csaE(l.name || '未命名')}</span>
      <span style="font-size:10px;color:var(--text-3)">${csaE([l.target_major && (ADMISSION_MAJORS[l.target_major] || l.target_major), '录入：' + tn(l.created_by), String(l.updated_at || '').slice(0, 10)].filter(Boolean).join(' · '))}</span>
      ${l.status === 'converted' ? '<span style="font-size:10px;padding:1px 7px;border-radius:2px;background:#e6f2ea;color:#1a5a3a">已转学生</span>' : `<button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="csaConvert('${csaJ(l.id)}')">转为学生</button>`}</div>`).join('') || '<div class="empty">还没有咨询者</div>'}`;
}
async function csaConvert(id) {
  const l = (csa.leads || []).find(x => x.id === id); if (!l) return;
  if (!l.name) { alert('这位咨询者还没有填姓名'); return; }
  if (!l.target_major) { alert('这位咨询者还没有选目标专业，请先让营业补上'); return; }
  if (!confirm(`把「${l.name}」转为正式学生档案？\n会带过去：姓名、专业、学历类型、原专业、日语/英语成绩、期待入学时间、赴日时间。`)) return;
  const data = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: l.name, major: l.target_major, extra_majors: [],
    student_type: /专科/.test(l.edu_level || '') ? '专科' : (/本科/.test(l.edu_level || '') ? '本科' : ''), source: '', course_type: '', level: '',
    japanese_score: csaLang(l.jp_status, l.jp_exam, l.jp_score), english_score: csaLang(l.en_status, l.en_exam, l.en_score),
    university: '', faculty: l.orig_major || '', gpa: '', thesis: '', graduation_date: '',
    target_enrollment: csaYm(l.target_enroll), japan_arrival: csaYm(l.arrive_date), signup_date: '', expiry_date: '',
    default_mode: 'online', status: 'active', is_vip_course: '大课', vip_hours_total: 0, vip_hours_used: 0, vip_teachers: [], owner_teachers: [],
  };
  try {
    await sb('/rest/v1/students', 'POST', data);
    await sb(`/rest/v1/consult_leads?id=eq.${encodeURIComponent(id)}`, 'PATCH', { status: 'converted', converted_student_id: data.id, updated_at: new Date().toISOString() });
    l.status = 'converted'; l.converted_student_id = data.id;
    csaRender(); alert('已建好学生档案。请到「学生档案」补全信息，并生成查询码。');
  } catch (e) { alert('转换失败：' + e.message); }
}
