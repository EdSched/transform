// ══════════════════════════════════
// BOOKING PAGE
// ══════════════════════════════════
let bkSection='regular'; // 'regular' | 'vip'
let slotFilterTeacher=''; // 时间槽按填写人筛选
let slotFilterPurpose=''; // 时间槽按用途筛选(''/attendance/interview)

// 预约 → 学生档案：有 student_id 按 id 找；专业以档案为准，没有 student_id 时才用 bookings.major
function bkStudentOf(b){ return (b&&b.student_id)?((cachedStudents||[]).find(s=>s.id===b.student_id)||null):null; }
function bkRealMajor(b){ const s=bkStudentOf(b); return (s&&s.major)||(b&&b.major)||''; }
// 视角判断：还没认领、major 仍是分组代码（shakai_group）的预约，组内任一成员在视角内就显示
function bkMajorInView(m){
  if(typeof MAJOR_GROUPS!=='undefined'&&MAJOR_GROUPS[m]) return majorInCurrentView(m)||MAJOR_GROUPS[m].some(x=>majorInCurrentView(x));
  return majorInCurrentView(m);
}
// 专业筛选：选「社会人文」时，组内成员 + 分组代码本身（未认领的社会人文链接预约）都能筛出来
function bkMajorMatch(m,f){ return f==='all'||expandMajorFilter(f).includes(m); }
function bkIsAdmin(){ return typeof ACCESS_KEY==='undefined'||!ACCESS_KEY||!!ACCESS_KEY.is_admin; }

function renderBookingPage(mc){
  if(bkSection==='vip'){ renderVipBookingPage(mc); return; }
  if(bkSection==='unlinked'){ if(bkIsAdmin()){ renderUnlinkedBookingPage(mc); return; } bkSection='regular'; }
  const ym=`${bkYear}-${String(bkMonth+1).padStart(2,'0')}`;
  let filtered=cachedBookings.filter(b=>b.slot_date&&b.slot_date.startsWith(ym)&&b.type!=='vip');
  // 视角过滤（跟随链接）：非总览时，按学生真实专业判断是否属于当前领域/专业
  filtered=filtered.filter(b=>bkMajorInView(bkRealMajor(b)));
  // 视角过滤（跟随链接）：非总览时，按学生真实专业判断是否属于当前领域/专业
  filtered=filtered.filter(b=>bkMajorInView(bkRealMajor(b)));
  const total=filtered.length; // 当月·本视角预约总数（不受下方 tab/type/专业下拉影响）
  if(bkTab!=='all') filtered=filtered.filter(b=>b.status===bkTab);
  if(bkType!=='all') filtered=filtered.filter(b=>b.type===bkType);
  // 已绑定学生的按档案专业筛选；未绑定的按 bookings.major（社会人文分组链接的预约在「社会人文」下可见）
  if(bkMajor!=='all') filtered=filtered.filter(b=>bkMajorMatch(bkRealMajor(b),bkMajor));

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">预约管理</div>
    <div class="month-nav">
      <button onclick="bkMonthShift(-1)">‹</button>
      <div class="month-display">${bkYear}·${String(bkMonth+1).padStart(2,'0')}</div>
      <button onclick="bkMonthShift(1)">›</button>
    </div>
  </div>
  <div class="btn-group" style="margin-bottom:10px">
    <button class="${bkSection==='regular'?'active':''}" onclick="setBkSection('regular')">面谈预约</button>
    <button class="${bkSection==='vip'?'active':''}" onclick="setBkSection('vip')">VIP预约</button>
    ${bkIsAdmin()?`<button class="${bkSection==='unlinked'?'active':''}" onclick="setBkSection('unlinked')">未关联记录</button>`:''}
  </div>
  ${bkSelfReviewHtml()}
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
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn btn-outline btn-sm" onclick="bkCopyLink('https://edsched.github.io/transform/student/study.html','已复制学习页面链接')">📋 复制学习页面链接（已有查询码的学生通用）</button>
      <span style="font-size:10px;color:var(--text-3)">专业链接只给第一次面谈的新同学用</span>
    </div>
    <div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">新同学预约链接（点专业复制）</div>
    ${bkLinkGroups().map(g=>`<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">
      <span style="font-size:10px;color:var(--text-3);white-space:nowrap;min-width:64px">${g.domain}</span>
      <div style="display:flex;flex-wrap:wrap;gap:5px">${chipFold(g.keys.map(k=>({on:false,html:`<div class="filter-chip" style="margin:0" onclick="bkCopyLink('https://edsched.github.io/transform/student/?major=${k}','已复制「${majorLabel(k)}」预约链接')">${majorLabel(k)}</div>`})))}</div>
    </div>`).join('')}
  </div>
  <div class="filter-row" id="majorFilterRow">
    ${chipFold(majorFilterKeys({includeAll:true}).map((m,i)=>({on:bkMajor===m,html:`<div class="filter-chip${bkMajor===m?' active':''}" onclick="setBkMajor('${m}',this)">${i===0?'全部专业':majorLabel(m)}</div>`})))}
  </div>
  <div class="btn-group" style="margin-bottom:10px">
    ${['all','pending','confirmed','completed','cancelled'].map((t,i)=>`<button class="${bkTab===t?'active':''}" onclick="setBkTab('${t}',this)">${['全部','待确认','已确认','已完成','已取消'][i]}</button>`).join('')}
  </div>
  <div class="filter-row">
    ${['all','daily','plan','mock'].map((t,i)=>`<div class="filter-chip${bkType===t?' active':''}" onclick="setBkType('${t}',this)">${['所有类型','日常学习','计划书','模拟面试'][i]}</div>`).join('')}
  </div>
  <div class="booking-grid" id="bookingGrid">
    ${filtered.length?filtered.map(b=>renderBookingCard(b)).join(''):'<div class="empty">暂无预约记录</div>'}
  </div>`;
}

// ── 学生自主预约的教务审核（老师确认 + 教务审核，两边都通过才算「已确认」）──
let bkSelfOpen=false;
function bkSelfInScope(b){
  const st=bkStudentOf(b);
  if(st&&typeof scopeStudent==='function') return scopeStudent(st);
  return bkMajorInView(bkRealMajor(b));
}
function bkSelfPending(){ return (cachedBookings||[]).filter(b=>b.self_booked&&b.status==='pending'&&(b.admin_review==='pending'||b.admin_review==='room_wait')&&bkSelfInScope(b)); }
function bkSelfWho(){ return (typeof ADMIN_EMAIL!=='undefined'&&ADMIN_EMAIL)||(ACCESS_KEY&&ACCESS_KEY._asTeacher&&ACCESS_KEY._asTeacher.name)||'教务'; }
function bkSelfEsc(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function bkSelfReviewHtml(){
  const list=bkSelfPending();
  if(!list.length) return '';
  const waitN=list.filter(b=>b.admin_review==='room_wait').length;
  const rows=bkSelfOpen?`<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">${list.sort((a,b)=>String(a.slot_date).localeCompare(String(b.slot_date))).map(b=>{
    const wait=b.admin_review==='room_wait';
    return `<div style="background:${wait?'#fff1e0':'var(--surface)'};border:1px solid ${wait?'#e8b27a':'var(--border)'};border-radius:3px;padding:8px 10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px;font-size:12px;line-height:1.7">
        <div><strong>${b.name}</strong> · 老师：${b.assigned_teacher||'—'} · ${b.teacher_ok?'<span style="color:var(--ok)">老师已确认</span>':'<span style="color:var(--text-3)">老师还没确认</span>'}${wait?' <span style="font-size:10px;color:#a0521a;background:#fdf1e6;border:1px solid #e8c9a8;border-radius:2px;padding:0 5px">教室已满·待调整</span>':''}</div>
        <div>${b.slot_date} ${b.slot_time_range||''} · ${locationLong(b.location)||'线上'}${(b.location||'').startsWith('offline')?' <span style="color:var(--danger)">（通过时需安排教室）</span>':''}</div>
        <div style="font-size:10px;color:var(--text-3)">提交时间：${/^\d{10,}$/.test(String(b.id))?new Date(+b.id).toLocaleString('zh-CN',{hour12:false}):(b.created_at||'—')}</div>
        ${wait&&b.admin_review_note?`<details style="font-size:11px"><summary style="cursor:pointer;color:#a0521a">通知文字 ▸</summary>
          <div style="white-space:pre-wrap;background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:6px 8px;margin-top:4px">${bkSelfEsc(b.admin_review_note)}</div>
          <button class="btn btn-outline btn-sm" style="margin-top:4px" onclick="bkSelfCopyNote('${b.id}')">复制</button></details>`:''}
      </div>
      ${wait?`<button class="btn btn-outline btn-sm" onclick="openAdminVipReschedule('${b.id}')">🔄 调整时间</button>`:''}
      <button class="btn btn-primary btn-sm" onclick="bkSelfApprove('${b.id}')">${(b.location||'').startsWith('offline')?'通过并安排教室':'通过'}</button>
      <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger)" onclick="bkSelfReject('${b.id}')">退回</button>
    </div>`;}).join('')}</div>`:'';
  return `<div style="background:#fff8e1;border:1px solid #e6a817;border-radius:3px;padding:9px 12px;margin-bottom:10px">
    <div onclick="bkSelfOpen=!bkSelfOpen;renderBookingPage(document.getElementById('mainContent'))" style="cursor:pointer;font-size:12px;font-weight:600;color:#856404">学生自主预约待审核：${list.length} 条${waitN?`（其中教室待调整 ${waitN} 条）`:''} ${bkSelfOpen?'▾':'→'}</div>${rows}
  </div>`;
}
function bkSelfCopyNote(id){
  const b=cachedBookings.find(x=>x.id===id); if(!b) return;
  bkSelfCopyText(b.admin_review_note||'');
}
function bkSelfCopyText(t){
  const fb=()=>{ const ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); alert('已复制'); }catch(_){ alert('复制失败，请手动选中复制'); } ta.remove(); };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(()=>alert('已复制'),fb); else fb();
}
// 教务通过 = 预约成立（status 直接变「已确认」，学生可正常上课），不等老师确认；线下的在这里安排教室（写入排课系统，和老师端 VIP 预约同一套）
function bkvWeekday(d){ const w=new Date(d+'T12:00:00').getDay(); return w===0?7:w; }
function bkvTimeParts(r){ const m=String(r||'').match(/(\d{1,2}:\d{2})\s*[-–~～]\s*(\d{1,2}:\d{2})/); if(!m) return null; const pad=t=>t.length===4?'0'+t:t; return [pad(m[1]),pad(m[2])]; }
function bkvCampus(loc){ if(!loc) return ''; if(loc.endsWith('ichigaya')) return '市谷'; if(loc.endsWith('takadanobaba')) return '高马'; return ''; }
function bkvErr(e){ try{ const j=JSON.parse(e.message); if(j.message) return j.message; }catch(_){} return e.message; }
function bkvAddDays(d,n){ const x=new Date(d+'T12:00:00Z'); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10); }
function bkvOnDate(x,date){
  if(x.recurrence==='weekly'){ const w=Number(x.weekday); if((w===0?7:w)!==bkvWeekday(date)) return false; if(x.start_date&&date<x.start_date) return false; if(x.end_date&&date>x.end_date) return false; return true; }
  return x.booking_date===date;
}
// 休讲日的周循环课不占教室
async function bkvSkipMap(hits){
  const cids=[...new Set(hits.filter(x=>x.recurrence==='weekly'&&x.course_id).map(x=>x.course_id))];
  const map={};
  if(cids.length){ try{
    const cs=await sb(`/rest/v1/sched_courses?id=in.(${cids.join(',')})&select=id,skip_dates`);
    (cs||[]).forEach(c=>{ map[String(c.id)]=new Set(String(c.skip_dates||'').split(',').map(t=>t.trim()).filter(Boolean)); });
  }catch(_){} }
  return map;
}
function bkvBusy(bks,skip,roomId,date,s,e,excludeId){
  return bks.some(x=>String(x.room_id)===String(roomId)&&!(excludeId&&String(x.id)===String(excludeId))&&x.status!=='rejected'
    &&bkvOnDate(x,date)&&s<x.end_time&&x.start_time<e
    &&!(x.recurrence==='weekly'&&x.course_id&&skip[String(x.course_id)]&&skip[String(x.course_id)].has(date)));
}
// 返回 {vip:[…], big:[…]}；每个教室带 conf（该时段的冲突占用）。excludeSchedId：这条预约自己已占的排课记录，不算冲突
async function bkvLoadRooms(campus,date,start,end,excludeSchedId){
  const all=await sb(`/rest/v1/sched_rooms?campus=eq.${encodeURIComponent(campus)}&type=in.(VIP,${encodeURIComponent('大课')})&select=id,name,campus,type,capacity,active,sort&order=sort`);
  const vip=(all||[]).filter(r=>r.type==='VIP'&&r.active!==false&&!/コスモ|cosmo|外借/i.test(r.name||''));
  const big=(all||[]).filter(r=>r.type==='大课'&&r.active!==false&&!/コスモ|cosmo|外借|租/i.test((r.name||'')+(r.campus||'')));
  const rooms=[...vip,...big];
  if(!rooms.length) return {vip:[],big:[]};
  const bks=await sb(`/rest/v1/sched_bookings?room_id=in.(${rooms.map(r=>r.id).join(',')})&status=neq.rejected&or=(booking_date.eq.${date},recurrence.eq.weekly)&select=id,room_id,course_id,recurrence,booking_date,weekday,start_date,end_date,start_time,end_time,status,title,kind`);
  let hits=(bks||[]).filter(x=>!(excludeSchedId&&String(x.id)===String(excludeSchedId))&&start<x.end_time&&x.start_time<end&&bkvOnDate(x,date));
  const skip=await bkvSkipMap(hits);
  hits=hits.filter(x=>!(x.recurrence==='weekly'&&x.course_id&&skip[String(x.course_id)]&&skip[String(x.course_id)].has(date)));
  const mk=r=>({...r,conf:hits.filter(x=>String(x.room_id)===String(r.id))});
  return {vip:vip.map(mk),big:big.map(mk)};
}
async function bkSelfApprove(id){
  const b=cachedBookings.find(x=>x.id===id); if(!b) return;
  if(!(b.location||'').startsWith('offline')){
    if(!confirm(`通过 ${b.name} 的自主预约？\n通过后预约即成立，学生可以正常上课。`)) return;
    await bkSelfApproveDo(id,null); return;
  }
  const tp=bkvTimeParts(b.slot_time_range), campus=bkvCampus(b.location);
  if(!tp||!campus){ alert('时间段或校区格式无法识别，无法安排教室。可先点「调整时间」改成形如 14:00–16:00 的格式'); return; }
  document.getElementById('bkSelfRoomModal')?.remove();
  const m=document.createElement('div'); m.id='bkSelfRoomModal';
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML=`<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:420px;width:100%;max-height:88vh;overflow-y:auto">
    <div style="font-size:13px;font-weight:600;margin-bottom:4px">通过并安排教室 · ${b.name}</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">${b.slot_date} ${b.slot_time_range||''} · ${locationLong(b.location)} · 老师：${b.assigned_teacher||'—'}</div>
    <div id="bkSelfRoomBody"><div style="font-size:12px;color:var(--text-3)">加载中…</div></div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button id="bkSelfRoomOk" class="btn btn-primary btn-sm" disabled>通过</button>
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('bkSelfRoomModal').remove()">取消</button>
    </div></div>`;
  document.body.appendChild(m);
  const body=document.getElementById('bkSelfRoomBody'), ok=document.getElementById('bkSelfRoomOk');
  try{
    const rs=await bkvLoadRooms(campus,b.slot_date,tp[0],tp[1],b.sched_booking_id);
    window.__bkSelfRooms=[...rs.vip,...rs.big];
    const vipFree=rs.vip.some(r=>!r.conf.length), bigFree=rs.big.filter(r=>!r.conf.length);
    if(vipFree){
      body.innerHTML=`<div class="form-group"><label class="form-label">教室（必选，会写入排课系统）</label><select id="bkSelfRoom"><option value="">请选择教室</option>${rs.vip.map(r=>{const busy=r.conf.length>0;const tag=busy?'占用：'+r.conf.map(c=>(c.title||c.kind||'')+(c.status==='pending'?'·待审批':'')).join('、'):'空闲';return `<option value="${r.id}"${busy?' disabled':''}>${r.name}（${tag}）</option>`;}).join('')}</select>
        <div style="font-size:10px;color:var(--text-3);margin-top:4px">灰色为该时段已占用（含待审批预约）</div></div>`;
      ok.disabled=false; ok.textContent='通过'; ok.onclick=()=>bkSelfApproveRoom(id);
    }else if(bigFree.length){
      body.innerHTML=`<div style="font-size:12px;color:#a0521a;background:#fdf1e6;border:1px solid #e8c9a8;border-radius:3px;padding:6px 8px;margin-bottom:8px">VIP 教室已满，可安排大教室</div>
        <div class="form-group"><label class="form-label">大教室（必选，会写入排课系统）</label><select id="bkSelfRoom"><option value="">请选择教室</option>${bigFree.map(r=>`<option value="${r.id}">${r.name}${r.capacity?'（'+r.capacity+'人）':''}</option>`).join('')}</select></div>`;
      ok.disabled=false; ok.textContent='通过'; ok.onclick=()=>bkSelfApproveRoom(id);
    }else{
      body.innerHTML=`<div style="font-size:12px;color:var(--danger)">VIP 教室和大教室都已排满</div>`;
      ok.disabled=false; ok.textContent='生成调整通知'; ok.onclick=()=>bkSelfNotice(id);
    }
  }catch(e){ body.innerHTML='<div style="font-size:12px;color:var(--danger)">教室加载失败：'+bkSelfEsc(bkvErr(e))+'</div>'; }
}
async function bkSelfApproveRoom(id){
  const sel=document.getElementById('bkSelfRoom'); const roomId=sel&&sel.value;
  if(!roomId){ alert('请选择教室'); return; }
  const r=(window.__bkSelfRooms||[]).find(x=>String(x.id)===String(roomId));
  const btn=document.getElementById('bkSelfRoomOk'); if(btn) btn.disabled=true;
  const ok=await bkSelfApproveDo(id,{id:roomId,name:r?r.name:''});
  if(ok) document.getElementById('bkSelfRoomModal')?.remove(); else if(btn) btn.disabled=false;
}
// 都满了：生成通知文字（当天空档 + 前后 5 天同时段 + 另一校区），VIP 教室和大教室都算
async function bkSelfNotice(id){
  const b=cachedBookings.find(x=>x.id===id); if(!b) return;
  const tp=bkvTimeParts(b.slot_time_range), campus=bkvCampus(b.location); if(!tp||!campus) return;
  const btn=document.getElementById('bkSelfRoomOk'); if(btn){ btn.disabled=true; btn.textContent='生成中…'; }
  try{
    const rooms=window.__bkSelfRooms||[];
    const d0=bkvAddDays(b.slot_date,-5), d1=bkvAddDays(b.slot_date,5);
    const bks=rooms.length?(await sb(`/rest/v1/sched_bookings?room_id=in.(${rooms.map(r=>r.id).join(',')})&status=neq.rejected&or=(recurrence.eq.weekly,and(booking_date.gte.${d0},booking_date.lte.${d1}))&select=id,room_id,course_id,recurrence,booking_date,weekday,start_date,end_date,start_time,end_time,status`))||[]:[];
    const skip=await bkvSkipMap(bks);
    const free=(date,s,e)=>rooms.some(r=>!bkvBusy(bks,skip,r.id,date,s,e,b.sched_booking_id));
    const mins=t=>{ const [h,m]=t.split(':').map(Number); return h*60+m; };
    const hhmm=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
    const dur=mins(tp[1])-mins(tp[0]);
    const sameDay=[];
    for(let st=8*60;st+dur<=22*60&&sameDay.length<6;st+=30){
      if(hhmm(st)===tp[0]) continue;
      if(free(b.slot_date,hhmm(st),hhmm(st+dur))) sameDay.push(hhmm(st)+'-'+hhmm(st+dur));
    }
    const near=[];
    for(let off=1;off<=5;off++) for(const d of [bkvAddDays(b.slot_date,-off),bkvAddDays(b.slot_date,off)]) if(free(d,tp[0],tp[1])) near.push(d);
    const md=d=>`${+d.slice(5,7)}/${+d.slice(8,10)}`;
    const wd='周'+'一二三四五六日'[bkvWeekday(b.slot_date)-1];
    const other=campus==='市谷'?'高马':'市谷';
    let t=`${b.assigned_teacher||''}老师您好：学生 ${b.name} 的 VIP 课 ${md(b.slot_date)}（${wd}）${tp[0]}-${tp[1]} 在 ${campus} 的 VIP 教室和大教室都已排满，需要调整上课时间。`;
    if(sameDay.length) t+=`当天可改约时段：${sameDay.join('、')}。`;
    if(near.length) t+=`同时段就近可约日期：${near.slice(0,6).map(md).join('、')}。`;
    t+=`也可以改到 ${other}。请和学生确认新的时间后告诉我，谢谢！`;
    document.getElementById('bkSelfRoomBody').innerHTML=`<div style="font-size:12px;color:var(--danger);margin-bottom:6px">VIP 教室和大教室都已排满</div>
      <label class="form-label">通知文字（可编辑，复制后发给上课老师）</label>
      <textarea id="bkSelfNoticeText" rows="7" style="width:100%;font-size:12px">${bkSelfEsc(t)}</textarea>
      <button class="btn btn-outline btn-sm" style="margin-top:4px" onclick="bkSelfCopyText(document.getElementById('bkSelfNoticeText').value)">复制文字</button>`;
    if(btn){ btn.disabled=false; btn.textContent='保存为待调整'; btn.onclick=()=>bkSelfSaveWait(id); }
  }catch(e){ alert('生成失败：'+bkvErr(e)); if(btn){ btn.disabled=false; btn.textContent='生成调整通知'; } }
}
// 保存为待调整：预约不取消、不退回；留在待审核列表里，不给学生发消息
async function bkSelfSaveWait(id){
  const b=cachedBookings.find(x=>x.id===id); if(!b) return;
  const text=(document.getElementById('bkSelfNoticeText')||{}).value||'';
  if(!text.trim()){ alert('通知文字不能为空'); return; }
  const patch={admin_review:'room_wait',admin_review_note:text.trim(),admin_review_by:bkSelfWho(),admin_review_at:new Date().toISOString()};
  const btn=document.getElementById('bkSelfRoomOk'); if(btn) btn.disabled=true;
  try{
    const rows=await sb(`/rest/v1/bookings?id=eq.${encodeURIComponent(id)}`,'PATCH',patch);
    if(Array.isArray(rows)&&!rows.length) throw new Error('数据库没有允许修改这条预约（0 行被更新）');
    Object.assign(b,patch);
    document.getElementById('bkSelfRoomModal')?.remove();
    bkSelfOpen=true; renderBookingPage(document.getElementById('mainContent'));
  }catch(e){ alert('保存失败：'+e.message); if(btn) btn.disabled=false; }
}
async function bkSelfApproveDo(id,room){
  const b=cachedBookings.find(x=>x.id===id); if(!b) return false;
  const now=new Date().toISOString(), who=bkSelfWho();
  let schedId=null, createdNew=false;
  if(room){
    const tp=bkvTimeParts(b.slot_time_range);
    const rec={
      room_id:room.id,kind:'vip',title:'VIP·'+((typeof majorLabel==='function'&&majorLabel(bkRealMajor(b)))||b.name),
      user_name:b.assigned_teacher||'',student_name:b.name,recurrence:'once',weekday:bkvWeekday(b.slot_date),booking_date:b.slot_date,
      start_time:tp[0],end_time:tp[1],uses_meeting:false,meeting_account_id:null,show_title:false,
      status:'confirmed',reviewed_at:now,created_by:who,note:'学生自主预约·教务安排'};
    try{
      // 老师确认时已经占过教室：改写那一条（新教室/新时间），改写失败（已被删）再新建
      if(b.sched_booking_id){
        const upd=Object.assign({},rec); delete upd.created_by;
        let rows=null;
        try{
          try{ rows=await sb(`/rest/v1/sched_bookings?id=eq.${b.sched_booking_id}`,'PATCH',upd); }
          catch(e0){
            if(!/42501|row-level security/i.test(e0.message||'')) throw e0;
            rows=await sb(`/rest/v1/sched_bookings?id=eq.${b.sched_booking_id}`,'PATCH',Object.assign({},upd,{status:'pending',reviewed_at:null}));
          }
        }catch(_){ rows=null; }
        if(Array.isArray(rows)&&rows.length) schedId=b.sched_booking_id;
      }
      if(!schedId){
        let ins;
        try{ ins=await sb('/rest/v1/sched_bookings','POST',rec); }
        catch(e1){
          // 这个账号没有权限直接写成「已确认」时，退回成「待审批」（和老师端 VIP 预约一样，之后在排课系统「预约批准」里通过）
          if(!/42501|row-level security/i.test(e1.message||'')) throw e1;
          ins=await sb('/rest/v1/sched_bookings','POST',Object.assign({},rec,{status:'pending',reviewed_at:null}));
        }
        schedId=ins[0].id; createdNew=true;
      }
    }catch(e){ alert('教室预约失败，未通过：'+bkvErr(e)); return false; }
  }
  const patch={admin_review:'approved',admin_review_by:who,admin_review_at:now,status:'confirmed',
    vip_room:room?room.name:(b.vip_room||''),sched_booking_id:schedId||b.sched_booking_id||null,
    messages:[...(b.messages||[]),{from:'system',text:`【预约通过】教务已审批您自主填写的预约（${b.slot_date} ${b.slot_time_range||''}${room&&room.name?'，教室 '+room.name:''}），请按时上课。`,ts:Date.now()}]};
  try{
    const rows=await sb(`/rest/v1/bookings?id=eq.${encodeURIComponent(id)}`,'PATCH',patch);
    if(Array.isArray(rows)&&!rows.length) throw new Error('数据库没有允许修改这条预约（0 行被更新）');
    Object.assign(b,patch); renderBookingPage(document.getElementById('mainContent')); return true;
  }catch(e){
    if(schedId&&createdNew){ try{ await sb(`/rest/v1/sched_bookings?id=eq.${schedId}`,'DELETE'); }catch(_){} }   // 预约没改成功，释放刚占的教室
    alert('操作失败：'+e.message); return false;
  }
}
async function bkSelfReject(id){
  const b=cachedBookings.find(x=>x.id===id); if(!b) return;
  const note=prompt('退回的原因（学生可以看到，必填）：','');
  if(note==null) return;
  if(!note.trim()){ alert('请填写退回原因'); return; }
  const who=bkSelfWho();
  const patch={admin_review:'rejected',admin_review_by:who,admin_review_at:new Date().toISOString(),admin_review_note:note.trim(),
    status:'cancelled',cancel_reason:note.trim(),cancelled_by:'教务退回',cancelled_at:new Date().toISOString(),sched_booking_id:null,
    messages:[...(b.messages||[]),{from:'system',text:`【退回通知】教务退回了您自主填写的预约（${b.slot_date} ${b.slot_time_range||''}）。原因：${note.trim()}`,ts:Date.now()}]};
  try{
    const rows=await sb(`/rest/v1/bookings?id=eq.${encodeURIComponent(id)}`,'PATCH',patch);
    if(Array.isArray(rows)&&!rows.length) throw new Error('数据库没有允许修改这条预约（0 行被更新）');
    if(b.sched_booking_id){ try{ await sb(`/rest/v1/sched_bookings?id=eq.${b.sched_booking_id}`,'DELETE'); }catch(_){} }   // 老师确认时占的教室一并释放
    Object.assign(b,patch); renderBookingPage(document.getElementById('mainContent'));
  }catch(e){ alert('操作失败：'+e.message); }
}

function setBkSection(s){ bkSection=s; renderBookingPage(document.getElementById('mainContent')); }

// ── VIP 预约页面 ──
// 老师端 / 管理员在排课系统里指派大教室或驳回后，把实际教室名同步到预约（学生看的是 vip_room）
let bkVipSynced=false;
async function bkVipSyncRooms(){
  if(bkVipSynced) return; bkVipSynced=true;
  try{
    const vips=(cachedBookings||[]).filter(b=>b.type==='vip'&&b.sched_booking_id&&b.status!=='cancelled'&&b.status!=='completed');
    if(!vips.length) return;
    const ids=[...new Set(vips.map(b=>b.sched_booking_id))];
    const rows=(await sb(`/rest/v1/sched_bookings?id=in.(${ids.join(',')})&select=id,status,room_id,req_other`))||[];
    const rids=[...new Set(rows.map(r=>r.room_id).filter(x=>x!=null))];
    const rooms=rids.length?((await sb(`/rest/v1/sched_rooms?id=in.(${rids.join(',')})&select=id,name`).catch(()=>[]))||[]):[];
    const rname={}; rooms.forEach(r=>{rname[String(r.id)]=r.name;});
    const rmap={}; rows.forEach(r=>{rmap[String(r.id)]=r;});
    let changed=false;
    for(const b of vips){
      const sc=rmap[String(b.sched_booking_id)]; if(!sc) continue;
      let want=null;
      if(sc.status==='rejected'||(sc.req_other&&!sc.room_id)) want='';
      else if(sc.status==='confirmed'&&sc.room_id!=null&&rname[String(sc.room_id)]) want=rname[String(sc.room_id)];
      if(want!==null&&(b.vip_room||'')!==want){
        try{ const r=await sb(`/rest/v1/bookings?id=eq.${encodeURIComponent(b.id)}`,'PATCH',{vip_room:want}); if(Array.isArray(r)&&!r.length) continue; b.vip_room=want; changed=true; }catch(_){}
      }
    }
    if(changed&&bkSection==='vip') renderBookingPage(document.getElementById('mainContent'));
  }catch(_){}
}
function renderVipBookingPage(mc){
  bkVipSyncRooms();
  const ym=`${bkYear}-${String(bkMonth+1).padStart(2,'0')}`;
  let filtered=cachedBookings.filter(b=>b.type==='vip'&&b.slot_date&&b.slot_date.startsWith(ym));
  // 视角过滤（跟随链接）：按学生真实专业判断领域/专业归属
  filtered=filtered.filter(b=>bkMajorInView(bkRealMajor(b)));
  const total=filtered.length; // 当月·本视角VIP预约总数（不受tab影响）
  if(bkTab!=='all') filtered=filtered.filter(b=>b.status===bkTab);

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">预约管理</div>
    <div class="month-nav">
      <button onclick="bkMonthShift(-1)">‹</button>
      <div class="month-display">${bkYear}·${String(bkMonth+1).padStart(2,'0')}</div>
      <button onclick="bkMonthShift(1)">›</button>
    </div>
  </div>
  <div class="btn-group" style="margin-bottom:10px">
    <button class="${bkSection==='regular'?'active':''}" onclick="setBkSection('regular')">面谈预约</button>
    <button class="${bkSection==='vip'?'active':''}" onclick="setBkSection('vip')">VIP预约</button>
    ${bkIsAdmin()?`<button class="${bkSection==='unlinked'?'active':''}" onclick="setBkSection('unlinked')">未关联记录</button>`:''}
  </div>
  ${bkSelfReviewHtml()}
  <div class="export-bar">
    <div style="font-size:12px;color:var(--text-3)">当月 <strong style="color:var(--text)">${total}</strong> 条VIP预约</div>
  </div>
  <div class="btn-group" style="margin-bottom:10px">
    ${['all','pending','confirmed','completed','cancelled'].map((t,i)=>`<button class="${bkTab===t?'active':''}" onclick="setBkTab('${t}',this)">${['全部','待确认','已确认','已完成','已取消'][i]}</button>`).join('')}
  </div>
  <div class="booking-grid" id="bookingGrid">
    ${filtered.length?filtered.map(b=>renderVipBookingCard(b)).join(''):'<div class="empty">暂无VIP预约记录</div>'}
  </div>`;
}

// ── Admin 调整VIP预约时间 ──
function openAdminVipReschedule(bookingId) {
  const b = cachedBookings.find(x => x.id === bookingId);
  if (!b) return;
  const existing = document.getElementById('adminVipRescheduleModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'adminVipRescheduleModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;max-width:380px;width:100%">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">调整 ${b.name} 的VIP课程时间</div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:14px">原时间：${b.slot_date} ${b.slot_time_range || ''}</div>
      <div class="form-group"><label class="form-label">新日期</label><input type="date" id="avr_date" value="${b.slot_date}"></div>
      <div class="form-group"><label class="form-label">新时间段</label>
        <div style="display:grid;grid-template-columns:1fr 16px 1fr;gap:4px;align-items:center">
          <input type="time" id="avr_start" value="${(b.slot_time_range||'').split(/[–\-]/)[0]?.trim()||''}">
          <div style="text-align:center;font-size:11px;color:var(--text-3)">—</div>
          <input type="time" id="avr_end" value="${(b.slot_time_range||'').split(/[–\-]/)[1]?.trim()||''}">
        </div>
      </div>
      <div class="form-group"><label class="form-label">调整原因（必填）</label>
        <select id="avr_reason_select" onchange="document.getElementById('avr_reason_other').style.display=this.value==='其他'?'block':'none'">
          <option value="">请选择</option>
          <option>教室已满</option>
          <option>学生迟到</option>
          <option>学生请假</option>
          <option>学生生病</option>
          <option>老师临时有事</option>
          <option>其他</option>
        </select>
        <input id="avr_reason_other" placeholder="请说明具体原因" style="display:none;margin-top:6px">
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-primary btn-sm" onclick="saveAdminVipReschedule('${bookingId}')">保存</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('adminVipRescheduleModal').remove()">取消</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  if (b.admin_review === 'room_wait') document.getElementById('avr_reason_select').value = '教室已满';
}

async function saveAdminVipReschedule(bookingId) {
  const b = cachedBookings.find(x => x.id === bookingId);
  if (!b) return;
  const date = document.getElementById('avr_date').value;
  const start = document.getElementById('avr_start').value;
  const end = document.getElementById('avr_end').value;
  const reasonSel = document.getElementById('avr_reason_select').value;
  const reasonOther = document.getElementById('avr_reason_other').value.trim();
  const reason = reasonSel === '其他' ? reasonOther : reasonSel;
  if (!date || !start || !end) { alert('请填写完整的新日期和时间'); return; }
  if (!reason) { alert('请填写调整原因'); return; }
  const timeRange = `${start}\u2013${end}`;
  try {
    const patch = { slot_date: date, slot_time_range: timeRange, reschedule_reason: reason, reschedule_by: 'admin' };
    // 教室已满待调整：老师之前占的旧时间教室一并释放（通过时按新时间重新占）
    if (b.admin_review === 'room_wait' && b.sched_booking_id) {
      try { await sb(`/rest/v1/sched_bookings?id=eq.${b.sched_booking_id}`, 'DELETE'); }
      catch (e0) { alert('释放原教室失败，未保存：' + bkvErr(e0)); return; }
      patch.sched_booking_id = null;
    } else if (b.sched_booking_id) {
      // 已占教室的预约：排课记录跟着改到新日期/时间（同一间教室，改回待审批）；新时间被占就释放，让老师重新预约教室
      // 已被驳回的记录不动（status=neq.rejected）
      const moved = { booking_date: date, start_time: start, end_time: end, weekday: bkvWeekday(date), status: 'pending', reviewed_at: null };
      let rows = null, conflict = '';
      try { rows = await sb(`/rest/v1/sched_bookings?id=eq.${b.sched_booking_id}&status=neq.rejected`, 'PATCH', moved); }
      catch (e0) { conflict = bkvErr(e0); }
      if (conflict) {
        try { await sb(`/rest/v1/sched_bookings?id=eq.${b.sched_booking_id}`, 'DELETE'); }
        catch (e1) { alert('教室记录无法调整，时间未保存：' + conflict); return; }
        patch.sched_booking_id = null; patch.vip_room = '';
        alert('原教室在新时间已被占用，已释放，请老师在老师端重新预约教室');
      } else if (!(Array.isArray(rows) && rows.length)) {
        const still = await sb(`/rest/v1/sched_bookings?id=eq.${b.sched_booking_id}&select=id`).catch(() => null);
        if (Array.isArray(still) && !still.length) { patch.sched_booking_id = null; patch.vip_room = ''; }   // 排课记录已不存在
      }
    }
    await sb(`/rest/v1/bookings?id=eq.${bookingId}`, 'PATCH', patch);
    Object.assign(b, patch);
    document.getElementById('adminVipRescheduleModal').remove();
    renderBookingPage(document.getElementById('mainContent'));
  } catch (e) { alert('保存失败：' + e.message); }
}

function renderVipBookingCard(b){
  const slot=cachedSlots.find(s=>s.id===b.slot_id);
  const teacherName=b.assigned_teacher||slot?.teacher_name||'';
  const studentRecord=bkStudentOf(b)||cachedStudents?.find(s=>s.name===b.name);
  const totalH=studentRecord?.vip_hours_total||0;
  const usedH=studentRecord?.vip_hours_used||0;
  const remainH=totalH-usedH;
  // 上课前显示该时间槽老师勾选的全部可选内容（参考）；老师填完上课记录后显示实际内容
  const contentDisplay = b.vip_content ? b.vip_content : (slot?.vip_content?.join('・')||'未设置');
  const statusLabel = bookingStatusLabel(b, true);
  const statusColor = bookingStatusColor(b);
  const statusBg = bookingStatusBg(b);
  const code=studentRecord?.student_code;
  return `<div class="booking-card status-${b.status}">
    <div class="booking-header">
      <div>
        <div class="booking-name">${b.name} <span style="font-size:11px;color:var(--text-3);font-weight:400">VIP</span>${b.self_booked?` <span style="font-size:10px;color:#a0521a;background:#fdf1e6;border:1px solid #e8c9a8;border-radius:2px;padding:0 5px;font-weight:400">自主填写 · ${b.admin_review==='approved'?'教务已通过':b.admin_review==='rejected'?'教务已退回':b.admin_review==='room_wait'?'教室已满·待调整':'待教务审核'} · ${b.teacher_ok?'老师已确认':'老师未确认'}</span>`:''}</div>
        <div class="booking-meta">${b.slot_date} ${b.slot_time_range||''} · ${b.duration||''}min</div>
        ${teacherName?`<div style="font-size:11px;color:var(--text-2);margin-top:2px">👤 ${teacherName} <button class="btn btn-outline btn-sm" style="font-size:10px;padding:1px 7px;margin-left:6px" onclick="openReassignTeacher('${b.id}','${b.slot_id}')">重新分配</button></div>`:`<div style="font-size:11px;color:var(--danger);margin-top:2px">⚠ 未关联老师 <button class="btn btn-outline btn-sm" style="font-size:10px;padding:1px 7px;margin-left:6px" onclick="openReassignTeacher('${b.id}','${b.slot_id}')">分配老师</button></div>`}
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        <span class="status-badge" style="background:${statusBg};color:${statusColor}">${statusLabel}</span>
      </div>
    </div>
    <div class="booking-body">
      <div><div class="bf-label">查询码</div><div class="bf-value" style="${code?'font-weight:600;letter-spacing:1px;color:var(--accent)':'color:var(--text-3);font-size:11px'}">${code||'学生档案尚未生成'}</div></div>
      <div><div class="bf-label">本次VIP内容</div><div class="bf-value">${contentDisplay}</div></div>
      <div><div class="bf-label">课时余额</div><div class="bf-value">剩余 <strong style="color:var(--accent)">${remainH}</strong> / 总 ${totalH}（已用${usedH}）</div></div>
      ${b.location?`<div><div class="bf-label">上课地点</div><div class="bf-value">${locationLong(b.location)||'线上'}</div></div>`:''}
      ${b.student_content?`<div style="grid-column:1/-1"><div class="bf-label">学生提交内容</div><div class="bf-value" style="white-space:pre-wrap">${b.student_content}</div></div>`:''}
      ${b.student_file_url?`<div style="grid-column:1/-1"><a href="${b.student_file_url}" target="_blank" style="font-size:11px;color:var(--accent)">📎 学生上传文件下载</a></div>`:''}
      ${b.reschedule_reason?`<div style="grid-column:1/-1"><div class="bf-label">时间调整记录</div><div class="bf-value">由${b.reschedule_by||'未知'}调整・原因：${b.reschedule_reason}</div></div>`:''}
      ${b.vip_session_notes?`<div style="grid-column:1/-1"><div class="bf-label">上课记录</div><div class="bf-value" style="white-space:pre-wrap">${b.vip_session_notes}</div></div>`:''}
      ${b.student_rating?`<div><div class="bf-label">学生评价</div><div class="bf-value">${b.student_rating}</div></div>`:''}
    </div>
    <div style="display:flex;gap:6px;padding:0 14px 12px;flex-wrap:wrap">
      ${b.status==='pending'&&!b.self_booked?`<button class="btn btn-primary btn-sm" onclick="confirmBooking('${b.id}')">确认</button>`:''}
      ${b.status!=='cancelled'&&!b.vip_session_notes?`<button class="btn btn-outline btn-sm" onclick="openAdminVipReschedule('${b.id}')">🔄 调整时间</button>`:''}
      ${b.status==='completed'?`<button class="btn btn-outline btn-sm" style="color:var(--text-3);font-size:10px" onclick="revertVipToConfirmed('${b.id}')">撤销完成</button>`:''}
      ${b.status!=='cancelled'?`<button class="btn btn-outline btn-sm" onclick="cancelBooking('${b.id}')">取消</button>`:''}
      <button class="btn btn-danger btn-sm" onclick="deleteVipBooking('${b.id}')">删除</button>
    </div>
  </div>`;
}

async function revertVipToConfirmed(id) {
  if (!confirm('确定撤销「已完成」状态，改回「已确认」？')) return;
  try {
    await sb(`/rest/v1/bookings?id=eq.${id}`, 'PATCH', { status: 'confirmed' });
    const b = cachedBookings.find(x => x.id === id);
    if (b) b.status = 'confirmed';
    renderBookingPage(document.getElementById('mainContent'));
  } catch(e) { alert('操作失败：' + e.message); }
}

async function deleteVipBooking(id) {
  if (!confirm('确定彻底删除这条VIP预约记录？此操作不可恢复。')) return;
  try {
    await sb(`/rest/v1/bookings?id=eq.${id}`, 'DELETE');
    cachedBookings = cachedBookings.filter(x => x.id !== id);
    renderBookingPage(document.getElementById('mainContent'));
  } catch(e) { alert('删除失败：' + e.message); }
}

function renderBookingCard(b){
  const hasRecord=b.daily_record&&Object.values(b.daily_record).some(v=>v);
  const slot=cachedSlots.find(s=>s.id===b.slot_id);
  // 优先使用该预约自己分配的老师（assigned_teacher），避免同一时间槽下其他学生被一起改动；
  // 若该预约从未单独分配过，则退回显示时间槽默认的老师
  const teacherName=b.assigned_teacher||slot?.teacher_name||'';
  // 优先显示学生档案中的真实专业；若 booking.major 是社会人文分组标记或学生档案找不到，则退回显示 booking.major
  const displayMajor=MAJORS[bkRealMajor(b)]||bkRealMajor(b)||'';
  return `<div class="booking-card status-${b.status}">
    <div class="booking-header">
      <div>
        <div class="booking-name">${b.name} <span style="font-size:11px;color:var(--text-3);font-weight:400">${displayMajor}</span>${(!b.student_id&&b.type!=='vip')?`<span style="font-size:10px;color:var(--warn);border:1px solid var(--warn);border-radius:2px;padding:0 5px;margin-left:6px;font-weight:400">未关联档案</span><button class="btn btn-outline btn-sm" style="font-size:10px;padding:1px 7px;margin-left:6px" onclick="bkLinkStudent('${b.id}')">关联到学生</button>`:''}${b.name_conflict?'<span style="font-size:10px;color:var(--danger);border:1px solid var(--danger);border-radius:2px;padding:0 5px;margin-left:6px;font-weight:400">⚠ 与在籍学生同名，请确认</span>':''}</div>
        <div class="booking-meta">${b.slot_date} ${b.slot_time_range||''} · ${b.duration}min · ${urgLabel(b.urgency)}</div>
        ${teacherName
          ? `<div style="font-size:11px;color:var(--text-2);margin-top:2px">👤 ${teacherName} <button class="btn btn-outline btn-sm" style="font-size:10px;padding:1px 7px;margin-left:6px" onclick="openReassignTeacher('${b.id}','${b.slot_id}')">重新分配</button></div>`
          : `<div style="font-size:11px;color:var(--danger);margin-top:2px">⚠ 未关联老师 <button class="btn btn-outline btn-sm" style="font-size:10px;padding:1px 7px;margin-left:6px" onclick="openReassignTeacher('${b.id}','${b.slot_id}')">分配老师</button></div>`}
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        <span class="tag ${typeTag(b.type)}">${typeLabel(b.type)}</span>
        <span class="status-badge status-${b.status}">${bookingStatusLabel(b)}</span>
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
      <div class="note-label" style="margin-bottom:6px">学生查询码</div>
      ${b.teacher_file_url?`<a href="${b.teacher_file_url}" target="_blank" style="font-size:11px;color:var(--accent);display:block;margin-bottom:6px">📎 查看老师修改文件</a>`:''}
      ${(()=>{
        const studentRecord=bkStudentOf(b);
        const code=studentRecord?.student_code;
        return code
          ? `<span style="font-size:13px;font-weight:600;letter-spacing:2px;color:var(--accent)">${code}</span>`
          : studentRecord
            ? `<span style="font-size:11px;color:var(--text-3)">该学生档案尚未生成查询码，请前往「学生档案」生成</span>`
            : `<span style="font-size:11px;color:var(--text-3)">这条预约还没有关联学生档案（可在「未关联记录」里合并或建档）</span>`;
      })()}
      <div style="font-size:10px;color:var(--text-muted);margin-top:4px">凭学生姓名＋此查询码可查看面谈记录及作业反馈</div>
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
      ${(b.status==='confirmed'||b.status==='completed')?`<button class="btn btn-sm" style="background:var(--accent-light);color:var(--accent);border-color:var(--border)" onclick="openRecord('${b.id}')">${hasRecord?'查看记录':'填写记录'}</button>`:''}
      ${(b.status!=='cancelled'&&b.status!=='completed')?`<button class="btn btn-danger btn-sm" onclick="cancelBooking('${b.id}')">取消预约</button>`:''}
      ${b.status==='completed'?`<button class="btn btn-outline btn-sm" style="color:var(--text-3);font-size:10px" onclick="revertToConfirmed('${b.id}')">撤销完成</button>`:''}
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
// 认领后同步本地缓存
function bkApplyClaim(ids,r){
  if(!r) return;
  if(r.created&&r.student&&!(cachedStudents||[]).some(s=>s.id===r.student_id)) cachedStudents.push(r.student);
  (cachedBookings||[]).forEach(x=>{ if(ids.includes(x.id)){ x.student_id=r.student_id; x.name=r.name; } });
}
function bkClaimStudents(){ return (cachedStudents||[]).filter(s=>typeof studentInCurrentView!=='function'||studentInCurrentView(s)); }
// 预约卡片上的「关联到学生」：只搜索、选中已有学生，写入 student_id（不建档）
async function bkLinkStudent(id){
  const _b=cachedBookings.find(x=>x.id===id);
  if(!_b) return;
  const r=await openBookingClaim(_b,{students:bkClaimStudents(),searchAll:true,linkOnly:true,title:'关联到学生'});
  if(!r) return;
  bkApplyClaim([id],r);
  renderBookingPage(document.getElementById('mainContent'));
}
async function confirmBooking(id){
  // 没有绑定学生的预约：确认前先认领（挂到已有学生，或建档发查询码）
  const _b=cachedBookings.find(x=>x.id===id);
  if(_b&&!_b.student_id&&_b.type!=='vip'){
    const r=await openBookingClaim(_b,{students:bkClaimStudents()});
    if(!r) return;
    bkApplyClaim([id],r);
  }
  try{const _rows=await sb(`/rest/v1/bookings?id=eq.${id}`,'PATCH',{status:'confirmed'});if(Array.isArray(_rows)&&!_rows.length)throw new Error('数据库没有允许修改这条预约（0 行被更新）');const b=cachedBookings.find(x=>x.id===id);if(b)b.status='confirmed';renderBookingPage(document.getElementById('mainContent'))}catch(e){alert('操作失败：'+e.message)}
}
async function cancelBooking(id){
  if(!confirm('确定取消？'))return;
  try{await sb(`/rest/v1/bookings?id=eq.${id}`,'PATCH',{status:'cancelled'});const b=cachedBookings.find(x=>x.id===id);
    if(b&&b.sched_booking_id){ try{ await sb(`/rest/v1/sched_bookings?id=eq.${b.sched_booking_id}`,'DELETE'); }catch(_){} b.sched_booking_id=null; }   // 释放教室（数据库触发器也会释放，重复删除无害）
    if(b)b.status='cancelled';renderBookingPage(document.getElementById('mainContent'))}catch(e){alert('操作失败：'+e.message)}
}
async function clearCancelledBookings(){
  const ym=`${bkYear}-${String(bkMonth+1).padStart(2,'0')}`;
  const count=cachedBookings.filter(b=>b.status==='cancelled'&&b.slot_date&&b.slot_date.startsWith(ym)).length;
  if(!count){alert('当月没有已取消的预约');return}
  if(!confirm(`确定删除当月 ${count} 条已取消记录？`))return;
  try{await sb(`/rest/v1/bookings?status=eq.cancelled&slot_date=like.${ym}*`,'DELETE');cachedBookings=cachedBookings.filter(b=>!(b.status==='cancelled'&&b.slot_date&&b.slot_date.startsWith(ym)));renderBookingPage(document.getElementById('mainContent'))}catch(e){alert('操作失败：'+e.message)}
}
async function openReassignTeacher(bookingId, slotId) {
  const b = cachedBookings.find(x => x.id === bookingId);
  // 学生档案里的真实专业/领域（与预约入口标记 booking.major 无关）
  const realMajor = bkRealMajor(b);
  const domOf = m => (typeof MAJOR_DOMAIN !== 'undefined' ? MAJOR_DOMAIN[m] : '') || '';
  const stuDomain = domOf(realMajor);

  // 需要 majors/domains/tags 字段做筛选；cachedTeachers 缺这些字段时重新拉
  let teachers = (cachedTeachers && cachedTeachers.length && ('majors' in cachedTeachers[0])) ? cachedTeachers : [];
  if (!teachers.length) {
    try { teachers = await sb('/rest/v1/teachers?select=name,majors,domains,tags&order=name.asc'); } catch(e) { teachers = []; }
  }

  const isAdminOnly = t => { const g = t.tags || []; return g.includes('营业老师') || g.includes('保录老师'); };
  const matches = t => {
    if (isAdminOnly(t)) return false;                       // 营业/保录：仅后台，不作为授课老师分配
    const mj = t.majors || [], dm = t.domains || [];
    if (realMajor && mj.includes(realMajor)) return true;    // 同专业
    if (stuDomain) {                                         // 同领域（含有该领域专业课的老师）
      if (dm.includes(stuDomain)) return true;
      if (mj.some(m => domOf(m) === stuDomain)) return true;
    }
    return false;
  };

  // 优先只显示对口老师；找不到再退回（先排除营业/保录，仍为空才显示全部），保证工具不至于无人可选
  let pool = teachers.filter(matches);
  let scoped = true;
  if (!pool.length) { pool = teachers.filter(t => !isAdminOnly(t)); scoped = false; }
  if (!pool.length) { pool = teachers; scoped = false; }

  const majorLbl = realMajor ? (typeof majorLabel === 'function' ? majorLabel(realMajor) : (MAJORS[realMajor] || realMajor)) : '';
  const options = pool.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
  const hint = scoped
    ? `仅显示${majorLbl ? `「${majorLbl}」` : '该学生专业'}对口老师（已排除营业/保录标签）`
    : `未找到该学生专业的对口老师，已显示全部可授课老师`;

  const modal = document.createElement('div');
  modal.id = 'reassignModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:6px;padding:20px;min-width:280px;max-width:360px;width:90%">
      <div style="font-size:13px;font-weight:600;margin-bottom:14px">重新分配老师</div>
      <div class="form-group">
        <label class="form-label">选择老师</label>
        <select id="reassign_teacher">${options}</select>
        <div style="font-size:10px;color:var(--text-3);margin-top:5px">${hint}</div>
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
    // 只更新这一条预约自己的老师归属，不动 slots 表（避免影响同一时间槽下的其他学生）
    await sb(`/rest/v1/bookings?id=eq.${bookingId}`, 'PATCH', { assigned_teacher: name });
    const b = cachedBookings.find(x => x.id === bookingId);
    if (b) b.assigned_teacher = name;
    document.getElementById('reassignModal').remove();
    renderBookingPage(document.getElementById('mainContent'));
  } catch(e) { alert('操作失败：' + e.message); }
}

async function syncLangScore(id){
  const b=cachedBookings.find(x=>x.id===id);if(!b)return;
  const btn=document.querySelector(`[onclick="syncLangScore('${id}')"]`);
  if(btn){btn.textContent='同步中…';btn.disabled=true}
  try{
    // 按姓名匹配学生档案（不限定专业，因为面谈记录的专业可能是社会人文分组标记，与学生真实专业不同）
    const matches=b.student_id
      ? await sb(`/rest/v1/students?id=eq.${encodeURIComponent(b.student_id)}&select=id,name,major`)
      : await sb(`/rest/v1/students?name=eq.${encodeURIComponent(b.name)}&select=id,name,major`);
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
  const setDeadline = (prefix, val) => {
    const m = (val||'').match(/^(\d{4})年(\d{1,2})月(上旬|中旬|下旬)$/);
    document.getElementById(`${prefix}_y`).value = m ? m[1] : '';
    document.getElementById(`${prefix}_m`).value = m ? m[2] : '';
    document.getElementById(`${prefix}_x`).value = m ? m[3] : '';
  };
  ['study','plan','apply','exam'].forEach(k=>{
    document.getElementById(`rec_${k}_status`).value=r[`${k}_status`]||'';
    document.getElementById(`rec_${k}_advice`).value=r[`${k}_advice`]||'';
    setDeadline(`rec_${k}_deadline`, r[`${k}_deadline`]||'');
  });
  document.getElementById('rec_issue').value=r.issue||'';
  document.getElementById('rec_issue_advice').value=r.issue_advice||'';
  setDeadline('rec_issue_deadline', r.issue_deadline||'');
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
  const readDeadline = (prefix) => {
    const y = document.getElementById(`${prefix}_y`)?.value || '';
    const m = document.getElementById(`${prefix}_m`)?.value || '';
    const x = document.getElementById(`${prefix}_x`)?.value || '';
    return (y && m && x) ? `${y}年${m}月${x}` : '';
  };
  const daily_record={
    study_status:document.getElementById('rec_study_status').value,study_advice:document.getElementById('rec_study_advice').value,study_deadline:readDeadline('rec_study_deadline'),
    plan_status:document.getElementById('rec_plan_status').value,plan_advice:document.getElementById('rec_plan_advice').value,plan_deadline:readDeadline('rec_plan_deadline'),
    apply_status:document.getElementById('rec_apply_status').value,apply_advice:document.getElementById('rec_apply_advice').value,apply_deadline:readDeadline('rec_apply_deadline'),
    exam_status:document.getElementById('rec_exam_status').value,exam_advice:document.getElementById('rec_exam_advice').value,exam_deadline:readDeadline('rec_exam_deadline'),
    issue:document.getElementById('rec_issue').value,issue_advice:document.getElementById('rec_issue_advice').value,issue_deadline:readDeadline('rec_issue_deadline'),
    extra:document.getElementById('rec_extra').value
  };
  const d=document.getElementById('recActualDate').value;
  const t=document.getElementById('recActualTime').value;
  // 如果没填实际时间，默认用预约日期（不附时间段，避免显示时间槽范围）
  const actual_time=(d&&t)?`${d}T${t}`:d||b.slot_date||'';
  try{
    await sb(`/rest/v1/bookings?id=eq.${id}`,'PATCH',{actual_time,daily_record,status:'completed'});
    b.actual_time=actual_time;b.daily_record=daily_record;b.status='completed';

    // 自动追加进度时间线（从面谈记录映射）
    const stu = b.student_id ? bkStudentOf(b) : cachedStudents?.find(s=>s.name===b.name);
    if (stu) {
      const entry = makeProgressEntry({
        studentId: stu.id,
        studentName: b.name,
        major: b.major || stu.major,
        source: 'booking',
        sourceName: '面谈记录',
        bookingId: id,
        recorded_at: actual_time ? actual_time.slice(0,7).replace('-','年') + '月' : '',
        plan: daily_record.plan_status || '',
        apply: daily_record.apply_status || '',
        exam: daily_record.exam_status || '',
        notes: daily_record.extra || '',
      });
      if (entry.plan || entry.apply || entry.exam || entry.notes) {
        sb('/rest/v1/student_progress_timeline','POST',entry).catch(()=>{});
      }
    }

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
    '状态':bookingStatusLabel(b),'实际面谈时间':b.actual_time||'','实际面谈时长':b.actual_duration||'','备注':b.note||'',
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
  let monthSlots=cachedSlots.filter(s=>s.date.startsWith(ym)&&majorInCurrentView(s.major)).sort((a,b)=>a.date.localeCompare(b.date)||a.time_range.localeCompare(b.time_range));
  // 填写人 + 用途 筛选
  if(slotFilterTeacher) monthSlots=monthSlots.filter(s=>(s.teacher_name||'')===slotFilterTeacher);
  if(slotFilterPurpose==='attendance') monthSlots=monthSlots.filter(s=>s.purpose==='attendance');
  else if(slotFilterPurpose==='interview') monthSlots=monthSlots.filter(s=>s.purpose!=='attendance');
  // 本月所有填写人（供下拉）
  const fillers=[...new Set(cachedSlots.filter(s=>s.date.startsWith(ym)&&s.teacher_name).map(s=>s.teacher_name))].sort();
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
      <div class="form-group"><label class="form-label">用途</label>
        <div style="display:flex;gap:6px" id="slotPurposeGroup">
          <div class="filter-chip active" data-value="interview" onclick="selectSlotPurpose(this)" style="padding:5px 16px;cursor:pointer">面谈</div>
          <div class="filter-chip" data-value="attendance" onclick="selectSlotPurpose(this)" style="padding:5px 16px;cursor:pointer">出勤</div>
        </div>
      </div>
      <div class="form-group" id="slotShiftWrap" style="display:none">
        <label class="form-label">班次（点选自动填时间，可再手动改）</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="slotShiftGroup">
          <div class="filter-chip" data-shift="早" data-start="09:30" data-end="18:30" onclick="selectShift(this)" style="padding:4px 12px;cursor:pointer">早 9:30-18:30</div>
          <div class="filter-chip" data-shift="中" data-start="11:00" data-end="20:00" onclick="selectShift(this)" style="padding:4px 12px;cursor:pointer">中 11:00-20:00</div>
          <div class="filter-chip" data-shift="晚" data-start="13:00" data-end="22:00" onclick="selectShift(this)" style="padding:4px 12px;cursor:pointer">晚 13:00-22:00</div>
          <div class="filter-chip" data-shift="半" data-start="09:30" data-end="14:00" onclick="selectShift(this)" style="padding:4px 12px;cursor:pointer">半天（时间自定）</div>
          <div class="filter-chip" data-shift="出差" data-start="09:30" data-end="18:30" onclick="selectShift(this)" style="padding:4px 12px;cursor:pointer">出差</div>
        </div>
      </div>
      <div class="form-group" id="slotAlsoInterviewWrap" style="display:none"></div>
      <div class="form-group"><label class="form-label">专业</label>
        <select id="slotMajor">
          ${Object.entries(MAJORS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" id="slotTypeWrap"><label class="form-label">面谈类型（可多选）</label>
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
        <div style="display:flex;gap:6px;align-items:center">
          <select onchange="slotFilterTeacher=this.value;renderSlotsPage(document.getElementById('mainContent'))" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:3px">
            <option value="">全部填写人</option>
            ${fillers.map(f=>`<option value="${f}" ${slotFilterTeacher===f?'selected':''}>👤${f}</option>`).join('')}
          </select>
          <select onchange="slotFilterPurpose=this.value;renderSlotsPage(document.getElementById('mainContent'))" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:3px">
            <option value="" ${!slotFilterPurpose?'selected':''}>全部用途</option>
            <option value="attendance" ${slotFilterPurpose==='attendance'?'selected':''}>仅出勤</option>
            <option value="interview" ${slotFilterPurpose==='interview'?'selected':''}>仅面谈</option>
          </select>
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
              ${s.purpose==='attendance'?`<span class="tag" style="background:#e8f0e4;color:#2a5a1a">出勤${s.shift?'·'+s.shift:''}</span>`:''}
              ${s.purpose!=='attendance'&&(Array.isArray(s.type)?s.type.length:s.type)?`<span class="tag ${typeTag(Array.isArray(s.type)?s.type[0]:s.type)}">${(Array.isArray(s.type)?s.type:[s.type]).filter(Boolean).map(t=>t==='daily'?'日常':t==='plan'?'计划书':t==='vip'?'VIP':'模拟').join('・')}</span>`:''}
              <span style="font-size:10px;color:var(--text-3)">${MAJORS[s.major]||s.major}</span>
              <span style="font-weight:500">${s.date.slice(5)}</span>
              <span style="font-size:10px;color:${dc}">${dow}</span>
              <span style="color:var(--text-2);font-size:10px">${s.time_range}</span>
              ${s.teacher_name?`<span style="font-size:10px;color:var(--accent,#8b5cf6)">👤${s.teacher_name}</span>`:'<span style="font-size:10px;color:var(--text-3)">👤未标记</span>'}
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
  document.getElementById('repeatEnd').value=localDateStr(today);
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
// 时间槽用途切换：出勤→只显示班次；面谈→显示面谈类型。两者时间各填各的，不再兼容
function selectSlotPurpose(el){
  document.querySelectorAll('#slotPurposeGroup .filter-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  const isAttend = el.dataset.value==='attendance';
  const typeWrap=document.getElementById('slotTypeWrap');
  const shiftWrap=document.getElementById('slotShiftWrap');
  if(shiftWrap) shiftWrap.style.display = isAttend?'block':'none';
  // 出勤：隐藏面谈类型（面谈请单独填）；面谈：显示面谈类型
  if(typeWrap) typeWrap.style.display = isAttend?'none':'block';
}
// 出勤班次：点选自动填标准时间（可再手动改），记录班次名
function selectShift(el){
  document.querySelectorAll('#slotShiftGroup .filter-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  const s=el.dataset.start, e=el.dataset.end;
  if(s) document.getElementById('slotTimeStart').value=s;
  if(e) document.getElementById('slotTimeEnd').value=e;
}
async function addSlot(){
  const ts=document.getElementById('slotTimeStart').value,te=document.getElementById('slotTimeEnd').value;
  const purpose=document.querySelector('#slotPurposeGroup .filter-chip.active')?.dataset.value||'interview';
  const shift=purpose==='attendance'?(document.querySelector('#slotShiftGroup .filter-chip.active')?.dataset.shift||''):'';
  const alsoInterview=false;
  const types=[...document.querySelectorAll('#slotTypeGroup input:checked')].map(c=>c.value);
  const major=document.getElementById('slotMajor').value;
  const location=document.getElementById('slotLocation').value||'online';
  if(!ts||!te){alert('请填写时间段');return}
  if(ts>=te){alert('结束时间需晚于开始时间');return}
  // 只有面谈用途需要选面谈类型；出勤不需要
  const needTypes = purpose==='interview';
  if(needTypes && !types.length){alert('请至少选择一个面谈类型');return}
  const timeRange=`${ts}–${te}`;
  let dates=[];
  if(slotMode==='single'){const d=document.getElementById('slotDate').value;if(!d){alert('请选择日期');return}dates=[d]}
  else{const wds=[...document.querySelectorAll('#weekdayGrid .wd-btn.selected')].map(b=>parseInt(b.dataset.wd));if(!wds.length){alert('请选择至少一个星期');return}const rs=document.getElementById('repeatStart').value,re=document.getElementById('repeatEnd').value;if(!rs||!re){alert('请填写日期范围');return}dates=datesForWeekdays(wds,rs,re);if(!dates.length){alert('所选范围内没有符合的日期');return}}
  const existing=new Set(cachedSlots.map(s=>`${s.date}|${s.time_range}|${(Array.isArray(s.type)?s.type:[s.type]).join(',')}|${s.major}|${s.purpose||'interview'}`));
  const toInsert=[];
  const typeKey=types.join(',');
  for(const date of dates){
    const key=`${date}|${timeRange}|${typeKey}|${major}|${purpose}`;
    if(existing.has(key)) continue;
    if(purpose==='attendance'){
      // 纯出勤（给管理者看，无面谈类型）。面谈请单独填面谈时间槽
      toInsert.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,6)}`,date,time_range:timeRange,type:[],major,location,purpose:'attendance',shift,also_interview:false});
    } else {
      toInsert.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,6)}`,date,time_range:timeRange,type:types,major,location,purpose:'interview',shift:'',also_interview:false});
    }
    existing.add(key);
  }
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

async function revertToConfirmed(id){
  if(!confirm('确定撤销「已完成」状态，改回「已确认」？'))return;
  try{
    await sb(`/rest/v1/bookings?id=eq.${id}`,'PATCH',{status:'confirmed'});
    const b=cachedBookings.find(x=>x.id===id);
    if(b) b.status='confirmed';
    renderBookingPage(document.getElementById('mainContent'));
  }catch(e){alert('操作失败：'+e.message)}
}

// ══════════════════════════════════
// 未关联记录（仅管理员）：student_id 为空的预约，按姓名分组；可合并到已有学生，或建档
// ══════════════════════════════════
let bkUnlinkedOpen=null; // 展开的姓名
function bkUnlinkedGroups(){
  const groups={};
  (cachedBookings||[]).filter(b=>!b.student_id).forEach(b=>{
    const k=b.name||'（未填姓名）';
    (groups[k]=groups[k]||{name:k,list:[]}).list.push(b);
  });
  return Object.values(groups).map(g=>{
    g.list.sort((a,b)=>(b.slot_date||'').localeCompare(a.slot_date||''));
    g.majors=[...new Set(g.list.map(b=>b.major).filter(Boolean))];
    g.sameName=(cachedStudents||[]).filter(s=>s.name===g.name).length;
    return g;
  }).sort((a,b)=>(b.list[0].slot_date||'').localeCompare(a.list[0].slot_date||''));
}
function renderUnlinkedBookingPage(mc){
  const groups=bkUnlinkedGroups();
  const total=groups.reduce((n,g)=>n+g.list.length,0);
  mc.innerHTML=`
  <div class="page-header"><div class="section-title">预约管理</div></div>
  <div class="btn-group" style="margin-bottom:10px">
    <button onclick="setBkSection('regular')">面谈预约</button>
    <button onclick="setBkSection('vip')">VIP预约</button>
    <button class="active" onclick="setBkSection('unlinked')">未关联记录</button>
  </div>
  <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">没有关联学生档案的预约（全部月份） <strong style="color:var(--text)">${total}</strong> 条 · ${groups.length} 个姓名。点一行展开明细；「合并到学生 / 建档」会把这一组全部挂到同一个学生名下。</div>
  ${groups.length?groups.map(g=>{
    const open=bkUnlinkedOpen===g.name;
    const nm=g.name.replace(/'/g,"\\'");
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 12px;cursor:pointer" onclick="bkUnlinkedOpen=bkUnlinkedOpen==='${nm}'?null:'${nm}';renderUnlinkedBookingPage(document.getElementById('mainContent'))">
        <span style="font-size:13px;font-weight:600">${g.name}</span>
        <span style="font-size:11px;color:var(--text-3)">${g.list.length} 条 · ${g.list[g.list.length-1].slot_date||''} ～ ${g.list[0].slot_date||''}</span>
        <span style="font-size:11px;color:var(--text-2)">${g.majors.map(m=>MAJORS[m]||m).join('・')||'未填专业'}</span>
        ${g.sameName?`<span style="font-size:10px;color:var(--warn);border:1px solid var(--warn);border-radius:2px;padding:0 5px">档案里有 ${g.sameName} 个同名学生</span>`:''}
        <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="event.stopPropagation();bkMergeGroup('${nm}')">合并到学生 / 建档</button>
      </div>
      ${open?`<div style="border-top:1px solid var(--border-light);padding:6px 12px">${g.list.map(b=>`<div style="font-size:11px;color:var(--text-2);padding:4px 0;border-bottom:1px dashed var(--border-light)">${b.slot_date||''} ${b.slot_time_range||''} · ${typeLabel(b.type)||b.type||''} · ${MAJORS[b.major]||b.major||''} · ${bookingStatusLabel(b)}</div>`).join('')}</div>`:''}
    </div>`;
  }).join(''):'<div class="empty">没有未关联的预约记录</div>'}`;
}
async function bkMergeGroup(name){
  const g=bkUnlinkedGroups().find(x=>x.name===name);
  if(!g) return;
  const ids=g.list.map(b=>b.id);
  const r=await openBookingClaim(g.list[0],{students:bkClaimStudents(),bookingIds:ids,searchAll:true,title:`「${g.name}」的 ${ids.length} 条记录：合并到学生 / 建档`});
  if(!r) return;
  bkApplyClaim(ids,r);
  bkUnlinkedOpen=null;
  renderUnlinkedBookingPage(document.getElementById('mainContent'));
}

// 学生预约链接面板：专业按领域分组（顺序同 DOMAINS；分组标签如「社会人文」排在成员专业前面）
function bkLinkGroups(){
  const domOf=k=>MAJOR_DOMAIN[k]||(MAJOR_GROUPS[k]?MAJOR_DOMAIN[(MAJOR_GROUPS[k]||[])[0]]:'')||'其他';
  const map={};
  majorFilterKeys().forEach(k=>{ const d=domOf(k); (map[d]=map[d]||[]).push(k); });
  const order=DOMAINS.map(d=>d.label);
  return Object.keys(map).sort((a,b)=>{ const ia=order.indexOf(a), ib=order.indexOf(b); return (ia<0?99:ia)-(ib<0?99:ib); }).map(d=>({domain:d,keys:map[d]}));
}
function bkCopyLink(url,msg){
  const done=()=>bkToast(msg);
  const fallback=()=>{ const t=document.createElement('textarea'); t.value=url; t.style.cssText='position:fixed;opacity:0'; document.body.appendChild(t); t.select(); let ok=false; try{ ok=document.execCommand('copy'); }catch(e){} t.remove(); ok?done():prompt('请手动复制链接：',url); };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(fallback); else fallback();
}
function bkToast(msg){
  let el=document.getElementById('bkToast');
  if(!el){ el=document.createElement('div'); el.id='bkToast'; el.style.cssText='position:fixed;left:50%;bottom:40px;transform:translateX(-50%);background:#1a1814;color:#fff;font-size:12px;padding:8px 16px;border-radius:4px;z-index:9999;pointer-events:none;transition:opacity .2s'; document.body.appendChild(el); }
  el.textContent=msg; el.style.opacity='1';
  clearTimeout(el._t); el._t=setTimeout(()=>{ el.style.opacity='0'; },2000);
}
