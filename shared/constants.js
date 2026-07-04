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
