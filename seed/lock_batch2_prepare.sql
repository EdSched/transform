-- ============================================================
-- 数据库上锁 第 2 批 · 第 ① 步：准备（合并 PR 之前执行）
-- 只新增函数 / 修改函数属性，不改任何表的权限 —— 执行后旧代码照常能用。
-- 整个文件可一次性执行；可重复执行。
-- 前提：第 1 批已建好 is_admin() / is_staff() / is_domain_key() / current_access_domain()
--
-- 执行前（可选，只读）先看一眼 current_access_domain 现在的写法：
--   select pg_get_functiondef('public.current_access_domain()'::regprocedure);
-- ============================================================

-- ── A. access_keys（领域访问链接）────────────────────────────

-- A1. 登录前用：按 k 取"这一把"钥匙，不返回 password
create or replace function public.resolve_access_key(p_k text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'k', a.k, 'domain', a.domain, 'domains', a.domains, 'majors', a.majors,
    'class_ids', a.class_ids, 'is_admin', a.is_admin, 'label', a.label, 'active', a.active
  )
  from public.access_keys a
  where a.k = p_k
  limit 1;
$$;
revoke all on function public.resolve_access_key(text) from public;
grant execute on function public.resolve_access_key(text) to anon, authenticated;

-- A2. 管理端旧的「密码框」（只对 is_admin=true 的钥匙还会出现）：密码交给数据库比对，不再下发到浏览器
create or replace function public.check_access_key_password(p_k text, p_pw text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(select 1 from public.access_keys a
                where a.k = p_k and a.active is true and a.password is not null and a.password = p_pw);
$$;
revoke all on function public.check_access_key_password(text, text) from public;
grant execute on function public.check_access_key_password(text, text) to anon, authenticated;

-- A3. 锁表后，领域链接的身份判断还要能读 access_keys → 函数改成 security definer
alter function public.current_access_domain() security definer;
alter function public.current_access_domain() set search_path = public;

-- ── C. salary_bookings（领现金工资预约）──────────────────────
-- C1. 各时段已被约了几个（不含姓名）
create or replace function public.salary_taken_slots(p_from date, p_to date)
returns table(slot_date text, slot_time text, cnt integer)
language sql
security definer
set search_path = public
stable
as $$
  select b.slot_date::text, b.slot_time::text, count(*)::integer
  from public.salary_bookings b
  where b.slot_date::text between p_from::text and p_to::text
  group by 1, 2;
$$;

-- C2. 这个 token 自己的预约
create or replace function public.salary_my_bookings(p_token text)
returns table(id text, slot_date text, slot_time text, teacher_name text, note text, ym text)
language sql
security definer
set search_path = public
stable
as $$
  select b.id::text, b.slot_date::text, b.slot_time::text, b.teacher_name, b.note, b.ym
  from public.salary_bookings b
  where coalesce(p_token, '') <> '' and b.client_token = p_token
  order by b.slot_date, b.slot_time;
$$;

-- C3. 只能取消自己的预约
create or replace function public.salary_cancel(p_token text, p_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with d as (
    delete from public.salary_bookings b
    where coalesce(p_token, '') <> '' and b.client_token = p_token and b.id::text = p_id
    returning 1
  )
  select exists(select 1 from d);
$$;

-- C4/C5. 「换了手机/电脑，输入姓名找回」：按姓名完全匹配找回并取消（和原来页面行为一致，不显示别人的预约）
create or replace function public.salary_find_by_name(p_ym text, p_name text)
returns table(id text, slot_date text, slot_time text, note text)
language sql
security definer
set search_path = public
stable
as $$
  select b.id::text, b.slot_date::text, b.slot_time::text, b.note
  from public.salary_bookings b
  where btrim(coalesce(p_name, '')) <> '' and b.ym = p_ym and b.teacher_name = btrim(p_name)
  order by b.slot_date, b.slot_time;
$$;

create or replace function public.salary_cancel_by_name(p_name text, p_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with d as (
    delete from public.salary_bookings b
    where btrim(coalesce(p_name, '')) <> '' and b.teacher_name = btrim(p_name) and b.id::text = p_id
    returning 1
  )
  select exists(select 1 from d);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'salary_taken_slots(date,date)', 'salary_my_bookings(text)', 'salary_cancel(text,text)',
    'salary_find_by_name(text,text)', 'salary_cancel_by_name(text,text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- ── 撤销（需要时执行）────────────────────────────────────────
-- drop function if exists public.resolve_access_key(text);
-- drop function if exists public.check_access_key_password(text, text);
-- drop function if exists public.salary_taken_slots(date, date);
-- drop function if exists public.salary_my_bookings(text);
-- drop function if exists public.salary_cancel(text, text);
-- drop function if exists public.salary_find_by_name(text, text);
-- drop function if exists public.salary_cancel_by_name(text, text);
-- alter function public.current_access_domain() security invoker;
-- alter function public.current_access_domain() reset search_path;
