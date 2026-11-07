// VIP 预约的「上课记录 / 留言 / 学生取消·改期申请」共用部分（老师端 teacher/teacher.js / 管理端 admin/booking.js 共用）
// 上课记录弹窗（openVipSessionRecord / saveVipSessionRecord：保存后按本次耗时扣学生 VIP 课时，重新编辑先退回旧耗时再扣新的）、
// 给学生留言（openVipMessages / sendVipTeacherMessage）、学生申请横幅（vipReqBannerHtml）和驳回（vipReqReject）。
// 署名：老师端 = 老师名，管理端 = 「管理员」（VIPH.who）。管理端「同意取消 / 处理改期」按钮对应的 openVipCancel / openVipModify 在 admin/booking.js 里。
// 依赖：shared/supabase.js、shared/vip-booking.js（vipNotice*）、shared/hw-core.js（HWC 结构化作业编辑器）
const VIPH = {
  list: () => (typeof cachedTeacherBookings !== 'undefined' ? cachedTeacherBookings : (typeof cachedBookings !== 'undefined' ? cachedBookings : [])),
  slots: () => (typeof cachedTeacherSlots !== 'undefined' ? cachedTeacherSlots : (typeof cachedSlots !== 'undefined' ? cachedSlots : [])),
  who: () => (typeof teacherName !== 'undefined' && teacherName) || '管理员',
  rerender: () => { if (typeof renderTab === 'function') renderTab(); else if (typeof renderBookingPage === 'function') renderBookingPage(document.getElementById('mainContent')); },
  // 修改预约并确认数据库真的改到了（权限规则拦下时 Supabase 只返回 0 行，不报错）
  patch: async (id, body) => {
    const rows = await sb(`/rest/v1/bookings?id=eq.${encodeURIComponent(id)}`, 'PATCH', body);
    if (Array.isArray(rows) && rows.length === 0) throw new Error('数据库没有允许修改这条预约（0 行被更新）。请把这条预约的学生姓名和日期告诉管理员处理。');
    return rows;
  },
};

// ── VIP 上课记录填写 ──
const VIP_CONTENT_OPTIONS = ['专业课指导', '过去问对策', '研究计划书', '出愿指导', '面试对策', 'TA指导'];

let vipRecordPlanItems = [];  // 当前打开记录的学生 VIP 规划课程
let vipRecordPickIdx = null;  // 当前选中的规划课程下标
let vipNotesAutoVal = '';     // 上次自动带入备注的内容（判断老师是否手改过）
let vipStatusSet = new Set(); // 已选的学生状态标签
let vipStatusFree = '';       // 学生状态·其他补充
const VIP_STATUS_OPTIONS = [
  { t: '优秀认真', k: 'good' }, { t: '积极配合', k: 'good' }, { t: '进步明显', k: 'good' },
  { t: '基础扎实', k: 'good' }, { t: '主动提问', k: 'good' },
  { t: '容易走神', k: 'warn' }, { t: '未完成任务', k: 'warn' }, { t: '专业知识薄弱', k: 'warn' },
  { t: '需要督促', k: 'warn' }, { t: '状态低迷', k: 'warn' },
];
function vipStatusRowsHtml() {
  return VIP_STATUS_OPTIONS.map(o => {
    const sel = vipStatusSet.has(o.t);
    const base = o.k === 'good' ? { bg: '#e3f0e6', color: '#1a4a28', bd: '#b8dcc2' } : { bg: '#faf0dc', color: '#8a5010', bd: '#e8d9b8' };
    return `<span onclick="vipToggleStatus('${o.t}')" style="cursor:pointer;user-select:none;font-size:11px;border-radius:14px;padding:4px 12px;border:1px solid ${sel ? base.color : 'var(--border)'};background:${sel ? base.bg : 'transparent'};color:${sel ? base.color : 'var(--text-2)'}">${sel ? '✓ ' : ''}${o.t}</span>`;
  }).join('');
}
function vipToggleStatus(t) {
  if (vipStatusSet.has(t)) vipStatusSet.delete(t); else vipStatusSet.add(t);
  const box = document.getElementById('vip_status_tags');
  if (box) box.innerHTML = vipStatusRowsHtml();
}
function vipRecEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// 规划课程点选：整行卡片（无圆点，文字完整），选中高亮打勾
function vipPlanPickRowsHtml() {
  return vipRecordPlanItems.map((it, i) => {
    const sel = vipRecordPickIdx === i;
    return `<div onclick="vipPickPlanItem(${i})" style="display:flex;align-items:flex-start;gap:8px;font-size:11px;cursor:pointer;padding:7px 9px;border-radius:4px;border:1px solid ${sel ? 'var(--accent,#1a1814)' : 'var(--border)'};background:${sel ? 'var(--bg)' : 'transparent'}">
      <div style="flex-shrink:0;width:14px;height:14px;margin-top:1px;border:1px solid ${sel ? 'var(--accent,#1a1814)' : 'var(--border)'};border-radius:3px;background:${sel ? 'var(--accent,#1a1814)' : 'transparent'};color:#fff;font-size:9px;display:flex;align-items:center;justify-content:center">${sel ? '✓' : ''}</div>
      <div style="min-width:0;flex:1">
        <div style="font-weight:600">${vipRecEsc(it.category_label ? it.category_label + '·' : '')}${vipRecEsc(it.name)}${(it.hours != null) ? ` <span style="color:var(--text-3);font-weight:400">(${it.hours}H)</span>` : ''}</div>
        ${it.content ? `<div style="color:var(--text-3);line-height:1.5;margin-top:2px">${vipRecEsc(it.content)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// —— VIP 结构化作业（复用大课 HWC 编辑器）——
let vipHwEditQ = null;      // 暂存的 homework_questions（保存上课记录时一并写入 booking）
let vipHwEditNote = '';
let vipHwAutoVal = null;    // 上次「自动带入」的作业指纹，用于判断老师是否手动改过
function vipHwStatusText() {
  const q = vipHwEditQ;
  if (q && Array.isArray(q.levels) && q.levels.length) {
    const nb = q.levels.reduce((n, L) => n + (L.blocks || []).length, 0);
    return `✅ 已设置（${q.levels.length} 级 · ${nb} 个题型区块）`;
  }
  return '未设置（点击「设置作业」创建，可逐题作答/拍照）';
}
function openVipHwEditor(bookingId) {
  if (typeof HWC === 'undefined' || !HWC.openEditor) { alert('作业模块未加载，请刷新页面后重试'); return; }
  const b = VIPH.list().find(x => x.id === bookingId) || ((typeof vipBfDraft !== 'undefined' && vipBfDraft && vipBfDraft.id === bookingId) ? vipBfDraft : {});
  HWC.openEditor({
    title: '布置作业', subtitle: 'VIP · ' + (b.name || '') + '　' + (b.slot_date || ''),
    questions: vipHwEditQ, note: vipHwEditNote, storageDir: 'vipbk-' + bookingId,
    onSave: async (payload, note) => { vipHwEditQ = payload; vipHwEditNote = note || ''; const el = document.getElementById('vip_hw_status'); if (el) el.textContent = vipHwStatusText(); },
  });
}
// 上课记录表单：「上课记录」弹窗和「VIP 管理 → 上课记录」里的补录模式共用同一套控件、同一套校验（vipRecInit / vipRecFormHtml / vipRecCollect）
// b：预约（补录时是还没入库的草稿，要有 name / vip_*）；返回是否有 VIP 规划
async function vipRecInit(b) {
  vipHwEditQ = b.vip_homework_questions || null; vipHwEditNote = b.vip_homework_note || ''; vipHwAutoVal = null;
  // 查该学生的 VIP 规划（签约/已确认），把规划课程带出来供点选
  vipRecordPlanItems = [];
  try {
    const plans = await sb(`/rest/v1/vip_student_plans?student_name=eq.${encodeURIComponent(b.name)}&status=in.("signed","confirmed")&select=*&order=created_at.desc`);
    if (plans && plans.length && Array.isArray(plans[0].items)) vipRecordPlanItems = plans[0].items;
  } catch (e) {}
  const hasPlan = vipRecordPlanItems.length > 0;
  vipRecordPickIdx = hasPlan ? vipRecordPlanItems.findIndex(it => it.name === b.vip_content) : -1;
  if (vipRecordPickIdx < 0) vipRecordPickIdx = null;
  const savedNotes = b.vip_session_notes || '';
  const selItem = vipRecordPickIdx != null ? vipRecordPlanItems[vipRecordPickIdx] : null;
  // 该回在 VIP 排课/框架里预设过作业，且本次记录尚未设过 → 自动带入
  if (!vipHwEditQ && selItem && selItem.homework_questions) {
    vipHwEditQ = selItem.homework_questions;
    vipHwEditNote = selItem.homework_note || '';
    vipHwAutoVal = JSON.stringify(vipHwEditQ);
  }
  vipNotesAutoVal = (selItem && savedNotes === selItem.content) ? savedNotes : '';
  // 解析已保存的学生状态：已知标签回填选中，其余入"其他补充"
  vipStatusSet = new Set(); vipStatusFree = '';
  const known = VIP_STATUS_OPTIONS.map(o => o.t);
  (b.vip_student_status || '').split('、').map(s => s.trim()).filter(Boolean).forEach(s => {
    if (known.includes(s)) vipStatusSet.add(s); else vipStatusFree = vipStatusFree ? vipStatusFree + '、' + s : s;
  });
  return hasPlan;
}
function vipRecFormHtml(b, slot, hasPlan) {
  const availableContent = slot?.vip_content || VIP_CONTENT_OPTIONS;

  let contentSection;
  if (hasPlan) {
    const offReason = b.vip_offplan_reason || '';
    const isOff = !!offReason && !(b.vip_content && vipRecordPlanItems.some(it => it.name === b.vip_content));
    contentSection = `
      <div class="form-group"><label class="form-label">本次授课内容（来自该学生 VIP 规划，点选本次所上）</label>
        <div id="vip_plan_pick" style="display:flex;flex-direction:column;gap:4px;max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:6px">
          ${vipPlanPickRowsHtml(b)}
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;margin-top:8px;color:var(--danger,#a33)">
          <input type="checkbox" id="vip_offplan" ${isOff ? 'checked' : ''} onchange="vipToggleOffplan(this)" style="accent-color:var(--accent)">未按规划上课（手动输入内容）
        </label>
        <div id="vip_offplan_wrap" style="display:${isOff ? 'block' : 'none'};margin-top:6px">
          <textarea id="vip_offplan_reason" rows="2" placeholder="请填写未按课程规划上课的理由…" style="font-size:11px;width:100%">${vipRecEsc(offReason)}</textarea>
        </div>
      </div>`;
  } else {
    contentSection = `
      <div class="form-group"><label class="form-label">本次实际授课内容（可多选）</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="vip_content_select">
          ${availableContent.map(c => `<label style="display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer;border:1px solid var(--border);border-radius:3px;padding:4px 10px">
            <input type="checkbox" value="${c}" ${b.vip_content && b.vip_content.includes(c) ? 'checked' : ''} style="accent-color:var(--accent);width:14px;height:14px">${c}
          </label>`).join('')}
        </div>
      </div>`;
  }

  return `
      ${contentSection}
      <div class="form-group"><label class="form-label">上课内容（本次讲了什么）</label>
        <textarea id="vip_notes" rows="3" placeholder="本次课的具体内容…">${vipRecEsc(b.vip_session_notes || '')}</textarea>
      </div>
      <div class="form-group"><label class="form-label">学生状态（可多选）</label>
        <div id="vip_status_tags" style="display:flex;flex-wrap:wrap;gap:6px">${vipStatusRowsHtml()}</div>
        <input id="vip_status_note" value="${vipRecEsc(vipStatusFree)}" placeholder="其他补充（可选）" style="font-size:11px;margin-top:8px;width:100%">
      </div>
      <div class="form-group"><label class="form-label">布置作业（学生将在VIP页面看到并提交；本次确实没有作业请写「本次无作业」）</label>
        <input id="vip_homework_text" value="${vipRecEsc(b.vip_homework || '')}" placeholder="一句话说明（如：下节课前完成过去问2015第2题）" style="font-size:11px;width:100%;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <button type="button" onclick="openVipHwEditor('${b.id}')" style="font-size:12px;background:none;border:1px solid var(--accent);color:var(--accent);border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">📝 设置作业（结构化）</button>
          <span id="vip_hw_status" style="font-size:11px;color:var(--text-3)">${vipHwStatusText()}${vipHwAutoVal ? '（已从课程规划自动带入）' : ''}</span>
        </div>
        <div style="font-size:10px;color:var(--text-3);margin-top:4px">结构化作业＝学生逐题作答/拍照提交；若该回在「VIP排课」里预设过作业，这里会自动带出，可直接用或修改。</div>
      </div>
      <div class="form-group"><label class="form-label">${b._bf ? '本次课时（小时，教务确认后才从学生VIP总课时中扣除）' : '本次耗时（小时，保存后将自动从学生VIP总课时中扣除）'}</label>
        <input type="number" id="vip_hours" step="0.5" min="0" value="${b.vip_hours_used || ''}" placeholder="例：1.5"></div>
`;
}
// 收集并校验表单；不通过时弹提示并返回 null
function vipRecCollect() {
  let content = '', offplanReason = '';
  if (document.getElementById('vip_plan_pick')) {
    // 规划模式：点选规划课程 或 未按规划(手动+理由)
    const off = document.getElementById('vip_offplan')?.checked;
    if (off) {
      offplanReason = (document.getElementById('vip_offplan_reason')?.value || '').trim();
      if (!offplanReason) { alert('未按规划上课，请填写理由'); return null; }
      content = '';
    } else {
      if (vipRecordPickIdx == null) { alert('请点选本次所上的规划课程，或勾选「未按规划上课」'); return null; }
      content = vipRecordPlanItems[vipRecordPickIdx]?.name || '';
    }
  } else {
    content = [...document.querySelectorAll('#vip_content_select input:checked')].map(c => c.value).join('・');
    if (!content) { alert('请至少勾选一项本次授课内容'); return null; }
  }
  const notes = document.getElementById('vip_notes').value.trim();
  const freeEl = document.getElementById('vip_status_note');
  const freeVal = freeEl ? freeEl.value.trim() : '';
  const statusArr = [...vipStatusSet];
  if (freeVal) statusArr.push(freeVal);
  const studentStatus = statusArr.join('、');
  const newHours = parseFloat(document.getElementById('vip_hours').value) || 0;
  if (!notes) { alert('请填写上课内容'); return null; }
  if (newHours <= 0) { alert('请填写本次耗时'); return null; }
  const homework = document.getElementById('vip_homework_text')?.value.trim() || document.getElementById('vip_homework')?.value.trim() || '';
  return { content, offplanReason, notes, studentStatus, newHours, homework };
}
async function openVipSessionRecord(bookingId) {
  const b = VIPH.list().find(x => x.id === bookingId);
  if (!b) return;
  const slot = VIPH.slots().find(x => x.id === b.slot_id);
  const hasPlan = await vipRecInit(b);
  const existing = document.getElementById('vipRecordModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'vipRecordModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;max-width:440px;width:100%;max-height:88vh;overflow-y:auto">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">${b.name} 的VIP上课记录</div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:14px">${b.slot_date} ${b.slot_time_range || ''}${hasPlan ? '　·　已关联 VIP 规划' : ''}</div>
      ${vipRecFormHtml(b, slot, hasPlan)}
      ${b.vip_homework_file_url ? `
      <div style="background:var(--ok-bg);border:1px solid var(--ok);border-radius:3px;padding:10px 12px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:600;color:var(--ok);margin-bottom:6px">📎 学生已提交作业</div>
        <a href="${b.vip_homework_file_url}" target="_blank" style="font-size:12px;color:var(--accent)">下载学生提交文件</a>
        <div style="margin-top:8px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">批改反馈（文字）</div>
          <textarea id="vip_hw_feedback" rows="2" placeholder="批改意见…">${vipRecEsc(b.vip_homework_feedback || '')}</textarea>
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

// 点选规划课程 → 把内容带入备注（老师可再改）
function vipPickPlanItem(i) {
  const it = vipRecordPlanItems[i];
  if (!it) return;
  vipRecordPickIdx = i;
  const off = document.getElementById('vip_offplan');
  if (off && off.checked) { off.checked = false; const w = document.getElementById('vip_offplan_wrap'); if (w) w.style.display = 'none'; }
  const box = document.getElementById('vip_plan_pick');
  if (box) box.innerHTML = vipPlanPickRowsHtml();
  const notes = document.getElementById('vip_notes');
  // 备注为空、或还等于上次自动带入的内容（老师没手改）→ 跟随所选课程更新
  if (notes && it.content && (!notes.value.trim() || notes.value === vipNotesAutoVal)) {
    notes.value = it.content;
    vipNotesAutoVal = it.content;
  }
  // 作业：该回在「VIP排课/框架」里预设过结构化作业 → 自动带入本次上课记录
  // 老师若已在本弹窗手动设过（且不是上次自动带入的那份），不覆盖
  const planQ = it.homework_questions || null;
  const autoIsCurrent = vipHwAutoVal != null && JSON.stringify(vipHwEditQ || null) === vipHwAutoVal;
  if (planQ && (!vipHwEditQ || autoIsCurrent)) {
    vipHwEditQ = planQ;
    vipHwEditNote = it.homework_note || '';
    vipHwAutoVal = JSON.stringify(planQ);
    const el = document.getElementById('vip_hw_status');
    if (el) el.textContent = vipHwStatusText() + '（已从课程规划自动带入）';
  }
  // 规划里这回只写了一句话作业 → 填进文字说明栏
  const hwText = document.getElementById('vip_homework_text');
  if (hwText && it.homework && !hwText.value.trim()) hwText.value = it.homework;
}
// 切换"未按规划"：显示理由框，并清除规划课程选择
function vipToggleOffplan(cb) {
  const wrap = document.getElementById('vip_offplan_wrap');
  if (wrap) wrap.style.display = cb.checked ? 'block' : 'none';
  if (cb.checked) { vipRecordPickIdx = null; const box = document.getElementById('vip_plan_pick'); if (box) box.innerHTML = vipPlanPickRowsHtml(); }
}

async function saveVipSessionRecord(bookingId) {
  const b = VIPH.list().find(x => x.id === bookingId);
  if (!b) return;
  const rec = vipRecCollect();
  if (!rec) return;
  const { content, offplanReason, notes, studentStatus, newHours } = rec;

  const prevHours = b.vip_hours_used || 0; // 若是重新编辑，先扣除上次记录的耗时再加上新的，避免重复扣减
  try {
    // 找到学生档案，调整课时（先退回旧耗时，再扣新耗时）
    const students = await sb(`/rest/v1/students?name=eq.${encodeURIComponent(b.name)}&select=id,vip_hours_used`);
    if (students.length) {
      const stu = students[0];
      const newUsed = Math.max(0, (stu.vip_hours_used || 0) - prevHours + newHours);
      await sb(`/rest/v1/students?id=eq.${stu.id}`, 'PATCH', { vip_hours_used: newUsed });
    }
    const homework = rec.homework || b.vip_homework || '';
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
      vip_content: content,
      vip_offplan_reason: offplanReason || null,
      vip_session_notes: notes,
      vip_student_status: studentStatus || null,
      vip_hours_used: newHours,
      vip_homework: homework,
      vip_homework_questions: vipHwEditQ,
      vip_homework_note: vipHwEditNote || null,
      vip_homework_feedback: hwFeedback,
      vip_homework_feedback_file_url: hwFeedbackFileUrl,
      student_confirmed: false,
      status: 'completed',
    });
    Object.assign(b, { vip_content: content, vip_offplan_reason: offplanReason || null, vip_session_notes: notes, vip_student_status: studentStatus || null, vip_hours_used: newHours, vip_homework: homework, vip_homework_questions: vipHwEditQ, vip_homework_note: vipHwEditNote || null, vip_homework_feedback: hwFeedback, vip_homework_feedback_file_url: hwFeedbackFileUrl, student_confirmed: false, status: 'completed' });
    document.getElementById('vipRecordModal').remove();
    VIPH.rerender();
    vipNoticeModal(b, 'done', {}, '上课记录已保存，课时已扣除。建议点击「生成确认链接文案」发给学生确认。');
  } catch (e) { alert('保存失败：' + e.message); }
}


// ── VIP 留言 ──
function openVipMessages(bookingId) {
  const b = VIPH.list().find(x => x.id === bookingId);
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
        ${vipNoticeMerged(b).length ? vipNoticeMerged(b).map(m => `
          <div style="font-size:12px;margin-bottom:8px;${m.from==='teacher'?'text-align:right':''}">
            <span style="display:inline-block;max-width:80%;background:${m.from==='teacher'?'var(--accent)':'var(--bg)'};color:${m.from==='teacher'?'#fff':'inherit'};border-radius:8px;padding:6px 11px;text-align:left">
              <div style="font-size:9px;opacity:.7;margin-bottom:2px">${m.from==='teacher'?'我':m.from==='system'?'系统通知':b.name}${vipNoticeCopyBtn(b, m)}</div>
              ${m.text}
            </span>
          </div>`).join('') : '<div style="font-size:11px;color:var(--text-3)">暂无留言</div>'}
      </div>
      <div style="display:flex;gap:6px">
        <input type="text" id="vip_teacher_message_input" placeholder="回复留言…" style="flex:1;font-size:12px">
        <button class="btn btn-primary btn-sm" onclick="sendVipTeacherMessage('${bookingId}')">发送</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">${vipNoticeLogBtn(b)}<button class="btn btn-outline btn-sm" onclick="document.getElementById('vipMessagesModal').remove()">关闭</button></div>
    </div>`;
  document.body.appendChild(modal);
}

const VIP_MSG_LIMIT = 30;

async function sendVipTeacherMessage(bookingId) {
  const input = document.getElementById('vip_teacher_message_input');
  const text = input.value.trim();
  if (!text) return;
  const b = VIPH.list().find(x => x.id === bookingId);
  if (!b) return;
  if ((b.messages || []).length >= VIP_MSG_LIMIT) {
    alert(`每个预约最多 ${VIP_MSG_LIMIT} 条留言，当前已达上限。如需继续沟通请通过其他方式联系学生。`);
    return;
  }
  const newMessages = [...(b.messages || []), { from: 'teacher', text, ts: Date.now(), by: VIPH.who() }];
  try {
    await sb(`/rest/v1/bookings?id=eq.${bookingId}`, 'PATCH', { messages: newMessages });
    b.messages = newMessages;
    document.getElementById('vipMessagesModal').remove();
    openVipMessages(bookingId);
  } catch (e) { alert('发送失败：' + e.message); }
}


function vipReqOf(b) { let r = b && b.change_request; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = null; } } return r && typeof r === 'object' ? r : null; }

function vipReqPending(b) { const r = vipReqOf(b); return !!(r && r.status === 'pending'); }

function vipReqBannerHtml(b, hasRecord) {
  const r = vipReqOf(b);
  if (!r || r.status !== 'pending') return '';
  const isCancel = r.type === 'cancel';
  return `<div id="vipreq_${b.id}" style="margin-top:8px;background:#fdf1e6;border:1px solid #e8c9a8;border-radius:4px;padding:8px 10px">
    <div style="font-size:12px;font-weight:600;color:#a0521a">学生申请${isCancel ? '取消' : '改期'}</div>
    <div style="font-size:11px;color:var(--text-2);margin-top:2px;white-space:pre-wrap">原因：${escapeHtmlVcm(r.reason || '—')}${!isCancel && r.wish ? `\n希望时间：${escapeHtmlVcm(r.wish)}` : ''}</div>
    <div style="font-size:10px;color:var(--text-3);margin-top:2px">${r.at ? escapeHtmlVcm(String(r.at).slice(0, 16).replace('T', ' ')) : ''}</div>
    ${hasRecord ? '<div style="font-size:10px;color:var(--text-3);margin-top:4px">已填写上课记录，只能驳回</div>' : ''}
    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
      ${!hasRecord ? (isCancel
        ? `<button class="btn btn-sm" style="background:var(--danger);color:#fff;border:none;border-radius:3px;padding:4px 12px;font-size:11px;cursor:pointer;font-family:inherit" onclick="openVipCancel('${b.id}',true)">同意取消</button>`
        : `<button class="btn btn-sm" style="background:#5a3a9a;color:#fff;border:none;border-radius:3px;padding:4px 12px;font-size:11px;cursor:pointer;font-family:inherit" onclick="openVipModify('${b.id}',true)">处理改期</button>`) : ''}
      <button class="btn btn-outline btn-sm" onclick="vipReqReject('${b.id}')">驳回</button>
    </div>
  </div>`;
}

function vipReqHandled(b, status, reply) {
  const r = vipReqOf(b); if (!r) return null;
  return Object.assign({}, r, { status, reply: reply || r.reply || '', handled_by: VIPH.who(), handled_at: new Date().toISOString() });
}

// bookings 新字段（cancel_reason / cancelled_by / cancelled_at / change_request）还没建时，去掉这些字段再存一次
async function vipBkPatchSafe(id, patch) {
  try { return await VIPH.patch(id, patch); }
  catch (e) {
    const extra = ['cancel_reason', 'cancelled_by', 'cancelled_at', 'change_request'];
    if (!extra.some(k => (e.message || '').includes(k))) throw e;
    const p2 = Object.assign({}, patch); extra.forEach(k => delete p2[k]);
    return await VIPH.patch(id, p2);
  }
}

function vipSysMsg(b, text, ev, x, snapB) { return [...(b.messages || []), ev ? vipNoticeMsg(snapB || b, text, ev, x) : { from: 'system', text, ts: Date.now() }]; }

// 驳回学生的申请
async function vipReqReject(id) {
  const b = VIPH.list().find(x => x.id === id); if (!b) return;
  const reply = prompt('驳回的回复（学生可以看到，必填）：', '');
  if (reply == null) return;
  if (!reply.trim()) { alert('请填写回复'); return; }
  const cr = vipReqHandled(b, 'rejected', reply.trim());
  try {
    const msgs = vipSysMsg(b, `【申请处理】老师驳回了${cr.type === 'cancel' ? '取消' : '改期'}申请：${reply.trim()}`);
    await vipBkPatchSafe(id, { change_request: cr, messages: msgs });
    b.change_request = cr; b.messages = msgs;
    VIPH.rerender();
  } catch (e) { alert('保存失败：' + e.message); }
}

function escapeHtmlVcm(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
