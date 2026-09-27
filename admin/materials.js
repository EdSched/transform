// ══════════════════════════════════
// materials.js — 考学进度 →「📁 出愿材料准备」视图（admin）
// 「✍ 文书指导」——维护 writing_guides（学部 / 大学院志望理由书的写作指导）
// 「📋 材料清单」——维护 material_items（学部 / 大学院各自的出愿材料）
// 「📊 学生准备情况」——学生 × 材料 的准备状态一览（student_materials）
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
    ${[['guide', '✍ 文书指导'], ['items', '📋 材料清单'], ['status', '📊 学生准备情况']].map(([k, l]) => `<div class="filter-chip${matSection === k ? ' active' : ''}" onclick="matSection='${k}';renderMaterialsView(document.getElementById('mainContent'))" style="font-size:12px;padding:4px 14px">${l}</div>`).join('')}
  </div>
  <div id="mat_body"><div class="loading">加载中…</div></div>`;
  if (matSection === 'guide') await wgLoad();
  else if (matSection === 'items') await miLoad();
  else if (matSection === 'status') await msLoad();
}

// ══ 📋 材料清单 ══
let miTrack = 'grad', miList = [], miEditId = null, miEdit = null;
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
      <div>${lab('类型')}<select onchange="miEdit.kind=this.value" style="${inp}"><option value="file" ${miEdit.kind !== 'riyu' ? 'selected' : ''}>普通材料（学生更新准备状态）</option><option value="riyu" ${miEdit.kind === 'riyu' ? 'selected' : ''}>志望理由书（在线撰写、老师批复）</option></select></div>
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
  const n = miList.length;
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
  ${n ? miList.map((it, i) => `<div style="display:flex;align-items:center;gap:8px;border:1px solid var(--border-light);border-radius:3px;padding:8px 12px;margin-bottom:6px;background:var(--surface)">
    <span style="font-size:11px;color:var(--text-3);width:18px">${i + 1}</span>
    <span style="font-size:12px;font-weight:600">${riyuEsc(it.name)}</span>
    ${it.kind === 'riyu' ? '<span style="font-size:9px;color:var(--accent);border:1px solid var(--accent);border-radius:2px;padding:0 5px">在线撰写</span>' : ''}
    <span style="font-size:10px;color:var(--text-3)">${(it.guide || '').trim() ? '有说明' : '无说明'} · 样本 ${matFiles(it).length}</span>
    <span onclick="miToggle('${riyuEsc(it.id)}')" style="cursor:pointer;font-size:9px;border-radius:2px;padding:1px 8px;${it.published === false ? 'background:var(--bg);color:var(--text-3);border:1px dashed var(--border)' : 'background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok)'}">${it.published === false ? '隐藏中 · 点击公开' : '公开中 · 点击隐藏'}</span>
    <span style="margin-left:auto;display:flex;gap:4px">
      <button class="btn btn-outline btn-sm" ${i === 0 ? 'disabled' : ''} onclick="miMove(${i},-1)">↑</button>
      <button class="btn btn-outline btn-sm" ${i === n - 1 ? 'disabled' : ''} onclick="miMove(${i},1)">↓</button>
      <button class="btn btn-outline btn-sm" onclick="miEditId='${riyuEsc(it.id)}';miEdit=JSON.parse(JSON.stringify(Object.assign({},miList[${i}],{example_files:matFiles(miList[${i}])})));miRender()">编辑</button>
      <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="miDel('${riyuEsc(it.id)}')">删除</button>
    </span>
  </div>`).join('') : `<div class="empty" style="padding:30px">${miTrack === 'gakubu' ? '学部' : '大学院'}清单还没有材料，点「＋ 新增材料」开始录入</div>`}`;
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
  const data = { track: miTrack, name: e.name.trim(), kind: e.kind === 'riyu' ? 'riyu' : 'file', guide: e.guide || '', example: e.example || '', example_files: e.example_files || [] };
  try {
    if (miEditId === 'new') {
      Object.assign(data, { id: `mi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, sort_order: miList.length ? Math.max(...miList.map(x => x.sort_order || 0)) + 1 : 0, published: true });
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
  const j = i + d; if (j < 0 || j >= miList.length) return;
  [miList[i], miList[j]] = [miList[j], miList[i]];
  try {
    for (let k = 0; k < miList.length; k++) {
      if (miList[k].sort_order !== k) { await sb(`/rest/v1/material_items?id=eq.${encodeURIComponent(miList[k].id)}`, 'PATCH', { sort_order: k }); miList[k].sort_order = k; }
    }
  } catch (e) { alert('排序保存失败：' + e.message); }
  miRender();
}
async function miDel(id) {
  const it = miList.find(x => x.id === id); if (!it) return;
  if (!confirm(`删除「${it.name}」？\n学生已经填写的这项准备情况也会看不到。`)) return;
  try { await sb(`/rest/v1/material_items?id=eq.${encodeURIComponent(id)}`, 'DELETE'); await miLoad(); }
  catch (e) { alert('删除失败：' + e.message); }
}

// ══ 📊 学生准备情况 ══
let msTrack = 'grad';
async function msLoad() {
  const box = document.getElementById('mat_body'); if (!box) return;
  box.innerHTML = '<div class="loading">加载中…</div>';
  let items = [], rows = [], plans = [], subs = [];
  try {
    [items, rows, plans, subs] = await Promise.all([
      matLoadItems(msTrack),
      sbAll('/rest/v1/student_materials?select=*'),
      sbAll('/rest/v1/student_school_plans?select=student_id,school_name,faculty,department,level'),
      sbAll('/rest/v1/riyu_submissions?select=student_id,kind,school_key,status'),
    ]);
  } catch (e) { box.innerHTML = `<div style="font-size:12px;color:var(--danger)">读取失败：${riyuEsc(e.message)}（请先执行 PR 里的 SQL 建表）</div>`; return; }
  // 学生：在读 + 当前领域 / 专业筛选（与学生视角一致），按学部 / 大学院分
  let stus = (cachedStudents || []).filter(s => (s.status === 'active' || !s.status) && studentInCurrentView(s));
  if (typeof stMajorFilter !== 'undefined' && stMajorFilter !== 'all') stus = stus.filter(s => matchesMajorFilter(s.major, stMajorFilter));
  stus = stus.filter(s => matTrackOf(s) === msTrack);
  const by = (arr, k) => { const m = {}; (arr || []).forEach(r => (m[r[k]] = m[r[k]] || []).push(r)); return m; };
  const rowsBy = by(rows, 'student_id'), plansBy = by(plans, 'student_id'), subsBy = by(subs, 'student_id');
  const kind = matRiyuKind(msTrack);
  const cell = (st, t) => { const i = matStatusInfo(st); return `<span style="font-size:10px;padding:1px 7px;border-radius:9px;background:${i.bg};color:${i.c};white-space:nowrap">${riyuEsc(t)}</span>`; };
  box.innerHTML = `
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <span style="font-size:11px;color:var(--text-3)">清单：</span>
    <select onchange="msTrack=this.value;msLoad()" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
      <option value="grad" ${msTrack === 'grad' ? 'selected' : ''}>大学院</option><option value="gakubu" ${msTrack === 'gakubu' ? 'selected' : ''}>学部</option>
    </select>
    <span style="font-size:10px;color:var(--text-3)">学生 ${stus.length} 人 · 专业筛选沿用「学生视角」里选的专业</span>
  </div>
  ${!items.length ? `<div class="empty" style="padding:30px">${msTrack === 'gakubu' ? '学部' : '大学院'}清单还没有公开的材料</div>` : !stus.length ? '<div class="empty" style="padding:30px">没有符合条件的学生</div>' : `
  <div style="overflow-x:auto;border:1px solid var(--border);border-radius:4px"><table style="border-collapse:collapse;font-size:11px;min-width:100%">
    <thead><tr style="background:var(--bg)"><th style="position:sticky;left:0;background:var(--bg);text-align:left;padding:6px 10px;border-bottom:1px solid var(--border);white-space:nowrap">学生</th><th style="padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap">进度</th>
      ${items.map(it => `<th style="padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap;font-weight:600">${riyuEsc(it.name)}</th>`).join('')}</tr></thead>
    <tbody>${stus.map(s => {
      const rs = rowsBy[s.id] || [], rc = riyuCounts(plansBy[s.id] || [], subsBy[s.id] || [], kind), pg = matProgress(items, rs, rc);
      return `<tr style="border-bottom:1px solid var(--border-light)"><td style="position:sticky;left:0;background:var(--surface);padding:5px 10px;font-weight:600;white-space:nowrap">${riyuEsc(s.name)} <span style="font-weight:400;font-size:10px;color:var(--text-3)">${riyuEsc(MAJORS[s.major] || s.major || '')}</span></td>
        <td style="padding:5px 8px;text-align:center;white-space:nowrap;color:${pg.ready >= pg.total ? 'var(--ok)' : 'var(--text-2)'}">${pg.ready}/${pg.total}</td>
        ${items.map(it => {
          if (it.kind === 'riyu') { const st = rc.total && rc.reviewed >= rc.total ? 'ready' : rc.submitted ? 'applying' : 'todo'; return `<td style="padding:5px 8px;text-align:center">${cell(st, rc.total ? `提交${rc.submitted}/${rc.total} 批复${rc.reviewed}` : '无志望校')}</td>`; }
          const r = rs.find(x => x.item_id === it.id) || {};
          return `<td style="padding:5px 8px;text-align:center">${cell(r.status || 'todo', matStatusText(r))}</td>`;
        }).join('')}</tr>`;
    }).join('')}</tbody>
  </table></div>`}`;
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
