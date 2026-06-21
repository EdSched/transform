// ══════════════════════════════════
// BOOKING PAGE
// ══════════════════════════════════
let bkSection='regular'; // 'regular' | 'vip'

function renderBookingPage(mc){
  if(bkSection==='vip'){ renderVipBookingPage(mc); return; }
  const ym=`${bkYear}-${String(bkMonth+1).padStart(2,'0')}`;
  let filtered=cachedBookings.filter(b=>b.slot_date&&b.slot_date.startsWith(ym)&&b.type!=='vip');
  if(bkTab!=='all') filtered=filtered.filter(b=>b.status===bkTab);
  if(bkType!=='all') filtered=filtered.filter(b=>b.type===bkType);
  if(bkMajor!=='all') filtered=filtered.filter(b=>{
    // 按学生档案中的真实专业筛选，与该预约的入口标记（bookings.major，如「社会人文」分组链接）无关
    const studentRecord=cachedStudents?.find(s=>s.name===b.name);
    const realMajor=studentRecord?.major||b.major; // 找不到学生档案时退回用 bookings.major，避免数据完全消失
    return matchesMajorFilter(realMajor,bkMajor);
  });
  const total=cachedBookings.filter(b=>b.slot_date&&b.slot_date.startsWith(ym)&&b.type!=='vip').length;

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

function setBkSection(s){ bkSection=s; renderBookingPage(document.getElementById('mainContent')); }

// ── VIP 预约页面 ──
function renderVipBookingPage(mc){
  const ym=`${bkYear}-${String(bkMonth+1).padStart(2,'0')}`;
  let filtered=cachedBookings.filter(b=>b.type==='vip'&&b.slot_date&&b.slot_date.startsWith(ym));
  if(bkTab!=='all') filtered=filtered.filter(b=>b.status===bkTab);
  const total=filtered.length;

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
  </div>
  <div class="export-bar">
    <div style="font-size:12px;color:var(--text-3)">当月 <strong style="color:var(--text)">${total}</strong> 条VIP预约</div>
  </div>
  <div class="btn-group" style="margin-bottom:10px">
    ${['all','pending','confirmed','cancelled'].map((t,i)=>`<button class="${bkTab===t?'active':''}" onclick="setBkTab('${t}',this)">${['全部','待确认','已确认','已取消'][i]}</button>`).join('')}
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
    await sb(`/rest/v1/bookings?id=eq.${bookingId}`, 'PATCH', {
      slot_date: date, slot_time_range: timeRange,
      reschedule_reason: reason, reschedule_by: 'admin',
    });
    Object.assign(b, { slot_date: date, slot_time_range: timeRange, reschedule_reason: reason, reschedule_by: 'admin' });
    document.getElementById('adminVipRescheduleModal').remove();
    renderBookingPage(document.getElementById('mainContent'));
  } catch (e) { alert('保存失败：' + e.message); }
}

function renderVipBookingCard(b){
  const slot=cachedSlots.find(s=>s.id===b.slot_id);
  const teacherName=b.assigned_teacher||slot?.teacher_name||'';
  const studentRecord=cachedStudents?.find(s=>s.name===b.name);
  const totalH=studentRecord?.vip_hours_total||0;
  const usedH=studentRecord?.vip_hours_used||0;
  const remainH=totalH-usedH;
  // 上课前显示该时间槽老师勾选的全部可选内容（参考）；老师填完上课记录后显示实际内容
  const contentDisplay = b.vip_content ? b.vip_content : (slot?.vip_content?.join('・')||'未设置');
  const statusLabel = b.status==='pending'?'待确认':b.status==='confirmed'?(b.student_confirmed?'学生已确认':'已确认'):'已取消';
  const statusColor = b.status==='cancelled'?'var(--danger)':b.student_confirmed?'var(--ok)':b.status==='confirmed'?'#1a6a9a':'#856404';
  const statusBg = b.status==='cancelled'?'#fdecea':b.student_confirmed?'var(--ok-bg)':b.status==='confirmed'?'#e8f4fd':'#fff3cd';
  const code=studentRecord?.student_code;
  return `<div class="booking-card status-${b.status}">
    <div class="booking-header">
      <div>
        <div class="booking-name">${b.name} <span style="font-size:11px;color:var(--text-3);font-weight:400">VIP</span></div>
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
    <div style="display:flex;gap:6px;padding:0 14px 12px">
      ${b.status==='pending'?`<button class="btn btn-primary btn-sm" onclick="confirmBooking('${b.id}')">确认</button>`:''}
      ${b.status!=='cancelled'&&!b.vip_session_notes?`<button class="btn btn-outline btn-sm" onclick="openAdminVipReschedule('${b.id}')">🔄 调整时间</button>`:''}
      ${b.status!=='cancelled'?`<button class="btn btn-outline btn-sm" onclick="cancelBooking('${b.id}')">取消</button>`:''}
    </div>
  </div>`;
}

function renderBookingCard(b){
  const hasRecord=b.daily_record&&Object.values(b.daily_record).some(v=>v);
  const slot=cachedSlots.find(s=>s.id===b.slot_id);
  // 优先使用该预约自己分配的老师（assigned_teacher），避免同一时间槽下其他学生被一起改动；
  // 若该预约从未单独分配过，则退回显示时间槽默认的老师
  const teacherName=b.assigned_teacher||slot?.teacher_name||'';
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
      <div class="note-label" style="margin-bottom:6px">学生查询码</div>
      ${b.teacher_file_url?`<a href="${b.teacher_file_url}" target="_blank" style="font-size:11px;color:var(--accent);display:block;margin-bottom:6px">📎 查看老师修改文件</a>`:''}
      ${(()=>{
        const studentRecord=cachedStudents?.find(s=>s.name===b.name);
        const code=studentRecord?.student_code;
        return code
          ? `<span style="font-size:13px;font-weight:600;letter-spacing:2px;color:var(--accent)">${code}</span>`
          : `<span style="font-size:11px;color:var(--text-3)">该学生档案尚未生成查询码，请前往「学生档案」生成</span>`;
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
