-- 合格案例：加「合格经验总结」「指导老师点评」「点评老师」三列（都可为空）
-- 在 Supabase SQL Editor 执行；不影响已有数据
alter table public.success_cases add column if not exists experience text;
alter table public.success_cases add column if not exists teacher_comment text;
alter table public.success_cases add column if not exists teacher_comment_by text;   -- 点评老师真名（对外显示时按 对外名称 → 真名）

-- 回滚（会丢掉这三列已填的内容）：
-- alter table public.success_cases drop column if exists experience;
-- alter table public.success_cases drop column if exists teacher_comment;
-- alter table public.success_cases drop column if exists teacher_comment_by;
