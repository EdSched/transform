// ══════════════════════════════════
// teacher-viproom.js — 老师端「VIP 管理 → 教室预约」：完全承接 sched/vip.html 的「只约教室」流程
// 查空闲 / 就近空档 / 紧急群消息 / 申请大教室，全部复用 teacher.js 里的 vrpLoad、vrpSubmit、vipReqMsg、vipShowReqMsg（不再写一套）
// 写入 sched_bookings（kind='vip'、status='pending'），字段和 vip.html 一致；归属（owner_id）由数据库按登录身份自动记录
// 我的预约：按账号 owner_id 列出，加上 user_name=自己真名的旧记录；预约履历调 rpc/sched_my_bookings_history
// 依赖：teacher.js（VRP、vrpLoad、vrpSubmit、vipLoadRooms、vipReqMsg、vipShowReqMsg、vipIsUrgent、vipAddDays、vipMD、vipLocalToday、vipSchedErr、escapeHtmlVcm）、
//       teacher-vip.js（vipAllowed、teacherVipAssignedStudents、teacherVipMyPlans）、shared/constants.js（chipFold、majorLabel）
// ══════════════════════════════════
const VRM_CAMPUSES = ['高马', '市谷'];
const VRM_TIMES = (function () { const a = []; for (let m = 8 * 60; m < 22 * 60; m += 30) a.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')); return a; })();
const VRM_KIND = { course: '排课', vip: 'VIP', temp: '临时使用', rental: '对外出租', meeting: '开会' };
const VRM = {
  campus: '高马', date: '', st: '18:00', et: '21:00', ppl: '',
  stu: '', major: '', reason: '', note: '', stuId: '',
  searched: false, urgent: false,
  mineTab: 'cur', acc: null, rows: null, rooms: {}, busy: false,
};
const vrmEsc = v => escapeHtmlVcm(v);
// 入口显示条件：和 VIP 相关功能一样（有 VIP 预约 / 时间槽权限，或有指导的 VIP 学生），不要求 vip_backfill
function vrmAllowed() {
  if (typeof vipAllowed === 'function') return vipAllowed();
  const p = (teacherData && teacherData.permissions) || {};
  const perm = (p.booking && (p.booking_types || []).includes('vip')) || (p.slots && (p.slot_types || []).includes('vip'));
  return !!(perm || (typeof teacherVipAssignedStudents !== 'undefined' && teacherVipAssignedStudents.length));
}
const vrmWD = d => '日一二三四五六'[new Date(d + 'T12:00:00').getDay()];
const vrmMin = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : 0; };
const vrmHM = t => String(t || '').slice(0, 5);

// 我的 VIP 学生：学生档案里指派给我的 + 我的 VIP 方案里的（按姓名去重）
function vrmStudents() {
  const out = [], seen = new Set();
  (typeof teacherVipAssignedStudents !== 'undefined' ? teacherVipAssignedStudents : []).forEach(s => { if (s.name && !seen.has(s.name)) { seen.add(s.name); out.push({ id: s.id, name: s.name, major: s.major || '' }); } });
  (typeof teacherVipMyPlans !== 'undefined' ? teacherVipMyPlans : []).forEach(p => { if (p.student_name && !seen.has(p.student_name)) { seen.add(p.student_name); out.push({ id: p.student_id || '', name: p.student_name, major: p.major || '' }); } });
  return out;
}

function vrmMount() {
  const box = document.getElementById('vrmBox'); if (!box) return;
  if (!VRM.date) VRM.date = vipAddDays(vipLocalToday(), 2);
  const sel = (id, list, cur, fn) => `<select id="${id}" onchange="${fn}" style="width:100%">${list.map(t => `<option value="${t}" ${t === cur ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const ends = VRM_TIMES.slice(1).concat(['22:00']);
  box.innerHTML = `
    <div style="font-size:11px;color:var(--text-3);line-height:1.8;margin-bottom:12px">给 VIP 课预约教室。常规预约需<b>提前 2 天</b>，长期或多天预约请联系管理员；2 天内是<b>紧急预约</b>，提交后会生成群消息，必须复制发到群里。须填学生姓名和专业。提交后待管理员确认，可在下方「我的预约」查看 / 取消。</div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px;margin-bottom:12px">
      <div class="form-group"><label class="form-label">校区</label><div style="display:flex;gap:6px;flex-wrap:wrap">${VRM_CAMPUSES.map(c => `<div class="filter-chip${VRM.campus === c ? ' active' : ''}" onclick="vrmSet('campus','${c}')" style="padding:4px 14px;font-size:12px">${c}</div>`).join('')}</div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px">
        <div class="form-group"><label class="form-label">日期</label><input type="date" id="vrm_date" value="${vrmEsc(VRM.date)}" min="${vipLocalToday()}" onchange="VRM.date=this.value;vrmNote()" style="width:100%"></div>
        <div class="form-group"><label class="form-label">开始</label>${sel('vrm_st', VRM_TIMES, VRM.st, "VRM.st=this.value")}</div>
        <div class="form-group"><label class="form-label">结束</label>${sel('vrm_et', ends, VRM.et, "VRM.et=this.value")}</div>
        <div class="form-group"><label class="form-label">人数（可不填）</label><input type="number" id="vrm_ppl" min="1" value="${vrmEsc(VRM.ppl)}" oninput="VRM.ppl=this.value" style="width:100%"></div>
      </div>
      <div id="vrm_note"></div>
      <button class="btn btn-primary btn-sm" onclick="vrmFind()">查空闲</button>
    </div>
    <div id="vrm_res" style="display:${VRM.searched ? 'block' : 'none'}">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px;margin-bottom:12px">
        <div id="vrm_room_box"></div>
        <div id="vrm_form"></div>
      </div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px">当天 VIP 教室占用一览 <span style="font-size:10px;font-weight:400;color:var(--text-3)">${vrmLegend()}</span></div>
      <div id="vrm_grid" style="overflow:auto"></div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <div style="font-size:12px;font-weight:600">我的预约</div>
        <div class="filter-chip${VRM.mineTab === 'cur' ? ' active' : ''}" onclick="vrmMineTab('cur')" style="font-size:11px">当前预约</div>
        <div class="filter-chip${VRM.mineTab === 'hist' ? ' active' : ''}" onclick="vrmMineTab('hist')" style="font-size:11px">预约履历</div>
      </div>
      <div id="vrm_mine"></div>
    </div>`;
  vrmNote();
  if (VRM.searched) { vrpRender('vrm'); vrmFormRender(); }
  vrmGrid();
  vrmLoadMine();
}
function vrmLegend() { return ['vip', 'temp', 'course', 'rental', 'meeting'].map(k => `<span style="margin-left:8px"><i class="vrm-k-${k}" style="display:inline-block;width:10px;height:10px;border:1px solid var(--border);vertical-align:-1px"></i> ${VRM_KIND[k]}</span>`).join(''); }
function vrmSet(k, v) {
  VRM[k] = v;
  if (k === 'campus') { vrmMount(); if (VRM.searched) vrmFind(); }
}
// 2 天内提示
function vrmNote() {
  const b = document.getElementById('vrm_note'); if (!b) return;
  b.innerHTML = VRM.date && vipIsUrgent(VRM.date) ? '<div style="font-size:11px;color:var(--warn);background:var(--warn-bg);border:1px solid #e8d29a;border-radius:3px;padding:6px 10px;margin:2px 0 10px">该日期在 2 天内，属紧急预约。先「查空闲」确认有空教室，提交后会生成群消息，必须复制发到群里。</div>' : '';
}
function vrmFind() {
  const date = VRM.date, s = VRM.st, e = VRM.et;
  if (!date) { alert('请选择日期'); return; }
  if (date < vipLocalToday()) { alert('不能预约过去的日期'); return; }
  if (e <= s) { alert('结束需晚于开始'); return; }
  VRM.searched = true; VRM.urgent = vipIsUrgent(date);
  vrmNote();
  document.getElementById('vrm_res').style.display = 'block';
  vrpLoad('vrm', {
    box: 'vrm_room_box', campus: VRM.campus, date, start: s, end: e, exclude: null, prefer: '', canNear: true,
    minCap: parseInt(VRM.ppl) || 0, onPick: () => vrmFormRender(),
    onNear: (d, ns, ne) => { VRM.date = d; VRM.st = ns; VRM.et = ne; vrmMount(); vrmFind(); },
  }).then(() => vrmFormRender());
  vrmFormRender();
  vrmGrid();
}

// ── 预约表单（讲师只读 / 学生 / 专业 / 用途 / 备注）──
function vrmFormRender() {
  const box = document.getElementById('vrm_form'); if (!box) return;
  const st = VRP.vrm;
  if (!st || st.loading || st.err || !st.pick) { box.innerHTML = ''; return; }
  const stus = vrmStudents();
  const chips = stus.map(s => ({ on: VRM.stu === s.name, html: `<div class="filter-chip${VRM.stu === s.name ? ' active' : ''}" onclick="vrmPickStu('${vrmEsc(s.name).replace(/'/g, '&#39;')}')" style="font-size:11px">${vrmEsc(s.name)}</div>` }));
  const inp = 'width:100%';
  box.innerHTML = `<div style="border-top:1px solid var(--border-light);margin-top:10px;padding-top:12px">
    <div class="form-group"><label class="form-label">讲师</label><input value="${vrmEsc(teacherName)}" readonly style="${inp};background:var(--bg);color:var(--text-2)"></div>
    <div class="form-group"><label class="form-label">学生（点选我的 VIP 学生，或手填）</label>
      ${chips.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${chipFold(chips)}</div>` : ''}
      <input id="vrm_stu" value="${vrmEsc(VRM.stu)}" placeholder="学生姓名 *" oninput="VRM.stu=this.value;VRM.stuId=''" style="${inp}"></div>
    <div class="form-group"><label class="form-label">专业 *（选了学生会自动带出）</label><input id="vrm_major" value="${vrmEsc(VRM.major)}" oninput="VRM.major=this.value" style="${inp}"></div>
    <div class="form-group"><label class="form-label">用途 / 预约理由</label><input id="vrm_reason" value="${vrmEsc(VRM.reason)}" placeholder="如 VIP面试指导" oninput="VRM.reason=this.value" style="${inp}"></div>
    <div class="form-group"><label class="form-label">备注</label><input id="vrm_noteTxt" value="${vrmEsc(VRM.note)}" oninput="VRM.note=this.value" style="${inp}"></div>
    <button id="vrm_ok" class="btn btn-primary btn-sm" onclick="vrmSubmit()">${VRM.urgent ? '提交并生成群消息' : '提交预约'}</button>
  </div>`;
}
function vrmPickStu(name) {
  const s = vrmStudents().find(x => x.name === name); if (!s) return;
  VRM.stu = s.name; VRM.stuId = s.id || '';
  VRM.major = s.major ? ((typeof majorLabel === 'function' ? majorLabel(s.major) : s.major) || s.major) : VRM.major;
  vrmFormRender();
}
async function vrmSubmit() {
  if (VRM.busy) return;
  const vp = VRP.vrm;
  if (!vp || vp.loading) { alert('请先查空闲'); return; }
  if (!vp.pick) { alert('请先选择教室（或点「申请调整到大教室」）'); return; }
  const stu = (VRM.stu || '').trim(), major = (VRM.major || '').trim();
  if (!stu) { alert('请填学生姓名'); return; }
  if (!major) { alert('请填专业 / 事由'); return; }
  if (VRM.date < vipLocalToday()) { alert('不能预约过去的日期'); return; }
  const date = VRM.date, s = VRM.st, e = VRM.et, campus = VRM.campus, reason = (VRM.reason || '').trim();
  const b = { name: stu, major };
  const btn = document.getElementById('vrm_ok'); VRM.busy = true; if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
  let res;
  try { res = await vrpSubmit('vrm', b, date, s, e, reason, campus, { title: reason || null, note: (VRM.note || '').trim() || null }); }
  catch (err) { alert('预约失败：' + vipSchedErr(err)); VRM.busy = false; if (btn) { btn.disabled = false; btn.textContent = VRM.urgent ? '提交并生成群消息' : '提交预约'; } return; }
  VRM.busy = false;
  VRM.stu = ''; VRM.major = ''; VRM.reason = ''; VRM.note = ''; VRM.stuId = '';
  if (res.urgent || res.other) {
    const m = document.createElement('div');
    m.id = 'vrmMsgModal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    m.innerHTML = '<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:460px;width:100%;max-height:90vh;overflow-y:auto"></div>';
    document.body.appendChild(m);
    let text = vipReqMsg(b, date, s, e, campus, res);
    if (reason) text = text.replace(/(专业：[^。]*)。/, '$1；事由：' + reason + '。');   // 和 vip.html 一样带上事由
    vipShowReqMsg('vrmMsgModal', text, res);
  } else alert('已提交！请在下方「我的预约」查看审批状态；如需改时间或取消，请先在那里点「取消」释放教室，再重新预约。');
  VRM.rows = null;
  vrpLoad('vrm', { ...vp.o }).then(() => vrmFormRender());
  vrmFormRender(); vrmGrid(); vrmLoadMine();
}

// ── 当天 VIP 教室占用一览 ──
async function vrmGrid() {
  const box = document.getElementById('vrm_grid'); if (!box) return;
  if (!VRM.date) { box.innerHTML = ''; return; }
  const tok = VRM.campus + VRM.date + Date.now(); VRM.gridTok = tok;
  box.innerHTML = '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  let info;
  try { info = await vipLoadRooms(VRM.campus, VRM.date, '08:00', '22:00'); }
  catch (e) { if (VRM.gridTok === tok) box.innerHTML = `<div style="font-size:11px;color:var(--danger)">读取失败：${vrmEsc(vipSchedErr(e))}</div>`; return; }
  if (VRM.gridTok !== tok) return;
  const rooms = info.rooms;
  if (!rooms.length) { box.innerHTML = '<div style="font-size:11px;color:var(--text-3)">该校区暂无 VIP 教室</div>'; return; }
  const skip = rooms.map(() => 0);
  let h = `<table class="vrm-grid"><thead><tr><th></th>${rooms.map(r => `<th>${vrmEsc(r.name)}<div class="vrm-sub">${r.capacity ? r.capacity + '人' : ''}</div></th>`).join('')}</tr></thead><tbody>`;
  VRM_TIMES.forEach((t, i) => {
    h += `<tr><td class="vrm-t">${t.endsWith(':00') ? t : ''}</td>`;
    rooms.forEach((r, ri) => {
      if (skip[ri] > 0) { skip[ri]--; return; }
      const x = r.conf.find(c => vrmHM(c.start_time) <= t && t < vrmHM(c.end_time));
      if (!x) { h += '<td></td>'; return; }
      let span = 0; for (let j = i; j < VRM_TIMES.length && VRM_TIMES[j] < vrmHM(x.end_time); j++) span++;
      skip[ri] = span - 1;
      h += `<td rowspan="${span}" class="vrm-k-${x.kind || 'temp'}${x.status === 'pending' ? ' vrm-pend' : ''}" title="${vrmEsc(vrmHM(x.start_time) + '-' + vrmHM(x.end_time))}">${vrmEsc(VRM_KIND[x.kind] || '占用')}<div class="vrm-sub">${x.status === 'pending' ? '待确认' : ''}</div></td>`;
    });
    h += '</tr>';
  });
  box.innerHTML = h + '</tbody></table>';
}

// ── 我的预约 ──
function vrmMineTab(t) { VRM.mineTab = t; vrmMount(); }
async function vrmIdentity() {
  if (VRM.acc) return VRM.acc;
  try { const j = await sb('/rest/v1/rpc/sched_my_identity', 'POST', {}); if (j && j.id) VRM.acc = j; } catch (_) {}
  return VRM.acc || (teacherData && teacherData.id ? { id: teacherData.id } : null);
}
async function vrmLoadMine() {
  const box = document.getElementById('vrm_mine'); if (!box) return;
  box.innerHTML = '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  if (VRM.mineTab === 'hist') return vrmLoadHist(box);
  try {
    const acc = await vrmIdentity();
    let rows = acc ? (await sb(`/rest/v1/sched_bookings?kind=eq.vip&owner_id=eq.${encodeURIComponent(acc.id)}&select=*&order=booking_date.desc&limit=100`, 'GET', null, { cache: 'no-store' })) || [] : [];
    const old = (await sb(`/rest/v1/sched_bookings?kind=eq.vip&user_name=eq.${encodeURIComponent(teacherName)}&select=*&order=booking_date.desc&limit=100`, 'GET', null, { cache: 'no-store' })) || [];   // 以前在 vip.html 约的旧记录
    const seen = new Set(rows.map(x => String(x.id))); old.forEach(x => { if (!seen.has(String(x.id))) rows.push(x); });
    rows.sort((a, b) => String(b.booking_date).localeCompare(String(a.booking_date)) || String(b.start_time).localeCompare(String(a.start_time)));
    const rids = [...new Set(rows.map(r => r.room_id).filter(x => x != null))];
    VRM.rooms = {};
    if (rids.length) ((await sb(`/rest/v1/sched_rooms?id=in.(${rids.join(',')})&select=id,name,campus,type`).catch(() => [])) || []).forEach(r => { VRM.rooms[String(r.id)] = r; });
    VRM.rows = rows;
  } catch (e) { box.innerHTML = `<div style="font-size:11px;color:var(--danger)">读取失败：${vrmEsc(e.message)}</div>`; return; }
  if (!document.getElementById('vrm_mine')) return;
  vrmMineRender();
}
function vrmBadge(t, c, bg) { return `<span style="font-size:10px;border-radius:2px;padding:1px 7px;color:${c};background:${bg}">${t}</span>`; }
function vrmMineRender() {
  const box = document.getElementById('vrm_mine'); if (!box) return;
  const rows = VRM.rows || [];
  if (!rows.length) { box.innerHTML = '<div style="font-size:11px;color:var(--text-3)">暂无预约记录</div>'; return; }
  const today = vipLocalToday();
  box.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">${rows.map(b => {
    const room = b.room_id != null ? VRM.rooms[String(b.room_id)] : null, rejected = b.status === 'rejected', past = b.booking_date < today;
    const adjusted = !rejected && room && (!!b.req_campus || (room.type && room.type !== 'VIP'));
    let st;
    if (rejected) st = vrmBadge('已驳回', 'var(--danger)', 'var(--danger-bg)');
    else if (b.req_other && b.room_id == null) st = vrmBadge('其他教室待指派', 'var(--warn)', 'var(--warn-bg)');
    else if (b.status === 'confirmed') st = vrmBadge('已批准', 'var(--ok)', 'var(--ok-bg)');
    else st = vrmBadge('待确认', 'var(--warn)', 'var(--warn-bg)');
    const roomTxt = rejected ? '' : (b.req_other && b.room_id == null ? `${vrmEsc(b.req_campus || '')} · 大教室（待管理员指派）`
      : room ? `${vrmEsc(room.campus)} ${vrmEsc(room.name)}` : '');
    const op = rejected
      ? `<button class="btn btn-primary btn-sm" onclick="vrmRebook('${b.id}')">重新预约</button><button class="btn btn-outline btn-sm" onclick="vrmDrop('${b.id}')">放弃</button>`
      : past ? '<span style="font-size:10px;color:var(--text-3)">已过期</span>'
      : `<button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger)" onclick="vrmCancel('${b.id}')">取消</button>`;
    return `<div style="border:1px solid var(--border);border-radius:4px;padding:10px 12px;background:var(--surface);${rejected || past ? 'opacity:.75;' : ''}">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600">${vipMD(b.booking_date)} ${vrmEsc(vrmHM(b.start_time))}-${vrmEsc(vrmHM(b.end_time))}</span>
        ${b.urgent ? vrmBadge('紧急', '#fff', 'var(--danger)') : ''}${b.req_other ? vrmBadge('其他教室', 'var(--warn)', 'var(--warn-bg)') : ''}${st}
        <span style="margin-left:auto;display:flex;gap:6px">${op}</span></div>
      <div style="font-size:11px;color:var(--text-2);margin-top:4px">${roomTxt}${adjusted ? ` <span style="color:var(--accent);font-weight:600">· 已调整到 ${vrmEsc(room.name)}（${vrmEsc(room.campus)}）</span>` : ''}${b.student_name ? `　学生：${vrmEsc(b.student_name)}` : ''}${b.major ? `　${vrmEsc(b.major)}` : ''}</div>
      ${rejected && b.reject_reason ? `<div style="font-size:11px;color:var(--danger);margin-top:4px;white-space:pre-wrap">驳回原因：${vrmEsc(b.reject_reason)}</div>` : ''}
    </div>`;
  }).join('')}</div>
  <div style="font-size:10px;color:var(--text-3);margin-top:8px;line-height:1.7">待确认 = 等管理员审批，已批准后教室才占用。要改时间或取消：先在这里「取消」释放教室，再重新预约。</div>`;
}
function vrmRebook(id) {
  const b = (VRM.rows || []).find(x => String(x.id) === String(id)); if (!b) return;
  const camp = b.req_campus || ((VRM.rooms[String(b.room_id)] || {}).campus) || VRM.campus;
  if (VRM_CAMPUSES.includes(camp)) VRM.campus = camp;
  if (b.booking_date && b.booking_date >= vipLocalToday()) VRM.date = b.booking_date;
  if (VRM_TIMES.includes(vrmHM(b.start_time))) VRM.st = vrmHM(b.start_time);
  if (vrmMin(b.end_time) > vrmMin(VRM.st)) VRM.et = vrmHM(b.end_time);
  VRM.stu = b.student_name || ''; VRM.major = b.major || ''; VRM.reason = b.title || ''; VRM.note = b.note || '';
  vrmMount(); vrmFind();
  document.getElementById('vrmBox')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function vrmRelease(id) {
  const b = (VRM.rows || []).find(x => String(x.id) === String(id));
  if (b) { try { await sb(`/rest/v1/sched_bookings?id=eq.${encodeURIComponent(id)}`, 'PATCH', { last_actor: teacherName, last_actor_at: new Date().toISOString() }); } catch (_) {} }   // 操作记录里写上是谁取消的
  await sb(`/rest/v1/sched_bookings?id=eq.${encodeURIComponent(id)}`, 'DELETE');
}
async function vrmCancel(id) {
  if (!confirm('确定取消这条预约？取消后教室将释放。')) return;
  try { await vrmRelease(id); } catch (e) { alert('取消失败：' + vipSchedErr(e)); return; }
  if (VRP.vrm && VRP.vrm.o) vrpLoad('vrm', { ...VRP.vrm.o }).then(() => vrmFormRender());
  vrmGrid(); vrmLoadMine();
}
async function vrmDrop(id) {
  if (!confirm('放弃这条被驳回的记录？')) return;
  try { await vrmRelease(id); } catch (e) { alert('操作失败：' + vipSchedErr(e)); return; }
  vrmLoadMine();
}

// ── 预约履历（rpc/sched_my_bookings_history，和 vip.html 的履历同一份）──
const VRM_ACT = { create: '提交', approve: '批准', reject: '驳回', edit: '修改', cancel: '取消' };
const VRM_FIELD = { booking_date: '日期', start_time: '开始', end_time: '结束', room_id: '教室', status: '状态', student_name: '学生', major: '专业', title: '事由', note: '备注', user_name: '讲师', reject_reason: '驳回理由', req_other: '其他教室申请', urgent: '紧急' };
function vrmChg(c) {
  if (!c) return '';
  const val = (k, v) => { if (v == null || v === '') return '空'; if (k === 'room_id') { const r = VRM.rooms[String(v)]; return r ? r.campus + ' ' + r.name : '#' + v; } if (typeof v === 'boolean') return v ? '是' : '否'; return String(v); };
  return Object.keys(c).filter(k => VRM_FIELD[k]).map(k => VRM_FIELD[k] + '：' + val(k, c[k].from) + ' → ' + val(k, c[k].to)).join('；');
}
async function vrmLoadHist(box) {
  let rows;
  try {
    rows = (await sb('/rest/v1/rpc/sched_my_bookings_history', 'POST', {}, { cache: 'no-store' })) || [];
    rows = rows.filter(x => x.kind === 'vip');
    const rids = [...new Set(rows.map(r => r.room_id).filter(x => x != null && !VRM.rooms[String(x)]))];
    if (rids.length) ((await sb(`/rest/v1/sched_rooms?id=in.(${rids.join(',')})&select=id,name,campus,type`).catch(() => [])) || []).forEach(r => { VRM.rooms[String(r.id)] = r; });
  } catch (e) { box.innerHTML = `<div style="font-size:11px;color:var(--danger)">读取失败：${vrmEsc(e.message)}</div>`; return; }
  if (!document.getElementById('vrm_mine')) return;
  if (!rows.length) { box.innerHTML = '<div style="font-size:11px;color:var(--text-3)">暂无预约履历</div>'; return; }
  const at = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const col = a => a === 'reject' ? ['var(--danger)', 'var(--danger-bg)'] : a === 'cancel' ? ['var(--warn)', 'var(--warn-bg)'] : ['var(--ok)', 'var(--ok-bg)'];
  box.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">${rows.map(x => {
    const room = x.room_name ? `${vrmEsc(x.room_campus || '')} ${vrmEsc(x.room_name)}` : (x.room_campus ? `${vrmEsc(x.room_campus)} · 待指派大教室` : '');
    const note = x.action === 'reject' && x.reject_reason ? `<span style="color:var(--danger)">理由：${vrmEsc(x.reject_reason)}</span>` : x.action === 'edit' ? vrmEsc(vrmChg(x.changes)) : '';
    return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:7px 10px;font-size:11px;line-height:1.7">
      <span style="color:var(--text-3)">${at(x.at)}</span> ${vrmBadge(VRM_ACT[x.action] || vrmEsc(x.action), col(x.action)[0], col(x.action)[1])}
      <b>${vrmEsc(x.booking_date || '')} ${vrmEsc(vrmHM(x.start_time))}-${vrmEsc(vrmHM(x.end_time))}</b> ${room}${x.student_name ? `　学生：${vrmEsc(x.student_name)}` : ''}　<span style="color:var(--text-3)">操作人：${vrmEsc(x.actor || '—')}</span>
      ${note ? `<div style="color:var(--text-2)">${note}</div>` : ''}</div>`;
  }).join('')}</div><div style="font-size:10px;color:var(--text-3);margin-top:6px">最近 100 条，按时间倒序。</div>`;
}
