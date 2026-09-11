// ══════════════════════════════════
// promo.js — 宣传管理（admin）
// 按专业维护三类宣传内容：专业介绍 / 讲师介绍 / 课程介绍
// 表 promo_content：id, major, section(major_intro|lecturer|course), title, body, sort_order, created_at
// 课程介绍的标题与课程安排中的课程名一致时，老师端可自动关联当期课程安排
// 依赖：shared/constants.js、shared/supabase.js、admin.js（须在其后加载）
// ══════════════════════════════════
let promoMajor = 'shakai';
let promoTplMode = false; // 专业介绍模板填写模式

// 专业介绍模板的6个字段（含浅色示例，供参考填写）
const PROMO_TPL_FIELDS = [
  ['gaiyou', '概要', '例：社会学是研究人类社会结构、社会关系与社会变迁的学科，涵盖家庭、教育、媒体、城市、阶层等广泛领域。'],
  ['shiten', '独特视角', '例：本专业强调用批判性、实证性的眼光审视习以为常的社会现象，培养透过现象看本质的分析力。'],
  ['yuushi', '优势', '例：\n- 师资来自一桥、东大等顶尖研究科\n- 小班教学，计划书一对一指导\n- 历年合格率高'],
  ['houkou', '重点方向', '例：城市社会学 / 家庭社会学 / 媒介与传播 / 社会阶层与流动'],
  ['kadai', '研究课题例', '例：\n- 都市青年的居住选择与社会网络\n- 社交媒体对青少年自我认同的影响'],
  ['juuten', '重点研究科', '例：一桥大学社会学研究科、东京大学人文社会系研究科、早稻田大学文学研究科'],
];
// 从已有 body（模板拼成的 markdown）反解出各字段值，供编辑回填
function promoParseTpl(body){
  const vals={}; const b=String(body||'');
  PROMO_TPL_FIELDS.forEach((f,i)=>{
    const label=f[1];
    // 匹配 "## 标签\n内容...（到下一个 ## 或结尾）"
    const re=new RegExp('##\\s*'+label+'\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)');
    const m=b.match(re);
    vals[f[0]]=m?m[1].trim():'';
  });
  return vals;
}
// 6字段填写表单
function promoTemplateFields(editing){
  const vals=promoParseTpl(editing.body);
  return `<div style="display:flex;flex-direction:column;gap:8px" id="promo_tpl_wrap">
    ${PROMO_TPL_FIELDS.map(f=>`<div>
      <label style="font-size:10px;color:var(--accent,#8b5cf6);font-weight:600;display:block;margin-bottom:3px">${f[1]}</label>
      <textarea id="tpl_${f[0]}" rows="3" style="width:100%;font-size:12px;line-height:1.7;padding:8px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit;resize:vertical" placeholder="${promoEsc(f[2]||('填写「'+f[1]+'」的内容'))}">${promoEsc(vals[f[0]]||'')}</textarea>
    </div>`).join('')}
    <div style="font-size:9px;color:var(--text-3)">填完保存，系统会自动拼成带排版的介绍页。每个字段内可用 <code>- 列表</code>、<code>**粗体**</code>、表格。</div>
  </div>`;
}
// 把6字段拼成 markdown（供保存）
function promoTplToMarkdown(){
  return PROMO_TPL_FIELDS.map(f=>{
    const v=(document.getElementById('tpl_'+f[0])||{}).value||'';
    if(!v.trim()) return '';
    return '## '+f[1]+'\n'+v.trim();
  }).filter(Boolean).join('\n\n');
}
let promoSection = 'major_intro';
let promoList = [];
let promoEditingId = null; // null=不在编辑 | 'new'=新增 | id=编辑该条
let promoProfiles = null;  // 讲师档案缓存（讲师板块「从档案导入」用）
let promoPubMap = {};      // 本名 → 对外宣传姓名（老师管理备注）

const PROMO_SECTIONS = [
  ['major_intro', '📖 专业介绍', '概要 / 独特视角 / 优势 / 重点方向 / 研究课题例 / 重点研究科…每条一个小节'],
  ['lecturer', '👤 讲师介绍', '每位讲师一条：标题填「姓名＋头衔」（如 徐老师　一桥大学社会学研究科　博士），正文填介绍'],
  ['course', '📚 课程介绍', '每门课一条：标题需与课程安排中的课程名完全一致，老师端才能自动关联当期开课信息'],
];

async function renderPromoAdminPage(mc) {
  // 专业默认跟当前视角：专业锁时用锁定专业；否则用当前领域第一个专业
  const keys = majorFilterKeys();
  if (CURRENT_MAJOR) promoMajor = CURRENT_MAJOR;
  else if (!keys.includes(promoMajor)) promoMajor = keys[0] || '';
  mc.innerHTML = '<div class="empty">加载中…</div>';
  promoLoad();
}

async function promoLoad() {
  if(!promoMajor){
    const mc=document.getElementById('mainContent');
    if(mc) mc.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-3);font-size:13px">当前领域暂无专业。请先在「学生档案」或课程中为该领域新建专业，再来管理宣传内容。</div>';
    return;
  }
  try {
    const jobs = [sb(`/rest/v1/promo_content?major=eq.${promoMajor}&select=*&order=sort_order.asc,created_at.asc`)];
    if (promoProfiles === null) {
      jobs.push(sb('/rest/v1/teacher_profiles?select=*&order=subject.asc,sort_order.asc').catch(() => []));
      jobs.push(sb('/rest/v1/teachers?select=name,notes').catch(() => []));
    }
    const res = await Promise.all(jobs);
    promoList = res[0];
    if (res[1]) promoProfiles = res[1];
    if (res[2]) { promoPubMap = {}; res[2].forEach(t => { const pub = String(t.notes || '').trim(); if (pub) promoPubMap[t.name] = pub; }); }
  } catch (e) {
    const mc = document.getElementById('mainContent');
    if (mc) mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`;
    return;
  }
  promoRenderShell();
}

// 外壳：专业/板块 chips（含选中高亮）+ 内容容器；切换专业重新拉数据，切换板块只重绘
function promoRenderShell() {
  const mc = document.getElementById('mainContent');
  if (!mc) return;
  mc.innerHTML = `
  <div class="page-header">
    <div class="section-title">宣传管理</div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">
    <span style="font-size:10px;color:var(--text-3)">专业：</span>
    ${majorFilterKeys().map(m => `<div class="filter-chip ${promoMajor===m?'active':''}" onclick="promoMajor='${m}';promoEditingId=null;promoLoad()" style="padding:3px 10px;font-size:11px">${m==='shakai_group'?'社会人文':majorLabel(m)}</div>`).join('')}
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px">
    <span style="font-size:10px;color:var(--text-3)">板块：</span>
    ${PROMO_SECTIONS.map(([k,l]) => `<div class="filter-chip ${promoSection===k?'active':''}" onclick="promoSection='${k}';promoEditingId=null;promoRenderShell()" style="padding:3px 10px;font-size:11px">${l}</div>`).join('')}
  </div>
  <div style="display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:8px 12px;margin-bottom:12px">
    <span style="font-size:10px;color:var(--text-3)">对外分享链接（无需登录，仅显示「公开」状态的内容）：</span>
    <code id="promo_share_link" style="font-size:10px;color:var(--text-2);background:var(--bg);padding:2px 8px;border-radius:2px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${location.origin}${location.pathname.replace(/\/admin\/.*$/,'/promo/')}?major=${promoMajor}</code>
    <button onclick="navigator.clipboard.writeText(document.getElementById('promo_share_link').textContent).then(()=>{this.textContent='✓ 已复制';setTimeout(()=>this.textContent='📋 复制',2000)})" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 10px;cursor:pointer;font-family:inherit;white-space:nowrap">📋 复制</button>
  </div>
  <div id="promo_body"></div>`;
  promoRender();
}

function promoEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

function promoRender() {
  const box = document.getElementById('promo_body');
  if (!box) return;
  const sec = PROMO_SECTIONS.find(([k]) => k === promoSection);
  const list = promoList.filter(p => p.section === promoSection);
  const editing = promoEditingId ? (promoEditingId === 'new' ? {} : list.find(p => p.id === promoEditingId) || {}) : null;

  const inp = 'width:100%;font-size:12px;padding:7px 9px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const formHtml = editing !== null ? `
  <div style="border:1px solid var(--accent);border-radius:4px;padding:14px;margin-bottom:12px;background:var(--bg)">
    <div style="font-size:11px;font-weight:600;margin-bottom:8px">${promoEditingId==='new'?'＋ 新增':'✏ 编辑'}${sec[1]}条目${promoSection==='major_intro'?`<button class="btn btn-outline btn-sm" style="margin-left:10px;font-weight:400;font-size:10px" onclick="promoTplMode=!promoTplMode;promoRender()">${promoTplMode?'← 切换自由编辑':'📋 用模板填写'}</button>`:''}</div>
    ${promoSection==='course'?`<div style="margin-bottom:8px">
      <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">📚 从课程安排选择（本${CURRENT_MAJOR?'专业':'领域'}的课，选后自动填入课程名；有单回明细可一键生成课程安排表）</label>
      <div style="display:flex;gap:6px">
        <select id="promo_course_pick" onchange="promoFillCourseName(this.value)" style="${inp};flex:1">
          <option value="">— 选择现有课程 —</option>
          ${promoAvailCourses().map(nm=>`<option value="${promoEsc(nm)}">${promoEsc(nm)}</option>`).join('')}
        </select>
        <button class="btn btn-outline btn-sm" style="white-space:nowrap" onclick="promoGenCourseTable()">↓ 生成课程安排表</button>
      </div>
    </div>`:''}
    ${promoSection==='lecturer'&&(promoProfiles||[]).length?`<div style="margin-bottom:8px">
      <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">📇 从讲师档案导入（自动填入标题/正文/关联真实姓名，可再修改润色）</label>
      <select onchange="promoFillFromProfile(this.value)" style="${inp}">
        <option value="">— 选择讲师档案 —</option>
        ${promoAvailProfiles().map(p=>`<option value="${p.id}">${promoEsc((p.subject||'未分类'))} · ${promoEsc(p.name)}${promoPubMap[p.name]?`（对外：${promoEsc(promoPubMap[p.name])}）`:''}</option>`).join('')}
      </select>
    </div>`:''}
    <div style="display:grid;grid-template-columns:1fr ${promoSection==='lecturer'?'180px ':''}90px;gap:8px;margin-bottom:8px">
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">标题${promoSection==='course'?'（须与课程安排中的课程名一致）':promoSection==='lecturer'?'（对外显示的姓名＋头衔，可写宣传名）':''}</label>
        <input id="pm_title" value="${promoEsc(editing.title)}" style="${inp}"></div>
      ${promoSection==='lecturer'?`<div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">关联真实姓名（绑定课程用，不对外显示）</label>
        <input id="pm_link" value="${promoEsc(editing.link_name)}" placeholder="与老师管理中的姓名一致" style="${inp}"></div>`:''}
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">排序</label>
        <input id="pm_sort" type="number" value="${editing.sort_order || 0}" style="${inp}"></div>
    </div>
    <div style="font-size:9px;color:var(--text-3);background:var(--surface);border:1px dashed var(--border);border-radius:2px;padding:6px 10px;margin-bottom:6px;line-height:1.9">
      📐 排版语法（对外宣传页会自动渲染成正式排版）：<br>
      <code>## 小标题</code>　·　<code>**粗体**</code>　·　<code>- 无序列表</code>　·　<code>1. 有序列表</code>　·　表格每行 <code>|学校名|研究科|英语|</code>（首行为表头）　·　空行分段
    </div>
    <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">正文</label>
    ${promoSection==='major_intro'&&promoTplMode?promoTemplateFields(editing):`<textarea id="pm_body" rows="10" style="width:100%;font-size:12px;line-height:1.8;padding:9px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit;resize:vertical">${promoEsc(editing.body)}</textarea>`}
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn btn-primary btn-sm" onclick="promoSave()">保存</button>
      <button class="btn btn-outline btn-sm" onclick="promoEditingId=null;promoRender()">取消</button>
    </div>
  </div>` : '';

  box.innerHTML = `
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
    <div style="font-size:12px;font-weight:600">${majorLabel(promoMajor)} · ${sec[1]}（${list.length}条）</div>
    <span style="font-size:10px;color:var(--text-3)">${sec[2]}</span>
    <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="promoEditingId='new';promoRender()">＋ 新增条目</button>
  </div>
  ${formHtml}
  ${list.length ? list.map(p => `
  <div style="border:1px solid var(--border-light);border-radius:3px;padding:10px 14px;margin-bottom:6px;background:var(--surface)">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:12px;font-weight:600">${promoEsc(p.title) || '（无标题）'}</span>
      <span style="font-size:9px;color:var(--text-3)">排序 ${p.sort_order || 0}</span>
      ${p.section==='lecturer'?(p.link_name?`<span style="font-size:9px;color:var(--ok)">🔗 ${promoEsc(p.link_name)}</span>`:`<span style="font-size:9px;color:var(--warn,#b8860b)">⚠ 未绑定真实姓名</span>`):''}
      <span onclick="promoTogglePub('${p.id}')" style="cursor:pointer;user-select:none;font-size:9px;border-radius:2px;padding:1px 8px;${p.published===false?'background:var(--bg);color:var(--text-3);border:1px dashed var(--border)':'background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok)'}">${p.published===false?'🔒 隐藏中 · 点击公开':'🌐 公开中 · 点击隐藏'}</span>
      <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="promoEditingId='${p.id}';promoRender()">✏ 编辑</button>
      <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="promoDelete('${p.id}')">删除</button>
    </div>
    <div style="font-size:11px;color:var(--text-2);margin-top:6px;line-height:1.8;white-space:pre-wrap;max-height:120px;overflow:hidden;text-overflow:ellipsis">${promoEsc((p.body || '').slice(0, 300))}${(p.body || '').length > 300 ? '…' : ''}</div>
  </div>`).join('') : '<div class="empty" style="padding:30px">该板块暂无内容，点击「＋ 新增条目」开始录入</div>'}`;
}

async function promoSave() {
  const title = (document.getElementById('pm_title') || {}).value.trim();
  const body = (promoSection==='major_intro'&&promoTplMode) ? promoTplToMarkdown() : (document.getElementById('pm_body') || {}).value;
  const sort_order = parseInt((document.getElementById('pm_sort') || {}).value) || 0;
  const link_name = ((document.getElementById('pm_link') || {}).value || '').trim();
  if (!title && !body.trim()) { alert('请填写标题或正文'); return; }
  try {
    if (promoEditingId === 'new') {
      const row = {
        id: `pm-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
        major: promoMajor, section: promoSection, title, body, sort_order, link_name,
      };
      await sb('/rest/v1/promo_content', 'POST', row);
      promoList.push(row);
    } else {
      await sb(`/rest/v1/promo_content?id=eq.${promoEditingId}`, 'PATCH', { title, body, sort_order, link_name });
      const idx = promoList.findIndex(p => p.id === promoEditingId);
      if (idx >= 0) Object.assign(promoList[idx], { title, body, sort_order, link_name });
    }
    promoList.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    promoEditingId = null;
    promoRender();
  } catch (e) { alert('保存失败：' + e.message); }
}

async function promoDelete(id) {
  if (!confirm('删除这条宣传内容？')) return;
  try {
    await sb(`/rest/v1/promo_content?id=eq.${id}`, 'DELETE');
    promoList = promoList.filter(p => p.id !== id);
    promoRender();
  } catch (e) { alert('删除失败：' + e.message); }
}

// 公开/隐藏切换（隐藏的内容不出现在对外分享页）
async function promoTogglePub(id) {
  const item = promoList.find(p => p.id === id);
  if (!item) return;
  const next = item.published === false;
  try {
    await sb(`/rest/v1/promo_content?id=eq.${id}`, 'PATCH', { published: next });
    item.published = next;
    promoRender();
  } catch (e) { alert('切换失败：' + e.message); }
}

// 从讲师档案一键填入表单（标题＝姓名＋学历；正文＝专攻方向/授课特色/担当课程；绑定＝档案真实姓名）
// 列出当前专业(promoMajor)的课程名（去重），供课程介绍下拉
function promoAvailCourses(){
  const courses=(typeof cachedCourses!=='undefined'&&cachedCourses)||[];
  const names=courses.filter(c=>{
    // 按当前专业 promoMajor 匹配（社会人文组展开）
    const mj=c.major||[];
    if(promoMajor==='shakai_group') return ['shakai','shinpan','fukushi'].some(x=>mj.includes(x));
    return mj.includes(promoMajor);
  }).map(c=>c.name).filter(Boolean);
  return [...new Set(names)].sort();
}
function promoFillCourseName(name){
  if(!name) return;
  const t=document.getElementById('pm_title');
  if(t) t.value=name;
}
// 用选中课的单回明细，生成"课程安排表"markdown，填进正文
function promoGenCourseTable(){
  const name=(document.getElementById('promo_course_pick')||{}).value || (document.getElementById('pm_title')||{}).value;
  if(!name){ alert('请先选择或填写课程名'); return; }
  const courses=(typeof cachedCourses!=='undefined'&&cachedCourses)||[];
  const sessions=(typeof cachedSessions!=='undefined'&&cachedSessions)||[];
  // 找该名字的课（可能多门同名不同期，取有单回的）
  const cs=courses.filter(c=>c.name===name);
  if(!cs.length){ alert('课程安排里没有这门课'); return; }
  // 收集这些课的单回
  const ids=cs.map(c=>c.id);
  const sess=sessions.filter(s=>ids.includes(s.course_id)).sort((a,b)=>(a.session_date||'').localeCompare(b.session_date||''));
  const body=document.getElementById('pm_body');
  if(!sess.length){
    // 没单回：给个空模板示例
    const tpl='## 课程安排\n\n| 回 | 日期 | 内容 | 授课 |\n|---|---|---|---|\n| 1 | 2026-07-16 | （填写本回内容） | 老师名 |\n| 2 | … | … | … |';
    if(body){ body.value=(body.value?body.value+'\n\n':'')+tpl; }
    alert('这门课暂无单回明细，已插入空白课程安排表模板供填写。');
    return;
  }
  // 有单回：生成表格
  let md='## 课程安排\n\n| 回 | 日期 | 内容 | 授课 |\n|---|---|---|---|\n';
  sess.forEach((s,i)=>{
    md+=`| ${s.session_number||i+1} | ${s.session_date||''} | ${s.session_title||s.title||''} | ${s.session_teacher||s.teacher||''} |\n`;
  });
  if(body){ body.value=(body.value?body.value+'\n\n':'')+md; }
}
// 列出当前专业(promoMajor)的讲师档案（档案subject是中文名，用majorLabel转换匹配）
function promoAvailProfiles(){
  const all=promoProfiles||[];
  const majorCn=promoMajor==='shakai_group'?['社会学','新闻传播学','社会福祉学']:[majorLabel(promoMajor)];
  const filtered=all.filter(p=>{
    const subj=(p.subject||'').trim();
    if(!subj) return true; // 未分类的档案也显示（可能是没标专业的）
    return majorCn.includes(subj);
  });
  // 若过滤后为空（可能档案没按专业标），退回显示全部，避免选不到
  return filtered.length?filtered:all;
}
function promoFillFromProfile(id) {
  if (!id) return;
  const p = (promoProfiles || []).find(x => x.id === id);
  if (!p) return;
  const t = document.getElementById('pm_title');
  const b = document.getElementById('pm_body');
  const l = document.getElementById('pm_link');
  if (t) t.value = [(promoPubMap[p.name] || p.name), p.school, p.degree].filter(Boolean).join('　'); // 标题用对外名
  if (b) b.value = [
    p.keywords ? `##专攻方向\n${p.keywords}` : '',
    p.feature ? `##授课特色\n${p.feature}` : '',
    p.courses ? `##担当课程\n${p.courses}` : '',
  ].filter(Boolean).join('\n\n');
  if (l) l.value = p.name || ''; // 绑定用本名（档案姓名即本名）
}
