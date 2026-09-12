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

// ── 领域（domain）对照 ──
// 领域中文 ↔ 罗马音代码。中枢台卡片、访问钥匙标识都从这里读，统一来源避免不一致。
// 领域不常变；如需增删领域，改这一处即可。
const DOMAINS = [
  { code: 'daigakuin_bunka',   label: '大学院文科' },
  { code: 'daigakuin_rika',    label: '大学院理科' },
  { code: 'daigakuin_bijutsu', label: '大学院美术' },
  { code: 'gakubu_bunka',      label: '学部文科' },
  { code: 'gakubu_rika',       label: '学部理科' },
  { code: 'gengo',             label: '语言' },
];
// 领域中文 → 代码
function domainCode(label){ const d=DOMAINS.find(x=>x.label===label); return d?d.code:''; }
// 代码 → 领域中文
function domainLabel(code){ const d=DOMAINS.find(x=>x.code===code); return d?d.label:''; }

// ── 领域（domain）视角 ──
// CURRENT_DOMAIN：当前登录视角所在的领域。''（空）或 'all' 表示总览（admin 看全部）。
// 领域负责人登录后会被锁定为某个具体领域（如「大学院理科」）。
let CURRENT_DOMAIN = '';
// CURRENT_MAJOR：专业锁。空=不锁（看整个领域）；有值=锁定到某专业（专业钥匙用户）。
// 与 CURRENT_DOMAIN 并列的全局锁，任何页面需要时按它过滤即可（先课程页，以后可扩展）。
let CURRENT_MAJOR = '';
// MAJOR_DOMAIN：专业 key → 所属领域。
// 初始给 5 个写死的核心专业兜底 domain（都属大学院文科），保证 DB 未加载完/加载失败时领域也不错位；
// loadMajorsFromDB() 会用 DB majors.domain 覆盖/补充，日常修改一律走 DB，此处不锁死。
let MAJOR_DOMAIN = {
  keiei: '大学院文科',
  keizai: '大学院文科',
  shakai: '大学院文科',
  shinpan: '大学院文科',
  fukushi: '大学院文科',
};
// 判断某专业是否属于当前视角领域（总览时永远 true）
function majorInCurrentDomain(key) {
  if (!CURRENT_DOMAIN || CURRENT_DOMAIN === 'all') return true;
  return MAJOR_DOMAIN[key] === CURRENT_DOMAIN;
}
// 学生可见性（叠加逻辑，仅用于学生管理/学生页）：
// 学生的完整专业 = major(主) + extra_majors(附加，如日语/英语)。
// 只要任一专业属于当前视角（领域或专业锁），学生就可见——支持跨领域学生在多个领域被看到。
function studentInCurrentView(student) {
  if (!CURRENT_DOMAIN || CURRENT_DOMAIN === 'all') {
    if (!CURRENT_MAJOR) return true; // 总览无锁：全部可见
  }
  if (!student) return false;
  const majors = [];
  if (student.major) majors.push(student.major);
  (student.extra_majors || []).forEach(m => majors.push(m));
  // 主专业若是分组代码（社会人文组），展开成成员一起判断
  const expanded = [];
  majors.forEach(m => {
    if (typeof MAJOR_GROUPS !== 'undefined' && MAJOR_GROUPS[m]) expanded.push(...MAJOR_GROUPS[m]);
    else expanded.push(m);
  });
  return expanded.some(m => majorInCurrentView(m));
}

// 统一视角判断：某专业是否在「当前登录视角」内（跟随链接：领域链接=看整个领域；专业链接=只看该专业）
// 所有功能页（预约/时间槽/出勤等）都用它做数据过滤，标准一致。
// 空 major 的处理由调用方决定（如学部无专业课靠 domain 显示）。
function majorInCurrentView(major) {
  if (CURRENT_MAJOR) return major === CURRENT_MAJOR;       // 专业链接：锁定该专业
  if (!CURRENT_DOMAIN || CURRENT_DOMAIN === 'all') return true; // 总览：全部可见
  return majorInCurrentDomain(major);                       // 领域链接：该专业属于当前领域
}

// ── 专业派生工具（单一数据源；新增专业只需写入 DB majors 表，即可自动流通全站）──
// MAJOR_GROUPS：虚拟分组 key → 展开后的真实专业 key 列表（目前仅「社会人文」一组）
const MAJOR_GROUPS = { shakai_group: SHAKAI_GROUP };
// 核心专业的固定展示顺序；数据库新增的专业会自动追加到其后
const CORE_MAJOR_ORDER = ['keiei', 'keizai', 'shakai', 'shinpan', 'fukushi'];

// 所有「真实」专业 key（核心在前，DB 新增在后），不含虚拟分组 shakai_group
function allMajorKeys() {
  const keys = [...CORE_MAJOR_ORDER];
  Object.keys(MAJORS).forEach(k => { if (k !== 'shakai_group' && !keys.includes(k)) keys.push(k); });
  return keys;
}

// 把一个筛选 key 展开成真实专业 key 数组：
//   'all' → 全部真实专业；分组 key（如 shakai_group）→ 其成员；其他 → [自身]
function expandMajorFilter(key) {
  if (key === 'all') return allMajorKeys();
  // 选组（社会人文）：三个成员 + 组代码本身（社会人文大课 major=shakai_group 也显示）
  if (MAJOR_GROUPS[key]) return [key, ...MAJOR_GROUPS[key]];
  // 选单个专业（社会学）：只匹配自己，不带组代码——社会人文大课(共通课)不出现在单个专业里
  return [key];
}

// 筛选栏 chip 顺序：经营 经济 [社会人文组] 社会 新传 福祉 …新增专业追加末尾
//   opts.includeAll=true 时在最前面加入 'all'
function majorFilterKeys(opts = {}) {
  // 专业锁（专业钥匙用户）：只显示锁定的那一个专业，不能切换
  if (CURRENT_MAJOR) return [CURRENT_MAJOR];
  let ordered = ['keiei', 'keizai', 'shakai_group', 'shakai', 'shinpan', 'fukushi'];
  allMajorKeys().forEach(k => { if (!ordered.includes(k)) ordered.push(k); });
  // 领域视角过滤：非总览时，只保留属于当前领域的专业（shakai_group 组只要有成员在领域内就保留）
  if (CURRENT_DOMAIN && CURRENT_DOMAIN !== 'all') {
    ordered = ordered.filter(k => {
      if (k === 'shakai_group') return SHAKAI_GROUP.some(m => majorInCurrentDomain(m));
      return majorInCurrentDomain(k);
    });
  }
  return opts.includeAll ? ['all', ...ordered] : ordered;
}

// 生成 <option> 列表（默认所有真实专业，不含 all/分组）
function majorOptionsHtml(selectedKey, opts = {}) {
  const keys = opts.keys || allMajorKeys();
  let html = opts.placeholder ? `<option value="">${opts.placeholder}</option>` : '';
  html += keys.map(k => `<option value="${k}"${k === selectedKey ? ' selected' : ''}>${majorLabel(k)}</option>`).join('');
  return html;
}

// 中文名/别名 → 专业 key（Excel 导入等场景用）：先精确反查 MAJORS，再退回内置别名正则
function majorKeyFromText(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (MAJORS[t]) return t;                                   // 本身就是 key
  const rev = Object.entries(MAJORS).find(([, v]) => v === t);
  if (rev) return rev[0];                                    // 精确匹配中文名
  if (/社会人文/.test(t)) return 'shakai_group';
  if (/经营|経営/.test(t)) return 'keiei';
  if (/经济|経済/.test(t)) return 'keizai';
  if (/社会学/.test(t)) return 'shakai';
  if (/新闻|新传|新伝/.test(t)) return 'shinpan';
  if (/福祉/.test(t)) return 'fukushi';
  return '';
}

// 从数据库加载专业字典，合并进全局 MAJORS（不会清空/覆盖已有的核心专业）
// 各页面应在初始化阶段调用一次：await loadMajorsFromDB();
let majorsLoadedFromDB = false;
const MAJORS_JA = {};   // key → 日文专业名（人工填写，用于精确生成罗马音代号，也可用于对照日本大学院官方专业名）
async function loadMajorsFromDB() {
  try {
    const rows = await sb('/rest/v1/majors?select=key,label,domain,label_ja');
    (rows || []).forEach(r => {
      if (r.key && r.label) MAJORS[r.key] = r.label;
      if (r.key && r.domain) MAJOR_DOMAIN[r.key] = r.domain;
      if (r.key && r.label_ja) MAJORS_JA[r.key] = r.label_ja;
    });
    majorsLoadedFromDB = true;
  } catch (e) {
    // 加载失败不影响主流程，MAJORS 仍保留核心5个专业
  }
}

// 中文专业名 → 生成一个安全的英文 key（拼音首字母不可行时退回时间戳后缀，保证唯一）
function generateMajorKey(label) {
  // 常见专业汉字 → 日语罗马字读音（中/日两种写法都映射到同一个 key，风格与 keiei/shakai 一致）
  const kanji = {
    // 経済・経営・商
    '経':'kei','经':'kei','済':'zai','济':'zai','営':'ei','营':'ei','商':'shou',
    '会':'kai','計':'kei','计':'kei','金':'kin','融':'yuu','貿':'bou','贸':'bou','易':'eki',
    '産':'san','产':'san','業':'gyou','业':'gyou','労':'rou','劳':'rou','働':'dou','動':'dou',
    '財':'zai','财':'zai','税':'zei','銀':'gin','银':'gin','券':'ken','流':'ryuu','販':'han','贩':'han','売':'bai',
    // 社会・人文
    '社':'sha','福':'fuku','祉':'shi','人':'jin','類':'rui','类':'rui','民':'min','俗':'zoku','族':'zoku',
    '家':'ka','差':'sa','別':'betsu','别':'betsu','女':'jo','性':'sei','老':'rou','児':'ji','儿':'ji','障':'shou','碍':'gai','害':'gai',
    // 心理
    '心':'shin','理':'ri','臨':'rin','临':'rin','床':'shou','認':'nin','认':'nin','知':'chi',
    '発':'hatsu','发':'hatsu','達':'tatsu','达':'tatsu','精':'sei','神':'shin','脳':'nou','脑':'nou',
    // 教育
    '教':'kyou','育':'iku','員':'in','员':'in','職':'shoku','职':'shoku','幼':'you',
    // 法・政治
    '法':'hou','律':'ritsu','政':'sei','治':'ji','公':'kou','共':'kyou','権':'ken','权':'ken',
    '刑':'kei','訴':'so','诉':'so','訟':'shou','讼':'shou','憲':'ken','宪':'ken','行':'gyou',
    // 国際・地域
    '国':'koku','際':'sai','际':'sai','関':'kan','関':'kan','关':'kan','係':'kei','地':'chi','域':'iki',
    '比':'hi','較':'kaku','较':'kaku','東':'tou','东':'tou','亜':'a','亚':'a','洋':'you','欧':'ou','米':'bei',
    '係':'kei','系':'kei','媒':'bai','体':'tai','技':'gi',
    // 文化・言語・歴史
    '文':'bun','化':'ka','言':'gen','語':'go','语':'go','英':'ei','独':'doku','仏':'futsu','佛':'futsu',
    '中':'chuu','日':'nichi','韓':'kan','韩':'kan','露':'ro','漢':'kan','汉':'kan',
    '歴':'reki','歷':'reki','历':'reki','史':'shi','哲':'tetsu','宗':'shuu','倫':'rin','伦':'rin',
    '思':'shi','想':'sou','宇':'u','宙':'chuu','空':'kuu',
    // 芸術・デザイン・建築
    '芸':'gei','艺':'gei','術':'jutsu','术':'jutsu','美':'bi','建':'ken','築':'chiku','筑':'chiku',
    '都':'to','市':'shi','造':'zou','匠':'shou','図':'zu','图':'zu','画':'ga','絵':'e','绘':'e',
    '映':'ei','像':'zou','音':'on','楽':'gaku','乐':'gaku','演':'en','劇':'geki','剧':'geki','舞':'bu','踊':'you','写':'sha','真':'shin',
    // 情報・工学・理数
    '情':'jou','報':'hou','报':'hou','通':'tsuu','信':'shin','息':'soku','算':'san',
    '機':'ki','机':'ki','械':'kai','電':'den','电':'den','気':'ki','子':'shi','数':'suu','統':'tou','统':'tou',
    '量':'ryou','確':'kaku','率':'ritsu','工':'kou','材':'zai','料':'ryou','土':'do','木':'boku',
    '設':'setsu','设':'setsu','交':'kou','航':'kou','船':'sen','舶':'haku','資':'shi','资':'shi','源':'gen',
    // 理学・生命・医
    '物':'butsu','質':'shitsu','质':'shitsu','生':'sei','命':'mei','医':'i','薬':'yaku','药':'yaku',
    '看':'kan','護':'go','护':'go','保':'ho','健':'ken','栄':'ei','养':'you','養':'you','康':'kou',
    '化':'ka','学':'gaku','素':'so','分':'bun',
    // 農・環境
    '農':'nou','农':'nou','森':'shin','林':'rin','水':'sui','獣':'juu','兽':'juu','園':'en','园':'en',
    '環':'kan','环':'kan','境':'kyou','生態':'seitai',
    // 観光・メディア
    '観':'kan','观':'kan','光':'kou','旅':'ryo','放':'hou','送':'sou','新':'shin','聞':'bun','闻':'bun',
    '伝':'den','传':'den','播':'pa','編':'hen','编':'hen','集':'shuu',
  };
  // 假名（片/平）→ 罗马字：片假名先转平假名，逐音节转写，处理拗音(ゃゅょ)、促音(っ)、长音(ー)
  const kana = {
    'あ':'a','い':'i','う':'u','え':'e','お':'o',
    'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko','が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
    'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so','ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
    'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to','だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do',
    'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
    'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho','ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
    'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
    'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo','や':'ya','ゆ':'yu','よ':'yo',
    'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro','わ':'wa','を':'o','ん':'n',
    'ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o','ゔ':'vu',
  };
  const smallY = { 'ゃ':'ya','ゅ':'yu','ょ':'yo' };          // 孤立小假名兜底
  const yoonV = { 'ゃ':'a','ゅ':'u','ょ':'o' };              // 拗音时只取元音（きゃ=ky+a）
  const yoonBase = { 'き':'ky','ぎ':'gy','し':'sh','じ':'j','ち':'ch','ぢ':'j','に':'ny','ひ':'hy','び':'by','ぴ':'py','み':'my','り':'ry' };
  const kataToHira = ch => { const c = ch.charCodeAt(0); return (c >= 0x30A1 && c <= 0x30F6) ? String.fromCharCode(c - 0x60) : ch; };
  const isKana = ch => { const c = ch.charCodeAt(0); return (c >= 0x3040 && c <= 0x30FF) || c === 0x30FC; };
  function romajiFromKana(str) {
    const arr = [...str].map(kataToHira);
    let out = '', sokuon = false;
    for (let i = 0; i < arr.length; i++) {
      const ch = arr[i], nxt = arr[i + 1];
      if (ch === 'ー' || ch === '・' || ch === '･') continue;   // 长音/中点忽略
      if (ch === 'っ') { sokuon = true; continue; }             // 促音
      let r = '';
      if (yoonBase[ch] && yoonV[nxt] != null) { r = yoonBase[ch] + yoonV[nxt]; i++; } // 拗音 きゃ=kya
      else if (smallY[ch]) { r = smallY[ch]; }
      else if (kana[ch] != null) { r = kana[ch]; }
      else continue;
      if (sokuon) { r = (r[0] || '') + r; sokuon = false; }     // 促音重复下一辅音
      out += r;
    }
    return out;
  }
  // 常见「多音字」复合词：整体读音固定，优先按词匹配，避免拆单字读错
  // （如「画」在「計画=keikaku」读 kaku，在「絵画=kaiga」读 ga；「省」在「反省=hansei」读 sei，在「省庁=shouchou」读 shou）
  const COMPOUND = {
    '計画':'keikaku','企画':'kikaku','絵画':'kaiga','区画':'kukaku','映画':'eiga',
    '銀行':'ginkou','行政':'gyousei','旅行':'ryokou','行動':'koudou','施行':'shikou',
    '反省':'hansei','省略':'shouryaku','文部科学省':'monbukagakushou',
    '陶芸':'tougei','陶磁器':'toujiki','陶器':'touki',
    '市場':'shijou','立場':'tachiba','工場':'koujou',
    '経済産業':'keizaisangyou','電子商取引':'denshishoutorihiki',
    '都市計画':'toshikeikaku','地域計画':'chiikikeikaku',
  };
  {
    const src = String(label);
    for (const w of Object.keys(COMPOUND).sort((a,b)=>b.length-a.length)) {
      if (src.includes(w)) return COMPOUND[w];
    }
  }
  // 去掉常见词尾（不影响区分度），再逐字/逐音节转写
  let s = String(label).replace(/[\s\u3000]+/g, '')
    .replace(/(大学院|研究科|学部|学科|専攻|専修|专攻|专修|专业|课程|コース|学|科|論|论)/g, '');
  let key = '';
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (kanji[ch] != null) { key += kanji[ch]; i++; continue; }
    if (/[A-Za-z0-9]/.test(ch)) { key += ch.toLowerCase(); i++; continue; } // MBA / MOT / AI 等保留
    if (isKana(ch)) { let j = i; while (j < s.length && isKana(s[j])) j++; key += romajiFromKana(s.slice(i, j)); i = j; continue; }
    i++; // 其余字符（生僻字/符号）跳过
  }
  key = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key && !/^[a-z]/.test(key)) key = 'm' + key;  // 必须字母开头
  // 识别不出任何有效汉字/假名 → 返回空字符串，交给调用方决定（不再静默生成乱码）
  return key;
}
// 新增一个专业到数据库，返回生成的 key（重名/已存在则直接返回已有 key，不重复创建）
// 新增专业。keyArg 可选：传入则用你指定的英文代号（如 kannkou），留空则按拼音自动生成
async function createMajor(label, keyArg, domainArg, labelJaArg) {
  label = String(label || '').trim();
  if (!label) return null;
  const labelJa = String(labelJaArg || '').trim();
  const existing = Object.entries(MAJORS).find(([k, v]) => v === label);
  if (existing) return existing[0];
  let key = String(keyArg || '').trim().toLowerCase();
  if (key) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) { alert('英文代号格式不对：只能用小写字母/数字/下划线，且以字母开头（如 kannkou）'); return null; }
    if (key === 'all' || key === 'shakai_group') { alert(`「${key}」是系统保留字，请换一个`); return null; }
    if (MAJORS[key]) { alert(`英文代号「${key}」已被专业「${MAJORS[key]}」占用，请换一个`); return null; }
  } else {
    // 有日文专业名 → 按日文生成，准确得多（中文名常与日本大学院官方叫法不同，如「陶瓷」→「陶芸」）
    const guessed = generateMajorKey(labelJa || label);
    if (!guessed) {
      // 识别不出任何有效日语汉字/假名（常见原因：日文名那栏也填成了中文，或用了生僻字）
      const manual = prompt(
        `没能从「${labelJa || label}」识别出有效的日语读音，无法自动生成代号。\n\n`+
        `常见原因：日文专业名一栏填的还是中文（请填该专业在日语里的实际写法，如「陶瓷」应填「陶芸」），或用到了生僻汉字。\n\n`+
        `请直接输入一个代号（小写字母/数字/下划线，字母开头，如 tougei）：`, ''
      );
      const m = String(manual || '').trim().toLowerCase();
      if (!m || !/^[a-z][a-z0-9_]*$/.test(m)) { alert('未输入有效代号，已取消新建。'); return null; }
      key = m;
    } else {
      key = guessed;
    }
    if (MAJORS[key]) key = key + Date.now().toString(36).slice(-3);
  }
  const domain = String(domainArg || '').trim();
  try {
    const row = { key, label };
    if (domain) row.domain = domain;
    if (labelJa) row.label_ja = labelJa;
    await sb('/rest/v1/majors', 'POST', row);
    MAJORS[key] = label;
    if (domain) MAJOR_DOMAIN[key] = domain;
    if (labelJa) MAJORS_JA[key] = labelJa;
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
// ── 休讲/延期：与 sched 一致的单回日期算法 ──
// 全局假期（与 sched 共用 sched_holidays 表）
let HOLIDAYS = [];
async function loadHolidaysFromDB() {
  try { HOLIDAYS = await sb('/rest/v1/sched_holidays?select=*') || []; }
  catch (e) { HOLIDAYS = []; }
}
function dateInHoliday(d) {
  for (const h of HOLIDAYS) { const s = h.start_date, e = h.end_date || h.start_date; if (s && d >= s && d <= e) return true; }
  return false;
}
// 从 first 按 weekdays 排，遇全局假期(未豁免)或休讲(skip)跳过并顺延，排满 N 回。返回日期数组。
// c 需含：first_session_date, weekdays, skip_dates(可空), holiday_except(可空豁免)
function computeSessionDates(c, N) {
  const wdList = parseWeekdays(c.weekdays); // parseWeekdays 返回 getDay 体系(周日=0)
  if (!wdList.length || !c.first_session_date || !N) return [];
  const skip = new Set((c.skip_dates || '').split(',').map(s => s.trim()).filter(Boolean));
  const except = new Set((c.holiday_except || '').split(',').map(s => s.trim()).filter(Boolean));
  const out = []; let d = c.first_session_date, guard = 0;
  while (out.length < N && guard++ < 2000) {
    const wd = new Date(d + 'T12:00:00').getDay(); // 0=周日
    if (wdList.includes(wd)) {
      const blocked = (dateInHoliday(d) && !except.has(d)) || skip.has(d);
      if (!blocked) out.push(d);
    }
    if (out.length >= N) break;
    // 下一天
    const nx = new Date(d + 'T12:00:00'); nx.setDate(nx.getDate() + 1);
    d = nx.getFullYear() + '-' + String(nx.getMonth() + 1).padStart(2, '0') + '-' + String(nx.getDate()).padStart(2, '0');
  }
  return out;
}

function periodFromDate(dateStr) {
  if (!dateStr) return '未分期';
  const m = parseInt(dateStr.slice(5, 7));
  if (m >= 1 && m <= 3) return '1月期';
  if (m >= 4 && m <= 6) return '4月期';
  if (m >= 7 && m <= 9) return '7月期';
  return '10月期';
}

// ── 期数（可自定义的月份范围筛选器）──
// PERIODS：从 DB periods 表加载。每个期 = 名字 + 起始月 + 结束月（跨年时 end<start）。
// 期是筛选维度，不是给课贴的归属标签——点某个期=筛出开课月份落在该范围的课。
let PERIODS = [];
async function loadPeriodsFromDB() {
  try {
    const rows = await sb('/rest/v1/periods?select=*&order=sort_order.asc');
    PERIODS = rows || [];
  } catch (e) { PERIODS = []; }
}
// 某课的「有效期数」：手动指定(period_override)优先，否则按开课月份自动落入 PERIODS
function effectivePeriod(c) {
  if (c && c.period_override) return c.period_override;
  return periodFromDate(c && c.first_session_date);
}

// 某月份 m(1-12) 是否落在期 p 的范围内（支持跨年：end<start 表示跨年，如 9→1 = 9,10,11,12,1）
function monthInPeriod(m, p) {
  if (!p) return false;
  const s = p.start_month, e = p.end_month;
  if (s <= e) return m >= s && m <= e;      // 普通范围
  return m >= s || m <= e;                    // 跨年范围
}
// 某开课日期落在哪个期（返回期对象；用于分组/显示）。可能匹配多个，取第一个。
function periodOfDate(dateStr) {
  if (!dateStr) return null;
  const m = parseInt(dateStr.slice(5, 7));
  return PERIODS.find(p => monthInPeriod(m, p)) || null;
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
  if (str === null || str === undefined || str === '') return [];
  str = String(str);
  const days = [];
  // ① 中文：周X/星期X/礼拜X 及单字 一二三…日/天
  const cnMap = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
  const cnMatches = str.match(/[周星期礼拜]+\s*([日天一二三四五六])/g);
  if (cnMatches) { cnMatches.forEach(m => { const ch = m.slice(-1); if (ch in cnMap) days.push(cnMap[ch]); }); }
  // ② 数字：1-7（ISO：周一=1…周日=7），转 JS getDay()（周日=0）；7→0，1-6 原样
  const numMatches = str.match(/\d+/g);
  if (numMatches) { numMatches.forEach(n => { let v = parseInt(n, 10); if (v >= 1 && v <= 7) days.push(v === 7 ? 0 : v); }); }
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
  // 日本考试笔试/面试常分开进行，细分记录不合格发生在哪个阶段（旧数据的 failed 仍兼容显示）
  failed_written:   { t:'笔试不合格', c:'#b03a2e' },
  failed_interview: { t:'笔试合格・面试不合格', c:'#b03a2e' },
  failed:    { t:'不合格（未注明阶段）', c:'#b03a2e' },
};
const SCHOOL_FAILED_STATUSES = ['failed_written', 'failed_interview', 'failed'];
function schoolStatusLabel(v) { return SCHOOL_STATUS_LABELS[v] || SCHOOL_STATUS_LABELS.preparing; }
// 志望校级别：只用颜色区分，不用红黄绿圆圈
// 出愿数据库专业清单（唯一数据源：以后新增出愿专业只改这里，老师权限/出愿库/老师端出愿查询都会自动跟上）
const ADMISSION_MAJORS = {
  shakai:'社会学', keiei:'経営学', keizai:'経済学', shinpan:'新闻传播学',
  fukushi:'社会福祉学', nihongo:'日本语教育', hyosho:'表象文化・文学・哲学',
  seiji:'政治学', toyo:'東洋史', bunka:'文化人类学', mot:'MOT', tokei:'統計・計量',
  kyoiku:'教育学',
};
const SCHOOL_LEVEL_META = { 1:{t:'冲刺',c:'#c0392b'}, 2:{t:'匹配',c:'#b8860b'}, 3:{t:'保底',c:'#2a7a3a'} };
function schoolLevelHtml(lv){ const m=SCHOOL_LEVEL_META[lv]; return m ? `<span style="color:${m.c};font-weight:600">${m.t}</span>` : ''; }
function isSchoolFailed(v) { return SCHOOL_FAILED_STATUSES.includes(v); }
