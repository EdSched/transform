// ── 专业常量 ──
const MAJORS = {
  keiei: '経営学',
  keizai: '経済学',
  shakai: '社会学',
  shinpan: '新闻传播学',
  fukushi: '社会福祉学',
  shakai_group: '社会人文',
};
const SHAKAI_GROUP = ['shakai', 'shinpan', 'fukushi'];

function majorLabel(m) {
  return m === 'shakai_group' ? '社会人文' : MAJORS[m] || m || '';
}
function matchesMajorFilter(major, filter) {
  if (filter === 'all') return true;
  if (filter === 'shakai_group') return SHAKAI_GROUP.includes(major);
  return major === filter;
}

// ── 期数工具 ──
function currentPeriodKey() {
  const m = new Date().getMonth() + 1;
  if (m >= 1 && m <= 3) return '1月期';
  if (m >= 4 && m <= 6) return '4月期';
  if (m >= 7 && m <= 9) return '7月期';
  return '10月期';
}
function periodFromDate(dateStr) {
  if (!dateStr) return '未分期';
  const m = parseInt(dateStr.slice(5, 7));
  if (m >= 1 && m <= 3) return '1月期';
  if (m >= 4 && m <= 6) return '4月期';
  if (m >= 7 && m <= 9) return '7月期';
  return '10月期';
}

// ── 课程颜色 ──
function courseColor(name) {
  const n = name || '';
  if (/宏观/.test(n)) return { bg: '#ddeaf8', text: '#1a3a6a' };
  if (/微观/.test(n)) return { bg: '#ddf0e0', text: '#1a4a28' };
  if (/数学/.test(n)) return { bg: '#e8e4f8', text: '#3a2a7a' };
  if (/习题/.test(n)) return { bg: '#faecd8', text: '#5a3010' };
  if (/計量|计量|方法論|方法论/.test(n)) return { bg: '#d8f0ea', text: '#0a4038' };
  if (/共通/.test(n)) return { bg: '#ece8e0', text: '#3a3830' };
  if (/過去問|过去问|備考|备考/.test(n)) return { bg: '#f8e4dc', text: '#6a2818' };
  if (/経営|经营/.test(n)) return { bg: '#ddeaf8', text: '#1a3a6a' };
  if (/社会学|社会人文/.test(n)) return { bg: '#ddf0e0', text: '#1a4a28' };
  if (/新闻|新伝/.test(n)) return { bg: '#e8e4f8', text: '#3a2a7a' };
  if (/福祉/.test(n)) return { bg: '#faecd8', text: '#5a3010' };
  return { bg: '#ece8e0', text: '#3a3830' };
}

// ── 日期工具 ──
const DAYS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DAYS = DAYS_CN; // alias for backward compatibility
const DOW_COLOR = { 6: '#1a4a8a', 0: '#8a1a2c' };

function fmtSessionDate(dateStr) {
  if (!dateStr) return { short: '', dow: '', dowColor: 'var(--text-2)' };
  const d = new Date(dateStr + 'T12:00:00');
  const dow = DAYS_CN[d.getDay()];
  const dowColor = DOW_COLOR[d.getDay()] || 'var(--text-2)';
  return { short: `${d.getMonth() + 1}/${d.getDate()}`, dow, dowColor };
}

// ── 課次日期生成 ──
function parseWeekdays(str) {
  if (!str) return [];
  const map = { '周日': 0, '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6 };
  const days = [];
  for (const [k, v] of Object.entries(map)) { if (str.includes(k)) days.push(v); }
  return [...new Set(days)];
}
function generateSessionDatesFromFirst(firstDate, weekdays, totalSessions) {
  if (!firstDate || !weekdays.length || !totalSessions) return [];
  const dates = [];
  const cur = new Date(firstDate);
  const limit = new Date(firstDate);
  limit.setFullYear(limit.getFullYear() + 2);
  while (dates.length < totalSessions && cur <= limit) {
    if (weekdays.includes(cur.getDay())) dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ── 面谈记录工具（admin 和 teacher 共用）──
function buildRecordText(b) {
  const r = b.daily_record || {};
  // 优先使用实际面谈时间+时长；没有则只显示预约日期，不显示时间槽范围
  let atStr = '';
  if (b.actual_time) {
    atStr = b.actual_time.replace('T', ' ');
    if (b.actual_duration) atStr += `（${b.actual_duration}min）`;
  } else {
    atStr = b.slot_date || '';
  }
  const lines = [`【面谈记录】${b.name}`, `日期：${atStr}`, `专业：${MAJORS[b.major] || b.major || ''}`, ``];
  [['📚 知识学习进展', 'study'], ['📝 计划书完成情况', 'plan'], ['🎓 出愿情况', 'apply'], ['📖 备考情况', 'exam']].forEach(([title, k]) => {
    const st = r[`${k}_status`], ad = r[`${k}_advice`], dl = r[`${k}_deadline`];
    if (st || ad || dl) { lines.push(title); if (st) lines.push(`状态：${st}`); if (ad) lines.push(`建议：${ad}`); if (dl) lines.push(`期限：${dl}`); lines.push(''); }
  });
  if (r.issue || r.issue_advice) { lines.push('❓ 目前困惑 / 问题'); if (r.issue) lines.push(`问题：${r.issue}`); if (r.issue_advice) lines.push(`建议：${r.issue_advice}`); if (r.issue_deadline) lines.push(`期限：${r.issue_deadline}`); lines.push(''); }
  if (r.extra) { lines.push('📌 补充'); lines.push(r.extra); lines.push(''); }
  return lines.join('\n');
}

function renderRecordForm(id, r) {
  r = r || {};
  const sec = (title, fields) => `<div style="margin-bottom:10px;padding:10px;background:var(--bg);border-radius:3px;border:1px solid var(--border-light)"><div style="font-size:10px;font-weight:600;color:var(--text-2);margin-bottom:8px">${title}</div>${fields}</div>`;
  const sel = (k, opts) => `<div class="form-group" style="margin-bottom:6px"><label class="form-label">状态</label><select id="rf_${k}_status_${id}" style="font-size:11px"><option value="">请选择</option>${opts.map(o => `<option ${r[`${k}_status`] === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
  const ta = (k, ph, label) => `<div class="form-group" style="margin-bottom:6px"><label class="form-label">${label || '建议'}</label><textarea id="rf_${k}_advice_${id}" rows="2" placeholder="${ph}" style="font-size:11px">${r[`${k}_advice`] || ''}</textarea></div>`;
  const dl = (k) => `<div class="form-group" style="margin-bottom:0"><label class="form-label">期限</label><input type="month" id="rf_${k}_deadline_${id}" value="${r[`${k}_deadline`] || ''}" style="font-size:11px"></div>`;
  return `
    ${sec('📚 知识学习进展', sel('study', ['进展顺利并能掌握', '能够稳定跟上', '需要更多时间', '没有很好跟上进度', '遇到困难']) + ta('study', '例：建议定期复习…') + dl('study'))}
    ${sec('📝 计划书完成情况', sel('plan', ['未开始', '在收集材料', '遇到困难', '撰写中', '已完成']) + ta('plan', '例：参考先行研究…') + dl('plan'))}
    ${sec('🎓 出愿情况', sel('apply', ['未开始', '完成择校', '已联系教授', '准备中', '已出愿']) + ta('apply', '') + dl('apply'))}
    ${sec('📖 备考情况', sel('exam', ['未开始', '在写过去问', '过去问已提交', '在准备面试稿', '模拟面试阶段']) + ta('exam', '') + dl('exam'))}
    ${sec('❓ 目前困惑 / 问题', `
      <div class="form-group" style="margin-bottom:6px"><label class="form-label">困惑内容</label><textarea id="rf_issue_content_${id}" rows="2" style="font-size:11px">${r.issue || ''}</textarea></div>
      <div class="form-group" style="margin-bottom:6px"><label class="form-label">解决建议</label><textarea id="rf_issue_advice_${id}" rows="2" style="font-size:11px">${r.issue_advice || ''}</textarea></div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">期限</label><input type="month" id="rf_issue_deadline_${id}" value="${r.issue_deadline || ''}" style="font-size:11px"></div>
    `)}
    <div style="padding:10px;background:var(--bg);border-radius:3px;border:1px solid var(--border-light)">
      <div style="font-size:10px;font-weight:600;color:var(--text-2);margin-bottom:6px">📌 补充</div>
      <textarea id="rf_extra_${id}" rows="2" placeholder="语学成绩、学生诉求、评价等…" style="font-size:11px">${r.extra || ''}</textarea>
    </div>`;
}

function getRecordFromForm(id) {
  const v = (k) => document.getElementById(`rf_${k}_${id}`)?.value || '';
  return {
    study_status: v('study_status'), study_advice: v('study_advice'), study_deadline: v('study_deadline'),
    plan_status: v('plan_status'), plan_advice: v('plan_advice'), plan_deadline: v('plan_deadline'),
    apply_status: v('apply_status'), apply_advice: v('apply_advice'), apply_deadline: v('apply_deadline'),
    exam_status: v('exam_status'), exam_advice: v('exam_advice'), exam_deadline: v('exam_deadline'),
    issue: v('issue_content'), issue_advice: v('issue_advice'), issue_deadline: v('issue_deadline'),
    extra: v('extra'),
  };
}
function typeLabel(t) { return t === 'daily' ? '日常学习面谈' : t === 'plan' ? '计划书相关' : t === 'vip' ? 'VIP预约' : '模拟面试'; }
function typeTag(t) { return t === 'daily' ? 'tag-daily' : t === 'plan' ? 'tag-plan' : t === 'vip' ? 'tag-vip' : 'tag-mock'; }
function slotCap(tr) {
  const [a, b] = (tr || '').split('–');
  if (!a || !b) return 4;
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return Math.max(1, Math.floor(((bh * 60 + bm) - (ah * 60 + am)) / 15));
}

// ── 文件相关 ──
// 把一段纯文本下载为 .doc 文件（Word 兼容，无需额外库）
function downloadAsWord(filename, title, content) {
  const escaped = String(content || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><title>${title||''}</title>
<style>body{font-family:'Microsoft YaHei',sans-serif;font-size:14px;line-height:1.8}h1{font-size:18px}</style>
</head>
<body>${title?`<h1>${title}</h1>`:''}<div>${escaped}</div></body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename.endsWith('.doc')?filename:filename+'.doc';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

// 生成提取码（避免易混淆字符 0/O/1/I）
function generateRetrievalCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
