// ══════════════════════════════════
// monthly-report.js — 月度学习情况（老师端 / 管理端共用：统计口径、页面内容、家长版 PDF）
// 出勤・作业统计（smsLoad / studentMonthStats …）、本月课程、作业展示（含批复文字）、大学院文科「本月进展」
// 依赖：shared/supabase.js、shared/constants.js、shared/riyu.js、shared/artworks.js（awMonthWorks，可选）
// ══════════════════════════════════

function tsmDomainOf(major) {
  if (!major) return '';
  if (isMajorGroup(major)) return groupDomain(major) || MAJOR_DOMAIN[groupMajors(major)[0]] || '';
  return MAJOR_DOMAIN[major] || '';
}
const TSR_MARK = { pre: ['·', '#bbb', '#f4f4f4', '报名前'], ok: ['✓', '#1a6d3a', '#e4f3ea', '出席'], late: ['迟', '#8a6d10', '#fef5e0', '迟到'], leave: ['假', '#5a6a7a', '#eef1f5', '请假'], absent: ['✗', '#c0392b', '#fdecea', '缺席'], untaken: ['·', '#9a9590', '#f3f1ec', '未点名'], future: ['', 'var(--border)', 'transparent', '未上课'], none: ['', 'var(--border)', 'transparent', '未记录'] };

// ══ 学生出勤・作业统计（月度学习情况、出席・作业列表、重点关注、反馈文字共用，口径只此一处）══
// 已上课次 = 到今天为止、已经点过名（这节课至少有一条出席记录）的课次；没点名的课不进分母，单独提示「未点名 n 回」
// 出勤率 = (出席 + 迟到 + 录播回看) ÷ 已上课次；请假单独计；缺席 = 已上课次里没点到的（不含请假）
// 总回数 = 范围内所有课次（含未来），休讲不算
// 作业：已布置 = 作业已发布的课次，已交 = homework_submissions 里该生已提交的份数，提交率 = 已交 ÷ 已布置；共 = 开了作业的课次总数
// ym 为空 = 全部（从出席记录上线的 2026 年 10 月期开始，之前的不计），含未来课次
const SMS_START = '2026-10-01';
let smsCtxCache = {};   // ym → Promise<ctx>；记出席 / 刷新时清空
function smsChunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
async function smsFetchChunked(ids, n, fn) { return (await Promise.all(smsChunks(ids, n).map(fn))).flat(); }
function smsLoad(ym) {
  const k = ym || '';
  if (smsCtxCache[k]) return smsCtxCache[k];
  const p = (async () => {
    const today = jstToday();
    const lo = ym ? ym + '-01' : SMS_START;
    const hiQ = ym ? `&session_date=lt.${ymNextFirst(ym)}` : '';
    const sess = await sbAll(`/rest/v1/course_sessions?select=id,course_id,course_name,session_date,session_number,is_cancelled,confirmed,homework_enabled,hw_release_date&session_date=gte.${lo}${hiQ}&order=session_date.asc,id.asc`);
    const live = sess.filter(x => !x.is_cancelled && x.confirmed !== false && x.course_id);
    const cids = [...new Set(live.map(x => String(x.course_id)))];
    const recSids = live.filter(x => x.session_date <= today).map(x => String(x.id));   // 出席记录只会出现在已到日期的课次
    const hwSids = live.filter(x => x.homework_enabled).map(x => String(x.id));
    const q = ids => ids.map(x => `"${x}"`).join(',');
    const [courses, members, recs, subs] = await Promise.all([
      smsFetchChunked(cids, 80, ids => sbAll(`/rest/v1/courses?id=in.(${q(ids)})&select=*&order=id.asc`)),
      smsFetchChunked(cids, 80, ids => sbAll(`/rest/v1/course_members?course_id=in.(${q(ids)})&select=course_id,student_id,kind&order=course_id.asc,student_id.asc`)),
      smsFetchChunked(recSids, 80, ids => sbAll(`/rest/v1/session_records?session_id=in.(${q(ids)})&select=id,session_id,student_id,student_name,attendance_status,created_at&order=id.asc`)),
      smsFetchChunked(hwSids, 80, ids => sbAll(`/rest/v1/homework_submissions?session_id=in.(${q(ids)})&select=id,session_id,student_id,student_name&order=id.asc`)),
    ]);
    const ctx = { ym: k, live, courses, membersByStu: {}, rec: {}, sub: new Set(), taken: new Set() };
    members.forEach(m => { (ctx.membersByStu[String(m.student_id)] = ctx.membersByStu[String(m.student_id)] || []).push(m); });
    const rk = r => r.student_id ? `${r.session_id}|${r.student_id}` : `${r.session_id}|n:${r.student_name}`;
    recs.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))).forEach(r => {
      const key = rk(r); if (!ctx.rec[key]) ctx.rec[key] = r;   // 同一课次重复记录取最早一条
      if (r.attendance_status != null) ctx.taken.add(String(r.session_id));   // 这节课点过名
    });
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
// 一组课次的统计（sess 已是这个学生的课次）
function smsCalc(student, sess, ctx) {
  const today = jstToday();
  const s = { total: sess.filter(se => sessionCountsFor(student, se.session_date)).length, held: 0, present: 0, late: 0, leave: 0, actual: 0, absent: 0, untaken: 0, rate: null, hwAssigned: 0, hwDone: 0, hwTotal: 0, hwRate: null, marks: [] };
  sess.forEach(se => {
    const past = se.session_date <= today, taken = past && ctx.taken.has(String(se.id));
    const r = ctx.rec[`${se.id}|${student.id}`] || ctx.rec[`${se.id}|n:${student.name}`];
    if (!sessionCountsFor(student, se.session_date)) {   // 报名前的课次：不算缺席 / 未点名 / 分母 / 作业；有出席记录的照常算出席
      let pm = 'pre';
      if (taken && r) { const k = smsMark(r); if (k === 'ok') { s.present++; pm = k; } else if (k === 'late') { s.late++; pm = k; } }
      s.marks.push({ date: se.session_date, course: se.course_name || '', no: se.session_number, mark: pm, hw: '' });
      return;
    }
    let m = past ? 'untaken' : 'future';
    if (taken) {
      s.held++;
      m = r ? smsMark(r) : 'absent';
      if (m === 'ok') s.present++; else if (m === 'late') s.late++; else if (m === 'leave') s.leave++; else s.absent++;
    } else if (past) s.untaken++;
    let hw = '';
    if (se.homework_enabled) {
      s.hwTotal++;
      if (hwIsReleased(se, ctx.courseById[String(se.course_id)])) {
        s.hwAssigned++;
        hw = (ctx.sub.has(`${se.id}|${student.id}`) || ctx.sub.has(`${se.id}|n:${student.name}`)) ? 'done' : 'todo';
        if (hw === 'done') s.hwDone++;
      }
    }
    s.marks.push({ date: se.session_date, course: se.course_name || '', no: se.session_number, mark: m, hw });
  });
  s.actual = s.present + s.late;
  s.rate = s.held ? Math.min(100, Math.round(s.actual / s.held * 100)) : null;
  s.hwRate = s.hwAssigned ? Math.round(s.hwDone / s.hwAssigned * 100) : null;
  return s;
}
// mode：required 必修（默认，正式出勤率只算这些）/ elective 选修（单独统计）；按 studentAttRole 逐个学生判断，不记出席的课完全不进统计
function smsStudentSessions(student, ctx, mode) {
  const my = ctx.membersByStu[String(student.id)] || [];
  const want = mode || 'required';
  const cids = new Set(ctx.courses.filter(c => studentAttRole(student, c, my) === want).map(c => String(c.id)));
  return ctx.live.filter(x => cids.has(String(x.course_id)));
}
// ctx 范围内（一个月，或「全部」）的统计；byCourse = 每门课一行
function studentMonthStats(student, ctx) {
  const sess = smsStudentSessions(student, ctx);
  const s = smsCalc(student, sess, ctx);
  const elSess = smsStudentSessions(student, ctx, 'elective');
  s.elective = smsCalc(student, elSess, ctx);   // 选修课单独统计，不并入正式出勤率
  const byCourse = (list, mode) => {
    const g = {};
    list.forEach(se => { (g[String(se.course_id)] = g[String(se.course_id)] || []).push(se); });
    return Object.entries(g).map(([cid, l]) => ({ cid, mode, name: l[0].course_name || (ctx.courseById[cid] && ctx.courseById[cid].name) || '', st: smsCalc(student, l, ctx) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  };
  s.byCourse = byCourse(sess, 'required').concat(byCourse(elSess, 'elective'));   // 必出席在上，选修在下
  return s;
}
// 按期数（courses 所属期，如「2026年10月期」）分组 + 总计 + 当前期；用 smsLoad('') 的 ctx
function studentPeriodStats(student, ctx) {
  const sess = smsStudentSessions(student, ctx);
  const g = {}, cur = [];
  sess.forEach(se => {
    const c = ctx.courseById[String(se.course_id)];
    const key = c ? periodKeyOf(c) : '未分期';
    (g[key] = g[key] || []).push(se);
    if (c && courseInCurrentPeriod(c)) cur.push(se);
  });
  const curEl = smsStudentSessions(student, ctx, 'elective').filter(se => { const c = ctx.courseById[String(se.course_id)]; return c && courseInCurrentPeriod(c); });
  const curSt = smsCalc(student, cur, ctx);
  curSt.elective = smsCalc(student, curEl, ctx);
  return {
    periods: Object.keys(g).sort().reverse().map(key => ({ key, st: smsCalc(student, g[key], ctx) })),
    total: smsCalc(student, sess, ctx),
    cur: curSt,
  };
}
// 当前期累计缺席（不含请假）：{ n, courses[] }；ctx 用 smsLoad('')
function smsCurAbsent(student, ctx) {
  const cur = studentPeriodStats(student, ctx).cur;
  const cs = [...new Set(cur.marks.filter(m => m.mark === 'absent').map(m => m.course).filter(Boolean))];
  return { n: cur.absent, courses: cs };
}
// 文字版（所有地方共用）
function smsAttText(st) {
  if (!st.total) return '无课次';
  return `出席 ${st.actual} / 已上 ${st.held}（共 ${st.total} 回）` + (st.held ? ` · 出勤率 ${st.rate}%` : ' · 暂无已点名的课');
}
// 选修课一行（没有选修课次时返回空串）
function smsElectiveText(st) {
  if (!st || !st.elective || !st.elective.total) return '';
  const e = st.elective;
  return `选修：出席 ${e.actual} / 已上 ${e.held}（共 ${e.total} 回）`;
}
function smsHwText(st, word) {
  return `作业 已交 ${st.hwDone} / 已布置 ${st.hwAssigned}（${word || ''}共 ${st.hwTotal} 次）`;
}

// 月度学习情况：作品展示（美术领域，作品照片）/ 作业展示（其他领域，本月提交的作业）
function mrIsArt(stu) { return /美术|美術/.test(tsmDomainOf(stu && stu.major) || ''); }
// 大学院文科（领域名以 MAJOR_DOMAIN 为准）：作业只在布置了才显示 + 批复文字 + 「本月进展」
function mrIsGradHum(stu) { return tsmDomainOf(stu && stu.major) === '大学院文科'; }
function mrEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function mrWorksTitle(stu) { return mrIsArt(stu) ? '作品展示' : '作业展示'; }
// 班主任评价（学部）/ TA 老师评价（大学院等）：同一栏（monthly_reviews.homeroom_review），按领域换名字和填写权限
function mrHrLabel(stu) { return isGakubuMajor(stu && stu.major) ? '班主任' : 'TA 老师'; }
const mrHwCache = {};   // `${sid}|${ym}` → 本月提交的作业文件
const MR_NOT_IMG = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|txt|mp4|mov)(\?|#|$)/i;
// 本月作业文件 [{url, date, img}]：session_records.homework_file_url + homework_submissions 的答题图片 / 整份附件
async function mrMonthWorks(stu, ym, monthRecs) {
  const out = [], seen = new Set();
  const add = (url, date, img) => { if (url && !seen.has(url)) { seen.add(url); out.push({ url, date: date || '', img: img !== false && !MR_NOT_IMG.test(url) }); } };
  (monthRecs || []).forEach(r => add(r.homework_file_url, r.session_date));
  if (!mrIsArt(stu)) {
    const key = stu.id + '|' + ym;
    if (!mrHwCache[key]) {
      const [y, m] = ym.split('-').map(Number), next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
      mrHwCache[key] = await sb(`/rest/v1/homework_submissions?student_id=eq.${encodeURIComponent(stu.id)}&submitted_at=gte.${ym}-01&submitted_at=lt.${next}&select=*&order=submitted_at.asc`).catch(() => []);
    }
    (mrHwCache[key] || []).forEach(x => {
      const d = (x.submitted_at || '').slice(0, 10);
      (x.answers || []).forEach(a => (a.images || []).forEach(im => add(im.url, d, im.kind !== 'doc')));
      add(x.whole_file_url, d);
    });
  } else if (typeof awMonthWorks === 'function') (await awMonthWorks(stu.id, ym)).forEach(w => add(w.url, w.date));
  return out;
}
// 作业展示按「份」合并：一次提交 = 一份。[{id, date, course, no, graded, pages:[{url, thumb, rotate}], files:[url]}]
// 另外 session_records.homework_file_url（老师登记的文件）各算一份
async function mrMonthHwGroups(stu, ym, monthRecs) {
  const groups = [], seen = new Set();
  const isImg = (url, kind) => kind !== 'doc' && !MR_NOT_IMG.test(url || '');
  await mrMonthWorks(stu, ym, monthRecs);   // 只为填充 mrHwCache
  (mrHwCache[stu.id + '|' + ym] || []).forEach(x => {
    const g = { id: x.id, date: (x.submitted_at || '').slice(0, 10), course: x.course_name || '', no: x.session_number || '', graded: hwFeedbacks(x).length > 0, fbs: hwFeedbacks(x), pages: [], files: [] };
    (x.answers || []).forEach(a => (a.images || []).forEach(im => {
      if (!im.url || seen.has(im.url)) return; seen.add(im.url);
      if (isImg(im.url, im.kind)) g.pages.push({ url: im.url, thumb: im.thumb || '', rotate: im.rotate || 0 }); else g.files.push(im.url);
    }));
    if (x.whole_file_url && !seen.has(x.whole_file_url)) { seen.add(x.whole_file_url); if (isImg(x.whole_file_url)) g.pages.push({ url: x.whole_file_url, thumb: '', rotate: 0 }); else g.files.push(x.whole_file_url); }
    if (g.pages.length || g.files.length) groups.push(g);
  });
  (monthRecs || []).forEach(r => {
    const u = r.homework_file_url; if (!u || seen.has(u)) return; seen.add(u);
    const g = { id: 'rec-' + (r.id || u), date: r.session_date || '', course: r.course_name || '', no: '', graded: null, fbs: null, pages: [], files: [] };
    if (isImg(u)) g.pages.push({ url: u, thumb: '', rotate: 0 }); else g.files.push(u);
    groups.push(g);
  });
  return groups.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
let mrHwGroups = [];
function mrHwCardsHtml(groups, esc) {
  mrHwGroups = groups;
  const cols = window.innerWidth < 600 ? 3 : 5, limit = cols * 2;
  const card = (g, i) => {
    const p = g.pages[0], meta = [g.course, g.no ? '第' + g.no + '回' : '', (g.date || '').slice(5)].filter(Boolean).join(' · ');
    const st = g.graded === null ? '' : g.graded ? '<span style="color:var(--ok,#2a9e6a)">已批改</span>' : '<span style="color:var(--warn,#b8860b)">待批改</span>';
    const pg = g.pages.length ? `共 ${g.pages.length} 页` : '文件';
    const hide = i >= limit ? ' data-mrhw-more="1" style="display:none;' : ' style="';
    const inner = p
      ? `<img src="${esc(p.thumb || p.url)}" style="width:100%;height:100px;object-fit:cover;display:block;background:var(--bg)" loading="lazy">`
      : `<div style="height:100px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--accent)">文件链接</div>`;
    return `<div${hide}cursor:pointer;border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--surface)" onclick="mrOpenHwGroup(${i})">${inner}
      <div style="padding:4px 6px;font-size:10px;line-height:1.5"><div style="color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(meta)}">${esc(meta)}</div><div style="color:var(--text-3)">${pg}${st ? ' · ' + st : ''}</div></div></div>`;
  };
  const more = groups.length - limit;
  return `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;margin-bottom:${more > 0 ? 6 : 16}px">${groups.map(card).join('')}</div>`
    + (more > 0 ? `<div style="margin-bottom:16px"><button class="btn btn-outline btn-sm" onclick="mrHwToggleMore(this,${more})">还有 ${more} 份，展开</button></div>` : '');
}
function mrHwToggleMore(btn, n) {
  const hidden = btn.getAttribute('data-open') !== '1';
  btn.parentNode.previousElementSibling.querySelectorAll('[data-mrhw-more]').forEach(el => { el.style.display = hidden ? '' : 'none'; });
  btn.setAttribute('data-open', hidden ? '1' : '0');
  btn.textContent = hidden ? '收起' : `还有 ${n} 份，展开`;
}
// 点卡片：打开大图查看器逐页翻看（这时才加载原图）；纯文件的份直接新窗口打开
// 看大图：老师端有灯箱就用灯箱，管理端没有就新窗口打开
function mrImgOpen(url) { if (typeof tmImgLightbox === 'function') tmImgLightbox(url); else window.open(url, '_blank'); }
function mrOpenHwGroup(i) {
  const g = mrHwGroups[i]; if (!g) return;
  if (!g.pages.length) { if (g.files[0]) window.open(g.files[0], '_blank'); return; }
  if (typeof thwLightbox === 'function') thwLightbox(g.pages.map(p => ({ url: p.url, rot: typeof thwRotNorm === 'function' ? thwRotNorm(p.rotate) : 0 })), 0);
  else mrImgOpen(g.pages[0].url);
}
// 统计块：数字 + 每门课一行 + 逐回小标记（月度学习情况页面用）
function mrCoursesHtml(st, stu) {
  const gh = mrIsGradHum(stu);   // 大学院文科：没布置作业（或还没到发布日）的课，不写「作业」
  if (!st.byCourse.length) return '<div style="font-size:11px;color:var(--text-3);padding:4px 0 14px">本月没有课程</div>';
  const secs = [['required', ''], ['elective', '选修']].map(([mode, title]) => ({ title, list: st.byCourse.filter(c => c.mode === mode) })).filter(x => x.list.length);
  const marks = ms => ms.map(m => { const d = TSR_MARK[m.mark]; return `<span title="${mrEsc(m.date)} 第${m.no || ''}回：${d[3]}${m.hw ? (m.hw === 'done' ? ' · 作业已交' : ' · 作业未交') : ''}" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:3px;font-size:9px;border:1px solid ${d[1]};background:${d[2]};color:${d[1]}">${d[0]}</span>`; }).join('');
  const row = c => `<div style="padding:6px 0;border-top:1px solid var(--border-light)">
      <div style="font-size:12px"><span style="font-weight:600">${mrEsc(c.name)}</span>${c.mode === 'elective' ? ' <span style="font-size:9px;background:#f0e8d4;color:#7a5f1c;border-radius:2px;padding:1px 6px">选修</span>' : ''} · 出席 ${c.st.actual} / 已上 ${c.st.held}（共 ${c.st.total}）${(!gh || c.st.hwAssigned > 0) ? ` · 作业 ${c.st.hwDone} / ${c.st.hwAssigned}` : ''}${c.st.untaken ? ` <span style="font-size:10px;color:var(--text-3)">· 未点名 ${c.st.untaken} 回</span>` : ''}</div>
      <div style="display:flex;gap:2px;flex-wrap:wrap;margin-top:4px">${marks(c.st.marks)}</div></div>`;
  return `<div style="margin-bottom:16px">${secs.map(x => (x.title ? `<div style="font-size:10px;color:var(--text-3);margin:8px 0 2px">${x.title}</div>` : '') + x.list.map(row).join('')).join('')}</div>`;
}

// ══════════════════════════════════
// 作业批复文字（大学院文科：作业展示每一份下面带老师批复）
// ══════════════════════════════════
// 日期统一成 日本时间 YYYY-MM-DD；纯日期原样返回，时间戳按 JST 取日
function mrJstYmd(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = new Date(s);
  return isNaN(t) ? '' : new Date(t.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
}
function mrMD(v) { const d = mrJstYmd(v); return d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : ''; }
function mrFbParts(f) {
  const a = [];
  if (f.knowledge) a.push(['知识掌握', f.knowledge]);
  if (f.attitude) a.push(['学习态度', f.attitude]);
  if (f.suggestions) a.push(['建议', f.suggestions]);
  if (!a.length && f.text) a.push(['', f.text]);
  return a;
}
// g.fbs === null（老师登记的文件，不走批改流程）不显示；没有批复 = 待老师批复
function mrFeedbackHtml(g, fs) {
  if (!g || g.fbs === null || g.fbs === undefined) return '';
  const size = fs || 12;
  const list = g.fbs.map(f => ({ f, parts: mrFbParts(f) })).filter(x => x.parts.length);
  if (!list.length) return g.fbs.length ? `<div style="font-size:${size}px;color:#9a9590;margin-top:4px">已批复</div>` : `<div style="font-size:${size - 1}px;color:#9a9590;margin-top:4px">待老师批复</div>`;
  return list.map(x => `<div style="margin-top:4px;padding:5px 8px;background:#f7f5f0;border-radius:4px;font-size:${size}px;line-height:1.7;color:#3a352e;white-space:pre-wrap">${x.parts.map(([l, v]) => `<div>${l ? `<b>${l}：</b>` : ''}${mrEsc(v)}</div>`).join('')}<div style="font-size:${size - 1}px;color:#9a9590;text-align:right">— ${mrEsc([x.f.by, mrMD(x.f.at)].filter(Boolean).join(' '))}</div></div>`).join('');
}
// 页面上的作业展示（大学院文科）：一份一行，左边第一页缩略图，右边课程名 · 回数 · 日期 + 批复文字；点缩略图看大图
function mrHwListHtml(groups, esc) {
  mrHwGroups = groups;
  const limit = 6;
  const row = (g, i) => {
    const p = g.pages[0], meta = [g.course, g.no ? '第' + g.no + '回' : '', mrMD(g.date)].filter(Boolean).join(' · ');
    const pg = g.pages.length ? `共 ${g.pages.length} 页` : '文件';
    const img = p ? `<img src="${esc(p.thumb || p.url)}" style="width:72px;height:72px;object-fit:cover;display:block;border:1px solid var(--border);border-radius:4px;background:var(--bg)" loading="lazy">` : `<div style="width:72px;height:72px;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--accent);border:1px solid var(--border);border-radius:4px">文件链接</div>`;
    return `<div${i >= limit ? ' data-mrhw-more="1"' : ''} style="${i >= limit ? 'display:none;' : 'display:flex;'}gap:10px;padding:8px 0;border-top:1px solid var(--border-light)">
      <div style="flex:none;cursor:pointer" onclick="mrOpenHwGroup(${i})">${img}</div>
      <div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text-2)">${esc(meta)} <span style="font-size:10px;color:var(--text-3)">· ${pg}</span></div>${mrFeedbackHtml(g, 12)}</div></div>`;
  };
  const more = groups.length - limit;
  return `<div style="margin-bottom:${more > 0 ? 6 : 16}px">${groups.map(row).join('')}</div>`
    + (more > 0 ? `<div style="margin-bottom:16px"><button class="btn btn-outline btn-sm" onclick="mrHwToggleMore(this,${more})">还有 ${more} 份，展开</button></div>` : '');
}

// ══════════════════════════════════
// 本月进展（大学院文科）：只列这个月（日本时间）发生的更新，按学生 id 查这个月的范围
// ══════════════════════════════════
function mrRecHas(r) { return !!(r && typeof r === 'object' && Object.values(r).some(v => v && (typeof v === 'string' ? v.trim() : Object.values(v).some(x => x)))); }
// 面谈记录分节：与 buildRecordText（constants.js）同样的分节和字段，只是排成 [{title, rows:[[标签, 内容]]}] 方便排版
function mrRecSections(r) {
  r = r || {};
  const out = [];
  [['知识学习进展', 'study'], ['计划书完成情况', 'plan'], ['出愿情况', 'apply'], ['备考情况', 'exam']].forEach(([title, k]) => {
    const rows = [];
    if (r[`${k}_status`]) rows.push(['状态', r[`${k}_status`]]);
    if (r[`${k}_advice`]) rows.push(['建议', r[`${k}_advice`]]);
    if (r[`${k}_deadline`]) rows.push(['期限', r[`${k}_deadline`]]);
    if (rows.length) out.push({ title, rows });
  });
  if (r.issue || r.issue_advice) {
    const rows = [];
    if (r.issue) rows.push(['问题', r.issue]);
    if (r.issue_advice) rows.push(['建议', r.issue_advice]);
    if (r.issue_deadline) rows.push(['期限', r.issue_deadline]);
    out.push({ title: '目前困惑', rows });
  }
  if (r.extra) out.push({ title: '补充', rows: [['', r.extra]] });
  return out;
}
async function mrMonthProgress(stu, ym) {
  const sid = encodeURIComponent(stu.id), lo = ym + '-01', hi = ymNextFirst(ym);
  const loT = lo + 'T00:00:00%2B09:00', hiT = hi + 'T00:00:00%2B09:00';   // 日本时间的月初 / 下月初
  const errs = [];
  const get = (name, path) => sb(path).then(r => Array.isArray(r) ? r : []).catch(() => { errs.push(name); return []; });
  const [bks, logs, tl, plans, drafts, riyu] = await Promise.all([
    get('面谈', `/rest/v1/bookings?student_id=eq.${sid}&daily_record=not.is.null&or=(and(actual_time.gte.${lo},actual_time.lt.${hi}),and(slot_date.gte.${lo},slot_date.lt.${hi}))&select=id,slot_id,slot_date,actual_time,assigned_teacher,daily_record&order=slot_date.asc`),
    get('学习记录', `/rest/v1/student_contact_logs?student_id=eq.${sid}&or=(for_month.eq.${ym},and(created_at.gte.${loT},created_at.lt.${hiT}))&select=*&order=created_at.asc`),
    get('语言成绩・进度', `/rest/v1/student_progress_timeline?student_id=eq.${sid}&or=(and(recorded_at.gte.${lo},recorded_at.lt.${hi}),and(created_at.gte.${loT},created_at.lt.${hiT}))&select=*&order=created_at.asc`),
    get('择校', `/rest/v1/student_school_plans?student_id=eq.${sid}&created_at=gte.${loT}&created_at=lt.${hiT}&select=*&order=created_at.asc`),
    get('研究计划书', `/rest/v1/student_plan_drafts?student_id=eq.${sid}&select=*&limit=5`),
    get('文书', `/rest/v1/riyu_submissions?student_id=eq.${sid}&or=(and(submitted_at.gte.${loT},submitted_at.lt.${hiT}),and(reviewed_at.gte.${loT},reviewed_at.lt.${hiT}))&select=id,kind,school_name,faculty,department,status,submitted_at,reviewed_at,reviewed_by,mail_meta&order=submitted_at.asc`),
  ]);
  const inMonth = d => !!d && d >= lo && d < hi;
  const byDate = (a, b) => String(a.d).localeCompare(String(b.d));
  const out = { interviews: [], logs: [], langs: [], schools: [], docs: [], others: [], errs };

  // 面谈：日期 = 实际面谈时间，没有就用预约日期；老师没填就取时间槽的老师
  const bkOk = bks.map(b => ({ b, d: (b.actual_time && String(b.actual_time).slice(0, 10)) || b.slot_date || '' })).filter(x => mrRecHas(x.b.daily_record) && inMonth(x.d));
  const slotIds = [...new Set(bkOk.filter(x => !x.b.assigned_teacher && x.b.slot_id).map(x => String(x.b.slot_id)))];
  let slotTeacher = {};
  if (slotIds.length) {
    (await get('面谈老师', `/rest/v1/slots?id=in.(${slotIds.map(x => `"${x}"`).join(',')})&select=id,teacher_name`)).forEach(s => { slotTeacher[String(s.id)] = s.teacher_name || ''; });
  }
  out.interviews = bkOk.map(x => ({ d: x.d, teacher: x.b.assigned_teacher || slotTeacher[String(x.b.slot_id)] || '', secs: mrRecSections(x.b.daily_record) })).filter(x => x.secs.length).sort(byDate);

  // 学习记录：只要「学习记录」，「已联系·等回复」「未回复」不放
  out.logs = logs.filter(l => l.kind !== 'no_reply' && l.kind !== 'waiting' && String(l.note || '').trim() && (l.for_month || mrJstYmd(l.created_at).slice(0, 7)) === ym)
    .map(l => ({ d: mrJstYmd(l.created_at), teacher: l.teacher_name || '', note: String(l.note).trim() })).sort(byDate);

  // 进度时间线：日期 = recorded_at（纯日期时），否则创建日
  const tlOk = tl.map(e => ({ e, d: /^\d{4}-\d{2}-\d{2}/.test(e.recorded_at || '') ? e.recorded_at.slice(0, 10) : mrJstYmd(e.created_at) })).filter(x => inMonth(x.d));
  tlOk.forEach(({ e, d }) => {
    if (e.japanese) out.langs.push({ d, text: `日语：${e.japanese}` });
    if (e.english) out.langs.push({ d, text: `英语：${e.english}` });
    const note = String(e.notes || '').trim();
    if (note && /志望校/.test(note)) out.schools.push({ d, text: note });
    if (e.source === 'booking' || e.booking_id) return;   // 面谈带出来的进度已在「面谈」里，不重复
    if (e.plan) out.others.push({ d, text: `计划书：${e.plan}` });
    if (e.apply) out.others.push({ d, text: `出愿：${e.apply}` });
    if (e.exam) out.others.push({ d, text: `备考：${e.exam}` });
    if (note && !/志望校/.test(note)) out.others.push({ d, text: `备注：${note}` });
  });
  plans.forEach(p => {
    const name = [p.school_name, p.faculty, p.department].filter(Boolean).join(' · ');
    if (name) out.schools.push({ d: mrJstYmd(p.created_at), text: `新增志望校：${name}` });
  });

  // 研究计划书・文书
  drafts.forEach(dr => {
    if (dr.draft_file_url && inMonth(mrJstYmd(dr.updated_at))) out.docs.push({ d: mrJstYmd(dr.updated_at), text: '提交研究计划书完成稿' });
    const hist = (typeof planRvHistory === 'function') ? planRvHistory(dr) : [];
    hist.forEach(h => { const d = mrJstYmd(h.at); if (inMonth(d)) out.docs.push({ d, text: '老师批复研究计划书' }); });   // 只写状态，不带批复备注
  });
  // 看不了文书内容的老师：数据库不返回草稿行，只用状态函数补一行「提交了计划书第 N 版」
  try {
    await docScopeLoad([stu.id]);
    const st = !docCanView(stu.id) && docStatusOf(stu.id);
    if (st && st.plan_version_no && inMonth(mrJstYmd(st.plan_submitted_at))) out.docs.push({ d: mrJstYmd(st.plan_submitted_at), text: `提交研究计划书第 ${st.plan_version_no} 版` });
  } catch (e) {}
  riyu.forEach(s => {
    const doc = (typeof RIYU_DOC_NAME === 'object' && RIYU_DOC_NAME[s.kind]) || '志望理由书';
    const sch = [s.school_name, s.faculty, s.department].filter(Boolean).join(' · ');
    const isMail = typeof riyuIsMail === 'function' && riyuIsMail(s.kind);
    const sd = mrJstYmd(s.submitted_at), rd = mrJstYmd(s.reviewed_at);
    if (inMonth(sd)) {
      if (isMail) { const st = (typeof riyuMeta === 'function' ? riyuMeta(s).status : '') || ''; out.docs.push({ d: sd, text: `${doc}：${sch || '（不指定学校）'}${st ? ' ' + riyuMailStatusText(s.kind, st) : ' 已提交'}` }); }
      else out.docs.push({ d: sd, text: `提交${doc}${sch ? `（${sch}）` : ''}` });
    }
    if (inMonth(rd)) out.docs.push({ d: rd, text: `老师批复${doc}${sch ? `（${sch}）` : ''}` });   // 只写状态，不带批复备注
  });

  ['langs', 'schools', 'docs', 'others'].forEach(k => out[k].sort(byDate));
  return out;
}
function mrProgressHtml(p, fs) {
  const size = fs || 12;
  const sub = t => `<div style="font-size:${size}px;font-weight:600;color:#b8953a;margin:10px 0 4px">${t}</div>`;
  const line = x => `<div style="display:flex;gap:8px;font-size:${size}px;line-height:1.8;color:#3a352e;padding:1px 0"><span style="flex:none;width:34px;color:#9a9590">${mrMD(x.d)}</span><span style="flex:1;min-width:0;white-space:pre-wrap">${mrEsc(x.text)}</span></div>`;
  const parts = [];
  if (p.interviews.length) parts.push(sub('面谈') + p.interviews.map(v => `<div style="margin:4px 0 8px;padding:6px 10px;background:#f7f5f0;border-radius:4px;page-break-inside:avoid;break-inside:avoid">
      <div style="font-size:${size}px;font-weight:600;color:#3a352e">${mrMD(v.d)}${v.teacher ? ' · ' + mrEsc(v.teacher) : ''}</div>
      ${v.secs.map(sc => `<div style="margin-top:4px"><div style="font-size:${size - 1}px;font-weight:600;color:#8a6d1c">${sc.title}</div>${sc.rows.map(([l, t]) => `<div style="font-size:${size}px;line-height:1.7;color:#3a352e;white-space:pre-wrap">${l ? `<span style="color:#9a9590">${l}：</span>` : ''}${mrEsc(t)}</div>`).join('')}</div>`).join('')}</div>`).join(''));
  if (p.logs.length) parts.push(sub('学习记录') + p.logs.map(l => `<div style="font-size:${size}px;line-height:1.8;color:#3a352e;padding:1px 0;white-space:pre-wrap"><span style="color:#9a9590">${mrMD(l.d)}${l.teacher ? ' · ' + mrEsc(l.teacher) : ''}　</span>${mrEsc(l.note)}</div>`).join(''));
  if (p.langs.length) parts.push(sub('语言成绩') + p.langs.map(line).join(''));
  if (p.schools.length) parts.push(sub('择校') + p.schools.map(line).join(''));
  if (p.docs.length) parts.push(sub('研究计划书・文书') + p.docs.map(line).join(''));
  if (p.others.length) parts.push(sub('其他进度') + p.others.map(line).join(''));
  const warn = p.errs.length ? `<div style="font-size:${size - 1}px;color:#c0392b;margin-top:6px">部分数据没有加载出来（${mrEsc(p.errs.join('、'))}），请刷新重试。</div>` : '';
  if (!parts.length) return `<div style="font-size:${size}px;color:#9a9590;padding:4px 0">本月暂无新的进展记录</div>${warn}`;
  return parts.join('') + warn;
}

// ══════════════════════════════════
// 页面内容 + 家长版 PDF（老师端 / 管理端共用）
// ══════════════════════════════════
// 统计数字格：大学院文科本月没布置作业时不显示「交作业」那一格
function mrStatCells(st, stu) {
  const cells = [['已上课次', '已上 ' + st.held + ' / 共 ' + st.total + ' 回'], ['出勤（出席+迟到）', st.actual + ' 次'], ['出勤率', st.rate == null ? '—' : st.rate + '%'], ['请假', st.leave + ' 次'], ['缺席', st.absent + ' 次']];
  if (!mrIsGradHum(stu) || st.hwAssigned > 0) cells.push(['交作业', '已交 ' + st.hwDone + ' / 已布置 ' + st.hwAssigned + '（共 ' + st.hwTotal + ' 次）']);
  return cells;
}
// 从统计到作业展示的整块页面内容；统计加载失败会抛错
async function mrSummaryHtml(stu, ym, monthRecs) {
  const st = studentMonthStats(stu, await smsLoad(ym));
  const works = await mrMonthWorks(stu, ym, monthRecs);
  const gh = mrIsGradHum(stu);
  const hwGroups = mrIsArt(stu) ? null : await mrMonthHwGroups(stu, ym, monthRecs);
  const prog = gh ? await mrMonthProgress(stu, ym) : null;
  const wt = mrWorksTitle(stu), esc = mrEsc;
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:16px">
      ${mrStatCells(st, stu).map(([l, v]) => `
        <div style="background:var(--bg);border:1px solid var(--border-light);border-radius:6px;padding:8px 10px;text-align:center">
          <div style="font-size:16px;font-weight:700;color:var(--accent,#b8953a)">${v}</div>
          <div style="font-size:10px;color:var(--text-3);margin-top:2px">${l}</div>
        </div>`).join('')}
    </div>
    ${st.untaken ? `<div style="font-size:10px;color:var(--text-3);margin:-8px 0 10px">未点名 ${st.untaken} 回（没点名的课不算进出勤率，请老师补点名）</div>` : ''}
    <div style="font-size:10px;color:var(--text-3);letter-spacing:.05em;margin-bottom:6px">本月课程</div>
    ${mrCoursesHtml(st, stu)}
    ${gh ? `<div style="font-size:10px;color:var(--text-3);letter-spacing:.05em;margin-bottom:6px">本月进展</div><div style="margin-bottom:16px">${mrProgressHtml(prog, 12)}</div>` : ''}
    <div style="font-size:10px;color:var(--text-3);letter-spacing:.05em;margin-bottom:8px">${wt}（学生本月提交）</div>
    ${hwGroups ? (hwGroups.length ? (gh ? mrHwListHtml(hwGroups, esc) : mrHwCardsHtml(hwGroups, esc)) : `<div style="font-size:11px;color:var(--text-3);padding:8px 0 16px">本月暂无提交的作业</div>`) : works.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:16px">
      ${works.map(w => w.img ? `<div onclick="mrImgOpen('${esc(w.url)}')" style="cursor:zoom-in;border:1px solid var(--border);border-radius:6px;overflow:hidden"><img src="${esc(w.url)}" style="width:100%;height:90px;object-fit:cover;display:block" loading="lazy"><div style="font-size:9px;color:var(--text-3);padding:3px 5px">${(w.date || '').slice(5)}</div></div>`
        : `<a href="${esc(w.url)}" target="_blank" style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:116px;border:1px solid var(--border);border-radius:6px;font-size:11px;color:var(--accent);text-decoration:none">文件链接<span style="font-size:9px;color:var(--text-3);margin-top:4px">${(w.date || '').slice(5)}</span></a>`).join('')}
    </div>` : `<div style="font-size:11px;color:var(--text-3);padding:8px 0 16px">本月暂无提交的${wt === '作品展示' ? '作品' : '作业'}</div>`}`;
}

// 家长版 PDF（米色系）→ 新窗口打印；rev = monthly_reviews 行（可空）
async function mrOpenPdf(stu, ym0, monthRecs, rev) {
  const w = window.open('', '_blank');
  if (!w) { alert('请允许弹出窗口以生成PDF'); return; }
  try {
    rev = rev || {};
    const gh = mrIsGradHum(stu);
    const st = studentMonthStats(stu, await smsLoad(ym0));
    const works = (await mrMonthWorks(stu, ym0, monthRecs)).filter(x => x.img);   // 作品展示（PDF 只放图片）
    let hwGroups = null;
    if (!mrIsArt(stu)) { hwGroups = await mrMonthHwGroups(stu, ym0, monthRecs); if (!gh) hwGroups = hwGroups.filter(g => g.pages.length); }   // 大学院文科：没有图片的份也要带批复文字
    const prog = gh ? await mrMonthProgress(stu, ym0) : null;
    const wt = mrWorksTitle(stu), hrl = mrHrLabel(stu), esc = mrEsc;
    const ym = ym0.replace('-', '年') + '月';
    const dom = tsmDomainOf(stu.major);
    const stuLine = esc(stu.name) + (gh ? ((MAJORS[stu.major] || stu.major) ? ' · ' + esc(MAJORS[stu.major] || stu.major) : '') : (stu.faculty ? ' · ' + esc(stu.faculty) : ''));
    const statCells = [[st.held + ' / ' + st.total, '已上课次 / 共（回）'], [st.actual, '出勤（出席+迟到，次）'], [st.rate == null ? '—' : st.rate + '%', '出勤率'], [st.leave, '请假'], [st.absent, '缺席']];
    if (!gh || st.hwAssigned > 0) statCells.push([st.hwDone + ' / ' + st.hwAssigned, `作业（已交 / 已布置，共 ${st.hwTotal} 次）`]);
    const courseRow = c => `<div style="font-size:13px;padding:5px 0;border-bottom:1px solid #ede9e2"><b>${esc(c.name)}</b>${c.mode === 'elective' ? '（选修）' : ''} · 出席 ${c.st.actual} / 已上 ${c.st.held}（共 ${c.st.total}）${(!gh || c.st.hwAssigned > 0) ? ` · 作业 ${c.st.hwDone} / ${c.st.hwAssigned}` : ''}</div>`;
    let hwHtml = '';
    if (hwGroups) {
      if (gh) hwHtml = hwGroups.length ? `<div class="sec-label">${wt}（共 ${hwGroups.length} 份）</div>${hwGroups.map(g => `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #ede9e2;page-break-inside:avoid;break-inside:avoid">
          <div style="flex:none;width:84px">${g.pages[0] ? `<img src="${esc(g.pages[0].thumb || g.pages[0].url)}" style="width:84px;height:84px;object-fit:cover;border:1px solid #e2ded6;border-radius:4px">` : `<div style="width:84px;height:84px;border:1px solid #e2ded6;border-radius:4px;font-size:11px;color:#9a9590;display:flex;align-items:center;justify-content:center">文件</div>`}</div>
          <div style="flex:1;min-width:0"><div style="font-size:12px;color:#5a5650">${esc([g.course, g.no ? '第' + g.no + '回' : '', mrMD(g.date)].filter(Boolean).join(' · '))}${g.pages.length ? ` · 共 ${g.pages.length} 页` : ''}</div>${mrFeedbackHtml(g, 12)}</div></div>`).join('')}` : '';
      else hwHtml = hwGroups.length ? `<div class="sec-label">${wt}（共 ${hwGroups.length} 份）</div><div class="works">${hwGroups.slice(0, 9).map(g => `<div style="text-align:center"><img src="${g.pages[0].thumb || g.pages[0].url}"><div style="font-size:10px;color:#9a9590;margin-top:2px">${esc([g.course, (g.date || '').slice(5)].filter(Boolean).join(' · '))} · 共 ${g.pages.length} 页</div></div>`).join('')}</div>` : '';
    } else if (works.length) hwHtml = `<div class="sec-label">${wt}（部分）</div><div class="works">${works.slice(0, 9).map(x => `<img src="${x.url}">`).join('')}</div>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&family=Noto+Sans+SC:wght@400;500&display=swap" rel="stylesheet"><title>${esc(stu.name)} ${ym} 学习情况</title>
  <style>
    @page{size:A4;margin:16mm}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Noto Sans SC',system-ui,sans-serif;color:#2b2822;background:#fff;line-height:1.7}
    .wrap{max-width:760px;margin:0 auto}
    .head{text-align:center;padding:18px 0 14px;border-bottom:2px solid #b8953a;margin-bottom:20px}
    .head .sub{font-size:12px;color:#9a9590;letter-spacing:.15em;margin-bottom:6px}
    .head h1{font-family:'Noto Serif SC',serif;font-size:28px;font-weight:700;letter-spacing:.05em;color:#1a1814}
    .head .stu{font-size:14px;color:#5a5650;margin-top:6px}
    .sec-label{font-family:'Noto Serif SC',serif;font-size:13px;letter-spacing:.05em;color:#b8953a;margin:18px 0 8px;font-weight:600}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:8px}
    .stat{background:#f7f5f0;border:1px solid #ede9e2;border-radius:8px;padding:12px;text-align:center}
    .stat .n{font-family:'Noto Serif SC',serif;font-size:30px;font-weight:600;color:#b8953a;line-height:1}
    .stat .l{font-size:11px;color:#9a9590;margin-top:3px}
    .works{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .works img{width:100%;height:130px;object-fit:cover;border:1px solid #e2ded6;border-radius:6px}
    .review{background:#f7f5f0;border:1px solid #ede9e2;border-radius:8px;padding:14px 16px;margin-bottom:10px}
    .review .c{font-size:13px;line-height:1.9;color:#3a352e;white-space:pre-wrap}
    .review .by{font-size:11px;color:#9a9590;text-align:right;margin-top:8px}
    .foot{text-align:center;font-size:11px;color:#9a9590;margin-top:24px;padding-top:12px;border-top:1px solid #e2ded6}
  </style></head><body><div class="wrap">
    <div class="head">
      <div class="sub">唯新教育${dom ? ' · ' + esc(dom) : ''}</div>
      <h1>${esc(ym)} 学习情况</h1>
      <div class="stu">${stuLine}</div>
    </div>
    <div class="sec-label">出勤情况</div>
    <div class="stats">${statCells.map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('')}</div>
    ${st.byCourse.length ? `<div class="sec-label">本月课程</div>${st.byCourse.map(courseRow).join('')}` : ''}
    ${gh ? `<div class="sec-label">本月进展</div>${mrProgressHtml(prog, 13)}` : ''}
    ${hwHtml}
    <div class="sec-label">专业老师评价</div>
    <div class="review"><div class="c">${rev.teacher_review ? esc(rev.teacher_review) : '—'}</div>${rev.teacher_review_by ? `<div class="by">— ${esc(rev.teacher_review_by)} 老师</div>` : ''}</div>
    <div class="sec-label">${hrl}评价</div>
    <div class="review"><div class="c">${rev.homeroom_review ? esc(rev.homeroom_review) : '—'}</div>${rev.homeroom_review_by ? `<div class="by">— ${esc(rev.homeroom_review_by)} 老师</div>` : ''}</div>
    <div class="foot">唯新教育　Unique New Education　·　${esc(ym)}</div>
  </div>
  <script>window.onload=function(){ if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){setTimeout(function(){window.print()},400)})}else{setTimeout(function(){window.print()},1200)} }<\/script>
  </body></html>`;
    w.document.write(html); w.document.close();
  } catch (e) {
    try { w.close(); } catch (e2) { /* ignore */ }
    alert('生成PDF失败：' + ((e && e.message) || e));
  }
}
