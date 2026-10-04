// ══════════════════════════════════
// promo-render.js — 专业介绍页的共用渲染（对外宣传页 promo/index.html、老师端「宣传相关」、宣传资料整合 PDF 三处共用）
// 内容仍存 promo_content.body，用固定的「## 小标题」分段：
//   专业介绍：概要 / 独特视角 / 优势 / 重点方向 / 研究课题例 / 重点研究科（其余 ## 段落和自由书写原样显示在「补充说明」）
//   课程介绍：课时摘要 / 课程描述 / 课程目标 / 课程大纲（表格：回 / 主题 / 重点内容 / 课时）
// 样式全部限定在 .pm 容器内，变量名带 --pm- 前缀，不影响所在页面
// ══════════════════════════════════
const PMR_INTRO_LABELS = ['概要', '独特视角', '优势', '重点方向', '研究课题例', '重点研究科'];
const PMR_COURSE_LABELS = ['课时摘要', '课程描述', '课程目标', '课程大纲'];
// 课程色块（月课表 / 宣传页课程表共用）：[文字色, 底色]；最后一个是兜底色
const PMR_COLORS = [['#4f7194', '#e9eef3'], ['#b25a74', '#f6e8ec'], ['#5b7f55', '#ebf0e8'], ['#c9831f', '#f8eedd'], ['#7a68a3', '#eeebf4'], ['#3a342e', '#f3ece4']];

function pmEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function pmInline(s) { return pmEsc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }

// ── 迷你排版：## 小标题 / **粗体** / - 列表 / 1. 列表 / |表格|（首行表头）/ 含 Tab 的连续行（Excel 粘贴）──
function pmTableHtml(head, rows, cls) {
  const n = Math.max(head.length, ...rows.map(r => r.length));
  const pad = r => r.concat(Array(n - r.length).fill(''));
  return `<div class="pm-scroll"><table class="pm-tbl ${cls || ''}"><thead><tr>${pad(head).map(c => `<th>${pmInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${pad(r).map(c => `<td>${pmInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const pmPipeRow = l => /^\|.*\|$/.test(l.trim());
const pmPipeCells = l => l.trim().slice(1, -1).split('|').map(c => c.trim());
function pmMd(body) {
  const lines = String(body || '').replace(/\r/g, '').split('\n');
  let out = '', i = 0, buf = [];
  const flush = () => { if (buf.length) { out += `<p>${buf.map(pmInline).join('<br>')}</p>`; buf = []; } };
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { flush(); i++; continue; }
    if (/^#{1,3}/.test(t)) { flush(); out += `<div class="pm-subhead">${pmInline(t.replace(/^#{1,3}\s*/, ''))}</div>`; i++; continue; }
    if (pmPipeRow(t)) {
      flush();
      const rows = [];
      while (i < lines.length && pmPipeRow(lines[i])) { rows.push(lines[i].trim()); i++; }
      const body2 = rows.slice(1).filter(r => !/^\|[\s:\-|]+\|$/.test(r));
      out += pmTableHtml(pmPipeCells(rows[0]), body2.map(pmPipeCells));
      continue;
    }
    if (/\t/.test(lines[i]) && i + 1 < lines.length && /\t/.test(lines[i + 1]) && lines[i + 1].trim()) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim() && /\t/.test(lines[i])) { rows.push(lines[i].replace(/\s+$/, '').split('\t').map(c => c.trim())); i++; }
      out += pmTableHtml(rows[0], rows.slice(1));
      continue;
    }
    if (/^[-・]\s?/.test(t)) {
      flush();
      const items = [];
      while (i < lines.length && /^[-・]\s?/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-・]\s?/, '')); i++; }
      out += `<ul class="pm-list">${items.map(x => `<li>${pmInline(x)}</li>`).join('')}</ul>`;
      continue;
    }
    if (/^\d+[.、]\s?/.test(t)) {
      flush();
      const items = [];
      while (i < lines.length && /^\d+[.、]\s?/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+[.、]\s?/, '')); i++; }
      out += `<ol class="pm-list">${items.map(x => `<li>${pmInline(x)}</li>`).join('')}</ol>`;
      continue;
    }
    buf.push(t); i++;
  }
  flush();
  return out;
}

// ── 按「## 小标题」把 body 拆成各字段 ──
// 返回 { vals:{标签:文字}, known:有几个已知标签段, pre:第一个 ## 之前的文字, extras:[{label,text}]（不认识的 ## 段）, rest:pre+extras 还原成的文字 }
function pmSplit(body, labels) {
  const lines = String(body || '').replace(/\r/g, '').split('\n');
  const secs = [{ label: null, lines: [] }];
  lines.forEach(l => {
    const m = l.match(/^##(?!#)\s*(.*?)\s*$/);
    if (m && m[1]) secs.push({ label: m[1], lines: [] }); else secs[secs.length - 1].lines.push(l);
  });
  const vals = {}, extras = []; let known = 0, pre = '';
  secs.forEach(s => {
    const text = s.lines.join('\n').trim();
    if (s.label == null) { pre = text; return; }
    if (labels.includes(s.label)) { known++; vals[s.label] = vals[s.label] ? vals[s.label] + '\n' + text : text; }
    else extras.push({ label: s.label, text });
  });
  const rest = [pre].concat(extras.map(e => '## ' + e.label + (e.text ? '\n' + e.text : ''))).filter(Boolean).join('\n\n');
  return { vals, known, pre, extras, rest };
}

// ── 样式 ──
function pmrVarsCss() {
  return '--pm-bg:#fcf8f4;--pm-surface:#fff;--pm-line:#d9cfc4;--pm-line2:#e8dfd5;--pm-text:#3a342e;--pm-title:#2e2924;--pm-muted:#8a7f74;--pm-accent:#f2a93b;--pm-accent-bg:#f8eac2;--pm-blue:#4f7194;--pm-pink:#b25a74;--pm-green:#5b7f55;--pm-orange:#c9831f;--pm-purple:#7a68a3;--pm-chip:#f3ece4;';
}
// root=true 时变量同时挂在 :root 上（对外宣传页自己的样式也要用）
function pmrCss(root) {
  return `${root ? ':root,' : ''}.pm{${pmrVarsCss()}}
.pm{color:var(--pm-text);font-size:12.5px;line-height:1.8;min-width:0}
.pm *{box-sizing:border-box}
.pm-sec{margin:0 0 2.2rem}
.pm-label{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--pm-muted);margin-bottom:.5rem;display:flex;align-items:center;gap:8px}
.pm-label::before{content:'';display:block;width:16px;height:1px;background:var(--pm-line)}
.pm-title{font-family:'Noto Serif SC',serif;font-size:1.3rem;font-weight:600;line-height:1.3;color:var(--pm-title);margin:0 0 1rem;padding-left:10px;border-left:3px solid var(--pm-accent)}
.pm-title-row{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}
.pm-title-row .pm-title{flex:1;min-width:0}
.pm-btn{font-family:inherit;font-size:11px;color:var(--pm-text);background:var(--pm-surface);border:1px solid var(--pm-line);border-radius:3px;padding:3px 12px;cursor:pointer}
.pm-btn:hover{background:var(--pm-chip)}
.pm-card{background:var(--pm-surface);border:1px solid var(--pm-line2);border-radius:5px;padding:1.1rem 1.3rem;min-width:0}
.pm-card>h3{font-family:'Noto Serif SC',serif;font-size:14px;font-weight:600;color:var(--pm-title);margin:0 0 .7rem;padding-bottom:.5rem;border-bottom:1px solid var(--pm-line2)}
.pm-two{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.pm-stack>*+*{margin-top:.8rem}
.pm-rich p{margin:0 0 .6rem;color:var(--pm-text)}
.pm-rich p:last-child{margin-bottom:0}
.pm-rich b{color:var(--pm-title);font-weight:600}
.pm-subhead{font-family:'Noto Serif SC',serif;font-size:13px;font-weight:600;color:var(--pm-title);margin:.9rem 0 .5rem;padding-bottom:3px;border-bottom:1px dashed var(--pm-line)}
.pm-list{margin:.2rem 0 .7rem 1.4em;padding:0}
.pm-list li{margin-bottom:.3rem;color:var(--pm-text)}
.pm-list li::marker{color:var(--pm-accent)}
.pm-scroll{overflow-x:auto;margin:.4rem 0 .8rem;max-width:100%}
.pm-tbl{width:100%;border-collapse:collapse;font-size:11px;background:var(--pm-surface);border:1px solid var(--pm-line)}
.pm-tbl th{background:var(--pm-chip);color:var(--pm-muted);font-size:10px;font-weight:600;letter-spacing:.04em;text-align:left;padding:7px 12px;border-bottom:1px solid var(--pm-line);white-space:nowrap}
.pm-tbl td{padding:8px 12px;border-bottom:1px solid var(--pm-line2);color:var(--pm-text);vertical-align:top;line-height:1.6}
.pm-tbl tbody tr:nth-child(even) td{background:var(--pm-bg)}
.pm-tbl tr:last-child td{border-bottom:none}
.pm-tbl thead{display:table-header-group}
.pm-tbl tr{break-inside:avoid;page-break-inside:avoid}
.pm-schools{min-width:460px}
.pm-schools td:first-child{font-weight:600;color:var(--pm-title)}
.pm-outline{min-width:300px}
.pm-outline th,.pm-outline td{padding-left:8px;padding-right:8px}
.pm-outline th:first-child,.pm-outline td:first-child{text-align:center;width:36px;color:var(--pm-muted)}
.pm-outline td:nth-child(2){font-weight:600;color:var(--pm-title);width:26%}
.pm-outline th:last-child,.pm-outline td:last-child{text-align:center;width:44px;color:var(--pm-muted);white-space:nowrap}
.pm-note{font-size:10.5px;color:var(--pm-muted);margin-top:.5rem;line-height:1.7}
/* 为什么选择：编号卡片 */
.pm-adv{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}
.pm-adv-item{background:var(--pm-surface);border:1px solid var(--pm-line2);border-radius:5px;padding:1rem 1.2rem;min-width:0;break-inside:avoid;page-break-inside:avoid}
.pm-adv-num{font-family:'DM Mono',monospace;font-size:20px;line-height:1;font-weight:500;color:var(--pm-accent);margin-bottom:.5rem}
.pm-adv-title{font-size:13px;font-weight:700;color:var(--pm-title);margin-bottom:.3rem}
.pm-adv-desc{font-size:11.5px;color:var(--pm-text);line-height:1.7}
/* chip */
.pm-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:.9rem}
.pm-chip{display:inline-block;background:var(--pm-chip);color:var(--pm-text);font-size:11px;padding:2px 10px;border-radius:3px;border:1px solid var(--pm-line2)}
.pm-sublabel{font-size:10px;letter-spacing:.08em;color:var(--pm-muted);margin:0 0 .5rem}
/* 课程卡片 */
.pm-courses>.pm-course+.pm-course{margin-top:.9rem}
.pm-course{background:var(--pm-surface);border:1px solid var(--pm-line);border-radius:5px;overflow:hidden;break-inside:avoid;page-break-inside:avoid;scroll-margin-top:70px}
.pm-chead{display:flex;align-items:baseline;gap:6px 12px;flex-wrap:wrap;padding:.8rem 1.1rem;cursor:pointer;user-select:none}
.pm-chead:hover{background:var(--pm-bg)}
.pm-cname{font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600;color:var(--pm-title)}
.pm-tch{font-size:11px;color:var(--pm-muted)}
.pm-tch a{color:var(--pm-orange);cursor:pointer;border-bottom:1px dashed var(--pm-orange);text-decoration:none}
.pm-cmeta{margin-left:auto;display:flex;align-items:baseline;gap:10px}
.pm-hours{font-family:'DM Mono',monospace;font-size:11px;color:var(--pm-muted)}
.pm-arrow{font-size:11px;color:var(--pm-muted);transition:transform .2s}
.pm-course.open .pm-arrow{transform:rotate(180deg)}
.pm-cbody{display:none;padding:.2rem 1.1rem 1.1rem;border-top:1px solid var(--pm-line2)}
.pm-course.open .pm-cbody{display:block}
.pm-cdesc{margin:.8rem 0 1rem;color:var(--pm-text)}
.pm-goal{background:var(--pm-bg);border:1px solid var(--pm-line2);border-radius:4px;padding:.7rem 1rem;margin-bottom:1rem}
.pm-goal-title{font-size:10px;letter-spacing:.1em;color:var(--pm-muted);margin-bottom:.4rem}
.pm-goal-row{display:flex;gap:8px;align-items:baseline;margin-bottom:.3rem;font-size:11.5px;color:var(--pm-text)}
.pm-goal-row:last-child{margin-bottom:0}
.pm-tag{flex-shrink:0;background:var(--pm-accent-bg);color:var(--pm-orange);font-size:10px;padding:0 8px;border-radius:3px}
.pm-sched{margin-top:1rem;background:#ebf0e8;border-radius:4px;padding:8px 14px}
.pm-sched.closed{background:var(--pm-accent-bg)}
.pm-stag{font-size:9px;letter-spacing:.12em;color:var(--pm-green)}
.pm-sched.closed .pm-stag{color:var(--pm-orange)}
.pm-sline{font-size:11.5px;color:var(--pm-title)}
.pm-print .pm-cbody{display:block}
.pm-print .pm-scroll{overflow:visible}
.pm-print .pm-schools,.pm-print .pm-outline{min-width:0}
.pm-print .pm-sec{margin-bottom:1.4rem}
.pm-print .pm-chead{cursor:default}
.pm-print .pm-arrow{display:none}
/* 讲师 */
.pm-lects{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.pm-lect{background:var(--pm-surface);border:1px solid var(--pm-line2);border-radius:5px;overflow:hidden;min-width:0;break-inside:avoid;page-break-inside:avoid;scroll-margin-top:70px}
.pm-lhead{padding:.9rem 1.1rem;background:var(--pm-bg);border-bottom:1px solid var(--pm-line2)}
.pm-lname{font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600;color:var(--pm-title)}
.pm-laffil{font-size:10px;color:var(--pm-muted);line-height:1.5;margin-top:2px}
.pm-lbody{padding:.8rem 1.1rem;display:flex;flex-direction:column;gap:.7rem}
.pm-llabel{font-size:9px;letter-spacing:.1em;color:var(--pm-muted);margin-bottom:2px}
.pm-lcontent{font-size:11.5px;color:var(--pm-text);line-height:1.7}
.pm-lcontent .pm-chips{margin-bottom:0}
.pm-lcourses a,.pm-lcourses span.c{display:inline-block;font-size:11px;color:var(--pm-orange);background:var(--pm-chip);border-radius:3px;padding:1px 10px;margin:0 5px 4px 0;text-decoration:none;cursor:pointer}
.pm-lcourses span.c{cursor:default;color:var(--pm-text)}
@media (max-width:640px){.pm-two,.pm-adv,.pm-lects{grid-template-columns:1fr}.pm-card{padding:1rem}}`;
}
// 老师端等页面：样式只插一次
function pmrEnsureCss() {
  if (typeof document === 'undefined' || document.getElementById('pmrCss')) return;
  const el = document.createElement('style'); el.id = 'pmrCss'; el.textContent = pmrCss(false);
  document.head.appendChild(el);
}

// ── 区块外壳：小号英文标签 + 中文大标题 ──
function pmrSec(label, title, inner, o) {
  o = o || {};
  return `<div class="pm-sec"${o.id ? ` id="${pmEsc(o.id)}"` : ''}><div class="pm-label">${pmEsc(label)}</div>${o.head ? `<div class="pm-title-row"><div class="pm-title">${pmEsc(title)}</div>${o.head}</div>` : `<div class="pm-title">${pmEsc(title)}</div>`}${inner}</div>`;
}

// ── 专业介绍 ──
// 每行一条：「- 标题：说明」（冒号前是标题；没有冒号整行当标题）
function pmrAdvItems(text) {
  return String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const s = l.replace(/^[-・]\s*/, '').replace(/^\d+[.、]\s*/, '').replace(/\*\*/g, '');
    const m = s.match(/^(.+?)[：:]\s*(.*)$/);
    return m ? { title: m[1].trim(), desc: m[2].trim() } : { title: s, desc: '' };
  }).filter(x => x.title);
}
function pmrChips(text) {
  return String(text || '').replace(/\r/g, '').split(/[\n\/、,，;；・]+/).map(x => x.trim().replace(/^[-・]\s*/, '').replace(/\*\*/g, '')).filter(Boolean);
}
// rows：promo_content 里 section=major_intro 的行；o.name 专业名（「为什么选择 X」用）
function pmrIntroHtml(rows, o) {
  o = o || {};
  const F = {}, blocks = [];
  let structured = false;
  (rows || []).forEach(p => {
    const s = pmSplit(p.body, PMR_INTRO_LABELS);
    if (!s.known) { blocks.push({ title: p.title, body: p.body }); return; }   // 自由书写的旧格式：原样显示
    structured = true;
    PMR_INTRO_LABELS.forEach(l => { if (s.vals[l]) F[l] = F[l] ? F[l] + '\n' + s.vals[l] : s.vals[l]; });
    if (s.pre) blocks.push({ title: '', body: s.pre });
    s.extras.forEach(e => blocks.push({ title: e.label, body: e.text }));
  });
  let h = '';
  const two = ['概要', '独特视角'].filter(l => F[l]);
  if (two.length) {
    h += pmrSec('OVERVIEW', '学科介绍', `<div class="${two.length > 1 ? 'pm-two' : ''}">${two.map(l => `<div class="pm-card"><h3>${l}</h3><div class="pm-rich">${pmMd(F[l])}</div></div>`).join('')}</div>`);
  }
  if (F['优势']) {
    const items = pmrAdvItems(F['优势']);
    h += pmrSec('ADVANTAGES', o.name ? `为什么选择${o.name}` : '为什么选择', `<div class="pm-adv">${items.map((x, i) => `<div class="pm-adv-item"><div class="pm-adv-num">${String(i + 1).padStart(2, '0')}</div><div class="pm-adv-title">${pmInline(x.title)}</div>${x.desc ? `<div class="pm-adv-desc">${pmInline(x.desc)}</div>` : ''}</div>`).join('')}</div>`);
  }
  if (F['重点方向'] || F['研究课题例']) {
    const chips = pmrChips(F['重点方向']);
    h += pmrSec('DIRECTIONS', '重点方向',
      (chips.length ? `<div class="pm-chips">${chips.map(c => `<span class="pm-chip">${pmEsc(c)}</span>`).join('')}</div>` : '')
      + (F['研究课题例'] ? `<div class="pm-sublabel">研究课题例</div><div class="pm-rich">${pmMd(F['研究课题例'])}</div>` : ''));
  }
  if (F['重点研究科']) h += pmrSec('SCHOOLS', '目标学校', pmrSchoolsHtml(F['重点研究科']));
  if (blocks.length) {
    const inner = `<div class="pm-stack">${blocks.map(b => `<div class="pm-card">${b.title ? `<h3>${pmEsc(b.title)}</h3>` : ''}<div class="pm-rich">${pmMd(b.body)}</div></div>`).join('')}</div>`;
    h += structured ? pmrSec('MORE', '补充说明', inner) : pmrSec('OVERVIEW', '专业介绍', inner);
  }
  return h;
}
// 竖线表格 → 表格；表格外的文字作说明；没有竖线表格就按普通排版
function pmrTableText(text, cls) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const pipes = lines.filter(l => l.trim() && pmPipeRow(l)).map(l => l.trim()).filter(l => !/^\|[\s:\-|]+\|$/.test(l));
  if (!pipes.length) return null;
  const note = lines.filter(l => l.trim() && !pmPipeRow(l)).join('\n');
  return pmTableHtml(pmPipeCells(pipes[0]), pipes.slice(1).map(pmPipeCells), cls) + (note ? `<div class="pm-note">${pmMd(note)}</div>` : '');
}
function pmrSchoolsHtml(text) { return pmrTableText(text, 'pm-schools') || `<div class="pm-rich">${pmMd(text)}</div>`; }

// ── 课程介绍 ──
function pmrToggle(head) { const c = head.closest('.pm-course'); if (c) c.classList.toggle('open'); }
function pmrToggleAll(btn) {
  const box = btn.closest('.pm-sec'); if (!box) return;
  const cs = box.querySelectorAll('.pm-course');
  const open = [...cs].some(c => !c.classList.contains('open'));
  cs.forEach(c => c.classList.toggle('open', open));
  btn.textContent = open ? '全部收起' : '全部展开';
}
// 「当期开课」一行：closed=true 时显示「本期暂未开设」
function pmrSchedBox(line, closed) {
  return closed
    ? `<div class="pm-sched closed"><div class="pm-stag">SCHEDULE</div><div class="pm-sline">${pmEsc(line || '本期暂未开设，开课安排请咨询顾问老师')}</div></div>`
    : `<div class="pm-sched"><div class="pm-stag">CURRENT SCHEDULE · 当期开课</div><div class="pm-sline">${line}</div></div>`;
}
// 课程目标：每行「- 知识：…」，冒号前是小标签
function pmrGoalHtml(text) {
  const rows = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const s = l.replace(/^[-・]\s*/, '').replace(/^\d+[.、]\s*/, '');
    const m = s.match(/^([^：:]{1,8})[：:]\s*(.+)$/);
    return m ? `<div class="pm-goal-row"><span class="pm-tag">${pmEsc(m[1].trim())}</span><span>${pmInline(m[2])}</span></div>` : `<div class="pm-goal-row"><span>${pmInline(s)}</span></div>`;
  });
  return rows.length ? `<div class="pm-goal"><div class="pm-goal-title">课程目标</div>${rows.join('')}</div>` : '';
}
// rows：section=course 的行；o: { print, idPrefix, tchFor(title,row)→html, boxFor(title,row)→html }
function pmrCoursesHtml(rows, o) {
  o = o || {};
  if (!rows || !rows.length) return '';
  const cards = rows.map((p, i) => {
    const name = String(p.title || '').trim();
    const s = pmSplit(p.body, PMR_COURSE_LABELS);
    const v = s.vals;
    let body = '';
    if (!s.known) body = `<div class="pm-rich pm-cdesc">${pmMd(p.body)}</div>`;
    else {
      if (v['课程描述']) body += `<div class="pm-rich pm-cdesc">${pmMd(v['课程描述'])}</div>`;
      if (v['课程目标']) body += pmrGoalHtml(v['课程目标']);
      if (v['课程大纲']) body += pmrTableText(v['课程大纲'], 'pm-outline') || `<div class="pm-rich">${pmMd(v['课程大纲'])}</div>`;
      if (s.rest) body += `<div class="pm-rich" style="margin-top:.8rem">${pmMd(s.rest)}</div>`;
    }
    const box = o.boxFor ? o.boxFor(name, p) : '';
    return `<div class="pm-course${o.print ? ' open' : ''}"${o.idPrefix ? ` id="${pmEsc(o.idPrefix + i)}"` : ''}>
      <div class="pm-chead"${o.print ? '' : ' onclick="pmrToggle(this)"'}><span class="pm-cname">${pmEsc(name)}</span>${o.tchFor ? `<span class="pm-tch" onclick="event.stopPropagation()">${o.tchFor(name, p) || ''}</span>` : ''}<span class="pm-cmeta">${v['课时摘要'] ? `<span class="pm-hours">${pmEsc(v['课时摘要'].replace(/\s*\n\s*/g, ' '))}</span>` : ''}<span class="pm-arrow">▾</span></span></div>
      <div class="pm-cbody">${body}${box}</div>
    </div>`;
  }).join('');
  return pmrSec('CURRICULUM', '专业课程介绍', `<div class="pm-courses">${cards}</div>`, o.print ? {} : { head: '<button type="button" class="pm-btn" onclick="pmrToggleAll(this)">全部展开</button>' });
}

// ── 讲师介绍 ──
// rows：section=lecturer 的行；o: { idPrefix, extraFor(row,i)→html（卡片底部附加，如自动关联的担当课程） }
function pmrLecturersHtml(rows, o) {
  o = o || {};
  if (!rows || !rows.length) return '';
  const cards = rows.map((p, i) => {
    const t = String(p.title || '').trim();
    const m = t.match(/^(\S+)[\s　]+(.+)$/);
    const name = m ? m[1] : t, cred = m ? m[2].split(/[\s　]+/).filter(Boolean).join(' · ') : '';
    const s = pmSplit(p.body, []);
    const parts = [];
    if (s.pre) parts.push(`<div class="pm-lcontent pm-rich">${pmMd(s.pre)}</div>`);
    s.extras.forEach(e => {
      const isChip = /专攻|研究领域|研究方向|关键词|方向/.test(e.label);
      parts.push(`<div><div class="pm-llabel">${pmEsc(e.label)}</div><div class="pm-lcontent">${isChip ? `<div class="pm-chips">${pmrChips(e.text).map(c => `<span class="pm-chip">${pmEsc(c)}</span>`).join('')}</div>` : `<div class="pm-rich">${pmMd(e.text)}</div>`}</div></div>`);
    });
    const extra = o.extraFor ? o.extraFor(p, i) : '';
    return `<div class="pm-lect"${o.idPrefix ? ` id="${pmEsc(o.idPrefix + i)}"` : ''}>
      <div class="pm-lhead"><div class="pm-lname">${pmEsc(name)}</div>${cred ? `<div class="pm-laffil">${pmEsc(cred)}</div>` : ''}</div>
      <div class="pm-lbody">${parts.join('')}${extra || ''}</div>
    </div>`;
  }).join('');
  return pmrSec('LECTURERS', '讲师介绍', `<div class="pm-lects">${cards}</div>`);
}
