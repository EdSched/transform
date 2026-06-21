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
            delivery:r.delivery,campus:r.campus,
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

// ══════════════════════════════════
// COURSE CLEANUP PAGE
// ══════════════════════════════════
let cleanupSelected=new Set();
let cleanupTypeFilter='all';
let cleanupMajorFilter='all';
let cleanupPeriodFilter='all';
let cleanupYearFilter='all';

function renderCourseCleanupPage(mc){
  // 按「年份 + 期数」分组，年份取自 first_session_date
  let majorList=cleanupMajorFilter==='all'
    ?['keiei','keizai','shakai','shinpan','fukushi']
    :cleanupMajorFilter==='shakai_group'
      ?['shakai','shinpan','fukushi']
      :[cleanupMajorFilter];
  let filtered=cachedCourses.filter(c=>(c.major||[]).some(m=>majorList.includes(m)));

  if(cleanupTypeFilter==='专业课') filtered=filtered.filter(c=>c.course_type&&!c.course_type.includes('共通')&&!c.course_type.includes('VIP'));
  else if(cleanupTypeFilter==='共通课') filtered=filtered.filter(c=>c.course_type?.includes('共通'));
  else if(cleanupTypeFilter==='VIP') filtered=filtered.filter(c=>c.course_type?.includes('VIP'));

  if(cleanupPeriodFilter!=='all') filtered=filtered.filter(c=>c.period===cleanupPeriodFilter);
  if(cleanupYearFilter!=='all') filtered=filtered.filter(c=>c.first_session_date?.startsWith(cleanupYearFilter));

  const allYears=[...new Set(cachedCourses.filter(c=>c.first_session_date).map(c=>c.first_session_date.slice(0,4)))].sort((a,b)=>b.localeCompare(a));
  const allCleanupPeriods=['1月期','4月期','7月期','10月期'];

  const groups={};
  filtered.forEach(c=>{
    const year=c.first_session_date?c.first_session_date.slice(0,4):'未知年份';
    const period=c.period||'未设期数';
    const key=`${year}年 ${period}`;
    if(!groups[key]) groups[key]={key,year,period,courses:[]};
    groups[key].courses.push(c);
  });
  const sortedKeys=Object.keys(groups).sort((a,b)=>b.localeCompare(a)); // 新的在前

  // 标记可能重复的课程：同名课程出现在同一个分组内超过1次
  const dupKeys=new Set();
  Object.values(groups).forEach(g=>{
    const nameCount={};
    g.courses.forEach(c=>{ nameCount[c.name]=(nameCount[c.name]||0)+1; });
    g.courses.forEach(c=>{ if(nameCount[c.name]>1) dupKeys.add(c.id); });
  });

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">课程清理</div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn btn-outline btn-sm" onclick="cleanupClearSelection()">清空选择</button>
      <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="cleanupDeleteSelected()">删除已选 (<span id="cleanup_count">0</span>)</button>
    </div>
  </div>

  <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:14px;flex-wrap:wrap">
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">课程属性</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${['all','专业课','共通课','VIP'].map((t,i)=>`<div class="filter-chip${cleanupTypeFilter===t?' active':''}" onclick="setCleanupType('${t}',this)" style="font-size:11px;padding:3px 10px">${i===0?'全部':t}</div>`).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">专业</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${['all','keiei','keizai','shakai_group','shakai','shinpan','fukushi'].map((m,i)=>`
          <div class="filter-chip${cleanupMajorFilter===m?' active':''}" onclick="setCleanupMajor('${m}',this)" style="font-size:11px;padding:3px 10px">
            ${i===0?'全部':majorLabel(m)}
          </div>`).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">期数</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <div class="filter-chip${cleanupPeriodFilter==='all'?' active':''}" onclick="setCleanupPeriod('all',this)" style="font-size:11px;padding:3px 10px">全部</div>
        ${allCleanupPeriods.map(p=>`<div class="filter-chip${cleanupPeriodFilter===p?' active':''}" onclick="setCleanupPeriod('${p}',this)" style="font-size:11px;padding:3px 10px">${p}</div>`).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px">年份</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <div class="filter-chip${cleanupYearFilter==='all'?' active':''}" onclick="setCleanupYear('all',this)" style="font-size:11px;padding:3px 10px">全部</div>
        ${allYears.map(y=>`<div class="filter-chip${cleanupYearFilter===y?' active':''}" onclick="setCleanupYear('${y}',this)" style="font-size:11px;padding:3px 10px">${y}年</div>`).join('')}
      </div>
    </div>
  </div>

  <div style="font-size:11px;color:var(--text-3);margin-bottom:14px">按年份与期数分组展示筛选后的课程，标黄的为同分组内同名重复课程。点击行可选中（再点取消），选中后可批量删除。每门课标题旁有「保存为模板」，可将课程结构（专业/课时/地点/单回明细等）存为模板，日后开新一期时直接套用。</div>
  ${!filtered.length?`<div class="empty" style="padding:40px 0">没有符合筛选条件的课程</div>`:`
  <div id="cleanup_list">
    ${sortedKeys.map(key=>{
      const g=groups[key];
      return `
      <div style="margin-bottom:18px">
        <div style="font-size:12px;font-weight:600;color:var(--text-2);padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:8px;display:flex;align-items:center;gap:8px">
          ${key} <span style="font-size:10px;color:var(--text-3);font-weight:400">共 ${g.courses.length} 门</span>
        </div>
        ${g.courses.map(c=>{
          const sessions=cachedSessions.filter(s=>s.course_id===c.id);
          const isDup=dupKeys.has(c.id);
          return `
          <div class="cleanup_row" data-id="${c.id}" data-dup="${isDup?'1':'0'}" onclick="cleanupRowClick(event,'${c.id}')" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid ${isDup?'#e0c060':'var(--border-light)'};background:${isDup?'#fffbe8':'var(--surface)'};border-radius:3px;margin-bottom:6px;transition:background-color .12s">
            <div style="flex:1">
              <div style="font-size:12px;font-weight:600">${c.name} ${isDup?'<span style="font-size:9px;background:#e0c060;color:#5a4a10;border-radius:2px;padding:1px 5px;margin-left:4px">疑似重复</span>':''}</div>
              <div style="font-size:11px;color:var(--text-3);margin-top:2px">
                ${(c.major||[]).map(m=>majorLabel(m)).join('/')} · ${c.teacher||''} · ${c.time_range||''} ·
                ${sessions.length} 条课次记录（设置回数：${c.total_sessions||'-'}）·
                首回 ${c.first_session_date||'-'}
              </div>
            </div>
            <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openSaveAsTemplate('${c.id}')">💾 存为模板</button>
            <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openAddCourseModal('${c.id}')">编辑</button>
            <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="event.stopPropagation();cleanupDeleteSingle('${c.id}')">删除</button>
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}
  </div>`}
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div class="section-title" style="font-size:14px">课程模板</div>
    </div>
    <div id="template_list"></div>
  </div>`;

  renderTemplateList();
}

function setCleanupType(t,el){cleanupTypeFilter=t;document.querySelectorAll('#mainContent .filter-chip').forEach(c=>c.classList.remove('active'));renderCourseCleanupPage(document.getElementById('mainContent'))}
function setCleanupMajor(m,el){cleanupMajorFilter=m;renderCourseCleanupPage(document.getElementById('mainContent'))}
function setCleanupPeriod(p,el){cleanupPeriodFilter=p;renderCourseCleanupPage(document.getElementById('mainContent'))}
function setCleanupYear(y,el){cleanupYearFilter=y;renderCourseCleanupPage(document.getElementById('mainContent'))}

function cleanupRowClick(e,id){
  const row=e.currentTarget;
  if(cleanupSelected.has(id)){
    cleanupSelected.delete(id);
    row.style.backgroundColor='';
    row.style.borderColor=row.dataset.dup==='1'?'#e0c060':'var(--border-light)';
  } else {
    cleanupSelected.add(id);
    row.style.backgroundColor='var(--accent-light, #e8e0d0)';
    row.style.borderColor='var(--accent)';
  }
  document.getElementById('cleanup_count').textContent=cleanupSelected.size;
}
function cleanupClearSelection(){
  cleanupSelected.clear();
  document.querySelectorAll('.cleanup_row').forEach(row=>{
    row.style.backgroundColor='';
    row.style.borderColor=row.dataset.dup==='1'?'#e0c060':'var(--border-light)';
  });
  document.getElementById('cleanup_count').textContent=0;
}
async function cleanupDeleteSingle(courseId){
  if(!confirm('确定删除这门课程及其所有课次记录？此操作不可恢复。'))return;
  try{
    await sb(`/rest/v1/session_records?session_id=in.(${cachedSessions.filter(s=>s.course_id===courseId).map(s=>`"${s.id}"`).join(',')||'""'})`,'DELETE').catch(()=>{});
    await sb(`/rest/v1/course_sessions?course_id=eq.${courseId}`,'DELETE');
    await sb(`/rest/v1/courses?id=eq.${courseId}`,'DELETE');
    cachedCourses=cachedCourses.filter(c=>c.id!==courseId);
    cachedSessions=cachedSessions.filter(s=>s.course_id!==courseId);
    cleanupSelected.delete(courseId);
    renderCourseCleanupPage(document.getElementById('mainContent'));
  }catch(e){alert('删除失败：'+e.message)}
}
async function cleanupDeleteSelected(){
  if(!cleanupSelected.size){alert('请先勾选要删除的课程');return}
  if(!confirm(`确定删除已选中的 ${cleanupSelected.size} 门课程及其所有课次记录？此操作不可恢复。`))return;
  try{
    for(const courseId of cleanupSelected){
      const sessionIds=cachedSessions.filter(s=>s.course_id===courseId).map(s=>s.id);
      if(sessionIds.length) await sb(`/rest/v1/session_records?session_id=in.(${sessionIds.map(i=>`"${i}"`).join(',')})`,'DELETE').catch(()=>{});
      await sb(`/rest/v1/course_sessions?course_id=eq.${courseId}`,'DELETE');
      await sb(`/rest/v1/courses?id=eq.${courseId}`,'DELETE');
    }
    cachedCourses=cachedCourses.filter(c=>!cleanupSelected.has(c.id));
    cachedSessions=cachedSessions.filter(s=>!cleanupSelected.has(s.course_id));
    cleanupSelected.clear();
    renderCourseCleanupPage(document.getElementById('mainContent'));
  }catch(e){alert('删除失败：'+e.message)}
}

// ── 课程模板 ──
function openSaveAsTemplate(courseId){
  const c=cachedCourses.find(x=>x.id===courseId);
  if(!c){alert('找不到课程');return}
  const name=prompt('模板名称：',c.name);
  if(!name)return;
  saveAsTemplate(courseId,name);
}
async function saveAsTemplate(courseId,templateName){
  const c=cachedCourses.find(x=>x.id===courseId);
  if(!c)return;
  const sessions=cachedSessions.filter(s=>s.course_id===courseId).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  const detailRows=sessions.map((s,i)=>({num:s.session_number,title:s.session_title||'',teacher:s.session_teacher||c.teacher||''}));
  const tpl={
    id:`tpl-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
    name:templateName,
    major:c.major,
    course_type:c.course_type,
    weekdays:c.weekdays,
    time_range:c.time_range,
    total_sessions:c.total_sessions,
    actual_hours:c.actual_hours,
    delivery:c.delivery,
    campus:c.campus,
    teacher:c.teacher,
    homework_enabled:c.homework_enabled,
    detail_rows:detailRows
  };
  try{
    await sb('/rest/v1/course_templates','POST',tpl);
    alert(`已保存为模板「${templateName}」`);
    renderTemplateList();
  }catch(e){alert('保存模板失败：'+e.message)}
}
async function renderTemplateList(){
  const wrap=document.getElementById('template_list');
  if(!wrap)return;
  wrap.innerHTML='<div style="font-size:11px;color:var(--text-3)">加载中…</div>';
  try{
    const templates=await sb('/rest/v1/course_templates?select=*&order=created_at.desc');
    if(!templates.length){
      wrap.innerHTML='<div style="font-size:12px;color:var(--text-3);padding:8px 0">暂无保存的模板</div>';
      return;
    }
    wrap.innerHTML=templates.map(t=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--border-light);border-radius:3px;margin-bottom:6px">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:600">${t.name}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">
            ${(t.major||[]).map(m=>majorLabel(m)).join('/')} · ${t.teacher||''} · ${t.time_range||''} · 共${t.total_sessions||'-'}回 · ${t.detail_rows?.length||0}条单回明细
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openApplyTemplate('${t.id}')">套用</button>
        <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="deleteTemplate('${t.id}')">删除模板</button>
      </div>`).join('');
  }catch(e){
    wrap.innerHTML=`<div style="font-size:12px;color:var(--danger)">加载失败：${e.message}</div>`;
  }
}
async function deleteTemplate(templateId){
  if(!confirm('确定删除这个模板？'))return;
  try{
    await sb(`/rest/v1/course_templates?id=eq.${templateId}`,'DELETE');
    renderTemplateList();
  }catch(e){alert('删除失败：'+e.message)}
}
async function openApplyTemplate(templateId){
  const firstDate=prompt('请输入新一期的第一回日期（格式 YYYY-MM-DD）：');
  if(!firstDate)return;
  try{
    const templates=await sb(`/rest/v1/course_templates?id=eq.${templateId}&select=*`);
    const t=templates[0];
    if(!t){alert('模板不存在');return}
    const weekdays=parseWeekdays(t.weekdays||'');
    const dates=generateSessionDatesFromFirst(firstDate,weekdays,t.total_sessions||0);
    if(!dates.length){alert('无法根据模板生成日期，请检查模板的星期设置');return}

    const courseId=`c-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
    const fdMonth=parseInt(firstDate.slice(5,7));
    const period=fdMonth<=3?'1月期':fdMonth<=6?'4月期':fdMonth<=9?'7月期':'10月期';
    await sb('/rest/v1/courses','POST',{
      id:courseId,name:t.name,major:t.major,course_type:t.course_type,
      weekdays:t.weekdays,time_range:t.time_range,total_sessions:t.total_sessions,
      actual_hours:t.actual_hours,delivery:t.delivery,campus:t.campus,teacher:t.teacher,
      homework_enabled:t.homework_enabled,first_session_date:firstDate,period
    });

    const sessions=dates.map((date,i)=>{
      const detail=(t.detail_rows||[]).find(r=>r.num===i+1)||{};
      return {
        id:`s-${Date.now()}-${i}-${Math.random().toString(36).slice(2,4)}`,
        course_id:courseId,course_name:t.name,major:t.major,
        session_date:date,session_number:i+1,
        time_range:t.time_range,actual_hours:t.actual_hours,
        delivery:t.delivery,campus:t.campus,
        teacher:detail.teacher||t.teacher,
        session_title:detail.title||'',
        session_teacher:detail.teacher||t.teacher,
        homework_enabled:t.homework_enabled||false
      };
    });
    for(let i=0;i<sessions.length;i+=20){
      await sb('/rest/v1/course_sessions','POST',sessions.slice(i,i+20));
    }
    alert(`已根据模板「${t.name}」生成新一期课程（${dates.length}回），请到「课程安排」中查看并发布`);
    renderCourseCleanupPage(document.getElementById('mainContent'));
  }catch(e){alert('套用模板失败：'+e.message)}
}

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
    // load existing session details（编辑时始终展示明细表，date 按真实日期排序，便于直接调整）
    const sessions=cachedSessions.filter(s=>s.course_id===editId).sort((a,b)=>a.session_date.localeCompare(b.session_date));
    document.getElementById('ac_has_details').checked=true;
    document.getElementById('ac_details_section').style.display='';
    acPopulateRows(sessions.map(s=>({
      id:s.id,
      num:s.is_cancelled?'休讲':s.session_number,
      date:s.session_date,
      title:s.is_cancelled?(s.cancel_reason||'休讲'):(s.session_title||''),
      teacher:s.session_teacher||c.teacher||''
    })));
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
  const rowNum=data?.num??(tbody.children.length+1);
  const tr=document.createElement('tr');
  tr.dataset.id=data?.id||'';
  tr.innerHTML=`
    <td style="width:64px"><input value="${rowNum}" placeholder="第几回" style="font-size:11px;padding:5px 6px;border:1px solid var(--border);border-radius:2px;width:100%;background:var(--bg);text-align:center;font-family:'DM Mono',monospace"></td>
    <td style="width:120px"><input type="date" value="${data?.date||''}" style="font-size:11px;padding:5px 6px;border:1px solid var(--border);border-radius:2px;width:100%;background:var(--bg)"></td>
    <td><input value="${data?.title||''}" placeholder="单回名称（可留空，也可填「休讲」）" style="font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;width:100%;background:var(--bg);font-family:'DM Mono',monospace"></td>
    <td><input value="${data?.teacher||''}" placeholder="任课老师（可留空）" style="font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:2px;width:100%;background:var(--bg);font-family:'DM Mono',monospace"></td>
    <td><button class="btn-ghost" onclick="this.closest('tr').remove()">✕</button></td>`;
  tbody.appendChild(tr);
}

function acGetRows(){
  return [...document.querySelectorAll('#ac_details_body tr')].map((tr)=>{
    const inputs=tr.querySelectorAll('input');
    return {
      id: tr.dataset.id||'',
      num: inputs[0]?.value.trim()||'',
      date: inputs[1]?.value||'',
      title: inputs[2]?.value.trim()||'',
      teacher: inputs[3]?.value.trim()||''
    };
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

      // ── 编辑模式：单回明细表是唯一真相来源，按行直接覆盖更新，不再按总回数重铺日期 ──
      // 这样可以保留休讲、调课等手动调整的结果，不会被「总回数」逻辑误删
      const existing=cachedSessions.filter(s=>s.course_id===editingId);
      const existingMap={}; existing.forEach(s=>{ existingMap[s.id]=s; });

      const rows=detailRows; // 来自 acGetRows()：[{id,num,date,title,teacher}, ...]
      if(!rows.length){ alert('单回明细不能为空，至少需要一行课次'); return; }
      for(const r of rows){
        if(!r.date){ alert(`第「${r.num}」行缺少日期，请补全后再保存`); return; }
      }

      const rowIds=new Set(rows.filter(r=>r.id).map(r=>r.id));
      const toRemove=existing.filter(s=>!rowIds.has(s.id));

      // 检查将被删除的行是否已有出席/作业记录
      if(toRemove.length){
        const toRemoveIds=toRemove.map(s=>s.id);
        const records=await sb(`/rest/v1/session_records?session_id=in.(${toRemoveIds.map(i=>`"${i}"`).join(',')})&select=id`).catch(()=>[]);
        if(records.length){
          alert('无法保存：表格中被删除的某些课次已有出席/作业记录，不能删除。请恢复该行或先处理相关记录。');
          return;
        }
        await sb(`/rest/v1/course_sessions?id=in.(${toRemoveIds.map(i=>`"${i}"`).join(',')})`,'DELETE');
        cachedSessions=cachedSessions.filter(s=>!toRemoveIds.includes(s.id));
      }

      const confirmed=document.getElementById('ac_confirm_publish')?.checked ?? (existing[0]?.confirmed||false);
      const mainTeacher=courseData.teacher;

      for(const r of rows){
        const isCancelled = r.num==='休讲' || r.title==='休讲';
        const patchCommon={
          course_name:name, major:majors,
          session_date:r.date,
          session_number: isCancelled ? (existingMap[r.id]?.session_number ?? null) : (parseInt(r.num)||null),
          time_range:courseData.time_range,
          actual_hours:courseData.actual_hours,
          delivery:courseData.delivery,campus:courseData.campus,
          homework_enabled:courseData.homework_enabled,
          teacher:r.teacher||mainTeacher,
          session_title:r.title||'',
          session_teacher:r.teacher||mainTeacher,
          is_cancelled:isCancelled,
          cancel_reason:isCancelled?(r.title||'休讲'):null,
        };
        if(r.id && existingMap[r.id]){
          // 已有记录：PATCH，id 不变，所有关联（出席/作业）保持
          await sb(`/rest/v1/course_sessions?id=eq.${r.id}`,'PATCH',patchCommon);
          Object.assign(existingMap[r.id],patchCommon);
        } else {
          // 表格里新增的行：新建记录
          const newRow={
            id:`s-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
            course_id:editingId,
            confirmed,
            ...patchCommon
          };
          const sres=await sb('/rest/v1/course_sessions','POST',[newRow]);
          cachedSessions.push(Array.isArray(sres)?sres[0]:newRow);
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
          delivery:courseData.delivery,campus:courseData.campus,
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
      time_range:timeRange||c.time_range,teacher:c.teacher,
      session_teacher:c.teacher,
      delivery:c.delivery,campus:c.campus
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
      time_range:src.time_range,teacher:src.teacher,
      session_teacher:src.teacher,
      delivery:src.delivery,campus:src.campus,
      actual_hours:src.actual_hours,
      homework_enabled:src.homework_enabled||false,
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
  const allSessions=cachedSessions.filter(s=>s.course_id===courseId).sort((a,b)=>a.session_date.localeCompare(b.session_date));
  const idx=allSessions.findIndex(s=>s.id===id);
  if(idx===-1){alert('找不到该课次');return}

  const course=cachedCourses.find(c=>c.id===courseId);
  const weekdays=parseWeekdays(course?.weekdays||'');
  const lastSession=allSessions[allSessions.length-1];
  const after=allSessions.slice(idx+1); // 休讲之后的所有课次（日期固定，等待填入顺延后的内容）

  if(!confirm(`确认将 ${target.session_date}（第${target.session_number}回）标记为休讲？\n该日期作废、不计入回数。被休讲掉的内容（连同之后所有内容）整体顺延一位，末尾新增一个日期承接原本最后一回的内容。\n\n如需更精细的手动调整（如改回数、改日期），可在「编辑课程」的单回明细表中直接修改。`)) return;

  try{
    // ── 第一步：在做任何修改之前，构造完整的「内容链」快照 ──
    // 内容链 = [target自己原本的内容, after[0]原本的内容, after[1]原本的内容, ..., after[n-1]原本的内容]
    // 共 after.length + 1 份，要依次贴到 [after[0]的日期, after[1]的日期, ..., after[n-1]的日期, 新增日期] 这 after.length+1 个日期上
    const contentChain = [
      { session_title: target.session_title, teacher: target.teacher, session_teacher: target.session_teacher },
      ...after.map(s => ({ session_title: s.session_title, teacher: s.teacher, session_teacher: s.session_teacher }))
    ];
    // contentChain[0] 是休讲那天原本的内容 → 贴到 after[0] 的日期上
    // contentChain[1] 是 after[0] 原本的内容 → 贴到 after[1] 的日期上
    // ...
    // contentChain[after.length] 是 after[after.length-1]（也就是 lastSession）原本的内容 → 贴到新增日期上

    // 1. 标记休讲：日期不变，不计入回数，内容清空
    await sb(`/rest/v1/course_sessions?id=eq.${id}`,'PATCH',{
      is_cancelled:true,
      cancel_reason:reason,
      cancel_note:note||null,
      session_title:'休讲',
      session_teacher:'',
    });
    target.is_cancelled=true; target.cancel_reason=reason; target.cancel_note=note||null;
    target.session_title='休讲'; target.session_teacher='';

    // 2. after 中每节课：日期不变，session_number 减 1，内容＝contentChain 中对应的「前一份」内容
    //    session_teacher 为空时退回用 teacher 字段兜底，避免老师端按 session_teacher 查询时漏掉这节课
    for(let i=0;i<after.length;i++){
      const s=after[i];
      const content=contentChain[i]; // 注意：是 contentChain[i] 不是 [i+1]，因为 contentChain[0] 就是要贴给 after[0] 的
      const teacherVal = content.teacher || s.teacher;
      const patch={
        session_number: s.session_number - 1,
        session_title: content.session_title || '',
        teacher: teacherVal,
        session_teacher: content.session_teacher || teacherVal || '',
      };
      await sb(`/rest/v1/course_sessions?id=eq.${s.id}`,'PATCH',patch);
      Object.assign(s,patch);
    }

    // 3. 新增补课日期，内容＝contentChain 最后一项（原本 lastSession 自己的内容）
    let newDate=new Date(lastSession.session_date+'T12:00:00');
    do{ newDate.setDate(newDate.getDate()+1); } while(weekdays.length && !weekdays.includes(newDate.getDay()));
    const newDateStr=newDate.getFullYear()+'-'+String(newDate.getMonth()+1).padStart(2,'0')+'-'+String(newDate.getDate()).padStart(2,'0');
    const lastContent=contentChain[contentChain.length-1];
    const newTeacherVal = lastContent.teacher || lastSession.teacher;

    const newSession={
      id:`s-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      course_id:courseId,course_name:lastSession.course_name,major:lastSession.major,
      session_date:newDateStr,session_number:lastSession.session_number, // 原始最后编号（顺延前）
      time_range:lastSession.time_range,actual_hours:lastSession.actual_hours,
      delivery:lastSession.delivery,campus:lastSession.campus,
      teacher:newTeacherVal,
      session_title:lastContent.session_title||'',
      session_teacher:lastContent.session_teacher||newTeacherVal||'',
      homework_enabled:lastSession.homework_enabled,confirmed:lastSession.confirmed,
      is_cancelled:false
    };
    const sres=await sb('/rest/v1/course_sessions','POST',[newSession]);
    cachedSessions.push(Array.isArray(sres)?sres[0]:newSession);

    closeModal('rescheduleModal');
    renderCoursesPage(document.getElementById('mainContent'));
    alert(`已将 ${target.session_date} 标记为休讲，内容已整体顺延，并在 ${newDateStr} 新增第${newSession.session_number}回承接原最后一回内容`);
  }catch(e){alert('操作失败：'+e.message)}
}

// ── 出席・作业（see attendance.js）──

// ── Shared ──
function closeModal(id){document.getElementById(id).classList.remove('open')}
document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',function(e){if(e.target===this)this.classList.remove('open')}));

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
