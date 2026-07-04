// ══════════════════════════════════
// 出願数据库
// ══════════════════════════════════

const ADMISSION_MAJORS = {
  shakai: '社会学',
  keiei: '経営学',
  keizai: '経済学',
  shinpan: '新闻传播学',
  fukushi: '社会福祉学',
  nihongo: '日本语教育',
  hyosho: '表象文化・文学・哲学',
  seiji: '政治学',
  toyo: '東洋史',
  bunka: '文化人类学',
  mot: 'MOT',
  tokei: '統計・計量',
};

const SHEET_TO_MAJOR = {
  '社会学': 'shakai', '经营学': 'keiei', '经济学': 'keizai',
  '新闻传播学': 'shinpan', '社会福祉学': 'fukushi', '日本语教育': 'nihongo',
  '表象文化・文学・哲学': 'hyosho', '政治学': 'seiji', '东洋史': 'toyo',
  '文化人类学': 'bunka', 'MOT': 'mot', 'MOT（复制用）': 'mot',
  '統計・計量在籍': 'tokei', '经营学专升硕': 'keiei', '社会学各分': 'shakai',
};

// 当前选中的专业列表（支持多选）
let adbSelectedMajors = []; // 空=未选，['shakai']单选，['shakai','shinpan','fukushi']多选
let adbEnglish = 'all', adbJapanese = 'all', adbSearch = '';
let adbMonthFrom = 0, adbMonthTo = 0;
let adbEreOnly = false; // 0=不限
let adbEditId = null;
let adbSortCol = '', adbSortDir = 1;
let adbColFilters = {}; // { col: Set of values }

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
    </div>
  </div>

  <!-- 专业筛选（支持多选） -->
  <div style="margin-bottom:6px;font-size:10px;color:var(--text-3)">点击选择专业（可多选）；点「社会人文」同时加载社会学+新闻传播+社会福祉</div>
  <div class="filter-row" style="margin-bottom:8px" id="adbMajorRow">
    <div class="filter-chip" onclick="toggleAdbMajor('shakai_group',this)" id="adb_chip_shakai_group">社会人文</div>
    ${Object.entries(ADMISSION_MAJORS).map(([k,v])=>`
      <div class="filter-chip" onclick="toggleAdbMajor('${k}',this)" id="adb_chip_${k}">${v}${majorCounts[k]?` <span style="font-size:9px;opacity:.6">${majorCounts[k]}</span>`:''}</div>
    `).join('')}
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
  ${adbSelectedMajors.includes('keizai') ? `
  <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
    <button class="btn btn-sm ${adbEreOnly?'btn-primary':'btn-outline'}" onclick="adbEreOnly=!adbEreOnly;renderAdmissionTable()" style="font-size:11px;padding:3px 12px;border:1px solid var(--border)">
      📊 ERE可代替笔试
    </button>
    ${adbEreOnly?'<span style="font-size:10px;color:var(--text-3)">仅显示可用ERE成绩代替笔记试验的学校</span>':''}
  </div>` : ''}

  <!-- 搜索 -->
  <div style="margin-bottom:10px">
    <input type="text" placeholder="搜索大学名、研究科、専攻…" value="${adbSearch}"
      oninput="if(this.dataset.composing!=='1')setAdbSearch(this.value)"
      oncompositionstart="this.dataset.composing='1'"
      oncompositionend="this.dataset.composing='';setAdbSearch(this.value)"
      style="font-size:12px;max-width:320px">
  </div>

  <!-- 结果数 -->
  <div style="font-size:11px;color:var(--text-3);margin-bottom:8px" id="adbResultCount">请点击上方专业查看数据</div>

  <!-- 表格 -->
  <div style="overflow-x:auto">
    <table class="student-table" id="admissionTable" style="font-size:11px">
      <thead id="admissionThead"></thead>
      <tbody id="admissionTableBody"></tbody>
    </table>
  </div>

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
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeAdmissionEdit()">取消</button>
        <button class="btn btn-danger btn-sm" id="adbDeleteBtn" onclick="deleteAdmissionSchool()" style="display:none">删除</button>
        <button class="btn btn-primary" onclick="saveAdmissionSchool()">保存</button>
      </div>
    </div>
  </div>

  <!-- 导入 modal -->
  <div class="modal-overlay" id="admissionImportModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;align-items:center;justify-content:center;padding:16px">
    <div class="modal" style="width:560px">
      <div class="modal-title">导入 Excel</div>
      <div style="font-size:11px;color:var(--text-2);margin-bottom:12px;line-height:1.8">
        上传格式与原始数据 Excel 相同的文件，系统按 sheet 名自动识别专业。
      </div>
      <div class="form-group"><label class="form-label">选择文件</label>
        <input type="file" id="admissionImportFile" accept=".xlsx,.xls"></div>
      <div id="admissionImportPreview" style="margin-top:10px;font-size:11px;color:var(--text-2)"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeAdmissionImport()">取消</button>
        <button class="btn btn-primary" id="admissionImportBtn" onclick="confirmAdmissionImport()">确认导入</button>
      </div>
    </div>
  </div>`;

  renderAdmissionTable();
}

// ── 专业多选 ──
async function toggleAdbMajor(key, el) {
  if (key === 'shakai_group') {
    // 社会人文：切换 shakai+shinpan+fukushi 整体
    const groupKeys = ['shakai','shinpan','fukushi'];
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

function updateMajorChips() {
  const groupKeys = ['shakai','shinpan','fukushi'];
  const groupActive = groupKeys.every(k => adbSelectedMajors.includes(k));
  const groupChip = document.getElementById('adb_chip_shakai_group');
  if (groupChip) groupChip.classList.toggle('active', groupActive);
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
  cachedAdmissionSchools = await sb(`/rest/v1/admission_schools?select=*&${majorFilter}&order=university.asc&limit=5000`).catch(() => []);
  adbColFilters = {};
  adbSortCol = '';
  renderAdmissionTable();
}

// ── 语言筛选 ──
function setAdbMonthFrom(v) { adbMonthFrom = v; renderAdmissionTable(); }
function setAdbMonthTo(v) { adbMonthTo = v; renderAdmissionTable(); }

// 从出願期間字符串提取月份数字列表（例："5月上旬" → [5]，"5月上旬まで" → [5]）
function extractMonths(periodStr) {
  if (!periodStr) return [];
  const matches = periodStr.match(/(\d{1,2})月/g);
  if (!matches) return [];
  return matches.map(m => parseInt(m));
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
  renderAdmissionTable();
}

function setAdbSearch(v) { adbSearch = v; renderAdmissionTable(); }

// ── 过滤 ──
function filterAdmissionSchools() {
  let list = cachedAdmissionSchools;
  if (adbEnglish !== 'all') list = list.filter(s => s.english_required === adbEnglish);
  if (adbJapanese !== 'all') list = list.filter(s => s.japanese_required === adbJapanese);
  if (adbSearch.trim()) {
    const q = adbSearch.trim().toLowerCase();
    list = list.filter(s => (s.university||'').toLowerCase().includes(q) || (s.faculty||'').toLowerCase().includes(q) || (s.department||'').toLowerCase().includes(q) || (s.admission_type||'').toLowerCase().includes(q));
  }
  // 出願月份范围筛选
  if (adbMonthFrom || adbMonthTo) {
    list = list.filter(s => {
      const months = extractMonths(s.application_period);
      if (!months.length) return false;
      const minM = Math.min(...months), maxM = Math.max(...months);
      if (adbMonthFrom && maxM < adbMonthFrom) return false;
      if (adbMonthTo && minM > adbMonthTo) return false;
      return true;
    });
  }
  // ERE筛选
  if (adbEreOnly) list = list.filter(s => s.ere_available === true);
  // 列筛选
  Object.entries(adbColFilters).forEach(([col, vals]) => {
    if (vals && vals.size) list = list.filter(s => vals.has(s[col]||''));
  });
  // 排序
  if (adbSortCol) {
    list = [...list].sort((a,b) => {
      const av = a[adbSortCol]||'', bv = b[adbSortCol]||'';
      return av.localeCompare(bv, 'ja') * adbSortDir;
    });
  }
  return list;
}

// ── 表格渲染（带列头筛选/排序） ──
const ADB_COLS = [
  { key:'university', label:'大学名', width:'120px' },
  { key:'type', label:'性质', width:'54px' },
  { key:'faculty', label:'研究科', width:'140px' },
  { key:'department', label:'専攻', width:'100px' },
  { key:'admission_type', label:'出願類型', width:'80px' },
  { key:'doc_review_period', label:'資格審査', width:'80px' },
  { key:'application_period', label:'出願期間', width:'80px' },
  { key:'written_exam', label:'筆記試験', width:'80px' },
  { key:'oral_exam', label:'口述試験', width:'72px' },
  { key:'result_date', label:'合格発表', width:'72px' },
  { key:'english_required', label:'英語', width:'54px' },
  { key:'japanese_required', label:'日語', width:'54px' },
  { key:'recommendation', label:'推薦状', width:'54px' },
  { key:'thesis', label:'卒論', width:'54px' },
  { key:'exam_style', label:'試験方式', width:'90px' },
  { key:'ere_available', label:'ERE', width:'44px' },
];

function renderAdmissionTable() {
  const thead = document.getElementById('admissionThead');
  const tbody = document.getElementById('admissionTableBody');
  if (!thead || !tbody) return;

  const showMajorCol = adbSelectedMajors.length !== 1;
  const filtered = filterAdmissionSchools();

  const countEl = document.getElementById('adbResultCount');
  if (!cachedAdmissionSchools.length) {
    if (countEl) countEl.textContent = '请点击上方专业查看数据';
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="16" style="text-align:center;padding:40px;color:var(--text-3)">← 请先选择专业</td></tr>';
    return;
  }
  if (countEl) countEl.innerHTML = `筛选结果 <strong style="color:var(--text)">${filtered.length}</strong> 条`;

  // 构建列头（含排序箭头和筛选下拉）
  const cols = showMajorCol ? [{ key:'major', label:'专业', width:'72px' }, ...ADB_COLS] : ADB_COLS;
  thead.innerHTML = `<tr>${cols.map(c => {
    const sortArrow = adbSortCol===c.key ? (adbSortDir===1?'▲':'▼') : '⇅';
    // 收集该列的唯一值用于筛选
    const uniqueVals = [...new Set(cachedAdmissionSchools.map(s => s[c.key]||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
    const hasFilter = adbColFilters[c.key] && adbColFilters[c.key].size;
    const filterIcon = uniqueVals.length > 1 ? `<span onclick="event.stopPropagation();openColFilter('${c.key}',this)" style="cursor:pointer;color:${hasFilter?'var(--accent)':'var(--text-3)'};margin-left:3px;font-size:10px">▾</span>` : '';
    return `<th style="min-width:${c.width};cursor:pointer;user-select:none;white-space:nowrap" onclick="adbSort('${c.key}')">
      ${c.label} <span style="font-size:9px;color:var(--text-3)">${sortArrow}</span>${filterIcon}
    </th>`;
  }).join('')}<th style="width:50px"></th></tr>`;

  if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="${cols.length+1}" style="text-align:center;padding:20px;color:var(--text-3)">暂无数据</td></tr>`; return; }

  const engColor = v => v==='必須'?'var(--accent)':v==='任意'?'var(--warn)':'var(--text-3)';

  tbody.innerHTML = filtered.map(s => {
    const majorCell = showMajorCol ? `<td style="font-size:10px;color:var(--text-2)">${ADMISSION_MAJORS[s.major]||s.major}</td>` : '';
    return `<tr style="cursor:pointer" onclick="openAdmissionEdit('${s.id}')">
      ${majorCell}
      <td style="font-weight:500">${s.university||''}</td>
      <td><span style="font-size:10px;background:${s.type==='国立'?'#e8f0fb':s.type==='公立'?'#e8f5e9':'var(--bg)'};border:1px solid var(--border-light);border-radius:2px;padding:1px 4px">${s.type||''}</span></td>
      <td>${s.faculty||''}</td>
      <td>${s.department||''}</td>
      <td style="color:var(--text-2)">${s.admission_type||''}</td>
      <td style="color:var(--text-2)">${s.doc_review_period||''}</td>
      <td>${s.application_period||''}</td>
      <td style="color:var(--text-2)">${s.written_exam||''}</td>
      <td style="color:var(--text-2)">${s.oral_exam||''}</td>
      <td style="color:var(--text-2)">${s.result_date||''}</td>
      <td><span style="font-weight:600;color:${engColor(s.english_required)}">${s.english_required||'-'}</span></td>
      <td><span style="font-weight:600;color:${engColor(s.japanese_required)}">${s.japanese_required||'-'}</span></td>
      <td style="color:var(--text-2)">${s.recommendation||'-'}</td>
      <td style="color:var(--text-2)">${s.thesis||'-'}</td>
      <td style="color:var(--text-2);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.exam_style||''}</td>
      <td style="text-align:center">${s.ere_available?'<span style="font-size:11px;color:var(--ok);font-weight:700">✓</span>':''}</td>
      <td onclick="event.stopPropagation()" style="white-space:nowrap">
        ${s.guideline_url?`<a href="${s.guideline_url}" target="_blank" style="font-size:10px;color:var(--accent);margin-right:4px">要项</a>`:''}
        ${s.past_exam_url?`<a href="${s.past_exam_url}" target="_blank" style="font-size:10px;color:var(--accent)">过去问</a>`:''}
      </td>
    </tr>`;
  }).join('');
}

function adbSort(col) {
  if (adbSortCol === col) adbSortDir *= -1;
  else { adbSortCol = col; adbSortDir = 1; }
  renderAdmissionTable();
}

// 列筛选下拉
function openColFilter(col, btn) {
  document.querySelectorAll('.adb-col-filter-popup').forEach(p => p.remove());
  const uniqueVals = [...new Set(cachedAdmissionSchools.map(s => s[col]||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja'));
  const current = adbColFilters[col] || new Set();
  const popup = document.createElement('div');
  popup.className = 'adb-col-filter-popup';
  popup.style.cssText = 'position:absolute;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:8px;z-index:9999;min-width:140px;max-height:260px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.12)';
  popup.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:6px">
      <span style="font-size:11px;font-weight:600">筛选</span>
      <button onclick="clearColFilter('${col}')" style="font-size:10px;background:none;border:none;color:var(--accent);cursor:pointer">清除</button>
    </div>
    ${uniqueVals.map(v=>`
      <label style="display:flex;align-items:center;gap:6px;font-size:11px;padding:3px 0;cursor:pointer">
        <input type="checkbox" ${current.has(v)?'checked':''} onchange="toggleColFilter('${col}','${v.replace(/'/g,"\\'")}',this.checked)" style="accent-color:var(--accent)">
        ${v}
      </label>
    `).join('')}`;
  const rect = btn.getBoundingClientRect();
  popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  popup.style.left = (rect.left + window.scrollX) + 'px';
  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('click', function closeFilter(e) {
    if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', closeFilter); }
  }), 10);
}

function toggleColFilter(col, val, checked) {
  if (!adbColFilters[col]) adbColFilters[col] = new Set();
  if (checked) adbColFilters[col].add(val);
  else adbColFilters[col].delete(val);
  if (!adbColFilters[col].size) delete adbColFilters[col];
  renderAdmissionTable();
}

function clearColFilter(col) {
  delete adbColFilters[col];
  document.querySelectorAll('.adb-col-filter-popup').forEach(p => p.remove());
  renderAdmissionTable();
}

// ── 编辑 ──
function openAdmissionAdd() {
  adbEditId = null;
  document.getElementById('admissionEditTitle').textContent = '添加学校';
  document.getElementById('adbDeleteBtn').style.display = 'none';
  ['id','university','faculty','department','course','admission_type','doc_review_period',
   'application_period','written_exam','oral_exam','result_date','english_detail',
   'japanese_detail','exam_style','notes','guideline_url','past_exam_url'].forEach(f => {
    const el = document.getElementById('adb_' + f); if (el) el.value = '';
  });
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
    ere_available: s.ere_available,
  };
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
  if (!adbEditId || !confirm('确定删除这条记录？')) return;
  try {
    await sb(`/rest/v1/admission_schools?id=eq.${adbEditId}`, 'DELETE');
    cachedAdmissionSchools = cachedAdmissionSchools.filter(x => x.id !== adbEditId);
    closeAdmissionEdit();
    renderAdmissionTable();
  } catch(e) { alert('删除失败：' + e.message); }
}

// ── 导出 Excel ──
function exportAdmissionExcel() {
  const filtered = filterAdmissionSchools();
  if (!filtered.length) { alert('没有可导出的数据'); return; }
  const showMajor = adbSelectedMajors.length !== 1;
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
  if (!filtered.length) { alert('没有可导出的数据'); return; }
  const showMajor = adbSelectedMajors.length !== 1;
  const majorLabel = adbSelectedMajors.length === 1
    ? (ADMISSION_MAJORS[adbSelectedMajors[0]] || adbSelectedMajors[0])
    : adbSelectedMajors.map(m => ADMISSION_MAJORS[m]||m).join('・');
  const today = new Date().toLocaleDateString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit'});

  // 筛选条件描述
  const filterDesc = [];
  if (adbEnglish !== 'all') filterDesc.push(`英语：${adbEnglish==='必須'?'必须':adbEnglish==='任意'?'任意':'不要'}`);
  if (adbJapanese !== 'all') filterDesc.push(`日语：${adbJapanese==='必須'?'必须':adbJapanese==='任意'?'任意':'不要'}`);
  if (adbSearch.trim()) filterDesc.push(`关键词：${adbSearch.trim()}`);
  if (adbMonthFrom || adbMonthTo) {
    const from = adbMonthFrom ? `${adbMonthFrom}月` : '不限';
    const to = adbMonthTo ? `${adbMonthTo}月` : '不限';
    filterDesc.push(`出願：${from}～${to}`);
  }
  // 出願期間范围（从筛选结果中提取月份）
  const periods = filtered.map(s => s.application_period||'').filter(Boolean);
  const monthNums = [];
  periods.forEach(p => { const m = p.match(/(\d+)月/g); if(m) m.forEach(x => monthNums.push(parseInt(x))); });
  if (monthNums.length) {
    const mn = Math.min(...monthNums), mx = Math.max(...monthNums);
    filterDesc.push(mn===mx ? `出願：${mn}月` : `出願：${mn}月～${mx}月`);
  }
  const filterLine = filterDesc.length ? filterDesc.join('　|　') : '全部';

  // 列定义：[label, width, color-group]
  // color-group: school=学校信息, time=时间, lang=语言
  const colDefs = [
    ...(showMajor ? [['专业','56px','school']] : []),
    ['大学名','108px','school'],
    ['設置主体','40px','school'],
    ['研究科名','136px','school'],
    ['専攻名','96px','school'],
    ['コース名','88px','school'],
    ['出願類型','68px','time'],
    ['資格審査','68px','time'],
    ['出願期間','68px','time'],
    ['筆記試験','68px','time'],
    ['口述試験','68px','time'],
    ['合格発表','68px','time'],
    ['英語','42px','lang'],
    ['日語','42px','lang'],
  ];

  // 表头颜色
  const thColors = {
    school: { bg:'#2c4a7c', border:'#1e3560' },
    time:   { bg:'#3d6b4f', border:'#2a4d38' },
    lang:   { bg:'#7c4a2c', border:'#5e3520' },
  };

  const engColor = v => v==='必須'?'#1a56a0':v==='任意'?'#b45309':'#888';

  const rows = filtered.map((s,i) => `<tr class="${i%2===1?'even':''}">
    ${showMajor ? `<td>${ADMISSION_MAJORS[s.major]||s.major}</td>` : ''}
    <td class="bold">${s.university||''}</td>
    <td class="center">${s.type||''}</td>
    <td>${s.faculty||''}</td>
    <td>${s.department||''}</td>
    <td>${s.course||''}</td>
    <td>${s.admission_type||''}</td>
    <td>${s.doc_review_period||''}</td>
    <td>${s.application_period||''}</td>
    <td>${s.written_exam||''}</td>
    <td>${s.oral_exam||''}</td>
    <td>${s.result_date||''}</td>
    <td class="center" style="color:${engColor(s.english_required)};font-weight:700">${s.english_required||'-'}</td>
    <td class="center" style="color:${engColor(s.japanese_required)};font-weight:700">${s.japanese_required||'-'}</td>
  </tr>`).join('');

  const theadCells = colDefs.map(([l,,g]) =>
    `<th style="background:${thColors[g].bg};border-color:${thColors[g].border}">${l}</th>`
  ).join('');

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>${majorLabel} 出願学校名单 ${today}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Hiragino Sans','Noto Sans JP','Yu Gothic','MS Gothic',sans-serif; font-size: 11px; color: #222; background: #fff; padding: 20px; }
  .title-block { margin-bottom: 14px; border-left: 4px solid #2c4a7c; padding-left: 10px; }
  h1 { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
  .meta { font-size: 11px; color: #555; margin-bottom: 3px; }
  .filters { font-size: 11px; color: #2c4a7c; background: #eef3fb; border-radius: 3px; padding: 4px 8px; display: inline-block; margin-top: 4px; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; margin-top: 12px; }
  th { padding: 6px 4px; text-align: left; font-size: 10px; font-weight: 700; color: #fff; border: 1px solid #ccc; white-space: nowrap; }
  td { padding: 5px 4px; border: 1px solid #ddd; vertical-align: top; word-break: break-all; line-height: 1.5; font-size: 11px; }
  tr.even td { background: #f4f7fb; }
  .bold { font-weight: 700; }
  .center { text-align: center; }
  ${colDefs.map(([,w],i) => `col:nth-child(${i+1}){width:${w}}`).join('')}
  /* 水印 */
  #wm { position:fixed; top:0; left:0; right:0; bottom:0; pointer-events:none; z-index:9999; overflow:hidden; }
  #wm span { position:absolute; font-size:16px; font-weight:700; color:rgba(0,0,0,0.07); white-space:nowrap; transform:rotate(-35deg); letter-spacing:3px; font-family:sans-serif; }
  @page { size: A3 landscape; margin: 12mm; }
  @media print {
    body { padding: 0; font-size: 10px; }
    td { font-size: 10px; padding: 4px 3px; }
    th { font-size: 9px; padding: 5px 3px; }
    .title-block { margin-bottom: 10px; }
    #wm { position: fixed; }
  }
</style></head><body>
<div class="title-block">
  <h1>${majorLabel} 可出願学校名单</h1>
  <div class="meta">唯新教育 · ${today} · 共 ${filtered.length} 条</div>
  <div class="filters">筛选条件：${filterLine}</div>
</div>
<table>
  <colgroup>${colDefs.map(([,w]) => `<col style="width:${w}">`).join('')}</colgroup>
  <thead><tr>${theadCells}</tr></thead>
  <tbody>${rows}</tbody>
</table>

<div style="margin-top:20px;padding:12px 14px;border:1px solid #ddd;border-radius:4px;background:#fafafa;font-size:10px;color:#666;line-height:1.9">
  <div style="font-weight:700;color:#444;margin-bottom:6px">📌 使用说明</div>
  <div>・<strong>旬的参考时间</strong>：上旬约为1日～10日，中旬约为11日～20日，下旬约为21日～月末。实际截止日期以各校官方募集要项为准。</div>
  <div>・<strong>出愿信息每年均有变化</strong>，本表格仅供参考，具体出愿期间、考试日程、募集人数等信息请务必确认当年度各校最新出愿要项。</div>
  <div>・<strong>语言成绩要求</strong>：各校对语言考试类型（JLPT / EJU / TOEFL / IELTS 等）及分数要求不同，部分学校另有内部要求，请以官方要项为准。</div>
  <div>・如有疑问请联系唯新教育老师确认。</div>
</div>
<div id="wm"></div>
<script>
(function(){
  var wm=document.getElementById('wm');
  var text='唯新教育  TRANSFORM EDUCATION';
  for(var y=-100;y<1000;y+=100){
    for(var x=-200;x<1600;x+=320){
      var s=document.createElement('span');
      s.textContent=text;
      s.style.left=x+'px';
      s.style.top=y+'px';
      wm.appendChild(s);
    }
  }
})();
</script>
</body></html>`;


  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `出願名单_${majorLabel}_${today.replace(/\//g,'-')}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── 导入 Excel ──
let admissionImportData = [];

function openAdmissionImport() {
  admissionImportData = [];
  document.getElementById('admissionImportFile').value = '';
  document.getElementById('admissionImportPreview').innerHTML = '';
  document.getElementById('admissionImportModal').style.display = 'flex';
}
function closeAdmissionImport() {
  document.getElementById('admissionImportModal').style.display = 'none';
}

document.addEventListener('change', function(e) {
  if (e.target.id !== 'admissionImportFile') return;
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById('admissionImportPreview');
  preview.innerHTML = '解析中…';
  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'array' });
      admissionImportData = [];
      const results = [];
      wb.SheetNames.forEach(sheetName => {
        const major = SHEET_TO_MAJOR[sheetName];
        if (!major) { results.push(`⚠ 跳过：${sheetName}`); return; }
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        let count = 0;
        const normalizeReq = v => {
          if (!v) return '不要';
          v = v.toString().trim();
          if (v === '必要' || v === '必須') return '必須';
          if (v === '任意') return '任意';
          if (v === '不要') return '不要';
          return v || '不要';
        };
        rows.forEach(row => {
          const university = (row['大学名'] || row['大学'] || '').toString().trim();
          if (!university) return;
          admissionImportData.push({
            id: `as-${Date.now()}-${Math.random().toString(36).slice(2,6)}-${count}`,
            major, university,
            type: (row['設置主体'] || '').toString().trim(),
            faculty: (row['研究科名'] || '').toString().trim(),
            department: (row['専攻名'] || '').toString().trim(),
            course: (row['コース名'] || '').toString().trim(),
            admission_type: (row['出願類型'] || '').toString().trim(),
            doc_review_period: (row['資格審査'] || row['資格審査期間'] || '').toString().trim(),
            application_period: (row['出願期間'] || '').toString().trim(),
            written_exam: (row['筆記試験時間'] || '').toString().trim(),
            oral_exam: (row['口述試験時間'] || '').toString().trim(),
            result_date: (row['合格発表時間'] || '').toString().trim(),
            english_required: normalizeReq(row['英語成績']),
            english_detail: '',
            japanese_required: normalizeReq(row['日本語成績']),
            japanese_detail: '',
            recommendation: normalizeReq(row['推薦状']),
            thesis: normalizeReq(row['卒業論文']),
            other_docs: (row['その他書類'] || '').toString().trim(),
            exam_style: (row['試験方式'] || '').toString().trim(),
            notes: (row['備考'] || '').toString().trim(),
            guideline_url: (row['募集要項URL'] || '').toString().trim(),
            past_exam_url: (row['過去問URL'] || '').toString().trim(),
          });
          count++;
        });
        results.push(`✓ ${sheetName}（${ADMISSION_MAJORS[major]||major}）：${count} 条`);
      });
      preview.innerHTML = `<div style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:10px;line-height:2">${results.join('<br>')}</div><div style="margin-top:6px;color:var(--text-3)">共 <strong>${admissionImportData.length}</strong> 条待导入</div>`;
    } catch(err) {
      preview.innerHTML = `<span style="color:var(--danger)">解析失败：${err.message}</span>`;
    }
  };
  reader.readAsArrayBuffer(file);
});

async function confirmAdmissionImport() {
  if (!admissionImportData.length) { alert('请先选择文件'); return; }
  const btn = document.getElementById('admissionImportBtn');
  btn.textContent = '导入中…'; btn.disabled = true;
  let successCount = 0;
  try {
    for (let i = 0; i < admissionImportData.length; i += 100) {
      const batch = admissionImportData.slice(i, i + 100);
      btn.textContent = `导入中… ${i}/${admissionImportData.length}`;
      await sb('/rest/v1/admission_schools', 'POST', batch);
      successCount += batch.length;
    }
    closeAdmissionImport();
    alert(`导入完成：成功 ${successCount} 条`);
    // 刷新 major counts
    const majorRows = await sb('/rest/v1/admission_schools?select=major&limit=10000').catch(()=>[]);
    cachedAdmissionMajorCounts = {};
    majorRows.forEach(r => { cachedAdmissionMajorCounts[r.major] = (cachedAdmissionMajorCounts[r.major]||0)+1; });
    renderAdmissionDbPage(document.getElementById('mainContent'));
  } catch(e) {
    alert(`导入中断（已成功 ${successCount} 条）：${e.message}`);
    if (successCount > 0) renderAdmissionDbPage(document.getElementById('mainContent'));
  } finally {
    btn.textContent = '确认导入'; btn.disabled = false;
  }
}
