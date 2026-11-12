-- 课程表「单回调整说明」跟着模板保存（sched_timetable_templates 加一列）
-- 执行：在 Supabase SQL Editor 里整段运行一次（不执行的话：课程表页面能用，但「保存为模板」时如果填了单回调整说明会提示先执行此 SQL）
alter table public.sched_timetable_templates add column if not exists adjust_text text;

-- 回滚：
-- alter table public.sched_timetable_templates drop column if exists adjust_text;
