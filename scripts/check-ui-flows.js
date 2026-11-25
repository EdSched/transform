#!/usr/bin/env node
// 页面流程自检（第二层）：用 jsdom 真的把管理端页面的脚本跑起来，点几下，看按钮、格子、确认窗口是不是真的出来了。
// 查的是「代码在、也有人调用，但运行起来按钮就是没出来」这一类（check-ui-hooks.js 静态检查查不出）。
// 所有网络请求（sb / sbAll / sbGet / fetch）都换成假数据，不连真实数据库，不需要任何密钥。
// 用法：cd scripts && npm install   （只第一次；jsdom 只是开发用依赖，不影响线上页面）
//       node scripts/check-ui-flows.js        有流程失败返回 1
const path = require('path'), vm = require('vm');
let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (e) { console.error('找不到 jsdom：先在 scripts/ 目录里跑一次 npm install'); process.exit(2); }
const { loadPage } = require(path.join(__dirname, 'lib', 'pages'));
const ROOT = path.resolve(__dirname, '..');

// 假后端：按请求路径返回假数据；handlers 里按顺序匹配
function makeDom(pageRel, handlers) {
  const pg = loadPage(path.join(ROOT, pageRel));
  const dom = new JSDOM(pg.html.replace(/<script\b[\s\S]*?<\/script>/gi, ''), { runScripts: 'outside-only', url: 'https://example.test/' + pageRel, pretendToBeVisual: true });
  const w = dom.window, ctx = dom.getInternalVMContext();
  // 用 vm.Script 跑，这样脚本顶层的 let / const 才会像真页面一样留在全局
  const run = (code, file) => new vm.Script(code, { filename: file }).runInContext(ctx);
  const fake = async (p, method) => { for (const [re, fn] of handlers) { if (re.test(p)) return fn(p, method); } return []; };
  w.__fake = fake;
  w.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => '' });
  w.alert = () => {}; w.confirm = () => true; w.prompt = () => '';
  w.console.warn = () => {}; w.console.error = () => {};
  const loadErrors = [];
  pg.scripts.forEach(s => {
    if (/shared\/supabase\.js$/.test(s.label)) { run('window.sb = (p, m) => window.__fake(p, m); window.sbAll = (p) => window.__fake(p, "GET"); window.sbUpload = async () => ({}); window.__setSbToken = () => {};', 'stub-supabase'); return; }
    try { run(s.code, s.label); } catch (e) { loadErrors.push(`${s.label}: ${e.message}`); }
  });
  return { w, run, loadErrors };
}

const results = [];
const check = (flow, ok, msg) => results.push({ flow, ok, msg });

(async () => {
  // ───── 流程 1：新建课程 → 展开单回明细，「按周几 / 回数分配老师」按钮必须出现，而且只有一个 ─────
  {
    const { w, run, loadErrors } = makeDom('admin/index.html', []);
    check('流程1 页面脚本加载', !loadErrors.length, loadErrors.join('；'));
    try {
      w.openAddCourseModal(); w.toggleAcDetails(true);
      const n1 = w.document.querySelectorAll('#ac_assign_btn').length, p1 = w.document.querySelectorAll('#ac_assign_panel').length;
      check('流程1a 展开单回明细后按钮存在且只有一个', n1 === 1 && p1 === 1, `#ac_assign_btn ×${n1}，#ac_assign_panel ×${p1}（应各 1 个）`);
      w.toggleAcDetails(true); w.toggleAcDetails(false); w.toggleAcDetails(true);
      const n2 = w.document.querySelectorAll('#ac_assign_btn').length;
      check('流程1b 反复展开 / 收起不会重复挂按钮', n2 === 1, `#ac_assign_btn ×${n2}`);
      // 「已开课」说明有内容的情况：从头再挂一次
      ['ac_assign_btn', 'ac_assign_panel'].forEach(id => { const e = w.document.getElementById(id); if (e) e.remove(); });
      const note = w.document.getElementById('ac_phase_note'); if (note) note.textContent = '这门课已开课：已上的回不能改日期，只能改后面的（说明文字）';
      w.toggleAcDetails(true);
      const n3 = w.document.querySelectorAll('#ac_assign_btn').length;
      check('流程1c 「已开课」说明有内容时按钮仍然出现', n3 === 1, `#ac_assign_btn ×${n3}（说明行在最上面时按钮挂不上，多半是按「第几个子元素」找位置）`);
    } catch (e) { check('流程1 执行', false, e.message); }
  }

  // ───── 流程 2：13 条单回渲染课程卡片，格子数必须是 13 ─────
  {
    const { w, run, loadErrors } = makeDom('admin/index.html', []);
    try {
      const sessions = [], base = new Date('2026-11-02T12:00:00Z');
      for (let i = 0; i < 13; i++) { const d = new Date(base.getTime() + i * 7 * 864e5).toISOString().slice(0, 10); sessions.push({ id: 's' + i, course_id: 'C1', session_date: d, session_num: i + 1, session_title: '第' + (i + 1) + '回', is_cancelled: false, confirmed: false, time_range: '19:00-21:00' }); }
      const course = { id: 'C1', name: 'テスト課程', major: ['fashion'], domain: 'art', start_date: '2026-11-02', first_session_date: '2026-11-02', total_sessions: 13, weekdays: '1', time_range: '19:00-21:00', class_ids: [] };
      run(`cachedCourses = ${JSON.stringify([course])}; cachedSessions = ${JSON.stringify(sessions)}; cachedSessionRecords = [];`, 'flow2-data');
      const html = w.renderCoursesSummary([course]);
      const box = w.document.createElement('div'); box.innerHTML = html;
      const grid = [...box.querySelectorAll('div')].find(d => /grid-template-columns/.test(d.getAttribute('style') || ''));
      const cells = grid ? grid.children.length : 0;
      check('流程2 13 条单回 → 课程卡片 13 个格子', cells === 13, grid ? `格子数 ${cells}（应为 13）` : '没找到单回格子区域');
    } catch (e) { check('流程2 执行', false, e.message); }
  }

  // ───── 流程 3：确认窗口，教室被占 + 会议账号被占 → 出现「改成线上」「稍后调整另一门」按钮 ─────
  {
    const date = '2026-12-07';
    const weekly = { id: 'b1', kind: 'course', course_id: 'C1', recurrence: 'weekly', status: 'confirmed', weekday: 1, start_time: '19:00', end_time: '21:00', room_id: 'R1', uses_meeting: true, meeting_account_id: 'A1', start_date: '2026-11-02', end_date: '2027-01-31' };
    const blocker = { id: 'x1', kind: 'once', recurrence: 'once', booking_date: date, start_time: '19:00', end_time: '21:00', title: '别的课', user_name: '张老师', status: 'confirmed', course_id: null };
    const handlers = [
      [/sched_rooms\?/, () => [{ id: 'R1', name: '教室A' }]],
      [/sched_meeting_accounts\?/, () => [{ id: 'A1', name: '会议账号1' }]],
      [/sched_bookings\?room_id=eq\.R1/, () => [blocker]],
      [/sched_bookings\?meeting_account_id=eq\.A1/, () => [blocker]],
      [/sched_bookings\?kind=eq\.course&course_id=eq\.C1/, () => [weekly]],
    ];
    const { w, loadErrors } = makeDom('admin/index.html', handlers);
    try {
      const course = { id: 'C1', name: 'テスト課程' };
      const ses = { id: 's5', course_id: 'C1', session_date: date, time_range: '19:00-21:00', is_cancelled: false };
      const p = w.srmOpen({ course, changes: [{ id: 's5', num: 6, from: { date: '2026-12-14', time: '19:00-21:00' }, to: { date, time: '19:00-21:00' } }], sessions: [ses] });
      // 弹窗是 await 一串请求之后才出来的：等它出现
      let ov = null; for (let i = 0; i < 100 && !ov; i++) { await new Promise(r => setTimeout(r, 20)); ov = w.document.getElementById('srmOv'); }
      const txt = ov ? ov.textContent : '';
      check('流程3a 确认窗口弹出', !!ov, '没有弹出 #srmOv（教室被占时应该弹确认窗口）');
      check('流程3b 窗口里出现「改成线上」按钮', /改成线上/.test(txt), '没有「改成线上」');
      check('流程3c 窗口里出现「稍后调整另一门」按钮', /稍后调整另一门/.test(txt), '没有「稍后调整另一门」');
      check('流程3d 窗口里出现「交给总务」', /交给总务/.test(txt), '没有「交给总务」');
      if (ov) { const c = ov.querySelector('button'); ov.remove(); }
    } catch (e) { check('流程3 执行', false, e.message); }
  }

  // ───── 流程 4：休讲并顺延 rsDoShift：不抛异常，返回值里有 newSession（曾因 newSession 声明在块里面而报 not defined）─────
  {
    const { w, run, loadErrors } = makeDom('admin/index.html', [[/./, () => []]]);
    try {
      const sessions = [], base = new Date('2026-11-02T12:00:00Z');
      for (let i = 0; i < 5; i++) { const d = new Date(base.getTime() + i * 7 * 864e5).toISOString().slice(0, 10); sessions.push({ id: 's' + i, course_id: 'C1', course_name: 'テスト課程', major: 'fashion', session_date: d, session_number: i + 1, session_title: '第' + (i + 1) + '回', teacher: 'T', session_teacher: 'T', is_cancelled: false, confirmed: false, time_range: '19:00-21:00' }); }
      const course = { id: 'C1', name: 'テスト課程', major: ['fashion'], total_sessions: 5, weekdays: '1', time_range: '19:00-21:00', skip_dates: '' };
      run(`cachedCourses = ${JSON.stringify([course])}; cachedSessions = ${JSON.stringify(sessions)};`, 'flow4-data');
      const r = await run("rsDoShift(cachedSessions[1], '测试', '', '2026-12-14', '')", 'flow4-call');
      check('流程4a 休讲并顺延 rsDoShift 不抛异常且返回 newSession', !!(r && r.newSession && r.newSession.id && r.target && r.origTarget && r.newDateStr && r.courseId), '返回对象缺字段：' + JSON.stringify(Object.keys(r || {})));
      check('流程4b 末尾只多一回，且回数是原最后一回的编号', run('cachedSessions.length', 'flow4-n') === 6 && r.newSession.session_number === 5, '课次数或回数不对');
    } catch (e) { check('流程4 休讲并顺延 执行', false, e.message); }
  }

  const bad = results.filter(r => !r.ok);
  results.forEach(r => console.log(`${r.ok ? '通过' : '失败'}  ${r.flow}${r.ok ? '' : '：' + r.msg}`));
  console.log(`\n共 ${results.length} 项：失败 ${bad.length} 项`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
