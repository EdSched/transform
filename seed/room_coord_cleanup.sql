-- 总务「需要协调教室」改造配套 SQL（由 Sensis 在 Supabase SQL Editor 手动执行，按 A → B → C 顺序）
-- 前端代码不依赖这些 SQL 才能运行；A 只是检查，B 只有「查到有约束」才需要，C 是清理旧数据（可选，建议先看 C.1 的结果）。

-- ============================================================
-- A. 只读检查（先跑，把结果发给 Claude）
-- ============================================================
-- A.1 sched_change_log 的 action 列有没有 check 约束（新增了 action='room_unavailable'）
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.sched_change_log'::regclass and contype = 'c';

-- A.2 现在用过哪些 action、各多少条
select action, count(*) from public.sched_change_log group by 1 order by 2 desc;

-- A.3 没处理的 room_coord 里，「同一门课 + 同一回」重复了的（旧代码按「一回 + 一天」判重，同一回改两次日期就会留两条）
select course_name,
       c->>'session_id' as session_id, c->>'num' as num,
       count(*) as n, array_agg(c->>'date' order by l.created_at) as dates, array_agg(l.id order by l.created_at) as log_ids
from public.sched_change_log l, jsonb_array_elements(l.changes) c
where l.action = 'room_coord' and coalesce(l.acked_by, '') = '' and c->>'field' = 'room_coord'
group by 1, 2, 3 having count(*) > 1;

-- ============================================================
-- B. 只有 A.1 查到 action 有 check 约束、而且不含 'room_unavailable' 时才执行
--    （把 sched_change_log_action_check 换成 A.1 查到的约束名；in (...) 里要保留 A.2 查到的全部旧值）
-- ============================================================
-- begin;
-- alter table public.sched_change_log drop constraint sched_change_log_action_check;
-- alter table public.sched_change_log add constraint sched_change_log_action_check
--   check (action in ('edit', 'session_room', 'room_coord', 'room_unavailable'));   -- 再补上 A.2 里查到的其他值
-- commit;
-- 回滚：按 A.1 记下的原定义重建
--   alter table public.sched_change_log drop constraint sched_change_log_action_check;
--   alter table public.sched_change_log add constraint sched_change_log_action_check check (<A.1 查到的原 def>);

-- ============================================================
-- C. 遗留占用：课程的临时占用（once），那一天这门课已经没有（没休讲的）单回
--    产生原因：管理端「课程安排」里换教室会建临时占用；之后把那一回改期 / 休讲 / 撤回，临时占用没人删。
--    （代码已补防：以后改期 / 休讲 / 撤回会自动清；这里只处理历史数据）
-- ============================================================
-- C.1 只读：列出全库遗留占用（只看今天以后的；只看这门课在 course_sessions 里有单回数据的）
select b.id, c.name as course, b.booking_date, r.campus, r.name as room, b.start_time, b.end_time, b.created_at, b.entry_name
from public.sched_bookings b
left join public.sched_course_v c on c.id::text = b.course_id::text
left join public.sched_rooms r on r.id = b.room_id
where b.kind = 'course' and b.recurrence = 'once' and b.status <> 'rejected'
  and b.booking_date >= current_date
  and exists (select 1 from public.course_sessions cs where cs.course_id::text = b.course_id::text)
  and not exists (select 1 from public.course_sessions cs
                  where cs.course_id::text = b.course_id::text and cs.session_date::date = b.booking_date
                    and coalesce(cs.is_cancelled, false) = false)
order by c.name, b.booking_date;

-- C.2 清理前先备份（备份表和原表同结构），再删除
-- begin;
-- create table public._orphan_once_backup_20261120 as
--   select b.* from public.sched_bookings b
--   where b.kind = 'course' and b.recurrence = 'once' and b.status <> 'rejected'
--     and b.booking_date >= current_date
--     and exists (select 1 from public.course_sessions cs where cs.course_id::text = b.course_id::text)
--     and not exists (select 1 from public.course_sessions cs
--                     where cs.course_id::text = b.course_id::text and cs.session_date::date = b.booking_date
--                       and coalesce(cs.is_cancelled, false) = false);
-- delete from public.sched_bookings where id in (select id from public._orphan_once_backup_20261120);
-- commit;
--
-- 回滚（把备份的行放回去；放回去的行会再次被触发器检查，教室已经被别人占了的会失败，那是正常的）：
--   insert into public.sched_bookings select * from public._orphan_once_backup_20261120;
-- 确认没问题后再删备份表：
--   drop table public._orphan_once_backup_20261120;

-- 说明：排课首页新增的「查看并清理」按钮做的是同一件事（只删判定为遗留的，不碰有课的占用），
--       量不大的话直接用按钮即可，不必跑 C.2。
