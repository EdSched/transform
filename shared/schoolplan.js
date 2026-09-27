// ══════════════════════════════════
// schoolplan.js — 志望校单所表单（学生端 / 老师端 / 管理端共用，同一张表 student_school_plans）
// spFormHtml(plan, opts)：一所学校的完整表单（可从「出愿学校列表」一键带入）
// spFormCollect(root)：读出表单里的值
// spOpenModal(...)：老师端 / 管理端的添加・编辑弹窗；spDeletePlan(...)：删除并写一条时间线记录
// 依赖：shared/supabase.js、shared/constants.js（SCHOOL_STATUS_LABELS、makeProgressEntry）
// ══════════════════════════════════

const SP_MAX_SCHOOLS = 6;
function spEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// 出愿学校列表 → 下拉选项
function spSharedOptionsHtml(sharedSchools) {
  return (sharedSchools || []).map(s =>
    `<option value="${spEsc(s.id)}" data-name="${spEsc(s.university)}" data-faculty="${spEsc(s.faculty)}" data-dept="${spEsc(s.department)}" data-period="${spEsc(s.application_period)}">${spEsc(s.university)} ${spEsc([s.department, s.course].filter(Boolean).join(' '))}</option>`
  ).join('');
}

// opts: { sharedSchools, gakubu, level（分组时的级别，写在 data-level 上）, idx（第几校）, showLevel（弹窗里显示级别下拉） }
function spFormHtml(p, opts) {
  p = p || {}; opts = opts || {};
  const inp = 'font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)';
  const field = (f, ph) => `<input placeholder="${ph}" value="${spEsc(p[f])}" data-field="${f}" style="${inp}">`;
  const lv = opts.level != null ? opts.level : (p.level || 2);
  return `<div class="sp-form" style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:10px;margin-bottom:8px" data-level="${lv}"${opts.idx != null ? ` id="sr_${lv}_${opts.idx}"` : ''}>
      ${opts.idx != null ? `<div style="font-size:10px;font-weight:600;color:var(--text-muted,var(--text-3));margin-bottom:6px">第${opts.idx + 1}校</div>` : ''}
      ${opts.showLevel ? `<select data-field="level" style="${inp};width:100%;margin-bottom:6px">${[[1, '冲刺（挑战）'], [2, '匹配（目标）'], [3, '保底']].map(([v, l]) => `<option value="${v}" ${String(lv) === String(v) ? 'selected' : ''}>级别：${l}</option>`).join('')}</select>` : ''}
      <select onchange="spApplyShared(this)" style="${inp};width:100%;margin-bottom:6px">
        <option value="">— 从共享列表选择 —</option>
        ${spSharedOptionsHtml(opts.sharedSchools)}
      </select>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px">
        ${field('school_name', '学校名 *')}${field('faculty', '研究科')}${field('department', '専攻/コース')}
        ${field('application_period', '出愿时间（精确）')}${field('exam_date', '考试日期')}${field('documents_required', '必要书类（推荐信等）')}
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
    id: get('id'), level: parseInt(get('level') || root.dataset.level || '2') || 2,
    status: get('status') || 'preparing', kakomon_started: chip('kakomon_started'), interview_draft_done: chip('interview_draft_done'),
    school_name: get('school_name'), faculty: get('faculty'), department: get('department'),
    application_period: get('application_period'), exam_date: get('exam_date'),
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
async function spLoadSharedSchools(student) {
  const cands = new Set();
  [student && student.major].filter(Boolean).forEach(v => {
    cands.add(v);
    if (typeof generateMajorKey === 'function') { try { const k = generateMajorKey(v); if (k) cands.add(k); } catch (e) {} }
    if (typeof majorLabel === 'function') { try { const l = majorLabel(v); if (l) cands.add(l); } catch (e) {} }
  });
  if (!cands.size) return [];
  const inList = [...cands].map(m => `"${String(m).replace(/"/g, '')}"`).join(',');
  const lists = await sb(`/rest/v1/teacher_school_shares?major=in.(${inList})&select=*&order=created_at.desc&limit=3`).catch(() => []);
  const ids = (lists || []).flatMap(sl => sl.school_ids || []);
  if (!ids.length) return [];
  return await sb(`/rest/v1/admission_schools?id=in.(${ids.map(id => `"${id}"`).join(',')})&select=id,university,faculty,department,course,application_period&order=application_period.asc`).catch(() => []) || [];
}

// ── 老师端 / 管理端：添加・编辑弹窗 ──
// opts: { student, plan（编辑时）, plans（这个学生现有的志望校）, onDone() }
let spModalCtx = null;
async function spOpenModal(opts) {
  const { student, plan } = opts;
  if (!plan && (opts.plans || []).length >= SP_MAX_SCHOOLS) { alert(`最多 ${SP_MAX_SCHOOLS} 所志望校，请先删除一所再添加`); return; }
  document.getElementById('spSchoolModal')?.remove();
  const m = document.createElement('div');
  m.id = 'spSchoolModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:18px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">${plan ? '编辑志望校' : '＋ 添加志望校'} — ${spEsc(student.name)}</div>
    <div id="sp_modal_form"><div style="font-size:11px;color:var(--text-3);padding:12px 0">读取出愿学校列表…</div></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
      <button onclick="document.getElementById('spSchoolModal').remove()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">取消</button>
      <button id="sp_modal_save" onclick="spModalSave()" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 18px;cursor:pointer;font-family:inherit;font-weight:500">保存</button>
    </div>
  </div>`;
  m.onclick = e => { if (e.target === m) m.remove(); };
  document.body.appendChild(m);
  spModalCtx = opts;
  const shared = await spLoadSharedSchools(student);
  const box = document.getElementById('sp_modal_form');
  if (box && spModalCtx === opts) box.innerHTML = spFormHtml(plan || {}, { sharedSchools: shared, gakubu: (typeof isGakubuStudent === 'function') && isGakubuStudent(student), showLevel: true });
}
async function spModalSave() {
  const ctx = spModalCtx; if (!ctx) return;
  const root = document.querySelector('#sp_modal_form .sp-form'); if (!root) return;
  const v = spFormCollect(root);
  if (!v.school_name) { alert('请填写学校名'); return; }
  const { student, plan } = ctx;
  const row = Object.assign({}, v, { exam_season: spGuessSeason(v.application_period) });
  delete row.id;
  const btn = document.getElementById('sp_modal_save'); if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    if (plan) {
      await sb(`/rest/v1/student_school_plans?id=eq.${encodeURIComponent(plan.id)}`, 'PATCH', row);
      Object.assign(plan, row);
    } else {
      const cur = await sb(`/rest/v1/student_school_plans?student_id=eq.${encodeURIComponent(student.id)}&select=id`).catch(() => ctx.plans || []);
      if ((cur || []).length >= SP_MAX_SCHOOLS) throw new Error(`最多 ${SP_MAX_SCHOOLS} 所志望校，请先删除一所再添加`);
      Object.assign(row, { id: `ssp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, student_id: student.id, student_name: student.name, major: student.major || '' });
      await sb('/rest/v1/student_school_plans', 'POST', row);
    }
    document.getElementById('spSchoolModal')?.remove();
    spModalCtx = null;
    if (ctx.onDone) ctx.onDone();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
    alert('保存失败：' + e.message);
  }
}

// 删除时写进时间线的文字：删除志望校：東京大学 · 総合文化研究科 · ○○専攻（原进度：准备中）
function spDeleteNote(p) {
  const st = (SCHOOL_STATUS_LABELS[p.status || 'preparing'] || {}).t || p.status || '';
  return `删除志望校：${[p.school_name, p.faculty, p.department].filter(Boolean).join(' · ')}${st ? `（原进度：${st}）` : ''}`;
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
