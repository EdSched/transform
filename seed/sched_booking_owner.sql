-- ============================================================
-- 排课系统教室占用 · 按登录账号记录归属（「我的教室占用」换设备也在；免填录入人）
-- 在 Supabase SQL Editor 手动执行；合并上线前先执行。整个文件一次性执行，可重复执行。
-- 前提：已执行 sched_booking_log.sql（sched_booking_log / sched_actor）；is_admin() / current_teacher_id() / current_sched_code() 已存在。
--
-- 做了什么：
--   1. sched_bookings 加 3 列：owner_kind（teacher/admin/code/anon）、owner_id、owner_name
--   2. 触发器 sched_bookings_set_owner：insert 时由数据库按登录身份填这三列（不信前端传来的值）；
--      老师/管理员录入且 entry_name 为空时自动填 owner_name；update 时三列改不动
--   3. RLS：已登录的老师/管理员可删除 owner_id 等于自己的占用（只加一条，其他规则不动）
--   4. RPC sched_my_identity()：前端问「我是谁」（kind / id / name），不返回别的
--   5. RPC sched_my_bookings_history()：自己的占用操作记录（含已删除），最近 200 条
-- 旧数据不补：以前的记录这三列为空，照旧按设备和姓名找。
-- ============================================================

-- ── 1. 新增列 ────────────────────────────────────────────────
alter table public.sched_bookings add column if not exists owner_kind text;
alter table public.sched_bookings add column if not exists owner_id   text;
alter table public.sched_bookings add column if not exists owner_name text;
create index if not exists sched_bookings_owner_idx on public.sched_bookings (owner_id);

-- ── 2. 当前登录身份（owner_kind / owner_id / owner_name）──────
create or replace function public.sched_owner_now(out o_kind text, out o_id text, out o_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_tid text; v_label text;
begin
  v_tid := public.current_teacher_id()::text;
  if v_tid is not null and v_tid <> '' then
    o_kind := 'teacher'; o_id := v_tid;
    select t.name into o_name from public.teachers t where t.id::text = v_tid;
    o_name := coalesce(o_name, '老师');
  elsif public.is_admin() then
    o_kind := 'admin'; o_id := auth.uid()::text;
    o_name := '管理员 · ' || coalesce(auth.jwt() ->> 'email', '');
  elsif public.current_sched_code() is not null then
    o_kind := 'code'; o_id := null;
    select c.label into v_label from public.sched_access_codes c where c.code = public.current_sched_code() limit 1;
    o_name := coalesce(nullif(v_label, ''), '排课口令');
  else
    o_kind := 'anon'; o_id := null; o_name := null;
  end if;
end $$;
grant execute on function public.sched_owner_now() to anon, authenticated;

create or replace function public.sched_bookings_set_owner_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare o record;
begin
  if tg_op = 'INSERT' then
    select * into o from public.sched_owner_now();
    new.owner_kind := o.o_kind; new.owner_id := o.o_id; new.owner_name := o.o_name;
    if o.o_kind in ('teacher', 'admin') and coalesce(btrim(new.entry_name), '') = '' then
      new.entry_name := o.o_name;
    end if;
  else
    new.owner_kind := old.owner_kind; new.owner_id := old.owner_id; new.owner_name := old.owner_name;
  end if;
  return new;
end $$;

drop trigger if exists sched_bookings_set_owner on public.sched_bookings;
create trigger sched_bookings_set_owner
  before insert or update on public.sched_bookings
  for each row execute function public.sched_bookings_set_owner_fn();

-- ── 3. RLS：登录的老师/管理员可删自己的占用 ──────────────────
-- 策略是「或」的关系，这一条只放宽、不收紧；原有 "sched_bookings delete" 不动
drop policy if exists "sched_bookings delete own" on public.sched_bookings;
create policy "sched_bookings delete own" on public.sched_bookings for delete
  using (owner_id is not null and owner_id = (select o.o_id from public.sched_owner_now() o) );

-- ── 4. 问「我是谁」──────────────────────────────────────────
create or replace function public.sched_my_identity()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when o.o_kind in ('teacher', 'admin')
              then jsonb_build_object('kind', o.o_kind, 'id', o.o_id, 'name', o.o_name)
              else null end
  from public.sched_owner_now() o;
$$;
grant execute on function public.sched_my_identity() to anon, authenticated;

-- ── 5. 我的占用操作记录 ──────────────────────────────────────
create or replace function public.sched_my_bookings_history()
returns table (
  at timestamptz, action text, booking_id bigint, kind text, booking_date date, start_time text, end_time text,
  room_campus text, room_name text, user_name text, student_name text, title text, actor text, actor_kind text,
  reject_reason text, changes jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select l.at, l.action, l.booking_id, l.kind, l.booking_date,
         l.snapshot ->> 'start_time', l.snapshot ->> 'end_time',
         r.campus, r.name, l.user_name, l.student_name, l.snapshot ->> 'title',
         l.actor, l.actor_kind,
         l.changes -> 'reject_reason' ->> 'to',
         l.changes
  from public.sched_booking_log l
  left join public.sched_rooms r on r.id = l.room_id
  where (select o.o_id from public.sched_owner_now() o) is not null
    and l.snapshot ->> 'owner_id' = (select o.o_id from public.sched_owner_now() o)
  order by l.at desc
  limit 200;
$$;
grant execute on function public.sched_my_bookings_history() to anon, authenticated;

-- ── 验证（可选）──
--  1) 老师端录入一条 → select owner_kind, owner_id, owner_name, entry_name from sched_bookings order by id desc limit 1;
--  2) 前端伪造 owner_id 提交 → 落库的仍是登录身份对应的值

-- ============================================================
-- 回滚：
--   drop trigger if exists sched_bookings_set_owner on public.sched_bookings;
--   drop function if exists public.sched_bookings_set_owner_fn();
--   drop policy if exists "sched_bookings delete own" on public.sched_bookings;
--   drop function if exists public.sched_my_bookings_history();
--   drop function if exists public.sched_my_identity();
--   drop function if exists public.sched_owner_now();
--   -- 列可以留着；要删：
--   -- alter table public.sched_bookings drop column if exists owner_kind, drop column if exists owner_id, drop column if exists owner_name;
-- ============================================================
