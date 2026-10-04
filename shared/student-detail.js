// ══════════════════════════════════
// student-detail.js — 「学生详情」卡片（管理端 / 老师端共用）
// renderStudentDetailCard(studentId, opts) → Promise<{ html, student }>
//   每次调用都按 id 重新从数据库读：students、student_school_plans、student_progress_timeline、
//   student_plan_drafts、riyu_submissions、bookings，与「考学进度」页同一套数据和判断函数
//   （getLatestProgress / schoolStatusLabel / schoolLevelHtml / riyuCounts，均在 constants.js / riyu.js）。
//   opts.name：没有 id 时按姓名兜底找学生；opts.actionsHtml：卡片底部按钮（管理端传入）。
// 依赖：shared/supabase.js（sb）、shared/constants.js、shared/riyu.js
// ══════════════════════════════════

function sdEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

// 每次都绕过浏览器缓存重新读（刚改完档案马上点开要看到新内容）
async function sdGet(path) {
  const tok = (typeof __getSbToken === 'function') ? __getSbToken() : null;
  const r = await fetch(SB_URL + path, { cache: 'no-store', headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + (tok || SB_KEY) } });
  if (!r.ok) throw new Error(await r.text());
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}

async function renderStudentDetailCard(studentId, opts) {
  opts = opts || {};
  let s = null;
  if (studentId) s = ((await sdGet(`/rest/v1/students?id=eq.${encodeURIComponent(studentId)}&select=*`).catch(() => [])) || [])[0];
  if (!s && opts.name) s = ((await sdGet(`/rest/v1/students?name=eq.${encodeURIComponent(opts.name)}&select=*`).catch(() => [])) || [])[0];
  if (!s) return { html: '', student: null };
  const sid = encodeURIComponent(s.id);

  const [timeline, plans, drafts, riyuSubs, bkById, bkByName] = await Promise.all([
    sdGet(`/rest/v1/student_progress_timeline?student_id=eq.${sid}&select=*&order=created_at.asc&limit=500`).catch(() => []),
    sdGet(`/rest/v1/student_school_plans?student_id=eq.${sid}&select=*&order=level.asc&limit=100`).catch(() => []),
    sdGet(`/rest/v1/student_plan_drafts?student_id=eq.${sid}&select=*&limit=1`).catch(() => []),
    sdGet(`/rest/v1/riyu_submissions?student_id=eq.${sid}&select=*`).catch(() => []),
    sdGet(`/rest/v1/bookings?student_id=eq.${sid}&status=eq.confirmed&select=*&order=slot_date.desc&limit=5`).catch(() => []),
    // 老数据没有 student_id 的，才用姓名兜底
    sdGet(`/rest/v1/bookings?student_id=is.null&name=eq.${encodeURIComponent(s.name || '')}&status=eq.confirmed&select=*&order=slot_date.desc&limit=5`).catch(() => []),
  ]);
  const bookings = [...(bkById || []), ...(bkByName || [])]
    .sort((a, b) => String(b.slot_date || '').localeCompare(String(a.slot_date || ''))).slice(0, 5);
  const draft = (drafts || [])[0];
  const latest = getLatestProgress(timeline);

  const statusLabel = v => ({ active: '在籍', graduated: '已合格', expired: '已到期', stopped: '停课', withdrawn: '退学' }[v] || v);
  const row = (label, val) => val ? `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-light)"><span style="font-size:11px;color:var(--text-3);min-width:90px;flex-shrink:0">${label}</span><span style="font-size:11px;color:var(--text-2)">${val}</span></div>` : '';
  const secTitle = (t, mt) => `<div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin:${mt || 14}px 0 8px">${t}</div>`;

  // 成绩：以档案为准；考学进度里若记录过更新的状态，在后面小字标「更新于」
  const lastWith = k => { for (let i = timeline.length - 1; i >= 0; i--) if (timeline[i][k]) return timeline[i]; return null; };
  const scoreRow = (label, score, k) => {
    const t = lastWith(k);
    const upd = t ? `<span style="font-size:10px;color:var(--text-3);margin-left:6px">${sdEsc(t[k])} · 更新于 ${sdEsc(t.recorded_at || String(t.created_at || '').slice(0, 10))}</span>` : '';
    const main = score ? sdEsc(score) : '';
    return (main || upd) ? row(label, main + upd) : '';
  };

  // 当前阶段：与考学进度页一致（志望校为准：有合格→已合格；否则时间线最新；再按志望校推导）
  const anyPassed = plans.some(p => p.status === 'passed');
  let stage = '';
  if (anyPassed) stage = '已合格';
  else if (latest.apply) stage = latest.apply;
  else if (plans.some(p => p.status === 'applied')) stage = '已出愿';
  else if (plans.some(p => ['prof_ok', 'contacted'].includes(p.status))) stage = '联系教授中';
  else if (plans.length) stage = '择校确认中';

  // 计划书 / 志望理由书
  const gakubu = (typeof isGakubuStudent === 'function') && isGakubuStudent(s);
  let planTxt = latest.plan || '';
  if (gakubu) {
    const c = riyuCounts(plans, riyuSubs, 'gakubu_riyu');
    planTxt = (planTxt ? planTxt + ' · ' : '') + (plans.length ? riyuCountText(c) : '');
  } else if (!planTxt && draft) {
    let n = 0;
    try { n = Object.entries(JSON.parse(draft.draft_fields || '{}')).filter(([k, v]) => k !== 'riyu' && (Array.isArray(v) ? v.length : String(v || '').trim())).length; } catch (e) {}
    planTxt = draft.draft_file_url ? '已完成' : n > 0 ? '撰写中' : '';
  }

  const schoolsHtml = plans.length ? plans.map(p => {
    const st = schoolStatusLabel(p.status), pass = p.status === 'passed';
    const name = [p.school_name, p.faculty, p.department].filter(Boolean).map(sdEsc).join(' · ');
    return `<div style="font-size:11px;padding:5px 6px;border-bottom:1px solid var(--border-light);${pass ? 'background:var(--ok-bg,#e8f4ea);font-weight:600;border-radius:3px' : ''}">${schoolLevelHtml(p.level)} ${name}<span style="color:${st.c};margin-left:8px">${st.t}</span></div>`;
  }).join('') : '<div style="font-size:11px;color:var(--text-3)">还没有志望校</div>';

  const dims = ['japanese', 'english', 'plan', 'apply', 'exam'];
  const tlHtml = timeline.length ? [...timeline].slice(-3).reverse().map(e => {
    const parts = dims.filter(k => e[k]).map(k => `${PROGRESS_LABELS[k]}：${sdEsc(e[k])}`);
    if (e.notes) parts.push(sdEsc(e.notes));
    return `<div style="font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-light);color:var(--text-2)"><span style="color:var(--text-3);margin-right:6px">${sdEsc(e.recorded_at || String(e.created_at || '').slice(0, 10))}</span>${parts.join(' · ') || '—'}</div>`;
  }).join('') + (timeline.length > 3 ? '<div style="font-size:10px;color:var(--text-3);padding-top:4px">更多请看「📊 考学进度」</div>' : '') : '<div style="font-size:11px;color:var(--text-3)">暂无进度记录</div>';

  const html = `
    <div style="font-size:16px;font-weight:700;margin-bottom:4px">${sdEsc(s.name)}</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:16px">${sdEsc(MAJORS[s.major] || s.major || '')} · ${sdEsc(statusLabel(s.status))}</div>
    ${secTitle('基础档案', 0)}
    ${row('学生属性', sdEsc(s.student_type))}
    ${row('来源', sdEsc(s.source))}
    ${row('课程属性', sdEsc(s.course_type))}
    ${row('等级', sdEsc(s.level))}
    ${scoreRow('日语成绩', s.japanese_score, 'japanese')}
    ${scoreRow('英语成绩', s.english_score, 'english')}
    ${row('出身大学', sdEsc(s.university))}
    ${row('学部/专业', sdEsc(s.faculty))}
    ${row('GPA/履历', sdEsc(s.gpa))}
    ${row('毕业论文', sdEsc(s.thesis))}
    ${row('毕业时间', sdEsc(s.graduation_date))}
    ${row('期待入学', sdEsc(s.target_enrollment))}
    ${row('赴日时间', sdEsc(s.japan_arrival))}
    ${row('报名时间', sdEsc(s.signup_date))}
    ${row('到期时间', sdEsc(s.expiry_date))}
    ${row('上课方式', s.default_mode === 'online' ? '线上' : '线下')}
    ${row('查询码', sdEsc(s.student_code))}
    ${secTitle('考学进度')}
    ${row('当前阶段', sdEsc(stage))}
    ${row(gakubu ? '志望理由书' : '计划书', sdEsc(planTxt))}
    <div style="font-size:11px;color:var(--text-3);margin:8px 0 4px">志望校（${plans.length} 所）</div>
    ${schoolsHtml}
    <div style="font-size:11px;color:var(--text-3);margin:10px 0 4px">最近进度</div>
    ${tlHtml}
    ${bookings.length ? `${secTitle(`最近面谈（${bookings.length}条）`)}
    ${bookings.map(b => `<div style="font-size:11px;padding:6px 0;border-bottom:1px solid var(--border-light);color:var(--text-2)">${sdEsc(b.slot_date)} ${sdEsc(b.slot_time_range || '')} · ${sdEsc(typeLabel(b.type) || b.type)}</div>`).join('')}` : ''}
    ${opts.actionsHtml ? `<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">${opts.actionsHtml}</div>` : ''}`;
  return { html, student: s };
}
