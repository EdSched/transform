// ══════════════════════════════════
// shared/task-checks.js — 任务管理的「自动检测」：14 个检测，只用现有数据；老师端「我的任务」和管理端团队进度共用
// 每个检测返回 { count, items:[{sid?,name,note}], visible?, na? }：
//   count = 还没处理的数量；visible=false = 这个月这条任务的触发条件还没到（如距开课 14 天）；na=true = 系统里暂无对应数据
// 大表（学生、志望校、出席…）在一个 D（taskDataNew()）里只查一次、各任务共用；
// 范围：学科类职能按这位老师负责的专业；全学科类职能按他的领域（负责人按管理范围）
// 依赖：shared/tasks.js、shared/constants.js、shared/riyu.js、shared/supabase.js
// ══════════════════════════════════
function taskDataNew() { return { p: {}, res: {} }; }
const _tkLoad = (D, key, fn) => D.p[key] || (D.p[key] = Promise.resolve().then(fn).catch(() => []));
const _tkAll = path => sbAll(path);
const _tkYm = () => jstToday().slice(0, 7);
const _tkDaysAgo = n => { const d = new Date(jstToday() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toLocaleDateString('sv-SE'); };
const _tkChunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

// ── 数据加载（每个只查一次）──
function taskStudents(D) { return _tkLoad(D, 'stu', async () => (await _tkAll('/rest/v1/students?select=*&order=name.asc')).filter(s => s.status === 'active' || !s.status)); }
function taskPlans(D) { return _tkLoad(D, 'plans', () => _tkAll('/rest/v1/student_school_plans?select=*')); }
function taskDrafts(D) {
  return _tkLoad(D, 'drafts', async () => {
    const rows = await _tkAll('/rest/v1/student_plan_drafts?select=id,student_id,draft_file_url,draft_fields,prior_research_list,research_question,methodology,draft_notes,updated_at&order=updated_at.desc');
    const m = {}; rows.forEach(r => { if (r.student_id && !m[r.student_id]) m[r.student_id] = r; }); return m;   // 每人取最新一条
  });
}
function taskRiyu(D) { return _tkLoad(D, 'riyu', () => _tkAll('/rest/v1/riyu_submissions?select=student_id,school_key,kind,status')); }
function taskBookingsMonth(D) {
  return _tkLoad(D, 'bk', async () => {
    const ym = _tkYm();
    return _tkAll(`/rest/v1/bookings?select=student_id,name,slot_date,daily_record&daily_record=not.is.null&slot_date=gte.${ym}-01&slot_date=lte.${ym}-31`);
  });
}
function taskRecords(D) { return _tkLoad(D, 'rec', () => _tkAll(`/rest/v1/session_records?select=student_id,student_name,session_id,session_date,attendance_status,created_at&session_date=gte.${_tkDaysAgo(60)}&order=session_date.desc`)); }
function taskCourses(D) { return _tkLoad(D, 'courses', () => _tkAll('/rest/v1/courses?select=id,name,teacher,period,period_override,first_session_date,domain,major,class_ids')); }
function taskSessions(D) { return _tkLoad(D, 'sess', () => _tkAll(`/rest/v1/course_sessions?select=id,course_id,course_name,session_date,session_teacher,teacher,confirmed,is_cancelled&session_date=gte.${_tkDaysAgo(90)}`)); }
function taskProfiles(D) { return _tkLoad(D, 'prof', () => _tkAll('/rest/v1/teacher_profiles?select=id,name,subject,school,keywords,feature,courses')); }
function taskHwSessions(D) {
  return _tkLoad(D, 'hws', () => _tkAll(`/rest/v1/course_sessions?homework_enabled=is.true&homework_questions=not.is.null&session_date=gte.${_tkDaysAgo(120)}&select=id,course_id,course_name,session_date,session_teacher,teacher,homework_questions`));
}
function taskHwSubs(D, sessionIds) {
  const key = 'hwsub|' + sessionIds.join(',');
  return _tkLoad(D, key, async () => {
    const parts = await Promise.all(_tkChunk(sessionIds, 40).map(ids => _tkAll(`/rest/v1/homework_submissions?session_id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,session_id,student_id,student_name,feedbacks,teacher_feedback,feedback_knowledge,feedback_attitude,feedback_suggestions`).catch(() => [])));
    return parts.flat();
  });
}

// ── 范围 ──
const _tkHasMs = t => typeof managerScopeNonEmpty === 'function' && managerScopeNonEmpty(t.manage_scope);
function taskTeacherDomains(t) {
  const s = new Set([...(t.domains || []), ...(t.managed_by || [])]);
  if (_tkHasMs(t)) (t.manage_scope.domains || []).forEach(d => s.add(d));
  (t.majors || []).forEach(m => { if (MAJOR_DOMAIN[m]) s.add(MAJOR_DOMAIN[m]); });
  return s;
}
// 学科类：这位老师负责的专业（和老师端 tsaAllowedSet 同一套）；null = 不限（营业 / 对接 / 没填专业）
function taskAllowedMajors(t) {
  if (typeof canSeeAllStudents === 'function' ? canSeeAllStudents(t) : (t.tags || []).includes('营业老师')) return null;
  const p = t.permissions || {};
  const arr = (p.student_majors && p.student_majors.length) ? p.student_majors : (t.majors || []);
  if (!arr.length) return null;
  const set = new Set(arr);
  if (set.has('shakai_group') && typeof SHAKAI_GROUP !== 'undefined') SHAKAI_GROUP.forEach(m => set.add(m));
  return set;
}
// 这条任务统计的学生是不是在这位老师的范围里
function taskStudentOk(t, tpl, s) {
  const wide = tpl.role === 'lead';
  if (wide) {
    if (_tkHasMs(t)) {
      const ms = t.manage_scope;
      return (ms.domains || []).includes(MAJOR_DOMAIN[s.major]) || (ms.majors || []).includes(s.major)
        || (ms.class_ids || []).some(id => (s.class_ids || []).map(String).includes(String(id)));
    }
    const doms = taskTeacherDomains(t);
    return !doms.size || doms.has(MAJOR_DOMAIN[s.major]);
  }
  const set = taskAllowedMajors(t);
  if (set && !set.has(s.major)) return false;
  if ((t.permissions || {}).guaranteed_only && !String(s.course_type || '').includes('保录')) return false;
  return true;
}
function taskCourseOk(t, c) {
  const doms = taskTeacherDomains(t);
  if (!doms.size) return true;
  const majors = Array.isArray(c.major) ? c.major : (c.major ? [c.major] : []);
  const dom = c.domain || (majors.map(m => MAJOR_DOMAIN[m]).find(Boolean)) || '';
  return doms.has(dom);
}
async function taskScopedStudents(D, t, tpl) { return (await taskStudents(D)).filter(s => taskStudentOk(t, tpl, s)); }

// ── 判断小工具 ──
function taskHasPlan(s, plans, draft, subs) {
  if (typeof isGakubuStudent === 'function' && isGakubuStudent(s)) return riyuCounts(plans, subs, 'gakubu_riyu').submitted > 0;   // 学部：志望理由书已提交
  if (!draft) return false;
  if (draft.draft_file_url) return true;
  try { const f = draft.draft_fields ? JSON.parse(draft.draft_fields) : {}; if (Object.entries(f).some(([k, v]) => k !== 'riyu' && (Array.isArray(v) ? v.length : String(v || '').trim()))) return true; } catch (e) {}
  return ['research_question', 'methodology', 'draft_notes'].some(f => String(draft[f] || '').trim());
}
const _tkHasRec = b => b.daily_record && Object.values(b.daily_record).some(v => v && (typeof v === 'string' ? v : Object.values(v).some(x => x)));
const _tkIsAbs = r => !r.attendance_status || r.attendance_status === 'absent';
// 到期日（文本）→ 距今月数；解析不了返回 null（格式：27年3月 / 2027年3月 / 2027-03 / 2027/3 / 2027；只有年份按 4 月）
function taskExpiryMonths(str) {
  str = String(str || '').trim(); if (!str) return null;
  let y, m;
  const a = str.match(/(\d{4}|\d{2})\s*[年\/\-\.]\s*(\d{1,2})/);
  if (a) { y = +a[1]; m = +a[2]; if (y < 100) y += 2000; }
  else { const b = str.match(/^(\d{4})$/); if (!b) return null; y = +b[1]; m = 4; }
  const now = new Date(jstToday() + 'T00:00:00');
  return (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
}
const TASK_PERIOD_ORDER = ['1月期', '4月期', '7月期', '10月期'];
function taskNextTerm() {
  const today = new Date(jstToday() + 'T00:00:00'), y = today.getFullYear();
  const i = TASK_PERIOD_ORDER.indexOf(currentPeriodKey()), ny = i === 3 ? y + 1 : y;
  const start = new Date(ny, [4, 7, 10, 1][i] - 1, 1);
  return { key: `${ny}年${TASK_PERIOD_ORDER[(i + 1) % 4]}`, start, days: Math.round((start - today) / 86400000), year: y };
}
const _tkStuItem = (s, note) => ({ sid: s.id, name: s.name, note: note || '' });

// ── 14 个检测 ──
const TASK_CHECK_FN = {
  async plan_missing(D, t, tpl) {
    const [stu, plans, drafts, riyu] = await Promise.all([taskScopedStudents(D, t, tpl), taskPlans(D), taskDrafts(D), taskRiyu(D)]);
    const pBy = {}, rBy = {}; plans.forEach(p => (pBy[p.student_id] = pBy[p.student_id] || []).push(p)); riyu.forEach(r => (rBy[r.student_id] = rBy[r.student_id] || []).push(r));
    const items = stu.filter(s => !taskHasPlan(s, pBy[s.id] || [], drafts[s.id], rBy[s.id] || []))
      .map(s => _tkStuItem(s, (typeof isGakubuStudent === 'function' && isGakubuStudent(s)) ? '志望理由书' : '研究计划书'));
    return { count: items.length, items };
  },
  async school_list_missing(D, t, tpl) {
    const [stu, plans] = await Promise.all([taskScopedStudents(D, t, tpl), taskPlans(D)]);
    const has = new Set(plans.map(p => p.student_id));
    const items = stu.filter(s => !has.has(s.id)).map(s => _tkStuItem(s));
    return { count: items.length, items };
  },
  async result_missing(D, t, tpl) {
    const [stu, plans] = await Promise.all([taskScopedStudents(D, t, tpl), taskPlans(D)]);
    const by = {}; stu.forEach(s => by[s.id] = s);
    const items = plans.filter(p => p.status === 'applied' && by[p.student_id]).map(p => _tkStuItem(by[p.student_id], [p.school_name, p.department || p.faculty].filter(Boolean).join(' ') + '（已出愿，未登记结果）'));
    return { count: items.length, items };
  },
  async meeting_due(D, t, tpl) {
    const [stu, bk] = await Promise.all([taskScopedStudents(D, t, tpl), taskBookingsMonth(D)]);
    const ids = new Set(), names = new Set();
    bk.filter(_tkHasRec).forEach(b => { if (b.student_id) ids.add(b.student_id); if (b.name) names.add(b.name); });
    const items = stu.filter(s => !ids.has(s.id) && !names.has(s.name)).map(s => _tkStuItem(s));
    return { count: items.length, items };
  },
  async absent_twice(D, t, tpl) {
    const [stu, recs] = await Promise.all([taskScopedStudents(D, t, tpl), taskRecords(D)]);
    const byId = {}, byName = {}; stu.forEach(s => { byId[s.id] = s; byName[s.name] = s; });
    const g = {};
    recs.forEach(r => {
      const s = (r.student_id && byId[r.student_id]) || byName[r.student_name]; if (!s) return;
      const m = g[s.id] = g[s.id] || { s, by: {} };
      const old = m.by[r.session_id || r.session_date];
      if (!old || String(r.created_at || '') < String(old.created_at || '')) m.by[r.session_id || r.session_date] = r;   // 同一课次重复记录取最早一条
    });
    const items = [];
    Object.values(g).forEach(m => {
      const last2 = Object.values(m.by).sort((a, b) => String(b.session_date).localeCompare(String(a.session_date))).slice(0, 2);
      if (last2.length === 2 && last2.every(_tkIsAbs)) items.push(_tkStuItem(m.s, `连续缺席：${last2.map(r => r.session_date.slice(5)).reverse().join('、')}`));
    });
    return { count: items.length, items };
  },
  async expiry_6m(D, t, tpl) {
    const stu = await taskScopedStudents(D, t, tpl);
    const items = [];
    stu.forEach(s => { const m = taskExpiryMonths(s.expiry_date); if (m != null && m >= 0 && m <= 6) items.push(_tkStuItem(s, `到期：${s.expiry_date}（${m === 0 ? '本月' : m + ' 个月后'}）`)); });
    return { count: items.length, items };
  },
  async attendance_unrecorded(D, t) {
    const [sess, recs] = await Promise.all([taskSessions(D), taskRecords(D)]);
    const today = jstToday(), from = _tkDaysAgo(60), done = new Set(recs.map(r => r.session_id));
    const nm = t.name || '';
    const items = sess.filter(x => x.confirmed && !x.is_cancelled && x.session_date < today && x.session_date >= from && !done.has(x.id)
      && (String(x.session_teacher || '').includes(nm) || String(x.teacher || '').includes(nm)))
      .map(x => ({ name: x.course_name || '', note: `${x.session_date} 还没记出席` }));
    return { count: items.length, items };
  },
  async homework_unreviewed(D, t) {
    const p = t.permissions || {};
    const own = !!p.homework_own_sessions, ids = (p.homework_course_ids || []).map(String);
    if (!p.homework || (!own && !ids.length)) return { count: 0, items: [] };
    const nm = t.name || '';
    const sess = (await taskHwSessions(D)).filter(x => (typeof inCurrentPeriod !== 'function' || inCurrentPeriod(x.session_date))
      && ((own && (String(x.session_teacher || '').includes(nm) || String(x.teacher || '').includes(nm))) || ids.includes(String(x.course_id))));
    if (!sess.length) return { count: 0, items: [] };
    const subs = await taskHwSubs(D, sess.map(x => x.id));
    const sBy = {}; sess.forEach(x => sBy[x.id] = x);
    const items = subs.filter(x => !hwFeedbacks(x).length).map(x => ({ sid: x.student_id || '', name: x.student_name || '', note: `${(sBy[x.session_id] || {}).course_name || ''} ${(sBy[x.session_id] || {}).session_date || ''}` }));
    return { count: items.length, items };
  },
  async profile_incomplete(D, t) {
    if (typeof isSenmonTeacher !== 'function' || !isSenmonTeacher(t)) return { count: 0, items: [] };
    const rows = (await taskProfiles(D)).filter(r => r.name === t.name);
    const st = teacherProfileStatus(t, rows);
    if (!st.length) return teacherProfileAllSkipped(t) ? { count: 0, items: [] } : { count: 1, items: [{ name: '还没有设置负责专业', note: '' }] };
    const items = st.filter(x => !x.done).map(x => ({ key: x.key, name: x.label, note: x.row ? '缺：' + x.missing.join('、') : '未填' }));
    return { count: items.length, items };
  },
  async payroll_pending() { return { count: 0, items: [], na: true }; },   // 系统里暂时没有工资审批
  async next_term_unconfirmed(D, t) {
    const [courses, sess] = await Promise.all([taskCourses(D), taskSessions(D)]);
    const nt = taskNextTerm(), mine = courses.filter(c => taskCourseOk(t, c) && periodKeyOf(c) === nt.key);
    const sBy = {}; sess.forEach(x => (sBy[x.course_id] = sBy[x.course_id] || []).push(x));
    const items = [];
    mine.forEach(c => { const ss = sBy[c.id] || []; if (!ss.length) items.push({ name: c.name, note: '还没有录入单回' }); else if (!ss.every(x => x.confirmed)) items.push({ name: c.name, note: `单回未全部确认发布（${ss.filter(x => x.confirmed).length}/${ss.length}）` }); });
    taskTeacherDomains(t).forEach(d => { if (!courses.some(c => periodKeyOf(c) === nt.key && taskCourseOk({ domains: [d] }, c))) items.push({ name: d, note: `${nt.key}还没有录入任何课程` }); });
    return { count: items.length, items };
  },
  async next_year_courses(D, t) {
    const courses = await taskCourses(D), y = taskNextTerm().year + 1, items = [];
    TASK_PERIOD_ORDER.forEach(p => { const n = courses.filter(c => taskCourseOk(t, c) && periodKeyOf(c) === `${y}年${p}`).length; if (!n) items.push({ name: `${y}年${p}`, note: '还没有录入课程' }); });
    return { count: items.length, items };
  },
  async term_start_minus_14() { const nt = taskNextTerm(); return nt.days >= 0 && nt.days <= 14 ? { count: 1, items: [{ name: `下一期（${nt.key}）`, note: `${nt.days} 天后开课` }] } : { count: 0, items: [], visible: false }; },
  async term_start_minus_7() { const nt = taskNextTerm(); return nt.days >= 0 && nt.days <= 7 ? { count: 1, items: [{ name: `下一期（${nt.key}）`, note: `${nt.days} 天后开课` }] } : { count: 0, items: [], visible: false }; },
};
// 跑一个检测（同一个 D 里，同一位老师 + 同一个检测 + 同一范围类型只算一次）
function taskRunCheck(D, t, tpl) {
  const fn = TASK_CHECK_FN[tpl.check_key];
  if (!fn) return Promise.resolve({ count: 0, items: [], na: true });
  const key = `${t.id}|${tpl.check_key}|${tpl.role === 'lead' ? 'w' : 'n'}`;
  return D.res[key] || (D.res[key] = fn(D, t, tpl).catch(e => ({ count: 0, items: [], err: e.message || String(e) })));
}
// 这位老师这个月的任务清单：[{tpl, via, state:'done'|'pending', count, items, rec, na, err}]（触发条件没到的自动任务不出现）
async function taskBuildList(D, t, templates, month, doneRows) {
  const app = taskApplicable(t, templates, month);
  const recBy = {}; (doneRows || []).filter(r => r.teacher_id === t.id).forEach(r => recBy[r.template_id] = r);
  const out = await Promise.all(app.map(async a => {
    const tpl = a.tpl, rec = recBy[tpl.id] || null;
    if (tpl.kind === 'auto' && tpl.check_key) {
      const r = await taskRunCheck(D, t, tpl);
      if (r.visible === false) return null;
      return { tpl, via: a.via, rec, count: r.count, items: r.items, na: r.na, err: r.err, state: (rec || r.count === 0) ? 'done' : 'pending' };
    }
    return { tpl, via: a.via, rec, count: null, items: [], state: rec ? 'done' : 'pending' };
  }));
  return out.filter(Boolean);
}
// 任务名单里的一行：有学生 id 的可以点开学生详情（老师端 / 管理端各自的函数）
function taskOpenStudent(id, name) {
  if (typeof openStudentDetail === 'function') openStudentDetail(id);
  else if (typeof showStudentInfoTeacher === 'function') showStudentInfoTeacher(name, id);
}
function taskItemsHtml(items) {
  const e = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  if (!items.length) return '<div style="font-size:11px;color:var(--text-3);padding:4px 0">没有需要处理的</div>';
  return items.map(i => `<div ${i.sid ? `onclick="event.stopPropagation();taskOpenStudent('${e(i.sid).replace(/'/g, "\\'")}','${e(i.name).replace(/'/g, "\\'")}')"` : ''} style="display:flex;gap:8px;padding:4px 6px;border-bottom:1px solid var(--border-light);font-size:11px;${i.sid ? 'cursor:pointer' : ''}">
    <span style="font-weight:600;${i.sid ? 'color:var(--accent)' : ''}">${e(i.name)}</span><span style="color:var(--text-3)">${e(i.note)}</span></div>`).join('');
}
