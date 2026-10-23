// ══════════ VIP 预约：「成立」怎么判断 + 提醒文字（老师端 / 学生端 / 管理端共用）══════════
// 流程：老师、学生谁发起都行，另一方确认，这节课就成立；教务只是知情和兜底（可以代确认缺的那一方）
//   老师发起：initiated_by='teacher'、teacher_ok=true，等 student_ok=true
//   学生发起：initiated_by='student'（旧数据：self_booked=true），等 teacher_ok=true
//   旧的自主预约（admin_review='pending'，当时要教务审批）：放进「待确认」，由教务处理（k = 'legacy_admin'）
//   时间槽预约（学生点老师开放的时间槽）：status='pending' 等老师确认，和以前一样
// 成立的时候 status='confirmed'，没成立是 'pending'
// vipBookingState(b) → { k, label, who }
//   k: 'cancelled' | 'done' | 'wait_student' | 'wait_teacher' | 'legacy_admin' | 'established'
//   who: 还在等谁（'student' / 'teacher' / 'admin' / ''）
function vipInitiator(b) {
  if (!b) return '';
  if (b.initiated_by) return b.initiated_by;
  return b.self_booked ? 'student' : '';   // 老数据没有 initiated_by：自主填写的算学生发起，其余是时间槽预约
}
function vipBookingState(b) {
  if (!b) return { k: '', label: '', who: '' };
  if (b.status === 'cancelled') return { k: 'cancelled', label: '已取消', who: '' };
  if (b.status === 'completed') return { k: 'done', label: '已上课', who: '' };
  const est = { k: 'established', label: '已成立', who: '' };
  if (b.status === 'confirmed') return est;   // 成立的时候 status 一定是 confirmed
  const by = vipInitiator(b);
  if (by === 'teacher') return b.student_ok === true ? est : { k: 'wait_student', label: '待学生确认', who: 'student' };
  if (by === 'student') {
    if (b.admin_review === 'approved') return est;   // 旧数据：教务审批过
    const legacy = b.admin_review === 'pending' || b.admin_review === 'room_wait';   // 旧数据：当时要教务审批
    if (b.teacher_ok === true) return legacy ? { k: 'legacy_admin', label: '待教务处理（旧）', who: 'admin' } : est;
    return { k: 'wait_teacher', label: '待老师确认', who: 'teacher' };
  }
  if (by === 'admin') return est;
  return { k: 'wait_teacher', label: '待老师确认', who: 'teacher' };   // 时间槽预约：等老师确认
}
// 谁在 ○月○日 ○○:○○–○○:○○（把 'YYYY-MM-DD' 和 'HH:MM–HH:MM' 写成中文）
function vipWhenText(b) {
  const m = String(b.slot_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? `${+m[2]}月${+m[3]}日` : (b.slot_date || '');
  return `${d} ${String(b.slot_time_range || '').replace(/\s*[-~～—]\s*/, '–')}`.trim();
}
// 教室 / 方式一句话：线上 → 「线上」；线下 → 「教室○○」或「教室待安排」
function vipWhereText(b, roomName) {
  const loc = b.location || 'online';
  if (loc === 'online') return '线上';
  const room = roomName != null ? roomName : (b.vip_room || '');
  return room ? `教室${room}` : '教室待安排';
}
// 老师发起 → 给学生的提醒文字（现在走 vipNoticeText，和其他通知同一个格式，适合直接发群）
function vipStudentRemindText(b, roomName) {
  return vipNoticeText(b, 'teacher_created', { room: roomName });
}
// 学生发起 → 给老师的提醒文字
function vipTeacherRemindText(b, teacherDisplay) {
  return vipNoticeText(b, 'student_created', {});
}

// ══════════ VIP 通知：群文字 + 复制（老师端 / 学生端 / 管理端共用）══════════
// vipNoticeText(b, event, extra) → 【VIP】○月○日（周○）○○:○○–○○:○○｜学生 ○○｜老师 ○○｜线下·教室○○ / 线上｜<这次发生了什么>
//   event: teacher_created / student_created / student_ok / teacher_ok / changed / cancelled / admin_ok / room_changed / done / raw
//   extra: { room, approval, from, to, reason, by, who, admin, text, snap }；snap = 发通知当时的 {d,t,loc,room}（留言里存了一份，以后复制时时间不会跟着变）
// 老师名按学生端规则：昵称 → 对外名称 → 真名（群里有学生）
let _vipNtMap = {}, _vipNtLoaded = false;
async function vipNoticeLoadMap() {
  if (_vipNtLoaded) return;
  _vipNtLoaded = true;
  try { if (typeof teacherNameMap === 'function') _vipNtMap = await teacherNameMap(); } catch (e) { _vipNtLoaded = false; }
}
function vipNoticeNameMap() {
  if (typeof vipPubMap !== 'undefined' && vipPubMap && Object.keys(vipPubMap).length) return vipPubMap;   // 学生端已经读好了
  return _vipNtMap;
}
function vipNoticeSnap(b) { return { d: b.slot_date || '', t: b.slot_time_range || '', loc: b.location || 'online', room: b.vip_room || '' }; }
function vipNoticeWhere(loc, room) {
  if ((loc || 'online') === 'online') return '线上';
  return '线下·' + (room ? '教室' + room : '教室待安排');
}
function vipNoticeWhen(d, t) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  let day = d || '';
  if (m) day = `${+m[2]}月${+m[3]}日（周${'日一二三四五六'[new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`).getDay()]}）`;
  return day + String(t || '').replace(/\s*[-~～—]\s*/, '–');
}
// 一句话描述这节课现在的样子：○月○日（周○）○○:○○–○○:○○ 线上 / 线下·教室○○
function vipNoticeDesc(b, room) {
  const sn = vipNoticeSnap(b);
  return vipNoticeWhen(sn.d, sn.t) + ' ' + vipNoticeWhere(sn.loc, room != null ? room : sn.room);
}
function vipNoticeCancelBy(b) {
  const c = String(b.cancelled_by || '');
  if (/学生/.test(c)) return '学生取消';
  if (/^教务/.test(c)) return c;
  if (/老师退回/.test(c)) return '老师退回';
  return '老师取消';
}
function vipNoticeApproval(b, x) {
  if (b && b._sched) return b._sched.status === 'confirmed' ? '已批准' : '待总务批准';
  if (x && x.approval) return x.approval === 'approved' ? '已批准' : x.approval === 'pending' ? '待总务批准' : x.approval;
  return '';
}
// 「这次发生了什么」
function vipNoticeWhat(b, ev, x) {
  x = x || {};
  const sn = Object.assign(vipNoticeSnap(b), x.snap || {});
  const room = x.room != null ? x.room : sn.room;
  const off = sn.loc !== 'online';
  const appr = vipNoticeApproval(b, x);
  switch (ev) {
    case 'teacher_created': return '老师已建立这节课，请同学确认上课';
    case 'student_created': return off ? '同学已预约，请老师确认并安排教室' : '同学已预约，请老师确认';
    case 'student_ok': return '同学已确认上课，这节课已成立';
    case 'teacher_ok':
      return `老师已确认，上课时间 ${String(sn.t).replace(/\s*[-~～—]\s*/, '–')}，${off ? (room ? '教室 ' + room : '教室待安排') + (appr ? `（${appr}）` : '') : '线上'}，这节课已成立`;
    case 'changed':
      return `时间 / 教室 / 方式已调整：原 ${x.from || '—'} → 现 ${x.to || vipNoticeDesc(b)}${x.reason ? '（原因：' + x.reason + '）' : ''}`;
    case 'cancelled': {
      const by = x.by || vipNoticeCancelBy(b), reason = x.reason != null ? x.reason : (b.cancel_reason || '');
      return `已取消（${by}${reason ? '，原因：' + reason : ''}）${off ? '，教室已释放' : ''}`;
    }
    case 'admin_ok':
      return `教务已${x.who ? '代' + x.who : ''}确认，${off && room ? '教室 ' + room + (appr ? `（${appr}）` : '') + '，' : ''}这节课已成立`;
    case 'room_changed': return `教室调整为 ${room || '待安排'}（${x.by || '总务安排'}）`;
    case 'done': return '本次课已完成，请同学到 VIP 页面确认并评价：https://edsched.github.io/transform/vip/';
    default: return String(x.text || '');
  }
}
function vipNoticeText(b, ev, extra) {
  const x = extra || {};
  const sn = Object.assign(vipNoticeSnap(b), x.snap || {});
  const room = x.room != null ? x.room : sn.room;
  const teacher = typeof stuName === 'function' ? stuName(b.assigned_teacher || '', vipNoticeNameMap()) : (b.assigned_teacher || '');
  return `【VIP】${vipNoticeWhen(sn.d, sn.t)}｜学生 ${b.name || ''}｜老师 ${teacher}｜${vipNoticeWhere(sn.loc, room)}｜${vipNoticeWhat(b, ev, x)}`;
}
// 写进 messages 的系统留言：文字不变，额外带上 ev / x，以后复制群文字时用。snapB 是动作完成后的预约（时间、教室已更新）
function vipNoticeMsg(snapB, text, ev, x) {
  const o = { from: 'system', text, ts: Date.now() };
  if (ev) o.ev = ev, o.x = Object.assign({ snap: vipNoticeSnap(snapB) }, x || {});
  return o;
}
function vipNoticeFindBooking(id) {
  const lists = [typeof cachedTeacherBookings !== 'undefined' ? cachedTeacherBookings : null, typeof cachedBookings !== 'undefined' ? cachedBookings : null, typeof vipBookings !== 'undefined' ? vipBookings : null];
  for (const l of lists) { const b = (l || []).find(r => String(r.id) === String(id)); if (b) return b; }
  return null;
}
// 这节课的所有通知（按时间）：系统留言 + 没写进留言的事件（建立、学生确认、学生取消、完成）
function vipNoticeItems(b) {
  const out = [];
  const msgs = b.messages || [];
  const isSys = m => m && m.from === 'system';
  const toMs = v => { const t = v ? Date.parse(v) : NaN; return isNaN(t) ? 0 : t; };
  const by = vipInitiator(b);
  if (by === 'teacher' || by === 'student') {
    const ts = /^\d{10,}$/.test(String(b.id)) ? +b.id : toMs(b.created_at);
    out.push({ key: 'd_created', ts, ev: by === 'teacher' ? 'teacher_created' : 'student_created', x: {}, derived: true });
  }
  if (by === 'teacher' && b.student_ok === true && !b.ok_by_admin) out.push({ key: 'd_student_ok', ts: toMs(b.student_ok_at), ev: 'student_ok', x: {}, derived: true });
  if (b.status === 'cancelled' && !msgs.some(m => isSys(m) && /^【取消通知】/.test(m.text || '')) && !msgs.some(m => isSys(m) && m.ev === 'cancelled'))
    out.push({ key: 'd_cancelled', ts: toMs(b.cancelled_at), ev: 'cancelled', x: {}, derived: true });
  if (b.status === 'completed' && b.vip_session_notes && !b.teacher_backfill) out.push({ key: 'd_done', ts: Number.MAX_SAFE_INTEGER, ev: 'done', x: {}, derived: true });
  msgs.forEach((m, i) => {
    if (!isSys(m) || m.ev === 'skip') return;
    let ev = m.ev || (/^【取消通知】/.test(m.text || '') ? 'cancelled' : 'raw');
    out.push({ key: 'm' + i, ts: m.ts || 0, ev, x: Object.assign({}, m.x || {}, ev === 'raw' ? { text: String(m.text || '').replace(/^【[^】]*】/, '') } : {}), msg: m });
  });
  out.forEach((it, i) => { it.i = i; });
  out.sort((p, q) => (p.ts - q.ts) || (p.i - q.i));
  out.forEach(it => { it.what = vipNoticeWhat(b, it.ev, it.x); it.text = vipNoticeText(b, it.ev, it.x); });
  return out;
}
// 给界面用的留言列表：原来的留言 + 没写进留言的事件（伪装成系统留言），带 _nk（通知 key）；老师 / 学生的留言没有 _nk
function vipNoticeMerged(b) {
  const msgs = b.messages || [];
  const items = vipNoticeItems(b);
  const map = {}; items.forEach(it => { if (it.msg) map[it.key] = it; });
  const all = msgs.map((m, i) => (m && m.from === 'system' && map['m' + i]) ? Object.assign({}, m, { _nk: 'm' + i }) : m);
  items.filter(it => it.derived).forEach(it => all.push({ from: 'system', text: it.what, ts: it.ts, _nk: it.key }));
  return all.map((m, i) => [m, i]).sort((p, q) => ((p[0].ts || 0) - (q[0].ts || 0)) || (p[1] - q[1])).map(r => r[0]);
}
function vipNoticeEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
// 每条系统通知旁边的小「复制」
function vipNoticeCopyBtn(b, m) {
  if (!m || !m._nk) return '';
  vipNoticeLoadMap();   // 提前读好老师昵称，点复制时不用再等（等了浏览器可能不让复制）
  return ` <button type="button" class="btn btn-outline btn-sm" style="font-size:9px;padding:0 6px;line-height:1.6;margin-left:4px" onclick="vipNoticeCopyOne('${vipNoticeEsc(b.id)}','${m._nk}')">复制</button>`;
}
// 预约卡片上的「复制这节课的记录」
function vipNoticeLogBtn(b) {
  if (!vipNoticeItems(b).length) return '';
  vipNoticeLoadMap();
  return `<button type="button" class="btn btn-outline btn-sm" onclick="vipNoticeCopyLog('${vipNoticeEsc(b.id)}')">复制这节课的记录</button>`;
}
function vipNoticeCopyOne(id, key) {
  const b = vipNoticeFindBooking(id); if (!b) return;
  const it = vipNoticeItems(b).find(r => r.key === key); if (!it) return;
  vipNoticeCopy(it.text);
}
function vipNoticeCopyLog(id) {
  const b = vipNoticeFindBooking(id); if (!b) return;
  const pad = n => String(n).padStart(2, '0');
  const lines = vipNoticeItems(b).map(it => {
    const d = it.ts && it.ts < Number.MAX_SAFE_INTEGER ? new Date(it.ts) : null;
    return (d ? `[${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}] ` : '') + it.text;
  });
  if (!lines.length) { alert('这节课还没有通知'); return; }
  vipNoticeCopy(lines.join('\n'));
}
function vipNoticeCopy(text, btn) {
  const ok = () => { if (btn) { btn.textContent = '已复制'; setTimeout(() => { btn.textContent = '复制文字'; }, 1500); } else alert('已复制'); };
  const fb = () => {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch (_) { alert('复制失败，请手动选中复制'); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fb); else fb();
}
// 动作成功后：显示这次的群文字 + 复制按钮（headline 是原来成功提示的话）
async function vipNoticeModal(b, ev, x, headline) {
  await vipNoticeLoadMap();
  const text = vipNoticeText(b, ev, x);
  document.getElementById('vipNoticeModal')?.remove();
  const m = document.createElement('div');
  m.id = 'vipNoticeModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<div style="background:var(--surface,#fff);border-radius:6px;padding:20px;max-width:460px;width:100%;max-height:90vh;overflow-y:auto">
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">${vipNoticeEsc(headline || '已完成')}</div>
    <div style="font-size:11px;color:var(--text-muted,var(--text-3,#888));margin-bottom:8px">可以复制下面的文字发到群里留记录：</div>
    <textarea id="vipNoticeTa" rows="4" readonly style="width:100%;box-sizing:border-box;font-size:12px;padding:8px;border:1px solid var(--border,#ddd);border-radius:3px">${vipNoticeEsc(text)}</textarea>
    <div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="btn btn-outline btn-sm" id="vipNoticeCopyBtn">复制文字</button><button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('vipNoticeModal').remove()">关闭</button></div></div>`;
  document.body.appendChild(m);
  document.getElementById('vipNoticeCopyBtn').onclick = function () { vipNoticeCopy(document.getElementById('vipNoticeTa').value, this); };
}
