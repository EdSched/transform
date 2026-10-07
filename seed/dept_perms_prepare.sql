-- ============================================================
-- 部门管理权限 · 准备 SQL（PR ②，合并 PR 之前执行；可重复执行）
-- 只加字段、函数、改防提权触发器；不改任何表的读写规则（规则在 dept_perms_lock.sql）。
-- 执行后现有页面照常能用：触发器对「没有部门管理权限的人」的限制和原来完全一样。
--
-- 做了 4 件事：
--   1. teachers.dept_perms（部门管理权限：pricing / majors / promo / teachers）
--      price_vip_rates.domain / price_ta_options.domain（null = 通用，现有数据不变）
--   2. 函数 can_manage(权限, 领域)：当前登录的是老师、职位是负责人、dept_perms 含该权限、该领域在 manage_scope.domains 里 → true
--      （辅助：dept_my_domains / can_manage_major / dept_majors_in / dept_teacher_in_range，都是 security definer）
--   3. 防提权触发器 teachers_guard_manage_cols 升级：
--      · dept_perms 只有管理员能改
--      · 有「本范围老师管理」的负责人：能新建 / 改范围内的老师，但不能设职位「负责人 / 对接 / 总务」、不能碰
--        manage_scope / dept_perms、不能改资源权限里的「超级(manage) / 会议账号管理(account_manage)」、
--        不能把老师的隶属领域 / 负责领域 / 负责专业 / 班主任范围 / 营业范围设到自己范围以外
--      · 其他人的限制和原来完全一样
-- 前提：已执行 integrate_step1_prepare.sql、teacher_roles_prepare.sql（teachers 有 position / roles / role_scope）。
-- 假设 teachers.managed_by / domains / majors / roles / resource_perms 都是 text[]（和现有触发器的写法一致）。
-- ============================================================

-- ── 1. 字段 ──────────────────────────────────────────────────
alter table public.teachers add column if not exists dept_perms text[] not null default '{}';
alter table public.price_vip_rates  add column if not exists domain text;   -- null = 通用
alter table public.price_ta_options add column if not exists domain text;

-- ── 2. 函数 ──────────────────────────────────────────────────
-- 当前登录老师在某项部门管理权限下能管理的领域（不是负责人 / 没这项权限 → 空数组）
create or replace function public.dept_my_domains(p_perm text)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select array(select jsonb_array_elements_text(t.manage_scope->'domains'))
    from public.teachers t
    where t.id = public.current_teacher_id()
      and t.position = 'lead'
      and p_perm = any(t.dept_perms)
      and jsonb_typeof(t.manage_scope->'domains') = 'array'
  ), '{}'::text[]);
$$;
revoke all on function public.dept_my_domains(text) from public;
grant execute on function public.dept_my_domains(text) to anon, authenticated;

create or replace function public.can_manage(p_perm text, p_domain text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(p_domain, '') <> '' and p_domain = any(public.dept_my_domains(p_perm));
$$;
revoke all on function public.can_manage(text, text) from public;
grant execute on function public.can_manage(text, text) to anon, authenticated;

-- 专业所属领域 → can_manage（宣传内容按专业判断用）
create or replace function public.can_manage_major(p_perm text, p_major text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.can_manage(p_perm, (select m.domain from public.majors m where m.key = p_major));
$$;
revoke all on function public.can_manage_major(text, text) from public;
grant execute on function public.can_manage_major(text, text) to anon, authenticated;

-- 这些专业是否都属于给定领域（触发器用；没有领域的专业算不在范围内）
create or replace function public.dept_majors_in(p_keys text[], p_domains text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select not exists (
    select 1 from unnest(coalesce(p_keys, '{}'::text[])) k
    left join public.majors m on m.key = k
    where m.domain is null or not (m.domain = any(coalesce(p_domains, '{}'::text[])))
  );
$$;
revoke all on function public.dept_majors_in(text[], text[]) from public;
grant execute on function public.dept_majors_in(text[], text[]) to anon, authenticated;

-- 这位老师是否在「本范围老师管理」的范围内：隶属 / 负责领域 / 负责专业所属领域，只要有一个在我的范围里
create or replace function public.dept_teacher_in_range(p_managed text[], p_domains text[], p_majors text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.dept_my_domains('teachers') && (
    coalesce(p_managed, '{}'::text[]) || coalesce(p_domains, '{}'::text[])
    || array(select m.domain from public.majors m where m.key = any(coalesce(p_majors, '{}'::text[])) and m.domain is not null)
  );
$$;
revoke all on function public.dept_teacher_in_range(text[], text[], text[]) from public;
grant execute on function public.dept_teacher_in_range(text[], text[], text[]) to anon, authenticated;

-- ── 3. 防提权触发器 ────────────────────────────────────────────
create or replace function public.teachers_guard_manage_cols()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_my       text[];
  v_sens     text[] := array['manage', 'account_manage'];     -- 资源权限里的「超级」「会议账号管理」
  v_roles_ok text[] := array['senmon', 'ta', 'homeroom'];     -- 部门负责人能设的执行角色
  o_managed  text[] := '{}';
  o_domains  text[] := '{}';
  o_majors   text[] := '{}';
  o_res      text[] := '{}';
  o_roles    text[] := '{}';
  o_pos      text;
  o_rs       jsonb  := '{}'::jsonb;
  v_added    text[];
  k          text;
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    -- 部门管理权限：只有管理员能改
    if tg_op = 'INSERT' then
      if coalesce(array_length(new.dept_perms, 1), 0) > 0 then
        raise exception '只有管理员能设置部门管理权限';
      end if;
    elsif new.dept_perms is distinct from old.dept_perms then
      raise exception '只有管理员能修改部门管理权限';
    end if;

    v_my := public.dept_my_domains('teachers');
    if coalesce(array_length(v_my, 1), 0) = 0 then
      -- ── 没有「本范围老师管理」：和原来完全一样 ──
      if tg_op = 'INSERT' then
        if new.manage_scope is not null or coalesce(array_length(new.resource_perms, 1), 0) > 0 then
          raise exception '只有管理员能设置负责人范围和资源权限';
        end if;
        if new.position is not null or coalesce(array_length(new.roles, 1), 0) > 0 or new.role_scope is not null then
          raise exception '只有管理员能设置管理职位和执行角色';
        end if;
      else
        if new.manage_scope is distinct from old.manage_scope
           or new.resource_perms is distinct from old.resource_perms then
          raise exception '只有管理员能修改负责人范围和资源权限';
        end if;
        if new.position is distinct from old.position
           or new.roles is distinct from old.roles
           or new.role_scope is distinct from old.role_scope then
          raise exception '只有管理员能修改管理职位和执行角色';
        end if;
      end if;
    else
      -- ── 有「本范围老师管理」的负责人 ──
      if tg_op = 'UPDATE' then
        o_managed := coalesce(old.managed_by, '{}');  o_domains := coalesce(old.domains, '{}');
        o_majors  := coalesce(old.majors, '{}');      o_res     := coalesce(old.resource_perms, '{}');
        o_roles   := coalesce(old.roles, '{}');       o_pos     := old.position;
        o_rs      := coalesce(old.role_scope, '{}'::jsonb);
      end if;
      -- 负责人范围：不能碰
      if (tg_op = 'INSERT' and new.manage_scope is not null)
         or (tg_op = 'UPDATE' and new.manage_scope is distinct from old.manage_scope) then
        raise exception '只有管理员能设置负责人范围';
      end if;
      -- 资源权限：「超级」「会议账号管理」不能动，其他可以
      if array(select x from unnest(coalesce(new.resource_perms, '{}'::text[])) x where x = any(v_sens) order by x)
         is distinct from array(select x from unnest(o_res) x where x = any(v_sens) order by x) then
        raise exception '不能修改资源权限里的「超级」和「会议账号管理」';
      end if;
      -- 职位：只能是 空 / 营业
      if tg_op = 'INSERT' or new.position is distinct from o_pos then
        if new.position is not null and new.position <> 'sales' then
          raise exception '部门负责人只能把老师设为职位「营业」（负责人 / 对接 / 总务请联系管理员）';
        end if;
        if tg_op = 'UPDATE' and o_pos is not null and o_pos <> 'sales' then
          raise exception '这位老师的管理职位只有管理员能改';
        end if;
      end if;
      -- 执行角色：专业课老师 / TA / 班主任
      if tg_op = 'INSERT' or new.roles is distinct from o_roles then
        if not (coalesce(new.roles, '{}'::text[]) <@ v_roles_ok) then
          raise exception '部门负责人只能设置执行角色：专业课老师 / TA / 班主任';
        end if;
      end if;
      -- 角色范围：只有 homeroom / sales 两块能改，其他块保持原样
      if (coalesce(new.role_scope, '{}'::jsonb) - 'homeroom' - 'sales') is distinct from (o_rs - 'homeroom' - 'sales') then
        raise exception '这些角色范围只有管理员能改';
      end if;
      -- 范围不能超出自己的范围（只检查新增的部分，老师原有的范围外归属原样保留）
      v_added := array(select unnest(coalesce(new.managed_by, '{}'::text[])) except select unnest(o_managed));
      if exists (select 1 from unnest(v_added) x where not (x = any(v_my))) then
        raise exception '不能把老师的隶属领域设到你的管理范围以外';
      end if;
      v_added := array(select unnest(coalesce(new.domains, '{}'::text[])) except select unnest(o_domains));
      if exists (select 1 from unnest(v_added) x where not (x = any(v_my))) then
        raise exception '不能把老师的负责领域设到你的管理范围以外';
      end if;
      v_added := array(select unnest(coalesce(new.majors, '{}'::text[])) except select unnest(o_majors));
      if not public.dept_majors_in(v_added, v_my) then
        raise exception '不能把老师的负责专业设到你的管理范围以外';
      end if;
      foreach k in array array['homeroom', 'sales'] loop
        v_added := array(
          select jsonb_array_elements_text(coalesce(new.role_scope->k->'domains', '[]'::jsonb))
          except select jsonb_array_elements_text(coalesce(o_rs->k->'domains', '[]'::jsonb)));
        if exists (select 1 from unnest(v_added) x where not (x = any(v_my))) then
          raise exception '不能把老师的班主任 / 营业范围设到你的管理范围以外';
        end if;
        v_added := array(
          select jsonb_array_elements_text(coalesce(new.role_scope->k->'majors', '[]'::jsonb))
          except select jsonb_array_elements_text(coalesce(o_rs->k->'majors', '[]'::jsonb)));
        if not public.dept_majors_in(v_added, v_my) then
          raise exception '不能把老师的班主任 / 营业范围设到你的管理范围以外';
        end if;
      end loop;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists teachers_guard_manage_cols on public.teachers;
create trigger teachers_guard_manage_cols
  before insert or update on public.teachers
  for each row execute function public.teachers_guard_manage_cols();

-- ── 4. 检查（只读）：函数都在、字段都在 ─────────────────────────
select (select count(*) from pg_proc where proname in ('dept_my_domains','can_manage','can_manage_major','dept_majors_in','dept_teacher_in_range')) as 函数数_应为5,
       (select count(*) from information_schema.columns where table_schema='public'
          and ((table_name='teachers' and column_name='dept_perms')
            or (table_name in ('price_vip_rates','price_ta_options') and column_name='domain'))) as 字段数_应为3;

-- ============================================================
-- 回滚（需要时整段执行；先执行 dept_perms_lock.sql 的回滚，再执行这里）
-- ============================================================
-- 触发器函数还原成 seed/teacher_roles_prepare.sql 里的版本（不含 dept_perms / 部门负责人那一段）：重新执行该文件第 3 节即可。
-- drop function if exists public.dept_teacher_in_range(text[], text[], text[]);
-- drop function if exists public.dept_majors_in(text[], text[]);
-- drop function if exists public.can_manage_major(text, text);
-- drop function if exists public.can_manage(text, text);
-- drop function if exists public.dept_my_domains(text);
-- alter table public.price_vip_rates  drop column if exists domain;
-- alter table public.price_ta_options drop column if exists domain;
-- alter table public.teachers drop column if exists dept_perms;
