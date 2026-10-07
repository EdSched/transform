-- ============================================================
-- 营业按范围 · SQL（PR ③；可重复执行）
-- 前提：已执行 dept_perms_prepare.sql（PR ②）。
-- 营业范围存在 teachers.role_scope.sales.domains（jsonb，不需要新字段）：
--   没有这一项 = 全部领域（现有营业：刘宇、李松原、闫杨、章龙都不用动）。
-- 这里只加一道保险：有「本范围老师管理」的部门负责人，新建 / 改成「营业」时必须指定营业领域
--   （不能留空 = 全部领域），领域不能超出自己的范围这一条 PR ② 的触发器已经管了。
-- 管理员不受影响。
-- ============================================================
create or replace function public.teachers_guard_sales_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_my text[];
  v_check boolean := false;
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() and new.position = 'sales' then
    v_my := public.dept_my_domains('teachers');
    if coalesce(array_length(v_my, 1), 0) > 0 then
      if tg_op = 'INSERT' then
        v_check := true;
      elsif old.position is distinct from 'sales' or (new.role_scope->'sales') is distinct from (old.role_scope->'sales') then
        v_check := true;   -- 刚改成营业，或改了营业范围；只改别的字段不检查（不影响已有的营业）
      end if;
      if v_check and (jsonb_typeof(new.role_scope->'sales'->'domains') is distinct from 'array'
                      or jsonb_array_length(new.role_scope->'sales'->'domains') = 0) then
        raise exception '营业老师必须指定营业范围（至少一个领域）';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists teachers_guard_sales_scope on public.teachers;
create trigger teachers_guard_sales_scope
  before insert or update on public.teachers
  for each row execute function public.teachers_guard_sales_scope();

-- 只读检查：现有营业的营业范围（应该都是空 = 全部领域）
select name, position, role_scope->'sales' as 营业范围 from public.teachers where position = 'sales' order by name;

-- ============================================================
-- 回滚
-- ============================================================
-- drop trigger if exists teachers_guard_sales_scope on public.teachers;
-- drop function if exists public.teachers_guard_sales_scope();
