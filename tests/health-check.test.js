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

// 5) 排不下预警：市谷有 2 间教室，3 门课周一 14:00-17:00 同时上 → 需要 3 间、可用 2 间；2 门课够用不报
const rooms = [{ id: 'A', campus: '市谷' }, { id: 'B', campus: '市谷' }, { id: 'Z', campus: '高马' }];
const mk = (id, extra) => Object.assign({ id, name: '课' + id, campus: '市谷', mode: '线下', weekdays: '1', start_time: '14:00', end_time: '17:00', start_date: '2026-11-02', end_date: '2026-12-28' }, extra || {});
const cap = (courses, bookings) => { ctx.__c = courses; ctx.__r = rooms; ctx.__bk = bookings || []; return run(`hcCapacity({ courses: __c, rooms: __r, bookings: __bk, link: {}, today: '2026-11-21', to: '2026-11-28' })`); };
let w = cap([mk('1'), mk('2')]);
assert.strictEqual(w.length, 0, '2 门课 2 间教室：够用不报');
w = cap([mk('1'), mk('2'), mk('3')]);
assert.strictEqual(w.length, 1); assert.deepStrictEqual([w[0].campus, w[0].date, w[0].slot, w[0].need, w[0].avail, w[0].short], ['市谷', '2026-11-23', '14:00-17:00', 3, 2, 1]);
assert.strictEqual(w[0].courses.length, 3);
// 同系列算一门；不同校区、线上课不算
w = cap([mk('1', { merge_group: 'g' }), mk('2', { merge_group: 'g' }), mk('3'), mk('4', { campus: '高马' }), mk('5', { mode: '线上' })]);
assert.strictEqual(w.length, 0, '系列算一门、别的校区和线上不算');
// 一间教室被临时占用（外借 15:00-16:00）：可用 1 间，2 门课就不够；占用的时间不重叠则不影响
w = cap([mk('1'), mk('2')], [{ id: 'r1', kind: 'rental', recurrence: 'once', booking_date: '2026-11-23', room_id: 'A', start_time: '15:00', end_time: '16:00', status: 'confirmed' }]);
assert.strictEqual(w.length, 1); assert.strictEqual(w[0].avail, 1);
w = cap([mk('1'), mk('2')], [{ id: 'r2', kind: 'rental', recurrence: 'once', booking_date: '2026-11-23', room_id: 'A', start_time: '18:00', end_time: '19:00', status: 'confirmed' }]);
assert.strictEqual(w.length, 0);
// 确认无碍：需求数或可用数变了就重新提示
const x = { campus: '市谷', date: '2026-11-23', slot: '14:00-17:00', need: 3, avail: 2 };
ctx.__x = x; ctx.__acks = [{ key: 'cap|市谷|2026-11-23|14:00-17:00', need: 3, avail: 2 }];
assert.strictEqual(run('hcCapAcked(__x, __acks)'), true);
ctx.__x = Object.assign({}, x, { need: 4 }); assert.strictEqual(run('hcCapAcked(__x, __acks)'), false, '需求数变了要重新提示');
ctx.__x = Object.assign({}, x, { avail: 1 }); assert.strictEqual(run('hcCapAcked(__x, __acks)'), false, '可用数变了要重新提示');
// 6) 通知总务后等了超过 2 天还没处理
const now = Date.parse('2026-11-21T12:00:00Z');
ctx.__g = [
  { name: '新课', act: [{ x: { num: 3 }, logs: [{ created_at: '2026-11-17T12:00:00Z' }], fb: null }] },
  { name: '刚通知', act: [{ x: { num: 1 }, logs: [{ created_at: '2026-11-21T08:00:00Z' }], fb: null }] },
  { name: '已反馈', act: [{ x: { num: 2 }, logs: [{ created_at: '2026-11-01T12:00:00Z' }], fb: {} }] }];
ctx.__now = now; const st = run('hcStale(__g, __now)');
assert.strictEqual(st.length, 1); assert.strictEqual(st[0].name, '新课'); assert.strictEqual(st[0].days, 4);
console.log('health-check: OK');
