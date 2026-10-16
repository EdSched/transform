-- ============================================================
-- 合格收集页 / 合格实绩公开页：按本校专业分类  合并 PR 之前在 Supabase SQL Editor 执行；可重复执行
-- 做了什么（只加不删）：
--  1. majors / major_groups：匿名可读（只是专业名称，不敏感）。major_groups 之前已是所有人可读，这里只是确认。
--  2. admission_results / undergrad_results：新增列 entered_via（'public' = 从公开收集页提交；管理端手动录入的为空）
--     收集页提交时写 'public'，管理端据此列出「还没记录到学生档案」的记录。anon 不需要读这一列。
--  3. 确认 anon 能读 our_major 列（公开页按本校专业显示用）和 insert（匿名提交）。
--
-- 执行前建议先看现有规则（只看，不用改）：
--   select tablename, policyname, cmd, roles, qual from pg_policies where tablename in ('majors','major_groups');
-- 执行后自检（没登录、用公开 key）：
--   majors?select=key,label,domain,group_key        → 正常返回
--   major_groups?select=key,label,domain            → 正常返回
--   admission_results?select=our_major              → 正常返回
--   admission_results?select=student                → permission denied（真名仍不可读，这条不变）
-- ============================================================
begin;

-- 1. 专业清单匿名可读
grant select on public.majors to anon, authenticated;
grant select on public.major_groups to anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'majors' and cmd in ('SELECT', 'ALL')
                   and qual = 'true' and (roles && array['public', 'anon']::name[])) then
    create policy majors_public_read on public.majors for select to public using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'major_groups' and cmd in ('SELECT', 'ALL')
                   and qual = 'true' and (roles && array['public', 'anon']::name[])) then
    create policy major_groups_public_read on public.major_groups for select to public using (true);
  end if;
end $$;

-- 2. 来源标记
alter table public.admission_results add column if not exists entered_via text;   -- 'public' = 公开收集页提交
alter table public.undergrad_results add column if not exists entered_via text;
grant insert on public.admission_results to anon;
grant insert on public.undergrad_results to anon;

-- 3. 公开页按本校专业显示要读 our_major（不敏感）
grant select (our_major) on public.admission_results to anon;
grant select (our_major) on public.undergrad_results to anon;

commit;

-- ============================================================
-- 回滚（整段执行）：
-- begin;
-- drop policy if exists majors_public_read on public.majors;
-- drop policy if exists major_groups_public_read on public.major_groups;
-- alter table public.admission_results drop column if exists entered_via;
-- alter table public.undergrad_results drop column if exists entered_via;
-- commit;
-- （our_major 的列读取权限、majors 的 grant 不用回滚：本来就是公开信息）
-- ============================================================
