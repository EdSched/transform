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
  const _tok = __getSbToken();
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
