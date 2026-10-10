#!/usr/bin/env node
// 检查「全站搜索」的拼音首字母字典（shared/search.js）能不能覆盖所有学生、老师姓名里的每个字。
// 取不到首字母的字会列出来（把它加进 shared/search.js 的 PINYIN_INITIAL_CHARS 对应字母里）。
//
// 用法：
//   node scripts/check-pinyin-names.js                     # 直接读数据库（students 开了 RLS，匿名读不到时需要带管理员 token，见下）
//   SB_TOKEN=<管理员登录后的 access_token> node scripts/check-pinyin-names.js
//   node scripts/check-pinyin-names.js names.json          # 离线：names.json 是 ["张三","李四",...] 的数组
// 有取不到的字返回 1，全部能取到返回 0。
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');

const ctx = { document: { addEventListener() {} }, window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'shared/search.js'), 'utf8') + '\n;this.pinyinMissingChars = pinyinMissingChars;', ctx);

async function fetchNames() {
  const src = fs.readFileSync(path.join(root, 'shared/supabase.js'), 'utf8');
  const url = (src.match(/SB_URL\s*=\s*'([^']+)'/) || [])[1];
  const key = (src.match(/SB_KEY\s*=\s*'([^']+)'/) || [])[1];
  const headers = { apikey: key, Authorization: 'Bearer ' + (process.env.SB_TOKEN || key) };
  const names = [];
  for (const [table, label] of [['students', '学生'], ['teachers', '老师']]) {
    for (let from = 0; ; from += 1000) {
      const r = await fetch(`${url}/rest/v1/${table}?select=name&order=name.asc`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
      if (!r.ok) throw new Error(`${table} 读取失败：HTTP ${r.status}（students 开了 RLS，需要 SB_TOKEN=管理员 access_token）`);
      const rows = await r.json();
      rows.forEach(x => x.name && names.push({ name: x.name, label }));
      if (rows.length < 1000) break;
    }
  }
  return names;
}

(async () => {
  const file = process.argv[2];
  const names = file ? JSON.parse(fs.readFileSync(file, 'utf8')).map(n => ({ name: n, label: '' })) : await fetchNames();
  const miss = new Map();
  names.forEach(({ name, label }) => ctx.pinyinMissingChars(name).forEach(ch => {
    if (!miss.has(ch)) miss.set(ch, []);
    miss.get(ch).push((label ? label + '：' : '') + name);
  }));
  console.log(`检查了 ${names.length} 个姓名`);
  if (!miss.size) { console.log('每个字都能取到拼音首字母'); return; }
  console.log(`以下 ${miss.size} 个字取不到首字母：`);
  miss.forEach((who, ch) => console.log(`  ${ch}  ← ${[...new Set(who)].slice(0, 5).join('、')}`));
  process.exit(1);
})().catch(e => { console.error(e.message); process.exit(2); });
