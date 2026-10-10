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
// 返回 { key, label, mine, stu(s), stuBase(s) 只按范围（不含「我名下」）, major(m) 专业在范围内, course(c), sess(x, courseMap) }
function mgmScope(opt) {
  opt = opt || { kind: 'all' };
  const mine = (opt.kind === 'view' && opt.mine) || '';
  const majorsOf = s => [s.major, ...(Array.isArray(s.extra_majors) ? s.extra_majors : [])].filter(Boolean);
  const courseMajors = c => Array.isArray(c.major) ? c.major : (c.major ? [c.major] : []);
  const hasName = (v, nm) => String(v || '').includes(nm);
  let stu, course, label, key, stuBase, major;
  if (opt.kind === 'domain') {
    const dom = opt.domain;
    stu = s => majorsOf(s).some(m => MAJOR_DOMAIN[m] === dom); stuBase = stu; major = m => MAJOR_DOMAIN[m] === dom;
    course = c => c.domain === dom || courseMajors(c).some(m => MAJOR_DOMAIN[m] === dom);
    label = dom; key = 'd:' + dom;
  } else if (opt.kind === 'view') {
    const ownS = s => !mine || (s.owner_teachers || []).includes(mine) || (s.vip_teachers || []).includes(mine);
    stu = s => scopeStudent(s) && ownS(s); stuBase = scopeStudent; major = scopeMajor;
    course = c => scopeCourse(c) && (!mine || hasName(c.teacher, mine));
    label = scopeSummary() + (mine ? `（${mine} 名下）` : '');
    key = 'v:' + JSON.stringify(VIEW_SCOPE) + '|' + mine;
  } else {
    stu = () => true; course = () => true; label = '全部领域'; key = 'all'; stuBase = () => true; major = () => true;
  }
  const sess = (x, courseMap) => {
    if (opt.kind !== 'domain' && opt.kind !== 'view') return true;
    const c = courseMap && courseMap[x.course_id]; if (!c) return false;
    if (!(opt.kind === 'domain' ? course(c) : scopeCourse(c))) return false;
    return !mine || hasName(x.session_teacher, mine) || hasName(x.teacher, mine);   // 课次按 session_teacher / teacher 含姓名
  };
  return { key, label, mine, domain: opt.domain || '', stu, stuBase, major, course, sess };
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

// ── VIP课程 / 宣传管理 用到的数据（读取失败要往外抛，只让依赖它的指标显示「读取失败」）──
const mgVipBookings = D => mgmLoad(D, 'mg_vbk', () => sbAll('/rest/v1/bookings?type=eq.vip&select=id,student_id,name,type,status,slot_date,assigned_teacher,self_booked,teacher_ok,admin_review,vip_session_notes,student_confirmed,change_request'));
const mgVipPlans = D => mgmLoad(D, 'mg_vpl', () => sbAll('/rest/v1/vip_student_plans?select=id,student_id,student_name,status'));
// 教务补录统计用：本月预约（含 manual_entry）；列还没建时读取失败，只让这两项显示「读取失败」
const mgMonthBookings = D => mgmLoad(D, 'mg_mbk', () => { const ym = _tkYm(); return sbAll(`/rest/v1/bookings?slot_date=gte.${ym}-01&slot_date=lte.${ym}-31&status=in.(pending,confirmed,completed)&select=id,student_id,name,type,status,slot_date,assigned_teacher,manual_entry,manual_reason`); });
async function _mgManualMonth(D, sc, vip) {
  const [all, bks] = await Promise.all([taskStudents(D), mgMonthBookings(D)]);
  const ok = vip ? (s => _mgIsVip(s) && sc.stuBase(s)) : sc.stu, byId = {}, byName = {};
  all.filter(ok).forEach(s => { byId[s.id] = s; byName[s.name] = s; });
  const list = [];
  bks.forEach(b => {
    if ((b.type === 'vip') !== vip) return;
    const s = (b.student_id && byId[b.student_id]) || byName[b.name]; if (!s) return;
    if (sc.mine && b.assigned_teacher !== sc.mine) return;
    list.push({ b, s });
  });
  return list;
}
function _mgManualRate(list, what) {
  const items = list.filter(x => x.b.manual_entry).map(({ b, s }) => _mgBkItem(b, s, `教务补录：${String(b.manual_reason || '—').slice(0, 30)}`));
  return _mgRate(list.length - items.length, list.length, items, `本月${what}预约数（待确认 / 已确认 / 已完成，不含已取消）`, `当月（${_tkYm()}）`, `教务补录 ${items.length} 次。完成 = 学生 / 老师自己预约的；名单 = 教务补录的预约，按老师分组，补录多的老师值得关注`);
}
const mgPromoContent = D => mgmLoad(D, 'mg_pc', () => sbAll('/rest/v1/promo_content?select=id,major,section'));
const mgCases = D => mgmLoad(D, 'mg_cs', () => sbAll('/rest/v1/success_cases?select=id,student_id,majors,published'));
const mgResults = D => mgmLoad(D, 'mg_ar', () => sbAll('/rest/v1/admission_results?select=id,student,univ'));
// VIP 学生 = 在籍且 is_vip_course 为 VIP / 大课+VIP；范围只按领域 / 视角，「我名下」= vip_teachers 含该老师
const _mgIsVip = s => s.is_vip_course === 'VIP' || s.is_vip_course === '大课+VIP';
const _mgVipStu = (all, sc) => all.filter(s => _mgIsVip(s) && sc.stuBase(s) && (!sc.mine || (s.vip_teachers || []).includes(sc.mine)));
const _mgVipOwners = s => (s.vip_teachers || []).filter(Boolean);
const _mgVipReq = b => { let r = b && b.change_request; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = null; } } return r && typeof r === 'object' ? r : null; };
// 本月 VIP 预约（只算 VIP 学生的；按 student_id，没有就按姓名对上）。me = 「我名下」时也认 assigned_teacher
async function _mgVipMonth(D, sc, withCancelled) {
  const [all, bks] = await Promise.all([taskStudents(D), mgVipBookings(D)]);
  const vs = all.filter(_mgIsVip).filter(s => sc.stuBase(s)), byId = {}, byName = {}; vs.forEach(s => { byId[s.id] = s; byName[s.name] = s; });
  const ym = _tkYm(), list = [];
  bks.forEach(b => {
    if (!String(b.slot_date || '').startsWith(ym)) return;
    if (!withCancelled && !['pending', 'confirmed', 'completed'].includes(b.status)) return;
    const s = (b.student_id && byId[b.student_id]) || byName[b.name]; if (!s) return;
    if (sc.mine && b.assigned_teacher !== sc.mine && !(s.vip_teachers || []).includes(sc.mine)) return;
    list.push({ b, s });
  });
  return list;
}
const _mgBkItem = (b, s, note) => ({ sid: s.id, name: b.name || s.name, note: `${b.slot_date || ''} ${note}`.trim(), owners: b.assigned_teacher ? [b.assigned_teacher] : [] });
// 宣传内容按专业存放：范围 = 专业；宣传不分老师，「我名下」一律不能统计
const _mgPromoNa = { na: true, note: '宣传内容不按老师统计，请在全部管理范围里看' };
const _mgPromoMajors = sc => (typeof allMajorKeys === 'function' ? allMajorKeys() : Object.keys(MAJOR_DOMAIN)).filter(m => !isMajorGroup(m) && MAJOR_DOMAIN[m] && sc.major(m));
const _mgNorm = v => String(v == null ? '' : v).normalize('NFKC').replace(/\s+/g, '');

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
    { key: 'interview_manual', label: '面谈教务补录', async fn(D, sc) { return _mgManualRate(await _mgManualMonth(D, sc, false), '面谈'); } },
  ] },
  { key: 'vip', label: 'VIP课程', metrics: [
    { key: 'vip_teacher', label: 'VIP学生已指定VIP老师', async fn(D, sc) {
      const vs = _mgVipStu(await taskStudents(D), sc), items = vs.filter(s => !(s.vip_teachers || []).length).map(s => ({ sid: s.id, name: s.name, note: '还没有指定 VIP 老师', owners: [] }));
      return _mgRate(vs.length - items.length, vs.length, items, '范围内 VIP 学生数', '在籍期间', '完成 = 已指定 VIP 老师的学生；名单 = 没有 VIP 老师的学生');
    } },
    { key: 'vip_plan', label: 'VIP规划已建立', async fn(D, sc) {
      const [all, plans] = await Promise.all([taskStudents(D), mgVipPlans(D)]);
      const vs = _mgVipStu(all, sc), ids = new Set(plans.map(p => p.student_id).filter(Boolean)), names = new Set(plans.filter(p => !p.student_id).map(p => p.student_name).filter(Boolean));
      const items = vs.filter(s => !ids.has(s.id) && !names.has(s.name)).map(s => ({ sid: s.id, name: s.name, note: '还没有 VIP 规划', owners: _mgVipOwners(s) }));
      return _mgRate(vs.length - items.length, vs.length, items, '范围内 VIP 学生数', '在籍期间', '完成 = 在 VIP 规划里有记录的学生；名单 = 没有 VIP 规划的学生');
    } },
    { key: 'vip_booking', label: 'VIP预约确认', async fn(D, sc) {
      const list = await _mgVipMonth(D, sc, false), items = [];
      list.forEach(({ b, s }) => {   // 待办判断与老师端首页一致，满足多种只算最先匹配的一种
        let why = '';
        if (!b.self_booked && b.status === 'pending') why = '待确认';
        else if (b.self_booked && b.status === 'pending' && b.admin_review === 'pending') why = '待教务审核';
        else if (b.self_booked && !b.teacher_ok && ['pending', 'confirmed'].includes(b.status)) why = '待老师确认';
        if (why) items.push(_mgBkItem(b, s, why));
      });
      return _mgRate(list.length - items.length, list.length, items, '本月 VIP 预约数（待确认 / 已确认 / 已完成，不含已取消）', `当月（${_tkYm()}）`, '完成 = 没有待确认事项的预约；名单说明里写明是「待确认 / 待教务审核 / 待老师确认」哪一种');
    } },
    { key: 'vip_change', label: 'VIP调整申请处理', async fn(D, sc) {
      const list = (await _mgVipMonth(D, sc, true)).filter(x => _mgVipReq(x.b)), items = [];
      list.forEach(({ b, s }) => { const r = _mgVipReq(b); if (r.status === 'pending') items.push(_mgBkItem(b, s, `申请${r.type === 'cancel' ? '取消' : '改期'}：${String(r.reason || '—').slice(0, 30)}`)); });
      return _mgRate(list.length - items.length, list.length, items, '本月预约里带有调整申请的预约数', `当月（${_tkYm()}）`, '完成 = 申请已不是「待处理」状态的预约；名单 = 申请还在待处理的预约');
    } },
    { key: 'vip_notes', label: 'VIP课后记录', async fn(D, sc) {
      const today = jstToday(), list = (await _mgVipMonth(D, sc, false)).filter(x => ['confirmed', 'completed'].includes(x.b.status) && x.b.slot_date < today);
      const items = list.filter(x => !String(x.b.vip_session_notes || '').trim()).map(({ b, s }) => _mgBkItem(b, s, '已上完，没填课后记录'));
      return _mgRate(list.length - items.length, list.length, items, '本月已上完（日期在今天之前）的已确认 / 已完成 VIP 课数', `当月（${_tkYm()}）`, '完成 = 已填课后记录的课；名单 = 已上完但没填课后记录的课');
    } },
    { key: 'vip_confirm', label: 'VIP学生确认', async fn(D, sc) {
      const today = jstToday(), list = (await _mgVipMonth(D, sc, false)).filter(x => ['confirmed', 'completed'].includes(x.b.status) && x.b.slot_date < today && String(x.b.vip_session_notes || '').trim());
      const items = list.filter(x => !x.b.student_confirmed).map(({ b, s }) => _mgBkItem(b, s, '已填记录，学生还没确认（请联系学生）'));
      return _mgRate(list.length - items.length, list.length, items, '本月已填课后记录的 VIP 课数', `当月（${_tkYm()}）`, '完成 = 学生已确认的课；名单 = 已填记录、学生还没确认的课');
    } },
    { key: 'vip_manual', label: 'VIP教务补录', async fn(D, sc) { return _mgManualRate(await _mgManualMonth(D, sc, true), 'VIP'); } },
    { key: 'vip_hours', label: 'VIP课时用尽', async fn(D, sc) {
      const vs = _mgVipStu(await taskStudents(D), sc).filter(s => (s.vip_hours_total || 0) > 0);
      const items = vs.filter(s => (s.vip_hours_total || 0) - (s.vip_hours_used || 0) <= 0).map(s => ({ sid: s.id, name: s.name, note: `课时已用尽：已用 ${s.vip_hours_used || 0}/${s.vip_hours_total}`, owners: _mgVipOwners(s) }));
      return _mgRate(vs.length - items.length, vs.length, items, '范围内设了课时的 VIP 学生数', '至今', '完成 = 剩余课时（总数 − 已用）仍大于 0 的学生；名单 = 课时已用尽的学生');
    } },
  ] },
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
  { key: 'promo', label: '宣传管理', metrics: [
    { key: 'promo_major_intro', label: '专业介绍已填写', async fn(D, sc) {
      if (sc.mine) return _mgPromoNa;
      const rows = await mgPromoContent(D), ms = _mgPromoMajors(sc), has = new Set(rows.filter(r => r.section === 'major_intro').map(r => r.major));
      const items = ms.filter(m => !has.has(m)).map(m => ({ name: majorLabel(m), note: '还没有专业介绍', owners: [] }));
      return _mgRate(ms.length - items.length, ms.length, items, '范围内专业数', '至今', '完成 = 宣传内容里有「专业介绍」的专业；名单 = 还没有专业介绍的专业');
    } },
    { key: 'promo_course', label: '课程宣传已填写', async fn(D, sc) {
      if (sc.mine) return _mgPromoNa;
      const rows = await mgPromoContent(D), ms = _mgPromoMajors(sc), has = new Set(rows.filter(r => r.section === 'course').map(r => r.major));
      const items = ms.filter(m => !has.has(m)).map(m => ({ name: majorLabel(m), note: '还没有课程宣传', owners: [] }));
      return _mgRate(ms.length - items.length, ms.length, items, '范围内专业数', '至今', '完成 = 宣传内容里有「课程」的专业；名单 = 还没有课程宣传的专业');
    } },
    { key: 'promo_case', label: '合格案例已建立', async fn(D, sc) {
      if (sc.mine) return _mgPromoNa;
      const [all, plans, cases] = await Promise.all([taskStudents(D), taskPlans(D), mgCases(D)]);
      const passed = {}; plans.filter(p => p.status === 'passed').forEach(p => { (passed[p.student_id] = passed[p.student_id] || []).push(p); });
      const stu = all.filter(s => sc.stuBase(s) && passed[s.id]), has = new Set(cases.map(c => c.student_id).filter(Boolean));
      const items = stu.filter(s => !has.has(s.id)).map(s => ({ sid: s.id, name: s.name, note: '已合格，没建合格案例：' + passed[s.id].map(p => p.school_name).filter(Boolean).join('、'), owners: [] }));
      return _mgRate(stu.length - items.length, stu.length, items, '范围内已合格学生数（至少一所志望校状态为合格）', '至今', '完成 = 在合格案例里有记录的学生；只统计已合格学生，在籍未合格的不算');
    } },
    { key: 'promo_result', label: '合格实绩已录入', async fn(D, sc) {
      if (sc.mine) return _mgPromoNa;
      const [all, plans, res] = await Promise.all([taskStudents(D), taskPlans(D), mgResults(D)]);
      const by = {}; all.filter(sc.stuBase).forEach(s => by[s.id] = s);
      const passed = plans.filter(p => p.status === 'passed' && by[p.student_id]), has = new Set(res.map(r => _mgNorm(r.student) + '|' + _mgNorm(r.univ)));
      const items = passed.filter(p => !has.has(_mgNorm(by[p.student_id].name) + '|' + _mgNorm(p.school_name))).map(p => _mgStuItem(Object.assign({}, by[p.student_id], { owner_teachers: [] }), '已合格，没录入合格实绩：' + _mgSchoolFmt(p)));
      return _mgRate(passed.length - items.length, passed.length, items, '范围内已合格的志望校数', '至今', '完成 = 合格实绩库里能对上的（学生姓名 + 学校名都相同）；名单 = 已合格但没录入合格实绩的「学生 + 学校」');
    } },
  ] },
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
