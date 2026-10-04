// ══════════════════════════════════
// teacher-tasks.js — 老师端「📋 我的任务」
// 任务来自中枢「任务管理」的模板：跟功能走（开了对应功能就有）+ 跟职能走（老师标签里的职能）
// 自动任务由 shared/task-checks.js 算数字，数字为 0 自动算完成，也可手动「已处理」；手动任务点「✓ 完成」
// 依赖：shared/tasks.js、shared/task-checks.js、teacher.js（teacherData、teacherName）
// ══════════════════════════════════
let tmTemplates = [], tmCalendar = [], tmLoaded = false;
let tmSel = 'cur';              // cur / next（下个月预览）
let tmOpen = new Set();         // 展开的任务
let tmD = null, tmDAt = 0;      // 检测数据缓存（60 秒）
const tmE = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

async function tmLoad() {
  if (tmLoaded) return;
  tmLoaded = true;
  try { tmTemplates = await sbAll('/rest/v1/task_templates?select=*&active=is.true&order=sort_order.asc'); } catch (e) { tmTemplates = []; }
  try { tmCalendar = await sbAll('/rest/v1/task_calendar?select=*&order=sort_order.asc'); } catch (e) { tmCalendar = []; }
}
// 有职能标签，或者有任何「跟功能走」的任务（哪个月都算）就显示这个标签
function tmShowTab() {
  if (!tmTemplates.length || !teacherData) return false;
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].some(m => taskApplicable(teacherData, tmTemplates, m).length > 0);
}
function tmPeriod(sel) {
  const now = new Date(jstToday() + 'T00:00:00');
  const d = new Date(now.getFullYear(), now.getMonth() + (sel === 'next' ? 1 : 0), 1);
  return { period: taskPeriod(d), month: d.getMonth() + 1, label: `${d.getFullYear()}年${d.getMonth() + 1}月` };
}
function tmTaskData() { if (!tmD || Date.now() - tmDAt > 60000) { tmD = taskDataNew(); tmDAt = Date.now(); } return tmD; }
async function tmList(sel) {
  const pi = tmPeriod(sel);
  const done = await sbAll(`/rest/v1/task_done?period=eq.${pi.period}&teacher_id=eq.${encodeURIComponent(teacherData.id)}&select=*`).catch(() => []);
  const list = await taskBuildList(tmTaskData(), teacherData, tmTemplates, pi.month, done);
  list.sort((a, b) => (a.state === 'done') - (b.state === 'done') || (a.tpl.sort_order || 0) - (b.tpl.sort_order || 0));
  return { pi, list };
}

async function renderMyTasks(mc) {
  const pi0 = tmPeriod(tmSel);
  mc.innerHTML = `<div class="loading">检测中…（第一次会稍慢）</div>`;
  let r;
  try { r = await tmList(tmSel); } catch (e) { mc.innerHTML = `<div class="empty" style="padding:30px">加载失败：${tmE(e.message)}</div>`; return; }
  const { pi, list } = r;
  const cal = tmCalendar.filter(c => c.month === pi.month && taskDomainOk(teacherData, c));
  const tracks = [...new Set(cal.map(c => c.track || '其他'))];
  const left = list.filter(x => x.state !== 'done').length;
  const tab = (k, label) => `<button onclick="tmSel='${k}';renderMyTasks(document.getElementById('mainContent'))" style="font-size:11px;padding:5px 16px;border:none;cursor:pointer;font-family:inherit;background:${tmSel === k ? 'var(--accent)' : 'var(--surface)'};color:${tmSel === k ? '#fff' : 'var(--text-2)'}">${label}</button>`;
  mc.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="display:flex;border:1px solid var(--border);border-radius:3px;overflow:hidden">${tab('cur', '本月')}${tab('next', '下个月')}</div>
      <span style="font-size:12px;font-weight:600">${pi.label}</span>
      <span style="font-size:11px;color:var(--text-3)">${list.length ? `共 ${list.length} 项，还有 ${left} 项未完成` : ''}</span>
      <button onclick="tmD=null;renderMyTasks(document.getElementById('mainContent'))" style="margin-left:auto;font-size:11px;padding:4px 12px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer;font-family:inherit">刷新</button>
    </div>
    ${tracks.length ? `<div style="font-size:11px;color:var(--text-2);background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:7px 12px;line-height:1.8">
      ${tracks.map(tr => `<span style="margin-right:14px"><b>${tmE(tr)}</b>：${cal.filter(c => (c.track || '其他') === tr).map(c => tmE(c.title)).join('、')}</span>`).join('')}</div>` : ''}
    ${list.length ? list.map(tmCard).join('') : '<div class="empty" style="padding:40px">这个月没有分配给你的任务</div>'}
  </div>`;
}
function tmCard(x) {
  const t = x.tpl, done = x.state === 'done', open = tmOpen.has(t.id), auto = t.kind === 'auto' && t.check_key;
  const num = auto ? (x.na ? '<span style="font-size:10px;color:var(--text-3)">暂无数据</span>' : x.err ? '<span style="font-size:10px;color:var(--danger)">检测失败</span>' : `<span style="font-size:12px;font-weight:700;color:${x.count ? 'var(--warn,#b8860b)' : 'var(--ok,#2a9e6a)'}">${x.count}</span>`) : '';
  const badge = done ? (x.rec ? `<span style="font-size:10px;color:var(--ok,#2a9e6a)">✓ 已处理 ${tmE(String(x.rec.done_at || '').slice(0, 10))}</span>` : '<span style="font-size:10px;color:var(--ok,#2a9e6a)">✓ 无需处理</span>') : '';
  const id = tmE(t.id).replace(/'/g, "\\'");
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden;${done ? 'opacity:.6' : ''}">
    <div onclick="tmTaskToggle('${id}')" style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;${open ? 'background:var(--bg)' : ''}">
      <span style="font-size:10px;color:var(--text-3)">${open ? '▾' : '▸'}</span>
      <span style="font-size:12px;font-weight:600;${done ? 'text-decoration:line-through' : ''}">${tmE(t.title)}</span>
      ${num}${badge}
      <span style="font-size:10px;color:var(--text-3);margin-left:auto;white-space:nowrap">${tmE(t.when_text || '')}</span>
    </div>
    ${open ? `<div style="padding:8px 12px;border-top:1px solid var(--border-light)">
      ${t.detail ? `<div style="font-size:11px;color:var(--text-2);margin-bottom:6px">${tmE(t.detail)}</div>` : ''}
      <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">${t.link ? '位置：' + tmE(t.link) + '　' : ''}${t.collab ? '配合：' + tmE(t.collab) : ''}${x.via === 'feature' ? '　（来自你开通的功能）' : ''}</div>
      ${auto && !x.na ? `<div style="margin-bottom:8px;max-height:260px;overflow:auto">${taskItemsHtml(x.items)}</div>` : ''}
      ${x.rec && x.rec.note ? `<div style="font-size:11px;color:var(--text-2);margin-bottom:6px">备注：${tmE(x.rec.note)}</div>` : ''}
      ${tmSel === 'next' ? '' : (x.rec ? `<button class="btn btn-outline btn-sm" onclick="tmUndo('${id}')">撤销</button>`
        : (auto && x.count === 0 ? '' : `<button class="btn btn-primary btn-sm" onclick="tmDone('${id}')">${auto ? '已处理' : '✓ 完成'}</button>`))}
    </div>` : ''}
  </div>`;
}
function tmTaskToggle(id) { if (tmOpen.has(id)) tmOpen.delete(id); else tmOpen.add(id); renderMyTasks(document.getElementById('mainContent')); }
async function tmDone(tplId) {
  const note = prompt('备注（可留空）：');
  if (note === null) return;
  const pi = tmPeriod('cur'), rec = { template_id: tplId, period: pi.period, teacher_id: teacherData.id, note: note.trim() || null, done_at: new Date().toISOString() };
  const id = `${tplId}|${pi.period}|${teacherData.id}`;
  try {
    const upd = await sb(`/rest/v1/task_done?id=eq.${encodeURIComponent(id)}`, 'PATCH', rec);
    if (!upd || !upd.length) await sb('/rest/v1/task_done', 'POST', [Object.assign({ id }, rec)]);
  } catch (e) { alert('保存失败：' + e.message); return; }
  renderMyTasks(document.getElementById('mainContent'));
}
async function tmUndo(tplId) {
  const pi = tmPeriod('cur');
  try { await sb(`/rest/v1/task_done?id=eq.${encodeURIComponent(`${tplId}|${pi.period}|${teacherData.id}`)}`, 'DELETE'); } catch (e) { alert('操作失败：' + e.message); return; }
  renderMyTasks(document.getElementById('mainContent'));
}
// 「⚡ 待处理」页顶部：本月任务还有 N 项未完成 →
async function tmTodoLine() {
  const box = document.getElementById('tmTodoLine');
  if (!box) return;
  if (!tmShowTab()) { tmTodoOkShow(false); return; }
  try {
    const { list } = await tmList('cur');
    const left = list.filter(x => x.state !== 'done').length;
    const el = document.getElementById('tmTodoLine'); if (!el) return;
    tmTodoOkShow(true, left);
    el.innerHTML = left ? `<div onclick="switchTab('mytasks')" style="cursor:pointer;background:#fff8e6;border:1px solid #e8d4a0;border-radius:4px;padding:10px 14px;font-size:12px;color:var(--warn,#b8860b)">本月任务：还有 ${left} 项未完成 →</div>` : '';
  } catch (e) { tmTodoOkShow(false); }
}
