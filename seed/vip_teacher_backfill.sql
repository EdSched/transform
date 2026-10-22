-- ============================================================
-- 老师端「VIP 上课补录」：课上完后老师一次填完 → 教务确认（才扣课时）→ 学生确认
-- 在 Supabase SQL Editor 手动执行；合并上线前先执行。可重复执行。回滚见文件末尾。
-- 前提：已执行 vip_self_booking.sql、bookings_manual_entry.sql（有 bookings_is_manager / bookings_guard_review_cols）。
--
-- 做了什么：
--   1. bookings 加三列：teacher_backfill / backfill_room_note / student_confirmed_by
--   2. 触发器 bookings_guard_review_cols 加规则（其余逻辑与 bookings_manual_entry.sql 版本完全一致）：
--        老师只能新建 teacher_backfill=true、admin_review='pending'、status='pending' 的记录；
--        老师只能在 admin_review 为 pending / rejected 时把它改回 'pending'（重新提交）；
--        teacher_backfill 创建后不能改；student_confirmed_by（教务代确认）只有教务 / 负责人能写
--   3. RLS 策略：老师可以读 / 新建 / 修改 / 撤回「自己的补录」（只在 admin_review 为 pending / rejected 时可改、可删）
--      新增的是「额外放行」策略（多条 permissive 策略取并集），不会收紧现有任何权限；bookings 没开 RLS 时这些策略不起作用。
--
-- 状态怎么表达（不新增 status 取值）：
--   老师提交：type='vip'、teacher_backfill=true、teacher_ok=true、status='pending'、admin_review='pending'
--   教务确认：admin_review='approved'、status='completed'，并扣学生课时（前端做，和老师端「上课记录」一样的扣法）
--   教务退回：admin_review='rejected'（status 仍 pending，不扣课时），老师改完重新提交 → admin_review 回到 'pending'
--   教务代学生确认：student_confirmed=true、student_confirmed_by=教务名字
-- 不涉及排课系统（不占教室、不检查教室）。
-- ============================================================

-- ── 1. 新字段 ──
alter table public.bookings add column if not exists teacher_backfill boolean not null default false;   -- 老师课后补录
alter table public.bookings add column if not exists backfill_room_note text;                           -- 教室 / 地点说明（只是文字，不连排课系统）
alter table public.bookings add column if not exists student_confirmed_by text;                         -- 谁确认的：空 = 学生本人；否则是代确认的教务名字

-- ── 2. 当前登录老师的姓名（security definer：读 teachers 不受 RLS 影响；bookings.assigned_teacher 存的是老师姓名）──
create or replace function public.bookings_my_teacher_name()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select t.name from public.teachers t where t.id = public.current_teacher_id() limit 1;
$$;
revoke all on function public.bookings_my_teacher_name() from public;
grant execute on function public.bookings_my_teacher_name() to anon, authenticated;

-- ── 3. 触发器函数（在 bookings_manual_entry.sql 的版本上加「老师补录」规则）──
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
      if new.admin_review is distinct from (case when new.self_booked or new.teacher_backfill then 'pending' else null end)
         or new.admin_review_by is not null or new.admin_review_at is not null or new.admin_review_note is not null then
        raise exception '审核状态只能由教务设置';
      end if;
      if new.teacher_ok and not v_teacher then
        raise exception '只有老师能确认预约';
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

-- ── 4. RLS：老师对「自己的补录」的读 / 新建 / 修改 / 撤回 ──
-- 执行前可先看现有策略（只读）：select policyname, cmd, qual, with_check from pg_policies where tablename='bookings';
drop policy if exists "bookings teacher backfill select" on public.bookings;
create policy "bookings teacher backfill select" on public.bookings for select
  using (teacher_backfill and assigned_teacher = public.bookings_my_teacher_name());

drop policy if exists "bookings teacher backfill insert" on public.bookings;
create policy "bookings teacher backfill insert" on public.bookings for insert
  with check (teacher_backfill and type = 'vip' and admin_review = 'pending' and status = 'pending'
              and assigned_teacher = public.bookings_my_teacher_name());

drop policy if exists "bookings teacher backfill update" on public.bookings;
create policy "bookings teacher backfill update" on public.bookings for update
  using (teacher_backfill and admin_review in ('pending', 'rejected') and assigned_teacher = public.bookings_my_teacher_name())
  with check (teacher_backfill and assigned_teacher = public.bookings_my_teacher_name());

drop policy if exists "bookings teacher backfill delete" on public.bookings;
create policy "bookings teacher backfill delete" on public.bookings for delete
  using (teacher_backfill and admin_review in ('pending', 'rejected') and assigned_teacher = public.bookings_my_teacher_name());

-- ── 验收（可选）──
-- 以老师身份在控制台改教务才能改的列应报错：
--   await sb('/rest/v1/bookings?id=eq.<自己的补录id>','PATCH',{admin_review:'approved'})   -- 「只有教务能修改审核状态」
--   await sb('/rest/v1/bookings?id=eq.<自己的补录id>','PATCH',{student_confirmed_by:'x'}) -- 「只有教务能代学生确认」

-- ============================================================
-- 回滚（需要时整段执行）
-- ============================================================
-- drop policy if exists "bookings teacher backfill select" on public.bookings;
-- drop policy if exists "bookings teacher backfill insert" on public.bookings;
-- drop policy if exists "bookings teacher backfill update" on public.bookings;
-- drop policy if exists "bookings teacher backfill delete" on public.bookings;
-- 把 bookings_guard_review_cols() 恢复成 bookings_manual_entry.sql 里的版本（重新执行该文件的触发器函数那一段即可）
-- drop function if exists public.bookings_my_teacher_name();
-- delete from public.bookings where teacher_backfill;   -- 可选：连同补录记录一起清掉（注意：已确认的会影响课时记录，请先核对）
-- alter table public.bookings drop column if exists student_confirmed_by;
-- alter table public.bookings drop column if exists backfill_room_note;
-- alter table public.bookings drop column if exists teacher_backfill;
