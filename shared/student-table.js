// ══════════════════════════════════
// shared/student-table.js — 学生档案表格（管理端 admin/students.js、老师端 teacher/teacher-students.js 共用）
// 一套列定义；列设置（chip，记在浏览器本地）；点表头排序；表头漏斗 = 这一列的取值 chip 多选。
// 用法：sttHtml(key, list, opts) 返回表格 HTML（含工具栏），之后排序/筛选会调用 sttRefresh(key) 只重画这一块。
// 全局名字一律以 stt / STT_ 开头。
// ══════════════════════════════════
const STT_STATUS = { active: '在籍', graduated: '已合格', expired: '已到期', stopped: '停课', withdrawn: '退学' };
const STT_INST = {};   // key -> { sort:{col,dir}, filters:{col:Set}, cols:[key], panel:bool }
const STT_CFG = {};    // key -> { list, opts }
let STT_CLASS_MAP = null;   // 老师端没加载班级时，自己按需取 id -> 名称

function sttEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function sttArr(v) { return typeof _arrOf === 'function' ? _arrOf(v) : (Array.isArray(v) ? v.map(String) : []); }
function sttMajor(s) { return (typeof MAJORS !== 'undefined' && MAJORS[s.major]) || s.major || ''; }
function sttClassNames(s) {
  const ids = sttArr(s.class_ids);
  if (!ids.length) return [];
  if (typeof classNamesOf === 'function') return classNamesOf(ids);
  return ids.map(id => (STT_CLASS_MAP && STT_CLASS_MAP[id]) || '').filter(Boolean);
}
function sttVipRemain(s) { return (Number(s.vip_hours_total) || 0) - (Number(s.vip_hours_used) || 0); }
function sttHasVip(s) { return s.is_vip_course === 'VIP' || s.is_vip_course === '大课+VIP' || (Number(s.vip_hours_total) || 0) > 0; }
function sttCourseParts(s) {
  const out = [];
  const a = s.is_vip_course || '', b = s.course_type || '';
  if (a) out.push(a);
  if (b && b !== a && !(a && b.includes(a)) && !(a && a.includes(b))) out.push(b);
  else if (b && !a) out.push(b);
  return out;
}
// 日期文本（"27年4月" / "2027/4/1" / "26.7"）→ 可比较的数字；认不出返回 null
function sttDateKey(v) {
  const m = String(v == null ? '' : v).match(/(\d{2,4})\s*[年\/.\-]\s*(\d{1,2})(?:\s*[月\/.\-]\s*(\d{1,2}))?/);
  if (!m) return null;
  let y = +m[1]; if (y < 100) y += 2000;
  return y * 10000 + (+m[2]) * 100 + (+(m[3] || 0));
}
function sttVipBucket(s) {
  if (!sttHasVip(s)) return '无VIP';
  const r = sttVipRemain(s);
  return r <= 0 ? '已用完（≤0）' : r <= 3 ? '紧张（≤3小时）' : '充足（>3小时）';
}

// 列定义：vals(s) = 漏斗里的取值（数组，空数组=空白）；text(s) = 导出/悬停用的纯文字；html(s, o) = 单元格内容
const STT_COLS = [
  { key: 'name', label: '姓名', fixed: true, sort: 'text', vals: s => [s.name || ''], text: s => s.name || '' },
  { key: 'major', label: '专业', def: 1, vals: s => [sttMajor(s)], text: s => sttMajor(s) },
  { key: 'status', label: '状态', def: 1, vals: s => [STT_STATUS[s.status] || s.status || ''], text: s => STT_STATUS[s.status] || s.status || '',
    html: s => { const v = s.status; const c = v === 'active' ? 'var(--ok,#2d7a4f)' : v === 'graduated' ? '#1a6a9a' : v === 'withdrawn' ? 'var(--danger,#c0392b)' : 'var(--text-3)'; const bg = v === 'active' ? 'var(--ok-bg,#e8f5ec)' : v === 'graduated' ? '#e8f4fd' : v === 'withdrawn' ? '#fdecea' : 'var(--border)'; return `<span style="font-size:10px;padding:1px 7px;border-radius:10px;background:${bg};color:${c};white-space:nowrap">${sttEsc(STT_STATUS[v] || v || '')}</span>`; } },
  { key: 'course', label: '课程属性', def: 1, vals: s => sttCourseParts(s), text: s => sttCourseParts(s).join(' / ') },
  { key: 'vip_hours', label: 'VIP课时（剩/总）', def: 1, sort: 'num', num: s => sttHasVip(s) ? sttVipRemain(s) : null, vals: s => [sttVipBucket(s)],
    text: s => sttHasVip(s) ? `${sttVipRemain(s)} / ${Number(s.vip_hours_total) || 0}` : '',
    html: s => { if (!sttHasVip(s)) return '<span style="color:var(--text-3)">—</span>'; const r = sttVipRemain(s); const c = r <= 0 ? 'var(--danger,#c0392b)' : r <= 3 ? '#d9822b' : 'var(--accent)'; return `<span style="color:${c};font-weight:600">${r}</span> / ${Number(s.vip_hours_total) || 0}`; } },
  { key: 'vip_teachers', label: 'VIP老师', def: 1, vals: s => sttArr(s.vip_teachers), text: s => sttArr(s.vip_teachers).join('、') },
  { key: 'owner_teachers', label: '负责老师', vals: s => sttArr(s.owner_teachers), text: s => sttArr(s.owner_teachers).join('、') },
  { key: 'class_ids', label: '班级', vals: s => sttClassNames(s), text: s => sttClassNames(s).join('、') },
  { key: 'level', label: '等级', def: 1, vals: s => [s.level || ''], text: s => s.level || '',
    html: s => s.level ? `<span class="level-badge level-${sttEsc(s.level)}">${sttEsc(s.level)}</span>` : '' },
  { key: 'student_type', label: '属性', vals: s => [s.student_type || ''], text: s => s.student_type || '' },
  { key: 'source', label: '来源', vals: s => [s.source || ''], text: s => s.source || '' },
  { key: 'japanese_score', label: '日语', def: 1, long: 1, vals: s => [s.japanese_score || ''], text: s => s.japanese_score || '' },
  { key: 'english_score', label: '英语', def: 1, long: 1, vals: s => [s.english_score || ''], text: s => s.english_score || '' },
  { key: 'university', label: '出身大学', def: 1, vals: s => [s.university || ''], text: s => s.university || '' },
  { key: 'faculty', label: '学部专业', long: 1, vals: s => [s.faculty || ''], text: s => s.faculty || '' },
  { key: 'gpa', label: 'GPA / 履历', long: 1, vals: s => [s.gpa || ''], text: s => s.gpa || '' },
  { key: 'thesis', label: '毕业论文', long: 1, vals: s => [s.thesis || ''], text: s => s.thesis || '' },
  { key: 'graduation_date', label: '毕业时间', sort: 'date', vals: s => [s.graduation_date || ''], text: s => s.graduation_date || '' },
  { key: 'target_enrollment', label: '入学目标', def: 1, sort: 'date', vals: s => [s.target_enrollment || ''], text: s => s.target_enrollment || '' },
  { key: 'target_school', label: '志望校', long: 1, vals: s => [s.target_school || ''], text: s => s.target_school || '' },
  { key: 'signup_date', label: '报名时间', sort: 'date', vals: s => [s.signup_date || ''], text: s => s.signup_date || '' },
  { key: 'expiry_date', label: '到期', def: 1, sort: 'date', vals: s => [s.expiry_date || ''], text: s => s.expiry_date || '' },
  { key: 'japan_arrival', label: '赴日', sort: 'date', vals: s => [s.japan_arrival || ''], text: s => s.japan_arrival || '' },
  { key: 'notes', label: '备注', long: 1, vals: s => [s.notes || ''], text: s => s.notes || '' },
  { key: 'student_code', label: '查询码', adminDef: 1, vals: s => [s.student_code || ''], text: s => s.student_code || '' },
];
const STT_COL_BY = Object.fromEntries(STT_COLS.map(c => [c.key, c]));

function sttInst(key) {
  if (!STT_INST[key]) STT_INST[key] = { sort: null, filters: {}, cols: sttLoadCols(key), panel: false };
  return STT_INST[key];
}
function sttDefaultCols(key) {
  const admin = (STT_CFG[key] && STT_CFG[key].opts && STT_CFG[key].opts.mode) === 'admin';
  return STT_COLS.filter(c => c.fixed || c.def || (admin && c.adminDef)).map(c => c.key);
}
function sttLoadCols(key) {
  try {
    const raw = localStorage.getItem('stt_cols_v1_' + key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const ok = arr.filter(k => STT_COL_BY[k]);
        if (ok.length) return STT_COLS.filter(c => c.fixed || ok.includes(c.key)).map(c => c.key);
      }
    }
  } catch (e) { /* 读不到就用默认 */ }
  return sttDefaultCols(key);
}
function sttSaveCols(key) {
  try { localStorage.setItem('stt_cols_v1_' + key, JSON.stringify(sttInst(key).cols)); } catch (e) { /* 写不进去也不影响使用 */ }
}

// ── 过滤 + 排序（导出也用它）──
function sttRows(key) {
  const cfg = STT_CFG[key]; if (!cfg) return [];
  const inst = sttInst(key);
  let list = cfg.list || [];
  Object.entries(inst.filters).forEach(([ck, set]) => {
    const col = STT_COL_BY[ck];
    if (!col || !set || !set.size) return;
    list = list.filter(s => { const v = col.vals(s).filter(x => x !== '' && x != null); return v.length ? v.some(x => set.has(x)) : set.has(''); });
  });
  if (inst.sort) {
    const col = STT_COL_BY[inst.sort.col], dir = inst.sort.dir;
    if (col) {
      const keyOf = s => col.sort === 'num' ? col.num(s) : col.sort === 'date' ? sttDateKey(col.text(s)) : (col.text(s) || null);
      list = list.map(s => ({ s, k: keyOf(s) })).sort((a, b) => {
        const an = a.k == null, bn = b.k == null;
        if (an || bn) return an && bn ? 0 : an ? 1 : -1;   // 空值永远排最后
        const r = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k), 'zh');
        return r * dir;
      }).map(x => x.s);
    }
  }
  return list;
}

// ── 渲染 ──
function sttHtml(key, list, opts) {
  STT_CFG[key] = { list: list || [], opts: opts || {} };
  sttEnsureCss();
  sttEnsureClasses(key);
  return `<div class="stt-wrap" id="stt_box_${key}">${sttInner(key)}</div>`;
}
function sttRefresh(key) {
  const box = document.getElementById('stt_box_' + key);
  if (box) box.innerHTML = sttInner(key);
}
function sttInner(key) {
  const cfg = STT_CFG[key], o = cfg.opts, inst = sttInst(key);
  const admin = o.mode === 'admin';
  const rowsAll = sttRows(key);
  if (o.onRows) { try { o.onRows(rowsAll); } catch (e) { /* ignore */ } }
  const rows = o.slice ? o.slice(rowsAll) : rowsAll;
  const cols = STT_COLS.filter(c => inst.cols.includes(c.key));
  const fcols = Object.keys(inst.filters).filter(k => inst.filters[k] && inst.filters[k].size);
  const sortArrow = c => inst.sort && inst.sort.col === c.key ? (inst.sort.dir === 1 ? '▲' : '▼') : '';
  const funnel = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M0 1h10L6 5.5V10L4 8.5V5.5z"/></svg>';

  const tool = `<div class="stt-tool">
    <span class="stt-btn" onclick="sttTogglePanel('${key}')">列设置 ${inst.panel ? '▴' : '▾'}</span>
    ${o.canExport && typeof XLSX !== 'undefined' ? `<span class="stt-btn" onclick="sttExport('${key}')">导出当前结果</span>` : ''}
    ${fcols.length ? `<span class="stt-filtered">已筛选：${fcols.map(k => sttEsc(STT_COL_BY[k].label)).join('、')} · <a onclick="sttClearAll('${key}')">清除全部</a></span>` : ''}
    ${inst.sort ? `<span class="stt-filtered">排序：${sttEsc(STT_COL_BY[inst.sort.col].label)}${inst.sort.dir === 1 ? '升序' : '降序'} · <a onclick="sttSortClear('${key}')">取消</a></span>` : ''}
    <span class="stt-count">表内 ${rowsAll.length} 人${rowsAll.length !== cfg.list.length ? `（共 ${cfg.list.length}）` : ''}</span>
  </div>`;
  const panel = inst.panel ? `<div class="stt-panel">${STT_COLS.filter(c => !c.fixed).map(c => {
    const on = inst.cols.includes(c.key);
    return `<span class="stt-chip${on ? ' on' : ''}" onclick="sttToggleCol('${key}','${c.key}')">${sttEsc(c.label)}</span>`;
  }).join('')}<span class="stt-chip" onclick="sttResetCols('${key}')" style="border-style:dashed">恢复默认</span></div>` : '';

  const th = cols.map(c => {
    const hasF = inst.filters[c.key] && inst.filters[c.key].size;
    const nameSel = c.fixed && admin && o.select ? `<input type="checkbox" id="selectAllStudents" onclick="event.stopPropagation()" onchange="toggleSelectAllStudents(this)"> ` : '';
    return `<th class="${c.fixed ? 'stt-fix' : ''}"><span class="stt-th">${nameSel}<span class="stt-lab" onclick="sttSort('${key}','${c.key}')">${sttEsc(c.label)}<i class="stt-arr">${sortArrow(c)}</i></span><span class="stt-fn${hasF ? ' on' : ''}" onclick="event.stopPropagation();sttOpenFilter('${key}','${c.key}',this)" title="筛选">${funnel}</span></span></th>`;
  }).join('') + (o.ops ? '<th></th>' : '');

  const td = (c, s) => {
    if (c.fixed) {
      const sel = admin && o.select ? `<input type="checkbox" class="student-select" value="${sttEsc(s.id)}" onclick="event.stopPropagation()"> ` : '';
      const tags = typeof classTagsHtml === 'function' && admin ? classTagsHtml(s.class_ids) : '';
      const click = o.nameClick ? ` onclick="${o.nameClick(s)}"` : '';
      const nm = `<span${click} style="${o.nameClick ? 'cursor:pointer;color:var(--accent);text-decoration:underline' : 'font-weight:600'}">${sttEsc(s.name)}</span>`;
      return `<td class="stt-fix stt-name">${sel}${nm}${tags}</td>`;
    }
    if (c.key === 'student_code' && o.codeHtml) return `<td>${o.codeHtml(s)}</td>`;
    if (c.key === 'student_code') return `<td style="font-weight:600;letter-spacing:1px;color:var(--accent)">${sttEsc(s.student_code || '')}</td>`;
    if (c.html) return `<td>${c.html(s)}</td>`;
    const t = c.text(s);
    if (c.long) return `<td><div class="stt-long" title="${sttEsc(t)}">${sttEsc(t)}</div></td>`;
    return `<td title="${sttEsc(t)}">${sttEsc(t)}</td>`;
  };
  const colspan = cols.length + (o.ops ? 1 : 0);
  const body = rows.length ? rows.map(s => {
    const exp = o.expand ? o.expand(s) : '';
    return `<tr${o.rowClick ? ` onclick="${o.rowClick(s)}" style="cursor:pointer"` : ''}>${cols.map(c => td(c, s)).join('')}${o.ops ? `<td class="stt-ops" onclick="event.stopPropagation()">${o.ops(s)}</td>` : ''}</tr>${exp ? `<tr class="stt-exp"><td colspan="${colspan}">${exp}</td></tr>` : ''}`;
  }).join('') : `<tr><td colspan="${colspan}" style="text-align:center;padding:26px;color:var(--text-3)">${o.empty || (cfg.list.length ? '没有符合列筛选的学生' : '暂无学生')}</td></tr>`;

  return `${tool}${panel}<div class="stt-scroll"><table class="stt-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>${o.more ? o.more(rowsAll.length) : ''}`;
}

// ── 交互 ──
function sttTogglePanel(key) { const i = sttInst(key); i.panel = !i.panel; sttRefresh(key); }
function sttToggleCol(key, ck) {
  const i = sttInst(key);
  i.cols = STT_COLS.filter(c => c.fixed || (c.key === ck ? !i.cols.includes(ck) : i.cols.includes(c.key))).map(c => c.key);
  sttSaveCols(key); sttRefresh(key);
}
function sttResetCols(key) { sttInst(key).cols = sttDefaultCols(key); sttSaveCols(key); sttRefresh(key); }
function sttSort(key, ck) {
  const i = sttInst(key);
  if (!i.sort || i.sort.col !== ck) i.sort = { col: ck, dir: 1 };
  else if (i.sort.dir === 1) i.sort = { col: ck, dir: -1 };
  else i.sort = null;
  sttRefresh(key);
}
function sttSortClear(key) { sttInst(key).sort = null; sttRefresh(key); }
function sttClearAll(key) { sttInst(key).filters = {}; sttClosePop(); sttRefresh(key); }

let STT_POP = null;   // { key, col, vals:[{v,n}], q }
function sttClosePop() { document.querySelectorAll('.stt-pop').forEach(p => p.remove()); STT_POP = null; }
function sttPopValues(key, ck) {
  const col = STT_COL_BY[ck], map = new Map();
  (STT_CFG[key].list || []).forEach(s => {
    const v = col.vals(s).filter(x => x !== '' && x != null);
    (v.length ? v : ['']).forEach(x => map.set(x, (map.get(x) || 0) + 1));
  });
  return [...map.entries()].map(([v, n]) => ({ v, n })).sort((a, b) => (a.v === '') - (b.v === '') || (col.sort === 'date' ? ((sttDateKey(a.v) || 0) - (sttDateKey(b.v) || 0)) : String(a.v).localeCompare(String(b.v), 'zh')));
}
function sttOpenFilter(key, ck, btn) {
  sttClosePop();
  STT_POP = { key, col: ck, vals: sttPopValues(key, ck), q: '' };
  const pop = document.createElement('div');
  pop.className = 'stt-pop';
  pop.innerHTML = `<div class="stt-pop-h"><b>${sttEsc(STT_COL_BY[ck].label)}</b><span><a onclick="sttPopAll()">全选</a> · <a onclick="sttPopNone()">清空</a></span></div>
    <input class="stt-pop-q" placeholder="搜索取值…" oninput="if(this.dataset.c!=='1')sttPopSearch(this.value)" oncompositionstart="this.dataset.c='1'" oncompositionend="this.dataset.c='';sttPopSearch(this.value)">
    <div class="stt-pop-list"></div>`;
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  pop.style.top = Math.min(r.bottom + 4, window.innerHeight - 120) + 'px';
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 276)) + 'px';
  sttPopRender();
  setTimeout(() => {
    const close = e => { if (!pop.contains(e.target)) { sttClosePop(); document.removeEventListener('mousedown', close, true); window.removeEventListener('scroll', onScroll, true); } };
    const onScroll = e => { if (!pop.contains(e.target)) { sttClosePop(); document.removeEventListener('mousedown', close, true); window.removeEventListener('scroll', onScroll, true); } };
    document.addEventListener('mousedown', close, true);
    window.addEventListener('scroll', onScroll, true);
  }, 0);
}
function sttPopShown() {
  const q = (STT_POP.q || '').trim().toLowerCase();
  return STT_POP.vals.map((x, i) => ({ ...x, i })).filter(x => !q || (x.v === '' ? '空白' : x.v).toLowerCase().includes(q));
}
function sttPopRender() {
  const box = document.querySelector('.stt-pop .stt-pop-list'); if (!box || !STT_POP) return;
  const set = sttInst(STT_POP.key).filters[STT_POP.col] || new Set();
  const shown = sttPopShown();
  box.innerHTML = shown.slice(0, 300).map(x => `<span class="stt-chip${set.has(x.v) ? ' on' : ''}" onclick="sttPopToggle(${x.i})">${x.v === '' ? '（空白）' : sttEsc(x.v)} <small>${x.n}</small></span>`).join('')
    + (shown.length > 300 ? `<div style="font-size:10px;color:var(--text-3);width:100%">只显示前 300 个，请用搜索缩小范围</div>` : '')
    + (!shown.length ? '<div style="font-size:11px;color:var(--text-3)">没有匹配的取值</div>' : '');
}
function sttPopSet(set) {
  const inst = sttInst(STT_POP.key);
  if (set.size) inst.filters[STT_POP.col] = set; else delete inst.filters[STT_POP.col];
  sttRefresh(STT_POP.key); sttPopRender();
}
function sttPopToggle(i) {
  const set = new Set(sttInst(STT_POP.key).filters[STT_POP.col] || []);
  const v = STT_POP.vals[i].v;
  if (set.has(v)) set.delete(v); else set.add(v);
  sttPopSet(set);
}
function sttPopAll() { const set = new Set(sttInst(STT_POP.key).filters[STT_POP.col] || []); sttPopShown().forEach(x => set.add(x.v)); sttPopSet(set); }
function sttPopNone() { sttPopSet(new Set()); }
function sttPopSearch(v) { if (!STT_POP) return; STT_POP.q = v; sttPopRender(); }

// ── 导出：当前筛选 + 排序后的结果、当前显示的列 ──
function sttExport(key) {
  if (typeof XLSX === 'undefined') { alert('导出组件没有加载'); return; }
  const inst = sttInst(key), o = STT_CFG[key].opts;
  const cols = STT_COLS.filter(c => inst.cols.includes(c.key));
  const rows = sttRows(key);
  if (!rows.length) { alert('当前没有可导出的学生'); return; }
  const data = rows.map(s => { const r = {}; cols.forEach(c => { r[c.label] = c.text(s); }); return r; });
  const ws = XLSX.utils.json_to_sheet(data), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '学生档案');
  XLSX.writeFile(wb, (o.exportName || '学生档案') + '.xlsx');
}

// 老师端没有加载班级时，按需取班级名称（读不到就不显示班级名）
function sttEnsureClasses(key) {
  if (typeof classNamesOf === 'function' || STT_CLASS_MAP !== null || typeof sb !== 'function') return;
  STT_CLASS_MAP = {};
  sb('/rest/v1/classes?select=id,name').then(r => { (r || []).forEach(c => { STT_CLASS_MAP[String(c.id)] = c.name; }); if (document.getElementById('stt_box_' + key)) sttRefresh(key); }).catch(() => {});
}

function sttEnsureCss() {
  if (document.getElementById('stt_css')) return;
  const st = document.createElement('style'); st.id = 'stt_css';
  st.textContent = `
.stt-tool{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px;font-size:11px}
.stt-btn{cursor:pointer;border:1px solid var(--border);border-radius:3px;padding:3px 10px;background:var(--surface);color:var(--text-2);user-select:none}
.stt-btn:hover{border-color:var(--accent);color:var(--accent)}
.stt-filtered{color:var(--accent)}
.stt-filtered a{cursor:pointer;text-decoration:underline}
.stt-count{margin-left:auto;color:var(--text-3)}
.stt-panel{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;margin-bottom:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg)}
.stt-chip{cursor:pointer;user-select:none;font-size:11px;padding:2px 9px;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text-2);white-space:nowrap}
.stt-chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.stt-chip small{opacity:.65;font-size:9px}
.stt-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;width:100%;border:1px solid var(--border);border-radius:4px;background:var(--surface)}
.stt-table{border-collapse:separate;border-spacing:0;font-size:11px;width:max-content;min-width:100%}
.stt-table th{background:var(--bg);color:var(--text-3);font-weight:600;font-size:10px;padding:6px 8px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap;position:sticky;top:0;z-index:1}
.stt-table td{padding:6px 8px;border-bottom:1px solid var(--border-light,var(--border));vertical-align:top;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}
.stt-table tbody tr:hover td{background:var(--bg)}
.stt-table .stt-fix{position:sticky;left:0;z-index:2;background:var(--surface);box-shadow:1px 0 0 var(--border)}
.stt-table th.stt-fix{background:var(--bg);z-index:3}
.stt-table tbody tr:hover td.stt-fix{background:var(--bg)}
.stt-name{min-width:84px;white-space:nowrap}
.stt-table input[type=checkbox]{width:auto;padding:0;margin:0 6px 0 0;vertical-align:middle;flex:none}
.stt-th{display:inline-flex;align-items:center;gap:4px}
.stt-lab{cursor:pointer;user-select:none}
.stt-arr{font-style:normal;font-size:8px;margin-left:3px;color:var(--accent)}
.stt-fn{cursor:pointer;display:inline-flex;align-items:center;padding:2px;border-radius:2px;color:var(--text-3);opacity:.6}
.stt-fn:hover{opacity:1}
.stt-fn.on{color:var(--accent);opacity:1;background:rgba(184,149,58,.18)}
.stt-long{white-space:normal;max-width:200px;min-width:90px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.45}
.stt-ops{white-space:nowrap;display:table-cell}
.stt-ops .btn{margin-right:4px}
.stt-exp td{background:var(--bg);white-space:normal;max-width:none}
.stt-pop{position:fixed;z-index:10000;width:268px;max-height:360px;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:4px;box-shadow:0 4px 14px rgba(0,0,0,.15);padding:8px;font-size:11px}
.stt-pop-h{display:flex;justify-content:space-between;margin-bottom:6px}
.stt-pop-h a{cursor:pointer;color:var(--accent)}
.stt-pop-q{font-size:11px;padding:4px 7px;border:1px solid var(--border);border-radius:3px;margin-bottom:6px;font-family:inherit;background:var(--bg)}
.stt-pop-list{display:flex;flex-wrap:wrap;gap:5px;overflow-y:auto}
`;
  document.head.appendChild(st);
}
