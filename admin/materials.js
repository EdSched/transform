// ══════════════════════════════════
// materials.js — 考学进度 →「📁 出愿材料准备」视图（admin）
// 第一批：「✍ 文书指导」——维护 writing_guides（学部 / 大学院志望理由书的写作指导）
// 依赖：shared/supabase.js、shared/riyu.js、students.js（progressViewButtons）
// ══════════════════════════════════
let matSection = 'guide';          // 当前子板块：guide 文书指导
let wgKind = 'gakubu_riyu';        // 正在编辑的指导：gakubu_riyu | grad_riyu
let wgData = null;                 // { kind, title, intro, sections:[{key,title,subtitle,tips:[]}], _fromDb }
let wgDirty = false;

async function renderMaterialsView(mc) {
  mc.innerHTML = `
  <div class="page-header">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <div class="section-title">考学进度</div>
      <div style="display:flex;gap:4px">${progressViewButtons()}</div>
    </div>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
    ${[['guide', '✍ 文书指导']].map(([k, l]) => `<div class="filter-chip${matSection === k ? ' active' : ''}" onclick="matSection='${k}';renderMaterialsView(document.getElementById('mainContent'))" style="font-size:12px;padding:4px 14px">${l}</div>`).join('')}
  </div>
  <div id="mat_body"><div class="loading">加载中…</div></div>`;
  if (matSection === 'guide') await wgLoad();
}

async function wgLoad() {
  const g = await riyuLoadGuide(wgKind, true);
  wgData = JSON.parse(JSON.stringify(g));
  wgDirty = false;
  wgRender();
}
function wgSwitchKind(k) {
  if (wgDirty && !confirm('当前修改还没有保存，切换后会丢失。继续？')) { wgRender(); return; }
  wgKind = k; wgLoad();
}

function wgRender() {
  const box = document.getElementById('mat_body'); if (!box || !wgData) return;
  const inp = 'width:100%;box-sizing:border-box;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit';
  const lab = t => `<label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">${t}</label>`;
  const n = wgData.sections.length;
  box.innerHTML = `
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <span style="font-size:11px;color:var(--text-3)">编辑哪一份：</span>
    <select onchange="wgSwitchKind(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
      ${Object.entries(RIYU_KIND_LABEL).map(([k, l]) => `<option value="${k}" ${wgKind === k ? 'selected' : ''}>${l} · 志望理由书</option>`).join('')}
    </select>
    <span style="font-size:10px;color:var(--text-3)">保存后学生端马上看到新内容（学生按这里的段落逐段撰写）</span>
  </div>
  ${wgData._fromDb ? '' : '<div style="font-size:11px;color:var(--warn,#b8860b);background:#fff8e6;border:1px solid #e8d4a0;border-radius:3px;padding:6px 10px;margin-bottom:10px">数据库里还没有这份指导，下面是默认内容；点「保存」后才会正式写入（如果保存失败，请先执行 PR 里的 SQL 建表）。</div>'}
  <div style="border:1px solid var(--border);border-radius:4px;padding:12px 14px;background:var(--bg);margin-bottom:12px">
    <div style="display:grid;grid-template-columns:220px 1fr;gap:10px">
      <div>${lab('标题')}<input value="${riyuEsc(wgData.title)}" oninput="wgData.title=this.value;wgDirty=true" style="${inp}"></div>
      <div>${lab('顶部说明（学生页最上方显示；可用 **粗体**、- 列表）')}<textarea rows="3" oninput="wgData.intro=this.value;wgDirty=true" style="${inp};resize:vertical;line-height:1.7">${riyuEsc(wgData.intro)}</textarea></div>
    </div>
  </div>
  ${wgData.sections.map((sec, i) => `
  <div style="border:1px solid var(--border-light);border-radius:4px;padding:10px 12px;margin-bottom:8px;background:var(--surface)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:12px;font-weight:600;color:var(--accent)">第 ${i + 1} 段</span>
      <span style="font-size:9px;color:var(--text-3)">代码 ${riyuEsc(sec.key)}</span>
      <span style="margin-left:auto;display:flex;gap:4px">
        <button class="btn btn-outline btn-sm" ${i === 0 ? 'disabled' : ''} onclick="wgMove(${i},-1)">↑</button>
        <button class="btn btn-outline btn-sm" ${i === n - 1 ? 'disabled' : ''} onclick="wgMove(${i},1)">↓</button>
        <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="wgDel(${i})">删除</button>
      </span>
    </div>
    <div style="display:grid;grid-template-columns:200px 1fr;gap:8px;margin-bottom:6px">
      <div>${lab('段落标题')}<input value="${riyuEsc(sec.title)}" oninput="wgData.sections[${i}].title=this.value;wgDirty=true" style="${inp}"></div>
      <div>${lab('说明（学生端加粗显示）')}<input value="${riyuEsc(sec.subtitle)}" oninput="wgData.sections[${i}].subtitle=this.value;wgDirty=true" style="${inp}"></div>
    </div>
    ${lab('写作要点（每行一条，学生端放在可折叠的提示框里）')}
    <textarea rows="${Math.max(2, sec.tips.length + 1)}" oninput="wgData.sections[${i}].tips=this.value.split('\\n');wgDirty=true" style="${inp};resize:vertical;line-height:1.7">${riyuEsc(sec.tips.join('\n'))}</textarea>
  </div>`).join('')}
  <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
    <button class="btn btn-outline btn-sm" onclick="wgAdd()">＋ 添加段落</button>
    <button class="btn btn-primary btn-sm" id="wg_save_btn" onclick="wgSave()" style="margin-left:auto">保存</button>
    <span id="wg_msg" style="font-size:11px;color:var(--ok)"></span>
  </div>`;
}
function wgMove(i, d) {
  const a = wgData.sections, j = i + d; if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]]; wgDirty = true; wgRender();
}
function wgDel(i) {
  const sec = wgData.sections[i];
  if (!confirm(`删除「${sec.title || '第' + (i + 1) + '段'}」？\n学生已经写的这一段内容不会删除，但撰写页面不再显示这一段（老师查看 / 下载 Word 时仍会列出）。`)) return;
  wgData.sections.splice(i, 1); wgDirty = true; wgRender();
}
function wgAdd() {
  wgData.sections.push({ key: 's' + Date.now().toString(36), title: '', subtitle: '', tips: [] });
  wgDirty = true; wgRender();
}
async function wgSave() {
  const secs = wgData.sections.map(s => ({ key: s.key, title: (s.title || '').trim(), subtitle: (s.subtitle || '').trim(), tips: (s.tips || []).map(t => String(t).trim()).filter(Boolean) }));
  if (secs.some(s => !s.title)) { alert('每一段都要有标题'); return; }
  const row = { kind: wgKind, title: (wgData.title || '').trim(), intro: wgData.intro || '', sections: secs, updated_at: new Date().toISOString() };
  const btn = document.getElementById('wg_save_btn'); if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    const tok = (typeof __getSbToken === 'function') ? __getSbToken() : null;
    const r = await fetch(`${SB_URL}/rest/v1/writing_guides?on_conflict=kind`, { method: 'POST', headers: {
      'apikey': SB_KEY, 'Authorization': 'Bearer ' + (tok || SB_KEY), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify([row]) });
    if (!r.ok) throw new Error(await r.text());
    const saved = (await r.json())[0];
    if (!saved) throw new Error('没有写入成功（请确认已执行建表 SQL，且当前账号有权限）');
    riyuGuideCache[wgKind] = Object.assign(riyuNormGuide(saved), { kind: wgKind, _fromDb: true });
    wgData = JSON.parse(JSON.stringify(riyuGuideCache[wgKind]));
    wgDirty = false;
    wgRender();
    const msg = document.getElementById('wg_msg'); if (msg) { msg.textContent = '✓ 已保存'; setTimeout(() => { if (msg.textContent === '✓ 已保存') msg.textContent = ''; }, 2500); }
  } catch (e) {
    alert('保存失败：' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}
