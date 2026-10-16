// 合格实绩管理（admin 左侧「宣传管理 → 合格实绩」）：原 results/admin.html 整页搬进 admin。
// 入口：raRender(mc, { mode })，mode = 'admin'（默认，admin.js 的 renderPage 在 curPage==='admissions' 时调用）| 'teacher'（老师端「合格实绩管理」，permissions.result_admin）；页面 HTML 由 raHtml() 生成。
// 老师模式：不显示「全件削除」和「迁移旧照片」，保存时不记录到学生档案（raArSyncToStudent 直接返回），其余功能一样。
// 全局名字一律以 ra 开头（海报编辑器在 shared/poster.js，名字以 pst 开头；海报列表在 shared/pass-posters.js，以 pps 开头）。
// 请求统一走 shared/supabase.js 的 sb()（raSbFetch / sbAll）；直连 Storage 的请求头用 raAuthHeaders()；样式全部套在 #ra-root 下，见 RA_CSS。
// 依赖：shared/supabase.js、shared/search.js（searchMatch / searchBox）、shared/pass-posters.js、shared/poster.js；XLSX / JSZip 由 admin/index.html 加载，老师端在 raRender 时按需加载（raLoadLibs）。

const RA_CSS = `
#ra-root, .ra-vars {
  --bg: #f7f5f0; --surface: #fff; --border: #e2ded6; --border-light: #ede9e2;
  --text-primary: #1a1814; --text-secondary: #5a5650; --text-muted: #9a9590;
  --accent: #2c4a8a; --green: #2a5a30; --red: #7a2010;
  --green-bg: #e8f4ea; --red-bg: #faeae8;
}
:where(#ra-root) *, :where(#ra-root) *::before, :where(#ra-root) *::after { box-sizing: border-box; margin: 0; padding: 0; }
#ra-root { font-family: 'DM Mono', monospace;  color: var(--text-primary); font-size: 13px; line-height: 1.55; }
#ra-root header {
  background: var(--surface); border-bottom: 2px solid var(--text-primary);
  padding: 1.5rem 2.5rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem;
}
#ra-root .header-title { font-family: 'Noto Serif SC', serif; font-size: 1.2rem; font-weight: 600; letter-spacing: .03em; }
#ra-root .header-sub { font-size: 10px; color: var(--text-muted); letter-spacing: .08em; text-transform: uppercase; margin-top: 3px; }
#ra-root .header-actions { display: flex; gap: 8px; }
#ra-root .major-bar { background: #1a1814; padding: 0 2.5rem; display: flex; gap: 0; }
#ra-root .major-btn {
  padding: 10px 22px; background: none; border: none; border-bottom: 3px solid transparent;
  font-family: 'Noto Serif SC', serif; font-size: 13px; color: #9a9590; cursor: pointer;
  letter-spacing: .04em; transition: all .15s;
}
#ra-root .major-btn.active { color: #fff; border-bottom-color: var(--accent); font-weight: 600; }
#ra-root .major-btn:hover:not(.active) { color: #d0ccc4; }
#ra-root .tab-bar {
  background: var(--surface); border-bottom: 1px solid var(--border);
  display: flex; padding: 0 2.5rem;
}
#ra-root .tab-btn {
  padding: 10px 18px; background: none; border: none; border-bottom: 2px solid transparent;
  font-family: inherit; font-size: 12px; color: var(--text-muted); cursor: pointer;
  letter-spacing: .04em; transition: color .15s, border-color .15s;
}
#ra-root .tab-btn.active { color: var(--text-primary); border-bottom-color: var(--text-primary); }
#ra-root main { padding: 2rem 1.5rem 4rem; max-width: none; }
#ra-root .form-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 1.5rem; }
#ra-root .form-section-title {
  font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted);
  margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border-light);
}
#ra-root .form-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 1rem; }
#ra-root .form-grid-4 { grid-template-columns: repeat(4, 1fr); }
#ra-root .field { display: flex; flex-direction: column; gap: 4px; }
#ra-root .field label { font-size: 10px; letter-spacing: .06em; color: var(--text-muted); text-transform: uppercase; }
#ra-root .field input,
#ra-root .field select,
#ra-root .field textarea {
  padding: 7px 10px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg);
  font-family: inherit; font-size: 12px; color: var(--text-primary);
  transition: border-color .12s;
}
#ra-root .field input:focus,
#ra-root .field select:focus,
#ra-root .field textarea:focus {
  outline: none; border-color: var(--accent); background: var(--surface);
}
#ra-root .field textarea { resize: vertical; min-height: 60px; }
#ra-root .form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 1rem; }
#ra-root .btn {
  padding: 7px 18px; border-radius: 3px; font-family: inherit; font-size: 12px;
  cursor: pointer; border: 1px solid transparent; letter-spacing: .03em; transition: opacity .12s;
}
#ra-root .btn:hover { opacity: .85; }
#ra-root .btn-primary { background: var(--text-primary); color: var(--bg); }
#ra-root .btn-secondary { background: transparent; color: var(--text-secondary); border-color: var(--border); }
#ra-root .btn-danger { background: var(--red-bg); color: var(--red); border-color: #e8c0b8; }
#ra-root .btn-success { background: var(--green-bg); color: var(--green); border-color: #b8d8bc; }
#ra-root .toast {
  position: fixed; bottom: 1.5rem; right: 1.5rem; padding: 10px 18px; border-radius: 4px;
  font-size: 12px; display: none; z-index: 10050; max-width: 320px;
}
#ra-root .toast.show { display: block; }
#ra-root .toast-ok { background: var(--green-bg); color: var(--green); border: 1px solid #b8d8bc; }
#ra-root .toast-err { background: var(--red-bg); color: var(--red); border: 1px solid #e8c0b8; }
#ra-root .upload-zone {
  border: 2px dashed var(--border); border-radius: 4px; padding: 2rem;
  text-align: center; color: var(--text-muted); cursor: pointer; transition: border-color .15s;
  margin-bottom: 1rem;
}
#ra-root .upload-zone:hover,
#ra-root .upload-zone.drag { border-color: var(--accent); color: var(--text-secondary); }
#ra-root .upload-zone input { display: none; }
#ra-root .mapping-grid {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 1rem;
}
#ra-root .preview-table-wrap { overflow-x: auto; margin: 1rem 0; }
#ra-root .preview-table { width: 100%; border-collapse: collapse; font-size: 11px; }
#ra-root .preview-table th {
  background: var(--bg); padding: 6px 10px; text-align: left;
  border: 1px solid var(--border); font-weight: 500; letter-spacing: .03em; color: var(--text-secondary);
}
#ra-root .preview-table td {
  padding: 5px 10px; border: 1px solid var(--border-light); color: var(--text-secondary);
  white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis;
}
#ra-root .preview-table tr:hover td { background: #faf8f4; }
#ra-root .list-controls { display: flex; gap: 10px; margin-bottom: 1rem; align-items: center; flex-wrap: wrap; }
#ra-root .list-controls input[type=text] {
  padding: 6px 12px; border: 1px solid var(--border); border-radius: 3px;
  font-family: inherit; font-size: 12px; background: var(--bg); flex: 1; min-width: 200px;
}
#ra-root .list-controls select {
  padding: 6px 10px; border: 1px solid var(--border); border-radius: 3px;
  font-family: inherit; font-size: 12px; background: var(--bg);
}
#ra-root .result-count { font-size: 11px; color: var(--text-muted); margin-left: auto; }
#ra-root .data-table-wrap { overflow-x: auto; }
#ra-root .data-table { width: 100%; border-collapse: collapse; font-size: 11px; }
#ra-root .data-table th {
  background: var(--bg); padding: 7px 8px; text-align: left;
  border-bottom: 2px solid var(--border); font-weight: 500; letter-spacing: .04em;
  color: var(--text-secondary); white-space: nowrap; cursor: pointer; user-select: none;
}
#ra-root .data-table th:hover { color: var(--text-primary); }
#ra-root .data-table th .sort-icon { margin-left: 4px; opacity: .4; }
#ra-root .data-table th.sorted .sort-icon { opacity: 1; }
#ra-root .data-table td {
  padding: 6px 8px; border-bottom: 1px solid var(--border-light);
  color: var(--text-secondary); white-space: nowrap; max-width: 160px;
  overflow: hidden; text-overflow: ellipsis;
}
#ra-root .data-table tr:hover td { background: #faf8f4; }
#ra-root .data-table .subj-tag,
#ra-root .track-tag,
#ra-root .type-tag,
#ra-root .tier-tag {
  font-size: 9px; padding: 1px 6px; border-radius: 2px; white-space: nowrap;
}
#ra-root .era-tag { font-size: 9px; padding: 1px 5px; border-radius: 2px; }
#ra-root .era-hist { background: #f0ede6; color: var(--text-muted); }
#ra-root .era-new { background: #e8f0f8; color: var(--accent); }
#ra-root .load-state { padding: 2rem; text-align: center; color: var(--text-muted); font-size: 12px; }
#ra-root .progress-wrap { margin: 1rem 0; display: none; }
#ra-root .progress-wrap.show { display: block; }
#ra-root .progress-bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
#ra-root .progress-fill { height: 100%; background: var(--accent); transition: width .2s; }
#ra-root .progress-label { font-size: 10px; color: var(--text-muted); margin-top: 4px; }
#ra-root .modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 500;
  display: none; align-items: center; justify-content: center;
}
#ra-root .modal-overlay.show { display: flex; }
#ra-root .modal-box {
  background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
  padding: 1.5rem 2rem; max-width: 360px; width: 90%;
}
#ra-root .modal-title { font-size: 14px; font-weight: 500; margin-bottom: .5rem; }
#ra-root .modal-body { font-size: 12px; color: var(--text-secondary); margin-bottom: 1.2rem; line-height: 1.6; }
#ra-root .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
#ra-root .photo-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:12px; }
#ra-root .photo-card { background:var(--surface); border:1px solid var(--border); border-radius:5px; overflow:hidden; }
#ra-root .photo-card img { width:100%; height:160px; object-fit:cover; display:block; }
#ra-root .photo-card-info { padding:10px 12px; }
#ra-root .photo-card-title { font-size:12px; font-weight:500; margin-bottom:3px; }
#ra-root .photo-card-sub { font-size:10px; color:var(--text-muted); }
#ra-root .photo-card-del { float:right; padding:2px 8px; font-size:10px; background:var(--red-bg); color:var(--red); border:1px solid #e8c0b8; border-radius:3px; cursor:pointer; font-family:inherit; }
#ra-root .info-box { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 12px 16px; margin-bottom: 1rem; font-size: 12px; color: var(--text-secondary); line-height: 1.7; }
#ra-root .edit-modal-overlay { position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:600;display:none;align-items:center;justify-content:center }
#ra-root .edit-modal-overlay.show { display:flex }
#ra-root .edit-modal-box { background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1.5rem 2rem;width:520px;max-width:95vw;max-height:90vh;overflow-y:auto }
#ra-root .edit-modal-title { font-size:14px;font-weight:500;margin-bottom:1rem;padding-bottom:8px;border-bottom:1px solid var(--border) }
#ra-root .edit-grid { display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:1rem }
#ra-root .edit-grid-3 { grid-template-columns:1fr 1fr 1fr }
#ra-root input, #ra-root select, #ra-root textarea { width: auto; }   /* admin.css 给所有输入框设了 width:100%，这里还原原页面的默认宽度 */
`;

let raMode = 'admin';   // 'admin' | 'teacher'
function raIsTeacher() { return raMode === 'teacher'; }
// 老师模式下「本校在籍专业」下面的说明（不同步学生档案）
function raTeacherMajorNote() { return raIsTeacher() ? '<div style="font-size:10px;color:var(--text-muted);margin-top:3px">记录到学生档案由管理员处理</div>' : ''; }

function raHtml() {
  return `
<header>
  <div>
    <div class="header-title">合格実绩 管理</div>
    <div class="header-sub">唯新教育 · Admin</div>
  </div>
  <div class="header-actions" style="flex-wrap:wrap;justify-content:flex-end">
    <a href="../results/index.html" target="_blank">
      <button class="btn btn-secondary">← 公开页面</button>
    </a>
    <a href="../results/submit-grad.html" target="_blank">
      <button class="btn btn-secondary" style="background:#e8edf8;border-color:#2c4a8a;color:#2c4a8a">📤 大学院录入链接</button>
    </a>
    <a href="../results/submit-undergrad.html" target="_blank">
      <button class="btn btn-secondary" style="background:#e8f0e4;border-color:#3a6630;color:#3a6630">📤 学部录入链接</button>
    </a>
  </div>
</header>

<div class="major-bar">
  <button class="major-btn active" onclick="raSwitchMajor('grad')">大学院</button>
  <button class="major-btn" onclick="raSwitchMajor('ug')">学部</button>
  <button class="major-btn" onclick="raSwitchMajor('poster')">合格海报</button>
</div>

<!-- ════════════════════════════════════════════════════════════════════════
     大学院セクション
════════════════════════════════════════════════════════════════════════ -->
<div id="major-grad">

<div class="tab-bar">
  <button class="tab-btn active" onclick="raSwitchTab('add')">手动添加</button>
  <button class="tab-btn" onclick="raSwitchTab('excel')">Excel 批量导入</button>
  <button class="tab-btn" onclick="raSwitchTab('list')">数据管理</button>
  <button class="tab-btn" onclick="raSwitchTab('tier')">Tier 管理</button>
  <button class="tab-btn" onclick="raSwitchTab('photos')">合格写真</button>
</div>

<main>

<!-- ── TAB: 手动添加 ── -->
<div id="tab-add">
  <div class="form-panel">
    <div class="form-section-title">院校信息</div>
    <div class="form-grid">
      <div class="field">
        <label>大学名 *</label>
        <input id="f-univ" type="text" placeholder="东京大学" list="univ-list">
        <datalist id="univ-list"></datalist>
      </div>
      <div class="field">
        <label>研究科</label>
        <input id="f-dept" type="text" placeholder="社会学研究科">
      </div>
      <div class="field">
        <label>专攻</label>
        <input id="f-spec" type="text" placeholder="综合社会研究专攻">
      </div>
    </div>

    <div class="form-section-title">学生情報</div>
    <div class="form-grid">
      <div class="field">
        <label>学生名（イニシャル可）</label>
        <input id="f-student" type="text" placeholder="A同学">
        <div style="font-size:10px;color:var(--text-muted);margin-top:3px">学生真实姓名（要记录到学生档案时必填）</div>
      </div>
      <div class="field">
        <label>在籍学科 *</label>
        <select id="f-subject" onchange="raArPreselect('f')">
          <option value="">-- 选择 --</option>
          <option value="shakai">社会学</option>
          <option value="fukushi">社会福祉</option>
          <option value="shinpan">新聞伝播</option>
          <option value="keizai">経済学</option>
          <option value="keiei">経営学</option>
          <option value="kyoiku">教育学</option>
          <option value="hougaku">法学</option>
          <option value="seiji">政治学/国際関係</option>
          <option value="bungaku">文学</option>
          <option value="rekishi">歴史学</option>
          <option value="hyosho">表象文化</option>
          <option value="nihongo">日本語教育</option>
          <option value="shinri">心理学</option>
          <option value="other">その他（文科）</option>
          <!-- 理科 -->
          <option value="rika_kikai">機械工学</option>
          <option value="rika_denki">電気電子工学</option>
          <option value="rika_kagaku">化学・化学工学</option>
          <option value="rika_joho">情報工学</option>
          <option value="rika_kenchiku">建築・土木工学</option>
          <option value="rika_bio">生命科学・医学</option>
          <option value="rika_keiei">経営工学</option>
          <option value="rika_other">その他（理科）</option>
        </select>
      </div>
      <div class="field">
        <label>${raIsTeacher() ? '本校在籍专业（海报筛选用）' : '本校在籍专业（不选 = 不记录到学生档案）'}</label>
        <div id="f-major-box"></div>${raTeacherMajorNote()}
      </div>
      <div class="field">
        <label>入学年度 *</label>
        <select id="f-era">
          <option value="new">2026–2027 入学</option>
          <option value="hist">2022–2025 実绩</option>
        </select>
      </div>
      <div class="field">
        <label>系統 *</label>
        <select id="f-track">
          <option value="bunka">文科</option>
          <option value="rika">理科</option>
          <option value="bijutsu">美術</option>
        </select>
      </div>
            <div class="field">
        <label>Tier（空白=自動判定）</label>
        <select id="f-tier">
          <option value="">自動判定</option>
          <option value="0">T0 — 旧帝・一橋・東科大・早慶上智</option>
          <option value="1">T1 — G-MARCH・関関同立・地方国公立</option>
          <option value="2">T2 — 日駒東専・女子大・地方私立</option>
          <option value="3">T3 — その他</option>
        </select>
      </div>
    </div>

    <div class="form-section-title">語学スコア</div>
    <div class="form-grid">
      <div class="field">
        <label>JLPT 級</label>
        <select id="f-jlpt">
          <option value="">—</option>
          <option value="N1">N1</option>
          <option value="N2">N2</option>
          <option value="N3">N3</option>
        </select>
      </div>
      <div class="field">
        <label>JLPT スコア（任意）</label>
        <input id="f-jlpt-score" type="number" min="0" max="200" placeholder="145">
      </div>
      <div class="field">
        <label>英語種別</label>
        <select id="f-eng-type">
          <option value="">—</option>
          <option value="TOEIC">TOEIC</option>
          <option value="TOEFL">TOEFL</option>
          <option value="IELTS">IELTS</option>
          <option value="EJU">EJU</option>
        </select>
      </div>
      <div class="field">
        <label>英語スコア</label>
        <input id="f-eng-score" type="number" min="0" placeholder="820">
      </div>
      <div class="field">
        <label>備考</label>
        <input id="f-note" type="text" placeholder="※ 研究生 等">
      </div>
    </div>
    <div class="field" style="margin-bottom:1rem"><label>合格截图（原图上传，不压缩，选填）</label>
      <div id="f-photo-box" style="margin-bottom:6px"></div>
      <input id="f-photo" type="file" accept="image/*" onchange="raEmPhotoPick(this,'f')">
    </div>

    <div class="form-actions">
      <span id="f-save-msg" class="ra-save-msg" style="margin-right:auto;align-self:center;font-size:12px;text-align:left"></span>
      <button class="btn btn-secondary" onclick="raResetForm()">クリア</button>
      <button class="btn btn-primary" onclick="raSubmitForm(this)">保存</button>
    </div>
  </div>
</div>

<!-- ── TAB: Excel 批量导入 ── -->
<div id="tab-excel" style="display:none">
  <div class="form-panel">
    <div class="form-section-title">ファイル選択</div>

    <div style="margin-bottom:14px">
      <div style="font-size:10px;letter-spacing:.08em;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">このファイルの系統 *</div>
      <div style="display:flex;gap:8px">
        <button id="track-btn-bunka" onclick="raSelectImportTrack('bunka')"
          style="padding:7px 20px;border-radius:3px;border:2px solid #2c4a8a;background:#2c4a8a;color:#fff;font-family:inherit;font-size:12px;cursor:pointer;font-weight:600;transition:all .12s">
          文科
        </button>
        <button id="track-btn-rika" onclick="raSelectImportTrack('rika')"
          style="padding:7px 20px;border-radius:3px;border:2px solid var(--border);background:var(--bg);color:var(--text-secondary);font-family:inherit;font-size:12px;cursor:pointer;transition:all .12s">
          理科
        </button>
        <button id="track-btn-bijutsu" onclick="raSelectImportTrack('bijutsu')"
          style="padding:7px 20px;border-radius:3px;border:2px solid var(--border);background:var(--bg);color:var(--text-secondary);font-family:inherit;font-size:12px;cursor:pointer;transition:all .12s">
          美術
        </button>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:6px">選択した系統が全件に適用されます（Excelにtrack列がある場合はそちらを優先）</div>
    </div>

    <div class="upload-zone" id="upload-zone" onclick="document.getElementById('file-input').click()">
      <input type="file" id="file-input" accept=".xlsx,.xls,.csv" onchange="raHandleFile(this.files[0])">
      <div style="font-size:14px;margin-bottom:6px">クリックまたはドラッグ＆ドロップ</div>
      <div style="font-size:11px">.xlsx / .xls / .csv 対応</div>
    </div>

    <div id="col-mapping" style="display:none">
      <div class="form-section-title">列マッピング（Excelの列名を選択）</div>
      <div id="mapping-fields" class="mapping-grid"></div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="raResetUpload()">キャンセル</button>
        <button class="btn btn-primary" onclick="raPreviewImport()">プレビュー</button>
      </div>
    </div>

    <div id="import-preview" style="display:none">
      <div class="form-section-title">インポートプレビュー（先頭5件）</div>
      <div class="preview-table-wrap" id="preview-wrap"></div>
      <div class="progress-wrap" id="import-progress">
        <div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>
        <div class="progress-label" id="progress-label">準備中...</div>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="raResetUpload()">キャンセル</button>
        <button class="btn btn-success" onclick="raExecuteImport()" id="import-btn">
          <span id="import-count"></span>件をインポート
        </button>
      </div>
    </div>
  </div>

  <!-- Repair section -->
  <div class="form-panel" style="margin-top:1.5rem">
    <div class="form-section-title">既存データの語学スコア修復</div>
    <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;line-height:1.7">
      アップロード済みデータのJLPT・英語スコアが空白になっている場合、以下から再アップロードして修復できます。<br>
      <span style="color:var(--text-muted);font-size:11px">同じ大学名・研究科・専攻のレコードをマッチングして、jlpt / eng_type / eng_score のみ上書き更新します。</span>
    </p>
    <div class="upload-zone" id="repair-zone" onclick="document.getElementById('repair-input').click()">
      <input type="file" id="repair-input" accept=".xlsx,.xls,.csv" onchange="raHandleRepairFile(this.files[0])">
      <div style="font-size:13px;margin-bottom:6px">修復用ファイルをここにドロップ</div>
      <div style="font-size:11px">同じ列構成のExcelをアップロード → スコアのみ更新</div>
    </div>
    <div id="repair-status" style="font-size:12px;color:var(--text-muted);margin-top:8px"></div>
  </div>

  <!-- SQL helper -->
  <div class="form-panel" style="margin-top:1.5rem">
    <div class="form-section-title">Supabase テーブル作成 SQL（初回のみ・大学院用）</div>
    <pre style="font-size:10px;line-height:1.6;color:var(--text-secondary);background:var(--bg);padding:1rem;border-radius:3px;overflow-x:auto;white-space:pre-wrap">CREATE TABLE admission_results (
  id         uuid primary key default gen_random_uuid(),
  univ       text not null,
  dept       text,
  spec       text,
  student    text,
  subject    text,
  era        text,
  jlpt       text,
  jlpt_score integer,
  eng_type   text,
  eng_score  integer,
  note       text,
  tier       integer,
  created_at timestamptz default now()
);
ALTER TABLE admission_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON admission_results FOR SELECT USING (true);
CREATE POLICY "anon insert" ON admission_results FOR INSERT WITH CHECK (true);
CREATE POLICY "anon delete" ON admission_results FOR DELETE USING (true);
CREATE POLICY "anon update" ON admission_results FOR UPDATE USING (true);</pre>
  </div>
</div>

<!-- ── TAB: データ管理 ── -->
<div id="tab-list" style="display:none">
  <div class="list-controls">
    <input type="text" id="search-input" placeholder="大学名・研究科・専攻・学生名（漢字 / ピンイン頭文字）で検索..." oninput="searchBox(this,raRenderList)">
    <select id="filter-subj" onchange="raRenderList()">
      <option value="">全学科</option>
      <option value="shakai">社会学</option>
      <option value="fukushi">社会福祉</option>
      <option value="shinpan">新聞伝播</option>
      <option value="keizai">経済学</option>
      <option value="keiei">経営学</option>
      <option value="kyoiku">教育学</option>
      <option value="hougaku">法学</option>
      <option value="seiji">政治学/国際関係</option>
      <option value="bungaku">文学</option>
      <option value="rekishi">歴史学</option>
      <option value="hyosho">表象文化</option>
      <option value="nihongo">日本語教育</option>
      <option value="shinri">心理学</option>
      <option value="other">その他（文科）</option>
      <!-- 理科 -->
      <option value="rika_kikai">機械工学</option>
      <option value="rika_denki">電気電子工学</option>
      <option value="rika_kagaku">化学・化学工学</option>
      <option value="rika_joho">情報工学</option>
      <option value="rika_kenchiku">建築・土木工学</option>
      <option value="rika_bio">生命科学・医学</option>
      <option value="rika_keiei">経営工学</option>
      <option value="rika_other">その他（理科）</option>
    </select>
    <select id="filter-era" onchange="raRenderList()">
      <option value="">全年度</option>
      <option value="new">2026–2027</option>
      <option value="hist">2022–2025</option>
    </select>
    <span class="result-count" id="result-count"></span>
    ${raIsTeacher() ? '' : '<button class="btn btn-danger" onclick="raConfirmDeleteAll()" style="margin-left:auto">全件削除</button>'}
  </div>
  <div id="list-area" class="load-state">読み込み中...</div>
</div>

<!-- ── TAB: Tier 管理 ── -->
<div id="tab-tier" style="display:none">
  <div class="info-box">
    データベース内の全大学を一覧表示します。<br>
    自動判定（大学名から推測）の結果を確認しながら、必要な大学だけ手動でTierを上書きできます。<br>
    <span style="color:var(--text-muted);font-size:11px">※ 保存ボタンを押すまで変更は反映されません。変更した行のみ更新します。</span>
  </div>

  <div style="display:flex;gap:10px;margin-bottom:1rem;align-items:center;flex-wrap:wrap">
    <button class="btn btn-secondary" onclick="raLoadTierTab()">↺ 再読み込み</button>
    <button class="btn btn-primary" onclick="raSaveTierChanges()" id="tier-save-btn" disabled>変更を保存（0件）</button>
    <span style="font-size:11px;color:var(--text-muted)" id="tier-status"></span>
    <div style="margin-left:auto;display:flex;gap:6px">
      <input type="text" id="tier-search" placeholder="大学名で絞り込み..."
        style="padding:5px 10px;border:1px solid var(--border);border-radius:3px;font-family:inherit;font-size:12px;background:var(--bg);width:200px"
        oninput="searchBox(this,raRenderTierTable)">
      <select id="tier-filter" onchange="raRenderTierTable()"
        style="padding:5px 8px;border:1px solid var(--border);border-radius:3px;font-family:inherit;font-size:12px;background:var(--bg)">
        <option value="">全Tier</option>
        <option value="auto">自動判定のみ</option>
        <option value="manual">手動設定済み</option>
        <option value="0">T0</option>
        <option value="1">T1</option>
        <option value="2">T2</option>
        <option value="3">T3</option>
      </select>
    </div>
  </div>

  <div id="tier-area" class="load-state">「Tier管理」タブを開くと読み込みます</div>
</div>

<!-- ── TAB: 合格写真 ── -->
<div id="tab-photos" style="display:none">
  <div style="display:flex;gap:10px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
    <input id="photo-search" placeholder="搜索学生（汉字 / 拼音首字母）/ 大学 / 研究科…" oninput="searchBox(this,()=>raPhRender('grad'))" style="padding:6px 10px;border:1px solid var(--border);border-radius:3px;font-family:inherit;font-size:12px;background:var(--bg);width:260px">
    <button class="btn btn-secondary" onclick="raLoadPhotos('grad')">↺ 刷新</button>
    <span style="font-size:11px;color:var(--text-muted)" id="photo-count"></span>
    ${raIsTeacher() ? '' : '<button class="btn btn-secondary ar-mig-btn" style="display:none;margin-left:auto" onclick="raArMigratePhotos()"></button>'}
  </div>
  ${raIsTeacher() ? '' : '<div class="ar-mig-log" style="display:none;margin-bottom:10px;font-size:11px;line-height:1.7;padding:8px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface)"></div>'}
  <div id="photo-filters" style="margin-bottom:12px"></div>
  <div id="photo-grid" class="load-state">读取中...</div>
</div>

</main>
</div>
<!-- ═══ /大学院セクション ═══ -->

<!-- ════════════════════════════════════════════════════════════════════════
     学部セクション
════════════════════════════════════════════════════════════════════════ -->
<div id="major-ug" style="display:none">

<div class="tab-bar">
  <button class="tab-btn active" onclick="raSwitchUgTab('add')">手动添加</button>
  <button class="tab-btn" onclick="raSwitchUgTab('excel')">Excel 批量导入</button>
  <button class="tab-btn" onclick="raSwitchUgTab('list')">数据管理</button>
  <button class="tab-btn" onclick="raSwitchUgTab('tier')">Tier 管理</button>
  <button class="tab-btn" onclick="raSwitchUgTab('photos')">合格写真</button>
</div>

<main>

<!-- ── UG TAB: 手动添加 ── -->
<div id="ugtab-add">
  <div class="form-panel">
    <div class="form-section-title">院校信息</div>
    <div class="form-grid">
      <div class="field">
        <label>大学名 *</label>
        <input id="ug-f-univ" type="text" placeholder="早稲田大学" list="ug-univ-list">
        <datalist id="ug-univ-list"></datalist>
      </div>
      <div class="field">
        <label>学部名</label>
        <input id="ug-f-dept" type="text" placeholder="商学部">
      </div>
      <div class="field">
        <label>学科名</label>
        <input id="ug-f-spec" type="text" placeholder="経営学科">
      </div>
    </div>

    <div class="form-section-title">学生・分类情報</div>
    <div class="form-grid form-grid-4">
      <div class="field">
        <label>学生名</label>
        <input id="ug-f-student" type="text" placeholder="A同学">
        <div style="font-size:10px;color:var(--text-muted);margin-top:3px">学生真实姓名（要记录到学生档案时必填）</div>
      </div>
      <div class="field">
        <label>${raIsTeacher() ? '本校在籍专业（海报筛选用）' : '本校在籍专业（不选 = 不记录到学生档案）'}</label>
        <div id="ugf-major-box"></div>${raTeacherMajorNote()}
      </div>
      <div class="field">
        <label>系統 *</label>
        <select id="ug-f-track">
          <option value="bunka">文科</option>
          <option value="rika">理科</option>
          <option value="bijutsu">美術</option>
        </select>
      </div>
      <div class="field">
        <label>入学年度 *</label>
        <select id="ug-f-era">
          <option value="new">2026–2027 入学</option>
          <option value="hist">2022–2025 実绩</option>
        </select>
      </div>
      <div class="field">
        <label>Tier（空白=自動判定）</label>
        <select id="ug-f-tier">
          <option value="">自動判定</option>
          <option value="0">T0 — 旧帝大・早慶上理ICU</option>
          <option value="1">T1 — 上位国公立・MARCH関関同立</option>
          <option value="2">T2 — 地方国公立・日東駒専等</option>
          <option value="3">T3 — 大東亜帝国クラス</option>
          <option value="4">T4 — 保底校</option>
        </select>
      </div>
    </div>

    <div class="form-section-title">EJU成績</div>
    <div class="form-grid form-grid-4">
      <div class="field"><label>EJU日本語</label><input id="ug-f-eju-jp" type="number" placeholder="354"></div>
      <div class="field"><label>EJU記述</label><input id="ug-f-eju-kijutsu" type="number" placeholder="45"></div>
      <div class="field"><label>EJU文系総合</label><input id="ug-f-eju-bunsou" type="number" placeholder="150"></div>
      <div class="field"><label>EJU数学</label><input id="ug-f-eju-math" type="number" placeholder="193"></div>
      <div class="field"><label>EJU物理</label><input id="ug-f-eju-phys" type="number" placeholder="93"></div>
      <div class="field"><label>EJU化学</label><input id="ug-f-eju-chem" type="number" placeholder="95"></div>
      <div class="field"><label>EJU生物</label><input id="ug-f-eju-bio" type="number" placeholder=""></div>
      <div class="field"><label>EJU総分</label><input id="ug-f-eju-total" type="number" placeholder="735"></div>
    </div>

    <div class="form-section-title">語学</div>
    <div class="form-grid form-grid-4">
      <div class="field">
        <label>JLPT</label>
        <select id="ug-f-jlpt">
          <option value="">—</option>
          <option value="N1">N1</option>
          <option value="N2">N2</option>
          <option value="N3">N3</option>
        </select>
      </div>
      <div class="field"><label>TOEFL</label><input id="ug-f-toefl" type="number" placeholder="100"></div>
      <div class="field"><label>TOEIC</label><input id="ug-f-toeic" type="number" placeholder="800"></div>
      <div class="field"><label>備考</label><input id="ug-f-note" type="text" placeholder=""></div>
    </div>
    <div class="field" style="margin-bottom:1rem"><label>合格截图（原图上传，不压缩，选填）</label>
      <div id="ug-f-photo-box" style="margin-bottom:6px"></div>
      <input id="ug-f-photo" type="file" accept="image/*" onchange="raEmPhotoPick(this,'ug-f')">
    </div>

    <div class="form-actions">
      <span id="ug-f-save-msg" class="ra-save-msg" style="margin-right:auto;align-self:center;font-size:12px;text-align:left"></span>
      <button class="btn btn-secondary" onclick="raUgResetForm()">クリア</button>
      <button class="btn btn-primary" onclick="raUgSubmitForm(this)">保存</button>
    </div>
  </div>
</div>

<!-- ── UG TAB: Excel 批量导入 ── -->
<div id="ugtab-excel" style="display:none">
  <div class="form-panel">
    <div class="form-section-title">ファイル選択</div>
    <div class="upload-zone" id="ug-upload-zone" onclick="document.getElementById('ug-file-input').click()">
      <input type="file" id="ug-file-input" accept=".xlsx,.xls,.csv" onchange="raUgHandleFile(this.files[0])">
      <div style="font-size:14px;margin-bottom:6px">クリックまたはドラッグ＆ドロップ</div>
      <div style="font-size:11px">.xlsx / .xls / .csv 対応</div>
    </div>

    <div id="ug-col-mapping" style="display:none">
      <div class="form-section-title">列マッピング（Excelの列名を選択）</div>
      <div id="ug-mapping-fields" class="mapping-grid"></div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="raUgResetUpload()">キャンセル</button>
        <button class="btn btn-primary" onclick="raUgPreviewImport()">プレビュー</button>
      </div>
    </div>

    <div id="ug-import-preview" style="display:none">
      <div class="form-section-title">インポートプレビュー（先頭5件）</div>
      <div class="preview-table-wrap" id="ug-preview-wrap"></div>
      <div class="progress-wrap" id="ug-import-progress">
        <div class="progress-bar"><div class="progress-fill" id="ug-progress-fill" style="width:0%"></div></div>
        <div class="progress-label" id="ug-progress-label">準備中...</div>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="raUgResetUpload()">キャンセル</button>
        <button class="btn btn-success" onclick="raUgExecuteImport()" id="ug-import-btn">
          <span id="ug-import-count"></span>件をインポート
        </button>
      </div>
    </div>
  </div>

  <div class="form-panel" style="margin-top:1.5rem">
    <div class="form-section-title">Supabase テーブル作成 SQL（初回のみ・学部用）</div>
    <pre style="font-size:10px;line-height:1.6;color:var(--text-secondary);background:var(--bg);padding:1rem;border-radius:3px;overflow-x:auto;white-space:pre-wrap">CREATE TABLE undergrad_results (
  id          uuid primary key default gen_random_uuid(),
  univ        text not null,
  dept        text,
  spec        text,
  student     text,
  track       text,
  subject     text,
  era         text,
  tier        integer,
  school_type text,
  eju_japanese  integer,
  eju_kijutsu   integer,
  eju_bunsou    integer,
  eju_math      integer,
  eju_physics   integer,
  eju_chemistry integer,
  eju_biology   integer,
  eju_total     integer,
  jlpt        text,
  toefl       integer,
  toeic       integer,
  note        text,
  created_at  timestamptz default now()
);
ALTER TABLE undergrad_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON undergrad_results FOR SELECT USING (true);
CREATE POLICY "anon insert" ON undergrad_results FOR INSERT WITH CHECK (true);
CREATE POLICY "anon delete" ON undergrad_results FOR DELETE USING (true);
CREATE POLICY "anon update" ON undergrad_results FOR UPDATE USING (true);</pre>
  </div>
</div>

<!-- ── UG TAB: データ管理 ── -->
<div id="ugtab-list" style="display:none">
  <div class="list-controls">
    <input type="text" id="ug-search-input" placeholder="大学名・学部・学科・学生名（漢字 / ピンイン頭文字）で検索..." oninput="searchBox(this,raUgRenderList)">
    <select id="ug-filter-track" onchange="raUgRenderList()">
      <option value="">全系統</option>
      <option value="bunka">文科</option>
      <option value="rika">理科</option>
      <option value="bijutsu">美術</option>
    </select>
    <select id="ug-filter-era" onchange="raUgRenderList()">
      <option value="">全年度</option>
      <option value="new">2026–2027</option>
      <option value="hist">2022–2025</option>
    </select>
    <select id="ug-filter-tier" onchange="raUgRenderList()">
      <option value="">全Tier</option>
      <option value="0">T0</option>
      <option value="1">T1</option>
      <option value="2">T2</option>
      <option value="3">T3</option>
      <option value="4">T4</option>
    </select>
    <span class="result-count" id="ug-result-count"></span>
    ${raIsTeacher() ? '' : '<button class="btn btn-danger" onclick="raUgConfirmDeleteAll()" style="margin-left:auto">全件削除</button>'}
  </div>
  <div id="ug-list-area" class="load-state">読み込み中...</div>
</div>

<!-- ── UG TAB: 合格写真 ── -->
<div id="ugtab-photos" style="display:none">
  <div style="display:flex;gap:10px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
    <input id="ugphoto-search" placeholder="搜索学生（汉字 / 拼音首字母）/ 大学 / 学部…" oninput="searchBox(this,()=>raPhRender('ug'))" style="padding:6px 10px;border:1px solid var(--border);border-radius:3px;font-family:inherit;font-size:12px;background:var(--bg);width:260px">
    <button class="btn btn-secondary" onclick="raLoadPhotos('ug')">↺ 刷新</button>
    <span style="font-size:11px;color:var(--text-muted)" id="ugphoto-count"></span>
    ${raIsTeacher() ? '' : '<button class="btn btn-secondary ar-mig-btn" style="display:none;margin-left:auto" onclick="raArMigratePhotos()"></button>'}
  </div>
  ${raIsTeacher() ? '' : '<div class="ar-mig-log" style="display:none;margin-bottom:10px;font-size:11px;line-height:1.7;padding:8px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface)"></div>'}
  <div id="ugphoto-filters" style="margin-bottom:12px"></div>
  <div id="ugphoto-grid" class="load-state">读取中...</div>
</div>

<div id="ugtab-tier" style="display:none">
  <div class="info-box" style="margin-bottom:1rem">学部データの大学別Tier設定。</div>
  <div style="display:flex;gap:10px;margin-bottom:1rem;align-items:center">
    <button class="btn btn-secondary" onclick="raUgLoadTierTab()">↺ 再読み込み</button>
    <button class="btn btn-primary" onclick="raUgSaveTierChanges()" id="ug-tier-save-btn" disabled>変更を保存（0件）</button>
    <span style="font-size:11px;color:var(--text-muted)" id="ug-tier-status"></span>
  </div>
  <div id="ug-tier-area" class="load-state">読み込み中...</div>
</div>

</main>
</div>

<!-- 学部編集モーダル -->
<div class="edit-modal-overlay" id="ug-edit-modal">
  <div class="edit-modal-box">
    <div class="edit-modal-title" id="ug-edit-modal-title">学部 編集</div>
    <div class="edit-grid">
      <div class="field"><label>大学名</label><input id="ug-em-univ" type="text"></div>
      <div class="field"><label>学部名</label><input id="ug-em-dept" type="text"></div>
      <div class="field"><label>学科名</label><input id="ug-em-spec" type="text"></div>
      <div class="field"><label>学生名</label><input id="ug-em-student" type="text">
        <div style="font-size:10px;color:var(--text-muted);margin-top:3px">学生真实姓名（要记录到学生档案时必填）</div></div>
      <div class="field"><label>本校在籍专业</label><div id="ugem-major-box"></div>${raTeacherMajorNote()}</div>
      <div class="field"><label>系統</label>
        <select id="ug-em-track"><option value="bunka">文科</option><option value="rika">理科</option><option value="bijutsu">美術</option></select>
      </div>
      <div class="field"><label>年度</label>
        <select id="ug-em-era"><option value="new">2026–2027</option><option value="hist">2022–2025</option></select>
      </div>
      <div class="field"><label>Tier</label>
        <select id="ug-em-tier"><option value="">自動</option><option value="0">T0</option><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option><option value="4">T4</option></select>
      </div>
    </div>
    <div class="edit-grid edit-grid-3">
      <div class="field"><label>EJU日本語</label><input id="ug-em-eju-jp" type="number"></div>
      <div class="field"><label>EJU記述</label><input id="ug-em-eju-kijutsu" type="number"></div>
      <div class="field"><label>EJU文系総合</label><input id="ug-em-eju-bunsou" type="number"></div>
      <div class="field"><label>EJU数学</label><input id="ug-em-eju-math" type="number"></div>
      <div class="field"><label>EJU物理</label><input id="ug-em-eju-phys" type="number"></div>
      <div class="field"><label>EJU化学</label><input id="ug-em-eju-chem" type="number"></div>
      <div class="field"><label>EJU生物</label><input id="ug-em-eju-bio" type="number"></div>
      <div class="field"><label>EJU総分</label><input id="ug-em-eju-total" type="number"></div>
      <div class="field"><label>JLPT</label>
        <select id="ug-em-jlpt"><option value="">—</option><option value="N1">N1</option><option value="N2">N2</option><option value="N3">N3</option></select>
      </div>
      <div class="field"><label>TOEFL</label><input id="ug-em-toefl" type="number"></div>
      <div class="field"><label>TOEIC</label><input id="ug-em-toeic" type="number"></div>
      <div class="field"><label>備考</label><input id="ug-em-note" type="text"></div>
    </div>
    <div class="field" style="margin-bottom:1rem"><label>合格截图（原图上传，不压缩）</label>
      <div id="ug-em-photo-box" style="margin-bottom:6px"></div>
      <input id="ug-em-photo" type="file" accept="image/*" onchange="raEmPhotoPick(this,'ug-em')">
    </div>
    <input type="hidden" id="ug-em-id">
    <div id="ug-em-err" style="color:var(--red);font-size:12px;margin-top:6px"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="document.getElementById('ug-edit-modal').classList.remove('show')">キャンセル</button>
      <button class="btn btn-primary" onclick="raUgSaveEdit(this)">保存</button>
    </div>
  </div>
</div>

<!-- ═══ /学部セクション ═══ -->

<!-- ═══ 合格海报管理（大学院 + 学部放在一起，用筛选区分）═══ -->
<div id="major-poster" style="display:none"><main><div id="pps-admin-root"></div></main></div>

<div class="toast" id="toast"></div>

<div class="modal-overlay" id="confirm-modal">
  <div class="modal-box">
    <div class="modal-title" id="modal-title">確認</div>
    <div class="modal-body" id="modal-body"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="raCloseModal()">キャンセル</button>
      <button class="btn btn-danger" id="modal-confirm-btn">削除</button>
    </div>
  </div>
</div>

<div class="edit-modal-overlay" id="edit-modal">
  <div class="edit-modal-box">
    <div class="edit-modal-title" id="edit-modal-title">編集</div>
    <div class="edit-grid">
      <div class="field"><label>大学名</label><input id="em-univ" type="text"></div>
      <div class="field"><label>研究科</label><input id="em-dept" type="text"></div>
      <div class="field"><label>専攻</label><input id="em-spec" type="text"></div>
      <div class="field"><label>学生名</label><input id="em-student" type="text">
        <div style="font-size:10px;color:var(--text-muted);margin-top:3px">学生真实姓名（要记录到学生档案时必填）</div></div>
      <div class="field"><label>在籍学科</label>
        <select id="em-subject" onchange="raArPreselect('em')">
          <option value="shakai">社会学</option><option value="fukushi">社会福祉</option>
          <option value="shinpan">新聞伝播</option><option value="keizai">経済学</option>
          <option value="keiei">経営学</option><option value="kyoiku">教育学</option>
          <option value="hougaku">法学</option><option value="seiji">政治学/国際関係</option>
          <option value="bungaku">文学</option><option value="rekishi">歴史学</option>
          <option value="hyosho">表象文化</option><option value="nihongo">日本語教育</option>
          <option value="shinri">心理学</option><option value="other">その他（文科）</option>
          <option value="rika_kikai">機械工学</option><option value="rika_denki">電気電子工学</option>
          <option value="rika_kagaku">化学・化学工学</option><option value="rika_joho">情報工学</option>
          <option value="rika_kenchiku">建築・土木工学</option><option value="rika_bio">生命科学・医学</option>
          <option value="rika_keiei">経営工学</option><option value="rika_other">その他（理科）</option>
        </select>
      </div>
      <div class="field"><label>本校在籍专业</label>
        <div id="em-major-box"></div>${raTeacherMajorNote()}
      </div>
      <div class="field"><label>系統</label>
        <select id="em-track">
          <option value="bunka">文科</option>
          <option value="rika">理科</option>
          <option value="bijutsu">美術</option>
        </select>
      </div>
      <div class="field"><label>年度</label>
        <select id="em-era">
          <option value="new">2026–2027</option>
          <option value="hist">2022–2025</option>
        </select>
      </div>
      <div class="field"><label>Tier</label>
        <select id="em-tier">
          <option value="">自動</option>
          <option value="0">T0</option><option value="1">T1</option>
          <option value="2">T2</option><option value="3">T3</option>
        </select>
      </div>
    </div>
    <div class="edit-grid edit-grid-3">
      <div class="field"><label>JLPT</label>
        <select id="em-jlpt">
          <option value="">—</option>
          <option value="N1">N1</option><option value="N2">N2</option><option value="N3">N3</option>
        </select>
      </div>
      <div class="field"><label>JLPT スコア</label><input id="em-jlpt-score" type="number" placeholder="145"></div>
      <div class="field"><label>英語種別</label>
        <select id="em-eng-type">
          <option value="">—</option>
          <option value="TOEIC">TOEIC</option>
          <option value="TOEFL">TOEFL</option>
          <option value="IELTS">IELTS</option>
        </select>
      </div>
      <div class="field"><label>英語スコア</label><input id="em-eng-score" type="number" placeholder="800"></div>
      <div class="field" style="grid-column:span 1"><label>備考</label><input id="em-note" type="text"></div>
    </div>
    <div class="field" style="margin-bottom:1rem"><label>合格截图（原图上传，不压缩）</label>
      <div id="em-photo-box" style="margin-bottom:6px"></div>
      <input id="em-photo" type="file" accept="image/*" onchange="raEmPhotoPick(this)">
    </div>
    <input type="hidden" id="em-id">
    <div id="em-err" style="color:var(--red);font-size:12px;margin-top:6px"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="raCloseEditModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="raSaveEdit(this)">保存</button>
    </div>
  </div>
</div>
`;
}

// ─── Major category switch (大学院 / 学部) ───────────────────────────────────
let raCurMajor = 'grad';
function raSwitchMajor(m) {
  raCurMajor = m;
  document.getElementById('major-grad').style.display = m==='grad' ? '' : 'none';
  document.getElementById('major-ug').style.display = m==='ug' ? '' : 'none';
  document.getElementById('major-poster').style.display = m==='poster' ? '' : 'none';
  document.querySelectorAll('.major-btn').forEach((b,i) => b.classList.toggle('active', ['grad','ug','poster'][i]===m));
  if (m === 'ug' && !raUgDataLoaded) { raUgRefreshUnivList(); raUgDataLoaded = true; }
  if (m === 'poster') raPpAdminOpen();
}

// ── 合格海报管理页（列表本身在 shared/pass-posters.js，和老师端共用）──
let raPpAdminMounted = false;
function raPpAdminOpen() {
  if (raPpAdminMounted) { ppsReload(); return; }
  raPpAdminMounted = true;
  ppsMount(document.getElementById('pps-admin-root'), {
    mode: 'admin',
    cls: { btn: 'btn btn-secondary' },
    majorName: k => ((typeof raArMajors !== 'undefined' ? raArMajors : []).find(m => m.key === k) || {}).label || k || '未设专业',
    defaultDomains: [],   // 管理端：最新一年 + 全部状态
    loadRows: raPpAdminLoad,
    admin: {
      edit: r => pstOpen(r.result_kind === 'ug' ? 'ug' : 'grad', r.result_id),
      pdfBlob: pstPdfBlobFor, webBlob: pstWebBlobFor, previewUrl: pstPreviewUrlFor,
      publish: pstPublishFor, unpublish: pstUnpublishFor, remove: pstRemoveFor, downloadPdf: pstDownloadPdfFor,
    },
  });
}
// 读全部海报（包括没发布的），不取原截图（原截图在管理员专用的 pass_poster_sources 里）
async function raPpAdminLoad() {
  let all = [], off = 0;
  for (;;) {
    const r = await raSbFetch(`pass_posters?select=id,result_kind,result_id,univ,dept,spec,major,domain,pass_year,pass_month,fields,web_url,thumb_url&order=pass_year.desc,pass_month.desc,updated_at.desc&limit=1000&offset=${off}`);
    all = all.concat(r || []);
    if (!r || r.length < 1000) break;
    off += 1000;
  }
  return all;
}
// 编辑器关掉后：如果正在看海报管理页，刷新列表
function raPstOnClose() { if (raCurMajor === 'poster' && typeof ppsReload === 'function') ppsReload(); }

// ════════════════════════════════════════════════════════════════════════
// 大学院 (admission_results) ロジック
// ════════════════════════════════════════════════════════════════════════

let raAllData = [];
let raListSortCol = 'created_at';
let raListSortDir = -1;
let raUploadRows = [];
let raUploadColMap = {};
let raUploadHeaders = [];

function raSwitchTab(t) {
  ['add','excel','list','tier','photos'].forEach(id => {
    const el=document.getElementById(`tab-${id}`); if(el) el.style.display = id === t ? '' : 'none';
  });
  document.querySelectorAll('#major-grad .tab-btn').forEach((b,i) => {
    b.classList.toggle('active', ['add','excel','list','tier','photos'][i] === t);
  });
  if (t === 'list') raLoadList();
  if (t === 'tier') raLoadTierTab();
  if (t === 'photos') raLoadPhotos();
}

let raToastTimer;
function raToast(msg, ok = true) {
  const el = document.getElementById('toast');
  if (!el) return;   // 已经切到别的页面了
  el.textContent = msg;
  el.className = `toast show ${ok ? 'toast-ok' : 'toast-err'}`;
  clearTimeout(raToastTimer);
  raToastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── 保存按钮状态 / 结果行 / 防重复 ──
function raBtnBusy(btn, text) {
  if (!btn) return;
  if (btn.dataset.raLabel == null) btn.dataset.raLabel = btn.textContent;
  btn.disabled = true; btn.textContent = text;
}
function raBtnDone(btn) {
  if (!btn) return;
  btn.disabled = false;
  if (btn.dataset.raLabel != null) { btn.textContent = btn.dataset.raLabel; delete btn.dataset.raLabel; }
}
// kind: ok 绿 / warn 橙 / err 红；结果行不会自动消失，开始填下一条时变灰
function raSaveMsg(id, kind, text) {
  const el = document.getElementById(id); if (!el) return;
  el.textContent = text || '';
  el.style.color = { ok: 'var(--green)', warn: '#c27a1a', err: 'var(--red)' }[kind] || '';
  el.dataset.kind = kind || '';
  if (kind === 'ok' || kind === 'warn') {
    const box = el.closest('.form-actions') && el.closest('.form-actions').parentElement;
    if (box) {
      const grey = () => { if (el.dataset.kind) el.style.color = 'var(--text-muted)'; };
      box.addEventListener('input', grey, { once: true });
      box.addEventListener('change', grey, { once: true });
    }
  }
}
function raNowHM() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
const raLastSaved = {};
function raSavedKey(row) { return [row.univ, row.dept, row.student].map(v => (v || '').trim()).join('|'); }
function raFlashRow(id) {
  document.querySelectorAll(`tr[data-id="${String(id).replace(/"/g, '')}"]`).forEach(tr => {
    if (tr.offsetParent === null) return;
    tr.style.setProperty('background', '#fff3c4', 'important');
    tr.scrollIntoView({ block: 'nearest' });
    setTimeout(() => tr.style.removeProperty('background'), 2000);
  });
}

let raModalCb = null;
function raShowModal(title, body, cb) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = body;
  document.getElementById('modal-confirm-btn').onclick = () => { raCloseModal(); cb(); };
  document.getElementById('confirm-modal').classList.add('show');
}
function raCloseModal() { document.getElementById('confirm-modal').classList.remove('show'); }

function raResetForm() {
  ['f-univ','f-dept','f-spec','f-student','f-jlpt-score','f-eng-score','f-note'].forEach(id => {
    document.getElementById(id).value = '';
  });
  ['f-subject','f-era','f-tier','f-jlpt','f-eng-type'].forEach(id => {
    document.getElementById(id).selectedIndex = 0;
  });
  raArSetMajor('f', '');
  document.getElementById('f-photo').value = '';
  document.getElementById('f-photo-box').innerHTML = '';
}

async function raSubmitForm(btn, force) {
  if (btn && btn.disabled) return;
  const univ = document.getElementById('f-univ').value.trim();
  const subject = document.getElementById('f-subject').value;
  if (!univ) { raToast('大学名を入力してください', false); return; }
  if (!subject) { raToast('在籍学科を選択してください', false); return; }

  const jlptScore = document.getElementById('f-jlpt-score').value;
  const engScore = document.getElementById('f-eng-score').value;

  const row = {
    univ,
    dept: document.getElementById('f-dept').value.trim() || null,
    spec: document.getElementById('f-spec').value.trim() || null,
    student: document.getElementById('f-student').value.trim() || null,
    subject,
    era: document.getElementById('f-era').value,
    track: document.getElementById('f-track').value || 'bunka',
    tier: document.getElementById('f-tier').value !== '' ? parseInt(document.getElementById('f-tier').value) : null,
    jlpt: document.getElementById('f-jlpt').value || null,
    jlpt_score: jlptScore ? parseInt(jlptScore) : null,
    eng_type: document.getElementById('f-eng-type').value || null,
    eng_score: engScore ? parseInt(engScore) : null,
    note: document.getElementById('f-note').value.trim() || null,
    our_major: raArGetMajor('f') || null,
  };

  if (!force && raLastSaved.grad === raSavedKey(row)) {
    raShowModal('重复确认', '刚刚已经保存过一条相同的，还要再存一条吗？', () => raSubmitForm(btn, true));
    return;
  }
  const file = document.getElementById('f-photo').files[0];
  raBtnBusy(btn, '保存中…'); raSaveMsg('f-save-msg', '', '');
  try {
    const ins = await raInsertResult(row);
    const saved = Array.isArray(ins) ? ins[0] : null;
    raLastSaved.grad = raSavedKey(row);
    let phOk = true, synced = false;
    if (file) { raBtnBusy(btn, '上传截图中…'); phOk = await raAddPhotoAfterInsert('grad', saved, file); }
    if (saved && row.our_major && row.student && !raIsTeacher()) { raBtnBusy(btn, '同步学生档案中…'); synced = (await raArSyncToStudent(saved)) === 'synced'; }
    const label = [row.univ, row.dept, row.student].filter(Boolean).join(' · ');
    const tail = synced ? ' · 已记录到学生档案' : '';
    if (phOk) raSaveMsg('f-save-msg', 'ok', `✓ 已保存：${label}（${raNowHM()}）${file ? ' · 含截图' : ''}${tail}`);
    else raSaveMsg('f-save-msg', 'warn', `合格实绩已保存（${label}），截图上传失败，请在数据管理里补传${tail}`);
    raToast(phOk ? '保存しました ✓' : '合格实绩已保存，但截图上传失败，请在「数据管理」编辑里补传', phOk);
    raResetForm(); raRefreshUnivList();
  } catch (e) {
    raSaveMsg('f-save-msg', 'err', '保存失败：' + e.message + '（表单内容还在，可直接再点保存）');
    raToast('エラー: ' + e.message, false);
  } finally { raBtnDone(btn); }
}

async function raRefreshUnivList() {
  try {
    const data = await raFetchAllResults();
    const univs = [...new Set(data.map(d => d.univ))].sort();
    const dl = document.getElementById('univ-list');
    dl.innerHTML = univs.map(u => `<option value="${u}">`).join('');
  } catch(e) {}
}

const raFIELD_DEFS = [
  { key: 'univ',      label: '大学名 *' },
  { key: 'dept',      label: '研究科' },
  { key: 'spec',      label: '専攻' },
  { key: 'student',   label: '学生名' },
  { key: 'subject',   label: '在籍学科' },
  { key: 'track',     label: '系統（bunka/rika/bijutsu）' },
  { key: 'era',       label: '入学年度' },
  { key: 'tier',      label: 'Tier（0/1/2/3）' },
  { key: 'jlpt_raw',  label: 'JLPT（テキスト）' },
  { key: 'eng_raw',   label: '英語スコア（テキスト）' },
];

let raImportTrack = 'bunka';

function raSelectImportTrack(t) {
  raImportTrack = t;
  const colors = {bunka:'#2c4a8a', rika:'#3a6630', bijutsu:'#7a4a20'};
  ['bunka','rika','bijutsu'].forEach(id => {
    const btn = document.getElementById('track-btn-' + id);
    if (!btn) return;
    if (id === t) {
      btn.style.background = colors[t];
      btn.style.borderColor = colors[t];
      btn.style.color = '#fff';
      btn.style.fontWeight = '600';
    } else {
      btn.style.background = 'var(--bg)';
      btn.style.borderColor = 'var(--border)';
      btn.style.color = 'var(--text-secondary)';
      btn.style.fontWeight = 'normal';
    }
  });
}

function raHandleFile(file) {
  if (!file) return;
  const zone = document.getElementById('upload-zone');
  zone.textContent = `読み込み中: ${file.name}`;
  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(e.target.result, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows.length) { raToast('データが空です', false); return; }
    raUploadHeaders = rows[0].map(String);
    raUploadRows = rows.slice(1).filter(r => r.some(c => c !== ''));
    raBuildMappingUI();
  };
  reader.readAsArrayBuffer(file);
}

function raBuildMappingUI() {
  const container = document.getElementById('mapping-fields');
  container.innerHTML = raFIELD_DEFS.map(fd => `
    <div class="field">
      <label>${fd.label}</label>
      <select id="map-${fd.key}">
        <option value="">— スキップ —</option>
        ${raUploadHeaders.map((h,i) => `<option value="${i}" ${raGuessCol(h, fd.key) ? 'selected' : ''}>${h}</option>`).join('')}
      </select>
    </div>
  `).join('');
  document.getElementById('col-mapping').style.display = '';
  document.getElementById('upload-zone').style.display = 'none';
  document.getElementById('import-preview').style.display = 'none';
}

function raGuessCol(header, key) {
  const h = header.toLowerCase();
  const guesses = {
    univ: ['大学','学校','univ'], dept: ['研究科','dept','研究'], spec: ['専攻','专攻','spec'],
    student: ['学生','名前','student','学员'], subject: ['学科','在籍','subject'],
    era: ['年度','era','入学','批次'], jlpt_raw: ['日語','jlpt','日语','日本語'],
    eng_raw: ['英語','toeic','toefl','英语','英'],
  };
  return (guesses[key] || []).some(g => h.includes(g));
}

function raGetColIndex(key) {
  const v = document.getElementById(`map-${key}`)?.value;
  return v !== '' && v !== undefined ? parseInt(v) : null;
}

function raPreviewImport() {
  const univIdx = raGetColIndex('univ');
  if (univIdx === null) { raToast('大学名の列を選択してください', false); return; }
  raUploadColMap = {};
  raFIELD_DEFS.forEach(fd => { raUploadColMap[fd.key] = raGetColIndex(fd.key); });

  const preview = raUploadRows.slice(0, 5);
  const headers = ['大学名','研究科','専攻','学生','学科','年度','JLPT','英語'];
  let html = `<table class="preview-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>`;
  for (const row of preview) {
    const mapped = raMapRow(row);
    html += `<tr>
      <td>${mapped.univ||''}</td><td>${mapped.dept||''}</td><td>${mapped.spec||''}</td>
      <td>${mapped.student||''}</td><td>${mapped.subject||''}</td><td>${mapped.era||''}</td>
      <td>${mapped.jlpt||''}${mapped.jlpt_score?' '+mapped.jlpt_score:''}</td>
      <td>${mapped.eng_type||''}${mapped.eng_score?' '+mapped.eng_score:''}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  document.getElementById('preview-wrap').innerHTML = html;
  document.getElementById('import-count').textContent = raUploadRows.length;
  document.getElementById('col-mapping').style.display = 'none';
  document.getElementById('import-preview').style.display = '';
}

function raMapRow(row) {
  const get = key => {
    const i = raUploadColMap[key];
    return (i !== null && i !== undefined) ? String(row[i] ?? '').trim() : '';
  };
  const jlptRaw = get('jlpt_raw');
  const engRaw = get('eng_raw');
  const { jlpt, jlpt_score } = raParseJlpt(jlptRaw);
  const { eng_type, eng_score } = raParseEng(engRaw);

  let era = get('era').toLowerCase();
  if (era.includes('26') || era.includes('25') || era.includes('new') || era.includes('夏') || era.includes('冬')) era = 'new';
  else if (era.includes('22') || era.includes('23') || era.includes('24') || era.includes('25') || era.includes('hist')) era = 'hist';
  else era = 'new';

  let trackRaw = get('track').toLowerCase().trim();
  let track;
  if (trackRaw.includes('rika') || trackRaw.includes('理科')) track = 'rika';
  else if (trackRaw.includes('bijutsu') || trackRaw.includes('美術') || trackRaw.includes('美术')) track = 'bijutsu';
  else if (trackRaw.includes('bunka') || trackRaw.includes('文科')) track = 'bunka';
  else track = raImportTrack; // Excel にtrack列がなければUIで選んだ系統を使用

  let subject = get('subject').toLowerCase().trim();
  if      (subject.includes('社会学') || subject.includes('(社会)') || subject === 'shakai') subject = 'shakai';
  else if (subject.includes('福祉') || subject.includes('(福祉)') || subject === 'fukushi') subject = 'fukushi';
  else if (subject.includes('新伝') || subject.includes('(新传)') || subject.includes('新聞') || subject.includes('メディア') || subject.includes('shinpan') || subject.includes('传播')) subject = 'shinpan';
  else if (subject.includes('経済') || subject.includes('经济') || subject === 'keizai') subject = 'keizai';
  else if (subject.includes('経営') || subject.includes('经营') || subject === 'keiei') subject = 'keiei';
  else if (subject.includes('教育') || subject === 'kyoiku') subject = 'kyoiku';
  else if (subject.includes('法学') || subject === 'hougaku') subject = 'hougaku';
  else if (subject.includes('政治') || subject.includes('国際関係') || subject.includes('国际') || subject === 'seiji') subject = 'seiji';
  else if (subject.includes('文学') || subject === 'bungaku') subject = 'bungaku';
  else if (subject.includes('歴史') || subject.includes('历史') || subject === 'rekishi') subject = 'rekishi';
  else if (subject.includes('表象') || subject === 'hyosho') subject = 'hyosho';
  else if (subject.includes('日本語') || subject.includes('日本语') || subject === 'nihongo') subject = 'nihongo';
  else if (subject.includes('心理') || subject === 'shinri') subject = 'shinri';
  // 理科コード（直接入力されている場合はそのまま）
  else if (subject.startsWith('rika_')) { /* keep as-is */ }
  else subject = 'other';

  const tierRaw = get('tier');
  const tier = tierRaw && ['0','1','2','3'].includes(tierRaw.trim()) ? parseInt(tierRaw.trim()) : null;

  if (subject.startsWith('rika_')) track = 'rika';
  return {
    univ: get('univ') || null, dept: get('dept') || null, spec: get('spec') || null,
    student: get('student') || null, subject, era, track, tier, jlpt, jlpt_score, eng_type, eng_score, note: null,
  };
}

async function raExecuteImport() {
  const btn = document.getElementById('import-btn');
  btn.disabled = true;
  const prog = document.getElementById('import-progress');
  const fill = document.getElementById('progress-fill');
  const label = document.getElementById('progress-label');
  prog.classList.add('show');

  const rows = raUploadRows.map(raMapRow).filter(r => r.univ);
  const BATCH = 50;
  let done = 0;

  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      await raInsertBatch(batch);
      done += batch.length;
      fill.style.width = Math.round(done / rows.length * 100) + '%';
      label.textContent = `${done} / ${rows.length} 件処理済み`;
    }
    raToast(`${done} 件をインポートしました ✓`);
    raResetUpload();
  } catch(e) {
    raToast('インポートエラー: ' + e.message, false);
    btn.disabled = false;
  }
}

function raResetUpload() {
  document.getElementById('upload-zone').style.display = '';
  document.getElementById('upload-zone').innerHTML = `
    <input type="file" id="file-input" accept=".xlsx,.xls,.csv" onchange="raHandleFile(this.files[0])">
    <div style="font-size:14px;margin-bottom:6px">クリックまたはドラッグ＆ドロップ</div>
    <div style="font-size:11px">.xlsx / .xls / .csv 対応</div>`;
  document.getElementById('col-mapping').style.display = 'none';
  document.getElementById('import-preview').style.display = 'none';
  document.getElementById('import-progress').classList.remove('show');
  raUploadRows = []; raUploadColMap = {}; raUploadHeaders = [];
}

// 拖拽上传区（大学院 / 学部 Excel 导入）；页面 HTML 每次重新生成，所以每次打开页面都要重新绑定
function raBindUploadZones() {
  const zone = document.getElementById('upload-zone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); raHandleFile(e.dataTransfer.files[0]); });

  const ugZone = document.getElementById('ug-upload-zone');
  ugZone.addEventListener('dragover', e => { e.preventDefault(); ugZone.classList.add('drag'); });
  ugZone.addEventListener('dragleave', () => ugZone.classList.remove('drag'));
  ugZone.addEventListener('drop', e => { e.preventDefault(); ugZone.classList.remove('drag'); raUgHandleFile(e.dataTransfer.files[0]); });
}

async function raLoadList() {
  document.getElementById('list-area').innerHTML = '<div class="load-state">読み込み中...</div>';
  try { raAllData = await raFetchAllResults(); raRenderList(); }
  catch(e) { document.getElementById('list-area').innerHTML = `<div class="load-state" style="color:var(--red)">エラー: ${e.message}</div>`; }
}

function raRenderList() {
  const q = document.getElementById('search-input').value;
  const fs = document.getElementById('filter-subj').value;
  const fe = document.getElementById('filter-era').value;

  let rows = raAllData.filter(r => {
    if (fs && r.subject !== fs) return false;
    if (fe && r.era !== fe) return false;
    if (q && !searchMatch(q, [r.student, r.univ, r.dept, r.spec])) return false;
    return true;
  });

  rows.sort((a, b) => {
    let av = a[raListSortCol] ?? '', bv = b[raListSortCol] ?? '';
    if (typeof av === 'string') return av.localeCompare(bv) * raListSortDir;
    return (av - bv) * raListSortDir;
  });

  document.getElementById('result-count').textContent = `${rows.length} 件`;
  if (!rows.length) { document.getElementById('list-area').innerHTML = '<div class="load-state">データが見つかりません</div>'; return; }

  const cols = [
    { key: 'univ', label: '大学名' }, { key: 'dept', label: '研究科' }, { key: 'spec', label: '専攻' },
    { key: 'subject', label: '学科' }, { key: 'track', label: '系統' }, { key: 'tier', label: 'Tier' }, { key: 'era', label: '年度' },
    { key: 'jlpt', label: 'JLPT' }, { key: 'jlpt_score', label: 'J点数' }, { key: 'eng_type', label: '英語種別' }, { key: 'eng_score', label: '英語点数' }, { key: 'student', label: '学生' },
  ];

  const SUBJ_LABEL = {shakai:'社会学',fukushi:'社会福祉',shinpan:'新聞伝播',keizai:'経済学',keiei:'経営学',kyoiku:'教育学',hougaku:'法学',seiji:'政治学/国際関係',bungaku:'文学',rekishi:'歴史学',hyosho:'表象文化',nihongo:'日本語教育',shinri:'心理学',other:'その他',rika_kikai:'機械工学',rika_denki:'電気電子工学',rika_kagaku:'化学・化学工学',rika_joho:'情報工学',rika_kenchiku:'建築・土木工学',rika_bio:'生命科学・医学',rika_keiei:'経営工学',rika_other:'その他（理科）'};

  let html = `<div class="data-table-wrap"><table class="data-table"><thead><tr>`;
  for (const c of cols) {
    const sorted = raListSortCol === c.key;
    const arrow = sorted ? (raListSortDir === 1 ? '↑' : '↓') : '↕';
    html += `<th class="${sorted?'sorted':''}" onclick="raSortList('${c.key}')">${c.label} <span class="sort-icon">${arrow}</span></th>`;
  }
  html += `<th>操作</th></tr></thead><tbody>`;

  for (const r of rows) {
    const sc = raSUBJ_COLOR[r.subject] || raSUBJ_COLOR.other;
    const eraTag = r.era === 'new' ? `<span class="era-tag era-new">26–27</span>` : `<span class="era-tag era-hist">22–25</span>`;
    html += `<tr data-id="${r.id}" data-univ="${(r.univ||'').replace(/"/g,'&quot;')}">
      <td style="max-width:100px">${r.univ||''}</td><td style="max-width:100px">${r.dept||''}</td><td style="max-width:80px">${r.spec||''}</td>
      <td><span class="subj-tag" style="background:${sc.bg};color:${sc.fg}">${SUBJ_LABEL[r.subject]||r.subject}</span></td>
      <td><span style="font-size:9px;padding:1px 5px;border-radius:2px;background:${r.track==='rika'?'#e8f0e4':r.track==='bijutsu'?'#f4ece0':'#e8edf8'};color:${r.track==='rika'?'#3a6630':r.track==='bijutsu'?'#7a4a20':'#2c4a8a'}">${{bunka:'文科',rika:'理科',bijutsu:'美術'}[r.track]||'文科'}</span></td>
      <td>${r.tier != null ? `<span style="font-size:9px;padding:1px 6px;border-radius:2px;background:${['#dce4f4','#e8edf8','#e8f0e4','#f4ece0'][r.tier]||'#eee'};color:${['#1a3070','#2c4a8a','#3a6630','#7a4a20'][r.tier]||'#666'};font-weight:500">T${r.tier}</span>` : '<span style="font-size:9px;color:var(--text-muted)">自動</span>'}</td>
      <td>${eraTag}</td>
      <td>${r.jlpt||'—'}</td>
      <td>${r.jlpt_score||'—'}</td>
      <td>${r.eng_type||'—'}</td>
      <td>${r.eng_score?`<span style="font-size:10px;padding:1px 6px;border-radius:2px;background:#e8f4e4;color:#1a4020">${r.eng_score}</span>`:'—'}</td>
      <td>${r.student||'—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-secondary" style="padding:3px 10px;font-size:11px;margin-right:4px" onclick="raOpenEditModal(this)">編集</button>
        <button class="btn btn-danger" style="padding:3px 10px;font-size:11px" onclick="raDoDelete(this)">削除</button>
      </td>
    </tr>`;
  }
  html += '</tbody></table></div>';
  document.getElementById('list-area').innerHTML = html;
}

function raSortList(col) {
  if (raListSortCol === col) raListSortDir *= -1; else { raListSortCol = col; raListSortDir = 1; }
  raRenderList();
}

function raConfirmDelete(id, univ) {
  raShowModal('削除確認', `「${univ}」のレコードを削除しますか？`, async () => {
    try { await raDeleteResult(id); raAllData = raAllData.filter(r => r.id !== id); raRenderList(); raToast('削除しました ✓'); }
    catch(e) { raToast('削除エラー: ' + e.message, false); }
  });
}

function raConfirmDeleteAll() {
  raShowModal('全件削除', `${raAllData.length} 件すべてを削除しますか？この操作は元に戻せません。`, async () => {
    try { await pstDeleteForResults('grad', raAllData.map(r=>r.id)); for (const id of raAllData.map(r=>r.id)) await raSbFetch(`admission_results?id=eq.${id}`, { method:'DELETE', prefer:'return=minimal', headers:{} }); raAllData = []; raRenderList(); raToast('全件削除しました ✓'); }
    catch(e) { raToast('削除エラー: ' + e.message, false); }
  });
}

// ─── 大学院: admission_results ───────────────────────────────────────────────
const raSUBJECTS = [
  { id:'shakai',label:'社会学' },{ id:'fukushi',label:'社会福祉' },{ id:'shinpan',label:'新聞伝播' },
  { id:'keizai',label:'経済学' },{ id:'keiei',label:'経営学' },{ id:'kyoiku',label:'教育学' },
  { id:'hougaku',label:'法学' },{ id:'seiji',label:'政治学/国際関係' },{ id:'bungaku',label:'文学' },
  { id:'rekishi',label:'歴史学' },{ id:'hyosho',label:'表象文化' },{ id:'nihongo',label:'日本語教育' },
  { id:'shinri',label:'心理学' },{ id:'other',label:'その他' },
];

const raSUBJ_COLOR = {
  shakai:{bg:'#ddeaf8',fg:'#1a3a6a'}, fukushi:{bg:'#ddf0e8',fg:'#1a4a30'}, shinpan:{bg:'#ece4f8',fg:'#3a2a7a'},
  keizai:{bg:'#faecd8',fg:'#5a3010'}, keiei:{bg:'#f8e8e0',fg:'#6a2820'}, kyoiku:{bg:'#e8f4e4',fg:'#1a4818'},
  hougaku:{bg:'#f0e8f4',fg:'#4a1a6a'}, seiji:{bg:'#e4eef8',fg:'#1a3060'}, bungaku:{bg:'#f8f0e0',fg:'#5a4010'},
  rekishi:{bg:'#f4ede0',fg:'#6a3800'}, hyosho:{bg:'#fce8f0',fg:'#6a1a40'}, nihongo:{bg:'#e4f4f0',fg:'#0a4038'},
  shinri:{bg:'#faf0e8',fg:'#603018'}, other:{bg:'#eeecea',fg:'#3a3830'},
  rika_kikai:{bg:'#e4f0e8',fg:'#1a4a28'}, rika_denki:{bg:'#dde8f8',fg:'#1a2a6a'},
  rika_kagaku:{bg:'#faf0dc',fg:'#5a3800'}, rika_joho:{bg:'#ece8f8',fg:'#3a1a7a'},
  rika_kenchiku:{bg:'#f0ece0',fg:'#4a3810'}, rika_bio:{bg:'#e4f8f0',fg:'#0a4838'},
  rika_keiei:{bg:'#f8ece0',fg:'#5a3010'}, rika_other:{bg:'#eeecea',fg:'#3a3830'},
};

const raTIERS = {
  0: { label:'T0', name:'旧帝・一橋・東科大 ＋ 早慶上智' },
  1: { label:'T1', name:'G-MARCH・関関同立 ＋ 地方国公立' },
  2: { label:'T2', name:'日駒東専 ＋ 重点女子大・地方私立' },
  3: { label:'T3', name:'その他' },
};

const raT0_UNIVS = ['东京大学','京都大学','大阪大学','名古屋大学','九州大学','东北大学','北海道大学',
  '一桥大学','一橋大学','东京科学大学','东京工业大学','東京科学大学','東京工業大学',
  '早稻田大学','早稲田大学','庆应义塾大学','慶應義塾大学','上智大学','御茶水女子大学','筑波大学'];
const raT1_UNIVS = ['法政大学','明治大学','青山学院大学','立教大学','中央大学','学习院大学','学習院大学',
  '关西大学','関西大学','关西学院大学','関西学院大学','同志社大学','立命馆大学','立命館大学',
  '横滨国立大学','横浜国立大学','横滨市立大学','横浜市立大学','神户大学','神戸大学',
  '埼玉大学','千叶大学','千葉大学','东京都立大学','東京都立大学','金沢大学','金泽大学',
  '广岛大学','広島大学','弘前大学','爱知县立大学','愛知県立大学','大阪公立大学',
  '静冈县立大学','静岡県立大学','东京外国语大学','東京外国語大学','神奈川大学'];
const raT2_UNIVS = ['東洋大学','东洋大学','駒沢大学','驹泽大学','日本大学','専修大学',
  '東京女子大学','东京女子大学','日本女子大学','共立女子大学','甲南女子大学',
  '武蔵大学','武藏大学','成蹊大学','成城大学','武蔵野大学','武藏野大学',
  '都留文科大学','立正大学','大東文化大学','大东文化大学','国士舘大学','国士馆大学',
  '桜美林大学','樱美林大学','拓殖大学','城西大学','城西国際大学','城西国际大学',
  '大正大学','目白大学','淑徳大学','淑德大学','日本経済大学','日本经济大学',
  '桃山学院大学','二松学舎大学','流通科学大学','多摩大学'];

function raTierOf(univ) {
  const u = univ.replace(/\s/g, '');
  if (raT0_UNIVS.some(x => u.includes(x.replace(/\s/g, '')))) return 0;
  if (raT1_UNIVS.some(x => u.includes(x.replace(/\s/g, '')))) return 1;
  if (raT2_UNIVS.some(x => u.includes(x.replace(/\s/g, '')))) return 2;
  return 3;
}

// 请求统一走 admin 的 sb()：自动带当前登录身份，token 过期会续期。path 不含 /rest/v1/ 前缀；opts: { method, body, prefer, headers }
async function raSbFetch(path, opts = {}) {
  const h = Object.assign({}, opts.prefer ? { Prefer: opts.prefer } : {}, opts.headers || {});
  return sb('/rest/v1/' + path, opts.method || 'GET', opts.body || null, Object.keys(h).length ? { headers: h } : null);
}
// 直连 Storage 用的请求头（上传 / 删除 / 取临时链接不能走 sb()）：同样带当前登录身份，先取新鲜 token
async function raAuthHeaders(extra) {
  const t = (await __sbFreshToken()) || __getSbToken() || SB_KEY;
  return Object.assign({ apikey: SB_KEY, Authorization: 'Bearer ' + t }, extra || {});
}

// ════════════════════════════════════════════════════════════════════════
// 本校在籍专业 + 反向记录到学生档案（只做大学院 admission_results）
// ════════════════════════════════════════════════════════════════════════
let raArMajors = [];   // [{key,label,domain}]
let raArMajorsReady = false;
async function raArLoadMajors() {
  try { raArMajors = await raSbFetch('majors?select=key,label,domain&order=domain.asc,label.asc') || []; } catch (e) { raArMajors = []; }
  raArMajorsReady = true;
  ['f', 'em', 'ugf', 'ugem'].forEach(p => raArRenderMajor(p, raArSel[p] || ''));
}
const raArSel = { f: '', em: '', ugf: '', ugem: '' };
function raArEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
const raArOpt = {};   // 前缀 → { domains: 只列哪些领域, first: 排第一的领域, emptyLabel }（海报编辑器用）
function raArRenderMajor(p, sel, opt) {
  const box = document.getElementById(p + '-major-box'); if (!box) return;
  raArSel[p] = sel || '';
  if (opt) raArOpt[p] = opt;
  box.innerHTML = `<input id="${p}-major-q" type="text" placeholder="搜索专业…" oninput="raArFilterMajor('${p}')" style="margin-bottom:4px"><select id="${p}-our-major"></select>`;
  raArFilterMajor(p);
}
function raArFilterMajor(p) {
  const q = ((document.getElementById(p + '-major-q') || {}).value || '').trim().toLowerCase();
  const sel = document.getElementById(p + '-our-major'); if (!sel) return;
  const cur = sel.value || raArSel[p] || '';
  const groups = {};
  const o = raArOpt[p] || {};
  raArMajors.forEach(m => {
    if (o.domains && !o.domains.includes(m.domain || '其他') && m.key !== cur) return;
    if (q && !((m.label || '').toLowerCase().includes(q) || (m.key || '').toLowerCase().includes(q)) && m.key !== cur) return;
    (groups[m.domain || '其他'] = groups[m.domain || '其他'] || []).push(m);
  });
  let doms = Object.keys(groups);
  if (p.startsWith('ug')) doms.sort((a, b) => (/^学部/.test(b) ? 1 : 0) - (/^学部/.test(a) ? 1 : 0));   // 学部：学部的领域排前面
  if (o.first) doms.sort((a, b) => (b === o.first ? 1 : 0) - (a === o.first ? 1 : 0));
  sel.innerHTML = '<option value="">' + (o.emptyLabel || (raIsTeacher() ? '-- 未选择 --' : '-- 不记录到学生档案 --')) + '</option>' + doms.map(d =>
    `<optgroup label="${raArEsc(d)}">${groups[d].map(m => `<option value="${raArEsc(m.key)}"${m.key === cur ? ' selected' : ''}>${raArEsc(m.label)}</option>`).join('')}</optgroup>`).join('');
  sel.onchange = () => { raArSel[p] = sel.value; };
}
function raArGetMajor(p) { const el = document.getElementById(p + '-our-major'); return el ? el.value : (raArSel[p] || ''); }
function raArSetMajor(p, key) {
  raArSel[p] = key || '';
  const q = document.getElementById(p + '-major-q'); if (q) q.value = '';
  raArFilterMajor(p);
}
// 在籍学科（粗分类）→ 真实专业 key；对不上就返回空
function raArGuessMajor(subject) {
  if (!subject || !raArMajors.length) return '';
  const has = k => raArMajors.some(m => m.key === k);
  if (['shakai', 'fukushi', 'shinpan', 'keizai', 'keiei'].includes(subject)) return has(subject) ? subject : '';
  if (subject === 'kyoiku') { const m = raArMajors.find(x => /^教育学?$/.test(x.label || '')) || raArMajors.find(x => /教育学/.test(x.label || '')); return m ? m.key : ''; }
  return '';
}
function raArPreselect(p) {
  const subj = (document.getElementById(p + '-subject') || {}).value;
  const g = raArGuessMajor(subj);
  if (g) raArSetMajor(p, g);
}

// 学生名是不是缩写：A同学 / Aさん / 只有 1–2 个英文字母
function raArRealName(n) {
  n = (n || '').trim();
  if (!n) return false;
  if (/^[A-Za-zＡ-Ｚａ-ｚ][A-Za-zＡ-Ｚａ-ｚ.．\s]{0,1}$/.test(n)) return false;
  if (/^[A-Za-zＡ-Ｚａ-ｚ]{1,2}\s*(同学|同學|さん|サン|君|氏|桑)$/.test(n)) return false;
  if (/^(某|匿名|不明|未知)/.test(n)) return false;
  return true;
}
const raAR_ST_STATUS = { active: '在籍', graduated: '已合格', expired: '已到期', stopped: '停课', withdrawn: '退学' };
function raArPickStudent(list, name) {
  return new Promise(resolve => {
    document.getElementById('ar-pick-modal')?.remove();
    const d = document.createElement('div');
    d.id = 'ar-pick-modal';
    d.className = 'ra-vars';   // 颜色变量（弹层挂在 body 上，不在 #ra-root 里）
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    const done = v => { d.remove(); resolve(v); };
    d.innerHTML = `<div style="background:#fff;border-radius:6px;padding:18px 20px;max-width:460px;width:100%;max-height:88vh;overflow-y:auto">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">学生档案里已有「${raArEsc(name)}」</div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">是同一个人吗？选「是这个学生」不会改他的状态和专业。</div>
      <div id="ar-pick-list"></div>
      <button id="ar-pick-new" style="width:100%;margin-top:6px;padding:8px;border:1px dashed var(--border);background:#fff;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px">新建一个已合格学生（同名不同人）</button>
      <button id="ar-pick-cancel" style="width:100%;margin-top:6px;padding:8px;border:none;background:none;color:var(--text-muted);cursor:pointer;font-family:inherit;font-size:12px">先不记录</button>
    </div>`;
    document.body.appendChild(d);
    const lst = d.querySelector('#ar-pick-list');
    list.forEach(s => {
      const b = document.createElement('div');
      b.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--border);border-radius:4px;margin-bottom:6px;cursor:pointer';
      const mj = (raArMajors.find(m => m.key === s.major) || {}).label || s.major || '未设专业';
      b.innerHTML = `<span style="font-weight:600">${raArEsc(s.name)}</span><span style="color:var(--text-muted);font-size:11px">${raArEsc(mj)} · ${raArEsc(raAR_ST_STATUS[s.status] || s.status || '')}</span><span style="margin-left:auto;color:var(--accent);font-size:11px">是这个学生</span>`;
      b.onclick = () => done(s);
      lst.appendChild(b);
    });
    d.querySelector('#ar-pick-new').onclick = () => done('new');
    d.querySelector('#ar-pick-cancel').onclick = () => done(null);
  });
}
async function raArCreateStudent(row) {
  const rec = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: row.student.trim(), major: row.our_major, status: 'graduated' };
  const res = await raSbFetch('students', { method: 'POST', body: rec });
  return Array.isArray(res) && res[0] ? res[0] : rec;
}
async function raArUpsertPlan(stu, row) {
  const sid = encodeURIComponent(stu.id);
  const plans = await raSbFetch(`student_school_plans?student_id=eq.${sid}&select=id,school_name,faculty`) || [];
  const hit = plans.find(p => (p.school_name || '') === (row.univ || '') && (p.faculty || '') === (row.dept || ''));
  if (hit) {
    await raSbFetch(`student_school_plans?id=eq.${encodeURIComponent(hit.id)}`, { method: 'PATCH', body: { status: 'passed' }, prefer: 'return=minimal', headers: {} });
  } else {
    await raSbFetch('student_school_plans', { method: 'POST', prefer: 'return=minimal', headers: {}, body: {
      id: `ssp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, student_id: stu.id, student_name: stu.name, major: stu.major || row.our_major || '',
      school_name: row.univ, faculty: row.dept || null, department: row.spec || null, status: 'passed' } });
  }
}
async function raArSyncToStudent(row, table) {
  if (raIsTeacher()) return '';   // 老师模式：不写学生档案（管理员之后在 admin 里打开这条再保存一次就会同步）
  table = table || 'admission_results';
  if (!row || !row.our_major || !row.student) return '';
  if (!raArRealName(row.student)) { raToast('学生名是缩写，没有记录到学生档案', false); return ''; }
  try {
    let stu = null, created = false;
    if (row.student_id) {
      const r = await raSbFetch(`students?id=eq.${encodeURIComponent(row.student_id)}&select=id,name,major,status`);
      stu = r && r[0];
    }
    if (!stu) {
      const list = await raSbFetch(`students?name=eq.${encodeURIComponent(row.student.trim())}&select=id,name,major,status`) || [];
      if (!list.length) { stu = await raArCreateStudent(row); created = true; }
      else {
        const pick = await raArPickStudent(list, row.student.trim());
        if (!pick) { raToast('合格实绩已保存，没有记录到学生档案', false); return ''; }
        if (pick === 'new') { stu = await raArCreateStudent(row); created = true; } else stu = pick;
      }
      await raSbFetch(`${table}?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', body: { student_id: stu.id }, prefer: 'return=minimal', headers: {} });
      row.student_id = stu.id;
      const li = (table === 'undergrad_results' ? raUgAllData : raAllData).find(x => x.id === row.id); if (li) li.student_id = stu.id;
    }
    await raArUpsertPlan(stu, row);
    raToast(created ? `✓ 已记录到学生档案：${stu.name}（已合格）` : `✓ 已关联到在籍学生 ${stu.name}`);
    return 'synced';
  } catch (e) {
    const m = (e && e.message) || '';
    raToast(/401|403|row-level|permission|42501/i.test(m) ? '只有管理员能记录到学生档案（合格实绩已保存）' : '记录到学生档案失败：' + m.slice(0, 120), false);
  }
  return '';
}

async function raFetchAllResults() { return sbAll('/rest/v1/admission_results?select=*&order=created_at.desc,id.desc'); }
async function raInsertResult(row) { return raSbFetch('admission_results', { method:'POST', body:row }); }
async function raInsertBatch(rows) {
  const clean = rows.map(r => ({
    ...r,
    jlpt_score: r.jlpt_score != null ? parseInt(r.jlpt_score) || null : null,
    eng_score:  r.eng_score  != null ? parseInt(r.eng_score)  || null : null,
    tier:       r.tier       != null ? parseInt(r.tier)       || null : null,
  }));
  return raSbFetch('admission_results', { method:'POST', body:clean, prefer:'return=representation' });
}
async function raDeleteResult(id) { await pstDeleteForResults('grad', [id]); return raSbFetch(`admission_results?id=eq.${id}`, { method:'DELETE', prefer:'return=minimal', headers:{} }); }
async function raUpdateResult(id, row) { return raSbFetch(`admission_results?id=eq.${id}`, { method:'PATCH', body:row }); }

function raParseJlpt(raw) {
  if (!raw || raw === '—' || raw === '无' || raw === '——') return { jlpt: null, jlpt_score: null };
  const m = raw.match(/^(N[12])\D*(\d+)?/i);
  if (!m) return { jlpt: raw.trim(), jlpt_score: null };
  return { jlpt: m[1].toUpperCase(), jlpt_score: m[2] ? parseInt(m[2]) : null };
}

function raParseEng(raw) {
  if (!raw || raw === '—' || raw === '无' || raw === '——') return { eng_type: null, eng_score: null };
  const upper = raw.toUpperCase();
  let type = null;
  if (upper.includes('TOEIC')) type = 'TOEIC';
  else if (upper.includes('TOEFL')) type = 'TOEFL';
  else if (upper.includes('IELTS')) type = 'IELTS';
  else if (upper.includes('EJU')) type = 'EJU';
  else return { eng_type: raw.trim(), eng_score: null };
  const m = raw.match(/[\d.]+/);
  const score = m ? parseFloat(m[0]) : null;
  return { eng_type: type, eng_score: score ? Math.round(score) : null };
}

// ─── Tier Tab (大学院) ────────────────────────────────────────────────────────
let raTierUnivData = [];
let raTierChanges = {};

async function raLoadTierTab() {
  document.getElementById('tier-area').innerHTML = '<div class="load-state">読み込み中...</div>';
  raTierChanges = {};
  raUpdateTierSaveBtn();
  try {
    const all = await raFetchAllResults();
    const univMap = {};
    for (const r of all) {
      if (!univMap[r.univ]) univMap[r.univ] = { count:0, dbTier: r.tier != null ? r.tier : null, subjSet: new Set() };
      univMap[r.univ].count++;
      if (r.subject) univMap[r.univ].subjSet.add(r.subject);
      if (r.tier != null && univMap[r.univ].dbTier == null) univMap[r.univ].dbTier = r.tier;
    }
    raTierUnivData = Object.entries(univMap).map(([univ, d]) => ({
      univ, count: d.count, autoTier: raTierOf(univ), dbTier: d.dbTier, subjs: [...d.subjSet],
    })).sort((a, b) => a.autoTier - b.autoTier || a.univ.localeCompare(b.univ));
    raRenderTierTable();
  } catch(e) {
    document.getElementById('tier-area').innerHTML = `<div class="load-state" style="color:var(--red)">エラー: ${e.message}</div>`;
  }
}

function raRenderTierTable() {
  const q = (document.getElementById('tier-search')?.value || '');
  const f = document.getElementById('tier-filter')?.value || '';
  let rows = raTierUnivData.filter(d => {
    if (q && !searchMatch(q, [d.univ], { names: 0 })) return false;
    const effective = raTierChanges[d.univ] !== undefined ? raTierChanges[d.univ] : (d.dbTier != null ? d.dbTier : d.autoTier);
    if (f === 'auto' && d.dbTier !== null) return false;
    if (f === 'manual' && d.dbTier === null && raTierChanges[d.univ] === undefined) return false;
    if (f === '0' && effective !== 0) return false;
    if (f === '1' && effective !== 1) return false;
    if (f === '2' && effective !== 2) return false;
    if (f === '3' && effective !== 3) return false;
    return true;
  });

  if (!rows.length) { document.getElementById('tier-area').innerHTML = '<div class="load-state">該当する大学がありません</div>'; return; }

  const TIER_COLOR = { 0:['#dce4f4','#1a3070'], 1:['#e8edf8','#2c4a8a'], 2:['#e8f0e4','#3a6630'], 3:['#f4ece0','#7a4a20'] };
  const SUBJ_LABEL_SHORT = {shakai:'社会学',fukushi:'社会福祉',shinpan:'新聞伝播',keizai:'経済学',keiei:'経営学',kyoiku:'教育学',hougaku:'法学',seiji:'政治学',bungaku:'文学',rekishi:'歴史学',hyosho:'表象',nihongo:'日本語教育',shinri:'心理学',other:'その他'};

  let tableHtml = `<div style="overflow-x:auto"><table class="data-table" style="min-width:600px">
    <thead><tr><th style="min-width:180px">大学名</th><th style="width:60px;text-align:center">件数</th>
    <th style="width:90px;text-align:center">自動判定</th><th style="width:90px;text-align:center">DB設定</th>
    <th style="width:220px">Tier変更</th><th>学科構成</th></tr></thead><tbody>`;

  for (const d of rows) {
    const pending = raTierChanges[d.univ];
    const effective = pending !== undefined ? pending : (d.dbTier != null ? d.dbTier : d.autoTier);
    const isChanged = pending !== undefined;
    const isManual = d.dbTier !== null;
    const [abg, afg] = TIER_COLOR[d.autoTier] || ['#eee','#666'];
    const [dbg, dfg] = d.dbTier != null ? (TIER_COLOR[d.dbTier] || ['#eee','#666']) : ['#f0ede6','#9a9590'];

    const subjTags = d.subjs.slice(0,3).map(s =>
      `<span style="font-size:9px;padding:1px 5px;border-radius:2px;background:${raSUBJ_COLOR[s]?.bg||'#eee'};color:${raSUBJ_COLOR[s]?.fg||'#666'};margin-right:3px">${SUBJ_LABEL_SHORT[s]||s}</span>`
    ).join('');

    const rowBg = isChanged ? 'background:#fffbe8' : '';
    tableHtml += `<tr style="${rowBg}">
      <td><span style="font-weight:500">${d.univ}</span>
        ${isManual ? '<span style="font-size:9px;margin-left:6px;padding:1px 5px;border-radius:2px;background:#e8f0f8;color:#2c4a8a">手動設定済み</span>' : ''}
        ${isChanged ? '<span style="font-size:9px;margin-left:6px;padding:1px 5px;border-radius:2px;background:#fff0c8;color:#5a4000">変更あり</span>' : ''}
      </td>
      <td style="text-align:center;color:var(--text-muted)">${d.count}</td>
      <td style="text-align:center"><span style="font-size:10px;padding:2px 8px;border-radius:2px;background:${abg};color:${afg};font-weight:500">T${d.autoTier}</span></td>
      <td style="text-align:center">${d.dbTier != null ? `<span style="font-size:10px;padding:2px 8px;border-radius:2px;background:${dbg};color:${dfg};font-weight:500">T${d.dbTier}</span>` : `<span style="font-size:10px;color:var(--text-muted)">—</span>`}</td>
      <td><div style="display:flex;gap:4px;align-items:center">
        ${[0,1,2,3].map(t => {
          const active = effective === t;
          const [bg,fg] = TIER_COLOR[t];
          return `<button onclick="raSetTierChange('${d.univ.replace(/'/g,"\\'")}',${t})"
            style="padding:3px 9px;border-radius:2px;border:1px solid ${active?fg:bg};background:${active?fg:'transparent'};color:${active?'#fff':fg};font-family:inherit;font-size:10px;font-weight:500;cursor:pointer;transition:all .12s">T${t}</button>`;
        }).join('')}
        <button onclick="raSetTierChange('${d.univ.replace(/'/g,"\\'")}',null)" style="padding:3px 8px;border-radius:2px;border:1px solid var(--border);background:transparent;color:var(--text-muted);font-family:inherit;font-size:10px;cursor:pointer">自動</button>
      </div></td>
      <td>${subjTags}${d.subjs.length > 3 ? `<span style="font-size:9px;color:var(--text-muted)">+${d.subjs.length-3}</span>` : ''}</td>
    </tr>`;
  }
  tableHtml += '</tbody></table></div>';
  document.getElementById('tier-area').innerHTML = tableHtml;
}

function raSetTierChange(univ, tier) {
  const d = raTierUnivData.find(x => x.univ === univ);
  if (!d) return;
  if (tier === d.dbTier || (tier === null && d.dbTier === null)) delete raTierChanges[univ];
  else raTierChanges[univ] = tier;
  raUpdateTierSaveBtn();
  raRenderTierTable();
}

function raUpdateTierSaveBtn() {
  const n = Object.keys(raTierChanges).length;
  const btn = document.getElementById('tier-save-btn');
  if (!btn) return;
  btn.disabled = n === 0;
  btn.textContent = `変更を保存（${n}件）`;
}

async function raSaveTierChanges() {
  const entries = Object.entries(raTierChanges);
  if (!entries.length) return;
  const btn = document.getElementById('tier-save-btn');
  btn.disabled = true; btn.textContent = '保存中...';
  const status = document.getElementById('tier-status');
  let done = 0;
  try {
    for (const [univ, tier] of entries) {
      await raSbFetch(`admission_results?univ=eq.${encodeURIComponent(univ)}`, { method:'PATCH', body:{tier}, prefer:'return=minimal', headers:{} });
      done++; status.textContent = `${done} / ${entries.length} 件処理中...`;
    }
    raToast(`${done} 大学のTierを更新しました ✓`);
    raTierChanges = {};
    await raLoadTierTab();
  } catch(e) { raToast('エラー: ' + e.message, false); btn.disabled = false; raUpdateTierSaveBtn(); }
}

// ─── 既存データの語学スコア修復 ────────────────────────────────────────────────
async function raHandleRepairFile(file) {
  if (!file) return;
  const status = document.getElementById('repair-status');
  status.textContent = '読み込み中...';
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const wb = XLSX.read(e.target.result, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
      if (rows.length < 2) { status.textContent = 'データが空です'; return; }
      const headers = rows[0].map(String);
      const dataRows = rows.slice(1).filter(r => r.some(c => c !== ''));
      function findCol(keywords) { return headers.findIndex(h => keywords.some(k => h.toLowerCase().includes(k))); }
      const univCol = findCol(['大学','学校','univ']);
      const deptCol = findCol(['研究科','dept']);
      const jlptCol = findCol(['jlpt','日語','日语']);
      const engCol  = findCol(['英語','toeic','toefl','英语','英']);
      if (univCol === -1) { status.textContent = '大学名の列が見つかりません'; return; }
      status.textContent = `${dataRows.length} 件を処理中...`;
      const all = await raFetchAllResults();
      let updated = 0, skipped = 0;
      for (const row of dataRows) {
        const univ = String(row[univCol] || '').trim();
        if (!univ) continue;
        const jlptRaw = jlptCol >= 0 ? String(row[jlptCol] || '') : '';
        const engRaw  = engCol  >= 0 ? String(row[engCol]  || '') : '';
        const { jlpt, jlpt_score } = raParseJlpt(jlptRaw);
        const { eng_type, eng_score } = raParseEng(engRaw);
        if (!jlpt && !eng_type) { skipped++; continue; }
        const dept = deptCol >= 0 ? String(row[deptCol] || '').trim() : '';
        const matches = all.filter(r => {
          if (raNormUnivAdmin(r.univ) !== raNormUnivAdmin(univ)) return false;
          if (dept && r.dept && !r.dept.includes(dept) && !dept.includes(r.dept)) return false;
          return true;
        });
        for (const rec of matches) {
          if (rec.jlpt || rec.eng_type) { skipped++; continue; }
          await raSbFetch(`admission_results?id=eq.${rec.id}`, { method:'PATCH', body:{jlpt,jlpt_score,eng_type,eng_score}, prefer:'return=minimal', headers:{} });
          updated++;
        }
      }
      status.textContent = `完了: ${updated} 件更新, ${skipped} 件スキップ ✓`;
      document.getElementById('repair-input').value = '';
    } catch(err) { status.textContent = 'エラー: ' + err.message; }
  };
  reader.readAsArrayBuffer(file);
}

function raNormUnivAdmin(u) {
  if (!u) return '';
  const map = {
    '早稻田大学':'早稲田大学','一桥大学':'一橋大学','东京大学':'東京大学','大阪大学':'大阪大学',
    '庆应义塾大学':'慶應義塾大学','慶応義塾大学':'慶應義塾大学','立命馆大学':'立命館大学',
    '关西大学':'関西大学','关西学院大学':'関西学院大学','东洋大学':'東洋大学','驹泽大学':'駒沢大学','武藏大学':'武蔵大学',
  };
  return map[u.trim()] || u.trim();
}

// ════════════════════════════════════════════════════════════════════════
// 学部 (undergrad_results) ロジック
// ════════════════════════════════════════════════════════════════════════

const raUG_TABLE = 'undergrad_results';
let raUgAllData = [];
let raUgDataLoaded = false;
let raUgListSortCol = 'created_at', raUgListSortDir = -1;
let raUgUploadRows = [], raUgUploadColMap = {}, raUgUploadHeaders = [];

async function raUgFetchAll() { return sbAll(`/rest/v1/${raUG_TABLE}?select=*&order=created_at.desc,id.desc`); }
async function raUgInsertOne(row) { return raSbFetch(raUG_TABLE, { method:'POST', body:row }); }
async function raUgInsertBatch(rows) {
  const clean = rows.map(r => ({ ...r, tier: r.tier != null ? parseInt(r.tier)||null : null }));
  return raSbFetch(raUG_TABLE, { method:'POST', body:clean, prefer:'return=representation' });
}
async function raUgDeleteOne(id) { await pstDeleteForResults('ug', [id]); return raSbFetch(`${raUG_TABLE}?id=eq.${id}`, { method:'DELETE', prefer:'return=minimal', headers:{} }); }

// ─── Tier dict (T0-T4 + school_type) ────────────────────────────────────────
const raUG_TIER_INFO = {
  0: { label:'T0', name:'旧帝大・東工大クラス ＋ 早慶上理ICU' },
  1: { label:'T1', name:'上位国公立 ＋ MARCH・関関同立' },
  2: { label:'T2', name:'地方国公立 ＋ 日東駒専・成成明学国武独等' },
  3: { label:'T3', name:'大東亜帝国クラス' },
  4: { label:'T4', name:'保底校' },
};

const raUG_SCHOOL_DB = {
  '東京大学':{tier:0,type:'public'}, '東京科学大学':{tier:0,type:'public'}, '北海道大学':{tier:0,type:'public'},
  '早稲田大学':{tier:0,type:'private'}, '慶應義塾大学':{tier:0,type:'private'}, '上智大学':{tier:0,type:'private'},
  '東京理科大学':{tier:0,type:'private'}, '国際基督教大学':{tier:0,type:'private'},
  '千葉大学':{tier:1,type:'public'}, '横浜国立大学':{tier:1,type:'public'}, '電気通信大学':{tier:1,type:'public'},
  '筑波大学':{tier:1,type:'public'}, '横浜市立大学':{tier:1,type:'public'},
  '中央大学':{tier:1,type:'private'}, '関西大学':{tier:1,type:'private'}, '関西学院大学':{tier:1,type:'private'},
  '同志社大学':{tier:1,type:'private'}, '明治大学':{tier:1,type:'private'}, '法政大学':{tier:1,type:'private'},
  '立命館大学':{tier:1,type:'private'}, '立教大学':{tier:1,type:'private'}, '青山学院大学':{tier:1,type:'private'},
  '旭川市立大学':{tier:2,type:'public'}, '秋田大学':{tier:2,type:'public'}, '茨城大学':{tier:2,type:'public'}, '長崎大学':{tier:2,type:'public'},
  '専修大学':{tier:2,type:'private'}, '東京電機大学':{tier:2,type:'private'}, '東洋大学':{tier:2,type:'private'},
  '日本大学':{tier:2,type:'private'}, '日本女子大学':{tier:2,type:'private'}, '明治学院大学':{tier:2,type:'private'},
  '独協大学':{tier:2,type:'private'}, '近畿大学':{tier:2,type:'private'}, '順天堂大学':{tier:2,type:'private'},
  '駒澤大学':{tier:2,type:'private'}, '龍谷大学':{tier:2,type:'private'},
  '東京工科大学':{tier:3,type:'private'}, '東海大学':{tier:3,type:'private'}, '二松学舎大学':{tier:3,type:'private'},
  '京都外国語大学':{tier:3,type:'private'}, '国士舘大学':{tier:3,type:'private'}, '聖心女子大学':{tier:3,type:'private'},
  '大東文化大学':{tier:3,type:'private'}, '帝京大学':{tier:3,type:'private'}, '成安造形大学':{tier:3,type:'private'},
  '桃山学院大学':{tier:3,type:'private'}, '武蔵野大学':{tier:3,type:'private'}, '神奈川大学':{tier:3,type:'private'},
  '福岡大学':{tier:3,type:'private'}, '大手前大学':{tier:3,type:'private'},
  '東京工芸大学':{tier:4,type:'private'}, '京東光華大学':{tier:4,type:'private'}, '兵庫大学':{tier:4,type:'private'},
  '岡山理科大学':{tier:4,type:'private'}, '和光大学':{tier:4,type:'private'}, '聖学院大学':{tier:4,type:'private'},
  '多摩大学':{tier:4,type:'private'}, '大阪工業大学':{tier:4,type:'private'}, '大阪経済法科大学':{tier:4,type:'private'},
  '大阪観光大学':{tier:4,type:'private'}, '帝京平成大学':{tier:4,type:'private'}, '帝京科学大学':{tier:4,type:'private'},
  '平成国際大学':{tier:4,type:'private'}, '拓殖大学':{tier:4,type:'private'}, '文化学園大学':{tier:4,type:'private'},
  '日本工業大学':{tier:4,type:'private'}, '明海大学':{tier:4,type:'private'}, '札幌学院大学':{tier:4,type:'private'},
  '桜美林大学':{tier:4,type:'private'}, '江戸川大学':{tier:4,type:'private'}, '流通経済大学':{tier:4,type:'private'},
  '湘南工科大学':{tier:4,type:'private'}, '神奈川工科大学':{tier:4,type:'private'}, '福岡女子大学':{tier:4,type:'public'},
  '立正大学':{tier:4,type:'private'}, '西武文理大学':{tier:4,type:'private'}, '足利大学':{tier:4,type:'private'},
  '長崎総合科学大学':{tier:4,type:'private'}, '青森大学':{tier:4,type:'private'}, '駿河台大学':{tier:4,type:'private'},
  '北洋大学':{tier:4,type:'private'}, '千葉科学大学':{tier:4,type:'private'}, '山梨学院大学':{tier:4,type:'private'},
  '徳島文理大学':{tier:4,type:'private'}, '第一工科大学':{tier:4,type:'private'}, '至誠館大学':{tier:4,type:'private'},
};

const raUG_UNIV_NORM = {
  '拓値大学':'拓殖大学', '京东光华大学':'京東光華大学', '横滨国立大学（尹老师母校！！！！！':'横浜国立大学',
  '东京大学':'東京大学','东京科学大学':'東京科学大学','北海道大学':'北海道大学',
  '早稻田大学':'早稲田大学','庆应义塾大学':'慶應義塾大学','上智大学':'上智大学',
  '东京理科大学':'東京理科大学','ICU大学':'国際基督教大学','国际基督教大学':'国際基督教大学',
  '千叶大学':'千葉大学','横滨国立大学':'横浜国立大学','电气通信大学':'電気通信大学',
  '筑波大学':'筑波大学','横滨市立大学':'横浜市立大学',
  '中央大学':'中央大学','关西大学':'関西大学','关西学院大学':'関西学院大学',
  '同志社大学':'同志社大学','明治大学':'明治大学','法政大学':'法政大学',
  '立命馆大学':'立命館大学','立教大学':'立教大学','青山学院大学':'青山学院大学',
  '旭川市立大学':'旭川市立大学','秋田大学':'秋田大学','茨城大学':'茨城大学','长崎大学':'長崎大学',
  '专修大学':'専修大学','东京电机大学':'東京電機大学','东洋大学':'東洋大学',
  '日本大学':'日本大学','日本女子大学':'日本女子大学','明治学院大学':'明治学院大学',
  '独协大学':'独協大学','近畿大学':'近畿大学','顺天堂大学':'順天堂大学',
  '驹泽大学':'駒澤大学','龙谷大学':'龍谷大学',
  '东京工科大学':'東京工科大学','东海大学':'東海大学','二松学舍大学':'二松学舎大学',
  '京都外国语大学 大手前大学':'京都外国語大学','京都外国语大学':'京都外国語大学',
  '国士馆大学':'国士舘大学','圣心女子大学':'聖心女子大学','大东文化大学':'大東文化大学',
  '帝京大学（海外出愿）':'帝京大学','武藏野大学':'武蔵野大学','福冈大学':'福岡大学',
  '东京工艺大学':'東京工芸大学','兵库大学':'兵庫大学','冈山理科大学':'岡山理科大学','圣学院大学':'聖学院大学',
  '大阪工业大学':'大阪工業大学','大阪经济法科':'大阪経済法科大学','大阪经济法科大学':'大阪経済法科大学',
  '大阪观光大学':'大阪観光大学','平成国际大学':'平成国際大学','文化学园大学':'文化学園大学',
  '日本工业大学':'日本工業大学','札幌学院大学':'札幌学院大学','樱美林大学':'桜美林大学',
  '江户川大学':'江戸川大学','流通经济大学':'流通経済大学','福冈女子大学':'福岡女子大学',
  '长崎综合科学大学':'長崎総合科学大学','骏河台大学':'駿河台大学','千叶科学大学':'千葉科学大学',
  '徳岛文理大学':'徳島文理大学','至诚馆大学':'至誠館大学',
};

function raNormUnivUG(u) { if (!u) return u; const t = u.trim(); return raUG_UNIV_NORM[t] || t; }
function raUgTierOf(univ) { return raUG_SCHOOL_DB[raNormUnivUG(univ)]?.tier ?? 4; }
function raUgSchoolType(univ) { return raUG_SCHOOL_DB[raNormUnivUG(univ)]?.type ?? 'private'; }

function raSwitchUgTab(t) {
  ['add','excel','list','tier','photos'].forEach(id => { const el=document.getElementById(`ugtab-${id}`); if(el) el.style.display = id===t?'':'none'; });
  document.querySelectorAll('#major-ug .tab-btn').forEach((b,i) => b.classList.toggle('active', ['add','excel','list','tier','photos'][i]===t));
  if (t === 'photos') raLoadPhotos('ug');
  if (t === 'list') raUgLoadList();
  if (t === 'tier') raUgLoadTierTab();
}

function raUgResetForm() {
  ['ug-f-univ','ug-f-dept','ug-f-spec','ug-f-student','ug-f-eju-jp','ug-f-eju-kijutsu','ug-f-eju-bunsou',
   'ug-f-eju-math','ug-f-eju-phys','ug-f-eju-chem','ug-f-eju-bio','ug-f-eju-total','ug-f-toefl','ug-f-toeic','ug-f-note'].forEach(id => {
    document.getElementById(id).value = '';
  });
  ['ug-f-track','ug-f-era','ug-f-tier','ug-f-jlpt'].forEach(id => document.getElementById(id).selectedIndex = 0);
  raArSetMajor('ugf', '');
  document.getElementById('ug-f-photo').value = '';
  document.getElementById('ug-f-photo-box').innerHTML = '';
}

async function raUgSubmitForm(btn, force) {
  if (btn && btn.disabled) return;
  const univ = document.getElementById('ug-f-univ').value.trim();
  if (!univ) { raToast('大学名を入力してください', false); return; }
  const num = id => { const v = document.getElementById(id).value; return v !== '' ? parseInt(v) : null; };

  const row = {
    univ, dept: document.getElementById('ug-f-dept').value.trim()||null,
    spec: document.getElementById('ug-f-spec').value.trim()||null,
    student: document.getElementById('ug-f-student').value.trim()||null,
    track: document.getElementById('ug-f-track').value,
    era: document.getElementById('ug-f-era').value,
    tier: document.getElementById('ug-f-tier').value !== '' ? parseInt(document.getElementById('ug-f-tier').value) : null,
    school_type: raUgSchoolType(univ),
    eju_japanese: num('ug-f-eju-jp'), eju_kijutsu: num('ug-f-eju-kijutsu'), eju_bunsou: num('ug-f-eju-bunsou'),
    eju_math: num('ug-f-eju-math'), eju_physics: num('ug-f-eju-phys'), eju_chemistry: num('ug-f-eju-chem'),
    eju_biology: num('ug-f-eju-bio'), eju_total: num('ug-f-eju-total'),
    jlpt: document.getElementById('ug-f-jlpt').value || null,
    toefl: num('ug-f-toefl'), toeic: num('ug-f-toeic'),
    note: document.getElementById('ug-f-note').value.trim()||null,
    our_major: raArGetMajor('ugf') || null,
  };

  if (!force && raLastSaved.ug === raSavedKey(row)) {
    raShowModal('重复确认', '刚刚已经保存过一条相同的，还要再存一条吗？', () => raUgSubmitForm(btn, true));
    return;
  }
  const file = document.getElementById('ug-f-photo').files[0];
  raBtnBusy(btn, '保存中…'); raSaveMsg('ug-f-save-msg', '', '');
  try {
    const ins = await raUgInsertOne(row);
    const saved = Array.isArray(ins) ? ins[0] : null;
    raLastSaved.ug = raSavedKey(row);
    let phOk = true, synced = false;
    if (file) { raBtnBusy(btn, '上传截图中…'); phOk = await raAddPhotoAfterInsert('ug', saved, file); }
    if (saved && row.our_major && row.student && !raIsTeacher()) { raBtnBusy(btn, '同步学生档案中…'); synced = (await raArSyncToStudent(saved,'undergrad_results')) === 'synced'; }
    const label = [row.univ, row.dept, row.student].filter(Boolean).join(' · ');
    const tail = synced ? ' · 已记录到学生档案' : '';
    if (phOk) raSaveMsg('ug-f-save-msg', 'ok', `✓ 已保存：${label}（${raNowHM()}）${file ? ' · 含截图' : ''}${tail}`);
    else raSaveMsg('ug-f-save-msg', 'warn', `合格实绩已保存（${label}），截图上传失败，请在数据管理里补传${tail}`);
    raToast(phOk ? '保存しました ✓' : '合格实绩已保存，但截图上传失败，请在「数据管理」编辑里补传', phOk);
    raUgResetForm(); raUgRefreshUnivList();
  } catch (e) {
    raSaveMsg('ug-f-save-msg', 'err', '保存失败：' + e.message + '（表单内容还在，可直接再点保存）');
    raToast('エラー: ' + e.message, false);
  } finally { raBtnDone(btn); }
}

async function raUgRefreshUnivList() {
  try {
    const data = await raUgFetchAll();
    const univs = [...new Set(data.map(d => d.univ))].sort();
    document.getElementById('ug-univ-list').innerHTML = univs.map(u => `<option value="${u}">`).join('');
  } catch(e) {}
}

const raUG_FIELD_DEFS = [
  { key:'univ', label:'大学名 *' }, { key:'dept', label:'学部名' }, { key:'spec', label:'学科名' },
  { key:'student', label:'学生名' }, { key:'track', label:'系統（学部理科/学部文科）' }, { key:'era', label:'年度' },
  { key:'eju_japanese', label:'EJU日本語' }, { key:'eju_kijutsu', label:'EJU記述' },
  { key:'eju_bunsou', label:'EJU文系総合' }, { key:'eju_math', label:'EJU数学' },
  { key:'eju_physics', label:'EJU物理' }, { key:'eju_chemistry', label:'EJU化学' },
  { key:'eju_biology', label:'EJU生物' }, { key:'eju_total', label:'EJU総分' },
  { key:'toefl', label:'TOEFL' }, { key:'toeic', label:'TOEIC' }, { key:'jlpt', label:'JLPT' },
  { key:'tier', label:'学校等级（元データ）' },
];

function raUgHandleFile(file) {
  if (!file) return;
  document.getElementById('ug-upload-zone').textContent = `読み込み中: ${file.name}`;
  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(e.target.result, { type:'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
    if (!rows.length) { raToast('データが空です', false); return; }
    raUgUploadHeaders = rows[0].map(String);
    raUgUploadRows = rows.slice(1).filter(r => r.some(c => c !== ''));
    raUgBuildMappingUI();
  };
  reader.readAsArrayBuffer(file);
}

function raUgBuildMappingUI() {
  document.getElementById('ug-mapping-fields').innerHTML = raUG_FIELD_DEFS.map(fd => `
    <div class="field"><label>${fd.label}</label>
      <select id="ug-map-${fd.key}">
        <option value="">— スキップ —</option>
        ${raUgUploadHeaders.map((h,i) => `<option value="${i}" ${raUgGuessCol(h,fd.key)?'selected':''}>${h}</option>`).join('')}
      </select></div>`).join('');
  document.getElementById('ug-col-mapping').style.display = '';
  document.getElementById('ug-upload-zone').style.display = 'none';
  document.getElementById('ug-import-preview').style.display = 'none';
}

function raUgGuessCol(header, key) {
  const h = header.toLowerCase();
  const guesses = {
    univ:['大学','学校名（中文', '学校名（日'], dept:['学部名'], spec:['学科名'],
    student:['学生姓名','学生名'], track:['学科'], era:['年份','年度'],
    eju_japanese:['eju日语','eju日本語'], eju_kijutsu:['eju记述','eju記述'],
    eju_bunsou:['eju文综','eju文系'], eju_math:['eju数学'], eju_physics:['eju物理'],
    eju_chemistry:['eju化学'], eju_biology:['eju生物'], eju_total:['eju总分','eju総分'],
    toefl:['托福','toefl'], toeic:['托业','toeic'], jlpt:['jlpt'], tier:['学校等级','学校等級'],
  };
  return (guesses[key]||[]).some(g => h.includes(g));
}

function raUgGetColIndex(key) {
  const v = document.getElementById(`ug-map-${key}`)?.value;
  return v !== '' && v !== undefined ? parseInt(v) : null;
}

function raUgPreviewImport() {
  const univIdx = raUgGetColIndex('univ');
  if (univIdx === null) { raToast('大学名の列を選択してください', false); return; }
  raUgUploadColMap = {};
  raUG_FIELD_DEFS.forEach(fd => raUgUploadColMap[fd.key] = raUgGetColIndex(fd.key));

  const preview = raUgUploadRows.slice(0,5);
  const headers = ['大学名','学部','学科','系統','年度','Tier(元)','EJU総分','JLPT'];
  let html = `<table class="preview-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>`;
  for (const row of preview) {
    const m = raUgMapRow(row);
    html += `<tr><td>${m.univ||''}</td><td>${m.dept||''}</td><td>${m.spec||''}</td>
      <td>${m.track==='rika'?'理科':m.track==='bijutsu'?'美術':'文科'}</td>
      <td>${m.era||''}</td><td>${m.tier!=null?'T'+m.tier:'自動'}</td>
      <td>${m.eju_total||''}</td><td>${m.jlpt||''}</td></tr>`;
  }
  html += '</tbody></table>';
  document.getElementById('ug-preview-wrap').innerHTML = html;
  document.getElementById('ug-import-count').textContent = raUgUploadRows.length;
  document.getElementById('ug-col-mapping').style.display = 'none';
  document.getElementById('ug-import-preview').style.display = '';
}

function raUgMapRow(row) {
  const get = key => { const i = raUgUploadColMap[key]; return (i!=null) ? String(row[i]??'').trim() : ''; };
  const getNum = key => { const v = get(key); return v!=='' && v!=='None' && !isNaN(parseFloat(v)) ? Math.round(parseFloat(v)) : null; };

  let trackRaw = get('track');
  let track = 'bunka';
  if (trackRaw.includes('理科')) track = 'rika';
  else if (trackRaw.includes('美术') || trackRaw.includes('美術')) track = 'bijutsu';
  else if (trackRaw.includes('文科')) track = 'bunka';

  let eraRaw = get('era');
  let era = 'new';
  const yearNum = parseInt(eraRaw);
  if (!isNaN(yearNum)) era = (yearNum >= 2025) ? 'new' : 'hist';

  const univRaw = get('univ');
  const univ = raNormUnivUG(univRaw);

  const origTierLabel = get('tier');
  let tier = null;
  const TIER_LABEL_MAP = {
    'SS帝大':0, 'SS顶尖私立-早庆上理ICU':0,
    'AA超一流国公立':1, 'AA超一流私立march关关同立等':1, 'A一流国公立':1,
    'A中坚私立-日东专驹四工大成成明学国武独等':2, 'A地方国公立':2,
    'C知名学校-大东亚帝国等':3, 'D相对保底':4, 'E稳妥保底':4,
  };
  if (origTierLabel && TIER_LABEL_MAP[origTierLabel] !== undefined) tier = TIER_LABEL_MAP[origTierLabel];

  return {
    univ: univ || null, dept: get('dept') || null, spec: get('spec') || null, student: get('student') || null,
    track, era, tier, school_type: univ ? raUgSchoolType(univ) : null,
    eju_japanese: getNum('eju_japanese'), eju_kijutsu: getNum('eju_kijutsu'),
    eju_bunsou: getNum('eju_bunsou'), eju_math: getNum('eju_math'),
    eju_physics: getNum('eju_physics'), eju_chemistry: getNum('eju_chemistry'),
    eju_biology: getNum('eju_biology'), eju_total: getNum('eju_total'),
    jlpt: (() => { const v=get('jlpt'); return (v && v!=='None' && v!=='无') ? v : null; })(),
    toefl: getNum('toefl'), toeic: getNum('toeic'), note: null,
  };
}

async function raUgExecuteImport() {
  const btn = document.getElementById('ug-import-btn');
  btn.disabled = true;
  const prog = document.getElementById('ug-import-progress');
  const fill = document.getElementById('ug-progress-fill');
  const label = document.getElementById('ug-progress-label');
  prog.classList.add('show');
  const rows = raUgUploadRows.map(raUgMapRow).filter(r => r.univ);
  const BATCH = 50;
  let done = 0;
  try {
    for (let i=0; i<rows.length; i+=BATCH) {
      const batch = rows.slice(i, i+BATCH);
      await raUgInsertBatch(batch);
      done += batch.length;
      fill.style.width = Math.round(done/rows.length*100) + '%';
      label.textContent = `${done} / ${rows.length} 件処理済み`;
    }
    raToast(`${done} 件をインポートしました ✓`);
    raUgResetUpload();
  } catch(e) { raToast('インポートエラー: ' + e.message, false); btn.disabled = false; }
}

function raUgResetUpload() {
  document.getElementById('ug-upload-zone').style.display = '';
  document.getElementById('ug-upload-zone').innerHTML = `
    <input type="file" id="ug-file-input" accept=".xlsx,.xls,.csv" onchange="raUgHandleFile(this.files[0])">
    <div style="font-size:14px;margin-bottom:6px">クリックまたはドラッグ＆ドロップ</div>
    <div style="font-size:11px">.xlsx / .xls / .csv 対応</div>`;
  document.getElementById('ug-col-mapping').style.display = 'none';
  document.getElementById('ug-import-preview').style.display = 'none';
  document.getElementById('ug-import-progress').classList.remove('show');
  raUgUploadRows = []; raUgUploadColMap = {}; raUgUploadHeaders = [];
}

async function raUgLoadList() {
  document.getElementById('ug-list-area').innerHTML = '<div class="load-state">読み込み中...</div>';
  try { raUgAllData = await raUgFetchAll(); raUgRenderList(); }
  catch(e) { document.getElementById('ug-list-area').innerHTML = `<div class="load-state" style="color:var(--red)">エラー: ${e.message}</div>`; }
}

function raUgRenderList() {
  const q = document.getElementById('ug-search-input').value;
  const ft = document.getElementById('ug-filter-track').value;
  const fe = document.getElementById('ug-filter-era').value;
  const fT = document.getElementById('ug-filter-tier').value;

  let rows = raUgAllData.filter(r => {
    if (ft && r.track !== ft) return false;
    if (fe && r.era !== fe) return false;
    if (fT !== '' && String(r.tier ?? raUgTierOf(r.univ)) !== fT) return false;
    if (q && !searchMatch(q, [r.student, r.univ, r.dept, r.spec])) return false;
    return true;
  });

  rows.sort((a,b) => {
    let av=a[raUgListSortCol]??'', bv=b[raUgListSortCol]??'';
    if (typeof av === 'string') return av.localeCompare(bv) * raUgListSortDir;
    return (av-bv) * raUgListSortDir;
  });

  document.getElementById('ug-result-count').textContent = `${rows.length} 件`;
  if (!rows.length) { document.getElementById('ug-list-area').innerHTML = '<div class="load-state">データが見つかりません</div>'; return; }

  const TRACK_LABEL = {bunka:'文科',rika:'理科',bijutsu:'美術'};
  const TIER_COLOR = {0:['#dce4f4','#1a3070'],1:['#e8edf8','#2c4a8a'],2:['#e8f0e4','#3a6630'],3:['#f4ece0','#7a4a20'],4:['#f4e0e0','#7a2020']};

  let html = `<div class="data-table-wrap"><table class="data-table"><thead><tr>
    <th onclick="raUgSortList('univ')">大学名</th><th onclick="raUgSortList('dept')">学部</th><th onclick="raUgSortList('spec')">学科</th>
    <th onclick="raUgSortList('track')">系統</th><th onclick="raUgSortList('era')">年度</th><th onclick="raUgSortList('tier')">Tier</th>
    <th>区分</th><th onclick="raUgSortList('eju_total')">EJU総分</th><th onclick="raUgSortList('jlpt')">JLPT</th>
    <th onclick="raUgSortList('toefl')">TOEFL</th><th onclick="raUgSortList('toeic')">TOEIC</th><th onclick="raUgSortList('student')">学生</th><th>操作</th>
  </tr></thead><tbody>`;

  for (const r of rows) {
    const tier = r.tier != null ? r.tier : raUgTierOf(r.univ);
    const [tbg, tfg] = TIER_COLOR[tier] || ['#eee','#666'];
    const stype = r.school_type || raUgSchoolType(r.univ);
    html += `<tr data-id="${r.id}" data-univ="${(r.univ||'').replace(/"/g,'&quot;')}">
      <td style="max-width:100px">${r.univ||''}</td><td style="max-width:100px">${r.dept||''}</td><td style="max-width:80px">${r.spec||''}</td>
      <td><span class="track-tag" style="background:#eef0e8;color:#3a3830">${TRACK_LABEL[r.track]||'文科'}</span></td>
      <td>${r.era==='new'?'26–27':'22–25'}</td>
      <td><span class="tier-tag" style="background:${tbg};color:${tfg}">T${tier}${r.tier==null?'(自動)':''}</span></td>
      <td><span class="type-tag" style="background:${stype==='public'?'#e0eef8':'#f4ece0'};color:${stype==='public'?'#1a3a6a':'#5a3010'}">${stype==='public'?'国公立':'私立'}</span></td>
      <td>${r.eju_total||'—'}</td><td>${r.jlpt||'—'}</td><td>${r.toefl||'—'}</td><td>${r.toeic||'—'}</td><td>${r.student||'—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-secondary" style="padding:3px 8px;font-size:10px;margin-right:3px" onclick="raUgOpenEditModal(this)">編集</button>
        <button class="btn btn-danger" style="padding:3px 8px;font-size:10px" onclick="raUgDoDelete(this)">削除</button>
      </td>
    </tr>`;
  }
  html += '</tbody></table></div>';
  document.getElementById('ug-list-area').innerHTML = html;
}

function raUgSortList(col) {
  if (raUgListSortCol === col) raUgListSortDir *= -1; else { raUgListSortCol = col; raUgListSortDir = 1; }
  raUgRenderList();
}

function raUgConfirmDelete(id, univ) {
  raShowModal('削除確認', `「${univ}」のレコードを削除しますか？`, async () => {
    try { await raUgDeleteOne(id); raUgAllData = raUgAllData.filter(r=>r.id!==id); raUgRenderList(); raToast('削除しました ✓'); }
    catch(e) { raToast('削除エラー: ' + e.message, false); }
  });
}

function raUgConfirmDeleteAll() {
  raShowModal('全件削除', `${raUgAllData.length} 件すべてを削除しますか？この操作は元に戻せません。`, async () => {
    try { await pstDeleteForResults('ug', raUgAllData.map(r=>r.id)); for (const r of raUgAllData) await raSbFetch(`${raUG_TABLE}?id=eq.${r.id}`, { method:'DELETE', prefer:'return=minimal', headers:{} }); raUgAllData = []; raUgRenderList(); raToast('全件削除しました ✓'); }
    catch(e) { raToast('削除エラー: ' + e.message, false); }
  });
}

// ─── 編集モーダル ────────────────────────────────────────────────────────────
function raOpenEditModal(el) {
  const id = typeof el === 'string' ? el : el.closest('tr').dataset.id;
  const r = raAllData.find(x => x.id === id);
  if (!r) return;
  document.getElementById('em-id').value = id;
  document.getElementById('em-err').textContent = '';
  document.getElementById('em-univ').value = r.univ || '';
  document.getElementById('em-dept').value = r.dept || '';
  document.getElementById('em-spec').value = r.spec || '';
  document.getElementById('em-student').value = r.student || '';
  document.getElementById('em-subject').value = r.subject || 'other';
  document.getElementById('em-track').value = r.track || 'bunka';
  document.getElementById('em-era').value = r.era || 'new';
  document.getElementById('em-tier').value = r.tier != null ? r.tier : '';
  document.getElementById('em-jlpt').value = r.jlpt || '';
  document.getElementById('em-jlpt-score').value = r.jlpt_score || '';
  document.getElementById('em-eng-type').value = r.eng_type || '';
  document.getElementById('em-eng-score').value = r.eng_score || '';
  document.getElementById('em-note').value = r.note || '';
  raArSetMajor('em', r.our_major || raArGuessMajor(r.subject));
  raArPhotoShowFor('grad', r, 'em');
  document.getElementById('em-photo').value = '';
  document.getElementById('edit-modal-title').textContent = `編集: ${r.univ}`;
  document.getElementById('edit-modal').classList.add('show');
}

function raCloseEditModal() {
  document.getElementById('edit-modal').classList.remove('show');
}

async function raSaveEdit(btn) {
  if (btn && btn.disabled) return;
  const errEl = document.getElementById('em-err'); errEl.textContent = '';
  const id = document.getElementById('em-id').value;
  const tierVal = document.getElementById('em-tier').value;
  const jlptScore = document.getElementById('em-jlpt-score').value;
  const engScore = document.getElementById('em-eng-score').value;

  const updates = {
    univ:       document.getElementById('em-univ').value.trim() || null,
    dept:       document.getElementById('em-dept').value.trim() || null,
    spec:       document.getElementById('em-spec').value.trim() || null,
    student:    document.getElementById('em-student').value.trim() || null,
    subject:    document.getElementById('em-subject').value || null,
    track:      document.getElementById('em-track').value || 'bunka',
    era:        document.getElementById('em-era').value,
    tier:       tierVal !== '' ? parseInt(tierVal) : null,
    jlpt:       document.getElementById('em-jlpt').value || null,
    jlpt_score: jlptScore ? parseInt(jlptScore) : null,
    eng_type:   document.getElementById('em-eng-type').value || null,
    eng_score:  engScore ? parseInt(engScore) : null,
    note:       document.getElementById('em-note').value.trim() || null,
    our_major:  raArGetMajor('em') || null,
  };
  const photoFile = document.getElementById('em-photo').files[0];
  raBtnBusy(btn, '保存中…');
  try {
    if (photoFile) {
      raBtnBusy(btn, '上传截图中…');
      const newPath = await raArUploadPhoto(photoFile, 'grad');
      await raArSetPhoto('grad', id, newPath, raAllData.find(x => x.id === id));   // 写 result_photos，删旧文件
      updates.photo_url = null;
      updates.note = raArStripNotePhoto(updates.note) || null;   // 旧的 [photo] 链接作废
      raBtnBusy(btn, '保存中…');
    }
    const oldRow = raAllData.find(x => x.id === id);
    if (oldRow && oldRow.student_id && (oldRow.student || null) !== updates.student) updates.student_id = null;   // 改了学生名：旧关联作废
    await raSbFetch(`admission_results?id=eq.${id}`, {
      method: 'PATCH', body: updates, prefer: 'return=minimal', headers: {}
    });
    // ローカルデータも更新
    const idx = raAllData.findIndex(x => x.id === id);
    if (idx >= 0) raAllData[idx] = { ...raAllData[idx], ...updates };
    if (idx >= 0 && updates.our_major && updates.student && !raIsTeacher()) { raBtnBusy(btn, '同步学生档案中…'); await raArSyncToStudent(raAllData[idx]); }
    raCloseEditModal();
    raRenderList();
    raFlashRow(id);
    raToast('保存しました ✓');
  } catch (e) {
    errEl.textContent = '保存失败：' + e.message;
    raToast('エラー: ' + e.message, false);
  } finally { raBtnDone(btn); }
}


function raDoDelete(btn) {
  const tr = btn.closest('tr');
  const id = tr.dataset.id;
  const univ = tr.dataset.univ;
  raConfirmDelete(id, univ);
}


function raUgDoDelete(btn) {
  const tr = btn.closest('tr');
  raUgConfirmDelete(tr.dataset.id, tr.dataset.univ);
}

function raUgOpenEditModal(el) {
  const id = el.closest('tr').dataset.id;
  const r = raUgAllData.find(x => x.id === id);
  if (!r) return;
  document.getElementById('ug-em-id').value = id;
  document.getElementById('ug-em-err').textContent = '';
  document.getElementById('ug-em-univ').value = r.univ||'';
  document.getElementById('ug-em-dept').value = r.dept||'';
  document.getElementById('ug-em-spec').value = r.spec||'';
  document.getElementById('ug-em-student').value = r.student||'';
  document.getElementById('ug-em-track').value = r.track||'bunka';
  document.getElementById('ug-em-era').value = r.era||'new';
  document.getElementById('ug-em-tier').value = r.tier!=null?r.tier:'';
  document.getElementById('ug-em-eju-jp').value = r.eju_japanese||'';
  document.getElementById('ug-em-eju-kijutsu').value = r.eju_kijutsu||'';
  document.getElementById('ug-em-eju-bunsou').value = r.eju_bunsou||'';
  document.getElementById('ug-em-eju-math').value = r.eju_math||'';
  document.getElementById('ug-em-eju-phys').value = r.eju_physics||'';
  document.getElementById('ug-em-eju-chem').value = r.eju_chemistry||'';
  document.getElementById('ug-em-eju-bio').value = r.eju_biology||'';
  document.getElementById('ug-em-eju-total').value = r.eju_total||'';
  document.getElementById('ug-em-jlpt').value = r.jlpt||'';
  document.getElementById('ug-em-toefl').value = r.toefl||'';
  document.getElementById('ug-em-toeic').value = r.toeic||'';
  document.getElementById('ug-em-note').value = r.note||'';
  raArSetMajor('ugem', r.our_major || '');
  raArPhotoShowFor('ug', r, 'ug-em');
  document.getElementById('ug-em-photo').value = '';
  document.getElementById('ug-edit-modal-title').textContent = '編集: '+r.univ;
  document.getElementById('ug-edit-modal').classList.add('show');
}

async function raUgSaveEdit(btn) {
  if (btn && btn.disabled) return;
  const errEl = document.getElementById('ug-em-err'); errEl.textContent = '';
  const id = document.getElementById('ug-em-id').value;
  const n = id2 => { const v=document.getElementById(id2).value; return v!==''?parseInt(v):null; };
  const updates = {
    univ: document.getElementById('ug-em-univ').value.trim()||null,
    dept: document.getElementById('ug-em-dept').value.trim()||null,
    spec: document.getElementById('ug-em-spec').value.trim()||null,
    student: document.getElementById('ug-em-student').value.trim()||null,
    track: document.getElementById('ug-em-track').value||'bunka',
    era: document.getElementById('ug-em-era').value,
    tier: document.getElementById('ug-em-tier').value!==''?parseInt(document.getElementById('ug-em-tier').value):null,
    eju_japanese:n('ug-em-eju-jp'), eju_kijutsu:n('ug-em-eju-kijutsu'), eju_bunsou:n('ug-em-eju-bunsou'),
    eju_math:n('ug-em-eju-math'), eju_physics:n('ug-em-eju-phys'), eju_chemistry:n('ug-em-eju-chem'),
    eju_biology:n('ug-em-eju-bio'), eju_total:n('ug-em-eju-total'),
    jlpt:document.getElementById('ug-em-jlpt').value||null,
    toefl:n('ug-em-toefl'), toeic:n('ug-em-toeic'),
    note:document.getElementById('ug-em-note').value.trim()||null,
    our_major:raArGetMajor('ugem')||null,
  };
  const ugPhoto=document.getElementById('ug-em-photo').files[0];
  raBtnBusy(btn, '保存中…');
  try {
    if(ugPhoto){
      raBtnBusy(btn, '上传截图中…');
      const newPath=await raArUploadPhoto(ugPhoto,'ug');
      await raArSetPhoto('ug',id,newPath,raUgAllData.find(x=>x.id===id));   // 写 result_photos，删旧文件
      updates.photo_url=null;
      updates.note=raArStripNotePhoto(updates.note)||null;   // 旧的 [photo] 链接作废
      raBtnBusy(btn, '保存中…');
    }
    const oldUg=raUgAllData.find(x=>x.id===id);
    if(oldUg&&oldUg.student_id&&(oldUg.student||null)!==updates.student) updates.student_id=null;   // 改了学生名：旧关联作废
    await raSbFetch(`undergrad_results?id=eq.${id}`,{method:'PATCH',body:updates,prefer:'return=minimal',headers:{}});
    const idx2=raUgAllData.findIndex(x=>x.id===id);
    if(idx2>=0) raUgAllData[idx2]={...raUgAllData[idx2],...updates};
    if(idx2>=0&&updates.our_major&&updates.student&&!raIsTeacher()){ raBtnBusy(btn, '同步学生档案中…'); await raArSyncToStudent(raUgAllData[idx2],'undergrad_results'); }
    document.getElementById('ug-edit-modal').classList.remove('show');
    raUgRenderList();
    raFlashRow(id);
    raToast('保存しました ✓');
  } catch(e){
    errEl.textContent = '保存失败：' + e.message;
    raToast('エラー: '+e.message,false);
  } finally { raBtnDone(btn); }
}

let raUgTierUnivData2=[], raUgTierChanges2={};

async function raUgLoadTierTab() {
  document.getElementById('ug-tier-area').innerHTML='<div class="load-state">読み込み中...</div>';
  raUgTierChanges2={};
  raUgUpdateTierSaveBtn2();
  try {
    const all = await raUgFetchAll();
    const univMap={};
    for(const r of all){
      if(!univMap[r.univ]) univMap[r.univ]={count:0,dbTier:r.tier!=null?r.tier:null};
      univMap[r.univ].count++;
    }
    raUgTierUnivData2=Object.entries(univMap).map(([u,d])=>({univ:u,count:d.count,autoTier:raUgTierOf(u),dbTier:d.dbTier}))
      .sort((a,b)=>a.autoTier-b.autoTier||a.univ.localeCompare(b.univ));
    raUgRenderTierTable2();
  } catch(e){document.getElementById('ug-tier-area').innerHTML=`<div class="load-state" style="color:var(--red)">エラー: ${e.message}</div>`;}
}

function raUgRenderTierTable2() {
  const TC={0:['#dce4f4','#1a3070'],1:['#e8edf8','#2c4a8a'],2:['#e8f0e4','#3a6630'],3:['#f4ece0','#7a4a20'],4:['#f4e0e0','#7a2020']};
  let h2=`<div style="overflow-x:auto"><table class="data-table"><thead><tr>
    <th>大学名</th><th style="width:60px;text-align:center">件数</th>
    <th style="width:90px;text-align:center">自動</th><th style="width:90px;text-align:center">設定済</th>
    <th style="width:260px">Tier変更</th></tr></thead><tbody>`;
  for(const d of raUgTierUnivData2){
    const p=raUgTierChanges2[d.univ];
    const eff=p!==undefined?p:(d.dbTier!=null?d.dbTier:d.autoTier);
    const [abg,afg]=TC[d.autoTier]||['#eee','#666'];
    const [dbg,dfg]=d.dbTier!=null?(TC[d.dbTier]||['#eee','#666']):['#f0ede6','#9a9590'];
    h2+=`<tr style="${p!==undefined?'background:#fffbe8':''}">
      <td>${d.univ}</td><td style="text-align:center;color:var(--text-muted)">${d.count}</td>
      <td style="text-align:center"><span style="font-size:10px;padding:2px 8px;border-radius:2px;background:${abg};color:${afg};font-weight:500">T${d.autoTier}</span></td>
      <td style="text-align:center">${d.dbTier!=null?`<span style="font-size:10px;padding:2px 8px;border-radius:2px;background:${dbg};color:${dfg};font-weight:500">T${d.dbTier}</span>`:'<span style="font-size:10px;color:var(--text-muted)">—</span>'}</td>
      <td><div style="display:flex;gap:4px">${[0,1,2,3,4].map(t=>{const a=eff===t;const [bg,fg]=TC[t];return `<button onclick="raUgSetTC('${d.univ.replace(/'/g,"\'")}',${t})" style="padding:3px 7px;border-radius:2px;border:1px solid ${a?fg:bg};background:${a?fg:'transparent'};color:${a?'#fff':fg};font-family:inherit;font-size:10px;cursor:pointer">T${t}</button>`;}).join('')}
      <button onclick="raUgSetTC('${d.univ.replace(/'/g,"\'")}',null)" style="padding:3px 7px;border-radius:2px;border:1px solid var(--border);background:transparent;color:var(--text-muted);font-family:inherit;font-size:10px;cursor:pointer">自動</button></div></td>
    </tr>`;
  }
  h2+='</tbody></table></div>';
  document.getElementById('ug-tier-area').innerHTML=h2;
}

function raUgSetTC(univ,tier){
  const d=raUgTierUnivData2.find(x=>x.univ===univ);
  if(!d)return;
  if(tier===d.dbTier||(tier===null&&d.dbTier===null))delete raUgTierChanges2[univ];
  else raUgTierChanges2[univ]=tier;
  raUgUpdateTierSaveBtn2();
  raUgRenderTierTable2();
}

function raUgUpdateTierSaveBtn2(){
  const n2=Object.keys(raUgTierChanges2).length;
  const btn=document.getElementById('ug-tier-save-btn');
  if(!btn)return;
  btn.disabled=n2===0;
  btn.textContent=`変更を保存（${n2}件）`;
}

async function raUgSaveTierChanges(){
  const entries=Object.entries(raUgTierChanges2);
  if(!entries.length)return;
  const btn=document.getElementById('ug-tier-save-btn');
  btn.disabled=true;btn.textContent='保存中...';
  const status=document.getElementById('ug-tier-status');
  let done2=0;
  try{
    for(const [u,t] of entries){
      await raSbFetch(`undergrad_results?univ=eq.${encodeURIComponent(u)}`,{method:'PATCH',body:{tier:t},prefer:'return=minimal',headers:{}});
      done2++;
      status.textContent=`${done2}/${entries.length}件処理中...`;
    }
    raToast(`${done2}大学のTierを更新しました ✓`);
    raUgTierChanges2={};
    await raUgLoadTierTab();
  }catch(e){raToast('エラー: '+e.message,false);btn.disabled=false;raUgUpdateTierSaveBtn2();}
}


// ─── 合格写真 ────────────────────────────────────────────────────────────────
const raPHOTO_BUCKET = 'admission-photos';      // 公开桶：只剩旧照片（迁移前）、海报、案例
const raPRIV_BUCKET = 'admission-private';     // 私有桶：未遮盖的原截图，只有管理员能读
const raPH_NOTE_RE = /\[photo\](\S+)/;
const raAR_PH = { grad: {}, ug: {} };          // 照片路径表 result_photos：result_id → 私有桶里的路径
const raAR_PH_LOADED = { grad: false, ug: false };
// 旧的存法（迁移前）：photo_url，或 note 里的 [photo]链接
function raArLegacyUrl(r) { return (r && r.photo_url) || (((r && r.note) || '').match(raPH_NOTE_RE) || [])[1] || ''; }
function raArStripNotePhoto(note) { return (note || '').replace(/\s*\|\s*\[photo\]\S+/, '').replace(/\[photo\]\S+/, '').trim(); }
// 分页读全表（Supabase 一次最多 1000 行）：走 sbAll；按创建时间排序时补上 id，翻页才稳定
function raArFetchAll(path) {
  return sbAll('/rest/v1/' + path.replace(/order=created_at\.(desc|asc)(?![,\w])/, 'order=created_at.$1,id.$1'));
}
async function raArLoadPhotoMap(kind) {
  const rows = await raArFetchAll(`result_photos?result_kind=eq.${kind}&select=result_id,path&order=created_at.asc`);
  const m = {}; rows.forEach(x => { m[String(x.result_id)] = x.path; });
  raAR_PH[kind] = m; raAR_PH_LOADED[kind] = true;
}
async function raArEnsurePhotoMap(kind) { if (!raAR_PH_LOADED[kind]) await raArLoadPhotoMap(kind); }
// 这条记录的照片：私有桶路径（新）或旧的公开链接（还没迁移）；没有返回 ''
async function raArPhotoRef(kind, r) {
  await raArEnsurePhotoMap(kind);
  return raAR_PH[kind][String(r && r.id)] || raArLegacyUrl(r);
}
// 私有桶路径 → 临时链接（600 秒）。一次传多个；返回 { 路径: 链接 }
const raAR_SIGN_TTL = 600, raArSignCache = {};
async function raArSignedUrls(paths) {
  const out = {}, now = Date.now(), need = [];
  [...new Set((paths || []).filter(Boolean))].forEach(p => {
    const c = raArSignCache[p];
    if (c && c.exp > now) out[p] = c.url; else need.push(p);
  });
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const res = await fetch(`${SB_URL}/storage/v1/object/sign/${raPRIV_BUCKET}`, {
      method: 'POST', headers: await raAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: raAR_SIGN_TTL, paths: chunk })
    });
    if (!res.ok) throw new Error('取得临时链接失败: ' + await res.text());
    (await res.json()).forEach(x => {
      if (x && x.signedURL && !x.error) {
        const url = `${SB_URL}/storage/v1${x.signedURL}`;
        raArSignCache[x.path] = { url, exp: now + (raAR_SIGN_TTL - 60) * 1000 };
        out[x.path] = url;
      }
    });
  }
  return out;
}
// 引用（路径或旧链接）→ 能直接用的图片链接
async function raArResolveSrc(ref) {
  if (!ref) return '';
  if (/^https?:/i.test(ref)) return ref;
  return (await raArSignedUrls([ref]))[ref] || '';
}
// 管理员身份上传原截图到私有桶（原图原样，文件名随机 ASCII）；返回路径
async function raArUploadPhoto(file, folder) {
  let ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, ''); if (!ext || ext.length > 5) ext = 'jpg';
  const path = (folder || 'grad') + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  const up = await fetch(`${SB_URL}/storage/v1/object/${raPRIV_BUCKET}/${path}`, { method: 'POST', headers: await raAuthHeaders({ 'Content-Type': file.type || 'application/octet-stream' }), body: file });
  if (!up.ok) throw new Error(await up.text());
  return path;
}
async function raArRemoveFiles(paths) {
  paths = (paths || []).filter(Boolean);
  for (let i = 0; i < paths.length; i += 100) {
    await fetch(`${SB_URL}/storage/v1/object/${raPRIV_BUCKET}`, { method: 'DELETE', headers: await raAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }) }).catch(() => {});
  }
}
// 旧的公开链接对应的公开桶文件
function raArLegacyFilePath(url) { const m = String(url || '').match(/admission-photos\/(.+)$/); return m ? m[1] : ''; }
async function raArRemoveLegacyFile(url) {
  const p = raArLegacyFilePath(url); if (!p) return true;
  const r = await fetch(`${SB_URL}/storage/v1/object/${raPHOTO_BUCKET}/${p}`, { method: 'DELETE', headers: await raAuthHeaders() }).catch(() => null);
  return !!(r && r.ok);
}
// 给一条记录设置（或更换）照片：写 result_photos，删旧文件（私有桶里的旧文件 + 迁移前的公开文件）
async function raArSetPhoto(kind, id, path, legacyRow) {
  await raArEnsurePhotoMap(kind);
  const key = String(id), old = raAR_PH[kind][key];
  await raSbFetch('result_photos?on_conflict=result_kind,result_id', { method: 'POST', body: { result_kind: kind, result_id: key, path }, prefer: 'resolution=merge-duplicates,return=minimal', headers: {} });
  raAR_PH[kind][key] = path;
  if (old && old !== path) await raArRemoveFiles([old]);
  const lu = legacyRow && raArLegacyUrl(legacyRow);
  if (lu) await raArRemoveLegacyFile(lu);
}
// 手动添加时选了截图：记录保存后再传到私有桶并写 result_photos；没选图或成功返回 true，失败返回 false（合格实绩本身已保存）
async function raAddPhotoAfterInsert(kind, saved, file) {
  if (!file) return true;
  try {
    if (!saved || !saved.id) throw new Error('没有取到记录编号');
    await raArSetPhoto(kind, saved.id, await raArUploadPhoto(file, kind), null);
    return true;
  } catch (e) { return false; }
}
// 删合格记录 / 照片时：删 result_photos 行和私有桶里的文件
async function raArDeleteResultPhotos(kind, ids) {
  ids = (ids || []).map(String);
  if (!ids.length) return;
  let rows;
  try {
    rows = ids.length <= 50
      ? await raSbFetch(`result_photos?result_kind=eq.${kind}&result_id=in.(${ids.map(i => '"' + i.replace(/"/g, '') + '"').join(',')})&select=id,result_id,path`)
      : (await raArFetchAll(`result_photos?result_kind=eq.${kind}&select=id,result_id,path`)).filter(x => ids.includes(String(x.result_id)));
  } catch (e) { return; }   // 表还没建
  if (!rows || !rows.length) return;
  await raArRemoveFiles(rows.map(x => x.path));
  for (let i = 0; i < rows.length; i += 50) {
    await raSbFetch(`result_photos?id=in.(${rows.slice(i, i + 50).map(x => x.id).join(',')})`, { method: 'DELETE', prefer: 'return=minimal', headers: {} });
  }
  rows.forEach(x => { delete raAR_PH[kind][String(x.result_id)]; });
}
// 编辑弹窗里显示现有照片（临时链接）
async function raArPhotoShowFor(kind, r, pre) {
  const box = document.getElementById(pre + '-photo-box');
  if (box) box.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">读取中…</div>';
  let url = '';
  try { url = await raArResolveSrc(await raArPhotoRef(kind, r)); } catch (e) { url = ''; }
  raEmPhotoShow(url, false, pre);
}
function raEmPhotoShow(url, isNew, pre) {
  const box = document.getElementById((pre || 'em') + '-photo-box'); if (!box) return;
  box.innerHTML = url ? `<img src="${url}" style="max-width:100%;max-height:160px;border:1px solid var(--border);border-radius:4px;display:block"><div style="font-size:10px;color:var(--text-muted);margin-top:3px">${isNew ? '新图（保存后生效）' : '现在的图；选择文件可更换'}</div>` : '<div style="font-size:11px;color:var(--text-muted)">还没有截图</div>';
}
function raEmPhotoPick(inp, pre) {
  const f = inp.files[0]; if (!f) return;
  raEmPhotoShow(URL.createObjectURL(f), true, pre);
}

// 大学院（admission_results）和学部（undergrad_results）共用一套：kind = 'grad' | 'ug'
const raPH = {
  grad: { pre: 'photo',   table: 'admission_results', rows: [], posterMap: null, f: { era: '', subj: '', poster: '' }, more: false },
  ug:   { pre: 'ugphoto', table: 'undergrad_results', rows: [], posterMap: null, f: { era: '', subj: '', poster: '' }, more: false },
};
const raPH_TRACK = { bunka: '文科', rika: '理科', bijutsu: '美術' };
function raPhGet(kind) { return raPH[kind || 'grad']; }
async function raLoadPhotos(kind) {
  kind = kind || 'grad';
  const c = raPH[kind], grid = document.getElementById(c.pre + '-grid');
  grid.innerHTML = '<div class="load-state">読み込み中...</div>';
  try {
    await raArLoadPhotoMap(kind);
    const rows = await raArFetchAll(`${c.table}?select=*&order=created_at.desc`);
    c.rows = rows.filter(r => raAR_PH[kind][String(r.id)] || raArLegacyUrl(r));   // 有私有桶照片的，或还没迁移的旧照片
    raArMigCount();
    // 已做过海报的记录（表还没建时 posterMap 为 null，「海报」筛选和按钮状态都不显示）
    try {
      const ps = await raSbFetch(`pass_posters?result_kind=eq.${kind}&select=result_id,web_url`);
      c.posterMap = {};
      (ps || []).forEach(p => { c.posterMap[p.result_id] = p.web_url ? 'pub' : 'draft'; });
    } catch (e) { c.posterMap = null; }
    raPhRender(kind);
  } catch(e) {
    grid.innerHTML = `<div class="load-state" style="color:var(--red)">エラー: ${e.message}</div>`;
  }
}
function raPhSet(kind, k, v) { const f = raPH[kind].f; f[k] = f[k] === v ? '' : v; raPhRender(kind); }
function raPhClear(kind, k) { raPH[kind].f[k] = ''; raPhRender(kind); }
function raPhMore(kind) { raPH[kind].more = !raPH[kind].more; raPhRender(kind); }
function raPhChip(on, label, onclick) {
  return `<span class="filter-chip${on ? ' active' : ''}" onclick="${onclick}" style="display:inline-block;padding:3px 10px;margin:0 4px 4px 0;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'var(--surface)'};color:${on ? '#fff' : 'var(--text-secondary)'};border-radius:12px;font-size:11px;cursor:pointer">${label}</span>`;
}
function raPhRender(kind) {
  kind = kind || 'grad';
  const c = raPH[kind], f = c.f, pm = c.posterMap;
  const q = (document.getElementById(c.pre + '-search')?.value || '').trim();
  const isUg = kind === 'ug';
  const grpKey = isUg ? 'track' : 'subject';                 // 第二组筛选用的字段：学部=系統，大学院=在籍学科
  const grpName = id => isUg ? (raPH_TRACK[id] || id || '其他') : ((raSUBJECTS.find(x => x.id === id) || {}).label || id || '其他');
  const rowOk = (r, skip) => {
    if (skip !== 'era' && f.era && r.era !== f.era) return false;
    if (skip !== 'subj' && f.subj && (r[grpKey] || 'other') !== f.subj) return false;
    if (skip !== 'poster' && f.poster && pm) { const has = !!pm[r.id]; if ((f.poster === 'done') !== has) return false; }
    if (q && !searchMatch(q, [r.student, r.univ, r.dept, r.spec])) return false;
    return true;
  };
  const cnt = (skip, fn) => c.rows.filter(r => rowOk(r, skip) && fn(r)).length;
  // 筛选 chips（每组单独可用、互相交叉）
  const grpIds = [...new Set(c.rows.map(r => r[grpKey] || 'other'))];
  const SHOW = 12;
  const shown = c.more ? grpIds : grpIds.filter((id, i) => i < SHOW || id === f.subj);
  const lab = t => `<span style="font-size:11px;color:var(--text-muted);margin-right:6px">${t}</span>`;
  let h = `<div style="margin-bottom:4px">${lab('年度')}`
    + raPhChip(!f.era, '全部', `raPhClear('${kind}','era')`)
    + [['new', '2026–2027'], ['hist', '2022–2025']].map(([k, l]) => raPhChip(f.era === k, `${l} (${cnt('era', r => r.era === k)})`, `raPhSet('${kind}','era','${k}')`)).join('') + '</div>';
  h += `<div style="margin-bottom:4px">${lab(isUg ? '系統' : '在籍学科')}`
    + raPhChip(!f.subj, '全部', `raPhClear('${kind}','subj')`)
    + shown.map(id => raPhChip(f.subj === id, `${grpName(id)} (${cnt('subj', r => (r[grpKey] || 'other') === id)})`, `raPhSet('${kind}','subj','${id}')`)).join('')
    + (grpIds.length > SHOW ? raPhChip(false, c.more ? '收起 ▴' : '更多 ▾', `raPhMore('${kind}')`) : '') + '</div>';
  if (pm) {
    h += `<div style="margin-bottom:4px">${lab('海报')}`
      + raPhChip(!f.poster, '全部', `raPhClear('${kind}','poster')`)
      + [['todo', '未制作'], ['done', '已制作']].map(([k, l]) => raPhChip(f.poster === k, l, `raPhSet('${kind}','poster','${k}')`)).join('') + '</div>';
  }
  document.getElementById(c.pre + '-filters').innerHTML = h;

  const rows = c.rows.filter(r => rowOk(r, ''));
  document.getElementById(c.pre + '-count').textContent = rows.length + ' 件';
  const grid = document.getElementById(c.pre + '-grid');
  if (!rows.length) { grid.innerHTML = '<div class="load-state">该条件下暂无合格照片</div>'; return; }
  const esc = raArEsc;
  grid.innerHTML = '<div class="photo-grid">' + rows.map(r => {
    const ppath = raAR_PH[kind][String(r.id)] || '', legacy = ppath ? '' : raArLegacyUrl(r);
    const noteText = raArStripNotePhoto(r.note);
    return `<div class="photo-card">
        <img ${ppath ? `data-path="${esc(ppath)}"` : `src="${esc(legacy)}"`} alt="${esc(r.univ)}" onerror="this.style.display='none'" style="cursor:pointer" onclick="if(this.src)window.open(this.src,'_blank')">
        <div class="photo-card-info">
          <div class="photo-card-title">${esc(r.univ) || '（未知大学）'} ${r.student ? '· ' + esc(r.student) : ''}
            <button class="photo-card-del" onclick="raDeletePhotoRecord('${kind}','${esc(r.id)}')">削除</button>
            <button class="photo-card-del" style="background:#eef2fa;color:var(--accent);border-color:#c5d0e8;margin-right:4px" onclick="pstOpen('${kind}','${esc(r.id)}')">${pm && pm[r.id] ? '编辑海报' : '制作海报'}</button>
          </div>
          ${pm && pm[r.id] ? `<div style="font-size:10px;color:var(--green);margin-bottom:2px">已制作${pm[r.id] === 'pub' ? ' · 已发布' : ''}</div>` : ''}
          <div class="photo-card-sub">${esc(r.dept)}${r.spec ? ' ' + esc(r.spec) : ''}　${esc(grpName(r[grpKey] || 'other'))}${noteText ? '　' + esc(noteText) : ''}</div>
        </div>
      </div>`;
  }).join('') + '</div>';
  raArFillImgs(grid);
}
// 私有桶的图：取临时链接后再显示
async function raArFillImgs(root) {
  const imgs = [...root.querySelectorAll('img[data-path]')];
  if (!imgs.length) return;
  try {
    const m = await raArSignedUrls(imgs.map(i => i.dataset.path));
    imgs.forEach(i => { if (m[i.dataset.path]) i.src = m[i.dataset.path]; else i.style.display = 'none'; });
  } catch (e) { raToast(e.message, false); }
}
// 删除：只去掉照片（删 result_photos 行 + 私有桶文件；迁移前的旧照片清 photo_url 和 note 里的 [photo] 段并删公开桶文件），合格数据保留
async function raDeletePhotoRecord(kind, id) {
  const c = raPH[kind];
  const hasPoster = c.posterMap && c.posterMap[id];
  if (!confirm('删除这张合格照片？（合格数据保留，只删照片）' + (hasPoster ? '\n这张照片的海报也会一起删除' : ''))) return;
  try {
    const enc = encodeURIComponent;
    const rows = await raSbFetch(`${c.table}?id=eq.${enc(id)}&select=note,photo_url`);
    const rec = (rows && rows[0]) || {};
    const legacy = raArLegacyUrl(rec);
    if (legacy) {
      await raSbFetch(`${c.table}?id=eq.${enc(id)}`, { method: 'PATCH', body: { photo_url: null, note: raArStripNotePhoto(rec.note) || null }, prefer: 'return=minimal' });
      await raArRemoveLegacyFile(legacy);
    }
    await raArDeleteResultPhotos(kind, [id]);
    if (hasPoster) await pstDeleteForResults(kind, [id]);
    raLoadPhotos(kind);
  } catch(e) { alert('删除失败: ' + e.message); }
}

// ─── 迁移旧照片（一次性）：公开桶里的旧原截图 → 私有桶 ───────────────────────────
const raAR_LEGACY_OR = 'or=(photo_url.not.is.null,note.like.*%5Bphoto%5D*)';
let raArMigBusy = false;
async function raArLegacyRows(kind) {
  return raArFetchAll(`${raPH[kind].table}?select=id,photo_url,note&${raAR_LEGACY_OR}`);
}
// 按钮上的数字 = 还有旧照片的记录数（大学院 + 学部）；0 就不显示
async function raArMigCount() {
  if (raArMigBusy || raIsTeacher()) return;
  let n = 0;
  try { for (const k of ['grad', 'ug']) n += (await raArLegacyRows(k)).filter(r => raArLegacyUrl(r)).length; } catch (e) { return; }
  document.querySelectorAll('.ar-mig-btn').forEach(b => { b.style.display = n ? '' : 'none'; b.textContent = `迁移旧照片（${n} 张）`; });
}
function raArMigLog(html) { document.querySelectorAll('.ar-mig-log').forEach(d => { d.style.display = html ? '' : 'none'; d.innerHTML = html; }); }
async function raArMigrateOne(kind, row) {
  const url = raArLegacyUrl(row), old = raArLegacyFilePath(url);
  if (!old) throw new Error('不是公开桶的链接');
  // 1. 下载原图，原样传到私有桶
  const dl = await fetch(url, { cache: 'no-store' });
  if (!dl.ok) throw new Error('下载失败 ' + dl.status);
  const blob = await dl.blob();
  const newPath = kind + '/' + old.split('/').pop();
  const up = await fetch(`${SB_URL}/storage/v1/object/${raPRIV_BUCKET}/${newPath}`, { method: 'POST', headers: await raAuthHeaders({ 'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'true' }), body: blob });
  if (!up.ok) throw new Error('上传失败 ' + await up.text());
  // 2. 写 result_photos
  await raSbFetch('result_photos?on_conflict=result_kind,result_id', { method: 'POST', body: { result_kind: kind, result_id: String(row.id), path: newPath }, prefer: 'resolution=merge-duplicates,return=minimal', headers: {} });
  // 3. 结果表：photo_url 置空，note 去掉 [photo] 段
  await raSbFetch(`${raPH[kind].table}?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', body: { photo_url: null, note: raArStripNotePhoto(row.note) || null }, prefer: 'return=minimal', headers: {} });
  // 4. 海报的原图来源改成新路径
  const ps = await raSbFetch(`pass_posters?result_kind=eq.${kind}&result_id=eq.${encodeURIComponent(row.id)}&select=id`).catch(() => []);
  if (ps && ps.length) {
    await raSbFetch(`pass_poster_sources?poster_id=in.(${ps.map(x => x.id).join(',')})&src_url=like.http*`, { method: 'PATCH', body: { src_url: newPath }, prefer: 'return=minimal', headers: {} });
  }
  raAR_PH[kind][String(row.id)] = newPath;
  // 5. 前面都成功了，才删公开桶里的旧文件
  if (!(await raArRemoveLegacyFile(url))) throw new Error('已迁移，但公开桶里的旧文件没删掉，请到 Supabase Storage 手动删除：admission-photos/' + old);
}
async function raArMigratePhotos() {
  if (raArMigBusy) return;
  raArMigBusy = true;
  const btns = [...document.querySelectorAll('.ar-mig-btn')];
  btns.forEach(b => b.disabled = true);
  const fails = [];
  try {
    const jobs = [];
    for (const k of ['grad', 'ug']) (await raArLegacyRows(k)).forEach(r => { if (raArLegacyUrl(r)) jobs.push([k, r]); });
    if (!jobs.length) { raArMigLog(''); return; }
    for (let i = 0; i < jobs.length; i++) {
      const [kind, row] = jobs[i];
      btns.forEach(b => b.textContent = `迁移中 ${i + 1} / ${jobs.length}…`);
      raArMigLog(`迁移中 ${i + 1} / ${jobs.length}…` + (fails.length ? `（失败 ${fails.length}）` : ''));
      try { await raArMigrateOne(kind, row); }
      catch (e) { fails.push(`${kind === 'ug' ? '学部' : '大学院'} · ${row.id}：${e.message}`); }
    }
    raArMigLog(`<b>完成：成功 ${jobs.length - fails.length} 张，失败 ${fails.length} 张。</b>` + (fails.length ? '<br>失败的记录（已跳过，可再点一次重试）：<br>' + fails.map(f => raArEsc(f)).join('<br>') : ''));
  } catch (e) {
    raArMigLog('<span style="color:var(--red)">迁移出错：' + raArEsc(e.message) + '</span>');
  } finally {
    raArMigBusy = false;
    btns.forEach(b => b.disabled = false);
    await raArMigCount();
    ['grad', 'ug'].forEach(k => { if (document.getElementById(raPH[k].pre + '-grid') && raPH[k].rows.length) raLoadPhotos(k); });
  }
}

async function raDeletePhoto(path) {
  if (!confirm('この写真を削除しますか？')) return;
  try {
    await fetch(`${SB_URL}/storage/v1/object/${raPHOTO_BUCKET}/${path}`, {
      method: 'DELETE',
      headers: await raAuthHeaders()
    });
    raToast('削除しました ✓');
    raLoadPhotos();
  } catch(e) { raToast('エラー: ' + e.message, false); }
}

// 外部库按需加载：XLSX / JSZip 已由 admin/index.html 加载；jsPDF 在第一次导出 PDF 时才加载（shared/poster.js），
// Google 字体（Noto Sans JP / SC）在第一次打开海报编辑器时才加载（shared/poster.js 的 pstInit）。

// 旧 results/admin.html 的状态都留在内存里；页面 HTML 每次进来重新生成，所以进来时把和界面绑定的状态重置一下
function raResetState() {
  raCurMajor = 'grad';
  raPpAdminMounted = false;
  raAllData = []; raUgAllData = [];
  raUploadRows = []; raUploadColMap = {}; raUploadHeaders = [];
  raUgUploadRows = []; raUgUploadColMap = {}; raUgUploadHeaders = [];
  raTierUnivData = []; raTierChanges = {};
  raUgTierUnivData2 = []; raUgTierChanges2 = {};
  raUgDataLoaded = false;
  ['grad', 'ug'].forEach(k => { raAR_PH[k] = {}; raAR_PH_LOADED[k] = false; });   // 照片路径表：每次进来重新读
  ['grad', 'ug'].forEach(k => { const c = raPH[k]; c.rows = []; c.posterMap = null; c.f = { era: '', subj: '', poster: '' }; c.more = false; });
}

// 外部库按需加载（老师端页面不预先加载）：XLSX（Excel 导入）、JSZip（批量下载）；admin 页面已经有，直接跳过
function raLoadLib(src, ready) {
  if (ready()) return Promise.resolve();
  return new Promise(res => {
    const sc = document.createElement('script');
    sc.src = src; sc.onload = () => res(); sc.onerror = () => res();   // 失败了对应功能自己会提示
    document.head.appendChild(sc);
  });
}
function raLoadLibs() {
  raLoadLib('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', () => typeof XLSX !== 'undefined');
  raLoadLib('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', () => typeof JSZip !== 'undefined');
}

function raRender(mc, opts) {
  raMode = (opts && opts.mode === 'teacher') ? 'teacher' : 'admin';
  if (raIsTeacher()) raLoadLibs();
  if (!document.getElementById('ra-style')) {
    const st = document.createElement('style');
    st.id = 'ra-style';
    st.textContent = RA_CSS;
    document.head.appendChild(st);
  }
  raResetState();
  mc.innerHTML = '<div id="ra-root">' + raHtml() + '</div>';
  raBindUploadZones();
  raRefreshUnivList();
  raArLoadMajors();
}
