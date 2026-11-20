// ══════════════════════════════════
// interview-bank.js — 面试题库（按专业一套，interview_banks 表）：读取、学生所属题库解析、完成度、搜索、拍平
// 管理端「🎤 面试题库」维护；学生端「面试准备」作答（答案仍存 riyu_submissions，kind='grad_interview'，sections 以题 key 为键）
// 共用答案行：school='common' 的章，答案存 school_key='_common' 那一行；school 章按志望校各一行
// 依赖：shared/supabase.js、shared/constants.js（isMajorGroup / groupMajors / groupOf）
// ══════════════════════════════════

const IVB_COMMON_KEY = '_common';
const ivbCache = {};              // major_key → bank | null
let ivbPublishedKeys = null;      // 已公开题库的专业 key 列表（riyuInterviewOk 同步判断用）

function ivbNorm(row) {
  if (!row) return null;
  const j = (v, d) => { if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = d; } } return v == null ? d : v; };
  const b = Object.assign({ title: '面试稿', intro: '', standard: '' }, row);
  b.chapters = j(row.chapters, []).filter(c => c && c.key).map(c => Object.assign({ title: '', intro: '', scope: 'common', type: 'qa' }, c, {
    items: (c.items || []).filter(i => i && i.key).map(i => Object.assign({ q: '', tips: '', example: '', required: true, tags: [] }, i)),
  }));
  b.manual_files = j(row.manual_files, []).filter(f => f && f.url);
  b.ref_files = j(row.ref_files, []).filter(f => f && f.url);
  return b;
}
async function ivbLoad(majorKey, force) {
  if (!majorKey) return null;
  if (!force && majorKey in ivbCache) return ivbCache[majorKey];
  let row = null;
  try { row = (await sb(`/rest/v1/interview_banks?major_key=eq.${encodeURIComponent(majorKey)}&select=*`, 'GET', null, { cache: 'no-store' }) || [])[0] || null; } catch (e) { row = null; }
  return (ivbCache[majorKey] = ivbNorm(row));
}
async function ivbLoadPublishedKeys(force) {
  if (ivbPublishedKeys && !force) return ivbPublishedKeys;
  try {
    const rows = await sb('/rest/v1/interview_banks?published=eq.true&select=major_key', 'GET', null, { cache: 'no-store' });
    ivbPublishedKeys = (rows || []).map(r => r.major_key);
  } catch (e) { ivbPublishedKeys = ivbPublishedKeys || []; }
  return ivbPublishedKeys;
}
// 学生 → 能用的题库 key：本人专业 → 所属专业组；都没有已公开的题库 = ''（不显示入口）。需要先 await ivbLoadPublishedKeys()
function ivbKeyFor(student) {
  const m = student && student.major; if (!m || !ivbPublishedKeys) return '';
  if (ivbPublishedKeys.indexOf(m) >= 0) return m;
  const g = isMajorGroup(m) ? '' : (typeof groupOf === 'function' ? groupOf(m) : '');
  return g && ivbPublishedKeys.indexOf(g) >= 0 ? g : '';
}
async function ivbForStudent(student) {
  await ivbLoadPublishedKeys();
  const k = ivbKeyFor(student);
  return k ? ivbLoad(k) : null;
}

// ── 题目 / 完成度 ──
// 章里学生可见的题（隐藏的不算）
function ivbVisibleItems(ch) { return (ch.items || []).filter(i => !i.hidden); }
// 一道题要不要作答：只有 qa / ask 章里的普通题；关键词题（带 keywords）只读
function ivbAnswerable(ch, it) { return !(it.keywords && it.keywords.length) && ch.type !== 'keywords'; }
function ivbRowKeyFor(ch, schoolKey) { return ch.scope === 'school' ? (schoolKey || '') : IVB_COMMON_KEY; }
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
      const rk = ivbRowKeyFor(ch, schoolKey);
      const has = rk && ivbAnswer(subs, rk, it.key, drafts).trim();
      if (has) { bc.done++; out.done++; } else if (!out.firstTodo) out.firstTodo = { chapter: ch.key, item: it.key };
    });
  });
  return out;
}
// 默认志望校：考试日期最近（今天之后）→ 第一所
function ivbDefaultSchool(plans) {
  const list = (plans || []).filter(p => p && typeof riyuKeyOf === 'function');
  if (!list.length) return '';
  const today = (typeof jstToday === 'function') ? jstToday() : new Date().toISOString().slice(0, 10);
  const fut = list.filter(p => p.exam_date && String(p.exam_date) >= today).sort((a, b) => String(a.exam_date).localeCompare(String(b.exam_date)));
  return riyuKeyOf((fut[0] || list[0]));
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
// 某份提交（grad_interview）对应的指导：学生所在专业有题库 → 拍平的题库；否则旧版 writing_guides 的 8 段
// studentsMap：id → student（RIYU_STAFF.students），没有就退回旧指导
async function ivbGuideForSub(sub, student) {
  const old = await riyuLoadGuide(sub.kind);
  if (sub.kind !== RIYU_INTERVIEW_KIND || !student) return old;
  let bank = null;
  try { await ivbLoadPublishedKeys(); const k = ivbKeyFor(student); bank = k ? await ivbLoad(k) : null; } catch (e) { bank = null; }
  if (!bank) return old;
  const flat = ivbFlatSections(bank);
  // 旧段落（self/motive/…）若学生写过，放在末尾（riyuStaffView 本来就会把没见过的 key 列在最后；这里带上标题）
  const have = new Set(flat.map(s => s.key));
  const legacy = old.sections.filter(s => !have.has(s.key)).map(s => Object.assign({}, s, { title: '【旧版】' + s.title }));
  return Object.assign({}, old, { sections: flat.concat(legacy), _bank: bank });
}
