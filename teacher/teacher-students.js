// 兜底：若 shared/constants.js 尚未更新到含 schoolLevelHtml，就地补一个，避免整页卡「加载中」
if (typeof window !== "undefined" && typeof window.schoolLevelHtml !== "function") {
  window.schoolLevelHtml = function (lv) { var m = ({1:{t:"冲刺",c:"#c0392b"},2:{t:"匹配",c:"#b8860b"},3:{t:"保底",c:"#2a7a3a"}})[lv]; return m ? "<span style=\"color:" + m.c + ";font-weight:600\">" + m.t + "</span>" : ""; };
}
// ══════════════════════════════════
// teacher-students.js — 学生管理模块
// 考学进度 / 面谈查询 / 出席・作业记录 / 学生档案（含筛选、节点总结、计划书内容渲染）
// 依赖：shared/constants.js、shared/supabase.js、teacher.js（须在其后加载）
// ══════════════════════════════════

let teacherProgressData = { students: [], timeline: {}, schoolPlans: {}, planDrafts: {} };

const TP_SOURCES = ['唯新','新世界','校内塾','杭州校'];

// 按专业筛选值展开成实际专业列表
function tpMajorMatch(major, filterVal) {
  if (!filterVal) return true;
  if (isMajorGroup(filterVal)) return groupMajors(filterVal).includes(major) || major === filterVal;
  return major === filterVal;
}

async function renderTeacherStudyProgress(mc) {
  mc.innerHTML = '<div class="empty">加载中…</div>';

  // 与 admin 学生档案同步：显示允许专业范围内的全部在籍学生（数据只在进入时拉取一次，筛选纯前端）
  let students = [];
  try {
    const all = await sb('/rest/v1/students?select=*&order=name.asc&limit=2000');
    students = tsaFilterStudents(all);   // 全部状态；由全局「状态」筛选
    if (tsaGuaranteedLock()) students = students.filter(tsaIsGuaranteed);
  } catch (e) { mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }

  if (!students.length) {
    mc.innerHTML = `<div class="empty">${tsaScope().vipOnly ? '暂无你指导的 VIP 学生' : '可见范围内暂无学生'}</div>`;
    return;
  }

  // 分批拉取时间线/志望校/计划书（每批80个学生，避免URL过长）
  const stuIds = students.map(s => s.id);
  const chunkFetch = async build => {
    let out = [];
    for (let i = 0; i < stuIds.length; i += 80) {
      const ids = stuIds.slice(i, i + 80).map(id => `"${id}"`).join(',');
      const batch = await sb(build(ids)).catch(() => []);
      out = out.concat(batch || []);
    }
    return out;
  };
  const [allTimeline, allPlans, allDrafts, allRiyu] = await Promise.all([
    chunkFetch(ids => `/rest/v1/student_progress_timeline?student_id=in.(${ids})&select=*&order=created_at.asc`),
    chunkFetch(ids => `/rest/v1/student_school_plans?student_id=in.(${ids})&select=*&order=level.asc`),
    chunkFetch(ids => `/rest/v1/student_plan_drafts?student_id=in.(${ids})&select=*&order=updated_at.desc`),
    chunkFetch(ids => `/rest/v1/riyu_submissions?student_id=in.(${ids})&select=*`),   // 新版志望理由书（表未建时为空）
  ]);
  // 出愿材料：清单 + 各学生准备情况（表未建时为空）
  const [matItems, allMats] = await Promise.all([
    (typeof matLoadItems === 'function' ? matLoadItems('') : Promise.resolve([])).catch(() => []),
    chunkFetch(ids => `/rest/v1/student_materials?student_id=in.(${ids})&select=*`),
  ]);
  const matsMap = {};
  (allMats || []).forEach(r => { (matsMap[r.student_id] = matsMap[r.student_id] || []).push(r); });
  // 面谈预约里的「目标校」栏是择校状态（已择校 / 择校中 / 未择校）：用于「已择校但没填志望校」提醒
  const allBk = await chunkFetch(ids => `/rest/v1/bookings?student_id=in.(${ids})&target_school=not.is.null&select=student_id,target_school,slot_date&order=slot_date.desc`);
  const bkMap = {};
  (allBk || []).forEach(b => { (bkMap[b.student_id] = bkMap[b.student_id] || []).push(b); });

  const timelineMap = {}, plansMap = {}, draftsMap = {}, riyuSubsMap = {};
  (allRiyu || []).forEach(r => { (riyuSubsMap[r.student_id] = riyuSubsMap[r.student_id] || []).push(r); });
  allTimeline.forEach(t => { if (!timelineMap[t.student_id]) timelineMap[t.student_id] = []; timelineMap[t.student_id].push(t); });
  allPlans.forEach(p => { if (!plansMap[p.student_id]) plansMap[p.student_id] = []; plansMap[p.student_id].push(p); });
  allDrafts.forEach(d => { if (!draftsMap[d.student_id]) draftsMap[d.student_id] = d; });

  teacherProgressData = { students, timelineMap, plansMap, draftsMap, riyuSubsMap, matItems: matItems || [], matsMap, bkMap };
  try { tpRenderShell(); }
  catch (e) { mc.innerHTML = `<div class="empty" style="color:var(--danger)">考学进度渲染失败：${(e && e.message) || e}</div>`; console.error('tpRenderShell error:', e); }
}

// 外壳：标题/搜索/专业/来源筛选 + 列表容器（切换筛选时重绘外壳，搜索输入只刷新列表保持焦点）
function tpRenderShell() {
  const box = document.getElementById('sm_content') || document.getElementById('mainContent');
  if (!box || !teacherProgressData) return;
  box.innerHTML = `
  <div class="page-header">
    <div class="section-title">考学进度 <span class="badge-count" id="tp_count"></span></div>
  </div>
  ${tpHasMine() ? `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px">
    <span style="font-size:10px;color:var(--text-3)">范围：</span>
    <div class="filter-chip ${tpOwnerFilter==='mine'?'active':''}" onclick="tpSetOwner('mine')" style="padding:3px 10px;font-size:10px">⭐ 我负责的</div>
    <div class="filter-chip ${tpOwnerFilter==='all'?'active':''}" onclick="tpSetOwner('all')" style="padding:3px 10px;font-size:10px">全部（可见范围）</div>
  </div>` : ''}
  <div id="tp_list"></div>`;
  tpRenderProgressList();
}

// 「我负责的」：owner_teachers 或 vip_teachers 含当前老师姓名（两者平级，均在可读范围内）
let tpOwnerFilter = '';   // '' 未初始化 | 'mine' | 'all'
function tpIsMine(s) {
  const me = (teacherData && teacherData.name) || '';
  if (!me) return false;
  return (Array.isArray(s.owner_teachers) && s.owner_teachers.includes(me))
      || (Array.isArray(s.vip_teachers) && s.vip_teachers.includes(me));
}
// 当前老师在可读范围内是否有被指派/带VIP的学生（决定默认档）
function tpHasMine() { return (teacherProgressData.students || []).some(tpIsMine); }

function tpFilteredStudents() {
  const { students } = teacherProgressData;
  // 首次进入时定默认档：有负责/VIP学生 → 我负责的，否则 全部
  if (tpOwnerFilter === '') tpOwnerFilter = tpHasMine() ? 'mine' : 'all';
  let list = tsmFilterStudents(students);   // 领域 / 专业 / 状态 / 来源 / 搜索：全局筛选
  if (tpOwnerFilter === 'mine') list = list.filter(tpIsMine);
  return list;
}
function tpSetOwner(v) { tpOwnerFilter = v; tpRenderShell(); }

// 备考节点的计算、卡片画法在 shared/progress-card.js（pgcNodes / pgcCardHtml），管理端和老师端共用

// 上传批复版后：更新缓存里的提交记录并重绘列表
function tpRiyuChanged(sub) {
  const m = (teacherProgressData && teacherProgressData.riyuSubsMap) || {};
  const list = m[sub.student_id] || (m[sub.student_id] = []);
  const i = list.findIndex(x => x.id === sub.id);
  if (i >= 0) list[i] = sub; else list.push(sub);
  tpRenderProgressList();
}

function tpRenderProgressList() {
  const listBox = document.getElementById('tp_list');
  if (!listBox || !teacherProgressData) return;
  const filteredAll = tpFilteredStudents();
  const filtered = tsmSlice(filteredAll);
  const cnt = document.getElementById('tp_count');
  if (cnt) cnt.textContent = filteredAll.length;
  // 重绘前记下已展开的卡片，重绘后保持展开（首次进入不展开任何卡片）
  const openIds = new Set([...listBox.querySelectorAll('.pgc-body')].filter(e => e.style.display !== 'none').map(e => e.id.slice(4)));
  const o = {
    mode: 'teacher',
    h: { planSet: 'tpPlanSet', planFlag: 'tpPlanFlag', schoolAdd: 'tpAddSchool', schoolEdit: 'tpEditSchool', schoolDel: 'tpDelSchool' },
    notesFn: 'tpNotesToggle',
    riyuChanged: tpRiyuChanged,
  };
  const cards = filtered.map(s => pgcCardHtml(s, teacherProgressData, { ...o, open: openIds.has(s.id) })).join('');
  listBox.innerHTML = (cards ? `<div style="display:flex;flex-direction:column;gap:10px">${cards}</div>` + tsmMoreHtml(filteredAll.length) : '') || `<div class="empty">${(tsmPool || []).length ? '没有符合筛选条件的学生' : (tsaScope().vipOnly ? '暂无你指导的 VIP 学生' : '没有符合筛选条件的学生')}</div>`;
}

// ══ 老师侧：计划书 / 先行研究 查看・评估 ══
// 老师标注存 student_plan_drafts.teacher_ref_notes（与学生自填的 prior_research_list 分离，互不覆盖）
const T_REF_TAG_LIB = [
  ['重要度', ['核心文献', '重要参考', '一般参考']],
  ['研究方法', ['量的研究', '质的研究', '理论研究', '个案研究', '比较研究']],
  ['阅读建议', ['需精读', '可略读', '仅看结论', '需补充同类文献']],
];
let tdcStudentId = null, tdcDraft = null, tdcNotes = {}, tdcTab = 'refs';

function tRefKey(r, i) { return String((r && (r.title || r.keyword)) || '').trim() || ('#' + i); }
function tParseNotes(draft) {
  const v = draft && draft.teacher_ref_notes;
  if (!v) return {};
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return {}; }
}
function tdcNoteOf(key) { return tdcNotes[key] || (tdcNotes[key] = { tags: [], comment: '', rating: '' }); }

function openTeacherDraftComment(studentId, studentName) {
  const draft = teacherProgressData.draftsMap?.[studentId];
  if (!draft) return;
  tdcStudentId = studentId; tdcDraft = draft; tdcNotes = tParseNotes(draft); tdcTab = 'refs';
  const existing = document.getElementById('teacherDraftCommentModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'teacherDraftCommentModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = '<div id="tdcBody" style="background:var(--surface);border-radius:6px;padding:20px;max-width:760px;width:100%;max-height:90vh;overflow-y:auto"></div>';
  document.body.appendChild(modal);
  tdcRender(studentName);
}

function tdcRender(studentName) {
  const box = document.getElementById('tdcBody');
  if (!box) return;
  const draft = tdcDraft;
  // 学部：查看・评估志望理由书（逐校只读展示 + 整体评语）
  const _stu = ((teacherProgressData && teacherProgressData.students) || []).find(x => x.id === tdcStudentId);
  const _plans = ((teacherProgressData && teacherProgressData.plansMap) || {})[tdcStudentId] || [];
  if ((typeof isGakubuStudent === 'function') && isGakubuStudent(_stu)) {
    box.innerHTML = `
      <div style="font-size:13px;font-weight:600;margin-bottom:3px">📄 志望理由书　—　${tsaEsc(studentName)}</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:12px">按志望校逐校展示学生填写的志望理由书；整体评语会同步显示给学生</div>
      <div style="max-height:52vh;overflow-y:auto;margin-bottom:12px">${(typeof renderRiyuView === 'function') ? renderRiyuView(draft, _plans, tsaEsc) : ''}</div>
      <div class="form-group">
        <label class="form-label">整体评语（针对志望理由书）</label>
        <textarea id="tdc_comment" rows="3" placeholder="针对志望理由书内容的反馈和建议…">${tsaEsc((draft && draft.teacher_comment) || '')}</textarea>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="saveTeacherDraftComment('${(draft && draft.id) || ''}','${tdcStudentId}')" style="flex:1;background:var(--ok);color:#fff;border:none;border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">保存评语</button>
        <button onclick="document.getElementById('teacherDraftCommentModal').remove()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:10px 14px;font-size:12px;cursor:pointer;font-family:inherit">关闭</button>
      </div>`;
    return;
  }
  const refs = tDraftRefs(draft);
  const tab = (id, label, n) => `<button onclick="tdcTab='${id}';tdcRender('${tsaEsc(studentName)}')" style="font-size:12px;padding:6px 16px;border:none;border-bottom:2px solid ${tdcTab === id ? 'var(--accent)' : 'transparent'};background:none;cursor:pointer;font-family:inherit;color:${tdcTab === id ? 'var(--text)' : 'var(--text-3)'};font-weight:${tdcTab === id ? '600' : '400'}">${label}${n ? ` <span style="font-size:10px;color:var(--text-3)">${n}</span>` : ''}</button>`;

  const refsHtml = refs.length ? refs.map((r, i) => {
    const key = tRefKey(r, i);
    const n = tdcNotes[key] || { tags: [], comment: '', rating: '' };
    const info = Object.entries(r).filter(([k, v]) => v).map(([k, v]) => `<span style="color:var(--text-3)">${T_REF_LABELS[k] || k}：</span>${tsaEsc(v)}`).join('　');
    return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:9px 11px;margin-bottom:7px;background:var(--bg)">
      <div style="font-size:11px;line-height:1.9;margin-bottom:6px">${i + 1}. ${info}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:5px">
        ${T_REF_TAG_LIB.map(([grp, tags]) => `<span style="font-size:9px;color:var(--text-3)">${grp}</span>` + tags.map(t => `<span onclick="tdcToggleTag('${tsaEsc(key)}','${tsaEsc(t)}','${tsaEsc(studentName)}')" style="cursor:pointer;font-size:10px;border:1px solid ${(n.tags || []).includes(t) ? 'var(--accent)' : 'var(--border)'};background:${(n.tags || []).includes(t) ? 'var(--accent)' : 'transparent'};color:${(n.tags || []).includes(t) ? '#fff' : 'var(--text-2)'};border-radius:2px;padding:1px 8px">${t}</span>`).join('')).join('')}
      </div>
      ${(n.tags || []).filter(t => !T_REF_TAG_LIB.some(([, ts]) => ts.includes(t))).length ? `<div style="margin-bottom:5px">${(n.tags || []).filter(t => !T_REF_TAG_LIB.some(([, ts]) => ts.includes(t))).map(t => `<span style="font-size:10px;background:var(--accent);color:#fff;border-radius:2px;padding:1px 8px;margin-right:4px">${tsaEsc(t)}<span onclick="tdcToggleTag('${tsaEsc(key)}','${tsaEsc(t)}','${tsaEsc(studentName)}')" style="cursor:pointer;margin-left:5px">✕</span></span>`).join('')}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <input id="tdc_newtag_${i}" placeholder="自定义关键词" style="font-size:10px;padding:3px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface);width:130px">
        <button onclick="tdcAddTag('${tsaEsc(key)}',${i},'${tsaEsc(studentName)}')" style="font-size:10px;border:1px solid var(--border);background:none;border-radius:2px;padding:3px 9px;cursor:pointer;font-family:inherit">＋ 添加</button>
        <input value="${tsaEsc(n.comment || '')}" onchange="tdcSetComment('${tsaEsc(key)}',this.value)" placeholder="对该文献的评语（可选）" style="flex:1;min-width:160px;font-size:10px;padding:3px 7px;border:1px solid var(--border);border-radius:2px;background:var(--surface)">
      </div>
    </div>`;
  }).join('') : '<div style="font-size:11px;color:var(--text-3);padding:10px 0">学生尚未整理先行研究</div>';

  box.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:3px">📄 计划书 · 先行研究　—　${tsaEsc(studentName)}</div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">关键词与评语会同步显示给学生；学生自己的文献列表不会被覆盖</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      ${draft.draft_file_url ? `<a href="${draft.draft_file_url}" target="_blank" style="font-size:11px;background:var(--accent);color:#fff;border-radius:3px;padding:6px 14px;text-decoration:none">⬇ 下载完成稿</a>` : '<span style="font-size:11px;color:var(--text-3)">学生尚未上传完成稿</span>'}
      ${refs.length ? `<button onclick="tdcExportRefs('${tsaEsc(studentName)}')" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">⬇ 导出先行研究(CSV)</button>` : ''}
    </div>
    <div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px">
      ${tab('refs', '先行研究', refs.length)}
      ${tab('draft', '计划书全文')}
    </div>
    ${tdcTab === 'refs' ? refsHtml : `<div style="background:var(--bg);border-radius:3px;padding:12px;font-size:11px;color:var(--text-2);line-height:1.9;max-height:46vh;overflow-y:auto">${tDraftFullHtml(draft)}</div>`}
    <div class="form-group" style="margin-top:12px">
      <label class="form-label">整体批注（针对计划书）</label>
      <textarea id="tdc_comment" rows="3" placeholder="针对计划书内容的反馈和建议…">${tsaEsc(draft.teacher_comment || '')}</textarea>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="saveTeacherDraftComment('${draft.id}','${tdcStudentId}')" style="flex:1;background:var(--ok);color:#fff;border:none;border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">保存批注与标注</button>
      <button onclick="document.getElementById('teacherDraftCommentModal').remove()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:10px 14px;font-size:12px;cursor:pointer;font-family:inherit">关闭</button>
    </div>`;
}

function tdcToggleTag(key, tag, studentName) {
  const n = tdcNoteOf(key);
  n.tags = n.tags || [];
  const i = n.tags.indexOf(tag);
  if (i >= 0) n.tags.splice(i, 1); else n.tags.push(tag);
  tdcRender(studentName);
}
function tdcAddTag(key, idx, studentName) {
  const el = document.getElementById('tdc_newtag_' + idx);
  const v = el ? el.value.trim() : '';
  if (!v) return;
  const n = tdcNoteOf(key);
  n.tags = n.tags || [];
  if (!n.tags.includes(v)) n.tags.push(v);
  tdcRender(studentName);
}
function tdcSetComment(key, v) { tdcNoteOf(key).comment = v; }

// 先行研究导出 CSV（含老师标注），Excel 可直接打开
function tdcExportRefs(studentName) {
  const refs = tDraftRefs(tdcDraft);
  if (!refs.length) return;
  const cols = [...new Set(refs.flatMap(r => Object.keys(r)))];
  const head = [...cols.map(c => T_REF_LABELS[c] || c), '老师关键词', '老师评语'];
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = refs.map((r, i) => {
    const n = tdcNotes[tRefKey(r, i)] || {};
    return [...cols.map(c => r[c] || ''), (n.tags || []).join('、'), n.comment || ''].map(esc).join(',');
  });
  const csv = '\ufeff' + [head.map(esc).join(','), ...rows].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${studentName}_先行研究整理.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

async function saveTeacherDraftComment(draftId, studentId) {
  const comment = (document.getElementById('tdc_comment')?.value || '').trim();
  // 清掉空标注，避免存一堆空对象
  const notes = {};
  Object.entries(tdcNotes || {}).forEach(([k, v]) => {
    if (v && ((v.tags || []).length || (v.comment || '').trim() || (v.rating || '').trim())) notes[k] = v;
  });
  if (!comment && !Object.keys(notes).length) { alert('请填写批注内容，或为文献添加关键词/评语'); return; }
  try {
    const patch = {
      teacher_comment: comment, teacher_ref_notes: notes,
      teacher_comment_by: (typeof teacherName !== 'undefined' ? teacherName : null),
      teacher_comment_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await sb(`/rest/v1/student_plan_drafts?id=eq.${draftId}`, 'PATCH', patch);
    if (teacherProgressData.draftsMap?.[studentId]) {
      Object.assign(teacherProgressData.draftsMap[studentId], patch);
    }
    document.getElementById('teacherDraftCommentModal').remove();
    renderTeacherStudyProgress(document.getElementById('sm_content')||document.getElementById('mainContent'));
  } catch(e) { alert('保存失败：' + e.message); }
}

// ══════════════════════════════════
// 学生管理（需 admin 授予 student_mgmt 权限，子项由 student_mgmt_items 控制）
// 子项：progress 考学进度（沿用原页面，按老师负责的面谈学生显示）
//       records  出席・作业记录（按 student_majors 允许专业查看）
//       profile  学生档案录入（与 admin 学生档案同一张表实时同步；按 student_majors 允许专业查看）
// ══════════════════════════════════
let smTab = '';
const SM_ITEMS = [['progress','📊 考学进度'], ['meetings','💬 面谈查询'], ['records','🗒 出席・作业记录'], ['profile','👤 学生档案']];
// 出席・作业记录拆成两项：records_view 查看 / records_entry 登记；旧的 records 当作两项都开
function smRecPerm(items) {
  const it = Array.isArray(items) ? items : ((((teacherData && teacherData.permissions) || {}).student_mgmt_items) || []);
  const legacy = it.includes('records');
  return { view: legacy || it.includes('records_view'), entry: legacy || it.includes('records_entry') };
}

function smAllowedItems() {
  const p = (teacherData && teacherData.permissions) || {};
  const items = (p.student_mgmt && Array.isArray(p.student_mgmt_items)) ? p.student_mgmt_items : [];
  const rp = smRecPerm(items);
  const allowed = SM_ITEMS.filter(([k]) => k === 'records' ? (rp.view || rp.entry) : items.includes(k));
  // 重点关注：汇总已有数据的另一种展示，只要有考学进度/学生档案/面谈任一权限就提供
  if (items.includes('progress') || items.includes('profile') || items.includes('meetings')) {
    allowed.push(['focus', '⭐ 重点关注']);
    allowed.push(['monthly', '📅 月度学习情况']);  // 月度：跟重点关注一样自动出现
  }
  // 若已在 student_mgmt_items 显式勾了 monthly 也不重复

  return allowed;
}

// ══ 全局筛选（学生管理所有子页面共用）：领域 / 专业 / 状态 / 来源 / 搜索，五个条件取交集 ══
// 筛选只缩小范围：学生池 tsmPool 已按 tsaAllowedSet()（以及保录限定）裁剪，筛选不会超出权限。
const TSM_STATUS = [['active', '在籍'], ['graduated', '已合格'], ['expired', '已到期'], ['stopped', '停课'], ['withdrawn', '退学'], ['', '全部']];
const tsmDefault = () => ({ domain: tsmDefaultDomain(), major: '', status: 'active', source: '', q: '' });
let tsm = tsmDefault();
let tsmDomainInited = false;   // 首次加载学生池后，才能按可见学生判断默认领域
// 默认领域：老师自己的领域（managed_by 第一个；没有就取负责专业所属领域里人数最多的）；都没有（营业老师等）→ 留空，让老师自己选。绝不默认「全部」
function tsmDefaultDomain() {
  if (typeof teacherData === 'undefined' || !teacherData) return '';
  const pool = tsmPool || [];
  const present = new Set(pool.map(s => tsmDomainOf(s.major)).filter(Boolean));
  tsmScopeDomains().forEach(d => present.add(d));
  const ok = d => d && (!tsmPool || present.has(d));
  const isSales = typeof canSeeAllStudents === 'function' && canSeeAllStudents(teacherData);
  if (!isSales) {
    const mb = (teacherData.managed_by || []).filter(Boolean);
    const own = (teacherData.domains || []).filter(Boolean);
    if (own.length && ok(own[0])) return own[0];
    if (mb.length && ok(mb[0])) return mb[0];
    const cntBy = {};
    (teacherData.majors || []).forEach(m => { const d = tsmDomainOf(m); if (d) cntBy[d] = (cntBy[d] || 0) + pool.filter(s => tpMajorMatch(s.major, m)).length + 0.001; });
    const best = Object.keys(cntBy).sort((a, b) => cntBy[b] - cntBy[a])[0];
    if (ok(best)) return best;
  }
  // 指定了营业范围、只有一个领域：就用它
  { const sd = typeof salesScopeDomains === 'function' ? salesScopeDomains(teacherData) : []; if (sd.length === 1 && ok(sd[0])) return sd[0]; }
  // 没有所属领域（营业老师等）：不替他选，留空，页面提示「请先选择领域」（见 tsmNeed）
  return '';
}
// 逐级选择：领域 → 专业，每一级都要老师自己点了才显示学生（点「全部」也算选了）；没选完就只提示，不显示任何学生
let tsmDomPicked = true, tsmMajPicked = false;
// 领域筛选里要列出的领域：可见学生里出现的 ∪ 负责的整个领域 ∪ 范围内专业所属领域（领域下暂时没有学生也要列出，数字 0）
function tsmScopeDomains() {
  const sc = tsaScope(), set = new Set();
  if (sc.all) return set;
  sc.domains.forEach(d => set.add(d));
  sc.majors.forEach(m => { const d = tsmDomainOf(m); if (d) set.add(d); });
  return set;
}
function tsmDomainsPresent() { const sd = tsmScopeDomains(); return DOMAINS.map(d => d.label).filter(d => sd.has(d) || (tsmPool || []).some(s => tsmDomainOf(s.major) === d)); }
function tsmDomCount() { return tsmDomainsPresent().length; }
function tsmEffDomain() { const doms = tsmDomainsPresent(); return tsm.domain || (doms.length === 1 ? doms[0] : ''); }
function tsmDomMajorKeys(dom) {
  const present = new Set((tsmPool || []).map(s => s.major).filter(Boolean));
  const keys = majorFilterKeys().filter(k => isMajorGroup(k) ? groupMajors(k).some(m => present.has(m)) : present.has(k));
  [...present].forEach(k => { if (!keys.includes(k)) keys.push(k); });
  return keys.filter(k => tsmDomainOf(k) === dom);
}
// 还差哪一级没选：'domain' | 'major' | ''（都选了）
function tsmNeed() {
  if (!tsmDomPicked) return 'domain';
  const ed = tsmEffDomain();
  if (ed && !tsmMajPicked && tsmDomMajorKeys(ed).length > 1) return 'major';
  return '';
}
function tsmPickHtml() { return `<div class="empty" style="padding:40px">${tsmNeed() === 'major' ? '请先在上面选择专业（或点「全部」）后再查看学生' : '请先在上面选择领域（或点「全部」）后再查看学生'}</div>`; }
// 学生列表分页：每次先显示 30 人，「显示更多」再加 30；筛选/切页时重置
const TSM_PAGE = 30;
let tsmShown = TSM_PAGE;
function tsmSlice(list) { return list.slice(0, tsmShown); }
function tsmMoreHtml(total) {
  if (total <= tsmShown) return '';
  return `<div onclick="tsmShowMore()" style="text-align:center;padding:10px;margin:6px 0;font-size:11px;color:var(--accent);border:1px dashed var(--border);border-radius:4px;cursor:pointer">显示更多（还有 ${total - tsmShown} 人）</div>`;
}
function tsmShowMore() { tsmShown += TSM_PAGE; tsmRefreshPage(true); }
let tsmPool = null, tsmPoolAt = 0;   // 可见学生（全部状态）[{id,name,major,level,status,course_type,student_type,source}]

function tsmDomainOf(major) {
  if (!major) return '';
  if (isMajorGroup(major)) return groupDomain(major) || MAJOR_DOMAIN[groupMajors(major)[0]] || '';
  return MAJOR_DOMAIN[major] || '';
}
// 一个学生（或带 name/major/source/status 的对象，如面谈分组）是否符合全局筛选；skip = 统计某一行人数时忽略的那一项，noQ = 忽略搜索
function tsmMatch(s, skip, noQ) {
  if (skip !== 'domain' && tsm.domain && tsmDomainOf(s.major) !== tsm.domain) return false;
  if (skip !== 'major' && tsm.major && !tpMajorMatch(s.major, tsm.major)) return false;
  if (skip !== 'status' && tsm.status && (s.status || 'active') !== tsm.status) return false;
  if (skip !== 'source' && tsm.source && (s.source || '') !== tsm.source) return false;
  const q = tsm.q.trim();
  if (!noQ && q && !searchMatch(q, studentSearchFields(s).concat([s.source]))) return false;
  return true;
}
function tsmFilterStudents(list) { return (list || []).filter(s => tsmMatch(s)); }

async function tsmLoadPool(force) {
  if (!force && tsmPool && Date.now() - tsmPoolAt < 60000) return tsmPool;
  let all = [];
  try { all = await sbAll('/rest/v1/students?select=id,name,major,level,status,course_type,student_type,source,class_ids,vip_teachers,is_vip_course&order=name.asc'); } catch (e) { all = tsmPool || []; }
  let list = tsaFilterStudents(all);
  if (tsaGuaranteedLock()) list = list.filter(tsaIsGuaranteed);
  tsmPool = list; tsmPoolAt = Date.now();
  if (!tsmDomainInited) { tsmDomainInited = true; tsm.domain = tsmDefaultDomain(); tsmDomPicked = !!tsm.domain || tsmDomCount() <= 1; tsmMajPicked = false; }
  return tsmPool;
}

function tsmBarHtml() {
  const pool = tsmPool || [];
  const chip = (on, label, n, fn) => `<div class="filter-chip ${on ? 'active' : ''}" onclick="${fn}" style="padding:3px 10px;font-size:10px;${n === 0 && !on ? 'opacity:.45' : ''}">${label}${n == null ? '' : ' ' + n}</div>`;
  const cnt = (skip, test) => pool.filter(s => tsmMatch(s, skip, true) && test(s)).length;
  const row = (label, inner) => `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px"><span style="font-size:10px;color:var(--text-3);min-width:30px">${label}</span>${inner}</div>`;
  let h = '';
  // 领域：只列可见学生里实际出现的；只有一个领域时不显示
  const doms = tsmDomainsPresent();
  if (doms.length > 1) h += row('领域', chipFold([{ on: !tsm.domain && tsmDomPicked, html: chip(!tsm.domain && tsmDomPicked, '全部', cnt('domain', () => true), `tsmSet('domain','')`) }]
    .concat(doms.map(d => ({ on: tsm.domain === d, html: chip(tsm.domain === d, d, cnt('domain', s => tsmDomainOf(s.major) === d), `tsmSet('domain','${d}')`) })))));
  // 专业：逐级展开——选了具体领域才显示，只列该领域的专业；领域选「全部」时只给一行提示（只有一个领域时直接列该领域专业）
  const effDom = tsmEffDomain();
  const present = new Set(pool.map(s => s.major).filter(Boolean));
  if (effDom) {
    const dkeys = tsmDomMajorKeys(effDom);
    if (dkeys.length > 1) {
      const mchip = k => ({ on: tsm.major === k, html: chip(tsm.major === k, majorLabel(k), cnt('major', s => tpMajorMatch(s.major, k)), `tsmSet('major','${k}')`) });
      h += row('专业', chipFold([{ on: !tsm.major && tsmMajPicked, html: chip(!tsm.major && tsmMajPicked, '全部', cnt('major', () => true), `tsmSet('major','')`) }].concat(dkeys.map(mchip))));
    }
  } else if (present.size > 1) {
    h += row('专业', '<span style="font-size:10px;color:var(--text-3)">选择领域后可按专业筛选</span>');
  }
  h += row('状态', TSM_STATUS.map(([k, l]) => chip(tsm.status === k, l, cnt('status', s => !k || (s.status || 'active') === k), `tsmSet('status','${k}')`)).join(''));
  h += row('来源', chip(!tsm.source, '全部', cnt('source', () => true), `tsmSet('source','')`) + TP_SOURCES.map(x => chip(tsm.source === x, x, cnt('source', s => (s.source || '') === x), `tsmSet('source','${x}')`)).join(''));
  const n = pool.filter(s => tsmMatch(s)).length;
  h += `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px">
    <input id="tsm_q" placeholder="搜索姓名（汉字 / 拼音首字母）/ 专业 / 来源…" value="${tsaEsc(tsm.q)}" oninput="searchBox(this,tsmSearchInput)" style="font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;width:240px;max-width:100%">
    <span style="margin-left:auto;font-size:11px;color:var(--text-2)">符合条件 <b id="tsm_n">${tsmNeed() ? '—' : n}</b> 人</span>
    <span onclick="tsmClear()" style="font-size:10px;color:var(--accent);cursor:pointer">清除筛选</span></div>`;
  return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:10px 12px;margin-bottom:12px">${h}</div>`;
}
function tsmRenderBar() { const el = document.getElementById('sm_filter'); if (el) el.innerHTML = tsmBarHtml(); }
function tsmSet(k, v) {
  const wasNeed = tsmNeed();   // 之前因为没选完而没加载列表 → 这次选完要整页重新加载
  if (k === 'domain') { tsmDomPicked = true; if (v !== tsm.domain) tsmMajPicked = false; }
  if (k === 'major') tsmMajPicked = true;
  tsm[k] = v;
  if (k === 'domain' && tsm.major && (!v || tsmDomainOf(tsm.major) !== v)) tsm.major = '';   // 换领域时，不属于该领域的专业选择清掉
  if (wasNeed) { tsmShown = TSM_PAGE; renderStudentMgmt(document.getElementById('mainContent')); return; }
  tsmChanged();
}
function tsmClear() {
  const wasNeed = tsmNeed();
  tsm = tsmDefault(); tsmDomPicked = !!tsm.domain || tsmDomCount() <= 1; tsmMajPicked = false;
  if (wasNeed) { tsmShown = TSM_PAGE; renderStudentMgmt(document.getElementById('mainContent')); } else tsmChanged();
}
function tsmChanged() { tsmShown = TSM_PAGE; tsmRenderBar(); tsmRefreshPage(false); }
function tsmSearchInput(v) {   // 输入搜索时不重画筛选栏（保持输入焦点），只更新人数和当前页
  tsm.q = v; tsmShown = TSM_PAGE;
  const n = document.getElementById('tsm_n'); if (n) n.textContent = tsmNeed() ? '—' : (tsmPool || []).filter(s => tsmMatch(s)).length;
  tsmRefreshPage(true);
}
// 筛选变化后刷新当前子页面（数据已缓存，不重新拉取）；light=只刷新列表，保持页头不动
function tsmRefreshPage(light) {
  const box = document.getElementById('sm_content'); if (!box) return;
  if (tsmNeed()) { box.innerHTML = tsmPickHtml(); return; }
  if (smTab === 'progress') { if (light && document.getElementById('tp_list')) tpRenderProgressList(); else tpRenderShell(); }
  else if (smTab === 'meetings') { if (light && document.getElementById('tm_list')) tmRenderList(); else tmRenderShell(); }
  else if (smTab === 'records') { if (light && document.getElementById('tsr_list')) tsrRenderList(); else tsrRender(); }
  else if (smTab === 'monthly') renderMonthlyReport(box);
  else if (smTab === 'focus') focusRender();
  else if (light && document.getElementById('tsa_list')) tsaRenderList();
  else tsaRender();
}

function renderStudentMgmt(mc) {
  const allowed = smAllowedItems();
  if (!allowed.length) { mc.innerHTML = '<div class="empty">未开通任何学生管理子项，请联系管理员</div>'; return; }
  if (!allowed.find(([k]) => k === smTab)) smTab = allowed[0][0];
  mc.innerHTML = `<div>
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
      ${allowed.map(([k, l]) => `<button onclick="smTab='${k}';renderStudentMgmt(document.getElementById('mainContent'))" style="font-size:11px;padding:5px 14px;border-radius:3px;cursor:pointer;font-family:inherit;border:1px solid ${smTab===k?'var(--accent)':'var(--border)'};background:${smTab===k?'var(--accent)':'var(--surface)'};color:${smTab===k?'#fff':'var(--text-2)'}">${l}</button>`).join('')}
    </div>
    <div id="sm_filter"></div>
    <div id="sm_content"><div class="empty">加载中…</div></div>
  </div>`;
  const box = document.getElementById('sm_content');
  const tab = smTab;
  tsmShown = TSM_PAGE;
  tsmLoadPool(true).then(() => {
    if (smTab !== tab || !document.getElementById('sm_content')) return;   // 加载期间已切走
    if (tsaScopeEmpty()) { const f = document.getElementById('sm_filter'); if (f) f.innerHTML = ''; box.innerHTML = tsaEmptyHtml(); return; }
    tsmRenderBar();
    if (tsmNeed()) { box.innerHTML = tsmPickHtml(); return; }
    if (tab === 'progress') renderTeacherStudyProgress(box);
    else if (tab === 'records') renderTsaRecords(box);
    else if (tab === 'meetings') renderTsaMeetings(box);
    else if (tab === 'monthly') renderMonthlyReport(box);
    else if (tab === 'focus') renderTeacherFocus(box);
    else renderTeacherStudents(box);
  });
}

// ── 共用：允许专业集合（三个子项统一使用；与面谈预约逻辑完全无关） ──
// 范围由 shared/constants.js 的 teacherScope() 统一算（营业/对接=全部；其他=负责专业/领域/管理范围/班主任班级，减去「排除的专业」）。
// 没有范围 = 一个学生都看不到（不再"没设就全部"）。
// admin 是否把此老师的学生管理限定为"仅保录学生"
function tsaGuaranteedLock() { return !!(teacherData && teacherData.permissions && teacherData.permissions.guaranteed_only); }
function tsaIsGuaranteed(s) { return ((s && s.course_type) || '').includes('保录'); }

function tsaScope() { return teacherScope(teacherData, 'student'); }
// 专业集合：null = 看全部；Set（可能为空）= 按专业；班主任班级的学生另外用 tsaStudentOk 判断
function tsaAllowedSet() {
  const sc = tsaScope();
  return sc.all ? null : sc.majors;
}
// 学生行是否在这位老师的范围里（专业命中，或在班主任负责的班级里）
function tsaStudentOk(s) { return teacherScopeHasStudent(tsaScope(), s); }
// 某个专业在不在范围内（专业命中或所属领域整个负责）
function tsaMajorOk(k) { return teacherScopeHasStudent(tsaScope(), { major: k }); }
function tsaScopeEmpty() { return teacherScopeEmpty(tsaScope()); }
function tsaFilterStudents(list) { const sc = tsaScope(); return sc.all ? (list || []) : (list || []).filter(s => teacherScopeHasStudent(sc, s)); }
function tsaScopeText() {
  const sc = tsaScope();
  if (sc.all) return '可见全部专业';
  const parts = [];
  if (sc.domains.size) parts.push('整个领域：' + [...sc.domains].join('・'));
  if (sc.majors.size) parts.push('可见专业：' + [...sc.majors].map(m => MAJORS[m] || m).join('・'));
  if (sc.classIds.size) parts.push('含班主任班级学生');
  return parts.join('；');
}
function tsaEmptyHtml() { return `<div class="empty">${TEACHER_SCOPE_EMPTY_MSG}</div>`; }

function tsaEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// ══ 子项1：学生档案（录入 + 查看） ══
let tsaStudents = [];
let tsaFormOpen = false;
let tsaExpandedId = null;
let tsaGuaranteedOnly = false;  // 只看保录学生（course_type 含"保录"），与专业筛选平级

async function renderTeacherStudents(box) {
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const all = await sb('/rest/v1/students?select=*&order=created_at.desc&limit=2000');
    tsaStudents = tsaFilterStudents(all);   // 全部状态；由全局「状态」筛选
    // admin 限定"仅保录"：数据层就只保留保录学生，彻底看不到其他学生
    if (teacherData && teacherData.permissions && teacherData.permissions.guaranteed_only) {
      tsaStudents = tsaStudents.filter(s => (s.course_type || '').includes('保录'));
      tsaGuaranteedOnly = true;
    }
  } catch (e) { box.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }
  tsaRender();
}

function tsaMajorOptions(sel) {
  return Object.entries(MAJORS)
    .filter(([k]) => !isMajorGroup(k) && tsaMajorOk(k))
    .map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
}

function tsaListHtml() {
  let list = tsmFilterStudents(tsaStudents);
  if (tsaGuaranteedOnly) list = list.filter(s => (s.course_type || '').includes('保录'));
  // 表格本体（列、排序、表头筛选）用 shared/student-table.js，和管理端同一套
  return sttHtml('teacher', list, {
    mode: 'teacher',
    slice: tsmSlice, more: tsmMoreHtml,
    rowClick: s => `tsaExpandedId=tsaExpandedId==='${s.id}'?null:'${s.id}';tsaRenderList()`,
    expand: s => tsaExpandedId !== s.id ? '' : `<div style="font-size:11px;margin-bottom:6px"><span style="color:var(--text-3)">上课方式：</span>${s.default_mode === 'offline' ? '线下' : '线上'}</div>
        <button onclick="event.stopPropagation();tsaCodeNotice('${s.id}')" style="margin-right:6px;font-size:10px;background:none;border:1px solid var(--accent);color:var(--accent);border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">✉ 查询码通知</button>
        ${(teacherData.permissions.student_mgmt_items||[]).includes('profile_edit')?`<button onclick="event.stopPropagation();tseOpen('${s.id}')" style="font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">✏ 修改档案</button>`:''}`
  });
}

// 查询码通知（文案 A）：只对本老师能看到的学生（tsaStudents 已按可见范围过滤）
function tsaCodeNotice(id) {
  const st = tsaStudents.find(x => x.id === id);
  if (!st) return;
  openStudentCodeNotice(st, () => tsaRenderList());
}

function tsaRenderList() {
  const box = document.getElementById('tsa_list');
  if (box) box.innerHTML = tsaListHtml();
}

function tsaRender() {
  const mc = document.getElementById('sm_content') || document.getElementById('mainContent');
  const inpStyle = 'width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const fld = (id, label, ctrl) => `<div><label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">${label}</label>${ctrl}</div>`;
  const inp = (id, label, ph) => fld(id, label, `<input id="${id}" placeholder="${ph || ''}" style="${inpStyle}">`);

  mc.innerHTML = `<div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <div style="font-size:12px;font-weight:600">👤 学生档案（${tsmFilterStudents(tsaStudents).length}人）<span style="font-size:10px;font-weight:400;color:var(--text-3);margin-left:6px">${tsaScopeText()}</span></div>
      <div style="display:flex;gap:6px;align-items:center">
        ${(teacherData && teacherData.permissions && teacherData.permissions.guaranteed_only)
          ? `<div style="font-size:10px;padding:2px 10px;border-radius:12px;background:#8a5010;color:#fff;white-space:nowrap">🎓 仅保录学生（管理员限定）</div>`
          : `<div class="filter-chip ${tsaGuaranteedOnly?'active':''}" onclick="tsaGuaranteedOnly=!tsaGuaranteedOnly;tsaRender()" style="padding:2px 10px;font-size:10px;white-space:nowrap;${tsaGuaranteedOnly?'background:#8a5010;color:#fff;border-color:#8a5010':''}">🎓 只看保录</div>`}
        <button onclick="tsaFormOpen=!tsaFormOpen;tsaRender()" style="font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">${tsaFormOpen ? '收起表单' : '＋ 添加学生'}</button>
      </div>
    </div>

    ${tsaFormOpen ? `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:600;margin-bottom:10px">添加学生（与 admin 学生档案同步，保存后自动生成查询码）</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:10px">
        ${inp('tsa_name', '姓名 *', '学生姓名')}
        ${fld('tsa_major', '专业 *', `<select id="tsa_major" style="${inpStyle}">${tsaMajorOptions('')}</select>`)}
        ${fld('tsa_type', '属性', `<select id="tsa_type" style="${inpStyle}"><option value="">请选择</option><option>本科</option><option>专科</option><option>专升本</option></select>`)}
        ${fld('tsa_source', '来源', `<select id="tsa_source" style="${inpStyle}"><option value="">请选择</option><option>唯新</option><option>新世界</option><option>校内塾</option><option>杭州校</option></select>`)}
        ${inp('tsa_course', '课程属性', '大课 / VIP / 保录…')}
        ${fld('tsa_level', '等级', `<select id="tsa_level" style="${inpStyle}"><option value="">请选择</option><option>A</option><option>B</option><option>C</option><option>D</option></select>`)}
        ${inp('tsa_japanese', '日语成绩', 'N1 120 / 备考…')}
        ${inp('tsa_english', '英语成绩', '托业 800 / 托福 90…')}
        ${inp('tsa_university', '出身大学', '')}
        ${inp('tsa_faculty', '学部 / 专业', '')}
        ${inp('tsa_gpa', 'GPA / 其他履历', '')}
        ${inp('tsa_thesis', '毕业论文方向', '论文题目或方向')}
        ${inp('tsa_graduation', '毕业时间', '25年6月')}
        ${inp('tsa_enrollment', '期待入学时间', '27年4月')}
        ${inp('tsa_arrival', '赴日时间', '26年7月')}
        ${inp('tsa_signup', '报名时间', '26年4月')}
        ${inp('tsa_expiry', '到期时间', '27年3月')}
        ${fld('tsa_mode', '默认上课方式', `<select id="tsa_mode" style="${inpStyle}"><option value="online">线上</option><option value="offline">线下</option></select>`)}
      </div>
      <button onclick="tsaSaveStudent()" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 18px;cursor:pointer;font-family:inherit">保存</button>
      <span id="tsa_save_msg" style="font-size:11px;margin-left:10px"></span>
    </div>` : ''}

    <div id="tsa_list">${tsaListHtml()}</div>
    <div style="font-size:9px;color:var(--text-3);margin-top:6px">数据与 admin 学生档案为同一数据库、实时同步；此处可录入与查看，修改或删除请联系 admin。</div>
  </div>`;
}

async function tsaSaveStudent() {
  const name = document.getElementById('tsa_name').value.trim();
  const major = document.getElementById('tsa_major').value;
  if (!name) { alert('请填写姓名'); return; }
  if (tsaStudents.find(s => s.name === name)) { if (!confirm(`已存在同名学生「${name}」，确定继续添加？`)) return; }
  const msg = document.getElementById('tsa_save_msg');
  if (msg) msg.textContent = '保存中…';
  const g = id => document.getElementById(id).value;
  const data = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name, major,
    student_type: g('tsa_type'), source: g('tsa_source'), course_type: g('tsa_course').trim(),
    level: g('tsa_level'), japanese_score: g('tsa_japanese').trim(), english_score: g('tsa_english').trim(),
    university: g('tsa_university').trim(), faculty: g('tsa_faculty').trim(), gpa: g('tsa_gpa').trim(),
    thesis: g('tsa_thesis').trim(), graduation_date: g('tsa_graduation').trim(),
    target_enrollment: g('tsa_enrollment').trim(), japan_arrival: g('tsa_arrival').trim(),
    signup_date: g('tsa_signup').trim(), expiry_date: g('tsa_expiry').trim(),
    default_mode: g('tsa_mode'), status: 'active',
  };
  try {
    const res = await sb('/rest/v1/students', 'POST', data);
    const row = Array.isArray(res) && res[0] ? res[0] : data;
    // 查询码交给服务端生成：同时写入 student_login（触发器自动建登录账号），学生才能登录
    const r = await ensureStudentCode(row);
    tsaStudents.unshift(row);
    tsaFormOpen = false;
    tsaRender();
    if (r.code) alert(`已添加「${name}」\n查询码：${r.code}\n请转达学生，用于学习记录、面谈预约等页面登录。`);
    else alert(`已添加「${name}」，但${r.error || '查询码生成失败'}。\n请稍后在学生详情里点「✉ 查询码通知」重试，或联系管理员生成。`);
  } catch (e) { if (msg) msg.textContent = ''; alert('保存失败：' + e.message); }
}

// ══ 子项：月度学习情况（学部美术）——汇总出勤/作业 + 老师评价 + 作品展示 ══
let mrStudentId = '';   // 当前选中学生
let mrYearMonth = '';   // 当前选中月份 YYYY-MM
let mrCache = {};       // student_id -> session_records
let mrReviewCache = {}; // `${sid}|${ym}` -> monthly_reviews row
let mrStudentsCache = [];

function renderMonthlyReport(mc){
  // 学生范围 = 全局筛选后的学生（pool 已按老师可见范围裁剪）
  const list = tsmFilterStudents(tsmPool || []);
  if (!list.some(x => x.id === mrStudentId)) mrStudentId = list.length ? list[0].id : '';
  if (!mrYearMonth){ const d=new Date(); mrYearMonth = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  if (!list.length) { mc.innerHTML = '<div class="empty">当前筛选下没有学生</div>'; mrStudentsCache = []; return; }
  mc.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div style="font-size:12px;font-weight:600">📅 月度学习情况</div>
        <select id="mr_stu" onchange="mrStudentId=this.value;renderMonthlyReport(document.getElementById('sm_content')||document.getElementById('mainContent'))" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:4px">
          ${list.map(s=>`<option value="${s.id}" ${mrStudentId===s.id?'selected':''}>${s.name}${s.student_type?' · '+s.student_type:''}</option>`).join('')}
        </select>
        <input type="month" id="mr_ym" value="${mrYearMonth}" onchange="mrYearMonth=this.value;renderMonthlyReport(document.getElementById('sm_content')||document.getElementById('mainContent'))" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:4px">
      </div>
      <div id="mr_body"><div style="font-size:11px;color:var(--text-3);padding:20px">加载中…</div></div>`;
  mrStudentsCache = list; if (mrStudentId) mrLoadAndRender(list.find(x=>x.id===mrStudentId));
}

// ══ 学生月度出勤・作业统计（月度学习情况、出席・作业列表共用，口径只此一处）══
// 规定出勤 = 这个月里、该生所属课程（按专业 / 班级 / 名单，studentInCourse）的课次数，不含休讲，只算到今天为止
// 实际出勤 = 出席 + 迟到 + 录播回看；请假单独计；缺席 / 未记录 = 规定 − 实际 − 请假
// 作业 = 这些课次里布置了作业（homework_enabled 且已发布）的份数，已交 = homework_submissions 里该生已提交的份数
// ym 为空 = 全部月份（到今天为止）
let smsCtxCache = {};   // ym → Promise<ctx>；记出席 / 刷新时清空
function smsChunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
async function smsFetchChunked(ids, n, fn) { return (await Promise.all(smsChunks(ids, n).map(fn))).flat(); }
function smsLoad(ym) {
  const k = ym || '';
  if (smsCtxCache[k]) return smsCtxCache[k];
  const p = (async () => {
    const today = jstToday();
    const lo = ym ? ym + '-01' : '2000-01-01';
    let hi = ym ? ym + '-31' : today;
    if (hi > today) hi = today;
    const sess = lo > hi ? [] : await sbAll(`/rest/v1/course_sessions?select=id,course_id,course_name,session_date,session_number,is_cancelled,confirmed,homework_enabled,hw_release_date&session_date=gte.${lo}&session_date=lte.${hi}&order=session_date.asc,id.asc`);
    const live = sess.filter(x => !x.is_cancelled && x.confirmed !== false && x.course_id);
    const cids = [...new Set(live.map(x => String(x.course_id)))], sids = live.map(x => String(x.id));
    const q = ids => ids.map(x => `"${x}"`).join(',');
    const [courses, members, recs, subs] = await Promise.all([
      smsFetchChunked(cids, 80, ids => sbAll(`/rest/v1/courses?id=in.(${q(ids)})&select=*&order=id.asc`)),
      smsFetchChunked(cids, 80, ids => sbAll(`/rest/v1/course_members?course_id=in.(${q(ids)})&select=course_id,student_id,kind&order=course_id.asc,student_id.asc`)),
      smsFetchChunked(sids, 80, ids => sbAll(`/rest/v1/session_records?session_id=in.(${q(ids)})&select=id,session_id,student_id,student_name,attendance_status,created_at&order=id.asc`)),
      smsFetchChunked(sids, 80, ids => sbAll(`/rest/v1/homework_submissions?session_id=in.(${q(ids)})&select=id,session_id,student_id,student_name&order=id.asc`)),
    ]);
    const ctx = { ym: k, live, courses, membersByStu: {}, rec: {}, sub: new Set() };
    members.forEach(m => { (ctx.membersByStu[String(m.student_id)] = ctx.membersByStu[String(m.student_id)] || []).push(m); });
    const rk = (r, sid) => r.student_id ? `${r.session_id}|${r.student_id}` : `${r.session_id}|n:${r.student_name}`;
    recs.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))).forEach(r => { const key = rk(r); if (!ctx.rec[key]) ctx.rec[key] = r; });   // 同一课次重复记录取最早一条
    subs.forEach(r => { ctx.sub.add(rk(r)); });
    ctx.courseById = {}; courses.forEach(c => { ctx.courseById[String(c.id)] = c; });
    return ctx;
  })();
  smsCtxCache[k] = p;
  p.catch(() => { delete smsCtxCache[k]; });
  return p;
}
// 一节课的出席标记：ok 出席 / late 迟到 / leave 请假 / absent 缺席（有记录但没点到）/ none 未记录
function smsMark(r) {
  if (!r) return 'none';
  const v = r.attendance_status || '';
  if (['offline', 'online', 'replay'].includes(v)) return 'ok';
  if (v === 'offline_late' || v === 'online_late') return 'late';
  if (v === 'leave') return 'leave';
  return 'absent';
}
function studentMonthStats(student, ctx) {
  const my = ctx.membersByStu[String(student.id)] || [];
  const cids = new Set(ctx.courses.filter(c => studentInCourse(student, c, my)).map(c => String(c.id)));
  const sess = ctx.live.filter(x => cids.has(String(x.course_id)));
  const s = { required: 0, present: 0, late: 0, leave: 0, actual: 0, absent: 0, rate: null, hwAssigned: 0, hwDone: 0, marks: [] };
  sess.forEach(se => {
    const r = ctx.rec[`${se.id}|${student.id}`] || ctx.rec[`${se.id}|n:${student.name}`];
    const m = smsMark(r);
    s.required++;
    if (m === 'ok') s.present++; else if (m === 'late') s.late++; else if (m === 'leave') s.leave++;
    let hw = '';
    if (se.homework_enabled && hwIsReleased(se, ctx.courseById[String(se.course_id)])) {
      s.hwAssigned++;
      hw = (ctx.sub.has(`${se.id}|${student.id}`) || ctx.sub.has(`${se.id}|n:${student.name}`)) ? 'done' : 'todo';
      if (hw === 'done') s.hwDone++;
    }
    s.marks.push({ date: se.session_date, course: se.course_name || '', no: se.session_number, mark: m, hw });
  });
  s.actual = s.present + s.late;
  s.absent = Math.max(0, s.required - s.actual - s.leave);
  s.rate = s.required ? Math.round(s.actual / s.required * 100) : null;
  return s;
}

async function mrLoadAndRender(stu){
  if(!stu) return;
  const body = document.getElementById('mr_body'); if(!body) return;
  // 拉该生所有 session_records（按名字）+ 该月评价
  if(!mrCache[stu.id]){
    mrCache[stu.id] = await sb(`/rest/v1/session_records?student_name=eq.${encodeURIComponent(stu.name)}&select=*&order=session_date.desc&limit=500`).catch(()=>[]);
  }
  const recs = mrCache[stu.id] || [];
  // 过滤本月
  const monthRecs = recs.filter(r => (r.session_date||'').slice(0,7) === mrYearMonth);
  // 出勤・作业统计：口径见 studentMonthStats（课次数按所属课程算，不靠点名记录条数）
  let st;
  try { st = studentMonthStats(stu, await smsLoad(mrYearMonth)); }
  catch (e) { body.innerHTML = `<div style="font-size:11px;color:var(--danger);padding:20px">统计加载失败：${(e&&e.message)||e}</div>`; return; }
  const required = st.required, actual = st.actual, leave = {length: st.leave};
  const rate = st.rate == null ? 0 : st.rate;
  // 作业图（本月交的、有图的）
  const works = monthRecs.filter(r => r.homework_file_url).map(r => ({url:r.homework_file_url, date:r.session_date, name:r.course_name||''}));
  // 学部美术「作业收集」的作品照片（art_works，按 week_start 落在该月）
  if (typeof awMonthWorks === 'function') works.push(...(await awMonthWorks(stu.id, mrYearMonth)));
  // 拉评价
  const key = `${stu.id}|${mrYearMonth}`;
  if(mrReviewCache[key]===undefined){
    const rv = await sb(`/rest/v1/monthly_reviews?student_id=eq.${encodeURIComponent(stu.id)}&year_month=eq.${mrYearMonth}&select=*&limit=1`).catch(()=>[]);
    mrReviewCache[key] = (rv&&rv[0])||null;
  }
  const rev = mrReviewCache[key];
  const esc = v => String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  // 谁能填：班主任=我负责的学生(owner/vip含我)；专业老师=有"专业课"标签且该生在我可见专业范围
  const canHome = (typeof tpIsMine==='function') ? tpIsMine(stu) : false;
  const isProfTeacher = !!(teacherData && Array.isArray(teacherData.tags) && teacherData.tags.some(t=>String(t).includes('专业课')));
  const canProf = isProfTeacher && tsaStudentOk(stu);
  body.innerHTML = `
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:18px 20px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px">
      <div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600">${esc(stu.name)} · ${mrYearMonth.replace('-','年')}月 学习情况</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:16px">
      ${[['规定出勤',required+' 次'],['实际出勤',actual+' 次'],['出勤率',rate+'%'],['请假',leave.length+' 次'],['缺席/未记录',st.absent+' 次'],['交作业','已交 '+st.hwDone+' / 布置 '+st.hwAssigned]].map(([l,v])=>`
        <div style="background:var(--bg);border:1px solid var(--border-light);border-radius:6px;padding:8px 10px;text-align:center">
          <div style="font-size:16px;font-weight:700;color:var(--accent,#b8953a)">${v}</div>
          <div style="font-size:10px;color:var(--text-3);margin-top:2px">${l}</div>
        </div>`).join('')}
    </div>
    <div style="font-size:10px;color:var(--text-3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">练习作品（学生本月提交）</div>
    ${works.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:16px">
      ${works.map(w=>`<a href="${w.url}" target="_blank" style="display:block;border:1px solid var(--border);border-radius:6px;overflow:hidden"><img src="${w.url}" style="width:100%;height:90px;object-fit:cover;display:block" loading="lazy"><div style="font-size:9px;color:var(--text-3);padding:3px 5px">${(w.date||'').slice(5)}</div></a>`).join('')}
    </div>` : '<div style="font-size:11px;color:var(--text-3);padding:8px 0 16px">本月暂无提交作品</div>'}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="background:var(--bg);border:1px solid var(--border-light);border-radius:6px;padding:12px">
        <div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">专业老师评价 ${canProf?'<span style="font-size:9px;color:var(--accent,#b8953a)">· 你可填写</span>':''}</div>
        ${canProf ? `<textarea id="mr_teacher_review" rows="5" style="width:100%;font-size:12px;line-height:1.7;padding:8px;border:1px solid var(--border);border-radius:4px;background:var(--surface);font-family:inherit;resize:vertical" placeholder="填写本月专业指导评价…">${rev&&rev.teacher_review?esc(rev.teacher_review):''}</textarea>`
          : `<div style="font-size:12px;line-height:1.7;color:var(--text-2);white-space:pre-wrap;min-height:40px">${rev&&rev.teacher_review?esc(rev.teacher_review):'<span style="color:var(--text-3)">（待专业老师填写）</span>'}</div>`}
        ${rev&&rev.teacher_review_by?`<div style="font-size:10px;color:var(--text-3);margin-top:6px;text-align:right">— ${esc(rev.teacher_review_by)}</div>`:''}
      </div>
      <div style="background:var(--bg);border:1px solid var(--border-light);border-radius:6px;padding:12px">
        <div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">班主任评价 ${canHome?'<span style="font-size:9px;color:var(--accent,#b8953a)">· 你可填写</span>':''}</div>
        ${canHome ? `<textarea id="mr_homeroom_review" rows="5" style="width:100%;font-size:12px;line-height:1.7;padding:8px;border:1px solid var(--border);border-radius:4px;background:var(--surface);font-family:inherit;resize:vertical" placeholder="填写本月班主任评价…">${rev&&rev.homeroom_review?esc(rev.homeroom_review):''}</textarea>`
          : `<div style="font-size:12px;line-height:1.7;color:var(--text-2);white-space:pre-wrap;min-height:40px">${rev&&rev.homeroom_review?esc(rev.homeroom_review):'<span style="color:var(--text-3)">（待班主任填写）</span>'}</div>`}
        ${rev&&rev.homeroom_review_by?`<div style="font-size:10px;color:var(--text-3);margin-top:6px;text-align:right">— ${esc(rev.homeroom_review_by)}</div>`:''}
      </div>
    </div>
    ${(canProf||canHome) ? `<div style="margin-top:12px;display:flex;gap:8px;align-items:center">
      <button onclick="mrSaveReview('${stu.id}','${esc(stu.name)}')" style="background:var(--accent,#b8953a);color:#fff;border:none;border-radius:5px;padding:8px 18px;font-size:12px;cursor:pointer;font-family:inherit">💾 保存评价</button>
      <button onclick="mrGeneratePdf('${stu.id}')" class="btn btn-outline btn-sm">📄 生成家长版PDF</button>
      <span id="mr_save_hint" style="font-size:11px;color:var(--ok,#2a9e6a)"></span>
    </div>` : `<div style="margin-top:12px"><button onclick="mrGeneratePdf('${stu.id}')" class="btn btn-outline btn-sm">📄 生成家长版PDF</button></div>`}
  </div>`;
}

// 保存月度评价（按身份只写自己那栏 + 署名；upsert monthly_reviews）
async function mrSaveReview(sid, sname){
  const me = (teacherData && teacherData.name) || '';
  const key = `${sid}|${mrYearMonth}`;
  const existing = mrReviewCache[key] || null;
  const tEl = document.getElementById('mr_teacher_review');
  const hEl = document.getElementById('mr_homeroom_review');
  const row = {
    id: (existing && existing.id) || `mr-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
    student_id: sid, student_name: sname, year_month: mrYearMonth,
    updated_at: new Date().toISOString(),
  };
  // 保留另一栏已有内容，只覆盖自己能填的
  row.teacher_review = existing ? existing.teacher_review : null;
  row.teacher_review_by = existing ? existing.teacher_review_by : null;
  row.homeroom_review = existing ? existing.homeroom_review : null;
  row.homeroom_review_by = existing ? existing.homeroom_review_by : null;
  row.selected_works = existing ? existing.selected_works : [];
  if (tEl){ row.teacher_review = tEl.value.trim() || null; row.teacher_review_by = row.teacher_review ? me : row.teacher_review_by; }
  if (hEl){ row.homeroom_review = hEl.value.trim() || null; row.homeroom_review_by = row.homeroom_review ? me : row.homeroom_review_by; }
  const hint = document.getElementById('mr_save_hint');
  try{
    // upsert：有则 PATCH，无则 POST
    if (existing){
      await sb(`/rest/v1/monthly_reviews?id=eq.${existing.id}`, 'PATCH', row);
    } else {
      await sb('/rest/v1/monthly_reviews', 'POST', row);
    }
    mrReviewCache[key] = row;
    if(hint){ hint.textContent='✓ 已保存'; setTimeout(()=>{if(hint)hint.textContent='';},2000); }
  }catch(e){ alert('保存失败：'+e.message); }
}

// 生成家长版月度学习情况 PDF（米色系，完整）
async function mrGeneratePdf(sid){
  const stu = (mrStudentsCache||[]).find(x=>x.id===sid) || {id:sid, name:''};
  const recs = mrCache[sid] || [];
  const monthRecs = recs.filter(r => (r.session_date||'').slice(0,7) === mrYearMonth);
  let st;
  try { st = studentMonthStats(stu, await smsLoad(mrYearMonth)); } catch (e) { alert('统计加载失败：' + ((e && e.message) || e)); return; }
  const required = st.required, actual = st.actual, leave = {length: st.leave};
  const rate = st.rate == null ? 0 : st.rate;
  const works = monthRecs.filter(r => r.homework_file_url).map(r => ({url:r.homework_file_url, date:r.session_date}));
  if (typeof awMonthWorks === 'function') works.push(...(await awMonthWorks(sid, mrYearMonth)));   // + 作业收集的作品照片
  const key = `${sid}|${mrYearMonth}`;
  const rev = mrReviewCache[key] || {};
  const esc = v => String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const ym = mrYearMonth.replace('-','年')+'月';
  // 家长版 HTML（米色系 style.css 配色）→ 新窗口打印为 PDF
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&family=Noto+Sans+SC:wght@400;500&display=swap" rel="stylesheet"><title>${esc(stu.name)} ${ym} 学习情况</title>
  <style>
    @page{size:A4;margin:16mm}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Noto Sans SC',system-ui,sans-serif;color:#2b2822;background:#fff;line-height:1.7}
    .wrap{max-width:760px;margin:0 auto}
    .head{text-align:center;padding:18px 0 14px;border-bottom:2px solid #b8953a;margin-bottom:20px}
    .head .sub{font-size:12px;color:#9a9590;letter-spacing:.15em;margin-bottom:6px}
    .head h1{font-family:'Noto Serif SC',serif;font-size:28px;font-weight:700;letter-spacing:.05em;color:#2b2822;color:#1a1814}
    .head .stu{font-size:14px;color:#5a5650;margin-top:6px}
    .sec-label{font-family:'Noto Serif SC',serif;font-size:13px;letter-spacing:.05em;color:#b8953a;margin:18px 0 8px;font-weight:600}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:8px}
    .stat{background:#f7f5f0;border:1px solid #ede9e2;border-radius:8px;padding:12px;text-align:center}
    .stat .n{font-family:'Noto Serif SC',serif;font-size:30px;font-weight:600;color:#b8953a;line-height:1}
    .stat .l{font-size:11px;color:#9a9590;margin-top:3px}
    .works{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .works img{width:100%;height:130px;object-fit:cover;border:1px solid #e2ded6;border-radius:6px}
    .review{background:#f7f5f0;border:1px solid #ede9e2;border-radius:8px;padding:14px 16px;margin-bottom:10px}
    .review .t{font-size:12px;font-weight:600;color:#b8953a;margin-bottom:6px}
    .review .c{font-size:13px;line-height:1.9;color:#3a352e;white-space:pre-wrap}
    .review .by{font-size:11px;color:#9a9590;text-align:right;margin-top:8px}
    .foot{text-align:center;font-size:11px;color:#9a9590;margin-top:24px;padding-top:12px;border-top:1px solid #e2ded6}
  </style></head><body><div class="wrap">
    <div class="head">
      <div class="sub">唯新教育 · 学部美术</div>
      <h1>${esc(ym)} 学习情况</h1>
      <div class="stu">${esc(stu.name)}${stu.faculty?' · '+esc(stu.faculty):''}</div>
    </div>
    <div class="sec-label">出勤情况</div>
    <div class="stats">
      <div class="stat"><div class="n">${required}</div><div class="l">规定出勤（次）</div></div>
      <div class="stat"><div class="n">${actual}</div><div class="l">实际出勤（次）</div></div>
      <div class="stat"><div class="n">${rate}%</div><div class="l">出勤率</div></div>
      <div class="stat"><div class="n">${leave.length}</div><div class="l">请假</div></div>
      <div class="stat"><div class="n">${st.absent}</div><div class="l">缺席 / 未记录</div></div>
      <div class="stat"><div class="n">${st.hwDone} / ${st.hwAssigned}</div><div class="l">作业（已交 / 布置）</div></div>
    </div>
    ${works.length?`<div class="sec-label">练习作品（部分）</div><div class="works">${works.slice(0,9).map(w=>`<img src="${w.url}">`).join('')}</div>`:''}
    <div class="sec-label">专业老师评价</div>
    <div class="review"><div class="c">${rev.teacher_review?esc(rev.teacher_review):'—'}</div>${rev.teacher_review_by?`<div class="by">— ${esc(rev.teacher_review_by)} 老师</div>`:''}</div>
    <div class="sec-label">班主任评价</div>
    <div class="review"><div class="c">${rev.homeroom_review?esc(rev.homeroom_review):'—'}</div>${rev.homeroom_review_by?`<div class="by">— ${esc(rev.homeroom_review_by)} 老师</div>`:''}</div>
    <div class="foot">唯新教育　Unique New Education　·　${esc(ym)}</div>
  </div>
  <script>window.onload=function(){ if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){setTimeout(function(){window.print()},400)})}else{setTimeout(function(){window.print()},1200)} }<\/script>
  </body></html>`;
  const w = window.open('', '_blank');
  if(!w){ alert('请允许弹出窗口以生成PDF'); return; }
  w.document.write(html); w.document.close();
}

// ══ 子项2：出席・作业记录 ══
let tsrStudents = [];
let tsrExpandedId = null;
let tsrRecCache = {};

// ══════════ 出席签到（老师端，复刻 admin：选课→点名字签到）══════════
let tatRange='today';       // today | week | all
let tatSessions=[];         // 可见专业下待记出席的课次
let tatCurSession=null;     // 当前签到的课次
let tatStudents=[];         // 当前课次的学生
let tatEdits={};            // student_id -> {attendance_status, student_mode}
let tatState='present', tatMode='offline';

// 顶部：课次签到区（渲染进 renderTsaRecords 顶部）
// 课次分两组：待记录 / 已记录（记过出席的课次也能找到，点「修改出席」带出原来的记录再改，例如迟到、事后请假）
let tatView='todo';         // todo 待记录 | done 已记录
let tatLimit=30;            // 列表每次显示的条数（显示更多 +30）
let tatBar={ pending:[], done:[], stats:{} };   // 当前范围内的课次（已按可见专业过滤）和各课次出席统计
let tatExisting={};         // 当前打开课次已有的记录：student_id -> 最早的一条
let tatEditing=false;       // 当前是否在修改已有记录
const tatYmd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
async function tatRenderSessionBar(){
  const bar=document.getElementById('tat_session_bar'); if(!bar) return;
  const set=tsaAllowedSet();
  const today=new Date(); const todayStr=tatYmd(today);
  // 本周 = 本周一到周日（能看到本周已经上过的课）
  const mon=new Date(today.getFullYear(),today.getMonth(),today.getDate()-((today.getDay()+6)%7));
  const sun=new Date(mon.getFullYear(),mon.getMonth(),mon.getDate()+6);
  // 拉可见专业的课次（course_sessions），按范围过滤；「全部」按日期倒序
  let q=`/rest/v1/course_sessions?select=id,course_name,course_id,session_number,session_date,session_title,time_range,major&order=session_date.${tatRange==='all'?'desc':'asc'}&limit=1000`;
  if(tatRange==='today') q+=`&session_date=eq.${todayStr}`;
  else if(tatRange==='week') q+=`&session_date=gte.${tatYmd(mon)}&session_date=lte.${tatYmd(sun)}`;
  let all=await sb(q).catch(()=>[]);
  // 专业过滤（可见专业）
  if(set){ all=all.filter(se=>{ const mj=se.major||[]; return (Array.isArray(mj)?mj:[mj]).some(m=>tsaMajorOk(m)|| (isMajorGroup(m)&&groupMajors(m).some(x=>tsaMajorOk(x)))); }); }
  // 各课次已有的出席记录 → 区分待记录 / 已记录，并统计
  const stats={};
  const chunks=[]; for(let i=0;i<all.length;i+=100) chunks.push(all.slice(i,i+100).map(se=>`"${se.id}"`).join(','));
  try{
    const parts=await Promise.all(chunks.map(ids=>sbAll(`/rest/v1/session_records?session_id=in.(${ids})&select=id,session_id,student_id,attendance_status`).catch(()=>[])));
    parts.flat().forEach(r=>{
      const st=stats[r.session_id]||(stats[r.session_id]={present:0,late:0,leave:0,absent:0,n:0}); st.n++;
      const v=r.attendance_status||'';
      if(['offline','online','replay'].includes(v)) st.present++; else if(v==='offline_late'||v==='online_late') st.late++; else if(v==='leave') st.leave++; else st.absent++;
    });
  }catch(e){}
  tatBar={ pending:all.filter(se=>!stats[se.id]), done:all.filter(se=>stats[se.id]), stats };
  tatSessions=tatBar.pending.concat(tatBar.done);
  tatBarRender();
}
function tatBarRender(){
  const bar=document.getElementById('tat_session_bar'); if(!bar) return;
  const list=tatView==='done'?tatBar.done:tatBar.pending, shown=list.slice(0,tatLimit);
  const btn=(on,oc,l)=>`<button onclick="${oc}" style="font-size:12px;padding:5px 14px;border:1px solid var(--border);border-radius:5px;cursor:pointer;font-family:inherit;background:${on?'var(--accent,#b8953a)':'var(--bg)'};color:${on?'#fff':'var(--text-2)'}">${l}</button>`;
  const rng=tatRange==='today'?'今天':tatRange==='week'?'本周':'';
  bar.innerHTML=`
    <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">
      ${[['today','今天'],['week','本周'],['all','全部']].map(([k,l])=>btn(tatRange===k,`tatRange='${k}';tatLimit=30;tatRenderSessionBar()`,l)).join('')}
    </div>
    <div style="display:flex;gap:6px;margin-bottom:10px;align-items:center;flex-wrap:wrap">
      ${btn(tatView==='todo',`tatView='todo';tatLimit=30;tatBarRender()`,`待记录 ${tatBar.pending.length}`)}${btn(tatView==='done',`tatView='done';tatLimit=30;tatBarRender()`,`已记录 ${tatBar.done.length}`)}
    </div>
    ${shown.length? `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">${shown.map(se=>{
      const d=new Date(se.session_date+'T12:00:00'); const dow='日一二三四五六'[d.getDay()];
      const st=tatBar.stats[se.id];
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600;color:var(--text)">${(d.getMonth()+1)}/${d.getDate()} <span style="font-size:10px;color:var(--text-3)">周${dow}</span></span>
        <span style="font-size:12px">${tsaEsc(se.course_name)} <span style="font-size:10px;color:var(--text-3)">第${se.session_number}回${se.session_title?' · '+tsaEsc(se.session_title):''}</span></span>
        ${st?`<span style="font-size:10px;color:var(--text-2)">已记录 · 出席 ${st.present} / 迟到 ${st.late} / 请假 ${st.leave} / 缺席 ${st.absent}</span>`:''}
        <button onclick="tatOpen('${se.id}')" style="margin-left:auto;font-size:12px;padding:5px 14px;background:var(--accent,#b8953a);color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit">${st?'✏ 修改出席':'📝 记录出席'}</button>
      </div>`;
    }).join('')}</div>
    ${list.length>shown.length?`<div style="text-align:center;margin:-6px 0 14px"><button onclick="tatLimit+=30;tatBarRender()" style="font-size:12px;padding:5px 18px;border:1px solid var(--border);border-radius:5px;background:var(--bg);cursor:pointer;font-family:inherit">显示更多（还有 ${list.length-shown.length} 节）</button></div>`:''}`
    : `<div style="font-size:12px;color:var(--text-3);padding:12px;text-align:center;margin-bottom:14px">${rng}没有${tatView==='done'?'已记录':'待记录'}的课次${tatView==='todo'&&tatBar.done.length?'（记过的在「已记录」里，可以修改）':''}</div>`}
  `;
}

async function tatOpen(sessionId){
  const se=tatSessions.find(x=>x.id===sessionId)||await sb(`/rest/v1/course_sessions?id=eq.${sessionId}&select=*`).then(r=>r&&r[0]).catch(()=>null);
  if(!se){ alert('课次未找到'); return; }
  tatCurSession=se;
  // 该课的成员学生（全部，不受可见范围限制——记出席要全班；成员规则见 shared/constants.js 的 courseMemberIds）
  const majors=Array.isArray(se.major)?se.major:(se.major?[se.major]:[]);
  const [all,crs,cms,recs]=await Promise.all([
    sbAll('/rest/v1/students?select=*&status=eq.active&order=name.asc').catch(()=>[]),
    se.course_id?sb(`/rest/v1/courses?id=eq.${encodeURIComponent(se.course_id)}&select=*`).catch(()=>[]):Promise.resolve([]),
    se.course_id?sb(`/rest/v1/course_members?course_id=eq.${encodeURIComponent(se.course_id)}&select=course_id,student_id,kind`).catch(()=>[]):Promise.resolve([]),
    sbAll(`/rest/v1/session_records?session_id=eq.${encodeURIComponent(se.id)}&select=*`).catch(()=>[])
  ]);
  const c=(crs||[])[0]||{};
  const course=Object.assign({id:se.course_id},c,{major:majors.length?majors:(c.major||[])});
  const ids=courseMemberIds(course,all||[],cms||[]);
  tatStudents=(all||[]).filter(s=>ids.has(String(s.id)));
  // 已有记录：每个学生取最早的一条（以前重复保存留下的多条，只更新最早那条）
  tatExisting={};
  (recs||[]).slice().sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id).localeCompare(String(b.id))).forEach(r=>{ if(r.student_id&&!tatExisting[r.student_id]) tatExisting[r.student_id]=r; });
  // 有记录、但现在已不在成员名单 / 不在籍的学生也要带出来，不然改不了
  const missing=Object.keys(tatExisting).filter(id=>!tatStudents.some(s=>String(s.id)===String(id)));
  if(missing.length){ const extra=await sb(`/rest/v1/students?id=in.(${missing.map(x=>`"${x}"`).join(',')})&select=*`).catch(()=>[]); tatStudents=tatStudents.concat(extra||[]); }
  tatStudents.sort((a,b)=>a.name.localeCompare(b.name,'zh'));
  tatEditing=Object.keys(tatExisting).length>0;
  tatEdits={}; tatState='present'; tatMode='offline';
  tatStudents.forEach(s=>{ const r=tatExisting[s.id]; if(r&&r.attendance_status) tatEdits[s.id]={attendance_status:r.attendance_status,student_mode:r.student_mode||s.default_mode||'offline'}; });
  tatRenderModal();
}

function tatCurStatus(){ if(tatState==='leave')return'leave'; if(tatState==='late')return tatMode==='online'?'online_late':'offline_late'; return tatMode==='online'?'online':'offline'; }
function tatStatusFull(v){const m={online:{t:'线上出席',c:'#2a6aad'},offline:{t:'线下出席',c:'var(--ok,#2a9e6a)'},replay:{t:'录播回看',c:'var(--warn,#b8860b)'},online_late:{t:'线上迟到',c:'#b8860b'},offline_late:{t:'线下迟到',c:'#b8860b'},leave:{t:'请假',c:'var(--text-3,#999)'}};return m[v]||{t:v||'缺席',c:'var(--danger,#b03a2e)'};}
function tatPickState(st){tatState=st;['present','late','leave'].forEach(k=>{const b=document.getElementById('tat_st_'+k);if(b){const on=k===st;b.style.background=on?'var(--accent,#b8953a)':'var(--bg)';b.style.color=on?'#fff':'var(--text-2)';}});const mw=document.getElementById('tat_mode_wrap');if(mw)mw.style.display=(st==='leave')?'none':'flex';}
function tatPickMode(md){tatMode=md;['offline','online'].forEach(k=>{const b=document.getElementById('tat_md_'+k);if(b){const on=k===md;b.style.background=on?'#2a6aad':'var(--bg)';b.style.color=on?'#fff':'var(--text-2)';}});}
function tatMark(sid){const s=tatStudents.find(x=>x.id===sid);if(!s)return;if(!tatEdits[sid])tatEdits[sid]={};tatEdits[sid].attendance_status=tatCurStatus();tatEdits[sid].student_mode=(tatState==='leave')?(s.default_mode||'offline'):tatMode;tatRenderRows();}
function tatUnmark(sid){if(tatEdits[sid])tatEdits[sid].attendance_status='';tatRenderRows();}

function tatRenderModal(){
  let ov=document.getElementById('tatOverlay');
  if(!ov){ov=document.createElement('div');ov.id='tatOverlay';ov.style.cssText='position:fixed;inset:0;z-index:980;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:16px';document.body.appendChild(ov);}
  ov.style.display='flex';
  const se=tatCurSession; const d=new Date(se.session_date+'T12:00:00');
  ov.innerHTML=`<div style="background:var(--surface);border-radius:10px;padding:16px 18px;width:min(560px,96vw);margin:auto">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
      <div><div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600">${tsaEsc(se.course_name)} 第${se.session_number}回${tatEditing?' <span style="font-family:inherit;font-size:10px;font-weight:500;color:var(--accent,#b8953a);border:1px solid var(--accent,#b8953a);border-radius:3px;padding:1px 6px;vertical-align:middle">修改已有记录</span>':''}</div>
      <div style="font-size:11px;color:var(--text-3)">${se.session_date} ${se.time_range||''}</div></div>
      <button onclick="document.getElementById('tatOverlay').style.display='none'" style="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:5px;background:var(--bg);cursor:pointer;font-family:inherit">关闭</button>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <div style="display:flex;border:1px solid var(--border);border-radius:5px;overflow:hidden">
        <button id="tat_st_present" onclick="tatPickState('present')" style="font-size:12px;padding:5px 12px;border:none;cursor:pointer;font-family:inherit;background:var(--accent,#b8953a);color:#fff">出席</button>
        <button id="tat_st_late" onclick="tatPickState('late')" style="font-size:12px;padding:5px 12px;border:none;border-left:1px solid var(--border);cursor:pointer;font-family:inherit;background:var(--bg);color:var(--text-2)">迟到</button>
        <button id="tat_st_leave" onclick="tatPickState('leave')" style="font-size:12px;padding:5px 12px;border:none;border-left:1px solid var(--border);cursor:pointer;font-family:inherit;background:var(--bg);color:var(--text-2)">请假</button>
      </div>
      <div id="tat_mode_wrap" style="display:flex;border:1px solid var(--border);border-radius:5px;overflow:hidden">
        <button id="tat_md_offline" onclick="tatPickMode('offline')" style="font-size:12px;padding:5px 12px;border:none;cursor:pointer;font-family:inherit;background:#2a6aad;color:#fff">线下</button>
        <button id="tat_md_online" onclick="tatPickMode('online')" style="font-size:12px;padding:5px 12px;border:none;border-left:1px solid var(--border);cursor:pointer;font-family:inherit;background:var(--bg);color:var(--text-2)">线上</button>
      </div>
      <button onclick="tatSummary()" style="font-size:11px;padding:5px 10px;border:1px solid var(--border);border-radius:5px;background:var(--bg);cursor:pointer;font-family:inherit;margin-left:auto">📋汇总</button>
    </div>
    <input id="tat_search" placeholder="搜索姓名（汉字 / 拼音首字母）/ 专业…" oninput="searchBox(this,tatRenderRows)" style="font-size:12px;padding:6px 10px;width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;margin-bottom:8px">
    <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">未点名 <span id="tat_cnt"></span>（点名字=当前状态）</div>
    <div id="tat_body" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px;max-height:42vh;overflow-y:auto"></div>
    <div id="tat_marked" style="border-top:1px solid var(--border);padding-top:8px;margin-bottom:12px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('tatOverlay').style.display='none'" style="font-size:12px;padding:8px 16px;border:1px solid var(--border);border-radius:5px;background:var(--bg);cursor:pointer;font-family:inherit">关闭</button>
      <button onclick="tatSave()" id="tat_save" style="font-size:12px;padding:8px 18px;border:none;border-radius:5px;background:var(--accent,#b8953a);color:#fff;cursor:pointer;font-family:inherit">保存全部</button>
    </div>
  </div>`;
  tatPickState('present'); tatPickMode('offline'); tatRenderRows();
}

function tatRenderRows(){
  const kw=(document.getElementById('tat_search')?.value||'').trim();
  const marked=tatStudents.filter(s=>tatEdits[s.id]&&tatEdits[s.id].attendance_status);
  const unmarked=tatStudents.filter(s=>!(tatEdits[s.id]&&tatEdits[s.id].attendance_status));
  const shown=kw?unmarked.filter(s=>matchesStudentSearch(s,kw)):unmarked;
  const body=document.getElementById('tat_body');
  if(body) body.innerHTML=shown.length?shown.map(s=>`<button onclick="tatMark('${s.id}')" style="font-family:'Noto Serif SC',serif;font-size:13px;font-weight:600;padding:11px 4px;border:1px solid var(--border);border-radius:8px;background:var(--surface);cursor:pointer;color:var(--text)">${s.name}</button>`).join(''):`<div style="grid-column:1/-1;font-size:12px;color:var(--text-3);padding:16px;text-align:center">${kw?'无匹配':'全部已点 ✓'}</div>`;
  const cnt=document.getElementById('tat_cnt'); if(cnt)cnt.textContent=`剩 ${unmarked.length} 人`;
  const area=document.getElementById('tat_marked');
  if(area){const g={};marked.forEach(s=>{const st=tatEdits[s.id].attendance_status;(g[st]=g[st]||[]).push(s);});
    const order=['offline','online','replay','offline_late','online_late','leave'];const keys=Object.keys(g).sort((a,b)=>order.indexOf(a)-order.indexOf(b));
    area.innerHTML=`<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">已点 ${marked.length} · 未点 ${unmarked.length}（记为缺席）</div>`+(keys.map(st=>{const i=tatStatusFull(st);return `<div style="margin-bottom:8px"><span style="font-size:11px;font-weight:600;color:${i.c}">${i.t}（${g[st].length}）</span> <span style="display:inline-flex;flex-wrap:wrap;gap:6px">${g[st].map(s=>`<span onclick="tatUnmark('${s.id}')" style="font-size:12px;padding:3px 10px;border-radius:12px;background:var(--bg);border:1px solid ${i.c};color:${i.c};cursor:pointer">${s.name} ✕</span>`).join('')}</span></div>`;}).join('')||'<div style="font-size:11px;color:var(--text-3)">还没点名</div>');}
}

function tatSummary(){
  const g={present_off:[],present_on:[],late:[],leave:[],absent:[]};
  tatStudents.forEach(s=>{const st=(tatEdits[s.id]||{}).attendance_status||'';if(st==='offline')g.present_off.push(s.name);else if(st==='online')g.present_on.push(s.name);else if(st==='offline_late'||st==='online_late')g.late.push(s.name);else if(st==='leave')g.leave.push(s.name);else g.absent.push(s.name);});
  let ov=document.getElementById('tatSumOv');if(!ov){ov=document.createElement('div');ov.id='tatSumOv';ov.style.cssText='position:fixed;inset:0;z-index:995;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px';document.body.appendChild(ov);}
  ov.style.display='flex';
  ov.innerHTML=`<div style="background:#fff;border-radius:8px;padding:20px;max-width:520px;width:100%;max-height:82vh;overflow:auto">
    <div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600;margin-bottom:4px">${tsaEsc(tatCurSession.course_name)} 第${tatCurSession.session_number}回</div>
    <div style="font-size:11px;color:#999;margin-bottom:12px">📸 可截图对照</div>
    ${[['线下出席',g.present_off,'#2a9e6a'],['线上出席',g.present_on,'#2a6aad'],['迟到',g.late,'#b8860b'],['请假',g.leave,'#999'],['缺席',g.absent,'#b03a2e']].map(([l,a,c])=>`<div style="margin-bottom:10px"><div style="font-size:12px;font-weight:600;color:${c};margin-bottom:3px">${l}（${a.length}人）</div><div style="font-size:13px;line-height:1.9;color:#333">${a.join('、')||'—'}</div></div>`).join('')}
    <button onclick="document.getElementById('tatSumOv').style.display='none'" style="font-size:12px;padding:7px 16px;border:none;border-radius:5px;background:var(--accent,#b8953a);color:#fff;cursor:pointer;font-family:inherit">关闭</button>
  </div>`;
}

async function tatSave(){
  const se=tatCurSession; const btn=document.getElementById('tat_save');
  if(btn){btn.textContent='保存中…';btn.disabled=true;}
  try{
    const news=[], updates=[];
    tatStudents.forEach(s=>{
      const e=tatEdits[s.id]||{};
      const status=e.attendance_status||'', mode=e.student_mode||s.default_mode||'offline';
      const old=tatExisting[s.id];
      if(old){   // 已有记录：只更新出席状态和上课方式，不动作业相关字段（homework_submitted / homework_file_url 等）
        if((old.attendance_status||'')!==status||(old.student_mode||'')!==mode) updates.push({id:old.id,patch:{attendance_status:status,student_mode:mode}});
      } else news.push({
        id:`r-${Date.now()}-${Math.random().toString(36).slice(2,5)}-${s.id.slice(-3)}`,
        session_id:se.id, course_name:se.course_name, session_date:se.session_date,
        student_id:s.id, student_name:s.name, major:s.major,
        student_mode:mode, attendance_status:status,
      });
    });
    // 分批 PATCH 已有记录
    for(let i=0;i<updates.length;i+=10){ await Promise.all(updates.slice(i,i+10).map(u=>sb(`/rest/v1/session_records?id=eq.${encodeURIComponent(u.id)}`,'PATCH',u.patch))); }
    // 分批 POST 新记录
    for(let i=0;i<news.length;i+=20){ await sb('/rest/v1/session_records','POST',news.slice(i,i+20)); }
    document.getElementById('tatOverlay').style.display='none';
    alert(`✓ 已${tatEditing?'更新':'保存'} ${se.course_name} 第${se.session_number}回 出席（${tatStudents.length} 人${tatEditing?`，修改 ${updates.length} 条、新增 ${news.length} 条`:''}）`);
    tsrRecCache={}; smsCtxCache={};   // 学生出席历史、月度统计缓存作废
    if(document.getElementById('tsr_list')) tsrLoadStats();   // 列表上的统计立刻刷新
    tatRenderSessionBar();  // 刷新课次列表（这一节出现在「已记录」，统计更新）
  }catch(e){ alert('保存失败：'+e.message); if(btn){btn.textContent='保存全部';btn.disabled=false;} }
}

async function renderTsaRecords(box) {
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    tsrStudents = (await tsmLoadPool()).slice();   // 全部状态（已按可见范围裁剪）；由全局「状态」筛选
    smsCtxCache = {}; tsrCtx = null;   // 每次进入页面都重新读最新的出席・作业
  } catch (e) { box.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }
  tsrRender();
}

let tsrHistOpen=true;
let tsrYm=null;          // 统计月份：'YYYY-MM'，'' = 全部；null = 还没选过（默认本月）
let tsrCtx=null;         // 当前月份的统计数据（smsLoad）；null = 加载中
let tsrCtxErr='';
function tsrAtt(v) {
  if (!v) return { t:'缺席', c:'var(--danger,#b03a2e)' };
  return ({
    offline: { t:'线下出席', c:'var(--ok,#2a9e6a)' },
    online:  { t:'线上出席', c:'#2a6aad' },
    replay:  { t:'录播回看', c:'var(--warn,#b8860b)' },
    leave:   { t:'请假',     c:'var(--text-3,#999)' },
  })[v] || { t:v, c:'var(--text-2,#666)' };
}

const TSR_MARK = { ok: ['✓', '#1a6d3a', '#e4f3ea', '出席'], late: ['迟', '#8a6d10', '#fef5e0', '迟到'], leave: ['假', '#5a6a7a', '#eef1f5', '请假'], absent: ['✗', '#c0392b', '#fdecea', '缺席'], none: ['', 'var(--border)', 'transparent', '未记录'] };

// 打开页面 / 换月份时，一次性批量加载统计（不再逐个学生点开才加载）
async function tsrLoadStats() {
  const ym = tsrYm;
  tsrCtx = null; tsrCtxErr = '';
  try { const c = await smsLoad(ym); if (tsrYm === ym) tsrCtx = c; }
  catch (e) { if (tsrYm === ym) tsrCtxErr = (e && e.message) || String(e); }
  if (tsrYm === ym) tsrRenderList();
}
function tsrSetYm(ym) { tsrYm = ym; tsmShown = TSM_PAGE; tsrRender(); }

function tsrRender() {
  const box = document.getElementById('sm_content');
  if (!box) return;
  if (tsrYm === null) tsrYm = tmCurYm();
  const rp = smRecPerm();   // view 查看 / entry 登记
  const cur = tmCurYm();
  const arrow = (n, tx) => tsrYm ? `<span onclick="tsrSetYm('${tmShiftYm(tsrYm, n)}')" style="cursor:pointer;user-select:none;font-size:13px;padding:2px 10px;border:1px solid var(--border);border-radius:3px;background:var(--surface)">${tx}</span>` : '';

  box.innerHTML = `<div>
    <!-- 签到区（选课→点名字记出席），只有登记权限才显示 -->
    ${rp.entry ? '<div id="tat_session_bar" style="margin-bottom:6px"></div>' : ''}
    ${(rp.entry && typeof awTeacherIsArt === 'function' && awTeacherIsArt()) ? '<div id="aw_teacher_box"></div>' : ''}
    <!-- 学生出席统计（可收起），只有查看权限才显示 -->
    ${rp.view ? `<div onclick="tsrHistOpen=!tsrHistOpen;tsrRender()" style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-2);padding:8px 0;border-top:1px solid var(--border);user-select:none">${tsrHistOpen?'▾':'▸'} 学生出席・作业（<span id="tsr_n">${tsmFilterStudents(tsrStudents).length}</span> 人，点击${tsrHistOpen?'收起':'展开'}）</div>
    <div style="display:${tsrHistOpen?'block':'none'}">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      ${arrow(-1, '‹')}<span style="font-size:13px;font-weight:600;min-width:92px;text-align:center">${tsrYm ? tsrYm.replace('-', '年') + '月' : '全部月份'}</span>${arrow(1, '›')}
      ${tsrYm ? `<div class="filter-chip" onclick="tsrSetYm('')" style="padding:3px 10px;font-size:10px">全部</div>` : `<div class="filter-chip active" style="padding:3px 10px;font-size:10px">全部</div>`}
      ${tsrYm === cur ? '' : `<span onclick="tsrSetYm('${cur}')" style="font-size:10px;color:var(--accent);cursor:pointer">回到本月</span>`}
      <span style="font-size:10px;color:var(--text-3)">应出席按学生所属课程的课次算（不含休讲、到今天为止），迟到算出席；出勤率低于 80% 标橙色</span>
    </div>
    <div id="tsr_list"></div>
  </div>` : ''}
  </div>`;
  if (rp.view && tsrHistOpen) { tsrRenderList(); if (!tsrCtx || tsrCtx.ym !== tsrYm) tsrLoadStats(); }
  if(rp.entry && typeof tatRenderSessionBar==='function') tatRenderSessionBar();
  if(document.getElementById('aw_teacher_box')) awTeacherMount('aw_teacher_box', tsmFilterStudents(tsrStudents));   // 学部美术：🎨 作业收集
}

function tsrStatsHtml(s) {
  if (tsrCtxErr) return `<span style="font-size:10px;color:var(--danger)">统计加载失败</span>`;
  if (!tsrCtx || tsrCtx.ym !== tsrYm) return `<span style="font-size:10px;color:var(--text-3)">统计加载中…</span>`;
  const st = studentMonthStats(s, tsrCtx);
  if (!st.required) return `<span style="font-size:10px;color:var(--text-3)">${tsrYm ? '本月无课次' : '暂无课次'}</span>`;
  const low = st.rate != null && st.rate < 80;
  const marks = st.marks.slice(-40).map(m => { const d = TSR_MARK[m.mark]; return `<span title="${tsaEsc(m.date)} ${tsaEsc(m.course)}：${d[3]}${m.hw ? (m.hw === 'done' ? ' · 作业已交' : ' · 作业未交') : ''}" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:3px;font-size:9px;border:1px solid ${d[1]};background:${d[2]};color:${d[1]}">${d[0]}</span>`; }).join('');
  return `<span style="font-size:11px;color:var(--text-2)"><span style="${low ? 'color:#c9731a;font-weight:600' : ''}">出席 ${st.actual} / 应出席 ${st.required}（${st.rate}%）</span> · 请假 ${st.leave} · 缺席 ${st.absent} · 作业 已交 ${st.hwDone} / 布置 ${st.hwAssigned}</span><span style="display:inline-flex;gap:2px;flex-wrap:wrap">${marks}</span>`;
}

function tsrRenderList() {
  const el = document.getElementById('tsr_list'); if (!el) return;
  const listAll = tsmFilterStudents(tsrStudents);
  const list = tsmSlice(listAll);
  const n = document.getElementById('tsr_n'); if (n) n.textContent = listAll.length;
  el.innerHTML = `<div style="border:1px solid var(--border);border-radius:4px;overflow:hidden">
      ${list.length ? list.map(s => {
        const recs = tsrRecCache[s.id];
        return `<div>
        <div onclick="tsrToggle('${s.id}')" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);${tsrExpandedId === s.id ? 'background:var(--bg)' : ''}">
          <span style="font-size:12px;font-weight:600">${tsaEsc(s.name)}</span>
          <span style="font-size:10px;color:var(--text-3)">${MAJORS[s.major] || s.major || ''}${s.level ? ' · ' + s.level : ''}</span>
          <span style="margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${tsrStatsHtml(s)}</span>
          <span style="font-size:10px;color:var(--text-3)">${tsrExpandedId === s.id ? '▲' : '▼'}</span>
        </div>
        ${tsrExpandedId === s.id ? `<div style="padding:8px 12px;background:var(--bg);border-bottom:1px solid var(--border)">
          ${!recs ? '<div style="font-size:11px;color:var(--text-3);padding:6px">加载中…</div>' : !recs.length ? '<div style="font-size:11px;color:var(--text-3);padding:6px">暂无出席・作业记录</div>' : `
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr>${['日期','课程','出席','作业'].map(h => `<th style="padding:4px 8px;text-align:left;font-weight:600;color:var(--text-3);border-bottom:1px solid var(--border)">${h}</th>`).join('')}</tr></thead>
            <tbody>${recs.map(r => {
              const a = tsrAtt(r.attendance_status);
              const hw = (r.homework_submitted || r.homework_file_url)
                ? (r.homework_file_url ? `<a href="${r.homework_file_url}" target="_blank" onclick="event.stopPropagation()" style="color:var(--accent)">✓ 已交（查看）</a>` : '<span style="color:var(--ok,#2a9e6a)">✓ 已交</span>')
                : '<span style="color:var(--text-3)">—</span>';
              return `<tr style="border-bottom:1px solid var(--border)">
                <td style="padding:5px 8px;white-space:nowrap">${r.session_date || ''}</td>
                <td style="padding:5px 8px">${tsaEsc(r.course_name || '')}</td>
                <td style="padding:5px 8px;color:${a.c}">${a.t}</td>
                <td style="padding:5px 8px">${hw}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>`}
        </div>` : ''}
      </div>`;
      }).join('') : '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:11px">暂无学生</div>'}
    </div>
    ${tsmMoreHtml(listAll.length)}`;
}

async function tsrToggle(id) {
  tsrExpandedId = tsrExpandedId === id ? null : id;
  tsrRenderList();
  if (tsrExpandedId !== id || tsrRecCache[id]) return;
  const s = tsrStudents.find(x => x.id === id);
  if (!s) return;
  try {
    const recs = await sb(`/rest/v1/session_records?student_name=eq.${encodeURIComponent(s.name)}&select=*&order=session_date.desc&limit=200`).catch(() => []);
    // 补课程名（通过 session_id 查 course_sessions）
    const sids = [...new Set(recs.map(r => r.session_id).filter(Boolean))];
    const sesMap = {};
    for (let i = 0; i < sids.length; i += 80) {
      const chunk = sids.slice(i, i + 80);
      const batch = await sb(`/rest/v1/course_sessions?id=in.(${chunk.map(x => `"${x}"`).join(',')})&select=id,course_name`).catch(() => []);
      (batch || []).forEach(cs => sesMap[cs.id] = cs);
    }
    tsrRecCache[id] = recs.map(r => Object.assign({}, r, { course_name: r.course_name || (sesMap[r.session_id] && sesMap[r.session_id].course_name) || '' }));
  } catch (e) { tsrRecCache[id] = []; }
  if (tsrExpandedId === id) tsrRenderList();
}

// ══ 计划书内容渲染（供考学进度卡片与批注弹窗使用） ══
// 草稿字段标签（经济/经营/社会人文三套模板字段的并集）
const T_DRAFT_LABELS = {
  theme:'研究テーマ', field:'志望分野', data_source:'データ出処', data_type:'データ種類',
  prior_lit:'先行文献', hypothesis:'仮説', difference:'先行研究との違い',
  var_y:'被説明変数Y', var_x:'説明変数X', var_ctrl:'コントロール変数',
  model:'モデル', model_other:'その他', regression:'回帰式',
  background:'一、研究背景', prior:'二、先行研究', purpose:'三、研究目的',
  method:'四、研究方法', significance:'五、研究意義',
};
// 先行研究字段标签（两套整理格式的并集）
const T_REF_LABELS = {
  keyword:'キーワード', title:'題目/テーマ', author:'著者', year:'年', journal:'刊行物',
  data:'研究対象/データ', method:'研究方法', summary:'概要', awareness:'問題意識',
  conclusion:'結論', citation:'引用', evaluation:'評価', note:'備考',
};

function tDraftRefs(draft) { try { return draft && draft.prior_research_list ? JSON.parse(draft.prior_research_list) : []; } catch (e) { return []; } }
function tDraftFields(draft) { try { return draft && draft.draft_fields ? JSON.parse(draft.draft_fields) : {}; } catch (e) { return {}; } }
function tFieldVal(v) { return Array.isArray(v) ? v.join('、') : (v == null ? '' : String(v)); }

// 卡片内摘要：先行研究条数 + 前几个已填字段
function tDraftSummaryHtml(draft) {
  const refs = tDraftRefs(draft);
  const filled = Object.entries(tDraftFields(draft)).filter(([k, v]) => tFieldVal(v).trim());
  const lines = [`<div style="font-size:11px;color:var(--text-2)">📚 先行研究：${refs.length ? `已整理 ${refs.length} 条` : '未整理'}</div>`];
  filled.slice(0, 3).forEach(([k, v]) => {
    const t = tFieldVal(v).replace(/\n/g, ' ');
    lines.push(`<div style="font-size:11px;color:var(--text-2)">${T_DRAFT_LABELS[k] || k}：${tsaEsc(t.length > 26 ? t.slice(0, 26) + '…' : t)}</div>`);
  });
  if (!filled.length) {
    if (draft.research_question) lines.push(`<div style="font-size:11px;color:var(--text-2)">问题：${tsaEsc(draft.research_question.slice(0, 40))}…</div>`);
    if (draft.methodology) lines.push(`<div style="font-size:11px;color:var(--text-2)">方法：${tsaEsc(draft.methodology.slice(0, 30))}…</div>`);
  }
  if (filled.length > 3) lines.push(`<div style="font-size:10px;color:var(--text-3)">…共 ${filled.length} 项已填，点击下方查看全文</div>`);
  return lines.join('');
}

// 弹窗内全文：先行研究逐条 + 草稿字段逐项 + 旧字段兼容
function tDraftFullHtml(draft) {
  const refs = tDraftRefs(draft);
  const filled = Object.entries(tDraftFields(draft)).filter(([k, v]) => tFieldVal(v).trim());
  let h = '';
  if (refs.length) {
    h += `<div style="font-weight:600;margin-bottom:4px">📚 先行研究（${refs.length}条）</div>`;
    h += refs.map((r, i) => {
      const parts = Object.entries(r).filter(([k, v]) => v).map(([k, v]) => `<span style="color:var(--text-3)">${T_REF_LABELS[k] || k}：</span>${tsaEsc(v)}`).join('　');
      return `<div style="margin-bottom:5px;padding-bottom:5px;border-bottom:1px dashed var(--border)">${i + 1}. ${parts}</div>`;
    }).join('');
  }
  if (filled.length) {
    h += `<div style="font-weight:600;margin:8px 0 4px">📄 计划书草稿</div>`;
    h += filled.map(([k, v]) => `<div style="margin-bottom:5px"><span style="color:var(--text-3)">${T_DRAFT_LABELS[k] || k}：</span>${tsaEsc(tFieldVal(v)).replace(/\n/g, '<br>')}</div>`).join('');
  }
  if (draft.research_question) h += `<div style="margin-bottom:4px"><span style="color:var(--text-3)">问题意识：</span>${tsaEsc(draft.research_question)}</div>`;
  if (draft.methodology) h += `<div style="margin-bottom:4px"><span style="color:var(--text-3)">研究方法：</span>${tsaEsc(draft.methodology)}</div>`;
  if (draft.draft_notes) h += `<div style="margin-bottom:4px"><span style="color:var(--text-3)">进展说明：</span>${tsaEsc(draft.draft_notes)}</div>`;
  return h || '<div style="color:var(--text-3)">暂无填写内容</div>';
}

// ══════════════════════════════════
// 面谈跟进（学生管理子项 meetings）——按「每月一次」跟进
// 规则：每个学生每月至少一次面谈；没有面谈的，老师补「联系记录」：
//   学习记录（学生回复了、记了学习进度）→ 这个月算完成；联系未回复 → 没完成，继续跟进。
//   连续 3 次联系未回复（中间没有面谈 / 学习记录）→ 转入重点关注。
// ══════════════════════════════════
const TM_KIND = { study: { t: '学习记录', c: '#1a6d3a', ic: '✎' }, no_reply: { t: '联系未回复', c: '#b8560b', ic: '✉' } };
const TM_GROUPS = [['done', '✓ 已完成'], ['pend', '⏳ 待面谈'], ['noreply', '✉ 已联系未回复'], ['none', '⚠ 无面谈无记录']];
let tmYm = '';             // 当前查看的月份 YYYY-MM（空 = 本月）
let tmGroup = '';          // '' 全部 | done | pend | noreply | none
let tmExpandedId = null;
let tmData = null;         // { students, rec, pend, logs, cache }

function tmPad2(n) { return String(n).padStart(2, '0'); }
function tmCurYm() { const d = new Date(); return d.getFullYear() + '-' + tmPad2(d.getMonth() + 1); }
function tmShiftYm(ym, n) { const p = ym.split('-').map(Number); const d = new Date(p[0], p[1] - 1 + n, 1); return d.getFullYear() + '-' + tmPad2(d.getMonth() + 1); }
function tmMonthWord() { return (tmYm || tmCurYm()) === tmCurYm() ? '本月' : parseInt(tmYm.slice(5), 10) + '月'; }
function tmJstYmd(iso) { return iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : ''; }
function tmHasRec(b) { return !!(b && b.daily_record && Object.values(b.daily_record).some(v => v && (typeof v === 'string' ? v : Object.values(v).some(x => x)))); }
function tmLogKind(l) { return l.kind === 'no_reply' ? 'no_reply' : 'study'; }
function tmLogYm(l) { return l.for_month || tmJstYmd(l.created_at).slice(0, 7); }
// 记录在时间线上的位置（补记往月的记录，按那个月月底算，避免排在后面的面谈前面）
function tmLogKey(l) { const ym = tmLogYm(l), cd = tmJstYmd(l.created_at); return cd.slice(0, 7) === ym ? cd : ym + '-28'; }

async function renderTsaMeetings(box) {
  box.innerHTML = '<div class="empty">加载中…</div>';
  if (!tmYm) tmYm = tmCurYm();
  try {
    const [allStu, allBk, allPend, allLogs] = await Promise.all([
      sb('/rest/v1/students?select=id,name,major,source,status,course_type,student_code,class_ids,vip_teachers&limit=2000').catch(() => []),
      sbAll('/rest/v1/bookings?daily_record=not.is.null&select=*&order=slot_date.desc'),
      sbAll('/rest/v1/bookings?status=in.("pending","confirmed")&select=id,name,student_id,major,slot_date,slot_time_range,status,type,assigned_teacher,daily_record'),
      sbAll('/rest/v1/student_contact_logs?select=*&order=created_at.desc'),
    ]);
    let myStudents = tsaFilterStudents(allStu);   // 全部状态；由全局「状态」筛选
    if (tsaGuaranteedLock()) myStudents = myStudents.filter(tsaIsGuaranteed);
    // 按学生 id 归档；没绑定学生 id 的（新同学预约、旧记录）按姓名归档
    const idx = () => ({ id: {}, nm: {} });
    const put = (ix, row, name) => { if (row.student_id) (ix.id[row.student_id] = ix.id[row.student_id] || []).push(row); else (ix.nm[name] = ix.nm[name] || []).push(row); };
    const rec = idx(), pend = idx(), logs = idx();
    (allBk || []).forEach(b => { if (tmHasRec(b)) put(rec, b, b.name); });
    (allPend || []).forEach(b => { if (b.type !== 'vip' && !tmHasRec(b)) put(pend, b, b.name); });
    (allLogs || []).forEach(l => put(logs, l, l.student_name));
    tmData = { students: myStudents, rec, pend, logs, cache: {} };
  } catch (e) { box.innerHTML = `<div class="empty">加载失败：${tsaEsc(e.message)}</div>`; return; }
  tmRenderShell();
}

// 一个学生的全部面谈 / 预约 / 联系记录
function tmInfo(s) {
  const c = tmData.cache;
  if (c[s.id]) return c[s.id];
  const pick = ix => (ix.id[s.id] || []).concat(ix.nm[s.name] || []);
  return (c[s.id] = {
    recs: pick(tmData.rec).sort((a, b) => (b.slot_date || '').localeCompare(a.slot_date || '')),
    pend: pick(tmData.pend).sort((a, b) => (a.slot_date || '').localeCompare(b.slot_date || '')),
    logs: pick(tmData.logs).sort((a, b) => tmLogKey(b).localeCompare(tmLogKey(a))),
  });
}
// 某个月的状态：group = done | pend | noreply | none
function tmMonthState(info, ym) {
  const mtg = info.recs.filter(b => (b.slot_date || '').slice(0, 7) === ym);
  const inM = info.logs.filter(l => tmLogYm(l) === ym);
  const study = inM.filter(l => tmLogKind(l) === 'study'), nore = inM.filter(l => tmLogKind(l) === 'no_reply');
  const pend = info.pend.filter(b => (b.slot_date || '').slice(0, 7) === ym);
  const group = (mtg.length || study.length) ? 'done' : pend.length ? 'pend' : nore.length ? 'noreply' : 'none';
  const cell = mtg.length ? 'mtg' : study.length ? 'study' : pend.length ? 'pend' : nore.length ? 'noreply' : '';
  return { group, cell, mtg, study, nore, pend };
}
// 截至某月月底，连续几次联系未回复（中间有面谈 / 学习记录就清零）
function tmStreak(info, uptoYm) {
  const ev = info.recs.map(b => ({ k: b.slot_date || '', ok: true })).concat(info.logs.map(l => ({ k: tmLogKey(l), ok: tmLogKind(l) === 'study' })))
    .filter(e => e.k && (!uptoYm || e.k.slice(0, 7) <= uptoYm)).sort((a, b) => a.k.localeCompare(b.k) || (b.ok ? 1 : 0) - (a.ok ? 1 : 0));
  let n = 0;
  ev.forEach(e => { n = e.ok ? 0 : n + 1; });
  return n;
}
// 当前筛选下每个学生的本月分组
function tmRows() {
  const ym = tmYm || tmCurYm();
  return tsmFilterStudents(tmData.students || []).map(s => {
    const info = tmInfo(s), st = tmMonthState(info, ym);
    return { s, info, st, streak: st.group === 'noreply' ? tmStreak(info, ym) : 0 };
  });
}
// 当前筛选下「本月无面谈无记录」的学生（批量提醒用）
function tmNoRecStudents() { return tmRows().filter(r => r.st.group === 'none').map(r => r.s); }

function tmRenderShell() {
  const box = document.getElementById('sm_content');
  if (!box || !tmData) return;
  if (!tmYm) tmYm = tmCurYm();
  const cur = tmYm === tmCurYm();
  const arrow = (n, t) => `<span onclick="tmSetYm('${tmShiftYm(tmYm, n)}')" style="cursor:pointer;user-select:none;font-size:13px;padding:2px 10px;border:1px solid var(--border);border-radius:3px;background:var(--surface)">${t}</span>`;
  box.innerHTML = `
  <div class="page-header">
    <div class="section-title">面谈跟进 <span class="badge-count" id="tm_count"></span></div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px">
    ${arrow(-1, '‹')}<span style="font-size:13px;font-weight:600;min-width:92px;text-align:center">${tmYm.replace('-', '年')}月</span>${arrow(1, '›')}
    ${cur ? '' : `<span onclick="tmSetYm('${tmCurYm()}')" style="font-size:10px;color:var(--accent);cursor:pointer">回到本月</span>`}
    <span style="font-size:10px;color:var(--text-3)">每个学生每月至少一次面谈；没面谈的补「学习记录」或「联系未回复」</span>
    <button onclick="tmBatchReminder()" style="font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:4px 12px;cursor:pointer;font-family:inherit;margin-left:auto">✉ 按专业批量生成提醒</button>
    <button onclick="tmContactModal('')" style="font-size:10px;background:#1a6d3a;color:#fff;border:none;border-radius:2px;padding:4px 12px;cursor:pointer;font-family:inherit">＋ 补充记录</button>
  </div>
  <div id="tm_chips" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px"></div>
  <div id="tm_list"></div>`;
  tmRenderList();
}
function tmSetYm(ym) { tmYm = ym; tmShown0(); tmRenderShell(); }
function tmShown0() { tsmShown = TSM_PAGE; }
function tmSetGroup(g) { tmGroup = tmGroup === g ? '' : g; tmShown0(); tmRenderList(); }
function tmToggle(id) { tmExpandedId = tmExpandedId === id ? null : id; tmRenderList(); }

// 近 6 个月小方格（每月一格）
function tmCellsHtml(info) {
  const ym = tmYm || tmCurYm(), out = [];
  const sty = { mtg: ['✓', '#1a6d3a', '#e4f3ea', '面谈'], study: ['✎', '#1a6d3a', '#e4f3ea', '学习记录'], noreply: ['✉', '#b8560b', '#fbeee0', '联系未回复'], pend: ['⏳', '#8a6d10', '#fef5e0', '待面谈'] };
  for (let i = 5; i >= 0; i--) {
    const m = tmShiftYm(ym, -i), c = tmMonthState(info, m).cell, d = sty[c];
    out.push(`<span title="${m.replace('-', '年')}月：${d ? d[3] : '无面谈无记录'}" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:3px;font-size:10px;border:1px solid ${d ? d[1] : 'var(--border)'};background:${d ? d[2] : 'transparent'};color:${d ? d[1] : 'transparent'}">${d ? d[0] : '·'}</span>`);
  }
  return `<span style="display:inline-flex;gap:3px;align-items:center">${out.join('')}</span>`;
}
function tmStateTag(r) {
  const st = r.st, tag = (c, bg, t) => `<span style="font-size:10px;padding:1px 8px;border-radius:10px;background:${bg};color:${c};white-space:nowrap">${t}</span>`;
  if (st.group === 'done') return st.mtg.length ? tag('#1a6d3a', '#e4f3ea', `✓ 已面谈${st.mtg.length > 1 ? ' ' + st.mtg.length + ' 次' : ''}`) : tag('#1a6d3a', '#e4f3ea', '✎ 学习记录');
  if (st.group === 'pend') { const b = st.pend[0]; return tag('#8a6d10', '#fef5e0', `⏳ 待面谈 ${tsaEsc((b.slot_date || '').slice(5))} ${tsaEsc(b.slot_time_range || '')}`); }
  if (st.group === 'noreply') return r.streak >= 3 ? tag('#c0392b', '#fdecea', `⚠ 已连续 ${r.streak} 次未回复 → 已转重点关注`) : tag('#b8560b', '#fbeee0', `✉ 联系未回复 · 连续第 ${r.streak} 次`);
  return tag('#c0392b', '#fdecea', `⚠ ${tmMonthWord()}无面谈无记录`);
}

function tmRenderList() {
  const listBox = document.getElementById('tm_list'), chipBox = document.getElementById('tm_chips');
  if (!listBox || !tmData) return;
  const all = tmRows();
  const cnt = g => all.filter(r => r.st.group === g).length;
  const w = tmMonthWord();
  if (chipBox) chipBox.innerHTML = '<span style="font-size:10px;color:var(--text-3)">分组：</span>' + TM_GROUPS.map(([k, l]) => `<div class="filter-chip ${tmGroup === k ? 'active' : ''}" onclick="tmSetGroup('${k}')" style="padding:3px 10px;font-size:10px">${l.replace(/^(\S+) /, '$1 ' + w)} ${cnt(k)}</div>`).join('');
  const ord = { done: 0, pend: 1, noreply: 2, none: 3 };
  const list = all.filter(r => !tmGroup || r.st.group === tmGroup).sort((a, b) => (ord[a.st.group] - ord[b.st.group]) || (b.streak - a.streak) || a.s.name.localeCompare(b.s.name, 'zh'));
  const c0 = document.getElementById('tm_count'); if (c0) c0.textContent = list.length;
  if (!list.length) { listBox.innerHTML = '<div class="empty">没有符合筛选条件的学生</div>'; return; }
  let lastG = '';
  listBox.innerHTML = tsmSlice(list).map(r => {
    const s = r.s, open = tmExpandedId === s.id, lastM = r.info.recs[0] ? r.info.recs[0].slot_date : '';
    let head = '';
    if (!tmGroup && r.st.group !== lastG) { lastG = r.st.group; const t = TM_GROUPS.find(x => x[0] === lastG)[1].replace(/^(\S+) /, '$1 ' + w); head = `<div style="font-size:11px;font-weight:600;color:var(--text-2);margin:12px 0 6px">${t}（${cnt(lastG)}）</div>`; }
    return head + `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden;margin-bottom:6px">
      <div onclick="tmToggle('${s.id}')" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 14px;cursor:pointer;${open ? 'background:var(--bg)' : ''}">
        <span style="font-size:13px;font-weight:600">${tsaEsc(s.name)}</span>
        <span style="font-size:11px;color:var(--text-3)">${tsaEsc(MAJORS[s.major] || s.major || '')}</span>
        ${tmStateTag(r)}
        <span style="font-size:10px;color:var(--text-3);margin-left:auto">${lastM ? '最近面谈 ' + tsaEsc(lastM) : '从未面谈'}</span>
        ${tmCellsHtml(r.info)}
        <span style="font-size:10px;color:var(--text-3)">${open ? '▲' : '▼'}</span>
      </div>
      ${open ? tmDetailHtml(s, r.info) : ''}
    </div>`;
  }).join('') + tsmMoreHtml(list.length);
}

function tmDetailHtml(s, info) {
  const me = (typeof teacherData !== 'undefined' && teacherData && teacherData.name) || '';
  const sub = (title, inner, btn) => `<div style="margin-bottom:12px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:11px;font-weight:600;color:var(--text-2)">${title}</span>${btn || ''}</div>${inner}</div>`;
  const mtg = info.recs.length ? info.recs.map(b => `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px;margin-bottom:6px">
      <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">${tsaEsc(b.slot_date)}${b.slot_time_range ? ' ' + tsaEsc(b.slot_time_range) : ''}${b.actual_duration ? ' · ' + tsaEsc(b.actual_duration) + 'min' : ''}${b.assigned_teacher ? ' · ' + tsaEsc(b.assigned_teacher) + '老师' : ''}${b.type ? ' · ' + tsaEsc(typeLabel(b.type)) : ''}</div>
      <pre style="font-size:11px;line-height:1.8;white-space:pre-wrap;font-family:inherit;margin:0;color:var(--text-2)">${tsaEsc(buildRecordText(b))}</pre></div>`).join('')
    : '<div style="font-size:11px;color:var(--text-3)">还没有面谈记录</div>';
  const logs = info.logs.length ? info.logs.map(l => {
    const k = TM_KIND[tmLogKind(l)], mine = l.teacher_name === me;
    return `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid var(--border-light)">
      ${l.image_url ? `<img src="${tsaEsc(l.image_url)}" onclick="tmImgLightbox('${tsaEsc(l.image_url)}')" style="flex-shrink:0;width:52px;height:52px;object-fit:cover;border-radius:4px;border:1px solid var(--border);cursor:zoom-in">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;margin-bottom:2px"><span style="color:var(--text-3)">${tsaEsc(tmLogYm(l))}</span> <span style="color:${k.c};border:1px solid ${k.c};border-radius:2px;padding:0 5px">${k.ic} ${k.t}</span></div>
        <div style="font-size:11px;white-space:pre-wrap;line-height:1.5">${tsaEsc(l.note) || '（无内容）'}</div>
        <div style="font-size:9px;color:var(--text-3);margin-top:3px">${tsaEsc(l.teacher_name || '')} · ${tsaEsc(tmJstYmd(l.created_at))}</div>
      </div>
      ${mine ? `<span style="flex-shrink:0;font-size:9px;white-space:nowrap"><span onclick="tmFlipKind('${l.id}')" style="color:var(--accent);cursor:pointer">改为${tmLogKind(l) === 'study' ? '未回复' : '学习记录'}</span> <span onclick="tmDeleteContact('${l.id}')" style="color:var(--danger);cursor:pointer;margin-left:6px">删除</span></span>` : ''}
    </div>`;
  }).join('') : '<div style="font-size:11px;color:var(--text-3)">还没有学习记录 / 联系记录</div>';
  const from = (tmYm || tmCurYm()) + '-01';
  const pend = info.pend.filter(b => (b.slot_date || '') >= from);
  const pendHtml = pend.length ? pend.map(b => `<div style="font-size:11px;padding:4px 0;border-top:1px solid var(--border-light)">${tsaEsc(b.slot_date)} ${tsaEsc(b.slot_time_range || '')} · ${b.status === 'confirmed' ? '已确认' : '待确认'}${b.assigned_teacher ? ' · ' + tsaEsc(b.assigned_teacher) + '老师' : ''}</div>`).join('') : '<div style="font-size:11px;color:var(--text-3)">没有待进行的预约</div>';
  const add = `<button onclick="tmContactModal('${s.id}')" style="margin-left:auto;font-size:10px;background:#1a6d3a;color:#fff;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit">＋ 补充记录</button>`;
  return `<div style="border-top:1px solid var(--border-light);background:var(--bg);padding:10px 14px">
    ${sub(`面谈记录（${info.recs.length} 次）`, mtg)}
    ${sub(`学习记录 / 联系记录（${info.logs.length}）`, logs, add)}
    ${sub(`预约（${tmMonthWord() === '本月' ? '本月' : tmYm.replace('-', '年') + '月'}及以后）`, pendHtml)}
  </div>`;
}

// 批量提醒：当前筛选下「无面谈记录」的学生。两种模式（chip 切换）：
//   逐人（默认，含查询码）：每人一段文案 B，各自复制
//   按专业群发（不含查询码）：每个专业一段通用文字 —— 群发文字里绝不能带查询码
let tmBatchMode = 'each';
let tmBatchCache = null;   // 逐人模式生成的文字（避免切换模式时重复生成查询码）
async function tmBatchReminder() {
  const noRec = tmNoRecStudents();
  if (!noRec.length) { alert('当前筛选范围内没有「无面谈记录」的学生'); return; }
  tmBatchMode = 'each';
  tmBatchCache = null;
  studentTextModal('tmBatchModal', `✉ 批量面谈提醒（共 ${noRec.length} 人未面谈）`, '');
  await tmBatchRender(noRec);
}
async function tmBatchRender(noRec) {
  noRec = noRec || tmNoRecStudents();
  const body = document.getElementById('tmBatchModal_body');
  if (!body) return;
  const chip = (k, l) => `<div class="filter-chip ${tmBatchMode === k ? 'active' : ''}" onclick="tmBatchMode='${k}';tmBatchRender()" style="padding:3px 12px;font-size:11px;cursor:pointer">${l}</div>`;
  const head = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${chip('each', '逐人（含查询码）')}${chip('group', '按专业群发（不含查询码）')}</div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">${tmBatchMode === 'each' ? '每人一段，只含本人的查询码，请逐个私信发送；复制后会标「✓ 已复制」。' : '可以发到专业群里；群发文字不含查询码，登录查询码请另外私信学生。'}</div>`;
  if (tmBatchMode === 'group') {
    const byMajor = {};
    noRec.forEach(s => { const m = s.major || ''; (byMajor[m] = byMajor[m] || []).push(s.name); });
    const entries = Object.entries(byMajor).map(([m, names]) => ({
      name: `${MAJORS[m] || m || '未设专业'}（${names.length}人未面谈）`,
      sub: names.join('、'),
      text: `同学，你最近都一直没有预约面谈，学习上有什么问题吗？麻烦预约一下面谈噢。\n预约链接：${studentPortalLink(m)}\n登录查询码请查看老师私信，请妥善保存。`,
    }));
    body.innerHTML = head + studentTextBlocksHtml(entries, 'tmbg');
    return;
  }
  if (tmBatchCache) { body.innerHTML = head + studentTextBlocksHtml(tmBatchCache, 'tmbe'); return; }
  body.innerHTML = head + '<div id="tmBatchEach"></div>';
  const entries = await studentTextBatch(noRec, 'reminder', document.getElementById('tmBatchEach'), 'tmbe');
  tmBatchCache = entries;
  if (tmBatchMode !== 'each') return;   // 生成期间切到了群发模式
  body.innerHTML = head + studentTextBlocksHtml(entries, 'tmbe');
}

// 单人面谈提醒（文案 B，含本人查询码；没有查询码时先自动生成），弹窗显示并自动复制
async function tmGenReminder(id) {
  let st = ((tmData && tmData.students) || []).find(x => x.id === id);
  if (!st && id) st = ((await sb(`/rest/v1/students?id=eq.${encodeURIComponent(id)}&select=id,name,major,student_code`).catch(() => [])) || [])[0];
  if (!st) { alert('找不到该学生档案'); return; }
  const body = studentTextModal('tmReminderModal', `✉ 面谈提醒 · ${tsaEsc(st.name)}`, '<div style="font-size:12px;color:var(--text-3);padding:12px">正在准备…</div>');
  const had = !!st.student_code;
  const r = await ensureStudentCode(st);
  body.innerHTML = studentTextBlocksHtml([{ name: st.name, sub: (!had && r.code) ? '已自动生成查询码' : '', text: bookingReminderText(st.name, st.major, r.code), error: r.error }], 'tmr');
  if (!r.error) studentTextCopy('tmr', 0);
}

// ══ 志望校行内修改（老师端；与学生端同一张表即时同步） ══
async function tpPlanSet(planId, field, value, el) {
  try {
    await sb(`/rest/v1/student_school_plans?id=eq.${planId}`, 'PATCH', { [field]: value });
    Object.values(teacherProgressData.plansMap || {}).forEach(list => {
      const p = (list || []).find(x => x.id === planId);
      if (p) p[field] = value;
    });
    if (el && field === 'status') { const st = schoolStatusLabel(value); el.style.color = st.c; }
    if (el) { el.style.outline = '1px solid var(--ok)'; setTimeout(() => el.style.outline = '', 800); }
  } catch (e) { alert('保存失败：' + e.message); }
}

async function tpPlanFlag(planId, field, btn) {
  const next = btn.dataset.on !== '1';
  try {
    await sb(`/rest/v1/student_school_plans?id=eq.${planId}`, 'PATCH', { [field]: next });
    Object.values(teacherProgressData.plansMap || {}).forEach(list => {
      const p = (list || []).find(x => x.id === planId);
      if (p) p[field] = next;
    });
    btn.dataset.on = next ? '1' : '0';
    btn.textContent = next ? (field === 'kakomon_started' ? '✓ 已开始' : '✓ 已完成') : (field === 'kakomon_started' ? '未开始' : '未完成');
    btn.style.border = `1px solid ${next ? 'var(--ok)' : 'var(--border)'}`;
    btn.style.background = next ? 'var(--ok-bg)' : 'var(--bg)';
    btn.style.color = next ? 'var(--ok)' : 'var(--text-3)';
  } catch (e) { alert('保存失败：' + e.message); }
}

// ══ 老师评估记录（teacher_student_notes；学生端不读取此表） ══
const tpNotesCache = {};

async function tpNotesToggle(sid, sname, head) {
  const box = document.getElementById('pgcnotes_' + sid);
  if (!box) return;
  const open = box.style.display === 'none';
  box.style.display = open ? 'block' : 'none';
  const arr = head.querySelector('.arr');
  if (arr) arr.textContent = open ? '▾' : '▸';
  if (open) {
    if (!tpNotesCache[sid]) {
      box.innerHTML = '<div style="font-size:10px;color:var(--text-3)">加载中…</div>';
      try {
        tpNotesCache[sid] = await sb(`/rest/v1/teacher_student_notes?student_id=eq.${sid}&select=*&order=created_at.desc`);
      } catch (e) { box.innerHTML = `<div style="font-size:10px;color:var(--danger)">加载失败：${e.message}</div>`; return; }
    }
    tpNotesRender(sid, sname);
  }
}

function tpNotesRender(sid, sname) {
  const box = document.getElementById('pgcnotes_' + sid);
  if (!box) return;
  const notes = tpNotesCache[sid] || [];
  box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px">
    <textarea id="tpnote_input_${sid}" rows="2" placeholder="记录该学生的评估、注意事项、交接备注…（如：笔试水平待评估；临近出愿需主动跟进）" onclick="event.stopPropagation()"
      style="width:100%;font-size:11px;line-height:1.8;padding:7px 9px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical"></textarea>
    <button onclick="event.stopPropagation();tpNoteSave('${sid}','${tsaEsc(sname)}')" style="margin-top:5px;font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">保存记录</button>
    <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px">
      ${notes.length ? notes.map(n => `<div style="font-size:11px;border-top:1px dashed var(--border-light);padding-top:6px">
        <span style="color:var(--accent);font-weight:600">${tsaEsc(n.teacher_name)}</span>
        <span style="color:var(--text-3);font-size:9px;margin-left:6px">${(n.created_at || '').slice(0, 16).replace('T', ' ')}</span>
        ${n.teacher_name === teacherData.name ? `<span onclick="event.stopPropagation();tpNoteDel('${n.id}','${sid}','${tsaEsc(sname)}')" style="float:right;font-size:9px;color:var(--danger);cursor:pointer">删除</span>` : ''}
        <div style="color:var(--text-2);line-height:1.8;white-space:pre-wrap;margin-top:2px">${tsaEsc(n.content)}</div>
      </div>`).join('') : '<div style="font-size:10px;color:var(--text-3)">暂无记录</div>'}
    </div>
  </div>`;
}

async function tpNoteSave(sid, sname) {
  const ta = document.getElementById('tpnote_input_' + sid);
  const content = (ta ? ta.value : '').trim();
  if (!content) { alert('请填写记录内容'); return; }
  const row = { id: `tn-${Date.now()}-${Math.random().toString(36).slice(2,5)}`, student_id: sid, student_name: sname, teacher_name: teacherData.name, content };
  try {
    await sb('/rest/v1/teacher_student_notes', 'POST', row);
    row.created_at = new Date().toISOString();
    tpNotesCache[sid] = [row, ...(tpNotesCache[sid] || [])];
    tpNotesRender(sid, sname);
  } catch (e) { alert('保存失败：' + e.message); }
}

async function tpNoteDel(id, sid, sname) {
  if (!confirm('删除这条评估记录？')) return;
  try {
    await sb(`/rest/v1/teacher_student_notes?id=eq.${id}`, 'DELETE');
    tpNotesCache[sid] = (tpNotesCache[sid] || []).filter(n => n.id !== id);
    tpNotesRender(sid, sname);
  } catch (e) { alert('删除失败：' + e.message); }
}

// ══ 学生档案修改（需 admin 授予「档案修改」子项；修改留痕，admin 可恢复） ══
const TSE_FIELDS = [
  ['name','姓名','input'],['major','专业','major'],['level','等级','input'],
  ['japanese_score','日语成绩','input'],['english_score','英语成绩','input'],
  ['target_enrollment','目标入学','input'],['expiry_date','到期日(YYYY-MM-DD)','input'],
  ['status','状态','status'],['student_type','属性','input'],['source','来源','input'],
  ['course_type','课程属性','input'],['university','出身大学','input'],['faculty','学部/专业','input'],
  ['gpa','GPA/履历','input'],['thesis','毕业论文','input'],['graduation_date','毕业时间','input'],
  ['japan_arrival','赴日时间','input'],['signup_date','报名时间','input'],
];

function tseOpen(sid) {
  const s = tsaStudents.find(x => x.id === sid);
  if (!s) return;
  const existing = document.getElementById('tseModal');
  if (existing) existing.remove();
  const inp = 'width:100%;font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const ctrl = (k, type, v) => {
    if (type === 'major') return `<select id="tse_${k}" style="${inp}">${tsaMajorOptions(v)}</select>`;
    if (type === 'status') return `<select id="tse_${k}" style="${inp}">${[['active','在籍'],['graduated','已合格'],['expired','已到期'],['stopped','停课'],['withdrawn','退学']].map(([kk,vv])=>`<option value="${kk}" ${v===kk?'selected':''}>${vv}</option>`).join('')}</select>`;
    return `<input id="tse_${k}" value="${tsaEsc(v)}" style="${inp}">`;
  };
  const modal = document.createElement('div');
  modal.id = 'tseModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:640px;width:100%;max-height:88vh;overflow-y:auto">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">✏ 修改学生档案 — ${tsaEsc(s.name)}</div>
    <div style="font-size:10px;color:var(--warn,#b8860b);margin-bottom:12px">⚠ 修改将直接覆盖 admin 学生档案的数据，并留下修改记录（admin 可查看与恢复），请谨慎操作。</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:12px">
      ${TSE_FIELDS.map(([k,l,t]) => `<div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">${l}</label>${ctrl(k, t, s[k])}</div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('tseModal').remove()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 16px;cursor:pointer;font-family:inherit">取消</button>
      <button onclick="tseSave('${sid}')" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 20px;cursor:pointer;font-family:inherit">保存修改</button>
    </div>
  </div>`;
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
}

async function tseSave(sid) {
  const s = tsaStudents.find(x => x.id === sid);
  if (!s) return;
  const patch = {}, changes = {}, prev = {};
  TSE_FIELDS.forEach(([k]) => {
    const v = ((document.getElementById('tse_' + k) || {}).value || '').trim();
    const old = s[k] == null ? '' : String(s[k]);
    if (v !== old) { patch[k] = v; changes[k] = { from: old, to: v }; prev[k] = s[k]; }
  });
  if (!Object.keys(patch).length) { alert('没有任何修改'); return; }
  if (!confirm(`该修改将覆盖学生档案的数据（共 ${Object.keys(patch).length} 项变更），是否操作？`)) return;
  try {
    await sb(`/rest/v1/students?id=eq.${sid}`, 'PATCH', patch);
    await sb('/rest/v1/student_profile_edits', 'POST', {
      id: `spe-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      student_id: sid, student_name: s.name, teacher_name: teacherData.name,
      changes, prev,
    }).catch(() => {});
    Object.assign(s, patch);
    document.getElementById('tseModal')?.remove();
    tsaRender();
    alert('已保存，修改记录已同步给 admin');
  } catch (e) { alert('保存失败：' + e.message); }
}


// ── 老师端：考学进度里的志望校（添加 / 编辑 / 删除；表单与学生端共用 shared/schoolplan.js）──
function tpStudentOf(sid) { return ((teacherProgressData && teacherProgressData.students) || []).find(x => x.id === sid) || null; }
function tpPlanOf(planId) {
  let hit = null;
  Object.values((teacherProgressData && teacherProgressData.plansMap) || {}).forEach(list => { list.forEach(p => { if (p.id === planId) hit = p; }); });
  return hit;
}
function tpOperatorName() { return (typeof teacherData !== 'undefined' && teacherData && teacherData.name) || (typeof teacherName !== 'undefined' ? teacherName : '') || '老师'; }
// 保存 / 删除后只重读这个学生的志望校和时间线，重绘列表并保持卡片展开
async function tpReloadStudentPlans(sid) {
  const [plans, tl] = await Promise.all([
    sb(`/rest/v1/student_school_plans?student_id=eq.${encodeURIComponent(sid)}&select=*&order=level.asc`).catch(() => null),
    sb(`/rest/v1/student_progress_timeline?student_id=eq.${encodeURIComponent(sid)}&select=*&order=created_at.asc`).catch(() => null),
  ]);
  if (plans) teacherProgressData.plansMap[sid] = plans;
  if (tl) teacherProgressData.timelineMap[sid] = tl;
  tpRenderProgressList();
  const el = document.getElementById(`pgc_${sid}`);
  if (el && el.style.display === 'none') pgcToggle(sid);
}
function tpAddSchool(sid) {
  const stu = tpStudentOf(sid); if (!stu) return;
  spOpenModal({ student: stu, plans: teacherProgressData.plansMap[sid] || [], onDone: () => tpReloadStudentPlans(sid) });
}
function tpEditSchool(planId) {
  const plan = tpPlanOf(planId), stu = plan && tpStudentOf(plan.student_id);
  if (!plan || !stu) return;
  spOpenModal({ student: stu, plan, plans: teacherProgressData.plansMap[stu.id] || [], onDone: () => tpReloadStudentPlans(stu.id) });
}
function tpDelSchool(planId) {
  const plan = tpPlanOf(planId), stu = plan && tpStudentOf(plan.student_id);
  if (!plan || !stu) return;
  spDeletePlan(stu, plan, 'teacher', tpOperatorName(), () => tpReloadStudentPlans(stu.id));
}


// ── 补充记录（学习记录 / 联系未回复；备注 + 可选截图，支持 Ctrl+V 粘贴）──
let tmPendingImg = null; // 待上传的截图（已压缩）

async function tmCompressImg(file, maxSide, quality) {
  if (!/^image\//.test(file.type)) return file;
  if (file.size <= 300 * 1024) return file;
  try {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { bmp = await createImageBitmap(file); }
    const scale = Math.min(1, (maxSide || 1400) / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality || 0.8));
    if (!blob) return file;
    return new File([blob], 'shot.jpg', { type: 'image/jpeg' });
  } catch (e) { return file; }
}

// 补充记录弹窗：选学生（姓名搜索 / 先选专业再点名字）→ 类型 → 算哪个月 → 内容 → 截图
let tmAdd = null;   // { sid, fixed, kind, major }
function tmContactModal(sid) {
  if (!tmData) return;
  tmPendingImg = null;
  tmAdd = { sid: sid || '', fixed: !!sid, kind: 'study', major: '' };
  const ex = document.getElementById('tmContactModal'); if (ex) ex.remove();
  const m = document.createElement('div');
  m.id = 'tmContactModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:18px;max-width:460px;width:100%;max-height:90vh;overflow-y:auto">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">＋ 补充记录</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:12px">没有面谈的学生，记录联系情况：学生回复了记「学习记录」（算该月完成）；没回复记「联系未回复」（继续跟进，连续 3 次转重点关注）。</div>
      <div class="form-group"><label class="form-label">学生</label><div id="tma_stu"></div></div>
      <div class="form-group"><label class="form-label">类型</label><div id="tma_kind" style="display:flex;gap:6px;flex-wrap:wrap"></div></div>
      <div class="form-group"><label class="form-label">算哪个月</label>
        <input type="month" id="tma_ym" value="${tsaEsc(tmYm || tmCurYm())}" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit"></div>
      <div class="form-group"><label class="form-label" id="tma_note_lb">内容</label>
        <textarea id="tm_contact_note" rows="4" onpaste="tmHandlePaste(event)" style="width:100%;font-size:12px"></textarea></div>
      <div class="form-group">
        <label class="form-label">截图（可选，Ctrl+V 粘贴或选择文件）</label>
        <input type="file" id="tm_contact_file" accept="image/*" onchange="tmPickFile(event)" style="font-size:11px">
        <div id="tm_contact_preview" style="margin-top:8px"></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
        <button onclick="document.getElementById('tmContactModal').remove()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">取消</button>
        <button id="tm_contact_save" onclick="tmSaveContact()" style="font-size:12px;background:#1a6d3a;color:#fff;border:none;border-radius:3px;padding:7px 16px;cursor:pointer;font-family:inherit;font-weight:500">保存</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  tmAddRender();
}
function tmAddRender() {
  const stu = document.getElementById('tma_stu'); if (!stu || !tmAdd) return;
  const inp = 'font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit';
  const s = tmAdd.sid && (tmData.students || []).find(x => x.id === tmAdd.sid);
  if (s) {
    stu.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;font-size:12px;padding:4px 10px;border-radius:12px;background:var(--accent);color:#fff">${tsaEsc(s.name)} · ${tsaEsc(MAJORS[s.major] || s.major || '')}${tmAdd.fixed ? '' : ` <span onclick="tmAdd.sid='';tmAddRender()" style="cursor:pointer">✕</span>`}</span>`;
  } else {
    const majors = [...new Set((tmData.students || []).map(x => x.major).filter(Boolean))];
    stu.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
        <input id="tma_q" placeholder="输入姓名（汉字 / 拼音首字母）" oninput="searchBox(this,tmAddSearch)" style="${inp};flex:1;min-width:150px">
        <select id="tma_major" onchange="tmAdd.major=this.value;tmAddSearch()" style="${inp}"><option value="">先选专业…</option>${majors.map(k => `<option value="${tsaEsc(k)}" ${tmAdd.major === k ? 'selected' : ''}>${tsaEsc(MAJORS[k] || k)}</option>`).join('')}</select>
      </div><div id="tma_res"></div>`;
    tmAddSearch();
  }
  const kb = document.getElementById('tma_kind');
  if (kb) kb.innerHTML = Object.entries({ study: '学习记录（学生回复了）', no_reply: '联系未回复' }).map(([k, l]) => `<div class="filter-chip ${tmAdd.kind === k ? 'active' : ''}" onclick="tmAdd.kind='${k}';tmAddRender()" style="padding:4px 12px;font-size:11px">${l}</div>`).join('');
  const lb = document.getElementById('tma_note_lb');
  if (lb) lb.textContent = tmAdd.kind === 'study' ? '内容（必填：学习进度、近况）' : '内容（可选：联系方式、时间）';
}
function tmAddSearch() {
  const box = document.getElementById('tma_res'); if (!box || !tmAdd) return;
  const q = ((document.getElementById('tma_q') || {}).value || '').trim();
  if (!q && !tmAdd.major) { box.innerHTML = '<div style="font-size:10px;color:var(--text-3)">输入姓名搜索，或先选专业再点名字</div>'; return; }
  const list = (tmData.students || []).filter(s => (!tmAdd.major || s.major === tmAdd.major) && (!q || searchMatch(q, studentSearchFields(s)))).slice(0, 40);
  box.innerHTML = list.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px;max-height:130px;overflow-y:auto">${list.map(s => `<div class="filter-chip" onclick="tmAdd.sid='${s.id}';tmAddRender()" style="padding:3px 10px;font-size:11px">${tsaEsc(s.name)}</div>`).join('')}</div>` : '<div style="font-size:10px;color:var(--text-3)">范围内没有匹配的学生</div>';
}

async function tmHandlePaste(e) {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.type && it.type.indexOf('image') === 0) {
      e.preventDefault();
      const f = it.getAsFile();
      if (f) await tmSetImg(f);
      return;
    }
  }
}
async function tmPickFile(e) {
  const f = e.target.files && e.target.files[0];
  if (f) await tmSetImg(f);
}
async function tmSetImg(file) {
  tmPendingImg = await tmCompressImg(file);
  const prev = document.getElementById('tm_contact_preview');
  if (prev) {
    const url = URL.createObjectURL(tmPendingImg);
    prev.innerHTML = `<div style="display:inline-flex;align-items:center;gap:8px"><img src="${url}" style="max-width:160px;max-height:120px;border-radius:4px;border:1px solid var(--border)"><span onclick="tmPendingImg=null;document.getElementById('tm_contact_preview').innerHTML='';document.getElementById('tm_contact_file').value=''" style="font-size:10px;color:var(--danger);cursor:pointer">移除</span></div>`;
  }
}

async function tmSaveContact() {
  const s = tmAdd && (tmData.students || []).find(x => x.id === tmAdd.sid);
  if (!s) { alert('请先选择学生'); return; }
  const note = (document.getElementById('tm_contact_note').value || '').trim();
  const ym = (document.getElementById('tma_ym').value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) { alert('请选择算哪个月'); return; }
  if (tmAdd.kind === 'study' && !note) { alert('学习记录请填写内容（学习进度、近况）'); return; }
  const btn = document.getElementById('tm_contact_save');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  let imageUrl = '';
  try {
    if (tmPendingImg) imageUrl = await sbUpload('teacher-files', `contact/${s.id}-${Date.now()}.jpg`, tmPendingImg);
    await sb('/rest/v1/student_contact_logs', 'POST', [{
      id: 'sclog-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      student_id: s.id, student_name: s.name, major: s.major || '',
      teacher_name: (typeof teacherData !== 'undefined' && teacherData ? teacherData.name : '') || '',
      note, image_url: imageUrl || null, kind: tmAdd.kind, for_month: ym,
    }]);
    document.getElementById('tmContactModal')?.remove();
    tmYm = ym;   // 跳到刚记录的那个月，立刻能看到它出现在哪一组
    renderTsaMeetings(document.getElementById('sm_content') || document.getElementById('mainContent'));
  } catch (e) {
    alert('保存失败：' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}

function tmFindLog(id) {
  let hit = null;
  [tmData.logs.id, tmData.logs.nm].forEach(ix => Object.values(ix).forEach(arr => arr.forEach(l => { if (l.id === id) hit = l; })));
  return hit;
}
async function tmFlipKind(id) {
  const l = tmFindLog(id); if (!l) return;
  const next = tmLogKind(l) === 'study' ? 'no_reply' : 'study';
  try {
    await sb(`/rest/v1/student_contact_logs?id=eq.${encodeURIComponent(id)}`, 'PATCH', { kind: next });
    l.kind = next; tmData.cache = {};
    tmRenderList();
  } catch (e) { alert('修改失败：' + e.message); }
}

async function tmDeleteContact(id) {
  if (!confirm('确认删除这条记录？')) return;
  try {
    await sb(`/rest/v1/student_contact_logs?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    renderTsaMeetings(document.getElementById('sm_content') || document.getElementById('mainContent'));
  } catch (e) { alert('删除失败：' + e.message); }
}

// 页面内查看截图大图（点任意处或×关闭，不再开新标签页）
function tmImgLightbox(url) {
  const ex = document.getElementById('tmLightbox'); if (ex) ex.remove();
  const o = document.createElement('div');
  o.id = 'tmLightbox';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';
  o.onclick = () => o.remove();
  o.innerHTML = `<img src="${url}" style="max-width:92vw;max-height:88vh;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,.5)"><div style="position:absolute;top:14px;right:22px;color:#fff;font-size:30px;line-height:1;cursor:pointer">×</div>`;
  document.body.appendChild(o);
}


// ══════════════════════════════════════════════════════════
// 重点关注：按到期临近筛选 + 学生学习概要汇总（换一种展示方式）
// ══════════════════════════════════════════════════════════
let focusStudents = [];
let focusUrgency = 'all';   // all | half | q3 | near | expired

function focusParseDate(str) {
  if (!str) return null;
  const s = String(str).replace(/\s/g, '');
  let m = s.match(/(\d{4}|\d{2})[年\/\-\.](\d{1,2})/);
  if (m) { let y = parseInt(m[1]); if (y < 100) y += 2000; return new Date(y, parseInt(m[2]) - 1, 1); }
  m = s.match(/(20\d{2})/);
  if (m) return new Date(parseInt(m[1]), 3, 1);   // 只有年份→默认4月入学
  return null;
}
function focusMonthsUntil(str) {
  const d = focusParseDate(str); if (!d) return null;
  const now = new Date();
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
}
function focusBucket(months) {
  if (months == null) return null;
  if (months < 0) return 'expired';
  if (months <= 1) return 'near';
  if (months <= 3) return 'q3';
  if (months <= 6) return 'half';
  return 'far';
}
const FOCUS_URG = {
  expired: { t: '已过期', bg: '#fdecea', c: '#c0392b' },
  near: { t: '到期临近', bg: '#fbeee0', c: '#b8560b' },
  q3: { t: '三个月内', bg: '#fef5e0', c: '#8a6d10' },
  half: { t: '半年内', bg: '#eef5ea', c: '#4a7a2a' },
  far: { t: '远期', bg: '#eef1f5', c: '#5a6a7a' },
};

async function renderTeacherFocus(box) {
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const all = await sb('/rest/v1/students?select=*&order=created_at.desc&limit=2000').catch(() => []);
    let list = tsaFilterStudents(all);   // 全部状态；由全局「状态」筛选
    if (tsaGuaranteedLock()) list = list.filter(tsaIsGuaranteed);
    focusStudents = list;
    focusRender();
  } catch (e) {
    box.innerHTML = `<div class="empty" style="color:var(--danger)">重点关注加载失败：${(e && e.message) || e}</div>`;
    console.error('renderTeacherFocus error:', e);
  }
}

function focusRender() {
  const box = document.getElementById('sm_content') || document.getElementById('mainContent');
  if (!box) return;
  try {
  const rows = tsmFilterStudents(focusStudents).map(s => { const months = focusMonthsUntil(s.expiry_date); return { s, months, bucket: focusBucket(months) }; });
  let filtered = rows.filter(r => {
    if (focusUrgency === 'all') return true;
    if (focusUrgency === 'expired') return r.bucket === 'expired';
    if (focusUrgency === 'near') return ['near', 'expired'].includes(r.bucket);
    if (focusUrgency === 'q3') return ['near', 'q3', 'expired'].includes(r.bucket);
    if (focusUrgency === 'half') return ['near', 'q3', 'half', 'expired'].includes(r.bucket);
    return true;
  });
  const ord = { expired: 0, near: 1, q3: 2, half: 3, far: 4 };
  filtered.sort((a, b) => ((ord[a.bucket] ?? 5) - (ord[b.bucket] ?? 5)) || ((a.months ?? 9999) - (b.months ?? 9999)));

  const chip = (k, l) => `<div class="filter-chip ${focusUrgency === k ? 'active' : ''}" onclick="focusUrgency='${k}';focusRender()" style="padding:3px 10px;font-size:10px;cursor:pointer">${l}</div>`;
  const cards = filtered.length ? tsmSlice(filtered).map(r => {
    const u = r.bucket ? FOCUS_URG[r.bucket] : null;
    const badge = u ? `<span style="font-size:10px;padding:1px 8px;border-radius:10px;background:${u.bg};color:${u.c};white-space:nowrap">${u.t}${r.months != null && r.months >= 0 ? '·' + r.months + '个月' : (r.months != null ? '·超' + (-r.months) + '月' : '')}</span>` : '<span style="font-size:10px;color:var(--text-3)">无到期时间</span>';
    return `<div onclick="focusOpenSummary('${r.s.id}')" style="cursor:pointer;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:10px 14px;margin-bottom:7px" onmouseover="this.style.borderColor='var(--text-2)'" onmouseout="this.style.borderColor='var(--border)'">
      <span style="font-size:13px;font-weight:600">${tsaEsc(r.s.name)}</span>
      <span style="font-size:11px;color:var(--text-3)">${MAJORS[r.s.major] || r.s.major || ''}</span>
      ${badge}
      <span style="font-size:10px;color:var(--text-3)">到期 ${tsaEsc(r.s.expiry_date) || '—'}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--accent)">查看概要 ›</span>
    </div>`;
  }).join('') + tsmMoreHtml(filtered.length) : '<div class="empty">当前筛选下没有学生</div>';

  box.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      ${chip('all', '全部')}${chip('half', '半年内')}${chip('q3', '三个月内')}${chip('near', '临近')}${chip('expired', '已过期')}
    </div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:8px">共 ${filtered.length} 人 · 点学生查看完整学习概要（可打印）。到期依据「到期时间」自动推算。</div>
    <div>${cards}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="empty" style="color:var(--danger)">重点关注渲染失败：${(e && e.message) || e}</div>`;
    console.error('focusRender error:', e);
  }
}

async function focusOpenSummary(sid) {
  const s = focusStudents.find(x => x.id === sid);
  if (!s) return;
  if (!document.getElementById('focusPrintStyle')) {
    const st = document.createElement('style');
    st.id = 'focusPrintStyle';
    st.textContent = '@media print{body>*:not(#focusSummary){display:none!important}#focusSummary{position:static!important;background:#fff!important;padding:0!important;overflow:visible!important;display:block!important}#focusSummary .focus-noprint{display:none!important}#focusReport{box-shadow:none!important;max-width:none!important;padding:0!important}}';
    document.head.appendChild(st);
  }
  const ex = document.getElementById('focusSummary'); if (ex) ex.remove();
  const o = document.createElement('div');
  o.id = 'focusSummary';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto';
  o.innerHTML = '<div style="background:#fff;border-radius:8px;max-width:820px;width:100%;padding:28px;margin:auto"><div style="text-align:center;color:#888;padding:30px">加载概要中…</div></div>';
  document.body.appendChild(o);

  const enc = encodeURIComponent;
  const [timeline, plans, bks, contacts] = await Promise.all([
    sb(`/rest/v1/student_progress_timeline?student_id=eq.${sid}&select=*&order=created_at.asc`).catch(() => []),
    sb(`/rest/v1/student_school_plans?student_id=eq.${sid}&select=*&order=level.asc`).catch(() => []),
    sb(`/rest/v1/bookings?name=eq.${enc(s.name)}&daily_record=not.is.null&select=slot_date,daily_record,teacher_name&order=slot_date.desc&limit=200`).catch(() => []),
    sb(`/rest/v1/student_contact_logs?student_name=eq.${enc(s.name)}&select=*&order=created_at.desc`).catch(() => []),
  ]);

  try {
  const months = focusMonthsUntil(s.expiry_date);
  const u = focusBucket(months) ? FOCUS_URG[focusBucket(months)] : null;
  const kv = (k, v) => v ? `<div style="font-size:12px;padding:3px 0"><span style="color:#888;display:inline-block;width:78px">${k}</span>${tsaEsc(v)}</div>` : '';

  // 志望校
  const schoolsHtml = plans.length ? plans.map(p => {
    const st = (typeof SCHOOL_STATUS_LABELS !== 'undefined' && SCHOOL_STATUS_LABELS[p.status]) ? SCHOOL_STATUS_LABELS[p.status].t : (p.status || '');
    return `<div style="font-size:12px;padding:5px 0;border-top:1px solid #eee"><span style="font-weight:600">${tsaEsc(p.school_name)}</span>${p.faculty ? ' · ' + tsaEsc(p.faculty) : ''}${p.professor ? ' · ' + tsaEsc(p.professor) : ''} ${schoolLevelHtml(p.level)} <span style="color:#2a6a9a">${st}</span>${p.application_period ? ' <span style="color:#888;font-size:11px">出愿 ' + tsaEsc(p.application_period) + '</span>' : ''}</div>`;
  }).join('') : '<div style="font-size:11px;color:#aaa">暂无志望校</div>';

  // 考学进度时间线
  const tlHtml = timeline.length ? timeline.map(t => {
    const d = (t.created_at || '').slice(0, 10);
    const bits = Object.entries(t).filter(([k, v]) => !['id', 'student_id', 'student_name', 'created_at', 'updated_at', 'major'].includes(k) && v && typeof v === 'string').map(([k, v]) => `${tsaEsc(v)}`);
    const note = t.note || t.summary || bits.join(' / ');
    return `<div style="font-size:12px;padding:5px 0;border-top:1px solid #eee"><span style="color:#2a6a9a;font-family:monospace">${d}</span> ${tsaEsc(note) || '（进度更新）'}</div>`;
  }).join('') : '<div style="font-size:11px;color:#aaa">暂无进度记录</div>';

  // 面谈记录
  const mtgHtml = bks.length ? bks.map(b => {
    let txt = '';
    const dr = b.daily_record;
    if (dr && typeof dr === 'object') txt = Object.values(dr).filter(v => typeof v === 'string' && v.trim()).join(' / ');
    return `<div style="font-size:12px;padding:5px 0;border-top:1px solid #eee"><span style="color:#2a6a9a;font-family:monospace">${b.slot_date || ''}</span> ${b.teacher_name ? '<span style="color:#888">' + tsaEsc(b.teacher_name) + '</span> ' : ''}${tsaEsc(txt.slice(0, 200))}</div>`;
  }).join('') : '<div style="font-size:11px;color:#aaa">暂无面谈记录</div>';

  // 联系记录
  const contactHtml = contacts.length ? contacts.map(c => `<div style="font-size:12px;padding:5px 0;border-top:1px solid #eee"><span style="color:#2a6a9a;font-family:monospace">${(c.created_at || '').slice(0, 10)}</span> ${tsaEsc(c.note) || ''}${c.image_url ? ' <span style="color:#1a6d3a">[有截图]</span>' : ''}</div>`).join('') : '';

  const sec = (title, html) => `<div style="margin-top:18px"><div style="font-size:12px;font-weight:600;color:#1a3a5a;border-bottom:2px solid #dbe4ec;padding-bottom:4px;margin-bottom:6px">${title}</div>${html}</div>`;

  o.innerHTML = `
  <div id="focusReport" style="background:#fff;border-radius:8px;max-width:820px;width:100%;padding:28px;margin:auto">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:2px solid #1a3a5a;padding-bottom:12px">
      <div>
        <div style="font-family:'Noto Serif SC',serif;font-size:20px;font-weight:600">${tsaEsc(s.name)}<span style="font-size:13px;color:#888;font-weight:400;margin-left:10px">${MAJORS[s.major] || s.major || ''}</span></div>
        <div style="font-size:12px;color:#666;margin-top:3px">到期 ${tsaEsc(s.expiry_date) || '—'}${s.target_enrollment?' · 入学目标 '+tsaEsc(s.target_enrollment):''} ${u ? `<span style="padding:1px 8px;border-radius:10px;background:${u.bg};color:${u.c};margin-left:6px">${u.t}${months != null && months >= 0 ? '·还有' + months + '个月' : ''}</span>` : ''}</div>
      </div>
      <div style="display:flex;gap:8px" class="focus-noprint">
        <button onclick="window.print()" style="font-size:12px;background:#1a3a5a;color:#fff;border:none;border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">🖨 打印 / 存PDF</button>
        <button onclick="document.getElementById('focusSummary').remove()" style="font-size:12px;background:none;border:1px solid #ccc;border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">关闭</button>
      </div>
    </div>

    ${sec('基本信息', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px">
      ${kv('等级', ({1:'冲刺',2:'匹配',3:'保底'}[s.level] || s.level || ''))}${kv('属性', s.course_type)}
      ${kv('出身大学', s.university)}${kv('GPA', s.gpa)}
      ${kv('毕业时间', s.graduation_date)}${kv('期待入学', s.target_enrollment)}
      ${kv('赴日', s.japan_arrival)}${kv('来源', s.source)}
      ${kv('VIP课时', s.vip_hours_total ? (s.vip_hours_used || 0) + '/' + s.vip_hours_total : '')}${kv('研究方向', s.thesis)}
    </div>`)}

    ${sec('语言成绩', `<div style="display:flex;gap:24px;font-size:13px"><div><span style="color:#888">日语　</span>${tsaEsc(s.japanese_score) || '—'}</div><div><span style="color:#888">英语　</span>${tsaEsc(s.english_score) || '—'}</div></div>`)}

    ${sec('志望校', schoolsHtml)}
    ${sec('考学进度时间线', tlHtml)}
    ${sec('面谈记录（' + bks.length + '次）', mtgHtml)}
    ${contacts.length ? sec('联系确认记录', contactHtml) : ''}

    <div style="margin-top:20px;font-size:10px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:8px">唯新教育 · 学生学习概要 · 生成于 ${new Date().toLocaleDateString('zh-CN')}</div>
  </div>`;
  } catch (e) {
    o.innerHTML = `<div style="background:#fff;border-radius:8px;max-width:520px;width:100%;padding:24px;margin:auto"><div style="color:#b03a2e;font-size:13px;margin-bottom:12px">概要生成失败：${(e && e.message) || e}</div><button onclick="document.getElementById('focusSummary').remove()" style="font-size:12px;border:1px solid #ccc;background:none;border-radius:4px;padding:6px 16px;cursor:pointer">关闭</button></div>`;
    console.error('focusOpenSummary error:', e);
  }
}
