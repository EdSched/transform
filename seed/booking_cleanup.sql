-- ══════════════════════════════════════════════════════════════
-- 旧预约清理：补 student_id、合并重复预约
-- 在 Supabase SQL Editor 执行。先只跑「A. 列出」，确认无误后再跑 B、C、D。
-- 顺序：A（只读）→ B 备份 → C 补 student_id → D 清重复。
-- 执行完再执行 seed/booking_guard.sql 里的唯一索引（如果还没建）。
-- ══════════════════════════════════════════════════════════════

-- ── A. 只读：先看影响范围 ──────────────────────────────────

-- A1. 能唯一对上在籍学生的「未关联账号」预约（姓名完全一致，且全库只有一个同名学生）→ 将被补上 student_id
select b.id, b.name, b.slot_date, b.slot_time_range, b.status, s.id as student_id, s.major
from public.bookings b
join (
  select btrim(name) as name, min(id) as id, min(coalesce(status,'active')) as status
  from public.students
  group by btrim(name)
  having count(*) = 1
) s on s.name = btrim(b.name)
where b.student_id is null and s.status = 'active'
order by b.name, b.slot_date;

-- A2. 对不上或同名多人的「未关联账号」预约（不会被改动，需要 Sensis 手动处理）
select b.id, b.name, b.slot_date, b.slot_time_range, b.status,
       (select count(*) from public.students s where btrim(s.name) = btrim(b.name)) as 同名学生数
from public.bookings b
where b.student_id is null
  and not exists (
    select 1 from (
      select btrim(name) as name from public.students
      group by btrim(name) having count(*) = 1 and min(coalesce(status,'active')) = 'active'
    ) s where s.name = btrim(b.name))
order by b.name, b.slot_date;

-- A3. 同一姓名 + 同一时间槽的重复预约（待确认/已确认）→ 保留最早一条，其余将被取消
select slot_id, name, count(*) as n, array_agg(id order by length(id), id) as booking_ids
from public.bookings
where status in ('pending','confirmed') and slot_id is not null
group by slot_id, name
having count(*) > 1;

-- ── B. 备份（受影响的行先存一份）──────────────────────────
alter table public.bookings add column if not exists cancel_reason text;   -- 先建列，备份表才带得上

create table if not exists public.bookings_cleanup_backup as
select * from public.bookings where false;

insert into public.bookings_cleanup_backup
select b.* from public.bookings b
where ((
    b.student_id is null
    and btrim(b.name) in (
      select btrim(name) from public.students
      group by btrim(name) having count(*) = 1 and min(coalesce(status,'active')) = 'active')
  )
  or b.id in (
    select id from (
      select id, row_number() over (partition by slot_id, name order by length(id), id) as rn
      from public.bookings
      where status in ('pending','confirmed') and slot_id is not null
    ) t where rn > 1
  ))
  and b.id not in (select id from public.bookings_cleanup_backup);

-- ── C. 补 student_id（只处理能唯一对上的）────────────────
update public.bookings b
set student_id = s.id
from (
  select btrim(name) as name, min(id) as id
  from public.students
  group by btrim(name)
  having count(*) = 1 and min(coalesce(status,'active')) = 'active'
) s
where b.student_id is null and s.name = btrim(b.name);

-- ── D. 重复预约：保留最早一条，其余取消 ───────────────────
update public.bookings b
set status = 'cancelled', cancel_reason = '重复预约（系统清理）'
where b.id in (
  select id from (
    select id, row_number() over (partition by slot_id, name order by length(id), id) as rn
    from public.bookings
    where status in ('pending','confirmed') and slot_id is not null
  ) t where rn > 1
);

-- ══════════════════════════════════════════════════════════════
-- 回滚：用备份表还原 student_id / status / cancel_reason
-- ══════════════════════════════════════════════════════════════
-- update public.bookings b
-- set student_id = k.student_id, status = k.status, cancel_reason = k.cancel_reason
-- from public.bookings_cleanup_backup k
-- where k.id = b.id;
-- drop table public.bookings_cleanup_backup;   -- 确认不再需要后再删
