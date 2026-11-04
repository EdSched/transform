// ══════════════════════════════════
// 出願数据库：Excel 补缺导入（只补数据库里空着的字段，不覆盖、不删除、不改 id）
// 流程：选文件 → 预览（能对上 / Excel 有库里没有 / 库里有 Excel 没有）→ 确认补缺才写入
// ══════════════════════════════════

// 补缺时可以补的字段（key 字段 大学/研究科/専攻/コース/出願類型 用来对应，不补）
const AIMP_FILL_FIELDS = [
  ['type', '設置主体'], ['doc_review_period', '資格審査'], ['application_period', '出願期間'], ['written_exam', '筆記試験'],
  ['oral_exam', '口述試験'], ['result_date', '合格発表'], ['english_required', '英語成績'], ['japanese_required', '日本語成績'],
  ['recommendation', '推薦状'], ['thesis', '卒業論文'], ['other_docs', 'その他書類'], ['exam_style', '試験方式'], ['notes', '備考'],
  ['guideline_url', '募集要項'], ['past_exam_url', '過去問'], ['staff_url', '教员链接'],
];
const AIMP_JSON_FIELDS = [['english_tests', '英語成績明細'], ['japanese_tests', '日本語成績明細']];
const AIMP_LABEL = Object.fromEntries(AIMP_FILL_FIELDS.concat(AIMP_JSON_FIELDS));
const AIMP_REQ_FIELDS = ['english_required', 'japanese_required', 'recommendation', 'thesis'];

let aimpState = null;   // { matched:[{db,xl,patch}], addable:[{xl,sheet}], missing:[db], skipped:[...], sel:Set, shown:{} , dbReady }

function aimpClean(v) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').replace(/^[\s　]+|[\s　]+$/g, ''); }
function aimpHeadNorm(v) { return String(v == null ? '' : v).normalize('NFKC').replace(/[\s　]+/g, ''); }
function aimpReq(v) { v = aimpClean(v); if (v === '必要' || v === '必須') return '必須'; return v; }
function aimpEmpty(v) { return v == null || String(v).trim() === ''; }
function aimpJsonEmpty(v) { return !v || typeof v !== 'object' || !Object.keys(v).length; }
function aimpTitle(r) { return [r.university, r.faculty, r.department, r.course].map(x => aimpClean(x)).filter(Boolean).join(' / ') + (aimpClean(r.admission_type) ? '　【' + aimpClean(r.admission_type) + '】' : ''); }
function aimpKey(major, r) { return [major, r.university, r.faculty, r.department, r.course, r.admission_type].map(adgNorm).join('\u0001'); }

// 子列名 → 标准考试名
function aimpTestName(kind, raw) {
  const n = aimpHeadNorm(raw).toUpperCase();
  if (kind === 'en') {
    for (const k of ['TOEFL', 'TOEIC', 'IELTS', 'GRE', 'GMAT']) if (n.includes(k)) return k;
    if (n.includes('英検')) return '英検';
  } else {
    if (/N1/.test(n)) return 'JLPT-N1';
    if (/N2/.test(n)) return 'JLPT-N2';
    if (n.includes('EJU')) return 'EJU';
    if (n.includes('日本語学力')) return '日本語学力証明';
  }
  if (n.includes('その他') || n.includes('他')) return 'その他';
  return aimpClean(raw);
}
// 主表头名 → 字段
function aimpFieldOf(h) {
  if (!h) return '';
  if (h === '大学名' || h === '大学') return 'university';
  if (h.includes('設置')) return 'type';
  if (h.startsWith('研究科')) return 'faculty';
  if (h.startsWith('専攻')) return 'department';
  if (h.startsWith('コース')) return 'course';
  if (h.includes('出願類型')) return 'admission_type';
  if (h.includes('資格審査')) return 'doc_review_period';
  if (h.includes('出願期間')) return 'application_period';
  if (h.includes('筆記')) return 'written_exam';
  if (h.includes('口述')) return 'oral_exam';
  if (h.includes('合格発表')) return 'result_date';
  if (h.startsWith('英語成績')) return 'english_required';
  if (h.startsWith('日本語成績')) return 'japanese_required';
  if (h.includes('推薦')) return 'recommendation';
  if (h.includes('卒業論文') || h.includes('卒論')) return 'thesis';
  if (h.includes('その他書類')) return 'other_docs';
  if (h.includes('試験方式')) return 'exam_style';
  if (h.includes('備考')) return 'notes';
  if (h.includes('募集要項')) return 'guideline_url';
  if (h.includes('過去問')) return 'past_exam_url';
  if (h.includes('教员') || h.includes('教員')) return 'staff_url';
  return '';
}

// 读一个 sheet → [{university, ..., english_tests, japanese_tests}]，按表头名字对列
function aimpParseSheet(ws) {
  const ref = ws['!ref']; if (!ref) return { rows: [], cols: new Set() };
  const rng = XLSX.utils.decode_range(ref);
  const cell = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
  const text = (r, c) => { const x = cell(r, c); return x ? aimpClean(x.w != null ? x.w : x.v) : ''; };
  const linkOrText = (r, c) => { const x = cell(r, c); if (!x) return ''; const t = x.l && x.l.Target ? aimpClean(x.l.Target) : ''; return t || aimpClean(x.w != null ? x.w : x.v); };
  // 表头：含「大学名」的那一行是第一行，下一行是语言明细的小列
  let h1 = -1;
  for (let r = rng.s.r; r <= Math.min(rng.e.r, rng.s.r + 8) && h1 < 0; r++)
    for (let c = rng.s.c; c <= rng.e.c; c++) if (aimpHeadNorm(text(r, c)) === '大学名') { h1 = r; break; }
  if (h1 < 0) return { rows: [], cols: new Set(), noHeader: true };
  const colInfo = [];   // c → { field } | { kind:'en'|'jp', name } | { extra:true }
  let group = '';
  let lastNamed = -1;
  for (let c = rng.s.c; c <= rng.e.c; c++) {
    const top = aimpHeadNorm(text(h1, c)), sub = text(h1 + 1, c);
    if (top && /^英語.*詳細/.test(top)) group = 'en';
    else if (top && /^日本語.*詳細/.test(top)) group = 'jp';
    else if (top) group = '';
    if (top && !/詳細/.test(top)) {
      const f = aimpFieldOf(top);
      colInfo[c] = f ? { field: f } : null;
      if (f) lastNamed = c;
    } else if (group && aimpHeadNorm(sub)) {
      colInfo[c] = { kind: group, name: aimpTestName(group, sub) };
      lastNamed = c;
    } else colInfo[c] = null;
  }
  const hasSub = colInfo.some(x => x && x.kind);
  const start = h1 + (hasSub || aimpHeadNorm(text(h1 + 1, rng.s.c)) === '' ? 1 : 0) + 1;
  const cols = new Set(colInfo.filter(x => x && x.field).map(x => x.field));
  const firstCol = rng.s.c;
  const out = [];
  for (let r = start; r <= rng.e.r; r++) {
    const first = aimpHeadNorm(text(r, firstCol));
    if (/^記入方法/.test(first) || first === 'z' || first === 'Z') continue;
    const row = { english_tests: {}, japanese_tests: {} };
    const extraStyle = [];
    for (let c = rng.s.c; c <= rng.e.c; c++) {
      const info = colInfo[c];
      if (info && info.field) {
        const isUrl = info.field === 'guideline_url' || info.field === 'past_exam_url' || info.field === 'staff_url';
        const v = isUrl ? linkOrText(r, c) : text(r, c);
        if (!aimpEmpty(v) && aimpEmpty(row[info.field])) row[info.field] = v;
        else if (info.field === 'exam_style' && !aimpEmpty(v) && v !== row.exam_style) extraStyle.push(v);
      } else if (info && info.kind) {
        const v = text(r, c);
        if (!aimpEmpty(v)) (info.kind === 'en' ? row.english_tests : row.japanese_tests)[info.name] = v;
      } else if (c > lastNamed) {
        const v = text(r, c);   // 最后没写表头的格子：当作試験方式的补充
        if (!aimpEmpty(v)) extraStyle.push(v);
      }
    }
    if (extraStyle.length) row.exam_style = [row.exam_style].concat(extraStyle).filter(x => !aimpEmpty(x)).join(' / ');
    const uni = aimpClean(row.university);
    if (!uni || uni === '大学名を記入') continue;
    AIMP_REQ_FIELDS.forEach(f => { if (!aimpEmpty(row[f])) row[f] = aimpReq(row[f]); });
    ['english_tests', 'japanese_tests'].forEach(k => { if (!Object.keys(row[k]).length) row[k] = null; });
    out.push(row);
  }
  return { rows: out, cols };
}

// 心理学等：在出愿专业里按名字找代码；找不到返回 ''
function aimpMajorOfSheet(name) {
  if (SHEET_TO_MAJOR[name]) return SHEET_TO_MAJOR[name];
  const hit = Object.entries(ADMISSION_MAJORS).find(([, label]) => label === name || name.startsWith(label));
  return hit ? hit[0] : '';
}

// ── 入口 ──
function openAdmissionImport() {
  aimpState = null;
  let m = document.getElementById('admissionImportModal');
  if (m) m.remove();
  m = document.createElement('div');
  m.id = 'admissionImportModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = `<div class="modal" style="width:880px;max-width:100%;max-height:none">
    <div class="modal-title">导入 Excel（补缺）</div>
    <div style="font-size:11px;color:var(--text-2);margin-bottom:10px;line-height:1.8">
      只把数据库里<strong>空着</strong>的字段补上（含英语 / 日语成绩明细）；数据库里已有值的一律不改，也不删除任何行。选文件后先预览，确认后才写入。
    </div>
    <div class="form-group"><label class="form-label">选择文件</label>
      <input type="file" id="admissionImportFile" accept=".xlsx,.xls" onchange="aimpOnFile(this)"></div>
    <div id="admissionImportPreview" style="margin-top:10px;font-size:11px;color:var(--text-2)"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeAdmissionImport()">取消</button>
      <button class="btn btn-primary" id="admissionImportBtn" onclick="confirmAdmissionImport()" disabled>确认补缺</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}
function closeAdmissionImport() {
  const m = document.getElementById('admissionImportModal'); if (m) m.remove();
  aimpState = null;
}

async function aimpOnFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const box = document.getElementById('admissionImportPreview');
  const btn = document.getElementById('admissionImportBtn');
  btn.disabled = true;
  box.innerHTML = '解析并对照数据库中…（数据较多，请稍等）';
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const dbRows = await sbAll('/rest/v1/admission_schools?select=*&order=id.asc');
    const dbReady = dbRows.length === 0 || ('english_tests' in dbRows[0] && 'japanese_tests' in dbRows[0] && 'staff_url' in dbRows[0]);
    const skipped = [];
    const xlByMajor = {};   // major → [{row, sheet}]
    wb.SheetNames.forEach(name => {
      if (ADMISSION_SKIP_SHEETS.includes(name)) { skipped.push(`${name}：按规定跳过`); return; }
      const major = aimpMajorOfSheet(name);
      if (!major) { skipped.push(name === '心理学' ? `心理学：「出愿专业」里还没有心理学的代码，已跳过，请确认代码后再导入` : `${name}：没有对应的专业，已跳过`); return; }
      const res = aimpParseSheet(wb.Sheets[name]);
      if (res.noHeader) { skipped.push(`${name}：找不到「大学名」表头，已跳过`); return; }
      (xlByMajor[major] = xlByMajor[major] || []).push(...res.rows.map(row => ({ row, sheet: name, cols: res.cols })));
    });
    const matched = [], addable = [], missing = [];
    const dbBy = {};
    dbRows.forEach(r => { (dbBy[r.major] = dbBy[r.major] || []).push(r); });
    Object.keys(xlByMajor).forEach(major => {
      // 只去掉「不同 sheet 之间」完全相同的行（比如经营学 与 经营学专升硕）；同一个 sheet 里重复的行是真实的多条，要一一对应
      const firstSheet = new Map(), xl = [];
      xlByMajor[major].forEach(x => {
        const sig = JSON.stringify(x.row);
        if (firstSheet.has(sig) && firstSheet.get(sig) !== x.sheet) return;
        firstSheet.set(sig, x.sheet); xl.push(x);
      });
      const dbMap = new Map();
      (dbBy[major] || []).forEach(r => { const k = aimpKey(major, r); (dbMap.get(k) || dbMap.set(k, []).get(k)).push(r); });
      const used = new Set();
      // 同一个 key 有多条时，优先对上日程最像的那条（出願期間等一致），避免明细补到别的出愿上
      const sim = (db, row) => ['application_period', 'doc_review_period', 'written_exam', 'oral_exam', 'result_date']
        .reduce((n, f) => n + (!aimpEmpty(row[f]) && adgNorm(db[f]) === adgNorm(row[f]) ? 1 : 0), 0);
      xl.forEach(x => {
        const k = aimpKey(major, x.row);
        const list = (dbMap.get(k) || []).filter(r => !used.has(r.id));
        let db = null, best = -1;
        list.forEach(r => { const sc = sim(r, x.row); if (sc > best) { best = sc; db = r; } });
        if (!db) { addable.push({ major, xl: x.row, sheet: x.sheet, cols: x.cols }); return; }
        used.add(db.id);
        const patch = {};
        AIMP_FILL_FIELDS.forEach(([f]) => { if (aimpEmpty(db[f]) && !aimpEmpty(x.row[f])) patch[f] = x.row[f]; });
        AIMP_JSON_FIELDS.forEach(([f]) => { if (aimpJsonEmpty(db[f]) && !aimpJsonEmpty(x.row[f])) patch[f] = x.row[f]; });
        matched.push({ db, xl: x.row, patch });
      });
      (dbBy[major] || []).forEach(r => { if (!used.has(r.id)) missing.push(r); });
    });
    aimpState = { matched, addable, missing, skipped, sel: new Set(), shown: {}, dbReady, majors: Object.keys(xlByMajor) };
    aimpRender();
  } catch (e) {
    box.innerHTML = `<span style="color:var(--danger)">解析失败：${adgEsc(e.message)}</span>`;
  }
}

function aimpPatchedCount() { return aimpState.matched.filter(m => Object.keys(m.patch).length).length; }
function aimpFieldCount() { return aimpState.matched.reduce((n, m) => n + Object.keys(m.patch).length, 0); }

function aimpRender() {
  const st = aimpState, box = document.getElementById('admissionImportPreview');
  if (!st || !box) return;
  const btn = document.getElementById('admissionImportBtn');
  const nPatch = aimpPatchedCount(), nField = aimpFieldCount();
  btn.disabled = !st.dbReady || (!nPatch && !st.sel.size);
  btn.textContent = `确认补缺（补 ${nPatch} 行 / ${nField} 个字段${st.sel.size ? `，新增 ${st.sel.size} 行` : ''}）`;
  const sec = (id, title, count, inner) => `<details style="border:1px solid var(--border-light);border-radius:3px;margin-bottom:8px;background:var(--bg)" ${st.open && st.open[id] ? 'open' : ''} ontoggle="aimpState.open=aimpState.open||{};aimpState.open['${id}']=this.open">
    <summary style="cursor:pointer;padding:8px 10px;font-size:12px;font-weight:600">${title} <span style="font-weight:400;color:var(--text-3)">${count}</span></summary>
    <div style="padding:6px 10px 10px;border-top:1px solid var(--border-light)">${inner}</div></details>`;
  const more = (id, total) => (st.shown[id] || 60) < total
    ? `<div style="text-align:center;margin-top:6px"><button class="btn btn-outline btn-sm" onclick="aimpState.shown['${id}']=(aimpState.shown['${id}']||60)+60;aimpRender()">显示更多（还有 ${total - (st.shown[id] || 60)} 条）</button></div>` : '';
  const lim = id => st.shown[id] || 60;
  const showVal = (f, v) => typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${adgEsc(k)}：${adgEsc(x)}`).join('　') : adgEsc(v);
  const withPatch = st.matched.filter(m => Object.keys(m.patch).length);

  const blk1 = withPatch.length ? withPatch.slice(0, lim('m')).map(m => `<div style="padding:5px 0;border-bottom:1px solid var(--border-light);line-height:1.7">
      <div style="font-weight:500">${adgEsc(ADMISSION_MAJORS[m.db.major] || m.db.major)}｜${adgEsc(aimpTitle(m.db))}</div>
      ${Object.entries(m.patch).map(([f, v]) => `<span style="display:inline-block;margin-right:12px"><span style="color:var(--text-3)">${AIMP_LABEL[f] || f}</span> → ${showVal(f, v)}</span>`).join('')}
    </div>`).join('') + more('m', withPatch.length) : '<div style="color:var(--text-3)">没有需要补的字段</div>';

  // 新增候选：按专业分组的 chip，默认都不选
  const addIdx = st.addable.map((a, i) => ({ a, i }));
  const byMajor = {};
  addIdx.forEach(x => { (byMajor[x.a.major] = byMajor[x.a.major] || []).push(x); });
  const blk2 = st.addable.length ? `<div style="margin-bottom:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-outline btn-sm" onclick="aimpSelAdd(true)">全选</button><button class="btn btn-outline btn-sm" onclick="aimpSelAdd(false)">全不选</button>
      <span style="color:var(--text-3)">已选 ${st.sel.size} / ${st.addable.length}，点选要新增的行（照 Excel 原样写入）</span></div>`
    + Object.entries(byMajor).map(([mj, list]) => {
      const id = 'a_' + mj, shown = list.slice(0, lim(id));
      return `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:600;margin-bottom:4px">${adgEsc(ADMISSION_MAJORS[mj] || mj)}（${list.length}）</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">${shown.map(x => `<span class="filter-chip${st.sel.has(x.i) ? ' active' : ''}" style="font-size:10.5px" onclick="aimpToggleAdd(${x.i})">${adgEsc(aimpTitle(x.a.xl))}</span>`).join('')}</div>${more(id, list.length)}</div>`;
    }).join('') : '<div style="color:var(--text-3)">没有</div>';

  const blk3 = st.missing.length ? `<div style="color:var(--text-3);margin-bottom:4px">只列出来供核对，不会删除。</div>`
    + st.missing.slice(0, lim('x')).map(r => `<div style="padding:3px 0;border-bottom:1px solid var(--border-light)">${adgEsc(ADMISSION_MAJORS[r.major] || r.major)}｜${adgEsc(aimpTitle(r))}</div>`).join('') + more('x', st.missing.length)
    : '<div style="color:var(--text-3)">没有</div>';

  box.innerHTML = `
    ${st.dbReady ? '' : '<div style="background:#fdecea;border:1px solid #f5c6cb;border-radius:3px;padding:8px 10px;margin-bottom:8px;color:var(--danger)">数据库还没有新增的列（english_tests / japanese_tests / staff_url）。请先在 Supabase 执行合并说明里的 SQL，再重新选文件。</div>'}
    <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:8px 10px;margin-bottom:8px;line-height:1.9">
      读到的专业：${st.majors.map(m => adgEsc(ADMISSION_MAJORS[m] || m)).join('、') || '无'}<br>
      能对上 <strong>${st.matched.length}</strong> 行（其中有字段可补 <strong>${nPatch}</strong> 行 / <strong>${nField}</strong> 个字段）· Excel 有、库里没有 <strong>${st.addable.length}</strong> 行 · 库里有、Excel 没有 <strong>${st.missing.length}</strong> 行
      ${st.skipped.length ? `<br><span style="color:var(--warn)">跳过：${st.skipped.map(adgEsc).join('；')}</span>` : ''}
    </div>
    ${sec('m', '能对上的行：将补上的字段', `${nPatch} 行 / ${nField} 个字段`, blk1)}
    ${sec('a', 'Excel 里有、数据库里没有的行（默认不新增）', `${st.addable.length} 行，已选 ${st.sel.size}`, blk2)}
    ${sec('x', '数据库里有、Excel 里没有的行（只列出，不删除）', `${st.missing.length} 行`, blk3)}`;
}

function aimpToggleAdd(i) { if (aimpState.sel.has(i)) aimpState.sel.delete(i); else aimpState.sel.add(i); aimpRender(); }
function aimpSelAdd(all) { aimpState.sel = all ? new Set(aimpState.addable.map((_, i) => i)) : new Set(); aimpRender(); }

async function confirmAdmissionImport() {
  const st = aimpState;
  if (!st || !st.dbReady) return;
  const patches = st.matched.filter(m => Object.keys(m.patch).length);
  const adds = [...st.sel].map(i => st.addable[i]);
  if (!patches.length && !adds.length) { alert('没有可写入的内容'); return; }
  if (!confirm(`将给 ${patches.length} 行补上 ${aimpFieldCount()} 个字段，并新增 ${adds.length} 行。已有值的字段不会改动，确定吗？`)) return;
  const btn = document.getElementById('admissionImportBtn');
  btn.disabled = true;
  let okRows = 0, okFields = 0, addOk = 0;
  try {
    for (let i = 0; i < patches.length; i += 6) {
      btn.textContent = `补缺中… ${i}/${patches.length}`;
      await Promise.all(patches.slice(i, i + 6).map(async m => {
        await sb(`/rest/v1/admission_schools?id=eq.${encodeURIComponent(m.db.id)}`, 'PATCH', m.patch);
        okRows++; okFields += Object.keys(m.patch).length;
      }));
    }
    const mk = (a, n) => {
      const x = a.xl, c = a.cols;
      const o = { id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${n}`, major: a.major };
      ['university', 'type', 'faculty', 'department', 'course', 'admission_type', 'doc_review_period', 'application_period', 'written_exam', 'oral_exam', 'result_date',
        'english_required', 'japanese_required', 'recommendation', 'thesis', 'other_docs', 'exam_style', 'notes', 'guideline_url', 'past_exam_url', 'staff_url']
        .forEach(f => { o[f] = aimpClean(x[f]); });
      // 原有导入的习惯：表里有这一列但格子空 = 不要
      AIMP_REQ_FIELDS.forEach(f => { if (!o[f] && c && c.has(f)) o[f] = '不要'; });
      o.english_tests = x.english_tests || null; o.japanese_tests = x.japanese_tests || null;
      return o;
    };
    for (let i = 0; i < adds.length; i += 100) {
      btn.textContent = `新增中… ${i}/${adds.length}`;
      const batch = adds.slice(i, i + 100).map((a, j) => mk(a, i + j));
      await sb('/rest/v1/admission_schools', 'POST', batch);
      addOk += batch.length;
    }
    closeAdmissionImport();
    alert(`补缺完成：补了 ${okRows} 行 / ${okFields} 个字段，新增 ${addOk} 行。`);
    const majorRows = await sbAll('/rest/v1/admission_schools?select=major&order=id.asc').catch(() => []);
    cachedAdmissionMajorCounts = {};
    majorRows.forEach(r => { cachedAdmissionMajorCounts[r.major] = (cachedAdmissionMajorCounts[r.major] || 0) + 1; });
    if (adbSelectedMajors.length) await loadAdbData();
    renderAdmissionDbPage(document.getElementById('mainContent'));
  } catch (e) {
    alert(`写入中断（已补 ${okRows} 行 / ${okFields} 个字段，已新增 ${addOk} 行）：${e.message}\n重新选文件即可继续——已补的不会重复。`);
    btn.disabled = false; btn.textContent = '确认补缺';
  }
}
