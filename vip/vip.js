// ── VIP 学生页面 ──
function locationLong(loc) {
  if (!loc || loc === 'online') return '';
  if (loc === 'offline_takadanobaba') return '线下 · 高田马场';
  if (loc === 'offline_ichigaya') return '线下 · 市谷';
  if (loc === 'both_takadanobaba') return '线上 / 线下均可 · 高田马场';
  if (loc === 'both_ichigaya') return '线上 / 线下均可 · 市谷';
  return '';
}
function locationColor(loc) {
  if (!loc || loc === 'online') return '#2a6aad';
  if (loc.startsWith('both')) return '#2a7a4a';
  return '#2a6aad';
}

const STORAGE_KEY_VIP = 'txe_vip_login';
const VIP_MSG_LIMIT = 30;
const STORAGE_DAYS_VIP = 30;

let vipStudent = null; // 登录后的学生档案 {id,name,student_code,vip_hours_total,vip_hours_used,vip_teachers,...}
let vipSlots = [];     // 该学生绑定的老师开放的VIP时间槽
let vipBookings = [];  // 该学生的VIP预约记录
let vipSelectedSlotId = null;

function saveVipLogin(name, code) {
  localStorage.setItem(STORAGE_KEY_VIP, JSON.stringify({ name, code, ts: Date.now() }));
}
function loadVipLogin() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_VIP);
    if (!raw) return null;
    const info = JSON.parse(raw);
    if (Date.now() - info.ts > STORAGE_DAYS_VIP * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY_VIP);
      return null;
    }
    return info;
  } catch { return null; }
}
function clearVipLogin() {
  localStorage.removeItem(STORAGE_KEY_VIP);
  vipStudent = null;
  renderVipLogin();
}

async function initVip() {
  const saved = loadVipLogin();
  if (saved) {
    const ok = await vipLogin(saved.name, saved.code, true);
    if (ok) return;
  }
  renderVipLogin();
}

function renderVipLogin() {
  document.getElementById('mainWrap').innerHTML = `
  <div class="card">
    <div class="card-title">VIP课程查询</div>
    <div class="form-group"><label class="form-label">姓名 <span class="required">*</span></label>
      <input type="text" id="vip_login_name" placeholder="请输入中文真实姓名"></div>
    <div class="form-group"><label class="form-label">查询码 <span class="required">*</span></label>
      <input type="text" id="vip_login_code" placeholder="请输入查询码" style="text-transform:uppercase"></div>
    <div id="vip_login_error" style="font-size:11px;color:var(--danger);margin-bottom:8px"></div>
    <button class="btn btn-primary btn-full" onclick="handleVipLoginClick()">登录查询 →</button>
    <div style="font-size:10px;color:var(--text-muted);margin-top:10px;line-height:1.6">查询码由老师/管理员提供，凭真实姓名+查询码登录。</div>
  </div>`;
}

async function handleVipLoginClick() {
  const name = document.getElementById('vip_login_name').value.trim();
  const code = document.getElementById('vip_login_code').value.trim().toUpperCase();
  const errEl = document.getElementById('vip_login_error');
  if (!name || !code) { errEl.textContent = '请填写姓名和查询码'; return; }
  errEl.textContent = '查询中…';
  const ok = await vipLogin(name, code, false);
  if (!ok) errEl.textContent = '未找到匹配的学生信息，请确认姓名和查询码是否正确';
}

async function vipLogin(name, code, silent) {
  try {
    const students = await sb(`/rest/v1/students?name=eq.${encodeURIComponent(name)}&student_code=eq.${encodeURIComponent(code)}&select=*`);
    if (!students.length) return false;
    const s = students[0];
    if (!(s.is_vip_course === 'VIP' || s.is_vip_course === '大课+VIP')) {
      if (!silent) document.getElementById('vip_login_error').textContent = '该学生档案未开通VIP课程';
      return false;
    }
    vipStudent = s;
    saveVipLogin(name, code);
    await loadVipData();
    renderVipMain();
    return true;
  } catch (e) {
    if (!silent) document.getElementById('vip_login_error').textContent = '查询失败：' + e.message;
    return false;
  }
}

async function loadVipData() {
  const teachers = vipStudent.vip_teachers || [];
  if (!teachers.length) { vipSlots = []; vipBookings = []; return; }
  const today = new Date().toISOString().slice(0, 10);
  const teacherFilter = teachers.map(t => `"${t}"`).join(',');
  const [slots, bookings] = await Promise.all([
    sb(`/rest/v1/slots?teacher_name=in.(${teacherFilter})&type=cs.{vip}&date=gte.${today}&or=(locked.is.null,locked.is.false)&select=*&order=date.asc,time_range.asc`).catch(() => []),
    sb(`/rest/v1/bookings?name=eq.${encodeURIComponent(vipStudent.name)}&type=eq.vip&select=*&order=slot_date.desc`).catch(() => [])
  ]);
  vipSlots = slots;
  vipBookings = bookings;
}


// ── 学生档案卡片 ──
function renderVipProfileCard() {
  const s = vipStudent;
  const missing = [];
  if (!s.japanese_score) missing.push('日语成绩');
  if (!s.english_score) missing.push('英语成绩');
  if (!s.university) missing.push('出身大学');

  const rows = [
    ['专业', MAJORS[s.major] || s.major || ''],
    ['日语成绩', s.japanese_score || ''],
    ['英语成绩', s.english_score || ''],
    ['出身大学', s.university || ''],
    ['学部/专业', s.faculty || ''],
    ['毕业时间', s.graduation_date || ''],
    ['入学目标', s.target_enrollment || ''],
  ].filter(([,v]) => v);

  return `<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="card-title" style="margin:0">📋 我的档案</div>
      <button onclick="openVipProfileEdit()" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:3px 10px;cursor:pointer;font-family:inherit;color:var(--text-secondary)">编辑</button>
    </div>
    ${missing.length ? `<div style="font-size:11px;background:var(--warn-bg,#fff8e1);border:1px solid var(--warn,#e6a817);border-radius:3px;padding:8px 10px;margin-bottom:10px;color:var(--warn,#b45309)">⚠ 以下信息尚未填写：${missing.join('、')}，请点击「编辑」补充</div>` : ''}
    ${rows.length ? `<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px">
      ${rows.map(([l,v]) => `<div style="color:var(--text-muted);white-space:nowrap">${l}</div><div>${v}</div>`).join('')}
    </div>` : `<div style="font-size:12px;color:var(--text-muted)">暂无信息，请点击「编辑」填写</div>`}
  </div>`;
}

// ── 考学进度卡片 ──
function renderVipProgressCard() {
  const s = vipStudent;
  const p = s.progress || {};
  const progressItems = [
    ['目标学校', p.target_schools],
    ['计划书进展', p.plan_status],
    ['出愿进度', p.apply_status],
    ['面试准备', p.interview_status],
  ].filter(([,v]) => v);

  const missing = [];
  if (!p.target_schools) missing.push('目标学校');
  if (!p.plan_status) missing.push('计划书进展');

  return `<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="card-title" style="margin:0">📊 考学进度</div>
      <button onclick="openVipProgressEdit()" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:3px 10px;cursor:pointer;font-family:inherit;color:var(--text-secondary)">更新</button>
    </div>
    ${missing.length ? `<div style="font-size:11px;background:var(--warn-bg,#fff8e1);border:1px solid var(--warn,#e6a817);border-radius:3px;padding:8px 10px;margin-bottom:10px;color:var(--warn,#b45309)">⚠ 建议填写：${missing.join('、')}</div>` : ''}
    ${progressItems.length ? `<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px">
      ${progressItems.map(([l,v]) => `<div style="color:var(--text-muted);white-space:nowrap">${l}</div><div>${v}</div>`).join('')}
    </div>` : `<div style="font-size:12px;color:var(--text-muted)">暂未填写考学进度，请点击「更新」</div>`}
  </div>`;
}

// ── 编辑档案 modal ──
function openVipProfileEdit() {
  const s = vipStudent;
  const existing = document.getElementById('vipProfileEditModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'vipProfileEditModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';
  modal.innerHTML = `
    <div style="background:var(--surface,#fff);border-radius:6px;padding:20px;max-width:400px;width:100%;margin:auto">
      <div style="font-size:14px;font-weight:600;margin-bottom:14px">编辑我的档案</div>
      <div class="form-group"><label class="form-label">日语成绩</label><input id="vpe_japanese" value="${s.japanese_score||''}" placeholder="例：N1 160 / EJU 290"></div>
      <div class="form-group"><label class="form-label">英语成绩</label><input id="vpe_english" value="${s.english_score||''}" placeholder="例：TOEFL 90 / IELTS 6.5"></div>
      <div class="form-group"><label class="form-label">出身大学</label><input id="vpe_university" value="${s.university||''}"></div>
      <div class="form-group"><label class="form-label">学部/专业</label><input id="vpe_faculty" value="${s.faculty||''}"></div>
      <div class="form-group"><label class="form-label">毕业时间</label><input id="vpe_graduation" value="${s.graduation_date||''}" placeholder="例：25年6月"></div>
      <div class="form-group"><label class="form-label">入学目标</label><input id="vpe_enrollment" value="${s.target_enrollment||''}" placeholder="例：27年4月"></div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button onclick="saveVipProfile()" style="flex:1;background:var(--accent,#3a2e24);color:#fff;border:none;border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">保存</button>
        <button onclick="document.getElementById('vipProfileEditModal').remove()" style="flex:1;background:none;border:1px solid var(--border);border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function saveVipProfile() {
  const patch = {
    japanese_score: document.getElementById('vpe_japanese').value.trim(),
    english_score: document.getElementById('vpe_english').value.trim(),
    university: document.getElementById('vpe_university').value.trim(),
    faculty: document.getElementById('vpe_faculty').value.trim(),
    graduation_date: document.getElementById('vpe_graduation').value.trim(),
    target_enrollment: document.getElementById('vpe_enrollment').value.trim(),
  };
  try {
    await sb(`/rest/v1/students?id=eq.${vipStudent.id}`, 'PATCH', patch);
    Object.assign(vipStudent, patch);
    document.getElementById('vipProfileEditModal').remove();
    renderVipMain();
  } catch(e) { alert('保存失败：' + e.message); }
}

// ── 编辑考学进度 modal ──
function openVipProgressEdit() {
  const p = vipStudent.progress || {};
  const existing = document.getElementById('vipProgressEditModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'vipProgressEditModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';
  modal.innerHTML = `
    <div style="background:var(--surface,#fff);border-radius:6px;padding:20px;max-width:400px;width:100%;margin:auto">
      <div style="font-size:14px;font-weight:600;margin-bottom:14px">更新考学进度</div>
      <div class="form-group"><label class="form-label">目标学校</label><textarea id="vpg_schools" rows="2" placeholder="例：东京大学社会学、一桥大学経済学">${p.target_schools||''}</textarea></div>
      <div class="form-group"><label class="form-label">计划书进展</label>
        <select id="vpg_plan">
          <option value="">请选择</option>
          ${['未开始','在收集材料','遇到困难','撰写中','待修改','已完成'].map(v=>`<option${p.plan_status===v?' selected':''}>${v}</option>`).join('')}
        </select></div>
      <div class="form-group"><label class="form-label">出愿进度</label>
        <select id="vpg_apply">
          <option value="">请选择</option>
          ${['未开始','准备材料中','出愿中','已出愿'].map(v=>`<option${p.apply_status===v?' selected':''}>${v}</option>`).join('')}
        </select></div>
      <div class="form-group"><label class="form-label">面试准备</label>
        <select id="vpg_interview">
          <option value="">请选择</option>
          ${['未开始','面试稿撰写中','模拟面试中','已完成面试稿'].map(v=>`<option${p.interview_status===v?' selected':''}>${v}</option>`).join('')}
        </select></div>
      <div class="form-group"><label class="form-label">联系教授情况</label>
        <select id="vpg_prof">
          <option value="">请选择</option>
          ${['未选定教授','写邮件中','已联系'].map(v=>`<option${p.contact_prof===v?' selected':''}>${v}</option>`).join('')}
        </select></div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button onclick="saveVipProgress()" style="flex:1;background:var(--accent,#3a2e24);color:#fff;border:none;border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">保存</button>
        <button onclick="document.getElementById('vipProgressEditModal').remove()" style="flex:1;background:none;border:1px solid var(--border);border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function saveVipProgress() {
  const progress = {
    ...(vipStudent.progress || {}),
    target_schools: document.getElementById('vpg_schools').value.trim(),
    plan_status: document.getElementById('vpg_plan').value,
    apply_status: document.getElementById('vpg_apply').value,
    interview_status: document.getElementById('vpg_interview').value,
    contact_prof: document.getElementById('vpg_prof').value,
  };
  try {
    await sb(`/rest/v1/students?id=eq.${vipStudent.id}`, 'PATCH', { progress });
    vipStudent.progress = progress;
    document.getElementById('vipProgressEditModal').remove();
    renderVipMain();
  } catch(e) { alert('保存失败：' + e.message); }
}

function renderVipMain() {
  const totalH = vipStudent.vip_hours_total || 0;
  const usedH = vipStudent.vip_hours_used || 0;
  const remainH = Math.round((totalH - usedH) * 100) / 100;
  const activeBooking = vipBookings.find(b => b.status === 'pending' || b.status === 'confirmed');

  // 按日期分组未预约的可选时间槽
  const bookedSlotIds = new Set(vipBookings.filter(b => b.status !== 'cancelled').map(b => b.slot_id));
  const availableSlots = vipSlots.filter(s => !bookedSlotIds.has(s.id));
  const byDate = {};
  availableSlots.forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });
  const dateKeys = Object.keys(byDate).sort();

  document.getElementById('mainWrap').innerHTML = `
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600">${vipStudent.name} 同学</div>
      <button onclick="clearVipLogin()" style="font-size:10px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit">退出</button>
    </div>
    <div style="font-size:11px;color:var(--text-muted)">${MAJORS[vipStudent.major] || vipStudent.major || ''}</div>
    <div style="display:flex;gap:18px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border-light)">
      <div><div class="sub-label">总课时</div><div style="font-size:18px;font-weight:600;font-family:'DM Mono',monospace">${totalH}</div></div>
      <div><div class="sub-label">已用</div><div style="font-size:18px;font-weight:600;font-family:'DM Mono',monospace;color:var(--text-muted)">${usedH}</div></div>
      <div><div class="sub-label">剩余</div><div style="font-size:18px;font-weight:600;font-family:'DM Mono',monospace;color:var(--accent)">${remainH}</div></div>
    </div>
  </div>

  ${renderVipProfileCard()}
  ${renderVipProgressCard()}

  ${activeBooking ? renderVipActiveBooking(activeBooking) : ''}

  ${!activeBooking ? `
  <div class="card">
    <div class="card-title">预约VIP课程时间</div>
    ${!(vipStudent.vip_teachers || []).length
      ? '<div class="no-slots">尚未分配指导老师，请联系管理员</div>'
      : (dateKeys.length ? `
        <div class="slot-grid" style="grid-template-columns:1fr">
          ${dateKeys.map(date => {
            const d = new Date(date + 'T12:00:00');
            const dow = DAYS_CN[d.getDay()];
            return byDate[date].map(s => {
              const needsLocationChoice = s.location === 'both_takadanobaba' || s.location === 'both_ichigaya';
              const campusLabel = s.location === 'both_takadanobaba' ? '高田马场' : s.location === 'both_ichigaya' ? '市谷' : '';
              return `
              <div class="slot-option">
                <input type="radio" name="vipSlotPick" id="vipslot-${s.id}" value="${s.id}" onchange="vipSelectedSlotId='${s.id}';vipRenderLocationChoice('${s.id}')">
                <label for="vipslot-${s.id}">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span class="slot-date-r">${d.getMonth() + 1}/${d.getDate()}</span>
                    <span class="slot-dow-r">${dow}</span>
                    <span class="slot-time-r">${s.time_range}</span>
                    <span style="font-size:10px;color:var(--text-muted);margin-left:auto">👤 ${s.teacher_name}</span>
                  </div>
                  ${s.vip_content && s.vip_content.length ? `<div style="font-size:10px;color:var(--text-secondary);margin-top:3px">可指导：${s.vip_content.join('・')}</div>` : ''}
                  ${needsLocationChoice
                    ? `<div style="font-size:10px;color:var(--text-secondary);margin-top:2px">📍 线上 / 线下均可・${campusLabel}（需选择）</div>`
                    : (locationLong(s.location) ? `<div style="font-size:10px;color:${locationColor(s.location)};margin-top:2px">📍 ${locationLong(s.location)}</div>` : '')}
                </label>
              </div>
              ${needsLocationChoice ? `
              <div id="vip_location_choice_${s.id}" style="display:none;padding:8px 10px 4px;margin-top:-2px">
                <div class="radio-group">
                  <div class="radio-option"><input type="radio" name="vipLocationChoice" id="vloc_online_${s.id}" value="online" checked><label for="vloc_online_${s.id}">线上</label></div>
                  <div class="radio-option"><input type="radio" name="vipLocationChoice" id="vloc_offline_${s.id}" value="offline"><label for="vloc_offline_${s.id}">线下・${campusLabel}</label></div>
                </div>
              </div>` : ''}`;
            }).join('');
          }).join('')}
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-light)">
          <div class="sub-label" style="margin-bottom:6px">提交内容（可选，老师课前可参考）</div>
          <textarea id="vipStudentContent" rows="4" placeholder="计划书草稿、需要讨论的问题等文字内容…" style="margin-bottom:8px"></textarea>
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">或上传文件（Word / PDF / 图片，最大50MB）</div>
          <input type="file" id="vipStudentFileUpload" accept=".doc,.docx,.pdf,image/*">
        </div>
        <button class="btn btn-primary btn-full" style="margin-top:14px" onclick="submitVipBooking()">提交预约申请 →</button>
      ` : '<div class="no-slots">暂无可预约的时间，请稍后再来查看</div>')
    }
  </div>` : ''}

  <div class="card">
    <div class="card-title">历史课程</div>
    ${renderVipHistory()}
  </div>`;
}

function renderVipActiveBooking(b) {
  const isPending = b.status === 'pending';
  const isConfirmed = b.status === 'confirmed';
  const isOffline = b.location && (b.location.startsWith('offline') || b.location.startsWith('both'));
  const messages = b.messages || [];

  // 上课信息块（确认后显示）
  const confirmedInfo = isConfirmed ? `
    <div style="background:var(--ok-bg,#e4f5ee);border:1px solid var(--ok,#2a9e6a);border-radius:4px;padding:10px 12px;margin:10px 0">
      <div style="font-size:12px;font-weight:600;color:var(--ok,#2a9e6a);margin-bottom:6px">✅ 老师已确认，请按时上课</div>
      <div style="font-size:12px;line-height:2">
        <div>📅 ${b.slot_date} ${b.slot_time_range || ''}</div>
        <div>👤 ${b.assigned_teacher || ''} 老师</div>
        ${b.vip_room ? `<div>🏫 教室：<strong>${b.vip_room}</strong></div>` : ''}
        ${b.vip_meeting_url ? `<div>💻 腾讯会议：<a href="${b.vip_meeting_url}" target="_blank" style="color:var(--ok)">${b.vip_meeting_url}</a></div>` : (!isOffline ? '<div style="color:#856404">💻 老师将在上课前发送会议链接，请关注留言</div>' : '')}
      </div>
      <div style="font-size:10px;color:var(--text-muted,#888);margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,.08);line-height:1.8">
        ⚠ 请准时进入课堂。如需调整请提前联系老师。<br>
        上课后30分钟内未联系且未上课，将自动扣除30分钟课时。
      </div>
    </div>` : `
    <div style="background:var(--warn-bg,#fff8e1);border:1px solid var(--warn,#e6a817);border-radius:4px;padding:10px 12px;margin:10px 0">
      <div style="font-size:12px;font-weight:600;color:var(--warn,#b45309);margin-bottom:4px">⏳ 等待老师确认</div>
      <div style="font-size:11px;color:var(--text-muted);line-height:1.7">
        老师确认后将显示${isOffline ? '教室号' : '腾讯会议链接'}。<br>
        如需调整请通过下方留言联系老师。
      </div>
    </div>`;

  return `<div class="card" style="border-color:${isConfirmed ? 'var(--ok,#2a9e6a)' : 'var(--accent)'}">
    <div class="card-title">当前预约</div>
    ${isPending ? `<div style="font-size:12px;line-height:1.8;margin-bottom:4px">
      <div>📅 ${b.slot_date} ${b.slot_time_range || ''}</div>
      <div>👤 老师：${b.assigned_teacher || '确认中'}</div>
      ${b.location ? `<div>📍 ${locationLong(b.location) || '线上'}</div>` : ''}
    </div>` : ''}
    ${confirmedInfo}
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-light)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><div style="font-size:11px;font-weight:600;color:var(--text-secondary)">💬 与老师留言</div><div style="font-size:10px;color:${messages.length >= VIP_MSG_LIMIT ? 'var(--danger)' : 'var(--text-muted)'}">${messages.length}/${VIP_MSG_LIMIT}</div></div>
      <div id="vip_messages_list" style="max-height:160px;overflow-y:auto;margin-bottom:8px">
        ${messages.length ? messages.map(m => `
          <div style="font-size:11px;margin-bottom:6px;${m.from==='student'?'text-align:right':''}">
            <span style="display:inline-block;max-width:80%;background:${m.from==='student'?'var(--accent-light,#e8e0d0)':'var(--bg)'};border-radius:8px;padding:5px 10px;text-align:left">
              <div style="font-size:9px;color:var(--text-muted);margin-bottom:2px">${m.from==='student'?'我':(b.assigned_teacher||'老师')}</div>
              ${m.text}
            </span>
          </div>`).join('') : '<div style="font-size:11px;color:var(--text-muted)">暂无留言</div>'}
      </div>
      <div style="display:flex;gap:6px">
        <input type="text" id="vip_message_input" placeholder="${messages.length >= VIP_MSG_LIMIT ? '留言已达上限（'+VIP_MSG_LIMIT+'条）' : '给老师留言…'}" ${messages.length >= VIP_MSG_LIMIT ? 'disabled style="flex:1;font-size:12px;opacity:.5"' : 'style="flex:1;font-size:12px"'}>
        <button class="btn btn-outline btn-sm" onclick="sendVipMessage('${b.id}')">发送</button>
      </div>
    </div>
  </div>`;
}

async function sendVipMessage(bookingId) {
  const input = document.getElementById('vip_message_input');
  const text = input.value.trim();
  if (!text) return;
  const b = vipBookings.find(x => x.id === bookingId);
  if (!b) return;
  const newMessages = [...(b.messages || []), { from: 'student', text, ts: Date.now() }];
  try {
    await sb(`/rest/v1/bookings?id=eq.${bookingId}`, 'PATCH', { messages: newMessages });
    b.messages = newMessages;
    input.value = '';
    renderVipMain();
  } catch (e) { alert('发送失败：' + e.message); }
}

function renderVipHistory() {
  const done = vipBookings.filter(b => (b.status === 'confirmed' || b.status === 'completed') && b.vip_session_notes);
  if (!done.length) return '<div class="no-slots">暂无已完成的课程记录</div>';
  return done.map(b => {
    const needsConfirm = !b.student_confirmed;
    return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:12px;margin-bottom:8px;background:${needsConfirm ? 'var(--accent-light)' : 'var(--surface)'}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:12px;font-weight:600">${b.slot_date} · ${b.assigned_teacher || ''}</span>
        ${b.student_confirmed ? '<span style="font-size:10px;color:var(--ok)">✓ 已确认</span>' : '<span style="font-size:10px;color:var(--accent)">待确认</span>'}
      </div>
      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px">本次内容：${b.vip_content || ''}</div>
      <div style="font-size:11px;color:var(--text-secondary);white-space:pre-wrap;margin-bottom:8px">${b.vip_session_notes || ''}</div>
      ${needsConfirm ? `
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span style="font-size:11px;color:var(--text-muted)">评价：</span>
          <button class="btn btn-outline btn-sm" onclick="confirmVipSession('${b.id}','满意')">满意</button>
          <button class="btn btn-outline btn-sm" onclick="confirmVipSession('${b.id}','不满意')">不满意</button>
        </div>` : `<div style="font-size:11px;color:var(--text-muted)">您的评价：${b.student_rating || '—'}</div>`}
    </div>`;
  }).join('');
}

function vipRenderLocationChoice(slotId) {
  document.querySelectorAll('[id^="vip_location_choice_"]').forEach(el => { el.style.display = 'none'; });
  const el = document.getElementById(`vip_location_choice_${slotId}`);
  if (el) el.style.display = 'block';
}

async function submitVipBooking() {
  if (!vipSelectedSlotId) { alert('请选择预约时间'); return; }
  const slot = vipSlots.find(s => s.id === vipSelectedSlotId);
  if (!slot) { alert('时间槽不存在，请刷新后重试'); return; }
  const remainH = (vipStudent.vip_hours_total || 0) - (vipStudent.vip_hours_used || 0);
  if (remainH <= 0) { alert('您的VIP课时已用完，请联系管理员充值'); return; }

  // 若该时间槽是「线上/线下均可」，必须读取学生的选择并转换成确定的地点值
  let finalLocation = slot.location;
  const needsChoice = slot.location === 'both_takadanobaba' || slot.location === 'both_ichigaya';
  if (needsChoice) {
    const choice = document.querySelector(`input[name="vipLocationChoice"]:checked`)?.value;
    if (!choice) { alert('请选择线上还是线下上课'); return; }
    const campus = slot.location === 'both_takadanobaba' ? 'takadanobaba' : 'ichigaya';
    finalLocation = choice === 'online' ? 'online' : `offline_${campus}`;
  }

  // 若学生选择了上传文件，先上传（文件名用专业+时间戳拼接，避免中文文件名导致的存储路径问题）
  let studentFileUrl = null;
  const fileInput = document.getElementById('vipStudentFileUpload');
  const file = fileInput?.files[0];
  if (file) {
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      const path = `${vipStudent.major || 'general'}/${Date.now()}.${ext}`;
      studentFileUrl = await sbUpload('student-files', path, file);
    } catch (e) {
      alert('文件上传失败：' + e.message + '\n您可以改为粘贴文字内容，或稍后重试');
      return;
    }
  }
  const studentContent = document.getElementById('vipStudentContent')?.value.trim() || null;

  try {
    const booking = {
      id: Date.now().toString(), name: vipStudent.name, major: vipStudent.major,
      type: 'vip', slot_id: vipSelectedSlotId, slot_date: slot.date, slot_time_range: slot.time_range,
      assigned_teacher: slot.teacher_name, location: finalLocation, duration: null, status: 'pending', needs: '',
      student_content: studentContent, student_file_url: studentFileUrl
    };
    await sb('/rest/v1/bookings', 'POST', booking);
    vipSelectedSlotId = null;
    await loadVipData();
    renderVipMain();
    alert('预约申请已提交，请等待老师确认');
  } catch (e) { alert('提交失败：' + e.message); }
}

async function confirmVipSession(bookingId, rating) {
  try {
    await sb(`/rest/v1/bookings?id=eq.${bookingId}`, 'PATCH', { student_confirmed: true, student_rating: rating });
    const b = vipBookings.find(x => x.id === bookingId);
    if (b) { b.student_confirmed = true; b.student_rating = rating; }
    renderVipMain();
  } catch (e) { alert('提交失败：' + e.message); }
}

initVip();
