// ══════════════════════════════════
// interview-prep.js — 学生端「面试准备」（学习页「计划书」页签里的「面试准备」chip）
// 题库按专业一套（shared/interview-bank.js，管理端「🎤 面试题库」维护）；学生按章节检索、逐题作答
// 答案存 riyu_submissions（kind='grad_interview'）：每所志望校一行（school_key=志望校 key），共用章一行（school_key='_common'）
// sections 以「题 key」为键；旧版 8 段（self / motive / …）的答案原样保留在同一行里，只读显示在「旧版面试稿」折叠块
// 依赖：study.js（studyStudent / studyData / escA / studyPlanDoc / switchStudyTab）、shared/riyu.js、shared/interview-bank.js、shared/doc-versions.js
// ══════════════════════════════════
let ivs = { bank: null, subs: [], vers: [], old: null, drafts: {}, dirty: {}, school: '', chap: '', q: '', moreChaps: false, savedAt: '', err: '', focusTodo: false, loading: false };
let ivsSummary = null;      // 学习页提醒 / 时间线用的摘要：{ rem: ivbReminder 结果 | null, done, total }
let ivsSaveTimer = null;
const ivsChain = {};        // rowKey → 保存队列（避免同一行并发保存时重复新建）

// ── 入口 ──
function ivsShell() {
  setTimeout(ivsLoad, 0);
  return `<div id="ivs_wrap"><div style="text-align:center;padding:36px;color:var(--text-muted);font-size:12px">加载中…</div></div>`;
}
function studyGoInterview() {   // 提醒条：去面试准备，并定位到第一道未答必答题
  ivs.focusTodo = true;
  studyPlanDoc = RIYU_INTERVIEW_KIND;
  switchStudyTab('plan');
}
function ivsPlans() { return (studyData.schoolPlans || []).slice().sort((a, b) => (a.level || 2) - (b.level || 2)); }
function ivsSchoolName(p) { return [p.school_name, p.faculty, p.department].filter(Boolean).join(' · ') || '（未命名学校）'; }
async function ivsLoad() {
  if (ivs.loading) return; ivs.loading = true;
  let subs = [], vers = [], err = '', bank = null, old = null;
  try {
    await Promise.all([
      ivbForStudent(studyStudent).then(b => { bank = b; }),
      sb(`/rest/v1/riyu_submissions?student_id=eq.${encodeURIComponent(studyStudent.id)}&kind=eq.${RIYU_INTERVIEW_KIND}&select=*`, 'GET', null, { cache: 'no-store' }).then(r => { subs = r || []; }).catch(e => { err = e.message; }),
      docvLoad(studyStudent.id, 'interview').then(r => { vers = r || []; }).catch(() => {}),
      riyuLoadGuide(RIYU_INTERVIEW_KIND).then(g => { old = g; }).catch(() => {}),
    ]);
  } finally { ivs.loading = false; }
  const plans = ivsPlans();
  const keep = ivs.school && plans.some(p => riyuKeyOf(p) === ivs.school);
  Object.assign(ivs, { bank, subs, vers, old, err, school: keep ? ivs.school : ivbDefaultSchool(plans) });
  if (bank && (!ivs.chap || !bank.chapters.some(c => c.key === ivs.chap))) ivs.chap = bank.chapters.length ? bank.chapters[0].key : '';
  if (ivs.focusTodo && bank) {
    ivs.focusTodo = false; ivs.q = '';
    const pr = ivbProgress(bank, subs, ivs.school, ivs.drafts);
    if (pr.firstTodo) { ivs.chap = pr.firstTodo.chapter; ivs._scrollTo = pr.firstTodo.item; }
  }
  ivsRender();
}

// ── 样式小工具 ──
const IVS_INP = 'width:100%;box-sizing:border-box;font-size:12px;line-height:1.8;padding:8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit';
function ivsChip(label, on, click, sub) {
  return `<span onclick="${click}" style="cursor:pointer;padding:4px 11px;border-radius:3px;font-size:12px;white-space:nowrap;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--btn-bg,#efe9e1)' : 'var(--surface)'};color:${on ? 'var(--btn-fg,#3a2e24)' : 'var(--text-secondary)'};font-weight:${on ? '600' : '400'}">${escA(label)}${sub ? `<span style="font-size:10px;opacity:.75;margin-left:5px">${escA(sub)}</span>` : ''}</span>`;
}
function ivsRowStatus(rowKey) {
  const sub = ivs.subs.find(s => s.school_key === rowKey);
  return sub ? riyuStatusInfo(sub.status) : { t: '草稿', c: '#6a6560', bg: '#f0ede8' };
}

// ── 渲染 ──
function ivsRender() {
  const wrap = document.getElementById('ivs_wrap'); if (!wrap) return;
  const b = ivs.bank;
  if (ivs.err) { wrap.innerHTML = `<div style="font-size:12px;color:var(--danger);padding:16px">读取失败：${escA(ivs.err)}（请刷新重试）</div>`; return; }
  if (!b) { wrap.innerHTML = '<div style="text-align:center;padding:36px;color:var(--text-muted);font-size:12px">你所在的专业还没有面试题库，请联系老师</div>'; return; }
  const plans = ivsPlans();
  const hasSchoolCh = b.chapters.some(c => c.scope === 'school');
  const head = `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:12px 14px;margin-bottom:12px;font-size:11px;color:var(--text-secondary);line-height:1.9">
      <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;font-size:13px">${escA(b.title || '面试稿')}</div>
      ${riyuMd(b.intro)}
      ${b.standard ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-light)"><div style="font-weight:600;color:var(--text-primary);margin-bottom:3px">面试稿标准</div>${riyuMd(b.standard)}</div>` : ''}
      ${(b.manual_files || []).length ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-light)"><span style="font-weight:600;color:var(--text-primary)">面试手册</span> ${b.manual_files.map(f => `<a href="${escA(f.url)}" target="_blank" style="color:var(--accent);margin-left:8px">${escA(f.name)} ⬇</a>`).join('')}</div>` : ''}
      ${(b.ref_files || []).length ? `<div style="margin-top:6px">${b.ref_files.map(f => `<a href="${escA(f.url)}" target="_blank" style="color:var(--accent);margin-right:10px">${escA(f.name)} ⬇</a>`).join('')}</div>` : ''}
    </div>`;
  const schoolSel = !hasSchoolCh ? '' : plans.length
    ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap"><span style="font-size:11px;color:var(--text-muted)">写给哪所志望校（带「各校」标记的章按学校分别作答）：</span>
        <select onchange="ivsSetSchool(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit;max-width:100%">${plans.map(p => `<option value="${escA(riyuKeyOf(p))}" ${ivs.school === riyuKeyOf(p) ? 'selected' : ''}>${escA(ivsSchoolName(p))}</option>`).join('')}</select></div>`
    : '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">还没有志望校：带「各校」标记的章请先在「志望校」标签填写志望校；其余章可以照常写。</div>';
  wrap.innerHTML = `${head}
    <div id="ivs_prog"></div>
    <input id="ivs_q" value="${escA(ivs.q)}" placeholder="搜索题目 / 指导 / 参考例 / 关键词（搜索所有章节）" oninput="ivsSearchInput(this.value)" style="${IVS_INP};margin-bottom:10px">
    ${schoolSel}
    <div id="ivs_body"></div>
    <div id="ivs_legacy"></div>
    <div id="ivs_upload"></div>`;
  ivsRenderBody();
  ivsRenderProg();
  ivsRenderLegacy();
  ivsRenderUpload();
}
function ivsRenderProg() {
  const el = document.getElementById('ivs_prog'); if (!el || !ivs.bank) return;
  const pr = ivbProgress(ivs.bank, ivs.subs, ivs.school, ivs.drafts);
  const pct = pr.total ? Math.round(pr.done / pr.total * 100) : 0;
  el.innerHTML = pr.total ? `<div style="margin-bottom:10px"><div style="font-size:11px;color:var(--text-secondary);margin-bottom:3px">必答 ${pr.done} / ${pr.total}${pr.done >= pr.total ? ' · 已全部写完，可以提交给老师' : ''}</div>
    <div style="height:6px;background:var(--border-light);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent)"></div></div></div>` : '';
}
function ivsRenderBody() {
  const box = document.getElementById('ivs_body'); if (!box || !ivs.bank) return;
  const b = ivs.bank, q = ivs.q.trim();
  const pr = ivbProgress(b, ivs.subs, ivs.school, ivs.drafts);
  let html = '';
  if (q) {
    const hits = ivbSearch(b, q);
    html += `<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">找到 ${hits.length} 题</div>`;
    html += hits.slice(0, 40).map(h => `<div style="font-size:10px;color:var(--text-muted);margin:8px 0 3px">${escA(h.ch.title)}${h.ch.scope === 'school' ? ' · 各校' : ''}</div>${ivsItemHtml(h.ch, h.it, true)}`).join('');
    if (hits.length > 40) html += `<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:8px">只显示前 40 题，请输入更具体的关键词</div>`;
  } else {
    const chips = b.chapters.map(c => ({ c, on: c.key === ivs.chap }));
    const MAX = 12;
    const shown = chips.filter((x, i) => i < MAX || x.on), hidden = chips.filter((x, i) => !(i < MAX || x.on));
    const chipHtml = x => { const p = pr.byChapter[x.c.key] || { done: 0, total: 0 }; return ivsChip(x.c.title, x.on, `ivsSetChap('${x.c.key}')`, (x.c.scope === 'school' ? '各校 ' : '') + (p.total ? `${p.done}/${p.total}` : '')); };
    html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${shown.map(chipHtml).join('')}${ivs.moreChaps ? hidden.map(chipHtml).join('') : ''}${hidden.length ? `<span onclick="ivs.moreChaps=!ivs.moreChaps;ivsRenderBody()" style="cursor:pointer;padding:4px 11px;font-size:11px;color:var(--text-muted);border:1px dashed var(--border);border-radius:3px">${ivs.moreChaps ? '收起 ▴' : `更多 ▾ ${hidden.length}`}</span>` : ''}</div>`;
    const ch = b.chapters.find(c => c.key === ivs.chap);
    if (ch) {
      const rk = ivbRowKeyFor(ch, ivs.school);
      html += `<div style="font-size:13px;font-weight:600;margin-bottom:4px">${escA(ch.title)}${ch.scope === 'school' ? `<span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:8px">各校分别作答${ivs.school && ivs.bank ? '：' + escA(ivsSchoolNameByKey(ivs.school)) : ''}</span>` : '<span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:8px">只写一次，各校共用</span>'}</div>`;
      if (ch.intro) html += `<div style="font-size:11px;color:var(--text-secondary);line-height:1.9;margin-bottom:8px">${riyuMd(ch.intro)}</div>`;
      const items = ivbVisibleItems(ch);
      html += items.length ? items.map(it => ivsItemHtml(ch, it, false)).join('') : '<div style="font-size:12px;color:var(--text-muted);padding:16px;text-align:center">这一章还没有题目</div>';
      if (rk && items.some(it => ivbAnswerable(ch, it))) {
        const st = ivsRowStatus(rk);
        html += `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 4px">
          <button data-row="${escA(rk)}" onclick="ivsSaveNow(this.dataset.row,false)" style="background:var(--surface);color:var(--accent);border:1px solid var(--accent);border-radius:4px;padding:8px 16px;font-size:12px;cursor:pointer;font-family:inherit">💾 保存草稿</button>
          <button data-row="${escA(rk)}" onclick="ivsSaveNow(this.dataset.row,true)" style="background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:4px;padding:8px 16px;font-size:12px;cursor:pointer;font-family:inherit">📤 提交给老师（${ch.scope === 'school' ? escA(ivsSchoolNameByKey(rk)) : '共用部分'}）</button>
          <span style="font-size:10px;padding:1px 9px;border-radius:10px;background:${st.bg};color:${st.c}">${st.t}</span>
          <span id="ivs_stat" style="font-size:11px;color:var(--text-muted)">${escA(ivs.savedAt)}</span></div>
          ${ivsReviewHtml(rk)}`;
      } else if (ch.scope === 'school' && !ivs.school) {
        html += '<div style="font-size:12px;color:var(--text-muted);padding:12px 0">请先在「志望校」标签填写志望校，再回来写这一章。</div>';
      }
    }
  }
  box.innerHTML = html;
  box.querySelectorAll('textarea[data-item]').forEach(t => { t.style.height = 'auto'; t.style.height = Math.max(t.scrollHeight, 64) + 'px'; });
  if (ivs._scrollTo) { const el = box.querySelector(`[data-card="${ivs._scrollTo}"]`); ivs._scrollTo = ''; if (el) { el.scrollIntoView({ block: 'center' }); const t = el.querySelector('textarea'); if (t) t.focus(); } }
}
function ivsSchoolNameByKey(k) { const p = ivsPlans().find(x => riyuKeyOf(x) === k); return p ? ivsSchoolName(p) : ''; }
// 老师批复版本（该行已批复时）
function ivsReviewHtml(rk) {
  const sub = ivs.subs.find(s => s.school_key === rk);
  if (!sub || sub.status !== 'reviewed' || !sub.reviewed_file_url) return '';
  return `<div style="background:#e4f0e8;border:1px solid #b8d8bc;border-radius:4px;padding:9px 12px;margin:8px 0;font-size:12px;color:#1f5a36"><b>老师批复版本</b> <a href="${escA(sub.reviewed_file_url)}" target="_blank" style="color:#1f5a36;font-weight:600">⬇ 下载</a>
    <span style="font-size:11px">（${escA(sub.reviewed_file_name || '批复文件')} · ${escA(riyuFmtTime(sub.reviewed_at))}）</span>${sub.review_note ? `<div style="font-size:11px;margin-top:4px;white-space:pre-wrap">老师备注：${escA(sub.review_note)}</div>` : ''}</div>`;
}
// 一道题
function ivsItemHtml(ch, it, inSearch) {
  const answerable = ivbAnswerable(ch, it);
  const rk = ivbRowKeyFor(ch, ivs.school);
  const val = answerable && rk ? ivbAnswer(ivs.subs, rk, it.key, ivs.drafts) : '';
  const hasKw = it.keywords && it.keywords.length;
  const kw = hasKw ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin:6px 0">${it.keywords.map(k => `<span style="font-size:11px;padding:2px 9px;border:1px solid var(--border-light);border-radius:3px;background:var(--bg)">${escA(k)}</span>`).join('')}</div>` : '';
  const q = ivs.q.trim();
  const open = (v) => (inSearch && q && String(v || '').toLowerCase().indexOf(q.toLowerCase()) >= 0);
  const tips = it.tips ? `<details ${(!String(val).trim() && answerable) || open(it.tips) ? 'open' : ''} style="background:#faf6ec;border:1px solid #efe4c8;border-radius:3px;padding:5px 10px;margin:5px 0;font-size:11px;color:var(--text-secondary)"><summary style="cursor:pointer;color:#8a6a1b">老师指导</summary><div style="line-height:1.8;margin-top:4px">${riyuMd(it.tips)}</div></details>` : '';
  const ex = it.example ? `<details ${open(it.example) ? 'open' : ''} style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:5px 10px;margin:5px 0;font-size:11px;color:var(--text-secondary)"><summary style="cursor:pointer">参考例（先自己写，再对照）</summary><div style="line-height:1.9;margin-top:4px;white-space:pre-wrap">${escA(it.example)}</div></details>` : '';
  let ta = '';
  if (answerable) {
    ta = rk ? `<textarea data-row="${escA(rk)}" data-item="${escA(it.key)}" rows="3" oninput="ivsInput(this)" style="${IVS_INP};resize:vertical;overflow:hidden">${escA(val)}</textarea>`
      : '<div style="font-size:11px;color:var(--text-muted);padding:6px 0">这题要按志望校分别作答：请先填写志望校</div>';
  }
  const done = answerable && String(val).trim();
  return `<div data-card="${escA(it.key)}" style="border:1px solid var(--border-light);border-radius:5px;padding:11px 13px;margin-bottom:10px;background:var(--surface)">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><span style="font-size:13px;font-weight:600;line-height:1.7">${escA(it.q)}</span>
      ${answerable && it.required !== false ? '<span style="font-size:10px;color:#a0621a;border:1px solid #e8c9a0;border-radius:2px;padding:0 5px">必答</span>' : ''}
      ${answerable ? `<span style="margin-left:auto;font-size:10px;color:${done ? 'var(--success,#2a7a4a)' : 'var(--text-muted)'}">${done ? '已写' : '未写'}</span>` : ''}</div>
    ${kw}${tips}${ex}${ta}
  </div>`;
}

// ── 交互 ──
function ivsSetChap(k) { ivs.chap = k; ivsRenderBody(); }
function ivsSetSchool(k) { ivs.school = k; ivsRenderBody(); ivsRenderProg(); }
let ivsSearchTimer = null;
function ivsSearchInput(v) { ivs.q = v; clearTimeout(ivsSearchTimer); ivsSearchTimer = setTimeout(ivsRenderBody, 200); }
function ivsInput(el) {
  const rk = el.dataset.row, ik = el.dataset.item;
  (ivs.drafts[rk] = ivs.drafts[rk] || {})[ik] = el.value;
  ivs.dirty[rk] = true;
  el.style.height = 'auto'; el.style.height = Math.max(el.scrollHeight, 64) + 'px';
  const st = document.getElementById('ivs_stat'); if (st) st.textContent = '未保存…';
  ivsRenderProgSoon();
  clearTimeout(ivsSaveTimer); ivsSaveTimer = setTimeout(ivsFlush, 1500);   // 输入停顿后自动保存
}
let ivsProgTimer = null;
function ivsRenderProgSoon() { clearTimeout(ivsProgTimer); ivsProgTimer = setTimeout(ivsRenderProg, 400); }
function ivsFlush() {   // 自动保存所有有改动的行（切换页签时也调用）
  clearTimeout(ivsSaveTimer);
  Object.keys(ivs.dirty).forEach(rk => { if (ivs.dirty[rk]) ivsSaveRow(rk, false, true); });
}
async function ivsSaveNow(rk, submit) {
  if (submit) {
    const pr = ivbProgress(ivs.bank, ivs.subs, ivs.school, ivs.drafts);
    if (pr.total && pr.done < pr.total && !confirm(`必答题还有 ${pr.total - pr.done} 题没写完，现在提交给老师吗？`)) return;
  }
  const ok = await ivsSaveRow(rk, submit, false);
  if (ok && submit) alert('已提交！老师会修改后给你批复，批复版本会出现在这里。');
}
function ivsSaveRow(rowKey, submit, silent) {
  const run = () => ivsSaveRowDo(rowKey, submit, silent);
  ivsChain[rowKey] = (ivsChain[rowKey] || Promise.resolve()).then(run, run);
  return ivsChain[rowKey];
}
async function ivsSaveRowDo(rowKey, submit, silent) {
  const st = document.getElementById('ivs_stat');
  const sub = ivs.subs.find(s => s.school_key === rowKey);
  const sections = Object.assign({}, riyuSecs(sub));
  const snap = Object.assign({}, ivs.drafts[rowKey] || {});
  Object.keys(snap).forEach(k => { if (String(snap[k]).trim()) sections[k] = snap[k]; else delete sections[k]; });
  if (submit && !Object.keys(sections).some(k => String(sections[k] || '').trim())) { alert('还没有写任何内容，写完再提交吧'); return false; }
  if (!sub && !Object.keys(snap).length && !submit) return true;
  if (st && !silent) { st.style.color = 'var(--text-muted)'; st.textContent = submit ? '提交中…' : '保存中…'; }
  const p = rowKey === IVB_COMMON_KEY ? {} : (ivsPlans().find(x => riyuKeyOf(x) === rowKey) || {});
  const now = new Date().toISOString();
  const data = { sections, school_name: p.school_name || '', faculty: p.faculty || '', department: p.department || '', updated_at: now, requirement: null };
  if (submit) { data.status = 'submitted'; data.submitted_at = now; data.history = riyuHistory(sub).concat([{ at: now, by: studyStudent.name, action: 'submit' }]); }
  try {
    let row;
    if (sub) {
      const r = await sb(`/rest/v1/riyu_submissions?id=eq.${encodeURIComponent(sub.id)}`, 'PATCH', data);
      row = Object.assign(sub, data, (r || [])[0] || {});
    } else {
      const ins = Object.assign({ id: `rs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, student_id: studyStudent.id, kind: RIYU_INTERVIEW_KIND, school_key: rowKey, status: 'draft', history: [] }, data);
      const r = await sb('/rest/v1/riyu_submissions', 'POST', ins);
      row = (r || [])[0] || ins;
      ivs.subs.push(row);
    }
    // 已保存的内容不再算草稿（保存途中又改了的保留）
    const d = ivs.drafts[rowKey] || {};
    Object.keys(snap).forEach(k => { if (d[k] === snap[k]) delete d[k]; });
    if (!Object.keys(d).length) { delete ivs.drafts[rowKey]; ivs.dirty[rowKey] = false; }
    const t = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    ivs.savedAt = submit ? '已提交 ' + t : '已保存 ' + t;
    if (typeof ivsReminderLoad === 'function') ivsReminderLoad().then(() => { if (typeof studyRemindersRender === 'function') studyRemindersRender(); }).catch(() => {});   // 提醒 / 时间线重算
    if (submit) ivsRenderBody(); else { const s2 = document.getElementById('ivs_stat'); if (s2) { s2.style.color = 'var(--ok,#2a7a4a)'; s2.textContent = ivs.savedAt; } }
    ivsRenderProg();
    if (typeof studyPlanBarRender === 'function' && document.getElementById('plan_doc_bar')) { studyPlanSubs[RIYU_INTERVIEW_KIND] = ivs.subs; studyPlanBarRender(); }
    return true;
  } catch (e) {
    if (st) { st.style.color = 'var(--danger)'; st.textContent = '保存失败：' + e.message; }
    if (!silent) alert((submit ? '提交' : '保存') + '失败：' + e.message);
    return false;
  }
}

// ── 旧版面试稿（参考）：旧 8 段答案还在同一行里，只读显示 ──
function ivsRenderLegacy() {
  const el = document.getElementById('ivs_legacy'); if (!el) return;
  const old = ivs.old; if (!old || !old.sections || !old.sections.length) { el.innerHTML = ''; return; }
  const rows = ivs.subs.filter(s => old.sections.some(sec => String(riyuSecs(s)[sec.key] || '').trim()));
  if (!rows.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<details style="margin-top:14px;font-size:11px;background:var(--bg);border-radius:3px;padding:6px 10px"><summary style="cursor:pointer;color:var(--text-secondary)">旧版面试稿（参考，只读）</summary>
    ${rows.map(s => `<div style="margin-top:8px"><div style="font-weight:600">${escA(s.school_key === IVB_COMMON_KEY ? '共用' : [s.school_name, s.faculty, s.department].filter(Boolean).join(' · ') || '（未命名学校）')}</div>
      ${old.sections.map(sec => String(riyuSecs(s)[sec.key] || '').trim() ? `<div style="margin-top:4px"><div style="color:var(--text-muted)">${escA(sec.title)}</div><div style="white-space:pre-wrap;line-height:1.8;color:var(--text-secondary)">${escA(riyuSecs(s)[sec.key])}</div></div>` : '').join('')}</div>`).join('')}
  </details>`;
}

// ── 已有现成稿件？上传文件（降级为底部折叠；每次上传是新的一版，老师逐版批复）──
function ivsRenderUpload() {
  const el = document.getElementById('ivs_upload'); if (!el) return;
  const mine = (ivs.vers || []).filter(v => (v.school_key || '') === (ivs.school || ''));
  const next = mine.reduce((m, v) => Math.max(m, v.version_no || 0), 0) + 1;
  el.innerHTML = `<details style="margin-top:14px;font-size:12px;border:1px solid var(--border-light);border-radius:4px;padding:8px 12px;background:var(--surface)"><summary style="cursor:pointer;color:var(--text-secondary)">已有现成稿件？上传文件</summary>
    <div style="font-size:11px;color:var(--text-muted);margin:8px 0 6px">已经在本地写好的面试稿可以直接上传（.doc / .docx / .pdf），按上面选择的志望校归档；每次上传都是新的一版，以前的版本都会保留</div>
    <input type="file" id="ivs_file" accept=".doc,.docx,.pdf" style="font-size:11px;margin-bottom:6px;display:block">
    <input id="ivs_note" placeholder="这一版改了什么（可选）" style="width:100%;box-sizing:border-box;font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);margin-bottom:8px">
    <button onclick="ivsUpload()" style="font-size:12px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:3px;padding:6px 16px;cursor:pointer;font-family:inherit">上传（第 ${next} 版）</button>
    <span id="ivs_umsg" style="font-size:11px;margin-left:8px;color:var(--ok)"></span>
    ${docvStudentListHtml(mine)}</details>`;
}
async function ivsUpload() {
  const f = document.getElementById('ivs_file')?.files?.[0], msg = document.getElementById('ivs_umsg');
  if (!f) { if (msg) { msg.style.color = 'var(--danger)'; msg.textContent = '请先选择文件'; } return; }
  if (msg) { msg.style.color = 'var(--text-muted)'; msg.textContent = '上传中…'; }
  try {
    const p = ivsPlans().find(x => riyuKeyOf(x) === ivs.school) || {};
    const v = await docvCreate({ student: studyStudent, docType: 'interview', schoolKey: ivs.school || '', schoolName: [p.school_name, p.faculty, p.department].filter(Boolean).join(' '), file: f, note: document.getElementById('ivs_note')?.value || '', source: 'upload' });
    ivs.vers = [v].concat((ivs.vers || []).filter(x => x.id !== v.id));
    ivsRenderUpload();
    const m2 = document.getElementById('ivs_umsg'); if (m2) m2.textContent = `✓ 面试稿已上传（第 ${v.version_no} 版）`;
  } catch (e) { if (msg) { msg.style.color = 'var(--danger)'; msg.textContent = '上传失败：' + e.message; } }
}

// ── 计划书页签 chip 上的小字 ──
function ivsChipText(subs) {
  const bank = ivbCache[ivbKeyFor(studyStudent)]; if (!bank) return '';
  const pr = ivbProgress(bank, subs || [], ivbDefaultSchool(ivsPlans()));
  return pr.total ? `必答 ${pr.done}/${pr.total}` : '';
}

// ── 学习页顶部提醒 / 时间线 ──
async function ivsReminderLoad() {
  if (!studyStudent) return;
  const bank = await ivbForStudent(studyStudent);
  if (!bank) { ivsSummary = { rem: null, done: 0, total: 0 }; return; }
  const today = (typeof jstToday === 'function') ? jstToday() : new Date().toISOString().slice(0, 10);
  const [subs, bks] = await Promise.all([
    sb(`/rest/v1/riyu_submissions?student_id=eq.${encodeURIComponent(studyStudent.id)}&kind=eq.${RIYU_INTERVIEW_KIND}&select=*`, 'GET', null, { cache: 'no-store' }).catch(() => []),
    sb(`/rest/v1/bookings?student_id=eq.${encodeURIComponent(studyStudent.id)}&type=eq.mock&status=in.(pending,confirmed)&slot_date=gte.${today}&select=type,status,slot_date`, 'GET', null, { cache: 'no-store' }).catch(() => []),
  ]);
  const plans = studyData.schoolPlans || [];
  const pr = ivbProgress(bank, subs, ivbDefaultSchool(plans));
  ivsSummary = { rem: ivbReminder(bank, subs, plans, bks), done: pr.done, total: pr.total };
}
function ivsReminderItem() {
  const r = ivsSummary && ivsSummary.rem; if (!r) return null;
  return { t: `面试稿 · 还有 ${r.left} 题没写完${r.reason === 'mock' ? '（已约模拟面试）' : '（考试在 60 天内）'}`, go: 'studyGoInterview()' };
}
function ivsTimelineText() { return ivsSummary && ivsSummary.total ? `面试稿 ${ivsSummary.done}/${ivsSummary.total} 题` : ''; }
