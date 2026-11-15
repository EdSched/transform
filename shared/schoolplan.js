// ══════════════════════════════════
// schoolplan.js — 志望校单所表单（学生端 / 老师端 / 管理端共用，同一张表 student_school_plans）
// spFormHtml(plan, opts)：一所学校的完整表单（可从「出愿学校列表」一键带入）
// spFormCollect(root)：读出表单里的值
// spOpenModal(...)：老师端 / 管理端的添加・编辑弹窗；spDeletePlan(...)：删除并写一条时间线记录
// 依赖：shared/supabase.js、shared/constants.js（SCHOOL_STATUS_LABELS、makeProgressEntry）
// ══════════════════════════════════

// ══ 目标校 / 备选（student_school_plans.plan_role：'target' 目标校 / 'backup' 备选；空值当目标校）══
// 志望校总数不限；目标校最多 SP_TARGET_MAX 所，其余放备选。各端一律用下面这几个函数，不要各写一份。
const SP_TARGET_MAX = 6;
function spRoleOf(p) { return p && p.plan_role === 'backup' ? 'backup' : 'target'; }
function spSplit(plans) {
  const targets = [], backups = [];
  (plans || []).forEach(p => (spRoleOf(p) === 'backup' ? backups : targets).push(p));
  return { targets, backups };
}
function spRoleName(role) { return role === 'backup' ? '备选' : '目标校'; }
function spGroupTitle(role, n) { return role === 'backup' ? `备选（${n}）` : `目标校（${n} / ${SP_TARGET_MAX}）`; }
function spPlanTitle(p) { return [p.school_name, p.faculty, p.department].filter(Boolean).join(' · '); }
// 分组标题条（列表里每组前面一条）
function spGroupHeadHtml(role, n, style) {
  return `<div style="font-size:11px;font-weight:600;margin:8px 0 4px;padding-bottom:3px;border-bottom:1px solid var(--border-light);color:${role === 'backup' ? 'var(--text-3)' : 'var(--text-2)'};${style || ''}">${spGroupTitle(role, n)}</div>`;
}
// 学校行上的小 chip：「目标」/「备选」。clickJs 为空 = 只读
function spRoleChipHtml(p, clickJs) {
  const bk = spRoleOf(p) === 'backup';
  const col = bk ? 'var(--text-3)' : 'var(--accent)';
  return `<span ${clickJs ? `onclick="event.stopPropagation();${clickJs}" title="点击切换目标校 / 备选"` : ''} style="display:inline-block;font-size:10px;line-height:1;padding:2px 6px;border-radius:8px;border:1px solid ${col};color:${bk ? col : '#fff'};background:${bk ? 'transparent' : 'var(--accent)'};white-space:nowrap;${clickJs ? 'cursor:pointer;' : ''}">${bk ? '备选' : '目标'}</span>`;
}

// ── 时间线记录（新增 / 修改 / 目标备选切换 / 删除都写进 student_progress_timeline）──
function spTlInsert(student, notes, source, sourceName) {
  const entry = makeProgressEntry({ studentId: student.id, studentName: student.name, major: student.major, source, sourceName, notes, recordedAt: new Date().toISOString().slice(0, 10) });
  return sb('/rest/v1/student_progress_timeline', 'POST', entry).then(() => entry).catch(() => null);
}
// ══ 标准出愿日期（student_school_plans.apply_date / apply_date_manual）══
// 从 application_period 的文字算出「出愿开始那天」，一律东京时间；算不出来返回 ''。
// apply_date_manual = true 表示手动改过，文字变了也不自动覆盖。原文字 application_period 永远保留。
function spTokyoYMD(d) {   // Date / ISO 时间 / 'YYYY-MM-DD' → { y, m, d }（东京时间）；无效 = null
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return { y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10) };
  const t = d instanceof Date ? d : new Date(d);
  if (isNaN(t.getTime())) return null;
  const j = new Date(t.getTime() + 9 * 3600 * 1000);
  return { y: j.getUTCFullYear(), m: j.getUTCMonth() + 1, d: j.getUTCDate() };
}
function spTodayTokyo() { const t = spTokyoYMD(new Date()); return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`; }
function spApplyDate(text, refDate) {
  const t = String(text == null ? '' : text).normalize('NFKC');
  if (!/\d/.test(t)) return '';
  const ref = spTokyoYMD(refDate || new Date()) || spTokyoYMD(new Date());
  const pad = n => String(n).padStart(2, '0');
  const ok = (y, m, d) => { const x = new Date(Date.UTC(y, m - 1, d)); return m >= 1 && m <= 12 && x.getUTCMonth() === m - 1 && x.getUTCDate() === d; };
  const yearOf = m => (m >= ref.m ? ref.y : ref.y + 1);   // 没写年：参考日所在月或之后最先出现的那个月
  const dayOfXun = x => ({ '上': 1, '中': 11, '下': 21 })[x] || 1;
  // 按文字顺序取第一个能识别的日期（区间取开始）
  const re = new RegExp([
    '(?<!\\d)(\\d{4})\\s*[\\/\\-.年]\\s*(\\d{1,2})\\s*[\\/\\-.月]\\s*(\\d{1,2})(?!\\d)',            // 1 年月日
    '(?<!\\d)(\\d{4})\\s*[\\/\\-.年]\\s*(\\d{1,2})(?!\\d)(?:\\s*月)?\\s*(?:(上|中|下)\\s*旬)?',    // 2 年月（可带旬）
    '(?<!\\d)(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日',                                              // 3 月日
    '(?<!\\d)(\\d{1,2})\\s*[\\/.\\-]\\s*(\\d{1,2})(?![\\d\\/.\\-])',                              // 4 7/10
    '(?<!\\d)(\\d{1,2})\\s*月\\s*(?:(上|中|下)\\s*旬)?',                                           // 5 月（可带旬）
  ].join('|'), 'g');
  for (const g of t.matchAll(re)) {
    let y, m, d;
    if (g[1]) { y = +g[1]; m = +g[2]; d = +g[3]; }
    else if (g[4]) { y = +g[4]; m = +g[5]; d = dayOfXun(g[6]); }
    else if (g[7]) { m = +g[7]; d = +g[8]; y = yearOf(m); }
    else if (g[9]) { m = +g[9]; d = +g[10]; y = yearOf(m); }
    else { m = +g[11]; d = dayOfXun(g[12]); y = yearOf(m); }
    if (ok(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
  }
  return '';
}
// 整理好要写库的 apply_date / apply_date_manual：manual 不是 true 时按文字重算（算不出来 = null）
function spApplyFields(row, createdAt) {
  const manual = row.apply_date_manual === true;
  const date = manual ? (row.apply_date || null) : (spApplyDate(row.application_period, createdAt || new Date()) || null);
  return { apply_date: date, apply_date_manual: manual };
}
// 表单里：文字变了 → 自动算；日期框手动改 → 标「手动」；按钮 → 恢复自动
function spAdNote(form, manual) {
  const n = form.querySelector('[data-adnote]'), h = form.querySelector('[data-field="apply_date_manual"]');
  if (h) h.value = manual ? '1' : '0';
  if (n) { n.textContent = manual ? '手动' : '自动'; n.style.color = manual ? 'var(--accent)' : 'var(--text-3)'; }
}
function spAdAuto(el) {   // 出愿时间文字输入时
  const form = el.closest('.sp-form'); if (!form) return;
  const h = form.querySelector('[data-field="apply_date_manual"]');
  if (h && h.value === '1') return;   // 手动改过：文字变了不覆盖
  const d = form.querySelector('[data-field="apply_date"]');
  if (d) d.value = spApplyDate(el.value, form.dataset.ref || new Date());
}
function spAdManual(el) { const form = el.closest('.sp-form'); if (form) spAdNote(form, true); }
function spAdRecalc(btn) {
  const form = btn.closest('.sp-form'); if (!form) return;
  const per = form.querySelector('[data-field="application_period"]'), d = form.querySelector('[data-field="apply_date"]');
  if (d) d.value = spApplyDate(per ? per.value : '', form.dataset.ref || new Date());
  spAdNote(form, false);
}
const SP_TRACK = [['school_name', '学校'], ['faculty', '研究科'], ['department', '专攻'], ['professor', '教授'], ['professor2', '教授2'],
  ['application_period', '出愿时间'], ['exam_date', '考试日期'], ['level', '级别'], ['status', '进度'], ['kakomon_started', '过去问'], ['interview_draft_done', '面试稿']];
function spFieldText(f, v) {
  if (f === 'level') return ({ 1: '冲刺', 2: '匹配', 3: '保底' })[v || 2] || '';
  if (f === 'status') return (SCHOOL_STATUS_LABELS[v || 'preparing'] || {}).t || v || '';
  if (f === 'kakomon_started') return v ? '已开始' : '未开始';
  if (f === 'interview_draft_done') return v ? '已完成' : '未完成';
  return String(v == null ? '' : v).trim();
}
// 旧值 → 新值：只比较 newP 里带了的字段；返回 [{label, from, to}]
function spDiffPlan(oldP, newP) {
  const out = [];
  SP_TRACK.forEach(([f, label]) => {
    if (!(f in newP)) return;
    const a = spFieldText(f, oldP[f]), b = spFieldText(f, newP[f]);
    if (a !== b) out.push({ label, from: a || '空', to: b || '空' });
  });
  return out;
}
function spAddLog(student, p, source, sourceName, remark) {
  return spTlInsert(student, `新增志望校（${spRoleName(spRoleOf(p))}）：${spPlanTitle(p)}${remark ? `（${remark}）` : ''}`, source, sourceName);
}
// 修改：同一个人对同一所学校 1 分钟内连续改，合并成一条（更新上一条的 notes）
const SP_LOG_RECENT = {};
async function spLogModify(student, plan, changes, source, sourceName, remark) {
  if (!changes || !changes.length) return;
  const key = [student.id, plan.id, source, sourceName].join('|'), now = Date.now();
  const build = (title, map) => `修改志望校：${title}｜${[...map.values()].map(c => `${c.label} ${c.from} → ${c.to}`).join('；')}${remark ? `（${remark}）` : ''}`;
  const rec = SP_LOG_RECENT[key];
  if (rec && now - rec.t < 60000) {
    changes.forEach(c => {
      const ex = rec.map.get(c.label);
      if (ex) { ex.to = c.to; if (ex.to === ex.from) rec.map.delete(c.label); } else rec.map.set(c.label, Object.assign({}, c));
    });
    try {
      if (!rec.map.size) { await sb(`/rest/v1/student_progress_timeline?id=eq.${encodeURIComponent(rec.id)}`, 'DELETE'); delete SP_LOG_RECENT[key]; }
      else { await sb(`/rest/v1/student_progress_timeline?id=eq.${encodeURIComponent(rec.id)}`, 'PATCH', { notes: build(rec.title, rec.map) }); rec.t = now; }
      return;
    } catch (e) { delete SP_LOG_RECENT[key]; }
  }
  const map = new Map(); changes.forEach(c => map.set(c.label, Object.assign({}, c)));
  const title = spPlanTitle(plan);
  const entry = await spTlInsert(student, build(title, map), source, sourceName);
  if (entry) SP_LOG_RECENT[key] = { id: entry.id, t: now, map, title };
}
function spRoleLog(student, p, role, source, sourceName) {
  return spTlInsert(student, `志望校改为${spRoleName(role)}：${spPlanTitle(p)}`, source, sourceName);
}
function spSwapLog(student, up, down, source, sourceName) {
  return spTlInsert(student, `志望校调整：${spPlanTitle(up)} 改为目标校，${spPlanTitle(down)} 改为备选`, source, sourceName);
}

// 选一所目标校换成备选：items = [{ key, label }]，返回选中的 key（取消 = null）
function spPickSwap(items, upLabel) {
  return new Promise(resolve => {
    document.getElementById('spSwapModal')?.remove();
    const m = document.createElement('div');
    m.id = 'spSwapModal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
    const done = v => { m.remove(); resolve(v); };
    m.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:16px;max-width:420px;width:100%;max-height:85vh;overflow-y:auto">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">目标校已满 ${SP_TARGET_MAX} 所，选一所换成备选</div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:10px">「${spEsc(upLabel)}」改为目标校，下面选中的一所改为备选</div>
      ${items.map((it, i) => `<div data-i="${i}" style="font-size:12px;padding:8px 10px;border:1px solid var(--border);border-radius:3px;margin-bottom:6px;cursor:pointer;background:var(--bg)">${spEsc(it.label)}</div>`).join('')}
      <div style="text-align:right;margin-top:6px"><button data-cancel style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">取消</button></div>
    </div>`;
    m.onclick = e => { if (e.target === m) done(null); };
    m.querySelectorAll('[data-i]').forEach(el => { el.onclick = () => done(items[+el.dataset.i].key); });
    m.querySelector('[data-cancel]').onclick = () => done(null);
    document.body.appendChild(m);
  });
}

// 切换目标 / 备选（管理端、老师端行内 chip 用；规则与时间线都在这里）
// 备选→目标：目标校不到 6 所直接改；满 6 所弹出目标校列表选一所对调（两所一次保存，时间线记一条「志望校调整」）。目标→备选：直接改。
async function spSetRole(student, plan, role, source, sourceName, onDone) {
  if (spRoleOf(plan) === role) return;
  try {
    if (role === 'backup') {
      await sb(`/rest/v1/student_school_plans?id=eq.${encodeURIComponent(plan.id)}`, 'PATCH', { plan_role: 'backup' });
      plan.plan_role = 'backup';
      await spRoleLog(student, plan, 'backup', source, sourceName);
    } else {
      const cur = await sb(`/rest/v1/student_school_plans?student_id=eq.${encodeURIComponent(student.id)}&select=*&order=level.asc`, 'GET', null, { cache: 'no-store' });
      const targets = (cur || []).filter(p => spRoleOf(p) === 'target' && p.id !== plan.id);
      if (targets.length < SP_TARGET_MAX) {
        await sb(`/rest/v1/student_school_plans?id=eq.${encodeURIComponent(plan.id)}`, 'PATCH', { plan_role: 'target' });
        plan.plan_role = 'target';
        await spRoleLog(student, plan, 'target', source, sourceName);
      } else {
        const key = await spPickSwap(targets.map(p => ({ key: p.id, label: spPlanTitle(p) })), spPlanTitle(plan));
        if (!key) return;
        const down = targets.find(p => p.id === key);
        await sb(`/rest/v1/student_school_plans?id=eq.${encodeURIComponent(down.id)}`, 'PATCH', { plan_role: 'backup' });
        await sb(`/rest/v1/student_school_plans?id=eq.${encodeURIComponent(plan.id)}`, 'PATCH', { plan_role: 'target' });
        plan.plan_role = 'target';
        await spSwapLog(student, plan, down, source, sourceName);
      }
    }
    if (onDone) onDone();
  } catch (e) { alert('保存失败：' + e.message); }
}

// ── 学生端 / VIP 页：整表保存（先全删再全插）前后的比较，补记新增 / 修改 / 切换 / 删除 ──
// oldPlans = 保存前从库里读到的；newPlans = 这次要写进去的（带 id、plan_role）
async function spSaveDiffLog(student, oldPlans, newPlans, source, sourceName) {
  const oldMap = new Map((oldPlans || []).filter(p => p.id).map(p => [p.id, p]));
  const newIds = new Set(newPlans.map(p => p.id));
  const up = [], down = [];
  for (const p of newPlans) {
    const o = oldMap.get(p.id);
    if (!o) { await spAddLog(student, p, source, sourceName); continue; }
    await spLogModify(student, p, spDiffPlan(o, p), source, sourceName);
    if (spRoleOf(o) !== spRoleOf(p)) (spRoleOf(p) === 'target' ? up : down).push(p);
  }
  while (up.length && down.length) await spSwapLog(student, up.shift(), down.shift(), source, sourceName);   // 一升一降 = 对调，记一条
  for (const p of up) await spRoleLog(student, p, 'target', source, sourceName);
  for (const p of down) await spRoleLog(student, p, 'backup', source, sourceName);
  for (const o of oldMap.values()) if (!newIds.has(o.id)) await spDeleteLog(student, o, source, sourceName);
}

// ── 学生端 / VIP 页的编辑区（先目标校、再备选；每组里面照旧选级别）──
// 容器 [data-rolebox] 里有两个 [data-rolegroup="target|backup"]，每组有 .sp-grp-title 和 .sp-grp-body；单所表单带 data-role
function spEditorHtml(rootId, byRole) {   // byRole = { target: [表单html…], backup: [表单html…] }；空白表单不计入标题数字，由 spEditorRefresh 重算
  const grp = role => {
    const arr = byRole[role] || [];
    return `<div data-rolegroup="${role}" style="margin-bottom:12px${role === 'backup' && !arr.length ? ';display:none' : ''}">
      <div class="sp-grp-title" style="font-size:11px;font-weight:600;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid var(--border-light)">${spGroupTitle(role, arr.filter(h => !/data-field="school_name"[^>]*value=""|value=""[^>]*data-field="school_name"/.test(h)).length)}</div>
      <div class="sp-grp-body">${arr.join('')}</div></div>`;
  };
  return `<div id="${rootId}" data-rolebox="1">${grp('target')}${grp('backup')}</div>`;
}
function spEditorRefresh(box) {
  ['target', 'backup'].forEach(role => {
    const g = box.querySelector(`[data-rolegroup="${role}"]`); if (!g) return;
    const forms = [...g.querySelectorAll('.sp-grp-body > [data-role]')];
    g.querySelector('.sp-grp-title').textContent = spGroupTitle(role, forms.filter(spEditorFilled).length);
    if (role === 'backup') g.style.display = forms.length ? '' : 'none';
    forms.forEach(f => { const c = f.querySelector('[data-rolechip]'); if (c) spEditorChipPaint(c, role); });
  });
}
function spEditorFilled(f) { const el = f.querySelector('[data-field="school_name"]'); return !!(el && String(el.value || '').trim()); }
function spEditorChipPaint(c, role) {
  const bk = role === 'backup';
  c.textContent = bk ? '备选' : '目标';
  c.style.color = bk ? 'var(--text-3)' : '#fff';
  c.style.background = bk ? 'transparent' : 'var(--accent)';
  c.style.borderColor = bk ? 'var(--text-3)' : 'var(--accent)';
}
function spEditorMove(box, form, role) {
  const body = box.querySelector(`[data-rolegroup="${role}"] .sp-grp-body`);
  form.dataset.role = role;
  body.appendChild(form);
}
// 添加一所：目标校不到 6 所放目标校，满了自动放备选
function spEditorAdd(box, form) {
  const nT = box.querySelectorAll('[data-rolegroup="target"] .sp-grp-body > [data-role]').length;
  const role = nT < SP_TARGET_MAX ? 'target' : 'backup';
  spEditorMove(box, form, role);
  spEditorRefresh(box);
  if (role === 'backup') alert(`目标校已满 ${SP_TARGET_MAX} 所，这所加在备选里`);
  return role;
}
// 表单里的 chip 点击：目标→备选直接改；备选→目标，满 6 所时选一所对调
async function spEditorRoleClick(chip) {
  const form = chip.closest('[data-role]'), box = chip.closest('[data-rolebox]');
  if (!form || !box) return;
  if (form.dataset.role === 'target') { spEditorMove(box, form, 'backup'); spEditorRefresh(box); return; }
  const targets = [...box.querySelectorAll('[data-rolegroup="target"] .sp-grp-body > [data-role]')];
  if (targets.length < SP_TARGET_MAX) { spEditorMove(box, form, 'target'); spEditorRefresh(box); return; }
  const name = f => [...['school_name', 'faculty', 'department']].map(k => (f.querySelector(`[data-field="${k}"]`) || {}).value || '').map(x => x.trim()).filter(Boolean).join(' · ') || '（未填学校名）';
  const idx = await spPickSwap(targets.map((f, i) => ({ key: i, label: name(f) })), name(form));
  if (idx == null) return;
  spEditorMove(box, targets[idx], 'backup');
  spEditorMove(box, form, 'target');
  spEditorRefresh(box);
}
function spEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// 出愿学校列表 → 下拉选项
function spSharedOptionsHtml(sharedSchools) {
  return (sharedSchools || []).map(s =>
    `<option value="${spEsc(s.id)}" data-name="${spEsc(s.university)}" data-faculty="${spEsc(s.faculty)}" data-dept="${spEsc(s.department)}" data-period="${spEsc(s.application_period)}">${spEsc(s.university)} ${spEsc([s.department, s.course].filter(Boolean).join(' '))}</option>`
  ).join('');
}

// opts: { sharedSchools, gakubu, level（分组时的级别，写在 data-level 上）, idx（第几校）, showLevel（显示级别下拉）, role（目标/备选，带上就显示可点的 chip，并写在 data-role 上） }
function spFormHtml(p, opts) {
  p = p || {}; opts = opts || {};
  const inp = 'font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)';
  const field = (f, ph) => `<input placeholder="${ph}" value="${spEsc(p[f])}" data-field="${f}" style="${inp}">`;
  const lv = opts.level != null ? opts.level : (p.level || 2);
  const adManual = p.apply_date_manual === true;
  const adVal = adManual ? (p.apply_date || '') : spApplyDate(p.application_period, p.created_at || new Date());
  return `<div class="sp-form" style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:10px;margin-bottom:8px" data-ref="${spEsc(p.created_at)}" data-level="${lv}"${opts.role ? ` data-role="${opts.role}"` : ''}${opts.idx != null ? ` id="sr_${lv}_${opts.idx}"` : ''}>
      ${opts.idx != null || opts.role ? `<div style="display:flex;align-items:center;gap:8px;font-size:10px;font-weight:600;color:var(--text-muted,var(--text-3));margin-bottom:6px">${opts.idx != null ? `<span>第${opts.idx + 1}校</span>` : ''}${opts.role ? `<span data-rolechip="1" onclick="spEditorRoleClick(this)" title="点击切换目标校 / 备选" style="display:inline-block;font-size:10px;line-height:1;padding:2px 6px;border-radius:8px;border:1px solid var(--accent);color:#fff;background:var(--accent);cursor:pointer">目标</span>` : ''}</div>` : ''}
      ${opts.showLevel ? `<select data-field="level" style="${inp};width:100%;margin-bottom:6px">${[[1, '冲刺（挑战）'], [2, '匹配（目标）'], [3, '保底']].map(([v, l]) => `<option value="${v}" ${String(lv) === String(v) ? 'selected' : ''}>级别：${l}</option>`).join('')}</select>` : ''}
      <select onchange="spApplyShared(this)" style="${inp};width:100%;margin-bottom:6px">
        <option value="">— 从共享列表选择 —</option>
        ${spSharedOptionsHtml(opts.sharedSchools)}
      </select>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px">
        ${field('school_name', '学校名 *')}${field('faculty', '研究科')}${field('department', '専攻/コース')}
        <input placeholder="出愿时间（精确）" value="${spEsc(p.application_period)}" data-field="application_period" oninput="spAdAuto(this)" style="${inp}">${field('exam_date', '考试日期')}${field('documents_required', '必要书类（推荐信等）')}
      </div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:5px;font-size:11px">
        <span style="color:var(--text-3)">出愿日期（标准）</span>
        <input type="date" value="${spEsc(adVal)}" data-field="apply_date" oninput="spAdManual(this)" style="${inp}">
        <span data-adnote="1" style="font-size:10px;color:${adManual ? 'var(--accent)' : 'var(--text-3)'}">${adManual ? '手动' : '自动'}</span>
        <button type="button" onclick="spAdRecalc(this)" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 8px;cursor:pointer;color:var(--text-3);font-family:inherit">按文字重算</button>
        <input type="hidden" value="${adManual ? 1 : 0}" data-field="apply_date_manual">
      </div>
      <div style="font-size:10px;color:var(--text-muted,var(--text-3));margin-bottom:4px">👤 教授（每校尽量2位）</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px">
        ${field('professor', '教授1姓名')}${field('professor_url', '教授1研究内容URL')}${field('professor2', '教授2姓名')}${field('professor2_url', '教授2研究内容URL')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
        ${field('plan_requirement', opts.gakubu ? '志望理由书要求（字数/格式）' : '计划书要求（字数/格式）')}${field('research_theme', '研究课题（目前方向）')}
      </div>
      <div style="font-size:10px;color:var(--text-muted,var(--text-3));margin:6px 0 4px">📌 该校进度</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">
        <select data-field="status" style="${inp};flex:1;min-width:180px">
          ${Object.entries(SCHOOL_STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${(p.status || 'preparing') === k ? 'selected' : ''}>${v.t}</option>`).join('')}
        </select>
        ${[['kakomon_started', '✏️ 过去问已开始'], ['interview_draft_done', '🎤 面试稿已完成']].map(([f, l]) => {
          const on = !!p[f];
          return `<span onclick="spToggleChip(this)" data-field="${f}" data-on="${on ? 1 : 0}" style="font-size:11px;padding:4px 10px;border-radius:2px;cursor:pointer;user-select:none;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'var(--surface)'};color:${on ? '#fff' : 'var(--text-secondary,var(--text-2))'}">${l}</span>`;
        }).join('')}
      </div>
      <input type="hidden" value="${spEsc(p.id)}" data-field="id">
    </div>`;
}

// 从出愿学校列表带入（出愿期不自动带入：共享列表多为「8月上旬」类概略值，保留手填的精确日期）
function spApplyShared(sel) {
  if (!sel.value) return;
  const opt = sel.options[sel.selectedIndex];
  const row = sel.closest('.sp-form') || sel.closest('[data-level]');
  if (!row) return;
  const set = (f, v) => { const el = row.querySelector(`[data-field="${f}"]`); if (el) el.value = v; };
  set('school_name', opt.dataset.name || '');
  set('faculty', opt.dataset.faculty || '');
  set('department', opt.dataset.dept || '');
  sel.value = '';
}
function spToggleChip(el) {
  const on = el.dataset.on === '1';
  el.dataset.on = on ? '0' : '1';
  el.style.border = '1px solid ' + (on ? 'var(--border)' : 'var(--accent)');
  el.style.background = on ? 'var(--surface)' : 'var(--accent)';
  el.style.color = on ? 'var(--text-secondary,var(--text-2))' : '#fff';
}

function spFormCollect(root) {
  const get = f => { const el = root.querySelector(`input[data-field="${f}"], select[data-field="${f}"]`); return el ? String(el.value || '').trim() : ''; };
  const chip = f => { const el = root.querySelector(`span[data-field="${f}"]`); return el ? el.dataset.on === '1' : false; };
  return {
    id: get('id'), plan_role: root.dataset.role === 'backup' ? 'backup' : 'target', level: parseInt(get('level') || root.dataset.level || '2') || 2,
    status: get('status') || 'preparing', kakomon_started: chip('kakomon_started'), interview_draft_done: chip('interview_draft_done'),
    school_name: get('school_name'), faculty: get('faculty'), department: get('department'),
    application_period: get('application_period'), exam_date: get('exam_date'),
    apply_date: get('apply_date') || null, apply_date_manual: get('apply_date_manual') === '1',
    professor: get('professor'), professor_url: get('professor_url'), professor2: get('professor2'), professor2_url: get('professor2_url'),
    plan_requirement: get('plan_requirement'), research_theme: get('research_theme'), documents_required: get('documents_required'),
  };
}

// 出愿期间 → 考试季
function spGuessSeason(period) {
  const m = String(period || '').match(/(\d{1,2})\s*月/);
  if (!m) return null;
  const mo = parseInt(m[1]);
  if (mo >= 5 && mo <= 9) return 'summer';
  if (mo >= 10 || mo === 1) return 'winter';
  return 'next_year';
}

// 按学生专业读取出愿学校列表（和学生端一样：学生专业 + 其 key / 名称都去匹配）
function spMajorCands(student) {
  const cands = new Set();
  [student && student.major].filter(Boolean).forEach(v => {
    cands.add(v);
    if (typeof generateMajorKey === 'function') { try { const k = generateMajorKey(v); if (k) cands.add(k); } catch (e) {} }
    if (typeof majorLabel === 'function') { try { const l = majorLabel(v); if (l) cands.add(l); } catch (e) {} }
  });
  return cands;
}
async function spLoadSharedSchools(student) {
  const cands = spMajorCands(student);
  if (!cands.size) return [];
  const inList = [...cands].map(m => `"${String(m).replace(/"/g, '')}"`).join(',');
  const lists = await sb(`/rest/v1/teacher_school_shares?major=in.(${inList})&select=*&order=created_at.desc&limit=3`).catch(() => []);
  const ids = (lists || []).flatMap(sl => sl.school_ids || []);
  if (!ids.length) return [];
  return await sb(`/rest/v1/admission_schools?id=in.(${ids.map(id => `"${id}"`).join(',')})&select=id,university,faculty,department,course,application_period&order=application_period.asc`).catch(() => []) || [];
}

// ── 老师端 / 管理端：添加・编辑弹窗 ──
// opts: { student, plan（编辑时）, plans（这个学生现有的志望校）, onDone(), prefill（可选：出愿数据库的一行 {university, faculty, department}，新增时带入学校名・研究科・専攻） }
let spModalCtx = null;
let spModalSnap = null, spModalPrevOverflow = null;
// 关弹窗（并恢复背景页面滚动）
function spModalRemove() {
  document.getElementById('spSchoolModal')?.remove();
  if (spModalPrevOverflow !== null) { document.body.style.overflow = spModalPrevOverflow; spModalPrevOverflow = null; }
  spModalSnap = null;
}
// 取消 / ×：表单里改过东西先确认；没改直接关
function spModalClose() {
  const root = document.querySelector('#sp_modal_form .sp-form');
  if (root && spModalSnap !== null && JSON.stringify(spFormCollect(root)) !== spModalSnap && !confirm('填写的内容还没保存，确定关闭吗？')) return;
  spModalRemove();
}
async function spOpenModal(opts) {
  const { student, plan } = opts;
  spModalRemove();
  const m = document.createElement('div');
  m.id = 'spSchoolModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:18px;max-width:820px;width:100%;max-height:90vh;overflow-y:auto">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px"><div style="font-size:13px;font-weight:600">${plan ? '编辑志望校' : '＋ 添加志望校'} — ${spEsc(student.name)}</div><button onclick="spModalClose()" title="关闭" style="font-size:18px;line-height:1;background:none;border:none;cursor:pointer;color:var(--text-3);padding:0 4px;font-family:inherit">×</button></div>
    <div id="sp_modal_form"><div style="font-size:11px;color:var(--text-3);padding:12px 0">读取出愿学校列表…</div></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
      <button onclick="spModalClose()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">取消</button>
      <button id="sp_modal_save" onclick="spModalSave()" style="font-size:12px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:3px;padding:7px 18px;cursor:pointer;font-family:inherit;font-weight:500">保存</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  spModalPrevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';   // 弹窗开着时背景页面不跟着滚
  spModalCtx = opts;
  const shared = await spLoadSharedSchools(student);
  const box = document.getElementById('sp_modal_form');
  if (box && spModalCtx === opts) {
    box.innerHTML = spFormHtml(plan || spPrefillPlan(opts.prefill), { sharedSchools: shared, gakubu: (typeof isGakubuStudent === 'function') && isGakubuStudent(student), showLevel: true });
    const root = box.querySelector('.sp-form');
    if (root) spModalSnap = JSON.stringify(spFormCollect(root));   // 打开时的内容，关闭时比较有没有改过
  }
}
function spPrefillPlan(pf) {
  return pf ? { school_name: pf.university || '', faculty: pf.faculty || '', department: pf.department || '' } : {};
}
async function spModalSave() {
  const ctx = spModalCtx; if (!ctx) return;
  const root = document.querySelector('#sp_modal_form .sp-form'); if (!root) return;
  const v = spFormCollect(root);
  if (!v.school_name) { alert('请填写学校名'); return; }
  const { student, plan } = ctx;
  const row = Object.assign({}, v, { exam_season: spGuessSeason(v.application_period) });
  Object.assign(row, spApplyFields(row, plan && plan.created_at));
  delete row.id; delete row.plan_role;   // 目标 / 备选只由 chip 切换，编辑弹窗不改它
  let addedRole = null;
  const btn = document.getElementById('sp_modal_save'); if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    if (plan) {
      const changes = spDiffPlan(plan, row);
      await sb(`/rest/v1/student_school_plans?id=eq.${encodeURIComponent(plan.id)}`, 'PATCH', row);
      Object.assign(plan, row);
      await spLogModify(student, plan, changes, ctx.source || 'admin', ctx.sourceName || '管理员');
    } else {
      const cur = await sb(`/rest/v1/student_school_plans?student_id=eq.${encodeURIComponent(student.id)}&select=id,plan_role`, 'GET', null, { cache: 'no-store' }).catch(() => ctx.plans || []);
      addedRole = spSplit(cur || []).targets.length < SP_TARGET_MAX ? 'target' : 'backup';   // 前 6 所是目标校，之后是备选
      Object.assign(row, { id: `ssp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, student_id: student.id, student_name: student.name, major: student.major || '', plan_role: addedRole });
      await sb('/rest/v1/student_school_plans', 'POST', row);
      await spAddLog(student, row, ctx.source || 'admin', ctx.sourceName || '管理员');
    }
    spModalRemove();
    spModalCtx = null;
    if (addedRole === 'backup') alert(`目标校已满 ${SP_TARGET_MAX} 所，这所加在备选里`);
    if (ctx.onDone) ctx.onDone();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
    alert('保存失败：' + e.message);
  }
}

// 删除时写进时间线的文字：删除志望校（备选）：東京大学 · 総合文化研究科 · ○○専攻（原进度：准备中）
function spDeleteNote(p) {
  const st = (SCHOOL_STATUS_LABELS[p.status || 'preparing'] || {}).t || p.status || '';
  return `删除志望校（${spRoleName(spRoleOf(p))}）：${spPlanTitle(p)}${st ? `（原进度：${st}）` : ''}`;
}
function spDeleteLog(student, p, source, sourceName) {
  const entry = makeProgressEntry({ studentId: student.id, studentName: student.name, major: student.major, source, sourceName, notes: spDeleteNote(p), recordedAt: new Date().toISOString().slice(0, 10) });
  return sb('/rest/v1/student_progress_timeline', 'POST', entry).then(() => entry).catch(() => null);
}
// 老师端 / 管理端删除一所志望校（确认框写出学校名）
async function spDeletePlan(student, p, source, sourceName, onDone) {
  const name = [p.school_name, p.faculty, p.department].filter(Boolean).join(' · ');
  if (!confirm(`删除志望校「${name}」？\n学生端也会同步删除，考学进度时间线里会留下一条删除记录。`)) return;
  try {
    await sb(`/rest/v1/student_school_plans?id=eq.${encodeURIComponent(p.id)}`, 'DELETE');
    await spDeleteLog(student, p, source, sourceName);
    if (onDone) onDone();
  } catch (e) { alert('删除失败：' + e.message); }
}

// 面谈时选了「已择校」但还没有志望校：提醒（bookings = 这个学生的面谈预约，按日期新→旧）
function spChosenWarnHtml(bookings, planCount, addJs) {
  if (planCount) return '';
  const last = (bookings || []).find(b => String(b.target_school || '').trim());
  if (!last || String(last.target_school).trim() !== '已择校') return '';
  const d = String(last.slot_date || '');
  const md = /^\d{4}-\d{2}-\d{2}/.test(d) ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : d;
  return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fdf1e6;border:1px solid #e8c9a8;border-radius:3px;padding:7px 10px;margin-bottom:8px;font-size:11px;color:#a0521a">
    <span>⚠ 学生面谈时选了「已择校」${md ? `（${md}）` : ''}，但还没有填写志望校</span>
    <button onclick="event.stopPropagation();${addJs}" style="margin-left:auto;font-size:10px;background:#a0521a;color:#fff;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit">＋ 添加志望校</button>
  </div>`;
}


// ══════════════════════════════════
// 目标学校 → 出愿数据库找学校 → 加入志望校（管理端、老师端考学进度卡片共用）
// 学生档案「目标学校」是一段自由文本；这里从文本里认出出愿数据库里出现过的大学。
// 步骤：只拉大学名清单（去重）来比对 → 比上的几所再按大学名查出愿数据（不把整张表拉下来）
// ══════════════════════════════════

// 简体 / 繁体 → 日文常用字（比对前文本和大学名都统一成这一套）
const SP_CHAR_MAP = (() => {
  const pairs = '东東 稻稲 庆慶 应應 応應 桥橋 学学 學学 国国 國国 医医 醫医 艺芸 藝芸 术術 际際 经経 經経 济済 濟済 总総 總総 综総 綜総 业業 關関 关関 馆館 义義 习習 广広 廣広 岛島 户戸 戶戸 滨浜 濱浜 橫横 叶葉 数数 數数 体体 體体 会会 會会 师師 范範 电電 机機 药薬 藥薬 农農 环環 产産 创創 资資 与与 对対 對対 实実 實実 传伝 傳伝 边辺 邊辺 齐斉 齊斉 台台 臺台 圣聖 聖聖 圆円 圓円 渊淵 浅浅 泽沢 澤沢 区区 區区 辞辞 辭辞 乐楽 樂楽 画画 畫画 当当 當当 种種 觉覚 覺覚 测測 測測 视視 號号 号号 礼礼 禮礼 来来 來来 单単 單単 双双 雙双 兴興 興興 竞競 競競 计計 計計 设設 設設 语語 語語 运運 運運 动動 動動 历歴 歷歴 史史 压圧 壓圧 营営 營営 违違 訳訳 译訳 譯訳 摄摂 攝摂 圣聖'.split(/\s+/);
  const m = {};
  pairs.forEach(p => { if (p.length === 2) m[p[0]] = p[1]; });
  return m;
})();
function spNormName(v) {
  return String(v == null ? '' : v).normalize('NFKC').replace(/[\s\u3000]+/g, '').toLowerCase()
    .replace(/[\u3400-\u9fff]/g, ch => SP_CHAR_MAP[ch] || ch);
}
// 简称 → 全称（只写出愿数据库里可能有的大学；全称不在数据库里就自动忽略）
const SP_UNIV_ALIAS = {
  '一橋': '一橋大学', '東大': '東京大学', '京大': '京都大学', '阪大': '大阪大学', '名大': '名古屋大学', '北大': '北海道大学',
  '九大': '九州大学', '東北': '東北大学', '東工大': '東京工業大学', '東京工大': '東京工業大学', '東外大': '東京外国語大学', '東京外大': '東京外国語大学',
  '外大': '東京外国語大学', '早大': '早稲田大学', '早稲田': '早稲田大学', '慶大': '慶應義塾大学', '慶應': '慶應義塾大学', '慶應大': '慶應義塾大学',
  '上智': '上智大学', '明治': '明治大学', '法政': '法政大学', '立教': '立教大学', '中央': '中央大学', '青学': '青山学院大学', '青山': '青山学院大学',
  '学習院': '学習院大学', '同志社': '同志社大学', '立命館': '立命館大学', '関学': '関西学院大学', '関大': '関西大学', '筑波': '筑波大学',
  '神戸': '神戸大学', '横国': '横浜国立大学', '千葉': '千葉大学', '都立': '東京都立大学', '首都大': '東京都立大学', '芸大': '東京藝術大学',
  '東京芸大': '東京藝術大学', '医科歯科': '東京医科歯科大学', 'お茶大': 'お茶の水女子大学', 'お茶の水': 'お茶の水女子大学', 'icu': '国際基督教大学',
  '日大': '日本大学', '東洋': '東洋大学', '専修': '専修大学', '広島': '広島大学', '北海道': '北海道大学', '名古屋': '名古屋大学',
};
let spUnivNamesCache = null;
// 出愿数据库里的大学名清单（去重；只拉一列，且整个页面只拉一次）
function spLoadUnivNames() {
  if (!spUnivNamesCache) {
    spUnivNamesCache = sbAll('/rest/v1/admission_schools?select=university&order=id.asc').then(rows => {
      const set = new Set();
      (rows || []).forEach(r => { const u = String(r.university || '').trim(); if (u) set.add(u); });
      return [...set];
    }).catch(e => { spUnivNamesCache = null; throw e; });
  }
  return spUnivNamesCache;
}
// 从文本里认出大学：返回出愿数据库里的大学名（原写法）。找到的部分会从文本里划掉，避免「東京大学」里的「京大」再被认成京都大学
function spMatchUniversities(text, univNames) {
  const byKey = new Map();
  (univNames || []).forEach(u => { const k = spNormName(u); if (k) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(u); } });
  let T = spNormName(text);
  if (!T) return [];
  const hit = new Set();
  const take = (key, via) => {
    if (!key || !T.includes(key)) return;
    T = T.split(key).join('\u0000');
    (byKey.get(via) || []).forEach(u => hit.add(u));
  };
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length);
  keys.forEach(k => take(k, k));                                                       // 1. 全称
  keys.map(k => [k.replace(/大学$/, ''), k]).filter(([st, k]) => st !== k && st.length >= 3)
    .sort((a, b) => b[0].length - a[0].length).forEach(([st, k]) => take(st, k));      // 2. 去掉「大学」的名字（3 个字以上才算）
  Object.entries(SP_UNIV_ALIAS).filter(([, full]) => full).map(([a, full]) => [spNormName(a), spNormName(full)])
    .filter(([, full]) => byKey.has(full)).sort((a, b) => b[0].length - a[0].length).forEach(([a, full]) => take(a, full));   // 3. 简称
  return [...hit];
}

const SP_FIND = {};      // 学生id → { loading, err, matched:[大学名], rows:[出愿数据库的行], open:Set(其他专业展开的大学名) }
const SP_FIND_CTX = {};  // 学生id → { s, plans, h }（卡片每次重绘时更新）
function spJs(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

// 考学进度卡片里的「目标学校」框（学生档案没写目标学校时返回空）。h = 卡片的 { schoolAdd } 函数名
function spTargetBoxHtml(s, plans, h) {
  const txt = String((s && s.target_school) || '').trim();
  if (!txt) return '';
  SP_FIND_CTX[s.id] = { s, plans: plans || [], h: h || {} };
  const id = spJs(s.id);
  return `<div style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:8px 10px;margin-bottom:8px">
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="flex:1;min-width:0"><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">目标学校（学生档案里写的）</div>
        <div style="font-size:11px;color:var(--text-2);white-space:pre-wrap;word-break:break-all;line-height:1.6">${spEsc(txt)}</div></div>
      <button class="pgc-btn" style="flex-shrink:0" onclick="event.stopPropagation();spFindRun('${id}')">从出愿数据库找学校</button>
    </div>
    <div id="spfind_${spEsc(s.id)}" onclick="event.stopPropagation()">${spFindResultHtml(s.id)}</div>
  </div>`;
}

async function spFindRun(sid) {
  const ctx = SP_FIND_CTX[sid]; if (!ctx) return;
  SP_FIND[sid] = { loading: true, open: new Set() };
  spFindRefresh(sid);
  try {
    const names = await spLoadUnivNames();
    const matched = spMatchUniversities(ctx.s.target_school, names);
    let rows = [];
    if (matched.length) {
      const inList = matched.map(u => `"${u.replace(/"/g, '')}"`).join(',');
      rows = await sbAll(`/rest/v1/admission_schools?university=in.(${encodeURIComponent(inList)})&select=id,major,university,faculty,department,course&order=id.asc`);
    }
    SP_FIND[sid] = { matched, rows: rows || [], open: new Set() };
  } catch (e) { SP_FIND[sid] = { err: e.message || String(e), open: new Set() }; }
  spFindRefresh(sid);
}
function spFindRefresh(sid) {
  const el = document.getElementById('spfind_' + sid);
  if (el) el.innerHTML = spFindResultHtml(sid);
}
function spFindToggle(sid, ui) {
  const st = SP_FIND[sid]; if (!st) return;
  if (st.open.has(ui)) st.open.delete(ui); else st.open.add(ui);
  spFindRefresh(sid);
}

function spFindResultHtml(sid) {
  const st = SP_FIND[sid], ctx = SP_FIND_CTX[sid];
  if (!st || !ctx) return '';
  const wrap = inner => `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-light)">${inner}</div>`;
  if (st.loading) return wrap('<span style="font-size:11px;color:var(--text-3)">查找中…</span>');
  if (st.err) return wrap(`<span style="font-size:11px;color:var(--danger)">查找失败：${spEsc(st.err)}</span>`);
  if (!st.matched.length) return wrap('<span style="font-size:11px;color:var(--text-3)">没认出出愿数据库里的学校，可以直接点「＋ 添加志望校」手动加</span>');
  const cands = spMajorCands(ctx.s), plans = ctx.plans || [];
  const n = v => adgNorm(spNormName(v));
  const inPlans = r => plans.some(p => n(p.school_name) === n(r.university) && n(p.faculty) === n(r.faculty)
    && (n(p.department) === n(r.department) || n(p.department) === n([r.department, r.course].filter(Boolean).join(' '))));
  st.flat = [];
  const jsId = spJs(sid);
  const line = (r, showMajor) => {
    const idx = st.flat.push({ university: r.university, faculty: r.faculty || '', department: [r.department, r.course].filter(x => adgNorm(x)).join(' ') }) - 1;
    const label = [r.faculty, r.department, r.course].filter(x => adgNorm(x)).map(spEsc).join(' · ') || '（未分研究科）';
    const mj = showMajor ? `<span style="color:var(--text-3);margin-right:6px">[${spEsc((typeof majorLabel === 'function' && majorLabel(r.major)) || r.major)}]</span>` : '';
    const act = inPlans(r) ? '<span style="font-size:10px;color:var(--ok)">已在志望校</span>'
      : `<button class="pgc-btn" style="font-size:10px;padding:2px 8px" onclick="event.stopPropagation();spFindAdd('${jsId}',${idx})">加入志望校</button>`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px;border-bottom:1px solid var(--border-light)"><span style="flex:1;min-width:0">${mj}${label}</span>${act}</div>`;
  };
  const groups = u => {   // 同一所大学内按 adgGroupKey 归并
    const m = new Map();
    st.rows.filter(r => r.university === u).forEach(r => { const k = adgGroupKey(r); if (!m.has(k)) m.set(k, r); });
    return [...m.values()].sort((a, b) => [a.faculty, a.department, a.course].join('|').localeCompare([b.faculty, b.department, b.course].join('|'), 'ja'));
  };
  const html = st.matched.map(u => {
    const all = groups(u), own = all.filter(r => cands.has(r.major)), other = all.filter(r => !cands.has(r.major));
    const open = st.open.has(u), ju = spJs(u);
    return `<div style="margin-bottom:10px">
      <span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 10px;border:1px solid var(--accent);border-radius:10px;color:var(--accent);margin-bottom:4px">${spEsc(u)}</span>
      ${own.length ? own.map(r => line(r, false)).join('') : '<div style="font-size:11px;color:var(--text-3);padding:2px 0">本专业暂时没有这所学校的出愿数据</div>'}
      ${other.length ? `<div style="margin-top:4px"><span onclick="event.stopPropagation();spFindToggle('${jsId}','${ju}')" style="font-size:10px;color:var(--accent);cursor:pointer">其他专业 ${other.length} ${open ? '▲' : '▼'}</span>${open ? other.map(r => line(r, true)).join('') : ''}</div>` : ''}
    </div>`;
  }).join('');
  return wrap(html);
}
function spFindAdd(sid, idx) {
  const st = SP_FIND[sid], ctx = SP_FIND_CTX[sid];
  if (!st || !ctx || !st.flat || !st.flat[idx]) return;
  const fn = ctx.h && window[ctx.h.schoolAdd];
  if (typeof fn === 'function') fn(sid, st.flat[idx]);
}
