// ══════════════════════════════════
// pricing.js — 宣传管理 → 💴 价目（admin）
// 三张表：price_packages 大课套餐 / price_vip_rates VIP 单价 / price_ta_options TA 助教
// 营业老师在「宣传相关 → 💴 课程方案」里选用（需 promo_pricing 权限）；套餐的「包含课程」只在这里查看，不输出到资料
// 依赖：shared/constants.js、shared/supabase.js、promo.js（promoRenderShell / promoEsc）
// ══════════════════════════════════
let prcPk = [], prcVip = [], prcTa = [];
let prcEdit = null;      // { kind:'pk'|'vip'|'ta', id:'new'|id }
let prcInc = [];         // 正在编辑的套餐「包含课程」[{group,item,mark}]
let prcOpen = new Set(); // 展开查看「包含课程」的套餐 id
let prcPasteOpen = false;

const PRC_KIND = {
  pk:  { table: 'price_packages',   arr: () => prcPk },
  vip: { table: 'price_vip_rates',  arr: () => prcVip },
  ta:  { table: 'price_ta_options', arr: () => prcTa },
};
const prcE = v => promoEsc(v);
const prcYen = n => Number(n || 0).toLocaleString('en-US');

async function prcLoad() {
  const mc = document.getElementById('mainContent');
  try {
    [prcPk, prcVip, prcTa] = await Promise.all([
      sbAll('/rest/v1/price_packages?select=*&order=sort_order.asc'),
      sbAll('/rest/v1/price_vip_rates?select=*&order=sort_order.asc'),
      sbAll('/rest/v1/price_ta_options?select=*&order=sort_order.asc'),
    ]);
  } catch (e) {
    if (mc) mc.innerHTML = `<div class="empty">加载失败：${prcE(e.message)}<br><span style="font-size:11px">（如果提示表不存在，请先执行「课程方案」的建表 SQL）</span></div>`;
    return;
  }
  promoRenderShell();
}

const PRC_INP = 'width:100%;box-sizing:border-box;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
const prcLbl = t => `<label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">${t}</label>`;
const prcBtn = (label, fn, extra) => `<button class="btn btn-outline btn-sm" onclick="${fn}" ${extra || ''}>${label}</button>`;

// 领域视角下只显示本领域的大课套餐（VIP 单价 / TA 为通用价目，全部显示）
function prcVisiblePk() {
  return scopeAll() ? prcPk : prcPk.filter(p => scopeHasDomain(p.track));   // 没有专业的东西：只有完整选中的领域才算
}

function prcRender() {
  const box = document.getElementById('promo_body'); if (!box) return;
  const sec = (title, hint, addKind, inner) => `<div style="margin-bottom:22px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
      <div style="font-size:12px;font-weight:600">${title}</div><span style="font-size:10px;color:var(--text-3)">${hint}</span>
      <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="prcNew('${addKind}')">＋ 新增</button>
    </div>${inner}</div>`;
  const row = (inner, off) => `<div style="border:1px solid var(--border-light);border-radius:3px;padding:8px 12px;margin-bottom:6px;background:var(--surface);${off ? 'opacity:.55' : ''}">${inner}</div>`;
  const ctl = (kind, id, i, n, active) => `<span onclick="prcToggle('${kind}','${id}')" title="点击切换" style="cursor:pointer;user-select:none;font-size:9px;border-radius:2px;padding:1px 8px;${active === false ? 'background:var(--bg);color:var(--text-3);border:1px dashed var(--border)' : 'background:var(--ok-bg,#e4f0e8);color:var(--ok,#2a9e6a);border:1px solid transparent'}">${active === false ? '已停用' : '启用'}</span>
    ${prcBtn('↑', `prcMove('${kind}','${id}',-1)`, i === 0 ? 'disabled' : '')}${prcBtn('↓', `prcMove('${kind}','${id}',1)`, i === n - 1 ? 'disabled' : '')}
    ${prcBtn('✏ 编辑', `prcEditOpen('${kind}','${id}')`)}<button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:none" onclick="prcDelete('${kind}','${id}')">删除</button>`;
  const form = kind => (prcEdit && prcEdit.kind === kind) ? prcFormHtml() : '';

  const pks = prcVisiblePk();
  const tracks = [...new Set(pks.map(p => p.track))];
  const pkHtml = tracks.length ? tracks.map(t => {
    const list = pks.filter(p => p.track === t);
    return `<div style="font-size:11px;color:var(--accent);font-weight:600;margin:8px 0 4px">${prcE(t)}</div>` + list.map((p, i) => row(`
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600;min-width:130px">${prcE(p.name)}</span>
        <span style="font-size:12px;color:var(--accent);font-family:'DM Mono',monospace">${Number(p.price_man_yen)} 万日元</span>
        <span style="font-size:10px;color:var(--text-3);flex:1;min-width:140px">${prcE(p.period || '')}</span>
        <span onclick="prcOpen.has('${p.id}')?prcOpen.delete('${p.id}'):prcOpen.add('${p.id}');prcRender()" style="cursor:pointer;font-size:10px;color:var(--text-2);text-decoration:underline">包含课程 ${(p.included || []).length} 项 ${prcOpen.has(p.id) ? '▾' : '▸'}</span>
        ${ctl('pk', p.id, i, list.length, p.active)}
      </div>
      ${prcOpen.has(p.id) ? prcIncludedView(p.included || []) : ''}`, p.active === false)).join('');
  }).join('') : '<div style="font-size:11px;color:var(--text-3);padding:10px">还没有大课套餐</div>';

  const empty = !prcPk.length && !prcVip.length && !prcTa.length;
  box.innerHTML = `
  ${empty ? `<div style="border:1px dashed var(--accent);border-radius:4px;padding:12px 14px;margin-bottom:12px;background:var(--bg);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <span style="font-size:12px">价目还是空的。可以一键导入初始价目（学部理科 / 学部文科各 5 个套餐、3 种 VIP 单价、2 档 TA，之后都能改）：</span>
    <button class="btn btn-primary btn-sm" onclick="prcImportSeed()">导入初始价目</button></div>` : ''}
  <div style="font-size:10px;color:var(--text-3);margin-bottom:12px;line-height:1.8">价目只有勾选了「课程方案（含价格）」的营业老师看得到。停用的项目老师端不再出现，但已保存的方案不受影响。大学院文科 / 理科的大课套餐暂时是空的，直接在下面「＋ 新增」。</div>
  ${form('pk')}
  ${sec('大课套餐', '“包含课程”只在后台查看，不会输出到宣传资料', 'pk', pkHtml)}
  ${form('vip')}
  ${sec('VIP 单价', '日元 / 小时；“授课内容”供营业老师自定义 VIP 时点选', 'vip', prcVip.length ? prcVip.map((v, i) => row(`
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:10px;color:var(--text-3);min-width:80px">${prcE(v.track)}</span>
        <span style="font-size:12px;font-weight:600;min-width:120px">${prcE(v.name)}</span>
        <span style="font-size:12px;color:var(--accent);font-family:'DM Mono',monospace">${prcYen(v.yen_per_hour)} 日元/H</span>
        <span style="font-size:10px;color:var(--text-3);flex:1;min-width:140px">${prcE((v.items || []).join('、'))}</span>
        ${ctl('vip', v.id, i, prcVip.length, v.active)}
      </div>`, v.active === false)).join('') : '<div style="font-size:11px;color:var(--text-3);padding:10px">还没有 VIP 单价</div>')}
  ${form('ta')}
  ${sec('TA 助教', '按档位定价', 'ta', prcTa.length ? prcTa.map((t, i) => row(`
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:10px;color:var(--text-3);min-width:80px">${prcE(t.track)}</span>
        <span style="font-size:12px;font-weight:600;min-width:120px">${prcE(t.name)}</span>
        <span style="font-size:11px;color:var(--text-2);font-family:'DM Mono',monospace">${prcE(t.hours || '')}</span>
        <span style="font-size:12px;color:var(--accent);font-family:'DM Mono',monospace">${Number(t.price_man_yen)} 万日元</span>
        <span style="font-size:10px;color:var(--text-3);flex:1;min-width:140px">${prcE(t.descr || '')}</span>
        ${ctl('ta', t.id, i, prcTa.length, t.active)}
      </div>`, t.active === false)).join('') : '<div style="font-size:11px;color:var(--text-3);padding:10px">还没有 TA 档位</div>')}`;
}

// 套餐「包含课程」只读展示：按分组，○ 含 / △ 可选
function prcIncludedView(inc) {
  const groups = [];
  inc.forEach(x => { let g = groups.find(y => y.name === x.group); if (!g) groups.push(g = { name: x.group, items: [] }); g.items.push(x); });
  return `<div style="margin-top:8px;border-top:1px dashed var(--border-light);padding-top:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px">
    ${groups.map(g => `<div><div style="font-size:10px;font-weight:600;color:var(--text-2);margin-bottom:2px">${prcE(g.name)}</div>
      ${g.items.map(x => `<div style="font-size:10px;color:var(--text-3)"><span style="display:inline-block;width:14px;color:${x.mark === '△' ? 'var(--warn,#b8860b)' : 'var(--ok,#2a9e6a)'}">${prcE(x.mark || '○')}</span>${prcE(x.item)}</div>`).join('')}</div>`).join('')}
    <div style="grid-column:1/-1;font-size:9px;color:var(--text-3)">○ 含　△ 可选</div></div>`;
}

// ── 新增 / 编辑 ──
function prcNew(kind) { prcEdit = { kind, id: 'new' }; prcInc = []; prcPasteOpen = false; prcRender(); document.getElementById('prc_name')?.scrollIntoView({ block: 'center' }); }
function prcEditOpen(kind, id) {
  prcEdit = { kind, id };
  prcPasteOpen = false;
  if (kind === 'pk') { const p = prcPk.find(x => x.id === id); prcInc = ((p && p.included) || []).map(x => ({ group: x.group || '', item: x.item || '', mark: x.mark === '△' ? '△' : '○' })); }
  prcRender(); document.getElementById('prc_name')?.scrollIntoView({ block: 'center' });
}
function prcFormHtml() {
  const { kind, id } = prcEdit;
  const cur = id === 'new' ? {} : (PRC_KIND[kind].arr().find(x => x.id === id) || {});
  const head = `<div style="font-size:11px;font-weight:600;margin-bottom:8px">${id === 'new' ? '＋ 新增' : '✏ 编辑'}${{ pk: '大课套餐', vip: 'VIP 单价', ta: 'TA 助教' }[kind]}</div>`;
  const foot = `<div style="display:flex;gap:6px;margin-top:10px"><button class="btn btn-primary btn-sm" onclick="prcSave()">保存</button><button class="btn btn-outline btn-sm" onclick="prcEdit=null;prcRender()">取消</button></div>`;
  const wrap = inner => `<div style="border:1px solid var(--accent);border-radius:4px;padding:14px;margin-bottom:14px;background:var(--bg)">${head}${inner}${foot}</div>`;
  const inp = (fid, val, ph, type) => `<input id="${fid}" ${type ? `type="${type}" step="any"` : ''} value="${prcE(val == null ? '' : val)}" placeholder="${prcE(ph || '')}" style="${PRC_INP}">`;
  if (kind === 'pk') {
    const tracks = [...new Set(DOMAINS.map(d => d.label).filter(d => scopeDomainOnly(d)).concat(cur.track ? [cur.track] : []))];
    const defTrack = cur.track || viewLockDomain() || (scopeAll() ? '学部理科' : (tracks.length === 1 ? tracks[0] : ''));   // 组合范围：有多个可选领域时必须自己选
    return wrap(`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
      <div>${prcLbl('类型（领域）')}<select id="prc_track" style="${PRC_INP}">${defTrack ? '' : '<option value="">请选择领域</option>'}${tracks.map(t => `<option value="${prcE(t)}" ${defTrack === t ? 'selected' : ''}>${prcE(t)}</option>`).join('')}</select></div>
      <div>${prcLbl('套餐名')}${inp('prc_name', cur.name, '例：EJU半年冲刺课程')}</div>
      <div>${prcLbl('价格（万日元）')}${inp('prc_price', cur.price_man_yen, '例：45', 'number')}</div>
      <div>${prcLbl('周期 / 说明')}${inp('prc_period', cur.period, '例：约六个月（物理、化学、生物3选2）')}</div>
    </div>
    <div style="margin-top:10px">${prcLbl('包含课程（只在后台查看，不输出到资料）')}${prcIncEditorHtml()}</div>`);
  }
  if (kind === 'vip') {
    return wrap(`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
      <div>${prcLbl('类型')}${inp('prc_track', cur.track, '例：大学院文理科')}</div>
      <div>${prcLbl('名称')}${inp('prc_name', cur.name, '例：VIP定制课程')}</div>
      <div>${prcLbl('单价（日元 / 小时）')}${inp('prc_yen', cur.yen_per_hour, '例：13000', 'number')}</div>
    </div>
    <div style="margin-top:8px">${prcLbl('可选的授课内容（用顿号、逗号或换行分开）')}
      <textarea id="prc_items" rows="3" style="${PRC_INP};line-height:1.7;resize:vertical">${prcE((cur.items || []).join('、'))}</textarea></div>`);
  }
  return wrap(`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">
    <div>${prcLbl('类型')}${inp('prc_track', cur.track, '例：大学院文理科')}</div>
    <div>${prcLbl('名称')}${inp('prc_name', cur.name, '例：TA助教指导课程')}</div>
    <div>${prcLbl('课时')}${inp('prc_hours', cur.hours, '例：10H+10H')}</div>
    <div>${prcLbl('价格（万日元）')}${inp('prc_price', cur.price_man_yen, '例：10', 'number')}</div>
  </div>
  <div style="margin-top:8px">${prcLbl('说明')}<textarea id="prc_descr" rows="2" style="${PRC_INP};line-height:1.7;resize:vertical">${prcE(cur.descr || '')}</textarea></div>`);
}

// 套餐「包含课程」编辑小表：分组 | 课程 | ○/△ | 删除；也可以整块粘贴
function prcIncEditorHtml() {
  const grid = 'grid-template-columns:1.3fr 2fr 46px 26px';
  return `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
      ${prcBtn('＋ 添加一行', "prcInc.push({group:(prcInc[prcInc.length-1]||{}).group||'',item:'',mark:'○'});prcIncRender()")}
      ${prcBtn('📋 批量粘贴', 'prcPasteOpen=!prcPasteOpen;prcIncRender()')}
      <span style="font-size:10px;color:var(--text-3)">共 ${prcInc.length} 项；○ = 含，△ = 可选（点标记切换）</span>
    </div>
    <div id="prc_inc_box">${prcIncBodyHtml(grid)}</div>`;
}
function prcIncBodyHtml(grid) {
  grid = grid || 'grid-template-columns:1.3fr 2fr 46px 26px';
  const inp = 'width:100%;box-sizing:border-box;font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface);font-family:inherit';
  return (prcPasteOpen ? `<div style="border:1px dashed var(--border);border-radius:3px;padding:8px;margin-bottom:6px;background:var(--surface)">
      <textarea id="prc_paste" rows="6" placeholder="每行一项：分组 ⇥ 课程 ⇥ ○或△（Tab 或竖线 | 分隔；第三列不写默认 ○）" style="${inp};line-height:1.6;resize:vertical"></textarea>
      <div style="display:flex;gap:6px;margin-top:6px"><button class="btn btn-primary btn-sm" onclick="prcIncPaste()">追加到表格</button><button class="btn btn-outline btn-sm" onclick="prcPasteOpen=false;prcIncRender()">取消</button></div></div>` : '')
    + `<div style="max-height:320px;overflow-y:auto">${prcInc.map((r, i) => `<div style="display:grid;${grid};gap:4px;margin-bottom:3px;align-items:center">
      <input value="${prcE(r.group)}" placeholder="分组" oninput="prcInc[${i}].group=this.value" style="${inp}">
      <input value="${prcE(r.item)}" placeholder="课程" oninput="prcInc[${i}].item=this.value" style="${inp}">
      <span onclick="prcInc[${i}].mark=prcInc[${i}].mark==='△'?'○':'△';prcIncRender()" style="cursor:pointer;text-align:center;font-size:12px;border:1px solid var(--border);border-radius:2px;padding:3px 0;background:${r.mark === '△' ? '#f8f0d8' : 'var(--ok-bg,#e4f0e8)'}">${r.mark}</span>
      <span onclick="prcInc.splice(${i},1);prcIncRender()" style="cursor:pointer;color:var(--danger);text-align:center">✕</span></div>`).join('') || '<div style="font-size:10px;color:var(--text-3)">还没有内容</div>'}</div>`;
}
function prcIncRender() { const el = document.getElementById('prc_inc_box'); if (el) el.innerHTML = prcIncBodyHtml(); }
function prcIncPaste() {
  const text = ((document.getElementById('prc_paste') || {}).value || '').replace(/\r/g, '');
  const rows = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => (/\t/.test(l) ? l.split('\t') : l.replace(/^\||\|$/g, '').split('|')).map(x => x.trim()))
    .filter(c => c.length >= 2).map(c => ({ group: c[0], item: c[1], mark: /△/.test(c[2] || '') ? '△' : '○' }));
  if (!rows.length) { alert('没有可追加的内容（每行至少要有「分组」和「课程」两列）'); return; }
  prcInc = prcInc.concat(rows); prcPasteOpen = false; prcIncRender();
}

async function prcSave() {
  const { kind, id } = prcEdit;
  const v = k => ((document.getElementById(k) || {}).value || '').trim();
  const name = v('prc_name');
  if (!name) { alert('请填写名称'); return; }
  let rec;
  if (kind === 'pk') {
    const price = parseFloat(v('prc_price'));
    if (isNaN(price)) { alert('请填写价格（万日元）'); return; }
    if (!v('prc_track')) { alert('请选择领域'); return; }
    rec = { track: v('prc_track'), name, price_man_yen: price, period: v('prc_period'), included: prcInc.filter(r => r.item.trim()).map(r => ({ group: r.group.trim(), item: r.item.trim(), mark: r.mark })) };
  } else if (kind === 'vip') {
    const yen = parseInt(v('prc_yen'));
    if (!v('prc_track') || isNaN(yen)) { alert('请填写类型和单价'); return; }
    rec = { track: v('prc_track'), name, yen_per_hour: yen, items: v('prc_items').split(/[、,，\n]+/).map(x => x.trim()).filter(Boolean) };
  } else {
    const price = parseFloat(v('prc_price'));
    if (!v('prc_track') || isNaN(price)) { alert('请填写类型和价格（万日元）'); return; }
    rec = { track: v('prc_track'), name, descr: v('prc_descr'), hours: v('prc_hours'), price_man_yen: price };
  }
  const K = PRC_KIND[kind], arr = K.arr();
  try {
    if (id === 'new') {
      rec.id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      rec.sort_order = arr.reduce((m, r) => Math.max(m, r.sort_order || 0), 0) + 1; rec.active = true;
      await sb(`/rest/v1/${K.table}`, 'POST', rec); arr.push(rec);
    } else {
      await sb(`/rest/v1/${K.table}?id=eq.${encodeURIComponent(id)}`, 'PATCH', rec);
      Object.assign(arr.find(x => x.id === id), rec);
    }
    prcEdit = null; prcRender();
  } catch (e) { alert('保存失败：' + e.message); }
}
async function prcToggle(kind, id) {
  const K = PRC_KIND[kind], r = K.arr().find(x => x.id === id); if (!r) return;
  const next = r.active === false;
  try { await sb(`/rest/v1/${K.table}?id=eq.${encodeURIComponent(id)}`, 'PATCH', { active: next }); r.active = next; prcRender(); }
  catch (e) { alert('切换失败：' + e.message); }
}
async function prcDelete(kind, id) {
  const K = PRC_KIND[kind], r = K.arr().find(x => x.id === id); if (!r) return;
  if (!confirm(`删除「${r.name}」？\n（已保存的方案不受影响；只想暂时不用，建议点“启用”改成停用）`)) return;
  try { await sb(`/rest/v1/${K.table}?id=eq.${encodeURIComponent(id)}`, 'DELETE'); const a = K.arr(); a.splice(a.indexOf(r), 1); prcRender(); }
  catch (e) { alert('删除失败：' + e.message); }
}
// 上移 / 下移：套餐只在同一类型内交换；其余在整张表里交换。顺序号不连续或重复时整体重排成 1..n
async function prcMove(kind, id, d) {
  const K = PRC_KIND[kind], all = K.arr(), r = all.find(x => x.id === id); if (!r) return;
  const group = kind === 'pk' ? all.filter(x => x.track === r.track) : all;
  const i = group.indexOf(r), j = i + d; if (j < 0 || j >= group.length) return;
  const g = group.slice(); [g[i], g[j]] = [g[j], g[i]];
  try {
    for (let k = 0; k < g.length; k++) if (g[k].sort_order !== k + 1) { await sb(`/rest/v1/${K.table}?id=eq.${encodeURIComponent(g[k].id)}`, 'PATCH', { sort_order: k + 1 }); g[k].sort_order = k + 1; }
    all.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    prcRender();
  } catch (e) { alert('调整顺序失败：' + e.message); prcLoad(); }
}

// 初始价目：仓库里 seed/pricing_seed.json（和 seed/pricing_seed.sql 是同一份数据；SQL 编辑器粘贴长度有限，所以提供一键导入）
async function prcImportSeed() {
  try {
    const r = await fetch('../seed/pricing_seed.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('读取初始价目失败（' + r.status + '）。刚合并的话请等 10 分钟左右再试');
    const d = await r.json(), code = { '学部理科': 'gakubu_rika', '学部文科': 'gakubu_bunka' };
    const two = n => String(n).padStart(2, '0');
    const pk = d.packages.map(p => ({ id: `pkg-${code[p.track] || 'other'}-${two(p.sort_order)}`, track: p.track, name: p.name, price_man_yen: p.price_man_yen, period: p.period, included: p.included, sort_order: p.sort_order, active: true }));
    const vip = d.vip_rates.map((v, i) => ({ id: `vip-rate-${two(i + 1)}`, track: v.track, name: v.name, yen_per_hour: v.yen_per_hour, items: v.items, sort_order: i + 1, active: true }));
    const ta = d.ta_options.map((t, i) => ({ id: `ta-opt-${two(i + 1)}`, track: t.track, name: t.name, descr: t.desc, hours: t.hours, price_man_yen: t.price_man_yen, sort_order: i + 1, active: true }));
    const put = async (table, rows, have) => { const add = rows.filter(x => !have.some(h => h.id === x.id)); for (let i = 0; i < add.length; i += 3) await sb(`/rest/v1/${table}`, 'POST', add.slice(i, i + 3)); return add; };
    prcPk = prcPk.concat(await put('price_packages', pk, prcPk));
    prcVip = prcVip.concat(await put('price_vip_rates', vip, prcVip));
    prcTa = prcTa.concat(await put('price_ta_options', ta, prcTa));
    prcRender();
    alert(`已导入：${pk.length} 个套餐、${vip.length} 种 VIP 单价、${ta.length} 档 TA。`);
  } catch (e) { alert('导入失败：' + e.message); prcLoad(); }
}
