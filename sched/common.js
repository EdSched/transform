/* 唯新 · 教学资源调度系统  核心库 common.js
   所有页面共用：Supabase 读写 / 时段 / 冲突检测 / 格式化 */

const SB_URL = 'https://vwntezfvqbrkeovnseku.supabase.co';
const SB_KEY = 'sb_publishable_cUnCkti5qv1_G4N6Ho5tpw_9pr7pSas';

/* ---------- Supabase REST 封装 ---------- */
function sbHeaders(extra){
  const tok = schedAuthToken();   // 有登录身份就带 token，没有才用公钥
  return Object.assign({
    apikey: SB_KEY,
    Authorization: 'Bearer ' + (tok || SB_KEY),
    'Content-Type': 'application/json'
  }, extra || {});
}
/* ---------- 排课系统的登录身份 ----------
   口令用户：打开带 ?k=口令 的页面时静默登录（和领域访问链接的 silentAccessKeyLogin 同一思路）：
     邮箱 'c_'+md5(口令)+'@sched.local'，密码 'sched:'+口令；账号由数据库触发器在新增/修改口令时自动建好。
     会话存在 localStorage 的 sb-sched（不和 sb-admin / sb-teacher 混用），有效期内换页不再重新登录，快过期才用口令重新登录一次。
     登录失败自动重试 2 次（只重试网络/服务端错误）；仍失败不挡页面，退回公钥继续用，并在页面顶部提示。
   嵌入管理端 / 老师端（embed=admin / via=admin）：每次请求都现读管理端 sb-admin 或老师端 sb-teacher 里的 token（父页面会自动续期）。 */
const SCHED_STORE = 'sb-sched';
let SCHED_TOKEN = null, SCHED_TOKEN_EXP = 0, SCHED_LOGIN_P = null, SCHED_LOGIN_CODE = '', SCHED_LOGIN_ERR = '', SCHED_RELOGIN_P = null;
function schedMd5(str){   // 与数据库 md5(text) 一致（UTF-8）
  const b=new TextEncoder().encode(str), n=b.length, len=((n+8>>6)+1)*16, w=new Int32Array(len);
  for(let i=0;i<n;i++) w[i>>2]|=b[i]<<((i%4)*8);
  w[n>>2]|=0x80<<((n%4)*8); w[len-2]=n*8;
  const K=[], S=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
  for(let i=0;i<64;i++) K[i]=Math.floor(Math.abs(Math.sin(i+1))*4294967296)|0;
  let a0=0x67452301,b0=0xefcdab89|0,c0=0x98badcfe|0,d0=0x10325476;
  for(let o=0;o<len;o+=16){
    let A=a0,B=b0,C=c0,D=d0;
    for(let i=0;i<64;i++){
      let F,g;
      if(i<16){F=(B&C)|(~B&D);g=i;} else if(i<32){F=(D&B)|(~D&C);g=(5*i+1)%16;}
      else if(i<48){F=B^C^D;g=(3*i+5)%16;} else {F=C^(B|~D);g=(7*i)%16;}
      F=(F+A+K[i]+w[o+g])|0; A=D; D=C; C=B;
      const sh=S[(i>>4)*4+(i%4)]; B=(B+((F<<sh)|(F>>>(32-sh))))|0;
    }
    a0=(a0+A)|0; b0=(b0+B)|0; c0=(c0+C)|0; d0=(d0+D)|0;
  }
  return [a0,b0,c0,d0].map(v=>{ let h=''; for(let i=0;i<4;i++) h+=((v>>>(i*8))&255).toString(16).padStart(2,'0'); return h; }).join('');
}
function schedEmbedStoreKey(){   // 嵌入时用哪份登录：老师端（as=teacher / 首页记下的 embed 身份是老师）还是管理端
  const q=new URLSearchParams(location.search);
  if(q.get('as')==='teacher') return 'sb-teacher';
  if(q.get('embed')==='admin') return 'sb-admin';
  try{ const r=JSON.parse(sessionStorage.getItem('sched_role_embed')||'null'); if(r && r.role==='teacher') return 'sb-teacher'; }catch(e){}
  return 'sb-admin';
}
function schedAuthToken(){
  if(schedEmbedVia()){ const t=schedReadToken(schedEmbedStoreKey()); if(t) return t; }
  if(SCHED_TOKEN && SCHED_TOKEN_EXP*1000 > Date.now()+5000) return SCHED_TOKEN;
  return null;
}
function schedAuthCode(){
  const k=new URLSearchParams(location.search).get('k'); if(k) return k;
  try{ const r=JSON.parse(sessionStorage.getItem('sched_role')||'null'); if(r && r.code) return r.code; }catch(e){}
  return '';
}
async function schedPasswordLogin(code){
  const email='c_'+schedMd5(code)+'@sched.local';
  let lastErr='';
  for(let i=0;i<3;i++){   // 1 次 + 重试 2 次
    try{
      const r=await fetch(SB_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:SB_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password:'sched:'+code})});
      if(r.ok){ const j=await r.json(); if(j.access_token) return {ok:true,tok:j.access_token,exp:j.expires_at||Math.floor(Date.now()/1000)+(j.expires_in||3600)}; }
      lastErr='登录失败 '+r.status;
      if(r.status>=400 && r.status<500 && r.status!==429) break;   // 账号不存在 / 口令错：重试没用
    }catch(e){ lastErr='网络错误 '+e.message; }
    await new Promise(res=>setTimeout(res,600*(i+1)));
  }
  return {ok:false,err:lastErr};
}
async function schedLogin(code){
  try{   // 先看 localStorage 里同一口令、还没过期的会话
    const o=JSON.parse(localStorage.getItem(SCHED_STORE)||'null');
    if(o && o.code===code && o.access_token && o.expires_at*1000>Date.now()+120000){ SCHED_TOKEN=o.access_token; SCHED_TOKEN_EXP=o.expires_at; schedArmRelogin(code); return true; }
  }catch(e){}
  const r=await schedPasswordLogin(code);
  if(!r.ok){ SCHED_LOGIN_ERR=r.err||'登录失败'; console.warn('排课系统静默登录失败:',SCHED_LOGIN_ERR); schedShowLoginWarn(); return false; }
  SCHED_TOKEN=r.tok; SCHED_TOKEN_EXP=r.exp; SCHED_LOGIN_ERR='';
  try{ localStorage.setItem(SCHED_STORE,JSON.stringify({code,access_token:r.tok,expires_at:r.exp})); }catch(e){}
  schedArmRelogin(code);
  return true;
}
function schedArmRelogin(code){   // 快过期前用口令重新登录一次
  const ms=Math.max(30000, SCHED_TOKEN_EXP*1000-Date.now()-120000);
  setTimeout(()=>{ SCHED_LOGIN_P=schedLogin(code); SCHED_LOGIN_P.catch(()=>{}); }, Math.min(ms,2147483000));
}
function schedEnsureLogin(code){
  if(!code || schedEmbedVia()) return Promise.resolve(false);
  if(SCHED_LOGIN_P && SCHED_LOGIN_CODE===code) return SCHED_LOGIN_P;
  SCHED_LOGIN_CODE=code; SCHED_LOGIN_P=schedLogin(code); return SCHED_LOGIN_P;
}
// 读写前等登录完成（睡眠回来 token 过期了就重新登录一次）；任何情况下都不抛错、不挡页面
async function schedAuthReady(){
  try{
    if(SCHED_LOGIN_P) await SCHED_LOGIN_P;
    if(SCHED_LOGIN_CODE && !schedEmbedVia() && !(SCHED_TOKEN && SCHED_TOKEN_EXP*1000>Date.now()+5000)){
      if(!SCHED_RELOGIN_P) SCHED_RELOGIN_P=schedLogin(SCHED_LOGIN_CODE).finally(()=>{ SCHED_RELOGIN_P=null; });
      await SCHED_RELOGIN_P;
    }
  }catch(e){}
}
function schedShowLoginWarn(){
  const show=()=>{ if(document.getElementById('schedLoginWarn')||!document.body) return;
    const d=document.createElement('div'); d.id='schedLoginWarn';
    d.style.cssText='background:#fff4d6;color:#7a5b00;border-bottom:1px solid #ecd48a;padding:6px 12px;font-size:12px';
    d.textContent='排课系统身份登录失败（'+SCHED_LOGIN_ERR+'），部分数据可能读不到或无法保存，请刷新页面重试；仍不行请联系管理员。';
    document.body.insertBefore(d,document.body.firstChild); };
  if(document.body) show(); else document.addEventListener('DOMContentLoaded',show);
}
// 页面一加载：带口令（?k= 或已在本标签页验证过的口令）就开始静默登录；嵌入模式不用口令
(function(){ const c=schedAuthCode(); if(c && !schedEmbedVia()) schedEnsureLogin(c); })();
// PostgREST 报错体 → 只取 message（触发器抛的中文原因就在这里）
function sbErrMsg(t){ try{ const j=JSON.parse(t); return j && j.message ? j.message : ''; }catch(e){ return ''; } }
// 读取：自动翻页。Supabase 每次最多返回 1000 行（项目设置 Max rows），裸 select=* 会把超出部分静默截掉；
// 这里用 Content-Range 拿总数、按页拉齐。查询里自己写了 limit 的按原样返回（不翻页）。
async function sbGet(table, query){
  await schedAuthReady();
  const q = query || 'select=*';
  const base = SB_URL + '/rest/v1/' + table + '?' + q;
  if(/(^|&)limit=/.test(q)){
    const r = await fetch(base, { headers: sbHeaders(), cache: 'no-store' });
    if(!r.ok) throw new Error(table + ' 读取失败: ' + r.status + ' ' + await r.text());
    return r.json();
  }
  const ord = /(^|&)order=/.test(q) ? '' : '&order=id.asc';   // 翻页需要稳定顺序
  const PAGE = 1000; let all = [], off = 0;
  for(let guard=0; guard<100; guard++){
    const r = await fetch(base + ord + '&limit=' + PAGE + '&offset=' + off,
      { headers: Object.assign({}, sbHeaders(), { 'Prefer': 'count=exact' }), cache: 'no-store' });
    if(!r.ok) throw new Error(table + ' 读取失败: ' + r.status + ' ' + await r.text());
    const rows = await r.json();
    all = all.concat(rows); off += rows.length;
    const cr = r.headers.get('content-range') || '';           // 形如 0-999/1234
    const total = cr.includes('/') ? parseInt(cr.split('/')[1], 10) : NaN;
    if(!rows.length || isNaN(total) || off >= total) break;
  }
  return all;
}
async function sbInsert(table, rows){
  await schedAuthReady();
  const r = await fetch(SB_URL + '/rest/v1/' + table, {
    method:'POST', headers: sbHeaders({ Prefer:'return=representation' }),
    body: JSON.stringify(Array.isArray(rows)? rows : [rows])
  });
  if(!r.ok){ const t=await r.text(); throw new Error(sbErrMsg(t) || ('写入失败: ' + r.status + ' ' + t)); }
  return r.json();
}
async function sbUpdate(table, id, patch){
  await schedAuthReady();
  const r = await fetch(SB_URL + '/rest/v1/' + table + '?id=eq.' + id, {
    method:'PATCH', headers: sbHeaders({ Prefer:'return=representation' }),
    body: JSON.stringify(patch)
  });
  if(!r.ok) throw new Error('更新失败: ' + r.status + ' ' + await r.text());
  return r.json();
}
async function sbDelete(table, id){
  await schedAuthReady();
  const r = await fetch(SB_URL + '/rest/v1/' + table + '?id=eq.' + id, {
    method:'DELETE', headers: sbHeaders()
  });
  if(!r.ok) throw new Error('删除失败: ' + r.status + ' ' + await r.text());
  return true;
}

/* ---------- 常量 ---------- */
const CAMPUSES   = ['高马','市谷'];
const CATEGORIES = ['学部文科','学部理科','语言','大学院文科','大学院理科'];
const WEEKDAYS   = ['','周一','周二','周三','周四','周五','周六','周日'];
const WD_MAP = {'周一':1,'周二':2,'周三':3,'周四':4,'周五':5,'周六':6,'周日':7,'周天':7,
  '星期一':1,'星期二':2,'星期三':3,'星期四':4,'星期五':5,'星期六':6,'星期日':7,'星期天':7,
  '礼拜一':1,'礼拜二':2,'礼拜三':3,'礼拜四':4,'礼拜五':5,'礼拜六':6,'礼拜日':7,
  '1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7};
// 解析 "周二/周四"、"周二、周四"、"2,4" 等 -> [2,4]（去重升序）
function parseWeekdays(s){
  if(s==null || s==='') return [];
  const arr = String(s).split(/[\/、,，\s;；]+/).map(x=>WD_MAP[x.trim()]).filter(Boolean);
  return [...new Set(arr)].sort((a,b)=>a-b);
}
// sched 专用：同上，但额外兼容 0（=周日，与管理端 0–6 编码对齐）。先把 0 归一成 7 再过滤，避免被 filter(Boolean) 吞掉
function parseWeekdaysSched(s){
  if(s==null || s==='') return [];
  const arr = String(s).split(/[\/、,，\s;；]+/).map(x=>{ x=x.trim(); return (x==='0'||x==='周0') ? 7 : WD_MAP[x]; }).filter(Boolean);
  return [...new Set(arr)].sort((a,b)=>a-b);
}
function weekdaysLabel(str){ // "2,4" / "周二,周四" -> "周二/周四"
  return parseWeekdaysSched(str).map(d=>WEEKDAYS[d]).join('/');
}
const KIND_LABEL = { course:'排课', vip:'VIP', temp:'临时使用', rental:'对外出租', meeting:'开会' };
const KIND_CLASS = { course:'k-course', vip:'k-vip', temp:'k-temp', rental:'k-rental', meeting:'k-meeting' };

/* 30 分钟时段：08:00 ~ 22:00 */
const SLOTS = (function(){
  const a=[]; for(let m=8*60; m<22*60; m+=30){
    const h=String(Math.floor(m/60)).padStart(2,'0'), mm=String(m%60).padStart(2,'0');
    a.push(h+':'+mm);
  } return a;
})();
function slotEnd(t){ // 某 30 分格的结束时刻
  const [h,m]=t.split(':').map(Number); let x=h*60+m+30;
  return String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0');
}

/* ---------- 日期/时间工具 ---------- */
function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function weekdayOf(dateStr){ // 1=周一...7=周日
  const d=new Date(dateStr+'T00:00:00'); const w=d.getDay(); return w===0?7:w;
}
function overlap(aS,aE,bS,bE){ return aS < bE && bS < aE; } // 时间字符串区间是否重叠

/* 课程归属的"6大类范围"：非语言课用类别；语言课细分日语/英语。用于学科负责人权限约束与筛选 */
function courseScope(c){
  const cat=c.category||'';
  if(/语言|語学/.test(cat)) return '语言-'+(langType(c)||'日语');
  return cat;  // 学部文科/学部理科/大学院文科/大学院理科
}
const LEAD_SCOPES = ['学部文科','学部理科','大学院文科','大学院理科','语言-日语','语言-英语'];

/* 类别配色：大学院文/理、学部文/理、语言，各一色。用于周历、课表色块 */
const CAT_COLORS = {
  '大学院文科': {bg:'#e8f0fb', bd:'#b9d0ef', tx:'#2c5aa0'},
  '大学院理科': {bg:'#e6f4ee', bd:'#b3ddc9', tx:'#1f7a52'},
  '学部文科':   {bg:'#fdf0e6', bd:'#f2d3b3', tx:'#b5651d'},
  '学部理科':   {bg:'#f3ecfa', bd:'#d9c4ee', tx:'#7048a0'},
  '语言':       {bg:'#fdecec', bd:'#f2c4c4', tx:'#c0504d'},
};
function catColor(cat){
  if(CAT_COLORS[cat]) return CAT_COLORS[cat];
  const c=cat||'';
  if(/大学院.*文/.test(c)) return CAT_COLORS['大学院文科'];
  if(/大学院.*理/.test(c)) return CAT_COLORS['大学院理科'];
  if(/学部.*文/.test(c)) return CAT_COLORS['学部文科'];
  if(/学部.*理/.test(c)) return CAT_COLORS['学部理科'];
  if(/语言|語学/.test(c)) return CAT_COLORS['语言'];
  return {bg:'#eef1f4', bd:'#d5dbe1', tx:'#556'};
}

/* 从期名解析开课日：取"YY年M月"或"YYYY年M月"，开课日=该月1号 */
function termStartDate(term){
  if(!term) return null;
  const m = String(term).match(/(\d{2,4})\s*年\s*(\d{1,2})\s*月/);
  if(!m) return null;
  let y = parseInt(m[1],10); if(y<100) y+=2000;
  const mo = parseInt(m[2],10);
  return y+'-'+String(mo).padStart(2,'0')+'-01';
}
/* 统计各期"未排教室"的课程：未排 = 该课在 bookings 里没有 kind=course 记录 */
function unscheduledByTerm(courses, bookings){
  const scheduled = new Set(bookings.filter(b=>b.kind==='course'&&b.course_id).map(b=>String(b.course_id)));
  const _today = todayStr();
  const byTerm = {};
  courses.forEach(c=>{
    if(scheduled.has(String(c.id))) return;
    if(c.end_date && c.end_date < _today) return;   // 已上完的课（结课日已过）不再提醒排教室
    const term = c.term||'未分期';
    (byTerm[term]=byTerm[term]||[]).push(c);
  });
  return byTerm;
}
/* 生成排课提醒文案列表（每个未排完的期一条）。提前半个月进入提醒窗 */
function schedulingReminders(courses, bookings){
  const byTerm = unscheduledByTerm(courses, bookings);
  const today = todayStr();
  const out = [];
  Object.keys(byTerm).forEach(term=>{
    const n = byTerm[term].length; if(!n) return;
    const start = termStartDate(term);
    let msg, urgent=false;
    if(start){
      const days = diffDays(today, start);   // 距开课天数（负=已开课）
      if(days<0){ msg = `【${term}】已开课，仍有 ${n} 门课未排教室，请尽快补排！`; urgent=true; }
      else if(days<=15){ msg = `【${term}】距开课仅 ${days} 天，还有 ${n} 门课未排教室，请于开课前完成！`; urgent=true; }
      else if(days<=45){ msg = `【${term}】距开课约 ${days} 天，有 ${n} 门课未排教室，请及时安排。`; }
      else return; // 太早，不提醒
    } else {
      msg = `【${term}】有 ${n} 门课未排教室。`;
    }
    out.push({term, n, msg, urgent});
  });
  return out;
}

/* 推断课程"班级性质"：共通/线上/周末/下午/晚上/默认。用于课表分组显示 */
function classKind(c){
  const name=(c.name||'');
  const wds=parseWeekdaysSched(c.weekdays);
  const st=(c.start_time||'');
  if(c.course_type==='共通课' || /共通|進学指導|進学指导|高数|高數/.test(name)) return '共通课';
  if(c.mode==='线上') return '线上班';
  if(wds.includes(6) || wds.includes(7)) return '周末班';
  if(st){ const h=parseInt(st.slice(0,2),10);
    if(h>=17) return '其他课程';
    if(h>=13) return '下午班';
  }
  return '默认班';
}
const CLASS_KINDS = ['默认班','下午班','其他课程','周末班','线上班','共通课'];

/* 语言课语种：英语 / 日语 */
function langType(c){
  const name=(c.name||'');
  if(/英语|英語|托福|托業|托业|TOEFL|TOEIC|IELTS|雅思/i.test(name)) return '英语';
  return '日语';
}

/* 解析腾讯会议邀请文字，抽取链接/会议号/起止日/时段/周几 */
function parseTencent(text){
  const t=String(text||'');
  const out={ link:null, id:null, host_key:null, subject:null, start_date:null, end_date:null, start_time:null, end_time:null, weekday:null };
  let m=t.match(/https?:\/\/meeting\.tencent\.com\/\S+/);
  if(m) out.link=m[0].replace(/[)）。,，、\s]+$/,'');
  m=t.match(/腾讯会议[:：]?\s*([\d\-\s]{9,})/); if(m) out.id=m[1].replace(/\s/g,'').trim();
  m=t.match(/主持人密钥[:：]?\s*(\d{4,})/); if(m) out.host_key=m[1].trim();
  m=t.match(/会议主题[:：]\s*(.+)/); if(m) out.subject=m[1].trim();
  m=t.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\s+(\d{1,2}:\d{2})\s*[-~至]\s*(\d{1,2}:\d{2})/);
  if(m){ out.start_date=m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');
    out.start_time=m[4].padStart(5,'0'); out.end_time=m[5].padStart(5,'0'); }
  m=t.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\s*[-~至]\s*(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if(m){ out.start_date=m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');
    out.end_date=m[4]+'-'+String(m[5]).padStart(2,'0')+'-'+String(m[6]).padStart(2,'0'); }
  m=t.match(/周([一二三四五六日天])/); if(m){ const map={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':7,'天':7}; out.weekday=map[m[1]]; }
  return out;
}

/* 通用占用网格（rowspan 版，色块与时段严格对齐，不漂移）
   rooms: [{id,name,sub}]；items: 占用记录数组；keyField: 'room_id' 或 'meeting_account_id' */
function renderOccupancyGrid(rooms, items, keyField, opts){
  opts = opts||{};
  const idxOf=t=>{ const i=SLOTS.indexOf(t); return i<0?SLOTS.length:i; };
  // 每列一个“跳过计数”：>0 表示这格被上面的 rowspan 占了，不输出
  const skip = rooms.map(()=>0);
  let h='<table><thead><tr><th class="tcol">时段</th>';
  // r.cls：列的额外 class（如今日课表里较窄的 VIP 教室列）；r.w：表头宽度（CSS 值）
  rooms.forEach(r=>h+=`<th${r.cls?` class="${esc(r.cls)}"`:''}${r.w?` style="width:${esc(r.w)}"`:''}>${esc(r.name)}${r.sub?('<br><small class="muted">'+esc(r.sub)+'</small>'):''}</th>`);
  h+='</tr></thead><tbody>';
  SLOTS.forEach((slot,si)=>{
    h+=`<tr><td class="tcol">${slot}</td>`;
    rooms.forEach((r,ci)=>{
      if(skip[ci]>0){ skip[ci]--; return; }               // 被上方占用块吃掉
      const b = items.find(x=>String(x[keyField])===String(r.id) && x.start_time===slot);
      if(b){
        let span = Math.max(1, idxOf(b.end_time)-idxOf(b.start_time));
        if(si+span>SLOTS.length) span=SLOTS.length-si;
        skip[ci]=span-1;
        const who = (opts.hideWho||opts.labelOnly) ? '' : (b.user_name||b.student_name||'');
        const pend = b.status==='pending';
        const mic = ((opts.hideWho||opts.labelOnly) ? false : b.uses_meeting) ? ' <span class="mic">📶</span>' : '';
        // vipMask：所有 VIP 占用（不管在哪种教室）只显示「VIP」两个字，不带学生/老师/事由/时间。用于今日课表大屏
        const vipMask = !!opts.vipMask && b.kind==='vip';
        // labelOnly：只显示占用类型标签（如“VIP”），不带课名/事由/人名。用于 VIP 页对外展示
        let label;
        if(vipMask){
          label = KIND_LABEL.vip;
        } else if(opts.labelOnly){
          label = KIND_LABEL[b.kind]||'占用';
        } else if(b.course_id){
          label = b.title||KIND_LABEL[b.kind]||'占用';
          if(opts.nameOf){ const nm=opts.nameOf(b.course_id); if(nm) label=nm; }
        } else {
          // 非课程占用（临时/租借等）
          let showT = !opts.hideOccTitle;                       // 全局开关（兼容旧用法）
          if(opts.perItemTitle) showT = (b.show_title===true);  // 按每条记录录入时的设置
          label = showT ? (b.title||KIND_LABEL[b.kind]||'占用') : (KIND_LABEL[b.kind]||'占用');
        }
        // 按类别上色（opts.catOf 传入 course_id→category 的查找）
        let styleAttr='', cc=null;
        if(!vipMask && opts.catOf && b.course_id){ const cat=opts.catOf(b.course_id); if(cat){ cc=catColor(cat); } }
        if(cc) styleAttr=` style="background:${cc.bg};border-color:${cc.bd};color:${cc.tx}"`;
        h+=`<td class="occ ${cc?'':(KIND_CLASS[b.kind]||'')}${vipMask?' occ-vip':''}${pend?' occ-pend':''}${r.cls?' '+esc(r.cls):''}" data-b="${b.id}" data-kind="${esc(b.kind||'')}" rowspan="${span}"${styleAttr}>`+
           `<div class="occ-in">${esc(label)}${vipMask?'':mic}`+
           (vipMask?'':`<small>${esc(who)} ${b.start_time}-${b.end_time}${pend&&!(opts.hideWho||opts.labelOnly)?' · 待确认':''}</small>`)+`</div></td>`;
      }else{
        // 空格：连续空档起点标“空”
        const prevSlot = si>0?SLOTS[si-1]:null;
        const prevCovered = prevSlot ? items.some(x=>String(x[keyField])===String(r.id) && x.start_time<=prevSlot && prevSlot<x.end_time) : false;
        const spanStart = !prevSlot || prevCovered;
        h+=`<td class="cell${r.cls?' '+esc(r.cls):''}">`+(spanStart?'<span class="freetag">空</span>':'')+'</td>';
      }
    });
    h+='</tr>';
  });
  h+='</tbody></table>';
  return h;
}

/* 本地时区日期格式化（避免 toISOString 的 UTC 偏移，日本 UTC+9 会差一天） */
function ymd(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

/* 日期加减 / 相差天数 */
function addDays(dateStr, n){
  const d=new Date(dateStr+'T00:00:00'); d.setDate(d.getDate()+n);
  return ymd(d);
}
function diffDays(a, b){ // b - a，天
  return Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00'))/86400000);
}
/* 按开课月份归期 */
function termOf(dateStr){
  if(!dateStr) return '';
  const [y,m]=dateStr.split('-').map(Number);
  const s = m<=3?1 : m<=6?4 : m<=9?7 : 10;
  return y+'年'+s+'月期';
}
/* 期数的两种写法：大学院等按期「2026年10月期」；学部美术按月「2026年9月」（没有「期」字） */
function isMonthTerm(t){ return /^\s*\d{4}\s*年\s*\d{1,2}\s*月\s*$/.test(String(t||'')); }
/* 期数排序键（越大越新）：2026年10月期 / 2026年9月 → 202610 / 202609；上学期≈4月、下学期≈10月 */
function termSortKey(t){
  t=String(t||'');
  const ym=t.match(/(\d{4})\D+(\d{1,2})\s*月/);
  if(ym) return Number(ym[1])*100 + Number(ym[2]);
  const y=t.match(/(\d{4})/);
  const year=y?Number(y[1]):0;
  if(/下学期|後期|后期/.test(t)) return year*100 + 10;
  if(/上学期|前期/.test(t))     return year*100 + 4;
  if(year) return year*100 + 6;
  return 999999;
}
/* YYYYMM 键加减 n 个月 */
function shiftYM(key, n){
  let y=Math.floor(key/100), m=key%100 + n;
  while(m>12){ m-=12; y++; } while(m<1){ m+=12; y--; }
  return y*100+m;
}
/* 「最近」的期数键：期 = 上一期 / 当前期 / 下一期（每期 3 个月，当期起点用 termOf）；月 = 上个月 / 本月 / 下个月 / 下下个月 */
function recentTermKeys(kind, today){
  const d=today||new Date();
  const ds=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  if(kind==='month'){ const cur=d.getFullYear()*100+d.getMonth()+1; return [-1,0,1,2].map(n=>shiftYM(cur,n)); }
  const cur=termSortKey(termOf(ds));
  return [-3,0,3].map(n=>shiftYM(cur,n));
}
/* 期数下拉框（其他页面用）：分「期」「月（学部美术）」两组，新的在前；某一组为空就不显示该组 */
function fillTermSelect(sel, terms, placeholder){
  sel.innerHTML='';
  if(placeholder) sel.appendChild(opt('', placeholder));
  const sorted=[...new Set(terms.filter(Boolean))].sort((a,b)=>termSortKey(b)-termSortKey(a) || String(b).localeCompare(String(a)));
  [['期', sorted.filter(t=>!isMonthTerm(t))], ['月（学部美术）', sorted.filter(isMonthTerm)]].forEach(([label,list])=>{
    if(!list.length) return;
    const g=document.createElement('optgroup'); g.label=label;
    list.forEach(t=>g.appendChild(opt(t,t)));
    sel.appendChild(g);
  });
}
/* 时长（分钟） */
function durationMin(s,e){ const p=t=>{const[a,b]=t.split(':').map(Number);return a*60+b;}; return p(e)-p(s); }

/* 就近空档：同教室当天其他空时段 + 前后 N 天同时段空的日期 */
function findNearby(bookings, roomId, dateStr, s, e, days){
  days = days||5;
  const dur = durationMin(s,e);
  const occupied = (d, ss, ee) => bookings.some(b =>
    b.status!=='rejected' && String(b.room_id)===String(roomId) &&
    bookingOnDate(b, d) && overlap(ss, ee, b.start_time, b.end_time));
  // 当天其他空时段（按开始时刻找能放下 dur 的连续空档起点）
  const sameDay=[];
  for(const st of SLOTS){
    const stMin=(()=>{const[a,b]=st.split(':').map(Number);return a*60+b;})();
    const etMin=stMin+dur; if(etMin>22*60) break;
    const et=String(Math.floor(etMin/60)).padStart(2,'0')+':'+String(etMin%60).padStart(2,'0');
    if(st===s) continue;
    if(!occupied(dateStr, st, et)) sameDay.push(st+'-'+et);
  }
  // 前后 N 天同时段
  const nearDates=[];
  for(let off=1; off<=days; off++){
    for(const d of [addDays(dateStr,off), addDays(dateStr,-off)]){
      if(!occupied(d, s, e)) nearDates.push({date:d, off});
    }
  }
  nearDates.sort((a,b)=>Math.abs(a.off)-Math.abs(b.off));
  return { sameDay: sameDay.slice(0,6), nearDates: nearDates.slice(0,6) };
}

/* 某 booking 在指定日期是否生效 */
function bookingOnDate(b, dateStr){
  if(b.recurrence === 'weekly'){
    if(b.start_date && dateStr < b.start_date) return false;
    if(b.end_date   && dateStr > b.end_date)   return false;
    return Number(b.weekday) === weekdayOf(dateStr);
  }
  return b.booking_date === dateStr;
}

/* ---------- 冲突检测 ---------- */
// 教室冲突：同教室、同日期、时间重叠（排除自身）；休讲日该课不占教室。pending（待审批）同样占位，只排除 rejected
function roomConflicts(bookings, roomId, dateStr, s, e, excludeId){
  const skip = (typeof window!=='undefined' && window.SKIPMAP) ? window.SKIPMAP : {};
  return bookings.filter(b =>
    b.id !== excludeId && b.status !== 'rejected' &&
    String(b.room_id) === String(roomId) &&
    bookingOnDate(b, dateStr) && overlap(s, e, b.start_time, b.end_time) &&
    !(b.kind==='course' && b.course_id && skip[b.course_id] && skip[b.course_id].has(dateStr)));
}
// 老师冲突：同一使用人、同日期、时间重叠，不管教室（排除自身）；休讲日该课不算。用于"再预约一间？"的确认提示
function teacherOverlaps(bookings, userName, dateStr, s, e, excludeId){
  const nm=String(userName||'').trim(); if(!nm) return [];
  const skip = (typeof window!=='undefined' && window.SKIPMAP) ? window.SKIPMAP : {};
  return bookings.filter(b =>
    b.id !== excludeId && (b.status==='pending' || b.status==='confirmed') &&
    String(b.user_name||'').trim() === nm &&
    bookingOnDate(b, dateStr) && overlap(s, e, b.start_time, b.end_time) &&
    !(b.kind==='course' && b.course_id && skip[b.course_id] && skip[b.course_id].has(dateStr)));
}
// 账号冲突：同账号、同日期、时间重叠（排除自身）；休讲日该课不占账号
function accountConflicts(bookings, accId, dateStr, s, e, excludeId){
  const skip = (typeof window!=='undefined' && window.SKIPMAP) ? window.SKIPMAP : {};
  return bookings.filter(b =>
    b.id !== excludeId && b.status !== 'rejected' &&
    b.uses_meeting && String(b.meeting_account_id) === String(accId) &&
    bookingOnDate(b, dateStr) && overlap(s, e, b.start_time, b.end_time) &&
    !(b.kind==='course' && b.course_id && skip[b.course_id] && skip[b.course_id].has(dateStr)));
}

/* ---------- DOM 小工具 ---------- */
function el(id){ return document.getElementById(id); }
function opt(v, t){ const o=document.createElement('option'); o.value=v; o.textContent=t??v; return o; }
function fillSelect(sel, arr, valFn, txtFn, placeholder){
  sel.innerHTML='';
  if(placeholder) sel.appendChild(opt('', placeholder));
  arr.forEach(x => sel.appendChild(opt(valFn?valFn(x):x, txtFn?txtFn(x):x)));
}
function esc(s){ return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(msg, ok){ // 顶部临时提示
  let t=el('__toast'); if(!t){ t=document.createElement('div'); t.id='__toast';
    t.style.cssText='position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9999;'+
      'padding:9px 16px;border-radius:6px;color:#fff;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.15)';
    document.body.appendChild(t); }
  t.style.background = ok===false ? '#d93025' : '#0f9d58';
  t.textContent = msg; t.style.opacity='1';
  clearTimeout(t.__h); t.__h=setTimeout(()=>{ t.style.opacity='0'; }, 2600);
}

/* ---------- 角色权限系统 ---------- */
// 权限项 → 显示名 + 对应页面（用于生成导航/首页卡片）
const PERM_DEFS = [
  ['board',           '教室看板',        'board.html'],
  ['timetable',       '课程表',          'timetable.html'],
  ['course_view',     '课程查询',        'courses.html'],         // 只读；有 timetable 或 course 权限的角色默认也能看
  ['meeting_view',    '腾讯会议账号占用', 'meeting.html'],
  ['entry_room',      '教室占用录入',    'booking.html'],      // 仅临时/租用（页面内再限制用途）
  ['entry_room_full', '教室占用录入',    'booking.html'],      // 全部用途（分配UI里隐藏，与上合并）
  ['approve',         '预约批准',        'admin.html?tab=pending'],
  ['assign',          '排教室',          'admin.html?tab=assign'],
  ['meeting_arrange', '会议链接设定',    'admin.html?tab=mtgsetup'],
  ['conflict',        '冲突检查',        'admin.html?tab=conflict'],
  ['occupy',          '教室占用管理',    'admin.html?tab=occupy'],
  ['room_manage',     '教室管理',        'admin.html?tab=rooms'],
  ['account_manage',  '会议账号管理',    'admin.html?tab=accounts'],
  ['course',          '课程管理',        'entry.html'],
  ['manage',          '账号与权限管理',  'admin.html'],           // 超级权限（分配UI里隐藏，仅admin）
];
const PERM_LABEL = Object.fromEntries(PERM_DEFS.map(p=>[p[0],p[1]]));
PERM_LABEL.course_audit = '课程审查';   // course_audit 只在 index.html 里判断、不进导航，这里只补显示名
const ALL_PERMS  = PERM_DEFS.map(p=>p[0]);

// 用 code 读取角色记录（含 perms）
async function getRoleByCode(code){
  if(!code) return null;
  const rows = await schedResolveCode(code);
  if(rows.length) await schedEnsureLogin(code);   // 口令有效：顺便用它登录（手动输入口令的页面也能带上身份）
  return rows.length ? rows[0] : null;
}
// 口令表已上锁（只有管理员能直接读）：用口令换角色记录只能走 rpc/resolve_sched_code，一次只返回这一个启用中的口令
async function schedResolveCode(code){
  const r = await fetch(SB_URL + '/rest/v1/rpc/resolve_sched_code', {
    method:'POST', headers:{ apikey:SB_KEY, Authorization:'Bearer '+SB_KEY, 'Content-Type':'application/json' }, body: JSON.stringify({ p_code: code }), cache:'no-store'   // 登录前就要用，必须匿名
  });
  if(!r.ok) throw new Error('口令校验失败: ' + r.status + ' ' + await r.text());
  const j = await r.json();
  return Array.isArray(j) ? j : (j ? [j] : []);
}
// 当前 URL 的 code
function currentCode(){ return new URLSearchParams(location.search).get('k') || ''; }
// ── 嵌入管理端（?embed=admin）：身份来自管理端 / 老师端的登录会话，不用口令 ──
// 管理端「资源管理」把排课首页嵌进 iframe：同一网站，localStorage 里有 sb-admin（管理员）或 sb-teacher（管理模式的负责人老师，
// 地址上带 &as=teacher）的登录 token。「问我是谁」（rpc/sched_session_role）和所有读写（sbHeaders）都带这个 token。
// 嵌入得到的身份存在 sessionStorage.sched_role_embed（不碰 sched_role），首页再给内层页面的地址加 via=admin，内层页面按 via=admin 读它——
// 所以同一个浏览器标签页里之后打开旧口令链接，读的还是 sched_role / ?k=，不会串身份。
(function(){ const q=new URLSearchParams(location.search); if(q.get('embed')==='admin'||q.get('via')==='admin'||q.get('embed')==='1') document.documentElement.classList.add('sched-embed'); })();
function schedEmbedVia(){ const q=new URLSearchParams(location.search); return q.get('embed')==='admin' || q.get('via')==='admin'; }
function schedReadToken(key){
  try{
    const o=JSON.parse(localStorage.getItem(key)||'null');
    const at=o&&(o.access_token||(o.currentSession&&o.currentSession.access_token));
    const exp=o&&(o.expires_at||(o.currentSession&&o.currentSession.expires_at));
    if(at && (!exp || exp*1000>Date.now()+5000)) return at;
  }catch(e){}
  return null;
}
async function schedEmbedRole(){
  const asTeacher=new URLSearchParams(location.search).get('as')==='teacher';
  const tok=schedReadToken(asTeacher?'sb-teacher':'sb-admin'); if(!tok) return null;
  try{
    const r=await fetch(SB_URL+'/rest/v1/rpc/sched_session_role',{method:'POST',headers:{apikey:SB_KEY,Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:'{}'});
    if(!r.ok) return null;
    const j=await r.json(); if(!j) return null;
    if(j.kind==='admin') return { role:'admin', perms:[...ALL_PERMS,'course_audit','manage'].join(','), label:'管理员' };
    if(j.kind==='teacher'){
      const perms=(j.perms||[]).filter(Boolean);
      return perms.length ? { role:'teacher', perms:perms.join(','), label:'负责人 · '+(j.name||'') } : null;
    }
  }catch(e){}
  return null;
}
// 统一获取当前身份：嵌入管理端时用登录会话；否则已登录(session)优先，其次 URL 的 ?k=（旧口令逻辑原样不变）
async function currentRole(){
  const q=new URLSearchParams(location.search);
  if(q.get('embed')==='admin'){
    const r=await schedEmbedRole();
    try{ if(r) sessionStorage.setItem('sched_role_embed',JSON.stringify(r)); else sessionStorage.removeItem('sched_role_embed'); }catch(e){}
    return r;
  }
  if(q.get('via')==='admin'){ try{ const s=sessionStorage.getItem('sched_role_embed'); if(s) return JSON.parse(s); }catch(e){} return null; }
  try{ const s=sessionStorage.getItem('sched_role'); if(s) return JSON.parse(s); }catch(e){}
  const code=currentCode();
  if(code){ const r=await getRoleByCode(code); if(r){ try{ sessionStorage.setItem('sched_role',JSON.stringify(r)); }catch(e){} } return r; }
  return null;
}
// 各功能页拿「这个页面的身份」：嵌入管理端时用 currentRole()；独立打开时和以前一样只看 ?k=
function pageRole(){ return schedEmbedVia() ? currentRole() : getRoleByCode(currentCode()); }
function isAdminRole(r){ return !!(r && (r.role==='admin' || (r.perms&&r.perms.split(',').map(s=>s.trim()).includes('manage')))); }
// 角色的权限集合
function permSet(roleRec){ return new Set((roleRec&&roleRec.perms?roleRec.perms.split(','):[]).map(s=>s.trim()).filter(Boolean)); }
function hasPerm(roleRec, p){ return permSet(roleRec).has(p); }

/* ---------- 口令校验（旧版兼容，逐步弃用）---------- */
async function checkCode(code, needRole){
  const rows = await schedResolveCode(code);
  if(!rows.length) return null;
  const rec = rows[0];
  if(needRole === 'entry') return (rec.role==='entry'||rec.role==='admin'||hasPerm(rec,'course')||hasPerm(rec,'entry_room')||hasPerm(rec,'entry_room_full')) ? rec : null;
  if(needRole === 'admin') return (rec.role==='admin'||hasPerm(rec,'manage')) ? rec : null;
  return rec;
}

/* ---------- 顶部导航（按角色权限生成；带 code 时链接自动带上 ?k=）---------- */
function renderNav(active, roleRec){
  if(new URLSearchParams(location.search).get('embed')==='1') return '';  // 被 admin iframe 嵌入时隐藏导航
  const code = currentCode();
  const kq = code ? ('?k='+encodeURIComponent(code)) : '';
  // 有角色记录 → 按权限生成；否则显示全部（管理员/开发用）
  let items;
  if(roleRec){
    const ADMIN_ONLY = new Set(['assign','approve','meeting_arrange','conflict','manage']);
    const ps = permSet(roleRec);
    if(ps.has('timetable') || ps.has('course')) ps.add('course_view');   // 课程查询：有课程表/课程管理权限的角色默认可见
    const seen = new Set();
    items = [];
    PERM_DEFS.forEach(([perm,label,page])=>{
      if(!ps.has(perm)) return;
      if(ADMIN_ONLY.has(perm)) return;                 // admin 专属功能不进导航（避免跳 admin）
      const base = page.split('?')[0];
      if(seen.has(base)) return; seen.add(base);       // 同页去重（如两种录入都指向 booking）
      items.push([base, label]);
    });
    items.unshift(['index.html','首页']);
  }else{
    items = [
      ['index.html','首页'],['board.html','教室看板'],['timetable.html','课程表'],['courses.html','课程查询'],
      ['booking.html','教室占用录入'],['meeting.html','会议账号'],
      ['entry.html','录入'],['admin.html','管理']
    ];
  }
  const label = roleRec ? (roleRec.label||roleRec.role||'') : '';
  return '<header class="top"><div class="wrap"><h1>唯新 · 教学资源调度</h1><nav>'+
    items.map(([h,t])=>{
      const href = h.includes('?') ? h+(code?('&k='+encodeURIComponent(code)):'') : h+kq;
      return `<a href="${href}"${h===active?' style="color:var(--blue);font-weight:600"':''}>${t}</a>`;
    }).join('')+
    (label?`<span style="color:var(--sub);font-size:12px;margin-left:8px">${esc(label)}</span>`:'')+
    '</nav></div></header>';
}
