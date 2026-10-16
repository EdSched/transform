-- ============================================================
-- 合格实绩⑪：负责人在管理模式里只看、只管自己管理范围（领域 / 专业）内的合格实绩、截图和海报
-- 取代 seed/can_manage_results_lead.sql（那份让负责人看全部）。合并 PR 之前在 Supabase SQL Editor 整份执行一次；可重复执行。
-- 前提：已执行 results_teacher_admin.sql、can_manage_results_lead.sql、integrate_step1_prepare.sql、major_groups.sql（majors.group_key）。
--
-- 「一条合格记录属于哪个范围」
--   专业 = our_major；领域 = our_major 所属领域（majors.domain），没有则按 大学院/学部 + 系統(track) 推：
--   大学院+bunka=大学院文科 …… 学部+bijutsu=学部美术。
--   范围内 = 领域在 manage_scope.domains 里，或专业在 manage_scope.majors 里（分组展开成组内专业）。
--
-- 做了什么：
--  1. can_manage_results() 恢复成原来的：只认管理员 / permissions.result_admin（营业老师，看全部）。
--  2. 新函数（security definer，只返回 true/false）：
--       result_lead_ok()                         当前老师是负责人，且管理模式开放了合格实绩页（pages 不存在或含 'admissions'）
--       result_in_my_scope(kind, our_major, track)   这条记录在不在我的管理范围里
--       can_manage_result_row(kind, our_major, track) = can_manage_results() 或（result_lead_ok() 且 在范围内）
--       can_manage_photo_row(kind, result_id)    按 result_photos 的 kind + id 找到结果记录再判断
--       can_manage_photo_path(path)              私有桶路径 → result_photos → 结果记录再判断
--       can_manage_poster_row(major, domain, kind)  海报（用 pass_posters 的 major / domain；都没有则不在范围）
--       can_manage_poster_id(poster_id)          pass_poster_sources 跟着海报走
--  3. 重建规则（读 pg_policies 里现有规则，规则名、角色、其他条件原样保留；改之前存进 results_lead_policy_backup）：
--       admission_results / undergrad_results 修改·删除·写：is_domain_key() 换成 current_access_domain() is not null（领域链接账号的原条件保留，
--                                                负责人老师不再因 is_domain_key 能改任何记录），can_manage_results() 换成 can_manage_result_row(…)
--                                                读取（select）、新增不动
--       result_photos 读·改·删                  → can_manage_photo_row(result_kind, result_id)（新增那条不动）
--       storage 私有桶 admission_private admin   → can_manage_photo_path(name)（上传那条不动）
--       pass_posters                             → can_manage_poster_row(major, domain, result_kind)（已发布的海报照旧所有老师可读）
--       pass_poster_sources                      → can_manage_poster_id(poster_id)
--       univ_en_names 写                         → can_manage_results() 或 result_lead_ok()（只是大学英文名）
--       storage 公开桶 admission_photos admin    → posters/ 目录对 can_manage_results() 或 result_lead_ok() 开放（负责人保存海报要传图）
--  4. 不动：students、student_school_plans、公开页面读取、两个录入链接。
-- 注意（私有桶）：负责人换图时，旧文件在 result_photos 改指向新路径之后才删，那一刻已找不到对应行，旧文件会留在桶里（只有管理员能清）；不影响使用。
--
-- 执行前可先看一眼现状（可选；若有 qual 是 true 的遗留「public all」规则，先发给 Claude）：
--   select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies
--    where (schemaname='public' and tablename in ('admission_results','undergrad_results','result_photos','pass_posters','pass_poster_sources','univ_en_names'))
--       or (schemaname='storage' and tablename='objects' and (qual like '%admission-%' or with_check like '%admission-%')) order by 1,2,3;
-- ============================================================
begin;

do $$
begin
  if to_regprocedure('public.is_admin()') is null or to_regprocedure('public.current_teacher_id()') is null
     or to_regprocedure('public.current_access_domain()') is null or to_regprocedure('public.can_manage_results()') is null then
    raise exception '缺少 is_admin() / current_teacher_id() / current_access_domain() / can_manage_results()，请把这段发给 Claude 评估';
  end if;
end $$;

-- 0) 备份：函数原定义 + 要改的规则（只备份第一次）
create table if not exists public._fn_backup (name text primary key, def text not null, saved_at timestamptz not null default now());
revoke all on public._fn_backup from anon, authenticated;
insert into public._fn_backup(name, def)
select 'can_manage_results_before_lead_scope', pg_get_functiondef('public.can_manage_results()'::regprocedure)
on conflict (name) do nothing;

create table if not exists public.results_lead_policy_backup (
  schemaname text not null, tablename text not null, policyname text not null,
  permissive text, roles text[], cmd text, qual text, with_check text,
  primary key (schemaname, tablename, policyname)
);
alter table public.results_lead_policy_backup enable row level security;

-- 1) can_manage_results() 恢复成：管理员 或 result_admin
create or replace function public.can_manage_results() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin(), false) or exists (
    select 1 from public.teachers t
     where t.id = public.current_teacher_id()
       and lower(coalesce(t.permissions->>'result_admin', '')) = 'true')
$$;
grant execute on function public.can_manage_results() to anon, authenticated;

-- 2) 小工具
create or replace function public.expand_major_keys(p_keys text[])
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct k), '{}'::text[]) from (
    select unnest(coalesce(p_keys, '{}'::text[])) as k
    union
    select m.key from public.majors m where m.group_key = any(coalesce(p_keys, '{}'::text[]))
  ) s where k is not null and k <> '';
$$;
grant execute on function public.expand_major_keys(text[]) to anon, authenticated;

create or replace function public.result_lead_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teachers t
     where t.id = public.current_teacher_id()
       and t.manage_scope is not null
       and (
         (case when jsonb_typeof(t.manage_scope->'domains')   = 'array' then jsonb_array_length(t.manage_scope->'domains')   else 0 end) +
         (case when jsonb_typeof(t.manage_scope->'majors')    = 'array' then jsonb_array_length(t.manage_scope->'majors')    else 0 end) +
         (case when jsonb_typeof(t.manage_scope->'class_ids') = 'array' then jsonb_array_length(t.manage_scope->'class_ids') else 0 end)
       ) > 0
       and (jsonb_typeof(t.manage_scope->'pages') is distinct from 'array' or t.manage_scope->'pages' ? 'admissions')
  )
$$;
grant execute on function public.result_lead_ok() to anon, authenticated;

-- 专业 / 领域 是否在我的管理范围里（不判断页面开关）
create or replace function public.result_scope_match(p_major text, p_domain text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teachers t
     where t.id = public.current_teacher_id()
       and t.manage_scope is not null
       and (
         (nullif(p_major, '') is not null and nullif(p_major, '') = any(public.expand_major_keys(
            coalesce((select array(select jsonb_array_elements_text(t.manage_scope->'majors')) where jsonb_typeof(t.manage_scope->'majors') = 'array'), '{}'::text[]))))
         or (nullif(p_domain, '') is not null and jsonb_typeof(t.manage_scope->'domains') = 'array' and t.manage_scope->'domains' ? p_domain)
       )
  )
$$;
grant execute on function public.result_scope_match(text, text) to anon, authenticated;

create or replace function public.result_in_my_scope(p_kind text, p_our_major text, p_track text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.result_scope_match(
    p_our_major,
    coalesce(
      (select m.domain from public.majors m where m.key = nullif(p_our_major, '')),
      case when p_track in ('bunka', 'rika', 'bijutsu') then
        (case when p_kind = 'ug' then '学部' else '大学院' end) ||
        (case p_track when 'bunka' then '文科' when 'rika' then '理科' else '美术' end)
      end))
$$;
grant execute on function public.result_in_my_scope(text, text, text) to anon, authenticated;

create or replace function public.can_manage_result_row(p_kind text, p_our_major text, p_track text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_results() or (public.result_lead_ok() and public.result_in_my_scope(p_kind, p_our_major, p_track))
$$;
grant execute on function public.can_manage_result_row(text, text, text) to anon, authenticated;

create or replace function public.can_manage_photo_row(p_kind text, p_result_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_results() or (public.result_lead_ok() and (
    case when p_kind = 'ug'
      then exists (select 1 from public.undergrad_results r where r.id::text = p_result_id and public.result_in_my_scope('ug', r.our_major, r.track))
      else exists (select 1 from public.admission_results r where r.id::text = p_result_id and public.result_in_my_scope('grad', r.our_major, r.track))
    end))
$$;
grant execute on function public.can_manage_photo_row(text, text) to anon, authenticated;

create or replace function public.can_manage_photo_path(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_results() or exists (
    select 1 from public.result_photos ph where ph.path = p_path and public.can_manage_photo_row(ph.result_kind, ph.result_id))
$$;
grant execute on function public.can_manage_photo_path(text) to anon, authenticated;

create or replace function public.can_manage_poster_row(p_major text, p_domain text, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_results() or (public.result_lead_ok() and public.result_scope_match(p_major, p_domain))
$$;
grant execute on function public.can_manage_poster_row(text, text, text) to anon, authenticated;

create or replace function public.can_manage_poster_id(p_poster_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_results() or exists (
    select 1 from public.pass_posters p where p.id = p_poster_id and public.can_manage_poster_row(p.major, p.domain, p.result_kind))
$$;
grant execute on function public.can_manage_poster_id(uuid) to anon, authenticated;

-- 3) 重建规则：把现有规则里的 can_manage_results() 换成按行判断的函数
do $$
declare
  tg record; p record;
  q text; wc text; stmt text; n int := 0;
  g text := '(public\.)?can_manage_results\(\)';
  dk text := '(public\.)?is_domain_key\(\)';
  targets constant jsonb := jsonb_build_array(
    jsonb_build_object('s','public','t','admission_results','cmds','ALL,UPDATE,DELETE','e',$e$public.can_manage_result_row('grad', our_major, track)$e$,'dk',true),
    jsonb_build_object('s','public','t','undergrad_results','cmds','ALL,UPDATE,DELETE','e',$e$public.can_manage_result_row('ug', our_major, track)$e$,'dk',true),
    jsonb_build_object('s','public','t','result_photos','cmds','ALL,SELECT,UPDATE,DELETE','e','public.can_manage_photo_row(result_kind, result_id)'),
    jsonb_build_object('s','public','t','pass_posters','cmds','ALL,SELECT,INSERT,UPDATE,DELETE','e','public.can_manage_poster_row(major, domain, result_kind)'),
    jsonb_build_object('s','public','t','pass_poster_sources','cmds','ALL,SELECT,INSERT,UPDATE,DELETE','e','public.can_manage_poster_id(poster_id)'),
    jsonb_build_object('s','public','t','univ_en_names','cmds','ALL,INSERT,UPDATE,DELETE','e','(public.can_manage_results() or public.result_lead_ok())'),
    jsonb_build_object('s','storage','t','objects','cmds','ALL','names','admission_private admin','e','public.can_manage_photo_path(name)'),
    jsonb_build_object('s','storage','t','objects','cmds','ALL','names','admission_photos admin','e','(public.can_manage_results() or public.result_lead_ok())')
  );
begin
  for tg in select * from jsonb_array_elements(targets) as x(j) loop
    for p in
      select * from pg_policies
       where schemaname = tg.j->>'s' and tablename = tg.j->>'t'
         and cmd = any (string_to_array(tg.j->>'cmds', ','))
         and (tg.j->>'names' is null or policyname = tg.j->>'names')
    loop
      continue when coalesce(p.qual, '') !~* 'can_manage_results' and coalesce(p.with_check, '') !~* 'can_manage_results';
      continue when (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~* 'can_manage_(result_row|photo_row|photo_path|poster_row|poster_id)|result_lead_ok';   -- 已经改过，重复执行时跳过
      insert into public.results_lead_policy_backup (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
        values (p.schemaname, p.tablename, p.policyname, p.permissive, p.roles::text[], p.cmd, p.qual, p.with_check)
        on conflict do nothing;
      q  := p.qual;  wc := p.with_check;
      if q  is not null then q  := regexp_replace(q,  g, tg.j->>'e', 'gi'); end if;
      if wc is not null then wc := regexp_replace(wc, g, tg.j->>'e', 'gi'); end if;
      if (tg.j->>'dk')::boolean is true then
        if q  is not null then q  := regexp_replace(q,  dk, 'public.current_access_domain() is not null', 'gi'); end if;
        if wc is not null then wc := regexp_replace(wc, dk, 'public.current_access_domain() is not null', 'gi'); end if;
      end if;
      stmt := format('create policy %I on %I.%I as %s for %s to %s',
                p.policyname, p.schemaname, p.tablename, lower(p.permissive), lower(p.cmd),
                array_to_string(array(select quote_ident(r) from unnest(p.roles) r), ', '))
              || coalesce(' using (' || q || ')', '')
              || coalesce(' with check (' || wc || ')', '');
      execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
      execute stmt;
      n := n + 1;
      raise notice '已改：%.% · %（%）', p.schemaname, p.tablename, p.policyname, p.cmd;
    end loop;
  end loop;
  raise notice '共改了 % 条规则', n;
end $$;

commit;

-- ============================================================
-- 执行后检查（只读）：应该看到上面这些规则里出现 can_manage_result_row / can_manage_photo_row 等；
-- 并且 admission_results / undergrad_results 的规则里不再有 is_domain_key()
--   select tablename, policyname, cmd, qual from pg_policies where tablename in ('admission_results','undergrad_results','result_photos','pass_posters','pass_poster_sources') order by 1,2;
--
-- 回滚（需要时整段执行）：还原规则，再还原 can_manage_results()，最后删新函数
-- begin;
-- do $$
-- declare b record;
-- begin
--   for b in select * from public.results_lead_policy_backup loop
--     execute format('drop policy if exists %I on %I.%I', b.policyname, b.schemaname, b.tablename);
--     execute format('create policy %I on %I.%I as %s for %s to %s', b.policyname, b.schemaname, b.tablename,
--                    lower(b.permissive), lower(b.cmd), array_to_string(array(select quote_ident(r) from unnest(b.roles) r), ', '))
--       || coalesce(' using (' || b.qual || ')', '') || coalesce(' with check (' || b.with_check || ')', '');
--   end loop;
-- end $$;
-- do $$ declare d text; begin
--   select def into d from public._fn_backup where name = 'can_manage_results_before_lead_scope';
--   if d is not null then execute d; end if;
-- end $$;
-- drop function if exists public.can_manage_poster_id(uuid);
-- drop function if exists public.can_manage_poster_row(text, text, text);
-- drop function if exists public.can_manage_photo_path(text);
-- drop function if exists public.can_manage_photo_row(text, text);
-- drop function if exists public.can_manage_result_row(text, text, text);
-- drop function if exists public.result_in_my_scope(text, text, text);
-- drop function if exists public.result_scope_match(text, text);
-- drop function if exists public.result_lead_ok();
-- commit;
