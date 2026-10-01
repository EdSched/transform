-- 课程方案去掉学生：方案不再绑定学生，改用「方案名称」（title）区分
alter table public.sales_plans alter column student_name drop not null;
alter table public.sales_plans add column if not exists title text;

-- 回滚：
-- 先把空值补上，才能改回 not null（旧方案不动；新方案 student_name 是空的）：
-- update public.sales_plans set student_name = coalesce(nullif(title, ''), '（未命名）') where student_name is null;
-- alter table public.sales_plans alter column student_name set not null;
-- alter table public.sales_plans drop column if exists title;
