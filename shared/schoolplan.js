// ══════════════════════════════════
// schoolplan.js — 志望校单所表单（学生端 / 老师端 / 管理端共用，同一张表 student_school_plans）
// spFormHtml(plan, opts)：一所学校的完整表单（可从「出愿学校列表」一键带入）
// spFormCollect(root)：读出表单里的值
// spOpenModal(...)：老师端 / 管理端的添加・编辑弹窗；spDeletePlan(...)：删除并写一条时间线记录
// 依赖：shared/supabase.js、shared/constants.js（SCHOOL_STATUS_LABELS、makeProgressEntry）
// ══════════════════════════════════

const SP_MAX_SCHOOLS = 6;
function spEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// 出愿学校列表 → 下拉选项
function spSharedOptionsHtml(sharedSchools) {
  return (sharedSchools || []).map(s =>
    `<option value="${spEsc(s.id)}" data-name="${spEsc(s.university)}" data-faculty="${spEsc(s.faculty)}" data-dept="${spEsc(s.department)}" data-period="${spEsc(s.application_period)}">${spEsc(s.university)} ${spEsc([s.department, s.course].filter(Boolean).join(' '))}</option>`
  ).join('');
}

// opts: { sharedSchools, gakubu, level（分组时的级别，写在 data-level 上）, idx（第几校）, showLevel（弹窗里显示级别下拉） }
function spFormHtml(p, opts) {
  p = p || {}; opts = opts || {};
  const inp = 'font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:2px;background:var(--surface)';
  const field = (f, ph) => `<input placeholder="${ph}" value="${spEsc(p[f])}" data-field="${f}" style="${inp}">`;
  const lv = opts.level != null ? opts.level : (p.level || 2);
  return `<div class="sp-form" style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:10px;margin-bottom:8px" data-level="${lv}"${opts.idx != null ? ` id="sr_${lv}_${opts.idx}"` : ''}>
      ${opts.idx != null ? `<div style="font-size:10px;font-weight:600;color:var(--text-muted,var(--text-3));margin-bottom:6px">第${opts.idx + 1}校</div>` : ''}
      ${opts.showLevel ? `<select data-field="level" style="${inp};width:100%;margin-bottom:6px">${[[1, '冲刺（挑战）'], [2, '匹配（目标）'], [3, '保底']].map(([v, l]) => `<option value="${v}" ${String(lv) === String(v) ? 'selected' : ''}>级别：${l}</option>`).join('')}</select>` : ''}
      <select onchange="spApplyShared(this)" style="${inp};width:100%;margin-bottom:6px">
        <option value="">— 从共享列表选择 —</option>
        ${spSharedOptionsHtml(opts.sharedSchools)}
      </select>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px">
        ${field('school_name', '学校名 *')}${field('faculty', '研究科')}${field('department', '専攻/コース')}
        ${field('application_period', '出愿时间（精确）')}${field('exam_date', '考试日期')}${field('documents_required', '必要书类（推荐信等）')}
      </div>
      <div style="font-size:10px;color:var(--text-muted,var(--text-3));margin-bottom:4px">👤 教授（每校尽量2位）</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:5px">
        ${field('professor', '教授1姓名')}${field('professor_url', '教授1研究内容URL')}${field('professor2', '教授2姓名')}${field('professor2_url', '教授2研究内容URL')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
        ${field('plan_requirement', opts.gakubu ? '志望理由书要求（字数/格式）' : '计划书要求（字数/格式）')}${field('research_theme', '研究课题（目前方向）')}
      </div>
      <div style="font-size:10px;color:var(--text-muted,var(--text-3));margin:6px 0 4px">📌 该校进度</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">
        <select data-field="status" style="${inp};flex:1;min-width:180px">
          ${Object.entries(SCHOOL_STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${(p.status || 'preparing') === k ? 'selected' : ''}>${v.t}</option>`).join('')}
        </select>
        ${[['kakomon_started', '✏️ 过去问已开始'], ['interview_draft_done', '🎤 面试稿已完成']].map(([f, l]) => {
          const on = !!p[f];
          return `<span onclick="spToggleChip(this)" data-field="${f}" data-on="${on ? 1 : 0}" style="font-size:11px;padding:4px 10px;border-radius:2px;cursor:pointer;user-select:none;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'var(--accent)' : 'var(--surface)'};color:${on ? '#fff' : 'var(--text-secondary,var(--text-2))'}">${l}</span>`;
        }).join('')}
      </div>
      <input type="hidden" value="${spEsc(p.id)}" data-field="id">
    </div>`;
}

// 从出愿学校列表带入（出愿期不自动带入：共享列表多为「8月上旬」类概略值，保留手填的精确日期）
function spApplyShared(sel) {
  if (!sel.value) return;
  const opt = sel.options[sel.selectedIndex];
  const row = sel.closest('.sp-form') || sel.closest('[data-level]');
  if (!row) return;
  const set = (f, v) => { const el = row.querySelector(`[data-field="${f}"]`); if (el) el.value = v; };
  set('school_name', opt.dataset.name || '');
  set('faculty', opt.dataset.faculty || '');
  set('department', opt.dataset.dept || '');
  sel.value = '';
}
function spToggleChip(el) {
  const on = el.dataset.on === '1';
  el.dataset.on = on ? '0' : '1';
  el.style.border = '1px solid ' + (on ? 'var(--border)' : 'var(--accent)');
  el.style.background = on ? 'var(--surface)' : 'var(--accent)';
  el.style.color = on ? 'var(--text-secondary,var(--text-2))' : '#fff';
}

function spFormCollect(root) {
  const get = f => { const el = root.querySelector(`input[data-field="${f}"], select[data-field="${f}"]`); return el ? String(el.value || '').trim() : ''; };
  const chip = f => { const el = root.querySelector(`span[data-field="${f}"]`); return el ? el.dataset.on === '1' : false; };
  return {
    id: get('id'), level: parseInt(get('level') || root.dataset.level || '2') || 2,
    status: get('status') || 'preparing', kakomon_started: chip('kakomon_started'), interview_draft_done: chip('interview_draft_done'),
    school_name: get('school_name'), faculty: get('faculty'), department: get('department'),
    application_period: get('application_period'), exam_date: get('exam_date'),
    professor: get('professor'), professor_url: get('professor_url'), professor2: get('professor2'), professor2_url: get('professor2_url'),
    plan_requirement: get('plan_requirement'), research_theme: get('research_theme'), documents_required: get('documents_required'),
  };
}

// 出愿期间 → 考试季
function spGuessSeason(period) {
  const m = String(period || '').match(/(\d{1,2})\s*月/);
  if (!m) return null;
  const mo = parseInt(m[1]);
  if (mo >= 5 && mo <= 9) return 'summer';
  if (mo >= 10 || mo === 1) return 'winter';
  return 'next_year';
}

// 按学生专业读取出愿学校列表（和学生端一样：学生专业 + 其 key / 名称都去匹配）
function spMajorCands(student) {
  const cands = new Set();
  [student && student.major].filter(Boolean).forEach(v => {
    cands.add(v);
    if (typeof generateMajorKey === 'function') { try { const k = generateMajorKey(v); if (k) cands.add(k); } catch (e) {} }
    if (typeof majorLabel === 'function') { try { const l = majorLabel(v); if (l) cands.add(l); } catch (e) {} }
  });
  return cands;
}
async function spLoadSharedSchools(student) {
  const cands = spMajorCands(student);
  if (!cands.size) return [];
  const inList = [...cands].map(m => `"${String(m).replace(/"/g, '')}"`).join(',');
  const lists = await sb(`/rest/v1/teacher_school_shares?major=in.(${inList})&select=*&order=created_at.desc&limit=3`).catch(() => []);
  const ids = (lists || []).flatMap(sl => sl.school_ids || []);
  if (!ids.length) return [];
  return await sb(`/rest/v1/admission_schools?id=in.(${ids.map(id => `"${id}"`).join(',')})&select=id,university,faculty,department,course,application_period&order=application_period.asc`).catch(() => []) || [];
}

// ── 老师端 / 管理端：添加・编辑弹窗 ──
// opts: { student, plan（编辑时）, plans（这个学生现有的志望校）, onDone(), prefill（可选：出愿数据库的一行 {university, faculty, department}，新增时带入学校名・研究科・専攻） }
let spModalCtx = null;
async function spOpenModal(opts) {
  const { student, plan } = opts;
  if (!plan && (opts.plans || []).length >= SP_MAX_SCHOOLS) { alert(`最多 ${SP_MAX_SCHOOLS} 所志望校，请先删除一所再添加`); return; }
  document.getElementById('spSchoolModal')?.remove();
  const m = document.createElement('div');
  m.id = 'spSchoolModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = `<div style="background:var(--surface);border-radius:6px;padding:18px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">${plan ? '编辑志望校' : '＋ 添加志望校'} — ${spEsc(student.name)}</div>
    <div id="sp_modal_form"><div style="font-size:11px;color:var(--text-3);padding:12px 0">读取出愿学校列表…</div></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
      <button onclick="document.getElementById('spSchoolModal').remove()" style="font-size:12px;background:none;border:1px solid var(--border);border-radius:3px;padding:7px 14px;cursor:pointer;font-family:inherit">取消</button>
      <button id="sp_modal_save" onclick="spModalSave()" style="font-size:12px;background:var(--btn-bg,#efe9e1);color:var(--btn-fg,#3a2e24);border:1px solid var(--btn-bd,#d5c9bb);border-radius:3px;padding:7px 18px;cursor:pointer;font-family:inherit;font-weight:500">保存</button>
    </div>
  </div>`;
  m.onclick = e => { if (e.target === m) m.remove(); };
  document.body.appendChild(m);
  spModalCtx = opts;
  const shared = await spLoadSharedSchools(student);
  const box = document.getElementById('sp_modal_form');
  if (box && spModalCtx === opts) box.innerHTML = spFormHtml(plan || spPrefillPlan(opts.prefill), { sharedSchools: shared, gakubu: (typeof isGakubuStudent === 'function') && isGakubuStudent(student), showLevel: true });
}
function spPrefillPlan(pf) {
  return pf ? { school_name: pf.university || '', faculty: pf.faculty || '', department: pf.department || '' } : {};
}
async function spModalSave() {
  const ctx = spModalCtx; if (!ctx) return;
  const root = document.querySelector('#sp_modal_form .sp-form'); if (!root) return;
  const v = spFormCollect(root);
  if (!v.school_name) { alert('请填写学校名'); return; }
  const { student, plan } = ctx;
  const row = Object.assign({}, v, { exam_season: spGuessSeason(v.application_period) });
  delete row.id;
  const btn = document.getElementById('sp_modal_save'); if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    if (plan) {
      await sb(`/rest/v1/student_school_plans?id=eq.${encodeURIComponent(plan.id)}`, 'PATCH', row);
      Object.assign(plan, row);
    } else {
      const cur = await sb(`/rest/v1/student_school_plans?student_id=eq.${encodeURIComponent(student.id)}&select=id`).catch(() => ctx.plans || []);
      if ((cur || []).length >= SP_MAX_SCHOOLS) throw new Error(`最多 ${SP_MAX_SCHOOLS} 所志望校，请先删除一所再添加`);
      Object.assign(row, { id: `ssp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, student_id: student.id, student_name: student.name, major: student.major || '' });
      await sb('/rest/v1/student_school_plans', 'POST', row);
    }
    document.getElementById('spSchoolModal')?.remove();
    spModalCtx = null;
    if (ctx.onDone) ctx.onDone();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '保存'; }
    alert('保存失败：' + e.message);
  }
}

// 删除时写进时间线的文字：删除志望校：東京大学 · 総合文化研究科 · ○○専攻（原进度：准备中）
function spDeleteNote(p) {
  const st = (SCHOOL_STATUS_LABELS[p.status || 'preparing'] || {}).t || p.status || '';
  return `删除志望校：${[p.school_name, p.faculty, p.department].filter(Boolean).join(' · ')}${st ? `（原进度：${st}）` : ''}`;
}
function spDeleteLog(student, p, source, sourceName) {
  const entry = makeProgressEntry({ studentId: student.id, studentName: student.name, major: student.major, source, sourceName, notes: spDeleteNote(p), recordedAt: new Date().toISOString().slice(0, 10) });
  return sb('/rest/v1/student_progress_timeline', 'POST', entry).then(() => entry).catch(() => null);
}
// 老师端 / 管理端删除一所志望校（确认框写出学校名）
async function spDeletePlan(student, p, source, sourceName, onDone) {
  const name = [p.school_name, p.faculty, p.department].filter(Boolean).join(' · ');
  if (!confirm(`删除志望校「${name}」？\n学生端也会同步删除，考学进度时间线里会留下一条删除记录。`)) return;
  try {
    await sb(`/rest/v1/student_school_plans?id=eq.${encodeURIComponent(p.id)}`, 'DELETE');
    await spDeleteLog(student, p, source, sourceName);
    if (onDone) onDone();
  } catch (e) { alert('删除失败：' + e.message); }
}

// 面谈时选了「已择校」但还没有志望校：提醒（bookings = 这个学生的面谈预约，按日期新→旧）
function spChosenWarnHtml(bookings, planCount, addJs) {
  if (planCount) return '';
  const last = (bookings || []).find(b => String(b.target_school || '').trim());
  if (!last || String(last.target_school).trim() !== '已择校') return '';
  const d = String(last.slot_date || '');
  const md = /^\d{4}-\d{2}-\d{2}/.test(d) ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : d;
  return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fdf1e6;border:1px solid #e8c9a8;border-radius:3px;padding:7px 10px;margin-bottom:8px;font-size:11px;color:#a0521a">
    <span>⚠ 学生面谈时选了「已择校」${md ? `（${md}）` : ''}，但还没有填写志望校</span>
    <button onclick="event.stopPropagation();${addJs}" style="margin-left:auto;font-size:10px;background:#a0521a;color:#fff;border:none;border-radius:2px;padding:3px 10px;cursor:pointer;font-family:inherit">＋ 添加志望校</button>
  </div>`;
}


// ══════════════════════════════════
// 目标学校 → 出愿数据库找学校 → 加入志望校（管理端、老师端考学进度卡片共用）
// 学生档案「目标学校」是一段自由文本；这里从文本里认出出愿数据库里出现过的大学。
// 步骤：只拉大学名清单（去重）来比对 → 比上的几所再按大学名查出愿数据（不把整张表拉下来）
// ══════════════════════════════════

// 简体 / 繁体 → 日文常用字（比对前文本和大学名都统一成这一套）
const SP_CHAR_MAP = (() => {
  const pairs = '东東 稻稲 庆慶 应應 応應 桥橋 学学 學学 国国 國国 医医 醫医 艺芸 藝芸 术術 际際 经経 經経 济済 濟済 总総 總総 综総 綜総 业業 關関 关関 馆館 义義 习習 广広 廣広 岛島 户戸 戶戸 滨浜 濱浜 橫横 叶葉 数数 數数 体体 體体 会会 會会 师師 范範 电電 机機 药薬 藥薬 农農 环環 产産 创創 资資 与与 对対 對対 实実 實実 传伝 傳伝 边辺 邊辺 齐斉 齊斉 台台 臺台 圣聖 聖聖 圆円 圓円 渊淵 浅浅 泽沢 澤沢 区区 區区 辞辞 辭辞 乐楽 樂楽 画画 畫画 当当 當当 种種 觉覚 覺覚 测測 測測 视視 號号 号号 礼礼 禮礼 来来 來来 单単 單単 双双 雙双 兴興 興興 竞競 競競 计計 計計 设設 設設 语語 語語 运運 運運 动動 動動 历歴 歷歴 史史 压圧 壓圧 营営 營営 违違 訳訳 译訳 譯訳 摄摂 攝摂 圣聖'.split(/\s+/);
  const m = {};
  pairs.forEach(p => { if (p.length === 2) m[p[0]] = p[1]; });
  return m;
})();
function spNormName(v) {
  return String(v == null ? '' : v).normalize('NFKC').replace(/[\s\u3000]+/g, '').toLowerCase()
    .replace(/[\u3400-\u9fff]/g, ch => SP_CHAR_MAP[ch] || ch);
}
// 简称 → 全称（只写出愿数据库里可能有的大学；全称不在数据库里就自动忽略）
const SP_UNIV_ALIAS = {
  '一橋': '一橋大学', '東大': '東京大学', '京大': '京都大学', '阪大': '大阪大学', '名大': '名古屋大学', '北大': '北海道大学',
  '九大': '九州大学', '東北': '東北大学', '東工大': '東京工業大学', '東京工大': '東京工業大学', '東外大': '東京外国語大学', '東京外大': '東京外国語大学',
  '外大': '東京外国語大学', '早大': '早稲田大学', '早稲田': '早稲田大学', '慶大': '慶應義塾大学', '慶應': '慶應義塾大学', '慶應大': '慶應義塾大学',
  '上智': '上智大学', '明治': '明治大学', '法政': '法政大学', '立教': '立教大学', '中央': '中央大学', '青学': '青山学院大学', '青山': '青山学院大学',
  '学習院': '学習院大学', '同志社': '同志社大学', '立命館': '立命館大学', '関学': '関西学院大学', '関大': '関西大学', '筑波': '筑波大学',
  '神戸': '神戸大学', '横国': '横浜国立大学', '千葉': '千葉大学', '都立': '東京都立大学', '首都大': '東京都立大学', '芸大': '東京藝術大学',
  '東京芸大': '東京藝術大学', '医科歯科': '東京医科歯科大学', 'お茶大': 'お茶の水女子大学', 'お茶の水': 'お茶の水女子大学', 'icu': '国際基督教大学',
  '日大': '日本大学', '東洋': '東洋大学', '専修': '専修大学', '広島': '広島大学', '北海道': '北海道大学', '名古屋': '名古屋大学',
};
let spUnivNamesCache = null;
// 出愿数据库里的大学名清单（去重；只拉一列，且整个页面只拉一次）
function spLoadUnivNames() {
  if (!spUnivNamesCache) {
    spUnivNamesCache = sbAll('/rest/v1/admission_schools?select=university&order=id.asc').then(rows => {
      const set = new Set();
      (rows || []).forEach(r => { const u = String(r.university || '').trim(); if (u) set.add(u); });
      return [...set];
    }).catch(e => { spUnivNamesCache = null; throw e; });
  }
  return spUnivNamesCache;
}
// 从文本里认出大学：返回出愿数据库里的大学名（原写法）。找到的部分会从文本里划掉，避免「東京大学」里的「京大」再被认成京都大学
function spMatchUniversities(text, univNames) {
  const byKey = new Map();
  (univNames || []).forEach(u => { const k = spNormName(u); if (k) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(u); } });
  let T = spNormName(text);
  if (!T) return [];
  const hit = new Set();
  const take = (key, via) => {
    if (!key || !T.includes(key)) return;
    T = T.split(key).join('\u0000');
    (byKey.get(via) || []).forEach(u => hit.add(u));
  };
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length);
  keys.forEach(k => take(k, k));                                                       // 1. 全称
  keys.map(k => [k.replace(/大学$/, ''), k]).filter(([st, k]) => st !== k && st.length >= 3)
    .sort((a, b) => b[0].length - a[0].length).forEach(([st, k]) => take(st, k));      // 2. 去掉「大学」的名字（3 个字以上才算）
  Object.entries(SP_UNIV_ALIAS).filter(([, full]) => full).map(([a, full]) => [spNormName(a), spNormName(full)])
    .filter(([, full]) => byKey.has(full)).sort((a, b) => b[0].length - a[0].length).forEach(([a, full]) => take(a, full));   // 3. 简称
  return [...hit];
}

const SP_FIND = {};      // 学生id → { loading, err, matched:[大学名], rows:[出愿数据库的行], open:Set(其他专业展开的大学名) }
const SP_FIND_CTX = {};  // 学生id → { s, plans, h }（卡片每次重绘时更新）
function spJs(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

// 考学进度卡片里的「目标学校」框（学生档案没写目标学校时返回空）。h = 卡片的 { schoolAdd } 函数名
function spTargetBoxHtml(s, plans, h) {
  const txt = String((s && s.target_school) || '').trim();
  if (!txt) return '';
  SP_FIND_CTX[s.id] = { s, plans: plans || [], h: h || {} };
  const id = spJs(s.id);
  return `<div style="background:var(--bg);border:1px solid var(--border-light);border-radius:3px;padding:8px 10px;margin-bottom:8px">
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="flex:1;min-width:0"><div style="font-size:10px;color:var(--text-3);margin-bottom:3px">目标学校（学生档案里写的）</div>
        <div style="font-size:11px;color:var(--text-2);white-space:pre-wrap;word-break:break-all;line-height:1.6">${spEsc(txt)}</div></div>
      <button class="pgc-btn" style="flex-shrink:0" onclick="event.stopPropagation();spFindRun('${id}')">从出愿数据库找学校</button>
    </div>
    <div id="spfind_${spEsc(s.id)}" onclick="event.stopPropagation()">${spFindResultHtml(s.id)}</div>
  </div>`;
}

async function spFindRun(sid) {
  const ctx = SP_FIND_CTX[sid]; if (!ctx) return;
  SP_FIND[sid] = { loading: true, open: new Set() };
  spFindRefresh(sid);
  try {
    const names = await spLoadUnivNames();
    const matched = spMatchUniversities(ctx.s.target_school, names);
    let rows = [];
    if (matched.length) {
      const inList = matched.map(u => `"${u.replace(/"/g, '')}"`).join(',');
      rows = await sbAll(`/rest/v1/admission_schools?university=in.(${encodeURIComponent(inList)})&select=id,major,university,faculty,department,course&order=id.asc`);
    }
    SP_FIND[sid] = { matched, rows: rows || [], open: new Set() };
  } catch (e) { SP_FIND[sid] = { err: e.message || String(e), open: new Set() }; }
  spFindRefresh(sid);
}
function spFindRefresh(sid) {
  const el = document.getElementById('spfind_' + sid);
  if (el) el.innerHTML = spFindResultHtml(sid);
}
function spFindToggle(sid, ui) {
  const st = SP_FIND[sid]; if (!st) return;
  if (st.open.has(ui)) st.open.delete(ui); else st.open.add(ui);
  spFindRefresh(sid);
}

function spFindResultHtml(sid) {
  const st = SP_FIND[sid], ctx = SP_FIND_CTX[sid];
  if (!st || !ctx) return '';
  const wrap = inner => `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-light)">${inner}</div>`;
  if (st.loading) return wrap('<span style="font-size:11px;color:var(--text-3)">查找中…</span>');
  if (st.err) return wrap(`<span style="font-size:11px;color:var(--danger)">查找失败：${spEsc(st.err)}</span>`);
  if (!st.matched.length) return wrap('<span style="font-size:11px;color:var(--text-3)">没认出出愿数据库里的学校，可以直接点「＋ 添加志望校」手动加</span>');
  const cands = spMajorCands(ctx.s), plans = ctx.plans || [];
  const n = v => adgNorm(spNormName(v));
  const inPlans = r => plans.some(p => n(p.school_name) === n(r.university) && n(p.faculty) === n(r.faculty)
    && (n(p.department) === n(r.department) || n(p.department) === n([r.department, r.course].filter(Boolean).join(' '))));
  st.flat = [];
  const jsId = spJs(sid);
  const line = (r, showMajor) => {
    const idx = st.flat.push({ university: r.university, faculty: r.faculty || '', department: [r.department, r.course].filter(x => adgNorm(x)).join(' ') }) - 1;
    const label = [r.faculty, r.department, r.course].filter(x => adgNorm(x)).map(spEsc).join(' · ') || '（未分研究科）';
    const mj = showMajor ? `<span style="color:var(--text-3);margin-right:6px">[${spEsc((typeof majorLabel === 'function' && majorLabel(r.major)) || r.major)}]</span>` : '';
    const act = inPlans(r) ? '<span style="font-size:10px;color:var(--ok)">已在志望校</span>'
      : `<button class="pgc-btn" style="font-size:10px;padding:2px 8px" onclick="event.stopPropagation();spFindAdd('${jsId}',${idx})">加入志望校</button>`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px;border-bottom:1px solid var(--border-light)"><span style="flex:1;min-width:0">${mj}${label}</span>${act}</div>`;
  };
  const groups = u => {   // 同一所大学内按 adgGroupKey 归并
    const m = new Map();
    st.rows.filter(r => r.university === u).forEach(r => { const k = adgGroupKey(r); if (!m.has(k)) m.set(k, r); });
    return [...m.values()].sort((a, b) => [a.faculty, a.department, a.course].join('|').localeCompare([b.faculty, b.department, b.course].join('|'), 'ja'));
  };
  const html = st.matched.map(u => {
    const all = groups(u), own = all.filter(r => cands.has(r.major)), other = all.filter(r => !cands.has(r.major));
    const open = st.open.has(u), ju = spJs(u);
    return `<div style="margin-bottom:10px">
      <span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 10px;border:1px solid var(--accent);border-radius:10px;color:var(--accent);margin-bottom:4px">${spEsc(u)}</span>
      ${own.length ? own.map(r => line(r, false)).join('') : '<div style="font-size:11px;color:var(--text-3);padding:2px 0">本专业暂时没有这所学校的出愿数据</div>'}
      ${other.length ? `<div style="margin-top:4px"><span onclick="event.stopPropagation();spFindToggle('${jsId}','${ju}')" style="font-size:10px;color:var(--accent);cursor:pointer">其他专业 ${other.length} ${open ? '▲' : '▼'}</span>${open ? other.map(r => line(r, true)).join('') : ''}</div>` : ''}
    </div>`;
  }).join('');
  return wrap(html);
}
function spFindAdd(sid, idx) {
  const st = SP_FIND[sid], ctx = SP_FIND_CTX[sid];
  if (!st || !ctx || !st.flat || !st.flat[idx]) return;
  const fn = ctx.h && window[ctx.h.schoolAdd];
  if (typeof fn === 'function') fn(sid, st.flat[idx]);
}
