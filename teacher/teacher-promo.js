// ══════════════════════════════════
// teacher-promo.js — 宣传相关（营业用，需 promo 权限）
// 按专业浏览：专业介绍 / 讲师介绍 / 课程介绍
// 课程介绍条目点击可展开该课程名在课程安排中的当期开课信息（校区/形式/时间等）；
// 没有匹配的课程安排时提示「本期不开放」
// 依赖：shared/constants.js、shared/supabase.js、teacher.js（须在其后加载）
// ══════════════════════════════════
let prMajor = 'shakai';
let prSection = 'major_intro';
let prData = null;      // { list: promo_content rows }
let prCourses = null;   // 课程安排缓存（全专业一次拉取）
let prPubMap = null;    // 真名(去敬称) → 对外宣传姓名（老师档案「备注」）
let prExpanded = null;  // 展开的课程介绍条目 id
let prSchedMode = 'next';   // 课程表用哪一期：next 下一期（默认，学生报名后上的课）| cur 当期 | share 已发布的学生课表

// 当期 / 下一期（按月份：1-3月=1月期，4-6月=4月期，7-9月=7月期，10-12月=10月期）
function prPeriodKeys() {
  const order = ['1月期', '4月期', '7月期', '10月期'];
  const y = new Date().getFullYear();
  const cur = currentPeriodKey(), i = order.indexOf(cur);
  const ny = i === 3 ? y + 1 : y, next = order[(i + 1) % 4];
  return { cur: { year: y, name: cur, label: `${y}年${cur}` }, next: { year: ny, name: next, label: `${ny}年${next}` } };
}
function prSchedModeSelect(onchange) {
  const k = prPeriodKeys();
  return `<select onchange="${onchange}" style="font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
    ${[['next', `下一期（${k.next.label}）`], ['cur', `当期（${k.cur.label}）`], ['share', '已发布的学生课表']].map(([v, l]) => `<option value="${v}" ${prSchedMode === v ? 'selected' : ''}>${l}</option>`).join('')}
  </select>`;
}
// 有已发布宣传内容的专业（跟随 admin 宣传管理；「宣传相关」「宣传资料整合」共用，进入页面时查一次后缓存）
let prMajorsCache = null;
const PR_MAJORS_FALLBACK = ['shakai', 'shinpan', 'fukushi', 'keiei', 'keizai'];
async function prAvailableMajors() {
  if (prMajorsCache) return prMajorsCache;
  let rows;
  try { rows = await sbAll('/rest/v1/promo_content?or=(published.is.null,published.is.true)&select=major'); }
  catch (e) { return PR_MAJORS_FALLBACK; }   // 查询失败不缓存，下次再试
  const order = majorFilterKeys();
  const idx = k => { const i = order.indexOf(k); return i < 0 ? 9999 : i; };
  prMajorsCache = [...new Set((rows || []).map(r => r.major).filter(Boolean))].sort((a, b) => idx(a) - idx(b) || a.localeCompare(b));
  return prMajorsCache;
}
function prMajorName(k) { return k === 'shakai_group' ? '社会人文' : (MAJORS[k] || (typeof majorLabel === 'function' ? majorLabel(k) : '') || k); }

function prSetSchedMode(v) { prSchedMode = v; renderTeacherPromo(document.getElementById('mainContent')); }

const PR_SECTIONS = [
  ['major_intro', '📖 专业介绍'],
  ['lecturer', '👤 讲师介绍'],
  ['course', '📚 课程介绍'],
  ['schedule', '🗓 课程表'],
];
const PR_COLORS = [['#5a3e28','#f5ede3'],['#2a6aad','#e4eef8'],['#2d5a3d','#e4f0e8'],['#a03a2e','#f8e4dc'],['#6a4a7a','#efe4f4'],['#8a6a1b','#f8f0d8'],['#3a7a7a','#e0f0f0'],['#5a5650','#eee8e0']];
const PR_SHAKAI_G = ['shakai','shinpan','fukushi'];

function prEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// 与对外宣传页同款的迷你排版渲染：#小标题 / **粗体** / -列表 / 1.列表 / |表格|
function prInline(s) { return prEsc(s).replace(/\*\*(.+?)\*\*/g, '<b style="color:var(--text-1,#1a1814);font-weight:600">$1</b>'); }
function prMd(body) {
  const lines = String(body || '').replace(/\r/g, '').split('\n');
  let out = '', i = 0, buf = [];
  const flush = () => { if (buf.length) { out += `<p style="margin:0 0 8px">${buf.map(prInline).join('<br>')}</p>`; buf = []; } };
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { flush(); i++; continue; }
    if (/^#{1,3}/.test(t)) { flush(); out += `<div style="font-family:'Noto Serif SC',serif;font-size:13px;font-weight:600;color:var(--text-1,#1a1814);margin:14px 0 6px;padding-bottom:3px;border-bottom:1px dashed var(--border)">${prInline(t.replace(/^#{1,3}\s*/, ''))}</div>`; i++; continue; }
    if (/^\|.*\|$/.test(t)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { rows.push(lines[i].trim()); i++; }
      const cells = r => r.slice(1, -1).split('|').map(c => prInline(c.trim()));
      const body2 = rows.slice(1).filter(r => !/^\|[\s:\-|]+\|$/.test(r));
      out += `<div style="overflow-x:auto;margin:6px 0 12px"><table style="border-collapse:collapse;width:100%;min-width:380px;background:var(--surface)">
        <thead><tr>${cells(rows[0]).map(c => `<th style="background:var(--bg);color:var(--accent);font-size:10px;font-weight:600;text-align:left;padding:6px 10px;border:1px solid var(--border);white-space:nowrap">${c}</th>`).join('')}</tr></thead>
        <tbody>${body2.map(r => `<tr>${cells(r).map(c => `<td style="font-size:11px;color:var(--text-2);padding:6px 10px;border:1px solid var(--border-light)">${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
      continue;
    }
    // 兜底：连续两行以上、每行都含 Tab 的文字（如从 Excel 粘贴）也显示成表格，按 Tab 分列，首行作表头
    if (/\t/.test(lines[i]) && i + 1 < lines.length && /\t/.test(lines[i + 1]) && lines[i + 1].trim()) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim() && /\t/.test(lines[i])) { rows.push(lines[i].replace(/\s+$/, '').split('\t').map(c => prInline(c.trim()))); i++; }
      const n = Math.max(...rows.map(r => r.length));
      const pad = r => r.concat(Array(n - r.length).fill(''));
      out += `<div style="overflow-x:auto;margin:6px 0 12px"><table style="border-collapse:collapse;width:100%;min-width:380px;background:var(--surface)">
        <thead><tr>${pad(rows[0]).map(c => `<th style="background:var(--bg);color:var(--accent);font-size:10px;font-weight:600;text-align:left;padding:6px 10px;border:1px solid var(--border);white-space:nowrap">${c}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(1).map(r => `<tr>${pad(r).map(c => `<td style="font-size:11px;color:var(--text-2);padding:6px 10px;border:1px solid var(--border-light)">${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
      continue;
    }
    if (/^[-・]\s?/.test(t)) {
      flush();
      const items = [];
      while (i < lines.length && /^[-・]\s?/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-・]\s?/, '')); i++; }
      out += `<ul style="margin:4px 0 10px 1.4em">${items.map(x => `<li style="margin-bottom:4px">${prInline(x)}</li>`).join('')}</ul>`;
      continue;
    }
    if (/^\d+[.、]\s?/.test(t)) {
      flush();
      const items = [];
      while (i < lines.length && /^\d+[.、]\s?/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+[.、]\s?/, '')); i++; }
      out += `<ol style="margin:4px 0 10px 1.4em">${items.map(x => `<li style="margin-bottom:4px">${prInline(x)}</li>`).join('')}</ol>`;
      continue;
    }
    buf.push(t); i++;
  }
  flush();
  return out;
}

// 拉取某专业的宣传数据（宣传相关页与「宣传资料整合」共用）
// 返回 { list, share, sessions }；同时确保 prCourses / prPubMap 缓存已加载
async function prFetchMajor(major, mode) {
  mode = mode || prSchedMode;
  const shareKeys = PR_SHAKAI_G.includes(major) ? [major, 'shakai_group'] : [major];
  const jobs = [
    sb(`/rest/v1/promo_content?major=eq.${major}&select=*&order=sort_order.asc,created_at.asc`),
    sb(`/rest/v1/course_schedule_shares?major=in.(${shareKeys.map(k=>`"${k}"`).join(',')})&select=*&order=created_at.desc&limit=1`).catch(() => []),
    prCourses ? Promise.resolve(null) : sbAll('/rest/v1/courses?select=id,name,major,period,period_override,course_type,teacher,weekdays,time_range,delivery,campus,total_sessions,first_session_date&order=first_session_date.desc').catch(() => []),
    prPubMap ? Promise.resolve(null) : sb('/rest/v1/teachers?select=name,notes').catch(() => []),
  ];
  const res = await Promise.all(jobs);
  const data = { list: res[0] || [], share: (res[1] || [])[0] || null, sessions: [] };
  if (res[2]) prCourses = res[2];
  if (res[3]) {
    prPubMap = {};
    const nrm = s => String(s || '').replace(/老师|先生|様|さん/g, '').trim();
    res[3].forEach(t => { const k = nrm(t.name); const pub = String(t.notes || '').trim(); if (k && pub) prPubMap[k] = pub; });
  }
  // 当期 / 下一期：直接按课程安排里这个专业、这一期的课（不含 VIP 课）
  if (mode === 'cur' || mode === 'next') {
    const p = prPeriodKeys()[mode];
    const ids = (prCourses || []).filter(c => c.first_session_date && c.first_session_date.startsWith(String(p.year))
      && effectivePeriod(c) === p.name && !String(c.course_type || '').includes('VIP')
      && (Array.isArray(c.major) ? c.major : [c.major]).some(m => shareKeys.includes(m))).map(c => c.id);
    data.share = { title: `${p.label} 课程表`, course_ids: ids, empty: `${p.label} 该专业暂无课程（可在上方切换到其他期）` };
  }
  // 拉课表课次
  if (data.share && (data.share.course_ids || []).length) {
    const ids = data.share.course_ids;
    let ss = [];
    for (let i = 0; i < ids.length; i += 40) {
      const batch = await sb(`/rest/v1/course_sessions?course_id=in.(${ids.slice(i,i+40).map(x=>`"${x}"`).join(',')})&select=course_id,course_name,session_date,time_range,session_number,session_title&order=session_date.asc`).catch(() => []);
      ss = ss.concat(batch || []);
    }
    data.sessions = ss;
  }
  return data;
}

async function renderTeacherPromo(mc) {
  mc.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const majors = await prAvailableMajors();
    if (majors.length && !majors.includes(prMajor)) prMajor = majors[0];
    prData = await prFetchMajor(prMajor);
  } catch (e) { mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }
  prRenderShell();
}

function prRenderShell() {
  const mc = document.getElementById('mainContent');
  if (!mc || !prData) return;
  mc.innerHTML = `
  <div class="page-header"><div class="section-title">📣 宣传相关</div></div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px">
    <span style="font-size:10px;color:var(--text-3)">专业：</span>
    ${(prMajorsCache || PR_MAJORS_FALLBACK).map(m => `<div class="filter-chip ${prMajor===m?'active':''}" onclick="prSetMajor('${m}')" style="padding:3px 10px;font-size:10px">${prEsc(prMajorName(m))}</div>`).join('') || '<span style="font-size:10px;color:var(--text-3)">admin 还没有录入任何专业的宣传内容</span>'}
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px">
    ${PR_SECTIONS.map(([k,l]) => `<button onclick="prSection='${k}';prExpanded=null;prRenderShell()" style="font-size:11px;padding:5px 14px;border-radius:3px;cursor:pointer;font-family:inherit;border:1px solid ${prSection===k?'var(--accent)':'var(--border)'};background:${prSection===k?'var(--accent)':'var(--surface)'};color:${prSection===k?'#fff':'var(--text-2)'}">${l}</button>`).join('')}
  </div>
  <div style="display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:8px 12px;margin-bottom:12px">
    <span style="font-size:10px;color:var(--text-3)">发给客户的宣传页链接：</span>
    <code id="pr_share_link" style="font-size:10px;color:var(--text-2);background:var(--bg);padding:2px 8px;border-radius:2px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${location.origin}${location.pathname.replace(/\/teacher\/.*$/,'/promo/')}?major=${prMajor}</code>
    <button onclick="navigator.clipboard.writeText(document.getElementById('pr_share_link').textContent).then(()=>{this.textContent='✓ 已复制';setTimeout(()=>this.textContent='📋 复制链接',2000)})" style="font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit;white-space:nowrap">📋 复制链接</button>
  </div>
  ${typeof pkEnabled === 'function' && pkEnabled() ? `<div style="display:flex;align-items:center;gap:8px;margin:-4px 0 12px;flex-wrap:wrap">
    <button onclick="pkAddMajorFromPromo()" style="font-size:11px;background:var(--surface);border:1px solid var(--accent);color:var(--accent);border-radius:3px;padding:4px 14px;cursor:pointer;font-family:inherit">➕ 将「${MAJORS[prMajor]||prMajor}」学科介绍加入宣传资料</button>
    <span style="font-size:10px;color:var(--text-3)">加入后可在「📦 宣传资料整合」与出愿学校、进度规划等一起生成一份完整 PDF</span>
  </div>` : ''}
  <div id="pr_body">${prBodyHtml()}</div>`;
}

function prSetMajor(m) {
  prMajor = m;
  prExpanded = null;
  renderTeacherPromo(document.getElementById('mainContent'));
}

function prBodyHtml() {
  if (prSection === 'schedule') return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="font-size:10px;color:var(--text-3)">课程表期数：</span>${prSchedModeSelect('prSetSchedMode(this.value)')}</div>` + prScheduleHtml();
  const list = (prData.list || []).filter(p => p.section === prSection);
  if (!list.length) return '<div class="empty" style="padding:30px">该板块暂无内容（admin 可在「宣传管理」中录入）</div>';

  if (prSection === 'course') {
    // 课程介绍：可点击展开关联的课程安排
    return list.map(p => {
      const open = prExpanded === p.id;
      return `<div style="border:1px solid var(--border);border-radius:4px;overflow:hidden;margin-bottom:8px;background:var(--surface)">
        <div onclick="prExpanded=prExpanded==='${p.id}'?null:'${p.id}';prRenderBody()" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;user-select:none;${open?'background:var(--bg)':''}">
          <span style="font-size:13px;font-weight:600">${prEsc(p.title)}</span>
          <span style="font-size:10px;color:var(--text-3);margin-left:auto">${open?'▾ 收起':'▸ 课程详情与当期开课'}</span>
        </div>
        ${open ? `<div style="border-top:1px solid var(--border-light);padding:12px 14px">
          <div style="font-size:12px;line-height:2;color:var(--text-2);margin-bottom:12px">${prMd(p.body)}</div>
          ${prCourseScheduleHtml(p.title)}
        </div>` : ''}
      </div>`;
    }).join('');
  }

  // 专业介绍 / 讲师介绍：直接铺开阅读
  return list.map(p => `
  <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px 16px;margin-bottom:10px">
    <div style="font-size:13px;font-weight:600;margin-bottom:8px;font-family:'Noto Serif SC',serif">${prEsc(p.title)}</div>
    <div style="font-size:12px;line-height:2;color:var(--text-2)">${prMd(p.body)}</div>
  </div>`).join('');
}

function prRenderBody() {
  const box = document.getElementById('pr_body');
  if (box) box.innerHTML = prBodyHtml();
}

// 老师名 → 对外宣传姓名（多位以 / 分隔逐个映射）
function prPubTeacher(t) {
  const nrm = s => String(s || '').replace(/老师|先生|様|さん/g, '').trim();
  return String(t || '').split(/[\/、,，]/).map(x => x.trim()).filter(Boolean)
    .map(x => (prPubMap && prPubMap[nrm(x)]) || x).join(' / ');
}

// 按课程名匹配课程安排，展示当期开课信息
function prCourseScheduleHtml(title) {
  const name = (title || '').trim();
  const matches = (prCourses || []).filter(c => (c.name || '').trim() === name);
  if (!matches.length) {
    return `<div style="background:var(--bg);border:1px dashed var(--border);border-radius:3px;padding:10px 14px;font-size:11px;color:var(--warn,#b8860b)">📅 本期暂未开设此课程，请咨询下一期开课安排</div>`;
  }
  // 最新一期在前（courses 已按首回日期倒序）
  const dvLabel = v => v === '线下＋线上' ? '线上线下同步' : (v || '—');
  return `<div style="font-size:10px;color:var(--text-3);margin-bottom:6px">📅 课程安排中的开课记录（新→旧）：</div>
  ${matches.slice(0, 4).map((c, i) => `
  <div style="background:${i===0?'var(--ok-bg,#e2f3ea)':'var(--bg)'};border:1px solid var(--border-light);border-radius:3px;padding:8px 12px;margin-bottom:5px;font-size:11px">
    <span style="font-weight:600">${prEsc(c.period || '')}${c.first_session_date ? `（${c.first_session_date.slice(0,7)}开课）` : ''}</span>
    ${i===0?'<span style="font-size:9px;background:var(--ok,#2a9e6a);color:#fff;border-radius:2px;padding:0 5px;margin-left:4px">最新</span>':''}
    <div style="color:var(--text-2);margin-top:3px">
      ${prEsc(prPubTeacher(c.teacher))} · ${prEsc(c.weekdays || '')} ${prEsc(c.time_range || '')} · 共${c.total_sessions || '-'}回 · ${dvLabel(c.delivery)}${c.campus ? ` · ${prEsc(c.campus)}` : ''}
    </div>
  </div>`).join('')}`;
}

// ── 课程表（当期 / 下一期 / 已发布；与对外宣传页同款日历；不含任何上课链接） ──
// data：{ share, sessions }（默认当前页 prData）；forClient=true 时去掉内部提示语（用于对外资料）
function prScheduleHtml(data, forClient) {
  data = data || prData;
  const sessions = (data && data.sessions) || [];
  if (!sessions.length) return `<div class="empty" style="padding:30px">${prEsc((data && data.share && data.share.empty) || '该专业暂无发布的课程表（admin 可在课程安排 → 学生课表中发布）')}</div>`;
  // 课程配色：按首次上课日期排序后依次取 PR_COLORS（[文字色, 底色]）
  const byCourse = {};
  sessions.forEach(s => { if (!byCourse[s.course_id]) byCourse[s.course_id] = []; byCourse[s.course_id].push(s); });
  const scs = Object.entries(byCourse)
    .map(([id, l]) => ({ id, name: l[0].course_name || '', first: l[0].session_date || '' }))
    .sort((a, b) => a.first.localeCompare(b.first))
    .map((c, i) => Object.assign(c, { color: PR_COLORS[i % PR_COLORS.length] }));
  const colorOf = id => (scs.find(c => c.id === id) || {}).color || PR_COLORS[7];

  // 图例：色块 + 课程名，一行排开（放不下自动换行）
  const legend = `<div style="display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #e2ded6">
    ${scs.map(c => `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#5a5650"><i style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${c.color[1]};border:1px solid ${c.color[0]}"></i>${prEsc(c.name)}</span>`).join('')}
  </div>`;

  // 月历（参照 sched/timetable.html 的 buildMonth）：每月一块，固定 7 列（周一～周日）
  const SAT = '#1a4a8a', SUN = '#8a1a2c';
  const byDate = {};
  sessions.forEach(s => { (byDate[s.session_date] = byDate[s.session_date] || []).push(s); });
  const months = [...new Set(sessions.map(s => (s.session_date || '').slice(0, 7)).filter(Boolean))].sort();
  const tm = t => String(t || '').replace(/\s*[-~〜～]\s*/, '–');
  const cal = months.map(mon => {
    const [y, m] = mon.split('-').map(Number);
    const startCol = (new Date(y, m - 1, 1).getDay() + 6) % 7;   // 0=周一
    const days = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < startCol; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);
    const head = ['周一','周二','周三','周四','周五','周六','周日'].map((d, i) =>
      `<div style="background:#f7f5f0;padding:6px 4px 5px;text-align:center;border-bottom:1px solid #e2ded6;${i ? 'border-left:1px solid #ede9e2;' : ''}font-size:10px;font-weight:500;letter-spacing:.04em;color:${i === 5 ? SAT : i === 6 ? SUN : '#5a5650'}">${d}</div>`).join('');
    const body = cells.map((d, idx) => {
      const bl = idx % 7 ? 'border-left:1px solid #ede9e2;' : '';
      if (d === null) return `<div style="min-height:72px;background:#faf8f4;border-top:1px solid #ede9e2;${bl}"></div>`;
      const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const w = new Date(y, m - 1, d).getDay();
      const evs = (byDate[ds] || []).slice().sort((a, b) => String(a.time_range || '').localeCompare(String(b.time_range || '')));
      return `<div style="min-height:72px;min-width:0;padding:4px;border-top:1px solid #ede9e2;${bl}display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere">
        <div style="font-size:10px;font-weight:500;color:${w === 6 ? SAT : w === 0 ? SUN : '#9a9590'}">${d}</div>
        ${evs.map(s => {
          const sub = s.session_number ? `第${s.session_number}回${s.session_title && s.session_title !== '休讲' ? ' ' + prEsc(s.session_title) : ''}` : '';
          if (s.session_title === '休讲') {
            return `<div style="border-radius:3px;padding:2px 4px;font-size:10px;line-height:1.35;background:#f0ede8;color:#9a9590;text-decoration:line-through">${prEsc(tm(s.time_range))} ${prEsc(s.course_name || '')}<small style="display:block;font-size:9px;text-decoration:none">休讲</small></div>`;
          }
          const col = colorOf(s.course_id);
          return `<div style="border-radius:3px;padding:2px 4px;font-size:10px;font-weight:500;line-height:1.35;background:${col[1]};color:${col[0]}">${prEsc(tm(s.time_range))} ${prEsc(s.course_name || '')}${sub ? `<small style="display:block;font-size:9px;font-weight:400;opacity:.75">${sub}</small>` : ''}</div>`;
        }).join('')}
      </div>`;
    }).join('');
    return `<div style="margin-bottom:20px;page-break-inside:avoid;break-inside:avoid">
      <div style="font-size:12px;font-weight:600;letter-spacing:.06em;color:#1a1814;margin-bottom:6px">${y}年 ${m}月</div>
      <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border:1px solid #e2ded6;border-radius:4px;overflow:hidden;background:#fff">${head}${body}</div>
    </div>`;
  }).join('');

  return `<div style="font-size:11px;color:var(--text-2);margin-bottom:8px">🗓 ${prEsc((data.share && data.share.title) || '当期课程表')}${forClient ? '' : '<span style="font-size:9px;color:var(--text-3);margin-left:8px">（不含上课链接，可放心向客户展示）</span>'}</div>${legend}${cal}`;
}
