// ══════════════════════════════════
// success-cases.js — 合格案例（表 success_cases；admin「宣传管理 → 🏆 合格案例」与老师端「宣传相关 → 🏆 合格案例」共用）
// ① 有 success_cases 权限的老师 / admin：新建、修改案例（先选学生，自动带出成绩、合格校、时间线草稿，可点选作业与批复过的志望理由书）
// ② 营业老师：按 领域 / 专业 / 标签 / 合格学校 筛选、搜索已发布的案例，点选后「加入宣传资料」（资料类型 cases）
// 对外只显示称呼（小A、小B…）；学生真名只用于带出数据，不会写进案例
// 依赖：shared/constants.js、shared/supabase.js、shared/artworks.js（awImgs）；老师端加入资料需要 teacher-pack.js（pkAdd / pkEnabled）
// ══════════════════════════════════
const sc = {
  box: '', ctx: null, rows: null, err: '',
  f: { domain: '', major: '', tag: '', school: '', q: '' },
  view: 'list',            // list | detail | edit
  openId: null, cur: null,
  sel: new Set(), opt: { works: false, plans: false, others: false },
  stu: null,               // 编辑时可选的学生 [{id,name,major,...}]
};
const SC_TAG_HINTS = ['跨专业', '零基础', '专科', '大专', '转专业', '短期', '低分逆袭'];
const scE = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const SC_OTHER_CATS = ['课堂笔记', '老师解答', '其他'];
const scArr = v => Array.isArray(v) ? v : (typeof v === 'string' && v ? (() => { try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; } })() : []);

// host: 'promo_body'（admin）或 'sc_root'（老师端）；ctx 见下面 scCtxAdmin / scCtxTeacher
async function scMount(boxId, ctx) {
  sc.box = boxId; sc.ctx = ctx;
  const box = document.getElementById(boxId); if (!box) return;
  if (sc.rows === null) {
    box.innerHTML = '<div class="empty">加载中…</div>';
    try { sc.rows = await sbAll('/rest/v1/success_cases?select=*&order=updated_at.desc'); sc.err = ''; }
    catch (e) { sc.rows = []; sc.err = e.message; }
  }
  scRender();
}
function scRender() {
  const box = document.getElementById(sc.box); if (!box) return;
  if (sc.err) { box.innerHTML = `<div class="empty">加载失败：${scE(sc.err)}<br><span style="font-size:11px">（如果提示表不存在，请先执行「合格案例」的建表 SQL）</span></div>`; return; }
  box.innerHTML = sc.view === 'edit' ? scEditHtml() : sc.view === 'detail' ? scDetailHtml() : scListHtml();
}

// ── 权限 ──
function scCanEdit(r) { return !!(sc.ctx && sc.ctx.canWrite && sc.ctx.canEditRow(r)); }
function scVisible() { return (sc.rows || []).filter(r => (!sc.ctx.inScope || sc.ctx.inScope(r)) && (r.published === true || scCanEdit(r))); }

// ══════════ 列表 / 筛选 ══════════
function scSchoolsOf(r) { return String(r.result || '').split(/\s*[·、,，\/／;；]\s*/).map(x => x.replace(/[✓✔]/g, '').trim()).filter(Boolean); }
function scListHtml() {
  const f = sc.f, all = scVisible();
  const order = DOMAINS.map(d => d.label);
  const doms = [...new Set(all.map(r => r.domain))].sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  const inDom = all.filter(r => !f.domain || r.domain === f.domain);
  const majors = [...new Set(inDom.flatMap(r => scArr(r.majors)))];
  const tags = [...new Set(inDom.flatMap(r => scArr(r.tags)))];
  const schools = [...new Set(inDom.flatMap(scSchoolsOf))].sort((a, b) => a.localeCompare(b, 'zh'));
  if (f.major && !majors.includes(f.major)) f.major = '';
  if (f.tag && !tags.includes(f.tag)) f.tag = '';
  if (f.school && !schools.includes(f.school)) f.school = '';
  const kw = f.q.trim().toLowerCase();
  const list = inDom.filter(r => (!f.major || scArr(r.majors).includes(f.major)) && (!f.tag || scArr(r.tags).includes(f.tag)) && (!f.school || scSchoolsOf(r).includes(f.school))
    && (!kw || [r.alias, r.tagline, r.background, r.result, scArr(r.tags).join(' ')].join(' ').toLowerCase().includes(kw)));
  const chip = (on, label, fn) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${fn}" style="padding:3px 10px;font-size:10px">${label}</div>`;
  const row = (label, inner) => `<div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;margin-bottom:5px"><span style="font-size:10px;color:var(--text-3);min-width:28px">${label}</span><div style="display:flex;gap:4px;flex-wrap:wrap">${inner}</div></div>`;
  const packOn = sc.ctx.canPack && typeof pkEnabled === 'function' && pkEnabled();
  const selN = [...sc.sel].filter(id => list.some(r => r.id === id) || (sc.rows || []).some(r => r.id === id)).length;
  return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <div style="font-size:12px;font-weight:600">合格案例（${list.length}${list.length !== all.length ? ' / ' + all.length : ''}）</div>
      <span style="font-size:10px;color:var(--text-3)">${scTopNote(packOn)}</span>
      ${sc.ctx.canWrite ? `<button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="scNew()">＋ 新建案例</button>` : ''}
    </div>
    ${doms.length > 1 || (doms.length && !sc.ctx.lockDomain) ? row('领域', chip(!f.domain, '全部', "sc.f.domain='';scRender()") + doms.map(d => chip(f.domain === d, scE(d), `sc.f.domain='${scE(d)}';scRender()`)).join('')) : ''}
    ${majors.length ? row('专业', chip(!f.major, '全部', "sc.f.major='';scRender()") + majors.map(m => chip(f.major === m, scE(typeof majorLabel === 'function' ? majorLabel(m) : m), `sc.f.major='${scE(m)}';scRender()`)).join('')) : ''}
    ${tags.length ? row('标签', chip(!f.tag, '全部', "sc.f.tag='';scRender()") + tags.map(t => chip(f.tag === t, scE(t), `sc.f.tag='${scE(t)}';scRender()`)).join('')) : ''}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 10px">
      <select onchange="sc.f.school=this.value;scRender()" style="font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);font-family:inherit">
        <option value="">合格学校：全部</option>${schools.map(s => `<option value="${scE(s)}" ${f.school === s ? 'selected' : ''}>${scE(s)}</option>`).join('')}</select>
      <input id="sc_q" value="${scE(f.q)}" placeholder="搜索称呼 / 标签 / 学校 / 背景" oninput="sc.f.q=this.value;scRender();const e=document.getElementById('sc_q');e.focus();e.setSelectionRange(e.value.length,e.value.length)" style="flex:1;min-width:160px;font-size:11px;padding:5px 9px;border:1px solid var(--border);border-radius:3px;background:var(--surface);font-family:inherit">
    </div>
    ${list.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px">${list.map(r => scCardHtml(r, packOn)).join('')}</div>`
      : '<div class="empty" style="padding:30px">没有符合条件的案例</div>'}
    ${packOn ? scPackBar(selN) : ''}`;
}
// 顶部说明：只有开通了「宣传资料整合」的老师才提「选用后加入宣传资料」，没开通的写清楚原因
function scTopNote(packOn) {
  const noPerm = sc.ctx.canPack && !packOn ? '只能浏览；加入宣传资料需要开通「宣传资料整合」权限' : '';
  if (sc.ctx.canWrite) return '对外只显示称呼，不显示学生真名' + (packOn ? '；已发布的案例可「选用」后加入宣传资料' : noPerm ? '；' + noPerm : '');
  return packOn ? '按领域 / 专业 / 标签 / 合格学校筛选，选用后加入宣传资料' : (noPerm || '按领域 / 专业 / 标签 / 合格学校筛选');
}
function scPackOn() { return !!(sc.ctx && sc.ctx.canPack && typeof pkEnabled === 'function' && pkEnabled()); }
// 草稿发布：把 published 改成 true 并保存（有编辑权限的老师才会看到）
async function scPublish(id) {
  const r = (sc.rows || []).find(x => x.id === id); if (!r || !scCanEdit(r)) return;
  try {
    const now = new Date().toISOString();
    await sb(`/rest/v1/success_cases?id=eq.${encodeURIComponent(id)}`, 'PATCH', { published: true, updated_at: now });
    r.published = true; r.updated_at = now;
    sc.rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    scRender();
  } catch (e) { alert('发布失败：' + e.message); }
}
// 草稿时的说明：不能加入的原因 + 能编辑的老师直接给「发布」
function scDraftNote(r) {
  return `<span style="font-size:10px;color:var(--text-3)">草稿，发布后才能加入</span>${scCanEdit(r) ? `<button class="btn btn-outline btn-sm" style="font-size:10px;padding:1px 10px" onclick="scPublish('${scE(r.id)}')">发布</button>` : ''}`;
}
function scCardHtml(r, packOn) {
  const on = sc.sel.has(r.id), tags = scArr(r.tags);
  return `<div style="background:var(--surface);border:1px solid ${on ? 'var(--accent)' : 'var(--border-light)'};${on ? 'box-shadow:0 0 0 1px var(--accent);' : ''}border-radius:5px;padding:12px 14px;display:flex;flex-direction:column;gap:6px">
    <div onclick="sc.openId='${scE(r.id)}';sc.view='detail';scRender()" style="cursor:pointer">
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><span style="font-size:14px;font-weight:600;font-family:'Noto Serif SC',serif">${scE(r.alias)}</span>
        ${sc.ctx.canWrite && scCanEdit(r) ? `<span style="font-size:9px;border-radius:2px;padding:1px 7px;${r.published ? 'background:var(--ok-bg,#e4f0e8);color:var(--ok,#2a9e6a)' : 'background:var(--bg);color:var(--text-3);border:1px dashed var(--border)'}">${r.published ? '已发布' : '草稿'}</span>` : ''}
        <span style="font-size:10px;color:var(--text-3)">${scE(r.domain)}</span></div>
      <div style="font-size:11px;color:var(--text-2);margin-top:2px">${scE(r.tagline || '')}</div>
      <div style="font-size:11px;color:var(--accent);margin-top:5px;font-weight:600">✓ ${scE(r.result || '—')}</div>
    </div>
    ${tags.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${tags.map(t => `<span style="font-size:9px;background:var(--bg);border:1px solid var(--border-light);border-radius:8px;padding:0 7px;color:var(--text-2)">${scE(t)}</span>`).join('')}</div>` : ''}
    <div style="display:flex;gap:6px;align-items:center;margin-top:auto">
      <button class="btn btn-outline btn-sm" onclick="sc.openId='${scE(r.id)}';sc.view='detail';scRender()">查看</button>
      ${scCanEdit(r) ? `<button class="btn btn-outline btn-sm" onclick="scEdit('${scE(r.id)}')">✏ 编辑</button>` : ''}
      ${packOn && r.published ? `<div class="filter-chip${on ? ' active' : ''}" onclick="scToggleSel('${scE(r.id)}')" style="margin-left:auto;padding:3px 12px;font-size:10px">${on ? '✓ 已选用' : '选用'}</div>` : ''}
      ${packOn && !r.published ? `<span style="margin-left:auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end"><span class="filter-chip" style="padding:3px 12px;font-size:10px;opacity:.45;cursor:not-allowed;pointer-events:none">选用</span>${scDraftNote(r)}</span>` : ''}
    </div></div>`;
}
function scPackBar(n) {
  const chip = (on, label, fn) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${fn}" style="padding:3px 10px;font-size:10px">${label}</div>`;
  return `<div style="position:sticky;bottom:8px;margin-top:14px;background:#3a2e24;color:#f7f5f0;border-radius:6px;padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <span style="font-size:12px">已选 <b>${n}</b> 个案例</span>
    <span style="font-size:10px;opacity:.75">默认只放时间线和感言；可一起放：</span>
    ${chip(sc.opt.works, '作业图片', 'sc.opt.works=!sc.opt.works;scRender()')}${chip(sc.opt.plans, '计划书 / 志望理由书', 'sc.opt.plans=!sc.opt.plans;scRender()')}${chip(sc.opt.others, '其他展示', 'sc.opt.others=!sc.opt.others;scRender()')}
    <button onclick="scAddToPack()" ${n ? '' : 'disabled'} style="margin-left:auto;font-size:12px;background:#f7f5f0;color:#3a2e24;border:none;border-radius:3px;padding:6px 16px;cursor:${n ? 'pointer' : 'not-allowed'};opacity:${n ? 1 : .5};font-family:inherit">➕ 加入宣传资料</button></div>`;
}
function scToggleSel(id) { if (sc.sel.has(id)) sc.sel.delete(id); else sc.sel.add(id); scRender(); }

// ══════════ 详情（时间线表格 / 作业 / 计划书）══════════
function scTableRows(r) {
  const rows = [];
  if ((r.background || '').trim()) rows.push(['背景', r.background]);
  scArr(r.timeline).forEach(t => { if ((t.period || t.content || '').trim()) rows.push([t.period || '', t.content || '']); });
  if ((r.result || '').trim()) rows.push(['合格', r.result + ' ✓']);
  return rows;
}
function scDetailHtml() {
  const r = (sc.rows || []).find(x => x.id === sc.openId); if (!r) { sc.view = 'list'; return scListHtml(); }
  const works = scArr(r.works), plans = scArr(r.plan_files), others = scArr(r.others);
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="sc.view='list';scRender()">← 返回</button>
      ${scCanEdit(r) ? `<button class="btn btn-outline btn-sm" onclick="scEdit('${scE(r.id)}')">✏ 编辑</button>` : ''}
      ${scPackOn() ? (r.published ? `<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto"><span style="font-size:10px;color:var(--text-3)">可一起放：</span>
        <div class="filter-chip${sc.opt.works ? ' active' : ''}" onclick="sc.opt.works=!sc.opt.works;scRender()" style="padding:3px 10px;font-size:10px">作业图片</div>
        <div class="filter-chip${sc.opt.plans ? ' active' : ''}" onclick="sc.opt.plans=!sc.opt.plans;scRender()" style="padding:3px 10px;font-size:10px">计划书 / 志望理由书</div>
        <div class="filter-chip${sc.opt.others ? ' active' : ''}" onclick="sc.opt.others=!sc.opt.others;scRender()" style="padding:3px 10px;font-size:10px">其他展示</div>
        <button class="btn btn-primary btn-sm" onclick="scAddOne('${scE(r.id)}')">➕ 加入宣传资料</button></span>`
        : `<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto"><button class="btn btn-primary btn-sm" disabled style="opacity:.45">➕ 加入宣传资料</button>${scDraftNote(r)}</span>`) : ''}</div>
    <div style="background:var(--surface);border:1px solid var(--border-light);border-radius:5px;padding:16px 18px;max-width:820px">
      <div style="font-size:16px;font-weight:600;font-family:'Noto Serif SC',serif">${scE(r.alias)} — ${scE(r.tagline || '')}</div>
      <div style="font-size:10px;color:var(--text-3);margin:3px 0 10px">${scE(r.domain)} · ${scArr(r.majors).map(m => scE(typeof majorLabel === 'function' ? majorLabel(m) : m)).join('、')} ${scArr(r.tags).length ? ' · ' + scArr(r.tags).map(scE).join('、') : ''}</div>
      ${scTableHtml(r, false)}
      ${(r.quote || '').trim() ? `<div style="border-left:3px solid var(--accent);padding:4px 12px;margin:10px 0;color:var(--text-2);font-size:12px;line-height:1.9">“${scE(r.quote)}”</div>` : ''}
      ${works.length ? `<div style="font-size:11px;font-weight:600;margin:12px 0 6px">作业展示</div>${scWorksHtml(works, false)}` : ''}
      ${plans.length ? `<div style="font-size:11px;font-weight:600;margin:12px 0 6px">计划书 / 志望理由书（老师批改版）</div>${scPlansHtml(plans, false)}` : ''}
      ${others.length ? `<div style="font-size:11px;font-weight:600;margin:12px 0 2px">其他展示</div>${scOthersHtml(others, false)}` : ''}
    </div>`;
}
function scTableHtml(r, forDoc) {
  const rows = scTableRows(r);
  if (!rows.length) return '';
  const last = rows.length - 1, hasResult = (r.result || '').trim();
  return `<table class="${forDoc ? 'pk-case-t' : ''}" style="width:100%;border-collapse:collapse;font-size:12px;margin:6px 0">
    <thead><tr><th style="text-align:left;padding:6px 10px;background:var(--bg);border:1px solid var(--border);color:var(--accent);width:22%;font-size:10px">时期</th><th style="text-align:left;padding:6px 10px;background:var(--bg);border:1px solid var(--border);color:var(--accent);font-size:10px">内容</th></tr></thead>
    <tbody>${rows.map((x, i) => `<tr><td style="padding:6px 10px;border:1px solid var(--border-light);color:var(--text-2);white-space:nowrap;vertical-align:top">${scE(x[0])}</td>
      <td style="padding:6px 10px;border:1px solid var(--border-light);color:var(--text-2);${i === last && hasResult ? 'font-weight:700;color:var(--accent)' : ''}">${scE(x[1])}</td></tr>`).join('')}</tbody></table>`;
}
function scWorksHtml(works, small) {
  const sz = small ? 90 : 130;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${sz}px,1fr));gap:8px">${works.map(w => `<div style="min-width:0">
    <a href="${scE(w.url)}" target="_blank"><img src="${scE(w.url)}" loading="lazy" style="width:100%;height:${sz}px;object-fit:cover;border:1px solid var(--border);border-radius:3px"></a>
    ${w.caption ? `<div style="font-size:9px;color:var(--text-3);margin-top:2px">${scE(w.caption)}</div>` : ''}
    ${w.feedback ? `<div style="font-size:9px;color:var(--text-2);line-height:1.5;margin-top:1px">${scE(w.feedback)}</div>` : ''}</div>`).join('')}</div>`;
}
// 其他展示：按类型分组；图片显示缩略图，文件显示 📎 文件名链接
function scOthersHtml(others, forDoc) {
  const cats = [...SC_OTHER_CATS, ...new Set(others.map(o => o.category || '课堂笔记').filter(k => !SC_OTHER_CATS.includes(k)))];
  return cats.map(k => {
    const list = others.filter(o => (o.category || '课堂笔记') === k); if (!list.length) return '';
    const imgs = list.filter(o => o.kind === 'image'), files = list.filter(o => o.kind !== 'image');
    return `<div class="${forDoc ? 'pk-case-s' : ''}" style="font-size:10px;color:var(--text-3);margin:8px 0 4px">${scE(k)}</div>
      ${imgs.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${forDoc ? 90 : 130}px,1fr));gap:8px;margin-bottom:4px">${imgs.map(o => `<div style="min-width:0"><a href="${scE(o.url)}" target="_blank"><img src="${scE(o.url)}" loading="lazy" style="width:100%;height:${forDoc ? 90 : 130}px;object-fit:cover;border:1px solid var(--border);border-radius:3px"></a>${o.note ? `<div style="font-size:9px;color:var(--text-3);margin-top:2px">${scE(o.note)}</div>` : ''}</div>`).join('')}</div>` : ''}
      ${files.map(o => `<div style="font-size:11px;margin-bottom:4px">📎 <a href="${scE(o.url)}" target="_blank" style="color:var(--accent)">${scE(o.name || '文件')}</a>${o.note ? `<span style="color:var(--text-3)"> · ${scE(o.note)}</span>` : ''}</div>`).join('')}`;
  }).join('');
}
function scPlansHtml(plans, forDoc) {
  const isImg = u => /\.(jpe?g|png|gif|webp)(\?|$)/i.test(u || '');
  return plans.map(p => isImg(p.url)
    ? `<div style="margin-bottom:6px"><a href="${scE(p.url)}" target="_blank"><img src="${scE(p.url)}" style="max-width:100%;max-height:${forDoc ? 300 : 220}px;border:1px solid var(--border);border-radius:3px"></a><div style="font-size:10px;color:var(--text-3)">${scE(p.name || '')}${p.note ? ' · ' + scE(p.note) : ''}</div></div>`
    : `<div style="font-size:11px;margin-bottom:4px">📎 <a href="${scE(p.url)}" target="_blank" style="color:var(--accent)">${scE(p.name || '文件')}</a>${p.note ? `<span style="color:var(--text-3)"> · ${scE(p.note)}</span>` : ''}</div>`).join('');
}

// ══════════ 加入宣传资料 ══════════
// 每个案例一个卡片：标题「小A — 一句话标签」+ 时期|内容表 + 感言（引用）+（可选）作业小图 / 计划书
function scDocHtml(cases, opt) {
  return cases.map(r => {
    const works = opt.works ? scArr(r.works) : [], plans = opt.plans ? scArr(r.plan_files) : [], others = opt.others ? scArr(r.others) : [];
    return `<div class="pk-case">
      <div class="pk-case-h">${scE(r.alias)}${r.tagline ? ' — ' + scE(r.tagline) : ''}</div>
      ${scTableHtml(r, true)}
      ${(r.quote || '').trim() ? `<div class="pk-case-q">“${scE(r.quote)}”</div>` : ''}
      ${works.length ? `<div class="pk-case-s">作业展示</div>${scWorksHtml(works, true)}` : ''}
      ${plans.length ? `<div class="pk-case-s">计划书 / 志望理由书（老师批改版）</div>${scPlansHtml(plans, true)}` : ''}
      ${others.length ? `<div class="pk-case-s">其他展示</div>${scOthersHtml(others, true)}` : ''}
    </div>`;
  }).join('');
}
// 详情页：把这一个案例直接加入资料（选项用当前的 作业图片 / 计划书 开关）
function scAddOne(id) {
  if (typeof pkAdd !== 'function') return;
  const r = (sc.rows || []).find(x => x.id === id); if (!r || !r.published) return;
  pkAdd({ type: 'cases', title: `合格案例 · ${r.alias}`, html: scDocHtml([r], sc.opt) });
}
function scAddToPack() {
  if (typeof pkAdd !== 'function') return;
  const cases = (sc.rows || []).filter(r => sc.sel.has(r.id) && r.published);
  if (!cases.length) return;
  const one = cases.length === 1;
  pkAdd({ type: 'cases', title: one ? `合格案例 · ${cases[0].alias}` : `合格案例（${cases.length} 个）`, html: scDocHtml(cases, sc.opt) });
  sc.sel = new Set(); scRender();
}

// ══════════ 编辑 ══════════
function scNextAlias() {
  const used = new Set((sc.rows || []).map(r => r.alias));
  for (let i = 0; i < 26; i++) { const a = '小' + String.fromCharCode(65 + i); if (!used.has(a)) return a; }
  return '小' + ((sc.rows || []).length + 1);
}
function scBlank() {
  const lock = sc.ctx.lockDomain || '';
  const doms = scAllowedDomains();
  return { id: '', domain: lock || doms[0] || '', majors: [], student_id: '', alias: scNextAlias(), tagline: '', background: '', timeline: [], schools: [], schoolInput: '', schoolNew: 0, quote: '', works: [], plan_files: [], others: [], tags: [], published: false,
    stuSearch: '', cand: null, tagInput: '' };
}
function scAllowedDomains() { return DOMAINS.map(d => d.label).filter(d => sc.ctx.allowDomain(d)); }
function scNew() { sc.cur = scBlank(); sc.view = 'edit'; scRender(); scEnsureStudents(); }
function scEdit(id) {
  const r = (sc.rows || []).find(x => x.id === id); if (!r) return;
  sc.cur = { id: r.id, domain: r.domain, majors: scArr(r.majors).slice(), student_id: r.student_id || '', alias: r.alias || '', tagline: r.tagline || '', background: r.background || '', timeline: scArr(r.timeline).map(t => ({ period: t.period || '', content: t.content || '' })),
    schools: scSplitResult(r.result).map(l => ({ label: l, on: true })), schoolInput: '', schoolNew: 0, quote: r.quote || '', works: scArr(r.works).map(w => Object.assign({}, w)), plan_files: scArr(r.plan_files).map(p => Object.assign({}, p)), others: scArr(r.others).map(o => Object.assign({}, o)), tags: scArr(r.tags).slice(), published: r.published === true, stuSearch: '', cand: null, tagInput: '' };
  sc.view = 'edit'; scRender(); scEnsureStudents();
  if (sc.cur.student_id) { scLoadCandidates(); scMergeSchools(sc.cur); }
}
async function scEnsureStudents() {
  if (sc.stu) return;
  try { sc.stu = await sc.ctx.loadStudents(); } catch (e) { sc.stu = []; }
  if (sc.view === 'edit') scRerenderStuSelect();
}
// 合格案例只关联已合格的学生：学生档案状态为「已合格」(graduated)，或志望校里有任一所是合格(passed)；给每人带上合格校名
async function scOnlyPassed(all) {
  const plans = await sbAll('/rest/v1/student_school_plans?status=eq.passed&select=student_id,school_name');
  const by = {};
  (plans || []).forEach(p => { const k = String(p.student_id); (by[k] = by[k] || []); if (p.school_name && !by[k].includes(p.school_name)) by[k].push(p.school_name); });
  return (all || []).filter(s => s.status === 'graduated' || by[String(s.id)]).map(s => Object.assign({}, s, { passedSchools: by[String(s.id)] || [] }));
}
function scStuOptions() {
  const c = sc.cur, kw = (c.stuSearch || '').trim(), all = sc.stu || [];
  const list = all.filter(s => !kw || (typeof matchesStudentSearch === 'function' ? matchesStudentSearch(s, kw) : (s.name || '').includes(kw)));
  const none = sc.stu && !all.length;
  const head = !sc.stu ? '学生列表读取中…' : none ? '— 还没有已合格的学生（学生档案状态为「已合格」，或志望校里有合格的学校）—' : `— 选择已合格的学生（${list.length}）—`;
  const sch = s => { const t = (s.passedSchools || []).join('、'); return t ? ' · ' + (t.length > 24 ? t.slice(0, 24) + '…' : t) : ''; };
  return `<option value="">${scE(head)}</option>` + list.map(s => `<option value="${scE(s.id)}" ${String(c.student_id) === String(s.id) ? 'selected' : ''}>${scE(s.name)} · ${scE(typeof majorLabel === 'function' ? majorLabel(s.major) : s.major)}${scE(sch(s))}</option>`).join('');
}
function scRerenderStuSelect() { const el = document.getElementById('sc_stu'); if (el) el.innerHTML = scStuOptions(); }

function scEditHtml() {
  const c = sc.cur;
  const inp = 'width:100%;box-sizing:border-box;font-size:12px;padding:7px 9px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit';
  const lbl = t => `<label style="font-size:10px;color:var(--text-3);display:block;margin-bottom:3px">${t}</label>`;
  const box = 'background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:12px 14px;margin-bottom:12px';
  const h = t => `<div style="font-size:12px;font-weight:600;margin-bottom:8px">${t}</div>`;
  const chip = (on, label, fn) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${fn}" style="padding:3px 10px;font-size:11px">${label}</div>`;
  const doms = scAllowedDomains();
  const domMajors = (typeof allMajorKeys === 'function' ? allMajorKeys() : Object.keys(MAJORS)).filter(k => MAJOR_DOMAIN[k] === c.domain && sc.ctx.allowMajor(k));
  const tagPool = [...new Set(SC_TAG_HINTS.concat((sc.rows || []).flatMap(r => scArr(r.tags)), c.tags))];
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="scCancelEdit()">← 返回</button>
      <div style="font-size:12px;font-weight:600">${c.id ? '编辑案例' : '新建案例'}</div>
      <span style="font-size:10px;color:var(--text-3)">对外只显示称呼；学生真名只用来带出数据，不会写进案例</span></div>
    <div style="max-width:860px">
    <div style="${box}">${h('① 关联学生（可不选）')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
        <div>${lbl('搜索学生')}<input value="${scE(c.stuSearch)}" placeholder="姓名 / 拼音首字母" oninput="sc.cur.stuSearch=this.value;scRerenderStuSelect()" style="${inp}"></div>
        <div>${lbl('选择已合格的学生（自动带出背景、合格校、时间线草稿）')}<select id="sc_stu" onchange="scPickStudent(this.value)" style="${inp}">${scStuOptions()}</select></div>
      </div>
      ${c.student_id ? `<div style="margin-top:8px"><button class="btn btn-outline btn-sm" onclick="scRefill()">↻ 重新带出（覆盖背景 / 合格 / 时间线）</button></div>` : ''}
    </div>
    <div style="${box}">${h('② 基本信息')}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
        <div>${lbl('对外称呼')}<input value="${scE(c.alias)}" oninput="sc.cur.alias=this.value" style="${inp}"></div>
        <div>${lbl('一句话标签')}<input value="${scE(c.tagline)}" placeholder="例：语校4月生·方向模糊" oninput="sc.cur.tagline=this.value" style="${inp}"></div>
        <div>${lbl('领域')}<select style="${inp}" ${sc.ctx.lockDomain ? 'disabled' : ''} onchange="sc.cur.domain=this.value;sc.cur.majors=[];scRender()">${doms.map(d => `<option value="${scE(d)}" ${d === c.domain ? 'selected' : ''}>${scE(d)}</option>`).join('')}</select></div>
      </div>
      <div style="margin-top:8px">${lbl('专业（可多选）')}<div style="display:flex;gap:6px;flex-wrap:wrap">${domMajors.map(m => chip(c.majors.includes(m), scE(typeof majorLabel === 'function' ? majorLabel(m) : m), `scToggleMajor('${scE(m)}')`)).join('') || '<span style="font-size:10px;color:var(--text-3)">这个领域里没有你负责的专业</span>'}</div></div>
      <div style="margin-top:8px">${lbl('标签（点选，也可以自己加）')}<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${tagPool.map(t => chip(c.tags.includes(t), scE(t), `scToggleTag(${JSON.stringify(t).replace(/"/g, '&quot;')})`)).join('')}
        <input value="${scE(c.tagInput)}" placeholder="新标签，回车添加" oninput="sc.cur.tagInput=this.value" onkeydown="if(event.key==='Enter'){event.preventDefault();scAddTag()}" style="font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:10px;background:var(--bg);width:130px;font-family:inherit"></div></div>
    </div>
    <div style="${box}">${h('③ 背景 · 时间线 · 合格')}
      ${lbl('背景')}<input value="${scE(c.background)}" placeholder="例：N1 130分 / TOEIC 700+ / 有兴趣但方向不清" oninput="sc.cur.background=this.value" style="${inp};margin-bottom:10px">
      ${lbl('时间线（时期 | 内容）')}
      ${c.timeline.map((t, i) => `<div style="display:grid;grid-template-columns:100px 1fr 26px 26px;gap:6px;margin-bottom:5px;align-items:center">
        <input value="${scE(t.period)}" placeholder="如 5月" oninput="sc.cur.timeline[${i}].period=this.value" onblur="scTlBlur(${i},this.value)" style="${inp}">
        <input value="${scE(t.content)}" placeholder="如 报名社会人文学系课程" oninput="sc.cur.timeline[${i}].content=this.value" style="${inp}">
        <span onclick="scMoveRow(${i},-1)" style="cursor:pointer;text-align:center;color:var(--text-3)">↑</span>
        <span onclick="sc.cur.timeline.splice(${i},1);scRender()" style="cursor:pointer;text-align:center;color:var(--danger)">✕</span></div>`).join('')}
      <button class="btn btn-outline btn-sm" onclick="sc.cur.timeline.push({period:'',content:''});scSortTimeline(sc.cur);scRender()">＋ 添加一行</button>
      <div style="font-size:10px;color:var(--text-3);margin-top:4px">按时期自动排序；时期写成『2026年3月』这种格式最准确</div>
      <div style="margin-top:10px">${lbl('合格学校（选了学生会自动带出；点一下取消不想对外展示的学校）')}
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${c.schools.map((x, i) => chip(x.on, scE(x.label), `sc.cur.schools[${i}].on=!sc.cur.schools[${i}].on;scRender()`)).join('') || '<span style="font-size:10px;color:var(--text-3)">还没有合格学校</span>'}
        </div>
        ${c.schoolNew ? `<div style="font-size:10px;color:var(--accent);margin-top:4px">新带出 ${c.schoolNew} 所</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:6px"><input value="${scE(c.schoolInput)}" placeholder="＋ 手动添加（系统里没有的学校），回车添加" oninput="sc.cur.schoolInput=this.value" onkeydown="if(event.key==='Enter'){event.preventDefault();scAddSchool()}" style="${inp}"></div></div>
      <div style="margin-top:10px">${lbl('学生感言')}<textarea rows="2" oninput="sc.cur.quote=this.value" style="${inp};line-height:1.7;resize:vertical" placeholder="例：有热爱支持着就不会觉得苦，拿到合格通知书的那一刻激动得不能自已。">${scE(c.quote)}</textarea></div>
    </div>
    <div style="${box}">${h('④ 作业展示')}
      <div style="font-size:10px;color:var(--warn,#b8860b);background:#fff8e6;border:1px solid #e8d4a0;border-radius:3px;padding:4px 8px;margin-bottom:8px">请确认图片中没有学生真实姓名（对外只显示称呼）。</div>
      ${c.student_id ? scWorksPickHtml() : '<div style="font-size:11px;color:var(--text-3)">先在上面选一个学生，才能从他的作业里点选；也可以直接上传图片。</div>'}
      ${c.works.some(w => w.src !== 'upload') ? `<div style="font-size:10px;color:var(--text-3);margin:8px 0 4px">已选 ${c.works.filter(w => w.src !== 'upload').length} 张：</div>${scWorksHtml(c.works.filter(w => w.src !== 'upload'), true)}` : ''}
      <div style="margin-top:10px">
        ${c.works.map((w, i) => w.src !== 'upload' ? '' : `<div style="display:grid;grid-template-columns:70px 1fr 1fr 26px;gap:6px;margin-bottom:5px;align-items:center">
          <a href="${scE(w.url)}" target="_blank"><img src="${scE(w.url)}" style="width:70px;height:50px;object-fit:cover;border:1px solid var(--border);border-radius:3px"></a>
          <input value="${scE(w.caption || '')}" placeholder="说明" oninput="sc.cur.works[${i}].caption=this.value" style="${inp}">
          <input value="${scE(w.feedback || '')}" placeholder="老师点评" oninput="sc.cur.works[${i}].feedback=this.value" style="${inp}">
          <span onclick="sc.cur.works.splice(${i},1);scRender()" style="cursor:pointer;text-align:center;color:var(--danger)">✕</span></div>`).join('')}
        <label class="btn btn-outline btn-sm" style="cursor:pointer;display:inline-block">＋ 上传作业图片<input type="file" accept="image/*" multiple onchange="scUploadWork(this)" style="display:none"></label>
        <span id="sc_upw_tip" style="font-size:10px;color:var(--text-3);margin-left:6px"></span>
      </div>
    </div>
    <div style="${box}">${h('⑤ 计划书 / 志望理由书（老师批改版）')}
      <div style="font-size:10px;color:var(--warn,#b8860b);background:#fff8e6;border:1px solid #e8d4a0;border-radius:3px;padding:4px 8px;margin-bottom:8px">请确认文件 / 图片中没有学生真实姓名。</div>
      ${c.student_id ? scPlansPickHtml() : ''}
      ${c.plan_files.map((p, i) => `<div style="display:grid;grid-template-columns:1.2fr 1fr 26px;gap:6px;margin-bottom:5px;align-items:center">
        <a href="${scE(p.url)}" target="_blank" style="font-size:11px;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📎 ${scE(p.name || '文件')}</a>
        <input value="${scE(p.note || '')}" placeholder="说明（如 志望校名）" oninput="sc.cur.plan_files[${i}].note=this.value" style="${inp}">
        <span onclick="sc.cur.plan_files.splice(${i},1);scRender()" style="cursor:pointer;text-align:center;color:var(--danger)">✕</span></div>`).join('')}
      <label class="btn btn-outline btn-sm" style="cursor:pointer;display:inline-block">＋ 上传文件<input type="file" multiple onchange="scUploadPlan(this)" style="display:none"></label>
      <span id="sc_up_tip" style="font-size:10px;color:var(--text-3);margin-left:6px"></span>
    </div>
    <div style="${box}">${h('⑥ 其他展示（课堂笔记、老师解答等）')}
      <div style="font-size:10px;color:var(--warn,#b8860b);background:#fff8e6;border:1px solid #e8d4a0;border-radius:3px;padding:4px 8px;margin-bottom:8px">请确认文件 / 图片中没有学生真实姓名。</div>
      ${c.others.map((o, i) => `<div style="display:grid;grid-template-columns:1.1fr 110px 1.2fr 26px;gap:6px;margin-bottom:5px;align-items:center">
        <a href="${scE(o.url)}" target="_blank" style="font-size:11px;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.kind === 'image' ? `<img src="${scE(o.url)}" style="width:40px;height:30px;object-fit:cover;vertical-align:middle;border:1px solid var(--border);border-radius:2px"> ` : '📎 '}${scE(o.name || '文件')}</a>
        <select onchange="sc.cur.others[${i}].category=this.value" style="${inp}">${SC_OTHER_CATS.map(k => `<option value="${k}" ${(o.category || '课堂笔记') === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <input value="${scE(o.note || '')}" placeholder="说明" oninput="sc.cur.others[${i}].note=this.value" style="${inp}">
        <span onclick="sc.cur.others.splice(${i},1);scRender()" style="cursor:pointer;text-align:center;color:var(--danger)">✕</span></div>`).join('')}
      <label class="btn btn-outline btn-sm" style="cursor:pointer;display:inline-block">＋ 上传<input type="file" multiple accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt" onchange="scUploadOther(this)" style="display:none"></label>
      <span id="sc_upo_tip" style="font-size:10px;color:var(--text-3);margin-left:6px"></span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:30px">
      ${chip(c.published, '发布（营业老师可见）', 'sc.cur.published=!sc.cur.published;scRender()')}
      <button class="btn btn-primary" onclick="scSave()">💾 保存</button>
      <button class="btn btn-outline" onclick="scCancelEdit()">取消</button>
      <span style="font-size:10px;color:var(--text-3)">${c.published ? '保存后营业老师可以看到并选用' : '当前是草稿：不会出现在宣传资料里，营业老师也看不到'}</span>
      ${c.id ? `<button class="btn" style="margin-left:auto;color:var(--danger);border:1px solid var(--danger);background:none" onclick="scDelete('${scE(c.id)}')">删除案例</button>` : ''}
    </div></div>`;
}
function scCancelEdit() { sc.view = sc.openId && (sc.rows || []).some(r => r.id === sc.openId) && sc.cur && sc.cur.id ? 'detail' : 'list'; sc.cur = null; scRender(); }
function scToggleMajor(m) { const a = sc.cur.majors, i = a.indexOf(m); if (i >= 0) a.splice(i, 1); else a.push(m); scRender(); }
function scToggleTag(t) { const a = sc.cur.tags, i = a.indexOf(t); if (i >= 0) a.splice(i, 1); else a.push(t); scRender(); }
function scAddTag() { const t = (sc.cur.tagInput || '').trim(); sc.cur.tagInput = ''; if (t && !sc.cur.tags.includes(t)) sc.cur.tags.push(t); scRender(); }
function scMoveRow(i, d) { const a = sc.cur.timeline, j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; scRender(); }

// ── 选学生 → 自动带出 ──
async function scPickStudent(id) {
  const c = sc.cur; c.student_id = id || '';
  if (!id) { c.cand = null; scRender(); return; }
  const s = (sc.stu || []).find(x => String(x.id) === String(id));
  if (s) {
    const d = MAJOR_DOMAIN[s.major];
    if (d && sc.ctx.allowDomain(d) && !sc.ctx.lockDomain) c.domain = d;
    if (!c.majors.length && s.major && sc.ctx.allowMajor(s.major) && MAJOR_DOMAIN[s.major] === c.domain) c.majors = [s.major];
  }
  scRender();
  await scAutoFill(false);
  scLoadCandidates();
}
async function scRefill() {
  if (!confirm('重新带出会覆盖当前的「背景 / 合格学校 / 时间线」（手动添加的学校也会清掉），确定吗？')) return;
  await scAutoFill(true);
}
async function scAutoFill(overwrite) {
  const c = sc.cur, id = c.student_id; if (!id) return;
  const q = p => sb(p).catch(() => []);
  const [st, tl] = await Promise.all([q(`/rest/v1/students?id=eq.${encodeURIComponent(id)}&select=*`), q(`/rest/v1/student_progress_timeline?student_id=eq.${encodeURIComponent(id)}&select=*&order=created_at.asc`)]);
  const s = (st || [])[0]; if (!s) return;
  const sys = await scSystemSchools(id, s.name);
  if (sc.cur !== c || c.student_id !== id) return;   // 期间换了学生 / 退出编辑
  const bg = [s.japanese_score ? `日语 ${s.japanese_score}` : '', s.english_score ? `英语 ${s.english_score}` : '', [s.university, s.faculty].filter(Boolean).join(' ')].filter(Boolean).join(' / ');
  const timeline = scTimelineDraft(s, tl || []);
  if (overwrite || !c.background.trim()) c.background = bg;
  if (overwrite) { c.schools = sys.map(l => ({ label: l, on: true })); c.schoolNew = 0; }
  else if (!c.schools.length) c.schools = sys.map(l => ({ label: l, on: true }));
  if (overwrite || !c.timeline.length) c.timeline = timeline;
  scSortTimeline(c);
  scRender();
}
// ── 时间线按时期自动排序 ──
// 「时期」文字 → 排序键（年*100+月）：2024年4月 / 2024/4 / 2024-04 / 2024.4 → 年月；2024年 / 2024-2025年 → 取第一个年份、月 0；
// 4月（没写年份）→ 沿用上一行的年份；解析不出来的返回 null
function scPeriodKey(t, prevYear) {
  t = String(t || '');
  let m = /(\d{4})\s*(?:年\s*(\d{1,2})\s*月?|[\/\-.](\d{1,2})(?!\d))/.exec(t);
  if (m) { const mo = +(m[2] || m[3]); return { y: +m[1], m: mo >= 1 && mo <= 12 ? mo : 0 }; }
  m = /(\d{4})/.exec(t);
  if (m) return { y: +m[1], m: 0 };
  m = /(\d{1,2})\s*月/.exec(t);
  if (m && prevYear && +m[1] >= 1 && +m[1] <= 12) return { y: prevYear, m: +m[1] };
  return null;
}
// 解析不出的行（保持原相对位置）排在能解析的行前面，空白的新行放最后；同一年月保持原来的先后。返回顺序是否变了
function scSortTimeline(c) {
  const rows = c.timeline || [];
  let py = 0;
  const items = rows.map((r, i) => { const k = scPeriodKey(r.period, py); if (k) py = k.y; return { r, i, k, blank: !String(r.period || '').trim() }; });
  const front = items.filter(x => !x.k && !x.blank), back = items.filter(x => !x.k && x.blank);
  const ok = items.filter(x => x.k).sort((a, b) => (a.k.y * 100 + a.k.m) - (b.k.y * 100 + b.k.m) || a.i - b.i);
  const next = front.concat(ok, back);
  const changed = next.some((x, j) => x.i !== j);
  if (changed) c.timeline = next.map(x => x.r);
  return changed;
}
function scTlBlur(i, v) { sc.cur.timeline[i].period = v; if (scSortTimeline(sc.cur)) scRender(); }

// ── 合格学校 chip ──
// 结果文本 ↔ chip：保存时选中的学校用「 · 」连接；回显时把紧跟在学校名后面的「研究科 / 学部」等片段并回上一所
const scSchoolKey = l => String(l || '').split(' · ')[0].trim();
function scSplitResult(t) {
  const out = [];
  String(t || '').split(/\s*·\s*/).map(x => x.trim()).filter(Boolean).forEach(x => {
    if (out.length && /(研究科|学部|学環|学府|専攻|学科)$/.test(x) && !out[out.length - 1].includes(' · ')) out[out.length - 1] += ' · ' + x;
    else out.push(x);
  });
  return out;
}
// 系统里的合格学校：志望校里状态为合格的 + admission_results 按姓名找到的（同一所学校去重）
async function scSystemSchools(id, name) {
  const q = p => sb(p).catch(() => []);
  const [plans, res] = await Promise.all([
    q(`/rest/v1/student_school_plans?student_id=eq.${encodeURIComponent(id)}&status=eq.passed&select=school_name,faculty&order=level.asc`),
    name ? q(`/rest/v1/admission_results?student=eq.${encodeURIComponent(name)}&select=univ,dept,created_at&order=created_at.asc`) : Promise.resolve([]),
  ]);
  const out = [], seen = new Set();
  (plans || []).forEach(p => { const n = String(p.school_name || '').trim(); if (!n) return; const l = p.faculty ? `${n} · ${String(p.faculty).trim()}` : n; if (!out.includes(l)) { out.push(l); seen.add(n); } });
  (res || []).forEach(r => { const n = String(r.univ || '').trim(); if (n && !seen.has(n)) { seen.add(n); out.push(n); } });
  return out;
}
// 编辑已有案例：把系统里新增的合格校补上（默认选中并提示）
async function scMergeSchools(c) {
  const id = c.student_id; if (!id) return;
  const st = await sb(`/rest/v1/students?id=eq.${encodeURIComponent(id)}&select=name`).catch(() => []);
  const sys = await scSystemSchools(id, (st[0] || {}).name);
  if (sc.cur !== c || c.student_id !== id) return;
  const have = new Set(c.schools.map(x => scSchoolKey(x.label)));
  const add = sys.filter(l => !have.has(scSchoolKey(l)));
  if (!add.length) return;
  add.forEach(l => c.schools.push({ label: l, on: true }));
  c.schoolNew = add.length;
  if (sc.view === 'edit') scRender();
}
function scAddSchool() {
  const c = sc.cur, t = (c.schoolInput || '').trim(); c.schoolInput = '';
  if (t && !c.schools.some(x => x.label === t)) c.schools.push({ label: t, on: true });
  scRender();
}
// 时间线草稿：报名时间 + 进度记录里的关键节点（同一个月合并成一行）
function scTimelineDraft(s, tl) {
  const firstYear = (s.signup_date || (tl[0] && (tl[0].recorded_at || tl[0].created_at)) || '').slice(0, 4);
  const label = ds => { const m = /^(\d{4})-(\d{2})/.exec(ds || ''); if (!m) return ''; return (m[1] !== firstYear ? `${m[1]}年` : '') + `${+m[2]}月`; };
  const months = {};
  const at = ds => { const k = (ds || '').slice(0, 7); if (!k) return null; return months[k] || (months[k] = { key: k, period: label(ds), first: '', dims: {}, notes: [] }); };
  if (s.signup_date) { const m = at(s.signup_date); if (m) m.first = `报名${(typeof majorLabel === 'function' && s.major) ? majorLabel(s.major) : ''}课程`; }
  const skip = new Set(['不需要', '未开始']), dims = ['japanese', 'english', 'plan', 'apply', 'exam'];
  tl.slice().sort((a, b) => String(a.recorded_at || a.created_at || '').localeCompare(String(b.recorded_at || b.created_at || ''))).forEach(e => {
    const m = at(String(e.recorded_at || e.created_at || '').slice(0, 10)); if (!m) return;
    dims.forEach(k => { const v = e[k]; if (v && !skip.has(v)) m.dims[k] = v; });   // 同一个月同一项，留最新的状态
    if (e.notes) m.notes.push(String(e.notes).slice(0, 40));
  });
  return Object.values(months).sort((a, b) => a.key.localeCompare(b.key)).map(m => ({
    period: m.period,
    content: [m.first].concat(dims.filter(k => m.dims[k]).map(k => `${PROGRESS_LABELS[k] || k}：${m.dims[k]}`), m.notes).filter(Boolean).join('；'),
  })).filter(r => r.content).slice(0, 14);
}

// ── 候选：有老师批改的作业、学部美术作品、批复过的志望理由书 ──
async function scLoadCandidates() {
  const c = sc.cur, id = c.student_id; if (!id) return;
  c.cand = { loading: true, hw: [], art: [], riyu: [] }; scRender();
  const q = p => sb(p).catch(() => []);
  const [hw, art, riyu] = await Promise.all([
    q(`/rest/v1/homework_submissions?student_id=eq.${encodeURIComponent(id)}&select=*&order=submitted_at.desc&limit=200`),
    q(`/rest/v1/art_works?student_id=eq.${encodeURIComponent(id)}&select=*&order=week_start.desc&limit=200`),
    q(`/rest/v1/riyu_submissions?student_id=eq.${encodeURIComponent(id)}&select=*`),
  ]);
  const hwOk = (hw || []).filter(x => hwFeedbacks(x).length);
  const sids = [...new Set(hwOk.map(x => x.session_id).filter(Boolean))], sess = {};
  for (let i = 0; i < sids.length; i += 40) (await q(`/rest/v1/course_sessions?id=in.(${sids.slice(i, i + 40).map(x => `"${x}"`).join(',')})&select=id,course_name,session_number,session_title`) || []).forEach(x => { sess[x.id] = x; });
  const fbText = o => { const f = hwFeedbacks(o).filter(x => x.knowledge || x.attitude || x.suggestions || x.text)[0]; if (!f) return ''; return [f.knowledge, f.attitude, f.suggestions].filter(Boolean).join('；').slice(0, 200) || String(f.text || '').slice(0, 200); };
  if (sc.cur !== c) return;
  c.cand = {
    loading: false,
    hw: hwOk.map(x => {
      const imgs = [];
      scArr(x.answers).forEach(a => scArr(a.images).forEach(im => { if (im && im.url && im.kind !== 'doc') imgs.push(im.url); }));
      const se = sess[x.session_id] || {};
      return { src: 'hw:' + x.id, label: `${se.course_name || '作业'}${se.session_number ? ' 第' + se.session_number + '回' : ''}`, imgs, feedback: fbText(x) };
    }).filter(x => x.imgs.length),
    art: (art || []).map(w => ({ src: 'art:' + w.id, label: `作品收集 ${w.week_start || ''}`, imgs: awImgs(w).map(im => im.url).filter(Boolean), feedback: fbText(w) })).filter(x => x.imgs.length),
    riyu: (riyu || []).filter(x => x.reviewed_file_url).map(x => ({ src: 'riyu:' + x.id, url: x.reviewed_file_url, name: x.reviewed_file_name || '批复版', note: [x.school_name, x.faculty, x.department].filter(Boolean).join(' · ') })),
  };
  scRender();
}
function scWorksPickHtml() {
  const cand = sc.cur.cand;
  if (!cand) return '';
  if (cand.loading) return '<div style="font-size:11px;color:var(--text-3)">读取作业…</div>';
  const sel = new Set(sc.cur.works.map(w => w.src));
  const item = (g, i, kind) => `<div onclick="scToggleWork('${kind}',${i})" style="cursor:pointer;width:118px;border:1px solid ${sel.has(g.src) ? 'var(--accent)' : 'var(--border-light)'};${sel.has(g.src) ? 'box-shadow:0 0 0 1px var(--accent);background:var(--accent-light,#f5ede3);' : ''}border-radius:4px;padding:5px">
    <img src="${scE(g.imgs[0])}" loading="lazy" style="width:100%;height:76px;object-fit:cover;border-radius:2px">
    <div style="font-size:9px;margin-top:3px;color:var(--text-2);line-height:1.4">${scE(g.label)}<br>${g.imgs.length} 张${g.feedback ? ' · 有反馈' : ''}${sel.has(g.src) ? ' · ✓' : ''}</div></div>`;
  const a = cand.hw.map((g, i) => item(g, i, 'hw')).join(''), b = cand.art.map((g, i) => item(g, i, 'art')).join('');
  if (!a && !b) return '<div style="font-size:11px;color:var(--text-3)">这位学生还没有老师批改过的作业，也没有作品收集。</div>';
  return `<div style="font-size:10px;color:var(--text-3);margin-bottom:4px">点选要展示的作业（高亮 = 选中）：</div><div style="display:flex;gap:8px;flex-wrap:wrap">${a}${b}</div>`;
}
function scToggleWork(kind, i) {
  const c = sc.cur, g = c.cand[kind][i]; if (!g) return;
  if (c.works.some(w => w.src === g.src)) c.works = c.works.filter(w => w.src !== g.src);
  else g.imgs.forEach((u, k) => c.works.push({ src: g.src, url: u, caption: g.label, feedback: k === 0 ? g.feedback : '' }));
  scRender();
}
function scPlansPickHtml() {
  const cand = sc.cur.cand;
  if (!cand || cand.loading || !cand.riyu.length) return '';
  const sel = new Set(sc.cur.plan_files.map(p => p.src));
  return `<div style="font-size:10px;color:var(--text-3);margin-bottom:4px">已批复的志望理由书（点选加入）：</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
    ${cand.riyu.map((r, i) => `<div class="filter-chip${sel.has(r.src) ? ' active' : ''}" onclick="scTogglePlan(${i})" style="padding:3px 10px;font-size:10px">${scE(r.note || r.name)}</div>`).join('')}</div>`;
}
function scTogglePlan(i) {
  const c = sc.cur, r = c.cand.riyu[i]; if (!r) return;
  if (c.plan_files.some(p => p.src === r.src)) c.plan_files = c.plan_files.filter(p => p.src !== r.src);
  else c.plan_files.push({ src: r.src, url: r.url, name: r.name, note: r.note });
  scRender();
}
async function scUploadPlan(input) {
  const files = [...(input.files || [])]; input.value = ''; if (!files.length) return;
  const c = sc.cur, tip = document.getElementById('sc_up_tip');
  try {
    for (let i = 0; i < files.length; i++) {
      if (tip) tip.textContent = `上传中 ${i + 1}/${files.length}…`;
      const f = files[i];
      let ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, ''); if (!ext || ext.length > 5) ext = 'bin';
      const url = await sbUpload('admission-photos', `cases/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`, f);
      c.plan_files.push({ url, name: f.name, note: '' });
    }
    scRender();
  } catch (e) { if (tip) tip.textContent = '上传失败：' + e.message; }
}

async function scUploadWork(input) {
  const files = [...(input.files || [])].filter(f => /^image\//.test(f.type)); input.value = ''; if (!files.length) return;
  const c = sc.cur, tip = document.getElementById('sc_upw_tip');
  try {
    for (let i = 0; i < files.length; i++) {
      if (tip) tip.textContent = `上传中 ${i + 1}/${files.length}…`;
      const f = files[i];
      let ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, ''); if (!ext || ext.length > 5) ext = 'jpg';
      const url = await sbUpload('admission-photos', `cases/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`, f);
      c.works.push({ src: 'upload', url, caption: '', feedback: '' });
    }
    if (sc.cur === c) scRender();
  } catch (e) { if (tip) tip.textContent = '上传失败：' + e.message; }
}

async function scUploadOther(input) {
  const files = [...(input.files || [])]; input.value = ''; if (!files.length) return;
  const c = sc.cur, tip = document.getElementById('sc_upo_tip');
  try {
    for (let i = 0; i < files.length; i++) {
      if (tip) tip.textContent = `上传中 ${i + 1}/${files.length}…`;
      const f = files[i];
      let ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, ''); if (!ext || ext.length > 5) ext = 'bin';
      const url = await sbUpload('admission-photos', `cases/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`, f);
      c.others.push({ url, name: f.name, kind: /^image\//.test(f.type) ? 'image' : 'file', category: '课堂笔记', note: '' });
    }
    if (sc.cur === c) scRender();
  } catch (e) { if (tip) tip.textContent = '上传失败：' + e.message; }
}

// ── 保存 / 删除 ──
async function scSave() {
  const c = sc.cur;
  if (!(c.alias || '').trim()) { alert('请填写对外称呼'); return; }
  if (!c.domain) { alert('请选择领域'); return; }
  // 对外内容里不能出现学生真实姓名（含姓）
  const stu = (sc.stu || []).find(x => String(x.id) === String(c.student_id));
  const pending = (c.schoolInput || '').trim();
  if (pending && !c.schools.some(x => x.label === pending)) c.schools.push({ label: pending, on: true });
  scSortTimeline(c);
  c.result = c.schools.filter(x => x.on).map(x => x.label).join(' · ');
  if (stu && stu.name) {
    const nm = String(stu.name).trim(), keys = nm.length >= 3 ? [nm, nm.slice(0, 2)] : [nm];
    const fields = { '对外称呼': c.alias, '一句话标签': c.tagline, '背景': c.background, '合格结果': c.result, '学生感言': c.quote, '时间线': c.timeline.map(t => t.period + t.content).join(' ') };
    const hit = Object.entries(fields).find(([, v]) => keys.some(k => k && String(v || '').includes(k)));
    if (hit) { alert(`「${hit[0]}」里含有学生真实姓名，请改掉后再保存（对外只显示称呼）。`); return; }
  }
  const rec = { domain: c.domain, majors: c.majors, student_id: c.student_id || null, alias: c.alias.trim(), tagline: c.tagline.trim(), background: c.background.trim(),
    timeline: c.timeline.filter(t => (t.period || '').trim() || (t.content || '').trim()).map(t => ({ period: t.period.trim(), content: t.content.trim() })),
    result: c.result.trim(), quote: c.quote.trim(), works: c.works, plan_files: c.plan_files, others: c.others, tags: c.tags, published: !!c.published, updated_at: new Date().toISOString() };
  try {
    if (c.id) {
      await sb(`/rest/v1/success_cases?id=eq.${encodeURIComponent(c.id)}`, 'PATCH', rec);
      const r = sc.rows.find(x => x.id === c.id); if (r) Object.assign(r, rec);
      sc.openId = c.id;
    } else {
      const row = Object.assign({ id: `sc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, created_by: sc.ctx.me || '' }, rec);
      await sb('/rest/v1/success_cases', 'POST', row);
      sc.rows.unshift(row); sc.openId = row.id;
    }
    sc.rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    sc.cur = null; sc.view = 'detail'; scRender();
  } catch (e) { alert('保存失败：' + e.message); }
}
async function scDelete(id) {
  const r = (sc.rows || []).find(x => x.id === id); if (!r) return;
  if (!confirm(`删除案例「${r.alias}」？`)) return;
  try { await sb(`/rest/v1/success_cases?id=eq.${encodeURIComponent(id)}`, 'DELETE'); sc.rows = sc.rows.filter(x => x.id !== id); sc.sel.delete(id); sc.cur = null; sc.view = 'list'; scRender(); }
  catch (e) { alert('删除失败：' + e.message); }
}

// ══════════ 各端入口 ══════════
// admin：全部领域（领域视角下只本领域）、可写
const scopeArrOf = v => Array.isArray(v) ? v : [];
function scMountAdmin(boxId) {
  const lock = viewLockDomain();
  if (lock) sc.f.domain = lock;
  // 范围：领域完整选中 / 案例的专业在范围内（案例没有专业时只看领域）
  const inScope = r => scopeAll() || scopeHasDomain(r.domain) || scopeArrOf(r.majors).some(scopeMajor);
  scMount(boxId, {
    mode: 'admin', canWrite: true, canPack: false, me: 'admin', lockDomain: lock, inScope,
    allowDomain: d => scopeAll() || scopeDomainList().includes(d), allowMajor: m => scopeMajor(m), canEditRow: inScope,
    loadStudents: async () => scOnlyPassed((await sbAll('/rest/v1/students?select=id,name,major,extra_majors,status&order=name.asc')).filter(s => typeof studentInCurrentView !== 'function' || studentInCurrentView(s))),
  });
}
// 老师端：所有营业老师可浏览已发布的案例；有 success_cases 权限的才能写，且只能写自己负责的领域 / 专业
function scMountTeacher(boxId) {
  const t = (typeof teacherData !== 'undefined' && teacherData) || {}, p = t.permissions || {};
  const set = typeof tsaAllowedSet === 'function' ? tsaAllowedSet() : null;            // 专业范围（null = 不限）
  const doms = new Set([...(t.managed_by || []), ...(t.domains || [])]);
  if (set) set.forEach(m => { if (MAJOR_DOMAIN[m]) doms.add(MAJOR_DOMAIN[m]); });
  const allowDomain = d => (!set && !doms.size) || doms.has(d);
  const allowMajor = m => !set || set.has(m) || (m === 'shakai_group' && [...set].some(x => (MAJOR_GROUPS.shakai_group || []).includes(x)));
  scMount(boxId, {
    mode: 'teacher', canWrite: !!p.success_cases, canPack: true, me: (t.name || (typeof teacherName !== 'undefined' ? teacherName : '') || '').trim(), lockDomain: '',
    allowDomain, allowMajor,
    canEditRow: r => allowDomain(r.domain) && (!set || !scArr(r.majors).length || scArr(r.majors).some(allowMajor)),
    loadStudents: async () => {
      const all = await sbAll('/rest/v1/students?select=id,name,major,extra_majors,course_type,status&order=name.asc');
      return scOnlyPassed(all.filter(s => !set || set.has(s.major)).filter(s => !(typeof tsaGuaranteedLock === 'function' && tsaGuaranteedLock()) || tsaIsGuaranteed(s)));
    },
  });
}
