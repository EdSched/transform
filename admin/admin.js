// ── Auth ──
const ADMIN_PW='weixin$2026';

// 当前访问钥匙（从 URL ?k=xxx 解析并查库）。null=按老方式(admin密码→中枢台)
let ACCESS_KEY=null; // {k, password, domain, is_admin, label, active}

// 读取 URL 的 ?k= 并查钥匙表；页面加载时调用一次
async function loadAccessKey(){
  const k=new URLSearchParams(location.search).get('k');
  if(!k || k==='admin'){ ACCESS_KEY=null; return; } // 无k或admin → 走管理员流程
  try{
    const rows=await sb(`/rest/v1/access_keys?k=eq.${encodeURIComponent(k)}&select=*`);
    if(rows && rows[0] && rows[0].active){ ACCESS_KEY=rows[0]; }
    else { ACCESS_KEY={invalid:true}; } // 钥匙不存在或已停用
  }catch(e){ ACCESS_KEY=null; }
}

function checkLogin(){const r=localStorage.getItem('txe_login');if(r){const{ts}=JSON.parse(r);if(Date.now()-ts<30*24*60*60*1000)return true}return false}

function doLogin(){
  const pw=document.getElementById('loginPw').value;
  // 领域钥匙登录：验证该钥匙的密码
  if(ACCESS_KEY && !ACCESS_KEY.invalid){
    if(pw===ACCESS_KEY.password){
      localStorage.setItem('txe_login',JSON.stringify({ts:Date.now()}));
      document.getElementById('loginOverlay').style.display='none';
      if(ACCESS_KEY.is_admin){ showHub(); }           // admin钥匙 → 中枢台
      else { enterDomain(ACCESS_KEY.domain, ACCESS_KEY.major); } // 领域/专业钥匙 → 直达
    } else { loginErr('密码错误，请重试'); }
    return;
  }
  // 默认：管理员密码 → 中枢台
  if(pw===ADMIN_PW){localStorage.setItem('txe_login',JSON.stringify({ts:Date.now()}));document.getElementById('loginOverlay').style.display='none';showHub()}
  else{ loginErr('密码错误，请重试'); }
}
function loginErr(msg){document.getElementById('loginErr').textContent=msg;document.getElementById('loginPw').value='';document.getElementById('loginPw').focus();}
function doLogout(){localStorage.removeItem('txe_login');localStorage.removeItem('txe_domain');location.reload()}

// ── 中枢层：选择领域视角 ──
// 第一步骨架：admin 登录后到这里，选一个领域视角（或总览）再进入系统。
const HUB_DOMAINS=['大学院文科','大学院理科','学部文科','学部理科','语言-日语','语言-英语'];
function showHub(){
  const el=document.getElementById('hubOverlay');
  if(el){ renderHubCards(); el.style.display='flex'; }
  else { enterDomain('all'); } // 兜底：没有中枢层界面则直接进总览，保证系统始终可用
}
// 从 DOMAINS 动态生成中枢台领域卡片（含「总览」+ 管控台入口）
function renderHubCards(){
  const grid=document.getElementById('hubDomainGrid');
  if(!grid) return;
  const card=(onclick,title,sub)=>`<div onclick="${onclick}" style="cursor:pointer;border:1px solid var(--border);border-radius:6px;padding:16px 12px;background:var(--surface);transition:.15s" onmouseover="this.style.borderColor='var(--primary,#8b5cf6)'" onmouseout="this.style.borderColor='var(--border)'"><div style="font-weight:600;font-size:14px">${title}</div>${sub?`<div style="font-size:10px;color:var(--text-3);margin-top:3px">${sub}</div>`:''}</div>`;
  let html=card("enterDomain('all')",'总览','全部领域 · admin');
  DOMAINS.forEach(d=>{ html+=card(`enterDomain('${d.label}')`, d.label, ''); });
  // 管控台入口（仅 admin 可见——领域钥匙用户不会进到中枢台）
  html+=card("openConsole()",'⚙ 管控台','生成领域访问链接');
  grid.innerHTML=html;
}

// ══════════ 管控台：领域访问链接管理 ══════════
let _consoleKeys=[];
function openConsole(){
  const el=document.getElementById('consoleOverlay'); if(!el) return;
  document.getElementById('hubOverlay').style.display='none';
  el.style.display='block';
  switchConsoleTab('keys');
}
let consoleTab='keys';
async function switchConsoleTab(tab){
  consoleTab=tab;
  ['keys','teachers','payroll','majors'].forEach(t=>{
    const b=document.getElementById('ctab_'+t);
    if(b){ b.style.borderBottomColor = t===tab?'var(--primary,#8b5cf6)':'transparent'; b.style.color = t===tab?'var(--text)':'var(--text-3)'; b.style.fontWeight = t===tab?'600':'400'; }
  });
  const body=document.getElementById('consoleBody');
  if(!body) return;
  if(tab==='keys'){ loadConsole(); }
  else if(tab==='majors'){ renderMajorManager(body); }
  else if(tab==='teachers'){
    body.innerHTML='<div style="padding:20px;color:var(--text-3);font-size:12px">加载中…</div>';
    [cachedTeachers, cachedSessions]=await Promise.all([
      sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[]),
      sbAll('/rest/v1/course_sessions?homework_enabled=is.true&select=id,course_name&order=course_name.asc').catch(()=>[]),
    ]);
    renderTeachersPage(body);
    if(typeof renderTeacherList==='function') renderTeacherList();
  }
  else if(tab==='payroll'){
    body.innerHTML='<div style="padding:20px;color:var(--text-3);font-size:12px">加载中…</div>';
    cachedTeachers=await sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[]);
    renderPayrollPage(body);
  }
}
function closeConsole(){
  document.getElementById('consoleOverlay').style.display='none';
  showHub();
}

// ══════════ 专业管理中心（各领域专业的核心映射，学生/课程/老师/宣传都用它）══════════
async function renderMajorManager(body){
  body.innerHTML='<div style="padding:20px;color:var(--text-3);font-size:12px">加载中…</div>';
  // 直接从库拉全部专业（含domain）
  let rows=[];
  try{ rows=await sb('/rest/v1/majors?select=*&order=domain,label')||[]; }catch(e){ body.innerHTML='<div style="padding:20px;color:var(--danger)">加载失败：'+e.message+'</div>'; return; }
  window._majorRows=rows;
  // 按领域分组
  const byDom={};
  rows.forEach(r=>{ const d=r.domain||'（未设领域）'; (byDom[d]=byDom[d]||[]).push(r); });
  const domainOpts=DOMAINS.map(d=>`<option value="${d.label}">${d.label}</option>`).join('');
  let html=`
  <div style="max-width:900px">
    <div style="font-size:12px;color:var(--text-3);margin-bottom:14px">各领域的专业清单。这是学生档案、课程、老师、宣传等所有"专业"选择的统一数据源。新建/删除在此集中管理。</div>
    <div style="border:1px solid var(--border);border-radius:6px;padding:14px;margin-bottom:18px;background:var(--bg,#faf9f7)">
      <div style="font-size:12px;font-weight:600;margin-bottom:10px">＋ 新建专业</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">领域</div>
          <select id="mm_domain" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px">${domainOpts}</select></div>
        <div><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">专业中文名</div>
          <input id="mm_label" placeholder="如 机械工学" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;width:130px"></div>
        <div><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">日语罗马音代号（可留空，自动生成）</div>
          <input id="mm_key" placeholder="留空则自动生成" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;width:130px"></div>
        <button class="btn btn-primary btn-sm" onclick="mmCreate()">新建</button>
      </div>
      <div style="font-size:9px;color:var(--text-3);margin-top:6px">代号只能小写字母/数字/下划线，以字母开头。与全站专业代码风格统一。</div>
    </div>`;
  // 按 DOMAINS 顺序 + 未设领域，列出每个领域的专业
  const domOrder=[...DOMAINS.map(d=>d.label),'（未设领域）'];
  domOrder.forEach(dom=>{
    const list=byDom[dom]; if(!list||!list.length) return;
    html+=`<div style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:${dom==='（未设领域）'?'var(--danger)':'var(--text)'}">${dom} <span style="font-size:10px;color:var(--text-3)">(${list.length})</span></div>
      <div style="display:flex;flex-direction:column;gap:4px">`;
    list.forEach(m=>{
      html+=`<div style="display:flex;align-items:center;gap:8px;padding:5px 10px;border:1px solid var(--border-light);border-radius:4px">
        <span style="font-size:12px;font-weight:500">${majorEsc(m.label)}</span>
        <span style="font-size:10px;color:var(--text-3)">${m.key}</span>
        ${dom==='（未设领域）'?`<select onchange="mmSetDomain('${m.key}',this.value)" style="font-size:10px;padding:2px 4px;border:1px solid var(--border);border-radius:3px"><option value="">归到领域…</option>${domainOpts}</select>`:''}
        <button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="mmDelete('${m.key}','${majorEsc(m.label)}')">删除</button>
      </div>`;
    });
    html+='</div></div>';
  });
  html+='</div>';
  body.innerHTML=html;
}
function majorEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
async function mmCreate(){
  const domain=document.getElementById('mm_domain').value;
  const label=document.getElementById('mm_label').value.trim();
  const key=document.getElementById('mm_key').value.trim();
  if(!label){ alert('请填专业中文名'); return; }
  // 代号留空 → createMajor 会按中文自动生成罗马音并自动避重复
  const res=await createMajor(label,key,domain);
  if(res){
    if(!key) alert(`已新建专业「${label}」，自动生成代号：${res}`);
    await loadMajorsFromDB(); renderMajorManager(document.getElementById('consoleBody'));
  }
}
async function mmSetDomain(key,domain){
  if(!domain) return;
  try{
    await sb(`/rest/v1/majors?key=eq.${key}`,'PATCH',{domain});
    MAJOR_DOMAIN[key]=domain;
    await loadMajorsFromDB();
    renderMajorManager(document.getElementById('consoleBody'));
  }catch(e){ alert('设置失败：'+e.message); }
}
async function mmDelete(key,label){
  if(!confirm(`删除专业「${label}」(${key})？\n\n注意：已用此专业的学生/课程/老师不会自动清除，只是专业选项消失。确定删除？`)) return;
  try{
    await sb(`/rest/v1/majors?key=eq.${key}`,'DELETE');
    delete MAJORS[key]; delete MAJOR_DOMAIN[key];
    await loadMajorsFromDB();
    renderMajorManager(document.getElementById('consoleBody'));
  }catch(e){ alert('删除失败：'+e.message); }
}
async function loadConsole(){
  const body=document.getElementById('consoleBody');
  body.innerHTML='<div style="padding:20px;color:var(--text-3);font-size:12px">加载中…</div>';
  try{
    _consoleKeys=await sb('/rest/v1/access_keys?select=*&order=created_at.desc')||[];
    renderConsole();
  }catch(e){ body.innerHTML=`<div style="padding:20px;color:var(--danger)">加载失败：${e.message}</div>`; }
}
function renderConsole(){
  const body=document.getElementById('consoleBody');
  const base=location.origin+location.pathname.replace(/[^/]*$/,'')+'index.html';
  // 新建区（用 select 选领域，不用 radio）
  const domainOpts=DOMAINS.map(d=>`<option value="${d.label}">${d.label}</option>`).join('');
  let html=`
  <div style="border:1px solid var(--border);border-radius:6px;padding:14px;margin-bottom:18px;background:var(--bg,#faf9f7)">
    <div style="font-size:12px;font-weight:600;margin-bottom:10px">＋ 新建访问链接</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
      <div><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">领域</div>
        <select id="nk_domain" onchange="updateConsoleMajorOpts()" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px">${domainOpts}</select></div>
      <div><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">限定专业（选填）</div>
        <select id="nk_major" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px"><option value="">整个领域</option></select></div>
      <div><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">密码</div>
        <input id="nk_pw" placeholder="设置访问密码" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;width:130px"></div>
      <div style="flex:1;min-width:120px"><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">备注（如负责人名）</div>
        <input id="nk_label" placeholder="选填" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;width:100%"></div>
      <button class="btn btn-primary btn-sm" onclick="createAccessKey()">生成链接</button>
    </div>
  </div>`;
  // 钥匙列表
  if(!_consoleKeys.length){
    html+='<div style="padding:16px;color:var(--text-3);font-size:12px">暂无访问链接</div>';
  } else {
    html+='<div style="display:flex;flex-direction:column;gap:8px">';
    _consoleKeys.forEach(kk=>{
      if(kk.is_admin) return; // admin 那把不在此管理
      const url=`${base}?k=${kk.k}`;
      html+=`<div style="border:1px solid var(--border);border-radius:6px;padding:10px 12px;${kk.active?'':'opacity:.5'}">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-weight:600;font-size:13px">${kk.domain}${kk.major?' · '+(MAJORS[kk.major]||kk.major):''}</span>
          ${kk.label?`<span style="font-size:11px;color:var(--text-2)">${kk.label}</span>`:''}
          <span style="font-size:11px;color:var(--text-3)">密码：${kk.password}</span>
          ${kk.active?'':'<span style="font-size:10px;color:var(--danger)">已停用</span>'}
          <span style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn-outline btn-sm" onclick="copyKeyLink('${kk.k}')">复制链接</button>
            <button class="btn btn-outline btn-sm" onclick="toggleKey('${kk.k}',${kk.active})">${kk.active?'停用':'启用'}</button>
            <button class="btn btn-outline btn-sm" onclick="deleteKey('${kk.k}')">删除</button>
          </span>
        </div>
        <div style="font-size:10px;color:var(--text-3);margin-top:5px;word-break:break-all">${url}</div>
      </div>`;
    });
    html+='</div>';
  }
  body.innerHTML=html;
  updateConsoleMajorOpts(); // 初始化「限定专业」下拉为默认领域的专业
}
async function createAccessKey(){
  const domain=document.getElementById('nk_domain').value;
  const major=document.getElementById('nk_major').value;
  const pw=document.getElementById('nk_pw').value.trim();
  const label=document.getElementById('nk_label').value.trim();
  if(!pw){ alert('请设置访问密码'); return; }
  // 标识 = 领域代码(+专业代码) + 短随机后缀
  const code=domainCode(domain)||'dom';
  const k=code+(major?'_'+major:'')+'-'+Date.now().toString(36).slice(-4);
  try{
    await sb('/rest/v1/access_keys','POST',{k,password:pw,domain,major:major||null,is_admin:false,label:label||null,active:true});
    document.getElementById('nk_pw').value=''; document.getElementById('nk_label').value='';
    await loadConsole();
    alert(`已生成「${domain}${major?' · '+(MAJORS[major]||major):''}」访问链接，密码：${pw}`);
  }catch(e){ alert('生成失败：'+e.message); }
}
// 领域下拉变化时，联动更新「限定专业」选项（只出该领域的专业）
function updateConsoleMajorOpts(){
  const domain=document.getElementById('nk_domain').value;
  const sel=document.getElementById('nk_major');
  if(!sel) return;
  let opts='<option value="">整个领域</option>';
  allMajorKeys().forEach(k=>{
    if(MAJOR_DOMAIN[k]===domain) opts+=`<option value="${k}">${MAJORS[k]||k}</option>`;
  });
  sel.innerHTML=opts;
}
function copyKeyLink(k){
  const base=location.origin+location.pathname.replace(/[^/]*$/,'')+'index.html';
  const url=`${base}?k=${k}`;
  navigator.clipboard?.writeText(url).then(()=>alert('链接已复制：\n'+url)).catch(()=>prompt('复制此链接：',url));
}
async function toggleKey(k,cur){
  try{ await sb(`/rest/v1/access_keys?k=eq.${k}`,'PATCH',{active:!cur}); await loadConsole(); }
  catch(e){ alert('操作失败：'+e.message); }
}
async function deleteKey(k){
  if(!confirm('确定删除这个访问链接？删除后该链接立即失效。')) return;
  try{ await sb(`/rest/v1/access_keys?k=eq.${k}`,'DELETE'); await loadConsole(); }
  catch(e){ alert('删除失败：'+e.message); }
}
async function enterDomain(domain, major){
  CURRENT_DOMAIN = (domain==='all'||!domain) ? 'all' : domain;
  CURRENT_MAJOR = major || '';   // 专业锁（专业钥匙才有）
  try{ localStorage.setItem('txe_domain', CURRENT_DOMAIN); }catch(e){}
  const el=document.getElementById('hubOverlay'); if(el) el.style.display='none';
  // 在顶栏显示当前视角（专业锁时附带专业名）
  const tag=document.getElementById('domainTag');
  if(tag){
    let t = CURRENT_DOMAIN==='all' ? '总览·全部领域' : CURRENT_DOMAIN;
    if(CURRENT_MAJOR) t += ' · '+(MAJORS[CURRENT_MAJOR]||CURRENT_MAJOR);
    tag.textContent = t;
  }
  // 领域/专业钥匙用户：隐藏「切换视角」（锁定）
  const sw=document.getElementById('switchViewBtn');
  if(sw) sw.style.display=(ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin)?'none':'';
  await initApp();
}
function backToHub(){ // 从系统内返回中枢层重新选领域
  // 领域钥匙用户被锁定在自己领域，不能切换视角
  if(ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin) return;
  const el=document.getElementById('hubOverlay'); if(el) el.style.display='flex';
}
// 按当前领域视角过滤课程数组（总览时原样返回）
function filterByDomain(list){
  if(!CURRENT_DOMAIN || CURRENT_DOMAIN==='all') return list;
  return (list||[]).filter(c => c.domain === CURRENT_DOMAIN);
}
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
function checkCoursePw(){ return true; }  // 已取消课程管理二次密码

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
        sbAll('/rest/v1/slots?select=*&order=date.asc,time_range.asc'),
        sbAll('/rest/v1/bookings?select=*&order=slot_date.asc,slot_time_range.asc'),
        sbAll('/rest/v1/students?select=*&order=name.asc')
      ]);
      curPage==='booking'?renderBookingPage(mc):renderSlotsPage(mc);
    } else if(curPage==='students'){
      [cachedStudents,cachedTeachers]=await Promise.all([
        sbAll('/rest/v1/students?select=*&order=name.asc'),
        sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[])
      ]);
      renderStudentsPage(mc);
    } else if(curPage==='courses'){
      [cachedStudents,cachedCourses,cachedSessions]=await Promise.all([
        sbAll('/rest/v1/students?select=*&order=name.asc'),
        sbAll('/rest/v1/courses?select=*&order=created_at.desc'),
        sbAll('/rest/v1/course_sessions?select=*&order=session_date.asc')
      ]);
      cachedCourses=filterByDomain(cachedCourses);
      renderCoursesPage(mc);
    } else if(curPage==='promo'){
      [cachedCourses,cachedSessions]=await Promise.all([
        sbAll('/rest/v1/courses?select=*&order=created_at.desc').catch(()=>cachedCourses||[]),
        sbAll('/rest/v1/course_sessions?select=*&order=session_date.asc').catch(()=>cachedSessions||[])
      ]);
      renderPromoAdminPage(mc);
    } else if(curPage==='coursecleanup'){
      [cachedCourses,cachedSessions,cachedTeachers]=await Promise.all([
        sbAll('/rest/v1/courses?select=*&order=created_at.desc'),
        sbAll('/rest/v1/course_sessions?select=*&order=session_date.asc'),
        sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[])
      ]);
      renderCourseCleanupPage(mc);
    } else if(curPage==='schedule'){
      [cachedCourses,cachedSessions,cachedScheduleSlots,cachedTeacherAvail,cachedTeachers]=await Promise.all([
        sbAll('/rest/v1/courses?select=*&order=created_at.desc'),
        sbAll('/rest/v1/course_sessions?select=*&order=session_date.asc'),
        sb('/rest/v1/schedule_slots?select=*&order=session_date.asc').catch(()=>[]),
        sb('/rest/v1/teacher_availability?select=*').catch(()=>[]),
        sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[])
      ]);
      renderSchedulePage(mc);
    } else if(curPage==='teachers'){
      [cachedTeachers, cachedSessions]=await Promise.all([
        sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[]),
        sbAll('/rest/v1/course_sessions?homework_enabled=is.true&select=id,course_name&order=course_name.asc').catch(()=>[]),
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
        sbAll('/rest/v1/students?select=*&order=name.asc'),
        sbAll('/rest/v1/courses?select=*&order=created_at.desc'),
        sbAll('/rest/v1/course_sessions?select=*&order=session_date.asc,session_number.asc'),
        sbAll('/rest/v1/session_records?select=*')
      ]);
      renderAttendancePage(mc);
    } else if(curPage==='progress'){
      cachedStudents=await sbAll('/rest/v1/students?select=*&order=name.asc');
      renderProgressPage(mc);
    } else if(curPage==='vipframework'){
      cachedTeachers=await sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[]);
      await loadVipFrameworks();
      renderVipFrameworkPage(mc);
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
// 老师页宿主容器：管控台打开时渲染到 consoleBody，否则渲染到导航主区 mainContent
function teacherPageHost(){
  const ov=document.getElementById('consoleOverlay');
  if(ov && ov.style.display!=='none'){ const b=document.getElementById('consoleBody'); if(b) return b; }
  return document.getElementById('mainContent');
}
function renderTeachersPage(mc){
  const _isDom = (typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin && typeof CURRENT_DOMAIN!=='undefined' && CURRENT_DOMAIN && CURRENT_DOMAIN!=='all');
  const _lockDom = _isDom ? CURRENT_DOMAIN : '';
  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">老师管理 <span class="badge-count">${cachedTeachers.length}</span></div>
    <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:3px;overflow:hidden">
      <button style="font-size:11px;padding:5px 16px;border:none;cursor:pointer;font-family:inherit;background:var(--accent);color:#fff">👥 老师账号</button>
      <button onclick="renderTeacherProfilesPage(teacherPageHost())" style="font-size:11px;padding:5px 16px;border:none;cursor:pointer;font-family:inherit;background:var(--surface);color:var(--text-2)">📇 讲师档案</button>
    </div>
  </div>
  <div class="swipe-row" style="grid-template-columns:1fr 1.6fr">
    <!-- 添加/编辑老师 -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:14px;letter-spacing:.05em;text-transform:uppercase" id="teacherFormTitle">添加新老师</div>
      <div class="form-group"><label class="form-label">姓名 *</label><input id="new_teacher_name" placeholder="老师姓名"></div>
      <div class="form-group"><label class="form-label">备注 / 对外宣传姓名</label><input id="new_teacher_notes" placeholder="填写后，宣传页课程担当将显示此名（如：周老师）"></div>
      ${_isDom ? '' : `<div class="form-group">
        <label class="form-label">类型 *</label>
        <div style="display:flex;gap:6px" id="new_teacher_stafftype">
          <div class="filter-chip" data-value="正社员" onclick="selectStaffType(this)" style="padding:4px 14px">正社员</div>
          <div class="filter-chip" data-value="兼职" onclick="selectStaffType(this)" style="padding:4px 14px">兼职</div>
        </div>
      </div>
      <div class="form-group" id="new_teacher_dept_wrap" style="display:none">
        <label class="form-label">部门（正社员）</label>
        <select id="new_teacher_department" style="width:100%">
          <option value="">请选择部门</option>
          <option>教务本部</option>
          <option>营业本部</option>
          <option>管理本部</option>
          <option>美术部</option>
          <option>综合事业本部</option>
        </select>
      </div>`}
      <div class="form-group"><label class="form-label">分类标签（可叠加，用于搜索标记，不影响任何功能权限）</label><input id="new_teacher_tags" placeholder="用逗号或顿号分隔，如：计划书指导、模拟面试、兼职"></div>
      ${_isDom ? `<div class="form-group"><label class="form-label">领域</label><div style="font-size:12px;color:var(--text-2);border:1px solid var(--border);border-radius:3px;padding:7px 10px;background:var(--bg)">${_lockDom}<span style="font-size:10px;color:var(--text-3);margin-left:6px">本领域账号：新建老师自动归属本领域，负责专业在下方选择</span></div></div>` : `<div class="form-group" style="border:1px solid var(--accent);border-radius:3px;padding:8px;background:var(--bg)">
        <label class="form-label" style="color:var(--accent)">隶属领域（可多选，决定"哪个领域账号能在老师管理里看到/编辑这个老师"）</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="new_teacher_managed">
          ${DOMAINS.map(d=>`<div class="filter-chip" data-value="${d.label}" onclick="toggleChip(this)" style="padding:4px 10px">${d.label}</div>`).join('')}
        </div>
        <div style="font-size:9px;color:var(--text-3);margin-top:4px">留空则默认用下方"负责领域"。这是"归谁管"，和下方"能看到/教什么"分开。</div>
      </div>
      <div class="form-group">
        <label class="form-label">负责领域（可多选，老师自己页面能看到的领域；选后下方展开对应专业）</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="new_teacher_domains">
          ${DOMAINS.map(d=>`<div class="filter-chip" data-value="${d.label}" onclick="toggleDomainChip(this)" style="padding:4px 10px">${d.label}</div>`).join('')}
        </div>
      </div>`}
      <div class="form-group">
        <label class="form-label">负责专业（可多选，按已选领域展开）</label>
        <div id="new_teacher_majors" style="min-height:20px"></div>
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
              <div class="filter-chip" data-value="attendance" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px;border-left:2px solid var(--accent)">出勤</div>
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
            <label style="display:block;font-size:11px;font-weight:600;margin-bottom:6px">课程排班 / 我的课表</label>
            <select id="perm_schedule_mode" style="width:100%;font-size:11px;padding:5px 8px;border:1px solid var(--border);border-radius:3px;background:var(--surface)">
              <option value="">不开启</option>
              <option value="full">排班确认 + 我的课表（可接收排课、填写排班）</option>
              <option value="timetable">仅我的课表（本人任课 + VIP，跨领域集中显示）</option>
            </select>
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
            <label style="display:flex;align-items:center;gap:6px;font-size:10px;cursor:pointer;margin:0 0 8px 20px;color:#8a5010"><input type="checkbox" id="perm_guaranteed_only" style="accent-color:#8a5010;width:14px;height:14px">🎓 仅保录学生（勾选后此老师在学生管理里只能看到保录学生，看不到其他学生）</label>
            <div style="margin-left:20px;margin-bottom:8px">
              <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">可用的子项</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px" id="perm_student_mgmt_items">
                ${[
              ['progress','考学进度'],['meetings','面谈查询'],['records','出席・作业记录'],['profile','学生档案录入'],['profile_edit','档案修改（留痕，admin可恢复）'],
            ].map(([k,v])=>`<div class="filter-chip" data-value="${k}" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">${v}</div>`).join('')}
              </div>
            </div>
            <div style="margin-left:20px">
              <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">可见的专业（适用于全部三个子项；不选则默认按该老师自身的专业显示，老师档案无专业时全部可见）</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px" id="perm_student_majors">
                ${majorFilterKeys().map(m=>`<div class="filter-chip" data-value="${m}" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">${majorLabel(m)}</div>`).join('')}
              </div>
            </div>
          </div>
          <!-- 营业功能大类 row（仅 admin/中枢可见；营业管理归中枢，领域端不显示） -->
          ${(!ACCESS_KEY||ACCESS_KEY.is_admin)?`<div style="padding:10px" id="sales_perm_block">
            <div style="font-size:11px;font-weight:600;margin-bottom:6px">💼 营业功能（按需勾选子项 · 中枢管理）</div>
            <div style="margin-left:4px;display:flex;flex-direction:column;gap:6px">
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_promo" style="accent-color:var(--accent);width:15px;height:15px">宣传相关<span style="font-size:9px;color:var(--text-3)">专业/讲师/课程介绍与当期课程表，含对外分享链接</span></label>
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_progress_plan" style="accent-color:var(--accent);width:15px;height:15px">进度规划<span style="font-size:9px;color:var(--text-3)">咨询学生考学规划生成，可打印 PDF</span></label>
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_lect_info" style="accent-color:var(--accent);width:15px;height:15px">讲师信息查询<span style="font-size:9px;color:var(--text-3)">内部检索讲师档案，可切换展示卡片给客户看/截图</span></label>
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_vip_sales" style="accent-color:var(--accent);width:15px;height:15px">VIP营业规划<span style="font-size:9px;color:var(--text-3)">看到全部 VIP 框架模板，可转分享给上课老师（营业角色）</span></label>
            </div>
          </div>`:''}
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
  if(typeof renderTeacherMajorChips==='function') renderTeacherMajorChips();
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
  document.querySelectorAll('#new_teacher_stafftype .filter-chip').forEach(c=>c.classList.remove('active'));
  if(document.getElementById('new_teacher_dept_wrap')) document.getElementById('new_teacher_dept_wrap').style.display='none';
  if(document.getElementById('new_teacher_department')) document.getElementById('new_teacher_department').value='';
  document.getElementById('new_teacher_notes').value='';
  document.getElementById('new_teacher_tags').value='';
  document.querySelectorAll('#new_teacher_domains .filter-chip,#new_teacher_managed .filter-chip,#perm_booking_types .filter-chip,#perm_slot_types .filter-chip,#perm_vip_content .filter-chip,#perm_student_majors .filter-chip,#perm_student_mgmt_items .filter-chip').forEach(c=>c.classList.remove('active')); if(typeof renderTeacherMajorChips==='function') renderTeacherMajorChips();
  document.getElementById('perm_booking').checked=false;
  document.getElementById('perm_slots').checked=false;
  {const _e=document.getElementById('perm_schedule_mode'); if(_e)_e.value='';}
    document.getElementById('perm_student_mgmt').checked=false;
    {const _g=document.getElementById('perm_guaranteed_only'); if(_g) _g.checked=false;}
    {const _e=document.getElementById('perm_progress_plan'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_promo'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_lect_info'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_vip_sales'); if(_e)_e.checked=false;}
  document.getElementById('perm_homework').checked=false;
  document.getElementById('perm_admission_query').checked=false;
  document.querySelectorAll('#perm_admission_majors .filter-chip').forEach(c=>c.classList.remove('active'));
  renderHomeworkCoursesChips([]);
}
function openTeacherManager(){
  // reset add form
  document.getElementById('new_teacher_name').value='';
  document.querySelectorAll('#new_teacher_stafftype .filter-chip').forEach(c=>c.classList.remove('active'));
  if(document.getElementById('new_teacher_dept_wrap')) document.getElementById('new_teacher_dept_wrap').style.display='none';
  if(document.getElementById('new_teacher_department')) document.getElementById('new_teacher_department').value='';
  document.getElementById('new_teacher_notes').value='';
  document.getElementById('new_teacher_tags').value='';
  document.querySelectorAll('#new_teacher_domains .filter-chip,#new_teacher_managed .filter-chip,#perm_booking_types .filter-chip,#perm_slot_types .filter-chip,#perm_vip_content .filter-chip,#perm_student_majors .filter-chip,#perm_student_mgmt_items .filter-chip').forEach(c=>c.classList.remove('active')); if(typeof renderTeacherMajorChips==='function') renderTeacherMajorChips();
  document.getElementById('perm_booking').checked=false;
  document.getElementById('perm_slots').checked=false;
  {const _e=document.getElementById('perm_schedule_mode'); if(_e)_e.value='';}
    document.getElementById('perm_student_mgmt').checked=false;
    {const _g=document.getElementById('perm_guaranteed_only'); if(_g) _g.checked=false;}
    {const _e=document.getElementById('perm_progress_plan'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_promo'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_lect_info'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_vip_sales'); if(_e)_e.checked=false;}
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
let teacherDomainFilter='';
let teacherTypeFilter='';
let teacherDeptFilter='';
let teacherExpandedId=null;

function teacherFilteredList(){
  let list=cachedTeachers;
  const isDomainAccount = typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin;
  // 领域端（非admin）：排除带"营业老师""保录老师"标签的人
  if(isDomainAccount){
    list=list.filter(t=>{ const tags=t.tags||[]; return !tags.includes('营业老师') && !tags.includes('保录老师'); });
  }
  // 视角过滤
  if(isDomainAccount){
    // 领域端账号：严格按隶属/负责专业过滤
    if(typeof CURRENT_MAJOR!=='undefined' && CURRENT_MAJOR){
      list=list.filter(t=>(t.majors||[]).includes(CURRENT_MAJOR));
    } else if(typeof CURRENT_DOMAIN!=='undefined' && CURRENT_DOMAIN && CURRENT_DOMAIN!=='all'){
      list=list.filter(t=>(t.managed_by||[]).includes(CURRENT_DOMAIN));
    }
  } else {
    // admin/中枢切换到某领域视角：显示该领域老师 + 没设隶属的老师(归admin管，不漏)
    if(typeof CURRENT_MAJOR!=='undefined' && CURRENT_MAJOR){
      list=list.filter(t=>(t.majors||[]).includes(CURRENT_MAJOR) || !(t.managed_by||[]).length);
    } else if(typeof CURRENT_DOMAIN!=='undefined' && CURRENT_DOMAIN && CURRENT_DOMAIN!=='all'){
      list=list.filter(t=>(t.managed_by||[]).includes(CURRENT_DOMAIN) || !(t.managed_by||[]).length);
    }
  }
  if(teacherTagFilter) list=list.filter(t=>(t.tags||[]).includes(teacherTagFilter));
  if(teacherTypeFilter) list=list.filter(t=>(t.staff_type||'')===teacherTypeFilter);
  if(teacherDeptFilter) list=list.filter(t=>(t.department||'')===teacherDeptFilter);
  if(teacherDomainFilter) list=list.filter(t=>{
    // 老师直接标了该领域，或其负责专业里有属于该领域的（兼容只填了专业的旧数据）
    if((t.domains||[]).includes(teacherDomainFilter)) return true;
    return (t.majors||[]).some(m=>MAJOR_DOMAIN[m]===teacherDomainFilter);
  });
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
    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:8px">
      <span style="font-size:10px;color:var(--text-3)">类型：</span>
      <div class="filter-chip ${teacherTypeFilter===''?'active':''}" onclick="teacherTypeFilter='';teacherDeptFilter='';renderTeacherList()" style="padding:2px 9px;font-size:10px">全部</div>
      <div class="filter-chip ${teacherTypeFilter==='正社员'?'active':''}" onclick="teacherTypeFilter='正社员';renderTeacherList()" style="padding:2px 9px;font-size:10px">正社员</div>
      <div class="filter-chip ${teacherTypeFilter==='兼职'?'active':''}" onclick="teacherTypeFilter='兼职';teacherDeptFilter='';renderTeacherList()" style="padding:2px 9px;font-size:10px">兼职</div>
      ${teacherTypeFilter==='正社员'?['教务本部','营业本部','管理本部','美术部','综合事业本部'].map(d=>`<div class="filter-chip ${teacherDeptFilter===d?'active':''}" onclick="teacherDeptFilter='${d}';renderTeacherList()" style="padding:2px 9px;font-size:10px;margin-left:2px">${d}</div>`).join(''):''}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:8px">
      <span style="font-size:10px;color:var(--text-3)">领域：</span>
      <div class="filter-chip ${teacherDomainFilter===''?'active':''}" onclick="teacherDomainFilter='';renderTeacherList()" style="padding:2px 9px;font-size:10px">全部</div>
      ${DOMAINS.map(d=>`<div class="filter-chip ${teacherDomainFilter===d.label?'active':''}" onclick="teacherDomainFilter='${escTM(d.label)}';renderTeacherList()" style="padding:2px 9px;font-size:10px">${escTM(d.label)}</div>`).join('')}
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
          if(p.schedule) perms.push(p.schedule==='timetable'?'课表':'排班');
          if(p.homework) perms.push('作业');
          if(p.admission_query) perms.push('出願库');
          if(p.student_mgmt) perms.push('学生管理');
          if(p.progress_plan) perms.push('进度规划');
          if(p.promo) perms.push('宣传');
          if(p.lect_info) perms.push('讲师信息');
          const permsFull=[];
          if(p.booking) permsFull.push(`预约(${(p.booking_types||[]).join('/')||'—'})`);
          if(p.slots) permsFull.push(`时间槽(${(p.slot_types||[]).join('/')||'—'})`);
          if(p.schedule) permsFull.push(p.schedule==='timetable'?'我的课表':'排班+课表');
          if(p.homework) permsFull.push('作业反馈');
          if(p.admission_query) permsFull.push('出願数据库');
          if(p.student_mgmt){const _sm={progress:'考学进度',records:'出席作业',meetings:'面谈查询',profile:'档案录入',profile_edit:'档案修改'};permsFull.push('学生管理('+(((p.student_mgmt_items||[]).map(k=>_sm[k]||k).join('/'))||'—')+')');}
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

function getPermissionsFromForm(prev){
  prev=prev||{};
  // 营业功能 4 个勾选项仅在 admin/中枢渲染；领域端链接下这些元素不存在，
  // 读取 .checked 会抛错导致「添加/保存老师」点击无反应。缺失时回退到已有值（编辑时不清空）。
  const _chk=(id,fb)=>{ const el=document.getElementById(id); return el?el.checked:(fb||false); };
  return {
    booking:document.getElementById('perm_booking').checked,
    booking_types:[...document.querySelectorAll('#perm_booking_types .filter-chip.active')].map(c=>c.dataset.value),
    slots:document.getElementById('perm_slots').checked,
    slot_types:[...document.querySelectorAll('#perm_slot_types .filter-chip.active')].map(c=>c.dataset.value),
    vip_content:[...document.querySelectorAll('#perm_vip_content .filter-chip.active')].map(c=>c.dataset.value),
    schedule:(function(){const e=document.getElementById('perm_schedule_mode');return e&&e.value?e.value:false;})(),
    homework:document.getElementById('perm_homework').checked,
    homework_courses:[...document.querySelectorAll('#perm_homework_courses .filter-chip.active')].map(c=>c.dataset.value),
    admission_query:document.getElementById('perm_admission_query').checked,
    admission_majors:[...document.querySelectorAll('#perm_admission_majors .filter-chip.active')].map(c=>c.dataset.value),
    promo:_chk('perm_promo',prev.promo),
    lect_info:_chk('perm_lect_info',prev.lect_info),
    progress_plan:_chk('perm_progress_plan',prev.progress_plan),
    vip_sales:_chk('perm_vip_sales',prev.vip_sales),
    student_mgmt:document.getElementById('perm_student_mgmt').checked,
    guaranteed_only:document.getElementById('perm_guaranteed_only')?.checked||false,
    student_mgmt_items:[...document.querySelectorAll('#perm_student_mgmt_items .filter-chip.active')].map(c=>c.dataset.value),
    student_majors:[...document.querySelectorAll('#perm_student_majors .filter-chip.active')].map(c=>c.dataset.value),
  };
}

// 老师表单：点领域 chip → 切换选中 → 刷新专业区（只展开已选领域下的专业）
function toggleDomainChip(el){
  el.classList.toggle('active');
  renderTeacherMajorChips();
}
// 按已选领域展开专业 chip（按领域分组显示）；保留已勾选的专业状态
function renderTeacherMajorChips(){
  const box=document.getElementById('new_teacher_majors'); if(!box) return;
  const _isDom=(typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin && typeof CURRENT_DOMAIN!=='undefined' && CURRENT_DOMAIN && CURRENT_DOMAIN!=='all');
  const selDomains = _isDom ? [CURRENT_DOMAIN] : [...new Set([...document.querySelectorAll('#new_teacher_domains .filter-chip.active')].map(c=>c.dataset.value))];
  // 记住当前已选专业，重绘后恢复
  const prevSel=new Set([...box.querySelectorAll('.filter-chip.active')].map(c=>c.dataset.value));
  if(!selDomains.length){ box.innerHTML='<div style="font-size:11px;color:var(--text-3)">请先选择领域，上方选定后这里展开对应专业</div>'; return; }
  let html='';
  selDomains.forEach(dom=>{
    const majorsInDom=allMajorKeys().filter(m=>MAJOR_DOMAIN[m]===dom);
    if(!majorsInDom.length) return;
    html+=`<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--text-3);margin-bottom:4px">${dom}</div><div style="display:flex;flex-wrap:wrap;gap:6px">`;
    html+=majorsInDom.map(m=>`<div class="filter-chip${prevSel.has(m)?' active':''}" data-value="${m}" onclick="toggleChip(this)" style="padding:4px 10px">${majorLabel(m)}</div>`).join('');
    html+='</div></div>';
  });
  box.innerHTML=html||'<div style="font-size:11px;color:var(--text-3)">所选领域下暂无专业</div>';
}

// 老师类型单选（正社员/兼职）；选正社员才显示部门
function selectStaffType(el){
  document.querySelectorAll('#new_teacher_stafftype .filter-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  const isRegular = el.dataset.value==='正社员';
  const wrap=document.getElementById('new_teacher_dept_wrap');
  if(wrap) wrap.style.display = isRegular?'block':'none';
  if(!isRegular){ const d=document.getElementById('new_teacher_department'); if(d) d.value=''; }
}
async function addTeacher(){
  const _isDom = (typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin && typeof CURRENT_DOMAIN!=='undefined' && CURRENT_DOMAIN && CURRENT_DOMAIN!=='all');
  const _lockDom = _isDom ? CURRENT_DOMAIN : '';
  const name=document.getElementById('new_teacher_name').value.trim();
  const notes=document.getElementById('new_teacher_notes').value.trim();
  if(!name){alert('请填写姓名');return}
  const majors=[...document.querySelectorAll('#new_teacher_majors .filter-chip.active')].map(c=>c.dataset.value);
  // 负责/隶属领域：领域端自动锁定为本领域；中枢端按表单勾选
  let domains, managed_by;
  if(_isDom){ domains=[_lockDom]; managed_by=[_lockDom]; }
  else {
    domains=[...document.querySelectorAll('#new_teacher_domains .filter-chip.active')].map(c=>c.dataset.value);
    managed_by=[...document.querySelectorAll('#new_teacher_managed .filter-chip.active')].map(c=>c.dataset.value);
  }
  // 同名老师已存在：领域端提示「叠加本领域」（同一账号/ID）；中枢端沿用原「已存在」拦截
  const _existing=cachedTeachers.find(t=>t.name===name);
  if(_existing){
    if(_isDom){
      const curManaged=_existing.managed_by||[], curDomains=_existing.domains||[], curMajors=_existing.majors||[];
      if(curManaged.includes(_lockDom)){ alert(`老师「${name}」已在本领域，请直接在下方列表中编辑。`); return; }
      const others=curManaged.filter(d=>d!==_lockDom);
      if(!confirm(`老师「${name}」已有账号${others.length?`（隶属领域：${others.join('、')}）`:''}。
是否把本领域「${_lockDom}」叠加到其负责/管理领域？
（姓名与账号 ID 不变，仅追加本领域及所选专业；其它设置保持不变）`)) return;
      const willManaged=[...new Set([...curManaged,_lockDom])];
      const willDomains=[...new Set([...curDomains,_lockDom])];
      const willMajors=[...new Set([...curMajors,...majors])];
      try{
        await sb(`/rest/v1/teachers?id=eq.${_existing.id}`,'PATCH',{managed_by:willManaged,domains:willDomains,majors:willMajors});
        Object.assign(_existing,{managed_by:willManaged,domains:willDomains,majors:willMajors});
        document.getElementById('new_teacher_name').value='';
        document.querySelectorAll('#new_teacher_majors .filter-chip').forEach(c=>c.classList.remove('active'));
        if(typeof renderTeacherMajorChips==='function') renderTeacherMajorChips();
        renderTeacherList();
        alert(`已把「${_lockDom}」叠加到老师「${name}」，本领域现在可管理该老师。`);
      }catch(e){ alert('叠加失败：'+e.message); }
      return;
    }
    alert('该老师已存在'); return;
  }
  const permissions=getPermissionsFromForm();
  const tags=parseTeacherTags();
  try{
    let staff_type=document.querySelector('#new_teacher_stafftype .filter-chip.active')?.dataset.value||'';
    if(!staff_type && _isDom) staff_type='兼职';   // 领域端不区分正社员/兼职，默认兼职（仍记录，保证账号/出勤信息完整）
    const department=staff_type==='正社员'?(document.getElementById('new_teacher_department')?.value||''):'';
    const t={id:`t-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,name,notes,majors,domains,managed_by,staff_type,department,permissions,tags};
    const res=await sb('/rest/v1/teachers','POST',[t]);
    cachedTeachers.push(Array.isArray(res)?res[0]:t);
    document.getElementById('new_teacher_name').value='';
  document.querySelectorAll('#new_teacher_stafftype .filter-chip').forEach(c=>c.classList.remove('active'));
  if(document.getElementById('new_teacher_dept_wrap')) document.getElementById('new_teacher_dept_wrap').style.display='none';
  if(document.getElementById('new_teacher_department')) document.getElementById('new_teacher_department').value='';
    document.getElementById('new_teacher_notes').value='';
  document.getElementById('new_teacher_tags').value='';
    document.getElementById('new_teacher_tags').value='';
    document.querySelectorAll('#new_teacher_domains .filter-chip,#new_teacher_managed .filter-chip,#perm_booking_types .filter-chip,#perm_slot_types .filter-chip,#perm_vip_content .filter-chip,#perm_student_majors .filter-chip,#perm_student_mgmt_items .filter-chip').forEach(c=>c.classList.remove('active')); if(typeof renderTeacherMajorChips==='function') renderTeacherMajorChips();
    document.getElementById('perm_booking').checked=false;
    document.getElementById('perm_slots').checked=false;
    {const _e=document.getElementById('perm_schedule_mode'); if(_e)_e.value='';}
    document.getElementById('perm_student_mgmt').checked=false;
    {const _g=document.getElementById('perm_guaranteed_only'); if(_g) _g.checked=false;}
    {const _e=document.getElementById('perm_progress_plan'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_promo'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_lect_info'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_vip_sales'); if(_e)_e.checked=false;}
    renderTeacherList();
  }catch(e){alert('添加失败：'+e.message)}
}

function openEditTeacher(id){
  const t=cachedTeachers.find(x=>x.id===id);
  if(!t) return;
  document.getElementById('new_teacher_name').value=t.name;
  // 回填类型+部门
  document.querySelectorAll('#new_teacher_stafftype .filter-chip').forEach(c=>{
    c.classList.toggle('active', c.dataset.value===(t.staff_type||''));
  });
  const _deptWrap=document.getElementById('new_teacher_dept_wrap');
  if(_deptWrap) _deptWrap.style.display=(t.staff_type==='正社员')?'block':'none';
  const _dept=document.getElementById('new_teacher_department');
  if(_dept) _dept.value=t.department||'';
  document.getElementById('new_teacher_notes').value=t.notes||'';
  document.getElementById('new_teacher_tags').value=(t.tags||[]).join('、');
  document.querySelectorAll('#new_teacher_majors .filter-chip').forEach(c=>{c.classList.toggle('active',(t.majors||[]).includes(c.dataset.value))});
  // 回填隶属领域 chip
  const teacherManaged=t.managed_by||[];
  document.querySelectorAll('#new_teacher_managed .filter-chip').forEach(c=>c.classList.toggle('active', teacherManaged.includes(c.dataset.value)));
  // 回填负责领域 chip
  const teacherDomains=t.domains||[];
  document.querySelectorAll('#new_teacher_domains .filter-chip').forEach(c=>c.classList.toggle('active', teacherDomains.includes(c.dataset.value)));
  // 若老师只有专业没有领域（旧数据），从专业反推领域一起点亮
  if(!teacherDomains.length && (t.majors||[]).length){
    const derived=new Set((t.majors||[]).map(m=>MAJOR_DOMAIN[m]).filter(Boolean));
    document.querySelectorAll('#new_teacher_domains .filter-chip').forEach(c=>{ if(derived.has(c.dataset.value)) c.classList.add('active'); });
  }
  // 按已选领域展开专业区，再勾选老师已有专业
  renderTeacherMajorChips();
  const myMajors=new Set(t.majors||[]);
  document.querySelectorAll('#new_teacher_majors .filter-chip').forEach(c=>c.classList.toggle('active', myMajors.has(c.dataset.value)));
  const p=t.permissions||{};
  document.getElementById('perm_booking').checked=!!p.booking;
  document.getElementById('perm_slots').checked=!!p.slots;
  {const _e=document.getElementById('perm_schedule_mode'); if(_e)_e.value=(p.schedule===true?'full':(p.schedule||''));}
  document.getElementById('perm_homework').checked=!!p.homework;
  document.getElementById('perm_admission_query').checked=!!p.admission_query;
  document.querySelectorAll('#perm_admission_majors .filter-chip').forEach(c=>{c.classList.toggle('active',(p.admission_majors||[]).includes(c.dataset.value));});
  {const _e=document.getElementById('perm_promo'); if(_e)_e.checked=!!p.promo;}
  {const _e=document.getElementById('perm_lect_info'); if(_e)_e.checked=!!p.lect_info;}
  {const _e=document.getElementById('perm_progress_plan'); if(_e)_e.checked=!!p.progress_plan;}
  {const _e=document.getElementById('perm_vip_sales'); if(_e)_e.checked=!!p.vip_sales;}
  document.getElementById('perm_student_mgmt').checked=!!p.student_mgmt;
  {const _g=document.getElementById('perm_guaranteed_only'); if(_g) _g.checked=!!p.guaranteed_only;}
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
  const _isDom=(typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin && typeof CURRENT_DOMAIN!=='undefined' && CURRENT_DOMAIN && CURRENT_DOMAIN!=='all');
  const _lockDom=_isDom?CURRENT_DOMAIN:'';
  const cur=cachedTeachers.find(t=>t.id===id)||{};
  const name=document.getElementById('new_teacher_name').value.trim();
  if(!name){alert('请填写姓名');return}
  const selMajors=[...document.querySelectorAll('#new_teacher_majors .filter-chip.active')].map(c=>c.dataset.value);
  const permissions=getPermissionsFromForm(cur.permissions);
  const notes=document.getElementById('new_teacher_notes').value.trim();
  const tags=parseTeacherTags();
  // 领域端编辑：不清空领域归属/正社员属性/他领域专业（表单里这些控件不渲染），避免跨领域数据丢失
  let domains, managed_by, majors, staff_type, department;
  if(_isDom){
    domains=cur.domains||[];
    managed_by=cur.managed_by||[];
    const otherMajors=(cur.majors||[]).filter(m=>(typeof MAJOR_DOMAIN!=='undefined'?MAJOR_DOMAIN[m]:'')!==_lockDom);
    majors=[...new Set([...otherMajors,...selMajors])];
    staff_type=cur.staff_type||'兼职';
    department=cur.department||'';
  } else {
    domains=[...document.querySelectorAll('#new_teacher_domains .filter-chip.active')].map(c=>c.dataset.value);
    managed_by=[...document.querySelectorAll('#new_teacher_managed .filter-chip.active')].map(c=>c.dataset.value);
    majors=selMajors;
    staff_type=document.querySelector('#new_teacher_stafftype .filter-chip.active')?.dataset.value||'';
    department=staff_type==='正社员'?(document.getElementById('new_teacher_department')?.value||''):'';
  }
  try{
    await sb(`/rest/v1/teachers?id=eq.${id}`,'PATCH',{name,notes,majors,domains,managed_by,staff_type,department,permissions,tags});
    const idx=cachedTeachers.findIndex(t=>t.id===id);
    if(idx>=0) Object.assign(cachedTeachers[idx],{name,notes,majors,domains,managed_by,staff_type,department,permissions,tags});
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
  await loadPeriodsFromDB(); await loadHolidaysFromDB();
  await renderPage();
}
// 页面启动：先解析访问钥匙，再决定登录流程
(async function bootAuth(){
  await loadAccessKey();
  // 基础数据（专业、期数）在任何分支前先加载，保证中枢台/各页面都能用
  await loadMajorsFromDB();
  await loadPeriodsFromDB(); await loadHolidaysFromDB();
  // 钥匙无效：提示并停在登录框
  if(ACCESS_KEY && ACCESS_KEY.invalid){
    document.getElementById('loginOverlay').style.display='flex';
    loginErr('此访问链接无效或已停用');
    return;
  }
  // 已登录：admin钥匙/无k → 中枢台；领域钥匙 → 直达该领域
  if(checkLogin()){
    if(ACCESS_KEY && !ACCESS_KEY.is_admin){ enterDomain(ACCESS_KEY.domain, ACCESS_KEY.major); }
    else { showHub(); }
    return;
  }
  // 未登录：显示登录框（领域钥匙可提示其领域）
  document.getElementById('loginOverlay').style.display='flex';
  if(ACCESS_KEY && !ACCESS_KEY.is_admin){
    const hint=document.getElementById('loginHint');
    if(hint) hint.textContent=`${ACCESS_KEY.label||ACCESS_KEY.domain} · 请输入访问密码`;
  }
})();

// ══════════════════════════════════
// 讲师档案（teacher_profiles）：内部讲师信息库
// 与老师账号（teachers）独立：没有账号的讲师也可以建档；real_name 填了则与账号绑定，
// 老师本人可在老师页补全信息，营业老师端「讲师信息查询」读取本表
// ══════════════════════════════════
let profList=null;
let profOpenSubjects=new Set();
let profEditingId=null;
let profNewPreset=null; // "为某老师添加介绍"时预填的固定信息
// 基于已有档案，为该老师添加另一份介绍：带出固定信息（姓名/学校/学位/年份），清空专业+介绍内容
function profAddFor(id){
  const src=profList.find(p=>p.id===id); if(!src) return;
  profNewPreset={ _addFor:true, name:src.name, school:src.school, degree:src.degree, years:src.years, vip:src.vip,
    domain:'', subject:'', courses:'', keywords:'', feature:'', notes:'' };
  profEditingId='new';
  profRender();
}

const PROF_FIELDS=[
  ['name','讲师姓名（本名；与老师管理同名即自动关联账号）*'],
  ['school','毕业或所属大学院研究科'],['degree','学位（含在读）'],
  ['years','执教年份'],['vip','VIP指导（可/否）'],
];

async function renderTeacherProfilesPage(mc){
  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">讲师档案 <span class="badge-count" id="prof_count">…</span></div>
    <div style="display:flex;gap:8px;align-items:center">
      <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:3px;overflow:hidden">
        <button onclick="renderTeachersPage(teacherPageHost());renderTeacherList()" style="font-size:11px;padding:5px 16px;border:none;cursor:pointer;font-family:inherit;background:var(--surface);color:var(--text-2)">👥 老师账号</button>
        <button style="font-size:11px;padding:5px 16px;border:none;cursor:pointer;font-family:inherit;background:var(--accent);color:#fff">📇 讲师档案</button>
      </div>
      <label class="btn btn-outline btn-sm" style="cursor:pointer">⬆ 导入 Excel<input type="file" accept=".xlsx,.xls" style="display:none" onchange="profImportExcel(this)"></label>
      <button class="btn btn-primary btn-sm" onclick="profEditingId='new';profRender()">＋ 新增讲师</button>
    </div>
  </div>
  <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">Excel 列名须与讲师信息表一致（讲师姓名 / 所属学系 / 所属学科 / 毕业或所属大学院研究科 / 学位（含在读） / 执教年份 / 担当课程 / 可指导方向（关键词） / VIP指导 / 授课特色 / 备注）。<b>讲师姓名请填本名</b>：与老师管理中的姓名一致即自动关联账号（老师可自行补全档案，对外展示名由老师管理的「备注 / 对外宣传姓名」控制）。</div>
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
    <div style="font-size:11px;font-weight:600;margin-bottom:8px">${profEditingId==='new'?'＋ 新增讲师档案':(p._addFor?`＋ 为「${profEsc(p.name)}」添加介绍`:'✏ 编辑讲师档案')}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin-bottom:8px">
      ${PROF_FIELDS.map(([k,l])=>`<div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">${l}</label><input id="pf_${k}" value="${profEsc(p[k])}" style="${inp}"></div>`).join('')}
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">领域 *</label>
        <select id="pf_domain" onchange="profDomainChange()" style="${inp}">
          <option value="">选择领域</option>
          ${(typeof DOMAINS!=='undefined'?DOMAINS:[]).map(d=>`<option value="${d.label}"${p.domain===d.label?' selected':''}>${d.label}</option>`).join('')}
        </select></div>
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">专业 *</label>
        <select id="pf_subject" style="${inp}"><option value="">请先选领域</option></select></div>
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">排序</label><input id="pf_sort" type="number" value="${p.sort_order||0}" style="${inp}"></div>
    </div>
    ${[['courses','担当课程'],['keywords','可指导方向（关键词）'],['feature','授课特色'],['notes','备注']].map(([k,l])=>`
    <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">${l}</label>
    <textarea id="pf_${k}" rows="${k==='feature'?4:2}" style="width:100%;font-size:11px;line-height:1.7;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit;resize:vertical;margin-bottom:6px">${profEsc(p[k])}</textarea>`).join('')}
    <div style="display:flex;gap:6px;margin-top:4px">
      <button class="btn btn-primary btn-sm" onclick="profSave()">保存</button>
      <button class="btn btn-outline btn-sm" onclick="profEditingId=null;profNewPreset=null;profRender()">取消</button>
    </div>
    <input type="hidden" id="pf_subject_preset" value="${profEsc(p.subject||'')}">
  </div>`;

  if(profEditingId==='new'){box.innerHTML=formHtml(profNewPreset||{});setTimeout(profDomainChange,0);return}

  // 视角过滤：专业链接→只看该专业档案；领域链接→只看该领域档案；admin→全部
  let viewProfs=profList;
  if(typeof CURRENT_MAJOR!=='undefined' && CURRENT_MAJOR){
    const cn=MAJORS[CURRENT_MAJOR]||CURRENT_MAJOR;
    viewProfs=profList.filter(p=>(p.subject||'').trim()===cn);
  } else if(typeof CURRENT_DOMAIN!=='undefined' && CURRENT_DOMAIN && CURRENT_DOMAIN!=='all'){
    viewProfs=profList.filter(p=>(p.domain||'')===CURRENT_DOMAIN);
  }
  if(cnt) cnt.textContent=viewProfs.length;

  // 按所属学科分组折叠
  const groups={};
  viewProfs.forEach(p=>{const k=(p.subject||'未分类').trim()||'未分类';if(!groups[k])groups[k]=[];groups[k].push(p);});
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
              <span style="font-size:9px;color:var(--accent,#8b5cf6);margin-left:4px">${profEsc(p.domain||'')}${p.subject?' · '+profEsc(p.subject):''}</span>
              ${cachedTeachers.some(t=>t.name===p.name)?`<span style="font-size:9px;color:var(--ok);margin-left:6px">🔗 已关联账号${(cachedTeachers.find(t=>t.name===p.name)?.notes||'').trim()?`（对外：${profEsc(cachedTeachers.find(t=>t.name===p.name).notes)}）`:''}</span>`:`<span style="font-size:9px;color:var(--text-3);margin-left:6px">无账号（不影响）</span>`}
              ${profIncomplete(p)?`<span style="font-size:9px;background:var(--warn-bg,#f8f0d8);color:var(--warn,#b8860b);border-radius:2px;padding:0 5px;margin-left:4px">信息不全</span>`:''}
            </div>
            <div style="font-size:10px;color:var(--text-3);margin-top:2px">${profEsc(p.school||'')} ${profEsc(p.degree||'')} · ${profEsc((p.courses||'').slice(0,40))}${(p.courses||'').length>40?'…':''}</div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="profAddFor('${p.id}')" title="用该老师的固定信息，新增另一个领域/专业的介绍">＋ 添加介绍</button>
          <button class="btn btn-outline btn-sm" onclick="profEditingId='${p.id}';profRender()">✏ 编辑</button>
          <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="profDelete('${p.id}')">删除</button>
        </div>`).join('')}
      </div>`:''}
    </div>`;
  }).join('')||'<div class="empty" style="padding:30px">暂无讲师档案，可导入 Excel 或手动新增</div>';
  if(profEditingId&&profEditingId!=='new') setTimeout(profDomainChange,0);
}

function profToggleSubj(s){
  if(profOpenSubjects.has(s)) profOpenSubjects.delete(s); else profOpenSubjects.add(s);
  profRender();
}

// 讲师档案：领域变→专业下拉联动（只列该领域的专业）；保留已选专业
function profDomainChange(){
  const dom=(document.getElementById('pf_domain')||{}).value||'';
  const sel=document.getElementById('pf_subject'); if(!sel) return;
  const preset=(document.getElementById('pf_subject_preset')||{}).value||'';
  const cur=sel.value||preset;
  if(!dom){ sel.innerHTML='<option value="">请先选领域</option>'; return; }
  // 该领域下的专业（用 MAJOR_DOMAIN 反查，标签用中文名）
  let opts='<option value="">选择专业</option>';
  (typeof allMajorKeys==='function'?allMajorKeys():[]).forEach(k=>{
    if(MAJOR_DOMAIN[k]===dom){ const cn=majorLabel(k); opts+=`<option value="${cn}"${cur===cn?' selected':''}>${cn}</option>`; }
  });
  sel.innerHTML=opts;
}
async function profSave(){
  const g=id=>(document.getElementById('pf_'+id)||{}).value||'';
  const row={
    name:g('name').trim(),
    domain:g('domain').trim(), subject:g('subject').trim(),
    school:g('school').trim(), degree:g('degree').trim(), years:g('years').trim(),
    vip:g('vip').trim(), courses:g('courses').trim(), keywords:g('keywords').trim(),
    feature:g('feature').trim(), notes:g('notes').trim(),
    sort_order:parseInt((document.getElementById('pf_sort')||{}).value)||0,
  };
  if(!row.name){alert('请填写讲师姓名');return}
  if(!row.domain){alert('请选择领域');return}
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
    profNewPreset=null;
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
