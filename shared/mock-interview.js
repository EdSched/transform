// ══════════════════════════════════
// mock-interview.js — 模拟面试记录（老师端 / 管理端共用）
// 数据：bookings.type='mock' 的 daily_record.mock（jsonb 里的一个键，不新建表、不加列；次数 = 数「有 mock 记录」的预约，不单独存）
//   mock = { school_key, school_name, qa:[{item_key,q,free,prepared,answer,rating,comment}], overall_rating, overall, next }
// 三块：① 记录表单（ivmMount / ivmCollect，挂在预约卡片里） ② 展示（ivmViewHtml / ivmText，学生详情、概要、学生端共用）
//       ③ 考学进度「模拟面试」视图（ivmRenderView，admin 与老师端各传自己范围内的学生）
// 依赖：shared/supabase.js、shared/constants.js、shared/riyu.js（riyuEsc / riyuKeyOf / riyuSecs）、shared/interview-bank.js
// ══════════════════════════════════
const IVM_RATINGS = ['◎', '○', '△', '×'];
const IVM_ST = {};              // 预约 id → 表单状态
const ivmCache = { loaded: false, loading: null, byStudent: {}, plans: [] };

// ── 数据 ──
function ivmOf(b) { const r = b && b.daily_record; return r && typeof r === 'object' && r.mock && typeof r.mock === 'object' ? r.mock : null; }
// 有内容才算有记录：整体反馈 / 整体评价 / 任一题有回答、评价或评语。空壳不写进 daily_record，避免被工资判断（嵌套对象有值就算）误认
function ivmHas(m) {
  if (!m) return false;
  if (String(m.overall || '').trim() || m.overall_rating || String(m.next || '').trim()) return true;
  return (m.qa || []).some(x => String(x.answer || '').trim() || x.rating || String(x.comment || '').trim());
}
function ivmDate(b) { return String(b.actual_time || b.slot_date || '').slice(0, 10); }
// 某学生已有记录的模拟面试（新→旧）。bookings = 该生的预约行
function ivmList(bookings) {
  return (bookings || []).filter(b => b.type === 'mock' && ivmHas(ivmOf(b))).sort((a, b) => ivmDate(b).localeCompare(ivmDate(a)));
}
async function ivmLoadAll(force) {
  if (ivmCache.loaded && !force) return ivmCache;
  if (ivmCache.loading && !force) return ivmCache.loading;
  ivmCache.loading = (async () => {
    const [bks, plans] = await Promise.all([
      sbAll('/rest/v1/bookings?type=eq.mock&daily_record=not.is.null&select=id,name,student_id,major,slot_date,actual_time,actual_duration,status,assigned_teacher,daily_record&order=slot_date.desc'),
      sbAll('/rest/v1/student_school_plans?select=id,student_id,school_name,faculty,department,exam_date,level&order=level.asc'),
    ]);
    const by = {};
    bks.filter(b => b.student_id && ivmHas(ivmOf(b))).forEach(b => { (by[b.student_id] = by[b.student_id] || []).push(b); });
    Object.keys(by).forEach(k => by[k].sort((a, b) => ivmDate(b).localeCompare(ivmDate(a))));
    ivmCache.byStudent = by; ivmCache.plans = plans; ivmCache.loaded = true; ivmCache.loading = null;
    return ivmCache;
  })();
  return ivmCache.loading;
}
// 进度卡片：模拟面试 N 次 · 最近 11/15（缓存没读好时先返回空，并在后台读取）
function ivmCardText(sid) {
  if (!ivmCache.loaded) { ivmLoadAll().catch(() => {}); return ''; }
  const l = ivmCache.byStudent[sid] || []; if (!l.length) return '';
  const d = ivmDate(l[0]);
  return `模拟面试 ${l.length} 次 · 最近 ${d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : ''}`;
}

// ── 展示 ──
function ivmEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function ivmSchoolOf(m) { return (m && m.school_name) || ''; }
// 纯文本（反馈文字 / 面谈记录文字）
function ivmText(b) {
  const m = ivmOf(b); if (!ivmHas(m)) return '';
  const L = ['🎤 模拟面试' + (m.school_name ? '：' + m.school_name : '')];
  if (m.overall_rating) L.push('整体评价：' + m.overall_rating);
  (m.qa || []).forEach((x, i) => {
    if (!(String(x.answer || '').trim() || x.rating || String(x.comment || '').trim())) return;
    L.push(`${i + 1}. ${x.q}${x.rating ? ' [' + x.rating + ']' : ''}`);
    if (String(x.answer || '').trim()) L.push('　回答：' + String(x.answer).trim());
    if (String(x.comment || '').trim()) L.push('　评语：' + String(x.comment).trim());
  });
  if (String(m.overall || '').trim()) L.push('整体反馈：' + String(m.overall).trim());
  if (String(m.next || '').trim()) L.push('下次课题：' + String(m.next).trim());
  return L.join('\n');
}
// 概要里的一行：日期 · 老师 · 学校 · 整体评价
function ivmLine(b) { const m = ivmOf(b); return [ivmDate(b), b.assigned_teacher ? b.assigned_teacher + '老师' : '', ivmSchoolOf(m), m.overall_rating ? '整体 ' + m.overall_rating : ''].filter(Boolean).join(' · '); }
// 展开后的逐题详情
function ivmDetailHtml(b) {
  const m = ivmOf(b); if (!m) return '';
  const rc = r => r === '◎' || r === '○' ? '#2a7a4a' : r === '△' ? '#b8860b' : r === '×' ? '#b03a2e' : '#999';
  return `<div style="padding:4px 0 6px 10px;font-size:11px;line-height:1.8;color:var(--text-2,#5a5650)">
    ${(m.qa || []).map(x => `<div style="border-top:1px dashed var(--border-light,#ede9e2);padding:4px 0"><b>${ivmEsc(x.q)}</b>${x.rating ? ` <span style="color:${rc(x.rating)};font-weight:700">${ivmEsc(x.rating)}</span>` : ''}
      ${String(x.answer || '').trim() ? `<div style="white-space:pre-wrap">回答：${ivmEsc(x.answer)}</div>` : ''}${String(x.comment || '').trim() ? `<div style="white-space:pre-wrap">评语：${ivmEsc(x.comment)}</div>` : ''}</div>`).join('')}
    ${String(m.overall || '').trim() ? `<div style="white-space:pre-wrap;margin-top:4px"><b>整体反馈</b>：${ivmEsc(m.overall)}</div>` : ''}
    ${String(m.next || '').trim() ? `<div style="white-space:pre-wrap"><b>下次课题</b>：${ivmEsc(m.next)}</div>` : ''}</div>`;
}
// 「模拟面试（N 次）」块：默认收起，点开是每次一行，再点开逐题
function ivmViewHtml(list) {
  list = list || [];
  if (!list.length) return '<div style="font-size:11px;color:var(--text-3,#999)">还没有模拟面试记录</div>';
  return `<details style="font-size:12px"><summary style="cursor:pointer;font-weight:600">模拟面试（${list.length} 次）　<span style="font-weight:400;color:var(--text-3,#999)">最近：${ivmEsc(ivmLine(list[0]))}</span></summary>
    ${list.map(b => `<details style="margin:4px 0 0 8px"><summary style="cursor:pointer;color:var(--text-2,#5a5650)">${ivmEsc(ivmLine(b))}</summary>${ivmDetailHtml(b)}</details>`).join('')}</details>`;
}
// 学生详情里的挂载点：先放占位，异步读取该生的记录
function ivmStudentBlockHtml(sid) {
  const id = 'ivm_blk_' + String(sid).replace(/[^A-Za-z0-9_-]/g, '');
  setTimeout(async () => {
    const el = document.getElementById(id); if (!el) return;
    try {
      const rows = await sb(`/rest/v1/bookings?student_id=eq.${encodeURIComponent(sid)}&type=eq.mock&daily_record=not.is.null&select=id,name,student_id,slot_date,actual_time,actual_duration,status,assigned_teacher,type,daily_record&order=slot_date.desc`, 'GET', null, { cache: 'no-store' });
      el.innerHTML = ivmViewHtml(ivmList(rows));
    } catch (e) { el.innerHTML = ''; }
  }, 0);
  return `<div id="${id}" style="margin:8px 0"></div>`;
}

// ══ 记录表单（老师端卡片 / 管理端弹窗）══
// 打开时 await ivmMount(booking)：读该生的面试稿、志望校、已做的模拟面试次数，渲染到 #ivm_form_<id>
async function ivmMount(b) {
  const el = document.getElementById('ivm_form_' + b.id); if (!el) return;
  const old = ivmOf(b) || {};
  const st = IVM_ST[b.id] = Object.assign(IVM_ST[b.id] || {}, { b, sel: null });
  el.innerHTML = '<div style="font-size:11px;color:var(--text-3,#999);padding:8px">加载面试稿…</div>';
  let student = null, subs = [], plans = [], prior = [];
  try {
    student = b.student_id ? ((await sb(`/rest/v1/students?id=eq.${encodeURIComponent(b.student_id)}&select=id,name,major`, 'GET', null, { cache: 'no-store' })) || [])[0]
      : ((await sb(`/rest/v1/students?name=eq.${encodeURIComponent(b.name || '')}&select=id,name,major`, 'GET', null, { cache: 'no-store' })) || [])[0];
  } catch (e) { student = null; }
  const sid = student ? student.id : b.student_id;
  if (sid) {
    [subs, plans, prior] = await Promise.all([
      sb(`/rest/v1/riyu_submissions?student_id=eq.${encodeURIComponent(sid)}&kind=eq.${RIYU_INTERVIEW_KIND}&select=*`, 'GET', null, { cache: 'no-store' }).catch(() => []),
      sb(`/rest/v1/student_school_plans?student_id=eq.${encodeURIComponent(sid)}&select=*&order=level.asc`, 'GET', null, { cache: 'no-store' }).catch(() => []),
      sb(`/rest/v1/bookings?student_id=eq.${encodeURIComponent(sid)}&type=eq.mock&daily_record=not.is.null&select=id,slot_date,actual_time,daily_record,type`, 'GET', null, { cache: 'no-store' }).catch(() => []),
    ]);
  }
  let bank = null; try { bank = student ? await ivbForStudent(student) : null; } catch (e) { bank = null; }
  const pri = ivmList(prior).filter(x => x.id !== b.id);
  const school = old.school_key != null && old.school_key !== '' ? old.school_key : ivbDefaultSchool(plans);
  Object.assign(st, {
    student, subs, plans, bank, priorN: pri.length, school,
    sel: (old.qa || []).map(x => Object.assign({}, x)),
    overall_rating: old.overall_rating || '', overall: old.overall || '', next: old.next || '', q: '', openCh: st.openCh || {}, freeText: '',
  });
  ivmRender(b.id);
}
function ivmSchoolName(st, key) { const p = (st.plans || []).find(x => riyuKeyOf(x) === key); return p ? [p.school_name, p.faculty, p.department].filter(Boolean).join(' · ') : ''; }
function ivmPrepared(st, itemKey) {
  const ch = st.bank && st.bank.chapters.find(c => (c.items || []).some(i => i.key === itemKey)); if (!ch) return '';
  return ivbAnswer(st.subs, ivbRowKeyFor(ch, st.school), itemKey, null);
}
function ivmChip(label, on, click, color) {
  return `<span onclick="${click}" style="cursor:pointer;padding:3px 11px;border-radius:3px;font-size:12px;border:1px solid ${on ? (color || 'var(--accent,#b8953a)') : 'var(--border,#e2ded6)'};background:${on ? 'var(--btn-bg,#efe9e1)' : 'var(--surface,#fff)'};color:${on ? 'var(--btn-fg,#3a2e24)' : 'var(--text-2,#5a5650)'};font-weight:${on ? 700 : 400}">${label}</span>`;
}
// ── 两页布局 ──
// 选题 / 查看（左）｜ 记录填写（右）。容器宽度 ≥720px 左右并排、各自独立滚动；更窄（手机、管理端小弹窗）是左右滑动的两页，顶部页签也能点
function ivmCss() {
  if (document.getElementById('ivm_css')) return;
  const s = document.createElement('style'); s.id = 'ivm_css';
  s.textContent = `
.ivm-wrap{container-type:inline-size;border:1px solid var(--border,#e2ded6);border-radius:4px;background:var(--bg,#f7f5f0);overflow:hidden}
.ivm-head{padding:8px 10px;border-bottom:1px solid var(--border,#e2ded6)}
.ivm-tabs{display:flex;border-bottom:1px solid var(--border,#e2ded6);background:var(--surface,#fff)}
.ivm-tab{flex:1;text-align:center;padding:9px 4px;font-size:12px;cursor:pointer;color:var(--text-3,#999);border-bottom:2px solid transparent}
.ivm-tab.on{color:var(--text,#1a1814);font-weight:700;border-bottom-color:var(--accent,#b8953a)}
.ivm-panes{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;overscroll-behavior-x:contain}
.ivm-panes::-webkit-scrollbar{display:none}
.ivm-pane{flex:0 0 100%;min-width:0;box-sizing:border-box;scroll-snap-align:start;scroll-snap-stop:always;height:58vh;height:58dvh;min-height:320px;overflow-y:auto;padding:10px}
.ivm-pt{display:none;font-size:11px;font-weight:700;margin-bottom:6px;color:var(--text-2,#5a5650)}
@container (min-width:720px){
  .ivm-tabs{display:none}
  .ivm-panes{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);overflow:visible;scroll-snap-type:none}
  .ivm-pane{height:60vh;height:60dvh}
  .ivm-pane + .ivm-pane{border-left:1px solid var(--border,#e2ded6)}
  .ivm-pt{display:block}
}`;
  document.head.appendChild(s);
}
function ivmRender(id) {
  const st = IVM_ST[id], el = document.getElementById('ivm_form_' + id); if (!el || !st) return;
  ivmCss(); st.view = st.view || {};
  // 重画前记住两页各自的滚动位置，重画后还原（否则每点一次评价就跳回顶部）
  const o0 = document.getElementById('ivm_p0_' + id), o1 = document.getElementById('ivm_p1_' + id);
  const sc = o0 && o1 ? [o0.scrollTop, o1.scrollTop] : [0, 0];
  const inp = 'width:100%;box-sizing:border-box;font-size:11px;padding:6px 8px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--surface,#fff);font-family:inherit';
  const pr = st.bank ? ivbProgress(st.bank, st.subs, st.school) : null;
  const selKeys = new Set(st.sel.filter(x => !x.free).map(x => x.item_key));
  const q = (st.q || '').trim().toLowerCase();
  // 选题区：搜索在最上面；章节默认折叠，点击一题 = 选入 / 取消（高亮行，不用复选框）；「看答案」展开学生答案和参考例
  let pick = '';
  if (st.bank) {
    pick = st.bank.chapters.map(c => {
      const items = ivbVisibleItems(c).filter(i => ivbAnswerable(c, i)).filter(i => !q || (i.q + (i.tips || '') + (i.example || '')).toLowerCase().indexOf(q) >= 0);
      if (!items.length) return '';
      const open = q || st.openCh[c.key];
      const n = items.filter(i => selKeys.has(i.key)).length;
      return `<div style="margin-bottom:4px"><div onclick="ivmToggleCh('${id}','${c.key}')" style="cursor:pointer;font-size:11px;font-weight:600;padding:3px 0">${open ? '▾' : '▸'} ${ivmEsc(c.title)}<span style="font-weight:400;color:var(--text-3,#999)"> ${items.length} 题${n ? ' · 已选 ' + n : ''}</span></div>
        ${open ? items.map(i => { const on = selKeys.has(i.key); const a = ivbAnswer(st.subs, ivbRowKeyFor(c, st.school), i.key, null).trim(); const v = !!st.view[i.key];
          return `<div style="margin:2px 0"><div onclick="ivmToggleQ('${id}','${i.key}')" style="cursor:pointer;display:flex;gap:8px;align-items:baseline;padding:5px 8px;border-radius:3px;font-size:11px;border:1px solid ${on ? 'var(--accent,#b8953a)' : 'var(--border-light,#ede9e2)'};background:${on ? 'var(--btn-bg,#efe9e1)' : 'var(--surface,#fff)'}"><span style="flex:1;min-width:0;font-weight:${on ? 700 : 400}">${ivmEsc(i.q)}</span><span style="color:${a ? '#2a7a4a' : '#b8860b'};white-space:nowrap">${a ? '已写' : '未写'}</span><span onclick="event.stopPropagation();ivmView('${id}','${i.key}')" style="color:var(--accent,#b8953a);white-space:nowrap;padding:0 2px">${v ? '收起' : '看答案'}</span></div>
            ${v ? `<div style="margin:2px 0 4px;padding:6px 8px;border:1px dashed var(--border,#e2ded6);border-radius:3px;font-size:11px;line-height:1.8;white-space:pre-wrap;background:var(--surface,#fff)"><b>学生答案</b>\n${ivmEsc(a || '（学生没写）')}${i.example ? `\n\n<b>参考例</b>\n${ivmEsc(i.example)}` : ''}</div>` : ''}</div>`; }).join('') : ''}</div>`;
    }).join('');
  }
  const qa = st.sel.map((x, i) => `<div style="border:1px solid var(--border-light,#ede9e2);border-radius:4px;padding:8px 10px;margin-bottom:6px;background:var(--surface,#fff)">
      <div style="display:flex;align-items:center;gap:6px"><span style="font-size:12px;font-weight:600">${i + 1}. ${ivmEsc(x.q)}${x.free ? ' <span style="font-size:10px;color:var(--text-3,#999);font-weight:400">自由追问</span>' : ''}</span>
        <span style="margin-left:auto;display:flex;gap:3px"><button class="btn btn-outline btn-sm" ${i === 0 ? 'disabled' : ''} onclick="ivmMove('${id}',${i},-1)">↑</button><button class="btn btn-outline btn-sm" ${i === st.sel.length - 1 ? 'disabled' : ''} onclick="ivmMove('${id}',${i},1)">↓</button><button class="btn btn-outline btn-sm" onclick="ivmDrop('${id}',${i})">✕</button></span></div>
      ${!x.free ? `<details style="font-size:11px;margin:3px 0"><summary style="cursor:pointer;color:var(--text-3,#999)">学生准备的答案</summary><div style="white-space:pre-wrap;line-height:1.8;color:var(--text-2,#5a5650)">${ivmEsc(x.prepared || ivmPrepared(st, x.item_key) || '（学生没写）')}</div></details>` : ''}
      <textarea rows="2" placeholder="实际回答（记要点，可空）" oninput="ivmSet('${id}',${i},'answer',this.value)" style="${inp};margin:3px 0;resize:vertical">${ivmEsc(x.answer || '')}</textarea>
      <div style="display:flex;gap:5px;align-items:center;margin-bottom:4px"><span style="font-size:10px;color:var(--text-3,#999)">评价</span>${IVM_RATINGS.map(r => ivmChip(r, x.rating === r, `ivmRate('${id}',${i},'${r}')`)).join('')}</div>
      <textarea rows="2" placeholder="评语" oninput="ivmSet('${id}',${i},'comment',this.value)" style="${inp};resize:vertical">${ivmEsc(x.comment || '')}</textarea></div>`).join('');
  el.innerHTML = `<div class="ivm-wrap">
    <div class="ivm-head">
      <div style="font-size:11px;color:var(--text-2,#5a5650);margin-bottom:6px">${st.bank ? `该生面试稿完成度 <b>${pr.done}/${pr.total}</b> 题（必答，当前志望校）` : '该生所在专业还没有公开的面试题库（可以用「自由追问」记录）'} · 已做模拟面试 <b>${st.priorN}</b> 次</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:11px;color:var(--text-3,#999)">面试目标院校</span>
        <select onchange="ivmSetSchool('${id}',this.value)" style="${inp};width:auto;max-width:100%"><option value="">不指定学校</option>${(st.plans || []).map(p => { const k = riyuKeyOf(p); return `<option value="${ivmEsc(k)}" ${st.school === k ? 'selected' : ''}>${ivmEsc(ivmSchoolName(st, k) || '（未命名）')}${p.exam_date ? '（' + ivmEsc(String(p.exam_date).slice(0, 10)) + '）' : ''}</option>`; }).join('')}</select></div></div>
    <div class="ivm-tabs"><div id="ivm_tab_${id}_0" class="ivm-tab${st.pane ? '' : ' on'}" onclick="ivmGoPane('${id}',0)">选题 / 查看</div><div id="ivm_tab_${id}_1" class="ivm-tab${st.pane ? ' on' : ''}" onclick="ivmGoPane('${id}',1)">记录填写（已选 ${st.sel.length} 题）</div></div>
    <div class="ivm-panes" id="ivm_panes_${id}" onscroll="ivmOnScroll('${id}')">
      <div class="ivm-pane" id="ivm_p0_${id}">
        <div class="ivm-pt">选题 / 查看</div>
        ${st.bank ? `<input value="${ivmEsc(st.q)}" placeholder="搜索题库里的题" oninput="ivmSearch('${id}',this.value)" style="${inp};margin-bottom:6px"><div style="margin-bottom:8px">${pick || '<div style="font-size:11px;color:var(--text-3,#999)">没有匹配的题</div>'}</div>` : ''}
        <div style="display:flex;gap:6px"><input id="ivm_free_${id}" placeholder="＋ 自由追问：现场加题库里没有的问题" onkeydown="if(event.key==='Enter'){ivmAddFree('${id}');}" style="${inp}"><button class="btn btn-outline btn-sm" onclick="ivmAddFree('${id}')">添加</button></div>
      </div>
      <div class="ivm-pane" id="ivm_p1_${id}">
        <div class="ivm-pt">记录填写（已选 ${st.sel.length} 题）</div>
        ${qa || '<div style="font-size:11px;color:var(--text-3,#999);margin-bottom:8px">还没有选题：在「选题 / 查看」页点题，或加自由追问</div>'}
        <div style="border-top:1px solid var(--border,#e2ded6);margin-top:8px;padding-top:8px">
          <div style="display:flex;gap:5px;align-items:center;margin-bottom:5px"><span style="font-size:11px;font-weight:600">整体评价</span>${IVM_RATINGS.map(r => ivmChip(r, st.overall_rating === r, `ivmRateAll('${id}','${r}')`)).join('')}</div>
          <textarea rows="3" placeholder="整体反馈" oninput="IVM_ST['${id}'].overall=this.value" style="${inp};margin-bottom:5px;resize:vertical">${ivmEsc(st.overall)}</textarea>
          <textarea rows="2" placeholder="下次课题" oninput="IVM_ST['${id}'].next=this.value" style="${inp};resize:vertical">${ivmEsc(st.next)}</textarea></div>
      </div></div></div>`;
  const p = document.getElementById('ivm_panes_' + id), a0 = document.getElementById('ivm_p0_' + id), a1 = document.getElementById('ivm_p1_' + id);
  if (a0) a0.scrollTop = sc[0]; if (a1) a1.scrollTop = sc[1];
  if (p && st.pane) p.scrollLeft = p.clientWidth;   // 窄屏：还原到当前页（宽屏是并排，这一句无效果）
}
function ivmView(id, key) { const st = IVM_ST[id]; st.view = st.view || {}; st.view[key] = !st.view[key]; ivmRender(id); }
function ivmSyncTabs(id) {
  const st = IVM_ST[id]; if (!st) return;
  [0, 1].forEach(i => { const t = document.getElementById(`ivm_tab_${id}_${i}`); if (t) t.classList.toggle('on', (st.pane ? 1 : 0) === i); });
}
function ivmGoPane(id, i) {
  const st = IVM_ST[id], p = document.getElementById('ivm_panes_' + id); if (!st || !p) return;
  st.pane = i; ivmSyncTabs(id); p.scrollTo({ left: i * p.clientWidth, behavior: 'smooth' });
}
function ivmOnScroll(id) {   // 手指左右滑动后，页签跟着换
  const st = IVM_ST[id], p = document.getElementById('ivm_panes_' + id); if (!st || !p || !p.clientWidth) return;
  clearTimeout(st._st); st._st = setTimeout(() => { const n = Math.round(p.scrollLeft / p.clientWidth) ? 1 : 0; if (n !== (st.pane ? 1 : 0)) { st.pane = n; ivmSyncTabs(id); } }, 80);
}
function ivmToggleCh(id, k) { const st = IVM_ST[id]; st.openCh[k] = !st.openCh[k]; ivmRender(id); }
function ivmSearch(id, v) { const st = IVM_ST[id]; st.q = v; clearTimeout(st._t); st._t = setTimeout(() => { ivmRender(id); const i = document.querySelector(`#ivm_form_${id} input[placeholder^="搜索"]`); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 250); }
function ivmToggleQ(id, key) {
  const st = IVM_ST[id], i = st.sel.findIndex(x => !x.free && x.item_key === key);
  if (i >= 0) st.sel.splice(i, 1);
  else { let it = null; st.bank.chapters.some(c => (it = (c.items || []).find(x => x.key === key))); if (it) st.sel.push({ item_key: key, q: it.q, free: false, prepared: ivmPrepared(st, key), answer: '', rating: '', comment: '' }); }
  ivmRender(id);
}
function ivmAddFree(id) {
  const el = document.getElementById('ivm_free_' + id), t = (el && el.value || '').trim(); if (!t) return;
  IVM_ST[id].sel.push({ item_key: 'free_' + Date.now().toString(36), q: t, free: true, prepared: '', answer: '', rating: '', comment: '' }); ivmRender(id);
}
function ivmMove(id, i, d) { const a = IVM_ST[id].sel, j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; ivmRender(id); }
function ivmDrop(id, i) { IVM_ST[id].sel.splice(i, 1); ivmRender(id); }
function ivmSet(id, i, f, v) { IVM_ST[id].sel[i][f] = v; }
function ivmRate(id, i, r) { const x = IVM_ST[id].sel[i]; x.rating = x.rating === r ? '' : r; ivmRender(id); }
function ivmRateAll(id, r) { const st = IVM_ST[id]; st.overall_rating = st.overall_rating === r ? '' : r; ivmRender(id); }
function ivmSetSchool(id, k) { const st = IVM_ST[id]; st.school = k; st.sel.forEach(x => { if (!x.free) x.prepared = ivmPrepared(st, x.item_key); }); ivmRender(id); }
// 保存用：返回 mock 对象；没有任何内容返回 null（调用方就把 mock 键删掉）。表单没打开过（没 mount）返回 undefined = 不要动原有的 mock
function ivmCollect(id) {
  const st = IVM_ST[id]; if (!st || st.sel == null) return undefined;
  const m = { school_key: st.school || '', school_name: ivmSchoolName(st, st.school), qa: st.sel.map(x => ({ item_key: x.item_key, q: x.q, free: !!x.free, prepared: x.free ? '' : (x.prepared || ivmPrepared(st, x.item_key) || ''), answer: x.answer || '', rating: x.rating || '', comment: x.comment || '' })), overall_rating: st.overall_rating || '', overall: st.overall || '', next: st.next || '' };
  return ivmHas(m) ? m : null;
}
// 把 mock 合并进已有的 daily_record（其他键 study / plan / extra… 原样保留）
function ivmMergeRecord(booking, id) {
  const rec = Object.assign({}, (booking && booking.daily_record) || {});
  const m = ivmCollect(id);
  if (m === undefined) return rec;
  if (m) rec.mock = m; else delete rec.mock;
  return rec;
}

// ══ 考学进度 →「模拟面试」视图 ══
// provider() → 范围内的学生数组（admin / 老师端各自按自己的范围算，这里不再过滤范围）
const ivmV = { q: '', major: '', status: '', teacher: '', range: 'future', shown: 30 };
async function ivmRenderView(box, provider) {
  box.innerHTML = '<div class="loading">加载中…</div>';
  try { await ivmLoadAll(true); } catch (e) { box.innerHTML = `<div class="empty" style="color:var(--danger)">读取失败：${ivmEsc(e.message)}</div>`; return; }
  ivmV._provider = provider; ivmV._box = box; ivmVDraw();
}
function ivmRows() {
  const today = jstToday(), stus = ivmV._provider() || [], rows = [];
  const plansBy = {}; ivmCache.plans.forEach(p => { (plansBy[p.student_id] = plansBy[p.student_id] || []).push(p); });
  stus.forEach(s => {
    const mocks = ivmCache.byStudent[s.id] || [], used = new Set();
    (plansBy[s.id] || []).forEach(p => {
      const k = riyuKeyOf(p), ms = mocks.filter(b => ivmOf(b).school_key === k);
      ms.forEach(b => used.add(b.id));
      rows.push({ s, plan: p, name: [p.school_name, p.faculty, p.department].filter(Boolean).join(' · '), exam: p.exam_date ? String(p.exam_date).slice(0, 10) : '', ms });
    });
    const rest = mocks.filter(b => !used.has(b.id));
    if (rest.length) rows.push({ s, plan: null, name: '未指定学校', exam: '', ms: rest });
  });
  rows.forEach(r => { r.status = !r.ms.length ? 'todo' : (r.exam && r.exam < today ? 'done' : 'doing'); });
  return rows;
}
const IVM_STATUS = { todo: '未开始', doing: '进行中', done: '已结束' };
function ivmVDraw() {
  const box = ivmV._box; if (!box) return;
  const today = jstToday();
  let rows = ivmRows();
  const majors = [...new Set(rows.map(r => r.s.major).filter(Boolean))];
  const teachers = [...new Set(rows.flatMap(r => r.ms.map(b => b.assigned_teacher)).filter(Boolean))];
  const q = ivmV.q.trim().toLowerCase();
  if (q) rows = rows.filter(r => (r.s.name + (r.s.name_kana || '') + r.name).toLowerCase().indexOf(q) >= 0);   // 搜索不受其他筛选限制
  else {
    if (ivmV.range === 'future') rows = rows.filter(r => r.exam && r.exam >= today);
    if (ivmV.major) rows = rows.filter(r => r.s.major === ivmV.major);
    if (ivmV.status) rows = rows.filter(r => r.status === ivmV.status);
    if (ivmV.teacher) rows = rows.filter(r => r.ms.some(b => b.assigned_teacher === ivmV.teacher));
  }
  rows.sort((a, b) => (a.exam || '9999').localeCompare(b.exam || '9999') || a.s.name.localeCompare(b.s.name));
  const total = rows.length, show = rows.slice(0, ivmV.shown);
  const sel = 'font-size:12px;padding:4px 8px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--bg,#f7f5f0);font-family:inherit';
  box.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
    <input value="${ivmEsc(ivmV.q)}" placeholder="搜索学生 / 学校（不受其他筛选限制）" oninput="ivmV.q=this.value;ivmV.shown=30;clearTimeout(ivmV._t);ivmV._t=setTimeout(()=>{ivmVDraw();const i=document.getElementById('ivm_v_q');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}},250)" id="ivm_v_q" style="${sel};min-width:220px">
    <select onchange="ivmV.range=this.value;ivmV.shown=30;ivmVDraw()" style="${sel}"><option value="future" ${ivmV.range === 'future' ? 'selected' : ''}>考试日在今天之后</option><option value="all" ${ivmV.range === 'all' ? 'selected' : ''}>全部考试日</option></select>
    <select onchange="ivmV.major=this.value;ivmV.shown=30;ivmVDraw()" style="${sel}"><option value="">全部专业</option>${majors.map(m => `<option value="${ivmEsc(m)}" ${ivmV.major === m ? 'selected' : ''}>${ivmEsc((typeof MAJORS !== 'undefined' && MAJORS[m]) || m)}</option>`).join('')}</select>
    <select onchange="ivmV.status=this.value;ivmV.shown=30;ivmVDraw()" style="${sel}"><option value="">全部状态</option>${Object.entries(IVM_STATUS).map(([k, l]) => `<option value="${k}" ${ivmV.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select onchange="ivmV.teacher=this.value;ivmV.shown=30;ivmVDraw()" style="${sel}"><option value="">全部老师</option>${teachers.map(t => `<option value="${ivmEsc(t)}" ${ivmV.teacher === t ? 'selected' : ''}>${ivmEsc(t)}</option>`).join('')}</select>
    <span style="font-size:11px;color:var(--text-3,#999)">共 ${total} 行</span></div>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--bg,#f7f5f0);text-align:left">${['专业', '学生', '面试目标院校', '考试日期', '状态', '次数', '最近一次', '老师反馈'].map(h => `<th style="padding:6px 8px;border-bottom:1px solid var(--border,#e2ded6);white-space:nowrap">${h}</th>`).join('')}</tr></thead><tbody>
  ${show.map(r => { const last = r.ms[0], lm = last ? ivmOf(last) : null; const st = { todo: '#999', doing: '#2a6aad', done: '#6a6560' }[r.status];
    return `<tr style="border-bottom:1px solid var(--border-light,#ede9e2);vertical-align:top"><td style="padding:6px 8px">${ivmEsc((typeof MAJORS !== 'undefined' && MAJORS[r.s.major]) || r.s.major || '')}</td><td style="padding:6px 8px;white-space:nowrap">${ivmEsc(r.s.name)}</td><td style="padding:6px 8px">${ivmEsc(r.name)}</td><td style="padding:6px 8px;white-space:nowrap">${ivmEsc(r.exam || '—')}</td>
      <td style="padding:6px 8px;color:${st};white-space:nowrap">${IVM_STATUS[r.status]}</td><td style="padding:6px 8px">${r.ms.length}</td>
      <td style="padding:6px 8px;white-space:nowrap">${last ? ivmEsc(ivmDate(last)) + (last.actual_duration ? ` · ${last.actual_duration}分` : '') : '—'}</td>
      <td style="padding:6px 8px;max-width:340px">${lm ? `<details><summary style="cursor:pointer;color:var(--text-2,#5a5650)">${lm.overall_rating ? ivmEsc(lm.overall_rating) + ' ' : ''}${ivmEsc(String(lm.overall || '（见详情）').slice(0, 40))}</summary>${ivmDetailHtml(last)}</details>` : '—'}</td></tr>`; }).join('') || '<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--text-3,#999)">没有符合条件的记录</td></tr>'}
  </tbody></table></div>
  ${total > show.length ? `<div style="text-align:center;padding:10px"><button class="btn btn-outline btn-sm" onclick="ivmV.shown+=30;ivmVDraw()">显示更多（还有 ${total - show.length} 行）</button></div>` : ''}`;
}
