// ══════════════════════════════════
// materials.js — 出愿材料准备（志望理由书任务第二批）
// 清单：material_items（admin 考学进度 →「📁 出愿材料准备」→「📋 材料清单」维护；track = gakubu 学部 | grad 大学院）
// 准备情况：student_materials（学生自己更新 / 老师帮改；status todo 未准备 | applying 已申请开具 | ready 已准备）
// kind='riyu' 的条目 = 在线撰写的志望理由书（shared/riyu.js：大学院 grad_riyu / 学部 gakubu_riyu）
// 依赖：shared/supabase.js、shared/constants.js、shared/riyu.js
// ══════════════════════════════════

const MAT_STATUS = [['todo', '未准备'], ['applying', '已申请开具'], ['ready', '已准备']];
function matEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function matTrackOf(stu) { return (typeof isGakubuStudent === 'function' && isGakubuStudent(stu)) ? 'gakubu' : 'grad'; }
function matRiyuKind(track) { return track === 'gakubu' ? 'gakubu_riyu' : 'grad_riyu'; }
function matFiles(it) { let v = it && it.example_files; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = []; } } return Array.isArray(v) ? v : []; }
function matStatusInfo(st) {
  if (st === 'ready') return { t: '已准备', c: '#2a7a4a', bg: '#e4f0e8' };
  if (st === 'applying') return { t: '已申请开具', c: '#a0621a', bg: '#fdf1e6' };
  return { t: '未准备', c: '#8a8580', bg: '#f0ede8' };
}
// 一行准备情况的简短文字：未准备 / 已申请·预计 10/15 / 已准备·2份
function matStatusText(row) {
  const st = (row && row.status) || 'todo';
  if (st === 'applying') return '已申请' + (row.expected_date ? '·预计 ' + row.expected_date : '');
  if (st === 'ready') return '已准备' + (row.copies ? '·' + row.copies + '份' : '');
  return '未准备';
}

// 说明文字排版（与宣传内容同一套写法：## 小标题、**粗体**、- 列表、1. 有序列表、| 表格 |、Tab 表格）
function matMd(body) {
  const lines = String(body || '').replace(/\r/g, '').split('\n');
  const inl = s => matEsc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const table = rows => `<div style="overflow-x:auto;margin:4px 0 8px"><table style="border-collapse:collapse;width:100%;font-size:11px">
    <thead><tr>${rows[0].map(c => `<th style="background:var(--bg,#f7f5f0);text-align:left;padding:4px 8px;border:1px solid var(--border,#e2ded6)">${inl(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.slice(1).map(r => `<tr>${r.map(c => `<td style="padding:4px 8px;border:1px solid var(--border-light,#ede9e2)">${inl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  let out = '', i = 0, buf = [];
  const flush = () => { if (buf.length) { out += `<p style="margin:0 0 6px">${buf.map(inl).join('<br>')}</p>`; buf = []; } };
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { flush(); i++; continue; }
    if (/^#{1,3}/.test(t)) { flush(); out += `<div style="font-weight:600;margin:8px 0 4px">${inl(t.replace(/^#{1,3}\s*/, ''))}</div>`; i++; continue; }
    if (/^\|.*\|$/.test(t)) {
      flush(); const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { const r = lines[i].trim(); if (!/^\|[\s:\-|]+\|$/.test(r)) rows.push(r.slice(1, -1).split('|').map(c => c.trim())); i++; }
      out += table(rows); continue;
    }
    if (/\t/.test(lines[i]) && i + 1 < lines.length && /\t/.test(lines[i + 1])) {
      flush(); const rows = [];
      while (i < lines.length && lines[i].trim() && /\t/.test(lines[i])) { rows.push(lines[i].replace(/\s+$/, '').split('\t').map(c => c.trim())); i++; }
      out += table(rows); continue;
    }
    if (/^[-・]\s?/.test(t) || /^\d+[.、]\s?/.test(t)) {
      flush(); const ol = /^\d/.test(t), re = ol ? /^\d+[.、]\s?/ : /^[-・]\s?/, items = [];
      while (i < lines.length && re.test(lines[i].trim())) { items.push(lines[i].trim().replace(re, '')); i++; }
      out += `<${ol ? 'ol' : 'ul'} style="margin:2px 0 6px 1.3em">${items.map(x => `<li>${inl(x)}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`; continue;
    }
    buf.push(t); i++;
  }
  flush();
  return out;
}

async function matLoadItems(track, includeHidden) {
  const q = `/rest/v1/material_items?${track ? `track=eq.${track}&` : ''}${includeHidden ? '' : 'or=(published.is.null,published.is.true)&'}select=*&order=sort_order.asc,created_at.asc`;
  return await sb(q);
}
// 学生准备情况 upsert（主键 student_id + item_id）
async function matUpsert(row) {
  const tok = (typeof __getSbToken === 'function') ? __getSbToken() : null;
  const r = await fetch(`${SB_URL}/rest/v1/student_materials?on_conflict=student_id,item_id`, { method: 'POST', headers: {
    'apikey': SB_KEY, 'Authorization': 'Bearer ' + (tok || SB_KEY), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([Object.assign({}, row, { updated_at: new Date().toISOString() })]) });
  if (!r.ok) throw new Error(await r.text());
  return ((await r.json()) || [])[0] || row;
}
// 进度：已准备 N / M（志望理由书条目：所有志望校都已批复才算已准备）
function matProgress(items, rows, riyuC) {
  let ready = 0;
  (items || []).forEach(it => {
    if (it.kind === 'riyu') { if (riyuC && riyuC.total && riyuC.reviewed >= riyuC.total) ready++; return; }
    const r = (rows || []).find(x => x.item_id === it.id);
    if (r && r.status === 'ready') ready++;
  });
  return { ready, total: (items || []).length };
}

// ══════════════════════════════════
// 紧凑方框（老师端 / 管理端 / 学生端共用）：默认只显示小方框，点一个在网格下方展开编辑区
// ══════════════════════════════════
function matBoxText(it, r, riyuC) {
  if (it.kind === 'riyu') {
    if (!riyuC || !riyuC.total) return { t: '请先选志望校', c: '#8a8580' };
    const done = riyuC.reviewed >= riyuC.total;
    return { t: `已提交 ${riyuC.submitted}/${riyuC.total} 校 · 已批复 ${riyuC.reviewed} 校`, c: done ? '#2a7a4a' : riyuC.submitted ? '#a0621a' : '#8a8580' };
  }
  const st = (r && r.status) || 'todo', info = matStatusInfo(st);
  if (st === 'applying') return { t: '已申请' + (r.expected_date ? ' · 预计' + r.expected_date : ''), c: info.c };
  if (st === 'ready') return { t: '已准备' + (r.copies ? ' · ' + r.copies + '份' : ''), c: info.c };
  return { t: '未准备', c: info.c };
}
// items：清单；rows：准备情况；openId：当前展开的条目；clickJs(itemId) → onclick 字符串
// fixed4=true（管理端/老师端考学进度）：网格等宽，每行 4 张、窄屏 2 张，按准备情况着底色；学生端保持自适应
function matBoxesHtml(items, rows, riyuC, openId, clickJs, fixed4) {
  const tint = c => c === '#2a7a4a' ? '#e4f0e8' : c === '#a0621a' ? '#fdf1e6' : '#f0ede8';
  const grid = fixed4 ? 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px' : 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px';
  return `${fixed4 ? '<style>@media (max-width:640px){.mat-grid4{grid-template-columns:repeat(2,minmax(0,1fr))!important}}</style>' : ''}<div class="${fixed4 ? 'mat-grid4' : ''}" style="${grid}">${(items || []).map(it => {
    const r = (rows || []).find(x => x.item_id === it.id) || {};
    const bt = matBoxText(it, r, riyuC), on = openId === it.id;
    const bg = on ? 'var(--accent-light,#f5efe0)' : fixed4 ? tint(bt.c) : 'var(--surface,#fff)';
    return `<div onclick="${clickJs(it.id)}" style="cursor:pointer;border:1px solid ${on ? 'var(--accent,#b8953a)' : 'var(--border,#e2ded6)'};background:${bg};border-radius:4px;padding:7px 9px;min-width:0">
      <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${matEsc(it.name)}</div>
      <div style="font-size:10px;color:${bt.c};margin-top:2px;${fixed4 ? 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' : ''}" title="${matEsc(bt.t)}">${matEsc(bt.t)}</div>
    </div>`;
  }).join('')}</div>`;
}
// 状态下拉 + 日期 + 份数 + 备注（id 前缀 pre；切换状态时调用 fieldsJs 显示对应日期框）
function matEditFieldsHtml(pre, r, fieldsJs, inp) {
  const st = (r && r.status) || 'todo';
  return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select id="${pre}_st" onchange="${fieldsJs}" style="${inp}">${MAT_STATUS.map(([k, l]) => `<option value="${k}" ${st === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span id="${pre}_ap" style="display:${st === 'applying' ? 'inline-flex' : 'none'};gap:4px;align-items:center;font-size:11px">预计开出日期 <input id="${pre}_exp" value="${matEsc(r.expected_date)}" placeholder="如 10/15" style="${inp};width:90px"></span>
      <span id="${pre}_rd" style="display:${st === 'ready' ? 'inline-flex' : 'none'};gap:4px;align-items:center;font-size:11px">开出日期 <input id="${pre}_iss" value="${matEsc(r.issued_date)}" placeholder="如 10/12" style="${inp};width:90px"> 目前有 <input id="${pre}_cp" type="number" min="0" value="${r.copies == null ? '' : matEsc(r.copies)}" style="${inp};width:56px"> 份</span>
    </div>
    <input id="${pre}_note" value="${matEsc(r.note)}" placeholder="备注（可选）" style="${inp};width:100%;box-sizing:border-box;margin-top:6px">`;
}
function matFieldsToggle(pre) {
  const st = (document.getElementById(pre + '_st') || {}).value;
  const ap = document.getElementById(pre + '_ap'), rd = document.getElementById(pre + '_rd');
  if (ap) ap.style.display = st === 'applying' ? 'inline-flex' : 'none';
  if (rd) rd.style.display = st === 'ready' ? 'inline-flex' : 'none';
}
function matFieldsRow(pre, sid, itemId) {
  const v = k => ((document.getElementById(pre + k) || {}).value || '').trim();
  const cp = v('_cp');
  return { student_id: sid, item_id: itemId, status: v('_st') || 'todo', expected_date: v('_exp') || null, issued_date: v('_iss') || null, copies: cp === '' ? null : parseInt(cp), note: v('_note') || null };
}

// ══════════════════════════════════
// 老师端 / 管理端：学生卡片里的「出愿材料」节点（老师也可以帮学生改状态）
// ══════════════════════════════════
const MATS = {};   // student_id → { student, items, rows, plans, subs, open }
function matStaffNodeHtml(student, items, rows, plans, subs) {
  const prev = MATS[student.id];
  MATS[student.id] = { student, items: items || [], rows: rows || [], plans: plans || [], subs: subs || [], open: prev ? prev.open : null };
  return `<div id="matn_${matEsc(student.id)}" onclick="event.stopPropagation()">${matStaffInner(student.id)}</div>`;
}
function matStaffInner(sid) {
  const c = MATS[sid]; if (!c) return '';
  const track = matTrackOf(c.student), kind = matRiyuKind(track);
  const riyuC = riyuCounts(c.plans, c.subs, kind);
  const pg = matProgress(c.items, c.rows, riyuC);
  if (!c.items.length) return `<div style="font-size:11px;color:var(--text-3,#999)">${track === 'gakubu' ? '学部' : '大学院'}的出愿材料清单还没有录入（admin 考学进度 →「📁 出愿材料准备」→「📋 材料清单」）</div>`;
  const sidJs = matEsc(sid).replace(/'/g, "\\'");
  const it = c.items.find(x => x.id === c.open);
  let edit = '';
  if (it && it.kind === 'riyu') {
    edit = `<div style="font-size:12px;font-weight:600;margin-bottom:6px">${matEsc(it.name)}</div>
      ${riyuStaffListHtml(c.student, c.plans, c.subs, kind, sub => { const i = c.subs.findIndex(x => x.id === sub.id); if (i >= 0) c.subs[i] = sub; else c.subs.push(sub); matStaffRerender(sid); })}`;
  } else if (it) {
    const pre = `mats_${matEsc(sid)}_${matEsc(it.id)}`;
    const r = c.rows.find(x => x.item_id === it.id) || {};
    const inp = 'font-size:11px;padding:4px 6px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--surface,#fff);font-family:inherit';
    edit = `<div style="font-size:12px;font-weight:600;margin-bottom:6px">${matEsc(it.name)}</div>
      ${matEditFieldsHtml(pre, r, `matFieldsToggle('${pre}')`, inp)}
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:8px">
        <button onclick="matStaffOpen('${sidJs}','')" style="font-size:11px;border:1px solid var(--border,#e2ded6);background:none;border-radius:3px;padding:3px 12px;cursor:pointer;font-family:inherit">收起</button>
        <button onclick="matStaffSave('${sidJs}','${matEsc(it.id)}')" style="font-size:11px;border:none;color:#fff;background:var(--accent,#b8953a);border-radius:3px;padding:3px 14px;cursor:pointer;font-family:inherit">保存</button>
      </div>`;
  }
  return `<div style="font-size:11px;color:var(--text-2,#5a5650);margin-bottom:6px">已准备 <b>${pg.ready} / ${pg.total}</b> 项</div>
    ${matBoxesHtml(c.items, c.rows, riyuC, c.open, id => `matStaffOpen('${sidJs}','${matEsc(id)}')`, true)}
    ${edit ? `<div style="border:1px solid var(--accent,#b8953a);border-radius:4px;padding:10px 12px;margin-top:8px;background:var(--surface,#fff)">${edit}</div>` : ''}`;
}
function matStaffOpen(sid, itemId) {
  const c = MATS[sid]; if (!c) return;
  c.open = (!itemId || c.open === itemId) ? null : itemId;
  matStaffRerender(sid);
}
function matStaffRerender(sid) { const el = document.getElementById('matn_' + sid); if (el) el.innerHTML = matStaffInner(sid); }
async function matStaffSave(sid, itemId) {
  const c = MATS[sid]; if (!c) return;
  const row = matFieldsRow(`mats_${sid}_${itemId}`, sid, itemId);
  try {
    const saved = await matUpsert(row);
    const i = c.rows.findIndex(x => x.item_id === itemId);
    if (i >= 0) c.rows[i] = saved; else c.rows.push(saved);
    c.open = null;
    matStaffRerender(sid);
  } catch (e) { alert('保存失败：' + e.message); }
}
