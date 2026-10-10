// ══════════════════════════════════
// admin/mgmt-notice.js — 管理可视化第二阶段（管理端）：发布提醒 → 查看老师反馈 → 负责人确认
// 业务状态（指标检测）和管理状态（已发布 / 已读 / 已反馈 / 确认）分两行显示，互不推导；
// 关闭由负责人决定：「系统检测：已做完」只是参考，必须点「确认已解决」才算这位老师这条结束
// 依赖：shared/mgmt-notice.js、shared/mgmt-metrics.js、admin/mgmt.js（mgSt / mgRerender / mgCurResult / mgCurMeta / mgGroups）
// 表：mgmt_notices、mgmt_notice_receipts（SQL 由 Sensis 执行）。写入一律走 sb()（带登录 token）
// ══════════════════════════════════
let mgnA = { notices: null, rcs: [], teachers: null, err: '', showClosed: false, openRow: '', live: {}, count: null, act: {}, pub: null, busy: false };

const mgnCan = () => typeof ACCESS_KEY === 'undefined' || !ACCESS_KEY || !ACCESS_KEY.invalid;   // admin 或有效的访问钥匙 / 管理模式；数据库另有兜底
function mgnWho() {
  const a = typeof ACCESS_KEY !== 'undefined' && ACCESS_KEY;
  if (a && a._asTeacher) return { id: a._asTeacher.id, name: a._asTeacher.name };
  if (a && !a.is_admin) return { id: a.k || '', name: a.label || '访问钥匙' };
  return { id: ADMIN_EMAIL || 'admin', name: ADMIN_EMAIL || '管理员' };
}
function mgnEnsureStyle() {
  if (document.getElementById('mgnStyle')) return;
  const st = document.createElement('style'); st.id = 'mgnStyle';
  st.textContent = `
  .mgn-link{color:${MGN_COL.blue};cursor:pointer;font-size:12px;white-space:nowrap}.mgn-link:hover{text-decoration:underline}
  .mgn-mini{color:${MGN_COL.blue};cursor:pointer;font-size:11px;margin-left:12px}.mgn-mini:hover{text-decoration:underline}
  .mgn-tr{display:grid;grid-template-columns:100px 80px 1fr 200px 190px;gap:10px;align-items:start;padding:10px 14px;background:#fff;border:1px solid ${MGN_COL.line};border-top:0;font-size:12px;cursor:pointer}
  .mgn-tr.h{cursor:default;color:${MGN_COL.mute};font-size:11px;border-top:1px solid ${MGN_COL.line};background:#fcf8f4}
  .mgn-tr small{display:block;color:${MGN_COL.mute};font-size:11px;margin-top:2px}
  .mgn-hist{padding:8px 14px 10px;background:#fcf8f4;border:1px solid ${MGN_COL.line};border-top:0;font-size:11px;color:${MGN_COL.mute};line-height:1.8}
  .mgn-modal{position:fixed;inset:0;z-index:1100;background:rgba(58,52,46,.35);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:30px 12px}
  .mgn-panel{background:#fff;border-radius:6px;border:1px solid ${MGN_COL.border};width:min(560px,100%);padding:20px 22px;color:${MGN_COL.text};font-size:12px}
  .mgn-panel label{display:block;font-size:11px;color:${MGN_COL.mute};margin:12px 0 4px}
  .mgn-panel input,.mgn-panel textarea,.mgn-panel select{width:100%;box-sizing:border-box;font-size:12px;padding:6px 8px;border:1px solid ${MGN_COL.border};border-radius:3px;font-family:inherit;background:#fff;color:${MGN_COL.text}}
  .mgn-chip{display:inline-block;padding:4px 12px;margin:0 6px 6px 0;border-radius:3px;border:1px solid ${MGN_COL.border};cursor:pointer;font-size:12px;background:#fff}
  .mgn-chip.on{border-color:${MGN_COL.blue};color:${MGN_COL.blue};font-weight:700}.mgn-chip.off{color:#b3aa9f;border-style:dashed;cursor:default}
  @media(max-width:760px){.mgn-tr{grid-template-columns:1fr 1fr}.mgn-tr.h{display:none}}`;
  document.head.appendChild(st);
}

// ── 读取 ──
async function mgnLoadTeachers() { return mgnA.teachers || (mgnA.teachers = await sbAll('/rest/v1/teachers?select=*&order=name.asc')); }
async function mgnReload() {
  if (mgnA.busy) return; mgnA.busy = true; mgnA.err = '';
  try {
    const [ns, rs] = await Promise.all([sbAll('/rest/v1/mgmt_notices?select=*&order=created_at.desc'), sbAll('/rest/v1/mgmt_notice_receipts?select=*'), mgnLoadTeachers()]);
    mgnA.notices = ns; mgnA.rcs = rs; mgnA.count = ns.filter(n => n.status === 'active').length;
  } catch (e) { mgnA.err = e.message || String(e); mgnA.notices = []; }
  mgnA.busy = false;
  if (mgSt().view === 'notices') mgRerender();
}
function mgnInvalidate() { mgnA.notices = null; mgnA.count = null; mgnA.act = {}; }
// 某指标上进行中的提醒（打开详情页才读一次，30 秒缓存）
async function mgnActive(mk) {
  const c = mgnA.act[mk]; if (c && Date.now() - c.t < 30000) return c.p;
  const p = sb(`/rest/v1/mgmt_notices?metric_key=eq.${encodeURIComponent(mk)}&status=eq.active&select=*&order=created_at.desc`).then(r => r || []);
  mgnA.act[mk] = { t: Date.now(), p }; return p;
}
const mgnTName = id => { const t = (mgnA.teachers || []).find(x => x.id === id); return t ? t.name : id; };

// ── 页头链接 / 渲染后补充（数量、详情页上方的提醒摘要）──
function mgnLinksHtml() {
  if (!mgnCan()) return '';
  mgnEnsureStyle();
  return `<a class="mgn-link" onclick="mgnNewFree()">新建自由提醒</a><a class="mgn-link" onclick="mgnGoList()">已发布的提醒<span id="mgnCnt">${mgnA.count != null ? '（' + mgnA.count + '）' : ''}</span></a>`;
}
async function mgnAfterRender() {
  if (!mgnCan()) return;
  const cnt = document.getElementById('mgnCnt');
  if (cnt && mgnA.count == null && !mgnA.cntBusy) {
    mgnA.cntBusy = true;
    try { const r = await sb('/rest/v1/mgmt_notices?status=eq.active&select=id'); mgnA.count = (r || []).length; } catch (e) { mgnA.count = null; }
    mgnA.cntBusy = false;
    const c2 = document.getElementById('mgnCnt'); if (c2 && mgnA.count != null) c2.textContent = `（${mgnA.count}）`;
  }
  const strip = document.getElementById('mgnStrip');
  if (strip && strip.dataset.mk) {
    try {
      const ns = await mgnActive(strip.dataset.mk); if (!ns.length) return;
      const n = ns[0], rs = await sb(`/rest/v1/mgmt_notice_receipts?notice_id=eq.${encodeURIComponent(n.id)}&select=id,feedback_status`) || [];
      const el = document.getElementById('mgnStrip'); if (!el || el.dataset.mk !== strip.dataset.mk) return;
      el.innerHTML = `<a class="mgn-link" onclick="mgnGoNotice('${mgnE(n.id)}')">已发布提醒：${(n.target_teachers || []).length} 位老师中 ${rs.filter(r => r.feedback_status).length} 位已反馈</a>`;
    } catch (e) {}
  }
}
// 指标详情页顶部：提醒摘要（读取时机：打开详情页才查）+ 发布按钮
function mgnDetailTop() {
  if (!mgnCan()) return '';
  const meta = mgCurMeta(); if (!meta || !meta.m) return '';
  mgnEnsureStyle();
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;min-height:24px"><div id="mgnStrip" data-mk="${mgnE(meta.m.key)}" style="font-size:11px"></div>
    <button class="mg-btn" onclick="mgnOpenPublish('')">发布提醒</button></div>`;
}
const mgnOnlyBtn = owner => mgnCan() ? `<span class="mgn-mini" onclick="event.stopPropagation();mgnOpenPublish('${mgnE(owner).replace(/'/g, "\\'")}')">只提醒他</span>` : '';

// ══════════ 发布面板 ══════════
function mgnRoleOk(t) { return isHubAdminUser() || teacherInView(t); }   // 管理员选任何老师；负责人只能选自己管理范围内的
async function mgnOpenPublish(only) {
  const meta = mgCurMeta(), r = meta && meta.m ? mgCurResult() : null;
  if (meta && meta.m && (!r || !r.items)) { alert('这个指标现在没有可提醒的名单'); return; }
  try { await mgnLoadTeachers(); } catch (e) { alert('读取老师列表失败：' + (e.message || e)); return; }
  mgnEnsureStyle();
  const owners = r ? mgGroups(r.items).map(x => x[0]).filter(o => o !== '未指定') : [];
  const chips = owners.map(nm => { const t = mgnA.teachers.find(x => x.name === nm); return { name: nm, id: t ? t.id : '', ok: !!t && mgnRoleOk(t) }; });
  const sel = new Set(chips.filter(c => c.ok && (!only || c.name === only)).map(c => c.id));
  const den = r && r.kind !== 'list' ? r : null, pend = r ? (r.kind === 'list' ? r.count : r.items.length) : 0;
  mgnA.pub = {
    mk: meta && meta.m ? meta.m.key : '', m: meta && meta.m, r, chips, sel, extra: [], filter: '', allOwners: owners,
    scopeLabel: meta ? meta.label : '', title: meta && meta.m ? meta.m.label : '',
    body: !r ? '' : r.kind === 'list' ? `【管理提醒】${r.period}，${meta.m.label}待处理 ${r.count} 人。请处理。` : `【管理提醒】${r.period}，${r.denom}共 ${den.total}，已完成 ${den.done}，待处理 ${pend} 项。请处理。`,
    due: '', dups: [], busy: false,
  };
  mgnPubRender();
  if (mgnA.pub.mk) { try { mgnA.pub.active = await mgnActive(mgnA.pub.mk); } catch (e) { mgnA.pub.active = []; } mgnPubRender(); }
}
function mgnPubSync() {   // 重画前把输入框里的内容存回状态
  const p = mgnA.pub; if (!p) return;
  const g = id => document.getElementById(id);
  if (g('mgnTitle')) p.title = g('mgnTitle').value; if (g('mgnBody')) p.body = g('mgnBody').value; if (g('mgnDue')) p.due = g('mgnDue').value; if (g('mgnFilter')) p.filter = g('mgnFilter').value;
}
function mgnPubSearch() { searchRerender('mgnFilter', mgnPubRender); }   // mgnPubRender 开头会把输入框内容存回 p.filter
function mgnPubRender() {
  const p = mgnA.pub; if (!p) return;
  mgnPubSync();
  const extraIds = p.extra, pool = (mgnA.teachers || []).filter(t => mgnRoleOk(t) && !p.chips.some(c => c.id === t.id) && !extraIds.includes(t.id) && searchMatch(p.filter, [t.name]));
  const tagOf = (name, id, ok) => `<span class="mgn-chip ${ok ? (p.sel.has(id) ? 'on' : '') : 'off'}" ${ok ? `onclick="mgnPubToggle('${mgnE(id)}')"` : ''}>${mgnE(name)}${ok ? '' : '（不在你的范围 / 无账号）'}</span>`;
  const dupT = (p.active || []).flatMap(n => (n.target_teachers || []).filter(id => p.sel.has(id)).map(id => ({ id, n })));
  const dupMsg = dupT.length ? `<div style="font-size:11px;color:${MGN_COL.mute};margin-top:6px"><i style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${MGN_COL.red};margin-right:6px"></i>` + [...new Set(dupT.map(x => x.id))].map(id => `${mgnE(mgnTName(id))} 已有一条进行中的同类提醒（发布于 ${mgnDay(dupT.find(x => x.id === id).n.created_at)}）`).join('；') + `，仍可继续发布。</div>` : '';
  const snap = p.r ? (p.r.kind === 'list' ? `发布时：待处理 ${p.r.count} 人（${p.r.period}）` : `发布时：${p.r.done}/${p.r.total}（${p.r.denom}；${p.r.period}）`) : '';
  let el = document.getElementById('mgnModal');
  if (!el) { el = document.createElement('div'); el.id = 'mgnModal'; el.className = 'mgn-modal'; document.body.appendChild(el); }
  el.innerHTML = `<div class="mgn-panel"><div style="display:flex;justify-content:space-between;align-items:center"><div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600">${p.mk ? '发布提醒' : '新建自由提醒'}</div><button class="mg-btn" onclick="mgnPubClose()">取消</button></div>
    <label>对象（点击切换选中 / 取消）</label>
    <div>${p.chips.map(c => tagOf(c.name, c.id, c.ok)).join('')}${extraIds.map(id => tagOf(mgnTName(id), id, true)).join('')}${(!p.chips.length && !extraIds.length) ? `<span style="color:${MGN_COL.mute}">没有可选的负责老师，请在下面添加</span>` : ''}</div>
    <div style="display:flex;gap:6px;margin-top:4px"><input id="mgnFilter" placeholder="添加其他老师：搜索姓名（汉字 / 拼音首字母）" value="${mgnE(p.filter)}" oninput="searchBox(this,mgnPubSearch)" style="flex:1"><select id="mgnAdd" onchange="mgnPubAdd(this.value)" style="width:150px"><option value="">选择老师…</option>${pool.slice(0, 80).map(t => `<option value="${mgnE(t.id)}">${mgnE(t.name)}</option>`).join('')}</select></div>
    ${dupMsg}
    <label>标题</label><input id="mgnTitle" value="${mgnE(p.title)}">
    <label>说明</label><textarea id="mgnBody" rows="4">${mgnE(p.body)}</textarea>
    <label>期限（可选）</label><input id="mgnDue" type="date" value="${mgnE(p.due)}" style="width:170px">
    ${snap ? `<div style="font-size:11px;color:${MGN_COL.mute};margin-top:12px">${mgnE(snap)}</div>` : `<div style="font-size:11px;color:${MGN_COL.mute};margin-top:12px">自由提醒不带业务数字，只能人工确认。</div>`}
    <div style="margin-top:14px;text-align:right"><button class="mg-btn" ${p.busy ? 'disabled' : ''} onclick="mgnDoPublish()">${p.busy ? '发布中…' : `发布给 ${p.sel.size} 位老师`}</button></div></div>`;
}
function mgnPubToggle(id) { const p = mgnA.pub; if (!p) return; p.sel.has(id) ? p.sel.delete(id) : p.sel.add(id); mgnPubRender(); }
function mgnPubAdd(id) { const p = mgnA.pub; if (!p || !id) return; p.extra.push(id); p.sel.add(id); mgnPubRender(); }
function mgnPubClose() { const el = document.getElementById('mgnModal'); if (el) el.remove(); mgnA.pub = null; }
function mgnNewFree() { if (!mgnCan()) return; mgnOpenFree(); }
async function mgnOpenFree() {
  try { await mgnLoadTeachers(); } catch (e) { alert('读取老师列表失败：' + (e.message || e)); return; }
  mgnEnsureStyle();
  mgnA.pub = { mk: '', m: null, r: null, chips: [], sel: new Set(), extra: [], filter: '', allOwners: [], scopeLabel: '自由提醒', title: '', body: '', due: '', busy: false, active: [] };
  mgnPubRender();
}
async function mgnDoPublish() {
  const p = mgnA.pub; if (!p || p.busy) return;
  mgnPubSync();
  const ids = [...p.sel], title = p.title.trim();
  if (!ids.length) { alert('请至少选择一位老师'); return; }
  if (!title) { alert('请填写标题'); return; }
  p.busy = true; mgnPubRender();
  const who = mgnWho(), nid = mgnId('mn'), now = mgnNow(), st = mgSt();
  const notice = {
    id: nid, title, body: p.body.trim(), metric_key: p.mk || null,
    scope: { type: p.mk ? (mgMode === 'p' ? 'view' : (mgS.tab === 'domain' || mgS.dom ? 'domain' : 'all')) : 'free', label: p.scopeLabel || '' },
    target_teachers: ids, snapshot: p.r ? mgnSnapshot(p.m, p.r, p.allOwners) : null, due_date: p.due || null,
    status: 'active', created_by: who.id, created_by_name: who.name,
  };
  try { await sb('/rest/v1/mgmt_notices', 'POST', notice); }
  catch (e) { p.busy = false; mgnPubRender(); alert('发布失败：' + (e.message || e)); return; }
  const rows = ids.map(tid => ({ id: mgnId('mr'), notice_id: nid, teacher_id: tid, round: 1, history: [{ at: now, by: who.name, action: 'published', text: '' }] }));
  try { await sb('/rest/v1/mgmt_notice_receipts', 'POST', rows); }   // 回执批量一次写入
  catch (e) {
    let undone = true; try { await sb(`/rest/v1/mgmt_notices?id=eq.${encodeURIComponent(nid)}`, 'DELETE'); } catch (_) { undone = false; }
    p.busy = false; mgnPubRender();
    alert('发布失败：给老师建回执时出错（' + (e.message || e) + '）' + (undone ? '。这条提醒已撤回，请重试。' : '。提醒本身已写入但没撤回成功，请到「已发布的提醒」里关闭它后重发。'));
    return;
  }
  mgnPubClose(); mgnInvalidate(); st.view = st.view || '';
  alert(`已发布给 ${ids.length} 位老师`);
  mgRerender();
}

// ══════════ 「已发布的提醒」页 ══════════
function mgnGoList() { const st = mgSt(); st.view = 'notices'; st.nid = ''; mgnA.openRow = ''; mgnA.live = {}; mgnInvalidate(); mgRerender(); }
function mgnGoNotice(id) { const st = mgSt(); st.view = 'notices'; st.nid = id; mgnA.openRow = ''; mgnA.live = {}; if (!mgnA.notices) mgnReload(); mgRerender(); }
function mgnOpenNotice(id) { const st = mgSt(); st.nid = id; mgnA.openRow = ''; mgnA.live = {}; mgRerender(); }
function mgnShowClosed(on) { mgnA.showClosed = !!on; mgRerender(); }

function mgnView(root) {
  mgnEnsureStyle();
  const st = mgSt(), crumbs = [root];
  if (mgnA.notices === null && !mgnA.busy) mgnReload();
  const n = st.nid && (mgnA.notices || []).find(x => x.id === st.nid);
  crumbs.push(n ? { t: '已发布的提醒', js: "mgnOpenNotice('')" } : { t: '已发布的提醒' });
  if (n) crumbs.push({ t: n.title });
  if (mgnA.err) return { crumbs, body: `<div class="mg-say"><span class="mg-dot"></span>读取失败：${mgnE(mgnA.err)}<br>如果提示表不存在，请先在 SQL Editor 执行 mgmt_phase2.sql。</div>` };
  if (mgnA.notices === null || mgnA.busy) return { crumbs, body: `<div class="mg-say">读取中…</div>` };
  if (st.nid && !n) return { crumbs, body: `<div class="mg-say">找不到这条提醒（可能已被删除）</div>` };
  return { crumbs, body: n ? mgnDetailView(n) : mgnListView() };
}
const mgnRcOf = nid => mgnA.rcs.filter(r => r.notice_id === nid);
function mgnListView() {
  const act = mgnA.notices.filter(n => n.status === 'active'), shown = mgnA.showClosed ? mgnA.notices.filter(n => n.status !== 'active') : act;
  let h = `<div class="mg-seg sm" style="margin-bottom:10px"><span class="${!mgnA.showClosed ? 'on' : ''}" onclick="mgnShowClosed(false)">进行中（${act.length}）</span><span class="${mgnA.showClosed ? 'on' : ''}" onclick="mgnShowClosed(true)">已关闭</span></div>`;
  if (!shown.length) return h + `<div class="mg-say">${mgnA.showClosed ? '没有已关闭的提醒' : '现在没有进行中的提醒'}</div>`;
  return h + shown.map(n => {
    const N = (n.target_teachers || []).length, rs = mgnRcOf(n.id), a = rs.filter(r => r.feedback_status).length, b = rs.filter(r => r.confirm_result === 'resolved').length;
    return `<div class="mg-row" onclick="mgnOpenNotice('${mgnE(n.id)}')"><div class="l">${mgnE(n.title)}<small>${mgnE([n.created_by_name, mgnDay(n.created_at), '对象 ' + N + ' 位'].filter(Boolean).join(' · '))}</small></div>
      <div class="r mg-num" style="width:210px">已反馈 ${a}/${N}　已确认 ${b}/${N}</div></div>`;
  }).join('');
}
function mgnDetailView(n) {
  const sn = n.snapshot || {}, ids = n.target_teachers || [], rs = mgnRcOf(n.id), by = id => rs.find(r => r.teacher_id === id);
  const allOk = ids.length && ids.every(id => (by(id) || {}).confirm_result === 'resolved');
  const bigT = n.metric_key ? ((sn.num != null && sn.den != null) ? `发布时 <span class="mg-num">${sn.num}/${sn.den}</span>` : `发布时待处理 <span class="mg-num">${sn.pending != null ? sn.pending : '-'}</span>`) : '自由提醒';
  let h = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><div style="font-size:11px;color:${MGN_COL.mute}">${mgnE([n.created_by_name, mgnDay(n.created_at), n.due_date ? '期限 ' + n.due_date : '', n.status === 'active' ? '' : '已关闭'].filter(Boolean).join(' · '))}</div>
    ${n.status === 'active' ? `<button class="mg-btn" onclick="mgnCloseNotice('${mgnE(n.id)}')">关闭这条提醒</button>` : ''}</div>
    <div class="mg-sum"><div><label>完成情况</label><div class="big">${bigT}</div></div><div><label>分母</label>${mgnE(sn.denLabel || '—')}</div><div><label>统计周期</label>${mgnE(sn.period || '—')}</div><div><label>说明</label>${mgnE(n.body || '—')}</div></div>`;
  if (allOk && n.status === 'active') h += `<div class="mg-say" style="margin-bottom:8px">所有老师都已确认解决。<a class="mgn-link" onclick="mgnCloseNotice('${mgnE(n.id)}')">关闭这条提醒</a></div>`;
  h += `<div class="mgn-tr h"><span>老师</span><span>已读</span><span>反馈</span><span>系统检测</span><span>负责人确认</span></div>`;
  ids.forEach(id => {
    const rc = by(id), name = mgnTName(id), open = rc && mgnA.openRow === rc.id;
    h += `<div class="mgn-tr" ${rc ? `onclick="mgnToggleRow('${mgnE(rc.id)}')"` : ''}><span style="font-weight:600">${mgnE(name)}</span>
      <span class="mg-num">${rc && rc.read_at ? mgnE(mgnFmt(rc.read_at)) : '<span style="color:' + MGN_COL.mute + '">未读</span>'}</span>
      <span>${rc && rc.feedback_status ? `${mgnE(MGN_FB[rc.feedback_status])}<small>${mgnE((rc.feedback_text || '').slice(0, 40))}${(rc.feedback_text || '').length > 40 ? '…' : ''}</small>` : `<span style="color:${MGN_COL.mute}">暂无反馈</span>`}</span>
      <span>${mgnSysCell(n, rc, id, name)}</span><span>${mgnConfirmCell(n, rc)}</span></div>`;
    if (open) {
      h += `<div class="mgn-hist">${rc.feedback_text ? `<div style="color:${MGN_COL.text};white-space:pre-wrap;margin-bottom:6px">反馈全文：${mgnE(rc.feedback_text)}</div>` : ''}`
        + ((rc.history || []).map(x => `<div>${mgnE(mgnFmt(x.at))}　${mgnE(x.by || '')}　${mgnE(mgnActText(x.action))}${x.text ? '：' + mgnE(x.text) : ''}</div>`).join('') || '暂无记录') + `</div>`;
    }
  });
  return h;
}
function mgnActText(a) {
  const m = { published: '发布', read: '已读', business_done: '系统检测：业务上已做完', 'confirm:resolved': '确认已解决', 'confirm:reopen': '未解决，再提醒' };
  if (m[a]) return m[a];
  const f = String(a).match(/^feedback:(.+)$/); return f ? '反馈：' + (MGN_FB[f[1]] || f[1]) : a;
}
function mgnSysCell(n, rc, tid, name) {
  if (!n.metric_key || !mgnFind(n.metric_key)) return `<span style="color:${MGN_COL.mute}">不能自动判断，由负责人确认</span>`;
  const done = rc && rc.business_done_at ? `系统检测 ${mgnE(mgnDay(rc.business_done_at))} 已做完` : '';
  const lv = rc && mgnA.live[rc.id];
  let cur = '';
  if (lv === 'loading') cur = `<small>计算中…</small>`;
  else if (lv) cur = lv.pending == null ? `<small>不能自动判断，由负责人确认</small>` : `<small>${lv.pending ? `当前 ${lv.pending} 项待处理` : '当前业务上已做完'}</small>`;
  const btn = !lv && rc ? `<a class="mgn-link" onclick="event.stopPropagation();mgnCheckRow('${mgnE(rc.id)}')">查看当前业务状态</a>` : '';
  return (done || '') + cur + (done || cur ? '' : btn) + (done && !cur && rc ? `<small><a class="mgn-link" onclick="event.stopPropagation();mgnCheckRow('${mgnE(rc.id)}')">重新检测</a></small>` : '');
}
function mgnConfirmCell(n, rc) {
  if (!rc) return `<span style="color:${MGN_COL.mute}">没有回执</span>`;
  if (rc.confirm_result === 'resolved') return `已确认解决<small>${mgnE(mgnDay(rc.confirmed_at))} ${mgnE(rc.confirmed_by || '')}</small>`;
  const id = mgnE(rc.id);
  return (rc.confirm_result === 'reopen' ? `<small style="margin:0 0 4px;color:${MGN_COL.text}">已要求再处理（第 ${rc.round || 1} 轮）</small>` : '')
    + `<button class="mg-btn" onclick="event.stopPropagation();mgnConfirm('${id}','resolved')">确认已解决</button> <button class="mg-btn" onclick="event.stopPropagation();mgnConfirm('${id}','reopen')">未解决，再提醒</button>`;
}
function mgnToggleRow(rid) { mgnA.openRow = mgnA.openRow === rid ? '' : rid; mgRerender(); }

// ── 操作（都先 await，失败提示并保持界面状态，不乐观更新）──
async function mgnCheckRow(rid) {
  const rc = mgnA.rcs.find(r => r.id === rid), n = rc && mgnA.notices.find(x => x.id === rc.notice_id); if (!n) return;
  mgnA.live[rid] = 'loading'; mgRerender();
  try { mgnA.live[rid] = { pending: (await mgnCheck(mgnTName(rc.teacher_id), n.metric_key)).pending }; }
  catch (e) { delete mgnA.live[rid]; alert('检测失败：' + (e.message || e)); }
  mgRerender();
}
async function mgnConfirm(rid, result) {
  const rc = mgnA.rcs.find(r => r.id === rid); if (!rc) return;
  const who = mgnWho().name, now = mgnNow();
  let note = '';
  if (result === 'reopen') { note = prompt('给老师的说明（可选，老师会看到）：', ''); if (note === null) return; note = note.trim(); }
  const patch = result === 'resolved'
    ? { confirm_result: 'resolved', confirmed_by: who, confirmed_at: now }
    : { confirm_result: 'reopen', confirmed_by: who, confirmed_at: now, round: (rc.round || 1) + 1, feedback_status: null, feedback_text: null, feedback_at: null, business_done_at: null };
  try { const row = await mgnApply(rid, patch, 'confirm:' + result, who, note); Object.assign(rc, row); }
  catch (e) { alert('保存失败：' + (e.message || e)); return; }
  mgRerender();
}
async function mgnCloseNotice(nid) {
  if (!confirm('关闭后，所有老师都不再看到这条提醒。确定关闭吗？')) return;
  try { await sb(`/rest/v1/mgmt_notices?id=eq.${encodeURIComponent(nid)}`, 'PATCH', { status: 'closed', closed_at: mgnNow(), closed_by: mgnWho().name }); }
  catch (e) { alert('关闭失败：' + (e.message || e)); return; }
  mgnInvalidate(); mgnReload(); mgRerender();
}
