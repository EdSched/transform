// node tests/interview-variants.test.js —— 面试题库多版本：版本判定三步回退 / 共用答案行键 / 导入落到所选版本 / 模拟面试记录带版本
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = vm.createContext({ console, document: { getElementById: () => null }, jstToday: () => '2026-11-20',
  isMajorGroup: () => false, groupOf: () => '', riyuKeyOf: p => [p.school_name || '', p.faculty || '', p.department || ''].join('|'),
  riyuSecs: r => r.sections || {}, riyuEsc: s => s, RIYU_INTERVIEW_KIND: 'grad_interview', sb: async () => [], MAJORS: { keiei: '経営学' }, groupLabel: k => k, chipFold: a => a.map(x => x.html).join('') });
const load = f => vm.runInContext(fs.readFileSync(__dirname + '/../' + f, 'utf8').replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
const ev = c => vm.runInContext(c, ctx);
load('shared/interview-bank.js'); load('shared/interview-import.js');

// ── 版本判定：①记录的 → ②关键词 → ③默认 ──
ev(`ivbPublishedKeys = ['keiei', 'solo']; ivbPublishedRows = [
  { major_key: 'keiei', variant: '', variant_label: '経営学研究科', match_words: [] },
  { major_key: 'keiei', variant: 'mba', variant_label: 'MBA', match_words: ['MBA', 'ビジネススクール', '専門職'] },
  { major_key: 'solo', variant: '', variant_label: '', match_words: [] }];`);
const vf = (st, plan, pv) => ev(`ivbVariantFor(${JSON.stringify(st)}, ${JSON.stringify(plan)}, ${JSON.stringify(pv)})`);
const S = { major: 'keiei' };
assert.strictEqual(vf(S, { school_name: 'A大学', interview_variant: 'mba' }), 'mba', '① 志望校上记录的版本优先');
assert.strictEqual(vf(S, { school_name: 'MBA 大学', interview_variant: '' }), '', '① 明确选了默认版本（空串）也算记录');
assert.strictEqual(vf(S, { school_name: 'A大学', faculty: 'ビジネススクール研究科' }), 'mba', '② 关键词命中');
assert.strictEqual(vf(S, { school_name: 'a mba school' }), 'mba', '② 关键词不分大小写');
assert.strictEqual(vf(S, { school_name: 'A大学', faculty: '経営学研究科' }), '', '③ 猜不出 → 默认版本');
assert.strictEqual(vf(S, { school_name: 'A大学', interview_variant: 'gone' }), '', '记录的版本不存在 / 未公开 → 退回猜 / 默认');
assert.strictEqual(vf(S, null, 'mba'), 'mba', '没有志望校：用页面当前选的版本');
assert.strictEqual(vf(S, null, 'zzz'), '', '没有志望校：页面版本无效 → 默认');
assert.strictEqual(vf({ major: 'solo' }, { school_name: 'MBA' }), '', '只有一个版本：永远是它');
ev(`ivbPublishedRows = ivbPublishedRows.filter(r => r.variant !== '')`);
assert.strictEqual(vf(S, { school_name: 'A大学' }), 'mba', '默认版本没公开 → 第一个已公开版本');
assert.strictEqual(vf({ major: 'none' }, null), '', '没有题库 → 空');
ev(`ivbPublishedRows.unshift({ major_key: 'keiei', variant: '', variant_label: '', match_words: [] })`);
assert.strictEqual(JSON.stringify(ev(`ivbVariantsFor('keiei').map(v => v.variant)`)), '["","mba"]', '默认版本排第一');

// ── 共用章答案行键 ──
const common = { scope: 'common' }, school = { scope: 'school' };
assert.strictEqual(ev(`ivbRowKeyFor(${JSON.stringify(common)}, 'S|', '')`), '_common', '默认版本沿用 _common（老数据不动）');
assert.strictEqual(ev(`ivbRowKeyFor(${JSON.stringify(common)}, 'S|', 'mba')`), '_common@mba');
assert.strictEqual(ev(`ivbRowKeyFor(${JSON.stringify(common)}, 'S|')`), '_common', '不传版本 = 默认版本');
assert.strictEqual(ev(`ivbRowKeyFor(${JSON.stringify(school)}, 'S|', 'mba')`), 'S|', '各校章按志望校行存，不受版本影响');
assert.ok(ev(`ivbIsCommonKey('_common') && ivbIsCommonKey('_common@mba') && !ivbIsCommonKey('S|')`));
assert.strictEqual(ev(`ivbVariantOfKey('_common@mba')`), 'mba'); assert.strictEqual(ev(`ivbVariantOfKey('_common')`), '');
// 进度：同一学生两个版本各写一个「学习经历」，互不串
const bank = v => ({ variant: v, chapters: [{ key: 'c1', scope: 'common', type: 'qa', items: [{ key: 'q_a', q: '学習経歴', required: true }] }] });
const subs = [{ school_key: '_common', sections: { q_a: '研究科的答案' } }, { school_key: '_common@mba', sections: {} }];
assert.strictEqual(ev(`ivbProgress(${JSON.stringify(bank(''))}, ${JSON.stringify(subs)}, 'S|').done`), 1, '默认版本读 _common');
assert.strictEqual(ev(`ivbProgress(${JSON.stringify(bank('mba'))}, ${JSON.stringify(subs)}, 'S|').done`), 0, 'MBA 读 _common@mba，不会看到研究科的答案');
// 资料适用版本
const res = [{ id: 1 }, { id: 2, variant: 'mba' }, { id: 3, variant: '@default' }];
assert.strictEqual(ev(`ivbResForVariant(${JSON.stringify(res)}, 'mba').map(r => r.id).join()`), '1,2');
assert.strictEqual(ev(`ivbResForVariant(${JSON.stringify(res)}, '').map(r => r.id).join()`), '1,3');

// ── 导入落到所选版本（管理端）──
load('admin/interview-bank.js');
ev(`ivba.major = 'keiei'; ivba.variant = 'mba'; ivba.list = {}; ivba.bank = { major_key: 'keiei', variant: 'mba', variant_label: 'MBA', match_words: ['MBA'], title: 't', chapters: [], manual_files: [], published: false };
    ivba.imp = { chapters: iviParse('# 背景\\n## 自己紹介\\n> 指导：先说结论\\n例：私は○○です。'), mode: 'new', text: '', err: '' };`);
ev(`ivbaImpApply()`);
const row = ev(`ivbaRowOf()`);
assert.strictEqual(row.major_key, 'keiei'); assert.strictEqual(row.variant, 'mba', '保存行带的是所选版本');
assert.strictEqual(row.variant_label, 'MBA'); assert.strictEqual(JSON.stringify(row.match_words), '["MBA"]');
assert.strictEqual(row.chapters.length, 1, '导入内容进了当前版本');
ev(`ivba.variant = ''; ivba.bank = { major_key: 'keiei', variant: '', variant_label: '経営学研究科', match_words: 'MBA, ビジネススクール', title: 'x', chapters: [], published: true }`);
const r0 = ev(`ivbaRowOf()`);
assert.strictEqual(r0.variant, '', '默认版本 variant 为空串'); assert.strictEqual(JSON.stringify(r0.match_words), '["MBA","ビジネススクール"]', '关键词文本被拆成数组');
assert.ok(ev(`ivbaImpTitle()`).indexOf('経営学') >= 0);

// ── 模拟面试：记录里带版本 ──
const ctx2 = vm.createContext({ console, document: { getElementById: () => null }, jstToday: () => '2026-11-20', riyuKeyOf: p => p.n, ivbAnswer: () => '', ivbDefaultSchool: () => '', RIYU_INTERVIEW_KIND: 'grad_interview', sb: async () => [],
  ivbVariantsFor: () => [{ variant: '', variant_label: '経営学研究科' }, { variant: 'mba', variant_label: 'MBA' }], ivbVariantLabel: r => r.variant_label || '标准版' });
vm.runInContext(fs.readFileSync(__dirname + '/../shared/mock-interview.js', 'utf8').replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx2);
vm.runInContext(`IVM_ST['b1'] = { sel: [{ item_key: 'free_1', q: '追问', free: true, answer: '答', rating: '○', comment: '' }], school: 'S', plans: [{ n: 'S', school_name: 'X大学' }], bank: { major_key: 'keiei', variant: 'mba', chapters: [] }, subs: [], overall_rating: '', overall: '', next: '' };`, ctx2);
const m = vm.runInContext(`ivmCollect('b1')`, ctx2);
assert.strictEqual(m.variant, 'mba'); assert.strictEqual(m.variant_label, 'MBA');
assert.strictEqual(vm.runInContext(`ivmSchoolOf(${JSON.stringify(m)})`, ctx2), 'X大学 · MBA', '学校名后带版本名');
assert.strictEqual(vm.runInContext(`ivmSchoolOf({ school_name: 'X大学' })`, ctx2), 'X大学', '老记录没有 variant：显示正常');
console.log('interview-variants: OK');
