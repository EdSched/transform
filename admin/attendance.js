// attendance.js - 出席・作业管理
// Depends on: shared/supabase.js, shared/constants.js

const ATT_STATUS = [
  {value:'offline', label:'线下出席', color:'var(--ok)', icon:'●'},
  {value:'online',  label:'线上出席', color:'#2a6aad', icon:'◉'},
  {value:'replay',  label:'录播回看', color:'var(--warn)', icon:'▶'},
  {value:'leave',   label:'请假',     color:'var(--text-3)', icon:'△'},
];
function attStatusLabel(v){
  if(!v) return '缺席';
  return ATT_STATUS.find(x=>x.value===v)?.label||'缺席';
}
function attStatusColor(v){
  if(!v) return 'var(--danger)';
  return ATT_STATUS.find(x=>x.value===v)?.color||'var(--danger)';
}
function attPresent(v){return v==='offline'||v==='online'||v==='replay';}

let attPeriodFilter='';
let attTypeFilter='';
let attMajorFilter='all';
let sessionEdits={};

let attRange='week';   // week | month | all
let attView='list';    // list 课次列表 | status 出席状况
let attHwCount={};     // session_id → 新作业系统的提交人数
let attHwSubs={};      // session_id → Set(已交作业的学生姓名)

function setAttRange(v){attRange=v;renderAttendancePage(document.getElementById('mainContent'))}
function setAttView(v){attView=v;renderAttendancePage(document.getElementById('mainContent'))}

// 载入新作业系统的提交统计（homework_submissions）
async function attLoadHwCounts(){
  try{
    const rows=await sb('/rest/v1/homework_submissions?select=session_id,student_name&limit=5000');
    attHwCount={}; attHwSubs={};
    (rows||[]).forEach(r=>{
      attHwCount[r.session_id]=(attHwCount[r.session_id]||0)+1;
      (attHwSubs[r.session_id]=attHwSubs[r.session_id]||new Set()).add(r.student_name);
    });
    const el=document.getElementById('mainContent');
    if(el&&curPage==='attendance') renderAttendancePage(el);
  }catch(e){}
}

function renderAttendancePage(mc){
  const periods=[...new Set(
    cachedCourses.filter(c=>c.first_session_date&&c.period).map(c=>{
      const y=c.first_session_date.slice(0,4);
      return y+'年'+c.period;
    })
  )].sort();
  const types=[...new Set(cachedCourses.map(c=>c.course_type).filter(Boolean))];

  // courses matching current type+period filter
  let filteredCourses=cachedCourses;
  if(attTypeFilter) filteredCourses=filteredCourses.filter(c=>c.course_type===attTypeFilter);
  if(attPeriodFilter){
    filteredCourses=filteredCourses.filter(c=>{
      const y=c.first_session_date?.slice(0,4)||'';
      return y+'年'+c.period===attPeriodFilter;
    });
  }
  const seen=new Set();
  filteredCourses=filteredCourses.filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true});

  // majors available in filtered courses
  const availMajors=[...new Set(filteredCourses.flatMap(c=>c.major||[]))].filter(m=>MAJORS[m]);

  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">出席・作业</div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:3px;overflow:hidden">
        ${[['week','本周'],['month','本月'],['all','全部']].map(([k,l])=>`<button onclick="setAttRange('${k}')" style="font-size:11px;padding:5px 14px;border:none;cursor:pointer;font-family:inherit;background:${attRange===k?'var(--accent)':'var(--surface)'};color:${attRange===k?'#fff':'var(--text-2)'}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:3px;overflow:hidden">
        ${[['list','课次列表'],['status','出席状况']].map(([k,l])=>`<button onclick="setAttView('${k}')" style="font-size:11px;padding:5px 14px;border:none;cursor:pointer;font-family:inherit;background:${attView===k?'var(--accent)':'var(--surface)'};color:${attView===k?'#fff':'var(--text-2)'}">${l}</button>`).join('')}
      </div>
    </div>
  </div>
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px;margin-bottom:16px">
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <div>
        <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">课程属性</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${types.map(t=>`<div class="filter-chip${attTypeFilter===t?' active':''}" onclick="setAttType('${t}')">${t}</div>`).join('')}
        </div>
      </div>
      <div>
        <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">期数</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${periods.map(p=>`<div class="filter-chip${attPeriodFilter===p?' active':''}" onclick="setAttPeriod('${p}')">${p}</div>`).join('')}
        </div>
      </div>
      ${attTypeFilter&&availMajors.length?`<div>
        <div style="font-size:10px;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">专业</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          <div class="filter-chip${attMajorFilter==='all'?' active':''}" onclick="setAttMajor('all')">全部</div>
          ${availMajors.map(m=>`<div class="filter-chip${attMajorFilter===m?' active':''}" onclick="setAttMajor('${m}')">${MAJORS[m]||m}</div>`).join('')}
        </div>
      </div>`:''}
    </div>
    ${!attTypeFilter&&!attPeriodFilter?'<div style="font-size:11px;color:var(--text-3);margin-top:10px">请选择课程属性或期数查看课次</div>':''}
  </div>
  ${attTypeFilter||attPeriodFilter ? renderSessionList(filteredCourses) : ''}`;
  if(!Object.keys(attHwCount).length) attLoadHwCounts();
}

function renderSessionList(filteredCourses){
  let courses=filteredCourses;
  if(attMajorFilter!=='all'){
    courses=courses.filter(c=>(c.major||[]).includes(attMajorFilter));
  }

  let sessions=cachedSessions
    .filter(s=>courses.find(c=>c.id===s.course_id)&&s.confirmed)
    .sort((a,b)=>a.session_date.localeCompare(b.session_date));

  // 时间范围：默认只看本周，避免一进来就是几百行
  if(attRange!=='all'){
    const now=new Date();
    let from,to;
    if(attRange==='week'){
      const day=(now.getDay()+6)%7;               // 周一为起点
      from=new Date(now); from.setDate(now.getDate()-day);
      to=new Date(from); to.setDate(from.getDate()+6);
    }else{
      from=new Date(now.getFullYear(),now.getMonth(),1);
      to=new Date(now.getFullYear(),now.getMonth()+1,0);
    }
    const f=d=>d.toISOString().slice(0,10);
    sessions=sessions.filter(s=>s.session_date>=f(from)&&s.session_date<=f(to));
  }

  if(!sessions.length) return `<div class="empty" style="padding:36px">${attRange==='all'?'所选条件下暂无已发布的课次':`本${attRange==='week'?'周':'月'}没有课次，可切换到「全部」查看`}</div>`;

  if(attView==='status') return renderAttStatusView(sessions,courses);

  const byCourse={};
  sessions.forEach(s=>{
    if(!byCourse[s.course_id]) byCourse[s.course_id]=[];
    byCourse[s.course_id].push(s);
  });

  return Object.entries(byCourse).map(([cid,sess])=>{
    const course=courses.find(c=>c.id===cid)||{name:sess[0]?.course_name||''};
    const color=courseColor(course.name);
    const majors=sess[0]?.major||course.major||[];
    const totalStudents=cachedStudents.filter(s=>
      s.status==='active'&&(
        majors.includes(s.major)||
        (majors.includes('shakai_group')&&['shakai','shinpan','fukushi'].includes(s.major))
      )
    ).length;

    return `<div style="margin-bottom:20px;background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden">
      <div style="background:${color.bg};color:${color.text};padding:8px 14px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
        <span>${course.name} <span style="font-size:10px;font-weight:400;opacity:.7">${course.time_range||''}</span></span>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;opacity:.7">${sess.length}回 · ${totalStudents}人</span>
          ${sess.some(s=>s.homework_enabled)?`<button onclick="adminBatchDownloadCourse('${cid}')" style="font-size:10px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);border-radius:3px;padding:3px 8px;cursor:pointer;color:inherit;font-family:inherit">📦 下载作业</button>`:''}
        </div>
      </div>
      <div class="table-scroll"><table class="student-table" style="margin:0;min-width:560px">
        <thead><tr>
          <th style="width:52px">回</th>
          <th style="width:86px">日期</th>
          <th>单回名称</th>
          <th style="width:88px">出席</th>
          <th style="width:70px">出席率</th>
          <th style="width:88px">交作业</th>
          <th style="width:120px"></th>
        </tr></thead>
        <tbody>
          ${sess.map(s=>{
            const recs=cachedSessionRecords.filter(r=>r.session_id===s.id);
            const present=recs.filter(r=>attPresent(r.attendance_status)).length;
            // 交作业人数：新作业系统的实际提交（学生提交即自动计入，无需手动记录）
            const hwSubmit=(attHwCount[s.id]||0)||recs.filter(r=>r.homework_submitted||r.homework_file_url).length;
            const rate=totalStudents?Math.round(present/totalStudents*100):0;
            const f=fmtSessionDate(s.session_date);
            const hasHw=!!s.homework_enabled;
            return `<tr>
              <td style="font-size:11px;color:var(--text-3)">${s.session_number}</td>
              <td style="font-size:12px;font-weight:600">${f.short} <span style="font-size:10px;color:${f.dowColor}">${f.dow}</span></td>
              <td style="font-size:11px;color:var(--text-2)">${s.session_title||'—'}${hasHw?'<span style="font-size:9px;color:var(--accent);margin-left:5px">📝</span>':''}</td>
              <td style="font-size:11px">${recs.length?`${present}/${totalStudents}`:'<span style="color:var(--text-3)">—</span>'}</td>
              <td style="font-size:11px;color:${!recs.length?'var(--text-3)':rate>=80?'var(--ok)':rate>=60?'var(--warn)':'var(--danger)'}">${recs.length?rate+'%':'—'}</td>
              <td style="font-size:11px">${hasHw?(hwSubmit?`<span style="color:var(--ok);font-weight:600">${hwSubmit}</span>/${totalStudents}`:`<span style="color:var(--text-3)">0/${totalStudents}</span>`):'<span style="color:var(--text-3)">—</span>'}</td>
              <td style="display:flex;gap:4px">
                <button class="btn btn-outline btn-sm" onclick="openSessionModal('${s.id}')">记出席</button>
                ${hasHw&&hwSubmit?`<button class="btn btn-outline btn-sm" onclick="toggleAdminHwPanel('${s.id}')">作业(${hwSubmit})</button>`:''}
                <button class="btn btn-danger btn-sm" onclick="deleteSession('${s.id}')">删</button>
              </td>
            </tr>
            <tr id="admin_hw_panel_${s.id}" style="display:none">
              <td colspan="7" style="padding:0;background:var(--bg)">
                <div id="admin_hw_content_${s.id}" style="padding:10px 14px">加载中…</div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>`;
  }).join('');
}

async function toggleAdminHwPanel(sessionId) {
  const row = document.getElementById(`admin_hw_panel_${sessionId}`);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : 'table-row';
  if (!isOpen) await loadAdminHwPanel(sessionId);
}

async function loadAdminHwPanel(sessionId) {
  const wrap = document.getElementById(`admin_hw_content_${sessionId}`);
  if (!wrap) return;
  try {
    const recs = await sb(`/rest/v1/session_records?session_id=eq.${sessionId}&select=*&order=student_name.asc`);
    const submitted = recs.filter(r => r.homework_file_url);
    if (!submitted.length) {
      wrap.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px 0">暂无提交作业</div>';
      return;
    }
    window._adminHwRecs = window._adminHwRecs || {};
    window._adminHwRecs[sessionId] = submitted;

    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <span style="font-size:11px;color:var(--text-3)">${submitted.length}/${recs.length} 份已提交</span>
        <button onclick="adminBatchDownloadHw('${sessionId}')" style="font-size:11px;background:none;border:1px solid var(--border);border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit">📦 批量下载（附对照表）</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:2px">
        ${recs.map(r => `
          <div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--border-light)">
            <span style="font-size:12px;font-weight:600;min-width:60px">${r.student_name}</span>
            ${r.homework_file_url
              ? `<a href="${r.homework_file_url}" target="_blank" style="font-size:11px;color:var(--accent)">📎 查看作业</a>`
              : '<span style="font-size:11px;color:var(--text-muted)">未提交</span>'}
            ${r.teacher_file_url
              ? `<a href="${r.teacher_file_url}" target="_blank" style="font-size:11px;color:var(--ok);margin-left:6px">✓ 批改文件</a>`
              : ''}
            ${r.feedback_knowledge||r.feedback_suggestions
              ? `<span style="font-size:10px;color:var(--text-2);margin-left:6px" title="${[r.feedback_knowledge,r.feedback_attitude,r.feedback_suggestions].filter(Boolean).join(' | ')}">💬 ${(r.feedback_knowledge||r.feedback_suggestions||'').slice(0,25)}…</span>`
              : ''}
          </div>`).join('')}
      </div>`;
  } catch(e) {
    wrap.innerHTML = `<div style="font-size:11px;color:var(--danger)">加载失败：${e.message}</div>`;
  }
}

async function adminBatchDownloadHw(sessionId) {
  const recs = (window._adminHwRecs || {})[sessionId] || [];
  if (!recs.length) { alert('暂无可下载的作业'); return; }

  // 先下载对照表
  const listContent = ['文件ID → 学生姓名 对照表', '='.repeat(40)].join('\n') + '\n' +
    recs.map(r => {
      const ext = r.homework_file_url.split('.').pop().split('?')[0].slice(0,5);
      return `${r.id}.${ext}  →  ${r.student_name}`;
    }).join('\n');
  const listBlob = new Blob([listContent], { type: 'text/plain;charset=utf-8' });
  const listA = document.createElement('a');
  listA.href = URL.createObjectURL(listBlob);
  listA.download = `作业对照表_${sessionId}.txt`;
  listA.click();
  URL.revokeObjectURL(listA.href);
  await new Promise(res => setTimeout(res, 300));

  // 下载作业文件
  for (const r of recs) {
    try {
      const res = await fetch(r.homework_file_url);
      const blob = await res.blob();
      const ext = r.homework_file_url.split('.').pop().split('?')[0].slice(0,5);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${r.id}.${ext}`;
      a.click();
      URL.revokeObjectURL(a.href);
      await new Promise(res => setTimeout(res, 400));
    } catch(e) {
      window.open(r.homework_file_url, '_blank');
      await new Promise(res => setTimeout(res, 400));
    }
  }
}

function setAttPeriod(p){
  attPeriodFilter=attPeriodFilter===p?'':p;
  attMajorFilter='all';
  renderAttendancePage(document.getElementById('mainContent'));
}
function setAttType(t){
  attTypeFilter=attTypeFilter===t?'':t;
  attMajorFilter='all';
  renderAttendancePage(document.getElementById('mainContent'));
}
function setAttMajor(m){
  attMajorFilter=m;
  renderAttendancePage(document.getElementById('mainContent'));
}

// ── Session modal ──
async function openSessionModal(sessionId){
  const session=cachedSessions.find(s=>s.id===sessionId);
  if(!session) return;
  const course=cachedCourses.find(c=>c.id===session.course_id)||{};
  document.getElementById('sessionModalId').value=sessionId;
  document.getElementById('sessionModalTitle').textContent=`${session.course_name} 第${session.session_number}回`;
  document.getElementById('sessionModalSub').textContent=`${session.session_date} · ${session.time_range||''} · ${session.session_title||''}`;

  const majors=session.major||course.major||[];
  const students=cachedStudents.filter(s=>
    s.status==='active'&&(
      majors.includes(s.major)||
      (majors.includes('shakai_group')&&['shakai','shinpan','fukushi'].includes(s.major))
    )
  ).sort((a,b)=>a.name.localeCompare(b.name,'zh'));

  let existing=cachedSessionRecords.filter(r=>r.session_id===sessionId);
  if(!existing.length){
    try{existing=await sb(`/rest/v1/session_records?session_id=eq.${sessionId}&select=*`)}catch(e){}
    existing.forEach(r=>{if(!cachedSessionRecords.find(x=>x.id===r.id))cachedSessionRecords.push(r)});
  }

  sessionEdits={};
  _currentSessionStudents = students;
  _currentSessionRecords = existing;
  const searchInput = document.getElementById('sessionStudentSearch');
  if (searchInput) searchInput.value = '';
  renderStudentRows('');
  document.getElementById('sessionModal').classList.add('open');
}

let _currentSessionStudents = [];
let _currentSessionRecords = [];

function renderStudentRows(filter='') {
  const students = _currentSessionStudents;
  const existing = _currentSessionRecords;
  const filtered = filter
    ? students.filter(s => matchesStudentSearch(s, filter))
    : students;
  const tbody=document.getElementById('sessionRecordBody');
  tbody.innerHTML=filtered.map(s=>{
    const rec=existing.find(r=>r.student_id===s.id||r.student_name===s.name)||{};
    const defaultMode=rec.student_mode||s.default_mode||'offline';
    sessionEdits[s.id]={
      student_mode:defaultMode,
      attendance_status:rec.attendance_status||'',
      homework_submitted:rec.homework_submitted||!!rec.homework_file_url,
    };
    const att=rec.attendance_status||'';
    // 有上传文件的也算已交作业
    const hw=rec.homework_submitted||!!rec.homework_file_url;
    // 如果有文件但 homework_submitted 还是 false，自动更新
    if(!rec.homework_submitted && rec.homework_file_url && rec.id){
      sb(`/rest/v1/session_records?id=eq.${rec.id}`,'PATCH',{homework_submitted:true}).catch(()=>{});
      rec.homework_submitted=true;
    }
    return `<tr id="srow-${s.id}">
      <td style="font-size:12px;font-family:'Noto Serif SC',serif;font-weight:600">${s.name}</td>
      <td>
        <button onclick="toggleMode('${s.id}')" id="mode-${s.id}"
          style="font-size:10px;padding:3px 10px;border-radius:2px;border:1px solid;cursor:pointer;font-family:inherit;
          background:${defaultMode==='online'?'#e8eef8':'var(--bg)'};
          color:${defaultMode==='online'?'#1a3a6a':'var(--text-2)'};
          border-color:${defaultMode==='online'?'#2a6aad':'var(--border)'}">
          ${defaultMode==='online'?'线上':'线下'}
        </button>
      </td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${ATT_STATUS.map(a=>`<button onclick="setAtt('${s.id}','${a.value}')" id="att-${s.id}-${a.value}"
            style="font-size:10px;padding:3px 9px;border-radius:2px;border:1px solid;cursor:pointer;font-family:inherit;
            background:${att===a.value?a.color:'var(--bg)'};
            color:${att===a.value?'#fff':'var(--text-2)'};
            border-color:${att===a.value?a.color:'var(--border)'}">${a.label}
          </button>`).join('')}
        </div>
        ${att===''?'<div style="font-size:10px;color:var(--danger);margin-top:3px">缺席</div>':''}
      </td>
      <td>
        <button onclick="toggleHw('${s.id}')" id="hw-${s.id}"
          style="font-size:12px;width:28px;height:28px;border-radius:3px;border:1px solid;cursor:pointer;
          background:${hw?'var(--ok)':'var(--bg)'};
          color:${hw?'#fff':'var(--text-3)'};
          border-color:${hw?'var(--ok)':'var(--border)'}">
          ${hw?'✓':'—'}
        </button>
      </td>
    </tr>`;
    }).join('');
}

function getPinyinInitials(str) {
  // 常用姓氏拼音首字母映射
  const map = {
    '阿':'A','艾':'A','安':'A','昂':'A','敖':'A',
    '巴':'B','白':'B','柏':'B','班':'B','包':'B','鲍':'B','贝':'B','本':'B','毕':'B','卞':'B','别':'B','薄':'B','卜':'B',
    '蔡':'C','曹':'C','岑':'C','柴':'C','常':'C','车':'C','陈':'C','程':'C','池':'C','仇':'C','储':'C','楚':'C','褚':'C','崔':'C',
    '戴':'D','邓':'D','刁':'D','丁':'D','董':'D','窦':'D','杜':'D','段':'D','樊':'F','范':'F','方':'F','房':'F','费':'F','冯':'F','凤':'F','伏':'F','符':'F','傅':'F',
    '盖':'G','甘':'G','高':'G','葛':'G','耿':'G','弓':'G','宫':'G','巩':'G','贡':'G','苟':'G','古':'G','谷':'G','顾':'G','管':'G','郭':'G','过':'G',
    '郝':'H','何':'H','和':'H','赫':'H','贺':'H','洪':'H','侯':'H','胡':'H','花':'H','滑':'H','怀':'H','桓':'H','黄':'H','惠':'H','霍':'H',
    '纪':'J','计':'J','季':'J','贾':'J','简':'J','江':'J','姜':'J','蒋':'J','焦':'J','解':'J','金':'J','靳':'J','经':'J','景':'J','鞠':'J',
    '康':'K','柯':'K','孔':'K','寇':'K','匡':'K',
    '郎':'L','劳':'L','乐':'L','雷':'L','冷':'L','黎':'L','李':'L','厉':'L','连':'L','廉':'L','练':'L','梁':'L','林':'L','刘':'L','龙':'L','楼':'L','卢':'L','鲁':'L','陆':'L','路':'L','吕':'L','罗':'L','骆':'L',
    '马':'M','麦':'M','毛':'M','梅':'M','孟':'M','苗':'M','闵':'M','莫':'M','牟':'M','穆':'M',
    '倪':'N','聂':'N','宁':'N','牛':'N','钮':'N',
    '欧':'O',
    '潘':'P','庞':'P','裴':'P','彭':'P','皮':'P','平':'P','蒲':'P','濮':'P',
    '戚':'Q','祁':'Q','齐':'Q','钱':'Q','强':'Q','乔':'Q','秦':'Q','邱':'Q','丘':'Q','仇':'Q',
    '冉':'R','任':'R','荣':'R','阮':'R',
    '桑':'S','沙':'S','邵':'S','申':'S','沈':'S','盛':'S','施':'S','石':'S','史':'S','舒':'S','宋':'S','苏':'S','孙':'S',
    '谭':'T','汤':'T','唐':'T','陶':'T','田':'T','仝':'T','涂':'T','屠':'T',
    '万':'W','汪':'W','王':'W','韦':'W','魏':'W','文':'W','翁':'W','吴':'W','伍':'W',
    '奚':'X','夏':'X','项':'X','萧':'X','谢':'X','邢':'X','熊':'X','徐':'X','许':'X','宣':'X','薛':'X',
    '闫':'Y','严':'Y','颜':'Y','杨':'Y','姚':'Y','叶':'Y','尹':'Y','应':'Y','于':'Y','俞':'Y','虞':'Y','余':'Y','禹':'Y','袁':'Y','岳':'Y','云':'Y',
    '曾':'Z','占':'Z','章':'Z','赵':'Z','甄':'Z','郑':'Z','钟':'Z','周':'Z','朱':'Z','庄':'Z','卓':'Z','宗':'Z','邹':'Z'
  };
  return str.split('').map(c => map[c] || '').join('');
}

function toggleMode(studentId){
  const st=sessionEdits[studentId];
  st.student_mode=st.student_mode==='online'?'offline':'online';
  const btn=document.getElementById(`mode-${studentId}`);
  if(btn){
    const isOnline=st.student_mode==='online';
    btn.textContent=isOnline?'线上':'线下';
    btn.style.background=isOnline?'#e8eef8':'var(--bg)';
    btn.style.color=isOnline?'#1a3a6a':'var(--text-2)';
    btn.style.borderColor=isOnline?'#2a6aad':'var(--border)';
  }
  // save default_mode to students table
  sb(`/rest/v1/students?id=eq.${studentId}`,'PATCH',{default_mode:st.student_mode}).catch(()=>{});
  const stu=cachedStudents.find(s=>s.id===studentId);
  if(stu) stu.default_mode=st.student_mode;
}

function setAtt(studentId,value){
  const st=sessionEdits[studentId];
  st.attendance_status=st.attendance_status===value?'':value;
  ATT_STATUS.forEach(a=>{
    const btn=document.getElementById(`att-${studentId}-${a.value}`);
    const active=st.attendance_status===a.value;
    if(btn){
      btn.style.background=active?a.color:'var(--bg)';
      btn.style.color=active?'#fff':'var(--text-2)';
      btn.style.borderColor=active?a.color:'var(--border)';
    }
  });
  // update absent hint
  const row=document.getElementById(`srow-${studentId}`);
  if(row){
    const hint=row.querySelector('.absent-hint');
    if(hint) hint.style.display=st.attendance_status===''?'block':'none';
  }
}

function toggleHw(studentId){
  const st=sessionEdits[studentId];
  st.homework_submitted=!st.homework_submitted;
  const btn=document.getElementById(`hw-${studentId}`);
  if(btn){
    btn.textContent=st.homework_submitted?'✓':'—';
    btn.style.background=st.homework_submitted?'var(--ok)':'var(--bg)';
    btn.style.color=st.homework_submitted?'#fff':'var(--text-3)';
    btn.style.borderColor=st.homework_submitted?'var(--ok)':'var(--border)';
  }
}

async function adminBatchDownloadCourse(courseId) {
  const sessions = cachedSessions.filter(s => s.course_id === courseId && s.homework_enabled);
  if (!sessions.length) { alert('该课程暂无开通作业的课次'); return; }
  const sessionIds = sessions.map(s => `"${s.id}"`).join(',');
  try {
    const recs = await sb(`/rest/v1/session_records?session_id=in.(${sessionIds})&homework_file_url=not.is.null&select=*&order=session_date.asc,student_name.asc`);
    if (!recs.length) { alert('暂无提交的作业文件'); return; }
    // 生成对照表
    const listLines = ['文件ID → 课次 → 学生姓名'];
    recs.forEach(r => {
      const s = sessions.find(x => x.id === r.session_id);
      const ext = r.homework_file_url.split('.').pop().split('?')[0].slice(0,5);
      listLines.push(`${r.id}.${ext}  →  ${s ? s.session_date + ' ' + (s.session_title||'') : r.session_id}  →  ${r.student_name}`);
    });
    const blob = new Blob([listLines.join('\n')], {type:'text/plain;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `作业对照表.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    await new Promise(res => setTimeout(res, 300));
    // 下载作业文件
    for (const r of recs) {
      try {
        const res = await fetch(r.homework_file_url);
        const blob2 = await res.blob();
        const ext = r.homework_file_url.split('.').pop().split('?')[0].slice(0,5);
        const a2 = document.createElement('a');
        a2.href = URL.createObjectURL(blob2);
        a2.download = `${r.id}.${ext}`;
        a2.click();
        URL.revokeObjectURL(a2.href);
        await new Promise(res => setTimeout(res, 400));
      } catch(e) {
        window.open(r.homework_file_url, '_blank');
        await new Promise(res => setTimeout(res, 400));
      }
    }
  } catch(e) { alert('下载失败：' + e.message); }
}


async function deleteSession(sessionId) {
  if (!confirm('确定删除这个课次？')) return;
  try {
    await sb(`/rest/v1/course_sessions?id=eq.${sessionId}`, 'DELETE');
    cachedSessions = cachedSessions.filter(s => s.id !== sessionId);
    renderAttendancePage(document.getElementById('mainContent'));
  } catch(e) { alert('删除失败：' + e.message); }
}


async function toggleCourseHomework(courseId, enable) {
  try {
    // 해당 코스의 모든 세션 일괄 업데이트
    await sb(`/rest/v1/course_sessions?course_id=eq.${courseId}`, 'PATCH', { homework_enabled: enable });
    // 课程表也同步
    await sb(`/rest/v1/courses?id=eq.${courseId}`, 'PATCH', { homework_enabled: enable }).catch(() => {});
    // 로컬 캐시 업데이트
    cachedSessions.forEach(s => { if (s.course_id === courseId) s.homework_enabled = enable; });
    renderAttendancePage(document.getElementById('mainContent'));
  } catch(e) { alert('操作失败：' + e.message); }
}


async function toggleHomeworkEnabled(sessionId, current) {
  const newVal = !current;
  try {
    await sb(`/rest/v1/course_sessions?id=eq.${sessionId}`, 'PATCH', { homework_enabled: newVal });
    const s = cachedSessions.find(x => x.id === sessionId);
    if (s) s.homework_enabled = newVal;
    renderAttendancePage(document.getElementById('mainContent'));
  } catch(e) { alert('操作失败：' + e.message); }
}


async function saveSessionRecords(){
  const sessionId=document.getElementById('sessionModalId').value;
  const session=cachedSessions.find(s=>s.id===sessionId);
  if(!session) return;
  const majors=session.major||[];
  const students=cachedStudents.filter(s=>
    s.status==='active'&&(
      majors.includes(s.major)||
      (majors.includes('shakai_group')&&['shakai','shinpan','fukushi'].includes(s.major))
    )
  );
  const btn=document.querySelector('#sessionModal .btn-primary');
  btn.textContent='保存中…';btn.disabled=true;
  try{
    for(const s of students){
      const edit=sessionEdits[s.id];
      if(!edit) continue;
      const existing=cachedSessionRecords.find(r=>r.session_id===sessionId&&r.student_id===s.id);
      const data={
        session_id:sessionId,
        course_name:session.course_name,
        session_date:session.session_date,
        student_id:s.id,
        student_name:s.name,
        major:s.major,
        student_mode:edit.student_mode||'offline',
        attendance_status:edit.attendance_status||'', // empty = absent
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
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:8px 14px;font-size:12px">出席率 <strong style="color:${recs.length&&present/recs.length>=0.8?'var(--ok)':'var(--warn)'}">${recs.length?Math.round(present/recs.length*100)+'%':'—'}</strong></div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:8px 14px;font-size:12px">作业提交 <strong>${hwSubmit}/${recs.length}</strong></div>
    </div>
    ${recs.length?`<div class="table-scroll"><table class="student-table" style="min-width:600px">
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
    </table></div>`:'<div class="empty">暂无记录</div>'}`;
  document.getElementById('studentAttModal').classList.add('open');
}

// ══ 出席状况视图：学生 × 课次 矩阵，一眼看谁缺席、谁没交作业 ══
function renderAttStatusView(sessions, courses){
  const byCourse={};
  sessions.forEach(s=>{ (byCourse[s.course_id]=byCourse[s.course_id]||[]).push(s) });
  return Object.entries(byCourse).map(([cid,sess])=>{
    const course=courses.find(c=>c.id===cid)||{name:sess[0]?.course_name||''};
    const color=courseColor(course.name);
    const majors=sess[0]?.major||course.major||[];
    const students=cachedStudents.filter(s=>s.status==='active'&&(
      majors.includes(s.major)||(majors.includes('shakai_group')&&['shakai','shinpan','fukushi'].includes(s.major))
    )).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    if(!students.length) return '';
    const hwSess=sess.filter(s=>s.homework_enabled);
    return `<div style="margin-bottom:18px;background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden">
      <div style="background:${color.bg};color:${color.text};padding:8px 14px;font-size:12px;font-weight:600;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
        <span>${course.name}</span>
        <span style="font-size:10px;opacity:.75">${sess.length}回 · ${students.length}人　✓出席 ✗缺席 ─未记录 · 📝已交作业</span>
      </div>
      <div class="table-scroll"><table class="student-table" style="margin:0">
        <thead><tr>
          <th style="width:110px;position:sticky;left:0;background:var(--bg);z-index:1">学生</th>
          ${sess.map(s=>{const f=fmtSessionDate(s.session_date);return `<th style="width:56px;text-align:center;font-size:10px" title="第${s.session_number}回 ${s.session_title||''}">${f.short}${s.homework_enabled?'<div style="font-size:8px;color:var(--accent)">📝</div>':''}</th>`}).join('')}
          <th style="width:64px;text-align:center;font-size:10px">出席率</th>
          ${hwSess.length?'<th style="width:64px;text-align:center;font-size:10px">交作业</th>':''}
        </tr></thead>
        <tbody>
          ${students.map(stu=>{
            let att=0, rec=0, hw=0;
            const cells=sess.map(s=>{
              const r=cachedSessionRecords.find(x=>x.session_id===s.id&&x.student_name===stu.name);
              const submitted=!!(attHwSubs[s.id]&&attHwSubs[s.id].has(stu.name));
              if(r){rec++; if(attPresent(r.attendance_status)) att++;}
              if(submitted) hw++;
              const mark=!r?'<span style="color:var(--text-3)">─</span>'
                : attPresent(r.attendance_status)?'<span style="color:var(--ok)">✓</span>'
                : '<span style="color:var(--danger)">✗</span>';
              return `<td style="text-align:center;font-size:12px" title="${r?attStatusLabel(r.attendance_status):'未记录'}${submitted?' · 已交作业':''}">${mark}${submitted?'<span style="font-size:8px;color:var(--accent)">📝</span>':''}</td>`;
            }).join('');
            const rate=rec?Math.round(att/rec*100):0;
            return `<tr>
              <td style="font-size:11px;font-weight:600;position:sticky;left:0;background:var(--surface)">${stu.name}</td>
              ${cells}
              <td style="text-align:center;font-size:11px;color:${!rec?'var(--text-3)':rate>=80?'var(--ok)':rate>=60?'var(--warn)':'var(--danger)'}">${rec?rate+'%':'—'}</td>
              ${hwSess.length?`<td style="text-align:center;font-size:11px;color:${hw>=hwSess.length?'var(--ok)':hw?'var(--warn)':'var(--text-3)'}">${hw}/${hwSess.length}</td>`:''}
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>`;
  }).join('')||'<div class="empty" style="padding:36px">该范围内没有可显示的学生</div>';
}
