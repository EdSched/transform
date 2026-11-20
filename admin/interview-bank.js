// ══════════════════════════════════
// interview-bank.js（admin）— 考学进度 →「📁 出愿材料准备」→「🎤 面试题库」
// 按专业维护面试题库（interview_banks 表）：标题 / 说明 / 面试稿标准 / 统一手册 / 章节与题目 / 一键批量导入 / 公开开关
// 依赖：shared/supabase.js、shared/riyu.js（riyuEsc / riyuMd）、shared/interview-bank.js、shared/interview-import.js、shared/constants.js
// ══════════════════════════════════
let ivba = { dom: '', major: '', bank: null, fromDb: false, dirty: false, list: {}, openCh: {}, openIt: {}, imp: null, tab: 'bank', res: [], resEdit: null };

async function renderInterviewBankAdmin() {
  const box = document.getElementById('mat_body'); if (!box) return;
  try {
    const rows = await sbAll('/rest/v1/interview_banks?select=major_key,published,title');
    ivba.list = {}; (rows || []).forEach(r => { ivba.list[r.major_key] = r; });
    ivba.res = await sbAll('/rest/v1/interview_resources?select=*&order=sort_order.asc').catch(() => []);
  } catch (e) { box.innerHTML = `<div style="font-size:12px;color:var(--danger);padding:16px">读取失败：${riyuEsc(e.message)}（如果提示表不存在，请先执行 seed/interview_bank.sql）</div>`; return; }
  ivbaRender();
}
function ivbaMajorOptions(dom) {
  if (!dom) return [];
  const ms = scopeMajorsIn(dom).map(k => ({ k, label: MAJORS[k] || k }));
  const gs = Object.keys(MAJOR_GROUPS).filter(g => groupDomain(g) === dom && !ms.some(m => m.k === g)).map(g => ({ k: g, label: groupLabel(g) + '（专业组）' }));
  return ms.concat(gs);
}
function ivbaMark(k) { const r = ivba.list[k]; return r ? (r.published ? '　· 已公开' : '　· 已建（未公开）') : ''; }
function ivbaPickDomain(d) {
  if (ivba.dirty && !confirm('当前修改还没有保存，切换后会丢失。继续？')) { ivbaRender(); return; }
  ivba.dom = d; ivba.major = ''; ivba.bank = null; ivba.dirty = false; ivbaRender();
}
async function ivbaPickMajor(k) {
  if (ivba.dirty && !confirm('当前修改还没有保存，切换后会丢失。继续？')) { ivbaRender(); return; }
  ivba.major = k; ivba.dirty = false; ivba.openCh = {}; ivba.openIt = {};
  if (!k) { ivba.bank = null; ivbaRender(); return; }
  const b = await ivbLoad(k, true);
  ivba.fromDb = !!b;
  ivba.bank = b ? JSON.parse(JSON.stringify(b)) : { major_key: k, title: (MAJORS[k] || groupLabel(k) || k) + ' · 面试稿', intro: '', standard: '', chapters: [], manual_files: [], ref_files: [], published: false };
  ivbaRender();
}
const IVBA_INP = 'width:100%;box-sizing:border-box;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit';
const ivbaLab = t => `<label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:2px">${t}</label>`;
function ivbaTouch() { ivba.dirty = true; const m = document.getElementById('ivba_msg'); if (m) m.textContent = '有未保存的修改'; }

function ivbaTabBar() {
  return `<div style="display:flex;gap:6px;margin-bottom:12px">${[['bank', '题库'], ['res', '📎 面试资料']].map(([k, l]) => `<div class="filter-chip${ivba.tab === k ? ' active' : ''}" onclick="ivbaSetTab('${k}')" style="font-size:12px;padding:3px 12px">${l}</div>`).join('')}</div>`;
}
function ivbaSetTab(k) {
  if (ivba.tab === 'bank' && ivba.dirty && !confirm('当前修改还没有保存，切换后会丢失。继续？')) return;
  if (ivba.tab === 'bank' && ivba.dirty) { ivba.dirty = false; ivba.bank = null; ivba.major = ''; }
  ivba.tab = k; ivbaRender();
}
function ivbaRender() {
  const box = document.getElementById('mat_body'); if (!box) return;
  if (ivba.tab === 'res') return ivbaResRender();
  const doms = scopeDomainList();
  const majors = ivbaMajorOptions(ivba.dom);
  const sel = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
    <span style="font-size:11px;color:var(--text-3)">先选领域，再选专业：</span>
    <select onchange="ivbaPickDomain(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit"><option value="">选择领域…</option>${doms.map(d => `<option value="${riyuEsc(d)}" ${ivba.dom === d ? 'selected' : ''}>${riyuEsc(d)}</option>`).join('')}</select>
    ${ivba.dom ? `<select onchange="ivbaPickMajor(this.value)" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit"><option value="">选择专业…</option>${majors.map(m => `<option value="${riyuEsc(m.k)}" ${ivba.major === m.k ? 'selected' : ''}>${riyuEsc(m.label + ivbaMark(m.k))}</option>`).join('')}</select>` : ''}
  </div>`;
  const b = ivba.bank;
  if (!b) { box.innerHTML = ivbaTabBar() + sel + '<div style="font-size:12px;color:var(--text-3);padding:20px 0">选好专业后，这里可以导入或编辑该专业的面试题库。学生只会看到「已公开」的题库。</div>'; return; }
  const n = ivbCount(b);
  box.innerHTML = ivbaTabBar() + sel + `
  ${ivba.fromDb ? '' : '<div style="font-size:11px;color:var(--warn,#b8860b);background:#fff8e6;border:1px solid #e8d4a0;border-radius:3px;padding:6px 10px;margin-bottom:10px">这个专业还没有题库。可以直接点「导入」批量导入手册，保存后才会正式写入（如果保存失败，请先执行 seed/interview_bank.sql 建表）。</div>'}
  <div style="border:1px solid var(--border);border-radius:4px;padding:12px 14px;background:var(--bg);margin-bottom:12px">
    <div style="display:grid;grid-template-columns:240px 1fr;gap:10px;margin-bottom:8px">
      <div>${ivbaLab('标题')}<input value="${riyuEsc(b.title)}" oninput="ivba.bank.title=this.value;ivbaTouch()" style="${IVBA_INP}"></div>
      <div>${ivbaLab('顶部说明（学生页最上方显示；可用 **粗体**、- 列表）')}<textarea rows="3" oninput="ivba.bank.intro=this.value;ivbaTouch()" style="${IVBA_INP};resize:vertical;line-height:1.7">${riyuEsc(b.intro)}</textarea></div>
    </div>
    ${ivbaLab('面试稿标准（长度、语言、必答范围等约束，学生页顶部显示）')}<textarea rows="3" oninput="ivba.bank.standard=this.value;ivbaTouch()" style="${IVBA_INP};resize:vertical;line-height:1.7">${riyuEsc(b.standard)}</textarea>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px">
      <span style="font-size:11px;color:var(--text-3)">公开状态：</span>
      <select onchange="ivba.bank.published=this.value==='1';ivbaTouch()" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--surface);font-family:inherit"><option value="0" ${b.published ? '' : 'selected'}>隐藏（学生看不到）</option><option value="1" ${b.published ? 'selected' : ''}>公开（该专业学生可见）</option></select>
      <span style="font-size:11px;color:var(--text-3)">共 ${n.chapters} 章 · ${n.items} 题（必答 ${n.required}）${n.hidden ? ` · 隐藏 ${n.hidden}` : ''}</span>
    </div>
  </div>
  <div style="border:1px solid var(--border);border-radius:4px;padding:10px 14px;background:var(--bg);margin-bottom:12px">
    ${ivbaLab('统一手册（PDF / Word，可以多个；学生页显示「面试手册 ⬇」）')}
    ${(b.manual_files || []).map((f, i) => `<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:3px"><a href="${riyuEsc(f.url)}" target="_blank" style="color:var(--accent)">${riyuEsc(f.name)}</a><span onclick="ivbaFileDel(${i})" style="cursor:pointer;color:var(--danger);font-size:11px">删除</span></div>`).join('') || '<div style="font-size:11px;color:var(--text-3);margin-bottom:4px">还没有手册</div>'}
    <div style="display:flex;align-items:center;gap:8px;margin-top:6px"><input type="file" id="ivba_file" accept=".pdf,.doc,.docx" multiple style="font-size:11px"><button class="btn btn-outline btn-sm" onclick="ivbaFileAdd()">上传</button><span id="ivba_fmsg" style="font-size:11px;color:var(--text-3)"></span></div>
  </div>
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
    <span style="font-size:12px;font-weight:600">章节与题目</span>
    <button class="btn btn-outline btn-sm" onclick="ivbaImportOpen()">导入（tex / md / docx / 粘贴）</button>
    <button class="btn btn-outline btn-sm" onclick="ivbaChAdd()">＋ 添加章</button>
  </div>
  <div id="ivba_chapters">${ivbaChaptersHtml()}</div>
  <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
    <button class="btn btn-primary btn-sm" id="ivba_save" onclick="ivbaSave()" style="margin-left:auto">保存</button>
    <span id="ivba_msg" style="font-size:11px;color:var(--ok)"></span>
  </div>
  <div id="ivba_modal"></div>`;
}
function ivbCount(b) {
  let items = 0, required = 0, hidden = 0;
  (b.chapters || []).forEach(c => (c.items || []).forEach(i => { if (i.hidden) { hidden++; return; } items++; if (i.required !== false && !(i.keywords && i.keywords.length) && c.type !== 'keywords') required++; }));
  return { chapters: (b.chapters || []).length, items, required, hidden };
}

// ── 章节 / 题目编辑（默认全收起）──
function ivbaChaptersHtml() {
  const cs = ivba.bank.chapters;
  if (!cs.length) return '<div style="font-size:12px;color:var(--text-3);padding:14px 0">还没有章节。点「导入」或「＋ 添加章」。</div>';
  return cs.map((c, ci) => {
    const open = !!ivba.openCh[c.key], vis = (c.items || []).filter(i => !i.hidden).length;
    return `<div style="border:1px solid var(--border-light);border-radius:4px;margin-bottom:6px;background:var(--surface)">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer" onclick="ivbaToggleCh('${c.key}')">
        <span style="font-size:11px;color:var(--text-3)">${open ? '▾' : '▸'}</span>
        <span style="font-size:12px;font-weight:600">${riyuEsc(c.title || '（未命名章）')}</span>
        <span style="font-size:10px;color:var(--text-3)">${vis} 题 · ${c.scope === 'school' ? '各校分别作答' : '共用'} · ${c.type === 'keywords' ? '关键词' : c.type === 'ask' ? '逆质问' : '问答'}</span>
        <span style="margin-left:auto;display:flex;gap:4px" onclick="event.stopPropagation()">
          <button class="btn btn-outline btn-sm" ${ci === 0 ? 'disabled' : ''} onclick="ivbaChMove(${ci},-1)">↑</button>
          <button class="btn btn-outline btn-sm" ${ci === cs.length - 1 ? 'disabled' : ''} onclick="ivbaChMove(${ci},1)">↓</button>
          <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="ivbaChDel(${ci})">删除</button></span>
      </div>
      ${open ? `<div style="padding:4px 12px 12px;border-top:1px solid var(--border-light)">
        <div style="display:grid;grid-template-columns:1fr 150px 120px;gap:8px;margin:8px 0">
          <div>${ivbaLab('章标题')}<input value="${riyuEsc(c.title)}" oninput="ivba.bank.chapters[${ci}].title=this.value;ivbaTouch()" style="${IVBA_INP}"></div>
          <div>${ivbaLab('作答范围')}<select onchange="ivba.bank.chapters[${ci}].scope=this.value;ivbaTouch()" style="${IVBA_INP}"><option value="common" ${c.scope !== 'school' ? 'selected' : ''}>共用（答一次）</option><option value="school" ${c.scope === 'school' ? 'selected' : ''}>各校分别作答</option></select></div>
          <div>${ivbaLab('类型')}<select onchange="ivba.bank.chapters[${ci}].type=this.value;ivbaTouch()" style="${IVBA_INP}"><option value="qa" ${c.type === 'qa' ? 'selected' : ''}>问答</option><option value="ask" ${c.type === 'ask' ? 'selected' : ''}>逆质问</option><option value="keywords" ${c.type === 'keywords' ? 'selected' : ''}>关键词</option></select></div>
        </div>
        ${ivbaLab('章说明（学生看到）')}<textarea rows="2" oninput="ivba.bank.chapters[${ci}].intro=this.value;ivbaTouch()" style="${IVBA_INP};resize:vertical;line-height:1.7;margin-bottom:8px">${riyuEsc(c.intro || '')}</textarea>
        ${(c.items || []).map((it, ii) => ivbaItemHtml(c, ci, it, ii)).join('')}
        <button class="btn btn-outline btn-sm" onclick="ivbaItAdd(${ci})">＋ 添加题</button>
      </div>` : ''}
    </div>`;
  }).join('');
}
function ivbaItemHtml(c, ci, it, ii) {
  const open = !!ivba.openIt[it.key], n = c.items.length;
  return `<div style="border:1px solid var(--border-light);border-radius:3px;margin-bottom:5px;background:${it.hidden ? '#f4f1ea' : 'var(--bg)'}">
    <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer" onclick="ivbaToggleIt('${it.key}')">
      <span style="font-size:11px;color:var(--text-3)">${open ? '▾' : '▸'}</span>
      <span style="font-size:12px;${it.hidden ? 'color:var(--text-3);text-decoration:line-through' : ''}">${riyuEsc(it.q || '（空题面）')}</span>
      ${it.gone ? '<span style="font-size:10px;color:#b03a2e;border:1px solid #e8b8b0;border-radius:2px;padding:0 5px">新手册中已不存在</span>' : ''}
      ${it.required === false ? '<span style="font-size:10px;color:var(--text-3)">选答</span>' : ''}${it.keywords && it.keywords.length ? `<span style="font-size:10px;color:var(--text-3)">关键词 ${it.keywords.length}</span>` : ''}
      ${!it.tips && !it.example && !(it.keywords || []).length ? '<span style="font-size:10px;color:#a0621a">待补充</span>' : ''}
      <span style="margin-left:auto;display:flex;gap:4px" onclick="event.stopPropagation()">
        <button class="btn btn-outline btn-sm" ${ii === 0 ? 'disabled' : ''} onclick="ivbaItMove(${ci},${ii},-1)">↑</button>
        <button class="btn btn-outline btn-sm" ${ii === n - 1 ? 'disabled' : ''} onclick="ivbaItMove(${ci},${ii},1)">↓</button></span>
    </div>
    ${open ? `<div style="padding:4px 10px 10px">
      ${ivbaLab('题面（日文原样，不要改写）')}<input value="${riyuEsc(it.q)}" oninput="ivba.bank.chapters[${ci}].items[${ii}].q=this.value;ivbaTouch()" style="${IVBA_INP};margin-bottom:6px">
      ${ivbaLab('老师指导（中文，可用 **粗体**、- 列表）')}<textarea rows="3" oninput="ivba.bank.chapters[${ci}].items[${ii}].tips=this.value;ivbaTouch()" style="${IVBA_INP};resize:vertical;line-height:1.7;margin-bottom:6px">${riyuEsc(it.tips || '')}</textarea>
      ${ivbaLab('参考例（日文；学生默认折叠）')}<textarea rows="3" oninput="ivba.bank.chapters[${ci}].items[${ii}].example=this.value;ivbaTouch()" style="${IVBA_INP};resize:vertical;line-height:1.7;margin-bottom:6px">${riyuEsc(it.example || '')}</textarea>
      ${ivbaLab('关键词（每行一个；有关键词的题是只读词表，不要求作答）')}<textarea rows="2" oninput="ivba.bank.chapters[${ci}].items[${ii}].keywords=this.value.split('\\n').map(x=>x.trim()).filter(Boolean);ivbaTouch()" style="${IVBA_INP};resize:vertical;margin-bottom:6px">${riyuEsc((it.keywords || []).join('\n'))}</textarea>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select onchange="ivba.bank.chapters[${ci}].items[${ii}].required=this.value==='1';ivbaTouch()" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--surface);font-family:inherit"><option value="1" ${it.required !== false ? 'selected' : ''}>必答</option><option value="0" ${it.required === false ? 'selected' : ''}>选答</option></select>
        <input value="${riyuEsc((it.tags || []).join(','))}" placeholder="标签（逗号分隔，可选）" oninput="ivba.bank.chapters[${ci}].items[${ii}].tags=this.value.split(',').map(x=>x.trim()).filter(Boolean);ivbaTouch()" style="${IVBA_INP};width:200px">
        <select onchange="ivbaItHide(${ci},${ii},this.value==='1')" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--surface);font-family:inherit"><option value="0" ${it.hidden ? '' : 'selected'}>学生可见</option><option value="1" ${it.hidden ? 'selected' : ''}>隐藏（答案保留）</option></select>
        <button class="btn btn-sm" style="margin-left:auto;color:var(--danger);border:1px solid var(--danger);background:none" onclick="ivbaItDel(${ci},${ii})">删除</button>
      </div></div>` : ''}
  </div>`;
}
function ivbaRefreshChapters() { const el = document.getElementById('ivba_chapters'); if (el) el.innerHTML = ivbaChaptersHtml(); }
function ivbaToggleCh(k) { ivba.openCh[k] = !ivba.openCh[k]; ivbaRefreshChapters(); }
function ivbaToggleIt(k) { ivba.openIt[k] = !ivba.openIt[k]; ivbaRefreshChapters(); }
function ivbaChMove(i, d) { const a = ivba.bank.chapters, j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; ivbaTouch(); ivbaRefreshChapters(); }
function ivbaChDel(i) {
  const c = ivba.bank.chapters[i];
  if (!confirm(`删除章「${c.title}」及其 ${c.items.length} 道题？\n学生已经写的答案不会被删除，但题目不再显示；如果只是想暂时不给学生看，请把题设为「隐藏」。`)) return;
  ivba.bank.chapters.splice(i, 1); ivbaTouch(); ivbaRefreshChapters();
}
function ivbaChAdd() {
  const cs = ivba.bank.chapters; let n = cs.length + 1, k; while (cs.some(c => c.key === (k = 'c' + String(n).padStart(2, '0')))) n++;
  cs.push({ key: k, title: '新章', intro: '', scope: 'common', type: 'qa', items: [] }); ivba.openCh[k] = true; ivbaTouch(); ivbaRefreshChapters();
}
function ivbaItAdd(ci) {
  const c = ivba.bank.chapters[ci];
  const it = { key: 'q_' + iviHash(c.title + '|' + Date.now() + Math.random()).slice(0, 6), q: '', tips: '', example: '', required: true, tags: [], manual: true };
  c.items.push(it); ivba.openIt[it.key] = true; ivbaTouch(); ivbaRefreshChapters();
}
function ivbaItMove(ci, i, d) { const a = ivba.bank.chapters[ci].items, j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; ivbaTouch(); ivbaRefreshChapters(); }
function ivbaItHide(ci, i, h) { const it = ivba.bank.chapters[ci].items[i]; if (h) it.hidden = true; else { delete it.hidden; delete it.gone; } ivbaTouch(); ivbaRefreshChapters(); }
function ivbaItDel(ci, i) {
  const it = ivba.bank.chapters[ci].items[i];
  if (!confirm(`删除题「${it.q}」？\n学生已经写的答案不会被删除，只是不再显示。想保留就改成「隐藏」。`)) return;
  ivba.bank.chapters[ci].items.splice(i, 1); ivbaTouch(); ivbaRefreshChapters();
}

// ── 统一手册 ──
async function ivbaFileAdd() {
  const files = [...(document.getElementById('ivba_file')?.files || [])], msg = document.getElementById('ivba_fmsg');
  if (!files.length) { if (msg) msg.textContent = '请先选择文件'; return; }
  const bad = files.find(f => !['pdf', 'doc', 'docx'].includes((f.name.split('.').pop() || '').toLowerCase()));
  if (bad) { if (msg) msg.textContent = '只能上传 PDF / Word：' + bad.name; return; }
  ivba.bank.manual_files = ivba.bank.manual_files || [];
  try {
    for (let i = 0; i < files.length; i++) {
      if (msg) msg.textContent = `上传中 ${i + 1} / ${files.length}…`;
      const f = files[i], ext = f.name.split('.').pop().toLowerCase();
      const url = await sbUpload('teacher-files', `interview/${ivba.major.replace(/[^A-Za-z0-9_]/g, '')}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`, f);
      ivba.bank.manual_files.push({ name: f.name, url });
    }
    ivbaTouch(); ivbaRender();
    const m2 = document.getElementById('ivba_fmsg'); if (m2) m2.textContent = '已上传，记得点下面的「保存」';
  } catch (e) { if (msg) msg.textContent = '上传失败：' + e.message; }
}
function ivbaFileDel(i) {
  const f = (ivba.bank.manual_files || [])[i]; if (!f) return;
  if (!confirm(`从面试手册里移除「${f.name}」？（只是不再显示，文件不会被删除）`)) return;
  ivba.bank.manual_files.splice(i, 1); ivbaTouch(); ivbaRender();
}

// ── 保存（整库一次 upsert）──
async function ivbaSave() {
  const b = ivba.bank; if (!b) return;
  if (b.chapters.some(c => !String(c.title || '').trim())) { alert('每一章都要有标题'); return; }
  const row = { major_key: ivba.major, title: (b.title || '').trim() || '面试稿', intro: b.intro || '', standard: b.standard || '', chapters: b.chapters, manual_files: b.manual_files || [], ref_files: b.ref_files || [], published: !!b.published, updated_at: new Date().toISOString() };
  const btn = document.getElementById('ivba_save'); if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    const tok = (typeof __getSbToken === 'function') ? __getSbToken() : null;
    const r = await fetch(`${SB_URL}/rest/v1/interview_banks?on_conflict=major_key`, { method: 'POST', headers: {
      'apikey': SB_KEY, 'Authorization': 'Bearer ' + (tok || SB_KEY), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify([row]) });
    if (!r.ok) throw new Error(await r.text());
    const saved = (await r.json())[0];
    if (!saved) throw new Error('没有写入成功（请确认已执行建表 SQL，且当前账号有权限）');
    ivbCache[ivba.major] = ivbNorm(saved);
    ivba.list[ivba.major] = { major_key: ivba.major, published: !!saved.published, title: saved.title };
    ivbaMarkPublished(ivba.major, !!saved.published);
    ivba.fromDb = true; ivba.dirty = false;
    ivbaRender();
    const msg = document.getElementById('ivba_msg'); const t = saved.published ? '✓ 已保存并公开：该专业学生在「计划书」里可以看到「面试准备」' : '✓ 已保存（当前是隐藏状态，学生看不到）';
    if (msg) { msg.textContent = t; setTimeout(() => { if (msg.textContent === t) msg.textContent = ''; }, 6000); }
  } catch (e) { alert('保存失败：' + e.message); if (btn) { btn.disabled = false; btn.textContent = '保存'; } }
}
function ivbaMarkPublished(k, pub) {   // 同步 shared/interview-bank.js 里的「已公开专业」列表
  ivbPublishedKeys = ivbPublishedKeys || [];
  const i = ivbPublishedKeys.indexOf(k);
  if (pub && i < 0) ivbPublishedKeys.push(k); else if (!pub && i >= 0) ivbPublishedKeys.splice(i, 1);
}

// ══ 批量导入 ══
function ivbaImportOpen() {
  ivba.imp = { chapters: null, mode: ivba.bank.chapters.length ? 'merge' : 'new', text: '', err: '' };
  ivbaImpRender();
}
function ivbaImpClose() { ivba.imp = null; const m = document.getElementById('ivba_modal'); if (m) m.innerHTML = ''; }
function ivbaImpRender() {
  const m = document.getElementById('ivba_modal'); if (!m || !ivba.imp) return;
  const im = ivba.imp, cs = im.chapters;
  const cnt = cs ? iviCount(cs) : null;
  m.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)ivbaImpClose()">
    <div style="background:var(--surface,#fff);border-radius:6px;max-width:900px;width:100%;max-height:92vh;overflow:auto;padding:16px 18px">
      <div style="display:flex;align-items:center;margin-bottom:8px"><b style="font-size:14px">导入面试题库 · ${riyuEsc(MAJORS[ivba.major] || groupLabel(ivba.major) || ivba.major)}</b><span style="margin-left:auto;cursor:pointer;font-size:18px" onclick="ivbaImpClose()">×</span></div>
      <div style="font-size:11px;color:var(--text-3);line-height:1.8;margin-bottom:8px">支持 .tex / .md / .docx，或直接粘贴文本。<b>PDF 在浏览器里解析不可靠，不支持</b>——手里是 PDF 的话，请先转成 Word（.docx）或 md 再导入。先预览、确认无误再导入。</div>
      <details style="font-size:11px;color:var(--text-2);margin-bottom:8px"><summary style="cursor:pointer">格式说明（md 约定）</summary>
        <pre style="white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:3px;line-height:1.7"># 章标题            （tex：\\chapter{}）
## 题面             （tex：\\section{}）
> 指导：中文指导     （没写前缀时：假名少的段落当指导，日文段落当参考例）
例：日文参考答案
### 小标题          （题内小标题；短标题（≤8 字）且题下只有小标题时拆成独立题）
| 概念 | 概念 |      （表格 → 关键词，只读）
- 逆質問原文         （「逆質問」章里的列表：每条一题）</pre></details>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <input type="file" id="ivba_imp_file" accept=".tex,.md,.txt,.docx" style="font-size:11px" onchange="ivbaImpFile(this)">
        <span style="font-size:11px;color:var(--text-3)">或粘贴：</span></div>
      <textarea id="ivba_imp_text" rows="4" placeholder="把 tex / md 内容贴在这里" style="${IVBA_INP};resize:vertical;margin-bottom:6px">${riyuEsc(im.text)}</textarea>
      <button class="btn btn-outline btn-sm" onclick="ivbaImpParse()">解析并预览</button>
      ${im.err ? `<span style="font-size:11px;color:var(--danger);margin-left:8px">${riyuEsc(im.err)}</span>` : ''}
      ${cs ? `<div style="margin-top:12px;font-size:12px;font-weight:600">预览：${cnt.chapters} 章 · ${cnt.items} 题 · 关键词 ${cnt.keywords}</div>
        <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">每题可改题面、点「指导⇄参考例」互换归类、删除；章的作答范围可改。</div>
        <div style="max-height:46vh;overflow:auto;border:1px solid var(--border-light);border-radius:4px;padding:6px 10px">${cs.map((c, ci) => ivbaImpChapterHtml(c, ci)).join('')}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px">
          <select onchange="ivba.imp.mode=this.value" style="font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit"><option value="merge" ${im.mode === 'merge' ? 'selected' : ''}>合并到现有题库（学生答案不动）</option><option value="new" ${im.mode === 'new' ? 'selected' : ''}>新建（用导入内容替换现有章节）</option></select>
          <button class="btn btn-primary btn-sm" onclick="ivbaImpApply()" style="margin-left:auto">导入</button></div>` : ''}
    </div></div>`;
}
function ivbaImpChapterHtml(c, ci) {
  return `<details ${ci === 0 ? 'open' : ''} style="margin:4px 0"><summary style="cursor:pointer;font-size:12px;font-weight:600">${riyuEsc(c.title)} <span style="font-weight:400;color:var(--text-3)">${c.items.length} 题 · ${c.type === 'ask' ? '逆质问' : c.type === 'keywords' ? '关键词' : '问答'}</span></summary>
    <div style="padding-left:12px">
      <div style="font-size:11px;margin:4px 0">作答范围 <select onchange="ivba.imp.chapters[${ci}].scope=this.value" style="font-size:11px;padding:2px 6px;border:1px solid var(--border);border-radius:3px"><option value="common" ${c.scope !== 'school' ? 'selected' : ''}>共用</option><option value="school" ${c.scope === 'school' ? 'selected' : ''}>各校分别作答</option></select>
        ${c.intro ? `<div style="color:var(--text-3);margin-top:3px;white-space:pre-wrap">章说明：${riyuEsc(c.intro.slice(0, 160))}${c.intro.length > 160 ? '…' : ''}</div>` : ''}</div>
      ${c.items.map((it, ii) => `<div style="border-top:1px dashed var(--border-light);padding:5px 0;font-size:11px">
        <div style="display:flex;gap:6px;align-items:center"><input value="${riyuEsc(it.q)}" oninput="ivba.imp.chapters[${ci}].items[${ii}].q=this.value" style="${IVBA_INP};flex:1">
          <button class="btn btn-outline btn-sm" onclick="ivbaImpSwap(${ci},${ii})">指导⇄参考例</button>
          <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="ivbaImpDel(${ci},${ii})">删</button></div>
        ${it.tips ? `<div style="margin-top:3px"><span style="color:#8a6a1b">指导</span> ${riyuEsc(it.tips.slice(0, 120))}${it.tips.length > 120 ? '…' : ''}</div>` : ''}
        ${it.example ? `<div style="margin-top:2px"><span style="color:#2c4a7c">参考例</span> ${riyuEsc(it.example.slice(0, 120))}${it.example.length > 120 ? '…' : ''}</div>` : ''}
        ${(it.keywords || []).length ? `<div style="margin-top:2px;color:var(--text-3)">关键词 ${it.keywords.length} 个：${riyuEsc(it.keywords.slice(0, 8).join('、'))}…</div>` : ''}
        ${!it.tips && !it.example && !(it.keywords || []).length ? '<div style="margin-top:2px;color:#a0621a">内容为空（之后补）</div>' : ''}</div>`).join('')}
    </div></details>`;
}
function ivbaImpSwap(ci, ii) { const it = ivba.imp.chapters[ci].items[ii]; const t = it.tips; it.tips = it.example; it.example = t; ivbaImpRender(); }
function ivbaImpDel(ci, ii) { ivba.imp.chapters[ci].items.splice(ii, 1); ivbaImpRender(); }
async function ivbaImpFile(inp) {
  const f = inp.files && inp.files[0]; if (!f) return;
  try {
    if (/\.docx$/i.test(f.name)) {
      if (typeof mammoth === 'undefined') await new Promise((ok, no) => { const s = document.createElement('script'); s.src = '../shared/vendor/mammoth.browser.min.js'; s.onload = ok; s.onerror = () => no(new Error('读取 Word 组件失败')); document.head.appendChild(s); });
      const r = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
      ivba.imp.text = iviHtmlToMd(r.value);
    } else ivba.imp.text = await f.text();
    ivba.imp.err = ''; ivbaImpParse();
  } catch (e) { ivba.imp.err = '读取失败：' + e.message; ivbaImpRender(); }
}
function ivbaImpParse() {
  const ta = document.getElementById('ivba_imp_text'); if (ta && ta.value.trim()) ivba.imp.text = ta.value;
  try {
    const cs = iviParse(ivba.imp.text);
    if (!cs.length) { ivba.imp.err = '没有识别出章节：tex 需要 \\chapter / \\section，md 需要 # / ##'; ivba.imp.chapters = null; }
    else { ivba.imp.chapters = cs; ivba.imp.err = ''; }
  } catch (e) { ivba.imp.err = '解析失败：' + e.message; ivba.imp.chapters = null; }
  ivbaImpRender();
}
function ivbaImpApply() {
  const im = ivba.imp; if (!im || !im.chapters) return;
  if (im.mode === 'new' && ivba.bank.chapters.length && !confirm('「新建」会用导入内容替换现有章节（学生已写的答案不会删，但题 key 不同的题将不再显示）。继续？')) return;
  let msg;
  if (im.mode === 'merge') { const r = iviMerge(ivba.bank.chapters, im.chapters); ivba.bank.chapters = r.chapters; msg = `合并完成：新增 ${r.stat.itemsNew} 题、更新 ${r.stat.itemsUpdated} 题、${r.stat.itemsGone} 题标为「新手册中已不存在」并隐藏`; }
  else { ivba.bank.chapters = im.chapters; const c = iviCount(im.chapters); msg = `已导入 ${c.chapters} 章 ${c.items} 题`; }
  ivba.openCh = {}; ivba.openIt = {}; ivbaImpClose(); ivbaTouch(); ivbaRender();
  const m = document.getElementById('ivba_msg'); if (m) m.textContent = msg + '。检查后点「保存」才会写入。';
}

// ══ 📎 面试资料（interview_resources）：マナー / 临机应对 / 态度 / 其他 ══
const IVBA_CATS = IVB_RES_CATS;
function ivbaResMajorOpts(cur) {
  const ks = (typeof allMajorKeys === 'function' ? allMajorKeys() : Object.keys(MAJORS));
  const opts = ks.map(k => ({ k, l: MAJORS[k] || k })).concat(Object.keys(MAJOR_GROUPS).filter(g => !ks.includes(g)).map(g => ({ k: g, l: groupLabel(g) + '（专业组）' })));
  return `<option value="">通用（所有专业）</option>` + opts.map(o => `<option value="${riyuEsc(o.k)}" ${cur === o.k ? 'selected' : ''}>${riyuEsc(o.l)}</option>`).join('');
}
function ivbaResRender() {
  const box = document.getElementById('mat_body'); if (!box) return;
  const e = ivba.resEdit;
  box.innerHTML = ivbaTabBar() + `<div style="font-size:11px;color:var(--text-3);margin-bottom:10px">学生在「面试准备」里按分类看到这些资料（通用 + 本专业的）；没有内容的分类学生端不显示。</div>
  ${IVBA_CATS.map(([ck, cl]) => {
    const list = ivba.res.filter(r => r.category === ck).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return `<div style="margin-bottom:12px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:5px"><span style="font-size:12px;font-weight:600">${cl}（${list.length}）</span><button class="btn btn-outline btn-sm" onclick="ivbaResNew('${ck}')">＋ 新增</button></div>
      ${list.map((r, i) => `<div style="border:1px solid var(--border-light);border-radius:4px;padding:6px 10px;margin-bottom:4px;background:${r.published ? 'var(--surface)' : '#f4f1ea'};display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600;cursor:pointer" onclick="ivbaResOpen('${riyuEsc(r.id)}')">${riyuEsc(r.title)}</span>
        <span style="font-size:10px;color:var(--text-3)">${r.major_key ? riyuEsc(MAJORS[r.major_key] || groupLabel(r.major_key)) : '通用'} · ${r.published ? '已公开' : '隐藏'}${(r.files || []).length ? ` · 文件 ${(r.files || []).length}` : ''}</span>
        <span style="margin-left:auto;display:flex;gap:4px">
          <button class="btn btn-outline btn-sm" ${i === 0 ? 'disabled' : ''} onclick="ivbaResMove('${riyuEsc(r.id)}',-1)">↑</button>
          <button class="btn btn-outline btn-sm" ${i === list.length - 1 ? 'disabled' : ''} onclick="ivbaResMove('${riyuEsc(r.id)}',1)">↓</button>
          <button class="btn btn-outline btn-sm" onclick="ivbaResPub('${riyuEsc(r.id)}')">${r.published ? '设为隐藏' : '公开'}</button>
          <button class="btn btn-outline btn-sm" onclick="ivbaResOpen('${riyuEsc(r.id)}')">编辑</button></span></div>`).join('') || '<div style="font-size:11px;color:var(--text-3);padding:2px 0 4px">还没有内容</div>'}</div>`;
  }).join('')}
  ${e ? `<div style="border:1px solid var(--accent);border-radius:4px;padding:12px 14px;background:var(--bg);margin-top:8px">
    <div style="font-size:12px;font-weight:600;margin-bottom:8px">${e._new ? '新增资料' : '编辑资料'}</div>
    <div style="display:grid;grid-template-columns:1fr 150px 170px;gap:8px;margin-bottom:8px">
      <div>${ivbaLab('标题')}<input value="${riyuEsc(e.title)}" oninput="ivba.resEdit.title=this.value" style="${IVBA_INP}"></div>
      <div>${ivbaLab('分类')}<select onchange="ivba.resEdit.category=this.value" style="${IVBA_INP}">${IVBA_CATS.map(([k, l]) => `<option value="${k}" ${e.category === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div>${ivbaLab('适用专业')}<select onchange="ivba.resEdit.major_key=this.value||null" style="${IVBA_INP}">${ivbaResMajorOpts(e.major_key)}</select></div></div>
    ${ivbaLab('正文（可用 **粗体**、- 列表）')}<textarea rows="8" oninput="ivba.resEdit.body=this.value" style="${IVBA_INP};resize:vertical;line-height:1.7;margin-bottom:8px">${riyuEsc(e.body || '')}</textarea>
    ${ivbaLab('文件（PDF / 图片，可多个）')}
    ${(e.files || []).map((f, i) => `<div style="display:flex;gap:8px;font-size:12px;margin-bottom:3px"><a href="${riyuEsc(f.url)}" target="_blank" style="color:var(--accent)">${riyuEsc(f.name)}</a><span onclick="ivbaResFileDel(${i})" style="cursor:pointer;color:var(--danger);font-size:11px">移除</span></div>`).join('')}
    <div style="display:flex;align-items:center;gap:8px;margin:4px 0 8px"><input type="file" id="ivba_res_file" accept=".pdf,.png,.jpg,.jpeg" multiple style="font-size:11px"><button class="btn btn-outline btn-sm" onclick="ivbaResFileAdd()">上传</button><span id="ivba_res_fmsg" style="font-size:11px;color:var(--text-3)"></span></div>
    <div style="display:flex;gap:8px;align-items:center"><select onchange="ivba.resEdit.published=this.value==='1'" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--surface);font-family:inherit"><option value="1" ${e.published !== false ? 'selected' : ''}>公开</option><option value="0" ${e.published === false ? 'selected' : ''}>隐藏</option></select>
      <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none;${e._new ? 'display:none' : ''}" onclick="ivbaResDel()">删除</button>
      <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="ivba.resEdit=null;ivbaResRender()">取消</button><button class="btn btn-primary btn-sm" onclick="ivbaResSave()">保存</button><span id="ivba_res_msg" style="font-size:11px;color:var(--ok)"></span></div>
  </div>` : ''}`;
}
function ivbaResNew(cat) {
  const mx = ivba.res.filter(r => r.category === cat).reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
  ivba.resEdit = { _new: true, id: 'ivr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), major_key: null, category: cat, title: '', body: '', files: [], sort_order: mx + 1, published: true };
  ivbaResRender();
}
function ivbaResOpen(id) { const r = ivba.res.find(x => x.id === id); if (!r) return; ivba.resEdit = JSON.parse(JSON.stringify(Object.assign({}, r, { files: r.files || [] }))); ivbaResRender(); }
async function ivbaResSave() {
  const e = ivba.resEdit; if (!e) return;
  if (!String(e.title || '').trim()) { alert('请填写标题'); return; }
  const row = { id: e.id, major_key: e.major_key || null, category: e.category, title: e.title.trim(), body: e.body || '', files: e.files || [], sort_order: e.sort_order || 0, published: e.published !== false, updated_at: new Date().toISOString() };
  try {
    if (e._new) await sb('/rest/v1/interview_resources', 'POST', row);
    else await sb(`/rest/v1/interview_resources?id=eq.${encodeURIComponent(e.id)}`, 'PATCH', row);
    const i = ivba.res.findIndex(x => x.id === e.id); if (i >= 0) ivba.res[i] = row; else ivba.res.push(row);
    ivba.resEdit = null; ivbaResRender();
  } catch (err) { alert('保存失败：' + err.message + '（如果提示表不存在，请先执行 seed/interview_resources.sql）'); }
}
async function ivbaResDel() {
  const e = ivba.resEdit; if (!e || e._new) return;
  if (!confirm(`删除「${e.title}」？（文件本身不会被删除）`)) return;
  try { await sb(`/rest/v1/interview_resources?id=eq.${encodeURIComponent(e.id)}`, 'DELETE'); ivba.res = ivba.res.filter(x => x.id !== e.id); ivba.resEdit = null; ivbaResRender(); }
  catch (err) { alert('删除失败：' + err.message); }
}
async function ivbaResPub(id) {
  const r = ivba.res.find(x => x.id === id); if (!r) return;
  try { await sb(`/rest/v1/interview_resources?id=eq.${encodeURIComponent(id)}`, 'PATCH', { published: !r.published }); r.published = !r.published; ivbaResRender(); }
  catch (err) { alert('保存失败：' + err.message); }
}
async function ivbaResMove(id, d) {
  const r = ivba.res.find(x => x.id === id); if (!r) return;
  const list = ivba.res.filter(x => x.category === r.category).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const i = list.indexOf(r), j = i + d; if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  try {
    for (let k = 0; k < list.length; k++) if (list[k].sort_order !== k + 1) { await sb(`/rest/v1/interview_resources?id=eq.${encodeURIComponent(list[k].id)}`, 'PATCH', { sort_order: k + 1 }); list[k].sort_order = k + 1; }
  } catch (err) { alert('排序保存失败：' + err.message); }
  ivbaResRender();
}
async function ivbaResFileAdd() {
  const files = [...(document.getElementById('ivba_res_file')?.files || [])], msg = document.getElementById('ivba_res_fmsg'), e = ivba.resEdit;
  if (!files.length || !e) { if (msg) msg.textContent = '请先选择文件'; return; }
  try {
    for (let i = 0; i < files.length; i++) {
      if (msg) msg.textContent = `上传中 ${i + 1} / ${files.length}…`;
      const f = files[i], ext = (f.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');
      const url = await sbUpload('teacher-files', `interview/resources/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`, f);
      e.files.push({ name: f.name, url });
    }
    ivbaResRender();
    const m2 = document.getElementById('ivba_res_fmsg'); if (m2) m2.textContent = '已上传，记得点「保存」';
  } catch (err) { if (msg) msg.textContent = '上传失败：' + err.message; }
}
function ivbaResFileDel(i) { if (ivba.resEdit) { ivba.resEdit.files.splice(i, 1); ivbaResRender(); } }
