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
let thwLimit = { todo: 30, done: 30 };   // 左栏「以前」两个展开列表先显示的条数
function thwLimited(list, key, itemFn) {
  const n = thwLimit[key] || 30;
  return list.slice(0, n).map(itemFn).join('') + (list.length > n ? `<div onclick="thwLimit['${key}']=${n}+30;thwRender()" style="cursor:pointer;text-align:center;padding:7px;font-size:11px;color:var(--accent)">显示更多（还有 ${list.length - n} 项）</div>` : '');
}
let thwPendingFile = null;   // 本次批改待保存的批改文件 {url, name}
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

function thwEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// 可见范围 = ①（homework_own_sessions）本人担当的单回 ∪ ②（homework_course_ids）负责课程的全部单回；admin 老师管理里分配
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
  if (!thwSessions.length && !thwArt.length && !thwNoQ.length) {
    mc.innerHTML = '<div class="empty">当期暂无分配给你的作业课次<br><span style="font-size:11px">作业由教务在课程安排的单回中布置</span></div>';
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
        <button onclick="thwExportWordAll()" style="font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">⬇ 全部导出 Word（可批注）</button>
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
        <button onclick="thwExportWord('${sub.id}')" style="font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">⬇ 导出 Word</button>
        <button onclick="thwPrintOne('${sub.id}')" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">🖨 打印 / PDF</button>
      </span>
    </div>
    <div style="border:1px solid var(--border-light);border-radius:3px;padding:12px;background:var(--bg);max-height:52vh;overflow-y:auto">
      ${thwPaperHtml(s, sub, false)}
    </div>
    <div style="margin-top:12px;border-top:1px solid var(--border-light);padding-top:10px">
      ${(() => {
        const all = hwFeedbacks(sub);
        return all.length ? `<div style="font-size:11px;font-weight:600;margin-bottom:6px">已有批改（${all.length}）</div>${hwFeedbackCardsHtml(all, { mine: teacherData.name })}` : '';
      })()}
      ${(() => {
        const mine = hwFeedbacks(sub).filter(f => f.by === teacherData.name).pop() || null;
        const v = k => thwEsc(mine ? (mine[k] || '') : '');
        const hasFile = thwPendingFile || (mine && mine.file_url);
        return `<div style="font-size:11px;font-weight:600;margin:8px 0">${mine ? '✍ 编辑我的批改（学生可见）' : '✍ 添加我的批改（学生可见）'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">📚 知识掌握情况</label>
          <textarea id="thw_know" rows="3" placeholder="例：基本概念掌握扎实，第3题的模型推导仍有偏差" style="width:100%;font-size:11px;line-height:1.8;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${v('knowledge')}</textarea></div>
        <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">🧭 学习态度</label>
          <textarea id="thw_att" rows="3" placeholder="例：书写工整、按时提交；部分题目略显敷衍" style="width:100%;font-size:11px;line-height:1.8;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${v('attitude')}</textarea></div>
      </div>
      <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">💡 改进建议 / 下一步</label>
      <textarea id="thw_sug" rows="3" placeholder="例：建议复习教材第4章，下次作业前完成过去问2015年第2题" style="width:100%;font-size:11px;line-height:1.8;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical;margin-bottom:8px">${v('suggestions')}</textarea>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="thw_score" value="${v('score')}" placeholder="评价/分数（可选）" style="font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;width:140px">
        <label style="font-size:10px;color:var(--accent);cursor:pointer;border:1px solid var(--border);border-radius:2px;padding:5px 12px">📎 上传批改文件（可带批注的 Word）
          <input type="file" accept=".doc,.docx,.pdf,image/*" style="display:none" onchange="thwUploadFile('${sub.id}', this)"></label>
        <span id="thw_file_tip" style="font-size:10px;color:var(--text-3)">${hasFile ? '✓ 已上传批改文件' + (thwPendingFile ? '（保存后生效）' : '') : ''}</span>
        <button onclick="thwSaveFeedback('${sub.id}')" style="margin-left:auto;font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 20px;cursor:pointer;font-family:inherit">${mine ? '保存修改' : '保存我的批改'}</button>
      </div>`;
      })()}
    </div>
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

// ── 照片旋转：im.rotate = 0/90/180/270，存在 homework_submissions.answers 的图片对象里 ──
const thwRotNorm = r => (((parseInt(r) || 0) % 360) + 360) % 360;
// 电脑端（≥768px）：不放大时图片按预览区可用宽度铺满（最宽 900px），不限高度；手机端不变
(function () {
  if (document.getElementById('thw_fit_css')) return;
  const st = document.createElement('style'); st.id = 'thw_fit_css';
  st.textContent = '@media (min-width:768px){.thw-fit[data-rot="0"],.thw-fit[data-rot="180"]{display:block!important;width:100%!important;max-width:900px!important}'
    + '.thw-fit[data-rot="0"] img,.thw-fit[data-rot="180"] img{width:100%!important;height:auto!important;max-width:100%!important;max-height:none!important}}';
  document.head.appendChild(st);
})();
const thwDesktop = () => window.matchMedia && window.matchMedia('(min-width:768px)').matches;
const THW_ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3];
const thwZ = {};   // 放大缩小只影响当前查看，不保存：{ [图片框 id]: { z, ... } }
function thwRotImg(subId, ai, i, im, forPrint, imgStyle) {
  const rot = thwRotNorm(im.rotate), side = rot === 90 || rot === 270;
  const id = `thwimg_${subId}_${ai}_${i}`;
  const wrap = side
    ? `display:flex;align-items:center;justify-content:center;width:100%;${forPrint ? 'height:440px' : ''}`
    : 'display:inline-block;max-width:100%';
  if (forPrint) return `<div id="${id}" data-rot="${rot}" style="position:relative;${wrap}"><img src="${thwEsc(im.url)}" width="440" style="${imgStyle}${rot ? `;transform:rotate(${rot}deg)` : ''}"></div>`;
  const btn = (js, t) => `<span onclick="${js}" style="cursor:pointer;background:rgba(0,0,0,.55);color:#fff;border-radius:3px;padding:1px 7px;font-size:13px;line-height:1.5;user-select:none">${t}</span>`;
  const ctl = `<div style="position:absolute;top:10px;right:6px;z-index:2;display:flex;gap:4px;align-items:center">${btn(`thwRotate('${subId}',${ai},${i},-90)`, '↺')}${btn(`thwRotate('${subId}',${ai},${i},90)`, '↻')}${btn(`thwZoomStep('${id}',1)`, '＋')}<span id="${id}_pct" style="background:rgba(0,0,0,.55);color:#fff;border-radius:3px;padding:1px 5px;font-size:11px;line-height:1.7;min-width:34px;text-align:center;user-select:none">100%</span>${btn(`thwZoomStep('${id}',-1)`, '－')}${btn(`thwZoomSet('${id}',1)`, '1:1')}</div>`;
  return `<div id="${id}" class="thw-fit" data-rot="${rot}" style="position:relative;${wrap}">${ctl}<div id="${id}_s" style="display:contents"><div id="${id}_g" style="display:contents"><img src="${thwEsc(im.url)}" onload="thwFitRot('${id}');thwBindPan('${id}')" onclick="thwImgClick(event,'${subId}',${ai},${i})" style="${imgStyle}${rot ? `;transform:rotate(${rot}deg)` : ''};cursor:zoom-in"></div></div></div>`;
}
// 横向时外框高度 = 图片显示宽度，避免和下面的内容重叠
function thwFitRot(id) {
  const w = document.getElementById(id); if (!w) return;
  if (thwZ[id] && thwZ[id].z !== 1) return;
  const img = w.querySelector('img'), rot = parseInt(w.dataset.rot) || 0, side = rot === 90 || rot === 270;
  // 电脑端横向：旋转后的可见宽度 = 可用宽度（图片排版高度取该宽度，外框高度 = 图片排版宽度）
  if (side && thwDesktop()) {
    const aw = Math.min(900, w.parentElement.clientWidth || 900);
    img.style.width = 'auto'; img.style.height = aw + 'px'; img.style.maxWidth = 'none'; img.style.maxHeight = 'none';
    w.style.maxWidth = '900px';
  } else {
    img.style.width = img.style.height = ''; img.style.maxWidth = '100%'; img.style.maxHeight = '60vh'; img.style.width = 'auto';
    w.style.maxWidth = '';
  }
  w.style.height = side ? (img.offsetWidth + 'px') : '';
}
// 不放大时的外框样式（和旋转逻辑一致）
function thwWrapStyle(w, rot) {
  const side = rot === 90 || rot === 270;
  w.dataset.rot = rot;
  w.style.display = side ? 'flex' : 'inline-block';
  w.style.alignItems = w.style.justifyContent = side ? 'center' : '';
  w.style.width = side ? '100%' : '';
  w.style.height = '';
  w.style.overflow = '';
}
// 放大 / 缩小：外框大小不变，图片在框里滚动。z=1 时回到原来的显示方式。
function thwZoomApply(id) {
  const w = document.getElementById(id); if (!w) return;
  const st = thwZ[id] || (thwZ[id] = { z: 1 });
  const sc = document.getElementById(id + '_s'), stg = document.getElementById(id + '_g'), img = w.querySelector('img');
  const rot = parseInt(w.dataset.rot) || 0, side = rot === 90 || rot === 270;
  const pct = document.getElementById(id + '_pct'); if (pct) pct.textContent = Math.round(st.z * 100) + '%';
  if (st.z === 1) {
    if (!st.on) return;
    st.on = false; w.classList.add('thw-fit');
    sc.style.cssText = 'display:contents'; stg.style.cssText = 'display:contents';
    img.setAttribute('style', st.imgCss);
    img.style.transform = rot ? `rotate(${rot}deg)` : '';
    thwWrapStyle(w, rot); thwFitRot(id);
    return;
  }
  if (!st.on) {
    st.on = true;
    st.imgCss = img.getAttribute('style');
    st.bw = img.offsetWidth; st.bh = img.offsetHeight;   // 先量（铺满后的大小就是 100%），再去掉铺满样式
    w.classList.remove('thw-fit');
    const vw = side ? st.bh : st.bw, vh = side ? st.bw : st.bh;
    st.fw = Math.min(vw, w.parentElement.clientWidth || vw); st.fh = vh;
  }
  w.style.cssText = `position:relative;display:block;width:${st.fw}px;height:${st.fh}px;max-width:100%;overflow:hidden`;
  sc.style.cssText = 'display:flex;width:100%;height:100%;overflow:auto;touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch';
  const iw = st.bw * st.z, ih = st.bh * st.z;
  stg.style.cssText = `flex:none;margin:auto;position:relative;width:${side ? ih : iw}px;height:${side ? iw : ih}px`;
  img.setAttribute('style', `position:absolute;left:50%;top:50%;width:${iw}px;height:${ih}px;max-width:none;max-height:none;margin:0;box-sizing:border-box;border:1px solid var(--border-light);transform:translate(-50%,-50%) rotate(${rot}deg);cursor:grab`);
}
function thwZoomSet(id, z) {
  const st = thwZ[id] || (thwZ[id] = { z: 1 });
  st.z = Math.max(0.5, Math.min(3, z));
  if (Math.abs(st.z - 1) < 0.02) st.z = 1;
  thwZoomApply(id);
}
function thwZoomNext(z, dir) {
  const L = THW_ZOOMS;
  return dir > 0 ? (L.find(x => x > z + 0.01) || L[L.length - 1]) : ([...L].reverse().find(x => x < z - 0.01) || L[0]);
}
function thwZoomStep(id, dir) { thwZoomSet(id, thwZoomNext((thwZ[id] || { z: 1 }).z, dir)); }
// 电脑上按住拖动、手机上双指缩放（单指拖动靠浏览器自带滚动）
function thwBindPan(id, el, getZ, setZ, onTap) {
  el = el || document.getElementById(id + '_s');
  if (!el || el._thwBound) return;
  getZ = getZ || (() => (thwZ[id] || { z: 1 }).z);
  setZ = setZ || (z => thwZoomSet(id, z));
  el._thwBound = true;
  let drag = null, moved = false, pinch = null;
  el.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop }; moved = false;
    if (getZ() !== 1) e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) moved = true;
    el.scrollLeft = drag.l - (e.clientX - drag.x); el.scrollTop = drag.t - (e.clientY - drag.y);
  });
  window.addEventListener('mouseup', () => { drag = null; });
  el._thwWasDrag = () => moved;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  el.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = { d: dist(e.touches), z: getZ() }; }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinch) { e.preventDefault(); setZ(pinch.z * dist(e.touches) / pinch.d); }
  }, { passive: false });
  el.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; }, { passive: true });
}
// 点图片：全屏黑底大图（可放大缩小、旋转、左右切换同一份作业的其他照片）
function thwImgClick(ev, subId, ai, i) {
  const sc = document.getElementById(`thwimg_${subId}_${ai}_${i}_s`);
  if (sc && sc._thwWasDrag && sc._thwWasDrag()) return;
  const sub = (thwSubs[thwOpenSession] || []).find(x => x.id === subId); if (!sub) return;
  const list = []; let idx = 0;
  (sub.answers || []).forEach((a, x) => (a.images || []).forEach((im, y) => {
    if (im.kind === 'doc') return;
    if (x === ai && y === i) idx = list.length;
    list.push({ url: im.url, rot: thwRotNorm(im.rotate) });
  }));
  thwLightbox(list, idx);
}
function thwLightbox(list, idx) {
  const old = document.getElementById('thw_lb'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'thw_lb';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#000;color:#fff;display:flex;flex-direction:column';
  const b = 'cursor:pointer;background:rgba(255,255,255,.18);border-radius:3px;padding:3px 10px;font-size:15px;user-select:none';
  ov.innerHTML = `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;padding:8px 10px;flex:none">
    <span id="thw_lb_n" style="margin-right:auto;font-size:12px;opacity:.8"></span>
    <span data-a="prev" style="${b}">‹</span><span data-a="next" style="${b}">›</span>
    <span data-a="rl" style="${b}">↺</span><span data-a="rr" style="${b}">↻</span>
    <span data-a="in" style="${b}">＋</span><span id="thw_lb_p" style="font-size:12px;min-width:38px;text-align:center"></span><span data-a="out" style="${b}">－</span><span data-a="one" style="${b}">1:1</span>
    <span data-a="x" style="${b};margin-left:8px">×</span></div>
    <div id="thw_lb_s" style="flex:1;min-height:0;display:flex;overflow:auto;touch-action:pan-x pan-y"><div id="thw_lb_g" style="flex:none;margin:auto;position:relative"><img id="thw_lb_i" style="position:absolute;left:50%;top:50%;max-width:none;user-select:none;-webkit-user-drag:none;cursor:grab" draggable="false"></div></div>`;
  document.body.appendChild(ov);
  const sc = ov.querySelector('#thw_lb_s'), stg = ov.querySelector('#thw_lb_g'), img = ov.querySelector('#thw_lb_i');
  const S = { z: 1, rot: 0 };
  const draw = () => {
    const side = S.rot === 90 || S.rot === 270, nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
    const aw = sc.clientWidth, ah = sc.clientHeight;
    const fit = Math.min(1, side ? Math.min(aw / nh, ah / nw) : Math.min(aw / nw, ah / nh));
    const iw = nw * fit * S.z, ih = nh * fit * S.z;
    stg.style.width = (side ? ih : iw) + 'px'; stg.style.height = (side ? iw : ih) + 'px';
    img.style.width = iw + 'px'; img.style.height = ih + 'px';
    img.style.transform = `translate(-50%,-50%) rotate(${S.rot}deg)`;
    ov.querySelector('#thw_lb_p').textContent = Math.round(S.z * 100) + '%';
  };
  const show = n => {
    idx = (n + list.length) % list.length; S.z = 1; S.rot = list[idx].rot;
    ov.querySelector('#thw_lb_n').textContent = `${idx + 1} / ${list.length}`;
    img.onload = draw; img.src = list[idx].url; sc.scrollLeft = sc.scrollTop = 0; draw();
  };
  const setZ = z => { S.z = Math.max(0.5, Math.min(5, z)); draw(); };
  const act = a => {
    if (a === 'x') return close();
    if (a === 'prev') return show(idx - 1);
    if (a === 'next') return show(idx + 1);
    if (a === 'rl') S.rot = thwRotNorm(S.rot - 90);
    else if (a === 'rr') S.rot = thwRotNorm(S.rot + 90);
    else if (a === 'in') S.z = Math.min(5, thwZoomNext(S.z, 1) === S.z ? S.z * 1.5 : thwZoomNext(S.z, 1));
    else if (a === 'out') S.z = thwZoomNext(S.z, -1);
    else if (a === 'one') S.z = 1;
    draw();
  };
  const onKey = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') act('prev');
    else if (e.key === 'ArrowRight') act('next');
    else if (e.key === '+' || e.key === '=') act('in');
    else if (e.key === '-') act('out');
  };
  function close() { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', draw); ov.remove(); }
  ov.addEventListener('click', e => { const a = e.target.getAttribute && e.target.getAttribute('data-a'); if (a) act(a); });
  document.addEventListener('keydown', onKey); window.addEventListener('resize', draw);
  thwBindPan('', sc, () => S.z, setZ);
  if (list.length < 2) ov.querySelectorAll('[data-a=prev],[data-a=next]').forEach(x => x.style.display = 'none');
  show(idx);
}
const thwRotTimers = {};
function thwRotate(subId, ai, i, d) {
  const sub = (thwSubs[thwOpenSession] || []).find(x => x.id === subId);
  const im = sub && sub.answers && sub.answers[ai] && (sub.answers[ai].images || [])[i];
  if (!im) return;
  im.rotate = thwRotNorm((im.rotate || 0) + d);
  const w = document.getElementById(`thwimg_${subId}_${ai}_${i}`);
  if (w) {
    thwWrapStyle(w, im.rotate);
    w.querySelector('img').style.transform = im.rotate ? `rotate(${im.rotate}deg)` : '';
    thwFitRot(w.id);
    thwZoomApply(w.id);
  }
  // 稍等一下再保存（连点几次只存一次）；保存失败只在本次预览里生效，不打扰老师
  clearTimeout(thwRotTimers[subId]);
  thwRotTimers[subId] = setTimeout(() => { sb(`/rest/v1/homework_submissions?id=eq.${subId}`, 'PATCH', { answers: sub.answers }).catch(() => {}); }, 600);
}
// Word 不认 CSS 旋转：只把转过的图片用 canvas 转好（失败 / 跨域读不出就退回原图）
function thwRotateDataUrl(url, rot) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const sc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
        const side = rot === 90 || rot === 270;
        const cv = document.createElement('canvas');
        cv.width = side ? h : w; cv.height = side ? w : h;
        const ctx = cv.getContext('2d');
        ctx.translate(cv.width / 2, cv.height / 2);
        ctx.rotate(rot * Math.PI / 180);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
async function thwRotatedMap(subs) {
  const map = {}, jobs = [];
  subs.forEach(sub => (sub.answers || []).forEach(a => (a.images || []).forEach(im => {
    const rot = thwRotNorm(im.rotate), key = im.url + '|' + rot;
    if (!rot || im.kind === 'doc' || key in map) return;
    map[key] = null;
    jobs.push(thwRotateDataUrl(im.url, rot).then(d => { map[key] = d; }));
  })));
  await Promise.all(jobs);
  return map;
}

// ── 整合答卷：按作答单元顺序展示（题目 + 文字答案 + 顺序照片） ──
function thwPaperHtml(s, sub, forPrint) {
  const imgStyle = forPrint
    ? 'max-width:100%;max-height:16cm;width:auto;height:auto;display:block;margin:6px 0;border:1px solid #ddd'
    : 'max-width:100%;max-height:60vh;width:auto;display:block;margin:6px 0;border:1px solid var(--border-light);border-radius:2px';
  const answers = sub.answers || [];
  // 按 head 分组保持题型区块结构
  const groups = [];
  answers.forEach((a, ai) => {
    const label = a.label || a.k || '';
    const sp = label.indexOf(' ');
    const head = sp > 0 ? label.slice(0, sp) : '';
    let sub2 = sp > 0 ? label.slice(sp + 1) : label;
    if (sub2 === '作答') sub2 = '';  // 整块统一作答：不重复显示「作答」二字
    if (sub2 === '整题') sub2 = '手写作答';  // 名词解释的整块图片
    let g = groups.find(x => x.head === head);
    if (!g) { g = { head, items: [] }; groups.push(g); }
    g.items.push({ ...a, sub: sub2, _ai: ai });
  });
  return `
  ${forPrint ? `<div style="border-bottom:2px solid #5a3e28;padding-bottom:8px;margin-bottom:14px">
    <div style="font-size:16px;font-weight:700">${thwEsc(sub.student_name)} — ${thwEsc(s.course_name||'')} 第${s.session_number||''}回 作业${sub.level?`（${thwEsc(sub.level)}级）`:''}</div>
    <div style="font-size:11px;color:#666;margin-top:3px">${s.session_date||''}${s.session_title?' · '+thwEsc(s.session_title):''}　提交时间：${fmtJst(sub.submitted_at)}</div>
  </div>` : ''}
  ${sub.whole_file_url ? `<div style="font-size:11px;margin-bottom:10px">📎 学生上传的整份作业：<a href="${thwEsc(sub.whole_file_url)}" target="_blank" style="color:#5a3e28">下载查看</a></div>` : ''}
  ${groups.map(g => `<div style="margin-bottom:${forPrint?'16px':'12px'}">
    ${g.head ? `<div style="font-size:${forPrint?'13px':'12px'};font-weight:700;margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid ${forPrint?'#ccc':'var(--border-light)'}">${thwEsc(g.head)}</div>` : ''}
    ${g.items.every(it => !(it.images||[]).length && !(it.q||'') && (it.text||'').length <= 8)
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:4px">
          ${g.items.map(it => `<div style="font-size:11px"><span style="color:#999">${thwEsc(it.sub)}</span> <b>${thwEsc(it.text||'—')}</b></div>`).join('')}
        </div>`
      : g.items.map(it => `<div style="margin-bottom:${forPrint?'12px':'8px'};page-break-inside:avoid">
          ${(it.sub||it.q)?`<div style="font-size:${forPrint?'12px':'11.5px'};font-weight:600;margin-bottom:3px">${thwEsc(it.sub)}${it.q?` <span style="font-weight:400">${thwEsc(it.q)}</span>`:''}</div>`:''}
          ${it.text ? `<div style="font-size:${forPrint?'12px':'11.5px'};line-height:1.9;white-space:pre-wrap;padding:6px 8px;background:${forPrint?'#fafafa':'var(--surface)'};border-radius:2px">${thwEsc(it.text)}</div>` : ''}
          ${(it.images||[]).map((im, i) => im.kind==='doc'
            ? `<div style="font-size:11px;margin-top:4px">📎 <a href="${thwEsc(im.url)}" target="_blank" style="color:#5a3e28">${thwEsc(im.name||'附件')}</a></div>`
            : `<div><div style="font-size:9px;color:#999;margin-top:4px">${thwEsc(it.sub)} · 图${i+1}</div>${thwRotImg(sub.id, it._ai, i, im, forPrint, imgStyle)}</div>`).join('')}
          ${!it.text && !(it.images||[]).length ? `<div style="font-size:11px;color:#aaa">（未作答）</div>` : ''}
        </div>`).join('')}
  </div>`).join('')}`;
}

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

async function thwUploadFile(subId, input) {
  const f = input.files[0];
  if (!f) return;
  const tip = document.getElementById('thw_file_tip');
  if (tip) tip.textContent = '上传中…';
  try {
    const ext = (f.name.split('.').pop() || 'docx').toLowerCase().replace(/[^a-z0-9]/g, '') || 'docx';
    const url = await sbUpload('teacher-files', `hw/${subId}-${Date.now()}.${ext}`, f);
    thwPendingFile = { url, name: f.name };   // 点「保存」时写进我的这条批改
    if (tip) tip.textContent = '✓ 已上传批改文件（保存后生效）';
  } catch (e) { if (tip) tip.textContent = '上传失败：' + e.message; }
  input.value = '';
}

// 多位老师共同批改：每位老师一条（feedbacks 追加；自己的那条可修改），旧字段同步写入最新一条，兼容别处的读取
async function thwSaveFeedback(subId) {
  const g = id => ((document.getElementById(id) || {}).value || '').trim();
  const know = g('thw_know'), att = g('thw_att'), sug = g('thw_sug'), score = g('thw_score');
  if (!know && !att && !sug) { alert('请至少填写一项反馈'); return; }
  const sub = (thwSubs[thwOpenSession] || []).find(x => x.id === subId);
  if (!sub) return;
  const me = teacherData.name, now = new Date().toISOString();
  const list = hwFeedbacks(sub).map(f => Object.assign({}, f));
  let mine = null;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].by === me) { mine = list[i]; break; }
  const fields = { knowledge: know, attitude: att, suggestions: sug, score, text: '' };
  if (thwPendingFile) { fields.file_url = thwPendingFile.url; fields.file_name = thwPendingFile.name; }
  if (mine) Object.assign(mine, fields, { edited_at: now });
  else list.push(Object.assign({ id: 'fb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), by: me, at: now, file_url: '', file_name: '' }, fields));
  if (mine && mine.id === 'legacy') mine.id = 'fb-legacy';
  const latest = list.slice().sort((a, b) => String(a.edited_at || a.at || '').localeCompare(String(b.edited_at || b.at || ''))).pop();
  const legacy = {
    feedback_knowledge: latest.knowledge || null, feedback_attitude: latest.attitude || null, feedback_suggestions: latest.suggestions || null,
    teacher_feedback: [latest.knowledge && '知识掌握：' + latest.knowledge, latest.attitude && '学习态度：' + latest.attitude, latest.suggestions && '改进建议：' + latest.suggestions].filter(Boolean).join('\n') || latest.text || '',
    score: latest.score || null, graded_by: latest.by, graded_at: latest.edited_at || latest.at,
  };
  if (latest.file_url) legacy.teacher_file_url = latest.file_url;
  try {
    let patch = Object.assign({ feedbacks: list }, legacy);
    try { await sb(`/rest/v1/homework_submissions?id=eq.${subId}`, 'PATCH', patch); }
    catch (e) {
      // feedbacks 字段还没建（SQL 未执行）时，退回只写旧字段
      if (!/feedbacks/.test(e.message)) throw e;
      patch = legacy;
      await sb(`/rest/v1/homework_submissions?id=eq.${subId}`, 'PATCH', patch);
    }
    Object.assign(sub, patch);
    thwPendingFile = null;
    alert('批改已保存，学生可见');
    thwOpenStudent = null;
    thwRender();
  } catch (e) { alert('保存失败：' + e.message); }
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
