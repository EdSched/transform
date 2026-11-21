// node tests/interview-import.test.js —— 面试题库导入解析器
// ① 用内置小样本（按任务单描述的 tex 结构写的）断言规则
// ② 如果放了真实手册 tests/fixtures/economics-interview-manual.tex，再断言章数 / 题数 / 关键词数
const fs = require('fs'), path = require('path'), assert = require('assert');
const { iviParse, iviMerge, iviCount, iviReport } = require('../shared/interview-import.js');

const SAMPLE = String.raw`\documentclass{ltjsbook}
\begin{document}
\chapter{背景}
回答时间 20～30 秒，先说结论。
\section{自己紹介}
注：先说姓名和身份，再说和研究有关的经历。
\par 例：私は○○と申します。○○大学の経済学部を卒業しました。
\section{学歴}
\section{卒業後の計画}
\chapter{志望動機}
\section{なぜこの研究科ですか}
回答方法：先说结论，再讲理由。
\textbf{例：}貴学の研究科を志望した理由は、○○先生のゼミで労働経済学を学べるからです。
\chapter{経済学基礎概念}
\section{はじめに}
\subsection*{注意点}
\begin{enumerate}
\item 不要背诵
\item 要会解释
\end{enumerate}
\section{ミクロ経済学}
\begin{tabular}{|l|l|}
\hline
外部効果 & 公共財 \\ \hline
需要曲線 & 外部効果 \\ \hline
\end{tabular}
\section{簡単な数学知識の回答例}
\subsection*{関数}
中文说明：说出定义。例：関数とは、入力に対して出力が一つ決まる対応のことです。
\subsection*{微分}
微分は変化率を表します。
\chapter{逆質問}
\section{逆質問の例}
\begin{itemize}
\item 入学前に読んでおくべき文献はありますか。
\item ゼミの雰囲気を教えていただけますか。
\end{itemize}
\end{document}`;

const ch = iviParse(SAMPLE);
const by = t => ch.find(c => c.title === t);
assert.strictEqual(ch.length, 4, '章数');
assert.strictEqual(by('背景').items.length, 3, '背景 3 题（空题也要建）');
assert.ok(by('背景').intro.includes('回答时间'), '章首说明进 intro');
const jk = by('背景').items[0];
assert.strictEqual(jk.q, '自己紹介');
assert.ok(jk.tips.includes('先说姓名') && !jk.tips.includes('注：'), '中文 → tips，去掉「注：」');
assert.ok(jk.example.includes('私は') && !jk.example.startsWith('例'), '日文 → example，去掉「例：」');
assert.strictEqual(by('背景').items[2].required, true);
assert.strictEqual(by('背景').scope, 'common');
assert.strictEqual(by('志望動機').scope, 'school');
assert.ok(by('志望動機').items[0].example.includes('労働経済学') && by('志望動機').items[0].tips.includes('先说结论'), '\\textbf{例：} 也能识别');
const eco = by('経済学基礎概念');
assert.ok(eco.intro.includes('不要背诵'), '「注意点」+ enumerate 进 intro，不变成题');
assert.ok(!eco.items.some(i => i.q === '注意点'));
const micro = eco.items.find(i => i.q === 'ミクロ経済学');
assert.deepStrictEqual(micro.keywords.sort(), ['公共財', '外部効果', '需要曲線'].sort(), '表格 → 关键词（去重）');
assert.strictEqual(micro.required, false);
const mathQ = eco.items.find(i => i.q === '簡単な数学知識の回答例');
assert.ok(mathQ && mathQ.example.includes('**関数**') && mathQ.example.includes('**微分**'), '短小标题留在同一题里，用小标题分隔');
const ask = by('逆質問');
assert.strictEqual(ask.type, 'ask');
assert.strictEqual(ask.items.length, 1, '逆質問：每个 section 一题');
assert.strictEqual(ask.items[0].example.split('\n').length, 2, '各条并进 example，每行一条');
assert.ok(ask.items.every(i => i.required === false && i.example));
// key 稳定
assert.deepStrictEqual(iviParse(SAMPLE).map(c => c.items.map(i => i.key)), ch.map(c => c.items.map(i => i.key)), '重复解析 key 不变');
const keys = ch.flatMap(c => c.items.map(i => i.key)); assert.strictEqual(new Set(keys).size, keys.length, 'key 不重复');

// 合并：再导入一次不重复；删掉一题 → 标 gone 隐藏，不删除
const m1 = iviMerge([], ch);
const m2 = iviMerge(m1.chapters, ch);
assert.strictEqual(iviCount(m2.chapters).items, iviCount(m1.chapters).items, '再导入不重复');
assert.strictEqual(m2.stat.itemsNew, 0);
const less = JSON.parse(JSON.stringify(ch)); less[0].items.splice(1, 1);
const m3 = iviMerge(m2.chapters, less);
const gone = m3.chapters[0].items.find(i => i.q === '学歴');
assert.ok(gone && gone.hidden && gone.gone, '新文件里没有的题：隐藏、不删除');
assert.strictEqual(m3.stat.itemsGone, 1);

// md 格式
const md = iviParse('# 背景\n\n## 自己紹介\n> 指导：先说结论\n例：私は○○です。\n\n## 关键词\n| 外部効果 | 公共財 |\n|---|---|\n');
assert.strictEqual(md[0].items[0].tips, '先说结论'); assert.ok(md[0].items[0].example.includes('私は'));
assert.deepStrictEqual(md[0].items[1].keywords, ['外部効果', '公共財']);

// ── 别名命令：导言区 \newcommand{\interviewquestion}[1]{\subsection*{#1}} ──
const ALIAS = String.raw`\documentclass{ltjsbook}
\newcommand{\interviewquestion}[1]{\subsection*{#1}}
\newcommand{\qsec}[1]{\section*{#1}}
\newcommand{\fancy}[2]{\section*{#1 #2}}
\begin{document}
\chapter{MBA面接}
章首说明。
\interviewquestion{Q01　自己紹介をしてください}
注：先说结论。
例：私は○○です。
\interviewquestion{Q02　志望動機は何ですか}
\chapter{別の章}
\qsec{短い質問}
\subsection*{小見出し}
中文说明。
\end{document}`;
const al = iviParse(ALIAS);
assert.strictEqual(al[0].items.length, 2, '别名 → \\subsection*，该章无 \\section，当题');
assert.strictEqual(al[0].items[0].q, 'Q01 自己紹介をしてください');
assert.ok(al[0].items[0].tips.includes('先说结论') && al[0].items[0].example.includes('私は'));
assert.ok(al[0].intro.includes('章首说明'));
assert.strictEqual(al[1].items.length, 1, '别名 → \\section*，其下 \\subsection 仍是题内小标题');
assert.ok(al[1].items[0].tips.includes('小見出し') || al[1].items[0].tips.includes('中文说明'));
assert.ok(al.warnings.length === 1 && al.warnings[0].includes('fancy'), '复杂宏给警告，实际 ' + JSON.stringify(al.warnings));

// ── \subsection 当题：无 \section 的章 / 有 \section 的章 ──
const SUBQ = String.raw`\begin{document}
\chapter{甲}
\subsection*{注意点}
不要背诵。
\subsection*{题一}
\subsection*{题二}
\chapter{乙}
\section{题A}
\subsection*{小标题}
中文说明。
\end{document}`;
const sq = iviParse(SUBQ);
assert.deepStrictEqual(sq[0].items.map(i => i.q), ['题一', '题二'], '无 \\section 的章：\\subsection 当题（注意点仍进 intro）');
assert.ok(sq[0].intro.includes('不要背诵'));
assert.deepStrictEqual(sq[1].items.map(i => i.q), ['题A'], '有 \\section 的章：\\subsection 保持小标题');
// 题 key 不变：同样的题面直接写成 \section 时 key 相同
const sec = iviParse(String.raw`\begin{document}\chapter{甲}\section{题一}\section{题二}\end{document}`);
assert.deepStrictEqual(sq[0].items.map(i => i.key), sec[0].items.map(i => i.key), '题 key 与写成 \\section 时一致');

// ── 识别报告 ──
const LONG = String.raw`\begin{document}
\chapter{空章}
${'这是一段很长的说明文字。'.repeat(120)}
\chapter{短空章}
一句话。
\chapter{正常}
\section{题}
\end{document}`;
const rp = iviReport(iviParse(LONG));
assert.strictEqual(rp.chapters, 3); assert.strictEqual(rp.items, 1);
assert.deepStrictEqual(rp.noItems, ['空章', '短空章']);
assert.deepStrictEqual(rp.longIntro, ['空章'], 'intro > 1000 字且无题');

// ── ※ 标记：选答，显示名去掉 ※，key 按去掉 ※ 的题面算 ──
const OPT = iviParse(String.raw`\begin{document}\chapter{甲}\section{※文献}\section{必答题}\end{document}`);
assert.strictEqual(OPT[0].items[0].q, '文献'); assert.strictEqual(OPT[0].items[0].required, false);
assert.strictEqual(OPT[0].items[1].required, true);
assert.strictEqual(OPT[0].items[0].key, iviParse(String.raw`\begin{document}\chapter{甲}\section{文献}\end{document}`)[0].items[0].key);
assert.strictEqual(iviParse('# 甲\n\n## ※说明\n').pop().items[0].required, false, 'md 也认 ※');

// 真实手册（可选）
const fx = path.join(__dirname, 'fixtures', 'economics-interview-manual.tex');
if (fs.existsSync(fx)) {
  const r = iviParse(fs.readFileSync(fx, 'utf8')), c = iviCount(r);
  console.log('真实手册：', c);
  assert.ok(r.length >= 9 && r.length <= 11, '约 10 章，实际 ' + r.length);
  assert.strictEqual(c.items, 72, '任务单口径 72 题，实际 ' + c.items);
  const per = r.map(x => x.items.length).join(',');
  assert.strictEqual(per, '4,5,15,2,5,17,14,5,2,3', '各章题数，实际 ' + per);
  assert.ok(c.keywords >= 500, '关键词约 560，实际 ' + c.keywords);
} else console.log('（没有 tests/fixtures/economics-interview-manual.tex，跳过真实手册断言）');
console.log('interview-import: OK');
