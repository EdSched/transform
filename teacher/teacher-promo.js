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

const PR_SECTIONS = [
  ['major_intro', '📖 专业介绍'],
  ['lecturer', '👤 讲师介绍'],
  ['course', '📚 课程介绍'],
  ['schedule', '🗓 当期课程表'],
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

async function renderTeacherPromo(mc) {
  mc.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const shareKeys = PR_SHAKAI_G.includes(prMajor) ? [prMajor, 'shakai_group'] : [prMajor];
    const jobs = [
      sb(`/rest/v1/promo_content?major=eq.${prMajor}&select=*&order=sort_order.asc,created_at.asc`),
      sb(`/rest/v1/course_schedule_shares?major=in.(${shareKeys.map(k=>`"${k}"`).join(',')})&select=*&order=created_at.desc&limit=1`).catch(() => []),
    ];
    if (!prCourses) jobs.push(sb('/rest/v1/courses?select=id,name,major,period,teacher,weekdays,time_range,delivery,campus,total_sessions,first_session_date&order=first_session_date.desc&limit=1000').catch(() => []));
    if (!prPubMap) jobs.push(sb('/rest/v1/teachers?select=name,notes').catch(() => []));
    const res = await Promise.all(jobs);
    prData = { list: res[0] || [], share: (res[1] || [])[0] || null, sessions: [] };
    if (res[2]) prCourses = res[2];
    if (res[3]) {
      prPubMap = {};
      const nrm = s => String(s || '').replace(/老师|先生|様|さん/g, '').trim();
      res[3].forEach(t => { const k = nrm(t.name); const pub = String(t.notes || '').trim(); if (k && pub) prPubMap[k] = pub; });
    }
    // 拉课表课次
    if (prData.share && (prData.share.course_ids || []).length) {
      const ids = prData.share.course_ids;
      let ss = [];
      for (let i = 0; i < ids.length; i += 40) {
        const batch = await sb(`/rest/v1/course_sessions?course_id=in.(${ids.slice(i,i+40).map(x=>`"${x}"`).join(',')})&select=course_id,course_name,session_date,time_range,session_number,session_title&order=session_date.asc`).catch(() => []);
        ss = ss.concat(batch || []);
      }
      prData.sessions = ss;
    }
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
    ${['shakai','shinpan','fukushi','keiei','keizai'].map(m => `<div class="filter-chip ${prMajor===m?'active':''}" onclick="prSetMajor('${m}')" style="padding:3px 10px;font-size:10px">${MAJORS[m]||m}</div>`).join('')}
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px">
    ${PR_SECTIONS.map(([k,l]) => `<button onclick="prSection='${k}';prExpanded=null;prRenderShell()" style="font-size:11px;padding:5px 14px;border-radius:3px;cursor:pointer;font-family:inherit;border:1px solid ${prSection===k?'var(--accent)':'var(--border)'};background:${prSection===k?'var(--accent)':'var(--surface)'};color:${prSection===k?'#fff':'var(--text-2)'}">${l}</button>`).join('')}
  </div>
  <div style="display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:8px 12px;margin-bottom:12px">
    <span style="font-size:10px;color:var(--text-3)">发给客户的宣传页链接：</span>
    <code id="pr_share_link" style="font-size:10px;color:var(--text-2);background:var(--bg);padding:2px 8px;border-radius:2px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${location.origin}${location.pathname.replace(/\/teacher\/.*$/,'/promo/')}?major=${prMajor}</code>
    <button onclick="navigator.clipboard.writeText(document.getElementById('pr_share_link').textContent).then(()=>{this.textContent='✓ 已复制';setTimeout(()=>this.textContent='📋 复制链接',2000)})" style="font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit;white-space:nowrap">📋 复制链接</button>
  </div>
  <div id="pr_body">${prBodyHtml()}</div>`;
}

function prSetMajor(m) {
  prMajor = m;
  prExpanded = null;
  renderTeacherPromo(document.getElementById('mainContent'));
}

function prBodyHtml() {
  if (prSection === 'schedule') return prScheduleHtml();
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

// ── 当期课程表（与对外宣传页同款日历；不含任何上课链接） ──
function prScheduleHtml() {
  const sessions = (prData && prData.sessions) || [];
  if (!sessions.length) return '<div class="empty" style="padding:30px">该专业暂无发布的课程表（admin 可在课程安排 → 学生课表中发布）</div>';
  const byCourse = {};
  sessions.forEach(s => { if (!byCourse[s.course_id]) byCourse[s.course_id] = []; byCourse[s.course_id].push(s); });
  const scs = Object.entries(byCourse)
    .map(([id, l]) => ({ id, name: l[0].course_name || '', first: l[0].session_date || '' }))
    .sort((a, b) => a.first.localeCompare(b.first))
    .map((c, i) => Object.assign(c, { color: PR_COLORS[i % PR_COLORS.length], info: (prCourses || []).find(x => x.id === c.id) || {} }));
  const colorOf = id => (scs.find(c => c.id === id) || {}).color || PR_COLORS[7];
  const dvL = v => v === '线下＋线上' ? '线上线下同步' : (v || '');

  const legend = `<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:8px 14px;margin-bottom:8px">
    ${scs.map(c => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-2)"><span style="width:10px;height:10px;border-radius:2px;background:${c.color[1]};border:1px solid ${c.color[0]};display:inline-block"></span>${prEsc(c.name)}</span>`).join('')}
  </div>
  <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:6px 14px;margin-bottom:12px">
    ${scs.map(c => { const inf = c.info; return `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:10px;padding:3px 0;border-bottom:1px dashed var(--border-light);color:var(--text-2)">
      <span style="display:inline-flex;align-items:center;gap:5px;min-width:110px"><span style="width:8px;height:8px;border-radius:2px;background:${c.color[1]};border:1px solid ${c.color[0]};display:inline-block"></span>${prEsc(c.name)}</span>
      ${inf.delivery?`<span>${dvL(inf.delivery)}</span>`:''}${inf.campus?`<span>📍 ${prEsc(inf.campus)}</span>`:''}${inf.weekdays?`<span>${prEsc(inf.weekdays)} ${prEsc(inf.time_range||'')}</span>`:''}
    </div>`; }).join('')}
  </div>`;

  const monday = ds => { const d = new Date(ds + 'T00:00:00'); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); };
  const weeks = {};
  sessions.forEach(s => { const m = monday(s.session_date); if (!weeks[m]) weeks[m] = []; weeks[m].push(s); });
  const wd = ['日','一','二','三','四','五','六'];
  const cal = Object.keys(weeks).sort().map((mon, wi) => {
    const l = weeks[mon];
    const ds2 = [...new Set(l.map(s => s.session_date))].sort();
    const ts2 = [...new Set(l.map(s => s.time_range || ''))].sort();
    let g = `<div style="margin-bottom:18px"><div style="font-size:10px;color:var(--text-3);letter-spacing:.08em;margin-bottom:4px">第 ${wi+1} 周</div>
    <div style="display:grid;grid-template-columns:74px repeat(${ds2.length},minmax(0,1fr));border:1px solid var(--border);border-radius:4px;overflow:hidden;background:var(--surface)">`;
    g += `<div style="background:var(--bg);padding:5px 4px;border-bottom:1px solid var(--border)"></div>`;
    ds2.forEach(dstr => {
      const d = new Date(dstr + 'T00:00:00');
      const isWk = d.getDay() === 0 || d.getDay() === 6;
      g += `<div style="background:var(--bg);padding:5px 3px;border-bottom:1px solid var(--border);border-left:1px solid var(--border-light);text-align:center">
        <div style="font-size:11px;font-weight:600;color:${isWk?'var(--accent)':'var(--text-2)'}">${d.getMonth()+1}/${d.getDate()}</div>
        <div style="font-size:9px;color:var(--text-3)">周${wd[d.getDay()]}</div></div>`;
    });
    ts2.forEach(t => {
      g += `<div style="padding:7px;border-bottom:1px solid var(--border-light);font-size:9px;color:var(--text-3);display:flex;align-items:center">${prEsc(t)}</div>`;
      ds2.forEach(dstr => {
        const evs = l.filter(s => s.session_date === dstr && (s.time_range || '') === t);
        g += `<div style="padding:3px;border-bottom:1px solid var(--border-light);border-left:1px solid var(--border-light);display:flex;flex-direction:column;gap:3px;justify-content:center">${evs.map(s => {
          if (s.session_title === '休讲') return `<div style="font-size:9px;text-align:center;padding:3px 2px;border-radius:2px;background:var(--bg);color:var(--text-3);border:1px dashed var(--border)">${prEsc(s.course_name||'')} 休讲</div>`;
          const col = colorOf(s.course_id);
          return `<div style="font-size:9px;text-align:center;padding:3px 2px;border-radius:2px;background:${col[1]};color:${col[0]};border:1px solid ${col[0]};line-height:1.4">${prEsc(s.course_name||'')}${s.session_number?`<div style="font-size:8px;opacity:.75">第${s.session_number}回${s.session_title?' '+prEsc(s.session_title):''}</div>`:''}</div>`;
        }).join('')}</div>`;
      });
    });
    g += `</div></div>`;
    return g;
  }).join('');

  return `<div style="font-size:11px;color:var(--text-2);margin-bottom:8px">🗓 ${prEsc((prData.share && prData.share.title) || '当期课程表')}<span style="font-size:9px;color:var(--text-3);margin-left:8px">（不含上课链接，可放心向客户展示）</span></div>${legend}${cal}`;
}
