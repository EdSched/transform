function locationShort(loc) {
  if (!loc || loc === 'online') return '';
  if (loc === 'offline_takadanobaba') return '线下·高马';
  if (loc === 'offline_ichigaya') return '线下·市谷';
  if (loc === 'both_takadanobaba') return '线上/线下·高马';
  if (loc === 'both_ichigaya') return '线上/线下·市谷';
  return '';
}
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
      sb(`/rest/v1/courses?select=id,name,course_type,campus,delivery,meeting_url,host_key,needs_recording`).catch(() => []),
    ];
    if (p.booking && majors.length) {
      fetches.push(
        // 不再用 major 过滤 bookings：bookings.major 只是学生预约入口的分类标记，与「这位老师能否看到这条预约」无关。
        // 能否看到只由 assigned_teacher / slot 归属决定（见下方 cachedTeacherBookings 过滤逻辑）。
        sb(`/rest/v1/bookings?type=in.(${(p.booking_types||['daily']).map(t=>`"${t}"`).join(',')})&status=in.("pending","confirmed","completed")&select=*&order=slot_date.asc`).catch(() => []),
        sb(`/rest/v1/slots?teacher_name=eq.${encodeURIComponent(teacherName)}&select=*&order=date.asc,time_range.asc`).catch(() => [])
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
      meeting_url: courseMap[s.course_id]?.meeting_url || '',
      host_key: courseMap[s.course_id]?.host_key || '',
      needs_recording: courseMap[s.course_id]?.needs_recording || false,
    })).sort((a, b) => a.session_date.localeCompare(b.session_date));
    if (p.booking) {
      cachedTeacherSlots = results[5] || [];
      const mySlotIds = cachedTeacherSlots.map(s => s.id);
      // 一条预约对该老师可见的条件：
      // 1) 该预约被明确分配给了这位老师（assigned_teacher === 我），不论时间槽是谁开的；或
      // 2) 该预约从未被单独分配过（assigned_teacher 为空），且时间槽是这位老师自己开的（沿用原有默认归属）
      cachedTeacherBookings = (results[4] || []).filter(b =>
        b.assigned_teacher
          ? b.assigned_teacher === teacherName
          : mySlotIds.includes(b.slot_id)
      );
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
  if (p.homework) tabs.push({ id: 'homework', label: '📝 作业反馈' });
  if (p.admission_query) {
    tabs.push({ id: 'admissiondb', label: '🏫 出願数据库' });
    // 记录该老师被允许查看的专业（空数组=全部）
    window._teacherAllowedAdmMajors = p.admission_majors || [];
  }
  // 我的课表：有排班权限或有实际排到课才显示
  if (p.schedule || slots.length) tabs.push({ id: 'mycourses', label: '📚 我的课表' });
  // 工作记录：有实际教学相关权限才显示
  if (p.booking || p.slots || p.schedule || p.homework || slots.length) tabs.push({ id: 'workrecords', label: '📋 工作记录' });
  const tabBar = document.getElementById('tabBar');
  tabBar.innerHTML = tabs.map(t => `<button class="tab-btn${curTab === t.id ? ' active' : ''}" onclick="switchTab('${t.id}')">${t.label}</button>`).join('');
  tabBar.style.display = tabs.length > 1 ? 'flex' : 'none';
}

function switchTab(tab) {
  // 出願ページ以外はmain幅をリセット
  if (tab !== 'admissiondb') {
    const mainEl = document.querySelector('.main');
    if (mainEl) mainEl.style.maxWidth = '';
  }
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
    case 'homework': renderHomeworkFeedback(mc); break;
    case 'admissiondb': renderTeacherAdmissionDb(mc); break;
    case 'mycourses': renderMySchedule(mc); break;
    case 'workrecords': renderWorkRecordsTeacher(mc); break;
  }
}

function renderTodo(mc) {
  const pendingBookings = cachedTeacherBookings.filter(b => b.status === 'pending');
  const pendingSlots = slots.filter(s => !existingAvail.find(a => a.slot_id === s.id));
  const now = new Date();
  const upcomingCourseSessions = confirmedSessions.filter(s => new Date(s.session_date + 'T23:59:59') >= now);
  const upcomingVipBookings = cachedTeacherBookings
    .filter(b => b.type === 'vip' && b.status === 'confirmed' && new Date(b.slot_date + 'T23:59:59') >= now)
    .map(b => ({ _isVip: true, session_date: b.slot_date, time_range: b.slot_time_range, course_name: `${b.name} 的VIP课程` }));
  const upcomingSessions = [...upcomingCourseSessions, ...upcomingVipBookings]
    .sort((a, b) => a.session_date.localeCompare(b.session_date))
    .slice(0, 3);
  // VIP 已上完课、老师已填记录、但学生还没确认的——需要提醒老师去联系学生
  const unconfirmedVip = cachedTeacherBookings.filter(b => b.type === 'vip' && b.status === 'confirmed' && b.vip_session_notes && !b.student_confirmed);
  const hasTodo = pendingBookings.length > 0 || pendingSlots.length > 0 || unconfirmedVip.length > 0;
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
    ${unconfirmedVip.length ? `<div class="todo-card warn">
      <div class="todo-head">⏳ 有 ${unconfirmedVip.length} 位VIP学生还未确认上课，请联系学生</div>
      ${unconfirmedVip.slice(0, 5).map(b => {
        return `<div class="todo-item"><span style="font-weight:600">${b.name}</span><span style="color:var(--text-3)">${b.slot_date} ${b.slot_time_range || ''}</span><button onclick="openVipConfirmText('${b.id}')" style="font-size:10px;background:#5a3a9a;color:#fff;border:none;border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;margin-left:auto">去完成</button></div>`;
      }).join('')}
    </div>` : ''}
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
        if (s._isVip) {
          return `<div class="todo-item"><span style="font-weight:600;color:#5a3a9a">${f.short} ${f.dow}</span><span>${s.course_name}</span><span style="font-size:9px;background:#5a3a9a;color:#fff;border-radius:2px;padding:1px 6px">VIP</span><span style="font-size:10px;color:var(--text-3);margin-left:auto">${s.time_range || ''}</span></div>`;
        }
        return `<div class="todo-item"><span style="font-weight:600;color:${f.dowColor}">${f.short} ${f.dow}</span><span>${s.course_name}</span>${s.session_title ? `<span style="font-size:10px;color:var(--text-3)">${s.session_title}</span>` : ''}<span style="font-size:10px;color:var(--text-3);margin-left:auto">${s.time_range || ''}</span></div>`;
      }).join('')}
      <button onclick="switchTab('mycourses')" style="font-size:11px;color:var(--text-3);background:none;border:none;cursor:pointer;margin-top:6px;font-family:inherit">查看完整课表 →</button>
    </div>` : ''}
  </div>`;
}

let teacherBkSection = 'regular'; // 'regular' | 'vip'

function renderBookingManagement(mc) {
  const regularBookings = cachedTeacherBookings.filter(b => b.type !== 'vip');
  const vipBookings = cachedTeacherBookings.filter(b => b.type === 'vip');
  mc.innerHTML = `
  <div class="page-section">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600">预约管理</div>
      <button onclick="exportMyFiles()" style="font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:6px 12px;cursor:pointer;font-family:inherit;white-space:nowrap">📦 批量导出我的文件</button>
    </div>
    <div style="display:flex;border:1px solid var(--border);border-radius:3px;overflow:hidden;margin-bottom:16px;width:fit-content">
      <button onclick="setTeacherBkSection('regular')" style="padding:6px 16px;font-size:12px;border:none;cursor:pointer;font-family:inherit;background:${teacherBkSection==='regular'?'var(--accent)':'var(--surface)'};color:${teacherBkSection==='regular'?'#fff':'var(--text-2)'}">面谈预约</button>
      <button onclick="setTeacherBkSection('vip')" style="padding:6px 16px;font-size:12px;border:none;border-left:1px solid var(--border);cursor:pointer;font-family:inherit;background:${teacherBkSection==='vip'?'var(--accent)':'var(--surface)'};color:${teacherBkSection==='vip'?'#fff':'var(--text-2)'}">VIP预约</button>
    </div>
    ${teacherBkSection==='regular' ? `
    <div style="margin-bottom:16px">
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">待确认预约</div>
      ${regularBookings.filter(b => b.status === 'pending').length ? regularBookings.filter(b => b.status === 'pending').map(b => renderBookingCardCollapsed(b)).join('') : '<div style="font-size:12px;color:var(--text-3);padding:12px 0">暂无待确认预约</div>'}
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">已确认预约</div>
      ${regularBookings.filter(b => b.status === 'confirmed').length ? regularBookings.filter(b => b.status === 'confirmed').map(b => renderBookingCardCollapsed(b)).join('') : '<div style="font-size:12px;color:var(--text-3);padding:12px 0">暂无已确认预约</div>'}
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">已完成预约</div>
      ${regularBookings.filter(b => b.status === 'completed').length ? regularBookings.filter(b => b.status === 'completed').map(b => renderBookingCardCollapsed(b)).join('') : '<div style="font-size:12px;color:var(--text-3);padding:12px 0">暂无已完成预约</div>'}
    </div>` : `
    <div style="margin-bottom:16px">
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">待确认VIP预约</div>
      ${vipBookings.filter(b => b.status === 'pending').length ? vipBookings.filter(b => b.status === 'pending').map(b => renderMyVipRow(b)).join('') : '<div style="font-size:12px;color:var(--text-3);padding:12px 0">暂无待确认VIP预约</div>'}
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">已确认VIP预约</div>
      ${vipBookings.filter(b => b.status === 'confirmed').length ? vipBookings.filter(b => b.status === 'confirmed').map(b => renderMyVipRow(b)).join('') : '<div style="font-size:12px;color:var(--text-3);padding:12px 0">暂无已确认VIP预约</div>'}
    </div>
    <div style="margin-top:16px">
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">已完成VIP预约</div>
      ${vipBookings.filter(b => b.status === 'completed' || b.student_confirmed).length ? vipBookings.filter(b => b.status === 'completed' || b.student_confirmed).map(b => renderMyVipRow(b)).join('') : '<div style="font-size:12px;color:var(--text-3);padding:12px 0">暂无已完成VIP预约</div>'}
    </div>`}
  </div>`;
}

function setTeacherBkSection(s) {
  teacherBkSection = s;
  renderBookingManagement(document.getElementById('mainContent'));
}

// 默认收起的卡片：只显示姓名+时间+状态一行，点击展开完整内容
function renderBookingCardCollapsed(b) {
  const f = fmtSessionDate(b.slot_date);
  const rowId = 'bkc_' + b.id;
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;margin-bottom:8px;border-left:3px solid ${b.status === 'pending' ? 'var(--warn)' : 'var(--ok)'}">
    <div style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer" onclick="toggleBookingCard('${b.id}')">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-family:'Noto Serif SC',serif;font-weight:600;font-size:13px">${b.name}</span>
        <span style="font-size:11px;color:var(--text-3)">${f.short} ${f.dow} · ${b.slot_time_range || ''}</span>
        ${b.type==='vip' ? '<span style="font-size:9px;background:#5a3a9a;color:#fff;border-radius:2px;padding:1px 6px">VIP</span>' : `<span class="tag ${typeTag(b.type)}" style="font-size:9px">${typeLabel(b.type)}</span>`}
      </div>
      <span style="font-size:10px;background:${b.status === 'pending' ? 'var(--warn-bg)' : 'var(--ok-bg)'};color:${b.status === 'pending' ? 'var(--warn)' : 'var(--ok)'};padding:2px 7px;border-radius:2px;white-space:nowrap">${b.status === 'pending' ? '待确认' : b.status === 'completed' ? '已完成' : '已确认'}</span>
    </div>
    <div id="${rowId}" style="display:none;padding:0 14px 14px">
      <div style="font-size:11px;margin-bottom:8px">
        <span style="cursor:pointer;color:var(--accent);text-decoration:underline" onclick="showStudentInfoTeacher('${b.name}')">${b.name}</span>
        <span style="color:var(--text-3);margin-left:6px">${MAJORS[b.major] || b.major}</span>
      </div>
      ${renderBookingCardBody(b)}
    </div>
  </div>`;
}

function toggleBookingCard(id) {
  const el = document.getElementById('bkc_' + id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// 独立展示用（如需要单独渲染一张完整卡片，带外壳+头部）
function renderBookingCard(b) {
  const f = fmtSessionDate(b.slot_date);
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px 14px;margin-bottom:8px;border-left:3px solid ${b.status === 'pending' ? 'var(--warn)' : 'var(--ok)'}">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
      <div>
        <span style="font-family:'Noto Serif SC',serif;font-weight:600;font-size:14px;cursor:pointer;color:var(--accent);text-decoration:underline" onclick="showStudentInfoTeacher('${b.name}')">${b.name}</span>
        <span style="font-size:11px;color:var(--text-3);margin-left:6px">${MAJORS[b.major] || b.major}</span>
      </div>
      <span style="font-size:10px;background:${b.status === 'pending' ? 'var(--warn-bg)' : 'var(--ok-bg)'};color:${b.status === 'pending' ? 'var(--warn)' : 'var(--ok)'};padding:2px 7px;border-radius:2px;white-space:nowrap">${b.status === 'pending' ? '待确认' : b.status === 'completed' ? '已完成' : '已确认'}</span>
    </div>
    ${renderBookingCardBody(b)}
  </div>`;
}

// 卡片主体内容（不含外壳/姓名头部），供独立卡片和收起展开两种场景共用
function renderBookingCardBody(b) {
  const f = fmtSessionDate(b.slot_date);
  const hasRecord = b.daily_record && Object.values(b.daily_record).some(v => v && (typeof v === 'string' ? v : Object.values(v).some(x=>x)));
  return `
    <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">${f.short} ${f.dow} · ${b.slot_time_range || ''} · ${b.duration}min · <span class="tag ${typeTag(b.type)}">${typeLabel(b.type)}</span></div>
    ${b.needs ? `<div style="font-size:11px;color:var(--text-2);background:var(--bg);border-radius:2px;padding:6px 8px;margin-bottom:8px">💬 ${b.needs}</div>` : ''}
    ${b.student_content ? `<div style="font-size:11px;color:var(--text-2);background:var(--bg);border-radius:2px;padding:6px 8px;margin-bottom:8px;white-space:pre-wrap">📄 ${b.student_content}</div>` : ''}
    ${b.student_file_url ? `<a href="${b.student_file_url}" target="_blank" style="font-size:11px;color:var(--accent);display:block;margin-bottom:8px">📎 学生上传文件下载</a>` : ''}
    ${b.actual_time ? `<div style="font-size:11px;color:var(--ok);margin-bottom:6px">✓ 面谈时间：${b.actual_time.replace('T', ' ')}${b.actual_duration?` · ${b.actual_duration}min`:''}</div>` : ''}
    ${b.status === 'pending' ? `
    <div style="display:flex;gap:6px">
      <input type="date" id="actual_date_${b.id}" style="flex:1;font-size:11px;padding:5px 8px">
      <input type="time" id="actual_time_${b.id}" style="width:90px;font-size:11px;padding:5px 8px">
      <button onclick="confirmBookingTeacher('${b.id}')" style="background:var(--ok);color:#fff;border:none;border-radius:3px;padding:6px 12px;font-size:11px;cursor:pointer;font-family:inherit">✓ 确认</button>
      <button onclick="cancelBookingTeacher('${b.id}')" style="background:none;border:1px solid var(--border);border-radius:3px;padding:6px 10px;font-size:11px;cursor:pointer;font-family:inherit;color:var(--text-3)">取消</button>
    </div>` : `
    <div>
      <div style="margin-bottom:8px;background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:8px">
        <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">📎 上传修改文件（学生可通过查询码下载）</div>
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <input type="file" id="teacherfile_${b.id}" style="flex:1;font-size:11px;min-width:0">
          <button onclick="uploadTeacherFile('${b.id}')" id="uploadbtn_${b.id}" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:5px 10px;cursor:pointer;font-family:inherit;white-space:nowrap">上传</button>
        </div>
        ${b.teacher_file_url ? `<a href="${b.teacher_file_url}" target="_blank" style="font-size:10px;color:var(--accent);display:block">📎 已上传修改文件</a>` : '<div style="font-size:10px;color:var(--text-muted)">尚未上传</div>'}
      </div>
      <!-- 面谈查询码（常驻，跟文件无关）-->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <button onclick="generateCode('${b.id}')" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 10px;cursor:pointer;font-family:inherit;white-space:nowrap">🔑 ${b.retrieval_code?'重新生成查询码':'生成查询码'}</button>
        <span id="code_${b.id}" style="font-size:13px;font-weight:600;letter-spacing:2px;color:${b.retrieval_code?'var(--accent)':'var(--text-muted)'}">${b.retrieval_code||'未生成'}</span>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">生成后告知学生，凭姓名＋查询码可在预约页面查看面谈记录</div>
      <button onclick="toggleRecordPanel('${b.id}')" style="font-size:11px;color:var(--text-2);background:none;border:1px solid var(--border);border-radius:3px;padding:4px 10px;cursor:pointer;font-family:inherit;margin-bottom:8px">
        ${hasRecord ? '📋 查看/编辑记录' : '📝 填写面谈记录'} ▾
      </button>
      <div id="record_panel_${b.id}" style="display:none">
        <!-- 查看模式 -->
        <div id="rec_view_${b.id}" style="display:none"></div>
        <!-- 编辑模式 -->
        <div id="rec_edit_${b.id}">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
            <div><label class="form-label">实际面谈时间</label>
              <input type="datetime-local" id="actual_time_rec_${b.id}" value="${b.actual_time||''}" style="font-size:11px;width:100%">
            </div>
            <div><label class="form-label">实际时长（分钟）</label>
              <input type="number" id="duration_${b.id}" value="${b.actual_duration||''}" placeholder="例：30" min="0" step="5" style="font-size:11px;width:100%">
            </div>
          </div>
          <div style="font-size:10px;color:var(--text-3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">面谈记录</div>
          ${renderRecordForm(b.id, b.daily_record || {})}
          <div style="display:flex;gap:6px;margin-top:10px">
            <button onclick="saveBookingRecord('${b.id}')" style="background:var(--accent);color:#fff;border:none;border-radius:3px;padding:5px 12px;font-size:11px;cursor:pointer;font-family:inherit">保存记录</button>
            <button onclick="cancelBookingTeacher('${b.id}')" style="background:none;border:1px solid var(--border);border-radius:3px;padding:5px 10px;font-size:11px;cursor:pointer;font-family:inherit;color:var(--danger)">取消预约</button>
          </div>
        </div>
      </div>
    </div>`}
  `;
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
// saveFileUrl removed - using Supabase Storage instead

function downloadStudentContent(id) {
  const b = cachedTeacherBookings.find(x => x.id === id);
  if (!b || !b.student_content) return;
  downloadAsWord(`${b.name}_${b.slot_date}_${typeLabel(b.type)}`, `${b.name} · ${typeLabel(b.type)}（${b.slot_date}）`, b.student_content);
}

async function uploadTeacherFile(id) {
  const input = document.getElementById(`teacherfile_${id}`);
  const file = input?.files?.[0];
  if (!file) { alert('请选择要上传的文件'); return; }
  const btn = document.getElementById(`uploadbtn_${id}`);
  if (btn) { btn.textContent = '上传中…'; btn.disabled = true; }
  try {
    const ext = file.name.split('.').pop();
    const path = `${id}-${Date.now()}.${ext}`;
    const url = await sbUpload('teacher-files', path, file);
    await sb(`/rest/v1/bookings?id=eq.${id}`, 'PATCH', { teacher_file_url: url });
    const b = cachedTeacherBookings.find(x => x.id === id);
    if (b) b.teacher_file_url = url;
    renderBookingManagement(document.getElementById('mainContent'));
  } catch(e) {
    alert('上传失败：' + e.message);
    if (btn) { btn.textContent = '上传'; btn.disabled = false; }
  }
}

async function generateCode(id) {
  const b = cachedTeacherBookings.find(x => x.id === id);
  if (!b) return;
  const span = document.getElementById(`code_${id}`);
  try {
    // 查学生档案里的 student_code
    const students = await sb(`/rest/v1/students?name=eq.${encodeURIComponent(b.name)}&select=id,name,student_code`);
    const student = students[0];
    if (!student) {
      alert(`未在学生档案中找到「${b.name}」，请先在学生管理中建立档案并生成查询码`);
      return;
    }
    if (!student.student_code) {
      alert(`「${b.name}」尚未生成查询码，请管理员在学生管理中生成`);
      return;
    }
    // 同步写入 booking，方便兼容旧查询逻辑
    await sb(`/rest/v1/bookings?id=eq.${id}`, 'PATCH', { retrieval_code: student.student_code });
    b.retrieval_code = student.student_code;
    if (span) { span.textContent = student.student_code; span.style.color = 'var(--accent)'; }
  } catch(e) { alert('操作失败：' + e.message); }
}

async function exportMyFiles() {
  const withFiles = cachedTeacherBookings.filter(b => b.teacher_file_url);
  if (!withFiles.length) { alert('暂无可导出的文件'); return; }
  const btn = document.querySelector('[onclick="exportMyFiles()"]');
  if (btn) { btn.textContent = '打包中…'; btn.disabled = true; }
  try {
    const zip = new JSZip();
    for (const b of withFiles) {
      try {
        const res = await fetch(b.teacher_file_url);
        const blob = await res.blob();
        const ext = (b.teacher_file_url.split('.').pop() || 'file').split('?')[0];
        zip.file(`${b.name}_${b.slot_date}.${ext}`, blob);
      } catch(e) {}
    }
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url; a.download = `${teacherName}_面谈文件_${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch(e) { alert('打包失败：' + e.message); }
  finally { if (btn) { btn.textContent = '📦 批量导出我的文件'; btn.disabled = false; } }
}

function toggleRecordPanel(id) {
  const panel = document.getElementById(`record_panel_${id}`);
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // 展开时：有记录就默认查看模式，否则编辑模式
    const booking = cachedTeacherBookings.find(x => x.id === id);
    const hasRecord = booking && booking.daily_record && Object.values(booking.daily_record).some(v => v);
    setTeacherRecordMode(id, hasRecord ? 'view' : 'edit');
  }
  const btn = panel.previousElementSibling;
  if (btn) btn.innerHTML = btn.innerHTML.replace(isOpen ? '▴' : '▾', isOpen ? '▾' : '▴');
}

function setTeacherRecordMode(id, mode) {
  const editArea = document.getElementById(`rec_edit_${id}`);
  const viewArea = document.getElementById(`rec_view_${id}`);
  const booking = cachedTeacherBookings.find(x => x.id === id);
  if (mode === 'view' && booking) {
    if (editArea) editArea.style.display = 'none';
    if (viewArea) {
      viewArea.style.display = 'block';
      const text = buildRecordText(booking);
      viewArea.innerHTML = `
        <pre style="font-size:11px;line-height:1.8;white-space:pre-wrap;font-family:'DM Mono',monospace;color:var(--text-2);background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:10px;margin-bottom:8px">${text}</pre>
        <div style="display:flex;gap:6px">
          <button onclick="setTeacherRecordMode('${id}','edit')" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 10px;cursor:pointer;font-family:inherit">✏ 编辑记录</button>
          <button onclick="navigator.clipboard.writeText(document.getElementById('rec_view_${id}').querySelector('pre').textContent).then(()=>{this.textContent='✓ 已复制';setTimeout(()=>this.textContent='📋 复制记录',2000)})" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 10px;cursor:pointer;font-family:inherit">📋 复制记录</button>
        </div>`;
    }
  } else {
    if (editArea) editArea.style.display = 'block';
    if (viewArea) viewArea.style.display = 'none';
  }
}

async function saveBookingRecord(id) {
  const record = getRecordFromForm(id);
  const durVal = document.getElementById(`duration_${id}`)?.value || '';
  const actual_duration = durVal ? parseInt(durVal) : null;
  const booking = cachedTeacherBookings.find(x => x.id === id);
  // 实际时间：从记录表单里取，没填则 fallback 到 confirmBooking 时填的 actual_time，再 fallback 到 slot_date
  const timeInput = document.getElementById(`actual_time_rec_${id}`)?.value || '';
  const actual_time = timeInput || booking?.actual_time || booking?.slot_date || '';
  try {
    await sb(`/rest/v1/bookings?id=eq.${id}`, 'PATCH', { daily_record: record, actual_duration, actual_time, status: 'completed' });
    if (booking) { booking.daily_record = record; booking.actual_duration = actual_duration; booking.actual_time = actual_time; booking.status = 'completed'; }
    // 保存后切换到查看模式
    setTeacherRecordMode(id, 'view');
    const btn = document.querySelector(`[onclick="saveBookingRecord('${id}')"]`);
    if (btn) { btn.textContent = '✓ 已保存，面谈标记为已完成'; setTimeout(() => btn.textContent = '保存记录', 2000); }
  } catch (e) { alert('保存失败：' + e.message); }
}


async function showStudentInfoTeacher(name) {
  // 学生档案
  const students = await sb(`/rest/v1/students?name=eq.${encodeURIComponent(name)}&select=*`).catch(()=>[]);
  const s = students[0];
  if (!s) { alert(`未找到学生档案：${name}`); return; }

  // 考学进度
  const progress = await sb(`/rest/v1/student_progress?student_id=eq.${s.id}&select=*`).catch(()=>[]);
  const p = progress[0] || {};

  // 最近面谈（最多3条）
  const bookings = await sb(`/rest/v1/bookings?name=eq.${encodeURIComponent(name)}&status=eq.confirmed&select=*&order=slot_date.desc&limit=3`).catch(()=>[]);
  const lb = bookings[0];
  const r = lb?.daily_record || {};

  const row = (label, val) => val ? `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-light)"><span style="font-size:11px;color:var(--text-3);min-width:80px;flex-shrink:0">${label}</span><span style="font-size:11px;color:var(--text-2)">${val}</span></div>` : '';
  const statusIcon = (v) => ({进展顺利并能掌握:'🟢',能够稳定跟上:'🟡',需要更多时间:'🟠',没有很好跟上进度:'🔴',遇到困难:'🔴',未开始:'⚪',撰写中:'🟡',已完成:'🟢',已出愿:'🟢'}[v]||'');

  const html = `
    <div style="font-size:15px;font-weight:700;margin-bottom:4px">${s.name}</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:14px">${MAJORS[s.major]||s.major||''} · ${s.student_type||''} · ${({active:'在籍',graduated:'已合格',expired:'已到期',stopped:'停课',withdrawn:'退学'}[s.status])||s.status}</div>

    <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">基础信息</div>
    ${row('日语成绩', s.japanese_score)}
    ${row('英语成绩', s.english_score)}
    ${row('出身大学', s.university)}
    ${row('学部/专业', s.faculty)}
    ${row('GPA/履历', s.gpa)}
    ${row('毕业论文', s.thesis)}
    ${row('毕业时间', s.graduation_date)}
    ${row('期待入学', s.target_enrollment)}
    ${row('赴日时间', s.japan_arrival)}

    ${(p.target_schools||p.difficulties||p.research_plan) ? `
    <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin:12px 0 8px">考学进度</div>
    ${row('志望校', p.target_schools)}
    ${row('困难点', p.difficulties)}
    ${row('研究计划', p.research_plan)}
    ` : ''}

    ${lb ? `
    <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin:12px 0 8px">最新面谈进度（${lb.slot_date}）</div>
    ${r.study_status ? `<div style="font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-light)">${statusIcon(r.study_status)} 知识进展：${r.study_status}${r.study_advice?' · '+r.study_advice:''}</div>` : ''}
    ${r.plan_status ? `<div style="font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-light)">${statusIcon(r.plan_status)} 计划书：${r.plan_status}${r.plan_advice?' · '+r.plan_advice:''}</div>` : ''}
    ${r.apply_status ? `<div style="font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-light)">${statusIcon(r.apply_status)} 出愿：${r.apply_status}${r.apply_advice?' · '+r.apply_advice:''}</div>` : ''}
    ${r.exam_status ? `<div style="font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-light)">${statusIcon(r.exam_status)} 备考：${r.exam_status}${r.exam_advice?' · '+r.exam_advice:''}</div>` : ''}
    ${r.issue ? `<div style="font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-light)">❓ 困惑：${r.issue}</div>` : ''}
    ` : '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">暂无面谈记录</div>'}

    ${bookings.length > 1 ? `
    <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin:12px 0 8px">历史面谈</div>
    ${bookings.slice(1).map(b=>`<div style="font-size:11px;color:var(--text-3);padding:3px 0;border-bottom:1px solid var(--border-light)">${b.slot_date} · ${typeLabel(b.type)}</div>`).join('')}
    ` : ''}`;

  // 显示在一个简单的 overlay
  let overlay = document.getElementById('teacherStudentInfoOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'teacherStudentInfoOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:1000;display:flex;align-items:center;justify-content:center';
    overlay.onclick = (e) => { if(e.target===overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;width:420px;max-height:80vh;overflow-y:auto;position:relative">
      <button onclick="document.getElementById('teacherStudentInfoOverlay').remove()" style="position:absolute;top:12px;right:12px;background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-3)">×</button>
      ${html}
    </div>`;
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
              <input type="checkbox" value="${t}" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0" ${t==='vip'?'onchange="tsToggleVipPanel(this)"':''}>${typeLabel(t)}
            </label>`).join('')}
          </div>
        </div>
        <div id="ts_vip_content_panel" style="display:none;margin-top:8px">
          <label class="form-label">VIP内容（本次时间槽提供的指导内容，可多选）</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px" id="ts_vip_content_group">
            ${(teacherData?.permissions?.vip_content||[]).length
              ? (teacherData.permissions.vip_content).map(c=>`<label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer;border:1px solid var(--border);border-radius:3px;padding:3px 9px">
                  <input type="checkbox" value="${c}" style="accent-color:var(--accent);width:14px;height:14px">${c}
                </label>`).join('')
              : '<div style="font-size:11px;color:var(--text-3)">尚未被分配可指导的VIP内容，请联系管理员设置</div>'}
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0"><label class="form-label">专业</label>
          <select id="ts_major">
            ${majors.map(m => `<option value="${m}">${m === 'shakai_group' ? '社会人文' : MAJORS[m] || m}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;margin-top:8px"><label class="form-label">面谈地点（可选）</label>
          <select id="ts_location">
            <option value="online">线上</option>
            <option value="offline_takadanobaba">线下 · 高田马场</option>
            <option value="offline_ichigaya">线下 · 市谷</option>
            <option value="both_takadanobaba">线上 · 线下均可（高田马场）</option>
            <option value="both_ichigaya">线上 · 线下均可（市谷）</option>
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
                ${locationShort(s.location)?`<span style="font-size:10px;color:${locationColor(s.location)}">${locationShort(s.location)}</span>`:''}
                ${(s.vip_content&&s.vip_content.length)?`<span style="font-size:10px;color:var(--text-3)">[${s.vip_content.join('・')}]</span>`:''}
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
function tsToggleVipPanel(checkbox) {
  const panel = document.getElementById('ts_vip_content_panel');
  if (panel) panel.style.display = checkbox.checked ? 'block' : 'none';
}
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
  let vipContent = [];
  if (types.includes('vip')) {
    vipContent = [...document.querySelectorAll('#ts_vip_content_group input:checked')].map(c => c.value);
    if (!vipContent.length) { alert('已选择VIP类型，请至少勾选一项本次提供的VIP指导内容'); return; }
  }
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
    const newSlots = dates.map(date => ({ id: `sl-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, date, time_range: timeRange, type: types, major, location, teacher_name: teacherName, vip_content: vipContent.length ? vipContent : null }));
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
  if (!slotState[slotId]) slotState[slotId] = { available: false, time: '', dow: '', titles: new Set() };
  return slotState[slotId];
}

function renderScheduling(mc) {
  if (!slots.length) { mc.innerHTML = '<div class="empty">暂无排班课次<br><span style="font-size:11px">请等待学科负责人创建课次后访问</span></div>'; return; }
  
  // 判断是否已经回复过
  const hasReplied = existingAvail.length > 0;
  
  if (hasReplied) {
    // 已回复状态：显示已回复摘要，需要点击才能修改
    const availCount = existingAvail.filter(a => a.available).length;
    mc.innerHTML = `
    <div class="page-section">
      <div style="background:var(--ok-bg);border:1px solid var(--ok);border-radius:4px;padding:14px 16px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:600;color:var(--ok);margin-bottom:4px">✓ 已提交回复</div>
        <div style="font-size:11px;color:var(--text-2)">共选择了 ${availCount} 个可上课的课次，等待管理员排课确认。</div>
        <button onclick="renderSchedulingEdit()" style="margin-top:10px;font-size:11px;background:none;border:1px solid var(--ok);border-radius:3px;padding:5px 12px;cursor:pointer;color:var(--ok);font-family:inherit">✏ 修改回复</button>
      </div>
      ${slots.map(s => {
        const a = existingAvail.find(x => x.slot_id === s.id);
        if (!a || !a.available) return '';
        const d = new Date(s.session_date + 'T12:00:00');
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-light);font-size:11px">
          <span style="font-weight:600;min-width:60px">${(d.getMonth()+1)}/${d.getDate()}</span>
          <span style="color:var(--text-3)">${s.course_name}</span>
          ${a.preferred_dow ? `<span style="color:var(--accent)">${a.preferred_dow}</span>` : ''}
          ${a.available_time ? `<span style="color:var(--text-2)">${a.available_time}</span>` : ''}
          ${a.preferred_titles?.length ? `<span style="color:var(--text-3)">${a.preferred_titles.join('/')}</span>` : ''}
        </div>`;
      }).filter(Boolean).join('')}
    </div>`;
    return;
  }
  
  renderSchedulingEdit(mc);
}

function renderSchedulingEdit(mc) {
  if (!mc) mc = document.getElementById('mainContent');
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
  const hasTwo = !!(s.time_range && s.time_range_2);
  const hasTwoDow = !!(s.weekday_2);
  const titles = s.session_titles || [];
  // 原始日期和周几
  const origD = new Date(s.session_date + 'T12:00:00');
  const origDow = DAYS_CN[origD.getDay()];
  // 如果选了周几，显示调整后的日期
  const displayDow = st.dow && st.dow !== 'both' ? st.dow : origDow;
  const displayDate = st.adjusted_date || s.session_date;
  const dd = new Date(displayDate + 'T12:00:00');
  const displayDowColor = DOW_COLOR[dd.getDay()] || 'var(--text-2)';

  return `<div class="date-card${st.available ? ' selected' : ''}" id="card-${s.id}">
    <div class="date-head" onclick="toggleAvail('${s.id}')">
      <div class="date-left">
        <div><span class="date-num">${dd.getMonth() + 1}/${dd.getDate()}</span><span class="date-dow" style="color:${displayDowColor}">${displayDow}</span>${hasTwoDow && !st.dow ? `<span style="color:var(--text-3);font-size:10px;margin-left:4px">/ ${s.weekday_2}</span>` : ''}</div>
        <div class="date-meta">${st.time && st.time !== 'both' ? st.time : s.time_range || ''}${hasTwo && !st.time ? ` / ${s.time_range_2}` : ''} · 第${s.session_number}回</div>
      </div>
      <div class="check-circle${st.available ? ' checked' : ''}">✓</div>
    </div>
    ${st.available && (hasTwo || hasTwoDow || titles.length) ? `
    <div class="date-body">
      ${hasTwoDow ? `<div class="sub-label">周几偏好</div><div class="chip-row">
        <div class="chip${st.dow === origDow ? ' active' : ''}" onclick="event.stopPropagation();setDow('${s.id}','${origDow}')">${origDow}</div>
        <div class="chip${st.dow === s.weekday_2 ? ' active' : ''}" onclick="event.stopPropagation();setDow('${s.id}','${s.weekday_2}')">${s.weekday_2}</div>
        ${!st.dow ? `<div class="chip ok-active" onclick="event.stopPropagation();setDow('${s.id}','both')">两天都行</div>` : `<div class="chip" onclick="event.stopPropagation();setDow('${s.id}','')" style="color:var(--text-3);font-size:10px">清除</div>`}
      </div>` : ''}
      ${hasTwo ? `<div class="sub-label">时间偏好</div><div class="chip-row">
        <div class="chip${st.time === s.time_range ? ' active' : ''}" onclick="event.stopPropagation();setTime('${s.id}','${s.time_range}')">${s.time_range}</div>
        <div class="chip${st.time === s.time_range_2 ? ' active' : ''}" onclick="event.stopPropagation();setTime('${s.id}','${s.time_range_2}')">${s.time_range_2}</div>
        ${!st.time ? `<div class="chip ok-active" onclick="event.stopPropagation();setTime('${s.id}','both')">两个都行</div>` : `<div class="chip" onclick="event.stopPropagation();setTime('${s.id}','')" style="color:var(--text-3);font-size:10px">清除</div>`}
      </div>` : ''}
      ${titles.length ? `<div class="sub-label">内容偏好（不选=都可以）</div><div class="chip-row">
        ${titles.map(t => `<div class="chip${st.titles.has(t) ? ' active' : ''}" onclick="event.stopPropagation();toggleTitle('${s.id}','${t.replace(/'/g, "\\'")}')">${t}</div>`).join('')}
      </div>` : ''}
    </div>` : ''}
  </div>`;
}

function toggleAvail(slotId) { const st = getState(slotId); st.available = !st.available; if (!st.available) { st.time = ''; st.titles.clear(); } rerenderCard(slotId); updateHint(); }
function setTime(slotId, val) { const st = getState(slotId); st.time = st.time === val ? '' : val; rerenderCard(slotId); }
function setDow(slotId, val) {
  const st = getState(slotId);
  st.dow = st.dow === val ? '' : val;
  // 计算选择的周几对应的实际日期
  const s = slots.find(x => x.id === slotId);
  if (s && st.dow && st.dow !== 'both') {
    const dowMap = {'周一':1,'周二':2,'周三':3,'周四':4,'周五':5,'周六':6,'周日':0};
    const targetDow = dowMap[st.dow];
    if (targetDow !== undefined) {
      const base = new Date(s.session_date + 'T12:00:00');
      const baseDow = base.getDay();
      const diff = targetDow - baseDow;
      const newDate = new Date(base);
      newDate.setDate(base.getDate() + diff);
      st.adjusted_date = newDate.toISOString().slice(0,10);
    }
  } else {
    st.adjusted_date = null;
  }
  rerenderCard(slotId);
}
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
      const origD2 = new Date(s.session_date + 'T12:00:00');
      const dowStr = st.dow === 'both' ? `${DAYS_CN[origD2.getDay()]} / ${s.weekday_2}` : st.dow || '';
      const adjustedDate = st.adjusted_date || null;
      return { id: `av-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, slot_id: s.id, teacher_name: teacherName, available: st.available, available_time: st.available && timeStr ? timeStr : null, preferred_dow: st.available && dowStr ? dowStr : null, preferred_date: st.available && adjustedDate ? adjustedDate : null, preferred_titles: st.available && st.titles.size ? [...st.titles] : null };
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

// ── 作业反馈 ──
let hwFeedbackCourse = null;
let hwFeedbackSessions = [];
let hwFeedbackRecords = [];

async function renderHomeworkFeedback(mc) {
  const p = teacherData?.permissions || {};
  const myCourses = p.homework_courses || [];

  mc.innerHTML = '<div class="loading">加载中…</div>';

  try {
    // 拉取老师负责的课程的 session（有作业的）
    let sessions = [];
    if (myCourses.length) {
      sessions = await sb(
        `/rest/v1/course_sessions?homework_enabled=is.true&course_name=in.(${myCourses.map(c=>`"${c}"`).join(',')})&select=*&order=session_date.desc`
      ).catch(() => []);
    }

    if (!sessions.length) {
      mc.innerHTML = '<div class="empty">暂无负责的作业课程<br><span style="font-size:11px">请联系管理员配置批改作业权限</span></div>';
      return;
    }

    hwFeedbackSessions = sessions;

    // 按课程分组
    const byCourse = {};
    sessions.forEach(s => {
      if (!byCourse[s.course_name]) byCourse[s.course_name] = [];
      byCourse[s.course_name].push(s);
    });

    const courseOptions = Object.keys(byCourse).map(name =>
      `<option value="${name}" ${hwFeedbackCourse===name?'selected':''}>${name}</option>`
    ).join('');

    if (!hwFeedbackCourse) hwFeedbackCourse = Object.keys(byCourse)[0];

    mc.innerHTML = `
    <div class="page-section">
      <div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600;margin-bottom:14px">作业反馈</div>
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
        <select onchange="hwFeedbackCourse=this.value;renderHomeworkFeedback(document.getElementById('mainContent'))" style="font-size:12px;padding:6px 10px">
          ${courseOptions}
        </select>
        <button onclick="hwBatchDownload()" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:5px 10px;cursor:pointer;font-family:inherit">📦 批量下载作业</button>
        <button onclick="document.getElementById('hw_batch_upload').click()" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:5px 10px;cursor:pointer;font-family:inherit">📤 批量上传批改</button>
        <input type="file" id="hw_batch_upload" multiple accept="image/*,.pdf,.doc,.docx" style="display:none" onchange="hwBatchUpload(this)">
      </div>
      <div id="hw_session_list"></div>
    </div>`;

    renderHwSessionList(byCourse[hwFeedbackCourse] || []);
  } catch(e) {
    mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`;
  }
}

async function renderHwSessionList(sessions) {
  const wrap = document.getElementById('hw_session_list');
  if (!wrap) return;

  // 拉取这些 session 的所有作业记录
  const sessionIds = sessions.map(s => `"${s.id}"`).join(',');
  const records = await sb(
    `/rest/v1/session_records?session_id=in.(${sessionIds})&select=*&order=student_name.asc`
  ).catch(() => []);
  hwFeedbackRecords = records;

  wrap.innerHTML = sessions.map(s => {
    const recs = records.filter(r => r.session_id === s.id);
    const submitted = recs.filter(r => r.homework_submitted || r.homework_file_url).length;
    const f = fmtSessionDate(s.session_date);
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;margin-bottom:8px;overflow:hidden">
      <div onclick="toggleHwSession('${s.id}')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer">
        <div>
          <span style="font-size:13px;font-weight:600">${f.short} ${f.dow}</span>
          ${s.session_title ? `<span style="font-size:11px;color:var(--text-3);margin-left:8px">${s.session_title}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;color:var(--text-muted)">${submitted} 份已提交</span>
          <span style="font-size:11px;color:var(--text-3)">▾</span>
        </div>
      </div>
      <div id="hw_session_${s.id}" style="display:none;border-top:1px solid var(--border-light)">
        ${recs.length ? recs.map(r => renderHwRecord(r, s)).join('') : '<div style="padding:12px 14px;font-size:11px;color:var(--text-muted)">暂无提交记录</div>'}
      </div>
    </div>`;
  }).join('');
}

function renderHwRecord(r, s) {
  const hasFile = !!r.homework_file_url;
  const hasFeedback = !!(r.feedback_knowledge || r.feedback_attitude || r.feedback_suggestions);
  const teacherUploaded = !!r.teacher_file_url;
  return `<div style="padding:10px 14px;border-bottom:1px solid var(--border-light);display:flex;align-items:flex-start;gap:12px">
    <div style="flex:1">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px">${r.student_name}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        ${hasFile ? `<a href="${r.homework_file_url}" target="_blank" style="font-size:11px;color:var(--accent)">📎 下载作业</a>` : '<span style="font-size:11px;color:var(--text-muted)">未提交</span>'}
        ${teacherUploaded ? `<a href="${r.teacher_file_url}" target="_blank" style="font-size:11px;color:var(--ok)">✓ 已上传批改</a>` : ''}
        ${hasFeedback ? `<span style="font-size:11px;color:var(--ok)">✓ 已反馈</span>` : ''}
      </div>
    </div>
    <button onclick="openHwFeedbackPanel('${r.id}','${r.student_name}')" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 10px;cursor:pointer;font-family:inherit;white-space:nowrap">
      ${hasFeedback||teacherUploaded ? '查看/编辑反馈' : '填写反馈'}
    </button>
  </div>
  <!-- 反馈面板 -->
  <div id="hw_panel_${r.id}" style="display:none;padding:12px 14px;background:var(--bg);border-bottom:1px solid var(--border-light)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div>
        <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">知识掌握情况</div>
        <textarea id="hw_fb_knowledge_${r.id}" rows="2" style="font-size:11px;width:100%;box-sizing:border-box">${r.feedback_knowledge||''}</textarea>
      </div>
      <div>
        <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">学习态度</div>
        <textarea id="hw_fb_attitude_${r.id}" rows="2" style="font-size:11px;width:100%;box-sizing:border-box">${r.feedback_attitude||''}</textarea>
      </div>
      <div style="grid-column:1/-1">
        <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">建议</div>
        <textarea id="hw_fb_suggestions_${r.id}" rows="2" style="font-size:11px;width:100%;box-sizing:border-box">${r.feedback_suggestions||''}</textarea>
      </div>
    </div>
    <div style="margin-bottom:10px">
      <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">上传批改文件（可选）</div>
      <div style="display:flex;gap:6px">
        <input type="file" id="hw_teacher_file_${r.id}" accept="image/*,.pdf,.doc,.docx" style="font-size:11px;flex:1">
        <button onclick="uploadHwTeacherFile('${r.id}','${s.id}')" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 10px;cursor:pointer;font-family:inherit;white-space:nowrap">上传</button>
      </div>
    </div>
    <div style="display:flex;gap:6px">
      <button onclick="saveHwFeedback('${r.id}','${s.id}')" style="font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:5px 12px;cursor:pointer;font-family:inherit">保存反馈</button>
      <button onclick="document.getElementById('hw_panel_${r.id}').style.display='none'" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:5px 10px;cursor:pointer;font-family:inherit">收起</button>
    </div>
    <div id="hw_fb_result_${r.id}" style="margin-top:6px;font-size:11px"></div>
  </div>`;
}

function openHwFeedbackPanel(recordId, studentName) {
  const panel = document.getElementById(`hw_panel_${recordId}`);
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function toggleHwSession(sessionId) {
  const el = document.getElementById(`hw_session_${sessionId}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function saveHwFeedback(recordId, sessionId) {
  const result = document.getElementById(`hw_fb_result_${recordId}`);
  const data = {
    feedback_knowledge: document.getElementById(`hw_fb_knowledge_${recordId}`)?.value || '',
    feedback_attitude: document.getElementById(`hw_fb_attitude_${recordId}`)?.value || '',
    feedback_suggestions: document.getElementById(`hw_fb_suggestions_${recordId}`)?.value || '',
  };
  try {
    await sb(`/rest/v1/session_records?id=eq.${recordId}`, 'PATCH', data);
    if (result) { result.innerHTML = '<span style="color:var(--ok)">✓ 已保存</span>'; setTimeout(()=>result.innerHTML='', 2000); }
  } catch(e) { if (result) result.innerHTML = `<span style="color:var(--danger)">保存失败：${e.message}</span>`; }
}

async function uploadHwTeacherFile(recordId, sessionId) {
  const fileInput = document.getElementById(`hw_teacher_file_${recordId}`);
  const result = document.getElementById(`hw_fb_result_${recordId}`);
  const file = fileInput?.files[0];
  if (!file) { if(result) result.innerHTML = '<span style="color:var(--danger)">请选择文件</span>'; return; }
  const rec = hwFeedbackRecords.find(r => r.id === recordId);
  if (!rec) return;
  const ext = file.name.split('.').pop();
  const path = `homework-feedback/${recordId}.${ext}`;  // 用 record_id 命名，避免中文路径问题
  try {
    if (result) result.innerHTML = '<span style="color:var(--text-muted)">上传中…</span>';
    const url = await sbUpload('teacher-files', path, file);
    await sb(`/rest/v1/session_records?id=eq.${recordId}`, 'PATCH', { teacher_file_url: url });
    rec.teacher_file_url = url;
    if (result) { result.innerHTML = '<span style="color:var(--ok)">✓ 上传成功</span>'; setTimeout(()=>result.innerHTML='', 2000); }
  } catch(e) { if(result) result.innerHTML = `<span style="color:var(--danger)">上传失败：${e.message}</span>`; }
}

async function hwBatchDownload() {
  const recs = hwFeedbackRecords.filter(r => r.homework_file_url);
  if (!recs.length) { alert('暂无可下载的作业文件'); return; }
  // 下载时文件名改成「record_id.ext」，方便批改后对号上传
  for (const r of recs) {
    try {
      const res = await fetch(r.homework_file_url);
      const blob = await res.blob();
      const ext = (r.homework_file_url.split('.').pop() || 'file').split('?')[0].slice(0, 5);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${r.id}.${ext}`;  // 文件名 = record_id.ext
      a.click();
      URL.revokeObjectURL(a.href);
      await new Promise(res => setTimeout(res, 400));
    } catch(e) {
      // fetch 失败时直接打开链接
      window.open(r.homework_file_url, '_blank');
      await new Promise(res => setTimeout(res, 400));
    }
  }
  alert(`已下载 ${recs.length} 份作业，文件名格式为「记录ID.扩展名」，批改后直接上传即可自动匹配学生`);
}

async function hwBatchUpload(input) {
  const files = [...input.files];
  if (!files.length) return;
  let success = 0, fail = 0, failNames = [];
  for (const file of files) {
    // 从文件名提取 record_id（格式：record_id.ext，record_id 就是 session_records 的 id）
    const recordId = file.name.replace(/\.[^.]+$/, '');
    const matched = hwFeedbackRecords.find(r => r.id === recordId);
    if (!matched) { fail++; failNames.push(file.name); continue; }
    const ext = file.name.split('.').pop();
    const path = `homework-feedback/${recordId}.${ext}`;
    try {
      const url = await sbUpload('teacher-files', path, file);
      await sb(`/rest/v1/session_records?id=eq.${recordId}`, 'PATCH', { teacher_file_url: url });
      matched.teacher_file_url = url;
      success++;
    } catch(e) { fail++; failNames.push(file.name); }
  }
  const msg = `批量上传完成：${success} 成功，${fail} 失败` + (failNames.length ? `
失败文件：${failNames.join('、')}` : '');
  alert(msg);
  renderHwSessionList(hwFeedbackSessions.filter(s => s.course_name === hwFeedbackCourse));
  input.value = '';
}


let myScheduleView = 'list';
let myScheduleCalMonth = null;

function renderMySchedule(mc) {
  // VIP 已确认预约也要并入课表（这是老师要上的课，必须和大课一样被看到）
  const vipSessions = (cachedTeacherBookings || [])
    .filter(b => b.type === 'vip' && b.status === 'confirmed')
    .map(b => ({
      _isVip: true,
      id: b.id,
      session_date: b.slot_date,
      time_range: b.slot_time_range,
      course_name: `${b.name} 的VIP课程`,
      session_title: b.vip_session_notes ? '' : ((cachedTeacherSlots.find(s => s.id === b.slot_id)?.vip_content || []).join('・') || '内容待定'),
      vip_booking: b,
    }));
  const allSessions = [...confirmedSessions, ...vipSessions];

  if (!allSessions.length) { mc.innerHTML = '<div class="empty">暂无已确定的课程<br><span style="font-size:11px">排课确认后这里会显示您的完整课表</span></div>'; return; }
  if (!myScheduleCalMonth) {
    const today = new Date().toISOString().slice(0,7);
    const future = allSessions.filter(s => s.session_date >= today);
    myScheduleCalMonth = (future.length ? future.sort((a,b)=>a.session_date.localeCompare(b.session_date))[0].session_date : allSessions[0].session_date).slice(0,7);
  }
  const monthNames = { '01': '一月', '02': '二月', '03': '三月', '04': '四月', '05': '五月', '06': '六月', '07': '七月', '08': '八月', '09': '九月', '10': '十月', '11': '十一月', '12': '十二月' };

  // 列表视图：只显示今天及以后的课次，已上完的收进历史
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcomingSessions = allSessions.filter(s => s.session_date >= todayStr).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  const pastSessions = allSessions.filter(s => s.session_date < todayStr).sort((a,b)=>a.session_date.localeCompare(b.session_date));

  const byMonthUpcoming = {};
  upcomingSessions.forEach(s => { const m = s.session_date.slice(0, 7); if (!byMonthUpcoming[m]) byMonthUpcoming[m] = []; byMonthUpcoming[m].push(s); });

  const byMonthAll = {};
  allSessions.forEach(s => { const m = s.session_date.slice(0, 7); if (!byMonthAll[m]) byMonthAll[m] = []; byMonthAll[m].push(s); });

  const listHtml = Object.entries(byMonthUpcoming).map(([ym, sessions]) => `
    <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);padding:10px 0 6px;border-bottom:1px solid var(--border-light);margin-bottom:8px">
      ${ym.slice(0, 4)}年 ${monthNames[ym.slice(5, 7)] || ym.slice(5, 7) + '月'} · ${sessions.length}课次
    </div>
    ${sessions.map(s => s._isVip ? renderMyVipRow(s.vip_booking, s) : renderMySessionRow(s)).join('')}`).join('')
    || '<div style="font-size:12px;color:var(--text-3);padding:12px 0">近期暂无排课</div>';

  const historyHtml = pastSessions.length ? `
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-light)">
      <div style="cursor:pointer;font-size:11px;color:var(--text-3);padding:4px 0" onclick="toggleScheduleHistory()">
        <span id="sched_history_arrow">▸</span> 已上完的课次（${pastSessions.length} 节）
      </div>
      <div id="sched_history_body" style="display:none;margin-top:8px">
        ${[...pastSessions].reverse().map(s => s._isVip ? renderMyVipRow(s.vip_booking, s) : renderMySessionRow(s)).join('')}
      </div>
    </div>` : '';

  const calHtml = renderMyCalendar(myScheduleCalMonth, byMonthAll, monthNames);
  mc.innerHTML = `
  <div class="page-section">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600">我的课表</div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="font-size:11px;color:var(--text-3)">共 ${allSessions.length} 课次</div>
        <div style="display:flex;border:1px solid var(--border);border-radius:3px;overflow:hidden">
          <button onclick="setMyScheduleView('list')" style="padding:4px 10px;font-size:11px;border:none;cursor:pointer;font-family:inherit;background:${myScheduleView==='list'?'var(--accent)':'var(--surface)'};color:${myScheduleView==='list'?'#fff':'var(--text-2)'}">列表</button>
          <button onclick="setMyScheduleView('calendar')" style="padding:4px 10px;font-size:11px;border:none;border-left:1px solid var(--border);cursor:pointer;font-family:inherit;background:${myScheduleView==='calendar'?'var(--accent)':'var(--surface)'};color:${myScheduleView==='calendar'?'#fff':'var(--text-2)'}">日历</button>
        </div>
      </div>
    </div>
    <div id="myScheduleBody">
      ${myScheduleView === 'list' ? listHtml + historyHtml : calHtml}
    </div>
  </div>`;
}

function toggleScheduleHistory() {
  const body = document.getElementById('sched_history_body');
  const arrow = document.getElementById('sched_history_arrow');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▸' : '▾';
}

function setMyScheduleView(v) {
  myScheduleView = v;
  renderMySchedule(document.getElementById('mainContent'));
}

function shiftMyCalMonth(delta) {
  const [y, m] = myScheduleCalMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  myScheduleCalMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  renderMySchedule(document.getElementById('mainContent'));
}

// ── VIP 上课记录填写 ──
const VIP_CONTENT_OPTIONS = ['专业课指导', '过去问对策', '研究计划书', '出愿指导', '面试对策', 'TA指导'];

function openVipSessionRecord(bookingId) {
  const b = cachedTeacherBookings.find(x => x.id === bookingId);
  if (!b) return;
  const slot = cachedTeacherSlots.find(x => x.id === b.slot_id);
  const availableContent = slot?.vip_content || VIP_CONTENT_OPTIONS;
  const existing = document.getElementById('vipRecordModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'vipRecordModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;max-width:420px;width:100%;max-height:88vh;overflow-y:auto">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">${b.name} 的VIP上课记录</div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:14px">${b.slot_date} ${b.slot_time_range || ''}</div>
      <div class="form-group"><label class="form-label">本次实际授课内容（可多选）</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="vip_content_select">
          ${availableContent.map(c => `<label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer;border:1px solid var(--border);border-radius:3px;padding:4px 10px">
            <input type="checkbox" value="${c}" ${b.vip_content && b.vip_content.includes(c) ? 'checked' : ''} style="accent-color:var(--accent);width:14px;height:14px">${c}
          </label>`).join('')}
        </div>
      </div>
      <div class="form-group"><label class="form-label">上课内容 / 学生状态</label>
        <textarea id="vip_notes" rows="4" placeholder="本次课讲了什么、学生当前状态如何…">${b.vip_session_notes || ''}</textarea>
      </div>
      <div class="form-group"><label class="form-label">布置作业（学生将在VIP页面看到并提交）</label>
        <textarea id="vip_homework" rows="3" placeholder="下节课前请完成…">${b.vip_homework || ''}</textarea>
      </div>
      <div class="form-group"><label class="form-label">本次耗时（小时，保存后将自动从学生VIP总课时中扣除）</label>
        <input type="number" id="vip_hours" step="0.5" min="0" value="${b.vip_hours_used || ''}" placeholder="例：1.5"></div>
      ${b.vip_homework_file_url ? `
      <div style="background:var(--ok-bg);border:1px solid var(--ok);border-radius:3px;padding:10px 12px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:600;color:var(--ok);margin-bottom:6px">📎 学生已提交作业</div>
        <a href="${b.vip_homework_file_url}" target="_blank" style="font-size:12px;color:var(--accent)">下载学生提交文件</a>
        <div style="margin-top:8px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">批改反馈（文字）</div>
          <textarea id="vip_hw_feedback" rows="2" placeholder="批改意见…">${b.vip_homework_feedback || ''}</textarea>
          <div style="font-size:11px;color:var(--text-3);margin:6px 0 4px">上传批改文件（可选）</div>
          <input type="file" id="vip_hw_feedback_file" accept=".doc,.docx,.pdf,image/*" style="font-size:11px">
        </div>
      </div>` : ''}
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-primary btn-sm" onclick="saveVipSessionRecord('${bookingId}')">保存</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('vipRecordModal').remove()">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function saveVipSessionRecord(bookingId) {
  const b = cachedTeacherBookings.find(x => x.id === bookingId);
  if (!b) return;
  const content = [...document.querySelectorAll('#vip_content_select input:checked')].map(c => c.value);
  const notes = document.getElementById('vip_notes').value.trim();
  const newHours = parseFloat(document.getElementById('vip_hours').value) || 0;
  if (!content.length) { alert('请至少勾选一项本次授课内容'); return; }
  if (!notes) { alert('请填写上课内容/学生状态/作业安排'); return; }
  if (newHours <= 0) { alert('请填写本次耗时'); return; }

  const prevHours = b.vip_hours_used || 0; // 若是重新编辑，先扣除上次记录的耗时再加上新的，避免重复扣减
  try {
    // 找到学生档案，调整课时（先退回旧耗时，再扣新耗时）
    const students = await sb(`/rest/v1/students?name=eq.${encodeURIComponent(b.name)}&select=id,vip_hours_used`);
    if (students.length) {
      const stu = students[0];
      const newUsed = Math.max(0, (stu.vip_hours_used || 0) - prevHours + newHours);
      await sb(`/rest/v1/students?id=eq.${stu.id}`, 'PATCH', { vip_hours_used: newUsed });
    }
    const homework = document.getElementById('vip_homework')?.value.trim() || b.vip_homework || '';
    const hwFeedback = document.getElementById('vip_hw_feedback')?.value.trim() || '';

    // 上传批改文件（如果有）
    let hwFeedbackFileUrl = b.vip_homework_feedback_file_url || '';
    const hwFileEl = document.getElementById('vip_hw_feedback_file');
    if (hwFileEl?.files[0]) {
      const f = hwFileEl.files[0];
      const ext = f.name.split('.').pop().toLowerCase();
      const path = `${b.major || 'vip'}/${Date.now()}_feedback.${ext}`;
      hwFeedbackFileUrl = await sbUpload('teacher-files', path, f);
    }

    await sb(`/rest/v1/bookings?id=eq.${bookingId}`, 'PATCH', {
      vip_content: content.join('・'),
      vip_session_notes: notes,
      vip_hours_used: newHours,
      vip_homework: homework,
      vip_homework_feedback: hwFeedback,
      vip_homework_feedback_file_url: hwFeedbackFileUrl,
      student_confirmed: false,
      status: 'completed',
    });
    Object.assign(b, { vip_content: content.join('・'), vip_session_notes: notes, vip_hours_used: newHours, vip_homework: homework, vip_homework_feedback: hwFeedback, vip_homework_feedback_file_url: hwFeedbackFileUrl, student_confirmed: false, status: 'completed' });
    document.getElementById('vipRecordModal').remove();
    renderMySchedule(document.getElementById('mainContent'));
    alert('上课记录已保存，课时已扣除。建议点击「生成确认链接文案」发给学生确认。');
  } catch (e) { alert('保存失败：' + e.message); }
}

async function openVipConfirmText(bookingId) {
  const b = cachedTeacherBookings.find(x => x.id === bookingId);
  if (!b) return;
  let code = '（未生成，请联系管理员在学生档案中生成查询码）';
  try {
    const students = await sb(`/rest/v1/students?name=eq.${encodeURIComponent(b.name)}&select=student_code`);
    if (students.length && students[0].student_code) code = students[0].student_code;
  } catch (e) { /* 拉取失败不阻断，使用默认提示文字 */ }
  const text = `【唯新教育】${b.name}同学，您本次VIP课程已完成，请前往以下页面确认并评价：\nhttps://edsched.github.io/transform/vip/\n姓名：${b.name}\n查询码：${code}`;
  const existing = document.getElementById('vipConfirmTextModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'vipConfirmTextModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;max-width:380px;width:100%">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px">发给学生的确认文案</div>
      <textarea id="vip_confirm_text_area" rows="7" style="font-size:12px;width:100%">${text}</textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary btn-sm" onclick="copyVipConfirmText()">复制文案</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('vipConfirmTextModal').remove()">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function copyVipConfirmText() {
  const ta = document.getElementById('vip_confirm_text_area');
  if (!ta) return;
  navigator.clipboard.writeText(ta.value).then(() => alert('已复制，可直接发给学生'));
}

// ── VIP 时间调整（老师需填理由）──
function openVipReschedule(bookingId) {
  const b = cachedTeacherBookings.find(x => x.id === bookingId);
  if (!b) return;
  const existing = document.getElementById('vipRescheduleModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'vipRescheduleModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;max-width:380px;width:100%">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">调整 ${b.name} 的VIP课程时间</div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:14px">原时间：${b.slot_date} ${b.slot_time_range || ''}</div>
      <div class="form-group"><label class="form-label">新日期</label><input type="date" id="vip_resched_date" value="${b.slot_date}"></div>
      <div class="form-group"><label class="form-label">新时间段</label>
        <div style="display:grid;grid-template-columns:1fr 16px 1fr;gap:4px;align-items:center">
          <input type="time" id="vip_resched_start" value="${(b.slot_time_range||'').split(/[–\\-]/)[0]?.trim()||''}">
          <div style="text-align:center;font-size:11px;color:var(--text-3)">—</div>
          <input type="time" id="vip_resched_end" value="${(b.slot_time_range||'').split(/[–\\-]/)[1]?.trim()||''}">
        </div>
      </div>
      <div class="form-group"><label class="form-label">调整原因（必填）</label>
        <select id="vip_resched_reason_select" onchange="document.getElementById('vip_resched_reason_other').style.display=this.value==='其他'?'block':'none'">
          <option value="">请选择</option>
          <option>学生迟到</option>
          <option>学生请假</option>
          <option>学生生病</option>
          <option>老师临时有事</option>
          <option>其他</option>
        </select>
        <input id="vip_resched_reason_other" placeholder="请说明具体原因" style="display:none;margin-top:6px">
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-primary btn-sm" onclick="saveVipReschedule('${bookingId}')">保存</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('vipRescheduleModal').remove()">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function saveVipReschedule(bookingId) {
  const b = cachedTeacherBookings.find(x => x.id === bookingId);
  if (!b) return;
  const date = document.getElementById('vip_resched_date').value;
  const start = document.getElementById('vip_resched_start').value;
  const end = document.getElementById('vip_resched_end').value;
  const reasonSel = document.getElementById('vip_resched_reason_select').value;
  const reasonOther = document.getElementById('vip_resched_reason_other').value.trim();
  const reason = reasonSel === '其他' ? reasonOther : reasonSel;
  if (!date || !start || !end) { alert('请填写完整的新日期和时间'); return; }
  if (!reason) { alert('请填写调整原因'); return; }
  const timeRange = `${start}\u2013${end}`;
  try {
    // 生成系统留言通知学生
    const d = new Date(date + 'T12:00:00');
    const dow = DAYS_CN[d.getDay()];
    const sysMsg = {
      from: 'system',
      text: `【时间调整通知】老师已将您的VIP课程调整为：${date}（${dow}）${timeRange}。调整原因：${reason}。如有疑问请留言联系老师。`,
      ts: Date.now()
    };
    const newMessages = [...(b.messages || []), sysMsg];
    await sb(`/rest/v1/bookings?id=eq.${bookingId}`, 'PATCH', {
      slot_date: date, slot_time_range: timeRange,
      reschedule_reason: reason, reschedule_by: teacherName,
      messages: newMessages,
    });
    Object.assign(b, { slot_date: date, slot_time_range: timeRange, reschedule_reason: reason, reschedule_by: teacherName, messages: newMessages });
    document.getElementById('vipRescheduleModal').remove();
    renderMySchedule(document.getElementById('mainContent'));
    alert('时间已调整，已自动发送通知给学生。');
  } catch (e) { alert('保存失败：' + e.message); }
}

// ── VIP 留言 ──
function openVipMessages(bookingId) {
  const b = cachedTeacherBookings.find(x => x.id === bookingId);
  if (!b) return;
  const messages = b.messages || [];
  const existing = document.getElementById('vipMessagesModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'vipMessagesModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;max-width:380px;width:100%;max-height:80vh;display:flex;flex-direction:column">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px">与 ${b.name} 的留言</div>
      <div id="vip_teacher_messages_list" style="flex:1;overflow-y:auto;margin-bottom:10px;max-height:300px">
        ${messages.length ? messages.map(m => `
          <div style="font-size:12px;margin-bottom:8px;${m.from==='teacher'?'text-align:right':''}">
            <span style="display:inline-block;max-width:80%;background:${m.from==='teacher'?'var(--accent)':'var(--bg)'};color:${m.from==='teacher'?'#fff':'inherit'};border-radius:8px;padding:6px 11px;text-align:left">
              <div style="font-size:9px;opacity:.7;margin-bottom:2px">${m.from==='teacher'?'我':b.name}</div>
              ${m.text}
            </span>
          </div>`).join('') : '<div style="font-size:11px;color:var(--text-3)">暂无留言</div>'}
      </div>
      <div style="display:flex;gap:6px">
        <input type="text" id="vip_teacher_message_input" placeholder="回复留言…" style="flex:1;font-size:12px">
        <button class="btn btn-primary btn-sm" onclick="sendVipTeacherMessage('${bookingId}')">发送</button>
      </div>
      <button class="btn btn-outline btn-sm" style="margin-top:10px" onclick="document.getElementById('vipMessagesModal').remove()">关闭</button>
    </div>`;
  document.body.appendChild(modal);
}

const VIP_MSG_LIMIT = 30;

async function sendVipTeacherMessage(bookingId) {
  const input = document.getElementById('vip_teacher_message_input');
  const text = input.value.trim();
  if (!text) return;
  const b = cachedTeacherBookings.find(x => x.id === bookingId);
  if (!b) return;
  if ((b.messages || []).length >= VIP_MSG_LIMIT) {
    alert(`每个预约最多 ${VIP_MSG_LIMIT} 条留言，当前已达上限。如需继续沟通请通过其他方式联系学生。`);
    return;
  }
  const newMessages = [...(b.messages || []), { from: 'teacher', text, ts: Date.now() }];
  try {
    await sb(`/rest/v1/bookings?id=eq.${bookingId}`, 'PATCH', { messages: newMessages });
    b.messages = newMessages;
    document.getElementById('vipMessagesModal').remove();
    openVipMessages(bookingId);
  } catch (e) { alert('发送失败：' + e.message); }
}

function renderMyVipRow(b, s) {
  const d = new Date(b.slot_date + 'T12:00:00');
  const dow = DAYS_CN[d.getDay()];
  const hasRecord = !!b.vip_session_notes;
  const isPast = b.slot_date < new Date().toISOString().slice(0, 10);
  return `<div style="background:#f0edf8;border:1px solid #c8bfe8;border-radius:4px;margin-bottom:8px;padding:12px 14px">
    <div style="display:flex;align-items:flex-start;gap:14px">
      <div style="text-align:center;min-width:44px">
        <div style="font-size:17px;font-weight:700;font-family:'DM Mono',monospace;color:#5a3a9a">${d.getMonth() + 1}/${d.getDate()}</div>
        <div style="font-size:10px;font-weight:600;color:#5a3a9a">${dow}</div>
      </div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
          <span style="font-family:'Noto Serif SC',serif;font-weight:600;font-size:13px">${b.name} 的VIP课程</span>
          <span style="font-size:9px;background:#5a3a9a;color:#fff;border-radius:2px;padding:1px 6px">VIP</span>
          ${hasRecord ? `<span style="font-size:9px;background:var(--ok-bg);color:var(--ok);border-radius:2px;padding:1px 6px">已记录</span>` : (isPast ? `<span style="font-size:9px;background:#fff3cd;color:#856404;border-radius:2px;padding:1px 6px">待填写</span>` : '')}
          ${(b.messages||[]).length ? `<span style="font-size:9px;background:#e8f0fb;color:#1a6a9a;border-radius:2px;padding:1px 6px">💬 ${b.messages.length}</span>` : ''}
        </div>
        <div style="font-size:11px;color:var(--text-3)">${b.slot_time_range || ''} · ${(cachedTeacherSlots.find(x => x.id === b.slot_id)?.vip_content || []).join('・') || ''}</div>
        ${b.location ? `<div style="font-size:11px;color:${locationColor(b.location)};margin-top:2px">📍 ${locationLong(b.location) || '线上'}</div>` : ''}
        ${b.student_content ? `<div style="font-size:11px;color:var(--text-2);background:var(--bg);border-radius:2px;padding:6px 8px;margin-top:6px;white-space:pre-wrap">📄 ${b.student_content}</div>` : ''}
        ${b.student_file_url ? `<a href="${b.student_file_url}" target="_blank" style="font-size:11px;color:var(--accent);display:block;margin-top:4px">📎 学生上传文件下载</a>` : ''}
        ${hasRecord ? `<div style="font-size:11px;color:var(--text-2);margin-top:3px">📝 ${b.vip_session_notes}</div>` : ''}
        ${b.student_confirmed ? `<div style="font-size:11px;color:var(--ok);margin-top:3px">✓ 学生已确认${b.student_rating ? '・评价：' + b.student_rating : ''}</div>` : (hasRecord ? `<div style="font-size:11px;color:#856404;margin-top:3px">⏳ 等待学生确认</div>` : '')}
        ${b.reschedule_reason ? `<div style="font-size:10px;color:var(--text-3);margin-top:3px">🔄 已调整时间・原因：${b.reschedule_reason}</div>` : ''}
      </div>
    </div>
    ${b.vip_room ? `<div style="font-size:11px;color:var(--ok);margin-top:3px">🏫 教室：${b.vip_room}</div>` : ''}
    ${b.vip_meeting_url ? `<div style="font-size:11px;color:#1a6a9a;margin-top:3px">💻 <a href="${b.vip_meeting_url}" target="_blank" style="color:#1a6a9a">${b.vip_meeting_url}</a></div>` : ''}
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid #ddd5f0;display:flex;gap:6px;flex-wrap:wrap">
      ${b.status === 'pending' ? `<button class="btn btn-sm" style="background:var(--ok);color:#fff;border:none;border-radius:3px;padding:5px 12px;font-size:11px;cursor:pointer;font-family:inherit" onclick="openVipConfirmModal('${b.id}')">✓ 确认预约</button>` : ''}
      ${b.status === 'pending' ? `<button class="btn btn-outline btn-sm" onclick="openVipRoomBookText('${b.id}')">🏫 预约教室文案</button>` : ''}
      <button class="btn btn-outline btn-sm" onclick="openVipSessionRecord('${b.id}')">${b.student_confirmed ? '查看上课记录' : hasRecord ? '编辑上课记录' : '填写上课记录'}</button>
      ${hasRecord && !b.student_confirmed ? `<button class="btn btn-outline btn-sm" onclick="openVipConfirmText('${b.id}')">📋 生成确认链接文案</button>` : ''}
      ${!hasRecord && b.status !== 'completed' ? `<button class="btn btn-outline btn-sm" onclick="openVipReschedule('${b.id}')">🔄 调整时间</button>` : ''}
      <button class="btn btn-outline btn-sm" onclick="openVipMessages('${b.id}')">💬 留言</button>
    </div>
  </div>`;
}

// ── 预约教室文案 ──
function openVipRoomBookText(bookingId) {
  const b = cachedTeacherBookings.find(x => x.id === bookingId);
  if (!b) return;
  const d = new Date(b.slot_date + 'T12:00:00');
  const dow = DAYS_CN[d.getDay()];
  const month = d.getMonth() + 1, day = d.getDate();
  const campus = b.location === 'offline_takadanobaba' ? '高田马场' :
                 b.location === 'offline_ichigaya' ? '市谷' :
                 b.location === 'both_takadanobaba' ? '高田马场' :
                 b.location === 'both_ichigaya' ? '市谷' : '校区';
  const major = (typeof MAJORS !== 'undefined' ? MAJORS[b.major] || b.major : b.major) || '';
  const text = `老师好！麻烦预约${campus}，${month}月${day}日${dow}，${b.slot_time_range || ''}，${major}，${b.name}同学的VIP教室。谢谢！`;

  const existing = document.getElementById('vipRoomBookModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'vipRoomBookModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;max-width:420px;width:100%">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px">📋 预约教室文案</div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:10px;font-size:12px;line-height:1.7;margin-bottom:12px">${text}</div>
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">预约好后填写教室号：</div>
        <input id="vip_room_input" placeholder="例：VIP1、高马VIP2…" style="font-size:12px;width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="navigator.clipboard.writeText('${text.replace(/'/g,"\'")}').then(()=>{const b=this;b.textContent='✓ 已复制';setTimeout(()=>b.textContent='复制文案',1500)})" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:9px;font-size:12px;cursor:pointer;font-family:inherit">复制文案</button>
        <button onclick="saveVipRoom('${bookingId}')" style="flex:1;background:var(--ok);color:#fff;border:none;border-radius:3px;padding:9px;font-size:12px;cursor:pointer;font-family:inherit">保存教室号</button>
        <button onclick="document.getElementById('vipRoomBookModal').remove()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:9px 14px;font-size:12px;cursor:pointer;font-family:inherit">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const existing_room = b.vip_room || '';
  document.getElementById('vip_room_input').value = existing_room;
}

async function saveVipRoom(bookingId) {
  const room = document.getElementById('vip_room_input').value.trim();
  const b = cachedTeacherBookings.find(x => x.id === bookingId);
  if (!b) return;
  try {
    await sb(`/rest/v1/bookings?id=eq.${bookingId}`, 'PATCH', { vip_room: room });
    b.vip_room = room;
    document.getElementById('vipRoomBookModal').remove();
    renderBookingManagement(document.getElementById('mainContent'));
  } catch(e) { alert('保存失败：' + e.message); }
}

// ── VIP确认modal（线下填教室，线上填会议链接）──
function openVipConfirmModal(bookingId) {
  const b = cachedTeacherBookings.find(x => x.id === bookingId);
  if (!b) return;
  const isOffline = b.location && (b.location.startsWith('offline') || b.location.startsWith('both'));
  const isOnline = !b.location || b.location === 'online' || b.location.startsWith('both');
  const existing = document.getElementById('vipConfirmModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'vipConfirmModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;max-width:380px;width:100%">
      <div style="font-size:13px;font-weight:600;margin-bottom:14px">确认VIP预约 · ${b.name}</div>
      <div style="font-size:11px;color:var(--text-2);margin-bottom:14px">${b.slot_date} ${b.slot_time_range || ''} · ${locationLong(b.location) || '线上'}</div>
      ${isOffline ? `
      <div class="form-group">
        <label class="form-label">教室号（线下上课必填）</label>
        <input id="vcm_room" value="${b.vip_room||''}" placeholder="例：VIP1、高马VIP2…">
      </div>` : ''}
      ${isOnline ? `
      <div class="form-group">
        <label class="form-label">腾讯会议链接${isOffline?'（可选）':'（建议填写）'}</label>
        <input id="vcm_meeting" value="${b.vip_meeting_url||''}" placeholder="https://meeting.tencent.com/…">
      </div>` : ''}
      <div style="display:flex;gap:8px;margin-top:6px">
        <button onclick="confirmVipWithDetails('${bookingId}')" style="flex:1;background:var(--ok);color:#fff;border:none;border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">✓ 确认预约</button>
        <button onclick="document.getElementById('vipConfirmModal').remove()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:10px 14px;font-size:12px;cursor:pointer;font-family:inherit">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function confirmVipWithDetails(bookingId) {
  const b = cachedTeacherBookings.find(x => x.id === bookingId);
  if (!b) return;
  const isOffline = b.location && (b.location.startsWith('offline') || b.location.startsWith('both'));
  const room = document.getElementById('vcm_room')?.value.trim() || '';
  const meeting = document.getElementById('vcm_meeting')?.value.trim() || '';
  if (isOffline && !room) { alert('线下课程请填写教室号'); return; }
  try {
    await sb(`/rest/v1/bookings?id=eq.${bookingId}`, 'PATCH', {
      status: 'confirmed',
      vip_room: room,
      vip_meeting_url: meeting,
    });
    Object.assign(b, { status: 'confirmed', vip_room: room, vip_meeting_url: meeting });
    document.getElementById('vipConfirmModal').remove();
    renderBookingManagement(document.getElementById('mainContent'));
  } catch(e) { alert('确认失败：' + e.message); }
}

function renderMySessionRow(s) {
  const d = new Date(s.session_date + 'T12:00:00');
  const dow = DAYS_CN[d.getDay()];
  const dowColor = DOW_COLOR[d.getDay()] || 'var(--text-2)';
  const rowId = 'sr_' + s.id;
  const locationText = (() => {
    const loc = s.delivery;
    if (!loc || loc === 'online') return '线上';
    if (loc === 'offline_takadanobaba') return '线下 · 高田马场';
    if (loc === 'offline_ichigaya') return '线下 · 市谷';
    if (loc === 'both_takadanobaba') return '线上 / 线下均可 · 高田马场';
    if (loc === 'both_ichigaya') return '线上 / 线下均可 · 市谷';
    if (loc === 'offline') return `线下${s.campus ? ' · ' + s.campus : ''}`;
    if (loc === 'both') return `线上 / 线下均可${s.campus ? ' · ' + s.campus : ''}`;
    return s.campus || loc;
  })();
  if (s.is_cancelled) {
    return `<div style="background:rgba(0,0,0,.03);border:1px solid var(--border);border-radius:4px;margin-bottom:8px;padding:12px 14px;display:flex;align-items:center;gap:14px">
      <div style="text-align:center;min-width:44px">
        <div style="font-size:17px;font-weight:700;font-family:'DM Mono',monospace;color:var(--text-3);text-decoration:line-through">${d.getMonth() + 1}/${d.getDate()}</div>
        <div style="font-size:10px;font-weight:600;color:var(--text-3)">${dow}</div>
      </div>
      <div style="flex:1">
        <span style="font-family:'Noto Serif SC',serif;font-weight:600;font-size:13px;color:var(--text-3)">${s.course_name}</span>
        <span style="font-size:10px;background:#fff3cd;color:#856404;border-radius:2px;padding:1px 6px;margin-left:6px">休讲${s.cancel_reason ? '・' + s.cancel_reason : ''}</span>
        ${s.cancel_note ? `<div style="font-size:11px;color:var(--text-3);margin-top:3px">${s.cancel_note}</div>` : ''}
      </div>
    </div>`;
  }
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;margin-bottom:8px;cursor:pointer" onclick="toggleSessionDetail('${rowId}')">
    <div style="padding:12px 14px;display:flex;align-items:flex-start;gap:14px">
      <div style="text-align:center;min-width:44px">
        <div style="font-size:17px;font-weight:700;font-family:'DM Mono',monospace;color:${dowColor}">${d.getMonth() + 1}/${d.getDate()}</div>
        <div style="font-size:10px;font-weight:600;color:${dowColor}">${dow}</div>
      </div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
          <span style="font-family:'Noto Serif SC',serif;font-weight:600;font-size:13px">${s.course_name}</span>
          ${s.course_type ? `<span style="font-size:9px;background:var(--bg);border:1px solid var(--border-light);border-radius:2px;padding:1px 5px">${s.course_type}</span>` : ''}
          <span style="font-size:9px;color:var(--text-3);background:var(--bg);border-radius:2px;padding:1px 5px">${(()=>{const m2=d.getMonth()+1;return m2<=3?'1月期':m2<=6?'4月期':m2<=9?'7月期':'10月期'})()}</span>
          <span style="margin-left:auto;font-size:10px;color:var(--text-3)" id="${rowId}_arrow">▾ 详情</span>
        </div>
        <div style="font-size:11px;color:var(--text-3)">第${s.session_number}回 · ${s.time_range || ''} · ${locationText}</div>
        ${s.session_title ? `<div style="font-size:11px;color:var(--text-2);margin-top:3px">📌 ${s.session_title}</div>` : ''}
      </div>
    </div>
    <div id="${rowId}" style="display:none;padding:0 14px 14px 72px">
      <div style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px;font-size:11px;color:var(--text-2);line-height:1.9">
        <div>📍 上课地点：${locationText}</div>
        ${s.meeting_url ? `<div>🎥 腾讯会议：<a href="${s.meeting_url}" target="_blank" onclick="event.stopPropagation()" style="color:var(--accent)">${s.meeting_url}</a></div>` : ''}
        ${s.host_key ? `<div>🔑 主持人密钥：<span style="font-weight:600;font-family:'DM Mono',monospace">${s.host_key}</span></div>` : ''}
        <div>📹 是否需要录制：${s.needs_recording ? '<span style="color:#856404;font-weight:600">是</span>' : '否'}</div>
      </div>
    </div>
  </div>`;
}

function toggleSessionDetail(rowId) {
  const el = document.getElementById(rowId);
  const arrow = document.getElementById(rowId + '_arrow');
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▾ 详情' : '▴ 收起';
}

function renderMyCalendar(ym, byMonth, monthNames) {
  const [y, m] = ym.split('-').map(Number);
  const sessionsThisMonth = byMonth[ym] || [];
  const byDate = {};
  sessionsThisMonth.forEach(s => { byDate[s.session_date] = byDate[s.session_date] || []; byDate[s.session_date].push(s); });
  const firstDay = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);
  const dayLabels = ['日','一','二','三','四','五','六'];
  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += `<div></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = ym + '-' + String(day).padStart(2, '0');
    const sessions = byDate[dateStr] || [];
    const isToday = dateStr === today;
    cells += `<div style="min-height:64px;border:1px solid var(--border-light);border-radius:3px;padding:4px 5px;background:${sessions.length?'var(--surface)':'transparent'}">
      <div style="font-size:11px;font-weight:${isToday?700:400};color:${isToday?'var(--accent)':sessions.length?'var(--text)':'var(--text-3)'};margin-bottom:3px">${day}</div>
      ${sessions.map(s => `<div style="font-size:9px;background:var(--accent);color:#fff;border-radius:2px;padding:1px 4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${s.course_name} 第${s.session_number}回 ${s.time_range||''}">${s.course_name}</div>`).join('')}
    </div>`;
  }
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <button onclick="shiftMyCalMonth(-1)" style="background:none;border:1px solid var(--border);border-radius:3px;padding:4px 10px;cursor:pointer;font-size:13px">‹</button>
      <div style="font-size:13px;font-weight:600">${y}年 ${monthNames[String(m).padStart(2,'0')] || m+'月'}</div>
      <button onclick="shiftMyCalMonth(1)" style="background:none;border:1px solid var(--border);border-radius:3px;padding:4px 10px;cursor:pointer;font-size:13px">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:10px">
      ${dayLabels.map(l => `<div style="font-size:10px;text-align:center;color:var(--text-3);padding-bottom:4px">${l}</div>`).join('')}
      ${cells}
    </div>
    ${sessionsThisMonth.length ? `
      <div style="font-size:10px;color:var(--text-3);margin:10px 0 6px;border-top:1px solid var(--border-light);padding-top:10px">本月课次详情</div>
      ${sessionsThisMonth.map(s => renderMySessionRow(s)).join('')}
    ` : `<div style="font-size:12px;color:var(--text-3);text-align:center;padding:20px 0">本月无课</div>`}
  `;
}

async function renderWorkRecordsTeacher(mc) {
  mc.innerHTML = '<div class="loading">加载中…</div>';
  try {
    const records = await sb(`/rest/v1/work_records?teacher_name=eq.${encodeURIComponent(teacherName)}&order=start_time.asc`);
    if (!records.length) {
      mc.innerHTML = '<div class="empty">暂无工作记录<br><span style="font-size:11px">Admin 审核通过后会显示在这里</span></div>';
      return;
    }
    const approved = records.filter(r => r.status === 'approved');
    const pending = records.filter(r => r.status === 'pending');
    const rejected = records.filter(r => r.status === 'rejected');
    const courseCount = approved.filter(r => r.source === 'course').length;
    const bookingCount = approved.filter(r => r.source === 'booking').length;
    const totalHours = Math.round(approved.reduce((s, r) => s + (r.duration || 0), 0) * 100) / 100;

    // 解析「2026年06月20日 13:00」中的年月，判断是否当月
    const now = new Date();
    const curY = now.getFullYear(), curM = now.getMonth() + 1;
    const getYM = (str) => {
      const m = (str || '').match(/(\d{4})年(\d{2})月/);
      return m ? { y: parseInt(m[1]), m: parseInt(m[2]) } : null;
    };
    const currentMonthRows = approved.filter(r => {
      const ym = getYM(r.start_time);
      return ym && ym.y === curY && ym.m === curM;
    });
    const historyRows = approved.filter(r => !currentMonthRows.includes(r));

    const renderCard = r => `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:flex-start;gap:14px">
          <div style="text-align:center;min-width:44px">
            <div style="font-size:15px;font-weight:700;font-family:'DM Mono',monospace;color:var(--accent)">${r.duration}h</div>
            <div style="font-size:9px;color:var(--text-3)">${r.start_time.slice(0,10).replace(/年(\d+)月(\d+)日/,'/$1/$2').slice(5)}</div>
          </div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
              <span style="font-size:11px;font-weight:600">${r.start_time} → ${r.end_time.split(' ')[1]||r.end_time}</span>
              <span style="font-size:10px;background:${r.source === 'booking' ? '#e8f0fb' : 'var(--bg)'};border:1px solid var(--border-light);border-radius:2px;padding:1px 5px">${r.work_type}</span>
            </div>
            <div style="font-size:11px;color:var(--text-3)">${r.location} · ${r.notes}</div>
            ${r.admin_note ? `<div style="font-size:11px;color:var(--text-2);margin-top:3px;font-style:italic">📝 ${r.admin_note}</div>` : ''}
          </div>
        </div>`;

    mc.innerHTML = `
    <div class="page-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600">工作记录</div>
      </div>
      ${pending.length ? `<div style="font-size:11px;background:#fff3cd;color:#856404;border-radius:3px;padding:8px 12px;margin-bottom:10px">⏳ ${pending.length} 条记录待 Admin 审核</div>` : ''}
      ${rejected.length ? `<div style="font-size:11px;background:#f8e0e0;color:#8a1a1a;border-radius:3px;padding:8px 12px;margin-bottom:10px">✗ ${rejected.length} 条记录已驳回${rejected[0]?.admin_note ? `：${rejected[0].admin_note}` : ''}</div>` : ''}
      <div style="font-size:11px;color:var(--text-3);margin-bottom:10px">大课 <strong style="color:var(--text)">${courseCount}</strong> 节 · 面谈 <strong style="color:var(--text)">${bookingCount}</strong> 次 · 合计 <strong style="color:var(--text)">${totalHours}</strong> 小时</div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">${curY}年${curM}月</div>
      ${currentMonthRows.length ? currentMonthRows.map(renderCard).join('') : '<div style="font-size:12px;color:var(--text-3);padding:8px 0">本月暂无已通过的工作记录</div>'}
      ${historyRows.length ? `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-light)">
        <div style="cursor:pointer;font-size:11px;color:var(--text-3);padding:4px 0" onclick="toggleWorkHistory()">
          <span id="wh_arrow">▸</span> 历史记录（${historyRows.length} 条）
        </div>
        <div id="wh_body" style="display:none;margin-top:8px">
          ${historyRows.map(renderCard).join('')}
        </div>
      </div>` : ''}
    </div>`;
  } catch(e) {
    mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`;
  }
}

function toggleWorkHistory() {
  const body = document.getElementById('wh_body');
  const arrow = document.getElementById('wh_arrow');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▸' : '▾';
}

init();

// ══════════════════════════════════
// 出願数据库（只读，营业老师用）
// ══════════════════════════════════

let teacherAdbMajors = [], teacherAdbEnglish = 'all', teacherAdbJapanese = 'all', teacherAdbSearch = '';
let teacherAdbMonthFrom = 0, teacherAdbMonthTo = 0;
let teacherAdbData = [];
let teacherAdbSortCol = '', teacherAdbSortDir = 1;
let teacherAdbColFilters = {};

const TEACHER_ADB_MAJORS = {
  shakai: '社会学', keiei: '経営学', keizai: '経済学',
  shinpan: '新闻传播学', fukushi: '社会福祉学', nihongo: '日本语教育',
  hyosho: '表象文化・文学・哲学', seiji: '政治学', toyo: '東洋史',
  bunka: '文化人类学', mot: 'MOT', tokei: '統計・計量',
};

const TEACHER_ADB_COLS = [
  { key:'university', label:'大学名' },
  { key:'type', label:'性质' },
  { key:'faculty', label:'研究科' },
  { key:'department', label:'専攻' },
  { key:'admission_type', label:'出願類型' },
  { key:'doc_review_period', label:'資格審査' },
  { key:'application_period', label:'出願期間' },
  { key:'written_exam', label:'筆記試験' },
  { key:'oral_exam', label:'口述試験' },
  { key:'result_date', label:'合格発表' },
  { key:'english_required', label:'英語' },
  { key:'japanese_required', label:'日語' },
];

async function renderTeacherAdmissionDb(mc) {
  // 出願ページは全幅表示
  const mainEl = document.querySelector('.main');
  if (mainEl) mainEl.style.maxWidth = 'none';

  mc.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
    <div style="font-size:15px;font-weight:600;font-family:'Noto Serif SC',serif">出願数据库</div>
    <button class="btn btn-sm btn-outline" onclick="teacherAdbExportHtml()" style="border:1px solid var(--border)">↓ 导出 PDF表格</button>
  </div>

  <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px 14px;margin-bottom:12px">
    <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">选择专业 <span style="font-weight:400;text-transform:none">（可多选，点「社会人文」同时选中三个专业）</span></div>
    <div class="filter-row" id="tadbMajorRow">
      ${(() => {
      const allowed = window._teacherAllowedAdmMajors || [];
      const group = ['shakai','shinpan','fukushi'];
      const show = !allowed.length || group.every(k => allowed.includes(k));
      return show ? '<div class="filter-chip" onclick="teacherAdbToggleGroup(this)">社会人文</div>' : '';
    })()}
      ${(() => {
      const allowed = window._teacherAllowedAdmMajors || [];
      const entries = allowed.length
        ? Object.entries(TEACHER_ADB_MAJORS).filter(([k]) => allowed.includes(k))
        : Object.entries(TEACHER_ADB_MAJORS);
      return entries.map(([k,v]) => `<div class="filter-chip" data-key="${k}" onclick="teacherAdbToggleMajor('${k}',this)">${v}</div>`).join('');
    })()}
      <div class="filter-chip" style="opacity:.6" onclick="teacherAdbClear()">✕ 清除</div>
    </div>
  </div>

  <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px 14px;margin-bottom:12px">
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:11px;color:var(--text-3);min-width:28px">英语</span>
        ${['all','必須','任意','不要'].map((v,i)=>`<button class="btn btn-sm ${teacherAdbEnglish===v?'btn-primary':'btn-outline'}" onclick="teacherAdbSetLang('english','${v}')" style="padding:3px 10px;font-size:11px;border:1px solid var(--border)">${['全部','必须','任意','不要'][i]}</button>`).join('')}
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:11px;color:var(--text-3);min-width:28px">日语</span>
        ${['all','必須','任意','不要'].map((v,i)=>`<button class="btn btn-sm ${teacherAdbJapanese===v?'btn-primary':'btn-outline'}" onclick="teacherAdbSetLang('japanese','${v}')" style="padding:3px 10px;font-size:11px;border:1px solid var(--border)">${['全部','必须','任意','不要'][i]}</button>`).join('')}
      </div>
      <input type="text" placeholder="搜索大学名、研究科、専攻…" value="${teacherAdbSearch}"
        oninput="if(this.dataset.composing!=='1'){teacherAdbSearch=this.value;teacherAdbRender()}"
        oncompositionstart="this.dataset.composing='1'"
        oncompositionend="this.dataset.composing='';teacherAdbSearch=this.value;teacherAdbRender()"
        style="font-size:12px;max-width:220px;padding:4px 8px">
    </div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
    <span style="font-size:11px;color:var(--text-3)">出願月份</span>
    <select onchange="teacherAdbMonthFrom=parseInt(this.value);teacherAdbRender()" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
      <option value="0">从（不限）</option>
      ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>`<option value="${m}" ${teacherAdbMonthFrom===m?'selected':''}>${m}月</option>`).join('')}
    </select>
    <span style="font-size:11px;color:var(--text-3)">—</span>
    <select onchange="teacherAdbMonthTo=parseInt(this.value);teacherAdbRender()" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
      <option value="0">至（不限）</option>
      ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>`<option value="${m}" ${teacherAdbMonthTo===m?'selected':''}>${m}月</option>`).join('')}
    </select>
    ${(teacherAdbMonthFrom||teacherAdbMonthTo)?`<button onclick="teacherAdbMonthFrom=0;teacherAdbMonthTo=0;teacherAdbRender()" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 7px;cursor:pointer;font-family:inherit;color:var(--text-3)">清除</button>`:''}
  </div>

  <div style="font-size:11px;color:var(--text-3);margin-bottom:6px" id="tadbCount">请选择专业查看数据</div>
  <div style="font-size:10px;color:var(--text-3);margin-bottom:8px">💡 点击列标题可排序，列标题右侧的 ▾ 可筛选该列内容</div>
  <div style="overflow-x:auto">
    <table class="student-table" style="min-width:960px">
      <thead id="tadbThead"></thead>
      <tbody id="tadbBody"></tbody>
    </table>
  </div>`;
}

async function teacherAdbToggleMajor(key, el) {
  if (teacherAdbMajors.includes(key)) teacherAdbMajors = teacherAdbMajors.filter(k => k !== key);
  else teacherAdbMajors.push(key);
  el.classList.toggle('active', teacherAdbMajors.includes(key));
  await teacherAdbLoad();
}

async function teacherAdbToggleGroup(el) {
  const group = ['shakai','shinpan','fukushi'];
  const allOn = group.every(k => teacherAdbMajors.includes(k));
  if (allOn) teacherAdbMajors = teacherAdbMajors.filter(k => !group.includes(k));
  else group.forEach(k => { if (!teacherAdbMajors.includes(k)) teacherAdbMajors.push(k); });
  el.classList.toggle('active', !allOn);
  document.querySelectorAll('#tadbMajorRow [data-key]').forEach(c => {
    c.classList.toggle('active', teacherAdbMajors.includes(c.dataset.key));
  });
  await teacherAdbLoad();
}

async function teacherAdbClear() {
  teacherAdbMajors = [];
  document.querySelectorAll('#tadbMajorRow .filter-chip').forEach(c => c.classList.remove('active'));
  teacherAdbData = [];
  teacherAdbColFilters = {};
  teacherAdbRender();
}

async function teacherAdbLoad() {
  if (!teacherAdbMajors.length) { teacherAdbData = []; teacherAdbColFilters = {}; teacherAdbRender(); return; }
  const body = document.getElementById('tadbBody');
  if (body) body.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:20px;color:var(--text-3)">加载中…</td></tr>';
  const f = `major=in.(${teacherAdbMajors.map(m=>`"${m}"`).join(',')})`;
  teacherAdbData = await sb(`/rest/v1/admission_schools?select=*&${f}&order=university.asc&limit=5000`).catch(()=>[]);
  teacherAdbSortCol = '';
  teacherAdbColFilters = {};
  teacherAdbRender();
}

function teacherAdbSetLang(type, val) {
  if (type === 'english') teacherAdbEnglish = val;
  else teacherAdbJapanese = val;
  document.querySelectorAll(`button[onclick*="teacherAdbSetLang('${type}'"]`).forEach(b => {
    const v = b.getAttribute('onclick').match(/'([^']+)'\)$/)?.[1];
    b.classList.toggle('btn-primary', v === val);
    b.classList.toggle('btn-outline', v !== val);
  });
  teacherAdbRender();
}

function teacherAdbFilter() {
  let list = teacherAdbData;
  if (teacherAdbEnglish !== 'all') list = list.filter(s => s.english_required === teacherAdbEnglish);
  if (teacherAdbJapanese !== 'all') list = list.filter(s => s.japanese_required === teacherAdbJapanese);
  if (teacherAdbSearch.trim()) {
    const q = teacherAdbSearch.trim().toLowerCase();
    list = list.filter(s => (s.university||'').toLowerCase().includes(q)||(s.faculty||'').toLowerCase().includes(q)||(s.department||'').toLowerCase().includes(q));
  }
  if (teacherAdbMonthFrom || teacherAdbMonthTo) {
    list = list.filter(s => {
      const months = (s.application_period||'').match(/(\d{1,2})月/g);
      if (!months) return false;
      const nums = months.map(m => parseInt(m));
      const minM = Math.min(...nums), maxM = Math.max(...nums);
      if (teacherAdbMonthFrom && maxM < teacherAdbMonthFrom) return false;
      if (teacherAdbMonthTo && minM > teacherAdbMonthTo) return false;
      return true;
    });
  }
  Object.entries(teacherAdbColFilters).forEach(([col, vals]) => {
    if (vals && vals.size) list = list.filter(s => vals.has(s[col]||''));
  });
  if (teacherAdbSortCol) {
    list = [...list].sort((a,b) => (a[teacherAdbSortCol]||'').localeCompare(b[teacherAdbSortCol]||'','ja') * teacherAdbSortDir);
  }
  return list;
}

function teacherAdbSort(col) {
  if (teacherAdbSortCol === col) teacherAdbSortDir *= -1;
  else { teacherAdbSortCol = col; teacherAdbSortDir = 1; }
  teacherAdbRender();
}

function teacherAdbOpenColFilter(col, btn) {
  document.querySelectorAll('.tadb-col-filter-popup').forEach(p => p.remove());
  const uniqueVals = [...new Set(teacherAdbData.map(s => s[col]||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
  const current = teacherAdbColFilters[col] || new Set();
  const popup = document.createElement('div');
  popup.className = 'tadb-col-filter-popup';
  popup.style.cssText = 'position:fixed;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:8px;z-index:9999;min-width:140px;max-height:260px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.15)';
  popup.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:6px">
      <span style="font-size:11px;font-weight:600">筛选</span>
      <button onclick="teacherAdbClearColFilter('${col}')" style="font-size:10px;background:none;border:none;color:var(--accent);cursor:pointer">清除</button>
    </div>
    ${uniqueVals.map(v=>`
      <label style="display:flex;align-items:center;gap:6px;font-size:11px;padding:3px 0;cursor:pointer">
        <input type="checkbox" ${current.has(v)?'checked':''} onchange="teacherAdbToggleColFilter('${col}','${v.replace(/'/g,"\\'")}',this.checked)" style="accent-color:var(--accent)">
        ${v}
      </label>
    `).join('')}`;
  const rect = btn.getBoundingClientRect();
  popup.style.top = (rect.bottom + 4) + 'px';
  popup.style.left = rect.left + 'px';
  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('click', function close(e) {
    if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', close); }
  }), 10);
}

function teacherAdbToggleColFilter(col, val, checked) {
  if (!teacherAdbColFilters[col]) teacherAdbColFilters[col] = new Set();
  if (checked) teacherAdbColFilters[col].add(val);
  else teacherAdbColFilters[col].delete(val);
  if (!teacherAdbColFilters[col].size) delete teacherAdbColFilters[col];
  teacherAdbRender();
}

function teacherAdbClearColFilter(col) {
  delete teacherAdbColFilters[col];
  document.querySelectorAll('.tadb-col-filter-popup').forEach(p => p.remove());
  teacherAdbRender();
}

function teacherAdbRender() {
  const thead = document.getElementById('tadbThead');
  const tbody = document.getElementById('tadbBody');
  const countEl = document.getElementById('tadbCount');
  if (!thead || !tbody) return;

  const showMajor = teacherAdbMajors.length !== 1;
  const filtered = teacherAdbFilter();

  if (!teacherAdbData.length) {
    if (countEl) countEl.textContent = '请选择专业查看数据';
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:40px;color:var(--text-3)">← 请先选择专业</td></tr>';
    return;
  }
  if (countEl) countEl.innerHTML = `筛选结果 <strong style="color:var(--text)">${filtered.length}</strong> 条`;

  const cols = showMajor ? [{ key:'major', label:'专业' }, ...TEACHER_ADB_COLS] : TEACHER_ADB_COLS;
  const engCol = v => v==='必須'?'var(--accent)':v==='任意'?'var(--warn)':'var(--text-3)';

  thead.innerHTML = `<tr>${cols.map(c => {
    const arrow = teacherAdbSortCol===c.key ? (teacherAdbSortDir===1?'▲':'▼') : '⇅';
    const hasFilter = teacherAdbColFilters[c.key] && teacherAdbColFilters[c.key].size;
    const filterBtn = `<span onclick="event.stopPropagation();teacherAdbOpenColFilter('${c.key}',this)" style="cursor:pointer;color:${hasFilter?'#fff':'rgba(255,255,255,.5)'};margin-left:2px;font-size:10px;${hasFilter?'background:rgba(255,255,255,.2);border-radius:2px;padding:0 2px':''}">▾</span>`;
    return `<th style="cursor:pointer;white-space:nowrap;padding:6px 8px" onclick="teacherAdbSort('${c.key}')">
      ${c.label}<span style="font-size:9px;color:rgba(255,255,255,.5);margin-left:2px">${arrow}</span>${filterBtn}
    </th>`;
  }).join('')}</tr>`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" style="text-align:center;padding:20px;color:var(--text-3)">暂无数据</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => `<tr>
    ${showMajor ? `<td style="font-size:10px;color:var(--text-2)">${TEACHER_ADB_MAJORS[s.major]||s.major}</td>` : ''}
    <td style="font-weight:500">${s.university||''}</td>
    <td><span style="font-size:10px;background:${s.type==='国立'?'#e8f0fb':s.type==='公立'?'#e8f5e9':'var(--bg)'};border:1px solid var(--border-light);border-radius:2px;padding:1px 4px">${s.type||''}</span></td>
    <td>${s.faculty||''}</td>
    <td>${s.department||''}</td>
    <td style="color:var(--text-2)">${s.admission_type||''}</td>
    <td style="color:var(--text-2)">${s.doc_review_period||''}</td>
    <td>${s.application_period||''}</td>
    <td style="color:var(--text-2)">${s.written_exam||''}</td>
    <td style="color:var(--text-2)">${s.oral_exam||''}</td>
    <td style="color:var(--text-2)">${s.result_date||''}</td>
    <td style="text-align:center;font-weight:700;color:${engCol(s.english_required)}">${s.english_required||'-'}</td>
    <td style="text-align:center;font-weight:700;color:${engCol(s.japanese_required)}">${s.japanese_required||'-'}</td>
  </tr>`).join('');
}

function teacherAdbExportHtml() {
  const filtered = teacherAdbFilter();
  if (!filtered.length) { alert('没有可导出的数据'); return; }
  const showMajor = teacherAdbMajors.length !== 1;
  const majorLabel = teacherAdbMajors.length === 1
    ? (TEACHER_ADB_MAJORS[teacherAdbMajors[0]] || teacherAdbMajors[0])
    : teacherAdbMajors.map(m => TEACHER_ADB_MAJORS[m]||m).join('・');
  const today = new Date().toLocaleDateString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit'});

  const filterDesc = [];
  if (teacherAdbEnglish !== 'all') filterDesc.push(`英语：${teacherAdbEnglish==='必須'?'必须':teacherAdbEnglish==='任意'?'任意':'不要'}`);
  if (teacherAdbJapanese !== 'all') filterDesc.push(`日语：${teacherAdbJapanese==='必須'?'必须':teacherAdbJapanese==='任意'?'任意':'不要'}`);
  if (teacherAdbSearch.trim()) filterDesc.push(`关键词：${teacherAdbSearch.trim()}`);
  const periods = filtered.map(s => s.application_period||'').filter(Boolean);
  const monthNums = [];
  periods.forEach(p => { const m = p.match(/(\d+)月/g); if(m) m.forEach(x => monthNums.push(parseInt(x))); });
  if (monthNums.length) {
    const mn = Math.min(...monthNums), mx = Math.max(...monthNums);
    filterDesc.push(mn===mx ? `出願：${mn}月` : `出願：${mn}月～${mx}月`);
  }

  const colDefs = [
    ...(showMajor ? [['专业','56px','school']] : []),
    ['大学名','108px','school'],['設置主体','40px','school'],
    ['研究科名','136px','school'],['専攻名','96px','school'],
    ['出願類型','68px','time'],['資格審査','68px','time'],
    ['出願期間','68px','time'],['筆記試験','68px','time'],
    ['口述試験','68px','time'],['合格発表','68px','time'],
    ['英語','42px','lang'],['日語','42px','lang'],
  ];
  const thColors = {
    school:{ bg:'#2c4a7c', border:'#1e3560' },
    time:  { bg:'#3d6b4f', border:'#2a4d38' },
    lang:  { bg:'#7c4a2c', border:'#5e3520' },
  };
  const engColor = v => v==='必須'?'#1a56a0':v==='任意'?'#b45309':'#888';

  const rows = filtered.map((s,i) => `<tr class="${i%2===1?'even':''}">
    ${showMajor?`<td>${TEACHER_ADB_MAJORS[s.major]||s.major}</td>`:''}
    <td class="bold">${s.university||''}</td><td class="center">${s.type||''}</td>
    <td>${s.faculty||''}</td><td>${s.department||''}</td>
    <td>${s.admission_type||''}</td><td>${s.doc_review_period||''}</td>
    <td>${s.application_period||''}</td><td>${s.written_exam||''}</td>
    <td>${s.oral_exam||''}</td><td>${s.result_date||''}</td>
    <td class="center" style="color:${engColor(s.english_required)};font-weight:700">${s.english_required||'-'}</td>
    <td class="center" style="color:${engColor(s.japanese_required)};font-weight:700">${s.japanese_required||'-'}</td>
  </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>${majorLabel} 出願名单 ${today}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif;font-size:11px;color:#222;padding:20px}
.title-block{margin-bottom:14px;border-left:4px solid #2c4a7c;padding-left:10px}
h1{font-size:16px;font-weight:700;margin-bottom:4px}
.meta{font-size:11px;color:#555;margin-bottom:3px}
.filters{font-size:11px;color:#2c4a7c;background:#eef3fb;border-radius:3px;padding:4px 8px;display:inline-block;margin-top:4px}
table{border-collapse:collapse;width:100%;table-layout:fixed;margin-top:12px}
th{padding:6px 4px;text-align:left;font-size:10px;font-weight:700;color:#fff;border:1px solid #ccc;white-space:nowrap}
td{padding:5px 4px;border:1px solid #ddd;vertical-align:top;word-break:break-all;line-height:1.5;font-size:11px}
tr.even td{background:#f4f7fb}
.bold{font-weight:700}.center{text-align:center}
${colDefs.map(([,w],i)=>`col:nth-child(${i+1}){width:${w}}`).join('')}
@page{size:A3 landscape;margin:12mm}
@media print{body{padding:0}td,th{font-size:10px;padding:4px 3px}}
</style></head><body>
<div class="title-block">
  <h1>${majorLabel} 可出願学校名单</h1>
  <div class="meta">唯新教育 · ${today} · 共 ${filtered.length} 条</div>
  <div class="filters">筛选条件：${filterDesc.length?filterDesc.join('　|　'):'全部'}</div>
</div>
<table>
  <colgroup>${colDefs.map(([,w])=>`<col style="width:${w}">`).join('')}</colgroup>
  <thead><tr>${colDefs.map(([l,,g])=>`<th style="background:${thColors[g].bg};border-color:${thColors[g].border}">${l}</th>`).join('')}</tr></thead>
  <tbody>${rows}</tbody>
</table></body></html>`;

  const blob = new Blob([html],{type:'text/html;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=`出願名单_${majorLabel}_${today.replace(/\//g,'-')}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
