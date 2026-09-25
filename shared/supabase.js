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
    try { client.auth.onAuthStateChange((_evt, session) => { __SB_TOKEN = (session && session.access_token) || null; }); } catch(e){}
  }
}
// 每个页面声明自己的身份 storageKey（admin/teacher/student），sb() 只认这一个，
// 绝不去翻别人的 token —— 否则同一浏览器里多身份 token 会互相串（admin 抓到老师/学生的）。
let __SB_STORAGEKEY = null;
function __setSbStorageKey(k){ __SB_STORAGEKEY = k || null; }
function __getSbToken(){
  if (__SB_TOKEN) return __SB_TOKEN;
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

async function sb(path, method = 'GET', body = null) {
  // 登录前的 resolve（换id）必须用匿名公钥调：此时还没有合法 token，
  // 若误带了别的端残留/过期的 token，会被当成"已登录但token无效"而拒绝（返回 null）。
  const _isLoginResolve = /rpc\/resolve_student_login/.test(path);
  const _tok = _isLoginResolve ? null : __getSbToken();
  const _auth = _tok ? ('Bearer ' + _tok) : ('Bearer ' + SB_KEY);
  const opts = {
    method,
    headers: {
      'apikey': SB_KEY,
      'Authorization': _auth,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
  if (body) opts.body = JSON.stringify(_normTimeColon(body));
  const r = await fetch(SB_URL + path, opts);
  if (!r.ok) { const e = await r.text(); throw new Error(e); }
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
