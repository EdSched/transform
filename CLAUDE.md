# CLAUDE.md — 唯新教育 Transform 平台

给 Claude Code 看的项目说明。每次开始工作前先读完这个文件。

## 0. 基本约定

- **始终用中文回复。** Sensis（负责人/管理员）不是程序员，但业务判断和产品逻辑很准：相信他对问题根因的判断，解释时少用术语。
- **只改被要求的东西。** 不顺手改样式、不加没要求的功能、不重构无关代码。
- **一次改完。** 已经说清楚的需求不要反复确认；自己检查代码，不要让 Sensis 去跑诊断。
- **改完必须自检：** 每个改过的 `.js` 都跑 `node --check <file>`；HTML 里的内联脚本也要确认没有语法错误。
- **所有 SQL 由 Sensis 在 Supabase SQL Editor 手动执行。** Claude 只给出 SQL 文本（附回滚语句），不要尝试直连数据库。
- **上线方式：** GitHub Pages 从 `main` 部署（edsched.github.io/transform/），CDN 约 10 分钟延迟，测试要用无痕窗口 + 强制刷新。

## 1. 最重要的一条：改之前先同步

Sensis 经常在多个窗口/对话里同时改同一批文件，**已经多次出现"做好的功能被旧版本覆盖、消失"**（合格实绩分数/照片字段、课程归档过滤、管理端邮箱登录块等）。

- 开始改任何文件前：`git pull`，以远端 `main` 最新版为准。
- 改完推送前再 `git pull --rebase` 一次，有冲突要逐处合并，**绝不能用旧版本覆盖别人的改动**。
- 高风险（经常被多处修改）的文件：`admin/courses.js`、`admin/students.js`、`admin/admin.js`、`admin/index.html`、`teacher/teacher.js`、`teacher/teacher-students.js`、`shared/constants.js`、`shared/supabase.js`。
- 如果 Sensis 直接贴了整份文件，以他贴的为准。

## 2. 技术栈与结构

- 前端：纯 HTML/CSS/JS（无框架、无构建），GitHub Pages。
- 后端：Supabase PostgreSQL（`vwntezfvqbrkeovnseku.supabase.co`），publishable key 在 `shared/supabase.js`。
- 两套系统共用一个数据库：
  - **管理系统**：`admin/`（管理端）、`teacher/`（老师端）、`student/`（学生端：`index.html` 面谈预约，`study.html` 学习页）、`vip/`（VIP 学生页）、`results/`（合格实绩）、`promo/`
  - **排课系统**：`sched/`（排教室、预约批准、冲突检查、会议链接等）
  - 独立小工具：`salary/`（领现金工资预约，表 `salary_bookings`）
- `admin/modules/*.js` 是 1 行的空壳，**真正的代码在 `admin/*.js`**。
- `vip/index.html` 先加载 `vip.js`，再加载 `../student/study.js`——VIP 页面主体由 `study.js` 驱动（用 `window.__VIP_PAGE__` 区分）。
- 老师端脚本按顺序加载：`teacher.js` → `teacher-students.js` → `teacher-plan.js` → `teacher-promo.js` → `teacher-sales.js` → `teacher-homework.js` → `teacher-vip.js` → `teacher-pack.js`。
- `shared/constants.js` 在所有页面脚本之前加载，是公共常量/工具函数的唯一来源（如 `isGakubuMajor`、`RIYU_SECTIONS`、`majorKeyFromText`、`teacherInView`）。**不要在别的文件里重复声明同名 `const`，会直接报错。**

## 3. 数据访问规则

- 管理系统用 `shared/supabase.js`：`sb(path, method, body)`、`sbAll(path)`（自动分页）、`sbUpload`。
- 排课系统用 `sched/common.js`：`sbGet`（自动分页）/`sbInsert`/`sbUpdate`/`sbDelete`。
- Supabase 每次最多返回 1000 行。**全表读取一律用 `sbAll`（管理端）或 `sbGet`（sched）**，不要裸写 `sb('xxx?select=*')`。
- 写入后马上读取的地方要 `cache:'no-store'`。
- `sb()` 会自动带上已登录用户的 Auth token（没有就用匿名 key）。**登录前的 RPC（如 `rpc/resolve_student_login`）必须用匿名 key**，已在 `sb()` 里特殊处理，别改坏。
- 任何创建 Auth 客户端的地方都要把客户端交给 `__setSbToken(token, client)`，这样 token 自动续期后 `sb()` 也能拿到新的。
- 各端 Auth 的 storageKey 必须分开：管理端 `sb-admin`、老师端 `sb-teacher`、学生/VIP `sb-student`。
- Storage 文件名只能是 ASCII：`Date.now()+'_'+Math.random().toString(36).slice(2,7)+'.'+ext`，上传带 `x-upsert: true`。

## 4. 登录与权限（RLS）——改动前务必理解

- 身份一律以 **id** 为准，不以真名为准（会有重名）。
- 管理员：Supabase 魔法链接登录，两个邮箱在 `is_admin()` 里。
- 老师：链接 `teacher/?tid=<teacher.id>`，前端静默用 `<id>@teacher.local` / 密码=id 登录 Auth。
- 学生：姓名 + 查询码 → `rpc/resolve_student_login` 取得 student_id → 用 `<id>@student.local` / 密码=查询码 登录 → 读自己的行。
  - 学生能登录需要三样都在：`students` 行、`student_login` 行、`auth.users` 账号。
  - **任何写入/修改学生查询码的代码，都必须同时 upsert `student_login`**（见 `admin/students.js` 的 `syncStudentLogin`）。
- 领域访问链接 `admin/?k=<key>`：链接即登录，无密码，走 `<k>@access.local`。
- 所有做 Auth 登录的页面都必须加载 supabase-js：先 jsdelivr，再本仓库副本 `shared/vendor/supabase.min.js` 兜底（国内/微信里 jsdelivr 时通时不通，加载失败会表现为"页面空白/没数据"）。
- 已开启 RLS：`students`、`student_login`、`teachers`、`teacher_profiles`、`periods`、`monthly_reviews`、`bookings`（学生只能读/新增自己 `student_id` 的预约，新同学匿名只能新增 `student_id` 为空的；学生改自己预约走 `rpc/student_patch_booking`，匿名统计名额走 `rpc/slot_booking_counts`）等。
  - 给新表开 RLS 前：先 `select * from pg_policies where tablename='xxx'` 查有没有遗留的 `public all` 宽松策略；先确认前端/登录流程依赖哪条读取路径；每一步都附回滚语句 `alter table ... disable row level security;`。
  - sched 系统的表原则上不锁。
- 老师能看到哪些学生：以 `teacher/teacher-students.js` 的 `tsaAllowedSet()` 为准（按 `students.major` 单值过滤，集合为空=看全部）。不要凭记忆重写这套逻辑。
- 老师的 `managed_by`（归谁管）和 `majors`（教什么）是两回事。

## 5. 业务上容易踩的坑

- **合格实绩**：任何录入入口都必须写 `jlpt`/`jlpt_score`/`eng_type`/`eng_score`/`photo_url` 这些独立字段，不能塞进 `note`，否则 `results/grad.html` 显示为空。三处入口都有去重确认（学生名+大学+日语分+英语分完全相同）。老师端没有录入入口，不要加回去。
- **专业代码**：学部专业加 `gakubu_` 前缀（如 `gakubu_fashion` vs 大学院 `fashion`），只能用字母/数字/下划线。`students` 表没有 `campus` 字段，插入时不要带。
- **VIP 时间槽可见性**：`teacher_name` 必须与学生的 `vip_teachers` 完全一致；`vip_exclusive=true` 只给纯 VIP 学生，`false` 只给"大课+VIP"学生。这是有意设计，不是 bug。
- **课时/缴费**应当是只追加的流水账，不应该是可随手修改的数字（现有 `vip_hours_total/used` 是待改造的反例）。
- **删除课程**被排班外键拦住是保护机制：只给友好提示，不要自动删 `schedule_slots`。
- **排课冲突**：`sched_bookings` 上有数据库触发器拦截同教室重叠、同老师重叠（`allow_multi=true` 可放行后者）；`pending` 也算占用。
- `sched/common.js` 里必须保留 `parseWeekdaysSched()`（`'0'` 视为周日 7），否则冲突检查页整页空白。
- 社会人文专业组筛选不能级联（选"社会学"不应带出"社会人文大課"）。

## 6. UI 规则（Sensis 的硬性偏好）

- **不用单选按钮（radio），不用复选框式多选。** 用下拉框 `select` 或可点击高亮的行/卡片/标签（chip）。
- 新组件里不用 emoji 图标（原有的中枢导航卡片 emoji 保留）；用纯文字+颜色区分，不用彩色圆点 emoji。
- 界面默认不要展开长表格，优先折叠/可展开。
- 信息密度优先，少留白、少装饰。
- 打印/PDF 类输出：照抄 `results/grad.html` 的字体和排版方案（务必真正加载 Noto Serif SC / Noto Sans SC 网络字体，不能只写字体名）。配色参考 `style.css`：底色 `#f7f5f0`、文字 `#1a1814`、边框 `#e2ded6`、强调金棕 `#b8953a`。

## 7. 提交

- 提交信息用中文，简要说明改了什么、为什么。
- 默认推到新分支并开 PR，由 Sensis 确认后合并上线；Sensis 明确说"直接上线"时再推 `main`。
- 涉及数据库的改动，在 PR 描述里单独列出需要 Sensis 执行的 SQL（以及执行顺序和回滚语句）。
- 最后给出一份简短的测试清单：哪个端、点哪里、应该看到什么。
