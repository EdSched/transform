// ── Auth ──
const ADMIN_PW='weixin$2026';
function checkLogin(){const r=localStorage.getItem('txe_login');if(r){const{ts}=JSON.parse(r);if(Date.now()-ts<30*24*60*60*1000)return true}return false}
function doLogin(){
  const pw=document.getElementById('loginPw').value;
  if(pw===ADMIN_PW){localStorage.setItem('txe_login',JSON.stringify({ts:Date.now()}));document.getElementById('loginOverlay').style.display='none';initApp()}
  else{document.getElementById('loginErr').textContent='密码错误，请重试';document.getElementById('loginPw').value='';document.getElementById('loginPw').focus()}
}
function doLogout(){localStorage.removeItem('txe_login');location.reload()}
document.getElementById('loginPw').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});

function locationShort(loc) {
  if (!loc || loc === 'online') return '';
  if (loc === 'offline_takadanobaba') return '线下·高马';
  if (loc === 'offline_ichigaya') return '线下·市谷';
  if (loc === 'both_takadanobaba') return '线上/线下·高马';
  if (loc === 'both_ichigaya') return '线上/线下·市谷';
  return '';
}
function locationLong(loc) {
  if (!loc || loc === 'online') return '';
  if (loc === 'offline_takadanobaba') return '线下 · 高田马场';
  if (loc === 'offline_ichigaya') return '线下 · 市谷';
  if (loc === 'both_takadanobaba') return '线上 / 线下均可 · 高田马场';
  if (loc === 'both_ichigaya') return '线上 / 线下均可 · 市谷';
  return '';
}
function locationColor(loc) {
  if (!loc || loc === 'online') return '#2a6aad';
  if (loc.startsWith('both')) return '#2a7a4a';
  return '#2a6aad';
}
function urgLabel(u){return u==='high'?'<span class="urgency-high">紧急</span>':u==='mid'?'<span class="urgency-mid">适中</span>':'<span class="urgency-low">一般</span>'}

// ── State ──
let curPage='booking';
let bkMonth=new Date().getMonth(),bkYear=new Date().getFullYear();
let bkTab='all',bkType='all',bkMajor='all';
let cachedSlots=[],cachedBookings=[],cachedStudents=[],cachedAttendance=[];
let slotMode='single';

// ── Navigation ──
const COURSE_PW='miyako!!';
function checkCoursePw(){
  const r=localStorage.getItem('txe_course_pw');
  if(r){const{ts}=JSON.parse(r);if(Date.now()-ts<30*24*60*60*1000)return true}
  const pw=prompt('课程管理需要额外验证，请输入密码：');
  if(pw===COURSE_PW){localStorage.setItem('txe_course_pw',JSON.stringify({ts:Date.now()}));return true}
  if(pw!==null) alert('密码错误');
  return false;
}

function switchPage(page){
  if((page==='courses'||page==='schedule')&&!checkCoursePw()){return}
  curPage=page;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const navId=page==='courses'?'nav-courses':page==='schedule'?'nav-schedule':page==='teachers'?'nav-teachers':'nav-'+page;
  document.getElementById(navId)?.classList.add('active');
  closeDrawer();
  renderPage();
}
function toggleDrawer(){
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('drawerOverlay')?.classList.toggle('open');
}
function closeDrawer(){
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('drawerOverlay')?.classList.remove('open');
}
async function renderPage(){
  const mc=document.getElementById('mainContent');
  mc.innerHTML='<div class="loading">加载中…</div>';
  try{
    if(curPage==='booking'||curPage==='slots'){
      [cachedSlots,cachedBookings,cachedStudents]=await Promise.all([
        sb('/rest/v1/slots?select=*&order=date.asc,time_range.asc'),
        sb('/rest/v1/bookings?select=*&order=slot_date.asc,slot_time_range.asc'),
        sb('/rest/v1/students?select=*&order=name.asc')
      ]);
      curPage==='booking'?renderBookingPage(mc):renderSlotsPage(mc);
    } else if(curPage==='students'){
      cachedStudents=await sb('/rest/v1/students?select=*&order=name.asc');
      renderStudentsPage(mc);
    } else if(curPage==='courses'){
      [cachedStudents,cachedCourses,cachedSessions]=await Promise.all([
        sb('/rest/v1/students?select=*&order=name.asc'),
        sb('/rest/v1/courses?select=*&order=created_at.desc'),
        sb('/rest/v1/course_sessions?select=*&order=session_date.asc')
      ]);
      renderCoursesPage(mc);
    } else if(curPage==='schedule'){
      [cachedCourses,cachedSessions,cachedScheduleSlots,cachedTeacherAvail,cachedTeachers]=await Promise.all([
        sb('/rest/v1/courses?select=*&order=created_at.desc'),
        sb('/rest/v1/course_sessions?select=*&order=session_date.asc'),
        sb('/rest/v1/schedule_slots?select=*&order=session_date.asc').catch(()=>[]),
        sb('/rest/v1/teacher_availability?select=*').catch(()=>[]),
        sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[])
      ]);
      renderSchedulePage(mc);
    } else if(curPage==='teachers'){
      [cachedTeachers, cachedSessions]=await Promise.all([
        sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[]),
        sb('/rest/v1/course_sessions?homework_enabled=is.true&select=id,course_name&order=course_name.asc').catch(()=>[]),
      ]);
      renderTeachersPage(mc);
    } else if(curPage==='payroll'){
      cachedTeachers=await sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[]);
      renderPayrollPage(mc);
    } else if(curPage==='attendance'){
      [cachedStudents,cachedCourses,cachedSessions,cachedSessionRecords]=await Promise.all([
        sb('/rest/v1/students?select=*&order=name.asc'),
        sb('/rest/v1/courses?select=*&order=created_at.desc'),
        sb('/rest/v1/course_sessions?select=*&order=session_date.asc,session_number.asc'),
        sb('/rest/v1/session_records?select=*')
      ]);
      renderAttendancePage(mc);
    } else if(curPage==='progress'){
      cachedStudents=await sb('/rest/v1/students?select=*&order=name.asc');
      renderProgressPage(mc);
    }
  }catch(e){mc.innerHTML=`<div class="empty">加载失败：${e.message}</div>`}
}

// ══════════════════════════════════
// BOOKING PAGE
// ══════════════════════════════════
function renderBookingPage(mc){
  const ym=`${bkYear}-${String(bkMonth+1).padStart(2,'0')}`;
  let filtered=cachedBookings.filter(b=>b.slot_date&&b.slot_date.startsWith(ym));
  if(bkTab!=='all') filtered=filtered.filter(b=>b.status===bkTab);
  if(bkType!=='all') filtered=filtered.filter(b=>b.type===bkType);
  if(bkMajor!=='all') filtered=filtered.filter(b=>matchesMajorFilter(b.major,bkMajor));
  const total=cachedBookings.filter(b=>b.slot_date&&b.slot_date.startsWith(ym)).length;

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">预约管理</div>
    <div class="month-nav">
      <button onclick="bkMonthShift(-1)">‹</button>
      <div class="month-display">${bkYear}·${String(bkMonth+1).padStart(2,'0')}</div>
      <button onclick="bkMonthShift(1)">›</button>
    </div>
  </div>
  <div class="export-bar">
    <div style="font-size:12px;color:var(--text-3)">当月 <strong style="color:var(--text)">${total}</strong> 条预约</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="toggleStudentLinks()">🔗 学生链接</button>
      <button class="btn btn-outline btn-sm" onclick="exportAllFiles()">📦 批量导出全部文件</button>
      <button class="btn btn-danger btn-sm" onclick="clearCancelledBookings()">清空已取消</button>
      <button class="btn btn-outline btn-sm" onclick="exportExcel()">↓ 导出 Excel</button>
    </div>
  </div>
  <div id="studentLinksPanel" style="display:none;background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:12px 14px;margin-bottom:10px">
    <div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:8px">学生预约链接</div>
    <div style="display:flex;flex-direction:column;gap:5px">
      ${[['keiei','経営学'],['keizai','経済学'],['shakai_group','社会人文（三专业）'],['shakai','社会学'],['shinpan','新闻传播学'],['fukushi','社会福祉学']].map(([key,label])=>{
        const url=`https://edsched.github.io/transform/student/?major=${key}`;
        return `<div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;min-width:130px;white-space:nowrap">${label}</span>
          <code style="font-size:10px;color:var(--text-2);background:var(--surface);padding:2px 8px;border-radius:2px;flex:1;border:1px solid var(--border-light);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${url}</code>
          <button onclick="navigator.clipboard.writeText('${url}').then(()=>{this.textContent='✓';setTimeout(()=>this.textContent='复制',1500)})" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;white-space:nowrap">复制</button>
        </div>`;
      }).join('')}
    </div>
  </div>
  <div class="filter-row" id="majorFilterRow">
    ${['all','keiei','keizai','shakai_group','shakai','shinpan','fukushi'].map((m,i)=>`<div class="filter-chip${bkMajor===m?' active':''}" onclick="setBkMajor('${m}',this)">${i===0?'全部专业':majorLabel(m)}</div>`).join('')}
  </div>
  <div class="btn-group" style="margin-bottom:10px">
    ${['all','pending','confirmed','cancelled'].map((t,i)=>`<button class="${bkTab===t?'active':''}" onclick="setBkTab('${t}',this)">${['全部','待确认','已确认','已取消'][i]}</button>`).join('')}
  </div>
  <div class="filter-row">
    ${['all','daily','plan','mock'].map((t,i)=>`<div class="filter-chip${bkType===t?' active':''}" onclick="setBkType('${t}',this)">${['所有类型','日常学习','计划书','模拟面试'][i]}</div>`).join('')}
  </div>
  <div class="booking-grid" id="bookingGrid">
    ${filtered.length?filtered.map(b=>renderBookingCard(b)).join(''):'<div class="empty">暂无预约记录</div>'}
  </div>`;
}
function renderBookingCard(b){
  const hasRecord=b.daily_record&&Object.values(b.daily_record).some(v=>v);
  const slot=cachedSlots.find(s=>s.id===b.slot_id);
  const teacherName=slot?.teacher_name||'';
  // 优先显示学生档案中的真实专业；若 booking.major 是社会人文分组标记或学生档案找不到，则退回显示 booking.major
  const studentRecord=cachedStudents?.find(s=>s.name===b.name);
  const displayMajor=studentRecord?.major ? (MAJORS[studentRecord.major]||studentRecord.major) : (MAJORS[b.major]||'');
  return `<div class="booking-card status-${b.status}">
    <div class="booking-header">
      <div>
        <div class="booking-name">${b.name} <span style="font-size:11px;color:var(--text-3);font-weight:400">${displayMajor}</span></div>
        <div class="booking-meta">${b.slot_date} ${b.slot_time_range||''} · ${b.duration}min · ${urgLabel(b.urgency)}</div>
        ${teacherName
          ? `<div style="font-size:11px;color:var(--text-2);margin-top:2px">👤 ${teacherName} <button class="btn btn-outline btn-sm" style="font-size:10px;padding:1px 7px;margin-left:6px" onclick="openReassignTeacher('${b.id}','${b.slot_id}')">重新分配</button></div>`
          : `<div style="font-size:11px;color:var(--danger);margin-top:2px">⚠ 未关联老师 <button class="btn btn-outline btn-sm" style="font-size:10px;padding:1px 7px;margin-left:6px" onclick="openReassignTeacher('${b.id}','${b.slot_id}')">分配老师</button></div>`}
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        <span class="tag ${typeTag(b.type)}">${typeLabel(b.type)}</span>
        <span class="status-badge status-${b.status}">${b.status==='pending'?'待确认':b.status==='confirmed'?'已确认':'已取消'}</span>
        ${hasRecord?'<span class="record-done">已记录</span>':''}
      </div>
    </div>
    <div class="booking-body">
      <div><div class="bf-label">出愿期间</div><div class="bf-value">${b.exam_period||''}</div></div>
      <div><div class="bf-label">研究计划书</div><div class="bf-value">${b.plan_status||''}</div></div>
      <div><div class="bf-label">面试准备</div><div class="bf-value">${b.interview_status||''}</div></div>
    </div>
    <div class="progress-pills">${renderPills(b)}</div>
    ${b.needs?`<div class="booking-needs">💬 ${b.needs}</div>`:''}
    ${b.actual_time?`<div class="note-field"><div class="note-label">实际面谈时间</div><div class="actual-time">✓ ${b.actual_time.replace('T',' ')}${b.actual_duration?` · ${b.actual_duration}min`:''}</div></div>`:''}
    ${(b.location||cachedSlots.find(s=>s.id===b.slot_id)?.location)?`<div class="note-field"><div class="note-label">面谈地点</div><div class="note-content" style="color:${locationColor(b.location||cachedSlots.find(s=>s.id===b.slot_id)?.location)}">${locationLong(b.location||cachedSlots.find(s=>s.id===b.slot_id)?.location)||'线上'}</div></div>`:''}
    ${b.file_url?`<div class="note-field"><div class="note-label">提交文件</div><a href="${b.file_url}" target="_blank" style="font-size:11px;color:var(--accent)">📎 查看文件</a></div>`:''}
    ${b.student_content?`<div class="note-field"><div class="note-label">计划书 / 面试稿件</div><div class="note-content" style="max-height:80px;overflow-y:auto;white-space:pre-wrap">${b.student_content}</div></div>`:''}
    ${b.status==='confirmed'?`<div class="note-field">
      <div class="note-label" style="margin-bottom:6px">面谈查询码</div>
      ${b.teacher_file_url?`<a href="${b.teacher_file_url}" target="_blank" style="font-size:11px;color:var(--accent);display:block;margin-bottom:6px">📎 查看老师修改文件</a>`:''}
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="adminGenerateCode('${b.id}')">🔑 ${b.retrieval_code?'重新生成':'生成查询码'}</button>
        <span id="admin_code_${b.id}" style="font-size:13px;font-weight:600;letter-spacing:2px;color:${b.retrieval_code?'var(--accent)':'var(--text-3)'}">${b.retrieval_code||'未生成'}</span>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px">生成后告知学生，凭姓名＋查询码可查看面谈记录及作业反馈</div>
    </div>`:''}
    ${b.note?`<div class="note-field"><div class="note-label">备注</div><div class="note-content">${b.note}</div></div>`:''}
    ${(b.english_score||b.japanese_score)?`<div class="note-field"><div class="note-label">语言能力</div>
      ${b.english_score?`<div class="note-content">英语：${b.english_score}</div>`:''}
      ${b.japanese_score?`<div class="note-content">日语：${b.japanese_score}</div>`:''}
      <button class="btn btn-outline btn-sm" style="margin-top:6px" onclick="syncLangScore('${b.id}')">↻ 同步到学生档案</button>
    </div>`:''}
    <div class="booking-actions">
      ${b.status==='pending'?`<button class="btn btn-success btn-sm" onclick="confirmBooking('${b.id}')">✓ 确认</button>`:''}
      <button class="btn btn-outline btn-sm" onclick="openEdit('${b.id}')">编辑</button>
      ${b.status==='confirmed'?`<button class="btn btn-sm" style="background:var(--accent-light);color:var(--accent);border-color:var(--border)" onclick="openRecord('${b.id}')">${hasRecord?'查看记录':'填写记录'}</button>`:''}
      ${b.status!=='cancelled'?`<button class="btn btn-danger btn-sm" onclick="cancelBooking('${b.id}')">取消预约</button>`:''}
    </div>
  </div>`;
}
function renderPills(b){
  return [['target_school','目标学校'],['contact_prof','联系教授'],['plan_status','计划书'],['application_status','出愿进度'],['written_exam','笔试'],['interview_status','面试准备'],['specialty_status','专业知识']]
    .filter(([k])=>b[k]).map(([k,l])=>`<span class="progress-pill">${l}·${b[k]}</span>`).join('');
}
function bkMonthShift(d){bkMonth+=d;if(bkMonth>11){bkMonth=0;bkYear++}if(bkMonth<0){bkMonth=11;bkYear--}renderPage()}
function setBkTab(t,el){bkTab=t;document.querySelectorAll('.btn-group button').forEach(b=>b.classList.remove('active'));el.classList.add('active');renderBookingPage(document.getElementById('mainContent'))}
function setBkType(t,el){bkType=t;document.querySelectorAll('.filter-row:nth-of-type(3) .filter-chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');renderBookingPage(document.getElementById('mainContent'))}
function toggleStudentLinks(){
  const p=document.getElementById('studentLinksPanel');
  if(p) p.style.display=p.style.display==='none'?'block':'none';
}
function setBkMajor(m,el){bkMajor=m;document.querySelectorAll('#majorFilterRow .filter-chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');renderBookingPage(document.getElementById('mainContent'))}
async function confirmBooking(id){
  try{await sb(`/rest/v1/bookings?id=eq.${id}`,'PATCH',{status:'confirmed'});const b=cachedBookings.find(x=>x.id===id);if(b)b.status='confirmed';renderBookingPage(document.getElementById('mainContent'))}catch(e){alert('操作失败：'+e.message)}
}
async function cancelBooking(id){
  if(!confirm('确定取消？'))return;
  try{await sb(`/rest/v1/bookings?id=eq.${id}`,'PATCH',{status:'cancelled'});const b=cachedBookings.find(x=>x.id===id);if(b)b.status='cancelled';renderBookingPage(document.getElementById('mainContent'))}catch(e){alert('操作失败：'+e.message)}
}
async function clearCancelledBookings(){
  const ym=`${bkYear}-${String(bkMonth+1).padStart(2,'0')}`;
  const count=cachedBookings.filter(b=>b.status==='cancelled'&&b.slot_date&&b.slot_date.startsWith(ym)).length;
  if(!count){alert('当月没有已取消的预约');return}
  if(!confirm(`确定删除当月 ${count} 条已取消记录？`))return;
  try{await sb(`/rest/v1/bookings?status=eq.cancelled&slot_date=like.${ym}*`,'DELETE');cachedBookings=cachedBookings.filter(b=>!(b.status==='cancelled'&&b.slot_date&&b.slot_date.startsWith(ym)));renderBookingPage(document.getElementById('mainContent'))}catch(e){alert('操作失败：'+e.message)}
}
async function openReassignTeacher(bookingId, slotId) {
  let teachers = cachedTeachers && cachedTeachers.length ? cachedTeachers : [];
  if (!teachers.length) {
    try { teachers = await sb('/rest/v1/teachers?select=name&order=name.asc'); } catch(e) { teachers = []; }
  }
  const options = teachers.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
  const modal = document.createElement('div');
  modal.id = 'reassignModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;min-width:280px;max-width:360px;width:90%">
      <div style="font-size:13px;font-weight:600;margin-bottom:14px">重新分配老师</div>
      <div class="form-group">
        <label class="form-label">选择老师</label>
        <select id="reassign_teacher">${options}</select>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-primary btn-sm" onclick="confirmReassignTeacher('${bookingId}','${slotId}')">确认</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('reassignModal').remove()">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function confirmReassignTeacher(bookingId, slotId) {
  const name = document.getElementById('reassign_teacher').value;
  if (!name) return;
  try {
    if (slotId) {
      await sb(`/rest/v1/slots?id=eq.${slotId}`, 'PATCH', { teacher_name: name });
      const idx = cachedSlots.findIndex(s => s.id === slotId);
      if (idx >= 0) {
        cachedSlots[idx].teacher_name = name;
      } else {
        // slot 不在缓存里，直接推入
        cachedSlots.push({ id: slotId, teacher_name: name });
      }
    }
    document.getElementById('reassignModal').remove();
    renderBookingPage(document.getElementById('mainContent'));
  } catch(e) { alert('操作失败：' + e.message); }
}

async function adminGenerateCode(id){
  const code=[...'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'].sort(()=>Math.random()-.5).slice(0,6).join('');
  try{
    await sb(`/rest/v1/bookings?id=eq.${id}`,'PATCH',{retrieval_code:code});
    const b=cachedBookings.find(x=>x.id===id);
    if(b) b.retrieval_code=code;
    const span=document.getElementById(`admin_code_${id}`);
    if(span){span.textContent=code;span.style.color='var(--accent)';}
  }catch(e){alert('生成失败：'+e.message)}
}

async function syncLangScore(id){
  const b=cachedBookings.find(x=>x.id===id);if(!b)return;
  const btn=document.querySelector(`[onclick="syncLangScore('${id}')"]`);
  if(btn){btn.textContent='同步中…';btn.disabled=true}
  try{
    // 按姓名匹配学生档案（不限定专业，因为面谈记录的专业可能是社会人文分组标记，与学生真实专业不同）
    const matches=await sb(`/rest/v1/students?name=eq.${encodeURIComponent(b.name)}&select=id,name,major`);
    if(!matches.length){
      alert(`未在学生档案中找到「${b.name}」，未同步。`);
      if(btn){btn.textContent='↻ 同步到学生档案';btn.disabled=false}
      return;
    }
    const patch={};
    if(b.english_score) patch.english_score=b.english_score;
    if(b.japanese_score) patch.japanese_score=b.japanese_score;
    await sb(`/rest/v1/students?id=eq.${matches[0].id}`,'PATCH',patch);
    if(btn){btn.textContent='✓ 已同步';setTimeout(()=>{btn.textContent='↻ 同步到学生档案';btn.disabled=false},1500)}
  }catch(e){alert('同步失败：'+e.message);if(btn){btn.textContent='↻ 同步到学生档案';btn.disabled=false}}
}
function openEdit(id){
  const b=cachedBookings.find(x=>x.id===id);if(!b)return;
  document.getElementById('editId').value=id;
  document.getElementById('editModalSub').textContent=`${b.name} · ${b.slot_date} ${b.slot_time_range||''}`;
  document.getElementById('editStatus').value=b.status;
  const at=b.actual_time||'';
  document.getElementById('editActualDate').value=at.slice(0,10)||'';
  document.getElementById('editActualTime').value=at.slice(11,16)||'';
  document.getElementById('editActualDuration').value=b.actual_duration||'';
  document.getElementById('editNote').value=b.note||'';
  // 地点：优先用 booking 自身记录的，没有就查对应 slot
  const slot=cachedSlots.find(s=>s.id===b.slot_id);
  document.getElementById('editLocation').value=b.location||slot?.location||'online';
  document.getElementById('editModal').classList.add('open');
}
async function saveEdit(){
  const id=document.getElementById('editId').value;
  const d=document.getElementById('editActualDate').value;
  const t=document.getElementById('editActualTime').value;
  const actual_time=(d&&t)?`${d}T${t}`:(d||'');
  const durVal=document.getElementById('editActualDuration').value;
  const patch={status:document.getElementById('editStatus').value,actual_time,actual_duration:durVal?parseInt(durVal):null,note:document.getElementById('editNote').value,location:document.getElementById('editLocation').value};
  try{await sb(`/rest/v1/bookings?id=eq.${id}`,'PATCH',patch);const b=cachedBookings.find(x=>x.id===id);if(b)Object.assign(b,patch);closeModal('editModal');renderBookingPage(document.getElementById('mainContent'))}catch(e){alert('保存失败：'+e.message)}
}
function openRecord(id){
  const b=cachedBookings.find(x=>x.id===id);if(!b)return;
  document.getElementById('recordId').value=id;
  document.getElementById('recordModalSub').textContent=`${b.name} · ${b.slot_date} ${b.slot_time_range||''}`;
  document.getElementById('copyBox').style.display='none';
  document.getElementById('copyRecordBtn').style.display='none';
  const warn=document.getElementById('recordWarn');
  const slotDt=new Date((b.slot_date||'')+'T'+((b.slot_time_range||'').split('\u2013')[0]||'00:00'));
  if(slotDt>new Date()){warn.style.display='block';warn.textContent=`⚠ 面谈还未开始（${b.slot_date} ${b.slot_time_range||''}），提前记录请准确填写实际面谈时间。`}
  else warn.style.display='none';
  const r=b.daily_record||{};
  const at=b.actual_time||'';
  document.getElementById('recActualDate').value=at.slice(0,10)||'';
  document.getElementById('recActualTime').value=at.slice(11,16)||'';
  ['study','plan','apply','exam'].forEach(k=>{
    document.getElementById(`rec_${k}_status`).value=r[`${k}_status`]||'';
    document.getElementById(`rec_${k}_advice`).value=r[`${k}_advice`]||'';
    document.getElementById(`rec_${k}_deadline`).value=r[`${k}_deadline`]||'';
  });
  document.getElementById('rec_issue').value=r.issue||'';
  document.getElementById('rec_issue_advice').value=r.issue_advice||'';
  document.getElementById('rec_issue_deadline').value=r.issue_deadline||'';
  document.getElementById('rec_extra').value=r.extra||'';
  if(b.daily_record && Object.values(b.daily_record).some(v=>v)){
    setRecordMode('view',b);
  } else {
    setRecordMode('edit',b);
  }
  document.getElementById('recordModal').classList.add('open');
}

function setRecordMode(mode,b){
  if(!b){const id=document.getElementById('recordId').value;b=cachedBookings.find(x=>x.id===id);if(!b)return;}
  const editArea=document.getElementById('recordEditArea');
  const viewArea=document.getElementById('recordViewArea');
  const saveBtn=document.getElementById('recordSaveBtn');
  const editBtn=document.getElementById('recordEditBtn');
  if(mode==='view'){
    if(editArea) editArea.style.display='none';
    if(viewArea){
      viewArea.style.display='block';
      const text=buildRecordText(b);
      viewArea.innerHTML=`<pre style="font-size:11px;line-height:1.8;white-space:pre-wrap;font-family:'DM Mono',monospace;color:var(--text-2);background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:12px;margin:0">${text}</pre>`;
    }
    if(saveBtn) saveBtn.style.display='none';
    if(editBtn) editBtn.style.display='inline-flex';
  } else {
    if(editArea) editArea.style.display='block';
    if(viewArea) viewArea.style.display='none';
    if(saveBtn) saveBtn.style.display='inline-flex';
    if(editBtn) editBtn.style.display='none';
  }
}

async function saveRecord(){
  const id=document.getElementById('recordId').value;
  const b=cachedBookings.find(x=>x.id===id);if(!b)return;
  const daily_record={
    study_status:document.getElementById('rec_study_status').value,study_advice:document.getElementById('rec_study_advice').value,study_deadline:document.getElementById('rec_study_deadline').value,
    plan_status:document.getElementById('rec_plan_status').value,plan_advice:document.getElementById('rec_plan_advice').value,plan_deadline:document.getElementById('rec_plan_deadline').value,
    apply_status:document.getElementById('rec_apply_status').value,apply_advice:document.getElementById('rec_apply_advice').value,apply_deadline:document.getElementById('rec_apply_deadline').value,
    exam_status:document.getElementById('rec_exam_status').value,exam_advice:document.getElementById('rec_exam_advice').value,exam_deadline:document.getElementById('rec_exam_deadline').value,
    issue:document.getElementById('rec_issue').value,issue_advice:document.getElementById('rec_issue_advice').value,issue_deadline:document.getElementById('rec_issue_deadline').value,
    extra:document.getElementById('rec_extra').value
  };
  const d=document.getElementById('recActualDate').value;
  const t=document.getElementById('recActualTime').value;
  // 如果没填实际时间，默认用预约日期（不附时间段，避免显示时间槽范围）
  const actual_time=(d&&t)?`${d}T${t}`:d||b.slot_date||'';
  try{
    await sb(`/rest/v1/bookings?id=eq.${id}`,'PATCH',{actual_time,daily_record});
    b.actual_time=actual_time;b.daily_record=daily_record;
    setRecordMode('view',b);
    document.getElementById('copyRecordBtn').style.display='inline-flex';
    renderBookingPage(document.getElementById('mainContent'));
  }catch(e){alert('保存失败：'+e.message)}
}
function copyRecord(){
  const id=document.getElementById('recordId').value;
  const b=cachedBookings.find(x=>x.id===id);
  const text=b?buildRecordText(b):'';
  navigator.clipboard.writeText(text).then(()=>{const btn=document.getElementById('copyRecordBtn');btn.textContent='✓ 已复制';setTimeout(()=>btn.textContent='📋 复制记录',2000)}).catch(()=>alert('请手动选中文本复制'));
}

async function exportAllFiles(){
  const withFiles=cachedBookings.filter(b=>b.teacher_file_url);
  if(!withFiles.length){alert('暂无可导出的文件');return}
  const btn=document.querySelector('[onclick="exportAllFiles()"]');
  if(btn){btn.textContent='打包中…';btn.disabled=true}
  try{
    const zip=new JSZip();
    for(const b of withFiles){
      try{
        const res=await fetch(b.teacher_file_url);
        const blob=await res.blob();
        const ext=(b.teacher_file_url.split('.').pop()||'file').split('?')[0];
        const major=MAJORS[b.major]||b.major||'';
        zip.file(`${major}/${b.name}_${b.slot_date}.${ext}`,blob);
      }catch(e){}
    }
    const content=await zip.generateAsync({type:'blob'});
    const url=URL.createObjectURL(content);
    const a=document.createElement('a');
    a.href=url;a.download=`全部面谈文件_${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){alert('打包失败：'+e.message)}
  finally{if(btn){btn.textContent='📦 批量导出全部文件';btn.disabled=false}}
}
function exportExcel(){
  const ym=`${bkYear}-${String(bkMonth+1).padStart(2,'0')}`;
  const data=cachedBookings.filter(b=>b.slot_date&&b.slot_date.startsWith(ym));
  if(!data.length){alert('当月暂无预约数据');return}
  const rows=data.map(b=>{const r=b.daily_record||{};return{
    '姓名':b.name,'专业':MAJORS[b.major]||b.major||'','预约日期':b.slot_date,'时间段':b.slot_time_range||'','时长(分钟)':b.duration,
    '面谈类型':typeLabel(b.type),'紧急程度':b.urgency==='high'?'紧急':b.urgency==='mid'?'适中':'一般',
    '出愿期间':b.exam_period||'','研究计划书':b.plan_status||'','面试准备':b.interview_status||'','具体需求':b.needs||'',
    '状态':b.status==='pending'?'待确认':b.status==='confirmed'?'已确认':'已取消','实际面谈时间':b.actual_time||'','实际面谈时长':b.actual_duration||'','备注':b.note||'',
    '知识进展':r.study_status||'','知识建议':r.study_advice||'','知识期限':r.study_deadline||'',
    '计划书状态':r.plan_status||'','计划书建议':r.plan_advice||'','计划书期限':r.plan_deadline||'',
    '出愿状态':r.apply_status||'','出愿建议':r.apply_advice||'','出愿期限':r.apply_deadline||'',
    '备考状态':r.exam_status||'','备考建议':r.exam_advice||'','备考期限':r.exam_deadline||'',
    '困惑问题':r.issue||'','困惑建议':r.issue_advice||'','补充':r.extra||''
  }});
  const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'预约记录');
  XLSX.writeFile(wb,`面谈预约_${bkYear}年${bkMonth+1}月.xlsx`);
}

// ══════════════════════════════════
// SLOTS PAGE
// ══════════════════════════════════
function renderSlotsPage(mc){
  const ym=`${bkYear}-${String(bkMonth+1).padStart(2,'0')}`;
  const monthSlots=cachedSlots.filter(s=>s.date.startsWith(ym)).sort((a,b)=>a.date.localeCompare(b.date)||a.time_range.localeCompare(b.time_range));
  const slotBookedCount={};
  cachedBookings.filter(b=>b.status!=='cancelled').forEach(b=>{slotBookedCount[b.slot_id]=(slotBookedCount[b.slot_id]||0)+1});

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">时间槽设定</div>
    <div class="month-nav">
      <button onclick="bkMonthShift(-1)">‹</button>
      <div class="month-display">${bkYear}·${String(bkMonth+1).padStart(2,'0')}</div>
      <button onclick="bkMonthShift(1)">›</button>
    </div>
  </div>
  <div class="swipe-row" style="grid-template-columns:300px 1fr">
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:18px">
      <div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin-bottom:12px">新增时间槽</div>
      <div class="mode-tabs">
        <button class="mode-tab active" id="modeTabSingle" onclick="setSlotMode('single')">单次指定</button>
        <button class="mode-tab" id="modeTabRepeat" onclick="setSlotMode('repeat')">按星期循环</button>
      </div>
      <div id="panelSingle">
        <div class="form-group"><label class="form-label">日期</label><input type="date" id="slotDate"></div>
      </div>
      <div id="panelRepeat" style="display:none">
        <div class="form-group"><label class="form-label">适用星期（可多选）</label>
          <div class="weekday-grid" id="weekdayGrid">
            <button class="wd-btn" data-wd="1" onclick="toggleWd(this)">周一</button>
            <button class="wd-btn" data-wd="2" onclick="toggleWd(this)">周二</button>
            <button class="wd-btn" data-wd="3" onclick="toggleWd(this)">周三</button>
            <button class="wd-btn" data-wd="4" onclick="toggleWd(this)">周四</button>
            <button class="wd-btn" data-wd="5" onclick="toggleWd(this)">周五</button>
            <button class="wd-btn sat" data-wd="6" onclick="toggleWd(this)">周六</button>
            <button class="wd-btn sun" data-wd="0" onclick="toggleWd(this)">周日</button>
          </div>
        </div>
        <div class="form-group"><label class="form-label">日期范围</label>
          <div class="date-range-row"><input type="date" id="repeatStart"><input type="date" id="repeatEnd"></div>
        </div>
      </div>
      <div class="form-group"><label class="form-label">时间段</label>
        <div class="time-range-row">
          <input type="time" id="slotTimeStart" value="10:00">
          <div class="time-sep">—</div>
          <input type="time" id="slotTimeEnd" value="12:00">
        </div>
      </div>
      <div class="form-group"><label class="form-label">专业</label>
        <select id="slotMajor">
          ${Object.entries(MAJORS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">面谈类型（可多选）</label>
        <div style="display:flex;flex-direction:column;gap:6px" id="slotTypeGroup">
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" value="daily" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">日常学习面谈（TA老师）</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" value="plan" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">计划书相关（专业课老师）</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" value="mock" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">模拟面试（按情况安排）</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"><input type="checkbox" value="vip" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">VIP预约（单独通道）</label>
        </div>
      </div>
      <div class="form-group"><label class="form-label">面谈地点（可选）</label>
        <select id="slotLocation">
          <option value="online">线上</option>
          <option value="offline_takadanobaba">线下 · 高田马场</option>
          <option value="offline_ichigaya">线下 · 市谷</option>
          <option value="both_takadanobaba">线上 · 线下均可（高田马场）</option>
          <option value="both_ichigaya">线上 · 线下均可（市谷）</option>
        </select>
      </div>
      <button class="btn btn-primary btn-full" onclick="addSlot()">＋ 添加时间槽</button>
    </div>
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)">本月时间槽 <span class="badge-count">${monthSlots.length}</span></div>
        <div style="display:flex;gap:6px">
          <button class="btn-ghost" style="color:var(--danger)" onclick="clearMonthSlots()">清空本月</button>
          <button class="btn-ghost" onclick="clearAllSlots()">清空全部</button>
        </div>
      </div>
      <div class="slot-list">
        ${monthSlots.length?monthSlots.map(s=>{
          const d=new Date(s.date),dow=DAYS[d.getDay()];
          const dc=d.getDay()===6?'var(--sat)':d.getDay()===0?'var(--sun)':'var(--text-2)';
          const cap=slotCap(s.time_range),booked=slotBookedCount[s.id]||0;
          const isLocked=s.locked||false;
          return `<div class="slot-item" style="${isLocked?'background:var(--danger-bg);border-color:var(--danger)':''}">
            <div class="slot-item-left">
              <span class="tag ${typeTag(Array.isArray(s.type)?s.type[0]:s.type)}">${(Array.isArray(s.type)?s.type:[s.type]).map(t=>t==='daily'?'日常':t==='plan'?'计划书':t==='vip'?'VIP':'模拟').join('・')}</span>
              <span style="font-size:10px;color:var(--text-3)">${MAJORS[s.major]||s.major}</span>
              <span style="font-weight:500">${s.date.slice(5)}</span>
              <span style="font-size:10px;color:${dc}">${dow}</span>
              <span style="color:var(--text-2);font-size:10px">${s.time_range}</span>
              ${locationShort(s.location)?`<span style="font-size:10px;color:${locationColor(s.location)}">${locationShort(s.location)}</span>`:''}
              <span style="font-size:10px;color:${isLocked?'var(--danger)':booked>=cap?'var(--danger)':'var(--ok)'}">${isLocked?'🔒 已锁定':booked+'/'+cap}</span>
            </div>
            <div style="display:flex;gap:4px">
              <button onclick="lockSlot('${s.id}',${!isLocked})" style="font-size:10px;background:${isLocked?'var(--ok-bg)':'var(--danger-bg)'};color:${isLocked?'var(--ok)':'var(--danger)'};border:1px solid ${isLocked?'var(--ok)':'var(--danger)'};border-radius:2px;padding:1px 7px;cursor:pointer;font-family:inherit">${isLocked?'解锁':'锁定'}</button>
              <button class="btn-ghost" onclick="deleteSlot('${s.id}')">✕</button>
            </div>
          </div>`;
        }).join(''):'<div class="empty">本月暂无时间槽</div>'}
      </div>
    </div>
  </div>
  <div class="swipe-hint">← 左右滑动切换：新增表单 / 时间槽列表 →</div>`;

  // restore date defaults
  const today=new Date();
  document.getElementById('slotDate').valueAsDate=today;
  const y=today.getFullYear(),m=String(today.getMonth()+1).padStart(2,'0');
  document.getElementById('repeatStart').value=`${y}-${m}-01`;
  document.getElementById('repeatEnd').value=today.toISOString().slice(0,10);
}
function setSlotMode(m){
  slotMode=m;
  document.getElementById('modeTabSingle').classList.toggle('active',m==='single');
  document.getElementById('modeTabRepeat').classList.toggle('active',m==='repeat');
  document.getElementById('panelSingle').style.display=m==='single'?'':'none';
  document.getElementById('panelRepeat').style.display=m==='repeat'?'':'none';
}
function toggleWd(btn){btn.classList.toggle('selected')}
function datesForWeekdays(wds,s,e){const start=new Date(s),end=new Date(e);if(isNaN(start)||isNaN(end)||start>end)return[];const dates=[],cur=new Date(start);while(cur<=end){if(wds.includes(cur.getDay()))dates.push(cur.toISOString().slice(0,10));cur.setDate(cur.getDate()+1)}return dates}
async function addSlot(){
  const ts=document.getElementById('slotTimeStart').value,te=document.getElementById('slotTimeEnd').value;
  const types=[...document.querySelectorAll('#slotTypeGroup input:checked')].map(c=>c.value);
  const major=document.getElementById('slotMajor').value;
  const location=document.getElementById('slotLocation').value||'online';
  if(!ts||!te){alert('请填写时间段');return}
  if(ts>=te){alert('结束时间需晚于开始时间');return}
  if(!types.length){alert('请至少选择一个面谈类型');return}
  const timeRange=`${ts}–${te}`;
  let dates=[];
  if(slotMode==='single'){const d=document.getElementById('slotDate').value;if(!d){alert('请选择日期');return}dates=[d]}
  else{const wds=[...document.querySelectorAll('#weekdayGrid .wd-btn.selected')].map(b=>parseInt(b.dataset.wd));if(!wds.length){alert('请选择至少一个星期');return}const rs=document.getElementById('repeatStart').value,re=document.getElementById('repeatEnd').value;if(!rs||!re){alert('请填写日期范围');return}dates=datesForWeekdays(wds,rs,re);if(!dates.length){alert('所选范围内没有符合的日期');return}}
  const existing=new Set(cachedSlots.map(s=>`${s.date}|${s.time_range}|${(Array.isArray(s.type)?s.type:[s.type]).join(',')}|${s.major}`));
  const toInsert=[];
  const typeKey=types.join(',');
  for(const date of dates){const key=`${date}|${timeRange}|${typeKey}|${major}`;if(!existing.has(key)){toInsert.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,6)}`,date,time_range:timeRange,type:types,major,location});existing.add(key)}}
  if(!toInsert.length){alert('所选日期的时间槽已存在');return}
  try{const res=await sb('/rest/v1/slots','POST',toInsert);cachedSlots=[...cachedSlots,...(Array.isArray(res)?res:toInsert)];renderSlotsPage(document.getElementById('mainContent'));if(toInsert.length>1)alert(`已添加 ${toInsert.length} 个时间槽`)}
  catch(e){alert('添加失败：'+e.message)}
}
async function lockSlot(id, lock){
  try{
    await sb(`/rest/v1/slots?id=eq.${id}`,'PATCH',{locked:lock});
    const s=cachedSlots.find(x=>x.id===id);
    if(s) s.locked=lock;
    renderSlotsPage(document.getElementById('mainContent'));
  }catch(e){alert('操作失败：'+e.message)}
}

async function deleteSlot(id){
  if(!confirm('确定删除这个时间槽？'))return;
  try{await sb(`/rest/v1/slots?id=eq.${id}`,'DELETE');cachedSlots=cachedSlots.filter(s=>s.id!==id);renderSlotsPage(document.getElementById('mainContent'))}catch(e){alert('删除失败：'+e.message)}
}
async function clearMonthSlots(){
  const ym=`${bkYear}-${String(bkMonth+1).padStart(2,'0')}`;
  if(!confirm(`确定清空 ${bkYear}年${bkMonth+1}月 的所有时间槽？`))return;
  try{await sb(`/rest/v1/slots?date=like.${ym}*`,'DELETE');cachedSlots=cachedSlots.filter(s=>!s.date.startsWith(ym));renderSlotsPage(document.getElementById('mainContent'))}catch(e){alert('操作失败：'+e.message)}
}
async function clearAllSlots(){
  if(!confirm('确定清空全部时间槽？此操作不可恢复。'))return;
  try{await sb('/rest/v1/slots?id=neq.null','DELETE');cachedSlots=[];renderSlotsPage(document.getElementById('mainContent'))}catch(e){alert('操作失败：'+e.message)}
}

// ══════════════════════════════════
// STUDENTS PAGE
// ══════════════════════════════════
let stMajorFilter='all',stSearch='',stStatus='active';
function renderStudentsPage(mc){
  let list=cachedStudents;
  if(stMajorFilter!=='all') list=list.filter(s=>matchesMajorFilter(s.major,stMajorFilter));
  if(stStatus!=='all') list=list.filter(s=>s.status===stStatus);
  if(stSearch) list=list.filter(s=>s.name.includes(stSearch)||s.university?.includes(stSearch)||s.notes?.includes(stSearch));
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
  <div class="search-bar"><input placeholder="搜索姓名 / 学校 / 备注…" value="${stSearch}" oninput="stSearch=this.value;renderStudentsPage(document.getElementById('mainContent'))"></div>
  <div class="table-scroll"><table class="student-table">
    <thead><tr>
      <th><input type="checkbox" id="selectAllStudents" onchange="toggleSelectAllStudents(this)"></th>
      <th>姓名</th><th>专业</th><th>等级</th><th>属性</th><th>日语</th><th>英语</th><th>出身大学</th><th>入学目标</th><th>赴日</th><th>状态</th><th>查询码</th><th></th>
    </tr></thead>
    <tbody>
      ${list.length?list.map(s=>`<tr>
        <td><input type="checkbox" class="student-select" value="${s.id}"></td>
        <td class="student-name-cell" onclick="openStudentDetail('${s.id}')" style="cursor:pointer;color:var(--accent);text-decoration:underline">${s.name}</td>
        <td>${MAJORS[s.major]||s.major||''}</td>
        <td>${s.level?`<span class="level-badge level-${s.level}">${s.level}</span>`:''}</td>
        <td style="font-size:11px">${s.student_type||''}</td>
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
      </tr>`).join(''):'<tr><td colspan="13" style="text-align:center;padding:30px;color:var(--text-3)">暂无学生数据</td></tr>'}
    </tbody>
  </table></div>`;
}

function setStMajor(m,el){stMajorFilter=m;document.querySelectorAll('.filter-row:nth-of-type(1) .filter-chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');renderStudentsPage(document.getElementById('mainContent'))}
function setStStatus(v,el){stStatus=v;document.querySelectorAll('.filter-row:nth-of-type(2) .filter-chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');renderStudentsPage(document.getElementById('mainContent'))}
function openStudentModal(id){
  const s=id?cachedStudents.find(x=>x.id===id):null;
  document.getElementById('studentModalTitle').textContent=s?'编辑学生':'添加学生';
  document.getElementById('studentId').value=s?.id||'';
  const fields={
    st_name:'name',st_major:'major',st_type:'student_type',st_source:'source',
    st_course:'course_type',st_level:'level',st_japanese:'japanese_score',
    st_english:'english_score',st_university:'university',st_faculty:'faculty',
    st_gpa:'gpa',st_thesis:'thesis',st_graduation:'graduation_date',
    st_enrollment:'target_enrollment',st_arrival:'japan_arrival',
    st_expiry:'expiry_date',st_default_mode:'default_mode',st_status:'status'
  };
  Object.entries(fields).forEach(([el,key])=>{const e=document.getElementById(el);if(e)e.value=s?.[key]||'';});
  document.getElementById('studentModal').classList.add('open');
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
    expiry_date:document.getElementById('st_expiry').value,
    default_mode:document.getElementById('st_default_mode').value,
    status:document.getElementById('st_status').value
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

async function renderProgressPage(mc, focusStudentId=null){
  mc.innerHTML='<div class="loading">加载中…</div>';
  let students=cachedStudents.filter(s=>s.status==='active'||s.status==='stopped');
  if(stMajorFilter!=='all') students=students.filter(s=>matchesMajorFilter(s.major,stMajorFilter));
  if(progressStudentFilter) students=students.filter(s=>s.name.includes(progressStudentFilter));

  // 拉取所有考学进度
  const progressList = await sb(`/rest/v1/student_progress?select=*`).catch(()=>[]);
  const progressMap = {};
  progressList.forEach(p=>{ progressMap[p.student_id]=p; });

  // 拉取最新面谈记录（按学生名）
  const bookings = await sb(`/rest/v1/bookings?status=eq.confirmed&select=*&order=slot_date.desc`).catch(()=>[]);
  const latestBooking = {};
  bookings.forEach(b=>{
    if(!latestBooking[b.name]) latestBooking[b.name]=b;
  });

  const statusIcon=(s)=>({进展顺利并能掌握:'🟢',能够稳定跟上:'🟡',需要更多时间:'🟠',没有很好跟上进度:'🔴',遇到困难:'🔴',未开始:'⚪',在收集材料:'🟡',撰写中:'🟡',已完成:'🟢',完成择校:'🟡',已联系教授:'🟡',准备中:'🟡',已出愿:'🟢'}[s]||'');

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">考学进度 <span class="badge-count">${students.length}</span></div>
  </div>
  <div class="filter-row">
    ${['all','keiei','keizai','shakai_group','shakai','shinpan','fukushi'].map((m,i)=>`<div class="filter-chip${stMajorFilter===m?' active':''}" onclick="setStMajor('${m}',this);renderProgressPage(document.getElementById('mainContent'))">${i===0?'全部专业':majorLabel(m)}</div>`).join('')}
  </div>
  <div class="search-bar"><input placeholder="搜索学生姓名…" value="${progressStudentFilter}" oninput="progressStudentFilter=this.value;renderProgressPage(document.getElementById('mainContent'))"></div>
  <div style="display:flex;flex-direction:column;gap:8px">
    ${students.map(s=>{
      const p=progressMap[s.id]||{};
      const lb=latestBooking[s.name];
      const r=lb?.daily_record||{};
      const isFocus=focusStudentId===s.id;
      return `<div style="background:var(--surface);border:1px solid ${isFocus?'var(--accent)':'var(--border)'};border-radius:4px;overflow:hidden">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer" onclick="toggleProgressCard('${s.id}')">
          <div style="flex:1">
            <span style="font-size:13px;font-weight:600">${s.name}</span>
            <span style="font-size:11px;color:var(--text-3);margin-left:8px">${MAJORS[s.major]||s.major||''}</span>
            ${lb?`<span style="font-size:10px;color:var(--text-muted);margin-left:8px">最新面谈：${lb.slot_date}</span>`:''}
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            ${statusIcon(r.study_status)?`<span title="知识进展">${statusIcon(r.study_status)}</span>`:''}
            ${statusIcon(r.plan_status)?`<span title="计划书">${statusIcon(r.plan_status)}</span>`:''}
            ${statusIcon(r.apply_status)?`<span title="出愿">${statusIcon(r.apply_status)}</span>`:''}
            ${statusIcon(r.exam_status)?`<span title="备考">${statusIcon(r.exam_status)}</span>`:''}
            <span style="font-size:11px;color:var(--text-3)">▾</span>
          </div>
        </div>
        <div id="prog_${s.id}" style="display:${isFocus?'block':'none'};padding:12px 14px;border-top:1px solid var(--border-light);background:var(--bg)">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
            <div><label class="form-label">志望校</label><textarea id="prog_schools_${s.id}" rows="2" style="font-size:11px">${p.target_schools||''}</textarea></div>
            <div><label class="form-label">困难点</label><textarea id="prog_diff_${s.id}" rows="2" style="font-size:11px">${p.difficulties||''}</textarea></div>
            <div><label class="form-label">研究计划书方向</label><textarea id="prog_plan_${s.id}" rows="2" style="font-size:11px">${p.research_plan||''}</textarea></div>
            <div><label class="form-label">入学目标</label><input id="prog_enroll_${s.id}" value="${p.target_enrollment||s.target_enrollment||''}" style="font-size:11px"></div>
          </div>
          ${lb?`
          <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">最新面谈进度（${lb.slot_date}）</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px">
            ${[['知识进展','study'],['计划书','plan'],['出愿','apply'],['备考','exam']].map(([label,k])=>r[k+'_status']?`
            <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:8px">
              <div style="font-size:10px;color:var(--text-3);margin-bottom:3px">${label}</div>
              <div style="font-size:11px;font-weight:600">${statusIcon(r[k+'_status'])} ${r[k+'_status']}</div>
              ${r[k+'_advice']?`<div style="font-size:10px;color:var(--text-2);margin-top:3px">${r[k+'_advice']}</div>`:''}
              ${r[k+'_deadline']?`<div style="font-size:10px;color:var(--danger);margin-top:3px">⏰ ${r[k+'_deadline']}</div>`:''}
            </div>`:'').join('')}
          </div>
          `:'<div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">暂无面谈记录</div>'}
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onclick="saveStudentProgress('${s.id}','${s.name}','${s.major}')">保存进度</button>
            ${lb?`<button class="btn btn-outline btn-sm" onclick="syncProgressFromBooking('${s.id}','${lb.id}')">↺ 同步最新面谈</button>`:''}
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function toggleProgressCard(id){
  const el=document.getElementById(`prog_${id}`);
  if(el) el.style.display=el.style.display==='none'?'block':'none';
}

async function saveStudentProgress(studentId, studentName, major){
  const data={
    student_id:studentId,
    student_name:studentName,
    major,
    target_schools:document.getElementById(`prog_schools_${studentId}`)?.value||'',
    difficulties:document.getElementById(`prog_diff_${studentId}`)?.value||'',
    research_plan:document.getElementById(`prog_plan_${studentId}`)?.value||'',
    target_enrollment:document.getElementById(`prog_enroll_${studentId}`)?.value||'',
    updated_at:new Date().toISOString()
  };
  try{
    // upsert：有就更新，没有就插入
    const existing=await sb(`/rest/v1/student_progress?student_id=eq.${studentId}&select=id`).catch(()=>[]);
    if(existing.length){
      await sb(`/rest/v1/student_progress?student_id=eq.${studentId}`,'PATCH',data);
    } else {
      data.id=`sp-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
      await sb('/rest/v1/student_progress','POST',data);
    }
    const btn=document.querySelector(`[onclick="saveStudentProgress('${studentId}','${studentName}','${major}')"]`);
    if(btn){btn.textContent='✓ 已保存';setTimeout(()=>btn.textContent='保存进度',1500);}
  }catch(e){alert('保存失败：'+e.message)}
}

async function syncProgressFromBooking(studentId, bookingId){
  const b=await sb(`/rest/v1/bookings?id=eq.${bookingId}&select=*`).catch(()=>[]);
  if(!b.length) return;
  const r=b[0].daily_record||{};
  // 把面谈里的各状态同步到进度卡片显示（不覆盖志望校/困难点等手填项）
  // 只刷新页面展示，让用户看到后自行保存
  alert('已从最新面谈读取进度，请检查后点「保存进度」');
  renderProgressPage(document.getElementById('mainContent'), studentId);
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
  const rows=cachedStudents.map(s=>({'姓名':s.name,'专业':MAJORS[s.major]||s.major||'','等级':s.level||'','属性':s.student_type||'','来源':s.source||'','课程属性':s.course_type||'','日语成绩':s.japanese_score||'','英语成绩':s.english_score||'','出身大学':s.university||'','学部专业':s.faculty||'','GPA':s.gpa||'','毕业时间':s.graduation_date||'','入学目标':s.target_enrollment||'','赴日时间':s.japan_arrival||'','到期时间':s.expiry_date||'','状态':s.status||'','困难点':s.difficulty||'','备注':s.notes||''}));
  const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'学生档案');
  XLSX.writeFile(wb,'学生档案.xlsx');
}

// ══════════════════════════════════
// ATTENDANCE PAGE
// ══════════════════════════════════
// ══════════════════════════════════
// COURSES PAGE
// ══════════════════════════════════
let cachedCourses=[], cachedSessions=[], cachedSessionRecords=[];
let pendingCourseImport=[];

// 课程名 → 专业映射
// 专业列名 → major key
function detectMajorsFromField(str){
  if(!str) return [];
  const parts=String(str).split(/[,，、\/]/);
  const result=[];
  for(const p of parts){
    const s=p.trim();
    if(/社会人文/i.test(s)){result.push('shakai','shinpan','fukushi')}
    else if(/经营|経営/i.test(s)) result.push('keiei');
    else if(/经济|経済/i.test(s)) result.push('keizai');
    else if(/社会学/i.test(s)) result.push('shakai');
    else if(/新闻|新传|新伝/i.test(s)) result.push('shinpan');
    else if(/福祉/i.test(s)) result.push('fukushi');
  }
  return [...new Set(result)];
}

// JS Date → YYYY-MM-DD
function dateToStr(d){
  if(!d||!(d instanceof Date)||isNaN(d)) return '';
  // Excel日期用UTC，补时区偏移
  const local=new Date(d.getTime()+d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
}

// 星期字符串 → 星期数组 [0=日,1=一…]
function parseWeekdays(str){
  if(!str) return [];
  const map={'周日':0,'周一':1,'周二':2,'周三':3,'周四':4,'周五':5,'周六':6};
  const days=[];
  for(const [k,v] of Object.entries(map)){if(str.includes(k)) days.push(v)}
  return [...new Set(days)];
}

// 从第一回日期+星期+回数 生成所有日期
function generateSessionDatesFromFirst(firstDate,weekdays,totalSessions){
  if(!firstDate||!weekdays.length||!totalSessions) return [];
  const dates=[];
  const cur=new Date(firstDate+'T12:00:00');
  // 最多往后推2年防死循环
  const limit=new Date(firstDate+'T12:00:00');
  limit.setFullYear(limit.getFullYear()+2);
  while(dates.length<totalSessions&&cur<=limit){
    if(weekdays.includes(cur.getDay())) dates.push(cur.getFullYear()+'-'+String(cur.getMonth()+1).padStart(2,'0')+'-'+String(cur.getDate()).padStart(2,'0'));
    cur.setDate(cur.getDate()+1);
  }
  return dates;
}

function handleCourseImportFile(input){
  const file=input.files[0];
  if(!file) return;
  input.value='';
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});

      // 读主表
      const mainSheet=wb.Sheets[wb.SheetNames[0]];
      const mainData=XLSX.utils.sheet_to_json(mainSheet,{defval:''});

      // 读单回明细表
      const detailSheetName=wb.SheetNames.find(n=>n.includes('单回')||n.includes('明细'));
      const detailData=detailSheetName
        ?XLSX.utils.sheet_to_json(wb.Sheets[detailSheetName],{defval:''})
        :[];

      // 整理单回明细 {课程名: [{回数,单回名称,单回讲师,备注}]}
      const detailMap={};
      for(const row of detailData){
        const name=String(row['课程名称']||'').trim();
        if(!name) continue;
        if(!detailMap[name]) detailMap[name]=[];
        detailMap[name].push({
          num:parseInt(row['第几回']||0),
          title:String(row['单回名称']||'').trim(),
          teacher:String(row['单回讲师']||'').trim(),
          notes:String(row['备注']||'').trim(),
        });
      }

      const rows=[];
      for(const row of mainData){
        const name=String(row['课程名称']||'').trim();
        if(!name||name==='课程名称') continue;

        const majorStr=String(row['专业']||'').trim();
        const majors=detectMajorsFromField(majorStr);
        const period=String(row['期数']||'').trim();
        const course_type=String(row['课程属性']||'').trim();
        const teacher=String(row['讲师']||'').trim();
        const campus=String(row['校区']||'').trim();
        const delivery=String(row['授课形式']||'').trim();
        const wdStr=String(row['星期']||'').trim();
        const weekdays=parseWeekdays(wdStr);
        const timeRange=String(row['上课时间']||'').trim();
        const total=parseInt(row['课程回数']||0);
        const notes=String(row['备注']||'').trim();

        // 第一回日期：Excel读取后是JS Date对象（因为cellDates:true）
        const rawDate=row['第一回日期'];
        let firstDate='';
        if(rawDate instanceof Date) firstDate=dateToStr(rawDate);
        else if(typeof rawDate==='string'&&rawDate) firstDate=rawDate.slice(0,10);

        const dates=generateSessionDatesFromFirst(firstDate,weekdays,total);
        const details=detailMap[name]||[];

        rows.push({
          name,major:majors,period,course_type,teacher,campus,delivery,
          weekdays:wdStr,time_range:timeRange,total_sessions:total,
          first_session_date:firstDate,notes,
          _dates:dates,_details:details
        });
      }

      if(!rows.length){alert('未能解析到课程数据，请检查Excel格式');return}

      // 已存在判断：同课程名+期数 算同一条
      const existingKeys=new Set(cachedCourses.map(c=>`${c.name}|${c.period||''}`));
      pendingCourseImport=rows.map(r=>({...r,_exists:existingKeys.has(`${r.name}|${r.period}`)}));
      showCourseImportPreview();
    }catch(err){alert('解析失败：'+err.message+'\n'+err.stack)}
  };
  reader.readAsArrayBuffer(file);
}

function showCourseImportPreview(){
  const newRows=pendingCourseImport.filter(r=>!r._exists);
  const skipRows=pendingCourseImport.filter(r=>r._exists);
  const preview=document.getElementById('courseImportPreview');
  preview.innerHTML=`
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <div style="background:var(--ok-bg);border-radius:3px;padding:8px 14px;font-size:12px"><strong style="color:var(--ok)">${newRows.length}</strong> <span style="color:var(--text-2)">门课程将导入</span></div>
      <div style="background:var(--warn-bg);border-radius:3px;padding:8px 14px;font-size:12px"><strong style="color:var(--warn)">${skipRows.length}</strong> <span style="color:var(--text-2)">门已存在将跳过</span></div>
    </div>
    ${newRows.length?`<div style="max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:3px">
      <table class="student-table" style="margin:0">
        <thead><tr><th>课程名称</th><th>专业</th><th>期数</th><th>讲师</th><th>校区</th><th>授课形式</th><th>星期</th><th>第一回</th><th>回数</th><th>日期生成</th></tr></thead>
        <tbody>${newRows.map(r=>`<tr>
          <td style="font-size:11px">${r.name}</td>
          <td style="font-size:11px">${(r.major||[]).map(m=>MAJORS[m]||m).join('・')||'<span style="color:var(--warn)">未识别</span>'}</td>
          <td style="font-size:11px">${r.period}</td>
          <td style="font-size:11px">${r.teacher}</td>
          <td style="font-size:11px">${r.campus}</td>
          <td style="font-size:11px">${r.delivery}</td>
          <td style="font-size:11px">${r.weekdays}</td>
          <td style="font-size:11px">${r.first_session_date||'<span style="color:var(--danger)">缺失</span>'}</td>
          <td style="font-size:11px">${r.total_sessions}回</td>
          <td style="font-size:11px;color:${r._dates.length===r.total_sessions?'var(--ok)':r._dates.length>0?'var(--warn)':'var(--danger)'}">${r._dates.length}/${r.total_sessions}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`:'<div class="empty" style="padding:20px">所有课程已存在，无需导入</div>'}`;
  document.getElementById('courseImportConfirmBtn').disabled=!newRows.length;
  document.getElementById('courseImportModal').classList.add('open');
}

async function confirmCourseImport(){
  const newRows=pendingCourseImport.filter(r=>!r._exists);
  if(!newRows.length){closeModal('courseImportModal');return}
  const confirmed=document.getElementById('importConfirmPublish')?.checked||false;
  const btn=document.getElementById('courseImportConfirmBtn');
  btn.textContent='导入中…';btn.disabled=true;
  try{
    for(const r of newRows){
      const courseId=`c-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
      const course={
        id:courseId,name:r.name,major:r.major,period:r.period,
        course_type:r.course_type,teacher:r.teacher,campus:r.campus,
        delivery:r.delivery,weekdays:r.weekdays,time_range:r.time_range,
        total_sessions:r.total_sessions,first_session_date:r.first_session_date||null,
        notes:r.notes
      };
      const res=await sb('/rest/v1/courses','POST',[course]);
      cachedCourses.push(Array.isArray(res)?res[0]:course);

      // 生成每次课
      if(r._dates.length){
        const details=r._details||[];
        const sessions=r._dates.map((date,i)=>{
          const detail=details.find(d=>d.num===i+1)||{};
          return {
            id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,4)}`,
            course_id:courseId,course_name:r.name,major:r.major,
            session_date:date,session_number:i+1,
            time_range:r.time_range,
            teacher:detail.teacher||r.teacher,
            session_title:detail.title||'',
            session_teacher:detail.teacher||'',
            confirmed
          };
        });
        for(let i=0;i<sessions.length;i+=20){
          // 每个课次继承课程的 homework_enabled
          const chunk=sessions.slice(i,i+20).map(s=>({...s,homework_enabled:courseData.homework_enabled||false}));
          const sres=await sb('/rest/v1/course_sessions','POST',chunk);
          cachedSessions.push(...(Array.isArray(sres)?sres:chunk));
        }
      }
      await new Promise(resolve=>setTimeout(resolve,120));
    }
    closeModal('courseImportModal');
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`成功导入 ${newRows.length} 门课程！`);
  }catch(e){alert('导入失败：'+e.message);btn.textContent='确认导入';btn.disabled=false}
}

let coursesMajorFilter='keizai';
let coursesPeriodFilter='current'; // 'current' | 'all'

// 判断当前是哪个期（按当前月份）


// 课程名去掉末尾数字 → 归组key
function courseGroupKey(name){
  return name.replace(/[\s　]*\d+$/, '').trim();
}

// 课程名颜色（根据关键词）
function courseColor(name){
  const n=name||'';
  if(/宏观/.test(n)) return {bg:'#ddeaf8',text:'#1a3a6a'};
  if(/微观/.test(n)) return {bg:'#ddf0e0',text:'#1a4a28'};
  if(/数学/.test(n)) return {bg:'#e8e4f8',text:'#3a2a7a'};
  if(/习题/.test(n)) return {bg:'#faecd8',text:'#5a3010'};
  if(/計量|计量|方法論|方法论/.test(n)) return {bg:'#d8f0ea',text:'#0a4038'};
  if(/共通/.test(n)) return {bg:'#ece8e0',text:'#3a3830'};
  if(/過去問|过去问|備考|备考/.test(n)) return {bg:'#f8e4dc',text:'#6a2818'};
  if(/経営|经营/.test(n)) return {bg:'#ddeaf8',text:'#1a3a6a'};
  if(/社会学|社会人文/.test(n)) return {bg:'#ddf0e0',text:'#1a4a28'};
  if(/新闻|新伝/.test(n)) return {bg:'#e8e4f8',text:'#3a2a7a'};
  if(/福祉/.test(n)) return {bg:'#faecd8',text:'#5a3010'};
  if(/zemi|ゼミ|seminar/i.test(n)) return {bg:'#d8f0ea',text:'#0a4038'};
  return {bg:'#ece8e0',text:'#3a3830'};
}

// 课程期判断（根据 start_date 月份）


// 日期格式 → M/D 周X
function fmtSessionDate(dateStr){
  if(!dateStr) return '';
  const d=new Date(dateStr);
  const dow=['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
  const dowColor=d.getDay()===6?'#1a4a8a':d.getDay()===0?'#8a1a2c':'var(--text-2)';
  return {short:`${d.getMonth()+1}/${d.getDate()}`,dow,dowColor};
}

let coursesTypeFilter='all';

function renderCoursesPage(mc){
  const curPeriod=currentPeriodKey();
  let majorList=coursesMajorFilter==='all'
    ?['keiei','keizai','shakai','shinpan','fukushi']
    :coursesMajorFilter==='shakai_group'
      ?['shakai','shinpan','fukushi']
      :[coursesMajorFilter];
  let filtered=cachedCourses.filter(c=>(c.major||[]).some(m=>majorList.includes(m)));
  if(coursesPeriodFilter==='current') filtered=filtered.filter(c=>c.period===curPeriod);
  else if(coursesPeriodFilter!=='all'){
    const [filterYear,filterPeriod]=coursesPeriodFilter.match(/(\d{4})年(.+)/)?.slice(1)||[];
    if(filterYear&&filterPeriod) filtered=filtered.filter(c=>c.period===filterPeriod&&c.first_session_date?.startsWith(filterYear));
    else filtered=filtered.filter(c=>c.period===coursesPeriodFilter);
  }
  // 课程属性筛选
  if(coursesTypeFilter==='专业课') filtered=filtered.filter(c=>c.course_type&&!c.course_type.includes('共通')&&!c.course_type.includes('VIP'));
  else if(coursesTypeFilter==='共通课') filtered=filtered.filter(c=>c.course_type?.includes('共通'));
  else if(coursesTypeFilter==='VIP') filtered=filtered.filter(c=>c.course_type?.includes('VIP'));

  const allPeriods=[...new Map(cachedCourses
    .filter(c=>c.period&&c.first_session_date)
    .map(c=>{const year=c.first_session_date.slice(0,4);const key=`${year}年${c.period}`;return [key,{key,period:c.period,year}]})
  ).values()].sort((a,b)=>a.key.localeCompare(b.key));

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">课程安排</div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn btn-ok btn-sm" onclick="openPublishModal()" style="background:var(--ok);color:#fff;border:none">📢 发布管理</button>
      <button class="btn btn-primary btn-sm" onclick="openAddCourseModal()">＋ 手动添加</button>
      <button class="btn btn-outline btn-sm" onclick="exportCoursesExcel()">↓ 导出 Excel</button>
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('courseImportFileInput').click()">↑ 导入 Excel</button>
      <input type="file" id="courseImportFileInput" accept=".xlsx,.xls" style="display:none" onchange="handleCourseImportFile(this)">
    </div>
  </div>

  <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:14px;flex-wrap:wrap">
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">课程属性</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${['all','专业课','共通课','VIP'].map((t,i)=>`<div class="filter-chip${coursesTypeFilter===t?' active':''}" onclick="setCoursesType('${t}',this)" style="font-size:11px;padding:3px 10px">${i===0?'全部':t}</div>`).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">专业</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${['all','keiei','keizai','shakai_group','shakai','shinpan','fukushi'].map((m,i)=>`
          <div class="filter-chip${coursesMajorFilter===m?' active':''}" onclick="setCoursesMajor('${m}',this)" style="font-size:11px;padding:3px 10px">
            ${i===0?'全部':majorLabel(m)}
          </div>`).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">期数</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <div class="filter-chip${coursesPeriodFilter==='current'?' active':''}" onclick="setCoursesPeriod('current',this)" style="font-size:11px;padding:3px 10px">当前期（${curPeriod}）</div>
        ${allPeriods.map(p=>`<div class="filter-chip${coursesPeriodFilter===p.key?' active':''}" onclick="setCoursesPeriod('${p.key}',this)" style="font-size:11px;padding:3px 10px">${p.key}</div>`).join('')}
        <div class="filter-chip${coursesPeriodFilter==='all'?' active':''}" onclick="setCoursesPeriod('all',this)" style="font-size:11px;padding:3px 10px">全部</div>
      </div>
    </div>
  </div>

  ${!filtered.length
    ?`<div class="empty" style="padding:60px 0">暂无课程数据<br><span style="font-size:11px;color:var(--text-3);margin-top:6px;display:block">请切换期数筛选，或点击右上角导入课程安排</span></div>`
    :renderCoursesSummary(filtered)
  }`;
}

function renderCoursesSummary(courses){
  // 共通課など複数専業に属するコースが重複表示されないようにIDでユニーク化
  const seen=new Set();
  const uniqueCourses=courses.filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true});

  // 按课程组key聚合（去掉末尾数字）
  const groups={};
  const groupOrder=[];
  uniqueCourses.forEach(c=>{
    const key=courseGroupKey(c.name);
    if(!groups[key]){groups[key]={course:c,sessions:[]};groupOrder.push(key)}
    const sess=cachedSessions.filter(s=>s.course_id===c.id).sort((a,b)=>a.session_date.localeCompare(b.session_date));
    groups[key].sessions.push(...sess);
  });
  groupOrder.sort((a,b)=>{
    const sa=groups[a].sessions[0]?.session_date||groups[a].course.start_date||'';
    const sb=groups[b].sessions[0]?.session_date||groups[b].course.start_date||'';
    return sa.localeCompare(sb);
  });
  groupOrder.forEach(k=>{
    const seen2=new Set();
    groups[k].sessions=groups[k].sessions.filter(s=>{if(seen2.has(s.id))return false;seen2.add(s.id);return true});
  });

  return `<div style="display:flex;flex-direction:column;gap:12px">
    ${groupOrder.map(key=>{
      const {course,sessions}=groups[key];
      const color=courseColor(key);
      const total=sessions.length||course.total_sessions||0;
      const teacherStr=course.teacher?` · ${course.teacher}`:'';
      const timeStr=course.time_range?` · ${course.time_range}`:'';
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden">
        <div style="background:${color.bg};color:${color.text};padding:8px 14px;display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:12px;font-weight:600">${key}</span>
            ${course.first_session_date?`<span style="font-size:10px;opacity:.6;background:rgba(0,0,0,.08);border-radius:2px;padding:1px 5px">${course.first_session_date.slice(0,4)}年</span>`:''}
            ${(course.major||[]).length>1?`<span style="font-size:9px;opacity:.6">${(course.major||[]).map(m=>MAJORS[m]||m).join('・')}</span>`:''}
            ${course.teacher?`<span style="font-size:10px;opacity:.75">👤 ${course.teacher}</span>`:''}
            ${course.campus?`<span style="font-size:10px;opacity:.75">📍 ${course.campus}</span>`:''}
            ${course.delivery?`<span style="font-size:10px;opacity:.75">${course.delivery.includes('线下')&&course.delivery.includes('线上')?'🔀':course.delivery==='线下'?'🏫':'💻'} ${course.delivery}</span>`:''}
            ${course.time_range?`<span style="font-size:10px;opacity:.75">⏰ ${course.time_range}</span>`:''}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:10px;opacity:.7;white-space:nowrap">${total} 課次</span>
            ${(()=>{
              const isConfirmed=sessions.length>0&&sessions.every(s=>s.confirmed);
              const someConfirmed=sessions.some(s=>s.confirmed);
              if(isConfirmed) return `<span style="font-size:10px;background:rgba(42,158,106,.2);color:#1a5a3a;border-radius:2px;padding:1px 7px;font-weight:600">✓ 已发布</span>`;
              if(someConfirmed) return `<span style="font-size:10px;background:rgba(184,120,32,.15);color:var(--warn);border-radius:2px;padding:1px 7px">部分发布</span>`;
              return `<span style="font-size:10px;background:var(--bg);color:var(--text-3);border:1px solid var(--border);border-radius:2px;padding:1px 7px">未发布</span>`;
            })()}
            <button onclick="openAddCourseModal('${course.id}')" style="font-size:10px;background:rgba(255,255,255,.35);border:1px solid rgba(0,0,0,.15);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;color:${color.text}">编辑</button>
            <button onclick="openCopyPeriod('${course.id}')" style="font-size:10px;background:rgba(255,255,255,.35);border:1px solid rgba(0,0,0,.15);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;color:${color.text}">复制到新期</button>
            <button onclick="deleteCourse('${course.id}')" style="font-size:10px;background:rgba(255,255,255,.2);border:1px solid rgba(180,0,0,.25);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;color:#8a2020">删除</button>
          </div>
        </div>
        ${sessions.length
          ?`<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:0">
              ${sessions.map((s,i)=>{
                const f=fmtSessionDate(s.session_date);
                const recCount=cachedSessionRecords.filter(r=>r.session_id===s.id&&r.attendance).length;
                const hasRec=recCount>0;
                const border=i%5!==0?'border-left:1px solid var(--border-light)':'';
                const borderT=i>=5?'border-top:1px solid var(--border-light)':'';
                const titleStr=s.session_title?`<div style="font-size:9px;color:var(--text-2);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.session_title}</div>`:'';
                if(s.is_cancelled){
                  return `<div style="padding:8px 10px;${border};${borderT};position:relative;background:rgba(0,0,0,.03)" title="休讲${s.cancel_note?'：'+s.cancel_note:''}">
                    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:4px">
                      <div style="display:flex;align-items:baseline;gap:4px">
                        <span style="font-size:13px;font-weight:600;color:var(--text-3);text-decoration:line-through">${f.short}</span>
                        <span style="font-size:10px;font-weight:500;color:var(--text-3)">${f.dow}</span>
                      </div>
                      <button onclick="openReschedule('${s.id}')" title="调整日期" style="font-size:9px;background:none;border:none;cursor:pointer;color:var(--text-3);padding:0;line-height:1">⇄</button>
                    </div>
                    <div style="font-size:9px;color:#b07020;margin-top:1px;font-weight:600">休讲${s.cancel_reason?'・'+s.cancel_reason:''}</div>
                  </div>`;
                }
                return `<div style="padding:8px 10px;${border};${borderT};position:relative" title="${s.session_title||''}">
                  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:4px">
                    <div style="display:flex;align-items:baseline;gap:4px">
                      <span style="font-size:13px;font-weight:600">${f.short}</span>
                      <span style="font-size:10px;font-weight:500;color:${f.dowColor}">${f.dow}</span>
                    </div>
                    <button onclick="openReschedule('${s.id}')" title="调整日期" style="font-size:9px;background:none;border:none;cursor:pointer;color:var(--text-3);padding:0;line-height:1">⇄</button>
                  </div>
                  ${titleStr}
                  <div style="font-size:10px;color:var(--text-3);margin-top:1px">${s.time_range||course.time_range||''}</div>
                  ${hasRec?`<div style="font-size:9px;color:var(--ok);margin-top:2px">✓ ${recCount}人</div>`:''}
                </div>`;
              }).join('')}
            </div>`
          :`<div style="padding:14px;font-size:11px;color:var(--text-3)">暂无课次数据</div>`
        }
      </div>`;
    }).join('')}
  </div>`;
}

function setCoursesMajor(m,el){
  coursesMajorFilter=m;
  renderCoursesPage(document.getElementById('mainContent'));
}
function setCoursesPeriod(p,el){
  coursesPeriodFilter=p;
  renderCoursesPage(document.getElementById('mainContent'));
}
function setCoursesType(t,el){
  coursesTypeFilter=t;
  renderCoursesPage(document.getElementById('mainContent'));
}

async function toggleCourseConfirm(courseId, isCurrentlyConfirmed){
  const sessions=cachedSessions.filter(s=>s.course_id===courseId);
  if(!sessions.length){alert('该课程暂无课次');return}
  const newVal=!isCurrentlyConfirmed;
  const action=newVal?'发布':'取消发布';
  if(!confirm(`确定${action}该课程所有 ${sessions.length} 个课次？${newVal?'\n\n发布后老师可在「我的课表」中看到这门课。':''}`)){ return}
  try{
    await sb(`/rest/v1/course_sessions?course_id=eq.${courseId}`,'PATCH',{confirmed:newVal});
    sessions.forEach(s=>s.confirmed=newVal);
    renderCoursesPage(document.getElementById('mainContent'));
  }catch(e){alert('操作失败：'+e.message)}
}

async function deleteCourse(id){
  try{
    await sb(`/rest/v1/session_records?session_id=in.(${cachedSessions.filter(s=>s.course_id===id).map(s=>`"${s.id}"`).join(',')||'""'})`,'DELETE').catch(()=>{});
    await sb(`/rest/v1/course_sessions?course_id=eq.${id}`,'DELETE');
    await sb(`/rest/v1/courses?id=eq.${id}`,'DELETE');
    cachedSessions=cachedSessions.filter(s=>s.course_id!==id);
    cachedSessionRecords=cachedSessionRecords.filter(r=>!cachedSessions.find(s=>s.id===r.session_id));
    cachedCourses=cachedCourses.filter(c=>c.id!==id);
    renderCoursesPage(document.getElementById('mainContent'));
  }catch(e){alert('删除失败：'+e.message)}
}

// ── 发布管理 ──
let publishMajorFilter='all', publishPeriodFilter='all';

function openPublishModal(){
  publishMajorFilter='all'; publishPeriodFilter='all';
  renderPublishModal();
  document.getElementById('publishModal').classList.add('open');
}

function renderPublishModal(){
  const allPeriods=[...new Map(cachedCourses
    .filter(c=>c.period&&c.first_session_date)
    .map(c=>{const year=c.first_session_date.slice(0,4);const key=`${year}年${c.period}`;return[key,key]})
  ).values()].sort();

  document.getElementById('publishFilters').innerHTML=`
    <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
      <span style="font-size:10px;color:var(--text-3);margin-right:2px">专业</span>
      ${['all','keiei','keizai','shakai_group','shakai','shinpan','fukushi'].map((m,i)=>`
        <div class="filter-chip${publishMajorFilter===m?' active':''}" onclick="setPubMajor('${m}',this)" style="font-size:11px;padding:2px 8px">${i===0?'全部':majorLabel(m)}</div>`).join('')}
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:6px">
      <span style="font-size:10px;color:var(--text-3);margin-right:2px">期数</span>
      <div class="filter-chip${publishPeriodFilter==='all'?' active':''}" onclick="setPubPeriod('all',this)" style="font-size:11px;padding:2px 8px">全部</div>
      ${allPeriods.map(p=>`<div class="filter-chip${publishPeriodFilter===p?' active':''}" onclick="setPubPeriod('${p}',this)" style="font-size:11px;padding:2px 8px">${p}</div>`).join('')}
    </div>`;

  let courses=cachedCourses;
  if(publishMajorFilter!=='all'){
    const ml=publishMajorFilter==='shakai_group'?['shakai','shinpan','fukushi']:[publishMajorFilter];
    courses=courses.filter(c=>(c.major||[]).some(m=>ml.includes(m)));
  }
  if(publishPeriodFilter!=='all'){
    const[y,p]=publishPeriodFilter.match(/(\d{4})年(.+)/)?.slice(1)||[];
    if(y&&p) courses=courses.filter(c=>c.period===p&&c.first_session_date?.startsWith(y));
  }
  // deduplicate
  const seen=new Set();
  courses=courses.filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true});

  document.getElementById('publishList').innerHTML=courses.length
    ?`<table class="student-table" style="margin:0">
        <thead><tr>
          <th style="width:36px"><input type="checkbox" id="pubSelectAll" onchange="pubToggleAll(this.checked)" style="accent-color:var(--accent)"></th>
          <th>课程名称</th><th>期数</th><th>专业</th><th>属性</th><th>状态</th>
        </tr></thead>
        <tbody>
          ${courses.map(c=>{
            const sessions=cachedSessions.filter(s=>s.course_id===c.id);
            const isConfirmed=sessions.length>0&&sessions.every(s=>s.confirmed);
            const someConfirmed=sessions.some(s=>s.confirmed);
            const statusLabel=isConfirmed?'<span style="color:var(--ok);font-size:11px">✓ 已发布</span>':someConfirmed?'<span style="color:var(--warn);font-size:11px">部分</span>':'<span style="color:var(--text-3);font-size:11px">未发布</span>';
            const year=c.first_session_date?.slice(0,4)||'';
            return `<tr>
              <td><input type="checkbox" class="pub-course-cb" value="${c.id}" style="accent-color:var(--accent)" ${isConfirmed?'checked':''}></td>
              <td style="font-size:12px;font-weight:600">${c.name}</td>
              <td style="font-size:11px">${year?year+'年':''}${c.period||''}</td>
              <td style="font-size:11px">${(c.major||[]).map(m=>MAJORS[m]||m).join('・')}</td>
              <td style="font-size:11px">${c.course_type||''}</td>
              <td>${statusLabel}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`
    :'<div class="empty" style="padding:30px">暂无课程</div>';
}

function setPubMajor(m,el){publishMajorFilter=m;renderPublishModal()}
function setPubPeriod(p,el){publishPeriodFilter=p;renderPublishModal()}
function pubToggleAll(checked){
  document.querySelectorAll('.pub-course-cb').forEach(cb=>cb.checked=checked);
}

async function publishSelected(confirm_val){
  const ids=[...document.querySelectorAll('.pub-course-cb:checked')].map(cb=>cb.value);
  if(!ids.length){alert('请先勾选课程');return}
  const action=confirm_val?'发布':'取消发布';
  if(!confirm(`确定${action}所选 ${ids.length} 门课程？`)) return;
  try{
    for(const id of ids){
      await sb(`/rest/v1/course_sessions?course_id=eq.${id}`,'PATCH',{confirmed:confirm_val});
      cachedSessions.filter(s=>s.course_id===id).forEach(s=>s.confirmed=confirm_val);
    }
    renderPublishModal();
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`已${action} ${ids.length} 门课程`);
  }catch(e){alert('操作失败：'+e.message)}
}
function openAddCourseModal(editId){
  document.getElementById('addCourseModalTitle').textContent=editId?'编辑课程':'手动添加课程';
  document.getElementById('ac_editing_id').value=editId||'';
  if(editId){
    const c=cachedCourses.find(x=>x.id===editId);
    if(!c) return;
    document.getElementById('ac_name').value=c.name||'';
    // set majors
    acSetMajors(c.major||[]);
    document.getElementById('ac_period').value=c.period||'';
    document.getElementById('ac_course_type').value=c.course_type||'';
    document.getElementById('ac_teacher').value=c.teacher||'';
    document.getElementById('ac_campus').value=c.campus||'';
    document.getElementById('ac_delivery').value=c.delivery||'';
    document.getElementById('ac_weekday').value=c.weekdays||'';
    document.getElementById('ac_time_range').value=c.time_range||'';
    document.getElementById('ac_total').value=c.total_sessions||'';
    document.getElementById('ac_first_date').value=c.first_session_date||'';
    document.getElementById('ac_notes').value=c.notes||'';
    document.getElementById('ac_homework_enabled').value=c.homework_enabled?'true':'false';
    document.getElementById('ac_meeting_url').value=c.meeting_url||'';
    document.getElementById('ac_host_key').value=c.host_key||'';
    document.getElementById('ac_recording').value = c.needs_recording ? 'yes' : 'no';
    // set confirmed state
    const isConfirmed=cachedSessions.filter(s=>s.course_id===editId).every(s=>s.confirmed);
    document.getElementById('ac_confirm_publish').checked=isConfirmed;
    // load existing session details
    const sessions=cachedSessions.filter(s=>s.course_id===editId).sort((a,b)=>a.session_number-b.session_number);
    const hasDetails=sessions.some(s=>s.session_title||s.session_teacher);
    const multiTeacher=!hasDetails&&(c.teacher||'').includes('/');
    const showDetails=hasDetails||multiTeacher;
    document.getElementById('ac_has_details').checked=showDetails;
    document.getElementById('ac_details_section').style.display=showDetails?'':'none';
    if(showDetails){
      if(hasDetails){
        acPopulateRows(sessions.map(s=>({num:s.session_number,title:s.session_title||'',teacher:s.session_teacher||c.teacher||''})));
      } else {
        // 多讲师但没有明细，生成空行让用户填
        acPopulateRows(sessions.map(s=>({num:s.session_number,title:'',teacher:c.teacher||''})));
      }
    }
  } else {
    ['ac_name','ac_teacher','ac_campus','ac_time_range','ac_notes','ac_meeting_url','ac_host_key'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('ac_recording').value = 'no';
    document.getElementById('ac_homework_enabled').value = 'false';
    ['ac_period','ac_course_type','ac_delivery','ac_weekday'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('ac_total').value='';
    document.getElementById('ac_first_date').value='';
    document.getElementById('ac_has_details').checked=false;
    acSetMajors([]);
    toggleAcDetails(false);
  }
  document.getElementById('addCourseModal').classList.add('open');
}

function acOnTypeChange(val){
  if(val==='共通课'){
    document.querySelectorAll('#ac_major_checkboxes input').forEach(cb=>cb.checked=true);
  }
}

function acGetMajors(){
  return [...document.querySelectorAll('#ac_major_checkboxes input:checked')].map(cb=>cb.value);
}

function acSetMajors(majors){
  document.querySelectorAll('#ac_major_checkboxes input').forEach(cb=>{
    cb.checked=majors.includes(cb.value);
  });
}

function toggleAcDetails(show){
  document.getElementById('ac_details_section').style.display=show?'':'none';
  if(show) acSyncRows();
}

function acSyncRows(){
  const total=parseInt(document.getElementById('ac_total').value)||0;
  if(!total){
    // 如果还没填回数，先显示空提示
    document.getElementById('ac_details_body').innerHTML=
      `<tr><td colspan="4" style="text-align:center;padding:12px;color:var(--text-3);font-size:11px">请先填写课程回数，再点「↺ 同步行数」</td></tr>`;
    return;
  }
  const teacher=document.getElementById('ac_teacher').value.trim();
  const existing=acGetRows().filter(r=>r.title||r.teacher);
  document.getElementById('ac_details_body').innerHTML='';
  for(let i=1;i<=total;i++){
    const ex=existing.find(r=>r.num===i)||{num:i,title:'',teacher};
    acAddRow(ex);
  }
}

function acPasteImport(){
  const raw=document.getElementById('ac_paste_input').value.trim();
  if(!raw){alert('请先粘贴数据');return}
  // handle Windows \r\n and Mac \r line endings
  const lines=raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l=>l.trim());
  if(!lines.length) return;

  // 如果表格是空的或只有提示行，先同步行数
  const tbody=document.getElementById('ac_details_body');
  const hasRealRows=tbody.querySelectorAll('tr input').length>0;
  if(!hasRealRows) acSyncRows();

  // 再次获取行（同步后）
  lines.forEach((line,i)=>{
    const parts=line.split('\t');
    const title=(parts[0]||'').trim();
    const teacher=(parts[1]||'').trim();
    const rows=document.querySelectorAll('#ac_details_body tr');
    if(rows[i]){
      const inputs=rows[i].querySelectorAll('input');
      if(inputs[0]&&title) inputs[0].value=title;
      if(inputs[1]&&teacher) inputs[1].value=teacher;
    } else {
      acAddRow({num:i+1,title,teacher});
    }
  });
  document.getElementById('ac_paste_input').value='';
  document.getElementById('ac_paste_area').style.display='none';
  // 给个确认提示
  const count=lines.length;
  const hint=document.createElement('div');
  hint.style.cssText='font-size:11px;color:var(--ok);margin-top:4px';
  hint.textContent=`✓ 已导入 ${count} 行`;
  const btn=document.querySelector('#ac_details_section .btn-outline:last-child');
  btn?.parentNode?.insertBefore(hint,btn);
  setTimeout(()=>hint.remove(),2500);
}

function acAddRow(data){
  const tbody=document.getElementById('ac_details_body');
  const rowNum=data?.num||(tbody.children.length+1);
  const tr=document.createElement('tr');
  tr.innerHTML=`
    <td style="font-size:12px;text-align:center;color:var(--text-3)">第${rowNum}回</td>
    <td><input value="${data?.title||''}" placeholder="单回名称（可留空）" style="font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;width:100%;background:var(--bg);font-family:'DM Mono',monospace"></td>
    <td><input value="${data?.teacher||''}" placeholder="任课老师（可留空）" style="font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;width:100%;background:var(--bg);font-family:'DM Mono',monospace"></td>
    <td><button class="btn-ghost" onclick="this.closest('tr').remove()">✕</button></td>`;
  tr.dataset.num=rowNum;
  tbody.appendChild(tr);
}

function acGetRows(){
  return [...document.querySelectorAll('#ac_details_body tr')].map((tr,i)=>{
    const inputs=tr.querySelectorAll('input');
    return {num:parseInt(tr.dataset.num)||i+1, title:inputs[0]?.value.trim()||'', teacher:inputs[1]?.value.trim()||''};
  });
}

async function saveAddCourse(){
  const name=document.getElementById('ac_name').value.trim();
  const period=document.getElementById('ac_period').value;
  const total=parseInt(document.getElementById('ac_total').value)||0;
  const firstDate=document.getElementById('ac_first_date').value;
  const weekdayStr=document.getElementById('ac_weekday').value;
  if(!name){alert('请填写课程名称');return}
  if(!period){alert('请选择期数');return}
  if(!total||!firstDate||!weekdayStr){alert('请填写回数、第一回日期和星期');return}

  const majors=acGetMajors();
  if(!majors.length){alert('请至少选择一个专业');return}
  const weekdays=parseWeekdays(weekdayStr);
  const dates=generateSessionDatesFromFirst(firstDate,weekdays,total);
  const hasDetails=document.getElementById('ac_has_details').checked;
  const detailRows=hasDetails?acGetRows():[];
  const editingId=document.getElementById('ac_editing_id').value;

  const courseData={
    name,major:majors,period,
    course_type:document.getElementById('ac_course_type').value,
    teacher:document.getElementById('ac_teacher').value.trim(),
    campus:document.getElementById('ac_campus').value.trim(),
    delivery:document.getElementById('ac_delivery').value,
    weekdays:weekdayStr,
    time_range:document.getElementById('ac_time_range').value.trim(),
    actual_hours:parseFloat(document.getElementById('ac_actual_hours').value)||null,
    total_sessions:total,
    first_session_date:firstDate,
    notes:document.getElementById('ac_notes').value.trim(),
    homework_enabled:document.getElementById('ac_homework_enabled').value==='true',
    meeting_url:document.getElementById('ac_meeting_url').value.trim(),
    host_key:document.getElementById('ac_host_key').value.trim(),
    needs_recording:document.getElementById('ac_recording').value==='yes',
  };

  try{
    let courseId;
    if(editingId){
      await sb(`/rest/v1/courses?id=eq.${editingId}`,'PATCH',courseData);
      const idx=cachedCourses.findIndex(c=>c.id===editingId);
      if(idx>=0) cachedCourses[idx]={...cachedCourses[idx],...courseData};
      courseId=editingId;

      // ── 编辑模式：按 session_number 对应更新已有课次，不删除重建，保留 id 不变 ──
      const existing=cachedSessions.filter(s=>s.course_id===editingId).sort((a,b)=>a.session_number-b.session_number);
      const newDates=dates; // 已在上方按新的 first_session_date/weekdays/total 重新生成

      if(newDates.length < existing.length){
        // 课次数量减少：检查被砍掉的部分是否已有出席记录
        const toRemove=existing.slice(newDates.length);
        const toRemoveIds=toRemove.map(s=>s.id);
        const records=await sb(`/rest/v1/session_records?session_id=in.(${toRemoveIds.map(i=>`"${i}"`).join(',')})&select=id`).catch(()=>[]);
        if(records.length){
          alert(`无法保存：第${toRemove[0].session_number}回及之后已有出席/作业记录，不能减少课次数量。请先确认是否真的要减少回数。`);
          return;
        }
        // 没有记录，可以安全删除多余课次
        await sb(`/rest/v1/course_sessions?id=in.(${toRemoveIds.map(i=>`"${i}"`).join(',')})`,'DELETE');
        cachedSessions=cachedSessions.filter(s=>!toRemoveIds.includes(s.id));
      }

      // 更新已有课次（按 session_number 对应，id 不变，关联不断）
      const updateCount=Math.min(newDates.length, existing.length);
      for(let i=0;i<updateCount;i++){
        const detail=detailRows.find(r=>r.num===i+1)||{};
        const mainTeacher=courseData.teacher;
        const patch={
          course_name:name, major:majors,
          session_date:newDates[i],
          time_range:courseData.time_range,
          actual_hours:courseData.actual_hours,
          homework_enabled:courseData.homework_enabled,
        };
        // 单回名称/任课老师只在明确填写时才覆盖，避免清空已有的个别设置
        if(hasDetails){
          patch.session_title=detail.title||'';
          patch.teacher=detail.teacher||mainTeacher;
          patch.session_teacher=detail.teacher||mainTeacher;
        }
        await sb(`/rest/v1/course_sessions?id=eq.${existing[i].id}`,'PATCH',patch);
        Object.assign(existing[i],patch);
      }

      // 课次数量增加：新增超出部分
      if(newDates.length > existing.length){
        const confirmed=document.getElementById('ac_confirm_publish')?.checked ?? (existing[0]?.confirmed||false);
        const addRows=newDates.slice(existing.length).map((date,j)=>{
          const i=existing.length+j;
          const detail=detailRows.find(r=>r.num===i+1)||{};
          const mainTeacher=courseData.teacher;
          return {
            id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,4)}`,
            course_id:courseId,course_name:name,major:majors,
            session_date:date,session_number:i+1,
            time_range:courseData.time_range,
            actual_hours:courseData.actual_hours,
            teacher:detail.teacher||mainTeacher,
            session_title:detail.title||'',
            session_teacher:detail.teacher||mainTeacher,
            homework_enabled:courseData.homework_enabled||false,
            confirmed
          };
        });
        for(let i=0;i<addRows.length;i+=20){
          const chunk=addRows.slice(i,i+20);
          const sres=await sb('/rest/v1/course_sessions','POST',chunk);
          cachedSessions.push(...(Array.isArray(sres)?sres:chunk));
        }
      }

      closeModal('addCourseModal');
      renderCoursesPage(document.getElementById('mainContent'));
      alert('课程信息已更新，已同步到所有相关页面');
      return;
    } else {
      courseId=`c-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
      const res=await sb('/rest/v1/courses','POST',[{...courseData,id:courseId}]);
      cachedCourses.push(Array.isArray(res)?res[0]:{...courseData,id:courseId});
    }
    // 新增课程时生成课次
    if(dates.length){
      const confirmed=document.getElementById('ac_confirm_publish')?.checked||false;
      const sessions=dates.map((date,i)=>{
        const detail=detailRows.find(r=>r.num===i+1)||{};
        const mainTeacher=courseData.teacher;
        return {
          id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,4)}`,
          course_id:courseId,course_name:name,major:majors,
          session_date:date,session_number:i+1,
          time_range:courseData.time_range,
          actual_hours:courseData.actual_hours,
          teacher:detail.teacher||mainTeacher,
          session_title:detail.title||'',
          session_teacher:detail.teacher||mainTeacher,
          confirmed
        };
      });
      for(let i=0;i<sessions.length;i+=20){
        const chunk=sessions.slice(i,i+20).map(s=>({...s,homework_enabled:courseData.homework_enabled||false}));
        const sres=await sb('/rest/v1/course_sessions','POST',chunk);
        cachedSessions.push(...(Array.isArray(sres)?sres:chunk));
      }
    }
    closeModal('addCourseModal');
    renderCoursesPage(document.getElementById('mainContent'));
    alert('添加成功！已生成 ' + dates.length + ' 个课次');
  }catch(e){alert('保存失败：'+e.message)}
}

function acPopulateRows(rows){
  document.getElementById('ac_details_body').innerHTML='';
  rows.forEach(r=>acAddRow(r));
}
function openEditCourse(id){
  const c=cachedCourses.find(x=>x.id===id);
  if(!c) return;
  document.getElementById('ec_id').value=id;
  document.getElementById('ec_name').value=c.name||'';
  document.getElementById('ec_period').value=c.period||'7月期';
  document.getElementById('ec_course_type').value=c.course_type||'';
  document.getElementById('ec_teacher').value=c.teacher||'';
  document.getElementById('ec_campus').value=c.campus||'';
  document.getElementById('ec_delivery').value=c.delivery||'';
  document.getElementById('ec_weekdays').value=c.weekdays||'';
  document.getElementById('ec_time_range').value=c.time_range||'';
  document.getElementById('ec_actual_hours').value=c.actual_hours||'';
  document.getElementById('ec_total').value=c.total_sessions||'';
  document.getElementById('ec_first_date').value=c.first_session_date||'';
  document.getElementById('ec_notes').value=c.notes||'';
  document.getElementById('ec_homework_enabled').value=c.homework_enabled?'true':'false';
  document.getElementById('ec_meeting_url').value=c.meeting_url||'';
  document.getElementById('ec_host_key').value=c.host_key||'';
  document.getElementById('ec_recording').value = c.needs_recording ? 'yes' : 'no';
  document.getElementById('editCourseModal').classList.add('open');
}
async function saveEditCourse(){
  const id=document.getElementById('ec_id').value;
  const data={
    name:document.getElementById('ec_name').value.trim(),
    period:document.getElementById('ec_period').value,
    course_type:document.getElementById('ec_course_type').value.trim(),
    teacher:document.getElementById('ec_teacher').value.trim(),
    campus:document.getElementById('ec_campus').value.trim(),
    delivery:document.getElementById('ec_delivery').value,
    weekdays:document.getElementById('ec_weekdays').value.trim(),
    time_range:document.getElementById('ec_time_range').value.trim(),
    actual_hours:parseFloat(document.getElementById('ec_actual_hours').value)||null,
    total_sessions:parseInt(document.getElementById('ec_total').value)||0,
    first_session_date:document.getElementById('ec_first_date').value||null,
    notes:document.getElementById('ec_notes').value.trim(),
    homework_enabled:document.getElementById('ec_homework_enabled').value==='true',
    meeting_url:document.getElementById('ec_meeting_url').value.trim(),
    host_key:document.getElementById('ec_host_key').value.trim(),
    needs_recording:document.getElementById('ec_recording').value==='yes',
  };
  try{
    await sb(`/rest/v1/courses?id=eq.${id}`,'PATCH',data);
    const idx=cachedCourses.findIndex(c=>c.id===id);
    if(idx>=0) cachedCourses[idx]={...cachedCourses[idx],...data};
    closeModal('editCourseModal');
    renderCoursesPage(document.getElementById('mainContent'));
  }catch(e){alert('保存失败：'+e.message)}
}
async function regenerateSessions(){
  const id=document.getElementById('ec_id').value;
  const c=cachedCourses.find(x=>x.id===id);
  if(!c) return;
  const firstDate=document.getElementById('ec_first_date').value;
  const total=parseInt(document.getElementById('ec_total').value)||0;
  const wdStr=document.getElementById('ec_weekdays').value;
  const weekdays=parseWeekdays(wdStr);
  const timeRange=document.getElementById('ec_time_range').value.trim();
  if(!firstDate||!weekdays.length||!total){alert('请填写第一回日期、星期和回数');return}
  if(!confirm(`将删除该课程现有 ${cachedSessions.filter(s=>s.course_id===id).length} 个课次并重新生成 ${total} 个，是否继续？`))return;
  try{
    await sb(`/rest/v1/course_sessions?course_id=eq.${id}`,'DELETE');
    cachedSessions=cachedSessions.filter(s=>s.course_id!==id);
    const dates=generateSessionDatesFromFirst(firstDate,weekdays,total);
    const sessions=dates.map((date,i)=>({
      id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,4)}`,
      course_id:id,course_name:c.name,major:c.major,
      session_date:date,session_number:i+1,
      time_range:timeRange||c.time_range,teacher:c.teacher
    }));
    for(let i=0;i<sessions.length;i+=20){
      const chunk=sessions.slice(i,i+20);
      const res=await sb('/rest/v1/course_sessions','POST',chunk);
      cachedSessions.push(...(Array.isArray(res)?res:chunk));
    }
    // 同步保存新的first_session_date和total
    await sb(`/rest/v1/courses?id=eq.${id}`,'PATCH',{first_session_date:firstDate,total_sessions:total,weekdays:wdStr,time_range:timeRange});
    const idx=cachedCourses.findIndex(c=>c.id===id);
    if(idx>=0) Object.assign(cachedCourses[idx],{first_session_date:firstDate,total_sessions:total,weekdays:wdStr,time_range:timeRange});
    closeModal('editCourseModal');
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`已重新生成 ${sessions.length} 个课次`);
  }catch(e){alert('操作失败：'+e.message)}
}

// ── 复制到新期数 ──
function openCopyPeriod(courseId){
  const c=cachedCourses.find(x=>x.id===courseId);
  if(!c) return;
  document.getElementById('cp_source_ids').value=courseId;
  // 默认目标期为下一期
  const periods=['1月期','4月期','7月期','10月期'];
  const cur=c.period||'7月期';
  const next=periods[(periods.indexOf(cur)+1)%4];
  document.getElementById('cp_period').value=next;
  // 列出该课程的课次，每个显示一行让用户设置新第一回日期
  const sessions=cachedSessions.filter(s=>s.course_id===courseId).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  document.getElementById('cp_courses_list').innerHTML=`
    <div style="margin-bottom:10px;font-size:11px;color:var(--text-2)">
      课程：<strong>${c.name}</strong>　讲师：${c.teacher||''}　${c.total_sessions}回　${c.weekdays||''}
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <label style="font-size:11px;color:var(--text-2);white-space:nowrap">新第一回日期</label>
      <input type="date" id="cp_first_date" style="flex:1">
    </div>
    <div style="font-size:10px;color:var(--text-3);margin-top:6px">系统将按「${c.weekdays||'星期'}」自动生成 ${c.total_sessions} 次课</div>`;
  document.getElementById('copyPeriodModal').classList.add('open');
}
async function confirmCopyPeriod(){
  const courseId=document.getElementById('cp_source_ids').value;
  const newPeriod=document.getElementById('cp_period').value;
  const newFirstDate=document.getElementById('cp_first_date').value;
  if(!newFirstDate){alert('请填写新第一回日期');return}
  const src=cachedCourses.find(c=>c.id===courseId);
  if(!src) return;
  const weekdays=parseWeekdays(src.weekdays||'');
  if(!weekdays.length){alert('原课程未设置星期，无法自动生成日期');return}
  const dates=generateSessionDatesFromFirst(newFirstDate,weekdays,src.total_sessions||0);
  if(!dates.length){alert('无法生成课次，请检查日期和星期设置');return}
  const btn=document.querySelector('#copyPeriodModal .btn-primary');
  btn.textContent='生成中…';btn.disabled=true;
  try{
    const newId=`c-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
    const newCourse={...src,id:newId,period:newPeriod,first_session_date:newFirstDate};
    delete newCourse.created_at;
    const res=await sb('/rest/v1/courses','POST',[newCourse]);
    cachedCourses.push(Array.isArray(res)?res[0]:newCourse);
    const sessions=dates.map((date,i)=>({
      id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,4)}`,
      course_id:newId,course_name:src.name,major:src.major,
      session_date:date,session_number:i+1,
      time_range:src.time_range,teacher:src.teacher
    }));
    for(let i=0;i<sessions.length;i+=20){
      const chunk=sessions.slice(i,i+20);
      const sres=await sb('/rest/v1/course_sessions','POST',chunk);
      cachedSessions.push(...(Array.isArray(sres)?sres:chunk));
    }
    coursesPeriodFilter=newPeriod;
    closeModal('copyPeriodModal');
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`已复制到${newPeriod}，生成 ${sessions.length} 次课`);
  }catch(e){alert('操作失败：'+e.message);btn.textContent='复制并生成';btn.disabled=false}
}

// ── 休讲调整（标记休讲 + 内容顺延 + 末尾补课）──
function openReschedule(sessionId){
  const s=cachedSessions.find(x=>x.id===sessionId);
  if(!s) return;
  if(s.is_cancelled){ alert('该课次已标记为休讲'); return; }
  document.getElementById('rs_session_id').value=sessionId;
  document.getElementById('reschedule_sub').textContent=`${s.course_name} 第${s.session_number}回 · ${s.session_date}`;
  document.getElementById('rs_orig_date').value=s.session_date;
  document.getElementById('rs_reason').value='老师请假';
  document.getElementById('rs_note').value='';
  document.getElementById('rescheduleModal').classList.add('open');
}
async function confirmReschedule(){
  const id=document.getElementById('rs_session_id').value;
  const reason=document.getElementById('rs_reason').value;
  const note=document.getElementById('rs_note').value;
  const target=cachedSessions.find(x=>x.id===id);
  if(!target){alert('找不到该课次');return}

  const courseId=target.course_id;
  const allSessions=cachedSessions.filter(s=>s.course_id===courseId).sort((a,b)=>a.session_number-b.session_number);
  const idx=allSessions.findIndex(s=>s.id===id);
  if(idx===-1){alert('找不到该课次');return}

  const course=cachedCourses.find(c=>c.id===courseId);
  const weekdays=parseWeekdays(course?.weekdays||'');
  const lastSession=allSessions[allSessions.length-1];
  const after=allSessions.slice(idx+1); // 休讲之后的所有课次（日期不变，内容要整体前移一位）

  if(!confirm(`确认将 ${target.session_date}（第${target.session_number}回）标记为休讲？\n后续课次的「第几回」与内容将整体顺延一位，并在末尾新增一节课补齐总回数。`)) return;

  try{
    // 1. 标记当前课次为休讲（日期不变，不再计入回数序列，内容清空）
    await sb(`/rest/v1/course_sessions?id=eq.${id}`,'PATCH',{
      is_cancelled:true,
      cancel_reason:reason,
      cancel_note:note||null,
      session_title:'休讲',
      session_teacher:'',
    });
    target.is_cancelled=true; target.cancel_reason=reason; target.cancel_note=note||null;
    target.session_title='休讲'; target.session_teacher='';

    // 2. 末尾新增一节课，日期＝最后一节课之后下一个符合星期规律的日期，内容留空待填
    let newDate=new Date(lastSession.session_date+'T12:00:00');
    do{ newDate.setDate(newDate.getDate()+1); } while(weekdays.length && !weekdays.includes(newDate.getDay()));
    const newDateStr=newDate.getFullYear()+'-'+String(newDate.getMonth()+1).padStart(2,'0')+'-'+String(newDate.getDate()).padStart(2,'0');

    // 3. 顺延：after 中每节课的「内容」往前挪一位（即 after[i] 显示 原本 after[i] 自己的 session_number 减1 对应的内容，
    //    实际操作＝把 after 数组里的 session_number 整体减1，内容字段（session_title/teacher/session_teacher）保持跟随各自记录本身，
    //    因为内容原本就和 session_number 是绑定生成的，这里只需把 session_number 集体减 1，
    //    新增的最后一节用原来空出来的最大 session_number。
    for(const s of after){
      const patch={ session_number: s.session_number - 1 };
      await sb(`/rest/v1/course_sessions?id=eq.${s.id}`,'PATCH',patch);
      s.session_number = patch.session_number;
    }

    const newSession={
      id:`s-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      course_id:courseId,course_name:lastSession.course_name,major:lastSession.major,
      session_date:newDateStr,session_number:lastSession.session_number,
      time_range:lastSession.time_range,actual_hours:lastSession.actual_hours,
      teacher:lastSession.teacher,session_title:'',session_teacher:lastSession.session_teacher,
      homework_enabled:lastSession.homework_enabled,confirmed:lastSession.confirmed,
      is_cancelled:false
    };
    const sres=await sb('/rest/v1/course_sessions','POST',[newSession]);
    cachedSessions.push(Array.isArray(sres)?sres[0]:newSession);

    closeModal('rescheduleModal');
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`已将 ${target.session_date} 标记为休讲，后续课次回数已顺延，并在 ${newDateStr} 新增补课（第${newSession.session_number}回，请填写内容）`);
  }catch(e){alert('操作失败：'+e.message)}
}
// ── 出席・作业（see attendance.js）──

// ── Shared ──
function closeModal(id){document.getElementById(id).classList.remove('open')}
document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',function(e){if(e.target===this)this.classList.remove('open')}));

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

// ══════════════════════════════════
// SCHEDULE (课程预定) PAGE
// ══════════════════════════════════
let cachedScheduleSlots=[], cachedTeacherAvail=[], cachedTeachers=[];
let schedPeriodFilter='all', schedTypeFilter='all', schedCourseFilter='all';

function renderSchedulePage(mc){
  // 带年份的期数列表
  const allPeriods=[...new Map(cachedCourses
    .filter(c=>c.period&&c.first_session_date)
    .map(c=>{const year=c.first_session_date.slice(0,4);const key=`${year}年${c.period}`;return [key,{key,period:c.period,year}]})
  ).values()].sort((a,b)=>a.key.localeCompare(b.key));

  // 按属性+期数+课程筛选
  let filteredCourses=cachedCourses;
  if(schedTypeFilter==='共通课') filteredCourses=filteredCourses.filter(c=>c.course_type?.includes('共通'));
  else if(schedTypeFilter==='专业课') filteredCourses=filteredCourses.filter(c=>c.course_type&&!c.course_type.includes('共通')&&!c.course_type.includes('VIP'));
  else if(schedTypeFilter==='VIP') filteredCourses=filteredCourses.filter(c=>c.course_type?.includes('VIP'));

  if(schedPeriodFilter!=='all'){
    const [filterYear,filterPeriod]=schedPeriodFilter.match(/(\d{4})年(.+)/)?.slice(1)||[];
    if(filterYear&&filterPeriod) filteredCourses=filteredCourses.filter(c=>c.period===filterPeriod&&c.first_session_date?.startsWith(filterYear));
  }
  if(schedCourseFilter!=='all') filteredCourses=filteredCourses.filter(c=>c.id===schedCourseFilter);

  // 只显示有时间槽的课程的槽
  const filteredSlots=schedCourseFilter==='all'
    ?cachedScheduleSlots.filter(sl=>filteredCourses.find(c=>c.name===sl.course_name))
    :cachedScheduleSlots.filter(sl=>filteredCourses.find(c=>c.name===sl.course_name));

  const showPeriod=schedTypeFilter!=='VIP';

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">课程预定</div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-danger btn-sm" onclick="clearAllScheduleSlots()" style="font-size:11px">🗑 清空全部</button>
      <button class="btn btn-primary btn-sm" onclick="switchPage('teachers')">👤 管理老师</button>
      <button class="btn btn-outline btn-sm" onclick="openCreateSlots()">＋ 创建时间槽</button>
    </div>
  </div>

  <div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap;align-items:flex-start">
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">课程属性</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${['all','专业课','共通课','VIP'].map((t,i)=>`<div class="filter-chip${schedTypeFilter===t?' active':''}" onclick="setSchedType('${t}',this)" style="font-size:11px;padding:3px 10px">${i===0?'全部':t}</div>`).join('')}
      </div>
    </div>
    ${showPeriod?`<div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">期数</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <div class="filter-chip${schedPeriodFilter==='all'?' active':''}" onclick="setSchedPeriod('all',this)" style="font-size:11px;padding:3px 10px">全部</div>
        ${allPeriods.map(p=>`<div class="filter-chip${schedPeriodFilter===p.key?' active':''}" onclick="setSchedPeriod('${p.key}',this)" style="font-size:11px;padding:3px 10px">${p.key}</div>`).join('')}
      </div>
    </div>`:''}
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">课程</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <div class="filter-chip${schedCourseFilter==='all'?' active':''}" onclick="setSchedCourse('all',this)" style="font-size:11px;padding:3px 10px">全部</div>
        ${filteredCourses.slice(0,20).map(c=>`<div class="filter-chip${schedCourseFilter===c.id?' active':''}" onclick="setSchedCourse('${c.id}',this)" style="font-size:11px;padding:3px 10px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.name}（${c.first_session_date?.slice(0,4)||''}年${c.period||''}）">${c.name}</div>`).join('')}
      </div>
    </div>
  </div>

  ${!filteredSlots.length
    ?`<div class="empty" style="padding:60px 0">
        暂无排班时间槽<br>
        <span style="font-size:11px;color:var(--text-3);margin-top:6px;display:block">点击右上角「创建时间槽」，为需要确认老师的课次发送排班链接</span>
      </div>`
    :renderScheduleSlots(filteredSlots)
  }`;
}

function renderScheduleSlots(slots){
  const byCourse={};
  (slots||cachedScheduleSlots).forEach(slot=>{
    if(!byCourse[slot.course_name]) byCourse[slot.course_name]=[];
    byCourse[slot.course_name].push(slot);
  });

  return `<div style="display:flex;flex-direction:column;gap:16px">
    ${Object.entries(byCourse).map(([courseName,courseSlots])=>{
      const course=cachedCourses.find(c=>c.name===courseName)||{};
      const color=courseColor(courseName);
      const yearStr=course.first_session_date?.slice(0,4)||'';
      const periodStr=course.period||'';
      // 按日期去重
      const byDate={};
      courseSlots.forEach(slot=>{
        if(!byDate[slot.session_date]) byDate[slot.session_date]={session_date:slot.session_date,time_range:slot.time_range,slots:[]};
        byDate[slot.session_date].slots.push(slot);
      });
      const dateSessions=Object.values(byDate).sort((a,b)=>a.session_date.localeCompare(b.session_date));
      // 从 course_sessions 读确认结果
      const confirmedFromCourse=cachedSessions.filter(s=>s.course_name===courseName&&s.session_title&&s.session_teacher);
      const confirmedCount=confirmedFromCourse.length;
      const totalCount=dateSessions.length;
      const allConfirmed=confirmedCount>=totalCount&&totalCount>0;

      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden">
        <div style="background:${color.bg};color:${color.text};padding:8px 14px;display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;font-weight:600">${courseName}</span>
            ${yearStr?`<span style="font-size:10px;opacity:.6;background:rgba(0,0,0,.08);border-radius:2px;padding:1px 5px">${yearStr}年${periodStr}</span>`:''}
            <span style="font-size:10px;opacity:.7">已确认 ${confirmedCount}/${totalCount} 回</span>
            ${allConfirmed?`<span style="font-size:10px;background:rgba(42,158,106,.25);color:#1a5a3a;border-radius:2px;padding:1px 6px;font-weight:600">✓ 排课完成</span>`:''}
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <button onclick="copyTeacherLinks('${courseName}')" style="font-size:10px;background:rgba(255,255,255,.35);border:1px solid rgba(0,0,0,.15);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;color:${color.text}">📋 复制链接</button>
            <button onclick="openScheduleSummary('${courseName}')" style="font-size:10px;background:rgba(255,255,255,.5);border:1px solid rgba(0,0,0,.2);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;color:${color.text};font-weight:600">📊 排课汇总</button>
            ${allConfirmed?`<button onclick="openCompleteSchedule('${courseName}')" style="font-size:10px;background:rgba(42,158,106,.2);border:1px solid rgba(42,158,106,.4);border-radius:2px;padding:2px 8px;cursor:pointer;font-family:inherit;color:#1a5a3a;font-weight:600">✓ 归档</button>`:''}
          </div>
        </div>
        <table class="student-table" style="margin:0">
          <thead><tr>
            <th style="width:55px">序号</th><th style="width:100px">日期</th><th style="width:120px">时间</th>
            <th>可上老师</th><th style="width:150px">单回内容</th><th style="width:130px">确认老师</th><th style="width:36px"></th>
          </tr></thead>
          <tbody>
            ${dateSessions.map((ds,idx)=>{
              const f=fmtSessionDate(ds.session_date);
              // 从 course_sessions 读确认结果
              const csSession=cachedSessions.find(s=>s.course_name===courseName&&s.session_date===ds.session_date&&s.session_title);
              const confirmedTitle=csSession?.session_title||'';
              const confirmedTeacher=csSession?.session_teacher||'';
              const isConfirmed=!!(confirmedTitle&&confirmedTeacher);
              // 可上老师
              const allAvailTeachers=[];
              ds.slots.forEach(slot=>{
                cachedTeacherAvail.filter(a=>a.slot_id===slot.id&&a.available).forEach(a=>{
                  if(!allAvailTeachers.find(x=>x.name===a.teacher_name))
                    allAvailTeachers.push({name:a.teacher_name,time:a.available_time||''});
                });
              });
              const allTeacherNames=[...new Set(ds.slots.flatMap(sl=>sl.teacher_names||[]))];
              const firstSlot=ds.slots[0];
              const slotIds=JSON.stringify(ds.slots.map(s=>s.id));
              return `<tr style="${isConfirmed?'background:var(--ok-bg)':''}">
                <td style="font-size:11px;color:var(--text-3)">${idx+1}</td>
                <td style="font-size:12px;font-weight:600">${f.short} <span style="color:${f.dowColor};font-size:10px">${f.dow}</span></td>
                <td style="font-size:11px">${ds.time_range||''}</td>
                <td>
                  ${allAvailTeachers.length
                    ?allAvailTeachers.map(t=>`<span style="font-size:10px;background:var(--ok-bg);color:var(--ok);border-radius:2px;padding:1px 6px;margin:1px;display:inline-block">${t.name}${t.time?' · '+t.time:''}</span>`).join('')
                    :`<span style="font-size:11px;color:var(--text-3)">等待回复</span>`}
                </td>
                <td style="font-size:11px;${isConfirmed?'color:var(--ok);font-weight:600':'color:var(--text-3)'}">
                  ${confirmedTitle||'—'}
                </td>
                <td>
                  ${isConfirmed
                    ?`<span style="color:var(--ok);font-size:11px;font-weight:600">✓ ${confirmedTeacher}</span>`
                    :`<select onchange="confirmSlotTeacher('${firstSlot?.id}',this.value)" style="font-size:11px;padding:3px 6px;width:100%">
                        <option value="">— 选择老师 —</option>
                        ${allAvailTeachers.map(t=>`<option value="${t.name}">${t.name}</option>`).join('')}
                        ${allTeacherNames.filter(n=>!allAvailTeachers.find(x=>x.name===n)).map(n=>`<option value="${n}">${n}（未回复）</option>`).join('')}
                      </select>`}
                </td>
                <td><button class="btn-ghost" onclick="deleteSessionSlots(${slotIds})">✕</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
    }).join('')}
  </div>`;
}


function setSchedType(t,el){schedTypeFilter=t;if(t==='VIP')schedPeriodFilter='all';renderSchedulePage(document.getElementById('mainContent'))}
function setSchedPeriod(p,el){schedPeriodFilter=p;renderSchedulePage(document.getElementById('mainContent'))}
function setSchedCourse(id,el){schedCourseFilter=id;renderSchedulePage(document.getElementById('mainContent'))}
async function clearAllScheduleSlots(){
  if(!confirm('确定清空所有排班时间槽和老师回复数据？此操作不可恢复。'))return;
  try{
    await sb('/rest/v1/teacher_availability?id=neq.null','DELETE').catch(()=>{});
    await sb('/rest/v1/schedule_slots?id=neq.null','DELETE');
    cachedScheduleSlots=[];cachedTeacherAvail=[];
    renderSchedulePage(document.getElementById('mainContent'));
    alert('已清空所有排班数据');
  }catch(e){alert('操作失败：'+e.message)}
}

async function confirmSlotTeacher(slotId,teacher){
  if(!teacher) return;
  try{
    await sb(`/rest/v1/schedule_slots?id=eq.${slotId}`,'PATCH',{confirmed_teacher:teacher,status:'confirmed'});
    const slot=cachedScheduleSlots.find(s=>s.id===slotId);
    if(slot){slot.confirmed_teacher=teacher;slot.status='confirmed'}
    // 同步到 course_sessions
    if(slot?.session_id){
      await sb(`/rest/v1/course_sessions?id=eq.${slot.session_id}`,'PATCH',{session_teacher:teacher});
      const sess=cachedSessions.find(s=>s.id===slot.session_id);
      if(sess) sess.session_teacher=teacher;
    }
    renderSchedulePage(document.getElementById('mainContent'));
  }catch(e){alert('保存失败：'+e.message)}
}

async function unconfirmSlot(slotId){
  try{
    await sb(`/rest/v1/schedule_slots?id=eq.${slotId}`,'PATCH',{confirmed_teacher:null,confirmed_title:null,status:'pending'});
    const slot=cachedScheduleSlots.find(s=>s.id===slotId);
    if(slot){slot.confirmed_teacher=null;slot.confirmed_title=null;slot.status='pending'}
    // also clear session_teacher on course_session
    if(slot?.session_id) await sb(`/rest/v1/course_sessions?id=eq.${slot.session_id}`,'PATCH',{session_teacher:''}).catch(()=>{});
    renderSchedulePage(document.getElementById('mainContent'));
  }catch(e){alert('操作失败：'+e.message)}
}

async function deleteSessionSlots(slotIds){
  if(!confirm('确定删除此回的所有排班时间槽？'))return;
  try{
    for(const id of slotIds){
      await sb(`/rest/v1/teacher_availability?slot_id=eq.${id}`,'DELETE').catch(()=>{});
      await sb(`/rest/v1/schedule_slots?id=eq.${id}`,'DELETE');
      cachedTeacherAvail=cachedTeacherAvail.filter(a=>a.slot_id!==id);
      cachedScheduleSlots=cachedScheduleSlots.filter(s=>s.id!==id);
    }
    renderSchedulePage(document.getElementById('mainContent'));
  }catch(e){alert('删除失败：'+e.message)}
}

function copyTeacherLinks(courseName){
  const slots=cachedScheduleSlots.filter(s=>s.course_name===courseName);
  const teacherNames=[...new Set(slots.flatMap(s=>s.teacher_names||[]))];
  const base=location.origin+location.pathname.replace(/\/admin\/.*$/,'/teacher/');
  const links=teacherNames.map(name=>`${name}：${base}?teacher=${encodeURIComponent(name)}`).join('\n');
  navigator.clipboard.writeText(links).then(()=>alert('已复制所有老师链接：\n\n'+links)).catch(()=>alert('链接：\n\n'+links));
}

// ── 创建时间槽 modal ──
// ── 创建时间槽 ──
let csTypeFilter='全部';
let csSelectedTitles=new Set();

function openCreateSlots(){
  csTypeFilter='全部';
  csSelectedTitles=new Set();
  document.getElementById('cs_time_range_2').value='';
  document.getElementById('cs_weekday_2').value='';
  // init type chips
  document.querySelectorAll('#cs_type_chips .filter-chip').forEach((el,i)=>{
    el.classList.toggle('active',i===0);
  });
  csPopulatePeriods();
  csFilterCourses();
  document.getElementById('createSlotsModal').classList.add('open');
}

function csSetType(t,el){
  csTypeFilter=t;
  document.querySelectorAll('#cs_type_chips .filter-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  csPopulatePeriods();
  csFilterCourses();
}

function csPopulatePeriods(){
  let courses=cachedCourses;
  if(csTypeFilter!=='全部'){
    if(csTypeFilter==='共通课') courses=courses.filter(c=>c.course_type?.includes('共通'));
    else if(csTypeFilter==='专业课') courses=courses.filter(c=>c.course_type&&!c.course_type.includes('共通')&&!c.course_type.includes('VIP'));
    else if(csTypeFilter==='VIP') courses=courses.filter(c=>c.course_type?.includes('VIP'));
  }
  const periods=[...new Map(courses.filter(c=>c.period&&c.first_session_date).map(c=>{
    const year=c.first_session_date.slice(0,4);
    const key=`${year}年${c.period}`;
    return [key,key];
  })).values()].sort();
  const sel=document.getElementById('cs_period');
  sel.innerHTML=`<option value="">全部期数</option>`+periods.map(p=>`<option value="${p}">${p}</option>`).join('');
}

function csFilterCourses(){
  let courses=cachedCourses;
  if(csTypeFilter!=='全部'){
    if(csTypeFilter==='共通课') courses=courses.filter(c=>c.course_type?.includes('共通'));
    else if(csTypeFilter==='专业课') courses=courses.filter(c=>c.course_type&&!c.course_type.includes('共通')&&!c.course_type.includes('VIP'));
    else if(csTypeFilter==='VIP') courses=courses.filter(c=>c.course_type?.includes('VIP'));
  }
  const periodVal=document.getElementById('cs_period').value;
  if(periodVal){
    const [filterYear,filterPeriod]=periodVal.match(/(\d{4})年(.+)/)?.slice(1)||[];
    if(filterYear&&filterPeriod) courses=courses.filter(c=>c.period===filterPeriod&&c.first_session_date?.startsWith(filterYear));
  }
  const sel=document.getElementById('cs_course');
  sel.innerHTML=courses.length
    ?courses.map(c=>`<option value="${c.id}">${c.name}（${c.first_session_date?.slice(0,4)||''}年${c.period||''}）</option>`).join('')
    :'<option value="">暂无匹配课程</option>';
  onCreateSlotCourseChange();
}

function onCreateSlotCourseChange(){
  csSelectedTitles=new Set();
  const courseId=document.getElementById('cs_course').value;
  const course=cachedCourses.find(c=>c.id===courseId);
  if(!course){
    document.getElementById('cs_sessions_preview').innerHTML='<span style="color:var(--text-3)">请先选择课程</span>';
    document.getElementById('cs_titles_select').innerHTML='<span style="font-size:11px;color:var(--text-3)">选择课程后显示</span>';
    document.getElementById('cs_teachers_list').innerHTML='';
    return;
  }
  const sessions=cachedSessions.filter(s=>s.course_id===courseId).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  const existingIds=new Set(cachedScheduleSlots.map(s=>s.session_id));
  const newCount=sessions.filter(s=>!existingIds.has(s.id)).length;

  document.getElementById('cs_sessions_preview').innerHTML=sessions.length
    ?`共 <strong>${sessions.length}</strong> 个课次，<strong style="color:var(--ok)">${newCount}</strong> 个待创建，${sessions.length-newCount} 个已存在<br>
      <span style="color:var(--text-3)">${sessions.slice(0,6).map(s=>{const d=new Date(s.session_date+'T12:00:00');return `${d.getMonth()+1}/${d.getDate()}`}).join(' · ')}${sessions.length>6?` … 共${sessions.length}回`:''}</span>`
    :'该课程暂无课次';

  // 从 session_teacher 推算每位老师负责的内容
  const teacherTitleMap={};
  sessions.forEach(s=>{
    if(!s.session_teacher) return;
    const teachers=s.session_teacher.split(/[/／,，]/).map(t=>t.trim()).filter(Boolean);
    teachers.forEach(t=>{
      if(!teacherTitleMap[t]) teacherTitleMap[t]=new Set();
      if(s.session_title) teacherTitleMap[t].add(s.session_title);
    });
  });
  const hasTeacherMapping=Object.keys(teacherTitleMap).length>0;

  // 显示老师-内容对应（自动推算）
  document.getElementById('cs_titles_select').innerHTML=hasTeacherMapping
    ?`<div style="width:100%">
        <div style="font-size:10px;color:var(--ok);margin-bottom:6px">✓ 已从单回明细自动识别老师和内容对应关系</div>
        ${Object.entries(teacherTitleMap).map(([teacher,titles])=>`
          <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:5px">
            <span style="font-size:11px;font-weight:600;min-width:60px;padding-top:2px">${teacher}</span>
            <div style="display:flex;flex-wrap:wrap;gap:3px">
              ${[...titles].map(t=>`<span style="background:var(--surface);border:1px solid var(--border);border-radius:2px;padding:1px 7px;font-size:10px">${t}</span>`).join('')}
              ${!titles.size?'<span style="font-size:10px;color:var(--text-3)">全部内容</span>':''}
            </div>
          </div>`).join('')}
      </div>`
    :'<span style="font-size:11px;color:var(--text-3)">该课程单回明细未填写任课老师，请手动选择老师</span>';

  // 老师列表：有明细的自动勾选，没有的显示全部让手动选
  const autoTeachers=Object.keys(teacherTitleMap);
  document.getElementById('cs_teachers_list').innerHTML=cachedTeachers.length
    ?cachedTeachers.map(t=>{
        const isAuto=autoTeachers.includes(t.name);
        const titles=teacherTitleMap[t.name]?[...teacherTitleMap[t.name]]:[];
        return `<label style="display:flex;align-items:center;gap:5px;padding:4px 8px;background:${isAuto?'var(--ok-bg)':'var(--bg)'};border:1px solid ${isAuto?'var(--ok)':'var(--border-light)'};border-radius:2px;cursor:pointer;font-size:11px">
          <input type="checkbox" value="${t.name}" ${isAuto?'checked':''} data-titles="${titles.join('|')}" style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0;min-width:16px">
          ${t.name}${isAuto&&titles.length?`<span style="font-size:9px;color:var(--ok)">(${titles.join('・')})</span>`:''}
        </label>`;
      }).join('')
    :'<span style="font-size:11px;color:var(--text-3)">暂无老师，请先在「管理老师」中添加</span>';
}

async function confirmCreateSlots(){
  const courseId=document.getElementById('cs_course').value;
  const course=cachedCourses.find(c=>c.id===courseId);
  if(!course){alert('请选择课程');return}
  const checkedTeachers=[...document.querySelectorAll('#cs_teachers_list input[type=checkbox]:checked')];
  if(!checkedTeachers.length){alert('请选择至少一位候选老师');return}
  const timeRange2=document.getElementById('cs_time_range_2').value.trim();
  const weekday2=document.getElementById('cs_weekday_2')?.value||'';
  const sessions=cachedSessions.filter(s=>s.course_id===courseId).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  const existingIds=new Set(cachedScheduleSlots.map(s=>s.session_id));
  const newSessions=sessions.filter(s=>!existingIds.has(s.id));
  if(!newSessions.length){alert('该课程所有课次已创建过时间槽');return}

  const btn=document.getElementById('createSlotsConfirmBtn');
  btn.textContent='创建中…';btn.disabled=true;
  try{
    // 为每位老师分别创建slots，带上他自己的内容
    for(const cb of checkedTeachers){
      const teacherName=cb.value;
      const titles=cb.dataset.titles?cb.dataset.titles.split('|').filter(Boolean):[];
      // 如果没有titles（手动选的），用所有单回内容
      const allTitles=titles.length?titles:[...new Set(sessions.map(s=>s.session_title).filter(Boolean))];
      const slots=newSessions.map(s=>({
        id:`sl-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
        session_id:s.id,course_name:course.name,
        session_date:s.session_date,session_number:s.session_number,
        time_range:s.time_range||course.time_range||'',
        time_range_2:timeRange2||null,
        weekday_2:weekday2||null,
        teacher_names:[teacherName],
        session_titles:allTitles.length?allTitles:null,
        status:'pending'
      }));
      for(let i=0;i<slots.length;i+=20){
        const chunk=slots.slice(i,i+20);
        const res=await sb('/rest/v1/schedule_slots','POST',chunk);
        cachedScheduleSlots.push(...(Array.isArray(res)?res:chunk));
      }
      await new Promise(r=>setTimeout(r,80));
    }
    closeModal('createSlotsModal');
    renderSchedulePage(document.getElementById('mainContent'));
    alert(`已为 ${checkedTeachers.map(cb=>cb.value).join('・')} 分别创建排班时间槽`);
  }catch(e){alert('创建失败：'+e.message);btn.textContent='确认创建';btn.disabled=false}
}

// ── 排课汇总 ──
let arrangementDraft={}; // {slotId: {teacher, title}}

function openScheduleSummary(courseName){
  const slots=cachedScheduleSlots.filter(s=>s.course_name===courseName).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  const course=cachedCourses.find(c=>c.name===courseName)||{};
  const year=course.first_session_date?.slice(0,4)||'';
  const uniqueDates=[...new Map(slots.map(s=>[s.session_date,s])).values()];
  document.getElementById('scheduleSummarySub').textContent=`${courseName}\u3000${year}年${course.period||''}\u3000共${uniqueDates.length}课次`;
  arrangementDraft={};
  // 只恢复本次排课汇总手动确认的（不从course_sessions读旧数据）
  renderSummaryBody(slots,courseName);
  document.getElementById('scheduleSummaryModal').classList.add('open');
}

function renderSummaryBody(slots,courseName){
  const allTitles=[...new Set(slots.flatMap(s=>s.session_titles||[]))];
  // 按日期去重
  const dateMap=new Map();
  slots.forEach(slot=>{
    if(!dateMap.has(slot.session_date)) dateMap.set(slot.session_date,{date:slot.session_date,time_range:slot.time_range,slots:[]});
    dateMap.get(slot.session_date).slots.push(slot);
  });
  const dates=[...dateMap.values()].sort((a,b)=>a.date.localeCompare(b.date));

  // 老师-内容对应（优先用老师回复里的preferred_titles）
  const teacherTitleMap={};
  cachedTeacherAvail.filter(a=>slots.find(s=>s.id===a.slot_id)).forEach(a=>{
    if(!teacherTitleMap[a.teacher_name]) teacherTitleMap[a.teacher_name]=new Set();
    if(a.preferred_titles?.length) a.preferred_titles.forEach(t=>teacherTitleMap[a.teacher_name].add(t));
    else (slots.find(s=>s.id===a.slot_id)?.session_titles||[]).forEach(t=>teacherTitleMap[a.teacher_name].add(t));
  });

  document.getElementById('scheduleSummaryBody').innerHTML=`
  ${allTitles.length?`<div style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:8px 12px;margin-bottom:12px;font-size:11px;color:var(--text-2)">
    本期单回内容：${allTitles.map(t=>`<span style="background:var(--surface);border:1px solid var(--border);border-radius:2px;padding:1px 7px;margin-right:4px">${t}</span>`).join('')}
  </div>`:''}
  <table class="student-table" style="margin:0">
    <thead><tr>
      <th style="width:50px">序号</th><th style="width:90px">日期</th><th style="width:110px">时间</th>
      <th>当天有空的老师</th><th style="width:150px">单回内容</th><th style="width:150px">上课老师</th><th style="width:55px">状态</th>
    </tr></thead>
    <tbody>
      ${dates.map((d,idx)=>{
        const f=fmtSessionDate(d.date);
        const draft=arrangementDraft[d.date]||{};
        const isConfirmed=!!(draft.session_id||draft.confirmed);
        const availOnDate=[];
        d.slots.forEach(slot=>{
          cachedTeacherAvail.filter(a=>a.slot_id===slot.id&&a.available).forEach(a=>{
            if(!availOnDate.find(x=>x.name===a.teacher_name))
              availOnDate.push({name:a.teacher_name,time:a.available_time||'',dow:a.preferred_dow||'',date:a.preferred_date||''});
          });
        });
        const selectedTitle=draft.title||'';
        const teachersForTitle=selectedTitle
          ?availOnDate.filter(t=>!teacherTitleMap[t.name]?.size||teacherTitleMap[t.name]?.has(selectedTitle))
          :availOnDate;
        return `<tr style="${isConfirmed?'background:var(--ok-bg)':''}">
          <td style="font-size:11px;color:var(--text-3)">${idx+1}</td>
          ${(() => {
            // 取老师偏好日期中出现最多的那个，否则用原始日期
            const prefDates = availOnDate.filter(t=>t.date).map(t=>t.date);
            const preferredDate = prefDates.length ? prefDates.sort((a,b)=>prefDates.filter(x=>x===b).length-prefDates.filter(x=>x===a).length)[0] : null;
            const showDate = preferredDate || d.date;
            const sd = new Date(showDate+'T12:00:00');
            const sdFmt = fmtSessionDate(showDate);
            const isChanged = showDate !== d.date;
            return `<td style="font-size:12px;font-weight:600;color:${isChanged?'var(--accent)':'inherit'}">
              ${sdFmt.short} <span style="color:${sdFmt.dowColor};font-size:10px">${sdFmt.dow}</span>
              ${isChanged?`<div style="font-size:10px;color:var(--text-muted);text-decoration:line-through">${f.short} ${f.dow}</div>`:''}
            </td>`;
          })()}
          <td style="font-size:11px">${d.time_range||''}</td>
          <td>
            ${availOnDate.length
              ?availOnDate.map(t=>`<span style="font-size:10px;background:var(--ok-bg);color:var(--ok);border-radius:2px;padding:1px 6px;margin:1px;display:inline-block">${t.name}${t.dow?' · '+t.dow:''}${t.date?' ('+t.date+')':''}${t.time?' · '+t.time:''}${teacherTitleMap[t.name]?.size?` (${[...teacherTitleMap[t.name]].join('/')})`:''}</span>`).join('')
              :`<span style="font-size:11px;color:var(--danger)">暂无</span>`}
          </td>
          <td>
            <select id="title-${d.date}" onchange="onSummaryTitleChange('${d.date}',this.value)" style="font-size:11px;padding:3px 6px;width:100%">
              <option value="">— 选内容 —</option>
              ${allTitles.map(t=>`<option value="${t}" ${draft.title===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </td>
          <td>
            <select id="teacher-${d.date}" onchange="onSummaryTeacherChange('${d.date}',this.value)" style="font-size:11px;padding:3px 6px;width:100%">
              <option value="">— 选老师 —</option>
              ${teachersForTitle.map(t=>`<option value="${t.name}" ${draft.teacher===t.name?'selected':''}>${t.name}</option>`).join('')}
              ${availOnDate.filter(t=>!teachersForTitle.find(x=>x.name===t.name)).map(t=>`<option value="${t.name}" ${draft.teacher===t.name?'selected':''}>${t.name}（其他内容）</option>`).join('')}
            </select>
          </td>
          <td style="font-size:10px;color:${isConfirmed?'var(--ok)':availOnDate.length?'var(--warn)':'var(--danger)'}">
            ${isConfirmed?'✓ 已定':availOnDate.length?'待确认':'⚠ 无人'}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function onSummaryTitleChange(date,title){
  if(!arrangementDraft[date]) arrangementDraft[date]={};
  arrangementDraft[date].title=title;
  arrangementDraft[date].teacher='';
  const sub=document.getElementById('scheduleSummarySub').textContent;
  const courseName=sub.split('\u3000')[0];
  const slots=cachedScheduleSlots.filter(s=>s.course_name===courseName);
  renderSummaryBody(slots,courseName);
}
function onSummaryTeacherChange(date,teacher){
  if(!arrangementDraft[date]) arrangementDraft[date]={};
  arrangementDraft[date].teacher=teacher;
}
function setDraftTeacher(k,v){if(!arrangementDraft[k])arrangementDraft[k]={};arrangementDraft[k].teacher=v;}
function setDraftTitle(k,v){if(!arrangementDraft[k])arrangementDraft[k]={};arrangementDraft[k].title=v;}


function autoArrange(){
  const sub=document.getElementById('scheduleSummarySub').textContent;
  const courseName=sub.split('\u3000')[0];
  const slots=cachedScheduleSlots.filter(s=>s.course_name===courseName);
  const allTitles=[...new Set(slots.flatMap(s=>s.session_titles||[]))];
  // 按日期去重
  const dateMap=new Map();
  slots.forEach(slot=>{
    if(!dateMap.has(slot.session_date)) dateMap.set(slot.session_date,{date:slot.session_date,slots:[]});
    dateMap.get(slot.session_date).slots.push(slot);
  });
  const dates=[...dateMap.values()].sort((a,b)=>a.date.localeCompare(b.date));
  // 老师-内容对应
  const teacherTitleMap={};
  cachedTeacherAvail.filter(a=>slots.find(s=>s.id===a.slot_id)).forEach(a=>{
    if(!teacherTitleMap[a.teacher_name]) teacherTitleMap[a.teacher_name]=new Set();
    if(a.preferred_titles?.length) a.preferred_titles.forEach(t=>teacherTitleMap[a.teacher_name].add(t));
    else (slots.find(s=>s.id===a.slot_id)?.session_titles||[]).forEach(t=>teacherTitleMap[a.teacher_name].add(t));
  });
  // 跳过已确认
  const unconfirmedDates=dates.filter(d=>!arrangementDraft[d.date]?.session_id);
  // 每个内容要分配一次
  const titleAssigned=new Set(Object.values(arrangementDraft).map(v=>v.title).filter(Boolean));
  const remainingTitles=allTitles.filter(t=>!titleAssigned.has(t));
  const teacherUsed={};
  let done=0;
  for(const d of unconfirmedDates){
    if(done>=remainingTitles.length) break;
    const availOnDate=[];
    d.slots.forEach(slot=>{
      cachedTeacherAvail.filter(a=>a.slot_id===slot.id&&a.available).forEach(a=>{
        if(!availOnDate.find(x=>x.name===a.teacher_name)) availOnDate.push(a.teacher_name);
      });
    });
    if(!availOnDate.length) continue;
    // 找一个还没分配的内容，且当天有人能上
    for(const title of remainingTitles){
      if(titleAssigned.has(title)) continue;
      const capable=availOnDate.filter(t=>!teacherTitleMap[t]?.size||teacherTitleMap[t]?.has(title));
      if(!capable.length) continue;
      const best=capable.sort((a,b)=>(teacherUsed[a]||0)-(teacherUsed[b]||0))[0];
      arrangementDraft[d.date]={title,teacher:best};
      teacherUsed[best]=(teacherUsed[best]||0)+1;
      titleAssigned.add(title);
      done++;
      break;
    }
  }
  renderSummaryBody(slots,courseName);
  alert(`自动排课完成：已分配 ${done} 个课次`);
}

async function confirmArrangement(){
  const entries=Object.entries(arrangementDraft).filter(([,v])=>v.title&&v.teacher&&!v.session_id);
  const sub=document.getElementById('scheduleSummarySub').textContent;
  const courseName=sub.split('\u3000')[0];
  const allSlots=cachedScheduleSlots.filter(s=>s.course_name===courseName);
  if(!entries.length){
    const allDates=[...new Set(allSlots.map(s=>s.session_date))];
    const allDone=allDates.every(d=>arrangementDraft[d]?.session_id||arrangementDraft[d]?.confirmed);
    if(allDone) openCompleteSchedule(courseName);
    else alert('请先选择内容和老师');
    return;
  }
  if(!confirm(`确认将 ${entries.length} 个课次的排课结果同步到课程安排？`))return;
  try{
    let synced=0;
    for(const [date,{title,teacher}] of entries){
      const session=cachedSessions.find(s=>s.course_name===courseName&&s.session_date===date);
      if(session){
        // 取老师偏好日期（如果有）
        const allSlotIds=cachedScheduleSlots.filter(s=>s.course_name===courseName&&s.session_date===date).map(s=>s.id);
        const prefDates=cachedTeacherAvail.filter(a=>allSlotIds.includes(a.slot_id)&&a.available&&a.preferred_date).map(a=>a.preferred_date);
        const preferredDate=prefDates.length ? prefDates.sort((a,b)=>prefDates.filter(x=>x===b).length-prefDates.filter(x=>x===a).length)[0] : null;
        const finalDate=preferredDate||date;
        const patchData={session_title:title,session_teacher:teacher};
        if(preferredDate&&preferredDate!==date) patchData.session_date=preferredDate;
        await sb(`/rest/v1/course_sessions?id=eq.${session.id}`,'PATCH',patchData);
        session.session_title=title;session.session_teacher=teacher;
        if(patchData.session_date) session.session_date=patchData.session_date;
        arrangementDraft[date].session_id=session.id;
        arrangementDraft[date].confirmed=true;
        synced++;
      }
      const relatedSlots=cachedScheduleSlots.filter(s=>s.course_name===courseName&&s.session_date===date);
      for(const slot of relatedSlots){
        if((slot.teacher_names||[]).includes(teacher)){
          await sb(`/rest/v1/schedule_slots?id=eq.${slot.id}`,'PATCH',{confirmed_teacher:teacher,confirmed_title:title,status:'confirmed'});
          slot.confirmed_teacher=teacher;slot.confirmed_title=title;slot.status='confirmed';
        }
      }
    }
    // re-render summary
    renderSummaryBody(allSlots,courseName);
    // update courses page in background
    if(curPage==='courses') renderCoursesPage(document.getElementById('mainContent'));
    // check if all done → show complete button
    const allDates=[...new Set(allSlots.map(s=>s.session_date))];
    const allDone=allDates.every(d=>arrangementDraft[d]?.session_id||arrangementDraft[d]?.confirmed);
    const actionsEl=document.querySelector('#scheduleSummaryModal .modal-actions');
    if(allDone&&actionsEl&&!document.getElementById('completeScheduleBtn')){
      const btn=document.createElement('button');
      btn.id='completeScheduleBtn';
      btn.className='btn';
      btn.style.cssText='background:var(--ok);color:#fff;border:none;padding:7px 14px;border-radius:3px;font-family:inherit;font-size:12px;cursor:pointer;margin-right:auto';
      btn.textContent='✓ 完成排课并归档';
      btn.onclick=()=>openCompleteSchedule(courseName);
      actionsEl.insertBefore(btn,actionsEl.firstChild);
    }
    alert(`已同步 ${synced} 个课次！${allDone?'\n\n全部课次已排完，可点「完成排课并归档」。':''}`);
  }catch(e){alert('同步失败：'+e.message)}
}

function openCompleteSchedule(courseName){
  if(!confirm(`「${courseName}」排课已完成。\n\n点确定后：\n• 课程安排显示最终结果\n• 老师课表同步更新\n• 排班时间槽从课程预定中移除\n\n确认归档？`))return;
  completeSchedule(courseName);
}

async function completeSchedule(courseName){
  try{
    const slots=cachedScheduleSlots.filter(s=>s.course_name===courseName);
    for(const slot of slots){
      await sb(`/rest/v1/teacher_availability?slot_id=eq.${slot.id}`,'DELETE').catch(()=>{});
    }
    if(slots.length){
      const ids=slots.map(s=>`"${s.id}"`);
      for(let i=0;i<ids.length;i+=20){
        await sb(`/rest/v1/schedule_slots?id=in.(${ids.slice(i,i+20).join(',')})`, 'DELETE').catch(()=>{});
      }
      cachedTeacherAvail=cachedTeacherAvail.filter(a=>!slots.find(s=>s.id===a.slot_id));
      cachedScheduleSlots=cachedScheduleSlots.filter(s=>s.course_name!==courseName);
    }
    closeModal('scheduleSummaryModal');
    [cachedCourses,cachedSessions]=await Promise.all([
      sb('/rest/v1/courses?select=*&order=created_at.desc'),
      sb('/rest/v1/course_sessions?select=*&order=session_date.asc')
    ]);
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`「${courseName}」排课已归档完成！`);
  }catch(e){alert('操作失败：'+e.message)}
}

// ── 管理老师 modal ──
// ── 老师管理页面 ──
function renderTeachersPage(mc){
  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">老师管理 <span class="badge-count">${cachedTeachers.length}</span></div>
  </div>
  <div class="swipe-row" style="grid-template-columns:1fr 1.6fr">
    <!-- 添加/编辑老师 -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:14px;letter-spacing:.05em;text-transform:uppercase" id="teacherFormTitle">添加新老师</div>
      <div class="form-group"><label class="form-label">姓名 *</label><input id="new_teacher_name" placeholder="老师姓名"></div>
      <div class="form-group"><label class="form-label">备注</label><input id="new_teacher_notes" placeholder="可选"></div>
      <div class="form-group">
        <label class="form-label">负责专业（可多选）</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="new_teacher_majors">
          <div class="filter-chip" data-value="keiei" onclick="toggleChip(this)" style="padding:4px 10px">経営学</div>
          <div class="filter-chip" data-value="keizai" onclick="toggleChip(this)" style="padding:4px 10px">経済学</div>
          <div class="filter-chip" data-value="shakai_group" onclick="toggleChip(this)" style="padding:4px 10px">社会人文</div>
          <div class="filter-chip" data-value="shakai" onclick="toggleChip(this)" style="padding:4px 10px">社会学</div>
          <div class="filter-chip" data-value="shinpan" onclick="toggleChip(this)" style="padding:4px 10px">新闻传播</div>
          <div class="filter-chip" data-value="fukushi" onclick="toggleChip(this)" style="padding:4px 10px">社会福祉</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">权限配置</label>
        <div style="border:1px solid var(--border-light);border-radius:3px;overflow:hidden">
          <!-- booking row -->
          <div style="padding:10px;border-bottom:1px solid var(--border-light)">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;margin-bottom:8px;white-space:nowrap"><input type="checkbox" id="perm_booking" style="accent-color:var(--accent);flex-shrink:0;width:16px;height:16px;min-width:16px">预约管理</label>
            <div style="display:flex;flex-wrap:wrap;gap:6px" id="perm_booking_types">
              <div class="filter-chip" data-value="daily" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">日常</div>
              <div class="filter-chip" data-value="plan" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">计划书</div>
              <div class="filter-chip" data-value="mock" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">模拟面试</div>
              <div class="filter-chip" data-value="vip" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">VIP</div>
            </div>
          </div>
          <!-- slots row -->
          <div style="padding:10px;border-bottom:1px solid var(--border-light)">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;margin-bottom:8px;white-space:nowrap"><input type="checkbox" id="perm_slots" style="accent-color:var(--accent);flex-shrink:0;width:16px;height:16px;min-width:16px">时间槽设定</label>
            <div style="display:flex;flex-wrap:wrap;gap:6px" id="perm_slot_types">
              <div class="filter-chip" data-value="daily" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">日常</div>
              <div class="filter-chip" data-value="plan" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">计划书</div>
              <div class="filter-chip" data-value="mock" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">模拟面试</div>
              <div class="filter-chip" data-value="vip" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">VIP</div>
            </div>
          </div>
          <!-- schedule row -->
          <div style="padding:10px;border-bottom:1px solid var(--border-light)">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap"><input type="checkbox" id="perm_schedule" style="accent-color:var(--accent);flex-shrink:0;width:16px;height:16px;min-width:16px">课程排班</label>
            <div style="font-size:10px;color:var(--text-3);margin-top:4px;margin-left:20px">排班确认 + 我的课表</div>
          </div>
          <!-- homework row -->
          <div style="padding:10px">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;margin-bottom:8px;white-space:nowrap"><input type="checkbox" id="perm_homework" style="accent-color:var(--accent);flex-shrink:0;width:16px;height:16px;min-width:16px">批改作业</label>
            <div style="font-size:10px;color:var(--text-3);margin-bottom:8px;margin-left:20px">开启后可在老师端查看并批改作业</div>
            <div style="margin-left:20px">
              <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">负责课程（可多选）</div>
              <div id="perm_homework_courses" style="display:flex;flex-wrap:wrap;gap:4px;max-height:80px;overflow-y:auto"></div>
            </div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" id="teacherFormBtn" onclick="addTeacher()">＋ 添加老师</button>
        <button class="btn btn-outline btn-sm" id="teacherFormCancelBtn" style="display:none" onclick="cancelEditTeacher()">取消</button>
      </div>
    </div>
    <!-- 老师列表 -->
    <div id="teacherList"></div>
  </div>
  <div class="swipe-hint">← 左右滑动切换：编辑表单 / 老师列表 →</div>`;
  renderTeacherList();
}

function renderPayrollPage(mc){
  mc.innerHTML = `
  <div class="page-section">
    <div class="section-title">工作管理</div>
    <div class="section-sub">工资核算与工作记录审核</div>
  </div>
  <div id="payrollContainer"></div>`;
  renderPayrollSection(document.getElementById('payrollContainer'));
}

function renderHomeworkCoursesChips(selected=[]) {
  const wrap = document.getElementById('perm_homework_courses');
  if (!wrap) return;
  // cachedSessions 已经是 homework_enabled=true 过滤过的，直接用
  const courses = [...new Set(cachedSessions.map(s => s.course_name))].sort();
  if (!courses.length) {
    wrap.innerHTML = '<span style="font-size:10px;color:var(--text-muted)">暂无开通作业的课程</span>';
    return;
  }
  wrap.innerHTML = courses.map(name =>
    `<div class="filter-chip${selected.includes(name)?' active':''}" data-value="${name}" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">${name}</div>`
  ).join('');
}


function toggleChip(el){
  el.classList.toggle('active');
}
function cancelEditTeacher(){
  document.getElementById('teacherFormTitle').textContent='添加新老师';
  document.getElementById('teacherFormBtn').textContent='＋ 添加老师';
  document.getElementById('teacherFormBtn').setAttribute('onclick','addTeacher()');
  document.getElementById('teacherFormCancelBtn').style.display='none';
  document.getElementById('new_teacher_name').value='';
  document.getElementById('new_teacher_notes').value='';
  document.querySelectorAll('#new_teacher_majors .filter-chip,#perm_booking_types .filter-chip,#perm_slot_types .filter-chip').forEach(c=>c.classList.remove('active'));
  document.getElementById('perm_booking').checked=false;
  document.getElementById('perm_slots').checked=false;
  document.getElementById('perm_schedule').checked=false;
  document.getElementById('perm_homework').checked=false;
  renderHomeworkCoursesChips([]);
}
function openTeacherManager(){
  // reset add form
  document.getElementById('new_teacher_name').value='';
  document.getElementById('new_teacher_notes').value='';
  document.querySelectorAll('#new_teacher_majors .filter-chip,#perm_booking_types .filter-chip,#perm_slot_types .filter-chip').forEach(c=>c.classList.remove('active'));
  document.getElementById('perm_booking').checked=false;
  document.getElementById('perm_slots').checked=false;
  document.getElementById('perm_schedule').checked=false;
  document.getElementById('perm_homework').checked=false;
  renderHomeworkCoursesChips([]);
  renderTeacherList();
  document.getElementById('teacherManagerModal').classList.add('open');
}

function renderTeacherList(){
  const base=location.origin+location.pathname.replace(/\/admin\/.*$/,'/teacher/');
  const html=cachedTeachers.length
    ?`<div style="display:flex;flex-direction:column;gap:8px">
        ${cachedTeachers.map(t=>{
          const p=t.permissions||{};
          const majors=(t.majors||[]).map(m=>MAJORS[m]||m).join('・')||'—';
          const perms=[];
          if(p.booking) perms.push(`预约(${(p.booking_types||[]).join('/')})`);
          if(p.slots) perms.push(`时间槽(${(p.slot_types||[]).join('/')})`);
          if(p.schedule) perms.push('排班');
          const link=`${base}?teacher=${encodeURIComponent(t.name)}`;
          return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px 14px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
              <div>
                <span style="font-family:'Noto Serif SC',serif;font-weight:600;font-size:14px">${t.name}</span>
                ${t.notes?`<span style="font-size:11px;color:var(--text-3);margin-left:6px">${t.notes}</span>`:''}
              </div>
              <div style="display:flex;gap:4px">
                <button class="btn btn-outline btn-sm" onclick="openEditTeacher('${t.id}')">编辑</button>
                <button class="btn-ghost" onclick="deleteTeacher('${t.id}')">✕</button>
              </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px">
              ${(t.majors||[]).map(m=>`<span style="font-size:10px;background:var(--bg);border:1px solid var(--border-light);border-radius:2px;padding:1px 6px">${MAJORS[m]||m}</span>`).join('')}
              ${perms.map(p2=>`<span style="font-size:10px;background:var(--ok-bg);color:var(--ok);border-radius:2px;padding:1px 6px">${p2}</span>`).join('')}
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:10px;color:var(--text-3)">链接：</span>
              <code style="font-size:10px;color:var(--text-2);background:var(--bg);padding:1px 6px;border-radius:2px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${link}</code>
              <button onclick="navigator.clipboard.writeText('${link}').then(()=>alert('已复制'))" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:1px 7px;cursor:pointer;font-family:inherit;white-space:nowrap">复制</button>
            </div>
          </div>`;
        }).join('')}
      </div>`
    :'<div class="empty" style="padding:40px">暂无老师</div>';
  const el=document.getElementById('teacherList');
  if(el) el.innerHTML=html;
}

function getPermissionsFromForm(){
  return {
    booking:document.getElementById('perm_booking').checked,
    booking_types:[...document.querySelectorAll('#perm_booking_types .filter-chip.active')].map(c=>c.dataset.value),
    slots:document.getElementById('perm_slots').checked,
    slot_types:[...document.querySelectorAll('#perm_slot_types .filter-chip.active')].map(c=>c.dataset.value),
    schedule:document.getElementById('perm_schedule').checked,
    homework:document.getElementById('perm_homework').checked,
    homework_courses:[...document.querySelectorAll('#perm_homework_courses .filter-chip.active')].map(c=>c.dataset.value),
  };
}

async function addTeacher(){
  const name=document.getElementById('new_teacher_name').value.trim();
  const notes=document.getElementById('new_teacher_notes').value.trim();
  if(!name){alert('请填写姓名');return}
  if(cachedTeachers.find(t=>t.name===name)){alert('该老师已存在');return}
  const majors=[...document.querySelectorAll('#new_teacher_majors .filter-chip.active')].map(c=>c.dataset.value);
  const permissions=getPermissionsFromForm();
  try{
    const t={id:`t-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,name,notes,majors,permissions};
    const res=await sb('/rest/v1/teachers','POST',[t]);
    cachedTeachers.push(Array.isArray(res)?res[0]:t);
    document.getElementById('new_teacher_name').value='';
    document.getElementById('new_teacher_notes').value='';
    document.querySelectorAll('#new_teacher_majors .filter-chip,#perm_booking_types .filter-chip,#perm_slot_types .filter-chip').forEach(c=>c.classList.remove('active'));
    document.getElementById('perm_booking').checked=false;
    document.getElementById('perm_slots').checked=false;
    document.getElementById('perm_schedule').checked=false;
    renderTeacherList();
  }catch(e){alert('添加失败：'+e.message)}
}

function openEditTeacher(id){
  const t=cachedTeachers.find(x=>x.id===id);
  if(!t) return;
  document.getElementById('new_teacher_name').value=t.name;
  document.getElementById('new_teacher_notes').value=t.notes||'';
  document.querySelectorAll('#new_teacher_majors .filter-chip').forEach(c=>{c.classList.toggle('active',(t.majors||[]).includes(c.dataset.value))});
  const p=t.permissions||{};
  document.getElementById('perm_booking').checked=!!p.booking;
  document.getElementById('perm_slots').checked=!!p.slots;
  document.getElementById('perm_schedule').checked=!!p.schedule;
  document.getElementById('perm_homework').checked=!!p.homework;
  document.querySelectorAll('#perm_booking_types .filter-chip').forEach(c=>{c.classList.toggle('active',(p.booking_types||[]).includes(c.dataset.value))});
  document.querySelectorAll('#perm_slot_types .filter-chip').forEach(c=>{c.classList.toggle('active',(p.slot_types||[]).includes(c.dataset.value))});
  renderHomeworkCoursesChips(p.homework_courses||[]);
  const btn=document.getElementById('teacherFormBtn');
  if(btn){btn.textContent='保存修改';btn.setAttribute('onclick',`saveEditTeacher('${id}')`);}
  const cancelBtn=document.getElementById('teacherFormCancelBtn');
  if(cancelBtn) cancelBtn.style.display='inline-flex';
  const title=document.getElementById('teacherFormTitle');
  if(title) title.textContent=`编辑：${t.name}`;
  document.getElementById('new_teacher_name').focus();
  // scroll form into view on mobile
  document.getElementById('new_teacher_name').scrollIntoView({behavior:'smooth',block:'center'});
}

async function saveEditTeacher(id){
  const name=document.getElementById('new_teacher_name').value.trim();
  if(!name){alert('请填写姓名');return}
  const majors=[...document.querySelectorAll('#new_teacher_majors .filter-chip.active')].map(c=>c.dataset.value);
  const permissions=getPermissionsFromForm();
  const notes=document.getElementById('new_teacher_notes').value.trim();
  try{
    await sb(`/rest/v1/teachers?id=eq.${id}`,'PATCH',{name,notes,majors,permissions});
    const idx=cachedTeachers.findIndex(t=>t.id===id);
    if(idx>=0) Object.assign(cachedTeachers[idx],{name,notes,majors,permissions});
    cancelEditTeacher();
    renderTeacherList();
  }catch(e){alert('保存失败：'+e.message)}
}

async function deleteTeacher(id){
  if(!confirm('确定删除这位老师？'))return;
  try{
    await sb(`/rest/v1/teachers?id=eq.${id}`,'DELETE');
    cachedTeachers=cachedTeachers.filter(t=>t.id!==id);
    renderTeacherList();
  }catch(e){alert('删除失败：'+e.message)}
}

// ── Init ──
async function initApp(){
  bkMonth=new Date().getMonth();bkYear=new Date().getFullYear();
  await renderPage();
}
if(checkLogin()){initApp()}else{document.getElementById('loginOverlay').style.display='flex'}
