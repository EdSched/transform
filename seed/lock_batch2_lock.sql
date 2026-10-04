-- ============================================================
-- 数据库上锁 第 2 批 · 第 ③ 步：上锁（合并 PR 并测试新代码之后执行）
-- 涉及 8 张表：access_keys / admission_results / undergrad_results / salary_bookings /
--             promo_content / course_schedule_shares / course_sessions / teacher_school_shares
-- 整个文件一次性执行；任何一步的前置检查不通过会整体回滚、什么都不改。
-- 前提：已执行 lock_batch2_prepare.sql，第 1 批的 is_admin()/is_staff()/is_domain_key() 存在。
-- ============================================================

begin;

-- ── 前置检查 1：触发器函数（非 security definer）如果会写入/读取这些表，匿名身份触发时会被拦住 ──
do $$
declare r record; bad text := '';
begin
  for r in
    select distinct t.tgrelid::regclass::text as on_table, p.proname
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal
      and not p.prosecdef
      and p.prosrc ~* '(access_keys|admission_results|undergrad_results|salary_bookings|promo_content|course_schedule_shares|course_sessions|teacher_school_shares)'
  loop
    bad := bad || format(E'\n  表 %s 上的触发器函数 %s()', r.on_table, r.proname);
  end loop;
  if bad <> '' then
    raise exception E'发现非 security definer 的触发器函数引用了本批的表，请先把结果发给 Claude 评估（不要强行上锁）：%', bad;
  end if;
end $$;

-- ── 前置检查 2：其他读 access_keys 的函数必须是 security definer（否则锁表后会读空）──
do $$
declare r record; bad text := '';
begin
  for r in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and not p.prosecdef and p.prokind = 'f'
      and p.prosrc ~* 'access_keys'
  loop
    bad := bad || format(E'\n  函数 %s()', r.proname);
  end loop;
  if bad <> '' then
    raise exception E'这些函数读取 access_keys 但不是 security definer，请先处理：%', bad;
  end if;
end $$;

-- ── 清掉这 8 张表上所有旧规则（含 public all sessions / anon update 等），再按下面重建 ──
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('access_keys','admission_results','undergrad_results','salary_bookings',
                        'promo_content','course_schedule_shares','course_sessions','teacher_school_shares')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ── A. access_keys：只有管理员能读写（登录前改走 rpc/resolve_access_key）──
alter table public.access_keys enable row level security;
create policy ak_admin on public.access_keys for all
  using (is_admin()) with check (is_admin());

-- ── B. 合格实绩：读/新增 所有人；改/删 管理员或领域链接 ──
alter table public.admission_results enable row level security;
create policy ar_read   on public.admission_results for select using (true);
create policy ar_insert on public.admission_results for insert with check (true);
create policy ar_update on public.admission_results for update
  using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
create policy ar_delete on public.admission_results for delete
  using (is_admin() or is_domain_key());

alter table public.undergrad_results enable row level security;
create policy ur_read   on public.undergrad_results for select using (true);
create policy ur_insert on public.undergrad_results for insert with check (true);
create policy ur_update on public.undergrad_results for update
  using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
create policy ur_delete on public.undergrad_results for delete
  using (is_admin() or is_domain_key());

-- ── C. 领工资预约：新增 所有人；读/改/删 只有管理员（预约页走函数）──
alter table public.salary_bookings enable row level security;
create policy sb_insert on public.salary_bookings for insert with check (true);
create policy sb_select on public.salary_bookings for select using (is_admin());
create policy sb_update on public.salary_bookings for update using (is_admin()) with check (is_admin());
create policy sb_delete on public.salary_bookings for delete using (is_admin());

-- ── D. 对外宣传页 / 登录前要读的表：读 所有人 ──
alter table public.promo_content enable row level security;
create policy pc2_read  on public.promo_content for select using (true);
create policy pc2_write on public.promo_content for all
  using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());

alter table public.course_schedule_shares enable row level security;
create policy css_read  on public.course_schedule_shares for select using (true);
create policy css_write on public.course_schedule_shares for all
  using (is_staff()) with check (is_staff());

alter table public.course_sessions enable row level security;
create policy cs_read  on public.course_sessions for select using (true);
create policy cs_write on public.course_sessions for all
  using (is_staff()) with check (is_staff());

alter table public.teacher_school_shares enable row level security;
create policy tss_read  on public.teacher_school_shares for select using (true);
create policy tss_write on public.teacher_school_shares for all
  using (is_staff()) with check (is_staff());

commit;

-- ============================================================
-- 撤销（出问题时整段执行，回到上锁前的状态）
-- ============================================================
-- begin;
-- alter table public.access_keys            disable row level security;
-- alter table public.salary_bookings        disable row level security;
-- alter table public.promo_content          disable row level security;
-- alter table public.course_schedule_shares disable row level security;
-- alter table public.course_sessions        disable row level security;
-- alter table public.teacher_school_shares  disable row level security;
-- -- 合格实绩原来是「开着 RLS + 全放行」，恢复成原样：
-- do $$ declare r record; begin
--   for r in select tablename, policyname from pg_policies where schemaname='public' and tablename in ('admission_results','undergrad_results')
--   loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop; end $$;
-- create policy "public read"  on public.admission_results for select using (true);
-- create policy "anon insert"  on public.admission_results for insert with check (true);
-- create policy "anon delete"  on public.admission_results for delete using (true);
-- create policy "anon update"  on public.admission_results for update using (true);
-- create policy "public read"  on public.undergrad_results for select using (true);
-- create policy "anon insert"  on public.undergrad_results for insert with check (true);
-- create policy "anon delete"  on public.undergrad_results for delete using (true);
-- create policy "anon update"  on public.undergrad_results for update using (true);
-- commit;
