#!/usr/bin/env node
// 检查同一个页面加载的各 js（含内联脚本）之间有没有重名的全局声明。
//   致命：let / const / class 与别处重名 → 整个文件加载失败（SyntaxError: Identifier 'x' has already been declared）
//   警告：function / var 重名 → 后加载的悄悄覆盖先加载的（不报错，但行为会变）
// 用法：node scripts/check-globals.js        （在仓库根目录跑；需要 acorn：npm i -g acorn 或系统里已有）
const fs = require('fs'), path = require('path');
let acorn; try { acorn = require('acorn'); } catch (e) { acorn = require('/opt/node-tools/node_modules/acorn'); }
const root = path.resolve(__dirname, '..');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' || e.name === '.git' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const htmls = walk(root).filter(f => f.endsWith('.html'));
function patternNames(p, out) {
  if (!p) return;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach(x => patternNames(x.value || x.argument, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach(x => patternNames(x, out));
  else if (p.type === 'AssignmentPattern') patternNames(p.left, out);
  else if (p.type === 'RestElement') patternNames(p.argument, out);
}
function topDecls(code, label) {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
  const out = [];
  ast.body.forEach(n => {
    if (n.type === 'FunctionDeclaration') out.push({ name: n.id.name, kind: 'function' });
    else if (n.type === 'ClassDeclaration') out.push({ name: n.id.name, kind: 'class' });
    else if (n.type === 'VariableDeclaration') { const ns = []; n.declarations.forEach(d => patternNames(d.id, ns)); ns.forEach(name => out.push({ name, kind: n.kind })); }
  });
  return out;
}
let fatal = 0, warn = 0;
htmls.forEach(h => {
  const html = fs.readFileSync(h, 'utf8'), rel = path.relative(root, h);
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi; let m, i = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1], src = (/src\s*=\s*["']([^"']+)["']/.exec(attrs) || [])[1];
    if (src) {
      if (/^https?:/.test(src)) continue;
      const f = path.resolve(path.dirname(h), src.split('?')[0]);
      if (fs.existsSync(f)) scripts.push({ label: path.relative(root, f), code: fs.readFileSync(f, 'utf8') });
    } else if (!/type\s*=\s*["'](?!text\/javascript|module)/i.test(attrs) && m[2].trim()) scripts.push({ label: `${rel}#内联${++i}`, code: m[2] });
  }
  const seen = {};   // name -> [{label,kind}]
  scripts.forEach(s => {
    let ds; try { ds = topDecls(s.code, s.label); } catch (e) { console.log(`[解析失败] ${s.label}: ${e.message}`); return; }
    ds.forEach(d => (seen[d.name] = seen[d.name] || []).push({ label: s.label, kind: d.kind }));
  });
  Object.entries(seen).forEach(([name, list]) => {
    if (list.length < 2) return;
    const lex = list.some(x => x.kind === 'let' || x.kind === 'const' || x.kind === 'class');
    const where = list.map(x => `${x.label}(${x.kind})`).join(' ↔ ');
    if (lex) { fatal++; console.log(`[致命] ${rel}：${name}  ${where}`); }
    else { warn++; console.log(`[覆盖] ${rel}：${name}  ${where}`); }
  });
});
console.log(`\n检查了 ${htmls.length} 个页面：致命 ${fatal} 处，覆盖警告 ${warn} 处`);
process.exit(fatal ? 1 : 0);
