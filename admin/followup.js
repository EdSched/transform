// 管理端「面谈跟进」：和老师端同一套（shared/follow-up.js），这里只做管理端自己的筛选和入口。
// 筛选：搜索（最上面，输入时不受其他筛选限制）· 领域 / 专业 / 来源（DMF，shared/constants.js）· 状态；各自独立、可以组合。
// 打开时不列学生：多个领域时要先选领域 / 专业，或者搜索姓名。
const FUA = { q: '', status: 'active', shown: 30 };
const FUA_STATUS = [['active', '在籍'], ['stopped', '停课'], ['graduated', '已合格'], ['', '全部']];

function fuaPool() { return (typeof cachedStudents !== 'undefined' ? cachedStudents : []).filter(s => studentInCurrentView(s)); }
function fuaNeedPick() {
  return !FUA.q.trim() && !DMF.domain && !DMF.major && scopeDomainList().length !== 1;
}
function fuaFilter(list) {
  const q = FUA.q.trim();
  if (q) return (list || []).filter(s => matchesStudentSearch(s, q));
  return dmfFilter(list || []).filter(s => !FUA.status || (s.status || 'active') === FUA.status);
}
function fuaTopHtml() {
  const pool = fuaPool();
  const chips = FUA_STATUS.map(([k, l]) => `<div class="filter-chip${FUA.status === k ? ' active' : ''}" onclick="FUA.status='${k}';fuaRefresh()">${l}</div>`).join('');
  return `<div class="search-bar"><input id="fua_q" placeholder="搜索学生（汉字 / 拼音首字母）…" value="${fuEsc(FUA.q)}" oninput="searchBox(this,fuaSearch)"></div>
    ${domMajorFilterHtml(DMF, 'fuaRefresh()', pool, { also: s => !FUA.status || (s.status || 'active') === FUA.status })}
    <div class="filter-row"><span style="font-size:10px;color:var(--text-3);min-width:30px;align-self:center">状态</span>${chips}</div>`;
}
function fuaSearch(q) {
  FUA.q = q || ''; FUA.shown = 30;
  tmRenderList();
}
function fuaRefresh() { FUA.shown = 30; tmRenderShell(); }
function fuaMore() { FUA.shown += 30; tmRenderList(); }

fuSetHost({
  top: fuaTopHtml,
  need: () => fuaNeedPick() ? '<div class="empty" style="padding:40px">请先选择领域或专业，或在上面搜索学生姓名</div>' : '',
  filter: fuaFilter,
  slice: l => l.slice(0, FUA.shown),
  more: n => n <= FUA.shown ? '' : `<div onclick="fuaMore()" style="text-align:center;padding:10px;margin:6px 0;font-size:11px;color:var(--accent);border:1px dashed var(--border);border-radius:4px;cursor:pointer">显示更多（还有 ${n - FUA.shown} 人）</div>`,
  reset: () => { FUA.shown = 30; },
  box: () => document.getElementById('mainContent'),
  reload: () => renderFollowUpPage(document.getElementById('mainContent')),
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
