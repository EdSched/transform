const params=new URLSearchParams(location.search);
const teacherName=decodeURIComponent(params.get('teacher')||'');
const DAYS=['周日','周一','周二','周三','周四','周五','周六'];
const DOW_COLOR={6:'#1a4a8a',0:'#8a1a2c'};

let slots=[], existingAvail=[], confirmedSessions=[];
const state={};
let curTab='scheduling';

function getState(slotId){
  if(!state[slotId]) state[slotId]={available:false,time:'',titles:new Set()};
  return state[slotId];
}

// 时间段解析 → {start, end} 分钟数
function parseTimeRange(str){
  if(!str) return null;
  const parts=(str||'').split(/[–\-~～]/);
  if(parts.length<2) return null;
  const toMin=s=>{const[h,m]=(s||'').trim().split(':').map(Number);return h*60+(m||0)};
  return{start:toMin(parts[0]),end:toMin(parts[1])};
}
function timeRangesOverlap(a,b){
  if(!a||!b) return false;
  return a.start<b.end&&b.start<a.end;
}

// 检查某个slot是否和已确认课次时间冲突
function getConflict(slot){
  const slotDate=slot.session_date;
  const slotTime=parseTimeRange(slot.time_range);
  for(const cs of confirmedSessions){
    if(cs.session_date!==slotDate) continue;
    if(!slotTime) continue;
    const csTime=parseTimeRange(cs.time_range);
    if(timeRangesOverlap(slotTime,csTime)){
      return `${cs.course_name} ${cs.session_date} ${cs.time_range||''}`;
    }
  }
  // check other selected slots same day
  for(const otherSlot of slots){
    if(otherSlot.id===slot.id) continue;
    if(otherSlot.session_date!==slotDate) continue;
    if(!getState(otherSlot.id).available) continue;
    if(!slotTime) continue;
    const otherTime=parseTimeRange(getState(otherSlot.id).time||otherSlot.time_range);
    if(timeRangesOverlap(slotTime,otherTime)){
      return `同日已选 ${otherSlot.course_name} ${otherSlot.time_range||''}`;
    }
  }
  return null;
}

function courseColor(name){
  if(/宏观|微观|経済|经济/.test(name)) return '#1a3a6a';
  if(/経営|经营/.test(name)) return '#3a2e24';
  if(/共通/.test(name)) return '#3a3830';
  if(/社会人文|社会学/.test(name)) return '#1a4a28';
  if(/新闻|传播/.test(name)) return '#3a2a7a';
  if(/福祉/.test(name)) return '#5a3010';
  return '#3a2e24';
}
function courseBadgeStyle(name){
  if(/共通/.test(name)) return 'background:#ece8e0;color:#3a3830';
  if(/VIP/i.test(name)) return 'background:#faecd8;color:#5a3010';
  return 'background:#e8eef8;color:#1a3a6a';
}

async function init(){
  const mc=document.getElementById('mainContent');
  if(!teacherName){
    mc.innerHTML='<div class="empty">无效链接<br><span style="font-size:11px">请联系学科负责人获取正确链接</span></div>';
    return;
  }
  document.getElementById('headerSub').textContent=`${teacherName} 老师`;
  try{
    // fetch排班时间槽
    slots=await sb(`/rest/v1/schedule_slots?teacher_names=cs.{"${teacherName}"}&select=*&order=session_date.asc`);
    existingAvail=await sb(`/rest/v1/teacher_availability?teacher_name=eq.${encodeURIComponent(teacherName)}&select=*`);

    // fetch已确认课次（两种来源）
    const [confirmedSlots, directSessions, allCourses]=await Promise.all([
      // 从排班系统确认的
      sb(`/rest/v1/schedule_slots?confirmed_teacher=eq.${encodeURIComponent(teacherName)}&select=*`),
      // 直接在course_sessions里有session_teacher且confirmed=true的
      sb(`/rest/v1/course_sessions?session_teacher=ilike.%25${encodeURIComponent(teacherName)}%25&confirmed=eq.true&select=*&order=session_date.asc`).catch(()=>[]),
      // 课程信息
      sb(`/rest/v1/courses?select=id,name,course_type,campus,delivery`).catch(()=>[])
    ]);
    const courseMap={};
    allCourses.forEach(c=>{courseMap[c.id]=c});

    // 合并已确认课次
    const confirmedSet=new Set();
    confirmedSessions=[];
    // 从直接session来的
    directSessions.forEach(s=>{
      const course=courseMap[s.course_id]||{};
      confirmedSet.add(s.id);
      confirmedSessions.push({
        session_id:s.id,
        course_name:s.course_name||course.name||'',
        course_type:course.course_type||'',
        campus:s.campus||course.campus||'',
        session_date:s.session_date,
        session_number:s.session_number,
        time_range:s.time_range,
        session_title:s.session_title||'',
        session_teacher:s.session_teacher||''
      });
    });
    // 从排班确认的（去重）
    confirmedSlots.forEach(sl=>{
      if(!confirmedSet.has(sl.session_id)){
        confirmedSessions.push({
          session_id:sl.session_id,
          course_name:sl.course_name,
          session_date:sl.session_date,
          session_number:sl.session_number,
          time_range:sl.time_range,
          session_title:sl.confirmed_title||'',
          session_teacher:teacherName
        });
      }
    });
    confirmedSessions.sort((a,b)=>a.session_date.localeCompare(b.session_date));

    // restore existing avail state
    existingAvail.forEach(a=>{
      const s=getState(a.slot_id);
      s.available=a.available;
      s.time=a.available_time||'';
      (a.preferred_titles||[]).forEach(t=>s.titles.add(t));
    });

    // show header tabs if has confirmed sessions
    if(confirmedSessions.length>0){
      document.getElementById('headerTabs').style.display='flex';
      document.getElementById('viewScheduleBtn').style.display='inline-flex';
    }

    // decide initial tab: if all slots are replied and confirmed, show schedule
    const allReplied=slots.length>0&&existingAvail.length>=slots.length;
    const allConfirmed=slots.every(s=>s.confirmed_teacher);
    if(slots.length===0&&confirmedSessions.length>0){
      // no pending slots, only confirmed schedule
      curTab='mySchedule';
      document.getElementById('tabScheduling').classList.remove('active');
      document.getElementById('tabMySchedule').classList.add('active');
      document.getElementById('submitBar').style.display='none';
    } else {
      document.getElementById('submitBar').style.display='flex';
    }

    render();
    updateHint();
  }catch(e){mc.innerHTML=`<div class="empty">加载失败：${e.message}</div>`}
}

function switchTab(tab){
  curTab=tab;
  document.getElementById('tabScheduling')?.classList.toggle('active',tab==='scheduling');
  document.getElementById('tabMySchedule')?.classList.toggle('active',tab==='mySchedule');
  render();
}

function render(){
  if(curTab==='mySchedule') renderMySchedule();
  else renderScheduling();
}

// ── 排班确认视图 ──
function renderScheduling(){
  if(!slots.length){
    document.getElementById('mainContent').innerHTML=`
    <div class="empty">
      暂无待确认的排班课次<br>
      <span style="font-size:11px">如需查看已排好的课程，请点右上角「我的课表」</span>
    </div>`;
    return;
  }
  const allTitles=[...new Set(slots.flatMap(s=>s.session_titles||[]))];
  // 按「课程名+期」分组，同一课程不同期分开
  const byCourse={};
  slots.forEach(s=>{
    const d=new Date(s.session_date+'T12:00:00');
    const m=d.getMonth()+1;
    const period=m<=3?'1月期':m<=6?'4月期':m<=9?'7月期':'10月期';
    const year=d.getFullYear();
    const key=`${s.course_name}||${year}${period}`;
    if(!byCourse[key]) byCourse[key]={name:s.course_name,period:`${year}年${period}`,slots:[]};
    byCourse[key].slots.push(s);
  });

  document.getElementById('mainContent').innerHTML=`
  <div class="info-box">
    您好，<strong>${teacherName}</strong> 老师！<br>
    请点击您<strong>可以上课的日期</strong>（打勾），不点的日期视为不可以。<br>
    如有时间或内容偏好，可在展开区域选择。
  </div>
  ${allTitles.length?`<div class="task-box">
    本期您负责的课程内容：
    ${allTitles.map(t=>`<span style="background:rgba(255,255,255,.6);border-radius:2px;padding:1px 8px;margin-right:4px">${t}</span>`).join('')}
  </div>`:''}
  ${Object.values(byCourse).map(({name,period,slots:courseSlots})=>`
    <div style="margin-bottom:24px">
      <div class="section-head" style="color:${courseColor(name)}">${name} <span style="font-size:11px;font-weight:400;background:var(--bg);border-radius:2px;padding:1px 7px;margin-left:4px;color:var(--text-3)">${period}</span> <span style="font-size:11px;font-weight:400;color:var(--text-3)">${courseSlots.length}课次</span></div>
      ${courseSlots.map(s=>renderSlotCard(s)).join('')}
    </div>`).join('')}`;
}

function renderSlotCard(s){
  const st=getState(s.id);
  const d=new Date(s.session_date+'T12:00:00');
  const dow=DAYS[d.getDay()];
  const dowColor=DOW_COLOR[d.getDay()]||'var(--text-2)';
  const hasTwo=!!(s.time_range&&s.time_range_2);
  const titles=s.session_titles||[];
  const conflict=st.available?getConflict(s):null;

  return `<div class="date-card${st.available?' selected':''}${conflict?' conflict':''}" id="card-${s.id}">
    <div class="date-head" onclick="toggleAvail('${s.id}')">
      <div class="date-left">
        <div><span class="date-num">${d.getMonth()+1}/${d.getDate()}</span><span class="date-dow" style="color:${dowColor}">${dow}</span></div>
        <div class="date-meta">${s.time_range||''}${hasTwo?` / ${s.time_range_2}`:''} · 第${s.session_number}回</div>
        ${conflict?`<div class="date-conflict-tag">⚠ 与「${conflict}」时间重叠</div>`:''}
      </div>
      <div class="check-circle${st.available?(conflict?' conflict':' checked'):''}">✓</div>
    </div>
    ${st.available&&(hasTwo||titles.length)?`
    <div class="date-body">
      ${hasTwo?`<div class="sub-label">时间偏好（可不选）</div>
      <div class="chip-row">
        <div class="chip${st.time===s.time_range?' active':''}" onclick="event.stopPropagation();setTime('${s.id}','${s.time_range}')">${s.time_range}</div>
        <div class="chip${st.time===s.time_range_2?' active':''}" onclick="event.stopPropagation();setTime('${s.id}','${s.time_range_2}')">${s.time_range_2}</div>
        <div class="chip ok-active${st.time==='both'?' active':''}" onclick="event.stopPropagation();setTime('${s.id}','both')">两个都行</div>
      </div>`:''}
      ${titles.length?`<div class="sub-label">内容偏好（不选=都可以）</div>
      <div class="chip-row">
        ${titles.map(t=>`<div class="chip${st.titles.has(t)?' active':''}" onclick="event.stopPropagation();toggleTitle('${s.id}','${t.replace(/'/g,"\\'")}')">${t}</div>`).join('')}
      </div>`:''}
    </div>`:''}
  </div>`;
}

// ── 我的课表视图 ──
function renderMySchedule(){
  if(!confirmedSessions.length){
    document.getElementById('mainContent').innerHTML=`
    <div class="empty">暂无已确定的课程<br><span style="font-size:11px">排课确认后这里会显示您的完整课表</span></div>`;
    return;
  }
  // group by month
  const byMonth={};
  confirmedSessions.forEach(s=>{
    const m=s.session_date.slice(0,7);
    if(!byMonth[m]) byMonth[m]=[];
    byMonth[m].push(s);
  });
  const monthNames={'01':'一月','02':'二月','03':'三月','04':'四月','05':'五月','06':'六月','07':'七月','08':'八月','09':'九月','10':'十月','11':'十一月','12':'十二月'};

  document.getElementById('mainContent').innerHTML=`
  <div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
    <div style="font-family:'Noto Serif SC',serif;font-size:15px;font-weight:600">我的课表</div>
    <div style="font-size:11px;color:var(--text-3)">共 ${confirmedSessions.length} 课次</div>
  </div>
  ${Object.entries(byMonth).map(([ym,sessions])=>`
    <div class="month-divider">${ym.slice(0,4)}年 ${monthNames[ym.slice(5,7)]||ym.slice(5,7)+'月'} · ${sessions.length}课次</div>
    ${sessions.map(s=>{
      const d=new Date(s.session_date+'T12:00:00');
      const dow=DAYS[d.getDay()];
      const dowColor=DOW_COLOR[d.getDay()]||'var(--text-2)';
      return `<div class="schedule-card">
        <div class="sc-date">
          <div class="sc-date-num" style="color:${dowColor}">${d.getMonth()+1}/${d.getDate()}</div>
          <div class="sc-date-dow" style="color:${dowColor}">${dow}</div>
        </div>
        <div class="sc-body">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
            <div class="sc-course" style="margin:0">${s.course_name}</div>
            ${(()=>{const d2=new Date(s.session_date+'T12:00:00');const m2=d2.getMonth()+1;const p2=m2<=3?'1月期':m2<=6?'4月期':m2<=9?'7月期':'10月期';return `<span style="font-size:9px;color:var(--text-3);background:var(--bg);border:1px solid var(--border-light);border-radius:2px;padding:1px 5px">${d2.getFullYear()}年${p2}</span>`})()}
          </div>
          <div class="sc-meta">第${s.session_number}回 · ${s.time_range||''} ${s.campus?`· ${s.campus}`:''}</div>
          ${s.session_title?`<div class="sc-title">📌 ${s.session_title}</div>`:''}
        </div>
        <span class="sc-badge" style="${courseBadgeStyle(s.course_name)}">${s.course_type||'专业课'}</span>
      </div>`;
    }).join('')}`).join('')}`;
}

function toggleAvail(slotId){
  const st=getState(slotId);
  st.available=!st.available;
  if(!st.available){st.time='';st.titles.clear()}
  rerenderCard(slotId);
  updateHint();
}
function setTime(slotId,val){
  const st=getState(slotId);
  st.time=st.time===val?'':val;
  rerenderCard(slotId);
}
function toggleTitle(slotId,title){
  const st=getState(slotId);
  st.titles.has(title)?st.titles.delete(title):st.titles.add(title);
  rerenderCard(slotId);
}
function rerenderCard(slotId){
  const s=slots.find(x=>x.id===slotId);
  if(!s) return;
  const el=document.getElementById(`card-${slotId}`);
  if(el) el.outerHTML=renderSlotCard(s);
}
function updateHint(){
  const avail=slots.filter(s=>getState(s.id).available).length;
  document.getElementById('submitHint').textContent=`已选 ${avail} / ${slots.length} 个课次`;
}

async function submitAvailability(){
  const btn=document.getElementById('submitBtn');

  // 冲突检测
  const conflicts=[];
  slots.forEach(s=>{
    if(!getState(s.id).available) return;
    const c=getConflict(s);
    if(c) conflicts.push(`• ${s.session_date} ${s.time_range||''} 与「${c}」重叠`);
  });
  if(conflicts.length){
    const msg=`检测到以下时间冲突，请确认是否继续提交：\n\n${conflicts.join('\n')}\n\n确定继续？`;
    if(!confirm(msg)) return;
  }

  const avail=slots.filter(s=>getState(s.id).available).length;
  if(!avail&&!confirm('您还没有选择任何可以上课的日期，确定提交吗？')) return;

  btn.textContent='提交中…';btn.disabled=true;
  try{
    await sb(`/rest/v1/teacher_availability?teacher_name=eq.${encodeURIComponent(teacherName)}`,'DELETE').catch(()=>{});
    const records=slots.map(s=>{
      const st=getState(s.id);
      const timeStr=st.time==='both'?`${s.time_range} / ${s.time_range_2}`:st.time||'';
      return {
        id:`av-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        slot_id:s.id,teacher_name:teacherName,
        available:st.available,
        available_time:st.available&&timeStr?timeStr:null,
        preferred_titles:st.available&&st.titles.size?[...st.titles]:null,
      };
    });
    await sb('/rest/v1/teacher_availability','POST',records);
    existingAvail=records;
    renderDone(avail);
  }catch(e){alert('提交失败：'+e.message);btn.textContent='提交回复';btn.disabled=false}
}

function renderDone(availCount){
  document.getElementById('submitBar').innerHTML=`
    <div class="hint">已提交 · 选择了 ${availCount} 个课次</div>
    <div style="display:flex;gap:8px">
      ${confirmedSessions.length?`<button class="btn btn-ok" onclick="switchTab('mySchedule')">📅 查看已确定课程</button>`:''}
      <button class="btn btn-outline" onclick="reEdit()">✎ 修改回复</button>
    </div>`;
  document.getElementById('mainContent').innerHTML=`
  <div class="done-box">
    <div class="done-icon">✅</div>
    <div class="done-title">回复已提交！</div>
    <div class="done-sub">
      谢谢 ${teacherName} 老师！<br>
      共 ${slots.length} 个课次，您选择了 <strong>${availCount}</strong> 个可以上课。<br><br>
      最终排课结果确认后，学科负责人会另行通知您。
      ${confirmedSessions.length?'<br>点「查看已确定课程」可以看到您目前的课表。':''}
    </div>
  </div>`;
}

function reEdit(){
  document.getElementById('submitBar').innerHTML=`
    <div class="hint" id="submitHint"></div>
    <div style="display:flex;gap:8px">
      ${confirmedSessions.length?`<button class="btn btn-ok" id="viewScheduleBtn" onclick="switchTab('mySchedule')">📅 查看已确定课程</button>`:''}
      <button class="btn btn-primary" id="submitBtn" onclick="submitAvailability()">提交回复</button>
    </div>`;
  curTab='scheduling';
  document.getElementById('tabScheduling')?.classList.add('active');
  document.getElementById('tabMySchedule')?.classList.remove('active');
  render();
  updateHint();
}

init();
