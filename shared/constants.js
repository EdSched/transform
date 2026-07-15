// ── 专业常量 ──
// MAJORS 初始包含5个核心专业（写死，保证数据库未加载完成前页面也能正常显示）
// 数据库 majors 表中的内容会在 loadMajorsFromDB() 后合并进来，不会覆盖/删除这5个核心专业
let MAJORS = {
  keiei: '経営学',
  keizai: '経済学',
  shakai: '社会学',
  shinpan: '新闻传播学',
  fukushi: '社会福祉学',
  shakai_group: '社会人文',
};
const SHAKAI_GROUP = ['shakai', 'shinpan', 'fukushi'];

// 从数据库加载专业字典，合并进全局 MAJORS（不会清空/覆盖已有的核心专业）
// 各页面应在初始化阶段调用一次：await loadMajorsFromDB();
let majorsLoadedFromDB = false;
async function loadMajorsFromDB() {
  try {
    const rows = await sb('/rest/v1/majors?select=key,label');
    (rows || []).forEach(r => { if (r.key && r.label) MAJORS[r.key] = r.label; });
    majorsLoadedFromDB = true;
  } catch (e) {
    // 加载失败不影响主流程，MAJORS 仍保留核心5个专业
  }
}

// 中文专业名 → 生成一个安全的英文 key（拼音首字母不可行时退回时间戳后缀，保证唯一）
function generateMajorKey(label) {
  const pinyinMap = {
    '国': 'guo','际': 'ji','关': 'guan','系': 'xi','学': 'xue','文': 'wen',
    '化': 'hua','表': 'biao','象': 'xiang','艺': 'yi','术': 'shu','传': 'chuan',
    '播': 'bo','心': 'xin','理': 'li','教': 'jiao','育': 'yu','法': 'fa',
    '律': 'lv','医': 'yi','工': 'gong','程': 'cheng','计': 'ji','算': 'suan',
    '机': 'ji','环': 'huan','境': 'jing','建': 'jian','筑': 'zhu','农': 'nong',
    '生': 'sheng','物': 'wu','化学': 'huaxue','物理': 'wuli','数': 'shu',
  };
  let key = '';
  for (const ch of String(label)) {
    key += pinyinMap[ch] || '';
  }
  // 没匹配到足够字符时（生僻字较多），退回用 base36 短哈希保证可用且唯一
  if (key.length < 2) {
    key = 'm' + Date.now().toString(36).slice(-6);
  }
  return key;
}

// 新增一个专业到数据库，返回生成的 key（重名/已存在则直接返回已有 key，不重复创建）
async function createMajor(label) {
  label = String(label || '').trim();
  if (!label) return null;
  // 先看是否已经存在同名专业（避免重复创建多个 key 对应同一个中文名）
  const existing = Object.entries(MAJORS).find(([k, v]) => v === label);
  if (existing) return existing[0];
  let key = generateMajorKey(label);
  // 避免 key 冲突：如果已存在，加随机后缀
  if (MAJORS[key]) key = key + Date.now().toString(36).slice(-3);
  try {
    await sb('/rest/v1/majors', 'POST', { key, label });
    MAJORS[key] = label;
    return key;
  } catch (e) {
    alert('新增专业失败：' + e.message);
    return null;
  }
}

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
  const dl = (k) => {
    const val = r[`${k}_deadline`] || '';
    const m = val.match(/^(\d{4})年(\d{1,2})月(上旬|中旬|下旬)$/);
    const yr = m ? m[1] : (val ? '' : new Date().getFullYear());
    const mo = m ? m[2] : '';
    const xun = m ? m[3] : '';
    return `<div class="form-group" style="margin-bottom:0"><label class="form-label">期限</label>
      <div style="display:flex;align-items:center;gap:4px">
        <input type="number" id="rf_${k}_deadline_y_${id}" value="${yr}" placeholder="年" min="2024" max="2030" style="font-size:11px;width:58px;text-align:center">
        <span style="font-size:11px;color:var(--text-2)">年</span>
        <input type="number" id="rf_${k}_deadline_m_${id}" value="${mo}" placeholder="月" min="1" max="12" style="font-size:11px;width:40px;text-align:center">
        <span style="font-size:11px;color:var(--text-2)">月</span>
        <select id="rf_${k}_deadline_x_${id}" style="font-size:11px;width:60px">
          <option value="">旬</option>
          <option ${xun==='上旬'?'selected':''}>上旬</option>
          <option ${xun==='中旬'?'selected':''}>中旬</option>
          <option ${xun==='下旬'?'selected':''}>下旬</option>
        </select>
      </div>
    </div>`;
  };
  return `
    ${sec('📚 知识学习进展', sel('study', ['进展顺利并能掌握', '能够稳定跟上', '需要更多时间', '没有很好跟上进度', '遇到困难']) + ta('study', '例：建议定期复习…') + dl('study'))}
    ${sec('📝 计划书完成情况', sel('plan', ['未开始', '在收集材料', '遇到困难', '撰写中', '已完成']) + ta('plan', '例：参考先行研究…') + dl('plan'))}
    ${sec('🎓 出愿情况', sel('apply', ['未开始', '完成择校', '已联系教授', '准备中', '已出愿']) + ta('apply', '') + dl('apply'))}
    ${sec('📖 备考情况', sel('exam', ['未开始', '在写过去问', '过去问已提交', '在准备面试稿', '模拟面试阶段']) + ta('exam', '') + dl('exam'))}
    ${sec('❓ 目前困惑 / 问题', `
      <div class="form-group" style="margin-bottom:6px"><label class="form-label">困惑内容</label><textarea id="rf_issue_content_${id}" rows="2" style="font-size:11px">${r.issue || ''}</textarea></div>
      <div class="form-group" style="margin-bottom:6px"><label class="form-label">解决建议</label><textarea id="rf_issue_advice_${id}" rows="2" style="font-size:11px">${r.issue_advice || ''}</textarea></div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">期限</label>
      <div style="display:flex;align-items:center;gap:4px">
        ${(() => { const val=r.issue_deadline||''; const m=val.match(/^(\d{4})年(\d{1,2})月(上旬|中旬|下旬)$/); const yr=m?m[1]:(val?'':new Date().getFullYear()); const mo=m?m[2]:''; const xun=m?m[3]:''; return `<input type="number" id="rf_issue_deadline_y_${id}" value="${yr}" placeholder="年" min="2024" max="2030" style="font-size:11px;width:58px;text-align:center"><span style="font-size:11px;color:var(--text-2)">年</span><input type="number" id="rf_issue_deadline_m_${id}" value="${mo}" placeholder="月" min="1" max="12" style="font-size:11px;width:40px;text-align:center"><span style="font-size:11px;color:var(--text-2)">月</span><select id="rf_issue_deadline_x_${id}" style="font-size:11px;width:60px"><option value="">旬</option><option ${xun==='上旬'?'selected':''}>上旬</option><option ${xun==='中旬'?'selected':''}>中旬</option><option ${xun==='下旬'?'selected':''}>下旬</option></select>`; })()}
      </div></div>
    `)}
    <div style="padding:10px;background:var(--bg);border-radius:3px;border:1px solid var(--border-light)">
      <div style="font-size:10px;font-weight:600;color:var(--text-2);margin-bottom:6px">📌 补充</div>
      <textarea id="rf_extra_${id}" rows="2" placeholder="语学成绩、学生诉求、评价等…" style="font-size:11px">${r.extra || ''}</textarea>
    </div>`;
}

function getRecordFromForm(id) {
  const v = (k) => document.getElementById(`rf_${k}_${id}`)?.value || '';
  const dl = (k) => {
    const y = document.getElementById(`rf_${k}_deadline_y_${id}`)?.value || '';
    const m = document.getElementById(`rf_${k}_deadline_m_${id}`)?.value || '';
    const x = document.getElementById(`rf_${k}_deadline_x_${id}`)?.value || '';
    return (y && m && x) ? `${y}年${m}月${x}` : '';
  };
  return {
    study_status: v('study_status'), study_advice: v('study_advice'), study_deadline: dl('study'),
    plan_status: v('plan_status'), plan_advice: v('plan_advice'), plan_deadline: dl('plan'),
    apply_status: v('apply_status'), apply_advice: v('apply_advice'), apply_deadline: dl('apply'),
    exam_status: v('exam_status'), exam_advice: v('exam_advice'), exam_deadline: dl('exam'),
    issue: v('issue_content'), issue_advice: v('issue_advice'),
    issue_deadline: (() => {
      const y = document.getElementById(`rf_issue_deadline_y_${id}`)?.value || '';
      const m = document.getElementById(`rf_issue_deadline_m_${id}`)?.value || '';
      const x = document.getElementById(`rf_issue_deadline_x_${id}`)?.value || '';
      return (y && m && x) ? `${y}年${m}月${x}` : '';
    })(),
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

// ── 拼音首字母搜索 ──
// 输入1-2个英文字母时，匹配对应拼音首字母的汉字姓氏
// 输入中文或混合时，直接做 includes 匹配
const PINYIN_MAP = {
  a:['安','艾','阿','敖','奥'],
  b:['白','包','鲍','贝','毕','卞','边','别','宾','卜','步','蔡','薄'],
  c:['蔡','曹','岑','柴','常','陈','成','程','池','褚','从','崔','从'],
  d:['戴','邓','狄','刁','丁','董','窦','杜','段',''],
  e:['鄂','恩'],
  f:['范','方','房','费','丰','冯','凤','符','付','傅','扶'],
  g:['高','葛','龚','宫','巩','管','顾','关','郭','贵'],
  h:['韩','郝','何','贺','洪','胡','花','华','黄','霍','侯','后','哈'],
  j:['贾','简','江','姜','蒋','焦','金','荆','景','靳','纪','季','吉','计','冀'],
  k:['柯','孔','寇','匡'],
  l:['李','林','刘','陆','罗','雷','黎','廖','梁','连','蔺','凌','令','刁','鲁','卢','栾'],
  m:['马','毛','茅','梅','孟','苗','闵','莫','牟','穆'],
  n:['倪','聂','宁','牛','农'],
  o:['欧','区'],
  p:['潘','彭','皮','平','蒲','朴'],
  q:['齐','钱','强','乔','秦','邱','瞿','屈','曲','权','全','钱'],
  r:['任','荣','阮','芮'],
  s:['沈','施','石','史','舒','宋','苏','孙','单','邵','申','盛'],
  t:['谭','唐','陶','田','童','涂','屠','汤'],
  w:['王','韦','魏','温','文','吴','武','汪','万','翁','卫','危'],
  x:['夏','谢','徐','许','薛','向','项','萧','邢','熊','修','宣','玄'],
  y:['严','杨','姚','叶','易','尹','应','袁','于','俞','余','岳','云','颜','晏'],
  z:['张','章','赵','郑','钟','周','朱','庄','邹','左','宗','曾','占','詹','翟'],
};

function matchesPinyin(name, query) {
  if (!name || !query) return false;
  const q = query.trim().toLowerCase();
  // 纯英文字母（1-3位）→ 拼音首字母匹配
  if (/^[a-z]{1,3}$/.test(q)) {
    const firstChar = name[0];
    // 单字母：匹配姓氏第一个字
    const chars = PINYIN_MAP[q[0]] || [];
    if (!chars.includes(firstChar)) return false;
    // 两个字母：第二个字母匹配名字第二个字（简单前缀匹配）
    if (q.length >= 2) {
      const secondChar = name[1];
      if (!secondChar) return false;
      const chars2 = PINYIN_MAP[q[1]] || [];
      if (!chars2.includes(secondChar)) return false;
    }
    return true;
  }
  // 其他情况：直接 includes
  return name.includes(query);
}

// 通用学生名称搜索：支持姓名（汉字/拼音首字母）、学校、备注
function matchesStudentSearch(student, query) {
  if (!query || !query.trim()) return true;
  const q = query.trim().toLowerCase();
  // 拼音首字母模式
  if (/^[a-z]{1,3}$/.test(q)) return matchesPinyin(student.name || '', q);
  // 普通搜索
  return (student.name||'').includes(query)
    || (student.university||'').includes(query)
    || (student.notes||'').includes(query);
}

// ── 预约状态统一工具函数 ──

/**
 * 返回预约状态的中文标签
 * @param {object} booking - booking 对象，需要 status 和 student_confirmed 字段
 * @param {boolean} showStudentConfirmed - 是否区分显示「学生已确认」（admin端用）
 */
function bookingStatusLabel(booking, showStudentConfirmed = false) {
  const s = booking.status;
  if (s === 'pending') return '待确认';
  if (s === 'completed') return '已完成';
  if (s === 'cancelled') return '已取消';
  if (s === 'confirmed') {
    if (showStudentConfirmed && booking.student_confirmed) return '学生已确认';
    return '已确认';
  }
  return s || '未知';
}

/**
 * 返回状态对应的前景色（CSS 变量或颜色值）
 */
function bookingStatusColor(booking) {
  const s = booking.status;
  if (s === 'cancelled') return 'var(--danger)';
  if (s === 'completed') return 'var(--ok)';
  if (s === 'confirmed') {
    if (booking.student_confirmed) return 'var(--ok)';
    return '#1a6a9a';
  }
  return '#856404'; // pending
}

/**
 * 返回状态对应的背景色
 */
function bookingStatusBg(booking) {
  const s = booking.status;
  if (s === 'cancelled') return '#fdecea';
  if (s === 'completed') return 'var(--ok-bg)';
  if (s === 'confirmed') {
    if (booking.student_confirmed) return 'var(--ok-bg)';
    return '#e8f4fd';
  }
  return '#fff3cd'; // pending
}

/**
 * 返回状态对应的左边框色（老师端卡片用）
 */
function bookingStatusBorderColor(booking) {
  const s = booking.status;
  if (s === 'pending') return 'var(--warn)';
  return 'var(--ok)';
}

/**
 * 渲染状态 badge HTML
 */
function bookingStatusBadge(booking, showStudentConfirmed = false) {
  const label = bookingStatusLabel(booking, showStudentConfirmed);
  const color = bookingStatusColor(booking);
  const bg = bookingStatusBg(booking);
  return `<span style="font-size:10px;background:${bg};color:${color};padding:2px 7px;border-radius:2px;white-space:nowrap">${label}</span>`;
}

/**
 * VIP预约是否已完成（老师填记录 OR 学生已确认）
 */
function isVipDone(booking) {
  return booking.status === 'completed' || booking.student_confirmed;
}

// ── 语言成绩文本 → 进度状态映射 ──
function mapJapaneseScore(scoreText) {
  if (!scoreText) return '';
  const t = scoreText.toString();
  // 明确写出合格
  if (t.includes('N1合格')) return 'N1合格';
  if (t.includes('N2合格')) return 'N2合格';
  if (t.includes('EJU完成')) return 'EJU完成';
  // 有分数数字且没有「待考/备考」→ 已合格
  if (/\d{2,3}/.test(t) && !t.includes('待考') && !t.includes('备考')) {
    if (t.includes('N1')) return 'N1合格';
    if (t.includes('N2')) return 'N2合格';
    if (t.includes('EJU')) return 'EJU完成';
    return '成绩待出';
  }
  // 待考/备考/报名 → 区分N几
  if (t.includes('待考') || t.includes('备考') || t.includes('报名')) {
    if (t.includes('N1')) return '已报名(N1)';
    if (t.includes('N2')) return '已报名(N2)';
    if (t.includes('EJU')) return '已报名(EJU)';
    return '已报名';
  }
  if (t.includes('EJU')) return 'EJU完成';
  return '备考中';
}

function mapEnglishScore(scoreText) {
  if (!scoreText) return '';
  const t = scoreText.toString();
  if (t === '不需要' || t === '无') return '不需要';
  // 待考/备考/报名 → 区分考试类型
  if (t.includes('待考') || t.includes('备考') || t.includes('报名')) {
    if (t.includes('TOEFL')) return '已报名(TOEFL)';
    if (t.includes('IELTS')) return '已报名(IELTS)';
    if (t.includes('TOEIC')) return '已报名(TOEIC)';
    if (t.includes('GRE')) return '已报名(GRE)';
    if (t.includes('GMAT')) return '已报名(GMAT)';
    return '已报名';
  }
  // 有分数 → 显示考试类型
  if (/\d/.test(t) && !t.includes('待考') && !t.includes('备考')) {
    if (t.includes('TOEFL')) return 'TOEFL完成';
    if (t.includes('IELTS')) return 'IELTS完成';
    if (t.includes('TOEIC')) return 'TOEIC完成';
    if (t.includes('GRE')) return 'GRE完成';
    if (t.includes('GMAT')) return 'GMAT完成';
    return '已完成';
  }
  return '备考中';
}

// ── 出願数据库 HTML 导出（共享） ──
// filtered: 已筛选的学校列表
// opts: { majorLabel, filterLine, showMajor, majorMap }
function exportAdmissionHtmlShared(filtered, opts) {
  if (!filtered.length) { alert('没有可导出的数据'); return; }
  const { majorLabel, filterLine, showMajor, majorMap } = opts;
  const today = new Date().toLocaleDateString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit'});

  const colDefs = [
    ...(showMajor ? [['专业','56px','school']] : []),
    ['大学名','108px','school'],
    ['設置主体','40px','school'],
    ['研究科名','136px','school'],
    ['専攻名','96px','school'],
    ['コース名','88px','school'],
    ['出願類型','68px','time'],
    ['資格審査','68px','time'],
    ['出願期間','68px','time'],
    ['筆記試験','68px','time'],
    ['口述試験','68px','time'],
    ['合格発表','68px','time'],
    ['英語','42px','lang'],
    ['日語','42px','lang'],
  ];

  const thColors = {
    school: { bg:'#2c4a7c', border:'#1e3560' },
    time:   { bg:'#3d6b4f', border:'#2a4d38' },
    lang:   { bg:'#7c4a2c', border:'#5e3520' },
  };
  const engColor = v => v==='必須'?'#1a56a0':v==='任意'?'#b45309':'#888';

  const rows = filtered.map((s,i) => `<tr class="${i%2===1?'even':''}">
    ${showMajor ? `<td>${(majorMap&&majorMap[s.major])||s.major}</td>` : ''}
    <td class="bold">${s.university||''}</td>
    <td class="center">${s.type||''}</td>
    <td>${s.faculty||''}</td>
    <td>${s.department||''}</td>
    <td>${s.course||''}</td>
    <td>${s.admission_type||''}</td>
    <td>${s.doc_review_period||''}</td>
    <td>${s.application_period||''}</td>
    <td>${s.written_exam||''}</td>
    <td>${s.oral_exam||''}</td>
    <td>${s.result_date||''}</td>
    <td class="center" style="color:${engColor(s.english_required)};font-weight:700">${s.english_required||'-'}</td>
    <td class="center" style="color:${engColor(s.japanese_required)};font-weight:700">${s.japanese_required||'-'}</td>
  </tr>`).join('');

  const theadCells = colDefs.map(([l,,g]) =>
    `<th style="background:${thColors[g].bg};border-color:${thColors[g].border}">${l}</th>`
  ).join('');

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>${majorLabel} 出願学校名单 ${today}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Hiragino Sans','Noto Sans JP','Yu Gothic','MS Gothic',sans-serif;font-size:11px;color:#222;background:#fff;padding:20px}
  .title-block{margin-bottom:14px;border-left:4px solid #2c4a7c;padding-left:10px}
  h1{font-size:16px;font-weight:700;margin-bottom:4px}
  .meta{font-size:11px;color:#555;margin-bottom:3px}
  .filters{font-size:11px;color:#2c4a7c;background:#eef3fb;border-radius:3px;padding:4px 8px;display:inline-block;margin-top:4px}
  table{border-collapse:collapse;width:100%;table-layout:fixed;margin-top:12px}
  th{padding:6px 4px;text-align:left;font-size:10px;font-weight:700;color:#fff;border:1px solid #ccc;white-space:nowrap}
  td{padding:5px 4px;border:1px solid #ddd;vertical-align:top;word-break:break-all;line-height:1.5;font-size:11px}
  tr.even td{background:#f4f7fb}
  .bold{font-weight:700}.center{text-align:center}
  ${colDefs.map(([,w],i)=>`col:nth-child(${i+1}){width:${w}}`).join('')}
  #wm{position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:9999;overflow:hidden}
  #wm span{position:absolute;font-size:16px;font-weight:700;color:rgba(0,0,0,0.15);white-space:nowrap;transform:rotate(-35deg);letter-spacing:3px;font-family:sans-serif}
  @page{size:A3 landscape;margin:12mm}
  @media print{body{padding:0;font-size:10px}td{font-size:10px;padding:4px 3px}th{font-size:9px;padding:5px 3px}.title-block{margin-bottom:10px}#wm{position:fixed}}
</style></head><body>
<div class="title-block">
  <h1>${majorLabel} 可出願学校名单</h1>
  <div class="meta">唯新教育 · ${today} · 共 ${filtered.length} 条</div>
  <div class="filters">筛选条件：${filterLine}</div>
</div>
<table>
  <colgroup>${colDefs.map(([,w])=>`<col style="width:${w}">`).join('')}</colgroup>
  <thead><tr>${theadCells}</tr></thead>
  <tbody>${rows}</tbody>
</table>
<div style="margin-top:20px;padding:12px 14px;border:1px solid #ddd;border-radius:4px;background:#fafafa;font-size:10px;color:#666;line-height:1.9">
  <div style="font-weight:700;color:#444;margin-bottom:6px">📌 使用说明</div>
  <div>・<strong>旬的参考时间</strong>：上旬约为1日～10日，中旬约为11日～20日，下旬约为21日～月末。实际截止日期以各校官方募集要项为准。</div>
  <div>・<strong>出愿信息每年均有变化</strong>，本表格仅供参考，具体出愿期间、考试日程、募集人数等信息请务必确认当年度各校最新出愿要项。</div>
  <div>・<strong>语言成绩要求</strong>：各校对语言考试类型（JLPT / EJU / TOEFL / IELTS 等）及分数要求不同，部分学校另有内部要求，请以官方要项为准。</div>
  <div>・如有疑问请联系唯新教育老师确认。</div>
</div>
<div id="wm"></div>
<script>
(function(){
  var wm=document.getElementById('wm');
  var text='唯新教育  TRANSFORM EDUCATION';
  for(var y=-100;y<1000;y+=100){for(var x=-200;x<1600;x+=320){var s=document.createElement('span');s.textContent=text;s.style.left=x+'px';s.style.top=y+'px';wm.appendChild(s);}}
})();
</script>
</body></html>`;

  const blob = new Blob([html], {type:'text/html;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `出願名单_${majorLabel}_${today.replace(/\//g,'-')}.html`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 构建筛选条件描述文字（共享）
function buildAdmissionFilterDesc(opts) {
  const { english, japanese, search, monthFrom, monthTo, filtered } = opts;
  const desc = [];
  if (english && english !== 'all') desc.push(`英语：${english==='必須'?'必须':english==='任意'?'任意':'不要'}`);
  if (japanese && japanese !== 'all') desc.push(`日语：${japanese==='必須'?'必须':japanese==='任意'?'任意':'不要'}`);
  if (search && search.trim()) desc.push(`关键词：${search.trim()}`);
  if (monthFrom || monthTo) {
    desc.push(`出願：${monthFrom?monthFrom+'月':'不限'}～${monthTo?monthTo+'月':'不限'}`);
  }
  return desc.length ? desc.join('　|　') : '全部';
}

// ══════════════════════════════════
// 考学进度时间线 共享常量和工具函数
// ══════════════════════════════════

const PROGRESS_OPTIONS = {
  japanese: ['不需要','备考中','已报名(N2)','已报名(N1)','已报名(EJU)','成绩待出','N2合格','N1合格','EJU完成'],
  english:  ['不需要','备考中','已报名(TOEFL)','已报名(IELTS)','已报名(TOEIC)','已报名(GRE)','已报名(GMAT)','成绩待出','TOEFL完成','IELTS完成','TOEIC完成','GRE完成','GMAT完成','已完成'],
  plan:     ['未开始','收集资料中','撰写中','修改中','已完成'],
  apply:    ['择校确认中','联系教授中','材料准备中','已出愿','合格发表中','已合格'],
  exam:     ['不需要','笔试练习中','面试准备中','已完成'],
};

const PROGRESS_LABELS = {
  japanese: '日语成绩',
  english:  '英语成绩',
  plan:     '计划书',
  apply:    '出愿',
  exam:     '备考',
};

const PROGRESS_ICONS = {
  japanese: '🗣',
  english:  '📝',
  plan:     '📄',
  apply:    '🏫',
  exam:     '✏️',
};

// 每个维度的"完成"状态
const PROGRESS_DONE = {
  japanese: ['不需要','N2合格','N1合格','EJU完成'],
  english:  ['不需要','已完成'],
  plan:     ['已完成'],
  apply:    ['已合格'],
  exam:     ['不需要','已完成'],
};

// 来源标签
const PROGRESS_SOURCE_LABEL = {
  student: { label: '学生', color: '#1a6a9a', bg: '#e8f4fd' },
  teacher: { label: '老师', color: '#2a7a4a', bg: '#e4f5ee' },
  admin:   { label: 'Admin', color: '#7a3a8a', bg: '#f3e8fa' },
  booking: { label: '面谈记录', color: '#856404', bg: '#fff3cd' },
};

/**
 * 判断某个状态是否已完成
 */
function isProgressDone(dimension, value) {
  return value && (PROGRESS_DONE[dimension] || []).includes(value);
}

/**
 * 从时间线数组中提取每个维度的最新状态
 * @param {Array} timeline - student_progress_timeline 记录数组（按时间正序）
 */
function getLatestProgress(timeline) {
  const latest = { japanese: '', english: '', plan: '', apply: '', exam: '', notes: '' };
  if (!timeline || !timeline.length) return latest;
  // 按 created_at 正序，后面的覆盖前面的
  const sorted = [...timeline].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  sorted.forEach(entry => {
    Object.keys(latest).forEach(k => {
      if (entry[k]) latest[k] = entry[k];
    });
  });
  return latest;
}

/**
 * 生成一条进度时间线记录（插入前调用）
 */
function makeProgressEntry({ studentId, studentName, major, source, sourceName, bookingId, recordedAt, japanese, english, plan, apply, exam, notes }) {
  return {
    id: `spt-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
    student_id: studentId,
    student_name: studentName,
    major: major || '',
    japanese: japanese || '',
    english: english || '',
    plan: plan || '',
    apply: apply || '',
    exam: exam || '',
    notes: notes || '',
    source: source || 'admin',
    source_name: sourceName || '',
    booking_id: bookingId || '',
    recorded_at: recordedAt || '',
  };
}

/**
 * 渲染进度状态 badge
 */
function renderProgressBadge(dimension, value) {
  if (!value) return '<span style="font-size:10px;color:var(--text-3)">未填写</span>';
  const done = isProgressDone(dimension, value);
  const color = done ? 'var(--ok)' : value === '未开始' || value === '不需要' ? 'var(--text-3)' : 'var(--warn)';
  const bg = done ? 'var(--ok-bg)' : value === '未开始' || value === '不需要' ? 'var(--bg)' : 'var(--warn-bg)';
  return `<span style="font-size:10px;background:${bg};color:${color};padding:2px 8px;border-radius:3px;font-weight:600;white-space:nowrap">${value}</span>`;
}

/**
 * 渲染单条时间线记录
 */
function renderProgressTimelineEntry(entry, canEdit = false, onEdit = '') {
  const src = PROGRESS_SOURCE_LABEL[entry.source] || PROGRESS_SOURCE_LABEL.admin;
  const dims = ['japanese','english','plan','apply','exam'].filter(k => entry[k]);
  return `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-light)">
    <div style="min-width:60px;text-align:right">
      <span style="font-size:10px;background:${src.bg};color:${src.color};padding:1px 6px;border-radius:2px">${src.label}</span>
      ${entry.source_name ? `<div style="font-size:9px;color:var(--text-3);margin-top:2px">${entry.source_name}</div>` : ''}
    </div>
    <div style="flex:1">
      <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">${entry.recorded_at || entry.created_at?.slice(0,10) || ''}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px">
        ${dims.map(k => `<div style="font-size:11px">${PROGRESS_ICONS[k]} ${PROGRESS_LABELS[k]}：${renderProgressBadge(k, entry[k])}</div>`).join('')}
      </div>
      ${entry.notes ? `<div style="font-size:11px;color:var(--text-2);margin-top:4px">💬 ${entry.notes}</div>` : ''}
    </div>
    ${canEdit ? `<button onclick="${onEdit}" style="font-size:10px;background:none;border:1px solid var(--border);border-radius:2px;padding:2px 8px;cursor:pointer;color:var(--text-3);white-space:nowrap;align-self:flex-start">编辑</button>` : ''}
  </div>`;
}

// ── 志望校推进状态（学生/老师/admin 共用） ──
const SCHOOL_STATUS_LABELS = {
  preparing: { t:'已选定・未联系教授', c:'#8a7a68' },
  contacted: { t:'已发邮件・待教授回复', c:'#b8860b' },
  prof_ok:   { t:'教授回复可报考', c:'#2a9e6a' },
  prof_ng:   { t:'教授婉拒・需换校', c:'#b03a2e' },
  applied:   { t:'已出愿', c:'#2a6aad' },
  passed:    { t:'合格 🎉', c:'#2a9e6a' },
  failed:    { t:'不合格', c:'#b03a2e' },
};
function schoolStatusLabel(v) { return SCHOOL_STATUS_LABELS[v] || SCHOOL_STATUS_LABELS.preparing; }
