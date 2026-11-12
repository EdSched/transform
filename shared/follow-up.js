// 面谈跟进（老师端「面谈跟进」/ 管理端「面谈跟进」共用）：读取面谈 / 预约 / 联系记录、按月状态、近 6 个月小方格、
// 补记录（学习记录 / 等回复 / 未回复，可附截图）、改类型、结案、删除、生成联络文字。
// 署名：老师端 = 老师名，管理端 = 「管理员」（riyuReviewerName）。管理员可以改 / 删任何人的记录。
// 页面差异通过宿主 FU_HOST 注入（谁定义：teacher/teacher-students.js、admin/followup.js）：
//   filter(list) 按页面的领域/专业/搜索筛学生（只留在籍，见 fuOnlyActive）· query() 当前搜索词 · slice(list) / more(total) 分页 · reset() 回到第一页
//   box() 页面容器 · reload() 重新读取并重画
// 依赖：shared/supabase.js、shared/constants.js、shared/payroll-core.js（payrollInterviewPayDate / interviewListYm）、shared/riyu.js（riyuReviewerName）
const fuEsc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const FU_ADMIN_NAME = '管理员';
let FU_HOST = { filter: l => l, slice: l => l, more: () => '', reset() {}, box: () => document.getElementById('mainContent'), reload() {} };
// 重点关注 / 面谈跟进只看在籍学生（status 为 active 或空）；两端的 filter 都先过一遍
function fuOnlyActive(list) { return (list || []).filter(s => !s.status || s.status === 'active'); }
// 没有结果时的提示：有搜索词 = 「没有找到在籍学生」
function fuEmptyText(dflt) { const q = FU_HOST.query ? String(FU_HOST.query() || '').trim() : ''; return q ? '没有找到在籍学生' : dflt; }
function fuSetHost(h) { FU_HOST = Object.assign({}, FU_HOST, h); }
const fuMe = () => (typeof riyuReviewerName === 'function' ? riyuReviewerName() : FU_ADMIN_NAME) || FU_ADMIN_NAME;

// ══════════════════════════════════
// 面谈跟进（学生管理子项 meetings）——按「每月一次」跟进
// 规则：每个学生每月至少一次面谈；没有面谈的，老师补「联系记录」：
//   学习记录（补充学习情况、和学生的互动等）→ 这个月算完成；联系未回复 → 没完成，继续跟进。
//   连续 3 次联系未回复（中间没有面谈 / 学习记录）→ 转入重点关注。
// ══════════════════════════════════
const TM_KIND = { study: { t: '学习记录', c: '#1a6d3a', ic: '✎' }, waiting: { t: '已联系·等回复', c: '#8a6d10', ic: '✉' }, no_reply: { t: '联系未回复', c: '#b8560b', ic: '✉' }, booked: { t: '已预约面谈', c: '#1a6d3a', ic: '✓' } };
const TM_GROUPS = [['done', '✓ 已完成'], ['pend', '⏳ 待面谈'], ['noreply', '✉ 已联系'], ['none', '⚠ 无面谈无记录']];
let tmYm = '';             // 当前查看的月份 YYYY-MM（空 = 本月）
let tmGroup = '';          // '' 全部 | done | pend | noreply | none
let tmExReason = '';       // 「不需频繁联系」里按原因筛选（空 = 全部）
let tmView = 'need';       // need 需要跟进 | exempt 不需频繁联系
let tmExpandedId = null;
const tmLogsAll = new Set();   // 联系记录「查看全部」展开的学生
const tmMtgOpen = new Set();   // 面谈记录展开的学生（默认收起）
function tmToggleLogsAll(id) { tmLogsAll.has(id) ? tmLogsAll.delete(id) : tmLogsAll.add(id); tmRenderList(); }
function tmToggleMtg(id) { tmMtgOpen.has(id) ? tmMtgOpen.delete(id) : tmMtgOpen.add(id); tmRenderList(); }
let tmData = null;         // { students, rec, pend, logs, cache }

// 「本月算完成」的口径（老师端面谈跟进、管理看板、任务完成情况共用）：有面谈记录，或有学习记录
function fuIsDone(mtgCount, studyCount) { return mtgCount > 0 || studyCount > 0; }
// 本月已完成的学生集合：bk = 本月有面谈记录的预约，logs = 本月的联系记录（只算「学习记录」）；返回 { ids, names }
function fuFollowedSets(bk, logs, ym) {
  const ids = new Set(), names = new Set();
  (bk || []).filter(tmHasRec).forEach(b => { if (b.student_id) ids.add(b.student_id); if (b.name) names.add(b.name); });
  (logs || []).filter(l => tmLogKind(l) === 'study' && (!ym || tmLogYm(l) === ym)).forEach(l => { if (l.student_id) ids.add(l.student_id); else if (l.student_name) names.add(l.student_name); });
  return { ids, names };
}
function tmPad2(n) { return String(n).padStart(2, '0'); }
function tmCurYm() { const d = new Date(); return d.getFullYear() + '-' + tmPad2(d.getMonth() + 1); }
function tmShiftYm(ym, n) { const p = ym.split('-').map(Number); const d = new Date(p[0], p[1] - 1 + n, 1); return d.getFullYear() + '-' + tmPad2(d.getMonth() + 1); }
function tmMonthWord() { return (tmYm || tmCurYm()) === tmCurYm() ? '本月' : parseInt(tmYm.slice(5), 10) + '月'; }
function tmJstYmd(iso) { return iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : ''; }
function tmHasRec(b) { return !!(b && b.daily_record && Object.values(b.daily_record).some(v => v && (typeof v === 'string' ? v : Object.values(v).some(x => x)))); }
function tmLogKind(l) { return l.kind === 'no_reply' ? 'no_reply' : l.kind === 'waiting' ? 'waiting' : l.kind === 'booked' ? 'booked' : 'study'; }
function tmWaitDays(l) { return Math.max(0, Math.floor((Date.now() - new Date(l.created_at || Date.now()).getTime()) / 86400e3)); }
function tmLogYm(l) { return l.for_month || tmJstYmd(l.created_at).slice(0, 7); }
// 记录在时间线上的位置（补记往月的记录，按那个月月底算，避免排在后面的面谈前面）
function tmLogKey(l) { const ym = tmLogYm(l), cd = tmJstYmd(l.created_at); return cd.slice(0, 7) === ym ? cd : ym + '-28'; }

// 读取面谈 / 预约 / 联系记录，按学生归档（面谈跟进、重点关注共用）；students = 已按可见范围过滤的学生
async function tmLoadFollow(students) {
  const [allBk, allPend, allLogs] = await Promise.all([
    sbAll('/rest/v1/bookings?daily_record=not.is.null&select=*&order=slot_date.desc,id.asc'),
    sbAll('/rest/v1/bookings?status=in.("pending","confirmed")&select=id,name,student_id,major,slot_date,slot_time_range,status,type,assigned_teacher,daily_record,created_at&order=id.asc'),
    sbAll('/rest/v1/student_contact_logs?select=*&order=created_at.desc,id.asc'),
  ]);
  // 按学生 id 归档；没绑定学生 id 的（新同学预约、旧记录）按姓名归档
  const idx = () => ({ id: {}, nm: {} });
  const put = (ix, row, name) => { if (row.student_id) (ix.id[row.student_id] = ix.id[row.student_id] || []).push(row); else (ix.nm[name] = ix.nm[name] || []).push(row); };
  const rec = idx(), pend = idx(), logs = idx();
  (allBk || []).forEach(b => { if (tmHasRec(b)) put(rec, b, b.name); });
  (allPend || []).forEach(b => { if (b.type !== 'vip' && !tmHasRec(b)) put(pend, b, b.name); });
  await tmAutoBooked(allLogs || [], (allPend || []).concat((allBk || []).filter(b => !(allPend || []).some(p => p.id === b.id))));
  (allLogs || []).forEach(l => put(logs, l, l.student_name));
  return { students, rec, pend, logs, cache: {} };
}

// 自动闭环：「已联系·等回复」之后学生预约了面谈（非 VIP、非已取消、预约创建晚于联系记录）→ 改成「已预约面谈」
async function tmAutoBooked(logs, bks) {
  const ok = bks.filter(b => b.type !== 'vip' && b.status !== 'cancelled' && b.created_at);
  for (const l of logs) {
    if (l.kind !== 'waiting' || !l.created_at) continue;
    const t0 = new Date(l.created_at).getTime();
    const hit = ok.filter(b => (l.student_id ? b.student_id === l.student_id : (!b.student_id && b.name === l.student_name)) && new Date(b.created_at).getTime() > t0)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
    if (!hit) continue;
    const md = String(hit.slot_date || '').slice(5).replace('-', '/'), tm = (String(hit.slot_time_range || '').match(/^\s*(\d{1,2}:\d{2})/) || [])[1] || String(hit.slot_time_range || '');
    const note = (l.note ? l.note + '\n' : '') + `→ 学生已预约面谈 ${md} ${tm}（系统自动记录）`.replace(/ +（/, '（');
    try {
      await sb(`/rest/v1/student_contact_logs?id=eq.${encodeURIComponent(l.id)}`, 'PATCH', { kind: 'booked', note });
      l.kind = 'booked'; l.note = note;
    } catch (e) { console.warn('自动闭环失败', l.id, e); }
  }
}

// 一个学生的全部面谈 / 预约 / 联系记录
function tmInfo(s, D) {
  D = D || tmData;
  const c = D.cache;
  if (c[s.id]) return c[s.id];
  const pick = ix => (ix.id[s.id] || []).concat(ix.nm[s.name] || []);
  return (c[s.id] = {
    recs: pick(D.rec).sort((a, b) => payrollInterviewPayDate(b).localeCompare(payrollInterviewPayDate(a))),   // 补填的按填写记录的日期排
    pend: pick(D.pend).sort((a, b) => (a.slot_date || '').localeCompare(b.slot_date || '')),
    logs: pick(D.logs).sort((a, b) => tmLogKey(b).localeCompare(tmLogKey(a))),
  });
}
// 某个月的状态：group = done | pend | noreply | none
function tmMonthState(info, ym) {
  const mtg = info.recs.filter(b => interviewListYm(b) === ym);   // 补填的算在填写记录的月份
  const inM = info.logs.filter(l => tmLogYm(l) === ym);
  const study = inM.filter(l => tmLogKind(l) === 'study'), nore = inM.filter(l => tmLogKind(l) === 'no_reply'), wait = inM.filter(l => tmLogKind(l) === 'waiting');
  const pend = info.pend.filter(b => (b.slot_date || '').slice(0, 7) === ym);
  const group = fuIsDone(mtg.length, study.length) ? 'done' : pend.length ? 'pend' : (nore.length || wait.length) ? 'noreply' : 'none';
  const cell = mtg.length ? 'mtg' : study.length ? 'study' : pend.length ? 'pend' : nore.length ? 'noreply' : wait.length ? 'wait' : '';
  return { group, cell, mtg, study, nore, wait, pend };
}
// 截至某月月底，连续几次联系未回复（中间有面谈 / 学习记录就清零）
function tmStreak(info, uptoYm) {   // uptoYm 为空 = 截至现在
  const ev = info.recs.map(b => ({ k: payrollInterviewPayDate(b), ok: true })).concat(info.logs.filter(l => tmLogKind(l) !== 'waiting').map(l => ({ k: tmLogKey(l), ok: tmLogKind(l) === 'study' || tmLogKind(l) === 'booked' })))
    .filter(e => e.k && (!uptoYm || e.k.slice(0, 7) <= uptoYm)).sort((a, b) => a.k.localeCompare(b.k) || (b.ok ? 1 : 0) - (a.ok ? 1 : 0));
  let n = 0;
  ev.forEach(e => { n = e.ok ? 0 : n + 1; });
  return n;
}
// 当前筛选下每个学生的本月分组
function tmRows() {
  const ym = tmYm || tmCurYm();
  return FU_HOST.filter(tmData.students || []).map(s => {
    const info = tmInfo(s), st0 = tmMonthState(info, ym), sk = tmStreak(info, ym);
    // 连续 3 次以上联系未回复：不再算「无面谈无记录」，归到「已联系」，用灰色标签显示
    const quiet = st0.group === 'none' && sk >= 3;
    const st = quiet ? Object.assign({}, st0, { group: 'noreply' }) : st0;
    return { s, info, st, quiet, ex: fuExempt(s), streak: st.nore.length ? sk : (quiet ? sk : 0) };
  });
}
// 「不需频繁联系」标签（students.follow_exempt，Sensis / 老师手动设置）
function fuExempt(s) { return !!(s && s.follow_exempt); }
// 当前筛选下「本月无面谈无记录」的学生（批量提醒用）：不含「不需频繁联系」和连续 3 次以上未回复的
function tmNoRecStudents() { return tmRows().filter(r => !r.ex && r.st.group === 'none').map(r => r.s); }

function tmRenderShell() {
  const box = FU_HOST.box();
  if (!box || !tmData) return;
  if (!tmYm) tmYm = tmCurYm();
  const cur = tmYm === tmCurYm();
  const arrow = (n, t) => `<span onclick="tmSetYm('${tmShiftYm(tmYm, n)}')" style="cursor:pointer;user-select:none;font-size:13px;padding:2px 10px;border:1px solid var(--border);border-radius:3px;background:var(--surface)">${t}</span>`;
  box.innerHTML = `${FU_HOST.top ? FU_HOST.top() : ''}
  <div class="page-header">
    <div class="section-title">面谈跟进 <span class="badge-count" id="tm_count"></span></div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px">
    ${arrow(-1, '‹')}<span style="font-size:13px;font-weight:600;min-width:92px;text-align:center">${tmYm.replace('-', '年')}月</span>${arrow(1, '›')}
    ${cur ? '' : `<span onclick="tmSetYm('${tmCurYm()}')" style="font-size:10px;color:var(--accent);cursor:pointer">回到本月</span>`}
    <span style="font-size:10px;color:var(--text-3)">每个学生每月至少一次面谈；没面谈的补「学习记录」或「联系未回复」</span>
    <button onclick="tmBatchReminder()" style="font-size:10px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:2px;padding:4px 12px;cursor:pointer;font-family:inherit;margin-left:auto">✉ 按专业批量生成提醒</button>
    <button onclick="tmContactModal('')" style="font-size:10px;background:#1a6d3a;color:#fff;border:none;border-radius:2px;padding:4px 12px;cursor:pointer;font-family:inherit">＋ 补充记录</button>
  </div>
  <div id="tm_chips" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px"></div>
  <div id="tm_list"></div>`;
  tmRenderList();
}
function tmSetYm(ym) { tmYm = ym; tmShown0(); tmRenderShell(); }
function tmShown0() { FU_HOST.reset(); }
function tmSetExReason(k) { tmExReason = k || ''; tmShown0(); tmRenderList(); }
function tmSetView(v) { tmView = v; tmShown0(); tmRenderList(); }
function tmSetGroup(g) { tmGroup = tmGroup === g ? '' : g; tmShown0(); tmRenderList(); }
function tmStuName(id) { const s = ((tmData && tmData.students) || []).find(x => x.id === id); return s ? s.name : ''; }
function tmToggle(id) { tmExpandedId = tmExpandedId === id ? null : id; tmRenderList(); }

// 近 6 个月小方格（每月一格）
function tmCellsHtml(info, endYm) {
  const ym = endYm || tmYm || tmCurYm(), out = [];
  const sty = { mtg: ['✓', '#1a6d3a', '#e4f3ea', '面谈'], study: ['✎', '#1a6d3a', '#e4f3ea', '学习记录'], noreply: ['✉', '#b8560b', '#fbeee0', '联系未回复'], wait: ['✉', '#8a6d10', '#fef5e0', '已联系·等回复'], pend: ['⏳', '#8a6d10', '#fef5e0', '待面谈'] };
  for (let i = 5; i >= 0; i--) {
    const m = tmShiftYm(ym, -i), c = tmMonthState(info, m).cell, d = sty[c];
    out.push(`<span title="${m.replace('-', '年')}月：${d ? d[3] : '无面谈无记录'}" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:3px;font-size:10px;border:1px solid ${d ? d[1] : 'var(--border)'};background:${d ? d[2] : 'transparent'};color:${d ? d[1] : 'transparent'}">${d ? d[0] : '·'}</span>`);
  }
  return `<span style="display:inline-flex;gap:3px;align-items:center">${out.join('')}</span>`;
}
function tmStateTag(r) {
  const st = r.st, tag = (c, bg, t) => `<span style="font-size:10px;padding:1px 8px;border-radius:10px;background:${bg};color:${c};white-space:nowrap">${t}</span>`;
  if (r.quiet) return tag('#666', '#eeeeee', `连续 ${r.streak} 次未回复`);
  if (st.group === 'done') return st.mtg.length ? tag('#1a6d3a', '#e4f3ea', `✓ 已面谈${st.mtg.length > 1 ? ' ' + st.mtg.length + ' 次' : ''}`) : tag('#1a6d3a', '#e4f3ea', '✎ 学习记录');
  if (st.group === 'pend') { const b = st.pend[0]; return tag('#8a6d10', '#fef5e0', `⏳ 待面谈 ${fuEsc((b.slot_date || '').slice(5))} ${fuEsc(b.slot_time_range || '')}`); }
  if (st.group === 'noreply') {
    const out = [];
    if (st.wait.length) { const d = Math.max(...st.wait.map(tmWaitDays)); out.push(tag('#8a6d10', '#fef5e0', `等回复 · 已等 ${d} 天`)); if (d > 3) out.push(tag('#b8560b', '#fbeee0', '请确认回复情况')); }
    if (st.nore.length) out.push(r.streak >= 3 ? tag('#c0392b', '#fdecea', `⚠ 未回复 · 已连续 ${r.streak} 次 → 已转重点关注`) : tag('#b8560b', '#fbeee0', `未回复 · 连续第 ${r.streak} 次`));
    return out.join(' ');
  }
  return tag('#c0392b', '#fdecea', `⚠ ${tmMonthWord()}无面谈无记录`);
}

function tmRenderList() {
  const listBox = document.getElementById('tm_list'), chipBox = document.getElementById('tm_chips');
  if (!listBox || !tmData) return;
  const need = FU_HOST.need ? FU_HOST.need() : '';   // 管理端：还没选范围时不列学生
  if (need) { if (chipBox) chipBox.innerHTML = ''; const c1 = document.getElementById('tm_count'); if (c1) c1.textContent = ''; listBox.innerHTML = need; return; }
  const allRows = tmRows(), nEx = allRows.filter(r => r.ex).length;
  if (tmView === 'exempt' && !nEx) tmView = 'need';
  const exView = tmView === 'exempt';
  const exRows = allRows.filter(r => r.ex), reasons = {};
  exRows.forEach(r => { const k = fuReasonOf(r.s) || '（没写原因）'; reasons[k] = (reasons[k] || 0) + 1; });
  if (tmExReason && !reasons[tmExReason]) tmExReason = '';
  const all = allRows.filter(r => exView ? (r.ex && (!tmExReason || (fuReasonOf(r.s) || '（没写原因）') === tmExReason)) : !r.ex);
  const cnt = g => all.filter(r => r.st.group === g).length;
  const w = tmMonthWord();
  const vchip = (k, l) => `<div class="filter-chip ${tmView === k ? 'active' : ''}" onclick="tmSetView('${k}')" style="padding:3px 10px;font-size:10px">${l}</div>`;
  const viewChips = vchip('need', '需要跟进') + vchip('exempt', '不需频繁联系 ' + nEx) + '<span style="width:1px;height:14px;background:var(--border);margin:0 4px"></span>';
  const rchip = (k, l) => `<div class="filter-chip ${tmExReason === k ? 'active' : ''}" onclick="tmSetExReason(this.dataset.k)" data-k="${fuEsc(k)}" style="padding:3px 10px;font-size:10px">${fuEsc(l)}</div>`;
  const reasonChips = '<span style="font-size:10px;color:var(--text-3)">原因：</span>' + rchip('', '全部 ' + nEx) + Object.keys(reasons).map(k => rchip(k, k + ' ' + reasons[k])).join('');
  if (chipBox) chipBox.innerHTML = viewChips + (exView ? reasonChips : '<span style="font-size:10px;color:var(--text-3)">分组：</span>' + TM_GROUPS.map(([k, l]) => `<div class="filter-chip ${tmGroup === k ? 'active' : ''}" onclick="tmSetGroup('${k}')" style="padding:3px 10px;font-size:10px">${l.replace(/^(\S+) /, '$1 ' + w)} ${cnt(k)}</div>`).join(''));
  const ord = { done: 0, pend: 1, noreply: 2, none: 3 };
  const list = all.filter(r => exView || !tmGroup || r.st.group === tmGroup).sort((a, b) => (ord[a.st.group] - ord[b.st.group]) || (b.streak - a.streak) || a.s.name.localeCompare(b.s.name, 'zh'));
  const c0 = document.getElementById('tm_count'); if (c0) c0.textContent = list.length;
  if (!list.length) { listBox.innerHTML = `<div class="empty">${fuEmptyText('没有符合筛选条件的学生')}</div>`; return; }
  let lastG = '';
  listBox.innerHTML = FU_HOST.slice(list).map(r => {
    const s = r.s, open = tmExpandedId === s.id, lastM = r.info.recs[0] ? payrollInterviewPayDate(r.info.recs[0]) : '';
    let head = '';
    if (!exView && !tmGroup && r.st.group !== lastG) { lastG = r.st.group; const t = TM_GROUPS.find(x => x[0] === lastG)[1].replace(/^(\S+) /, '$1 ' + w); head = `<div style="font-size:11px;font-weight:600;color:var(--text-2);margin:12px 0 6px">${t}（${cnt(lastG)}）</div>`; }
    return head + `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden;margin-bottom:6px">
      <div onclick="tmToggle('${s.id}')" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 14px;cursor:pointer;${open ? 'background:var(--bg)' : ''}">
        <span style="font-size:13px;font-weight:600">${fuEsc(s.name)}</span>
        <span onclick="event.stopPropagation();copyNameText(tmStuName('${s.id}'),this)" style="font-size:10px;border:1px solid var(--border);border-radius:3px;padding:1px 7px;cursor:pointer;background:var(--surface);color:var(--text-2)">📋 姓名</span>
        <span onclick="event.stopPropagation();tmGenReminder('${s.id}')" style="font-size:10px;border:1px solid var(--border);border-radius:3px;padding:1px 7px;cursor:pointer;background:var(--surface);color:var(--text-2)">✉ 联络文字</span>
        <span style="font-size:11px;color:var(--text-3)">${fuEsc(MAJORS[s.major] || s.major || '')}</span>
        ${exView ? '' : tmStateTag(r)}
        ${r.ex ? '<span style="font-size:10px;padding:1px 8px;border-radius:10px;background:#eeeeee;color:#666;white-space:nowrap">不需频繁联系</span>' : ''}
        <span style="font-size:10px;color:var(--text-3);margin-left:auto">${lastM ? '最近面谈 ' + fuEsc(lastM) : '从未面谈'}</span>
        ${tmCellsHtml(r.info)}
        <span style="font-size:10px;color:var(--text-3)">${open ? '▲' : '▼'}</span>
      </div>
      ${exView ? tmExemptLine(s, r.info) : ''}
      ${open ? tmDetailHtml(s, r.info) : ''}
    </div>`;
  }).join('') + FU_HOST.more(list.length);
}

// 「不需频繁联系」的原因 / 备注：follow_exempt_note 存成「原因｜备注」，没有备注时只有原因
function fuReasonOf(s) { return String((s && s.follow_exempt_note) || '').split('｜')[0].trim(); }
function fuMemoOf(s) { const n = String((s && s.follow_exempt_note) || ''), i = n.indexOf('｜'); return i < 0 ? '' : n.slice(i + 1).trim(); }
// 「不需频繁联系」列表里每个学生下面的一行：原因 / 备注 / 谁设的 / 什么时候 / 最近一次面谈或联系
function tmExemptLine(s, info) {
  const lastM = info.recs[0] ? payrollInterviewPayDate(info.recs[0]) : '', lastL = info.logs[0] ? tmLogKey(info.logs[0]) : '';
  const memo = fuMemoOf(s);
  return `<div style="padding:6px 14px 8px;border-top:1px solid var(--border-light);font-size:11px;color:var(--text-2);line-height:1.7">
    <div>原因：${fuEsc(fuReasonOf(s) || '（没写原因）')}${memo ? ' · 备注：' + fuEsc(memo) : ''}</div>
    <div style="font-size:10px;color:var(--text-3)">${fuEsc(s.follow_exempt_by || '')} 设置于 ${fuEsc(tmJstYmd(s.follow_exempt_at))} · 最近面谈 ${fuEsc(lastM) || '无'} · 最近联系 ${fuEsc(lastL) || '无'}</div>
  </div>`;
}
let fuExemptChipList = [];
// 快捷原因：只放以前自己填过的（去重，最近用的排前，最多 8 个）；没填过就不显示
function fuExemptHistory() {
  const pool = [].concat((tmData && tmData.students) || [], typeof cachedStudents !== 'undefined' ? cachedStudents || [] : []);
  const seen = new Set(), out = [];
  pool.filter(s => fuReasonOf(s)).sort((a, b) => String(b.follow_exempt_at || '').localeCompare(String(a.follow_exempt_at || ''))).forEach(s => {
    const r = fuReasonOf(s); if (!seen.has(r) && out.length < 8) { seen.add(r); out.push(r); }
  });
  return out;
}
function tmExemptClick(id) {
  const s = ((tmData && tmData.students) || []).find(x => x.id === id);
  if (!s) return;
  if (fuExempt(s)) { fuExemptRestore(s); return; }
  fuExemptModal(s, false);
}
function tmExemptEdit(id) { const s = ((tmData && tmData.students) || []).find(x => x.id === id); if (s) fuExemptModal(s, true); }
function fuExemptModal(s, edit) {
  fuExemptChipList = fuExemptHistory();
  const old = document.getElementById('fuExemptModal'); if (old) old.remove();
  const o = document.createElement('div');
  o.id = 'fuExemptModal';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  const inp = 'width:100%;box-sizing:border-box;font-size:12px;font-family:inherit;padding:6px 8px;border:1px solid var(--border);border-radius:3px';
  o.innerHTML = `<div style="background:var(--surface,#fff);border-radius:6px;padding:16px 18px;width:100%;max-width:400px">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">${edit ? '修改原因' : '不需频繁联系'} · ${fuEsc(s.name)}</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">原因（必填，直接写）</div>
    <input id="fuExemptReason" value="${fuEsc(edit ? fuReasonOf(s) : '')}" placeholder="例如：已拿到内定，等手续" style="${inp};margin-bottom:6px">
    <div style="display:${fuExemptChipList.length ? 'flex' : 'none'};flex-wrap:wrap;gap:6px;margin-bottom:10px">${fuExemptChipList.map((r, i) => `<div class="filter-chip" onclick="document.getElementById('fuExemptReason').value=fuExemptChipList[${i}]" style="padding:3px 10px;font-size:11px;cursor:pointer">${fuEsc(r)}</div>`).join('')}</div>
    <textarea id="fuExemptNote" rows="3" placeholder="备注（选填）" style="${inp}">${fuEsc(edit ? fuMemoOf(s) : '')}</textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button onclick="document.getElementById('fuExemptModal').remove()" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:4px 14px;cursor:pointer;font-family:inherit">取消</button>
      <button id="fuExemptOk" onclick="fuExemptSave('${s.id}',${edit ? 'true' : 'false'})" style="font-size:11px;background:#1a6d3a;color:#fff;border:none;border-radius:3px;padding:4px 16px;cursor:pointer;font-family:inherit">确定</button>
    </div></div>`;
  document.body.appendChild(o);
}
async function fuExemptSave(id, edit) {
  const s = ((tmData && tmData.students) || []).find(x => x.id === id);
  if (!s) return;
  const reason = (document.getElementById('fuExemptReason').value || '').trim().replace(/｜/g, '|');
  const memo = (document.getElementById('fuExemptNote').value || '').trim();
  if (!reason) { alert('请填写原因'); return; }
  const note = reason + (memo ? '｜' + memo : '');
  const btn = document.getElementById('fuExemptOk'); if (btn) btn.disabled = true;
  const patch = edit ? { follow_exempt_note: note } : { follow_exempt: true, follow_exempt_note: note, follow_exempt_by: fuMe(), follow_exempt_at: new Date().toISOString() };
  try {
    await sb(`/rest/v1/students?id=eq.${encodeURIComponent(id)}`, 'PATCH', patch);
  } catch (e) { if (btn) btn.disabled = false; alert('保存失败：' + (e.message || e) + '\n（如果提示找不到字段，请先执行 follow_exempt 的 SQL）'); return; }
  fuExemptApply(s, patch);
  document.getElementById('fuExemptModal').remove();
  tmRenderList();
}
async function fuExemptRestore(s) {
  if (!confirm(`把「${s.name}」恢复为每月跟进？（之前的原因记录会保留）`)) return;
  try { await sb(`/rest/v1/students?id=eq.${encodeURIComponent(s.id)}`, 'PATCH', { follow_exempt: false }); }
  catch (e) { alert('恢复失败：' + (e.message || e)); return; }
  fuExemptApply(s, { follow_exempt: false });
  tmRenderList();
}
// 同步内存里的学生对象（面谈跟进 / 管理端缓存）
function fuExemptApply(s, patch) {
  Object.assign(s, patch);
  if (typeof cachedStudents !== 'undefined') (cachedStudents || []).forEach(x => { if (x.id === s.id) Object.assign(x, patch); });
}

function tmDetailHtml(s, info) {
  const me = fuMe();
  const sub = (title, inner, btn) => `<div style="margin-bottom:12px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:11px;font-weight:600;color:var(--text-2)">${title}</span>${btn || ''}</div>${inner}</div>`;
  const mtg = info.recs.length ? info.recs.map(b => `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px;margin-bottom:6px">
      <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">${fuEsc(b.slot_date)}${b.slot_time_range ? ' ' + fuEsc(b.slot_time_range) : ''}${b.actual_duration ? ' · ' + fuEsc(b.actual_duration) + 'min' : ''}${b.assigned_teacher ? ' · ' + fuEsc(b.assigned_teacher) + '老师' : ''}${b.type ? ' · ' + fuEsc(typeLabel(b.type)) : ''}${interviewLateNote(b) ? ' · ' + fuEsc(interviewLateNote(b)) : ''}</div>
      <pre style="font-size:11px;line-height:1.8;white-space:pre-wrap;font-family:inherit;margin:0;color:var(--text-2)">${fuEsc(buildRecordText(b))}</pre></div>`).join('')
    : '<div style="font-size:11px;color:var(--text-3)">还没有面谈记录</div>';
  // 联系记录：「等回复」排最前，其余新的在上（created_at 倒序）；超过 5 条先只显示最近 5 条
  const logsSorted = info.logs.slice().sort((a, b) => ((tmLogKind(b) === 'waiting') - (tmLogKind(a) === 'waiting')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const logsAll = tmLogsAll.has(s.id), logsShown = logsAll ? logsSorted : logsSorted.slice(0, 5);
  const logs = info.logs.length ? logsShown.map(l => {
    const kd = tmLogKind(l), k = TM_KIND[kd], mine = l.teacher_name === me || me === FU_ADMIN_NAME;
    const kindTxt = kd === 'waiting' ? `${k.t} · 已等 ${tmWaitDays(l)} 天` : kd === 'booked' ? `已预约面谈 · ${((l.note || '').match(/预约面谈 (\S+ \S+?)（/) || [])[1] || ''}`.replace(/ · $/, '') : k.t;
    const acts = kd === 'waiting'
      ? `<span style="flex-shrink:0;display:flex;flex-direction:column;gap:4px;align-items:stretch"><button onclick="tmResolveModal('${l.id}','study')" style="font-size:10px;background:#1a6d3a;color:#fff;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit;white-space:nowrap">学生已回复 → 填学习记录</button><button onclick="tmResolveModal('${l.id}','no_reply')" style="font-size:10px;background:none;color:#b8560b;border:1px solid #b8560b;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit;white-space:nowrap">仍未回复 → 记为未回复</button>${mine ? `<span onclick="tmDeleteContact('${l.id}')" style="color:var(--danger);cursor:pointer;font-size:9px;text-align:right">删除</span>` : ''}</span>`
      : kd === 'booked' ? (mine ? `<span style="flex-shrink:0;font-size:9px;white-space:nowrap"><span onclick="tmDeleteContact('${l.id}')" style="color:var(--danger);cursor:pointer">删除</span></span>` : '')
      : mine ? `<span style="flex-shrink:0;font-size:9px;white-space:nowrap"><span onclick="tmFlipKind('${l.id}')" style="color:var(--accent);cursor:pointer">改为${kd === 'study' ? '未回复' : '学习记录'}</span> <span onclick="tmDeleteContact('${l.id}')" style="color:var(--danger);cursor:pointer;margin-left:6px">删除</span></span>` : '';
    return `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px ${kd === 'waiting' ? '8px' : '0'};border-top:1px solid var(--border-light);${kd === 'waiting' ? 'background:#fef5e0;border-radius:3px' : ''}">
      ${l.image_url ? `<img src="${fuEsc(l.image_url)}" onclick="tmImgLightbox('${fuEsc(l.image_url)}')" style="flex-shrink:0;width:52px;height:52px;object-fit:cover;border-radius:4px;border:1px solid var(--border);cursor:zoom-in">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;margin-bottom:2px"><span style="color:var(--text-3)">${fuEsc(tmLogYm(l))}</span> <span style="color:${k.c};border:1px solid ${k.c};border-radius:2px;padding:0 5px">${k.ic} ${kindTxt}</span></div>
        <div style="font-size:11px;white-space:pre-wrap;line-height:1.5">${fuEsc(l.note) || '（无内容）'}</div>
        <div style="font-size:9px;color:var(--text-3);margin-top:3px">${fuEsc(l.teacher_name || '')} · ${fuEsc(tmJstYmd(l.created_at))}</div>
      </div>
      ${acts}
    </div>`;
  }).join('') + (logsSorted.length > 5 ? `<div onclick="tmToggleLogsAll('${s.id}')" style="font-size:11px;color:var(--accent);cursor:pointer;padding:6px 0;text-align:center;border-top:1px solid var(--border-light)">${logsAll ? '只看最近 5 条 ▴' : `查看全部 ${logsSorted.length} 条 ▾`}</div>` : '') : '<div style="font-size:11px;color:var(--text-3)">还没有学习记录 / 联系记录</div>';
  const from = (tmYm || tmCurYm()) + '-01';
  const pend = info.pend.filter(b => (b.slot_date || '') >= from);
  const pendHtml = pend.length ? pend.map(b => `<div style="font-size:11px;padding:4px 0;border-top:1px solid var(--border-light)">${fuEsc(b.slot_date)} ${fuEsc(b.slot_time_range || '')} · ${b.status === 'confirmed' ? '已确认' : '待确认'}${b.assigned_teacher ? ' · ' + fuEsc(b.assigned_teacher) + '老师' : ''}</div>`).join('') : '<div style="font-size:11px;color:var(--text-3)">没有待进行的预约</div>';
  const add = `<button onclick="tmContactModal('${s.id}')" style="margin-left:auto;font-size:10px;background:#1a6d3a;color:#fff;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit">＋ 补充记录</button>`;
  const lk = 'color:var(--accent);cursor:pointer;margin-left:8px';
  const exBox = `<div style="border-top:1px solid var(--border-light);padding-top:8px;margin-top:6px;font-size:10px;color:var(--text-3)">${fuExempt(s)
    ? `不需频繁联系 · ${fuEsc(fuReasonOf(s) || '（没写原因）')}${fuMemoOf(s) ? '（' + fuEsc(fuMemoOf(s)) + '）' : ''} · ${fuEsc(s.follow_exempt_by || '')} ${fuEsc(tmJstYmd(s.follow_exempt_at))}<span onclick="tmExemptEdit('${s.id}')" style="${lk}">修改原因</span><span onclick="tmExemptClick('${s.id}')" style="${lk}">恢复每月跟进</span>`
    : `<span onclick="tmExemptClick('${s.id}')" style="cursor:pointer;text-decoration:underline">设为不需频繁联系…</span>`}</div>`;
  const mtgOpen = tmMtgOpen.has(s.id), lastM = info.recs[0] ? payrollInterviewPayDate(info.recs[0]) : '';
  const thisM = info.recs.some(b => interviewListYm(b) === tmCurYm());
  const lastTxt = lastM ? ' · 最近一次 ' + parseInt(lastM.slice(5, 7), 10) + '/' + parseInt(lastM.slice(8, 10), 10) : '';
  const mtgBox = `<div style="margin-bottom:4px"><div onclick="tmToggleMtg('${s.id}')" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px"><span>面谈记录（${info.recs.length} 次）${lastTxt} ${mtgOpen ? '▾' : '▸'}</span>${thisM ? '<span style="font-size:10px;font-weight:400;padding:0 7px;border-radius:10px;background:#e4f3ea;color:#1a6d3a">本月已面谈</span>' : ''}</div>${mtgOpen ? mtg : ''}</div>`;
  return `<div style="border-top:1px solid var(--border-light);background:var(--bg);padding:10px 14px">
    ${sub(`学习记录 / 联系记录（${info.logs.length}）`, logs, add)}
    ${sub(`预约（${tmMonthWord() === '本月' ? '本月' : tmYm.replace('-', '年') + '月'}及以后）`, pendHtml)}
    ${mtgBox}
    ${exBox}
  </div>`;
}

// 批量提醒：当前筛选下「无面谈记录」的学生。两种模式（chip 切换）：
//   逐人（默认，含查询码）：每人一段文案 B，各自复制
//   按专业群发（不含查询码）：每个专业一段通用文字 —— 群发文字里绝不能带查询码
let tmBatchMode = 'each';
let tmBatchCache = null;   // 逐人模式生成的文字（避免切换模式时重复生成查询码）
async function tmBatchReminder() {
  const noRec = tmNoRecStudents();
  if (!noRec.length) { alert('当前筛选范围内没有「无面谈记录」的学生'); return; }
  tmBatchMode = 'each';
  tmBatchCache = null;
  STUDENT_TEXT_HOOKS.tmbe = i => { const e = tmBatchCache && tmBatchCache[i]; if (e) tmMarkWaiting(e.id); };
  studentTextModal('tmBatchModal', `✉ 批量面谈提醒（共 ${noRec.length} 人未面谈）`, '');
  await tmBatchRender(noRec);
}
async function tmBatchRender(noRec) {
  noRec = noRec || tmNoRecStudents();
  const body = document.getElementById('tmBatchModal_body');
  if (!body) return;
  const chip = (k, l) => `<div class="filter-chip ${tmBatchMode === k ? 'active' : ''}" onclick="tmBatchMode='${k}';tmBatchRender()" style="padding:3px 12px;font-size:11px;cursor:pointer">${l}</div>`;
  const head = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${chip('each', '逐人（含查询码）')}${chip('group', '按专业群发（不含查询码）')}</div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">${tmBatchMode === 'each' ? '每人一段，只含本人的查询码，请逐个私信发送；复制后会标「✓ 已复制」。' : '可以发到专业群里；群发文字不含查询码，登录查询码请另外私信学生。'}</div>`;
  if (tmBatchMode === 'group') {
    const byMajor = {};
    noRec.forEach(s => { const m = (s.major || '') + (isPureVipStudent(s) ? '|vip' : ''); (byMajor[m] = byMajor[m] || []).push(s.name); });   // 纯 VIP 单独一组（链接不同）
    const entries = Object.entries(byMajor).map(([mk, names]) => {
      const vip = mk.endsWith('|vip'), m = vip ? mk.slice(0, -4) : mk;
      return {
      name: `${MAJORS[m] || m || '未设专业'}${vip ? ' · 纯VIP' : ''}（${names.length}人未面谈）`,
      sub: names.join('、'),
      text: `同学，你最近都一直没有预约面谈，学习上有什么问题吗？麻烦预约一下面谈噢。\n预约链接：${studentPortalLink({ is_vip_course: vip ? 'VIP' : '' }, { tab: 'reserve' })}\n登录查询码请查看老师私信，请妥善保存。`,
    }; });
    body.innerHTML = head + studentTextBlocksHtml(entries, 'tmbg');
    return;
  }
  if (tmBatchCache) { body.innerHTML = head + studentTextBlocksHtml(tmBatchCache, 'tmbe'); return; }
  body.innerHTML = head + '<div id="tmBatchEach"></div>';
  const entries = await studentTextBatch(noRec, 'reminder', document.getElementById('tmBatchEach'), 'tmbe', null, true);
  tmBatchCache = entries;
  if (tmBatchMode !== 'each') return;   // 生成期间切到了群发模式
  body.innerHTML = head + studentTextBlocksHtml(entries, 'tmbe');
}

// 单人面谈提醒（文案 B，含本人查询码；没有查询码时先自动生成），弹窗显示并自动复制
async function tmGenReminder(id) {
  let st = ((tmData && tmData.students) || []).find(x => x.id === id);
  if (!st && id) st = ((await sb(`/rest/v1/students?id=eq.${encodeURIComponent(id)}&select=id,name,major,student_code,is_vip_course`).catch(() => [])) || [])[0];
  if (!st) { alert('找不到该学生档案'); return; }
  const body = studentTextModal('tmReminderModal', `✉ 面谈提醒 · ${fuEsc(st.name)}`, '<div style="font-size:12px;color:var(--text-3);padding:12px">正在准备…</div>');
  const had = !!st.student_code;
  const r = await ensureStudentCode(st);
  STUDENT_TEXT_HOOKS.tmr = () => tmMarkWaiting(st.id);
  body.innerHTML = studentTextBlocksHtml([{ name: st.name, sub: (!had && r.code) ? '已自动生成查询码' : '', text: bookingReminderText(st, r.code), error: r.error, copyName: true }], 'tmr');
}

// 点「复制文字」后自动记「已联系·等回复」：同一学生同一月份已有 waiting 就只更新时间
async function tmMarkWaiting(sid) {
  const s = ((tmData && tmData.students) || []).find(x => x.id === sid);
  if (!s || !tmData) return;
  const ym = tmYm || tmCurYm(), d = new Date(), p = tmPad2;
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const note = `已发送面谈提醒（${stamp}）`;
  try {
    const old = tmInfo(s).logs.find(l => tmLogKind(l) === 'waiting' && tmLogYm(l) === ym);
    if (old) {
      const now = new Date().toISOString();
      await sb(`/rest/v1/student_contact_logs?id=eq.${encodeURIComponent(old.id)}`, 'PATCH', { note, created_at: now });
      old.note = note; old.created_at = now;
    } else {
      const row = { id: 'sclog-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5), student_id: s.id, student_name: s.name, major: s.major || '',
        teacher_name: fuMe(), note, image_url: null, kind: 'waiting', for_month: ym };
      await sb('/rest/v1/student_contact_logs', 'POST', [row]);
      row.created_at = new Date().toISOString();
      (tmData.logs.id[s.id] = tmData.logs.id[s.id] || []).push(row);
    }
    tmData.cache = {};
    tmRenderList();
  } catch (e) { alert('复制成功，但记录「已联系·等回复」失败：' + e.message); }
}


// ── 补充记录（学习记录 / 联系未回复；备注 + 可选截图，支持 Ctrl+V 粘贴）──
let tmPendingImg = null; // 待上传的截图（已压缩）

async function tmCompressImg(file, maxSide, quality) {
  if (!/^image\//.test(file.type)) return file;
  if (file.size <= 300 * 1024) return file;
  try {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { bmp = await createImageBitmap(file); }
    const scale = Math.min(1, (maxSide || 1400) / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality || 0.8));
    if (!blob) return file;
    return new File([blob], 'shot.jpg', { type: 'image/jpeg' });
  } catch (e) { return file; }
}

// 补充记录弹窗：选学生（姓名搜索 / 先选专业再点名字）→ 类型 → 算哪个月 → 内容 → 截图
let tmAdd = null;   // { sid, fixed, kind, major }
function tmContactModal(sid) {
  if (!tmData) return;
  tmPendingImg = null;
  tmAdd = { sid: sid || '', fixed: !!sid, kind: 'study', major: '' };
  const ex = document.getElementById('tmContactModal'); if (ex) ex.remove();
  const m = document.createElement('div');
  m.id = 'tmContactModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:18px;max-width:460px;width:100%;max-height:90vh;overflow-y:auto">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">＋ 补充记录</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:12px">没有面谈的学生在这里补充记录：补充学习情况、和学生的互动等记「学习记录」（算该月完成）；已联系、在等学生回复记「已联系·等回复」；确认学生没有回复记「联系未回复」（连续 3 次转重点关注）。</div>
      <div class="form-group"><label class="form-label">学生</label><div id="tma_stu"></div></div>
      <div class="form-group"><label class="form-label">类型</label><div id="tma_kind" style="display:flex;gap:6px;flex-wrap:wrap"></div></div>
      <div class="form-group"><label class="form-label">算哪个月</label>
        <input type="month" id="tma_ym" value="${fuEsc(tmYm || tmCurYm())}" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit"></div>
      <div class="form-group"><label class="form-label" id="tma_note_lb">内容</label>
        <textarea id="tm_contact_note" rows="4" onpaste="tmHandlePaste(event)" style="width:100%;font-size:12px"></textarea></div>
      <div class="form-group">
        <label class="form-label">截图（可选，Ctrl+V 粘贴或选择文件）</label>
        <input type="file" id="tm_contact_file" accept="image/*" onchange="tmPickFile(event)" style="font-size:11px">
        <div id="tm_contact_preview" style="margin-top:8px"></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
        <button onclick="document.getElementById('tmContactModal').remove()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">取消</button>
        <button id="tm_contact_save" onclick="tmSaveContact()" style="font-size:12px;background:#1a6d3a;color:#fff;border:none;border-radius:3px;padding:7px 16px;cursor:pointer;font-family:inherit;font-weight:500">保存</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  tmAddRender();
}
function tmAddRender() {
  const stu = document.getElementById('tma_stu'); if (!stu || !tmAdd) return;
  const inp = 'font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit';
  const s = tmAdd.sid && (tmData.students || []).find(x => x.id === tmAdd.sid);
  if (s) {
    stu.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;font-size:12px;padding:4px 10px;border-radius:12px;background:var(--accent);color:#fff">${fuEsc(s.name)} · ${fuEsc(MAJORS[s.major] || s.major || '')}${tmAdd.fixed ? '' : ` <span onclick="tmAdd.sid='';tmAddRender()" style="cursor:pointer">✕</span>`}</span>`;
  } else {
    const majors = [...new Set((tmData.students || []).map(x => x.major).filter(Boolean))];
    stu.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
        <input id="tma_q" placeholder="输入姓名（汉字 / 拼音首字母）" oninput="searchBox(this,tmAddSearch)" style="${inp};flex:1;min-width:150px">
        <select id="tma_major" onchange="tmAdd.major=this.value;tmAddSearch()" style="${inp}"><option value="">先选专业…</option>${majors.map(k => `<option value="${fuEsc(k)}" ${tmAdd.major === k ? 'selected' : ''}>${fuEsc(MAJORS[k] || k)}</option>`).join('')}</select>
      </div><div id="tma_res"></div>`;
    tmAddSearch();
  }
  const kb = document.getElementById('tma_kind');
  if (kb) kb.innerHTML = Object.entries({ study: '学习记录（补充学习情况，和学生的互动等）', waiting: '已联系·等回复', no_reply: '联系未回复' }).map(([k, l]) => `<div class="filter-chip ${tmAdd.kind === k ? 'active' : ''}" onclick="tmAdd.kind='${k}';tmAddRender()" style="padding:4px 12px;font-size:11px">${l}</div>`).join('');
  const lb = document.getElementById('tma_note_lb');
  if (lb) lb.textContent = tmAdd.kind === 'study' ? '内容（必填：学习情况、作业、互动内容等）' : '内容（可选：联系方式、时间）';
}
function tmAddSearch() {
  const box = document.getElementById('tma_res'); if (!box || !tmAdd) return;
  const q = ((document.getElementById('tma_q') || {}).value || '').trim();
  if (!q && !tmAdd.major) { box.innerHTML = '<div style="font-size:10px;color:var(--text-3)">输入姓名搜索，或先选专业再点名字</div>'; return; }
  const list = (tmData.students || []).filter(s => (!tmAdd.major || s.major === tmAdd.major) && (!q || searchMatch(q, studentSearchFields(s)))).slice(0, 40);
  box.innerHTML = list.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px;max-height:130px;overflow-y:auto">${list.map(s => `<div class="filter-chip" onclick="tmAdd.sid='${s.id}';tmAddRender()" style="padding:3px 10px;font-size:11px">${fuEsc(s.name)}</div>`).join('')}</div>` : '<div style="font-size:10px;color:var(--text-3)">范围内没有匹配的学生</div>';
}

async function tmHandlePaste(e) {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.type && it.type.indexOf('image') === 0) {
      e.preventDefault();
      const f = it.getAsFile();
      if (f) await tmSetImg(f);
      return;
    }
  }
}
async function tmPickFile(e) {
  const f = e.target.files && e.target.files[0];
  if (f) await tmSetImg(f);
}
async function tmSetImg(file) {
  tmPendingImg = await tmCompressImg(file);
  const prev = document.getElementById('tm_contact_preview');
  if (prev) {
    const url = URL.createObjectURL(tmPendingImg);
    prev.innerHTML = `<div style="display:inline-flex;align-items:center;gap:8px"><img src="${url}" style="max-width:160px;max-height:120px;border-radius:4px;border:1px solid var(--border)"><span onclick="tmPendingImg=null;document.getElementById('tm_contact_preview').innerHTML='';document.getElementById('tm_contact_file').value=''" style="font-size:10px;color:var(--danger);cursor:pointer">移除</span></div>`;
  }
}

async function tmSaveContact() {
  const s = tmAdd && (tmData.students || []).find(x => x.id === tmAdd.sid);
  if (!s) { alert('请先选择学生'); return; }
  const note = (document.getElementById('tm_contact_note').value || '').trim();
  const ym = (document.getElementById('tma_ym').value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) { alert('请选择算哪个月'); return; }
  if (tmAdd.kind === 'study' && !note) { alert('学习记录请填写内容（学习进度、近况）'); return; }
  const btn = document.getElementById('tm_contact_save');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  let imageUrl = '';
  try {
    if (tmPendingImg) imageUrl = await sbUpload('teacher-files', `contact/${s.id}-${Date.now()}.jpg`, tmPendingImg);
    const row = {
      id: 'sclog-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      student_id: s.id, student_name: s.name, major: s.major || '',
      teacher_name: fuMe(),
      note, image_url: imageUrl || null, kind: tmAdd.kind, for_month: ym,
    };
    await sb('/rest/v1/student_contact_logs', 'POST', [row]);
    document.getElementById('tmContactModal')?.remove();
    // 不整页重读：直接加进内存，保持当前学生展开、不跳回顶部
    row.created_at = new Date().toISOString();
    if (tmData) { (tmData.logs.id[s.id] = tmData.logs.id[s.id] || []).push(row); tmData.cache = {}; }
    if (tmYm !== ym) { tmYm = ym; tmShown0(); tmRenderShell(); } else tmRenderList();   // 跳到刚记录的那个月，立刻能看到它出现在哪一组
    tmExpandedId = s.id;
    tmRenderList();
  } catch (e) {
    alert('保存失败：' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}

function tmFindLog(id) {
  let hit = null;
  [tmData.logs.id, tmData.logs.nm].forEach(ix => Object.values(ix).forEach(arr => arr.forEach(l => { if (l.id === id) hit = l; })));
  return hit;
}
async function tmFlipKind(id) {
  const l = tmFindLog(id); if (!l || tmLogKind(l) === 'waiting' || tmLogKind(l) === 'booked') return;
  const next = tmLogKind(l) === 'study' ? 'no_reply' : 'study';
  try {
    await sb(`/rest/v1/student_contact_logs?id=eq.${encodeURIComponent(id)}`, 'PATCH', { kind: next });
    l.kind = next; tmData.cache = {};
    tmRenderList();
  } catch (e) { alert('修改失败：' + e.message); }
}

// 「等回复」记录处理：改这一条的类型（不是新增）。study = 学生已回复（填内容）；no_reply = 仍未回复（可贴截图）
let tmResolve = null;
function tmResolveModal(id, kind) {
  const l = tmFindLog(id); if (!l) return;
  tmPendingImg = null; tmResolve = { id, kind };
  document.getElementById('tmResolveModal')?.remove();
  const m = document.createElement('div');
  m.id = 'tmResolveModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:18px;max-width:460px;width:100%;max-height:90vh;overflow-y:auto">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">${kind === 'study' ? '学生已回复 → 填学习记录' : '仍未回复 → 记为未回复'} · ${fuEsc(l.student_name || '')}</div>
    <div style="font-size:10px;color:var(--text-3);margin-bottom:12px">${kind === 'study' ? '这条「已联系·等回复」会改成「学习记录」，算该月完成。' : '这条「已联系·等回复」会改成「联系未回复」，计入连续未回复次数。'}</div>
    <div class="form-group"><label class="form-label">${kind === 'study' ? '内容（必填：学习情况、作业、互动内容等）' : '内容（可选）'}</label>
      <textarea id="tm_contact_note" rows="4" onpaste="tmHandlePaste(event)" style="width:100%;font-size:12px">${kind === 'study' ? '' : fuEsc(l.note || '')}</textarea></div>
    <div class="form-group"><label class="form-label">截图（可选，Ctrl+V 粘贴或选择文件）</label>
      <input type="file" id="tm_contact_file" accept="image/*" onchange="tmPickFile(event)" style="font-size:11px">
      <div id="tm_contact_preview" style="margin-top:8px"></div></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
      <button onclick="document.getElementById('tmResolveModal').remove()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">取消</button>
      <button id="tm_resolve_save" onclick="tmResolveSave()" style="font-size:12px;background:#1a6d3a;color:#fff;border:none;border-radius:3px;padding:7px 16px;cursor:pointer;font-family:inherit;font-weight:500">保存</button>
    </div></div>`;
  document.body.appendChild(m);
}
async function tmResolveSave() {
  const l = tmResolve && tmFindLog(tmResolve.id); if (!l) return;
  const note = (document.getElementById('tm_contact_note').value || '').trim();
  if (tmResolve.kind === 'study' && !note) { alert('学习记录请填写内容（学习进度、近况）'); return; }
  const btn = document.getElementById('tm_resolve_save');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    const patch = { kind: tmResolve.kind, note };
    if (tmPendingImg) patch.image_url = await sbUpload('teacher-files', `contact/${l.student_id}-${Date.now()}.jpg`, tmPendingImg);
    await sb(`/rest/v1/student_contact_logs?id=eq.${encodeURIComponent(l.id)}`, 'PATCH', patch);
    Object.assign(l, patch); tmData.cache = {};
    document.getElementById('tmResolveModal')?.remove();
    tmRenderList();
  } catch (e) {
    alert('保存失败：' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}

async function tmDeleteContact(id) {
  if (!confirm('确认删除这条记录？')) return;
  try {
    await sb(`/rest/v1/student_contact_logs?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (tmData) { [tmData.logs.id, tmData.logs.nm].forEach(ix => Object.keys(ix).forEach(k => { ix[k] = ix[k].filter(x => x.id !== id); })); tmData.cache = {}; tmRenderList(); }
    else FU_HOST.reload();
  } catch (e) { alert('删除失败：' + e.message); }
}

// 页面内查看截图大图（点任意处或×关闭，不再开新标签页）
function tmImgLightbox(url) {
  const ex = document.getElementById('tmLightbox'); if (ex) ex.remove();
  const o = document.createElement('div');
  o.id = 'tmLightbox';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';
  o.onclick = () => o.remove();
  o.innerHTML = `<img src="${url}" style="max-width:92vw;max-height:88vh;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,.5)"><div style="position:absolute;top:14px;right:22px;color:#fff;font-size:30px;line-height:1;cursor:pointer">×</div>`;
  document.body.appendChild(o);
}

// ══════════════════════════════════════════════════════════
// 重点关注：按到期临近筛选 + 学生学习概要汇总（换一种展示方式）
// ══════════════════════════════════════════════════════════
let focusStudents = [];
let focusSms = null;       // smsLoad('')：当前期缺席统计
let focusUrgency = 'all';   // all | half | q3 | near | expired | nomtg 本月无面谈无记录 | noreply3 连续3次联系未回复

function focusParseDate(str) {
  if (!str) return null;
  const s = String(str).replace(/\s/g, '');
  let m = s.match(/(\d{4}|\d{2})[年\/\-\.](\d{1,2})/);
  if (m) { let y = parseInt(m[1]); if (y < 100) y += 2000; return new Date(y, parseInt(m[2]) - 1, 1); }
  m = s.match(/(20\d{2})/);
  if (m) return new Date(parseInt(m[1]), 3, 1);   // 只有年份→默认4月入学
  return null;
}
function focusMonthsUntil(str) {
  const d = focusParseDate(str); if (!d) return null;
  const now = new Date();
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
}
function focusBucket(months) {
  if (months == null) return null;
  if (months < 0) return 'expired';
  if (months <= 1) return 'near';
  if (months <= 3) return 'q3';
  if (months <= 6) return 'half';
  return 'far';
}
const FOCUS_URG = {
  expired: { t: '已过期', bg: '#fdecea', c: '#c0392b' },
  near: { t: '到期临近', bg: '#fbeee0', c: '#b8560b' },
  q3: { t: '三个月内', bg: '#fef5e0', c: '#8a6d10' },
  half: { t: '半年内', bg: '#eef5ea', c: '#4a7a2a' },
  far: { t: '远期', bg: '#eef1f5', c: '#5a6a7a' },
};

let focusTm = null;         // 面谈 / 预约 / 联系记录（tmLoad），用于「本月无面谈无记录」「连续 3 次未回复」
let focusTmErr = '';

// 读取重点关注要用的数据：面谈 / 联系记录、当前期出席统计；list = 已按可见范围过滤的学生
async function focusLoad(list) {
  focusStudents = list;
  try { focusTm = await tmLoadFollow(list); focusTmErr = ''; } catch (e) { focusTm = null; focusTmErr = (e && e.message) || String(e); }
  focusSms = null; smsCtxCache = {};
  try { focusSms = await smsLoad(''); } catch (e) { focusSms = null; }
}

// 这个学生的面谈跟进情况：本月是否「无面谈无记录」、当前连续几次联系未回复
function focusFlags(s) {
  if (!focusTm) return null;
  const info = tmInfo(s, focusTm);
  if (fuExempt(s)) return { info, none: false, streak: 0, ex: true };   // 不需频繁联系：不算本月无面谈、不算连续未回复
  const streak = tmStreak(info);
  return { info, none: streak < 3 && tmMonthState(info, tmCurYm()).group === 'none', streak };   // 连续 3 次以上未回复的只在「连续 3 次联系未回复」里出现
}
// 当前期累计缺席 {n, courses}；统计没加载出来 = null
function focusAbsent(s) { return focusSms ? smsCurAbsent(s, focusSms) : null; }

function focusRender() {
  const box = FU_HOST.box();
  if (!box) return;
  try {
  const need = FU_HOST.need ? FU_HOST.need() : '';   // 管理端：还没选范围时不列学生
  if (need) { box.innerHTML = (FU_HOST.top ? FU_HOST.top() : '') + need; return; }
  const rows = FU_HOST.filter(focusStudents).map(s => { const months = focusMonthsUntil(s.expiry_date); return { s, months, bucket: focusBucket(months), f: focusFlags(s), ab: focusAbsent(s) }; });
  const nAbs = rows.filter(r => r.ab && r.ab.n >= 3).length, nNone = rows.filter(r => r.f && r.f.none).length, nStreak = rows.filter(r => r.f && r.f.streak >= 3).length;
  let filtered = rows.filter(r => {
    if (focusUrgency === 'all') return true;
    if (focusUrgency === 'nomtg') return !!(r.f && r.f.none);
    if (focusUrgency === 'noreply3') return !!(r.f && r.f.streak >= 3);
    if (focusUrgency === 'abs3') return !!(r.ab && r.ab.n >= 3);
    if (focusUrgency === 'expired') return r.bucket === 'expired';
    if (focusUrgency === 'near') return ['near', 'expired'].includes(r.bucket);
    if (focusUrgency === 'q3') return ['near', 'q3', 'expired'].includes(r.bucket);
    if (focusUrgency === 'half') return ['near', 'q3', 'half', 'expired'].includes(r.bucket);
    return true;
  });
  const ord = { expired: 0, near: 1, q3: 2, half: 3, far: 4 };
  if (focusUrgency === 'noreply3') filtered.sort((a, b) => b.f.streak - a.f.streak);
  else if (focusUrgency === 'abs3') filtered.sort((a, b) => b.ab.n - a.ab.n);
  else filtered.sort((a, b) => ((ord[a.bucket] ?? 5) - (ord[b.bucket] ?? 5)) || ((a.months ?? 9999) - (b.months ?? 9999)));

  const chip = (k, l) => `<div class="filter-chip ${focusUrgency === k ? 'active' : ''}" onclick="focusUrgency='${k}';FU_HOST.reset();focusRender()" style="padding:3px 10px;font-size:10px;cursor:pointer">${l}</div>`;
  const tag = (c, bg, t) => `<span style="font-size:10px;padding:1px 8px;border-radius:10px;background:${bg};color:${c};white-space:nowrap">${t}</span>`;
  const cards = filtered.length ? FU_HOST.slice(filtered).map(r => {
    const u = r.bucket ? FOCUS_URG[r.bucket] : null;
    const badge = u ? `<span style="font-size:10px;padding:1px 8px;border-radius:10px;background:${u.bg};color:${u.c};white-space:nowrap">${u.t}${r.months != null && r.months >= 0 ? '·' + r.months + '个月' : (r.months != null ? '·超' + (-r.months) + '月' : '')}</span>` : '<span style="font-size:10px;color:var(--text-3)">无到期时间</span>';
    return `<div onclick="focusOpenSummary('${r.s.id}')" style="cursor:pointer;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:10px 14px;margin-bottom:7px" onmouseover="this.style.borderColor='var(--text-2)'" onmouseout="this.style.borderColor='var(--border)'">
      <span style="font-size:13px;font-weight:600">${fuEsc(r.s.name)}</span>
      <span style="font-size:11px;color:var(--text-3)">${MAJORS[r.s.major] || r.s.major || ''}</span>
      ${badge}
      ${r.f && r.f.streak >= 3 ? tag('#c0392b', '#fdecea', `⚠ 连续 ${r.f.streak} 次联系未回复`) : ''}
      ${r.f && r.f.none ? tag('#b8560b', '#fbeee0', '本月无面谈无记录') : ''}
      ${r.f && r.f.ex ? tag('#666', '#eeeeee', '不需频繁联系') : ''}
      ${r.ab && r.ab.n >= 3 ? tag('#c0392b', '#fdecea', `⚠ 缺席 ${r.ab.n} 次${r.ab.courses.length ? ' · ' + r.ab.courses.map(fuEsc).join('、') : ''}`) : ''}
      <span style="font-size:10px;color:var(--text-3)">到期 ${fuEsc(r.s.expiry_date) || '—'}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--accent)">查看概要 ›</span>
    </div>`;
  }).join('') + FU_HOST.more(filtered.length) : `<div class="empty">${fuEmptyText('当前筛选下没有学生')}</div>`;

  box.innerHTML = `${FU_HOST.top ? FU_HOST.top() : ''}
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      ${chip('all', '全部')}${chip('half', '半年内')}${chip('q3', '三个月内')}${chip('near', '临近')}${chip('expired', '已过期')}
      <span style="width:1px;height:16px;background:var(--border);margin:0 4px"></span>
      ${chip('nomtg', '本月无面谈无记录 ' + (focusTm ? nNone : '—'))}${chip('noreply3', '连续 3 次联系未回复 ' + (focusTm ? nStreak : '—'))}${chip('abs3', '缺席 3 次以上 ' + (focusSms ? nAbs : '—'))}
    </div>
    ${focusTm && !focusSms ? '<div style="font-size:11px;color:var(--danger);margin-bottom:8px">出席统计加载失败（「缺席 3 次以上」暂不可用）</div>' : ''}
    ${focusTmErr ? `<div style="font-size:11px;color:var(--danger);margin-bottom:8px">面谈 / 联系记录加载失败：${fuEsc(focusTmErr)}（「本月无面谈无记录」「连续 3 次联系未回复」暂不可用）</div>` : ''}
    <div style="font-size:10px;color:var(--text-3);margin-bottom:8px">共 ${filtered.length} 人 · 点学生查看完整学习概要（可打印 / 复制反馈文字）。到期依据「到期时间」自动推算；连续 3 次联系未回复 = 中间没有面谈 / 学习记录；缺席 3 次以上 = 当前期累计缺席（不含请假，出席记录从 2026 年 10 月期起算）。</div>
    <div>${cards}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="empty" style="color:var(--danger)">重点关注渲染失败：${(e && e.message) || e}</div>`;
    console.error('focusRender error:', e);
  }
}

let focusFbText = '';   // 当前概要对应的反馈文字（给营业 / 家长）
function focusCopyFeedback() {
  const ok = () => alert('已复制反馈文字，可直接发给营业 / 家长');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(focusFbText).then(ok).catch(() => prompt('复制下面的文字：', focusFbText));
  else prompt('复制下面的文字：', focusFbText);
}

// 学生概要：每次打开都实时读取（不缓存）。结构：基本信息 / 报考学校 / 考学进度 / 面谈记录 / 学习记录・联系记录
async function focusOpenSummary(sid) {
  let s = focusStudents.find(x => x.id === sid) || (typeof cachedStudents !== 'undefined' ? (cachedStudents || []).find(x => x.id === sid) : null);   // 管理端学生详情里也能打开，不一定先进过重点关注
  if (!s) s = ((await sb(`/rest/v1/students?id=eq.${encodeURIComponent(sid)}&select=*`, 'GET', null, { cache: 'no-store' }).catch(() => [])) || [])[0];
  if (!s) return;
  if (!document.getElementById('focusPrintStyle')) {
    const st = document.createElement('style');
    st.id = 'focusPrintStyle';
    st.textContent = '@media print{body>*:not(#focusSummary){display:none!important}#focusSummary{position:static!important;background:#fff!important;padding:0!important;overflow:visible!important;display:block!important}#focusSummary .focus-noprint{display:none!important}#focusReport{box-shadow:none!important;max-width:none!important;padding:0!important}}';
    document.head.appendChild(st);
  }
  const ex = document.getElementById('focusSummary'); if (ex) ex.remove();
  const o = document.createElement('div');
  o.id = 'focusSummary';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto';
  o.innerHTML = '<div style="background:#fff;border-radius:8px;max-width:820px;width:100%;padding:28px;margin:auto"><div style="text-align:center;color:#888;padding:30px">加载概要中…</div></div>';
  document.body.appendChild(o);

  const enc = encodeURIComponent, nc = { cache: 'no-store' };
  // 每个查询单独记录成功 / 失败：失败要显示错误，不能当成「0 条」
  const safe = p => p.then(v => ({ v: v || [] }), e => ({ v: [], err: (e && e.message) || String(e) }));
  const get = path => safe(sb(path, 'GET', null, nc));
  const bkSel = 'id,name,student_id,major,slot_date,slot_time_range,actual_time,actual_duration,status,type,assigned_teacher,daily_record,record_done_at';
  const [tlR, plR, bkIdR, bkNmR, lgIdR, lgNmR, pmR] = await Promise.all([
    get(`/rest/v1/student_progress_timeline?student_id=eq.${enc(sid)}&select=*&order=created_at.asc`),
    get(`/rest/v1/student_school_plans?student_id=eq.${enc(sid)}&select=*&order=level.asc`),
    get(`/rest/v1/bookings?student_id=eq.${enc(sid)}&select=${bkSel}&order=slot_date.desc&limit=500`),
    get(`/rest/v1/bookings?student_id=is.null&name=eq.${enc(s.name)}&select=${bkSel}&order=slot_date.desc&limit=500`),   // 没绑定学生 id 的老预约才按姓名兜底
    get(`/rest/v1/student_contact_logs?student_id=eq.${enc(sid)}&select=*&order=created_at.desc`),
    get(`/rest/v1/student_contact_logs?student_id=is.null&student_name=eq.${enc(s.name)}&select=*&order=created_at.desc`),
    get(`/rest/v1/riyu_submissions?student_id=eq.${enc(sid)}&kind=eq.grad_prof_mail&select=id,kind,school_key,status,mail_meta`),   // 联系教授邮件：志望校旁的「教授：…」标签
  ]);

  // 出席・作业统计（当前期 + 本月，口径同出席・作业页）；加载失败不影响概要其它部分
  let attErr = '', allCtx = null, monCtx = null;
  try { [allCtx, monCtx] = await Promise.all([smsLoad(''), smsLoad(tmCurYm())]); } catch (e) { attErr = (e && e.message) || String(e); }

  try {
  const timeline = tlR.v, plans = plR.v;
  const bks = bkIdR.v.concat(bkNmR.v), logs = lgIdR.v.concat(lgNmR.v);
  const recs = bks.filter(tmHasRec).sort((a, b) => (payrollInterviewPayDate(b) || '').localeCompare(payrollInterviewPayDate(a) || ''));   // 补填的按填写记录的时间点排
  const info = { recs, pend: bks.filter(b => ['pending', 'confirmed'].includes(b.status) && b.type !== 'vip' && !tmHasRec(b)), logs: logs.sort((a, b) => tmLogKey(b).localeCompare(tmLogKey(a))) };
  const errHtml = (...rs) => { const e = rs.map(r => r.err).filter(Boolean)[0]; return e ? `<div style="font-size:11px;color:#b03a2e;padding:4px 0">读取失败：${fuEsc(e)}</div>` : ''; };
  const months = focusMonthsUntil(s.expiry_date);
  const u = focusBucket(months) ? FOCUS_URG[focusBucket(months)] : null;
  const kv = (k, v) => v ? `<div style="font-size:12px;padding:3px 0"><span style="color:#888;display:inline-block;width:78px">${k}</span>${fuEsc(v)}</div>` : '';
  const sec = (title, html) => `<div style="margin-top:18px"><div style="font-size:12px;font-weight:600;color:#1a3a5a;border-bottom:2px solid #dbe4ec;padding-bottom:4px;margin-bottom:6px">${title}</div>${html}</div>`;
  const stLabel = v => (typeof SCHOOL_STATUS_LABELS !== 'undefined' && SCHOOL_STATUS_LABELS[v]) ? SCHOOL_STATUS_LABELS[v] : { t: v || '', c: '#2a6a9a' };

  // 1. 基本信息
  const vipTxt = s.vip_hours_total ? (s.vip_hours_used || 0) + '/' + s.vip_hours_total : '';
  const basic = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px">
      ${kv('属性', s.student_type)}${kv('来源', s.source)}
      ${kv('到期', s.expiry_date)}${kv('入学目标', s.target_enrollment)}
      ${kv('VIP课时', vipTxt)}${kv('课程属性', s.course_type)}
      ${kv('等级', ({1:'冲刺',2:'匹配',3:'保底'}[s.level] || s.level || ''))}${kv('出身大学', s.university)}
      ${kv('GPA', s.gpa)}${kv('毕业时间', s.graduation_date)}
      ${kv('赴日', s.japan_arrival)}${kv('研究方向', s.thesis)}
      ${kv('日语成绩', s.japanese_score)}${kv('英语成绩', s.english_score)}
    </div>${[['目标学校', s.target_school], ['补充备注', s.notes]].filter(x => x[1]).map(x => `<div style="font-size:12px;padding:3px 0;white-space:pre-wrap"><span style="color:#888;display:inline-block;width:78px;vertical-align:top">${x[0]}</span><span style="display:inline-block;max-width:calc(100% - 82px)">${fuEsc(x[1])}</span></div>`).join('')}`;

  // 出席与作业（当前期 + 本月）
  const attCur = allCtx ? studentPeriodStats(s, allCtx).cur : null, attMon = monCtx ? studentMonthStats(s, monCtx) : null;
  const attLine = (word, st) => st && st.total
    ? `${word}：${smsAttText(st)}${st.held ? ' · 缺席 ' + st.absent + ' 次' : ''}${smsElectiveText(st) ? '；' + smsElectiveText(st) : ''}${st.untaken ? '（未点名 ' + st.untaken + ' 回）' : ''}；${smsHwText(st, word)}`
    : `${word}：无课次`;
  const attHtml = attErr ? `<div style="font-size:11px;color:#b03a2e">出席统计读取失败：${fuEsc(attErr)}</div>` : [['当前期', attCur], ['本月', attMon]].map(([w, st]) => `<div style="font-size:12px;padding:3px 0"><span style="color:#888;display:inline-block;width:50px">${w}</span>${fuEsc(attLine(w === '当前期' ? '本期' : w, st).replace(/^[^：]+：/, ''))}${w === '当前期' && st && st.absent >= 3 ? ' <span style="color:#c0392b;font-weight:600">⚠ 缺席 ' + st.absent + ' 次</span>' : ''}</div>`).join('');

  // 2. 报考学校（重点）：已确定报考（教授 OK / 已出愿 / 已合格）放最前
  const CONFIRMED = ['prof_ok', 'applied', 'passed'];
  const confirmed = plans.filter(p => CONFIRMED.includes(p.status)), others = plans.filter(p => !CONFIRMED.includes(p.status));
  const planLine = (p, strong) => {
    const st = stLabel(p.status), nm = [p.school_name, p.faculty, p.department].filter(Boolean).map(fuEsc).join(' · ');
    return `<div style="font-size:${strong ? 13 : 12}px;padding:${strong ? 7 : 4}px 0;border-top:1px solid #eee;${strong ? 'background:#fffaf0;padding-left:8px;border-left:3px solid #b8953a;' : ''}"><span style="font-weight:600">${nm}</span>${p.professor ? ' · 教授 ' + fuEsc(p.professor) : ''} ${schoolLevelHtml(p.level)} <span style="color:${st.c};font-weight:600">${fuEsc(st.t)}</span>${!isGakubuStudent(s) && typeof riyuProfTagHtml === 'function' ? ' ' + riyuProfTagHtml(p, pmR.v) : ''}${p.application_period ? ' <span style="color:#888;font-size:11px">出愿期间 ' + fuEsc(p.application_period) + '</span>' : ''}</div>`;
  };
  const schoolsHtml = errHtml(plR) + (confirmed.length ? `<div style="font-size:11px;color:#8a6d10;margin-bottom:2px">已确定报考（${confirmed.length}）</div>${confirmed.map(p => planLine(p, true)).join('')}`
      : `<div style="font-size:13px;font-weight:600;color:#c0392b;background:#fdecea;border-radius:4px;padding:8px 12px">尚未确定报考学校</div>`)
    + (others.length ? `<div style="font-size:11px;color:#888;margin:10px 0 2px">候选（${others.length}）</div>${others.map(p => planLine(p, false)).join('')}` : '');

  // 3. 考学进度：当前各项状态 + 时间线（只含进度更新，不含面谈）
  const latest = getLatestProgress(timeline);
  const dims = ['japanese', 'english', 'plan', 'apply', 'exam'];
  const statusHtml = `<div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:8px">${dims.map(k => `<div style="font-size:12px">${PROGRESS_ICONS[k]} ${PROGRESS_LABELS[k]}：${renderProgressBadge(k, latest[k])}</div>`).join('')}</div>`;
  const tlItems = timeline.filter(t => t.source !== 'booking').slice().reverse();
  const tlHtml = errHtml(tlR) + statusHtml + (tlItems.length ? tlItems.map(t => renderProgressTimelineEntry(t)).join('') : '<div style="font-size:11px;color:#aaa">暂无进度更新记录</div>');

  // 4. 面谈记录（单独一块）
  const recText = dr => {
    if (!dr || typeof dr !== 'object') return '';
    const out = [];
    [['学习', 'study'], ['计划书', 'plan'], ['出愿', 'apply'], ['备考', 'exam']].forEach(([l, k]) => {
      const st = dr[k + '_status'], ad = dr[k + '_advice'];
      if (st || ad) out.push(`${l}：${[st, ad].filter(Boolean).join('；')}`);
    });
    if (dr.issue || dr.issue_advice) out.push(`问题：${[dr.issue, dr.issue_advice].filter(Boolean).join('；')}`);
    if (dr.extra) out.push(`补充：${dr.extra}`);
    return out.join('\n');
  };
  const mtgHtml = errHtml(bkIdR, bkNmR) + (recs.length ? recs.map(b => `<div style="font-size:12px;padding:6px 0;border-top:1px solid #eee"><span style="color:#2a6a9a;font-family:monospace">${fuEsc(b.slot_date || '')}</span> ${b.assigned_teacher ? '<span style="color:#888">' + fuEsc(b.assigned_teacher) + '老师</span>' : ''}${interviewLateNote(b) ? ' <span style="color:#999;font-size:10px">' + fuEsc(interviewLateNote(b)) + '</span>' : ''}<div style="white-space:pre-wrap;line-height:1.7;color:#444;margin-top:2px">${fuEsc(recText(b.daily_record))}</div></div>`).join('') : '<div style="font-size:11px;color:#aaa">暂无面谈记录</div>');

  // 5. 学习记录 / 联系记录 + 近 6 个月方格
  const streak = tmStreak(info), curNone = tmMonthState(info, tmCurYm()).group === 'none';
  const logHtml = info.logs.length ? info.logs.map(l => { const k = TM_KIND[tmLogKind(l)]; return `<div style="font-size:12px;padding:6px 0;border-top:1px solid #eee"><span style="color:#2a6a9a;font-family:monospace">${fuEsc(tmLogYm(l))}</span> <span style="color:${k.c};border:1px solid ${k.c};border-radius:2px;padding:0 5px;font-size:10px">${k.t}</span> <span style="white-space:pre-wrap">${fuEsc(l.note) || ''}</span>${l.image_url ? ' <span style="color:#1a6d3a">[有截图]</span>' : ''} <span style="color:#aaa;font-size:10px">${fuEsc(l.teacher_name || '')}</span></div>`; }).join('') : '<div style="font-size:11px;color:#aaa">暂无学习记录 / 联系记录</div>';
  const contactHtml = errHtml(lgIdR, lgNmR) + `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px;color:#888">近 6 个月（✓ 面谈 / ✎ 学习记录 / ✉ 未回复 / ⏳ 待面谈）${tmCellsHtml(info, tmCurYm())}${streak >= 3 ? `<span style="color:#c0392b;font-weight:600">⚠ 已连续 ${streak} 次联系未回复</span>` : ''}${curNone && streak < 3 && !fuExempt(s) ? '<span style="color:#b8560b">本月无面谈无记录</span>' : ''}</div>` + logHtml;

  // 反馈文字（给营业 / 家长）：基本信息 / 出席与作业 / 报考学校 / 考学进度 / 面谈记录（最近 3 次）/ 学习记录・联系记录（最近 3 条 + 近 6 个月）
  const cut = (t, n) => { t = String(t || '').replace(/\s*\n+\s*/g, '；').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
  const kindTxt = l => l.kind === 'waiting' ? '已联系·等回复' : l.kind === 'no_reply' ? '联系未回复' : l.kind === 'booked' ? '已预约面谈' : '学习记录';
  const cellTxt = { mtg: '面谈', study: '学习记录', noreply: '未回复', wait: '等回复', pend: '待面谈' };
  const six = []; for (let i = 5; i >= 0; i--) { const m = tmShiftYm(tmCurYm(), -i); six.push(`${+m.slice(5)}月 ${cellTxt[tmMonthState(info, m).cell] || '无'}`); }
  const L = [];
  L.push(`【学生情况反馈】${s.name} · ${MAJORS[s.major] || s.major || ''} · 到期 ${s.expiry_date || '—'} · 课程属性 ${s.course_type || '—'}`);
  L.push('◆ 出席与作业');
  if (attErr) L.push('（出席统计读取失败）');
  else {
    L.push(attLine('本期', attCur) + (attCur && attCur.absent >= 3 ? ' ⚠' : ''));
    L.push(attLine('本月', attMon));
  }
  L.push('◆ 报考学校');
  L.push(confirmed.length ? '已确定：' + confirmed.map(p => [p.school_name, p.faculty, p.department].filter(Boolean).join(' ') + '（' + stLabel(p.status).t.replace(/\s*🎉/, '') + '）').join('；') : '已确定：尚未确定');
  if (others.length) L.push('候选：' + others.map(p => [p.school_name, p.faculty, p.department].filter(Boolean).join(' ')).join('；'));
  L.push('考学进度：' + dims.map(k => `${PROGRESS_LABELS[k]} ${latest[k] || '未填写'}`).join('；'));
  L.push(`◆ 面谈记录（共 ${recs.length} 次，最近 3 次）`);
  if (recs.length) recs.slice(0, 3).forEach(b => L.push(`${b.slot_date || ''}${b.assigned_teacher ? ' · ' + b.assigned_teacher + '老师' : ''} · ${cut(recText(b.daily_record), 80) || '（无内容）'}`));
  else L.push('暂无面谈记录');
  L.push('◆ 学习记录 / 联系记录');
  if (info.logs.length) info.logs.slice(0, 3).forEach(l => L.push(`${tmLogYm(l)} ${kindTxt(l)}${l.kind !== 'waiting' && l.note ? '：' + cut(l.note, 80) : ''}`));
  else L.push('暂无记录');
  if (streak >= 3) L.push(`已连续 ${streak} 次联系未回复，请营业 / 家长协助联系学生`);
  L.push('近 6 个月面谈情况：' + six.join(' · '));
  focusFbText = L.join('\n');

  o.innerHTML = `
  <div id="focusReport" style="background:#fff;border-radius:8px;max-width:820px;width:100%;padding:28px;margin:auto">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:2px solid #1a3a5a;padding-bottom:12px">
      <div>
        <div style="font-family:'Noto Serif SC',serif;font-size:20px;font-weight:600">${fuEsc(s.name)}<span style="font-size:13px;color:#888;font-weight:400;margin-left:10px">${MAJORS[s.major] || s.major || ''}</span></div>
        <div style="font-size:12px;color:#666;margin-top:3px">到期 ${fuEsc(s.expiry_date) || '—'}${s.target_enrollment?' · 入学目标 '+fuEsc(s.target_enrollment):''} ${u ? `<span style="padding:1px 8px;border-radius:10px;background:${u.bg};color:${u.c};margin-left:6px">${u.t}${months != null && months >= 0 ? '·还有' + months + '个月' : ''}</span>` : ''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap" class="focus-noprint">
        <button onclick="focusCopyFeedback()" style="font-size:12px;background:#2a6a4a;color:#fff;border:none;border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">复制反馈文字</button>
        <button onclick="window.print()" style="font-size:12px;background:#1a3a5a;color:#fff;border:none;border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">🖨 打印 / 存PDF</button>
        <button onclick="document.getElementById('focusSummary').remove()" style="font-size:12px;background:none;border:1px solid #ccc;border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">关闭</button>
      </div>
    </div>

    ${sec('基本信息', basic)}
    ${sec('出席与作业', attHtml)}
    ${sec('报考学校', schoolsHtml)}
    ${sec('考学进度', tlHtml)}
    ${sec('面谈记录（' + recs.length + '次）', mtgHtml)}
    ${sec('学习记录 / 联系记录（' + info.logs.length + '）', contactHtml)}

    <div style="margin-top:20px;font-size:10px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:8px">唯新教育 · 学生学习概要 · 生成于 ${new Date().toLocaleDateString('zh-CN')}</div>
  </div>`;
  } catch (e) {
    o.innerHTML = `<div style="background:#fff;border-radius:8px;max-width:520px;width:100%;padding:24px;margin:auto"><div style="color:#b03a2e;font-size:13px;margin-bottom:12px">概要生成失败：${(e && e.message) || e}</div><button onclick="document.getElementById('focusSummary').remove()" style="font-size:12px;border:1px solid #ccc;background:none;border-radius:4px;padding:6px 16px;cursor:pointer">关闭</button></div>`;
    console.error('focusOpenSummary error:', e);
  }
}
