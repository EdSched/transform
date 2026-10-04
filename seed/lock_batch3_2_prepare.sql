-- ============================================================
-- 数据库上锁 第 3 批 · PR ② · 准备 SQL（合并 PR 之前执行）
-- 整个文件一次性执行，可重复执行。不锁任何表；执行后现有页面照常能用。
--
-- 做了 4 件事：
--   1. 口令自动建 Auth 账号：每个排课口令对应一个 Auth 账号（照 access_keys 的 ensure_access_key_auth 写法）
--        邮箱 = 'c_' || md5(口令) || '@sched.local'，密码 = 'sched:' || 口令
--        新增口令 / 启用 / 改口令时自动建；改口令或删口令时清掉旧账号；现有的所有口令一次性补建。
--        停用的口令：账号还在，但下面的 current_sched_code() 只认启用中的口令 → 停用立即失去数据库权限。
--   2. 辅助函数 current_sched_code() / is_sched_user()（不改 is_staff()，口令用户拿不到别的表的权限）
--   3. 课程同步触发器函数（sched_courses ↔ courses ↔ sched_course_id_map）+ courses_fill_domain 改成 security definer
--      （原来都不是；锁 courses 后，由任何身份触发的同步才不会被拦住）
--   4. 结尾有一条只读检查：口令数 vs 已建账号数
-- 前提：已执行 lock_batch3_1_prepare.sql / lock_batch3_1_lock.sql；jwt_email() / is_admin() / is_staff() 已存在。
-- ============================================================

-- ── 1. 口令 → Auth 账号 ──────────────────────────────────────
create or replace function public.ensure_sched_code_account(p_code text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text;
  new_uid uuid;
begin
  if p_code is null or p_code = '' then return; end if;
  v_email := 'c_' || md5(p_code) || '@sched.local';
  if exists (select 1 from auth.users where email = v_email) then return; end if;   -- 已有：跳过（密码由口令决定，不用改）
  new_uid := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', new_uid, 'authenticated', 'authenticated',
    v_email, crypt('sched:' || p_code, gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', ''
  );
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), new_uid,
    jsonb_build_object('sub', new_uid::text, 'email', v_email),
    'email', v_email, now(), now(), now());
end $$;
revoke all on function public.ensure_sched_code_account(text) from public, anon, authenticated;

create or replace function public.ensure_sched_code_auth()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare v_old text;
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.code is distinct from new.code) then
    -- 口令被删 / 被改：清掉旧账号（该口令若还有别的行在用就不清）
    if not exists (select 1 from public.sched_access_codes c where c.code = old.code and c.id is distinct from old.id) then
      v_old := 'c_' || md5(old.code) || '@sched.local';
      delete from auth.identities where user_id in (select id from auth.users where email = v_old);
      delete from auth.users where email = v_old;
    end if;
  end if;
  if tg_op <> 'DELETE' then
    perform public.ensure_sched_code_account(new.code);   -- 新增 / 启用 / 改口令：确保账号存在（停用的也建，启用时不用再等）
    return new;
  end if;
  return old;
end $$;
revoke all on function public.ensure_sched_code_auth() from public, anon, authenticated;

drop trigger if exists trg_ensure_sched_code_auth on public.sched_access_codes;
create trigger trg_ensure_sched_code_auth
  after insert or delete or update of code, active on public.sched_access_codes
  for each row execute function public.ensure_sched_code_auth();

-- 现有所有口令一次性补建
select public.ensure_sched_code_account(code) from public.sched_access_codes;

-- ── 2. 辅助函数 ────────────────────────────────────────────
-- JWT 邮箱是 c_<md5>@sched.local 且对应的口令仍启用 → 返回这个口令，否则 null
create or replace function public.current_sched_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.code from public.sched_access_codes c
  where c.active is true
    and public.jwt_email() = 'c_' || md5(c.code) || '@sched.local'
  limit 1
$$;
grant execute on function public.current_sched_code() to anon, authenticated;

create or replace function public.is_sched_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_sched_code() is not null
$$;
grant execute on function public.is_sched_user() to anon, authenticated;

-- ── 3. 同步触发器函数：改成 security definer ──────────────────
-- 这 5 个原来都是调用者身份；锁 courses 后，匿名/口令用户在排课系统改课 → 触发同步写 courses，必须能写进去
alter function public.sync_courses_to_sched()     security definer;
alter function public.sync_courses_to_sched()     set search_path = public;
alter function public.sync_new_course_to_sched()  security definer;
alter function public.sync_new_course_to_sched()  set search_path = public;
alter function public.sync_sched_to_courses()     security definer;
alter function public.sync_sched_to_courses()     set search_path = public;
alter function public.sync_new_sched_to_course()  security definer;
alter function public.sync_new_sched_to_course()  set search_path = public;
alter function public.courses_fill_domain()       security definer;
alter function public.courses_fill_domain()       set search_path = public;

-- ── 4. 只读检查：下面两个数应该相等 ────────────────────────────
select (select count(*) from public.sched_access_codes) as 口令数,
       (select count(*) from public.sched_access_codes c
         where exists (select 1 from auth.users u where u.email = 'c_' || md5(c.code) || '@sched.local')) as 已建账号数;

-- ── 回滚 ──
-- drop trigger if exists trg_ensure_sched_code_auth on public.sched_access_codes;
-- drop function if exists public.ensure_sched_code_auth();
-- drop function if exists public.ensure_sched_code_account(text);
-- drop function if exists public.is_sched_user();
-- drop function if exists public.current_sched_code();
-- delete from auth.identities where user_id in (select id from auth.users where email like 'c\_%@sched.local');
-- delete from auth.users where email like 'c\_%@sched.local';
-- alter function public.sync_courses_to_sched()    security invoker;  alter function public.sync_courses_to_sched()    reset search_path;
-- alter function public.sync_new_course_to_sched() security invoker;  alter function public.sync_new_course_to_sched() reset search_path;
-- alter function public.sync_sched_to_courses()    security invoker;  alter function public.sync_sched_to_courses()    reset search_path;
-- alter function public.sync_new_sched_to_course() security invoker;  alter function public.sync_new_sched_to_course() reset search_path;
-- alter function public.courses_fill_domain()      security invoker;  alter function public.courses_fill_domain()      reset search_path;
