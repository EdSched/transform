#!/usr/bin/env node
// 页面挂载自检：查「语法 / 全局重名」查不出的那类——点击调用的函数不存在、getElementById 找不到元素、
// 关键功能（scripts/ui-manifest.json）的定义 / 调用点 / 元素 id / 按钮文字是否都还在。
// 纯 Node，不需要装任何依赖。用法：node scripts/check-ui-hooks.js     致命 → 退出码 1；只有提醒 → 0
// 页面 → 脚本 的读取与 check-globals.js 共用（scripts/lib/pages.js）。
const fs = require('fs'), path = require('path');
const { root, walk, loadPages } = require('./lib/pages');

const PAGES = p => ['admin/index.html', 'teacher/index.html', 'student/index.html', 'student/study.html'].includes(p) || /^sched\/[^/]+\.html$/.test(p);
const pages = loadPages(PAGES);
const allow = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui-hooks-allow.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui-manifest.json'), 'utf8'));
const fatal = [], warn = [];
const F = (loc, what, why) => fatal.push(`${loc} ${what} ${why}`);
const W = (loc, what, why) => warn.push(`${loc} ${what} ${why}`);

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
// 每个「文本单元」= 一个 html 文件，或一个 js 文件；内联脚本归在 html 里（行号用 html 的）
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const rel = f => path.relative(root, f);

// ───────── 定义收集 ─────────
const DEF_RES = [
  /\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
  /\b(?:window|globalThis|self)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g,
  /\b(?:window|globalThis|self)\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]\s*=(?!=)/g,
];
function defsOf(code, set) { DEF_RES.forEach(re => { re.lastIndex = 0; let m; while ((m = re.exec(code))) set.add(m[1]); }); return set; }
// 声明在解构里（const {a, b} = ...）的名字也算
function destructDefs(code, set) { const re = /\b(?:const|let|var)\s*[{[]([^}\]=]*)[}\]]\s*=/g; let m; while ((m = re.exec(code))) m[1].split(',').forEach(x => { const n = x.split(':').pop().split('=')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) set.add(n); }); return set; }

// 浏览器内置 / 常见全局（内联处理里会直接调用的）
const BUILTIN = new Set(('alert confirm prompt setTimeout clearTimeout setInterval clearInterval parseInt parseFloat isNaN Number String Boolean Array Object Set Map Date Math JSON encodeURIComponent decodeURIComponent encodeURI decodeURI fetch open print close focus blur if for while switch return function typeof new catch with void delete await async else do try finally in of event this document window location history navigator console eval Promise Error RegExp Symbol requestAnimationFrame cancelAnimationFrame escape unescape btoa atob confirm scrollTo getComputedStyle matchMedia').split(/\s+/));
(allow.builtinHandlers || []).forEach(n => BUILTIN.add(n));

// ───────── 1. 内联处理里调用的函数必须有定义 ─────────
// 取出 on*= 的值；JS 模板字符串里的 ${…} 先整个抹掉，引号里的字符串内容先抹掉，再取「不在 . 后面、后面紧跟 ( 」的名字
const ON_RE = /\bon(?:click|dblclick|change|input|keydown|keyup|keypress|submit|focus|blur|mouseover|mouseout|mouseenter|mouseleave|load|error|paste|drop|dragover|dragstart|dragend|dragenter|dragleave|contextmenu|scroll|toggle|select)\s*=\s*(\\?)(["'])/gi;
function stripTemplates(s) { let out = '', d = 0; for (let i = 0; i < s.length; i++) { if (s[i] === '$' && s[i + 1] === '{') { d++; i++; continue; } if (d && s[i] === '{') { d++; continue; } if (d && s[i] === '}') { d--; continue; } if (!d) out += s[i]; } return out; }
function handlerNames(val) {
  let v = stripTemplates(val);
  v = v.replace(/\\?"[^"]*\\?"/g, '""').replace(/\\?'[^']*\\?'/g, "''");
  const names = [], re = /(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g; let m;
  while ((m = re.exec(v))) names.push(m[2]);
  return names;
}
function scanHandlers(text, baseLine) {
  const out = []; ON_RE.lastIndex = 0; let m;
  while ((m = ON_RE.exec(text))) {
    const esc = m[1], q = m[2], start = m.index + m[0].length;
    // 值的结尾：同一种引号（模板字符串里可能带反斜杠），且遇到 ${ 要跳过整段
    let i = start, d = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '$' && text[i + 1] === '{') { d++; i++; continue; }
      if (d) { if (c === '{') d++; else if (c === '}') d--; continue; }
      if (c === '\n' && !esc) { /* 允许多行 */ }
      if (c === q && (esc ? text[i - 1] === '\\' : true) && !(esc === '' && text[i - 1] === '\\')) break;
    }
    out.push({ val: text.slice(start, i), line: baseLine + lineOf(text, m.index) - 1 });
  }
  return out;
}

// ───────── 2. getElementById 的 id 来源 ─────────
const ID_FACTORIES = ['ccOverlay'];     // 按参数建元素的函数：ccOverlay('xxx') 产出 id=xxx
function idSources(text) {
  const exact = new Set(), patterns = [];
  const add = s => {
    if (/\$\{/.test(s)) {
      // 模板拼的 id：${…} 里如果带字符串（如 ${f('track')}），把字符串当作结尾片段；纯动态（${x}）的不当来源，免得「什么 id 都有」
      const parts = s.split(/\$\{([^}]*)\}/);
      let rx = '', stat = 0;
      parts.forEach((p, i) => { if (i % 2 === 0) { rx += p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); stat += p.length; } else { const lit = (p.match(/['"`]([^'"`]+)['"`]/g) || []).map(x => x.slice(1, -1)).join(''); rx += '.*' + lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); stat += lit.length; } });
      if (stat >= 2) patterns.push(new RegExp('^' + rx + '$'));
    } else exact.add(s);
  };
  let m, re;
  re = /\bid\s*=\s*\\?"([^"\\<>]+)\\?"/g; while ((m = re.exec(text))) add(m[1]);
  re = /\bid\s*=\s*\\?'([^'\\<>]+)\\?'/g; while ((m = re.exec(text))) add(m[1]);
  re = /\.id\s*=\s*['"`]([^'"`]+)['"`]/g; while ((m = re.exec(text))) add(m[1]);
  re = /setAttribute\(\s*['"]id['"]\s*,\s*['"`]([^'"`]+)['"`]/g; while ((m = re.exec(text))) add(m[1]);
  re = /\bid\s*:\s*['"]([^'"]+)['"]/g; while ((m = re.exec(text))) add(m[1]);      // {id:'x'} 这类传参建元素
  { const GET = /^(getElementById|querySelector|querySelectorAll|el|\$|\$id|byId|qs|get|getAttribute|setAttribute|closest|matches|contains|includes|indexOf|startsWith|endsWith|has|add|remove|toggle|push|log|alert|confirm|require|split|test|exec|replace|getItem|setItem|removeItem|open|dispatchEvent|hasOwnProperty)$/;
    re = /([A-Za-z_$][\w$]*)\(\s*['"]([A-Za-z][\w-]*)['"]\s*[,)]/g; while ((m = re.exec(text))) if (!GET.test(m[1])) exact.add(m[2]); }      // inp('prc_name', …) / spEditorHtml('x', …)：id 当参数传进去建元素
  ID_FACTORIES.forEach(fn => { re = new RegExp('\\b' + fn + '\\(\\s*[\'"]([^\'"]+)[\'"]', 'g'); while ((m = re.exec(text))) add(m[1]); });
  return { exact, patterns };
}
function scanGetById(text, baseLine) {
  const out = [], re = /getElementById\(\s*(['"])([^'"]+)\1\s*\)(\s*(?:\?\.|\|\||\?\?|&&))?/g; let m;
  while ((m = re.exec(text))) { if (m[2].includes('${')) continue; out.push({ id: m[2], line: baseLine + lineOf(text, m.index) - 1, optional: !!m[3] }); }
  return out;
}

// ───────── 遍历：每个页面的 文本单元 ─────────
// 单元：页面 html 本身（行号从 1），页面加载的每个外部 js（去重）；内联脚本已包含在 html 里，不单独扫
const missingFn = new Map();     // 'file:line|name' -> Set(页面)
const optId = new Map();         // 找不到来源，但代码写了 ?. / || / && 容忍它不存在
const missingId = new Map();     // 'file:line|id'   -> Set(页面)
const usedAllow = new Set();
const unitFiles = new Set();     // 所有被页面用到的文件（给位置型检查用）
const handlerSeen = new Map();   // 'file:line|name' -> {file,line,name}
const pageUnits = pages.map(pg => {
  const units = [{ file: pg.rel, text: pg.html }];
  pg.scripts.filter(s => !s.inline).forEach(s => { if (!units.some(u => u.file === s.label)) units.push({ file: s.label, text: s.code }); });
  return { pg, units };
});
pageUnits.forEach(({ pg, units }) => {
  const defs = new Set(), ids = { exact: new Set(), patterns: [] };
  units.forEach(u => { defsOf(u.text, defs); destructDefs(u.text, defs); const s = idSources(u.text); s.exact.forEach(x => ids.exact.add(x)); ids.patterns.push(...s.patterns); });
  // 内联脚本里 var/function 也已经在 html 文本里，defsOf 已覆盖
  units.forEach(u => {
    unitFiles.add(u.file);
    scanHandlers(u.text, 1).forEach(h => handlerNames(h.val).forEach(n => {
      if (BUILTIN.has(n) || defs.has(n)) return;
      if (new RegExp('typeof\\s+' + n + '\\b').test(u.text.split('\n')[h.line - 1] || '')) return;   // 同一行有 typeof 判断：函数不存在时按钮不会出现
      const k = `${u.file}:${h.line}|${n}`; if (!missingFn.has(k)) missingFn.set(k, new Set()); missingFn.get(k).add(pg.rel);
    }));
    scanGetById(u.text, 1).forEach(g => {
      if (ids.exact.has(g.id) || ids.patterns.some(p => p.test(g.id))) return;
      if (new RegExp('typeof\\s').test(u.text.split('\n')[g.line - 1] || '')) return;   // 同一行有 typeof 判断：别的页面没有这个功能时会被跳过
      if (g.optional) { const k = `${u.file}:${g.line}|${g.id}`; if (!optId.has(k)) optId.set(k, new Set()); optId.get(k).add(pg.rel); return; }
      const k = `${u.file}:${g.line}|${g.id}`; if (!missingId.has(k)) missingId.set(k, new Set()); missingId.get(k).add(pg.rel);
    });
  });
});
// 放行处理
const allowFn = allow.functions || {}, allowId = allow.ids || {};
for (const [k, pgs] of missingFn) { const [loc, name] = k.split('|'); if (allowFn[name]) { usedAllow.add('functions:' + name); continue; } F(loc, `点击调用了不存在的函数 ${name}()`, `（页面：${[...pgs].join('、')}）`); }
for (const [k, pgs] of missingId) { const [loc, id] = k.split('|'); if (allowId[id]) { usedAllow.add('ids:' + id); continue; } F(loc, `getElementById('${id}') 找不到来源`, `（页面：${[...pgs].join('、')}；HTML / 模板 / el.id= / ccOverlay 都没有这个 id）`); }

for (const [k, pgs] of optId) { const [loc, id] = k.split('|'); if (!allowId[id]) W(loc, `getElementById('${id}') 找不到来源（代码已容忍不存在）`, `（页面：${[...pgs].join('、')}）`); }

// ───────── 3. 位置型取元素（只提醒） ─────────
const POS_RE = /firstElementChild|lastElementChild|nextElementSibling|previousElementSibling|\.children\[|:last-child|:first-child|parentNode\.parentNode/;
const skipPos = f => /(^|\/)vendor\//.test(f);
[...unitFiles].filter(f => !skipPos(f)).sort().forEach(f => {
  read(f).split('\n').forEach((ln, i) => { if (POS_RE.test(ln)) W(`${f}:${i + 1}`, `依赖页面结构取元素：${ln.trim().slice(0, 160)}`, '（上面插一行，这里就可能找不到）'); });
});

// ───────── 5. 没人调用的函数（只提醒） ─────────
{
  const files = walk(root).filter(f => /\.(js|html)$/.test(f)).map(rel).filter(f => !/^(tests|scripts|seed)\//.test(f) && !/(^|\/)vendor\//.test(f) && !/\.min\.js$/.test(f));
  const texts = {}; files.forEach(f => texts[f] = read(f));
  const all = files.map(f => texts[f]).join('\n');
  const counts = {}; (all.match(/[A-Za-z_$][\w$]*/g) || []).forEach(w => counts[w] = (counts[w] || 0) + 1);
  const defCounts = {}; { const re = /(?:function\s*\*?\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/g; let m; while ((m = re.exec(all))) defCounts[m[1]] = (defCounts[m[1]] || 0) + 1; }
  const unitJs = files.filter(f => f.endsWith('.js'));
  unitJs.forEach(f => {
    const lines = texts[f].split('\n');
    lines.forEach((ln, i) => {
      const m = /^(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(/.exec(ln) || /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.exec(ln);
      if (!m) return;
      const n = m[1];
      const defCount = defCounts[n] || 0;
      if (counts[n] <= defCount) W(`${f}:${i + 1}`, `函数 ${n} 定义了但整个仓库没有任何引用`, '（功能没接上，或是死代码）');
    });
  });
}

// ───────── 4. 「必须在」功能清单 ─────────
// 取函数体：从 function 名( 找到 { 再配对到 }，跳过字符串 / 模板 / 注释 / 正则
function fnBody(code, name) {
  const re = new RegExp('(?:^|[^\\w$.])(?:async\\s+)?function\\s*\\*?\\s+' + name.replace(/\$/g, '\\$') + '\\s*\\(|(?:^|[^\\w$.])(?:const|let|var)\\s+' + name.replace(/\$/g, '\\$') + '\\s*=\\s*(?:async\\s*)?(?:function\\b[^{]*|\\([^)]*\\)\\s*=>\\s*|[A-Za-z_$][\\w$]*\\s*=>\\s*)(?=\\{)|(?:^|[^\\w$.])window\\.' + name.replace(/\$/g, '\\$') + '\\s*=\\s*(?:async\\s*)?(?:function\\b[^{]*|\\([^)]*\\)\\s*=>\\s*)(?=\\{)', 'm');
  const m = re.exec(code); if (!m) return null;
  let i = code.indexOf('{', m.index + m[0].length - (m[0].endsWith('{') ? 1 : 0));
  // function 名( ... ) { —— 先跳过参数括号
  if (/function\s*\*?\s+[\w$]+\s*\($/.test(m[0])) { let d = 1, j = m.index + m[0].length; for (; j < code.length && d; j++) { if (code[j] === '(') d++; else if (code[j] === ')') d--; } i = code.indexOf('{', j); }
  if (i < 0) return null;
  const end = matchBrace(code, i); if (end < 0) return null;
  return { text: code.slice(i, end + 1), start: i, line: lineOf(code, i) };
}
function matchBrace(code, open) {
  let depth = 0, i = open, prev = '';
  const tpl = [];   // 模板字符串里的 ${ 层级栈
  for (; i < code.length; i++) {
    const c = code[i], n = code[i + 1];
    if (c === '/' && n === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = code.indexOf('*/', i + 2); if (i < 0) return -1; i++; continue; }
    if (c === '"' || c === "'") { for (i++; i < code.length && code[i] !== c; i++) if (code[i] === '\\') i++; prev = c; continue; }
    if (c === '`') { i = skipTpl(code, i); if (i < 0) return -1; prev = c; continue; }
    if (c === '/' && /[(,=:[!&|?{};]$/.test(prev || ';')) { // 正则
      let inCls = false; for (i++; i < code.length; i++) { const x = code[i]; if (x === '\\') { i++; continue; } if (x === '[') inCls = true; else if (x === ']') inCls = false; else if (x === '/' && !inCls) break; else if (x === '\n') break; }
      prev = '/'; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    if (!/\s/.test(c)) prev = c;
  }
  return -1;
}
function skipTpl(code, i) {   // i 指向开头的 `，返回结尾 ` 的位置
  for (i++; i < code.length; i++) {
    const c = code[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') return i;
    if (c === '$' && code[i + 1] === '{') { const e = matchBrace(code, i + 1); if (e < 0) return -1; i = e; }
  }
  return -1;
}
const POS_FORBID = /firstElementChild|lastElementChild|nextElementSibling|previousElementSibling|\.children\[|:last-child|:first-child|parentNode\.parentNode/;
const hasId = (code, id) => { const s = idSources(code); return s.exact.has(id) || s.patterns.some(p => p.test(id)); };
let manifestChecks = 0;
manifest.items.forEach(item => {
  (item.checks || []).forEach(ck => {
    const where = `${ck.file}`;
    let code; try { code = read(ck.file); } catch (e) { F(where, `[${item.name}] 文件不存在`, ''); return; }
    manifestChecks++;
    (ck.define || []).forEach(fn => { if (!defsOf(code, new Set()).has(fn)) F(where, `[${item.name}] 缺少定义 ${fn}`, '（功能的函数被删或改名了）'); });
    (ck.call || []).forEach(c => {
      const b = fnBody(code, c.in);
      if (!b) { F(where, `[${item.name}] 调用点缺失：找不到函数 ${c.in}`, `（应当在 ${c.in} 里调用 ${c.fn}）`); return; }
      if (!new RegExp('(?:^|[^\\w$.])' + c.fn.replace(/\$/g, '\\$') + '\\s*\\(|=\\s*' + c.fn.replace(/\$/g, '\\$') + '\\b').test(b.text)) F(`${where}:${b.line}`, `[${item.name}] 调用点缺失：${c.in} 里没有调用 ${c.fn}`, '（函数在，但没人调用，功能挂不上）');
    });
    (ck.id || []).forEach(id => { if (!hasId(code, id)) F(where, `[${item.name}] 缺少元素 id=${id} 的创建代码`, '（HTML / 模板 / el.id= 里都没有）'); });
    (ck.text || []).forEach(t => { if (!code.includes(t)) F(where, `[${item.name}] 缺少文字「${t}」`, ''); });
    (ck.forbidInFn || []).forEach(f => {
      const b = fnBody(code, f.fn);
      if (!b) { F(where, `[${item.name}] 找不到函数 ${f.fn}`, '（无法检查其写法）'); return; }
      b.text.split('\n').forEach((ln, i) => { if (POS_FORBID.test(ln)) F(`${where}:${b.line + i}`, `[${item.name}] ${f.fn} 用位置取元素：${ln.trim().slice(0, 120)}`, f.why || '（应按 id 取）'); });
    });
  });
});

// ───────── 白名单自检：每项都要有原因；没用上的放行项也要提醒（说明可以删了） ─────────
for (const sect of ['functions', 'ids']) for (const [k, why] of Object.entries(allow[sect] || {})) {
  if (!why || !String(why).trim()) F('scripts/ui-hooks-allow.json', `放行项 ${sect}:${k} 没写原因`, '');
  if (!usedAllow.has(sect + ':' + k)) W('scripts/ui-hooks-allow.json', `放行项 ${sect}:${k} 现在没有命中任何问题`, '（可以删掉）');
}

// ───────── 输出 ─────────
const print = (title, arr) => { console.log(`\n== ${title}（${arr.length}）`); arr.sort().forEach(x => console.log(`  ${x}`)); };
print('致命', fatal); print('提醒', warn);
console.log(`\n检查了 ${pages.length} 个页面、${manifestChecks} 条关键功能检查：致命 ${fatal.length} 条，提醒 ${warn.length} 条`);
process.exit(fatal.length ? 1 : 0);
