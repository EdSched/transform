// ══════════════════════════════════
// teacher-mgmt.js — 老师端首页置顶区「管理提醒」（管理可视化第二阶段）
// 只读两张小表：发给我的 active 提醒 + 我的回执；点开某条才算「我名下」的实时业务状态（不预读学生等大表）
// 业务状态与管理状态分两块显示、互不推导；老师没有「已处理」按钮，只能：看到、反馈（已看到 / 处理中 / 无法处理 + 文字）、去处理
// 业务做完了（我名下 0 项待处理）→ 这条自动收进「已完成」折叠区，并写回 business_done_at；关闭由负责人决定
// 依赖：shared/mgmt-metrics.js、shared/mgmt-notice.js、shared/task-checks.js（taskOpenStudent）、teacher.js（teacherData / switchTab / teacherTabList / openProfileForm）、teacher-students.js（smTab / smAllowedItems）
// ══════════════════════════════════
const MGP_MAX = 20;
let MGP = { notices: [], rc: {}, open: '', doneOpen: false, more: false, live: {}, draft: {} };
const mgpMe = () => (teacherData && (teacherData.name || teacherName)) || '';

async function mgpLoad() {
  const box = document.getElementById('mgPinned');
  if (!box || !teacherData || !teacherData.id) return;
  try {
    const id = teacherData.id;
    const ns = await sb(`/rest/v1/mgmt_notices?status=eq.active&target_teachers=cs.${encodeURIComponent('{' + id + '}')}&select=*&order=created_at.desc&limit=100`) || [];
    const rs = ns.length ? await sb(`/rest/v1/mgmt_notice_receipts?teacher_id=eq.${encodeURIComponent(id)}&notice_id=in.(${ns.map(n => encodeURIComponent(n.id)).join(',')})&select=*`) || [] : [];
    MGP.rc = {}; rs.forEach(r => { MGP.rc[r.notice_id] = r; });
    MGP.notices = ns;
  } catch (e) { box.innerHTML = ''; box.style.cssText = ''; return; }   // 表还没建 / 网络问题：静默，首页保持原样
  if (!document.getElementById('mgPinned')) return;   // 加载期间已切走
  mgpRender();
}
function mgpVisible() { return MGP.notices.filter(n => (MGP.rc[n.id] || {}).confirm_result !== 'resolved'); }   // 负责人确认解决的不再显示

function mgpRender() {
  const box = document.getElementById('mgPinned'); if (!box) return;
  const vis = mgpVisible(), act = vis.filter(n => !(MGP.rc[n.id] || {}).business_done_at), done = vis.filter(n => (MGP.rc[n.id] || {}).business_done_at);
  if (!vis.length) { box.innerHTML = ''; box.style.cssText = ''; return; }
  box.style.cssText = `border-bottom:1px solid ${MGN_COL.line};padding-bottom:12px`;
  const shown = MGP.more ? act : act.slice(0, MGP_MAX);
  let h = `<div style="font-family:'Noto Serif SC',serif;font-size:13px;font-weight:600;margin-bottom:6px">管理提醒${act.length ? `（${act.length}）` : ''}</div>`;
  if (!act.length) h += `<div style="font-size:11px;color:${MGN_COL.mute};padding:2px 0 6px">现在没有需要你处理的提醒</div>`;
  h += shown.map(mgpRow).join('');
  if (act.length > shown.length) h += `<div onclick="MGP.more=true;mgpRender()" style="cursor:pointer;font-size:11px;color:${MGN_COL.blue};padding:6px 2px">还有 ${act.length - shown.length} 条 ▾</div>`;
  if (done.length) {
    const on = MGP.doneOpen || done.some(n => n.id === MGP.open);
    h += `<div onclick="MGP.doneOpen=!MGP.doneOpen;mgpRender()" style="cursor:pointer;font-size:11px;color:${MGN_COL.mute};padding:8px 2px 4px">已完成（${done.length}）${on ? '▾' : '▸'}</div>`;
    if (on) h += done.map(mgpRow).join('');
  }
  box.innerHTML = h;
}
function mgpRow(n) {
  const rc = MGP.rc[n.id] || null, open = MGP.open === n.id;
  const meta = [n.created_by_name, mgnDay(n.created_at), n.due_date ? '期限 ' + n.due_date : ''].filter(Boolean).join(' · ');
  return `<div style="border:1px solid ${MGN_COL.border};border-radius:4px;background:#fff;margin-bottom:6px">
    <div onclick="mgpToggle('${mgnE(n.id)}')" style="cursor:pointer;display:flex;gap:10px;align-items:baseline;padding:9px 12px">
      <span style="font-weight:600;font-size:12px">${mgnE(n.title)}</span><span style="font-size:11px;color:${MGN_COL.mute};flex:1">${mgnE(meta)}</span>
      <span style="font-size:11px;color:${MGN_COL.mute};white-space:nowrap">${mgnE(mgnStatusWord(rc))} ${open ? '▾' : '▸'}</span></div>
    ${open ? mgpBody(n, rc) : ''}</div>`;
}

// ── 展开后：上 = 业务状态（实时算我名下），下 = 管理状态（负责人说明 + 我的反馈）──
function mgpBody(n, rc) {
  const sec = t => `<div style="font-size:10px;color:${MGN_COL.mute};letter-spacing:.06em;margin-bottom:6px">${t}</div>`;
  return `<div style="border-top:1px solid ${MGN_COL.line};padding:12px">${sec('业务状态')}${mgpBiz(n)}</div>
    <div style="border-top:1px solid ${MGN_COL.line};padding:12px">${sec('管理状态')}${mgpMgmt(n, rc)}</div>`;
}
function mgpBiz(n) {
  if (!n.metric_key || !mgnFind(n.metric_key)) return `<div style="font-size:12px;color:${MGN_COL.mute}">这项需要负责人确认。</div>`;
  const lv = MGP.live[n.id], sn = n.snapshot || {}, me = mgpMe();
  if (!lv || !lv.res) return `<div style="font-size:12px;color:${MGN_COL.mute}">正在计算你名下的当前情况…</div>`;
  const snap = (sn.num != null && sn.den != null) ? `发布时 ${sn.num}/${sn.den}` : `发布时待处理 ${sn.pending != null ? sn.pending : '-'}`;
  const mineThen = sn.by_teacher && me in sn.by_teacher ? `（发布时我名下 ${sn.by_teacher[me]} 项）` : '';
  const r = lv.res, p = mgnPending(r);
  if (p == null) return `<div style="font-size:12px;color:${MGN_COL.mute}">${snap}${mineThen}。这项不能自动判断，需要负责人确认。</div>`;
  const go = mgpGoAvail(n.metric_key) ? `<button onclick="mgpGo('${mgnE(n.metric_key)}')" style="font-size:11px;background:#fff;border:1px solid ${MGN_COL.border};border-radius:3px;padding:4px 14px;cursor:pointer;font-family:inherit;color:${MGN_COL.text}">去处理</button>` : '';
  const head = `<div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between"><div style="font-size:12px;line-height:1.7">${snap}${mineThen}　<b style="font-variant-numeric:tabular-nums">当前 ${p} 项待处理</b>
    <div style="font-size:11px;color:${MGN_COL.mute}">分母：${mgnE(r.denom)} · 周期：${mgnE(r.period)}</div></div>${go}</div>`;
  if (!p) return head + `<div style="font-size:12px;margin-top:8px"><span style="display:inline-block;border-left:3px solid ${MGN_COL.green};padding-left:8px;color:${MGN_COL.green}">系统检测：已完成</span></div>`;
  const items = r.items.slice(0, 10);
  return head + `<div style="margin-top:8px">` + items.map(x => `<div style="display:flex;gap:8px;padding:4px 2px;border-top:1px solid ${MGN_COL.line};font-size:12px;align-items:baseline"><i style="width:6px;height:6px;border-radius:50%;background:${MGN_COL.red};flex-shrink:0;align-self:center"></i>
      ${x.sid ? `<a onclick="taskOpenStudent('${mgnE(x.sid)}','${mgnE(x.name).replace(/'/g, "\\'")}')" style="font-weight:600;color:${MGN_COL.blue};text-decoration:underline;cursor:pointer">${mgnE(x.name)}</a>` : `<span style="font-weight:600">${mgnE(x.name)}</span>`}
      <span style="color:${MGN_COL.mute}">${mgnE(x.note)}</span></div>`).join('')
    + (r.items.length > 10 ? `<div style="font-size:11px;color:${MGN_COL.mute};padding:4px 2px">还有 ${r.items.length - 10} 项</div>` : '') + `</div>`;
}
function mgpMgmt(n, rc) {
  const hist = (rc && rc.history) || [], reopen = hist.filter(h => h.action === 'confirm:reopen').pop();
  const d = MGP.draft[n.id] || (MGP.draft[n.id] = { st: (rc && rc.feedback_status) || '', text: (rc && rc.feedback_text) || '' });
  let h = '';
  if (n.body) h += `<div style="font-size:12px;line-height:1.7;white-space:pre-wrap;margin-bottom:8px">${mgnE(n.body)}</div>`;
  if (n.due_date) h += `<div style="font-size:11px;color:${MGN_COL.mute};margin-bottom:8px">期限：${mgnE(n.due_date)}</div>`;
  if (rc && rc.confirm_result === 'reopen') h += `<div style="font-size:12px;margin-bottom:8px;border-left:3px solid ${MGN_COL.sand};padding-left:8px">负责人要求再处理（第 ${rc.round || 1} 轮）${reopen && reopen.text ? '：' + mgnE(reopen.text) : ''}</div>`;
  if (rc && rc.feedback_status) h += `<div style="font-size:11px;color:${MGN_COL.mute};margin-bottom:8px">已反馈（${mgnE(MGN_FB[rc.feedback_status] || '')}，${mgnE(mgnFmt(rc.feedback_at))}），等待负责人确认。可以再次修改。</div>`;
  const id = mgnE(n.id);
  h += `<div style="display:flex;gap:6px;margin-bottom:6px">` + Object.entries(MGN_FB).map(([k, t]) =>
    `<span onclick="mgpPick('${id}','${k}')" style="cursor:pointer;font-size:11px;padding:4px 14px;border-radius:3px;border:1px solid ${d.st === k ? MGN_COL.blue : MGN_COL.border};color:${d.st === k ? MGN_COL.blue : MGN_COL.text};font-weight:${d.st === k ? 700 : 400};background:#fff">${t}</span>`).join('') + `</div>
    <textarea id="mgpTa_${id}" oninput="MGP.draft['${id}'].text=this.value" placeholder="补充说明（可选）" rows="2" style="width:100%;box-sizing:border-box;font-size:12px;padding:6px 8px;border:1px solid ${MGN_COL.border};border-radius:3px;font-family:inherit;resize:vertical">${mgnE(d.text)}</textarea>
    <div style="margin-top:6px"><button onclick="mgpSubmit('${id}')" style="font-size:11px;background:#fff;border:1px solid ${MGN_COL.border};border-radius:3px;padding:4px 16px;cursor:pointer;font-family:inherit;color:${MGN_COL.text}">提交反馈</button></div>`;
  return h;
}

// ── 交互 ──
async function mgpToggle(nid) {
  MGP.open = MGP.open === nid ? '' : nid;
  mgpRender();
  if (!MGP.open) return;
  const n = MGP.notices.find(x => x.id === nid); if (!n) return;
  mgpMarkRead(n);
  if (n.metric_key && mgnFind(n.metric_key)) mgpLive(n);
}
async function mgpEnsureRc(n) {   // 回执不存在时（理论上发布时就建了）补建
  if (MGP.rc[n.id]) return MGP.rc[n.id];
  const rows = await sb('/rest/v1/mgmt_notice_receipts', 'POST', [{ id: mgnId('mr'), notice_id: n.id, teacher_id: teacherData.id, history: [] }]);
  return (MGP.rc[n.id] = rows[0]);
}
async function mgpMarkRead(n) {   // 首次展开写 read_at（只写一次）；失败静默，下次展开再试
  try {
    const rc = await mgpEnsureRc(n); if (rc.read_at) return;
    MGP.rc[n.id] = await mgnApply(rc.id, { read_at: mgnNow() }, 'read', mgpMe());
    mgpRender();
  } catch (e) {}
}
async function mgpLive(n) {
  const lv = MGP.live[n.id];
  if (!lv || Date.now() - lv.t > 60000) {
    MGP.live[n.id] = { t: Date.now(), res: null }; mgpRender();
    try { MGP.live[n.id].res = (await mgnCheck(mgpMe(), n.metric_key)).r; }
    catch (e) { MGP.live[n.id].res = { err: e.message || String(e) }; }
  }
  mgpRender();
  const r = MGP.live[n.id].res, rc = MGP.rc[n.id];
  if (r && mgnPending(r) === 0 && rc && !rc.business_done_at) {   // 业务上做完了：系统检测写入（不是老师点的）
    try { MGP.rc[n.id] = await mgnApply(rc.id, { business_done_at: mgnNow() }, 'business_done', '系统检测'); mgpRender(); } catch (e) {}
  }
}
function mgpPick(nid, st) {
  const d = MGP.draft[nid] || (MGP.draft[nid] = { st: '', text: '' }), ta = document.getElementById('mgpTa_' + nid);
  if (ta) d.text = ta.value;
  d.st = st; mgpRender();
}
async function mgpSubmit(nid) {
  const n = MGP.notices.find(x => x.id === nid), d = MGP.draft[nid]; if (!n || !d) return;
  const ta = document.getElementById('mgpTa_' + nid); if (ta) d.text = ta.value;
  if (!d.st) { alert('请先选择「已看到 / 处理中 / 无法处理」'); return; }
  try {
    const rc = await mgpEnsureRc(n), text = d.text.trim();
    MGP.rc[nid] = await mgnApply(rc.id, { feedback_status: d.st, feedback_text: text || null, feedback_at: mgnNow() }, 'feedback:' + d.st, mgpMe(), text);
    mgpRender();
  } catch (e) { alert('提交失败：' + (e.message || e)); }   // 失败不改界面状态
}

// ── 去处理：跳到真正完成它的地方；没有对应入口的不显示按钮 ──
const MGP_GO = {
  interview: { tab: 'studentmgmt', sm: 'meetings' }, absent3: { tab: 'studentmgmt', sm: 'focus' }, expiry: { tab: 'studentmgmt', sm: 'profile' },
  plan: { tab: 'studentmgmt', sm: 'progress' }, school: { tab: 'studentmgmt', sm: 'progress' }, result: { tab: 'studentmgmt', sm: 'progress' },
  attendance: { tab: 'studentmgmt', sm: 'records' }, next_term: { tab: 'schedule' }, homework: { tab: 'homework' }, profile: { profile: true },
};
function mgpGoAvail(key) {
  const g = MGP_GO[key]; if (!g) return false;
  if (g.profile) return typeof isSenmonTeacher === 'function' && isSenmonTeacher(teacherData);
  if (!(teacherTabList || []).some(t => t.id === g.tab)) return false;
  if (g.sm) return smAllowedItems().some(([k]) => k === g.sm);
  return true;
}
function mgpGo(key) {
  const g = MGP_GO[key]; if (!g || !mgpGoAvail(key)) return;
  if (g.profile) { openProfileForm(''); return; }
  if (g.sm) smTab = g.sm;
  switchTab(g.tab);
}
