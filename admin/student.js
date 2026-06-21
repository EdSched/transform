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