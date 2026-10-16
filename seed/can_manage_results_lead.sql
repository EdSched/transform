-- ============================================================
-- 合格实绩⑩：负责人在管理模式里，只要「合格实绩」这一页对他开放，就能看截图、补图、做海报
-- 合并 PR 之前在 Supabase SQL Editor 执行；可重复执行。
-- 前提：已执行过 seed/results_teacher_admin.sql（有 can_manage_results()）和 seed/integrate_step1_prepare.sql（manage_scope）。
--
-- 只改 can_manage_results() 这一个函数，下面这些规则自动生效（规则名、其他权限都不动）：
--   admission_results / undergrad_results 修改·删除，result_photos，私有桶 admission-private，
--   pass_posters，pass_poster_sources，univ_en_names，公开桶 posters/ 目录。
-- 现在 true 的条件（任一成立）：
--   1. is_admin()
--   2. 当前老师 permissions.result_admin 为真（原有）
--   3. 当前老师是负责人（manage_scope 的 domains / majors / class_ids 合计不为空，和 is_teacher_manager() 一致），
--      并且 manage_scope.pages 不存在（= 全部页面），或包含 'admissions'
-- ============================================================
begin;

create or replace function public.can_manage_results() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin(), false) or exists (
    select 1 from public.teachers t
     where t.id = public.current_teacher_id()
       and (
         lower(coalesce(t.permissions->>'result_admin', '')) = 'true'
         or (
           t.manage_scope is not null
           and (
             (case when jsonb_typeof(t.manage_scope->'domains')   = 'array' then jsonb_array_length(t.manage_scope->'domains')   else 0 end) +
             (case when jsonb_typeof(t.manage_scope->'majors')    = 'array' then jsonb_array_length(t.manage_scope->'majors')    else 0 end) +
             (case when jsonb_typeof(t.manage_scope->'class_ids') = 'array' then jsonb_array_length(t.manage_scope->'class_ids') else 0 end)
           ) > 0
           and (
             jsonb_typeof(t.manage_scope->'pages') is distinct from 'array'
             or t.manage_scope->'pages' ? 'admissions'
           )
         )
       )
  )
$$;
grant execute on function public.can_manage_results() to anon, authenticated;

commit;

-- ── 回滚：恢复成原来的函数定义（只认管理员或 result_admin）──
-- create or replace function public.can_manage_results() returns boolean
-- language sql stable security definer set search_path = public as $$
--   select coalesce(public.is_admin(), false) or exists (
--     select 1 from public.teachers t
--      where t.id = public.current_teacher_id()
--        and lower(coalesce(t.permissions->>'result_admin', '')) = 'true')
-- $$;
-- grant execute on function public.can_manage_results() to anon, authenticated;
