-- ============================================================
-- 学生文书只给指导这个学生的老师看（计划书 / 志望理由书 / 面试稿 / 联系教授・问询邮件）
-- 范围的三张表：student_plan_drafts、student_doc_versions、riyu_submissions
-- 不动：student_materials（出愿材料）、面谈附件、任何文书数据本身。
--
-- 执行顺序（Supabase SQL Editor，分段执行）：
--   ① 合并前：只跑「① 备份」段（把三张表现在的规则存进 policy_backup_student_docs）
--   ② 合并后：再跑「② 新规则」段
--   ③ 出问题：跑「③ 回滚」段，恢复原来的规则
--
-- 谁能看（内容和文件）：
--   管理员 / 学生本人 /
--   负责这个学生专业的专业课老师（roles 含 senmon）/ 本专业 TA（roles 含 ta）/
--   学生的 VIP 老师（students.vip_teachers，按老师姓名）/ 负责老师（students.owner_teachers）/
--   以上这些老师的直属上级（teachers.leader_id，只往上一级）
-- 其他人（营业、对接、总务、综合事业部、不是直属上级的负责人、班主任、别的专业老师）：读写都被挡住，
--   只能调 student_doc_status() 拿到「已提交第几版 / 已批复」这类状态。
-- ============================================================

-- ============================================================
-- ① 备份（合并前执行，可重复执行：每次执行只在备份表里没有这批规则时才追加）
-- ============================================================
create table if not exists public.policy_backup_student_docs (
  id bigserial primary key,
  backed_up_at timestamptz not null default now(),
  schemaname name, tablename name, policyname name,
  permissive text, roles name[], cmd text, qual text, with_check text
);
insert into public.policy_backup_student_docs (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check)
select p.schemaname, p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check
  from pg_policies p
 where p.schemaname = 'public'
   and p.tablename in ('student_plan_drafts', 'student_doc_versions', 'riyu_submissions')
   and not exists (select 1 from public.policy_backup_student_docs b
                    where b.tablename = p.tablename and b.policyname = p.policyname
                      and b.qual is not distinct from p.qual and b.with_check is not distinct from p.with_check);
-- 检查：应能看到三张表现在的全部规则
select tablename, policyname, cmd, roles, qual, with_check from public.policy_backup_student_docs order by tablename, policyname;
-- 三张表现在是否开了 RLS（没开的话，② 会一并打开）
select relname, relrowsecurity from pg_class where oid in ('public.student_plan_drafts'::regclass, 'public.student_doc_versions'::regclass, 'public.riyu_submissions'::regclass);

-- ============================================================
-- ② 新规则（合并后执行，可重复执行）
-- ============================================================
begin;

-- 学生的专业是不是在老师的「负责专业」里（负责专业可以填分组 key，分组 = majors.group_key）
create or replace function public._sd_major_in(p_majors text[], p_major text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_major is not null and p_majors is not null and (
    p_major = any (p_majors)
    or exists (select 1 from public.majors m where m.key = p_major and m.group_key is not null and m.group_key = any (p_majors))
  )
$$;

-- 老师 t 是不是「直接指导」学生 s（上面 2~5 条，不含直属上级）
create or replace function public._sd_direct(p_tid text, p_sid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teachers t, public.students s
     where t.id = p_tid and s.id = p_sid
       and (
         ((t.roles @> array['senmon'] or t.roles @> array['ta']) and public._sd_major_in(t.majors, s.major))
         or (t.name is not null and t.name <> '' and (t.name = any (coalesce(s.vip_teachers, '{}')) or t.name = any (coalesce(s.owner_teachers, '{}'))))
       )
  )
$$;

create or replace function public.can_view_student_docs(sid text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_tid text;
begin
  if coalesce(public.is_admin(), false) then return true; end if;
  if sid is null then return false; end if;
  if sid = public.current_student_id() then return true; end if;
  v_tid := public.current_teacher_id();
  if v_tid is null then return false; end if;
  if public._sd_direct(v_tid, sid) then return true; end if;
  -- 直属上级：某位直接指导这个学生的老师，他的 leader_id 就是我
  return exists (
    select 1 from public.teachers u
     where u.leader_id = v_tid and public._sd_direct(u.id, sid)
  );
end $$;
grant execute on function public.can_view_student_docs(text) to anon, authenticated;

-- 前端用：这批学生里，我能看文书内容的有哪些（和上面 can_view_student_docs 同一套判断，页面只信这个）
create or replace function public.student_docs_viewable(sids text[])
returns setof text language sql stable security definer set search_path = public as $$
  select x from (select distinct unnest(sids) as x) q where public.can_view_student_docs(x)
$$;
grant execute on function public.student_docs_viewable(text[]) to authenticated;

-- 三张表：先删掉现有的全部规则，再建一条读写都走 can_view_student_docs 的
do $$
declare r record; t text;
begin
  foreach t in array array['student_plan_drafts', 'student_doc_versions', 'riyu_submissions'] loop
    execute format('alter table public.%I enable row level security', t);
    for r in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', r.policyname, t);
    end loop;
    execute format('create policy sdocs_scope on public.%I for all using (public.can_view_student_docs(student_id)) with check (public.can_view_student_docs(student_id))', t);
  end loop;
end $$;

-- 只看状态：任何老师都能调，不返回正文、文件地址、批注
-- plan_*：计划书最新版本号、提交时间、有没有批复（读 student_doc_versions；没有版本记录的旧数据退回 student_plan_drafts 的完成稿）
-- riyu：每种 kind 已提交几份（status in submitted/reviewed）、已批复几份（reviewed）
create or replace function public.student_doc_status(sids text[])
returns table (student_id text, plan_version_no int, plan_submitted_at timestamptz, plan_reviewed boolean, riyu jsonb)
language sql stable security definer set search_path = public as $$
  with ids as (select distinct unnest(sids) as sid),
  pv as (
    select distinct on (v.student_id) v.student_id, v.version_no, v.submitted_at,
           (v.reviewed_at is not null or v.review_file_url is not null) as reviewed
      from public.student_doc_versions v
     where v.student_id = any (sids) and v.doc_type = 'plan'
     order by v.student_id, v.submitted_at desc
  ),
  pd as (
    select distinct on (d.student_id) d.student_id, d.updated_at,
           (d.reviewed_at is not null or d.reviewed_file_url is not null) as reviewed
      from public.student_plan_drafts d
     where d.student_id = any (sids) and d.draft_file_url is not null
     order by d.student_id, d.updated_at desc
  ),
  rs as (
    select x.student_id, jsonb_object_agg(x.kind, jsonb_build_object('submitted', x.n, 'reviewed', x.nr)) as j
      from (
        select r.student_id, r.kind, count(*) filter (where r.status in ('submitted', 'reviewed'))::int as n,
               count(*) filter (where r.status = 'reviewed')::int as nr
          from public.riyu_submissions r
         where r.student_id = any (sids) and r.kind is not null
         group by r.student_id, r.kind
      ) x group by x.student_id
  )
  select i.sid,
         coalesce(pv.version_no, case when pd.student_id is not null then 1 end),
         coalesce(pv.submitted_at, pd.updated_at),
         coalesce(pv.reviewed, pd.reviewed, false),
         coalesce(rs.j, '{}'::jsonb)
    from ids i
    left join pv on pv.student_id = i.sid
    left join pd on pd.student_id = i.sid
    left join rs on rs.student_id = i.sid
   where public.current_teacher_id() is not null or coalesce(public.is_admin(), false)
$$;
grant execute on function public.student_doc_status(text[]) to authenticated;

commit;

-- 检查（用老师账号在页面上测；这里只看规则）：
-- select tablename, policyname, cmd, qual, with_check from pg_policies where tablename in ('student_plan_drafts','student_doc_versions','riyu_submissions');

-- ============================================================
-- ③ 回滚：恢复成备份里的原规则（最近一次备份），并删掉新函数
-- ============================================================
-- begin;
-- do $$
-- declare r record; t text; v_sql text; v_last timestamptz;
-- begin
--   foreach t in array array['student_plan_drafts', 'student_doc_versions', 'riyu_submissions'] loop
--     for r in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
--       execute format('drop policy if exists %I on public.%I', r.policyname, t);
--     end loop;
--   end loop;
--   for r in select distinct on (tablename, policyname) * from public.policy_backup_student_docs order by tablename, policyname, id desc loop
--     v_sql := format('create policy %I on public.%I as %s for %s to %s', r.policyname, r.tablename, r.permissive, r.cmd, array_to_string(r.roles, ','));
--     if r.qual is not null then v_sql := v_sql || ' using (' || r.qual || ')'; end if;
--     if r.with_check is not null then v_sql := v_sql || ' with check (' || r.with_check || ')'; end if;
--     execute v_sql;
--   end loop;
-- end $$;
-- drop function if exists public.student_docs_viewable(text[]);
-- drop function if exists public.student_doc_status(text[]);
-- drop function if exists public.can_view_student_docs(text);
-- drop function if exists public._sd_direct(text, text);
-- drop function if exists public._sd_major_in(text[], text);
-- commit;
-- （如果备份时某张表原本没开 RLS，回滚后可再执行：alter table public.<表名> disable row level security;）
