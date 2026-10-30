// ══════════════════════════════════
// PAYROLL.JS  工资核算
// 依赖：admin.js 中的 sb()、cachedTeachers
// ══════════════════════════════════

// 提交 / 读取工作记录时按视角过滤用：总览不限；否则只要视角涉及的领域
function payrollDomainQs() {
  if (typeof scopeAll === 'function' && scopeAll()) return '';
  const ds = scopeDomainList();
  return '&domain=in.(' + encodeURIComponent(ds.map(d => '"' + d + '"').join(',')) + ')';
}

// ── 老师的工资申告（work_records, source='declare'）→ 工资行 ──
async function payrollLoadDeclares(names, start, end) {
  const lo = start.slice(0, 4) + '年' + start.slice(5, 7) + '月' + start.slice(8, 10) + '日 00:00';
  const hi = end.slice(0, 4) + '年' + end.slice(5, 7) + '月' + end.slice(8, 10) + '日 23:59';
  const rows = await sbAll(`/rest/v1/work_records?source=eq.declare&start_time=gte.${encodeURIComponent(lo)}&start_time=lte.${encodeURIComponent(hi)}&select=*`);
  const set = new Set(names);
  return rows.filter(r => set.has(r.teacher_name));
}
function buildDeclareRows(decls, teacherName) {
  return (decls || []).filter(r => r.teacher_name === teacherName).map(r => {
    const dt = payrollDT(r.start_time);
    return {
      type: 'declare', source_id: r.id, 姓名: teacherName,
      开始时间: r.start_time, 结束时间: r.end_time, 时长: payrollRound(r.duration),
      工作内容: r.work_type, 工作地点: r.location, 备注: r.notes || '',
      _date: String(r.start_time).slice(0, 4) + '-' + String(r.start_time).slice(5, 7) + '-' + String(r.start_time).slice(8, 10),
      _domain: r.domain || '', _rec: r
    };
  });
}
// 申告撞上这位老师自己的大课 / 面谈 / VIP 行 → 返回撞上的类别（没有撞 = ''）
const PAYROLL_TYPE_LABEL = { course: '大课', booking: '面谈', vip: 'VIP' };
function payrollDeclareOverlap(r, rows) {
  const span = x => {
    const a = String(x.开始时间).match(/(\d{4}年\d{2}月\d{2}日)\s*(\d{1,2}):(\d{2})/), b = String(x.结束时间).match(/(\d{1,2}):(\d{2})\s*$/);
    return a && b ? { d: a[1], s: (+a[2]) * 60 + (+a[3]), e: (+b[1]) * 60 + (+b[2]) } : null;
  };
  const me = span(r);
  if (!me) return '';
  for (const x of rows) {
    if (!PAYROLL_TYPE_LABEL[x.type] || x.姓名 !== r.姓名) continue;
    const o = span(x);
    if (o && o.d === me.d && o.s < me.e && o.e > me.s) return PAYROLL_TYPE_LABEL[x.type];
  }
  return '';
}

// ══════════════════════════════════
// 工资核算：一张表（生成 → 核对 / 勾选 / 改 → 下载 Excel 或确定发布）
// ══════════════════════════════════


// ── 权限：「查看」和「审批发布」分开，谁都不能审批自己的工资 ──
// 管理员 / 领域访问链接：可以审批。管理模式的负责人：manage_scope.payroll === 'approve' 才可以，没设 = 只能查看；
// 而且负责人自己（teacher_name = 当前登录老师）的那一组一律由管理员审批。数据库有同样的规则（seed/work_records_approve.sql）
function payrollMe() { return (typeof ACCESS_KEY !== 'undefined' && ACCESS_KEY && ACCESS_KEY._asTeacher) || null; }
function payrollCanApprove() { const a = payrollMe(); return !a || a.payroll === 'approve'; }
function payrollIsSelf(name) { const a = payrollMe(); return !!(a && a.name && name === a.name); }
function payrollRowSelectable(r) { return payrollCanApprove() && !payrollIsSelf(r.姓名); }

// ── 状态 ──
let payrollMonth = '';          // 'YYYY-MM'；空 = 自定义日期
let payrollCustomOpen = false;
let payrollStart = '';
let payrollEnd = '';
let payrollMode = '';           // 'teacher' | 'major' | 'all'
let payrollModeVal = '';        // 老师名 / 专业 key
let payrollRows = [];           // 生成出来的所有行（含勾选、改动）
let payrollCtx = null;          // { label, who, teachers, pending, pub }
let payrollFilter = 'all';      // all | new | changed | published | missing
let payrollQuery = '';
let payrollCollapsed = {};
let payrollTypeSel = [];        // 筛选：工作内容（多选）
let payrollTeacherSel = '';     // 从汇总格子跳回明细时，只看这位老师
let payrollSortCol = 'date';    // date | name | type | hours
let payrollSortDir = 1;
let payrollGrouped = true;      // false = 不分组：全部老师排在一张表里
let payrollView = 'detail';     // detail | summary
let payrollPubOpen = false;

const payrollKey = (type, id) => type + ':' + id;
function payrollMonthList() {
  const out = [], d = new Date();
  for (let i = 0; i < 6; i++) { out.push(d.getFullYear() + '-' + payrollPad(d.getMonth() + 1)); d.setMonth(d.getMonth() - 1, 1); }
  return out;
}
function payrollRange() {
  if (payrollMonth) {
    const [y, m] = payrollMonth.split('-').map(Number);
    return { start: payrollMonth + '-01', end: payrollMonth + '-' + payrollPad(new Date(y, m, 0).getDate()) };
  }
  return { start: payrollStart, end: payrollEnd };
}
function payrollRangeLabel(start, end) {
  if (start.slice(0, 7) === end.slice(0, 7)) return start.slice(0, 4) + '年' + start.slice(5, 7) + '月';
  return start + '至' + end;
}
function payrollTeacherBase() { return (typeof teacherFilteredList === 'function') ? teacherFilteredList() : cachedTeachers; }

// 日期 / 时间显示：「2026年10月05日 13:00」→ 10-05、13:00

// 行状态：new 未发布 / changed 有变化 / published 已发布
function payrollStatusOf(r) {
  const p = payrollCtx && payrollCtx.pub[payrollKey(r.type, r.source_id)];
  if (r.type === 'declare' && p && p.status === 'rejected') return 'rejected';
  if (!p || p.status !== 'approved') return 'new';
  return (payrollRound(p.duration) !== payrollRound(r.时长) || String(p.notes || '') !== String(r.备注 || '')) ? 'changed' : 'published';
}

// 已有的工作记录（任意状态），按 来源+source_id 对应
async function payrollLoadPub(rows) {
  const ids = [...new Set(rows.map(r => r.source_id))];
  const pub = {};
  for (let i = 0; i < ids.length; i += 60) {
    const part = await sb(`/rest/v1/work_records?source_id=in.(${ids.slice(i, i + 60).map(x => `"${x}"`).join(',')})&select=*`, 'GET', undefined, { cache: 'no-store' }) || [];
    part.forEach(p => {
      const k = payrollKey(p.source, p.source_id);
      if (!pub[k] || p.status === 'approved') pub[k] = p;
    });
  }
  return pub;
}

// ══════════════════════════════════
// 页面
// ══════════════════════════════════
function renderPayrollSection(container) {
  if (!payrollMonth && !payrollStart) payrollMonth = payrollMonthList()[0];
  container.innerHTML = `
  ${payrollCanApprove() ? '' : '<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">你只有查看权限，审批发布请联系管理员</div>'}
  <div id="pr_legacy"></div>
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:16px;margin-top:16px">
    <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:12px;letter-spacing:.05em;text-transform:uppercase">工资核算</div>
    <div id="pr_pick"></div>
    <div id="pr_result" style="margin-top:14px"></div>
  </div>
  <div id="pr_published"></div>`;
  payrollRenderPick();
  payrollRenderResult();
  payrollRenderPublished();
  payrollLoadLegacy();
}

function payrollRenderPick() {
  const el = document.getElementById('pr_pick');
  if (!el) return;
  const rg = payrollRange();
  const chip = (on, click, text) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${click}">${text}</div>`;
  const teachers = payrollTeacherBase();
  el.innerHTML = `
  <div style="margin-bottom:12px">
    <label class="form-label">月份</label>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px">
      ${payrollMonthList().map(m => chip(payrollMonth === m, `payrollPickMonth('${m}')`, m.slice(0, 4) + '年' + m.slice(5) + '月')).join('')}
      ${chip(!payrollMonth, 'payrollToggleCustom()', '自定义日期 ' + (payrollCustomOpen || !payrollMonth ? '▴' : '▾'))}
    </div>
    <div style="display:${payrollCustomOpen || !payrollMonth ? 'flex' : 'none'};gap:8px;align-items:center;margin-top:8px">
      <input type="date" id="pr_start" value="${rg.start}" style="width:140px" onchange="payrollCustomDate()">
      <span style="font-size:11px;color:var(--text-3)">至</span>
      <input type="date" id="pr_end" value="${rg.end}" style="width:140px" onchange="payrollCustomDate()">
    </div>
  </div>
  <div style="margin-bottom:12px">
    <label class="form-label">老师</label>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:4px">
      <input id="pr_teacher" list="pr_teacher_list" placeholder="输入或选择老师" value="${payrollMode === 'teacher' ? escTM(payrollModeVal) : ''}" style="width:180px" onchange="payrollPickTeacher(this.value)">
      <datalist id="pr_teacher_list">${teachers.map(t => `<option value="${escTM(t.name)}"></option>`).join('')}</datalist>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center">
      <span style="font-size:10px;color:var(--text-3)">按专业</span>
      ${chipFold(majorFilterKeys().map(key => {
        const on = payrollMode === 'major' && payrollModeVal === key;
        return { on, html: chip(on, `payrollPickMode('major','${key}')`, escTM(majorLabel(key))) };
      }))}
      ${chip(payrollMode === 'all', "payrollPickMode('all','')", '全部老师')}
    </div>
  </div>
  <button class="btn btn-primary btn-sm" onclick="payrollGenerate()">生成</button>`;
}
function payrollPickMonth(m) { payrollMonth = m; payrollRenderPick(); }
function payrollToggleCustom() {
  if (!payrollMonth) { return; }
  const rg = payrollRange();
  payrollStart = rg.start; payrollEnd = rg.end;
  payrollMonth = '';
  payrollCustomOpen = true;
  payrollRenderPick();
}
function payrollCustomDate() {
  payrollStart = document.getElementById('pr_start').value;
  payrollEnd = document.getElementById('pr_end').value;
  payrollMonth = '';
}
function payrollPickTeacher(v) {
  v = String(v || '').trim();
  if (!v) { if (payrollMode === 'teacher') { payrollMode = ''; payrollModeVal = ''; } return; }
  if (!payrollTeacherBase().some(t => t.name === v)) { alert('没有这位老师：' + v); document.getElementById('pr_teacher').value = ''; return; }
  payrollMode = 'teacher'; payrollModeVal = v;
  payrollRenderPick();
}
function payrollPickMode(mode, val) { payrollMode = mode; payrollModeVal = val; payrollRenderPick(); }

async function payrollGenerate(keepEdits) {
  const rg = payrollRange();
  if (!rg.start || !rg.end || rg.start > rg.end) { alert('请选择有效日期范围'); return; }
  if (!payrollMode) { alert('请选择老师，或按专业 / 全部老师'); return; }
  const base = payrollTeacherBase();
  let names, who;
  if (payrollMode === 'teacher') { names = [payrollModeVal]; who = payrollModeVal; }
  else if (payrollMode === 'all') { names = base.map(t => t.name); who = '全部'; }
  else { names = base.filter(t => majorListHas(t.majors, payrollModeVal)).map(t => t.name); who = majorLabel(payrollModeVal); }
  if (!names.length) { alert('该专业下暂无老师'); return; }

  const snap = {};
  if (keepEdits) payrollRows.forEach(r => { snap[payrollKey(r.type, r.source_id)] = r; });
  const res = document.getElementById('pr_result');
  res.innerHTML = '<div style="font-size:12px;color:var(--text-3)">加载中…</div>';
  try {
    const { sessions, bookings, slots, courses, students, vipConfirmed, vipPending, interviewPending } = await payrollLoadData(rg.start, rg.end);
    const vipMap = {};
    vipConfirmed.forEach(b => { vipMap[b.id] = b; });
    const decls = await payrollLoadDeclares(names, rg.start, rg.end).catch(() => []);
    const rows = [], pending = {}, ivPending = {};
    names.forEach(n => {
      const auto = [
        ...buildCourseRows(sessions, n, courses),
        ...buildBookingRows(bookings, slots, n, students),
        ...buildVipRows(vipConfirmed, n, slots, students)
      ];
      const dl = buildDeclareRows(decls, n);
      dl.forEach(r => { r._overlap = payrollDeclareOverlap(r, auto); });
      const list = [...auto, ...dl].sort((a, b) => a._date.localeCompare(b._date) || a.开始时间.localeCompare(b.开始时间));
      list.forEach(r => { r._missing = r.type === 'vip' ? payrollVipMissing(vipMap[r.source_id]) : []; });
      rows.push(...list);
      const pl = buildVipPending(vipPending, n, slots, students);
      if (pl.length) pending[n] = pl;
      const il = buildInterviewPending(interviewPending, n, slots, students, { end: rg.end });
      if (il.length) ivPending[n] = il;
    });
    const pub = await payrollLoadPub(rows);
    payrollCtx = { label: payrollRangeLabel(rg.start, rg.end), who, teachers: names.filter(n => rows.some(r => r.姓名 === n) || pending[n] || ivPending[n]), pending, ivPending, pub };
    payrollRows = rows;
    payrollRows.forEach(r => {
      const old = snap[payrollKey(r.type, r.source_id)];
      if (old) { r.时长 = old.时长; r.备注 = old.备注; r._sel = old._sel && payrollRowSelectable(r); }
      else r._sel = payrollStatusOf(r) === 'new' && !r._overlap && payrollRowSelectable(r);   // 申告撞上大课 / 面谈 / VIP 的默认不勾
    });
    payrollFilter = 'all'; payrollQuery = ''; payrollTypeSel = []; payrollTeacherSel = '';
    payrollRenderResult();
  } catch (e) {
    res.innerHTML = `<div style="font-size:12px;color:var(--danger)">加载失败：${escTM(e.message)}</div>`;
  }
}

// ── 表 ──
function payrollRenderResult() {
  const res = document.getElementById('pr_result');
  if (!res) return;
  if (!payrollCtx) { res.innerHTML = '<div style="font-size:12px;color:var(--text-3)">选好月份和老师，点「生成」。</div>'; return; }
  const counts = { all: payrollRows.length, new: 0, changed: 0, published: 0, missing: 0, rejected: 0, declpend: 0 };
  payrollRows.forEach(r => { counts[payrollStatusOf(r)]++; if (r._missing.length) counts.missing++; if (r.type === 'declare' && payrollStatusOf(r) === 'new') counts.declpend++; });
  if (!payrollRows.length && !Object.keys(payrollCtx.pending).length && !Object.keys(payrollCtx.ivPending).length) {
    res.innerHTML = '<div style="font-size:12px;color:var(--text-3);padding:12px 0">该时间段内无数据</div>';
    return;
  }
  const fchip = (k, t) => `<div class="filter-chip${payrollFilter === k ? ' active' : ''}" onclick="payrollSetFilter('${k}')">${t} ${counts[k]}</div>`;
  res.innerHTML = `
  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px">
    <span style="font-size:11px;color:var(--text-2)">${escTM(payrollCtx.label)} · ${escTM(payrollCtx.who)}</span>
    ${payrollCanApprove() ? `<button class="btn btn-outline btn-sm" onclick="payrollSelectVisible(true)">全选</button>
    <button class="btn btn-outline btn-sm" onclick="payrollSelectVisible(false)">全不选</button>` : ''}
    ${Object.keys(payrollCtx.ivPending).length ? '<button class="btn btn-outline btn-sm" onclick="payrollIvBatch()">批量生成面谈提醒</button>' : ''}
    ${fchip('all', '全部')}${fchip('new', '未发布')}${fchip('changed', '有变化')}${fchip('published', '已发布')}${fchip('missing', '记录不全')}${fchip('declpend', '申告待审批')}
    <input id="pr_q" placeholder="搜索备注、学生名" value="${escTM(payrollQuery)}" style="width:160px;margin-left:auto" oninput="payrollSetQuery(this.value)">
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">
    <span style="font-size:10px;color:var(--text-3)">工作内容</span>
    ${chipFold(payrollTypesPresent().map(t => ({ on: payrollTypeSel.includes(t), html: `<div class="filter-chip${payrollTypeSel.includes(t) ? ' active' : ''}" onclick="payrollToggleType(this.dataset.t)" data-t="${escTM(t)}">${escTM(t)} ${payrollRows.filter(r => payrollTypeName(r.工作内容) === t).length}</div>` })))}
    ${payrollTeacherSel ? `<div class="filter-chip active" onclick="payrollSetTeacher('')">老师：${escTM(payrollTeacherSel)} ✕</div>` : ''}
    <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
      <div class="filter-chip${payrollView === 'detail' ? ' active' : ''}" onclick="payrollSetView('detail')">明细</div>
      <div class="filter-chip${payrollView === 'summary' ? ' active' : ''}" onclick="payrollSetView('summary')">汇总</div>
      ${payrollView === 'detail' ? `<div class="filter-chip${payrollGrouped ? '' : ' active'}" onclick="payrollToggleGrouped()">不分组</div>` : ''}
    </span>
  </div>
  <div id="pr_stats"></div>
  <div id="pr_groups"></div>
  <div id="pr_bar" style="position:sticky;bottom:0;z-index:5;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:10px 12px;margin-top:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;box-shadow:0 -2px 8px rgba(0,0,0,.06)"></div>`;
  payrollRenderGroups();
  payrollRenderBar();
}
function payrollTypesPresent() { return [...new Set(payrollRows.map(r => payrollTypeName(r.工作内容)).filter(Boolean))].sort(payrollTypeSort); }
function payrollAllTypes() { return PAYROLL_TYPES.concat(payrollTypesPresent().filter(t => !PAYROLL_TYPES.includes(t))); }
function payrollToggleType(t) { const i = payrollTypeSel.indexOf(t); if (i >= 0) payrollTypeSel.splice(i, 1); else payrollTypeSel.push(t); payrollRenderResult(); }
function payrollSetTeacher(n) { payrollTeacherSel = n; payrollRenderResult(); }
function payrollSetView(v) { payrollView = v; payrollRenderResult(); }
function payrollToggleGrouped() { payrollGrouped = !payrollGrouped; payrollRenderResult(); }
function payrollSortBy(col) { if (payrollSortCol === col) payrollSortDir *= -1; else { payrollSortCol = col; payrollSortDir = 1; } payrollRenderGroups(); }
// 汇总里点一个格子：回到明细，筛好这位老师 + 这个工作内容（点合计格就只筛一边）
function payrollJump(name, type) { payrollView = 'detail'; payrollTeacherSel = name || ''; payrollTypeSel = type ? [type] : []; payrollRenderResult(); }
function payrollSetFilter(k) { payrollFilter = k; payrollRenderResult(); }
function payrollSetQuery(v) { payrollQuery = v; payrollRenderGroups(); }
function payrollRowVisible(r) {
  if (payrollFilter === 'missing') { if (!r._missing.length) return false; }
  else if (payrollFilter === 'declpend') { if (r.type !== 'declare' || payrollStatusOf(r) !== 'new') return false; }
  else if (payrollFilter !== 'all' && payrollStatusOf(r) !== payrollFilter) return false;
  if (payrollTypeSel.length && !payrollTypeSel.includes(payrollTypeName(r.工作内容))) return false;
  if (payrollTeacherSel && r.姓名 !== payrollTeacherSel) return false;
  const q = payrollQuery.trim().toLowerCase();
  return !q || (String(r.备注) + ' ' + r.工作内容).toLowerCase().includes(q);
}
function payrollSelectVisible(on) {
  payrollRows.forEach(r => { if (payrollRowVisible(r) && payrollRowSelectable(r)) r._sel = on; });
  payrollRenderGroups(); payrollRenderBar();
}

function payrollRowHtml(r, i, showName) {
  const st = payrollStatusOf(r);
  const dt = payrollDT(r.开始时间), de = payrollDT(r.结束时间);
  const td = 'padding:5px 8px;';
  const badge = st === 'published' ? '<span style="font-size:10px;background:#e6e6e6;color:#666;border-radius:2px;padding:1px 6px">已发布</span>'
    : st === 'changed' ? '<span style="font-size:10px;background:#ffe8cc;color:#9a5a00;border-radius:2px;padding:1px 6px">有变化</span>'
    : st === 'rejected' ? '<span style="font-size:10px;background:#f8e0e0;color:#8a1a1a;border-radius:2px;padding:1px 6px">已驳回</span>'
    : r.type === 'declare' ? '<span style="font-size:10px;background:#fff3cd;color:#856404;border-radius:2px;padding:1px 6px">待审批</span>' : '';
  const isDecl = r.type === 'declare';
  const declTag = isDecl ? '<span style="font-size:10px;background:#e8f0fb;border:1px solid var(--border-light);border-radius:2px;padding:1px 5px;margin-right:4px">申告</span>' : '';
  const declNote = isDecl ? ((r._overlap ? `<div style="font-size:10px;color:#c0392b;margin-top:2px">和${escTM(r._overlap)}重叠</div>` : '')
    + (st === 'rejected' ? `<div style="font-size:10px;color:#8a1a1a;margin-top:2px">驳回原因：${escTM((payrollCtx.pub[payrollKey(r.type, r.source_id)] || {}).admin_note || '')}</div>` : '')) : '';
  const can = payrollRowSelectable(r);
  const rejBtn = can && isDecl && st !== 'published' && st !== 'rejected' ? `<button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none;margin-left:6px" onclick="payrollRejectDeclare(${i})">驳回</button>` : '';
  const miss = r._missing.length ? `<div style="font-size:10px;color:#9a5a00;margin-top:2px">记录不全：缺 ${escTM(r._missing.join('、'))}</div>` : '';
  return `<tr style="border-bottom:1px solid var(--border-light);${st === 'published' ? 'color:#888;background:rgba(0,0,0,.025)' : st === 'rejected' ? 'color:#888;background:#fbeeee' : r._overlap ? 'background:#fdecec' : r._missing.length ? 'background:#fffbe8' : ''}">
    <td style="${td}width:24px">${can ? `<input type="checkbox" ${r._sel ? 'checked' : ''} onchange="payrollToggleRow(${i},this.checked)">` : ''}</td>
    <td style="${td}white-space:nowrap">${escTM(dt.d || r._date.slice(5))}</td>
    ${showName ? `<td style="${td}white-space:nowrap;font-weight:600">${escTM(r.姓名)}</td>` : ''}
    <td style="${td}white-space:nowrap;color:var(--text-2)">${escTM(dt.t)}${de.t ? '–' + escTM(de.t) : ''}</td>
    <td style="${td}">${can ? `<input type="number" step="0.25" min="0" value="${r.时长}" style="width:64px;font-size:11px;padding:2px 4px" onchange="payrollEditHours(${i},this.value)">` : escTM(r.时长)}</td>
    <td style="${td}white-space:nowrap">${declTag}${escTM(r.工作内容)}</td>
    <td style="${td}white-space:nowrap;color:var(--text-2)">${escTM(r.工作地点)}</td>
    <td style="${td}min-width:200px">${can ? `<input value="${escTM(r.备注)}" style="width:100%;font-size:11px;padding:2px 4px" onchange="payrollEditNote(${i},this.value)">` : escTM(r.备注)}${miss}${declNote}</td>
    <td style="${td}white-space:nowrap">${badge}${rejBtn}</td>
  </tr>`;
}
// 排序：点表头按 日期 / 老师 / 工作内容 / 时长，再点反过来；分组时在组内排
function payrollSortItems(items) {
  const d = payrollSortDir, byDate = (a, b) => String(a.r._date).localeCompare(String(b.r._date)) || String(a.r.开始时间).localeCompare(String(b.r.开始时间));
  const cmp = {
    date: byDate,
    name: (a, b) => String(a.r.姓名).localeCompare(String(b.r.姓名), 'zh') || byDate(a, b),
    type: (a, b) => payrollTypeIdx(a.r.工作内容) - payrollTypeIdx(b.r.工作内容) || byDate(a, b),
    hours: (a, b) => ((parseFloat(a.r.时长) || 0) - (parseFloat(b.r.时长) || 0)) || byDate(a, b)
  }[payrollSortCol] || byDate;
  return items.slice().sort((a, b) => cmp(a, b) * d);
}
function payrollTableHtml(items, showName) {
  const th = (label, col) => {
    const on = payrollSortCol === col;
    return `<th onclick="payrollSortBy('${col}')" style="cursor:pointer;padding:5px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600;color:var(--text-2);white-space:nowrap">${label}<span style="color:${on ? 'var(--accent)' : 'var(--text-3)'}"> ${on ? (payrollSortDir === 1 ? '↑' : '↓') : '↕'}</span></th>`;
  };
  const plain = h => `<th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600;color:var(--text-2);white-space:nowrap">${h}</th>`;
  return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr style="background:var(--bg)">${plain('')}${th('日期', 'date')}${showName ? th('老师', 'name') : ''}${plain('时间')}${th('时长(h)', 'hours')}${th('工作内容', 'type')}${plain('地点')}${plain('备注')}${plain('')}</tr></thead>
    <tbody>${payrollSortItems(items).map(x => payrollRowHtml(x.r, x.i, showName)).join('')}</tbody></table></div>`;
}
function payrollRenderGroups() {
  const box = document.getElementById('pr_groups');
  if (!box || !payrollCtx) return;
  payrollRenderStats();
  if (payrollView === 'summary') { box.innerHTML = payrollSummaryHtml(); return; }
  const canAp = payrollCanApprove();
  if (!payrollGrouped) {
    const items = payrollRows.map((r, i) => ({ r, i })).filter(x => payrollRowVisible(x.r));
    const pend = payrollCtx.teachers.filter(n => ((payrollCtx.pending[n] || []).length || (payrollCtx.ivPending[n] || []).length) && (!payrollTeacherSel || payrollTeacherSel === n))
      .map(n => `<div style="margin-top:10px"><div style="font-size:11px;font-weight:600">${escTM(n)}</div>${payrollPendingHtml(payrollCtx.pending[n] || [])}${payrollIvPendingHtml(n, payrollCtx.ivPending[n] || [])}</div>`).join('');
    box.innerHTML = (items.length ? payrollTableHtml(items, true) : '<div style="font-size:11px;color:var(--text-3);padding:6px 0">当前筛选下没有行</div>') + pend;
    return;
  }
  box.innerHTML = payrollCtx.teachers.filter(n => !payrollTeacherSel || payrollTeacherSel === n).map(n => {
    const ti = payrollCtx.teachers.indexOf(n);
    const all = payrollRows.map((r, i) => ({ r, i })).filter(x => x.r.姓名 === n);
    const shown = all.filter(x => payrollRowVisible(x.r));
    const hours = payrollRound(all.filter(x => payrollStatusOf(x.r) !== 'rejected').reduce((s, x) => s + (parseFloat(x.r.时长) || 0), 0));
    const sel = all.filter(x => x.r._sel).length;
    const closed = payrollCollapsed[n];
    const head = `<div onclick="payrollToggleGroup(${ti})" style="cursor:pointer;font-size:12px;font-weight:600;padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:6px">${closed ? '▸' : '▾'} ${escTM(n)}
      <span style="font-weight:400;font-size:11px;color:var(--text-2);margin-left:8px">${all.length} 节 · ${hours} 小时${canAp && !payrollIsSelf(n) ? ` · 已勾选 ${sel} 条` : ''}</span>${canAp && payrollIsSelf(n) ? '<span style="font-weight:400;font-size:11px;color:#9a5a00;margin-left:8px">自己的工资由管理员审批</span>' : ''}</div>`;
    const body = closed ? '' : (shown.length ? payrollTableHtml(shown, false)
      : `<div style="font-size:11px;color:var(--text-3);padding:6px 0">${all.length ? '当前筛选下没有行' : '该时间段内没有可发布的记录'}</div>`);
    return `<div style="margin-bottom:16px">${head}${body}${closed ? '' : payrollPendingHtml(payrollCtx.pending[n] || []) + payrollIvPendingHtml(n, payrollCtx.ivPending[n] || [])}</div>`;
  }).join('');
}

// ── 统计条：按工作内容分开显示条数和小时数（跟着筛选和勾选变；已驳回的不算）──
function payrollStatsTableHtml(rows, extra) {
  const live = rows.filter(r => payrollStatusOf(r) !== 'rejected');
  const m = payrollMatrix(live.map(r => ({ name: r.姓名, type: r.工作内容, h: r.时长 })));
  const types = payrollAllTypes();
  const cell = (o, bold) => o && o.n ? `<td style="padding:4px 10px;text-align:right;white-space:nowrap${bold ? ';font-weight:600' : ''}">${payrollRound(o.h)}<span style="font-size:9px;color:var(--text-3)"> h · ${o.n}条</span></td>` : '<td style="padding:4px 10px;text-align:right;color:var(--text-3)">–</td>';
  return `<tr><td style="padding:4px 10px;white-space:nowrap;color:var(--text-2)">${extra}</td>${types.map(t => cell(m.colTot[t])).join('')}${cell(m.total, true)}</tr>`;
}
function payrollRenderStats() {
  const box = document.getElementById('pr_stats');
  if (!box || !payrollCtx) return;
  const all = payrollAllTypes();
  const vis = payrollRows.filter(payrollRowVisible), sel = payrollCanApprove() ? payrollSelected() : [];
  const th = t => `<th style="padding:4px 10px;text-align:right;font-weight:600;color:var(--text-2);white-space:nowrap">${escTM(t)}</th>`;
  box.innerHTML = `<div style="overflow-x:auto;margin-bottom:10px"><table style="border-collapse:collapse;font-size:11px;background:var(--surface);border:1px solid var(--border)">
    <thead><tr style="background:var(--bg)"><th></th>${all.map(th).join('')}${th('合计')}</tr></thead>
    <tbody>${payrollStatsTableHtml(vis, '当前显示')}${sel.length ? payrollStatsTableHtml(sel, '已勾选') : ''}</tbody></table></div>`;
}

// ── 汇总看法：行是老师、列是工作内容，格子里是小时数（小字是条数）；点格子跳回明细 ──
function payrollSummaryTableHtml(m, jump, firstHead) {
  const cellSt = 'padding:5px 10px;text-align:right;white-space:nowrap;';
  const cell = (o, n, t, bold) => {
    const click = jump ? ` onclick="payrollJump(this.dataset.n,this.dataset.t)" data-n="${escTM(n || '')}" data-t="${escTM(t || '')}" style="${cellSt}cursor:pointer${bold ? ';font-weight:600' : ''}"` : ` style="${cellSt}${bold ? 'font-weight:600' : ''}"`;
    return o && o.n ? `<td${click}>${payrollRound(o.h)}<div style="font-size:9px;color:var(--text-3)">${o.n}条</div></td>` : `<td style="${cellSt}color:var(--text-3)">–</td>`;
  };
  const th = h => `<th style="padding:5px 10px;text-align:right;font-weight:600;color:var(--text-2);white-space:nowrap;border-bottom:1px solid var(--border)">${escTM(h)}</th>`;
  return `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:11px;background:var(--surface);border:1px solid var(--border)">
    <thead><tr style="background:var(--bg)"><th style="padding:5px 10px;text-align:left;border-bottom:1px solid var(--border)">${firstHead || '老师'}</th>${m.types.map(th).join('')}${th('合计')}</tr></thead>
    <tbody>${m.names.map(n => `<tr style="border-bottom:1px solid var(--border-light)"><td style="padding:5px 10px;font-weight:600;white-space:nowrap">${escTM(n)}</td>${m.types.map(t => cell(m.cell[n][t], n, t)).join('')}${cell(m.rowTot[n], n, '', true)}</tr>`).join('')}
    <tr style="background:var(--bg)"><td style="padding:5px 10px;font-weight:600">合计</td>${m.types.map(t => cell(m.colTot[t], '', t, true)).join('')}${cell(m.total, '', '', true)}</tr></tbody></table></div>`;
}
function payrollSummaryHtml() {
  const rows = payrollRows.filter(r => payrollRowVisible(r) && payrollStatusOf(r) !== 'rejected');
  if (!rows.length) return '<div style="font-size:11px;color:var(--text-3);padding:6px 0">当前筛选下没有行</div>';
  const m = payrollMatrix(rows.map(r => ({ name: r.姓名, type: r.工作内容, h: r.时长 })), payrollCtx.teachers);
  return payrollSummaryTableHtml(m, true) + '<div style="font-size:10px;color:var(--text-3);margin-top:6px">点一个格子，回到明细并筛好这位老师 + 这个工作内容。已驳回的不算。</div>';
}
function payrollToggleGroup(ti) { const n = payrollCtx.teachers[ti]; payrollCollapsed[n] = !payrollCollapsed[n]; payrollRenderGroups(); }
function payrollToggleRow(i, on) { if (!payrollRowSelectable(payrollRows[i])) return; payrollRows[i]._sel = on; payrollRenderGroups(); payrollRenderBar(); }
function payrollEditHours(i, v) {
  const r = payrollRows[i], n = parseFloat(v);
  if (!payrollRowSelectable(r)) return;
  if (!(n >= 0)) { payrollRenderGroups(); return; }
  r.时长 = payrollRound(n);
  if (payrollStatusOf(r) === 'changed') r._sel = true;
  payrollRenderGroups(); payrollRenderBar();
}
function payrollEditNote(i, v) {
  const r = payrollRows[i];
  if (!payrollRowSelectable(r)) return;
  r.备注 = v;
  if (payrollStatusOf(r) === 'changed') r._sel = true;
  payrollRenderGroups(); payrollRenderBar();
}

// 驳回申告：必须写原因，老师端马上能看到
async function payrollRejectDeclare(i) {
  const r = payrollRows[i];
  if (!r || r.type !== 'declare' || !payrollRowSelectable(r)) return;
  const why = (prompt(`驳回「${r.姓名} · ${r.工作内容}」这条申告，请写驳回原因：`) || '').trim();
  if (!why) { alert('驳回必须写原因'); return; }
  try {
    await sb(`/rest/v1/work_records?id=eq.${encodeURIComponent(r.source_id)}`, 'PATCH', { status: 'rejected', admin_note: why, updated_at: new Date().toISOString() });
    payrollCtx.pub = await payrollLoadPub(payrollRows);
    r._sel = false;
    payrollRenderResult();
  } catch (e) { alert('驳回失败：' + e.message); }
}

// 待学生确认（不计入本月）：每位老师组下面
function payrollPendingHtml(list) {
  if (!list.length) return '';
  const total = payrollRound(list.reduce((t, x) => t + x.hours, 0));
  return `<div style="margin-top:8px;background:#fff8e1;border:1px solid #e6a817;border-radius:3px;padding:9px 12px">
    <div style="font-size:12px;font-weight:600;color:#856404">待学生确认（不计入本月）：${list.length} 节 · ${total} 课时</div>
    <div style="font-size:10px;color:var(--text-3);margin:2px 0 6px">老师已填上课记录，学生确认并评价（教务可代确认）之后，按确认的日期算进当月工资。</div>
    ${list.map(x => `<div style="font-size:11px;padding:3px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span>${escTM(x.name)} · ${escTM(x.date)} ${escTM(x.range)}${x.hours ? ' · ' + x.hours + 'h' : ''}</span>
      <button class="btn btn-outline btn-sm" onclick="payrollProxyConfirm('${escTM(x.id)}')">代学生确认</button></div>`).join('')}
  </div>`;
}
// 待填写面谈记录（不计入工资）：每位老师组下面，样式同上；右上角复制这位老师的提醒文字
function payrollIvPendingHtml(n, list) {
  if (!list.length) return '';
  return `<div style="margin-top:8px;background:#fff8e1;border:1px solid #e6a817;border-radius:3px;padding:9px 12px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div style="font-size:12px;font-weight:600;color:#856404">待填写面谈记录（不计入工资）：${list.length} 条</div>
      <button class="btn btn-outline btn-sm" onclick="payrollIvCopy(this.dataset.n)" data-n="${escTM(n)}">复制提醒文字</button>
    </div>
    <div style="font-size:10px;color:var(--text-3);margin:2px 0 6px">面谈完成并填写面谈记录之后，按填写记录的日期算进当月工资。</div>
    ${list.map(x => `<div style="font-size:11px;padding:3px 0">${escTM(x.name)} · ${escTM(x.date)} ${escTM(x.time)} · <span style="color:#9a5a00">${escTM(x.reason)}</span></div>`).join('')}
  </div>`;
}
function payrollIvCopy(n) { interviewRemindCopy(interviewRemindText(n, payrollCtx.ivPending[n] || [])); }
function payrollIvBatch() {
  interviewRemindDialog(Object.keys(payrollCtx.ivPending).filter(n => payrollCtx.ivPending[n].length).map(n => ({ teacher: n, list: payrollCtx.ivPending[n] })));
}
// 复制文字（管理端工资页 / 面谈预约页共用）
function interviewRemindCopy(t, done) {
  const ok = () => { if (done) done(); else alert('已复制'); };
  const fb = () => { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (_) { alert('复制失败，请手动选中复制'); } ta.remove(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, fb); else fb();
}
// 批量提醒弹窗：groups = [{ teacher, list }]，按老师分段，每段有自己的复制按钮，最上面「复制全部」
function interviewRemindDialog(groups) {
  groups = (groups || []).filter(g => g.list && g.list.length);
  if (!groups.length) { alert('没有待填写的面谈'); return; }
  const texts = groups.map(g => interviewRemindText(g.teacher, g.list));
  window.__ivRemindTexts = texts;
  let ov = document.getElementById('ivRemindOverlay');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'ivRemindOverlay';
  ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:1000;display:flex;align-items:center;justify-content:center';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:16px 18px;width:min(640px,94vw);max-height:86vh;overflow:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
      <div style="font-size:14px;font-weight:600">面谈提醒文字 · ${groups.length} 位老师</div>
      <div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="interviewRemindCopy(window.__ivRemindTexts.join('\n\n'))">复制全部</button>
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('ivRemindOverlay').remove()">关闭</button></div>
    </div>
    ${groups.map((g, i) => `<div style="border:1px solid var(--border);border-radius:4px;padding:9px 12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><strong style="font-size:12px">${escTM(g.teacher)}</strong>
      <button class="btn btn-outline btn-sm" onclick="interviewRemindCopy(window.__ivRemindTexts[${i}])">复制</button></div>
      <div style="font-size:11px;line-height:1.7;white-space:pre-wrap;color:var(--text-2)">${escTM(texts[i])}</div></div>`).join('')}
  </div>`;
  document.body.appendChild(ov);
}

// 用管理端 booking.js 的同一个代确认弹窗，确认后重新生成（保留已改的时长、备注和勾选）
function payrollProxyConfirm(id) {
  bkBfProxyOpen(id, () => payrollGenerate(true));
}

// ── 底部操作栏 ──
function payrollSelected() { return payrollRows.filter(r => r._sel && payrollRowSelectable(r)); }
function payrollRenderBar() {
  const bar = document.getElementById('pr_bar');
  if (!bar) return;
  if (!payrollCanApprove()) {   // 只能查看：没有勾选 / 发布，下载的是当前筛选下看得到的行
    const vis = payrollRows.filter(payrollRowVisible);
    const vh = payrollRound(vis.reduce((s, r) => s + (parseFloat(r.时长) || 0), 0));
    bar.innerHTML = `<span style="font-size:12px">当前显示 <strong>${vis.length}</strong> 条 · 合计 <strong>${vh}</strong> 小时 · 涉及 <strong>${new Set(vis.map(r => r.姓名)).size}</strong> 位老师</span>
      <span style="margin-left:auto"><button class="btn btn-outline btn-sm" onclick="payrollDownloadSelected()">↓ 下载 Excel</button></span>`;
    return;
  }
  const sel = payrollSelected();
  const hours = payrollRound(sel.reduce((s, r) => s + (parseFloat(r.时长) || 0), 0));
  const tn = new Set(sel.map(r => r.姓名)).size;
  bar.innerHTML = `<span style="font-size:12px">已勾选 <strong>${sel.length}</strong> 条 · 合计 <strong>${hours}</strong> 小时 · 涉及 <strong>${tn}</strong> 位老师</span>
    <span style="margin-left:auto;display:flex;gap:8px">
      <button class="btn btn-outline btn-sm" onclick="payrollDownloadSelected()">↓ 下载 Excel</button>
      <button class="btn btn-primary btn-sm" onclick="payrollPublish()">✓ 确定发布</button>
    </span>`;
}
function payrollDownloadSelected() {
  const sel = payrollCanApprove() ? payrollSelected() : payrollRows.filter(payrollRowVisible);
  if (!sel.length) { alert(payrollCanApprove() ? '请先勾选要下载的行' : '当前没有可下载的行'); return; }
  // 多位老师按老师分表：保持老师顺序
  const order = payrollCtx.teachers;
  const rows = [...sel].sort((a, b) => order.indexOf(a.姓名) - order.indexOf(b.姓名));
  payrollDownload(rows, payrollCtx.label, payrollCtx.who);
}

// ── 确定发布：直接 approved；同 source_id 有变化就更新，没变化跳过 ──
async function payrollPublish() {
  if (!payrollCanApprove()) { alert('你只有查看权限，审批发布请联系管理员'); return; }
  const sel = payrollSelected();
  if (!sel.length) { alert('请先勾选要发布的行'); return; }
  const toNew = [], toUpd = [];
  let skipped = 0;
  sel.forEach(r => {
    const p = payrollCtx.pub[payrollKey(r.type, r.source_id)];
    if (!p) toNew.push(r);
    else if (payrollStatusOf(r) === 'published') skipped++;
    else toUpd.push({ r, p });
  });
  if (!toNew.length && !toUpd.length) { alert('勾选的行都已发布且没有变化，无需重复发布'); return; }
  if (!confirm(`发布后老师在老师端能看到这些工作记录。共 ${toNew.length + toUpd.length} 条，其中新增 ${toNew.length}、更新 ${toUpd.length}${skipped ? `（另有 ${skipped} 条已发布且无变化，跳过）` : ''}`)) return;
  const now = new Date().toISOString();
  const fields = r => ({
    teacher_name: r.姓名, start_time: r.开始时间, end_time: r.结束时间, duration: r.时长,
    work_type: r.工作内容, location: r.工作地点, notes: r.备注, source: r.type, source_id: r.source_id,
    domain: r._domain || null, status: 'approved'
  });
  try {
    const ins = toNew.map(r => ({ id: `wr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}-${Math.random().toString(36).slice(2, 5)}`, ...fields(r) }));
    for (let i = 0; i < ins.length; i += 20) await sb('/rest/v1/work_records', 'POST', ins.slice(i, i + 20));
    for (let i = 0; i < toUpd.length; i += 10) {
      await Promise.all(toUpd.slice(i, i + 10).map(({ r, p }) =>
        sb(`/rest/v1/work_records?id=eq.${encodeURIComponent(p.id)}`, 'PATCH', { ...fields(r), admin_note: null, updated_at: now })));
    }
    payrollCtx.pub = await payrollLoadPub(payrollRows);
    payrollRows.forEach(r => { if (payrollStatusOf(r) === 'published') r._sel = false; });
    alert(`已发布：新增 ${toNew.length}、更新 ${toUpd.length}`);
    payrollRenderResult();
    payrollRenderPublished();
  } catch (e) { alert('发布失败：' + e.message); }
}

// ══════════════════════════════════
// 已发布记录：按月份 → 老师；只看、可下载、可撤回
// ══════════════════════════════════
let payrollPubRecords = null;
let payrollPubOpenKeys = {};
let payrollPubTypeSel = [];     // 已发布记录：工作内容筛选（多选）
let payrollPubSortCol = 'date'; // date | name | type | hours
let payrollPubSortDir = 1;
let payrollPubView = 'detail';  // detail | summary
const payrollRecMonth = r => { const m = String(r.start_time || '').match(/(\d{4})年(\d{2})月/); return m ? m[1] + '-' + m[2] : '未知月份'; };
const payrollFmtTime = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : `${d.getFullYear()}-${payrollPad(d.getMonth() + 1)}-${payrollPad(d.getDate())} ${payrollPad(d.getHours())}:${payrollPad(d.getMinutes())}`;
};

async function payrollRenderPublished() {
  const box = document.getElementById('pr_published');
  if (!box) return;
  const head = `<div onclick="payrollTogglePublished()" style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-2);letter-spacing:.05em;margin:20px 0 10px">${payrollPubOpen ? '▾' : '▸'} 已发布记录</div>`;
  if (!payrollPubOpen) { box.innerHTML = head; return; }
  box.innerHTML = head + '<div style="font-size:12px;color:var(--text-3)">加载中…</div>';
  try {
    payrollPubRecords = await sbAll(`/rest/v1/work_records?status=eq.approved&order=start_time.asc${payrollDomainQs()}`);
    payrollRenderPublishedBody();
  } catch (e) {
    box.innerHTML = head + `<div style="font-size:12px;color:var(--danger)">加载失败：${escTM(e.message)}</div>`;
  }
}
function payrollTogglePublished() { payrollPubOpen = !payrollPubOpen; payrollRenderPublished(); }
// 分组：月份 → 老师
const payrollPubFiltered = () => (payrollPubRecords || []).filter(r => !payrollPubTypeSel.length || payrollPubTypeSel.includes(payrollTypeName(r.work_type)));
function payrollPubGroups(all) {
  const g = {};
  (all ? (payrollPubRecords || []) : payrollPubFiltered()).forEach(r => {
    const m = payrollRecMonth(r);
    ((g[m] = g[m] || {})[r.teacher_name] = g[m][r.teacher_name] || []).push(r);
  });
  return g;
}
function payrollRenderPublishedBody() {
  const box = document.getElementById('pr_published');
  if (!box) return;
  const head = `<div onclick="payrollTogglePublished()" style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-2);letter-spacing:.05em;margin:20px 0 10px">▾ 已发布记录</div>`;
  const g = payrollPubGroups();
  const months = Object.keys(g).sort().reverse();
  const present = [...new Set((payrollPubRecords || []).map(r => payrollTypeName(r.work_type)).filter(Boolean))].sort(payrollTypeSort);
  const chip = (on, click, t, dt) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${click}"${dt ? ` data-t="${escTM(dt)}"` : ''}>${t}</div>`;
  const sortChip = (col, label) => chip(payrollPubSortCol === col, `payrollPubSortBy('${col}')`, label + (payrollPubSortCol === col ? (payrollPubSortDir === 1 ? ' ↑' : ' ↓') : ''));
  const controls = `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">
      <span style="font-size:10px;color:var(--text-3)">工作内容</span>
      ${chipFold(present.map(t => ({ on: payrollPubTypeSel.includes(t), html: chip(payrollPubTypeSel.includes(t), 'payrollPubToggleType(this.dataset.t)', escTM(t), t) })))}
      <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
        <span style="font-size:10px;color:var(--text-3)">排序</span>${sortChip('date', '日期')}${sortChip('name', '老师')}${sortChip('type', '工作内容')}${sortChip('hours', '时长')}
        ${chip(payrollPubView === 'detail', "payrollPubSetView('detail')", '明细')}${chip(payrollPubView === 'summary', "payrollPubSetView('summary')", '汇总')}
      </span></div>`;
  if (!months.length) { box.innerHTML = head + controls + '<div style="font-size:12px;color:var(--text-3)">' + ((payrollPubRecords || []).length ? '当前筛选下没有记录' : '暂无已发布的记录') + '</div>'; return; }
  const monthStats = m => {
    const items = []; Object.keys(g[m]).forEach(n => g[m][n].forEach(r => items.push({ name: n, type: r.work_type, h: r.duration })));
    const mm = payrollMatrix(items);
    return `<div style="font-size:11px;color:var(--text-2);margin-bottom:6px">${mm.types.map(t => `${escTM(t)} <b>${payrollRound(mm.colTot[t].h)}</b>h<span style="color:var(--text-3)">/${mm.colTot[t].n}条</span>`).join(' · ')} · 合计 <b>${payrollRound(mm.total.h)}</b>h/${mm.total.n}条</div>`;
  };
  const monthSummary = m => {
    const items = []; Object.keys(g[m]).forEach(n => g[m][n].forEach(r => items.push({ name: n, type: r.work_type, h: r.duration })));
    return payrollSummaryTableHtml(payrollMatrix(items), false) + `<div style="margin-top:6px">${payrollMatrix(items).types.map(t => chip(false, 'payrollPubJump(this.dataset.t)', '只看' + escTM(t), t)).join('')}</div>`;
  };
  box.innerHTML = head + controls + months.map(m => `
    <div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px">${m.length === 7 ? m.slice(0, 4) + '年' + m.slice(5) + '月' : m}</div>
      ${monthStats(m)}
      ${payrollPubView === 'summary' ? monthSummary(m) : Object.keys(g[m]).sort((a, b) => payrollPubSortCol === 'name' ? String(a).localeCompare(String(b), 'zh') * payrollPubSortDir : String(a).localeCompare(String(b), 'zh')).map(n => {
        const list = g[m][n];
        const k = m + '|' + n;
        const open = payrollPubOpenKeys[k];
        const hours = payrollRound(list.reduce((s, r) => s + (parseFloat(r.duration) || 0), 0));
        const last = list.map(r => r.updated_at || r.created_at || '').sort().pop();
        const ek = escTM(k);
        return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:8px 12px;margin-bottom:6px;font-size:11px">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
            <span style="font-weight:600;min-width:80px">${escTM(n)}</span>
            <span>${list.length} 节 · ${hours} 小时</span>
            <span style="color:var(--text-3)">${last ? '发布于 ' + payrollFmtTime(last) : ''}</span>
            <span style="margin-left:auto;display:flex;gap:6px">
              <button class="btn btn-outline btn-sm" data-k="${ek}" onclick="payrollPubToggle(this.dataset.k)">${open ? '收起' : '展开'}</button>
              <button class="btn btn-outline btn-sm" data-k="${ek}" onclick="payrollPubDownload(this.dataset.k)">↓ 下载</button>
              ${payrollCanApprove() && !payrollIsSelf(n) ? `<button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" data-k="${ek}" onclick="payrollPubRetract(this.dataset.k)">撤回</button>` : (payrollCanApprove() ? '<span style="font-size:10px;color:#9a5a00">自己的工资由管理员审批</span>' : '')}
            </span>
          </div>
          ${open ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-light)">${payrollPubSort(list).map(r => `<div style="padding:2px 0;color:var(--text-2)">${escTM(r.start_time)} → ${escTM(payrollDT(r.end_time).t)} · ${r.duration}h · ${escTM(r.work_type)} · ${escTM(r.location)} · ${escTM(r.notes)}</div>`).join('')}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`).join('');
}
function payrollPubList(k, all) { const [m, n] = k.split('|'); return ((payrollPubGroups(all)[m] || {})[n]) || []; }
function payrollPubToggleType(t) { const i = payrollPubTypeSel.indexOf(t); if (i >= 0) payrollPubTypeSel.splice(i, 1); else payrollPubTypeSel.push(t); payrollRenderPublishedBody(); }
function payrollPubSortBy(col) { if (payrollPubSortCol === col) payrollPubSortDir *= -1; else { payrollPubSortCol = col; payrollPubSortDir = 1; } payrollRenderPublishedBody(); }
function payrollPubSetView(v) { payrollPubView = v; payrollRenderPublishedBody(); }
// 汇总里点一个格子：回到明细，只筛这个工作内容（老师卡片本来就按老师分）
function payrollPubJump(t) { payrollPubView = 'detail'; payrollPubTypeSel = t ? [t] : []; payrollRenderPublishedBody(); }
function payrollPubSort(list) {
  const d = payrollPubSortDir, byDate = (a, b) => String(a.start_time).localeCompare(String(b.start_time));
  const cmp = {
    date: byDate,
    name: (a, b) => String(a.teacher_name).localeCompare(String(b.teacher_name), 'zh') || byDate(a, b),
    type: (a, b) => payrollTypeIdx(a.work_type) - payrollTypeIdx(b.work_type) || byDate(a, b),
    hours: (a, b) => ((parseFloat(a.duration) || 0) - (parseFloat(b.duration) || 0)) || byDate(a, b)
  }[payrollPubSortCol] || byDate;
  return list.slice().sort((a, b) => cmp(a, b) * d);
}
function payrollPubToggle(k) { payrollPubOpenKeys[k] = !payrollPubOpenKeys[k]; payrollRenderPublishedBody(); }
function payrollPubDownload(k) {
  const list = payrollPubList(k);
  if (!list.length) return;
  const [m, n] = k.split('|');
  payrollDownload(list.map(payrollRecToRow), m.length === 7 ? m.slice(0, 4) + '年' + m.slice(5) + '月' : m, n);
}
async function payrollPubRetract(k) {
  const list = payrollPubList(k, true);   // 撤回的是这位老师这个月已发布的全部，不受「工作内容」筛选影响
  if (!list.length) return;
  const [m, n] = k.split('|');
  if (!payrollCanApprove() || payrollIsSelf(n)) return;
  if (!confirm(`撤回「${n}」${m.length === 7 ? m.slice(0, 4) + '年' + m.slice(5) + '月' : m}已发布的 ${list.length} 条记录？\n撤回后会删除这些记录，老师端随即看不到。`)) return;
  try {
    const ids = list.map(r => r.id);
    for (let i = 0; i < ids.length; i += 50) {
      await sb(`/rest/v1/work_records?id=in.(${ids.slice(i, i + 50).map(x => `"${x}"`).join(',')})`, 'DELETE');
    }
    if (payrollCtx) {
      payrollCtx.pub = await payrollLoadPub(payrollRows);
      payrollRenderResult();
    }
    payrollRenderPublished();
  } catch (e) { alert('撤回失败：' + e.message); }
}

// ══════════════════════════════════
// 旧数据：改版前提交、还停在待审核 / 已驳回的记录
// ══════════════════════════════════
async function payrollLoadLegacy() {
  const box = document.getElementById('pr_legacy');
  if (!box) return;
  try {
    if (!payrollCanApprove()) { box.innerHTML = ''; return; }   // 只能查看的负责人不显示旧记录的「全部发布 / 删除」
    const rows = (await sbAll(`/rest/v1/work_records?status=in.(pending,rejected)&or=(source.is.null,source.neq.declare)&select=id,teacher_name${payrollDomainQs()}`)).filter(r => !payrollIsSelf(r.teacher_name));
    if (!rows.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div style="background:#fff8e1;border:1px solid #e6a817;border-radius:3px;padding:10px 12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <span style="font-size:12px;color:#856404;font-weight:600">有 ${rows.length} 条旧的待审核记录（改版前提交的）</span>
      <span style="margin-left:auto;display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" onclick="payrollLegacyPublish()">全部发布</button>
        <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="payrollLegacyDelete()">全部删除</button>
      </span></div>`;
    box.dataset.ids = JSON.stringify(rows.map(r => r.id));
  } catch (e) { box.innerHTML = ''; }
}
function payrollLegacyIds() { try { return JSON.parse(document.getElementById('pr_legacy').dataset.ids || '[]'); } catch (e) { return []; } }
async function payrollLegacyPublish() {
  const ids = payrollLegacyIds();
  if (!payrollCanApprove() || !ids.length || !confirm(`把这 ${ids.length} 条旧记录全部发布？发布后老师在老师端能看到。`)) return;
  try {
    const now = new Date().toISOString();
    for (let i = 0; i < ids.length; i += 50) {
      await sb(`/rest/v1/work_records?id=in.(${ids.slice(i, i + 50).map(x => `"${x}"`).join(',')})`, 'PATCH', { status: 'approved', admin_note: null, updated_at: now });
    }
    payrollLoadLegacy(); payrollRenderPublished();
  } catch (e) { alert('操作失败：' + e.message); }
}
async function payrollLegacyDelete() {
  const ids = payrollLegacyIds();
  if (!payrollCanApprove() || !ids.length || !confirm(`删除这 ${ids.length} 条旧的待审核记录？删除后无法恢复。`)) return;
  try {
    for (let i = 0; i < ids.length; i += 50) {
      await sb(`/rest/v1/work_records?id=in.(${ids.slice(i, i + 50).map(x => `"${x}"`).join(',')})`, 'DELETE');
    }
    payrollLoadLegacy();
  } catch (e) { alert('操作失败：' + e.message); }
}

// ── VIP 记录完整度（读自预约本身） ──
function payrollVipMissing(b) {
  if (!b) return ['对应的 VIP 预约（已被删除？）'];
  const t = v => String(v == null ? '' : v).trim();
  const hwOk = t(b.vip_homework) || (Array.isArray(b.vip_homework_questions) ? b.vip_homework_questions.length : b.vip_homework_questions && Object.keys(b.vip_homework_questions).length);
  const out = [];
  if (!t(b.vip_content)) out.push('本次内容');
  if (!t(b.vip_session_notes)) out.push('上课内容');
  if (!t(b.vip_student_status)) out.push('学生状态/评价');
  if (!hwOk) out.push('布置作业');
  if (!(parseFloat(b.vip_hours_used) > 0)) out.push('本次耗时');
  return out;
}

function renderPayrollPage(mc){
  mc.innerHTML = `
  <div class="page-section">
    <div class="section-title">工作管理</div>
    <div class="section-sub">工资核算：生成 → 核对 → 下载 Excel 或发布给老师</div>
  </div>
  <div id="payrollContainer"></div>`;
  renderPayrollSection(document.getElementById('payrollContainer'));
}
