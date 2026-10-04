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
  groups.push({ key: '', label: '未分配职能（执行人待定）', list: tkTpl.filter(t => !t.role || !TASK_ROLE_LABEL[t.role]) });
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
      ${tag(feat ? '跟功能走：' + tkE(t.requires_label || t.requires || '—') : '跟职能走：' + tkE(TASK_ROLE_LABEL[t.role] || t.role_tag || '未分配'), feat ? 'background:var(--accent);color:#fff' : 'border:1px solid var(--accent);color:var(--accent)')}
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
      <div>${tkLbl('任务从哪里来')}<select onchange="tkSet('assign_by',this.value)" style="${TK_INP}">${opt('role', '跟职能走（按老师的职能标签）', d.assign_by)}${opt('feature', '跟功能走（开了对应功能就出现）', d.assign_by)}</select></div>
      <div>${tkLbl('职能')}<select onchange="tkSet('role',this.value)" style="${TK_INP}">${opt('', '未分配', d.role || '')}${TASK_ROLES.map(r => opt(r.key, r.label, d.role || '')).join('')}</select></div>
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

// ── 本月进度：按职能 → 人；自动任务的数字在 PR ② 接入检测模块后显示 ──
async function tkRenderProg() {
  const main = document.getElementById('tkMain');
  const now = new Date();
  const periods = [-1, 0, 1].map(d => taskPeriod(new Date(now.getFullYear(), now.getMonth() + d, 1)));
  if (!tkProgPeriod) tkProgPeriod = periods[1];
  main.innerHTML = '<div style="padding:20px;color:var(--text-3);font-size:12px">加载中…</div>';
  try {
    const [teachers, done] = await Promise.all([
      sbAll('/rest/v1/teachers?select=id,name,tags,permissions,domains,managed_by,majors,staff_type&order=name.asc'),
      sbAll(`/rest/v1/task_done?period=eq.${tkProgPeriod}&select=*`),
    ]);
    tkProg = { teachers, done };
  } catch (e) { main.innerHTML = `<div class="empty">加载失败：${tkE(e.message)}</div>`; return; }
  const month = parseInt(tkProgPeriod.slice(5), 10);
  const doneKey = new Set(tkProg.done.map(x => x.template_id + '|' + x.teacher_id));
  const rows = tkProg.teachers.map(t => ({ t, tasks: taskApplicable(t, tkTpl, month), missing: taskMissingFeatures(t, tkTpl) }))
    .filter(r => r.tasks.length || r.missing.length);
  const section = (label, list) => !list.length ? '' : `<div style="margin-bottom:14px">
    <div style="font-size:12px;font-weight:600;margin-bottom:6px">${tkE(label)} <span class="badge-count">${list.length}</span></div>
    ${list.map(r => tkProgRow(r, doneKey)).join('')}</div>`;
  const tagOf = k => TASK_ROLE_LABEL[k];
  const used = new Set();
  const byRole = TASK_ROLES.map(role => {
    const list = rows.filter(r => (r.t.tags || []).includes(tagOf(role.key))); list.forEach(r => used.add(r.t.id));
    return section(role.label, list);
  }).join('');
  const rest = section('只有功能任务（没有职能标签）', rows.filter(r => !used.has(r.t.id)));
  main.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <select onchange="tkProgPeriod=this.value;tkRenderProg()" style="font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">${periods.map(p => `<option value="${p}"${p === tkProgPeriod ? ' selected' : ''}>${p}</option>`).join('')}</select>
      <span style="font-size:10px;color:var(--text-3)">自动任务的当前数字将在老师端「我的任务」上线后一起显示；这里先显示手动完成情况和缺少的功能</span></div>
    ${byRole + rest || '<div class="empty" style="padding:40px">这个月没有分配到任何人的任务（给老师打职能标签，或开启对应功能后会出现）</div>'}`;
}
function tkProgRow(r, doneKey) {
  const t = r.t;
  const chip = x => {
    const ok = doneKey.has(x.tpl.id + '|' + t.id);
    const st = ok ? 'background:var(--ok-bg,#e4f0e8);color:var(--ok,#2a9e6a)' : x.tpl.kind === 'auto' ? 'border:1px dashed var(--border);color:var(--text-3)' : 'border:1px solid var(--warn,#b8860b);color:var(--warn,#b8860b)';
    return `<span title="${tkE(x.tpl.when_text || '')}" style="font-size:10px;border-radius:2px;padding:1px 7px;white-space:nowrap;${st}">${ok ? '✓ ' : ''}${tkE(x.tpl.title)}${x.via === 'feature' ? '（功能）' : ''}</span>`;
  };
  const miss = r.missing.map(m => `<span style="font-size:10px;color:var(--warn,#b8860b)">⚠ 需要开启：${tkE(m.tpl.requires_label || m.tpl.requires)}${m.spot ? ` <a href="javascript:void(0)" onclick="tkGoSetting('${t.id}','${m.spot[0]}','${m.spot[1] || ''}')" style="color:var(--accent)">[去设置]</a>` : ''}</span>`).join('<br>');
  return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:7px 10px;margin-bottom:5px;background:var(--surface)">
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span style="font-size:12px;font-weight:600;margin-right:4px">${tkE(t.name)}</span>${r.tasks.map(chip).join('')}</div>
    ${miss ? `<div style="margin-top:4px;line-height:1.7">${miss}</div>` : ''}</div>`;
}
// 「去设置」：打开这位老师的编辑页，展开对应区块、滚动并高亮那一项
async function tkGoSetting(tid, sec, item) {
  await switchConsoleTab('teachers');
  if (typeof openTeacherEdit === 'function') openTeacherEdit(tid, sec, item || null);
}
