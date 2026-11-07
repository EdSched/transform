// ══════════════════════════════════
// submissions.js — 考学进度 →「📥 学生提交」（管理端 / 老师端共用）
// 一条 = 一份提交：计划书（student_plan_drafts 有完成稿）、志望理由书、联系教授邮件、问询邮件（riyu_submissions）
// 默认只看待批复；已批复每次 50 条，按提交时间倒序，「加载更多」。
// 依赖：shared/supabase.js、constants.js、search.js、riyu.js（RIYU_STAFF / riyuStaffView）
// 用法：sbmRender(box, { students: () => 范围内在读学生[], pass: s => 是否通过领域/专业筛选（可选）, openPlan: (studentId, studentName) => void, barHtml: 领域/专业筛选栏 html 或返回 html 的函数（可选） })
// ══════════════════════════════════
const SBM_PAGE = 50;
const SBM_TYPES = [['plan', '计划书'], ['riyu', '志望理由书'], ['prof', '联系教授邮件'], ['inq', '问询邮件']];
const SBM_KIND_TYPE = { gakubu_riyu: 'riyu', grad_riyu: 'riyu', grad_prof_mail: 'prof', grad_inquiry_mail: 'inq' };
const SBM = {
  cfg: null, box: null,
  status: 'pending', types: [], track: '', range: '', q: '',
  drafts: null,                       // 有完成稿的计划书（student_plan_drafts 精简列）
  pend: null,                         // 待批复的 riyu 提交
  rev: [], revOffset: 0, revDone: false, revBusy: false,   // 已批复的 riyu 提交（分页加载）
  rows: {}, mark: null,                           // key -> row，供「打开」使用
};

function sbmEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function sbmMs(t) { const n = t ? new Date(t).getTime() : 0; return isNaN(n) ? 0 : n; }
function sbmFmt(t) { return (typeof riyuFmtTime === 'function' ? riyuFmtTime(t) : String(t || '').slice(0, 16)); }

// 计划书状态：没有批复版 → 待批复；批复（或老师评语）之后学生又更新 → 有更新；否则已批复
function sbmPlanState(d) {
  const upd = sbmMs(d.updated_at), rv = sbmMs(d.reviewed_at), cm = sbmMs(d.teacher_comment_at);
  if (!rv) return 'pending';
  return upd > Math.max(rv, cm) + 5000 ? 'updated' : 'done';   // 老师保存评语时也会改 updated_at，留 5 秒余量
}

async function sbmLoad(force) {
  if (force) { SBM.drafts = null; SBM.pend = null; SBM.rev = []; SBM.revOffset = 0; SBM.revDone = false; }
  const jobs = [];
  if (!SBM.drafts) jobs.push(sbAll('/rest/v1/student_plan_drafts?draft_file_url=not.is.null&select=id,student_id,draft_file_url,updated_at,reviewed_at,reviewed_file_url,teacher_comment_at').then(r => { SBM.drafts = r || []; }).catch(() => { SBM.drafts = []; }));
  if (!SBM.pend) jobs.push(sbAll('/rest/v1/riyu_submissions?status=eq.submitted&select=*&order=submitted_at.desc').then(r => { SBM.pend = r || []; }).catch(() => { SBM.pend = []; }));
  await Promise.all(jobs);
}

// 已批复的 riyu：服务器按提交时间倒序分页，页内按学生范围过滤，攒够 50 条或读完为止
async function sbmLoadReviewed(ids) {
  if (SBM.revBusy || SBM.revDone) return;
  SBM.revBusy = true;
  try {
    const want = SBM.rev.length + SBM_PAGE;
    while (SBM.rev.length < want && !SBM.revDone) {
      const page = await sb(`/rest/v1/riyu_submissions?status=eq.reviewed&select=*&order=submitted_at.desc.nullslast&limit=100&offset=${SBM.revOffset}`, 'GET', null, { cache: 'no-store' }).catch(() => []);
      SBM.revOffset += (page || []).length;
      if (!page || page.length < 100) SBM.revDone = true;
      (page || []).forEach(r => { if (ids.has(r.student_id)) SBM.rev.push(r); });
    }
  } finally { SBM.revBusy = false; }
}

function sbmRiyuRow(r, stu, reviewed) {
  const type = SBM_KIND_TYPE[r.kind] || 'riyu';
  const school = [r.school_name, r.faculty, r.department].filter(Boolean).join(' · ');
  const upd = !reviewed && sbmMs(r.reviewed_at) && sbmMs(r.submitted_at) > sbmMs(r.reviewed_at);
  return { key: 'r_' + r.id, kind: 'riyu', sub: r, stu, type, track: r.kind.indexOf('gakubu') === 0 ? 'gakubu' : 'grad', school, time: r.submitted_at || r.updated_at, st: reviewed ? 'done' : (upd ? 'updated' : 'pending'), label: (RIYU_DOC_NAME && RIYU_DOC_NAME[r.kind]) || '志望理由书' };
}

function sbmCollect(stuMap) {
  const out = [];
  (SBM.drafts || []).forEach(d => {
    const stu = stuMap.get(d.student_id); if (!stu) return;
    out.push({ key: 'p_' + d.id, kind: 'plan', draft: d, stu, type: 'plan', track: typeof matTrackOf === 'function' ? matTrackOf(stu) : 'grad', school: '', time: d.updated_at, st: sbmPlanState(d), label: '计划书' });
  });
  (SBM.pend || []).forEach(r => { const stu = stuMap.get(r.student_id); if (stu) out.push(sbmRiyuRow(r, stu, false)); });
  (SBM.rev || []).forEach(r => { const stu = stuMap.get(r.student_id); if (stu) out.push(sbmRiyuRow(r, stu, true)); });
  return out;
}

function sbmTest(x, skip) {
  if (skip !== 'status' && (SBM.status === 'pending') !== (x.st !== 'done')) return false;
  if (skip !== 'type' && SBM.types.length && !SBM.types.includes(x.type)) return false;
  if (skip !== 'track' && SBM.track && x.track !== SBM.track) return false;
  if (skip !== 'range' && SBM.range) {
    const days = SBM.range === '7' ? 7 : 30;
    if (sbmMs(x.time) < Date.now() - days * 86400000) return false;
  }
  if (SBM.cfg && SBM.cfg.pass && !SBM.cfg.pass(x.stu)) return false;   // 领域 / 专业筛选（页面自己的）
  const q = SBM.q.trim();
  if (q && !(matchesStudentSearch(x.stu, q) || (x.school && searchMatch(q, [x.school], { names: 0 })))) return false;
  return true;
}

async function sbmRender(box, cfg) {
  if (cfg) SBM.cfg = cfg;
  if (box) SBM.box = box;
  box = SBM.box; cfg = SBM.cfg; if (!box || !cfg) return;
  if (!SBM.drafts || !SBM.pend) { box.innerHTML = '<div class="loading">加载中…</div>'; await sbmLoad(false); }
  const students = (typeof cfg.students === 'function' ? cfg.students() : []) || [];
  const stuMap = new Map(students.map(s => [s.id, s]));
  if (SBM.status === 'done' && !SBM.rev.length && !SBM.revDone) { box.innerHTML = '<div class="loading">加载中…</div>'; await sbmLoadReviewed(new Set(stuMap.keys())); }
  const all = sbmCollect(stuMap);
  const list = all.filter(x => sbmTest(x)).sort((a, b) => sbmMs(b.time) - sbmMs(a.time));
  // 已批复：计划书是一次读完的，只显示到已加载 riyu 的最早时间为止，保持和「加载更多」一致
  let shown = list;
  if (SBM.status === 'done' && !SBM.revDone && SBM.rev.length) {
    const cut = Math.min.apply(null, SBM.rev.map(r => sbmMs(r.submitted_at)));
    shown = list.filter(x => x.kind !== 'plan' || sbmMs(x.time) >= cut);
  }
  const cnt = (skip, f) => all.filter(x => sbmTest(x, skip) && f(x)).length;
  const chip = (on, label, n, js) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${js}">${label}${n == null ? '' : ' ' + n}</div>`;
  const row = (label, chips) => `<div class="filter-row"><span style="font-size:10px;color:var(--text-3);min-width:30px;align-self:center">${label}</span>${chips}</div>`;
  const pendN = all.filter(x => sbmTest(x, 'status') && x.st !== 'done').length;
  SBM.rows = {};
  const ST = { pending: ['待批复', '#b8860b', '#fdf6e3'], updated: ['有更新', '#b03a2e', '#fbeae8'], done: ['已批复', '#2a7a4a', '#e4f0e8'] };
  const cards = shown.map(x => {
    SBM.rows[x.key] = x;
    const st = ST[x.st], track = x.track === 'gakubu' ? '学部' : '大学院';
    return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid ${x.key === SBM.mark ? 'var(--accent,#b8953a)' : 'var(--border-light,#ede9e2)'};border-radius:5px;padding:8px 10px;background:${x.key === SBM.mark ? '#fbf6e6' : 'var(--surface,#fff)'}">
      <span style="font-size:12px;font-weight:600">${sbmEsc(x.stu.name)}</span>
      <span style="font-size:10px;color:var(--text-3,#999)">${sbmEsc((typeof majorLabel === 'function' ? majorLabel(x.stu.major) : x.stu.major) || '')} · ${track}</span>
      <span style="font-size:10px;padding:1px 8px;border-radius:10px;background:var(--bg,#f7f5f0);color:var(--text-2,#5a5650);border:1px solid var(--border,#e2ded6)">${sbmEsc(x.label)}</span>
      ${x.school ? `<span style="font-size:11px;color:var(--text-2,#5a5650)">${sbmEsc(x.school)}</span>` : ''}
      <span style="font-size:10px;color:var(--text-3,#999)">${sbmEsc(sbmFmt(x.time))}</span>
      <span style="font-size:10px;padding:1px 8px;border-radius:10px;background:${st[2]};color:${st[1]}">${st[0]}</span>
      <button onclick="sbmOpen('${sbmEsc(x.key)}')" style="margin-left:auto;font-size:11px;border:1px solid var(--accent,#b8953a);color:var(--accent,#b8953a);background:none;border-radius:3px;padding:3px 12px;cursor:pointer;font-family:inherit">打开</button>
    </div>`;
  }).join('');
  SBM.mark = null;   // 刚看过的那一行只标这一次
  const more = SBM.status === 'done' && !SBM.revDone ? `<div onclick="sbmMore()" style="text-align:center;padding:10px;margin:8px 0;font-size:11px;color:var(--accent);border:1px dashed var(--border);border-radius:4px;cursor:pointer">${SBM.revBusy ? '加载中…' : '加载更多（每次 50 条）'}</div>` : '';
  box.innerHTML = `<div id="sbm_root">
    ${typeof cfg.barHtml === 'function' ? cfg.barHtml() : (cfg.barHtml || '')}
    <div class="filter-row">
      ${chip(SBM.status === 'pending', '待批复', pendN, "sbmSet('status','pending')")}
      ${chip(SBM.status === 'done', '已批复', SBM.status === 'done' ? list.length + (SBM.revDone ? '' : '+') : null, "sbmSet('status','done')")}
    </div>
    ${row('类型', SBM_TYPES.map(([k, l]) => chip(SBM.types.includes(k), l, cnt('type', x => x.type === k), `sbmToggleType('${k}')`)).join(''))}
    ${row('学段', [['', '全部'], ['gakubu', '学部'], ['grad', '大学院']].map(([k, l]) => chip(SBM.track === k, l, k ? cnt('track', x => x.track === k) : null, `sbmSet('track','${k}')`)).join(''))}
    ${row('时间', [['', '不限'], ['7', '最近 7 天'], ['30', '最近 30 天']].map(([k, l]) => chip(SBM.range === k, l, null, `sbmSet('range','${k}')`)).join(''))}
    <div class="search-bar"><input id="sbm_q" placeholder="搜索学生（汉字 / 拼音首字母）/ 学校…" value="${sbmEsc(SBM.q)}" oninput="searchBox(this,sbmSearch)"></div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:8px">共 ${list.length} 条${SBM.status === 'done' && !SBM.revDone ? '（已加载部分）' : ''}</div>
    <div style="display:flex;flex-direction:column;gap:6px">${cards || `<div class="empty">${SBM.status === 'pending' ? '没有待批复的提交' : '没有符合条件的记录'}</div>`}</div>
    ${more}
  </div>`;
}
function sbmSet(k, v) { SBM[k] = v; sbmRender(); }
function sbmToggleType(t) { const i = SBM.types.indexOf(t); if (i >= 0) SBM.types.splice(i, 1); else SBM.types.push(t); sbmRender(); }
function sbmSearch(q) {
  SBM.q = q || '';
  sbmRender().then(() => { const el = document.getElementById('sbm_q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
}
async function sbmMore() {
  const ids = new Set(((SBM.cfg && SBM.cfg.students && SBM.cfg.students()) || []).map(s => s.id));
  await sbmLoadReviewed(ids); sbmRender();
}
// 批复完成后（弹窗里上传了批复版）：重新读取并刷新列表
function sbmChanged() {
  if (!document.getElementById('sbm_root')) { SBM.drafts = null; SBM.pend = null; SBM.rev = []; SBM.revOffset = 0; SBM.revDone = false; return; }
  SBM.drafts = null; SBM.pend = null; SBM.rev = []; SBM.revOffset = 0; SBM.revDone = false;
  sbmRender();
}

function sbmOpen(key) {
  const x = SBM.rows[key]; if (!x) return;
  if (x.kind === 'plan') { if (SBM.cfg.openPlan) SBM.cfg.openPlan(x.stu.id, x.stu.name, { key }); return; }
  RIYU_STAFF.subs[x.sub.id] = x.sub;
  RIYU_STAFF.students[x.stu.id] = x.stu;
  RIYU_STAFF.onChangeBy[x.stu.id] = () => sbmChanged();
  riyuStaffView(x.sub.id);
}
