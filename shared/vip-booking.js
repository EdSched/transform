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
  const by = vipInitiator(b);
  if (by === 'teacher') {
    if (b.student_ok === true) return { k: 'established', label: '已成立', who: '' };
    return { k: 'wait_student', label: '待学生确认', who: 'student' };
  }
  if (by === 'student') {
    if (b.admin_review === 'approved') return { k: 'established', label: '已成立', who: '' };   // 旧数据：教务审批过
    if (b.admin_review === 'pending') return { k: 'legacy_admin', label: b.teacher_ok ? '待教务处理（旧）' : '待老师确认', who: b.teacher_ok ? 'admin' : 'teacher' };
    if (b.teacher_ok === true) return { k: 'established', label: '已成立', who: '' };
    return { k: 'wait_teacher', label: '待老师确认', who: 'teacher' };
  }
  if (by === 'admin') return { k: 'established', label: '已成立', who: '' };
  return b.status === 'confirmed' ? { k: 'established', label: '已成立', who: '' } : { k: 'wait_teacher', label: '待老师确认', who: 'teacher' };
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
// 老师发起 → 给学生的提醒文字
function vipStudentRemindText(b, roomName) {
  return `${b.name}同学，你的 VIP 课已经建立：${vipWhenText(b)}，${vipWhereText(b, roomName)}，请到 VIP 页面确认上课。`;
}
// 学生发起 → 给老师的提醒文字（学生复制发给老师）
function vipTeacherRemindText(b, teacherDisplay) {
  const offline = b.location && b.location !== 'online';
  return `${teacherDisplay || b.assigned_teacher || ''}老师，我刚预约了${vipWhenText(b)} 的 VIP 课，请确认${offline ? '并安排教室' : ''}。`;
}
