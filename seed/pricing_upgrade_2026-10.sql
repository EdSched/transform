-- 价目升级（2026-10）：套餐加「领域」和「对应专业」；价目只有管理员能改；只有勾了「课程方案（含价格）」的营业老师能读
-- 先确认这几个函数存在（应返回 3 行）：
--    select proname from pg_proc where proname in ('is_admin','current_teacher_id','is_domain_key');

-- 1) 套餐加字段
alter table public.price_packages add column if not exists domain text;
alter table public.price_packages add column if not exists majors text[] not null default '{}';
update public.price_packages set domain = track where domain is null and track in ('学部理科','学部文科','大学院文科','大学院理科');

-- 2) 判断函数（security definer：绕过 teachers 表自己的行级保护，只返回 true/false）
create or replace function public.can_see_pricing() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin(), false) or exists (
    select 1 from public.teachers t
    where t.id = public.current_teacher_id()
      and coalesce(t.permissions->>'promo_pricing', '') = 'true'
  );
$$;
create or replace function public.current_teacher_name() returns text
language sql stable security definer set search_path = public as $$
  select t.name from public.teachers t where t.id = public.current_teacher_id();
$$;
grant execute on function public.can_see_pricing() to anon, authenticated;
grant execute on function public.current_teacher_name() to anon, authenticated;

-- 3) 权限收紧
drop policy if exists pp_read  on public.price_packages;   drop policy if exists pp_write  on public.price_packages;
drop policy if exists pv_read  on public.price_vip_rates;  drop policy if exists pv_write  on public.price_vip_rates;
drop policy if exists pt_read  on public.price_ta_options; drop policy if exists pt_write  on public.price_ta_options;
drop policy if exists sp_all   on public.sales_plans;

create policy pp_read  on public.price_packages   for select using (public.can_see_pricing());
create policy pp_write on public.price_packages   for all    using (public.is_admin()) with check (public.is_admin());
create policy pv_read  on public.price_vip_rates  for select using (public.can_see_pricing());
create policy pv_write on public.price_vip_rates  for all    using (public.is_admin()) with check (public.is_admin());
create policy pt_read  on public.price_ta_options for select using (public.can_see_pricing());
create policy pt_write on public.price_ta_options for all    using (public.is_admin()) with check (public.is_admin());
-- 方案：管理员全部；老师只能读写自己建的（created_by 存的是老师姓名），并且要有 promo_pricing 权限
create policy sp_all   on public.sales_plans      for all
  using      (public.is_admin() or (public.can_see_pricing() and created_by = public.current_teacher_name()))
  with check (public.is_admin() or (public.can_see_pricing() and created_by = public.current_teacher_name()));

-- ── 回滚（恢复成升级前的策略；新增的两列和两个函数留着无害，不删）──
-- drop policy if exists pp_read on public.price_packages;   drop policy if exists pp_write on public.price_packages;
-- drop policy if exists pv_read on public.price_vip_rates;  drop policy if exists pv_write on public.price_vip_rates;
-- drop policy if exists pt_read on public.price_ta_options; drop policy if exists pt_write on public.price_ta_options;
-- drop policy if exists sp_all  on public.sales_plans;
-- create policy pp_read  on public.price_packages   for select using (is_admin() or current_teacher_id() is not null or is_domain_key());
-- create policy pp_write on public.price_packages   for all    using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
-- create policy pv_read  on public.price_vip_rates  for select using (is_admin() or current_teacher_id() is not null or is_domain_key());
-- create policy pv_write on public.price_vip_rates  for all    using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
-- create policy pt_read  on public.price_ta_options for select using (is_admin() or current_teacher_id() is not null or is_domain_key());
-- create policy pt_write on public.price_ta_options for all    using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
-- create policy sp_all   on public.sales_plans      for all    using (is_admin() or current_teacher_id() is not null) with check (is_admin() or current_teacher_id() is not null);
