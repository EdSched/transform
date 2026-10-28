// 课程保存后的「请核对」窗口 + 套用模板 / 复制到下一期前的「假期确认」窗口
// 管理端、排课共用；依赖 shared/constants.js（courseScan / HOLIDAYS / campusNormalize / campusLabel / majorLabel / periodKeyOf / effectivePeriod）
// 窗口是自己建的（不依赖页面里的 modal 样式），样式全部写在元素上。

function ccEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function ccMD(d) { return d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : ''; }
const CC_WD = ['日', '一', '二', '三', '四', '五', '六'];
function ccDateLabel(d) { return `${d.slice(0, 4)}-${ccMD(d).replace('/', '-')}（周${CC_WD[new Date(d + 'T12:00:00').getDay()]}）`; }

// 「这期间碰到的假期」一行一个：日期 + 假期名 + 一个「照常上课」chip（点了 = 豁免，不跳过）
function courseHitsHtml(hits, toggleFn) {
  if (!hits || !hits.length) return '<span style="font-size:11px;color:var(--text-3,#999)">这期间没有碰到全局假期</span>';
  return '<div style="font-size:11px;color:var(--text-2,#555);margin-bottom:6px">这期间碰到这些假期，没勾的已经自动跳过；点「照常上课」= 这天照常上课、不跳过</div>' +
    hits.map(h => `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px">
      <span style="min-width:150px">${ccEsc(ccMD(h.date))}（周${CC_WD[new Date(h.date + 'T12:00:00').getDay()]}）${ccEsc(h.label)}</span>
      <span class="filter-chip${h.excepted ? ' active' : ''}" onclick="${toggleFn}('${h.date}')" style="cursor:pointer;font-size:11px;padding:3px 10px">照常上课</span>
      <span style="font-size:11px;color:var(--text-3,#999)">${h.excepted ? '这天照常上课' : '这天已跳过'}</span></div>`).join('');
}

function ccOverlay(id) {
  const old = document.getElementById(id); if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = id;
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:12px';
  document.body.appendChild(ov);
  return ov;
}
const CC_BOX = 'background:var(--surface,#fff);color:var(--text,#1a1814);border-radius:6px;max-width:640px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 8px 30px rgba(0,0,0,.25);font-size:12px';
const CC_WARN = 'background:#fff4d6;color:#7a5b00;border:1px solid #ecd48a;border-radius:3px;padding:2px 8px;margin:2px 0;font-size:11px';

// 一门课的核对内容。it: { course, dates:[每回日期], notes:[黄色提醒], autoCount, autoLast, periodChange:{from,to}, majorText?, periodText? }
function ccItemHtml(it, open) {
  const c = it.course || {};
  const warns = (it.notes || []).slice();
  const dates = (it.dates || []).slice().sort();
  const first = dates[0] || c.first_session_date || '', last = dates[dates.length - 1] || c.end_date || '';
  const scan = (typeof courseScan === 'function' && c.weekdays && first && last) ? courseScan(c, { last }) : { hits: [] };
  const skipped = scan.hits.filter(h => !h.excepted), kept = scan.hits.filter(h => h.excepted);
  const camp = campusNormalize(c.campus);
  if (c.campus && !camp) warns.push(`校区是旧写法「${c.campus}」，请重新选择`);
  else if (c.campus && camp !== c.campus) warns.push(`校区「${c.campus}」会按「${campusLabel(camp)}」处理`);
  let period;
  if (c.period_auto) period = `自动：${c.period_override || ''}`;
  else { try { period = periodKeyOf(c); } catch (e) { period = c.period || ''; } }
  if (it.periodText) period = it.periodText;
  if (period === '暂定') warns.push('期数是暂定，之后记得调整');
  if (it.periodChange) warns.push(`期数由 ${it.periodChange.from} 变成 ${it.periodChange.to}`);
  if (it.autoCount) warns.push(`回数 ${c.total_sessions} 是按星期、跳过假期自动算出来的`);
  if (it.autoLast) warns.push(`最后一回日期 ${last} 是按回数、星期、跳过假期自动算出来的`);
  const majors = it.majorText || (c.major || []).map(m => typeof majorLabel === 'function' ? majorLabel(m) : m).join('、');
  const row = (k, v) => `<div style="display:flex;gap:8px;padding:2px 0;border-bottom:1px solid var(--border-light,#eee)"><span style="width:88px;flex:none;color:var(--text-3,#888)">${k}</span><span style="flex:1;min-width:0;word-break:break-all">${v}</span></div>`;
  const e = ccEsc;
  const head = `${e(c.name || '')}　${e(period)}　${dates.length || c.total_sessions || 0}回　${e(ccMD(first))}～${e(ccMD(last))}${warns.length ? `　<span style="color:#7a5b00">（${warns.length} 条提醒）</span>` : ''}`;
  const body = (warns.length ? `<div style="margin-bottom:6px">${warns.map(w => `<div style="${CC_WARN}">${e(w)}</div>`).join('')}</div>` : '') +
    row('课程名', e(c.name || '')) + row('专业', e(majors || '—')) + row('领域', e(c.domain || '—')) +
    row('期数', e(period || '—')) + row('课程属性', e(c.course_type || '—')) +
    row('讲师', e(c.teacher || '—')) + row('校区', e(camp ? campusLabel(camp) : (c.campus || '—'))) + row('授课形式', e(c.delivery || '—')) +
    row('星期', e(c.weekdays || '—')) + row('上课时间', e(c.time_range || '—')) + row('课时', c.actual_hours ? e(c.actual_hours) + ' 小时' : '—') +
    row('起止日期', e(first || '—') + ' ～ ' + e(last || '—')) + row('回数', e(dates.length || c.total_sessions || '—')) +
    row('跳过的假期', skipped.length ? skipped.map(h => e(ccMD(h.date) + ' ' + h.label)).join('、') : '无') +
    row('照常上课的假期', kept.length ? kept.map(h => e(ccMD(h.date) + ' ' + h.label)).join('、') : '无') +
    `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--text-2,#555)">每一回的日期（${dates.length} 回）</summary><div style="line-height:1.8;margin-top:4px">${dates.map((d, i) => `<div>第 ${i + 1} 回　${e(ccDateLabel(d))}</div>`).join('') || '—'}</div></details>`;
  return { head, body, warnN: warns.length };
}

// opts: { title, items:[...], onEdit(courseId) }
function courseConfirmOpen(opts) {
  const items = (opts.items || []).filter(Boolean);
  if (!items.length) return;
  const ov = ccOverlay('ccConfirmOv');
  const one = items.length === 1;
  const parts = items.map(it => ccItemHtml(it));
  ov.innerHTML = `<div style="${CC_BOX}">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border,#e2ded6);font-size:15px;font-weight:600">${ccEsc(opts.title || '课程已保存，请核对')}</div>
    <div style="padding:12px 18px;overflow:auto;flex:1">${one ? parts[0].body :
      items.map((it, i) => `<details style="border:1px solid var(--border,#e2ded6);border-radius:3px;margin-bottom:6px;padding:6px 10px"><summary style="cursor:pointer">${parts[i].head}</summary><div style="margin-top:8px">${parts[i].body}</div></details>`).join('')}</div>
    <div style="padding:10px 18px;border-top:1px solid var(--border,#e2ded6);display:flex;gap:8px;justify-content:flex-end">
      ${one && opts.onEdit ? `<button type="button" id="ccEditBtn" class="btn btn-outline btn-sm" style="padding:6px 16px;cursor:pointer">回去改</button>` : ''}
      <button type="button" id="ccOkBtn" class="btn btn-primary btn-sm" style="padding:6px 16px;cursor:pointer">没问题</button>
    </div></div>`;
  const close = () => ov.remove();
  ov.querySelector('#ccOkBtn').onclick = close;
  const eb = ov.querySelector('#ccEditBtn');
  if (eb) eb.onclick = () => { close(); const id = items[0].course && items[0].course.id; if (id) opts.onEdit(id); };
}

// 套用模板 / 复制到下一期：建课之前先弹出这期间碰到的假期，可以点「照常上课」。
// course: { first_session_date, weekdays, skip_dates, holiday_except }，total: 回数
// 返回 Promise：确认 → 豁免的日期（逗号分隔，可能是空字符串）；取消 → null。没碰到假期就不弹窗、直接返回原来的豁免。
function courseHolidayPrompt(course, total, title) {
  const base = { first_session_date: course.first_session_date, weekdays: course.weekdays, skip_dates: course.skip_dates || '', holiday_except: course.holiday_except || '' };
  const ex = new Set(base.holiday_except.split(',').map(s => s.trim()).filter(Boolean));
  const scanNow = () => courseScan(Object.assign({}, base, { holiday_except: [...ex].join(',') }), { total });
  if (!scanNow().hits.length) return Promise.resolve(base.holiday_except);
  return new Promise(resolve => {
    const ov = ccOverlay('ccHolidayOv');
    window.__ccHolToggle = d => { if (ex.has(d)) ex.delete(d); else ex.add(d); draw(); };
    const draw = () => {
      const s = scanNow(), n = s.dates.length;
      ov.innerHTML = `<div style="${CC_BOX}">
        <div style="padding:14px 18px;border-bottom:1px solid var(--border,#e2ded6);font-size:15px;font-weight:600">${ccEsc(title || '这期间有假期')}</div>
        <div style="padding:12px 18px;overflow:auto;flex:1">${courseHitsHtml(s.hits, '__ccHolToggle')}
          <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border-light,#eee)">按这样排：共 <b>${n}</b> 回，${ccEsc(s.dates[0] || '')} ～ ${ccEsc(s.dates[n - 1] || '')}${n < total ? `<div style="${CC_WARN}">只排出 ${n} 回（需要 ${total} 回），请检查星期</div>` : ''}</div></div>
        <div style="padding:10px 18px;border-top:1px solid var(--border,#e2ded6);display:flex;gap:8px;justify-content:flex-end">
          <button type="button" id="ccHolNo" class="btn btn-outline btn-sm" style="padding:6px 16px;cursor:pointer">取消</button>
          <button type="button" id="ccHolOk" class="btn btn-primary btn-sm" style="padding:6px 16px;cursor:pointer">确认并建课</button></div></div>`;
      ov.querySelector('#ccHolNo').onclick = () => { ov.remove(); resolve(null); };
      ov.querySelector('#ccHolOk').onclick = () => { ov.remove(); resolve([...ex].sort().join(',')); };
    };
    draw();
  });
}
