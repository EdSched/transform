-- ============================================================
-- 部门管理权限 · 读写规则（PR ②，合并 PR 之后执行；可重复执行）
-- 前提：已执行 dept_perms_prepare.sql。
--
-- 做了什么：
--   price_packages / price_vip_rates / price_ta_options 写入 = is_admin() or can_manage('pricing', domain)
--       （VIP / TA 的 domain 为空 = 通用项，只有管理员能改；原来「任何负责人都能写」的口子收紧了）
--   majors：在原有规则之外，加 can_manage('majors', domain) 的新增 / 修改 / 删除
--   promo_content / promo_videos / success_cases：现有规则 or can_manage('promo', 专业所属领域)
--   teachers：在原有规则之外，加「范围内老师」的新增 / 修改（can_manage('teachers')，细则由触发器管）
--   所有读取规则保留 is_admin()（网页写入后会把新行读回来，读取规则不含 is_admin() 会被判违规）。
-- ============================================================

-- ── 0. 只读：执行前看一眼现在这些表的规则（不用发给我，只是留底）──
select tablename, policyname, cmd, qual, with_check from pg_policies
where schemaname = 'public'
  and tablename in ('price_packages','price_vip_rates','price_ta_options','majors','promo_content','promo_videos','success_cases','teachers')
order by tablename, policyname;
select relname, relrowsecurity as 已开启RLS from pg_class
where relnamespace = 'public'::regnamespace and relname in ('majors','teachers','price_packages','price_vip_rates','price_ta_options','promo_content','promo_videos','success_cases');

-- ── 1. 价目三张表：写入规则整体换掉（读取规则不动）──
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('price_packages','price_vip_rates','price_ta_options') and cmd <> 'SELECT'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;
create policy pp_write on public.price_packages   for all
  using (public.is_admin() or public.can_manage('pricing', domain))
  with check (public.is_admin() or public.can_manage('pricing', domain));
create policy pv_write on public.price_vip_rates  for all
  using (public.is_admin() or public.can_manage('pricing', domain))
  with check (public.is_admin() or public.can_manage('pricing', domain));
create policy pt_write on public.price_ta_options for all
  using (public.is_admin() or public.can_manage('pricing', domain))
  with check (public.is_admin() or public.can_manage('pricing', domain));

-- ── 2. 专业：新增规则（和原有规则并列，满足任一条即可）──
drop policy if exists mj_dept_ins on public.majors;
drop policy if exists mj_dept_upd on public.majors;
drop policy if exists mj_dept_del on public.majors;
create policy mj_dept_ins on public.majors for insert with check (public.can_manage('majors', domain));
create policy mj_dept_upd on public.majors for update using (public.can_manage('majors', domain)) with check (public.can_manage('majors', domain));
create policy mj_dept_del on public.majors for delete using (public.can_manage('majors', domain));

-- ── 3. 宣传：现有规则 + can_manage('promo', 该专业所属领域) ──
drop policy if exists pc2_write on public.promo_content;
create policy pc2_write on public.promo_content for all
  using (public.is_admin() or public.is_domain_key() or public.can_manage_major('promo', major))
  with check (public.is_admin() or public.is_domain_key() or public.can_manage_major('promo', major));
drop policy if exists pv_write on public.promo_videos;
create policy pv_write on public.promo_videos for all
  using (public.is_admin() or public.is_domain_key() or public.can_manage_major('promo', major))
  with check (public.is_admin() or public.is_domain_key() or public.can_manage_major('promo', major));
drop policy if exists sc_write on public.success_cases;
create policy sc_write on public.success_cases for all
  using (public.is_admin() or public.current_teacher_id() is not null or public.is_domain_key() or public.can_manage('promo', domain))
  with check (public.is_admin() or public.current_teacher_id() is not null or public.is_domain_key() or public.can_manage('promo', domain));

-- ── 4. 老师：范围内新增 / 修改（新增规则，和原有规则并列；字段细则在触发器里）──
drop policy if exists tch_dept_ins on public.teachers;
drop policy if exists tch_dept_upd on public.teachers;
create policy tch_dept_ins on public.teachers for insert
  with check (public.dept_teacher_in_range(managed_by, domains, majors));
create policy tch_dept_upd on public.teachers for update
  using (public.dept_teacher_in_range(managed_by, domains, majors))
  with check (public.dept_teacher_in_range(managed_by, domains, majors));

-- ============================================================
-- 回滚（整段执行）
-- ============================================================
-- drop policy if exists tch_dept_ins on public.teachers;
-- drop policy if exists tch_dept_upd on public.teachers;
-- drop policy if exists mj_dept_ins on public.majors;
-- drop policy if exists mj_dept_upd on public.majors;
-- drop policy if exists mj_dept_del on public.majors;
-- drop policy if exists pc2_write on public.promo_content;
-- create policy pc2_write on public.promo_content for all using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
-- drop policy if exists pv_write on public.promo_videos;
-- create policy pv_write on public.promo_videos for all using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
-- drop policy if exists sc_write on public.success_cases;
-- create policy sc_write on public.success_cases for all using (is_admin() or current_teacher_id() is not null or is_domain_key()) with check (is_admin() or current_teacher_id() is not null or is_domain_key());
-- drop policy if exists pp_write on public.price_packages;   create policy pp_write on public.price_packages   for all using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
-- drop policy if exists pv_write on public.price_vip_rates;  create policy pv_write on public.price_vip_rates  for all using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
-- drop policy if exists pt_write on public.price_ta_options; create policy pt_write on public.price_ta_options for all using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
