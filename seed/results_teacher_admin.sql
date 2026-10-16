-- ============================================================
-- 合格实绩⑨：老师端「合格实绩管理」（permissions.result_admin）
-- 合并 PR 之前在 Supabase SQL Editor 一次性执行；可重复执行（已改过的规则会跳过）。
-- 前提：数据库里已有 is_admin() 和 current_teacher_id()（价目升级 seed/pricing_upgrade_2026-10.sql 用的同一对），
--       并且已执行过 seed/pass_posters.sql、seed/result_photos_private.sql。
--
-- 做了什么：
--  1. 新函数 can_manage_results()：管理员，或老师的 permissions.result_admin 为 true（布尔 true 或字符串 "true" 都认）。
--  2. 下面这些规则，在原有条件后面加上 「or can_manage_results()」，原有条件一个都不删，规则名不变：
--       admission_results / undergrad_results ：修改、删除（新增本来就对所有人开放，不动）
--       result_photos                         ：读、改、删（新增那条不动）
--       storage 私有桶 admission-private      ：「admission_private admin」那条
--       storage 公开桶 admission-photos       ：「admission_photos admin」那条，老师只开放 posters/ 目录（海报图）
--       pass_posters                          ：读（含未发布的）、写
--       pass_poster_sources                   ：全部
--       univ_en_names                         ：写
--  3. 不动：students、student_school_plans（写学生档案仍然只有管理员）。
--  脚本是读 pg_policies 里现有的规则再原样重建（规则名、角色、条件都保留），
--  改之前把原规则存进 public.results_admin_policy_backup，回滚就靠它。
--
-- 执行前可先看一眼现状（可选，应该能看到 is_admin() 之类的条件；如果看到 qual 是 true 的「public all」遗留规则，先发给 Claude）：
--   select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies
--    where (schemaname = 'public' and tablename in ('admission_results','undergrad_results','result_photos','pass_posters','pass_poster_sources','univ_en_names'))
--       or (schemaname = 'storage' and tablename = 'objects' and (qual like '%admission-%' or with_check like '%admission-%'))
--    order by 1, 2, 3;
-- ============================================================
begin;

do $$
begin
  if to_regprocedure('public.is_admin()') is null or to_regprocedure('public.current_teacher_id()') is null then
    raise exception '数据库里没有 is_admin() 或 current_teacher_id()，请把这段发给 Claude 评估';
  end if;
end $$;

-- 1) 判断函数（security definer：绕过 teachers 表自己的行级保护，只返回 true/false）
create or replace function public.can_manage_results() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin(), false) or exists (
    select 1 from public.teachers t
     where t.id = public.current_teacher_id()
       and lower(coalesce(t.permissions->>'result_admin', '')) = 'true')
$$;
grant execute on function public.can_manage_results() to anon, authenticated;

-- 2) 备份原规则（只备份第一次，重复执行不覆盖）
create table if not exists public.results_admin_policy_backup (
  schemaname text not null, tablename text not null, policyname text not null,
  permissive text, roles text[], cmd text, qual text, with_check text,
  primary key (schemaname, tablename, policyname)
);
alter table public.results_admin_policy_backup enable row level security;   -- 不建任何规则 = 只有后台能读

-- 3) 重建规则
do $$
declare
  tg   record;
  p    record;
  ext  text;
  q    text;
  wc   text;
  stmt text;
  n    int := 0;
  -- (schema, 表, 要改的命令, 只改这些规则名（null = 不限）, 追加的条件)
  targets constant jsonb := jsonb_build_array(
    jsonb_build_object('s','public','t','admission_results','cmds','ALL,UPDATE,DELETE'),
    jsonb_build_object('s','public','t','undergrad_results','cmds','ALL,UPDATE,DELETE'),
    jsonb_build_object('s','public','t','result_photos','cmds','ALL,SELECT,UPDATE,DELETE'),
    jsonb_build_object('s','public','t','pass_posters','cmds','ALL,SELECT,INSERT,UPDATE,DELETE'),
    jsonb_build_object('s','public','t','pass_poster_sources','cmds','ALL,SELECT,INSERT,UPDATE,DELETE'),
    jsonb_build_object('s','public','t','univ_en_names','cmds','ALL,INSERT,UPDATE,DELETE'),
    jsonb_build_object('s','storage','t','objects','cmds','ALL','names','admission_private admin'),
    jsonb_build_object('s','storage','t','objects','cmds','ALL','names','admission_photos admin',
                       'ext','(public.can_manage_results() and (storage.foldername(name))[1] = ''posters'')')
  );
begin
  for tg in select * from jsonb_array_elements(targets) as x(j) loop
    ext := coalesce(tg.j->>'ext', 'public.can_manage_results()');
    for p in
      select * from pg_policies
       where schemaname = tg.j->>'s' and tablename = tg.j->>'t'
         and cmd = any (string_to_array(tg.j->>'cmds', ','))
         and (tg.j->>'names' is null or policyname = tg.j->>'names')
    loop
      continue when coalesce(p.qual, '') like '%can_manage_results%' or coalesce(p.with_check, '') like '%can_manage_results%';
      insert into public.results_admin_policy_backup (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
        values (p.schemaname, p.tablename, p.policyname, p.permissive, p.roles::text[], p.cmd, p.qual, p.with_check)
        on conflict do nothing;
      q  := case when p.qual       is null then null else '(' || p.qual       || ') or ' || ext end;
      wc := case when p.with_check is null then null else '(' || p.with_check || ') or ' || ext end;
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
-- 回滚（先还原规则，再删函数；备份表最后删）
-- ============================================================
-- begin;
-- do $$
-- declare b record;
-- begin
--   for b in select * from public.results_admin_policy_backup loop
--     execute format('drop policy if exists %I on %I.%I', b.policyname, b.schemaname, b.tablename);
--     execute format('create policy %I on %I.%I as %s for %s to %s', b.policyname, b.schemaname, b.tablename,
--                    lower(b.permissive), lower(b.cmd), array_to_string(array(select quote_ident(r) from unnest(b.roles) r), ', '))
--       || coalesce(' using (' || b.qual || ')', '') || coalesce(' with check (' || b.with_check || ')', '');
--   end loop;
-- end $$;
-- drop function if exists public.can_manage_results();
-- drop table if exists public.results_admin_policy_backup;
-- commit;
