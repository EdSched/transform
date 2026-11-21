// node tests/once-time-link.test.js —— 单日占用（某一回换了教室）的时间跟着这一回走（sched/common.js linkCourseBookings）
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = vm.createContext({ console, URLSearchParams, setTimeout, clearTimeout, Promise, Map, Set, Date, Math, JSON, localStorage: { getItem: () => null, setItem() {} }, document: {}, location: { search: '', href: '' }, fetch: async () => ({}) });
ctx.window = ctx;
vm.runInContext(fs.readFileSync(__dirname + '/../sched/common.js', 'utf8').replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
const run = c => vm.runInContext(c, ctx);
// 这门课 11/30（周一）这一回的时间由 14:00-17:00 改成 15:00-18:00；11/30 另有一条单日占用（换到了 B 教室）还存着旧时间
ctx.COURSE_LINK = { c1: { course: { id: 'c1', start_time: '14:00', end_time: '17:00', weekdays: '1', start_date: '2026-11-02', end_date: '2026-12-28' },
  days: new Map([['2026-11-23', ['14:00', '17:00']], ['2026-11-30', ['15:00', '18:00']]]) } };
ctx.COURSE_LINK_RANGE = ['2026-11-01', '2027-01-01'];
const once = { id: 'o1', kind: 'course', recurrence: 'once', course_id: 'c1', booking_date: '2026-11-30', room_id: 'B', start_time: '14:00:00', end_time: '17:00:00', status: 'confirmed' };
const same = { id: 'o2', kind: 'course', recurrence: 'once', course_id: 'c1', booking_date: '2026-11-23', room_id: 'B', start_time: '14:00:00', end_time: '17:00:00', status: 'confirmed' };
const orphan = { id: 'o3', kind: 'course', recurrence: 'once', course_id: 'c1', booking_date: '2026-12-07', room_id: 'B', start_time: '14:00:00', end_time: '17:00:00', status: 'confirmed' };
const bks = [once, same, orphan]; ctx.__b = bks;
run('linkCourseBookings(__b)');
assert.strictEqual(once.start_time, '15:00'); assert.strictEqual(once.end_time, '18:00', '1) 单日占用显示成这一回的新时间');
assert.strictEqual(same.start_time, '14:00:00', '时间没变的不动');
assert.strictEqual(orphan.start_time, '14:00:00', '那天没有单回（遗留占用）保持原样');
// 教室冲突按新时间算：B 教室 11/30 14:30-15:30 只和 15:00 之后重叠
assert.strictEqual(run(`roomConflicts(__b, 'B', '2026-11-30', '17:30', '18:30', null)`).length, 1, '新时间段（17:30-18:30）与它重叠');
assert.strictEqual(run(`roomConflicts(__b, 'B', '2026-11-30', '14:00', '14:30', null)`).length, 0, '旧时间段不再被它占着');
// 再调用一次：先还原再重新算，不会叠加
run('linkCourseBookings(__b)'); assert.strictEqual(once.start_time, '15:00');
// 这一回又改回原时间：还原
ctx.COURSE_LINK.c1.days.set('2026-11-30', ['14:00', '17:00']); run('linkCourseBookings(__b)');
assert.strictEqual(once.start_time, '14:00:00', '改回后恢复原值'); assert.ok(!once._orig);
// 同一天两回：取最早开始～最晚结束
console.log('once-time-link: OK');
