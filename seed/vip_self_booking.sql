-- ============================================================
-- VIP 学生「自主填写预约」：和老师商量好时间后学生自己填，老师确认 + 教务审核，两边都通过才算成立
-- 在 Supabase SQL Editor 手动执行；合并上线前先执行。回滚见文件末尾。
--
-- 做了什么：
--   1. bookings 加字段：self_booked / admin_review / admin_review_by / admin_review_at / admin_review_note / teacher_ok
--   2. slot_id 允许为空（自主预约没有时间槽）
--   3. 触发器 bookings_guard_review_cols：防止学生自己改审核状态
--
-- 状态怎么表达（不新增 status 取值）：
--   自主预约：type='vip'、slot_id=null、self_booked=true、admin_review='pending'、status='pending'
--   老师确认 → teacher_ok=true；教务通过 → admin_review='approved'
--   两边都通过的那一刻，后做的那一方把 status 改成 'confirmed'
--   任何一方退回 → status='cancelled' + cancel_reason（学生在「已取消」里看到原因）
-- ============================================================

-- ── 0. 执行前的只读检查（可选）──
-- slot_id 现在是否 not null / 有无外键：
--   select column_name, is_nullable from information_schema.columns
--    where table_schema='public' and table_name='bookings' and column_name='slot_id';
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.bookings'::regclass;
-- student_patch_booking 允许学生改哪些列（确认里面没有 admin_review* / teacher_ok / self_booked / status 之外的敏感列）：
--   select pg_get_functiondef('public.student_patch_booking(text,jsonb)'::regprocedure);
--   （如果上面报「函数不存在」，把参数类型改成实际的：select oid::regprocedure from pg_proc where proname='student_patch_booking';）

-- ── 1. 新字段 ──
alter table public.bookings add column if not exists self_booked boolean not null default false;   -- 学生自主填写的预约
alter table public.bookings add column if not exists admin_review text;          -- null（不需要审核）/ 'pending' / 'approved' / 'rejected'
alter table public.bookings add column if not exists admin_review_by text;
alter table public.bookings add column if not exists admin_review_at timestamptz;
alter table public.bookings add column if not exists admin_review_note text;
alter table public.bookings add column if not exists teacher_ok boolean not null default false;   -- 自主预约：老师已确认（教务还没通过时 status 仍是 pending）

-- ── 2. slot_id 允许为空（已经允许时是空操作；有 not null 才会放宽，外键不受影响）──
alter table public.bookings alter column slot_id drop not null;

-- ── 3. 防止学生自己改审核状态 ──
-- 只管 anon / authenticated 角色；在 SQL Editor（postgres）里手动改不受影响。
-- 管理员、管理模式的负责人老师、领域访问链接可以改 admin_review*；老师（任何老师）可以改 teacher_ok；学生两者都不能改。
-- 学生新增预约时：自主预约只能是 admin_review='pending'，普通预约必须是 null。

-- 3a. 当前登录的是不是「负责人老师」（teachers.manage_scope 非空）。security definer：读 teachers 不受 RLS 影响
create or replace function public.bookings_is_manager()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.teachers t
    where t.id = public.current_teacher_id()
      and t.manage_scope is not null
      and (
        (case when jsonb_typeof(t.manage_scope->'domains')   = 'array' then jsonb_array_length(t.manage_scope->'domains')   else 0 end) +
        (case when jsonb_typeof(t.manage_scope->'majors')    = 'array' then jsonb_array_length(t.manage_scope->'majors')    else 0 end) +
        (case when jsonb_typeof(t.manage_scope->'class_ids') = 'array' then jsonb_array_length(t.manage_scope->'class_ids') else 0 end)
      ) > 0
  );
$$;
revoke all on function public.bookings_is_manager() from public;
grant execute on function public.bookings_is_manager() to anon, authenticated;

-- 3b. 触发器函数
create or replace function public.bookings_guard_review_cols()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_priv boolean := false;
  v_key boolean := false;
  v_teacher boolean := false;
begin
  v_priv := coalesce(public.is_admin(), false) or coalesce(public.bookings_is_manager(), false);
  -- 领域访问链接（admin/?k=...）登录的账号也算教务（is_domain_key() 在库里没有时跳过，不报错）
  if not v_priv and to_regprocedure('public.is_domain_key()') is not null then
    execute 'select public.is_domain_key()' into v_key;
    v_priv := coalesce(v_key, false);
  end if;
  v_teacher := (public.current_teacher_id() is not null);
  if current_user in ('anon', 'authenticated') and not v_priv then
    if tg_op = 'INSERT' then
      if new.admin_review is distinct from (case when new.self_booked then 'pending' else null end)
         or new.admin_review_by is not null or new.admin_review_at is not null or new.admin_review_note is not null then
        raise exception '审核状态只能由教务设置';
      end if;
      if new.teacher_ok and not v_teacher then
        raise exception '只有老师能确认预约';
      end if;
    else
      if new.admin_review is distinct from old.admin_review
         or new.admin_review_by is distinct from old.admin_review_by
         or new.admin_review_at is distinct from old.admin_review_at
         or new.admin_review_note is distinct from old.admin_review_note
         or new.self_booked is distinct from old.self_booked then
        raise exception '只有教务能修改审核状态';
      end if;
      if new.teacher_ok is distinct from old.teacher_ok and not v_teacher then
        raise exception '只有老师能确认预约';
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

-- ── 4. 执行后的验收（可选）──
-- 以学生身份直接改审核状态应该报错「只有教务能修改审核状态」：
--   在学生页面控制台：await sb('/rest/v1/bookings?id=eq.<某条自己的预约id>','PATCH',{admin_review:'approved'})

-- ============================================================
-- 回滚（需要时整段执行）
-- ============================================================
-- drop trigger if exists bookings_guard_review_cols on public.bookings;
-- drop function if exists public.bookings_guard_review_cols();
-- drop function if exists public.bookings_is_manager();
-- alter table public.bookings drop column if exists teacher_ok;
-- alter table public.bookings drop column if exists admin_review_note;
-- alter table public.bookings drop column if exists admin_review_at;
-- alter table public.bookings drop column if exists admin_review_by;
-- alter table public.bookings drop column if exists admin_review;
-- alter table public.bookings drop column if exists self_booked;
-- slot_id 如果原本是 not null，需要先清掉 slot_id 为空的自主预约再恢复：
--   delete from public.bookings where slot_id is null and type='vip';
--   alter table public.bookings alter column slot_id set not null;   -- 仅当执行前检查显示它原本是 not null
