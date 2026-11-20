-- 面试题库「多版本」：同一专业下可以有多套题库（例：経営学研究科 / MBA）
-- 前提：已执行过 seed/interview_bank.sql、seed/interview_resources.sql。
-- 执行：Supabase SQL Editor，按 ①→②→③→④ 顺序分段执行。必须「先执行本 SQL，再合并 PR」，否则新代码读 variant 列会失败。
-- 现有的所有题库行自动成为默认版本（variant = ''），线上数据零迁移风险；学生已写的答案、模拟面试记录都不用改。

-- ① 先看现状（只读，结果贴给我核对）
--    a) interview_banks 主键约束的真实名字（下面第 ② 步按 interview_banks_pkey 写；名字不同就替换）
select conname from pg_constraint where conrelid = 'public.interview_banks'::regclass and contype = 'p';
--    b) 志望校表的实际列（看有没有现成的「课程类型 / 项目类型」字段；没有就用下面新增的 interview_variant）
select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'student_school_plans' order by ordinal_position;

-- ② 题库：加版本维度（可重复执行）
alter table public.interview_banks add column if not exists variant       text  not null default '';
alter table public.interview_banks add column if not exists variant_label text  default '';
alter table public.interview_banks add column if not exists match_words   jsonb default '[]';   -- 自动判断用的关键词，如 ["MBA","ビジネススクール","専門職"]
alter table public.interview_banks drop constraint if exists interview_banks_pkey;
alter table public.interview_banks add primary key (major_key, variant);

-- ③ 资料：可选限定到某个版本（null = 该专业所有版本都显示；'@default' = 只给默认版本；其余 = 版本短码）
alter table public.interview_resources add column if not exists variant text;

-- ④ 志望校：记住这所学校用哪个版本（null = 还没选过，按关键词自动判断；'' = 明确选了默认版本）
alter table public.student_school_plans add column if not exists interview_variant text;

-- RLS：不用改。interview_banks 现有策略（ivb_read：published = true 或 is_admin()；ivb_admin_all：is_admin()）只看 published / 管理员，与主键无关。
-- 检查
select major_key, variant, variant_label, published, jsonb_array_length(chapters) as chapters from public.interview_banks order by major_key, variant;
select policyname, cmd, qual from pg_policies where tablename = 'interview_banks';

-- ───────── 回滚 ─────────
-- 注意：回滚主键前必须先删掉所有 variant <> '' 的行，否则会因重复失败（这些版本里的内容会丢，先在管理端导出 / 记下来）
-- delete from public.interview_banks where variant <> '';
-- alter table public.interview_banks drop constraint interview_banks_pkey;
-- alter table public.interview_banks add primary key (major_key);
-- alter table public.interview_banks drop column variant, drop column variant_label, drop column match_words;
-- alter table public.interview_resources drop column variant;
-- alter table public.student_school_plans drop column interview_variant;
