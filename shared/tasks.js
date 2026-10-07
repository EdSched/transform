// ══════════════════════════════════
// shared/tasks.js — 任务管理共用：职能、检测代号、任务怎么分配给老师
// 任务来源两种：assign_by='feature'（老师管理里开了对应功能就出现，不看角色）/ 'role'（按老师的管理职位 / 执行角色）
// 依赖：shared/constants.js（DOMAINS、MAJOR_DOMAIN）
// ══════════════════════════════════
// 角色 = 老师的管理职位（teachers.position：lead / sales / liaison / soumu）或执行角色（teachers.roles：senmon / ta / homeroom）
const TASK_ROLES = [
  { key: 'lead',     label: '负责人' },
  { key: 'senmon',   label: '专业课老师' },
  { key: 'ta',       label: 'TA' },
  { key: 'homeroom', label: '班主任' },
  { key: 'sales',    label: '营业' },
  { key: 'liaison',  label: '对接' },
  { key: 'soumu',    label: '总务' },
];
const TASK_ROLE_LABEL = Object.fromEntries(TASK_ROLES.map(r => [r.key, r.label]));
// 自动检测：[代号, 说明]（具体算法在 PR ② 的检测模块里实现）
const TASK_CHECKS = [
  ['plan_missing', '还没有研究计划书 / 志望理由书的在籍学生'],
  ['school_list_missing', '还没有任何志望校的在籍学生'],
  ['result_missing', '已出愿但还没登记合格 / 不合格的志望校'],
  ['meeting_due', '本月还没有面谈记录的在籍学生'],
  ['absent_twice', '最近连续两回缺席的学生'],
  ['expiry_6m', '到期日在半年以内的在籍学生'],
  ['attendance_unrecorded', '本人课程中已上完、还没记出席的课次'],
  ['homework_unreviewed', '分配给本人、还没批改的作业'],
  ['profile_incomplete', '讲师介绍还没完成的负责专业'],
  ['payroll_pending', '本月待审批的工资申告'],
  ['next_term_unconfirmed', '下一期课程中还没录入 / 单回未确认发布的课程'],
  ['next_year_courses', '次年各期课程录入情况'],
  ['term_start_minus_14', '距下一期开课 14 天以内'],
  ['term_start_minus_7', '距下一期开课 7 天以内'],
];
const TASK_CHECK_LABEL = Object.fromEntries(TASK_CHECKS.map(c => [c[0], c[1]]));
// 学年顺序（4 月起）：年度节点表按这个排
const TASK_MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const taskPeriod = (d) => { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

// 模板的 requires（权限代号）→ 在老师管理编辑页里的位置 [区块, 项]；没有对应界面的返回 null
//   homework → 作业批改分配；records_entry / student_mgmt:xxx → 老师端功能·学生管理子项；tag:xxx → 基本信息
function taskRequiresSpot(req) {
  if (!req) return null;
  if (req === 'homework') return ['homework', 'homework'];
  if (req === 'records_entry') return ['features', 'records_entry'];
  if (req.startsWith('student_mgmt:')) return ['features', req.slice(13)];
  if (req.startsWith('tag:')) return ['basic', null];
  const direct = ['booking', 'slots', 'admission_query', 'student_mgmt', 'promo', 'progress_plan', 'lect_info', 'vip_sales', 'promo_pack', 'promo_pricing', 'success_cases'];
  if (direct.includes(req)) return [['promo', 'progress_plan', 'lect_info', 'vip_sales', 'promo_pack', 'promo_pricing', 'success_cases'].includes(req) ? 'sales' : 'features', req];
  return null;
}
// 老师有没有这个角色：看 position / roles；老师数据里没有这两个字段（准备 SQL 还没执行）时退回看标签
function taskTeacherHasRole(t, key, tag) {
  if (!t || !key && !tag) return false;
  if (key && ('position' in t || 'roles' in t)) return t.position === key || (t.roles || []).includes(key);
  return ((t.tags || []).includes(tag || TASK_ROLE_LABEL[key] || ''));
}
// 老师有没有开 requires 对应的功能（对不上的代号一律当作没开）
function taskTeacherHas(t, req) {
  if (!req) return true;
  const p = (t && t.permissions) || {};
  if (req.startsWith('tag:')) return ((t && t.tags) || []).includes(req.slice(4));
  if (req === 'records_entry') return !!p.student_mgmt && (p.student_mgmt_items || []).some(k => k === 'records' || k === 'records_entry');
  if (req.startsWith('student_mgmt:')) {
    const k = req.slice(13);
    return !!p.student_mgmt && (p.student_mgmt_items || []).some(x => x === k || (x === 'records' && /^records_(view|entry)$/.test(k)));
  }
  if (req === 'payroll_approve') return false;   // 系统里暂时没有「工资审批」权限
  return !!p[req];
}
// 模板的领域和老师对得上吗：模板没写领域 = 全部；老师没填任何领域 / 专业信息 = 不限制
function taskDomainOk(t, tpl) {
  if (!tpl.domain) return true;
  const doms = new Set([...(t.domains || []), ...(t.managed_by || [])]);
  (t.majors || []).forEach(m => { if (typeof MAJOR_DOMAIN !== 'undefined' && MAJOR_DOMAIN[m]) doms.add(MAJOR_DOMAIN[m]); });
  return !doms.size || doms.has(tpl.domain);
}
// 这位老师这个月该做哪些任务：[{tpl, via:'feature'|'role'}]
function taskApplicable(t, templates, month) {
  const out = [];
  (templates || []).forEach(tpl => {
    if (tpl.active === false || !(tpl.months || []).includes(month) || !taskDomainOk(t, tpl)) return;
    if (tpl.assign_by === 'feature') { if (taskTeacherHas(t, tpl.requires)) out.push({ tpl, via: 'feature' }); }
    else if (taskTeacherHasRole(t, tpl.role, tpl.role_tag)) out.push({ tpl, via: 'role' });
  });
  return out;
}
// 这位老师有职能标签、该职能下的任务需要某项功能、但还没开：[{tpl, spot}]（按 requires 去重）
function taskMissingFeatures(t, templates) {
  const seen = new Set(), out = [];
  (templates || []).forEach(tpl => {
    if (tpl.active === false || tpl.assign_by !== 'feature' || !tpl.requires || !(tpl.role || tpl.role_tag)) return;
    if (!taskTeacherHasRole(t, tpl.role, tpl.role_tag) || !taskDomainOk(t, tpl) || taskTeacherHas(t, tpl.requires) || seen.has(tpl.requires)) return;
    seen.add(tpl.requires);
    out.push({ tpl, spot: taskRequiresSpot(tpl.requires) });
  });
  return out;
}
