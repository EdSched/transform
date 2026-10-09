-- ============================================================
-- 预约取消时，自动释放它占用的排课教室（数据库兜底）
-- 在 Supabase SQL Editor 手动执行；合并上线前先执行。回滚见文件末尾。
--
-- 做了什么：
--   bookings.status 变成 'cancelled' 时，如果有 sched_booking_id，
--   删除对应的 sched_bookings 记录并把 sched_booking_id 置空。
--   不管从哪里取消（老师端、管理端、以后新加的地方）教室都一定释放。
--   security definer：不受调用者对 sched_bookings 的权限限制。
-- 前端现有的释放代码保留（重复删除无害）。
-- ============================================================

create or replace function public.bookings_release_sched_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled'
     and old.status is distinct from 'cancelled'
     and new.sched_booking_id is not null then
    -- 用 text 比较，避免两边 id 类型不一致时报错
    delete from public.sched_bookings where id::text = new.sched_booking_id::text;
    new.sched_booking_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bookings_release_sched_room on public.bookings;
create trigger trg_bookings_release_sched_room
  before update of status on public.bookings
  for each row
  execute function public.bookings_release_sched_room();

-- ── 验证（可选）：取消一条有 sched_booking_id 的测试预约后，sched_bookings 里那条应消失 ──

-- ============================================================
-- 回滚：
--   drop trigger if exists trg_bookings_release_sched_room on public.bookings;
--   drop function if exists public.bookings_release_sched_room();
-- ============================================================
