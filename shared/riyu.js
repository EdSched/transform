// ══════════════════════════════════
// riyu.js — 志望理由书（新版，学部 gakubu_riyu / 大学院 grad_riyu 共用）
// 写作指导：writing_guides 表（admin 考学进度 →「📁 出愿材料准备」→「✍ 文书指导」维护）
// 提交记录：riyu_submissions 表（学生按志望校逐校撰写 → 提交 → 老师下载 Word / 上传批复版）
// 学生端撰写组件在 student/study.js；本文件放三端共用的：指导读取、状态、统计、老师/管理端的逐校列表与操作
// 依赖：shared/supabase.js、shared/constants.js（riyuKeyOf）
// ══════════════════════════════════

const RIYU_KIND_LABEL = { gakubu_riyu: '学部', grad_riyu: '大学院' };

// 表里还没有指导内容时的兜底（与 PR 里 SQL 的初始内容相同；以 admin 里保存的为准）
const RIYU_GUIDE_SEED = {
  title: '志望理由书',
  intro: '按志望校逐校撰写：每一所学校写一份。建议先写「专业理由即契机」「学校理由」「学习计划」「毕业后计划」，最后再写「总结」。写完点「📤 提交给老师」，老师修改后会把批复版本发回这里。',
  sections: [
    { key: 'summary', title: '总结', subtitle: '放在最后写。一句话版本即可：【将来，为了＊＊＊，所以决定报名贵校的＊＊＊。】', tips: [] },
    { key: 'motive', title: '专业理由即契机', subtitle: '【因为什么样的事情，而决定报名这个专业。】', tips: [
      '一定要和自己有关系，不要仅仅是看到新闻、看到电影等',
      '一定要逻辑完善，也就是解释清楚：为了实现这个目的，为什么要报名这个专业',
      '如果完全没有思绪，有两个作弊方法：1. 看学校的教授，看他们的研究方法 2. 看这个专业的毕业方向',
    ] },
    { key: 'school', title: '学校理由', subtitle: '【因为什么样的理由，而决定报名这个学校。】', tips: [
      '要围绕契机和自己的未来方向，去选择学校理由',
      '一定要仔细看官网（随手记录所有觉得重要的内容，先不要做筛选）',
      '能写的大概内容【学校理念、课程设置、zemi 教授、交换留学、特色项目、实践重视等等】',
    ] },
    { key: 'study', title: '学习计划', subtitle: '【进入大学之后，整体的学习规划。】', tips: [
      '最简单的写法：大一学什么，大二学什么，大三学什么',
      '注意不要犯的尝试错误：1. 课程的名字以及年限，尤其是 zemi 2. 实习不是毕业后做的事情',
      '尽量不要去写设施相关的理由',
    ] },
    { key: 'career', title: '毕业后计划', subtitle: '【大学毕业之后，未来具体的规划。】', tips: [
      '一定要具体，让人看到清晰的画像，可以理解为这个是对面教授对你的最核心的认知',
      '大学院并不算很好的毕业后计划，大学院之后最好还有后续的计划',
    ] },
  ],
};

// 大学院出愿邮件（照志望理由书同一套：同一张表 riyu_submissions，用 kind 区分；邮件专属信息放 mail_meta）
const RIYU_MAIL_KINDS = ['grad_prof_mail', 'grad_inquiry_mail'];
function riyuIsMail(kind) { return RIYU_MAIL_KINDS.indexOf(kind) >= 0; }
// 管理端「文书指导」下拉：[kind, 名称]
const RIYU_GUIDE_KINDS = [['gakubu_riyu', '学部 · 志望理由书'], ['grad_riyu', '大学院 · 志望理由书'], ['grad_prof_mail', '大学院 · 联系教授邮件'], ['grad_inquiry_mail', '大学院 · 问询邮件']];
const RIYU_DOC_NAME = { gakubu_riyu: '志望理由书', grad_riyu: '志望理由书', grad_prof_mail: '联系教授邮件', grad_inquiry_mail: '问询邮件' };
const RIYU_PROF_STATUS = [['unsent', '未发送'], ['sent', '已发送'], ['agree', '已回复·同意'], ['decline', '已回复·婉拒'], ['noreply', '无回复']];
const RIYU_INQ_STATUS = [['unsent', '未发送'], ['sent', '已发送'], ['replied', '已回复']];

// 邮件两份兜底指导（表里没有时使用；以 admin「文书指导」里保存的为准）
const RIYU_GUIDE_SEEDS = {
  grad_prof_mail: {
    title: '联系教授邮件',
    intro: '联系教授的邮件**必须和志望校挂钩**：每所志望校写一封，按学校逐封撰写。\n- 邮件用**日文**写。\n- **联系教授前，先完成研究计划书**（邮件里要附计划书全文）。\n- 写完点「📤 提交给老师」，**老师确认后再发送**，不要自己先发。',
    sections: [
      { key: 'addr', title: '宛名', subtitle: '【○○先生】', tips: ['写教授的姓名 + 先生，不要写错姓名和汉字', '大学、研究科名称可以写在宛名上一行'] },
      { key: 'greet', title: '初次联系的问候与名乗り', subtitle: '【突然のメールにて失礼いたします。○○大学○○研究科の入学を希望しております、○○と申します。】', tips: ['一定要用です・ます体', '先说明是初次联系，再报上自己的所属和姓名'] },
      { key: 'know', title: '怎么知道教授的、对教授研究的了解', subtitle: '【○○先生のホームページを拝見し、…に大変興味を持ちました。】', tips: ['告诉教授自己从哪里得到他的邮箱（官网、论文、研究者数据库等）', '写出自己读过教授的哪篇论文 / 哪项研究，不要泛泛地夸'] },
      { key: 'purpose', title: '联系目的', subtitle: '【○年○月に修士課程へ入学を希望しており、先生のご指導を賜りたく、ご連絡いたしました。】', tips: ['写清楚几年几月入学、读修士、希望接受教授的指导', '不要写成小说，要简洁，让人一眼看懂你要什么'] },
      { key: 'self', title: '自我介绍', subtitle: '【本科大学、专业、毕业论文题目、工作经历。】', tips: ['只写和研究相关的经历，简洁', '毕业论文题目一定要写'] },
      { key: 'plan', title: '研究计划题目和简要内容', subtitle: '【研究計画書を添付いたしましたので、ご確認いただけますと幸いです。】', tips: ['写研究计划的题目和两三句话的内容', '附上计划书全文'] },
      { key: 'attach', title: '语言成绩和附件', subtitle: '【日本語能力試験 N1、英語の成績、履歴書、成績証明書、推薦状など。】', tips: ['附上成绩等能展示优势的材料', '逐项写清楚附了什么，附件文件名也要规范'] },
      { key: 'close', title: '结尾', subtitle: '【改めて、先生に指導教員をお引き受けいただきたく、お願い申し上げます。】', tips: ['再次表达希望教授担任指导教授', '结尾用「お忙しいところ恐縮ですが、ご検討のほどよろしくお願いいたします」这一类礼貌说法，最后署名并留联系方式'] },
    ],
  },
  grad_inquiry_mail: {
    title: '问询邮件',
    intro: '问询邮件用来向学校（研究科事務、入試係）确认出愿资格、出愿材料等问题。可以选择关联一所志望校，也可以「不指定学校」。\n- 邮件用**日文**写。\n- 提问要**简洁**，让人一眼看懂你要问什么。\n- 写完点「📤 提交给老师」，**老师确认后再发送**。',
    sections: [
      { key: 'subject', title: '件名', subtitle: '【○○に関する件について】', tips: ['件名要具体，让人一看就知道是什么事', '写上自己的姓名也可以，比如「出願資格に関する件（○○）」'] },
      { key: 'addr', title: '宛名', subtitle: '【○○研究科 入試係 御中】', tips: ['对部门 / 研究科用「御中」或「の方」，对老师用「先生」', '宛名要写完整的研究科名称'] },
      { key: 'greet', title: '挨拶与名乗り', subtitle: '【お世話になっております。／ 突然のメールにて失礼いたします。○○と申します。】', tips: ['一定要用です・ます体'] },
      { key: 'intro', title: '简单自我介绍', subtitle: '【哪所大学毕业、现在在做什么。】', tips: ['一两句话即可，不要写成小说'] },
      { key: 'ask', title: '说明情况和要问的问题', subtitle: '【先说明情况，再列出想确认的问题。】', tips: ['简短、一次问清楚；多个问题分条写', '让人一眼看懂你要问什么'] },
      { key: 'attach', title: '添付说明', subtitle: '【○○を添付させていただきました。】', tips: ['有附件就写清楚附了什么；没有附件可以不填'] },
      { key: 'close', title: '结尾', subtitle: '【ご確認いただけますと幸いです。／ お手数をおかけしますが、ご確認のほどよろしくお願いいたします。】', tips: ['结尾礼貌收束，最后署名并留联系方式'] },
    ],
  },
};

function riyuEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

// 简单排版：**粗体**、- 列表、换行（指导说明用）
function riyuMd(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let out = '', list = [];
  const inl = s => riyuEsc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const flush = () => { if (list.length) { out += `<ul style="margin:2px 0 6px 1.3em">${list.map(x => `<li>${inl(x)}</li>`).join('')}</ul>`; list = []; } };
  lines.forEach(l => {
    const t = l.trim();
    if (/^[-・]\s?/.test(t)) { list.push(t.replace(/^[-・]\s?/, '')); return; }
    flush();
    out += t ? `<div>${inl(t)}</div>` : '<div style="height:6px"></div>';
  });
  flush();
  return out;
}

// ── 写作指导 ──
const riyuGuideCache = {};
function riyuNormGuide(row) {
  const g = Object.assign({ title: '', intro: '', sections: [] }, row || {});
  let secs = g.sections;
  if (typeof secs === 'string') { try { secs = JSON.parse(secs); } catch (e) { secs = []; } }
  g.sections = (Array.isArray(secs) ? secs : []).filter(s => s && s.key).map(s => ({
    key: String(s.key), title: s.title || '', subtitle: s.subtitle || '',
    tips: Array.isArray(s.tips) ? s.tips.filter(t => String(t || '').trim()) : [],
  }));
  return g;
}
async function riyuLoadGuide(kind, force) {
  if (!force && riyuGuideCache[kind]) return riyuGuideCache[kind];
  let row = null;
  try { row = (await sb(`/rest/v1/writing_guides?kind=eq.${encodeURIComponent(kind)}&select=*`) || [])[0] || null; }
  catch (e) { row = null; }
  const g = riyuNormGuide(row || Object.assign({ kind }, JSON.parse(JSON.stringify(RIYU_GUIDE_SEEDS[kind] || RIYU_GUIDE_SEED))));
  g.kind = kind; g._fromDb = !!row;
  riyuGuideCache[kind] = g;
  return g;
}

// 大学院邮件文书「管理端已保存过指导」的 kind 列表（writing_guides 里有这一行才算）：决定计划书位置是否出现这两封邮件
// 学生端「计划书」Tab、老师端 / 管理端的计划书部分都按它判断，不依赖出愿材料清单里有没有条目
const RIYU_MAIL_SAVED = { loaded: false, kinds: [] };
async function riyuMailSavedLoad(force) {
  if (RIYU_MAIL_SAVED.loaded && !force) return RIYU_MAIL_SAVED.kinds;
  try {
    const rows = await sb(`/rest/v1/writing_guides?kind=in.(${RIYU_MAIL_KINDS.join(',')})&select=kind`, 'GET', null, { cache: 'no-store' });
    RIYU_MAIL_SAVED.kinds = RIYU_MAIL_KINDS.filter(k => (rows || []).some(r => r.kind === k));
    RIYU_MAIL_SAVED.loaded = true;
  } catch (e) { /* 读取失败：保持原样，不当作「没保存」缓存 */ }
  return RIYU_MAIL_SAVED.kinds;
}
function riyuMailSavedKinds() { return RIYU_MAIL_SAVED.kinds.slice(); }
function riyuMailSavedMark(kind) { if (riyuIsMail(kind) && RIYU_MAIL_SAVED.kinds.indexOf(kind) < 0) RIYU_MAIL_SAVED.kinds.push(kind); }

// ── 状态 / 统计 ──
function riyuStatusInfo(status) {
  if (status === 'submitted') return { t: '已提交 · 待老师批复', c: '#b8860b', bg: '#fdf6e3' };
  if (status === 'reviewed') return { t: '已批复', c: '#2a7a4a', bg: '#e4f0e8' };
  if (status === 'draft') return { t: '草稿', c: '#6a6560', bg: '#f0ede8' };
  return { t: '未开始', c: '#9a9590', bg: '#f7f5f0' };
}
function riyuSecs(sub) {
  let v = sub && sub.sections;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = {}; } }
  return v && typeof v === 'object' ? v : {};
}
function riyuHistory(sub) {
  let v = sub && sub.history;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = []; } }
  return Array.isArray(v) ? v : [];
}
// 邮件专属信息 mail_meta：联系教授 {prof_name,email,status,sent_date,reply}；问询 {target,email,status,reply,link_key}
function riyuMeta(sub) {
  let v = sub && sub.mail_meta;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = {}; } }
  return v && typeof v === 'object' ? v : {};
}
function riyuMailStatusText(kind, st) {
  const list = kind === 'grad_inquiry_mail' ? RIYU_INQ_STATUS : RIYU_PROF_STATUS;
  return (list.find(x => x[0] === (st || 'unsent')) || list[0])[1];
}
// 志望校旁的小标签：教授：未联系 / 已发送 / 同意 / 婉拒 / 无回复（subs 为该生全部提交记录）
function riyuProfTagInfo(plan, subs) {
  const sub = riyuSubOf(plan, subs, 'grad_prof_mail');
  const st = (sub && riyuMeta(sub).status) || 'unsent';
  if (st === 'agree') return { t: '同意', c: '#2a7a4a', bg: '#e4f0e8' };
  if (st === 'decline') return { t: '婉拒', c: '#b03a2e', bg: '#fdecea' };
  if (st === 'sent') return { t: '已发送', c: '#a0621a', bg: '#fdf1e6' };
  if (st === 'noreply') return { t: '无回复', c: '#6a6560', bg: '#f0ede8' };
  return { t: '未联系', c: '#8a8580', bg: '#f0ede8' };
}
function riyuProfTagHtml(plan, subs) {
  const i = riyuProfTagInfo(plan, subs);
  return `<span style="display:inline-block;font-size:10px;line-height:1.5;padding:0 7px;border-radius:9px;background:${i.bg};color:${i.c};white-space:nowrap;font-weight:400">教授：${i.t}</span>`;
}

// 每所志望校对应的提交记录（按 riyuKeyOf 匹配）
function riyuSubOf(plan, subs, kind) {
  const k = riyuKeyOf(plan);
  return (subs || []).find(x => x.school_key === k && (!kind || x.kind === kind)) || null;
}
// {total, submitted, reviewed}：已提交=待批复+已批复
function riyuCounts(plans, subs, kind) {
  const list = plans || [];
  let submitted = 0, reviewed = 0;
  list.forEach(p => {
    const s = riyuSubOf(p, subs, kind);
    if (!s) return;
    if (s.status === 'submitted' || s.status === 'reviewed') submitted++;
    if (s.status === 'reviewed') reviewed++;
  });
  return { total: list.length, submitted, reviewed };
}
function riyuCountText(c) {
  if (!c.total) return '请先选志望校';
  if (!c.submitted) return `未提交（共 ${c.total} 校）`;
  return `已提交 ${c.submitted} / ${c.total} 校，已批复 ${c.reviewed} 校`;
}
function riyuFmtTime(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16); } catch (e) { return String(ts).slice(0, 16); }
}

// ══════════════════════════════════
// 老师端 / 管理端：逐校列表 + 查看 / 下载 Word / 上传批复版
// ══════════════════════════════════
// 当前页面登记的数据（按钮用 id 找回学生、学校、提交记录）
const RIYU_STAFF = { subs: {}, students: {}, plans: {}, onChange: null, onChangeBy: {} };   // onChangeBy：按学生 id 记回调（同页多个学生时各用各的）
function riyuReviewerName() { return (typeof teacherName !== 'undefined' && teacherName) ? teacherName : '管理员'; }

// student：学生对象；plans：志望校；subs：该生的提交记录；kind；onChange：批复后回调（重绘）
// 邮件：联系教授邮件按志望校逐校列出（志望校已删除的邮件也保留）；问询邮件按已写的邮件逐封列出
function riyuStaffListHtml(student, plans, subs, kind, onChange) {
  if (!student) return '';
  RIYU_STAFF.students[student.id] = student;
  if (onChange) { RIYU_STAFF.onChange = onChange; RIYU_STAFF.onChangeBy[student.id] = onChange; }
  const list = (plans || []).slice().sort((a, b) => (a.level || 2) - (b.level || 2));
  const btn = 'font-size:10px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--surface,#fff);padding:2px 8px;cursor:pointer;font-family:inherit;white-space:nowrap';
  const row = (sub, title, reqHtml, extra) => {
    if (sub) RIYU_STAFF.subs[sub.id] = sub;
    const st = riyuStatusInfo(sub && sub.status);
    const has = sub && Object.values(riyuSecs(sub)).some(v => String(v || '').trim());
    return `<div style="border:1px solid var(--border-light,#ede9e2);border-radius:5px;padding:8px 10px;margin-bottom:6px;background:var(--surface,#fff)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600">${riyuEsc(title)}</span>
        <span style="font-size:10px;padding:1px 8px;border-radius:10px;background:${st.bg};color:${st.c}">${st.t}</span>
        ${sub && sub.submitted_at ? `<span style="font-size:10px;color:var(--text-3,#999)">提交 ${riyuEsc(riyuFmtTime(sub.submitted_at))}</span>` : ''}
        <span style="margin-left:auto;display:flex;gap:4px;flex-wrap:wrap">
          ${has ? `<button onclick="event.stopPropagation();riyuStaffView('${riyuEsc(sub.id)}')" style="${btn}">👁 查看</button>
          <button onclick="event.stopPropagation();riyuStaffWord('${riyuEsc(sub.id)}')" style="${btn}">⬇ 下载 Word</button>
          <button onclick="event.stopPropagation();riyuStaffUpload('${riyuEsc(sub.id)}')" style="${btn};border-color:var(--accent,#b8953a);color:var(--accent,#b8953a)">⬆ 上传批复版</button>` : '<span style="font-size:10px;color:var(--text-3,#999)">学生尚未撰写</span>'}
        </span>
      </div>
      ${reqHtml ? `<div style="font-size:10px;color:var(--text-2,#5a5650);margin-top:3px">${reqHtml}</div>` : ''}
      ${extra || ''}
      ${sub && sub.status === 'reviewed' && sub.reviewed_file_url ? `<div style="font-size:10px;color:#2a7a4a;margin-top:3px">批复版：<a href="${riyuEsc(sub.reviewed_file_url)}" target="_blank" style="color:#2a7a4a">${riyuEsc(sub.reviewed_file_name || '下载')}</a> · ${riyuEsc(riyuFmtTime(sub.reviewed_at))} · ${riyuEsc(sub.reviewed_by || '')}</div>` : ''}
    </div>`;
  };
  // 邮件的发送信息一行（教授名 / 收件对象、发送状态、发送日期；老师可直接改发送状态）
  const mailLine = sub => {
    if (!sub) return '';
    const m = riyuMeta(sub), isProf = kind === 'grad_prof_mail';
    const stList = isProf ? RIYU_PROF_STATUS : RIYU_INQ_STATUS, cur = m.status || 'unsent';
    const col = cur === 'agree' ? '#2a7a4a' : cur === 'decline' ? '#b03a2e' : 'var(--text-2,#5a5650)';
    const who = isProf ? (m.prof_name ? '教授：' + riyuEsc(m.prof_name) : '教授：<span style="color:var(--text-3,#999)">未填</span>') : (m.target ? '收件：' + riyuEsc(m.target) : '收件：<span style="color:var(--text-3,#999)">未填</span>');
    return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10px;margin-top:4px;color:var(--text-2,#5a5650)">
      <span>${who}</span>${m.email ? `<span>${riyuEsc(m.email)}</span>` : ''}
      <span>发送状态 <select onclick="event.stopPropagation()" onchange="event.stopPropagation();riyuStaffMetaSet('${riyuEsc(sub.id)}','status',this.value)" style="font-size:10px;padding:1px 3px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--bg,#f7f5f0);font-family:inherit;color:${col};font-weight:600">${stList.map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l}</option>`).join('')}</select></span>
      ${isProf && m.sent_date ? `<span>发送日期 ${riyuEsc(m.sent_date)}</span>` : ''}
      ${m.reply ? `<span style="flex-basis:100%">回复要点：${riyuEsc(m.reply)}</span>` : ''}
    </div>`;
  };
  if (kind === 'grad_inquiry_mail') {
    const mine = (subs || []).filter(x => x.kind === kind).slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    if (!mine.length) return '<div style="font-size:11px;color:var(--text-3,#999)">学生还没有写问询邮件（学生可以不指定学校，也可以标记「不需要」）</div>';
    return mine.map((sub, i) => {
      const m = riyuMeta(sub);
      const sch = [sub.school_name, sub.faculty, sub.department].filter(Boolean).join(' · ');
      return row(sub, `问询邮件 ${i + 1}`, '关于：' + (sch ? riyuEsc(sch) : '<span style="color:var(--text-3,#999)">不指定学校</span>'), mailLine(sub));
    }).join('');
  }
  if (!list.length && !(kind === 'grad_prof_mail' && (subs || []).some(x => x.kind === kind))) return '<div style="font-size:11px;color:var(--text-3,#999)">尚无志望校，学生添加志望校后即可逐校撰写</div>';
  let html = list.map(p => {
    const sub = riyuSubOf(p, subs, kind);
    RIYU_STAFF.plans[student.id + '|' + riyuKeyOf(p)] = p;
    const title = [p.school_name, p.faculty, p.department].filter(Boolean).join(' · ') || '（未命名学校）';
    const label = riyuIsMail(kind) ? '' : '要求：';
    const req = kind === 'grad_prof_mail' ? '' : label + (p.plan_requirement ? riyuEsc(p.plan_requirement) : '<span style="color:var(--text-3,#999)">暂未填写要求</span>');
    return row(sub, title, req, kind === 'grad_prof_mail' ? mailLine(sub) : '');
  }).join('');
  if (kind === 'grad_prof_mail') {
    const keys = list.map(riyuKeyOf);
    (subs || []).filter(x => x.kind === kind && keys.indexOf(x.school_key) < 0).forEach(sub => {
      const title = [sub.school_name, sub.faculty, sub.department].filter(Boolean).join(' · ') || '（未命名学校）';
      html += row(sub, title, '<span style="color:#b03a2e">这所学校已不在志望校里</span>', mailLine(sub));
    });
  }
  return html;
}

// 老师 / 管理员改邮件的发送状态（写进 mail_meta）
async function riyuStaffMetaSet(subId, field, value) {
  const sub = RIYU_STAFF.subs[subId]; if (!sub) return;
  const meta = Object.assign({}, riyuMeta(sub), { [field]: value });
  try {
    const patch = { mail_meta: meta, updated_at: new Date().toISOString() };
    await sb(`/rest/v1/riyu_submissions?id=eq.${encodeURIComponent(sub.id)}`, 'PATCH', patch);
    Object.assign(sub, patch);
    const cb = RIYU_STAFF.onChangeBy[sub.student_id] || RIYU_STAFF.onChange;
    if (typeof cb === 'function') cb(sub);
  } catch (e) { alert('保存失败：' + e.message); }
}

async function riyuStaffView(subId) {
  const sub = RIYU_STAFF.subs[subId]; if (!sub) return;
  const g = await riyuLoadGuide(sub.kind);
  const secs = riyuSecs(sub);
  const stu = RIYU_STAFF.students[sub.student_id] || {};
  const order = g.sections.map(s => s.key);
  Object.keys(secs).forEach(k => { if (!order.includes(k)) order.push(k); });
  const docName = RIYU_DOC_NAME[sub.kind] || '志望理由书', mm = riyuMeta(sub), isMail = riyuIsMail(sub.kind);
  const metaLine = !isMail ? '' : (sub.kind === 'grad_prof_mail'
    ? [mm.prof_name && '教授：' + mm.prof_name, mm.email, '发送状态：' + riyuMailStatusText(sub.kind, mm.status), mm.sent_date && '发送日期：' + mm.sent_date, mm.reply && '回复要点：' + mm.reply]
    : [mm.target && '收件：' + mm.target, mm.email, '发送状态：' + riyuMailStatusText(sub.kind, mm.status), mm.reply && '回复要点：' + mm.reply]).filter(Boolean).join(' · ');
  document.getElementById('riyuViewModal')?.remove();
  const ov = document.createElement('div');
  ov.id = 'riyuViewModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:flex-start;justify-content:center;padding:30px 16px;overflow-y:auto';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div style="background:var(--surface,#fff);border-radius:6px;padding:18px 20px;max-width:720px;width:100%">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">
      <div style="font-size:14px;font-weight:600;flex:1">${riyuEsc(docName)} — ${riyuEsc(stu.name || '')}</div>
      <button onclick="document.getElementById('riyuViewModal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-3,#999)">×</button>
    </div>
    <div style="font-size:11px;color:var(--text-2,#5a5650);margin-bottom:10px">${riyuEsc([sub.school_name, sub.faculty, sub.department].filter(Boolean).join(' · '))}${sub.requirement && !isMail ? ' · 要求：' + riyuEsc(sub.requirement) : ''}${sub.submitted_at ? ' · 提交 ' + riyuEsc(riyuFmtTime(sub.submitted_at)) : ''}</div>
    ${metaLine ? `<div style="font-size:11px;color:var(--text-2,#5a5650);margin-bottom:10px">${riyuEsc(metaLine)}</div>` : ''}
    ${order.map(k => {
      const s = g.sections.find(x => x.key === k) || { title: k };
      const txt = String(secs[k] || '').trim();
      return `<div style="margin-bottom:10px"><div style="font-size:12px;font-weight:600;margin-bottom:3px">${riyuEsc(s.title)}</div>
        <div style="font-size:12px;line-height:1.9;white-space:pre-wrap;color:var(--text-2,#5a5650);background:var(--bg,#f7f5f0);border-radius:3px;padding:8px 10px">${txt ? riyuEsc(txt) : '<span style="color:#bbb">（未填写）</span>'}</div></div>`;
    }).join('')}
  </div>`;
  document.body.appendChild(ov);
}

async function riyuStaffWord(subId) {
  const sub = RIYU_STAFF.subs[subId]; if (!sub) return;
  const g = await riyuLoadGuide(sub.kind);
  const secs = riyuSecs(sub);
  const stu = RIYU_STAFF.students[sub.student_id] || {};
  const order = g.sections.map(s => s.key);
  Object.keys(secs).forEach(k => { if (!order.includes(k)) order.push(k); });
  const e = s => riyuEsc(s).replace(/\n/g, '<br>');
  const docName = RIYU_DOC_NAME[sub.kind] || '志望理由书', mm = riyuMeta(sub), isMail = riyuIsMail(sub.kind);
  const mailRows = !isMail ? '' : (sub.kind === 'grad_prof_mail'
    ? [['教授', mm.prof_name], ['教授邮箱', mm.email], ['发送状态', riyuMailStatusText(sub.kind, mm.status)], ['发送日期', mm.sent_date]]
    : [['收件对象', mm.target], ['对方邮箱', mm.email], ['发送状态', riyuMailStatusText(sub.kind, mm.status)]])
    .map(([k, v]) => `<tr><td style="padding:2pt 10pt 2pt 0;color:#666">${k}</td><td>${e(v || '—')}</td></tr>`).join('');
  const major = (typeof MAJORS !== 'undefined' && MAJORS[stu.major]) || stu.major || '';
  const body = `<h2 style="text-align:center;font-size:16pt">${e(g.title || docName)}</h2>
    <table style="border-collapse:collapse;font-size:11pt;margin-bottom:12pt">
      <tr><td style="padding:2pt 10pt 2pt 0;color:#666">学生</td><td>${e(stu.name || '')}${major ? '（' + e(major) + '）' : ''}</td></tr>
      <tr><td style="padding:2pt 10pt 2pt 0;color:#666">志望校</td><td>${e([sub.school_name, sub.faculty, sub.department].filter(Boolean).join(' ') || (isMail ? '（不指定学校）' : ''))}</td></tr>
      ${isMail ? mailRows : `<tr><td style="padding:2pt 10pt 2pt 0;color:#666">要求</td><td>${e(sub.requirement || '—')}</td></tr>`}
      <tr><td style="padding:2pt 10pt 2pt 0;color:#666">提交时间</td><td>${e(riyuFmtTime(sub.submitted_at) || '—')}</td></tr>
    </table>
    ${order.map(k => {
      const s = g.sections.find(x => x.key === k) || { title: k };
      return `<h3 style="font-size:12pt;margin:12pt 0 4pt">${e(s.title)}</h3><p style="margin:0">${e(String(secs[k] || '').trim() || '（未填写）')}</p>`;
    }).join('')}`;
  const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
<style>body{font-family:'Noto Serif SC','MS Mincho',serif;font-size:11pt;line-height:1.8}</style></head><body>${body}</body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const d = new Date();
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${docName}_${stu.name || ''}_${sub.school_name || ''}_${ds}.doc`.replace(/[\\/:*?"<>|]/g, '_');
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function riyuStaffUpload(subId) {
  const sub = RIYU_STAFF.subs[subId]; if (!sub) return;
  const stu = RIYU_STAFF.students[sub.student_id] || {};
  document.getElementById('riyuUpModal')?.remove();
  const ov = document.createElement('div');
  ov.id = 'riyuUpModal';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
  const inp = 'width:100%;box-sizing:border-box;font-size:12px;padding:7px 9px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:var(--bg,#f7f5f0);font-family:inherit';
  ov.innerHTML = `<div style="background:var(--surface,#fff);border-radius:6px;padding:18px 20px;max-width:460px;width:100%">
    <div style="font-size:14px;font-weight:600;margin-bottom:4px">上传批复版</div>
    <div style="font-size:11px;color:var(--text-2,#5a5650);margin-bottom:12px">${riyuEsc(stu.name || '')} · ${riyuEsc([sub.school_name, sub.faculty, sub.department].filter(Boolean).join(' · '))}</div>
    <label style="font-size:10px;color:var(--text-3,#999);display:block;margin-bottom:3px">批复文件（Word / PDF）</label>
    <input type="file" id="riyuUpFile" accept=".doc,.docx,.pdf" style="${inp};margin-bottom:10px">
    <label style="font-size:10px;color:var(--text-3,#999);display:block;margin-bottom:3px">批复备注（可选，学生能看到）</label>
    <textarea id="riyuUpNote" rows="2" placeholder="例：第二段逻辑再加强，其余可以" style="${inp};resize:vertical;margin-bottom:12px"></textarea>
    <div id="riyuUpMsg" style="font-size:11px;color:var(--danger,#b03a2e);min-height:14px;margin-bottom:6px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('riyuUpModal').remove()" style="font-size:12px;padding:7px 14px;border:1px solid var(--border,#e2ded6);border-radius:3px;background:none;cursor:pointer;font-family:inherit">取消</button>
      <button id="riyuUpBtn" onclick="riyuStaffUploadDo('${riyuEsc(subId)}')" style="font-size:12px;padding:7px 18px;border:none;border-radius:3px;background:var(--accent,#b8953a);color:#fff;cursor:pointer;font-family:inherit">上传并批复</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
async function riyuStaffUploadDo(subId) {
  const sub = RIYU_STAFF.subs[subId]; if (!sub) return;
  const f = (document.getElementById('riyuUpFile') || {}).files?.[0];
  const msg = document.getElementById('riyuUpMsg');
  if (!f) { if (msg) msg.textContent = '请选择文件'; return; }
  const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  if (!['doc', 'docx', 'pdf'].includes(ext)) { if (msg) msg.textContent = '只能上传 Word（doc / docx）或 PDF'; return; }
  const note = ((document.getElementById('riyuUpNote') || {}).value || '').trim();
  const btn = document.getElementById('riyuUpBtn'); if (btn) { btn.disabled = true; btn.textContent = '上传中…'; }
  try {
    const path = `riyu/${String(sub.student_id).replace(/[^A-Za-z0-9_-]/g, '_')}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const url = await sbUpload('teacher-files', path, f);
    const now = new Date().toISOString();
    const by = riyuReviewerName();
    const history = riyuHistory(sub).concat([{ at: now, by, action: 'review', file_url: url, file_name: f.name, note }]);
    const patch = { status: 'reviewed', reviewed_file_url: url, reviewed_file_name: f.name, reviewed_at: now, reviewed_by: by, review_note: note || null, history, updated_at: now };
    await sb(`/rest/v1/riyu_submissions?id=eq.${encodeURIComponent(sub.id)}`, 'PATCH', patch);
    Object.assign(sub, patch);
    document.getElementById('riyuUpModal')?.remove();
    const cb = RIYU_STAFF.onChangeBy[sub.student_id] || RIYU_STAFF.onChange;
    if (typeof cb === 'function') cb(sub);
    alert('已上传批复版，学生端这所学校会显示「已批复」和下载链接');
  } catch (e) {
    if (msg) msg.textContent = '上传失败：' + e.message;
    if (btn) { btn.disabled = false; btn.textContent = '上传并批复'; }
  }
}
