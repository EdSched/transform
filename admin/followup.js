// 管理端「面谈跟进」：和老师端同一套（shared/follow-up.js），这里只做管理端自己的筛选和入口。
// 筛选：搜索（最上面，输入时不受其他筛选限制）· 领域 / 专业 / 来源（DMF，shared/constants.js）；各自独立、可以组合。
// 打开时不列学生：多个领域时要先选领域 / 专业，或者搜索姓名。
const FUA = { q: '', shown: LIST_PAGE };

function fuaPool() { return (typeof cachedStudents !== 'undefined' ? cachedStudents : []).filter(s => studentInCurrentView(s)); }
function fuaNeedPick() {
  return !FUA.q.trim() && !DMF.domain && !DMF.major && scopeDomainList().length !== 1;
}
function fuaFilter(list) {
  const q = FUA.q.trim();
  const act = fuOnlyActive(list);   // 只看在籍，搜索也只在在籍里搜
  if (q) return act.filter(s => matchesStudentSearch(s, q));
  return dmfFilter(act);
}
function fuaTopHtml() {
  const pool = fuaPool();
  return `<div class="search-bar"><input id="fua_q" placeholder="搜索学生（汉字 / 拼音首字母）…" value="${fuEsc(FUA.q)}" oninput="searchBox(this,fuaSearch)"></div>
    ${domMajorFilterHtml(DMF, 'fuaRefresh()', pool, { also: s => !s.status || s.status === 'active' })}`;
}
const fuaIsFocus = () => curPage === 'focus';
function fuaDraw(listOnly) { return fuaIsFocus() ? focusRender() : (listOnly ? tmRenderList() : tmRenderShell()); }
function fuaSearch(q) {
  FUA.q = q || ''; FUA.shown = LIST_PAGE;
  fuaDraw(true);
  if (fuaIsFocus()) { const el = document.getElementById('fua_q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }   // 重点关注整块重画，把光标放回搜索框
}
function fuaRefresh() { FUA.shown = LIST_PAGE; fuaDraw(false); }
function fuaMore() { FUA.shown += LIST_PAGE; fuaDraw(true); }

fuSetHost({
  top: fuaTopHtml,
  need: () => fuaNeedPick() ? '<div class="empty" style="padding:40px">请先选择领域或专业，或在上面搜索学生姓名</div>' : '',
  filter: fuaFilter,
  query: () => FUA.q,
  slice: l => l.slice(0, FUA.shown),
  more: n => n <= FUA.shown ? '' : `<div onclick="fuaMore()" style="text-align:center;padding:10px;margin:6px 0;font-size:11px;color:var(--accent);border:1px dashed var(--border);border-radius:4px;cursor:pointer">加载更多（还有 ${n - FUA.shown} 人）</div>`,
  reset: () => { FUA.shown = LIST_PAGE; },
  box: () => document.getElementById('mainContent'),
  reload: () => (curPage === 'focus' ? renderFocusPage : renderFollowUpPage)(document.getElementById('mainContent')),
});

async function renderFollowUpPage(mc) {
  if (!tmYm) tmYm = tmCurYm();
  const keepQ = document.getElementById('fua_q') ? true : false;
  if (!keepQ) mc.innerHTML = '<div class="loading">加载中…</div>';
  try {
    tmData = await tmLoadFollow(fuaPool());
  } catch (e) { mc.innerHTML = `<div class="empty">加载失败：${fuEsc(e.message)}</div>`; return; }
  tmRenderShell();
}

// 管理端「重点关注」：到期临近 / 本月无面谈无记录 / 连续 3 次未回复 / 缺席 3 次以上；点学生打开「学生概要」（和老师端同一份）
async function renderFocusPage(mc) {
  if (!document.getElementById('fua_q')) mc.innerHTML = '<div class="loading">加载中…</div>';
  try {
    if (fuaNeedPick()) { focusStudents = []; focusTm = null; focusSms = null; focusRender(); return; }   // 没选范围先不读数据
    await focusLoad(fuaPool());
    focusRender();
  } catch (e) { mc.innerHTML = `<div class="empty" style="color:var(--danger)">重点关注加载失败：${(e && e.message) || e}</div>`; }
}
