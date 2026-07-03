// ══════════════════════════════════
// 出願数据库
// ══════════════════════════════════

const ADMISSION_MAJORS = {
  shakai: '社会学',
  keiei: '経営学',
  keizai: '経済学',
  shinpan: '新闻传播学',
  fukushi: '社会福祉学',
  shakai_group: '社会人文',
  nihongo: '日本语教育',
  hyosho: '表象文化・文学・哲学',
  seiji: '政治学',
  toyo: '東洋史',
  bunka: '文化人类学',
  mot: 'MOT',
  tokei: '統計・計量',
};

// Excel sheet名 → major key 映射
const SHEET_TO_MAJOR = {
  '社会学': 'shakai',
  '经营学': 'keiei',
  '经济学': 'keizai',
  '新闻传播学': 'shinpan',
  '社会福祉学': 'fukushi',
  '日本语教育': 'nihongo',
  '表象文化・文学・哲学': 'hyosho',
  '政治学': 'seiji',
  '东洋史': 'toyo',
  '文化人类学': 'bunka',
  'MOT': 'mot',
  'MOT（复制用）': 'mot',
  '統計・計量在籍': 'tokei',
  '经营学专升硕': 'keiei',
  '社会学各分': 'shakai',
};

let adbMajor = 'all', adbEnglish = 'all', adbJapanese = 'all', adbSearch = '';
let adbEditId = null;

function renderAdmissionDbPage(mc) {
  const majorCounts = {};
  cachedAdmissionSchools.forEach(s => {
    majorCounts[s.major] = (majorCounts[s.major] || 0) + 1;
  });

  let filtered = filterAdmissionSchools();

  mc.innerHTML = `
  <div class="page-header">
    <div class="section-title">出願数据库 <span class="badge-count">${cachedAdmissionSchools.length}</span></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="openAdmissionImport()">↑ 导入 Excel</button>
      <button class="btn btn-outline btn-sm" onclick="openAdmissionAdd()">＋ 添加</button>
      <button class="btn btn-outline btn-sm" onclick="exportAdmissionExcel()">↓ 导出筛选结果</button>
    </div>
  </div>

  <!-- 专业筛选 -->
  <div class="filter-row" style="margin-bottom:8px" id="adbMajorRow">
    <div class="filter-chip${adbMajor==='all'?' active':''}" onclick="setAdbMajor('all',this)">全部专业</div>
    ${Object.entries(ADMISSION_MAJORS).filter(([k])=>majorCounts[k]).map(([k,v])=>`
      <div class="filter-chip${adbMajor===k?' active':''}" onclick="setAdbMajor('${k}',this)">${v} <span style="font-size:9px;opacity:.6">${majorCounts[k]||0}</span></div>
    `).join('')}
  </div>

  <!-- 筛选条件 -->
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
    <div style="font-size:11px;color:var(--text-3)">英语成绩</div>
    ${['all','必須','任意','不要'].map((v,i)=>`<div class="filter-chip${adbEnglish===v?' active':''}" onclick="setAdbFilter('english','${v}',this)" style="font-size:11px;padding:3px 10px">${['全部','必须','任意','不要'][i]}</div>`).join('')}
    <div style="width:1px;height:18px;background:var(--border);margin:0 4px"></div>
    <div style="font-size:11px;color:var(--text-3)">日语成绩</div>
    ${['all','必須','任意','不要'].map((v,i)=>`<div class="filter-chip${adbJapanese===v?' active':''}" onclick="setAdbFilter('japanese','${v}',this)" style="font-size:11px;padding:3px 10px">${['全部','必须','任意','不要'][i]}</div>`).join('')}
  </div>

  <!-- 搜索 -->
  <div style="margin-bottom:10px">
    <input type="text" placeholder="搜索大学名、研究科…" value="${adbSearch}" oninput="adbSearch=this.value;renderAdmissionTable()" style="font-size:12px;max-width:320px">
  </div>

  <!-- 结果数 -->
  <div style="font-size:11px;color:var(--text-3);margin-bottom:8px">筛选结果 <strong style="color:var(--text)">${filtered.length}</strong> 条</div>

  <!-- 表格 -->
  <div style="overflow-x:auto">
    <table class="student-table" id="admissionTable">
      <thead><tr>
        <th style="min-width:80px">专业</th>
        <th style="min-width:120px">大学名</th>
        <th style="min-width:60px">性质</th>
        <th style="min-width:140px">研究科</th>
        <th style="min-width:100px">専攻</th>
        <th style="min-width:80px">出願類型</th>
        <th style="min-width:90px">出願期間</th>
        <th style="min-width:80px">筆記試験</th>
        <th style="min-width:80px">口述試験</th>
        <th style="min-width:80px">合格発表</th>
        <th style="min-width:60px">英語</th>
        <th style="min-width:60px">日語</th>
        <th style="min-width:60px">推薦状</th>
        <th style="min-width:60px">卒論</th>
        <th style="min-width:80px">試験方式</th>
        <th style="min-width:50px"></th>
      </tr></thead>
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
        <div class="form-group" style="margin:0"><label class="form-label">出願期間</label><input id="adb_application_period" placeholder="5月上旬まで"></div>
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
        上传格式与原始数据 Excel 相同的文件。系统会按 sheet 名自动识别专业。<br>
        每个 sheet 第一行为列名，第二行起为数据。<br>
        <strong>同大学+研究科+出願類型完全相同的记录会跳过（不覆盖）。</strong>
      </div>
      <div class="form-group"><label class="form-label">选择专业 Excel 文件</label>
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

function filterAdmissionSchools() {
  let list = cachedAdmissionSchools;
  if (adbMajor !== 'all') list = list.filter(s => s.major === adbMajor);
  if (adbEnglish !== 'all') list = list.filter(s => s.english_required === adbEnglish);
  if (adbJapanese !== 'all') list = list.filter(s => s.japanese_required === adbJapanese);
  if (adbSearch.trim()) {
    const q = adbSearch.trim().toLowerCase();
    list = list.filter(s => (s.university||'').toLowerCase().includes(q) || (s.faculty||'').toLowerCase().includes(q) || (s.department||'').toLowerCase().includes(q));
  }
  return list;
}

function renderAdmissionTable() {
  const tbody = document.getElementById('admissionTableBody');
  if (!tbody) return;
  const filtered = filterAdmissionSchools();
  if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="16" style="text-align:center;padding:20px;color:var(--text-3)">暂无数据</td></tr>`; return; }

  tbody.innerHTML = filtered.map(s => {
    const engColor = s.english_required==='必須'?'var(--accent)':s.english_required==='任意'?'var(--warn)':'var(--text-3)';
    const jpColor = s.japanese_required==='必須'?'var(--accent)':s.japanese_required==='任意'?'var(--warn)':'var(--text-3)';
    return `<tr style="cursor:pointer" onclick="openAdmissionEdit('${s.id}')">
      <td style="font-size:10px">${ADMISSION_MAJORS[s.major]||s.major}</td>
      <td style="font-weight:500">${s.university||''}</td>
      <td><span style="font-size:10px;background:${s.type==='国立'?'#e8f0fb':s.type==='公立'?'#e8f5e9':'var(--bg)'};border:1px solid var(--border-light);border-radius:2px;padding:1px 5px">${s.type||''}</span></td>
      <td style="font-size:11px">${s.faculty||''}</td>
      <td style="font-size:11px">${s.department||''}</td>
      <td style="font-size:10px">${s.admission_type||''}</td>
      <td style="font-size:11px">${s.application_period||''}</td>
      <td style="font-size:11px;color:var(--text-2)">${s.written_exam||''}</td>
      <td style="font-size:11px;color:var(--text-2)">${s.oral_exam||''}</td>
      <td style="font-size:11px;color:var(--text-2)">${s.result_date||''}</td>
      <td><span style="font-size:11px;color:${engColor};font-weight:600">${s.english_required||'-'}</span></td>
      <td><span style="font-size:11px;color:${jpColor};font-weight:600">${s.japanese_required||'-'}</span></td>
      <td style="font-size:11px;color:var(--text-2)">${s.recommendation||'-'}</td>
      <td style="font-size:11px;color:var(--text-2)">${s.thesis||'-'}</td>
      <td style="font-size:10px;color:var(--text-2);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.exam_style||''}</td>
      <td onclick="event.stopPropagation()">
        ${s.guideline_url?`<a href="${s.guideline_url}" target="_blank" style="font-size:10px;color:var(--accent);margin-right:4px">要项</a>`:''}
        ${s.past_exam_url?`<a href="${s.past_exam_url}" target="_blank" style="font-size:10px;color:var(--accent)">过去问</a>`:''}
      </td>
    </tr>`;
  }).join('');
}

function setAdbMajor(m, el) {
  adbMajor = m;
  document.querySelectorAll('#adbMajorRow .filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderAdmissionTable();
}

function setAdbFilter(type, val, el) {
  if (type === 'english') adbEnglish = val;
  else adbJapanese = val;
  el.closest('div').querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderAdmissionTable();
}

// ── 编辑 ──
function openAdmissionAdd() {
  adbEditId = null;
  document.getElementById('admissionEditTitle').textContent = '添加学校';
  document.getElementById('adbDeleteBtn').style.display = 'none';
  ['id','university','faculty','department','course','admission_type','application_period',
   'written_exam','oral_exam','result_date','english_detail','japanese_detail','exam_style','notes',
   'guideline_url','past_exam_url'].forEach(f => {
    const el = document.getElementById('adb_' + f);
    if (el) el.value = '';
  });
  ['major','type','english_required','japanese_required','recommendation','thesis'].forEach(f => {
    const el = document.getElementById('adb_' + f);
    if (el) el.value = '';
  });
  const m = document.getElementById('admissionEditModal');
  m.style.display = 'flex';
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
    admission_type: s.admission_type, application_period: s.application_period,
    written_exam: s.written_exam, oral_exam: s.oral_exam, result_date: s.result_date,
    english_required: s.english_required, english_detail: s.english_detail,
    japanese_required: s.japanese_required, japanese_detail: s.japanese_detail,
    recommendation: s.recommendation, thesis: s.thesis,
    exam_style: s.exam_style, notes: s.notes,
    guideline_url: s.guideline_url, past_exam_url: s.past_exam_url,
  };
  for (const [k, v] of Object.entries(fields)) {
    const el = document.getElementById('adb_' + k);
    if (el) el.value = v || '';
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
    renderAdmissionDbPage(document.getElementById('mainContent'));
  } catch(e) { alert('保存失败：' + e.message); }
}

async function deleteAdmissionSchool() {
  if (!adbEditId || !confirm('确定删除这条记录？')) return;
  try {
    await sb(`/rest/v1/admission_schools?id=eq.${adbEditId}`, 'DELETE');
    cachedAdmissionSchools = cachedAdmissionSchools.filter(x => x.id !== adbEditId);
    closeAdmissionEdit();
    renderAdmissionDbPage(document.getElementById('mainContent'));
  } catch(e) { alert('删除失败：' + e.message); }
}

// ── 导出 Excel ──
function exportAdmissionExcel() {
  const filtered = filterAdmissionSchools();
  if (!filtered.length) { alert('没有可导出的数据'); return; }
  const rows = filtered.map(s => ({
    '专业': ADMISSION_MAJORS[s.major] || s.major,
    '大学名': s.university,
    '設置主体': s.type,
    '研究科名': s.faculty,
    '専攻名': s.department,
    'コース名': s.course,
    '出願類型': s.admission_type,
    '出願期間': s.application_period,
    '筆記試験': s.written_exam,
    '口述試験': s.oral_exam,
    '合格発表': s.result_date,
    '英語成績': s.english_required,
    '英語詳細': s.english_detail,
    '日本語成績': s.japanese_required,
    '日本語詳細': s.japanese_detail,
    '推薦状': s.recommendation,
    '卒業論文': s.thesis,
    '試験方式': s.exam_style,
    '備考': s.notes,
    '募集要項URL': s.guideline_url,
    '過去問URL': s.past_exam_url,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '出願数据');
  const majorLabel = adbMajor === 'all' ? '全专业' : (ADMISSION_MAJORS[adbMajor] || adbMajor);
  XLSX.writeFile(wb, `出願数据库_${majorLabel}_${new Date().toISOString().slice(0,10)}.xlsx`);
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
        if (!major) { results.push(`⚠ 跳过未识别的 sheet：${sheetName}`); return; }
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        let count = 0;
        rows.forEach(row => {
          const university = (row['大学名'] || row['大学'] || '').toString().trim();
          if (!university) return;
          // 解析英语成绩：检查各列
          let englishRequired = (row['英語成績'] || '').toString().trim() || '不要';
          let englishDetail = '';
          ['TOEFL','TOEIC','IELTS','GRE','GMAT','英検'].forEach(k => {
            if (row[k] && row[k].toString().trim() === '〇') englishDetail += (englishDetail ? '/' : '') + k;
          });
          if (row['その他'] && row['その他'].toString().trim() === '〇') englishDetail += (englishDetail ? '/' : '') + '其他';

          let japaneseRequired = (row['日本語成績'] || '').toString().trim() || '不要';
          let japaneseDetail = '';
          ['JLPT-N1','JLPT-N2','EJU','日本語学力証明'].forEach(k => {
            if (row[k] && row[k].toString().trim() === '〇') japaneseDetail += (japaneseDetail ? '/' : '') + k;
          });

          // 标准化成绩字段
          const normalizeReq = v => {
            if (!v || v === '不要') return '不要';
            if (v === '必要' || v === '必須') return '必須';
            if (v === '任意') return '任意';
            return v;
          };

          admissionImportData.push({
            id: `as-${Date.now()}-${Math.random().toString(36).slice(2,6)}-${count}`,
            major,
            university,
            type: (row['設置主体'] || '').toString().trim(),
            faculty: (row['研究科名'] || '').toString().trim(),
            department: (row['専攻名'] || '').toString().trim(),
            course: (row['コース名'] || '').toString().trim(),
            admission_type: (row['出願類型'] || '').toString().trim(),
            doc_review_period: (row['資格審査'] || '').toString().trim(),
            application_period: (row['出願期間'] || '').toString().trim(),
            written_exam: (row['筆記試験時間'] || '').toString().trim(),
            oral_exam: (row['口述試験時間'] || '').toString().trim(),
            result_date: (row['合格発表時間'] || '').toString().trim(),
            english_required: normalizeReq(englishRequired),
            english_detail: englishDetail,
            japanese_required: normalizeReq(japaneseRequired),
            japanese_detail: japaneseDetail,
            recommendation: normalizeReq((row['推薦状'] || '').toString().trim()),
            thesis: normalizeReq((row['卒業論文'] || '').toString().trim()),
            other_docs: (row['その他書類'] || '').toString().trim(),
            exam_style: (row['試験方式'] || '').toString().trim(),
            notes: (row['備考'] || '').toString().trim(),
            guideline_url: (row['募集要項URL'] || '').toString().trim(),
            past_exam_url: (row['過去問URL'] || '').toString().trim(),
          });
          count++;
        });
        results.push(`✓ ${sheetName}（${ADMISSION_MAJORS[major]}）：${count} 条`);
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

  const toInsert = admissionImportData;
  const skipped = 0;

  // 分批插入（每批50条）
  try {
    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50);
      await sb('/rest/v1/admission_schools', 'POST', batch);
      cachedAdmissionSchools.push(...batch);
    }
    closeAdmissionImport();
    alert(`导入完成：新增 ${toInsert.length} 条，跳过 ${skipped} 条重复`);
    renderAdmissionDbPage(document.getElementById('mainContent'));
  } catch(e) {
    alert('导入失败：' + e.message);
  } finally {
    btn.textContent = '确认导入'; btn.disabled = false;
  }
}
