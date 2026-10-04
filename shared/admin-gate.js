// ── 管理端登录检查（给 results/admin.html、salary/admin.html 这类独立管理页用）──
// 复用管理端的登录状态（storageKey 'sb-admin'），页面本身没有登录入口：
// 没登录就盖一层「请先登录管理端」；登录了就把 token 交给 shared/supabase.js 的 sb()/__getSbToken()。
// 依赖：先加载 supabase-js（jsdelivr + shared/vendor 兜底）和 shared/supabase.js。
// 用法：adminGate({ adminOnly:true })  → Promise<boolean>（true=已登录）
async function adminGate(opts) {
  opts = opts || {};
  const adminHref = opts.adminHref || '../admin/';
  const showBlock = (msg) => {
    if (document.getElementById('adminGateOverlay')) return;
    const d = document.createElement('div');
    d.id = 'adminGateOverlay';
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#f7f5f0;display:flex;align-items:center;justify-content:center;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;';
    d.innerHTML = '<div style="background:#fff;border:1px solid #e2ded6;border-radius:8px;padding:28px 32px;max-width:360px;text-align:center;color:#1a1814;">' +
      '<div style="font-size:16px;font-weight:600;margin-bottom:8px;">请先登录管理端</div>' +
      '<div style="font-size:13px;color:#5a5650;margin-bottom:16px;">' + msg + '</div>' +
      '<a href="' + adminHref + '" style="display:inline-block;padding:8px 18px;background:#b8953a;color:#fff;border-radius:6px;text-decoration:none;font-size:14px;">打开管理端</a>' +
      '<div style="font-size:12px;color:#9a9590;margin-top:12px;">登录后回到本页刷新即可</div></div>';
    document.body.appendChild(d);
  };
  try {
    if (typeof supabase === 'undefined' || !supabase.createClient) { showBlock('登录组件未加载，请刷新页面重试。'); return false; }
    const c = supabase.createClient(SB_URL, SB_KEY, { auth: { storageKey: 'sb-admin', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    const { data } = await c.auth.getSession();   // token 过期会在这里自动续期
    const ses = data && data.session;
    const email = (ses && ses.user && ses.user.email) || '';
    if (!ses) { showBlock('本页需要管理员身份，请先在管理端登录。'); return false; }
    // 领域链接 / 老师 / 学生的临时账号都不算管理员
    if (opts.adminOnly && /@(access|teacher|student)\.local$/.test(email)) { showBlock('本页只有管理员能用，请用管理员邮箱登录管理端。'); return false; }
    __setSbStorageKey('sb-admin');
    __setSbToken(ses.access_token, c);
    return true;
  } catch (e) {
    console.warn('adminGate 失败:', e && e.message);
    showBlock('登录状态读取失败，请先登录管理端后刷新。');
    return false;
  }
}
// 带登录身份的请求头（没登录退回匿名 key，由数据库拒绝）
function adminAuthHeaders(extra) {
  const t = (typeof __getSbToken === 'function' && __getSbToken()) || SB_KEY;
  return Object.assign({ 'apikey': SB_KEY, 'Authorization': 'Bearer ' + t }, extra || {});
}
