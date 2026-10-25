-- ============================================================
-- 老师端「工资申告」：老师往 work_records 写 source='declare' 的记录
-- 先执行第 1 步看现状；若 rowsecurity = false 且没有策略 → 不需要做第 2 步。
-- ============================================================

-- 1.（只查看）work_records 有没有开 RLS、有哪些规则
select relname, relrowsecurity as rowsecurity from pg_class where oid = 'public.work_records'::regclass;
select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'work_records';

-- 2. 只有第 1 步显示已开 RLS 时才执行：老师只能新建 / 修改 / 撤回「自己的、申告、待审批或已驳回」的记录
create or replace function public.my_teacher_name()
returns text language sql security definer set search_path = public stable as $$
  select t.name from public.teachers t where t.id = public.current_teacher_id() limit 1
$$;
revoke all on function public.my_teacher_name() from public;
grant execute on function public.my_teacher_name() to anon, authenticated;

drop policy if exists wr_declare_insert on public.work_records;
create policy wr_declare_insert on public.work_records for insert to authenticated
  with check (source = 'declare' and status = 'pending' and teacher_name = public.my_teacher_name());

drop policy if exists wr_declare_update on public.work_records;
create policy wr_declare_update on public.work_records for update to authenticated
  using (source = 'declare' and status in ('pending','rejected') and teacher_name = public.my_teacher_name())
  with check (source = 'declare' and status = 'pending' and teacher_name = public.my_teacher_name());

drop policy if exists wr_declare_delete on public.work_records;
create policy wr_declare_delete on public.work_records for delete to authenticated
  using (source = 'declare' and status = 'pending' and teacher_name = public.my_teacher_name());

-- 老师读自己的记录（原来老师端就读得到则这条重复也无妨）
drop policy if exists wr_teacher_select on public.work_records;
create policy wr_teacher_select on public.work_records for select to authenticated
  using (teacher_name = public.my_teacher_name());

-- ── 回滚 ──
-- drop policy if exists wr_declare_insert on public.work_records;
-- drop policy if exists wr_declare_update on public.work_records;
-- drop policy if exists wr_declare_delete on public.work_records;
-- drop policy if exists wr_teacher_select on public.work_records;
-- drop function if exists public.my_teacher_name();
