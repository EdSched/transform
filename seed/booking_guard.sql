-- ══════════════════════════════════════════════════════════════
-- 面谈预约防护：有档案的新同学必须登录；防止同一时间重复预约
-- 在 Supabase SQL Editor 执行。合并前执行；按步骤 0 → 1 → 2 → 3 顺序。
-- ══════════════════════════════════════════════════════════════

-- 0. 先检查现有数据里有没有违反唯一索引的重复（同一时间槽 + 同一姓名 + 待确认/已确认）。
--    有结果的话，先执行 seed/booking_cleanup.sql 把重复的清掉，再做第 2 步。
select slot_id, name, count(*) as n, array_agg(id order by length(id), id) as booking_ids
from public.bookings
where status in ('pending','confirmed') and slot_id is not null
group by slot_id, name
having count(*) > 1;

-- 1. 新字段：新同学选了「我不是这位同学」（同名但不是在籍学生）时标记
alter table public.bookings add column if not exists name_conflict boolean not null default false;

-- 2. 数据库层保险：同一时间槽、同一姓名，待确认/已确认的预约只能有一条
create unique index if not exists bookings_slot_name_active_uq
  on public.bookings (slot_id, name)
  where status in ('pending','confirmed');

-- 3. 姓名检查函数（匿名也能调用；只返回是否有档案 / 是否有未完成预约，不返回学生 id、查询码）
create or replace function public.booking_name_check(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_has_profile boolean := false;
  v_active record;
begin
  if v_name = '' then
    return jsonb_build_object('has_profile', false, 'has_active', false, 'active_date', null, 'active_time', null);
  end if;

  -- 在籍且已有查询码（能登录）的同名学生
  select exists (
    select 1 from public.students s
    where btrim(s.name) = v_name
      and coalesce(s.status, 'active') = 'active'
      and coalesce(btrim(s.student_code), '') <> ''
  ) into v_has_profile;

  -- 该姓名（或同名学生 id）下待确认/已确认的预约
  select b.slot_date, b.slot_time_range into v_active
  from public.bookings b
  where b.status in ('pending','confirmed')
    and (btrim(b.name) = v_name
         or b.student_id in (select s.id from public.students s where btrim(s.name) = v_name))
  order by b.slot_date asc
  limit 1;

  return jsonb_build_object(
    'has_profile', v_has_profile,
    'has_active',  found,
    'active_date', case when found then v_active.slot_date end,
    'active_time', case when found then v_active.slot_time_range end
  );
end;
$$;

revoke all on function public.booking_name_check(text) from public;
grant execute on function public.booking_name_check(text) to anon, authenticated;

-- ══════════════════════════════════════════════════════════════
-- 回滚
-- ══════════════════════════════════════════════════════════════
-- drop function if exists public.booking_name_check(text);
-- drop index if exists public.bookings_slot_name_active_uq;
-- alter table public.bookings drop column if exists name_conflict;
