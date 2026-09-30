// ══════════════════════════════════
// promo-md.js — 宣传内容的迷你排版渲染（老师端「宣传相关」「宣传资料整合」、admin「通用宣传」预览共用）
// 语法：## 小标题 / **粗体** / - 列表 / 1. 列表 / | 表格 |
// ══════════════════════════════════
function prEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// 与对外宣传页同款的迷你排版渲染：#小标题 / **粗体** / -列表 / 1.列表 / |表格|
function prInline(s) { return prEsc(s).replace(/\*\*(.+?)\*\*/g, '<b style="color:var(--text-1,#1a1814);font-weight:600">$1</b>'); }
function prMd(body) {
  const lines = String(body || '').replace(/\r/g, '').split('\n');
  let out = '', i = 0, buf = [];
  const flush = () => { if (buf.length) { out += `<p style="margin:0 0 8px">${buf.map(prInline).join('<br>')}</p>`; buf = []; } };
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { flush(); i++; continue; }
    if (/^#{1,3}/.test(t)) { flush(); out += `<div style="font-family:'Noto Serif SC',serif;font-size:13px;font-weight:600;color:var(--text-1,#1a1814);margin:14px 0 6px;padding-bottom:3px;border-bottom:1px dashed var(--border)">${prInline(t.replace(/^#{1,3}\s*/, ''))}</div>`; i++; continue; }
    if (/^\|.*\|$/.test(t)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { rows.push(lines[i].trim()); i++; }
      const cells = r => r.slice(1, -1).split('|').map(c => prInline(c.trim()));
      const body2 = rows.slice(1).filter(r => !/^\|[\s:\-|]+\|$/.test(r));
      out += `<div style="overflow-x:auto;margin:6px 0 12px"><table style="border-collapse:collapse;width:100%;min-width:380px;background:var(--surface)">
        <thead><tr>${cells(rows[0]).map(c => `<th style="background:var(--bg);color:var(--accent);font-size:10px;font-weight:600;text-align:left;padding:6px 10px;border:1px solid var(--border);white-space:nowrap">${c}</th>`).join('')}</tr></thead>
        <tbody>${body2.map(r => `<tr>${cells(r).map(c => `<td style="font-size:11px;color:var(--text-2);padding:6px 10px;border:1px solid var(--border-light)">${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
      continue;
    }
    // 兜底：连续两行以上、每行都含 Tab 的文字（如从 Excel 粘贴）也显示成表格，按 Tab 分列，首行作表头
    if (/\t/.test(lines[i]) && i + 1 < lines.length && /\t/.test(lines[i + 1]) && lines[i + 1].trim()) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim() && /\t/.test(lines[i])) { rows.push(lines[i].replace(/\s+$/, '').split('\t').map(c => prInline(c.trim()))); i++; }
      const n = Math.max(...rows.map(r => r.length));
      const pad = r => r.concat(Array(n - r.length).fill(''));
      out += `<div style="overflow-x:auto;margin:6px 0 12px"><table style="border-collapse:collapse;width:100%;min-width:380px;background:var(--surface)">
        <thead><tr>${pad(rows[0]).map(c => `<th style="background:var(--bg);color:var(--accent);font-size:10px;font-weight:600;text-align:left;padding:6px 10px;border:1px solid var(--border);white-space:nowrap">${c}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(1).map(r => `<tr>${pad(r).map(c => `<td style="font-size:11px;color:var(--text-2);padding:6px 10px;border:1px solid var(--border-light)">${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
      continue;
    }
    if (/^[-・]\s?/.test(t)) {
      flush();
      const items = [];
      while (i < lines.length && /^[-・]\s?/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-・]\s?/, '')); i++; }
      out += `<ul style="margin:4px 0 10px 1.4em">${items.map(x => `<li style="margin-bottom:4px">${prInline(x)}</li>`).join('')}</ul>`;
      continue;
    }
    if (/^\d+[.、]\s?/.test(t)) {
      flush();
      const items = [];
      while (i < lines.length && /^\d+[.、]\s?/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+[.、]\s?/, '')); i++; }
      out += `<ol style="margin:4px 0 10px 1.4em">${items.map(x => `<li style="margin-bottom:4px">${prInline(x)}</li>`).join('')}</ol>`;
      continue;
    }
    buf.push(t); i++;
  }
  flush();
  return out;
}
