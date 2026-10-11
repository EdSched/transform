// ── Supabase client ──
const SB_URL = 'https://vwntezfvqbrkeovnseku.supabase.co';
const SB_KEY = 'sb_publishable_cUnCkti5qv1_G4N6Ho5tpw_9pr7pSas';

// 只把时间字段（time_range/start_time/end_time）里的全角冒号「：」转半角「:」
// 不碰名字/备注/文案等字段（那些用全角冒号是正常中文写法）
const _TIME_FIELDS = ['time_range','start_time','end_time'];
function _normTimeColon(v){
  if (Array.isArray(v)) return v.map(_normTimeColon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k in v) {
      if (_TIME_FIELDS.includes(k) && typeof v[k] === 'string') o[k] = v[k].replace(/：/g, ':');
      else o[k] = _normTimeColon(v[k]);
    }
    return o;
  }
  return v;
}

// ── 当前登录 token（RLS 用）──
// 各端登录后可设 window.__SB_TOKEN；未设时自动从 localStorage 的 storageKey 里找已存的 session token。
// 读到 token 就用它（数据库按身份放行 RLS），读不到就退回公钥（不影响未锁的表）。
let __SB_TOKEN = null;
let __SB_AUTHCLIENT = null;   // 登录端交进来的"活客户端"（带 autoRefreshToken，会自动续期）
// 登录后调用：可传 token 字符串（即时用），也传入客户端（后续自动取新鲜 token）
function __setSbToken(t, client){
  __SB_TOKEN = t || null;
  if (client) __SB_AUTHCLIENT = client;
  // 客户端会在 token 刷新时通知我们，实时更新缓存的 token
  if (client && client.auth && client.auth.onAuthStateChange && !client.__hooked) {
    client.__hooked = true;
    try { client.auth.onAuthStateChange((_evt, session) => { __SB_TOKEN = (session && session.access_token) || null; __sbCheckStatus(); }); } catch(e){}
  }
  __sbCheckStatus();
}
// 每个页面声明自己的身份 storageKey（admin/teacher/student），sb() 只认这一个，
// 绝不去翻别人的 token —— 否则同一浏览器里多身份 token 会互相串（admin 抓到老师/学生的）。
let __SB_STORAGEKEY = null;
function __setSbStorageKey(k){ __SB_STORAGEKEY = k || null; }
// 读本页自己 storageKey 里没过期的 token（别的标签页续好后写回的也算）
function __readStoredToken(){
  try {
    const k = __SB_STORAGEKEY;                    // 只读当前页面自己的那个 key
    if (!k) return null;                          // 没声明身份就只用公钥（未锁表不受影响）
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const o = JSON.parse(raw);
    const at = o && (o.access_token || (o.currentSession && o.currentSession.access_token));
    const exp = o && (o.expires_at || (o.currentSession && o.currentSession.expires_at));
    if (at && (!exp || exp * 1000 > Date.now())) return at;   // 只用自己的、没过期的
  } catch (e) {}
  return null;
}
function __getSbToken(){
  if (__SB_TOKEN) return __SB_TOKEN;
  return __readStoredToken();
}
// JWT 是否已过期（解析不了按没过期算）
function __sbTokenExpired(t){
  try {
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return !!(p && p.exp && p.exp * 1000 <= Date.now() + 5000);
  } catch (e) { return false; }
}
// 身份状态：ok 有效 / refreshing 正在续期 / none 没有身份。变化时发 'sbstatus' 事件（管理模式顶栏小圆点用）
let __SB_STATUS = 'ok', __SB_RENEWING = null;
function __sbSetStatus(st){
  if (st === __SB_STATUS) return;
  __SB_STATUS = st;
  try { window.dispatchEvent(new CustomEvent('sbstatus', { detail: st })); } catch (e) {}
}
function __sbCheckStatus(){
  if (__SB_RENEWING) return __SB_STATUS;
  const t = __getSbToken();
  __sbSetStatus(t && !__sbTokenExpired(t) ? 'ok' : 'none');
  return __SB_STATUS;
}
// 多个标签页共用同一个 storageKey：别的标签页续期 / 退出后，同步本页缓存的 token
try {
  window.addEventListener('storage', e => {
    if (!__SB_STORAGEKEY || (e.key !== null && e.key !== __SB_STORAGEKEY)) return;
    __SB_TOKEN = __readStoredToken();
    __sbCheckStatus();
  });
} catch (e) {}
// 写入前拿一个新鲜的 token：有活客户端就让它取（过期会自动续期），取不到再读 localStorage
async function __sbFreshToken(){
  if (__SB_AUTHCLIENT) {
    try {
      const r = await __SB_AUTHCLIENT.auth.getSession();
      const t = r && r.data && r.data.session && r.data.session.access_token;
      if (t && !__sbTokenExpired(t)) { __SB_TOKEN = t; return t; }
    } catch (e) {}
  }
  const t = __readStoredToken();
  if (t) __SB_TOKEN = t;
  return t || (__SB_TOKEN && !__sbTokenExpired(__SB_TOKEN) ? __SB_TOKEN : null);
}
// 强制续期（并发只做一次）：refreshSession 失败就重新读 localStorage（别的标签页可能已经续好了）
function __sbRenew(){
  if (__SB_RENEWING) return __SB_RENEWING;
  __sbSetStatus('refreshing');
  __SB_RENEWING = (async () => {
    let t = null;
    if (__SB_AUTHCLIENT) {
      try {
        const r = await __SB_AUTHCLIENT.auth.refreshSession();
        t = r && r.data && r.data.session && r.data.session.access_token;
      } catch (e) {}
    }
    if (!t) t = await __sbFreshToken();
    // 续期也不行（会话已被清掉）：页面若登记了静默重新登录（管理模式用老师 id 重新登录），就用它
    if (!t && typeof window !== 'undefined' && typeof window.__sbRelogin === 'function') {
      try { t = await window.__sbRelogin(); } catch (e) {}
    }
    __SB_TOKEN = t || null;
    return t || null;
  })().finally(() => { __SB_RENEWING = null; __sbCheckStatus(); });
  return __SB_RENEWING;
}
function __sbIdentityLostMsg(){
  if (__SB_STORAGEKEY === 'sb-admin') return '登录身份已失效，请退出后用邮箱重新登录';
  if (__SB_STORAGEKEY === 'sb-teacher') {
    return (typeof ACCESS_KEY !== 'undefined' && ACCESS_KEY && ACCESS_KEY._asTeacher)
      ? '登录身份已过期，请回到老师端刷新页面，再点「管理模式」进入。'
      : '登录身份已过期，请刷新页面后重试。';
  }
  return '登录已过期，请刷新页面后重试。';
}

async function sb(path, method = 'GET', body = null, extra = null) {   // extra：额外的 fetch 选项（如 { cache: 'no-store' }）
  // 登录前的 resolve（换id）必须用匿名公钥调：此时还没有合法 token，
  // 若误带了别的端残留/过期的 token，会被当成"已登录但token无效"而拒绝（返回 null）。
  const _isLoginResolve = /rpc\/resolve_student_login/.test(path);
  const _isWrite = String(method).toUpperCase() !== 'GET' && !_isLoginResolve;
  const _send = tok => {
    const opts = {
      method,
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + (tok || SB_KEY),
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    };
    if (body) opts.body = JSON.stringify(_normTimeColon(body));
    if (extra) Object.assign(opts, extra);
    return fetch(SB_URL + path, opts);
  };
  // 写入前先确保身份新鲜（过期会自动续期）；读取沿用缓存的 token
  let _tok = _isLoginResolve ? null : (_isWrite ? await __sbFreshToken() : __getSbToken());
  // 写入时一个有效身份都没有，而页面登记了静默重新登录：先登录再写，不先发一次匿名请求
  if (_isWrite && !_tok && typeof window !== 'undefined' && typeof window.__sbRelogin === 'function') _tok = await __sbRenew();
  let r = await _send(_tok);
  if (!r.ok) {
    let e = await r.text();
    const authFail = x => r.status === 401 || /"code"\s*:\s*"(42501|PGRST30\d)"/.test(x) || /JWT/i.test(x);
    // 写入被拒，且这次没带 token 或 token 已过期：续期后自动重试一次
    if (_isWrite && __SB_STORAGEKEY && authFail(e) && (!_tok || __sbTokenExpired(_tok) || r.status === 401)) {
      const nt = await __sbRenew();
      if (nt && nt !== _tok) {
        _tok = nt;
        r = await _send(_tok);
        if (r.ok) { const t0 = await r.text(); return t0 ? JSON.parse(t0) : []; }
        e = await r.text();
      }
      // 重试后仍然没有有效身份：不显示数据库原文
      if (authFail(e) && (!_tok || __sbTokenExpired(_tok))) throw new Error(__sbIdentityLostMsg());
    }
    // 管理端没带登录 token（用的是公钥）写入被数据库拒绝：多半是 Supabase 会话已失效，给出能照着做的提示
    if (!_tok && __SB_STORAGEKEY === 'sb-admin' && /"code"\s*:\s*"42501"/.test(e)) throw new Error('登录身份已失效，请退出后用邮箱重新登录');
    if (_isWrite && !_tok && __SB_STORAGEKEY && authFail(e)) throw new Error(__sbIdentityLostMsg());
    throw new Error(e);
  }
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}

// ── Fetch all rows (bypasses 1000-row default limit) ──
async function sbAll(path) {
  const pageSize = 1000;
  let all = [], offset = 0;
  const sep = path.includes('?') ? '&' : '?';
  while (true) {
    const batch = await sb(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    all = all.concat(batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

// ── Supabase Storage ──
// Upload a file to a public bucket, returns the public URL
async function sbUpload(bucket, path, file) {
  const url = `${SB_URL}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: file
  });
  if (!r.ok) { const e = await r.text(); throw new Error(e); }
  return `${SB_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// ── 学生登录（姓名 + 查询码）共用流程：学习记录页 / VIP 页 ──
// ① RPC 用姓名+码换出 student_id（只有这一步明确查不到，才算「姓名或查询码不对」）
// ② 用 id+码 走 Auth 登录拿 token；③ 带 token 读自己那条 students
// ②③ 在网络抖动、token 刚签发未生效时会失败，这里自动重试，不再误报「查不到」。
// onStatus(text) 用来在页面上显示「正在查找账号…」等进度。
// 返回 { ok:true, student } | { ok:false, reason:'not_found' | 'network' }
let __STUDENT_AUTH_CLIENT = null;
async function studentLogin(name, code, onStatus) {
  const say = t => { try { if (onStatus) onStatus(t); } catch (e) {} };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  let sid = null;
  for (let i = 0; i < 3; i++) {
    say(i ? '网络较慢，正在重新查找账号…' : '正在查找账号…');
    try {
      const r = await sb('/rest/v1/rpc/resolve_student_login', 'POST', { p_name: name, p_code: code });
      sid = Array.isArray(r) ? r[0] : r;
      if (!sid) return { ok: false, reason: 'not_found' };
      break;
    } catch (e) {
      if (i === 2) return { ok: false, reason: 'network' };
      await wait(600 * (i + 1));
    }
  }

  const email = `${sid}@student.local`;
  for (let i = 0; i < 4; i++) {
    say(i ? `正在验证身份…（第 ${i + 1} 次尝试）` : '正在验证身份…');
    try {
      if (typeof supabase !== 'undefined' && supabase.createClient) {
        if (!__STUDENT_AUTH_CLIENT) __STUDENT_AUTH_CLIENT = supabase.createClient(SB_URL, SB_KEY, { auth: { storageKey: 'sb-student', persistSession: true, autoRefreshToken: true } });
        const c = __STUDENT_AUTH_CLIENT;
        let sess = (await c.auth.getSession()).data;
        const mine = () => sess && sess.session && sess.session.user && sess.session.user.email === email;
        if (!mine()) {
          await c.auth.signInWithPassword({ email, password: code });
          sess = (await c.auth.getSession()).data;
        }
        __setSbStorageKey('sb-student');
        if (mine()) __setSbToken(sess.session.access_token, c);   // 传客户端→自动续期
      }
    } catch (e) { /* 网络抖动等：下面读档案失败后退避重试 */ }
    try {
      say('正在读取学生档案…');
      const rows = await sb(`/rest/v1/students?id=eq.${encodeURIComponent(sid)}&select=*`);
      if (rows && rows.length) return { ok: true, student: rows[0] };
    } catch (e) {}
    await wait(700 * (i + 1));
  }
  return { ok: false, reason: 'network' };
}

// ── 学生本机登录记录（学习页 study.html 与面谈预约页 student/ 共用同一个 key）──
// 内容：{ id, name, code, major, ts }；30 天内有效
const STUDENT_LOGIN_STORAGE_KEY = 'txe_study_login';
const STUDENT_LOGIN_DAYS = 30;
function studentLoginLoad() {
  try {
    const raw = localStorage.getItem(STUDENT_LOGIN_STORAGE_KEY);
    if (!raw) return null;
    const info = JSON.parse(raw);
    if (!info || !info.name || !info.code) return null;
    if (Date.now() - (info.ts || 0) >= STUDENT_LOGIN_DAYS * 86400000) return null;
    return info;
  } catch (e) { return null; }
}
function studentLoginSave(info) {
  try { localStorage.setItem(STUDENT_LOGIN_STORAGE_KEY, JSON.stringify(Object.assign({}, info, { ts: Date.now() }))); } catch (e) {}
}
