// ══════════════════════════════════
// 出願数据库
// ══════════════════════════════════

// ADMISSION_MAJORS 现在统一在 shared/constants.js（唯一数据源）；此处仅兜底，防 constants 未更新时报错
if (typeof ADMISSION_MAJORS === 'undefined') {
  window.ADMISSION_MAJORS = { shakai:'社会学', keiei:'経営学', keizai:'経済学', shinpan:'新闻传播学', fukushi:'社会福祉学', jpjiaoyu:'日本语教育', hyosho:'表象文化・文学・哲学', seiji:'政治学', toyo:'東洋史', bunka:'文化人类学', mot:'MOT', tokei:'統計・計量', kyoiku:'教育学' };
}

// 导入时整个跳过的 sheet（MOT 的副本、分野分类）
const ADMISSION_SKIP_SHEETS = ['MOT（复制用）', '社会学各分'];
const SHEET_TO_MAJOR = {
  '社会学': 'shakai', '经营学': 'keiei', '经济学': 'keizai',
  '新闻传播学': 'shinpan', '社会福祉学': 'fukushi', '日本语教育': 'jpjiaoyu',
  '表象文化・文学・哲学': 'hyosho', '政治学': 'seiji', '东洋史': 'toyo',
  '文化人类学': 'bunka', 'MOT': 'mot',
  '統計・計量在籍': 'tokei', '经营学专升硕': 'keiei',
  '教育学': 'kyoiku', '教育': 'kyoiku', '教育学在籍': 'kyoiku',
};

// 当前选中的专业列表（支持多选）
let adbSelectedMajors = []; // 空=未选，['shakai']单选，['shakai','shinpan','fukushi']多选
let adbEnglish = 'all', adbJapanese = 'all', adbSearch = '';
let adbMonthFrom = 0, adbMonthTo = 0;
let adbEreOnly = false; // 0=不限
let adbEditId = null;
let adbEngTests = new Set(), adbJpTests = new Set(); // 语言考试 chips（可叠加，key 如 'TOEIC' / 'JLPT-N1'）
let adbSortMode = 'time';   // 'time' 按最早出愿时间 | 'name' 按大学名
let adbOpen = new Set();    // 已展开的组（key）
let adbShown = LIST_PAGE;          // 每次多显示 30 组
let adbGroupsView = [];     // 当前显示的组（行上的 onclick 用下标取）

function renderAdmissionDbPage(mc) {
  const majorCounts = (typeof cachedAdmissionMajorCounts !== 'undefined' && Object.keys(cachedAdmissionMajorCounts).length) ? cachedAdmissionMajorCounts : {};

  mc.innerHTML = `
  <div class="page-header">
    <div class="section-title">出願数据库</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="openAdmissionImport()">↑ 导入 Excel</button>
      <button class="btn btn-outline btn-sm" onclick="openAdmissionAdd()">＋ 添加</button>
      <button class="btn btn-outline btn-sm" onclick="exportAdmissionExcel()">↓ 导出 Excel</button>
      <button class="btn btn-outline btn-sm" onclick="exportAdmissionHtml()">↓ 导出 PDF表格</button>
      <button class="btn btn-outline btn-sm" onclick="openAdmMajorMgr()">🏷 出愿专业管理</button>
      <button class="btn btn-primary btn-sm" onclick="openShareToStudents()">📤 共享给学生</button>
    </div>
  </div>

  <!-- 专业筛选（支持多选） -->
  <div style="margin-bottom:6px;font-size:10px;color:var(--text-3)">点击选择专业（可多选）；点分组名（如「社会人文」）同时加载组内所有专业</div>
  <div class="filter-row" style="margin-bottom:8px" id="adbMajorRow">
    ${chipFold([].concat(adbGroupKeys().filter(g=>scopeAll()||scopeHasDomain(groupDomain(g)||'大学院文科')||VIEW_SCOPE.majors.includes(g)).map(g=>{const on=adbGroupMembers(g).every(k=>adbSelectedMajors.includes(k));return {on,html:`<div class="filter-chip${on?' active':''}" onclick="toggleAdbMajor('${g}',this)" id="adb_chip_${g}">${groupLabel(g)}</div>`};})).concat(Object.entries(ADMISSION_MAJORS).filter(([k,v])=>{
      if(scopeAll()) return true;
      // 已知领域的按领域判断；出愿专用未登记的key默认当大学院文科；单独选中的专业也算
      const dom = MAJOR_DOMAIN[k] || '大学院文科';
      return scopeHasDomain(dom) || VIEW_SCOPE.majors.includes(k);
    }).map(([k,v])=>({on:adbSelectedMajors.includes(k),html:`
      <div class="filter-chip${adbSelectedMajors.includes(k)?' active':''}" onclick="toggleAdbMajor('${k}',this)" id="adb_chip_${k}">${v}${majorCounts[k]?` <span style="font-size:9px;opacity:.6">${majorCounts[k]}</span>`:''}</div>
    `}))))}
    <div class="filter-chip" onclick="clearAdbMajors()" style="color:var(--text-3)">清除</div>
  </div>

  <!-- 语言筛选 -->
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
    <div style="font-size:11px;color:var(--text-3)">英语</div>
    ${['all','必須','任意','不要'].map((v,i)=>`<button class="btn btn-sm adb-lang-btn${adbEnglish===v?' btn-primary':' btn-outline'}" onclick="setAdbFilter('english','${v}')" style="font-size:11px;padding:3px 10px">${['全部','必须','任意','不要'][i]}</button>`).join('')}
    <div style="width:1px;height:18px;background:var(--border);margin:0 4px"></div>
    <div style="font-size:11px;color:var(--text-3)">日语</div>
    ${['all','必須','任意','不要'].map((v,i)=>`<button class="btn btn-sm adb-lang-btn${adbJapanese===v?' btn-primary':' btn-outline'}" onclick="setAdbFilter('japanese','${v}')" style="font-size:11px;padding:3px 10px">${['全部','必须','任意','不要'][i]}</button>`).join('')}
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
    <span style="font-size:11px;color:var(--text-3)">接受的考试（可多选，选其一即可）</span>
    <span id="adbTestChips" style="display:inline-flex;gap:6px;flex-wrap:wrap;align-items:center">${adbTestChipsInner()}</span>
  </div>

  <!-- 出願月份筛选 -->
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
    <span style="font-size:11px;color:var(--text-3)">出願月份</span>
    <select id="adbMonthFromSel" onchange="setAdbMonthFrom(parseInt(this.value))" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
      <option value="0">从（不限）</option>
      ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>`<option value="${m}" ${adbMonthFrom===m?'selected':''}>${m}月</option>`).join('')}
    </select>
    <span style="font-size:11px;color:var(--text-3)">—</span>
    <select id="adbMonthToSel" onchange="setAdbMonthTo(parseInt(this.value))" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
      <option value="0">至（不限）</option>
      ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>`<option value="${m}" ${adbMonthTo===m?'selected':''}>${m}月</option>`).join('')}
    </select>
    ${(adbMonthFrom||adbMonthTo)?`<button onclick="adbMonthFrom=0;adbMonthTo=0;renderAdmissionDbPage(document.getElementById('mainContent'))" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 7px;cursor:pointer;font-family:inherit;color:var(--text-3)">清除</button>`:''}
  </div>
  <div id="adbEreContainer" style="margin-bottom:10px;display:none">
    <button id="adbEreBtn" class="btn btn-sm btn-outline" onclick="adbEreOnly=!adbEreOnly;renderAdmissionTable()" style="font-size:11px;padding:3px 12px;border:1px solid var(--border)">📊 ERE可代替笔试</button>
    <span id="adbEreHint" style="font-size:10px;color:var(--text-3);margin-left:6px;display:none">仅显示ERE可代替笔试的学校</span>
  </div>

  <!-- 搜索 -->
  <div style="margin-bottom:10px">
    <input type="text" placeholder="搜索大学名 / 研究科 / 専攻…" value="${searchAttr(adbSearch)}"
      oninput="searchBox(this,setAdbSearch)"
      style="font-size:12px;max-width:320px">
  </div>

  <!-- 结果数 -->
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
    <div style="font-size:11px;color:var(--text-3)" id="adbResultCount">请点击上方专业查看数据</div>
    <span style="font-size:11px;color:var(--text-3)">排序</span>
    <select onchange="adbSortMode=this.value;adbShown=LIST_PAGE;renderAdmissionTable()" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
      <option value="time" ${adbSortMode==='time'?'selected':''}>按最早出愿时间</option>
      <option value="name" ${adbSortMode==='name'?'selected':''}>按大学名</option>
    </select>
  </div>

  <!-- 表格 -->
  <div style="overflow-x:auto">
    <table class="student-table" id="admissionTable" style="font-size:11px">
      <thead id="admissionThead"></thead>
      <tbody id="admissionTableBody"></tbody>
    </table>
  </div>
  <div id="adbMoreBox" style="text-align:center;margin:10px 0"></div>

  <!-- 编辑 modal -->
  <div class="modal-overlay" id="admissionEditModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;align-items:center;justify-content:center;padding:16px">
    <div class="modal" style="width:680px;max-height:85vh;overflow-y:auto">
      <div class="modal-title" id="admissionEditTitle">编辑学校信息</div>
      <input type="hidden" id="adb_id">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group" style="margin:0"><label class="form-label">专业 *</label>
          <select id="adb_major">${Object.entries(ADMISSION_MAJORS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="form-group" style="margin:0"><label class="form-label">大学名 *</label><input id="adb_university"></div>
        <div class="form-group" style="margin:0"><label class="form-label">設置主体</label>
          <select id="adb_type"><option value="">-</option><option>国立</option><option>公立</option><option>私立</option></select></div>
        <div class="form-group" style="margin:0"><label class="form-label">研究科名</label><input id="adb_faculty"></div>
        <div class="form-group" style="margin:0"><label class="form-label">専攻名</label><input id="adb_department"></div>
        <div class="form-group" style="margin:0"><label class="form-label">コース名</label><input id="adb_course"></div>
        <div class="form-group" style="margin:0"><label class="form-label">出願類型</label><input id="adb_admission_type"></div>
        <div class="form-group" style="margin:0"><label class="form-label">資格審査</label><input id="adb_doc_review_period" placeholder="5月上旬まで"></div>
        <div class="form-group" style="margin:0"><label class="form-label">出願期間</label><input id="adb_application_period" placeholder="5月下旬"></div>
        <div class="form-group" style="margin:0"><label class="form-label">筆記試験</label><input id="adb_written_exam"></div>
        <div class="form-group" style="margin:0"><label class="form-label">口述試験</label><input id="adb_oral_exam"></div>
        <div class="form-group" style="margin:0"><label class="form-label">合格発表</label><input id="adb_result_date"></div>
        <div class="form-group" style="margin:0"><label class="form-label">英語成績</label>
          <select id="adb_english_required"><option value="">-</option><option>必須</option><option>任意</option><option>不要</option></select></div>
        <div class="form-group" style="margin:0"><label class="form-label">英語詳細</label><input id="adb_english_detail" placeholder="TOEFL/TOEIC/IELTS等"></div>
        <div class="form-group" style="margin:0"><label class="form-label">日本語成績</label>
          <select id="adb_japanese_required"><option value="">-</option><option>必須</option><option>任意</option><option>不要</option></select></div>
        <div class="form-group" style="margin:0"><label class="form-label">日本語詳細</label><input id="adb_japanese_detail" placeholder="JLPT/EJU等"></div>
        <div class="form-group" style="margin:0"><label class="form-label">推薦状</label>
          <select id="adb_recommendation"><option value="">-</option><option>必須</option><option>任意</option><option>不要</option></select></div>
        <div class="form-group" style="margin:0"><label class="form-label">卒業論文</label>
          <select id="adb_thesis"><option value="">-</option><option>必須</option><option>任意</option><option>不要</option></select></div>
        <div class="form-group" style="margin:0;align-self:center"><label class="form-label">ERE可代替笔试</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-top:4px">
            <input type="checkbox" id="adb_ere_available" style="accent-color:var(--accent);width:16px;height:16px">
            <span>是（可用ERE代替笔记试）</span>
          </label></div>
        <div class="form-group" style="margin:0;grid-column:1/-1"><label class="form-label">試験方式</label><input id="adb_exam_style"></div>
        <div class="form-group" style="margin:0;grid-column:1/-1"><label class="form-label">備考</label><textarea id="adb_notes" rows="2"></textarea></div>
        <div class="form-group" style="margin:0"><label class="form-label">募集要項URL</label><input id="adb_guideline_url" type="url"></div>
        <div class="form-group" style="margin:0"><label class="form-label">過去問URL</label><input id="adb_past_exam_url" type="url"></div>
        <div class="form-group" style="margin:0"><label class="form-label">教员URL（仅管理端可见）</label><input id="adb_staff_url" type="url"></div>
        <div class="form-group" style="margin:0"><label class="form-label">その他書類</label><input id="adb_other_docs"></div>
        <div style="grid-column:1/-1;font-size:11px;color:var(--text-3);margin-top:4px">英語成績明細（〇 / 〇（必須）/ 〇（250）…，不接受的留空）</div>
        ${ADG_EN_TESTS.map(k=>`<div class="form-group" style="margin:0"><label class="form-label">${k}</label><input id="adb_et_${k}"></div>`).join('')}
        <div style="grid-column:1/-1;font-size:11px;color:var(--text-3);margin-top:4px">日本語成績明細</div>
        ${ADG_JP_TESTS.map(k=>`<div class="form-group" style="margin:0"><label class="form-label">${k}</label><input id="adb_jt_${k}"></div>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeAdmissionEdit()">取消</button>
        <button class="btn btn-danger btn-sm" id="adbDeleteBtn" onclick="deleteAdmissionSchool()" style="display:none">删除</button>
        <button class="btn btn-primary" onclick="saveAdmissionSchool()">保存</button>
      </div>
    </div>
  </div>
  `;

  renderAdmissionTable();
}

// ── 专业多选 ──
async function toggleAdbMajor(key, el) {
  if (isMajorGroup(key)) {
    // 分组（如社会人文）：切换组内专业整体
    const groupKeys = adbGroupMembers(key);
    const allSelected = groupKeys.every(k => adbSelectedMajors.includes(k));
    if (allSelected) {
      adbSelectedMajors = adbSelectedMajors.filter(k => !groupKeys.includes(k));
    } else {
      groupKeys.forEach(k => { if (!adbSelectedMajors.includes(k)) adbSelectedMajors.push(k); });
    }
  } else {
    if (adbSelectedMajors.includes(key)) {
      adbSelectedMajors = adbSelectedMajors.filter(k => k !== key);
    } else {
      adbSelectedMajors.push(key);
    }
  }
  updateMajorChips();
  await loadAdbData();
}

function clearAdbMajors() {
  adbSelectedMajors = [];
  adbEreOnly = false;
  updateMajorChips();
  cachedAdmissionSchools = [];
  renderAdmissionTable();
}

// 出愿库里有成员的分组 / 分组在出愿库里的成员专业
function adbGroupMembers(g) { return groupMajors(g).filter(k => ADMISSION_MAJORS[k]); }
function adbGroupKeys() { return Object.keys(MAJOR_GROUPS).filter(g => adbGroupMembers(g).length); }
function updateMajorChips() {
  adbGroupKeys().forEach(g => {
    const groupChip = document.getElementById('adb_chip_' + g);
    if (groupChip) groupChip.classList.toggle('active', adbGroupMembers(g).every(k => adbSelectedMajors.includes(k)));
  });
  Object.keys(ADMISSION_MAJORS).forEach(k => {
    const chip = document.getElementById(`adb_chip_${k}`);
    if (chip) chip.classList.toggle('active', adbSelectedMajors.includes(k));
  });
}

async function loadAdbData() {
  if (!adbSelectedMajors.length) { cachedAdmissionSchools = []; renderAdmissionTable(); return; }
  const tbody = document.getElementById('admissionTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="16" style="text-align:center;padding:20px;color:var(--text-3)">加载中…</td></tr>';
  const majorFilter = `major=in.(${adbSelectedMajors.map(m=>`"${m}"`).join(',')})`;
  cachedAdmissionSchools = await sbAll(`/rest/v1/admission_schools?select=*&${majorFilter}&order=university.asc,id.asc`).catch(() => []);
  adbOpen = new Set(); adbShown = LIST_PAGE;
  renderAdmissionTable();
}

// ── 语言筛选 ──
function setAdbMonthFrom(v) { adbMonthFrom = v; adbShown = LIST_PAGE; renderAdmissionTable(); }
function setAdbMonthTo(v) { adbMonthTo = v; adbShown = LIST_PAGE; renderAdmissionTable(); }

// 出願期間里的月份（旧名字保留，其它地方可能还在用）
function extractMonths(periodStr) { return adgRowMonths({ application_period: periodStr }); }

function adbTestChipsInner() {
  return `<span style="font-size:10px;color:var(--text-3)">英语</span>${adgTestChipsHtml('en', adbEngTests, 'toggleAdbTest')}
    <span style="font-size:10px;color:var(--text-3);margin-left:6px">日语</span>${adgTestChipsHtml('jp', adbJpTests, 'toggleAdbTest')}
    ${(adbEngTests.size||adbJpTests.size)?`<span class="filter-chip" onclick="clearAdbTests()" style="font-size:11px;padding:2px 9px;color:var(--text-3)">清除</span>`:''}`;
}
function toggleAdbTest(kind, key) {
  const set = kind === 'en' ? adbEngTests : adbJpTests;
  if (set.has(key)) set.delete(key); else set.add(key);
  adbShown = LIST_PAGE;
  const box = document.getElementById('adbTestChips'); if (box) box.innerHTML = adbTestChipsInner();
  renderAdmissionTable();
}
function clearAdbTests() {
  adbEngTests.clear(); adbJpTests.clear();
  const box = document.getElementById('adbTestChips'); if (box) box.innerHTML = adbTestChipsInner();
  renderAdmissionTable();
}

function setAdbFilter(type, val) {
  if (type === 'english') adbEnglish = val;
  else adbJapanese = val;
  // 更新按钮样式
  document.querySelectorAll('.adb-lang-btn').forEach(btn => {
    const onclick = btn.getAttribute('onclick') || '';
    const isEnglish = onclick.includes("'english'");
    const isJapanese = onclick.includes("'japanese'");
    const btnVal = onclick.match(/'([^']+)'\)$/)?.[1];
    if ((isEnglish && type === 'english') || (isJapanese && type === 'japanese')) {
      const active = btnVal === val;
      btn.classList.toggle('btn-primary', active);
      btn.classList.toggle('btn-outline', !active);
    }
  });
  adbShown = LIST_PAGE;
  renderAdmissionTable();
}

function setAdbSearch(v) { adbSearch = v; adbShown = LIST_PAGE; renderAdmissionTable(); }

// ── 过滤 / 归并 ──
function adbFilterObj() {
  return { english: adbEnglish, japanese: adbJapanese, engTests: adbEngTests, jpTests: adbJpTests,
    search: adbSearch, monthFrom: adbMonthFrom, monthTo: adbMonthTo, ere: adbEreOnly };
}
// 归并后的组（每组：大学+研究科+専攻+コース；只含有符合筛选的出愿的组）
function adbGroups() { return adgBuildGroups(cachedAdmissionSchools, adbFilterObj(), adbSortMode); }
// 符合筛选的出愿，一行一种（导出、共享用），顺序同页面
function filterAdmissionSchools() { return adgFlatten(adbGroups()); }

function adbCtx(showMajor) {
  return { admin: true, showMajor, majorMap: ADMISSION_MAJORS, open: adbOpen, toggleFn: 'adbToggleGroup',
    filterActive: adgFilterActive(adbFilterObj()), editFn: 'openAdmissionEdit', delFn: 'adbDeleteRow' };
}

function renderAdmissionTable() {
  const thead = document.getElementById('admissionThead');
  const tbody = document.getElementById('admissionTableBody');
  if (!thead || !tbody) return;

  const showMajorCol = adbSelectedMajors.length !== 1;

  // ERE按钮：只在选了经济学时显示
  const ereContainer = document.getElementById('adbEreContainer');
  const ereBtn = document.getElementById('adbEreBtn');
  const ereHint = document.getElementById('adbEreHint');
  if (ereContainer) {
    const showEre = adbSelectedMajors.includes('keizai');
    ereContainer.style.display = showEre ? 'flex' : 'none';
    if (ereBtn) {
      ereBtn.className = `btn btn-sm ${adbEreOnly ? 'btn-primary' : 'btn-outline'}`;
      ereBtn.style.cssText = 'font-size:11px;padding:3px 12px;border:1px solid var(--border)';
    }
    if (ereHint) ereHint.style.display = adbEreOnly ? 'inline' : 'none';
    if (!showEre && adbEreOnly) { adbEreOnly = false; }
  }

  const countEl = document.getElementById('adbResultCount');
  const more = document.getElementById('adbMoreBox');
  if (!cachedAdmissionSchools.length) {
    if (countEl) countEl.textContent = '请点击上方专业查看数据';
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-3)">← 请先选择专业</td></tr>';
    if (more) more.innerHTML = '';
    return;
  }
  const groups = adbGroups();
  const nRows = groups.reduce((n, g) => n + g.hit.size, 0);
  if (countEl) countEl.innerHTML = `筛选结果 <strong style="color:var(--text)">${groups.length}</strong> 所（コース）· ${nRows} 次出愿 <span style="color:var(--text-3)">· 点一行展开出愿明细</span>`;

  const ctx = adbCtx(showMajorCol);
  thead.innerHTML = adgHeadHtml(ctx);
  if (!groups.length) { tbody.innerHTML = `<tr><td colspan="${adgColCount(ctx)}" style="text-align:center;padding:20px;color:var(--text-3)">暂无数据</td></tr>`; if (more) more.innerHTML = ''; return; }
  adbGroupsView = groups.slice(0, adbShown);
  tbody.innerHTML = adgBodyHtml(adbGroupsView, ctx);
  if (more) more.innerHTML = groups.length > adbShown
    ? `<button class="btn btn-outline btn-sm" onclick="adbShown+=LIST_PAGE;renderAdmissionTable()">加载更多（还有 ${groups.length - adbShown} 所）</button>` : '';
}

function adbToggleGroup(i) {
  const g = adbGroupsView[i]; if (!g) return;
  if (adbOpen.has(g.key)) adbOpen.delete(g.key); else adbOpen.add(g.key);
  renderAdmissionTable();
}

// ── 编辑 ──
function openAdmissionAdd() {
  adbEditId = null;
  document.getElementById('admissionEditTitle').textContent = '添加学校';
  document.getElementById('adbDeleteBtn').style.display = 'none';
  ['id','university','faculty','department','course','admission_type','doc_review_period',
   'application_period','written_exam','oral_exam','result_date','english_detail',
   'japanese_detail','exam_style','notes','guideline_url','past_exam_url','staff_url','other_docs'].forEach(f => {
    const el = document.getElementById('adb_' + f); if (el) el.value = '';
  });
  ADG_EN_TESTS.forEach(k => { const el = document.getElementById('adb_et_' + k); if (el) el.value = ''; });
  ADG_JP_TESTS.forEach(k => { const el = document.getElementById('adb_jt_' + k); if (el) el.value = ''; });
  const ere0 = document.getElementById('adb_ere_available'); if (ere0) ere0.checked = false;
  ['major','type','english_required','japanese_required','recommendation','thesis'].forEach(f => {
    const el = document.getElementById('adb_' + f); if (el) el.value = '';
  });
  document.getElementById('admissionEditModal').style.display = 'flex';
}

function openAdmissionEdit(id) {
  const s = cachedAdmissionSchools.find(x => x.id === id);
  if (!s) return;
  adbEditId = id;
  document.getElementById('admissionEditTitle').textContent = `编辑：${s.university}`;
  document.getElementById('adbDeleteBtn').style.display = 'inline-flex';
  const fields = {
    id: s.id, major: s.major, university: s.university, type: s.type,
    faculty: s.faculty, department: s.department, course: s.course,
    admission_type: s.admission_type, doc_review_period: s.doc_review_period,
    application_period: s.application_period, written_exam: s.written_exam,
    oral_exam: s.oral_exam, result_date: s.result_date,
    english_required: s.english_required, english_detail: s.english_detail,
    japanese_required: s.japanese_required, japanese_detail: s.japanese_detail,
    recommendation: s.recommendation, thesis: s.thesis,
    exam_style: s.exam_style, notes: s.notes,
    guideline_url: s.guideline_url, past_exam_url: s.past_exam_url,
    staff_url: s.staff_url, other_docs: s.other_docs,
    ere_available: s.ere_available,
  };
  const et = adgTestsOf(s, 'en'), jt = adgTestsOf(s, 'jp');
  ADG_EN_TESTS.forEach(k => { const el = document.getElementById('adb_et_' + k); if (el) el.value = et[k] || ''; });
  ADG_JP_TESTS.forEach(k => { const el = document.getElementById('adb_jt_' + k); if (el) el.value = jt[k] || ''; });
  for (const [k, v] of Object.entries(fields)) {
    const el = document.getElementById('adb_' + k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v || '';
  }
  document.getElementById('admissionEditModal').style.display = 'flex';
}

function closeAdmissionEdit() {
  document.getElementById('admissionEditModal').style.display = 'none';
}

// 编辑框里的语言明细 → {考试:值}（空格子不写；全空 = null）
function adbCollectTests(prefix, keys) {
  const o = {};
  keys.forEach(k => { const v = (document.getElementById('adb_' + prefix + '_' + k)?.value || '').trim(); if (v) o[k] = v; });
  return Object.keys(o).length ? o : null;
}

async function saveAdmissionSchool() {
  const university = document.getElementById('adb_university').value.trim();
  const major = document.getElementById('adb_major').value;
  if (!university || !major) { alert('请填写大学名和专业'); return; }
  const data = {
    major, university,
    type: document.getElementById('adb_type').value,
    faculty: document.getElementById('adb_faculty').value,
    department: document.getElementById('adb_department').value,
    course: document.getElementById('adb_course').value,
    admission_type: document.getElementById('adb_admission_type').value,
    doc_review_period: document.getElementById('adb_doc_review_period').value,
    application_period: document.getElementById('adb_application_period').value,
    written_exam: document.getElementById('adb_written_exam').value,
    oral_exam: document.getElementById('adb_oral_exam').value,
    result_date: document.getElementById('adb_result_date').value,
    english_required: document.getElementById('adb_english_required').value,
    english_detail: document.getElementById('adb_english_detail').value,
    japanese_required: document.getElementById('adb_japanese_required').value,
    japanese_detail: document.getElementById('adb_japanese_detail').value,
    recommendation: document.getElementById('adb_recommendation').value,
    thesis: document.getElementById('adb_thesis').value,
    exam_style: document.getElementById('adb_exam_style').value,
    notes: document.getElementById('adb_notes').value,
    guideline_url: document.getElementById('adb_guideline_url').value,
    past_exam_url: document.getElementById('adb_past_exam_url').value,
    staff_url: document.getElementById('adb_staff_url').value,
    other_docs: document.getElementById('adb_other_docs').value,
    english_tests: adbCollectTests('et', ADG_EN_TESTS),
    japanese_tests: adbCollectTests('jt', ADG_JP_TESTS),
    ere_available: document.getElementById('adb_ere_available')?.checked || false,
    updated_at: new Date().toISOString(),
  };
  try {
    if (adbEditId) {
      await sb(`/rest/v1/admission_schools?id=eq.${adbEditId}`, 'PATCH', data);
      const idx = cachedAdmissionSchools.findIndex(x => x.id === adbEditId);
      if (idx >= 0) Object.assign(cachedAdmissionSchools[idx], data);
    } else {
      data.id = `as-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
      const res = await sb('/rest/v1/admission_schools', 'POST', [data]);
      cachedAdmissionSchools.push(Array.isArray(res) ? res[0] : data);
    }
    closeAdmissionEdit();
    renderAdmissionTable();
  } catch(e) { alert('保存失败：' + e.message); }
}

async function deleteAdmissionSchool() {
  if (!adbEditId) return;
  if (await adbDeleteRow(adbEditId)) closeAdmissionEdit();
}
// 删除一条出愿（明细里的「删除」和编辑框共用）。返回是否已删除
async function adbDeleteRow(id) {
  if (!confirm('确定删除这条记录？')) return false;
  try {
    await sb(`/rest/v1/admission_schools?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    cachedAdmissionSchools = cachedAdmissionSchools.filter(x => x.id !== id);
    renderAdmissionTable();
    return true;
  } catch(e) { alert('删除失败：' + e.message); return false; }
}

// ── 导出 Excel ──
function exportAdmissionExcel() {
  const filtered = filterAdmissionSchools();
  const showMajor = adbSelectedMajors.length !== 1;
  // 表头字段定义（空数据时也用它导出模板）
  const HEADERS = ['大学名','設置主体','研究科名','専攻名','コース名','出願類型','資格審査','出願期間','筆記試験時間','口述試験時間','合格発表時間','英語成績','日本語成績'];
  if (!filtered.length) {
    // 没数据：导出只有表头的空模板 + 一行说明
    if(!confirm('当前没有数据。是否导出【空白表头模板】供录入（其他学科可下载后按此格式填写）？')) return;
    const head = (showMajor?['专业']:[]).concat(HEADERS);
    const ws = XLSX.utils.aoa_to_sheet([head, head.map(()=>'')]); // 表头 + 一空行示意
    ws['!cols'] = head.map(k => ({ wch: ['研究科名','専攻名'].includes(k)?22:k==='大学名'?18:k==='コース名'?16:10 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '出願数据模板');
    XLSX.writeFile(wb, `出願数据_空白模板_${new Date().toISOString().slice(0,10)}.xlsx`);
    return;
  }
  const rows = filtered.map(s => {
    const row = {};
    if (showMajor) row['专业'] = ADMISSION_MAJORS[s.major] || s.major;
    row['大学名'] = s.university;
    row['設置主体'] = s.type;
    row['研究科名'] = s.faculty;
    row['専攻名'] = s.department;
    row['コース名'] = s.course;
    row['出願類型'] = s.admission_type;
    row['資格審査'] = s.doc_review_period;
    row['出願期間'] = s.application_period;
    row['筆記試験時間'] = s.written_exam;
    row['口述試験時間'] = s.oral_exam;
    row['合格発表時間'] = s.result_date;
    row['英語成績'] = s.english_required;
    row['日本語成績'] = s.japanese_required;
    if (s.major === 'keizai') row['ERE可代替笔试'] = s.ere_available ? '是' : '';
    const et = adgTestsOf(s, 'en'), jt = adgTestsOf(s, 'jp');
    ADG_EN_TESTS.forEach(k => { row['英語_' + k] = et[k] || ''; });
    ADG_JP_TESTS.forEach(k => { row['日本語_' + k] = jt[k] || ''; });
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: ['研究科名','専攻名'].includes(k)?22:k==='大学名'?18:k==='コース名'?16:10 }));
  const wb = XLSX.utils.book_new();
  const majorLabel = adbSelectedMajors.length === 1 ? (ADMISSION_MAJORS[adbSelectedMajors[0]] || adbSelectedMajors[0]) : '複数専業';
  XLSX.utils.book_append_sheet(wb, ws, majorLabel);
  XLSX.writeFile(wb, `出願数据_${majorLabel}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── 导出 HTML（可打印为 PDF）──
function exportAdmissionHtml() {
  const filtered = filterAdmissionSchools();
  const showMajor = adbSelectedMajors.length !== 1;
  const majorLabel = adbSelectedMajors.length === 1
    ? (ADMISSION_MAJORS[adbSelectedMajors[0]] || adbSelectedMajors[0])
    : adbSelectedMajors.map(m => ADMISSION_MAJORS[m]||m).join('・');
  const filterLine = buildAdmissionFilterDesc({
    english: adbEnglish, japanese: adbJapanese,
    search: adbSearch, monthFrom: adbMonthFrom, monthTo: adbMonthTo,
    engTests: adbEngTests, jpTests: adbJpTests,
    filtered,
  });
  exportAdmissionHtmlShared(filtered, { majorLabel, filterLine, showMajor, majorMap: ADMISSION_MAJORS });
}


// 导入（补缺）见 admin/admission-import.js


// ── 共享学校列表给学生 ──
function openShareToStudents() {
  const filtered = filterAdmissionSchools();
  if (!filtered.length) { alert('请先选择专业并筛选学校'); return; }
  const majorLabel = adbSelectedMajors.length === 1
    ? (ADMISSION_MAJORS[adbSelectedMajors[0]] || adbSelectedMajors[0])
    : adbSelectedMajors.map(m => ADMISSION_MAJORS[m]||m).join('・');
  const existing = document.getElementById('shareModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'shareModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  const yr = new Date().getFullYear();
  // 发布目标改用「学生实际绑定的专业」（与学生档案同一套动态专业），默认选中与出愿分类最匹配的那个
  const studentMajorKeys = (typeof majorFilterKeys === 'function') ? majorFilterKeys() : [];
  const _mlabel = k => (typeof majorLabel === 'function' ? majorLabel(k) : k) || k;
  const admFirst = adbSelectedMajors[0] || '';
  const admFirstLabel = (typeof ADMISSION_MAJORS !== 'undefined' && ADMISSION_MAJORS[admFirst]) || admFirst;
  let defBooking = studentMajorKeys.find(k => k === admFirst)
    || studentMajorKeys.find(k => { const l = _mlabel(k); return l && admFirstLabel && (l.includes(admFirstLabel) || admFirstLabel.includes(l)); })
    || (studentMajorKeys[0] || '');
  const bookingOpts = studentMajorKeys.length
    ? studentMajorKeys.map(k => `<option value="${k}"${k === defBooking ? ' selected' : ''}>${_mlabel(k)}</option>`).join('')
    : '<option value="">（无可用专业，请先在学生档案建立专业）</option>';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;max-width:460px;width:100%">
      <div style="font-size:14px;font-weight:600;margin-bottom:14px">📤 共享学校列表给学生</div>
      <div style="font-size:12px;color:var(--text-2);background:var(--bg);border-radius:3px;padding:10px;margin-bottom:14px">
        <div>专业：${majorLabel}</div>
        <div>学校数：${filtered.length} 条</div>
        <div style="margin-top:4px;font-size:11px;color:var(--text-3)">学生将在「查询学习记录」页面看到这份列表，可从中点选自己的志望校。</div>
      </div>
      <div class="form-group">
        <label class="form-label">发布到哪个学生页面 *</label>
        <select id="share_booking_major">${bookingOpts}</select>
        <div style="font-size:10px;color:var(--text-3);margin-top:3px">已按出愿分类自动匹配学生专业，如不对可手动改；学生只会在对应专业页面看到这份列表</div>
      </div>
      <div class="form-group">
        <label class="form-label">出愿季度</label>
        <select id="share_season">
          <option value="summer">夏季</option>
          <option value="winter">冬季</option>
          <option value="next_year">次年</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">年份</label>
        <input type="number" id="share_year" value="${yr}" min="2024" max="2030">
      </div>
      <div class="form-group">
        <label class="form-label">共享说明（给学生看的提示）</label>
        <textarea id="share_notes" rows="2" placeholder="例：请在截止日期前完成志望校填写，每个等级选2校，找到2位教授…"></textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button onclick="confirmShareToStudents()" style="flex:1;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:3px;padding:10px;font-size:12px;cursor:pointer;font-family:inherit">确认共享</button>
        <button onclick="document.getElementById('shareModal').remove()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:10px 14px;font-size:12px;cursor:pointer;font-family:inherit">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  // 存储当前筛选结果供确认时使用
  window._shareFilteredSchools = filtered;
  window._shareMajorLabel = majorLabel;
}

async function confirmShareToStudents() {
  const schoolIds = (window._shareFilteredSchools || []).map(s => s.id);
  const majorLabel = window._shareMajorLabel || '';
  const count = schoolIds.length;
  const bookingMajor = document.getElementById('share_booking_major').value;
  const season = document.getElementById('share_season').value;
  const year = parseInt(document.getElementById('share_year').value);
  const notes = document.getElementById('share_notes').value.trim();
  const seasonLabel = { summer:'夏季', winter:'冬季', next_year:'次年' }[season] || season;
  if (!bookingMajor) { alert('请选择发布到哪个学生页面'); return; }

  // 检查是否已有同页面同季度同年份的共享
  const existing = await sb(`/rest/v1/teacher_school_shares?major=eq.${bookingMajor}&season=eq.${season}&year=eq.${year}&select=id,title`).catch(()=>[]);

  const data = {
    id: `tss-${Date.now()}-${Math.random().toString(36).slice(2,4)}`,
    major: bookingMajor,
    season, year,
    title: `${year}年${seasonLabel} ${majorLabel} 出愿学校列表`,
    school_ids: schoolIds,
    shared_by: '管理员',
    notes,
  };

  try {
    if (existing.length) {
      if (!confirm(`已有「${existing[0].title}」，确定覆盖更新？`)) return;
      await sb(`/rest/v1/teacher_school_shares?id=eq.${existing[0].id}`, 'PATCH', { school_ids: schoolIds, notes, title: data.title });
    } else {
      await sb('/rest/v1/teacher_school_shares', 'POST', data);
    }
    document.getElementById('shareModal').remove();
    alert(`✓ 已共享 ${count} 所学校给学生。学生将在学习记录里看到这份列表。`);
  } catch(e) { alert('共享失败：' + e.message); }
}


// ══════════════════════════════════
// 出愿专业管理：从「专业管理」已建专业中选取加入（自带 key/日文名/领域），
// 特殊类型（MOT / 統計・計量 等专业管理里没有的）可手填 key。存表 admission_majors。
// ══════════════════════════════════
function openAdmMajorMgr() {
  const ex = document.getElementById('admMajorMgrModal'); if (ex) ex.remove();
  const m = document.createElement('div');
  m.id = 'admMajorMgrModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = '<div id="admMajorMgrBody" style="background:var(--surface);border-radius:6px;padding:20px;max-width:560px;width:100%;max-height:88vh;overflow-y:auto"></div>';
  document.body.appendChild(m);
  admMajorMgrRender();
}
// 只有管理员能增删出愿专业；领域链接只能看
function adbIsAdmin() { return typeof ACCESS_KEY === 'undefined' || !ACCESS_KEY || !!ACCESS_KEY.is_admin; }
function admMajorMgrRender() {
  const isAdmin = adbIsAdmin();
  const box = document.getElementById('admMajorMgrBody'); if (!box) return;
  // 现有出愿专业
  const cur = Object.entries(typeof ADMISSION_MAJORS !== 'undefined' ? ADMISSION_MAJORS : {});
  const curKeys = new Set(cur.map(([k]) => k));
  // 「专业管理」里还没加入出愿库的专业，供下拉选择
  const allMajors = (typeof MAJORS !== 'undefined') ? MAJORS : {};
  const pickable = Object.keys(allMajors)
    .filter(k => !isMajorGroup(k) && !curKeys.has(k))
    .map(k => ({ key: k, label: allMajors[k] }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  box.innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:3px">🏷 出愿专业管理</div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:14px">这里决定「出愿数据库 / 老师权限 / 老师端出愿查询」显示哪些专业。新增后即时生效、无需改代码。</div>

    ${!isAdmin ? '<div style="font-size:11px;color:var(--text-3);margin-bottom:12px">只有管理员可以新增或移除出愿专业</div>' : `<div style="border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:16px;background:var(--bg,#faf9f7)">
      <div style="font-size:12px;font-weight:600;margin-bottom:8px">＋ 新增出愿专业</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">从已建专业里选（代号自动带出）：</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <select id="adm_pick_major" style="flex:1;min-width:180px;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px">
          <option value="">— 选择专业 —</option>
          ${pickable.map(x => `<option value="${adbEsc(x.key)}">${adbEsc(x.label)}（${adbEsc(x.key)}）</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="admMajorAddFromPick()">加入</button>
      </div>
      <div style="font-size:10px;color:var(--text-3);border-top:1px dashed var(--border-light);padding-top:8px;margin-top:2px">特殊类型（如 MOT，专业管理里没有）手动添加：</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px">
        <input id="adm_new_label" placeholder="显示名（如 MOT）" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;width:140px">
        <input id="adm_new_key" placeholder="代号（如 mot）" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;width:120px">
        <button class="btn btn-outline btn-sm" onclick="admMajorAddManual()">添加</button>
      </div>
    </div>`}

    <div style="font-size:12px;font-weight:600;margin-bottom:8px">已有出愿专业（${cur.length}）</div>
    <div style="display:flex;flex-direction:column;gap:5px">
      ${cur.length ? cur.map(([k, v]) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border-light);border-radius:4px">
        <span style="font-size:12px;font-weight:500">${adbEsc(v)}</span>
        <span style="font-size:10px;color:var(--text-3)">${adbEsc(k)}</span>
        ${isAdmin ? `<button class="btn btn-outline btn-sm" style="margin-left:auto;color:#a33" onclick="admMajorDelete('${adbEsc(k)}','${adbEsc(v)}')">移除</button>` : ''}
      </div>`).join('') : '<div style="font-size:11px;color:var(--text-3)">暂无</div>'}
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('admMajorMgrModal').remove()">关闭</button>
    </div>`;
}
function adbEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

async function admMajorUpsert(key, label, domain) {
  const row = { key, label, sort_order: Object.keys(ADMISSION_MAJORS || {}).length + 1 };
  if (domain) row.domain = domain;
  await sb('/rest/v1/admission_majors', 'POST', [row]);   // 表以 key 为主键；已存在会报错，调用前先判重
}
async function admMajorAddFromPick() {
  if (!adbIsAdmin()) return;
  const key = (document.getElementById('adm_pick_major') || {}).value || '';
  if (!key) { alert('请选择一个专业'); return; }
  if (ADMISSION_MAJORS[key]) { alert('该专业已在出愿库中'); return; }
  const label = (typeof MAJORS !== 'undefined' && MAJORS[key]) || key;
  const domain = (typeof MAJOR_DOMAIN !== 'undefined' && MAJOR_DOMAIN[key]) || '';
  try {
    await admMajorUpsert(key, label, domain);
    if (typeof loadAdmissionMajorsFromDB === 'function') await loadAdmissionMajorsFromDB();
    admMajorMgrRender();
  } catch (e) { alert('添加失败：' + e.message); }
}
async function admMajorAddManual() {
  if (!adbIsAdmin()) return;
  const label = ((document.getElementById('adm_new_label') || {}).value || '').trim();
  let key = ((document.getElementById('adm_new_key') || {}).value || '').trim().toLowerCase();
  if (!label) { alert('请填显示名'); return; }
  if (!key) { alert('请填代号（小写字母/数字/下划线）'); return; }
  if (!/^[a-z][a-z0-9_]*$/.test(key)) { alert('代号只能小写字母/数字/下划线，且以字母开头'); return; }
  if (ADMISSION_MAJORS[key]) { alert('该代号已存在'); return; }
  try {
    await admMajorUpsert(key, label, '');
    if (typeof loadAdmissionMajorsFromDB === 'function') await loadAdmissionMajorsFromDB();
    admMajorMgrRender();
  } catch (e) { alert('添加失败：' + e.message); }
}
async function admMajorDelete(key, label) {
  if (!adbIsAdmin()) return;
  if (!confirm(`从出愿库移除专业「${label}」？\n\n注意：只是不再在出愿库/权限里显示该专业；已录入的该专业学校数据不会被删除。`)) return;
  try {
    await sb(`/rest/v1/admission_majors?key=eq.${key}`, 'DELETE');
    if (typeof loadAdmissionMajorsFromDB === 'function') await loadAdmissionMajorsFromDB();
    admMajorMgrRender();
  } catch (e) { alert('移除失败：' + e.message); }
}
