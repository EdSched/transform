// ══════════════════════════════════
// 出願数据库：检查重复 + 合并（只有管理员能用）
// 重复 = 专业/大学/研究科/専攻/コース/出願類型/出願期間 这 7 项去掉所有空格、NFKC 统一后完全一样（adgKeyNorm）
// 合并 = 保留一行（默认填得最全的），空字段用其他行补；teacher_school_shares.school_ids 里被删行的 id 换成保留行的 id；再删其他行
// ══════════════════════════════════

const ADUP_KEY_FIELDS = ['major', 'university', 'faculty', 'department', 'course', 'admission_type', 'application_period'];
const ADUP_SKIP_FIELDS = ['id', 'created_at', 'updated_at'];
const ADUP_LABEL = {
  major: '专业', university: '大学', faculty: '研究科', department: '専攻', course: 'コース', admission_type: '出願類型',
  application_period: '出願期間', type: '設置主体', doc_review_period: '資格審査', written_exam: '筆記試験', oral_exam: '口述試験',
  result_date: '合格発表', english_required: '英語成績', japanese_required: '日本語成績', english_tests: '英語成績明細',
  japanese_tests: '日本語成績明細', recommendation: '推薦状', thesis: '卒業論文', other_docs: 'その他書類', exam_style: '試験方式',
  notes: '備考', guideline_url: '募集要項', past_exam_url: '過去問', staff_url: '教员链接', ere_available: 'ERE可代替笔试',
};

let adupState = null;   // { groups:[{key, rows, keepId}], shown, busy, result }

function adupEmpty(v) {
  if (v == null) return true;
  if (typeof v === 'object') return !Object.keys(v).length;
  return String(v).trim() === '';
}
function adupSame(a, b) {
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a || null) === JSON.stringify(b || null);
  return adgKeyNorm(a) === adgKeyNorm(b);
}
function adupFields(rows) {
  const set = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => { if (!ADUP_SKIP_FIELDS.includes(k)) set.add(k); }));
  return [...set];
}
function adupScore(r) {
  let n = 0;
  Object.keys(r).forEach(k => { if (!ADUP_SKIP_FIELDS.includes(k) && !adupEmpty(r[k])) n++; });
  if (!adupEmpty(r.english_tests)) n += 100;
  if (!adupEmpty(r.japanese_tests)) n += 100;
  return n;
}
function adupShow(f, v) {
  if (adupEmpty(v)) return '';
  if (f === 'english_tests') return adgTestsText({ english_tests: v }, 'en') || JSON.stringify(v);
  if (f === 'japanese_tests') return adgTestsText({ japanese_tests: v }, 'jp') || JSON.stringify(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// 合并预览：保留行为主，空字段用其他行（按填得全的优先）补；两边都有值但不一样 = 冲突（用保留行的）
function adupMerge(g) {
  const keep = g.rows.find(r => String(r.id) === String(g.keepId));
  const others = g.rows.filter(r => r !== keep).sort((a, b) => adupScore(b) - adupScore(a));
  const patch = {}, conflicts = [], merged = {};
  adupFields(g.rows).forEach(f => {
    let val = keep[f];
    if (adupEmpty(val)) {
      const o = others.find(r => !adupEmpty(r[f]));
      if (o) { val = o[f]; patch[f] = o[f]; }
    } else if (others.some(r => !adupEmpty(r[f]) && !adupSame(r[f], keep[f]))) {
      conflicts.push(f);
    }
    merged[f] = val;
  });
  return { keep, others, patch, conflicts, merged };
}

async function adupLoad() {
  const box = document.getElementById('adupBody');
  box.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-3)">加载全部出愿数据…</div>';
  try {
    const rows = await sbAll('/rest/v1/admission_schools?select=*&order=id.asc');
    const map = new Map();
    rows.forEach(r => {
      const k = ADUP_KEY_FIELDS.map(f => adgKeyNorm(r[f])).join('\u0001');
      (map.get(k) || map.set(k, []).get(k)).push(r);
    });
    const groups = [];
    map.forEach((list, key) => {
      if (list.length < 2) return;
      const best = list.slice().sort((a, b) => adupScore(b) - adupScore(a))[0];
      groups.push({ key, rows: list, keepId: best.id });
    });
    groups.sort((a, b) => String(a.rows[0].university || '').localeCompare(String(b.rows[0].university || ''), 'ja'));
    adupState = { groups, shown: LIST_PAGE, busy: false, result: null, total: rows.length };
    adupRender();
  } catch (e) {
    box.innerHTML = `<div style="color:var(--danger);padding:16px">加载失败：${adgEsc(e.message)}</div>`;
  }
}

function openAdmissionDup() {
  if (!adbIsAdmin()) { alert('只有管理员可以使用'); return; }
  let m = document.getElementById('admissionDupModal');
  if (m) m.remove();
  m = document.createElement('div');
  m.id = 'admissionDupModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = `<div class="modal" style="width:1000px;max-width:100%;max-height:none">
    <div class="modal-title">检查重复</div>
    <div style="font-size:11px;color:var(--text-2);margin-bottom:10px;line-height:1.8">
      专业、大学、研究科、専攻、コース、出願類型、出願期間 去掉所有空格（全角、半角）并统一全角半角后完全一样，就算重复。合并前请先备份。
    </div>
    <div id="adupBody"></div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeAdmissionDup()">关闭</button></div>
  </div>`;
  document.body.appendChild(m);
  adupLoad();
}
function closeAdmissionDup() {
  const m = document.getElementById('admissionDupModal');
  if (m) m.remove();
  adupState = null;
}

function adupGroupHtml(g, gi) {
  const mg = adupMerge(g);
  const fields = adupFields(g.rows).filter(f => g.rows.some(r => !adupEmpty(r[f])));
  const diff = f => {
    const vals = g.rows.map(r => r[f]);
    return vals.some(v => !adupSame(v, vals[0]));
  };
  const h = g.rows[0];
  const th = g.rows.map(r => {
    const on = String(r.id) === String(g.keepId);
    return `<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--border);min-width:130px">
      <span class="adg-selbtn${on ? ' on' : ''}" style="cursor:pointer" onclick="adupSetKeep(${gi},'${adgJs(r.id)}')">${on ? '保留此行' : '改为保留'}</span></th>`;
  }).join('');
  const body = fields.map(f => {
    const d = diff(f), c = mg.conflicts.includes(f);
    const cells = g.rows.map(r => `<td style="padding:3px 6px;border-bottom:1px solid var(--border-light);vertical-align:top;${d ? 'background:#fff6cc;' : ''}${String(r.id) === String(g.keepId) ? 'font-weight:600;' : ''}white-space:pre-wrap;word-break:break-all;max-width:220px">${adgEsc(adupShow(f, r[f]))}</td>`).join('');
    const filled = f in mg.patch;
    return `<tr><td style="padding:3px 6px;border-bottom:1px solid var(--border-light);color:var(--text-3);white-space:nowrap;vertical-align:top">${adgEsc(ADUP_LABEL[f] || f)}</td>${cells}
      <td style="padding:3px 6px;border-bottom:1px solid var(--border-light);vertical-align:top;white-space:pre-wrap;word-break:break-all;max-width:220px;${c ? 'background:#fbd5d5;' : filled ? 'background:#e3f3e3;' : ''}">${adgEsc(adupShow(f, mg.merged[f]))}${c ? ' <span style="color:#a33;font-size:10px">（两行不同，用保留行）</span>' : ''}</td></tr>`;
  }).join('');
  return `<div style="border:1px solid var(--border);border-radius:4px;padding:10px 12px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
      <b style="font-size:12px">${adgEsc(h.university)}　${adgEsc([h.faculty, h.department, h.course].filter(x => adgNorm(x)).join(' / '))}</b>
      <span style="font-size:11px;color:var(--text-2)">${adgEsc(adgNorm(h.admission_type))} ${adgEsc(adgNorm(h.application_period))}（${g.rows.length} 行）</span>
      <button class="btn btn-primary btn-sm" style="margin-left:auto;font-size:11px" ${adupState.busy ? 'disabled' : ''} onclick="adupMergeOne(${gi})">合并这一组</button>
    </div>
    <div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:10.5px;width:100%">
      <thead><tr><th></th>${th}<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--border)">合并后</th></tr></thead>
      <tbody>${body}</tbody></table></div>
    <div style="font-size:10px;color:var(--text-3);margin-top:4px">黄色 = 各行不一样；绿色 = 保留行为空、由其他行补上；红色 = 两行都有值但不同，用保留行的</div>
  </div>`;
}

function adupRender() {
  const box = document.getElementById('adupBody');
  if (!box || !adupState) return;
  const st = adupState, gs = st.groups;
  let h = '';
  if (st.result) h += `<div style="background:#e3f3e3;border:1px solid #b5d9b5;border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:12px">${adgEsc(st.result)}</div>`;
  if (!gs.length) {
    h += `<div style="padding:20px;text-align:center;color:var(--text-3)">没有重复数据（共检查 ${st.total} 行）</div>`;
  } else {
    h += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <span style="font-size:12px">共 <b>${gs.length}</b> 组重复（${gs.reduce((n, g) => n + g.rows.length - 1, 0)} 行将被删除）</span>
      <button class="btn btn-primary btn-sm" style="margin-left:auto" ${st.busy ? 'disabled' : ''} onclick="adupMergeAll()">合并全部（${gs.length} 组）</button></div>`;
    h += gs.slice(0, st.shown).map((g, i) => adupGroupHtml(g, i)).join('');
    if (gs.length > st.shown) h += `<div style="text-align:center"><button class="btn btn-outline btn-sm" onclick="adupState.shown+=LIST_PAGE;adupRender()">显示更多（还有 ${gs.length - st.shown} 组）</button></div>`;
  }
  box.innerHTML = h;
}

function adupSetKeep(gi, id) { adupState.groups[gi].keepId = id; adupRender(); }

// 把 teacher_school_shares.school_ids 里的旧 id 换成保留行 id（去重）。idMap: 旧id → 保留id。返回改了几条分享
async function adupFixShares(idMap) {
  const shares = await sbAll('/rest/v1/teacher_school_shares?select=id,school_ids&order=id.asc');
  let n = 0;
  for (const sl of shares) {
    const ids = Array.isArray(sl.school_ids) ? sl.school_ids : [];
    if (!ids.some(i => idMap.has(String(i)))) continue;
    const seen = new Set(), out = [];
    ids.forEach(i => { const v = idMap.has(String(i)) ? idMap.get(String(i)) : i; if (!seen.has(String(v))) { seen.add(String(v)); out.push(v); } });
    await sb(`/rest/v1/teacher_school_shares?id=eq.${encodeURIComponent(sl.id)}`, 'PATCH', { school_ids: out });
    n++;
  }
  return n;
}

// 合并一批组：先补保留行 → 再改分享里的 id → 最后删其他行
async function adupDoMerge(list) {
  const idMap = new Map(), delIds = [];
  const plans = list.map(g => adupMerge(g));
  for (const p of plans) {
    if (Object.keys(p.patch).length) await sb(`/rest/v1/admission_schools?id=eq.${encodeURIComponent(p.keep.id)}`, 'PATCH', p.patch);
    p.others.forEach(o => { idMap.set(String(o.id), p.keep.id); delIds.push(o.id); });
  }
  const shareN = await adupFixShares(idMap);
  for (let i = 0; i < delIds.length; i += 100) {
    const part = delIds.slice(i, i + 100);
    await sb(`/rest/v1/admission_schools?id=in.(${part.map(id => `"${id}"`).join(',')})`, 'DELETE');
  }
  return { groups: list.length, deleted: delIds.length, shares: shareN };
}

async function adupRun(list) {
  const st = adupState;
  st.busy = true; st.result = null; adupRender();
  try {
    const r = await adupDoMerge(list);
    st.groups = st.groups.filter(g => !list.includes(g));
    st.result = `合并了 ${r.groups} 组，删除 ${r.deleted} 行` + (r.shares ? `（同时更新了 ${r.shares} 份共享给学生的志望校列表）` : '');
    if (typeof adbSelectedMajors !== 'undefined' && adbSelectedMajors.length && typeof loadAdbData === 'function') loadAdbData();
  } catch (e) {
    st.result = null;
    alert('合并失败：' + e.message + '\n已完成的步骤不会回滚，请重新点「检查重复」确认当前状态。');
  }
  st.busy = false;
  adupRender();
}

async function adupMergeOne(gi) {
  const g = adupState.groups[gi];
  if (!g || adupState.busy) return;
  await adupRun([g]);
}
async function adupMergeAll() {
  const st = adupState;
  if (!st || st.busy || !st.groups.length) return;
  const del = st.groups.reduce((n, g) => n + g.rows.length - 1, 0);
  if (!confirm(`确定合并全部 ${st.groups.length} 组？\n每组按当前选定的「保留」行合并，共删除 ${del} 行，不能撤销。\n（请确认已经备份）`)) return;
  await adupRun(st.groups.slice());
}
