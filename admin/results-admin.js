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
@media (max-width: 700px) {
  #ra-root .tab-bar, #ra-root .major-bar { overflow-x: auto; -webkit-overflow-scrolling: touch; padding-left: 1rem; padding-right: 1rem; scrollbar-width: none; }
  #ra-root .tab-bar::-webkit-scrollbar, #ra-root .major-bar::-webkit-scrollbar { display: none; }
  #ra-root .tab-btn, #ra-root .major-btn { white-space: nowrap; flex: 0 0 auto; }
  #ra-root .tab-btn { padding: 10px 14px; }
  #ra-root .major-btn { padding: 10px 16px; }
}
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
// 能不能看截图 / 补图 / 做海报（数据库 can_manage_results() 同一规则）：管理员；result_admin；管理模式的负责人且「合格实绩」页对他开放
function raCanPhotos() {
  if (raIsTeacher()) return true;   // 老师端「合格实绩管理」本身就要求 result_admin
  if (typeof ACCESS_KEY === 'undefined' || !ACCESS_KEY) return true;   // 管理员邮箱登录
  if (ACCESS_KEY.invalid) return false;
  if (ACCESS_KEY.is_admin) return true;
  const a = ACCESS_KEY._asTeacher; if (!a) return false;
  if (String((a.permissions || {}).result_admin).toLowerCase() === 'true') return true;
  return typeof mgrPageAllowed === 'function' && mgrPageAllowed('admissions');
}
// 管理模式的负责人（没有 result_admin）：只看、只管自己管理范围（领域 / 专业）内的合格实绩、截图和海报（数据库 result_in_my_scope() 同一规则）
function raScopedLead() {
  if (raIsTeacher() || typeof ACCESS_KEY === 'undefined' || !ACCESS_KEY || ACCESS_KEY.invalid || ACCESS_KEY.is_admin) return false;
  const a = ACCESS_KEY._asTeacher; if (!a) return false;
  return String((a.permissions || {}).result_admin).toLowerCase() !== 'true';
}
// 一条合格记录在不在我的范围：专业 = our_major；领域 = 专业所属领域，没有专业就按 大学院/学部 + 系統 推
function raInMyScope(kind, row) {
  if (!raScopedLead()) return true;
  const mj = row && row.our_major;
  const dom = (mj && MAJOR_DOMAIN[mj]) || pstTrackDomain(kind, row && row.track);
  return !!((mj && scopeMajor(mj)) || scopeHasDomain(dom));
}
function raPosterInMyScope(r) { return !raScopedLead() || !!((r.major && scopeMajor(r.major)) || scopeHasDomain(r.domain)); }
// 补图等读取时在服务器端先按范围缩小（取回后还会用 raInMyScope 再过滤一次）；不是负责人 = 不加条件
function raScopeQs(kind) {
  if (!raScopedLead()) return '';
  const keys = Object.keys(MAJOR_DOMAIN).filter(k => scopeMajor(k));
  const tracks = ['bunka', 'rika', 'bijutsu'].filter(t => scopeHasDomain(pstTrackDomain(kind, t)));
  const parts = [];
  if (keys.length) parts.push(`our_major.in.(${keys.join(',')})`);
  if (tracks.length) parts.push(`and(our_major.is.null,track.in.(${tracks.join(',')}))`);
  return `&or=(${parts.length ? parts.join(',') : 'id.is.null'})`;
}
function raScopeHint() {
  if (!raScopedLead()) return '';
  const only = !VIEW_SCOPE.domains.length;
  return `<div style="font-size:11px;color:var(--text-muted);margin:6px 0">${only ? '只显示本校在籍专业属于你负责专业的记录' : '只显示你管理范围内的记录（没填本校在籍专业的，按系統归到领域）'}</div>`;
}
// 保存前检查：不在自己范围内的记录存进去自己也看不到
function raScopeCheck(kind, row) {
  if (raInMyScope(kind, row)) return true;
  raToast('这条不在你的管理范围内：请选择范围内的本校在籍专业', false);
  return false;
}
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
  <button ${raCanPhotos()?'':'style="display:none"'} class="major-btn" onclick="raSwitchMajor('poster')">合格海报</button>
</div>

<!-- ════════════════════════════════════════════════════════════════════════
     大学院セクション
════════════════════════════════════════════════════════════════════════ -->
<div id="major-grad">

<div class="tab-bar">
  <button class="tab-btn active" onclick="raSwitchTab('add')">手动添加</button>
  <button class="tab-btn" onclick="raSwitchTab('excel')">Excel 批量导入</button>
  <button class="tab-btn" onclick="raSwitchTab('list')">数据管理</button>
  <button ${raScopedLead()?'style="display:none"':''} class="tab-btn" onclick="raSwitchTab('tier')">Tier 管理</button>
  <button ${raCanPhotos()?'':'style="display:none"'} class="tab-btn" onclick="raSwitchTab('photos')">合格写真</button>
</div>

<main>
${raScopeHint()}

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
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn btn-secondary" onclick="raXlTemplate('grad')">⬇ 下载填写模板</button>
      <span style="font-size:11px;color:var(--text-muted)">模板含填写说明和专业对照；下载「数据管理」导出的 Excel 改完再导入，可按记录编号更新</span>
    </div>
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
      <div class="form-section-title">インポートプレビュー</div>
      <div id="import-summary" style="font-size:12px;margin-bottom:8px"></div>
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
    <select id="filter-subj" onchange="raRenderList()"><option value="">全部本校专业</option></select>
    <select id="filter-era" onchange="raRenderList()">
      <option value="">全年度</option>
      <option value="new">2026–2027</option>
      <option value="hist">2022–2025</option>
    </select>
    <span class="result-count" id="result-count"></span>
    <button class="btn btn-secondary" id="export-btn" onclick="raXlExport('grad')" style="padding:5px 12px;font-size:11px">⬇ 下载 Excel</button>
    ${raIsTeacher() || raScopedLead() ? '' : '<button class="btn btn-danger" onclick="raConfirmDeleteAll()" style="margin-left:auto">全件削除</button>'}
  </div>
  <div id="ar-pending-grad"></div>
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
  <div id="photo-mode" style="margin-bottom:8px"></div>
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
  <button ${raScopedLead()?'style="display:none"':''} class="tab-btn" onclick="raSwitchUgTab('tier')">Tier 管理</button>
  <button ${raCanPhotos()?'':'style="display:none"'} class="tab-btn" onclick="raSwitchUgTab('photos')">合格写真</button>
</div>

<main>
${raScopeHint()}

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
        <select id="ug-f-track" onchange="raArUgTrackChanged('ugf', this.value)">
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
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn btn-secondary" onclick="raXlTemplate('ug')">⬇ 下载填写模板</button>
      <span style="font-size:11px;color:var(--text-muted)">模板含填写说明和专业对照；下载「数据管理」导出的 Excel 改完再导入，可按记录编号更新</span>
    </div>
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
      <div class="form-section-title">インポートプレビュー</div>
      <div id="ug-import-summary" style="font-size:12px;margin-bottom:8px"></div>
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
    <button class="btn btn-secondary" id="ug-export-btn" onclick="raXlExport('ug')" style="padding:5px 12px;font-size:11px">⬇ 下载 Excel</button>
    ${raIsTeacher() || raScopedLead() ? '' : '<button class="btn btn-danger" onclick="raUgConfirmDeleteAll()" style="margin-left:auto">全件削除</button>'}
  </div>
  <div id="ar-pending-ug"></div>
  <div id="ug-list-area" class="load-state">読み込み中...</div>
</div>

<!-- ── UG TAB: 合格写真 ── -->
<div id="ugtab-photos" style="display:none">
  <div id="ugphoto-mode" style="margin-bottom:8px"></div>
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
  return all.filter(raPosterInMyScope);
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

  if (!raScopeCheck('grad', row)) return;
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
    const tail = synced ? ' · 已记录到学生档案' : (!row.our_major && row.student && !raIsTeacher() ? ' · 没有选本校在籍专业，未记录到学生档案' : '');
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

// ════════════════════════════════════════════════════════════════════════
// Excel 导出 / 导入模板 / 导入预览（大学院 grad 和 学部 ug 共用）
// 列顺序 = 导出文件 = 导入模板；第一列「记录编号」(id) 导入时用来更新
// ════════════════════════════════════════════════════════════════════════
const raXlTpl = { grad: false, ug: false };   // 当前上传的文件表头是不是模板 / 导出文件（有「记录编号」列）
const raXl = { plan: { grad: [], ug: [] }, show: { grad: 50, ug: 50 }, kind: 'grad' };
let raXlMajors = [];   // [{key,label,label_ja,domain,group_key}]：每次导出 / 模板 / 预览时从 majors 表实时读取
let raXlGroups = {};   // 分组 key → { label, domain }

const RA_XL = {
  grad: {
    name: '大学院', table: 'admission_results', p: '',
    sample: ['示例行，导入时自动跳过', '示例大学', '示例研究科', '示例専攻', '示例学生', '社会学', '文科', '2026–2027', '社会学', '2', 'N1 150', 'TOEIC 800', '示例备注'],
    cols: [
      { k: 'id', head: '记录编号' }, { k: 'univ', head: '大学名 *' }, { k: 'dept', head: '研究科' }, { k: 'spec', head: '専攻' },
      { k: 'student', head: '学生名' }, { k: 'subject', head: '在籍学科' }, { k: 'track', head: '系統' }, { k: 'era', head: '年度' },
      { k: 'our_major', head: '本校在籍专业' }, { k: 'tier', head: 'Tier' }, { k: 'jlpt_raw', head: 'JLPT' }, { k: 'eng_raw', head: '英語スコア' },
      { k: 'note', head: '备注' },
    ],
  },
  ug: {
    name: '学部', table: 'undergrad_results', p: 'ug-',
    sample: ['示例行，导入时自动跳过', '示例大学', '示例学部', '示例学科', '示例学生', '文科', '2026–2027', '社会学', '2', 'N1', '', '', '', '', '', '', '', '', '', '', '示例备注'],
    cols: [
      { k: 'id', head: '记录编号' }, { k: 'univ', head: '大学名 *' }, { k: 'dept', head: '学部' }, { k: 'spec', head: '学科' },
      { k: 'student', head: '学生名' }, { k: 'track', head: '系統' }, { k: 'era', head: '年度' }, { k: 'our_major', head: '本校在籍专业' },
      { k: 'tier', head: 'Tier' }, { k: 'jlpt', head: 'JLPT' }, { k: 'eju_japanese', head: 'EJU日本語' }, { k: 'eju_kijutsu', head: 'EJU記述' },
      { k: 'eju_bunsou', head: 'EJU文系総合' }, { k: 'eju_math', head: 'EJU数学' }, { k: 'eju_physics', head: 'EJU物理' },
      { k: 'eju_chemistry', head: 'EJU化学' }, { k: 'eju_biology', head: 'EJU生物' }, { k: 'eju_total', head: 'EJU総分' },
      { k: 'toefl', head: 'TOEFL' }, { k: 'toeic', head: 'TOEIC' }, { k: 'note', head: '备注' },
    ],
  },
};
const RA_XL_TRACK = { bunka: '文科', rika: '理科', bijutsu: '美术' };
const RA_XL_ERA = { new: '2026–2027', hist: '2022–2025' };
const RA_XL_FIELD_LABEL = {
  univ: '大学名', dept: '研究科/学部', spec: '専攻/学科', student: '学生名', subject: '在籍学科', track: '系統', era: '年度', our_major: '本校在籍专业',
  tier: 'Tier', jlpt: 'JLPT', jlpt_score: 'JLPT分', eng_type: '英語種別', eng_score: '英語分', note: '备注', school_type: '区分',
  eju_japanese: 'EJU日本語', eju_kijutsu: 'EJU記述', eju_bunsou: 'EJU文系総合', eju_math: 'EJU数学', eju_physics: 'EJU物理',
  eju_chemistry: 'EJU化学', eju_biology: 'EJU生物', eju_total: 'EJU総分', toefl: 'TOEFL', toeic: 'TOEIC',
};

function raXlNorm(h) { return String(h == null ? '' : h).replace(/[\s*＊]/g, '').toLowerCase(); }
function raXlGuessExact(kind, header, key) {
  const h = raXlNorm(header);
  return RA_XL[kind].cols.some(c => c.k === key && raXlNorm(c.head) === h);
}
function raXlYmd() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
async function raXlEnsureLib() {
  await raLoadLib('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', () => typeof XLSX !== 'undefined');
  if (typeof XLSX === 'undefined') { raToast('Excel 组件加载失败，请检查网络后重试', false); return false; }
  return true;
}

// ── 本校专业（实时读 majors 表）──
async function raXlLoadMajorRows() {
  let rows = null;
  const tries = ['key,label,label_ja,domain,group_key', 'key,label,domain,group_key', 'key,label,domain'];
  for (const sel of tries) { try { rows = await raSbFetch(`majors?select=${sel}&order=domain.asc,label.asc`); break; } catch (e) { rows = null; } }
  raXlMajors = Array.isArray(rows) ? rows : (raArMajors || []).map(m => ({ key: m.key, label: m.label, domain: m.domain }));
  raXlGroups = {};
  Object.keys(typeof MAJOR_GROUP_LABEL !== 'undefined' ? MAJOR_GROUP_LABEL : {}).forEach(k => { raXlGroups[k] = { label: MAJOR_GROUP_LABEL[k], domain: (MAJOR_GROUP_DOMAIN || {})[k] || '' }; });
  try {
    const gs = await raSbFetch('major_groups?select=key,label,domain&order=key.asc');
    if (Array.isArray(gs)) gs.forEach(g => { raXlGroups[g.key] = { label: g.label || g.key, domain: g.domain || '' }; });
  } catch (e) { /* 分组表读不到：用内存里的 */ }
}
function raXlMajorLabel(key) {
  if (!key) return '';
  const m = raXlMajors.find(x => x.key === key) || (raArMajors || []).find(x => x.key === key);
  if (m) return m.label || key;
  const g = raXlGroups[key] || (raArGroups || []).find(x => x.key === key);
  return g ? g.label + '（全部）' : key;
}
// 本校在籍专业：按中文名匹配 majors（也认 key、日文名、只有一个专业的分组名）；返回 { key, err }
function raMatchMajor(text) {
  const t = String(text || '').trim();
  if (!t) return { key: '', err: '' };
  const rows = raXlMajors.length ? raXlMajors : (raArMajors || []);
  const lc = t.toLowerCase();
  const pickOne = list => {
    if (list.length === 1) return { key: list[0].key, err: '' };
    if (list.length > 1) {   // 不同领域有同名专业：优先本页大学院 / 学部的领域
      const pre = raXl.kind === 'ug' ? '学部' : '大学院';
      const pref = list.filter(m => (m.domain || '').startsWith(pre));
      if (pref.length === 1) return { key: pref[0].key, err: '' };
      return { key: '', err: '专业名重复，请填专业 key' };
    }
    return null;
  };
  let r = pickOne(rows.filter(m => m.key === t || (m.key || '').toLowerCase() === lc)); if (r) return r;
  r = pickOne(rows.filter(m => (m.label || '').trim().toLowerCase() === lc)); if (r) return r;
  r = pickOne(rows.filter(m => (m.label_ja || '').trim().toLowerCase() === lc)); if (r) return r;
  const gk = Object.keys(raXlGroups).filter(k => k === t || (raXlGroups[k].label || '').trim().toLowerCase() === lc);
  if (gk.length) {
    const mem = rows.filter(m => gk.includes(m.group_key));
    if (mem.length === 1) return { key: mem[0].key, err: '' };
    return { key: '', err: '分组含多个专业，请填具体专业' };
  }
  return { key: '', err: '对不上' };
}

// ── 导出 ──
function raXlCellValue(kind, key, r) {
  switch (key) {
    case 'id': return r.id || '';
    case 'subject': return (raSUBJ_ALL.find(x => x.id === r.subject) || {}).label || r.subject || '';
    case 'track': return RA_XL_TRACK[r.track] || '';
    case 'era': return RA_XL_ERA[r.era] || '';
    case 'our_major': return raXlMajorLabel(r.our_major);
    case 'tier': return r.tier != null ? r.tier : '';
    case 'jlpt_raw': return [r.jlpt, r.jlpt_score].filter(v => v != null && v !== '').join(' ');
    case 'eng_raw': return [r.eng_type, r.eng_score].filter(v => v != null && v !== '').join(' ');
    default: return r[key] == null ? '' : r[key];
  }
}
function raXlSetWidths(ws, aoa) {
  ws['!cols'] = (aoa[0] || []).map((_, i) => ({ wch: Math.min(40, Math.max(8, ...aoa.slice(0, 60).map(r => String(r[i] == null ? '' : r[i]).length * 1.6 + 2))) }));
}
async function raXlExport(kind) {
  const rows = kind === 'ug' ? raUgListRows() : raListRows();
  if (!rows.length) { raToast('当前筛选下没有记录可导出', false); return; }
  if (!(await raXlEnsureLib())) return;
  await raXlLoadMajorRows();
  const K = RA_XL[kind];
  const aoa = [K.cols.map(c => c.head)].concat(rows.map(r => K.cols.map(c => raXlCellValue(kind, c.k, r))));
  const ws = XLSX.utils.aoa_to_sheet(aoa); raXlSetWidths(ws, aoa);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '数据');
  XLSX.writeFile(wb, `合格实绩_${K.name}_${raXlYmd()}.xlsx`);
  raToast(`已导出 ${rows.length} 条`);
}

// ── 模板 ──
async function raXlTemplate(kind) {
  if (!(await raXlEnsureLib())) return;
  await raXlLoadMajorRows();
  const K = RA_XL[kind], isG = kind === 'grad';
  const heads = K.cols.map(c => c.head);
  const wsFill = XLSX.utils.aoa_to_sheet([heads, K.sample]); raXlSetWidths(wsFill, [heads, K.sample]);

  const subjList = raSUBJ_ALL.map(x => `${x.label}（${x.id}）`).join('、');
  const R = (name, req, what, ex) => [name, req, what, ex];
  const help = [['列名', '是否必填', '能填什么', '例子']];
  help.push(R('记录编号', '否', '新增留空。要更新已有记录：填「数据管理」导出的记录编号（不要改）。编号找不到时当新增。更新时空白格子保持原值，只改填了的格子。', '（导出文件里的编号）'));
  help.push(R('大学名 *', '新增必填；更新可不填', '大学全名', '早稲田大学'));
  help.push(R(K.cols[2].head, '否', isG ? '研究科名称' : '学部名称', isG ? '社会学研究科' : '文学部'));
  help.push(R(K.cols[3].head, '否', isG ? '専攻名称' : '学科名称', isG ? '社会学専攻' : '社会学科'));
  help.push(R('学生名', '否', '学生姓名；缩写（如 A同学）不会记录到学生档案', '张三'));
  if (isG) help.push(R('在籍学科', '否（留空新增 = その他）', '中文名称和代码都可以：' + subjList, '社会学'));
  help.push(R('系統', '否', isG ? '文科 / 理科 / 美术。留空时用导入页选的系統；在籍学科是理科类时自动按理科' : '文科 / 理科 / 美术。留空 = 文科', '文科'));
  help.push(R('年度', '否', '2026–2027 / 2022–2025。留空 = 2026–2027', '2026–2027'));
  help.push(R('本校在籍专业', '否（只负责专业的负责人必须填）', '填学生系统里的专业名称，见『专业对照』表；只负责专业的负责人必须填。对不上的会在预览里标红，这一项留空，其他列不受影响。', '社会学'));
  help.push(R('Tier', '否', isG ? '0 / 1 / 2 / 3。留空 = 按大学自动' : '0 / 1 / 2 / 3 / 4。留空 = 按大学自动', '2'));
  if (isG) {
    help.push(R('JLPT', '否', 'N1 / N2，可带分数', 'N1 150'));
    help.push(R('英語スコア', '否', '种类 + 分数：TOEIC / TOEFL / IELTS / EJU', 'TOEIC 800'));
  } else {
    help.push(R('JLPT', '否', 'N1 / N2 / N3', 'N1'));
    help.push(R('EJU日本語 … EJU総分 / TOEFL / TOEIC', '否', '数字', '280'));
  }
  help.push(R('备注', '否', '自由文字', ''));
  help.push([]);
  help.push(['说明', '', '第 2 行是示例行（内容和示例完全一样的行，导入时自动跳过）。Excel 导入不会把学生记录到学生档案。', '']);
  const wsHelp = XLSX.utils.aoa_to_sheet(help); wsHelp['!cols'] = [{ wch: 26 }, { wch: 24 }, { wch: 80 }, { wch: 22 }];

  // 专业对照：第一部分 合格数据学科 → 本校专业（每行一个对应）；第二部分 本校专业一览
  const lead = raScopedLead();
  const ms = raXlMajors.filter(m => !lead || scopeMajor(m.key));
  const gl = m => (m.group_key && (raXlGroups[m.group_key] || {}).label) || '';
  const cmp = (a, b) => String(a).localeCompare(String(b), 'zh');
  const mp = [];
  if (isG) {
    mp.push(['合格数据学科 → 本校专业'], ['在籍学科是合格数据的粗分类，和学生系统的专业不完全对应。本校在籍专业以学生系统为准。'], ['在籍学科', '代码', '对应的本校专业', '备注']);
    raSUBJ_ALL.forEach(x => {
      const r = raSubjectMajor(x.id);
      if (lead && (!r.key || !scopeMajor(r.key))) return;   // 负责人：只保留对应专业在他范围内的行
      mp.push([x.label, x.id, r.key ? r.label : '无固定对应', r.note]);
    });
    mp.push([]);
  }
  mp.push(['本校专业一览'], ['领域', '分组', '专业']);
  const sorted = ms.slice().sort((a, b) => cmp(a.domain || '其他', b.domain || '其他') || (gl(a) ? 0 : 1) - (gl(b) ? 0 : 1) || cmp(gl(a), gl(b)) || cmp(a.label, b.label));
  let lastDom = null;
  sorted.forEach(m => { const d = m.domain || '其他'; mp.push([d === lastDom ? '' : d, gl(m), m.label]); lastDom = d; });
  const wsMajor = XLSX.utils.aoa_to_sheet(mp); wsMajor['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 28 }, { wch: 42 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsFill, '填写');
  XLSX.utils.book_append_sheet(wb, wsHelp, '填写说明');
  XLSX.utils.book_append_sheet(wb, wsMajor, '专业对照');
  XLSX.writeFile(wb, `合格实绩导入模板_${K.name}.xlsx`);
}

// ── 导入：预览 + 执行 ──
function raXlEq(a, b) {
  const n = v => (v == null || v === '') ? null : String(v);
  return n(a) === n(b);
}
function raXlShow(f, v) {
  if (v == null || v === '') return '（空）';
  if (f === 'subject') return (raSUBJ_ALL.find(x => x.id === v) || {}).label || v;
  if (f === 'track') return RA_XL_TRACK[v] || v;
  if (f === 'era') return RA_XL_ERA[v] || v;
  if (f === 'our_major') return raXlMajorLabel(v);
  return String(v);
}
function raXlBuildPlan(kind, upRows, existing) {
  const K = RA_XL[kind];
  const mapper = kind === 'ug' ? raUgMapRow : raMapRow;
  const colMap = kind === 'ug' ? raUgUploadColMap : raUploadColMap;
  const byId = {}; existing.forEach(r => { byId[r.id] = r; });
  const seen = new Set();
  const isSample = row => {
    const idI = colMap.id;
    if (idI != null && String(row[idI] ?? '').trim().startsWith('示例行')) return true;
    let cmp = 0;
    for (let i = 1; i < K.cols.length; i++) {
      const c = K.cols[i], ci = colMap[c.k];
      if (ci == null) continue;
      cmp++;
      if (String(row[ci] ?? '').trim() !== String(K.sample[i] ?? '')) return false;
    }
    return cmp > 0;
  };
  return upRows.map((row, idx) => {
    const e = { no: idx + 2, status: 'skip', reason: '', hint: '', diffs: [], rec: null, id: '', view: {}, majorRaw: '', majorErr: '' };
    if (isSample(row)) { e.reason = '示例行'; return e; }
    const m = mapper(row);
    e.majorRaw = m._majorRaw; e.majorErr = m._majorErr;
    const rec = {}; Object.keys(m).forEach(k => { if (k[0] !== '_') rec[k] = m[k]; });
    const id = m._id;
    const ex = id ? byId[id] : null;
    const scopeReason = r2 => (raInMyScope(kind, r2) ? '' : (r2.our_major ? '本校在籍专业不在你的管理范围内' : '没有填本校在籍专业，系統所属领域不在你的管理范围内（只负责专业的负责人必须填）'));
    if (ex) {
      if (seen.has(id)) { e.reason = '记录编号在文件里重复'; e.view = ex; return e; }
      seen.add(id);
      const patch = {}; m._patchKeys.forEach(k => { patch[k] = rec[k]; });
      if (raXlEq(ex.univ, patch.univ)) delete patch.school_type;   // 大学名没变就不重算区分
      e.id = id; e.view = Object.assign({}, ex, patch);
      const diffs = Object.keys(patch).filter(f => !raXlEq(ex[f], patch[f])).map(f => ({ f, old: raXlShow(f, ex[f]), now: raXlShow(f, patch[f]) }));
      const why = scopeReason(e.view);
      if (why) { e.reason = why; return e; }
      if (!diffs.length) { e.reason = '没有变化'; return e; }
      e.status = 'update'; e.diffs = diffs; e.patch = patch; return e;
    }
    e.view = rec; e.auto = !!m._auto;
    if (id) e.hint = '找不到这个记录编号' + (raScopedLead() ? '（或不在你的范围内）' : '') + '，按新增';
    if (!rec.univ) { e.reason = '没有大学名'; return e; }
    const why = scopeReason(rec);
    if (why) { e.reason = why; return e; }
    e.status = 'new'; e.rec = rec; return e;
  });
}
async function raXlShowPreview(kind) {
  const K = RA_XL[kind], p = K.p;
  raXl.kind = kind;
  try {
    await raXlLoadMajorRows();
    const existing = kind === 'ug' ? await raUgFetchAll() : await raFetchAllResults();
    const upRows = kind === 'ug' ? raUgUploadRows : raUploadRows;
    raXl.plan[kind] = raXlBuildPlan(kind, upRows, existing);
    raXl.show[kind] = 50;
    raXlRenderPreview(kind);
    document.getElementById(p + 'col-mapping').style.display = 'none';
    document.getElementById(p + 'import-preview').style.display = '';
  } catch (e) { raToast('预览失败：' + e.message, false); }
}
function raXlMoreRows(kind) { raXl.show[kind] += 50; raXlRenderPreview(kind); }
function raXlRenderPreview(kind) {
  const K = RA_XL[kind], p = K.p, plan = raXl.plan[kind];
  const n = s => plan.filter(x => x.status === s).length;
  const nNew = n('new'), nUp = n('update'), nSkip = n('skip');
  const nErr = plan.filter(x => x.majorErr).length;
  document.getElementById(p + 'import-summary').innerHTML =
    `<b>新增 ${nNew} 条 · 更新 ${nUp} 条 · 跳过 ${nSkip} 条</b>` +
    (nErr ? `<span style="color:var(--red);margin-left:10px">本校在籍专业对不上 ${nErr} 行（已标红，该项留空）</span>` : '');
  document.getElementById(p + 'import-count').textContent = nNew + nUp;
  document.getElementById(p + 'import-btn').disabled = !(nNew + nUp);
  const E = raArEsc, shown = plan.slice(0, raXl.show[kind]);
  const ST = { new: ['新增', '#1a4a30', '#ddf0e8'], update: ['更新', '#1a3a6a', '#ddeaf8'], skip: ['跳过', '#8a2020', '#f8e0e0'] };
  let html = `<table class="preview-table"><thead><tr><th>行</th><th>状态</th><th>大学名</th><th>${E(RA_XL_FIELD_LABEL.dept)}</th><th>${E(RA_XL_FIELD_LABEL.spec)}</th><th>学生</th><th>本校在籍专业</th><th>说明 / 改动</th></tr></thead><tbody>`;
  shown.forEach(x => {
    const v = x.view || {}, st = ST[x.status];
    const major = x.majorErr
      ? `<span style="color:var(--red)">${E(x.majorRaw)}（${E(x.majorErr)}，已留空）</span>`
      : E(raXlMajorLabel(v.our_major)) + (x.auto && v.our_major ? '（自动）' : '');
    const note = x.status === 'update' ? x.diffs.map(d => `${E(RA_XL_FIELD_LABEL[d.f] || d.f)}：${E(d.old)} → ${E(d.now)}`).join('<br>')
      : x.status === 'skip' ? `<span style="color:#8a2020">${E(x.reason)}</span>` : E(x.hint);
    html += `<tr${x.status === 'skip' ? ' style="background:#fdf3f3"' : ''}><td>${x.no}</td><td><span style="font-size:10px;padding:1px 6px;border-radius:2px;background:${st[2]};color:${st[1]}">${st[0]}</span></td>`
      + `<td>${E(v.univ || '')}</td><td>${E(v.dept || '')}</td><td>${E(v.spec || '')}</td><td>${E(v.student || '')}</td><td>${major}</td><td style="font-size:11px">${note}</td></tr>`;
  });
  html += '</tbody></table>';
  if (plan.length > shown.length) html += `<div style="text-align:center;margin:8px"><button class="btn btn-secondary" onclick="raXlMoreRows('${kind}')">显示更多（还有 ${plan.length - shown.length} 行）</button></div>`;
  document.getElementById(p + 'preview-wrap').innerHTML = html;
}
async function raXlExecute(kind) {
  const K = RA_XL[kind], p = K.p, plan = raXl.plan[kind];
  const ins = plan.filter(x => x.status === 'new'), ups = plan.filter(x => x.status === 'update');
  if (!ins.length && !ups.length) { raToast('没有可导入的行', false); return; }
  const btn = document.getElementById(p + 'import-btn'); btn.disabled = true;
  const prog = document.getElementById(p + 'import-progress'), fill = document.getElementById(p + 'progress-fill'), label = document.getElementById(p + 'progress-label');
  prog.classList.add('show');
  const total = ins.length + ups.length; let done = 0, failed = 0;
  const tick = () => { fill.style.width = Math.round(done / total * 100) + '%'; label.textContent = `${done} / ${total} 件処理済み`; };
  try {
    const BATCH = 50;
    for (let i = 0; i < ins.length; i += BATCH) {
      const batch = ins.slice(i, i + BATCH).map(x => x.rec);
      await (kind === 'ug' ? raUgInsertBatch(batch) : raInsertBatch(batch));
      done += batch.length; tick();
    }
    for (const x of ups) {
      try {
        const res = await raSbFetch(`${K.table}?id=eq.${encodeURIComponent(x.id)}`, { method: 'PATCH', body: x.patch, prefer: 'return=representation' });
        if (Array.isArray(res) && !res.length) failed++;   // 被数据库拦下（没有权限 / 记录已不存在）
      } catch (e) { failed++; }
      done++; tick();
    }
    raToast(`新增 ${ins.length} 条，更新 ${ups.length - failed} 条${failed ? `，${failed} 条更新失败（可能不在你的范围内）` : ''} ✓`, !failed);
    if (kind === 'ug') { raUgResetUpload(); raUgRefreshUnivList(); } else { raResetUpload(); raRefreshUnivList(); }
  } catch (e) {
    raToast('インポートエラー: ' + e.message + '（已处理 ' + done + ' 条，请重新上传预览确认）', false);
    btn.disabled = false;
  }
}

const raFIELD_DEFS = [
  { key: 'id',        label: '记录编号（更新用，新增留空）' },
  { key: 'univ',      label: '大学名 *' },
  { key: 'dept',      label: '研究科' },
  { key: 'spec',      label: '専攻' },
  { key: 'student',   label: '学生名' },
  { key: 'subject',   label: '在籍学科' },
  { key: 'track',     label: '系統（文科 / 理科 / 美术）' },
  { key: 'era',       label: '入学年度' },
  { key: 'our_major', label: '本校在籍专业' },
  { key: 'tier',      label: 'Tier（0/1/2/3）' },
  { key: 'jlpt_raw',  label: 'JLPT（テキスト）' },
  { key: 'eng_raw',   label: '英語スコア（テキスト）' },
  { key: 'note',      label: '备注' },
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
    const ws = wb.Sheets['填写'] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows.length) { raToast('データが空です', false); return; }
    raUploadHeaders = rows[0].map(String);
    raXlTpl.grad = raUploadHeaders.some(h => raXlNorm(h) === raXlNorm('记录编号'));
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

// 表头是模板 / 导出文件的（有「记录编号」列）→ 只按列名完全一致来对应；否则沿用旧的模糊猜测
function raGuessCol(header, key) {
  if (raXlTpl.grad) return raXlGuessExact('grad', header, key);
  const h = header.toLowerCase();
  if (key === 'subject' && /专业|專業|本校/.test(h)) return false;
  const guesses = {
    id: ['记录编号','記録編号','記録番号'],
    univ: ['大学','学校','univ'], dept: ['研究科','dept','研究'], spec: ['専攻','专攻','spec'],
    student: ['学生','名前','student','学员'], subject: ['学科','在籍','subject'],
    track: ['系統','系统','track'],
    era: ['年度','era','入学','批次'], our_major: ['本校在籍','our_major'], tier: ['tier'],
    jlpt_raw: ['日語','jlpt','日语','日本語'],
    eng_raw: ['英語','toeic','toefl','英语','英'], note: ['备注','備考','note'],
  };
  return (guesses[key] || []).some(g => h.includes(g));
}

function raGetColIndex(key) {
  const v = document.getElementById(`map-${key}`)?.value;
  return v !== '' && v !== undefined ? parseInt(v) : null;
}

async function raPreviewImport() {
  const univIdx = raGetColIndex('univ');
  if (univIdx === null) { raToast('大学名の列を選択してください', false); return; }
  raUploadColMap = {};
  raFIELD_DEFS.forEach(fd => { raUploadColMap[fd.key] = raGetColIndex(fd.key); });
  await raXlShowPreview('grad');
}

// 在籍学科：中文名称 / 代码都认；对不上再走旧的关键字猜测
function raGuessSubject(raw) {
  let subject = String(raw || '').toLowerCase().trim();
  const hit = raSUBJ_ALL.find(x => x.id === subject || x.label.toLowerCase() === subject);
  if (hit) return hit.id;
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
  return subject;
}

// 年度：2026–2027 / 2022–2025 / new / hist / 年份，都认；空白 = 2026–2027
function raParseEra(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'new';
  if (/hist|20[01]\d|202[0-4]|22\s*[–\-~]\s*25/.test(s)) return 'hist';
  return 'new';
}

// 系統：文科 / 理科 / 美术（也认代码和旧写法）；对不上返回空
function raParseTrack(raw) {
  const t = String(raw || '').toLowerCase().trim();
  if (t.includes('rika') || t.includes('理科')) return 'rika';
  if (t.includes('bijutsu') || t.includes('美術') || t.includes('美术')) return 'bijutsu';
  if (t.includes('bunka') || t.includes('文科')) return 'bunka';
  return '';
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

  const era = raParseEra(get('era'));
  const subject = raGuessSubject(get('subject'));
  const trackParsed = raParseTrack(get('track'));
  let track = trackParsed || raImportTrack;   // Excel にtrack列がなければUIで選んだ系統を使用

  const tierRaw = get('tier');
  const tier = tierRaw && ['0','1','2','3'].includes(tierRaw.trim()) ? parseInt(tierRaw.trim()) : null;

  const rikaSubj = subject.startsWith('rika_');
  if (rikaSubj) track = 'rika';
  const mj = raMatchMajor(get('our_major'));
  // 本校在籍专业那一格是空的：按在籍学科自动建议（只用于新增；更新时空格保持原值）
  const autoMajor = (!get('our_major') && get('subject')) ? raArGuessMajor(subject) : '';
  const filled = k => get(k) !== '';
  const patchKeys = [];
  ['univ', 'dept', 'spec', 'student', 'note'].forEach(k => { if (filled(k)) patchKeys.push(k); });
  if (filled('subject')) patchKeys.push('subject');
  if (trackParsed || (filled('subject') && rikaSubj)) patchKeys.push('track');
  if (filled('era')) patchKeys.push('era');
  if (tier !== null) patchKeys.push('tier');
  if (filled('jlpt_raw')) patchKeys.push('jlpt', 'jlpt_score');
  if (filled('eng_raw')) patchKeys.push('eng_type', 'eng_score');
  if (mj.key) patchKeys.push('our_major');
  return {
    univ: get('univ') || null, dept: get('dept') || null, spec: get('spec') || null,
    student: get('student') || null, subject, era, track, tier, jlpt, jlpt_score, eng_type, eng_score, note: get('note') || null,
    our_major: mj.key || autoMajor || null,
    _id: get('id'), _majorRaw: get('our_major'), _majorErr: mj.err, _patchKeys: patchKeys, _auto: !!autoMajor,
  };
}

async function raExecuteImport() { await raXlExecute('grad'); }

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

// 当前筛选 + 排序后看得到的记录（列表和「下载 Excel」共用）
function raListRows() {
  const q = document.getElementById('search-input').value;
  const fs = document.getElementById('filter-subj').value;
  const fe = document.getElementById('filter-era').value;

  raAllData.forEach(r => { r._maj = raRmLabel(r); });
  let rows = raAllData.filter(r => {
    if (fs && raRmFilterKey(r) !== fs) return false;
    if (fe && r.era !== fe) return false;
    if (q && !searchMatch(q, [r.student, r.univ, r.dept, r.spec])) return false;
    return true;
  });

  rows.sort((a, b) => {
    let av = a[raListSortCol] ?? '', bv = b[raListSortCol] ?? '';
    if (typeof av === 'string') return av.localeCompare(bv) * raListSortDir;
    return (av - bv) * raListSortDir;
  });
  return rows;
}

// 本校专业下拉：只列数据里有的，按领域分组；保留当前选择
function raRmFillSelect() {
  const sel = document.getElementById('filter-subj'); if (!sel) return;
  const cur = sel.value, cnt = {};
  raAllData.forEach(r => { const k = raRmFilterKey(r); cnt[k] = (cnt[k] || 0) + 1; });
  let h = '<option value="">全部本校专业</option>';
  raRmGroups(Object.keys(cnt)).forEach(g => {
    const opts = g.items.map(x => `<option value="${raArEsc(x.key)}">${raArEsc(x.label)} (${cnt[x.key]})</option>`).join('');
    h += g.domain ? `<optgroup label="${raArEsc(g.domain)}">${opts}</optgroup>` : opts;
  });
  sel.innerHTML = h; sel.value = cnt[cur] ? cur : '';
}
function raRenderList() {
  raArPendingRender('grad');
  raRmFillSelect();
  const rows = raListRows();

  document.getElementById('result-count').textContent = `${rows.length} 件`;
  document.getElementById('export-btn').textContent = `⬇ 下载 Excel（${rows.length} 条）`;
  if (!rows.length) { document.getElementById('list-area').innerHTML = '<div class="load-state">データが見つかりません</div>'; return; }

  const cols = [
    { key: 'univ', label: '大学名' }, { key: 'dept', label: '研究科' }, { key: 'spec', label: '専攻' },
    { key: '_maj', label: '本校专业' }, { key: 'track', label: '系統' }, { key: 'tier', label: 'Tier' }, { key: 'era', label: '年度' },
    { key: 'jlpt', label: 'JLPT' }, { key: 'jlpt_score', label: 'J点数' }, { key: 'eng_type', label: '英語種別' }, { key: 'eng_score', label: '英語点数' }, { key: 'student', label: '学生' },
  ];

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
      <td><span class="subj-tag" style="background:${sc.bg};color:${sc.fg}">${raArEsc(raRmLabel(r))}</span></td>
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

// ─── 本校专业的显示（合格写真 / 数据管理 / 编辑器共用；任何时候都不显示代码）──────────
// 专业 key → 显示名：专业用专业名，分组用分组名（不带「（全部）」）；读不到返回 ''
function raRmName(k) {
  if (!k) return '';
  const m = (raArMajors || []).find(x => x.key === k);
  if (m) return m.label || '';
  const g = (raArGroups || []).find(x => x.key === k);
  return g ? (g.label || '') : '';
}
// 一条记录显示的本校专业：our_major → 旧学科对照 → 旧学科的中文名 → 其他
function raRmLabel(r) {
  const n = raRmName(resultMajorKey(r));
  if (n) return n;
  const s = (raSUBJ_ALL.find(x => x.id === (r && r.subject)) || {}).label;
  return s || '其他';
}
// 筛选用的 key：有对应的本校专业用它，没有统一归 'other'
function raRmFilterKey(r) {
  const k = resultMajorKey(r);
  return k && raRmName(k) ? k : 'other';
}
function raRmDomain(key) {
  const m = (raArMajors || []).find(x => x.key === key);
  if (m) return m.domain || '';
  const g = (raArGroups || []).find(x => x.key === key);
  return g ? (g.domain || '') : '';
}
// 一批 key → [{ domain, items:[{key,label}] }]：按领域分组（大学院文科 / 理科 / 美术在前），「其他」放最后
function raRmGroups(keys) {
  const by = {};
  keys.filter(k => k !== 'other').forEach(k => { const d = raRmDomain(k) || '其他领域'; (by[d] = by[d] || []).push({ key: k, label: raRmName(k) }); });
  const order = ['大学院文科', '大学院理科', '大学院美术'];
  const doms = Object.keys(by).sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'zh'); });
  const out = doms.map(d => ({ domain: d, items: by[d].sort((a, b) => a.label.localeCompare(b.label, 'ja')) }));
  if (keys.includes('other')) out.push({ domain: '', items: [{ key: 'other', label: '其他' }] });
  return out;
}

// ─── 大学院: admission_results ───────────────────────────────────────────────
const raSUBJECTS = [
  { id:'shakai',label:'社会学' },{ id:'fukushi',label:'社会福祉' },{ id:'shinpan',label:'新聞伝播' },
  { id:'keizai',label:'経済学' },{ id:'keiei',label:'経営学' },{ id:'kyoiku',label:'教育学' },
  { id:'hougaku',label:'法学' },{ id:'seiji',label:'政治学/国際関係' },{ id:'bungaku',label:'文学' },
  { id:'rekishi',label:'歴史学' },{ id:'hyosho',label:'表象文化' },{ id:'nihongo',label:'日本語教育' },
  { id:'shinri',label:'心理学' },{ id:'other',label:'その他' },
];

// 在籍学科全部选项（文科 + 理科）：导入 / 导出 / 模板共用
const raSUBJ_ALL = raSUBJECTS.concat([
  { id:'rika_kikai',label:'機械工学' },{ id:'rika_denki',label:'電気電子工学' },{ id:'rika_kagaku',label:'化学・化学工学' },
  { id:'rika_joho',label:'情報工学' },{ id:'rika_kenchiku',label:'建築・土木工学' },{ id:'rika_bio',label:'生命科学・医学' },
  { id:'rika_keiei',label:'経営工学' },{ id:'rika_other',label:'その他（理科）' },
]);

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
let raArGroups = [];   // [{key,label,domain}]：下面有专业的分组
async function raArLoadMajors() {
  try { raArMajors = await raSbFetch('majors?select=key,label,domain,group_key&order=domain.asc,label.asc') || []; }
  catch (e) { try { raArMajors = await raSbFetch('majors?select=key,label,domain&order=domain.asc,label.asc') || []; } catch (e2) { raArMajors = []; } }
  // 分组（major_groups）：选择框里作为「XX（全部）」列出；读不到就用内存里的
  raArGroups = Object.keys(typeof MAJOR_GROUP_LABEL !== 'undefined' ? MAJOR_GROUP_LABEL : {}).map(k => ({ key: k, label: MAJOR_GROUP_LABEL[k], domain: (MAJOR_GROUP_DOMAIN || {})[k] || '' }));
  try {
    const gs = await raSbFetch('major_groups?select=key,label,domain&order=key.asc');
    if (Array.isArray(gs)) raArGroups = gs.map(g => ({ key: g.key, label: g.label || g.key, domain: g.domain || '' }));
  } catch (e) { /* 分组表读不到 */ }
  raArGroups = raArGroups.filter(g => raArMajors.some(m => m.group_key === g.key));   // 空分组不列
  subjectMajorSetData(raArMajors, raArGroups);
  raArMajorsReady = true;
  ['f', 'em', 'ugf', 'ugem'].forEach(p => raArRenderMajor(p, raArSel[p] || ''));
  if (!raArSel.ugf) raArSetMajor('ugf', raArUgDefaultMajor((document.getElementById('ug-f-track') || {}).value || 'bunka'));
  raArPendingRender('grad'); raArPendingRender('ug');
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
  const optRows = raArGroups.map(g => ({ key: g.key, label: g.label + '（全部）', domain: g.domain })).concat(raArMajors);   // 分组排在各领域最前
  optRows.forEach(m => {
    if (o.domains && !o.domains.includes(m.domain || '其他') && m.key !== cur) return;
    if (raScopedLead() && !scopeMajor(m.key)) return;   // 负责人：只能选自己范围内的专业
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
// 在籍学科（合格数据的粗分类）→ 本校在籍专业：对照表在 shared/subject-major-map.js（模板「专业对照」和自动预选共用）
// → { key, label, isGroup, note }；没有对应时 key 为空
function raSubjectMajor(subject) { return subjectMajorInfo(subject, raArMajors, raArGroups); }
function raArGuessMajor(subject) {
  if (!subject || !(raArMajors || []).length) return '';
  return raSubjectMajor(subject).key;
}
// 学部不分专业：按系統默认到「学部文科 / 学部理科 / 学部美术」；系统里没有这个 key 时返回空
const RA_UG_TRACK_MAJOR = { bunka: 'gakubu_bunka', rika: 'gakubu_rika', bijutsu: 'gakubu_bijutsu' };
function raArUgDefaultMajor(track) {
  const k = RA_UG_TRACK_MAJOR[track] || '';
  return k && (raArMajors || []).some(m => m.key === k) ? k : '';
}
// 学部表单换系統：选择框是空的或还是上一个系統的默认值时，才跟着换（手动选过别的不动）
function raArUgTrackChanged(p, track) {
  const cur = raArGetMajor(p);
  if (!cur || Object.values(RA_UG_TRACK_MAJOR).includes(cur)) raArSetMajor(p, raArUgDefaultMajor(track));
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

// ── 收集页来的记录：还没记录到学生档案的（entered_via='public'，有真名，有本校在籍专业，student_id 为空）──
const raArPend = { grad: { open: false, sel: new Set() }, ug: { open: false, sel: new Set() } };
function raArPendData(kind) { return kind === 'ug' ? raUgAllData : raAllData; }
function raArPendRows(kind) {
  return raArPendData(kind).filter(r => r.entered_via === 'public' && r.student && raArRealName(r.student) && r.our_major && !r.student_id);
}
function raArPendingRender(kind) {
  const box = document.getElementById('ar-pending-' + kind); if (!box) return;
  const st = raArPend[kind];
  const rows = raIsTeacher() ? [] : raArPendRows(kind);
  if (!rows.length) { box.innerHTML = ''; st.sel.clear(); return; }
  st.sel = new Set([...st.sel].filter(id => rows.some(r => String(r.id) === id)));
  const mjLabel = k => ((raArMajors.find(m => m.key === k) || raArGroups.find(g => g.key === k) || {}).label) || k;
  let html = `<div style="border:1px solid #e8d9a8;background:#fbf6e6;border-radius:6px;padding:9px 12px;margin-bottom:10px;font-size:12px">
    <div style="display:flex;align-items:center;gap:10px">
      <span>有 <b>${rows.length}</b> 条收集来的记录还没记录到学生档案</span>
      <button class="btn btn-secondary" style="padding:3px 10px;font-size:11px;margin-left:auto" onclick="raArPendToggleOpen('${kind}')">${st.open ? '收起 ▴' : '展开 ▾'}</button>
    </div>`;
  if (st.open) {
    html += `<div style="margin-top:8px">` + rows.map(r => {
      const on = st.sel.has(String(r.id));
      return `<div onclick="raArPendToggle('${kind}','${raArEsc(String(r.id))}')" style="display:flex;gap:10px;align-items:center;padding:6px 10px;margin-bottom:4px;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? '#f1ead2' : '#fff'};border-radius:4px;cursor:pointer">
        <span style="font-weight:600">${raArEsc(r.student)}</span>
        <span style="color:var(--text-secondary)">${raArEsc([r.univ, r.dept].filter(Boolean).join(' '))}</span>
        <span style="margin-left:auto;color:var(--text-muted);font-size:11px">${raArEsc(mjLabel(r.our_major))}</span></div>`;
    }).join('') + `<div style="display:flex;gap:8px;margin-top:6px">
      <button class="btn btn-secondary" style="padding:4px 12px;font-size:11px" onclick="raArPendAll('${kind}')">${st.sel.size === rows.length ? '取消全选' : '全选'}</button>
      <button class="btn btn-primary" id="ar-pend-go-${kind}" style="padding:4px 14px;font-size:11px" ${st.sel.size ? '' : 'disabled'} onclick="raArPendGo('${kind}')">记录到学生档案（${st.sel.size}）</button></div></div>`;
  }
  box.innerHTML = html + '</div>';
}
function raArPendToggleOpen(kind) { raArPend[kind].open = !raArPend[kind].open; raArPendingRender(kind); }
function raArPendToggle(kind, id) { const s = raArPend[kind].sel; s.has(id) ? s.delete(id) : s.add(id); raArPendingRender(kind); }
function raArPendAll(kind) {
  const st = raArPend[kind], rows = raArPendRows(kind);
  st.sel = st.sel.size === rows.length ? new Set() : new Set(rows.map(r => String(r.id)));
  raArPendingRender(kind);
}
let raArPendBusy = false;
async function raArPendGo(kind) {
  if (raArPendBusy) return;
  const st = raArPend[kind], table = kind === 'ug' ? 'undergrad_results' : 'admission_results';
  const todo = raArPendRows(kind).filter(r => st.sel.has(String(r.id)));
  if (!todo.length) return;
  raArPendBusy = true;
  const btn = document.getElementById('ar-pend-go-' + kind); if (btn) btn.disabled = true;
  let ok = 0;
  for (const r of todo) {
    if (btn) btn.textContent = `记录中…（${ok}/${todo.length}）`;
    if ((await raArSyncToStudent(r, table)) === 'synced') ok++;
  }
  raArPendBusy = false;
  st.sel.clear();
  raArPendingRender(kind);
  raToast(ok === todo.length ? `✓ 已记录 ${ok} 条到学生档案` : `已记录 ${ok} / ${todo.length} 条，其余没有记录`, ok === todo.length);
}

async function raFetchAllResults() { return (await sbAll('/rest/v1/admission_results?select=*&order=created_at.desc,id.desc' + raScopeQs('grad'))).filter(r => raInMyScope('grad', r)); }
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
      { const mk = raRmFilterKey(r); if (mk !== 'other') univMap[r.univ].subjSet.add(mk); }
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

  let tableHtml = `<div style="overflow-x:auto"><table class="data-table" style="min-width:600px">
    <thead><tr><th style="min-width:180px">大学名</th><th style="width:60px;text-align:center">件数</th>
    <th style="width:90px;text-align:center">自動判定</th><th style="width:90px;text-align:center">DB設定</th>
    <th style="width:220px">Tier変更</th><th>本校专业构成</th></tr></thead><tbody>`;

  for (const d of rows) {
    const pending = raTierChanges[d.univ];
    const effective = pending !== undefined ? pending : (d.dbTier != null ? d.dbTier : d.autoTier);
    const isChanged = pending !== undefined;
    const isManual = d.dbTier !== null;
    const [abg, afg] = TIER_COLOR[d.autoTier] || ['#eee','#666'];
    const [dbg, dfg] = d.dbTier != null ? (TIER_COLOR[d.dbTier] || ['#eee','#666']) : ['#f0ede6','#9a9590'];

    const subjTags = d.subjs.slice(0,3).map(s =>
      `<span style="font-size:9px;padding:1px 5px;border-radius:2px;background:#eee;color:#444;margin-right:3px">${raArEsc(raRmName(s) || '其他')}</span>`
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

async function raUgFetchAll() { return (await sbAll(`/rest/v1/${raUG_TABLE}?select=*&order=created_at.desc,id.desc` + raScopeQs('ug'))).filter(r => raInMyScope('ug', r)); }
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
  raArSetMajor('ugf', raArUgDefaultMajor('bunka'));
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

  if (!raScopeCheck('ug', row)) return;
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
    const tail = synced ? ' · 已记录到学生档案' : (!row.our_major && row.student && !raIsTeacher() ? ' · 没有选本校在籍专业，未记录到学生档案' : '');
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
  { key:'id', label:'记录编号（更新用，新增留空）' },
  { key:'univ', label:'大学名 *' }, { key:'dept', label:'学部名' }, { key:'spec', label:'学科名' },
  { key:'student', label:'学生名' }, { key:'track', label:'系統（文科 / 理科 / 美术）' }, { key:'era', label:'年度' },
  { key:'our_major', label:'本校在籍专业' },
  { key:'eju_japanese', label:'EJU日本語' }, { key:'eju_kijutsu', label:'EJU記述' },
  { key:'eju_bunsou', label:'EJU文系総合' }, { key:'eju_math', label:'EJU数学' },
  { key:'eju_physics', label:'EJU物理' }, { key:'eju_chemistry', label:'EJU化学' },
  { key:'eju_biology', label:'EJU生物' }, { key:'eju_total', label:'EJU総分' },
  { key:'toefl', label:'TOEFL' }, { key:'toeic', label:'TOEIC' }, { key:'jlpt', label:'JLPT' },
  { key:'tier', label:'学校等级（元データ / 0–4）' }, { key:'note', label:'备注' },
];

function raUgHandleFile(file) {
  if (!file) return;
  document.getElementById('ug-upload-zone').textContent = `読み込み中: ${file.name}`;
  const reader = new FileReader();
  reader.onload = e => {
    const wb = XLSX.read(e.target.result, { type:'array' });
    const ws = wb.Sheets['填写'] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
    if (!rows.length) { raToast('データが空です', false); return; }
    raUgUploadHeaders = rows[0].map(String);
    raXlTpl.ug = raUgUploadHeaders.some(h => raXlNorm(h) === raXlNorm('记录编号'));
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
  if (raXlTpl.ug) return raXlGuessExact('ug', header, key);
  const h = header.toLowerCase();
  const guesses = {
    id:['记录编号','記録編号','記録番号'],
    univ:['大学','学校名（中文', '学校名（日'], dept:['学部名'], spec:['学科名'],
    student:['学生姓名','学生名'], track:['学科'], era:['年份','年度'], our_major:['本校在籍','our_major'],
    eju_japanese:['eju日语','eju日本語'], eju_kijutsu:['eju记述','eju記述'],
    eju_bunsou:['eju文综','eju文系'], eju_math:['eju数学'], eju_physics:['eju物理'],
    eju_chemistry:['eju化学'], eju_biology:['eju生物'], eju_total:['eju总分','eju総分'],
    toefl:['托福','toefl'], toeic:['托业','toeic'], jlpt:['jlpt'], tier:['学校等级','学校等級'], note:['备注','備考'],
  };
  return (guesses[key]||[]).some(g => h.includes(g));
}

function raUgGetColIndex(key) {
  const v = document.getElementById(`ug-map-${key}`)?.value;
  return v !== '' && v !== undefined ? parseInt(v) : null;
}

async function raUgPreviewImport() {
  const univIdx = raUgGetColIndex('univ');
  if (univIdx === null) { raToast('大学名の列を選択してください', false); return; }
  raUgUploadColMap = {};
  raUG_FIELD_DEFS.forEach(fd => raUgUploadColMap[fd.key] = raUgGetColIndex(fd.key));
  await raXlShowPreview('ug');
}

function raUgMapRow(row) {
  const get = key => { const i = raUgUploadColMap[key]; return (i!=null) ? String(row[i]??'').trim() : ''; };
  const getNum = key => { const v = get(key); return v!=='' && v!=='None' && !isNaN(parseFloat(v)) ? Math.round(parseFloat(v)) : null; };

  const trackParsed = raParseTrack(get('track'));
  const track = trackParsed || 'bunka';
  const era = raParseEra(get('era'));

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
  else if (/^[0-4]$/.test(origTierLabel)) tier = parseInt(origTierLabel);

  const mj = raMatchMajor(get('our_major'));
  const filled = k => get(k) !== '';
  const patchKeys = [];
  ['dept', 'spec', 'student', 'note'].forEach(k => { if (filled(k)) patchKeys.push(k); });
  if (univ) patchKeys.push('univ', 'school_type');
  if (trackParsed) patchKeys.push('track');
  if (filled('era')) patchKeys.push('era');
  if (tier !== null) patchKeys.push('tier');
  ['eju_japanese','eju_kijutsu','eju_bunsou','eju_math','eju_physics','eju_chemistry','eju_biology','eju_total','toefl','toeic'].forEach(k => { if (getNum(k) !== null) patchKeys.push(k); });
  const jl = get('jlpt'); const jlptOk = !!(jl && jl!=='None' && jl!=='无');
  if (jlptOk) patchKeys.push('jlpt');
  if (mj.key) patchKeys.push('our_major');

  return {
    univ: univ || null, dept: get('dept') || null, spec: get('spec') || null, student: get('student') || null,
    track, era, tier, school_type: univ ? raUgSchoolType(univ) : null,
    eju_japanese: getNum('eju_japanese'), eju_kijutsu: getNum('eju_kijutsu'),
    eju_bunsou: getNum('eju_bunsou'), eju_math: getNum('eju_math'),
    eju_physics: getNum('eju_physics'), eju_chemistry: getNum('eju_chemistry'),
    eju_biology: getNum('eju_biology'), eju_total: getNum('eju_total'),
    jlpt: jlptOk ? jl : null,
    toefl: getNum('toefl'), toeic: getNum('toeic'), note: get('note') || null,
    our_major: mj.key || null,
    _id: get('id'), _majorRaw: get('our_major'), _majorErr: mj.err, _patchKeys: patchKeys,
  };
}

async function raUgExecuteImport() { await raXlExecute('ug'); }

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

function raUgListRows() {
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
  return rows;
}

function raUgRenderList() {
  raArPendingRender('ug');
  const rows = raUgListRows();

  document.getElementById('ug-result-count').textContent = `${rows.length} 件`;
  document.getElementById('ug-export-btn').textContent = `⬇ 下载 Excel（${rows.length} 条）`;
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
  if (!raScopeCheck('grad', updates)) return;
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
  raArSetMajor('ugem', r.our_major || raArUgDefaultMajor(r.track || 'bunka'));
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
  if (!raScopeCheck('ug', updates)) return;
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
  raPhModeRender(kind);
  if (raFill[kind].mode === 'fill') return raFillLoad(kind, true);
  const c = raPH[kind], grid = document.getElementById(c.pre + '-grid');
  grid.innerHTML = '<div class="load-state">読み込み中...</div>';
  try {
    await raArLoadPhotoMap(kind);
    const rows = await raArFetchAll(`${c.table}?select=*&order=created_at.desc` + raScopeQs(kind));
    c.rows = rows.filter(r => raInMyScope(kind, r) && (raAR_PH[kind][String(r.id)] || raArLegacyUrl(r)));   // 有私有桶照片的，或还没迁移的旧照片
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
  if (raFill[kind].mode === 'fill') return raFillLoad(kind, true);   // 补图模式下搜索框 = 补图的搜索
  const c = raPH[kind], f = c.f, pm = c.posterMap;
  const q = (document.getElementById(c.pre + '-search')?.value || '').trim();
  const isUg = kind === 'ug';
  // 第二组筛选：学部=系統，大学院=本校专业（our_major → 旧学科对照 → 其他）
  const grpOf = r => isUg ? (r.track || 'other') : raRmFilterKey(r);
  const grpName = id => isUg ? (raPH_TRACK[id] || id || '其他') : (id === 'other' ? '其他' : raRmName(id) || '其他');
  const rowOk = (r, skip) => {
    if (skip !== 'era' && f.era && r.era !== f.era) return false;
    if (skip !== 'subj' && f.subj && grpOf(r) !== f.subj) return false;
    if (skip !== 'poster' && f.poster && pm) { const has = !!pm[r.id]; if ((f.poster === 'done') !== has) return false; }
    if (q && !searchMatch(q, [r.student, r.univ, r.dept, r.spec])) return false;
    return true;
  };
  const cnt = (skip, fn) => c.rows.filter(r => rowOk(r, skip) && fn(r)).length;
  // 筛选 chips（每组单独可用、互相交叉）
  let grpIds = [...new Set(c.rows.map(grpOf))];
  if (!isUg) grpIds = raRmGroups(grpIds).flatMap(g => g.items.map(x => x.key));   // 按领域分组排序，其他在最后
  const SHOW = 12;
  const shown = c.more ? grpIds : grpIds.filter((id, i) => i < SHOW || id === f.subj);
  const domOf = id => (isUg || id === 'other') ? '' : raRmDomain(id);
  const lab = t => `<span style="font-size:11px;color:var(--text-muted);margin-right:6px">${t}</span>`;
  let h = `<div style="margin-bottom:4px">${lab('年度')}`
    + raPhChip(!f.era, '全部', `raPhClear('${kind}','era')`)
    + [['new', '2026–2027'], ['hist', '2022–2025']].map(([k, l]) => raPhChip(f.era === k, `${l} (${cnt('era', r => r.era === k)})`, `raPhSet('${kind}','era','${k}')`)).join('') + '</div>';
  let lastDom = null;
  h += `<div style="margin-bottom:4px">${lab(isUg ? '系統' : '本校专业')}`
    + raPhChip(!f.subj, '全部', `raPhClear('${kind}','subj')`)
    + shown.map(id => {
      const d = domOf(id); let pre = '';
      if (!isUg && d !== lastDom) { pre = `<span style="font-size:10px;color:var(--text-muted);margin:0 4px 0 6px">${raArEsc(d || '其他')}</span>`; lastDom = d; }
      return pre + raPhChip(f.subj === id, `${grpName(id)} (${cnt('subj', r => grpOf(r) === id)})`, `raPhSet('${kind}','subj','${id}')`);
    }).join('')
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
          <div class="photo-card-sub">${esc(r.dept)}${r.spec ? ' ' + esc(r.spec) : ''}　${esc(isUg ? grpName(grpOf(r)) : raRmLabel(r))}${noteText ? '　' + esc(noteText) : ''}</div>
        </div>
      </div>`;
  }).join('') + '</div>';
  raArFillImgs(grid);
}
// ─── 补图：只列缺截图的合格记录，点一下 / 拖进来 / 粘贴 就能传 ─────────────────────
const raFill = { grad: null, ug: null };
function raFillNew() {
  return { mode: 'have', range: '1m', univ: '', subj: '', track: '', rows: [], schools: [], offset: 0, hasMore: false, gate: false,
    loading: false, seq: 0, sel: '', st: {}, phIds: null, pickId: '' };
}
raFill.grad = raFillNew(); raFill.ug = raFillNew();
const raFILL_RANGES = [['1w', '最近 1 周'], ['1m', '最近 1 个月'], ['3m', '最近 3 个月'], ['old', '3 个月以前'], ['all', '全部']];
const raFILL_PAGE = 100, raFILL_SCAN_MAX = 5000;
function raFillCols(kind) { return 'id,univ,dept,spec,student,' + (kind === 'ug' ? '' : 'subject,') + 'track,era,created_at,our_major'; }

function raPhModeRender(kind) {
  const c = raPH[kind], f = raFill[kind], el = document.getElementById(c.pre + '-mode'); if (!el) return;
  el.innerHTML = raPhChip(f.mode === 'have', '已有截图', `raFillMode('${kind}','have')`) + raPhChip(f.mode === 'fill', '补图', `raFillMode('${kind}','fill')`)
    + `<input type="file" accept="image/*" id="${c.pre}-fillfile" style="display:none" onchange="raFillFilePicked('${kind}',this)">`;
}
function raFillMode(kind, m) {
  const f = raFill[kind]; if (f.mode === m) return;
  f.mode = m;
  if (m === 'fill') { f.st = {}; f.sel = ''; }
  raLoadPhotos(kind);
}
// 老师端：默认选成这位老师负责领域对应的那一项（大学院 / 学部 + 系統）；负责多个领域的不预选
function raFillTeacherPreset() {
  if (!raIsTeacher() || typeof teacherData === 'undefined' || !teacherData) return;
  const doms = ((teacherData.domains || []).length ? teacherData.domains : (teacherData.managed_by || []));
  const hits = [];
  doms.forEach(d => {
    const m = String(d || '').match(/^(大学院|学部)(文科|理科|美术|美術)$/);
    if (m) hits.push([m[1] === '学部' ? 'ug' : 'grad', m[2] === '文科' ? 'bunka' : m[2] === '理科' ? 'rika' : 'bijutsu']);
  });
  if (hits.length !== 1 || doms.length !== 1) return;
  raFill[hits[0][0]].track = hits[0][1];
  if (hits[0][0] !== raCurMajor) raSwitchMajor(hits[0][0]);
}
function raFillSince(range) {
  const d = new Date();
  if (range === '1w') d.setDate(d.getDate() - 7); else if (range === '1m') d.setMonth(d.getMonth() - 1); else d.setMonth(d.getMonth() - 3);
  return d.toISOString();
}
function raFillSet(kind, k, v) {
  const f = raFill[kind];
  if (k === 'range') { f.range = v; f.univ = ''; } else f[k] = f[k] === v ? '' : v;
  if (k !== 'univ') f.schools = [];
  raFillLoad(kind, true);
}
async function raFillLoad(kind, reset) {
  const c = raPH[kind], f = raFill[kind], q = (document.getElementById(c.pre + '-search')?.value || '').trim();
  const seq = ++f.seq;
  if (reset) { f.rows = []; f.offset = 0; f.hasMore = false; f.st = {}; f.sel = ''; f.phIds = null; }
  f.gate = (f.range === 'old' || f.range === 'all') && !f.univ && !q;
  if (f.gate) { f.rows = []; f.loading = false; raFillRender(kind); return; }
  f.loading = true; raFillRender(kind);
  try {
    if (!f.phIds) {
      const [ph, leg] = await Promise.all([
        raArFetchAll(`result_photos?result_kind=eq.${kind}&select=result_id&order=created_at.asc`),
        raArFetchAll(`${c.table}?select=id,photo_url,note&${raAR_LEGACY_OR}`)
      ]);
      if (seq !== f.seq) return;
      f.phIds = new Set(ph.map(x => String(x.result_id)));
      leg.forEach(r => { if (raArLegacyUrl(r)) f.phIds.add(String(r.id)); });
    }
    let qs = `${c.table}?select=${raFillCols(kind)}&order=created_at.desc,id.desc`;
    if (f.range === 'old') qs += `&created_at=lt.${encodeURIComponent(raFillSince('3m'))}`;
    else if (f.range !== 'all') qs += `&created_at=gte.${encodeURIComponent(raFillSince(f.range))}`;
    if (f.univ) qs += `&univ=eq.${encodeURIComponent(f.univ)}`;
    if (f.track) qs += `&track=eq.${encodeURIComponent(f.track)}`;
    qs += raScopeQs(kind);
    const BATCH = 200, got = [];
    let scanned = 0, more = false;
    while (got.length < raFILL_PAGE) {
      const rows = await raSbFetch(`${qs}&limit=${BATCH}&offset=${f.offset}`, { headers: {} }) || [];
      if (seq !== f.seq) return;
      f.offset += rows.length; scanned += rows.length;
      for (const r of rows) {
        if (f.phIds.has(String(r.id)) || !raInMyScope(kind, r)) continue;
        if (f.subj && kind !== 'ug' && raRmFilterKey(r) !== f.subj) continue;
        if (q && !searchMatch(q, [r.student, r.univ, r.dept, r.spec])) continue;
        got.push(r);
      }
      if (rows.length < BATCH) { more = false; break; }
      more = true;
      if (scanned >= raFILL_SCAN_MAX) break;
    }
    f.rows = f.rows.concat(got); f.hasMore = more;
    if (!f.univ) f.schools = [...new Set(f.rows.map(r => r.univ).filter(Boolean))];
  } catch (e) {
    if (seq !== f.seq) return;
    f.loading = false;
    document.getElementById(c.pre + '-grid').innerHTML = `<div class="load-state" style="color:var(--red)">エラー: ${raArEsc(e.message)}</div>`;
    return;
  }
  f.loading = false; raFillRender(kind);
}
function raFillRender(kind) {
  const c = raPH[kind], f = raFill[kind], isUg = kind === 'ug', esc = raArEsc;
  const lab = t => `<span style="font-size:11px;color:var(--text-muted);margin-right:6px">${t}</span>`;
  let h = `<div style="margin-bottom:4px">${lab('录入时间')}` + raFILL_RANGES.map(([k, l]) => raPhChip(f.range === k, l, `raFillSet('${kind}','range','${k}')`)).join('') + '</div>';
  h += `<div style="margin-bottom:4px">${lab('系統')}` + Object.keys(raPH_TRACK).map(k => raPhChip(f.track === k, raPH_TRACK[k], `raFillSet('${kind}','track','${k}')`)).join('') + '</div>';
  if (!isUg) {
    const keys = [...new Set((raArMajors || []).filter(m => (m.domain || '').startsWith('大学院')).map(m => m.key).concat('other'))];
    h += `<div style="margin-bottom:4px">${lab('本校专业')}` + raRmGroups(keys).map(g => `<span style="font-size:10px;color:var(--text-muted);margin:0 4px 0 6px">${raArEsc(g.domain || '其他')}</span>` + g.items.map(x => raPhChip(f.subj === x.key, raArEsc(x.label), `raFillSet('${kind}','subj','${x.key}')`)).join('')).join('') + '</div>';
  }
  const SHOW = 12, sch = f.schools.slice().sort((a, b) => a.localeCompare(b, 'ja'));
  if (sch.length || f.univ) {
    const list = f.moreSchools ? sch : sch.filter((u, i) => i < SHOW || u === f.univ);
    h += `<div style="margin-bottom:4px">${lab('学校')}` + list.map(u => raPhChip(f.univ === u, esc(u), `raFillSet('${kind}','univ',this.dataset.u)" data-u="${esc(u)}`)).join('')
      + (sch.length > SHOW ? raPhChip(false, f.moreSchools ? '收起 ▴' : '更多 ▾', `raFill['${kind}'].moreSchools=!raFill['${kind}'].moreSchools;raFillRender('${kind}')`) : '') + '</div>';
  }
  document.getElementById(c.pre + '-filters').innerHTML = h;
  const grid = document.getElementById(c.pre + '-grid'), cnt = document.getElementById(c.pre + '-count');
  if (f.gate) { cnt.textContent = ''; grid.innerHTML = '<div class="load-state">请先选学校或搜索</div>'; return; }
  cnt.textContent = f.loading && !f.rows.length ? '' : `缺截图 ${f.rows.length}${f.hasMore ? '+' : ''} 条（当前条件）`;
  if (f.loading && !f.rows.length) { grid.innerHTML = '<div class="load-state">读取中...</div>'; return; }
  if (!f.rows.length) { grid.innerHTML = '<div class="load-state">该条件下没有缺截图的记录</div>'; return; }
  const btn = 'padding:2px 10px;font-size:11px;border:1px solid var(--border);background:var(--surface);border-radius:3px;cursor:pointer;font-family:inherit';
  grid.innerHTML = f.rows.map(r => {
    const id = String(r.id), s = f.st[id], sel = f.sel === id;
    const trackName = raPH_TRACK[r.track] || '';
    const info = `<span style="color:var(--text-muted);font-size:11px;width:78px;flex:none">${esc((r.created_at || '').slice(0, 10))}</span>`
      + `<span style="flex:1;min-width:0;font-size:12px"><b>${esc(r.univ) || '（未知大学）'}</b> ${esc(r.dept)}${r.spec ? ' ' + esc(r.spec) : ''}　<span style="color:var(--text-secondary)">${esc(r.student) || ''}</span>${trackName ? `　<span style="color:var(--text-muted);font-size:10px">${trackName}</span>` : ''}</span>`;
    let right;
    if (s && s.s === 'busy') right = '<span style="font-size:11px;color:var(--text-muted)">上传中…</span>';
    else if (s && s.s === 'done') right = `${s.url ? `<img src="${esc(s.url)}" style="height:34px;border:1px solid var(--border);border-radius:3px;cursor:pointer" onclick="event.stopPropagation();window.open(this.src,'_blank')">` : ''}<span style="font-size:12px;color:var(--green);font-weight:600">✓ 已补</span>`
      + `<button style="${btn}" onclick="event.stopPropagation();raFillPick('${kind}',this)">换一张</button><button style="${btn}" onclick="event.stopPropagation();raFillUndo('${kind}',this)">撤销</button>`;
    else right = (s && s.s === 'err' ? `<span style="font-size:11px;color:var(--red)">${esc(s.msg)}</span>` : '')
      + `<button style="${btn}" onclick="event.stopPropagation();raFillPick('${kind}',this)">${s && s.s === 'err' ? '重试' : '上传截图'}</button>`;
    return `<div class="ra-fill-row" data-rid="${esc(id)}" onclick="raFillSelect('${kind}',this)" ondragover="event.preventDefault();this.style.background='#fbf6e6'" ondragleave="this.style.background=''" ondrop="raFillDrop('${kind}',event,this)"
      style="display:flex;align-items:center;gap:10px;padding:6px 10px;border:1px solid ${sel ? 'var(--accent)' : 'var(--border)'};border-radius:4px;margin-bottom:4px;background:${s && s.s === 'done' ? '#eef7ee' : 'var(--surface)'};cursor:pointer">${info}<span style="display:flex;align-items:center;gap:8px;flex:none">${right}</span></div>`;
  }).join('')
    + (f.hasMore ? `<div style="text-align:center;margin-top:8px"><button class="btn btn-secondary" ${f.loading ? 'disabled' : ''} onclick="raFillLoad('${kind}',false)">${f.loading ? '读取中…' : '加载更多'}</button></div>` : '')
    + '<div style="font-size:10px;color:var(--text-muted);margin-top:6px">传法：点「上传截图」/ 把图片拖到这一行上 / 点选一行后按 Ctrl+V（⌘V）粘贴截图</div>';
}
function raFillRid(el) { const row = el.closest('.ra-fill-row'); return row ? row.dataset.rid : ''; }
function raFillSelect(kind, row) {
  raFill[kind].sel = row.dataset.rid;
  document.querySelectorAll(`#${raPH[kind].pre}-grid .ra-fill-row`).forEach(r => { r.style.borderColor = r === row ? 'var(--accent)' : 'var(--border)'; });
}
function raFillPick(kind, btn) {
  const f = raFill[kind]; f.pickId = raFillRid(btn); f.sel = f.pickId;
  const inp = document.getElementById(raPH[kind].pre + '-fillfile'); inp.value = ''; inp.click();
}
function raFillFilePicked(kind, inp) { const file = inp.files[0]; if (file) raFillUpload(kind, raFill[kind].pickId, file); inp.value = ''; }
function raFillDrop(kind, ev, row) {
  ev.preventDefault(); row.style.background = '';
  const file = [...(ev.dataTransfer.files || [])].find(x => /^image\//.test(x.type));
  if (file) raFillUpload(kind, row.dataset.rid, file); else raToast('请拖入图片文件', false);
}
async function raFillUpload(kind, id, file) {
  const f = raFill[kind], r = f.rows.find(x => String(x.id) === String(id));
  if (!r || !file) return;
  if (!/^image\//.test(file.type)) { raToast('只能上传图片', false); return; }
  if (f.st[id] && f.st[id].s === 'busy') return;
  f.st[id] = { s: 'busy' }; raFillRender(kind);
  try {
    const path = await raArUploadPhoto(file, kind);
    await raArSetPhoto(kind, id, path, null);
    let url = ''; try { url = (await raArSignedUrls([path]))[path] || ''; } catch (e) {}
    f.st[id] = { s: 'done', path, url };
    if (f.phIds) f.phIds.add(String(id));
  } catch (e) { f.st[id] = { s: 'err', msg: '失败：' + e.message }; }
  raFillRender(kind);
}
async function raFillUndo(kind, btn) {
  const f = raFill[kind], id = raFillRid(btn);
  if (!id || !confirm('撤销这张截图？（删掉截图文件，这条回到缺截图状态）')) return;
  try {
    await raArDeleteResultPhotos(kind, [id]);
    if (f.phIds) f.phIds.delete(String(id));
    delete f.st[id];
  } catch (e) { f.st[id] = { s: 'err', msg: '撤销失败：' + e.message }; }
  raFillRender(kind);
}
// 粘贴截图：点选一行后 Ctrl+V / ⌘V
if (!window.__raFillPasteBound) {
  window.__raFillPasteBound = true;
  document.addEventListener('paste', ev => {
    const kind = ['grad', 'ug'].find(k => {
      const f = raFill[k], g = document.getElementById(raPH[k].pre + '-grid');
      return f.mode === 'fill' && f.sel && g && g.offsetParent !== null;
    });
    if (!kind) return;
    const items = [...((ev.clipboardData && ev.clipboardData.items) || [])];
    const it = items.find(x => x.kind === 'file' && /^image\//.test(x.type));
    if (!it) return;
    const file = it.getAsFile(); if (!file) return;
    ev.preventDefault();
    raFillUpload(kind, raFill[kind].sel, file);
  });
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
  raXlTpl.grad = raXlTpl.ug = false; raXl.plan = { grad: [], ug: [] };
  raTierUnivData = []; raTierChanges = {};
  raUgTierUnivData2 = []; raUgTierChanges2 = {};
  raUgDataLoaded = false;
  ['grad', 'ug'].forEach(k => { raAR_PH[k] = {}; raAR_PH_LOADED[k] = false; });   // 照片路径表：每次进来重新读
  ['grad', 'ug'].forEach(k => { const c = raPH[k]; c.rows = []; c.posterMap = null; c.f = { era: '', subj: '', poster: '' }; c.more = false; });
  ['grad', 'ug'].forEach(k => { raFill[k] = raFillNew(); });
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
  ['grad', 'ug'].forEach(raPhModeRender);
  raFillTeacherPreset();
}
