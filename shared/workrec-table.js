// 工作记录表格的公共部分：管理端「工作管理」和老师端「工作记录」共用（统计、汇总、Excel）。
// 只放纯函数，不碰页面状态；名字沿用 payroll*，管理端的调用不用改。

const PAYROLL_HEADERS = ['姓名', '开始时间', '结束时间', '时长', '工作内容', '工作地点', '备注'];
const payrollRound = n => Math.round((parseFloat(n) || 0) * 100) / 100;
const payrollPad = n => String(n).padStart(2, '0');

// ── 按工作内容统计 ──
// 工作内容的固定顺序（"教研"是旧名字，统一当"教研工作"）；不在清单里的排在最后
const PAYROLL_TYPES = ['大课', '共通课', 'VIP授课', '教研工作', '试听・试讲', '临时上课安排'];
const payrollTypeName = t => (t === '教研' ? '教研工作' : (t || ''));
const payrollTypeIdx = t => { const i = PAYROLL_TYPES.indexOf(payrollTypeName(t)); return i < 0 ? 99 : i; };
const payrollTypeSort = (a, b) => payrollTypeIdx(a) - payrollTypeIdx(b) || String(a).localeCompare(String(b), 'zh');
// items = [{ name, type, h }] → { types, names, cell:{name:{type:{h,n}}}, rowTot:{name:{h,n}}, colTot:{type:{h,n}}, total:{h,n} }
function payrollMatrix(items, nameOrder) {
  const m = { types: [], names: [], cell: {}, rowTot: {}, colTot: {}, total: { h: 0, n: 0 } };
  const add = (o, h) => { o.h += h; o.n += 1; };
  items.forEach(it => {
    const t = payrollTypeName(it.type), h = parseFloat(it.h) || 0;
    if (!m.cell[it.name]) { m.cell[it.name] = {}; m.rowTot[it.name] = { h: 0, n: 0 }; m.names.push(it.name); }
    if (!m.colTot[t]) { m.colTot[t] = { h: 0, n: 0 }; m.types.push(t); }
    add(m.cell[it.name][t] = m.cell[it.name][t] || { h: 0, n: 0 }, h);
    add(m.rowTot[it.name], h); add(m.colTot[t], h); add(m.total, h);
  });
  m.types.sort(payrollTypeSort);
  m.names.sort((a, b) => { const ia = nameOrder ? nameOrder.indexOf(a) : -1, ib = nameOrder ? nameOrder.indexOf(b) : -1; return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || String(a).localeCompare(String(b), 'zh'); });
  return m;
}
// Excel「按工作内容汇总」：行是老师、列是工作内容；上面一张小时数，下面一张条数
function payrollMatrixAoa(m, firstHead) {
  const head = [firstHead || '姓名', ...m.types, '合计'];
  const hrs = [['小时数'], head];
  const cnt = [[], ['条数'], head];
  m.names.forEach(n => {
    hrs.push([n, ...m.types.map(t => (m.cell[n][t] ? payrollRound(m.cell[n][t].h) : '')), payrollRound(m.rowTot[n].h)]);
    cnt.push([n, ...m.types.map(t => (m.cell[n][t] ? m.cell[n][t].n : '')), m.rowTot[n].n]);
  });
  hrs.push(['合计', ...m.types.map(t => payrollRound(m.colTot[t].h)), payrollRound(m.total.h)]);
  cnt.push(['合计', ...m.types.map(t => m.colTot[t].n), m.total.n]);
  return [...hrs, ...cnt];
}
function payrollAddSummarySheet(wb, rows) {
  const m = payrollMatrix(rows.map(r => ({ name: r.姓名, type: r.工作内容, h: r.时长 })));
  const aoa = payrollMatrixAoa(m);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 14 }, ...m.types.map(() => ({ wch: 12 })), { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, '按工作内容汇总');
}

// ── Excel：多位老师 = 一人一个工作表 + 汇总；rows 用 {姓名, 开始时间, …} 格式 ──
function payrollBuildWorkbook(rows) {
  const names = [...new Set(rows.map(r => r.姓名))];
  const wb = XLSX.utils.book_new();
  const cols = [{wch:10},{wch:20},{wch:20},{wch:8},{wch:10},{wch:14},{wch:40}];
  const addSheet = (name, list) => {
    const ws = XLSX.utils.aoa_to_sheet([PAYROLL_HEADERS, ...list.map(r => PAYROLL_HEADERS.map(h => r[h] ?? ''))]);
    ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  if (names.length <= 1) { addSheet('工资核算', rows); payrollAddSummarySheet(wb, rows); return wb; }
  const summary = [['姓名', '节数', '总时长(h)']];
  names.forEach(n => {
    const list = rows.filter(r => r.姓名 === n);
    summary.push([n, list.length, payrollRound(list.reduce((s, r) => s + (parseFloat(r.时长) || 0), 0))]);
  });
  const sws = XLSX.utils.aoa_to_sheet(summary);
  sws['!cols'] = [{wch:14},{wch:8},{wch:12}];
  XLSX.utils.book_append_sheet(wb, sws, '汇总');
  payrollAddSummarySheet(wb, rows);
  const used = new Set(['汇总', '按工作内容汇总']);
  names.forEach(n => {
    let sn = String(n).replace(/[\[\]:*?\/\\]/g, '_').slice(0, 28) || '老师', k = 2, cand = sn;
    while (used.has(cand)) cand = sn + k++;
    used.add(cand);
    addSheet(cand, rows.filter(r => r.姓名 === n));
  });
  return wb;
}
function payrollDownload(rows, label, who) {
  if (!rows.length) { alert('没有可下载的行'); return; }
  XLSX.writeFile(payrollBuildWorkbook(rows), `工资核算_${label}_${who}.xlsx`);
}
// work_records 一行 → Excel 行
const payrollRecToRow = r => ({ 姓名: r.teacher_name, 开始时间: r.start_time, 结束时间: r.end_time, 时长: r.duration, 工作内容: r.work_type, 工作地点: r.location, 备注: r.notes });

function payrollDT(s) {
  const m = String(s || '').match(/(\d{4})年(\d{2})月(\d{2})日\s*(\d{1,2}:\d{2})/);
  return m ? { d: m[2] + '-' + m[3], t: m[4] } : { d: '', t: String(s || '') };
}

// ══════════════════════════════════
// 老师端「工作记录」用的表格：一行一条，统计条 / 排序 / 工作内容筛选 / 下载都在这里
// 输入都是 work_records 的原始行（start_time 形如「2026年06月20日 13:00」）
// ══════════════════════════════════
const wrtEsc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// 「2026年06月20日 13:00」→ { ym:'2026-06', date:'2026-06-20', md:'06/20', wd:'六', hm:'13:00' }
function wrtParse(s) {
  const m = String(s || '').match(/(\d{4})年(\d{2})月(\d{2})日\s*(\d{1,2}:\d{2})?/);
  if (!m) return { ym: '', date: '', md: '', wd: '', hm: String(s || '') };
  const wd = '日一二三四五六'[new Date(+m[1], +m[2] - 1, +m[3]).getDay()];
  return { ym: m[1] + '-' + m[2], date: m[1] + '-' + m[2] + '-' + m[3], md: m[2] + '/' + m[3], wd, hm: m[4] || '' };
}
const wrtMonthLabel = ym => (ym ? ym.slice(0, 4) + '年' + ym.slice(5) + '月' : '全部');
// 有记录的月份，新的在前
const wrtMonths = recs => [...new Set(recs.map(r => wrtParse(r.start_time).ym).filter(Boolean))].sort().reverse();
// 工作内容固定顺序 + 记录里出现的其他名字
const wrtTypesPresent = recs => PAYROLL_TYPES.concat([...new Set(recs.map(r => payrollTypeName(r.work_type)).filter(t => t && !PAYROLL_TYPES.includes(t)))]);
// 统计条：按工作内容分开显示「条数 · 小时数」，最后是合计（只统计传进来的行，调用方负责只传已通过的）
function wrtStatsHtml(recs) {
  const m = payrollMatrix(recs.map(r => ({ name: '-', type: r.work_type, h: r.duration })));
  const types = wrtTypesPresent(recs);
  const th = t => `<th style="padding:4px 10px;text-align:right;font-weight:600;color:var(--text-2);white-space:nowrap">${wrtEsc(t)}</th>`;
  const td = (o, bold) => o && o.n ? `<td style="padding:4px 10px;text-align:right;white-space:nowrap${bold ? ';font-weight:600' : ''}">${o.n}条 · ${payrollRound(o.h)}h</td>` : '<td style="padding:4px 10px;text-align:right;color:var(--text-3)">–</td>';
  return `<div style="overflow-x:auto;margin-bottom:10px"><table style="border-collapse:collapse;font-size:11px;background:var(--surface);border:1px solid var(--border)">
    <thead><tr style="background:var(--bg)">${types.map(th).join('')}${th('合计小时')}</tr></thead>
    <tbody><tr>${types.map(t => td(m.colTot[t])).join('')}<td style="padding:4px 10px;text-align:right;font-weight:600;white-space:nowrap">${payrollRound(m.total.h)}h</td></tr></tbody></table></div>`;
}
// 排序：col = date / type / hours；dir = 1 升 / -1 降
function wrtSort(recs, col, dir) {
  const byDate = (a, b) => String(a.start_time).localeCompare(String(b.start_time));
  const cmp = {
    date: byDate,
    type: (a, b) => payrollTypeIdx(a.work_type) - payrollTypeIdx(b.work_type) || byDate(a, b),
    hours: (a, b) => ((parseFloat(a.duration) || 0) - (parseFloat(b.duration) || 0)) || byDate(a, b)
  }[col] || byDate;
  return recs.slice().sort((a, b) => cmp(a, b) * dir);
}
// opt = { sortCol, sortDir, onSort:'函数名（参数是列名）', actions: r => 按钮 html }
function wrtTableHtml(recs, opt) {
  const sc = opt.sortCol, sd = opt.sortDir;
  const base = 'padding:5px 8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600;color:var(--text-2);white-space:nowrap;background:var(--bg);';
  const stick = (left, z) => `position:sticky;left:${left}px;z-index:${z};`;
  const th = (label, col, st) => `<th onclick="${opt.onSort}('${col}')" style="${base}cursor:pointer;${st || ''}">${label}<span style="color:${sc === col ? 'var(--accent)' : 'var(--text-3)'}"> ${sc === col ? (sd === 1 ? '↑' : '↓') : '↕'}</span></th>`;
  const plain = (h, st) => `<th style="${base}${st || ''}">${h}</th>`;
  const stTag = { pending: ['待审批', '#856404', '#fff3cd'], rejected: ['已驳回', '#8a1a1a', '#f8e0e0'] };
  const row = r => {
    const p = wrtParse(r.start_time), e = wrtParse(r.end_time), s = stTag[r.status];
    const bg = r.status === 'rejected' ? '#fbeeee' : r.status === 'pending' ? '#f6f6f4' : 'var(--surface)';
    const td = 'padding:5px 8px;vertical-align:top;';
    const tag = s ? `<span style="font-size:10px;background:${s[2]};color:${s[1]};border-radius:2px;padding:1px 6px;margin-right:4px">${s[0]}</span>` : '';
    const reject = r.status === 'rejected' ? `<div style="font-size:10px;color:#8a1a1a;margin-top:2px">驳回原因：${wrtEsc(r.admin_note || '（未写原因）')}</div>` : '';
    return `<tr style="border-bottom:1px solid var(--border-light);background:${bg}${r.status === 'pending' ? ';color:#777' : ''}">
      <td style="${td}${stick(0, 1)}background:${bg};white-space:nowrap;width:88px;min-width:88px;max-width:88px;box-sizing:border-box">${wrtEsc(p.md)} <span style="color:var(--text-3)">周${p.wd}</span></td>
      <td style="${td}${stick(88, 1)}background:${bg};white-space:nowrap;font-family:'DM Mono',monospace;color:var(--accent)">${wrtEsc(r.duration)}h</td>
      <td style="${td}white-space:nowrap;color:var(--text-2)">${wrtEsc(p.hm)}${e.hm ? '–' + wrtEsc(e.hm) : ''}</td>
      <td style="${td}white-space:nowrap">${wrtEsc(payrollTypeName(r.work_type))}</td>
      <td style="${td}white-space:nowrap;color:var(--text-2)">${wrtEsc(r.location)}</td>
      <td style="${td}min-width:160px">${tag}${wrtEsc(r.notes)}${reject}</td>
      <td style="${td}white-space:nowrap">${opt.actions ? opt.actions(r) : ''}</td>
    </tr>`;
  };
  return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr>${th('日期', 'date', stick(0, 2) + 'width:88px;min-width:88px;box-sizing:border-box;')}${th('时长', 'hours', stick(88, 2))}${plain('时间')}${th('工作内容', 'type')}${plain('地点')}${plain('备注')}${plain('')}</tr></thead>
    <tbody>${wrtSort(recs, sc, sd).map(row).join('')}</tbody></table></div>`;
}
// 下载：格式和管理端发给老师的那份一样（明细 + 按工作内容汇总）
function wrtDownload(recs, label, who) {
  payrollDownload(wrtSort(recs, 'date', 1).map(payrollRecToRow), label, who);
}
