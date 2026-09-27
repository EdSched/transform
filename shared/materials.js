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
// 老师端 / 管理端：学生卡片里的「出愿材料」节点（老师也可以帮学生改状态）
// ══════════════════════════════════
const MATS = {};   // student_id → { student, items, rows, plans, subs }
function matStaffNodeHtml(student, items, rows, plans, subs) {
  MATS[student.id] = { student, items: items || [], rows: rows || [], plans: plans || [], subs: subs || [] };
  return `<div id="matn_${matEsc(student.id)}" onclick="event.stopPropagation()">${matStaffInner(student.id)}</div>`;
}
function matStaffInner(sid) {
  const c = MATS[sid]; if (!c) return '';
  const track = matTrackOf(c.student), kind = matRiyuKind(track);
  const riyuC = riyuCounts(c.plans, c.subs, kind);
  const pg = matProgress(c.items, c.rows, riyuC);
  if (!c.items.length) return `<div style="font-size:11px;color:var(--text-3,#999)">${track === 'gakubu' ? '学部' : '大学院'}的出愿材料清单还没有录入（admin 考学进度 →「📁 出愿材料准备」→「📋 材料清单」）</div>`;
  const inp = 'font-size:11px;padding:3px 6px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--surface,#fff);font-family:inherit';
  return `<div style="font-size:11px;color:var(--text-2,#5a5650);margin-bottom:6px">已准备 <b>${pg.ready} / ${pg.total}</b> 项</div>
    ${c.items.map(it => {
      const pre = `mats_${matEsc(sid)}_${matEsc(it.id)}`;
      if (it.kind === 'riyu') {
        return `<div style="border:1px solid var(--border-light,#ede9e2);border-radius:5px;padding:7px 9px;margin-bottom:5px;background:var(--surface,#fff)">
          <div style="font-size:12px;font-weight:600;margin-bottom:4px">${matEsc(it.name)} <span style="font-weight:400;font-size:10px;color:var(--text-3,#999)">· ${matEsc(riyuCountText(riyuC))}</span></div>
          ${riyuStaffListHtml(c.student, c.plans, c.subs, kind, sub => { const i = c.subs.findIndex(x => x.id === sub.id); if (i >= 0) c.subs[i] = sub; else c.subs.push(sub); matStaffRerender(sid); })}
        </div>`;
      }
      const r = c.rows.find(x => x.item_id === it.id) || {};
      const st = r.status || 'todo', info = matStatusInfo(st);
      return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;border:1px solid var(--border-light,#ede9e2);border-radius:5px;padding:6px 9px;margin-bottom:5px;background:var(--surface,#fff)">
        <span style="font-size:12px;font-weight:600;min-width:110px">${matEsc(it.name)}</span>
        <span style="font-size:10px;padding:1px 8px;border-radius:10px;background:${info.bg};color:${info.c}">${matEsc(matStatusText(r))}</span>
        <select id="${pre}_st" onchange="matStaffFields('${matEsc(sid)}','${matEsc(it.id)}')" style="${inp}">${MAT_STATUS.map(([k, l]) => `<option value="${k}" ${st === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span id="${pre}_ap" style="display:${st === 'applying' ? 'inline' : 'none'};font-size:10px">预计开出 <input id="${pre}_exp" value="${matEsc(r.expected_date)}" placeholder="如 10/15" style="${inp};width:80px"></span>
        <span id="${pre}_rd" style="display:${st === 'ready' ? 'inline' : 'none'};font-size:10px">开出 <input id="${pre}_iss" value="${matEsc(r.issued_date)}" placeholder="如 10/12" style="${inp};width:80px"> 份数 <input id="${pre}_cp" type="number" min="0" value="${r.copies == null ? '' : matEsc(r.copies)}" style="${inp};width:50px"></span>
        <input id="${pre}_note" value="${matEsc(r.note)}" placeholder="备注" style="${inp};flex:1;min-width:80px">
        <button onclick="matStaffSave('${matEsc(sid)}','${matEsc(it.id)}')" style="font-size:10px;border:1px solid var(--accent,#b8953a);color:var(--accent,#b8953a);background:none;border-radius:3px;padding:2px 9px;cursor:pointer;font-family:inherit">保存</button>
        <span id="${pre}_msg" style="font-size:10px;color:var(--ok,#2a9e6a)"></span>
      </div>`;
    }).join('')}`;
}
function matStaffRerender(sid) { const el = document.getElementById('matn_' + sid); if (el) el.innerHTML = matStaffInner(sid); }
function matStaffFields(sid, itemId) {
  const pre = `mats_${sid}_${itemId}`, st = (document.getElementById(pre + '_st') || {}).value;
  const ap = document.getElementById(pre + '_ap'), rd = document.getElementById(pre + '_rd');
  if (ap) ap.style.display = st === 'applying' ? 'inline' : 'none';
  if (rd) rd.style.display = st === 'ready' ? 'inline' : 'none';
}
async function matStaffSave(sid, itemId) {
  const c = MATS[sid]; if (!c) return;
  const pre = `mats_${sid}_${itemId}`, v = k => ((document.getElementById(pre + k) || {}).value || '').trim();
  const cp = v('_cp');
  const row = { student_id: sid, item_id: itemId, status: v('_st') || 'todo', expected_date: v('_exp') || null, issued_date: v('_iss') || null, copies: cp === '' ? null : parseInt(cp), note: v('_note') || null };
  try {
    const saved = await matUpsert(row);
    const i = c.rows.findIndex(x => x.item_id === itemId);
    if (i >= 0) c.rows[i] = saved; else c.rows.push(saved);
    matStaffRerender(sid);
    const m = document.getElementById(pre + '_msg'); if (m) m.textContent = '✓ 已更新';
  } catch (e) { alert('保存失败：' + e.message); }
}
