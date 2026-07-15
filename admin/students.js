// ══════════════════════════════════
// STUDENTS PAGE
// ══════════════════════════════════
let stMajorFilter='all',stSearch='',stStatus='active';
let stVipFilter='all'; // 'all' | 'vip_only'(VIP+大课VIP都含) | 'vip_exclusive'(仅VIP不含大课)

// 中文输入法兼容：组合输入（拼音候选未确认）期间不重新渲染，避免打断输入法状态导致打不出字
function handleStSearchInput(el){
  if(el.dataset.composing==='1') return; // 正在用输入法组合中，先不处理
  stSearch=el.value;
  const cursorPos=el.selectionStart;
  renderStudentsPage(document.getElementById('mainContent'));
  const newEl=document.getElementById('st_search_input');
  if(newEl){ newEl.focus(); newEl.setSelectionRange(cursorPos,cursorPos); }
}
function handleProgressSearchInput(el){
  if(el.dataset.composing==='1') return;
  progressStudentFilter=el.value;
  const cursorPos=el.selectionStart;
  renderProgressPage(document.getElementById('mainContent'));
  const newEl=document.getElementById('progress_search_input');
  if(newEl){ newEl.focus(); newEl.setSelectionRange(cursorPos,cursorPos); }
}
function renderStudentsPage(mc){
  let list=cachedStudents;
  if(stMajorFilter!=='all') list=list.filter(s=>matchesMajorFilter(s.major,stMajorFilter));
  if(stStatus!=='all') list=list.filter(s=>s.status===stStatus);
  if(stVipFilter==='vip_only') list=list.filter(s=>s.is_vip_course==='VIP'||s.is_vip_course==='大课+VIP');
  if(stVipFilter==='vip_exclusive') list=list.filter(s=>s.is_vip_course==='VIP');
  if(stSearch) list=list.filter(s=>matchesStudentSearch(s,stSearch));
  const statusLabel=(v)=>({active:'在籍',graduated:'已合格',expired:'已到期',stopped:'停课',withdrawn:'退学'}[v]||v);
  const statusColor=(v)=>v==='active'?'var(--ok)':v==='graduated'?'#1a6a9a':v==='withdrawn'?'var(--danger)':'var(--text-3)';
  const statusBg=(v)=>v==='active'?'var(--ok-bg)':v==='graduated'?'#e8f4fd':v==='withdrawn'?'#fdecea':'var(--border)';
  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">学生档案 <span class="badge-count">${cachedStudents.length}</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="exportStudents()">↓ 导出 Excel</button>
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('importFileInput').click()">↑ 导入 Excel</button>
      <button class="btn btn-outline btn-sm" onclick="generateAllStudentCodes()">🔑 批量生成查询码</button>
      <button class="btn btn-outline btn-sm" onclick="batchChangeStatus()">批量改状态</button>
      <input type="file" id="importFileInput" accept=".xlsx,.xls" style="display:none" onchange="handleImportFile(this)">
      <button class="btn btn-primary btn-sm" onclick="openStudentModal()">＋ 添加学生</button>
    </div>
  </div>
  <div class="filter-row">
    ${['all','keiei','keizai','shakai_group','shakai','shinpan','fukushi'].map((m,i)=>`<div class="filter-chip${stMajorFilter===m?' active':''}" onclick="setStMajor('${m}',this)">${i===0?'全部专业':majorLabel(m)}</div>`).join('')}
  </div>
  <div class="filter-row">
    ${[['active','在籍'],['graduated','已合格'],['expired','已到期'],['stopped','停课'],['withdrawn','退学'],['all','全部']].map(([v,l])=>`<div class="filter-chip${stStatus===v?' active':''}" onclick="setStStatus('${v}',this)">${l}</div>`).join('')}
  </div>
  <div class="filter-row">
    ${[['all','全部学生'],['vip_only','含VIP（含大课+VIP）'],['vip_exclusive','仅VIP（不含大课）']].map(([v,l])=>`<div class="filter-chip${stVipFilter===v?' active':''}" onclick="setStVip('${v}',this)">${l}</div>`).join('')}
  </div>
  <div class="search-bar"><input id="st_search_input" placeholder="搜索姓名 / 学校 / 备注…" value="${stSearch}" oninput="handleStSearchInput(this)" oncompositionstart="this.dataset.composing='1'" oncompositionend="this.dataset.composing='';handleStSearchInput(this)"></div>
  <div class="table-scroll"><table class="student-table">
    <thead><tr>
      <th><input type="checkbox" id="selectAllStudents" onchange="toggleSelectAllStudents(this)"></th>
      <th>姓名</th><th>专业</th><th>等级</th><th>属性</th><th>VIP课时</th><th>日语</th><th>英语</th><th>出身大学</th><th>入学目标</th><th>赴日</th><th>状态</th><th>查询码</th><th></th>
    </tr></thead>
    <tbody>
      ${list.length?list.map(s=>{
        const isVip = s.is_vip_course==='VIP'||s.is_vip_course==='大课+VIP';
        const vipRemain = (s.vip_hours_total||0)-(s.vip_hours_used||0);
        return `<tr>
        <td><input type="checkbox" class="student-select" value="${s.id}"></td>
        <td class="student-name-cell" onclick="openStudentDetail('${s.id}')" style="cursor:pointer;color:var(--accent);text-decoration:underline">${s.name}</td>
        <td>${MAJORS[s.major]||s.major||''}</td>
        <td>${s.level?`<span class="level-badge level-${s.level}">${s.level}</span>`:''}</td>
        <td style="font-size:11px">${s.student_type||''}</td>
        <td style="font-size:11px">${isVip?`<span style="color:var(--accent);font-weight:600">${vipRemain}</span> / ${s.vip_hours_total||0}`:'—'}</td>
        <td style="font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${s.japanese_score||''}">${s.japanese_score||''}</td>
        <td style="font-size:11px">${s.english_score||''}</td>
        <td style="font-size:11px">${s.university||''}</td>
        <td style="font-size:11px">${s.target_enrollment||''}</td>
        <td style="font-size:11px">${s.japan_arrival||''}</td>
        <td><span class="status-badge" style="background:${statusBg(s.status)};color:${statusColor(s.status)}">${statusLabel(s.status)}</span></td>
        <td>
          ${s.student_code
            ? `<span style="font-size:11px;font-weight:600;letter-spacing:1px;color:var(--accent)">${s.student_code}</span>`
            : `<button class="btn btn-outline btn-sm" onclick="generateStudentCode('${s.id}')">生成</button>`}
        </td>
        <td style="display:flex;gap:4px">
          <button class="btn btn-outline btn-sm" onclick="openStudentModal('${s.id}')">编辑</button>
          <button class="btn btn-danger btn-sm" onclick="deleteStudent('${s.id}')">删除</button>
        </td>
      </tr>`;
      }).join(''):'<tr><td colspan="14" style="text-align:center;padding:30px;color:var(--text-3)">暂无学生数据</td></tr>'}
    </tbody>
  </table></div>`;
}

function setStVip(v,el){stVipFilter=v;document.querySelectorAll('.filter-row:nth-of-type(3) .filter-chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');renderStudentsPage(document.getElementById('mainContent'))}

function setStMajor(m,el){stMajorFilter=m;document.querySelectorAll('.filter-row:nth-of-type(1) .filter-chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');renderStudentsPage(document.getElementById('mainContent'))}
function setStStatus(v,el){stStatus=v;document.querySelectorAll('.filter-row:nth-of-type(2) .filter-chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');renderStudentsPage(document.getElementById('mainContent'))}
// 渲染VIP指导老师标签+输入框，selectedTeachers 是已选老师姓名数组（存在 module 级变量里方便增删）
let vipTeacherTags = [];
function populateVipTeachers(selectedTeachers){
  vipTeacherTags = [...(selectedTeachers||[])];
  renderVipTeacherTags();
}
function renderVipTeacherTags(){
  const wrap=document.getElementById('st_vip_teachers');
  if(!wrap) return;
  const datalistOptions=(cachedTeachers||[]).map(t=>`<option value="${t.name}">`).join('');
  wrap.innerHTML=`
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
      ${vipTeacherTags.map(name=>`
        <span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;background:var(--accent-light,#eee);border:1px solid var(--accent);border-radius:3px;padding:3px 8px">
          ${name}
          <span onclick="removeVipTeacherTag('${name.replace(/'/g,"\\'")}')" style="cursor:pointer;color:var(--text-3);font-weight:600">✕</span>
        </span>`).join('') || '<span style="font-size:11px;color:var(--text-3)">尚未分配老师</span>'}
    </div>
    <div style="display:flex;gap:6px">
      <input list="vip_teacher_suggestions" id="st_vip_teacher_input" placeholder="输入老师姓名，回车添加" style="flex:1;font-size:11px" onkeydown="if(event.key==='Enter'){event.preventDefault();addVipTeacherTag()}">
      <datalist id="vip_teacher_suggestions">${datalistOptions}</datalist>
      <button type="button" class="btn btn-outline btn-sm" onclick="addVipTeacherTag()">添加</button>
    </div>`;
}
function addVipTeacherTag(){
  const input=document.getElementById('st_vip_teacher_input');
  const name=input.value.trim();
  if(!name) return;
  if(!vipTeacherTags.includes(name)) vipTeacherTags.push(name);
  input.value='';
  renderVipTeacherTags();
  document.getElementById('st_vip_teacher_input')?.focus();
}
function removeVipTeacherTag(name){
  vipTeacherTags=vipTeacherTags.filter(n=>n!==name);
  renderVipTeacherTags();
}

function openStudentModal(id){
  const s=id?cachedStudents.find(x=>x.id===id):null;
  document.getElementById('studentModalTitle').textContent=s?'编辑学生':'添加学生';
  document.getElementById('studentId').value=s?.id||'';
  populateMajorSelect('st_major', s?.major||'');
  populateVipTeachers(s?.vip_teachers||[]);
  const fields={
    st_name:'name',st_type:'student_type',st_source:'source',
    st_course:'course_type',st_level:'level',st_japanese:'japanese_score',
    st_english:'english_score',st_university:'university',st_faculty:'faculty',
    st_gpa:'gpa',st_thesis:'thesis',st_graduation:'graduation_date',
    st_enrollment:'target_enrollment',st_arrival:'japan_arrival',
    st_signup:'signup_date',st_expiry:'expiry_date',st_default_mode:'default_mode',st_status:'status',
    st_vip_course:'is_vip_course',st_vip_total:'vip_hours_total',st_vip_used:'vip_hours_used'
  };
  Object.entries(fields).forEach(([el,key])=>{
    const e=document.getElementById(el);
    if(!e) return;
    if(s){ e.value=s[key]??''; }
    else if(el==='st_status'){ e.value='active'; }
    else if(el==='st_vip_course'){ e.value='大课'; }
    else { e.value=''; }
  });
  document.getElementById('studentModal').classList.add('open');
}

// 用当前 MAJORS（核心专业 + 数据库已加载的专业）动态生成下拉选项，并选中指定值
function populateMajorSelect(selectId, selectedValue){
  const sel=document.getElementById(selectId);
  if(!sel) return;
  // 排除 shakai_group（这是筛选用的分组标记，不是真实可选专业）
  const entries=Object.entries(MAJORS).filter(([k])=>k!=='shakai_group');
  sel.innerHTML=entries.map(([k,v])=>`<option value="${k}" ${k===selectedValue?'selected':''}>${v}</option>`).join('');
  // 若学生当前专业不在 MAJORS 里（理论上不该发生，但做个保险），追加一个临时选项避免下拉显示为空
  if(selectedValue && !MAJORS[selectedValue]){
    sel.insertAdjacentHTML('beforeend', `<option value="${selectedValue}" selected>${selectedValue}</option>`);
  }
}

// 新增专业：输入中文名 → 调用 createMajor（写入数据库 majors 表）→ 刷新下拉并选中新专业
async function addNewMajor(){
  const label=prompt('请输入新专业名称（中文）：');
  if(!label||!label.trim()) return;
  const key=await createMajor(label.trim());
  if(key){
    populateMajorSelect('st_major', key);
    alert(`已新增专业「${label.trim()}」`);
  }
}

async function saveStudent(){
  const name=document.getElementById('st_name').value.trim();
  const major=document.getElementById('st_major').value;
  if(!name){alert('请填写姓名');return}
  const id=document.getElementById('studentId').value;
  const data={
    name,major,
    student_type:document.getElementById('st_type').value,
    source:document.getElementById('st_source').value,
    course_type:document.getElementById('st_course').value,
    level:document.getElementById('st_level').value,
    japanese_score:document.getElementById('st_japanese').value,
    english_score:document.getElementById('st_english').value,
    university:document.getElementById('st_university').value,
    faculty:document.getElementById('st_faculty').value,
    gpa:document.getElementById('st_gpa').value,
    thesis:document.getElementById('st_thesis').value,
    graduation_date:document.getElementById('st_graduation').value,
    target_enrollment:document.getElementById('st_enrollment').value,
    japan_arrival:document.getElementById('st_arrival').value,
    signup_date:document.getElementById('st_signup').value,
    expiry_date:document.getElementById('st_expiry').value,
    default_mode:document.getElementById('st_default_mode').value,
    status:document.getElementById('st_status').value,
    is_vip_course:document.getElementById('st_vip_course').value,
    vip_hours_total:parseFloat(document.getElementById('st_vip_total').value)||0,
    vip_hours_used:parseFloat(document.getElementById('st_vip_used').value)||0,
    vip_teachers:[...vipTeacherTags]
  };
  try{
    if(id){
      await sb(`/rest/v1/students?id=eq.${id}`,'PATCH',data);
      const idx=cachedStudents.findIndex(x=>x.id===id);
      if(idx>=0)cachedStudents[idx]={...cachedStudents[idx],...data};
    } else {
      data.id=`${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
      const res=await sb('/rest/v1/students','POST',data);
      cachedStudents.push(Array.isArray(res)?res[0]:data);
    }
    closeModal('studentModal');
    renderStudentsPage(document.getElementById('mainContent'));
  }catch(e){alert('保存失败：'+e.message)}
}

async function deleteStudent(id){
  if(!confirm('确定删除这个学生？'))return;
  try{
    await sb(`/rest/v1/students?id=eq.${id}`,'DELETE');
    cachedStudents=cachedStudents.filter(s=>s.id!==id);
    renderStudentsPage(document.getElementById('mainContent'));
  }catch(e){alert('删除失败：'+e.message)}
}

function toggleSelectAllStudents(cb){
  document.querySelectorAll('.student-select').forEach(c=>c.checked=cb.checked);
}

function batchChangeStatus(){
  const selected=[...document.querySelectorAll('.student-select:checked')].map(c=>c.value);
  if(!selected.length){alert('请先勾选学生');return}
  // 显示状态选择浮层
  let overlay=document.getElementById('batchStatusOverlay');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='batchStatusOverlay';
    overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:1000;display:flex;align-items:center;justify-content:center';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML=`
    <div style="background:var(--surface);border-radius:6px;padding:20px;width:280px">
      <div style="font-size:13px;font-weight:600;margin-bottom:14px">批量修改状态（已选 ${selected.length} 人）</div>
      ${[['active','在籍'],['graduated','已合格'],['expired','已到期'],['stopped','停课'],['withdrawn','退学']].map(([v,l])=>`
        <div onclick="applyBatchStatus('${v}',${JSON.stringify(selected)})" style="padding:10px 14px;border-radius:3px;cursor:pointer;font-size:13px;margin-bottom:4px;background:var(--bg);border:1px solid var(--border);display:flex;align-items:center;gap:8px">
          <span style="font-size:16px">${{active:'🟢',graduated:'🔵',expired:'⚫',stopped:'🟡',withdrawn:'🔴'}[v]}</span>${l}
        </div>`).join('')}
      <button onclick="document.getElementById('batchStatusOverlay').remove()" style="width:100%;margin-top:8px;padding:8px;background:none;border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:12px;font-family:inherit">取消</button>
    </div>`;
}

async function applyBatchStatus(status, selected){
  document.getElementById('batchStatusOverlay')?.remove();
  try{
    for(const id of selected){
      await sb(`/rest/v1/students?id=eq.${id}`,'PATCH',{status});
      const s=cachedStudents.find(x=>x.id===id);
      if(s) s.status=status;
    }
    renderStudentsPage(document.getElementById('mainContent'));
  }catch(e){alert('批量更新失败：'+e.message)}
}

async function openStudentDetail(id){
  const s=cachedStudents.find(x=>x.id===id);
  if(!s) return;
  // 拉取该学生最新面谈记录和考学进度
  const [bookings, progress] = await Promise.all([
    sb(`/rest/v1/bookings?name=eq.${encodeURIComponent(s.name)}&status=eq.confirmed&select=*&order=slot_date.desc&limit=5`).catch(()=>[]),
    sb(`/rest/v1/student_progress?student_id=eq.${s.id}&select=*`).catch(()=>[])
  ]);
  const p=progress[0]||{};
  const statusLabel=(v)=>({active:'在籍',graduated:'已合格',expired:'已到期',stopped:'停课',withdrawn:'退学'}[v]||v);
  const row=(label,val)=>val?`<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-light)"><span style="font-size:11px;color:var(--text-3);min-width:90px">${label}</span><span style="font-size:11px;color:var(--text-2)">${val}</span></div>`:'';
  const latest=bookings[0];
  const r=latest?.daily_record||{};

  const html=`
    <div style="font-size:16px;font-weight:700;margin-bottom:4px">${s.name}</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:16px">${MAJORS[s.major]||s.major||''} · ${statusLabel(s.status)}</div>
    <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">基础档案</div>
    ${row('学生属性',s.student_type)}
    ${row('来源',s.source)}
    ${row('课程属性',s.course_type)}
    ${row('等级',s.level)}
    ${row('日语成绩',s.japanese_score)}
    ${row('英语成绩',s.english_score)}
    ${row('出身大学',s.university)}
    ${row('学部/专业',s.faculty)}
    ${row('GPA/履历',s.gpa)}
    ${row('毕业论文',s.thesis)}
    ${row('毕业时间',s.graduation_date)}
    ${row('期待入学',s.target_enrollment)}
    ${row('赴日时间',s.japan_arrival)}
    ${row('报名时间',s.signup_date)}
    ${row('到期时间',s.expiry_date)}
    ${row('上课方式',s.default_mode==='online'?'线上':'线下')}
    ${row('查询码',s.student_code)}
    ${p.target_schools||p.difficulties||p.research_plan?`
    <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin:14px 0 8px">考学进度</div>
    ${row('志望校',p.target_schools)}
    ${row('困难点',p.difficulties)}
    ${row('研究计划书',p.research_plan)}
    ${row('知识进展',r.study_status?r.study_status+(r.study_advice?' · '+r.study_advice:''):'')}
    ${row('计划书进展',r.plan_status?r.plan_status+(r.plan_advice?' · '+r.plan_advice:''):'')}
    ${row('出愿情况',r.apply_status?r.apply_status+(r.apply_advice?' · '+r.apply_advice:''):'')}
    ${row('备考情况',r.exam_status?r.exam_status+(r.exam_advice?' · '+r.exam_advice:''):'')}
    `:''}
    ${bookings.length?`
    <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin:14px 0 8px">最近面谈（${bookings.length}条）</div>
    ${bookings.map(b=>`<div style="font-size:11px;padding:6px 0;border-bottom:1px solid var(--border-light);color:var(--text-2)">${b.slot_date} ${b.slot_time_range||''} · ${typeLabel(b.type)||b.type}</div>`).join('')}
    `:''}
    <div style="margin-top:16px;display:flex;gap:8px">
      <button class="btn btn-outline btn-sm" onclick="closeModal('studentDetailModal');openStudentModal('${s.id}')">✏ 编辑档案</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal('studentDetailModal');renderProgressPage(document.getElementById('mainContent'),'${s.id}')">📊 考学进度</button>
    </div>`;

  document.getElementById('studentDetailContent').innerHTML=html;
  document.getElementById('studentDetailModal').classList.add('open');
}


// ── 学生查询码 ──
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, ()=>chars[Math.floor(Math.random()*chars.length)]).join('');
}

async function generateStudentCode(id) {
  const s = cachedStudents.find(x => x.id === id);
  if (!s) return;
  if (s.student_code && !confirm(`${s.name} 已有查询码 ${s.student_code}，确定重新生成？`)) return;
  const code = genCode();
  try {
    await sb(`/rest/v1/students?id=eq.${id}`, 'PATCH', { student_code: code });
    s.student_code = code;
    renderStudentsPage(document.getElementById('mainContent'));
  } catch(e) { alert('生成失败：' + e.message); }
}

async function generateAllStudentCodes() {
  const noCode = cachedStudents.filter(s => !s.student_code);
  if (!noCode.length) { alert('所有学生已有查询码'); return; }
  if (!confirm(`将为 ${noCode.length} 名学生生成查询码，继续？`)) return;
  try {
    for (const s of noCode) {
      const code = genCode();
      await sb(`/rest/v1/students?id=eq.${s.id}`, 'PATCH', { student_code: code });
      s.student_code = code;
    }
    renderStudentsPage(document.getElementById('mainContent'));
    alert(`✓ 已为 ${noCode.length} 名学生生成查询码`);
  } catch(e) { alert('生成失败：' + e.message); }
}


// ── 考学进度页面 ──
let progressStudentFilter = '';
let progressViewMode = 'student'; // 'student' | 'season'

async function renderProgressPage(mc, focusStudentId=null){
  mc.innerHTML='<div class="loading">加载中…</div>';
  let students=cachedStudents.filter(s=>s.status==='active'||s.status==='stopped'||s.status==='graduated');
  if(stMajorFilter!=='all') students=students.filter(s=>matchesMajorFilter(s.major,stMajorFilter));
  if(progressStudentFilter) students=students.filter(s=>matchesStudentSearch(s,progressStudentFilter));

  const [allTimeline, allPlansPG, allDraftsPG] = await Promise.all([
    sb('/rest/v1/student_progress_timeline?select=*&order=created_at.asc&limit=5000').catch(()=>[]),
    sb('/rest/v1/student_school_plans?select=*&order=level.asc&limit=5000').catch(()=>[]),
    sb('/rest/v1/student_plan_drafts?select=*&limit=5000').catch(()=>[]),
  ]);
  const timelineMap = {};
  allTimeline.forEach(t => {
    if (!timelineMap[t.student_id]) timelineMap[t.student_id] = [];
    timelineMap[t.student_id].push(t);
  });
  const plansMapPG = {}, draftsMapPG = {};
  allPlansPG.forEach(p => { if (!plansMapPG[p.student_id]) plansMapPG[p.student_id] = []; plansMapPG[p.student_id].push(p); });
  allDraftsPG.forEach(d => { if (!draftsMapPG[d.student_id]) draftsMapPG[d.student_id] = d; });

  const cards = students.map(s => {
    const timeline = timelineMap[s.id] || [];
    const latest = getLatestProgress(timeline);
    const isFocus = focusStudentId === s.id;

    const statusRow = Object.entries(PROGRESS_LABELS).map(([k,label]) => {
      if (!latest[k] && !((k==='japanese'&&s.japanese_score)||(k==='english'&&s.english_score))) return '';
      const done = isProgressDone(k, latest[k]);
      const scoreText = k==='japanese'&&s.japanese_score ? ` · ${s.japanese_score}` : k==='english'&&s.english_score ? ` · ${s.english_score}` : '';
      const val = latest[k] || (k==='japanese'?'有成绩':'有成绩');
      return `<span title="${label}" style="font-size:10px;background:${done?'var(--ok-bg)':'var(--warn-bg)'};color:${done?'var(--ok)':'var(--warn)'};padding:1px 6px;border-radius:2px">${PROGRESS_ICONS[k]} ${latest[k]||''}${scoreText}</span>`;
    }).join('');

    // 志望校流水线细节：填充进计划书/出愿/备考三张卡
    const sPlans = plansMapPG[s.id] || [];
    const sDraft = draftsMapPG[s.id];
    let sRefsN = 0, sDraftN = 0;
    try {
      sRefsN = sDraft && sDraft.prior_research_list ? JSON.parse(sDraft.prior_research_list).length : 0;
      const df0 = sDraft && sDraft.draft_fields ? JSON.parse(sDraft.draft_fields) : {};
      sDraftN = Object.values(df0).filter(v => Array.isArray(v) ? v.length : String(v || '').trim()).length;
    } catch(e) {}
    const pgDetail = k => {
      if (k === 'plan') {
        const parts = [];
        if (sRefsN) parts.push(`📚 先行研究 ${sRefsN} 条`);
        if (sDraftN) parts.push(`草稿已填 ${sDraftN} 项`);
        return parts.length ? `<div style="font-size:10px;color:var(--text-2);margin-top:4px;line-height:1.7">${parts.join(' · ')}</div>` : '';
      }
      if (k === 'apply') {
        if (!sPlans.length) return '';
        return `<div style="margin-top:4px">${sPlans.map(p => {
          const st = schoolStatusLabel(p.status);
          return `<div style="font-size:10px;line-height:1.7"><span style="color:var(--text-2)">${p.school_name}${p.professor ? ' · ' + p.professor : ''}</span> — <span style="color:${st.c}">${st.t}</span></div>`;
        }).join('')}</div>`;
      }
      if (k === 'exam') {
        const rel = sPlans.filter(p => ['prof_ok','applied','passed'].includes(p.status));
        if (!rel.length) return '';
        return `<div style="margin-top:4px">${rel.map(p =>
          `<div style="font-size:10px;line-height:1.7;color:var(--text-2)">${p.school_name}：过去问 ${p.kakomon_started ? '<span style="color:var(--ok)">✓</span>' : '—'} · 面试稿 ${p.interview_draft_done ? '<span style="color:var(--ok)">✓</span>' : '—'}</div>`
        ).join('')}</div>`;
      }
      return '';
    };
    const dimCards = Object.entries(PROGRESS_LABELS).map(([k,label]) => {
      // 语言维度直接显示学生档案里的实际成绩
      let scoreHint = '';
      if (k === 'japanese' && s.japanese_score) scoreHint = `<div style="font-size:11px;color:var(--text-2);margin-top:4px">📊 ${s.japanese_score}</div>`;
      if (k === 'english' && s.english_score) scoreHint = `<div style="font-size:11px;color:var(--text-2);margin-top:4px">📊 ${s.english_score}</div>`;
      return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:8px">
        <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">${PROGRESS_ICONS[k]} ${label}</div>
        ${renderProgressBadge(k, latest[k])}
        ${scoreHint}
        ${pgDetail(k)}
      </div>`;
    }).join('');

    const timelineHtml = timeline.length
      ? [...timeline].reverse().map(entry =>
          renderProgressTimelineEntry(entry, true, `editProgressEntry('${entry.id}','${s.id}','${s.name}','${s.major}')`)
        ).join('')
      : '<div style="font-size:11px;color:var(--text-3);padding:8px 0">暂无进度记录</div>';

    return `<div style="background:var(--surface);border:1px solid ${isFocus?'var(--accent)':'var(--border)'};border-radius:4px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer" onclick="toggleProgressCard('${s.id}')">
        <div style="flex:1">
          <span style="font-size:13px;font-weight:600">${s.name}</span>
          <span style="font-size:11px;color:var(--text-3);margin-left:8px">${MAJORS[s.major]||s.major||''}</span>
          ${s.target_enrollment?`<span style="font-size:10px;color:var(--text-3);margin-left:8px">目标：${s.target_enrollment}</span>`:''}
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          ${statusRow || '<span style="font-size:10px;color:var(--text-3)">暂无记录</span>'}
          <span style="font-size:11px;color:var(--text-3);margin-left:4px">▾</span>
        </div>
      </div>
      <div id="prog_${s.id}" style="display:${isFocus?'block':'none'};border-top:1px solid var(--border-light);background:var(--bg)">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border-light)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="font-size:11px;font-weight:600;color:var(--text-2)">当前进度</div>
            <button class="btn btn-primary btn-sm" onclick="openAddProgressEntry('${s.id}','${s.name}','${s.major}')">＋ 更新进度</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${dimCards}</div>
        </div>
        <div style="padding:12px 14px">
          <div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:8px">进度时间线 <span style="font-weight:400;color:var(--text-3)">${timeline.length} 条记录</span></div>
          ${timelineHtml}
        </div>
      </div>
    </div>`;
  }).join('');

  // 如果是年度出愿情报视图
  if (progressViewMode === 'season') {
    await renderSeasonView(mc, students, timelineMap);
    return;
  }

  mc.innerHTML = `
  <div class="page-header">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <div class="section-title">考学进度</div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-sm ${progressViewMode==='student'?'btn-primary':'btn-outline'}" onclick="progressViewMode='student';renderProgressPage(document.getElementById('mainContent'))">👤 学生视角</button>
        <button class="btn btn-sm ${progressViewMode==='season'?'btn-primary':'btn-outline'}" onclick="progressViewMode='season';renderProgressPage(document.getElementById('mainContent'))">📋 年度出愿情报</button>
      </div>
    </div>
  </div>
  <div class="filter-row">
    ${['all','keiei','keizai','shakai_group','shakai','shinpan','fukushi'].map((m,i)=>`<div class="filter-chip${stMajorFilter===m?' active':''}" onclick="setStMajor('${m}',this);renderProgressPage(document.getElementById('mainContent'))">${i===0?'全部专业':majorLabel(m)}</div>`).join('')}
  </div>
  <div class="search-bar"><input id="progress_search_input" placeholder="搜索学生姓名…" value="${progressStudentFilter}" oninput="handleProgressSearchInput(this)" oncompositionstart="this.dataset.composing='1'" oncompositionend="this.dataset.composing='';handleProgressSearchInput(this)"></div>
  <div style="display:flex;flex-direction:column;gap:8px">${cards}</div>

  <div class="modal-overlay" id="progressEntryModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;align-items:center;justify-content:center;padding:16px">
    <div class="modal" style="width:520px;max-height:85vh;overflow-y:auto">
      <div class="modal-title" id="progressEntryTitle">录入进度</div>
      <input type="hidden" id="pe_entry_id">
      <input type="hidden" id="pe_student_id">
      <input type="hidden" id="pe_student_name">
      <input type="hidden" id="pe_major">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        ${Object.entries(PROGRESS_LABELS).map(([k,label]) =>
          `<div class="form-group" style="margin:0">
            <label class="form-label">${PROGRESS_ICONS[k]} ${label}</label>
            <select id="pe_${k}">
              <option value="">不更新此项</option>
              ${PROGRESS_OPTIONS[k].map(v=>`<option value="${v}">${v}</option>`).join('')}
            </select>
          </div>`
        ).join('')}
      </div>
      <div class="form-group">
        <label class="form-label">备注</label>
        <textarea id="pe_notes" rows="2" placeholder="补充说明…"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">记录时间（年月旬，可选）</label>
        <input id="pe_recorded_at" placeholder="例：2026年6月中旬">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeProgressModal()">取消</button>
        <button id="pe_delete_btn" class="btn btn-danger btn-sm" style="display:none" onclick="deleteProgressEntry()">删除</button>
        <button class="btn btn-primary" onclick="saveProgressEntry()">保存</button>
      </div>
    </div>
  </div>`;
}

function toggleProgressCard(id){
  const el=document.getElementById(`prog_${id}`);
  if(el) el.style.display=el.style.display==='none'?'block':'none';
}

function openAddProgressEntry(studentId='', studentName='', major='') {
  document.getElementById('pe_entry_id').value = '';
  document.getElementById('pe_student_id').value = studentId;
  document.getElementById('pe_student_name').value = studentName;
  document.getElementById('pe_major').value = major;
  document.getElementById('progressEntryTitle').textContent = studentName ? `录入进度 · ${studentName}` : '录入进度';
  document.getElementById('pe_delete_btn').style.display = 'none';
  document.getElementById('pe_notes').value = '';
  document.getElementById('pe_recorded_at').value = '';
  Object.keys(PROGRESS_OPTIONS).forEach(k => {
    const el = document.getElementById(`pe_${k}`); if (el) el.value = '';
  });
  document.getElementById('progressEntryModal').style.display = 'flex';
}

function editProgressEntry(entryId, studentId, studentName, major) {
  sb(`/rest/v1/student_progress_timeline?id=eq.${entryId}&select=*`).then(rows => {
    if (!rows.length) return;
    const entry = rows[0];
    document.getElementById('pe_entry_id').value = entryId;
    document.getElementById('pe_student_id').value = studentId;
    document.getElementById('pe_student_name').value = studentName;
    document.getElementById('pe_major').value = major;
    document.getElementById('progressEntryTitle').textContent = `编辑进度 · ${studentName}`;
    document.getElementById('pe_delete_btn').style.display = 'inline-flex';
    document.getElementById('pe_notes').value = entry.notes || '';
    document.getElementById('pe_recorded_at').value = entry.recorded_at || '';
    Object.keys(PROGRESS_OPTIONS).forEach(k => {
      const el = document.getElementById(`pe_${k}`); if (el) el.value = entry[k] || '';
    });
    document.getElementById('progressEntryModal').style.display = 'flex';
  }).catch(e => alert('加载失败：' + e.message));
}

function closeProgressModal() {
  document.getElementById('progressEntryModal').style.display = 'none';
}

async function saveProgressEntry() {
  const entryId = document.getElementById('pe_entry_id').value;
  const studentId = document.getElementById('pe_student_id').value;
  const studentName = document.getElementById('pe_student_name').value;
  const major = document.getElementById('pe_major').value;
  if (!studentId || !studentName) { alert('请指定学生'); return; }
  const dims = {};
  Object.keys(PROGRESS_OPTIONS).forEach(k => {
    dims[k] = document.getElementById(`pe_${k}`)?.value || '';
  });
  const notes = document.getElementById('pe_notes').value.trim();
  const recorded_at = document.getElementById('pe_recorded_at').value.trim();
  if (!Object.values(dims).some(v=>v) && !notes) { alert('请至少更新一个维度的进度'); return; }
  const data = makeProgressEntry({ studentId, studentName, major, source: 'admin', sourceName: '管理员', notes, recorded_at, ...dims });
  try {
    if (entryId) {
      await sb(`/rest/v1/student_progress_timeline?id=eq.${entryId}`, 'PATCH', data);
    } else {
      await sb('/rest/v1/student_progress_timeline', 'POST', data);
    }
    closeProgressModal();
    renderProgressPage(document.getElementById('mainContent'), studentId);
  } catch(e) { alert('保存失败：' + e.message); }
}

async function deleteProgressEntry() {
  const entryId = document.getElementById('pe_entry_id').value;
  const studentId = document.getElementById('pe_student_id').value;
  if (!entryId || !confirm('确定删除这条进度记录？')) return;
  try {
    await sb(`/rest/v1/student_progress_timeline?id=eq.${entryId}`, 'DELETE');
    closeProgressModal();
    renderProgressPage(document.getElementById('mainContent'), studentId);
  } catch(e) { alert('删除失败：' + e.message); }
}


function exportCoursesExcel(){
  if(!cachedCourses.length){alert('暂无课程数据');return;}
  // 按课程+课次展开
  const rows=[];
  cachedCourses.forEach(c=>{
    const sessions=cachedSessions.filter(s=>s.course_id===c.id).sort((a,b)=>a.session_date.localeCompare(b.session_date));
    if(!sessions.length){
      rows.push({
        课程名称:c.name||'',专业:Array.isArray(c.major)?c.major.join('/'):c.major||'',
        期数:c.period||'',课程属性:c.course_type||'',主讲老师:c.teacher||'',
        校区:c.campus||'',授课形式:c.delivery||'',上课时间:c.time_range||'',
        第几回:'',日期:'',单回名称:'',任课老师:'',是否发布:'',
        腾讯会议:c.meeting_url||'',主持人密钥:c.host_key||'',
        布置作业:c.homework_enabled?'是':'否',备注:c.notes||''
      });
    } else {
      sessions.forEach((s,i)=>{
        rows.push({
          课程名称:i===0?c.name:'',专业:i===0?(Array.isArray(c.major)?c.major.join('/'):c.major||''):'',
          期数:i===0?c.period||'':'',课程属性:i===0?c.course_type||'':'',主讲老师:i===0?c.teacher||'':'',
          校区:i===0?c.campus||'':'',授课形式:i===0?c.delivery||'':'',上课时间:i===0?c.time_range||'':'',
          第几回:`第${s.session_number}回`,日期:s.session_date||'',
          单回名称:s.session_title||'',任课老师:s.session_teacher||s.teacher||'',
          是否发布:s.confirmed?'已发布':'未发布',
          腾讯会议:i===0?c.meeting_url||'':'',主持人密钥:i===0?c.host_key||'':'',
          布置作业:i===0?c.homework_enabled?'是':'否':'',备注:i===0?c.notes||'':''
        });
      });
    }
  });
  // 生成 CSV
  const headers=Object.keys(rows[0]);
  const csv=[headers.join(','),...rows.map(r=>headers.map(h=>`"${(r[h]||'').toString().replace(/"/g,'""')}"`).join(','))].join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`课程安排_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}


function exportStudents(){
  if(!cachedStudents.length){alert('暂无学生数据');return}
  const rows=cachedStudents.map(s=>({'姓名':s.name,'专业':MAJORS[s.major]||s.major||'','等级':s.level||'','属性':s.student_type||'','来源':s.source||'','课程属性':s.course_type||'','日语成绩':s.japanese_score||'','英语成绩':s.english_score||'','出身大学':s.university||'','学部专业':s.faculty||'','GPA':s.gpa||'','毕业时间':s.graduation_date||'','入学目标':s.target_enrollment||'','赴日时间':s.japan_arrival||'','报名时间':s.signup_date||'','到期时间':s.expiry_date||'','状态':s.status||'','困难点':s.difficulty||'','备注':s.notes||''}));
  const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'学生档案');
  XLSX.writeFile(wb,'学生档案.xlsx');
}

// ══════════════════════════════════
// IMPORT EXCEL
// ══════════════════════════════════
// 列名映射：支持你的Excel格式（25年/26年两套）
const COL_MAP = {
  '学生姓名':'name', '氏名':'name',
  '学生属性':'student_type',
  '来源':'source', '课程属性':'course_type',
  '困难点':'difficulty', '等级':'level',
  '日语成绩':'japanese_score', '日本語成绩':'japanese_score',
  '英语成绩':'english_score', '英語成绩':'english_score',
  '研究计划书':'research_plan', '研究計画書':'research_plan',
  '志望校':'target_school', '志望大学':'target_school',
  '出身大学':'university', '出身院校':'university',
  '学部':'faculty', '本科专业':'faculty', '出身专业':'faculty', '学部专业':'faculty',
  '卒論题目':'thesis', '毕业论文':'thesis', '毕业论文方向':'thesis',
  'GPA/其他履历':'gpa', 'GPA':'gpa', 'GPA/其他':'gpa',
  '毕业时间':'graduation_date',
  '期待入学时间':'target_enrollment', '進度/希望入学时间':'target_enrollment', '期待入学':'target_enrollment',
  '报名时间':'signup_date', '签约时间':'signup_date',
  '到期时间':'expiry_date', '截至日期':'expiry_date',
  '赴日时间':'japan_arrival',
  'テーマ':'research_plan',
  '状态':'status',
};
// 专业 sheet 名 → key
const SHEET_MAJOR_MAP = {
  '经营':'keiei','経営':'keiei','keiei':'keiei',
  '经济':'keizai','経済':'keizai','keizai':'keizai',
  '社会学':'shakai','shakai':'shakai',
  '新传':'shinpan','新闻':'shinpan','shinpan':'shinpan',
  '福祉':'fukushi','fukushi':'fukushi',
};

let importPendingRows = [];

function detectMajorFromSheet(sheetName) {
  const name = sheetName.toLowerCase();
  for (const [key, val] of Object.entries(SHEET_MAJOR_MAP)) {
    if (name.includes(key.toLowerCase())) return val;
  }
  return null;
}

function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const rows = [];
      // Try to find student info sheets
      const infoSheets = wb.SheetNames.filter(n =>
        n.includes('学生信息') || n.includes('大课') || n.includes('student') || n.includes('Student')
      );
      const sheetsToProcess = infoSheets.length ? infoSheets : wb.SheetNames.slice(0, 1);

      for (const sheetName of sheetsToProcess) {
        const ws = wb.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!data.length) continue;
        // detect major from sheet name or filename
        const major = detectMajorFromSheet(sheetName) || detectMajorFromSheet(file.name) || '';
        for (const row of data) {
          const s = { major, status: 'active' };
          let hasName = false;
          for (const [col, val] of Object.entries(row)) {
            const field = COL_MAP[col.trim()];
            if (!field || !val) continue;
            s[field] = String(val).trim();
            if (field === 'name') hasName = true;
          }
          if (!hasName || !s.name || s.name === '氏名') continue;
          rows.push(s);
        }
      }

      if (!rows.length) {
        alert('未能解析到学生数据，请检查文件格式。\n支持格式：含「学生姓名」或「氏名」列的 Excel。');
        return;
      }

      // Deduplicate against existing
      const existingNames = new Set(cachedStudents.map(s => s.name));
      importPendingRows = rows.map(r => ({ ...r, _exists: existingNames.has(r.name) }));

      showImportPreview();
    } catch (err) {
      alert('解析失败：' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function showImportPreview() {
  const newRows = importPendingRows.filter(r => !r._exists);
  const skipRows = importPendingRows.filter(r => r._exists);
  const preview = document.getElementById('importPreview');

  preview.innerHTML = `
    <div style="display:flex;gap:16px;margin-bottom:14px">
      <div style="background:var(--ok-bg);border-radius:3px;padding:8px 16px;font-size:12px">
        <strong style="color:var(--ok)">${newRows.length}</strong> <span style="color:var(--text-2)">条新记录将导入</span>
      </div>
      <div style="background:var(--warn-bg);border-radius:3px;padding:8px 16px;font-size:12px">
        <strong style="color:var(--warn)">${skipRows.length}</strong> <span style="color:var(--text-2)">条已存在将跳过</span>
      </div>
    </div>
    ${newRows.length ? `
    <div style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:3px">
      <table class="student-table" style="margin:0">
        <thead><tr>
          <th>姓名</th><th>专业</th><th>属性</th><th>来源</th><th>日语</th><th>英语</th><th>出身大学</th>
        </tr></thead>
        <tbody>
          ${newRows.map(r => `<tr>
            <td class="student-name-cell">${r.name}</td>
            <td>${MAJORS[r.major] || r.major || '<span style="color:var(--warn)">未识别</span>'}</td>
            <td style="font-size:11px">${r.student_type || ''}</td>
            <td style="font-size:11px">${r.source || ''}</td>
            <td style="font-size:11px">${r.japanese_score || ''}</td>
            <td style="font-size:11px">${r.english_score || ''}</td>
            <td style="font-size:11px">${r.university || ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:10px;font-size:11px;color:var(--text-3)">
      ⚠ 专业未识别的记录将以空白专业导入，可导入后手动编辑。
    </div>` : '<div class="empty">所有记录均已存在，无需导入。</div>'}
  `;
  document.getElementById('importConfirmBtn').disabled = !newRows.length;
  document.getElementById('importModal').classList.add('open');
}

async function confirmImport() {
  const newRows = importPendingRows.filter(r => !r._exists);
  if (!newRows.length) { closeModal('importModal'); return; }
  const btn = document.getElementById('importConfirmBtn');
  btn.textContent = '导入中…'; btn.disabled = true;
  const STUDENT_FIELDS = ['id','name','major','student_type','source','course_type','level','difficulty','japanese_score','english_score','university','faculty','gpa','thesis_topic','research_plan','target_school','graduation_date','target_enrollment','expiry_date','japan_arrival','status','notes'];
  const records = newRows.map((r,i) => {
    const rec = {};
    STUDENT_FIELDS.forEach(f => rec[f] = r[f] || (f==='status'?'active':f==='id'?`${Date.now()}-${i}-${Math.random().toString(36).slice(2,5)}`:''));
    return rec;
  });
  try {
    // batch insert in chunks of 50
    for (let i = 0; i < records.length; i += 50) {
      const chunk = records.slice(i, i + 50);
      const res = await sb('/rest/v1/students', 'POST', chunk);
      cachedStudents.push(...(Array.isArray(res) ? res : chunk));
    }
    closeModal('importModal');
    renderStudentsPage(document.getElementById('mainContent'));
    alert(`成功导入 ${records.length} 名学生！`);
  } catch (e) {
    alert('导入失败：' + e.message);
    btn.textContent = '确认导入'; btn.disabled = false;
  }
}

// ── 年度出愿情报视图 ──
async function renderSeasonView(mc, students, timelineMap) {
  // 拉取所有学生志望校
  const allPlans = await sb('/rest/v1/student_school_plans?select=*&order=level.asc').catch(()=>[]);
  const seasonLabel = { summer:'夏季', winter:'冬季', next_year:'次年' };
  const seasonTitle = s => s === 'unknown' ? '出愿时期未定' : `${seasonLabel[s]||s}出愿`;
  const levelLabel = { 1:'🔴 冲刺', 2:'🟡 匹配', 3:'🟢 保底' };
  const statusLabel = { preparing:'准备中', applied:'已出愿', passed:'✅ 合格', failed:'❌ 不合格' };

  // 按季度分组
  const seasonGroups = {};
  allPlans.forEach(p => {
    const key = p.exam_season || 'unknown';
    if (!seasonGroups[key]) seasonGroups[key] = {};
    // 按学校分组
    const schoolKey = `${p.school_name}|||${p.faculty||''}|||${p.department||''}`;
    if (!seasonGroups[key][schoolKey]) seasonGroups[key][schoolKey] = [];
    seasonGroups[key][schoolKey].push(p);
  });

  // 专业筛选后的学生ID集合
  const validStudentIds = new Set(students.map(s => s.id));

  const seasonOrder = ['summer','winter','next_year','unknown'];
  let html = `
  <div class="page-header">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <div class="section-title">考学进度</div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-sm btn-outline" onclick="progressViewMode='student';renderProgressPage(document.getElementById('mainContent'))">👤 学生视角</button>
        <button class="btn btn-sm btn-primary">📋 年度出愿情报</button>
      </div>
    </div>
  </div>
  <div class="filter-row">
    ${['all','keiei','keizai','shakai_group','shakai','shinpan','fukushi'].map((m,i)=>`<div class="filter-chip${stMajorFilter===m?' active':''}" onclick="setStMajor('${m}',this);renderProgressPage(document.getElementById('mainContent'))">${i===0?'全部专业':majorLabel(m)}</div>`).join('')}
  </div>`;

  if (!allPlans.length) {
    html += '<div style="text-align:center;padding:40px;color:var(--text-3)">暂无学生填写志望校数据</div>';
    mc.innerHTML = html;
    return;
  }

  seasonOrder.forEach(season => {
    const schools = seasonGroups[season];
    if (!schools) return;
    // 过滤掉不在当前专业筛选内的学生
    const filteredSchools = {};
    Object.entries(schools).forEach(([key, plans]) => {
      const filtered = plans.filter(p => validStudentIds.has(p.student_id));
      if (filtered.length) filteredSchools[key] = filtered;
    });
    if (!Object.keys(filteredSchools).length) return;

    const totalStudents = new Set(Object.values(filteredSchools).flat().map(p=>p.student_id)).size;
    html += `<div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:600;color:var(--text);padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:4px 4px 0 0;display:flex;align-items:center;gap:8px">
        📅 ${seasonTitle(season)}
        <span style="font-size:11px;font-weight:400;color:var(--text-3)">${totalStudents} 名学生</span>
      </div>
      <div style="border:1px solid var(--border);border-top:none;border-radius:0 0 4px 4px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead>
            <tr style="background:var(--bg)">
              <th style="padding:6px 10px;text-align:left;color:var(--text-3);font-weight:600;border-bottom:1px solid var(--border-light);width:140px">大学・研究科</th>
              <th style="padding:6px 10px;text-align:left;color:var(--text-3);font-weight:600;border-bottom:1px solid var(--border-light)">教授</th>
              <th style="padding:6px 10px;text-align:left;color:var(--text-3);font-weight:600;border-bottom:1px solid var(--border-light);width:80px">出愿期间</th>
              <th style="padding:6px 10px;text-align:left;color:var(--text-3);font-weight:600;border-bottom:1px solid var(--border-light)">学生（等级·状态）</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(filteredSchools).sort().map(([key, plans]) => {
              const [school, faculty, dept] = key.split('|||');
              const studentCells = plans.map(p =>
                `<span style="display:inline-block;background:${p.status==='passed'?'var(--ok-bg)':p.status==='failed'?'#fdecea':'var(--bg)'};border:1px solid var(--border-light);border-radius:2px;padding:1px 6px;margin:2px;font-size:10px">${p.student_name} <span style="color:var(--text-3)">${levelLabel[p.level]||''}</span>${p.status&&p.status!=='preparing'?` · ${statusLabel[p.status]}`:''}</span>`
              ).join('');
              const firstPlan = plans[0];
              return `<tr style="border-bottom:1px solid var(--border-light)">
                <td style="padding:8px 10px;vertical-align:top">
                  <div style="font-weight:600">${school}</div>
                  <div style="color:var(--text-3);font-size:10px">${[faculty,dept].filter(Boolean).join(' · ')}</div>
                </td>
                <td style="padding:8px 10px;vertical-align:top;color:var(--text-2)">${[...new Set(plans.map(p=>p.professor).filter(Boolean))].join('、') || '-'}</td>
                <td style="padding:8px 10px;vertical-align:top;color:var(--accent)">${firstPlan.application_period||'-'}</td>
                <td style="padding:8px 10px;vertical-align:top">${studentCells}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  });

  mc.innerHTML = html;
}
