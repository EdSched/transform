// node tests/session-coord.test.js —— 课程整体改日期 / 时间 → 自动通知总务：只通知今天以后、有教室的回；撞教室要标明
const fs = require('fs'), vm = require('vm'), assert = require('assert');
// 假数据库：sb(path) 按路径返回
const DB = { bookings: [], sessions: [], logs: [] };
const sb = async (path, method, body) => {
  if (method === 'POST' && path.includes('sched_change_log')) { body.forEach(b => DB.logs.push(Object.assign({ id: DB.logs.length + 1 }, b))); return body; }
  if (method === 'PATCH') return [];
  if (path.includes('sched_change_log')) return DB.logs;
  if (path.includes('course_sessions')) return DB.sessions;
  if (path.includes('sched_bookings')) return DB.bookings;
  return [];
};
const ctx = vm.createContext({ console, sb, jstToday: () => '2026-11-21', ccMD: d => d, CC_WD: ['日', '一', '二', '三', '四', '五', '六'], ccEsc: x => x, ccOverlay: () => ({}), CC_BOX: '',
  timeRangesSpan: tr => { const m = String(tr || '').match(/(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/); return m ? { start: m[1], end: m[2] } : { start: '', end: '' }; } });
vm.runInContext(fs.readFileSync(__dirname + '/../shared/session-room-confirm.js', 'utf8').replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
const run = code => vm.runInContext(code, ctx);
const course = { id: 'c1', name: '测试课' };
const wk = { id: 'b1', room_id: 'R1', weekday: 1, recurrence: 'weekly', kind: 'course', course_id: 'c1', start_time: '14:00', end_time: '17:00', status: 'confirmed' };
// 11/16 周一（已上过）、11/23 周一、11/30 周一；整体 14:00-17:00 → 15:00-18:00
const mk = (id, num, date) => ({ id, num, from: { date, time: '14:00-17:00' }, to: { date, time: '15:00-18:00', cancelled: false } });
const changes = [mk('s1', 1, '2026-11-16'), mk('s2', 2, '2026-11-23'), mk('s3', 3, '2026-11-30')];
ctx.__ch = changes; ctx.__c = course;
const plan = async (bks) => { ctx.__b = bks; return run(`srmAutoPlan(__c, __ch, __b, id => 'A101', '2026-11-21')`); };
(async () => {
  // 2) 有教室的回进通知，已上过的回不进
  DB.bookings = []; DB.sessions = [];
  let p = await plan([wk]);
  assert.strictEqual(JSON.stringify(p.map(x => x.ch.id)), JSON.stringify(['s2', 's3']), '只通知今天以后的回');
  assert.strictEqual(p[0].change.reason, 'changed'); assert.ok(/上课时间由 14:00-17:00 改为 15:00-18:00/.test(p[0].change.note), p[0].change.note);
  assert.strictEqual(p[0].change.room_name, 'A101');
  // 没教室占用：不发
  assert.strictEqual((await plan([])).length, 0, '没排教室的课不发重排');
  assert.strictEqual((await plan([Object.assign({}, wk, { room_id: null })])).length, 0, '只有线上占用也不发');
  // 日期变化：note 写明日期
  ctx.__ch = [{ id: 's2', num: 2, from: { date: '2026-11-23', time: '14:00-17:00' }, to: { date: '2026-11-24', time: '14:00-17:00', cancelled: false } }];
  p = await plan([wk]); assert.ok(/日期由/.test(p[0].change.note), p[0].change.note);
  // 3) 新时间段原教室被别的占用撞了 → 标明冲突
  ctx.__ch = changes;
  DB.bookings = [{ id: 'x1', room_id: 'R1', kind: 'rental', recurrence: 'once', booking_date: '2026-11-23', start_time: '17:00', end_time: '18:30', title: '外部活动', user_name: '王', status: 'confirmed' }];
  p = await plan([wk]);
  assert.strictEqual(p[0].change.reason, 'blocked', '撞教室'); assert.ok(p[0].change.blocker.includes('外部活动'), p[0].change.blocker);
  assert.strictEqual(p[1].change.reason, 'changed', '没撞的回不标冲突');
  // 写入：同一回只留一条（再写一次是 PATCH 而不是新增）
  DB.bookings = []; DB.logs = [];
  await run(`srmCoordWrite(__c, ${JSON.stringify(p[0].change)}, '测试')`);
  assert.strictEqual(DB.logs.length, 1);
  console.log('session-coord: OK');
})().catch(e => { console.error(e); process.exit(1); });
