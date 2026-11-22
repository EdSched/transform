// 页面 → 脚本 的读取（check-globals.js 与 check-ui-hooks.js 共用，保证两个检查用同一套口径）
// 返回每个页面：{ rel, html, scripts:[{label, file, code, inline}] }；scripts 按页面里的加载顺序，只含本站脚本和内联脚本。
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' || e.name === '.git' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
function loadPage(h) {
  const html = fs.readFileSync(h, 'utf8'), rel = path.relative(root, h);
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi; let m, i = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1], src = (/src\s*=\s*["']([^"']+)["']/.exec(attrs) || [])[1];
    if (src) {
      if (/^https?:/.test(src)) continue;
      const f = path.resolve(path.dirname(h), src.split('?')[0]);
      if (fs.existsSync(f)) scripts.push({ label: path.relative(root, f), file: f, code: fs.readFileSync(f, 'utf8'), inline: false });
    } else if (!/type\s*=\s*["'](?!text\/javascript|module)/i.test(attrs) && m[2].trim()) {
      // 内联脚本：记下它在 html 里的起始行，方便报行号
      const startLine = html.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length;
      scripts.push({ label: `${rel}#内联${++i}`, file: h, code: m[2], inline: true, startLine });
    }
  }
  return { rel, file: h, html, scripts };
}
// filter：可选，(相对路径) => boolean
function loadPages(filter) {
  return walk(root).filter(f => f.endsWith('.html')).filter(f => !filter || filter(path.relative(root, f))).map(loadPage);
}
module.exports = { root, walk, loadPage, loadPages };
