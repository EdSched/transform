// ══════════════════════════════════
// roletpl.js — 中枢 → 角色模板（只有管理员能进、能改）
// 选一个角色 → 按分组编辑它的默认功能和范围规则；「对比表」可以只读地横向比较所有角色
// 保存到 role_templates 表（建表 SQL：seed/teacher_roles_prepare.sql）。改了模板不会自动改现有老师
// 依赖：admin.js（roleTplEnsure、roleTokens、roleTokenLabel、TF_P_LABEL、TF_SUB_LABEL、escTM）、shared/constants.js
// ══════════════════════════════════
let rtpRows = null, rtpDirty = new Set(), rtpBody = null, rtpDiffOpen = false;
let rtpSel = '', rtpQ = '', rtpCompare = false, rtpOrig = {}, rtpTeachers = null, rtpChk = new Set(), rtpShowAcked = false, rtpBusy = '';
const rtpIsAdmin = () => typeof ACCESS_KEY === 'undefined' || !ACCESS_KEY || !!ACCESS_KEY.is_admin;
const RTP_ROLE_ORDER = ['lead', 'sales', 'liaison', 'soumu', 'soumu_asst', 'senmon', 'ta', 'homeroom'];
// 表的行：[分组, 标记, 名称]
function rtpFeatureRows() {
  const rows = [];
  const P = ['booking', 'slots', 'homework', 'admission_query', 'student_mgmt', 'vip_backfill'];
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
  // 角色列表 = 模板表的行 ∪ 选项设置里启用中的自定义职位 / 角色（没有模板行的用空默认显示）；停用的自定义项不显示
  let opts = [];
  try { await loadAppOptions(); opts = (await sb('/rest/v1/app_options?select=kind,key,label,sort,builtin,active&kind=in.(teacher_position,teacher_role)&order=sort.asc,key.asc', 'GET', null, { cache: 'no-store' })) || []; }
  catch (e) { opts = []; }
  if (!opts.length) {
    TEACHER_POSITIONS.forEach((x, i) => opts.push({ kind: 'teacher_position', key: x[0], label: x[1], sort: i + 1, builtin: x[3], active: x[2] }));
    TEACHER_ROLES.forEach((x, i) => opts.push({ kind: 'teacher_role', key: x[0], label: x[1], sort: i + 1, builtin: x[3], active: x[2] }));
  }
  const customs = ['teacher_position', 'teacher_role'].flatMap(kind => opts.filter(o => o.kind === kind && !RTP_ROLE_ORDER.includes(o.key) && o.active !== false));
  const blank = () => ({ permissions: {}, resource_perms: [], tags: [], see_all_students: false, see_all_admission: false, needs_manage_scope: false });
  rtpRows = RTP_ROLE_ORDER.filter(k => tpl[k]).map(k => JSON.parse(JSON.stringify(tpl[k])));
  customs.forEach(o => {
    const r = tpl[o.key] ? JSON.parse(JSON.stringify(tpl[o.key])) : { key: o.key, kind: o.kind === 'teacher_position' ? 'position' : 'role', defaults: blank() };
    r.label = o.label || r.label || o.key; r.kind = o.kind === 'teacher_position' ? 'position' : 'role'; r.sort = o.sort || 0;
    if (!r.defaults) r.defaults = blank();
    rtpRows.push(r);
  });
  rtpOrig = {}; rtpRows.forEach(r => { rtpOrig[r.key] = JSON.stringify(r); });
  rtpDirty = new Set(); rtpSel = rtpRows[0] ? rtpRows[0].key : ''; rtpQ = ''; rtpCompare = false;
  rtpDiffOpen = false; rtpTeachers = null; rtpChk = new Set(); rtpShowAcked = false; rtpBusy = '';
  rtpRender();
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
const RTP_GROUPS = ['老师端功能', '预约类型', '时间槽类型', '学生管理子项', '营业功能', '资源权限'];
const RTP_FLAGS = [
  ['see_all_students', '看全部领域的学生', '开：这个角色的老师在老师端学生管理能看到所有领域的学生。仍然受「学生来源」限制。营业如果另外指定了营业范围，就只看营业范围。'],
  ['see_all_admission', '看全部出愿数据', '开：能查所有专业的出愿数据。'],
  ['payroll_approve', '工作管理可审批发布', '开：新建老师时选了这个角色，负责人的「工作管理」默认是「可以审批发布」；不开默认「只能查看」。只影响新建时的默认值；自己的工资永远由管理员审批。'],
  ['needs_manage_scope', '需要设管理范围', '只是提醒：老师编辑页如果选了这个角色却没设管理范围，会显示黄色提示。不影响功能。']
];
const rtpCur = () => (rtpRows || []).find(r => r.key === rtpSel);
const rtpCount = r => roleTokens(r.defaults).size;
function rtpMark(r) { return rtpDirty.has(r.key) ? '<span style="color:var(--accent)"> ●</span>' : ''; }
// 点一个功能（或范围规则开关）
function rtpToggle(tk) {
  const r = rtpCur(); if (!r) return;
  rtpSetToken(r, tk, !rtpHas(r, tk)); rtpDirty.add(r.key); rtpRender(true);
}
function rtpFlagToggle(f) {
  const r = rtpCur(); if (!r) return;
  const d = r.defaults = r.defaults || {}; d[f] = !d[f]; rtpDirty.add(r.key); rtpRender(true);
}
function rtpGroupSet(g, on) {
  const r = rtpCur(); if (!r) return;
  rtpVisibleRows().filter(x => x[0] === g).forEach(([, tk]) => { if (rtpHas(r, tk) !== on) rtpSetToken(r, tk, on); });
  rtpDirty.add(r.key); rtpRender(true);
}
function rtpVisibleRows() {
  const q = rtpQ.trim().toLowerCase();
  return rtpFeatureRows().filter(([g, , name]) => !q || name.toLowerCase().includes(q) || g.includes(q));
}
function rtpSearch(v) { rtpQ = v; rtpRender(true); }
function rtpBtn3(msg) {   // 保存 / 放弃 / 取消
  return new Promise(res => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center';
    ov.innerHTML = `<div style="background:var(--surface,#fff);border-radius:6px;padding:16px 20px;max-width:340px;font-size:13px;line-height:1.7"><div style="margin-bottom:12px">${escTM(msg)}</div><div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-outline btn-sm" data-v="cancel">取消</button><button class="btn btn-outline btn-sm" data-v="discard">放弃</button><button class="btn btn-primary btn-sm" data-v="save">保存</button></div></div>`;
    ov.onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v) { ov.remove(); res(v); } };
    document.body.appendChild(ov);
  });
}
async function rtpPick(k) {
  if (k === rtpSel) return;
  const cur = rtpCur();
  if (cur && rtpDirty.has(cur.key)) {
    const v = await rtpBtn3(`「${cur.label}」有没保存的改动。`);
    if (v === 'cancel') return;
    if (v === 'save') { if (!(await rtpSave())) return; }
    else { const i = rtpRows.findIndex(x => x.key === cur.key); rtpRows[i] = JSON.parse(rtpOrig[cur.key]); rtpDirty.delete(cur.key); }
  }
  rtpSel = k; rtpRender();
}
function rtpCompareToggle() { rtpCompare = !rtpCompare; rtpRender(true); }
function rtpCompareHtml() {
  const rows = rtpFeatureRows(); let lastG = '';
  const th = 'font-size:10px;padding:4px 6px;border-bottom:1px solid var(--border);text-align:center;white-space:nowrap;position:sticky;top:0;background:var(--surface)';
  const head = `<tr><th style="${th};text-align:left">功能</th>${rtpRows.map(r => `<th style="${th}">${escTM(r.label)}${rtpMark(r)}<div style="font-weight:400;color:var(--text-3)">${r.kind === 'position' ? '职位' : '角色'}</div></th>`).join('')}</tr>`;
  const body = rows.map(([g, tk, name]) => {
    const gh = g !== lastG ? `<tr><td colspan="${rtpRows.length + 1}" style="font-size:10px;font-weight:600;color:var(--text-2);background:var(--bg);padding:4px 6px">${g}</td></tr>` : ''; lastG = g;
    return gh + `<tr><td style="font-size:11px;padding:3px 6px;white-space:nowrap">${escTM(name)}</td>${rtpRows.map(r => {
      const on = rtpHas(r, tk);
      return `<td style="text-align:center;padding:3px 6px;font-size:11px;${on ? 'background:var(--ok-bg,#e4f0e8);color:var(--ok,#2a9e6a)' : 'color:var(--text-3)'}">${on ? '开' : '·'}</td>`;
    }).join('')}</tr>`;
  }).join('');
  const flagRow = RTP_FLAGS.map(([k, l]) => `<tr><td style="font-size:11px;padding:3px 6px;white-space:nowrap">${l}</td>${rtpRows.map(r => `<td style="text-align:center;font-size:11px;padding:3px 6px;color:var(--text-3)">${(r.defaults || {})[k] ? '是' : '·'}</td>`).join('')}</tr>`).join('');
  return `<div style="overflow:auto;max-height:70vh;border:1px solid var(--border-light);border-radius:3px;margin-top:10px"><table style="border-collapse:collapse;width:100%"><thead>${head}</thead><tbody>${body}<tr><td colspan="${rtpRows.length + 1}" style="font-size:10px;font-weight:600;color:var(--text-2);background:var(--bg);padding:4px 6px">范围规则</td></tr>${flagRow}</tbody></table></div>`;
}
function rtpRender(keepFocus) {
  const box = rtpBody; if (!box) return;
  const n = rtpDirty.size, r = rtpCur();
  const chip = (on, html, fn) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${fn}" style="padding:4px 12px;font-size:11px">${html}</div>`;
  const roleChips = rtpRows.map(x => chip(x.key === rtpSel, `${escTM(x.label)}${rtpMark(x)} <span style="font-size:9px;opacity:.7">开 ${rtpCount(x)} 项</span>`, `rtpPick('${escTM(x.key)}')`)).join('');
  let main = '';
  if (r) {
    const vis = rtpVisibleRows(), q = rtpQ.trim();
    const groups = RTP_GROUPS.map(g => {
      const items = vis.filter(x => x[0] === g); if (!items.length) return '';
      const nOn = items.filter(([, tk]) => rtpHas(r, tk)).length;
      const chips = items.map(([, tk, name]) => ({ on: rtpHas(r, tk), html: chip(rtpHas(r, tk), escTM(name), `rtpToggle('${tk}')`) }));
      return `<div style="margin-bottom:10px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:4px"><span style="font-size:11px;font-weight:600;color:var(--text-2)">${g}</span><span style="font-size:10px;color:var(--text-3)">${nOn}/${items.length}</span>
        <span style="margin-left:auto;font-size:11px"><a href="javascript:void(0)" onclick="rtpGroupSet('${g}',true)" style="color:var(--accent)">全开</a> <a href="javascript:void(0)" onclick="rtpGroupSet('${g}',false)" style="color:var(--accent);margin-left:8px">全关</a></span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${q ? chips.map(c => c.html).join('') : chipFold(chips)}</div></div>`;
    }).join('');
    const d = r.defaults || {};
    const flags = RTP_FLAGS.map(([k, l, tip]) => `<div style="margin-bottom:6px"><div style="display:flex;gap:6px;align-items:center">${chip(!!d[k], escTM(l), `rtpFlagToggle('${k}')`)}</div><div style="font-size:10px;color:var(--text-3);margin:2px 0 0 2px;line-height:1.6">${tip}</div></div>`).join('');
    main = `${groups || '<div class="empty" style="padding:20px">没有匹配的功能</div>'}
      <div style="margin-top:14px;border-top:1px solid var(--border-light);padding-top:10px"><div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">范围规则（${escTM(r.label)}）</div>${flags}</div>`;
  }
  box.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <div style="font-size:12px;color:var(--text-2)">选一个职位 / 角色，点功能切换「默认开 / 不开」。老师的最终功能 = 管理职位默认 ∪ 各执行角色默认。<b>改模板不会自动改现有老师</b>，到老师编辑页点［补齐］。</div>
      <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="rtpCompareToggle()">${rtpCompare ? '关闭对比表' : '对比表'}</button>
      <button class="btn btn-outline btn-sm" onclick="rtpCheckAll()">检查全部老师</button>
      <button class="btn btn-primary btn-sm" onclick="rtpSave()"${n ? '' : ' disabled'}>保存${n ? `（${n} 个角色改动）` : ''}</button></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${roleChips}</div>
    ${rtpCompare ? rtpCompareHtml() : `<input id="rtpQ" type="text" value="${escTM(rtpQ)}" placeholder="搜索功能名称" oninput="rtpSearch(this.value)" style="width:100%;max-width:260px;font-size:12px;padding:5px 8px;margin-bottom:10px;border:1px solid var(--border);border-radius:3px">${main}`}
    <div id="rtpDiff" style="margin-top:12px"></div>`;
  if (keepFocus) { const e = document.getElementById('rtpQ'); if (e && document.activeElement !== e && rtpQ) { e.focus(); e.setSelectionRange(rtpQ.length, rtpQ.length); } }
  if (rtpDiffOpen) rtpDiffRender();
}
async function rtpSave() {
  if (!rtpDirty.size) return true;
  try {
    for (const k of rtpDirty) {
      const r = rtpRows.find(x => x.key === k); if (!r) continue;
      const res = await sb(`/rest/v1/role_templates?key=eq.${encodeURIComponent(k)}`, 'PATCH', { defaults: r.defaults, updated_at: new Date().toISOString() });
      if (!res || !res.length) await sb('/rest/v1/role_templates', 'POST', [{ key: k, label: r.label, kind: r.kind, defaults: r.defaults, sort: r.sort || 0 }]);   // 表里还没有这一行
      rtpOrig[k] = JSON.stringify(r);
    }
    _roleTpl = null; _roleTplP = null; await roleTplEnsure();
    rtpDirty = new Set(); rtpRender(); alert('已保存。现有老师的功能没有变化；到老师编辑页看「和角色默认相比」。');
    return true;
  } catch (e) { alert('保存失败：' + e.message); return false; }
}
// ── 检查全部老师：每位有职位 / 角色的老师，和角色默认相比缺几项、多几项 ──
// 「保持原状」记在 teachers.role_diff_ack = {miss:[…], extra:[…]}；差异和记录完全一样就不列，变了重新列出并标「有变化」
const rtpSame = (a, b) => { a = (a || []).slice().sort(); b = (b || []).slice().sort(); return a.length === b.length && a.every((x, i) => x === b[i]); };
async function rtpCheckAll() {
  rtpDiffOpen = true;
  const box = document.getElementById('rtpDiff'); if (!box) return;
  box.innerHTML = '<div style="font-size:12px;color:var(--text-3)">检查中…</div>';
  try { rtpTeachers = await sbAll('/rest/v1/teachers?select=*&order=name.asc'); } catch (e) { box.innerHTML = '读取老师失败：' + escTM(e.message); return; }
  rtpChk = new Set(); rtpDiffRender();
}
function rtpDiffClose() { rtpDiffOpen = false; const b = document.getElementById('rtpDiff'); if (b) b.innerHTML = ''; }
function rtpDiffCompute() {
  // 用「当前表里的内容」（含还没保存的改动）算默认
  const tpl = {}; rtpRows.forEach(r => { tpl[r.key] = r; });
  const defOf = t => { const out = new Set(); [t.position].concat(t.roles || []).filter(Boolean).forEach(k => roleTokens((tpl[k] || {}).defaults).forEach(x => out.add(x))); if (t.staff_type === '正社员') { out.add('p:slots'); out.add('slot_types:attendance'); } return out; };
  const curOf = t => { const p = t.permissions || {}, out = new Set(); Object.keys(TF_P_LABEL).forEach(k => { if (p[k]) out.add('p:' + k); });
    ['booking_types', 'slot_types', 'student_mgmt_items'].forEach(k => (p[k] || []).forEach(v => out.add(k + ':' + v)));
    if ((p.student_mgmt_items || []).includes('records')) { out.add('student_mgmt_items:records_view'); out.add('student_mgmt_items:records_entry'); }
    if (p.schedule) { const sv = p.schedule === true ? 'full' : p.schedule; out.add('schedule:' + sv); if (sv === 'full') out.add('schedule:timetable'); }
    (t.resource_perms || []).forEach(x => out.add('res:' + x)); return out; };
  const list = (rtpTeachers || []).filter(t => t.position || (t.roles || []).length).map(t => {
    const d = defOf(t), c = curOf(t);
    const x = { t, miss: [...d].filter(y => !c.has(y)).sort(), extra: [...c].filter(y => !d.has(y)).sort() };
    const ack = t.role_diff_ack;
    x.acked = !!(ack && rtpSame(ack.miss, x.miss) && rtpSame(ack.extra, x.extra));
    x.changed = !!(ack && !x.acked);
    return x;
  });
  const diff = list.filter(x => x.miss.length || x.extra.length);
  return { list, bad: diff.filter(x => !x.acked), acked: diff.filter(x => x.acked) };
}
function rtpDiffRender() {
  const box = document.getElementById('rtpDiff'); if (!box) return;
  if (!rtpTeachers) { rtpCheckAll(); return; }
  const { list, bad, acked } = rtpDiffCompute();
  const lab = a => a.slice(0, 8).map(roleTokenLabel).join('、') + (a.length > 8 ? ` 等 ${a.length} 项` : '');
  const lk = 'color:var(--accent);margin-left:8px';
  const row = (x, isAcked) => {
    const id = escTM(x.t.id), busy = !!rtpBusy;
    return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:6px 10px;margin-bottom:4px;font-size:11px;line-height:1.7;display:flex;gap:8px;align-items:flex-start">
      ${isAcked ? '' : `<div class="filter-chip${rtpChk.has(x.t.id) ? ' active' : ''}" onclick="rtpChkToggle('${id}')" style="padding:1px 8px;font-size:10px;flex:none">${rtpChk.has(x.t.id) ? '已选' : '选'}</div>`}
      <div style="flex:1"><b>${escTM(x.t.name)}</b> <span style="color:var(--text-3)">${escTM([teacherPositionLabel(x.t.position)].concat((x.t.roles || []).map(teacherRoleLabel)).filter(Boolean).join(' · '))}</span>
      ${x.changed ? '<span style="font-size:10px;color:var(--warn,#b8860b)"> 之前确认过，有变化</span>' : ''}
      ${x.miss.length ? `<span style="color:var(--warn,#b8860b)"> 缺 ${x.miss.length} 项（${escTM(lab(x.miss))}）</span>` : ''}${x.extra.length ? `<span style="color:var(--text-3)"> 多开 ${x.extra.length} 项（${escTM(lab(x.extra))}）</span>` : ''}
      <span style="white-space:nowrap">${isAcked ? `<a href="javascript:void(0)" onclick="rtpUnack('${id}')" style="${lk}">取消确认</a>` : `${x.miss.length ? `<a href="javascript:void(0)" onclick="${busy ? '' : `rtpFill(['${id}'])`}" style="${lk}">补齐</a>` : ''}<a href="javascript:void(0)" onclick="${busy ? '' : `rtpAck(['${id}'])`}" style="${lk}">保持原状</a>`}<a href="javascript:void(0)" onclick="rtpGoTeacher('${id}')" style="${lk}">打开编辑页</a></span></div></div>`;
  };
  const allSel = bad.length && bad.every(x => rtpChk.has(x.t.id));
  const nSel = bad.filter(x => rtpChk.has(x.t.id)).length;
  box.innerHTML = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px"><div style="font-size:12px;font-weight:600">检查全部老师：${list.length} 位有职位 / 角色，${bad.length} 位不一致${acked.length ? `（另有 ${acked.length} 位已确认保持原状）` : ''}</div>
      <span style="margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      ${acked.length ? `<div class="filter-chip${rtpShowAcked ? ' active' : ''}" onclick="rtpShowAckedToggle()" style="padding:2px 10px;font-size:10px">显示已确认的 ${acked.length} 位</div>` : ''}
      <button class="btn btn-outline btn-sm" onclick="rtpDiffClose()">收起</button></span></div>
    ${bad.length ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
      <button class="btn btn-outline btn-sm" onclick="rtpChkAll()">${allSel ? '取消全选' : '全选'}</button>
      <button class="btn btn-outline btn-sm" onclick="rtpFillSel()"${nSel && !rtpBusy ? '' : ' disabled'}>补齐所选</button>
      <button class="btn btn-outline btn-sm" onclick="rtpAckSel()"${nSel && !rtpBusy ? '' : ' disabled'}>保持原状</button>
      <span style="font-size:11px;color:var(--text-3)">${rtpBusy ? escTM(rtpBusy) : (nSel ? '已选 ' + nSel + ' 位' : '')}</span></div>` : ''}
    ${bad.length ? bad.map(x => row(x, false)).join('') : '<div style="font-size:11px;color:var(--ok,#2a9e6a)">全部一致</div>'}
    ${rtpShowAcked && acked.length ? `<div style="font-size:11px;color:var(--text-3);margin:8px 0 4px">已确认保持原状</div>` + acked.map(x => row(x, true)).join('') : ''}`;
}
function rtpChkToggle(id) { if (rtpChk.has(id)) rtpChk.delete(id); else rtpChk.add(id); rtpDiffRender(); }
function rtpChkAll() { const bad = rtpDiffCompute().bad; if (bad.every(x => rtpChk.has(x.t.id))) rtpChk.clear(); else bad.forEach(x => rtpChk.add(x.t.id)); rtpDiffRender(); }
function rtpShowAckedToggle() { rtpShowAcked = !rtpShowAcked; rtpDiffRender(); }
const rtpSelIds = () => rtpDiffCompute().bad.filter(x => rtpChk.has(x.t.id)).map(x => x.t.id);
function rtpFillSel() { const ids = rtpSelIds(); if (ids.length) rtpFill(ids); }
function rtpAckSel() { const ids = rtpSelIds(); if (ids.length) rtpAck(ids); }
// 补齐：只新增缺的项，不关掉多开的项（和老师编辑页的［补齐］一样），逐个保存
async function rtpFill(ids) {
  const items = rtpDiffCompute().bad.filter(x => ids.includes(x.t.id) && x.miss.length);
  if (!items.length) { alert('所选老师没有缺的项'); return; }
  let ok = 0; const fails = [];
  for (let i = 0; i < items.length; i++) {
    const x = items[i]; rtpBusy = `补齐中 ${i + 1}/${items.length}：${x.t.name}`; rtpDiffRender();
    try {
      const tmp = { defaults: { permissions: JSON.parse(JSON.stringify(x.t.permissions || {})), resource_perms: (x.t.resource_perms || []).slice() } };
      x.miss.forEach(tk => rtpSetToken(tmp, tk, true));
      const body = { permissions: tmp.defaults.permissions, resource_perms: tmp.defaults.resource_perms };
      await sb(`/rest/v1/teachers?id=eq.${encodeURIComponent(x.t.id)}`, 'PATCH', body);
      Object.assign(x.t, body); rtpChk.delete(x.t.id); ok++;
    } catch (e) { fails.push(x.t.name + '（' + e.message + '）'); }
  }
  rtpBusy = ''; rtpDiffRender();
  alert(`补齐完成：成功 ${ok} 位` + (fails.length ? `，失败 ${fails.length} 位：\n` + fails.join('\n') : ''));
}
async function rtpAck(ids) {
  const items = rtpDiffCompute().bad.filter(x => ids.includes(x.t.id));
  let ok = 0; const fails = [];
  for (let i = 0; i < items.length; i++) {
    const x = items[i]; rtpBusy = `记录中 ${i + 1}/${items.length}：${x.t.name}`; rtpDiffRender();
    try {
      const v = { miss: x.miss, extra: x.extra };
      await sb(`/rest/v1/teachers?id=eq.${encodeURIComponent(x.t.id)}`, 'PATCH', { role_diff_ack: v });
      x.t.role_diff_ack = v; rtpChk.delete(x.t.id); ok++;
    } catch (e) { fails.push(x.t.name + '（' + e.message + '）'); }
  }
  rtpBusy = ''; rtpDiffRender();
  if (fails.length) alert(`已记录 ${ok} 位，失败 ${fails.length} 位：\n` + fails.join('\n') + '\n（需要先执行 seed/role_diff_ack.sql）');
}
async function rtpUnack(id) {
  const t = (rtpTeachers || []).find(x => x.id === id); if (!t) return;
  try { await sb(`/rest/v1/teachers?id=eq.${encodeURIComponent(id)}`, 'PATCH', { role_diff_ack: null }); t.role_diff_ack = null; rtpDiffRender(); }
  catch (e) { alert('取消确认失败：' + e.message); }
}
// 跳到老师管理并打开这位老师（那里的「和角色默认相比」可以一键补齐）
async function rtpGoTeacher(id) {
  await switchConsoleTab('teachers');
  openEditTeacher(id);
}
