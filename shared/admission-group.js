// ══════════════════════════════════
// 出愿数据库：按「大学 + 研究科 + 専攻 + コース」归并、按出愿时期排序（管理端、老师端共用）
// 数据表仍是「一行一种出愿」；这里只负责归并 / 筛选 / 排序 / 显示，不改数据
// ══════════════════════════════════

const ADG_EN_TESTS = ['TOEFL', 'TOEIC', 'IELTS', 'GRE', 'GMAT', '英検', 'その他'];
const ADG_JP_TESTS = ['JLPT-N1', 'JLPT-N2', 'EJU', '日本語学力証明', 'その他'];
// 筛选用 chip：[显示名, 考试 key]
const ADG_EN_CHIPS = [['TOEFL', 'TOEFL'], ['TOEIC', 'TOEIC'], ['IELTS', 'IELTS'], ['GRE', 'GRE'], ['GMAT', 'GMAT'], ['英検', '英検']];
const ADG_JP_CHIPS = [['N1', 'JLPT-N1'], ['N2', 'JLPT-N2'], ['EJU', 'EJU']];

function adgEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function adgJs(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
// 比较用：去首尾空格（含全角）、统一「／」「/」
function adgNorm(v) { return String(v == null ? '' : v).replace(/／/g, '/').replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''); }
function adgGroupKey(s) { return [s.major, s.university, s.faculty, s.department, s.course].map(adgNorm).join('\u0001'); }

// 出愿时间排序值：月*100 + 日（上旬=5 中旬=15 下旬=25；只有月=15；yyyy/mm/dd 取实际日期）；识别不了 = 99999（排最后）
function adgPeriodKey(str) {
  const t = String(str == null ? '' : str).normalize('NFKC');
  let m = t.match(/(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return +m[2] * 100 + (+m[3]);
  m = t.match(/(\d{1,2})\s*月\s*(上|中|下)\s*旬/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return +m[1] * 100 + ({ '上': 5, '中': 15, '下': 25 })[m[2]];
  m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return +m[1] * 100 + (+m[2]);
  m = t.match(/(\d{1,2})\s*月/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return +m[1] * 100 + 15;
  return 99999;
}
// 出愿期間涉及的月份（用于月份范围筛选）
function adgRowMonths(s) {
  const t = String(s.application_period || '').normalize('NFKC');
  let ms = [...t.matchAll(/(\d{1,2})\s*月/g)].map(x => +x[1]).filter(n => n >= 1 && n <= 12);
  if (!ms.length) { const k = adgPeriodKey(t); if (k < 99999) ms = [Math.floor(k / 100)]; }
  return ms;
}

// ── 语言明细 ──
function adgTestOk(v) { v = String(v == null ? '' : v).trim(); return !!v && !/^[×✕✗xX\-－―]+$/.test(v) && v !== 'なし'; }
function adgTestsOf(s, kind) { const o = kind === 'en' ? s.english_tests : s.japanese_tests; return (o && typeof o === 'object') ? o : {}; }
function adgAccepts(s, kind, key) { return adgTestOk(adgTestsOf(s, kind)[key]); }
function adgTestKeys(kind, obj) {
  const base = kind === 'en' ? ADG_EN_TESTS : ADG_JP_TESTS;
  return base.concat(Object.keys(obj || {}).filter(k => !base.includes(k)));
}
function adgTestShort(key, val) {
  const name = key.replace(/^JLPT-/, '');
  const m = String(val || '').match(/[（(](.+?)[）)]/);
  return name + (m ? '（' + m[1] + '）' : '');
}
// 一行的明细纯文本（导出用）：「TOEFL〇 / TOEIC〇（必須） / その他：…」
function adgTestsText(s, kind) {
  const t = adgTestsOf(s, kind), out = [];
  adgTestKeys(kind, t).forEach(k => { if (adgTestOk(t[k])) out.push(k === 'その他' ? 'その他：' + t[k] : k + t[k]); });
  return out.join(' / ');
}
// 一组的语言汇总：{ req:'必須|任意|不要|', tests:['TOEFL','TOEIC（必須）'] }
function adgLangSummary(rows, kind) {
  const field = kind === 'en' ? 'english_required' : 'japanese_required';
  const rank = { '必須': 3, '任意': 2, '不要': 1 };
  let req = '';
  rows.forEach(r => { const v = r[field] || ''; if ((rank[v] || 0) > (rank[req] || 0) || (!req && v)) req = v; });
  const map = new Map();
  rows.forEach(r => {
    const t = adgTestsOf(r, kind);
    adgTestKeys(kind, t).forEach(k => {
      if (k === 'その他' || !adgTestOk(t[k])) return;
      const lab = adgTestShort(k, t[k]);
      if (!map.has(k) || (!/（/.test(map.get(k)) && /（/.test(lab))) map.set(k, lab);
    });
  });
  return { req, tests: [...map.values()] };
}
function adgLangTagHtml(rows, kind) {
  const sum = adgLangSummary(rows, kind);
  if (!sum.req && !sum.tests.length) return '';
  const color = sum.req === '必須' ? 'var(--accent)' : sum.req === '任意' ? 'var(--warn)' : 'var(--text-3)';
  const head = (kind === 'en' ? '英 ' : '日 ') + (sum.req || '');
  return `<div class="adg-lang" style="color:${color}"><b>${head}</b>${sum.tests.length ? '：' + sum.tests.map(adgEsc).join('・') : ''}</div>`;
}

// ── 筛选 ──
// f: { english, japanese, engTests:Set, jpTests:Set, search, monthFrom, monthTo, ere }
function adgFilterActive(f) {
  return !!((f.english && f.english !== 'all') || (f.japanese && f.japanese !== 'all') || (f.engTests && f.engTests.size) || (f.jpTests && f.jpTests.size)
    || (f.search && f.search.trim()) || f.monthFrom || f.monthTo || f.ere);
}
function adgRowOk(s, f) {
  if (f.english && f.english !== 'all' && s.english_required !== f.english) return false;
  if (f.japanese && f.japanese !== 'all' && s.japanese_required !== f.japanese) return false;
  if (f.engTests && f.engTests.size && ![...f.engTests].some(k => adgAccepts(s, 'en', k))) return false;
  if (f.jpTests && f.jpTests.size && ![...f.jpTests].some(k => adgAccepts(s, 'jp', k))) return false;
  if (f.search && f.search.trim() && !searchMatch(f.search, [s.university, s.faculty, s.department, s.course, s.admission_type], { names: 0 })) return false;
  if (f.monthFrom || f.monthTo) {
    const ms = adgRowMonths(s);
    if (!ms.length) return false;
    const minM = Math.min(...ms), maxM = Math.max(...ms);
    if (f.monthFrom && maxM < f.monthFrom) return false;
    if (f.monthTo && minM > f.monthTo) return false;
  }
  if (f.ere && s.ere_available !== true) return false;
  return true;
}

// 归并：返回有符合出愿的组，每组 { key, rows(全部，按出愿时间排), hit:Set(id), first, sortKey }
// sortMode：'time'（最早出愿时间，默认）| 'name'（大学名）
function adgBuildGroups(allRows, f, sortMode) {
  const map = new Map();
  (allRows || []).forEach(s => {
    const k = adgGroupKey(s);
    let g = map.get(k);
    if (!g) { g = { key: k, rows: [], hit: new Set() }; map.set(k, g); }
    g.rows.push(s);
  });
  const out = [];
  map.forEach(g => {
    g.rows.sort((a, b) => adgPeriodKey(a.application_period) - adgPeriodKey(b.application_period)
      || String(a.admission_type || '').localeCompare(String(b.admission_type || ''), 'ja'));
    g.rows.forEach(s => { if (adgRowOk(s, f)) g.hit.add(String(s.id)); });
    if (!g.hit.size) return;
    const firstHit = g.rows.find(r => g.hit.has(String(r.id)));
    g.sortKey = adgPeriodKey(firstHit.application_period);
    const r0 = g.rows[0];
    g.head = { major: r0.major, university: r0.university, faculty: r0.faculty, department: r0.department, course: r0.course,
      type: (g.rows.find(r => r.type) || {}).type || '' };
    out.push(g);
  });
  const byName = (a, b) => String(a.head.university || '').localeCompare(String(b.head.university || ''), 'ja')
    || String(a.head.faculty || '').localeCompare(String(b.head.faculty || ''), 'ja')
    || String(a.head.department || '').localeCompare(String(b.head.department || ''), 'ja')
    || String(a.head.course || '').localeCompare(String(b.head.course || ''), 'ja');
  out.sort(sortMode === 'name' ? byName : (a, b) => (a.sortKey - b.sortKey) || byName(a, b));
  return out;
}
// 展平成「一行一种出愿」（只含符合筛选的，顺序同组的显示顺序）：导出、共享、加入宣传资料用
function adgFlatten(groups) {
  const out = [];
  groups.forEach(g => g.rows.forEach(r => { if (g.hit.has(String(r.id))) out.push(r); }));
  return out;
}

// ── 显示 ──
let adgStyleDone = false;
function adgEnsureStyle() {
  if (adgStyleDone) return;
  adgStyleDone = true;
  const st = document.createElement('style');
  st.textContent = `
  tr.adg-g{cursor:pointer}
  tr.adg-g:hover td{background:var(--bg)}
  tr.adg-g.adg-open td{background:#f7f1e2}
  .adg-arrow{display:inline-block;width:12px;font-size:9px;color:var(--text-3)}
  .adg-per{font-size:10px;line-height:1.7;color:var(--text-2);white-space:nowrap}
  .adg-per.adg-hl{color:var(--text);font-weight:600}
  .adg-lang{font-size:10px;line-height:1.7;white-space:normal}
  tr.adg-d>td{padding:0 !important;background:var(--bg) !important}
  table.adg-dt{width:100%;border-collapse:collapse;font-size:10.5px}
  table.adg-dt th{background:#efe9da;color:var(--text-2);font-weight:600;text-align:left;padding:4px 6px;border-bottom:1px solid var(--border);white-space:nowrap}
  table.adg-dt td{padding:5px 6px;border-bottom:1px solid var(--border-light);vertical-align:top;background:transparent}
  table.adg-dt tr.adg-hit td{background:#fbf3dc}
  table.adg-dt tr.adg-dim td{opacity:.5}
  table.adg-dt tr.adg-sel td{background:#f3ead9}
  .adg-pill{display:inline-block;font-size:10px;border:1px solid var(--border-light);border-radius:2px;padding:0 4px;margin:1px 3px 1px 0;background:var(--surface);white-space:nowrap}
  .adg-other{font-size:10px;color:var(--text-2);margin-top:2px;line-height:1.5;max-width:240px;white-space:normal}
  .adg-selbtn{font-size:10px;padding:1px 8px;border:1px solid var(--border);border-radius:10px;background:var(--surface);cursor:pointer;font-family:inherit;color:var(--text-2);white-space:nowrap}
  .adg-selbtn.on{background:var(--accent);border-color:var(--accent);color:#fff}`;
  document.head.appendChild(st);
}
function adgLink(url, label) {
  const u = String(url || '').trim();
  return /^https?:\/\//i.test(u) ? `<a href="${adgEsc(u)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:var(--accent);font-size:10px;margin-right:4px">${label}</a>` : '';
}
function adgUniq(rows, field) { return [...new Set(rows.map(r => adgNorm(r[field])).filter(Boolean))]; }

// 一组的汇总行。ctx：{ showMajor, majorMap, open:Set(key), toggleFn, filterActive, selFn, selected:Set }
function adgGroupRowHtml(g, gi, ctx) {
  const h = g.head, open = ctx.open && ctx.open.has(g.key);
  const hitRows = g.rows.filter(r => g.hit.has(String(r.id)));
  const per = g.rows.map(r => {
    const hl = ctx.filterActive && g.hit.has(String(r.id));
    const t = [r.application_period, r.admission_type].map(x => adgNorm(x)).filter(Boolean).join(' ');
    return `<div class="adg-per${hl ? ' adg-hl' : ''}">${adgEsc(t || '-')}</div>`;
  }).join('');
  const styles = adgUniq(hitRows, 'exam_style');
  const links = [...new Set(hitRows.map(r => String(r.guideline_url || '').trim()).filter(Boolean))].slice(0, 3);
  let selCell = '';
  if (ctx.selFn) {
    const n = hitRows.filter(r => ctx.selected && ctx.selected.has(String(r.id))).length;
    selCell = `<td onclick="event.stopPropagation()"><button class="adg-selbtn${n && n === hitRows.length ? ' on' : ''}" onclick="${ctx.selFn}(${gi})">${n ? (n === hitRows.length ? '已选' : `已选${n}/${hitRows.length}`) : '选中'}</button></td>`;
  }
  return `<tr class="adg-g${open ? ' adg-open' : ''}" onclick="${ctx.toggleFn}(${gi})">
    ${ctx.showMajor ? `<td style="font-size:10px;color:var(--text-2)">${adgEsc((ctx.majorMap && ctx.majorMap[h.major]) || h.major)}</td>` : ''}
    <td style="font-weight:500"><span class="adg-arrow">${open ? '▼' : '▶'}</span>${adgEsc(h.university)}</td>
    <td><span style="font-size:10px;background:${h.type === '国立' ? '#e8f0fb' : h.type === '公立' ? '#e8f5e9' : 'var(--bg)'};border:1px solid var(--border-light);border-radius:2px;padding:1px 4px">${adgEsc(h.type)}</span></td>
    <td>${adgEsc(h.faculty)}</td><td>${adgEsc(h.department)}</td><td>${adgEsc(h.course)}</td>
    <td>${per}</td>
    <td>${adgLangTagHtml(g.rows, 'en')}${adgLangTagHtml(g.rows, 'jp')}</td>
    <td style="font-size:10.5px;color:var(--text-2);max-width:150px">${styles.map(adgEsc).join(' / ')}</td>
    <td style="white-space:nowrap">${links.map((u, i) => adgLink(u, links.length > 1 ? '要项' + (i + 1) : '要项')).join('')}</td>
    ${selCell}
  </tr>`;
}

function adgLangDetailHtml(s, kind) {
  const req = kind === 'en' ? s.english_required : s.japanese_required;
  const t = adgTestsOf(s, kind);
  const color = req === '必須' ? 'var(--accent)' : req === '任意' ? 'var(--warn)' : 'var(--text-3)';
  let h = req ? `<b style="color:${color}">${adgEsc(req)}</b> ` : '';
  const pills = adgTestKeys(kind, t).filter(k => k !== 'その他' && adgTestOk(t[k])).map(k => `<span class="adg-pill">${adgEsc(k)} ${adgEsc(t[k])}</span>`);
  h += pills.join('');
  if (!pills.length) { const legacy = kind === 'en' ? s.english_detail : s.japanese_detail; if (legacy) h += `<span style="color:var(--text-2)">${adgEsc(legacy)}</span>`; }
  if (adgTestOk(t['その他'])) h += `<div class="adg-other">${adgEsc(t['その他'])}</div>`;
  return h || '-';
}

// 展开的明细（每种出愿一小行）。ctx.admin=true 时多出 その他書類・備考・過去問・教员链接 和 编辑/删除
function adgDetailHtml(g, ctx) {
  const admin = !!ctx.admin;
  const cols = ['出願類型', '資格審査', '出願期間', '筆記', '口述', '合格発表', '英語', '日語', '推薦状', '卒論', '試験方式'].concat(admin ? ['その他書類', '備考', '過去問', '教员', ''] : []);
  const rows = g.rows.map(s => {
    const hit = g.hit.has(String(s.id));
    const cls = (ctx.filterActive ? (hit ? 'adg-hit' : 'adg-dim') : '') + (ctx.selected && ctx.selected.has(String(s.id)) ? ' adg-sel' : '');
    const click = ctx.rowSelFn ? ` onclick="${ctx.rowSelFn}('${adgJs(s.id)}')" style="cursor:pointer"` : '';
    const c = v => `<td>${adgEsc(v)}</td>`;
    let h = `<tr class="${cls}"${click}>${c(s.admission_type)}${c(s.doc_review_period)}<td style="font-weight:600">${adgEsc(s.application_period)}</td>${c(s.written_exam)}${c(s.oral_exam)}${c(s.result_date)}`
      + `<td>${adgLangDetailHtml(s, 'en')}</td><td>${adgLangDetailHtml(s, 'jp')}</td>${c(s.recommendation)}${c(s.thesis)}<td style="max-width:200px">${adgEsc(s.exam_style)}${adgLink(s.guideline_url, '要项')}</td>`;
    if (admin) {
      h += `${c(s.other_docs)}<td style="max-width:200px;white-space:pre-wrap">${adgEsc(s.notes)}</td><td>${adgLink(s.past_exam_url, '过去问')}</td><td>${adgLink(s.staff_url, '教员')}</td>`
        + `<td style="white-space:nowrap"><button class="btn btn-outline btn-sm" style="font-size:10px;padding:1px 8px" onclick="event.stopPropagation();${ctx.editFn}('${adgJs(s.id)}')">编辑</button> `
        + `<button class="btn btn-danger btn-sm" style="font-size:10px;padding:1px 8px" onclick="event.stopPropagation();${ctx.delFn}('${adgJs(s.id)}')">删除</button></td>`;
    }
    return h + '</tr>';
  }).join('');
  return `<table class="adg-dt"><thead><tr>${cols.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

function adgHeadHtml(ctx) {
  const cols = (ctx.showMajor ? ['专业'] : []).concat(['大学名', '性质', '研究科', '専攻', 'コース', '出愿时期', '语言要求', '試験方式', '募集要項']).concat(ctx.selFn ? [''] : []);
  return `<tr>${cols.map(x => `<th style="white-space:nowrap">${x}</th>`).join('')}</tr>`;
}
function adgColCount(ctx) { return 9 + (ctx.showMajor ? 1 : 0) + (ctx.selFn ? 1 : 0); }

// 渲染成 <tbody> 内容。groups 已经是要显示的那部分
function adgBodyHtml(groups, ctx) {
  adgEnsureStyle();
  const n = adgColCount(ctx);
  return groups.map((g, gi) => adgGroupRowHtml(g, gi, ctx)
    + (ctx.open && ctx.open.has(g.key) ? `<tr class="adg-d"><td colspan="${n}">${adgDetailHtml(g, ctx)}</td></tr>` : '')).join('');
}

// 筛选用 chip 行（可叠加）。toggleFn(kind,key)
function adgTestChipsHtml(kind, sel, toggleFn) {
  const list = kind === 'en' ? ADG_EN_CHIPS : ADG_JP_CHIPS;
  return list.map(([label, key]) => `<span class="filter-chip${sel && sel.has(key) ? ' active' : ''}" onclick="${toggleFn}('${kind}','${key}')" style="font-size:11px;padding:2px 9px">${label}</span>`).join('');
}
