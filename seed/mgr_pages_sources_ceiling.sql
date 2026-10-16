-- ============================================================
-- 负责人纵向权限：①管理模式页面开关 ②学生可见范围加「来源」③老师管理只能在自己权限以内分配
-- 前提：已执行 dept_perms_prepare / dept_perms_fix_jsonb / dept_perms_lock / dept_perms_majors / dept_majors_by_group。
-- 可重复执行。整份贴进 Supabase SQL Editor 执行一次 → 再合并 PR。
--
-- 新增：
--   teachers.student_sources text[]   学生来源限制（空 = 不限）
--   teachers.leader_id text           归属负责人（teachers.id）
--   manage_scope（jsonb，不加列）新增两个键：
--     pages        : text[]，管理模式能用的页面；键不存在 = 全部（现有负责人不受影响）
--     teacher_mode : 'range'（按领域/专业，默认）| 'own'（只管归属自己的老师）
--   函数 dept_teacher_editable：老师管理范围（own 模式只看 leader_id = 我）
--   策略 tch_dept_ins / tch_dept_upd 改用它
--   触发器 teachers_guard_manage_cols：保留原有检查，再加 归属负责人 / 学生来源 / permissions 上限
-- ============================================================

alter table public.teachers add column if not exists student_sources text[] not null default '{}';
alter table public.teachers add column if not exists leader_id text;

-- 1. 辅助函数（security definer：触发器里读「我自己」的行，不受读取规则影响）
create or replace function public.dept_has_perm(p_perm text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.teachers t
                 where t.id = public.current_teacher_id() and p_perm = any(coalesce(t.dept_perms, '{}'::text[])));
$$;
revoke all on function public.dept_has_perm(text) from public;
grant execute on function public.dept_has_perm(text) to anon, authenticated;

create or replace function public.dept_my_teacher_mode()
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce((select case when t.manage_scope->>'teacher_mode' = 'own' then 'own' else 'range' end
                   from public.teachers t where t.id = public.current_teacher_id()), 'range');
$$;
revoke all on function public.dept_my_teacher_mode() from public;
grant execute on function public.dept_my_teacher_mode() to anon, authenticated;

create or replace function public.dept_my_sources()
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce((select t.student_sources from public.teachers t where t.id = public.current_teacher_id()), '{}'::text[]);
$$;
revoke all on function public.dept_my_sources() from public;
grant execute on function public.dept_my_sources() to anon, authenticated;

create or replace function public.dept_my_permissions()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce((select t.permissions from public.teachers t where t.id = public.current_teacher_id()), '{}'::jsonb);
$$;
revoke all on function public.dept_my_permissions() from public;
grant execute on function public.dept_my_permissions() to anon, authenticated;

-- 2. 老师管理范围：own 模式 = 只管归属自己的老师；否则照旧按领域 / 专业
create or replace function public.dept_teacher_editable(p_leader text, p_managed jsonb, p_domains jsonb, p_majors text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when public.dept_my_teacher_mode() = 'own'
      then public.dept_has_perm('teachers') and p_leader is not null and p_leader = public.current_teacher_id()
    else public.dept_teacher_in_range(p_managed, p_domains, p_majors)
  end;
$$;
revoke all on function public.dept_teacher_editable(text, jsonb, jsonb, text[]) from public;
grant execute on function public.dept_teacher_editable(text, jsonb, jsonb, text[]) to anon, authenticated;

-- 3. permissions 上限检查：返回第一项超出的功能名（中文），没有超出返回 null
--    布尔类：新值为真、旧值不为真时，我必须也为真；student_mgmt_items / booking_types / slot_types：新增元素我必须有；
--    schedule：false < timetable < full(true)；关掉、保持不变都允许；
--    exclude_majors / profile_skip_majors / vip_only / guaranteed_only / homework_* 这类「限制型 / 分配型」不检查
create or replace function public.dept_perm_ceiling_violation(p_new jsonb, p_old jsonb, p_mine jsonb)
returns text
language plpgsql stable
set search_path = public
as $$
declare
  k text;
  v_skip  text[] := array['exclude_majors', 'profile_skip_majors', 'vip_only', 'guaranteed_only',
                          'homework_own_sessions', 'homework_course_ids', 'homework_courses', 'vip_content'];
  v_arr   text[] := array['student_mgmt_items', 'booking_types', 'slot_types'];
  v_label jsonb := '{"booking":"面谈预约","slots":"时间槽设定","student_mgmt":"学生管理","homework":"作业批改","admission_query":"出愿数据查询",
    "promo":"宣传相关","lect_info":"讲师介绍","progress_plan":"计划书 / 志望理由书","vip_sales":"VIP 销售","promo_pack":"宣传资料包",
    "result_view":"合格实绩查询","pass_posters":"合格海报查询","result_admin":"合格实绩管理","promo_pricing":"价目查询","success_cases":"成功案例",
    "schedule":"课程表","student_mgmt_items":"学生管理的子项","booking_types":"面谈预约类型","slot_types":"时间槽类型"}'::jsonb;
  v_added text[];
  rn int; ro int; rm int;
begin
  -- 开了合格实绩管理会一起开合格海报查询：新旧都已开 result_admin 时不单独检查 pass_posters
  for k in select jsonb_object_keys(coalesce(p_new, '{}'::jsonb)) loop
    continue when k = any(v_skip);
    if k = any(v_arr) then
      if jsonb_typeof(p_new->k) = 'array' then
        v_added := array(select jsonb_array_elements_text(p_new->k)
                         except select jsonb_array_elements_text(case when jsonb_typeof(p_old->k) = 'array' then p_old->k else '[]'::jsonb end));
        if exists (select 1 from unnest(v_added) y
                   where not (y in (select jsonb_array_elements_text(case when jsonb_typeof(p_mine->k) = 'array' then p_mine->k else '[]'::jsonb end)))) then
          return coalesce(v_label->>k, k);
        end if;
      end if;
    elsif k = 'schedule' then
      rn := case when lower(coalesce(p_new->>k, '')) in ('full', 'true') then 2 when lower(coalesce(p_new->>k, '')) = 'timetable' then 1 else 0 end;
      ro := case when lower(coalesce(p_old->>k, '')) in ('full', 'true') then 2 when lower(coalesce(p_old->>k, '')) = 'timetable' then 1 else 0 end;
      rm := case when lower(coalesce(p_mine->>k, '')) in ('full', 'true') then 2 when lower(coalesce(p_mine->>k, '')) = 'timetable' then 1 else 0 end;
      if rn > ro and rn > rm then return v_label->>k; end if;
    elsif jsonb_typeof(p_new->k) in ('boolean', 'string') then
      if lower(coalesce(p_new->>k, '')) = 'true'
         and lower(coalesce(p_old->>k, '')) <> 'true'
         and lower(coalesce(p_mine->>k, '')) <> 'true'
         and not (k = 'pass_posters' and lower(coalesce(p_new->>'result_admin', '')) = 'true' and lower(coalesce(p_old->>'result_admin', '')) = 'true') then
        return coalesce(v_label->>k, k);
      end if;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.dept_perm_ceiling_violation(jsonb, jsonb, jsonb) from public;
grant execute on function public.dept_perm_ceiling_violation(jsonb, jsonb, jsonb) to anon, authenticated;

-- 4. 防提权触发器（在 dept_perms_majors.sql 的版本上加：归属负责人 / 学生来源 / permissions 上限）
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
          raise exception '部门负责人只能把老师设为职位「营业」（负责人 / 对接 / 总务请联系管理员）';
        end if;
        if tg_op = 'UPDATE' and o_pos is not null and o_pos <> 'sales' then
          raise exception '这位老师的管理职位只有管理员能改';
        end if;
      end if;
      if tg_op = 'INSERT' or new.roles is distinct from o_roles then
        if not (coalesce(new.roles, '{}'::text[]) <@ v_roles_ok) then
          raise exception '部门负责人只能设置执行角色：专业课老师 / TA / 班主任';
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

-- 5. 老师新增 / 修改的行级规则：改用 dept_teacher_editable
drop policy if exists tch_dept_ins on public.teachers;
drop policy if exists tch_dept_upd on public.teachers;
create policy tch_dept_ins on public.teachers for insert
  with check (public.dept_teacher_editable(leader_id, managed_by, domains, majors));
create policy tch_dept_upd on public.teachers for update
  using (public.dept_teacher_editable(leader_id, managed_by, domains, majors))
  with check (public.dept_teacher_editable(leader_id, managed_by, domains, majors));

-- 只读检查
select (select count(*) from information_schema.columns where table_name = 'teachers' and column_name in ('student_sources', 'leader_id')) as 新列数_应为2,
       (select count(*) from pg_proc where proname in ('dept_has_perm','dept_my_teacher_mode','dept_my_sources','dept_my_permissions','dept_teacher_editable','dept_perm_ceiling_violation')) as 函数数_应为6;

-- ============================================================
-- 回滚（整段执行；列里的数据会丢，先确认没人在用）
-- ============================================================
-- 1) 重新整份执行 seed/dept_perms_majors.sql 的第 4 段（teachers_guard_manage_cols 函数 + 触发器），恢复原版触发器
--    （注意：不要执行它的第 5 段给四位负责人开权限的 update，除非需要）
-- 2) drop policy if exists tch_dept_ins on public.teachers;
--    drop policy if exists tch_dept_upd on public.teachers;
--    create policy tch_dept_ins on public.teachers for insert with check (public.dept_teacher_in_range(managed_by, domains, majors));
--    create policy tch_dept_upd on public.teachers for update using (public.dept_teacher_in_range(managed_by, domains, majors)) with check (public.dept_teacher_in_range(managed_by, domains, majors));
-- 3) drop function if exists public.dept_teacher_editable(text, jsonb, jsonb, text[]);
--    drop function if exists public.dept_perm_ceiling_violation(jsonb, jsonb, jsonb);
--    drop function if exists public.dept_has_perm(text);
--    drop function if exists public.dept_my_teacher_mode();
--    drop function if exists public.dept_my_sources();
--    drop function if exists public.dept_my_permissions();
-- 4) alter table public.teachers drop column if exists student_sources;
--    alter table public.teachers drop column if exists leader_id;
--    update public.teachers set manage_scope = manage_scope - 'pages' - 'teacher_mode' where manage_scope is not null;
