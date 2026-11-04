// ══════════════════════════════════
// consult-admin.js — 管控台「咨询台」：维护常见问题（faq）、课程推荐规则（consult_rules），并管理咨询者（转学生）
// 老师端「咨询」（teacher/teacher-consult.js）读取这两张表。只有管理员能改（RLS 见 seed/consult_phase2.sql）。
// 全局名字统一用 csa / CSA_ 前缀。依赖：shared/constants.js、shared/supabase.js、admin.js（switchConsoleTab）
// ══════════════════════════════════
const CSA_STAGES = ['信息采集', '选校', '课程', '价格', '入学后'];
const CSA_LEVELS = [['daigakuin', '大学院'], ['gakubu', '学部']];
const CSA_GAPS = [['jp', '日语成绩'], ['en', '英语成绩'], ['plan', '研究计划书・志望理由书'], ['interview', '面试'], ['written', '笔试'], ['specialty', '专业能力（跨专业补课）']];
let csa = { tab: 'faq', faq: null, rules: null, profs: null, media: null, pq: '', mk: 'textbook', plim: 40, leads: null, teachers: [], lq: '', edit: null, body: null, err: '' };
const csaE = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const csaJ = v => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');

async function csaMount(body) {
  csa.body = body || csa.body; csa.edit = null;
  csa.body.innerHTML = '<div style="padding:20px;color:var(--text-3);font-size:12px">加载中…</div>';
  try {
    [csa.faq, csa.rules, csa.profs, csa.media, csa.leads, csa.teachers] = await Promise.all([
      sbAll('/rest/v1/faq?select=*&order=sort.asc,created_at.asc', { cache: 'no-store' }),
      sbAll('/rest/v1/consult_rules?select=*&order=sort.asc,created_at.asc', { cache: 'no-store' }).catch(() => null),
      sbAll('/rest/v1/consult_professors?select=*&order=university.asc,name.asc', { cache: 'no-store' }).catch(() => null),
      sbAll('/rest/v1/consult_media?select=*&order=sort.asc,created_at.asc', { cache: 'no-store' }).catch(() => null),
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
  const tabs = [['faq', '常见问题'], ['rules', '课程推荐规则'], ['prof', '教授资料'], ['media', '教材・校区'], ['leads', '咨询者']].map(([k, t]) => csaChip(csa.tab === k, t, `csa.tab='${k}';csa.edit=null;csaRender()`)).join('');
  b.innerHTML = `<div style="padding:14px 18px;max-width:900px"><div style="display:flex;gap:6px;margin-bottom:12px">${tabs}</div>${csa.tab === 'faq' ? csaFaqHtml() : csa.tab === 'rules' ? csaRulesHtml() : csa.tab === 'prof' ? csaProfHtml() : csa.tab === 'media' ? csaMediaHtml() : csaLeadsHtml()}</div>`;
}
function csaToggle(k, v) { const a = csa.edit[k], i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); csaCapture(); csaRender(); }
function csaCapture() {
  const g = id => { const el = document.getElementById(id); return el ? el.value : undefined; }, e = csa.edit; if (!e) return;
  if (csa.tab === 'prof') { ['university', 'department', 'name', 'research', 'contact_req', 'source', 'source_url', 'updated_on', 'notes', 'major'].forEach(k => { const v = g('csa_p_' + k); if (v !== undefined) e[k] = v; }); return; }
  if (csa.tab === 'media') { ['title', 'caption', 'media_type', 'url', 'course_key'].forEach(k => { const v = g('csa_m_' + k); if (v !== undefined) e[k] = v; }); const so = g('csa_s'); if (so !== undefined) e.sort = parseInt(so) || 0; return; }
  if (csa.tab === 'faq') { const q = g('csa_q'), a = g('csa_a'), s = g('csa_s'); if (q !== undefined) { e.question = q; e.answer = a; e.sort = parseInt(s) || 0; } }
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

// ── 教授资料 ──
function csaProfNew() { csa.edit = { id: '', university: '', department: '', name: '', major: '', research: '', contact_req: '', source: '', source_url: '', updated_on: new Date().toISOString().slice(0, 10), unconfirmed: false, notes: '', published: true }; csaRender(); }
function csaProfOpen(id) { const p = csa.profs.find(x => x.id === id); if (p) { csa.edit = { ...p }; csaRender(); } }
const csaTa = (id, v, rows) => `<textarea id="${id}" rows="${rows || 3}" style="${csaIn}">${csaE(v)}</textarea>`;
const csaLbl = t => `<div style="font-size:11px;color:var(--text-3);margin:10px 0 3px">${t}</div>`;
function csaProfHtml() {
  const e = csa.edit;
  if (csa.profs === null) return '<div class="empty">还没有 consult_professors 表，请先执行 seed/consult_phase3.sql</div>';
  if (e) return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:14px">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
      <div><div style="font-size:11px;color:var(--text-3);margin-bottom:3px">大学</div><input id="csa_p_university" value="${csaE(e.university)}" style="${csaIn}"></div>
      <div><div style="font-size:11px;color:var(--text-3);margin-bottom:3px">研究科・専攻</div><input id="csa_p_department" value="${csaE(e.department)}" style="${csaIn}"></div>
      <div><div style="font-size:11px;color:var(--text-3);margin-bottom:3px">教授姓名</div><input id="csa_p_name" value="${csaE(e.name)}" style="${csaIn}"></div>
      <div><div style="font-size:11px;color:var(--text-3);margin-bottom:3px">对应专业（可空）</div><select id="csa_p_major" style="${csaIn}"><option value="">不指定</option>${csaMajorKeys().map(k => `<option value="${k}" ${e.major === k ? 'selected' : ''}>${csaE(ADMISSION_MAJORS[k])}</option>`).join('')}</select></div></div>
    ${csaLbl('研究方向')}${csaTa('csa_p_research', e.research)}
    ${csaLbl('联系要求（要不要提前联系、怎么联系）')}${csaTa('csa_p_contact_req', e.contact_req)}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
      <div>${csaLbl('信息来源')}<input id="csa_p_source" value="${csaE(e.source)}" style="${csaIn}"></div>
      <div>${csaLbl('来源链接')}<input id="csa_p_source_url" value="${csaE(e.source_url)}" placeholder="https://…" style="${csaIn}"></div>
      <div>${csaLbl('信息更新时间')}<input id="csa_p_updated_on" type="date" value="${csaE(e.updated_on)}" style="${csaIn}"></div></div>
    ${csaLbl('内部备注（展示模式下老师看不到）')}${csaTa('csa_p_notes', e.notes, 2)}
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${csaChip(e.unconfirmed, e.unconfirmed ? '待确认' : '已确认', `csaCapture();csa.edit.unconfirmed=!csa.edit.unconfirmed;csaRender()`)}${csaChip(e.published, e.published ? '已发布' : '未发布', `csaCapture();csa.edit.published=!csa.edit.published;csaRender()`)}</div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-primary btn-sm" onclick="csaProfSave()">保存</button><button class="btn btn-outline btn-sm" onclick="csa.edit=null;csaRender()">取消</button>
      ${e.id ? `<button class="btn btn-outline btn-sm" style="margin-left:auto;color:var(--danger,#b03a2e)" onclick="csaDel('consult_professors','${csaJ(e.id)}')">删除</button>` : ''}</div></div>`;
  const q = csa.pq.trim().toLowerCase(), rows = csa.profs.filter(p => !q || [p.university, p.department, p.name, p.research].join(' ').toLowerCase().includes(q));
  return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap"><input placeholder="搜索大学 / 教授 / 研究方向" value="${csaE(csa.pq)}" onchange="csa.pq=this.value;csa.plim=40;csaRender()" style="${csaIn};width:240px"><span style="font-size:11px;color:var(--text-3)">共 ${rows.length} 位。咨询页第 ② 步按目标校自动显示，带来源和更新时间。</span><button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="csaProfNew()">＋ 新增教授</button></div>
    ${rows.slice(0, csa.plim).map(p => `<div onclick="csaProfOpen('${csaJ(p.id)}')" style="border:1px solid var(--border-light);border-radius:4px;padding:8px 12px;margin-bottom:6px;cursor:pointer;background:var(--surface)"><span style="font-size:12px;font-weight:600">${csaE(p.name)}</span> <span style="font-size:11px;color:var(--text-2)">${csaE([p.university, p.department].filter(Boolean).join(' '))}</span>${p.unconfirmed ? ' <span style="font-size:10px;color:#8a6a1a">待确认</span>' : ''}${p.published === false ? ' <span style="font-size:10px;color:var(--text-3)">未发布</span>' : ''}<div style="font-size:10px;color:var(--text-3);margin-top:2px">${csaE((p.research || '').slice(0, 70))}${p.updated_on ? ' · 更新 ' + csaE(p.updated_on) : ''}</div></div>`).join('') || '<div class="empty">还没有教授资料</div>'}
    ${rows.length > csa.plim ? `<div onclick="csa.plim+=40;csaRender()" style="text-align:center;padding:10px;font-size:11px;color:var(--accent);cursor:pointer;border:1px dashed var(--border);border-radius:4px">显示更多（还有 ${rows.length - csa.plim} 位）</div>` : ''}`;
}
async function csaProfSave() {
  csaCapture(); const e = csa.edit;
  if (!String(e.university || '').trim() || !String(e.name || '').trim()) { alert('请填写大学和教授姓名'); return; }
  const rec = { university: e.university.trim(), department: (e.department || '').trim() || null, name: e.name.trim(), major: e.major || null, research: e.research || null, contact_req: e.contact_req || null, source: e.source || null, source_url: e.source_url || null, updated_on: e.updated_on || null, unconfirmed: !!e.unconfirmed, notes: e.notes || null, published: !!e.published };
  try {
    if (e.id) await sb(`/rest/v1/consult_professors?id=eq.${encodeURIComponent(e.id)}`, 'PATCH', rec); else await sb('/rest/v1/consult_professors', 'POST', rec);
    await csaMount();
  } catch (err) { alert('保存失败：' + err.message); }
}

// ── 教材・校区展示 ──
const CSA_MEDIA = [['image', '图片'], ['video', '视频'], ['pdf', 'PDF'], ['link', '链接']];
function csaMediaNew() { csa.edit = { id: '', kind: csa.mk, title: '', caption: '', media_type: 'image', url: '', course_key: '', sort: (csa.media.length + 1) * 10, published: true }; csaRender(); }
function csaMediaOpen(id) { const m = csa.media.find(x => x.id === id); if (m) { csa.edit = { ...m }; csaRender(); } }
async function csaMediaUpload(inp) {
  const f = inp.files && inp.files[0]; if (!f) return;
  const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin', st = document.getElementById('csa_up');
  if (st) st.textContent = '上传中…';
  try {
    const url = await sbUpload('admission-photos', `consult/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`, f);
    csaCapture(); csa.edit.url = url; if (!csa.edit.title) csa.edit.title = f.name.replace(/\.[^.]+$/, '');
    if (/^(jpe?g|png|gif|webp)$/.test(ext)) csa.edit.media_type = 'image'; else if (ext === 'pdf') csa.edit.media_type = 'pdf'; else if (/^(mp4|mov|webm)$/.test(ext)) csa.edit.media_type = 'video';
    csaRender();
  } catch (e) { if (st) st.textContent = ''; alert('上传失败：' + e.message); }
}
function csaMediaHtml() {
  const e = csa.edit;
  if (csa.media === null) return '<div class="empty">还没有 consult_media 表，请先执行 seed/consult_phase3.sql</div>';
  if (e) return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:14px">
    <div style="font-size:12px;font-weight:600;margin-bottom:6px">${e.kind === 'campus' ? '校区展示' : '教材展示'}</div>
    ${csaLbl('标题')}<input id="csa_m_title" value="${csaE(e.title)}" style="${csaIn}">
    ${csaLbl('说明（可空）')}${csaTa('csa_m_caption', e.caption, 2)}
    ${csaLbl('类型')}<select id="csa_m_media_type" style="${csaIn}">${CSA_MEDIA.map(([k, t]) => `<option value="${k}" ${e.media_type === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    ${csaLbl('文件：上传图片 / PDF，或直接填链接（视频一般填链接）')}<input type="file" accept="image/*,.pdf,video/mp4" onchange="csaMediaUpload(this)" style="font-size:12px"> <span id="csa_up" style="font-size:11px;color:var(--text-3)"></span>
    <input id="csa_m_url" value="${csaE(e.url)}" placeholder="https://…" style="${csaIn};margin-top:6px">
    ${e.kind === 'textbook' ? `${csaLbl('关联课程 / 专业关键词（可空，方便在咨询页筛选）')}<input id="csa_m_course_key" value="${csaE(e.course_key)}" style="${csaIn}">` : '<input type="hidden" id="csa_m_course_key" value="">'}
    <div style="display:flex;gap:10px;align-items:center;margin-top:12px"><span style="font-size:11px;color:var(--text-3)">排序</span><input id="csa_s" type="number" value="${e.sort}" style="${csaIn};width:90px">${csaChip(e.published, e.published ? '已发布' : '未发布', `csaCapture();csa.edit.published=!csa.edit.published;csaRender()`)}</div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-primary btn-sm" onclick="csaMediaSave()">保存</button><button class="btn btn-outline btn-sm" onclick="csa.edit=null;csaRender()">取消</button>
      ${e.id ? `<button class="btn btn-outline btn-sm" style="margin-left:auto;color:var(--danger,#b03a2e)" onclick="csaDel('consult_media','${csaJ(e.id)}')">删除</button>` : ''}</div></div>`;
  const rows = csa.media.filter(m => m.kind === csa.mk);
  return `<div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap">${[['textbook', '教材'], ['campus', '校区']].map(([k, t]) => csaChip(csa.mk === k, t, `csa.mk='${k}';csaRender()`)).join('')}<span style="font-size:11px;color:var(--text-3)">咨询页右上角「教材・校区」按钮里显示。教材：样章、课堂示例、教案节选；校区：校区、教室照片和视频。</span><button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="csaMediaNew()">＋ 新增</button></div>
    ${rows.map(m => `<div onclick="csaMediaOpen('${csaJ(m.id)}')" style="border:1px solid var(--border-light);border-radius:4px;padding:8px 12px;margin-bottom:6px;cursor:pointer;background:var(--surface)"><span style="font-size:12px;font-weight:600">${csaE(m.title)}</span> <span style="font-size:10px;color:var(--text-3)">${csaE((CSA_MEDIA.find(x => x[0] === m.media_type) || [0, m.media_type])[1])}${m.course_key ? ' · ' + csaE(m.course_key) : ''}${m.published === false ? ' · 未发布' : ''}</span></div>`).join('') || '<div class="empty">还没有内容</div>'}`;
}
async function csaMediaSave() {
  csaCapture(); const e = csa.edit;
  if (!String(e.title || '').trim() || !String(e.url || '').trim()) { alert('请填写标题和文件 / 链接'); return; }
  const rec = { kind: e.kind, title: e.title.trim(), caption: e.caption || null, media_type: e.media_type || 'image', url: e.url.trim(), course_key: (e.course_key || '').trim() || null, sort: e.sort || 0, published: !!e.published };
  try {
    if (e.id) await sb(`/rest/v1/consult_media?id=eq.${encodeURIComponent(e.id)}`, 'PATCH', rec); else await sb('/rest/v1/consult_media', 'POST', rec);
    await csaMount();
  } catch (err) { alert('保存失败：' + err.message); }
}
