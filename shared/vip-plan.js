// VIP 学生方案：确认待定方案、改每回内容、排期（每回日期 / 起始日 / 每周星期和时间）、写变更日志（vip_plan_logs）。
// 老师端（teacher/teacher-vip.js）整页打开，管理端（学生档案里的 VIP 方案）在弹窗里打开，同一套界面、同一套保存。
// 署名：老师端 = 老师名，管理端 = 「管理员」（VPP.who）。
// 依赖：shared/supabase.js、shared/hw-core.js（HWC 结构化作业编辑器，可选）
const vppEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const VPP_DEFAULT = {
  box: () => document.getElementById('mainContent'),   // 画在哪里
  back: () => {},                                      // 「返回」按钮
  who: () => (typeof teacherName !== 'undefined' && teacherName) || '管理员',
  onDone: () => {},                                    // 确认 / 保存排期之后（kind = 'confirm' | 'schedule'）
};
let VPP = Object.assign({}, VPP_DEFAULT);
let vppPlan = null;   // 正在确认的方案

let tspPlan = null;              // 当前编辑的学生方案

let tspItems = [];               // 工作副本

let tspStudent = null;           // 关联学生（取课时上限）

let tspUsedHours = 0;            // 已上课时（已完成预约合计）

let tspDoneNames = new Set();    // 已上完的课名

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

function tvHasHw(it) {
  const q = it && it.homework_questions;
  return !!(q && Array.isArray(q.levels) && q.levels.length);
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
      renderTspEditor(VPP.box());
    },
  });
}

// ── 上课老师：确认学生方案（场景2）──
// 打开「确认学生方案」：p = 方案；host = { box, back, who, onDone }（谁调用谁给：老师端整页，管理端弹窗）
function vppOpenConfirm(p, host) {
  if (!p) return;
  VPP = Object.assign({}, VPP_DEFAULT, host || {});
  vppPlan = p; tpPlanId = p.id;
  tpPlanItems = (Array.isArray(p.items) ? p.items : []).map(it => ({ ...it }));
  renderTvPlanEditor(VPP.box());
}

function renderTvPlanEditor(mc) {
  const p = vppPlan;
  if (!p) { VPP.back(); return; }

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
        <input value="${vppEsc(it.name)}" onchange="tpPlanEdit(${i},'name',this.value)" style="font-size:11px;font-weight:500">
        <textarea onchange="tpPlanEdit(${i},'content',this.value)" placeholder="内容说明" style="font-size:11px;resize:vertical;min-height:34px;line-height:1.5">${vppEsc(it.content)}</textarea>
        <input value="${vppEsc(it.homework)}" onchange="tpPlanEdit(${i},'homework',this.value)" placeholder="课后作业" style="font-size:11px">
        <input type="number" step="0.5" min="0" value="${it.hours != null ? it.hours : 2}" onchange="tpPlanEdit(${i},'hours',this.value)" style="font-size:11px;text-align:center">
      </div>`;
    }).join('');
    return `<div style="border:1px solid var(--border);border-radius:5px;overflow:hidden;margin-bottom:10px"><div style="padding:8px 12px;background:var(--bg);font-size:12px;font-weight:600">${vppEsc(g.label)}</div>${rows}</div>`;
  }).join('');

  mc.innerHTML = `
  <div class="page-section" style="max-width:1000px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;flex-wrap:wrap">
      <button onclick="VPP.back()" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 12px;cursor:pointer;font-family:inherit;color:var(--text-2)">← 返回</button>
      <button class="btn btn-primary" onclick="confirmTvPlan()">确认方案</button>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin:8px 0 6px">
      <div style="font-family:'Noto Serif SC',serif;font-size:16px;font-weight:600">${vppEsc(p.student_name)} 的 VIP 方案</div>
      <span style="font-size:11px;color:var(--text-3)">${p.total_sessions || 0} 回 · ${p.total_hours || 0} 课时</span>
    </div>
    ${p.note ? `<div style="font-size:11px;color:var(--text-2);background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px 12px;margin-bottom:8px">📌 营业提示：${vppEsc(p.note)}</div>` : ''}
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
    Object.assign(vppPlan, { items: tpPlanItems, total_hours: +totalHours.toFixed(1), status: 'confirmed' });
    alert('已确认，方案生效');
    VPP.onDone('confirm', vppPlan);
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

// 打开「排期 / 改每回内容」：p = 方案；host 同上
async function vppOpenSchedule(p, host) {
  if (!p) return;
  VPP = Object.assign({}, VPP_DEFAULT, host || {});
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
  renderTspEditor(VPP.box());
}
function tspCap() { return tspStudent && tspStudent.vip_hours_total != null ? parseFloat(tspStudent.vip_hours_total) || 0 : 0; }

function renderTspEditor(mc) {
  const p = tspPlan;
  if (!p) { VPP.back(); return; }
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
        <div style="margin-bottom:3px"><span style="border-radius:2px;padding:1px 6px;font-size:9px;background:${col.bg};color:${col.color}">${vppEsc(it.category_label || '')}</span>${done ? '<span style="font-size:9px;color:#1a7a3a;margin-left:6px">✓ 已上</span>' : ''}</div>
        <input value="${vppEsc(it.name)}" onchange="tspEdit(${i},'name',this.value)" style="font-size:11px;font-weight:500;width:100%"${done ? ' disabled' : ''}>
      </div>
      <div>
        <textarea onchange="tspEdit(${i},'content',this.value)" placeholder="内容" style="font-size:11px;resize:vertical;min-height:34px;line-height:1.5;width:100%;box-sizing:border-box"${done ? ' disabled' : ''}>${vppEsc(it.content)}</textarea>
        <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap">
          <input value="${vppEsc(it.homework || '')}" onchange="tspEdit(${i},'homework',this.value)" placeholder="课后作业（一句话）" style="font-size:10px;flex:1;min-width:110px"${done ? ' disabled' : ''}>
          <button onclick="tspOpenHwEditor(${i})" style="font-size:9px;background:none;border:1px solid ${tvHasHw(it) ? 'var(--accent)' : 'var(--border)'};color:${tvHasHw(it) ? 'var(--accent)' : 'var(--text-3)'};border-radius:3px;padding:1px 8px;cursor:pointer;font-family:inherit;white-space:nowrap">${tvHasHw(it) ? '📝 已设作业' : '📝 设置作业'}</button>
        </div>
      </div>
      <input type="number" step="0.5" min="0" value="${it.hours != null ? it.hours : 2}" onchange="tspEdit(${i},'hours',this.value)" style="font-size:11px;text-align:center"${done ? ' disabled' : ''}>
    </div>`;
  }).join('');

  mc.innerHTML = `
  <div class="page-section" style="max-width:1000px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;flex-wrap:wrap">
      <button onclick="VPP.back()" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 12px;cursor:pointer;font-family:inherit;color:var(--text-2)">← 返回</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" onclick="tspClearSchedule()">清空排期</button>
        <button class="btn btn-outline" onclick="tspSaveAsTemplate()">另存为套餐</button>
        <button class="btn btn-primary" onclick="tspSave()">保存排期</button>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin:8px 0 4px">
      <div style="font-family:'Noto Serif SC',serif;font-size:16px;font-weight:600">${vppEsc(p.student_name)} 的 VIP 排课</div>
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
  if (field === 'planned_date') { tspSyncCadence(); renderTspEditor(VPP.box()); }
}

// 清空排期：清掉所有日期与每周节奏（不删方案），重新排
function tspClearSchedule() {
  if (!confirm('确认清空该学生的排期日期与每周节奏？（课程内容保留，方案不会被删除）')) return;
  tspSyncCadence();
  tspItems.forEach(it => { it.planned_date = ''; });
  tspPlan.start_date = null; tspPlan.weekly_day = null; tspPlan.weekly_time = null;
  renderTspEditor(VPP.box());
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
  renderTspEditor(VPP.box());
}

async function tspLog(action, detail) {
  try {
    await sb('/rest/v1/vip_plan_logs', 'POST', [{
      id: 'vlog-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      plan_id: tspPlan.id, student_name: tspPlan.student_name,
      teacher_name: VPP.who(), action, detail,
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
    VPP.onDone('schedule', tspPlan);
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
