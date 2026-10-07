-- 作业发布日：整门课「上课前 N 天发布」，单回可单独指定发布日（合并前执行）
alter table public.courses add column if not exists hw_release_days int;           -- null 或 0 = 上课当天（和以前一样）
alter table public.course_sessions add column if not exists hw_release_date date;  -- 单回单独指定的发布日，填了就以它为准

-- 回滚：
-- alter table public.courses drop column if exists hw_release_days;
-- alter table public.course_sessions drop column if exists hw_release_date;
