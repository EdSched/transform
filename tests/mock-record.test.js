// node tests/mock-record.test.js —— 模拟面试记录：工资判断兼容 + 合并 / 空壳规则
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = vm.createContext({ console, document: { getElementById: () => null }, jstToday: () => '2026-11-20', riyuKeyOf: p => p.n, ivbAnswer: () => '', ivbDefaultSchool: () => '', ivbForStudent: async () => null, RIYU_INTERVIEW_KIND: 'grad_interview', sb: async () => [] });
const load = f => vm.runInContext(fs.readFileSync(__dirname + '/../' + f, 'utf8').replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
load('shared/payroll-core.js'); load('shared/mock-interview.js');
vm.runInContext(fs.readFileSync(__dirname + '/../shared/follow-up.js', 'utf8').match(/function tmHasRec[^\n]*/)[0], ctx);
const has = (b, f) => vm.runInContext(`${f}(${JSON.stringify(b)})`, ctx);
const mock = { school_key: 'S', qa: [{ q: '自己紹介', answer: '…', rating: '○' }], overall: '整体不错', overall_rating: '○' };
// 只有 mock 记录的预约：工资口径 / 面谈跟进都认作「有内容」
assert.strictEqual(has({ daily_record: { mock } }, 'payrollHasRecord'), true, 'payrollHasRecord 认 mock');
assert.strictEqual(has({ daily_record: { mock } }, 'tmHasRec'), true, 'tmHasRec 认 mock');
assert.strictEqual(has({ daily_record: { mock }, type: 'mock', status: 'completed' }, 'payrollInterviewDone'), true, '已完成 + mock → 进工资');
// 空壳 mock 不会被写进去（嵌套数组 [] 在 payrollHasRecord 里是 truthy，所以不能让空壳混入）
vm.runInContext(`var __st = IVM_ST['b1'] = { sel: [], school: '', plans: [], overall_rating: '', overall: '', next: '' };`, ctx);
assert.strictEqual(vm.runInContext(`ivmCollect('b1')`, ctx), null, '空表单 → null');
const rec = vm.runInContext(`ivmMergeRecord({ daily_record: { extra: '补充', mock: { overall: 'old' } } }, 'b1')`, ctx);
assert.strictEqual(rec.mock, undefined, '空表单会删掉 mock 键'); assert.strictEqual(rec.extra, '补充', '其他键保留');
vm.runInContext(`IVM_ST['b1'].overall = '好'; IVM_ST['b1'].sel = [{ item_key: 'free_1', q: '追问', free: true, answer: '答', rating: '△', comment: '' }];`, ctx);
const r2 = vm.runInContext(`ivmMergeRecord({ daily_record: { extra: '补充' } }, 'b1')`, ctx);
assert.strictEqual(r2.mock.qa[0].rating, '△'); assert.strictEqual(r2.extra, '补充');
assert.strictEqual(vm.runInContext(`ivmMergeRecord({ daily_record: { extra: 'x' } }, 'never-mounted')`, ctx).extra, 'x', '没打开过表单：不动原记录');
console.log('mock-record: OK');
