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
let cachedAdmissionSchools=[];
let cachedAdmissionMajorCounts={};
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
  const navId=page==='courses'?'nav-courses':page==='schedule'?'nav-schedule':page==='teachers'?'nav-teachers':page==='admissiondb'?'nav-admissiondb':'nav-'+page;
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
      [cachedStudents,cachedTeachers]=await Promise.all([
        sb('/rest/v1/students?select=*&order=name.asc'),
        sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[])
      ]);
      renderStudentsPage(mc);
    } else if(curPage==='courses'){
      [cachedStudents,cachedCourses,cachedSessions]=await Promise.all([
        sb('/rest/v1/students?select=*&order=name.asc'),
        sb('/rest/v1/courses?select=*&order=created_at.desc'),
        sb('/rest/v1/course_sessions?select=*&order=session_date.asc')
      ]);
      renderCoursesPage(mc);
    } else if(curPage==='promo'){
      renderPromoAdminPage(mc);
    } else if(curPage==='coursecleanup'){
      [cachedCourses,cachedSessions,cachedTeachers]=await Promise.all([
        sb('/rest/v1/courses?select=*&order=created_at.desc'),
        sb('/rest/v1/course_sessions?select=*&order=session_date.asc'),
        sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[])
      ]);
      renderCourseCleanupPage(mc);
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
    } else if(curPage==='admissiondb'){
      // 只拉 major 字段用于渲染专业筛选按钮，点专业后再拉完整数据
      const majorRows=await sb('/rest/v1/admission_schools?select=major&limit=10000').catch(()=>[]);
      cachedAdmissionSchools=[];
      cachedAdmissionMajorCounts={};
      majorRows.forEach(r=>{ cachedAdmissionMajorCounts[r.major]=(cachedAdmissionMajorCounts[r.major]||0)+1; });
      renderAdmissionDbPage(mc);
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
// ATTENDANCE PAGE
// ══════════════════════════════════
// ══════════════════════════════════
// COURSES PAGE
// ══════════════════════════════════
let cachedCourses=[], cachedSessions=[], cachedSessionRecords=[];
function closeModal(id){document.getElementById(id).classList.remove('open')}

// ── 管理老师 modal ──
// ── 老师管理页面 ──
function renderTeachersPage(mc){
  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">老师管理 <span class="badge-count">${cachedTeachers.length}</span></div>
    <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:3px;overflow:hidden">
      <button style="font-size:11px;padding:5px 16px;border:none;cursor:pointer;font-family:inherit;background:var(--accent);color:#fff">👥 老师账号</button>
      <button onclick="renderTeacherProfilesPage(document.getElementById('mainContent'))" style="font-size:11px;padding:5px 16px;border:none;cursor:pointer;font-family:inherit;background:var(--surface);color:var(--text-2)">📇 讲师档案</button>
    </div>
  </div>
  <div class="swipe-row" style="grid-template-columns:1fr 1.6fr">
    <!-- 添加/编辑老师 -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:14px;letter-spacing:.05em;text-transform:uppercase" id="teacherFormTitle">添加新老师</div>
      <div class="form-group"><label class="form-label">姓名 *</label><input id="new_teacher_name" placeholder="老师姓名"></div>
      <div class="form-group"><label class="form-label">备注 / 对外宣传姓名</label><input id="new_teacher_notes" placeholder="填写后，宣传页课程担当将显示此名（如：周老师）"></div>
      <div class="form-group"><label class="form-label">分类标签（可叠加，用于搜索标记，不影响任何功能权限）</label><input id="new_teacher_tags" placeholder="用逗号或顿号分隔，如：计划书指导、模拟面试、兼职"></div>
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
            <div style="margin-top:8px;margin-left:20px">
              <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">可指导的VIP内容（开设VIP时间槽时只能从这里选）</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px" id="perm_vip_content">
                <div class="filter-chip" data-value="专业课指导" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">专业课指导</div>
                <div class="filter-chip" data-value="过去问对策" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">过去问对策</div>
                <div class="filter-chip" data-value="研究计划书" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">研究计划书</div>
                <div class="filter-chip" data-value="出愿指导" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">出愿指导</div>
                <div class="filter-chip" data-value="面试对策" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">面试对策</div>
                <div class="filter-chip" data-value="TA指导" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">TA指导</div>
              </div>
            </div>
          </div>
          <!-- schedule row -->
          <div style="padding:10px;border-bottom:1px solid var(--border-light)">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap"><input type="checkbox" id="perm_schedule" style="accent-color:var(--accent);flex-shrink:0;width:16px;height:16px;min-width:16px">课程排班</label>
            <div style="font-size:10px;color:var(--text-3);margin-top:4px;margin-left:20px">排班确认 + 我的课表</div>
          </div>
          <!-- homework row -->
          <div style="padding:10px;border-bottom:1px solid var(--border-light)">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;margin-bottom:8px;white-space:nowrap"><input type="checkbox" id="perm_homework" style="accent-color:var(--accent);flex-shrink:0;width:16px;height:16px;min-width:16px">批改作业</label>
            <div style="font-size:10px;color:var(--text-3);margin-bottom:8px;margin-left:20px">开启后可在老师端查看并批改作业</div>
            <div style="margin-left:20px">
              <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">负责课程（可多选）</div>
              <div id="perm_homework_courses" style="display:flex;flex-wrap:wrap;gap:4px;max-height:80px;overflow-y:auto"></div>
            </div>
          </div>
          <!-- student_mgmt row -->
          <div style="padding:10px">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;margin-bottom:8px;white-space:nowrap"><input type="checkbox" id="perm_student_mgmt" style="accent-color:var(--accent);flex-shrink:0;width:16px;height:16px;min-width:16px">学生管理</label>
            <div style="font-size:10px;color:var(--text-3);margin-bottom:8px;margin-left:20px">开启后老师端显示「学生管理」页，按下方勾选的子项提供对应功能</div>
            <div style="margin-left:20px;margin-bottom:8px">
              <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">可用的子项</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px" id="perm_student_mgmt_items">
                ${[
              ['progress','考学进度'],['meetings','面谈查询'],['records','出席・作业记录'],['profile','学生档案录入'],
            ].map(([k,v])=>`<div class="filter-chip" data-value="${k}" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">${v}</div>`).join('')}
              </div>
            </div>
            <div style="margin-left:20px">
              <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">可见的专业（适用于全部三个子项；不选则默认按该老师自身的专业显示，老师档案无专业时全部可见）</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px" id="perm_student_majors">
                ${[
              ['shakai','社会学'],['keiei','経営学'],['keizai','経済学'],
              ['shinpan','新闻传播学'],['fukushi','社会福祉学'],['nihongo','日本语教育'],
              ['hyosho','表象文化・文学・哲学'],['seiji','政治学'],['toyo','東洋史'],
              ['bunka','文化人类学'],['mot','MOT'],['tokei','統計・計量'],
            ].map(([k,v])=>`<div class="filter-chip" data-value="${k}" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">${v}</div>`).join('')}
              </div>
            </div>
          </div>
          <!-- 营业功能大类 row -->
          <div style="padding:10px">
            <div style="font-size:11px;font-weight:600;margin-bottom:6px">💼 营业功能（按需勾选子项）</div>
            <div style="margin-left:4px;display:flex;flex-direction:column;gap:6px">
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_promo" style="accent-color:var(--accent);width:15px;height:15px">宣传相关<span style="font-size:9px;color:var(--text-3)">专业/讲师/课程介绍与当期课程表，含对外分享链接</span></label>
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_progress_plan" style="accent-color:var(--accent);width:15px;height:15px">进度规划<span style="font-size:9px;color:var(--text-3)">咨询学生考学规划生成，可打印 PDF</span></label>
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_lect_info" style="accent-color:var(--accent);width:15px;height:15px">讲师信息查询<span style="font-size:9px;color:var(--text-3)">内部检索讲师档案，可切换展示卡片给客户看/截图</span></label>
            </div>
          </div>
          <!-- admission_query row -->
          <div style="padding:10px">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;margin-bottom:8px;white-space:nowrap"><input type="checkbox" id="perm_admission_query" style="accent-color:var(--accent);flex-shrink:0;width:16px;height:16px;min-width:16px">出願数据查询</label>
            <div style="font-size:10px;color:var(--text-3);margin-bottom:8px;margin-left:20px">开启后可在老师端查看出願学校数据库（只读）</div>
            <div style="margin-left:20px">
              <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">可查看的专业（不选则全部可查看）</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px" id="perm_admission_majors">
                ${[
              ['shakai','社会学'],['keiei','経営学'],['keizai','経済学'],
              ['shinpan','新闻传播学'],['fukushi','社会福祉学'],['nihongo','日本语教育'],
              ['hyosho','表象文化・文学・哲学'],['seiji','政治学'],['toyo','東洋史'],
              ['bunka','文化人类学'],['mot','MOT'],['tokei','統計・計量'],
            ].map(([k,v])=>`<div class="filter-chip" data-value="${k}" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">${v}</div>`).join('')}
              </div>
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
  document.getElementById('new_teacher_tags').value='';
  document.querySelectorAll('#new_teacher_majors .filter-chip,#perm_booking_types .filter-chip,#perm_slot_types .filter-chip,#perm_vip_content .filter-chip,#perm_student_majors .filter-chip,#perm_student_mgmt_items .filter-chip').forEach(c=>c.classList.remove('active'));
  document.getElementById('perm_booking').checked=false;
  document.getElementById('perm_slots').checked=false;
  document.getElementById('perm_schedule').checked=false;
    document.getElementById('perm_student_mgmt').checked=false;
    document.getElementById('perm_progress_plan').checked=false;
    document.getElementById('perm_promo').checked=false;
    document.getElementById('perm_lect_info').checked=false;
  document.getElementById('perm_homework').checked=false;
  document.getElementById('perm_admission_query').checked=false;
  document.querySelectorAll('#perm_admission_majors .filter-chip').forEach(c=>c.classList.remove('active'));
  renderHomeworkCoursesChips([]);
}
function openTeacherManager(){
  // reset add form
  document.getElementById('new_teacher_name').value='';
  document.getElementById('new_teacher_notes').value='';
  document.getElementById('new_teacher_tags').value='';
  document.querySelectorAll('#new_teacher_majors .filter-chip,#perm_booking_types .filter-chip,#perm_slot_types .filter-chip,#perm_vip_content .filter-chip,#perm_student_majors .filter-chip,#perm_student_mgmt_items .filter-chip').forEach(c=>c.classList.remove('active'));
  document.getElementById('perm_booking').checked=false;
  document.getElementById('perm_slots').checked=false;
  document.getElementById('perm_schedule').checked=false;
    document.getElementById('perm_student_mgmt').checked=false;
    document.getElementById('perm_progress_plan').checked=false;
    document.getElementById('perm_promo').checked=false;
    document.getElementById('perm_lect_info').checked=false;
  document.getElementById('perm_homework').checked=false;
  document.getElementById('perm_admission_query').checked=false;
  document.querySelectorAll('#perm_admission_majors .filter-chip').forEach(c=>c.classList.remove('active'));
  renderHomeworkCoursesChips([]);
  renderTeacherList();
  document.getElementById('teacherManagerModal').classList.add('open');
}

// 标签解析：逗号/顿号/空格分隔，去重去空
function parseTeacherTags(){
  const raw=document.getElementById('new_teacher_tags')?.value||'';
  return [...new Set(raw.split(/[,，、\s]+/).map(x=>x.trim()).filter(Boolean))];
}
function escTM(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}

let teacherSearch='';
let teacherTagFilter='';
let teacherExpandedId=null;

function teacherFilteredList(){
  let list=cachedTeachers;
  if(teacherTagFilter) list=list.filter(t=>(t.tags||[]).includes(teacherTagFilter));
  const q=teacherSearch.trim();
  // 拼音严格匹配失败时退回首字母匹配姓氏（zs 也能命中张老师）
  const nameMatch=n=>{
    if(typeof matchesPinyin==='function'&&matchesPinyin(n||'',q)) return true;
    if(/^[a-zA-Z]{2,3}$/.test(q)&&typeof matchesPinyin==='function') return matchesPinyin(n||'',q[0].toLowerCase());
    return (n||'').includes(q);
  };
  if(q) list=list.filter(t=>nameMatch(t.name)
    ||(t.notes||'').includes(q)||(t.tags||[]).some(g=>g.includes(q)));
  return list;
}

function renderTeacherList(){
  const el=document.getElementById('teacherList');
  if(!el) return;
  // 汇总现有标签作为筛选 chips
  const allTags=[...new Set(cachedTeachers.flatMap(t=>t.tags||[]))];
  el.innerHTML=`
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">
      <input placeholder="搜索姓名（汉字/拼音首字母）、标签、备注…" value="${escTM(teacherSearch)}"
        oninput="teacherSearch=this.value;renderTeacherRows()"
        style="font-size:11px;padding:6px 10px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit;flex:1;min-width:180px">
      <span style="font-size:10px;color:var(--text-3)" id="teacherCount"></span>
    </div>
    ${allTags.length?`<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:8px">
      <span style="font-size:10px;color:var(--text-3)">标签：</span>
      <div class="filter-chip ${teacherTagFilter===''?'active':''}" onclick="teacherTagFilter='';renderTeacherList()" style="padding:2px 9px;font-size:10px">全部</div>
      ${allTags.map(g=>`<div class="filter-chip ${teacherTagFilter===g?'active':''}" onclick="teacherTagFilter='${escTM(g)}';renderTeacherList()" style="padding:2px 9px;font-size:10px">${escTM(g)}</div>`).join('')}
    </div>`:''}
    <div id="teacherRows"></div>`;
  renderTeacherRows();
}

function renderTeacherRows(){
  const box=document.getElementById('teacherRows');
  if(!box) return;
  const base=location.origin+location.pathname.replace(/\/admin\/.*$/,'/teacher/');
  const list=teacherFilteredList();
  const cnt=document.getElementById('teacherCount');
  if(cnt) cnt.textContent=`${list.length} / ${cachedTeachers.length} 位`;
  box.innerHTML=list.length
    ?`<div style="display:flex;flex-direction:column;gap:6px">
        ${list.map(t=>{
          const p=t.permissions||{};
          const perms=[];
          if(p.booking) perms.push('预约');
          if(p.slots) perms.push('时间槽');
          if(p.schedule) perms.push('排班');
          if(p.homework) perms.push('作业');
          if(p.admission_query) perms.push('出願库');
          if(p.student_mgmt) perms.push('学生管理');
          if(p.progress_plan) perms.push('进度规划');
          if(p.promo) perms.push('宣传');
          if(p.lect_info) perms.push('讲师信息');
          const permsFull=[];
          if(p.booking) permsFull.push(`预约(${(p.booking_types||[]).join('/')||'—'})`);
          if(p.slots) permsFull.push(`时间槽(${(p.slot_types||[]).join('/')||'—'})`);
          if(p.schedule) permsFull.push('排班');
          if(p.homework) permsFull.push('作业反馈');
          if(p.admission_query) permsFull.push('出願数据库');
          if(p.student_mgmt){const _sm={progress:'考学进度',records:'出席作业',meetings:'面谈查询',profile:'档案录入'};permsFull.push('学生管理('+(((p.student_mgmt_items||[]).map(k=>_sm[k]||k).join('/'))||'—')+')');}
          if(p.progress_plan) permsFull.push('进度规划（营业）');
          if(p.promo) permsFull.push('宣传相关（营业）');
          if(p.lect_info) permsFull.push('讲师信息查询（营业）');
          const open=teacherExpandedId===t.id;
          const link=`${base}?teacher=${encodeURIComponent(t.name)}`;
          return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden">
            <div onclick="teacherExpandedId=teacherExpandedId==='${t.id}'?null:'${t.id}';renderTeacherRows()" style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;${open?'background:var(--bg)':''}">
              <span style="font-family:'Noto Serif SC',serif;font-weight:600;font-size:13px;white-space:nowrap">${escTM(t.name)}</span>
              <span style="font-size:10px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:22%">${(t.majors||[]).map(m=>MAJORS[m]||m).join('・')||'—'}</span>
              ${(t.tags||[]).map(g=>`<span style="font-size:10px;color:var(--accent);border:1px solid var(--border);border-radius:2px;padding:0 6px;white-space:nowrap">${escTM(g)}</span>`).join('')}
              <span style="font-size:10px;color:var(--text-3);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:30%">${perms.join(' · ')||'无权限'}</span>
              <span style="font-size:10px;color:var(--text-3)">${open?'▾':'▸'}</span>
            </div>
            ${open?`<div style="border-top:1px solid var(--border-light);background:var(--bg);padding:10px 12px">
              ${t.notes?`<div style="font-size:11px;color:var(--text-2);margin-bottom:6px">备注：${escTM(t.notes)}</div>`:''}
              <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">
                ${(t.majors||[]).map(m=>`<span style="font-size:10px;background:var(--surface);border:1px solid var(--border-light);border-radius:2px;padding:1px 6px">${MAJORS[m]||m}</span>`).join('')}
                ${permsFull.map(p2=>`<span style="font-size:10px;background:var(--ok-bg);color:var(--ok);border-radius:2px;padding:1px 6px">${p2}</span>`).join('')}
              </div>
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
                <span style="font-size:10px;color:var(--text-3)">链接：</span>
                <code style="font-size:10px;color:var(--text-2);background:var(--surface);padding:1px 6px;border-radius:2px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${link}</code>
                <button onclick="event.stopPropagation();navigator.clipboard.writeText('${link}').then(()=>alert('已复制'))" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:1px 7px;cursor:pointer;font-family:inherit;white-space:nowrap">复制</button>
              </div>
              <div style="display:flex;gap:4px">
                <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openEditTeacher('${t.id}')">编辑</button>
                <button class="btn-ghost" onclick="event.stopPropagation();deleteTeacher('${t.id}')">✕ 删除</button>
              </div>
            </div>`:''}
          </div>`;
        }).join('')}
      </div>`
    :'<div class="empty" style="padding:40px">没有符合条件的老师</div>';
}

function getPermissionsFromForm(){
  return {
    booking:document.getElementById('perm_booking').checked,
    booking_types:[...document.querySelectorAll('#perm_booking_types .filter-chip.active')].map(c=>c.dataset.value),
    slots:document.getElementById('perm_slots').checked,
    slot_types:[...document.querySelectorAll('#perm_slot_types .filter-chip.active')].map(c=>c.dataset.value),
    vip_content:[...document.querySelectorAll('#perm_vip_content .filter-chip.active')].map(c=>c.dataset.value),
    schedule:document.getElementById('perm_schedule').checked,
    homework:document.getElementById('perm_homework').checked,
    homework_courses:[...document.querySelectorAll('#perm_homework_courses .filter-chip.active')].map(c=>c.dataset.value),
    admission_query:document.getElementById('perm_admission_query').checked,
    admission_majors:[...document.querySelectorAll('#perm_admission_majors .filter-chip.active')].map(c=>c.dataset.value),
    promo:document.getElementById('perm_promo').checked,
    lect_info:document.getElementById('perm_lect_info').checked,
    progress_plan:document.getElementById('perm_progress_plan').checked,
    student_mgmt:document.getElementById('perm_student_mgmt').checked,
    student_mgmt_items:[...document.querySelectorAll('#perm_student_mgmt_items .filter-chip.active')].map(c=>c.dataset.value),
    student_majors:[...document.querySelectorAll('#perm_student_majors .filter-chip.active')].map(c=>c.dataset.value),
  };
}

async function addTeacher(){
  const name=document.getElementById('new_teacher_name').value.trim();
  const notes=document.getElementById('new_teacher_notes').value.trim();
  if(!name){alert('请填写姓名');return}
  if(cachedTeachers.find(t=>t.name===name)){alert('该老师已存在');return}
  const majors=[...document.querySelectorAll('#new_teacher_majors .filter-chip.active')].map(c=>c.dataset.value);
  const permissions=getPermissionsFromForm();
  const tags=parseTeacherTags();
  try{
    const t={id:`t-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,name,notes,majors,permissions,tags};
    const res=await sb('/rest/v1/teachers','POST',[t]);
    cachedTeachers.push(Array.isArray(res)?res[0]:t);
    document.getElementById('new_teacher_name').value='';
    document.getElementById('new_teacher_notes').value='';
  document.getElementById('new_teacher_tags').value='';
    document.getElementById('new_teacher_tags').value='';
    document.querySelectorAll('#new_teacher_majors .filter-chip,#perm_booking_types .filter-chip,#perm_slot_types .filter-chip,#perm_vip_content .filter-chip,#perm_student_majors .filter-chip,#perm_student_mgmt_items .filter-chip').forEach(c=>c.classList.remove('active'));
    document.getElementById('perm_booking').checked=false;
    document.getElementById('perm_slots').checked=false;
    document.getElementById('perm_schedule').checked=false;
    document.getElementById('perm_student_mgmt').checked=false;
    document.getElementById('perm_progress_plan').checked=false;
    document.getElementById('perm_promo').checked=false;
    document.getElementById('perm_lect_info').checked=false;
    renderTeacherList();
  }catch(e){alert('添加失败：'+e.message)}
}

function openEditTeacher(id){
  const t=cachedTeachers.find(x=>x.id===id);
  if(!t) return;
  document.getElementById('new_teacher_name').value=t.name;
  document.getElementById('new_teacher_notes').value=t.notes||'';
  document.getElementById('new_teacher_tags').value=(t.tags||[]).join('、');
  document.querySelectorAll('#new_teacher_majors .filter-chip').forEach(c=>{c.classList.toggle('active',(t.majors||[]).includes(c.dataset.value))});
  const p=t.permissions||{};
  document.getElementById('perm_booking').checked=!!p.booking;
  document.getElementById('perm_slots').checked=!!p.slots;
  document.getElementById('perm_schedule').checked=!!p.schedule;
  document.getElementById('perm_homework').checked=!!p.homework;
  document.getElementById('perm_admission_query').checked=!!p.admission_query;
  document.querySelectorAll('#perm_admission_majors .filter-chip').forEach(c=>{c.classList.toggle('active',(p.admission_majors||[]).includes(c.dataset.value));});
  document.getElementById('perm_promo').checked=!!p.promo;
  document.getElementById('perm_lect_info').checked=!!p.lect_info;
  document.getElementById('perm_progress_plan').checked=!!p.progress_plan;
  document.getElementById('perm_student_mgmt').checked=!!p.student_mgmt;
  document.querySelectorAll('#perm_student_mgmt_items .filter-chip').forEach(c=>{c.classList.toggle('active',(p.student_mgmt_items||[]).includes(c.dataset.value));});
  document.querySelectorAll('#perm_student_majors .filter-chip').forEach(c=>{c.classList.toggle('active',(p.student_majors||[]).includes(c.dataset.value));});
  document.querySelectorAll('#perm_booking_types .filter-chip').forEach(c=>{c.classList.toggle('active',(p.booking_types||[]).includes(c.dataset.value))});
  document.querySelectorAll('#perm_slot_types .filter-chip').forEach(c=>{c.classList.toggle('active',(p.slot_types||[]).includes(c.dataset.value))});
  document.querySelectorAll('#perm_vip_content .filter-chip').forEach(c=>{c.classList.toggle('active',(p.vip_content||[]).includes(c.dataset.value))});
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
  const tags=parseTeacherTags();
  try{
    await sb(`/rest/v1/teachers?id=eq.${id}`,'PATCH',{name,notes,majors,permissions,tags});
    const idx=cachedTeachers.findIndex(t=>t.id===id);
    if(idx>=0) Object.assign(cachedTeachers[idx],{name,notes,majors,permissions,tags});
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
  await loadMajorsFromDB();
  await renderPage();
}
if(checkLogin()){initApp()}else{document.getElementById('loginOverlay').style.display='flex'}

// ══════════════════════════════════
// 讲师档案（teacher_profiles）：内部讲师信息库
// 与老师账号（teachers）独立：没有账号的讲师也可以建档；real_name 填了则与账号绑定，
// 老师本人可在老师页补全信息，营业老师端「讲师信息查询」读取本表
// ══════════════════════════════════
let profList=null;
let profOpenSubjects=new Set();
let profEditingId=null;

const PROF_FIELDS=[
  ['name','讲师姓名（对外，如 徐老师）*'],['real_name','绑定账号（老师认领后自动填写，一般无需手动）'],
  ['department','所属学系（如 社会人文）'],['subject','所属学科（如 社会学）'],
  ['school','毕业或所属大学院研究科'],['degree','学位（含在读）'],
  ['years','执教年份'],['vip','VIP指导（可/否）'],
];

async function renderTeacherProfilesPage(mc){
  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">讲师档案 <span class="badge-count" id="prof_count">…</span></div>
    <div style="display:flex;gap:8px;align-items:center">
      <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:3px;overflow:hidden">
        <button onclick="renderTeachersPage(document.getElementById('mainContent'));renderTeacherList()" style="font-size:11px;padding:5px 16px;border:none;cursor:pointer;font-family:inherit;background:var(--surface);color:var(--text-2)">👥 老师账号</button>
        <button style="font-size:11px;padding:5px 16px;border:none;cursor:pointer;font-family:inherit;background:var(--accent);color:#fff">📇 讲师档案</button>
      </div>
      <label class="btn btn-outline btn-sm" style="cursor:pointer">⬆ 导入 Excel<input type="file" accept=".xlsx,.xls" style="display:none" onchange="profImportExcel(this)"></label>
      <button class="btn btn-primary btn-sm" onclick="profEditingId='new';profRender()">＋ 新增讲师</button>
    </div>
  </div>
  <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">Excel 列名须与讲师信息表一致（讲师姓名 / 所属学系 / 所属学科 / 毕业或所属大学院研究科 / 学位（含在读） / 执教年份 / 担当课程 / 可指导方向（关键词） / VIP指导 / 授课特色 / 备注）。「真实姓名」用于绑定老师账号：绑定后该老师可在自己页面补全档案，缺信息时老师页会出提示。</div>
  <div id="prof_body"><div class="empty">加载中…</div></div>`;
  try{
    profList=await sb('/rest/v1/teacher_profiles?select=*&order=sort_order.asc,created_at.asc');
  }catch(e){document.getElementById('prof_body').innerHTML=`<div class="empty">加载失败：${e.message}（若表不存在请先执行建表 SQL）</div>`;return}
  profRender();
}

function profEsc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}

function profIncomplete(p){
  return !((p.school||'').trim()&&(p.keywords||'').trim()&&(p.feature||'').trim()&&(p.courses||'').trim());
}

function profRender(){
  const box=document.getElementById('prof_body');
  if(!box||!profList)return;
  const cnt=document.getElementById('prof_count');
  if(cnt) cnt.textContent=profList.length;
  const inp='width:100%;font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';

  const formHtml=(p)=>`
  <div style="border:1px solid var(--accent);border-radius:4px;padding:14px;margin-bottom:10px;background:var(--bg)">
    <div style="font-size:11px;font-weight:600;margin-bottom:8px">${profEditingId==='new'?'＋ 新增讲师档案':'✏ 编辑讲师档案'}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin-bottom:8px">
      ${PROF_FIELDS.map(([k,l])=>`<div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">${l}</label><input id="pf_${k}" value="${profEsc(p[k])}" style="${inp}"></div>`).join('')}
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">排序</label><input id="pf_sort" type="number" value="${p.sort_order||0}" style="${inp}"></div>
    </div>
    ${[['courses','担当课程'],['keywords','可指导方向（关键词）'],['feature','授课特色'],['notes','备注']].map(([k,l])=>`
    <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">${l}</label>
    <textarea id="pf_${k}" rows="${k==='feature'?4:2}" style="width:100%;font-size:11px;line-height:1.7;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit;resize:vertical;margin-bottom:6px">${profEsc(p[k])}</textarea>`).join('')}
    <div style="display:flex;gap:6px;margin-top:4px">
      <button class="btn btn-primary btn-sm" onclick="profSave()">保存</button>
      <button class="btn btn-outline btn-sm" onclick="profEditingId=null;profRender()">取消</button>
    </div>
  </div>`;

  if(profEditingId==='new'){box.innerHTML=formHtml({});return}

  // 按所属学科分组折叠
  const groups={};
  profList.forEach(p=>{const k=(p.subject||'未分类').trim()||'未分类';if(!groups[k])groups[k]=[];groups[k].push(p);});
  box.innerHTML=Object.entries(groups).map(([subj,list])=>{
    const open=profOpenSubjects.has(subj);
    return `<div style="margin-bottom:8px;border:1px solid var(--border);border-radius:4px;overflow:hidden">
      <div onclick="profToggleSubj('${profEsc(subj)}')" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;user-select:none;${open?'background:var(--bg)':''}">
        <span style="font-size:12px;font-weight:600;color:var(--text-2)">${profEsc(subj)}</span>
        <span style="font-size:10px;color:var(--text-3)">${list.length} 位讲师</span>
        ${list.some(profIncomplete)?`<span style="font-size:9px;color:var(--warn,#b8860b)">⚠ ${list.filter(profIncomplete).length} 位信息不全</span>`:''}
        <span style="font-size:10px;color:var(--text-3);margin-left:auto">${open?'▾ 收起':'▸ 展开'}</span>
      </div>
      ${open?`<div style="padding:8px 14px;border-top:1px solid var(--border-light)">
        ${list.map(p=>profEditingId===p.id?formHtml(p):`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--border-light);border-radius:3px;margin-bottom:6px;flex-wrap:wrap">
          <div style="flex:1;min-width:220px">
            <div style="font-size:12px;font-weight:600">${profEsc(p.name)}
              ${p.real_name?`<span style="font-size:9px;color:var(--ok);margin-left:6px">🔗 ${profEsc(p.real_name)}</span>`:`<span style="font-size:9px;color:var(--text-3);margin-left:6px">未绑定账号</span>`}
              ${profIncomplete(p)?`<span style="font-size:9px;background:var(--warn-bg,#f8f0d8);color:var(--warn,#b8860b);border-radius:2px;padding:0 5px;margin-left:4px">信息不全</span>`:''}
            </div>
            <div style="font-size:10px;color:var(--text-3);margin-top:2px">${profEsc(p.school||'')} ${profEsc(p.degree||'')} · ${profEsc((p.courses||'').slice(0,40))}${(p.courses||'').length>40?'…':''}</div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="profEditingId='${p.id}';profRender()">✏ 编辑</button>
          <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="profDelete('${p.id}')">删除</button>
        </div>`).join('')}
      </div>`:''}
    </div>`;
  }).join('')||'<div class="empty" style="padding:30px">暂无讲师档案，可导入 Excel 或手动新增</div>';
}

function profToggleSubj(s){
  if(profOpenSubjects.has(s)) profOpenSubjects.delete(s); else profOpenSubjects.add(s);
  profRender();
}

async function profSave(){
  const g=id=>(document.getElementById('pf_'+id)||{}).value||'';
  const row={
    name:g('name').trim(), real_name:g('real_name').trim(),
    department:g('department').trim(), subject:g('subject').trim(),
    school:g('school').trim(), degree:g('degree').trim(), years:g('years').trim(),
    vip:g('vip').trim(), courses:g('courses').trim(), keywords:g('keywords').trim(),
    feature:g('feature').trim(), notes:g('notes').trim(),
    sort_order:parseInt((document.getElementById('pf_sort')||{}).value)||0,
  };
  if(!row.name){alert('请填写讲师姓名');return}
  try{
    if(profEditingId==='new'){
      row.id=`prof-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
      await sb('/rest/v1/teacher_profiles','POST',row);
      profList.push(row);
      profOpenSubjects.add((row.subject||'未分类').trim()||'未分类');
    }else{
      await sb(`/rest/v1/teacher_profiles?id=eq.${profEditingId}`,'PATCH',row);
      const idx=profList.findIndex(p=>p.id===profEditingId);
      if(idx>=0) Object.assign(profList[idx],row);
    }
    profEditingId=null;
    profRender();
  }catch(e){alert('保存失败：'+e.message)}
}

async function profDelete(id){
  if(!confirm('删除这位讲师的档案？'))return;
  try{
    await sb(`/rest/v1/teacher_profiles?id=eq.${id}`,'DELETE');
    profList=profList.filter(p=>p.id!==id);
    profRender();
  }catch(e){alert('删除失败：'+e.message)}
}

async function profImportExcel(input){
  const file=input.files[0];
  if(!file)return;
  input.value='';
  if(typeof XLSX==='undefined'){alert('Excel 组件未加载，请刷新页面');return}
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
      const mapped=rows.map(r=>({
        id:`prof-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        name:String(r['讲师姓名']||'').trim(),
        real_name:String(r['真实姓名']||'').trim(),
        department:String(r['所属学系']||'').trim(),
        subject:String(r['所属学科']||'').trim(),
        school:String(r['毕业或所属大学院研究科']||'').trim(),
        degree:String(r['学位（含在读）']||r['学位']||'').trim(),
        years:String(r['执教年份']||'').trim(),
        courses:String(r['担当课程']||'').trim(),
        keywords:String(r['可指导方向（关键词）']||r['可指导方向']||'').trim(),
        vip:String(r['VIP指导']||'').trim(),
        feature:String(r['授课特色']||'').trim(),
        notes:String(r['备注']||'').trim(),
        sort_order:0,
      })).filter(r=>r.name);
      if(!mapped.length){alert('没有识别到有效数据行，请确认列名与讲师信息表一致');return}
      if(!confirm(`识别到 ${mapped.length} 位讲师，确认导入（追加到现有档案）？\n重复导入会产生重复条目，如需重导请先删除旧数据。`))return;
      for(let i=0;i<mapped.length;i+=20){
        await sb('/rest/v1/teacher_profiles','POST',mapped.slice(i,i+20));
      }
      profList=profList.concat(mapped);
      alert(`已导入 ${mapped.length} 位讲师`);
      profRender();
    }catch(err){alert('导入失败：'+err.message)}
  };
  reader.readAsArrayBuffer(file);
}
