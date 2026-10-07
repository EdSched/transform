-- 角色统合 · 准备 SQL（PR ①）：给 teachers 加 管理职位 / 执行角色 / 角色范围 三个字段，建 role_templates 表
-- 执行顺序：① 本文件 → ② seed/teacher_roles_assign.sql → ③ （可选）seed/teacher_cleanup.sql → 合并 PR
-- 可以重复执行；回滚见文件末尾

-- ── 1. teachers 新字段 ──
alter table public.teachers add column if not exists position text;                        -- lead / sales / liaison / soumu / soumu_asst / null
alter table public.teachers add column if not exists roles text[] not null default '{}';   -- senmon / ta / homeroom
alter table public.teachers add column if not exists role_scope jsonb;                      -- 例：{"homeroom":{"class_ids":[...]}}

-- ── 2. 角色模板表（默认功能存这里，中枢里可以调） ──
create table if not exists public.role_templates (
  key text primary key, label text not null, kind text not null,   -- kind: position / role
  defaults jsonb not null, sort int default 0, updated_at timestamptz default now()
);
alter table public.role_templates enable row level security;
-- 读取规则必须包含 is_admin()：网页写入时会把新行读回来显示（return=representation），读取规则不含 is_admin() 会被判成违规（42501）
drop policy if exists rt_read  on public.role_templates;
drop policy if exists rt_write on public.role_templates;
create policy rt_read  on public.role_templates for select using (public.is_admin() or public.is_staff());
create policy rt_write on public.role_templates for all    using (public.is_admin()) with check (public.is_admin());

-- 8 个角色的默认功能（和 seed/role_templates_seed.json 一致；已经存在的不覆盖）
insert into public.role_templates (key, label, kind, defaults, sort) values
  ('lead', '负责人', 'position', $j${"permissions":{"student_mgmt":true,"student_mgmt_items":["progress","meetings","records_view","records_entry","monthly","profile","profile_edit"],"admission_query":true},"resource_perms":["board","conflict","course","course_audit","course_view","entry_room","meeting_view","timetable"],"tags":[],"see_all_students":false,"see_all_admission":false,"needs_manage_scope":true}$j$::jsonb, 1),
  ('sales', '营业', 'position', $j${"permissions":{"student_mgmt":true,"student_mgmt_items":["progress","meetings","profile"],"admission_query":true,"promo":true,"progress_plan":true,"lect_info":true,"vip_sales":true,"promo_pack":true,"promo_pricing":true,"success_cases":true},"resource_perms":["board","course_view","entry_room","meeting_arrange","meeting_view","timetable"],"tags":[],"see_all_students":true,"see_all_admission":true,"needs_manage_scope":false}$j$::jsonb, 2),
  ('liaison', '对接', 'position', $j${"permissions":{"student_mgmt":true,"student_mgmt_items":["progress","meetings","records_view","records_entry","monthly","profile","profile_edit"]},"resource_perms":["board","course_view"],"tags":[],"see_all_students":true,"see_all_admission":false,"needs_manage_scope":false}$j$::jsonb, 3),
  ('soumu', '总务', 'position', $j${"permissions":{},"resource_perms":["account_manage","approve","assign","board","conflict","course_view","entry_room","entry_room_full","meeting_arrange","meeting_view","occupy","room_manage"],"tags":[],"see_all_students":false,"see_all_admission":false,"needs_manage_scope":false}$j$::jsonb, 4),
  ('soumu_asst', '总务助理', 'position', $j${"permissions":{},"resource_perms":["board","course_view","entry_room","meeting_arrange","meeting_view","timetable"],"tags":[],"see_all_students":false,"see_all_admission":false,"needs_manage_scope":false}$j$::jsonb, 5),
  ('senmon', '专业课老师', 'role', $j${"permissions":{"booking":true,"booking_types":["vip"],"slots":true,"slot_types":["vip"],"schedule":"timetable","student_mgmt":true,"student_mgmt_items":["progress","meetings"],"homework":true},"resource_perms":["board","course_view"],"tags":["专业课老师"],"see_all_students":false,"see_all_admission":false,"needs_manage_scope":false}$j$::jsonb, 6),
  ('ta', 'TA', 'role', $j${"permissions":{"booking":true,"booking_types":["daily","plan","mock"],"slots":true,"slot_types":["daily","plan","mock"],"student_mgmt":true,"student_mgmt_items":["progress","meetings","records_view","records_entry","profile","profile_edit"],"admission_query":true},"resource_perms":["board","course_view"],"tags":[],"see_all_students":false,"see_all_admission":false,"needs_manage_scope":false}$j$::jsonb, 7),
  ('homeroom', '班主任', 'role', $j${"permissions":{"booking":true,"booking_types":["daily","plan","mock"],"slots":true,"slot_types":["daily","plan","mock"],"student_mgmt":true,"student_mgmt_items":["progress","meetings","records_view","records_entry","monthly","profile","profile_edit"]},"resource_perms":["board","course_view","timetable"],"tags":[],"see_all_students":false,"see_all_admission":false,"needs_manage_scope":false}$j$::jsonb, 8)
on conflict (key) do nothing;

-- ── 3. 防提权：position / roles / role_scope 只有管理员能改 ──
-- 在原来的 teachers_guard_manage_cols（manage_scope / resource_perms）上加三个字段；只管 anon / authenticated，在 SQL Editor（postgres）里手动改不受影响
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
  end if;
  return new;
end;
$$;
-- 触发器本身 seed/integrate_step1_prepare.sql 里已经建过；这里确认一下还在
drop trigger if exists teachers_guard_manage_cols on public.teachers;
create trigger teachers_guard_manage_cols
  before insert or update on public.teachers
  for each row execute function public.teachers_guard_manage_cols();

-- ============================================================
-- 回滚（需要时整段执行）
-- ============================================================
-- 先把触发器函数恢复成只管 manage_scope / resource_perms 的旧版：
-- create or replace function public.teachers_guard_manage_cols() returns trigger language plpgsql set search_path = public as $$
-- begin
--   if current_user in ('anon', 'authenticated') and not public.is_admin() then
--     if tg_op = 'INSERT' then
--       if new.manage_scope is not null or coalesce(array_length(new.resource_perms, 1), 0) > 0 then
--         raise exception '只有管理员能设置负责人范围和资源权限';
--       end if;
--     elsif new.manage_scope is distinct from old.manage_scope or new.resource_perms is distinct from old.resource_perms then
--       raise exception '只有管理员能修改负责人范围和资源权限';
--     end if;
--   end if;
--   return new;
-- end; $$;
-- drop table if exists public.role_templates;
-- alter table public.teachers drop column if exists position;
-- alter table public.teachers drop column if exists roles;
-- alter table public.teachers drop column if exists role_scope;
