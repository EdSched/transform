-- ============================================================
-- 分组负责人可以在自己的分组里新建 / 修改 / 删除专业（可重复执行）
-- 前提：已执行 dept_perms_prepare.sql / dept_perms_fix_jsonb.sql / dept_perms_lock.sql / major_groups.sql。
-- 例：张云峰 = 负责人，管理范围 = 专业「生命科学」分组（不选领域），部门管理权限 = 专业增删。
-- 同时：部门管理权限不再要求职位 = 负责人（只要有管理范围 + 管理员给开了 dept_perms 就生效；dept_perms 只有管理员能改，不会被提权）。
-- 做了什么：
--   1. 新函数 dept_my_groups(权限)：当前老师是负责人、dept_perms 含该权限 → 返回他管理范围 majors 里是分组的 key
--   2. majors 在原有规则（mj_dept_*：领域级负责人）之外，再加三条分组规则（和原规则是「或」的关系，原规则不动）：
--      · 新增 / 修改：新行的 group_key 必须是我的分组，且新行的 domain = 分组所属领域
--        （所以改不了别的领域，也不能把专业挪出自己的分组）
--      · 删除：看旧行的 group_key
--   3. major_groups 不动：分组本身仍然只有管理员和领域级负责人能新建 / 改名 / 删除
-- 执行顺序：本文件整份贴进 Supabase SQL Editor 执行一次 → 再合并 PR。
-- 回滚语句在文件最下面。
-- ============================================================

-- 0. 不再要求职位 = 负责人（只去掉 position = 'lead' 这一行，其余和原版一样）
create or replace function public.dept_my_domains(p_perm text)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select array(select jsonb_array_elements_text(t.manage_scope->'domains'))
    from public.teachers t
    where t.id = public.current_teacher_id()
      and p_perm = any(t.dept_perms)
      and jsonb_typeof(t.manage_scope->'domains') = 'array'
  ), '{}'::text[]);
$$;
create or replace function public.dept_my_majors(p_perm text)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select public.expand_major_keys(coalesce((
    select array(select jsonb_array_elements_text(t.manage_scope->'majors'))
    from public.teachers t
    where t.id = public.current_teacher_id()
      and p_perm = any(t.dept_perms)
      and jsonb_typeof(t.manage_scope->'majors') = 'array'
  ), '{}'::text[]));
$$;

-- 1. 我负责的分组
create or replace function public.dept_my_groups(p_perm text)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select array(
      select g.key from public.major_groups g
      where g.key in (select jsonb_array_elements_text(t.manage_scope->'majors'))
    )
    from public.teachers t
    where t.id = public.current_teacher_id()
      and p_perm = any(t.dept_perms)
      and jsonb_typeof(t.manage_scope->'majors') = 'array'
  ), '{}'::text[]);
$$;
revoke all on function public.dept_my_groups(text) from public;
grant execute on function public.dept_my_groups(text) to anon, authenticated;

-- 2. majors：分组负责人的新增 / 修改 / 删除
drop policy if exists mj_grp_ins on public.majors;
drop policy if exists mj_grp_upd on public.majors;
drop policy if exists mj_grp_del on public.majors;
create policy mj_grp_ins on public.majors for insert
  with check (
    group_key is not null
    and group_key = any(public.dept_my_groups('majors'))
    and domain = (select g.domain from public.major_groups g where g.key = majors.group_key)
  );
create policy mj_grp_upd on public.majors for update
  using (group_key is not null and group_key = any(public.dept_my_groups('majors')))
  with check (
    group_key is not null
    and group_key = any(public.dept_my_groups('majors'))
    and domain = (select g.domain from public.major_groups g where g.key = majors.group_key)
  );
create policy mj_grp_del on public.majors for delete
  using (group_key is not null and group_key = any(public.dept_my_groups('majors')));

-- 3. 检查（只读）：应有 3 条 mj_grp_* 和 1 个新函数
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'majors' and policyname like 'mj_grp_%' order by policyname;
select count(*) as 新函数数_应为1 from pg_proc where proname = 'dept_my_groups';

-- ══ 回滚 ══
-- drop policy if exists mj_grp_ins on public.majors;
-- drop policy if exists mj_grp_upd on public.majors;
-- drop policy if exists mj_grp_del on public.majors;
-- drop function if exists public.dept_my_groups(text);
-- 恢复「必须是负责人」：重新执行 seed/dept_perms_prepare.sql 的 dept_my_domains 一段，和 seed/major_groups.sql 第 4 节的 dept_my_majors 一段。
