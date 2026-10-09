// ══════════════════════════════════
// shared/mgmt-notice.js — 管理可视化第二阶段：置顶提醒（管理端发布 / 老师端反馈共用的小工具）
// 业务状态（指标检测出来的真实情况）和管理状态（已发布 / 已读 / 已反馈 / 负责人确认）完全分开，互不推导：
//   老师点「处理中」不会改变任何业务数字；业务做完了只写 business_done_at（系统检测），关闭由负责人决定
// 表：mgmt_notices（提醒）、mgmt_notice_receipts（每位老师每条提醒一行，history 追加日志）——建表 SQL 由 Sensis 在 SQL Editor 执行
// 依赖：shared/supabase.js、shared/mgmt-metrics.js（MGM_GROUPS / mgmRun）
// ══════════════════════════════════
const MGN_COL = { text: '#3a342e', mute: '#8a8076', line: '#e8dfd5', border: '#d9cfc4', hover: '#b9ab9b', blue: '#4f7194', green: '#5b7f55', sand: '#c9a37a', red: '#c4646a' };
const mgnE = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mgnNow = () => new Date().toISOString();
const mgnId = p => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// 显示用时间：日本时间 MM-DD HH:mm
const mgnFmt = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(5, 16); };
const mgnDay = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 10); };
const MGN_FB = { seen: '已看到', doing: '处理中', blocked: '无法处理' };

// 指标 key → { g 大项, m 指标 }
function mgnFind(key) {
  for (const g of MGM_GROUPS) { const m = g.metrics.find(x => x.key === key); if (m) return { g, m }; }
  return null;
}
// 某位老师「名下」的范围（与第一阶段的「我名下」同一口径：学生 owner_teachers / vip_teachers 含姓名；课程、课次按 teacher / session_teacher 含姓名）
// 不受当前视角限制——管理端查看「这位老师现在的情况」、老师端算自己的，都用它
function mgnTeacherScope(name) {
  const has = v => String(v || '').includes(name);
  return {
    key: 't:' + name, label: name + ' 名下', mine: name, domain: '',
    stu: s => (s.owner_teachers || []).includes(name) || (s.vip_teachers || []).includes(name),
    course: c => has(c.teacher),
    sess: (x, cm) => !!(cm && cm[x.course_id]) && (has(x.session_teacher) || has(x.teacher)),
  };
}
// 待处理项数；na / 读取失败 = null（不能自动判断）
function mgnPending(r) {
  const st = mgmState(r);
  if (st === 'na' || st === 'err') return null;
  return r.kind === 'list' ? r.count : r.items.length;
}
// 实时算一位老师名下的某个指标（同 60 秒缓存由 mgmRun 负责）
async function mgnCheck(teacherName, metricKey) {
  const f = mgnFind(metricKey); if (!f) return { r: { na: true, note: '找不到这个指标' }, pending: null };
  const r = await mgmRun(mgnTeacherScope(teacherName), f.m);
  return { r, pending: mgnPending(r) };
}
// 发布时的快照（数字用快照显示「发布时」，实时值另算）
function mgnSnapshot(m, r, owners) {
  const by = {}; (owners || []).forEach(o => { by[o] = 0; });
  r.items.forEach(x => (x.owners || []).forEach(o => { if (o in by) by[o]++; }));
  const list = r.kind === 'list';
  return { title: m.label, num: list ? null : r.done, den: list ? null : r.total, pending: list ? r.count : r.items.length, denLabel: r.denom || '', period: r.period || '', by_teacher: by };
}
// 追加一条历史（不覆盖）：返回新数组
function mgnHist(row, action, by, text) {
  const h = Array.isArray(row && row.history) ? row.history.slice() : [];
  h.push({ at: mgnNow(), by: by || '', action, text: text || '' });
  return h;
}
// 回执的「管理状态」词
function mgnStatusWord(rc) {
  if (!rc) return '新提醒';
  if (rc.confirm_result === 'resolved') return '负责人已确认';
  if (rc.confirm_result === 'reopen') return '负责人要求再处理';
  if (rc.feedback_status) return '已反馈待确认';
  if (rc.read_at) return '已读';
  return '新提醒';
}
// 带历史的写入：先重读这一行再追加，避免用页面里的旧副本覆盖对方刚写的记录（老师和负责人会同时改同一行）
async function mgnApply(id, patch, action, by, text) {
  const cur = await sb(`/rest/v1/mgmt_notice_receipts?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!cur || !cur.length) throw new Error('读不到这条回执（可能没有权限，或已不存在）');
  return mgnPatchReceipt(id, Object.assign({}, patch, { history: mgnHist(cur[0], action, by, text) }));
}
async function mgnPatchReceipt(id, patch) {
  const rows = await sb(`/rest/v1/mgmt_notice_receipts?id=eq.${encodeURIComponent(id)}`, 'PATCH', patch);
  if (!rows || !rows.length) throw new Error('没有写入成功（可能没有权限，或这条回执已不存在）');
  return rows[0];
}
