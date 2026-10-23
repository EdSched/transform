-- ============================================================
-- VIP 自助预约 v2：老师、学生谁发起都行，另一方确认就成立；教务只是知情和兜底；工资按最终确认时间算
-- 在 Supabase SQL Editor 手动执行；PR1 合并上线前先执行（一次执行完）。回滚见文件末尾。
--
-- 做了什么：
--   1. bookings 加字段：initiated_by / student_ok / student_ok_at / teacher_ok_at / ok_by_admin / student_confirmed_at
--   2. 补历史数据：student_confirmed = true 但 student_confirmed_at 为空的，用 updated_at（没有这一列就用 slot_date）补上
--   3. 触发器 bookings_stamp_ok_times：谁确认了，时间由数据库盖章（前端传什么都不算），工资按 student_confirmed_at 算月份
--   4. 触发器 bookings_guard_review_cols 重建：在「老师补录」版本上加新规则
--        - 学生自助预约不再需要教务审核：新建时 admin_review 可以为空（旧写法 'pending' 仍然允许，方便新旧版本过渡）
--        - initiated_by='teacher' 只有老师能写；student_ok / ok_by_admin / initiated_by 只有教务能直接改（学生走下面的函数）
--   5. 函数 student_vip_ok(id)：学生确认「老师为我约的这节课」（security definer，只认自己的预约）
--      函数 student_vip_cancel(id, reason)：学生取消自己的 VIP 预约（取消后教室由 trg_bookings_release_sched_room 自动释放）
--   6. RLS：老师可以新建 initiated_by='teacher'、assigned_teacher=自己、学生是自己 VIP 学生的预约；
--           老师可以读 / 改自己名下 initiated_by='teacher' 的预约。不放宽别的
--
-- 状态怎么表达（不新增 status 取值）：
--   老师发起：type='vip'、slot_id=null、initiated_by='teacher'、teacher_ok=true、student_ok=false、status='pending'
--   学生确认（student_ok=true）→ status='confirmed'（成立）
--   学生发起：initiated_by='student'（兼容旧的 self_booked=true）；老师确认（teacher_ok=true）→ status='confirmed'
--   教务代确认：把缺的那一方的 teacher_ok / student_ok 置 true，并写 ok_by_admin（教务名字）
-- ============================================================

-- ── 0. 执行前的只读检查（可选）──
-- bookings 有没有 updated_at：
--   select column_name from information_schema.columns where table_schema='public' and table_name='bookings' and column_name in ('updated_at','student_id','student_confirmed');
-- students.vip_teachers 的类型（下面策略按 text[] 写；如果是 jsonb 要改成 vip_teachers ? 老师名）：
--   select data_type, udt_name from information_schema.columns where table_schema='public' and table_name='students' and column_name='vip_teachers';
-- 现有 bookings 策略：
--   select policyname, cmd, qual, with_check from pg_policies where tablename='bookings';

-- ── 1. 新字段 ──
alter table public.bookings add column if not exists initiated_by text;                 -- 'teacher' / 'student' / 'admin'（以后新建的都写；旧数据为空）
alter table public.bookings add column if not exists student_ok boolean;                -- 学生确认「要上这节课」（老师发起时用）
alter table public.bookings add column if not exists student_ok_at timestamptz;
alter table public.bookings add column if not exists teacher_ok_at timestamptz;
alter table public.bookings add column if not exists ok_by_admin text;                  -- 教务代确认时写教务名字（代哪一方写在 messages 备注里）
alter table public.bookings add column if not exists student_confirmed_at timestamptz;  -- 课后学生确认完成的时间（工资按它）

-- ── 2. 补历史数据：已经确认但没有确认时间的 ──
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='updated_at') then
    update public.bookings
       set student_confirmed_at = coalesce(updated_at, slot_date::timestamptz)
     where student_confirmed is true and student_confirmed_at is null;
  else
    update public.bookings
       set student_confirmed_at = slot_date::timestamptz
     where student_confirmed is true and student_confirmed_at is null;
  end if;
end $$;

-- ── 3. 确认时间由数据库盖章 ──
-- 规则：false→true 的那一刻写 now()；其他情况保持原值。非教务不能直接改这几个时间。
create or replace function public.bookings_stamp_ok_times()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_priv boolean := coalesce(public.is_admin(), false) or coalesce(public.bookings_is_manager(), false);
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') and not v_priv then
      new.teacher_ok_at := null; new.student_ok_at := null; new.student_confirmed_at := null;
    end if;
    if new.teacher_ok is true and new.teacher_ok_at is null then new.teacher_ok_at := now(); end if;
    if new.student_ok is true and new.student_ok_at is null then new.student_ok_at := now(); end if;
    if new.student_confirmed is true and new.student_confirmed_at is null then new.student_confirmed_at := now(); end if;
  else
    if current_user in ('anon', 'authenticated') and not v_priv then
      new.teacher_ok_at := old.teacher_ok_at; new.student_ok_at := old.student_ok_at; new.student_confirmed_at := old.student_confirmed_at;
    end if;
    if new.teacher_ok is true and old.teacher_ok is not true and new.teacher_ok_at is not distinct from old.teacher_ok_at then new.teacher_ok_at := now(); end if;
    if new.student_ok is true and old.student_ok is not true and new.student_ok_at is not distinct from old.student_ok_at then new.student_ok_at := now(); end if;
    if new.student_confirmed is true and old.student_confirmed is not true and new.student_confirmed_at is not distinct from old.student_confirmed_at then new.student_confirmed_at := now(); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_stamp_ok_times on public.bookings;
create trigger bookings_stamp_ok_times
  before insert or update on public.bookings
  for each row execute function public.bookings_stamp_ok_times();

-- ── 4. 守卫触发器（在 vip_teacher_backfill.sql 的版本上加新规则）──
create or replace function public.bookings_guard_review_cols()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_priv boolean := false;
  v_teacher boolean := false;
begin
  v_priv := coalesce(public.is_admin(), false) or coalesce(public.bookings_is_manager(), false);
  v_teacher := (public.current_teacher_id() is not null);
  if current_user in ('anon', 'authenticated') and not v_priv then
    if tg_op = 'INSERT' then
      -- 审核状态：只有「老师补录」需要教务审核（'pending'）；学生自助预约不再审核，但旧版本页面写 'pending' 仍然允许
      if new.admin_review is not null and not (new.admin_review = 'pending' and (new.self_booked or new.teacher_backfill)) then
        raise exception '审核状态只能由教务设置';
      end if;
      if new.admin_review_by is not null or new.admin_review_at is not null or new.admin_review_note is not null then
        raise exception '审核状态只能由教务设置';
      end if;
      if new.teacher_ok and not v_teacher then
        raise exception '只有老师能确认预约';
      end if;
      if new.student_ok is true then
        raise exception '只有学生本人能确认';
      end if;
      if new.ok_by_admin is not null then
        raise exception '只有教务能代确认';
      end if;
      if new.initiated_by = 'teacher' and not v_teacher then
        raise exception '只有老师能以老师身份发起预约';
      end if;
      if new.initiated_by = 'admin' then
        raise exception '只有教务能以教务身份发起预约';
      end if;
      if new.manual_entry or new.manual_reason is not null or new.manual_by is not null then
        raise exception '只有教务能补录预约';
      end if;
      if new.teacher_backfill then
        if not v_teacher then raise exception '只有老师能补录上课记录'; end if;
        if new.status is distinct from 'pending' or new.student_confirmed then
          raise exception '老师补录需等教务确认';
        end if;
      end if;
      if new.student_confirmed_by is not null then
        raise exception '只有教务能代学生确认';
      end if;
    else
      if new.admin_review is distinct from old.admin_review
         or new.admin_review_by is distinct from old.admin_review_by
         or new.admin_review_at is distinct from old.admin_review_at
         or new.admin_review_note is distinct from old.admin_review_note
         or new.self_booked is distinct from old.self_booked then
        -- 唯一例外：老师把自己被退回（或还在待确认）的补录重新提交 → admin_review 回到 'pending'，by / at / note 不动
        if not (old.teacher_backfill and new.teacher_backfill and v_teacher
                and old.admin_review in ('pending', 'rejected') and new.admin_review = 'pending'
                and new.admin_review_by is not distinct from old.admin_review_by
                and new.admin_review_at is not distinct from old.admin_review_at
                and new.admin_review_note is not distinct from old.admin_review_note
                and new.self_booked is not distinct from old.self_booked) then
          raise exception '只有教务能修改审核状态';
        end if;
      end if;
      if new.teacher_ok is distinct from old.teacher_ok and not v_teacher then
        raise exception '只有老师能确认预约';
      end if;
      if new.student_ok is distinct from old.student_ok then
        raise exception '只有学生本人能确认（请在学生页面操作）';
      end if;
      if new.ok_by_admin is distinct from old.ok_by_admin then
        raise exception '只有教务能代确认';
      end if;
      if new.initiated_by is distinct from old.initiated_by then
        raise exception '只有教务能修改预约的发起方';
      end if;
      if new.manual_entry is distinct from old.manual_entry
         or new.manual_reason is distinct from old.manual_reason
         or new.manual_by is distinct from old.manual_by then
        raise exception '只有教务能修改补录标记';
      end if;
      if new.teacher_backfill is distinct from old.teacher_backfill then
        raise exception '只有教务能修改老师补录标记';
      end if;
      if new.student_confirmed_by is distinct from old.student_confirmed_by then
        raise exception '只有教务能代学生确认';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_guard_review_cols on public.bookings;
create trigger bookings_guard_review_cols
  before insert or update on public.bookings
  for each row execute function public.bookings_guard_review_cols();

-- ── 5. 学生用的两个函数（security definer：触发器里 current_user 是函数所有者，不会被上面的限制拦住）──
-- 学生登录账号是 <学生id>@student.local，所以用 jwt 里的 email 认人；只能动自己的、老师发起的、还没取消的预约
create or replace function public.student_vip_ok(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_n int;
begin
  update public.bookings b
     set student_ok = true,
         status = case when b.teacher_ok is true then 'confirmed' else b.status end
   where b.id::text = p_id
     and b.type = 'vip'
     and b.initiated_by = 'teacher'
     and b.status in ('pending', 'confirmed')
     and v_email = lower(b.student_id::text) || '@student.local';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'booking not found'; end if;
end;
$$;
revoke all on function public.student_vip_ok(text) from public;
grant execute on function public.student_vip_ok(text) to authenticated;

create or replace function public.student_vip_cancel(p_id text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_n int;
begin
  update public.bookings b
     set status = 'cancelled', cancel_reason = coalesce(nullif(trim(p_reason), ''), '学生取消'),
         cancelled_by = '学生本人', cancelled_at = now()
   where b.id::text = p_id
     and b.type = 'vip'
     and b.status in ('pending', 'confirmed')
     and b.vip_session_notes is null
     and v_email = lower(b.student_id::text) || '@student.local';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'booking not found'; end if;
end;
$$;
revoke all on function public.student_vip_cancel(text, text) from public;
grant execute on function public.student_vip_cancel(text, text) to authenticated;

-- ── 6. RLS：老师发起的预约 ──
drop policy if exists "bookings teacher vip create" on public.bookings;
create policy "bookings teacher vip create" on public.bookings for insert
  with check (
    type = 'vip' and initiated_by = 'teacher' and teacher_ok is true and coalesce(student_ok, false) = false
    and status = 'pending' and not teacher_backfill
    and assigned_teacher = public.bookings_my_teacher_name()
    and exists (select 1 from public.students s where s.id::text = bookings.student_id::text
                and public.bookings_my_teacher_name() = any (s.vip_teachers))
  );

drop policy if exists "bookings teacher vip select own" on public.bookings;
create policy "bookings teacher vip select own" on public.bookings for select
  using (type = 'vip' and assigned_teacher = public.bookings_my_teacher_name());

drop policy if exists "bookings teacher vip update own" on public.bookings;
create policy "bookings teacher vip update own" on public.bookings for update
  using (type = 'vip' and initiated_by = 'teacher' and assigned_teacher = public.bookings_my_teacher_name())
  with check (type = 'vip' and initiated_by = 'teacher' and assigned_teacher = public.bookings_my_teacher_name());

-- ── 验收（可选）──
-- 1) 补历史数据后应该是 0：select count(*) from public.bookings where student_confirmed is true and student_confirmed_at is null;
-- 2) 以老师身份在控制台直接改 student_ok 应报错：
--      await sb('/rest/v1/bookings?id=eq.<自己发起的预约id>','PATCH',{student_ok:true})   -- 「只有学生本人能确认」
-- 3) 以学生身份在学生页点「确认上课」后：status='confirmed'、student_ok=true、student_ok_at 有值

-- ============================================================
-- 回滚（需要时整段执行；守卫触发器恢复成 vip_teacher_backfill.sql 里的版本——重新执行那个文件的第 3 段即可）
-- ============================================================
-- drop policy if exists "bookings teacher vip create" on public.bookings;
-- drop policy if exists "bookings teacher vip select own" on public.bookings;
-- drop policy if exists "bookings teacher vip update own" on public.bookings;
-- drop function if exists public.student_vip_ok(text);
-- drop function if exists public.student_vip_cancel(text, text);
-- drop trigger if exists bookings_stamp_ok_times on public.bookings;
-- drop function if exists public.bookings_stamp_ok_times();
-- （然后重新执行 seed/vip_teacher_backfill.sql 的「3. 触发器函数」那一段，恢复旧的守卫触发器）
-- alter table public.bookings drop column if exists student_confirmed_at;
-- alter table public.bookings drop column if exists ok_by_admin;
-- alter table public.bookings drop column if exists teacher_ok_at;
-- alter table public.bookings drop column if exists student_ok_at;
-- alter table public.bookings drop column if exists student_ok;
-- alter table public.bookings drop column if exists initiated_by;
