// ══════════════════════════════════
// materials.js — 考学进度 →「📁 出愿材料准备」视图（admin）
// 「✍ 文书指导」——维护 writing_guides（学部 / 大学院志望理由书的写作指导）
// 「📋 材料清单」——维护 material_items（学部 / 大学院各自的出愿材料）
// 依赖：shared/supabase.js、shared/riyu.js、students.js（progressViewButtons）
// ══════════════════════════════════
let matSection = 'guide';          // 当前子板块：guide 文书指导
let wgKind = 'gakubu_riyu';        // 正在编辑的指导：gakubu_riyu | grad_riyu | grad_prof_mail | grad_inquiry_mail
let wgData = null;                 // { kind, title, intro, sections:[{key,title,subtitle,tips:[]}], _fromDb }
let wgDirty = false;
let wgScope = '';                  // 适用范围（仅 grad_riyu）：'' = 通用；领域名 / 专业 key = 专属
let wgScopesSet = [];              // grad_riyu 已有专属指导的范围

async function renderMaterialsView(mc) {
  if (matSection !== 'guide' && matSection !== 'items' && matSection !== 'bank') matSection = 'guide';   // 旧的 'status'（学生准备情况）已去掉
  mc.innerHTML = `
  <div class="page-header">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <div class="section-title">考学进度</div>
      <div style="display:flex;gap:4px">${progressViewButtons()}</div>
    </div>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
    ${[['guide', '✍ 文书指导'], ['items', '📋 材料清单'], ['bank', '🎤 面试题库']].map(([k, l]) => `<div class="filter-chip${matSection === k ? ' active' : ''}" onclick="matSection='${k}';renderMaterialsView(document.getElementById('mainContent'))" style="font-size:12px;padding:4px 14px">${l}</div>`).join('')}
  </div>
  <div id="mat_body"><div class="loading">加载中…</div></div>`;
  if (matSection === 'guide') await wgLoad();
  else if (matSection === 'items') await miLoad();
  else if (matSection === 'bank') await renderInterviewBankAdmin();   // admin/interview-bank.js
}

// ══ 📋 材料清单 ══
let miTrack = 'grad', miList = [], miEditId = null, miEdit = null;
let miScopeOpen = false;          // 通用「志望理由书」下的专属版本折叠区是否展开（默认收起）
async function miLoad() {
  const box = document.getElementById('mat_body'); if (!box) return;
  try { miList = await matLoadItems(miTrack, true) || []; }
  catch (e) { box.innerHTML = `<div style="font-size:12px;color:var(--danger)">读取失败：${riyuEsc(e.message)}（请先执行 PR 里的 SQL 建表）</div>`; return; }
  miRender();
}
function miRender() {
  const box = document.getElementById('mat_body'); if (!box) return;
  const inp = 'width:100%;box-sizing:border-box;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit';
  const lab = t => `<label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">${t}</label>`;
  const form = miEdit ? `<div style="border:1px solid var(--accent);border-radius:4px;padding:12px 14px;background:var(--bg);margin-bottom:12px">
    <div style="font-size:12px;font-weight:600;margin-bottom:8px">${miEditId === 'new' ? '新增材料' : '编辑：' + riyuEsc(miEdit.name)}</div>
    <div style="display:grid;grid-template-columns:1fr 200px;gap:8px;margin-bottom:8px">
      <div>${lab('名称')}<input id="mi_name" value="${riyuEsc(miEdit.name)}" oninput="miEdit.name=this.value" placeholder="例：毕业证明书" style="${inp}"></div>
      <div>${miEdit._scoped ? lab('适用范围') + miScopeSelectHtml(inp) : lab('类型') + miKindSelectHtml(inp)}</div>
    </div>
    ${lab('如何准备（可用 ## 小标题、**粗体**、- 列表、表格）')}<textarea rows="4" oninput="miEdit.guide=this.value" style="${inp};resize:vertical;line-height:1.7;margin-bottom:8px">${riyuEsc(miEdit.guide)}</textarea>
    ${lab('参考例子')}<textarea rows="3" oninput="miEdit.example=this.value" style="${inp};resize:vertical;line-height:1.7;margin-bottom:8px">${riyuEsc(miEdit.example)}</textarea>
    ${lab('参考样本文件（图片 / PDF，可多个）')}
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      ${(miEdit.example_files || []).map((f, i) => `<div style="position:relative">${/\.pdf(\?|$)/i.test(f.url || '') ? `<a href="${riyuEsc(f.url)}" target="_blank" style="display:inline-block;font-size:11px;border:1px solid var(--border);border-radius:3px;padding:24px 8px;background:var(--surface);width:80px;text-align:center;overflow:hidden;text-overflow:ellipsis">📄 ${riyuEsc(f.name || 'PDF')}</a>` : `<a href="${riyuEsc(f.url)}" target="_blank"><img src="${riyuEsc(f.url)}" style="width:80px;height:80px;object-fit:cover;border-radius:3px;border:1px solid var(--border)"></a>`}
        <span onclick="miEdit.example_files.splice(${i},1);miRender()" style="position:absolute;top:-6px;right:-6px;background:var(--danger);color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;line-height:18px;text-align:center;cursor:pointer">✕</span></div>`).join('')}
      <label style="font-size:11px;color:var(--accent);border:1px dashed var(--border);border-radius:3px;padding:8px 12px;cursor:pointer">＋ 上传样本<input type="file" accept="image/*,.pdf" multiple onchange="miUpload(this)" style="display:none"></label>
      <span id="mi_up_tip" style="font-size:10px;color:var(--text-3)"></span>
    </div>
    <div style="display:flex;gap:6px"><button class="btn btn-primary btn-sm" onclick="miSave()">保存</button><button class="btn btn-outline btn-sm" onclick="miEditId=null;miEdit=null;miRender()">取消</button></div>
  </div>` : '';
  const main = miList.filter(x => !x.scope), n = main.length;
  box.innerHTML = `
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <span style="font-size:11px;color:var(--text-3)">清单：</span>
    <select onchange="miTrack=this.value;miEditId=null;miEdit=null;miLoad()" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
      <option value="grad" ${miTrack === 'grad' ? 'selected' : ''}>大学院</option><option value="gakubu" ${miTrack === 'gakubu' ? 'selected' : ''}>学部</option>
    </select>
    <span style="font-size:10px;color:var(--text-3)">学生端「📁 出愿材料」按这里的顺序显示（只显示公开中的）</span>
    <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="miEditId='new';miEdit={name:'',kind:'file',guide:'',example:'',example_files:[]};miRender()">＋ 新增材料</button>
  </div>
  ${form}
  ${n ? main.map((it, i) => { const gen = miIsGenericRiyu(it), ro = gen && !scopeAll(); return `<div style="margin-bottom:6px"><div style="display:flex;align-items:center;gap:8px;border:1px solid var(--border-light);border-radius:3px;padding:8px 12px;background:var(--surface)">
    <span style="font-size:11px;color:var(--text-3);width:18px">${i + 1}</span>
    <span style="font-size:12px;font-weight:600">${riyuEsc(it.name)}</span>
    ${matIsDoc(it) ? '<span style="font-size:9px;color:var(--accent);border:1px solid var(--accent);border-radius:2px;padding:0 5px">在线撰写</span>' : ''}
    <span style="font-size:10px;color:var(--text-3)">${(it.guide || '').trim() ? '有说明' : '无说明'} · 样本 ${matFiles(it).length}</span>
    <span ${ro ? '' : `onclick="miToggle('${riyuEsc(it.id)}')"`} style="cursor:pointer;font-size:9px;border-radius:2px;padding:1px 8px;${it.published === false ? 'background:var(--bg);color:var(--text-3);border:1px dashed var(--border)' : 'background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok)'}">${it.published === false ? '隐藏中 · 点击公开' : '公开中 · 点击隐藏'}</span>
    <span style="margin-left:auto;display:flex;gap:4px">
      ${gen && miTrack === 'grad' ? `<button class="btn btn-outline btn-sm" onclick="miScopeOpen=!miScopeOpen;miRender()">专属版本（${miScopedList().length}）${miScopeOpen ? ' ▴' : ' ▾'}</button>` : ''}
      <button class="btn btn-outline btn-sm" ${i === 0 ? 'disabled' : ''} onclick="miMove(${i},-1)">↑</button>
      <button class="btn btn-outline btn-sm" ${i === n - 1 ? 'disabled' : ''} onclick="miMove(${i},1)">↓</button>
      <button class="btn btn-outline btn-sm" ${ro ? 'disabled' : ''} onclick="miEditStart('${riyuEsc(it.id)}')">编辑</button>
      <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" ${ro ? 'disabled' : ''} onclick="miDel('${riyuEsc(it.id)}')">删除</button>
    </span>
  </div>${gen && miTrack === 'grad' && miScopeOpen ? miScopedHtml() : ''}</div>`; }).join('') : `<div class="empty" style="padding:30px">${miTrack === 'gakubu' ? '学部' : '大学院'}清单还没有材料，点「＋ 新增材料」开始录入</div>`}`;
}
function miKindSelectHtml(inp) {
  return `<select onchange="miEdit.kind=this.value" style="${inp}"><option value="file" ${!matIsDoc(miEdit) ? 'selected' : ''}>普通材料（学生更新准备状态）</option><option value="riyu" ${miEdit.kind === 'riyu' ? 'selected' : ''}>志望理由书（在线撰写、老师批复）</option>${miTrack === 'grad' ? `<option value="prof_mail" ${miEdit.kind === 'prof_mail' ? 'selected' : ''}>联系教授邮件（在线撰写·按志望校）</option><option value="inquiry_mail" ${miEdit.kind === 'inquiry_mail' ? 'selected' : ''}>问询邮件（在线撰写）</option>` : ''}</select>`;
}
function miIsGenericRiyu(it) { return it && it.kind === 'riyu' && it.track === 'grad' && !it.scope; }
function miScopedList() { return miList.filter(x => x.kind === 'riyu' && x.track === 'grad' && x.scope && riyuScopeManageable(x.scope)); }
function miScopedHtml() {
  const list = miScopedList();
  const btn = 'font-size:10px;padding:2px 8px';
  return `<div style="margin:4px 0 0 28px;border-left:2px solid var(--border);padding:4px 0 4px 10px">
    ${list.map(it => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:11px">
      <span style="font-weight:600">适用：${riyuEsc(riyuScopeLabel(it.scope))}</span>
      <span style="color:var(--text-3)">${(it.guide || '').trim() ? '有说明' : '无说明'} · 样本 ${matFiles(it).length}</span>
      <span onclick="miToggle('${riyuEsc(it.id)}')" style="cursor:pointer;font-size:9px;border-radius:2px;padding:1px 8px;${it.published === false ? 'background:var(--bg);color:var(--text-3);border:1px dashed var(--border)' : 'background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok)'}">${it.published === false ? '未公开 · 点击公开' : '公开中 · 点击隐藏'}</span>
      <span style="margin-left:auto;display:flex;gap:4px">
        <button class="btn btn-outline btn-sm" style="${btn}" onclick="miEditStart('${riyuEsc(it.id)}')">编辑</button>
        <button class="btn btn-sm" style="${btn};color:var(--danger);border:1px solid var(--danger);background:none" onclick="miDel('${riyuEsc(it.id)}')">删除</button>
      </span></div>`).join('') || '<div style="font-size:11px;color:var(--text-3);padding:4px 0">还没有专属版本</div>'}
    <button class="btn btn-outline btn-sm" style="margin-top:4px" onclick="miScopedNew()">＋ 新增专属版本</button>
  </div>`;
}
function miEditStart(id) {
  const it = miList.find(x => x.id === id); if (!it) return;
  miEditId = id;
  miEdit = JSON.parse(JSON.stringify(Object.assign({}, it, { example_files: matFiles(it) })));
  if (miIsScopedRiyu(it)) miEdit._scoped = true;
  miRender();
}
function miIsScopedRiyu(it) { return it && it.kind === 'riyu' && it.track === 'grad' && !!it.scope; }
function miScopedNew() {
  const g = miList.find(miIsGenericRiyu); if (!g) return;
  miEditId = 'new';
  miEdit = { name: g.name, kind: 'riyu', scope: '', _scoped: true, guide: g.guide || '', example: g.example || '', example_files: JSON.parse(JSON.stringify(matFiles(g))) };
  miRender();
}
function miScopeSelectHtml(inp) {
  const o = riyuScopeOptions();
  const used = miList.filter(x => miIsScopedRiyu(x) && x.id !== miEditId).map(x => x.scope);
  const opt = (v, l) => `<option value="${riyuEsc(v)}" ${miEdit.scope === v ? 'selected' : ''} ${used.includes(v) ? 'disabled' : ''}>${riyuEsc(l)}${used.includes(v) ? ' · 已设置' : ''}</option>`;
  return `<select onchange="miEdit.scope=this.value" style="${inp}"><option value="">请选择适用范围</option>${o.doms.map(d => opt(d, d)).join('')}${o.majors.map(k => opt(k, majorLabel(k) + '（专业）')).join('')}</select>`;
}
async function miUpload(input) {
  const files = [...(input.files || [])]; input.value = '';
  const tip = document.getElementById('mi_up_tip');
  try {
    for (let i = 0; i < files.length; i++) {
      if (tip) tip.textContent = `上传中 ${i + 1}/${files.length}…`;
      const f = /^image\//.test(files[i].type) && typeof awCompress === 'function' ? await awCompress(files[i]) : files[i];
      const ext = /jpe?g/i.test(f.type) ? 'jpg' : ((files[i].name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin');
      const url = await sbUpload('teacher-files', `materials/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`, f);
      miEdit.example_files.push({ url, name: files[i].name });
    }
    miRender();
  } catch (e) { if (tip) tip.textContent = '上传失败：' + e.message; }
}
async function miSave() {
  const e = miEdit; if (!e) return;
  if (!(e.name || '').trim()) { alert('请填写名称'); return; }
  if (e._scoped) {
    if (!e.scope) { alert('请选择适用范围'); return; }
    if (!riyuScopeManageable(e.scope)) { alert('这个范围不在当前账号的管理范围内'); return; }
    if (miList.some(x => miIsScopedRiyu(x) && x.scope === e.scope && x.id !== miEditId)) { alert('这个范围已经有专属版本了，不能重复新增'); return; }
  }
  const data = { track: miTrack, name: e.name.trim(), kind: (e._scoped || e.kind === 'riyu' || ((e.kind === 'prof_mail' || e.kind === 'inquiry_mail') && miTrack === 'grad')) ? e.kind : 'file', guide: e.guide || '', example: e.example || '', example_files: e.example_files || [] };
  if (e._scoped) { data.scope = e.scope; data.kind = 'riyu'; }
  try {
    if (miEditId === 'new') {
      const gen = e._scoped ? miList.find(miIsGenericRiyu) : null;   // 专属版本的排序沿用通用那条（学生端不看它自己的排序）
      Object.assign(data, { id: `mi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, sort_order: gen ? (gen.sort_order || 0) : (miList.length ? Math.max(...miList.map(x => x.sort_order || 0)) + 1 : 0), published: true });
      await sb('/rest/v1/material_items', 'POST', data);
    } else {
      await sb(`/rest/v1/material_items?id=eq.${encodeURIComponent(miEditId)}`, 'PATCH', data);
    }
    miEditId = null; miEdit = null;
    await miLoad();
  } catch (err) { alert('保存失败：' + err.message); }
}
async function miToggle(id) {
  const it = miList.find(x => x.id === id); if (!it) return;
  const v = it.published === false;
  try { await sb(`/rest/v1/material_items?id=eq.${encodeURIComponent(id)}`, 'PATCH', { published: v }); it.published = v; miRender(); }
  catch (e) { alert('保存失败：' + e.message); }
}
async function miMove(i, d) {
  const main = miList.filter(x => !x.scope), j = i + d; if (j < 0 || j >= main.length) return;
  [main[i], main[j]] = [main[j], main[i]];
  try {
    for (let k = 0; k < main.length; k++) {
      if (main[k].sort_order !== k) { await sb(`/rest/v1/material_items?id=eq.${encodeURIComponent(main[k].id)}`, 'PATCH', { sort_order: k }); main[k].sort_order = k; }
    }
    // 专属版本的排序跟着通用那条走
    const g = main.find(miIsGenericRiyu);
    for (const x of miList.filter(miIsScopedRiyu)) if (g && x.sort_order !== g.sort_order) { await sb(`/rest/v1/material_items?id=eq.${encodeURIComponent(x.id)}`, 'PATCH', { sort_order: g.sort_order }); x.sort_order = g.sort_order; }
  } catch (e) { alert('排序保存失败：' + e.message); }
  miList = main.concat(miList.filter(x => x.scope)).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  miRender();
}
async function miDel(id) {
  const it = miList.find(x => x.id === id); if (!it) return;
  if (miIsGenericRiyu(it)) {
    if (!scopeAll()) { alert('通用版本由总览账号维护'); return; }
    if (miList.some(miIsScopedRiyu)) { alert('这条「志望理由书」下还有专属版本，请先删除专属版本'); return; }
  }
  if (miIsScopedRiyu(it)) { if (!confirm(`删除「${riyuScopeLabel(it.scope)}」的专属版本？\n删除后，这个范围的学生回到通用版本。`)) return; }
  else if (!confirm(`删除「${it.name}」？\n学生已经填写的这项准备情况也会看不到。`)) return;
  try { await sb(`/rest/v1/material_items?id=eq.${encodeURIComponent(id)}`, 'DELETE'); await miLoad(); }
  catch (e) { alert('删除失败：' + e.message); }
}

async function wgLoad() {
  if (wgKind !== 'grad_riyu') wgScope = '';
  const g = await riyuLoadGuide(wgKind, true, wgScope);
  if (wgKind === 'grad_riyu') {
    try { wgScopesSet = ((await sb('/rest/v1/writing_guides?kind=eq.grad_riyu&select=scope', 'GET', null, { cache: 'no-store' })) || []).map(r => r.scope || '').filter(Boolean); }
    catch (e) { wgScopesSet = []; }
  }
  wgData = JSON.parse(JSON.stringify(g));
  // 专属范围还没有自己的那一份：编辑区先空着，等「从通用版本复制一份」
  if (wgScope && !g._fromDb) wgData = { kind: wgKind, scope: wgScope, title: '', intro: '', sections: [], ref_files: [], _fromDb: false };
  wgDirty = false;
  wgRender();
}
function wgSwitchKind(k) {
  if (wgDirty && !confirm('当前修改还没有保存，切换后会丢失。继续？')) { wgRender(); return; }
  wgKind = k; wgScope = ''; wgLoad();
}
function wgSwitchScope(sc) {
  if (wgDirty && !confirm('当前修改还没有保存，切换后会丢失。继续？')) { wgRender(); return; }
  wgScope = sc || ''; wgLoad();
}
function wgIsReadOnly() { return wgKind === 'grad_riyu' && wgScope === '' && !scopeAll(); }
function wgScopeSelectHtml() {
  if (wgKind !== 'grad_riyu') return '';
  const o = riyuScopeOptions();
  const opt = (v, l) => `<option value="${riyuEsc(v)}" ${wgScope === v ? 'selected' : ''}>${riyuEsc(l)}${v && wgScopesSet.includes(v) ? ' · 已设置' : ''}</option>`;
  return `<span style="font-size:11px;color:var(--text-3)">适用范围：</span>
    <select onchange="wgSwitchScope(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
      ${opt('', '通用（默认）')}
      ${o.doms.map(d => opt(d, d)).join('')}
      ${o.majors.map(k => opt(k, majorLabel(k) + '（专业）')).join('')}
    </select>`;
}
function wgScopeNoticeHtml() {
  if (wgKind !== 'grad_riyu') return '';
  const box = 'font-size:11px;border-radius:3px;padding:6px 10px;margin-bottom:10px;';
  let h = '';
  if (wgIsReadOnly()) h += `<div style="${box}color:var(--text-3);background:var(--surface);border:1px solid var(--border)">通用版本由总览账号维护（当前只读）。</div>`;
  if (wgScope && !wgData._fromDb) h += `<div style="${box}color:var(--warn,#b8860b);background:#fff8e6;border:1px solid #e8d4a0;display:flex;align-items:center;gap:10px;flex-wrap:wrap">这个范围还没有单独的指导，学生现在看到的是通用版本。<button class="btn btn-outline btn-sm" onclick="wgCopyGeneric()">从通用版本复制一份</button></div>`;
  if (wgScope && wgData._fromDb) h += `<div style="${box}display:flex;align-items:center;gap:10px"><span style="color:var(--text-3)">当前编辑：${riyuEsc(riyuScopeLabel(wgScope))} 专属指导</span><button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="wgDelScope()">删除这份专属指导，回到通用</button></div>`;
  h += `<div style="font-size:10px;color:var(--text-3);margin-bottom:8px;line-height:1.6">想让已经开始写的学生不丢内容：专属版本尽量沿用通用版本的段落（用「从通用复制」再改标题和提示即可）；新增段落没关系，删段落学生那段内容不会被删，但撰写页不再显示。</div>`;
  return h;
}
async function wgCopyGeneric() {
  if (wgDirty && !confirm('当前已经有修改，复制后会被通用版本覆盖。继续？')) return;
  try {
    const g = await riyuLoadGuide(wgKind, true, '');
    wgData = JSON.parse(JSON.stringify(g)); wgData.scope = wgScope; wgData._fromDb = false;
    wgDirty = true; wgRender();
  } catch (e) { alert('复制失败：' + e.message); }
}
async function wgDelScope() {
  if (!wgScope || wgKind !== 'grad_riyu') return;
  if (!confirm(`删除「${riyuScopeLabel(wgScope)}」的专属指导，回到通用版本？\n学生已经写的内容不会删除。`)) return;
  try {
    await sb(`/rest/v1/writing_guides?kind=eq.grad_riyu&scope=eq.${encodeURIComponent(wgScope)}`, 'DELETE');
    wgClearCache('grad_riyu');
    await wgLoad();
  } catch (e) { alert('删除失败：' + e.message); }
}
function wgClearCache(kind) { Object.keys(riyuGuideCache).forEach(k => { if (k.indexOf(kind + '|') === 0) delete riyuGuideCache[k]; }); }

function wgRender() {
  const box = document.getElementById('mat_body'); if (!box || !wgData) return;
  const inp = 'width:100%;box-sizing:border-box;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit';
  const lab = t => `<label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">${t}</label>`;
  const n = wgData.sections.length;
  box.innerHTML = `
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <span style="font-size:11px;color:var(--text-3)">编辑哪一份：</span>
    <select onchange="wgSwitchKind(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
      ${RIYU_GUIDE_KINDS.map(([k, l]) => `<option value="${k}" ${wgKind === k ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    ${wgScopeSelectHtml()}
    <span style="font-size:10px;color:var(--text-3)">保存后学生端马上看到新内容（学生按这里的段落逐段撰写）</span>
  </div>
  ${wgScopeNoticeHtml()}
  ${(wgScope || wgData._fromDb) ? '' : '<div style="font-size:11px;color:var(--warn,#b8860b);background:#fff8e6;border:1px solid #e8d4a0;border-radius:3px;padding:6px 10px;margin-bottom:10px">数据库里还没有这份指导，下面是默认内容；点「保存」后才会正式写入（如果保存失败，请先执行 PR 里的 SQL 建表）。</div>'}
  <div style="border:1px solid var(--border);border-radius:4px;padding:12px 14px;background:var(--bg);margin-bottom:12px">
    <div style="display:grid;grid-template-columns:220px 1fr;gap:10px">
      <div>${lab('标题')}<input value="${riyuEsc(wgData.title)}" oninput="wgData.title=this.value;wgDirty=true" style="${inp}"></div>
      <div>${lab('顶部说明（学生页最上方显示；可用 **粗体**、- 列表）')}<textarea rows="3" oninput="wgData.intro=this.value;wgDirty=true" style="${inp};resize:vertical;line-height:1.7">${riyuEsc(wgData.intro)}</textarea></div>
    </div>
  </div>
  <div style="border:1px solid var(--border);border-radius:4px;padding:10px 14px;background:var(--bg);margin-bottom:12px">
    ${lab('参考资料（PDF / Word，可以多个；学生撰写页最上面显示「参考资料」列表）')}
    ${(wgData.ref_files || []).map((f, i) => `<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:3px"><a href="${riyuEsc(f.url)}" target="_blank" style="color:var(--accent)">${riyuEsc(f.name)}</a><span onclick="wgRefDel(${i})" style="cursor:pointer;color:var(--danger);font-size:11px">删除</span></div>`).join('') || '<div style="font-size:11px;color:var(--text-3);margin-bottom:4px">还没有参考资料</div>'}
    <div style="display:flex;align-items:center;gap:8px;margin-top:6px"><input type="file" id="wg_ref_file" accept=".pdf,.doc,.docx" multiple style="font-size:11px"><button class="btn btn-outline btn-sm" onclick="wgRefAdd()">上传</button><span id="wg_ref_msg" style="font-size:11px;color:var(--text-3)"></span></div>
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
  if (wgIsReadOnly()) box.querySelectorAll('input,textarea,button').forEach(el => { el.disabled = true; });
}
async function wgRefAdd() {
  const files = [...(document.getElementById('wg_ref_file')?.files || [])];
  const msg = document.getElementById('wg_ref_msg');
  if (!files.length) { if (msg) msg.textContent = '请先选择文件'; return; }
  const bad = files.find(f => !['pdf', 'doc', 'docx'].includes((f.name.split('.').pop() || '').toLowerCase()));
  if (bad) { if (msg) msg.textContent = '只能上传 PDF / Word：' + bad.name; return; }
  wgData.ref_files = wgData.ref_files || [];
  try {
    for (let i = 0; i < files.length; i++) {
      if (msg) msg.textContent = `上传中 ${i + 1} / ${files.length}…`;
      const f = files[i], ext = f.name.split('.').pop().toLowerCase();
      const url = await sbUpload('teacher-files', `guides/${wgKind}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`, f);
      wgData.ref_files.push({ name: f.name, url });
    }
    wgDirty = true; wgRender();
    const m2 = document.getElementById('wg_ref_msg'); if (m2) m2.textContent = '已上传，记得点下面的「保存」';
  } catch (e) { if (msg) msg.textContent = '上传失败：' + e.message; }
}
function wgRefDel(i) {
  const f = (wgData.ref_files || [])[i]; if (!f) return;
  if (!confirm(`从参考资料里移除「${f.name}」？（只是不再显示，文件不会被删除）`)) return;
  wgData.ref_files.splice(i, 1); wgDirty = true; wgRender();
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
  if (wgIsReadOnly()) { alert('通用版本由总览账号维护'); return; }
  const row = { kind: wgKind, scope: wgScope, title: (wgData.title || '').trim(), intro: wgData.intro || '', sections: secs, ref_files: wgData.ref_files || [], updated_at: new Date().toISOString() };
  const btn = document.getElementById('wg_save_btn'); if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    const tok = (typeof __getSbToken === 'function') ? __getSbToken() : null;
    const post = (oc, body) => fetch(`${SB_URL}/rest/v1/writing_guides?on_conflict=${oc}`, { method: 'POST', headers: {
      'apikey': SB_KEY, 'Authorization': 'Bearer ' + (tok || SB_KEY), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify([body]) });
    let r = await post('kind,scope', row);
    if (!r.ok && wgScope === '') {   // scope 列还没建（SQL 未执行）：通用版本退回旧写法
      const old = Object.assign({}, row); delete old.scope;
      const r2 = await post('kind', old);
      if (r2.ok) r = r2;
    }
    if (!r.ok) throw new Error(await r.text());
    const saved = (await r.json())[0];
    if (!saved) throw new Error('没有写入成功（请确认已执行建表 SQL，且当前账号有权限）');
    wgClearCache(wgKind);
    riyuGuideCache[wgKind + '|' + wgScope] = Object.assign(riyuNormGuide(saved), { kind: wgKind, scope: wgScope, _fromDb: true });
    wgData = JSON.parse(JSON.stringify(riyuGuideCache[wgKind + '|' + wgScope]));
    if (wgScope && !wgScopesSet.includes(wgScope)) wgScopesSet.push(wgScope);
    wgDirty = false;
    wgRender();
    if (typeof riyuMailSavedMark === 'function') riyuMailSavedMark(wgKind);
    const okTxt = riyuIsMail(wgKind) ? '✓ 已保存。大学院学生在「计划书」里可以看到（联系教授邮件 / 问询邮件）' : '✓ 已保存';
    const msg = document.getElementById('wg_msg'); if (msg) { msg.textContent = okTxt; setTimeout(() => { if (msg.textContent === okTxt) msg.textContent = ''; }, 6000); }
  } catch (e) {
    alert('保存失败：' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  }
}
