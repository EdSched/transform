// ══════════ VIP 学生上课情况（admin「出席・作业」页 和 老师端「出席・作业记录」共用，只查看）══════════
// 数据：bookings（type = 'vip'）按月读取 + 这些预约的 homework_submissions（booking_id 关联）
// 宿主页面调用 vlMount(box, cfg)：
//   cfg.students()          范围内的学生（用来限定范围、领域/专业筛选、剩余课时）
//   cfg.requireStudent      true = 预约必须对得上范围内的学生才显示（管理范围 / 老师学生范围）
//   cfg.bookingOk(b)        可选，再按预约过滤（例如老师端「只看自己上的课」）
//   cfg.recordBtn(b)        可选，返回行里的「去上课记录」按钮 HTML（老师端用）
// 依赖：shared/constants.js（DMF / domMajorFilterHtml / chipFold / hwFeedbacks / hwFeedbackCardsHtml / MAJORS）、shared/supabase.js、shared/search.js
const VL = {
  ym: '', view: 'lesson',            // view: lesson 按课次 | student 按学生
  status: '', teacher: '', q: '',     // status: '' | done | cancelled | todo
  rows: [], subs: {}, loadedYm: '', loading: false, err: '',
  open: {}, stuOpen: {}, shown: 30,
  box: null, cfg: null,
};
const VL_PAGE = 30;

function vlEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function vlPad2(n) { return String(n).padStart(2, '0'); }
function vlCurYm() { const d = new Date(); return d.getFullYear() + '-' + vlPad2(d.getMonth() + 1); }
function vlShiftYm(ym, n) { const p = ym.split('-').map(Number); const d = new Date(p[0], p[1] - 1 + n, 1); return d.getFullYear() + '-' + vlPad2(d.getMonth() + 1); }
function vlToday() { const d = new Date(); return d.getFullYear() + '-' + vlPad2(d.getMonth() + 1) + '-' + vlPad2(d.getDate()); }

function vlMount(box, cfg) {
  VL.box = box; VL.cfg = cfg;
  if (!VL.ym) VL.ym = vlCurYm();
  VL.shown = VL_PAGE;
  if (VL.loadedYm !== VL.ym) vlLoad(); else vlDraw();
}

// 只读选中月份：bookings?type=eq.vip&slot_date=gte.…&slot_date=lt.…
async function vlLoad() {
  const ym = VL.ym;
  VL.loading = true; VL.err = ''; vlDraw();
  try {
    const next = vlShiftYm(ym, 1);
    const rows = await sbAll(`/rest/v1/bookings?type=eq.vip&slot_date=gte.${ym}-01&slot_date=lt.${next}-01&select=*&order=slot_date.desc`);
    const subs = {};
    const ids = rows.map(b => b.id);
    for (let i = 0; i < ids.length; i += 40) {
      const part = await sb(`/rest/v1/homework_submissions?booking_id=in.(${ids.slice(i, i + 40).map(x => `"${x}"`).join(',')})&select=*`).catch(() => []);
      (part || []).forEach(x => { if (x.booking_id) subs[x.booking_id] = x; });
    }
    if (VL.ym !== ym) return;   // 读的过程中又换了月份
    VL.rows = rows; VL.subs = subs; VL.loadedYm = ym;
  } catch (e) { if (VL.ym === ym) { VL.err = (e && e.message) || String(e); VL.rows = []; VL.subs = {}; VL.loadedYm = ym; } }
  VL.loading = false; vlDraw();
}

// ── 单节课的状态 / 作业 / 确认 ──
function vlState(b) {
  if (b.status === 'cancelled') return 'cancelled';
  if (b.status === 'completed') return 'done';
  return vlToday() > (b.slot_date || '') ? 'unrec' : 'todo';   // todo = 已约未到时间；unrec = 时间已过还没记录
}
function vlQEmpty(q) {
  if (!q) return true;
  if (typeof q === 'string') return !q.trim() || q.trim() === '[]';
  if (Array.isArray(q)) return !q.length;
  if (typeof q === 'object') return !Object.keys(q).length || (Array.isArray(q.items) && !q.items.length && !q.text);
  return false;
}
function vlQText(q) {
  if (vlQEmpty(q)) return '';
  if (typeof q === 'string') return q;
  const arr = Array.isArray(q) ? q : (Array.isArray(q.items) ? q.items : (Array.isArray(q.questions) ? q.questions : null));
  if (arr) {
    const t = arr.map((x, i) => { const s = typeof x === 'string' ? x : (x && (x.q || x.text || x.title || x.question || x.content)) || ''; return s ? `${i + 1}. ${s}` : ''; }).filter(Boolean);
    return t.length ? t.join('\n') : `（已设置作业题，共 ${arr.length} 项）`;
  }
  return q.text || '（已设置作业题）';
}
// 无 / 已布置 / 学生已交 / 已批改
function vlHw(b) {
  const sub = VL.subs[b.id];
  const assigned = !!(String(b.vip_homework || '').trim() || !vlQEmpty(b.vip_homework_questions));
  const graded = !!(String(b.vip_homework_feedback || '').trim() || (sub && hwFeedbacks(sub).length));
  if (graded) return { k: 'graded', t: '已批改', c: 'var(--ok,#2a9e6a)', assigned: true, sub };
  if (sub) return { k: 'submitted', t: '学生已交', c: '#2a6aad', assigned: true, sub };
  if (assigned) return { k: 'assigned', t: '已布置', c: 'var(--warn,#b8860b)', assigned: true, sub };
  return { k: 'none', t: '无', c: 'var(--text-3,#999)', assigned: false, sub };
}
function vlConfirm(b) {
  const st = vlState(b);
  if (st !== 'done') return { t: '—', c: 'var(--text-3,#999)' };
  if (!b.student_confirmed) return { t: '待确认', c: 'var(--warn,#b8860b)' };
  const r = b.student_rating;
  return { t: '✓' + (r != null && r !== '' ? ' 评价 ' + r : ''), c: 'var(--ok,#2a9e6a)' };
}
function vlStateTag(st) {
  return ({ done: ['已上课', 'var(--ok,#2a9e6a)'], cancelled: ['已取消', 'var(--text-3,#999)'], unrec: ['已过未记录', 'var(--danger,#b03a2e)'], todo: ['未上', 'var(--text-2,#666)'] })[st];
}

// ── 过滤 ──
function vlStudentOf(b, byId, byName) {
  return (b.student_id && byId[b.student_id]) || byName[b.name] || null;
}
function vlIndex() {
  const list = (VL.cfg.students && VL.cfg.students()) || [];
  const byId = {}, byName = {};
  list.forEach(s => { byId[s.id] = s; if (s.name) byName[s.name] = s; });
  return { byId, byName };
}
// 范围内的所有预约（月份已由读取限定）；领域/专业筛选按学生档案的专业（含附加专业）
function vlScoped() {
  const { byId, byName } = vlIndex();
  const out = [];
  VL.rows.forEach(b => {
    const s = vlStudentOf(b, byId, byName);
    if (VL.cfg.requireStudent && !s) return;
    if (VL.cfg.bookingOk && !VL.cfg.bookingOk(b)) return;
    out.push({ b, s, item: s || { major: b.major } });
  });
  return out;
}
const VL_DMF_OPTS = { extra: true, noSource: true };
function vlMatch(x, skip) {
  const b = x.b;
  if (!dmfMatch(x.item, DMF, VL_DMF_OPTS)) return false;
  if (VL.status) {
    const st = vlState(b);
    if (VL.status === 'todo' ? !(st === 'todo' || st === 'unrec') : st !== VL.status) return false;
  }
  if (VL.teacher && (b.assigned_teacher || '') !== VL.teacher) return false;
  if (VL.q) {
    const f = [b.name, b.assigned_teacher, b.vip_content, b.vip_session_notes];
    if (typeof searchMatch === 'function' ? !searchMatch(VL.q, f) : !f.join(' ').toLowerCase().includes(VL.q.toLowerCase())) return false;
  }
  return true;
}

// ── 操作 ──
function vlSet(k, v) { VL[k] = v; VL.shown = VL_PAGE; if (k === 'q') { vlDrawBody(); return; } vlDraw(); }
function vlSetYm(ym) { VL.ym = ym; VL.shown = VL_PAGE; VL.open = {}; VL.stuOpen = {}; vlLoad(); }
function vlMore() { VL.shown += VL_PAGE; vlDrawBody(); }
function vlToggle(id) { VL.open[id] = !VL.open[id]; vlDrawBody(); }
function vlToggleStu(key) { VL.stuOpen[key] = !VL.stuOpen[key]; vlDrawBody(); }

// ── 绘制 ──
function vlChipRow(label, chips) {
  return `<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center"><span style="font-size:10px;color:var(--text-3);min-width:30px">${label}</span>${chips}</div>`;
}
function vlDraw() {
  const box = VL.box; if (!box) return;
  const cur = vlCurYm();
  const scoped = vlScoped();
  const teachers = [...new Set(scoped.map(x => x.b.assigned_teacher).filter(Boolean))].sort();
  if (VL.teacher && !teachers.includes(VL.teacher)) VL.teacher = '';
  // 领域/专业：只列有学生的；来源不用
  const seen = new Set(); const items = [];
  scoped.forEach(x => { const k = x.s ? x.s.id : 'b' + x.b.id; if (!seen.has(k)) { seen.add(k); items.push(x.item); } });
  const dmfBar = domMajorFilterHtml(DMF, 'vlDraw()', items, VL_DMF_OPTS);
  const chip = (on, label, fn) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${fn}">${label}</div>`;
  const stCount = k => scoped.filter(x => { const st = vlState(x.b); return k === 'todo' ? (st === 'todo' || st === 'unrec') : st === k; }).length;
  const arrow = (n, tx) => `<span onclick="vlSetYm('${vlShiftYm(VL.ym, n)}')" style="cursor:pointer;user-select:none;font-size:13px;padding:2px 10px;border:1px solid var(--border);border-radius:3px;background:var(--surface)">${tx}</span>`;
  box.innerHTML = `
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px;margin-bottom:12px;display:flex;flex-direction:column;gap:10px">
    <input id="vl_q" value="${vlEsc(VL.q)}" placeholder="搜索学生、老师、上课内容" oninput="vlSet('q',this.value)" style="width:100%;box-sizing:border-box;font-size:12px;padding:7px 10px;border:1px solid var(--border);border-radius:3px;font-family:inherit">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      ${arrow(-1, '‹')}<span style="font-size:13px;font-weight:600;min-width:92px;text-align:center">${VL.ym.replace('-', '年')}月</span>${arrow(1, '›')}
      ${VL.ym === cur ? '' : `<span onclick="vlSetYm('${cur}')" style="font-size:10px;color:var(--accent);cursor:pointer">回到本月</span>`}
      <span style="width:1px;height:16px;background:var(--border)"></span>
      ${chip(VL.view === 'lesson', '按课次', "vlSet('view','lesson')")}${chip(VL.view === 'student', '按学生', "vlSet('view','student')")}
    </div>
    ${vlChipRow('状态', chip(!VL.status, `全部 ${scoped.length}`, "vlSet('status','')") + [['done', '已上课'], ['cancelled', '已取消'], ['todo', '未上']].map(([k, l]) => chip(VL.status === k, `${l} ${stCount(k)}`, `vlSet('status','${k}')`)).join(''))}
    ${dmfBar ? `<div>${dmfBar}</div>` : ''}
    ${teachers.length > 1 ? vlChipRow('老师', chipFold([{ on: !VL.teacher, html: chip(!VL.teacher, '全部', "vlSet('teacher','')") }].concat(teachers.map(t => ({ on: VL.teacher === t, html: chip(VL.teacher === t, vlEsc(t), `vlSet('teacher','${vlEsc(t).replace(/'/g, "\\'")}')`) }))))) : ''}
  </div>
  <div id="vl_body"></div>`;
  vlDrawBody();
}

function vlDrawBody() {
  const el = document.getElementById('vl_body'); if (!el) return;
  if (VL.loading) { el.innerHTML = '<div class="empty">加载中…</div>'; return; }
  if (VL.err) { el.innerHTML = `<div class="empty">加载失败：${vlEsc(VL.err)}</div>`; return; }
  const list = vlScoped().filter(x => vlMatch(x));
  el.innerHTML = VL.view === 'student' ? vlStudentsHtml(list) : vlLessonsHtml(list);
}

const VL_TH = 'text-align:left;font-size:10px;font-weight:600;color:var(--text-3);padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap';
const VL_TD = 'font-size:11px;padding:7px 8px;border-bottom:1px solid var(--border-light,#eee);vertical-align:top';

function vlMoreBtn(total) {
  return total > VL.shown ? `<div onclick="vlMore()" style="text-align:center;font-size:11px;color:var(--accent);cursor:pointer;padding:10px">显示更多（还有 ${total - VL.shown} 条）</div>` : '';
}

// 一行课次 + 展开详情；colspan = 表格总列数
function vlLessonRow(x, cols, extraTd) {
  const b = x.b, st = vlState(b), tag = vlStateTag(st), hw = vlHw(b), cf = vlConfirm(b);
  const grey = st === 'cancelled' ? 'opacity:.55;background:var(--bg,#f7f5f0);' : '';
  const open = !!VL.open[b.id];
  const who = b.cancelled_by ? `（${vlEsc(b.cancelled_by)}取消）` : '';
  let h = `<tr onclick="vlToggle('${b.id}')" style="cursor:pointer;${grey}">
    <td style="${VL_TD};white-space:nowrap">${vlEsc(b.slot_date || '')}<div style="color:var(--text-3)">${vlEsc(b.slot_time_range || '')}</div></td>
    <td style="${VL_TD}"><b>${vlEsc(b.name || '')}</b></td>
    <td style="${VL_TD}">${vlEsc(b.assigned_teacher || '—')}</td>
    <td style="${VL_TD}">${st === 'cancelled'
      ? `<span style="color:var(--text-3)">已取消${who}${b.cancel_reason ? '：' + vlEsc(b.cancel_reason) : ''}</span>`
      : `<span style="color:${tag[1]};font-size:10px">${tag[0]}</span> ${vlEsc(b.vip_content || '')}`}</td>
    <td style="${VL_TD};white-space:nowrap">${st === 'done' ? (b.vip_hours_used != null ? b.vip_hours_used : '—') : '—'}</td>
    <td style="${VL_TD}">${vlEsc(st === 'done' ? (b.vip_student_status || '—') : '—')}</td>
    <td style="${VL_TD};white-space:nowrap;color:${hw.c}">${st === 'cancelled' ? '—' : hw.t}</td>
    <td style="${VL_TD};white-space:nowrap;color:${cf.c}">${vlEsc(cf.t)}</td>
    ${extraTd || ''}
  </tr>`;
  if (open) h += `<tr><td colspan="${cols}" style="padding:10px 14px;background:var(--bg,#f7f5f0);border-bottom:1px solid var(--border-light,#eee)">${vlDetailHtml(b, hw)}</td></tr>`;
  return h;
}
function vlDetailHtml(b, hw) {
  const sec = (label, v) => v ? `<div style="margin-bottom:8px"><div style="font-size:10px;font-weight:600;color:var(--text-3);margin-bottom:2px">${label}</div><div style="font-size:12px;line-height:1.8;white-space:pre-wrap">${vlEsc(v)}</div></div>` : '';
  const qt = vlQText(b.vip_homework_questions);
  const btn = VL.cfg.recordBtn ? VL.cfg.recordBtn(b) : '';
  const fbCards = hw.sub ? hwFeedbackCardsHtml(hw.sub) : '';
  const body = [
    sec('课堂记录', b.vip_session_notes),
    sec('未按规划上课的原因', b.vip_offplan_reason),
    sec('作业内容', [b.vip_homework, qt, b.vip_homework_note].filter(x => String(x || '').trim()).join('\n')),
    hw.sub ? sec('学生提交', `${hw.sub.submitted_at ? '提交于 ' + String(hw.sub.submitted_at).slice(0, 16).replace('T', ' ') : '已提交'}`) : '',
    sec('批改内容', b.vip_homework_feedback),
    fbCards ? `<div style="margin-bottom:8px"><div style="font-size:10px;font-weight:600;color:var(--text-3);margin-bottom:2px">学生作业批改</div>${fbCards}</div>` : '',
    b.vip_homework_feedback_file_url ? `<div style="margin-bottom:8px"><a href="${vlEsc(b.vip_homework_feedback_file_url)}" target="_blank" style="font-size:11px;color:var(--accent)">批改文件</a></div>` : '',
  ].join('');
  return (body || '<div style="font-size:11px;color:var(--text-3)">还没有课堂记录</div>') + (btn ? `<div style="margin-top:6px">${btn}</div>` : '');
}

function vlLessonsHtml(list) {
  if (!list.length) return '<div class="empty">没有符合条件的 VIP 课次</div>';
  const sorted = list.slice().sort((a, b) => (b.b.slot_date || '').localeCompare(a.b.slot_date || '') || (b.b.slot_time_range || '').localeCompare(a.b.slot_time_range || ''));
  const cols = 8;
  return `<div style="font-size:11px;color:var(--text-3);margin-bottom:6px">共 ${list.length} 节</div>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:4px">
    <thead><tr><th style="${VL_TH}">日期时间</th><th style="${VL_TH}">学生</th><th style="${VL_TH}">老师</th><th style="${VL_TH}">上课内容</th><th style="${VL_TH}">课时</th><th style="${VL_TH}">学生状态</th><th style="${VL_TH}">作业</th><th style="${VL_TH}">学生确认</th></tr></thead>
    <tbody>${sorted.slice(0, VL.shown).map(x => vlLessonRow(x, cols)).join('')}</tbody>
  </table></div>${vlMoreBtn(sorted.length)}`;
}

function vlStudentsHtml(list) {
  if (!list.length) return '<div class="empty">没有符合条件的 VIP 学生</div>';
  const groups = {};
  list.forEach(x => { const k = x.s ? x.s.id : 'n:' + (x.b.name || ''); (groups[k] = groups[k] || { key: k, s: x.s, name: x.b.name || '', items: [] }).items.push(x); });
  const stus = Object.values(groups).map(g => {
    const c = { done: 0, cancelled: 0, unrec: 0, todo: 0, hours: 0, hwA: 0, hwS: 0, hwG: 0, last: '' };
    g.items.forEach(x => {
      const st = vlState(x.b); c[st]++;
      if (st === 'done') { c.hours += Number(x.b.vip_hours_used) || 0; if ((x.b.slot_date || '') > c.last) c.last = x.b.slot_date; }
      if (st !== 'cancelled') { const hw = vlHw(x.b); if (hw.assigned) { c.hwA++; if (hw.k === 'submitted' || hw.k === 'graded') c.hwS++; if (hw.k === 'graded') c.hwG++; } }
    });
    g.c = c; return g;
  }).sort((a, b) => (b.c.last || '').localeCompare(a.c.last || '') || a.name.localeCompare(b.name));
  const cols = 8;
  const rows = stus.slice(0, VL.shown).map(g => {
    const c = g.c, s = g.s, open = !!VL.stuOpen[g.key];
    const remain = s && s.vip_hours_total != null ? Math.round(((Number(s.vip_hours_total) || 0) - (Number(s.vip_hours_used) || 0)) * 100) / 100 : null;
    let h = `<tr onclick="vlToggleStu('${vlEsc(g.key).replace(/'/g, "\\'")}')" style="cursor:pointer">
      <td style="${VL_TD}"><span style="color:var(--text-3)">${open ? '▾' : '▸'}</span> <b>${vlEsc(g.name)}</b></td>
      <td style="${VL_TD}">${c.done}</td>
      <td style="${VL_TD};color:${c.cancelled ? 'var(--text-2)' : 'var(--text-3)'}">${c.cancelled}</td>
      <td style="${VL_TD};color:${c.unrec ? 'var(--danger,#b03a2e)' : 'var(--text-3)'}">${c.unrec}</td>
      <td style="${VL_TD}">${c.hours ? Math.round(c.hours * 100) / 100 : 0}</td>
      <td style="${VL_TD}">${remain == null ? '—' : remain}</td>
      <td style="${VL_TD}">${c.hwA ? `布置 ${c.hwA} · 已交 ${c.hwS} · 已批改 ${c.hwG}` : '—'}</td>
      <td style="${VL_TD};white-space:nowrap">${vlEsc(c.last || '—')}</td>
    </tr>`;
    if (open) {
      const ls = g.items.slice().sort((a, b) => (b.b.slot_date || '').localeCompare(a.b.slot_date || ''));
      h += `<tr><td colspan="${cols}" style="padding:8px 10px;background:var(--bg,#f7f5f0);border-bottom:1px solid var(--border)">
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:var(--surface)">
        <thead><tr><th style="${VL_TH}">日期时间</th><th style="${VL_TH}">学生</th><th style="${VL_TH}">老师</th><th style="${VL_TH}">上课内容</th><th style="${VL_TH}">课时</th><th style="${VL_TH}">学生状态</th><th style="${VL_TH}">作业</th><th style="${VL_TH}">学生确认</th></tr></thead>
        <tbody>${ls.map(x => vlLessonRow(x, 8)).join('')}</tbody></table></div></td></tr>`;
    }
    return h;
  }).join('');
  return `<div style="font-size:11px;color:var(--text-3);margin-bottom:6px">共 ${stus.length} 人 · ${list.length} 节（总课时剩余 = 档案课时总数 − 已用）</div>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:4px">
    <thead><tr><th style="${VL_TH}">学生</th><th style="${VL_TH}">已上</th><th style="${VL_TH}">取消</th><th style="${VL_TH}">未记录</th><th style="${VL_TH}">本月课时</th><th style="${VL_TH}">总课时剩余</th><th style="${VL_TH}">作业完成</th><th style="${VL_TH}">最近上课</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${vlMoreBtn(stus.length)}`;
}
