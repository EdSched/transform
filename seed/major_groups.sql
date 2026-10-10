-- ============================================================
-- 专业分组通用化（领域 → 分组 → 专业）  PR ① 合并前执行（可重复执行）
-- 前提：已执行 dept_perms_prepare.sql / dept_perms_fix_jsonb.sql / dept_perms_majors.sql（用到 can_manage、dept_my_domains、jsonb_text_arr、current_teacher_id）。
-- 做了什么：
--   1. 新表 major_groups（分组本身）+ majors.group_key（专业挂在哪个分组）；现有「社会人文」shakai_group = 社会学 + 新闻传播学 + 社会福祉学
--   2. 读：所有人可读（和 majors 一样）；写：is_admin() 或 can_manage('majors', 领域)
--   3. 按专业判断的数据库函数认分组：专业 key 是分组时，领域取 major_groups.domain，成员取 majors.group_key
--      （can_manage_major / dept_majors_in / dept_my_majors / dept_teacher_in_range / dept_majors_in_scope / dept_domains_ok）
-- 执行后前端无需等待：前端读不到新表时会退回写死的「社会人文」，行为不变。
-- 回滚语句在文件最下面。
-- ============================================================

-- ── 1. 表和列 ──
create table if not exists public.major_groups (
  key text primary key,          -- 例：shakai_group / seimei_group
  label text not null,           -- 例：社会人文 / 生命科学
  label_ja text,
  domain text not null,          -- 所属领域：大学院文科 / 大学院理科
  sort int default 0
);
alter table public.majors add column if not exists group_key text references public.major_groups(key);

insert into public.major_groups (key, label, domain, sort) values ('shakai_group', '社会人文', '大学院文科', 0)
  on conflict (key) do nothing;
update public.majors set group_key = 'shakai_group' where key in ('shakai', 'shinpan', 'fukushi') and group_key is null;

-- ── 2. RLS ──
alter table public.major_groups enable row level security;
grant select on public.major_groups to anon, authenticated;
grant insert, update, delete on public.major_groups to authenticated;
drop policy if exists mg_read on public.major_groups;
drop policy if exists mg_ins on public.major_groups;
drop policy if exists mg_upd on public.major_groups;
drop policy if exists mg_del on public.major_groups;
create policy mg_read on public.major_groups for select using (true);
create policy mg_ins on public.major_groups for insert with check (public.is_admin() or public.can_manage('majors', domain));
create policy mg_upd on public.major_groups for update using (public.is_admin() or public.can_manage('majors', domain))
  with check (public.is_admin() or public.can_manage('majors', domain));
create policy mg_del on public.major_groups for delete using (public.is_admin() or public.can_manage('majors', domain));

-- ── 3. 小工具 ──
-- 专业或分组的所属领域
create or replace function public.major_domain_of(p_key text)
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select m.domain from public.majors m where m.key = p_key),
    (select g.domain from public.major_groups g where g.key = p_key)
  );
$$;
revoke all on function public.major_domain_of(text) from public;
grant execute on function public.major_domain_of(text) to anon, authenticated;

-- 一组 key（可含分组）→ 原 key + 分组展开出的组内专业，去重
create or replace function public.expand_major_keys(p_keys text[])
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct k), '{}'::text[]) from (
    select unnest(coalesce(p_keys, '{}'::text[])) as k
    union
    select m.key from public.majors m where m.group_key = any(coalesce(p_keys, '{}'::text[]))
  ) s where k is not null and k <> '';
$$;
revoke all on function public.expand_major_keys(text[]) from public;
grant execute on function public.expand_major_keys(text[]) to anon, authenticated;

-- ── 4. 按专业判断的函数认分组 ──
-- 专业 → can_manage（宣传内容按专业判断用）；专业是分组时按分组领域
create or replace function public.can_manage_major(p_perm text, p_major text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.can_manage(p_perm, public.major_domain_of(p_major));
$$;
revoke all on function public.can_manage_major(text, text) from public;
grant execute on function public.can_manage_major(text, text) to anon, authenticated;

-- 这些专业是否都属于给定领域（没有领域的专业算不在范围内；分组按 major_groups.domain）
create or replace function public.dept_majors_in(p_keys text[], p_domains text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select not exists (
    select 1 from unnest(coalesce(p_keys, '{}'::text[])) k
    where public.major_domain_of(k) is null or not (public.major_domain_of(k) = any(coalesce(p_domains, '{}'::text[])))
  );
$$;
revoke all on function public.dept_majors_in(text[], text[]) from public;
grant execute on function public.dept_majors_in(text[], text[]) to anon, authenticated;

-- 负责人管理范围里的专业（分组展开成组内专业；分组 key 本身也保留）
create or replace function public.dept_my_majors(p_perm text)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select public.expand_major_keys(coalesce((
    select array(select jsonb_array_elements_text(t.manage_scope->'majors'))
    from public.teachers t
    where t.id = public.current_teacher_id()
      and t.position = 'lead'
      and p_perm = any(t.dept_perms)
      and jsonb_typeof(t.manage_scope->'majors') = 'array'
  ), '{}'::text[]));
$$;
revoke all on function public.dept_my_majors(text) from public;
grant execute on function public.dept_my_majors(text) to anon, authenticated;

-- 老师是否在「本范围老师管理」范围内：领域，或 负责专业（分组展开）和我的专业有交集
create or replace function public.dept_teacher_in_range(p_managed jsonb, p_domains jsonb, p_majors text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.dept_my_domains('teachers') && (
    public.jsonb_text_arr(p_managed) || public.jsonb_text_arr(p_domains)
    || array(select public.major_domain_of(k) from unnest(coalesce(p_majors, '{}'::text[])) k where public.major_domain_of(k) is not null)
  )
  or public.expand_major_keys(p_majors) && public.dept_my_majors('teachers');
$$;
revoke all on function public.dept_teacher_in_range(jsonb, jsonb, text[]) from public;
grant execute on function public.dept_teacher_in_range(jsonb, jsonb, text[]) to anon, authenticated;

-- 专业是否都在范围内：属于我的领域，或就在我的专业里（我的专业含分组展开的成员）
create or replace function public.dept_majors_in_scope(p_keys text[], p_domains text[], p_majors text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select not exists (
    select 1 from unnest(coalesce(p_keys, '{}'::text[])) k
    where not (k = any(public.expand_major_keys(p_majors)))
      and (public.major_domain_of(k) is null or not (public.major_domain_of(k) = any(coalesce(p_domains, '{}'::text[]))))
  );
$$;
revoke all on function public.dept_majors_in_scope(text[], text[], text[]) from public;
grant execute on function public.dept_majors_in_scope(text[], text[], text[]) to anon, authenticated;

-- 新增的领域是否允许：在我的领域里；或是我某个负责专业所属的领域，并且这位老师有专业、
-- 且在该领域下的专业全部在我的专业里（我的专业 / 老师的专业都把分组展开成组内专业）
create or replace function public.dept_domains_ok(p_added text[], p_my text[], p_mym text[], p_tm text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select not exists (
    select 1 from unnest(coalesce(p_added, '{}'::text[])) x
    where not (x = any(coalesce(p_my, '{}'::text[])))
      and not (
        coalesce(array_length(p_tm, 1), 0) > 0
        and exists (select 1 from public.majors m where m.domain = x and m.key = any(public.expand_major_keys(p_mym)))
        and exists (select 1 from public.majors m where m.domain = x and m.key = any(public.expand_major_keys(p_tm)))
        and not exists (select 1 from public.majors m where m.domain = x and m.key = any(public.expand_major_keys(p_tm)) and not (m.key = any(public.expand_major_keys(p_mym))))
      )
  );
$$;
revoke all on function public.dept_domains_ok(text[], text[], text[], text[]) from public;
grant execute on function public.dept_domains_ok(text[], text[], text[], text[]) to anon, authenticated;

-- ── 5. 检查（只读）──
select (select count(*) from public.major_groups) as 分组数,
       (select string_agg(key, ',') from public.majors where group_key = 'shakai_group') as 社会人文成员_应为三个,
       (select count(*) from pg_proc where proname in ('major_domain_of','expand_major_keys')) as 新函数数_应为2;

-- ══ 回滚 ══
-- 1) 函数恢复成旧版（整份重新执行下面这些文件，会把函数恢复成不认分组的原版）：
--      seed/dept_perms_prepare.sql 里的 can_manage_major / dept_majors_in 两段，
--      seed/dept_perms_majors.sql（dept_my_majors / dept_teacher_in_range / dept_majors_in_scope / dept_domains_ok）
-- 2) 再删除新函数、列和表：
-- drop function if exists public.expand_major_keys(text[]);
-- drop function if exists public.major_domain_of(text);
-- alter table public.majors drop column if exists group_key;
-- drop table if exists public.major_groups;
