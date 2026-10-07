// ══════════════════════════════════
// tasks.js — 中枢 → 📋 任务管理（只有管理员能进、能改）
// 三个子页：任务模板 / 年度节点 / 本月进度
// 三张表：task_templates 任务模板 / task_calendar 年度节点 / task_done 完成记录（建表 SQL：seed/task_management_tables.sql）
// 初始数据：seed/task_templates_seed.json（顶部「📥 导入初始模板」，按 id，已有的不覆盖）
// 依赖：shared/tasks.js、shared/constants.js、shared/supabase.js、admin.js（escTM、switchConsoleTab、openTeacherEdit）
// ══════════════════════════════════
let tkTpl = [], tkCal = [], tkBody = null;
let tkSub = 'tpl';                  // tpl / cal / prog
let tkOpenRoles = new Set();        // 展开的职能分组
let tkDraft = null;                 // 正在编辑的模板
let tkProg = null;                  // 本月进度的数据 { teachers, done }
let tkProgPeriod = '';              // 进度看的月份 YYYY-MM
const tkE = v => escTM(v);
const tkIsAdmin = () => typeof ACCESS_KEY === 'undefined' || !ACCESS_KEY || !!ACCESS_KEY.is_admin;
const TK_INP = 'width:100%;box-sizing:border-box;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
const tkLbl = t => `<label style="font-size:10px;color:var(--text-3);display:block;margin:8px 0 2px">${t}</label>`;
const TK_DEFAULT_DOMAIN = '大学院文科';

async function tkMount(body) {
  tkBody = body;
  if (!tkIsAdmin()) { body.innerHTML = '<div class="empty" style="padding:40px">只有管理员可以维护任务模板</div>'; return; }
  body.innerHTML = '<div style="padding:20px;color:var(--text-3);font-size:12px">加载中…</div>';
  try {
    [tkTpl, tkCal] = await Promise.all([
      sbAll('/rest/v1/task_templates?select=*&order=sort_order.asc'),
      sbAll('/rest/v1/task_calendar?select=*&order=sort_order.asc'),
    ]);
  } catch (e) {
    body.innerHTML = `<div class="empty">加载失败：${tkE(e.message)}<br><span style="font-size:11px">（如果提示表不存在，请先执行 seed/task_management_tables.sql）</span></div>`;
    return;
  }
  tkProg = null; tkRender();
}

function tkRender() {
  const box = tkBody; if (!box) return;
  const tab = (k, label) => `<button onclick="tkSub='${k}';tkRender()" style="font-size:11px;padding:5px 16px;border:none;cursor:pointer;font-family:inherit;background:${tkSub === k ? 'var(--accent)' : 'var(--surface)'};color:${tkSub === k ? '#fff' : 'var(--text-2)'}">${label}</button>`;
  box.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div style="display:flex;border:1px solid var(--border);border-radius:3px;overflow:hidden">${tab('tpl', '任务模板')}${tab('cal', '年度节点')}${tab('prog', '本月进度')}</div>
      <span style="font-size:10px;color:var(--text-3)">${tkTpl.length} 条任务模板 · ${tkCal.length} 条年度节点</span>
      <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="tkImportSeed()">📥 导入初始模板</button>
    </div><div id="tkMain"></div>`;
  if (tkSub === 'tpl') tkRenderTpl();
  else if (tkSub === 'cal') tkRenderCal();
  else tkRenderProg();
}

// ── 导入初始模板（按 id，已有的不覆盖）──
async function tkImportSeed() {
  if (!confirm('从 seed/task_templates_seed.json 导入任务模板和年度节点？\n已经存在的（按 id）不会被覆盖，只补缺的。')) return;
  try {
    const r = await fetch('../seed/task_templates_seed.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('读取初始模板失败（' + r.status + '）');
    const seed = await r.json();
    const roleLabel = Object.fromEntries((seed.roles || []).map(x => [x.key, x.label]));
    const haveT = new Set(tkTpl.map(x => x.id)), haveC = new Set(tkCal.map(x => x.id));
    const nz = v => (v === '' || v === undefined ? null : v);
    const newT = (seed.templates || []).filter(t => !haveT.has(t.id)).map((t, i) => ({
      id: t.id, title: t.title, detail: nz(t.detail), role: nz(t.role), role_tag: nz(t.role_tag) || nz(roleLabel[t.role]),
      assign_by: t.assign_by || 'role', requires: nz(t.requires), requires_label: nz(t.requires_label), kind: t.kind,
      months: t.months || [], when_text: nz(t.when), check_key: nz(t.check), link: nz(t.link), collab: nz(t.collab),
      domain: nz(t.domain), source: nz(t.source), active: true, sort_order: (tkTpl.length + i + 1) * 10,
    }));
    const newC = (seed.calendar || []).map((c, i) => ({ id: 'cal_' + String(i + 1).padStart(3, '0'), month: c.month, track: c.track, title: c.title, domain: nz(c.domain), sort_order: i + 1 }))
      .filter(c => !haveC.has(c.id));
    if (newT.length) await sb('/rest/v1/task_templates', 'POST', newT);
    if (newC.length) await sb('/rest/v1/task_calendar', 'POST', newC);
    await tkMount(tkBody);
    alert(`导入完成：新增任务模板 ${newT.length} 条、年度节点 ${newC.length} 条（已有的没动）。`);
  } catch (e) { alert('导入失败：' + e.message); }
}

// ── 任务模板 ──
function tkRenderTpl() {
  const main = document.getElementById('tkMain');
  const groups = TASK_ROLES.map(r => ({ key: r.key, label: r.label, list: tkTpl.filter(t => t.role === r.key) }));
  groups.push({ key: '', label: '未分配角色（执行人待定）', list: tkTpl.filter(t => !t.role || !TASK_ROLE_LABEL[t.role]) });
  main.innerHTML = `<div style="display:flex;margin-bottom:8px"><button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="tkEditOpen('')">＋ 新增任务模板</button></div>` +
    groups.map(g => {
      const open = tkOpenRoles.has(g.key);
      return `<div style="border:1px solid var(--border);border-radius:4px;margin-bottom:8px;background:var(--surface);overflow:hidden">
        <div onclick="tkToggleRole('${g.key}')" style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;${open ? 'background:var(--bg)' : ''}">
          <span style="font-size:10px;color:var(--text-3)">${open ? '▾' : '▸'}</span>
          <span style="font-size:13px;font-weight:600">${tkE(g.label)}</span>
          <span class="badge-count">${g.list.length}</span>
        </div>
        ${open ? `<div style="padding:8px 12px">${g.list.length ? g.list.map((t, i) => tkTplRow(t, i, g.list.length)).join('') : '<div style="font-size:11px;color:var(--text-3);padding:6px">这个职能下还没有任务</div>'}</div>` : ''}
      </div>`;
    }).join('');
}
function tkToggleRole(k) { if (tkOpenRoles.has(k)) tkOpenRoles.delete(k); else tkOpenRoles.add(k); tkRenderTpl(); }
function tkMonthsText(ms) {
  ms = [...(ms || [])].sort((a, b) => a - b);
  if (ms.length === 12) return '每月';
  return ms.map(m => m + '月').join(' ') || '—';
}
function tkTplRow(t, i, n) {
  const feat = t.assign_by === 'feature';
  const off = t.active === false;
  const tag = (txt, color) => `<span style="font-size:10px;border-radius:2px;padding:0 6px;white-space:nowrap;${color}">${txt}</span>`;
  return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:8px 10px;margin-bottom:6px;${off ? 'opacity:.55' : ''}">
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:600">${tkE(t.title)}</span>
      ${tag(t.kind === 'auto' ? '自动' : '手动', t.kind === 'auto' ? 'background:var(--ok-bg,#e4f0e8);color:var(--ok,#2a9e6a)' : 'border:1px solid var(--border);color:var(--text-2)')}
      ${tag(feat ? '跟功能走：' + tkE(t.requires_label || t.requires || '—') : '跟角色走：' + tkE(TASK_ROLE_LABEL[t.role] || t.role_tag || '未分配'), feat ? 'background:var(--accent);color:#fff' : 'border:1px solid var(--accent);color:var(--accent)')}
      ${t.domain ? tag(tkE(t.domain), 'border:1px solid var(--border);color:var(--text-3)') : ''}
      <span style="margin-left:auto;display:flex;gap:4px;align-items:center">
        <span onclick="tkToggleActive('${t.id}')" title="点击切换" style="cursor:pointer;user-select:none;font-size:9px;border-radius:2px;padding:1px 8px;${off ? 'background:var(--bg);color:var(--text-3);border:1px dashed var(--border)' : 'background:var(--ok-bg,#e4f0e8);color:var(--ok,#2a9e6a)'}">${off ? '已停用' : '启用'}</span>
        <button class="btn btn-outline btn-sm" onclick="tkMove('${t.id}',-1)" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn btn-outline btn-sm" onclick="tkMove('${t.id}',1)" ${i === n - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn btn-outline btn-sm" onclick="tkEditOpen('${t.id}')">✏ 编辑</button>
        <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="tkDelete('${t.id}')">删除</button>
      </span>
    </div>
    <div style="font-size:10px;color:var(--text-3);margin-top:4px;line-height:1.6">
      ${tkE(tkMonthsText(t.months))}${t.when_text ? ' · ' + tkE(t.when_text) : ''}${t.check_key ? ' · 检测：' + tkE(t.check_key) : ''}${t.link ? ' · 跳转：' + tkE(t.link) : ''}${t.collab ? ' · 配合：' + tkE(t.collab) : ''}
      ${t.detail ? `<div style="color:var(--text-2)">${tkE(t.detail)}</div>` : ''}
    </div></div>`;
}
async function tkToggleActive(id) {
  const t = tkTpl.find(x => x.id === id); if (!t) return;
  const v = t.active === false;
  try { await sb(`/rest/v1/task_templates?id=eq.${encodeURIComponent(id)}`, 'PATCH', { active: v }); t.active = v; tkRenderTpl(); }
  catch (e) { alert('操作失败：' + e.message); }
}
async function tkMove(id, dir) {
  const t = tkTpl.find(x => x.id === id); if (!t) return;
  const grp = tkTpl.filter(x => (x.role || '') === (t.role || '')).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const i = grp.findIndex(x => x.id === id), j = i + dir;
  if (j < 0 || j >= grp.length) return;
  const a = grp[i], b = grp[j];
  let sa = a.sort_order || 0, sb2 = b.sort_order || 0;
  if (sa === sb2) { sa = (i + 1) * 10; sb2 = (j + 1) * 10; }
  try {
    await Promise.all([
      sb(`/rest/v1/task_templates?id=eq.${encodeURIComponent(a.id)}`, 'PATCH', { sort_order: sb2 }),
      sb(`/rest/v1/task_templates?id=eq.${encodeURIComponent(b.id)}`, 'PATCH', { sort_order: sa }),
    ]);
    a.sort_order = sb2; b.sort_order = sa;
    tkTpl.sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0));
    tkRenderTpl();
  } catch (e) { alert('排序失败：' + e.message); }
}
async function tkDelete(id) {
  const t = tkTpl.find(x => x.id === id); if (!t) return;
  if (!confirm(`删除任务模板「${t.title}」？\n（只想暂时不用的话，点「启用」切成停用更稳妥。已有的完成记录不会被删。）`)) return;
  try { await sb(`/rest/v1/task_templates?id=eq.${encodeURIComponent(id)}`, 'DELETE'); tkTpl = tkTpl.filter(x => x.id !== id); tkRenderTpl(); }
  catch (e) { alert('删除失败：' + e.message); }
}

// ── 编辑 / 新增模板（弹窗）──
function tkEditOpen(id) {
  const t = id ? tkTpl.find(x => x.id === id) : null;
  tkDraft = t ? { ...t, months: [...(t.months || [])] }
    : { id: '', title: '', detail: '', role: '', assign_by: 'role', requires: '', requires_label: '', kind: 'manual', months: [], when_text: '', check_key: '', link: '', collab: '', domain: TK_DEFAULT_DOMAIN, active: true, sort_order: (tkTpl.length + 1) * 10 };
  let ov = document.getElementById('tkEditModal');
  if (!ov) { ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'tkEditModal'; ov.style.zIndex = '1000'; document.body.appendChild(ov); }
  ov.classList.add('open'); tkEditRender();
}
function tkEditClose() { const ov = document.getElementById('tkEditModal'); if (ov) ov.classList.remove('open'); tkDraft = null; }
function tkCapture() {
  const d = tkDraft; if (!d) return;
  const v = id => (document.getElementById(id) || {}).value;
  ['title', 'detail', 'when_text', 'link', 'collab', 'requires', 'requires_label'].forEach(k => { const x = v('tk_' + k); if (x !== undefined) d[k] = x; });
}
function tkSet(k, v) { tkCapture(); tkDraft[k] = v; tkEditRender(); }
function tkToggleMonth(m) {
  tkCapture(); const a = tkDraft.months, i = a.indexOf(m); if (i >= 0) a.splice(i, 1); else a.push(m);
  tkEditRender();
}
function tkEditRender() {
  const ov = document.getElementById('tkEditModal'), d = tkDraft; if (!ov || !d) return;
  const opt = (v, label, cur) => `<option value="${tkE(v)}"${cur === v ? ' selected' : ''}>${tkE(label)}</option>`;
  const feat = d.assign_by === 'feature';
  ov.innerHTML = `<div class="modal" style="width:620px;max-height:90vh;overflow:auto">
    <div class="modal-title">${d.id ? '编辑任务模板' : '新增任务模板'}</div>
    ${tkLbl('标题 *')}<input id="tk_title" value="${tkE(d.title)}" style="${TK_INP}">
    ${tkLbl('说明')}<textarea id="tk_detail" rows="2" style="${TK_INP}">${tkE(d.detail || '')}</textarea>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>${tkLbl('任务从哪里来')}<select onchange="tkSet('assign_by',this.value)" style="${TK_INP}">${opt('role', '跟角色走（按老师的管理职位 / 执行角色）', d.assign_by)}${opt('feature', '跟功能走（开了对应功能就出现）', d.assign_by)}</select></div>
      <div>${tkLbl('角色')}<select onchange="tkSet('role',this.value)" style="${TK_INP}">${opt('', '未分配', d.role || '')}${TASK_ROLES.map(r => opt(r.key, r.label, d.role || '')).join('')}</select></div>
    </div>
    ${feat ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>${tkLbl('对应功能的权限代号（如 homework、records_entry、tag:专业课老师）')}<input id="tk_requires" value="${tkE(d.requires || '')}" style="${TK_INP}"></div>
      <div>${tkLbl('功能显示名')}<input id="tk_requires_label" value="${tkE(d.requires_label || '')}" style="${TK_INP}"></div></div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>${tkLbl('完成方式')}<select onchange="tkSet('kind',this.value)" style="${TK_INP}">${opt('manual', '手动（点完成）', d.kind)}${opt('auto', '自动（系统算数字）', d.kind)}</select></div>
      <div>${tkLbl('自动检测')}<select onchange="tkSet('check_key',this.value)" style="${TK_INP}">${opt('', '无', d.check_key || '')}${TASK_CHECKS.map(c => opt(c[0], c[0] + ' — ' + c[1], d.check_key || '')).join('')}</select></div>
    </div>
    ${tkLbl('出现的月份')}<div style="display:flex;gap:5px;flex-wrap:wrap">${TASK_MONTH_ORDER.map(m => `<div class="filter-chip${d.months.includes(m) ? ' active' : ''}" onclick="tkToggleMonth(${m})" style="padding:3px 10px;font-size:11px">${m}月</div>`).join('')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>${tkLbl('时间说明（如：每月 30 日前）')}<input id="tk_when_text" value="${tkE(d.when_text || '')}" style="${TK_INP}"></div>
      <div>${tkLbl('点击跳转到（页面 / 板块）')}<input id="tk_link" value="${tkE(d.link || '')}" style="${TK_INP}"></div>
      <div>${tkLbl('配合者')}<input id="tk_collab" value="${tkE(d.collab || '')}" style="${TK_INP}"></div>
      <div>${tkLbl('适用领域')}<select onchange="tkSet('domain',this.value)" style="${TK_INP}">${opt('', '全部领域', d.domain || '')}${DOMAINS.map(x => opt(x.label, x.label, d.domain || '')).join('')}</select></div>
    </div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="tkEditClose()">取消</button><button class="btn btn-primary" onclick="tkEditSave()">保存</button></div>
  </div>`;
}
async function tkEditSave() {
  tkCapture(); const d = tkDraft; if (!d) return;
  if (!d.title.trim()) { alert('请填写标题'); return; }
  if (!d.months.length) { alert('请至少选一个月份'); return; }
  const feat = d.assign_by === 'feature';
  if (feat && !(d.requires || '').trim()) { alert('跟功能走的任务需要填「对应功能的权限代号」'); return; }
  const nz = v => (v == null || String(v).trim() === '' ? null : String(v).trim());
  const rec = {
    title: d.title.trim(), detail: nz(d.detail), role: nz(d.role), role_tag: d.role ? TASK_ROLE_LABEL[d.role] : null,
    assign_by: d.assign_by, requires: feat ? nz(d.requires) : null, requires_label: feat ? nz(d.requires_label) : null,
    kind: d.kind, months: [...d.months].sort((a, b) => a - b), when_text: nz(d.when_text), check_key: d.kind === 'auto' ? nz(d.check_key) : null,
    link: nz(d.link), collab: nz(d.collab), domain: nz(d.domain),
  };
  try {
    if (d.id) {
      await sb(`/rest/v1/task_templates?id=eq.${encodeURIComponent(d.id)}`, 'PATCH', rec);
      Object.assign(tkTpl.find(x => x.id === d.id) || {}, rec);
    } else {
      const row = Object.assign({ id: 'X' + Date.now().toString(36), source: '中枢新增', active: true, sort_order: d.sort_order }, rec);
      await sb('/rest/v1/task_templates', 'POST', [row]); tkTpl.push(row);
    }
    if (rec.role) tkOpenRoles.add(rec.role); else tkOpenRoles.add('');
    tkEditClose(); tkRenderTpl();
  } catch (e) { alert('保存失败：' + e.message); }
}

// ── 年度节点（和《工作节点》表一样：行 = 类别，列 = 月份，学年 4 月起）──
function tkRenderCal() {
  const main = document.getElementById('tkMain');
  const tracks = [...new Set(tkCal.map(c => c.track || '其他'))];
  const th = 'font-size:11px;padding:6px 8px;border:1px solid var(--border-light);background:var(--bg);white-space:nowrap';
  main.innerHTML = `<div style="font-size:10px;color:var(--text-3);margin-bottom:6px">点节点名可修改 / 删除；格子右下角「＋」新增。年度节点只显示，不需要完成。</div>
    <div style="overflow-x:auto"><table style="border-collapse:collapse;min-width:900px;width:100%">
    <tr><th style="${th}">类别</th>${TASK_MONTH_ORDER.map(m => `<th style="${th}">${m}月</th>`).join('')}</tr>
    ${tracks.map(tr => `<tr><th style="${th}">${tkE(tr)}</th>${TASK_MONTH_ORDER.map(m => {
      const items = tkCal.filter(c => (c.track || '其他') === tr && c.month === m);
      return `<td style="font-size:11px;padding:5px 6px;border:1px solid var(--border-light);vertical-align:top;background:var(--surface)">
        ${items.map(c => `<div onclick="tkCalEdit('${c.id}')" style="cursor:pointer;margin-bottom:3px;padding:1px 4px;border-radius:2px;background:var(--bg)">${tkE(c.title)}</div>`).join('')}
        <div onclick="tkCalAdd('${tkE(tr).replace(/'/g, "\\'")}',${m})" style="cursor:pointer;color:var(--text-3);text-align:right;font-size:10px">＋</div></td>`;
    }).join('')}</tr>`).join('')}
    </table></div>
    <div style="margin-top:10px"><button class="btn btn-outline btn-sm" onclick="tkCalAddTrack()">＋ 新增类别</button></div>`;
}
async function tkCalAdd(track, month) {
  const title = prompt(`新增节点（${track} · ${month}月）：`); if (!title || !title.trim()) return;
  const row = { id: 'cal_' + Date.now().toString(36), month, track, title: title.trim(), domain: TK_DEFAULT_DOMAIN, sort_order: tkCal.length + 1 };
  try { await sb('/rest/v1/task_calendar', 'POST', [row]); tkCal.push(row); tkRenderCal(); } catch (e) { alert('保存失败：' + e.message); }
}
async function tkCalAddTrack() {
  const track = prompt('新类别名称（如：出愿 / 语学 / 宣传）：'); if (!track || !track.trim()) return;
  const m = parseInt(prompt('先在哪个月加第一个节点？（填 1–12）', '4'), 10);
  if (!(m >= 1 && m <= 12)) { alert('月份要填 1–12'); return; }
  await tkCalAdd(track.trim(), m);
}
async function tkCalEdit(id) {
  const c = tkCal.find(x => x.id === id); if (!c) return;
  const v = prompt(`修改节点名称（${c.track || ''} · ${c.month}月）\n留空并确定 = 删除这个节点：`, c.title);
  if (v === null) return;
  try {
    if (!v.trim()) {
      if (!confirm(`删除节点「${c.title}」？`)) return;
      await sb(`/rest/v1/task_calendar?id=eq.${encodeURIComponent(id)}`, 'DELETE'); tkCal = tkCal.filter(x => x.id !== id);
    } else { await sb(`/rest/v1/task_calendar?id=eq.${encodeURIComponent(id)}`, 'PATCH', { title: v.trim() }); c.title = v.trim(); }
    tkRenderCal();
  } catch (e) { alert('保存失败：' + e.message); }
}

// ── 本月进度 / 团队进度：人 × 任务；自动任务显示当前数字（shared/task-checks.js），手动任务显示是否完成 ──
let tkTeamShown = 30;   // 团队进度每次显示 30 人，底部「显示更多」
let tkTeamPeriod = '', tkTeamRole = '', tkTeamQ = '', tkTeamRes = {}, tkTeamBox = null, tkTeamTeachers = [], tkTeamD = null;
function tkRenderProg() { return tkTeamMount(document.getElementById('tkMain'), null); }
// 管理端「📋 任务」页：自己范围内的老师（管理员 = 全部；负责人 / 领域链接 = 范围内）
async function tkRenderTeamPage(mc) {
  mc.innerHTML = '<div class="section-title" style="margin-bottom:12px">任务安排</div><div id="tkTeamHost"></div>';
  await tkTeamMount(document.getElementById('tkTeamHost'), t => typeof teacherInView !== 'function' || teacherInView(t));
}
async function tkTeamMount(box, teacherFilter) {
  tkTeamBox = box; tkTeamFilterFn = teacherFilter; tkTeamShown = 30;
  box.innerHTML = '<div style="padding:20px;color:var(--text-3);font-size:12px">加载中…</div>';
  const now = new Date();
  const periods = [-1, 0, 1].map(d => taskPeriod(new Date(now.getFullYear(), now.getMonth() + d, 1)));
  if (!tkTeamPeriod) tkTeamPeriod = periods[1];
  try {
    const [teachers, tpls, done] = await Promise.all([
      sbAll('/rest/v1/teachers?select=*&order=name.asc'),
      sbAll('/rest/v1/task_templates?select=*&active=is.true&order=sort_order.asc'),
      sbAll(`/rest/v1/task_done?period=eq.${tkTeamPeriod}&select=*`),
    ]);
    tkTeamTeachers = teacherFilter ? teachers.filter(teacherFilter) : teachers;
    tkTeamTpl = tpls; tkTeamDone = done;
  } catch (e) { box.innerHTML = `<div class="empty">加载失败：${tkE(e.message)}<br><span style="font-size:11px">（如果提示表不存在，请先执行 seed/task_management_tables.sql）</span></div>`; return; }
  tkTeamD = taskDataNew(); tkTeamRes = {};
  return tkTeamDraw(periods, true);
}
let tkTeamTpl = [], tkTeamDone = [];
async function tkTeamDraw(periods, compute) {
  const box = tkTeamBox; if (!box) return;
  const month = parseInt(tkTeamPeriod.slice(5), 10);
  if (compute) {
    box.innerHTML = '<div style="padding:20px;color:var(--text-3);font-size:12px">检测中…（人多时稍慢）</div>';
    const cand = tkTeamTeachers.filter(t => taskApplicable(t, tkTeamTpl, month).length || taskMissingFeatures(t, tkTeamTpl).length);
    await Promise.all(cand.map(async t => { tkTeamRes[t.id] = await taskBuildList(tkTeamD, t, tkTeamTpl, month, tkTeamDone); }));
  }
  const q = tkTeamQ.trim();
  let rows = tkTeamTeachers.filter(t => tkTeamRes[t.id] !== undefined || taskMissingFeatures(t, tkTeamTpl).length)
    .filter(t => !tkTeamRole || taskTeacherHasRole(t, tkTeamRole)).filter(t => !q || (t.name || '').includes(q));
  const sel = `font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit`;
  box.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <select onchange="tkTeamPeriod=this.value;tkTeamMount(tkTeamBox,tkTeamFilterFn)" style="${sel}">${periods.map(p => `<option value="${p}"${p === tkTeamPeriod ? ' selected' : ''}>${p}</option>`).join('')}</select>
      <select onchange="tkTeamRole=this.value;tkTeamShown=30;tkTeamDraw(null,false)" style="${sel}"><option value="">全部角色</option>${TASK_ROLES.map(r => `<option value="${r.key}"${tkTeamRole === r.key ? ' selected' : ''}>${r.label}</option>`).join('')}</select>
      <input placeholder="搜索老师…" value="${tkE(tkTeamQ)}" oninput="tkTeamQ=this.value;tkTeamShown=30;tkTeamDraw(null,false)" style="${sel};min-width:140px">
      <span style="font-size:10px;color:var(--text-3)">自动任务显示当前数字（0 = 完成）；点任务看名单；✓ = 已处理</span>
      <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="tkTeamMount(tkTeamBox,tkTeamFilterFn)">刷新</button></div>
    ${rows.length ? `<div style="font-size:10px;color:var(--text-3);margin-bottom:6px">共 ${rows.length} 人</div>` + rows.slice(0, tkTeamShown).map(tkTeamRow).join('') + (rows.length > tkTeamShown ? `<div style="text-align:center;margin-top:8px"><button class="btn btn-outline btn-sm" onclick="tkTeamShown+=30;tkTeamDraw(null,false)">显示更多（还有 ${rows.length - tkTeamShown} 人）</button></div>` : '') : '<div class="empty" style="padding:40px">这个月没有分配到任何人的任务（给老师打职能标签，或开启对应功能后会出现）</div>'}`;
}
let tkTeamFilterFn = null;
function tkTeamRow(t) {
  const list = tkTeamRes[t.id] || [];
  const nDone = list.filter(x => x.state === 'done').length;
  const chip = x => {
    const done = x.state === 'done', auto = x.tpl.kind === 'auto' && x.tpl.check_key;
    const st = done ? 'background:var(--ok-bg,#e4f0e8);color:var(--ok,#2a9e6a)' : 'border:1px solid var(--warn,#b8860b);color:var(--warn,#b8860b)';
    const tail = auto && !x.na ? (x.count ? ` ${x.count}` : '') : '';
    return `<span onclick="tkTeamShow('${t.id}','${x.tpl.id}')" title="${tkE(x.tpl.when_text || '')}" style="cursor:pointer;font-size:10px;border-radius:2px;padding:1px 7px;white-space:nowrap;${st}">${done ? '✓ ' : ''}${tkE(x.tpl.title)}${tail}${x.via === 'feature' ? '（功能）' : ''}</span>`;
  };
  const miss = taskMissingFeatures(t, tkTeamTpl).map(m => `<span style="font-size:10px;color:var(--warn,#b8860b)">⚠ 需要开启：${tkE(m.tpl.requires_label || m.tpl.requires)}${m.spot && tkIsAdmin() ? ` <a href="javascript:void(0)" onclick="tkGoSetting('${t.id}','${m.spot[0]}','${m.spot[1] || ''}')" style="color:var(--accent)">[去设置]</a>` : ''}</span>`).join('<br>');
  return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:7px 10px;margin-bottom:5px;background:var(--surface)">
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span style="font-size:12px;font-weight:600;margin-right:2px">${tkE(t.name)}</span>
      ${TASK_ROLES.filter(r => taskTeacherHasRole(t, r.key)).map(r => r.label).map(g => `<span style="font-size:10px;color:var(--accent);border:1px solid var(--border);border-radius:2px;padding:0 6px">${tkE(g)}</span>`).join('')}
      <span style="font-size:10px;color:var(--text-3);margin-right:4px">${list.length ? `完成 ${nDone}/${list.length}` : ''}</span>${list.map(chip).join('')}</div>
    ${miss ? `<div style="margin-top:4px;line-height:1.7">${miss}</div>` : ''}</div>`;
}
function tkTeamShow(tid, tplId) {
  const x = (tkTeamRes[tid] || []).find(y => y.tpl.id === tplId); if (!x) return;
  const t = tkTeamTeachers.find(y => y.id === tid) || {};
  let ov = document.getElementById('tkItemsModal');
  if (!ov) { ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'tkItemsModal'; ov.style.zIndex = '1000'; document.body.appendChild(ov); }
  // 「讲师介绍完善」：能改的人（管理员 / 管理模式的负责人）走独立的 profSkipOpen 弹窗，老师列表的「介绍 n/m」小标签也用同一个
  const isProf = x.tpl.check_key === 'profile_incomplete';
  if (isProf && profSkipCan() && x.tpl.kind === 'auto' && !x.na) {
    ov.classList.remove('open');
    profSkipOpen(tid, async () => { tkTeamRes[tid] = await taskBuildList(tkTeamD, t, tkTeamTpl, parseInt(tkTeamPeriod.slice(5), 10), tkTeamDone); tkTeamDraw(null, false); });
    return;
  }
  ov.classList.add('open');
  let body;
  if (x.tpl.kind === 'auto' && x.tpl.check_key) {
    if (x.na) body = '<div style="font-size:11px;color:var(--text-3)">系统里暂时没有对应数据</div>';
    else body = taskItemsHtml(x.items);
    
  } else body = '<div style="font-size:11px;color:var(--text-3)">手动任务：由老师自己在「我的任务」里点完成</div>';
  ov.innerHTML = `<div class="modal" style="width:560px;max-height:85vh;overflow:auto">
    <div class="modal-title">${tkE(x.tpl.title)}</div><div class="modal-sub">${tkE(t.name || '')}${x.tpl.when_text ? ' · ' + tkE(x.tpl.when_text) : ''}${x.tpl.detail ? '<br>' + tkE(x.tpl.detail) : ''}</div>
    ${x.rec ? `<div style="font-size:11px;color:var(--ok,#2a9e6a);margin-bottom:6px">✓ 已处理 ${tkE(String(x.rec.done_at || '').slice(0, 10))}${x.rec.note ? '：' + tkE(x.rec.note) : ''}</div>` : ''}
    ${body}
    <div class="modal-actions"><button class="btn btn-outline" onclick="document.getElementById('tkItemsModal').classList.remove('open')">关闭</button></div></div>`;
}
// 「不需要讲师介绍」只有管理员 / 管理模式的负责人能改
function profSkipCan() { return tkIsAdmin() || !!(typeof ACCESS_KEY !== 'undefined' && ACCESS_KEY && ACCESS_KEY._asTeacher); }
function profSkipTeacher(tid) {
  return (typeof cachedTeachers !== 'undefined' && (cachedTeachers || []).find(y => y.id === tid)) || (typeof tkTeamTeachers !== 'undefined' && (tkTeamTeachers || []).find(y => y.id === tid)) || null;
}
let _profSkipAfter = null;
// 讲师介绍状态弹窗（任务明细和老师列表的「介绍 n/m」共用）；onSaved：保存后额外要刷新的东西
async function profSkipOpen(tid, onSaved) {
  const t = profSkipTeacher(tid); if (!t) return;
  if (onSaved !== undefined) _profSkipAfter = onSaved;
  let ov = document.getElementById('profSkipModal');
  if (!ov) { ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'profSkipModal'; ov.style.zIndex = '1001'; document.body.appendChild(ov); }
  ov.classList.add('open');
  let rows = (typeof profBrief !== 'undefined' && profBrief && profBriefOk) ? profBrief : null;
  if (!rows) { ov.innerHTML = '<div class="modal" style="width:560px"><div class="empty" style="padding:30px">加载中…</div></div>'; try { rows = await sbAll('/rest/v1/teacher_profiles?select=id,name,subject,school,keywords,feature,courses'); } catch (e) { rows = []; } }
  const st = teacherProfileStatus(t, rows.filter(r => r.name === t.name));
  const can = profSkipCan();
  const stateTxt = x => x.done ? '✓ 已完成' : x.row ? '缺：' + x.missing.join('、') : '未填';
  let body = st.length ? st.map(x => `<div style="display:flex;gap:8px;align-items:center;padding:4px 6px;border-bottom:1px solid var(--border-light);font-size:11px">
      <span style="font-weight:600">${tkE(x.label)}</span><span style="color:${x.done ? 'var(--ok,#2a9e6a)' : 'var(--text-3)'}">${tkE(stateTxt(x))}</span>
      ${!x.done && can ? `<span onclick="profSkipSave('${tid}','${tkE(x.key)}',true)" style="margin-left:auto;cursor:pointer;color:var(--accent);text-decoration:underline">不需要</span>` : ''}</div>`).join('')
    : '<div style="font-size:11px;color:var(--text-3);padding:4px 0">没有需要填写讲师介绍的专业</div>';
  const all = teacherProfileMajorsAll(t), sk = teacherProfileSkipped(t).filter(k => all.includes(k));
  if (sk.length) body += `<div style="font-size:10px;color:var(--text-3);margin-top:10px">已设为不需要：${sk.map(k => `${tkE(MAJORS[k] || k)}${can ? ` <span onclick="profSkipSave('${tid}','${tkE(k)}',false)" style="cursor:pointer;color:var(--accent);text-decoration:underline">[恢复]</span>` : ''}`).join('、')}</div>`;
  ov.innerHTML = `<div class="modal" style="width:560px;max-height:85vh;overflow:auto">
    <div class="modal-title">讲师介绍</div><div class="modal-sub">${tkE(t.name || '')}</div>${body}
    <div class="modal-actions"><button class="btn btn-outline" onclick="document.getElementById('profSkipModal').classList.remove('open')">关闭</button></div></div>`;
}
// 设为 / 恢复「不需要讲师介绍」：先读这位老师最新的 permissions 再只合并这一个键写回，不覆盖其他内容
async function profSkipSave(tid, key, skip) {
  const t = profSkipTeacher(tid); if (!t) return;
  try {
    const rows = await sb(`/rest/v1/teachers?id=eq.${encodeURIComponent(tid)}&select=permissions`);
    const perms = (rows && rows[0] && rows[0].permissions) || {};
    const cur = Array.isArray(perms.profile_skip_majors) ? perms.profile_skip_majors : [];
    const next = skip ? [...new Set([...cur, key])] : cur.filter(k => k !== key);
    const merged = Object.assign({}, perms, { profile_skip_majors: next });
    const res = await sb(`/rest/v1/teachers?id=eq.${encodeURIComponent(tid)}`, 'PATCH', { permissions: merged });
    if (Array.isArray(res) && !res.length) throw new Error('数据库没有允许修改（0 行被更新）');
    // 各处缓存里的这位老师都同步，免得之后保存老师时用旧的冲掉
    [typeof cachedTeachers !== 'undefined' ? cachedTeachers : null, typeof tkTeamTeachers !== 'undefined' ? tkTeamTeachers : null].forEach(l => { const c = (l || []).find(y => y.id === tid); if (c) c.permissions = merged; });
    if (typeof tkTeamD !== 'undefined' && tkTeamD && tkTeamD.res) Object.keys(tkTeamD.res).forEach(k => { if (k.startsWith(tid + '|profile_incomplete|')) delete tkTeamD.res[k]; });
    if (typeof renderTeacherRows === 'function') renderTeacherRows();
    if (typeof _profSkipAfter === 'function') await _profSkipAfter();
    profSkipOpen(tid);
  } catch (e) { alert('保存失败：' + (e.message || e)); }
}
// 「去设置」：打开这位老师的编辑页，展开对应区块、滚动并高亮那一项
async function tkGoSetting(tid, sec, item) {
  await switchConsoleTab('teachers');
  if (typeof openTeacherEdit === 'function') openTeacherEdit(tid, sec, item || null);
}
