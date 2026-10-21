-- ============================================================
-- 排课系统教室占用 · 留痕底座（操作记录）
-- 在 Supabase SQL Editor 手动执行；合并上线前先执行。整个文件一次性执行，可重复执行。
-- 前提：sched_bookings 已上锁（lock_batch3_3_lock.sql），is_admin() / current_sched_code() / current_teacher_id() 已存在。
--
-- 做了什么：
--   1. sched_bookings 加 4 列：last_actor（页面写入的真实操作人）、last_actor_at（写入时间，超过 10 分钟的 last_actor 视为过期不用）、
--      entry_name（录入人）、orig_room_id（驳回前申请的教室）
--   2. 新表 sched_booking_log（只能由触发器写入；读 = 管理员 + 有 occupy/manage 权限的口令/负责人）
--   3. sched_actor()：决定操作人（last_actor → 登录身份 → 记录上的 user_name）
--   4. 触发器 sched_bookings_log：每条占用的新建/批准/驳回/修改/删除各记一行
--   5. RPC sched_vip_history(p_name, p_token)：vip.html「预约履历」用，匿名可调，只返回要显示的字段
-- 注意：sched_bookings.id 按 bigint 处理（和 sched_booking_log.booking_id 对应）。
-- ============================================================

-- ── 1. sched_bookings 新增列 ─────────────────────────────────
alter table public.sched_bookings add column if not exists last_actor    text;
alter table public.sched_bookings add column if not exists last_actor_at timestamptz;
alter table public.sched_bookings add column if not exists entry_name    text;
alter table public.sched_bookings add column if not exists orig_room_id  bigint;

-- ── 2. 操作记录表 ────────────────────────────────────────────
create table if not exists public.sched_booking_log (
  id           bigserial primary key,
  booking_id   bigint,
  action       text not null,        -- create / approve / reject / edit / cancel / archive
  actor        text,
  actor_kind   text,                 -- code / admin / teacher / anon
  kind         text,
  booking_date date,
  room_id      bigint,
  user_name    text,
  student_name text,
  snapshot     jsonb,
  changes      jsonb,
  at           timestamptz not null default now()
);
create index if not exists sched_booking_log_at_idx         on public.sched_booking_log (at);
create index if not exists sched_booking_log_date_idx       on public.sched_booking_log (booking_date);
create index if not exists sched_booking_log_user_idx       on public.sched_booking_log (user_name);
create index if not exists sched_booking_log_booking_idx    on public.sched_booking_log (booking_id);

-- 谁能读操作记录：管理员；有 occupy / manage 权限的排课口令；有这两个权限的负责人老师
create or replace function public.can_view_sched_log()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.sched_access_codes c
      where c.code = public.current_sched_code()
        and (c.role = 'admin'
             or regexp_split_to_array(coalesce(c.perms::text, ''), '\s*,\s*') && array['occupy','manage'])
    )
    or exists (
      select 1 from public.teachers t
      where t.id = public.current_teacher_id()
        and coalesce(t.resource_perms, '{}'::text[]) && array['occupy','manage']
    );
$$;
grant execute on function public.can_view_sched_log() to anon, authenticated;

alter table public.sched_booking_log enable row level security;
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='sched_booking_log' loop
    execute format('drop policy %I on public.sched_booking_log', r.policyname);
  end loop;
end $$;
create policy "sched_booking_log read" on public.sched_booking_log for select using (public.can_view_sched_log());
-- 不建 insert / update / delete 策略：前端不能直接写；触发器与 security definer 函数不受 RLS 限制

-- ── 3. 操作人 ────────────────────────────────────────────────
-- 顺序：①记录上的 last_actor（10 分钟内写入的才算）②登录身份 ③记录上的 user_name（匿名 vip.html 老师）
create or replace function public.sched_actor(p_last_actor text, p_last_at timestamptz, p_user_name text,
                                              out actor text, out actor_kind text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_label text; v_tname text;
begin
  -- 先判断登录身份（actor_kind 用）
  if public.is_admin() then
    actor := '管理员'; actor_kind := 'admin';
  elsif public.current_sched_code() is not null then
    select c.label into v_label from public.sched_access_codes c where c.code = public.current_sched_code() limit 1;
    actor := coalesce(nullif(v_label, ''), '排课口令'); actor_kind := 'code';
  elsif public.current_teacher_id() is not null then
    select t.name into v_tname from public.teachers t where t.id = public.current_teacher_id();
    actor := coalesce(v_tname, '老师'); actor_kind := 'teacher';
  else
    actor := null; actor_kind := 'anon';
  end if;
  -- 页面写入的真实姓名优先
  if p_last_actor is not null and btrim(p_last_actor) <> ''
     and p_last_at is not null and p_last_at > now() - interval '10 minutes' then
    actor := btrim(p_last_actor);
  elsif actor is null then
    actor := p_user_name;
  end if;
end $$;
grant execute on function public.sched_actor(text, timestamptz, text) to anon, authenticated;

-- ── 4. 触发器 ────────────────────────────────────────────────
create or replace function public.sched_bookings_log_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o jsonb; n jsonb; k text;
  v_changes jsonb := '{}'::jsonb;
  v_action text; v_row jsonb; v_snap jsonb;
  v_actor text; v_kind text;
  v_la text; v_la_at timestamptz;
  v_ignore text[] := array['last_actor','last_actor_at'];
  v_status text;
begin
  if coalesce(current_setting('sched.archiving', true), '') = '1' then
    return null;          -- 归档清空：逐行不写，由 sched_archive_purge 统一写一条
  end if;

  if tg_op = 'INSERT' then
    n := to_jsonb(new); v_action := 'create'; v_row := n; v_snap := n;
    v_la := new.last_actor; v_la_at := new.last_actor_at;
  elsif tg_op = 'DELETE' then
    o := to_jsonb(old); v_action := 'cancel'; v_row := o; v_snap := o;
    v_la := old.last_actor; v_la_at := old.last_actor_at;
  else
    o := to_jsonb(old); n := to_jsonb(new);
    for k in select jsonb_object_keys(n) loop
      if k = any(v_ignore) then continue; end if;
      if (n -> k) is distinct from (o -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', o -> k, 'to', n -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;        -- 只是写了 last_actor（删除前的盖章），不算一次修改
    end if;
    v_status := new.status;
    if old.status is distinct from new.status and v_status = 'confirmed' then v_action := 'approve';
    elsif old.status is distinct from new.status and v_status = 'rejected' then v_action := 'reject';
    else v_action := 'edit'; end if;
    v_snap := o;                       -- 修改 / 驳回：操作前的整条记录
    v_row  := n;
    v_la := new.last_actor; v_la_at := new.last_actor_at;
  end if;

  select a.actor, a.actor_kind into v_actor, v_kind
  from public.sched_actor(v_la, v_la_at, v_row ->> 'user_name') a;

  insert into public.sched_booking_log
    (booking_id, action, actor, actor_kind, kind, booking_date, room_id, user_name, student_name, snapshot, changes)
  values (
    (v_row ->> 'id')::bigint, v_action, v_actor, v_kind,
    v_row ->> 'kind',
    nullif(v_row ->> 'booking_date', '')::date,
    coalesce(nullif(v_row ->> 'room_id', '')::bigint, nullif(v_snap ->> 'room_id', '')::bigint),
    v_row ->> 'user_name', v_row ->> 'student_name',
    v_snap,
    case when tg_op = 'UPDATE' then v_changes else null end
  );
  return null;
end $$;

drop trigger if exists sched_bookings_log on public.sched_bookings;
create trigger sched_bookings_log
  after insert or update or delete on public.sched_bookings
  for each row execute function public.sched_bookings_log_fn();

-- ── 5. vip.html「预约履历」 ──────────────────────────────────
create or replace function public.sched_vip_history(p_name text, p_token text)
returns table (
  at timestamptz, action text, booking_id bigint, booking_date date, start_time text, end_time text,
  room_campus text, room_name text, student_name text, actor text, reject_reason text, changes jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select l.at, l.action, l.booking_id, l.booking_date,
         l.snapshot ->> 'start_time', l.snapshot ->> 'end_time',
         coalesce(r.campus, l.snapshot ->> 'req_campus'), r.name,
         l.student_name, l.actor,
         l.changes -> 'reject_reason' ->> 'to',
         l.changes
  from public.sched_booking_log l
  left join public.sched_rooms r on r.id = l.room_id
  where l.kind = 'vip'
    and ( (coalesce(p_name, '')  <> '' and l.user_name = p_name)
       or (coalesce(p_token, '') <> '' and l.snapshot ->> 'client_token' = p_token) )
  order by l.at desc
  limit 100;
$$;
grant execute on function public.sched_vip_history(text, text) to anon, authenticated;

-- ── 验证（可选）──
--  1) select * from sched_booking_log order by at desc limit 5;   -- 管理员登录下应能看到；匿名应返回 []
--  2) 在排课系统改一条测试占用 → sched_booking_log 多一条 edit，changes 里有 from/to

-- ============================================================
-- 回滚：
--   drop trigger if exists sched_bookings_log on public.sched_bookings;
--   drop function if exists public.sched_bookings_log_fn();
--   drop function if exists public.sched_vip_history(text, text);
--   drop function if exists public.sched_actor(text, timestamptz, text);
--   drop function if exists public.can_view_sched_log();
--   drop table if exists public.sched_booking_log;
--   -- 列可以留着；要删：
--   -- alter table public.sched_bookings drop column if exists last_actor, drop column if exists last_actor_at,
--   --   drop column if exists entry_name, drop column if exists orig_room_id;
-- ============================================================
