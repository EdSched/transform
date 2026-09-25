// ══════════════════════════════════
// shared/claim.js — 面谈预约「认领」
// 没有绑定学生（student_id 为空）的预约，在确认前先认领：
//   已有学生：搜索并选中 → 预约挂到他名下（写 student_id，姓名改成档案姓名）
//   新学生：建档 → issue_student_code 生成查询码 → 登记首次进度 → 回写 student_id → 大字显示查询码
// 老师端 confirmBookingTeacher、管理端 confirmBooking 与「未关联记录」共用。
// 依赖：shared/supabase.js（sb）、shared/constants.js（MAJORS / MAJOR_GROUPS / allMajorKeys / makeProgressEntry / mapJapaneseScore / mapEnglishScore）
// ══════════════════════════════════

function clEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function clMajorLabel(k) { return (typeof MAJORS !== 'undefined' && MAJORS[k]) || k || ''; }

// 专业规则：students.major 必须是真实专业，绝不写入 shakai_group 这类分组代码
//   预约 major 是分组 → 下拉只列组内成员、不预选；是真实专业 → 预选它；其他 → 列全部、不预选
function clMajorChoices(bkMajor) {
  const groups = (typeof MAJOR_GROUPS !== 'undefined') ? MAJOR_GROUPS : {};
  if (groups[bkMajor]) return { options: groups[bkMajor].slice(), preselect: '' };
  const all = (typeof allMajorKeys === 'function') ? allMajorKeys() : Object.keys(MAJORS || {}).filter(k => !groups[k]);
  if (bkMajor && all.includes(bkMajor)) return { options: all, preselect: bkMajor };
  return { options: all, preselect: '' };
}
// 「已有学生」搜索范围：分组 → 组内成员专业；真实专业 → 该专业；其他 → 不限（仍只在可见学生里）
function clSearchMajors(bkMajor) {
  const groups = (typeof MAJOR_GROUPS !== 'undefined') ? MAJOR_GROUPS : {};
  if (groups[bkMajor]) return groups[bkMajor].slice();
  if (bkMajor && typeof MAJORS !== 'undefined' && MAJORS[bkMajor]) return [bkMajor];
  return null;
}

// 预约里学生自填的进度 → 首条进度时间线（沿用 student.js 的 makeProgressEntry 写法）
function clProgressEntry(b, student) {
  const planMap = {
    '已完成': '已完成', '待修改': '修改中', '收集先行研究中': '收集资料中', '已定好方向': '收集资料中', '未开始': '未开始',
    '尚未开始': '未开始', '初步构思阶段': '收集资料中', '草稿撰写中': '撰写中', '已完成初稿': '修改中', '已定稿': '已完成',
  };
  const applyMap = {
    '已出愿': '已出愿', '出愿中': '材料准备中', '准备材料中': '材料准备中',
    '尚未确认志望校': '择校确认中', '正在确认志望校': '择校确认中', '已确认志望校': '联系教授中', '正在准备出愿材料': '材料准备中',
  };
  const ja = b.japanese_score || '', en = b.english_score || '';
  return makeProgressEntry({
    studentId: student.id, studentName: student.name, major: student.major,
    source: 'student', sourceName: student.name, bookingId: b.id,
    japanese: (typeof mapJapaneseScore === 'function') ? mapJapaneseScore(ja) : '',
    english: (typeof mapEnglishScore === 'function') ? mapEnglishScore(en) : '',
    plan: planMap[b.plan_status] || '',
    apply: applyMap[b.application_status] || ({ '已择校': '联系教授中', '择校中': '择校确认中' }[b.target_school] || ''),
    notes: [b.exam_period ? `出愿期：${b.exam_period}` : '', ja ? `日语：${ja}` : '', en ? `英语：${en}` : '', b.target_school ? `目标：${b.target_school}` : ''].filter(Boolean).join('　'),
  });
}

// 把一组预约挂到某学生名下；数据库 0 行被改（权限拦截）时报错
async function clLinkBookings(ids, student) {
  const rows = await sb(`/rest/v1/bookings?id=in.(${ids.map(x => `"${x}"`).join(',')})`, 'PATCH', { student_id: student.id, name: student.name });
  if (Array.isArray(rows) && rows.length < ids.length) throw new Error(`只有 ${rows.length}/${ids.length} 条预约被更新，数据库没有允许修改其余记录`);
}

let clState = null; // { booking, ids, students, resolve, mode, created }

// booking：要认领的预约（取姓名、专业、进度信息）
// opts.students：当前操作人能看到的学生 [{id,name,major,...}]
// opts.bookingIds：一起挂靠的预约 id（默认只有这一条）
// opts.searchAll：true 时「已有学生」不按专业限制搜索范围（管理端合并工具用）
// opts.title：标题（默认「这位是新学生吗？」）
// 返回 Promise：{ student_id, name, major, created, code } 或 null（取消）
function openBookingClaim(booking, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    document.getElementById('clOverlay')?.remove();
    clState = {
      booking, resolve, mode: '', created: null,
      ids: (opts.bookingIds && opts.bookingIds.length) ? opts.bookingIds : [booking.id],
      students: opts.students || [],
      searchMajors: opts.searchAll ? null : clSearchMajors(booking.major),
    };
    const ov = document.createElement('div');
    ov.id = 'clOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow-y:auto';
    ov.innerHTML = `<div id="clBox" style="background:var(--surface,#fff);border-radius:6px;padding:18px 20px;max-width:520px;width:100%;color:var(--text,#1a1814)"></div>`;
    document.body.appendChild(ov);
    clRender(opts.title);
  });
}

function clClose(result) {
  const st = clState;
  document.getElementById('clOverlay')?.remove();
  clState = null;
  if (st) st.resolve(result || null);
}

function clRender(title) {
  const st = clState, b = st.booking, box = document.getElementById('clBox');
  if (!box) return;
  if (title) st.title = title;
  const card = (mode, head, desc) => `<div onclick="clPick('${mode}')" style="flex:1;min-width:180px;cursor:pointer;border:1px solid ${st.mode === mode ? 'var(--accent,#5a3e28)' : 'var(--border,#e2ded6)'};background:${st.mode === mode ? 'var(--accent-light,#f5ede3)' : 'var(--surface,#fff)'};border-radius:4px;padding:10px 12px">
      <div style="font-size:13px;font-weight:600;color:${st.mode === mode ? 'var(--accent,#5a3e28)' : 'inherit'}">${head}</div>
      <div style="font-size:11px;color:var(--text-3,#9a9590);margin-top:2px;line-height:1.6">${desc}</div>
    </div>`;
  const cnt = st.ids.length > 1 ? `（共 ${st.ids.length} 条预约）` : '';
  box.innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px">
      <div style="font-size:15px;font-weight:600">${clEsc(st.title || '这位是新学生吗？')}</div>
      <button onclick="clClose(null)" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-3,#9a9590)">×</button>
    </div>
    <div style="font-size:11px;color:var(--text-3,#9a9590);margin-bottom:12px">预约姓名「${clEsc(b.name)}」· ${clEsc(b.slot_date || '')} ${clEsc(b.slot_time_range || '')} · ${clEsc(clMajorLabel(b.major) || '未填专业')}${cnt}<br>这条预约还没有关联学生档案，确认前请先认领。</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${card('existing', '已有学生', '已有档案（比如名字写成了日语汉字），搜索并选中本人')}
      ${card('new', '新学生', '建立档案并生成查询码，当面交给学生')}
    </div>
    <div id="clPanel">${st.mode === 'existing' ? clExistingHtml() : st.mode === 'new' ? clNewHtml() : ''}</div>
    <div id="clMsg" style="font-size:11px;color:var(--danger,#b03030);min-height:14px;margin-top:6px"></div>`;
  if (st.mode === 'existing') clSearch();
}

function clPick(mode) { clState.mode = mode; clRender(); }

function clExistingHtml() {
  const st = clState;
  const scope = st.searchMajors ? `搜索范围：${st.searchMajors.map(clMajorLabel).join('・')}` : '搜索范围：你能看到的全部学生';
  return `<input id="clQ" value="${clEsc(st.booking.name)}" oninput="clSearch()" placeholder="输入姓名（可部分匹配）" style="width:100%;font-size:13px;padding:7px 9px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--bg,#f7f5f0);font-family:inherit">
    <div style="font-size:10px;color:var(--text-3,#9a9590);margin:4px 0 6px">${clEsc(scope)}</div>
    <div id="clResults" style="max-height:260px;overflow-y:auto;border:1px solid var(--border-light,#ede9e2);border-radius:3px"></div>`;
}

function clSearch() {
  const st = clState, el = document.getElementById('clResults');
  if (!st || !el) return;
  const q = (document.getElementById('clQ')?.value || '').trim();
  let list = st.students.filter(s => !st.searchMajors || st.searchMajors.includes(s.major));
  if (q) {
    list = list.filter(s => (s.name || '').includes(q) || q.includes(s.name || '\u0000')
      || (typeof matchesPinyin === 'function' && matchesPinyin(s.name || '', q)));
  }
  list = list.slice(0, 40);
  el.innerHTML = list.length ? list.map(s => `<div onclick="clChooseExisting('${clEsc(s.id)}')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border-light,#ede9e2);cursor:pointer" onmouseover="this.style.background='var(--accent-light,#f5ede3)'" onmouseout="this.style.background=''">
      <span style="font-size:13px;font-weight:600">${clEsc(s.name)}</span>
      <span style="font-size:11px;color:var(--text-3,#9a9590)">${clEsc(clMajorLabel(s.major))}</span>
      ${s.student_code ? '' : '<span style="font-size:10px;color:var(--warn,#b87820)">未生成查询码</span>'}
      <span style="margin-left:auto;font-size:11px;color:var(--accent,#5a3e28)">选择 →</span>
    </div>`).join('') : '<div style="font-size:11px;color:var(--text-3,#9a9590);padding:12px;text-align:center">没有找到匹配的学生，可换个写法搜索，或选择「新学生」建档</div>';
}

async function clChooseExisting(id) {
  const st = clState;
  const s = st.students.find(x => x.id === id);
  if (!s) return;
  if (!confirm(`把这${st.ids.length > 1 ? ` ${st.ids.length} 条` : '条'}预约挂到「${s.name}」（${clMajorLabel(s.major)}）名下？\n预约姓名会改成档案姓名。`)) return;
  const msg = document.getElementById('clMsg');
  try {
    if (msg) { msg.style.color = 'var(--text-3,#9a9590)'; msg.textContent = '保存中…'; }
    await clLinkBookings(st.ids, s);
    clClose({ student_id: s.id, name: s.name, major: s.major, created: false });
  } catch (e) { if (msg) { msg.style.color = 'var(--danger,#b03030)'; msg.textContent = '保存失败：' + e.message; } }
}

function clNewHtml() {
  const st = clState, ch = clMajorChoices(st.booking.major);
  const inp = 'width:100%;font-size:13px;padding:7px 9px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--bg,#f7f5f0);font-family:inherit';
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div><div style="font-size:10px;color:var(--text-3,#9a9590);margin-bottom:2px">姓名（可修改为中文真实姓名）</div><input id="clName" value="${clEsc(st.booking.name)}" style="${inp}"></div>
      <div><div style="font-size:10px;color:var(--text-3,#9a9590);margin-bottom:2px">专业</div>
        <select id="clMajor" style="${inp}">
          <option value="">${ch.preselect ? '' : '请选择专业'}</option>
          ${ch.options.map(k => `<option value="${clEsc(k)}" ${k === ch.preselect ? 'selected' : ''}>${clEsc(clMajorLabel(k))}</option>`).join('')}
        </select></div>
    </div>
    <div style="font-size:10px;color:var(--text-3,#9a9590);margin-bottom:10px;line-height:1.6">建档后会自动生成查询码，并把预约里填写的出愿期、计划书状态、日语/英语等登记为首条进度。</div>
    <button id="clCreateBtn" onclick="clCreate()" style="width:100%;font-size:13px;background:var(--accent,#5a3e28);color:#fff;border:none;border-radius:3px;padding:9px;cursor:pointer;font-family:inherit">建档并生成查询码</button>`;
}

async function clCreate() {
  const st = clState, b = st.booking;
  const name = (document.getElementById('clName')?.value || '').trim();
  const major = document.getElementById('clMajor')?.value || '';
  const msg = document.getElementById('clMsg'), btn = document.getElementById('clCreateBtn');
  const say = (t, err) => { if (msg) { msg.style.color = err ? 'var(--danger,#b03030)' : 'var(--text-3,#9a9590)'; msg.textContent = t; } };
  if (!name) { say('请填写姓名', true); return; }
  if (!major) { say('请选择专业（学生的真实专业，不能是分组）', true); return; }
  if (typeof MAJOR_GROUPS !== 'undefined' && MAJOR_GROUPS[major]) { say('请选择具体专业，不能是分组', true); return; }
  const dup = st.students.find(s => s.name === name);
  if (dup && !confirm(`已有同名学生「${name}」（${clMajorLabel(dup.major)}）。\n如果就是本人，请改用「已有学生」。确定还要新建一份档案吗？`)) return;
  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
  try {
    // 1. 建档（id 规则与学生档案录入一致）
    say('正在建立档案…');
    const student = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, major, status: 'active' };
    await sb('/rest/v1/students', 'POST', student);
    st.created = student;
    // 2. 生成查询码（服务端函数：写 students.student_code + student_login，自动建登录账号）
    say('正在生成查询码…');
    let code = '', codeErr = '';
    try {
      const r = await sb('/rest/v1/rpc/issue_student_code', 'POST', { p_student_id: student.id });
      code = Array.isArray(r) ? (r[0] || '') : (r || '');
      if (typeof code === 'object' && code) code = code.issue_student_code || '';
    } catch (e) { codeErr = e.message; }
    // 3. 首条进度（失败不阻断）
    try {
      const entry = clProgressEntry(b, student);
      if (entry.japanese || entry.english || entry.plan || entry.apply || entry.notes) await sb('/rest/v1/student_progress_timeline', 'POST', entry);
    } catch (e) { /* 进度登记失败不影响认领 */ }
    // 4. 预约挂到新档案
    say('正在关联预约…');
    await clLinkBookings(st.ids, student);
    student.student_code = code;
    clShowCode(student, code, codeErr);
  } catch (e) {
    say((st.created ? `档案「${st.created.name}」已建立，但后续步骤失败：` : '建档失败：') + e.message, true);
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

function clShowCode(student, code, codeErr) {
  const box = document.getElementById('clBox');
  const result = { student_id: student.id, name: student.name, major: student.major, created: true, code, student };
  clState.result = result;
  box.innerHTML = `
    <div style="font-size:15px;font-weight:600;margin-bottom:6px">已为「${clEsc(student.name)}」建档</div>
    <div style="font-size:11px;color:var(--text-3,#9a9590);margin-bottom:14px">${clEsc(clMajorLabel(student.major))} · 预约已关联到该档案</div>
    ${code ? `<div style="text-align:center;background:var(--bg,#f7f5f0);border:1px solid var(--border,#e2ded6);border-radius:6px;padding:18px 10px;margin-bottom:12px">
        <div style="font-size:12px;color:var(--text-2,#5a5650);margin-bottom:6px">查询码</div>
        <div style="font-size:36px;font-weight:700;letter-spacing:8px;font-family:'DM Mono',monospace;color:var(--accent,#5a3e28)">${clEsc(code)}</div>
        <div style="font-size:13px;margin-top:8px">请交给学生，下次用它登录</div>
      </div>`
      : `<div style="background:#fdf2dc;border:1px solid var(--warn,#b87820);border-radius:4px;padding:10px 12px;font-size:12px;color:#6a5210;margin-bottom:12px">档案已建立，但查询码没有生成成功${codeErr ? `（${clEsc(codeErr.slice(0, 120))}）` : ''}。请联系管理员在「学生档案」里为该学生生成查询码。</div>`}
    <button onclick="clClose(clState.result)" style="width:100%;font-size:13px;background:var(--accent,#5a3e28);color:#fff;border:none;border-radius:3px;padding:9px;cursor:pointer;font-family:inherit">完成</button>`;
}
