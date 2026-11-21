// 兜底：「单回↔教室占用同步」已整套删除；万一哪里漏了调用，也不会报错打断保存
window.courseRoomSyncSafe = window.courseRoomSyncSafe || (async () => null);
window.courseRoomClear = window.courseRoomClear || (async () => null);
// 管理端和排课共用：课程的单回（course_sessions）按课程框架重排日期
// 依赖 shared/constants.js（courseScan / timeRangesSpan）。管理端用 sb / sbAll，排课用 sbGet / sbUpdate / sbInsert / sbDelete，这里自动认。
//
// 一套规则（管理端保存课程、排课里改课程都走这里）：
//   · 框架 = 第一回日期 + 星期 + 回数，跳过全局假期（豁免的除外）和休讲日
//   · 已有的回次（休讲的除外）按先后保留 id / 标题 / 老师，只改日期、回次号；开了单回明细的课也一样——内容和老师按原来的顺序换到新日期上
//   · 回数多了就补新回次，少了就删多出来的最后几回；多出来的回次已有出席 / 作业记录时不删，只提醒
//   · 休讲的回次原样保留，不参与排日期

// 只算不写：返回 { rows:[{id,num,date,src}], surplus:[多出来的回次], cancelled:[休讲回次], err }
function courseSessionPlan(co, sessions) {
  const total = parseInt(co.total_sessions) || 0;
  const list = (sessions || []).slice();
  const active = list.filter(s => !s.is_cancelled)
    .sort((a, b) => (a.session_date || '').localeCompare(b.session_date || '') || ((a.session_number || 0) - (b.session_number || 0)));
  const cancelled = list.filter(s => s.is_cancelled);
  const scan = courseScan({ first_session_date: co.first_session_date, weekdays: co.weekdays, skip_dates: co.skip_dates || '', holiday_except: co.holiday_except || '' }, { total });
  if (!total || scan.dates.length !== total) return { err: `按框架算出 ${scan.dates.length} 个日期、需要 ${total} 个（可能假期太多排不下，或星期设置有误）` };
  return {
    rows: scan.dates.map((d, i) => ({ id: active[i] ? active[i].id : '', num: i + 1, date: d, src: active[i] || null })),
    surplus: active.slice(total), cancelled, dates: scan.dates,
  };
}

const CS_ADMIN = () => typeof sbAll === 'function';
async function csGet(table, q) { return CS_ADMIN() ? sb(`/rest/v1/${table}?${q}`) : sbGet(table, q); }
async function csPatch(table, id, obj) { return CS_ADMIN() ? sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, 'PATCH', obj) : sbUpdate(table, id, obj); }
async function csInsert(table, rows) { return CS_ADMIN() ? sb(`/rest/v1/${table}`, 'POST', rows) : sbInsert(table, rows); }
async function csDelete(table, ids) {
  if (CS_ADMIN()) return sb(`/rest/v1/${table}?id=in.(${ids.map(i => `"${i}"`).join(',')})`, 'DELETE');
  for (const id of ids) await sbDelete(table, id);
}

// 按课程现在的样子重排单回。courseId：课程 id；opts.old：改之前的课程行（用来判断哪些回次的上课时间要跟着改）
// 返回 { dates:[重排后每一回的日期], created, deleted, moved, warnings:[] }
async function courseRegenSessions(courseId, opts) {
  opts = opts || {};
  const co = (await csGet('courses', `select=*&id=eq.${encodeURIComponent(courseId)}&limit=1`))[0];
  if (!co) throw new Error('找不到这门课');
  const sessions = await csGet('course_sessions', `select=*&course_id=eq.${encodeURIComponent(courseId)}&order=session_date.asc&limit=2000`);
  const warnings = [];
  let res;
  if (opts.fieldsOnly) res = await courseSyncSessionFields(co, sessions, opts.old);   // 框架没变：只同步名字 / 校区 / 上课时间，不动日期
  else res = await csRegen(co, sessions, opts, warnings, courseId);
  return res;
}

async function csRegen(co, sessions, opts, warnings, courseId) {
  const plan = courseSessionPlan(co, sessions);
  if (plan.err) throw new Error(plan.err);
  const oldTr = opts.old ? (opts.old.time_range || '') : null;
  const single = (String(co.teacher || '').split(/[\/／,，、]/).map(x => x.trim()).filter(Boolean));
  const teacher = single.length === 1 ? single[0] : '';
  let created = 0, moved = 0, deleted = 0;
  const confirmed = sessions[0] ? !!sessions[0].confirmed : false;
  for (const r of plan.rows) {
    if (r.src) {
      const s = r.src, patch = {};
      if (s.session_date !== r.date) { patch.session_date = r.date; moved++; }
      if (s.session_number !== r.num) patch.session_number = r.num;
      if (s.course_name !== co.name) patch.course_name = co.name;
      if ((s.delivery || null) !== (co.delivery || null)) patch.delivery = co.delivery;
      if ((s.campus || null) !== (co.campus || null)) patch.campus = co.campus;
      // 上课时间：没单独设过的回次（空，或和改之前的课程一样）跟着课程走；单独设过的不动
      if ((s.time_range || '') !== (co.time_range || '') && (!s.time_range || oldTr === null || s.time_range === oldTr)) patch.time_range = co.time_range;
      if (Object.keys(patch).length) await csPatch('course_sessions', s.id, patch);
    } else {
      await csInsert('course_sessions', [{
        id: `s-${Date.now()}-${r.num}-${Math.random().toString(36).slice(2, 4)}`,
        course_id: courseId, course_name: co.name, major: co.major,
        session_date: r.date, session_number: r.num,
        time_range: co.time_range, actual_hours: co.actual_hours,
        delivery: co.delivery, campus: co.campus,
        teacher, session_teacher: teacher, session_title: '',
        confirmed, homework_enabled: co.homework_enabled || false,
      }]);
      created++;
    }
  }
  if (plan.surplus.length) {
    const ids = plan.surplus.map(s => s.id);
    const recs = await csGet('session_records', `select=session_id&session_id=in.(${ids.map(i => `"${i}"`).join(',')})`).catch(() => []);
    const has = new Set((recs || []).map(x => x.session_id));
    const del = plan.surplus.filter(s => !has.has(s.id));
    plan.surplus.filter(s => has.has(s.id)).forEach(s => warnings.push(`${s.session_date} 的课次已有出席 / 作业记录，没有删除（回数比课次少了），请到管理端处理`));
    if (del.length) { await csDelete('course_sessions', del.map(s => s.id)); deleted = del.length; }
  }
  return { dates: plan.dates, created, deleted, moved, warnings };
}

// 框架没变时：只把课程的名字 / 授课形式 / 校区 / 上课时间同步到各回次（单独调过日期的不动）
async function courseSyncSessionFields(co, sessions, old) {
  const oldTr = old ? (old.time_range || '') : null;
  for (const s of sessions) {
    const patch = {};
    if (s.course_name !== co.name) patch.course_name = co.name;
    if ((s.delivery || null) !== (co.delivery || null)) patch.delivery = co.delivery;
    if ((s.campus || null) !== (co.campus || null)) patch.campus = co.campus;
    if ((s.time_range || '') !== (co.time_range || '') && (!s.time_range || oldTr === null || s.time_range === oldTr)) patch.time_range = co.time_range;
    if (Object.keys(patch).length) await csPatch('course_sessions', s.id, patch);
  }
  return { dates: sessions.filter(s => !s.is_cancelled).map(s => s.session_date).sort(), created: 0, deleted: 0, moved: 0, warnings: [] };
}

// 重排前后框架有没有变（星期 / 第一回日期 / 回数 / 假期豁免 / 休讲日）
function courseFrameChanged(a, b) {
  return ['weekdays', 'first_session_date', 'total_sessions', 'holiday_except', 'skip_dates'].some(k => String(a[k] == null ? '' : a[k]) !== String(b[k] == null ? '' : b[k]));
}

// 排课里选期数后要写的字段（和管理端保存课程时一个规则）。sel：__auto__ / __keep__ / __tbd__ / 1月期…
function coursePeriodFields(sel, first, last) {
  if (sel === '__keep__') return {};
  if (sel === '__auto__') {
    const name = autoPeriodOf(first, last);
    return { period: /^\d{4}年\d{1,2}月$/.test(name) ? stripPeriodYear(name) : periodFromDate(first), period_override: name, period_auto: true };
  }
  if (sel === '__tbd__') return { period: null, period_override: null, period_auto: false };
  return { period: sel, period_override: null, period_auto: false };
}

// ── 回数审查（排课·课程管理 / 管理端提醒共用，只算不写）──
// 按「第一回日期 + 周几 + 回数」推算应有的结课日；休讲日 = 课程 skip_dates ＋ 单回里已休讲的日期（单回是实际情况，框架没记也要算进去）。
// 再对照单回，写清「为什么对不上」。co 两边的字段名都认：first_session_date / start_date、total_sessions / sessions。
// 返回 { need, expectedEnd, endNow, process, status, sources:[文字], skips, holidayLive, unrecorded, err }
//   need = 真正要调整：有没休讲的单回落在全局假期里 / 结课日和最后一回不一致 / 单回数和回数不一致 / （没有单回时）推算结课日和课程结课日不同
function courseReviewDetail(co, sessions) {
  const first = co.first_session_date || co.start_date || '';
  const total = parseInt(co.total_sessions != null && co.total_sessions !== '' ? co.total_sessions : co.sessions) || 0;
  const out = { need: false, total, first, endNow: co.end_date || '', expectedEnd: '', process: '', status: '', sources: [], skips: [], holidayLive: [], unrecorded: [], err: '' };
  const wdList = courseWdList(co.weekdays);
  if (!first || !total || !wdList.length) { out.err = '缺开课日 / 回数 / 周几'; return out; }
  const md = d => { const m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? (+m[1]) + '/' + (+m[2]) : String(d || ''); };
  const ses = sessions || [];
  const split = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  const skipRec = new Set(split(co.skip_dates)), except = new Set(split(co.holiday_except));
  const cancelled = [...new Set(ses.filter(x => x.is_cancelled).map(x => x.session_date))].sort();
  const active = ses.filter(x => !x.is_cancelled).sort((a, b) => (a.session_date || '').localeCompare(b.session_date || ''));
  const merged = [...new Set([...skipRec, ...cancelled])];
  const scan = courseScan({ first_session_date: first, weekdays: co.weekdays, skip_dates: merged.join(','), holiday_except: co.holiday_except || '' }, { total });
  if (scan.dates.length !== total) { out.err = '按框架算出 ' + scan.dates.length + ' 个日期、需要 ' + total + ' 个'; return out; }
  out.expectedEnd = scan.dates[total - 1];
  // 推算时跳过的上课日：命中的全局假期（没豁免）＋ 休讲日
  const sk = new Map();
  scan.hits.filter(h => !h.excepted).forEach(h => sk.set(h.date, h.label || '假期'));
  merged.forEach(d => { if (d >= first && d <= out.expectedEnd && wdList.includes(new Date(d + 'T12:00:00').getDay()) && !sk.has(d)) sk.set(d, '休讲'); });
  out.skips = [...sk.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, why]) => ({ date, why }));
  const WN = ['日', '一', '二', '三', '四', '五', '六'];
  out.process = md(first) + ' 起每周' + wdList.slice().sort((a, b) => ((a || 7) - (b || 7))).map(d => WN[d]).join('、') + '，共 ' + total + ' 回'
    + (out.skips.length ? '；跳过 ' + out.skips.map(x => md(x.date) + '（' + x.why + '）').join('、') : '') + ' → 推算最后一回 ' + md(out.expectedEnd);
  if (!out.endNow) out.status = '现在的结课日没填';
  else {
    const diff = Math.round((new Date(out.endNow + 'T12:00:00') - new Date(out.expectedEnd + 'T12:00:00')) / 86400000);
    out.status = '现在的结课日是 ' + md(out.endNow) + (diff === 0 ? '，和推算一致' : '，比推算' + (diff > 0 ? '晚 ' : '早 ') + (Math.abs(diff) % 7 === 0 ? (Math.abs(diff) / 7) + ' 周' : Math.abs(diff) + ' 天'));
  }
  // 差异来源（读单回）
  out.unrecorded = cancelled.filter(d => d >= first && !skipRec.has(d));
  if (out.unrecorded.length) out.sources.push('单回里 ' + out.unrecorded.map(md).join('、') + ' 已休讲，但课程的休讲日里没有记录——框架没记，以单回为准');
  out.holidayLive = active.filter(x => holidayOn(x.session_date) && !except.has(x.session_date)).map(x => ({ date: x.session_date, label: holidayOn(x.session_date).label || '假期', num: x.session_number }));
  if (out.holidayLive.length) out.sources.push(out.holidayLive.map(x => md(x.date) + '（' + x.label + '）').join('、') + ' 这一回还在假期那天，没有休讲——需要休讲并顺延');
  const last = active.length ? active[active.length - 1].session_date : '';
  const endOff = !!(ses.length && out.endNow && last && out.endNow !== last);
  if (endOff) out.sources.push('结课日（' + md(out.endNow) + '）和最后一回的日期（' + md(last) + '）不一致——结课日需要更新');
  const countOff = !!(ses.length && active.length !== total);
  if (countOff) out.sources.push('单回有 ' + active.length + ' 回（不含休讲），课程回数是 ' + total + '——请核对回数');
  if (ses.length && !endOff && !countOff && !out.holidayLive.length && last && last !== out.expectedEnd && !out.unrecorded.length) out.sources.push('单回的日期单独调整过，最后一回是 ' + md(last) + '——以单回为准');
  if (!ses.length && out.endNow && out.endNow !== out.expectedEnd) out.sources.push('这门课还没有单回，只能按框架推算：结课日需要更新为 ' + md(out.expectedEnd));
  if (!out.sources.length) out.sources.push('没有发现差异');
  out.need = out.holidayLive.length > 0 || endOff || countOff || (!ses.length && !!out.endNow && out.endNow !== out.expectedEnd);
  return out;
}
