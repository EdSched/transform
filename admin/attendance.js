// attendance.js - 出席・作业管理
// Depends on: shared/supabase.js, shared/constants.js

// ── 出席・作业 ──
const ATT_STATUS = [
  {value:'offline', label:'线下出席', color:'var(--ok)', icon:'●'},
  {value:'online',  label:'线上出席', color:'#2a6aad', icon:'◉'},
  {value:'replay',  label:'录播回看', color:'var(--warn)', icon:'▶'},
  {value:'leave',   label:'请假',     color:'var(--text-3)', icon:'△'},
  {value:'absent',  label:'缺席',     color:'var(--danger)', icon:'✕'},
];
function attStatusLabel(v){return ATT_STATUS.find(x=>x.value===v)?.label||'—'}
function attStatusColor(v){return ATT_STATUS.find(x=>x.value===v)?.color||'var(--text-3)'}
function attStatusIcon(v){return ATT_STATUS.find(x=>x.value===v)?.icon||'—'}
function attPresent(v){return v==='offline'||v==='online'||v==='replay'}

let attCourseFilter='all';
let attPeriodFilter='all';
let sessionEdits={};

function renderAttendancePage(mc){
  // 按期数+课程筛选
  const periods=[...new Set(cachedCourses.filter(c=>c.first_session_date).map(c=>{
    const y=c.first_session_date.slice(0,4);
    return y+'年'+c.period;
  }))].sort();
  const filteredCourses=attPeriodFilter==='all'?cachedCourses:cachedCourses.filter(c=>{
    const y=c.first_session_date?.slice(0,4)||'';
    return y+'年'+c.period===attPeriodFilter;
  });
  const courses=attCourseFilter==='all'?filteredCourses:filteredCourses.filter(c=>c.id===attCourseFilter);
  const sessions=cachedSessions.filter(s=>courses.find(c=>c.id===s.course_id)).sort((a,b)=>a.session_date.localeCompare(b.session_date));

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">出席・作业</div>
  </div>
  <div class="filter-row" style="margin-bottom:8px">
    <div class="filter-chip${attPeriodFilter==='all'?' active':''}" onclick="setAttPeriod('all',this)">全部期数</div>
    ${periods.map(p=>`<div class="filter-chip${attPeriodFilter===p?' active':''}" onclick="setAttPeriod('${p}',this)">${p}</div>`).join('')}
  </div>
  <div class="filter-row" style="margin-bottom:16px">
    <div class="filter-chip${attCourseFilter==='all'?' active':''}" onclick="setAttCourse('all',this)">全部课程</div>
    ${filteredCourses.map(c=>`<div class="filter-chip${attCourseFilter===c.id?' active':''}" onclick="setAttCourse('${c.id}',this)" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name}</div>`).join('')}
  </div>
  ${renderSessionList(sessions)}`;
}

function renderSessionList(sessions){
  if(!sessions.length) return '<div class="empty">暂无课次，请先在课程安排里导入课程</div>';
  const byCourse={};
  sessions.forEach(s=>{
    if(!byCourse[s.course_id]) byCourse[s.course_id]=[];
    byCourse[s.course_id].push(s);
  });
  return Object.entries(byCourse).map(([cid,sess])=>{
    const course=cachedCourses.find(c=>c.id===cid)||{name:sess[0]?.course_name||''};
    const color=courseColor(course.name);
    const totalStudents=cachedStudents.filter(s=>s.status==='active'&&(sess[0]?.major||[]).some(m=>m===s.major||m==='shakai_group'&&['shakai','shinpan','fukushi'].includes(s.major))).length;
    return `<div style="margin-bottom:20px;background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden">
      <div style="background:${color.bg};color:${color.text};padding:8px 14px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:space-between">
        <span>${course.name} <span style="font-size:10px;font-weight:400;opacity:.7">${course.time_range||''}</span></span>
        <span style="font-size:10px;opacity:.7">${sess.length}回 · ${totalStudents}人</span>
      </div>
      <table class="student-table" style="margin:0">
        <thead><tr><th style="width:55px">序号</th><th style="width:90px">日期</th><th>单回名称</th><th style="width:90px">出席人数</th><th style="width:90px">出席率</th><th style="width:90px">交作业</th><th style="width:80px">状态</th><th style="width:80px"></th></tr></thead>
        <tbody>
          ${sess.map(s=>{
            const recs=cachedSessionRecords.filter(r=>r.session_id===s.id);
            const present=recs.filter(r=>attPresent(r.attendance_status)).length;
            const hwSubmit=recs.filter(r=>r.homework_submitted).length;
            const rate=totalStudents?Math.round(present/totalStudents*100):0;
            const isDone=recs.length>0&&recs.length>=totalStudents;
            const f=fmtSessionDate(s.session_date);
            return `<tr>
              <td style="font-size:11px;color:var(--text-3)">第${s.session_number}回</td>
              <td style="font-size:12px;font-weight:600">${f.short} <span style="font-size:10px;color:${f.dowColor}">${f.dow}</span></td>
              <td style="font-size:11px;color:var(--text-2)">${s.session_title||'—'}</td>
              <td style="font-size:11px">${recs.length?`${present}/${totalStudents}`:'—'}</td>
              <td style="font-size:11px;color:${rate>=80?'var(--ok)':rate>=60?'var(--warn)':'var(--danger)'}">${recs.length?rate+'%':'—'}</td>
              <td style="font-size:11px">${recs.length?`${hwSubmit}/${totalStudents}`:'—'}</td>
              <td><span style="font-size:10px;padding:2px 7px;border-radius:2px;background:${isDone?'var(--ok-bg)':'var(--bg)'};color:${isDone?'var(--ok)':'var(--text-3)'};border:1px solid ${isDone?'var(--ok)':'var(--border)'}">${isDone?'✓ 完成':'待记录'}</span></td>
              <td><button class="btn btn-outline btn-sm" onclick="openSessionModal('${s.id}')">记录</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }).join('');
}

function setAttPeriod(p,el){attPeriodFilter=p;attCourseFilter='all';document.querySelectorAll('.filter-row .filter-chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');renderAttendancePage(document.getElementById('mainContent'))}
function setAttCourse(id,el){attCourseFilter=id;document.querySelectorAll('.filter-row:last-of-type .filter-chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');renderAttendancePage(document.getElementById('mainContent'))}

// ── Session modal ──
async function openSessionModal(sessionId){
  const session=cachedSessions.find(s=>s.id===sessionId);
  if(!session) return;
  const course=cachedCourses.find(c=>c.id===session.course_id)||{};
  document.getElementById('sessionModalId').value=sessionId;
  document.getElementById('sessionModalTitle').textContent=`${session.course_name} 第${session.session_number}回`;
  document.getElementById('sessionModalSub').textContent=`${session.session_date} · ${session.time_range||''} · ${session.session_title||''}`;
  const majors=session.major||course.major||[];
  const students=cachedStudents.filter(s=>s.status==='active'&&(majors.includes(s.major)||majors.includes('shakai_group')&&['shakai','shinpan','fukushi'].includes(s.major))).sort((a,b)=>a.name.localeCompare(b.name,'zh'));
  let existing=cachedSessionRecords.filter(r=>r.session_id===sessionId);
  if(!existing.length){
    try{existing=await sb(`/rest/v1/session_records?session_id=eq.${sessionId}&select=*`)}catch(e){}
    existing.forEach(r=>{if(!cachedSessionRecords.find(x=>x.id===r.id))cachedSessionRecords.push(r)});
  }
  sessionEdits={};
  const tbody=document.getElementById('sessionRecordBody');
  tbody.innerHTML=students.map(s=>{
    const rec=existing.find(r=>r.student_id===s.id)||{};
    sessionEdits[s.id]={
      student_mode:rec.student_mode||'offline',
      attendance_status:rec.attendance_status||'',
      homework_submitted:rec.homework_submitted||false,
    };
    const mode=rec.student_mode||'offline';
    const att=rec.attendance_status||'';
    const hw=rec.homework_submitted||false;
    return `<tr id="srow-${s.id}">
      <td style="font-size:12px;font-family:'Noto Serif SC',serif;font-weight:600">${s.name}</td>
      <td>
        <button onclick="toggleMode('${s.id}')" id="mode-${s.id}" style="font-size:10px;padding:2px 8px;border-radius:2px;border:1px solid var(--border);cursor:pointer;font-family:inherit;background:${mode==='online'?'#e8eef8':'var(--bg)'};color:${mode==='online'?'#1a3a6a':'var(--text-2)'}">
          ${mode==='online'?'线上':'线下'}
        </button>
      </td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${ATT_STATUS.map(a=>`<button onclick="setAtt('${s.id}','${a.value}')" id="att-${s.id}-${a.value}" style="font-size:10px;padding:2px 7px;border-radius:2px;border:1px solid ${att===a.value?a.color:'var(--border)'};cursor:pointer;font-family:inherit;background:${att===a.value?a.color:'var(--bg)'};color:${att===a.value?'#fff':'var(--text-2)'}">
            ${a.label}
          </button>`).join('')}
        </div>
      </td>
      <td>
        <button onclick="toggleHw('${s.id}')" id="hw-${s.id}" style="font-size:12px;width:28px;height:28px;border-radius:3px;border:1px solid ${hw?'var(--ok)':'var(--border)'};cursor:pointer;background:${hw?'var(--ok)':'var(--bg)'};color:${hw?'#fff':'var(--text-3)'}">
          ${hw?'✓':'—'}
        </button>
      </td>
    </tr>`;
  }).join('');
  document.getElementById('sessionModal').classList.add('open');
}

function toggleMode(studentId){
  const st=sessionEdits[studentId];
  st.student_mode=st.student_mode==='online'?'offline':'online';
  const btn=document.getElementById(`mode-${studentId}`);
  if(btn){btn.textContent=st.student_mode==='online'?'线上':'线下';btn.style.background=st.student_mode==='online'?'#e8eef8':'var(--bg)';btn.style.color=st.student_mode==='online'?'#1a3a6a':'var(--text-2)';btn.style.borderColor=st.student_mode==='online'?'#2a6aad':'var(--border)'}
}

function setAtt(studentId,value){
  const st=sessionEdits[studentId];
  st.attendance_status=st.attendance_status===value?'':value;
  ATT_STATUS.forEach(a=>{
    const btn=document.getElementById(`att-${studentId}-${a.value}`);
    const active=st.attendance_status===a.value;
    if(btn){btn.style.background=active?a.color:'var(--bg)';btn.style.color=active?'#fff':'var(--text-2)';btn.style.borderColor=active?a.color:'var(--border)'}
  });
}

function toggleHw(studentId){
  const st=sessionEdits[studentId];
  st.homework_submitted=!st.homework_submitted;
  const btn=document.getElementById(`hw-${studentId}`);
  if(btn){btn.textContent=st.homework_submitted?'✓':'—';btn.style.background=st.homework_submitted?'var(--ok)':'var(--bg)';btn.style.color=st.homework_submitted?'#fff':'var(--text-3)';btn.style.borderColor=st.homework_submitted?'var(--ok)':'var(--border)'}
}

async function saveSessionRecords(){
  const sessionId=document.getElementById('sessionModalId').value;
  const session=cachedSessions.find(s=>s.id===sessionId);
  if(!session) return;
  const majors=session.major||[];
  const students=cachedStudents.filter(s=>s.status==='active'&&(majors.includes(s.major)||majors.includes('shakai_group')&&['shakai','shinpan','fukushi'].includes(s.major)));
  const btn=document.querySelector('#sessionModal .btn-primary');
  btn.textContent='保存中…';btn.disabled=true;
  try{
    for(const s of students){
      const edit=sessionEdits[s.id];
      if(!edit||!edit.attendance_status) continue;
      const existing=cachedSessionRecords.find(r=>r.session_id===sessionId&&r.student_id===s.id);
      const data={
        session_id:sessionId,course_name:session.course_name,
        session_date:session.session_date,student_id:s.id,
        student_name:s.name,major:s.major,
        student_mode:edit.student_mode||'offline',
        attendance_status:edit.attendance_status,
        homework_submitted:edit.homework_submitted||false,
      };
      if(existing){
        await sb(`/rest/v1/session_records?id=eq.${existing.id}`,'PATCH',data);
        Object.assign(existing,data);
      } else {
        data.id=`r-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
        const res=await sb('/rest/v1/session_records','POST',[data]);
        cachedSessionRecords.push(Array.isArray(res)?res[0]:data);
      }
    }
    btn.textContent='✓ 已保存';
    setTimeout(()=>{btn.textContent='保存全部';btn.disabled=false},1500);
    renderAttendancePage(document.getElementById('mainContent'));
  }catch(e){alert('保存失败：'+e.message);btn.textContent='保存全部';btn.disabled=false}
}

// ── Student detail ──
function openStudentAttModal(studentId){
  const s=cachedStudents.find(x=>x.id===studentId);
  if(!s) return;
  document.getElementById('studentAttTitle').textContent=s.name+' · 出席记录';
  document.getElementById('studentAttSub').textContent=`${MAJORS[s.major]||s.major||''}`;
  const recs=cachedSessionRecords.filter(r=>r.student_id===studentId).sort((a,b)=>a.session_date?.localeCompare(b.session_date));
  const present=recs.filter(r=>attPresent(r.attendance_status)).length;
  const hwSubmit=recs.filter(r=>r.homework_submitted).length;
  document.getElementById('studentAttBody').innerHTML=`
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:8px 14px;font-size:12px">出席 <strong style="color:var(--ok)">${present}/${recs.length}</strong></div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:8px 14px;font-size:12px">出席率 <strong style="color:${present/recs.length>=0.8?'var(--ok)':'var(--warn)'}">${recs.length?Math.round(present/recs.length*100)+'%':'—'}</strong></div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:8px 14px;font-size:12px">作业提交 <strong>${hwSubmit}/${recs.length}</strong></div>
    </div>
    ${recs.length?`<table class="student-table">
      <thead><tr><th>课程</th><th>日期</th><th>单回</th><th>方式</th><th>出席状态</th><th>作业</th></tr></thead>
      <tbody>
        ${recs.map(r=>`<tr>
          <td style="font-size:11px;max-width:160px">${r.course_name||''}</td>
          <td style="font-size:11px">${r.session_date||''}</td>
          <td style="font-size:11px;color:var(--text-3)">${cachedSessions.find(s=>s.id===r.session_id)?.session_title||'—'}</td>
          <td style="font-size:11px">${r.student_mode==='online'?'线上':'线下'}</td>
          <td style="font-size:11px;color:${attStatusColor(r.attendance_status)}">${attStatusLabel(r.attendance_status)}</td>
          <td style="font-size:11px;color:${r.homework_submitted?'var(--ok)':'var(--text-3)'}">${r.homework_submitted?'✓ 已提交':'—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`:'<div class="empty">暂无记录</div>'}`;
  document.getElementById('studentAttModal').classList.add('open');
}
