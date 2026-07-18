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
let prExpanded = null;  // 展开的课程介绍条目 id

const PR_SECTIONS = [
  ['major_intro', '📖 专业介绍'],
  ['lecturer', '👤 讲师介绍'],
  ['course', '📚 课程介绍'],
];

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
    const jobs = [ sb(`/rest/v1/promo_content?major=eq.${prMajor}&select=*&order=sort_order.asc,created_at.asc`) ];
    if (!prCourses) jobs.push(sb('/rest/v1/courses?select=id,name,major,period,teacher,weekdays,time_range,delivery,campus,total_sessions,first_session_date&order=first_session_date.desc&limit=1000').catch(() => []));
    const res = await Promise.all(jobs);
    prData = { list: res[0] || [] };
    if (res[1]) prCourses = res[1];
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
      ${prEsc(c.teacher || '')} · ${prEsc(c.weekdays || '')} ${prEsc(c.time_range || '')} · 共${c.total_sessions || '-'}回 · ${dvLabel(c.delivery)}${c.campus ? ` · ${prEsc(c.campus)}` : ''}
    </div>
  </div>`).join('')}`;
}
