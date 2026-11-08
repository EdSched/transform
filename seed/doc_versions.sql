-- 计划书分版本批复（PR 1）：新表 student_doc_versions + bookings.plan_version_id + 把现有完成稿搬成「第 1 版」
-- 执行：Supabase SQL Editor，按顺序分段执行（每段可单独执行，可重复执行）。只新增，不改不删原来的数据。

-- ① 建表 + 索引
create table if not exists public.student_doc_versions (
  id bigserial primary key,
  student_id text not null,
  doc_type text not null default 'plan',          -- plan 计划书 / interview 面试稿
  version_no int not null,
  school_key text,                                -- 空 = 通用版；否则 riyuKeyOf（学校|学部|学科）
  school_name text,
  file_url text not null,
  file_name text,
  source text not null default 'upload',          -- upload 在学习页上传 / booking 面谈预约时上传
  booking_id text,
  student_note text,
  submitted_at timestamptz not null default now(),
  review_file_url text, review_file_name text, review_note text,
  reviewed_by text, reviewed_at timestamptz
);
create index if not exists student_doc_versions_sid on public.student_doc_versions (student_id, doc_type, submitted_at desc);

-- ② 读写规则：照抄 student_plan_drafts 现有的（学生读写自己的、老师和管理员读写）
--    它开了 RLS → 新表也开，并把它的每条规则原样复制一份（表名替换）；没开 → 新表也不开（保持一致）
do $$
declare r record; v_rls boolean; v_sql text;
begin
  select relrowsecurity into v_rls from pg_class where oid = 'public.student_plan_drafts'::regclass;
  if coalesce(v_rls, false) then
    execute 'alter table public.student_doc_versions enable row level security';
    for r in select * from pg_policies where schemaname = 'public' and tablename = 'student_plan_drafts' loop
      execute format('drop policy if exists %I on public.student_doc_versions', 'sdv_' || r.policyname);
      v_sql := format('create policy %I on public.student_doc_versions as %s for %s to %s',
                      'sdv_' || r.policyname, r.permissive, r.cmd, array_to_string(r.roles, ','));
      if r.qual is not null then v_sql := v_sql || ' using (' || replace(r.qual, 'student_plan_drafts', 'student_doc_versions') || ')'; end if;
      if r.with_check is not null then v_sql := v_sql || ' with check (' || replace(r.with_check, 'student_plan_drafts', 'student_doc_versions') || ')'; end if;
      execute v_sql;
    end loop;
  end if;
  raise notice 'student_plan_drafts RLS = %', coalesce(v_rls, false);
end $$;
-- 检查：两张表的规则应一一对应
select tablename, policyname, cmd, roles, qual, with_check from pg_policies
 where tablename in ('student_plan_drafts', 'student_doc_versions') order by tablename, policyname;

-- ③ 面谈预约挂计划书版本
alter table public.bookings add column if not exists plan_version_id bigint;

-- ④ 把现有的完成稿搬成「第 1 版」（已搬过的学生不会重复搬）
insert into public.student_doc_versions (student_id, doc_type, version_no, file_url, file_name, source, submitted_at, review_file_url, review_file_name, reviewed_by, reviewed_at)
select d.student_id::text, 'plan', 1, d.draft_file_url, '计划书完成稿', 'upload', coalesce(d.updated_at, now()), d.reviewed_file_url, d.reviewed_file_name, d.reviewed_by, d.reviewed_at
  from public.student_plan_drafts d
 where d.draft_file_url is not null
   and not exists (select 1 from public.student_doc_versions v where v.student_id = d.student_id::text and v.doc_type = 'plan');

-- ⑤ 数量检查：两个数应该一样（合并前后各跑一次）
select (select count(*) from public.student_plan_drafts where draft_file_url is not null) as old_files,
       (select count(*) from public.student_doc_versions where doc_type = 'plan') as versions;

-- ───────── 回滚 ─────────
-- alter table public.bookings drop column if exists plan_version_id;
-- drop table if exists public.student_doc_versions;
