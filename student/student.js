// teacher.js - Permission-based teacher portal
// Depends on: shared/supabase.js, shared/constants.js

const params = new URLSearchParams(location.search);
const teacherName = decodeURIComponent(params.get('teacher') || '');

let teacherData = null;
let slots = [], existingAvail = [], confirmedSessions = [];
let cachedTeacherSlots = [], cachedTeacherBookings = [];
let curTab = 'todo';

async function init() {
  const mc = document.getElementById('mainContent');
  if (!teacherName) { mc.innerHTML = '<div class="empty">无效链接，请联系学科负责人</div>'; return; }
  document.getElementById('headerName').textContent = teacherName + ' 老师';
  try {
    const teachers = await sb(`/rest/v1/teachers?name=eq.${encodeURIComponent(teacherName)}&select=*`);
    teacherData = teachers[0] || { name: teacherName, permissions: {}, majors: [], display_name: '' };
    const p = teacherData.permissions || {};
    const majors = teacherData.majors || [];
    const fetches = [
      sb(`/rest/v1/schedule_slots?teacher_names=cs.{"${teacherName}"}&select=*&order=session_date.asc`),
      sb(`/rest/v1/teacher_availability?teacher_name=eq.${encodeURIComponent(teacherName)}&select=*`),
      sb(`/rest/v1/course_sessions?session_teacher=ilike.%25${teacherName}%25&confirmed=eq.true&select=*&order=session_date.asc`).catch(() => []),
      sb(`/rest/v1/courses?select=id,name,course_type,campus,delivery`).catch(() => []),
    ];
    if (p.booking && majors.length) {
      fetches.push(
        sb(`/rest/v1/bookings?major=in.(${[...new Set(majors.flatMap(m=>m==='shakai_group'?['shakai','shinpan','fukushi','shakai_group']:m))].map(m=>`"${m}"`).join(',')})&type=in.(${(p.booking_types||['daily']).map(t=>`"${t}"`).join(',')})&status=in.("pending","confirmed")&select=*&order=slot_date.asc`).catch(() => []),
        sb(`/rest/v1/slots?major=in.(${majors.map(m=>`"${m}"`).join(',')})&teacher_name=eq.${encodeURIComponent(teacherName)}&select=*&order=date.asc,time_range.asc`).catch(() => [])
      );
    }
    const results = await Promise.all(fetches);
    slots = results[0] || [];
    existingAvail = results[1] || [];
    const rawSessions = results[2] || [];
    const courseMap = {};
    (results[3] || []).forEach(c => courseMap[c.id] = c);
    confirmedSessions = rawSessions.map(s => ({
      ...s,
      course_type: courseMap[s.course_id]?.course_type || '',
      campus: s.campus || courseMap[s.course_id]?.campus || '',
    })).sort((a, b) => a.session_date.localeCompare(b.session_date));
    if (p.booking) {
      cachedTeacherSlots = results[5] || [];
      const mySlotIds = cachedTeacherSlots.map(s => s.id);
      cachedTeacherBookings = (results[4] || []).filter(b => mySlotIds.includes(b.slot_id));
    }
    existingAvail.forEach(a => {
      slotState[a.slot_id] = { available: a.available, time: a.available_time || '', titles: new Set(a.preferred_titles || []) };
    });
    buildTabs();
    switchTab('todo');
  } catch (e) { mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; }
}

function buildTabs() {
  const p = teacherData?.permissions || {};
  const tabs = [{ id: 'todo', label: '⚡ 待处理' }];
  if (p.booking) tabs.push({ id: 'booking', label: '📅 预约管理' });
  if (p.slots) tabs.push({ id: 'slots', label: '⏰ 时间槽设定' });
  if (p.schedule || slots.length) tabs.push({ id: 'schedule', label: '🗓 排课确认' });
  tabs.push({ id: 'mycourses', label: '📚 我的课表' });
  const tabBar = document.getElementById('tabBar');
  tabBar.innerHTML = tabs.map(t => `<button class="tab-btn${curTab === t.id ? ' active' : ''}" onclick="switchTab('${t.id}')">${t.label}</button>`).join('');
  tabBar.style.display = tabs.length > 1 ? 'flex' : 'none';
}

function switchTab(tab) {
  curTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`)?.classList.add('active');
  renderTab();
}

function renderTab() {
  const mc = document.getElementById('mainContent');
  mc.innerHTML = '<div class="loading">加载中…</div>';
  switch (curTab) {
    case 'todo': renderTodo(mc); break;
    case 'booking': renderBookingManagement(mc); break;
    case 'slots': renderSlotManagement(mc); break;
    case 'schedule': renderScheduling(mc); break;
    case 'mycourses': renderMySchedule(mc); break;
  }
}

function renderTodo(mc) {
  const pendingBookings = cachedTeacherBookings.filter(b => b.status === 'pending');
  const pendingSlots = slots.filter(s => !existingAvail.find(a => a.slot_id === s.id));
  const upcomingSessions = confirmedSessions.filter(s => new Date(s.session_date + 'T23:59:59') >= new Date()).slice(0, 3);
  const hasTodo = pendingBookings.length > 0 || pendingSlots.length > 0;
  mc.innerHTML = `
  <div style="display:flex;flex-direction:column;gap:12px">
    ${hasTodo ? '' : '<div style="background:var(--ok-bg);border:1px solid var(--ok);border-radius:4px;padding:12px 16px;font-size:12px;color:#1a5a3a">✓ 暂无待处理事项</div>'}
<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px 14px">
  <div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:8px">显示昵称设置</div>
  <div style="font-size:11px;color:var(--text-3);margin-bottom:8px">学生预约页面显示的名字，留空则显示真实姓名「${teacherName}」</div>
  <div style="display:flex;gap:8px;align-items:center">
    <input id="displayNameInput" type="text" value="${teacherData.display_name||''}" placeholder="输入昵称（可留空）" style="flex:1;font-size:12px;padding:6px 9px">
    <button onclick="saveDisplayName()" style="background:var(--accent);color:#fff;border:none;border-radius:3px;padding:6px 14px;font-size:11px;cursor:pointer;font-family:inherit">保存</button>
  </div>
</div>
    ${pendingBookings.length ? `<div class="todo-card urgent">
      <div class="todo-head">⚠ 有 ${pendingBookings.length} 个学生预约待确认</div>
      ${pendingBookings.slice(0, 3).map(b => {
        const f = fmtSessionDate(b.slot_date);
        return `<div class="todo-item"><span style="font-weight:600">${b.name}</span><span style="color:var(--text-3)">${f.short} ${f.dow} · ${b.slot_time_range || ''} · ${typeLabel(b.type)}</span><button onclick="switchTab('booking')" style="font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;margin-left:auto">去确认</button></div>`;
      }).join('')}
      ${pendingBookings.length > 3 ? `<div style="font-size:10px;color:var(--text-3);text-align:center;padding-top:4px">还有 ${pendingBookings.length - 3} 个…</div>` : ''}
    </div>` : ''}
    ${pendingSlots.length ? `<div class="todo-card warn">
      <div class="todo-head">📋 有 ${pendingSlots.length} 个课次排班待填写</div>
      ${[...new Set(pendingSlots.map(s => s.course_name))].map(name => {
        const count = pendingSlots.filter(s => s.course_name === name).length;
        return `<div class="todo-item"><span style="font-weight:600">${name}</span><span style="color:var(--text-3)">${count} 课次待回复</span><button onclick="switchTab('schedule')" style="font-size:10px;background:var(--warn);color:#fff;border:none;border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;margin-left:auto">去填写</button></div>`;
      }).join('')}
    </div>` : ''}
    ${upcomingSessions.length ? `<div class="todo-card">
      <div class="todo-head" style="color:var(--text-2)">📅 近期课程</div>
      ${upcomingSessions.map(s => {
        const f = fmtSessionDate(s.session_date);
        return `<div class="todo-item"><span style="font-weight:600;color:${f.dowColor}">${f.short} ${f.dow}</span><span>${s.course_name}</span>${s.session_title ? `<span style="font-size:10px;color:var(--text-3)">${s.session_title}</span>` : ''}<span style="font-size:10px;color:var(--text-3);margin-left:auto">${s.time_range || ''}</span></div>`;
      }).join('')}
      <button onclick="switchTab('mycourses')" style="font-size:11px;color:var(--text-3);background:none;border:none;cursor:pointer;margin-top:6px;font-family:inherit">查看完整课表 →</button>
    </div>` : ''}
  </div>`;
}

function renderBookingManagement(mc) {
  mc.innerHTML = `
  <div class="page-section">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600">预约管理</div>
    </div>
    <div style="margin-bottom:16px">
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">待确认预约</div>
      ${cachedTeacherBookings.filter(b => b.status === 'pending').length ? cachedTeacherBookings.filter(b => b.status === 'pending').map(b => renderBookingCard(b)).join('') : '<div style="font-size:12px;color:var(--text-3);padding:12px 0">暂无待确认预约</div>'}
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">已确认预约</div>
      ${cachedTeacherBookings.filter(b => b.status === 'confirmed').length ? cachedTeacherBookings.filter(b => b.status === 'confirmed').map(b => renderBookingCard(b)).join('') : '<div style="font-size:12px;color:var(--text-3);padding:12px 0">暂无已确认预约</div>'}
    </div>
  </div>`;
}

function renderBookingCard(b) {
  const f = fmtSessionDate(b.slot_date);
  const hasRecord = b.daily_record && Object.values(b.daily_record).some(v => v && (typeof v === 'string' ? v : Object.values(v).some(x=>x)));
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px 14px;margin-bottom:8px;border-left:3px solid ${b.status === 'pending' ? 'var(--warn)' : 'var(--ok)'}">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
      <div>
        <span style="font-family:'Noto Serif SC',serif;font-weight:600;font-size:14px">${b.name}</span>
        <span style="font-size:11px;color:var(--text-3);margin-left:6px">${MAJORS[b.major] || b.major}</span>
      </div>
      <span style="font-size:10px;background:${b.status === 'pending' ? 'var(--warn-bg)' : 'var(--ok-bg)'};color:${b.status === 'pending' ? 'var(--warn)' : 'var(--ok)'};padding:2px 7px;border-radius:2px;white-space:nowrap">${b.status === 'pending' ? '待确认' : '已确认'}</span>
    </div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">${f.short} ${f.dow} · ${b.slot_time_range || ''} · ${b.duration}min · <span class="tag ${typeTag(b.type)}">${typeLabel(b.type)}</span></div>
    ${b.needs ? `<div style="font-size:11px;color:var(--text-2);background:var(--bg);border-radius:2px;padding:6px 8px;margin-bottom:8px">💬 ${b.needs}</div>` : ''}
    ${b.actual_time ? `<div style="font-size:11px;color:var(--ok);margin-bottom:6px">✓ 面谈时间：${b.actual_time.replace('T', ' ')}${b.actual_duration?` · ${b.actual_duration}min`:''}</div>` : ''}
    ${b.status === 'pending' ? `
    <div style="display:flex;gap:6px">
      <input type="date" id="actual_date_${b.id}" style="flex:1;font-size:11px;padding:5px 8px">
      <input type="time" id="actual_time_${b.id}" style="width:90px;font-size:11px;padding:5px 8px">
      <button onclick="confirmBookingTeacher('${b.id}')" style="background:var(--ok);color:#fff;border:none;border-radius:3px;padding:6px 12px;font-size:11px;cursor:pointer;font-family:inherit">✓ 确认</button>
      <button onclick="cancelBookingTeacher('${b.id}')" style="background:none;border:1px solid var(--border);border-radius:3px;padding:6px 10px;font-size:11px;cursor:pointer;font-family:inherit;color:var(--text-3)">取消</button>
    </div>` : `
    <div>
      <div style="margin-bottom:8px">
        <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">提交文件链接（可选）</div>
        <div style="display:flex;gap:6px">
          <input type="url" id="fileurl_${b.id}" value="${b.file_url||''}" placeholder="Google Drive / 百度网盘 等链接" style="flex:1;font-size:11px;padding:5px 8px">
          <button onclick="saveFileUrl('${b.id}')" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:5px 10px;cursor:pointer;font-family:inherit;white-space:nowrap">保存链接</button>
        </div>
        ${b.file_url ? `<a href="${b.file_url}" target="_blank" style="font-size:10px;color:var(--accent);margin-top:3px;display:block">📎 已提交文件</a>` : ''}
      </div>
      <button onclick="toggleRecordPanel('${b.id}')" style="font-size:11px;color:var(--text-2);background:none;border:1px solid var(--border);border-radius:3px;padding:4px 10px;cursor:pointer;font-family:inherit;margin-bottom:8px">
        ${hasRecord ? '📋 查看/编辑记录' : '📝 填写面谈记录'} ▾
      </button>
      <div id="record_panel_${b.id}" style="display:none">
        <div style="margin-bottom:10px"><label class="form-label">实际面谈时长（分钟）</label>
          <input type="number" id="duration_${b.id}" value="${b.actual_duration||''}" placeholder="例：30" min="0" step="5" style="font-size:11px;width:120px">
        </div>
        <div style="font-size:10px;color:var(--text-3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">面谈记录</div>
        ${renderRecordForm(b.id, b.daily_record || {})}
        <div style="display:flex;gap:6px;margin-top:10px">
          <button onclick="saveBookingRecord('${b.id}')" style="background:var(--accent);color:#fff;border:none;border-radius:3px;padding:5px 12px;font-size:11px;cursor:pointer;font-family:inherit">保存记录</button>
          <button onclick="cancelBookingTeacher('${b.id}')" style="background:none;border:1px solid var(--border);border-radius:3px;padding:5px 10px;font-size:11px;cursor:pointer;font-family:inherit;color:var(--danger)">取消预约</button>
        </div>
        <div id="copy_area_${b.id}"></div>
      </div>
    </div>`}
  </div>`;
}
async function saveDisplayName() {
  const val = document.getElementById('displayNameInput')?.value.trim() || '';
  try {
    await sb(`/rest/v1/teachers?name=eq.${encodeURIComponent(teacherName)}`, 'PATCH', { display_name: val });
    teacherData.display_name = val;
    const btn = document.querySelector('[onclick="saveDisplayName()"]');
    if (btn) { btn.textContent = '✓ 已保存'; setTimeout(() => btn.textContent = '保存', 1500); }
  } catch(e) { alert('保存失败：' + e.message); }
}
async function saveFileUrl(id) {
  const url = document.getElementById(`fileurl_${id}`)?.value.trim() || '';
  try {
    await sb(`/rest/v1/bookings?id=eq.${id}`, 'PATCH', { file_url: url });
    const b = cachedTeacherBookings.find(x => x.id === id);
    if (b) b.file_url = url;
    const btn = document.querySelector(`[onclick="saveFileUrl('${id}')"]`);
    if (btn) { btn.textContent = '✓ 已保存'; setTimeout(() => btn.textContent = '保存链接', 1500); }
  } catch(e) { alert('保存失败：' + e.message); }
}

function toggleRecordPanel(id) {
  const panel = document.getElementById(`record_panel_${id}`);
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  const btn = panel.previousElementSibling;
  if (btn) btn.innerHTML = btn.innerHTML.replace(isOpen ? '▴' : '▾', isOpen ? '▾' : '▴');
}

async function saveBookingRecord(id) {
  const record = getRecordFromForm(id);
  const durVal = document.getElementById(`duration_${id}`)?.value || '';
  const actual_duration = durVal ? parseInt(durVal) : null;
  try {
    await sb(`/rest/v1/bookings?id=eq.${id}`, 'PATCH', { daily_record: record, actual_duration });
    const booking = cachedTeacherBookings.find(x => x.id === id);
    if (booking) { booking.daily_record = record; booking.actual_duration = actual_duration; }
    const btn = document.querySelector(`[onclick="saveBookingRecord('${id}')"]`);
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ 已保存'; setTimeout(() => btn.textContent = orig, 1500); }
    if (booking) {
      const text = buildRecordText(booking);
      const copyArea = document.getElementById(`copy_area_${id}`);
      if (copyArea) {
        copyArea.innerHTML = `<pre id="copy_text_${id}" style="background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:10px;font-size:11px;white-space:pre-wrap;font-family:'DM Mono',monospace;line-height:1.6;margin-top:10px">${text}</pre>
          <button onclick="navigator.clipboard.writeText(document.getElementById('copy_text_${id}').textContent).then(()=>{this.textContent='✓ 已复制';setTimeout(()=>this.textContent='📋 复制记录',2000)})" style="margin-top:6px;font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 12px;cursor:pointer;font-family:inherit">📋 复制记录</button>`;
      }
    }
  } catch (e) { alert('保存失败：' + e.message); }
}

async function confirmBookingTeacher(id) {
  const d = document.getElementById('actual_date_' + id)?.value || '';
  const t = document.getElementById('actual_time_' + id)?.value || '';
  const actualTime = d && t ? `${d}T${t}` : d || '';
  try {
    await sb(`/rest/v1/bookings?id=eq.${id}`, 'PATCH', { status: 'confirmed', actual_time: actualTime });
    const b = cachedTeacherBookings.find(x => x.id === id);
    if (b) { b.status = 'confirmed'; b.actual_time = actualTime; }
    renderTab();
  } catch (e) { alert('操作失败：' + e.message); }
}

async function cancelBookingTeacher(id) {
  if (!confirm('确定取消此预约？')) return;
  try {
    await sb(`/rest/v1/bookings?id=eq.${id}`, 'PATCH', { status: 'cancelled' });
    cachedTeacherBookings = cachedTeacherBookings.filter(b => b.id !== id);
    renderTab();
  } catch (e) { alert('操作失败：' + e.message); }
}

let teacherSlotMode = 'single';
let teacherSlotYear = new Date().getFullYear(), teacherSlotMonth = new Date().getMonth();

function renderSlotManagement(mc) {
  const p = teacherData?.permissions || {};
  const allowedTypes = p.slot_types || ['daily'];
  const majors = teacherData?.majors || [];
  const ym = `${teacherSlotYear}-${String(teacherSlotMonth + 1).padStart(2, '0')}`;
  const monthSlots = cachedTeacherSlots.filter(s => s.date.startsWith(ym)).sort((a, b) => a.date.localeCompare(b.date));
  const slotBookedCount = {};
  cachedTeacherBookings.forEach(b => { slotBookedCount[b.slot_id] = (slotBookedCount[b.slot_id] || 0) + 1; });
  mc.innerHTML = `
  <div class="page-section">
    <div class="swipe-row" style="grid-template-columns:280px 1fr">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px">
        <div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:10px;letter-spacing:.06em;text-transform:uppercase">新增时间槽</div>
        <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:3px;overflow:hidden;margin-bottom:12px">
          <button onclick="tsSetMode('single')" style="flex:1;padding:6px;font-size:11px;font-family:'DM Mono',monospace;cursor:pointer;border:none;background:${teacherSlotMode==='single'?'var(--accent)':'var(--bg)'};color:${teacherSlotMode==='single'?'#fff':'var(--text-2)'}">单次</button>
          <button onclick="tsSetMode('repeat')" style="flex:1;padding:6px;font-size:11px;font-family:'DM Mono',monospace;cursor:pointer;border:none;border-left:1px solid var(--border);background:${teacherSlotMode==='repeat'?'var(--accent)':'var(--bg)'};color:${teacherSlotMode==='repeat'?'#fff':'var(--text-2)'}">按周循环</button>
        </div>
        <div id="ts_panel_single" style="display:${teacherSlotMode==='single'?'block':'none'}">
          <div class="form-group"><label class="form-label">日期</label><input type="date" id="ts_date"></div>
        </div>
        <div id="ts_panel_repeat" style="display:${teacherSlotMode==='repeat'?'block':'none'}">
          <div class="form-group"><label class="form-label">适用星期（可多选）</label>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
              ${['周一','周二','周三','周四','周五','周六','周日'].map((d,i)=>`<button class="ts-wd-btn" data-wd="${i===6?0:i+1}" onclick="tsToggleWd(this)" style="padding:4px 8px;font-size:11px;border:1px solid var(--border);border-radius:2px;background:var(--bg);cursor:pointer;font-family:'DM Mono',monospace">${d}</button>`).join('')}
            </div>
          </div>
          <div class="form-group"><label class="form-label">日期范围</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              <input type="date" id="ts_repeat_start">
              <input type="date" id="ts_repeat_end">
            </div>
          </div>
        </div>
        <div class="form-group"><label class="form-label">时间段</label>
          <div style="display:grid;grid-template-columns:1fr 16px 1fr;gap:4px;align-items:center">
            <input type="time" id="ts_start" value="10:00">
            <div style="text-align:center;font-size:11px;color:var(--text-3)">—</div>
            <input type="time" id="ts_end" value="12:00">
          </div>
        </div>
        <div class="form-group"><label class="form-label">类型（可多选）</label>
          <div style="display:flex;flex-direction:column;gap:8px" id="ts_type_group">
            ${allowedTypes.map(t => `<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer">
              <input type="checkbox" value="${t}" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">${typeLabel(t)}
            </label>`).join('')}
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0"><label class="form-label">专业</label>
          <select id="ts_major">
            ${majors.some(m => ['shakai','shinpan','fukushi'].includes(m)) ? `<option value="shakai_group">社会人文</option>` : ''}
            ${majors.map(m => `<option value="${m}">${MAJORS[m] || m}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;margin-top:8px"><label class="form-label">面谈地点（可选）</label>
          <select id="ts_location">
            <option value="online">线上（默认）</option>
            <option value="offline_takadanobaba">线下 · 高田马场</option>
            <option value="offline_ichigaya">线下 · 市谷</option>
          </select>
        </div>
        <button class="btn btn-primary btn-full" style="margin-top:12px" onclick="addTeacherSlot()">＋ 添加</button>
      </div>
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:11px;font-weight:600;color:var(--text-2)">本月时间槽</div>
          <div style="display:flex;align-items:center;gap:6px">
            <button onclick="teacherSlotMonthShift(-1)" style="background:none;border:1px solid var(--border);border-radius:2px;width:22px;height:22px;cursor:pointer;font-size:11px">‹</button>
            <span style="font-size:11px">${teacherSlotYear}·${String(teacherSlotMonth + 1).padStart(2, '0')}</span>
            <button onclick="teacherSlotMonthShift(1)" style="background:none;border:1px solid var(--border);border-radius:2px;width:22px;height:22px;cursor:pointer;font-size:11px">›</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${monthSlots.length ? monthSlots.map(s => {
            const d = new Date(s.date + 'T12:00:00');
            const dow = DAYS_CN[d.getDay()];
            const dowColor = DOW_COLOR[d.getDay()] || 'var(--text-2)';
            const cap = slotCap(s.time_range), booked = slotBookedCount[s.id] || 0;
            const isLocked = s.locked || false;
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:${isLocked?'var(--danger-bg)':'var(--bg)'};border:1px solid ${isLocked?'var(--danger)':'var(--border-light)'};border-radius:3px;font-size:11px">
              <div style="display:flex;align-items:center;gap:6px;flex:1;flex-wrap:wrap">
                <span class="tag ${typeTag(Array.isArray(s.type)?s.type[0]:s.type)}">${(Array.isArray(s.type)?s.type:[s.type]).map(t=>t==='daily'?'日常':t==='plan'?'计划书':t==='vip'?'VIP':'模拟').join('・')}</span>
                <span style="font-weight:500">${s.date.slice(5)}</span>
                <span style="color:${dowColor}">${dow}</span>
                <span style="color:var(--text-3)">${s.time_range}</span>
                ${s.location&&s.location!=='online'?`<span style="font-size:10px;color:#2a6aad">${s.location==='offline_takadanobaba'?'线下·高马':'线下·市谷'}</span>`:''}
                <span style="color:${isLocked?'var(--danger)':booked>=cap?'var(--danger)':'var(--ok)'}">${isLocked?'🔒':booked+'/'+cap}</span>
              </div>
              <div style="display:flex;gap:4px">
                <button onclick="lockTeacherSlot('${s.id}',${!isLocked})" style="font-size:10px;background:${isLocked?'var(--ok-bg)':'var(--danger-bg)'};color:${isLocked?'var(--ok)':'var(--danger)'};border:1px solid ${isLocked?'var(--ok)':'var(--danger)'};border-radius:2px;padding:1px 7px;cursor:pointer;font-family:inherit">${isLocked?'解锁':'锁定'}</button>
                <button class="btn-ghost" onclick="deleteTeacherSlot('${s.id}')">✕</button>
              </div>
            </div>`;
          }).join('') : '<div style="font-size:11px;color:var(--text-3);padding:20px 0;text-align:center">本月暂无时间槽</div>'}
        </div>
      </div>
    </div>
  </div>
  <div class="swipe-hint">← 左右滑动切换：新增表单 / 时间槽列表 →</div>`;
  const today = new Date().toISOString().slice(0, 10);
  const el = document.getElementById('ts_date'); if (el) el.value = today;
  const rs = document.getElementById('ts_repeat_start'); if (rs) rs.value = today;
}

function tsSetMode(mode) { teacherSlotMode = mode; renderTab(); }
function tsToggleWd(btn) {
  btn.classList.toggle('active');
  btn.style.background = btn.classList.contains('active') ? 'var(--accent)' : 'var(--bg)';
  btn.style.color = btn.classList.contains('active') ? '#fff' : 'var(--text-2)';
}
function teacherSlotMonthShift(d) {
  teacherSlotMonth += d;
  if (teacherSlotMonth > 11) { teacherSlotMonth = 0; teacherSlotYear++; }
  if (teacherSlotMonth < 0) { teacherSlotMonth = 11; teacherSlotYear--; }
  renderTab();
}

async function addTeacherSlot() {
  const start = document.getElementById('ts_start').value;
  const end = document.getElementById('ts_end').value;
  const types = [...document.querySelectorAll('#ts_type_group input:checked')].map(c => c.value);
  if (!types.length) { alert('请至少选择一个类型'); return; }
  const major = document.getElementById('ts_major')?.value || (teacherData?.majors?.[0] || '');
  const location = document.getElementById('ts_location')?.value || 'online';
  if (!start || !end) { alert('请填写时间段'); return; }
  if (start >= end) { alert('结束时间需晚于开始时间'); return; }
  const timeRange = `${start}\u2013${end}`;
  let dates = [];
  if (teacherSlotMode === 'single') {
    const date = document.getElementById('ts_date')?.value;
    if (!date) { alert('请选择日期'); return; }
    dates = [date];
  } else {
    const wds = [...document.querySelectorAll('.ts-wd-btn.active')].map(b => parseInt(b.dataset.wd));
    const rs = document.getElementById('ts_repeat_start')?.value;
    const re = document.getElementById('ts_repeat_end')?.value;
    if (!wds.length) { alert('请选择星期'); return; }
    if (!rs || !re) { alert('请填写日期范围'); return; }
    const cur = new Date(rs); const endDate = new Date(re);
    while (cur <= endDate) {
      if (wds.includes(cur.getDay())) dates.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    if (!dates.length) { alert('所选星期在日期范围内没有匹配日期'); return; }
    if (!confirm(`将添加 ${dates.length} 个时间槽，确认？`)) return;
  }
  try {
    const newSlots = dates.map(date => ({ id: `sl-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, date, time_range: timeRange, type: types, major, location, teacher_name: teacherName }));
    for (let i = 0; i < newSlots.length; i += 10) {
      const chunk = newSlots.slice(i, i + 10);
      const res = await sb('/rest/v1/slots', 'POST', chunk);
      cachedTeacherSlots.push(...(Array.isArray(res) ? res : chunk));
    }
    renderTab();
  } catch (e) { alert('添加失败：' + e.message); }
}

async function lockTeacherSlot(id, lock) {
  try {
    await sb(`/rest/v1/slots?id=eq.${id}`, 'PATCH', { locked: lock });
    const s = cachedTeacherSlots.find(x => x.id === id);
    if (s) s.locked = lock;
    renderTab();
  } catch (e) { alert('操作失败：' + e.message); }
}

async function deleteTeacherSlot(id) {
  if (!confirm('确定删除此时间槽？')) return;
  try {
    await sb(`/rest/v1/slots?id=eq.${id}`, 'DELETE');
    cachedTeacherSlots = cachedTeacherSlots.filter(s => s.id !== id);
    renderTab();
  } catch (e) { alert('删除失败：' + e.message); }
}

const slotState = {};
function getState(slotId) {
  if (!slotState[slotId]) slotState[slotId] = { available: false, time: '', titles: new Set() };
  return slotState[slotId];
}

function renderScheduling(mc) {
  if (!slots.length) { mc.innerHTML = '<div class="empty">暂无排班课次<br><span style="font-size:11px">请等待学科负责人创建课次后访问</span></div>'; return; }
  const allTitles = [...new Set(slots.flatMap(s => s.session_titles || []))];
  const byCourse = {};
  slots.forEach(s => {
    const d = new Date(s.session_date + 'T12:00:00');
    const m = d.getMonth() + 1;
    const period = m <= 3 ? '1月期' : m <= 6 ? '4月期' : m <= 9 ? '7月期' : '10月期';
    const key = `${s.course_name}||${d.getFullYear()}${period}`;
    if (!byCourse[key]) byCourse[key] = { name: s.course_name, period: `${d.getFullYear()}年${period}`, slots: [] };
    byCourse[key].slots.push(s);
  });
  mc.innerHTML = `
  <div class="page-section">
    <div class="info-box" style="margin-bottom:16px">请点击您<strong>可以上课的日期</strong>（打勾），不点视为不可以。如有内容偏好可在展开区域选择。</div>
    ${allTitles.length ? `<div class="task-box" style="margin-bottom:16px">本期您负责的课程内容：${allTitles.map(t => `<span style="background:rgba(255,255,255,.6);border-radius:2px;padding:1px 8px;margin-right:4px">${t}</span>`).join('')}</div>` : ''}
    ${Object.values(byCourse).map(({ name, period, slots: cs }) => `
      <div style="margin-bottom:24px">
        <div style="font-family:'Noto Serif SC',serif;font-size:13px;font-weight:600;color:${courseColorText(name)};margin-bottom:10px;padding-bottom:7px;border-bottom:1px solid var(--border)">
          ${name} <span style="font-size:10px;font-weight:400;background:var(--bg);border-radius:2px;padding:1px 6px;margin-left:4px;color:var(--text-3)">${period}</span>
          <span style="font-size:11px;font-weight:400;color:var(--text-3)">${cs.length}课次</span>
        </div>
        ${cs.map(s => renderSlotCard(s)).join('')}
      </div>`).join('')}
    <div class="submit-bar-inline">
      <div id="schedHint" style="font-size:12px;color:var(--text-2)"></div>
      <button class="btn btn-primary" onclick="submitAvailability()">提交回复</button>
    </div>
  </div>`;
  updateHint();
}

function renderSlotCard(s) {
  const st = getState(s.id);
  const d = new Date(s.session_date + 'T12:00:00');
  const dow = DAYS_CN[d.getDay()];
  const dowColor = DOW_COLOR[d.getDay()] || 'var(--text-2)';
  const hasTwo = !!(s.time_range && s.time_range_2);
  const titles = s.session_titles || [];
  return `<div class="date-card${st.available ? ' selected' : ''}" id="card-${s.id}">
    <div class="date-head" onclick="toggleAvail('${s.id}')">
      <div class="date-left">
        <div><span class="date-num">${d.getMonth() + 1}/${d.getDate()}</span><span class="date-dow" style="color:${dowColor}">${dow}</span></div>
        <div class="date-meta">${s.time_range || ''}${hasTwo ? ` / ${s.time_range_2}` : ''} · 第${s.session_number}回</div>
      </div>
      <div class="check-circle${st.available ? ' checked' : ''}">✓</div>
    </div>
    ${st.available && (hasTwo || titles.length) ? `
    <div class="date-body">
      ${hasTwo ? `<div class="sub-label">时间偏好</div><div class="chip-row">
        <div class="chip${st.time === s.time_range ? ' active' : ''}" onclick="event.stopPropagation();setTime('${s.id}','${s.time_range}')">${s.time_range}</div>
        <div class="chip${st.time === s.time_range_2 ? ' active' : ''}" onclick="event.stopPropagation();setTime('${s.id}','${s.time_range_2}')">${s.time_range_2}</div>
        <div class="chip ok-active${st.time === 'both' ? ' active' : ''}" onclick="event.stopPropagation();setTime('${s.id}','both')">两个都行</div>
      </div>` : ''}
      ${titles.length ? `<div class="sub-label">内容偏好（不选=都可以）</div><div class="chip-row">
        ${titles.map(t => `<div class="chip${st.titles.has(t) ? ' active' : ''}" onclick="event.stopPropagation();toggleTitle('${s.id}','${t.replace(/'/g, "\\'")}')">${t}</div>`).join('')}
      </div>` : ''}
    </div>` : ''}
  </div>`;
}

function toggleAvail(slotId) { const st = getState(slotId); st.available = !st.available; if (!st.available) { st.time = ''; st.titles.clear(); } rerenderCard(slotId); updateHint(); }
function setTime(slotId, val) { const st = getState(slotId); st.time = st.time === val ? '' : val; rerenderCard(slotId); }
function toggleTitle(slotId, title) { const st = getState(slotId); st.titles.has(title) ? st.titles.delete(title) : st.titles.add(title); rerenderCard(slotId); }
function rerenderCard(slotId) { const s = slots.find(x => x.id === slotId); if (!s) return; const el = document.getElementById(`card-${slotId}`); if (el) el.outerHTML = renderSlotCard(s); }
function updateHint() { const avail = slots.filter(s => getState(s.id).available).length; const hint = document.getElementById('schedHint'); if (hint) hint.textContent = `已选 ${avail} / ${slots.length} 个课次`; }

async function submitAvailability() {
  const btn = document.querySelector('[onclick="submitAvailability()"]');
  const avail = slots.filter(s => getState(s.id).available).length;
  if (!avail && !confirm('您还没有选择任何可以上课的日期，确定提交吗？')) return;
  if (btn) { btn.textContent = '提交中…'; btn.disabled = true; }
  try {
    await sb(`/rest/v1/teacher_availability?teacher_name=eq.${encodeURIComponent(teacherName)}`, 'DELETE').catch(() => {});
    const records = slots.map(s => {
      const st = getState(s.id);
      const timeStr = st.time === 'both' ? `${s.time_range} / ${s.time_range_2}` : st.time || '';
      return { id: `av-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, slot_id: s.id, teacher_name: teacherName, available: st.available, available_time: st.available && timeStr ? timeStr : null, preferred_titles: st.available && st.titles.size ? [...st.titles] : null };
    });
    await sb('/rest/v1/teacher_availability', 'POST', records);
    existingAvail = records;
    renderTab();
    alert(`✓ 已提交！选择了 ${avail} 个课次可以上课。`);
  } catch (e) { alert('提交失败：' + e.message); if (btn) { btn.textContent = '提交回复'; btn.disabled = false; } }
}

function courseColorText(name) {
  if (/宏观|微观|経済|经济/.test(name)) return '#1a3a6a';
  if (/経営|经营/.test(name)) return '#3a2e24';
  if (/共通/.test(name)) return '#3a3830';
  if (/社会人文|社会学/.test(name)) return '#1a4a28';
  if (/新闻|传播/.test(name)) return '#3a2a7a';
  if (/福祉/.test(name)) return '#5a3010';
  return '#3a2e24';
}

function renderMySchedule(mc) {
  if (!confirmedSessions.length) { mc.innerHTML = '<div class="empty">暂无已确定的课程<br><span style="font-size:11px">排课确认后这里会显示您的完整课表</span></div>'; return; }
  const byMonth = {};
  confirmedSessions.forEach(s => { const m = s.session_date.slice(0, 7); if (!byMonth[m]) byMonth[m] = []; byMonth[m].push(s); });
  const monthNames = { '01': '一月', '02': '二月', '03': '三月', '04': '四月', '05': '五月', '06': '六月', '07': '七月', '08': '八月', '09': '九月', '10': '十月', '11': '十一月', '12': '十二月' };
  mc.innerHTML = `
  <div class="page-section">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600">我的课表</div>
      <div style="font-size:11px;color:var(--text-3)">共 ${confirmedSessions.length} 课次</div>
    </div>
    ${Object.entries(byMonth).map(([ym, sessions]) => `
      <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);padding:10px 0 6px;border-bottom:1px solid var(--border-light);margin-bottom:8px">
        ${ym.slice(0, 4)}年 ${monthNames[ym.slice(5, 7)] || ym.slice(5, 7) + '月'} · ${sessions.length}课次
      </div>
      ${sessions.map(s => {
        const d = new Date(s.session_date + 'T12:00:00');
        const dow = DAYS_CN[d.getDay()];
        const dowColor = DOW_COLOR[d.getDay()] || 'var(--text-2)';
        return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:flex-start;gap:14px">
          <div style="text-align:center;min-width:44px">
            <div style="font-size:17px;font-weight:700;font-family:'DM Mono',monospace;color:${dowColor}">${d.getMonth() + 1}/${d.getDate()}</div>
            <div style="font-size:10px;font-weight:600;color:${dowColor}">${dow}</div>
          </div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
              <span style="font-family:'Noto Serif SC',serif;font-weight:600;font-size:13px">${s.course_name}</span>
              ${s.course_type ? `<span style="font-size:9px;background:var(--bg);border:1px solid var(--border-light);border-radius:2px;padding:1px 5px">${s.course_type}</span>` : ''}
              <span style="font-size:9px;color:var(--text-3);background:var(--bg);border-radius:2px;padding:1px 5px">${(()=>{const m2=d.getMonth()+1;return m2<=3?'1月期':m2<=6?'4月期':m2<=9?'7月期':'10月期'})()}</span>
            </div>
            <div style="font-size:11px;color:var(--text-3)">第${s.session_number}回 · ${s.time_range || ''} ${s.campus ? '· ' + s.campus : ''}</div>
            ${s.session_title ? `<div style="font-size:11px;color:var(--text-2);margin-top:3px">📌 ${s.session_title}</div>` : ''}
          </div>
        </div>`;
      }).join('')}`).join('')}
  </div>`;
}

init();
