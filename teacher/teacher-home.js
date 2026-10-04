// ══════════════════════════════════
// teacher-home.js — 老师端首页细节：昵称（名字旁）、顶部「管理模式 / 资源管理」按钮、首页快捷卡片
// 快捷卡片存在 teachers.home_shortcuts（jsonb 数组，建字段 SQL：seed/teacher_home_shortcuts.sql）：
//   {type:'tab',tab} / {type:'sub',tab,sub} / {type:'student',id,label} / {type:'course',id,label} / {type:'resource'}
//   一张都不留时存 [{type:'empty'}]（和「从来没设置过」区分：没设置过会显示默认的前 4 个标签）
// 依赖：teacher.js（teacherData、teacherName、switchTab、curTab、cachedTeacher*、confirmedSessions）、teacher-students.js（smTab、smAllowedItems）
// ══════════════════════════════════
const HOME_MAX = 8;
let teacherTabList = [];        // buildTabs 设置：[{id,label}]
let homeList = [];              // 老师自己的快捷卡片（已保存的）
let homeCustom = false;         // 是否设置过（没设置过就显示默认卡片，不落库）
let homeEditing = false, homeAddOpen = false;
let homeStuInfo = {};           // 学生 id → {name,major} | null（已不存在）
const homeEsc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const homeJs = v => homeEsc(String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const homePlain = s => String(s || '').replace(/^[^一-龥A-Za-z0-9]+\s*/, '');   // 去掉标签名前面的 emoji

// ── 顶部按钮：管理模式（负责人）/ 资源管理（有资源权限）──
function homeHeaderBtns() {
  const box = document.getElementById('headerBtns'); if (!box || !teacherData || !teacherData.id) return;
  if (managerScopeNonEmpty(teacherData.manage_scope) && !document.getElementById('mgrModeBtn')) {
    const a = document.createElement('a');
    a.id = 'mgrModeBtn'; a.className = 'hbtn'; a.href = '../admin/index.html?as=teacher'; a.textContent = '管理模式';
    box.appendChild(a);
  }
  if (homeResourceOk() && !document.getElementById('resBtn')) {
    const b = document.createElement('button');
    b.id = 'resBtn'; b.className = 'hbtn' + (curTab === 'resource' ? ' on' : ''); b.textContent = '资源管理'; b.onclick = () => switchTab('resource');
    box.appendChild(b);
  }
}
function homeResourceOk() { return !!(teacherData && Array.isArray(teacherData.resource_perms) && teacherData.resource_perms.length); }
// 「资源管理」：留在老师端，主区域换成排课系统（用本页的 sb-teacher 会话取身份，权限按 resource_perms）
async function renderResourceFrame(mc) {
  if (!homeResourceOk()) { mc.innerHTML = '<div class="empty">没有资源管理权限</div>'; return; }
  try { if (window.__teacherAuthClient) await window.__teacherAuthClient.auth.getSession(); } catch (e) {}   // 先让会话续期，免得嵌入页读到过期 token
  mc.innerHTML = '<iframe src="../sched/index.html?embed=admin&as=teacher" style="width:100%;height:calc(100vh - 150px);min-height:480px;border:0;display:block"></iframe>';
}

// ── 昵称：名字旁的小字 + 点开的小框 ──
function homeNickRender() {
  const el = document.getElementById('headerNick'); if (!el || !teacherData) return;
  const nk = (teacherData.display_name || '').trim();
  el.innerHTML = nk
    ? `<span onclick="homeNickToggle()" style="cursor:pointer;font-size:11px;color:var(--text-3)">昵称：${homeEsc(nk)}</span>`
    : `<span onclick="homeNickToggle()" style="cursor:pointer;font-size:11px;color:var(--warn)">点击设置昵称</span>`;
}
function homeNickToggle() {
  let box = document.getElementById('nickBox');
  if (box) { box.remove(); return; }
  box = document.createElement('div');
  box.id = 'nickBox';
  box.style.cssText = 'position:absolute;left:0;top:100%;z-index:50;margin-top:8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:10px 12px;width:280px;max-width:86vw;box-shadow:0 4px 14px rgba(0,0,0,.08)';
  box.innerHTML = `<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">学生预约页面显示的名字，留空则显示真实姓名「${homeEsc(teacherName)}」</div>
    <input id="displayNameInput" type="text" value="${homeEsc(teacherData.display_name || '')}" placeholder="输入昵称（可留空）" style="width:100%;font-size:12px;padding:6px 9px;margin-bottom:8px">
    <div style="display:flex;gap:6px;justify-content:flex-end">
      <button onclick="document.getElementById('nickBox').remove()" style="background:none;border:1px solid var(--border);border-radius:3px;padding:5px 12px;font-size:11px;cursor:pointer;font-family:inherit;color:var(--text-2)">取消</button>
      <button onclick="saveDisplayName()" style="background:var(--accent);color:#fff;border:none;border-radius:3px;padding:5px 14px;font-size:11px;cursor:pointer;font-family:inherit">保存</button>
    </div>`;
  const host = document.getElementById('headerLeft'); if (!host) return;
  host.appendChild(box);
  document.getElementById('displayNameInput').focus();
}

// ── 快捷卡片 ──
const HOME_SUBS = {   // 有分页的标签：怎么列出分页、怎么切到某个分页
  studentmgmt: { list: () => (typeof smAllowedItems === 'function' ? smAllowedItems() : []), set: k => { smTab = k; } },
};
function homeLoad() {
  const raw = Array.isArray(teacherData && teacherData.home_shortcuts) ? teacherData.home_shortcuts : [];
  homeCustom = raw.length > 0;
  homeList = raw.filter(x => x && x.type && x.type !== 'empty');
}
function homeTabIds() { return new Set(teacherTabList.map(t => t.id)); }
function homeTabLabel(id) { const t = teacherTabList.find(x => x.id === id); return t ? homePlain(t.label) : id; }
function homeDefaults() { return teacherTabList.filter(t => t.id !== 'todo').slice(0, 4).map(t => ({ type: 'tab', tab: t.id })); }
function homeShown() { return homeCustom ? homeList : homeDefaults(); }
function homeKey(it) { return [it.type, it.tab || '', it.sub || '', it.id || ''].join('|'); }
function homeAllowed(it) {
  const ids = homeTabIds();
  if (it.type === 'tab') return ids.has(it.tab);
  if (it.type === 'sub') return ids.has(it.tab) && !!HOME_SUBS[it.tab] && HOME_SUBS[it.tab].list().some(([k]) => k === it.sub);
  if (it.type === 'student') return ids.has('studentmgmt') || ids.has('booking');
  if (it.type === 'course') return ids.has('mycourses');
  if (it.type === 'resource') return homeResourceOk();
  return false;
}
function homeGone(it) {
  if (it.type === 'student') return homeStuInfo[it.id] === null;
  if (it.type === 'course') return !(confirmedSessions || []).some(s => String(s.course_id) === String(it.id));
  return false;
}
function homeText(it) {
  if (it.type === 'tab') return [homeTabLabel(it.tab), '页面'];
  if (it.type === 'sub') { const s = HOME_SUBS[it.tab].list().find(([k]) => k === it.sub); return [homePlain(s ? s[1] : it.sub), homeTabLabel(it.tab) + ' · 分页']; }
  if (it.type === 'student') { const i = homeStuInfo[it.id]; return [it.label || (i && i.name) || '学生', '学生' + (i && i.major ? ' · ' + (typeof majorLabel === 'function' ? majorLabel(i.major) : i.major) : '')]; }
  if (it.type === 'course') return [it.label || '课程', '课程'];
  return ['资源管理', '排课系统'];
}
const HOME_STRIPE = { student: '#9bb0a0', course: '#c9a27a', resource: '#b9a9c9', tab: '', sub: '' };

async function homeSave() {
  const payload = homeList.length ? homeList : [{ type: 'empty' }];
  const q = teacherData.id ? `id=eq.${encodeURIComponent(teacherData.id)}` : `name=eq.${encodeURIComponent(teacherName)}`;
  try { await sb(`/rest/v1/teachers?${q}`, 'PATCH', { home_shortcuts: payload }); teacherData.home_shortcuts = payload; homeCustom = true; return true; }
  catch (e) { alert('保存失败：' + (e.message || e) + '\n（如果提示找不到 home_shortcuts 字段，说明准备 SQL 还没执行）'); return false; }
}
function homeMaterialize() { if (!homeCustom) { homeList = homeDefaults(); homeCustom = true; } }
function homeHas(it) { return homeShown().some(x => homeKey(x) === homeKey(it)); }
async function homeAdd(it) {
  homeMaterialize();
  if (homeList.some(x => homeKey(x) === homeKey(it))) return true;
  if (homeList.length >= HOME_MAX) { alert('首页最多 ' + HOME_MAX + ' 个，请先移除一个'); return false; }
  homeList.push(it);
  if (!(await homeSave())) { homeList.pop(); return false; }
  return true;
}
async function homeRemoveKey(key) {
  homeMaterialize();
  const old = homeList.slice(); homeList = homeList.filter(x => homeKey(x) !== key);
  if (!(await homeSave())) homeList = old;
}
async function homeRemove(i) {
  const key = homeKey(homeShownVisible()[i]); await homeRemoveKey(key); homeRender();
}
async function homeMove(i, d) {
  const vis = homeShownVisible(), a = vis[i], b = vis[i + d]; if (!a || !b) return;
  homeMaterialize();
  const ia = homeList.findIndex(x => homeKey(x) === homeKey(a)), ib = homeList.findIndex(x => homeKey(x) === homeKey(b));
  if (ia < 0 || ib < 0) return;
  const old = homeList.slice(); [homeList[ia], homeList[ib]] = [homeList[ib], homeList[ia]];
  if (!(await homeSave())) homeList = old;
  homeRender();
}
function homeShownVisible() { return homeShown().filter(homeAllowed); }

async function homeAddPick(kind, tab, sub) {
  const ok = await homeAdd(kind === 'sub' ? { type: 'sub', tab, sub } : { type: 'tab', tab });
  if (ok) homeRender();
}
async function homeAddResource() { if (await homeAdd({ type: 'resource' })) homeRender(); }

// 「加到首页」小按钮（学生详情、课表上课次的标题旁）：已加过显示「已在首页」，再点取消
function homePinHtml(type, id, label) {
  const on = homeHas({ type, id: String(id) });
  return `<span class="homePin" data-type="${type}" data-id="${homeEsc(id)}" data-label="${homeEsc(label)}" onclick="event.stopPropagation();homePinToggle(this)" style="cursor:pointer;font-size:10px;color:${on ? 'var(--text-3)' : 'var(--warn)'};text-decoration:underline">${on ? '已在首页' : '加到首页'}</span>`;
}
async function homePinToggle(el) {
  const it = { type: el.dataset.type, id: el.dataset.id, label: el.dataset.label };
  if (homeHas(it)) await homeRemoveKey(homeKey(it)); else if (!(await homeAdd(it))) return;
  document.querySelectorAll('.homePin').forEach(e => { if (e.dataset.type === it.type && e.dataset.id === it.id) { const on = homeHas(it); e.textContent = on ? '已在首页' : '加到首页'; e.style.color = on ? 'var(--text-3)' : 'var(--warn)'; } });
}

// ── 渲染（待处理页顶部）──
async function homeRender() {
  const box = document.getElementById('homeBox'); if (!box || !teacherData) return;
  const items = homeShownVisible();
  // 具体项目：学生是否还在（一次查完）
  const ids = [...new Set(items.filter(x => x.type === 'student' && !(x.id in homeStuInfo)).map(x => x.id))];
  if (ids.length) {
    try {
      const rows = await sb(`/rest/v1/students?id=in.(${ids.map(i => `"${String(i).replace(/"/g, '')}"`).join(',')})&select=id,name,major`);
      ids.forEach(i => { homeStuInfo[i] = (rows || []).find(r => r.id === i) || null; });
    } catch (e) { ids.forEach(i => { homeStuInfo[i] = { name: '', major: '' }; }); }
    if (!document.getElementById('homeBox')) return;
  }
  const card = (it, i) => {
    const gone = homeGone(it), [name, sub] = homeText(it), stripe = HOME_STRIPE[it.type] || '';
    const edit = homeEditing ? `<span style="position:absolute;top:2px;right:4px;display:flex;gap:2px" onclick="event.stopPropagation()">
        ${i > 0 ? `<span onclick="homeMove(${i},-1)" style="cursor:pointer;color:var(--text-3);padding:0 3px">←</span>` : ''}${i < items.length - 1 ? `<span onclick="homeMove(${i},1)" style="cursor:pointer;color:var(--text-3);padding:0 3px">→</span>` : ''}
        <span onclick="homeRemove(${i})" style="cursor:pointer;color:var(--danger);padding:0 3px">×</span></span>` : '';
    return `<div ${gone || homeEditing ? '' : `onclick="homeOpen(${i})"`} style="position:relative;background:var(--surface);border:1px solid var(--border);${stripe ? `border-left:3px solid ${stripe};` : ''}border-radius:4px;padding:9px 12px;min-height:54px;${gone ? 'opacity:.55;' : (homeEditing ? '' : 'cursor:pointer;')}">
      <div style="font-size:12px;font-weight:600;padding-right:${homeEditing ? 44 : 0}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${homeEsc(name)}</div>
      <div style="font-size:10px;color:var(--text-3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${gone ? '已不存在' : homeEsc(sub)}</div>${edit}</div>`;
  };
  const addCard = homeEditing ? `<div onclick="homeAddOpen=!homeAddOpen;homeRender()" style="border:1px dashed var(--border);border-radius:4px;padding:9px 12px;min-height:54px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;color:var(--text-3)">＋ 添加</div>` : '';
  const chip = (on, label, fn) => `<span onclick="${on ? '' : fn}" style="display:inline-block;font-size:11px;padding:3px 10px;margin:0 6px 6px 0;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};border-radius:3px;${on ? 'background:var(--accent);color:#fff;cursor:default' : 'cursor:pointer;color:var(--text-2)'}">${homeEsc(label)}</span>`;
  let panel = '';
  if (homeEditing && homeAddOpen) {
    const tabs = teacherTabList.filter(t => t.id !== 'todo');
    const subRows = tabs.filter(t => HOME_SUBS[t.id]).map(t => `<div style="margin-top:6px"><span style="font-size:10px;color:var(--text-3);margin-right:6px">${homeEsc(homePlain(t.label))} 的分页</span>${HOME_SUBS[t.id].list().map(([k, l]) => chip(homeHas({ type: 'sub', tab: t.id, sub: k }), homePlain(l), `homeAddPick('sub','${homeJs(t.id)}','${homeJs(k)}')`)).join('')}</div>`).join('');
    panel = `<div style="background:var(--bg);border:1px solid var(--border-light);border-radius:4px;padding:10px 12px;margin-top:8px">
      <div style="font-size:10px;color:var(--text-3);margin-bottom:6px">页面</div>
      ${tabs.map(t => chip(homeHas({ type: 'tab', tab: t.id }), homePlain(t.label), `homeAddPick('tab','${homeJs(t.id)}')`)).join('')}
      ${homeResourceOk() ? chip(homeHas({ type: 'resource' }), '资源管理', 'homeAddResource()') : ''}
      ${subRows}
      <div style="font-size:10px;color:var(--text-3);margin-top:8px">学生、课程请在学生详情 / 课表里点「加到首页」</div></div>`;
  }
  const head = `<div style="display:flex;align-items:center;margin-bottom:6px"><span style="font-size:11px;color:var(--text-3)">快捷入口${homeEditing ? `（${items.length}/${HOME_MAX}）` : ''}</span>
    <span onclick="homeEditing=!homeEditing;homeAddOpen=false;homeRender()" style="margin-left:auto;cursor:pointer;font-size:11px;color:var(--warn)">${homeEditing ? '完成' : '编辑'}</span></div>`;
  if (!items.length && !homeEditing) { box.innerHTML = head.replace('快捷入口', '快捷入口') + '<div style="font-size:11px;color:var(--text-3);padding:6px 0">把常用的页面钉到这里：点右边的「编辑」添加</div>'; return; }
  box.innerHTML = head + `<div class="homeGrid">${items.map(card).join('')}${items.length < HOME_MAX ? addCard : ''}</div>${panel}`;
}
function homeOpen(i) {
  const it = homeShownVisible()[i]; if (!it || homeGone(it)) return;
  if (it.type === 'tab') switchTab(it.tab);
  else if (it.type === 'sub') { HOME_SUBS[it.tab].set(it.sub); switchTab(it.tab); }
  else if (it.type === 'resource') switchTab('resource');
  else if (it.type === 'student') showStudentInfoTeacher((homeStuInfo[it.id] && homeStuInfo[it.id].name) || it.label, it.id);
  else if (it.type === 'course') {
    switchTab('mycourses');
    setTimeout(() => {   // 课表渲染完后，滚到这门课最近的一次课并高亮几秒
      const row = [...document.querySelectorAll('[data-course]')].find(e => e.dataset.course === String(it.id)); if (!row) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' }); const old = row.style.outline; row.style.outline = '2px solid var(--warn)'; setTimeout(() => { row.style.outline = old; }, 2500);
    }, 150);
  }
}
