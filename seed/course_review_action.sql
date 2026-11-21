-- 排课「回数审查 → 通知管理端调整」会往 sched_change_log 写 action='course_review'。
-- 前端不依赖这些 SQL 才能运行；只有当 A.1 查到 action 有 check 约束、且不含 'course_review' 时才需要执行 B。
-- 由 Sensis 在 Supabase SQL Editor 手动执行。

-- A.1 只读检查：action 列有没有 check 约束
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.sched_change_log'::regclass and contype = 'c';

-- A.2 现在用过哪些 action
select action, count(*) from public.sched_change_log group by 1 order by 2 desc;

-- B. 仅当 A.1 查到约束时执行（把约束名换成 A.1 的；in (...) 保留 A.2 查到的全部旧值）
-- begin;
-- alter table public.sched_change_log drop constraint sched_change_log_action_check;
-- alter table public.sched_change_log add constraint sched_change_log_action_check
--   check (action in ('edit', 'session_room', 'room_coord', 'room_unavailable', 'course_review'));   -- 再补上 A.2 里的其他值
-- commit;
-- 回滚：按 A.1 记下的原定义重建
--   alter table public.sched_change_log drop constraint sched_change_log_action_check;
--   alter table public.sched_change_log add constraint sched_change_log_action_check check (<A.1 查到的原 def>);
