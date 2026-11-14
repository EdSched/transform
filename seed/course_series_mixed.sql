-- 系列课：新增排法「接续＋同日分段」(mixed)。必须在这次 PR 合并之前执行。
-- 做什么：放开 course_series.mode 的检查，允许 'mixed'（原来只允许 chain / split）。
begin;
alter table public.course_series drop constraint if exists course_series_mode_check;
alter table public.course_series add constraint course_series_mode_check check (mode in ('chain','split','mixed'));
commit;

-- 验证（只读）
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.course_series'::regclass and contype = 'c';

-- 回滚（先确认没有 mixed 的系列：select count(*) from public.course_series where mode='mixed';）
-- begin;
-- alter table public.course_series drop constraint if exists course_series_mode_check;
-- alter table public.course_series add constraint course_series_mode_check check (mode in ('chain','split'));
-- commit;
