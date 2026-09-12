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
let speEdits=null; // 老师修改记录（未处理）

function renderStudentsPage(mc){
  if(speEdits===null){
    speEdits=[];
    sb('/rest/v1/student_profile_edits?restored=is.false&select=*&order=created_at.desc&limit=100')
      .then(r=>{speEdits=r||[];speRenderBar();}).catch(()=>{});
  }
  let list=cachedStudents;
  // 视角过滤（叠加逻辑）：非总览时，主专业或附加专业任一属于当前领域/专业即可见
  list=list.filter(s=>studentInCurrentView(s));
  const viewTotal=list.length; // 当前视角学生总数（不受下方专业/状态/搜索筛选影响）
  if(stMajorFilter!=='all') list=list.filter(s=>{
    // 主专业匹配，或附加专业(extra_majors,如日语/英语)匹配——叠加逻辑
    if(matchesMajorFilter(s.major,stMajorFilter)) return true;
    return (s.extra_majors||[]).some(m=>matchesMajorFilter(m,stMajorFilter));
  });
  if(stStatus!=='all') list=list.filter(s=>s.status===stStatus);
  if(stVipFilter==='vip_only') list=list.filter(s=>s.is_vip_course==='VIP'||s.is_vip_course==='大课+VIP');
  if(stVipFilter==='vip_exclusive') list=list.filter(s=>s.is_vip_course==='VIP');
  if(stSearch) list=list.filter(s=>matchesStudentSearch(s,stSearch));
  const statusLabel=(v)=>({active:'在籍',graduated:'已合格',expired:'已到期',stopped:'停课',withdrawn:'退学'}[v]||v);
  const statusColor=(v)=>v==='active'?'var(--ok)':v==='graduated'?'#1a6a9a':v==='withdrawn'?'var(--danger)':'var(--text-3)';
  const statusBg=(v)=>v==='active'?'var(--ok-bg)':v==='graduated'?'#e8f4fd':v==='withdrawn'?'#fdecea':'var(--border)';
  mc.innerHTML=`
  <div id="spe_bar"></div>
  ${(setTimeout(()=>speRenderBar(),0),'')}
  <div class="page-header">
    <div class="section-title">学生档案 <span class="badge-count">${viewTotal}</span></div>
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
    ${majorFilterKeys({includeAll:true}).map((m,i)=>`<div class="filter-chip${stMajorFilter===m?' active':''}" onclick="setStMajor('${m}',this)">${i===0?'全部专业':majorLabel(m)}</div>`).join('')}
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

// 学生档案-语言附加选择（与主专业叠加）。存进 extra_majors 数组。
let stExtraLangs = [];
function toggleStLang(code){
  const i=stExtraLangs.indexOf(code);
  if(i>=0) stExtraLangs.splice(i,1); else stExtraLangs.push(code);
  ['nihongo','eigo'].forEach(c=>{
    const el=document.getElementById('st_lang_'+c);
    if(el) el.classList.toggle('active', stExtraLangs.includes(c));
  });
}
function setStLangs(arr){
  stExtraLangs = Array.isArray(arr)?arr.slice():[];
  ['nihongo','eigo'].forEach(c=>{
    const el=document.getElementById('st_lang_'+c);
    if(el) el.classList.toggle('active', stExtraLangs.includes(c));
  });
}

function openStudentModal(id){
  const s=id?cachedStudents.find(x=>x.id===id):null;
  document.getElementById('studentModalTitle').textContent=s?'编辑学生':'添加学生';
  document.getElementById('studentId').value=s?.id||'';
  populateMajorSelect('st_major', s?.major||'');
  setStLangs(s?.extra_majors||[]);
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
  renderStudentVipPlans(s);
}

// ── VIP 课程方案关联（在籍关联）──
let stVipPlanList = [];   // 当前学生匹配到的方案
async function renderStudentVipPlans(s) {
  const box = document.getElementById('st_vip_plan_section');
  const wrap = document.getElementById('st_vip_plan_wrap');
  if (!box) return;
  if (!s || !s.id) {   // 新增学生：先保存后才能关联
    if (wrap) wrap.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  if (wrap) wrap.style.display = '';
  box.innerHTML = '<span style="color:var(--text-3)">加载中…</span>';
  const name = (s.name || '').trim();
  // 按姓名取方案：已关联到本学生的 + 未关联的（可关联）
  const plans = await sb(`/rest/v1/vip_student_plans?student_name=eq.${encodeURIComponent(name)}&select=*&order=created_at.desc`).catch(() => []);
  stVipPlanList = plans;
  const linked = plans.filter(p => p.student_id === s.id);
  const avail = plans.filter(p => !p.student_id);

  const stLabel = { signed: '已签约', pending: '待老师确认', confirmed: '老师已确认' };
  const planLine = (p, mode) => {
    const hoursTxt = `${p.total_sessions || 0}回/${p.total_hours || 0}课时${(p.subject_hours && p.subject_hours > 0) ? '（含专业知识' + p.subject_hours + '）' : ''}`;
    const btn = mode === 'linked'
      ? `<button type="button" onclick="unlinkVipPlan('${p.id}')" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:3px;padding:2px 8px;cursor:pointer;color:var(--text-3)">解除关联</button>`
      : `<button type="button" onclick="linkVipPlan('${p.id}')" style="font-size:10px;background:var(--accent,#1a1814);color:#fff;border:none;border-radius:3px;padding:2px 10px;cursor:pointer">关联到该学生</button>`;
    const delBtn = `<button type="button" onclick="deleteVipStudentPlan('${p.id}')" title="删除方案" style="font-size:10px;background:none;border:1px solid #e0b0a0;border-radius:3px;padding:2px 8px;cursor:pointer;color:#a33">删除</button>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface,#fff);margin-bottom:5px">
      <div style="min-width:0"><span style="font-weight:600">${(typeof majorLabel === 'function' ? majorLabel(p.major) : p.major) || ''}</span>　<span style="color:var(--text-2)">${hoursTxt}</span>　<span style="color:var(--text-3);font-size:10px">${stLabel[p.status] || p.status}</span></div>
      <div style="display:flex;gap:6px;flex-shrink:0">${btn}${delBtn}</div>
    </div>`;
  };

  let html = '';
  if (linked.length) html += '<div style="color:#1a4a28;margin-bottom:4px">已关联：</div>' + linked.map(p => planLine(p, 'linked')).join('');
  if (avail.length) html += `<div style="color:var(--text-3);margin:6px 0 4px">可关联（同名方案）：</div>` + avail.map(p => planLine(p, 'avail')).join('');
  if (!linked.length && !avail.length) html += '<span style="color:var(--text-3)">暂无匹配的 VIP 方案</span>';
  const addBtn = (typeof openStudentPlanBuilder === 'function')
    ? '<div style="margin-top:8px"><button type="button" onclick="openStudentPlanBuilder()" style="font-size:11px;background:var(--accent,#1a1814);color:#fff;border:none;border-radius:3px;padding:5px 12px;cursor:pointer">＋ 添加VIP方案（直接为该学生建）</button></div>'
    : '';
  box.innerHTML = html + addBtn;
}

async function linkVipPlan(planId) {
  const sid = document.getElementById('studentId').value;
  if (!sid) { alert('请先保存学生再关联'); return; }
  const p = stVipPlanList.find(x => x.id === planId);
  try {
    await sb(`/rest/v1/vip_student_plans?id=eq.${planId}`, 'PATCH', { student_id: sid });
    if (p) {
      p.student_id = sid;
      // 便捷回填：VIP总课时（若为空）+ 把方案里的老师加入 VIP 指导老师
      const totalEl = document.getElementById('st_vip_total');
      if (totalEl && (!parseFloat(totalEl.value) || parseFloat(totalEl.value) === 0) && p.total_hours) totalEl.value = p.total_hours;
      const courseEl = document.getElementById('st_vip_course');
      if (courseEl && courseEl.value === '大课') courseEl.value = '大课+VIP';
      if (p.assigned_teachers && p.assigned_teachers.length) {
        p.assigned_teachers.forEach(n => { if (!vipTeacherTags.includes(n)) vipTeacherTags.push(n); });
        if (typeof renderVipTeacherTags === 'function') renderVipTeacherTags();
      }
    }
    const s = cachedStudents.find(x => x.id === sid);
    renderStudentVipPlans(s);
    alert('已关联。记得点「保存」以确认课时/老师等回填。');
  } catch (e) { alert('关联失败：' + e.message); }
}

async function deleteVipStudentPlan(planId) {
  const p = stVipPlanList.find(x => x.id === planId);
  if (!confirm(`确认彻底删除该 VIP 方案${p ? '（' + (p.total_sessions || 0) + '回/' + (p.total_hours || 0) + '课时）' : ''}？此操作不可撤销。`)) return;
  try {
    await sb(`/rest/v1/vip_student_plans?id=eq.${planId}`, 'DELETE');
    stVipPlanList = stVipPlanList.filter(x => x.id !== planId);
    const sid = document.getElementById('studentId').value;
    const s = cachedStudents.find(x => x.id === sid);
    renderStudentVipPlans(s || { id: sid, name: (document.getElementById('st_name') || {}).value });
  } catch (e) { alert('删除失败：' + e.message); }
}

async function unlinkVipPlan(planId) {
  if (!confirm('确认解除该方案与此学生的关联？')) return;
  try {
    await sb(`/rest/v1/vip_student_plans?id=eq.${planId}`, 'PATCH', { student_id: null });
    const p = stVipPlanList.find(x => x.id === planId);
    if (p) p.student_id = null;
    const sid = document.getElementById('studentId').value;
    const s = cachedStudents.find(x => x.id === sid);
    renderStudentVipPlans(s);
  } catch (e) { alert('解除失败：' + e.message); }
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
  const label=prompt('请输入新专业名称（中文），例如：观光学');
  if(!label||!label.trim()) return;
  // 代号统一用日语罗马音（与全站专业代码风格一致，避免拼音/英文混用）
  const romaji=prompt(`请输入「${label.trim()}」的日语罗马音，作为系统代号。\n\n例如：观光学→kankou，经营学→keiei，社会学→shakai。\n\n规则：只能小写字母/数字/下划线，以字母开头。`);
  if(romaji===null) return; // 用户取消
  if(!romaji.trim()){ alert('必须输入日语罗马音代号'); return; }
  const key=await createMajor(label.trim(), romaji.trim());
  if(key){
    populateMajorSelect('st_major', key);
    alert(`已新增专业「${label.trim()}」，代号：${key}\n现在全站（课程/老师/预约/学生档案等）都能选到它了。`);
  }
}

async function saveStudent(){
  const name=document.getElementById('st_name').value.trim();
  const major=document.getElementById('st_major').value;
  if(!name){alert('请填写姓名');return}
  const id=document.getElementById('studentId').value;
  const data={
    name,major,
    extra_majors:stExtraLangs.slice(),
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
  // 视角过滤（叠加逻辑）：非总览时按学生主专业+附加专业判断
  students=students.filter(s=>studentInCurrentView(s));
  if(stMajorFilter!=='all') students=students.filter(s=>matchesMajorFilter(s.major,stMajorFilter));
  if(progressStudentFilter) students=students.filter(s=>matchesStudentSearch(s,progressStudentFilter));

  const [allTimeline, allPlansPG, allDraftsPG, allBkPG] = await Promise.all([
    sb('/rest/v1/student_progress_timeline?select=*&order=created_at.asc&limit=5000').catch(()=>[]),
    sb('/rest/v1/student_school_plans?select=*&order=level.asc&limit=5000').catch(()=>[]),
    sb('/rest/v1/student_plan_drafts?select=*&limit=5000').catch(()=>[]),
    sb('/rest/v1/bookings?select=name,major,target_school,slot_date,exam_period&order=slot_date.desc&limit=5000').catch(()=>[]),
  ]);
  // 面谈里提到的目标校（学生尚未填志望校时作为线索提取）
  const bkHintMap = {};
  (allBkPG||[]).forEach(b => {
    if (!b.name || !String(b.target_school||'').trim()) return;
    if (!bkHintMap[b.name]) bkHintMap[b.name] = { schools:new Set(), date:b.slot_date, exam_period:b.exam_period };
    String(b.target_school).split(/[、,，\/\n]+/).map(x=>x.trim()).filter(x=>x && /大学|学院/.test(x)).forEach(x=>bkHintMap[b.name].schools.add(x));
  });
  const timelineMap = {};
  allTimeline.forEach(t => {
    if (!timelineMap[t.student_id]) timelineMap[t.student_id] = [];
    timelineMap[t.student_id].push(t);
  });
  const plansMapPG = {}, draftsMapPG = {};
  allPlansPG.forEach(p => { if (!plansMapPG[p.student_id]) plansMapPG[p.student_id] = []; plansMapPG[p.student_id].push(p); });
  window.__spPlansAll = allPlansPG; // 供志望校编辑弹窗读取
  allDraftsPG.forEach(d => { if (!draftsMapPG[d.student_id]) draftsMapPG[d.student_id] = d; });
  window.__pgDraftsMap = draftsMapPG;   // 供计划书查看/导出使用
  window.__pgStudents = students;

  const cards = students.map(s => {
    const timeline = timelineMap[s.id] || [];
    const latest = getLatestProgress(timeline);
    const isFocus = focusStudentId === s.id;

    // 志望校/计划书数据先算好（供状态推导用）
    const sPlans = plansMapPG[s.id] || [];
    const sDraft = draftsMapPG[s.id];
    let sRefsN = 0, sDraftN = 0;
    try {
      sRefsN = sDraft && sDraft.prior_research_list ? JSON.parse(sDraft.prior_research_list).length : 0;
      const df0 = sDraft && sDraft.draft_fields ? JSON.parse(sDraft.draft_fields) : {};
      sDraftN = Object.values(df0).filter(v => Array.isArray(v) ? v.length : String(v || '').trim()).length;
    } catch(e) {}
    const anyPassed = sPlans.some(p => p.status === 'passed');
    const anyApplied = sPlans.some(p => ['applied', 'passed'].includes(p.status));
    const pgDerived = {};
    if (anyPassed) pgDerived.apply = '已合格';
    else if (anyApplied) pgDerived.apply = '已出愿';
    else if (sPlans.some(p => ['prof_ok', 'contacted'].includes(p.status))) pgDerived.apply = '联系教授中';
    else if (sPlans.length) pgDerived.apply = '择校确认中';
    if (sPlans.some(p => p.interview_draft_done)) pgDerived.exam = '在准备面试稿';
    else if (sPlans.some(p => p.kakomon_started)) pgDerived.exam = '在写过去问';
    const sLegacy = sDraft && ['research_question', 'methodology', 'draft_notes'].some(f => String(sDraft[f] || '').trim());
    if (sDraft && sDraft.draft_file_url) pgDerived.plan = '已完成';
    else if (sDraftN > 0 || sLegacy) pgDerived.plan = '撰写中';
    else if (sRefsN > 0) pgDerived.plan = '在收集材料';

    const spChip = (icon, text, done) => `<span style="font-size:10px;padding:2px 9px;border-radius:10px;white-space:nowrap;background:${done ? 'var(--ok-bg,#e8f4ea)' : 'var(--bg,#f7f5f0)'};color:${done ? 'var(--ok,#2a5a30)' : 'var(--text-2,#5a5650)'};border:1px solid ${done ? 'var(--ok,#b8d8bc)' : 'var(--border-light,#ede9e2)'}">${icon} ${text}</span>`;
    const statusRow = Object.entries(PROGRESS_LABELS).map(([k]) => {
      let val, done;
      if (k === 'apply') { val = anyPassed ? '已合格' : (latest.apply || pgDerived.apply || ''); done = anyPassed || latest.apply === '已合格'; }
      else if (k === 'japanese') { val = latest[k] || (s.japanese_score ? '有成绩' : ''); done = isProgressDone(k, latest[k]); }
      else if (k === 'english') { val = latest[k] || (s.english_score ? '有成绩' : ''); done = isProgressDone(k, latest[k]); }
      else { val = latest[k] || pgDerived[k] || ''; done = isProgressDone(k, latest[k]); }
      if (!val) return '';
      const scoreText = k === 'japanese' && s.japanese_score ? ` · ${s.japanese_score}` : k === 'english' && s.english_score ? ` · ${s.english_score}` : '';
      return spChip(PROGRESS_ICONS[k], val + scoreText, done);
    }).join('');
    const secTitle = t => `<div style="font-size:11px;font-weight:600;color:var(--text-2);letter-spacing:.02em;margin-bottom:10px">${t}</div>`;
    const secFrame = inner => `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:6px;padding:12px 14px">${inner}</div>`;


    const pgDetail = k => {
      if (k === 'plan') {
        const parts = [];
        if (sRefsN) parts.push(`📚 先行研究 ${sRefsN} 条`);
        if (sDraftN) parts.push(`草稿已填 ${sDraftN} 项`);
        if (sDraft && sDraft.draft_file_url) parts.push('📎 完成稿已上传');
        const btn = sDraft ? `<button onclick="openAdminDraftView('${s.id}')" style="font-size:9px;margin-top:4px;background:none;border:1px solid var(--accent);color:var(--accent);border-radius:3px;padding:1px 8px;cursor:pointer;font-family:inherit">查看/下载计划书</button>` : '';
        return (parts.length || btn) ? `<div style="font-size:10px;color:var(--text-2);margin-top:4px;line-height:1.7">${parts.join(' · ')}${btn ? '<br>' + btn : ''}</div>` : '';
      }
      if (k === 'apply') {
        if (!sPlans.length) return '';
        return `<div style="margin-top:4px">${sPlans.map(p => {
          const st = schoolStatusLabel(p.status);
          const passBtn = p.status==='passed' ? ` <button onclick='openAdmissionEntry(${JSON.stringify({school:p.school_name||'',faculty:p.faculty||'',dept:p.department||'',student:s.name||'',jp:s.japanese_score||'',en:s.english_score||'',major:s.major||'',enroll:s.target_enrollment||''}).replace(/'/g,"&#39;")})' style="font-size:9px;padding:1px 6px;border:1px solid var(--accent,#8b5cf6);color:var(--accent,#8b5cf6);background:none;border-radius:3px;cursor:pointer;margin-left:4px">📝录入合格实绩</button>` : '';
          return `<div style="font-size:10px;line-height:1.7"><span style="color:var(--text-2)">${p.school_name}${p.professor ? ' · ' + p.professor : ''}</span> — <span style="color:${st.c}">${st.t}</span>${passBtn}</div>`;
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
    // 每个维度最近一条时间线的来源（用于「数据来源」列）
    const srcOf = k => {
      for (let i = timeline.length - 1; i >= 0; i--) if (timeline[i][k]) return timeline[i].source || '记录';
      return null;
    };
    const SRC_LABEL = { student:'学生填写', teacher:'老师面谈', admin:'admin录入', booking:'面谈记录' };
    const dimCards = Object.entries(PROGRESS_LABELS).map(([k,label]) => {
      const score = k === 'japanese' ? s.japanese_score : k === 'english' ? s.english_score : '';
      const src = latest[k] ? (SRC_LABEL[srcOf(k)] || srcOf(k) || '记录') : pgDerived[k] ? '按填写推导' : '';
      const badge = latest[k] ? renderProgressBadge(k, latest[k])
        : pgDerived[k] ? renderProgressBadge(k, pgDerived[k])
        : '<span style="font-size:10px;color:var(--text-3)">未填写</span>';
      return `<tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:5px 8px;white-space:nowrap;color:var(--text-2)">${PROGRESS_ICONS[k]} ${label}</td>
        <td style="padding:5px 8px">${badge}${score?`<span style="font-size:10px;color:var(--text-2);margin-left:6px">${score}</span>`:''}</td>
        <td style="padding:5px 8px;font-size:9px;color:var(--text-3);white-space:nowrap">${src||'—'}</td>
        <td style="padding:5px 8px;font-size:10px;color:var(--text-2)">${(pgDetail(k)||'').replace(/margin-top:4px/g,'margin-top:0')||'—'}</td>
      </tr>`;
    }).join('');

    const timelineHtml = timeline.length
      ? [...timeline].reverse().map(entry =>
          renderProgressTimelineEntry(entry, true, `editProgressEntry('${entry.id}','${s.id}','${s.name}','${s.major}')`)
        ).join('')
      : '<div style="font-size:11px;color:var(--text-3);padding:8px 0">暂无进度记录</div>';

    const hintHtml = (() => {
      const hint = bkHintMap[s.name];
      if (!hint) return '';
      const known = new Set(sPlans.map(p => (p.school_name || '').trim()));
      const news = [...hint.schools].filter(x => ![...known].some(k => k.includes(x) || x.includes(k)));
      if (!news.length) return '';
      return `<div style="background:var(--warn-bg,#f8f0d8);border:1px solid var(--warn,#b8860b);border-radius:4px;padding:7px 10px;margin-bottom:8px;font-size:10px;color:#6a5210">
        💡 面谈记录中提到过（${hint.date || ''}）：${news.map(x => `<span style="background:var(--surface);border-radius:3px;padding:1px 6px;margin:0 3px">${x}</span>`).join('')}
        <button onclick="event.stopPropagation();spSchoolFromHint('${s.id}','${(s.name || '').replace(/'/g, '')}','${s.major || ''}',${JSON.stringify(news).replace(/"/g, '&quot;')})" style="margin-left:6px;font-size:10px;background:var(--warn,#b8860b);color:#fff;border:none;border-radius:3px;padding:2px 10px;cursor:pointer;font-family:inherit">一键加入志望校</button>
      </div>`;
    })();
    const schoolTable = sPlans.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:var(--bg)">
          ${['No.', '级别', '学校名 · 研究科', '教授', '出愿期间', '该校进度', '过去问', '面试稿', ''].map(h => `<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--text-3);border-bottom:1px solid var(--border-light);white-space:nowrap">${h}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${sPlans.map((p, pi) => { const st = schoolStatusLabel(p.status); return `<tr style="border-bottom:1px solid var(--border-light)">
            <td style="padding:6px 8px;color:var(--text-3)">${pi + 1}</td>
            <td style="padding:6px 8px;white-space:nowrap">${schoolLevelHtml(p.level)}</td>
            <td style="padding:6px 8px"><span style="font-weight:600">${p.school_name || ''}</span>${p.faculty ? `<span style="color:var(--text-3);margin-left:4px;font-size:10px">${p.faculty}</span>` : ''}</td>
            <td style="padding:6px 8px;white-space:nowrap">${p.professor || '—'}</td>
            <td style="padding:6px 8px;font-size:10px;color:var(--accent);white-space:nowrap">${p.application_period || '—'}</td>
            <td style="padding:6px 8px">
              <select onchange="event.stopPropagation();spPlanSet('${p.id}','status',this.value,this)" onclick="event.stopPropagation()" style="font-size:10px;padding:3px 5px;border:1px solid var(--border);border-radius:3px;background:var(--surface);font-family:inherit;color:${st.c};font-weight:600">
                ${Object.entries(SCHOOL_STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v.t}</option>`).join('')}
              </select>
            </td>
            <td style="padding:6px 8px"><button onclick="event.stopPropagation();spPlanFlag('${p.id}','kakomon_started',this)" data-on="${p.kakomon_started ? '1' : '0'}" style="font-size:10px;border-radius:3px;padding:3px 9px;cursor:pointer;font-family:inherit;border:1px solid ${p.kakomon_started ? 'var(--ok)' : 'var(--border)'};background:${p.kakomon_started ? 'var(--ok-bg)' : 'var(--surface)'};color:${p.kakomon_started ? 'var(--ok)' : 'var(--text-3)'}">${p.kakomon_started ? '✓ 已开始' : '未开始'}</button></td>
            <td style="padding:6px 8px"><button onclick="event.stopPropagation();spPlanFlag('${p.id}','interview_draft_done',this)" data-on="${p.interview_draft_done ? '1' : '0'}" style="font-size:10px;border-radius:3px;padding:3px 9px;cursor:pointer;font-family:inherit;border:1px solid ${p.interview_draft_done ? 'var(--ok)' : 'var(--border)'};background:${p.interview_draft_done ? 'var(--ok-bg)' : 'var(--surface)'};color:${p.interview_draft_done ? 'var(--ok)' : 'var(--text-3)'}">${p.interview_draft_done ? '✓ 已完成' : '未完成'}</button></td>
            <td style="padding:6px 8px;white-space:nowrap"><span onclick="event.stopPropagation();spSchoolEdit('${p.id}')" style="font-size:10px;color:var(--accent);cursor:pointer;margin-right:6px">编辑</span><span onclick="event.stopPropagation();spSchoolDel('${p.id}')" style="font-size:10px;color:var(--danger);cursor:pointer">删除</span></td>
          </tr>`; }).join('')}
        </tbody>
      </table></div>` : '<div style="font-size:11px;color:var(--text-3)">尚无志望校记录，可点击右上「＋ 添加志望校」录入</div>';
    const guaranteedFrame = (s.course_type || '').includes('保录') ? secFrame(
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <span style="font-size:11px;font-weight:600;color:#8a5010">🎓 保录学校 <span style="font-weight:400;color:var(--text-3)">保录方案专用名单，独立于志望校</span></span>
        <button onclick="event.stopPropagation();gsAdd('${s.id}')" style="margin-left:auto;font-size:10px;background:#8a5010;color:#fff;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;font-family:inherit">＋ 添加保录学校</button>
      </div><div id="gs_list_${s.id}">${gsRenderList(s.id)}</div>`) : '';

    return `<div style="background:var(--surface);border:1px solid ${isFocus ? 'var(--accent)' : 'var(--border)'};border-radius:6px;overflow:hidden;margin-bottom:10px;box-shadow:0 1px 2px rgba(0,0,0,.03)">
      <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer" onclick="toggleProgressCard('${s.id}')">
        <div style="flex:1;min-width:0">
          <span style="font-size:13px;font-weight:600">${s.name}</span>
          <span style="font-size:11px;color:var(--text-3);margin-left:8px">${MAJORS[s.major] || s.major || ''}</span>
          ${s.target_enrollment ? `<span style="font-size:10px;color:var(--text-3);margin-left:8px">目标 ${s.target_enrollment}</span>` : ''}
        </div>
        <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;justify-content:flex-end;max-width:60%">
          ${statusRow || '<span style="font-size:10px;color:var(--text-3)">暂无记录</span>'}
        </div>
        <span class="sp-arr" style="font-size:11px;color:var(--text-3);flex-shrink:0">${isFocus ? '▾' : '▸'}</span>
      </div>
      <div id="prog_${s.id}" style="display:${isFocus ? 'block' : 'none'};border-top:1px solid var(--border-light);background:var(--bg)">
        <div style="padding:14px;display:flex;flex-direction:column;gap:12px">
          ${secFrame(`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <span style="font-size:11px;font-weight:600;color:var(--text-2)">📊 当前进度</span>
              <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openAddProgressEntry('${s.id}','${s.name}','${s.major}')">＋ 更新进度</button>
            </div>
            <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">
              <thead><tr style="background:var(--bg)">${['项目', '现状', '数据来源', '详情'].map(h => `<th style="padding:5px 8px;text-align:left;font-weight:600;color:var(--text-3);border-bottom:1px solid var(--border-light);white-space:nowrap">${h}</th>`).join('')}</tr></thead>
              <tbody>${dimCards}</tbody>
            </table></div>`)}
          ${secFrame(`<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
              <span style="font-size:11px;font-weight:600;color:var(--text-2)">🏫 志望校 <span style="font-weight:400;color:var(--text-3)">（${sPlans.length}所）· 状态/过去问/面试稿可直接改，即时保存</span></span>
              <button onclick="event.stopPropagation();spSchoolAdd('${s.id}','${(s.name || '').replace(/'/g, '')}','${s.major || ''}')" style="margin-left:auto;font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;font-family:inherit">＋ 添加志望校</button>
            </div>${hintHtml}${schoolTable}`)}
          ${guaranteedFrame}
          ${secFrame(`<div onclick="event.stopPropagation();spNotesToggle('${s.id}','${(s.name || '').replace(/'/g, '')}',this)" style="font-size:11px;font-weight:600;color:var(--text-2);cursor:pointer;user-select:none">📝 老师评估记录 <span style="font-weight:400;color:var(--text-3)">（学生不可见）</span><span class="arr" style="margin-left:4px;color:var(--text-3)">▸</span></div><div id="spnotes_${s.id}" style="display:none;margin-top:10px"></div>`)}
          ${secFrame(`<div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:10px">🕑 进度时间线 <span style="font-weight:400;color:var(--text-3)">${timeline.length} 条</span></div>${timelineHtml}`)}
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
        <button class="btn btn-sm btn-outline" onclick="exportAllPlanDrafts()" title="导出当前筛选范围内所有学生的先行研究与计划书信息">⬇ 导出计划书数据</button>
        <button class="btn btn-sm btn-outline" onclick="renderAdmissionResultsDedup(document.getElementById('mainContent'))" title="查看合格数据库中疑似重复录入的记录（姓名+大学名+语言成绩任一项重复）">🔍 合格记录查重</button>
      </div>
    </div>
  </div>
  <div class="filter-row">
    ${majorFilterKeys({includeAll:true}).map((m,i)=>`<div class="filter-chip${stMajorFilter===m?' active':''}" onclick="setStMajor('${m}',this);renderProgressPage(document.getElementById('mainContent'))">${i===0?'全部专业':majorLabel(m)}</div>`).join('')}
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
  if(!el) return;
  const open=el.style.display==='none';
  el.style.display=open?'block':'none';
  const hdr=el.previousElementSibling;
  const arr=hdr&&hdr.querySelector('.sp-arr');
  if(arr) arr.textContent=open?'▾':'▸';
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
  '学生姓名':'name', '氏名':'name', '姓名':'name',
  '学生属性':'student_type', '属性':'student_type',
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
  '期待入学时间':'target_enrollment', '進度/希望入学时间':'target_enrollment', '期待入学':'target_enrollment', '入学目标':'target_enrollment',
  '报名时间':'signup_date', '签约时间':'signup_date',
  '到期时间':'expiry_date', '截至日期':'expiry_date',
  '赴日时间':'japan_arrival',
  'テーマ':'research_plan',
  '状态':'status',
  '备注':'notes', '備考':'notes',
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

// Excel 日期序列号（自1899-12-30起的天数）→ "YYYY/M/D" 文本
function excelSerialToDate(serial) {
  if (!serial || serial < 1 || serial > 60000) return String(serial);
  const ms = Math.round((serial - 25569) * 86400 * 1000); // 25569 = 1970-01-01 的 Excel 序列号
  const d = new Date(ms);
  if (isNaN(d.getTime())) return String(serial);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function detectMajorFromSheet(sheetName) {
  const name = sheetName.toLowerCase();
  for (const [key, val] of Object.entries(SHEET_MAJOR_MAP)) {
    if (name.includes(key.toLowerCase())) return val;
  }
  // 兜底：用 MAJORS 反查，支持数据库新增专业（sheet 名为中文专业名时）
  const k = (typeof majorKeyFromText === 'function') ? majorKeyFromText(sheetName) : '';
  return k || null;
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
            const c = col.trim();
            if (c === '专业' && val) { // 导出的"专业"是标签，反查成 key
              const key = (typeof MAJORS !== 'undefined') ? Object.keys(MAJORS).find(k => MAJORS[k] === String(val).trim()) : null;
              if (key) s.major = key;
              continue;
            }
            const field = COL_MAP[c];
            if (!field || !val) continue;
            const DATE_FIELDS = ['signup_date', 'expiry_date', 'graduation_date', 'japan_arrival', 'target_enrollment'];
            if (DATE_FIELDS.includes(field) && /^\d{4,6}(\.\d+)?$/.test(String(val).trim())) {
              s[field] = excelSerialToDate(Number(val)); // Excel 日期序列号 → 文本
            } else {
              s[field] = String(val).trim();
            }
            if (field === 'name') hasName = true;
          }
          if (!hasName || !s.name || s.name === '氏名') continue;
          rows.push(s);
        }
      }

      if (!rows.length) {
        alert('未能解析到学生数据，请检查文件格式。\n支持格式：含「姓名」「学生姓名」或「氏名」列的 Excel。');
        return;
      }

      // 匹配已有学生（按姓名），记录其 id 以便更新
      const existingByName = new Map(cachedStudents.map(s => [s.name, s]));
      importPendingRows = rows.map(r => {
        const ex = existingByName.get(r.name);
        return { ...r, _exists: !!ex, _existingId: ex ? ex.id : null };
      });

      showImportPreview();
    } catch (err) {
      alert('解析失败：' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function showImportPreview() {
  const newRows = importPendingRows.filter(r => !r._exists);
  const updRows = importPendingRows.filter(r => r._exists);
  const preview = document.getElementById('importPreview');
  const willUpdate = importMode === 'both';

  const modeBtn = (m, label, desc) => `<div onclick="importMode='${m}';showImportPreview()" style="flex:1;cursor:pointer;border:1px solid ${importMode===m?'var(--accent)':'var(--border)'};background:${importMode===m?'var(--accent)':'var(--surface)'};color:${importMode===m?'#fff':'var(--text-2)'};border-radius:4px;padding:8px 12px;font-size:12px">
    <div style="font-weight:600">${importMode===m?'✓ ':''}${label}</div><div style="font-size:10px;opacity:.85;margin-top:2px">${desc}</div></div>`;

  preview.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px">
      ${modeBtn('both','新增 + 更新已存在','已有学生用表格数据覆盖，新学生新增')}
      ${modeBtn('new','仅新增','已存在的跳过，只导入新学生')}
    </div>
    <div style="display:flex;gap:16px;margin-bottom:14px">
      <div style="background:var(--ok-bg);border-radius:3px;padding:8px 16px;font-size:12px">
        <strong style="color:var(--ok)">${newRows.length}</strong> <span style="color:var(--text-2)">条新增</span>
      </div>
      <div style="background:${willUpdate?'var(--ok-bg)':'var(--warn-bg)'};border-radius:3px;padding:8px 16px;font-size:12px">
        <strong style="color:${willUpdate?'var(--ok)':'var(--warn)'}">${updRows.length}</strong> <span style="color:var(--text-2)">条已存在将${willUpdate?'更新覆盖':'跳过'}</span>
      </div>
    </div>
    ${willUpdate&&updRows.length?`<div style="font-size:11px;color:var(--text-3);margin-bottom:10px;background:var(--bg);border-radius:3px;padding:8px 10px">🔄 更新说明：按姓名匹配已有学生，用表格里<b>非空</b>的单元格覆盖对应字段（空单元格保留原值，不会清空）。专业列只在能识别时更新。</div>`:''}
    ${(newRows.length||(willUpdate&&updRows.length)) ? `
    <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:3px">
      <table class="student-table" style="margin:0">
        <thead><tr>
          <th>姓名</th><th>处理</th><th>专业</th><th>报名时间</th><th>到期时间</th><th>日语</th><th>英语</th>
        </tr></thead>
        <tbody>
          ${importPendingRows.filter(r=>!r._exists||willUpdate).slice(0,300).map(r => `<tr>
            <td class="student-name-cell">${r.name}</td>
            <td style="font-size:11px;color:${r._exists?'var(--accent)':'var(--ok)'}">${r._exists?'更新':'新增'}</td>
            <td>${MAJORS[r.major] || r.major || '<span style="color:var(--warn)">未识别</span>'}</td>
            <td style="font-size:11px">${r.signup_date || ''}</td>
            <td style="font-size:11px">${r.expiry_date || ''}</td>
            <td style="font-size:11px">${r.japanese_score || ''}</td>
            <td style="font-size:11px">${r.english_score || ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<div class="empty">没有需要处理的记录。</div>'}
  `;
  document.getElementById('importConfirmBtn').disabled = !(newRows.length || (willUpdate && updRows.length));
  document.getElementById('importModal').classList.add('open');
}

let importMode = 'both'; // both=新增+更新 | new=仅新增

async function confirmImport() {
  const newRows = importPendingRows.filter(r => !r._exists);
  const updRows = importPendingRows.filter(r => r._exists);
  const doUpdate = importMode === 'both';
  if (!newRows.length && !(doUpdate && updRows.length)) { closeModal('importModal'); return; }
  const btn = document.getElementById('importConfirmBtn');
  btn.textContent = '处理中…'; btn.disabled = true;
  // 可导入/更新的字段（与列映射一致；major 单独处理）
  const FIELDS = ['student_type','source','course_type','level','difficulty','japanese_score','english_score','university','faculty','gpa','thesis','research_plan','target_school','graduation_date','target_enrollment','signup_date','expiry_date','japan_arrival','status','notes'];
  try {
    // ① 新增
    const records = newRows.map((r, i) => {
      const rec = { id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`, name: r.name, major: r.major || '', status: r.status || 'active' };
      FIELDS.forEach(f => { if (r[f]) rec[f] = r[f]; });
      return rec;
    });
    for (let i = 0; i < records.length; i += 50) {
      const chunk = records.slice(i, i + 50);
      const res = await sb('/rest/v1/students', 'POST', chunk);
      cachedStudents.push(...(Array.isArray(res) ? res : chunk));
    }
    // ② 更新已存在（按 id，只覆盖非空字段）
    let updated = 0;
    if (doUpdate) {
      for (const r of updRows) {
        if (!r._existingId) continue;
        const patch = {};
        FIELDS.forEach(f => { if (r[f] !== undefined && r[f] !== '') patch[f] = r[f]; });
        if (r.major && typeof MAJORS !== 'undefined' && MAJORS[r.major]) patch.major = r.major; // 专业能识别才更新
        if (!Object.keys(patch).length) continue;
        await sb(`/rest/v1/students?id=eq.${r._existingId}`, 'PATCH', patch);
        const idx = cachedStudents.findIndex(s => s.id === r._existingId);
        if (idx >= 0) Object.assign(cachedStudents[idx], patch);
        updated++;
      }
    }
    closeModal('importModal');
    renderStudentsPage(document.getElementById('mainContent'));
    alert(`完成！新增 ${records.length} 名${doUpdate ? `，更新 ${updated} 名已有学生` : ''}。`);
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
    ${majorFilterKeys({includeAll:true}).map((m,i)=>`<div class="filter-chip${stMajorFilter===m?' active':''}" onclick="setStMajor('${m}',this);renderProgressPage(document.getElementById('mainContent'))">${i===0?'全部专业':majorLabel(m)}</div>`).join('')}
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
              const studentCells = plans.map(p => {
                const st = schoolStatusLabel(p.status);
                const flags = ['prof_ok','applied','passed'].includes(p.status)
                  ? ` <span style="color:var(--text-3)">过去问${p.kakomon_started?'✓':'—'}・面试稿${p.interview_draft_done?'✓':'—'}</span>` : '';
                return `<span style="display:inline-block;background:${p.status==='passed'?'var(--ok-bg)':(isSchoolFailed(p.status)||p.status==='prof_ng')?'#fdecea':'var(--bg)'};border:1px solid var(--border-light);border-radius:2px;padding:1px 6px;margin:2px;font-size:10px">${p.student_name} ${schoolLevelHtml(p.level)} · <span style="color:${st.c};font-weight:600">${st.t}</span>${flags}</span>`;
              }).join('');
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

// ══ 老师修改档案的留痕提示（student_profile_edits）：admin 可恢复原值或确认知悉 ══
let speOpen=false;

function speRenderBar(){
  const bar=document.getElementById('spe_bar');
  if(!bar)return;
  if(!speEdits||!speEdits.length){bar.innerHTML='';return}
  const fieldLabel={name:'姓名',major:'专业',level:'等级',japanese_score:'日语成绩',english_score:'英语成绩',target_enrollment:'目标入学',expiry_date:'到期日',status:'状态',student_type:'属性',source:'来源',course_type:'课程属性',university:'出身大学',faculty:'学部/专业',gpa:'GPA/履历',thesis:'毕业论文',graduation_date:'毕业时间',japan_arrival:'赴日时间',signup_date:'报名时间'};
  bar.innerHTML=`<div style="background:var(--warn-bg,#f8f0d8);border:1px solid var(--warn,#b8860b);border-radius:4px;padding:10px 14px;margin-bottom:12px">
    <div onclick="speOpen=!speOpen;speRenderBar()" style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none">
      <span style="font-size:12px;color:#6a5210;font-weight:600">⚠ ${speEdits.length} 条老师修改档案记录待确认</span>
      <span style="font-size:10px;color:#6a5210;margin-left:auto">${speOpen?'▾ 收起':'▸ 查看详情'}</span>
    </div>
    ${speOpen?`<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
      ${speEdits.map(e=>`<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:8px 12px;font-size:11px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:600">${e.student_name||''}</span>
          <span style="color:var(--text-3)">由 <span style="color:var(--accent)">${e.teacher_name||''}</span> 修改</span>
          <span style="color:var(--text-3);font-size:9px">${(e.created_at||'').slice(0,16).replace('T',' ')}</span>
          <span style="margin-left:auto;display:flex;gap:4px">
            <button onclick="speRestore('${e.id}')" style="font-size:10px;background:none;border:1px solid var(--danger);color:var(--danger);border-radius:2px;padding:1px 8px;cursor:pointer;font-family:inherit">恢复原值</button>
            <button onclick="speAck('${e.id}')" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:1px 8px;cursor:pointer;font-family:inherit">知道了</button>
          </span>
        </div>
        <div style="margin-top:4px;color:var(--text-2);line-height:1.8">
          ${Object.entries(e.changes||{}).map(([k,c])=>`<span style="margin-right:12px">${fieldLabel[k]||k}：<span style="color:var(--text-3);text-decoration:line-through">${c.from||'（空）'}</span> → <span style="font-weight:600">${c.to||'（空）'}</span></span>`).join('')}
        </div>
      </div>`).join('')}
    </div>`:''}
  </div>`;
}

async function speRestore(id){
  const e=speEdits.find(x=>x.id===id);
  if(!e)return;
  if(!confirm(`将 ${e.student_name} 的档案恢复到修改前的值？`))return;
  try{
    await sb(`/rest/v1/students?id=eq.${e.student_id}`,'PATCH',e.prev||{});
    await sb(`/rest/v1/student_profile_edits?id=eq.${id}`,'PATCH',{restored:true});
    const st=cachedStudents.find(s=>s.id===e.student_id);
    if(st)Object.assign(st,e.prev||{});
    speEdits=speEdits.filter(x=>x.id!==id);
    renderStudentsPage(document.getElementById('mainContent'));
    speRenderBar();
  }catch(err){alert('恢复失败：'+err.message)}
}

async function speAck(id){
  try{
    await sb(`/rest/v1/student_profile_edits?id=eq.${id}`,'PATCH',{restored:true});
    speEdits=speEdits.filter(x=>x.id!==id);
    speRenderBar();
  }catch(err){alert('操作失败：'+err.message)}
}

// ══ admin 侧志望校行内修改（与老师端/学生端同一张表） ══
async function spPlanSet(planId, field, value, el) {
  try {
    await sb(`/rest/v1/student_school_plans?id=eq.${planId}`, 'PATCH', { [field]: value });
    if (el && field === 'status') { const st = schoolStatusLabel(value); el.style.color = st.c; }
    if (el) { el.style.outline = '1px solid var(--ok)'; setTimeout(() => el.style.outline = '', 800); }
  } catch (e) { alert('保存失败：' + e.message); }
}

async function spPlanFlag(planId, field, btn) {
  const next = btn.dataset.on !== '1';
  try {
    await sb(`/rest/v1/student_school_plans?id=eq.${planId}`, 'PATCH', { [field]: next });
    btn.dataset.on = next ? '1' : '0';
    btn.textContent = next ? (field === 'kakomon_started' ? '✓ 已开始' : '✓ 已完成') : (field === 'kakomon_started' ? '未开始' : '未完成');
    btn.style.border = `1px solid ${next ? 'var(--ok)' : 'var(--border)'}`;
    btn.style.background = next ? 'var(--ok-bg)' : 'var(--bg)';
    btn.style.color = next ? 'var(--ok)' : 'var(--text-3)';
  } catch (e) { alert('保存失败：' + e.message); }
}

// ══ 老师评估记录（admin 汇总查看 + 可补充/删除任意条目） ══
const spNotesCache = {};

async function spNotesToggle(sid, sname, head) {
  const box = document.getElementById('spnotes_' + sid);
  if (!box) return;
  const open = box.style.display === 'none';
  box.style.display = open ? 'block' : 'none';
  const arr = head.querySelector('.arr');
  if (arr) arr.textContent = open ? '▾' : '▸';
  if (open) {
    if (!spNotesCache[sid]) {
      box.innerHTML = '<div style="font-size:10px;color:var(--text-3)">加载中…</div>';
      try {
        spNotesCache[sid] = await sb(`/rest/v1/teacher_student_notes?student_id=eq.${sid}&select=*&order=created_at.desc`);
      } catch (e) { box.innerHTML = `<div style="font-size:10px;color:var(--danger)">加载失败：${e.message}</div>`; return; }
    }
    spNotesRender(sid, sname);
  }
}

function spNotesRender(sid, sname) {
  const box = document.getElementById('spnotes_' + sid);
  if (!box) return;
  const notes = spNotesCache[sid] || [];
  box.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px">
    <textarea id="spnote_input_${sid}" rows="2" placeholder="补充评估、交接备注…" onclick="event.stopPropagation()"
      style="width:100%;font-size:11px;line-height:1.8;padding:7px 9px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical"></textarea>
    <button onclick="event.stopPropagation();spNoteSave('${sid}','${sname}')" style="margin-top:5px;font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">保存记录</button>
    <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px">
      ${notes.length ? notes.map(n => `<div style="font-size:11px;border-top:1px dashed var(--border-light);padding-top:6px">
        <span style="color:var(--accent);font-weight:600">${n.teacher_name || ''}</span>
        <span style="color:var(--text-3);font-size:9px;margin-left:6px">${(n.created_at || '').slice(0, 16).replace('T', ' ')}</span>
        <span onclick="event.stopPropagation();spNoteDel('${n.id}','${sid}','${sname}')" style="float:right;font-size:9px;color:var(--danger);cursor:pointer">删除</span>
        <div style="color:var(--text-2);line-height:1.8;white-space:pre-wrap;margin-top:2px">${(n.content || '').replace(/</g, '&lt;')}</div>
      </div>`).join('') : '<div style="font-size:10px;color:var(--text-3)">暂无记录</div>'}
    </div>
  </div>`;
}

async function spNoteSave(sid, sname) {
  const ta = document.getElementById('spnote_input_' + sid);
  const content = (ta ? ta.value : '').trim();
  if (!content) { alert('请填写记录内容'); return; }
  const row = { id: `tn-${Date.now()}-${Math.random().toString(36).slice(2,5)}`, student_id: sid, student_name: sname, teacher_name: 'admin', content };
  try {
    await sb('/rest/v1/teacher_student_notes', 'POST', row);
    row.created_at = new Date().toISOString();
    spNotesCache[sid] = [row, ...(spNotesCache[sid] || [])];
    spNotesRender(sid, sname);
  } catch (e) { alert('保存失败：' + e.message); }
}

async function spNoteDel(id, sid, sname) {
  if (!confirm('删除这条评估记录？')) return;
  try {
    await sb(`/rest/v1/teacher_student_notes?id=eq.${id}`, 'DELETE');
    spNotesCache[sid] = (spNotesCache[sid] || []).filter(n => n.id !== id);
    spNotesRender(sid, sname);
  } catch (e) { alert('删除失败：' + e.message); }
}

// ══ 志望校录入 / 编辑 / 删除（admin 侧；与学生端、老师端同一张表） ══
const SP_LEVELS = [[1,'冲刺'],[2,'匹配'],[3,'保底']];

function spSchoolForm(title, p, onSaveJs) {
  const esc = v => String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const inp = 'width:100%;font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const existing = document.getElementById('spSchoolModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'spSchoolModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:520px;width:100%">
    <div style="font-size:13px;font-weight:600;margin-bottom:12px">${title}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div style="grid-column:1/-1"><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">学校名 *</label><input id="sps_school" value="${esc(p.school_name)}" placeholder="一橋大学" style="${inp}"></div>
      <div style="grid-column:1/-1"><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">研究科 / 专攻</label><input id="sps_faculty" value="${esc(p.faculty)}" placeholder="社会学研究科 総合社会科学専攻" style="${inp}"></div>
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">教授</label><input id="sps_prof" value="${esc(p.professor)}" style="${inp}"></div>
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">级别</label><select id="sps_level" style="${inp}">${SP_LEVELS.map(([v,l])=>`<option value="${v}" ${String(p.level)===String(v)?'selected':''}>${l}</option>`).join('')}</select></div>
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">出愿期间</label><input id="sps_period" value="${esc(p.application_period)}" placeholder="2027年7月" style="${inp}"></div>
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">该校进度</label><select id="sps_status" style="${inp}">${Object.entries(SCHOOL_STATUS_LABELS).map(([k,v])=>`<option value="${k}" ${(p.status||'preparing')===k?'selected':''}>${v.t}</option>`).join('')}</select></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('spSchoolModal').remove()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 16px;cursor:pointer;font-family:inherit">取消</button>
      <button onclick="${onSaveJs}" style="font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 20px;cursor:pointer;font-family:inherit">保存</button>
    </div>
  </div>`;
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
}

function spSchoolAdd(sid, sname, major) {
  spSchoolForm('＋ 添加志望校 — ' + sname, {}, `spSchoolSaveNew('${sid}','${sname}','${major}')`);
}

function spSchoolEdit(planId) {
  let plan = null;
  (window.__spPlansAll || []).forEach(p => { if (p.id === planId) plan = p; });
  if (!plan) { // 从 DOM 缓存兜底：重新拉一次
    sb(`/rest/v1/student_school_plans?id=eq.${planId}&select=*`).then(r => {
      if (r && r[0]) spSchoolForm('✏ 编辑志望校', r[0], `spSchoolSaveEdit('${planId}')`);
    }).catch(e => alert('读取失败：' + e.message));
    return;
  }
  spSchoolForm('✏ 编辑志望校', plan, `spSchoolSaveEdit('${planId}')`);
}

function spSchoolCollect() {
  const g = id => (document.getElementById(id) || {}).value || '';
  const school_name = g('sps_school').trim();
  if (!school_name) { alert('请填写学校名'); return null; }
  return {
    school_name, faculty: g('sps_faculty').trim(), professor: g('sps_prof').trim(),
    level: parseInt(g('sps_level')) || 2, application_period: g('sps_period').trim(),
    status: g('sps_status') || 'preparing',
  };
}

async function spSchoolSaveNew(sid, sname, major) {
  const row = spSchoolCollect();
  if (!row) return;
  Object.assign(row, {
    id: `ssp-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
    student_id: sid, student_name: sname, major,
    exam_season: spGuessSeason(row.application_period),
  });
  try {
    await sb('/rest/v1/student_school_plans', 'POST', row);
    document.getElementById('spSchoolModal')?.remove();
    renderPage();
  } catch (e) { alert('保存失败：' + e.message); }
}

async function spSchoolSaveEdit(planId) {
  const row = spSchoolCollect();
  if (!row) return;
  row.exam_season = spGuessSeason(row.application_period);
  try {
    await sb(`/rest/v1/student_school_plans?id=eq.${planId}`, 'PATCH', row);
    document.getElementById('spSchoolModal')?.remove();
    renderPage();
  } catch (e) { alert('保存失败：' + e.message); }
}

async function spSchoolDel(planId) {
  if (!confirm('删除这所志望校？学生端也将同步移除。')) return;
  try {
    await sb(`/rest/v1/student_school_plans?id=eq.${planId}`, 'DELETE');
    renderPage();
  } catch (e) { alert('删除失败：' + e.message); }
}

// 出愿期间 → 考试季（与学生端保持一致）
function spGuessSeason(period) {
  const m = String(period || '').match(/(\d{1,2})\s*月/);
  if (!m) return null;
  const mo = parseInt(m[1]);
  if (mo >= 5 && mo <= 9) return 'summer';
  if (mo >= 10 || mo === 1) return 'winter';
  return 'next_year';
}

// 面谈线索一键转为志望校记录
async function spSchoolFromHint(sid, sname, major, schools) {
  if (!confirm(`将面谈中提到的 ${schools.length} 所学校加入志望校？\n（${schools.join('、')}）\n加入后可逐校补充研究科、教授与推进状态。`)) return;
  try {
    const rows = schools.map(x => ({
      id: `ssp-${Date.now()}-${Math.random().toString(36).slice(2,5)}-${x.length}`,
      student_id: sid, student_name: sname, major,
      school_name: x, level: 2, status: 'preparing',
    }));
    await sb('/rest/v1/student_school_plans', 'POST', rows);
    renderPage();
  } catch (e) { alert('添加失败：' + e.message); }
}


// ── 保录学校（保录学生专用名单，存 students.guaranteed_schools）──
function escGs(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function gsRenderList(sid){
  const s=(typeof cachedStudents!=='undefined')?cachedStudents.find(x=>x.id===sid):null;
  const list=(s&&Array.isArray(s.guaranteed_schools))?s.guaranteed_schools:[];
  if(!list.length) return '<div style="font-size:11px;color:var(--text-3)">尚无保录学校，点右上「＋ 添加保录学校」录入</div>';
  return '<div style="display:flex;flex-direction:column;gap:5px">'+list.map((g,i)=>`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--surface);font-size:12px">
      <div><span style="font-weight:600">${escGs(g.university)}</span>${g.program?` <span style="color:var(--text-3)">· ${escGs(g.program)}</span>`:''}</div>
      <span onclick="event.stopPropagation();gsDel('${sid}',${i})" style="font-size:10px;color:var(--danger);cursor:pointer">删除</span>
    </div>`).join('')+'</div>';
}
async function gsAdd(sid){
  const uni=(prompt('保录学校名称：')||'').trim(); if(!uni) return;
  const prog=(prompt('专业 / 研究科（可留空）：')||'').trim();
  const s=cachedStudents.find(x=>x.id===sid); if(!s) return;
  const list=Array.isArray(s.guaranteed_schools)?[...s.guaranteed_schools]:[];
  list.push({university:uni,program:prog});
  try{ await sb(`/rest/v1/students?id=eq.${sid}`,'PATCH',{guaranteed_schools:list}); s.guaranteed_schools=list; const el=document.getElementById('gs_list_'+sid); if(el) el.innerHTML=gsRenderList(sid); }
  catch(e){ alert('保存失败：'+e.message); }
}
async function gsDel(sid,idx){
  const s=cachedStudents.find(x=>x.id===sid); if(!s) return;
  const list=Array.isArray(s.guaranteed_schools)?[...s.guaranteed_schools]:[];
  list.splice(idx,1);
  try{ await sb(`/rest/v1/students?id=eq.${sid}`,'PATCH',{guaranteed_schools:list}); s.guaranteed_schools=list; const el=document.getElementById('gs_list_'+sid); if(el) el.innerHTML=gsRenderList(sid); }
  catch(e){ alert('删除失败：'+e.message); }
}

// ══════════ 录入合格实绩（考学进度→合格数据库联动）══════════
// 合格库专业分类（与 results/submit-grad 完全一致：文科14 + 理科8）
const AE_SUBJECTS = [
  ['shakai','社会学'],['fukushi','社会福祉'],['shinpan','新聞伝播'],['keizai','経済学'],
  ['keiei','経営学'],['kyoiku','教育学'],['hougaku','法学'],['seiji','政治学/国際関係'],
  ['bungaku','文学'],['rekishi','歴史学'],['hyosho','表象文化'],['nihongo','日本語教育'],
  ['shinri','心理学'],['other','その他（文科）'],
  ['rika_kikai','機械工学'],['rika_denki','電気電子工学'],['rika_kagaku','化学・化学工学'],
  ['rika_joho','情報工学'],['rika_kenchiku','建築・土木工学'],['rika_bio','生命科学・医学'],
  ['rika_keiei','経営工学'],['rika_other','その他（理科）'],
];
// 学生的 major → 合格库 subject 的智能默认（能对上就选中，不写死，可在弹窗里改）
function aeGuessSubject(major, isRika){
  const m = String(major||'').toLowerCase();
  const label = (typeof MAJORS!=='undefined' && MAJORS[major]) ? String(MAJORS[major]) : '';
  const hay = m + ' ' + label.toLowerCase();
  const test = (kw)=> kw.some(k=>hay.includes(k));
  if(isRika){
    if(test(['機械','机械','kikai'])) return 'rika_kikai';
    if(test(['電気','电气','電子','电子','denki'])) return 'rika_denki';
    if(test(['化学','kagaku'])) return 'rika_kagaku';
    if(test(['情報','情报','joho','jouhou'])) return 'rika_joho';
    if(test(['建築','建筑','土木','kenchiku','doboku'])) return 'rika_kenchiku';
    if(test(['生命','医','bio','iryou'])) return 'rika_bio';
    if(test(['経営工','经营工'])) return 'rika_keiei';
    return 'rika_other';
  }
  if(test(['社会学','shakai'])) return 'shakai';
  if(test(['福祉','fukushi'])) return 'fukushi';
  if(test(['新聞','新闻','伝播','传播','メディア','shinpan'])) return 'shinpan';
  if(test(['経済','经济','keizai'])) return 'keizai';
  if(test(['経営','经营','keiei'])) return 'keiei';
  if(test(['教育','kyoiku','kyouiku'])) return 'kyoiku';
  if(test(['法','hou'])) return 'hougaku';
  if(test(['政治','国際関係','国际','seiji'])) return 'seiji';
  if(test(['文学','bungaku'])) return 'bungaku';
  if(test(['歴史','历史','rekishi'])) return 'rekishi';
  if(test(['表象','hyosho'])) return 'hyosho';
  if(test(['日本語','日本语','nihongo'])) return 'nihongo';
  if(test(['心理','shinri'])) return 'shinri';
  return 'other';
}
// 从档案里的语言成绩文本拆出结构化字段（复用合格库口径）
function aeParseJlpt(raw){
  if(!raw) return {jlpt:'',score:''};
  const m=String(raw).match(/N\s*([1-3])/i);
  const jlpt=m?('N'+m[1]):'';
  const sm=String(raw).match(/(\d{2,3})\s*[点分]?/);
  return {jlpt, score:(sm?sm[1]:'')};
}
function aeParseEng(raw){
  if(!raw) return {type:'',score:''};
  const u=String(raw).toUpperCase();
  let type=''; if(u.includes('TOEIC'))type='TOEIC'; else if(u.includes('TOEFL'))type='TOEFL'; else if(u.includes('IELTS'))type='IELTS';
  const sm=String(raw).match(/[\d.]+/);
  return {type, score:(sm?sm[0]:'')};
}

function openAdmissionEntry(data){
  // data: {school,faculty,dept,student,jp,en,major,enroll}
  // 学生所在领域 → 文/理科 track（领域中文名与合格库 track 对应）
  const dom = (typeof MAJOR_DOMAIN!=='undefined' && MAJOR_DOMAIN[data.major]) ? String(MAJOR_DOMAIN[data.major]) : '';
  const isRika = /理科/.test(dom);
  const guessSubj = aeGuessSubject(data.major, isRika);
  const jp = aeParseJlpt(data.jp), en = aeParseEng(data.en);
  const enrollYear = (String(data.enroll||'').match(/\d{4}/)||[''])[0];

  let ov=document.getElementById('admissionEntryOverlay');
  if(!ov){ ov=document.createElement('div'); ov.id='admissionEntryOverlay'; ov.style.cssText='position:fixed;inset:0;z-index:970;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center'; document.body.appendChild(ov); }
  ov.style.display='flex';
  ov.innerHTML=`
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:22px 26px;width:min(500px,94vw);max-height:88vh;overflow:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-family:'Noto Serif SC',serif;font-size:1.05rem;font-weight:600">📝 录入合格实绩</div>
      <button onclick="document.getElementById('admissionEntryOverlay').style.display='none'" class="btn btn-outline btn-sm">取消</button>
    </div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">已从考学进度预填。语言成绩已按学生档案自动拆成级别+分数；专业分类已按学生所在专业智能选中（文/理科按领域自动判定），可下拉修改。字段与合格库完全一致。</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div style="grid-column:1/-1"><label style="font-size:9px;color:var(--text-3)">大学名 *</label><input id="ae_univ" value="${stEsc(data.school)}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px"></div>
      <div><label style="font-size:9px;color:var(--text-3)">研究科</label><input id="ae_dept" value="${stEsc(data.faculty)}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px"></div>
      <div><label style="font-size:9px;color:var(--text-3)">专攻</label><input id="ae_spec" value="${stEsc(data.dept)}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px"></div>
      <div><label style="font-size:9px;color:var(--text-3)">学生名</label><input id="ae_student" value="${stEsc(data.student)}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px"></div>
      <div><label style="font-size:9px;color:var(--text-3)">专业分类<span style="color:var(--text-3);font-weight:400">（${isRika?'理科':'文科'}，按学生专业默认）</span></label>
        <select id="ae_subject" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px">
          ${AE_SUBJECTS.map(([v,l])=>`<option value="${v}" ${guessSubj===v?'selected':''}>${l}</option>`).join('')}
        </select></div>
      <div><label style="font-size:9px;color:var(--text-3)">入学年份 *<span style="color:var(--text-3);font-weight:400">（学生档案预计入学）</span></label><input id="ae_enroll" value="${stEsc(enrollYear)}" placeholder="如 2027" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px"></div>
      <div><label style="font-size:9px;color:var(--text-3)">JLPT 级别</label>
        <select id="ae_jlpt" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px">
          ${['','N1','N2','N3'].map(v=>`<option value="${v}" ${jp.jlpt===v?'selected':''}>${v||'—'}</option>`).join('')}
        </select></div>
      <div><label style="font-size:9px;color:var(--text-3)">JLPT 分数</label><input id="ae_jlpt_score" type="number" value="${stEsc(jp.score)}" placeholder="如 145" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px"></div>
      <div><label style="font-size:9px;color:var(--text-3)">英语类型</label>
        <select id="ae_eng_type" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px">
          ${['','TOEIC','TOEFL','IELTS'].map(v=>`<option value="${v}" ${en.type===v?'selected':''}>${v||'—'}</option>`).join('')}
        </select></div>
      <div><label style="font-size:9px;color:var(--text-3)">英语分数</label><input id="ae_eng_score" type="number" value="${stEsc(en.score)}" placeholder="如 820" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px"></div>
      <div style="grid-column:1/-1"><label style="font-size:9px;color:var(--text-3)">备注（自由填写，如：该项目为研究生・非修士）</label><textarea id="ae_note" rows="2" placeholder="与语言成绩无关的补充说明" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:3px;font-size:12px;font-family:inherit;resize:vertical"></textarea></div>
      <div style="grid-column:1/-1"><label style="font-size:9px;color:var(--text-3)">合格通知书照片（可选）</label><input type="file" id="ae_photo" accept="image/*" style="width:100%;font-size:11px"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button onclick="saveAdmissionEntry()" id="ae_save_btn" style="flex:1;background:var(--accent,#8b5cf6);color:#fff;border:none;border-radius:5px;padding:9px;cursor:pointer;font-family:inherit">保存到合格数据库</button>
    </div>
  </div>`;
}
async function saveAdmissionEntry(){
  const g=id=>(document.getElementById(id)||{}).value||'';
  const univ=g('ae_univ').trim();
  const student=g('ae_student').trim();
  const subject=g('ae_subject');
  const jlpt=g('ae_jlpt')||null;
  const jlptScore=g('ae_jlpt_score').trim();
  const engType=g('ae_eng_type')||null;
  const engScore=g('ae_eng_score').trim();
  if(!univ){ alert('请填大学名'); return; }
  const btn=document.getElementById('ae_save_btn'); if(btn){ btn.textContent='保存中…'; btn.disabled=true; }
  try{
    // 防重复录入：姓名 + 大学名 一致，且 JLPT 分数 或 英语分数 任一项也一致 → 疑似重复
    if(student){
      try{
        const dupRes=await fetch(`${SB_URL}/rest/v1/admission_results?student=ilike.${encodeURIComponent(student)}&univ=ilike.${encodeURIComponent(univ)}&select=*`,{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}});
        const cands=dupRes.ok?await dupRes.json():[];
        const dup=cands.find(r=>(jlptScore&&String(r.jlpt_score==null?'':r.jlpt_score)===jlptScore)||(engScore&&String(r.eng_score==null?'':r.eng_score)===engScore));
        if(dup){
          const ok=confirm(`检测到疑似重复记录：\n\n${dup.student||''} · ${dup.univ||''}${dup.dept?(' · '+dup.dept):''}${dup.spec?('/'+dup.spec):''}\nJLPT：${dup.jlpt||'—'} ${dup.jlpt_score||''}　英语：${dup.eng_type||'—'} ${dup.eng_score||''}\n录入于 ${(dup.created_at||'').slice(0,10)}\n\n仍要继续录入这条新记录吗？`);
          if(!ok){ if(btn){btn.textContent='保存到合格数据库';btn.disabled=false;} return; }
        }
      }catch(e){ /* 查重失败不阻塞录入 */ }
    }
    let note=g('ae_note').trim();
    // 照片：走 admission-photos bucket，URL 以 [photo] 前缀拼进 note（与合格库一致）
    const file=document.getElementById('ae_photo')?.files?.[0];
    if(file){
      let ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,''); if(!ext||ext.length>5)ext='jpg';
      const path='grad/'+Date.now()+'_'+Math.random().toString(36).slice(2,8)+'.'+ext;
      const up=await fetch(`${SB_URL}/storage/v1/object/admission-photos/${path}`,{method:'POST',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':file.type,'x-upsert':'true'},body:file});
      if(up.ok){ note=(note?note+' | ':'')+'[photo]'+`${SB_URL}/storage/v1/object/public/admission-photos/${path}`; }
      else { const e=await up.text(); if(!confirm('图片上传失败：'+e+'\n\n仍要保存合格数据（不含图片）吗？')){ if(btn){btn.textContent='保存到合格数据库';btn.disabled=false;} return; } }
    }
    const enrollYear=parseInt(g('ae_enroll'),10);
    if(!enrollYear){ alert('请填入学年份（如 2027）'); if(btn){btn.textContent='保存到合格数据库';btn.disabled=false;} return; }
    // 入学年份 >=2026 算新数据(new)，否则旧数据(hist)——仅供合格实绩展示分区用
    const era = enrollYear>=2026 ? 'new' : 'hist';
    // track：理科专业(rika_ 开头)→rika，否则 bunka（与合格库展示的文/理分栏一致）
    const track = String(subject||'').startsWith('rika_') ? 'rika' : 'bunka';
    const row={
      univ, dept:g('ae_dept').trim()||null, spec:g('ae_spec').trim()||null, student:student||null,
      subject, track, era,
      jlpt, jlpt_score: jlptScore?parseInt(jlptScore):null,
      eng_type: engType, eng_score: engScore?parseInt(engScore):null,
      note:note||null,
    };
    const res=await fetch(`${SB_URL}/rest/v1/admission_results`,{method:'POST',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(row)});
    if(!res.ok){ throw new Error(await res.text()); }
    document.getElementById('admissionEntryOverlay').style.display='none';
    alert('✅ 已录入合格实绩到合格数据库');
  }catch(e){ alert('保存失败：'+e.message); if(btn){btn.textContent='保存到合格数据库';btn.disabled=false;} }
}
function stEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }


// ══════════════════════════════════
// 计划书 / 先行研究：admin 查看・下载・批量导出
// 数据源 student_plan_drafts（学生端填写），老师标注在 teacher_ref_notes
// ══════════════════════════════════
const AD_REF_LABELS = {
  keyword:'キーワード', title:'題目/テーマ', author:'著者', year:'年', journal:'刊行物',
  data:'研究対象/データ', method:'研究方法', summary:'概要', awareness:'問題意識',
  conclusion:'結論', citation:'引用', evaluation:'評価', note:'備考',
};
const AD_DRAFT_LABELS = {
  theme:'研究テーマ', field:'志望分野', data_source:'データ出処', data_type:'データ種類',
  prior_lit:'先行文献', hypothesis:'仮説', difference:'先行研究との違い',
  var_y:'被説明変数Y', var_x:'説明変数X', var_ctrl:'コントロール変数',
  model:'モデル', model_other:'その他', regression:'回帰式',
  background:'一、研究背景', prior:'二、先行研究', purpose:'三、研究目的',
  method:'四、研究方法', significance:'五、研究意義',
};
function adJson(v) { if (!v) return null; try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } }
function adRefs(d) { return adJson(d && d.prior_research_list) || []; }
function adFields(d) { return adJson(d && d.draft_fields) || {}; }
function adNotes(d) { return adJson(d && d.teacher_ref_notes) || {}; }
function adRefKey(r, i) { return String((r && (r.title || r.keyword)) || '').trim() || ('#' + i); }
function adVal(v) { return Array.isArray(v) ? v.join('、') : (v == null ? '' : String(v)); }

function openAdminDraftView(studentId) {
  const d = (window.__pgDraftsMap || {})[studentId];
  const stu = (cachedStudents || []).find(x => x.id === studentId) || {};
  if (!d) { alert('该学生尚无计划书数据'); return; }
  const refs = adRefs(d), notes = adNotes(d), fields = adFields(d);
  const existing = document.getElementById('adminDraftViewModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'adminDraftViewModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
  const refsHtml = refs.length ? refs.map((r, i) => {
    const n = notes[adRefKey(r, i)] || {};
    const info = Object.entries(r).filter(([k, v]) => v).map(([k, v]) => `<span style="color:var(--text-3)">${AD_REF_LABELS[k] || k}：</span>${stEsc(v)}`).join('　');
    const tag = (n.tags || []).length || n.comment
      ? `<div style="margin-top:3px;font-size:10px;color:var(--ok)">老师标注：${(n.tags || []).map(t => stEsc(t)).join('、')}${n.comment ? '　' + stEsc(n.comment) : ''}</div>` : '';
    return `<div style="padding:6px 0;border-bottom:1px dashed var(--border)">${i + 1}. ${info}${tag}</div>`;
  }).join('') : '<div style="color:var(--text-3)">尚未整理先行研究</div>';
  const filled = Object.entries(fields).filter(([k, v]) => adVal(v).trim());
  const draftHtml = filled.length
    ? filled.map(([k, v]) => `<div style="margin-bottom:5px"><span style="color:var(--text-3)">${AD_DRAFT_LABELS[k] || k}：</span>${stEsc(adVal(v)).replace(/\n/g, '<br>')}</div>`).join('')
    : ['research_question', 'methodology', 'draft_notes'].filter(f => d[f]).map(f => `<div style="margin-bottom:5px"><span style="color:var(--text-3)">${f}：</span>${stEsc(d[f])}</div>`).join('') || '<div style="color:var(--text-3)">尚未填写草稿</div>';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;max-width:720px;width:100%;max-height:90vh;overflow-y:auto">
      <div style="font-size:13px;font-weight:600;margin-bottom:3px">📄 ${stEsc(stu.name || '')} 的研究计划书</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">${majorLabel(stu.major) || ''}${d.updated_at ? '　·　更新于 ' + String(d.updated_at).slice(0, 10) : ''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${d.draft_file_url ? `<a href="${d.draft_file_url}" target="_blank" style="font-size:11px;background:var(--accent);color:#fff;border-radius:3px;padding:6px 14px;text-decoration:none">⬇ 下载完成稿</a>` : '<span style="font-size:11px;color:var(--text-3)">尚未上传完成稿</span>'}
        ${refs.length ? `<button onclick="exportOneStudentRefs('${studentId}')" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit">⬇ 导出先行研究(CSV)</button>` : ''}
      </div>
      <div style="font-weight:600;font-size:12px;margin-bottom:4px">📚 先行研究（${refs.length}条）</div>
      <div style="background:var(--bg);border-radius:3px;padding:10px;font-size:11px;line-height:1.8;margin-bottom:12px;max-height:34vh;overflow-y:auto">${refsHtml}</div>
      <div style="font-weight:600;font-size:12px;margin-bottom:4px">📝 计划书草稿</div>
      <div style="background:var(--bg);border-radius:3px;padding:10px;font-size:11px;line-height:1.8;margin-bottom:12px;max-height:30vh;overflow-y:auto">${draftHtml}</div>
      ${d.teacher_comment ? `<div style="background:var(--ok-bg);border-radius:3px;padding:10px;font-size:11px;color:var(--ok);margin-bottom:12px">💬 老师批注${d.teacher_comment_by ? '（' + stEsc(d.teacher_comment_by) + '）' : ''}：${stEsc(d.teacher_comment)}</div>` : ''}
      <div style="display:flex;justify-content:flex-end">
        <button onclick="document.getElementById('adminDraftViewModal').remove()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:8px 18px;font-size:12px;cursor:pointer;font-family:inherit">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function adCsvDownload(name, head, rows) {
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = '\ufeff' + [head.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function exportOneStudentRefs(studentId) {
  const d = (window.__pgDraftsMap || {})[studentId];
  const stu = (cachedStudents || []).find(x => x.id === studentId) || {};
  const refs = adRefs(d), notes = adNotes(d);
  if (!refs.length) { alert('该学生尚无先行研究'); return; }
  const cols = [...new Set(refs.flatMap(r => Object.keys(r)))];
  const head = [...cols.map(c => AD_REF_LABELS[c] || c), '老师关键词', '老师评语'];
  const rows = refs.map((r, i) => {
    const n = notes[adRefKey(r, i)] || {};
    return [...cols.map(c => r[c] || ''), (n.tags || []).join('、'), n.comment || ''];
  });
  adCsvDownload(`${stu.name || '学生'}_先行研究整理.csv`, head, rows);
}

// 批量导出：当前筛选范围内所有学生的先行研究（一行一条）+ 计划书汇总（一行一人，含完成稿链接）
function exportAllPlanDrafts() {
  const map = window.__pgDraftsMap || {};
  const list = (window.__pgStudents || []).filter(s => map[s.id]);
  if (!list.length) { alert('当前筛选范围内没有计划书数据'); return; }
  // ① 先行研究明细
  const refCols = ['keyword', 'title', 'author', 'year', 'journal', 'data', 'method', 'summary', 'awareness', 'conclusion', 'citation', 'evaluation', 'note'];
  const refHead = ['学生', '专业', ...refCols.map(c => AD_REF_LABELS[c] || c), '老师关键词', '老师评语'];
  const refRows = [];
  list.forEach(s => {
    const d = map[s.id], notes = adNotes(d);
    adRefs(d).forEach((r, i) => {
      const n = notes[adRefKey(r, i)] || {};
      refRows.push([s.name, majorLabel(s.major) || s.major || '', ...refCols.map(c => r[c] || ''), (n.tags || []).join('、'), n.comment || '']);
    });
  });
  // ② 计划书汇总
  const sumHead = ['学生', '专业', '先行研究条数', '草稿已填项', '完成稿链接', '老师批注', '批注老师', '更新时间'];
  const sumRows = list.map(s => {
    const d = map[s.id];
    const nFilled = Object.entries(adFields(d)).filter(([k, v]) => adVal(v).trim()).length;
    return [s.name, majorLabel(s.major) || s.major || '', adRefs(d).length, nFilled, d.draft_file_url || '', d.teacher_comment || '', d.teacher_comment_by || '', String(d.updated_at || '').slice(0, 10)];
  });
  const stamp = new Date().toISOString().slice(0, 10);
  adCsvDownload(`计划书汇总_${stamp}.csv`, sumHead, sumRows);
  if (refRows.length) setTimeout(() => adCsvDownload(`先行研究明细_${stamp}.csv`, refHead, refRows), 600);
  alert(`已导出 ${list.length} 名学生的计划书汇总${refRows.length ? `，以及 ${refRows.length} 条先行研究明细（两个 CSV 文件）` : ''}。\n完成稿文件请用汇总表中的链接下载。`);
}


// ══════════════════════════════════
// 合格记录查重：admin 集中查看 admission_results，找出姓名+大学名+语言成绩任一项都重复的疑似重复录入
// （录入时已有即时查重提醒，这里补一道"事后筛查"，覆盖多方分别录入导致漏检的情况）
// ══════════════════════════════════
let admDedupRows = null;
let admDedupOnlyDup = true;

async function renderAdmissionResultsDedup(mc) {
  mc.innerHTML = '<div class="loading">加载中…</div>';
  try {
    admDedupRows = await sb('/rest/v1/admission_results?select=*&order=created_at.desc&limit=5000') || [];
  } catch (e) {
    mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`;
    return;
  }
  admDedupRender(mc);
}

// 规整用于比对的字符串：去空白、转小写，避免"东京大学 "与"东京大学"这种误判
function admNorm(s) { return String(s || '').trim().toLowerCase(); }

function admFindDupGroups(rows) {
  const groups = [];
  const used = new Set();
  for (let i = 0; i < rows.length; i++) {
    if (used.has(i)) continue;
    const a = rows[i];
    const nameA = admNorm(a.student), univA = admNorm(a.univ);
    if (!nameA || !univA) continue;
    const jpA = admNorm(a.jlpt_score), enA = admNorm(a.eng_score);
    const members = [i];
    for (let j = i + 1; j < rows.length; j++) {
      if (used.has(j)) continue;
      const b = rows[j];
      if (admNorm(b.student) !== nameA || admNorm(b.univ) !== univA) continue;
      const jpB = admNorm(b.jlpt_score), enB = admNorm(b.eng_score);
      const scoreMatch = (jpA && jpA === jpB) || (enA && enA === enB);
      if (scoreMatch) members.push(j);
    }
    if (members.length > 1) {
      members.forEach(m => used.add(m));
      groups.push(members.map(m => rows[m]));
    }
  }
  return groups;
}

function admDedupRender(mc) {
  const rows = admDedupRows || [];
  const groups = admFindDupGroups(rows);
  const dupIds = new Set(groups.flat().map(r => r.id));
  const shown = admDedupOnlyDup ? groups.flat() : rows;

  const rowHtml = r => {
    const isDup = dupIds.has(r.id);
    return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:9px 12px;border:1px solid ${isDup ? '#e0a0a0' : 'var(--border-light)'};background:${isDup ? '#fdecea' : 'var(--surface)'};border-radius:4px;margin-bottom:6px">
      <div style="min-width:70px"><span style="font-size:12px;font-weight:600">${stEsc(r.student || '—')}</span></div>
      <div style="min-width:120px;font-size:11px">${stEsc(r.univ || '')}${r.dept ? '　' + stEsc(r.dept) : ''}${r.spec ? '/' + stEsc(r.spec) : ''}</div>
      <div style="font-size:11px;color:var(--text-2)">JLPT ${stEsc(r.jlpt || '')} ${stEsc(r.jlpt_score || '')}　英语 ${stEsc(r.eng_type || '')} ${stEsc(r.eng_score || '')}</div>
      <div style="font-size:10px;color:var(--text-3)">${(r.era === 'new') ? '新数据' : '历史数据'}　${(r.created_at || '').slice(0, 10)}</div>
      ${(function(){const t=String(r.note||'').replace(/\s*\|?\s*\[photo\]\S+/,'').trim();return t?`<div style="font-size:10px;color:var(--text-3);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${stEsc(t)}">📝 ${stEsc(t)}</div>`:'';})()}
      ${(function(){const m=String(r.note||'').match(/\[photo\](\S+)/);return m?`<a href="${m[1]}" target="_blank" style="font-size:10px;color:var(--accent)">📷 照片</a>`:'';})()}
      <div style="margin-left:auto;display:flex;gap:6px">
        ${isDup ? `<span style="font-size:9px;background:#e0a0a0;color:#fff;border-radius:2px;padding:1px 7px">疑似重复</span>` : ''}
        <button onclick="admDedupDelete('${r.id}')" style="font-size:10px;background:none;border:1px solid var(--danger);color:var(--danger);border-radius:3px;padding:2px 9px;cursor:pointer;font-family:inherit">删除此条</button>
      </div>
    </div>`;
  };

  mc.innerHTML = `
  <div class="page-header">
    <div class="section-title">🔍 合格记录查重</div>
    <button class="btn btn-sm btn-outline" onclick="renderProgressPage(document.getElementById('mainContent'))">← 返回考学进度</button>
  </div>
  <div style="font-size:11px;color:var(--text-3);margin-bottom:12px;line-height:1.8">
    判定规则：<b>姓名 + 大学名</b>一致，且<b>日语成绩或英语成绩</b>至少一项也一致 → 视为疑似重复录入（多人分别录入同一学生同一学校时常见）。<br>
    共 ${rows.length} 条合格记录，发现 <b style="color:${groups.length ? '#b03a2e' : 'inherit'}">${groups.length}</b> 组疑似重复（涉及 ${dupIds.size} 条记录）。
  </div>
  <div style="display:flex;gap:8px;margin-bottom:12px">
    <button class="btn btn-sm ${admDedupOnlyDup ? 'btn-primary' : 'btn-outline'}" onclick="admDedupOnlyDup=true;admDedupRender(document.getElementById('mainContent'))">仅显示疑似重复（${dupIds.size}）</button>
    <button class="btn btn-sm ${!admDedupOnlyDup ? 'btn-primary' : 'btn-outline'}" onclick="admDedupOnlyDup=false;admDedupRender(document.getElementById('mainContent'))">显示全部（${rows.length}）</button>
  </div>
  <div>${shown.length ? shown.map(rowHtml).join('') : `<div style="font-size:12px;color:var(--text-3);padding:20px 0;text-align:center">${admDedupOnlyDup ? '暂未发现疑似重复记录 🎉' : '合格数据库为空'}</div>`}</div>`;
}

async function admDedupDelete(id) {
  const r = (admDedupRows || []).find(x => x.id === id);
  if (!confirm(`确认删除这条合格记录？\n\n${r ? (r.student || '') + ' · ' + (r.univ || '') : ''}\n\n删除后不可恢复。`)) return;
  try {
    await sb(`/rest/v1/admission_results?id=eq.${id}`, 'DELETE');
    admDedupRows = (admDedupRows || []).filter(x => x.id !== id);
    admDedupRender(document.getElementById('mainContent'));
  } catch (e) { alert('删除失败：' + e.message); }
}
