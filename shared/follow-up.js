// 面谈跟进（老师端「面谈跟进」/ 管理端「面谈跟进」共用）：读取面谈 / 预约 / 联系记录、按月状态、近 6 个月小方格、
// 补记录（学习记录 / 等回复 / 未回复，可附截图）、改类型、结案、删除、生成联络文字。
// 署名：老师端 = 老师名，管理端 = 「管理员」（riyuReviewerName）。管理员可以改 / 删任何人的记录。
// 页面差异通过宿主 FU_HOST 注入（谁定义：teacher/teacher-students.js、admin/followup.js）：
//   filter(list) 按页面的领域/专业/状态/搜索筛学生 · slice(list) / more(total) 分页 · reset() 回到第一页
//   box() 页面容器 · reload() 重新读取并重画
// 依赖：shared/supabase.js、shared/constants.js、shared/payroll-core.js（payrollInterviewPayDate / interviewListYm）、shared/riyu.js（riyuReviewerName）
const fuEsc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const FU_ADMIN_NAME = '管理员';
let FU_HOST = { filter: l => l, slice: l => l, more: () => '', reset() {}, box: () => document.getElementById('mainContent'), reload() {} };
function fuSetHost(h) { FU_HOST = Object.assign({}, FU_HOST, h); }
const fuMe = () => (typeof riyuReviewerName === 'function' ? riyuReviewerName() : FU_ADMIN_NAME) || FU_ADMIN_NAME;

// ══════════════════════════════════
// 面谈跟进（学生管理子项 meetings）——按「每月一次」跟进
// 规则：每个学生每月至少一次面谈；没有面谈的，老师补「联系记录」：
//   学习记录（补充学习情况、和学生的互动等）→ 这个月算完成；联系未回复 → 没完成，继续跟进。
//   连续 3 次联系未回复（中间没有面谈 / 学习记录）→ 转入重点关注。
// ══════════════════════════════════
const TM_KIND = { study: { t: '学习记录', c: '#1a6d3a', ic: '✎' }, waiting: { t: '已联系·等回复', c: '#8a6d10', ic: '✉' }, no_reply: { t: '联系未回复', c: '#b8560b', ic: '✉' } };
const TM_GROUPS = [['done', '✓ 已完成'], ['pend', '⏳ 待面谈'], ['noreply', '✉ 已联系'], ['none', '⚠ 无面谈无记录']];
let tmYm = '';             // 当前查看的月份 YYYY-MM（空 = 本月）
let tmGroup = '';          // '' 全部 | done | pend | noreply | none
let tmExpandedId = null;
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
function tmLogKind(l) { return l.kind === 'no_reply' ? 'no_reply' : l.kind === 'waiting' ? 'waiting' : 'study'; }
function tmWaitDays(l) { return Math.max(0, Math.floor((Date.now() - new Date(l.created_at || Date.now()).getTime()) / 86400e3)); }
function tmLogYm(l) { return l.for_month || tmJstYmd(l.created_at).slice(0, 7); }
// 记录在时间线上的位置（补记往月的记录，按那个月月底算，避免排在后面的面谈前面）
function tmLogKey(l) { const ym = tmLogYm(l), cd = tmJstYmd(l.created_at); return cd.slice(0, 7) === ym ? cd : ym + '-28'; }

// 读取面谈 / 预约 / 联系记录，按学生归档（面谈跟进、重点关注共用）；students = 已按可见范围过滤的学生
async function tmLoadFollow(students) {
  const [allBk, allPend, allLogs] = await Promise.all([
    sbAll('/rest/v1/bookings?daily_record=not.is.null&select=*&order=slot_date.desc,id.asc'),
    sbAll('/rest/v1/bookings?status=in.("pending","confirmed")&select=id,name,student_id,major,slot_date,slot_time_range,status,type,assigned_teacher,daily_record&order=id.asc'),
    sbAll('/rest/v1/student_contact_logs?select=*&order=created_at.desc,id.asc'),
  ]);
  // 按学生 id 归档；没绑定学生 id 的（新同学预约、旧记录）按姓名归档
  const idx = () => ({ id: {}, nm: {} });
  const put = (ix, row, name) => { if (row.student_id) (ix.id[row.student_id] = ix.id[row.student_id] || []).push(row); else (ix.nm[name] = ix.nm[name] || []).push(row); };
  const rec = idx(), pend = idx(), logs = idx();
  (allBk || []).forEach(b => { if (tmHasRec(b)) put(rec, b, b.name); });
  (allPend || []).forEach(b => { if (b.type !== 'vip' && !tmHasRec(b)) put(pend, b, b.name); });
  (allLogs || []).forEach(l => put(logs, l, l.student_name));
  return { students, rec, pend, logs, cache: {} };
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
  const ev = info.recs.map(b => ({ k: payrollInterviewPayDate(b), ok: true })).concat(info.logs.filter(l => tmLogKind(l) !== 'waiting').map(l => ({ k: tmLogKey(l), ok: tmLogKind(l) === 'study' })))
    .filter(e => e.k && (!uptoYm || e.k.slice(0, 7) <= uptoYm)).sort((a, b) => a.k.localeCompare(b.k) || (b.ok ? 1 : 0) - (a.ok ? 1 : 0));
  let n = 0;
  ev.forEach(e => { n = e.ok ? 0 : n + 1; });
  return n;
}
// 当前筛选下每个学生的本月分组
function tmRows() {
  const ym = tmYm || tmCurYm();
  return FU_HOST.filter(tmData.students || []).map(s => {
    const info = tmInfo(s), st = tmMonthState(info, ym);
    return { s, info, st, streak: st.nore.length ? tmStreak(info, ym) : 0 };
  });
}
// 当前筛选下「本月无面谈无记录」的学生（批量提醒用）
function tmNoRecStudents() { return tmRows().filter(r => r.st.group === 'none').map(r => r.s); }

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
  const all = tmRows();
  const cnt = g => all.filter(r => r.st.group === g).length;
  const w = tmMonthWord();
  if (chipBox) chipBox.innerHTML = '<span style="font-size:10px;color:var(--text-3)">分组：</span>' + TM_GROUPS.map(([k, l]) => `<div class="filter-chip ${tmGroup === k ? 'active' : ''}" onclick="tmSetGroup('${k}')" style="padding:3px 10px;font-size:10px">${l.replace(/^(\S+) /, '$1 ' + w)} ${cnt(k)}</div>`).join('');
  const ord = { done: 0, pend: 1, noreply: 2, none: 3 };
  const list = all.filter(r => !tmGroup || r.st.group === tmGroup).sort((a, b) => (ord[a.st.group] - ord[b.st.group]) || (b.streak - a.streak) || a.s.name.localeCompare(b.s.name, 'zh'));
  const c0 = document.getElementById('tm_count'); if (c0) c0.textContent = list.length;
  if (!list.length) { listBox.innerHTML = '<div class="empty">没有符合筛选条件的学生</div>'; return; }
  let lastG = '';
  listBox.innerHTML = FU_HOST.slice(list).map(r => {
    const s = r.s, open = tmExpandedId === s.id, lastM = r.info.recs[0] ? payrollInterviewPayDate(r.info.recs[0]) : '';
    let head = '';
    if (!tmGroup && r.st.group !== lastG) { lastG = r.st.group; const t = TM_GROUPS.find(x => x[0] === lastG)[1].replace(/^(\S+) /, '$1 ' + w); head = `<div style="font-size:11px;font-weight:600;color:var(--text-2);margin:12px 0 6px">${t}（${cnt(lastG)}）</div>`; }
    return head + `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden;margin-bottom:6px">
      <div onclick="tmToggle('${s.id}')" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 14px;cursor:pointer;${open ? 'background:var(--bg)' : ''}">
        <span style="font-size:13px;font-weight:600">${fuEsc(s.name)}</span>
        <span onclick="event.stopPropagation();copyNameText(tmStuName('${s.id}'),this)" style="font-size:10px;border:1px solid var(--border);border-radius:3px;padding:1px 7px;cursor:pointer;background:var(--surface);color:var(--text-2)">📋 姓名</span>
        <span onclick="event.stopPropagation();tmGenReminder('${s.id}')" style="font-size:10px;border:1px solid var(--border);border-radius:3px;padding:1px 7px;cursor:pointer;background:var(--surface);color:var(--text-2)">✉ 联络文字</span>
        <span style="font-size:11px;color:var(--text-3)">${fuEsc(MAJORS[s.major] || s.major || '')}</span>
        ${tmStateTag(r)}
        <span style="font-size:10px;color:var(--text-3);margin-left:auto">${lastM ? '最近面谈 ' + fuEsc(lastM) : '从未面谈'}</span>
        ${tmCellsHtml(r.info)}
        <span style="font-size:10px;color:var(--text-3)">${open ? '▲' : '▼'}</span>
      </div>
      ${open ? tmDetailHtml(s, r.info) : ''}
    </div>`;
  }).join('') + FU_HOST.more(list.length);
}

function tmDetailHtml(s, info) {
  const me = fuMe();
  const sub = (title, inner, btn) => `<div style="margin-bottom:12px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:11px;font-weight:600;color:var(--text-2)">${title}</span>${btn || ''}</div>${inner}</div>`;
  const mtg = info.recs.length ? info.recs.map(b => `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px;margin-bottom:6px">
      <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">${fuEsc(b.slot_date)}${b.slot_time_range ? ' ' + fuEsc(b.slot_time_range) : ''}${b.actual_duration ? ' · ' + fuEsc(b.actual_duration) + 'min' : ''}${b.assigned_teacher ? ' · ' + fuEsc(b.assigned_teacher) + '老师' : ''}${b.type ? ' · ' + fuEsc(typeLabel(b.type)) : ''}${interviewLateNote(b) ? ' · ' + fuEsc(interviewLateNote(b)) : ''}</div>
      <pre style="font-size:11px;line-height:1.8;white-space:pre-wrap;font-family:inherit;margin:0;color:var(--text-2)">${fuEsc(buildRecordText(b))}</pre></div>`).join('')
    : '<div style="font-size:11px;color:var(--text-3)">还没有面谈记录</div>';
  const logs = info.logs.length ? info.logs.map(l => {
    const kd = tmLogKind(l), k = TM_KIND[kd], mine = l.teacher_name === me || me === FU_ADMIN_NAME;
    const kindTxt = kd === 'waiting' ? `${k.t} · 已等 ${tmWaitDays(l)} 天` : k.t;
    const acts = kd === 'waiting'
      ? `<span style="flex-shrink:0;display:flex;flex-direction:column;gap:4px;align-items:stretch"><button onclick="tmResolveModal('${l.id}','study')" style="font-size:10px;background:#1a6d3a;color:#fff;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit;white-space:nowrap">学生已回复 → 填学习记录</button><button onclick="tmResolveModal('${l.id}','no_reply')" style="font-size:10px;background:none;color:#b8560b;border:1px solid #b8560b;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit;white-space:nowrap">仍未回复 → 记为未回复</button>${mine ? `<span onclick="tmDeleteContact('${l.id}')" style="color:var(--danger);cursor:pointer;font-size:9px;text-align:right">删除</span>` : ''}</span>`
      : mine ? `<span style="flex-shrink:0;font-size:9px;white-space:nowrap"><span onclick="tmFlipKind('${l.id}')" style="color:var(--accent);cursor:pointer">改为${kd === 'study' ? '未回复' : '学习记录'}</span> <span onclick="tmDeleteContact('${l.id}')" style="color:var(--danger);cursor:pointer;margin-left:6px">删除</span></span>` : '';
    return `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid var(--border-light)">
      ${l.image_url ? `<img src="${fuEsc(l.image_url)}" onclick="tmImgLightbox('${fuEsc(l.image_url)}')" style="flex-shrink:0;width:52px;height:52px;object-fit:cover;border-radius:4px;border:1px solid var(--border);cursor:zoom-in">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;margin-bottom:2px"><span style="color:var(--text-3)">${fuEsc(tmLogYm(l))}</span> <span style="color:${k.c};border:1px solid ${k.c};border-radius:2px;padding:0 5px">${k.ic} ${kindTxt}</span></div>
        <div style="font-size:11px;white-space:pre-wrap;line-height:1.5">${fuEsc(l.note) || '（无内容）'}</div>
        <div style="font-size:9px;color:var(--text-3);margin-top:3px">${fuEsc(l.teacher_name || '')} · ${fuEsc(tmJstYmd(l.created_at))}</div>
      </div>
      ${acts}
    </div>`;
  }).join('') : '<div style="font-size:11px;color:var(--text-3)">还没有学习记录 / 联系记录</div>';
  const from = (tmYm || tmCurYm()) + '-01';
  const pend = info.pend.filter(b => (b.slot_date || '') >= from);
  const pendHtml = pend.length ? pend.map(b => `<div style="font-size:11px;padding:4px 0;border-top:1px solid var(--border-light)">${fuEsc(b.slot_date)} ${fuEsc(b.slot_time_range || '')} · ${b.status === 'confirmed' ? '已确认' : '待确认'}${b.assigned_teacher ? ' · ' + fuEsc(b.assigned_teacher) + '老师' : ''}</div>`).join('') : '<div style="font-size:11px;color:var(--text-3)">没有待进行的预约</div>';
  const add = `<button onclick="tmContactModal('${s.id}')" style="margin-left:auto;font-size:10px;background:#1a6d3a;color:#fff;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit">＋ 补充记录</button>`;
  return `<div style="border-top:1px solid var(--border-light);background:var(--bg);padding:10px 14px">
    ${sub(`面谈记录（${info.recs.length} 次）`, mtg)}
    ${sub(`学习记录 / 联系记录（${info.logs.length}）`, logs, add)}
    ${sub(`预约（${tmMonthWord() === '本月' ? '本月' : tmYm.replace('-', '年') + '月'}及以后）`, pendHtml)}
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
    await sb('/rest/v1/student_contact_logs', 'POST', [{
      id: 'sclog-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      student_id: s.id, student_name: s.name, major: s.major || '',
      teacher_name: fuMe(),
      note, image_url: imageUrl || null, kind: tmAdd.kind, for_month: ym,
    }]);
    document.getElementById('tmContactModal')?.remove();
    tmYm = ym;   // 跳到刚记录的那个月，立刻能看到它出现在哪一组
    FU_HOST.reload();
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
  const l = tmFindLog(id); if (!l || tmLogKind(l) === 'waiting') return;
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
    FU_HOST.reload();
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


