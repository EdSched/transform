-- ============================================================
-- 课程：记住「需要单回明细」开关（courses.has_details）
-- 合并 PR 之前在 Supabase SQL Editor 一次性执行；可重复执行（列已存在时整段跳过，不会覆盖已保存的开关）。
--
-- 现有课程的初始值：只要有一回满足下面任一条，就设为 true，否则 false：
--   1. 有单回内容，并且不是「休讲」
--   2. session_teacher 不为空，并且和 courses.teacher 不一样
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='courses' and column_name='has_details'
  ) then
    alter table public.courses add column has_details boolean not null default false;

    update public.courses c
    set has_details = exists (
      select 1 from public.course_sessions s
      where s.course_id = c.id
        and (
          (coalesce(trim(s.session_title),'') <> '' and trim(s.session_title) <> '休讲')
          or (coalesce(trim(s.session_teacher),'') <> '' and trim(s.session_teacher) is distinct from trim(c.teacher))
        )
    );
  end if;
end $$;

-- 回滚：
-- alter table public.courses drop column if exists has_details;
