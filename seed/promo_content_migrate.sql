-- 旧的 7 个专业页（shehui/jingji/jingying/jiaoyu/fuzhi/xinchuan/biaoxiang.html）内容迁进 promo_content
-- 格式：专业介绍用「## 概要 / 独特视角 / 优势 / 重点方向 / 研究课题例 / 重点研究科」分段，不在这些字段里的内容（对比、备考建议等）接在后面作为补充段落；
--       课程介绍用「## 课时摘要 / 课程描述 / 课程目标 / 课程大纲」。讲师介绍不迁移（以系统为准）。
-- 不覆盖已有内容：同一专业 + 同一板块 + 同一标题已经存在的，自动跳过（可重复执行）。
-- 专业代号：shehui→shakai  jingji→keizai  jingying→keiei  jiaoyu→kyoiku  fuzhi→fukushi  xinchuan→shinpan  biaoxiang→hyosho
--
-- 0) 先确认这 7 个专业代号在 majors 表里都存在（应返回 7 行；少了哪个，先别往下执行，告诉我）：
--    select key, label from majors where key in ('shakai', 'keizai', 'keiei', 'kyoiku', 'fukushi', 'shinpan', 'hyosho');
-- 1) 看一下系统里现在已有的专业介绍 / 课程介绍（已存在且标题相同的会被跳过；专业介绍如果已经用了别的标题，会再多出一条「专业介绍」，那种情况先把旧的删掉或改标题）：
--    select major, section, title, length(body) as 字数 from public.promo_content
--     where major in ('shakai', 'keizai', 'keiei', 'kyoiku', 'fukushi', 'shinpan', 'hyosho') and section in ('major_intro','course') order by major, section, sort_order;
-- 2) 执行下面全部 insert。
-- 3) 执行完看结果：select major, section, title from public.promo_content where id like 'pm-seed-%' order by major, section, sort_order;
--
-- ── 回滚（只删本文件插入的行；如果你已在后台改过这些行，改动也会一起被删）──
-- delete from public.promo_content where id like 'pm-seed-%';


-- ══ 社会学 (shehui.html) → shakai ══

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shakai-intro', 'shakai', 'major_intro', $pm$专业介绍$pm$, $pm$## 概要
**什么是社会学**

社会学是一门探索社会现象的学问，研究**人、集团与互动关系**。它试图回答一个核心问题：社会中的秩序从何而来？在个体自由、不同价值观共存的复杂环境中，社会如何维持稳定？

通过探究个人行为与社会规范、冲突与合作、变化与持续之间的动态平衡，社会学揭示出隐藏在表象之下的深层次规律。

## 独特视角
**三个核心视角**

**人**——每个人的行为都会影响社会。社会学通过分析个体行为，揭示集体行动的规律，帮助理解不同文化中的行为差异。

**集团**——集团有自身的秩序和规则。社会学研究不同背景下集团的形成及其对成员的影响。

**关系**——人与人之间的互动构成社会结构。社会学探索这些互动如何形成规则、维持秩序并影响社会发展。

## 优势
- 跨学科融合：与经济学、政治学、人类学、心理学等多学科相交融，提供全面的分析工具，帮助理解不同社会现象之间的联系。
- 实用性强：理论可直接应用于社会不平等、教育制度改革、城市规划、社会政策制定等领域，帮助改善社会现实。
- 批判与创新思维：强调批判性思维，鼓励从不同角度分析社会问题，打破常规思维框架，提出创新性解决方案。

## 重点方向
社会学 / 地域研究 / 家族社会学 / 都市社会学 / Gender & Sexuality研究 / 教育社会学

## 研究课题例
- SNSを通じた自己認識の変容に関する質的研究（社会学概念：自我、象徴的相互作用）
- 都市部と農村部における家族形態の変化に関する比較研究
- 職場におけるジェンダー不平等と性意識の社会的形成（東京インタビュー調査）
- 日本における経済的階層の再生産：教育機会と社会的不平等（SSM調査二次分析）
- 過疎化する農村コミュニティの再生可能性（参与観察・深層インタビュー）
- 青少年における逸脱行為の社会的要因（アノミー理論・ラベリング理論）
- SNSが日本の環境保護運動に与える影響（ソーシャルネットワーク分析）
- グローバル化が在日外国人の労働条件と人種差別に与える影響（関西事例研究）

## 重点研究科
| 学校名 | 研究科 | 专攻/分野 | 英语 | 日语 |
|---|---|---|---|---|
| 一桥大学 | 社会学研究科 | 社会研究 · 地球研究 | TOEIC 800+ | — |
| 大阪大学 | 人間科学研究科 | 社会学 · 人間学系 | TOEFL 80+ | N1 |
| 御茶水女子大学 | 人間文化創成科学研究科 | 人間発達科学専攻 | TOEIC 800+ | N1 |
| 早稻田大学 | 文学研究科 | 社会学 | TOEFL 80+ | N1 |
| 庆应义塾大学 | 社会学研究科 | 社会学 | TOEFL 95+ | N1 |
| 上智大学 | 総合人間科学研究科 | 社会学 | TOEIC 800+ | N1 |

※ 英语和日语为合格数据中最低成绩$pm$, 0, true
where not exists (select 1 from public.promo_content where major = 'shakai' and section = 'major_intro' and title = $pm$专业介绍$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shakai-course-01', 'shakai', 'course', $pm$社会学理论$pm$, $pm$## 课时摘要
10H · 5回 · 4月期 / 10月期 · 14:00–16:00

## 课程描述
针对大学院社会学相关专攻过去问及研究课题设计。社会学理论的运用十分广泛，不仅限于社会学，政治学、经营学及跨学科领域均会涉及，在研究计划书撰写中更是必不可少。本课程按社会学史发展顺序系统讲解高频考点学者的概念与理论。

## 课程目标
- 知识：注重理论与当下社会现象结合，丰富具体例帮助学生理解抽象概念。
- 技能：社会学理论适用于综合性大学院小论文、文学研究、历史学研究等多种考试场景。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 古典社会学1 | 涂尔干，社会的事实，自杀论，失范，过去问真题 | 2 |
| 2 | 古典社会学2 | 马克思·韦伯，价值自由，社会的行为，新教伦理与资本主义精神，官僚制，过去问真题 | 2 |
| 3 | 20世纪的社会学 | 帕森斯，构造机能主义，AGIL图式，模式函数，莫顿，机能分析，参照集团，预言自证，过去问真题 | 2 |
| 4 | 现代社会学1 | 吉登斯，行为与构造，构造的二重性，代理，过去问真题 | 2 |
| 5 | 现代社会学2 | 布迪厄，文化再生产，文化资本，惯习，场，不平等的再生产，过去问真题 | 2 |$pm$, 1, true
where not exists (select 1 from public.promo_content where major = 'shakai' and section = 'course' and title = $pm$社会学理论$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shakai-course-02', 'shakai', 'course', $pm$现代社会论$pm$, $pm$## 课时摘要
10H · 5回 · 7月期 / 1月期 · 16:30–18:30

## 课程描述
对应国际社会学/全球化研究等方向。以现代社会中五个核心主题系统梳理60年代以后的社会学理论与概念。不仅适用于社会学研究科过去问，对各专业学科的论述题回答及研究计划书的新视点提供均有帮助。

## 课程目标
- 知识：围绕现代社会各种课题的相关社会学理论与概念学习。
- 技能：掌握大学院论述题中关于现代社会问题的解答思路。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 近代化 | 近代至再归的近代，都市化，过去问真题训练 | 2 |
| 2 | 个人化 | 个人化的进程，产生的问题，过去问真题 | 2 |
| 3 | 风险社会 | 当今社会系统的风险，个人风险，环境问题，过去问真题 | 2 |
| 4 | 液态化 | 雇佣的不安定化，社会关系的流动化，家庭的不安定化 | 2 |
| 5 | 全球化 | 全球化，反全球化，全球在地化，世界体系论，过去问真题 | 2 |$pm$, 2, true
where not exists (select 1 from public.promo_content where major = 'shakai' and section = 'course' and title = $pm$现代社会论$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shakai-course-03', 'shakai', 'course', $pm$现代文化论$pm$, $pm$## 课时摘要
10H · 5回 · 7月期 / 1月期 · 14:00–16:00

## 课程描述
对应文化人类学/文化研究/文化社会学方向。在全球化背景下，文化研究已呈现跨学科、多样性特征。本课程涵盖艺术表象（电影、雕塑）、流行文化（偶像、时尚）、亚文化（二次元、女权、性少数）及文化人类学（民俗、民族文化）等全面内容。

## 课程目标
- 知识：掌握报考社会学、表象文化论、文化研究、观光地域振兴、文化人类学所需专业知识。
- 技能：灵活完成文化相关论述题，并将所学知识融入学生关心的研究课题中。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 文化的定义 | 文化是什么；社会学、文化研究、文化人类学的文化概念；课题与界限 | 2 |
| 2 | 表现文化的社会学 | 表现文化的社会学理论，音乐文化杂食论 | 2 |
| 3 | 传媒与文化研究 | 传媒科技的文化研究与文化的动态性 | 2 |
| 4 | 文化研究 | 亚文化论，文化研究的女权主义 | 2 |
| 5 | 全球化时代的文化越境 | 全球化论与跨国主义论，越境媒体与流行文化，文化与自我认同的政治 | 2 |$pm$, 3, true
where not exists (select 1 from public.promo_content where major = 'shakai' and section = 'course' and title = $pm$现代文化论$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shakai-course-04', 'shakai', 'course', $pm$Gender 研究$pm$, $pm$## 课时摘要
10H · 5回 · 不定期 · 16:30–18:30

## 课程描述
对应家族社会学/性学视角等方向。系统掌握Gender领域核心主题、理论流派及研究方向。近年来Gender已进入社会科学各领域，无论是经济制度还是经营战略，Gender视角都不可或缺。

## 课程目标
- 知识：掌握Gender领域核心主题、相关理论流派及迄今为止的研究方向。
- 技能：运用所学知识应对过去问，并为研究计划书提供新视点。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | Gender & Sexuality | 性差异，性爱制度，女权主义的发展 | 2 |
| 2 | Gender 宏观视角 | 性差的制度变迁，家父长制，资本主义与性差，性别分工，无薪劳动，女性的双重劳动 | 2 |
| 3 | Gender 微观视角 | 性别赋予，性差的展演，广告中的Gender，性爱脚本，性差异实践与权力作用，身体的性化 | 2 |
| 4 | 近代 Sexuality 制度 | 性爱制度，性的研究史，性爱装置，同性爱的病理化，人口管理与性爱，浪漫爱情信仰变迁，性革命 | 2 |
| 5 | 过去问演练 | Gender & Sexuality相关过去问（一桥、御茶水女子、早稻田为主） | 2 |$pm$, 4, true
where not exists (select 1 from public.promo_content where major = 'shakai' and section = 'course' and title = $pm$Gender 研究$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shakai-course-05', 'shakai', 'course', $pm$微观社会学$pm$, $pm$## 课时摘要
10H · 5回 · 不定期 · 16:30–18:30

## 课程描述
对应传媒研究/互动研究/对话分析等方向，又称"日常生活的社会学"。从行为人对自身生活世界的理解入手，探究社会世界的构成。微观社会学的知识在进行定性调查（参与观察、深度访谈）时不可或缺，近年对定性调查的影响在各校调查法考题中频繁出现。

## 课程目标
- 知识：学习符号互动论、Goffman社会学、常人方法论、现象学社会学的概念与理论视角。
- 技能：有效应对任何大学相关领域考题，并支持定性研究计划书的方法论设计。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 符号互动论 | 米德的主客我，社会世界论，布鲁默的符号互动论复兴，贝克尔的标签论，哈金的循环效应（looping effect） | 2 |
| 2 | Goffman社会学（上） | 拟剧论，展演，身体互动的秩序，情境定义，互动仪式，face-work，儀礼的無関心，役割距離，框架分析 | 2 |
| 3 | Goffman社会学（下） | スティグマ，アサイラム，出会い，Goffman社会学的应用（情感社会学、观光社会学的performance転回） | 2 |
| 4 | 常人方法论 | 违背实验，翻译定理，会话分析，成员分类 | 2 |
| 5 | 现象学的社会学 | 胡塞尔的现象学，舒茨的现象学社会学，主观间性，生活世界，自明性，梅洛庞蒂的身体论，身体社会学 | 2 |$pm$, 5, true
where not exists (select 1 from public.promo_content where major = 'shakai' and section = 'course' and title = $pm$微观社会学$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shakai-course-06', 'shakai', 'course', $pm$毕业论文写作$pm$, $pm$## 课时摘要
12H · 6回 · 不定期 · 14:00–16:00

## 课程描述
主要针对冬季考试需重新提交毕业论文、或专科毕业没有毕业论文需资格审查的学生。从起步开始带领完成毕业论文。需要基础学术训练的同学亦推荐参加。

## 课程目标
- 知识：学习日本大学学术训练的基础能力、论文写作基础、先行研究查找及基本研究方法。
- 技能：完成学部毕业论文的写作，达到日本学部学生的学术技能水平。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 毕业论文的准备 | 论文构成，课题设定，问题意识的提出，先行研究的收集 | 2 |
| 2 | 先行研究的整理与引用 | 先行研究的整理，列表制作，撰写技巧，参考文献与引用的写法 | 2 |
| 3 | 序论的写法 | 序论的基本要求，写法，实例讲解 | 2 |
| 4 | 社会调查基础与资料搜索 | 定性/定量调查，调查的伦理，资料搜索法详解与实例 | 2 |
| 5 | 本论的写法与考察 | 本论的内容、构成与实践 | 2 |
| 6 | 结论与研究计划书 | 结论的基本要求，写法，研究计划书的基础 | 2 |$pm$, 6, true
where not exists (select 1 from public.promo_content where major = 'shakai' and section = 'course' and title = $pm$毕业论文写作$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shakai-course-07', 'shakai', 'course', $pm$社会人文大课$pm$, $pm$## 课时摘要
40H · 10回 · 每期 · 周日 14:00–18:20

## 课程描述
大学院社会人文系综合专业课程，涵盖社会学、社会福祉学、新闻传播学和综合文化学四大专业的基础知识。帮助学生梳理各专业脉络，同时掌握适用于社会科学广泛领域的研究计划书写作与论述能力。

## 课程目标
- 知识：掌握社会学、社会福祉学、新闻传播学和综合文化研究的核心用语与概念。
- 技能：具备研究计划书撰写能力，重视小论文写作，对应社会人文类研究科笔试。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 研究计划书 | 逻辑框架，问题意识的提起，先行研究收集方法，研究方法的设计 | 4 |
| 2 | 新闻学 | 新闻学的概念、历史等 | 4 |
| 3 | 传播学 | 传播学的概念、历史等 | 4 |
| 4 | 社会福祉学 | 社会福祉学的概念、社会福祉的历史 | 4 |
| 5 | 社会政策学 | 社会政策学的概念、历史 | 4 |
| 6 | 社会学 | 社会科学的思考，社会学的定义、略史，集团论 | 4 |
| 7 | 论述题写作 | 论述的基础，读题，写作，真题解答 | 4 |
| 8 | 现代思想 | 哲学的概念，现代思想的重要学者 | 4 |
| 9 | 文化人类学 | 文化人类学的思考、历史，相关概念与课题展示 | 4 |
| 10 | 社会心理学 | 社会心理学的概念、历史 | 4 |$pm$, 7, true
where not exists (select 1 from public.promo_content where major = 'shakai' and section = 'course' and title = $pm$社会人文大课$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shakai-course-08', 'shakai', 'course', $pm$社会调查与研究方法$pm$, $pm$## 课时摘要
10H · 5回 · 4月期 / 10月期 · 10:00–12:00

## 课程描述
社会调查与研究方法是观察、测量社会现象的工具，也是分析运用社会数据的科学方法。课程围绕社会调查研究的主要过程展开，从问题选择、调查设计、问卷设计、抽样到数据分析，系统讲解定量与定性研究方法。

## 课程目标
- 知识：掌握研究设计、抽样、测量、问卷制作、资料收集与统计分析的基本方法。
- 技能：对应大学院社会调查相关过去问，并支持实证研究类研究计划书的调查方法设计。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 研究方法选择 | 问题意识，假说构成，观察法，访谈，田野调查，问卷调查，内容分析 | 2 |
| 2 | 调查问卷设计 | 问卷设计，设问与选项，调查对象，数据量化，尺度，信赖性，妥当性，量表 | 2 |
| 3 | 调查数据的解读 | 度数分布表，图表，统计量，对照表，相关与因果 | 2 |
| 4 | 调查数据的一般化 | 统计的推定，统计的检定，独立性检验，平均值的推定和检定 | 2 |
| 5 | 数据讲述了什么 | 分散分析，回归分析，多变量解析 | 2 |$pm$, 8, true
where not exists (select 1 from public.promo_content where major = 'shakai' and section = 'course' and title = $pm$社会调查与研究方法$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shakai-course-09', 'shakai', 'course', $pm$过去问演习$pm$, $pm$## 课时摘要
15H · 5回 · 7月期 / 1月期 · 16:30–19:30

## 课程描述
以社会学专业知识为核心，同时涉及哲学、传播学、心理学、政治学等相关专业的论述题目。按时间顺序补充所有备考所需专业知识与论述题写作技巧。全专业必修。

## 课程目标
- 知识：掌握社会学及现代社会相关必考概念，达到日本本科学生专业知识水平。
- 技能：具备小论文写作能力，对应社会人文类研究科及社会学科系研究科笔试。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 入试问题解析 | 大学院社会学常见题型【名词解释】【论述】的解题手法、基本解答构造、常用表达方式及出题意图分析 | 3 |
| 2 | 古典社会学理论 | 以古典社会学部分过去问入手，指导学生如何在解答中使用理论及举例方法 | 3 |
| 3 | 现代社会学前夜 | 以结构主义及意味学派部分过去问入手，指导理论梳理与解答方法 | 3 |
| 4 | 过去问实践演习1 | 以现代社会学部分过去问入手，指导学生理论运用与举例方法 | 3 |
| 5 | 过去问实践演习2 | 现代社会学 part2 及课程总结，以学生以往作业为基础集中整理各种解答法的注意事项 | 3 |$pm$, 9, true
where not exists (select 1 from public.promo_content where major = 'shakai' and section = 'course' and title = $pm$过去问演习$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shakai-course-10', 'shakai', 'course', $pm$社会学 Zemi$pm$, $pm$## 课时摘要
20H · 10回 · 7月期 / 1月期

## 课程描述
前半期以研究计划书发表与讨论、文献阅读为主；后半期侧重目标学校过去问答疑与备考确认。全程随堂评估与反馈，根据学生进度灵活调整。

## 每周流程
- 课前：发表同学提前两天分享研究计划书＋发表要约
- 课中：担当发表 → 全员讨论 → 过去问讲解讨论
- 反馈：老师随堂修改进度与内容，提供即时评估$pm$, 10, true
where not exists (select 1 from public.promo_content where major = 'shakai' and section = 'course' and title = $pm$社会学 Zemi$pm$)
on conflict (id) do nothing;


-- ══ 经济学 (jingji.html) → keizai ══

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keizai-intro', 'keizai', 'major_intro', $pm$专业介绍$pm$, $pm$## 概要
**什么是经济学**

经济学属于社会科学，研究社会现象以及背后的人类行动。与经营学、商学关注"研究对象"（企业战略、组织、市场）不同，经济学的重点在于**研究思路**——基于经济主体的合理性，用理论分析（数学建模）和实证分析（因果推断）揭示行动与结果之间的关系。

因此，经济学被称为"社会科学的女王"。

## 独特视角
**三大分析视角**

**微观经济学**——研究消费者、企业、政府如何做出决策，以及决策如何影响价格、产量和资源分配。

**宏观经济学**——研究整体经济体系的运行，关注 GDP、失业、通货膨胀、财政与货币政策等总体变量。

**计量经济学**——利用统计方法和数学模型检验理论、估计关系、评估政策效果，是撰写研究计划书的核心工具。

## 优势
- 跨学科融合：与社会学、政治学、经营学、心理学等多学科相交融，提供全面的分析工具，帮助理解不同社会现象之间的深层联系。
- 实用性强：理论可直接应用于社会政策、教育改革、城市规划等实际问题。经济学的本质是"讲好故事"——逻辑思维与沟通能力是贯穿职场的基础能力。
- 数据驱动思维：以数据为核心，通过科学方法进行理性判断，避免主观偏见。这种思维广泛应用于商业、科技等领域，是现代社会不可或缺的核心能力。

## 重点方向
劳动经济学 / 环境经济学 / 产业组织论 / 国际经济学 / 开发经济学 / 教育经济学 / 医疗经济学 / 都市经济学 / 政治经济学

## 研究课题例
- フレーミング効果と情報提供者の影響に関する研究
- 配偶者控除制度改正が女性の労働供給に与えた影響
- 高齢化の進展が世帯あたりCO₂排出量に与える影響（中国上海市）
- コロナ禍における男女間ワークライフバランス格差の分析
- 地域金融機関の統合が貸出市場に与える影響
- ゲームコンソールの後方互換性が消費者選択とソフト販売に与える影響
- 女性取締役が企業ESGスコアに与える影響（中国上場企業）
- 中国文化産業の集積が労働生産性に与える影響

## 重点研究科
| 学校名 | 研究科 | 专攻/分野 | 英语 | 日语 |
|---|---|---|---|---|
| 东京大学 | 经济学研究科 | — | TOEFL 95+ / GRE | N1 |
| 一桥大学 | 経済学研究科 | — | TOEFL 90+ | N1 |
| 京都大学 | 経営管理大学院（MBA） | — | TOEIC 850 | N1 |
| 大阪大学 | 経済学研究科 | — | TOEFL 85+ | N1 |
| 早稻田大学 | 経済学研究科 | — | TOEIC 850+ | N1 |
| 庆应义塾大学 | 経済学研究科 | — | TOEFL 90+ | N1 |
| 上智大学 | 経済学研究科 | — | TOEIC 800+ | N1 |

※ 除经济学研究科外，部分学校的公共政策大学院、MBA 及环境学研究科等也可报考，可选学校非常多。

## 经济学视角 vs 经营学视角——以"创新者困境"为例
为何锐意创新的大企业仍可能失败？经营学与经济学对同一问题给出了截然不同的分析路径：

**经营学视角（框架分析）**

- 战略：3C / 4P / STP / 5Force
- 组织：促进创新的组织架构设计
- 市场：创新是否迎合需求
- 结论：大企业在组织和心理层面存在"创新坎"

**经济学视角（理论+实证）**

- 置换效果：新品只会蚕食自身旧品销量
- 先下手为强：老牌企业收购新技术以防参入
- 创新能力差异的量化检验
- 结论：利用显示数据对三大假说逐一验证

## 报考通道
**报考通道：**疫情后经济学大学院逐渐分为两条选拔通道——①**书类选考**（出身校 + GPA + 英语/日语 + 研究计划书 + 面试，如东大、一桥、早大）；②**笔试**（英语/日语 + 研究计划书 + 面试，如阪大、庆应、横国）。部分学校可用 **ERE 经济学检定试验**免除全部或部分笔试。

## 学校梯队
**S 级**：东京大学 · 一桥大学 / 京都大学 · 早稻田大学 / 庆应义塾大学 · 大阪大学

**A 级**：横国 · 上智 · 神户 / 名古屋 · 东北 · 九州 / 北海道 · 筑波等

**B 级**：明治 · 青山 · 立教 / 中央 · 法政 · 学习院 / 关关同立等$pm$, 0, true
where not exists (select 1 from public.promo_content where major = 'keizai' and section = 'major_intro' and title = $pm$专业介绍$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keizai-course-01', 'keizai', 'course', $pm$微观经济学$pm$, $pm$## 课时摘要
40H · 10回 · 4月期 / 10月期 · 10:00–14:00

## 课程描述
针对大学院经济学相关专攻笔试和面试题目设计，对微观经济学各基础知识进行系统串讲，讲课过程中结合研究计划书写作主题与考试内容进行深度讲解。

## 课程目标
- 知识：整合各教材和过去问知识点，系统梳理微观经济学核心内容。
- 技能：培养经济学思考方式，让知识点不仅用于考试，更能分析现实问题。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 消费者理论1 | 选好公理，效用函数，无差别曲线，拉格朗日乘数法 | 4 |
| 2 | 消费者理论2 | 替代效果与收入效果，补偿需求曲线，消费者剩余，Slutsky方程，弹性 | 4 |
| 3 | 消费者理论3 | 常见效用函数练习与总结，二期模型 | 4 |
| 4 | 生产者理论 | 利润最大化，费用最小化，企业长期与短期，供给曲线 | 4 |
| 5 | 一般均衡理论 | 纯粹交换经济，Edgeworth盒，福利经济学第一/第二基本定理 | 4 |
| 6 | 外部性 | 一般均衡典型例题，环境经济学基本概念，外部性，Coase定理 | 4 |
| 7 | 公共财 · 垄断 | 公共财，Samuelson条件，Lindahl机制，垄断与逆需求曲线 | 4 |
| 8 | 产业 · 期待效用 | 价格差别理论，垂直市场，网络外部性，期待效用理论 | 4 |
| 9 | 博弈论1 | 静态博弈，利得表，博弈论典型例子，寡占模型 | 4 |
| 10 | 博弈论2 | 共谋，混合战略均衡，动态博弈入门 | 4 |$pm$, 1, true
where not exists (select 1 from public.promo_content where major = 'keizai' and section = 'course' and title = $pm$微观经济学$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keizai-course-02', 'keizai', 'course', $pm$宏观经济学$pm$, $pm$## 课时摘要
24H · 6回 · 7月期 / 1月期 · 10:00–14:00

## 课程描述
以宏观经济学核心主题为主线，精讲重点理论与模型，结合现实经典案例，深入浅出探讨宏观经济现象与政策效果。

## 课程目标
- 知识：系统梳理经典宏观理论和模型，辅以案例分析加深理解。
- 技能：掌握政策工具与分析方法，能在研究计划书和考试中精准运用。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 国民所得·凯恩斯派 | 国民所得概念，凯恩斯与新古典派，储蓄悖论，45度线分析，IS曲线 | 4 |
| 2 | IS-LM分析 | 货币概念，LM曲线，IS-LM体系，挤出效果 | 4 |
| 3 | 国际宏观经济学 | 新国际收支统计，FM模型，物价概念，AD-AS曲线初步 | 4 |
| 4 | 通胀·安倍经济学 | 新凯恩斯派，合理预期学派，AS曲线，日本银行金融政策 | 4 |
| 5 | 失业·菲利普斯曲线 | 失业率概念，菲利普斯曲线，凯恩斯派与新古典派论争 | 4 |
| 6 | 新古典·经济增长 | Solow模型，黄金律，景气循环理论 | 4 |$pm$, 2, true
where not exists (select 1 from public.promo_content where major = 'keizai' and section = 'course' and title = $pm$宏观经济学$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keizai-course-03', 'keizai', 'course', $pm$经济数学$pm$, $pm$## 课时摘要
18H · 6回 · 7月期 / 1月期 · 10:00–13:00

## 课程描述
补充大学院经济学入试必需的逻辑思维与数学知识，扫清微观、宏观经济学学习中的数理障碍。涵盖基础数学运算与严谨的形式逻辑，结合过去问实例讲解。

## 课程目标
- 知识：围绕数学分析核心内容，强调模型构建、变化分析与最值问题的系统理解。
- 技能：掌握微分、积分、最优化等基本方法，培养严谨逻辑思维和抽象建模能力。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 经济模型与均衡 | 经济模型，集合，函数，指数/对数函数，均衡概念 | 3 |
| 2 | 比较静态 | 导数，极限，不等式，连续与可微，常见函数的导数 | 3 |
| 3 | 微分法则 | 一元函数微分，链式法则，偏微分，全微分，隐函数 | 3 |
| 4 | 最优化 | 无约束最优化，约束最优化，拉格朗日算子，包络定理 | 3 |
| 5 | 积分与微分方程 | 定积分，不定积分，分部积分法，Solow模型应用 | 3 |
| 6 | 逻辑与证明 | 逆命题与否命题，充分/必要条件，直接法，反证法，归纳法 | 3 |$pm$, 3, true
where not exists (select 1 from public.promo_content where major = 'keizai' and section = 'course' and title = $pm$经济数学$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keizai-course-04', 'keizai', 'course', $pm$研究计划方法论 & 计量经济学基础$pm$, $pm$## 课时摘要
10H · 5回

## 课程描述
培养制定经济学研究计划的能力，掌握计量经济学基本理论，为完成研究计划书奠定坚实基础。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 研究计划方法论1 | 研究选题与文献综述：如何界定有价值的研究问题，检索与整理学术文献 | 2 |
| 2 | 研究计划方法论2 | 研究设计与数据收集：研究目标制定，定性/定量方法选择，常用数据来源 | 2 |
| 3 | 计量手法基础1 | 线性回归模型（OLS），假设检验，多重共线性、异方差性诊断 | 2 |
| 4 | 计量手法基础2 | 因果推断：面板数据固定效应，RDD，DID，IV方法介绍 | 2 |
| 5 | 计量手法基础3 | 论文轮读：实证论文结构与分析方法精讲 | 2 |$pm$, 4, true
where not exists (select 1 from public.promo_content where major = 'keizai' and section = 'course' and title = $pm$研究计划方法论 & 计量经济学基础$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keizai-course-05', 'keizai', 'course', $pm$ERE 经济学检定试验提分班$pm$, $pm$## 课时摘要
16H · 4回

## 课程描述
在微观、宏观经济学基础上，系统补充 ERE 必考知识点，目标是帮助学生取得 A+ 成绩。横滨国立、大阪公立、上智、明治、中央、法政、同志社、立命馆等学校均可用 ERE 成绩免除全部或部分笔试，且 ERE 现已全面改为机考，时间安排灵活。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1-2 | ERE微观补充 | 需要・供給分析 / 消費者の合理的行動 / 所得・価格変化と消費 / 需要弾力性 / 企業と生産関数 / 費用関数 / 利潤最大化 ほか | 8 |
| 3-4 | ERE宏观补充 | 国民所得の概念とGDP / 国民所得決定論 / 財政・金融活動 / 消費・投資理論 / IS-LM分析 / 財政・金融政策の効果 ほか | 8 |$pm$, 5, true
where not exists (select 1 from public.promo_content where major = 'keizai' and section = 'course' and title = $pm$ERE 经济学检定试验提分班$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keizai-course-06', 'keizai', 'course', $pm$过去问训练（微观宏观专项 + 套题演练）$pm$, $pm$## 课时摘要
76H · 19回 · 10:00–14:00

## 课程描述
以微观、宏观经济学专业知识为核心，按知识点顺序补充所有备考所需专业知识与答题技巧，最终通过套题演练整合应试能力。

## 课程目标
- 知识：掌握必考知识点及答题战略，达到日本本科生专业知识水平。
- 技能：具备经济学研究科及公共政策大学院等笔试的完整答题能力。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 微观·消费者理论 | 消费者理论真题训练 | 6 |
| 2 | 微观·生产者理论 | 生产者理论真题训练 | 6 |
| 3 | 微观·一般均衡 | 一般均衡理论真题训练 | 4 |
| 4 | 微观·公共财/外部性 | 公共财、外部性真题训练 | 4 |
| 5 | 微观·博弈论 | 博弈论真题训练 | 8 |
| 6 | 微观·不完全竞争 | 不完全竞争真题训练 | 4 |
| 7 | 宏观·国民经济/金融 | 国民经济计算、消费、投资、金融真题训练 | 4 |
| 8 | 宏观·IS-LM/国际 | IS-LM、国际经济部分真题训练 | 4 |
| 9 | 宏观·AS-AD | AS-AD部分真题训练 | 4 |
| 10 | 宏观·经济增长 | 经济增长部分真题训练 | 4 |
| 11 | 宏观·论述专题 | 经典论述问题真题训练 | 4 |
| 12 | 套题演练 | 各大学最新过去问套题训练，综合梳理微观宏观理论，指导正确解答策略 | 20 |$pm$, 6, true
where not exists (select 1 from public.promo_content where major = 'keizai' and section = 'course' and title = $pm$过去问训练（微观宏观专项 + 套题演练）$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keizai-course-07', 'keizai', 'course', $pm$经济学 Zemi$pm$, $pm$## 课时摘要
16H · 16回 · 7月期 / 1月期

## 课程描述
前期结合计量经济学与研究计划书写法进行教学指导；后期以研究计划书发表、文献阅读发表和考学答疑为主。全程随堂给予评估与反馈，根据进度灵活调整。

## 每周流程
- 课前：发表同学提前两天分享研究计划书
- 课中：担当发表 → 全员讨论 → 考学相关答疑
- 目标：完成研究计划书构思与书写，提升日文文献阅读及日语发表能力$pm$, 7, true
where not exists (select 1 from public.promo_content where major = 'keizai' and section = 'course' and title = $pm$经济学 Zemi$pm$)
on conflict (id) do nothing;


-- ══ 经营学 (jingying.html) → keiei ══

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keiei-intro', 'keiei', 'major_intro', $pm$专业介绍$pm$, $pm$## 概要
**什么是经营学**

经营学（Management Science）研究企业如何通过有效管理有限资源，在竞争环境中实现成长与盈利目标。简单来说，就是从理论和实证角度回答企业"如何用好手里的牌"的所有问题。

作为一门跨学科领域，经营学建立在经济学、心理学、社会学和统计学的基础之上，具有极强的应用性。

## 独特视角
**知识框架**

经营学的核心分为两大支柱：

① **经营战略**——企业执行目标的行动方法论（How）

② **经营组织**——执行策略的企业主体建构（Who）

在此基础上进一步延伸出市场营销、国际经营和日本式经营管理等子领域，共计5大方向。

## 优势
- 基础门槛低：无需深厚理工科背景，文科生和综合素质强的考生均可顺利入门，通过课程逐步建立理论框架。
- 理论直观易理解：核心概念均可结合现实企业案例理解，不需要抽象数理推导，学习曲线友好。
- 报考选择面广：从东京大学、一桥大学到各商学院均设有经营学课程，难度梯度均匀，各背景考生都能找到适合的目标校。
- 就业前景宽松：涵盖制造业、金融、IT、咨询、商社等全行业。经营学的跨学科知识体系在统计分析、数据管理、商业策划等众多岗位均有直接应用价值。

## 重点研究科
| 学校名 | 研究科 | 专攻/分野 | 英语 | 日语 |
|---|---|---|---|---|
| 东京大学 | 经济学研究科 | 经营学 · 考试1次 | TOEIC 800+ | N1 |
| 一桥大学 | 经营管理学研究科 | 考试1次 | — | N1 |
| 庆应义塾大学 | 商学研究科 | 考试1次 | TOEIC 800+ | N1 |
| 早稻田大学 | 商学研究科 | 市场营销 · 考试2次 | TOEIC 760～850 | N1 |
| 大阪大学 | 经济学研究科 | 经营学 · 考试2次 | TOEIC 760+ | N1 |
| 东北大学 | 经济学研究科 | 考试2次 | TOEFL 80+ | N1 |
| 上智大学 | 経済学研究科 | 市场营销 · 考试2次 | TOEIC 800+ | N1 |
| 一桥大学 ICS | 国際企業戦略研究科 | MBA · 考试1次 | TOEFL 100+ / GRE 330 | N1 |
| 一桥大学 | 経営管理学研究科 | MBA · 考试1次 | — | N1 |
| 庆应义塾 KBS | 経営管理研究科 | MBA · 考试2次 | TOEIC 800+ | — |
| 京都大学 | 経営管理大学院 | MBA · 考试2次 | TOEIC 800+ | N1 |
| 东京科学大学 | 環境社会理工学院 | MOT · 考试1次 | TOEIC 800+ | N1 |
| 青山学院 ABS | 国際マネジメント研究科 | MBA · 考试3次 | TOEIC 760+ | — |
| 立命馆大学 | 商学院 | MBA · 考试3次 | TOEIC 700+ | N1 |

※ 表格前半为研究者课程的主要研究科，后半为 MBA / MOT 的主要研究科。

※ 几乎所有好学校均要求 N1；TOEIC 推荐最低 730 分以上；顶级院校通常一年仅一次考试机会。

## 研究者 vs MBA / MOT
**研究者育成 修士（学术方向）**

- 培养方向：理论研究能力、博士课程深造基础
- 考试内容：理论笔试为主，考察严谨的分析与论述能力
- 毕业要求：通常需完成理论性硕士论文
- 语言要求：N1 必须；TOEIC 730～850 以上

**专门职大学院 MBA / MOT**

- 培养方向：中级管理实践能力，课业量大、覆盖广
- 考试内容：多数无笔试，面试为主，考察思考与表达
- 毕业要求：部分学校不要求毕业论文
- 附加优势：部分学校 MBA 学历可为永住权申请加分

**备考建议：**初期无需过早区分两者方向。多数 MBA 合格者也经历了基础理论学习，备考初期可两手抓，同步推进理论学习与面试准备。二者就业差异可忽略，更关键的是个人能力展示与目标校知名度。$pm$, 0, true
where not exists (select 1 from public.promo_content where major = 'keiei' and section = 'major_intro' and title = $pm$专业介绍$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keiei-course-01', 'keiei', 'course', $pm$经营战略论$pm$, $pm$## 课时摘要
56H · 7回 · 4月期 / 10月期

## 课程描述
从企业顶层到基层，系统讲解企业为实现经营目标所执行的所有策略及方法论。研究企业如何分析内外部环境、设定发展目标、选择竞争策略，并在动态市场中确保可持续增长。

## 课程目标
- 知识：完整掌握经营战略的理论框架与若干核心机制。
- 技能：具备分析战略问题、梳理理论逻辑并高效应对考试的能力。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 产业经济学基础 | 经营学底层经济逻辑；成本理论；三大经济学效应 | 4 |
| 2 | 事业进入 | 产业结构论；进入壁垒理论；成长理论；PPM理论；事业范围论 | 4 |
| 3 | 全社战略·理论框架 | 供应链管理与整合战略；M&A理论 | 4 |
| 4 | 全社战略·方法论 | 整合-中间-市场交易；标准化战略；平台战略；知识产权战略 | 4 |
| 5 | 事业战略·理论框架 | SWOT分析；外部环境竞争理论；内部资源竞争理论 | 4 |
| 6 | 事业战略·方法论 | 基本竞争战略类型；行业标准争夺战；先发/后发优势战略 | 4 |
| 7 | 职能别战略 | 研发管理论；产品开发论 | 4 |$pm$, 1, true
where not exists (select 1 from public.promo_content where major = 'keiei' and section = 'course' and title = $pm$经营战略论$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keiei-course-02', 'keiei', 'course', $pm$经营组织论$pm$, $pm$## 课时摘要
72H · 9回 · 4月期 / 10月期

## 课程描述
以执行战略的"主体"——企业与人——为核心讨论对象。从个人行动机制（微观组织论：动机、心理活动框架）到组织架构的宏观设计（宏观组织论：结构、权力、信息流动），系统构建组织科学的完整知识体系。

## 课程目标
- 知识：全面掌握微观/宏观组织理论、权变理论、组织文化与学习等考试核心内容。
- 技能：能够高效梳理组织学考点逻辑，熟练应对各类题型。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 传统组织理论1 | 古典；新古典组织论 | 4 |
| 2 | 传统组织理论2 | 近代组织论；组织的权变理论 | 4 |
| 3 | 宏观组织理论 | 组织构造；组织形态；机能与形态关联性 | 4 |
| 4 | 微观组织理论1 | 动机理论 | 4 |
| 5 | 微观组织理论2 | 领导力理论；SECI；MBO | 4 |
| 6 | 组织与战略特集 | 组织机能与战略实施的系统性经典结论精讲 | 4 |
| 7 | 企业论 | 企业形态；经营者革命与企业统制；CSR / CSV | 4 |
| 8 | 日本式经营 | 系列；现场；精细供应链；稟議制度；三种神器 | 4 |
| 9 | 前沿组织理论 | 网络组织科学；企业生态论；红皇后理论等 | 4 |$pm$, 2, true
where not exists (select 1 from public.promo_content where major = 'keiei' and section = 'course' and title = $pm$经营组织论$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keiei-course-03', 'keiei', 'course', $pm$市场营销论$pm$, $pm$## 课时摘要
64H · 8回 · 7月期 / 1月期

## 课程描述
围绕企业如何理解、创造并持续满足市场需求展开。从消费者行动机制（需求激发、偏好形成、购买行为）到企业营销战略（STP、营销组合、品牌构建），在微观行动与宏观战略的相互作用中理解市场营销的整体逻辑。

## 课程目标
- 知识：系统掌握消费者行动理论、STP、4P/4C、品牌战略、关系性营销、服务营销等考试核心内容。
- 技能：能够准确识别题目考点，清晰构建论述逻辑，熟练应对论述题、比较题与综合分析题。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 营销入门 | STP；营销组合（Marketing Mix） | 4 |
| 2 | 研究方法与产品论 | 研究方法；产品生命周期 | 4 |
| 3 | 价格论与促销论 | 定价方法；广告与SP | 4 |
| 4 | 流通论 | 流通机能；流通系统设计 | 4 |
| 5 | 服务与社会营销 | 服务营销特征；社会导向营销 | 4 |
| 6 | 关系性营销 | 顾客关系管理；企业间关系管理 | 4 |
| 7 | 品牌论 | 品牌机能；品牌战略 | 4 |
| 8 | 消费者行动论 | 消费者个人行动；消费者集团行动 | 4 |$pm$, 3, true
where not exists (select 1 from public.promo_content where major = 'keiei' and section = 'course' and title = $pm$市场营销论$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keiei-course-04', 'keiei', 'course', $pm$考前对策 · 过去问指导$pm$, $pm$## 课时摘要
20H · 5回 · 7月期 / 1月期

## 课程描述
围绕日本大学商学、经营学研究科笔试科目的针对性训练。涵盖学校别过去问、三大科目知识点复习补足、模拟考试三个部分，旨在快速提升专业知识应用与答题能力。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 入试题型解析 | 名词解释、论述题解题手法与出题意图分析 | 2 |
| 2 | 战略管理真题 | 以经典战略理论为主（SWOT、波特竞争战略等），结合真题 | 2 |
| 3 | 组织理论真题 | 组织设计、权力与文化等基础知识点，真题解题思路 | 2 |
| 4 | 市场营销真题 | 4P理论、消费者行为，最新案例结合，重点突破难题 | 2 |
| 5 | 过去问综合演习 | 综合实践，模拟解答过往真题，思路整理与时间分配 | 2 |$pm$, 4, true
where not exists (select 1 from public.promo_content where major = 'keiei' and section = 'course' and title = $pm$考前对策 · 过去问指导$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keiei-course-05', 'keiei', 'course', $pm$流通学 · 广告学特别讲义$pm$, $pm$## 课时摘要
20H · 5回 · 7月期 / 1月期

## 课程描述
专为备考早稻田、庆应、上智等顶尖名校设计的强化课程，涵盖流通机制、流通国际化、广告策略等高频考点，结合过去问训练，帮助学生在短时间内冲刺名校。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 流通学基础 | 流通机制、流通国际化、渠道设计核心考点梳理 | 2 |
| 2 | 流通学真题解析 | 经典案例与历年真题，常见题型与高分解答技巧 | 2 |
| 3 | 广告学核心理论 | 广告策略、传播路径、品牌定位等核心知识点 | 2 |
| 4 | 广告学真题演练 | 高频题型分析，训练逻辑分析与论述写作能力 | 2 |
| 5 | 综合模拟 | 流通＋广告综合模拟，详细反馈与考前策略指导 | 2 |$pm$, 5, true
where not exists (select 1 from public.promo_content where major = 'keiei' and section = 'course' and title = $pm$流通学 · 广告学特别讲义$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-keiei-course-06', 'keiei', 'course', $pm$经营学 Zemi$pm$, $pm$## 课时摘要
20H · 10回 · 7月期 / 1月期

## 课程描述
前半期围绕研究计划书发表与讨论，配合文献阅读与分享；后半期侧重目标学校过去问答疑与备考确认。全程随堂给予评估与反馈，根据学生进度灵活调整。

## 每周流程
- 课前：发表同学提前两天分享研究计划书及发表要约
- 课中：担当发表 → 全员讨论 → 过去问讲解讨论
- 反馈：老师随堂修改进度与内容，提供即时评估$pm$, 6, true
where not exists (select 1 from public.promo_content where major = 'keiei' and section = 'course' and title = $pm$经营学 Zemi$pm$)
on conflict (id) do nothing;


-- ══ 教育学 (jiaoyu.html) → kyoiku ══

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-kyoiku-intro', 'kyoiku', 'major_intro', $pm$专业介绍$pm$, $pm$## 概要
**什么是教育学**

教育学是研究教育现象、揭示教育规律、探索教育本质和作用的一门学科。它不仅研究"如何教"和"如何学"，更关注教育的**社会功能、历史发展、文化背景和心理基础**。

当今日本的教育学研究涵盖学校教育、家庭教育、社会教育，以及不登校、校园欺凌等社会课题，随着全球化发展，国际理解教育等领域也日益受到关注。

## 独特视角
**四个核心维度**

**对象**——从儿童到成人的各类受教育者，培养知识、技能、思想道德与心理素质。

**内容**——科学知识、社会规范、价值观与文化传承。

**目标**——促进个体全面发展，推动社会进步与文明传承。

**方法**——借助历史学、人类学、社会学、心理学等多学科视角展开研究。

## 优势
- 跨学科性与综合性：涉及心理学、社会学、哲学、历史学、经济学等多学科交叉，能从多方面研究和解决教育中的实际问题，拥有广泛的应用场景。
- 强烈的实践导向：不仅注重理论研究，更强调理论在教育实践中的应用，直接为教学效果改进、教育方法革新和教育政策制定提供指导。
- 全球视野与本土适应：通过比较教育的视角，在全球化背景下研究不同国家和地区的教育经验，促进教育公平与质量提升。
- 涵盖全生命周期：从学校教育延伸至终身教育、成人教育、职业培训，广泛适用性使个体在不同人生阶段都能获得所需知识与技能。

## 重点方向
比較教育学 / 生涯教育学 / 教育社会学 / 教育心理学

## 研究课题例
- フィンランド教育モデルの成功要因とその日本教育への適応可能性
- AIを活用した個別学習支援の効果：パーソナライズドラーニングの可能性
- 教育格差の解消に向けた政策的取り組み：都市部と地方の比較
- ジェンダーと教育：女性の教育機会拡大のための政策提案
- プロジェクト型学習（PBL）の教育効果：21世紀スキルの育成
- STEAM教育の導入が科学的リテラシーに与える影響
- 教師のバーンアウトの原因と対策：職業満足度と教育効果の相関
- 自閉症スペクトラム障害（ASD）児童に対するインクルーシブ教育の実践と課題

## 重点研究科
| 学校名 | 研究科 | 专攻/分野 | 英语 | 日语 |
|---|---|---|---|---|
| 东京大学 | 教育学研究科 | 教育学 | — | N1 |
| 大阪大学 | 人間科学研究科 | 教育学 | TOEFL 80+ | N1 |
| 御茶水女子大学 | 人間文化創成科学研究科 | 人間発達科学専攻 | — | N1 |
| 早稻田大学 | 教育学研究科 | 教育学 | — | N1 |
| 庆应义塾大学 | 社会学研究科 | 社会学 | — | N1 |
| 上智大学 | 総合人間科学研究科 | 教育学 | — | N1 |

※ 英语和日语为合格数据中最低成绩$pm$, 0, true
where not exists (select 1 from public.promo_content where major = 'kyoiku' and section = 'major_intro' and title = $pm$专业介绍$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-kyoiku-course-01', 'kyoiku', 'course', $pm$教育学（全般）$pm$, $pm$## 课时摘要
60H · 20回 · 4月期 / 10月期 · 10:00–12:00 / 13:00–17:00

## 课程描述
教育学的专业课主要围绕各专攻的核心知识点讲解，按大学院考试出题和专攻方向分为多个专题。内部专用教材与大学推荐入试教材结合教学，保证完整性的同时帮助学员短时间高效备考。结合相关研究论文分析，了解教育研究的基本范式与框架。

## 课程目标
- 知识：掌握教育学常考基本概念，了解教育的基本理论框架，夯实所有研究与实践的起点。
- 技能：掌握学术论文写作核心技能：选题与文献综述、论点与结构、日语学术语言表达、小论文写作能力。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 上1 | 计划书基础及案例分析 | 研究计划书基础，案例分析 | 3 |
| 上2 | 研究方法 | 文献法，实验法，质的研究，量的研究，综合的方法 | 3 |
| 上3 | 教育原理 | 学校与文化的关系，儿童观，教师和学校，教育与社会，学习，教育与民族国家的关系 | 3 |
| 上4 | 教育史 | 古代希腊的教育，公教育制度，新教育运动，江户时代，日本公教育制度，大正自由教育，战后日本教育改革 | 3 |
| 上5 | 教育思想 | 欧洲古代思想，日本教育思想流派，洛克，卢梭，裴斯泰洛齐，赫尔巴特，杜威，福禄贝尔和蒙台梭利 | 3 |
| 上6 | 教育制度和课程 | 欧洲古代的学校，近代教育制度，英法德的教育制度建立，课程类型，隐藏课程 | 3 |
| 上7 | 教育方法 | 教育方法的历史演绎，新教育教育方法的历史发展，教育学构造与设计 | 3 |
| 上8 | 学力和教育评价 | 国际学力调查和日本的学力调查，关键能力，評価のタイプ，評価の方法，学力偏差値 | 3 |
| 上9 | 教育制度和课程（进阶） | 近代教育制度深化，英法德教育制度比较研究 | 3 |
| 上10 | 教育方法（进阶） | 教育方法历史发展深化，教育学构造与设计综合演练 | 3 |
| 下1 | 教育社会学1 | 社会学的基本理论（机能、葛藤、解释的方法），教育与格差，教育与公平 | 3 |
| 下2 | 教育社会学2 | 阶层与学历达成，教育扩大和公平，教育社会学理论，文化再生产理论及应用 | 3 |
| 下3 | 教育社会学3 | 教育改革，劳动市场，教育和经济，教育问题 | 3 |
| 下4 | 教师教育 | 教师教育和师范教育，现代学校教师教育改革，专门职 | 3 |
| 下5 | 高等教育 | 高等教育的组织理论，高等教育的市场化，现代高等教育的改革 | 3 |
| 下6 | 社会教育学 | 社会教育理论，成人教育和儿童教育的区别，社会教育的协作 | 3 |
| 下7 | 过去问练习（国立） | 国立大学题目真题训练 | 3 |
| 下8 | 过去问练习（公立） | 公立大学题目真题训练 | 3 |
| 下9 | 过去问练习（私立） | 私立大学题目真题训练 | 3 |
| 下10 | 实践环节 | 模拟考试以及模拟面试 | 3 |$pm$, 1, true
where not exists (select 1 from public.promo_content where major = 'kyoiku' and section = 'course' and title = $pm$教育学（全般）$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-kyoiku-course-02', 'kyoiku', 'course', $pm$社会学理论$pm$, $pm$## 课时摘要
10H · 5回 · 4月期 / 10月期 · 14:00–16:00

## 课程描述
针对大学院社会学相关专攻分野常考过去问设计。社会学理论运用广泛，不仅限于社会学，政治学、经营学等跨学科领域均会涉及，在研究计划书撰写中尤其必不可少。本课程按社会学史发展顺序系统讲解高频考点学者的概念与理论。

## 课程目标
- 知识：注重各理论与当下社会现象结合，丰富具体例帮助理解社会学抽象概念。
- 技能：适用于综合性大学院小论文、文学研究、历史学研究等多种考试场景。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 古典社会学1 | 涂尔干，社会的事实，自杀论，失范，过去问真题 | 2 |
| 2 | 古典社会学2 | 马克思·韦伯，价值自由，社会的行为，新教伦理与资本主义精神，官僚制，过去问真题 | 2 |
| 3 | 20世纪的社会学 | 帕森斯，构造机能主义，AGIL图式，莫顿，机能分析，参照集团，预言自证，过去问真题 | 2 |
| 4 | 现代社会学1 | 吉登斯，行为与构造，构造的二重性，代理，过去问真题 | 2 |
| 5 | 现代社会学2 | 布迪厄，文化再生产，文化资本，惯习，场，不平等的再生产，过去问真题 | 2 |$pm$, 2, true
where not exists (select 1 from public.promo_content where major = 'kyoiku' and section = 'course' and title = $pm$社会学理论$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-kyoiku-course-03', 'kyoiku', 'course', $pm$毕业论文写作$pm$, $pm$## 课时摘要
12H · 6回 · 不定期 · 14:00–16:00

## 课程描述
主要针对冬季考试需重新提交毕业论文、或专科毕业没有毕业论文需资格审查的学生。从起步开始带领完成毕业论文，亦推荐需要基础学术训练的同学参加。

## 课程目标
- 知识：学习日本大学学术训练基础能力、论文写作基础、先行研究查找及基本研究方法。
- 技能：完成学部毕业论文写作，达到日本学部学生的学术技能水平。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 毕业论文的准备 | 论文构成，课题设定，问题意识的提出，先行研究的收集 | 2 |
| 2 | 先行研究的整理与引用 | 先行研究的整理，列表制作，撰写技巧，参考文献与引用的写法 | 2 |
| 3 | 序论的写法 | 序论的基本要求，写法，实例讲解 | 2 |
| 4 | 社会调查基础与资料搜索 | 定性/定量调查，调查的伦理，资料搜索法详解与实例 | 2 |
| 5 | 本论的写法与考察 | 本论的内容、构成与实践 | 2 |
| 6 | 结论与研究计划书 | 结论的基本要求，写法，研究计划书的基础 | 2 |$pm$, 3, true
where not exists (select 1 from public.promo_content where major = 'kyoiku' and section = 'course' and title = $pm$毕业论文写作$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-kyoiku-course-04', 'kyoiku', 'course', $pm$社会人文大课$pm$, $pm$## 课时摘要
40H · 10回 · 每期 · 周日 14:00–18:20

## 课程描述
大学院社会人文系综合专业课程，涵盖社会学、社会福祉学、新闻传播学和综合文化学四大专业的基础知识。帮助学生梳理各专业脉络，同时掌握适用于社会科学广泛领域的研究计划书写作与论述能力。

## 课程目标
- 知识：掌握社会人文基础知识，完成研究计划书，达到日本本科学生专业知识水平。
- 技能：具备研究计划书撰写能力，重视小论文写作，对应社会人文类研究科笔试。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 研究计划书 | 逻辑框架，问题意识的提起，先行研究收集方法，研究方法的设计 | 4 |
| 2 | 新闻学 | 新闻学的概念、历史等 | 4 |
| 3 | 传播学 | 传播学的概念、历史等 | 4 |
| 4 | 社会福祉学 | 社会福祉学的概念、社会福祉的历史 | 4 |
| 5 | 社会政策学 | 社会政策学的概念、历史 | 4 |
| 6 | 社会学 | 社会科学的思考，社会学的定义、略史，集团论 | 4 |
| 7 | 论述题写作 | 论述的基础，读题，写作，真题解答 | 4 |
| 8 | 现代思想 | 哲学的概念，现代思想的重要学者 | 4 |
| 9 | 文化人类学 | 文化人类学的思考、历史，相关概念与课题展示 | 4 |
| 10 | 社会心理学 | 社会心理学的概念、历史 | 4 |$pm$, 4, true
where not exists (select 1 from public.promo_content where major = 'kyoiku' and section = 'course' and title = $pm$社会人文大课$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-kyoiku-course-05', 'kyoiku', 'course', $pm$社会调查与研究方法$pm$, $pm$## 课时摘要
10H · 5回 · 4月期 / 10月期 · 10:00–12:00

## 课程描述
观察、测量社会现象的工具，也是分析运用社会数据的科学方法。课程围绕社会调查研究的主要过程展开，从问题选择、调查设计、问卷设计、抽样到数据分析，系统讲解定量与定性研究方法。

## 课程目标
- 知识：掌握研究设计、抽样、测量、问卷制作、资料收集与统计分析的基本方法，为学术研究与实际工作打下坚实方法基础。
- 技能：对应大学院社会调查相关过去问，并支持实证研究类研究计划书的调查方法设计。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 研究方法选择 | 问题意识，假说构成，观察法，访谈，田野调查，问卷调查，内容分析 | 2 |
| 2 | 调查问卷设计 | 问卷设计，设问与选项，调查对象，数据量化，尺度，信赖性，妥当性，量表 | 2 |
| 3 | 调查数据的解读 | 度数分布表，图表，统计量，对照表，相关与因果 | 2 |
| 4 | 调查数据的一般化 | 统计的推定，统计的检定，独立性检验，平均值的推定和检定 | 2 |
| 5 | 数据讲述了什么 | 分散分析，回归分析，多变量解析 | 2 |$pm$, 5, true
where not exists (select 1 from public.promo_content where major = 'kyoiku' and section = 'course' and title = $pm$社会调查与研究方法$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-kyoiku-course-06', 'kyoiku', 'course', $pm$过去问演习$pm$, $pm$## 课时摘要
15H · 5回 · 7月期 / 1月期 · 16:30–19:30

## 课程描述
以社会学专业知识为核心，同时涉及哲学、传播学、心理学、政治学等相关专业的论述题目。按时间顺序补充所有备考所需专业知识与论述题写作技巧。全专业必修。

## 课程目标
- 知识：掌握社会学及现代社会相关必考概念，达到日本本科学生专业知识水平。
- 技能：具备小论文写作能力，对应社会人文类研究科及社会学科系研究科笔试。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 入试问题解析 | 常见题型【名词解释】【论述】的解题手法、基本解答构造、常用表达方式及出题意图分析 | 3 |
| 2 | 古典社会学理论 | 以古典社会学部分过去问入手，指导学生如何在解答中使用理论及举例方法 | 3 |
| 3 | 现代社会学前夜 | 以结构主义及意味学派部分过去问入手，指导理论梳理与解答方法 | 3 |
| 4 | 过去问实践演习1 | 以现代社会学部分过去问入手，指导理论运用与举例方法 | 3 |
| 5 | 过去问实践演习2 | 现代社会学 part2 及课程总结，集中整理各种解答法的注意事项 | 3 |$pm$, 6, true
where not exists (select 1 from public.promo_content where major = 'kyoiku' and section = 'course' and title = $pm$过去问演习$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-kyoiku-course-07', 'kyoiku', 'course', $pm$教育学 Zemi$pm$, $pm$## 课时摘要
20H · 10回 · 7月期 / 1月期

## 课程描述
前半期以研究计划书发表与讨论、文献阅读为主；后半期侧重目标学校过去问答疑与备考确认。全程随堂评估与反馈，根据学生进度灵活调整。

## 每周流程
- 课前：发表同学提前两天分享研究计划书＋发表要约
- 课中：担当发表 → 全员讨论 → 过去问讲解讨论
- 反馈：老师随堂修改进度与内容，提供即时评估$pm$, 7, true
where not exists (select 1 from public.promo_content where major = 'kyoiku' and section = 'course' and title = $pm$教育学 Zemi$pm$)
on conflict (id) do nothing;


-- ══ 社会福祉学 (fuzhi.html) → fukushi ══

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-fukushi-intro', 'fukushi', 'major_intro', $pm$专业介绍$pm$, $pm$## 概要
**什么是社会福祉学**

社会福祉学是一门以**提升人类福祉**为核心的学科，关注个体和社会的幸福与良好状态（well-being）。它通过公共援助和服务来促进生活的稳定与充实，是一门以实践为导向的应用科学。

总的来说，社会福祉学是一门兼具理论深度与实践价值的学科，能够帮助解决社会中的紧迫问题，同时也为希望为社会福祉作出贡献的研究者提供了丰富的机会。

## 独特视角
**三个核心特点**

**跨学科性质**——从社会学、政治学、经济学等多种学科汲取理论与方法，具有很强的跨学科特点。

**实践导向**——不仅停留在理论层面，更关注现实问题的解决，涉及社会保障、政策制定、贫困、社会排斥、孤独等问题。

**现实关联性强**——研究对象涵盖贫困、老龄化、心理健康、社会排斥等现代社会现实问题，帮助制定有效的社会政策和福祉服务。

## 优势
- 解决实际问题：直接应用于解决社会问题。通过对弱势群体的研究，提供有效的援助和服务，改善他们的生活质量，具有切实的社会意义。
- 社会影响力大：对社会政策的制定和实施有着重要影响，尤其在社会保障、公共卫生、贫困救助等领域，能够为社会决策者提供科学依据。
- 广泛的就业领域：从公共政策、社会工作到非营利组织，毕业生拥有广泛的就业前景，可在政府部门、社区组织、国际机构等多种领域发挥作用。

## 重点方向
社会学社会福祉学 / 社会政策学 / ソーシャルワーク / 福祉サービス

## 研究课题例
- 自ら支援を求めない独居高齢者への地域を基盤としたアウトリーチ実践（高齢者・地域福祉）
- 中国都市部における住民自治組織に関する研究：北京市社区を事例に（地域福祉）
- 介護保険施設における介護職員の離職防止に関する質的調査（介護・労働）
- 生活保護制度における面接相談の実態と機能（低所得者福祉）
- 不登校児童生徒に対する民間施設の効果的な支援に関する研究（児童家庭福祉）
- 母子世帯の生成と貧困化のメカニズム（貧困・児童家庭福祉）
- 発達障害を有し漢字習得に困難さがある児童への効果的な書字指導の検討（障害者福祉）
- 大正期から昭和初期の社会事業における民間助成財団の意義と役割（福祉歴史）

## 重点研究科
| 学校名 | 研究科 | 专攻/分野 | 英语 | 日语 |
|---|---|---|---|---|
| 一桥大学 | 社会学研究科 | 社会研究・地球研究 | TOEIC 800+ | — |
| 大阪大学 | 人間科学研究科 | 社会学・人間学系 | TOEFL 80+ | N1 |
| 東京都立大学 | 人文科学研究科 | 社会行動学 | — | N1 |
| 上智大学 | 総合人間科学研究科 | 社会福祉学 | TOEIC 750+ | N1 |
| 立教大学 | コミュニティ福祉学研究科 | コミュニティ福祉学 | — | N1 |
| 立命館大学 | 社会学研究科 | 応用社会学 | TOEIC 700+ | N1 |

※ 英语和日语为合格数据中最低成绩$pm$, 0, true
where not exists (select 1 from public.promo_content where major = 'fukushi' and section = 'major_intro' and title = $pm$专业介绍$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-fukushi-course-01', 'fukushi', 'course', $pm$社会福祉学$pm$, $pm$## 课时摘要
10H · 5回 · 4月期 / 10月期 · 10:00–12:00

## 课程描述
通过社会福祉理论和实践的学习，帮助学生掌握社会福祉的专业用语，了解社会福祉的基本视角，学会分析常见的福祉问题。课堂中有效利用报纸、杂志文章、影像资料等，引发学生对具体福祉案例进行思考和讨论。

## 课程目标
- 知识：从整体上对社会福祉有概观的了解，掌握社会福祉相关基础概念及理论。
- 技能：能够从生活问题与社会结构的关系出发，说明现代社会福祉问题。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 社会福祉概要 | 什么是社会福祉，社会福祉的价值观念，社会福祉领域的专门职 | 2 |
| 2 | 社会福祉的历史 | 欧美的社会福祉历史，日本的社会福祉历史 | 2 |
| 3 | 社会福祉的需求 | 什么是需求，如何把握需求，如何回应需求 | 2 |
| 4 | 社会福祉援助技术 | 什么是社会工作，社会工作的展开过程，社会工作理论 | 2 |
| 5 | 社会福祉的发展方向 | 目前社会福祉的课题，伴走型支援，社会工作的可能性 | 2 |$pm$, 1, true
where not exists (select 1 from public.promo_content where major = 'fukushi' and section = 'course' and title = $pm$社会福祉学$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-fukushi-course-02', 'fukushi', 'course', $pm$社会政策学$pm$, $pm$## 课时摘要
10H · 5回 · 7月期 / 1月期 · 10:00–12:00

## 课程描述
对应社会政策/政策研究等方向。概述日本面临的社会政策问题，包括劳动与就业、医疗保健系统、养老金制度、护理服务、生活保护等，加深对制度化解决方案的理解。

## 课程目标
- 知识：掌握社会政策（社会保障）的基础知识，了解社会政策发挥的功能及制度中存在的问题。
- 技能：养成政策分析视角，考察社会福祉、社会政策领域中存在的问题。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 社会政策的定义与历史 | 什么是社会政策，社会政策与社会保障，社会保障的历史展开 | 2 |
| 2 | 公的扶助 | 生活保护制度，生活保护制度中存在的问题，生活保护的动向及新的救济制度 | 2 |
| 3 | 劳动与就业 | 日本的雇佣系统与劳动问题，雇佣保险制度、劳灾保险制度 | 2 |
| 4 | 年金·医疗·介护制度 | 年金保险制度，医疗保险制度，介护保险制度 | 2 |
| 5 | 住宅政策 | 住宅与居住保障，住宅政策的种类，住宅政策的课题 | 2 |$pm$, 2, true
where not exists (select 1 from public.promo_content where major = 'fukushi' and section = 'course' and title = $pm$社会政策学$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-fukushi-course-03', 'fukushi', 'course', $pm$现代福祉问题$pm$, $pm$## 课时摘要
10H · 5回 · 不定期

## 课程描述
对应贫困问题/社会政策分析/地域福祉等方向。从实践角度出发，综合运用社会学、社会福祉、社会政策等领域的理论与视角，引导学生分析现代社会福祉问题产生的背景、原因和影响，并对解决对策进行深入思考。

## 课程目标
- 知识：了解现代社会主要存在的社会福祉问题，从社会结构关系出发解释现代福祉问题。
- 技能：初步选择研究计划书方向，能够回答过去问中关于社会福祉问题的小论文。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 障害者福祉 | 概念、分类与基本理念，权利维护 | 2 |
| 2 | 高龄者福祉 | 高龄者介护，高龄者贫困，高龄者的社会关系与社会孤立 | 2 |
| 3 | 儿童家庭福祉 | 育儿问题，儿童虐待，儿童贫困 | 2 |
| 4 | 贫困问题 | 贫困的定义，贫困与不平等 | 2 |
| 5 | 地域福祉 | 理念和历史，地域福祉的方法与关联团体，地域福祉与共生社会 | 2 |$pm$, 3, true
where not exists (select 1 from public.promo_content where major = 'fukushi' and section = 'course' and title = $pm$现代福祉问题$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-fukushi-course-04', 'fukushi', 'course', $pm$社会福祉经营$pm$, $pm$## 课时摘要
10H · 5回 · 不定期

## 课程描述
对应社会福祉经营研究方向。以福祉制度和经营学为基础，帮助学生了解提供福祉服务的组织管理相关知识。与企业不同，提供福祉服务的组织以福祉制度为基础，主要依赖公共资金，其管理方式与企业经营管理存在本质差异。本课程通过宏观与微观两个视角讲解福祉经营管理。

## 课程目标
- 知识：掌握社会福祉经营相关基础概念及理论。
- 技能：运用上述知识分析社会福祉经营方面存在的问题，具备福祉经营领域的问题意识。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 社会福祉经营概要 | 课程导入，社会福祉中经营管理的意义 | 2 |
| 2 | 福祉服务的提供主体 | 行政，法人制度（一般社団法人・財団法人・社会福祉法人・医療法人・営利法人等），NPO、志愿者等 | 2 |
| 3 | 服务管理运营 | 服务管理（战略、规划等），服务的质与评价，投诉处理与风险管理 | 2 |
| 4 | 组织运营管理1 | 人事、劳务管理，财务管理 | 2 |
| 5 | 组织运营管理2 | 情报管理，服务利用者的权利保护 | 2 |$pm$, 4, true
where not exists (select 1 from public.promo_content where major = 'fukushi' and section = 'course' and title = $pm$社会福祉经营$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-fukushi-course-05', 'fukushi', 'course', $pm$毕业论文写作$pm$, $pm$## 课时摘要
12H · 6回 · 不定期 · 14:00–16:00

## 课程描述
主要针对冬季考试需重新提交毕业论文、或专科毕业没有毕业论文需资格审查的学生。从起步开始带领完成毕业论文，亦推荐需要基础学术训练的同学参加。

## 课程目标
- 知识：学习日本大学学术训练基础能力、论文写作基础、先行研究查找及基本研究方法。
- 技能：完成学部毕业论文写作，达到日本学部学生的学术技能水平。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 毕业论文的准备 | 论文构成，课题设定，问题意识的提出，先行研究的收集 | 2 |
| 2 | 先行研究的整理与引用 | 先行研究的整理，列表制作，撰写技巧，参考文献与引用的写法 | 2 |
| 3 | 序论的写法 | 序论的基本要求，写法，实例讲解 | 2 |
| 4 | 社会调查基础与资料搜索 | 定性/定量调查，调查的伦理，资料搜索法详解与实例 | 2 |
| 5 | 本论的写法与考察 | 本论的内容、构成与实践 | 2 |
| 6 | 结论与研究计划书 | 结论的基本要求，写法，研究计划书的基础 | 2 |$pm$, 5, true
where not exists (select 1 from public.promo_content where major = 'fukushi' and section = 'course' and title = $pm$毕业论文写作$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-fukushi-course-06', 'fukushi', 'course', $pm$社会人文大课$pm$, $pm$## 课时摘要
40H · 10回 · 每期 · 周日 14:00–18:20

## 课程描述
大学院社会人文系综合专业课程，涵盖社会学、社会福祉学、新闻传播学和综合文化学四大专业的基础知识。帮助学生梳理各专业脉络，同时掌握适用于社会科学广泛领域的研究计划书写作与论述能力。

## 课程目标
- 知识：掌握社会人文基础知识，完成研究计划书，达到日本本科学生专业知识水平。
- 技能：具备研究计划书撰写能力，重视小论文写作，对应社会人文类研究科笔试。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 研究计划书 | 逻辑框架，问题意识的提起，先行研究收集方法，研究方法的设计 | 4 |
| 2 | 新闻学 | 新闻学的概念、历史等 | 4 |
| 3 | 传播学 | 传播学的概念、历史等 | 4 |
| 4 | 社会福祉学 | 社会福祉学的概念、社会福祉的历史 | 4 |
| 5 | 社会政策学 | 社会政策学的概念、历史 | 4 |
| 6 | 社会学 | 社会科学的思考，社会学的定义、略史，集团论 | 4 |
| 7 | 论述题写作 | 论述的基础，读题，写作，真题解答 | 4 |
| 8 | 现代思想 | 哲学的概念，现代思想的重要学者 | 4 |
| 9 | 文化人类学 | 文化人类学的思考、历史，相关概念与课题展示 | 4 |
| 10 | 社会心理学 | 社会心理学的概念、历史 | 4 |$pm$, 6, true
where not exists (select 1 from public.promo_content where major = 'fukushi' and section = 'course' and title = $pm$社会人文大课$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-fukushi-course-07', 'fukushi', 'course', $pm$社会调查与研究方法$pm$, $pm$## 课时摘要
10H · 5回 · 4月期 / 10月期 · 10:00–12:00

## 课程描述
观察、测量社会现象的工具，也是分析运用社会数据的科学方法。课程围绕社会调查研究的主要过程展开，系统讲解定量与定性研究方法。

## 课程目标
- 知识：掌握研究设计、抽样、测量、问卷制作、资料收集与统计分析的基本方法。
- 技能：对应大学院社会调查相关过去问，并支持实证研究类研究计划书的调查方法设计。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 研究方法选择 | 问题意识，假说构成，观察法，访谈，田野调查，问卷调查，内容分析 | 2 |
| 2 | 调查问卷设计 | 问卷设计，设问与选项，调查对象，数据量化，尺度，信赖性，妥当性，量表 | 2 |
| 3 | 调查数据的解读 | 度数分布表，图表，统计量，对照表，相关与因果 | 2 |
| 4 | 调查数据的一般化 | 统计的推定，统计的检定，独立性检验，平均值的推定和检定 | 2 |
| 5 | 数据讲述了什么 | 分散分析，回归分析，多变量解析 | 2 |$pm$, 7, true
where not exists (select 1 from public.promo_content where major = 'fukushi' and section = 'course' and title = $pm$社会调查与研究方法$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-fukushi-course-08', 'fukushi', 'course', $pm$过去问演习$pm$, $pm$## 课时摘要
15H · 5回 · 7月期 / 1月期 · 16:30–19:30

## 课程描述
以社会学专业知识为核心，同时涉及哲学、传播学、心理学、政治学等相关专业的论述题目。按时间顺序补充所有备考所需专业知识与论述题写作技巧。全专业必修。

## 课程目标
- 知识：掌握社会学及现代社会相关必考概念，达到日本本科学生专业知识水平。
- 技能：具备小论文写作能力，对应社会人文类研究科及社会学科系研究科笔试。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 入试问题解析 | 常见题型【名词解释】【论述】的解题手法、基本解答构造、常用表达方式及出题意图分析 | 3 |
| 2 | 古典社会学理论 | 以古典社会学部分过去问入手，指导学生如何在解答中使用理论及举例方法 | 3 |
| 3 | 现代社会学前夜 | 以结构主义及意味学派部分过去问入手，指导理论梳理与解答方法 | 3 |
| 4 | 过去问实践演习1 | 以现代社会学部分过去问入手，指导学生理论运用与举例方法 | 3 |
| 5 | 过去问实践演习2 | 现代社会学 part2 及课程总结，集中整理各种解答法的注意事项 | 3 |$pm$, 8, true
where not exists (select 1 from public.promo_content where major = 'fukushi' and section = 'course' and title = $pm$过去问演习$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-fukushi-course-09', 'fukushi', 'course', $pm$社会福祉学 Zemi$pm$, $pm$## 课时摘要
20H · 10回 · 7月期 / 1月期

## 课程描述
前半期以研究计划书发表与讨论、文献阅读为主；后半期侧重目标学校过去问答疑与备考确认。全程随堂评估与反馈，根据学生进度灵活调整。

## 每周流程
- 课前：发表同学提前两天分享研究计划书＋发表要约
- 课中：担当发表 → 全员讨论 → 过去问讲解讨论
- 反馈：老师随堂修改进度与内容，提供即时评估$pm$, 9, true
where not exists (select 1 from public.promo_content where major = 'fukushi' and section = 'course' and title = $pm$社会福祉学 Zemi$pm$)
on conflict (id) do nothing;


-- ══ 新闻传播学 (xinchuan.html) → shinpan ══

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shinpan-intro', 'shinpan', 'major_intro', $pm$专业介绍$pm$, $pm$## 概要
**什么是新闻传播学**

新闻传媒学是一门典型的**学际型学科**，与社会心理学、政治学、教育学等紧密相连。它分为三个核心领域：

**媒体论**——研究媒体的社会意义、媒体与个人及社会的相互作用、媒体技术的发展与变迁。

**传播学研究**——研究所有传播信息的社会活动及其传播效果。

**新闻论**——研究从事时事报道活动的人、组织及活动本身。

## 独特视角
**新传的独特优势**

新闻传播学不仅理论扎实，也能灵活应对实际问题，是一门兼具**学术深度与现实影响力**的学科。

研究范围横跨个人兴趣、文化现象、大众传播到社会舆论，可根据自己的兴趣探索新闻、广告、公共关系、社交媒体等不同领域。

尤其当你想研究社会或政治问题却苦于找不到突破口时，新传极有可能打开一个全新的研究视角。

## 优势
- 交叉性强：与社会心理学、政治学、教育学等多学科紧密相连，通过不同学科的理论和方法帮助理解传播现象背后的深层原因，使研究更具广度和深度。
- 研究范围广：涵盖从个人兴趣、文化现象到大众传播、社会舆论等各个方面，可根据自己的兴趣探索新闻、广告、公关、社交媒体等不同领域。
- 时事性强：研究内容紧跟时事和社会热点，通过分析最新事件与趋势为社会提供洞察与解读，具有极强的现实应用价值。

## 重点方向
メディア / コミュニケーション学 / メディア社会学 / 政治コミュニケーション学

## 研究课题例
- 映画における小樽の「観光」表象及びその変容（媒体表象研究）
- SNS利用が中国人留学生の社会関係資本と孤独感に与える影響（媒体利用与社群研究）
- フェイクニュースが日本国内の政治的議論に与える影響（数字新闻可信度研究）
- VTuberが若者のメディア消費習慣に与える影響（受众行为研究）
- AIを活用したニュース生成がジャーナリズムの質に与える影響（媒体技术与社会变迁）
- コロナパンデミック時における日本政府のリスクコミュニケーション戦略（危机管理传播）
- 日本の選挙キャンペーンにおけるデジタルメディア活用の効果（媒体与政治传播）
- 日韓文化コンテンツのリメイク現象に関する研究（媒体文化研究）

## 重点研究科
| 学校名 | 研究科 | 专攻/分野 | 英语 | 日语 |
|---|---|---|---|---|
| 東京大学 | 情報学環 | 社会情報 | TOEFL 100+ | N1 |
| 京都大学 | 人間・環境学研究科 | 人間科学 | TOEFL 80+ | N1 |
| 东京工业大学 | 環境・社会理工学院 | 社会・人間 | TOEIC 800+ | N1 |
| 北海道大学 | 国際広報メディア・観光学院 | 国際広報メディア | TOEIC 700+ | N1 |
| 上智大学 | 文学研究科 | 新聞学 | TOEIC 800+ | N1 |
| 立教大学 | 社会学研究科 | メディア社会 | TOEIC 750+ | N1 |

※ 英语和日语为合格数据中最低成绩$pm$, 0, true
where not exists (select 1 from public.promo_content where major = 'shinpan' and section = 'major_intro' and title = $pm$专业介绍$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shinpan-course-01', 'shinpan', 'course', $pm$新闻传播学$pm$, $pm$## 课时摘要
10H · 5回 · 4月期 / 10月期 · 10:00–12:00

## 课程描述
针对大学院新闻传播和政治传播领域常考过去问设计。运用传播模型与理论，从传播者、信息、媒介和受众四个维度分析传播效果；同时融入新闻学内容，了解新闻事业的历史轨迹，结合 AI 和假新闻等社会热点深入理解政治传播。

## 课程目标
- 知识：掌握传播模型与理论，从四个维度分析传播效果的过程和原理。
- 技能：掌握新闻传播学论述题解答思路，明确研究计划书的专业定位与课题方向。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 传播学知识系谱 | 媒介性，大众传播，如何研究传播，过去问真题 | 2 |
| 2 | 媒介的发展 | 口语，文字，印刷，图像，广播，电影，电视和网络，过去问真题 | 2 |
| 3 | 传播效果论 | 枪弹论，有限效果论，使用与满足论，议题设定，沉默的螺旋，知沟理论，框架理论，过去问真题 | 2 |
| 4 | 日本报业与近代新闻学 | 新闻学，日本报业发展，咖啡厅，公共圈，审查与言论自由，市民记者，过去问真题 | 2 |
| 5 | 现代政治传播与大众舆论 | 政治传播活动的基本结构，把关人理论，意见领袖，选择性接触，意见极化，AI的发展，虚假新闻，过去问真题 | 2 |$pm$, 1, true
where not exists (select 1 from public.promo_content where major = 'shinpan' and section = 'course' and title = $pm$新闻传播学$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shinpan-course-02', 'shinpan', 'course', $pm$社会心理学$pm$, $pm$## 课时摘要
10H · 5回 · 7月期 / 1月期 · 10:00–12:00

## 课程描述
对应社会心理学/传播效果等方向。科学研究人们在社会情境中如何思考、体验和行为，理解人们在日常生活中如何影响他人及被他人影响。主要涉及"情感"、"传播效果"、"偏见"三大方向，以及"风险认知"、"粉丝心理"两个专题。建议与新闻传播学课程同步学习。

## 课程目标
- 知识：学习社会心理学领域的基本概念和主题方向。
- 技能：掌握社会心理学相关论述题解答思路，明确研究计划书的专业定位与课题。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 自我 | 自我觉知，自我意识，自我表演，自证预言，自我偏差 | 2 |
| 2 | 社会认知 | 认知偏差，启动效应，归因理论，印象形成，刻板印象 | 2 |
| 3 | 态度与偏见 | 态度的功能，测量，学习理论，情感因素，计划行为理论，认知失调，说服，偏见 | 2 |
| 4 | 风险认知 | 风险社会，台风眼效应，风险态度，影响因素 | 2 |
| 5 | 粉丝心理 | 粉丝心理构造，内集团和外集团，意见领袖，二阶段信息流向假设，粉丝行为和网络活动，粉丝研究方法 | 2 |$pm$, 2, true
where not exists (select 1 from public.promo_content where major = 'shinpan' and section = 'course' and title = $pm$社会心理学$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shinpan-course-03', 'shinpan', 'course', $pm$微观社会学$pm$, $pm$## 课时摘要
10H · 5回 · 不定期 · 16:30–18:30

## 课程描述
对应传媒研究/互动研究/对话分析等方向，又称"日常生活的社会学"。微观社会学的知识在进行定性调查（参与观察、深度访谈）时不可或缺，近年对定性调查的影响在各校调查法考题中频繁出现。

## 课程目标
- 知识：学习符号互动论、Goffman社会学、常人方法论、现象学社会学的概念与理论视角。
- 技能：有效应对任何大学相关领域考题，并支持定性研究计划书的方法论设计。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 符号互动论 | 米德的主客我，社会世界论，布鲁默的符号互动论复兴，贝克尔的标签论，哈金的循环效应（looping effect） | 2 |
| 2 | Goffman社会学（上） | 拟剧论，展演，身体互动的秩序，情境定义，互动仪式，face-work，儀礼的無関心，役割距離，框架分析 | 2 |
| 3 | Goffman社会学（下） | スティグマ，アサイラム，出会い，Goffman社会学的应用（情感社会学、观光社会学的performance転回） | 2 |
| 4 | 常人方法论 | 违背实验，翻译定理，会话分析，成员分类 | 2 |
| 5 | 现象学的社会学 | 胡塞尔的现象学，舒茨的现象学社会学，主观间性，生活世界，自明性，梅洛庞蒂的身体论，身体社会学 | 2 |$pm$, 3, true
where not exists (select 1 from public.promo_content where major = 'shinpan' and section = 'course' and title = $pm$微观社会学$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shinpan-course-04', 'shinpan', 'course', $pm$现代文化论$pm$, $pm$## 课时摘要
10H · 5回 · 7月期 / 1月期 · 14:00–16:00

## 课程描述
对应文化人类学/文化研究/文化社会学方向。在全球化背景下，文化研究已呈现跨学科、多样性特征。涵盖艺术表象（电影、雕塑）、流行文化（偶像、时尚）、亚文化（二次元、女权主义、性少数群体文化）及文化人类学等全面内容。

## 课程目标
- 知识：掌握报考社会学、表象文化论、文化研究、观光地域振兴、文化人类学所需专业知识。
- 技能：灵活完成文化相关论述题，并将所学知识融入学生关心的研究课题中。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 文化的定义 | 文化是什么；社会学、文化研究、文化人类学的文化概念；课题与界限 | 2 |
| 2 | 表现文化的社会学 | 表现文化的社会学理论，音乐文化杂食论，传媒科技的文化 | 2 |
| 3 | 文化研究 | 文化研究与文化的动态性，亚文化论，文化研究的女权主义 | 2 |
| 4 | 电影、大众文化与文艺批评 | 传媒和受众，大众文化，电影分析，价值，文艺批评 | 2 |
| 5 | 全球化时代的文化越境 | 全球化论与跨国主义论，越境媒体与流行文化，文化与自我认同的政治 | 2 |$pm$, 4, true
where not exists (select 1 from public.promo_content where major = 'shinpan' and section = 'course' and title = $pm$现代文化论$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shinpan-course-05', 'shinpan', 'course', $pm$毕业论文写作$pm$, $pm$## 课时摘要
12H · 6回 · 不定期 · 14:00–16:00

## 课程描述
主要针对冬季考试需重新提交毕业论文、或专科毕业没有毕业论文需资格审查的学生。从起步开始带领完成毕业论文，亦推荐需要基础学术训练的同学参加。

## 课程目标
- 知识：学习日本大学学术训练基础能力、论文写作基础、先行研究查找及基本研究方法。
- 技能：完成学部毕业论文写作，达到日本学部学生的学术技能水平。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 毕业论文的准备 | 论文构成，课题设定，问题意识的提出，先行研究的收集 | 2 |
| 2 | 先行研究的整理与引用 | 先行研究的整理，列表制作，撰写技巧，参考文献与引用的写法 | 2 |
| 3 | 序论的写法 | 序论的基本要求，写法，实例讲解 | 2 |
| 4 | 社会调查基础与资料搜索 | 定性/定量调查，调查的伦理，资料搜索法详解与实例 | 2 |
| 5 | 本论的写法与考察 | 本论的内容、构成与实践 | 2 |
| 6 | 结论与研究计划书 | 结论的基本要求，写法，研究计划书的基础 | 2 |$pm$, 5, true
where not exists (select 1 from public.promo_content where major = 'shinpan' and section = 'course' and title = $pm$毕业论文写作$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shinpan-course-06', 'shinpan', 'course', $pm$社会人文大课$pm$, $pm$## 课时摘要
40H · 10回 · 每期 · 周日 14:00–18:20

## 课程描述
大学院社会人文系综合专业课程，涵盖社会学、社会福祉学、新闻传播学和综合文化学四大专业的基础知识。帮助学生梳理各专业脉络，同时掌握适用于社会科学广泛领域的研究计划书写作与论述能力。

## 课程目标
- 知识：掌握社会人文基础知识，完成研究计划书，达到日本本科学生专业知识水平。
- 技能：具备研究计划书撰写能力，重视小论文写作，对应社会人文类研究科笔试。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 研究计划书 | 逻辑框架，问题意识的提起，先行研究收集方法，研究方法的设计 | 4 |
| 2 | 新闻学 | 新闻学的概念、历史等 | 4 |
| 3 | 传播学 | 传播学的概念、历史等 | 4 |
| 4 | 社会福祉学 | 社会福祉学的概念、社会福祉的历史 | 4 |
| 5 | 社会政策学 | 社会政策学的概念、历史 | 4 |
| 6 | 社会学 | 社会科学的思考，社会学的定义、略史，集团论 | 4 |
| 7 | 论述题写作 | 论述的基础，读题，写作，真题解答 | 4 |
| 8 | 现代思想 | 哲学的概念，现代思想的重要学者 | 4 |
| 9 | 文化人类学 | 文化人类学的思考、历史，相关概念与课题展示 | 4 |
| 10 | 社会心理学 | 社会心理学的概念、历史 | 4 |$pm$, 6, true
where not exists (select 1 from public.promo_content where major = 'shinpan' and section = 'course' and title = $pm$社会人文大课$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shinpan-course-07', 'shinpan', 'course', $pm$社会调查与研究方法$pm$, $pm$## 课时摘要
10H · 5回 · 4月期 / 10月期 · 10:00–12:00

## 课程描述
观察、测量社会现象的工具，也是分析运用社会数据的科学方法。课程围绕社会调查研究的主要过程展开，系统讲解定量与定性研究方法。

## 课程目标
- 知识：掌握研究设计、抽样、测量、问卷制作、资料收集与统计分析的基本方法。
- 技能：对应大学院社会调查相关过去问，并支持实证研究类研究计划书的调查方法设计。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 研究方法选择 | 问题意识，假说构成，观察法，访谈，田野调查，问卷调查，内容分析 | 2 |
| 2 | 调查问卷设计 | 问卷设计，设问与选项，调查对象，数据量化，尺度，信赖性，妥当性，量表 | 2 |
| 3 | 调查数据的解读 | 度数分布表，图表，统计量，对照表，相关与因果 | 2 |
| 4 | 调查数据的一般化 | 统计的推定，统计的检定，独立性检验，平均值的推定和检定 | 2 |
| 5 | 数据讲述了什么 | 分散分析，回归分析，多变量解析 | 2 |$pm$, 7, true
where not exists (select 1 from public.promo_content where major = 'shinpan' and section = 'course' and title = $pm$社会调查与研究方法$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shinpan-course-08', 'shinpan', 'course', $pm$过去问演习$pm$, $pm$## 课时摘要
15H · 5回 · 7月期 / 1月期 · 16:30–19:30

## 课程描述
以社会学专业知识为核心，同时涉及哲学、传播学、心理学、政治学等相关专业的论述题目。按时间顺序补充所有备考所需专业知识与论述题写作技巧。全专业必修。

## 课程目标
- 知识：掌握社会学及现代社会相关必考概念，达到日本本科学生专业知识水平。
- 技能：具备小论文写作能力，对应社会人文类研究科及社会学科系研究科笔试。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 入试问题解析 | 常见题型【名词解释】【论述】的解题手法、基本解答构造、常用表达方式及出题意图分析 | 3 |
| 2 | 古典社会学理论 | 以古典社会学部分过去问入手，指导学生如何在解答中使用理论及举例方法 | 3 |
| 3 | 现代社会学前夜 | 以结构主义及意味学派部分过去问入手，指导理论梳理与解答方法 | 3 |
| 4 | 过去问实践演习1 | 以现代社会学部分过去问入手，指导学生理论运用与举例方法 | 3 |
| 5 | 过去问实践演习2 | 现代社会学 part2 及课程总结，集中整理各种解答法的注意事项 | 3 |$pm$, 8, true
where not exists (select 1 from public.promo_content where major = 'shinpan' and section = 'course' and title = $pm$过去问演习$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-shinpan-course-09', 'shinpan', 'course', $pm$新闻传播学 Zemi$pm$, $pm$## 课时摘要
20H · 10回 · 7月期 / 1月期

## 课程描述
前半期以研究计划书发表与讨论、文献阅读为主；后半期侧重目标学校过去问答疑与备考确认。全程随堂评估与反馈，根据学生进度灵活调整。

## 每周流程
- 课前：发表同学提前两天分享研究计划书＋发表要约
- 课中：担当发表 → 全员讨论 → 过去问讲解讨论
- 反馈：老师随堂修改进度与内容，提供即时评估$pm$, 9, true
where not exists (select 1 from public.promo_content where major = 'shinpan' and section = 'course' and title = $pm$新闻传播学 Zemi$pm$)
on conflict (id) do nothing;


-- ══ 表象文化 (biaoxiang.html) → hyosho ══

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-hyosho-intro', 'hyosho', 'major_intro', $pm$专业介绍$pm$, $pm$## 概要
**什么是表象文化**

表象文化（Representation Culture）是指人类通过各种媒介构建自我、他者以及世界的方式，并由此创造出的文化产品与文化现象。在哲学中它意味着"再现＝代行"，在戏剧中指"舞台化＝演出"，在政治上则涉及"代表制"。

表象文化论是一门**跨学科研究领域**，涵盖文学、艺术、哲学，以及电视、电影、信息网络等现代媒体空间和流行文化。其核心关注点是将各类文化现象视为可解读的文本，探讨文化活动背后的权力关系和社会结构。

## 独特视角
**四大研究方向**

**身体与艺术**——如何理解身体，身体在艺术行为中的位置与意义，以及身体如何在整个人类文化中被形塑。

**媒体与影像**——电影、动画、漫画、写真等形式的时间与空间构筑，多媒体艺术与身体的互动关系。

**亚文化与身份认同**——二次元、Cosplay、VTuber、偶像文化如何在社交媒体时代重塑个体与社会的关系。

**灾难、破坏与社会想象**——末世想象、城市毁灭等主题如何反映社会焦虑，流行文化如何呈现人类对未来的不安。

## 优势
- 跨学科性强：影像、文本、声音、符号、身体、媒介等多个维度并重，允许从社会学、电影理论、哲学等不同学科视角切入研究，适合各种学术背景的学生。
- 贴近现代文化产业：电影、动画、漫画、游戏、数字媒体、VR、AI等新兴文化产业快速发展，表象文化研究可直接与文化产业、创意产业相结合，为进入相关行业奠定理论基础。
- 批判性强：不仅研究如何再现世界，更探讨表象如何塑造社会现实。战后电影与国族记忆、虚拟偶像与性别认同、灾难电影与社会不安——议题与现实息息相关。

## 重点方向
映像文化研究 / マンガ / アニメ / ゲーム研究 / メディア文化論 / ファッション / アイドル / 音楽文化研究 / ジェンダー研究 / 身体論 / 視覚文化 / アート / ポピュラーカルチャーと社会記憶

## 研究课题例
- 新海誠作品における都市風景と時間表象の研究（映像文化研究）
- ジブリ映画におけるジェンダー表象と女性キャラクターの変遷（アニメ研究）
- VTuber文化におけるアイデンティティと仮想人格の構築（メディア文化論）
- アイドル文化における「卒業」という儀式の意味と変遷（ポップカルチャー研究）
- サイボーグSF映画におけるポストヒューマンの身体表象（身体論・ジェンダー研究）
- ゲームのナラティブにおけるプレイヤー主体性とインタラクションの分析（ゲーム研究）
- 現代アートにおけるインタラクティブ技術と観客の参加性（視覚文化・アート研究）
- ポストアポカリプス映画における災害と社会再生の表象（社会想像研究）

## 重点研究科
| 学校名 | 研究科 | 专攻/分野 | 英语 | 日语 |
|---|---|---|---|---|
| 東京大学 | 総合文化研究科 | 超域文化科学 | TOEFL 90+ | N1 |
| 一桥大学 | 言語社会研究科 | 専門１ | TOEIC 800+ | — |
| 大阪大学 | 人文学研究科 | 言語文化学 | TOEFL 90+ | N1 |
| 法政大学 | 人文学研究科 | 国際日本学インスティテュート | TOEIC 750+ | N2 |
| 早稲田大学 | 文学研究科 | 表象・メディア論 | TOEIC 890+ | N1 |
| 明治大学 | 国際日本学研究科 | ポップカルチャー研究領域 | TOEIC 750+ | N1 |

※ 英语和日语为合格数据中最低成绩$pm$, 0, true
where not exists (select 1 from public.promo_content where major = 'hyosho' and section = 'major_intro' and title = $pm$专业介绍$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-hyosho-course-01', 'hyosho', 'course', $pm$西方哲学史$pm$, $pm$## 课时摘要
10H · 5回 · 4月期 / 10月期

## 课程描述
从古希腊开始梳理到德国古典哲学，了解西方哲学史中理性与主体的问题，为之后的表象分析打好基础。

## 课程目标
- 知识：熟悉西方哲学的理论流变，对重要哲学家的主要概念有清晰的认识。
- 技能：掌握哲学思考的能力，并能把这种能力运用在各自的研究课题中。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 古希腊哲学 | 巴门尼德的存在论转向，苏格拉底—柏拉图—亚里士多德 | 2 |
| 2 | 基督教哲学到文艺复兴 | 主体思想的诞生 | 2 |
| 3 | 笛卡尔哲学 | 我思故我在，理性与主体 | 2 |
| 4 | 德国古典哲学 | 康德的形而上学 | 2 |
| 5 | 近代性与近代性问题 | 古典形而上学的辉煌与末路 | 2 |$pm$, 1, true
where not exists (select 1 from public.promo_content where major = 'hyosho' and section = 'course' and title = $pm$西方哲学史$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-hyosho-course-02', 'hyosho', 'course', $pm$现代思想论$pm$, $pm$## 课时摘要
10H · 5回 · 7月期 / 1月期

## 课程描述
针对有意报考表象文化论或现代思想、哲学的同学设计。课程分两部分：第一部分以现代思想中主要哲学家的思想为切入点，探寻现代思想的发生源流与主要问题；第二部分以符号论为内容，探讨符号在现代社会中的存在与意义，发现"隐藏在背后的另一个世界"。

## 课程目标
- 知识：学习报考表象文化论、文化研究、现代思想、媒体相关专业分野所需的哲学知识。
- 技能：补充表象文化相关哲学知识，掌握电影、文学、漫画、舞台剧等表象文化的分析手法。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 尼采哲学 | "上帝已死"，古典形而上学的衰落 | 2 |
| 2 | 精神分析 | 弗洛伊德的拓扑学模型，俄狄浦斯情结 | 2 |
| 3 | 现代语言学与符号论 | 索绪尔符号论，罗兰巴特神话分析，"作者已死" | 2 |
| 4 | 福柯 | "权力"概念 | 2 |
| 5 | 后现代消费论 | 居伊德波"景观社会"，鲍德里亚"消费社会" | 2 |$pm$, 2, true
where not exists (select 1 from public.promo_content where major = 'hyosho' and section = 'course' and title = $pm$现代思想论$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-hyosho-course-03', 'hyosho', 'course', $pm$身体与性别理论$pm$, $pm$## 课时摘要
6H · 3回 · 7月期 / 1月期

## 课程描述
20世纪后半期的性别理论流变，身体与性别相关理论基础。

## 课程目标
- 知识：熟悉女性主义运动的历史，掌握其中重要理论家的理论。
- 技能：掌握以性别视角分析事物的能力，并能运用在各自的研究课题中。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 第二波女性主义与女性书写 | 拉康派精神分析与伊丽嘉蕾 | 2 |
| 2 | 第三波女性主义与酷儿理论 | 朱迪斯巴特勒"操演论" | 2 |
| 3 | 酷儿阅读 | 塞吉威克与homosocial | 2 |$pm$, 3, true
where not exists (select 1 from public.promo_content where major = 'hyosho' and section = 'course' and title = $pm$身体与性别理论$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-hyosho-course-04', 'hyosho', 'course', $pm$电影分析$pm$, $pm$## 课时摘要
10H · 5回 · 7月期 / 1月期

## 课程描述
面向想做电影研究的同学，帮助入门电影研究领域。电影的历史是什么？拿到一个电影应该看哪些基础要素？分析电影有哪些基本手法？电影的视线权力和身体表象问题如何理解？

## 课程目标
- 知识：电影分析基本手法和理论。
- 技能：可以独立对电影进行表象分析。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 西方电影史 | 从电影的诞生到20世纪末 | 2 |
| 2 | 日本电影史 | 电影技术在日本的发展 | 2 |
| 3 | 电影分析手法 | 拆解电影的基础视点 | 2 |
| 4 | 电影分析理论 | 电影与视线，身体，性别 | 2 |
| 5 | 电影鉴赏 | 电影解析实操练习 | 2 |$pm$, 4, true
where not exists (select 1 from public.promo_content where major = 'hyosho' and section = 'course' and title = $pm$电影分析$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-hyosho-course-05', 'hyosho', 'course', $pm$亚文化表象论$pm$, $pm$## 课时摘要
10H · 5回 · 4月期 / 10月期

## 课程描述
面向想做亚文化研究的同学，帮助学习日本亚文化研究的相关基础。从日本战后的社会背景入手，梳理战后"御宅族"文化变化，拓展当下流行的亚文化论与角色论，并教授漫画和动画分析的基础手法。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 战后日本的"御宅族"文化 | 大冢英志与物语消费论 | 2 |
| 2 | 动漫角色论 | 伊藤刚，东浩纪 | 2 |
| 3 | 日本战后漫画史 | 手冢治虫之后的现代漫画 | 2 |
| 4 | 漫画动画分析入门 | "漫画表现论"，动画分析简论 | 2 |
| 5 | 女性向亚文化 | 少女漫画，BL文化 | 2 |$pm$, 5, true
where not exists (select 1 from public.promo_content where major = 'hyosho' and section = 'course' and title = $pm$亚文化表象论$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-hyosho-course-06', 'hyosho', 'course', $pm$现代文化论$pm$, $pm$## 课时摘要
10H · 5回 · 7月期 / 1月期 · 14:00–16:00

## 课程描述
对应文化人类学/文化研究/文化社会学方向。在全球化背景下，文化研究已呈现跨学科、多样性特征。涵盖艺术表象（电影、雕塑）、流行文化（偶像、时尚）、亚文化（二次元、女权主义、性少数群体文化）及文化人类学等全面内容。

## 课程目标
- 知识：掌握报考社会学、表象文化论、文化研究、观光地域振兴、文化人类学所需专业知识。
- 技能：灵活完成文化相关论述题，并将所学知识融入学生关心的研究课题中。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 文化的定义 | 文化是什么；社会学、文化研究、文化人类学的文化概念；课题与界限 | 2 |
| 2 | 表现文化的社会学 | 表现文化的社会学理论，音乐文化杂食论，传媒科技的文化 | 2 |
| 3 | 文化研究 | 文化研究与文化的动态性，亚文化论，文化研究的女权主义 | 2 |
| 4 | 全球化时代的文化越境 | 全球化论与跨国主义论，越境媒体与流行文化，文化与自我认同的政治 | 2 |
| 5 | 文化研究的课题 | 传媒研究，文化人类学研究，文化的社会学研究，观光研究，流行文化研究 | 2 |$pm$, 6, true
where not exists (select 1 from public.promo_content where major = 'hyosho' and section = 'course' and title = $pm$现代文化论$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-hyosho-course-07', 'hyosho', 'course', $pm$Gender 研究$pm$, $pm$## 课时摘要
10H · 5回 · 不定期 · 16:30–18:30

## 课程描述
对应家族社会学/性学视角等方向。系统掌握Gender领域核心主题、理论流派及研究方向。近年来Gender已进入社会科学各领域，无论是经济制度还是经营战略，Gender视角都不可或缺。

## 课程目标
- 知识：掌握Gender领域核心主题、相关理论流派及迄今为止的研究方向。
- 技能：运用所学知识应对过去问，并为研究计划书提供新视点。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | Gender & Sexuality | 性差异，性爱制度，女权主义的发展 | 2 |
| 2 | Gender 宏观视角 | 性差的制度变迁，家父长制，资本主义与性差，性别分工，无薪劳动，女性的双重劳动 | 2 |
| 3 | Gender 微观视角 | 性别赋予，性差的展演，广告中的Gender，性爱脚本，性差异实践与权力作用，身体的性化 | 2 |
| 4 | 近代 Sexuality 制度 | 性爱制度，性的研究史，性爱装置，同性爱的病理化，人口管理与性爱，浪漫爱情信仰变迁，性革命 | 2 |
| 5 | 过去问演练 | Gender & Sexuality相关过去问（一桥、御茶水女子、早稻田为主） | 2 |$pm$, 7, true
where not exists (select 1 from public.promo_content where major = 'hyosho' and section = 'course' and title = $pm$Gender 研究$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-hyosho-course-08', 'hyosho', 'course', $pm$言语文化共通课$pm$, $pm$## 课时摘要
40H · 10回 · 每期 · 10:30–12:30

## 课程描述
大学院言语文化系综合专业课程，涵盖语言学、文学、跨文化交流学、表现文化研究、历史学及哲学思想六大方向的基础知识。通过系统全面的基础学习帮助学生梳理各学科研究脉络，灵活选择适合自己的研究方向。

## 课程目标
- 知识：掌握语言学、文学、历史学、哲学思想及跨文化交流相关基础知识与概念。
- 技能：具备研究计划书撰写能力，掌握论述题写作技巧，提升跨学科思维能力。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 研究计划书 | 研究计划书逻辑，问题意识的提起 | 2 |
| 2 | 日本语学 | 语言学的基本概念，语言的结构与变化，语法与语用 | 2 |
| 3 | 日本文学 | 文学的定义，日本文学、比较文学的研究方向，文学与文化的关联 | 2 |
| 4 | 日本语教育 | 日本语教育的知识点，日本语基础与教育实践 | 2 |
| 5 | 表象文化论 | 戏剧、电影与艺术中的语言表现，语言在视觉文化中的表现力 | 2 |
| 6 | 哲学思想 | 哲学的基本概念，语言与思想的关系，重要哲学流派与学者 | 2 |
| 7 | 历史学 | 历史学的基本方法，语言与历史的互动，东洋史学入门 | 2 |
| 8 | 中国文学 | 中国文学的历史，研究视点，分析方法 | 2 |
| 9 | 表象与符号学研究 | 符号学的基本概念，语言与社会表象的关系，符号在文化中的意义 | 2 |
| 10 | 综合复习与课题讨论 | 将语言、文化、哲学思想与历史综合应用，模拟研究计划书展示与学术讨论 | 2 |$pm$, 8, true
where not exists (select 1 from public.promo_content where major = 'hyosho' and section = 'course' and title = $pm$言语文化共通课$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-hyosho-course-09', 'hyosho', 'course', $pm$言语文化研究方法$pm$, $pm$## 课时摘要
10H · 5回 · 4月期 / 10月期 · 14:00–16:00

## 课程描述
为言语文化系学生提供系统的研究方法训练，涵盖语言学、文学、历史学、哲学思想及日本语教育领域的研究方法与应用，包括研究计划书设计、文献分析、内容分析、量化研究及定性调查。

## 课程目标
- 知识：理解言语文化系的主要研究方法与理论背景，掌握文献分析、内容分析及定量与定性研究的核心技巧。
- 技能：学会设计研究计划、进行数据收集与分析，具备独立完成研究计划书与学术论文的能力。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 哲学逻辑基础 | 非形式論理学、誤謬論、弁証法 | 2 |
| 2 | 文献分析与历史学方法 | 历史学中的文献分析方法，如何理解历史文献与文化背景，历史研究的方法与理论 | 2 |
| 3 | 内容分析 | 文学的构造（表层的分析），文本分析（深层分析） | 2 |
| 4 | 定性调查方法 | 访谈与观察技巧，问卷设计 | 2 |
| 5 | 定量研究与数据分析 | 语言学中的定量研究方法，数据统计与分析工具，量化支持理论研究 | 2 |$pm$, 9, true
where not exists (select 1 from public.promo_content where major = 'hyosho' and section = 'course' and title = $pm$言语文化研究方法$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-hyosho-course-10', 'hyosho', 'course', $pm$言语文化过去问演习$pm$, $pm$## 课时摘要
10H · 5回 · 7月期 / 1月期 · 14:00–16:00

## 课程描述
专为备考言语文化系的学生设计，涵盖语言学、文学、跨文化交流、历史学、哲学思想等相关专业的过去问题目。系统解析大学院常见题型，包括名词解释、论述与综合分析题。

## 课程目标
- 知识：系统掌握言语文化系必考的基础概念与理论知识，达到日本本科学生的专业知识水平。
- 技能：提升日语阅读能力和写作能力，掌握高分答案的构建方法。

## 课程大纲
| 回 | 主题 | 重点内容 | 课时 |
|---|---|---|---|
| 1 | 文献阅读理解题攻略 | 学术文献和文学作品的阅读策略，如何提取文献关键内容并回答相关问题 | 2 |
| 2 | 文学理论关联问题解析 | 文学研究部分的过去问为基础，梳理语言与文学研究的基础理论及解题技巧 | 2 |
| 3 | 历史学关联问题解析 | 历史学结合的过去问，解析历史与文化现象的深层逻辑，指导如何使用理论与历史举例 | 2 |
| 4 | 日本语教育学问题解析 | 日本语教育学过去问综述，名词解释和日本语学解题技巧 | 2 |
| 5 | 哲学思想关联问题解析 | 哲学与语言、文化现象的关联问题解析，实际过去问解答技巧 | 2 |$pm$, 10, true
where not exists (select 1 from public.promo_content where major = 'hyosho' and section = 'course' and title = $pm$言语文化过去问演习$pm$)
on conflict (id) do nothing;

insert into public.promo_content (id, major, section, title, body, sort_order, published)
select 'pm-seed-hyosho-course-11', 'hyosho', 'course', $pm$表象文化 Zemi$pm$, $pm$## 课时摘要
20H · 10回 · 7月期 / 1月期

## 课程描述
前半期以研究计划书发表与讨论、文献阅读为主；后半期侧重目标学校过去问答疑与备考确认。全程随堂评估与反馈，根据学生进度灵活调整。

## 每周流程
- 课前：发表同学提前两天分享研究计划书＋发表要约
- 课中：担当发表 → 全员讨论 → 过去问讲解讨论
- 反馈：老师随堂修改进度与内容，提供即时评估$pm$, 11, true
where not exists (select 1 from public.promo_content where major = 'hyosho' and section = 'course' and title = $pm$表象文化 Zemi$pm$)
on conflict (id) do nothing;
