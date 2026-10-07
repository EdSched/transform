-- 修正：managed_by / domains 是 jsonb（已执行过 dept_perms_prepare.sql 的人再执行本文件一次；可重复执行）
-- jsonb 数组 → text[]（teachers.managed_by / domains 在库里是 jsonb 数组）
create or replace function public.jsonb_text_arr(j jsonb)
returns text[]
language sql immutable
as $$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end)), '{}'::text[]);
$$;

-- 这位老师是否在「本范围老师管理」的范围内：隶属 / 负责领域 / 负责专业所属领域，只要有一个在我的范围里
drop function if exists public.dept_teacher_in_range(text[], text[], text[]);
create or replace function public.dept_teacher_in_range(p_managed jsonb, p_domains jsonb, p_majors text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.dept_my_domains('teachers') && (
    public.jsonb_text_arr(p_managed) || public.jsonb_text_arr(p_domains)
    || array(select m.domain from public.majors m where m.key = any(coalesce(p_majors, '{}'::text[])) and m.domain is not null)
  );
$$;
revoke all on function public.dept_teacher_in_range(jsonb, jsonb, text[]) from public;
grant execute on function public.dept_teacher_in_range(jsonb, jsonb, text[]) to anon, authenticated;

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
        o_managed := public.jsonb_text_arr(old.managed_by);  o_domains := public.jsonb_text_arr(old.domains);
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
      v_added := array(select unnest(public.jsonb_text_arr(new.managed_by)) except select unnest(o_managed));
      if exists (select 1 from unnest(v_added) x where not (x = any(v_my))) then
        raise exception '不能把老师的隶属领域设到你的管理范围以外';
      end if;
      v_added := array(select unnest(public.jsonb_text_arr(new.domains)) except select unnest(o_domains));
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
