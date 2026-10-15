// 管控台「作业图片存储」：按月显示作业图片的份数、张数、估算大小（读 Storage 对象列表）。只读，不删除任何文件。
let hwsRunning = false;
function hwsFmt(n) { return n >= 1024 * 1024 * 1024 ? (n / 1024 / 1024 / 1024).toFixed(2) + ' GB' : n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }
async function hwsList(prefix) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${SB_URL}/storage/v1/object/list/homework`, {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + (__getSbToken() || SB_KEY), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset: off, sortBy: { column: 'name', order: 'asc' } })
    });
    if (!r.ok) throw new Error(await r.text());
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
function hwsMount(body) {
  body.innerHTML = `<div style="max-width:640px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px 18px">
    <div style="font-size:14px;font-weight:600;margin-bottom:4px">作业图片存储</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">按月统计学生上传的作业图片（原图与缩略图合计）。只做统计，不会删除任何文件。文件多时需要几十秒。</div>
    <button class="btn btn-outline btn-sm" id="hws_btn" onclick="hwsRun()">开始统计</button>
    <div id="hws_out" style="margin-top:12px;font-size:12px"></div></div>`;
}
async function hwsRun() {
  if (hwsRunning) return;
  hwsRunning = true;
  const out = document.getElementById('hws_out'), btn = document.getElementById('hws_btn');
  if (btn) btn.disabled = true;
  try {
    out.textContent = '读取文件夹…';
    const top = await hwsList('');
    const dirs = top.filter(x => !x.id && x.name !== 'refs' && x.name !== 'q').map(x => x.name);   // 每个学生一个文件夹；refs / q 是老师的题目素材
    const byMonth = {};   // ym → { n, bytes }
    const addObj = (o) => {
      if (!o.id) return;
      const ym = (o.created_at || '').slice(0, 7) || '未知';
      const b = byMonth[ym] || (byMonth[ym] = { n: 0, bytes: 0 });
      if (!/_thumb\.jpg$/i.test(o.name)) b.n++;   // 张数不算缩略图，大小算
      b.bytes += (o.metadata && o.metadata.size) || 0;
    };
    // 根目录下直接放的文件也算
    top.forEach(addObj);
    let done = 0;
    for (let i = 0; i < dirs.length; i += 8) {
      await Promise.all(dirs.slice(i, i + 8).map(async d => { (await hwsList(d)).forEach(addObj); done++; }));
      out.textContent = `读取中 ${done} / ${dirs.length}…`;
    }
    // 份数：每次提交算一份，按提交月份
    const subs = await sbAll('/rest/v1/homework_submissions?select=submitted_at').catch(() => []);
    const subsBy = {};
    subs.forEach(x => { const ym = (x.submitted_at || '').slice(0, 7); if (ym) subsBy[ym] = (subsBy[ym] || 0) + 1; });
    const months = [...new Set([...Object.keys(byMonth), ...Object.keys(subsBy)])].sort().reverse();
    let tn = 0, tb = 0, ts = 0;
    const rows = months.map(m => {
      const b = byMonth[m] || { n: 0, bytes: 0 }, s = subsBy[m] || 0;
      tn += b.n; tb += b.bytes; ts += s;
      return `<tr><td style="padding:4px 10px 4px 0">${m}</td><td style="text-align:right;padding:4px 10px">${s}</td><td style="text-align:right;padding:4px 10px">${b.n}</td><td style="text-align:right;padding:4px 0 4px 10px">${hwsFmt(b.bytes)}</td></tr>`;
    }).join('');
    out.innerHTML = tn || ts ? `<table style="border-collapse:collapse;width:100%"><thead><tr style="color:var(--text-3);font-size:11px;text-align:right"><th style="text-align:left;font-weight:400">月份</th><th style="font-weight:400;padding:0 10px">份数</th><th style="font-weight:400;padding:0 10px">张数</th><th style="font-weight:400">估算大小</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="border-top:1px solid var(--border);font-weight:600"><td style="padding:6px 10px 0 0">总计</td><td style="text-align:right;padding:6px 10px 0">${ts}</td><td style="text-align:right;padding:6px 10px 0">${tn}</td><td style="text-align:right;padding:6px 0 0 10px">${hwsFmt(tb)}</td></tr></tfoot></table>`
      : '<span style="color:var(--text-3)">没有读到文件（可能没有读取权限，或还没有作业图片）</span>';
  } catch (e) {
    out.innerHTML = `<span style="color:var(--danger)">统计失败：${String((e && e.message) || e).replace(/</g, '&lt;')}</span>`;
  }
  hwsRunning = false;
  if (btn) { btn.disabled = false; btn.textContent = '重新统计'; }
}
