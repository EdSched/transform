// node tests/health-check.test.js —— 课程 / 教室一致性体检：遗留占用、时间不一致、教室重叠各自能查出；没问题时全是 0
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = vm.createContext({ console, URLSearchParams, setTimeout, clearTimeout, Promise, Map, Set, Date, Math, JSON, localStorage: { getItem: () => null, setItem() {} }, document: {}, location: { search: '', href: '' }, fetch: async () => ({}) });
ctx.window = ctx;
['sched/common.js', 'sched/health.js'].forEach(f => vm.runInContext(fs.readFileSync(__dirname + '/../' + f, 'utf8').replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx));
const run = c => vm.runInContext(c, ctx);
const C = { id: 'c1', start_time: '14:00', end_time: '17:00', weekdays: '1', start_date: '2026-11-02', end_date: '2026-12-28' };
ctx.COURSE_LINK = { c1: { course: C, days: new Map([['2026-11-23', ['14:00', '17:00']], ['2026-11-30', ['15:00', '18:00']], ['2026-12-07', ['14:00', '17:00']]]) } };
ctx.COURSE_LINK_RANGE = ['2026-11-01', '2027-01-01'];
const wk = { id: 'w1', kind: 'course', recurrence: 'weekly', course_id: 'c1', room_id: 'A', weekday: 1, start_time: '14:00', end_time: '17:00', start_date: '2026-11-02', end_date: '2026-12-28', status: 'confirmed' };
const base = (extra) => [Object.assign({}, wk)].concat(extra || []);
const check = bks => { ctx.__b = bks; run('linkCourseBookings(__b)'); return run(`hcCheck({ bookings: __b, link: COURSE_LINK, range: COURSE_LINK_RANGE, today: '2026-11-21', days: 60 })`); };
// 全部正常
let r = check(base());
assert.strictEqual(r.total, 0, '没问题时全是 0：' + JSON.stringify([r.orphans.length, r.timeMismatch.length, r.uncovered.length, r.overlaps.length]));
// 1) 遗留占用：12/14 这天没有单回
r = check(base([{ id: 'o1', kind: 'course', recurrence: 'once', course_id: 'c1', booking_date: '2026-12-14', room_id: 'B', start_time: '14:00', end_time: '17:00', status: 'confirmed' }]));
assert.strictEqual(r.orphans.length, 1); assert.strictEqual(r.orphans[0].date, '2026-12-14');
// 2) 时间不一致：11/30 这一回 15:00-18:00，单日占用还存着 14:00-17:00（体检看原始值）
r = check(base([{ id: 'o2', kind: 'course', recurrence: 'once', course_id: 'c1', booking_date: '2026-11-30', room_id: 'B', start_time: '14:00:00', end_time: '17:00:00', status: 'confirmed' }]));
assert.strictEqual(r.timeMismatch.length, 1); assert.strictEqual(r.timeMismatch[0].from.join('-'), '14:00-17:00'); assert.strictEqual(r.timeMismatch[0].to.join('-'), '15:00-18:00');
assert.strictEqual(r.orphans.length, 0);
// 3) 未覆盖：每周占用被人工释放 11/23，又没有单日占用
r = check([Object.assign({}, wk, { manual_off_dates: '2026-11-23' })]);
assert.ok(r.uncovered.some(x => x.date === '2026-11-23'), '11/23 没人占');
// 4) 教室重叠：A 教室周一 14:00-17:00（课），另一门外借 A 教室 11/23 16:00-18:00
r = check(base([{ id: 'x1', kind: 'rental', recurrence: 'once', booking_date: '2026-11-23', room_id: 'A', start_time: '16:00', end_time: '18:00', title: '外借', status: 'confirmed' }]));
assert.strictEqual(r.overlaps.length, 1); assert.strictEqual(r.overlaps[0].days.join(','), '2026-11-23');
// 按每一回实际时间算：11/30 那一回改成 15:00-18:00 后，外借 17:30-19:00 才算重叠（原始字段 14:00-17:00 不重叠）
r = check(base([{ id: 'x2', kind: 'rental', recurrence: 'once', booking_date: '2026-11-30', room_id: 'A', start_time: '17:30', end_time: '19:00', title: '外借', status: 'confirmed' }]));
assert.strictEqual(r.overlaps.length, 1, '按每一回的实际时间算');
console.log('health-check: OK');
