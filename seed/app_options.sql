-- ============================================================
-- 选项设置：管理职位 / 执行角色 可新增自定义名称；学生来源改为管理员可增删改
-- 前提：已执行 mgr_pages_sources_ceiling.sql（本文件重建其中的 teachers_guard_manage_cols）。可重复执行。
-- 整份贴进 Supabase SQL Editor 执行一次 → 再合并 PR。
--
-- 1) app_options 表：kind = teacher_position / teacher_role / student_source
--    职位/角色：内置项 key 沿用代码值（lead / sales / senmon …），自定义项 key = 'c_' + 随机串（teachers.position / roles 存的就是 key）
--    来源：key = label = 文字本身（students.source / teachers.student_sources 存的就是文字）
-- 2) RLS：读 = is_admin() or is_staff()；写 = is_admin()
-- 3) rename_student_source(old, new)：一个事务里改选项 + 全部学生来源 + 老师来源限制
-- 4) 触发器 teachers_guard_manage_cols：负责人保存下属时，对方已有的自定义角色（没改动）不再被拦；只拦「新加」的
-- ============================================================

create table if not exists public.app_options (
  kind    text not null check (kind in ('teacher_position','teacher_role','student_source')),
  key     text not null,
  label   text not null,
  sort    int  not null default 0,
  builtin boolean not null default false,
  active  boolean not null default true,
  primary key (kind, key)
);

insert into public.app_options (kind, key, label, sort, builtin) values
  ('teacher_position','lead','负责人',1,true),
  ('teacher_position','sales','营业',2,true),
  ('teacher_position','liaison','对接',3,true),
  ('teacher_position','soumu','总务',4,true),
  ('teacher_position','soumu_asst','总务助理',5,true),
  ('teacher_role','senmon','专业课老师',1,true),
  ('teacher_role','ta','TA',2,true),
  ('teacher_role','homeroom','班主任',3,true),
  ('student_source','唯新','唯新',1,false),
  ('student_source','新世界','新世界',2,false),
  ('student_source','校内塾','校内塾',3,false),
  ('student_source','杭州校','杭州校',4,false)
on conflict (kind, key) do nothing;

alter table public.app_options enable row level security;
drop policy if exists "app_options read"  on public.app_options;
drop policy if exists "app_options write" on public.app_options;
create policy "app_options read"  on public.app_options for select using (public.is_admin() or public.is_staff());
create policy "app_options write" on public.app_options for all
  using (public.is_admin()) with check (public.is_admin());

-- 改来源名：返回 {students: 改了几个学生, teachers: 改了几位老师}
create or replace function public.rename_student_source(p_old text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_st int; n_tc int;
begin
  if not public.is_admin() then raise exception '只有管理员能改来源名称'; end if;
  p_new := btrim(coalesce(p_new, ''));
  if p_new = '' then raise exception '新名称不能为空'; end if;
  if p_new = p_old then return jsonb_build_object('students', 0, 'teachers', 0); end if;
  if not exists (select 1 from public.app_options where kind = 'student_source' and key = p_old) then
    raise exception '找不到来源：%', p_old;
  end if;
  if exists (select 1 from public.app_options where kind = 'student_source' and key = p_new) then
    raise exception '已经有叫「%」的来源', p_new;
  end if;
  update public.app_options set key = p_new, label = p_new where kind = 'student_source' and key = p_old;
  update public.students set source = p_new where source = p_old;
  get diagnostics n_st = row_count;
  update public.teachers set student_sources = array_replace(student_sources, p_old, p_new) where p_old = any(student_sources);
  get diagnostics n_tc = row_count;
  return jsonb_build_object('students', n_st, 'teachers', n_tc);
end;
$$;
revoke all on function public.rename_student_source(text, text) from public;
grant execute on function public.rename_student_source(text, text) to authenticated;

-- 触发器：在 mgr_pages_sources_ceiling.sql 的版本上，只改「执行角色」检查为只拦新加的
create or replace function public.teachers_guard_manage_cols()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_my       text[];
  v_mym      text[];
  v_sens     text[] := array['manage', 'account_manage'];
  v_roles_ok text[] := array['senmon', 'ta', 'homeroom'];
  o_managed  text[] := '{}';
  o_domains  text[] := '{}';
  o_majors   text[] := '{}';
  o_res      text[] := '{}';
  o_roles    text[] := '{}';
  o_pos      text;
  o_rs       jsonb  := '{}'::jsonb;
  v_added    text[];
  v_tm       text[];
  k          text;
  v_own      boolean;
  v_mysrc    text[];
  v_bad      text;
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT' then
      if coalesce(array_length(new.dept_perms, 1), 0) > 0 then
        raise exception '只有管理员能设置部门管理权限';
      end if;
    elsif new.dept_perms is distinct from old.dept_perms then
      raise exception '只有管理员能修改部门管理权限';
    end if;

    v_my  := public.dept_my_domains('teachers');
    v_mym := public.dept_my_majors('teachers');
    v_own := public.dept_my_teacher_mode() = 'own' and public.dept_has_perm('teachers');
    if coalesce(array_length(v_my, 1), 0) = 0 and coalesce(array_length(v_mym, 1), 0) = 0 and not v_own then
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
      if tg_op = 'INSERT' then
        if new.leader_id is not null or coalesce(array_length(new.student_sources, 1), 0) > 0 then
          raise exception '只有管理员能设置归属负责人和学生来源';
        end if;
      elsif new.leader_id is distinct from old.leader_id or new.student_sources is distinct from old.student_sources then
        raise exception '只有管理员能修改归属负责人和学生来源';
      end if;
    else
      -- ── 有「本范围老师管理」的负责人 ──
      if tg_op = 'UPDATE' then
        o_managed := public.jsonb_text_arr(old.managed_by);  o_domains := public.jsonb_text_arr(old.domains);
        o_majors  := coalesce(old.majors, '{}');      o_res     := coalesce(old.resource_perms, '{}');
        o_roles   := coalesce(old.roles, '{}');       o_pos     := old.position;
        o_rs      := coalesce(old.role_scope, '{}'::jsonb);
      end if;
      if (tg_op = 'INSERT' and new.manage_scope is not null)
         or (tg_op = 'UPDATE' and new.manage_scope is distinct from old.manage_scope) then
        raise exception '只有管理员能设置负责人范围';
      end if;
      if array(select y from unnest(coalesce(new.resource_perms, '{}'::text[])) y where y = any(v_sens) order by y)
         is distinct from array(select y from unnest(o_res) y where y = any(v_sens) order by y) then
        raise exception '不能修改资源权限里的「超级」和「会议账号管理」';
      end if;
      if tg_op = 'INSERT' or new.position is distinct from o_pos then
        if new.position is not null and new.position <> 'sales' then
          raise exception '部门负责人只能把老师设为职位「营业」（负责人 / 对接 / 总务 / 自定义职位请联系管理员）';
        end if;
        if tg_op = 'UPDATE' and o_pos is not null and o_pos <> 'sales' then
          raise exception '这位老师的管理职位只有管理员能改';
        end if;
      end if;
      if tg_op = 'INSERT' or new.roles is distinct from o_roles then
        -- 只拦「新加」的：对方已有的自定义角色（管理员设的）没改动就放行
        if not (array(select unnest(coalesce(new.roles, '{}'::text[])) except select unnest(o_roles)) <@ v_roles_ok) then
          raise exception '部门负责人只能新增执行角色：专业课老师 / TA / 班主任（自定义角色只有管理员能新增）';
        end if;
      end if;
      if (coalesce(new.role_scope, '{}'::jsonb) - 'homeroom' - 'sales') is distinct from (o_rs - 'homeroom' - 'sales') then
        raise exception '这些角色范围只有管理员能改';
      end if;

      -- 范围不能超出自己的范围（只检查新增的部分，老师原有的范围外归属原样保留）
      v_tm := coalesce(new.majors, '{}'::text[]);
      -- 隶属领域 / 负责领域：在我的领域里；或是我某个负责专业所属的领域，并且这位老师有专业、
      -- 且在该领域下的专业全部在我的专业里（不允许只选领域不选专业——那等于能看全部）
      v_added := array(select unnest(public.jsonb_text_arr(new.managed_by)) except select unnest(o_managed));
      if not public.dept_domains_ok(v_added, v_my, v_mym, v_tm) then
        raise exception '不能把老师的隶属领域设到你的管理范围以外';
      end if;
      v_added := array(select unnest(public.jsonb_text_arr(new.domains)) except select unnest(o_domains));
      if not public.dept_domains_ok(v_added, v_my, v_mym, v_tm) then
        raise exception '不能把老师的负责领域设到你的管理范围以外';
      end if;
      v_added := array(select unnest(coalesce(new.majors, '{}'::text[])) except select unnest(o_majors));
      if not public.dept_majors_in_scope(v_added, v_my, v_mym) then
        raise exception '不能把老师的负责专业设到你的管理范围以外';
      end if;
      foreach k in array array['homeroom', 'sales'] loop
        v_added := array(
          select jsonb_array_elements_text(coalesce(new.role_scope->k->'domains', '[]'::jsonb))
          except select jsonb_array_elements_text(coalesce(o_rs->k->'domains', '[]'::jsonb)));
        if exists (select 1 from unnest(v_added) y where not (y = any(v_my))) then
          raise exception '不能把老师的班主任 / 营业范围设到你的管理范围以外';
        end if;
        v_added := array(
          select jsonb_array_elements_text(coalesce(new.role_scope->k->'majors', '[]'::jsonb))
          except select jsonb_array_elements_text(coalesce(o_rs->k->'majors', '[]'::jsonb)));
        if not public.dept_majors_in_scope(v_added, v_my, v_mym) then
          raise exception '不能把老师的班主任 / 营业范围设到你的管理范围以外';
        end if;
      end loop;

      -- ① 归属负责人：只能是自己，或保持不变；新建时没填 = 自己
      if tg_op = 'INSERT' then
        if new.leader_id is null then new.leader_id := public.current_teacher_id(); end if;
        if new.leader_id is distinct from public.current_teacher_id() then
          raise exception '归属负责人只能设成你自己';
        end if;
      elsif new.leader_id is distinct from old.leader_id and new.leader_id is distinct from public.current_teacher_id() then
        raise exception '归属负责人只能设成你自己，或保持不变';
      end if;

      -- ② 学生来源：我有来源限制时，对方必须不为空并且是我的子集；新建时没填 = 我的来源
      v_mysrc := public.dept_my_sources();
      if coalesce(array_length(v_mysrc, 1), 0) > 0 then
        if tg_op = 'INSERT' and coalesce(array_length(new.student_sources, 1), 0) = 0 then
          new.student_sources := v_mysrc;
        end if;
        if tg_op = 'INSERT' or new.student_sources is distinct from old.student_sources then
          if coalesce(array_length(new.student_sources, 1), 0) = 0 then
            raise exception '你有学生来源限制，老师的学生来源不能留空（不限）';
          end if;
          if not (new.student_sources <@ v_mysrc) then
            raise exception '老师的学生来源不能超出你自己的来源（%）', array_to_string(v_mysrc, '、');
          end if;
        end if;
      end if;

      -- ③ 老师端功能（permissions）不能高于自己
      v_bad := public.dept_perm_ceiling_violation(
        coalesce(new.permissions, '{}'::jsonb),
        case when tg_op = 'UPDATE' then coalesce(old.permissions, '{}'::jsonb) else '{}'::jsonb end,
        public.dept_my_permissions());
      if v_bad is not null then
        raise exception '不能给老师开你自己没有的功能：%', v_bad;
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists teachers_guard_manage_cols on public.teachers;
create trigger teachers_guard_manage_cols
  before insert or update on public.teachers
  for each row execute function public.teachers_guard_manage_cols();

-- 只读检查
select (select count(*) from public.app_options) as 选项数_应为12,
       (select count(*) from pg_proc where proname = 'rename_student_source') as 函数数_应为1;

-- ============================================================
-- 回滚（整段执行）
-- ============================================================
-- 1) 重新整份执行 seed/mgr_pages_sources_ceiling.sql 的第 4 段（teachers_guard_manage_cols 函数 + 触发器），恢复原版触发器
--    （先把 teachers 里用了自定义职位 / 角色的老师改回内置项，否则负责人保存他们时会被拦）
-- 2) drop function if exists public.rename_student_source(text, text);
-- 3) drop table if exists public.app_options;
