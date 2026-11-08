// ══════════════════════════════════
// teacher-homework.js — 作业批改（需 homework 权限）
// 学生逐题提交（文字 / 按题号照片）→ 老师端按题号整合成一页：题目 + 文字答案 + 顺序排列的照片
// 可打印保存 PDF 后手写批注，或直接在页面填写反馈（支持上传批改后的 Word）
// 依赖：shared/constants.js、shared/supabase.js、teacher.js（须在其后加载）
// ══════════════════════════════════
let thwSessions = null;   // 有作业的课次
let thwSubs = {};         // session_id → 提交数组
let thwOpenSession = null;
let thwOpenStudent = null;
let thwShowPast = false, thwShowDone = false;   // 左栏「以前·未批改」「已批完的以前作业」是否展开
let thwLimit = { todo: LIST_PAGE, done: LIST_PAGE };   // 左栏「以前」两个展开列表先显示的条数
function thwLimited(list, key, itemFn) {
  const n = thwLimit[key] || LIST_PAGE;
  return list.slice(0, n).map(itemFn).join('') + (list.length > n ? `<div onclick="thwLimit['${key}']=${n}+LIST_PAGE;thwRender()" style="cursor:pointer;text-align:center;padding:7px;font-size:11px;color:var(--accent)">加载更多（还有 ${list.length - n} 项）</div>` : '');
}
// 学部美术「作品收集」：分配给我的美术课（②），或我担当的美术课（①），按周批改 art_works
let thwArt = [];          // [{course, weeks:[{start,label,works}], showPast, showDone}]
let thwArtWorks = {};     // art_works.id → 作品（shared/artworks.js 的 awFind 会先从这里找）
let thwOpenArt = null;    // {cid, week}
let thwArtOpenWork = null;
let thwNoQ = [];          // 设置了布置作业、但还没出题的课（非美术），只提示不报错


// 时间统一按日本时间（JST）显示
function fmtJst(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d)) return String(ts).slice(0, 16).replace('T', ' ');
    return d.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16);
  } catch (e) { return String(ts).slice(0, 16).replace('T', ' '); }
}


// 可见范围 = ①（homework_own_sessions）本人担当的单回 ∪ ②（homework_course_ids）负责课程的全部单回；admin 老师管理里分配
let thwKind = 'hw';        // 'hw' 作业 / 'ic' 随堂作业
let thwIc = { sessions: [], subs: {}, req: {} };   // 随堂作业：课次、session_id → 提交、session_id → 必修人数
let thwIcOpen = null, thwIcStu = null;
let thwAssigned = true;   // 是否有任何分配（没有时显示「还没有给你安排作业批改」）
async function renderHomeworkFeedback(mc) {
  const p = teacherData.permissions || {};
  const own = !!p.homework_own_sessions && !!(teacherName || '').trim();
  const courseIds = (p.homework_course_ids || []).map(String).filter(Boolean);
  thwAssigned = own || courseIds.length > 0;
  mc.innerHTML = '<div class="empty">加载中…</div>';
  if (!thwAssigned) { thwSessions = []; thwSubs = {}; thwArt = []; thwNoQ = []; thwRender(); return; }
  try {
    const nm = teacherName.trim();
    const base = '/rest/v1/course_sessions?homework_enabled=is.true&homework_questions=not.is.null&select=*&order=session_date.desc';
    const jobs = [];
    // ① 本人担当的单回（session_teacher / teacher 含老师名；只到单回，不带出同一课里别人的回次）
    if (own) {
      const enc = encodeURIComponent(nm);
      jobs.push(sbAll(`${base}&or=(session_teacher.ilike.*${enc}*,teacher.ilike.*${enc}*)`).then(r =>
        (r || []).filter(x => String(x.session_teacher || '').includes(nm) || String(x.teacher || '').includes(nm))));
    }
    // ② 负责课程的全部单回
    for (let i = 0; i < courseIds.length; i += 40) {
      jobs.push(sbAll(`${base}&course_id=in.(${courseIds.slice(i, i + 40).map(x => `"${x}"`).join(',')})`));
    }
    const sessions = [].concat(...await Promise.all(jobs));
    // 只显示「当期」的作业课次（shared/constants.js 的 inCurrentPeriod；下一期及以后不显示）
    const inCurrentTerm = s => inCurrentPeriod(s.session_date);
    const seen = new Set();
    thwSessions = sessions.filter(s => {
      if (seen.has(s.id)) return false; seen.add(s.id);
      const q = s.homework_questions;
      const hasHw = Array.isArray(q) ? q.length : !!(q && q.levels && q.levels.length);
      return hasHw && inCurrentTerm(s);
    }).sort((a, b) => String(b.session_date || '').localeCompare(String(a.session_date || '')));
    const ids = thwSessions.map(s => s.id);
    thwSubs = {};
    for (let i = 0; i < ids.length; i += 40) {
      const batch = await sb(`/rest/v1/homework_submissions?session_id=in.(${ids.slice(i,i+40).map(x=>`"${x}"`).join(',')})&select=*&order=submitted_at.asc`).catch(() => []);
      (batch || []).forEach(x => { (thwSubs[x.session_id] = thwSubs[x.session_id] || []).push(x); });
    }
    await thwArtLoad(own, nm, courseIds, sessions);
    await thwIcLoad(own, nm, courseIds);
  } catch (e) { mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }
  thwRender();
}

function thwRender() {
  const mc = document.getElementById('mainContent');
  if (!mc) return;
  if (!thwAssigned) {
    mc.innerHTML = '<div class="empty">还没有给你安排作业批改，请联系教务</div>';
    return;
  }
  if (thwKind === 'ic') { thwIcRender(mc); return; }
  if (!thwSessions.length && !thwArt.length && !thwNoQ.length) {
    mc.innerHTML = thwKindChips() + '<div class="empty">当期暂无分配给你的作业课次<br><span style="font-size:11px">作业由教务在课程安排的单回中布置</span></div>';
    return;
  }
  // 按周分块：本周（展开）/ 以前·未批改（有才显示，醒目）/ 提前提交（未来单回有人提前交才显示）
  const wk = weekRange();
  const ungradedOf = s => (thwSubs[s.id] || []).filter(x => !hwFeedbacks(x).length).length;
  const byDate = (a, b) => String(a.session_date || '').localeCompare(String(b.session_date || ''));
  const cur = thwSessions.filter(s => s.session_date >= wk.start && s.session_date <= wk.end).sort(byDate);
  const past = thwSessions.filter(s => s.session_date < wk.start).sort((a, b) => byDate(b, a));
  const pastTodo = past.filter(s => ungradedOf(s) > 0), pastDone = past.filter(s => !ungradedOf(s));
  const early = thwSessions.filter(s => s.session_date > wk.end && (thwSubs[s.id] || []).length).sort(byDate);
  const pastN = pastTodo.reduce((n, s) => n + ungradedOf(s), 0);
  if (thwOpenSession && pastTodo.some(s => s.id === thwOpenSession)) thwShowPast = true;
  if (thwOpenSession && pastDone.some(s => s.id === thwOpenSession)) thwShowDone = true;
  const item = s => {
    const subs = thwSubs[s.id] || [];
    const ungraded = ungradedOf(s);
    const sel = thwOpenSession === s.id;
    return `<div onclick="thwOpenSession='${s.id}';thwOpenArt=null;thwOpenStudent=null;thwRender()" style="cursor:pointer;padding:7px 10px;border:1px solid ${sel?'var(--accent)':'transparent'};background:${sel?'var(--accent-light,#f5ede3)':'transparent'};border-radius:3px;margin-bottom:3px">
      <div style="font-size:12px;font-weight:600">${thwEsc(s.course_name||'')}${s.session_number?` 第${s.session_number}回`:''}</div>
      <div style="font-size:9px;color:var(--text-3)">${s.session_date||''} · 提交 ${subs.length}${ungraded?` · <span style="color:var(--warn,#b8860b)">待批 ${ungraded}</span>`:subs.length?' · <span style="color:var(--ok)">已批完</span>':''}</div>
    </div>`;
  };
  const sec = t => `<div style="font-size:11px;font-weight:600;color:var(--text-2);padding:6px 4px 4px">${t}</div>`;
  mc.innerHTML = `
  <div class="page-header"><div class="section-title">📝 作业批改</div></div>
  ${thwKindChips()}
  <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
    <div style="flex:0 0 250px;min-width:220px;max-height:74vh;overflow-y:auto;background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:8px">
      ${thwSessions.length || !thwArt.length ? `${sec(`本周 <span style="font-weight:400;color:var(--text-3)">${wk.label}</span>`)}
      ${cur.length ? cur.map(item).join('') : '<div style="font-size:10px;color:var(--text-3);padding:2px 10px 6px">本周没有分配给你的作业</div>'}` : ''}
      ${pastTodo.length ? `<div onclick="thwShowPast=!thwShowPast;thwRender()" style="cursor:pointer;margin:8px 0 4px;padding:7px 10px;border-radius:3px;background:#fdf1e6;border:1px solid #e8c9a8;color:#a0521a;font-size:11px;font-weight:600">⚠ 以前的作业还有 ${pastN} 份未批改 <span style="float:right;font-weight:400">${thwShowPast?'▾':'▸'}</span></div>${thwShowPast ? thwLimited(pastTodo, 'todo', item) : ''}` : ''}
      ${early.length ? sec('提前提交') + early.map(item).join('') : ''}
      ${pastDone.length ? `<div onclick="thwShowDone=!thwShowDone;thwRender()" style="cursor:pointer;font-size:10px;color:var(--text-3);padding:8px 4px 2px;text-decoration:underline">${thwShowDone?'收起':'查看'}已批完的以前作业（${pastDone.length}）</div>${thwShowDone ? thwLimited(pastDone, 'done', item) : ''}` : ''}
      ${thwArt.map(thwArtBlockHtml).join('')}
      ${thwNoQ.length ? `<div style="font-size:10px;color:var(--text-3);padding:8px 4px 2px;line-height:1.7">尚未出题：${thwNoQ.map(c => thwEsc(c.name)).join('、')}</div>` : ''}
    </div>
    <div style="flex:1 1 460px;min-width:0" id="thw_main">${thwMainHtml()}</div>
  </div>`;
}

function thwMainHtml() {
  if (thwOpenArt) return thwArtMainHtml();
  if (!thwOpenSession) return '<div style="text-align:center;padding:60px 20px;color:var(--text-3);font-size:12px;border:1px dashed var(--border);border-radius:4px">← 从左侧选择课次</div>';
  const s = thwSessions.find(x => x.id === thwOpenSession);
  const subs = thwSubs[thwOpenSession] || [];
  if (!subs.length) return `<div style="text-align:center;padding:50px 20px;color:var(--text-3);font-size:12px;border:1px dashed var(--border);border-radius:4px">${thwEsc(s.course_name||'')} 第${s.session_number||''}回<br>暂无学生提交</div>`;

  if (!thwOpenStudent) {
    return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:12px 14px">
      <div style="font-size:12px;font-weight:600;margin-bottom:2px">${thwEsc(s.course_name||'')} 第${s.session_number||''}回</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">${s.session_date||''}${s.session_title?' · '+thwEsc(s.session_title):''} · 共 ${subs.length} 份提交</div>
      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
        <button onclick="thwExportWordAll()" style="font-size:11px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">⬇ 全部导出 Word（可批注）</button>
        <button onclick="thwPrintAll()" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">🖨 打印 / 存为 PDF</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${subs.map(x => `<div onclick="thwOpenStudent='${x.id}';thwPendingFile=null;thwRenderMain()" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-light);border-radius:3px">
          <span style="font-size:12px;font-weight:600">${thwEsc(x.student_name)}</span>
          <span style="font-size:9px;color:var(--text-3)">${fmtJst(x.submitted_at)}</span>
          <span style="font-size:9px;color:var(--text-3)">${x.level?`【${thwEsc(x.level)}】`:''}${(x.answers||[]).filter(a=>a.text||(a.images||[]).length).length} 处作答${x.whole_file_url?' · 📎附件':''}</span>
          <span style="margin-left:auto;font-size:10px;color:${hwFeedbacks(x).length?'var(--ok)':'var(--warn,#b8860b)'}">${hwFeedbacks(x).length?'✓ '+thwEsc(hwGradedBy(x).join('、')||'已批改'):'待批改'}</span>
        </div>`).join('')}
      </div>
    </div>`;
  }

  const sub = subs.find(x => x.id === thwOpenStudent);
  if (!sub) return '';
  return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px 16px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <span onclick="thwOpenStudent=null;thwRenderMain()" style="font-size:11px;color:var(--accent);cursor:pointer">← 返回列表</span>
      <span style="font-size:13px;font-weight:600">${thwEsc(sub.student_name)}</span>
      <span style="font-size:10px;color:var(--text-3)">${thwEsc(s.course_name||'')} 第${s.session_number||''}回 · ${fmtJst(sub.submitted_at)}</span>
      <span style="margin-left:auto;display:flex;gap:5px">
        <button onclick="thwExportWord('${sub.id}')" style="font-size:10px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">⬇ 导出 Word</button>
        <button onclick="thwPrintOne('${sub.id}')" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">🖨 打印 / PDF</button>
      </span>
    </div>
    <div style="border:1px solid var(--border-light);border-radius:3px;padding:12px;background:var(--bg);max-height:52vh;overflow-y:auto">
      ${thwPaperHtml(s, sub, false)}
    </div>
    ${hwrFeedbackBlockHtml(sub)}
  </div>`;
}

// ══════════════════════════════════
// 学部美术：🎨 作品收集（art_works；成员 = 课程成员规则 courseMemberIds：班级 / 名单）
// ══════════════════════════════════
async function thwArtLoad(own, nm, courseIds, hwSessions) {
  thwArt = []; thwNoQ = []; thwArtWorks = {};
  const inList = ids => ids.map(x => `"${x}"`).join(',');
  const byIds = async ids => {
    const out = [];
    for (let i = 0; i < ids.length; i += 40) out.push(...(await sb(`/rest/v1/courses?id=in.(${inList(ids.slice(i, i + 40))})&select=*`).catch(() => []) || []));
    return out;
  };
  const assigned = await byIds(courseIds);
  // ②里设置了布置作业、但还没有任何单回出题的非美术课（当期）：只提示「尚未出题」
  const hasQ = new Set((hwSessions || []).map(x => String(x.course_id)));
  thwNoQ = assigned.filter(c => !isGakubuArtCourse(c) && c.homework_enabled === true && !hasQ.has(String(c.id)) && courseInCurrentPeriod(c));
  const art = {};
  assigned.filter(isGakubuArtCourse).forEach(c => { art[c.id] = c; });
  // ① 我担当的美术课（课程老师 或 单回担当老师），且设置了布置作业
  if (own) {
    const enc = encodeURIComponent(nm);
    const [crs, ss] = await Promise.all([
      sbAll(`/rest/v1/courses?teacher=ilike.*${enc}*&select=*`).catch(() => []),
      sbAll(`/rest/v1/course_sessions?or=(session_teacher.ilike.*${enc}*,teacher.ilike.*${enc}*)&select=course_id,session_teacher,teacher`).catch(() => []),
    ]);
    const mine = (crs || []).filter(c => String(c.teacher || '').includes(nm));
    const sIds = [...new Set((ss || []).filter(x => String(x.session_teacher || '').includes(nm) || String(x.teacher || '').includes(nm)).map(x => String(x.course_id)).filter(Boolean))];
    const have = new Set(mine.map(c => String(c.id)));
    const more = await byIds(sIds.filter(id => !have.has(id) && !art[id]));
    mine.concat(more).filter(c => isGakubuArtCourse(c) && c.homework_enabled === true).forEach(c => { art[c.id] = art[c.id] || c; });
  }
  let courses = Object.values(art);
  if (!courses.length) return;
  // 每门课的上课范围（单回首尾；没有单回用开课日 / 结课日）
  const ids = courses.map(c => String(c.id));
  const sess = [];
  for (let i = 0; i < ids.length; i += 40) sess.push(...(await sbAll(`/rest/v1/course_sessions?course_id=in.(${inList(ids.slice(i, i + 40))})&select=course_id,session_date,is_cancelled`).catch(() => []) || []));
  const range = {};
  sess.filter(x => !x.is_cancelled && x.session_date).forEach(x => {
    const r = range[x.course_id] = range[x.course_id] || { s: x.session_date, e: x.session_date };
    if (x.session_date < r.s) r.s = x.session_date; if (x.session_date > r.e) r.e = x.session_date;
  });
  const wk = weekRange();
  const cutoff = weekRange(new Date(Date.now() - 91 * 864e5)).start;   // 只看最近约三个月内还在上的课
  courses = courses.map(c => {
    const r = range[c.id] || {}, s0 = r.s || c.start_date || c.first_session_date || '', e0 = r.e || c.end_date || s0;
    return { c, s: s0, e: e0 };
  }).filter(x => x.s && x.s <= wk.end && x.e >= cutoff);
  if (!courses.length) return;
  const [students, cms] = await Promise.all([
    sbAll('/rest/v1/students?select=*&status=eq.active&order=name.asc').catch(() => []),
    sbAll(`/rest/v1/course_members?course_id=in.(${inList(courses.map(x => String(x.c.id)))})&select=course_id,student_id,kind`).catch(() => []),
  ]);
  const members = {}, allIds = new Set();
  courses.forEach(x => {
    const m = courseMemberIds(x.c, students || [], (cms || []).filter(r => String(r.course_id) === String(x.c.id)));
    members[x.c.id] = m; m.forEach(id => allIds.add(id));
  });
  const from = courses.reduce((a, x) => { const st = weekRange(x.s).start; return !a || st < a ? st : a; }, '');
  const sids = [...allIds], works = [];
  for (let i = 0; i < sids.length; i += 40) {
    works.push(...(await sb(`/rest/v1/art_works?student_id=in.(${inList(sids.slice(i, i + 40))})&week_start=gte.${from}&week_start=lte.${wk.start}&select=*&order=created_at.desc`).catch(() => []) || []));
  }
  works.forEach(w => { thwArtWorks[w.id] = w; });
  thwArt = courses.sort((a, b) => b.s.localeCompare(a.s)).map(x => {
    const weeks = [], last = weekRange(x.e).start < wk.start ? weekRange(x.e).start : wk.start;
    for (let st = weekRange(x.s).start, g = 0; st <= last && g < 60; st = awShiftWeek(st, 1).start, g++) {
      const w = weekRange(st);
      weeks.push({ start: w.start, label: w.label, works: works.filter(a => a.week_start === w.start && members[x.c.id].has(String(a.student_id))) });
    }
    return { course: x.c, weeks, showPast: false, showDone: false, n: members[x.c.id].size };
  });
}
function thwArtUngraded(w) { return w.works.filter(x => !hwFeedbacks(x).length).length; }
function thwArtBlockHtml(a) {
  const wk = weekRange(), cid = thwEsc(a.course.id);
  const cur = a.weeks.find(w => w.start === wk.start);
  const past = a.weeks.filter(w => w.start < wk.start).reverse();
  const todo = past.filter(w => thwArtUngraded(w) > 0), done = past.filter(w => !thwArtUngraded(w));
  const openHere = thwOpenArt && String(thwOpenArt.cid) === String(a.course.id);
  if (openHere && todo.some(w => w.start === thwOpenArt.week)) a.showPast = true;
  if (openHere && done.some(w => w.start === thwOpenArt.week)) a.showDone = true;
  const item = w => {
    const sel = openHere && thwOpenArt.week === w.start, un = thwArtUngraded(w);
    return `<div onclick="thwOpenArt={cid:'${cid}',week:'${w.start}'};thwOpenSession=null;thwArtOpenWork=null;thwRender()" style="cursor:pointer;padding:7px 10px;border:1px solid ${sel ? 'var(--accent)' : 'transparent'};background:${sel ? 'var(--accent-light,#f5ede3)' : 'transparent'};border-radius:3px;margin-bottom:3px">
      <div style="font-size:12px;font-weight:600">${w.start === wk.start ? '本周 · ' : ''}${w.label}</div>
      <div style="font-size:9px;color:var(--text-3)">作品 ${w.works.length}${un ? ` · <span style="color:var(--warn,#b8860b)">待评价 ${un}</span>` : w.works.length ? ' · <span style="color:var(--ok)">已评完</span>' : ''}</div>
    </div>`;
  };
  const idx = thwArt.indexOf(a), todoN = todo.reduce((n, w) => n + thwArtUngraded(w), 0);
  return `<div style="border-top:1px solid var(--border-light);margin-top:8px;padding-top:4px">
    <div style="font-size:11px;font-weight:600;color:var(--text-2);padding:6px 4px 4px">🎨 作品收集 · ${thwEsc(a.course.name || '')}</div>
    ${cur ? item(cur) : '<div style="font-size:10px;color:var(--text-3);padding:2px 10px 6px">本周不在这门课的上课期间</div>'}
    ${todo.length ? `<div onclick="thwArt[${idx}].showPast=!thwArt[${idx}].showPast;thwRender()" style="cursor:pointer;margin:6px 0 4px;padding:7px 10px;border-radius:3px;background:#fdf1e6;border:1px solid #e8c9a8;color:#a0521a;font-size:11px;font-weight:600">⚠ 以前还有 ${todoN} 份作品未评价 <span style="float:right;font-weight:400">${a.showPast ? '▾' : '▸'}</span></div>${a.showPast ? todo.map(item).join('') : ''}` : ''}
    ${done.length ? `<div onclick="thwArt[${idx}].showDone=!thwArt[${idx}].showDone;thwRender()" style="cursor:pointer;font-size:10px;color:var(--text-3);padding:6px 4px 2px;text-decoration:underline">${a.showDone ? '收起' : '查看'}以前的周（${done.length}）</div>${a.showDone ? done.map(item).join('') : ''}` : ''}
  </div>`;
}
function thwArtMainHtml() {
  const a = thwArt.find(x => String(x.course.id) === String(thwOpenArt.cid));
  const w = a && a.weeks.find(x => x.start === thwOpenArt.week);
  if (!w) return '<div style="text-align:center;padding:60px 20px;color:var(--text-3);font-size:12px;border:1px dashed var(--border);border-radius:4px">← 从左侧选择</div>';
  const list = w.works.filter(x => thwArtWorks[x.id]);
  return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:12px 14px">
    <div style="font-size:12px;font-weight:600;margin-bottom:2px">🎨 作品收集 · ${thwEsc(a.course.name || '')}</div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">${w.label} · 成员 ${a.n} 人 · 已收集 ${list.length} 份</div>
    ${list.length ? list.map(x => {
      const imgs = awImgs(x), fbs = hwFeedbacks(x), open = thwArtOpenWork === x.id;
      return `<div style="border:1px solid ${open ? 'var(--accent,#b8953a)' : 'var(--border-light)'};border-radius:5px;padding:7px 9px;margin-bottom:6px">
        <div onclick="thwArtOpenWork=${open ? 'null' : `'${thwEsc(x.id)}'`};thwRenderMain()" style="display:flex;align-items:center;gap:8px;cursor:pointer;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:600">${thwEsc(x.student_name)}</span>
          <span style="font-size:10px;color:var(--text-3)">${imgs.length} 张 · ${x.source === 'student' ? '学生上传' : '老师上传' + (x.uploaded_by ? '（' + thwEsc(x.uploaded_by) + '）' : '')}</span>
          ${fbs.length ? `<span style="font-size:10px;color:var(--ok,#2a9e6a)">✓ ${thwEsc([...new Set(fbs.map(f => f.by))].join('、'))}</span>` : '<span style="font-size:10px;color:var(--warn,#b8860b)">待评价</span>'}
          <span style="margin-left:auto;display:flex;gap:3px">${imgs.slice(0, 4).map(im => `<img src="${thwEsc(im.url)}" loading="lazy" style="width:34px;height:34px;object-fit:cover;border-radius:3px">`).join('')}</span>
        </div>
        ${open ? awTDetailHtml(x) : ''}
      </div>`;
    }).join('') : '<div style="font-size:11px;color:var(--text-3);padding:20px;text-align:center">这周还没有收集到作品<br><span style="font-size:10px">拍照上传在「出席·作业」的「🎨 作业收集」</span></div>'}
  </div>`;
}
// shared/artworks.js 保存评价 / 追加照片 / 删除后回调：只在作业批改页打开时重画
function thwArtRerender() { if (document.getElementById('thw_main') && thwOpenArt) thwRender(); }
function thwArtDrop(id) {
  delete thwArtWorks[id];
  thwArt.forEach(a => a.weeks.forEach(w => { w.works = w.works.filter(x => x.id !== id); }));
}

function thwRenderMain() {
  const box = document.getElementById('thw_main');
  if (box) box.innerHTML = thwMainHtml();
}

// 照片旋转 / 缩放 / 放大查看 / 整合答卷（thwPaperHtml）/ 批改保存 / 上传批改文件 / 随堂批改保存，已挪到 shared/homework-review.js，老师端和管理端共用

function thwOpenPrintWindow(title, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) { alert('浏览器拦截了新窗口，请允许弹出后重试'); return; }
  w.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title>
<style>
  body{font-family:'Noto Serif SC','Hiragino Sans GB','Microsoft YaHei',serif;background:#fff;margin:0;padding:24px;color:#1a1814}
  @media print{.noprint{display:none!important}body{padding:0}}
  .paper{max-width:820px;margin:0 auto 40px}
</style></head><body>
<div class="noprint" style="text-align:right;margin-bottom:12px"><button onclick="window.print()" style="font-size:13px;padding:8px 20px;cursor:pointer">🖨 打印 / 保存为 PDF</button></div>
${bodyHtml}
</body></html>`);
  w.document.close();
}

function thwPrintOne(subId) {
  const s = thwSessions.find(x => x.id === thwOpenSession);
  const sub = (thwSubs[thwOpenSession] || []).find(x => x.id === subId);
  if (!s || !sub) return;
  thwOpenPrintWindow(`${sub.student_name}_${s.course_name}_第${s.session_number||''}回作业`,
    `<div class="paper">${thwPaperHtml(s, sub, true)}</div>`);
}

function thwPrintAll() {
  const s = thwSessions.find(x => x.id === thwOpenSession);
  const subs = thwSubs[thwOpenSession] || [];
  if (!s || !subs.length) return;
  thwOpenPrintWindow(`${s.course_name}_第${s.session_number||''}回_全部作业`,
    subs.map(sub => `<div class="paper" style="page-break-after:always">${thwPaperHtml(s, sub, true)}</div>`).join(''));
}

// ══════════════════════════════════
// 随堂作业批改（表 inclass_submissions；课次范围与作业完全相同：自己上的课 / 指定课程）
// 课次 = 开关开着的，或已经有人提交的
// ══════════════════════════════════
function thwKindChips() {
  const c = (k, l) => `<div class="filter-chip${thwKind === k ? ' active' : ''}" onclick="thwKind='${k}';thwRender()">${l}</div>`;
  return `<div style="display:flex;gap:6px;margin-bottom:12px">${c('hw', '作业')}${c('ic', '随堂作业')}</div>`;
}
async function thwIcLoad(own, nm, courseIds) {
  thwIc = { sessions: [], subs: {}, req: {} };
  try {
    const from = new Date(); from.setDate(from.getDate() - 100);
    const f = from.toISOString().slice(0, 10);
    const ownOk = s => (own && (String(s.session_teacher || '').includes(nm) || String(s.teacher || '').includes(nm))) || courseIds.includes(String(s.course_id));
    // ① 开关开着的课次
    const base = `/rest/v1/course_sessions?inclass_enabled=is.true&session_date=gte.${f}&select=*&order=session_date.desc`;
    const jobs = [];
    if (own) { const enc = encodeURIComponent(nm); jobs.push(sbAll(`${base}&or=(session_teacher.ilike.*${enc}*,teacher.ilike.*${enc}*)`)); }
    for (let i = 0; i < courseIds.length; i += 40) jobs.push(sbAll(`${base}&course_id=in.(${courseIds.slice(i, i + 40).map(x => `"${x}"`).join(',')})`));
    let sessions = [].concat(...await Promise.all(jobs));
    // ② 有提交的课次（开关已关也照常批改）
    const subRows = await sbAll(`/rest/v1/inclass_submissions?session_date=gte.${f}&select=*&order=submitted_at.asc`);
    const have = new Set(sessions.map(x => String(x.id)));
    const extra = [...new Set(subRows.map(x => String(x.session_id)))].filter(id => !have.has(id));
    for (let i = 0; i < extra.length; i += 40) {
      const arr = await sb(`/rest/v1/course_sessions?id=in.(${extra.slice(i, i + 40).map(x => `"${x}"`).join(',')})&select=*`).catch(() => []);
      sessions = sessions.concat((arr || []).filter(ownOk));
    }
    const seen = new Set();
    thwIc.sessions = sessions.filter(x => ownOk(x) && !seen.has(x.id) && seen.add(x.id));
    const ids = new Set(thwIc.sessions.map(x => String(x.id)));
    subRows.filter(x => ids.has(String(x.session_id))).forEach(x => { (thwIc.subs[x.session_id] = thwIc.subs[x.session_id] || []).push(x); });
    // 必修人数
    const cids = [...new Set(thwIc.sessions.map(x => x.course_id).filter(Boolean))];
    if (cids.length) {
      const q = cids.map(x => `"${x}"`).join(',');
      const [stu, crs, cms] = await Promise.all([
        sbAll('/rest/v1/students?select=*&status=eq.active').catch(() => []),
        sbAll(`/rest/v1/courses?id=in.(${q})&select=*`).catch(() => []),
        sbAll(`/rest/v1/course_members?course_id=in.(${q})&select=course_id,student_id,kind`).catch(() => []),
      ]);
      thwIc.sessions.forEach(se => {
        const c = (crs || []).find(x => String(x.id) === String(se.course_id)) || {};
        const mj = Array.isArray(se.major) ? se.major : (se.major ? [se.major] : []);
        const course = Object.assign({ id: se.course_id }, c, { major: mj.length ? mj : (c.major || []) });
        const rid = courseRequiredIds(course, stu || [], (cms || []).filter(m => String(m.course_id) === String(se.course_id)));
        thwIc.req[se.id] = (stu || []).filter(x => rid.has(String(x.id)) && sessionCountsFor(x, se.session_date)).length;
      });
    }
  } catch (e) { /* 表还没建：随堂作业页显示为空 */ }
}
function thwIcUngraded(sid) { return (thwIc.subs[sid] || []).filter(x => !hwFeedbacks(x).length).length; }
function thwIcRender(mc) {
  const list = thwIc.sessions.slice().sort((a, b) => (thwIcUngraded(b.id) > 0) - (thwIcUngraded(a.id) > 0) || String(b.session_date || '').localeCompare(String(a.session_date || '')));
  const item = s => {
    const n = (thwIc.subs[s.id] || []).length, u = thwIcUngraded(s.id), sel = thwIcOpen === s.id;
    return `<div onclick="thwIcOpen='${s.id}';thwIcStu=null;thwRender()" style="cursor:pointer;padding:7px 10px;border:1px solid ${sel ? 'var(--accent)' : 'transparent'};background:${sel ? 'var(--accent-light,#f5ede3)' : 'transparent'};border-radius:3px;margin-bottom:3px">
      <div style="font-size:12px;font-weight:600">${thwEsc(s.course_name || '')}${s.session_number ? ` 第${s.session_number}回` : ''}</div>
      <div style="font-size:9px;color:var(--text-3)">${s.session_date || ''} · 已交 ${n} / 必修 ${thwIc.req[s.id] == null ? '—' : thwIc.req[s.id]}${u ? ` · <span style="color:var(--warn,#b8860b)">待批 ${u}</span>` : n ? ' · <span style="color:var(--ok)">已批完</span>' : ''}${s.inclass_enabled ? '' : ' · 已关闭'}</div>
    </div>`;
  };
  mc.innerHTML = `<div class="page-header"><div class="section-title">📝 作业批改</div></div>
  ${thwKindChips()}
  ${list.length ? `<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
    <div style="flex:0 0 250px;min-width:220px;max-height:74vh;overflow-y:auto;background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:8px">${list.map(item).join('')}</div>
    <div style="flex:1 1 460px;min-width:0" id="thw_main">${thwIcMainHtml()}</div></div>`
    : '<div class="empty">暂无随堂作业<br><span style="font-size:11px">老师在出席・作业页的单回上打开「随堂作业」后，学生提交的内容会出现在这里</span></div>'}`;
}
function thwIcMain() { const b = document.getElementById('thw_main'); if (b) b.innerHTML = thwIcMainHtml(); }
function thwIcMainHtml() {
  const s = thwIc.sessions.find(x => x.id === thwIcOpen);
  if (!s) return '<div style="text-align:center;padding:60px 20px;color:var(--text-3);font-size:12px;border:1px dashed var(--border);border-radius:4px">← 从左侧选择课次</div>';
  const subs = thwIc.subs[s.id] || [];
  const title = `${thwEsc(s.course_name || '')}${s.session_number ? ` 第${s.session_number}回` : ''}`;
  if (!thwIcStu) {
    if (!subs.length) return `<div style="text-align:center;padding:50px 20px;color:var(--text-3);font-size:12px;border:1px dashed var(--border);border-radius:4px">${title}<br>暂无学生提交</div>`;
    return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:12px 14px">
      <div style="font-size:12px;font-weight:600;margin-bottom:2px">${title}</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">${s.session_date || ''} · 已交 ${subs.length} / 必修 ${thwIc.req[s.id] == null ? '—' : thwIc.req[s.id]}</div>
      <div style="display:flex;flex-direction:column;gap:5px">${subs.map(x => `<div onclick="thwIcStu='${x.id}';thwIcMain()" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-light);border-radius:3px">
        <span style="font-size:12px;font-weight:600;min-width:56px">${thwEsc(x.student_name)}</span>
        <span style="display:flex;gap:3px">${thwIcImgsHtml(Object.assign({}, x, { images: (x.images || []).slice(0, 3) }), false)}</span>
        <span style="font-size:11px;color:var(--text-2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${thwEsc(String(x.text || '').slice(0, 40))}</span>
        <span style="font-size:10px;color:${hwFeedbacks(x).length ? 'var(--ok)' : 'var(--warn,#b8860b)'}">${hwFeedbacks(x).length ? '✓ ' + thwEsc(hwGradedBy(x).join('、') || '已批改') : '待批改'}</span>
      </div>`).join('')}</div></div>`;
  }
  const sub = subs.find(x => x.id === thwIcStu);
  if (!sub) return '';
  const all = hwFeedbacks(sub), mine = all.filter(f => f.by === hwrMe()).pop() || null;
  return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px 16px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <span onclick="thwIcStu=null;thwIcMain()" style="font-size:11px;color:var(--accent);cursor:pointer">← 返回列表</span>
      <span style="font-size:13px;font-weight:600">${thwEsc(sub.student_name)}</span>
      <span style="font-size:10px;color:var(--text-3)">${title} · ${fmtJst(sub.submitted_at)}</span>
    </div>
    <div style="border:1px solid var(--border-light);border-radius:3px;padding:12px;background:var(--bg);max-height:52vh;overflow-y:auto">
      ${sub.text ? `<div style="font-size:12px;line-height:1.9;white-space:pre-wrap;margin-bottom:8px">${thwEsc(sub.text)}</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">${thwIcImgsHtml(sub, true)}</div>
      <div style="font-size:9px;color:var(--text-3);margin-top:6px">点图片放大、旋转</div>
    </div>
    ${hwrIcFeedbackBlockHtml(sub, all, mine)}
  </div>`;
}
// ══ 导出 Word（.doc，Word 可直接打开并批注；图片以链接嵌入，文字作答完整保留） ══
function thwWordBlob(title, bodyHtml) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:'Noto Serif SC','MS Mincho',serif;font-size:12pt;line-height:1.8;color:#1a1814}
  .q{font-weight:bold;margin:14pt 0 4pt}
  .a{background:#f7f5f0;padding:8pt;margin-bottom:8pt;white-space:pre-wrap}
  .head{border-bottom:2pt solid #5a3e28;padding-bottom:6pt;margin-bottom:12pt}
  img{max-width:440px;height:auto}
</style></head><body>${bodyHtml}</body></html>`;
  return new Blob(['\ufeff', html], { type: 'application/msword' });
}

function thwDownload(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// 供 Word 使用的正文（题干＋作答，图片用链接与内嵌两种方式）
function thwWordBody(s, sub, rotMap) {
  const answers = sub.answers || [];
  const groups = [];
  answers.forEach(a => {
    const label = a.label || a.k || '';
    const sp = label.indexOf(' ');
    const head = sp > 0 ? label.slice(0, sp) : '';
    let sub2 = sp > 0 ? label.slice(sp + 1) : label;
    if (sub2 === '作答') sub2 = '';
    let g = groups.find(x => x.head === head);
    if (!g) { g = { head, items: [] }; groups.push(g); }
    g.items.push({ ...a, sub: sub2 });
  });
  return `<div class="head">
    <div style="font-size:15pt;font-weight:bold">${thwEsc(sub.student_name)} — ${thwEsc(s.course_name||'')} 第${s.session_number||''}回 作业${sub.level?`（${thwEsc(sub.level)}级）`:''}</div>
    <div style="font-size:10pt;color:#666">${s.session_date||''}　提交时间：${fmtJst(sub.submitted_at)}</div>
  </div>
  ${sub.whole_file_url?`<p style="font-size:10pt">学生上传的整份作业：<a href="${thwEsc(sub.whole_file_url)}">${thwEsc(sub.whole_file_url)}</a></p>`:''}
  ${groups.map(g => `
    ${g.head?`<div style="font-size:13pt;font-weight:bold;margin-top:16pt">${thwEsc(g.head)}</div>`:''}
    ${g.items.map(it => `
      <div class="q">${thwEsc(it.sub)}${it.q?` ${thwEsc(it.q)}`:''}</div>
      ${it.text?`<div class="a">${thwEsc(it.text)}</div>`:''}
      ${(it.images||[]).map((im,i) => im.kind==='doc'
        ? `<p style="font-size:10pt">📎 附件：<a href="${thwEsc(im.url)}">${thwEsc(im.name||'文件')}</a></p>`
        : `<p style="font-size:9pt;color:#888">${thwEsc(it.sub)} · 图${i+1}</p><p><img src="${thwEsc((rotMap && rotMap[im.url + '|' + thwRotNorm(im.rotate)]) || im.url)}" width="440" style="max-width:440px;height:auto"></p>`).join('')}
      ${!it.text && !(it.images||[]).length?`<div style="color:#aaa">（未作答）</div>`:''}
    `).join('')}
  `).join('')}
  <div style="margin-top:24pt;border-top:1pt solid #ccc;padding-top:8pt;font-size:10pt;color:#888">批改栏（可直接在此处或各题下方批注）</div>
  <div style="min-height:80pt"></div>`;
}

async function thwExportWord(subId) {
  const s = thwSessions.find(x => x.id === thwOpenSession);
  const sub = (thwSubs[thwOpenSession] || []).find(x => x.id === subId);
  if (!s || !sub) return;
  const name = `${sub.student_name}_${s.course_name||''}_第${s.session_number||''}回作业.doc`;
  const rotMap = await thwRotatedMap([sub]).catch(() => ({}));
  thwDownload(thwWordBlob(name, thwWordBody(s, sub, rotMap)), name);
}

async function thwExportWordAll() {
  const s = thwSessions.find(x => x.id === thwOpenSession);
  const subs = thwSubs[thwOpenSession] || [];
  if (!s || !subs.length) return;
  const rotMap = await thwRotatedMap(subs).catch(() => ({}));
  const body = subs.map(sub => thwWordBody(s, sub, rotMap) + '<br clear=all style="page-break-before:always">').join('');
  const name = `${s.course_name||''}_第${s.session_number||''}回_全部作业.doc`;
  thwDownload(thwWordBlob(name, body), name);
}

// 保存批改（写入 homework_submissions.feedbacks；逻辑在 shared/homework-review.js）
async function thwSaveFeedback(subId) {
  const sub = (thwSubs[thwOpenSession] || []).find(x => x.id === subId);
  if (!sub || !(await hwrSaveFeedback(sub, 'homework_submissions'))) return;
  alert('批改已保存，学生可见');
  thwOpenStudent = null;
  thwRender();
}
// 随堂作业批改
async function thwIcSave(subId) {
  const sub = (thwIc.subs[thwIcOpen] || []).find(x => x.id === subId);
  if (!sub || !(await hwrIcSaveFeedback(sub))) return;
  alert('批改已保存，学生可见');
  thwIcStu = null;
  thwRender();
}
