-- ============================================================
-- 工作管理：「查看」和「审批发布」分开，谁都不能审批自己的工资；「教研」统一叫「教研工作」
-- 合并 PR 之前，在 Supabase SQL Editor 整份执行一次；可重复执行。回滚语句在文件最后。
--
-- 做了什么
--   1. 删掉 work_records 唯一的规则 staff_all（is_staff() 可以做任何事 = 任何老师账号都能把任何人的记录改成已通过），
--      换成按角色分开的规则：
--        管理员（is_admin()）               全部可以
--        领域访问链接                        读写自己领域（domain 在链接范围里）的记录
--        老师本人                            读：自己的全部记录
--                                           新建 / 修改 / 删除：只限 teacher_name=自己、source='declare'、
--                                           原来 status 是 pending 或 rejected，而且新的 status 只能是 pending
--        负责人（只能查看）                  读：自己管理范围（领域，专业折算成领域）内的记录；不能写
--        负责人（可以审批发布）              在查看的基础上可以新建 / 修改 / 删除范围内的记录；
--                                           但 teacher_name 不能是自己（新、旧两行都检查）
--      负责人要进「工作管理」页面开关（manage_scope.pages 没有这个键，或含 'payroll'）才算；
--      manage_scope.payroll 不等于 'approve' = 只能查看。
--   2. 判断「当前老师是谁、管理范围、payroll 权限」都写在 security definer 函数里（work_* 开头）。
--   3. work_records.work_type 里已有的「教研」改成「教研工作」。
--
-- 前提：teachers.manage_scope 字段已存在（本文件不依赖 is_teacher_manager()，负责人的判断直接写在 work_mgr_level() 里）、results_lead_scope.sql 所在的批次（majors.group_key）、
--       work_records_domain.sql（work_records.domain）。缺了会在开头报错并整份回滚，不会改到任何东西。
-- ============================================================

-- ── 执行前先看一眼（只读）：哪些负责人有「工作管理」页面权限 ────────────────────────────
-- 合并后他们全部变成「只能查看」，要给谁审批权限，在 老师管理 → 编辑 → 负责人（管理范围）→ 工作管理 里逐个打开
select t.id, t.name,
       coalesce(t.manage_scope->>'payroll', '(没设，按只能查看)') as payroll,
       t.manage_scope->'domains' as domains, t.manage_scope->'majors' as majors, t.manage_scope->'pages' as pages
  from public.teachers t
 where t.manage_scope is not null
   and (jsonb_typeof(t.manage_scope->'pages') is distinct from 'array' or t.manage_scope->'pages' ? 'payroll')
   and (
     (case when jsonb_typeof(t.manage_scope->'domains')   = 'array' then jsonb_array_length(t.manage_scope->'domains')   else 0 end) +
     (case when jsonb_typeof(t.manage_scope->'majors')    = 'array' then jsonb_array_length(t.manage_scope->'majors')    else 0 end) +
     (case when jsonb_typeof(t.manage_scope->'class_ids') = 'array' then jsonb_array_length(t.manage_scope->'class_ids') else 0 end)
   ) > 0
 order by t.name;
-- 现在的规则（应该只有一条 staff_all）
select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'work_records';

begin;

do $$
begin
  if to_regprocedure('public.is_admin()') is null or to_regprocedure('public.current_teacher_id()') is null
     or to_regprocedure('public.is_staff()') is null then
    raise exception '缺少 is_admin() / current_teacher_id() / is_staff()，请把这段发给 Claude 评估';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='teachers' and column_name='manage_scope') then
    raise exception 'teachers 没有 manage_scope 字段，请先执行 integrate_step1_prepare.sql 的第 1 步（加字段）';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='work_records' and column_name='domain') then
    raise exception 'work_records 没有 domain 字段，请先执行 work_records_domain.sql';
  end if;
end $$;

-- ── 1. 小工具函数（只返回 true/false/文字，不暴露数据）──────────────────────────────────
-- 分组展开成组内专业（和 results_lead_scope.sql 同一份定义，已存在则原样覆盖）
create or replace function public.expand_major_keys(p_keys text[])
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct k), '{}'::text[]) from (
    select unnest(coalesce(p_keys, '{}'::text[])) as k
    union
    select m.key from public.majors m where m.group_key = any(coalesce(p_keys, '{}'::text[]))
  ) s where k is not null and k <> '';
$$;
grant execute on function public.expand_major_keys(text[]) to anon, authenticated;

-- 当前登录老师的名字（不是老师 = null）
create or replace function public.work_my_name() returns text
language sql stable security definer set search_path = public as $$
  select t.name from public.teachers t where t.id = public.current_teacher_id() limit 1
$$;
grant execute on function public.work_my_name() to anon, authenticated;

-- 当前老师在「工作管理」里的级别：null = 不是负责人 / 页面没开放；'view' 只能查看；'approve' 可以审批发布
create or replace function public.work_mgr_level() returns text
language sql stable security definer set search_path = public as $$
  select case when lower(coalesce(t.manage_scope->>'payroll', '')) = 'approve' then 'approve' else 'view' end
    from public.teachers t
   where t.id = public.current_teacher_id()
     and t.manage_scope is not null
     and (
       (case when jsonb_typeof(t.manage_scope->'domains')   = 'array' then jsonb_array_length(t.manage_scope->'domains')   else 0 end) +
       (case when jsonb_typeof(t.manage_scope->'majors')    = 'array' then jsonb_array_length(t.manage_scope->'majors')    else 0 end) +
       (case when jsonb_typeof(t.manage_scope->'class_ids') = 'array' then jsonb_array_length(t.manage_scope->'class_ids') else 0 end)
     ) > 0
     and (jsonb_typeof(t.manage_scope->'pages') is distinct from 'array' or t.manage_scope->'pages' ? 'payroll')
$$;
grant execute on function public.work_mgr_level() to anon, authenticated;

-- 这个领域在不在当前负责人的管理范围里（领域，或管理范围里的专业所属领域）
create or replace function public.work_mgr_domain_match(p_domain text) returns boolean
language sql stable security definer set search_path = public as $$
  select nullif(p_domain, '') is not null and exists (
    select 1 from public.teachers t
     where t.id = public.current_teacher_id()
       and t.manage_scope is not null
       and (
         (jsonb_typeof(t.manage_scope->'domains') = 'array' and t.manage_scope->'domains' ? p_domain)
         or exists (
           select 1 from public.majors m
            where m.domain = p_domain
              and m.key = any(public.expand_major_keys(
                    coalesce((select array(select jsonb_array_elements_text(t.manage_scope->'majors')) where jsonb_typeof(t.manage_scope->'majors') = 'array'), '{}'::text[])))
         )
       )
  )
$$;
grant execute on function public.work_mgr_domain_match(text) to anon, authenticated;

-- 这个领域在不在当前「领域访问链接」的范围里（链接登录邮箱 <k>@access.local；链接没设任何范围 = 不限）
create or replace function public.work_key_domain_match(p_domain text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.access_keys a
     where a.active is true
       and coalesce(a.is_admin, false) = false
       and coalesce(auth.jwt() ->> 'email', '') like '%@access.local'
       and a.k = split_part(auth.jwt() ->> 'email', '@', 1)
       and (
         (a.domain is null and coalesce(jsonb_array_length(to_jsonb(a.domains)), 0) = 0 and coalesce(jsonb_array_length(to_jsonb(a.majors)), 0) = 0)
         or (nullif(p_domain, '') is not null and (
               a.domain = p_domain
               or to_jsonb(a.domains) ? p_domain
               or exists (select 1 from public.majors m where m.domain = p_domain and to_jsonb(a.majors) ? m.key)
             ))
       )
  )
$$;
grant execute on function public.work_key_domain_match(text) to anon, authenticated;

-- 读：管理员 / 自己的记录 / 领域链接（本领域）/ 负责人（范围内，查看或审批都行）
create or replace function public.can_read_work_record(p_teacher_name text, p_domain text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin(), false)
      or (p_teacher_name is not null and p_teacher_name = public.work_my_name())
      or public.work_key_domain_match(p_domain)
      or (public.work_mgr_level() is not null and public.work_mgr_domain_match(p_domain))
$$;
grant execute on function public.can_read_work_record(text, text) to anon, authenticated;

-- 审批发布（新建 / 修改 / 删除别人的记录）：管理员 / 领域链接（本领域）/ 负责人（审批级别 + 范围内 + 不是自己的记录）
create or replace function public.can_approve_work_record(p_teacher_name text, p_domain text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin(), false)
      or public.work_key_domain_match(p_domain)
      or (public.work_mgr_level() = 'approve'
          and public.work_mgr_domain_match(p_domain)
          and coalesce(p_teacher_name, '') <> coalesce(public.work_my_name(), ''))
$$;
grant execute on function public.can_approve_work_record(text, text) to anon, authenticated;

-- ── 2. 规则：删掉 staff_all，换成分角色的 ────────────────────────────────────────────
alter table public.work_records enable row level security;
drop policy if exists staff_all on public.work_records;

drop policy if exists wr_select      on public.work_records;
drop policy if exists wr_approve_ins on public.work_records;
drop policy if exists wr_approve_upd on public.work_records;
drop policy if exists wr_approve_del on public.work_records;
drop policy if exists wr_own_ins     on public.work_records;
drop policy if exists wr_own_upd     on public.work_records;
drop policy if exists wr_own_del     on public.work_records;

create policy wr_select on public.work_records for select
  using (public.can_read_work_record(teacher_name, domain));

-- 审批级别：新、旧两行都要通过 can_approve_work_record（using 查旧行，with check 查新行）
create policy wr_approve_ins on public.work_records for insert
  with check (public.can_approve_work_record(teacher_name, domain));
create policy wr_approve_upd on public.work_records for update
  using (public.can_approve_work_record(teacher_name, domain))
  with check (public.can_approve_work_record(teacher_name, domain));
create policy wr_approve_del on public.work_records for delete
  using (public.can_approve_work_record(teacher_name, domain));

-- 老师本人：只能动自己的申告，而且只能是「待审批」，不能改成已通过
create policy wr_own_ins on public.work_records for insert
  with check (teacher_name = public.work_my_name() and source = 'declare' and status = 'pending');
create policy wr_own_upd on public.work_records for update
  using (teacher_name = public.work_my_name() and source = 'declare' and status in ('pending', 'rejected'))
  with check (teacher_name = public.work_my_name() and source = 'declare' and status = 'pending');
create policy wr_own_del on public.work_records for delete
  using (teacher_name = public.work_my_name() and source = 'declare' and status in ('pending', 'rejected'));

-- ── 3. 「教研」统一叫「教研工作」 ─────────────────────────────────────────────────────
update public.work_records set work_type = '教研工作' where work_type = '教研';

commit;

-- 执行后检查（只读）：应该看到 wr_select / wr_approve_* / wr_own_*，没有 staff_all；没有 work_type='教研'
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'work_records' order by policyname;
select work_type, count(*) from public.work_records group by 1 order by 2 desc;

-- ============================================================
-- 回滚（需要时整段执行）：恢复 staff_all，删新规则和函数，「教研工作」改回「教研」
-- ============================================================
-- begin;
-- drop policy if exists wr_select      on public.work_records;
-- drop policy if exists wr_approve_ins on public.work_records;
-- drop policy if exists wr_approve_upd on public.work_records;
-- drop policy if exists wr_approve_del on public.work_records;
-- drop policy if exists wr_own_ins     on public.work_records;
-- drop policy if exists wr_own_upd     on public.work_records;
-- drop policy if exists wr_own_del     on public.work_records;
-- create policy staff_all on public.work_records for all using (public.is_staff()) with check (public.is_staff());
-- update public.work_records set work_type = '教研' where work_type = '教研工作';
-- drop function if exists public.can_approve_work_record(text, text);
-- drop function if exists public.can_read_work_record(text, text);
-- drop function if exists public.work_key_domain_match(text);
-- drop function if exists public.work_mgr_domain_match(text);
-- drop function if exists public.work_mgr_level();
-- drop function if exists public.work_my_name();
-- commit;
-- （expand_major_keys 是 results_lead_scope.sql 也在用的，不要删。）
