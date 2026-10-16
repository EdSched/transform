// ⚙ 选项设置（只有管理员）：管理职位 / 执行角色 可加自定义名称；学生来源可增删改、排序、停用
// 数据在 app_options 表（seed/app_options.sql）；读取在 shared/constants.js 的 loadAppOptions()
// 自定义职位 / 角色（key 以 c_ 开头）可以在「角色模板」里设默认功能和范围规则；负责人的管理范围、营业范围等特殊规则只跟内置项走
const AO_KINDS = [
  ['teacher_position', '管理职位'],
  ['teacher_role', '执行角色'],
  ['student_source', '学生来源'],
];
let aoRows = [];          // app_options 全部行
let aoUse = null;         // 使用情况 { teacher_position:{key:n}, teacher_role:{key:n}, student_source:{名称:{st:n,tc:n}} }
let aoChanged = false;    // 关弹窗时据此刷新老师页
function aoEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function aoJs(v) { return aoEsc(String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")); }   // 放进 onclick="f('…')" 里

async function aoLoad() {
  aoRows = (await sbAll('/rest/v1/app_options?select=*&order=sort.asc,key.asc')) || [];
  const [tch, stu] = await Promise.all([
    sbAll('/rest/v1/teachers?select=id,position,roles,student_sources'),
    sbAll('/rest/v1/students?select=source'),
  ]);
  aoUse = { teacher_position: {}, teacher_role: {}, student_source: {} };
  (tch || []).forEach(t => {
    if (t.position) aoUse.teacher_position[t.position] = (aoUse.teacher_position[t.position] || 0) + 1;
    (t.roles || []).forEach(r => { aoUse.teacher_role[r] = (aoUse.teacher_role[r] || 0) + 1; });
    (t.student_sources || []).forEach(x => { const o = aoUse.student_source[x] || (aoUse.student_source[x] = { st: 0, tc: 0 }); o.tc++; });
  });
  (stu || []).forEach(s => { if (s.source) { const o = aoUse.student_source[s.source] || (aoUse.student_source[s.source] = { st: 0, tc: 0 }); o.st++; } });
}
function aoUsedBy(r) {
  const u = (aoUse || {})[r.kind] || {};
  if (r.kind === 'student_source') { const o = u[r.key] || { st: 0, tc: 0 }; return { st: o.st, tc: o.tc, n: o.st + o.tc }; }
  const n = u[r.key] || 0; return { n, tc: n, st: 0 };
}

async function aoOpen() {
  if (!isHubAdminUser()) return;
  let ov = document.getElementById('aoOverlay');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'aoOverlay'; ov.className = 'modal-overlay';
    ov.innerHTML = '<div class="modal" style="width:680px"><div id="aoBody"></div></div>';
    document.body.appendChild(ov);
  }
  ov.classList.add('open');
  document.getElementById('aoBody').innerHTML = '<div style="padding:20px;color:var(--text-3)">加载中…</div>';
  aoChanged = false;
  try { await aoLoad(); aoRender(); }
  catch (e) { document.getElementById('aoBody').innerHTML = '<div style="padding:20px;color:var(--danger)">加载失败：' + aoEsc(e.message) + '<br>（是否已执行 seed/app_options.sql？）</div><div class="modal-actions"><button class="btn btn-outline" onclick="aoClose()">关闭</button></div>'; }
}
function aoClose() {
  const ov = document.getElementById('aoOverlay'); if (ov) ov.classList.remove('open');
  if (aoChanged) {
    try { if (typeof tfRolesRender === 'function') tfRolesRender(); } catch (e) {}
    try { if (document.getElementById('teacherList')) renderTeacherList(); } catch (e) {}
  }
}
function aoRender() {
  const body = document.getElementById('aoBody'); if (!body) return;
  const sec = (kind, title, note) => {
    const list = aoRows.filter(r => r.kind === kind);
    const rows = list.map((r, i) => {
      const u = aoUsedBy(r);
      const used = kind === 'student_source' ? `${u.st} 个学生 · ${u.tc} 位老师` : `${u.n} 位老师在用`;
      const canDel = !r.builtin && u.n === 0;
      const k = aoJs(r.kind), key = aoJs(r.key);
      return `<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--border-light);flex-wrap:wrap">
        <span style="flex:1;min-width:120px;font-size:12px${r.active ? '' : ';color:var(--text-3);text-decoration:line-through'}">${aoEsc(r.label)}</span>
        ${r.builtin ? '<span style="font-size:9px;color:var(--accent);border:1px solid var(--border);border-radius:2px;padding:0 5px">内置</span>' : ''}
        ${r.active ? '' : '<span style="font-size:9px;color:var(--text-3)">已停用</span>'}
        <span style="font-size:10px;color:var(--text-3)">${used}</span>
        ${kind === 'student_source' ? `<button class="btn btn-outline btn-sm" ${i === 0 ? 'disabled' : ''} onclick="aoMove('${k}','${key}',-1)">↑</button><button class="btn btn-outline btn-sm" ${i === list.length - 1 ? 'disabled' : ''} onclick="aoMove('${k}','${key}',1)">↓</button>` : ''}
        <button class="btn btn-outline btn-sm" onclick="aoRename('${k}','${key}')">改名</button>
        ${r.builtin ? '' : `<button class="btn btn-outline btn-sm" onclick="aoToggle('${k}','${key}')">${r.active ? '停用' : '启用'}</button>
        <button class="btn btn-outline btn-sm" ${canDel ? '' : 'disabled title="有人在用，不能删除（可以先停用）"'} onclick="aoDelete('${k}','${key}')">删除</button>`}
      </div>`;
    }).join('');
    return `<div style="margin-bottom:18px"><div style="font-size:13px;font-weight:600;margin-bottom:4px">${title}</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:6px;line-height:1.6">${note}</div>
      ${rows || '<div style="font-size:11px;color:var(--text-3);padding:6px 0">（还没有数据：请先执行 seed/app_options.sql）</div>'}
      <div style="display:flex;gap:6px;margin-top:8px"><input id="ao_new_${kind}" placeholder="新名称" style="flex:1;font-size:12px;padding:5px 8px" onkeydown="if(event.key==='Enter')aoAdd('${kind}')"><button class="btn btn-primary btn-sm" onclick="aoAdd('${kind}')">添加</button></div></div>`;
  };
  body.innerHTML = `<div class="modal-title">选项设置</div>
    <div class="modal-sub">只有管理员能改；其他页面只读取、只能选。停用 = 新的选择里不再出现，已有数据保留并照常显示。</div>
    ${sec('teacher_position', '管理职位', '自定义职位 / 角色可以在「角色模板」里设默认功能和范围规则，老师选了它就能［补齐］这些功能。负责人的管理范围、营业范围这类特殊规则，仍然只跟内置项走。内置项可以改显示名称，不能删除、不能停用。')}
    ${sec('teacher_role', '执行角色', '同上。自定义项没有老师在用时才能删除。')}
    ${sec('student_source', '学生来源', '改名会同时更新所有学生的来源和老师的来源限制。没有学生、老师在用时才能删除。用 ↑ ↓ 调整顺序。')}
    <div class="modal-actions"><button class="btn btn-outline" onclick="aoClose()">关闭</button></div>`;
}
async function aoRefresh() {
  aoChanged = true;
  await loadAppOptions(); await aoLoad(); aoRender();
}
function aoFind(kind, key) { return aoRows.find(r => r.kind === kind && r.key === key); }
async function aoAdd(kind) {
  const el = document.getElementById('ao_new_' + kind); const label = (el && el.value || '').trim(); if (!label) return;
  try { await aoCreate(kind, label); await aoRefresh(); }
  catch (e) { alert('添加失败：' + e.message); }
}
// 新建一项并返回它（职位 / 角色 key = 'c_' + 随机串；来源 key = 文字本身）。名称重复时抛错
async function aoCreate(kind, label) {
  if (aoRows.some(r => r.kind === kind && r.label === label) || (kind === 'student_source' ? STUDENT_SOURCES_ALL.includes(label) : (kind === 'teacher_position' ? TEACHER_POSITIONS : TEACHER_ROLES).some(x => x[1] === label))) throw new Error('已经有叫「' + label + '」的了');
  const top = await sb(`/rest/v1/app_options?select=sort&kind=eq.${kind}&order=sort.desc&limit=1`, 'GET', null, { cache: 'no-store' });
  const sort = ((top && top[0] && top[0].sort) || 0) + 1;
  const key = kind === 'student_source' ? label : 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const row = { kind, key, label, sort, builtin: false, active: true };
  await sb('/rest/v1/app_options', 'POST', row);
  return row;
}
async function aoRename(kind, key) {
  const r = aoFind(kind, key); if (!r) return;
  const nv = (prompt('新名称：', r.label) || '').trim(); if (!nv || nv === r.label) return;
  try {
    if (kind === 'student_source') {
      const u = aoUsedBy(r);
      if (!confirm(`把来源「${r.label}」改名为「${nv}」。\n\n会同时更新 ${u.st} 个学生的来源和 ${u.tc} 位老师的来源限制。继续？`)) return;
      const res = await sb('/rest/v1/rpc/rename_student_source', 'POST', { p_old: r.key, p_new: nv });
      const o = Array.isArray(res) ? res[0] : res;
      alert('已改名' + (o && typeof o === 'object' ? `：更新了 ${o.students || 0} 个学生、${o.teachers || 0} 位老师` : ''));
    } else {
      if ((kind === 'teacher_position' ? TEACHER_POSITIONS : TEACHER_ROLES).some(x => x[0] !== key && x[1] === nv)) { alert('已经有叫「' + nv + '」的了'); return; }
      await sb(`/rest/v1/app_options?kind=eq.${kind}&key=eq.${encodeURIComponent(key)}`, 'PATCH', { label: nv });
      await sb(`/rest/v1/role_templates?key=eq.${encodeURIComponent(key)}`, 'PATCH', { label: nv }).catch(() => {});   // 角色模板里对应行的名称一起改（没有这一行也没关系）
    }
    await aoRefresh();
  } catch (e) { alert('改名失败：' + e.message); }
}
async function aoToggle(kind, key) {
  const r = aoFind(kind, key); if (!r || r.builtin) return;
  try { await sb(`/rest/v1/app_options?kind=eq.${kind}&key=eq.${encodeURIComponent(key)}`, 'PATCH', { active: !r.active }); await aoRefresh(); }
  catch (e) { alert('操作失败：' + e.message); }
}
async function aoDelete(kind, key) {
  const r = aoFind(kind, key); if (!r || r.builtin) return;
  if (aoUsedBy(r).n > 0) { alert('还有人在用，不能删除（可以先停用）'); return; }
  if (!confirm('删除「' + r.label + '」？')) return;
  try { await sb(`/rest/v1/app_options?kind=eq.${kind}&key=eq.${encodeURIComponent(key)}`, 'DELETE');
    if (kind !== 'student_source') await sb(`/rest/v1/role_templates?key=eq.${encodeURIComponent(key)}`, 'DELETE').catch(() => {});   // 对应的模板行一起删
    await aoRefresh(); }
  catch (e) { alert('删除失败：' + e.message); }
}
// 调整顺序：整组重新编号 1..n，只改有变化的
async function aoMove(kind, key, dir) {
  const list = aoRows.filter(r => r.kind === kind);
  const i = list.findIndex(r => r.key === key), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  try {
    for (let n = 0; n < list.length; n++) {
      if (list[n].sort !== n + 1) await sb(`/rest/v1/app_options?kind=eq.${kind}&key=eq.${encodeURIComponent(list[n].key)}`, 'PATCH', { sort: n + 1 });
    }
    await aoRefresh();
  } catch (e) { alert('调整顺序失败：' + e.message); }
}

// ── 老师编辑页（只有管理员）：职位 / 角色 chips 后面的「＋ 新名称」小文字框 ──
function tfNewOptBox(kind) {
  return `<span style="display:inline-flex;gap:4px;align-items:center"><input id="tf_new_${kind}" placeholder="＋ 新名称" style="width:90px;font-size:11px;padding:3px 6px" onkeydown="if(event.key==='Enter'){event.preventDefault();tfNewOptAdd('${kind}')}"><button type="button" class="btn btn-outline btn-sm" onclick="tfNewOptAdd('${kind}')">添加</button></span>`;
}
async function tfNewOptAdd(kind) {
  if (!isHubAdminUser()) return;
  const el = document.getElementById('tf_new_' + kind); const label = (el && el.value || '').trim(); if (!label) return;
  const list = kind === 'teacher_position' ? TEACHER_POSITIONS : TEACHER_ROLES;
  let key = (list.find(x => x[1] === label) || [])[0];
  if (key) { const it = list.find(x => x[0] === key); if (it[2] === false) { alert('「' + label + '」已存在但被停用了，请先在「⚙ 选项设置」里启用'); return; } }
  else {
    try { key = (await aoCreate(kind, label)).key; await loadAppOptions(); }
    catch (e) { alert('添加失败：' + e.message); return; }
  }
  el.value = '';
  const prev = tfRoleState();
  if (kind === 'teacher_position') { if (tsecCurType() !== '正社员') return; _tfPos = key; }
  else if (!_tfRoles.includes(key)) _tfRoles.push(key);
  tfRolesChanged(prev);
}
