// ══════════════════════════════════
// teacher-pricing.js — 宣传相关 → 💴 课程方案（营业用，需 promo_pricing 权限）
// 给某位学生配一个带价格的方案：大课套餐 + VIP 课程 + TA 助教 + 其他/优惠 → 自动算总价
// 可保存到 sales_plans（按老师自己的名字列出，能打开/修改/复制/删除），也可「加入宣传资料」（资料类型 plan_price）
// 资料里只显示方案的组成和价格，套餐里包含的详细课程清单不输出
// 价目由 admin「宣传管理 → 💴 价目」维护（price_packages / price_vip_rates / price_ta_options）
// 依赖：shared/constants.js、shared/supabase.js、teacher.js、teacher-students.js（tsaAllowedSet）、teacher-promo.js、teacher-pack.js
// ══════════════════════════════════
let tp = { loaded: false, err: '', pk: [], vip: [], ta: [], vplans: [], vtpls: [], students: [], saved: [], cur: null };

function pricingEnabled() { return !!((typeof teacherData !== 'undefined' && teacherData && teacherData.permissions) || {}).promo_pricing; }
const tpE = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const tpYen = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const tpMan = n => { const m = (Number(n) || 0) / 10000; return (Math.round(m * 100) / 100).toString(); };
const tpMe = () => ((typeof teacherData !== 'undefined' && teacherData && teacherData.name) || (typeof teacherName !== 'undefined' ? teacherName : '') || '').trim();

async function tpLoad() {
  tp.err = '';
  try {
    const q = p => sbAll(p);
    const [pk, vip, ta, saved] = await Promise.all([
      q('/rest/v1/price_packages?active=is.true&select=*&order=sort_order.asc'),
      q('/rest/v1/price_vip_rates?active=is.true&select=*&order=sort_order.asc'),
      q('/rest/v1/price_ta_options?active=is.true&select=*&order=sort_order.asc'),
      q(`/rest/v1/sales_plans?created_by=eq.${encodeURIComponent(tpMe())}&select=*&order=updated_at.desc`),
    ]);
    tp.pk = pk; tp.vip = vip; tp.ta = ta; tp.saved = saved;
  } catch (e) { tp.err = e.message; }
  // 已有的 VIP 规划（营业「VIP规划」里的学生方案 / 套餐）：读不到就只能用自定义
  const [vplans, vtpls, stu] = await Promise.all([
    sbAll('/rest/v1/vip_student_plans?select=id,student_name,total_sessions,total_hours,items&order=created_at.desc').catch(() => []),
    sbAll('/rest/v1/vip_plan_templates?select=id,name,major,total_sessions,total_hours,items&order=major.asc,created_at.desc').catch(() => []),
    sbAll('/rest/v1/students?select=id,name,major,course_type,status&status=eq.active&order=name.asc').catch(() => []),
  ]);
  tp.vplans = vplans; tp.vtpls = vtpls;
  const set = typeof tsaAllowedSet === 'function' ? tsaAllowedSet() : null;
  tp.students = (stu || []).filter(s => !set || set.has(s.major))
    .filter(s => !(typeof tsaGuaranteedLock === 'function' && tsaGuaranteedLock()) || tsaIsGuaranteed(s));
  tp.loaded = true;
}

// 在「宣传相关」里点开「💴 课程方案」后调用（容器 #tp_root 由 teacher-promo.js 输出）
async function tpMount() {
  const box = document.getElementById('tp_root'); if (!box) return;
  if (!pricingEnabled()) { box.innerHTML = '<div class="empty" style="padding:30px">没有课程方案权限</div>'; return; }
  if (!tp.loaded) { box.innerHTML = '<div class="empty">加载中…</div>'; await tpLoad(); }
  tpRender();
}
function tpRender() {
  const box = document.getElementById('tp_root'); if (!box) return;
  if (tp.err) { box.innerHTML = `<div class="empty">加载失败：${tpE(tp.err)}<br><span style="font-size:11px">（如果提示表不存在，请联系管理员先执行「课程方案」的建表 SQL）</span></div>`; return; }
  box.innerHTML = tp.cur ? tpEditorHtml() : tpListHtml();
}

// ── 已保存方案列表 ──
function tpListHtml() {
  const rows = tp.saved.map(p => {
    const d = new Date(p.updated_at || p.created_at || Date.now());
    return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border-light);border-radius:3px;padding:9px 12px;margin-bottom:6px">
      <span style="font-size:13px;font-weight:600;min-width:90px">${tpE(p.student_name)}</span>
      <span style="font-size:10px;color:var(--text-3)">${tpE(p.track || '')}</span>
      <span style="font-size:12px;color:var(--accent);font-family:'DM Mono',monospace">${tpYen(p.total_yen)} 日元<span style="color:var(--text-3);font-size:10px"> · 约 ${tpMan(p.total_yen)} 万</span></span>
      <span style="font-size:10px;color:var(--text-3);flex:1;min-width:120px">${(p.items || []).map(x => tpE(x.name)).join(' + ')}</span>
      <span style="font-size:10px;color:var(--text-3)">${d.getMonth() + 1}/${d.getDate()}</span>
      <button class="btn btn-outline btn-sm" onclick="tpOpen('${tpE(p.id)}')">打开</button>
      <button class="btn btn-outline btn-sm" onclick="tpOpen('${tpE(p.id)}',true)">复制</button>
      <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="tpDelete('${tpE(p.id)}')">删除</button>
    </div>`;
  }).join('');
  return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <div style="font-size:12px;font-weight:600">我的课程方案（${tp.saved.length}）</div>
      <span style="font-size:10px;color:var(--text-3)">给学生配好大课套餐、VIP、TA，自动算总价，再放进宣传资料</span>
      <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="tpNew()">＋ 新建方案</button>
    </div>${rows || '<div class="empty" style="padding:30px">还没有保存过的方案，点「＋ 新建方案」开始</div>'}`;
}

// ── 编辑器 ──
function tpBlank() {
  return { id: '', student_id: '', student_name: '', track: '', pkgId: '', vipMode: 'none', vipRateId: '', vipHours: '', vipPlanRef: '', vipItems: [], taId: '', extras: [], note: '', stuSearch: '' };
}
function tpNew() { tp.cur = tpBlank(); tpRender(); }
function tpOpen(id, asCopy) {
  const p = tp.saved.find(x => x.id === id); if (!p) return;
  const c = tpBlank();
  c.id = asCopy ? '' : p.id; c.student_id = p.student_id || ''; c.student_name = p.student_name || ''; c.track = p.track || ''; c.note = p.note || '';
  (p.items || []).forEach(x => {
    if (x.kind === 'package') c.pkgId = x.ref || '';
    else if (x.kind === 'vip') { c.vipMode = x.mode || 'custom'; c.vipRateId = x.rate_id || ''; c.vipHours = x.hours != null ? String(x.hours) : ''; c.vipPlanRef = x.plan_ref || ''; c.vipItems = x.content_items || []; }
    else if (x.kind === 'ta') c.taId = x.ref || '';
    else if (x.kind === 'other') c.extras.push({ name: x.name || '', man: tpMan(x.yen) });
  });
  if (asCopy) c.student_id = '', c.student_name = '';
  tp.cur = c; tpRender();
}
async function tpDelete(id) {
  const p = tp.saved.find(x => x.id === id); if (!p) return;
  if (!confirm(`删除「${p.student_name}」的这份方案？`)) return;
  try { await sb(`/rest/v1/sales_plans?id=eq.${encodeURIComponent(id)}`, 'DELETE'); tp.saved = tp.saved.filter(x => x.id !== id); tpRender(); }
  catch (e) { alert('删除失败：' + e.message); }
}
function tpTracks() {
  const dl = DOMAINS.map(d => d.label);
  return [...new Set(tp.pk.map(p => p.track).concat(dl))];
}
function tpRateFor(track) {
  const head = /^学部/.test(track || '') ? '学部' : /^大学院/.test(track || '') ? '大学院' : /语言/.test(track || '') ? '语言' : '';
  return (head && tp.vip.find(r => (r.track || '').includes(head))) || tp.vip[0] || null;
}

// 计算各组成部分的行 + 总价（日元）
function tpLines() {
  const c = tp.cur, lines = [];
  const pkg = tp.pk.find(x => x.id === c.pkgId);
  if (pkg) lines.push({ kind: 'package', ref: pkg.id, name: pkg.name, content: `${pkg.track} 大课套餐`, detail: pkg.period || '', yen: Math.round(Number(pkg.price_man_yen) * 10000) });
  if (c.vipMode !== 'none') {
    const rate = tp.vip.find(x => x.id === c.vipRateId), hours = parseFloat(c.vipHours) || 0;
    if (rate && hours > 0) {
      let content = (c.vipItems || []).join('，');
      if (c.vipMode === 'plan') {
        const pl = tpVipPlanOf(c.vipPlanRef);
        content = pl ? [...new Set((pl.items || []).map(i => i.category_label || i.name).filter(Boolean))].join('，') : '';
      }
      lines.push({ kind: 'vip', mode: c.vipMode, rate_id: rate.id, plan_ref: c.vipMode === 'plan' ? c.vipPlanRef : '', content_items: c.vipMode === 'custom' ? (c.vipItems || []) : [],
        hours, unit: rate.yen_per_hour, name: rate.name, content, detail: `${hours} 小时 × ${tpYen(rate.yen_per_hour)} 日元`, yen: Math.round(hours * rate.yen_per_hour) });
    }
  }
  const ta = tp.ta.find(x => x.id === c.taId);
  if (ta) lines.push({ kind: 'ta', ref: ta.id, name: ta.name, content: ta.descr || '', detail: ta.hours || '', yen: Math.round(Number(ta.price_man_yen) * 10000) });
  (c.extras || []).forEach(x => {
    const man = parseFloat(x.man);
    if ((x.name || '').trim() && !isNaN(man) && man !== 0) lines.push({ kind: 'other', name: x.name.trim(), content: '', detail: '', yen: Math.round(man * 10000) });
  });
  return { lines, total: lines.reduce((s, l) => s + l.yen, 0) };
}
function tpVipPlanOf(ref) {
  const [t, id] = String(ref || '').split(':');
  return t === 'plan' ? tp.vplans.find(x => x.id === id) : t === 'tpl' ? tp.vtpls.find(x => x.id === id) : null;
}

function tpEditorHtml() {
  const c = tp.cur, inp = 'width:100%;box-sizing:border-box;font-size:12px;padding:7px 9px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const box = 'background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px 14px;margin-bottom:12px';
  const lbl = t => `<label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:3px">${t}</label>`;
  const h = t => `<div style="font-size:12px;font-weight:600;margin-bottom:8px">${t}</div>`;
  const chip = (on, label, fn) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${fn}" style="padding:4px 12px;font-size:11px">${label}</div>`;
  const kw = (c.stuSearch || '').trim();
  const stuList = tp.students.filter(s => !kw || (typeof matchesStudentSearch === 'function' ? matchesStudentSearch(s, kw) : (s.name || '').includes(kw)));
  const tracks = tpTracks(), pkgs = tp.pk.filter(p => !c.track || p.track === c.track);
  const pkg = tp.pk.find(x => x.id === c.pkgId);
  const rate = tp.vip.find(x => x.id === c.vipRateId);
  const { lines, total } = tpLines();

  const vipBody = c.vipMode === 'none' ? '' : `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:8px">
      <div>${lbl('VIP 单价类型')}<select style="${inp}" onchange="tp.cur.vipRateId=this.value;tp.cur.vipItems=[];tpRender()">
        <option value="">— 选择 —</option>${tp.vip.map(r => `<option value="${tpE(r.id)}" ${r.id === c.vipRateId ? 'selected' : ''}>${tpE(r.name)}（${tpE(r.track)} · ${tpYen(r.yen_per_hour)}日元/H）</option>`).join('')}</select></div>
      ${c.vipMode === 'plan' ? `<div>${lbl('已有的 VIP 规划（选后自动带出课时）')}<select style="${inp}" onchange="tpPickVipPlan(this.value)">
        <option value="">— 选择 —</option>
        ${tp.vplans.length ? `<optgroup label="学生方案">${tp.vplans.map(p => `<option value="plan:${tpE(p.id)}" ${c.vipPlanRef === 'plan:' + p.id ? 'selected' : ''}>${tpE(p.student_name || '—')} · ${p.total_hours || 0}课时</option>`).join('')}</optgroup>` : ''}
        ${tp.vtpls.length ? `<optgroup label="VIP 套餐">${tp.vtpls.map(p => `<option value="tpl:${tpE(p.id)}" ${c.vipPlanRef === 'tpl:' + p.id ? 'selected' : ''}>${tpE(typeof majorLabel === 'function' ? majorLabel(p.major) : p.major)} · ${tpE(p.name)} · ${p.total_hours || 0}课时</option>`).join('')}</optgroup>` : ''}
      </select></div>` : ''}
      <div>${lbl('课时（小时）')}<input type="number" min="0" step="0.5" value="${tpE(c.vipHours)}" oninput="tp.cur.vipHours=this.value;tpRefresh()" style="${inp}"></div>
    </div>
    ${c.vipMode === 'custom' && rate ? `<div style="margin-top:8px">${lbl('授课内容（点选，可多选）')}<div style="display:flex;gap:6px;flex-wrap:wrap">
      ${(rate.items || []).map((it, i) => chip(c.vipItems.includes(it), tpE(it), `tpToggleVipItem(${i})`)).join('') || '<span style="font-size:10px;color:var(--text-3)">这个单价类型没有设置授课内容</span>'}</div></div>` : ''}
    ${c.vipMode === 'plan' && c.vipPlanRef ? `<div style="font-size:10px;color:var(--text-3);margin-top:6px">内容：${tpE(lines.find(l => l.kind === 'vip')?.content || '—')}</div>` : ''}`;

  return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="tp.cur=null;tpRender()">← 返回列表</button>
      <div style="font-size:12px;font-weight:600">${c.id ? '编辑方案' : '新建方案'}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;align-items:start">
    <div>
      <div style="${box}">${h('① 学生与方案类型')}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>${lbl('搜索我能看到的学生')}<input value="${tpE(c.stuSearch)}" placeholder="姓名 / 拼音首字母" oninput="tp.cur.stuSearch=this.value;tpRerenderStu()" style="${inp}"></div>
          <div>${lbl('选择学生')}<select id="tp_stu" style="${inp}" onchange="tpPickStudent(this.value)">${tpStuOptions(stuList)}</select></div>
          <div>${lbl('或手填姓名（还没建档的潜在学生）')}<input value="${tpE(c.student_id ? '' : c.student_name)}" placeholder="姓名" oninput="tpManualName(this.value)" style="${inp}"></div>
          <div>${lbl('方案类型')}<select style="${inp}" onchange="tp.cur.track=this.value;tp.cur.pkgId='';tpRender()">
            <option value="">— 全部 —</option>${tracks.map(t => `<option value="${tpE(t)}" ${t === c.track ? 'selected' : ''}>${tpE(t)}</option>`).join('')}</select></div>
        </div>
      </div>
      <div style="${box}">${h('② 大课套餐')}
        <select style="${inp}" onchange="tp.cur.pkgId=this.value;tpRender()"><option value="">不选</option>
          ${pkgs.map(p => `<option value="${tpE(p.id)}" ${p.id === c.pkgId ? 'selected' : ''}>${tpE(p.track)} · ${tpE(p.name)}（${Number(p.price_man_yen)}万）</option>`).join('')}</select>
        ${pkg ? `<div style="font-size:10px;color:var(--text-3);margin-top:5px">${tpE(pkg.period || '')} · ${Number(pkg.price_man_yen)} 万日元</div>` : (!pkgs.length ? `<div style="font-size:10px;color:var(--text-3);margin-top:5px">这个类型下还没有大课套餐（admin 可在 宣传管理→价目 新增）</div>` : '')}
      </div>
      <div style="${box}">${h('③ VIP 课程')}
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${chip(c.vipMode === 'none', '不加 VIP', "tpSetVipMode('none')")}${chip(c.vipMode === 'plan', '选已有的 VIP 规划', "tpSetVipMode('plan')")}${chip(c.vipMode === 'custom', '自定义', "tpSetVipMode('custom')")}
        </div>${vipBody}
      </div>
      <div style="${box}">${h('④ TA 助教')}
        <select style="${inp}" onchange="tp.cur.taId=this.value;tpRender()"><option value="">不选</option>
          ${tp.ta.map(t => `<option value="${tpE(t.id)}" ${t.id === c.taId ? 'selected' : ''}>${tpE(t.name)} ${tpE(t.hours || '')}（${Number(t.price_man_yen)}万）</option>`).join('')}</select>
      </div>
      <div style="${box}">${h('⑤ 其他 / 优惠')}
        ${c.extras.map((x, i) => `<div style="display:grid;grid-template-columns:1fr 110px 26px;gap:6px;margin-bottom:5px;align-items:center">
          <input value="${tpE(x.name)}" placeholder="名称（如 早鸟优惠）" oninput="tp.cur.extras[${i}].name=this.value;tpRefresh()" style="${inp}">
          <input type="number" step="any" value="${tpE(x.man)}" placeholder="万日元" oninput="tp.cur.extras[${i}].man=this.value;tpRefresh()" style="${inp}">
          <span onclick="tp.cur.extras.splice(${i},1);tpRender()" style="cursor:pointer;color:var(--danger);text-align:center">✕</span></div>`).join('')}
        <button class="btn btn-outline btn-sm" onclick="tp.cur.extras.push({name:'',man:''});tpRender()">＋ 添加一行</button>
        <span style="font-size:10px;color:var(--text-3);margin-left:6px">金额单位是万日元，填负数 = 优惠（如 -4）</span>
      </div>
    </div>
    <div style="${box};position:sticky;top:8px">${h('方案预览')}
      <div id="tp_preview">${tpPreviewHtml()}</div>
      <div style="margin-top:10px">${lbl('备注（仅自己保存，不放进资料）')}<textarea rows="2" oninput="tp.cur.note=this.value" style="${inp};resize:vertical;line-height:1.6">${tpE(c.note)}</textarea></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-primary" onclick="tpSave()">💾 保存方案</button>
        ${typeof pkEnabled === 'function' && pkEnabled() ? `<button class="btn btn-outline" onclick="tpAddToPack()">➕ 加入宣传资料</button>` : ''}
      </div>
    </div></div>`;
}
function tpStuOptions(list) {
  const c = tp.cur;
  return `<option value="">— 选择学生（${list.length}）—</option>` + list.map(s => `<option value="${tpE(s.id)}" ${String(c.student_id) === String(s.id) ? 'selected' : ''}>${tpE(s.name)} · ${tpE(typeof majorLabel === 'function' ? majorLabel(s.major) : s.major)}</option>`).join('');
}
function tpRerenderStu() {
  const c = tp.cur, kw = (c.stuSearch || '').trim(), el = document.getElementById('tp_stu'); if (!el) return;
  el.innerHTML = tpStuOptions(tp.students.filter(s => !kw || (typeof matchesStudentSearch === 'function' ? matchesStudentSearch(s, kw) : (s.name || '').includes(kw))));
}
function tpPickStudent(id) {
  const c = tp.cur, s = tp.students.find(x => String(x.id) === String(id));
  c.student_id = s ? s.id : ''; if (s) { c.student_name = s.name; const d = MAJOR_DOMAIN[s.major]; if (d && !c.track) { c.track = d; c.pkgId = ''; } }
  tpRender();
}
function tpManualName(v) { tp.cur.student_id = ''; tp.cur.student_name = v; }
function tpSetVipMode(m) {
  const c = tp.cur; c.vipMode = m;
  if (m !== 'none' && !c.vipRateId) { const r = tpRateFor(c.track); c.vipRateId = r ? r.id : ''; }
  tpRender();
}
function tpPickVipPlan(ref) {
  const c = tp.cur; c.vipPlanRef = ref;
  const pl = tpVipPlanOf(ref); c.vipHours = pl ? String(pl.total_hours || '') : '';
  tpRender();
}
function tpToggleVipItem(idx) {
  const rate = tp.vip.find(x => x.id === tp.cur.vipRateId), it = rate && (rate.items || [])[idx]; if (it == null) return;
  const a = tp.cur.vipItems, i = a.indexOf(it); if (i >= 0) a.splice(i, 1); else a.push(it);
  tpRender();
}
function tpRefresh() { const el = document.getElementById('tp_preview'); if (el) el.innerHTML = tpPreviewHtml(); }
function tpPreviewHtml() {
  const { lines, total } = tpLines();
  if (!lines.length) return '<div style="font-size:11px;color:var(--text-3);padding:16px 0;text-align:center">还没有选任何内容</div>';
  return `<table style="width:100%;border-collapse:collapse;font-size:11px">
    <tbody>${lines.map(l => `<tr style="border-bottom:1px solid var(--border-light)">
      <td style="padding:6px 4px;vertical-align:top"><div style="font-weight:600">${tpE(l.name)}</div><div style="font-size:10px;color:var(--text-3)">${tpE([l.content, l.detail].filter(Boolean).join(' · '))}</div></td>
      <td style="padding:6px 4px;text-align:right;white-space:nowrap;font-family:'DM Mono',monospace;color:${l.yen < 0 ? 'var(--danger,#b03a2e)' : 'inherit'}">${tpYen(l.yen)}</td></tr>`).join('')}</tbody></table>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:10px;padding-top:8px;border-top:2px solid var(--accent)">
      <span style="font-size:12px;font-weight:600">总价</span>
      <span><span style="font-size:20px;font-weight:600;color:var(--accent);font-family:'DM Mono',monospace">${tpYen(total)}</span> <span style="font-size:11px">日元</span>
      <span style="font-size:10px;color:var(--text-3);margin-left:6px">约 ${tpMan(total)} 万日元</span></span></div>`;
}

// ── 保存 ──
async function tpSave() {
  const c = tp.cur, name = (c.student_name || '').trim();
  if (!name) { alert('请选择学生或手填姓名'); return null; }
  const { lines, total } = tpLines();
  if (!lines.length) { alert('方案里还没有内容'); return null; }
  const now = new Date().toISOString();
  const rec = { student_id: c.student_id || null, student_name: name, track: c.track || null, items: lines, total_yen: total, note: c.note || null, updated_at: now };
  try {
    if (c.id) {
      await sb(`/rest/v1/sales_plans?id=eq.${encodeURIComponent(c.id)}`, 'PATCH', rec);
      const p = tp.saved.find(x => x.id === c.id); if (p) Object.assign(p, rec);
    } else {
      const row = Object.assign({ id: `sp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, created_by: tpMe(), created_at: now }, rec);
      await sb('/rest/v1/sales_plans', 'POST', row);
      tp.saved.unshift(row); c.id = row.id;
    }
    tp.saved.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    if (typeof pkToast === 'function') pkToast('✓ 方案已保存');
    return true;
  } catch (e) { alert('保存失败：' + e.message); return null; }
}

// ── 加入宣传资料：只输出方案表 + 总价，不带套餐包含的详细课程 ──
function tpDocHtml(lines, total) {
  const tr = l => `<tr><td class="nm">${pkEsc(l.name)}</td><td>${pkEsc(l.content || '—')}</td><td class="dt">${pkEsc(l.detail || '—')}</td><td class="yen${l.yen < 0 ? ' neg' : ''}">${l.yen < 0 ? '-' : ''}${tpYen(Math.abs(l.yen))} 日元</td></tr>`;
  return `<table class="pk-price"><thead><tr><th>项目</th><th>内容</th><th>课时 / 周期</th><th>金额</th></tr></thead>
    <tbody>${lines.map(tr).join('')}</tbody>
    <tfoot><tr><td colspan="3" class="tt">总价</td><td class="yen tot">${tpYen(total)} 日元<span class="man">约 ${tpMan(total)} 万日元</span></td></tr></tfoot></table>
    <div class="pk-note">・以上为参考方案，具体课程安排与报名事宜请咨询顾问老师。</div>`;
}
async function tpAddToPack() {
  if (!pricingEnabled() || typeof pkAdd !== 'function') return;
  const c = tp.cur, { lines, total } = tpLines();
  if (!(c.student_name || '').trim() && !lines.length) { alert('请先选择学生并配好方案'); return; }
  if (!lines.length) { alert('方案里还没有内容'); return; }
  if (c.student_name.trim() && await tpSave() === null) return;   // 先存一份，之后在列表里还能找到
  pkAdd({ type: 'plan_price', title: `课程方案${c.student_name.trim() ? '（' + c.student_name.trim() + '）' : ''} · ${tpMan(total)}万`, html: tpDocHtml(lines, total), student: c.student_name.trim() });
}
