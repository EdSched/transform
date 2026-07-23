// ══════════════════════════════════
// teacher-homework.js — 作业批改（需 homework 权限）
// 学生逐题提交（文字 / 按题号照片）→ 老师端按题号整合成一页：题目 + 文字答案 + 顺序排列的照片
// 可打印保存 PDF 后手写批注，或直接在页面填写反馈（支持上传批改后的 Word）
// 依赖：shared/constants.js、shared/supabase.js、teacher.js（须在其后加载）
// ══════════════════════════════════
let thwSessions = null;   // 有作业的课次
let thwSubs = {};         // session_id → 提交数组
let thwOpenSession = null;
let thwOpenStudent = null;

function thwEsc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

async function renderHomeworkFeedback(mc) {
  const p = teacherData.permissions || {};
  const myCourses = p.homework_courses || [];
  mc.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const q = myCourses.length
      ? `/rest/v1/course_sessions?homework_enabled=is.true&course_name=in.(${myCourses.map(c=>`"${c}"`).join(',')})&select=*&order=session_date.desc&limit=300`
      : `/rest/v1/course_sessions?homework_enabled=is.true&select=*&order=session_date.desc&limit=300`;
    const sessions = await sb(q);
    thwSessions = (sessions || []).filter(s => {
      const q = s.homework_questions;
      return Array.isArray(q) ? q.length : !!(q && q.levels && q.levels.length);
    });
    const ids = thwSessions.map(s => s.id);
    thwSubs = {};
    for (let i = 0; i < ids.length; i += 40) {
      const batch = await sb(`/rest/v1/homework_submissions?session_id=in.(${ids.slice(i,i+40).map(x=>`"${x}"`).join(',')})&select=*&order=submitted_at.asc`).catch(() => []);
      (batch || []).forEach(x => { (thwSubs[x.session_id] = thwSubs[x.session_id] || []).push(x); });
    }
  } catch (e) { mc.innerHTML = `<div class="empty">加载失败：${e.message}</div>`; return; }
  thwRender();
}

function thwRender() {
  const mc = document.getElementById('mainContent');
  if (!mc) return;
  if (!thwSessions.length) {
    mc.innerHTML = '<div class="empty">暂无布置作业的课次<br><span style="font-size:11px">作业由教务在课程安排的单回中布置</span></div>';
    return;
  }
  mc.innerHTML = `
  <div class="page-header"><div class="section-title">📝 作业批改</div></div>
  <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
    <div style="flex:0 0 250px;min-width:220px;max-height:74vh;overflow-y:auto;background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:8px">
      ${thwSessions.map(s => {
        const subs = thwSubs[s.id] || [];
        const ungraded = subs.filter(x => !x.teacher_feedback).length;
        const sel = thwOpenSession === s.id;
        return `<div onclick="thwOpenSession='${s.id}';thwOpenStudent=null;thwRender()" style="cursor:pointer;padding:7px 10px;border:1px solid ${sel?'var(--accent)':'transparent'};background:${sel?'var(--accent-light,#f5ede3)':'transparent'};border-radius:3px;margin-bottom:3px">
          <div style="font-size:12px;font-weight:600">${thwEsc(s.course_name||'')}${s.session_number?` 第${s.session_number}回`:''}</div>
          <div style="font-size:9px;color:var(--text-3)">${s.session_date||''} · 提交 ${subs.length}${ungraded?` · <span style="color:var(--warn,#b8860b)">待批 ${ungraded}</span>`:''}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="flex:1 1 460px;min-width:0" id="thw_main">${thwMainHtml()}</div>
  </div>`;
}

function thwMainHtml() {
  if (!thwOpenSession) return '<div style="text-align:center;padding:60px 20px;color:var(--text-3);font-size:12px;border:1px dashed var(--border);border-radius:4px">← 从左侧选择课次</div>';
  const s = thwSessions.find(x => x.id === thwOpenSession);
  const subs = thwSubs[thwOpenSession] || [];
  if (!subs.length) return `<div style="text-align:center;padding:50px 20px;color:var(--text-3);font-size:12px;border:1px dashed var(--border);border-radius:4px">${thwEsc(s.course_name||'')} 第${s.session_number||''}回<br>暂无学生提交</div>`;

  if (!thwOpenStudent) {
    return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:12px 14px">
      <div style="font-size:12px;font-weight:600;margin-bottom:2px">${thwEsc(s.course_name||'')} 第${s.session_number||''}回</div>
      <div style="font-size:10px;color:var(--text-3);margin-bottom:10px">${s.session_date||''}${s.session_title?' · '+thwEsc(s.session_title):''} · 共 ${subs.length} 份提交</div>
      <button onclick="thwPrintAll()" style="font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:6px 14px;cursor:pointer;font-family:inherit;margin-bottom:10px">🖨 打印全部 / 存为 PDF</button>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${subs.map(x => `<div onclick="thwOpenStudent='${x.id}';thwRenderMain()" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-light);border-radius:3px">
          <span style="font-size:12px;font-weight:600">${thwEsc(x.student_name)}</span>
          <span style="font-size:9px;color:var(--text-3)">${(x.submitted_at||'').slice(0,16).replace('T',' ')}</span>
          <span style="font-size:9px;color:var(--text-3)">${x.level?`【${thwEsc(x.level)}】`:''}${(x.answers||[]).filter(a=>a.text||(a.images||[]).length).length} 处作答${x.whole_file_url?' · 📎附件':''}</span>
          <span style="margin-left:auto;font-size:10px;color:${x.teacher_feedback?'var(--ok)':'var(--warn,#b8860b)'}">${x.teacher_feedback?'✓ 已批改':'待批改'}</span>
        </div>`).join('')}
      </div>
    </div>`;
  }

  const sub = subs.find(x => x.id === thwOpenStudent);
  if (!sub) return '';
  return `<div style="background:var(--surface);border:1px solid var(--border-light);border-radius:4px;padding:14px 16px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <span onclick="thwOpenStudent=null;thwRenderMain()" style="font-size:11px;color:var(--accent);cursor:pointer">← 返回列表</span>
      <span style="font-size:13px;font-weight:600">${thwEsc(sub.student_name)}</span>
      <span style="font-size:10px;color:var(--text-3)">${thwEsc(s.course_name||'')} 第${s.session_number||''}回 · ${(sub.submitted_at||'').slice(0,16).replace('T',' ')}</span>
      <button onclick="thwPrintOne('${sub.id}')" style="margin-left:auto;font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:3px 12px;cursor:pointer;font-family:inherit">🖨 打印 / 存 PDF</button>
    </div>
    <div style="border:1px solid var(--border-light);border-radius:3px;padding:12px;background:var(--bg);max-height:52vh;overflow-y:auto">
      ${thwPaperHtml(s, sub, false)}
    </div>
    <div style="margin-top:12px;border-top:1px solid var(--border-light);padding-top:10px">
      <div style="font-size:11px;font-weight:600;margin-bottom:8px">✍ 批改反馈（学生可见）</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">📚 知识掌握情况</label>
          <textarea id="thw_know" rows="3" placeholder="例：基本概念掌握扎实，第3题的模型推导仍有偏差" style="width:100%;font-size:11px;line-height:1.8;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${thwEsc(sub.feedback_knowledge)}</textarea></div>
        <div><label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">🧭 学习态度</label>
          <textarea id="thw_att" rows="3" placeholder="例：书写工整、按时提交；部分题目略显敷衍" style="width:100%;font-size:11px;line-height:1.8;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical">${thwEsc(sub.feedback_attitude)}</textarea></div>
      </div>
      <label style="font-size:9px;color:var(--text-3);display:block;margin-bottom:2px">💡 改进建议 / 下一步</label>
      <textarea id="thw_sug" rows="3" placeholder="例：建议复习教材第4章，下次作业前完成过去问2015年第2题" style="width:100%;font-size:11px;line-height:1.8;padding:7px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;resize:vertical;margin-bottom:8px">${thwEsc(sub.feedback_suggestions)}</textarea>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="thw_score" value="${thwEsc(sub.score)}" placeholder="评价/分数（可选）" style="font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:2px;background:var(--bg);font-family:inherit;width:140px">
        <label style="font-size:10px;color:var(--accent);cursor:pointer;border:1px solid var(--border);border-radius:2px;padding:5px 12px">📎 上传批改文件（可带批注的 Word）
          <input type="file" accept=".doc,.docx,.pdf,image/*" style="display:none" onchange="thwUploadFile('${sub.id}', this)"></label>
        <span id="thw_file_tip" style="font-size:10px;color:var(--text-3)">${sub.teacher_file_url?'✓ 已上传批改文件':''}</span>
        <button onclick="thwSaveFeedback('${sub.id}')" style="margin-left:auto;font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 20px;cursor:pointer;font-family:inherit">保存反馈</button>
      </div>
    </div>
  </div>`;
}

function thwRenderMain() {
  const box = document.getElementById('thw_main');
  if (box) box.innerHTML = thwMainHtml();
}

// ── 整合答卷：按作答单元顺序展示（题目 + 文字答案 + 顺序照片） ──
function thwPaperHtml(s, sub, forPrint) {
  const imgStyle = forPrint
    ? 'max-width:100%;display:block;margin:6px 0;border:1px solid #ddd'
    : 'max-width:100%;display:block;margin:6px 0;border:1px solid var(--border-light);border-radius:2px';
  const answers = sub.answers || [];
  // 按 head 分组保持题型区块结构
  const groups = [];
  answers.forEach(a => {
    const label = a.label || a.k || '';
    const sp = label.indexOf(' ');
    const head = sp > 0 ? label.slice(0, sp) : '';
    const sub2 = sp > 0 ? label.slice(sp + 1) : label;
    let g = groups.find(x => x.head === head);
    if (!g) { g = { head, items: [] }; groups.push(g); }
    g.items.push({ ...a, sub: sub2 });
  });
  return `
  ${forPrint ? `<div style="border-bottom:2px solid #5a3e28;padding-bottom:8px;margin-bottom:14px">
    <div style="font-size:16px;font-weight:700">${thwEsc(sub.student_name)} — ${thwEsc(s.course_name||'')} 第${s.session_number||''}回 作业${sub.level?`（${thwEsc(sub.level)}级）`:''}</div>
    <div style="font-size:11px;color:#666;margin-top:3px">${s.session_date||''}${s.session_title?' · '+thwEsc(s.session_title):''}　提交时间：${(sub.submitted_at||'').slice(0,16).replace('T',' ')}</div>
  </div>` : ''}
  ${sub.whole_file_url ? `<div style="font-size:11px;margin-bottom:10px">📎 学生上传的整份作业：<a href="${thwEsc(sub.whole_file_url)}" target="_blank" style="color:#5a3e28">下载查看</a></div>` : ''}
  ${groups.map(g => `<div style="margin-bottom:${forPrint?'16px':'12px'}">
    ${g.head ? `<div style="font-size:${forPrint?'13px':'12px'};font-weight:700;margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid ${forPrint?'#ccc':'var(--border-light)'}">${thwEsc(g.head)}</div>` : ''}
    ${g.items.every(it => !(it.images||[]).length && (it.text||'').length <= 8)
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:4px">
          ${g.items.map(it => `<div style="font-size:11px"><span style="color:#999">${thwEsc(it.sub)}</span> <b>${thwEsc(it.text||'—')}</b></div>`).join('')}
        </div>`
      : g.items.map(it => `<div style="margin-bottom:${forPrint?'12px':'8px'};page-break-inside:avoid">
          <div style="font-size:${forPrint?'12px':'11.5px'};font-weight:600;margin-bottom:3px">${thwEsc(it.sub)}</div>
          ${it.text ? `<div style="font-size:${forPrint?'12px':'11.5px'};line-height:1.9;white-space:pre-wrap;padding:6px 8px;background:${forPrint?'#fafafa':'var(--surface)'};border-radius:2px">${thwEsc(it.text)}</div>` : ''}
          ${(it.images||[]).map((im, i) => `<div><div style="font-size:9px;color:#999;margin-top:4px">${thwEsc(it.sub)} · 图${i+1}</div><img src="${thwEsc(im.url)}" style="${imgStyle}"></div>`).join('')}
          ${!it.text && !(it.images||[]).length ? `<div style="font-size:11px;color:#aaa">（未作答）</div>` : ''}
        </div>`).join('')}
  </div>`).join('')}`;
}

function thwOpenPrintWindow(title, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) { alert('浏览器拦截了新窗口，请允许弹出后重试'); return; }
  w.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title>
<style>
  body{font-family:'Noto Serif SC','Hiragino Sans GB','Microsoft YaHei',serif;background:#fff;margin:0;padding:24px;color:#1a1814}
  @media print{.noprint{display:none!important}body{padding:0}}
  .paper{max-width:820px;margin:0 auto 40px}
</style></head><body>
<div class="noprint" style="text-align:right;margin-bottom:12px"><button onclick="window.print()" style="font-size:13px;padding:8px 20px;cursor:pointer">🖨 打印 / 保存为 PDF</button></div>
${bodyHtml}
</body></html>`);
  w.document.close();
}

function thwPrintOne(subId) {
  const s = thwSessions.find(x => x.id === thwOpenSession);
  const sub = (thwSubs[thwOpenSession] || []).find(x => x.id === subId);
  if (!s || !sub) return;
  thwOpenPrintWindow(`${sub.student_name}_${s.course_name}_第${s.session_number||''}回作业`,
    `<div class="paper">${thwPaperHtml(s, sub, true)}</div>`);
}

function thwPrintAll() {
  const s = thwSessions.find(x => x.id === thwOpenSession);
  const subs = thwSubs[thwOpenSession] || [];
  if (!s || !subs.length) return;
  thwOpenPrintWindow(`${s.course_name}_第${s.session_number||''}回_全部作业`,
    subs.map(sub => `<div class="paper" style="page-break-after:always">${thwPaperHtml(s, sub, true)}</div>`).join(''));
}

async function thwUploadFile(subId, input) {
  const f = input.files[0];
  if (!f) return;
  const tip = document.getElementById('thw_file_tip');
  if (tip) tip.textContent = '上传中…';
  try {
    const ext = (f.name.split('.').pop() || 'docx').toLowerCase();
    const url = await sbUpload('teacher-files', `hw/${subId}-${Date.now()}.${ext}`, f);
    await sb(`/rest/v1/homework_submissions?id=eq.${subId}`, 'PATCH', { teacher_file_url: url });
    const sub = (thwSubs[thwOpenSession] || []).find(x => x.id === subId);
    if (sub) sub.teacher_file_url = url;
    if (tip) tip.textContent = '✓ 已上传批改文件';
  } catch (e) { if (tip) tip.textContent = '上传失败：' + e.message; }
  input.value = '';
}

async function thwSaveFeedback(subId) {
  const g = id => ((document.getElementById(id) || {}).value || '').trim();
  const know = g('thw_know'), att = g('thw_att'), sug = g('thw_sug'), score = g('thw_score');
  if (!know && !att && !sug) { alert('请至少填写一项反馈'); return; }
  const patch = {
    feedback_knowledge: know || null, feedback_attitude: att || null, feedback_suggestions: sug || null,
    teacher_feedback: [know && '知识掌握：'+know, att && '学习态度：'+att, sug && '改进建议：'+sug].filter(Boolean).join('\n'),
    score: score || null, graded_by: teacherData.name, graded_at: new Date().toISOString(),
  };
  try {
    await sb(`/rest/v1/homework_submissions?id=eq.${subId}`, 'PATCH', patch);
    const sub = (thwSubs[thwOpenSession] || []).find(x => x.id === subId);
    if (sub) Object.assign(sub, patch);
    alert('反馈已保存，学生可见');
    thwOpenStudent = null;
    thwRender();
  } catch (e) { alert('保存失败：' + e.message); }
}
