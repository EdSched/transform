// ══════════════════════════════════
// classes.js — 班级（表 classes；students.class_ids / courses.class_ids）
// 班级和专业是两回事：学生有自己的专业，同时可以属于一个或多个班级；班级按领域区分（目前学部美术在用）
// 课程「按班级」编入学生的规则写在 shared/constants.js 的 courseDefaultMember（不要在这里另写一套）
// ══════════════════════════════════

let CLASSES = [];
let classesLoaded = false;
async function loadClasses(force) {
  if (classesLoaded && !force) return CLASSES;
  CLASSES = await sb('/rest/v1/classes?select=*&order=sort_order.asc,created_at.asc').catch(() => []) || [];
  classesLoaded = true;
  return CLASSES;
}
function clsEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function classById(id) { return CLASSES.find(c => String(c.id) === String(id)) || null; }
// 当前领域视角下的班级（总览=全部；领域视角=本领域 + 没填领域的）
function classesInView(includeInactive) {
  // 范围内的班级：总览全部；所属领域完整选中，或班级本身被单独选中；没填领域的班级在有完整领域的范围里也显示（和以前一样）
  return CLASSES.filter(c => (includeInactive || c.active !== false) &&
    (scopeAll() || scopeClass(c) || (!c.domain && VIEW_SCOPE.domains.length > 0)));
}
function classNamesOf(ids) { return _arrOf(ids).map(id => (classById(id) || {}).name).filter(Boolean); }
function classTagsHtml(ids) {
  return classNamesOf(ids).map(n => `<span style="font-size:9px;background:#efe8f7;color:#5a3a8a;border-radius:2px;padding:0 5px;margin-left:4px;font-weight:500;white-space:nowrap">${clsEsc(n)}</span>`).join('');
}
// 可点选的班级 chip（选中=深色），onClickJs(id) 返回 onclick 字符串
function classChipsHtml(selectedIds, onClickJs, list) {
  const sel = new Set(_arrOf(selectedIds));
  const all = list || classesInView();
  if (!all.length) return '<span style="font-size:11px;color:var(--text-3)">还没有班级（学生档案 →「🏷 班级管理」新建）</span>';
  return all.map(c => {
    const on = sel.has(String(c.id));
    return `<span onclick="${onClickJs(c.id)}" style="display:inline-block;font-size:11px;padding:3px 10px;margin:0 4px 4px 0;border-radius:12px;cursor:pointer;user-select:none;border:1px solid ${on ? '#5a3a8a' : 'var(--border)'};background:${on ? '#5a3a8a' : 'var(--surface)'};color:${on ? '#fff' : 'var(--text-2)'}">${clsEsc(c.name)}</span>`;
  }).join('');
}
function clsDefaultDomain() {
  if (viewLockDomain()) return viewLockDomain();
  if (CURRENT_DOMAIN === 'multi') { const l = scopeDomainList(); return l.length === 1 ? l[0] : ''; }   // 组合范围：只有一个选项才自动选中，否则必须自己选
  const art = (typeof DOMAINS !== 'undefined' ? DOMAINS : []).find(d => isGakubuArtDomain(d.label));
  return art ? art.label : '';
}

// ── 班级管理（学生档案页「🏷 班级管理」）──
async function openClassManager() {
  await loadClasses(true);
  document.getElementById('clsModal')?.remove();
  const m = document.createElement('div');
  m.id = 'clsModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = '<div id="clsBox" style="background:var(--surface);border-radius:6px;padding:18px 20px;max-width:520px;width:100%;max-height:88vh;overflow-y:auto"></div>';
  m.onclick = e => { if (e.target === m) clsClose(); };
  document.body.appendChild(m);
  clsRender();
}
function clsClose() {
  document.getElementById('clsModal')?.remove();
  if (typeof renderStudentsPage === 'function' && typeof curPage !== 'undefined' && curPage === 'students') renderStudentsPage(document.getElementById('mainContent'));
}
function clsRender() {
  const box = document.getElementById('clsBox'); if (!box) return;
  const list = classesInView(true);
  const inp = 'font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit';
  const doms = CURRENT_DOMAIN === 'multi' ? scopeDomainList() : (typeof DOMAINS !== 'undefined' ? DOMAINS : []).map(d => d.label);
  const lockDom = !!viewLockDomain();
  box.innerHTML = `
    <div style="display:flex;align-items:center;margin-bottom:10px"><div style="font-size:14px;font-weight:600;flex:1">🏷 班级管理</div>
      <button onclick="clsClose()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-3)">×</button></div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:10px">班级和专业是两回事：学生保留自己的专业，同时可以属于一个或多个班级。课程选「按班级」后，班级里的学生自动成为课程成员。</div>
    ${list.length ? list.map((c, i) => {
      const n = (cachedStudents || []).filter(s => studentClassIds(s).includes(String(c.id))).length;
      const off = c.active === false;
      return `<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--border-light);${off ? 'opacity:.5' : ''}">
        <input id="cls_name_${clsEsc(c.id)}" value="${clsEsc(c.name)}" style="${inp};flex:1;min-width:0">
        <span style="font-size:10px;color:var(--text-3);white-space:nowrap">${clsEsc(c.domain || '')} · ${n}人</span>
        <button class="btn btn-outline btn-sm" onclick="clsRename('${clsEsc(c.id)}')">改名</button>
        <button class="btn btn-outline btn-sm" ${i === 0 ? 'disabled' : ''} onclick="clsMove('${clsEsc(c.id)}',-1)">↑</button>
        <button class="btn btn-outline btn-sm" ${i === list.length - 1 ? 'disabled' : ''} onclick="clsMove('${clsEsc(c.id)}',1)">↓</button>
        <button class="btn btn-outline btn-sm" onclick="clsToggleActive('${clsEsc(c.id)}')">${off ? '启用' : '停用'}</button>
      </div>`;
    }).join('') : '<div style="font-size:12px;color:var(--text-3);padding:10px 0">还没有班级</div>'}
    <div style="display:flex;gap:6px;align-items:center;margin-top:12px">
      <input id="cls_new_name" placeholder="新班级名，例：纯艺设计班" style="${inp};flex:1;min-width:0" onkeydown="if(event.key==='Enter')clsAdd()">
      ${lockDom ? '' : `<select id="cls_new_domain" style="${inp}">${CURRENT_DOMAIN === 'multi' && doms.length > 1 ? '<option value="">选择领域</option>' : ''}${doms.map(d => `<option ${d === clsDefaultDomain() ? 'selected' : ''}>${clsEsc(d)}</option>`).join('')}</select>`}
      <button class="btn btn-primary btn-sm" onclick="clsAdd()">＋ 新建</button>
    </div>
    <div id="cls_msg" style="font-size:11px;color:var(--danger);min-height:14px;margin-top:6px"></div>`;
}
async function clsAdd() {
  const name = ((document.getElementById('cls_new_name') || {}).value || '').trim();
  if (!name) return;
  const domain = (document.getElementById('cls_new_domain') || {}).value || clsDefaultDomain() || null;
  if (CURRENT_DOMAIN === 'multi' && !domain) { const m = document.getElementById('cls_msg'); if (m) m.textContent = '请先选择班级所属的领域'; return; }
  const row = { id: `cls-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, domain, sort_order: CLASSES.length + 1, active: true };
  try { await sb('/rest/v1/classes', 'POST', row); CLASSES.push(row); clsRender(); }
  catch (e) { const m = document.getElementById('cls_msg'); if (m) m.textContent = '保存失败：' + e.message + '（请确认已执行 SQL）'; }
}
async function clsRename(id) {
  const c = classById(id); const name = ((document.getElementById('cls_name_' + id) || {}).value || '').trim();
  if (!c || !name || name === c.name) return;
  try { await sb(`/rest/v1/classes?id=eq.${encodeURIComponent(id)}`, 'PATCH', { name }); c.name = name; clsRender(); }
  catch (e) { alert('保存失败：' + e.message); }
}
async function clsToggleActive(id) {
  const c = classById(id); if (!c) return;
  const active = c.active === false;
  try { await sb(`/rest/v1/classes?id=eq.${encodeURIComponent(id)}`, 'PATCH', { active }); c.active = active; clsRender(); }
  catch (e) { alert('保存失败：' + e.message); }
}
async function clsMove(id, d) {
  const list = classesInView(true);
  const i = list.findIndex(c => String(c.id) === String(id)), j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  try {
    for (let k = 0; k < list.length; k++) {
      if (list[k].sort_order !== k + 1) { await sb(`/rest/v1/classes?id=eq.${encodeURIComponent(list[k].id)}`, 'PATCH', { sort_order: k + 1 }); list[k].sort_order = k + 1; }
    }
    CLASSES.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    clsRender();
  } catch (e) { alert('保存失败：' + e.message); }
}

// ── 学生列表：多选学生 →「🏷 编入班级」（加入 / 移出）──
async function openClassAssign() {
  const ids = [...document.querySelectorAll('.student-select:checked')].map(c => c.value);
  if (!ids.length) { alert('请先在列表里勾选学生'); return; }
  await loadClasses();
  const list = classesInView();
  if (!list.length) { alert('还没有班级，请先点「🏷 班级管理」新建'); return; }
  document.getElementById('clsAssignModal')?.remove();
  const m = document.createElement('div');
  m.id = 'clsAssignModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  const inp = 'font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit;width:100%';
  m.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:18px 20px;max-width:380px;width:100%">
    <div style="font-size:14px;font-weight:600;margin-bottom:10px">🏷 编入班级（已选 ${ids.length} 人）</div>
    <label style="font-size:11px;color:var(--text-3)">班级</label>
    <select id="clsa_class" style="${inp};margin:2px 0 10px">${list.map(c => `<option value="${clsEsc(c.id)}">${clsEsc(c.name)}</option>`).join('')}</select>
    <label style="font-size:11px;color:var(--text-3)">操作</label>
    <select id="clsa_mode" style="${inp};margin:2px 0 14px"><option value="add">加入这个班级</option><option value="remove">移出这个班级</option></select>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('clsAssignModal').remove()">取消</button>
      <button class="btn btn-primary btn-sm" id="clsa_btn" onclick="clsAssignRun(${clsEsc(JSON.stringify(ids))})">执行</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}
async function clsAssignRun(ids) {
  const cid = document.getElementById('clsa_class').value, add = document.getElementById('clsa_mode').value === 'add';
  const btn = document.getElementById('clsa_btn'); if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
  let n = 0;
  try {
    for (const id of ids) {
      const s = (cachedStudents || []).find(x => String(x.id) === String(id)); if (!s) continue;
      const cur = studentClassIds(s);
      const next = add ? [...new Set([...cur, String(cid)])] : cur.filter(x => x !== String(cid));
      if (next.length === cur.length && next.every((x, i) => x === cur[i])) continue;
      await sb(`/rest/v1/students?id=eq.${encodeURIComponent(id)}`, 'PATCH', { class_ids: next });
      s.class_ids = next; n++;
    }
    document.getElementById('clsAssignModal')?.remove();
    renderStudentsPage(document.getElementById('mainContent'));
    alert(`已${add ? '加入' : '移出'}「${(classById(cid) || {}).name || ''}」：${n} 人`);
  } catch (e) { if (btn) { btn.disabled = false; btn.textContent = '执行'; } alert('保存失败：' + e.message + '（请确认已执行 SQL）'); }
}

// ── 学生编辑弹窗：所属班级（chip 点选）──
let stClassPick = [];
function stClassRender() {
  const box = document.getElementById('st_class_chips'); if (!box) return;
  const wrap = document.getElementById('st_class_wrap');
  const list = classesInView().concat(CLASSES.filter(c => c.active === false && stClassPick.includes(String(c.id))));
  if (wrap) wrap.style.display = (list.length || stClassPick.length) ? '' : 'none';
  box.innerHTML = classChipsHtml(stClassPick, id => `stClassToggle('${clsEsc(id)}')`, list);
}
function stClassToggle(id) {
  id = String(id);
  stClassPick = stClassPick.includes(id) ? stClassPick.filter(x => x !== id) : [...stClassPick, id];
  stClassRender();
}
function stClassOpen(s) {
  stClassPick = studentClassIds(s);
  loadClasses().then(stClassRender);
}
// 保存学生时要不要写 class_ids（还没有任何班级、这个学生也没有班级时不写，避免未执行 SQL 时保存失败）
function stClassPatch() { return (CLASSES.length || stClassPick.length) ? { class_ids: stClassPick.slice() } : {}; }

// ── 学生列表：按班级筛选 ──
let stClassFilter = 'all';
function stClassFilterHtml() {
  const list = classesInView();
  if (!list.length) return '';
  return `<div class="filter-row">${chipFold([['all', '全部班级'], ...list.map(c => [String(c.id), c.name]), ['none', '未编班']].map(([v, l]) =>
    ({ on: stClassFilter === v, html: `<div class="filter-chip${stClassFilter === v ? ' active' : ''}" onclick="stClassFilter='${clsEsc(v)}';renderStudentsPage(document.getElementById('mainContent'))">${clsEsc(l)}</div>` })))}</div>`;
}
function stClassFilterApply(list) {
  if (stClassFilter === 'all') return list;
  if (stClassFilter === 'none') return list.filter(s => !studentClassIds(s).length);
  return list.filter(s => studentClassIds(s).includes(stClassFilter));
}

// ── 课程编辑弹窗：学部美术课程的「学生成员」（按班级 / 按专业 / 指定名单）──
let acClassPick = [];
function acMemberRender() {
  const box = document.getElementById('ac_member_box'); if (!box) return;
  const mode = (document.getElementById('ac_member_mode') || {}).value || 'class';
  const chips = document.getElementById('ac_class_chips');
  if (chips) chips.innerHTML = mode === 'class' ? classChipsHtml(acClassPick, id => `acClassToggle('${clsEsc(id)}')`, (CURRENT_DOMAIN === 'multi' && acCurDomain()) ? classesInView().filter(c => !c.domain || c.domain === acCurDomain()) : undefined) + (acClassPick.length ? '' : '<div style="font-size:11px;color:#a0521a;margin-top:2px">请选择班级：班级里的在读学生会自动成为这门课的成员</div>') : `<span style="font-size:11px;color:var(--text-3)">${mode === 'list' ? '保存后到「课程清理 → 👥 学生成员」里点选名单' : '同专业在读学生（不含纯VIP）'}</span>`;
}
function acClassToggle(id) {
  id = String(id);
  acClassPick = acClassPick.includes(id) ? acClassPick.filter(x => x !== id) : [...acClassPick, id];
  acMemberRender();
}

// ── 课程清理「👥 学生成员」：按班级时选班级 ──
function cmClassBarHtml(courses) {
  if (!courses.some(c => courseMemberMode(c) === 'class')) return '';
  const cur = courses.length === 1 ? courseClassIds(courses[0]) : [...new Set(courses.flatMap(courseClassIds))];
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
    <span style="font-size:11px;color:var(--text-3)">课程班级</span>
    ${classChipsHtml(cur, id => `cmClassToggle('${clsEsc(id)}')`)}
  </div>`;
}
async function cmClassToggle(id) {
  id = String(id);
  const courses = cmCourseIds.map(cmCourse).filter(c => c && courseMemberMode(c) === 'class');
  const allHave = courses.every(c => courseClassIds(c).includes(id));
  try {
    for (const c of courses) {
      const cur = courseClassIds(c);
      const next = allHave ? cur.filter(x => x !== id) : [...new Set([...cur, id])];
      await sb(`/rest/v1/courses?id=eq.${encodeURIComponent(c.id)}`, 'PATCH', { class_ids: next });
      c.class_ids = next;
    }
  } catch (e) { const m = document.getElementById('cmMsg'); if (m) m.textContent = '保存失败：' + e.message; }
  cmRender();
}
// 指定名单：「＋ 整个班级」把班级当前的全部在读学生一次性加入名单（快照，以后班级变化不会自动同步）
async function cmAddWholeClass(id) {
  if (!id) return;
  const courses = cmCourseIds.map(cmCourse).filter(Boolean);
  const stus = cmActiveStudents().filter(s => studentClassIds(s).includes(String(id)));
  if (!stus.length) { alert('这个班级还没有在读学生'); cmRender(); return; }
  const ops = [];
  courses.forEach(c => stus.forEach(s => ops.push(cmPlan(c, s, true))));
  try { await cmExec(ops); } catch (e) {}
  cmRender();
}

// ── 月课表导出：按班级快速筛选 ──
function mcxClassFilters(list) {
  const ids = [...new Set(list.flatMap(x => courseClassIds(x.c)))];
  return ids.map(id => classById(id)).filter(Boolean).map(c => ({ key: 'class:' + c.id, label: c.name, test: course => courseClassIds(course).includes(String(c.id)) }));
}
function mcxClassTagHtml(c) { return classTagsHtml(courseClassIds(c)); }
