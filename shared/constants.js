// ── 专业常量 ──
const MAJORS = {
  keiei: '経営学',
  keizai: '経済学',
  shakai: '社会学',
  shinpan: '新闻传播学',
  fukushi: '社会福祉学'
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

// ── 面谈类型 ──
function typeLabel(t) { return t === 'daily' ? '日常学习面谈' : t === 'plan' ? '计划书相关' : '模拟面试'; }
function typeTag(t) { return t === 'daily' ? 'tag-daily' : t === 'plan' ? 'tag-plan' : 'tag-mock'; }
function slotCap(tr) {
  const [a, b] = (tr || '').split('–');
  if (!a || !b) return 4;
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return Math.max(1, Math.floor(((bh * 60 + bm) - (ah * 60 + am)) / 15));
}
