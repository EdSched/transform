// ══════════════════════════════════
// teacher-consult.js — 🧭 咨询（营业咨询台，需 permissions.consult）
// 营业开会议共享屏幕给潜在学生看。4 步：① 学生信息 → ② 专业与院校 → ③ 课程与方案 → ④ 最终升学计划
// 数据：consult_leads（咨询者档案，一人一行，RLS 只有录入人自己和管理员能看）、faq（常见问题）
// 复用现有数据：admission_schools（出愿）、courses（课程）、price_packages（价目）、success_cases（合格案例）、promo_content / promo_videos（专业介绍）
// 院校 4 种状态全部按规则判断，不用 AI；「生成 AI 提示词」只整理文字让老师复制出去，不接任何 AI 接口，提示词里不放姓名和联系方式。
// 全局名字统一用 cst / CST_ 前缀。依赖：shared/constants.js、shared/supabase.js、teacher.js
// ══════════════════════════════════
let cst = {
  loaded: false, err: '', list: [], cur: null, step: 1, show: false, q: '', saving: '',
  adm: [], admKey: '', admLoading: false, admLimit: 30,
  courses: null, pkgs: null, cases: null, faqs: null, intro: null, introKey: '',
  open: {}, overlay: '', faqQ: '', crsQ: '', crsLimit: 30, dirty: {}, timer: null,
};

const CST_STEPS = [[1, '学生信息'], [2, '专业与院校'], [3, '课程与方案'], [4, '最终升学计划']];
const CST_STAGE = { 1: '信息采集', 2: '选校', 3: '课程', 4: '入学后' };
const CST_EDU = ['专科', '本科在读', '本科毕业', '硕士在读', '硕士毕业', '其他'];
const CST_JP_EXAMS = ['JLPT', 'J-TEST', 'EJU', 'BJT', '其他'];
const CST_EN_EXAMS = ['TOEFL', 'IELTS', 'TOEIC', '其他'];
const CST_LANG_ST = [['have', '已有成绩'], ['none', '未参加'], ['unrecorded', '有成绩未录入']];
const CST_KINDS = ['冲刺', '主申', '保底'];
const CST_ST = {
  ok: ['当前条件符合', '#1a5a3a', 'var(--ok-bg,#e6f2ea)'],
  short: ['补足条件后可考虑', '#8a6a1a', '#f6edd2'],
  manual: ['需要人工确认', '#4a4a8a', '#e8e8f4'],
  unfit: ['当前条件不符合', '#a03a2e', '#f6e2de'],
};
const CST_ST_ORDER = { ok: 0, short: 1, manual: 2, unfit: 3 };

const cstE = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cstJ = v => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
const cstYen = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const cstMajorName = k => (typeof ADMISSION_MAJORS !== 'undefined' && ADMISSION_MAJORS[k]) || (typeof majorLabel === 'function' ? majorLabel(k) : '') || k || '';
const cstMajorKeys = () => Object.keys(ADMISSION_MAJORS).filter(k => typeof salesMajorOkMe !== 'function' || salesMajorOkMe(k));
const cstYm = d => d.getFullYear() * 12 + d.getMonth();
const cstYmLabel = i => `${Math.floor(i / 12)}.${String(i % 12 + 1).padStart(2, '0')}`;
function cstCoursesObj(l) {   // lead.courses 兼容旧的数组写法：{ items, pkgs, custom }
  if (!l.courses || Array.isArray(l.courses)) l.courses = { items: Array.isArray(l.courses) ? l.courses : [], pkgs: [], custom: [] };
  const c = l.courses; c.items = c.items || []; c.pkgs = c.pkgs || []; c.custom = c.custom || [];
  return c;
}
function cstFilters(l) { if (!l.filters || Array.isArray(l.filters)) l.filters = {}; const f = l.filters; f.status = f.status || []; return f; }
function cstEnroll(l) { const m = String(l.target_enroll || '').match(/^(\d{4})-(\d{2})$/); return m ? { y: +m[1], m: +m[2] } : null; }

// ── 加载 / 保存 ──
async function renderConsult(mc) {
  mc.innerHTML = '<div class="loading">加载中…</div>';
  if (!cst.loaded) {
    try { cst.list = await sbAll('/rest/v1/consult_leads?select=*&order=updated_at.desc', { cache: 'no-store' }); cst.err = ''; cst.loaded = true; }
    catch (e) { cst.err = e.message; }
  }
  cstRender();
}
async function cstNew() {
  try {
    const r = await sb('/rest/v1/consult_leads', 'POST', { status: 'active', step: 1 });
    const row = Array.isArray(r) ? r[0] : r; if (!row) throw new Error('没有返回新档案');
    cst.list.unshift(row); cst.cur = row; cst.step = 1; cst.adm = []; cst.admKey = ''; cst.open = {};
    cstRender();
  } catch (e) { alert('新建失败：' + e.message); }
}
function cstPick(id) {
  const l = cst.list.find(x => x.id === id); if (!l) return;
  cstFlush();
  cst.cur = l; cst.step = l.step || 1; cst.adm = []; cst.admKey = ''; cst.open = {}; cst.admLimit = 30; cst.crsLimit = 30;
  cstRender();
}
function cstSet(k, v, rerender) {
  const l = cst.cur; if (!l) return;
  l[k] = (v === '' ? null : v); cst.dirty[k] = true; cst.saving = '保存中…';
  const st = document.getElementById('cst_state'); if (st) st.textContent = cst.saving;
  clearTimeout(cst.timer); cst.timer = setTimeout(cstFlush, 700);
  if (rerender) cstRender();
}
async function cstFlush() {
  clearTimeout(cst.timer);
  const l = cst.cur, keys = Object.keys(cst.dirty); if (!l || !keys.length) return;
  const body = { updated_at: new Date().toISOString() }; keys.forEach(k => { body[k] = l[k]; }); cst.dirty = {};
  try {
    await sb(`/rest/v1/consult_leads?id=eq.${encodeURIComponent(l.id)}`, 'PATCH', body);
    l.updated_at = body.updated_at; cst.saving = '已保存';
  } catch (e) { keys.forEach(k => { cst.dirty[k] = true; }); cst.saving = '保存失败：' + e.message; }
  const st = document.getElementById('cst_state'); if (st) st.textContent = cst.saving;
}
async function cstDelete() {
  const l = cst.cur; if (!l || !confirm(`删除「${l.name || '未命名'}」的咨询档案？删除后不能恢复。`)) return;
  try {
    await sb(`/rest/v1/consult_leads?id=eq.${encodeURIComponent(l.id)}`, 'DELETE');
    cst.list = cst.list.filter(x => x.id !== l.id); cst.cur = null; cst.dirty = {}; cstRender();
  } catch (e) { alert('删除失败：' + e.message); }
}
function cstGo(n) { cst.step = n; cst.admLimit = 30; if (cst.cur) cstSet('step', n); cstRender(); }
function cstToggleShow() { cst.show = !cst.show; cstRender(); }
function cstSec(id, title, body, dflt, hint) {
  const open = id in cst.open ? cst.open[id] : !!dflt;
  return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;margin-bottom:10px">
    <div onclick="cst.open['${id}']=${!open};cstRender()" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;user-select:none">
      <span style="font-size:13px;font-weight:600;font-family:'Noto Serif SC',serif">${title}</span>${hint ? `<span style="font-size:10px;color:var(--text-3)">${hint}</span>` : ''}
      <span style="font-size:10px;color:var(--text-3);margin-left:auto">${open ? '▾ 收起' : '▸ 展开'}</span></div>
    ${open ? `<div style="padding:0 14px 14px">${typeof body === 'function' ? body() : body}</div>` : ''}</div>`;
}
const cstChip = (on, label, click, extra) => `<span class="filter-chip${on ? ' active' : ''}" onclick="${click}" ${extra || ''}>${label}</span>`;

// ── 总框架 ──
function cstRender() {
  const mc = document.getElementById('mainContent'); if (!mc) return;
  if (cst.err) { mc.innerHTML = `<div class="empty">加载失败：${cstE(cst.err)}<br><span style="font-size:11px">（如果提示表不存在，请联系管理员先执行咨询台的建表 SQL）</span></div>`; return; }
  const q = cst.q.trim().toLowerCase();
  const list = cst.list.filter(l => !q || [l.name, l.target_major && cstMajorName(l.target_major), l.orig_major].join(' ').toLowerCase().includes(q));
  const l = cst.cur;
  const aside = `<div style="width:210px;flex:none">
    <button class="btn btn-primary btn-sm" style="width:100%;margin-bottom:8px" onclick="cstNew()">＋ 新咨询</button>
    <input placeholder="搜索咨询者" value="${cstE(cst.q)}" oninput="cst.q=this.value;cstRenderAside()" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:3px;margin-bottom:8px;box-sizing:border-box">
    <div id="cst_aside">${cstAsideHtml(list)}</div></div>`;
  mc.innerHTML = `<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">${aside}
    <div style="flex:1;min-width:300px">${l ? cstMainHtml() : '<div class="empty">左边选一位咨询者，或点「＋ 新咨询」</div>'}</div></div>${cst.overlay ? cstOverlayHtml() : ''}`;
}
function cstRenderAside() {
  const q = cst.q.trim().toLowerCase(), el = document.getElementById('cst_aside'); if (!el) return;
  el.innerHTML = cstAsideHtml(cst.list.filter(l => !q || [l.name, l.target_major && cstMajorName(l.target_major), l.orig_major].join(' ').toLowerCase().includes(q)));
}
function cstAsideHtml(list) {
  if (!list.length) return '<div style="font-size:11px;color:var(--text-3);padding:10px 2px">还没有咨询者</div>';
  return list.map(x => {
    const d = new Date(x.updated_at || x.created_at || Date.now());
    return `<div onclick="cstPick('${cstJ(x.id)}')" style="padding:8px 10px;border:1px solid ${cst.cur && cst.cur.id === x.id ? 'var(--accent)' : 'var(--border-light)'};background:${cst.cur && cst.cur.id === x.id ? 'var(--pick-bg,#f3ecd8)' : 'var(--surface)'};border-radius:3px;margin-bottom:5px;cursor:pointer">
      <div style="font-size:12px;font-weight:600">${cstE(x.name || '未命名')}</div>
      <div style="font-size:10px;color:var(--text-3)">${cstE([x.target_major ? cstMajorName(x.target_major) : '', `${d.getMonth() + 1}/${d.getDate()}`].filter(Boolean).join(' · '))}</div></div>`;
  }).join('');
}
function cstMainHtml() {
  const l = cst.cur;
  const steps = CST_STEPS.map(([n, t]) => `<div onclick="cstGo(${n})" style="flex:1;min-width:110px;padding:8px 10px;border:1px solid ${cst.step === n ? 'var(--accent)' : 'var(--border-light)'};background:${cst.step === n ? 'var(--pick-bg,#f3ecd8)' : 'var(--surface)'};border-radius:3px;cursor:pointer;font-size:12px;${cst.step === n ? 'font-weight:600' : 'color:var(--text-2)'}">${'①②③④'[n - 1]} ${t}</div>`).join('');
  const body = [null, cstStep1, cstStep2, cstStep3, cstStep4][cst.step]();
  return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
      <div style="font-size:15px;font-weight:600;font-family:'Noto Serif SC',serif">${cstE(l.name || '未命名咨询者')}</div>
      <span id="cst_state" style="font-size:10px;color:var(--text-3)">${cstE(cst.saving)}</span>
      <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm ${cst.show ? 'btn-primary' : 'btn-outline'}" onclick="cstToggleShow()">展示模式${cst.show ? '：开' : '：关'}</button>
        <button class="btn btn-outline btn-sm" onclick="cstOpenFaq()">常见问题</button>
        ${cst.show ? '' : '<button class="btn btn-outline btn-sm" style="color:var(--danger,#b03a2e)" onclick="cstDelete()">删除</button>'}
      </div></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${steps}</div>${body}
    <div style="display:flex;justify-content:space-between;margin-top:14px">
      ${cst.step > 1 ? `<button class="btn btn-outline btn-sm" onclick="cstGo(${cst.step - 1})">‹ 上一步</button>` : '<span></span>'}
      ${cst.step < 4 ? `<button class="btn btn-primary btn-sm" onclick="cstGo(${cst.step + 1})">下一步 ›</button>` : ''}</div>`;
}

// ══════════ 第 1 步：学生信息 + 简易时间轴 ══════════
function cstSel(k, opts, ph) {
  const l = cst.cur, o = opts.map(x => Array.isArray(x) ? x : [x, x]);
  return `<select onchange="cstSet('${k}',this.value,true)" style="width:100%;font-size:12px;padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit"><option value="">${ph || '请选择'}</option>${o.map(([v, t]) => `<option value="${cstE(v)}" ${l[k] === v ? 'selected' : ''}>${cstE(t)}</option>`).join('')}</select>`;
}
function cstInp(k, type, ph) {
  return `<input type="${type || 'text'}" value="${cstE(cst.cur[k])}" placeholder="${cstE(ph || '')}" onchange="cstSet('${k}',this.value,${k === 'name' ? 'true' : 'false'})" style="width:100%;font-size:12px;padding:6px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box;font-family:inherit">`;
}
const cstField = (label, html, wide) => `<div style="${wide ? 'grid-column:1/-1' : ''}"><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">${label}</div>${html}</div>`;
function cstEnrollOpts() {
  const y = new Date().getFullYear(), out = [];
  for (let i = 0; i < 4; i++) { out.push([`${y + i}-04`, `${y + i}年4月`]); out.push([`${y + i}-10`, `${y + i}年10月`]); }
  return out.filter(([v]) => v >= new Date().toISOString().slice(0, 7));
}
function cstStep1() {
  cstLoadAdm();
  const l = cst.cur, grid = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px';
  const jp = l.jp_status === 'have' || l.jp_status === 'unrecorded', en = l.en_status === 'have' || l.en_status === 'unrecorded';
  return `${cstSec('s1a', '基本情况', `<div style="${grid}">
      ${cstField('姓名', cstInp('name'))}
      ${cst.show ? '' : cstField('联系方式（内部）', cstInp('contact'))}
      ${cstField('学历', cstSel('edu_level', CST_EDU))}
      ${cstField('教育年限（年）', cstInp('edu_years', 'number'))}
      ${cstField('是否毕业', `<select onchange="cstSet('graduated',this.value===''?null:this.value==='true')" style="width:100%;font-size:12px;padding:6px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit"><option value="">请选择</option><option value="true" ${l.graduated === true ? 'selected' : ''}>已毕业</option><option value="false" ${l.graduated === false ? 'selected' : ''}>未毕业</option></select>`)}
      ${cstField('原专业', cstInp('orig_major'))}
      ${cstField('升学层次', cstSel('target_level', [['daigakuin', '大学院'], ['gakubu', '学部']]))}
      ${cstField('文理艺', cstSel('arts_sci', ['文科', '理科', '艺术']))}
      ${cstField('目标专业', cstSel('target_major', cstMajorKeys().map(k => [k, cstMajorName(k)])))}
      ${cstField('本专业 / 跨专业', cstSel('major_match', ['本专业', '跨专业']))}
    </div>`, true)}
    ${cstSec('s1b', '语言成绩', `<div style="${grid}">
      ${cstField('日语', cstSel('jp_status', CST_LANG_ST))}
      ${jp ? cstField('日语考试', cstSel('jp_exam', CST_JP_EXAMS)) + cstField('日语成绩（如 N2 / 250）', cstInp('jp_score')) : ''}
      ${cstField('英语', cstSel('en_status', CST_LANG_ST))}
      ${en ? cstField('英语考试', cstSel('en_exam', CST_EN_EXAMS)) + cstField('英语成绩（如 90）', cstInp('en_score')) : ''}
    </div>`, true)}
    ${cstSec('s1c', '时间计划', `<div style="${grid}">
      ${cstField('赴日时间', cstInp('arrive_date', 'date'))}
      ${cstField('目标入学时间', cstSel('target_enroll', cstEnrollOpts()))}
      ${cstField('目标学校等级', cstSel('school_grade', ['S', 'A', 'B', 'C', 'D', 'E', 'F']))}
    </div>${cst.show ? '' : `<div style="margin-top:10px">${cstField('内部备注（展示模式下隐藏）', `<textarea onchange="cstSet('note',this.value)" rows="2" style="width:100%;font-size:12px;padding:6px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box;font-family:inherit">${cstE(l.note)}</textarea>`, true)}</div>`}`, true)}
    ${cstSec('s1t', '简易升学时间轴', cstTimelineSimple, true, '预计')}`;
}
// 简易时间轴：没选目标校前是「预计」；选了目标校后换成数据库里的日程（已公布）
function cstTimelineSimple() {
  const l = cst.cur, en = cstEnroll(l);
  if (!en) return '<div style="font-size:11px;color:var(--text-3)">先选「目标入学时间」，这里会生成时间轴。</div>';
  const spring = en.m <= 6, rows = [];
  const tag = t => `<span style="font-size:9px;padding:1px 6px;border-radius:2px;background:${t === '已公布' ? '#e6f2ea' : '#f0ede4'};color:${t === '已公布' ? '#1a5a3a' : 'var(--text-3)'}">${t}</span>`;
  if (spring) {
    rows.push(['语言考试', `${en.y - 1}年6月（EJU）～ ${en.y - 1}年12月（JLPT）`, '预计', en.y - 1, 12]);
    rows.push(['出愿', `${en.y - 1}年6–9月（夏季）或 ${en.y - 1}年11月–${en.y}年1月（冬季）`, '预计', en.y - 1, 9]);
    rows.push(['校内考', `${en.y - 1}年8–9月（夏季）或 ${en.y}年1–2月（冬季）`, '预计', en.y - 1, 9]);
  } else {
    rows.push(['语言考试', `${en.y - 1}年12月（JLPT）～ ${en.y}年7月`, '预计', en.y, 7]);
    rows.push(['出愿', `${en.y}年3–6月`, '预计', en.y, 6]);
    rows.push(['校内考', `${en.y}年6–7月`, '预计', en.y, 7]);
  }
  rows.push(['入学', `${en.y}年${en.m}月`, '预计', en.y, en.m]);
  const goals = (l.goals || []).map(g => cst.adm.find(a => a.id === g.id)).filter(Boolean);
  goals.forEach(a => {
    if (a.application_period) rows.push([`出愿：${a.university}`, a.application_period, '已公布']);
    if (a.written_exam || a.oral_exam) rows.push([`校内考：${a.university}`, [a.written_exam && '笔试 ' + a.written_exam, a.oral_exam && '面试 ' + a.oral_exam].filter(Boolean).join(' / '), '已公布']);
    if (a.result_date) rows.push([`发表：${a.university}`, a.result_date, '已公布']);
  });
  const now = new Date(), first = rows.find(r => r[0] === '语言考试');
  const tight = first && cstYm(now) > first[3] * 12 + first[4] - 1 ? `<div style="background:#f6e2de;color:#a03a2e;font-size:11px;padding:7px 10px;border-radius:3px;margin-bottom:8px">时间紧：预计的语言考试时间已经过了，需要确认能赶上哪一次考试或调整入学时间。</div>` : '';
  return `${tight}<table style="width:100%;border-collapse:collapse;font-size:12px">${rows.map(r => `<tr style="border-bottom:1px solid var(--border-light)"><td style="padding:7px 4px;width:34%;font-weight:600">${cstE(r[0])}</td><td style="padding:7px 4px">${cstE(r[1])}</td><td style="padding:7px 4px;width:60px;text-align:right">${tag(r[2])}</td></tr>`).join('')}</table>
    <div style="font-size:10px;color:var(--text-3);margin-top:6px">「预计」是按常规日程估算；选了目标校后会换成出愿数据库里的日程（已公布）。</div>`;
}

// ══════════ 院校状态：按规则判断，不用 AI ══════════
const CST_NORM = { 'TOEFL IBT': 'TOEFL', 'TOEFL': 'TOEFL', 'IELTS': 'IELTS', 'TOEIC': 'TOEIC', 'EJU': 'EJU', 'J-TEST': 'J-TEST', 'JTEST': 'J-TEST', 'BJT': 'BJT', 'JLPT': 'JLPT' };
function cstParseReq(detail) {
  const t = String(detail || ''), alts = [];
  let m; const re1 = /(EJU|J-?TEST|BJT|TOEFL(?:\s*iBT)?|IELTS|TOEIC)[^0-9N]{0,8}?(\d+(?:\.\d+)?)/gi;
  while ((m = re1.exec(t))) alts.push({ exam: CST_NORM[m[1].toUpperCase().replace(/\s+/g, ' ')] || CST_NORM[m[1].toUpperCase().replace(/\s+/g, '')] || m[1].toUpperCase(), min: parseFloat(m[2]) });
  const re2 = /N([1-5])/gi; while ((m = re2.exec(t))) alts.push({ exam: 'JLPT', lvl: +m[1] });
  return alts;
}
// 出愿数据库的「语言明细」（english_tests / japanese_tests，如 { TOEFL:'〇（必須）', 'JLPT-N1':'〇', EJU:'〇（250）' }）：有明细就按明细判断
function cstTestsCheck(label, tests, status, exam, score) {
  const ok = v => { v = String(v == null ? '' : v).trim(); return !!v && !/^[×✕✗xX\-－―]+$/.test(v) && v !== 'なし'; };
  const acc = Object.entries(tests || {}).filter(([k, v]) => k !== 'その他' && ok(v));
  if (!acc.length) return null;
  const names = acc.map(([k, v]) => k.replace(/^JLPT-/, '') + (/[（(]\s*\d/.test(v) ? String(v).match(/[（(](.+?)[）)]/)[0] : '')).join('、');
  const need = `${label}需取得其中一项：${names}`;
  if (status === 'unrecorded') return { st: 'manual', note: `${label}成绩待录入后再判断` };
  if (status !== 'have') return { st: 'short', note: need };
  const ex = String(exam || '').toUpperCase(), sc = String(score || '').trim(), lvl = +((sc.match(/N([1-5])/i) || [])[1] || 0), num = parseFloat(sc);
  let hit = false, low = null;
  acc.forEach(([k, v]) => {
    const kk = k.toUpperCase();
    if (kk.startsWith('JLPT-N')) { if (ex === 'JLPT' && lvl && lvl <= +kk.slice(-1)) hit = true; return; }
    if (kk !== ex) return;
    const min = parseFloat(((String(v).match(/[（(]\s*(\d+(?:\.\d+)?)/) || [])[1]));
    if (isNaN(min)) { hit = true; return; }
    if (isNaN(num)) { low = low || 'x'; return; }
    if (num >= min) hit = true; else low = `目前 ${sc}，要求 ${min}`;
  });
  if (hit) return { st: 'ok' };
  if (low === 'x') return { st: 'manual', note: `${label}成绩（${sc || '未填'}）读不出分数，需人工确认` };
  return { st: 'short', note: low ? `${label}分数不够（${low}）` : `${need}（目前 ${exam || '其他考试'}${sc ? ' ' + sc : ''}）` };
}
function cstLangCheck(label, req, detail, status, exam, score, tests) {
  const r = String(req || '').trim();
  if (!r) return { st: 'manual', note: `${label}要求没有录入` };
  if (r !== '必須') return { st: 'ok' };
  const byTests = cstTestsCheck(label, tests, status, exam, score); if (byTests) return byTests;
  const alts = cstParseReq(detail);
  if (!alts.length) return { st: 'manual', note: `${label}要求是文字说明（${detail || '无详细'}），需人工确认` };
  const need = `${label}需取得 ${detail}`;
  if (status === 'unrecorded') return { st: 'manual', note: `${label}成绩待录入后再判断` };
  if (status !== 'have') return { st: 'short', note: need };
  const ex = CST_NORM[String(exam || '').toUpperCase().replace(/\s+/g, ' ')] || String(exam || '').toUpperCase();
  const sc = String(score || '').trim(), lvl = (sc.match(/N([1-5])/i) || [])[1], num = parseFloat(sc);
  const same = alts.filter(a => a.exam === ex);
  if (!same.length) return { st: 'short', note: `${need}（目前是 ${exam || '其他考试'}）` };
  const ok = same.some(a => a.exam === 'JLPT' ? (lvl && +lvl <= a.lvl) : (!isNaN(num) && num >= a.min));
  if (ok) return { st: 'ok' };
  if (ex === 'JLPT' ? !lvl : isNaN(num)) return { st: 'manual', note: `${label}成绩（${sc || '未填'}）读不出分数，需人工确认` };
  return { st: 'short', note: `${need}（目前 ${sc}）` };
}
// 出愿时间：取出愿月份里最晚的一个，按目标入学时间推算是哪一年
function cstDeadline(a, l) {
  const en = cstEnroll(l); if (!en) return null;
  const ms = (String(a.application_period || '').match(/(\d{1,2})月/g) || []).map(x => parseInt(x)); if (!ms.length) return null;
  const m = Math.max(...ms), y = m < en.m ? en.y : en.y - 1;
  return new Date(y, m, 0);
}
function cstEval(a) {
  const l = cst.cur, notes = [];
  let st = 'ok';
  const j = cstLangCheck('日语', a.japanese_required, a.japanese_detail, l.jp_status, l.jp_exam, l.jp_score, a.japanese_tests);
  const e = cstLangCheck('英语', a.english_required, a.english_detail, l.en_status, l.en_exam, l.en_score, a.english_tests);
  [j, e].forEach(x => { if (x.note) notes.push(x.note); });
  const hasMan = j.st === 'manual' || e.st === 'manual', hasShort = j.st === 'short' || e.st === 'short';
  if (/資格審査|资格审查/.test([a.notes, a.exam_style, a.admission_type].join(' '))) { notes.push('有资格审查'); st = 'manual'; }
  else if (hasMan) st = 'manual'; else if (hasShort) st = 'short';
  if (!a.application_period && !a.written_exam && !a.japanese_required && !a.english_required) { notes.push('学校关键信息为空'); st = 'manual'; }
  const dl = cstDeadline(a, l);
  if (dl && dl < new Date()) { notes.unshift('该期出愿时间已过'); st = 'unfit'; }
  return { st, notes };
}
const cstNone = s => { const t = String(s || '').trim(); return !t || /^(无|無|なし|不要|-|—|×)$/.test(t); };
function cstAdmFiltered(skip) {
  const l = cst.cur, f = cstFilters(l);
  let rows = cst.adm.map(a => ({ a, ev: cstEval(a) }));
  const tests = {
    q: r => !f.q || [r.a.university, r.a.faculty, r.a.department, r.a.course].join(' ').toLowerCase().includes(f.q.toLowerCase()),
    noEn: r => !f.noEn || r.a.english_required === '不要',
    noJp: r => !f.noJp || r.a.japanese_required === '不要',
    noWr: r => !f.noWr || cstNone(r.a.written_exam),
    noOr: r => !f.noOr || cstNone(r.a.oral_exam),
    status: r => !f.status.length || f.status.includes(r.ev.st),
    month: r => {
      if (!f.mFrom && !f.mTo) return true;
      const ms = (String(r.a.application_period || '').match(/(\d{1,2})月/g) || []).map(x => parseInt(x)); if (!ms.length) return false;
      return !((f.mFrom && Math.max(...ms) < f.mFrom) || (f.mTo && Math.min(...ms) > f.mTo));
    },
  };
  Object.entries(tests).forEach(([k, fn]) => { if (k !== skip) rows = rows.filter(fn); });
  return rows;
}
async function cstLoadAdm() {
  const l = cst.cur, k = l && l.target_major; if (!k || cst.admKey === k) return;
  cst.admKey = k; cst.adm = []; cst.admLoading = true;
  try { cst.adm = await sbAll(`/rest/v1/admission_schools?major=eq.${encodeURIComponent(k)}&select=*&order=university.asc`); } catch (e) { cst.adm = []; cst.admErr = e.message; }
  cst.admLoading = false; if (cst.cur && cst.cur.target_major === k) cstRender();
}
function cstSetF(k, v) { const f = cstFilters(cst.cur); f[k] = v; cst.admLimit = 30; cstSet('filters', f); cstRender(); }
function cstToggleF(k) { const f = cstFilters(cst.cur); cstSetF(k, !f[k]); }
function cstToggleStatus(s) { const f = cstFilters(cst.cur), i = f.status.indexOf(s); if (i >= 0) f.status.splice(i, 1); else f.status.push(s); cstSetF('status', f.status); }

// ══════════ 第 2 步：专业与院校 ══════════
async function cstLoadIntro() {
  const k = cst.cur && cst.cur.target_major; if (!k || cst.introKey === k) return;
  cst.introKey = k; cst.intro = null;
  try {
    const [blocks, videos] = await Promise.all([
      sb(`/rest/v1/promo_content?major=eq.${encodeURIComponent(k)}&select=*&order=sort_order.asc,created_at.asc`).catch(() => []),
      sb(`/rest/v1/promo_videos?major=eq.${encodeURIComponent(k)}&published=is.true&select=*&order=sort_order.asc`).catch(() => []),
    ]);
    cst.intro = { blocks: blocks || [], videos: videos || [] };
  } catch (e) { cst.intro = { blocks: [], videos: [] }; }
  if (cst.step === 2) cstRender();
}
async function cstLoadCases() {
  if (cst.cases) return;
  cst.cases = [];
  try { cst.cases = (await sbAll('/rest/v1/success_cases?select=*&order=updated_at.desc')).filter(c => c.published !== false); } catch (e) { cst.cases = []; }
  if (cst.step === 2) cstRender();
}
function cstStep2() {
  const l = cst.cur;
  if (!l.target_major) return '<div class="empty" style="padding:30px">请先在第 ① 步选择「目标专业」。</div>';
  cstLoadAdm(); cstLoadIntro(); cstLoadCases();
  const note = (l.target_level === 'gakubu' || l.arts_sci === '理科' || l.arts_sci === '艺术') ? `<div style="background:#f6edd2;color:#8a6a1a;font-size:11px;padding:7px 10px;border-radius:3px;margin-bottom:10px">出愿数据库目前只覆盖大学院文科，学部 / 理科 / 艺术的院校列表可能不全。</div>` : '';
  return note + cstSec('s2a', `专业介绍：${cstE(cstMajorName(l.target_major))}`, cstIntroHtml, false) +
    cstSec('s2b', '可考虑的院校', cstAdmHtml, true, '具备报考资格 ≠ 能够合格') +
    cstSec('s2c', `已确定的目标（${(l.goals || []).length}）`, cstGoalsHtml, true) +
    cstSec('s2d', '相关合格案例', cstCasesHtml, false);
}
function cstIntroHtml() {
  if (!cst.intro) return '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  const { blocks, videos } = cst.intro;
  if (!blocks.length && !videos.length) return '<div style="font-size:11px;color:var(--text-3)">这个专业在「宣传相关」里还没有介绍内容。</div>';
  const md = typeof prMd === 'function' ? prMd : cstE;
  return blocks.map(b => `<div style="margin-bottom:12px"><div style="font-weight:600;font-size:12px;margin-bottom:4px">${cstE(b.title)}</div><div style="font-size:12px;line-height:1.9;color:var(--text-2)">${md(b.body)}</div></div>`).join('') +
    (videos.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${videos.map(v => `<a href="${cstE(v.url)}" target="_blank" class="filter-chip" style="text-decoration:none">视频：${cstE(v.title)}${v.duration ? '（' + cstE(v.duration) + '）' : ''}</a>`).join('')}</div>` : '');
}
function cstAdmHtml() {
  const l = cst.cur, f = cstFilters(l);
  if (cst.admLoading) return '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  if (!cst.adm.length) return `<div style="font-size:11px;color:var(--text-3)">出愿数据库里还没有「${cstE(cstMajorName(l.target_major))}」的数据。${cst.admErr ? '（' + cstE(cst.admErr) + '）' : ''}</div>`;
  const rows = cstAdmFiltered().sort((x, y) => CST_ST_ORDER[x.ev.st] - CST_ST_ORDER[y.ev.st] || String(x.a.university).localeCompare(String(y.a.university), 'ja'));
  const cnt = {}; cst.adm.forEach(a => { const s = cstEval(a).st; cnt[s] = (cnt[s] || 0) + 1; });
  const mSel = (k, ph) => `<select onchange="cstSetF('${k}',parseInt(this.value)||0)" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg)"><option value="0">${ph}</option>${[...Array(12)].map((_, i) => `<option value="${i + 1}" ${f[k] === i + 1 ? 'selected' : ''}>${i + 1}月</option>`).join('')}</select>`;
  const chips = [['noEn', '不要英语'], ['noJp', '不要日语'], ['noWr', '无笔试'], ['noOr', '无面试']].map(([k, t]) => cstChip(!!f[k], t, `cstToggleF('${k}')`)).join('') +
    Object.keys(CST_ST).map(s => cstChip(f.status.includes(s), `${CST_ST[s][0]} ${cnt[s] || 0}`, `cstToggleStatus('${s}')`)).join('');
  let empty = '';
  if (!rows.length) {
    const hints = [['q', '搜索词'], ['noEn', '不要英语'], ['noJp', '不要日语'], ['noWr', '无笔试'], ['noOr', '无面试'], ['status', '状态'], ['month', '出愿月份']].filter(([k]) => cstAdmFiltered(k).length).map(x => x[1]);
    empty = `<div style="padding:16px;text-align:center;font-size:12px;color:var(--text-3)">没有符合的院校。${hints.length ? `去掉「${hints.join('」或「')}」条件就会有结果。` : '请放宽条件。'}</div>`;
  }
  const shown = rows.slice(0, cst.admLimit);
  const goalIds = (l.goals || []).map(g => g.id);
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <input placeholder="搜索学校 / 研究科" value="${cstE(f.q || '')}" onchange="cstSetF('q',this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;width:170px">
      <span style="font-size:10px;color:var(--text-3)">出愿月份</span>${mSel('mFrom', '从')}<span style="font-size:11px">—</span>${mSel('mTo', '至')}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${chips}</div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">共 ${rows.length} 条（出愿数据库里每个学校每一期各一条）</div>
    ${empty}${shown.map(({ a, ev }) => {
      const c = CST_ST[ev.st], isG = goalIds.includes(a.id);
      return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:9px 12px;margin-bottom:6px;background:var(--surface)">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:600">${cstE(a.university)}</span>
          <span style="font-size:11px;color:var(--text-2)">${cstE([a.faculty, a.department, a.course].filter(Boolean).join(' '))}</span>
          <span style="font-size:10px;padding:1px 7px;border-radius:2px;background:${c[2]};color:${c[1]}">${c[0]}</span>
          <button class="btn btn-sm ${isG ? 'btn-primary' : 'btn-outline'}" style="margin-left:auto" onclick="cstToggleGoal('${cstJ(a.id)}')">${isG ? '已设为目标' : '设为目标'}</button></div>
        <div style="font-size:11px;color:var(--text-3);margin-top:4px;line-height:1.8">出愿 ${cstE(a.application_period || '-')} · 笔试 ${cstE(a.written_exam || '-')} · 面试 ${cstE(a.oral_exam || '-')} · 英语 ${cstE(a.english_required || '-')}${a.english_detail ? '（' + cstE(a.english_detail) + '）' : ''} · 日语 ${cstE(a.japanese_required || '-')}${a.japanese_detail ? '（' + cstE(a.japanese_detail) + '）' : ''}</div>
        ${ev.notes.length ? `<div style="font-size:11px;color:${c[1]};margin-top:3px">${cstE(ev.notes.join('；'))}</div>` : ''}</div>`;
    }).join('')}
    ${rows.length > cst.admLimit ? `<div onclick="cst.admLimit+=30;cstRender()" style="text-align:center;padding:10px;font-size:11px;color:var(--accent);border:1px dashed var(--border);border-radius:4px;cursor:pointer">显示更多（还有 ${rows.length - cst.admLimit} 条）</div>` : ''}
    <div style="font-size:10px;color:var(--text-3);margin-top:8px">具备报考资格 ≠ 能够合格；这里不显示合格概率。「出愿时间已过」按目标入学时间推算，仅供参考。</div>`;
}
function cstGoalLabel(a) { return [a.university, a.faculty, a.department || a.course].filter(Boolean).join(' '); }
function cstToggleGoal(id) {
  const l = cst.cur, a = cst.adm.find(x => x.id === id); if (!a) return;
  const g = (l.goals || []).slice(), i = g.findIndex(x => x.id === id);
  if (i >= 0) g.splice(i, 1); else g.push({ id, label: cstGoalLabel(a), uni: a.university, kind: '主申' });
  cstSet('goals', g); cstRender();
}
function cstGoalKind(id, v) { const g = (cst.cur.goals || []).slice(), x = g.find(y => y.id === id); if (x) x.kind = v; cstSet('goals', g); cstRender(); }
function cstGoalsHtml() {
  const l = cst.cur, goals = l.goals || [];
  if (!goals.length) return '<div style="font-size:11px;color:var(--text-3)">还没有目标。在上面的院校列表里点「设为目标」，可选多个，每个标冲刺 / 主申 / 保底。</div>';
  return goals.map(g => {
    const a = cst.adm.find(x => x.id === g.id), ev = a ? cstEval(a) : null, c = ev && CST_ST[ev.st];
    const nowCond = [l.jp_status === 'have' ? `日语 ${l.jp_exam || ''} ${l.jp_score || ''}` : (l.jp_status === 'none' ? '日语未参加' : '日语待录入'), l.en_status === 'have' ? `英语 ${l.en_exam || ''} ${l.en_score || ''}` : (l.en_status === 'none' ? '英语未参加' : '英语待录入')].join('，');
    return `<div style="border:1px solid var(--border-light);border-radius:3px;padding:9px 12px;margin-bottom:6px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:13px;font-weight:600">${cstE(g.label)}</span>
        ${CST_KINDS.map(k => cstChip(g.kind === k, k, `cstGoalKind('${cstJ(g.id)}','${k}')`)).join('')}
        <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="cstToggleGoal('${cstJ(g.id)}')">移除</button></div>
      ${a ? `<div style="font-size:11px;color:var(--text-2);margin-top:5px;line-height:1.8">要求：英语 ${cstE(a.english_required || '-')}${a.english_detail ? '（' + cstE(a.english_detail) + '）' : ''}，日语 ${cstE(a.japanese_required || '-')}${a.japanese_detail ? '（' + cstE(a.japanese_detail) + '）' : ''}，出愿 ${cstE(a.application_period || '-')}<br>当前条件：${cstE(nowCond)}<br>差距：<span style="color:${c[1]}">${c[0]}${ev.notes.length ? '——' + cstE(ev.notes.join('；')) : ''}</span></div>` : '<div style="font-size:10px;color:var(--text-3);margin-top:4px">（院校数据还没加载，选了对应专业后会显示要求和差距）</div>'}</div>`;
  }).join('');
}
function cstCasesHtml() {
  const l = cst.cur; if (!cst.cases) return '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  const unis = (l.goals || []).map(g => g.uni).filter(Boolean);
  const hit = cst.cases.filter(c => (c.majors || []).includes(l.target_major) || unis.some(u => (c.schools || []).some(s => String(s.label || s).includes(u)) || String(c.result || '').includes(u)));
  if (!hit.length) return '<div style="font-size:11px;color:var(--text-3)">暂时没有和这位咨询者的专业 / 目标校相关的已发布案例。</div>';
  return hit.slice(0, 12).map(c => `<div style="border:1px solid var(--border-light);border-radius:3px;padding:9px 12px;margin-bottom:6px"><div style="font-weight:600;font-size:12px">${cstE(c.alias || '')} <span style="font-weight:400;color:var(--text-3)">${cstE(c.tagline || '')}</span></div><div style="font-size:11px;color:var(--text-2);line-height:1.8;margin-top:3px">${cstE(c.background || '')}</div><div style="font-size:11px;color:var(--accent);margin-top:3px">合格：${cstE(c.result || '')}</div></div>`).join('');
}

// ══════════ 第 3 步：课程与方案 ══════════
async function cstLoadCourses() {
  if (cst.courses) return; cst.courses = [];
  try {
    const [cs, pk] = await Promise.all([
      sbAll('/rest/v1/courses?select=id,name,major,period,period_override,course_type,domain,teacher,weekdays,time_range,delivery,campus,total_sessions,first_session_date&order=first_session_date.desc'),
      sbAll('/rest/v1/price_packages?active=is.true&select=*&order=sort_order.asc').catch(() => []),
    ]);
    cst.courses = cs; cst.pkgs = pk.filter(p => salesDomOkMe(p.domain || (DOMAINS.some(d => d.label === p.track) ? p.track : '')));
  } catch (e) { cst.courses = []; cst.pkgs = []; }
  if (cst.step === 3) cstRender();
}
function cstCourseEnd(c) {
  if (!c.first_session_date) return null;
  const d = new Date(c.first_session_date + 'T00:00:00'), per = Math.max(1, String(c.weekdays || '').split(/[,，、\s]+/).filter(Boolean).length);
  d.setDate(d.getDate() + Math.max(0, Math.ceil((c.total_sessions || 1) / per) - 1) * 7); return d;
}
function cstCrsAdd(id) {
  const co = cstCoursesObj(cst.cur), c = (cst.courses || []).find(x => x.id === id); if (!c || co.items.some(x => x.id === id)) return;
  const end = cstCourseEnd(c);
  co.items.push({ id, name: c.name, teacher: c.teacher || '', start: c.first_session_date || '', end: end ? end.toISOString().slice(0, 10) : '', reason: '' });
  cstSet('courses', co); cstRender();
}
function cstCrsDel(id) { const co = cstCoursesObj(cst.cur); co.items = co.items.filter(x => x.id !== id); cstSet('courses', co); cstRender(); }
function cstCrsReason(id, v) { const co = cstCoursesObj(cst.cur), x = co.items.find(y => y.id === id); if (x) x.reason = v; cstSet('courses', co); }
function cstPkgAdd(id) { const co = cstCoursesObj(cst.cur); if (id && !co.pkgs.includes(id)) co.pkgs.push(id); cstSet('courses', co); cstRender(); }
function cstPkgDel(id) { const co = cstCoursesObj(cst.cur); co.pkgs = co.pkgs.filter(x => x !== id); cstSet('courses', co); cstRender(); }
function cstCustomAdd() {
  const n = document.getElementById('cst_cn'), y = document.getElementById('cst_cy'); if (!n || !n.value.trim()) return;
  const co = cstCoursesObj(cst.cur); co.custom.push({ name: n.value.trim(), yen: Math.round(Number(y.value) || 0) }); cstSet('courses', co); cstRender();
}
function cstCustomDel(i) { const co = cstCoursesObj(cst.cur); co.custom.splice(i, 1); cstSet('courses', co); cstRender(); }
function cstPriceLines() {
  const co = cstCoursesObj(cst.cur), lines = [];
  co.pkgs.forEach(id => { const p = (cst.pkgs || []).find(x => x.id === id); if (p) lines.push({ name: p.name, detail: [p.track, p.period].filter(Boolean).join(' · '), yen: Math.round(Number(p.price_man_yen) * 10000), del: `cstPkgDel('${cstJ(id)}')` }); });
  co.custom.forEach((c, i) => lines.push({ name: c.name, detail: '其他', yen: c.yen, del: `cstCustomDel(${i})` }));
  return { lines, total: lines.reduce((s, x) => s + x.yen, 0) };
}
function cstStep3() {
  const l = cst.cur; cstLoadCourses(); cstLoadAdm();
  if (!cst.courses) return '<div class="empty">加载中…</div>';
  return cstSec('s3a', `选中的课程（${cstCoursesObj(l).items.length}）`, cstPickedHtml, true) +
    cstSec('s3b', '添加课程', cstCrsListHtml, !cstCoursesObj(l).items.length, '来自「课程安排」里已开的班级') +
    cstSec('s3c', '套餐与价格', cstPriceHtml, true) +
    cstSec('s3d', '详细时间轴', cstTimelineHtml, true);
}
function cstPickedHtml() {
  const items = cstCoursesObj(cst.cur).items;
  if (!items.length) return '<div style="font-size:11px;color:var(--text-3)">还没有选课程。在下面「添加课程」里选；每门课写一句选择理由，方便后面生成方案。</div>';
  return items.map(x => `<div style="border:1px solid var(--border-light);border-radius:3px;padding:8px 12px;margin-bottom:6px">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:12px;font-weight:600">${cstE(x.name)}</span><span style="font-size:10px;color:var(--text-3)">${cstE([x.teacher, x.start && (x.start + ' 起')].filter(Boolean).join(' · '))}</span>
    <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="cstCrsDel('${cstJ(x.id)}')">删除</button></div>
    <input placeholder="选择理由（例如：补足计划书、日语 N1）" value="${cstE(x.reason)}" onchange="cstCrsReason('${cstJ(x.id)}',this.value)" style="width:100%;margin-top:6px;font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box"></div>`).join('');
}
function cstCrsListHtml() {
  const l = cst.cur, picked = cstCoursesObj(l).items.map(x => x.id), q = cst.crsQ.trim().toLowerCase();
  const sameMajor = c => !l.target_major || c.major === l.target_major || (typeof groupMajors === 'function' && Object.keys(MAJOR_GROUPS || {}).some(g => groupMajors(g).includes(l.target_major) && c.major === g));
  let rows = cst.courses.filter(c => !picked.includes(c.id) && (q ? [c.name, c.teacher, c.major].join(' ').toLowerCase().includes(q) : sameMajor(c)));
  const total = rows.length; rows = rows.slice(0, cst.crsLimit);
  return `<input placeholder="搜索课程 / 老师（不搜索时只显示目标专业的课程）" value="${cstE(cst.crsQ)}" onchange="cst.crsQ=this.value;cst.crsLimit=30;cstRender()" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box;margin-bottom:8px">
    ${rows.map(c => `<div style="display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--border-light);padding:6px 2px;font-size:12px"><div style="flex:1;min-width:0"><div style="font-weight:600">${cstE(c.name)}</div><div style="font-size:10px;color:var(--text-3)">${cstE([c.teacher, c.weekdays && ('周' + c.weekdays), c.time_range, c.delivery, c.first_session_date && (c.first_session_date + ' 起'), c.total_sessions && (c.total_sessions + ' 次')].filter(Boolean).join(' · '))}</div></div><button class="btn btn-outline btn-sm" onclick="cstCrsAdd('${cstJ(c.id)}')">＋ 添加</button></div>`).join('') || '<div style="font-size:11px;color:var(--text-3)">没有找到课程。</div>'}
    ${total > cst.crsLimit ? `<div onclick="cst.crsLimit+=30;cstRender()" style="text-align:center;padding:10px;font-size:11px;color:var(--accent);cursor:pointer">显示更多（还有 ${total - cst.crsLimit} 门）</div>` : ''}`;
}
function cstPriceHtml() {
  const co = cstCoursesObj(cst.cur), { lines, total } = cstPriceLines();
  const opts = (cst.pkgs || []).filter(p => !co.pkgs.includes(p.id));
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <select id="cst_pk" style="font-size:12px;padding:5px;border:1px solid var(--border);border-radius:3px;max-width:100%"><option value="">选择大课套餐…</option>${opts.map(p => `<option value="${cstE(p.id)}">${cstE(p.track)} · ${cstE(p.name)}（${Number(p.price_man_yen)}万）</option>`).join('')}</select>
      <button class="btn btn-outline btn-sm" onclick="cstPkgAdd(document.getElementById('cst_pk').value)">＋ 加入</button>
      <input id="cst_cn" placeholder="其他项目（如 VIP 课、优惠）" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;width:170px"><input id="cst_cy" type="number" placeholder="日元（优惠填负数）" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;width:150px">
      <button class="btn btn-outline btn-sm" onclick="cstCustomAdd()">＋ 加入</button></div>
    ${lines.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px">${lines.map(x => {
      const del = x.del;
      return `<tr style="border-bottom:1px solid var(--border-light)"><td style="padding:6px 4px"><div style="font-weight:600">${cstE(x.name)}</div><div style="font-size:10px;color:var(--text-3)">${cstE(x.detail)}</div></td><td style="padding:6px 4px;text-align:right;font-family:'DM Mono',monospace;color:${x.yen < 0 ? '#a03a2e' : 'inherit'}">${cstYen(x.yen)}</td><td style="width:50px;text-align:right"><span style="font-size:10px;color:var(--text-3);cursor:pointer" onclick="${del}">删除</span></td></tr>`;
    }).join('')}</table>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px;padding-top:8px;border-top:2px solid var(--accent)"><span style="font-weight:600">总价</span><span><b style="font-size:18px;color:var(--accent);font-family:'DM Mono',monospace">${cstYen(total)}</b> 日元</span></div>` : '<div style="font-size:11px;color:var(--text-3)">还没选套餐。价格来自中枢「价目」里的大课套餐；VIP、助教等用「其他项目」手填，算不出来的请标注「需人工确认」。</div>'}`;
}
// 详细时间轴：按月排课程、目标校出愿、入学；课程结束晚于出愿截止的标红
function cstTimelineHtml() {
  const l = cst.cur, en = cstEnroll(l), items = cstCoursesObj(l).items;
  if (!en) return '<div style="font-size:11px;color:var(--text-3)">先在第 ① 步选「目标入学时间」。</div>';
  const now = new Date(), s0 = cstYm(now), e0 = en.y * 12 + en.m - 1, span = Math.min(Math.max(e0 - s0, 3), 30);
  const months = [...Array(span + 1)].map((_, i) => s0 + i);
  const goals = (l.goals || []).map(g => ({ g, a: cst.adm.find(x => x.id === g.id) })).filter(x => x.a);
  const dls = goals.map(({ a }) => cstDeadline(a, l)).filter(Boolean), firstDl = dls.length ? Math.min(...dls.map(d => cstYm(d))) : null;
  const rows = [];
  items.forEach(x => {
    if (!x.start) return;
    const s = cstYm(new Date(x.start + 'T00:00:00')), e = x.end ? cstYm(new Date(x.end + 'T00:00:00')) : s;
    rows.push({ name: x.name, from: s, to: e, color: '#b8953a', bad: firstDl != null && e > firstDl, note: firstDl != null && e > firstDl ? '课程结束晚于最早的出愿截止' : '' });
  });
  goals.forEach(({ g, a }) => {
    const ms = (String(a.application_period || '').match(/(\d{1,2})月/g) || []).map(x => parseInt(x)); if (!ms.length) return;
    const dl = cstDeadline(a, l); if (!dl) return;
    const to = cstYm(dl), from = to - (Math.max(...ms) - Math.min(...ms));
    rows.push({ name: `出愿：${g.uni}（${g.kind}）`, from, to, color: '#3a6a9a', bad: dl < now, note: dl < now ? '出愿时间已过' : '' });
  });
  rows.push({ name: '入学', from: e0, to: e0, color: '#1a5a3a' });
  const warns = rows.filter(r => r.note).map(r => `${r.name}：${r.note}`);
  if (!rows.length || (!items.length && !goals.length)) return '<div style="font-size:11px;color:var(--text-3)">选了课程和目标校后，这里会把它们排在同一条按月时间轴上。</div>' + '';
  return `${warns.length ? `<div style="background:#f6e2de;color:#a03a2e;font-size:11px;padding:7px 10px;border-radius:3px;margin-bottom:8px;line-height:1.8">${warns.map(cstE).join('<br>')}</div>` : ''}
    <div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:10px;min-width:100%"><tr><td style="padding:3px 6px;min-width:160px"></td>${months.map(m => `<td style="padding:3px 2px;text-align:center;color:var(--text-3);min-width:34px">${cstYmLabel(m)}</td>`).join('')}</tr>
    ${rows.map(r => `<tr style="border-top:1px solid var(--border-light)"><td style="padding:5px 6px;font-size:11px">${cstE(r.name)}</td>${months.map(m => `<td style="padding:2px;${m >= r.from && m <= r.to ? `background:${r.bad ? '#a03a2e' : r.color};` : ''}height:18px"></td>`).join('')}</tr>`).join('')}</table></div>
    <div style="font-size:10px;color:var(--text-3);margin-top:6px">金色=课程，蓝色=目标校出愿，绿色=入学，红色=冲突或已过。课程结束日按开课日和课次估算。</div>`;
}

// ══════════ 第 4 步：最终升学计划 ══════════
function cstPlanData() {
  const l = cst.cur, co = cstCoursesObj(l), { lines, total } = cstPriceLines(), en = cstEnroll(l);
  const lang = (st, ex, sc) => st === 'have' ? `${ex || ''} ${sc || ''}`.trim() || '已有成绩' : (st === 'none' ? '未参加' : (st === 'unrecorded' ? '有成绩，待录入' : '待确认'));
  return {
    '学生情况': [l.name, l.edu_level, l.edu_years && `教育年限 ${l.edu_years} 年`, l.graduated === true ? '已毕业' : (l.graduated === false ? '未毕业' : ''), l.orig_major && `原专业 ${l.orig_major}`].filter(Boolean).join('，') || '待确认',
    '升学方向': [l.target_level === 'gakubu' ? '学部' : (l.target_level === 'daigakuin' ? '大学院' : ''), l.arts_sci, l.target_major && cstMajorName(l.target_major), l.major_match].filter(Boolean).join(' · ') || '待确认',
    '语言现状': `日语：${lang(l.jp_status, l.jp_exam, l.jp_score)}；英语：${lang(l.en_status, l.en_exam, l.en_score)}`,
    '时间计划': [l.arrive_date && `赴日 ${l.arrive_date}`, en && `目标入学 ${en.y}年${en.m}月`].filter(Boolean).join('，') || '待确认',
    '目标院校': (l.goals || []).map(g => {
      const a = cst.adm.find(x => x.id === g.id), ev = a ? cstEval(a) : null;
      return `${g.kind}：${g.label}${a ? `（出愿 ${a.application_period || '-'}；${CST_ST[ev.st][0]}${ev.notes.length ? '：' + ev.notes.join('；') : ''}）` : ''}`;
    }),
    '课程方案': co.items.map(x => `${x.name}${x.teacher ? '（' + x.teacher + '）' : ''}${x.start ? ' ' + x.start + ' 起' : ''}${x.reason ? '——' + x.reason : ''}`),
    '费用': lines.map(x => `${x.name}：${cstYen(x.yen)} 日元`).concat(lines.length ? [`合计：${cstYen(total)} 日元`] : []),
    '规划老师评语': l.teacher_comment || '',
  };
}
function cstSavePlan() {
  const l = cst.cur; if (!confirm('把当前内容保存为一个方案版本？之后后台改了课程或价格，这个版本不会跟着变。')) return;
  cstSet('final_plan', { saved_at: new Date().toISOString(), data: cstPlanData() }); cstSet('plan_saved_at', new Date().toISOString());
  cstRender();
}
function cstStep4() {
  const l = cst.cur; cstLoadAdm(); cstLoadCourses();
  const data = l.final_plan && l.final_plan.data ? l.final_plan.data : cstPlanData(), saved = !!(l.final_plan && l.final_plan.data);
  const secs = Object.entries(data).filter(([k]) => k !== '规划老师评语').map(([k, v]) => `<div style="margin-bottom:10px"><div style="font-size:11px;color:var(--text-3);margin-bottom:3px">${k}</div>${Array.isArray(v) ? (v.length ? v.map(x => `<div style="font-size:12px;line-height:1.9">· ${cstE(x)}</div>`).join('') : '<div style="font-size:12px;color:var(--text-3)">待确认</div>') : `<div style="font-size:12px;line-height:1.9">${cstE(v)}</div>`}</div>`).join('');
  return `${cstSec('s4a', '升学计划', `<div style="font-size:10px;color:${saved ? '#1a5a3a' : 'var(--text-3)'};margin-bottom:8px">${saved ? '已保存的方案版本（' + cstE(String(l.final_plan.saved_at).slice(0, 16).replace('T', ' ')) + '），后台改动不会影响它' : '实时内容，还没保存成版本'}</div>${secs}
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick="cstSavePlan()">${saved ? '重新保存为新版本' : '保存方案版本'}</button><button class="btn btn-outline btn-sm" onclick="cstExportPdf()">导出 PDF</button></div>
      <div style="font-size:10px;color:var(--text-3);margin-top:8px">具备报考资格 ≠ 能够合格；本计划不含合格概率。</div>`, true)}
    ${cstSec('s4b', '规划老师评语', `<textarea oninput="cstSet('teacher_comment',this.value)" rows="8" style="width:100%;font-size:12px;line-height:1.8;padding:8px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box;font-family:inherit">${cstE(l.teacher_comment)}</textarea>
      <div style="font-size:10px;color:var(--text-3);margin:4px 0 8px">把 AI 写好的评语贴到这里，修改后保存。</div>
      ${cst.show ? '' : '<button class="btn btn-outline btn-sm" onclick="cstOpenPrompt()">生成 AI 提示词</button>'}`, true)}`;
}
function cstPromptText() {
  const l = cst.cur, d = cstPlanData(), co = cstCoursesObj(l);
  const tl = [];
  (l.goals || []).forEach(g => { const a = cst.adm.find(x => x.id === g.id); if (a) tl.push(`${g.uni}：出愿 ${a.application_period || '待确认'}，笔试 ${a.written_exam || '待确认'}，面试 ${a.oral_exam || '待确认'}，发表 ${a.result_date || '待确认'}`); });
  return `请你作为留学升学规划老师，为"该同学"写一段升学规划评语。

【写作要求】
1. 按下面 5 点来写：什么时候取得什么语言成绩；什么阶段准备什么材料；需要加强的专业能力；学生自己需要投入什么；如果没按计划完成，怎么调整目标。
2. 不承诺合格，不写合格概率；信息缺失的地方写"待确认"，不要自行补充。
3. 用中文，语气面向学生，控制在 600 字以内。

【该同学的情况】
- 升学方向：${d['升学方向']}
- 学历与背景：${d['学生情况'].replace(l.name || '\u0000', '该同学')}
- 语言现状：${d['语言现状']}
- 时间计划：${d['时间计划']}

【目标院校（冲刺 / 主申 / 保底）及当前差距】
${d['目标院校'].length ? d['目标院校'].map(x => '- ' + x).join('\n') : '- 待确认'}

【时间轴上的关键节点】
${tl.length ? tl.map(x => '- ' + x).join('\n') : '- 待确认'}

【选中的课程及选择理由】
${co.items.length ? co.items.map(x => `- ${x.name}${x.reason ? '：' + x.reason : ''}`).join('\n') : '- 待确认'}`;
}
function cstOpenPrompt() { cst.overlay = 'prompt'; cstRender(); }
function cstOpenFaq() { cst.overlay = 'faq'; cst.faqQ = ''; cstRender(); if (!cst.faqs) cstLoadFaq(); }
function cstCloseOverlay() { cst.overlay = ''; cstRender(); }
async function cstLoadFaq() {
  try { cst.faqs = await sbAll('/rest/v1/faq?select=*&order=sort.asc,created_at.asc'); } catch (e) { cst.faqs = []; cst.faqErr = e.message; }
  if (cst.overlay === 'faq') cstRender();
}
function cstCopyPrompt() { const t = document.getElementById('cst_prompt'); if (!t) return; t.select(); try { navigator.clipboard.writeText(t.value).then(() => alert('已复制')).catch(() => { document.execCommand('copy'); alert('已复制'); }); } catch (e) { document.execCommand('copy'); alert('已复制'); } }
function cstOverlayHtml() {
  const l = cst.cur, wrap = (title, inner) => `<div onclick="if(event.target===this)cstCloseOverlay()" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px"><div style="background:var(--bg);border-radius:6px;max-width:720px;width:100%;max-height:88vh;overflow:auto;padding:16px 18px"><div style="display:flex;align-items:center;margin-bottom:10px"><b style="font-size:14px;font-family:'Noto Serif SC',serif">${title}</b><button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="cstCloseOverlay()">关闭</button></div>${inner}</div></div>`;
  if (cst.overlay === 'prompt') return wrap('AI 提示词', `<div style="font-size:11px;color:var(--text-3);margin-bottom:6px">复制后贴到你自己用的 AI 里。提示词里没有姓名和联系方式，用"该同学"代替。</div><textarea id="cst_prompt" readonly rows="18" style="width:100%;font-size:12px;line-height:1.7;padding:8px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box;font-family:inherit">${cstE(cstPromptText())}</textarea><div style="margin-top:8px"><button class="btn btn-primary btn-sm" onclick="cstCopyPrompt()">复制</button></div>`);
  const q = cst.faqQ.trim().toLowerCase(), stage = CST_STAGE[cst.step];
  let rows = (cst.faqs || []).filter(f => f.published !== false);
  const fit = f => (!(f.levels || []).length || !l || (f.levels || []).includes(l.target_level)) && (!(f.majors || []).length || !l || (f.majors || []).includes(l.target_major)) && (!(f.stages || []).length || (f.stages || []).includes(stage));
  rows = q ? rows.filter(f => (f.question + ' ' + f.answer).toLowerCase().includes(q)) : rows.filter(fit);
  return wrap('常见问题', `<input placeholder="搜索问题" value="${cstE(cst.faqQ)}" oninput="cst.faqQ=this.value;cstFaqList()" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:3px;box-sizing:border-box;margin-bottom:6px"><div style="font-size:10px;color:var(--text-3);margin-bottom:8px">不搜索时，按这位咨询者的层次、专业和当前步骤（${stage}）自动筛选</div><div id="cst_faq">${cstFaqHtml(rows)}</div>`);
}
function cstFaqHtml(rows) {
  if (!cst.faqs) return '<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  if (!rows.length) return `<div style="font-size:11px;color:var(--text-3)">${cst.faqErr ? '读取失败：' + cstE(cst.faqErr) : '没有相关的问题。可以在上面搜索全部问题。'}</div>`;
  return rows.map(f => `<div style="border-bottom:1px solid var(--border-light);padding:8px 2px"><div style="font-size:12px;font-weight:600">${cstE(f.question)}</div><div style="font-size:12px;line-height:1.9;color:var(--text-2);margin-top:3px;white-space:pre-wrap">${cstE(f.answer)}</div></div>`).join('');
}
function cstFaqList() {
  const el = document.getElementById('cst_faq'); if (!el) return;
  const q = cst.faqQ.trim().toLowerCase(), l = cst.cur, stage = CST_STAGE[cst.step];
  let rows = (cst.faqs || []).filter(f => f.published !== false);
  rows = q ? rows.filter(f => (f.question + ' ' + f.answer).toLowerCase().includes(q)) : rows.filter(f => (!(f.levels || []).length || !l || f.levels.includes(l.target_level)) && (!(f.majors || []).length || !l || f.majors.includes(l.target_major)) && (!(f.stages || []).length || f.stages.includes(stage)));
  el.innerHTML = cstFaqHtml(rows);
}
// 导出 PDF：新窗口里排版，加载 Noto 字体后调用浏览器打印（另存为 PDF）
function cstExportPdf() {
  const l = cst.cur, data = l.final_plan && l.final_plan.data ? l.final_plan.data : cstPlanData();
  const sec = ([k, v]) => `<div class="s"><div class="k">${cstE(k)}</div>${Array.isArray(v) ? (v.length ? v.map(x => `<p>· ${cstE(x)}</p>`).join('') : '<p class="mute">待确认</p>') : `<p style="white-space:pre-wrap">${cstE(v) || '<span class="mute">待确认</span>'}</p>`}</div>`;
  const w = window.open('', '_blank'); if (!w) { alert('浏览器拦截了新窗口，请允许弹出窗口后再试'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>升学计划</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&family=Noto+Sans+SC:wght@400;500&display=swap" rel="stylesheet">
<style>body{font-family:'Noto Sans SC',sans-serif;color:#1a1814;background:#f7f5f0;max-width:760px;margin:24px auto;padding:0 20px;font-size:13px;line-height:1.9}h1{font-family:'Noto Serif SC',serif;font-size:22px;border-bottom:2px solid #b8953a;padding-bottom:8px}.s{border-bottom:1px solid #e2ded6;padding:8px 0}.k{font-family:'Noto Serif SC',serif;font-weight:600;color:#b8953a;font-size:13px}p{margin:2px 0}.mute{color:#999}.f{font-size:11px;color:#777;margin-top:18px}@media print{body{background:#fff;margin:0}}</style></head><body>
<h1>升学计划${l.name ? ' · ' + cstE(l.name) : ''}</h1>${Object.entries(data).map(sec).join('')}<div class="f">具备报考资格 ≠ 能够合格；本计划不含合格概率。生成于 ${new Date().toISOString().slice(0, 10)}</div></body></html>`);
  w.document.close();
  const go = () => { try { w.focus(); w.print(); } catch (e) {} };
  setTimeout(() => { (w.document.fonts && w.document.fonts.ready ? w.document.fonts.ready : Promise.resolve()).then(go, go); }, 400);
}
