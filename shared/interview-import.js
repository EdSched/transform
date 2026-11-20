// ══════════════════════════════════
// interview-import.js — 面试题库批量导入解析器（纯函数，admin 页面与 tests/ 共用）
// 输入 tex / md / docx 转出的 html → 输出 chapters（形状见 seed/interview_bank.sql 说明）
// 规则：
//   章 = \chapter / #；题 = \section / ##；题内小标题 \subsection* / ###
//   题下段落：日文（假名占比高）→ example；中文为主 → tips；「注：」「回答方法：」「例：」前缀去掉后同样按此归类
//   tabular / md 表格 → 题的 keywords 关键词列表（只读，不要求作答）
//   逆質問章里的 itemize → 每个 \item 一题；章首说明、「注意点」→ 章 intro
//   题 key = 'q_' + hash(章标题 | 题面) 前 6 位，重复导入同一份手册 key 不变（学生答案以 key 为键）
// 没有 DOM 依赖（docx 转 html 的入口 iviHtmlToMd 只在浏览器用）
// ══════════════════════════════════

function iviHash(s) {   // FNV-1a 32 位 → 8 位 16 进制
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('00000000' + h.toString(16)).slice(-8);
}
function iviQKey(chapterTitle, q, used) {
  let n = 0, k;
  do { k = 'q_' + iviHash(chapterTitle + '|' + q + (n ? '|' + n : '')).slice(0, 6); n++; } while (used && used[k]);
  if (used) used[k] = 1;
  return k;
}
function iviKanaRatio(s) {
  const kana = (s.match(/[\u3040-\u30ff]/g) || []).length;
  const han = (s.match(/[\u3400-\u9fff]/g) || []).length;
  return kana + han ? kana / (kana + han) : 0;
}
// 日文参考答案？假名占比 ≥ 15%（中文指导里引用的零星日文词不会被算成参考例）
function iviIsJa(s) { return iviKanaRatio(s) >= 0.15; }

// 章名 → 默认 scope：每所志望校各答一份（school）还是只答一次（common）
function iviGuessScope(title) {
  return /志望動機|志望动机|大学院進学後|大学院进学后|卒業後|卒业后|研究計画書|研究计划书/.test(title) ? 'school' : 'common';
}

// ── tex → 块序列 ──
function iviTexInline(s) {
  let t = s;
  for (let i = 0; i < 4; i++) {   // 嵌套的 \textbf{\textcolor{..}{..}}
    t = t.replace(/\\textbf\{([^{}]*)\}/g, '**$1**')
      .replace(/\\(?:textit|emph|underline|textsf|texttt|textrm|textsc|mbox|hbox)\{([^{}]*)\}/g, '$1')
      .replace(/\\textcolor\{[^{}]*\}\{([^{}]*)\}/g, '$1')
      .replace(/\\color\{[^{}]*\}/g, '')
      .replace(/\\(?:footnotesize|small|large|Large|LARGE|huge|Huge|normalsize|bfseries|itshape|centering|raggedright)\b/g, '')
      .replace(/\\(?:vspace|hspace|setlength|addtolength)\*?\{[^{}]*\}(\{[^{}]*\})?/g, '')
      .replace(/\\(?:label|ref|cite|index|footnote|thispagestyle|pagestyle)\{[^{}]*\}/g, '');
  }
  return t.replace(/\\(?:newpage|clearpage|noindent|indent|hline|cline\{[^}]*\}|bigskip|medskip|smallskip|quad|qquad|tableofcontents|maketitle|centering)\b/g, ' ')
    .replace(/\\\\(\[[^\]]*\])?/g, '\n')
    .replace(/\\([%&_#$])/g, '$1').replace(/\\,|\\;|\\ /g, ' ').replace(/~/g, ' ')
    .replace(/---/g, '—').replace(/--/g, '–').replace(/``/g, '「').replace(/''/g, '」')
    .replace(/\\[a-zA-Z]+\*?/g, '').replace(/[{}]/g, '');
}
function iviBrace(src, i) {   // src[i] === '{'，返回 [内容, 结束位置]
  let d = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{' && src[j - 1] !== '\\') d++; else if (src[j] === '}' && src[j - 1] !== '\\') { d--; if (!d) break; } }
  return [src.slice(i + 1, j), j + 1];
}
function iviTexBlocks(tex) {
  let src = String(tex || '').replace(/\r/g, '').replace(/(^|[^\\])%.*$/gm, '$1');
  const b = src.indexOf('\\begin{document}'); if (b >= 0) src = src.slice(b + 16);
  const e = src.lastIndexOf('\\end{document}'); if (e >= 0) src = src.slice(0, e);
  const blocks = [];
  let i = 0, buf = '';
  const flush = () => {
    const txt = iviTexInline(buf);
    buf = '';
    txt.split(/\n\s*\n|\\par\b/).forEach(p => { const t = p.split('\n').map(x => x.trim()).filter(Boolean).join('\n'); if (t) blocks.push({ t: 'para', text: t }); });
  };
  // 用于 \par 切段：iviTexInline 之前先把 \par 换成空行
  src = src.replace(/\\par\b/g, '\n\n');
  const headRe = /\\(chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/y;
  while (i < src.length) {
    if (src[i] === '\\') {
      headRe.lastIndex = i;
      const m = headRe.exec(src);
      if (m) {
        flush();
        const [title, end] = iviBrace(src, i + m[0].length - 1);
        blocks.push({ t: m[1] === 'chapter' ? 'chapter' : m[1] === 'section' ? 'section' : 'sub', title: iviTexInline(title).replace(/\s+/g, ' ').trim(), level: m[1] });
        i = end; continue;
      }
      const env = /^\\begin\{(tabular\*?|longtable|itemize|enumerate|description)\}/.exec(src.slice(i, i + 40));
      if (env) {
        flush();
        const name = env[1], endTag = `\\end{${name}}`;
        const from = i + env[0].length, to = src.indexOf(endTag, from);
        let body = to >= 0 ? src.slice(from, to) : src.slice(from);
        i = to >= 0 ? to + endTag.length : src.length;
        if (/^tabular|longtable/.test(name)) {
          body = body.replace(/^\s*(\[[^\]]*\])?\s*\{[^{}]*\}/, '');
          const cells = [];
          body.split(/\\\\/).forEach(row => row.split(/(?<!\\)&/).forEach(c => { const t = iviTexInline(c.replace(/\\hline/g, '')).replace(/\s+/g, ' ').trim(); if (t) cells.push(t); }));
          blocks.push({ t: 'table', cells });
        } else {
          const items = body.split(/\\item\b/).slice(1).map(x => iviTexInline(x).split('\n').map(y => y.trim()).filter(Boolean).join(' ').trim()).filter(Boolean);
          blocks.push({ t: 'list', items, ordered: name === 'enumerate' });
        }
        continue;
      }
    }
    buf += src[i++];
  }
  flush();
  return blocks;
}

// ── md → 块序列 ──
function iviMdBlocks(md) {
  const blocks = [], lines = String(md || '').replace(/\r/g, '').split('\n');
  let para = [], list = null, table = null;
  const fp = () => { if (para.length) { blocks.push({ t: 'para', text: para.join('\n') }); para = []; } };
  const fl = () => { if (list) { blocks.push({ t: 'list', items: list }); list = null; } };
  const ft = () => { if (table) { blocks.push({ t: 'table', cells: table }); table = null; } };
  const all = () => { fp(); fl(); ft(); };
  lines.forEach(raw => {
    const l = raw.trim();
    let m;
    if (!l) { all(); return; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { all(); const n = m[1].length; blocks.push({ t: n === 1 ? 'chapter' : n === 2 ? 'section' : 'sub', title: m[2].trim(), level: n === 3 ? 'subsection' : 'subsubsection' }); return; }
    if (/^\|.*\|$/.test(l)) {
      fp(); fl();
      if (/^\|[\s:\-|]+\|$/.test(l)) return;
      table = table || [];
      l.slice(1, -1).split('|').forEach(c => { const t = c.trim(); if (t) table.push(t); });
      return;
    }
    if ((m = /^[-*・]\s+(.*)$/.exec(l))) { fp(); ft(); list = list || []; list.push(m[1].trim()); return; }
    if ((m = /^>\s*(.*)$/.exec(l))) { all(); blocks.push({ t: 'para', text: m[1].replace(/^指导[:：]\s*/, '指导：') }); return; }
    ft(); fl(); para.push(l);
  });
  all();
  return blocks;
}

// docx → mammoth 的 html → md 文本（仅浏览器：用 DOMParser）
function iviHtmlToMd(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const txt = n => n.textContent.replace(/\s+/g, ' ').trim();
  [...doc.body.children].forEach(el => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'h1') out.push('# ' + txt(el));
    else if (tag === 'h2') out.push('## ' + txt(el));
    else if (/^h[3-6]$/.test(tag)) out.push('### ' + txt(el));
    else if (tag === 'p') { const t = txt(el); if (t) out.push(t); }
    else if (tag === 'ul' || tag === 'ol') [...el.querySelectorAll('li')].forEach(li => out.push('- ' + txt(li)));
    else if (tag === 'table') [...el.querySelectorAll('tr')].forEach((tr, i) => { out.push('| ' + [...tr.children].map(txt).join(' | ') + ' |'); if (!i) out.push('|---|'); });
    out.push('');
  });
  return out.join('\n');
}

// ── 块序列 → 章 ──
const IVI_PREFIX = /^(注意?|回答方法|回答方式|指导|例|例如|参考例|参考)[:：]\s*/;
function iviClassify(text) {   // → [tips|example, 去掉前缀的文字]
  let t = String(text || '').trim().replace(/^\*\*([^*\n]{1,8}[:：])\*\*\s*/, '$1'), forced = '';
  const m = IVI_PREFIX.exec(t);
  if (m) { t = t.slice(m[0].length).trim(); if (/^指导/.test(m[1])) forced = 'tips'; else if (/^(例|参考)/.test(m[1])) forced = ''; }
  if (forced) return [forced, t];
  return [iviIsJa(t) ? 'example' : 'tips', t];
}
// 一个段落里「注：」「例：」等前缀另起一行时，按前缀切成几段分别归类
function iviSegments(text) {
  const segs = [];
  String(text || '').split('\n').forEach(l => {
    const t = l.trim().replace(/^\*\*([^*\n]{1,8}[:：])\*\*\s*/, '$1');
    if (!t) return;
    if (!segs.length || IVI_PREFIX.test(t)) segs.push(t); else segs[segs.length - 1] += '\n' + t;
  });
  return segs;
}
function iviBuild(blocks) {
  const chapters = [];
  let ch = null, q = null, usedKeys = {};
  const newChapter = title => { ch = { key: '', title, intro: '', scope: iviGuessScope(title), type: 'qa', items: [], _introParts: [] }; chapters.push(ch); q = null; };
  const newItem = (title, extra) => {
    if (!ch) newChapter('（未分章）');
    q = Object.assign({ key: iviQKey(ch.title, title, usedKeys), q: title, tips: '', example: '', required: true, tags: [] }, extra || {});
    ch.items.push(q); return q;
  };
  let introMode = false;
  const isAsk = () => /逆質問|逆质问/.test(ch ? ch.title : '');
  blocks.forEach((b, idx) => {
    if (b.t === 'chapter') { introMode = false; newChapter(b.title); return; }
    if (b.t === 'section') { introMode = false; newItem(b.title); if (/^(はじめに|前言|序|说明|說明)$/.test(b.title)) q.required = false; return; }
    if (b.t === 'sub') {
      if (!ch) newChapter('（未分章）');
      introMode = false;
      if (/^注意/.test(b.title)) { introMode = true; ch._introParts.push('**' + b.title + '**'); return; }
      if (!q) { newItem(b.title); return; }
      // 小标题：直接在 q 里保留；是否拆成独立题在 iviSplitSubs 里统一判断
      q._cur = { title: b.title, tips: '', example: '', keywords: [] }; (q._parts = q._parts || []).push(q._cur);
      return;
    }
    if (!ch) newChapter('（未分章）');
    if (introMode) {
      if (b.t === 'para') ch._introParts.push(b.text);
      else if (b.t === 'list') b.items.forEach((x, n) => ch._introParts.push((b.ordered ? (n + 1) + '. ' : '- ') + x));
      return;
    }
    if (!q) {   // 章首：说明 / 注意点 / 列表 → intro
      if (b.t === 'para') ch._introParts.push(b.text);
      else if (b.t === 'list') b.items.forEach((x, n) => ch._introParts.push((b.ordered ? (n + 1) + '. ' : '- ') + x));
      else if (b.t === 'table') { newItem(ch.title); q.required = false; q.keywords = b.cells; }
      return;
    }
    const tgt = q._cur || q;
    const put = (field, text) => { if (!text) return; tgt[field] = tgt[field] ? tgt[field] + '\n' + text : text; };
    if (b.t === 'para') iviSegments(b.text).forEach(sg => { const [f, t] = iviClassify(sg); put(f, t); });
    else if (b.t === 'table') { const kw = [...new Set(b.cells.map(c => c.replace(/\s+/g, '').trim()).filter(Boolean))]; (tgt.keywords = tgt.keywords || []).push(...kw); q.required = false; }
    else if (b.t === 'list') {
      if (isAsk()) {   // 逆質問：每条一题，原文进 example
        const secTitle = q.q, keep = q;
        b.items.forEach((x, n) => { const it = newItem(b.items.length > 1 || keep.example || keep.tips ? `${secTitle}（${n + 1}）` : secTitle); it.example = x; it.required = false; });
        if (!keep.tips && !keep.example && !(keep.keywords || []).length && b.items.length && ch.items.indexOf(keep) >= 0 && keep !== q) ch.items.splice(ch.items.indexOf(keep), 1);
        ch.type = 'ask'; q = null;
      } else b.items.forEach((x, n) => { const [f, t] = iviClassify(x); put(f, (b.ordered ? (n + 1) + '. ' : '- ') + t); });
    }
  });
  return chapters;
}
// 收尾：合并小标题段落、判断小标题是否拆成独立题、生成章 key / intro
function iviFinish(chapters) {
  const out = [];
  const usedKeys = {};
  chapters.forEach((ch, ci) => {
    const items = [];
    ch.items.forEach(q => {
      const parts = q._parts || [];
      const base = { key: q.key, q: q.q, tips: q.tips || '', example: q.example || '', required: q.required, tags: q.tags || [] };
      if (q.keywords && q.keywords.length) base.keywords = [...new Set(q.keywords)];
      const split = parts.length >= 2 && !base.tips && !base.example && parts.every(p => p.title.length <= 8);
      if (split) {
        parts.forEach(p => items.push(Object.assign({ key: iviQKey(ch.title, p.title, usedKeys), q: p.title, tips: p.tips, example: p.example, required: !(p.keywords && p.keywords.length), tags: [] }, p.keywords && p.keywords.length ? { keywords: [...new Set(p.keywords)] } : {})));
        return;
      }
      parts.forEach(p => {
        ['tips', 'example'].forEach(f => { if (p[f]) base[f] = (base[f] ? base[f] + '\n' : '') + `**${p.title}**\n` + p[f]; });
        if (p.keywords && p.keywords.length) { base.keywords = [...new Set((base.keywords || []).concat(p.keywords))]; base.required = false; }
      });
      usedKeys[base.key] = 1;
      items.push(base);
    });
    const allKw = items.length && items.every(x => x.keywords && x.keywords.length);
    out.push({
      key: 'c' + String(ci + 1).padStart(2, '0'), title: ch.title, intro: ch._introParts.join('\n'),
      scope: ch.scope, type: ch.type === 'ask' ? 'ask' : allKw ? 'keywords' : 'qa', items,
    });
  });
  return out;
}
function iviParse(text, format) {
  const fmt = format || (/\\(chapter|section|begin)\b/.test(text) ? 'tex' : 'md');
  const blocks = fmt === 'tex' ? iviTexBlocks(text) : iviMdBlocks(text);
  return iviFinish(iviBuild(blocks));
}

// ── 合并到现有题库 ──
// 题 key 相同 → 更新 q / tips / example / keywords，不动学生答案；新题追加；
// 旧库里有、新文件里没有的题 → 不删除，标 hidden + gone（「新手册中已不存在」），手动添加的题（manual）不动
function iviMerge(existing, parsed) {
  const out = JSON.parse(JSON.stringify(existing || []));
  const stat = { chaptersNew: 0, itemsNew: 0, itemsUpdated: 0, itemsGone: 0 };
  const usedCk = {}; out.forEach(c => { usedCk[c.key] = 1; });
  const nextCk = () => { let n = out.length + 1, k; do { k = 'c' + String(n++).padStart(2, '0'); } while (usedCk[k]); usedCk[k] = 1; return k; };
  parsed.forEach(pc => {
    let c = out.find(x => x.title === pc.title);
    if (!c) { c = { key: nextCk(), title: pc.title, intro: pc.intro, scope: pc.scope, type: pc.type, items: [] }; out.push(c); stat.chaptersNew++; }
    else if (pc.intro) c.intro = pc.intro;
    const seen = {};
    pc.items.forEach(pi => {
      seen[pi.key] = 1;
      const old = c.items.find(x => x.key === pi.key);
      if (old) {
        Object.assign(old, { q: pi.q, tips: pi.tips, example: pi.example });
        if (pi.keywords) old.keywords = pi.keywords;
        delete old.hidden; delete old.gone; stat.itemsUpdated++;
      } else { c.items.push(Object.assign({}, pi)); stat.itemsNew++; }
    });
    c.items.forEach(x => { if (!seen[x.key] && !x.manual && !x.hidden) { x.hidden = true; x.gone = true; stat.itemsGone++; } });
  });
  return { chapters: out, stat };
}
function iviCount(chapters) {
  let items = 0, kw = 0;
  (chapters || []).forEach(c => (c.items || []).forEach(i => { items++; kw += (i.keywords || []).length; }));
  return { chapters: (chapters || []).length, items, keywords: kw };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { iviParse, iviMerge, iviCount, iviQKey, iviHash, iviIsJa, iviGuessScope, iviTexBlocks, iviMdBlocks };
