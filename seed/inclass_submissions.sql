-- 随堂作业：出席・作业页单回开关 + 学生提交表
-- 执行：Supabase SQL Editor，整段一次执行。可重复执行。

-- 1) 单回开关
alter table public.course_sessions add column if not exists inclass_enabled boolean not null default false;

-- 2) 提交表（单独一张，不影响作业的未交 / 月报统计）
--    session_id 类型跟 course_sessions.id 保持一致（下面自动取）
do $$
declare v_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_type
    from pg_attribute a
   where a.attrelid = 'public.course_sessions'::regclass and a.attname = 'id' and not a.attisdropped;
  execute format($f$
    create table if not exists public.inclass_submissions (
      id            text primary key,
      session_id    %s not null,
      course_name   text, session_number int, session_date date,
      student_id    text not null, student_name text, major text,
      text          text,
      images        jsonb not null default '[]'::jsonb,
      submitted_at  timestamptz not null default now(),
      feedbacks     jsonb not null default '[]'::jsonb
    )$f$, v_type);
end $$;
create index if not exists inclass_sub_session_idx on public.inclass_submissions (session_id);
create index if not exists inclass_sub_student_idx on public.inclass_submissions (student_id);

-- 3) 读写规则：照抄 homework_submissions
--    它开了 RLS → 新表也开，并把它的每条规则原样复制一份（表名替换）
--    它没开 RLS → 新表也不开（保持一致）
do $$
declare
  r record; v_rls boolean; v_sql text;
begin
  select relrowsecurity into v_rls from pg_class where oid = 'public.homework_submissions'::regclass;
  if coalesce(v_rls, false) then
    execute 'alter table public.inclass_submissions enable row level security';
    for r in select * from pg_policies where schemaname = 'public' and tablename = 'homework_submissions' loop
      execute format('drop policy if exists %I on public.inclass_submissions', 'ics_' || r.policyname);
      v_sql := format('create policy %I on public.inclass_submissions as %s for %s to %s',
                      'ics_' || r.policyname, r.permissive, r.cmd, array_to_string(r.roles, ','));
      if r.qual is not null then v_sql := v_sql || ' using (' || replace(r.qual, 'homework_submissions', 'inclass_submissions') || ')'; end if;
      if r.with_check is not null then v_sql := v_sql || ' with check (' || replace(r.with_check, 'homework_submissions', 'inclass_submissions') || ')'; end if;
      execute v_sql;
    end loop;
  end if;
  raise notice 'homework_submissions RLS = %', coalesce(v_rls, false);
end $$;

-- 检查：新表规则应与作业表一一对应
select tablename, policyname, cmd, roles, qual, with_check from pg_policies
 where tablename in ('homework_submissions', 'inclass_submissions') order by tablename, policyname;

-- ───────── 回滚 ─────────
-- drop table if exists public.inclass_submissions;
-- alter table public.course_sessions drop column if exists inclass_enabled;
