// ── Auth ──
// admin 已改为 Supabase 邮箱免密登录，原明文密码已移除

// 当前访问钥匙（从 URL ?k=xxx 解析并查库）。null=按老方式(admin密码→中枢台)
let ACCESS_KEY=null; // {k, password, domain, major(旧), domains[], majors[], class_ids[], is_admin, label, active}

// 读取 URL 的 ?k= 并查钥匙表；页面加载时调用一次
async function loadAccessKey(){
  const k=new URLSearchParams(location.search).get('k');
  if(!k || k==='admin'){ ACCESS_KEY=null; return; } // 无k或admin → 走管理员流程
  try{
    // 登录前读取：走 rpc（只返回这一把钥匙、不含 password），access_keys 表本身只有管理员能读
    const rows=await sb('/rest/v1/rpc/resolve_access_key','POST',{p_k:k});
    const row=Array.isArray(rows)?rows[0]:rows;
    if(row && row.k && row.active){ ACCESS_KEY=row; }
    else { ACCESS_KEY={invalid:true}; } // 钥匙不存在或已停用
  }catch(e){ ACCESS_KEY=null; }
}

// ═══════════════════════════════════════════════
// 领域账号静默 Auth 登录：用 k@access.local + k 登录，拿 token（跟老师链接一样，纯链接进）
// access_keys 触发器已自动为每个 k 建好 Auth 账号；登录靠链接的 k，不用密码
// ═══════════════════════════════════════════════
async function silentAccessKeyLogin(){
  try{
    if(!ACCESS_KEY || ACCESS_KEY.invalid || ACCESS_KEY.is_admin || !ACCESS_KEY.k) return false;
    if(typeof supabase==='undefined' || !supabase.createClient) return false;
    const _c = supabase.createClient(SB_URL, SB_KEY, { auth:{ storageKey:'sb-admin', persistSession:true, autoRefreshToken:true } });
    let { data:_sess } = await _c.auth.getSession();
    const wantEmail = ACCESS_KEY.k + '@access.local';
    if(!_sess || !_sess.session || (_sess.session.user && _sess.session.user.email !== wantEmail)){
      await _c.auth.signInWithPassword({ email: wantEmail, password: ACCESS_KEY.k });
      _sess = (await _c.auth.getSession()).data;
    }
    if(typeof __setSbStorageKey==='function') __setSbStorageKey('sb-admin');
    if(_sess && _sess.session && typeof __setSbToken==='function') __setSbToken(_sess.session.access_token, _c);
    return !!(_sess && _sess.session);
  }catch(e){ console.warn('领域账号登录失败:', e.message); return false; }
}

// ═══════════════════════════════════════════════
// 邮箱免密登录（Supabase Auth Magic Link）—— 与密码登录并存
// 只有 Supabase Auth 里存在的 admin 邮箱能通过（目前：pinnyxu@gmail.com、douhongyun@transform-edu.com）；其他人发了也进不来
// ═══════════════════════════════════════════════
let _sbAuth = null;
function sbAuthClient(){
  if(_sbAuth) return _sbAuth;
  if(typeof supabase==='undefined' || !supabase.createClient){ return null; }
  _sbAuth = supabase.createClient(SB_URL, SB_KEY, { auth: { storageKey: 'sb-admin', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  // 把客户端交给 sb()：token 自动续期后会实时更新，sb() 永远拿到新鲜 token（修"1小时断掉/切视角卡死"）
  try { if (typeof __setSbStorageKey === 'function') __setSbStorageKey('sb-admin'); if (typeof __setSbToken === 'function') __setSbToken(null, _sbAuth); } catch(e){}
  return _sbAuth;
}
async function sendMagicLink(){
  const email=(document.getElementById('magicEmail').value||'').trim();
  const msg=document.getElementById('magicMsg');
  if(!email){ msg.style.color='var(--danger)'; msg.textContent='请填写邮箱'; return; }
  const c=sbAuthClient();
  if(!c){ msg.style.color='var(--danger)'; msg.textContent='登录组件未加载，请刷新页面重试'; return; }
  msg.style.color='var(--text-3)'; msg.textContent='正在发送…';
  try{
    const { error } = await c.auth.signInWithOtp({
      email,
      options:{ emailRedirectTo:'https://edsched.github.io/transform/admin/index.html', shouldCreateUser:false }
    });
    if(error) throw error;
    msg.style.color='var(--ok,#2a7a3a)';
    msg.innerHTML='✅ 登录链接已发到你的邮箱，请去邮箱点击链接（约 1 小时内有效）。<br>点开后会自动跳回本页并登录。';
  }catch(e){
    msg.style.color='var(--danger)';
    msg.textContent='发送失败：'+(e.message||e);
  }
}
// 页面加载时：若是从邮件链接回来的，完成登录
async function handleMagicCallback(){
  const c=sbAuthClient();
  if(!c) return false;
  // 链接回跳后，token 在 URL 的 #hash 里；supabase-js 会自动解析并建立 session
  try{
    const { data } = await c.auth.getSession();
    if(data && data.session && data.session.user){
      if(typeof __setSbToken==='function') __setSbToken(data.session.access_token);  // 让 sb() 立刻带上 admin token
      // 已通过 Auth 登录 → 和原来一样写本地登录态，进中枢台
      localStorage.setItem('txe_login',JSON.stringify({ts:Date.now(),auth:data.session.user.email}));
      // 清掉 URL 里的 token hash，避免刷新残留
      if(location.hash.includes('access_token')){ history.replaceState(null,'',location.pathname+location.search); }
      return true;
    }
  }catch(e){}
  return false;
}

function checkLogin(){const r=localStorage.getItem('txe_login');if(r){const{ts}=JSON.parse(r);if(Date.now()-ts<30*24*60*60*1000)return true}return false}

// ── 中枢只认「数据库那边认得的管理员身份」：Supabase 会话 + 邮箱在管理员名单里 ──
// 名单和数据库 is_admin() 是同一份。页面自己的 txe_login 只是 30 天的"看过登录框"标记，不等于数据库认你；
// 会话失效时页面照样显示中枢，所有「只有管理员能写」的表就会报 42501（new row violates row-level security policy）
const ADMIN_EMAILS=['pinnyxu@gmail.com','douhongyun@transform-edu.com'];
let ADMIN_EMAIL='';
async function adminSessionCheck(){
  try{
    const c=sbAuthClient(); if(!c) return {ok:false};
    const { data }=await c.auth.getSession();
    const u=data && data.session && data.session.user;
    if(u && ADMIN_EMAILS.includes(String(u.email||'').toLowerCase())){
      if(typeof __setSbToken==='function') __setSbToken(data.session.access_token, c);
      return {ok:true,email:u.email};
    }
  }catch(e){}
  return {ok:false};
}
// 进中枢：数据库身份没问题才进；否则清掉 txe_login，停在邮箱登录框并提示
async function enterHubChecked(msg){
  const r=await adminSessionCheck();
  if(r.ok){ ADMIN_EMAIL=r.email; document.getElementById('loginOverlay').style.display='none'; showHub(); return true; }
  localStorage.removeItem('txe_login');
  document.getElementById('loginOverlay').style.display='flex';
  const pw=document.getElementById('pwBox'); if(pw) pw.style.display='none';
  const mg=document.getElementById('magicBox'); if(mg) mg.style.display='block';
  const hint=document.getElementById('loginHint'); if(hint) hint.textContent='管理员登录';
  const m=document.getElementById('magicMsg'); if(m){ m.style.color='var(--danger)'; m.textContent=msg||'登录已过期，请用邮箱重新登录'; }
  return false;
}

async function doLogin(){
  const pw=document.getElementById('loginPw').value;
  // 领域钥匙登录：验证该钥匙的密码（密码不再下发到浏览器，交给数据库 rpc 比对）
  if(ACCESS_KEY && !ACCESS_KEY.invalid){
    let pwOk=false;
    try{ pwOk=(await sb('/rest/v1/rpc/check_access_key_password','POST',{p_k:ACCESS_KEY.k,p_pw:pw}))===true; }catch(e){ pwOk=false; }
    if(pwOk){
      localStorage.setItem('txe_login',JSON.stringify({ts:Date.now()}));
      document.getElementById('loginOverlay').style.display='none';
      if(ACCESS_KEY.is_admin){ await enterHubChecked('管理员请用邮箱登录'); }           // admin钥匙 → 还要有邮箱登录的数据库身份才进中枢台
      else { enterFromKey(); } // 领域/专业/组合钥匙 → 直达
    } else { loginErr('密码错误，请重试'); }
    return;
  }
  // admin：不再用密码，请用下方「邮箱免密登录」
  loginErr('管理员请使用下方邮箱登录');
}
function loginErr(msg){document.getElementById('loginErr').textContent=msg;document.getElementById('loginPw').value='';document.getElementById('loginPw').focus();}
async function doLogout(){
  localStorage.removeItem('txe_login');localStorage.removeItem('txe_domain');
  // 真正登出 Supabase Auth（清 token），否则重开会被自动登回、无法换账号/重登
  try{ const c=sbAuthClient(); if(c) await c.auth.signOut(); }catch(e){}
  location.reload();
}
// 强制重新邮箱登录：随时可用的"逃生门"（排查 RLS / token 过期时用）
async function forceRelogin(){
  try{ const c=sbAuthClient(); if(c) await c.auth.signOut(); }catch(e){}
  localStorage.removeItem('txe_login');
  document.getElementById('loginOverlay').style.display='flex';
  const box=document.getElementById('magicBox'); if(box){ box.style.display='block'; box.scrollIntoView({behavior:'smooth'}); }
  const pw=document.getElementById('pwBox'); if(pw) pw.style.display='none';
  const em=document.getElementById('magicEmail'); if(em){ em.value=''; em.focus(); }  // 不预填：多个 admin 邮箱，自己输
  const msg=document.getElementById('magicMsg'); if(msg){ msg.style.color='var(--text-3)'; msg.textContent='点「发送登录链接」重新登录以刷新身份。'; }
}

// ── 中枢层：选择领域视角 ──
// 第一步骨架：admin 登录后到这里，选一个领域视角（或总览）再进入系统。
const HUB_DOMAINS=['大学院文科','大学院理科','学部文科','学部理科','语言-日语','语言-英语'];
function showHub(){
  const el=document.getElementById('hubOverlay');
  const he=document.getElementById('hubEmail'); if(he) he.textContent=ADMIN_EMAIL?('当前登录：'+ADMIN_EMAIL):'';
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
  ['keys','teachers','roletpl','payroll','majors','pricing','tasks','sched'].forEach(t=>{
    const b=document.getElementById('ctab_'+t);
    if(b){ b.style.borderBottomColor = t===tab?'var(--primary,#8b5cf6)':'transparent'; b.style.color = t===tab?'var(--text)':'var(--text-3)'; b.style.fontWeight = t===tab?'600':'400'; }
  });
  const body=document.getElementById('consoleBody');
  if(!body) return;
  if(tab==='keys'){ loadConsole(); }
  else if(tab==='majors'){ renderMajorManager(body); }
  else if(tab==='pricing'){ prcMount(body); }
  else if(tab==='tasks'){ tkMount(body); }
  else if(tab==='roletpl'){ rtpMount(body); }
  else if(tab==='sched'){ sccMount(body); }
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
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div style="font-size:12px;color:var(--text-3);flex:1;min-width:240px">各领域的专业清单。这是学生档案、课程、老师、宣传等所有"专业"选择的统一数据源。新建/删除在此集中管理。</div>
      <button class="btn btn-outline btn-sm" onclick="mmCleanup()" title="找出没有任何学生、课程、老师、预约、宣传等在使用的专业，一次清掉">清理无用专业</button>
    </div>
    <div style="border:1px solid var(--border);border-radius:6px;padding:14px;margin-bottom:18px;background:var(--bg,#faf9f7)">
      <div style="font-size:12px;font-weight:600;margin-bottom:10px">＋ 新建专业</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">领域</div>
          <select id="mm_domain" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px">${domainOpts}</select></div>
        <div><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">专业中文名</div>
          <input id="mm_label" placeholder="如 机械工学" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;width:130px"></div>
        <div><div style="font-size:10px;color:var(--accent);margin-bottom:3px">日文专业名（强烈建议填写）</div>
          <input id="mm_label_ja" placeholder="如 機械工学" style="padding:6px 8px;border:1px solid var(--accent);border-radius:4px;font-size:12px;width:130px"></div>
        <div><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">代号（可留空，自动生成）</div>
          <input id="mm_key" placeholder="留空则自动生成" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;width:130px"></div>
        <button class="btn btn-primary btn-sm" onclick="mmCreate()">新建</button>
      </div>
      <div style="font-size:9px;color:var(--text-3);margin-top:6px">代号只能小写字母/数字/下划线，以字母开头，按「日文专业名」的罗马音自动生成（更准确）；不填日文名则退回按中文名生成，可能不准，建议之后手动补上日文名。</div>
    </div>`;
  // 按 DOMAINS 顺序 + 未设领域，列出每个领域的专业
  const domOrder=[...DOMAINS.map(d=>d.label),'（未设领域）'];
  domOrder.forEach(dom=>{
    const list=byDom[dom]; if(!list||!list.length) return;
    html+=`<div style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:${dom==='（未设领域）'?'var(--danger)':'var(--text)'}">${dom} <span style="font-size:10px;color:var(--text-3)">(${list.length})</span></div>
      <div style="display:flex;flex-direction:column;gap:4px">`;
    list.forEach(m=>{
      const jaCell = m.label_ja
        ? `<span style="font-size:11px;color:var(--text-2)">JP：${majorEsc(m.label_ja)}</span>`
        : `<span style="display:flex;align-items:center;gap:3px">
             <input id="mm_ja_${m.key}" placeholder="补充日文名" style="font-size:10px;padding:2px 5px;border:1px solid var(--accent);border-radius:3px;width:90px">
             <button onclick="mmSetLabelJa('${m.key}')" title="仅补充日文名用于对照参考，不会修改该专业已在用的代号" style="font-size:9px;background:none;border:1px solid var(--accent);color:var(--accent);border-radius:3px;padding:2px 7px;cursor:pointer;font-family:inherit">保存</button>
           </span>`;
      html+=`<div style="display:flex;align-items:center;gap:8px;padding:5px 10px;border:1px solid var(--border-light);border-radius:4px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:500">${majorEsc(m.label)}</span>
        ${jaCell}
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
  const labelJa=document.getElementById('mm_label_ja').value.trim();
  const key=document.getElementById('mm_key').value.trim();
  if(!label){ alert('请填专业中文名'); return; }
  if(!labelJa && !key && !confirm('未填写日文专业名，代号将按中文名猜测生成，可能不准确（多音字/非日语汉字都会出错）。\n\n确定要跳过日文名，直接新建吗？')) return;
  // 代号留空 → createMajor 会优先按日文名生成罗马音（更准确），无日文名则退回中文名
  const res=await createMajor(label,key,domain,labelJa);
  if(res){
    if(!key) alert(`已新建专业「${label}」，自动生成代号：${res}`);
    document.getElementById('mm_label_ja').value='';
    await loadMajorsFromDB(); renderMajorManager(document.getElementById('consoleBody'));
  }
}
async function mmSetLabelJa(key){
  const el=document.getElementById('mm_ja_'+key);
  const labelJa=(el&&el.value||'').trim();
  if(!labelJa){ alert('请填写日文专业名'); return; }
  try{
    await sb(`/rest/v1/majors?key=eq.${key}`,'PATCH',{label_ja:labelJa});
    MAJORS_JA[key]=labelJa;
    await loadMajorsFromDB();
    renderMajorManager(document.getElementById('consoleBody'));
  }catch(e){ alert('保存失败：'+e.message); }
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
// ── 清理无用专业：扫一遍所有用到专业的数据，没有任何地方在用的专业列出来，选好后一次删除 ──
const MM_USAGE_SOURCES=[   // [表, 专业字段, 是否数组]
  ['students','major',false],['students','extra_majors',true],['courses','major',true],['teachers','majors',true],
  ['slots','major',false],['bookings','major',false],['promo_content','major',false],['vip_frameworks','major',true],
  ['admission_schools','major',false],['teacher_school_shares','major',false],['course_schedule_shares','major',false],
  ['success_cases','majors',true],['access_keys','majors',true],['admission_majors','key',false],
];
let _mmCleanSel=new Set(), _mmCleanCand=[], _mmCleanFailed=[];
async function mmCleanup(){
  let ov=document.getElementById('mmCleanModal');
  if(!ov){ ov=document.createElement('div'); ov.id='mmCleanModal'; ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px'; document.body.appendChild(ov); }
  ov.innerHTML='<div style="background:var(--surface);border-radius:6px;padding:20px;max-width:560px;width:100%"><div style="font-size:12px;color:var(--text-3)">正在检查各处数据，请稍等…</div></div>';
  const rows=window._majorRows||[];
  const used=new Set(), failed=[];
  const cnt={};
  for(const [t,col] of MM_USAGE_SOURCES){
    try{
      const data=await sbAll(`/rest/v1/${t}?select=${col}`)||[];
      data.forEach(r=>{ const v=r[col]; (Array.isArray(v)?v:[v]).forEach(k=>{ if(k){ used.add(k); cnt[k]=(cnt[k]||0)+1; } }); });
    }catch(e){ failed.push(t+'.'+col); }
  }
  const core=new Set(CORE_MAJOR_ORDER.concat(['shakai_group']));
  _mmCleanCand=rows.filter(r=>!used.has(r.key)&&!core.has(r.key));
  _mmCleanSel=new Set(_mmCleanCand.map(r=>r.key));
  _mmCleanFailed=failed;
  mmCleanRender(rows.length, rows.length-_mmCleanCand.length);
}
function mmCleanRender(total,inUse){
  const ov=document.getElementById('mmCleanModal'); if(!ov) return;
  const row=r=>{ const on=_mmCleanSel.has(r.key), dom=r.domain||'（未设领域）';
    return `<div onclick="mmCleanToggle('${r.key}')" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid ${on?'var(--accent)':'var(--border-light)'};background:${on?'var(--accent-light,#f5ede3)':'transparent'};border-radius:4px;font-size:12px">
      <span style="font-weight:500">${majorEsc(r.label)}</span><span style="font-size:10px;color:var(--text-3)">${r.key} · ${majorEsc(dom)}</span>
      <span style="margin-left:auto;font-size:10px;color:${on?'var(--accent)':'var(--text-3)'}">${on?'将删除':'保留'}</span></div>`; };
  const blocked=_mmCleanFailed.length;
  ov.firstElementChild.innerHTML=`<div style="font-size:14px;font-weight:600;margin-bottom:4px">清理无用专业</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">共 ${total} 个专业，${inUse} 个正在使用（学生、课程、老师、时间槽、预约、宣传、出愿库、VIP 框架、合格案例、访问链接等）。下面是没有任何地方在用的专业，点一行可切换删除 / 保留。经营、经济、社会、新传、福祉和「社会人文」不会被列出。</div>
    ${blocked?`<div style="font-size:11px;color:var(--danger);margin-bottom:10px">有 ${blocked} 处数据没能检查（${_mmCleanFailed.map(majorEsc).join('、')}），为安全起见暂不能删除，请刷新后重试。</div>`:''}
    <div style="display:flex;flex-direction:column;gap:5px;max-height:50vh;overflow-y:auto;margin-bottom:12px">
      ${_mmCleanCand.length?_mmCleanCand.map(row).join(''):'<div style="font-size:12px;color:var(--text-3);padding:12px;text-align:center">没有无用的专业，不需要清理</div>'}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-outline btn-sm" onclick="document.getElementById('mmCleanModal').remove()">关闭</button>
      ${_mmCleanCand.length?`<button class="btn btn-outline btn-sm" onclick="mmCleanAll(${_mmCleanSel.size<_mmCleanCand.length})">${_mmCleanSel.size<_mmCleanCand.length?'全部选中':'全部取消'}</button>
      <button class="btn btn-primary btn-sm" ${blocked||!_mmCleanSel.size?'disabled':''} onclick="mmCleanRun()">删除选中的 ${_mmCleanSel.size} 个</button>`:''}
    </div>`;
  ov.dataset.total=total; ov.dataset.inuse=inUse;
}
function mmCleanRefresh(){ const ov=document.getElementById('mmCleanModal'); mmCleanRender(+ov.dataset.total,+ov.dataset.inuse); }
function mmCleanToggle(k){ if(_mmCleanSel.has(k)) _mmCleanSel.delete(k); else _mmCleanSel.add(k); mmCleanRefresh(); }
function mmCleanAll(on){ _mmCleanSel=on?new Set(_mmCleanCand.map(r=>r.key)):new Set(); mmCleanRefresh(); }
async function mmCleanRun(){
  const keys=[..._mmCleanSel]; if(!keys.length||_mmCleanFailed.length) return;
  const names=_mmCleanCand.filter(r=>_mmCleanSel.has(r.key)).map(r=>r.label+'('+r.key+')').join('、');
  if(!confirm(`确定删除这 ${keys.length} 个没人在用的专业吗？\n\n${names}\n\n删除后专业选项里不再出现；误删了可以在本页重新新建。`)) return;
  try{
    await sb(`/rest/v1/majors?key=in.(${keys.map(k=>`"${k}"`).join(',')})`,'DELETE');
    keys.forEach(k=>{ delete MAJORS[k]; delete MAJOR_DOMAIN[k]; });
    await loadMajorsFromDB();
    document.getElementById('mmCleanModal').remove();
    renderMajorManager(document.getElementById('consoleBody'));
    alert(`已清理 ${keys.length} 个无用专业`);
  }catch(e){ alert('删除失败：'+e.message); }
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
  let html=`
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
    <div style="font-size:12px;font-weight:600">访问链接</div>
    <span style="font-size:10px;color:var(--text-3)">一个链接的范围 = 完整领域（可多个）＋ 单独专业（可跨领域）＋ 班级，三部分取并集</span>
    <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="openKeyEditor()">＋ 新建访问链接</button>
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
          <span style="font-weight:600;font-size:13px">${keyScopeText(kk)}</span>
          ${kk.label?`<span style="font-size:11px;color:var(--text-2)">${kk.label}</span>`:''}
          <span style="font-size:10px;color:var(--text-3)">🔗 链接即登录</span>
          ${kk.active?'':'<span style="font-size:10px;color:var(--danger)">已停用</span>'}
          <span style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn-outline btn-sm" onclick="copyKeyLink('${kk.k}')">复制链接</button>
            <button class="btn btn-outline btn-sm" onclick="openKeyEditor('${kk.k}')">编辑</button>
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
}
// ── 访问链接的范围：完整领域 + 单独专业 + 班级（新字段 domains / majors / class_ids；旧链接退回用 domain / major）──
function scopeFromKey(kk){
  const d=kk.domains||[], m=kk.majors||[], c=kk.class_ids||[];
  if(d.length||m.length||c.length) return {domains:d, majors:m, classIds:c, domainHint:kk.domain};
  if(kk.major) return {majors:[kk.major], domainHint:kk.domain};
  if(kk.domain) return {domains:[kk.domain]};
  return {};
}
// 组合范围的链接（非 admin）：老师管理里的领域 / 专业只能选范围内的；其他情况返回 null（不限制）
function teacherMultiDoms(){
  const keyUser=(typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin);
  return (keyUser && CURRENT_DOMAIN==='multi') ? scopeDomainList() : null;
}
function keyScopeText(kk){
  const sc=scopeFromKey(kk);
  if(!(sc.domains||[]).length && !(sc.majors||[]).length && !(sc.classIds||[]).length) return '（没有设置范围）';
  return escTM(scopeSummary(sc));
}
// 新建 / 编辑共用的弹窗（全部 chip 点选，不用复选框）
let _keyDraft=null;   // {k:'' 新建 | 链接的 k, domains:[], majors:[], classIds:[], label}
async function openKeyEditor(k){
  try{ if(typeof loadClasses==='function') await loadClasses(); }catch(e){}
  const kk=k?_consoleKeys.find(x=>x.k===k):null;
  const sc=kk?scopeFromKey(kk):{};
  _keyDraft={k:kk?kk.k:'', domains:(sc.domains||[]).slice(), majors:(sc.majors||[]).slice(), classIds:(sc.classIds||[]).map(String), label:kk?(kk.label||''):''};
  let ov=document.getElementById('keyEditModal');
  if(!ov){ ov=document.createElement('div'); ov.className='modal-overlay'; ov.id='keyEditModal'; ov.style.zIndex='1000'; document.body.appendChild(ov); }
  ov.classList.add('open'); renderKeyEditor();
}
function closeKeyEditor(){ const ov=document.getElementById('keyEditModal'); if(ov) ov.classList.remove('open'); _keyDraft=null; }
function keyDraftSummary(){
  const d=_keyDraft, parts=[];
  d.domains.forEach(x=>parts.push(x+'（整个领域）'));
  d.majors.forEach(m=>parts.push((MAJOR_DOMAIN[m]?MAJOR_DOMAIN[m]+'·':'')+(MAJORS[m]||m)));
  d.classIds.forEach(id=>{ const c=(typeof classById==='function')?classById(id):null; parts.push('班级：'+(c?c.name:id)); });
  return parts.length?parts.join(' ＋ '):'（还没有选任何范围）';
}
// 范围选择器（领域 / 专业 / 班级三块 chip，访问链接和「负责人范围」共用）：d={domains,majors,classIds}，fn=点 chip 时调用的函数名（fn(field,val)）
function scopePickerHtml(d,fn){
  const chip=(on,label,fn,dis)=>`<div class="filter-chip${on?' active':''}" ${dis?'':`onclick="${fn}"`} style="padding:3px 10px;font-size:11px;${dis?'opacity:.4;cursor:default':''}" ${dis?'title="这个领域已经整个选中，不用再单选专业"':''}>${label}</div>`;
  const sec=(t,inner)=>`<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">${t}</div>${inner}</div>`;
  const majorsHtml=DOMAINS.map(dm=>{
    const ks=allMajorKeys().filter(k=>MAJOR_DOMAIN[k]===dm.label); if(!ks.length) return '';
    const full=d.domains.includes(dm.label);
    return `<div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;margin-bottom:5px"><span style="font-size:10px;color:var(--text-3);min-width:64px">${dm.label}</span>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${chipFold(ks.map(k=>({on:d.majors.includes(k),html:chip(d.majors.includes(k), escTM(MAJORS[k]||k), `${fn}('majors','${k}')`, full)})))}</div></div>`;
  }).join('');
  const cls=(typeof CLASSES!=='undefined'?CLASSES:[]).filter(c=>c.active!==false);
  const clsHtml=cls.length?DOMAINS.map(dm=>{
    const cs=cls.filter(c=>c.domain===dm.label); if(!cs.length) return '';
    return `<div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;margin-bottom:5px"><span style="font-size:10px;color:var(--text-3);min-width:64px">${dm.label}</span>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${chipFold(cs.map(c=>({on:d.classIds.includes(String(c.id)),html:chip(d.classIds.includes(String(c.id)), escTM(c.name), `${fn}('classIds','${String(c.id).replace(/'/g,"\\'")}')`, d.domains.includes(dm.label))})))}</div></div>`;
  }).join('')+((cls.filter(c=>!DOMAINS.some(dm=>dm.label===c.domain)).length)?`<div style="display:flex;gap:4px;flex-wrap:wrap">${cls.filter(c=>!DOMAINS.some(dm=>dm.label===c.domain)).map(c=>chip(d.classIds.includes(String(c.id)), escTM(c.name), `${fn}('classIds','${String(c.id).replace(/'/g,"\\'")}')`)).join('')}</div>`:''):'<span style="font-size:10px;color:var(--text-3)">还没有班级（在「班级管理」里建）</span>';
  return sec('完整领域（这个领域的所有东西都能看到，包括没有专业的）',`<div style="display:flex;gap:6px;flex-wrap:wrap">${DOMAINS.map(dm=>chip(d.domains.includes(dm.label), dm.label, `${fn}('domains','${dm.label}')`)).join('')}</div>`)
    +sec('单独专业（只看这些专业的东西；没有专业的东西不显示）',majorsHtml||'<span style="font-size:10px;color:var(--text-3)">还没有专业</span>')
    +sec('班级（只看属于这些班级的学生和按班级编入的课）',clsHtml);
}
// 点 chip 的公共逻辑：切换选中；整个领域选中后，它下面单独选的专业 / 班级已经包含了，去掉
function scopeDraftToggle(d,field,val){
  const a=d[field], i=a.indexOf(val); if(i>=0) a.splice(i,1); else a.push(val);
  if(field==='domains'&&i<0){
    d.majors=d.majors.filter(m=>MAJOR_DOMAIN[m]!==val);
    d.classIds=d.classIds.filter(id=>{ const c=(typeof classById==='function')?classById(id):null; return !(c&&c.domain===val); });
  }
}
function renderKeyEditor(){
  const ov=document.getElementById('keyEditModal'), d=_keyDraft; if(!ov||!d) return;
  const sec=(t,inner)=>`<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">${t}</div>${inner}</div>`;
  ov.innerHTML=`<div class="modal" style="width:640px">
    <div class="modal-title">${d.k?'编辑访问链接':'新建访问链接'}</div>
    <div class="modal-sub">${d.k?`链接地址不变（${escTM(d.k)}），改完后已经发出去的链接对方刷新即生效`:'范围 = 完整领域（可多个）＋ 单独专业（可跨领域）＋ 班级，三部分取并集'}</div>
    ${scopePickerHtml(d,'keyDraftToggle')}
    ${sec('备注',`<input id="kd_label" value="${escTM(d.label)}" oninput="_keyDraft.label=this.value" placeholder="如负责人名（选填）" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;width:100%;box-sizing:border-box">`)}
    <div style="font-size:12px;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px 12px;line-height:1.7">这个链接可以看到：<b>${escTM(keyDraftSummary())}</b></div>
    <div class="modal-actions"><button class="btn btn-outline" onclick="closeKeyEditor()">取消</button><button class="btn btn-primary" onclick="saveKeyEditor()">${d.k?'保存修改':'生成链接'}</button></div>
  </div>`;
}
function keyDraftToggle(field,val){
  scopeDraftToggle(_keyDraft,field,val);
  admKeepFold(document.getElementById('keyEditModal'),renderKeyEditor);
}
async function saveKeyEditor(){
  const d=_keyDraft; if(!d) return;
  if(!d.domains.length&&!d.majors.length&&!d.classIds.length){ alert('请至少选一个范围（领域、专业或班级）'); return; }
  const label=(d.label||'').trim();
  // 旧字段 domain / major 先保留（回滚兜底）：domain = 第一个涉及的领域；major = 范围正好是一个专业时才填
  const cls0=(typeof classById==='function'&&d.classIds.length)?classById(d.classIds[0]):null;
  const domain=d.domains[0]||(d.majors[0]&&MAJOR_DOMAIN[d.majors[0]])||(cls0&&cls0.domain)||'';
  const major=(!d.domains.length&&d.majors.length===1&&!d.classIds.length)?d.majors[0]:null;
  const rec={domain, major, domains:d.domains, majors:d.majors, class_ids:d.classIds, label:label||null};
  try{
    if(d.k){
      await sb(`/rest/v1/access_keys?k=eq.${encodeURIComponent(d.k)}`,'PATCH',rec);
      closeKeyEditor(); await loadConsole();
      alert('已保存。链接地址不变，已经发出去的链接对方刷新页面即按新范围生效。');
    } else {
      // 不再需要密码：链接即登录（k@access.local 由触发器自动建 Auth，登录靠链接的 k）
      const pw='auto-'+Math.random().toString(36).slice(2,10);  // password 字段保留非空，但不用于登录
      const code=domainCode(d.domains[0]||domain)||'key';
      const k=code+(major?'_'+major:'')+'-'+Date.now().toString(36).slice(-4);
      await sb('/rest/v1/access_keys','POST',Object.assign({k,password:pw,is_admin:false,active:true},rec));
      closeKeyEditor(); await loadConsole();
      alert(`已生成访问链接：${d.domains.concat(d.majors.map(m=>MAJORS[m]||m)).join(' ＋ ')||'班级范围'}。\n发送链接给负责人即可，点开直接进，无需密码。`);
    }
  }catch(e){ alert('保存失败：'+e.message); }
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
// ═══════════════════════════════════════════════
// 负责人与权限（只有管理员）：老师链接绑定「负责人」身份 + 排课/资源权限
//  - manage_scope（teachers 表）：管理范围，空 = 不是负责人；老师端出现「管理模式」按钮，进管理端 ?as=teacher
//  - resource_perms（teachers 表）：排课/资源权限代号（sched/common.js PERM_DEFS 同一套）
//  - 权限模板：读 sched_access_codes 里现有的口令角色，选了就把它的 perms 填进 chip
// ═══════════════════════════════════════════════
let _mgrDraft=null;      // {domains,majors,classIds,perms:[]}：老师编辑表单里「资源管理权限」「负责人」两个区块的草稿
let _mgrTemplates=null;  // [{label,perms:[]}]
function isHubAdminUser(){ return !ACCESS_KEY || (!ACCESS_KEY.invalid && ACCESS_KEY.is_admin); }
// 打开 / 重置老师表单时调用：t=老师（新建传 null）。两个区块只在管理员的表单里渲染
async function tfMgrInit(t){
  if(!document.getElementById('tf_manager_box')){ _mgrDraft=null; return; }
  const ms=(t&&t.manage_scope)||{};
  _mgrDraft={domains:(ms.domains||[]).slice(),majors:(ms.majors||[]).slice(),classIds:(ms.class_ids||[]).map(String),perms:((t&&t.resource_perms)||[]).slice()};
  const draft=_mgrDraft;
  tfMgrRender();
  try{ if(typeof loadClasses==='function') await loadClasses(); }catch(e){}
  if(_mgrTemplates===null){
    try{
      const rows=await sb('/rest/v1/sched_access_codes?select=label,role,perms,sort,active&order=sort.asc,id.asc');
      _mgrTemplates=(rows||[]).filter(r=>r.active!==false).map(r=>({label:r.label||r.role||'',perms:String(r.perms||'').split(',').map(x=>x.trim()).filter(Boolean)})).filter(r=>r.label);
    }catch(e){ _mgrTemplates=[]; }
  }
  if(_mgrDraft===draft) tfMgrRender();
}
function tfMgrRender(){
  const d=_mgrDraft, rb=document.getElementById('tf_resource_box'), mb=document.getElementById('tf_manager_box'); if(!d||!rb||!mb) return;
  const permChips=RESOURCE_PERM_DEFS.map(([code,label])=>`<div class="filter-chip${d.perms.includes(code)?' active':''}" data-res="${code}" onclick="mgrPermToggle('${code}')" style="padding:3px 10px;font-size:11px">${escTM(label)}</div>`).join('');
  const tplOpts='<option value="">选择权限模板（选了会覆盖下面已选的权限，之后可再增减）</option>'+(_mgrTemplates||[]).map((r,i)=>`<option value="${i}">${escTM(r.label)}</option>`).join('');
  rb.innerHTML=`<select onchange="mgrPickTemplate(this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;width:100%;box-sizing:border-box;margin-bottom:8px">${tplOpts}</select><div style="display:flex;gap:6px;flex-wrap:wrap">${permChips}</div>`;
  const isMgr=d.domains.length||d.majors.length||d.classIds.length;
  mb.innerHTML=`<div style="font-size:10px;color:var(--text-3);margin-bottom:8px">管理范围为空 = 不是负责人。设了范围后，这位老师用自己的老师链接登录，会多出「管理模式」按钮，一键进管理端（只看到范围内的东西），不用另外的访问链接。</div>
    ${scopePickerHtml(d,'mgrDraftToggle')}
    <div style="font-size:12px;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:8px 12px;line-height:1.7">${isMgr?`负责人，管理范围：<b>${escTM(scopeSummary(d))}</b>`:'<b>不是负责人</b>（没有设置管理范围）'}</div>`;
  tsecRefresh();
}
function mgrDraftToggle(field,val){
  scopeDraftToggle(_mgrDraft,field,val);
  admKeepFold(document.getElementById('tf_manager_box'),tfMgrRender);
}
function mgrPermToggle(code){
  const a=_mgrDraft.perms, i=a.indexOf(code); if(i>=0) a.splice(i,1); else a.push(code);
  admKeepFold(document.getElementById('tf_resource_box'),tfMgrRender);
}
function mgrPickTemplate(i){
  if(i===''||!_mgrDraft) return;
  const tpl=(_mgrTemplates||[])[+i]; if(!tpl) return;
  const known=new Set(RESOURCE_PERM_DEFS.map(x=>x[0]));
  _mgrDraft.perms=tpl.perms.filter(p=>known.has(p));
  admKeepFold(document.getElementById('tf_resource_box'),tfMgrRender);
}
// 保存时取负责人范围 + 资源权限（表单里没有这两个区块就返回 {}，不动原有值）；管理员取消确认返回 null
function tfMgrCollect(cur,isNew){
  const d=_mgrDraft; if(!d||!document.getElementById('tf_manager_box')) return {};
  const isMgr=d.domains.length||d.majors.length||d.classIds.length;
  const manage_scope=isMgr?{domains:d.domains,majors:d.majors,class_ids:d.classIds}:null;
  const resource_perms=d.perms.slice();
  if(isNew && !manage_scope && !resource_perms.length) return {};   // 新建且没设：不写这两个字段（准备 SQL 没执行时也能新建）
  const changed=JSON.stringify(manage_scope)!==JSON.stringify(cur&&cur.manage_scope||null);
  if(isMgr && changed && !confirm(`把「${document.getElementById('new_teacher_name').value.trim()}」设为负责人（${scopeSummary(d)}）？\n\n负责人在管理模式里，对范围内的数据拥有和访问链接一样的新建 / 编辑权限。`)) return null;
  return {manage_scope,resource_perms};
}

// ═══════════════════════════════════════════════
// 老师编辑表单的分区（只管「怎么显示」，不改任何权限逻辑）
//  - 区块默认收起，标题行显示当前配置摘要；有配置的区块标题旁有小圆点
//  - 兼职 / 正社员 按 TEACHER_SECTION_RULES 隐藏不常用的区块；已经有配置的照样显示并提示；「显示全部选项」打开后全显示
//  - 隐藏的区块只是 display:none，里面的值照样随表单保存
// ═══════════════════════════════════════════════
const TEACHER_SECTION_DEFS=[['basic','基本信息'],['area','负责领域与专业'],['features','老师端功能'],['sales','营业功能'],['homework','作业批改分配'],['resource','资源管理权限'],['manager','负责人']];
const TEACHER_SECTION_RULES={ '兼职':{ hide:['resource','manager','sales'] }, '正社员':{ hide:[] } };
let _tsecShowAll=false;
function tsecWrap(key,title,inner,pad){
  const open=key==='basic';
  return `<div class="tsec" id="tsec_${key}" style="border:1px solid var(--border-light);border-radius:3px;margin-bottom:8px;overflow:hidden">
    <div onclick="tsecToggle('${key}')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;background:var(--bg)">
      <span id="tsec_arrow_${key}" style="font-size:10px;color:var(--text-3)">${open?'▾':'▸'}</span>
      <span style="font-size:12px;font-weight:600;white-space:nowrap">${title}</span>
      <span id="tsec_dot_${key}" style="display:none;width:6px;height:6px;border-radius:50%;background:var(--accent);flex-shrink:0"></span>
      <span id="tsec_warn_${key}" style="display:none;font-size:10px;color:var(--warn,#b8860b);white-space:nowrap"></span>
      <span id="tsec_task_${key}" style="display:none;font-size:10px;color:var(--warn,#b8860b);white-space:nowrap"></span>
      <span id="tsec_sum_${key}" style="font-size:10px;color:var(--text-3);margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
    </div>
    <div id="tsec_body_${key}" style="${open?'':'display:none;'}padding:${pad||0}px;border-top:1px solid var(--border-light)">${inner}</div>
  </div>`;
}
function tsecToggle(key,force){
  const b=document.getElementById('tsec_body_'+key); if(!b) return;
  const open=force==null?b.style.display==='none':!!force;
  b.style.display=open?'':'none';
  const ar=document.getElementById('tsec_arrow_'+key); if(ar) ar.textContent=open?'▾':'▸';
}
function tsecCollapse(){ TEACHER_SECTION_DEFS.forEach(([k])=>tsecToggle(k,k==='basic')); }
// 某区块当前的摘要 / 是否有配置（直接读表单）
function tsecState(key){
  const $=id=>document.getElementById(id), chk=id=>{const e=$(id);return !!(e&&e.checked)};
  const _isDom=(typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin && !!viewLockDomain());
  if(key==='basic'){
    const ty=document.querySelector('#new_teacher_stafftype .filter-chip.active')?.dataset.value||'';
    const dept=ty==='正社员'?($('new_teacher_department')?.value||''):'';
    const tags=parseTeacherTags().length;
    return {has:false,sum:[ty,dept,tags?tags+' 个标签':''].filter(Boolean).join(' · ')||'未填写'};
  }
  if(key==='area'){
    const doms=_isDom?[viewLockDomain()]:[...document.querySelectorAll('#new_teacher_domains .filter-chip.active')].map(c=>c.dataset.value);
    const ms=[...document.querySelectorAll('#new_teacher_majors .filter-chip.active')].map(c=>majorLabel(c.dataset.value));
    return {has:!!(doms.length||ms.length),sum:[doms.join('、'),ms.join('、')].filter(Boolean).join(' · ')||'未设置'};
  }
  if(key==='features'){
    const n=['perm_booking','perm_slots','perm_student_mgmt','perm_admission_query'].filter(chk).length+(($('perm_schedule_mode')?.value)?1:0);
    return {has:n>0,sum:n?`已开 ${n} 项`:'未开启'};
  }
  if(key==='sales'){
    const ids=['perm_promo','perm_progress_plan','perm_lect_info','perm_vip_sales','perm_promo_pack','perm_promo_pricing','perm_success_cases'];
    const n=ids.filter(chk).length;
    return {has:n>0,sum:n?`已开 ${n} 项`:'未开启'};
  }
  if(key==='homework'){
    const parts=[hwaOwn?'自己上课的单回':'',hwaCoursesOn?`负责课程 ${hwaIds.size} 门`:''].filter(Boolean);
    const on=chk('perm_homework');
    return {has:on||parts.length>0,sum:on?(parts.join(' · ')||'已开启（未分配）'):(parts.length?parts.join(' · ')+'（批改未开）':'未开启')};
  }
  if(key==='resource'){ const n=_mgrDraft?_mgrDraft.perms.length:0; return {has:n>0,sum:n?`${n} 项权限`:'无'}; }
  if(key==='manager'){
    const d=_mgrDraft, on=!!d&&(d.domains.length||d.majors.length||d.classIds.length);
    return {has:!!on,sum:on?'负责人：'+scopeSummary(d):'不是负责人'};
  }
  return {has:false,sum:''};
}
function tsecCurType(){ return document.querySelector('#new_teacher_stafftype .filter-chip.active')?.dataset.value||''; }
// 只更新标题行的摘要 / 圆点 / 提示，不动显示隐藏
function tsecRefresh(){
  const ty=tsecCurType(), hide=new Set(((TEACHER_SECTION_RULES[ty]||{}).hide)||[]);
  TEACHER_SECTION_DEFS.forEach(([k])=>{
    const el=document.getElementById('tsec_'+k); if(!el) return;
    const st=tsecState(k);
    document.getElementById('tsec_sum_'+k).textContent=st.sum;
    document.getElementById('tsec_dot_'+k).style.display=st.has?'inline-block':'none';
    const w=document.getElementById('tsec_warn_'+k);
    w.style.display=(hide.has(k)&&st.has)?'':'none'; w.textContent=`⚠ ${ty}通常不需要`;
  });
  tfTaskHintRender(); tfRoleDiffRender();
}
// ── 任务联动：这位老师有职能标签、该职能下的任务需要某项功能、却还没开 → 提示 + 「去设置」──
let _tfTaskTpl=null, _tfEditId='';
async function tfTaskLoad(){
  if(_tfTaskTpl!==null) return;
  try{ _tfTaskTpl=await sbAll('/rest/v1/task_templates?select=*&active=is.true'); }catch(e){ _tfTaskTpl=[]; }   // 表还没建时静默当作没有任务
  tsecRefresh(); if(typeof renderTeacherRows==='function') renderTeacherRows();
}
function tfTaskHintRender(){
  const box=document.getElementById('tf_task_hint');
  TEACHER_SECTION_DEFS.forEach(([k])=>{ const e=document.getElementById('tsec_task_'+k); if(e) e.style.display='none'; });
  if(!box) return;
  const cur=cachedTeachers.find(x=>x.id===_tfEditId);
  if(!cur||!_tfTaskTpl||typeof taskMissingFeatures!=='function'){ box.style.display='none'; return; }
  // 按表单当前内容判断（标签、功能勾选），领域 / 专业用已保存的
  const live=Object.assign({},cur,{tags:parseTeacherTags(),permissions:getPermissionsFromForm(cur.permissions)});
  const miss=taskMissingFeatures(live,_tfTaskTpl);
  if(!miss.length){ box.style.display='none'; return; }
  box.style.display='';
  box.innerHTML=miss.map(m=>`<div>⚠ 需要开启：${escTM(m.tpl.requires_label||m.tpl.requires)}（任务「${escTM(m.tpl.title)}」）${m.spot?` <a href="javascript:void(0)" onclick="openTeacherEdit('${_tfEditId}','${m.spot[0]}','${m.spot[1]||''}')" style="color:var(--accent)">[去设置]</a>`:''}</div>`).join('');
  const bySec={};
  miss.forEach(m=>{ if(m.spot) (bySec[m.spot[0]]=bySec[m.spot[0]]||[]).push(m.tpl.requires_label||m.tpl.requires); });
  Object.keys(bySec).forEach(k=>{ const e=document.getElementById('tsec_task_'+k); if(e){ e.style.display=''; e.textContent='⚠ 任务需要：'+bySec[k].join('、'); } });
}
function tsecRefreshSoon(){ setTimeout(tsecRefresh,0); }
// 按类型决定哪些区块显示（打开老师 / 切换类型 / 切换「显示全部选项」时才重新判断，避免编辑中区块突然消失）
function tsecApply(){
  const ty=tsecCurType(), hide=new Set(((TEACHER_SECTION_RULES[ty]||{}).hide)||[]);
  TEACHER_SECTION_DEFS.forEach(([k])=>{
    const el=document.getElementById('tsec_'+k); if(!el) return;
    el.style.display=(!hide.has(k)||_tsecShowAll||tsecState(k).has)?'':'none';
  });
  tsecRefresh();
}
function tsecShowAllToggle(el){ _tsecShowAll=!_tsecShowAll; el.classList.toggle('active',_tsecShowAll); tsecApply(); }
// 重置表单（新建 / 取消 / 添加成功后）：区块收起、负责人草稿清空
function tfFormReset(){
  _tfEditId='';
  tfRolesLoad(null);
  tsecCollapse();
  tfMgrInit(null);
  roleTplEnsure();
  tsecApply();
}
// 供任务管理「去设置」调用：打开某位老师的编辑页，展开指定区块，滚动到并高亮其中一项
// item 可以是 perm_xxx 的 id 后缀（如 'promo_pricing'）或学生管理子项（如 'records_entry'）
function openTeacherEdit(id,sec,item){
  if(_tfEditId!==id) openEditTeacher(id);   // 已经在编辑这位老师就不重开（不丢没保存的改动）
  if(sec){ const el=document.getElementById('tsec_'+sec); if(el){ el.style.display=''; tsecToggle(sec,true); } }
  if(item){
    setTimeout(()=>{
      let t=document.getElementById('perm_'+item)||document.querySelector(`#perm_student_mgmt_items [data-value="${item}"]`);
      if(!t) return;
      if(t.tagName==='INPUT'&&t.closest('label')) t=t.closest('label');
      t.scrollIntoView({behavior:'smooth',block:'center'});
      const old=t.style.outline; t.style.outline='2px solid var(--accent)';
      setTimeout(()=>{ t.style.outline=old; },2500);
    },80);
  }
}

// 切换视角/返回中枢时清空所有缓存与页面，避免下个视角闪现上个视角的旧数据
function clearDomainCaches(){
  try{
    cachedStudents=[]; cachedCourses=[]; cachedSessions=[]; cachedTeachers=[];
    cachedSlots=[]; cachedBookings=[]; cachedAttendance=[]; cachedSessionRecords=[];
  }catch(e){}
  const mc=document.getElementById('mainContent'); if(mc) mc.innerHTML='<div class="loading">加载中…</div>';
}

async function enterScope(sc){
  clearDomainCaches();   // 进新视角前先清空,确保重新拉取、不带旧数据
  setViewScope(sc||{});
  // 范围里有班级：先把班级读进来（顶栏摘要要班级名、班级所属领域要参与下拉框）
  if((VIEW_SCOPE.classIds||[]).length && typeof loadClasses==='function'){ try{ await loadClasses(); }catch(e){} }
  try{ localStorage.setItem('txe_domain', CURRENT_DOMAIN); }catch(e){}
  const el=document.getElementById('hubOverlay'); if(el) el.style.display='none';
  // 在顶栏显示当前视角（范围摘要，太长时省略，鼠标移上去显示全部）
  const tag=document.getElementById('domainTag');
  if(tag){
    const t=scopeSummary(VIEW_SCOPE);
    tag.textContent=t; tag.title=t;
    tag.style.cssText+=';max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle';
  }
  // 领域/专业钥匙用户：隐藏「切换视角」（锁定）
  const sw=document.getElementById('switchViewBtn');
  const keyOnly=!!(ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin);
  if(sw) sw.style.display=keyOnly?'none':'';
  // 访问链接进来的不需要登录，「重新登录」没有意义：隐藏
  const rl=document.getElementById('reloginBtn'); if(rl) rl.style.display=keyOnly?'none':'';
  await initApp();
}
// 兼容旧调用：enterDomain('all') 总览；enterDomain('大学院文科') 一个完整领域；enterDomain(领域, 专业) 单个专业
function enterDomain(domain, major){
  return enterScope(major?{majors:[major], domainHint:domain}:((domain==='all'||!domain)?{}:{domains:[domain]}));
}
// 领域 / 专业 / 组合钥匙进入：范围为空的非 admin 钥匙不能放行（否则等于总览）
function enterFromKey(){
  const sc=scopeFromKey(ACCESS_KEY);
  if(!(sc.domains||[]).length&&!(sc.majors||[]).length&&!(sc.classIds||[]).length){
    document.getElementById('loginOverlay').style.display='flex';
    loginErr('此访问链接没有设置范围，请联系管理员');
    return;
  }
  return enterScope(sc);
}
function backToHub(){ // 从系统内返回中枢层重新选领域
  // 领域钥匙用户被锁定在自己领域，不能切换视角
  if(ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin) return;
  clearDomainCaches();   // 清掉当前视角数据,避免 hub 底下/下个视角残留旧数据
  const el=document.getElementById('hubOverlay'); if(el) el.style.display='flex';
}
// 按当前领域视角过滤课程数组（总览时原样返回）
function filterByDomain(list){
  if(scopeAll()) return list;
  return (list||[]).filter(c => scopeCourse(c));
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
// ── 资源管理（嵌入排课系统）──
// 谁能看到入口：管理员（邮箱登录）；管理模式的负责人老师（resource_perms 不为空）；领域访问链接不显示
function resourceNavAllowed(){
  if(ACCESS_KEY && ACCESS_KEY.invalid) return false;
  if(ACCESS_KEY && ACCESS_KEY._asTeacher) return (ACCESS_KEY._asTeacher.resource_perms||[]).length>0;
  return isHubAdminUser();
}
function syncResourceNav(){
  const ok=resourceNavAllowed(), b=document.getElementById('nav-resource');
  if(b) b.style.display=ok?'':'none';
  return ok;
}
async function renderResourcePage(mc){
  if(!syncResourceNav()){ mc.innerHTML='<div class="empty" style="padding:40px">没有资源管理权限</div>'; return; }
  const asT=ACCESS_KEY && ACCESS_KEY._asTeacher;
  // 嵌入的排课系统要读登录 token：先让会话续期，免得读到过期的
  try{
    const c=asT ? window.__teacherAuthClient : sbAuthClient();
    if(c) await c.auth.getSession();
  }catch(e){}
  mc.innerHTML=`<iframe id="resourceFrame" src="../sched/index.html?embed=admin${asT?'&as=teacher':''}" style="width:100%;height:calc(100vh - 100px);min-height:520px;border:0;display:block"></iframe>`;
}
async function renderPage(){
  syncResourceNav();
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
      if(typeof loadClasses==='function') await loadClasses(true);
      [cachedStudents,cachedTeachers]=await Promise.all([
        sbAll('/rest/v1/students?select=*&order=name.asc'),
        sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[])
      ]);
      renderStudentsPage(mc);
    } else if(curPage==='tasks'){
      await tkRenderTeamPage(mc);
    } else if(curPage==='resource'){
      await renderResourcePage(mc);
    } else if(curPage==='courses'){
      if(typeof loadClasses==='function') await loadClasses(true);
      [cachedStudents,cachedCourses,cachedSessions]=await Promise.all([
        sbAll('/rest/v1/students?select=*&order=name.asc'),
        sbAll('/rest/v1/courses?select=*&order=created_at.desc'),
        sbAll('/rest/v1/course_sessions?select=*&order=session_date.asc')
      ]);
      cachedCourses=filterByDomain(cachedCourses);
      // 从 sched_courses 附加「假期豁免」(holiday_except) 与休讲日：课程安排与排课系统视为同一门课，
      // 按 id 优先、名称兜底匹配，让课程安排的日期计算尊重 sched 里设的豁免。
      try {
        const _scs = await sbAll('/rest/v1/sched_courses?select=id,name,holiday_except,skip_dates').catch(()=>[]);
        const _byId={}, _byName={};
        (_scs||[]).forEach(sc=>{ if(sc.id!=null)_byId[sc.id]=sc; const k=(sc.name||'').trim(); if(k&&!_byName[k])_byName[k]=sc; });
        cachedCourses.forEach(c=>{ const sc=_byId[c.id]||_byName[(c.name||'').trim()]; if(sc){ c._sched_id=sc.id; c.holiday_except=sc.holiday_except||''; if(sc.skip_dates&&!c.skip_dates) c.skip_dates=sc.skip_dates; } });
      } catch(e) {}
      renderCoursesPage(mc);
    } else if(curPage==='promo'){
      [cachedCourses,cachedSessions]=await Promise.all([
        sbAll('/rest/v1/courses?select=*&order=created_at.desc').catch(()=>cachedCourses||[]),
        sbAll('/rest/v1/course_sessions?select=*&order=session_date.asc').catch(()=>cachedSessions||[])
      ]);
      renderPromoAdminPage(mc);
    } else if(curPage==='coursecleanup'){
      if(typeof loadClasses==='function') await loadClasses(true);
      [cachedCourses,cachedSessions,cachedTeachers,cachedStudents,cachedCourseMembers]=await Promise.all([
        sbAll('/rest/v1/courses?select=*&order=created_at.desc'),
        sbAll('/rest/v1/course_sessions?select=*&order=session_date.asc'),
        sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[]),
        sbAll('/rest/v1/students?select=*&order=name.asc').catch(()=>cachedStudents||[]),
        sbAll('/rest/v1/course_members?select=*').catch(()=>[]),   // 课程学生成员（表未建时为空）
        sb('/rest/v1/course_templates?select=*&order=created_at.desc').catch(()=>null)   // 作业是否已存入模板的检查用
      ]).then(r=>{ cachedTemplates=r.pop(); return r; });
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
      if(typeof loadAdmissionMajorsFromDB==='function') await loadAdmissionMajorsFromDB();
      [cachedTeachers, cachedSessions]=await Promise.all([
        sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[]),
        sbAll('/rest/v1/course_sessions?homework_enabled=is.true&select=id,course_name&order=course_name.asc').catch(()=>[]),
      ]);
      renderTeachersPage(mc);
    } else if(curPage==='payroll'){
      cachedTeachers=await sb('/rest/v1/teachers?select=*&order=name.asc').catch(()=>[]);
      renderPayrollPage(mc);
    } else if(curPage==='admissiondb'){
      if(typeof loadAdmissionMajorsFromDB==='function') await loadAdmissionMajorsFromDB();
      // 只拉 major 字段用于渲染专业筛选按钮，点专业后再拉完整数据
      const majorRows=await sb('/rest/v1/admission_schools?select=major&limit=10000').catch(()=>[]);
      cachedAdmissionSchools=[];
      cachedAdmissionMajorCounts={};
      majorRows.forEach(r=>{ cachedAdmissionMajorCounts[r.major]=(cachedAdmissionMajorCounts[r.major]||0)+1; });
      renderAdmissionDbPage(mc);
    } else if(curPage==='attendance'){
      [cachedStudents,cachedCourses,cachedSessions,cachedSessionRecords,cachedCourseMembers]=await Promise.all([
        sbAll('/rest/v1/students?select=*&order=name.asc'),
        sbAll('/rest/v1/courses?select=*&order=created_at.desc'),
        sbAll('/rest/v1/course_sessions?select=*&order=session_date.asc,session_number.asc'),
        sbAll('/rest/v1/session_records?select=*'),
        sbAll('/rest/v1/course_members?select=*').catch(()=>[])
      ]);
      renderAttendancePage(mc);
    } else if(curPage==='monthly'){
      cachedStudents=await sbAll('/rest/v1/students?select=*&order=name.asc');
      renderMonthlyPage(mc);
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
  hwaData=null;   // 作业分配的课程列表：每次进入老师管理重新读取
  const _isDom = (typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin && !!viewLockDomain());
  const _lockDom = _isDom ? viewLockDomain() : '';
  mc.innerHTML=`
  <div class="page-header">
    <div class="section-title">老师管理 <span class="badge-count">${cachedTeachers.length}</span></div>
    <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:3px;overflow:hidden">
      <button style="font-size:11px;padding:5px 16px;border:none;cursor:pointer;font-family:inherit;background:var(--accent);color:#fff">👥 老师账号</button>
      <button onclick="renderTeacherProfilesPage(teacherPageHost())" style="font-size:11px;padding:5px 16px;border:none;cursor:pointer;font-family:inherit;background:var(--surface);color:var(--text-2)">📇 讲师档案</button>
    </div>
  </div>
  <div class="swipe-row" style="grid-template-columns:minmax(240px,1fr) minmax(0,1.6fr)">
    <!-- 添加/编辑老师 -->
    <style>.rd-def::after{content:'角色默认';font-size:8px;color:var(--accent);margin-left:4px;font-weight:400;white-space:nowrap}</style>
    <div onclick="tsecRefreshSoon()" oninput="tsecRefreshSoon()" onchange="tsecRefreshSoon()" style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:16px;min-width:0">
      <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:14px;letter-spacing:.05em;text-transform:uppercase" id="teacherFormTitle">添加新老师</div>
      <div id="tf_task_hint" style="display:none;font-size:11px;line-height:1.7;background:#fff8e6;border:1px solid #e8d4a0;border-radius:3px;padding:6px 10px;margin-bottom:10px;color:var(--warn,#b8860b)"></div>
      ${tsecWrap('basic','基本信息',`
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
      ${isHubAdminUser()?`<div class="form-group" id="tf_position_wrap" style="display:none"><label class="form-label">管理职位（只有正社员；最多一个，再点一次取消）</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="tf_position_chips">${TEACHER_POSITIONS.map(([k,v])=>`<div class="filter-chip" data-pos="${k}" onclick="tfPositionClick('${k}')" style="padding:4px 12px;font-size:11px">${v}</div>`).join('')}</div></div>
      <div class="form-group"><label class="form-label">执行角色（可多选；选了会自动带出默认功能）</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="tf_roles_chips">${TEACHER_ROLES.map(([k,v])=>`<div class="filter-chip" data-role="${k}" onclick="tfRoleClick('${k}')" style="padding:4px 12px;font-size:11px">${v}</div>`).join('')}</div>
        <div id="tf_role_scope" style="margin-top:8px"></div></div>`:''}
      <div class="form-group"><label class="form-label">其他标签（自由填写，只用于搜索标记）</label>
        <input id="new_teacher_tags" oninput="senmonChipSync()" placeholder="用逗号或顿号分隔，如：计划书指导、模拟面试、兼职"></div>
      `,10)}
      <div id="tf_role_diff" style="display:none;font-size:11px;line-height:1.7;background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:6px 10px;margin-bottom:8px;color:var(--text-2)"></div>
      ${tsecWrap('area','负责领域与专业',`
      ${_isDom ? `<div class="form-group"><label class="form-label">领域</label><div style="font-size:12px;color:var(--text-2);border:1px solid var(--border);border-radius:3px;padding:7px 10px;background:var(--bg)">${_lockDom}<span style="font-size:10px;color:var(--text-3);margin-left:6px">本领域账号：新建老师自动归属本领域，负责专业在下方选择</span></div></div>` : `<div class="form-group" style="border:1px solid var(--accent);border-radius:3px;padding:8px;background:var(--bg)">
        <label class="form-label" style="color:var(--accent)">隶属领域（可多选，决定"哪个领域账号能在老师管理里看到/编辑这个老师"）</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="new_teacher_managed">
          ${DOMAINS.filter(d=>!teacherMultiDoms()||teacherMultiDoms().includes(d.label)).map(d=>`<div class="filter-chip" data-value="${d.label}" onclick="toggleChip(this)" style="padding:4px 10px">${d.label}</div>`).join('')}
        </div>
        <div style="font-size:9px;color:var(--text-3);margin-top:4px">留空则默认用下方"负责领域"。这是"归谁管"，和下方"能看到/教什么"分开。</div>
      </div>
      <div class="form-group">
        <label class="form-label">负责领域（可多选，老师自己页面能看到的领域；选后下方展开对应专业）</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px" id="new_teacher_domains">
          ${DOMAINS.filter(d=>!teacherMultiDoms()||teacherMultiDoms().includes(d.label)).map(d=>`<div class="filter-chip" data-value="${d.label}" onclick="toggleDomainChip(this)" style="padding:4px 10px">${d.label}</div>`).join('')}
        </div>
      </div>`}
      <div class="form-group">
        <label class="form-label">负责专业（可多选，按已选领域展开）</label>
        <div id="new_teacher_majors" style="min-height:20px"></div>
      </div>
      `,10)}
      ${tsecWrap('features','老师端功能',`
        <div>
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
          <!-- student_mgmt row -->
          <div style="padding:10px">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;margin-bottom:8px;white-space:nowrap"><input type="checkbox" id="perm_student_mgmt" style="accent-color:var(--accent);flex-shrink:0;width:16px;height:16px;min-width:16px">学生管理</label>
            <div style="font-size:10px;color:var(--text-3);margin-bottom:8px;margin-left:20px">开启后老师端显示「学生管理」页，按下方勾选的子项提供对应功能</div>
            <label style="display:flex;align-items:center;gap:6px;font-size:10px;cursor:pointer;margin:0 0 8px 20px;color:#8a5010"><input type="checkbox" id="perm_guaranteed_only" style="accent-color:#8a5010;width:14px;height:14px">🎓 仅保录学生（勾选后此老师在学生管理里只能看到保录学生，看不到其他学生）</label>
            <div style="margin-left:20px;margin-bottom:8px">
              <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">可用的子项</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px" id="perm_student_mgmt_items">
                ${[
              ['progress','考学进度'],['meetings','面谈查询'],['records_view','出席・作业 查看'],['records_entry','出席 登记'],['monthly','月度学习情况'],['profile','学生档案录入'],['profile_edit','档案修改（留痕，admin可恢复）'],
            ].map(([k,v])=>(k==='records_view'?'<span style="font-size:10px;color:var(--text-3);align-self:center;margin-left:4px">出席・作业：</span>':'')+`<div class="filter-chip" data-value="${k}" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">${v}</div>`).join('')}
              </div>
            </div>
            <div style="margin-left:20px">
              <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">可见的专业（适用于全部三个子项；不选则默认按该老师自身的专业显示，老师档案无专业时全部可见）</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px" id="perm_student_majors">
                ${chipFold(majorFilterKeys().map(m=>({on:false,html:`<div class="filter-chip" data-value="${m}" onclick="toggleChip(this)" style="padding:3px 9px;font-size:10px">${majorLabel(m)}</div>`})))}
              </div>
            </div>
          </div>
          <!-- admission_query row -->
          <div style="padding:10px">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;margin-bottom:8px;white-space:nowrap"><input type="checkbox" id="perm_admission_query" style="accent-color:var(--accent);flex-shrink:0;width:16px;height:16px;min-width:16px">出願数据查询</label>
            <div style="font-size:10px;color:var(--text-3);margin-bottom:8px;margin-left:20px">开启后可在老师端查看出願学校数据库（只读）</div>
            <div style="margin-left:20px">
              <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">可查看的专业（不选则只能查看该老师自己负责的专业）</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px" id="perm_admission_majors"></div>
              <div id="perm_admission_removed" style="font-size:10px;color:var(--text-3);margin-top:4px"></div>
            </div>
          </div>
        </div>
      `,0)}
          <!-- 营业功能大类 row（仅 admin/中枢可见；营业管理归中枢，领域端不显示） -->
          ${(!ACCESS_KEY||ACCESS_KEY.is_admin)?tsecWrap('sales','营业功能',`<div style="padding:10px" id="sales_perm_block">
            <div style="font-size:11px;font-weight:600;margin-bottom:6px">💼 营业功能（按需勾选子项 · 中枢管理）</div>
            <div style="margin-left:4px;display:flex;flex-direction:column;gap:6px">
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_promo" style="accent-color:var(--accent);width:15px;height:15px">宣传相关<span style="font-size:9px;color:var(--text-3)">专业/讲师/课程介绍与当期课程表，含对外分享链接</span></label>
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_progress_plan" style="accent-color:var(--accent);width:15px;height:15px">进度规划<span style="font-size:9px;color:var(--text-3)">咨询学生考学规划生成，可打印 PDF</span></label>
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_lect_info" style="accent-color:var(--accent);width:15px;height:15px">讲师信息查询<span style="font-size:9px;color:var(--text-3)">内部检索讲师档案，可切换展示卡片给客户看/截图</span></label>
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_vip_sales" style="accent-color:var(--accent);width:15px;height:15px">VIP营业规划<span style="font-size:9px;color:var(--text-3)">看到全部 VIP 框架模板，可转分享给上课老师（营业角色）</span></label>
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_promo_pack" style="accent-color:var(--accent);width:15px;height:15px">宣传资料整合<span style="font-size:9px;color:var(--text-3)">把出愿学校/学科介绍/进度规划/讲师卡片/VIP方案合成一份完整 PDF</span></label>
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_promo_pricing" style="accent-color:var(--accent);width:15px;height:15px">课程方案（含价格）<span style="font-size:9px;color:var(--text-3)">在宣传相关里给学生配带价格的课程方案并加入资料；价目在中枢『💴 价目』维护；需同时勾选「宣传相关」</span></label>
              <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="perm_success_cases" style="accent-color:var(--accent);width:15px;height:15px">合格案例（填写）<span style="font-size:9px;color:var(--text-3)">在宣传相关里新建、修改合格案例（只能改自己负责的领域/专业）；不勾也能浏览已发布的案例，需同时勾选「宣传相关」</span></label>
            </div>
          </div>`,0):''}
      ${tsecWrap('homework','作业批改分配',`
          <!-- homework row -->
          <div style="padding:10px;border-bottom:1px solid var(--border-light)">
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;margin-bottom:8px;white-space:nowrap"><input type="checkbox" id="perm_homework" style="accent-color:var(--accent);flex-shrink:0;width:16px;height:16px;min-width:16px">批改作业</label>
            <div style="font-size:10px;color:var(--text-3);margin-bottom:8px;margin-left:20px">开启后可在老师端查看并批改作业；只看得到下面分配给他的作业（两种方式可同时开启）</div>
            <div style="margin-left:20px" id="perm_hw_assign"></div>
          </div>
      `,0)}
      ${isHubAdminUser()&&!_isDom?tsecWrap('resource','资源管理权限','<div id="tf_resource_box"></div>',10)+tsecWrap('manager','负责人（管理范围）','<div id="tf_manager_box"></div>',10):''}
      <div style="display:flex;align-items:center;gap:6px;margin:4px 0 10px"><div class="filter-chip${_tsecShowAll?' active':''}" onclick="tsecShowAllToggle(this)" style="padding:3px 10px;font-size:10px">显示全部选项</div><span style="font-size:10px;color:var(--text-3)">打开后不管类型，所有区块都显示（隐藏的区块里原有设置照样保存）</span></div>
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
  hwaInit({});   // 作业批改分配区（新建老师：默认都不开）
  setTeacherTags([]); tfFormReset();
}


// ── 作业批改分配（老师编辑框）──
// ① homework_own_sessions：自己担当的单回（按 session_teacher / teacher 精确到单回）
// ② homework_course_ids：负责整个课程（按 course_id；列出「布置作业：是」的课 ∪ 有单回出了题的课；学部美术 = 作品收集）
// 旧设置 homework_courses（课程名）：打开时按名字换成当期同名课程，保存后删除
let hwaOwn = false, hwaCoursesOn = false, hwaIds = new Set(), hwaAllPeriods = false, hwaSearch = '', hwaNotice = '';
let hwaDom = '', hwaClass = '', hwaMajor = '';   // 筛选：领域（''=全部）/ 班级 / 专业
let hwaData = null;   // { courses:[{id,name,teacher,pkey,hwN,first,domain,majors,classIds,art,hwOn}], cur, next, curM, nextM }
function hwaPeriodKeys() {
  const order = ['1月期', '4月期', '7月期', '10月期'];
  const y = new Date().getFullYear(), cur = currentPeriodKey(), i = order.indexOf(cur);
  const now = new Date(), nm = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { cur: `${y}年${cur}`, next: `${i === 3 ? y + 1 : y}年${order[(i + 1) % 4]}`,
    curM: `${now.getFullYear()}年${now.getMonth() + 1}月`, nextM: `${nm.getFullYear()}年${nm.getMonth() + 1}月` };
}
async function hwaEnsureData() {
  if (hwaData) return hwaData;
  const [sess, crs] = await Promise.all([
    sbAll('/rest/v1/course_sessions?homework_questions=not.is.null&select=course_id,homework_questions').catch(() => []),
    sbAll('/rest/v1/courses?select=id,name,teacher,period,period_override,first_session_date,domain,major,class_ids,member_mode,homework_enabled').catch(() => []),
    (typeof loadClasses === 'function' ? loadClasses().catch(() => []) : Promise.resolve([])),
  ]);
  const hwN = {};
  (sess || []).forEach(x => {
    const q = x.homework_questions;
    const has = Array.isArray(q) ? q.length : !!(q && Array.isArray(q.levels) && q.levels.length);
    if (has && x.course_id) hwN[x.course_id] = (hwN[x.course_id] || 0) + 1;
  });
  const courses = (crs || []).filter(c => scopeCourse(c)).filter(c => hwN[c.id] || c.homework_enabled === true).map(c => {
    const majors = Array.isArray(c.major) ? c.major : (c.major ? [c.major] : []);
    const dom = c.domain || majors.map(m => MAJOR_DOMAIN[m] || (MAJOR_GROUPS[m] ? MAJOR_DOMAIN[MAJOR_GROUPS[m][0]] : '')).find(Boolean) || '其他';
    return {
      id: c.id, name: c.name || '', teacher: c.teacher || '', hwN: hwN[c.id] || 0, first: c.first_session_date || '',
      pkey: c.first_session_date ? periodKeyOf(c) : '未排期', domain: dom, majors, classIds: courseClassIds(c),
      art: isGakubuArtCourse(c), hwOn: c.homework_enabled === true,
    };
  }).sort((a, b) => b.first.localeCompare(a.first) || a.name.localeCompare(b.name, 'zh'));
  hwaData = Object.assign({ courses }, hwaPeriodKeys());
  return hwaData;
}
// 打开老师编辑框 / 新建时调用：p = 老师的 permissions，t = 老师（用来默认选中他所属的领域）
function hwaInit(p, t) {
  p = p || {};
  hwaOwn = !!p.homework_own_sessions;
  hwaIds = new Set((p.homework_course_ids || []).map(String));
  hwaCoursesOn = hwaIds.size > 0;
  hwaAllPeriods = false; hwaSearch = ''; hwaNotice = ''; hwaClass = ''; hwaMajor = '';
  const lock = viewLockDomain();
  hwaDom = lock || ((t && ((t.managed_by || [])[0] || (t.domains || [])[0])) || '');
  const oldNames = (p.homework_courses || []).filter(Boolean);
  renderHomeworkAssign();
  if (oldNames.length || hwaCoursesOn) {
    hwaEnsureData().then(d => {
      if (oldNames.length) {
        const hit = [], miss = [];
        oldNames.forEach(n => {
          const cs = d.courses.filter(c => c.name.trim() === String(n).trim() && c.pkey === d.cur);
          if (cs.length) cs.forEach(c => hwaIds.add(String(c.id))); else miss.push(n);
          if (cs.length) hit.push(n);
        });
        hwaCoursesOn = hwaCoursesOn || hwaIds.size > 0;
        hwaNotice = `已从旧设置（按课程名）转换，请确认后保存${hit.length ? `：找到当期同名课程 ${hit.length} 门` : ''}${miss.length ? `；当期找不到的：${miss.join('、')}` : ''}`;
      }
      renderHomeworkAssign();
    });
  }
}
function renderHomeworkCoursesChips(selected) { hwaInit({ homework_courses: selected || [] }); }   // 兼容旧调用
function renderHomeworkAssign() {
  const wrap = document.getElementById('perm_hw_assign'); if (!wrap) return;
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const js = v => esc(String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const chip = (on, label, fn) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${fn}" style="padding:3px 10px;font-size:10px">${label}</div>`;
  let h = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
    ${chip(hwaOwn, '① 自己上课的单回', 'hwaOwn=!hwaOwn;renderHomeworkAssign()')}
    ${chip(hwaCoursesOn, '② 负责整个课程' + (hwaIds.size ? `（${hwaIds.size}）` : ''), 'hwaCoursesOn=!hwaCoursesOn;renderHomeworkAssign()')}
  </div>
  <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">${hwaOwn ? '① 这位老师担当的单回（单回明细里的担当老师）上的作业，自动分给他批改；同一门课里别的老师上的回次不算。学部美术课：担当老师可批改这门课的作品收集。' : ''}${!hwaOwn && !hwaCoursesOn ? '两种都不开：老师端看不到任何作业。' : ''}</div>`;
  if (hwaNotice) h += `<div style="font-size:10px;color:var(--warn,#b8860b);background:#fff8e6;border:1px solid #e8d4a0;border-radius:3px;padding:4px 8px;margin-bottom:6px">${esc(hwaNotice)}</div>`;
  if (hwaCoursesOn) {
    if (!hwaData) { h += '<div style="font-size:10px;color:var(--text-3)">课程读取中…</div>'; wrap.innerHTML = h; hwaEnsureData().then(renderHomeworkAssign); return; }
    const d = hwaData;
    const byId = {}; d.courses.forEach(c => byId[c.id] = c);
    const sel = [...hwaIds];
    h += `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">${sel.length ? sel.map(id => {
      const c = byId[id];
      return `<span style="font-size:10px;background:var(--accent);color:#fff;border-radius:10px;padding:2px 4px 2px 9px;display:inline-flex;align-items:center;gap:4px">${esc(c ? c.name + ' · ' + c.pkey : '（课程已删除）' + id)}<span onclick="hwaIds.delete('${js(id)}');renderHomeworkAssign()" style="cursor:pointer;padding:0 4px">✕</span></span>`;
    }).join('') + `<span onclick="if(confirm('移除全部已选课程？')){hwaIds.clear();renderHomeworkAssign()}" style="font-size:10px;color:var(--danger);cursor:pointer;align-self:center">全部移除</span>` : '<span style="font-size:10px;color:var(--text-3)">还没选课程，在下面点选</span>'}</div>`;
    // ── 筛选：先领域，再班级 / 专业 / 期（月）/ 搜索 ──
    const lock = viewLockDomain();
    if (lock) hwaDom = lock;
    const order = DOMAINS.map(x => x.label);
    const doms = [...new Set(d.courses.map(c => c.domain))].sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    if (!lock && hwaDom && !doms.includes(hwaDom)) hwaDom = '';
    const inDom = d.courses.filter(c => !hwaDom || c.domain === hwaDom);
    const clsIds = [...new Set(inDom.flatMap(c => c.classIds))];
    const clsName = id => { const c = (typeof classById === 'function') ? classById(id) : null; return c ? c.name : id; };
    const majorKeys = [...new Set(inDom.flatMap(c => c.majors))].filter(Boolean);
    if (hwaClass && !clsIds.includes(hwaClass)) hwaClass = '';
    if (hwaMajor && !majorKeys.includes(hwaMajor)) hwaMajor = '';
    const artDom = hwaDom ? isGakubuArtDomain(hwaDom) : null;   // null = 全部领域（混合）
    const recentLabel = artDom === true ? '本月＋下个月' : artDom === false ? '当期＋下一期' : '当期 / 本月起';
    const isRecent = c => c.art ? (c.pkey === d.curM || c.pkey === d.nextM) : (c.pkey === d.cur || c.pkey === d.next);
    const kw = hwaSearch.trim().toLowerCase();
    let list = inDom.filter(c => hwaAllPeriods || isRecent(c));
    if (hwaClass) list = list.filter(c => c.classIds.includes(hwaClass));
    if (hwaMajor) list = list.filter(c => c.majors.includes(hwaMajor));
    if (kw) list = list.filter(c => (c.name + ' ' + c.teacher + ' ' + c.pkey).toLowerCase().includes(kw));
    const groups = {};
    list.forEach(c => (groups[c.pkey] = groups[c.pkey] || []).push(c));
    const keys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    const row = (label, inner) => `<div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;margin-bottom:5px"><span style="font-size:10px;color:var(--text-3);min-width:28px">${label}</span><div style="display:flex;gap:4px;flex-wrap:wrap">${inner}</div></div>`;
    if (!lock && doms.length) h += row('领域', chip(!hwaDom, '全部', "hwaDom='';renderHomeworkAssign()") + doms.map(x => chip(hwaDom === x, esc(x), `hwaDom='${js(x)}';hwaClass='';hwaMajor='';renderHomeworkAssign()`)).join(''));
    if (clsIds.length) h += row('班级', chipFold([{ on: !hwaClass, html: chip(!hwaClass, '全部', "hwaClass='';renderHomeworkAssign()") }].concat(clsIds.map(id => ({ on: hwaClass === id, html: chip(hwaClass === id, esc(clsName(id)), `hwaClass='${js(id)}';renderHomeworkAssign()`) })))));
    if (majorKeys.length > 1) h += row('专业', chipFold([{ on: !hwaMajor, html: chip(!hwaMajor, '全部', "hwaMajor='';renderHomeworkAssign()") }].concat(majorKeys.map(m => ({ on: hwaMajor === m, html: chip(hwaMajor === m, esc(majorLabel(m)), `hwaMajor='${js(m)}';renderHomeworkAssign()`) })))));
    h += `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:5px">
      <input id="hwa_search" value="${esc(hwaSearch)}" placeholder="搜索课程名 / 老师" oninput="hwaSearch=this.value;renderHomeworkAssign();const e=document.getElementById('hwa_search');e.focus();e.setSelectionRange(e.value.length,e.value.length)" style="flex:1;min-width:140px;font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--surface);font-family:inherit">
      ${chip(!hwaAllPeriods, recentLabel, 'hwaAllPeriods=false;renderHomeworkAssign()')}${chip(hwaAllPeriods, artDom === true ? '全部月' : '全部期', 'hwaAllPeriods=true;renderHomeworkAssign()')}
    </div>
    <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border-light);border-radius:3px;background:var(--surface)">
      ${keys.length ? keys.map(k => `<div style="font-size:10px;font-weight:600;color:var(--text-3);background:var(--bg);padding:3px 8px;position:sticky;top:0">${esc(k)}${k === d.cur || k === d.curM ? (k === d.curM ? '（本月）' : '（当期）') : k === d.next ? '（下一期）' : k === d.nextM ? '（下个月）' : ''}</div>` + groups[k].map(c => {
        const on = hwaIds.has(String(c.id));
        const tag = c.hwN ? `作业 ${c.hwN} 回` : c.art ? '作品收集' : '<span style="opacity:.6">布置作业 · 未出题</span>';
        return `<div onclick="hwaToggle('${js(c.id)}')" style="cursor:pointer;display:flex;gap:8px;align-items:center;padding:5px 8px;border-bottom:1px solid var(--border-light);font-size:11px;background:${on ? 'var(--accent-light,#f5ede3)' : ''};${on ? 'font-weight:600;color:var(--accent)' : ''}">
          <span style="flex:1;min-width:0">${esc(c.name)} <span style="font-weight:400;color:var(--text-3)">· ${esc(c.pkey)} · ${esc(c.teacher || '—')}</span></span>
          <span style="font-size:10px;color:var(--text-3);white-space:nowrap">${tag}</span>
          <span style="font-size:10px;white-space:nowrap">${on ? '已选' : ''}</span>
        </div>`;
      }).join('')).join('') : `<div style="font-size:11px;color:var(--text-3);padding:12px;text-align:center">${kw || hwaClass || hwaMajor ? '无匹配' : '这个范围内没有设置了布置作业的课程'}${hwaAllPeriods ? '' : '（可切换「全部」）'}</div>`}
    </div>`;
  }
  wrap.innerHTML = h;
}
function hwaToggle(id) { id = String(id); if (hwaIds.has(id)) hwaIds.delete(id); else hwaIds.add(id); renderHomeworkAssign(); }


// chip 折叠辅助：程序点亮 chip 后，把含已选 chip 的「更多」自动展开；重绘时保持原来的展开状态
function admFoldSync(root){
  (root||document).querySelectorAll('.cf-more').forEach(w=>{
    if(w.style.display==='none' && w.querySelector('.filter-chip.active')){
      const b=w.parentNode.querySelector('.cf-btn'); if(b) chipFoldToggle(b);
    }
  });
}
function admKeepFold(box,fn){
  const open=box?[...box.querySelectorAll('.cf-more')].map(w=>w.style.display!=='none'):[];
  fn();
  if(box) box.querySelectorAll('.cf-more').forEach((w,i)=>{ if(open[i]){ const b=w.parentNode.querySelector('.cf-btn'); if(b) chipFoldToggle(b); } });
  admFoldSync(box);
}
function toggleChip(el){
  el.classList.toggle('active');
  if(el.closest && el.closest('#new_teacher_managed,#new_teacher_majors')) renderPermAdmMajors();   // 老师所在领域变了，出愿专业清单跟着变
}
// ── 老师权限「出願数据查询」的可查看专业：只列老师所在领域的出愿专业 ──
let _admSel=new Set();   // 当前勾选（含可能不属于本领域的旧数据，保存时才清掉）
function admFormDomains(){
  const _isDom=(typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin && !!viewLockDomain());
  if(_isDom) return [viewLockDomain()];
  const mb=[...document.querySelectorAll('#new_teacher_managed .filter-chip.active')].map(c=>c.dataset.value);
  if(mb.length) return [...new Set(mb)];
  const ms=[...document.querySelectorAll('#new_teacher_majors .filter-chip.active')].map(c=>c.dataset.value);
  return [...new Set(ms.map(m=>MAJOR_DOMAIN[m]).filter(Boolean))];
}
function admListedKeys(){
  const doms=admFormDomains();
  return Object.keys(ADMISSION_MAJORS).filter(k=>doms.includes(admissionMajorDomain(k)));
}
function admSelectedForSave(){
  if(!admFormDomains().length) return [..._admSel];   // 还没定领域：原样保留，不误清
  const ok=new Set(admListedKeys());
  return [..._admSel].filter(k=>ok.has(k));
}
function renderPermAdmMajors(){
  const box=document.getElementById('perm_admission_majors'); if(!box) return;
  const doms=admFormDomains(), keys=admListedKeys();
  const rm=document.getElementById('perm_admission_removed');
  if(parseTeacherTags().includes('营业老师')){
    box.innerHTML='<div style="font-size:11px;color:var(--accent)">营业老师：可查看全部出愿数据</div>'+(keys.length?'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;opacity:.4;pointer-events:none">'+keys.map(k=>`<div class="filter-chip${_admSel.has(k)?' active':''}" style="padding:3px 9px;font-size:10px">${escTM(ADMISSION_MAJORS[k])}</div>`).join('')+'</div>':'');
    if(rm) rm.textContent=''; return;
  }
  if(!doms.length){ box.innerHTML='<div style="font-size:11px;color:var(--text-3)">请先选择该老师的隶属领域或负责专业，这里再列出对应领域的出愿专业</div>'; if(rm) rm.textContent=''; return; }
  if(!keys.length){ box.innerHTML='<div style="font-size:11px;color:var(--text-3)">'+escTM(doms.join('、'))+' 暂无出愿专业</div>'; }
  else {
    const allOn=keys.every(k=>_admSel.has(k));
    box.innerHTML=chipFold([{on:allOn,html:`<div class="filter-chip${allOn?' active':''}" onclick="admToggleAll()" style="padding:3px 9px;font-size:10px">全选</div>`}].concat(
      keys.map(k=>({on:_admSel.has(k),html:`<div class="filter-chip${_admSel.has(k)?' active':''}" onclick="admToggleOne('${k}')" style="padding:3px 9px;font-size:10px">${escTM(ADMISSION_MAJORS[k])}</div>`}))));
  }
  if(rm){
    const ok=new Set(keys), gone=[..._admSel].filter(k=>!ok.has(k));
    rm.textContent=gone.length?'已移除不属于本领域的专业：'+gone.map(k=>ADMISSION_MAJORS[k]||k).join('、')+'（保存后清掉）':'';
  }
}
function admToggleOne(k){ if(_admSel.has(k)) _admSel.delete(k); else _admSel.add(k); admKeepFold(document.getElementById('perm_admission_majors'),renderPermAdmMajors); }
function admToggleAll(){
  const keys=admListedKeys(); if(!keys.length) return;
  if(keys.every(k=>_admSel.has(k))){ keys.forEach(k=>_admSel.delete(k)); }
  else {
    if(!confirm('要让这位老师查看〈'+admFormDomains().join('、')+'〉的全部出愿数据吗？')) return;
    keys.forEach(k=>_admSel.add(k));
  }
  renderPermAdmMajors();
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
  setTeacherTags([]);
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
    {const _e=document.getElementById('perm_promo_pack'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_promo_pricing'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_success_cases'); if(_e)_e.checked=false;}
  document.getElementById('perm_homework').checked=false;
  document.getElementById('perm_admission_query').checked=false;
  _admSel=new Set(); renderPermAdmMajors();
  renderHomeworkCoursesChips([]);
  tfFormReset();
}
function openTeacherManager(){
  hwaData=null;   // 作业分配的课程列表每次打开重新读取
  // reset add form
  document.getElementById('new_teacher_name').value='';
  document.querySelectorAll('#new_teacher_stafftype .filter-chip').forEach(c=>c.classList.remove('active'));
  if(document.getElementById('new_teacher_dept_wrap')) document.getElementById('new_teacher_dept_wrap').style.display='none';
  if(document.getElementById('new_teacher_department')) document.getElementById('new_teacher_department').value='';
  document.getElementById('new_teacher_notes').value='';
  setTeacherTags([]);
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
    {const _e=document.getElementById('perm_promo_pack'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_promo_pricing'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_success_cases'); if(_e)_e.checked=false;}
  document.getElementById('perm_homework').checked=false;
  document.getElementById('perm_admission_query').checked=false;
  _admSel=new Set(); renderPermAdmMajors();
  renderHomeworkCoursesChips([]);
  renderTeacherList();
  document.getElementById('teacherManagerModal').classList.add('open');
}

// ── 标签：管理职位 / 执行角色 取代原来的「功能标签」；其他标签（自由填写）只用于搜索 ──
// 保存时为了兼容还没改的老代码，同时把 专业课老师 / 营业老师 写回 tags，旧的职能标签全部去掉
const TEACHER_FUNC_TAGS=['专业课老师','营业老师','全学科负责人','学科负责人','任课讲师','学科TA','全学科TA','TA'];
const TEACHER_LEGACY_DUTY_TAGS=['全学科负责人','学科负责人','任课讲师','学科TA','全学科TA','TA'];
let _tfFuncTags=new Set(), _tfSalesPrev=false;
let _tfPos='', _tfRoles=[], _tfHr=null;   // 表单里选的管理职位 / 执行角色 / 班主任范围草稿 {domains,majors,classIds}
function tfHasRoleUI(){ return !!document.getElementById('tf_roles_chips'); }
function parseOtherTags(){
  const raw=document.getElementById('new_teacher_tags')?.value||'';
  return [...new Set(raw.split(/[,，、\s]+/).map(x=>x.trim()).filter(Boolean))];
}
// 按职位 / 角色推出的兼容标签
function tfCompatTags(){
  const t=[]; if(_tfRoles.includes('senmon')) t.push('专业课老师'); if(_tfPos==='sales') t.push('营业老师'); return t;
}
// 保存用：其他标签 + 兼容标签；没选职位 / 角色的老师，原有的「专业课老师 / 营业老师」标签原样保留
function parseTeacherTags(){
  if(!tfHasRoleUI()) return [...new Set([..._tfFuncTags,...parseOtherTags()])];
  const sel=!!_tfPos||_tfRoles.length;
  const keep=[..._tfFuncTags].filter(g=>!sel||(g!=='专业课老师'&&g!=='营业老师'));
  return [...new Set([...keep,...parseOtherTags().filter(g=>!TEACHER_LEGACY_DUTY_TAGS.includes(g)),...tfCompatTags()])];
}
// 回填 / 清空：有职位 / 角色选择区时，旧的功能标签不进输入框（专业课老师 / 营业老师暂存，职位 / 角色都没选时保留）
function setTeacherTags(arr){
  arr=arr||[];
  if(tfHasRoleUI()){
    _tfFuncTags=new Set(arr.filter(g=>g==='专业课老师'||g==='营业老师'));
    const inp=document.getElementById('new_teacher_tags');
    if(inp) inp.value=arr.filter(g=>!TEACHER_FUNC_TAGS.includes(g)).join('、');
  } else {   // 领域账号看不到职位 / 角色：功能标签原样保留
    _tfFuncTags=new Set(arr.filter(g=>TEACHER_FUNC_TAGS.includes(g)));
    const inp=document.getElementById('new_teacher_tags');
    if(inp) inp.value=arr.filter(g=>!TEACHER_FUNC_TAGS.includes(g)).join('、');
  }
  senmonChipSync();
}
function senmonChipSync(){
  const now=parseTeacherTags().includes('营业老师');
  if(now!==_tfSalesPrev){ _tfSalesPrev=now; if(typeof renderPermAdmMajors==='function') renderPermAdmMajors(); }   // 营业决定出愿专业可选范围
}

// ── 角色模板：默认功能从 role_templates 表读，读不到退回 seed/role_templates_seed.json ──
let _roleTpl=null, _roleTplP=null;
function roleTplEnsure(){
  if(_roleTpl) return Promise.resolve(_roleTpl);
  if(_roleTplP) return _roleTplP;
  _roleTplP=(async()=>{
    let rows=[];
    try{ rows=await sbAll('/rest/v1/role_templates?select=*&order=sort.asc'); }catch(e){ rows=[]; }
    if(!rows||!rows.length){
      try{ const r=await fetch('../seed/role_templates_seed.json',{cache:'no-store'}); if(r.ok) rows=await r.json(); }catch(e){ rows=[]; }
    }
    _roleTpl={}; (rows||[]).forEach(r=>{ _roleTpl[r.key]=r; });
    _roleTplP=null; return _roleTpl;
  })();
  return _roleTplP;
}
// 默认功能 → 一组「标记」字符串，方便做并集 / 差集 / 和表单比较
function roleTokens(def){
  const out=new Set(); if(!def) return out;
  const p=def.permissions||{};
  Object.keys(p).forEach(k=>{
    const v=p[k];
    if(v===true) out.add('p:'+k);
    else if(Array.isArray(v)) v.forEach(x=>out.add(k+':'+x));
    else if(k==='schedule'&&v) out.add('schedule:'+v);
  });
  (def.resource_perms||[]).forEach(x=>out.add('res:'+x));
  return out;
}
// 职位 ∪ 角色 的默认（正社员再加 时间槽·出勤）
function roleDefaultTokens(pos,roles,staffType){
  const tpl=_roleTpl||{}, out=new Set();
  [pos].concat(roles||[]).filter(Boolean).forEach(k=>{ roleTokens((tpl[k]||{}).defaults).forEach(x=>out.add(x)); });
  if(staffType==='正社员'){ out.add('p:slots'); out.add('slot_types:attendance'); }
  return out;
}
const TF_P_LABEL={booking:'预约管理',slots:'时间槽设定',student_mgmt:'学生管理',admission_query:'出願数据查询',homework:'批改作业',promo:'宣传相关',progress_plan:'进度规划',lect_info:'讲师信息查询',vip_sales:'VIP营业规划',promo_pack:'宣传资料整合',promo_pricing:'课程方案（含价格）',success_cases:'合格案例（填写）'};
const TF_SUB_LABEL={booking_types:{daily:'日常',plan:'计划书',mock:'模拟面试',vip:'VIP'},slot_types:{daily:'日常',plan:'计划书',mock:'模拟面试',vip:'VIP',attendance:'出勤'},student_mgmt_items:{progress:'考学进度',meetings:'面谈查询',records_view:'出席・作业 查看',records_entry:'出席 登记',monthly:'月度学习情况',profile:'学生档案录入',profile_edit:'档案修改'}};
const TF_SUB_PREFIX={booking_types:'预约·',slot_types:'时间槽·',student_mgmt_items:'学生管理·'};
function roleTokenLabel(tk){
  const i=tk.indexOf(':'), k=tk.slice(0,i), v=tk.slice(i+1);
  if(k==='p') return TF_P_LABEL[v]||v;
  if(k==='res'){ const r=(typeof RESOURCE_PERM_DEFS!=='undefined'?RESOURCE_PERM_DEFS:[]).find(x=>x[0]===v); return r?r[1]:v; }
  if(k==='schedule') return v==='timetable'?'我的课表':'排班+课表';
  return (TF_SUB_PREFIX[k]||'')+((TF_SUB_LABEL[k]||{})[v]||v);
}
// 读表单当前开了哪些（和 roleTokens 同一套标记）
function tfFormTokens(){
  const out=new Set(), $=id=>document.getElementById(id);
  Object.keys(TF_P_LABEL).forEach(k=>{ const e=$('perm_'+k); if(e&&e.checked) out.add('p:'+k); });
  [['booking_types','perm_booking_types'],['slot_types','perm_slot_types'],['student_mgmt_items','perm_student_mgmt_items']].forEach(([k,box])=>{
    document.querySelectorAll('#'+box+' .filter-chip.active').forEach(c=>out.add(k+':'+c.dataset.value));
  });
  const sm=$('perm_schedule_mode')?.value; if(sm){ out.add('schedule:'+sm); if(sm==='full') out.add('schedule:timetable'); }
  if(_mgrDraft) _mgrDraft.perms.forEach(x=>out.add('res:'+x));
  return out;
}
// 开 / 关表单里的某一项（只用于带出 / 关掉角色默认）
function tfSetToken(tk,on){
  const i=tk.indexOf(':'), k=tk.slice(0,i), v=tk.slice(i+1), $=id=>document.getElementById(id);
  if(k==='p'){ const e=$('perm_'+v); if(e) e.checked=on; return; }
  if(k==='res'){ if(!_mgrDraft) return; const a=_mgrDraft.perms, j=a.indexOf(v); if(on&&j<0) a.push(v); if(!on&&j>=0) a.splice(j,1); return; }
  if(k==='schedule'){
    const e=$('perm_schedule_mode'); if(!e) return;
    if(on){ if(!e.value||(e.value==='timetable'&&v==='full')) e.value=v; }
    else if(e.value===v) e.value='';
    return;
  }
  const box={booking_types:'perm_booking_types',slot_types:'perm_slot_types',student_mgmt_items:'perm_student_mgmt_items'}[k]; if(!box) return;
  document.querySelectorAll('#'+box+' .filter-chip').forEach(c=>{ if(c.dataset.value===v) c.classList.toggle('active',on); });
}
function tfRoleState(){ return {pos:_tfPos,roles:_tfRoles.slice(),staff:(typeof tsecCurType==='function'?tsecCurType():'')}; }
function tfRoleDefOf(st){ return roleDefaultTokens(st.pos,st.roles,st.staff); }
const _rdTokensSort=a=>[...a].sort();
// 职位 / 角色 / 类型变了：新增的默认功能带出来；去掉的角色独有的默认功能问了再关
async function tfRolesChanged(prev){
  await roleTplEnsure();
  const now=tfRoleState(), dOld=tfRoleDefOf(prev), dNew=tfRoleDefOf(now), cur=tfFormTokens();
  const toAdd=_rdTokensSort(dNew).filter(x=>!dOld.has(x)&&!cur.has(x));
  const toDrop=_rdTokensSort(dOld).filter(x=>!dNew.has(x)&&cur.has(x));
  if(toAdd.length){
    if(!_tfEditId||confirm('按新角色补齐默认功能？（只会新增，不会关掉你已经开的）\n\n将新增：'+toAdd.map(roleTokenLabel).join('、'))) toAdd.forEach(x=>tfSetToken(x,true));
  }
  if(toDrop.length && confirm('去掉了一个角色。要关掉只属于这个角色的默认功能吗？\n\n将关掉：'+toDrop.map(roleTokenLabel).join('、'))) toDrop.forEach(x=>tfSetToken(x,false));
  tfRolesRender(); tsecApply(); tfMgrRender();
}
function tfPositionClick(k){
  if(tsecCurType()!=='正社员') return;
  const prev=tfRoleState(); _tfPos=(_tfPos===k)?'':k; tfRolesChanged(prev);
}
function tfRoleClick(k){
  const prev=tfRoleState(); const i=_tfRoles.indexOf(k); if(i>=0) _tfRoles.splice(i,1); else _tfRoles.push(k);
  tfRolesChanged(prev);
}
// 类型改了：兼职不能有管理职位；正社员默认带出出勤
function tfStaffTypeChanged(prevStaff){
  if(!tfHasRoleUI()) return;
  const prev={pos:_tfPos,roles:_tfRoles.slice(),staff:prevStaff};
  if(tsecCurType()!=='正社员') _tfPos='';
  tfRolesChanged(prev);
}
// 回填（编辑打开 / 新建重置时）：只回填选择，不动功能勾选
function tfRolesLoad(t){
  _tfPos=(t&&t.position)||''; _tfRoles=((t&&t.roles)||[]).slice();
  const hr=t&&t.role_scope&&t.role_scope.homeroom;
  _tfHr={domains:((hr&&hr.domains)||[]).slice(),majors:((hr&&hr.majors)||[]).slice(),classIds:((hr&&hr.class_ids)||[]).map(String)};
  tfRolesRender();
  if(_tfRoles.includes('homeroom')){ try{ if(typeof loadClasses==='function') loadClasses().then(tfRolesRender); }catch(e){} }
}
function tfHrToggle(field,val){ scopeDraftToggle(_tfHr,field,val); admKeepFold(document.getElementById('tf_role_scope'),tfRolesRender); }
function tfGoSec(k){ const el=document.getElementById('tsec_'+k); if(el){ el.style.display=''; tsecToggle(k,true); el.scrollIntoView({behavior:'smooth',block:'center'}); } }
function tfRolesRender(){
  if(!tfHasRoleUI()) return;
  const isReg=tsecCurType()==='正社员';
  const w=document.getElementById('tf_position_wrap'); if(w) w.style.display=isReg?'':'none';
  document.querySelectorAll('#tf_position_chips .filter-chip').forEach(c=>c.classList.toggle('active',isReg&&c.dataset.pos===_tfPos));
  document.querySelectorAll('#tf_roles_chips .filter-chip').forEach(c=>c.classList.toggle('active',_tfRoles.includes(c.dataset.role)));
  const box=document.getElementById('tf_role_scope'); if(!box) return;
  const link=(k,txt)=>`<a href="javascript:void(0)" onclick="tfGoSec('${k}')" style="color:var(--accent)">${txt}</a>`;
  const parts=[];
  if(isReg&&_tfPos==='lead') parts.push(`<div style="font-size:11px;color:var(--text-2)">负责人：管理范围（领域 / 专业 / 班级可混合）在 ${link('manager','负责人（管理范围）')} 区块设置</div>`);
  if(_tfRoles.includes('senmon')||_tfRoles.includes('ta')) parts.push(`<div style="font-size:11px;color:var(--text-2)">${_tfRoles.includes('senmon')&&_tfRoles.includes('ta')?'专业课老师 / TA':_tfRoles.includes('ta')?'TA':'专业课老师'}：负责专业在 ${link('area','负责领域与专业')} 区块选择${_tfRoles.includes('ta')?'（TA 也可以直接选整个领域）':''}</div>`);
  if(_tfRoles.includes('homeroom')&&_tfHr) parts.push(`<div style="border:1px solid var(--border-light);border-radius:3px;padding:8px;margin-top:4px"><div style="font-size:11px;font-weight:600;margin-bottom:6px">班主任：负责班级（或整个学部领域）</div>${scopePickerHtml(_tfHr,'tfHrToggle')}</div>`);
  box.innerHTML=parts.join('');
}
// 保存用：职位 / 角色 / 班主任范围；没有职位 / 角色选择区（领域账号）或准备 SQL 还没执行且没选 → 返回 {}
function tfRolesCollect(cur){
  if(!tfHasRoleUI()) return {};
  const hasCols=!!cur&&('position' in cur||'roles' in cur);
  if(!hasCols&&!_tfPos&&!_tfRoles.length) return {};
  const keep=Object.assign({},(cur&&cur.role_scope)||{});
  if(_tfRoles.includes('homeroom')&&_tfHr) keep.homeroom={domains:_tfHr.domains,majors:_tfHr.majors,class_ids:_tfHr.classIds};
  else delete keep.homeroom;
  return {position:_tfPos||null,roles:_tfRoles.slice(),role_scope:Object.keys(keep).length?keep:null};
}
// 「和角色默认相比」提示 + 自动勾上的项旁边标「角色默认」
// 职位是负责人却没设管理范围：提示一下（不拦）
function tfLeadScopeOk(mg,cur){
  if(!tfHasRoleUI()||_tfPos!=='lead') return true;
  const ms=('manage_scope' in mg)?mg.manage_scope:(cur&&cur.manage_scope);
  if(managerScopeNonEmpty(ms)) return true;
  return confirm('职位是「负责人」，但还没有设置管理范围。\n负责人需要在「负责人（管理范围）」区块里选领域 / 专业 / 班级，否则老师端不会出现管理模式。\n\n仍然保存吗？');
}
function tfRoleDiffRender(){
  const box=document.getElementById('tf_role_diff');
  document.querySelectorAll('.rd-def').forEach(e=>e.classList.remove('rd-def'));
  if(!box) return;
  if(!_tfPos&&!_tfRoles.length){ box.style.display='none'; return; }
  if(!_roleTpl){ roleTplEnsure().then(tfRoleDiffRender); box.style.display='none'; return; }
  const def=roleDefaultTokens(_tfPos,_tfRoles,tsecCurType()), cur=tfFormTokens();
  const miss=_rdTokensSort(def).filter(x=>!cur.has(x)), extra=_rdTokensSort(cur).filter(x=>!def.has(x));
  def.forEach(tk=>{
    if(!cur.has(tk)) return;
    const i=tk.indexOf(':'), k=tk.slice(0,i), v=tk.slice(i+1); let el=null;
    if(k==='p'){ const e=document.getElementById('perm_'+v); el=e&&e.closest('label'); }
    else if(k==='res'){ el=document.querySelector(`#tf_resource_box .filter-chip[data-res="${v}"]`); }
    else if(k==='schedule'){ el=null; }
    else { const box2={booking_types:'perm_booking_types',slot_types:'perm_slot_types',student_mgmt_items:'perm_student_mgmt_items'}[k]; el=box2&&document.querySelector(`#${box2} .filter-chip[data-value="${v}"]`); }
    if(el) el.classList.add('rd-def');
  });
  const lim=a=>a.slice(0,6).map(roleTokenLabel).join('、')+(a.length>6?` 等 ${a.length} 项`:'');
  const parts=[];
  parts.push(miss.length?`缺 ${miss.length} 项（${lim(miss)}）<a href="javascript:void(0)" onclick="tfFillMissing()" style="color:var(--accent)">［补齐］</a>`:'没有缺的项');
  if(extra.length) parts.push(`多开 ${extra.length} 项（${lim(extra)}）`);
  box.style.display=''; box.innerHTML='和角色默认相比：'+parts.join(' · ');
}
function tfFillMissing(){
  const def=roleDefaultTokens(_tfPos,_tfRoles,tsecCurType()), cur=tfFormTokens();
  def.forEach(x=>{ if(!cur.has(x)) tfSetToken(x,true); });
  tfMgrRender(); tsecRefresh();
}
function escTM(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}

let teacherSearch='';
let teacherTagFilter='';
let teacherDomainFilter='';
let teacherTypeFilter='';
let teacherDeptFilter='';
let teacherPosFilter='';       // 管理职位
let teacherRoleFilter='';      // 执行角色
let teacherFeatureFilter='';   // 开了某项功能（TEACHER_FEATURE_DEFS 的 key）
let teacherExpandedId=null;

// 老师开了哪些功能：[key, 列表简称, 完整名称, 判断(老师,permissions)]；列表行显示 / 功能筛选共用
const TEACHER_FEATURE_DEFS=[
  ['booking','预约','预约管理',(t,p)=>!!p.booking],
  ['slots','时间槽','时间槽设定',(t,p)=>!!p.slots],
  ['schedule','排班/课表','课程排班 / 我的课表',(t,p)=>!!p.schedule],
  ['homework','作业','批改作业',(t,p)=>!!p.homework],
  ['admission_query','出願库','出願数据查询',(t,p)=>!!p.admission_query],
  ['student_mgmt','学生管理','学生管理',(t,p)=>!!p.student_mgmt],
  ['records_entry','出席登记','出席登记',(t,p)=>!!p.student_mgmt&&(p.student_mgmt_items||[]).some(k=>k==='records'||k==='records_entry')],
  ['progress_plan','进度规划','进度规划（营业）',(t,p)=>!!p.progress_plan],
  ['promo','宣传','宣传相关（营业）',(t,p)=>!!p.promo],
  ['lect_info','讲师信息','讲师信息查询（营业）',(t,p)=>!!p.lect_info],
  ['vip_sales','VIP规划','VIP营业规划（营业）',(t,p)=>!!p.vip_sales],
  ['promo_pack','资料整合','宣传资料整合（营业）',(t,p)=>!!p.promo_pack],
  ['promo_pricing','课程方案','课程方案（含价格）',(t,p)=>!!p.promo_pricing],
  ['success_cases','合格案例','合格案例（填写）',(t,p)=>!!p.success_cases],
  ['resource','资源权限','资源管理权限',(t)=>(t.resource_perms||[]).length>0],
  ['manager','负责人','负责人',(t)=>managerScopeNonEmpty(t.manage_scope)],
];
function teacherFeatures(t){ const p=t.permissions||{}; return TEACHER_FEATURE_DEFS.filter(d=>d[3](t,p)); }

function teacherFilteredList(){
  let list=cachedTeachers;
  const isDomainAccount = typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin;
  // 领域端（非admin）：排除带"营业老师""保录老师"标签的人
  if(isDomainAccount){
    list=list.filter(t=>{ const tags=t.tags||[]; return !tags.includes('营业老师') && !tags.includes('保录老师'); });
  }
  // 视角过滤：统一用 teacherInView —— 领域视角严格按 归谁管(managed_by)/负责专业(majors)，
  // 没设 managed_by 的老师只在中枢台出现（不再用"没设也显示"把它们漏进领域视角）
  if(typeof teacherInView==='function'){
    list=list.filter(teacherInView);
  }
  if(teacherTagFilter) list=list.filter(t=>(t.tags||[]).includes(teacherTagFilter));
  if(teacherPosFilter) list=list.filter(t=>t.position===teacherPosFilter);
  if(teacherRoleFilter) list=list.filter(t=>(t.roles||[]).includes(teacherRoleFilter));
  if(teacherFeatureFilter) list=list.filter(t=>teacherFeatures(t).some(d=>d[0]===teacherFeatureFilter));
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
  const allTags=[...new Set(cachedTeachers.flatMap(t=>t.tags||[]))].filter(g=>!TEACHER_LEGACY_DUTY_TAGS.includes(g));
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
    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:8px">
      <span style="font-size:10px;color:var(--text-3)">管理职位：</span>
      <div class="filter-chip ${teacherPosFilter===''?'active':''}" onclick="teacherPosFilter='';renderTeacherList()" style="padding:2px 9px;font-size:10px">全部</div>
      ${TEACHER_POSITIONS.map(([k,v])=>`<div class="filter-chip ${teacherPosFilter===k?'active':''}" onclick="teacherPosFilter='${k}';renderTeacherList()" style="padding:2px 9px;font-size:10px">${v}</div>`).join('')}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:8px">
      <span style="font-size:10px;color:var(--text-3)">执行角色：</span>
      <div class="filter-chip ${teacherRoleFilter===''?'active':''}" onclick="teacherRoleFilter='';renderTeacherList()" style="padding:2px 9px;font-size:10px">全部</div>
      ${TEACHER_ROLES.map(([k,v])=>`<div class="filter-chip ${teacherRoleFilter===k?'active':''}" onclick="teacherRoleFilter='${k}';renderTeacherList()" style="padding:2px 9px;font-size:10px">${v}</div>`).join('')}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:8px">
      <span style="font-size:10px;color:var(--text-3)">功能：</span>
      <select onchange="teacherFeatureFilter=this.value;renderTeacherList()" style="font-size:10px;padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
        <option value="">全部</option>${TEACHER_FEATURE_DEFS.map(d=>`<option value="${d[0]}"${teacherFeatureFilter===d[0]?' selected':''}>${d[2]}</option>`).join('')}
      </select>
    </div>
    ${allTags.length?`<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:8px">
      <span style="font-size:10px;color:var(--text-3)">标签：</span>
      <div class="filter-chip ${teacherTagFilter===''?'active':''}" onclick="teacherTagFilter='';renderTeacherList()" style="padding:2px 9px;font-size:10px">全部</div>
      ${chipFold(allTags.map(g=>({on:teacherTagFilter===g,html:`<div class="filter-chip ${teacherTagFilter===g?'active':''}" onclick="teacherTagFilter='${escTM(g)}';renderTeacherList()" style="padding:2px 9px;font-size:10px">${escTM(g)}</div>`})))}
    </div>`:''}
    <div id="teacherRows"></div>`;
  renderTeacherRows();
}

// 老师列表上的「介绍 x/y」：读一次讲师介绍的简表，之后保存 / 删除介绍时清空重读
let profBrief=null, profBriefLoading=false, profBriefOk=false;
function profBriefLoad(){
  if(profBrief||profBriefLoading) return;
  profBriefLoading=true;
  sbAll('/rest/v1/teacher_profiles?select=id,name,subject,school,keywords,feature,courses').then(r=>{ profBrief=r||[]; profBriefOk=true; }).catch(()=>{ profBrief=[]; profBriefOk=false; }).finally(()=>{ profBriefLoading=false; renderTeacherRows(); });
}
function profBadgeHtml(t){
  if(!isSenmonTeacher(t)) return '';
  if(!profBrief||!profBriefOk) return '';
  const st=teacherProfileStatus(t,profBrief.filter(r=>r.name===t.name));
  const clk=`onclick="event.stopPropagation();profSkipOpen('${t.id}',null)" style="cursor:pointer;`;
  if(!st.length && teacherProfileAllSkipped(t)) return `<span ${clk}font-size:10px;color:var(--text-3);border:1px solid var(--border);border-radius:2px;padding:0 6px;white-space:nowrap" title="负责专业都被设为不需要讲师介绍，点开可恢复">介绍：不需要</span>`;   // 负责专业都被设为「不需要」讲师介绍
  if(!st.length) return `<span title="专业课老师，但还没有设置负责专业" style="font-size:10px;color:var(--warn,#b8860b);border:1px solid var(--warn,#b8860b);border-radius:2px;padding:0 6px;white-space:nowrap">介绍：未设负责专业</span>`;
  const n=st.filter(x=>x.done).length, ok=n===st.length;
  const tip=st.map(x=>x.label+(x.done?' ✓':x.row?'（缺：'+x.missing.join('、')+'）':'（未填）')).join('；');
  return `<span title="${escTM(tip)}" ${clk}font-size:10px;border-radius:2px;padding:0 6px;white-space:nowrap;${ok?'color:var(--ok,#2a9e6a);border:1px solid var(--ok,#2a9e6a)':'color:var(--warn,#b8860b);border:1px solid var(--warn,#b8860b);background:var(--warn-bg,#f8f0d8)'}">介绍 ${n}/${st.length}</span>`;
}
function renderTeacherRows(){
  const box=document.getElementById('teacherRows');
  if(!box) return;
  profBriefLoad();
  const base=location.origin+location.pathname.replace(/\/admin\/.*$/,'/teacher/');
  const list=teacherFilteredList();
  const cnt=document.getElementById('teacherCount');
  if(cnt) cnt.textContent=`${list.length} / ${cachedTeachers.length} 位`;
  box.innerHTML=list.length
    ?`<div style="display:flex;flex-direction:column;gap:6px">
        ${list.map(t=>{
          const p=t.permissions||{};
          const feats=teacherFeatures(t).filter(d=>d[0]!=='manager');
          const featShort=feats.slice(0,4).map(d=>d[1]).join(' · ')+(feats.length>4?` +${feats.length-4}`:'');
          const featTip=feats.map(d=>d[2]).join('、');
          const permsFull=[];
          if(p.booking) permsFull.push(`预约(${(p.booking_types||[]).join('/')||'—'})`);
          if(p.slots) permsFull.push(`时间槽(${(p.slot_types||[]).join('/')||'—'})`);
          if(p.schedule) permsFull.push(p.schedule==='timetable'?'我的课表':'排班+课表');
          if(p.homework) permsFull.push('作业反馈');
          if(p.admission_query) permsFull.push('出願数据库');
          if(p.student_mgmt){const _sm={progress:'考学进度',records:'出席查看/出席登记',records_view:'出席查看',records_entry:'出席登记',meetings:'面谈查询',monthly:'月度学习',profile:'档案录入',profile_edit:'档案修改'};permsFull.push('学生管理('+(((p.student_mgmt_items||[]).map(k=>_sm[k]||k).join('/'))||'—')+')');}
          if(p.progress_plan) permsFull.push('进度规划（营业）');
          if(p.promo) permsFull.push('宣传相关（营业）');
          if(p.lect_info) permsFull.push('讲师信息查询（营业）');
          if(p.promo_pack) permsFull.push('宣传资料整合（营业）');
          if(p.promo_pricing) permsFull.push('课程方案（含价格）');
          if(p.success_cases) permsFull.push('合格案例（填写）');
          const open=teacherExpandedId===t.id;
          const link=`${base}?tid=${encodeURIComponent(t.id)}`;  // 只带 id，不暴露老师真名（真名由老师端按 id 查出）
          return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden">
            <div onclick="teacherExpandedId=teacherExpandedId==='${t.id}'?null:'${t.id}';renderTeacherRows()" style="display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;${open?'background:var(--bg)':''}">
              <span style="font-family:'Noto Serif SC',serif;font-weight:600;font-size:13px;white-space:nowrap">${escTM(t.name)}</span>
              ${t.staff_type?`<span style="font-size:10px;color:var(--text-2);border:1px solid var(--border);border-radius:2px;padding:0 6px;white-space:nowrap">${escTM(t.staff_type)}${t.department?'・'+escTM(t.department):''}</span>`:''}
              <span style="font-size:10px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:26%">${[(t.domains||[]).join('・'),(t.majors||[]).map(m=>MAJORS[m]||m).join('・')].filter(Boolean).join(' · ')||'—'}</span>
              ${(()=>{ const lb=[teacherPositionLabel(t.position)].concat((t.roles||[]).map(teacherRoleLabel)).filter(Boolean).join(' · '); return lb?`<span style="font-size:10px;color:#fff;background:var(--text-2);border-radius:2px;padding:0 6px;white-space:nowrap">${escTM(lb)}</span>`:''; })()}
              ${(t.tags||[]).filter(g=>!TEACHER_FUNC_TAGS.includes(g)||(!t.position&&!(t.roles||[]).length)).map(g=>`<span style="font-size:10px;color:var(--accent);border:1px solid var(--border);border-radius:2px;padding:0 6px;white-space:nowrap">${escTM(g)}</span>`).join('')}
              ${profBadgeHtml(t)}
              ${(()=>{ const m=(_tfTaskTpl&&typeof taskMissingFeatures==='function')?taskMissingFeatures(t,_tfTaskTpl):[]; return m.length?`<span title="${escTM(m.map(x=>x.tpl.requires_label||x.tpl.requires).join('、'))}" style="font-size:10px;color:var(--warn,#b8860b);border:1px solid var(--warn,#b8860b);border-radius:2px;padding:0 6px;white-space:nowrap">⚠ 任务需要开功能 ${m.length}</span>`:''; })()}
              ${managerScopeNonEmpty(t.manage_scope)?`<span title="${escTM(scopeSummary(managerScopeToView(t.manage_scope)))}" style="font-size:10px;color:#fff;background:var(--accent);border-radius:2px;padding:0 6px;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis">负责人：${escTM(scopeSummary(managerScopeToView(t.manage_scope)))}</span>`:''}
              <span title="${escTM(featTip)}" style="font-size:10px;color:var(--text-3);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:30%">${escTM(featShort)||'无权限'}</span>
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
  // profile_skip_majors（任务明细里设的「不需要讲师介绍」）表单里没有，保存时原样带上，不能被冲掉
  const _keep=Array.isArray(prev.profile_skip_majors)?{profile_skip_majors:prev.profile_skip_majors}:{};
  // 营业功能 4 个勾选项仅在 admin/中枢渲染；领域端链接下这些元素不存在，
  // 读取 .checked 会抛错导致「添加/保存老师」点击无反应。缺失时回退到已有值（编辑时不清空）。
  const _chk=(id,fb)=>{ const el=document.getElementById(id); return el?el.checked:(fb||false); };
  return Object.assign(_keep,{
    booking:document.getElementById('perm_booking').checked,
    booking_types:[...document.querySelectorAll('#perm_booking_types .filter-chip.active')].map(c=>c.dataset.value),
    slots:document.getElementById('perm_slots').checked,
    slot_types:[...document.querySelectorAll('#perm_slot_types .filter-chip.active')].map(c=>c.dataset.value),
    vip_content:[...document.querySelectorAll('#perm_vip_content .filter-chip.active')].map(c=>c.dataset.value),
    schedule:(function(){const e=document.getElementById('perm_schedule_mode');return e&&e.value?e.value:false;})(),
    homework:document.getElementById('perm_homework').checked,
    homework_own_sessions:hwaOwn,
    homework_course_ids:hwaCoursesOn?[...hwaIds]:[],   // 旧的 homework_courses（课程名）不再写入，保存即删除
    admission_query:document.getElementById('perm_admission_query').checked,
    admission_majors:admSelectedForSave(),
    promo:_chk('perm_promo',prev.promo),
    lect_info:_chk('perm_lect_info',prev.lect_info),
    progress_plan:_chk('perm_progress_plan',prev.progress_plan),
    vip_sales:_chk('perm_vip_sales',prev.vip_sales),
    promo_pack:_chk('perm_promo_pack',prev.promo_pack),
    promo_pricing:_chk('perm_promo_pricing',prev.promo_pricing),
    success_cases:_chk('perm_success_cases',prev.success_cases),
    student_mgmt:document.getElementById('perm_student_mgmt').checked,
    guaranteed_only:document.getElementById('perm_guaranteed_only')?.checked||false,
    student_mgmt_items:[...document.querySelectorAll('#perm_student_mgmt_items .filter-chip.active')].map(c=>c.dataset.value),
    student_majors:[...document.querySelectorAll('#perm_student_majors .filter-chip.active')].map(c=>c.dataset.value),
  });
}

// 老师表单：点领域 chip → 切换选中 → 刷新专业区（只展开已选领域下的专业）
function toggleDomainChip(el){
  el.classList.toggle('active');
  renderTeacherMajorChips();
}
// 按已选领域展开专业 chip（按领域分组显示）；保留已勾选的专业状态
function renderTeacherMajorChips(){ _renderTeacherMajorChipsInner(); renderPermAdmMajors(); }
function _renderTeacherMajorChipsInner(){
  const box=document.getElementById('new_teacher_majors'); if(!box) return;
  const _isDom=(typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin && !!viewLockDomain());
  const _lockDom=_isDom?viewLockDomain():'';
  const selDomains = _isDom ? [_lockDom] : [...new Set([...document.querySelectorAll('#new_teacher_domains .filter-chip.active')].map(c=>c.dataset.value))];
  // 记住当前已选专业，重绘后恢复
  const prevSel=new Set([...box.querySelectorAll('.filter-chip.active')].map(c=>c.dataset.value));
  if(!selDomains.length){ box.innerHTML='<div style="font-size:11px;color:var(--text-3)">请先选择领域，上方选定后这里展开对应专业</div>'; return; }
  let html='';
  selDomains.forEach(dom=>{
    const majorsInDom=teacherMultiDoms()?scopeMajorsIn(dom):allMajorKeys().filter(m=>MAJOR_DOMAIN[m]===dom);
    // 社会人文（shakai_group）是三专业合并的虚拟专业：成员在本领域时，额外给一个可分配的「社会人文」
    // 老师分配到它后，开面谈时间槽能选「社会人文」，槽会显示在社会人文的学生预约页
    const groupHere = (typeof SHAKAI_GROUP!=='undefined') && SHAKAI_GROUP.some(m=>MAJOR_DOMAIN[m]===dom) && (!teacherMultiDoms()||scopeHasDomain(dom));
    if(!majorsInDom.length && !groupHere) return;
    const chipKeys = (groupHere ? ['shakai_group'] : []).concat(majorsInDom);
    html+=`<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--text-3);margin-bottom:4px">${dom}</div><div style="display:flex;flex-wrap:wrap;gap:6px">`;
    html+=chipFold(chipKeys.map(m=>({on:prevSel.has(m),html:`<div class="filter-chip${prevSel.has(m)?' active':''}" data-value="${m}" onclick="toggleChip(this)" style="padding:4px 10px">${majorLabel(m)}${m==='shakai_group'?'<span style="font-size:9px;color:var(--text-3);margin-left:3px">(合并)</span>':''}</div>`})));
    html+='</div></div>';
  });
  box.innerHTML=html||'<div style="font-size:11px;color:var(--text-3)">所选领域下暂无专业</div>';
}

// 老师类型单选（正社员/兼职）；选正社员才显示部门
function selectStaffType(el){
  const _prevStaff=tsecCurType();
  document.querySelectorAll('#new_teacher_stafftype .filter-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  const isRegular = el.dataset.value==='正社员';
  const wrap=document.getElementById('new_teacher_dept_wrap');
  if(wrap) wrap.style.display = isRegular?'block':'none';
  if(!isRegular){ const d=document.getElementById('new_teacher_department'); if(d) d.value=''; }
  tsecApply();
  if(_prevStaff!==el.dataset.value) tfStaffTypeChanged(_prevStaff);
}
async function addTeacher(){
  const _isDom = (typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin && !!viewLockDomain());
  const _lockDom = _isDom ? viewLockDomain() : '';
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
    if(teacherMultiDoms() && !domains.length && !managed_by.length){ alert('请选择领域（只能选这个链接范围内的领域）'); return; }
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
    const mg=tfMgrCollect(null,true); if(mg===null) return;
    if(!tfLeadScopeOk(mg)) return;
    const t=Object.assign({id:`t-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,name,notes,majors,domains,managed_by,staff_type,department,permissions,tags},mg,tfRolesCollect(null));
    const res=await sb('/rest/v1/teachers','POST',[t]);
    cachedTeachers.push(Array.isArray(res)?res[0]:t);
    document.getElementById('new_teacher_name').value='';
  document.querySelectorAll('#new_teacher_stafftype .filter-chip').forEach(c=>c.classList.remove('active'));
  if(document.getElementById('new_teacher_dept_wrap')) document.getElementById('new_teacher_dept_wrap').style.display='none';
  if(document.getElementById('new_teacher_department')) document.getElementById('new_teacher_department').value='';
    document.getElementById('new_teacher_notes').value='';
  setTeacherTags([]);
    setTeacherTags([]);
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
    {const _e=document.getElementById('perm_promo_pack'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_promo_pricing'); if(_e)_e.checked=false;}
    {const _e=document.getElementById('perm_success_cases'); if(_e)_e.checked=false;}
    tfFormReset();
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
  setTeacherTags(t.tags||[]);
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
  admFoldSync(document.getElementById('new_teacher_majors'));
  const p=t.permissions||{};
  document.getElementById('perm_booking').checked=!!p.booking;
  document.getElementById('perm_slots').checked=!!p.slots;
  {const _e=document.getElementById('perm_schedule_mode'); if(_e)_e.value=(p.schedule===true?'full':(p.schedule||''));}
  document.getElementById('perm_homework').checked=!!p.homework;
  document.getElementById('perm_admission_query').checked=!!p.admission_query;
  _admSel=new Set(p.admission_majors||[]); renderPermAdmMajors();
  {const _e=document.getElementById('perm_promo'); if(_e)_e.checked=!!p.promo;}
  {const _e=document.getElementById('perm_lect_info'); if(_e)_e.checked=!!p.lect_info;}
  {const _e=document.getElementById('perm_progress_plan'); if(_e)_e.checked=!!p.progress_plan;}
  {const _e=document.getElementById('perm_vip_sales'); if(_e)_e.checked=!!p.vip_sales;}
  {const _e=document.getElementById('perm_promo_pack'); if(_e)_e.checked=!!p.promo_pack;}
  {const _e=document.getElementById('perm_promo_pricing'); if(_e)_e.checked=!!p.promo_pricing;}
  {const _e=document.getElementById('perm_success_cases'); if(_e)_e.checked=!!p.success_cases;}
  document.getElementById('perm_student_mgmt').checked=!!p.student_mgmt;
  {const _g=document.getElementById('perm_guaranteed_only'); if(_g) _g.checked=!!p.guaranteed_only;}
  document.querySelectorAll('#perm_student_mgmt_items .filter-chip').forEach(c=>{c.classList.toggle('active',((p.student_mgmt_items||[]).includes(c.dataset.value)||((p.student_mgmt_items||[]).includes('records')&&/^records_(view|entry)$/.test(c.dataset.value))));});   // 旧的 records = 查看+登记都开
  document.querySelectorAll('#perm_student_majors .filter-chip').forEach(c=>{c.classList.toggle('active',(p.student_majors||[]).includes(c.dataset.value));});
  admFoldSync(document.getElementById('perm_student_majors'));
  document.querySelectorAll('#perm_booking_types .filter-chip').forEach(c=>{c.classList.toggle('active',(p.booking_types||[]).includes(c.dataset.value))});
  document.querySelectorAll('#perm_slot_types .filter-chip').forEach(c=>{c.classList.toggle('active',(p.slot_types||[]).includes(c.dataset.value))});
  document.querySelectorAll('#perm_vip_content .filter-chip').forEach(c=>{c.classList.toggle('active',(p.vip_content||[]).includes(c.dataset.value))});
  hwaInit(p, t);
  _tfEditId=t.id; tfRolesLoad(t); tsecCollapse(); tfMgrInit(t); tsecApply(); tfTaskLoad(); roleTplEnsure().then(tfRoleDiffRender);
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
  const _isDom=(typeof ACCESS_KEY!=='undefined' && ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin && !!viewLockDomain());
  const _lockDom=_isDom?viewLockDomain():'';
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
    const _md=teacherMultiDoms();
    if(_md){   // 组合范围的链接：表单里只有范围内的领域 / 专业，范围外已有的归属和专业原样保留，避免误删
      if(!domains.length&&!managed_by.length){ alert('请选择领域（只能选这个链接范围内的领域）'); return; }
      domains=[...new Set([...(cur.domains||[]).filter(d=>!_md.includes(d)),...domains])];
      managed_by=[...new Set([...(cur.managed_by||[]).filter(d=>!_md.includes(d)),...managed_by])];
      majors=[...new Set([...(cur.majors||[]).filter(m=>!scopeMajor(m)),...selMajors])];
    }
    staff_type=document.querySelector('#new_teacher_stafftype .filter-chip.active')?.dataset.value||'';
    department=staff_type==='正社员'?(document.getElementById('new_teacher_department')?.value||''):'';
  }
  const mg=tfMgrCollect(cur,false); if(mg===null) return;
  if(!tfLeadScopeOk(mg,cur)) return;
  try{
    const body=Object.assign({name,notes,majors,domains,managed_by,staff_type,department,permissions,tags},mg,tfRolesCollect(cur));
    await sb(`/rest/v1/teachers?id=eq.${id}`,'PATCH',body);
    const idx=cachedTeachers.findIndex(t=>t.id===id);
    if(idx>=0) Object.assign(cachedTeachers[idx],body);
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
// ═══════════════════════════════════════════════
// 老师「管理模式」：admin/index.html?as=teacher
// 不走管理员邮箱、不读 access_keys，直接用老师端已登录的会话（storageKey 'sb-teacher'，同一网站），
// 按这位老师的 manage_scope 建立范围（和组合范围的访问链接完全一样的处理：ACCESS_KEY 伪装成一把非 admin 钥匙，
// 所有「领域链接用户」的限制——隐藏中枢/切换视角、范围过滤——自动适用）。数据库侧由 is_domain_key()→is_teacher_manager() 放行写入。
// ═══════════════════════════════════════════════
function teacherModeBlock(msg){
  document.getElementById('loginOverlay').style.display='flex';
  const pw=document.getElementById('pwBox'); if(pw) pw.style.display='none';
  const mg=document.getElementById('magicBox'); if(mg) mg.style.display='none';
  const hint=document.getElementById('loginHint'); if(hint) hint.textContent='管理模式';
  const er=document.getElementById('loginErr'); if(er) er.textContent=msg;
}
async function bootAsTeacher(){
  try{
    if(typeof supabase==='undefined' || !supabase.createClient){ teacherModeBlock('登录组件未加载，请刷新页面重试'); return; }
    const c=supabase.createClient(SB_URL, SB_KEY, { auth:{ storageKey:'sb-teacher', persistSession:true, autoRefreshToken:true, detectSessionInUrl:false } });
    const { data } = await c.auth.getSession();   // token 过期会在这里自动续期
    const ses=data && data.session;
    const m=ses && ses.user && /^(.+)@teacher\.local$/.exec(ses.user.email||'');
    if(!m){ teacherModeBlock('请从你的老师链接进入'); return; }
    __setSbStorageKey('sb-teacher');
    __setSbToken(ses.access_token, c);
    window.__teacherAuthClient=c;   // 「资源管理」嵌入前用它让会话续期
    const rows=await sb(`/rest/v1/teachers?id=eq.${encodeURIComponent(m[1])}&select=*`).catch(()=>[]);
    const t=rows && rows[0];
    if(!t || !managerScopeNonEmpty(t.manage_scope)){ teacherModeBlock(t?'你还不是负责人，没有管理模式。请联系管理员开通':'请从你的老师链接进入'); return; }
    const ms=t.manage_scope;
    ACCESS_KEY={ k:'teacher:'+t.id, domains:ms.domains||[], majors:ms.majors||[], class_ids:ms.class_ids||[], is_admin:false, active:true, label:'管理模式 · '+t.name, _asTeacher:{ id:t.id, name:t.name, resource_perms:t.resource_perms||[] } };
    await loadMajorsFromDB();
    await loadPeriodsFromDB(); await loadHolidaysFromDB();
    await enterFromKey();
    // 顶栏：标明管理模式 + 回到老师端；退出登录没有意义（会话属于老师端）
    const tag=document.getElementById('domainTag');
    if(tag){ const t0=scopeSummary(VIEW_SCOPE); tag.textContent='管理模式 · '+t.name+' · '+t0; tag.title=tag.textContent; }
    const lo=document.querySelector('.topbar button[onclick="doLogout()"]'); 
    if(lo){ lo.textContent='← 回到老师端'; lo.setAttribute('onclick','backToTeacherPage()'); }
  }catch(e){ console.warn('管理模式进入失败:', e); teacherModeBlock('进入失败：'+(e&&e.message||e)); }
}
function backToTeacherPage(){
  const id=ACCESS_KEY && ACCESS_KEY._asTeacher && ACCESS_KEY._asTeacher.id;
  location.href=location.origin+location.pathname.replace(/\/admin\/[^/]*$/,'/teacher/')+(id?('?tid='+encodeURIComponent(id)):'');
}
(async function bootAuth(){
  if(new URLSearchParams(location.search).get('as')==='teacher'){ await bootAsTeacher(); return; }
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
  // 领域钥匙（非admin）：纯链接登录——静默 Auth 拿 token → 直接进领域，不再输密码
  if(ACCESS_KEY && !ACCESS_KEY.invalid && !ACCESS_KEY.is_admin){
    await silentAccessKeyLogin();
    localStorage.setItem('txe_login', JSON.stringify({ ts: Date.now() }));
    enterFromKey();
    return;
  }
  // 若从邮件魔法链接回来 → 完成 Auth 登录（无 k 的 admin 场景）
  if(!ACCESS_KEY){
    try{ if(await handleMagicCallback()){ await enterHubChecked('这个邮箱不是管理员邮箱，请换管理员邮箱登录'); return; } }catch(e){}
  }
  // 已登录：admin钥匙/无k → 中枢台
  if(checkLogin()){
    await enterHubChecked('登录已过期，请用邮箱重新登录');   // 检查数据库身份：会话没了 / 邮箱不对就回到邮箱登录
    return;
  }
  // 未登录：显示登录框。有 ?k=（领域钥匙）→ 显示密码框；admin 直接访问 → 只显示邮箱免密登录
  document.getElementById('loginOverlay').style.display='flex';
  {
    const isKey = ACCESS_KEY && !ACCESS_KEY.invalid;
    const pwBox = document.getElementById('pwBox');
    const magicBox = document.getElementById('magicBox');
    const adminKey = isKey && ACCESS_KEY.is_admin;   // admin 钥匙链接：密码登录没有数据库身份，改用邮箱
    if(pwBox) pwBox.style.display = (isKey && !adminKey) ? 'block' : 'none';
    if(magicBox) magicBox.style.display = (isKey && !adminKey) ? 'none' : 'block';  // 领域钥匙用密码；admin 用邮箱
    if(adminKey){ const m=document.getElementById('magicMsg'); if(m){ m.style.color='var(--text-3)'; m.textContent='管理员请用邮箱登录'; } }
  }
  if(ACCESS_KEY && !ACCESS_KEY.is_admin){
    const hint=document.getElementById('loginHint');
    if(hint) hint.textContent=`${ACCESS_KEY.label||keyScopeText(ACCESS_KEY)} · 请输入访问密码`;
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
    domain:'', subject:'', courses:'', keywords:'', feature:'', highlights:'', notes:'' };
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
  <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">Excel 列名须与讲师信息表一致（讲师姓名 / 所属学系 / 所属学科 / 毕业或所属大学院研究科 / 学位（含在读） / 执教年份 / 担当课程 / 可指导方向（关键词） / VIP指导 / 授课特色 / 特色亮点（选填） / 备注）。<b>讲师姓名请填本名</b>：与老师管理中的姓名一致即自动关联账号（老师可自行补全档案，对外展示名由老师管理的「备注 / 对外宣传姓名」控制）。</div>
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
  <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px">
  <div style="flex:1 1 460px;min-width:0;border:1px solid var(--accent);border-radius:4px;padding:14px;background:var(--bg)">
    <div style="font-size:11px;font-weight:600;margin-bottom:8px">${profEditingId==='new'?'＋ 新增讲师档案':(p._addFor?`＋ 为「${profEsc(p.name)}」添加介绍`:'✏ 编辑讲师档案')}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin-bottom:8px">
      ${PROF_FIELDS.map(([k,l])=>`<div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">${l}</label><input id="pf_${k}" value="${profEsc(p[k])}" ${k==='name'?'oninput="profOthersRefresh()"':''} style="${inp}"></div>`).join('')}
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">领域 *</label>
        <select id="pf_domain" onchange="profDomainChange()" style="${inp}">
          <option value="">选择领域</option>
          ${(typeof DOMAINS!=='undefined'?DOMAINS:[]).map(d=>`<option value="${d.label}"${p.domain===d.label?' selected':''}>${d.label}</option>`).join('')}
        </select></div>
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">专业 *</label>
        <select id="pf_subject" style="${inp}"><option value="">请先选领域</option></select></div>
      <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">排序</label><input id="pf_sort" type="number" value="${p.sort_order||0}" style="${inp}"></div>
    </div>
    ${[['courses','担当课程'],['keywords','可指导方向（关键词）'],['feature','授课特色'],['highlights','特色亮点（选填）'],['notes','备注']].map(([k,l])=>`
    <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">${l}</label>
    <textarea id="pf_${k}" rows="${k==='feature'||k==='highlights'?4:2}" style="width:100%;font-size:11px;line-height:1.7;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit;resize:vertical;margin-bottom:6px">${profEsc(p[k])}</textarea>`).join('')}
    <div style="display:flex;gap:6px;margin-top:4px">
      <button class="btn btn-primary btn-sm" onclick="profSave()">保存</button>
      <button class="btn btn-outline btn-sm" onclick="profEditingId=null;profNewPreset=null;profRender()">取消</button>
    </div>
    <input type="hidden" id="pf_subject_preset" value="${profEsc(p.subject||'')}">
  </div>
  <div id="pf_others" style="flex:1 1 300px;min-width:240px">${profOthersHtml(p.name,p.id)}</div>
  </div>`;

  if(profEditingId==='new'){box.innerHTML=formHtml(profNewPreset||{});setTimeout(profDomainChange,0);return}

  // 视角过滤：专业链接→只看该专业档案；领域链接→只看该领域档案；admin→全部
  let viewProfs=profList;
  if(!scopeAll()){
    // 完整领域：按档案的领域；单独专业：按档案的学科（专业中文名）
    const subs=VIEW_SCOPE.majors.map(m=>MAJORS[m]||m);
    viewProfs=profList.filter(p=>scopeHasDomain((p.domain||'')) || subs.includes((p.subject||'').trim()));
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
            ${(p.highlights||'').trim()?`<div style="font-size:10px;color:var(--text-2);margin-top:2px">特色亮点：${profEsc((p.highlights||'').slice(0,60))}${(p.highlights||'').length>60?'…':''}</div>`:''}
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

// 这位老师（同名）其他专业的介绍：每个字段旁有「⤵ 带入」，把那段文字填进当前正在编辑的同一字段
const PROF_BRING=[['courses','担当课程'],['keywords','可指导方向'],['feature','授课特色'],['highlights','特色亮点']];
function profOthersHtml(name,excludeId){
  const others=(profList||[]).filter(x=>x.id!==excludeId&&name&&x.name===String(name).trim());
  if(!others.length) return `<div style="font-size:10px;color:var(--text-3);border:1px dashed var(--border);border-radius:4px;padding:10px">这位老师还没有其他专业的介绍</div>`;
  return `<div style="font-size:11px;font-weight:600;margin-bottom:6px">其他专业的介绍（可带入）</div>`+others.map(o=>`
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px 10px;margin-bottom:6px;background:var(--surface)">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:11px;font-weight:600">${profEsc(o.subject||'未分类')}</span>
        <button class="btn btn-outline btn-sm" style="margin-left:auto;font-size:10px" onclick="profBringAll('${o.id}')">全部带入（只填空白）</button></div>
      ${PROF_BRING.map(([k,l])=>(o[k]||'').trim()?`<div style="font-size:10px;margin-bottom:3px"><div style="display:flex;align-items:center;gap:6px"><span style="color:var(--text-3)">${l}</span><button class="btn btn-outline btn-sm" style="font-size:10px;padding:0 6px;margin-left:auto" onclick="profBring('${o.id}','${k}')">⤵ 带入</button></div><div style="color:var(--text-2);line-height:1.6;white-space:pre-wrap">${profEsc((o[k]||'').slice(0,120))}${(o[k]||'').length>120?'…':''}</div></div>`:'').join('')}
    </div>`).join('');
}
function profOthersRefresh(){
  const box=document.getElementById('pf_others'); if(!box) return;
  box.innerHTML=profOthersHtml((document.getElementById('pf_name')||{}).value||'', profEditingId==='new'?'':profEditingId);
}
function profBring(srcId,field){
  const src=profList.find(x=>x.id===srcId), el=document.getElementById('pf_'+field); if(!src||!el) return;
  if(el.value.trim()&&el.value.trim()!==(src[field]||'').trim()&&!confirm('当前这一项已经有内容，要用另一个专业的内容覆盖吗？')) return;
  el.value=src[field]||'';
}
function profBringAll(srcId){
  const src=profList.find(x=>x.id===srcId); if(!src) return;
  PROF_BRING.forEach(([k])=>{ const el=document.getElementById('pf_'+k); if(el&&!el.value.trim()&&(src[k]||'').trim()) el.value=src[k]; });
}
// 学校、学位、年限等固定信息：和这位老师其他专业的行不一致时，问是否一起更新（空值不会覆盖别人的内容）
const PROF_FIXED=[['school','毕业或所属研究科'],['degree','学位'],['years','执教年份'],['vip','VIP指导']];
async function profSyncFixed(row,excludeId){
  const others=(profList||[]).filter(x=>x.id!==excludeId&&x.name===row.name);
  const diff=PROF_FIXED.filter(([k])=>(row[k]||'').trim()&&others.some(o=>(o[k]||'').trim()!==row[k]));
  if(!others.length||!diff.length) return;
  if(!confirm(`这位老师在其他专业还有 ${others.length} 份介绍，其中「${diff.map(d=>d[1]).join('、')}」和这里不一致。\n\n要同时更新其他专业的这几项吗？（确定 = 一起更新，取消 = 只改这一份）`)) return;
  for(const o of others){
    const patch={}; diff.forEach(([k])=>{ if((o[k]||'').trim()!==row[k]) patch[k]=row[k]; });
    if(Object.keys(patch).length){ await sb(`/rest/v1/teacher_profiles?id=eq.${o.id}`,'PATCH',patch); Object.assign(o,patch); }
  }
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
    feature:g('feature').trim(), highlights:g('highlights').trim(), notes:g('notes').trim(),
    sort_order:parseInt((document.getElementById('pf_sort')||{}).value)||0,
  };
  if(!row.name){alert('请填写讲师姓名');return}
  if(!row.domain){alert('请选择领域');return}
  try{
    await profSyncFixed(row, profEditingId==='new'?'':profEditingId);
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
    profBrief=null;
    profRender();
  }catch(e){alert('保存失败：'+e.message)}
}

async function profDelete(id){
  if(!confirm('删除这位讲师的档案？'))return;
  try{
    await sb(`/rest/v1/teacher_profiles?id=eq.${id}`,'DELETE');
    profList=profList.filter(p=>p.id!==id);
    profBrief=null;
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
        highlights:String(r['特色亮点']||'').trim(),
        notes:String(r['备注']||'').trim(),
        sort_order:0,
      })).filter(r=>r.name);
      if(!mapped.length){alert('没有识别到有效数据行，请确认列名与讲师信息表一致');return}
      if(!confirm(`识别到 ${mapped.length} 位讲师，确认导入（追加到现有档案）？\n重复导入会产生重复条目，如需重导请先删除旧数据。`))return;
      for(let i=0;i<mapped.length;i+=20){
        await sb('/rest/v1/teacher_profiles','POST',mapped.slice(i,i+20));
      }
      profList=profList.concat(mapped);
      profBrief=null;
      alert(`已导入 ${mapped.length} 位讲师`);
      profRender();
    }catch(err){alert('导入失败：'+err.message)}
  };
  reader.readAsArrayBuffer(file);
}
