// ══════════════════════════════════
// teacher-sales.js — 营业模块：讲师信息查询（需 lect_info 权限）
// 场景：咨询学生想了解某专业有哪些老师 → 营业按学科筛选/搜索 → 点选多位讲师 →
//   「内部信息」模式：完整档案检索（含执教年份/VIP/备注等内部字段）
//   「展示卡片」模式：干净的宣传版卡片（只含对外内容），可直接给学生看或截图
// 数据：teacher_profiles（admin 讲师档案维护，绑定账号的老师可自行补全）
// 依赖：shared/constants.js、shared/supabase.js、teacher.js（须在其后加载）
// ══════════════════════════════════
let tsProfiles = null;
let tsSubject = 'all';
let tsSearch = '';
let tsSelected = new Set();
let tsMode = 'info'; // info=内部信息 | card=展示卡片

function tsEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

let tsPubMap = null; // 本名 → 对外宣传姓名（老师管理备注）

async function renderLectInfo(mc) {
  // 加宽主容器：左右分栏需要横向空间（默认700px会导致两栏堆叠）
  const mainEl = document.querySelector('.main');
  if (mainEl) mainEl.style.maxWidth = '1400px';
  mc.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const [profiles, teachers] = await Promise.all([
      sb('/rest/v1/teacher_profiles?select=*&order=sort_order.asc,created_at.asc'),
      sb('/rest/v1/teachers?select=name,notes').catch(() => []),
    ]);
    tsProfiles = profiles;
    tsPubMap = {};
    (teachers || []).forEach(t => { const pub = String(t.notes || '').trim(); if (pub) tsPubMap[t.name] = pub; });
  } catch (e) { mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }
  tsRenderShell();
}
function tsPubOf(name) { return (tsPubMap && tsPubMap[name]) || name; }

function tsRenderShell() {
  const mc = document.getElementById('mainContent');
  if (!mc || !tsProfiles) return;
  const subjects = [...new Set(tsProfiles.map(p => (p.subject || '未分类').trim() || '未分类'))];
  mc.innerHTML = `
  <div class="page-header"><div class="section-title">👤 讲师信息查询</div></div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px">
    <span style="font-size:10px;color:var(--text-3)">学科：</span>
    <div class="filter-chip ${tsSubject==='all'?'active':''}" onclick="tsSubject='all';tsRenderShell()" style="padding:3px 10px;font-size:10px">全部</div>
    ${subjects.map(s => `<div class="filter-chip ${tsSubject===s?'active':''}" onclick="tsSubject='${tsEsc(s)}';tsRenderShell()" style="padding:3px 10px;font-size:10px">${tsEsc(s)}</div>`).join('')}
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px">
    <input placeholder="搜索姓名 / 方向 / 课程…" value="${tsEsc(tsSearch)}" oninput="tsSearch=this.value;tsRenderList()"
      style="font-size:11px;padding:6px 10px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit;flex:1;min-width:180px">
    <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:3px;overflow:hidden">
      ${[['info','📋 内部信息'],['card','🎴 展示卡片']].map(([k,l]) => `<button onclick="tsMode='${k}';tsRenderShell()" style="font-size:11px;padding:5px 14px;border:none;cursor:pointer;font-family:inherit;background:${tsMode===k?'var(--accent)':'var(--surface)'};color:${tsMode===k?'#fff':'var(--text-2)'}">${l}</button>`).join('')}
    </div>
    <button class="btn btn-outline btn-sm" onclick="tsSelected=new Set();tsRenderShell()">清空已选 (<span id="ts_count">${tsSelected.size}</span>)</button>
  </div>
  <div style="font-size:10px;color:var(--text-3);margin-bottom:8px">左侧点选讲师（可多选），右侧即时显示；「展示卡片」模式只含对外内容（无执教年份/VIP/备注），可直接给学生展示或截图。</div>
  <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
    <div id="ts_list" style="flex:0 0 250px;min-width:220px;max-height:70vh;overflow-y:auto;background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:8px"></div>
    <div id="ts_display" style="flex:1 1 420px;min-width:0"></div>
  </div>`;
  tsRenderList();
}

function tsFiltered() {
  let list = tsProfiles;
  if (tsSubject !== 'all') list = list.filter(p => ((p.subject || '未分类').trim() || '未分类') === tsSubject);
  const q = tsSearch.trim();
  if (q) list = list.filter(p =>
    (p.name || '').includes(q) || (p.real_name || '').includes(q)
    || (p.keywords || '').includes(q) || (p.courses || '').includes(q)
    || (p.school || '').includes(q)
    || (typeof matchesPinyin === 'function' && matchesPinyin(p.name || '', q)));
  return list;
}

function tsRenderList() {
  const box = document.getElementById('ts_list');
  if (!box) return;
  const list = tsFiltered();
  box.innerHTML = list.length ? `<div style="display:flex;flex-direction:column;gap:4px">
    ${list.map(p => {
      const sel = tsSelected.has(p.id);
      return `<div onclick="tsToggle('${p.id}')" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid ${sel?'var(--accent)':'transparent'};background:${sel?'var(--accent-light,#f5ede3)':'transparent'};border-radius:3px">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600">${tsEsc(p.name)}${tsPubOf(p.name)!==p.name?`<span style="font-size:9px;color:var(--text-3);font-weight:400;margin-left:4px">→${tsEsc(tsPubOf(p.name))}</span>`:''}</div>
          <div style="font-size:9px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${tsEsc(p.subject || '')} · ${tsEsc(p.school || '')}</div>
        </div>
        <span style="font-size:11px;color:${sel?'var(--accent)':'var(--text-3)'};white-space:nowrap">${sel?'✓':'＋'}</span>
      </div>`;
    }).join('')}
  </div>` : '<div class="empty" style="padding:20px">没有符合条件的讲师</div>';
  const cnt = document.getElementById('ts_count');
  if (cnt) cnt.textContent = tsSelected.size;
  tsRenderDisplay();
}

function tsToggle(id) {
  if (tsSelected.has(id)) tsSelected.delete(id); else tsSelected.add(id);
  tsRenderList();
}

function tsRenderDisplay() {
  const box = document.getElementById('ts_display');
  if (!box) return;
  const sel = tsProfiles.filter(p => tsSelected.has(p.id));
  if (!sel.length) { box.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text-3);font-size:12px;border:1px dashed var(--border);border-radius:4px">← 从左侧点选讲师查看信息（可多选）</div>'; return; }
  box.innerHTML = tsMode === 'card' ? tsCardsHtml(sel) : tsInfoHtml(sel);
}

// ── 内部信息模式：完整档案（含内部字段） ──
function tsInfoHtml(sel) {
  return `<div style="font-size:11px;font-weight:600;margin-bottom:8px">📋 已选讲师 · 内部档案（${sel.length}位）</div>
  ${sel.map(p => `
  <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:12px 16px;margin-bottom:8px">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      <span style="font-size:13px;font-weight:600;font-family:'Noto Serif SC',serif">${tsEsc(p.name)}</span>
      ${tsPubOf(p.name) !== p.name ? `<span style="font-size:9px;background:var(--accent-light,#f5ede3);color:var(--accent);border-radius:2px;padding:0 6px">对外：${tsEsc(tsPubOf(p.name))}</span>` : ''}
      <span style="font-size:10px;color:var(--text-3)">${tsEsc(p.department || '')} / ${tsEsc(p.subject || '')}</span>
      ${p.vip ? `<span style="font-size:9px;background:var(--accent-light,#f5ede3);color:var(--accent);border-radius:2px;padding:0 6px">VIP指导：${tsEsc(p.vip)}</span>` : ''}
      ${p.years ? `<span style="font-size:9px;color:var(--text-3)">执教 ${tsEsc(p.years)} 年</span>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:4px 16px;font-size:11px;color:var(--text-2);line-height:1.8">
      <div><span style="color:var(--text-3)">学历：</span>${tsEsc(p.school || '—')} ${tsEsc(p.degree || '')}</div>
      <div><span style="color:var(--text-3)">担当课程：</span>${tsEsc(p.courses || '—')}</div>
      <div style="grid-column:1/-1"><span style="color:var(--text-3)">可指导方向：</span>${tsEsc(p.keywords || '—')}</div>
      ${p.feature ? `<div style="grid-column:1/-1"><span style="color:var(--text-3)">授课特色：</span>${tsEsc(p.feature)}</div>` : ''}
      ${p.notes ? `<div style="grid-column:1/-1;color:var(--text-3)">备注：${tsEsc(p.notes)}</div>` : ''}
    </div>
  </div>`).join('')}`;
}

// ── 展示卡片模式：干净的对外宣传版（可截图给学生） ──
function tsCardsHtml(sel) {
  return `<div style="font-size:11px;font-weight:600;margin-bottom:8px">🎴 展示卡片（${sel.length}位 · 仅对外内容，可截图）</div>
  <div id="ts_cards" style="background:#f7f5f0;border-radius:6px;padding:18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px">
    ${sel.map(p => `
    <div style="background:#fff;border:1px solid #ede9e2;border-radius:6px;padding:20px 22px;color:#1a1814">
      <div style="font-size:9px;letter-spacing:.2em;color:#5a3e28;margin-bottom:8px">${tsEsc((p.subject || '').toUpperCase() || 'LECTURER')} · 唯新教育</div>
      <div style="font-family:'Noto Serif SC',serif;font-size:17px;font-weight:700;margin-bottom:3px">${tsEsc(tsPubOf(p.name))}</div>
      <div style="font-size:11px;color:#5a3e28;margin-bottom:12px;line-height:1.7">${tsEsc(p.school || '')}${p.degree ? `　${tsEsc(p.degree)}` : ''}</div>
      ${p.keywords ? `<div style="margin-bottom:10px">
        <div style="font-size:9px;letter-spacing:.15em;color:#9a9590;margin-bottom:3px">专攻方向</div>
        <div style="font-size:12px;color:#5a5650;line-height:1.8">${tsEsc(p.keywords)}</div>
      </div>` : ''}
      ${p.feature ? `<div style="margin-bottom:10px">
        <div style="font-size:9px;letter-spacing:.15em;color:#9a9590;margin-bottom:3px">授课特色</div>
        <div style="font-size:12px;color:#5a5650;line-height:1.9">${tsEsc(p.feature)}</div>
      </div>` : ''}
      ${p.courses ? `<div>
        <div style="font-size:9px;letter-spacing:.15em;color:#9a9590;margin-bottom:4px">担当课程</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">${String(p.courses).split(/[,，、\/\s]+/).filter(Boolean).map(c => `<span style="font-size:10px;background:#f5ede3;color:#5a3e28;border-radius:2px;padding:2px 9px">${tsEsc(c)}</span>`).join('')}</div>
      </div>` : ''}
    </div>`).join('')}
  </div>`;
}
