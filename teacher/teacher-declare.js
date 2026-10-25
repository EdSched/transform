// ══════════════════════════════════
// 工资申告（老师端「工作记录」页）
// 只报：教研工作 / 试听・试讲 / 临时上课安排。大课、面谈、VIP 系统自动算，撞时间不让报。
// 写入 work_records（source='declare'），管理端工资页（admin/payroll.js）一起审批。
// 依赖：teacher.js（teacherName / teacherData / renderWorkRecordsTeacher）、shared/constants.js（timeInputHtml 等）
// ══════════════════════════════════

const WDC_KINDS = ['教研工作', '试听・试讲', '临时上课安排'];
const WDC_LOCS = ['高马校区', '市谷校区', '线上', '其他'];
const WDC_AUTO_LABEL = { course: '大课', booking: '面谈', vip: 'VIP' };
const wdcState = { mc: null, open: false, editId: '', kind: '', loc: '', locOther: '', domain: '', mine: [], weekKey: '', auto: [], loading: false };

const wdcEsc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const wdcPad = n => String(n).padStart(2, '0');
const wdcHM = m => wdcPad(Math.floor(m / 60)) + ':' + wdcPad(m % 60);
const wdcMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };
function wdcToday() { const d = new Date(); return d.getFullYear() + '-' + wdcPad(d.getMonth() + 1) + '-' + wdcPad(d.getDate()); }
// 2026-10-25 + 13:00 ↔ 「2026年10月25日 13:00」
const wdcFmt = (date, hm) => date.slice(0, 4) + '年' + date.slice(5, 7) + '月' + date.slice(8, 10) + '日 ' + hm;
function wdcParse(s) {
  const m = String(s || '').match(/(\d{4})年(\d{2})月(\d{2})日\s*(\d{1,2}:\d{2})/);
  return m ? { date: m[1] + '-' + m[2] + '-' + m[3], min: wdcMin(m[4]) } : null;
}
function wdcWeekRange(date) {
  const d = new Date(date + 'T12:00:00'), wd = (d.getDay() + 6) % 7;   // 周一 = 0
  const a = new Date(d.getTime() - wd * 864e5), b = new Date(a.getTime() + 6 * 864e5);
  const f = x => x.getFullYear() + '-' + wdcPad(x.getMonth() + 1) + '-' + wdcPad(x.getDate());
  return { start: f(a), end: f(b) };
}
// 老师可选的领域：负责领域 / 隶属领域 / 负责专业所属领域
function wdcDomains() {
  const t = teacherData || {}, set = new Set();
  (t.domains || []).forEach(d => d && set.add(d));
  (t.managed_by || []).forEach(d => d && set.add(d));
  (t.majors || []).forEach(m => { const d = (typeof MAJOR_DOMAIN !== 'undefined') ? MAJOR_DOMAIN[m] : ''; if (d) set.add(d); });
  return [...set];
}

// ── 这一周系统会自动算的工作：大课 / 面谈 / VIP（口径同管理端工资核算）──
async function wdcLoadAuto(date) {
  const rg = wdcWeekRange(date), key = rg.start;
  if (wdcState.weekKey === key) return;
  wdcState.loading = true;
  const n = encodeURIComponent(teacherName), q = `"${teacherName.replace(/"/g, '')}"`;
  const [ses, courses, slotRows, bks] = await Promise.all([
    sb(`/rest/v1/course_sessions?select=*&session_date=gte.${rg.start}&session_date=lte.${rg.end}&or=(teacher.eq.${encodeURIComponent(q)},session_teacher.eq.${encodeURIComponent(q)})`, 'GET', null, { cache: 'no-store' })
      .catch(() => sb(`/rest/v1/course_sessions?select=*&session_date=gte.${rg.start}&session_date=lte.${rg.end}&session_teacher=eq.${n}`, 'GET', null, { cache: 'no-store' }).catch(() => [])),
    sb('/rest/v1/courses?select=id,time_range,name').catch(() => []),
    sb(`/rest/v1/slots?teacher_name=eq.${n}&date=gte.${rg.start}&date=lte.${rg.end}&select=*`, 'GET', null, { cache: 'no-store' }).catch(() => []),
    sb(`/rest/v1/bookings?slot_date=gte.${rg.start}&slot_date=lte.${rg.end}&status=neq.cancelled&select=*`, 'GET', null, { cache: 'no-store' }).catch(() => [])
  ]);
  const cMap = {}; (courses || []).forEach(c => { cMap[c.id] = c; });
  const sMap = {}; (slotRows || []).forEach(s => { sMap[s.id] = s; });
  const out = [];
  (ses || []).filter(s => !s.is_cancelled && (s.teacher === teacherName || s.session_teacher === teacherName)).forEach(s => {
    const tr = s.time_range || (cMap[s.course_id] || {}).time_range || '';
    const label = (s.course_name || (cMap[s.course_id] || {}).name || '大课') + (s.session_number ? ' 第' + s.session_number + '回' : '');
    const segs = parseTimeRanges(tr).filter(x => wdcMin(x.start) != null && wdcMin(x.end) != null);
    if (!segs.length) out.push({ kind: 'course', date: s.session_date, s: null, e: null, label });
    segs.forEach(x => out.push({ kind: 'course', date: s.session_date, s: wdcMin(x.start), e: wdcMin(x.end), label }));
  });
  (bks || []).forEach(b => {
    const owner = b.assigned_teacher || (sMap[b.slot_id] || {}).teacher_name || '';
    if (owner !== teacherName) return;
    if (b.type === 'vip') {
      if (b.teacher_backfill && b.admin_review !== 'approved') return;
      const segs = parseTimeRanges(b.slot_time_range || '').filter(x => wdcMin(x.start) != null && wdcMin(x.end) != null);
      const label = (b.name || '') + ' VIP';
      if (!segs.length) out.push({ kind: 'vip', date: b.slot_date, s: null, e: null, label });
      segs.forEach(x => out.push({ kind: 'vip', date: b.slot_date, s: wdcMin(x.start), e: wdcMin(x.end), label }));
    } else {
      let date = b.slot_date, s = null;
      const mins = b.actual_duration || b.duration || 30;
      if (b.actual_time) {
        const d = new Date(b.actual_time);
        if (!isNaN(d)) { date = d.getFullYear() + '-' + wdcPad(d.getMonth() + 1) + '-' + wdcPad(d.getDate()); s = d.getHours() * 60 + d.getMinutes(); }
      }
      if (s == null) s = wdcMin(parseTimeRanges(b.slot_time_range || '')[0]?.start);
      out.push({ kind: 'booking', date, s, e: s == null ? null : s + mins, label: (b.name || '') + ' 面谈' });
    }
  });
  out.sort((a, b) => a.date.localeCompare(b.date) || (a.s == null ? 1 : b.s == null ? -1 : a.s - b.s));
  wdcState.auto = out; wdcState.weekKey = key; wdcState.loading = false;
}

// 填写的时间段撞上的东西：自动算的 + 自己已提交没被驳回的申告
function wdcConflicts(date, s, e) {
  const hit = [];
  if (!date || s == null || e == null) return hit;
  wdcState.auto.forEach(a => { if (a.date === date && a.s != null && a.s < e && a.e > s) hit.push({ kind: a.kind, label: a.label, item: a }); });
  wdcState.mine.forEach(r => {
    if (r.status === 'rejected' || r.id === wdcState.editId) return;
    const a = wdcParse(r.start_time), b = wdcParse(r.end_time);
    if (a && b && a.date === date && a.min < e && b.min > s) hit.push({ kind: 'declare', label: r.work_type + '（已提交的申告）' });
  });
  return hit;
}

// ── 表单 ──
function wdcOpen(editId) {
  const r = editId ? wdcState.mine.find(x => x.id === editId) : null;
  wdcState.open = true; wdcState.editId = r ? r.id : '';
  wdcState.kind = r ? r.work_type : ''; wdcState.domain = r ? (r.domain || '') : '';
  const known = WDC_LOCS.slice(0, 3);
  wdcState.loc = r ? (known.includes(r.location) ? r.location : '其他') : '';
  wdcState.locOther = r && !known.includes(r.location) ? r.location : '';
  const ds = wdcDomains();
  if (!wdcState.domain && ds.length === 1) wdcState.domain = ds[0];
  const a = r && wdcParse(r.start_time), b = r && wdcParse(r.end_time);
  wdcRenderForm({ date: a ? a.date : wdcToday(), st: a ? wdcHM(a.min) : '', en: b ? wdcHM(b.min) : '', note: r ? (r.notes || '') : '' });
}
function wdcClose() { wdcState.open = false; wdcState.editId = ''; const b = document.getElementById('wdc_form'); if (b) b.innerHTML = ''; const bt = document.getElementById('wdc_btn'); if (bt) bt.textContent = '＋ 工资申告'; }

async function wdcRenderForm(v) {
  const box = document.getElementById('wdc_form');
  if (!box) return;
  const bt = document.getElementById('wdc_btn'); if (bt) bt.textContent = '收起申告';
  const chip = (on, click, t) => `<div class="filter-chip${on ? ' active' : ''}" onclick="${click}">${t}</div>`;
  const ds = wdcDomains();
  box.innerHTML = `
  <div style="background:var(--surface);border:1px solid var(--accent);border-radius:4px;padding:14px;margin-bottom:14px">
    <div style="font-size:12px;font-weight:600;margin-bottom:4px">${wdcState.editId ? '修改申告' : '工资申告'}</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">只用来报教研工作、试听・试讲、临时上课。大课、面谈、VIP 系统自动算，不用在这里报。</div>
    <div style="display:flex;flex-wrap:wrap;gap:18px">
      <div style="flex:1 1 300px;min-width:0">
        <div class="form-group"><label class="form-label">日期（可选以前的，不能选以后）</label>
          <input type="date" id="wdc_date" value="${v.date}" max="${wdcToday()}" onchange="wdcDateChange()" style="max-width:180px"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="form-group"><label class="form-label">开始</label>${timeInputHtml('wdc_st', v.st, '如 13:00', { onch: 'wdcRecalc()', role: 'start', mate: 'wdc_en', btn: 'wdc_ok' })}</div>
          <div class="form-group"><label class="form-label">结束</label>${timeInputHtml('wdc_en', v.en, '如 14:00', { onch: 'wdcRecalc()', role: 'end', mate: 'wdc_st', btn: 'wdc_ok' })}</div>
        </div>
        <div id="wdc_dur_line" style="font-size:12px;margin:-2px 0 4px"></div>
        <div id="wdc_round" style="font-size:11px;color:#856404;background:#fff3cd;border-radius:3px;padding:6px 10px;margin-bottom:8px;display:none"></div>
        <div class="form-group"><label class="form-label">工作内容（必选）</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${WDC_KINDS.map(k => chip(wdcState.kind === k, `wdcPickKind('${k}')`, k)).join('')}</div></div>
        <div class="form-group"><label class="form-label">工作地点（必选）</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${WDC_LOCS.map(k => chip(wdcState.loc === k, `wdcPickLoc('${k}')`, k)).join('')}</div>
          ${wdcState.loc === '其他' ? `<input id="wdc_loc_other" value="${wdcEsc(wdcState.locOther)}" placeholder="写一句地点" style="margin-top:6px;width:100%" oninput="wdcState.locOther=this.value">` : ''}</div>
        ${ds.length > 1 ? `<div class="form-group"><label class="form-label">所属领域（必选）</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${ds.map((d, i) => chip(wdcState.domain === d, `wdcPickDomain(${i})`, wdcEsc(d))).join('')}</div></div>` : ''}
        <div class="form-group"><label class="form-label">备注（必填）</label>
          <textarea id="wdc_note" rows="2" placeholder="写了什么、给谁试讲、替哪门课临时上课" style="width:100%">${wdcEsc(v.note)}</textarea></div>
        <div id="wdc_msg" style="font-size:11px;margin-bottom:8px"></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" id="wdc_ok" onclick="wdcSubmit()">${wdcState.editId ? '保存并重新提交' : '提交申告'}</button>
          <button class="btn btn-outline btn-sm" onclick="wdcClose()">取消</button>
        </div>
      </div>
      <div style="flex:1 1 260px;min-width:0"><div id="wdc_auto"></div></div>
    </div>
  </div>`;
  timePairCheck('wdc_st', 'wdc_en', 'wdc_ok');
  await wdcRefreshAuto();
  wdcRecalc(true);
}
async function wdcRefreshAuto() {
  const date = (document.getElementById('wdc_date') || {}).value;
  const el = document.getElementById('wdc_auto');
  if (!date || !el) return;
  el.innerHTML = '<div style="font-size:11px;color:var(--text-3)">加载这一周系统已自动算的工作…</div>';
  try { await wdcLoadAuto(date); } catch (e) { el.innerHTML = `<div style="font-size:11px;color:var(--danger)">读取失败：${wdcEsc(e.message)}</div>`; return; }
  wdcPaintAuto();
}
async function wdcDateChange() {
  const d = document.getElementById('wdc_date');
  if (d && d.value > wdcToday()) { d.value = wdcToday(); }
  await wdcRefreshAuto();
  wdcRecalc(true);
}
function wdcRead() {
  return { date: (document.getElementById('wdc_date') || {}).value || '', st: readTimeInput('wdc_st'), en: readTimeInput('wdc_en') };
}
// 时长按 0.25 小时取整，结束时间同步改；再查有没有撞时间
function wdcRecalc(silent) {
  const v = wdcRead(), rd = document.getElementById('wdc_round'), line = document.getElementById('wdc_dur_line');
  if (!rd || !line) return;
  rd.style.display = 'none'; line.innerHTML = '';
  let s = wdcMin(v.st), e = wdcMin(v.en);
  if (s != null && e != null && e > s) {
    const raw = e - s, r = Math.max(15, Math.round(raw / 15) * 15);
    if (r !== raw) {
      e = s + r;
      if (e > 23 * 60 + 59) { e = 23 * 60 + 59; }
      setTimeInput('wdc_en', wdcHM(e));
      rd.textContent = `已按 0.25 小时取整为 ${r / 60} 小时。工作时长请尽量控制在整数时间，注意把握安排`;
      rd.style.display = 'block';
    }
    line.innerHTML = `时长 <strong>${(e - s) / 60}</strong> 小时`;
  }
  wdcPaintAuto();
  wdcCheck();
}
function wdcPaintAuto() {
  const el = document.getElementById('wdc_auto');
  if (!el) return;
  const v = wdcRead(), s = wdcMin(v.st), e = wdcMin(v.en), rg = wdcWeekRange(v.date || wdcToday());
  const hits = new Set(wdcConflicts(v.date, s, e).map(h => h.item).filter(Boolean));
  const cnt = k => wdcState.auto.filter(a => a.kind === k).length;
  const wk = ['日', '一', '二', '三', '四', '五', '六'];
  const rows = wdcState.auto.map(a => {
    const bad = hits.has(a), d = new Date(a.date + 'T12:00:00');
    return `<div style="padding:3px 6px;border-radius:2px;${bad ? 'background:#f8e0e0;color:#8a1a1a;font-weight:600' : ''}">${a.date.slice(5)}（${wk[d.getDay()]}）${a.s == null ? '时间未定' : wdcHM(a.s) + '–' + wdcHM(a.e)} · ${WDC_AUTO_LABEL[a.kind]} · ${wdcEsc(a.label)}</div>`;
  }).join('');
  el.innerHTML = `<div style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:10px 12px;font-size:11px">
    <div style="font-weight:600;margin-bottom:2px">这一周系统已自动算的工作（${rg.start.slice(5)} ～ ${rg.end.slice(5)}）</div>
    <div style="color:var(--text-3);margin-bottom:6px">大课 ${cnt('course')} 条 · 面谈 ${cnt('booking')} 条 · VIP ${cnt('vip')} 条。这些不用申告；撞到的会标红。</div>
    ${rows || '<div style="color:var(--text-3)">这一周没有</div>'}</div>`;
}
// 实时检查：撞时间 → 提示并禁用提交；临时上课 → 提醒代大课走教务
function wdcCheck() {
  const msg = document.getElementById('wdc_msg'), btn = document.getElementById('wdc_ok');
  if (!msg) return false;
  const v = wdcRead(), s = wdcMin(v.st), e = wdcMin(v.en);
  const hits = wdcConflicts(v.date, s, e);
  let h = '';
  hits.forEach(x => {
    h += x.kind === 'declare'
      ? `<div style="color:var(--danger)">这个时间你已经提交过「${wdcEsc(x.label)}」，不能重复申告</div>`
      : `<div style="color:var(--danger)">这个时间你已经有『${wdcEsc(x.label)}』（${WDC_AUTO_LABEL[x.kind]}），系统会自动算进工资，不需要申告</div>`;
  });
  if (wdcState.kind === '临时上课安排') h += '<div style="color:#856404">代大课请联系教务在课程的单回明细里改成你，系统会自动算，不要在这里申告</div>';
  msg.innerHTML = h;
  const pairBad = (document.getElementById('wdc_st') || {}).dataset?.pairbad === '1';
  if (btn) btn.disabled = hits.length > 0 || pairBad;
  return hits.length === 0;
}
function wdcKeepNote() { const n = document.getElementById('wdc_note'); return n ? n.value : ''; }
function wdcRerender() { const v = wdcRead(); wdcRenderForm({ date: v.date || wdcToday(), st: v.st, en: v.en, note: wdcKeepNote() }); }
function wdcPickKind(k) { wdcState.kind = k; wdcRerender(); }
function wdcPickLoc(k) { wdcState.loc = k; wdcRerender(); }
function wdcPickDomain(i) { wdcState.domain = wdcDomains()[i] || ''; wdcRerender(); }

async function wdcSubmit() {
  const v = wdcRead(), note = wdcKeepNote().trim();
  const s = wdcMin(v.st), e = wdcMin(v.en);
  if (!v.date) return alert('请选择日期');
  if (v.date > wdcToday()) return alert('不能申告以后的日期，未来的工作等做完再报');
  if (s == null || e == null || e <= s) return alert('请填写正确的开始和结束时间');
  if (!wdcState.kind) return alert('请选择工作内容');
  if (!wdcState.loc) return alert('请选择工作地点');
  if (wdcState.loc === '其他' && !wdcState.locOther.trim()) return alert('工作地点选了「其他」，请填一句');
  if (wdcDomains().length > 1 && !wdcState.domain) return alert('请选择所属领域');
  if (!note) return alert('备注必填：说明写了什么、给谁试讲、替哪门课临时上课');
  await wdcLoadAuto(v.date);
  if (!wdcCheck()) return;
  const dur = Math.round((e - s) / 15) / 4;
  if (dur * 60 !== e - s) return alert('工作时长要是 0.25 小时的整倍数，请调整结束时间');
  const loc = wdcState.loc === '其他' ? wdcState.locOther.trim() : wdcState.loc;
  const f = { start_time: wdcFmt(v.date, v.st), end_time: wdcFmt(v.date, v.en), duration: dur, work_type: wdcState.kind, location: loc, notes: note, domain: wdcState.domain || null };
  const btn = document.getElementById('wdc_ok'); if (btn) btn.disabled = true;
  try {
    if (wdcState.editId) {
      await sb(`/rest/v1/work_records?id=eq.${encodeURIComponent(wdcState.editId)}`, 'PATCH', { ...f, status: 'pending', admin_note: null, updated_at: new Date().toISOString() });
    } else {
      const id = `wr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      await sb('/rest/v1/work_records', 'POST', { id, teacher_name: teacherName, source: 'declare', source_id: id, status: 'pending', ...f });
    }
    wdcState.open = false; wdcState.editId = '';
    renderWorkRecordsTeacher(wdcState.mc);
  } catch (err) {
    alert('提交失败：' + err.message);
    if (btn) btn.disabled = false;
  }
}
async function wdcWithdraw(id) {
  if (!confirm('撤回这条申告？撤回后会删除。')) return;
  try { await sb(`/rest/v1/work_records?id=eq.${encodeURIComponent(id)}`, 'DELETE'); } catch (e) { return alert('撤回失败：' + e.message); }
  renderWorkRecordsTeacher(wdcState.mc);
}

// 工作记录页渲染完后调用：records = 这位老师的全部 work_records
function wdcMount(records) {
  wdcState.mine = (records || []).filter(r => r.source === 'declare');
  wdcState.weekKey = '';
  if (wdcState.open) wdcOpen(wdcState.editId);
}
function wdcToggle() { if (wdcState.open) wdcClose(); else wdcOpen(''); }
