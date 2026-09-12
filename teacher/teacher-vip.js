// ── 老师端：VIP 框架补充（阶段2）──
// admin 分享给本老师（assigned_teacher === teacherName）的框架，在此填写/补充内容并提交。
// 复用同一套 vip_frameworks / vip_framework_items 表；提交后 status → done。

let teacherVipFrameworks = [];   // 分享给本老师的框架列表
let teacherVipPlans = [];        // 待本老师确认的学生方案（场景2）
let teacherVipMyPlans = [];      // 已确认/签约、指导老师是本人的 VIP 学生方案
let teacherVipAssignedStudents = []; // admin 在学生档案里指定「VIP指导老师」含本人的学生（students.vip_teachers）
let tspPlan = null;              // 当前编辑的学生方案
let tspItems = [];               // 工作副本
let tspStudent = null;           // 关联学生（取课时上限）
let tspUsedHours = 0;            // 已上课时（已完成预约合计）
let tspDoneNames = new Set();    // 已上完的课名
let vmTab = 'booking';           // VIP管理子tab：booking(预约) / students(学生进度) / framework(VIP框架)
function setVmTab(t) { vmTab = t; renderTeacherVipFrameworks(document.getElementById('mainContent')); }
let tvItems = [];                // 当前打开框架的条目（内存工作副本）
let tvCurrentId = null;
let tvOriginalItemIds = new Set();
let tvOpenCats = {};
let tpPlanId = null;             // 当前打开的学生方案 id
let tpPlanItems = [];            // 学生方案条目工作副本

// 标准分类顺序（老师端也需完整显示，含空的专业课分类，便于老师补充专业知识）
const VIP_CAT_ORDER = [
  ['found', '升学基本指导'], ['base', '专业课基础知识'], ['adv', '专业课备考强化'],
  ['method', '专业课基础方法论'], ['ext', '专业课拓展方法论'], ['past', '过去问对策'],
  ['eng', '英翻日对策'], ['plan', '研究计划书'], ['apply', '出愿指导'],
  ['inter', '面试对策'], ['ta', 'TA指导'],
];
const VIP_CAT_RANK = {}; VIP_CAT_ORDER.forEach(([k], i) => { VIP_CAT_RANK[k] = i; });
function vipCatRank(key) { return VIP_CAT_RANK[key] != null ? VIP_CAT_RANK[key] : 99; }

// ── 每回课的结构化作业（复用 shared/hw-core.js，与大课/VIP上课记录同一套）──
function tvHasHw(it) {
  const q = it && it.homework_questions;
  return !!(q && Array.isArray(q.levels) && q.levels.length);
}
function tvOpenHwEditor(itemId) {
  if (typeof HWC === 'undefined' || !HWC.openEditor) { alert('作业模块未加载，请刷新页面后重试'); return; }
  const it = tvItems.find(x => x.id === itemId);
  if (!it) return;
  HWC.openEditor({
    title: '布置作业', subtitle: 'VIP框架 · ' + (it.category_label || '') + ' · ' + (it.name || ''),
    questions: it.homework_questions, note: it.homework_note, storageDir: 'vffw-' + itemId,
    onSave: async (payload, note) => {
      it.homework_questions = payload; it.homework_note = note || '';
      renderTvEditor(document.getElementById('mainContent'));
    },
  });
}
function tspOpenHwEditor(i) {
  if (typeof HWC === 'undefined' || !HWC.openEditor) { alert('作业模块未加载，请刷新页面后重试'); return; }
  const it = tspItems[i];
  if (!it) return;
  HWC.openEditor({
    title: '布置作业', subtitle: 'VIP排课 · ' + (it.category_label || '') + ' · ' + (it.name || ''),
    questions: it.homework_questions, note: it.homework_note, storageDir: 'vipplan-' + (tspPlan ? tspPlan.id : 'x') + '-' + i,
    onSave: async (payload, note) => {
      it.homework_questions = payload; it.homework_note = note || '';
      renderTspEditor(document.getElementById('mainContent'));
    },
  });
}

// teacher.js 的 init 会调用它（若存在）
async function loadTeacherVipFrameworks() {
  if (!teacherName) { teacherVipFrameworks = []; teacherVipPlans = []; return; }
  // 数组包含查询：assigned_teachers 含本老师即可见（支持一个框架分享给多位老师）
  teacherVipFrameworks = await sb(
    `/rest/v1/vip_frameworks?assigned_teachers=cs.{"${teacherName}"}&status=in.("shared","done")&select=*&order=created_at.desc`
  ).catch(() => []);
  // 待本老师确认的学生方案（场景2）
  teacherVipPlans = await sb(
    `/rest/v1/vip_student_plans?assigned_teachers=cs.{"${teacherName}"}&status=eq.pending&select=*&order=created_at.desc`
  ).catch(() => []);
  // 已确认/签约、由本老师指导的 VIP 学生（可排期/改内容）
  teacherVipMyPlans = await sb(
    `/rest/v1/vip_student_plans?assigned_teachers=cs.{"${teacherName}"}&status=in.("signed","confirmed")&select=*&order=created_at.desc`
  ).catch(() => []);
  // admin 在学生档案里把本老师设为「VIP指导老师」的学生（即便还没有营业下发的 VIP 方案，也应在此可见）
  teacherVipAssignedStudents = await sb(
    `/rest/v1/students?vip_teachers=cs.{"${teacherName}"}&select=id,name,major,is_vip_course,vip_hours_total,vip_hours_used&order=name.asc`
  ).catch(() => []);
}

const TV_STATUS_LABEL = { shared: '待补充', done: '已完成' };
const TV_STATUS_COLOR = { shared: '#8a6d3b', done: '#1a4a28' };
const TV_STATUS_BG    = { shared: '#faf0dc', done: '#ddf0e0' };

function renderTeacherVipFrameworks(mc) {
  tvCurrentId = null;
  const hasFw = teacherVipFrameworks.length;
  const hasPlans = teacherVipPlans.length;
  const hasMine = teacherVipMyPlans.length;
  const hasVipBk = (typeof cachedTeacherBookings !== 'undefined') && cachedTeacherBookings.some(b => b.type === 'vip');
  // 学生档案里指派给本老师、但尚无课程方案的 VIP 学生（按姓名去重，已有方案的不重复列）
  const _myPlanNames = new Set(teacherVipMyPlans.map(p => p.student_name));
  const assignedOnly = (teacherVipAssignedStudents || []).filter(s => !_myPlanNames.has(s.name));
  const hasAssigned = assignedOnly.length;
  if (!hasFw && !hasPlans && !hasMine && !hasVipBk && !hasAssigned) {
    mc.innerHTML = '<div class="empty">暂无需要处理的 VIP 事项<br><span style="font-size:11px">收到 VIP 预约、指导的 VIP 学生或课程框架后，会在这里出现</span></div>';
    return;
  }

  const assignedBody = hasAssigned ? `
      <div style="font-size:12px;font-weight:600;color:#8a6d3b;margin-bottom:8px">已分配给你的 VIP 学生 <span style="font-size:10px;color:var(--text-3);font-weight:400">教务已指派，营业下发方案后即可排课</span></div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">${assignedOnly.map(s => {
        const used = parseFloat(s.vip_hours_used) || 0, tot = parseFloat(s.vip_hours_total) || 0;
        return `<div style="border:1px solid var(--border);border-radius:5px;padding:12px 14px;background:var(--surface);display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div style="min-width:0"><div style="font-size:13px;font-weight:600">${tvEsc(s.name)}<span style="font-size:10px;color:var(--text-3);font-weight:400;margin-left:8px">${tvEsc(majorLabel(s.major))}${tot ? ` · 已用 ${used}/${tot} 课时` : ''}</span></div><div style="font-size:10px;color:var(--text-3);margin-top:2px">${tvEsc(s.is_vip_course || 'VIP')}</div></div>
          <span style="flex-shrink:0;font-size:10px;padding:2px 10px;border-radius:3px;background:#faf0dc;color:#8a6d3b">待方案</span>
        </div>`;
      }).join('')}</div>` : '';
  const mineListHtml = hasMine ? `<div style="display:flex;flex-direction:column;gap:8px">${teacherVipMyPlans.map(p => {
        const done = (Array.isArray(p.items) ? p.items : []).filter(it => it.planned_date).length;
        const total = (Array.isArray(p.items) ? p.items : []).length;
        return `<div onclick="openTspEditor('${p.id}')" style="cursor:pointer;border:1px solid var(--border);border-radius:5px;padding:12px 14px;background:var(--surface);display:flex;align-items:center;justify-content:space-between;gap:12px" onmouseover="this.style.borderColor='var(--text-2)'" onmouseout="this.style.borderColor='var(--border)'">
          <div><div style="font-size:13px;font-weight:600">${tvEsc(p.student_name)}<span style="font-size:10px;color:var(--text-3);font-weight:400;margin-left:8px">${tvEsc(majorLabel(p.major))} · ${p.total_sessions || 0}回/${p.total_hours || 0}课时</span></div>${p.start_date ? `<div style="font-size:10px;color:var(--text-3);margin-top:2px">已排期 ${done}/${total} · 起始 ${tvEsc(p.start_date)}</div>` : '<div style="font-size:10px;color:#8a6d3b;margin-top:2px">尚未排期</div>'}</div>
          <span style="font-size:11px;color:#1a3a6a">排课 ›</span>
        </div>`;
      }).join('')}</div>` : '';
  const mineBody = (assignedBody + mineListHtml) || '<div style="font-size:12px;color:var(--text-3);padding:16px 0">暂无你指导的 VIP 学生</div>';

  const plansHtml = hasPlans ? `
    <div style="margin-bottom:22px">
      <div style="font-size:12px;font-weight:600;color:#8a6d3b;margin-bottom:8px">待确认学生方案 <span style="font-size:10px;color:var(--text-3);font-weight:400">营业发来、需你确认/补充后生效</span></div>
      <div style="display:flex;flex-direction:column;gap:8px">${teacherVipPlans.map(p => `
        <div onclick="openTeacherVipPlan('${p.id}')" style="cursor:pointer;border:1px solid var(--border);border-radius:5px;padding:12px 14px;background:var(--surface);display:flex;align-items:center;justify-content:space-between;gap:12px" onmouseover="this.style.borderColor='var(--text-2)'" onmouseout="this.style.borderColor='var(--border)'">
          <div style="min-width:0"><div style="font-size:13px;font-weight:600">${tvEsc(p.student_name)}<span style="font-size:10px;color:var(--text-3);font-weight:400;margin-left:8px">${tvEsc(majorLabel(p.major))} · ${p.total_sessions || 0}回/${p.total_hours || 0}课时</span></div>${p.note ? `<div style="font-size:11px;color:var(--text-2);margin-top:3px">📌 ${tvEsc(p.note)}</div>` : ''}</div>
          <span style="flex-shrink:0;font-size:10px;padding:2px 10px;border-radius:3px;background:#faf0dc;color:#8a6d3b">待确认</span>
        </div>`).join('')}</div>
    </div>` : '';

  const fwHtml = hasFw ? teacherVipFrameworks.map(f => {
    const st = f.status || 'shared';
    return `
    <div onclick="openTvFramework('${f.id}')" style="cursor:pointer;border:1px solid var(--border);border-radius:5px;padding:12px 14px;background:var(--surface);display:flex;align-items:center;justify-content:space-between;gap:12px;transition:border-color .12s" onmouseover="this.style.borderColor='var(--text-2)'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:600">${tvEsc(f.title || 'VIP框架')}</div>
        ${f.share_note ? `<div style="font-size:11px;color:var(--text-2);margin-top:3px">📌 ${tvEsc(f.share_note)}</div>` : ''}
      </div>
      <span style="flex-shrink:0;font-size:10px;padding:2px 10px;border-radius:3px;background:${TV_STATUS_BG[st]};color:${TV_STATUS_COLOR[st]}">${TV_STATUS_LABEL[st] || st}</span>
    </div>`;
  }).join('') : '';
  const fwSection = `
    ${plansHtml}
    <div>
      <div style="font-size:12px;font-weight:600;margin-bottom:8px">课程框架 <span style="font-size:10px;color:var(--text-3);font-weight:400">补充每节课内容与作业</span></div>
      <div style="display:flex;flex-direction:column;gap:8px">${fwHtml || '<div style="font-size:12px;color:var(--text-3);padding:8px 0">暂无待补充的课程框架</div>'}</div>
    </div>`;

  const fwCount = (hasPlans ? teacherVipPlans.length : 0) + (hasFw ? teacherVipFrameworks.length : 0);
  const tab = (id, label, n) => `<button onclick="setVmTab('${id}')" style="font-size:12px;padding:7px 18px;border:none;border-bottom:2px solid ${vmTab === id ? 'var(--accent,#1a1814)' : 'transparent'};background:none;cursor:pointer;font-family:inherit;color:${vmTab === id ? 'var(--text-1,#1a1814)' : 'var(--text-3)'};font-weight:${vmTab === id ? '600' : '400'}">${label}${n ? ` <span style="font-size:10px;color:#a33">${n}</span>` : ''}</button>`;

  const pendingVipBk = (typeof cachedTeacherBookings !== 'undefined') ? cachedTeacherBookings.filter(b => b.type === 'vip' && b.status === 'pending').length : 0;
  let body;
  if (vmTab === 'students') body = mineBody;
  else if (vmTab === 'framework') body = fwSection;
  else body = (typeof renderTeacherVipBookingsBody === 'function') ? renderTeacherVipBookingsBody() : '';

  mc.innerHTML = `
  <div class="page-section" style="max-width:900px">
    <div style="margin-bottom:12px">
      <div style="font-family:'Noto Serif SC',serif;font-size:16px;font-weight:600">VIP 管理</div>
      <div style="font-size:11px;color:var(--text-3);margin-top:2px">确认预约并锁定内容、给学生排课、补充课程框架</div>
    </div>
    <div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px">
      ${tab('booking', '预约', pendingVipBk)}
      ${tab('students', '学生进度', (teacherVipMyPlans.length + assignedOnly.length) || 0)}
      ${tab('framework', 'VIP框架', fwCount)}
    </div>
    ${body}
  </div>`;
}

async function openTvFramework(id) {
  const mc = document.getElementById('mainContent');
  mc.innerHTML = '<div class="loading">加载中…</div>';
  tvCurrentId = id;
  const items = await sb(`/rest/v1/vip_framework_items?framework_id=eq.${id}&select=*&order=sort_order.asc`).catch(() => []);
  tvItems = items;
  tvOriginalItemIds = new Set(items.map(i => i.id));
  tvOpenCats = {};
  renderTvEditor(mc);
}

function renderTvEditor(mc) {
  const fw = teacherVipFrameworks.find(f => f.id === tvCurrentId);
  if (!fw) { renderTeacherVipFrameworks(mc); return; }
  const st = fw.status || 'shared';

  // 显示全部标准分类（含空的专业课分类），老师可在任意分类补充内容
  const known = new Set(VIP_CAT_ORDER.map(c => c[0]));
  const groups = VIP_CAT_ORDER.map(([key, label]) => ({
    key, label,
    items: tvItems.filter(i => i.category === key).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
  }));
  // 追加非标准分类（若有）
  const extraMap = {};
  tvItems.forEach(it => {
    if (known.has(it.category)) return;
    const k = it.category || 'other';
    if (!extraMap[k]) { extraMap[k] = { key: k, label: it.category_label || k, items: [] }; groups.push(extraMap[k]); }
    extraMap[k].items.push(it);
  });

  const groupsHtml = groups.map(g => {
    const open = tvOpenCats[g.key] === true; // 默认收起，点击才展开
    const TV_CELL = 'font-size:11px;width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid var(--border);border-radius:3px;background:var(--surface);font-family:inherit';
    const rows = g.items.map((it, ri) => `
      <div style="border-top:1px solid var(--border-light);padding:7px 10px;display:grid;grid-template-columns:26px 1.1fr 2fr 1.4fr 64px 28px;gap:8px;align-items:start;background:${ri % 2 ? 'var(--bg)' : 'transparent'}">
        <div style="font-size:10px;color:var(--text-3);text-align:center;padding-top:6px">${ri + 1}</div>
        <input value="${tvEsc(it.name)}" placeholder="课程主题" onchange="tvEditItem('${it.id}','name',this.value)" style="${TV_CELL};font-weight:500">
        <textarea onchange="tvEditItem('${it.id}','content',this.value)" placeholder="内容说明（请按您实际授课补充）" rows="2" style="${TV_CELL};resize:vertical;line-height:1.5">${tvEsc(it.content)}</textarea>
        <div>
          <input value="${tvEsc(it.homework)}" placeholder="课后作业（一句话）" onchange="tvEditItem('${it.id}','homework',this.value)" style="${TV_CELL}">
          <button onclick="tvOpenHwEditor('${it.id}')" style="margin-top:4px;font-size:9px;background:${tvHasHw(it) ? 'var(--accent)' : 'none'};border:1px solid ${tvHasHw(it) ? 'var(--accent)' : 'var(--border)'};color:${tvHasHw(it) ? '#fff' : 'var(--text-3)'};border-radius:3px;padding:2px 8px;cursor:pointer;font-family:inherit">${tvHasHw(it) ? '📝 已设作业' : '📝 设置作业'}</button>
        </div>
        <input type="number" step="0.5" min="0" value="${it.default_hours != null ? it.default_hours : 2}" onchange="tvEditItem('${it.id}','default_hours',this.value)" style="${TV_CELL};text-align:center" title="课时">
        <button onclick="tvRemoveItem('${it.id}')" title="删除此条" style="background:none;border:1px solid var(--border);border-radius:3px;color:var(--text-3);cursor:pointer;font-size:12px;height:30px;width:100%">×</button>
      </div>`).join('') || '<div style="padding:8px 10px;font-size:11px;color:var(--text-3);border-top:1px solid var(--border-light)">该分类暂无条目</div>';

    return `
    <div style="border:1px solid var(--border);border-radius:5px;overflow:hidden">
      <div onclick="tvToggleCat('${g.key}')" style="cursor:pointer;padding:9px 12px;background:var(--bg);display:flex;align-items:center;justify-content:space-between;user-select:none">
        <div style="display:flex;align-items:center;gap:8px"><span style="border-radius:3px;padding:2px 10px;font-size:11px;font-weight:500;background:${(VIP_CAT_COLOR[g.key]||{}).bg||'#eee'};color:${(VIP_CAT_COLOR[g.key]||{}).color||'#333'}">${tvEsc(g.label)}</span><span style="font-size:10px;color:var(--text-3)">${g.items.length} 条</span></div>
        <span style="font-size:10px;color:var(--text-3)">${open ? '收起 ▾' : '展开 ▸'}</span>
      </div>
      <div style="display:${open ? 'block' : 'none'}">
        ${rows}
        <div style="border-top:1px solid var(--border-light);padding:6px 10px">
          <button onclick="tvAddItem('${g.key}','${tvEsc(g.label)}')" style="font-size:10px;background:none;border:1px dashed var(--border);border-radius:3px;padding:3px 10px;cursor:pointer;color:var(--text-3);font-family:inherit">＋ 添加一条</button>
        </div>
      </div>
    </div>`;
  }).join('');

  mc.innerHTML = `
  <div class="page-section" style="max-width:1000px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;flex-wrap:wrap">
      <button onclick="backToTvList()" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 12px;cursor:pointer;font-family:inherit;color:var(--text-2)">← 返回</button>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline" onclick="saveTvFramework(false)">暂存</button>
        <button class="btn btn-primary" onclick="submitTvFramework()">提交完成</button>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin:8px 0 6px">
      <div style="font-family:'Noto Serif SC',serif;font-size:16px;font-weight:600">${tvEsc(fw.title)}</div>
      <span style="font-size:10px;padding:2px 10px;border-radius:3px;background:${TV_STATUS_BG[st]};color:${TV_STATUS_COLOR[st]}">${TV_STATUS_LABEL[st] || st}</span>
      <span style="font-size:11px;color:var(--text-3)">共 ${tvItems.length} 条</span>
    </div>
    ${fw.share_note ? `<div style="font-size:11px;color:var(--text-2);background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px 12px;margin-bottom:14px">📌 学科负责人提示：${tvEsc(fw.share_note)}</div>` : '<div style="margin-bottom:14px"></div>'}

    <div style="display:flex;flex-direction:column;gap:10px">${groupsHtml}</div>

    <div style="margin-top:16px;font-size:11px;color:var(--text-3)">
      「暂存」只保存内容、状态不变；「提交完成」保存并把框架标记为已完成，交回学科负责人。
    </div>
  </div>`;
}

function backToTvList() {
  renderTeacherVipFrameworks(document.getElementById('mainContent'));
}
function tvToggleCat(key) {
  tvOpenCats[key] = tvOpenCats[key] === true ? false : true;
  renderTvEditor(document.getElementById('mainContent'));
}
function tvEditItem(id, field, value) {
  const it = tvItems.find(x => x.id === id);
  if (!it) return;
  it[field] = field === 'default_hours' ? (parseFloat(value) || 0) : value;
  if (field !== 'default_hours') it.filled = true;
}
function tvAddItem(cat, label) {
  const maxOrder = tvItems.reduce((m, i) => Math.max(m, i.sort_order || 0), 0);
  tvItems.push({
    id: 'vfi-new-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
    framework_id: tvCurrentId, category: cat, category_label: label,
    name: '', content: '', homework: '', default_hours: 2,
    sort_order: maxOrder + 1, source: 'custom', filled: true, _new: true,
  });
  tvOpenCats[cat] = true;
  renderTvEditor(document.getElementById('mainContent'));
}
function tvRemoveItem(id) {
  tvItems = tvItems.filter(x => x.id !== id);
  renderTvEditor(document.getElementById('mainContent'));
}

async function saveTvFramework(silent) {
  const btn = document.querySelector('#mainContent .btn-primary');
  if (btn && !silent) { btn.textContent = '保存中…'; btn.disabled = true; }
  try {
    const newItems = tvItems.filter(i => i._new);
    const existing = tvItems.filter(i => !i._new);
    const currentIds = new Set(tvItems.map(i => i.id));
    const removedIds = [...tvOriginalItemIds].filter(id => !currentIds.has(id));

    if (newItems.length) {
      const payload = newItems.map(({ _new, ...rest }) => rest);
      for (let i = 0; i < payload.length; i += 20) {
        await sb('/rest/v1/vip_framework_items', 'POST', payload.slice(i, i + 20));
      }
    }
    for (const it of existing) {
      await sb(`/rest/v1/vip_framework_items?id=eq.${it.id}`, 'PATCH', {
        name: it.name, content: it.content, homework: it.homework,
        homework_questions: it.homework_questions || null, homework_note: it.homework_note || null,
        default_hours: it.default_hours, sort_order: it.sort_order, filled: it.filled || false,
      });
    }
    for (const id of removedIds) {
      await sb(`/rest/v1/vip_framework_items?id=eq.${id}`, 'DELETE');
    }
    tvItems.forEach(i => delete i._new);
    tvOriginalItemIds = new Set(tvItems.map(i => i.id));
    if (!silent) { alert('已暂存'); renderTvEditor(document.getElementById('mainContent')); }
  } catch (e) {
    alert('保存失败：' + e.message);
    if (btn && !silent) { btn.textContent = '提交完成'; btn.disabled = false; }
    throw e;
  }
}

async function submitTvFramework() {
  if (!confirm('确认提交完成？提交后框架标记为「已完成」交回学科负责人（之后仍可继续修改）。')) return;
  try {
    await saveTvFramework(true);
    await sb(`/rest/v1/vip_frameworks?id=eq.${tvCurrentId}`, 'PATCH', { status: 'done' });
    const fw = teacherVipFrameworks.find(f => f.id === tvCurrentId);
    if (fw) fw.status = 'done';
    alert('已提交完成');
    renderTvEditor(document.getElementById('mainContent'));
  } catch (e) {
    // saveTvFramework 已弹错
  }
}

function tvEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


// ── 上课老师：确认学生方案（场景2）──
function openTeacherVipPlan(id) {
  const p = teacherVipPlans.find(x => x.id === id);
  if (!p) return;
  tpPlanId = id;
  tpPlanItems = (Array.isArray(p.items) ? p.items : []).map(it => ({ ...it }));
  renderTvPlanEditor(document.getElementById('mainContent'));
}

function renderTvPlanEditor(mc) {
  const p = teacherVipPlans.find(x => x.id === tpPlanId);
  if (!p) { renderTeacherVipFrameworks(mc); return; }

  // 按分类分组（保持原顺序）
  const catMap = {};
  tpPlanItems.forEach((it, i) => {
    const k = it.category || 'other';
    if (!catMap[k]) catMap[k] = { key: k, label: it.category_label || k, idxs: [], min: i };
    catMap[k].idxs.push(i);
  });
  const groups = Object.values(catMap).sort((a, b) => vipCatRank(a.key) - vipCatRank(b.key));

  const groupsHtml = groups.map(g => {
    const rows = g.idxs.map(i => {
      const it = tpPlanItems[i];
      return `
      <div style="border-top:1px solid var(--border-light);padding:8px 10px;display:grid;grid-template-columns:1.1fr 2fr 1.4fr 64px;gap:8px;align-items:start">
        <input value="${tvEsc(it.name)}" onchange="tpPlanEdit(${i},'name',this.value)" style="font-size:11px;font-weight:500">
        <textarea onchange="tpPlanEdit(${i},'content',this.value)" placeholder="内容说明" style="font-size:11px;resize:vertical;min-height:34px;line-height:1.5">${tvEsc(it.content)}</textarea>
        <input value="${tvEsc(it.homework)}" onchange="tpPlanEdit(${i},'homework',this.value)" placeholder="课后作业" style="font-size:11px">
        <input type="number" step="0.5" min="0" value="${it.hours != null ? it.hours : 2}" onchange="tpPlanEdit(${i},'hours',this.value)" style="font-size:11px;text-align:center">
      </div>`;
    }).join('');
    return `<div style="border:1px solid var(--border);border-radius:5px;overflow:hidden;margin-bottom:10px"><div style="padding:8px 12px;background:var(--bg);font-size:12px;font-weight:600">${tvEsc(g.label)}</div>${rows}</div>`;
  }).join('');

  mc.innerHTML = `
  <div class="page-section" style="max-width:1000px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;flex-wrap:wrap">
      <button onclick="backToTvList()" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 12px;cursor:pointer;font-family:inherit;color:var(--text-2)">← 返回</button>
      <button class="btn btn-primary" onclick="confirmTvPlan()">确认方案</button>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin:8px 0 6px">
      <div style="font-family:'Noto Serif SC',serif;font-size:16px;font-weight:600">${tvEsc(p.student_name)} 的 VIP 方案</div>
      <span style="font-size:11px;color:var(--text-3)">${p.total_sessions || 0} 回 · ${p.total_hours || 0} 课时</span>
    </div>
    ${p.note ? `<div style="font-size:11px;color:var(--text-2);background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px 12px;margin-bottom:8px">📌 营业提示：${tvEsc(p.note)}</div>` : ''}
    ${(p.subject_hours && p.subject_hours > 0) ? `<div style="font-size:12px;color:#5a3010;background:#faf0dc;border:1px solid #e8d9b8;border-radius:4px;padding:8px 12px;margin-bottom:14px;font-weight:500">📚 专业知识要求总课时：${p.subject_hours} 课时　<span style="font-size:10px;font-weight:400;color:#8a6d3b">请按此小时数安排专业课（基础/备考/方法论/拓展）</span></div>` : '<div style="margin-bottom:14px"></div>'}
    ${groupsHtml}
    <div style="font-size:11px;color:var(--text-3);margin-top:10px">可直接修改每节课内容/作业/课时，改完点「确认方案」，方案即生效。</div>
  </div>`;
}

function tpPlanEdit(idx, field, value) {
  const it = tpPlanItems[idx];
  if (!it) return;
  it[field] = field === 'hours' ? (parseFloat(value) || 0) : value;
}

async function confirmTvPlan() {
  if (!confirm('确认此学生方案？确认后方案生效，可用于学生 VIP 课程安排。')) return;
  try {
    const totalHours = tpPlanItems.reduce((a, it) => a + (parseFloat(it.hours) || 0), 0);
    await sb(`/rest/v1/vip_student_plans?id=eq.${tpPlanId}`, 'PATCH', {
      items: tpPlanItems, total_hours: +totalHours.toFixed(1), status: 'confirmed',
    });
    teacherVipPlans = teacherVipPlans.filter(x => x.id !== tpPlanId);
    alert('已确认，方案生效');
    renderTeacherVipFrameworks(document.getElementById('mainContent'));
  } catch (e) { alert('确认失败：' + e.message); }
}

// ── 上课老师：给 VIP 学生排课（每周节奏 + 逐回调整），改动记录给 admin ──
const TSP_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function tspYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function tspMD(s) { if (!s) return ''; const p = s.split('-'); return p.length === 3 ? (+p[1]) + '/' + (+p[2]) : s; }

// 把方案排成「回」——与建方案时的算法一致：
//   专业课(基础/备考/方法论/拓展)每2小时一回；其它类每门一回(保留其课时)；TA不计回但算课时；专业知识总课时按每2小时一回展开
const TSP_SUBJECT_CATS = ['base', 'adv', 'method', 'ext'];
function tspExpandSessions(items, subjH) {
  const out = [];
  items.forEach(it => {
    const h = Math.max(0, parseFloat(it.hours) || 0);
    if (TSP_SUBJECT_CATS.includes(it.category) && h > 2.0001) {
      const n = Math.max(1, Math.round(h / 2));
      for (let k = 0; k < n; k++) {
        const hh = (k < n - 1) ? 2 : +(h - 2 * (n - 1)).toFixed(1);
        out.push({ category: it.category, category_label: it.category_label, name: it.name + ` (${k + 1}/${n})`, content: it.content, homework: it.homework, hours: hh > 0 ? hh : 2, planned_date: '' });
      }
    } else {
      out.push({ ...it, planned_date: it.planned_date || '' });
    }
  });
  if (subjH > 0) {
    const n = Math.max(1, Math.round(subjH / 2));
    for (let k = 0; k < n; k++) out.push({ category: 'base', category_label: '专业知识', name: `专业知识 (${k + 1}/${n})`, content: '', homework: '', hours: 2, planned_date: '' });
  }
  return out;
}
// 回数=非TA的行数，课时=全部课时之和（与建方案时一致）
function tspCountSessions(arr) { return arr.filter(it => it.category !== 'ta').length; }
function tspSumHours(arr) { return +arr.reduce((a, it) => a + (parseFloat(it.hours) || 0), 0).toFixed(1); }

async function openTspEditor(planId) {
  const p = teacherVipMyPlans.find(x => x.id === planId);
  if (!p) return;
  tspPlan = p;
  // 拉学生课时上限 + 已上课（已完成预约）
  tspStudent = null; tspUsedHours = 0; tspDoneNames = new Set();
  try {
    if (p.student_id) {
      const st = await sb(`/rest/v1/students?id=eq.${p.student_id}&select=vip_hours_total,vip_hours_used&limit=1`);
      tspStudent = (st && st[0]) || null;
    }
    const bks = await sb(`/rest/v1/bookings?name=eq.${encodeURIComponent(p.student_name)}&type=eq.vip&status=eq.completed&select=vip_content,vip_hours_used,slot_date`).catch(() => []);
    (bks || []).forEach(b => { tspUsedHours += parseFloat(b.vip_hours_used) || 0; if (b.vip_content) tspDoneNames.add(b.vip_content); });
  } catch (e) {}
  let items = (Array.isArray(p.items) ? p.items : []).map(it => ({ ...it }));
  const subjH = parseFloat(p.subject_hours) || 0;
  const needExpand = items.some(it => TSP_SUBJECT_CATS.includes(it.category) && (parseFloat(it.hours) || 0) > 2.0001) || subjH > 0;
  if (needExpand) { items = tspExpandSessions(items, subjH); tspPlan._justExpanded = true; }
  else { tspPlan._justExpanded = false; }
  tspItems = items.sort((a, b) => vipCatRank(a.category) - vipCatRank(b.category));
  renderTspEditor(document.getElementById('mainContent'));
}
function tspCap() { return tspStudent && tspStudent.vip_hours_total != null ? parseFloat(tspStudent.vip_hours_total) || 0 : 0; }

function renderTspEditor(mc) {
  const p = tspPlan;
  if (!p) { renderTeacherVipFrameworks(mc); return; }
  const dayOpts = TSP_DAYS.map((d, i) => `<option value="${i}"${p.weekly_day === i ? ' selected' : ''}>${d}</option>`).join('');
  const dated = tspItems.filter(it => it.planned_date).map(it => it.planned_date).sort();
  const endDate = dated.length ? dated[dated.length - 1] : '';

  const rows = tspItems.map((it, i) => {
    const col = VIP_CAT_COLOR[it.category] || { bg: '#eee', color: '#333' };
    const done = tspDoneNames.has(it.name);
    return `
    <div style="display:grid;grid-template-columns:140px 1fr 1.4fr 56px;gap:8px;align-items:start;padding:8px 10px;border-top:1px solid var(--border-light);${done ? 'background:#f2f8f3' : ''}">
      <input type="date" value="${it.planned_date || ''}" onchange="tspEdit(${i},'planned_date',this.value)" style="font-size:11px;width:100%;box-sizing:border-box"${done ? ' disabled' : ''}>
      <div>
        <div style="margin-bottom:3px"><span style="border-radius:2px;padding:1px 6px;font-size:9px;background:${col.bg};color:${col.color}">${tvEsc(it.category_label || '')}</span>${done ? '<span style="font-size:9px;color:#1a7a3a;margin-left:6px">✓ 已上</span>' : ''}</div>
        <input value="${tvEsc(it.name)}" onchange="tspEdit(${i},'name',this.value)" style="font-size:11px;font-weight:500;width:100%"${done ? ' disabled' : ''}>
      </div>
      <div>
        <textarea onchange="tspEdit(${i},'content',this.value)" placeholder="内容" style="font-size:11px;resize:vertical;min-height:34px;line-height:1.5;width:100%;box-sizing:border-box"${done ? ' disabled' : ''}>${tvEsc(it.content)}</textarea>
        <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap">
          <input value="${tvEsc(it.homework || '')}" onchange="tspEdit(${i},'homework',this.value)" placeholder="课后作业（一句话）" style="font-size:10px;flex:1;min-width:110px"${done ? ' disabled' : ''}>
          <button onclick="tspOpenHwEditor(${i})" style="font-size:9px;background:none;border:1px solid ${tvHasHw(it) ? 'var(--accent)' : 'var(--border)'};color:${tvHasHw(it) ? 'var(--accent)' : 'var(--text-3)'};border-radius:3px;padding:1px 8px;cursor:pointer;font-family:inherit;white-space:nowrap">${tvHasHw(it) ? '📝 已设作业' : '📝 设置作业'}</button>
        </div>
      </div>
      <input type="number" step="0.5" min="0" value="${it.hours != null ? it.hours : 2}" onchange="tspEdit(${i},'hours',this.value)" style="font-size:11px;text-align:center"${done ? ' disabled' : ''}>
    </div>`;
  }).join('');

  mc.innerHTML = `
  <div class="page-section" style="max-width:1000px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;flex-wrap:wrap">
      <button onclick="backToTvList()" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 12px;cursor:pointer;font-family:inherit;color:var(--text-2)">← 返回</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" onclick="tspClearSchedule()">清空排期</button>
        <button class="btn btn-outline" onclick="tspSaveAsTemplate()">另存为套餐</button>
        <button class="btn btn-primary" onclick="tspSave()">保存排期</button>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin:8px 0 4px">
      <div style="font-family:'Noto Serif SC',serif;font-size:16px;font-weight:600">${tvEsc(p.student_name)} 的 VIP 排课</div>
      <span style="font-size:11px;color:var(--text-3)">${tspCountSessions(tspItems)} 回 · ${tspSumHours(tspItems)} 课时</span>
    </div>

    ${(() => {
      const cap = tspCap(); const used = +tspUsedHours.toFixed(1); const planH = tspSumHours(tspItems);
      const remain = cap > 0 ? +(cap - used).toFixed(1) : null;
      const over = cap > 0 && planH > cap + 0.001;
      const cell = (label, val, color) => `<div style="text-align:center"><div style="font-size:9px;color:var(--text-3)">${label}</div><div style="font-size:16px;font-weight:600;font-family:'DM Mono',monospace;${color ? 'color:' + color : ''}">${val}</div></div>`;
      return `<div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;padding:10px 14px;border:1px solid ${over ? '#e0b0a0' : 'var(--border)'};border-radius:5px;background:${over ? '#fbf0ec' : 'var(--surface)'};margin:6px 0 12px">
        ${cell('学生课时', cap > 0 ? cap : '未设', cap > 0 ? '' : '#a33')}
        ${cell('已上', used, '#8a6d3b')}
        ${cell('剩余', remain != null ? remain : '—', '#1a4a28')}
        <div style="width:1px;height:26px;background:var(--border)"></div>
        ${cell('本方案计划', planH, over ? '#a33' : '')}
        ${cell('预计完成', endDate ? tspMD(endDate) : '—')}
        ${over ? '<div style="font-size:11px;color:#a33;margin-left:auto">⚠ 计划课时已超学生课时上限，请下调至 ' + cap + ' 以内</div>' : (cap > 0 ? '<div style="font-size:10px;color:var(--text-3);margin-left:auto">只能在学生课时额度内安排</div>' : '')}
      </div>`;
    })()}

    <div style="padding:12px 14px;border:1px solid var(--border);border-radius:5px;background:var(--bg);margin:12px 0">
      <div style="font-size:12px;font-weight:600;margin-bottom:8px">每周固定上课节奏</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span style="font-size:11px;color:var(--text-3)">起始日</span>
        <input type="date" id="tsp_start" value="${p.start_date || ''}" style="font-size:12px">
        <span style="font-size:11px;color:var(--text-3)">每周</span>
        <select id="tsp_day" style="font-size:12px">${dayOpts}</select>
        <span style="font-size:11px;color:var(--text-3)">时间</span>
        <input type="time" id="tsp_time" value="${p.weekly_time || ''}" style="font-size:12px">
        <button class="btn btn-primary" onclick="tspAutoSchedule()" style="white-space:nowrap">自动排期（每周一回）</button>
      </div>
      <div style="font-size:10px;color:var(--text-3);margin-top:6px">自动按每周一回往后排出日期；排好后可逐回改日期（改成一周多次或某段集中上课），内容也可改。${endDate ? '　预计结束：' + tspMD(endDate) : ''}</div>
    </div>

    <div style="border:1px solid var(--border);border-radius:5px;overflow:hidden">
      <div style="display:grid;grid-template-columns:140px 1fr 1.4fr 56px;gap:8px;padding:7px 10px;background:var(--bg);font-size:10px;color:var(--text-3);font-weight:600">
        <div>日期</div><div>课程</div><div>内容</div><div style="text-align:center">课时</div>
      </div>
      ${rows || '<div style="padding:12px;font-size:11px;color:var(--text-3)">此方案暂无课程</div>'}
    </div>
    <div style="font-size:11px;color:var(--text-3);margin-top:10px">说明：这里的修改只对<strong>该学生</strong>生效（不影响套餐）；每次保存会在管理端留一条变更记录。若想沉淀成通用套餐，用「另存为套餐」。</div>
  </div>`;
}

function tspSyncCadence() {
  const s = document.getElementById('tsp_start'), d = document.getElementById('tsp_day'), t = document.getElementById('tsp_time');
  if (s) tspPlan.start_date = s.value || null;
  if (d) tspPlan.weekly_day = d.value === '' ? null : parseInt(d.value);
  if (t) tspPlan.weekly_time = t.value || null;
}
function tspEdit(i, field, val) {
  const it = tspItems[i]; if (!it) return;
  it[field] = field === 'hours' ? (parseFloat(val) || 0) : val;
  if (field === 'planned_date') { tspSyncCadence(); renderTspEditor(document.getElementById('mainContent')); }
}

// 清空排期：清掉所有日期与每周节奏（不删方案），重新排
function tspClearSchedule() {
  if (!confirm('确认清空该学生的排期日期与每周节奏？（课程内容保留，方案不会被删除）')) return;
  tspSyncCadence();
  tspItems.forEach(it => { it.planned_date = ''; });
  tspPlan.start_date = null; tspPlan.weekly_day = null; tspPlan.weekly_time = null;
  renderTspEditor(document.getElementById('mainContent'));
}

function tspAutoSchedule() {
  const startV = document.getElementById('tsp_start').value;
  const dayV = parseInt(document.getElementById('tsp_day').value);
  const timeV = document.getElementById('tsp_time').value;
  if (!startV) { alert('请先选择起始日期'); return; }
  // 先把节奏写进方案对象，避免重绘时输入框被清空
  tspPlan.start_date = startV;
  tspPlan.weekly_day = isNaN(dayV) ? null : dayV;
  tspPlan.weekly_time = timeV || null;
  let d = new Date(startV + 'T12:00:00');
  if (!isNaN(dayV)) { let guard = 0; while (d.getDay() !== dayV && guard < 7) { d.setDate(d.getDate() + 1); guard++; } }
  tspItems.forEach(it => { it.planned_date = tspYmd(d); d = new Date(d); d.setDate(d.getDate() + 7); });
  renderTspEditor(document.getElementById('mainContent'));
}

async function tspLog(action, detail) {
  try {
    await sb('/rest/v1/vip_plan_logs', 'POST', [{
      id: 'vlog-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      plan_id: tspPlan.id, student_name: tspPlan.student_name,
      teacher_name: (typeof teacherName !== 'undefined' ? teacherName : ''), action, detail,
    }]);
  } catch (e) {}
}

async function tspSave() {
  const startV = document.getElementById('tsp_start').value || null;
  const dayV = document.getElementById('tsp_day').value;
  const timeV = document.getElementById('tsp_time').value || null;
  try {
    const cap = tspCap();
    const planH = tspSumHours(tspItems);
    if (cap > 0 && planH > cap + 0.001) { alert(`本方案计划课时 ${planH} 已超出学生课时上限 ${cap}，请先把课时下调到 ${cap} 以内再保存。`); return; }
    const patch = {
      items: tspItems, total_hours: tspSumHours(tspItems), total_sessions: tspCountSessions(tspItems),
      start_date: startV, weekly_day: dayV === '' ? null : parseInt(dayV), weekly_time: timeV,
    };
    if (tspPlan._justExpanded) patch.subject_hours = 0;     // 专业知识已展开进 items，避免重复计
    await sb(`/rest/v1/vip_student_plans?id=eq.${tspPlan.id}`, 'PATCH', patch);
    Object.assign(tspPlan, patch); tspPlan._justExpanded = false;
    const scheduled = tspItems.filter(it => it.planned_date).length;
    await tspLog('排期/编辑', `起始 ${startV || '—'}，每周${TSP_DAYS[parseInt(dayV)] || '—'} ${timeV || ''}，已排 ${scheduled}/${tspItems.length} 回`);
    alert('已保存排期，并已在管理端留档。');
    renderTeacherVipFrameworks(document.getElementById('mainContent'));
  } catch (e) { alert('保存失败：' + e.message); }
}

async function tspSaveAsTemplate() {
  const name = (prompt('套餐名称（如 20H / 30小时）：', (tspPlan.total_hours || '') + 'H') || '').trim();
  if (!name) return;
  const items = tspItems.map(it => ({ category: it.category, category_label: it.category_label, name: it.name, content: it.content, homework: it.homework, homework_questions: it.homework_questions || null, homework_note: it.homework_note || null, hours: parseFloat(it.hours) || 0 }));
  const total = items.reduce((a, it) => a + (it.hours || 0), 0);
  try {
    await sb('/rest/v1/vip_plan_templates', 'POST', [{
      id: 'vtpl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      framework_id: tspPlan.framework_id || '', major: tspPlan.major || '', name,
      items, total_sessions: tspPlan.total_sessions || 0, total_hours: +total.toFixed(1), subject_hours: tspPlan.subject_hours || 0,
    }]);
    await tspLog('另存套餐', `套餐名「${name}」`);
    alert(`已另存为套餐「${name}」。`);
  } catch (e) { alert('保存失败：' + e.message); }
}

// ════════════════════════════════════════════════════════════════
// 营业老师：VIP规划（p.vip_sales 权限开启后显示）
// 还原独立 VIP 页面的点选体验：彩色分类 + 可点选课程 + 汇总(回/课时) + 生成PDF。
// 数据来自 admin 建立、老师补充后的框架条目。转分享给上课老师亦在此。
// ════════════════════════════════════════════════════════════════
let salesVipFrameworks = [];
let svAllTeachers = [];
let svCurrentId = null;
let svItems = [];
let svShareTeachers = [];
let svSel = new Set();          // 已选条目 id
let svHrs = {};                 // 条目 id → 自定义课时（仅可调课时的分类）
let svSubjectHours = 0;         // 专业知识四部分总课时（老师按此安排）
let svShareOpen = false;
let svTab = 'presets';          // 营业子视图：presets(套餐) / templates(从框架规划) / plans(学生方案)
let salesStudentPlans = [];     // 已保存的学生方案
let svTemplates = [];           // 当前框架下的命名套餐
let salesTemplates = [];        // 全部套餐（营业首页「套餐」用）

// 分类配色（还原 VIP.html）
const VIP_CAT_COLOR = {
  found:  { bg: '#f5f0e8', color: '#2a2820' },
  base:   { bg: '#ddeaf8', color: '#1a3a6a' },
  adv:    { bg: '#e8e4f8', color: '#3a2a7a' },
  method: { bg: '#ddf0e0', color: '#1a4a28' },
  ext:    { bg: '#f0f4e8', color: '#3a4a18' },
  past:   { bg: '#f8e4dc', color: '#6a2818' },
  eng:    { bg: '#ece8e0', color: '#3a3830' },
  plan:   { bg: '#faecd8', color: '#5a3010' },
  apply:  { bg: '#fbeaf0', color: '#6a1a3a' },
  inter:  { bg: '#e1f0ea', color: '#0a4030' },
  ta:     { bg: '#e8eaf8', color: '#1a2a6a' },
};
const VIP_SUBJECT_CATS = ['base', 'adv', 'method', 'ext']; // 按 课时/2 计回、课时固定
const VIP_HOURS_OPTIONS = [0.5, 1, 2, 3, 4];

async function loadSalesVipData() {
  const [fw, ts, pl, tpl] = await Promise.all([
    sb('/rest/v1/vip_frameworks?select=*&order=major.asc,created_at.desc').catch(() => []),
    sb('/rest/v1/teachers?select=name&order=name.asc').catch(() => []),
    sb('/rest/v1/vip_student_plans?select=*&order=created_at.desc').catch(() => []),
    sb('/rest/v1/vip_plan_templates?select=*&order=major.asc,created_at.desc').catch(() => []),
  ]);
  salesVipFrameworks = fw; svAllTeachers = ts; salesStudentPlans = pl; salesTemplates = tpl;
}

// ── 营业首页：课程模板 / 学生方案 两个子视图 ──
async function renderVipSalesPlanning(mc) {
  svCurrentId = null;
  mc.innerHTML = '<div class="loading">加载中…</div>';
  await loadSalesVipData();
  renderSvHome(mc);
}

function svSetTab(t) { svTab = t; renderSvHome(document.getElementById('mainContent')); }

function renderSvHome(mc) {
  const tabBtn = (id, label, n) => `<button onclick="svSetTab('${id}')" style="font-size:12px;padding:6px 14px;border:none;border-bottom:2px solid ${svTab === id ? 'var(--text-1,#1a1814)' : 'transparent'};background:none;cursor:pointer;font-family:inherit;color:${svTab === id ? 'var(--text-1,#1a1814)' : 'var(--text-3)'};font-weight:${svTab === id ? '600' : '400'}">${label}${n ? ` <span style="font-size:10px;color:var(--text-3)">${n}</span>` : ''}</button>`;

  const header = `
    <div style="margin-bottom:10px">
      <div style="font-family:'Noto Serif SC',serif;font-size:16px;font-weight:600">VIP 规划</div>
      <div style="font-size:11px;color:var(--text-3);margin-top:2px">「套餐」= 直接选现成的方案套用给学生；「从框架规划」= 从头点选课程；已保存的在「学生方案」查看</div>
    </div>
    <div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px">
      ${tabBtn('presets', '套餐', salesTemplates.length)}
      ${tabBtn('templates', '从框架规划')}
      ${tabBtn('plans', '学生方案', salesStudentPlans.length)}
    </div>`;

  let body;
  if (svTab === 'plans') {
    body = renderSvPlansBody();
  } else if (svTab === 'presets') {
    body = renderSvPresetsBody();
  } else {
    const byMajor = {};
    salesVipFrameworks.forEach(f => { (byMajor[f.major] = byMajor[f.major] || []).push(f); });
    const majorKeys = Object.keys(byMajor).sort();
    const stLabel = { draft: '编辑中', shared: '待补充', done: '已完成' };
    const stColor = { draft: '#8a6d3b', shared: '#1a3a6a', done: '#1a4a28' };
    const stBg = { draft: '#faf0dc', shared: '#ddeaf8', done: '#ddf0e0' };
    body = majorKeys.length ? majorKeys.map(mk => {
      const cards = byMajor[mk].map(f => {
        const st = f.status || 'draft';
        return `<div onclick="openSvFramework('${f.id}')" style="cursor:pointer;border:1px solid var(--border);border-radius:5px;padding:11px 13px;background:var(--surface);display:flex;align-items:center;justify-content:space-between;gap:10px;transition:border-color .12s" onmouseover="this.style.borderColor='var(--text-2)'" onmouseout="this.style.borderColor='var(--border)'"><div style="min-width:0"><div style="font-size:12px;font-weight:600">${tvEsc(f.title || 'VIP框架')}</div></div><span style="flex-shrink:0;font-size:10px;padding:2px 9px;border-radius:3px;background:${stBg[st]};color:${stColor[st]}">${stLabel[st] || st}</span></div>`;
      }).join('');
      return `<div style="margin-bottom:16px"><div style="font-size:11px;letter-spacing:.06em;color:var(--text-3);padding-bottom:6px;border-bottom:1px solid var(--border-light);margin-bottom:8px">${tvEsc(majorLabel(mk))}</div><div style="display:flex;flex-direction:column;gap:6px">${cards}</div></div>`;
    }).join('') : '<div class="empty">暂无 VIP 框架模板<br><span style="font-size:11px">请学科负责人先在「VIP框架」建立模板</span></div>';
  }

  mc.innerHTML = `<div class="page-section" style="max-width:900px">${header}${body}</div>`;
}

// 套餐视图：全部套餐按专业分组，点一个直接进对应框架并预填
function renderSvPresetsBody() {
  if (!salesTemplates.length) return '<div class="empty">暂无套餐<br><span style="font-size:11px">请学科负责人在「VIP框架」里点开框架、在「课程套餐」新建（如 20H / 30小时）</span></div>';
  const byMajor = {};
  salesTemplates.forEach(t => { (byMajor[t.major] = byMajor[t.major] || []).push(t); });
  const majorKeys = Object.keys(byMajor).sort();
  return majorKeys.map(mk => {
    const cards = byMajor[mk].map(t => {
      const items = Array.isArray(t.items) ? t.items : [];
      return `<div onclick="openSvPreset('${t.id}')" style="cursor:pointer;border:1px solid var(--border);border-radius:5px;padding:12px 14px;background:var(--surface);display:flex;align-items:center;justify-content:space-between;gap:10px" onmouseover="this.style.borderColor='var(--text-2)'" onmouseout="this.style.borderColor='var(--border)'">
        <div><div style="font-size:14px;font-weight:600">${tvEsc(t.name || '套餐')}</div><div style="font-size:11px;color:var(--text-3);margin-top:2px">${t.total_sessions || 0} 回 · ${t.total_hours || 0} 课时${(t.subject_hours && t.subject_hours > 0) ? '（含专业知识' + t.subject_hours + '）' : ''} · ${items.length} 门课</div></div>
        <span style="font-size:11px;color:var(--accent,#1a3a6a)">套用 ›</span>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:16px"><div style="font-size:11px;letter-spacing:.06em;color:var(--text-3);padding-bottom:6px;border-bottom:1px solid var(--border-light);margin-bottom:8px">${tvEsc(majorLabel(mk))}</div><div style="display:flex;flex-direction:column;gap:6px">${cards}</div></div>`;
  }).join('');
}

// 点套餐 → 进入对应框架点选页并自动预填该套餐
async function openSvPreset(tid) {
  const t = salesTemplates.find(x => x.id === tid);
  if (!t) return;
  await openSvFramework(t.framework_id);
  applySvTemplate(tid);
}

function renderSvPlansBody() {
  if (!salesStudentPlans.length) return '<div class="empty">暂无已保存的学生方案<br><span style="font-size:11px">在「套餐」或「从框架规划」里操作后，保存签约或发老师确认即会出现在这里</span></div>';
  const stLabel = { signed: '已签约', pending: '待老师确认', confirmed: '老师已确认' };
  const stColor = { signed: '#1a4a28', pending: '#8a6d3b', confirmed: '#1a3a6a' };
  const stBg = { signed: '#ddf0e0', pending: '#faf0dc', confirmed: '#ddeaf8' };
  return '<div style="display:flex;flex-direction:column;gap:8px">' + salesStudentPlans.map(p => {
    const st = p.status || 'signed';
    const linked = p.student_id ? '　·　已在籍' : '';
    return `
    <div style="border:1px solid var(--border);border-radius:5px;padding:11px 13px;background:var(--surface);display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div onclick="openSvPlan('${p.id}')" style="cursor:pointer;min-width:0;flex:1">
        <div style="font-size:13px;font-weight:600">${tvEsc(p.student_name)}<span style="font-size:10px;color:var(--text-3);font-weight:400;margin-left:8px">${tvEsc(majorLabel(p.major))} · ${p.total_sessions || 0}回/${p.total_hours || 0}课时${linked}</span></div>
        <div style="font-size:10px;color:var(--text-3);margin-top:2px">${tvEsc(p.framework_title || '')}${(p.assigned_teachers && p.assigned_teachers.length) ? '　·　老师：' + p.assigned_teachers.join('、') : ''}</div>
      </div>
      <span style="flex-shrink:0;font-size:10px;padding:2px 9px;border-radius:3px;background:${stBg[st]};color:${stColor[st]}">${stLabel[st] || st}</span>
      <span style="flex-shrink:0;font-size:9px;color:var(--text-3)">删除请找管理端</span>
    </div>`;
  }).join('') + '</div>';
}

// 查看已保存方案（只读预览 + 生成PDF）
function openSvPlan(id) {
  const p = salesStudentPlans.find(x => x.id === id);
  if (!p) return;
  const mc = document.getElementById('mainContent');
  const items = Array.isArray(p.items) ? p.items : [];
  // 按分类分组
  const catMap = {};
  items.forEach((it, i) => {
    const k = it.category || 'other';
    if (!catMap[k]) catMap[k] = { key: k, label: it.category_label || k, items: [], min: i };
    catMap[k].items.push(it);
  });
  const groups = Object.values(catMap).sort((a, b) => vipCatRank(a.key) - vipCatRank(b.key));
  const groupsHtml = groups.map(g => {
    const col = VIP_CAT_COLOR[g.key] || { bg: '#eee', color: '#333' };
    const rows = g.items.map(it => `<div style="border-top:1px solid #ede9e2;padding:7px 12px;display:grid;grid-template-columns:1fr 2fr 60px;gap:8px;font-size:11px"><div style="font-weight:500">${tvEsc(it.name)}</div><div style="color:#5a5650">${tvEsc(it.content)}</div><div style="text-align:right;color:#5a5650">${it.hours != null ? it.hours + 'H' : ''}</div></div>`).join('');
    return `<div style="margin-bottom:14px"><div style="margin-bottom:6px"><span style="border-radius:3px;padding:2px 10px;font-size:11px;font-weight:500;background:${col.bg};color:${col.color}">${tvEsc(g.label)}</span></div><div style="background:#fff;border:1px solid #e2ded6;border-radius:4px;overflow:hidden">${rows}</div></div>`;
  }).join('');
  mc.innerHTML = `
  <div style="max-width:1000px;margin:0 auto;background:#f7f5f0;border:1px solid #e2ded6;border-radius:6px;padding:16px 20px 20px;font-family:'DM Mono','Noto Serif SC',monospace">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:12px"><button onclick="svBackToPlans()" style="font-size:11px;background:#fff;border:1px solid #e2ded6;border-radius:3px;padding:4px 12px;cursor:pointer;font-family:inherit;color:#5a5650">← 返回</button><div style="font-family:'Noto Serif SC',serif;font-size:16px;font-weight:600;color:#1a1814">${tvEsc(p.student_name)} 的 VIP 方案</div></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-size:12px;color:#5a5650">${p.total_sessions || 0} 回 · ${p.total_hours || 0} 课时${(p.subject_hours && p.subject_hours > 0) ? '　·　专业知识 ' + p.subject_hours + ' 课时' : ''}</div>
        <button onclick="svPlanToTemplate('${p.id}')" style="font-size:11px;background:#fff;border:1px solid #c9b896;border-radius:3px;padding:4px 12px;cursor:pointer;font-family:inherit;color:#5a3010">保存成套餐</button>
      </div>
    </div>
    ${groupsHtml || '<div style="font-size:12px;color:#9a9590">此方案暂无课程</div>'}
  </div>`;
}
function svBackToPlans() { svTab = 'plans'; renderSvHome(document.getElementById('mainContent')); }

// 把某学生方案原样保存成可复用套餐
async function svPlanToTemplate(planId) {
  const p = salesStudentPlans.find(x => x.id === planId);
  if (!p) return;
  const items = Array.isArray(p.items) ? p.items : [];
  if (!items.length && !(p.subject_hours > 0)) { alert('此方案暂无课程，无法存为套餐'); return; }
  const name = (prompt('套餐名称（如 20H / 30小时）：', (p.total_hours || '') + 'H') || '').trim();
  if (!name) return;
  const rec = {
    id: 'vtpl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
    framework_id: p.framework_id || '', major: p.major || '', name,
    items, total_sessions: p.total_sessions || 0, total_hours: p.total_hours || 0, subject_hours: p.subject_hours || 0,
  };
  try {
    await sb('/rest/v1/vip_plan_templates', 'POST', [rec]);
    salesTemplates.unshift(rec);
    alert(`已把「${p.student_name}」的方案保存成套餐「${name}」，在「套餐」里可直接套用给其他学生。`);
  } catch (e) { alert('保存失败：' + e.message); }
}

async function svDeletePlan(id) {
  const p = salesStudentPlans.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`确认删除「${p.student_name}」的 VIP 方案？此操作不可撤销。`)) return;
  try {
    await sb(`/rest/v1/vip_student_plans?id=eq.${id}`, 'DELETE');
    salesStudentPlans = salesStudentPlans.filter(x => x.id !== id);
    renderSvHome(document.getElementById('mainContent'));
  } catch (e) { alert('删除失败：' + e.message); }
}

async function openSvFramework(id) {
  const mc = document.getElementById('mainContent');
  mc.innerHTML = '<div class="loading">加载中…</div>';
  svCurrentId = id;
  svItems = await sb(`/rest/v1/vip_framework_items?framework_id=eq.${id}&select=*&order=sort_order.asc`).catch(() => []);
  svTemplates = await sb(`/rest/v1/vip_plan_templates?framework_id=eq.${id}&select=*&order=created_at.desc`).catch(() => []);
  const fw = salesVipFrameworks.find(f => f.id === id);
  svShareTeachers = (fw && fw.assigned_teachers && fw.assigned_teachers.length) ? [...fw.assigned_teachers] : [];
  svSel = new Set(); svHrs = {}; svSubjectHours = 0; svShareOpen = false;
  renderSvSelect(mc);
}

function svHoursOf(it) {
  if (svHrs[it.id] != null) return svHrs[it.id];
  return it.default_hours != null ? it.default_hours : (it.category === 'ta' ? 20 : 2);
}
function svCalc() {
  let sessions = 0, hours = 0;
  svItems.forEach(it => {
    if (!svSel.has(it.id)) return;
    const isSubject = VIP_SUBJECT_CATS.includes(it.category);
    if (isSubject && svSubjectHours > 0) return; // 专业知识由总课时统一计，避免重复
    const h = svHoursOf(it);
    hours += h;
    if (isSubject) sessions += h / 2;
    else if (it.category === 'ta') sessions += 0;
    else sessions += 1;
  });
  if (svSubjectHours > 0) { hours += svSubjectHours; sessions += svSubjectHours / 2; }
  return { sessions: +sessions.toFixed(1), hours: +hours.toFixed(1) };
}
function svSetSubjectHours(v) {
  svSubjectHours = parseFloat(v) || 0;
  renderSvSelect(document.getElementById('mainContent'));
}

function renderSvSelect(mc) {
  const fw = salesVipFrameworks.find(f => f.id === svCurrentId);
  if (!fw) { renderVipSalesPlanning(mc); return; }

  // 分组（按最小 sort_order 排序）
  const catMap = {};
  svItems.forEach(it => {
    const k = it.category || 'other';
    if (!catMap[k]) catMap[k] = { key: k, label: it.category_label || k, items: [], minOrder: it.sort_order || 0 };
    catMap[k].items.push(it);
    catMap[k].minOrder = Math.min(catMap[k].minOrder, it.sort_order || 0);
  });
  const groups = Object.values(catMap).sort((a, b) => vipCatRank(a.key) - vipCatRank(b.key));
  groups.forEach(g => g.items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));

  const groupsHtml = groups.map(g => {
    const col = VIP_CAT_COLOR[g.key] || { bg: '#eee', color: '#333' };
    const rows = g.items.map(it => {
      const sel = svSel.has(it.id);
      const isTa = it.category === 'ta';
      const h = svHoursOf(it);
      const opts = (isTa ? [10, 20] : VIP_HOURS_OPTIONS).map(o => `<option value="${o}"${o === h ? ' selected' : ''}>${o}H</option>`).join('');
      const hoursCtl = `<select onclick="event.stopPropagation()" onchange="svSetHours('${it.id}',this.value)" ${sel ? '' : 'disabled'} style="font-family:'DM Mono',monospace;font-size:12px;font-weight:500;background:#f7f5f0;border:1px solid #e2ded6;border-radius:3px;padding:2px 4px;width:58px;text-align:center;cursor:pointer;${sel ? '' : 'opacity:.35;cursor:not-allowed'}">${opts}</select>`;
      return `
      <div onclick="svToggle('${it.id}')" class="vsel-row" style="display:grid;grid-template-columns:34px 1fr auto;align-items:stretch;border-top:1px solid #ede9e2;cursor:pointer;min-height:50px;background:${sel ? '#f0ede8' : '#fff'}">
        <div style="display:flex;align-items:center;justify-content:center;border-right:1px solid #ede9e2">
          <div style="width:14px;height:14px;border:1px solid ${sel ? '#1a1814' : '#e2ded6'};border-radius:2px;background:${sel ? '#1a1814' : 'transparent'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:9px">${sel ? '✓' : ''}</div>
        </div>
        <div style="padding:7px 12px;display:flex;flex-direction:column;gap:2px;min-width:0">
          <div style="font-size:12px;font-weight:500;color:#1a1814">${tvEsc(it.name)}</div>
          <div style="font-size:11px;color:#5a5650;line-height:1.5">${tvEsc(it.content) || '<span style="color:#9a9590">（待补充）</span>'}</div>
          ${it.homework ? `<div style="font-size:10px;color:#9a9590;margin-top:1px"><span style="background:#f7f5f0;border:1px solid #ede9e2;border-radius:2px;padding:0 4px;font-size:9px;margin-right:4px">作业</span>${tvEsc(it.homework)}</div>` : ''}
        </div>
        <div style="padding:7px 12px;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:3px;min-width:74px">
          ${hoursCtl}<span style="font-size:9px;color:#9a9590">${isTa ? '课时' : '课时/回'}</span>
        </div>
      </div>`;
    }).join('');
    return `
    <div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #ede9e2">
        <span style="border-radius:3px;padding:2px 10px;font-size:11px;font-weight:500;background:${col.bg};color:${col.color}">${tvEsc(g.label)}</span>
        <span style="font-size:10px;color:#9a9590">${g.items.length} 门</span>
      </div>
      <div style="background:#fff;border:1px solid #e2ded6;border-radius:4px;overflow:hidden">${rows}</div>
    </div>`;
  }).join('');

  // 转分享面板
  const addOpts = svAllTeachers.filter(t => !svShareTeachers.includes(t.name)).map(t => `<option value="${tvEsc(t.name)}">${tvEsc(t.name)}</option>`).join('');
  const tagsHtml = svShareTeachers.length
    ? svShareTeachers.map(n => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;background:#fff;border:1px solid #e2ded6;border-radius:3px;padding:2px 6px 2px 9px">${tvEsc(n)}<button onclick="svRemoveShareTeacher('${tvEsc(n)}')" style="background:none;border:none;color:#9a9590;cursor:pointer;font-size:13px;line-height:1;padding:0">×</button></span>`).join('')
    : '<span style="font-size:11px;color:#9a9590">尚未选择老师</span>';
  const sharePanel = svShareOpen ? `
    <div style="margin-bottom:14px;padding:12px 14px;border:1px solid #e2ded6;border-radius:4px;background:#f7f5f0">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px;color:#1a1814">发给专业课老师</div>
      <div style="font-size:10px;color:#9a9590;margin-bottom:8px">先选老师；「分享模板补内容」让老师补充专业课（无需选课）；「发学生方案确认」需先点选课程并填学生姓名。</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">${tagsHtml}</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <select id="sv_share_add" onchange="svAddShareTeacher(this.value);this.value=''" style="font-size:12px;min-width:150px"><option value="">＋ 添加老师…</option>${addOpts}</select>
        <input id="sv_share_note" value="" placeholder="给老师的提示（可选）" style="flex:1;min-width:200px;font-size:11px">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="svShareTemplateToTeacher()" style="font-size:11px;background:#fff;border:1px solid #1a1814;color:#1a1814;border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit;white-space:nowrap">分享模板补内容</button>
        <button onclick="svSavePlan('pending')" style="font-size:11px;background:#1a1814;color:#fff;border:none;border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit;white-space:nowrap">发学生方案确认</button>
      </div>
    </div>` : '';

  const c = svCalc();
  mc.innerHTML = `
  <div style="max-width:1040px;margin:0 auto;background:#f7f5f0;border:1px solid #e2ded6;border-radius:6px;padding:0 0 20px;font-family:'DM Mono','Noto Serif SC',monospace">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 20px;border-bottom:1px solid #e2ded6;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:12px">
        <button onclick="backToSvList()" style="font-size:11px;background:#fff;border:1px solid #e2ded6;border-radius:3px;padding:4px 12px;cursor:pointer;font-family:inherit;color:#5a5650">← 返回</button>
        <div style="font-family:'Noto Serif SC',serif;font-size:16px;font-weight:600;color:#1a1814">${tvEsc(fw.title)}</div>
      </div>
      <button onclick="svToggleShare()" style="font-size:11px;background:#fff;border:1px solid #e2ded6;border-radius:3px;padding:4px 12px;cursor:pointer;font-family:inherit;color:#5a5650">发给老师 ${svShareOpen ? '▾' : '▸'}</button>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 20px;border-bottom:1px solid #e2ded6;background:#fff;flex-wrap:wrap;position:sticky;top:0;z-index:10">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="display:flex;align-items:baseline;gap:5px"><span id="sv_sessions" style="font-size:18px;font-weight:500;font-family:'DM Mono',monospace;color:#1a1814">${c.sessions}</span><span style="font-size:12px;color:#5a5650">回</span></div>
        <div style="width:1px;height:18px;background:#e2ded6"></div>
        <div style="display:flex;align-items:baseline;gap:5px"><span id="sv_hours" style="font-size:18px;font-weight:500;font-family:'DM Mono',monospace;color:#1a1814">${c.hours}</span><span style="font-size:12px;color:#5a5650">课时</span></div>
        <div style="width:1px;height:18px;background:#e2ded6"></div>
        <div style="display:flex;align-items:center;gap:6px"><span style="font-size:11px;color:#9a9590">学生姓名</span><input id="sv_student" placeholder="请输入姓名" style="font-family:'DM Mono',monospace;font-size:12px;border:1px solid #e2ded6;border-radius:3px;padding:2px 8px;background:#f7f5f0;color:#1a1814;outline:none;width:120px"></div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="svClearSel()" style="font-size:11px;background:transparent;border:1px solid #e2ded6;border-radius:3px;padding:5px 14px;cursor:pointer;font-family:inherit;color:#9a9590">清空</button>
        <button onclick="svSaveAsTemplate()" style="font-size:11px;background:#fff;border:1px solid #c9b896;border-radius:3px;padding:5px 14px;cursor:pointer;font-family:inherit;color:#5a3010">保存为套餐</button>
        <button onclick="svGenerateReport()" style="font-size:11px;background:#fff;border:1px solid #1a1814;border-radius:3px;padding:5px 14px;cursor:pointer;font-family:inherit;color:#1a1814">生成 PDF</button>
        <button onclick="svSavePlan('signed')" style="font-size:11px;background:#1a1814;color:#f7f5f0;border:1px solid #1a1814;border-radius:3px;padding:5px 16px;cursor:pointer;font-family:inherit;font-weight:500">保存签约 →</button>
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:10px;padding:8px 20px;border-bottom:1px solid #e2ded6;background:#fbf7ee;flex-wrap:wrap">
      <span style="font-size:11px;color:#5a5650;font-weight:500">专业知识总课时</span>
      <span style="font-size:10px;color:#9a9590">（基础知识+备考强化+基础方法论+拓展方法论，老师按此小时数安排具体课程）</span>
      <input type="number" step="0.5" min="0" value="${svSubjectHours || ''}" onchange="svSetSubjectHours(this.value)" placeholder="0" style="font-family:'DM Mono',monospace;font-size:12px;border:1px solid #e2ded6;border-radius:3px;padding:2px 8px;background:#fff;color:#1a1814;outline:none;width:70px;text-align:center">
      <span style="font-size:11px;color:#5a5650">课时</span>
    </div>

    <div style="padding:16px 20px">
      ${svTemplates.length ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;padding:10px 12px;border:1px solid #e2ded6;border-radius:5px;background:#f0ede8">
        <span style="font-size:11px;color:#5a5650;font-weight:500">套餐快选</span>
        ${svTemplates.map(t => `<button onclick="applySvTemplate('${t.id}')" style="font-size:11px;background:#fff;border:1px solid #c9b896;border-radius:3px;padding:4px 12px;cursor:pointer;font-family:inherit;color:#5a3010">${tvEsc(t.name || '套餐')} <span style="color:#9a9590">${t.total_hours || 0}H</span></button>`).join('')}
        <span style="font-size:10px;color:#9a9590">点一下自动勾好课程与课时，再填姓名保存即可</span>
      </div>` : ''}
      ${sharePanel}
      ${groupsHtml}
    </div>
  </div>`;
}

// 套餐快选：按名称把套餐里的课程映射回框架条目，自动勾选 + 设置课时/专业知识课时
function applySvTemplate(tid) {
  const t = svTemplates.find(x => x.id === tid);
  if (!t) return;
  const tItems = Array.isArray(t.items) ? t.items : [];
  svSel = new Set(); svHrs = {};
  tItems.forEach(ti => {
    const match = svItems.find(fi => fi.name === ti.name && fi.category === ti.category);
    if (match) {
      svSel.add(match.id);
      const editable = !VIP_SUBJECT_CATS.includes(match.category) && match.category !== 'ta';
      if (editable && ti.hours != null) svHrs[match.id] = ti.hours;
    }
  });
  svSubjectHours = t.subject_hours || 0;
  renderSvSelect(document.getElementById('mainContent'));
}

function svToggle(id) {
  if (svSel.has(id)) svSel.delete(id); else svSel.add(id);
  renderSvSelect(document.getElementById('mainContent'));
}
function svSetHours(id, v) { svHrs[id] = parseFloat(v); const c = svCalc(); document.getElementById('sv_sessions').textContent = c.sessions; document.getElementById('sv_hours').textContent = c.hours; }
function svClearSel() { svSel = new Set(); svHrs = {}; renderSvSelect(document.getElementById('mainContent')); }

// 营业把当前点选保存为可复用套餐（admin 可在框架里查看/修改）
async function svSaveAsTemplate() {
  if (!svSel.size && !(svSubjectHours > 0)) { alert('请先点选课程'); return; }
  const name = (prompt('套餐名称（如 20H / 30小时）：') || '').trim();
  if (!name) return;
  const fw = salesVipFrameworks.find(f => f.id === svCurrentId);
  const items = svItems.filter(it => svSel.has(it.id)).map(it => ({
    category: it.category, category_label: it.category_label, name: it.name,
    content: it.content, homework: it.homework, hours: svHoursOf(it),
  }));
  const c = svCalc();
  const rec = {
    id: 'vtpl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
    framework_id: svCurrentId, major: fw ? fw.major : '', name,
    items, total_sessions: c.sessions, total_hours: c.hours, subject_hours: svSubjectHours || 0,
  };
  try {
    await sb('/rest/v1/vip_plan_templates', 'POST', [rec]);
    svTemplates.unshift(rec);
    salesTemplates.unshift(rec);
    alert(`已保存套餐「${name}」，之后在「套餐」里可直接套用。`);
    renderSvSelect(document.getElementById('mainContent'));
  } catch (e) { alert('保存失败：' + e.message); }
}
function svToggleShare() { svShareOpen = !svShareOpen; renderSvSelect(document.getElementById('mainContent')); }
function backToSvList() { renderVipSalesPlanning(document.getElementById('mainContent')); }
function svAddShareTeacher(name) { if (!name || svShareTeachers.includes(name)) return; svShareTeachers.push(name); renderSvSelect(document.getElementById('mainContent')); }
function svRemoveShareTeacher(name) { svShareTeachers = svShareTeachers.filter(n => n !== name); renderSvSelect(document.getElementById('mainContent')); }

// 分享模板给老师补充专业课内容（不需选课/学生，把框架发给老师填）
async function svShareTemplateToTeacher() {
  if (!svShareTeachers.length) { alert('请先添加至少一位老师'); return; }
  const nEl = document.getElementById('sv_share_note'); const note = nEl ? nEl.value.trim() : '';
  if (!confirm(`确认把此模板分享给 ${svShareTeachers.join('、')} 补充内容？\n老师会在其「VIP框架」中看到并补充（尤其专业课部分）。`)) return;
  try {
    await sb(`/rest/v1/vip_frameworks?id=eq.${svCurrentId}`, 'PATCH', {
      assigned_teachers: svShareTeachers, assigned_teacher: svShareTeachers[0] || '',
      share_note: note, status: 'shared',
    });
    const fw = salesVipFrameworks.find(f => f.id === svCurrentId);
    if (fw) { fw.assigned_teachers = [...svShareTeachers]; fw.share_note = note; fw.status = 'shared'; }
    alert(`已分享模板给：${svShareTeachers.join('、')}，请老师补充内容`);
    renderSvSelect(document.getElementById('mainContent'));
  } catch (e) { alert('分享失败：' + e.message); }
}

// 保存学生方案：status='signed'(场景1 直接签约) 或 'pending'(场景2 发老师确认)
async function svSavePlan(status) {
  const fw = salesVipFrameworks.find(f => f.id === svCurrentId);
  if (!fw) return;
  if (!svSel.size) { alert('请先点选课程'); return; }
  const student = (document.getElementById('sv_student').value || '').trim();
  if (!student) { alert('请填写学生姓名'); return; }
  let teachers = [], note = '';
  if (status === 'pending') {
    teachers = [...svShareTeachers];
    if (!teachers.length) { alert('发给老师确认需先添加至少一位老师'); return; }
    const nEl = document.getElementById('sv_share_note'); note = nEl ? nEl.value.trim() : '';
  }
  const items = svItems.filter(it => svSel.has(it.id)).map(it => ({
    category: it.category, category_label: it.category_label, name: it.name,
    content: it.content, homework: it.homework, hours: svHoursOf(it),
  }));
  const c = svCalc();
  const msg = status === 'signed'
    ? `确认为「${student}」保存并签约此方案？\n${c.sessions} 回 · ${c.hours} 课时`
    : `确认把「${student}」的方案发给 ${teachers.join('、')} 确认？`;
  if (!confirm(msg)) return;
  const rec = {
    id: 'vsp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
    student_name: student, major: fw.major, framework_id: fw.id, framework_title: fw.title,
    items, total_sessions: c.sessions, total_hours: c.hours, subject_hours: svSubjectHours || 0,
    status, assigned_teachers: teachers, note,
    created_by: (typeof teacherName !== 'undefined' ? teacherName : ''),
  };
  try {
    await sb('/rest/v1/vip_student_plans', 'POST', [rec]);
    alert(status === 'signed' ? `已保存并签约：${student}` : `已发给老师确认：${student}`);
    svTab = 'plans';
    renderVipSalesPlanning(document.getElementById('mainContent'));
  } catch (e) { alert('保存失败：' + e.message); }
}

// ── 生成 PDF 报告（打印窗口，还原 VIP.html 报告样式）──
function svGenerateReport() {
  if (!svSel.size) { alert('请先点选课程再生成 PDF'); return; }
  const fw = salesVipFrameworks.find(f => f.id === svCurrentId);
  const student = (document.getElementById('sv_student').value || '').trim() || '—';

  // 按分类顺序整理选中项
  const catMap = {};
  svItems.forEach(it => {
    if (!svSel.has(it.id)) return;
    const k = it.category || 'other';
    if (!catMap[k]) catMap[k] = { key: k, label: it.category_label || k, items: [], minOrder: it.sort_order || 0 };
    catMap[k].items.push(it);
    catMap[k].minOrder = Math.min(catMap[k].minOrder, it.sort_order || 0);
  });
  const groups = Object.values(catMap).sort((a, b) => vipCatRank(a.key) - vipCatRank(b.key));
  groups.forEach(g => g.items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));

  const c = svCalc();
  const now = new Date();
  const dateStr = now.getFullYear() + '/' + (now.getMonth() + 1) + '/' + now.getDate();
  const esc = svGenEsc;

  let rows = '', num = 1;
  groups.forEach(g => {
    const col = VIP_CAT_COLOR[g.key] || { bg: '#f0f0f0', color: '#333' };
    g.items.forEach((it, i) => {
      const h = svHoursOf(it);
      rows += '<tr>';
      if (i === 0) rows += '<td rowspan="' + g.items.length + '" class="group-cell" style="background:' + col.bg + ';color:' + col.color + '">' + esc(g.label) + '</td>';
      rows += '<td class="num-cell">' + (num++) + '</td>'
        + '<td class="name-cell">' + esc(it.name) + '</td>'
        + '<td class="desc-cell">' + esc(it.content) + '</td>'
        + '<td class="hw-cell">' + esc(it.homework) + '</td>'
        + '<td class="hours-cell">' + (h > 0 ? h + 'H' : '—') + '</td></tr>';
    });
  });

  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>VIP课程方案 · ' + esc(student) + '</title>'
    + '<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">'
    + '<style>*{box-sizing:border-box;margin:0;padding:0}'
    + "body{font-family:'DM Mono','Noto Serif SC',serif;font-size:11px;color:#1a1814;background:#fff;padding:2.5cm 2cm}"
    + '.report-header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1.5px solid #1a1814}'
    + ".report-title{font-family:'Noto Serif SC',serif;font-size:20px;font-weight:600}"
    + '.report-sub{font-size:10px;color:#9a9590;margin-top:3px;letter-spacing:.05em}'
    + '.report-meta{text-align:right;font-size:10px;color:#5a5650;line-height:1.9}'
    + '.report-meta .student{font-size:13px;font-weight:500;color:#1a1814;margin-bottom:2px}'
    + '.summary-row{display:flex;gap:2rem;margin-bottom:1.5rem;padding:10px 16px;background:#f7f5f0;border-radius:3px;border:1px solid #e2ded6;align-items:center}'
    + ".stat-num{font-size:22px;font-weight:500;font-family:'DM Mono',monospace;margin-right:4px}"
    + '.stat-label{font-size:11px;color:#5a5650}.stat-note{font-size:9px;color:#9a9590;margin-left:2px}'
    + 'table{width:100%;border-collapse:collapse;font-size:10px}thead tr{background:#1a1814;color:#f7f5f0}'
    + 'thead th{padding:7px 8px;text-align:left;font-weight:500;letter-spacing:.04em;font-size:9px}'
    + 'tbody tr{border-bottom:1px solid #ede9e2}td{padding:6px 8px;vertical-align:top;line-height:1.5}'
    + '.group-cell{font-weight:500;font-size:9px;text-align:center;border-right:1px solid #e2ded6;vertical-align:middle;writing-mode:vertical-rl;padding:8px 5px;width:28px}'
    + ".num-cell{width:24px;color:#9a9590;text-align:center;font-family:'DM Mono',monospace}"
    + '.name-cell{width:22%;font-weight:500}.desc-cell{color:#5a5650}'
    + '.hw-cell{width:22%;color:#5a5650;border-left:1px solid #ede9e2}'
    + ".hours-cell{width:48px;text-align:center;font-family:'DM Mono',monospace;border-left:1px solid #ede9e2;font-weight:500}"
    + '.footer{margin-top:1.5rem;padding-top:.8rem;border-top:1px solid #e2ded6;font-size:9px;color:#9a9590;display:flex;justify-content:space-between}'
    + ".print-btn{display:inline-block;margin-bottom:1.5rem;padding:8px 20px;background:#1a1814;color:#f7f5f0;border:none;border-radius:3px;font-family:inherit;font-size:12px;cursor:pointer}"
    + '@media print{body{padding:0}@page{margin:1.8cm 1.5cm;size:A4}.no-print{display:none}}</style></head><body>'
    + '<button class="print-btn no-print" onclick="window.print()">打印 / 另存为 PDF</button>'
    + '<div class="report-header"><div><div class="report-title">VIP课程方案</div><div class="report-sub">唯新教育 · TRANSFORM EDUCATION</div></div>'
    + '<div class="report-meta"><div class="student">' + esc(student) + '</div><div>生成日期：' + dateStr + '</div><div>' + c.sessions + ' 回 · ' + c.hours + ' 课时</div></div></div>'
    + '<div class="summary-row"><span class="stat-num">' + c.sessions + '</span><span class="stat-label">回</span><span class="stat-note">（不含TA指导）</span>'
    + '<span style="margin:0 8px;color:#e2ded6">|</span><span class="stat-num">' + c.hours + '</span><span class="stat-label">课时</span>'
    + '<span style="margin-left:auto;font-size:10px;color:#9a9590">已选课程合计</span></div>'
    + '<table><thead><tr><th style="width:28px"></th><th style="width:24px">#</th><th>课程名称</th><th>内容说明</th><th>课后作业</th><th style="width:48px;text-align:center">课时</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '<div class="footer"><span>唯新教育 TRANSFORM EDUCATION · VIP课程方案 · ' + esc(student) + '</span><span>本文件由 VIP 规划系统生成 · ' + dateStr + '</span></div>'
    + '</body></html>';

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}
function svGenEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
