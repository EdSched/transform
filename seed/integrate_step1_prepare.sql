-- ============================================================
-- 整合第 1 步：老师链接绑定「负责人」身份 —— 准备 SQL（合并 PR 之前执行）
-- 整个文件一次性执行，可重复执行。不锁任何新表；执行后现有领域链接 / 老师端 / 学生端照常。
--
-- 做了 4 件事：
--   1. teachers 加两个字段：manage_scope（负责人管理范围）、resource_perms（排课/资源权限）
--   2. 新函数 is_teacher_manager()：当前登录的是老师、且 manage_scope 不为空 → true
--   3. is_domain_key() 改成「领域链接 或 负责人老师」→ 所有已有规则自动对负责人老师生效
--   4. 防提权触发器：只有管理员能改 manage_scope / resource_perms（老师不能给自己加）
--
-- 执行前（可选，只读）先看一眼 is_domain_key / current_access_domain 现在的写法：
--   select pg_get_functiondef('public.is_domain_key()'::regprocedure);
--   select pg_get_functiondef('public.current_access_domain()'::regprocedure);
-- 本文件会在改动前把 is_domain_key() 的原定义自动存进表 _fn_backup，回滚时直接还原。
-- ============================================================

-- ── 1. 新字段 ──────────────────────────────────────────────
alter table public.teachers add column if not exists manage_scope jsonb;      -- {"domains":[],"majors":[],"class_ids":[]}；空 = 不是负责人
alter table public.teachers add column if not exists resource_perms text[] not null default '{}';   -- 排课/资源权限（沿用 sched 权限代号）

-- ── 2. is_teacher_manager() ────────────────────────────────
-- current_teacher_id() 只看登录邮箱（<id>@teacher.local），不读表；这里 security definer 读 teachers 自己那一行
create or replace function public.is_teacher_manager()
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
revoke all on function public.is_teacher_manager() from public;
grant execute on function public.is_teacher_manager() to anon, authenticated;

-- ── 3. is_domain_key() 加上「负责人老师」──────────────────
-- 3a. 先备份原定义（只备份一次）
create table if not exists public._fn_backup (
  name text primary key,
  def text not null,
  saved_at timestamptz not null default now()
);
revoke all on public._fn_backup from anon, authenticated;
insert into public._fn_backup(name, def)
select 'is_domain_key', pg_get_functiondef('public.is_domain_key()'::regprocedure)
on conflict (name) do nothing;

-- 3b. 安全检查：原定义必须是「靠 current_access_domain() 判断」，不是的话停下来，不要覆盖
do $$
declare d text;
begin
  select def into d from public._fn_backup where name = 'is_domain_key';
  if d is null or position('current_access_domain' in d) = 0 then
    raise exception E'is_domain_key() 现在的写法和预期不一样，请把下面这段发给 Claude 再继续：\n%', coalesce(d, '(没有备份)');
  end if;
end $$;

-- 3c. 替换（函数名、参数不变，已有 policy 自动生效）
create or replace function public.is_domain_key()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_access_domain() is not null or public.is_teacher_manager();
$$;
grant execute on function public.is_domain_key() to anon, authenticated;

-- ── 4. 防提权：老师不能自己改 manage_scope / resource_perms ──
-- 只管 anon / authenticated 角色；在 Supabase SQL Editor（postgres）里手动改不受影响
create or replace function public.teachers_guard_manage_cols()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.manage_scope is not null or coalesce(array_length(new.resource_perms, 1), 0) > 0 then
        raise exception '只有管理员能设置负责人范围和资源权限';
      end if;
    elsif new.manage_scope is distinct from old.manage_scope
       or new.resource_perms is distinct from old.resource_perms then
      raise exception '只有管理员能修改负责人范围和资源权限';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists teachers_guard_manage_cols on public.teachers;
create trigger teachers_guard_manage_cols
  before insert or update on public.teachers
  for each row execute function public.teachers_guard_manage_cols();

-- ============================================================
-- 回滚（需要时整段执行）
-- ============================================================
-- drop trigger if exists teachers_guard_manage_cols on public.teachers;
-- drop function if exists public.teachers_guard_manage_cols();
-- do $$ declare d text; begin
--   select def into d from public._fn_backup where name = 'is_domain_key';
--   if d is not null then execute d; end if;   -- 还原 is_domain_key() 原定义
-- end $$;
-- drop function if exists public.is_teacher_manager();
-- alter table public.teachers drop column if exists manage_scope;
-- alter table public.teachers drop column if exists resource_perms;
-- drop table if exists public._fn_backup;
