-- ============================================================
-- 合格实绩⑩：学生真名对外不可读
-- 合并 PR 之前在 Supabase SQL Editor 一次性执行；可重复执行。
--
-- 做了什么：
--  1. admission_results / undergrad_results：收回 anon 的整表读取权限，
--     再只给 anon 读「除 student、student_id、entered_by 以外」的列（从 information_schema 现生成，不手写）。
--     authenticated（老师、管理员）不受影响。匿名提交（insert）不动。
--  2. 新函数 result_dup_exists(...)：按学生名查重，只返回 true/false，不返回数据。
--
-- 注意：以后给这两张表新增的列，匿名公开页面默认读不到；要公开就再执行一次本脚本（可重复）。
-- 执行后自检（没登录、用公开 key）：
--   admission_results?select=student  → 报错（permission denied）
--   admission_results?select=univ,dept → 正常
-- ============================================================
begin;

do $$
declare
  t text;
  cols text;
begin
  foreach t in array array['admission_results', 'undergrad_results'] loop
    select string_agg(format('%I', column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t
       and column_name not in ('student', 'student_id', 'entered_by');
    if cols is null then
      raise exception '找不到表 public.% 的列', t;
    end if;
    execute format('revoke select on table public.%I from anon', t);
    execute format('grant select (%s) on public.%I to anon', cols, t);
    -- 匿名提交照常：确保 anon 仍有 insert
    execute format('grant insert on table public.%I to anon', t);
  end loop;
end $$;

-- 查重：只回答有没有，不返回任何行。p_kind = 'grad' | 'ug'
-- p_jp / p_eng：大学院 = JLPT 分数 / 英语分数；学部 = EJU 日语 / TOEFL 或 TOEIC 分数。传 null 表示该项也为空。
create or replace function public.result_dup_exists(
  p_kind text, p_student text, p_univ text,
  p_dept text default null, p_jp int default null, p_eng int default null
) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(trim(p_student), '') = '' then return false; end if;
  if p_kind = 'grad' then
    return exists (select 1 from public.admission_results r
      where r.student = trim(p_student) and r.univ = p_univ
        and r.dept is not distinct from p_dept
        and r.jlpt_score is not distinct from p_jp
        and r.eng_score is not distinct from p_eng);
  elsif p_kind = 'ug' then
    return exists (select 1 from public.undergrad_results r
      where r.student = trim(p_student) and r.univ = p_univ
        and r.dept is not distinct from p_dept
        and r.eju_japanese is not distinct from p_jp
        and coalesce(r.toefl, r.toeic) is not distinct from p_eng);
  end if;
  return false;
end $$;
revoke all on function public.result_dup_exists(text, text, text, text, int, int) from public;
grant execute on function public.result_dup_exists(text, text, text, text, int, int) to anon, authenticated;

commit;

-- ============================================================
-- 回滚（整段执行）：
-- begin;
-- grant select on table public.admission_results to anon;
-- grant select on table public.undergrad_results to anon;
-- drop function if exists public.result_dup_exists(text, text, text, text, int, int);
-- commit;
-- ============================================================
