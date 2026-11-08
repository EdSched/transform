-- 面试稿（PR 2）：文书指导可挂参考文档 + 检查 kind 有没有被表约束拦住
-- 执行：Supabase SQL Editor，按顺序分段执行。可重复执行，只新增，不改不删数据。

-- ① 文书指导加「参考文档」列（[{name,url}]），对所有 kind 生效
alter table public.writing_guides add column if not exists ref_files jsonb;

-- ② 检查：riyu_submissions / writing_guides 的 kind 有没有 check 约束（面试稿的 kind 是 grad_interview）
--    结果为空 = 没有约束，不用管。如果有约束而且没有包含 grad_interview，把结果发给我，我给你对应的放行语句
select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid) as def
  from pg_constraint
 where conrelid in ('public.riyu_submissions'::regclass, 'public.writing_guides'::regclass) and contype = 'c';

-- ③ 数量检查（合并前后各跑一次，应该不变）：计划书版本 + 已有文书数
select (select count(*) from public.student_doc_versions where doc_type = 'plan') as plan_versions,
       (select count(*) from public.riyu_submissions) as riyu_rows,
       (select count(*) from public.writing_guides) as guides;

-- ───────── 回滚 ─────────
-- alter table public.writing_guides drop column if exists ref_files;
