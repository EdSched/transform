// node tests/interview-export.test.js —— 面试回答下载（Word / PDF）+ 老师补充题：拍平在最前面、计入必答进度、提醒优先
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = vm.createContext({ console, Blob, document: { getElementById: () => null }, jstToday: () => '2026-11-20',
  isMajorGroup: () => false, groupOf: () => '', riyuKeyOf: p => p.k, riyuSecs: r => r.sections || {}, riyuEsc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
  RIYU_INTERVIEW_KIND: 'grad_interview', sb: async () => [], sbAll: async () => [], MAJORS: { keiei: '経営学' } });
const load = f => vm.runInContext(fs.readFileSync(__dirname + '/../' + f, 'utf8').replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
const ev = c => vm.runInContext(c, ctx);
load('shared/interview-bank.js'); load('shared/interview-export.js');

const bank = ev(`ivbNorm(${JSON.stringify({ major_key: 'keiei', variant: '', title: '面试稿', chapters: [
  { key: 'c1', title: '志望动机', scope: 'school', items: [{ key: 'q1', q: '为什么选我校' }, { key: 'k1', q: '关键词', keywords: ['A', 'B'] }] },
  { key: 'c2', title: '自我介绍', scope: 'common', items: [{ key: 'q2', q: '请自我介绍' }, { key: 'q3', q: '你的优点' }] },
] })})`);
ctx.bank = bank;
const extras = [
  { id: 'e1', student_id: 's1', row_key: 'S1', item_key: 'x_aaa', q: '补充题一', teacher_note: '先说结论', created_at: '1' },
  { id: 'e2', student_id: 's1', row_key: '_common', item_key: 'x_bbb', q: '补充题二', teacher_note: '', created_at: '2' },
  { id: 'e3', student_id: 's1', row_key: 'S2', item_key: 'x_ccc', q: '别校的补充题', teacher_note: '', created_at: '3' },
];
ctx.extras = extras;

// ── 拍平：补充题在最前面，带老师要点；没有补充题时和以前完全一样 ──
const flat = ev(`ivbFlatSections(bank, extras.slice(0, 2))`);
assert.strictEqual(flat[0].key, 'x_aaa'); assert.ok(flat[0].title.includes('老师补充的问题') && flat[0].title.includes('先说结论'), '标题带老师要点');
assert.strictEqual(flat[1].key, 'x_bbb'); assert.strictEqual(flat[2].key, 'q1'); assert.strictEqual(flat.length, 5, '关键词题不在内');
assert.strictEqual(ev(`ivbFlatSections(bank).length`), 3, '没有补充题：不变');

// ── 进度：补充题计入必答，只算这所校 + 共用行的，firstTodo 排最前 ──
const subs = [{ school_key: 'S1', sections: { q1: '答' } }];
let pr = ev(`ivbProgress(bank, ${JSON.stringify(subs)}, 'S1', null, extras)`);
assert.strictEqual(pr.total, 3 + 2, '题库 3 道必答 + 补充 2 道（别校的不算）'); assert.strictEqual(pr.done, 1);
assert.deepStrictEqual(JSON.parse(JSON.stringify(pr.firstTodo)), { chapter: '__extra', item: 'x_aaa' });
assert.strictEqual(ev(`ivbProgress(bank, [], 'S1').total`), 3, '不传 extras：和以前一样');
const subs2 = [{ school_key: 'S1', sections: { q1: '答', x_aaa: '回答' } }, { school_key: '_common', sections: { x_bbb: '回答2' } }];
pr = ev(`ivbProgress(bank, ${JSON.stringify(subs2)}, 'S1', null, extras)`);
assert.strictEqual(pr.extraDone, 2); assert.strictEqual(pr.firstTodo.chapter, 'c2', '补充题答完后 firstTodo 回到题库');
// ── 提醒：有没回答的补充题，没有模拟面试预约、考试也不近，照样优先提醒 ──
const plans = [{ k: 'S1', exam_date: '2027-12-01' }];
let rem = ev(`ivbReminder(bank, [], ${JSON.stringify(plans)}, [], extras)`);
assert.ok(rem && rem.reason === 'extra' && rem.extraLeft === 2 && rem.firstTodo.item === 'x_aaa');
assert.strictEqual(ev(`ivbReminder(bank, [], ${JSON.stringify(plans)}, [])`), null, '没补充题 + 没预约 + 考试远：不提醒（原规则）');

// ── 下载：ivbAnswersExport ──
const student = { id: 's1', name: '山田/太郎', major: 'keiei' };
ctx.student = student;
ctx.data = { subs: [{ school_key: 'S1', sections: { q1: '我的动机', x_aaa: '补充回答' } }, { school_key: '_common', sections: { q2: '我是山田' } }],
  plans: [{ k: 'S1', school_name: '東京大学', faculty: '経営', level: 1 }, { k: 'S2', school_name: '京都大学', level: 2 }], extras, bankOf: () => ctx.bank };
(async () => {
  const w = await ev(`ivbAnswersExport(student, 'current', 'word', { school: 'S1', data, returnOnly: true })`);
  assert.ok(/^面试回答_山田_太郎_東京大学_\d{8}\.doc$/.test(w.name), '文件名：' + w.name);
  const h = w.html;
  assert.ok(h.indexOf('老师补充的问题') < h.indexOf('志望动机') && h.indexOf('老师补充的问题') > 0, '补充题在最前面');
  assert.ok(h.includes('补充题一') && h.includes('老师要点：先说结论') && h.includes('补充回答'), '补充题 + 要点 + 回答');
  assert.ok(h.includes('补充题二'), '共用行的补充题也算当前校'); assert.ok(!h.includes('别校的补充题'), '别校的补充题不进当前校');
  assert.ok(h.includes('我的动机') && !h.includes('关键词'), '志望校题有答案，关键词题不放');
  assert.ok(!h.includes('自我介绍'), '当前志望校：不含共用题');
  assert.ok(h.includes('（未填写）'), '没写的题');
  const a = await ev(`ivbAnswersExport(student, 'all', 'word', { school: 'S1', data, returnOnly: true })`);
  assert.ok(a.name.includes('_全部_') && a.html.includes('别校的补充题') && a.html.includes('京都大学') && a.html.includes('共用题') && a.html.includes('我是山田'), '全部：所有志望校 + 共用题');
  assert.ok(a.html.indexOf('老师补充的问题') < a.html.indexOf('東京大学'), '全部：补充题仍在最前');
  assert.strictEqual((a.html.match(/page-break-before:always/g) || []).length, 2, '两所学校各自新起一页');
  const p = await ev(`ivbAnswersExport(student, 'all', 'pdf', { school: 'S1', data, returnOnly: true })`);
  assert.ok(p.html.includes('Noto+Serif+SC') && p.html.includes('window.print()') && p.html.includes('@media print') && p.html.includes('.grp.brk'), 'PDF：加载字体、字体就绪后打印、分页');
  await assert.rejects(ev(`ivbAnswersExport(student, 'all', 'word', { data: { subs: [], plans: [], extras: [], bankOf: () => null }, returnOnly: true })`), /没有可下载/);
  console.log('interview-export: OK');
})().catch(e => { console.error(e); process.exit(1); });
