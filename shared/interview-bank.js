// ══════════════════════════════════
// interview-bank.js — 面试题库（按专业一套，interview_banks 表）：读取、学生所属题库解析、完成度、搜索、拍平
// 管理端「🎤 面试题库」维护；学生端「面试准备」作答（答案仍存 riyu_submissions，kind='grad_interview'，sections 以题 key 为键）
// 共用答案行：school='common' 的章，答案存 school_key='_common' 那一行；school 章按志望校各一行
// 依赖：shared/supabase.js、shared/constants.js（isMajorGroup / groupMajors / groupOf）
// ══════════════════════════════════

const IVB_COMMON_KEY = '_common';
const ivbCache = {};              // major_key|variant → bank | null（variant 空 = 默认版本）
let ivbPublishedKeys = null;      // 已公开题库的专业 key 列表（riyuInterviewOk 同步判断用）
let ivbPublishedRows = null;      // 已公开的版本行 [{major_key, variant, variant_label, match_words}]

// ── 版本：同一专业可有多套题库（variant 小写短码，'' = 默认版本）──
function ivbCacheKey(majorKey, variant) { return majorKey + '|' + (variant || ''); }
function ivbWords(v) { if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = v.split(/[,，、\n]/); } } return (Array.isArray(v) ? v : []).map(x => String(x || '').trim()).filter(Boolean); }
function ivbVariantLabel(row) { return (row && String(row.variant_label || '').trim()) || (row && row.variant ? row.variant : '标准版'); }
// 作答共用章的答案行键：默认版本 '_common'（老数据不动），其他版本 '_common@<variant>'
function ivbCommonKey(variant) { return variant ? IVB_COMMON_KEY + '@' + variant : IVB_COMMON_KEY; }
function ivbIsCommonKey(k) { k = String(k || ''); return k === IVB_COMMON_KEY || k.indexOf(IVB_COMMON_KEY + '@') === 0; }
function ivbVariantOfKey(k) { k = String(k || ''); return k.indexOf(IVB_COMMON_KEY + '@') === 0 ? k.slice(IVB_COMMON_KEY.length + 1) : ''; }

function ivbNorm(row) {
  if (!row) return null;
  const j = (v, d) => { if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = d; } } return v == null ? d : v; };
  const b = Object.assign({ title: '面试稿', intro: '', standard: '' }, row);
  b.variant = row.variant || '';
  b.variant_label = row.variant_label || '';
  b.match_words = ivbWords(row.match_words);
  b.chapters = j(row.chapters, []).filter(c => c && c.key).map(c => Object.assign({ title: '', intro: '', scope: 'common', type: 'qa' }, c, {
    items: (c.items || []).filter(i => i && i.key).map(i => Object.assign({ q: '', tips: '', example: '', required: true, tags: [] }, i)),
  }));
  b.manual_files = j(row.manual_files, []).filter(f => f && f.url);
  b.ref_files = j(row.ref_files, []).filter(f => f && f.url);
  return b;
}
async function ivbLoad(majorKey, force, variant) {
  if (!majorKey) return null;
  variant = variant || '';
  const ck = ivbCacheKey(majorKey, variant);
  if (!force && ck in ivbCache) return ivbCache[ck];
  let row = null;
  try { row = (await sb(`/rest/v1/interview_banks?major_key=eq.${encodeURIComponent(majorKey)}&variant=eq.${encodeURIComponent(variant)}&select=*`, 'GET', null, { cache: 'no-store' }) || [])[0] || null; } catch (e) { row = null; }
  return (ivbCache[ck] = ivbNorm(row));
}
async function ivbLoadPublishedKeys(force) {
  if (ivbPublishedKeys && !force) return ivbPublishedKeys;
  try {
    const rows = await sb('/rest/v1/interview_banks?published=eq.true&select=major_key,variant,variant_label,match_words', 'GET', null, { cache: 'no-store' });
    ivbPublishedRows = (rows || []).map(r => ({ major_key: r.major_key, variant: r.variant || '', variant_label: r.variant_label || '', match_words: ivbWords(r.match_words) }));
    ivbPublishedKeys = [...new Set(ivbPublishedRows.map(r => r.major_key))];
  } catch (e) { ivbPublishedKeys = ivbPublishedKeys || []; ivbPublishedRows = ivbPublishedRows || []; }
  return ivbPublishedKeys;
}
// 管理端保存 / 公开状态变了：同步「已公开」列表（saved = 保存后的行）
function ivbSyncPublished(saved) {
  ivbPublishedRows = (ivbPublishedRows || []).filter(r => !(r.major_key === saved.major_key && r.variant === (saved.variant || '')));
  if (saved.published) ivbPublishedRows.push({ major_key: saved.major_key, variant: saved.variant || '', variant_label: saved.variant_label || '', match_words: ivbWords(saved.match_words) });
  ivbPublishedKeys = [...new Set(ivbPublishedRows.map(r => r.major_key))];
}
// 某专业（或专业组）key 下已公开的版本：默认版本在前，其余按短码排序
function ivbVariantsFor(majorKey) {
  return (ivbPublishedRows || []).filter(r => r.major_key === majorKey).slice().sort((a, b) => (a.variant === '' ? -1 : b.variant === '' ? 1 : a.variant.localeCompare(b.variant)));
}
// 学生 → 能用的题库 key（专业）：本人专业 → 所属专业组；都没有已公开的题库 = ''（不显示入口）。需要先 await ivbLoadPublishedKeys()
function ivbKeyFor(student) {
  const m = student && student.major; if (!m || !ivbPublishedKeys) return '';
  if (ivbPublishedKeys.indexOf(m) >= 0) return m;
  const g = isMajorGroup(m) ? '' : (typeof groupOf === 'function' ? groupOf(m) : '');
  return g && ivbPublishedKeys.indexOf(g) >= 0 ? g : '';
}
// 志望校（+ 学生）→ 题库版本短码。三步回退：
//   ① 志望校上记录的 interview_variant（该版本存在且已公开）；② 按各版本 match_words 在校名 / 学部 / 研究科里做包含匹配；
//   ③ 默认版本（variant=''）；默认版本没公开就取第一个已公开版本。
//   没有志望校（还没填）：用页面当前选的版本 pageVariant（有效的话），否则同 ③
function ivbVariantFor(student, plan, pageVariant, majorKey) {
  const key = majorKey || ivbKeyFor(student); if (!key) return '';
  const vs = ivbVariantsFor(key); if (!vs.length) return '';
  const has = v => vs.some(x => x.variant === v);
  if (plan) {
    if (plan.interview_variant != null && has(plan.interview_variant)) return plan.interview_variant;
    const text = [plan.school_name, plan.faculty, plan.department].filter(Boolean).join(' ').toLowerCase();
    if (text) { const hit = vs.find(v => v.match_words.some(w => text.indexOf(w.toLowerCase()) >= 0)); if (hit) return hit.variant; }
  } else if (pageVariant != null && has(pageVariant)) return pageVariant;
  return has('') ? '' : vs[0].variant;
}
// 学生 → { key, variant }（同步；没有已公开题库 = null）
function ivbResolve(student, plan, pageVariant) {
  const key = ivbKeyFor(student); if (!key) return null;
  return { key, variant: ivbVariantFor(student, plan, pageVariant, key) };
}
async function ivbForStudent(student, plan, pageVariant) {
  await ivbLoadPublishedKeys();
  const r = ivbResolve(student, plan, pageVariant);
  return r ? ivbLoad(r.key, false, r.variant) : null;
}

// ── 题目 / 完成度 ──
// 章里学生可见的题（隐藏的不算）
function ivbVisibleItems(ch) { return (ch.items || []).filter(i => !i.hidden); }
// 一道题要不要作答：只有 qa / ask 章里的普通题；关键词题（带 keywords）只读
function ivbAnswerable(ch, it) { return !(it.keywords && it.keywords.length) && ch.type !== 'keywords'; }
function ivbRowKeyFor(ch, schoolKey, variant) { return ch.scope === 'school' ? (schoolKey || '') : ivbCommonKey(variant); }
// subs：该生 grad_interview 的全部 riyu_submissions 行；返回 答案文字（没写 = ''）
function ivbAnswer(subs, rowKey, itemKey, drafts) {
  if (drafts && drafts[rowKey] && drafts[rowKey][itemKey] != null) return String(drafts[rowKey][itemKey]);
  const row = (subs || []).find(s => s.school_key === rowKey);
  return row ? String(riyuSecs(row)[itemKey] || '') : '';
}
// 必答完成度（针对某所志望校：schoolKey 为空 = 只算共用章，school 章记为没写）
// 返回 { done, total, firstTodo: {chapter, item} | null, byChapter: {chKey: {done, total}} }
function ivbProgress(bank, subs, schoolKey, drafts) {
  const out = { done: 0, total: 0, firstTodo: null, byChapter: {} };
  if (!bank) return out;
  bank.chapters.forEach(ch => {
    const bc = out.byChapter[ch.key] = { done: 0, total: 0 };
    ivbVisibleItems(ch).forEach(it => {
      if (!ivbAnswerable(ch, it) || it.required === false) return;
      bc.total++; out.total++;
      const rk = ivbRowKeyFor(ch, schoolKey, bank.variant);
      const has = rk && ivbAnswer(subs, rk, it.key, drafts).trim();
      if (has) { bc.done++; out.done++; } else if (!out.firstTodo) out.firstTodo = { chapter: ch.key, item: it.key };
    });
  });
  return out;
}
// 默认志望校：考试日期最近（今天之后）→ 第一所
function ivbDefaultSchool(plans) { const p = ivbDefaultPlan(plans); return p ? riyuKeyOf(p) : ''; }
function ivbDefaultPlan(plans) {
  const list = (plans || []).filter(p => p && typeof riyuKeyOf === 'function');
  if (!list.length) return null;
  const today = (typeof jstToday === 'function') ? jstToday() : new Date().toISOString().slice(0, 10);
  const fut = list.filter(p => p.exam_date && String(p.exam_date) >= today).sort((a, b) => String(a.exam_date).localeCompare(String(b.exam_date)));
  return fut[0] || list[0];
}
// 提醒用：这个学生要不要被提醒「面试稿没写完」。返回 null 或 { left, total, firstTodo, reason }
function ivbReminder(bank, subs, plans, bookings) {
  if (!bank) return null;
  const sk = ivbDefaultSchool(plans);
  const pr = ivbProgress(bank, subs, sk);
  if (!pr.total || pr.done >= pr.total) return null;
  const today = (typeof jstToday === 'function') ? jstToday() : new Date().toISOString().slice(0, 10);
  const mock = (bookings || []).some(b => b.type === 'mock' && (b.status === 'pending' || b.status === 'confirmed') && String(b.slot_date || b.date || '') >= today);
  const soon = (plans || []).some(p => {
    if (!p.exam_date || String(p.exam_date) < today) return false;
    return (new Date(String(p.exam_date).slice(0, 10)) - new Date(today)) / 86400000 <= 60;
  });
  if (!mock && !soon) return null;
  return { left: pr.total - pr.done, total: pr.total, firstTodo: pr.firstTodo, reason: mock ? 'mock' : 'exam' };
}

// ── 搜索（本地过滤）：题面 / 指导 / 参考例 / 关键词 ──
function ivbSearch(bank, q) {
  const kw = String(q || '').trim().toLowerCase(); if (!kw || !bank) return [];
  const hit = [];
  bank.chapters.forEach(ch => ivbVisibleItems(ch).forEach(it => {
    const hay = [it.q, it.tips, it.example, (it.keywords || []).join(' '), (it.tags || []).join(' ')].join('\n').toLowerCase();
    if (hay.indexOf(kw) >= 0) hit.push({ ch, it });
  }));
  return hit;
}

// ── 拍平成「段落」形状：老师批复 / 下载 Word（riyuStaffView / riyuWordBuild）按 g.sections 排版，这里给它们同样的形状 ──
function ivbFlatSections(bank) {
  const out = [];
  if (!bank) return out;
  bank.chapters.forEach(ch => (ch.items || []).forEach(it => {
    if (it.keywords && it.keywords.length) return;
    out.push({ key: it.key, title: `【${ch.title}】${it.q}`, subtitle: '', tips: [] });
  }));
  return out;
}
// 老师 / 管理员看提交列表时用：多版本专业才返回版本名（单版本 = ''）
function ivbPlanVariantName(student, plan) {
  const k = ivbKeyFor(student), vs = k ? ivbVariantsFor(k) : []; if (vs.length < 2) return '';
  const v = ivbVariantFor(student, plan, null, k);
  return ivbVariantLabel(vs.find(x => x.variant === v));
}
function ivbCommonRowName(student, schoolKey) {
  const k = ivbKeyFor(student), vs = k ? ivbVariantsFor(k) : [], base = '共用部分（不分学校的题）';
  if (vs.length < 2) return base;
  const v = ivbVariantOfKey(schoolKey), r = vs.find(x => x.variant === v);
  return base + ' · ' + (r ? ivbVariantLabel(r) : (v || '标准版'));
}

// 某份提交（grad_interview）对应的指导：学生所在专业有题库 → 拍平的题库；否则旧版 writing_guides 的 8 段
// 版本：共用行（school_key 形如 _common@mba）直接取键里的版本；志望校行取该志望校（记录的 / 按关键词猜的）版本
// studentsMap：id → student（RIYU_STAFF.students），没有就退回旧指导
async function ivbGuideForSub(sub, student) {
  const old = await riyuLoadGuide(sub.kind);
  if (sub.kind !== RIYU_INTERVIEW_KIND || !student) return old;
  let bank = null;
  try {
    await ivbLoadPublishedKeys();
    const k = ivbKeyFor(student);
    if (k) {
      let v;
      if (ivbIsCommonKey(sub.school_key)) v = ivbVariantOfKey(sub.school_key);
      else {
        const plans = (typeof RIYU_STAFF !== 'undefined' && RIYU_STAFF.plans) ? RIYU_STAFF.plans : {};
        let plan = plans[student.id + '|' + sub.school_key] || null;
        if (!plan && ivbVariantsFor(k).length > 1) {   // 多版本且没缓存到志望校：读一次
          const rows = await sb(`/rest/v1/student_school_plans?student_id=eq.${encodeURIComponent(student.id)}&select=*`, 'GET', null, { cache: 'no-store' }).catch(() => []);
          plan = (rows || []).find(p => riyuKeyOf(p) === sub.school_key) || null;
        }
        v = ivbVariantFor(student, plan, null, k);
      }
      bank = await ivbLoad(k, false, v);
      if (!bank && v) bank = await ivbLoad(k, false, ivbVariantFor(student, null, null, k));   // 该版本已不存在：退回默认版本
    }
  } catch (e) { bank = null; }
  if (!bank) return old;
  const flat = ivbFlatSections(bank);
  // 旧段落（self/motive/…）若学生写过，放在末尾（riyuStaffView 本来就会把没见过的 key 列在最后；这里带上标题）
  const have = new Set(flat.map(s => s.key));
  const legacy = old.sections.filter(s => !have.has(s.key)).map(s => Object.assign({}, s, { title: '【旧版】' + s.title }));
  return Object.assign({}, old, { sections: flat.concat(legacy), _bank: bank });
}

// ── 面试资料（マナー / 临机应对 / 态度 / 其他）：interview_resources，通用（major_key 为空）+ 本专业 ──
const IVB_RES_CATS = [['manner', 'マナー'], ['impromptu', '临机应对'], ['attitude', '态度与心得'], ['other', '其他']];
// 返回通用 + 本专业的资料（带 variant 字段，按版本过滤用 ivbResForVariant）
async function ivbLoadResources(student) {
  let rows = [];
  try { rows = await sb('/rest/v1/interview_resources?published=eq.true&order=sort_order.asc&select=*', 'GET', null, { cache: 'no-store' }) || []; } catch (e) { rows = []; }
  const keys = [student && student.major, ivbKeyFor(student)].filter(Boolean);
  return rows.filter(r => !r.major_key || keys.indexOf(r.major_key) >= 0).map(r => {
    let f = r.files; if (typeof f === 'string') { try { f = JSON.parse(f); } catch (e) { f = []; } }
    return Object.assign({}, r, { files: (Array.isArray(f) ? f : []).filter(x => x && x.url) });
  });
}
// 资料适用版本：variant 为空 = 该专业所有版本都显示；否则只在对应版本显示
// 资料的 variant：空 = 所有版本；'@default' = 只给默认版本；其余 = 版本短码
function ivbResVariantKey(variant) { return variant || '@default'; }
function ivbResForVariant(list, variant) { return (list || []).filter(r => !r.variant || r.variant === ivbResVariantKey(variant)); }
