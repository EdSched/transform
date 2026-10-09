// ══════════════════════════════════
// shared/mgmt-metrics.js — 管理可视化：指标定义 + 范围工厂 + 缓存（第一阶段：admin 全局层 + 负责人层）
// 只检测「业务状态」（真的做了没有），不存在「点了已处理就算完成」。不新建数据表。
// 每个指标返回：
//   rate 型：{ done, total, items, denom, period, desc }       —— 每个完成率都写明分母和统计周期
//   list 型：{ count, items, denom, period, desc }              —— 没有可靠分母，只显示「待处理 X 人」
//   未接入 ：{ na:true, note }；读取失败：{ err }
//   items：[{ sid?, name, note, owners:[负责老师姓名] }]
// 数据：复用 shared/task-checks.js 的加载器（同一个 D 里每张表只查一次）；范围复用 scopeStudent / scopeCourse / scopeMajor
// 依赖：shared/supabase.js、shared/constants.js、shared/tasks.js、shared/task-checks.js
// ══════════════════════════════════
const MGM_TTL = 60000;                       // 同一范围同一指标 60 秒内不重复计算
let MGM_D = null, MGM_D_AT = 0, MGM_CACHE = {};
function mgmData() {
  if (!MGM_D || Date.now() - MGM_D_AT > MGM_TTL) { MGM_D = taskDataNew(); MGM_D_AT = Date.now(); }
  return MGM_D;
}
function mgmClearCache() { MGM_D = null; MGM_CACHE = {}; }
// 读取失败要往外抛（task-checks 里的加载器会把失败吞成空数组，这里新加的表不吞）
const mgmLoad = (D, key, fn) => D.p[key] || (D.p[key] = Promise.resolve().then(fn));

// ── 范围工厂 ──
// opt: {kind:'all'} 全部在籍 / {kind:'domain', domain} 某个领域 / {kind:'view', mine:'老师姓名'|''} 当前视角（可选只看某老师名下）
// 返回 { key, label, mine, stu(s), course(c), sess(x, courseMap) }
function mgmScope(opt) {
  opt = opt || { kind: 'all' };
  const mine = (opt.kind === 'view' && opt.mine) || '';
  const majorsOf = s => [s.major, ...(Array.isArray(s.extra_majors) ? s.extra_majors : [])].filter(Boolean);
  const courseMajors = c => Array.isArray(c.major) ? c.major : (c.major ? [c.major] : []);
  const hasName = (v, nm) => String(v || '').includes(nm);
  let stu, course, label, key;
  if (opt.kind === 'domain') {
    const dom = opt.domain;
    stu = s => majorsOf(s).some(m => MAJOR_DOMAIN[m] === dom);
    course = c => c.domain === dom || courseMajors(c).some(m => MAJOR_DOMAIN[m] === dom);
    label = dom; key = 'd:' + dom;
  } else if (opt.kind === 'view') {
    const ownS = s => !mine || (s.owner_teachers || []).includes(mine) || (s.vip_teachers || []).includes(mine);
    stu = s => scopeStudent(s) && ownS(s);
    course = c => scopeCourse(c) && (!mine || hasName(c.teacher, mine));
    label = scopeSummary() + (mine ? `（${mine} 名下）` : '');
    key = 'v:' + JSON.stringify(VIEW_SCOPE) + '|' + mine;
  } else {
    stu = () => true; course = () => true; label = '全部领域'; key = 'all';
  }
  const sess = (x, courseMap) => {
    if (opt.kind !== 'domain' && opt.kind !== 'view') return true;
    const c = courseMap && courseMap[x.course_id]; if (!c) return false;
    if (!(opt.kind === 'domain' ? course(c) : scopeCourse(c))) return false;
    return !mine || hasName(x.session_teacher, mine) || hasName(x.teacher, mine);   // 课次按 session_teacher / teacher 含姓名
  };
  return { key, label, mine, domain: opt.domain || '', stu, course, sess };
}

// ── 小工具 ──
const _mgNames = v => String(v || '').split(/[、,，\/／;；\s]+/).map(x => x.trim()).filter(Boolean);
const _mgStuItem = (s, note) => ({ sid: s.id, name: s.name, note: note || '', owners: (s.owner_teachers || []).filter(Boolean) });
const _mgCourseMap = courses => { const m = {}; courses.forEach(c => m[c.id] = c); return m; };
const _mgRate = (done, total, items, denom, period, desc) => ({ done, total, items, denom, period, desc });
const _mgSchoolFmt = p => [p.school_name, p.faculty, p.department].filter(Boolean).join(' · ');
const _mgQuarter = () => {   // 本期：1月期→1–3月 … 期末月月末前处理
  const m = new Date(jstToday() + 'T00:00:00').getMonth();   // 0-based
  const a = Math.floor(m / 3) * 3;
  return { from: a + 1, to: a + 3, monthsLeft: a + 2 - m };   // monthsLeft：距期末月还有几个月（0=本月就是期末月）
};

// ── 指标 ──
const MGM_GROUPS = [
  { key: 'interview', label: '面谈相关', metrics: [
    { key: 'interview', label: '本月面谈', async fn(D, sc) {
      const [all, bk] = await Promise.all([taskStudents(D), taskBookingsMonth(D)]);
      const stu = all.filter(sc.stu), ids = new Set(), names = new Set();
      bk.filter(_tkHasRec).forEach(b => { if (b.student_id) ids.add(b.student_id); if (b.name) names.add(b.name); });
      const items = stu.filter(s => !ids.has(s.id) && !names.has(s.name)).map(s => _mgStuItem(s, '本月没有面谈记录'));
      return _mgRate(stu.length - items.length, stu.length, items, '本月应面谈的在籍学生', `当月（${_tkYm()}）`, '完成 = 本月预约里有面谈记录（daily_record）的学生；名单 = 本月还没有面谈记录的学生');
    } },
  ] },
  { key: 'vip', label: 'VIP课程', na: true, metrics: [] },
  { key: 'course', label: '课程管理', metrics: [
    { key: 'next_term', label: '下一期课程录入与发布', async fn(D, sc) {
      const [courses, sess] = await Promise.all([taskCourses(D), taskSessions(D)]);
      const nt = taskNextTerm(), mine = courses.filter(c => sc.course(c) && periodKeyOf(c) === nt.key);
      const sBy = {}; sess.forEach(x => (sBy[x.course_id] = sBy[x.course_id] || []).push(x));
      const items = [];
      mine.forEach(c => {
        const ss = sBy[c.id] || [], owners = _mgNames(c.teacher);
        if (!ss.length) items.push({ name: c.name, note: '还没有录入单回', owners });
        else if (!ss.every(x => x.confirmed)) items.push({ name: c.name, note: `单回未全部确认发布（${ss.filter(x => x.confirmed).length}/${ss.length}）`, owners });
      });
      return _mgRate(mine.length - items.length, mine.length, items, `${nt.key}范围内已建课程数`, `下一期 ${nt.key}（距开课 ${nt.days} 天）`, '完成 = 已录入单回、且单回全部确认发布的课程；名单 = 没录入单回 / 单回未全部确认的课程');
    } },
    { key: 'attendance', label: '已上完课次出席登记', async fn(D, sc) {
      const [courses, sess, recs] = await Promise.all([taskCourses(D), taskSessions(D), taskRecords(D)]);
      const cm = _mgCourseMap(courses), today = jstToday(), from = _tkDaysAgo(60), done = new Set(recs.map(r => r.session_id));
      const list = sess.filter(x => x.confirmed && !x.is_cancelled && x.session_date < today && x.session_date >= from && sc.sess(x, cm));
      const items = list.filter(x => !done.has(x.id)).sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)))
        .map(x => ({ name: x.course_name || '', note: `${x.session_date} 还没记出席`, owners: _mgNames(x.session_teacher || x.teacher) }));
      return _mgRate(list.length - items.length, list.length, items, '最近 60 天内已确认、未取消、已上完的课次', '最近 60 天', '完成 = 该课次已有出席记录；名单 = 还没记出席的课次，负责老师 = 课次老师');
    } },
    { key: 'room', label: '排教室', async fn(D, sc) {
      if (sc.mine) return { na: true, note: '排教室不分老师，「我名下」不统计' };
      let cs, bk;
      try {
        [cs, bk] = await Promise.all([
          mgmLoad(D, 'mg_sc', () => sbAll('/rest/v1/sched_courses?select=id,name,term,end_date,teacher&deleted_at=is.null')),
          mgmLoad(D, 'mg_sb', () => sbAll('/rest/v1/sched_bookings?select=course_id&kind=eq.course&course_id=not.is.null')),
        ]);
      } catch (e) { return { na: true, note: '读不到排课系统的数据，暂未接入' }; }
      const today = jstToday(), live = cs.filter(c => !c.end_date || c.end_date >= today), has = new Set(bk.map(b => String(b.course_id)));
      const items = live.filter(c => !has.has(String(c.id))).map(c => ({ name: c.name || '', note: `${c.term || '未分期'} · 还没排教室`, owners: _mgNames(c.teacher) }));
      return _mgRate(live.length - items.length, live.length, items, '未结课的排课系统课程（结课日未过）', '至今未结课', '完成 = 在排课系统预约里已有「课程」记录的课。注意：排教室不分领域，各领域显示的是同一个全局数字');
    } },
  ] },
  { key: 'student', label: '学生管理', metrics: [
    { key: 'absent3', label: '本月连续三次不出席', async fn(D, sc) {
      const [all, recs] = await Promise.all([taskStudents(D), taskRecords(D)]);
      const stu = all.filter(sc.stu), byId = {}, byName = {}; stu.forEach(s => { byId[s.id] = s; byName[s.name] = s; });
      const ym = _tkYm(), g = {};
      recs.filter(r => String(r.session_date || '').startsWith(ym)).forEach(r => {
        const s = (r.student_id && byId[r.student_id]) || byName[r.student_name]; if (!s) return;
        const m = g[s.id] = g[s.id] || { s, by: {} }, k = r.session_id || r.session_date, old = m.by[k];
        if (!old || String(r.created_at || '') < String(old.created_at || '')) m.by[k] = r;   // 同一课次重复记录取最早一条
      });
      let should = 0, present = 0; const items = [], total = Object.keys(g).length;
      Object.values(g).forEach(m => {
        const rows = Object.values(m.by).sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
        should += rows.length; present += rows.filter(r => !_tkIsAbs(r)).length;
        let run = [], hit = null;
        rows.forEach(r => { if (_tkIsAbs(r)) { run.push(r); if (run.length >= 3 && !hit) hit = run.slice(); } else run = []; });   // 请假不算缺席；月初恢复出席不抵消之后的连续三次
        if (hit) items.push(_mgStuItem(m.s, `连续缺席：${hit.map(r => r.session_date.slice(5)).join('、')}`));
      });
      return _mgRate(total - items.length, total, items, '本月有出席登记的学生', `当月（${ym}）`,
        `完成 = 本月没有「连续 ≥3 次不出席」的学生；请假不算缺席。本月应出席课次 ${should}、已出席 ${present}（含请假）`);
    } },
    { key: 'expiry', label: '本期到期学生', kind: 'list', async fn(D, sc) {
      const stu = (await taskStudents(D)).filter(sc.stu), q = _mgQuarter(), items = [];
      stu.forEach(s => {
        const m = taskExpiryMonths(s.expiry_date);
        if (m != null && m <= q.monthsLeft) items.push(_mgStuItem(s, `到期：${s.expiry_date}${m < 0 ? '（已过期仍在籍）' : m === 0 ? '（本月）' : ''}`));
      });
      return { count: items.length, items, denom: '无可靠分母，只显示待处理人数', period: `本期（${currentPeriodKey()}：${q.from}–${q.to}月），期末月月末前处理`, desc: '名单 = 到期月在本期内、或更早已过期但仍在籍的学生；处理（续约 / 离籍）后自然消失' };
    } },
    { key: 'plan', label: '研究计划书/志望理由书', async fn(D, sc) {
      const [all, plans, drafts, riyu] = await Promise.all([taskStudents(D), taskPlans(D), taskDrafts(D), taskRiyu(D)]);
      const stu = all.filter(sc.stu), pBy = {}, rBy = {};
      plans.forEach(p => (pBy[p.student_id] = pBy[p.student_id] || []).push(p)); riyu.forEach(r => (rBy[r.student_id] = rBy[r.student_id] || []).push(r));
      const items = stu.filter(s => !taskHasPlan(s, pBy[s.id] || [], drafts[s.id], rBy[s.id] || []))
        .map(s => _mgStuItem(s, (typeof isGakubuStudent === 'function' && isGakubuStudent(s)) ? '缺志望理由书' : '缺研究计划书'));
      return _mgRate(stu.length - items.length, stu.length, items, '在籍学生', '在籍期间', '完成 = 研究计划书（学部为志望理由书）已有内容的学生');
    } },
    { key: 'school', label: '志望校登记', async fn(D, sc) {
      const [all, plans] = await Promise.all([taskStudents(D), taskPlans(D)]);
      const stu = all.filter(sc.stu), has = new Set(plans.map(p => p.student_id));
      const items = stu.filter(s => !has.has(s.id)).map(s => _mgStuItem(s, '还没有登记志望校'));
      return _mgRate(stu.length - items.length, stu.length, items, '在籍学生', '在籍期间', '完成 = 至少登记了一所志望校的学生');
    } },
    { key: 'result', label: '出愿后结果登记', async fn(D, sc) {
      const [all, plans] = await Promise.all([taskStudents(D), taskPlans(D)]);
      const by = {}; all.filter(sc.stu).forEach(s => by[s.id] = s);
      const applied = plans.filter(p => by[p.student_id] && (p.status === 'applied' || p.status === 'passed' || SCHOOL_FAILED_STATUSES.includes(p.status)));
      const items = applied.filter(p => p.status === 'applied').map(p => _mgStuItem(by[p.student_id], _mgSchoolFmt(p) + '（已出愿，未登记结果）'));
      return _mgRate(applied.length - items.length, applied.length, items, '已出愿的志望校数（含已登记结果的）', '至今', '完成 = 已出愿的志望校里，已登记合格 / 不合格结果的；名单 = 状态仍是「已出愿」的志望校');
    } },
  ] },
  { key: 'promo', label: '宣传管理', na: true, metrics: [] },
  { key: 'research', label: '教研管理', metrics: [
    { key: 'homework', label: '本期作业批改', async fn(D, sc) {
      const [courses, hws] = await Promise.all([taskCourses(D), taskHwSessions(D)]);
      const cm = _mgCourseMap(courses), sess = hws.filter(x => inCurrentPeriod(x.session_date) && sc.sess(x, cm));
      const subs = sess.length ? await taskHwSubs(D, sess.map(x => x.id)) : [], sBy = {}; sess.forEach(x => sBy[x.id] = x);
      const items = subs.filter(x => !hwFeedbacks(x).length).map(x => { const se = sBy[x.session_id] || {}; return { sid: x.student_id || '', name: x.student_name || '', note: `${se.course_name || ''} ${se.session_date || ''} 未批改`, owners: _mgNames(se.session_teacher || se.teacher) }; });
      return _mgRate(subs.length - items.length, subs.length, items, '本期已提交的作业数', `当期（${currentPeriodKey()}）`, '完成 = 已有老师批改反馈的作业；名单 = 还没批改的作业，负责老师 = 课次老师');
    } },
    { key: 'profile', label: '讲师介绍完成度', async fn(D, sc) {
      const [teachers, profs] = await Promise.all([mgmLoad(D, 'mg_teachers', () => sbAll('/rest/v1/teachers?select=*&order=name.asc')), taskProfiles(D)]);
      const majorOk = k => sc.mine ? true : sc.domain ? MAJOR_DOMAIN[k] === sc.domain : (sc.key === 'all' ? true : scopeMajor(k));
      let total = 0, done = 0; const items = [];
      teachers.filter(t => isSenmonTeacher(t) && (!sc.mine || t.name === sc.mine)).forEach(t => {
        teacherProfileStatus(t, profs.filter(r => r.name === t.name)).filter(x => majorOk(x.key)).forEach(x => {
          total++; if (x.done) done++;
          else items.push({ name: `${t.name} · ${x.label}`, note: x.row ? '缺：' + x.missing.join('、') : '未填', owners: [t.name] });
        });
      });
      return _mgRate(done, total, items, '范围内专业课老师的负责专业数', '至今', '完成 = 该专业的讲师介绍必填项已填全；名单 = 未完成的专业及缺项');
    } },
  ] },
];

// 跑一个指标（带 60 秒缓存；读取失败只影响这一项）
function mgmRun(sc, m) {
  const k = sc.key + '|' + m.key, hit = MGM_CACHE[k];
  if (hit && Date.now() - hit.t < MGM_TTL) return hit.p;
  const p = Promise.resolve().then(() => m.fn(mgmData(), sc)).then(r => Object.assign({ kind: m.kind || 'rate' }, r)).catch(e => ({ err: (e && e.message) || String(e) }));
  MGM_CACHE[k] = { t: Date.now(), p };
  return p;
}
// 一个大项的全部指标：[{m, r}]
async function mgmRunGroup(sc, g) {
  const rs = await Promise.all(g.metrics.map(m => mgmRun(sc, m)));
  return g.metrics.map((m, i) => ({ m, r: rs[i] }));
}
// 单个指标的状态：'na' | 'err' | 'done' | 'todo'
function mgmState(r) {
  if (!r || r.err) return 'err';
  if (r.na) return 'na';
  if (r.kind === 'list') return r.count === 0 ? 'done' : 'todo';
  return r.done >= r.total ? 'done' : 'todo';   // 分母为 0 也算完成
}
// 显示用文字：「18/25」或「待处理 3 人」
function mgmText(r) {
  const s = mgmState(r);
  if (s === 'err') return '读取失败';
  if (s === 'na') return '未接入';
  return r.kind === 'list' ? `待处理 ${r.count} 人` : `${r.done}/${r.total}`;
}
// 大项汇总：{ state:'gray'|'done'|'todo', done, total }（只数可统计的指标；读取失败不计）
function mgmGroupSum(g, rows) {
  const cnt = rows.filter(x => ['done', 'todo'].includes(mgmState(x.r)));
  if (g.na || !cnt.length) return { state: 'gray', done: 0, total: 0 };
  const done = cnt.filter(x => mgmState(x.r) === 'done').length;
  return { state: done === cnt.length ? 'done' : 'todo', done, total: cnt.length };
}
