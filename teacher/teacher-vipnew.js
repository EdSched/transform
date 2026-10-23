// ══════════════════════════════════
// teacher-vipnew.js — 老师自己发起一节 VIP 课（「VIP 管理」页「＋ 新建 VIP 课」）
// 流程：老师发起 → 学生确认 → 这节课成立（教务只是知情和兜底）。生成给学生的提醒文字，方便沟通，不是额外手续。
// 线下课当场约教室：直接用 teacher.js 的 vrpLoad / vrpSubmit（普通 / 紧急 / 就近空档 / 申请大教室，规则不变，写 sched_bookings pending，由总务批）。线上课不约教室。
// 写入 bookings：type='vip'、initiated_by='teacher'、teacher_ok=true、student_ok=false、status='pending'（SQL：seed/vip_self_booking_v2.sql）
// 依赖：teacher.js（vrpLoad、vrpSubmit、vrgRender、vipReqMsg、vipSchedRelease、vipLoadSchedInfo、vipTimeParts、vipIsUrgent、vipCampusOf、escapeHtmlVcm）、
//       teacher-vip.js（teacherVipAssignedStudents）、shared/vip-booking.js（vipStudentRemindText）、shared/constants.js（chipFold、majorLabel）
// ══════════════════════════════════
const VNB_LOCS = [['offline_takadanobaba', '线下 · 高田马场'], ['offline_ichigaya', '线下 · 市谷'], ['online', '线上']];
let vnbSt = null;   // { stuId, q, date, st, en, loc, note, busy }
const vnbEsc = v => escapeHtmlVcm(v);
const vnbMin = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const vnbToday = () => (typeof vipLocalToday === 'function' ? vipLocalToday() : new Date().toISOString().slice(0, 10));
const vnbIsOffline = loc => !!loc && loc.startsWith('offline');
// 我的 VIP 学生（要有 id：写预约要带 student_id）
function vnbStudents() { return (typeof teacherVipAssignedStudents !== 'undefined' ? teacherVipAssignedStudents : []).filter(s => s && s.id && s.name); }
const vnbStu = () => vnbStudents().find(s => String(s.id) === String(vnbSt && vnbSt.stuId)) || null;

function vnbOpen() {
  vnbSt = { stuId: '', q: '', date: '', st: '', en: '', loc: '', note: '', busy: false };
  document.getElementById('vnbModal')?.remove();
  const m = document.createElement('div');
  m.id = 'vnbModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:520px;width:100%;max-height:92vh;overflow-y:auto">
    <div style="font-size:14px;font-weight:600;margin-bottom:4px">新建 VIP 课</div>
    <div style="font-size:11px;color:var(--text-3);line-height:1.7;margin-bottom:12px">你来约时间，学生确认后这节课就成立。提交后会生成一段给学生的提醒文字，复制发给学生即可。线下课在这里直接约教室（2 天内为紧急预约，VIP 教室满了可以申请大教室，都由总务批准）。</div>
    <div class="form-group"><label class="form-label">学生</label><div id="vnb_stu"></div></div>
    <div style="display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:8px">
      <div class="form-group"><label class="form-label">日期</label><input type="date" id="vnb_date" min="${vnbToday()}" onchange="vnbSt.date=this.value;vnbRefresh()"></div>
      <div class="form-group"><label class="form-label">开始</label>${timeInputHtml('vnb_st', '', '如 14:00', { onch: "vnbSt.st=parseTimeInput(this.value)||'';vnbRefresh()", role: 'start', mate: 'vnb_en', btn: 'vnb_ok' })}</div>
      <div class="form-group"><label class="form-label">结束</label>${timeInputHtml('vnb_en', '', '如 16:00', { onch: "vnbSt.en=parseTimeInput(this.value)||'';vnbRefresh()", role: 'end', mate: 'vnb_st', btn: 'vnb_ok' })}</div>
    </div>
    <div class="form-group"><label class="form-label">上课方式</label><div id="vnb_loc" style="display:flex;gap:6px;flex-wrap:wrap"></div></div>
    <div class="form-group" id="vnb_room_wrap" style="display:none"><label class="form-label">教室（提交后进排课系统，待总务批准）</label>
      <div id="vnb_room_box"></div>
      <details style="margin-top:8px"><summary style="font-size:11px;color:var(--text-2);cursor:pointer">查看当天教室安排（点空格子可改时间 / 教室）</summary><div id="vnb_grid" style="margin-top:6px"></div></details>
    </div>
    <div class="form-group"><label class="form-label">备注（可不填）</label><input id="vnb_note" oninput="vnbSt.note=this.value" placeholder="例：面试对策"></div>
    <div id="vnb_msg" style="font-size:11px;color:var(--danger);min-height:14px;margin-bottom:6px"></div>
    <div style="display:flex;gap:8px">
      <button id="vnb_ok" class="btn btn-primary btn-sm" onclick="vnbSubmit()">提交</button>
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('vnbModal').remove()">取消</button>
    </div></div>`;
  document.body.appendChild(m);
  vnbRenderStu(); vnbRenderLoc();
}
const vnbChip = (on, label, fn) => `<span onclick="${fn}" style="cursor:pointer;user-select:none;font-size:12px;border-radius:14px;padding:4px 14px;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'transparent'};color:${on ? '#fff' : 'var(--text-2)'}">${label}</span>`;
function vnbRenderStu() {
  const box = document.getElementById('vnb_stu'); if (!box) return;
  const q = vnbSt.q.trim(), all = vnbStudents().filter(s => !q || s.name.includes(q));
  const s = vnbStu(), rem = x => Math.round(((parseFloat(x.vip_hours_total) || 0) - (parseFloat(x.vip_hours_used) || 0)) * 100) / 100;
  box.innerHTML = `${vnbStudents().length > 8 ? `<input value="${vnbEsc(vnbSt.q)}" oninput="vnbSt.q=this.value;vnbRenderStu()" placeholder="搜索学生姓名" style="width:100%;margin-bottom:6px">` : ''}
    <div style="display:flex;gap:6px;flex-wrap:wrap">${all.length ? chipFold(all.map(x => ({ on: String(x.id) === String(vnbSt.stuId), html: vnbChip(String(x.id) === String(vnbSt.stuId), vnbEsc(x.name), `vnbPickStu('${vnbEsc(x.id)}')`) }))) : '<span style="font-size:11px;color:var(--text-3)">没有可选的学生（只能选学生档案「VIP 指导老师」里有你的学生）</span>'}</div>
    ${s ? `<div style="font-size:11px;color:var(--text-3);margin-top:4px">${vnbEsc(s.name)}　${vnbEsc((typeof majorLabel === 'function' ? majorLabel(s.major) : s.major) || '')}　剩余课时 ${rem(s)}（已用 ${s.vip_hours_used || 0} / 总 ${s.vip_hours_total || 0}）</div>` : ''}`;
}
function vnbPickStu(id) { vnbSt.stuId = id; vnbRenderStu(); }
function vnbRenderLoc() {
  const box = document.getElementById('vnb_loc'); if (!box) return;
  box.innerHTML = VNB_LOCS.map(([k, l]) => vnbChip(vnbSt.loc === k, l, `vnbSt.loc='${k}';vnbRenderLoc();vnbRefresh()`)).join('');
}
// 日期 / 时间 / 方式变了：线下 → 重新查教室和当天教室安排
function vnbRefresh() {
  const wrap = document.getElementById('vnb_room_wrap'); if (!wrap) return;
  const off = vnbIsOffline(vnbSt.loc);
  wrap.style.display = off ? '' : 'none';
  if (!off) { VRP.vnb = null; return; }
  const { date, st, en } = vnbSt, box = document.getElementById('vnb_room_box'), campus = vipCampusOf(vnbSt.loc);
  if (!date || !st || !en || vnbMin(st) >= vnbMin(en)) { VRP.vnb = null; if (box) box.innerHTML = '<div style="font-size:11px;color:var(--text-3)">请先填好日期和起止时间</div>'; document.getElementById('vnb_grid').innerHTML = ''; return; }
  vrgRender('vnb_grid', campus, date, { start: st, end: en, onCell: (rid, t) => vnbCell(rid, t) });
  return vrpLoad('vnb', { box: 'vnb_room_box', campus, date, start: st, end: en, exclude: null, prefer: '', canNear: true,
    onNear: (d, a, c) => { vnbSetWhen(d, a, c); vnbRefresh(); } });
}
function vnbSetWhen(d, a, c) {
  vnbSt.date = d; vnbSt.st = a; vnbSt.en = c;
  document.getElementById('vnb_date').value = d; setTimeInput('vnb_st', a); setTimeInput('vnb_en', c);
}
// 点当天教室安排里的空格子：改成这个时间（保持时长）并选中那间教室
async function vnbCell(roomId, t) {
  const dur = vnbSt.st && vnbSt.en && vnbMin(vnbSt.en) > vnbMin(vnbSt.st) ? vnbMin(vnbSt.en) - vnbMin(vnbSt.st) : 60;
  const e = Math.min(vnbMin(t) + dur, 23 * 60);
  vnbSetWhen(vnbSt.date, t, String(Math.floor(e / 60)).padStart(2, '0') + ':' + String(e % 60).padStart(2, '0'));
  await vnbRefresh();
  const vp = VRP.vnb;
  if (vp && !vp.loading && vp.free && vp.free.some(r => String(r.id) === String(roomId))) { vp.pick = String(roomId); vrpRender('vnb'); }
}

async function vnbSubmit() {
  if (vnbSt.busy) return;
  const msg = document.getElementById('vnb_msg'), s = vnbStu(), { date, st, en, loc } = vnbSt;
  const bad = t => { msg.textContent = t; };
  if (!s) return bad('请选择学生');
  if (!date) return bad('请选择日期');
  if (date < vnbToday()) return bad('日期不能早于今天');
  if (!st || !en) return bad('请填写开始和结束时间（如 14:00）');
  if (vnbMin(en) <= vnbMin(st)) return bad('下课时间要晚于上课时间');
  if (!loc) return bad('请选择上课方式');
  const off = vnbIsOffline(loc), vp = off ? VRP.vnb : null;
  if (off && (!vp || vp.loading)) return bad('教室还在查询，请稍等');
  if (off && !vp.pick) return bad('线下课请选择教室（VIP 满了可以申请大教室）');
  msg.textContent = '';
  const range = `${st}–${en}`, hours = (vnbMin(en) - vnbMin(st)) / 60;
  vnbSt.busy = true; const btn = document.getElementById('vnb_ok'); btn.disabled = true; btn.textContent = '提交中…';
  const fail = t => { vnbSt.busy = false; btn.disabled = false; btn.textContent = '提交'; msg.textContent = t; };
  // 提示（不挡）：课时不够 / 自己同一时段已有 VIP 课（课时口径同学生端 vipBookCheck：剩余课时 − 已预约未上的时长）
  const warns = [];
  try {
    const rows = await sb(`/rest/v1/bookings?student_id=eq.${encodeURIComponent(s.id)}&type=eq.vip&status=in.(pending,confirmed)&teacher_backfill=is.false&select=slot_date,slot_time_range,vip_hours_used,vip_session_notes`, 'GET', null, { cache: 'no-store' }).catch(() => null);
    if (Array.isArray(rows)) {
      const booked = rows.filter(b => !(parseFloat(b.vip_hours_used) > 0) && !b.vip_session_notes).reduce((t, b) => { const p = vipTimeParts(b.slot_time_range); return t + (p ? Math.max(0, vnbMin(p[1]) - vnbMin(p[0])) / 60 : 0); }, 0);
      const can = Math.round(((parseFloat(s.vip_hours_total) || 0) - (parseFloat(s.vip_hours_used) || 0) - booked) * 100) / 100;
      if (hours > can) warns.push(`课时不够：${s.name} 还可以约 ${can} 小时，这次 ${hours} 小时`);
      if (rows.some(b => { const p = vipTimeParts(b.slot_time_range); return b.slot_date === date && p && vnbMin(p[0]) < vnbMin(en) && vnbMin(st) < vnbMin(p[1]); })) warns.push(`${s.name} 这个时间已经有预约了`);
    }
    const mine = (typeof cachedTeacherBookings !== 'undefined' ? cachedTeacherBookings : []).filter(b => b.type === 'vip' && ['pending', 'confirmed'].includes(b.status) && b.slot_date === date);
    mine.forEach(b => { const p = vipTimeParts(b.slot_time_range); if (p && vnbMin(p[0]) < vnbMin(en) && vnbMin(st) < vnbMin(p[1])) warns.push(`你在这个时段已有另一节 VIP 课：${b.name} ${b.slot_time_range}`); });
  } catch (_) {}
  if (warns.length && !confirm(warns.join('\n') + '\n\n仍然提交吗？')) { fail(''); return; }
  // ① 线下：先占教室（冲突由数据库触发器拦下）
  const pseudo = { name: s.name, major: s.major || '', student_id: s.id };
  let sres = null;
  if (off) {
    try { sres = await vrpSubmit('vnb', pseudo, date, st, en, (vnbSt.note || '').trim(), vipCampusOf(loc)); }
    catch (e) { fail('教室预约失败：' + vipSchedErr(e)); return; }
  }
  // ② 写预约
  const row = {
    id: String(Date.now()), name: s.name, major: s.major || '', student_id: s.id, type: 'vip', slot_id: null, slot_date: date, slot_time_range: range,
    assigned_teacher: teacherName, location: loc, duration: null, status: 'pending', needs: (vnbSt.note || '').trim(),
    initiated_by: 'teacher', teacher_ok: true, student_ok: false, self_booked: false,
    vip_room: sres ? sres.roomName : '', sched_booking_id: sres ? sres.schedId : null,
  };
  try { await sb('/rest/v1/bookings', 'POST', row); }
  catch (e) {
    if (sres && sres.createdNow) await vipSchedRelease({ sched_booking_id: sres.schedId });   // 预约没写成功，释放刚占的教室
    fail('提交失败：' + (/initiated_by|student_ok|teacher_ok_at/.test(e.message || '') ? '系统还没开通「VIP 自助预约」，请联系管理员' : e.message)); return;
  }
  row.teacher_ok_at = new Date().toISOString();
  if (typeof cachedTeacherBookings !== 'undefined') cachedTeacherBookings.push(row);
  vnbSt.busy = false;
  await vipLoadSchedInfo().catch(() => {});
  if (typeof renderTab === 'function') renderTab();
  vnbShowText(row, sres, pseudo);
}

// 提交后：给学生的提醒文字（+ 紧急 / 大教室要发群的文字），带复制按钮
function vnbCopy(id) {
  const ta = document.getElementById(id); if (!ta) return;
  const done = () => alert('已复制');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); try { document.execCommand('copy'); done(); } catch (_) {} });
  else { ta.select(); try { document.execCommand('copy'); done(); } catch (_) { alert('复制失败，请手动选中复制'); } }
}
function vnbShowText(b, sres, pseudo) {
  document.getElementById('vnbModal')?.remove();
  const m = document.createElement('div');
  m.id = 'vnbModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  const box = (id, title, text, warn) => `<div style="margin-bottom:12px">
    <div style="font-size:12px;font-weight:600;margin-bottom:4px">${title}</div>
    ${warn ? `<div style="font-size:11px;color:#a0521a;background:#fdf1e6;border:1px solid #e8c9a8;border-radius:3px;padding:6px 8px;margin-bottom:6px">${warn}</div>` : ''}
    <textarea id="${id}" rows="4" readonly style="width:100%;font-size:12px">${vnbEsc(text)}</textarea>
    <button class="btn btn-outline btn-sm" style="margin-top:4px" onclick="vnbCopy('${id}')">复制</button></div>`;
  const reqMsg = sres && (sres.urgent || sres.other) ? vipReqMsg(pseudo, b.slot_date, b.slot_time_range.split('–')[0], b.slot_time_range.split('–')[1], vipCampusOf(b.location), sres) : '';
  m.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:480px;width:100%;max-height:92vh;overflow-y:auto">
    <div style="font-size:14px;font-weight:600;margin-bottom:10px">已提交，等学生确认</div>
    ${box('vnb_t_stu', '通知文字（可以发到群里留记录，也可以发给学生）', vipStudentRemindText(b, sres ? sres.roomName : ''))}
    ${reqMsg ? box('vnb_t_grp', sres.other ? '大教室申请 · 请复制发到群里' : '紧急预约 · 请复制发到群里', reqMsg, sres.urgent ? '必须把这段发到群里，否则总务会驳回。' : '把这段发到群里，周知总务安排大教室。') : ''}
    <button class="btn btn-primary btn-sm" onclick="document.getElementById('vnbModal').remove()">完成</button></div>`;
  document.body.appendChild(m);
}
// 预约卡片上的「复制提醒文字」
function vnbRemindOpen(id) {
  const b = (typeof cachedTeacherBookings !== 'undefined' ? cachedTeacherBookings : []).find(x => x.id === id); if (!b) return;
  document.getElementById('vnbModal')?.remove();
  const m = document.createElement('div');
  m.id = 'vnbModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:460px;width:100%">
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">通知文字（可以发到群里留记录）</div>
    <textarea id="vnb_t_stu" rows="4" readonly style="width:100%;font-size:12px">${vnbEsc(vipStudentRemindText(b))}</textarea>
    <div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-primary btn-sm" onclick="vnbCopy('vnb_t_stu')">复制</button><button class="btn btn-outline btn-sm" onclick="document.getElementById('vnbModal').remove()">关闭</button></div></div>`;
  document.body.appendChild(m);
}
