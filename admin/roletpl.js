// ══════════════════════════════════
// roletpl.js — 中枢 → 角色模板（只有管理员能进、能改）
// 一张表：行 = 功能（老师端功能 / 学生管理子项 / 营业功能 / 资源权限），列 = 8 个角色；格子点一下在「默认开 / 不开」之间切换
// 保存到 role_templates 表（建表 SQL：seed/teacher_roles_prepare.sql）。改了模板不会自动改现有老师
// 依赖：admin.js（roleTplEnsure、roleTokens、roleTokenLabel、TF_P_LABEL、TF_SUB_LABEL、escTM）、shared/constants.js
// ══════════════════════════════════
let rtpRows = null, rtpDirty = new Set(), rtpBody = null, rtpDiffOpen = false;
const rtpIsAdmin = () => typeof ACCESS_KEY === 'undefined' || !ACCESS_KEY || !!ACCESS_KEY.is_admin;
const RTP_ROLE_ORDER = ['lead', 'sales', 'liaison', 'soumu', 'soumu_asst', 'senmon', 'ta', 'homeroom'];
// 表的行：[分组, 标记, 名称]
function rtpFeatureRows() {
  const rows = [];
  const P = ['booking', 'slots', 'homework', 'admission_query', 'student_mgmt'];
  P.forEach(k => rows.push(['老师端功能', 'p:' + k, TF_P_LABEL[k]]));
  Object.keys(TF_SUB_LABEL.booking_types).forEach(v => rows.push(['预约类型', 'booking_types:' + v, '预约·' + TF_SUB_LABEL.booking_types[v]]));
  Object.keys(TF_SUB_LABEL.slot_types).forEach(v => rows.push(['时间槽类型', 'slot_types:' + v, '时间槽·' + TF_SUB_LABEL.slot_types[v]]));
  rows.push(['老师端功能', 'schedule:timetable', '仅我的课表']);
  rows.push(['老师端功能', 'schedule:full', '排班确认 + 我的课表']);
  Object.keys(TF_SUB_LABEL.student_mgmt_items).forEach(v => rows.push(['学生管理子项', 'student_mgmt_items:' + v, TF_SUB_LABEL.student_mgmt_items[v]]));
  ['promo', 'progress_plan', 'lect_info', 'vip_sales', 'promo_pack', 'promo_pricing', 'success_cases'].forEach(k => rows.push(['营业功能', 'p:' + k, TF_P_LABEL[k]]));
  RESOURCE_PERM_DEFS.forEach(([c, l]) => rows.push(['资源权限', 'res:' + c, l]));
  return rows;
}
async function rtpMount(body) {
  rtpBody = body;
  if (!rtpIsAdmin()) { body.innerHTML = '<div class="empty" style="padding:40px">只有管理员可以维护角色模板</div>'; return; }
  body.innerHTML = '<div style="padding:20px;color:var(--text-3);font-size:12px">加载中…</div>';
  _roleTpl = null; _roleTplP = null;
  const tpl = await roleTplEnsure();
  rtpRows = RTP_ROLE_ORDER.filter(k => tpl[k]).map(k => JSON.parse(JSON.stringify(tpl[k])));
  rtpDirty = new Set(); rtpRender();
}
function rtpHas(r, tk) { return roleTokens(r.defaults).has(tk); }
// 开 / 关一个标记：改 defaults（permissions / resource_perms）
function rtpSetToken(r, tk, on) {
  const d = r.defaults = r.defaults || {}; d.permissions = d.permissions || {}; d.resource_perms = d.resource_perms || [];
  const i = tk.indexOf(':'), k = tk.slice(0, i), v = tk.slice(i + 1), p = d.permissions;
  if (k === 'p') { if (on) p[v] = true; else delete p[v]; return; }
  if (k === 'res') { const a = d.resource_perms, j = a.indexOf(v); if (on && j < 0) a.push(v); if (!on && j >= 0) a.splice(j, 1); return; }
  if (k === 'schedule') { if (on) p.schedule = v; else if (p.schedule === v) delete p.schedule; return; }
  const a = p[k] = Array.isArray(p[k]) ? p[k] : []; const j = a.indexOf(v);
  if (on && j < 0) a.push(v); if (!on && j >= 0) a.splice(j, 1);
  // 预约 / 时间槽 / 学生管理 的类型只有在总开关开着才有意义：类型有开 → 总开关跟着开
  const main = { booking_types: 'booking', slot_types: 'slots', student_mgmt_items: 'student_mgmt' }[k];
  if (main && on) p[main] = true;
}
function rtpToggle(ri, tk) {
  const r = rtpRows[ri]; if (!r) return;
  rtpSetToken(r, tk, !rtpHas(r, tk)); rtpDirty.add(r.key); rtpRender();
}
function rtpRender() {
  const box = rtpBody; if (!box) return;
  const rows = rtpFeatureRows(), n = rtpDirty.size;
  let lastG = '';
  const th = 'font-size:10px;padding:4px 6px;border-bottom:1px solid var(--border);text-align:center;white-space:nowrap;position:sticky;top:0;background:var(--surface)';
  const head = `<tr><th style="${th};text-align:left">功能</th>${rtpRows.map(r => `<th style="${th}">${escTM(r.label)}${rtpDirty.has(r.key) ? '<span style="color:var(--accent)"> ●</span>' : ''}<div style="font-weight:400;color:var(--text-3)">${r.kind === 'position' ? '职位' : '角色'}</div></th>`).join('')}</tr>`;
  const body = rows.map(([g, tk, name]) => {
    const gh = g !== lastG ? `<tr><td colspan="${rtpRows.length + 1}" style="font-size:10px;font-weight:600;color:var(--text-2);background:var(--bg);padding:4px 6px">${g}</td></tr>` : ''; lastG = g;
    return gh + `<tr><td style="font-size:11px;padding:3px 6px;white-space:nowrap">${escTM(name)}</td>${rtpRows.map((r, ri) => {
      const on = rtpHas(r, tk);
      return `<td onclick="rtpToggle(${ri},'${tk}')" style="text-align:center;cursor:pointer;padding:3px 6px;font-size:11px;${on ? 'background:var(--ok-bg,#e4f0e8);color:var(--ok,#2a9e6a)' : 'color:var(--text-3)'}">${on ? '开' : '·'}</td>`;
    }).join('')}</tr>`;
  }).join('');
  const flags = [['see_all_students', '看全部领域的学生'], ['see_all_admission', '看全部出愿数据'], ['needs_manage_scope', '需要设管理范围']];
  const flagRow = flags.map(([k, l]) => `<tr><td style="font-size:11px;padding:3px 6px;white-space:nowrap">${l}<span style="font-size:9px;color:var(--text-3)"> （说明，不可改）</span></td>${rtpRows.map(r => `<td style="text-align:center;font-size:11px;padding:3px 6px;color:var(--text-3)">${(r.defaults || {})[k] ? '是' : '·'}</td>`).join('')}</tr>`).join('');
  box.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <div style="font-size:12px;color:var(--text-2)">点格子切换「默认开 / 不开」。老师的最终功能 = 管理职位默认 ∪ 各执行角色默认。<b>改模板不会自动改现有老师</b>，到老师编辑页点［补齐］。</div>
      <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="rtpCheckAll()">检查全部老师</button>
      <button class="btn btn-primary btn-sm" onclick="rtpSave()"${n ? '' : ' disabled'}>保存${n ? `（${n} 个角色改动）` : ''}</button></div>
    <div style="overflow:auto;max-height:70vh;border:1px solid var(--border-light);border-radius:3px"><table style="border-collapse:collapse;width:100%"><thead>${head}</thead><tbody>${body}${gh2()}${flagRow}</tbody></table></div>
    <div id="rtpDiff" style="margin-top:12px"></div>`;
  function gh2() { return `<tr><td colspan="${rtpRows.length + 1}" style="font-size:10px;font-weight:600;color:var(--text-2);background:var(--bg);padding:4px 6px">范围规则（跟着角色走，这里只做说明）</td></tr>`; }
  if (rtpDiffOpen) rtpCheckAll(true);
}
async function rtpSave() {
  if (!rtpDirty.size) return;
  try {
    for (const k of rtpDirty) {
      const r = rtpRows.find(x => x.key === k); if (!r) continue;
      const res = await sb(`/rest/v1/role_templates?key=eq.${encodeURIComponent(k)}`, 'PATCH', { defaults: r.defaults, updated_at: new Date().toISOString() });
      if (!res || !res.length) await sb('/rest/v1/role_templates', 'POST', [{ key: k, label: r.label, kind: r.kind, defaults: r.defaults, sort: r.sort || 0 }]);   // 表里还没有这一行
    }
    _roleTpl = null; _roleTplP = null; await roleTplEnsure();
    rtpDirty = new Set(); rtpRender(); alert('已保存。现有老师的功能没有变化；到老师编辑页看「和角色默认相比」。');
  } catch (e) { alert('保存失败：' + e.message); }
}
// 检查全部老师：每位有职位 / 角色的老师，和角色默认相比缺几项、多几项
async function rtpCheckAll(keepOpen) {
  rtpDiffOpen = true;
  const box = document.getElementById('rtpDiff'); if (!box) return;
  box.innerHTML = '<div style="font-size:12px;color:var(--text-3)">检查中…</div>';
  let teachers = [];
  try { teachers = await sbAll('/rest/v1/teachers?select=*&order=name.asc'); } catch (e) { box.innerHTML = '读取老师失败：' + escTM(e.message); return; }
  // 用「当前表里的内容」（含还没保存的改动）算默认
  const tpl = {}; rtpRows.forEach(r => { tpl[r.key] = r; });
  const defOf = t => { const out = new Set(); [t.position].concat(t.roles || []).filter(Boolean).forEach(k => roleTokens((tpl[k] || {}).defaults).forEach(x => out.add(x))); if (t.staff_type === '正社员') { out.add('p:slots'); out.add('slot_types:attendance'); } return out; };
  const curOf = t => { const p = t.permissions || {}, out = new Set(); Object.keys(TF_P_LABEL).forEach(k => { if (p[k]) out.add('p:' + k); });
    ['booking_types', 'slot_types', 'student_mgmt_items'].forEach(k => (p[k] || []).forEach(v => out.add(k + ':' + v)));
    if ((p.student_mgmt_items || []).includes('records')) { out.add('student_mgmt_items:records_view'); out.add('student_mgmt_items:records_entry'); }
    if (p.schedule) { const sv = p.schedule === true ? 'full' : p.schedule; out.add('schedule:' + sv); if (sv === 'full') out.add('schedule:timetable'); }
    (t.resource_perms || []).forEach(x => out.add('res:' + x)); return out; };
  const list = teachers.filter(t => t.position || (t.roles || []).length).map(t => {
    const d = defOf(t), c = curOf(t);
    return { t, miss: [...d].filter(x => !c.has(x)), extra: [...c].filter(x => !d.has(x)) };
  });
  const bad = list.filter(x => x.miss.length || x.extra.length);
  const lab = a => a.slice(0, 8).map(roleTokenLabel).join('、') + (a.length > 8 ? ` 等 ${a.length} 项` : '');
  box.innerHTML = `<div style="font-size:12px;font-weight:600;margin-bottom:6px">检查全部老师：${list.length} 位有职位 / 角色，其中 ${bad.length} 位和默认不一致</div>` +
    (bad.length ? bad.map(x => `<div style="border:1px solid var(--border-light);border-radius:3px;padding:6px 10px;margin-bottom:4px;font-size:11px;line-height:1.7">
      <b>${escTM(x.t.name)}</b> <span style="color:var(--text-3)">${escTM([teacherPositionLabel(x.t.position)].concat((x.t.roles || []).map(teacherRoleLabel)).filter(Boolean).join(' · '))}</span>
      ${x.miss.length ? `<span style="color:var(--warn,#b8860b)"> 缺 ${x.miss.length} 项（${escTM(lab(x.miss))}）</span>` : ''}${x.extra.length ? `<span style="color:var(--text-3)"> 多开 ${x.extra.length} 项（${escTM(lab(x.extra))}）</span>` : ''}
      <a href="javascript:void(0)" onclick="rtpGoTeacher('${escTM(x.t.id)}')" style="color:var(--accent);margin-left:6px">打开编辑页</a></div>`).join('') : '<div style="font-size:11px;color:var(--ok,#2a9e6a)">全部一致</div>');
}
// 跳到老师管理并打开这位老师（那里的「和角色默认相比」可以一键补齐）
async function rtpGoTeacher(id) {
  await switchConsoleTab('teachers');
  openEditTeacher(id);
}
