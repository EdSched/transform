-- ============================================================
-- 面试准备：老师补充的问题（模拟面试里「同步给学生」→ 学生面试准备顶部高亮、请学生回答）
-- 新表 student_interview_extras；学生的回答仍存 riyu_submissions.sections[item_key]，这里只存题目和老师的补充要点。
--
-- 执行顺序（Supabase SQL Editor，按段执行，每段下面都有回滚）：
--   ⓪ 检查：依赖的函数在不在、表和规则有没有遗留
--   ① 建表 + 唯一约束 + 索引
--   ② 开 RLS + 规则（学生只读自己的；老师 / 管理员读写自己范围内的学生）
--   ③ 检查
--   ④ 回滚（整张表删掉；表里只有补充题，不影响学生已写的回答）
--
-- 谁能做什么：
--   管理员（is_admin()）：读写全部
--   老师：读写「能看这个学生文书」的学生（can_view_student_docs，和 riyu_submissions 同一套范围，见 student_docs_scope.sql）
--   学生：只能读自己（student_id = current_student_id()），不能新增 / 修改 / 删除，所以改不了 teacher_note
--   匿名：什么都做不了
-- ============================================================

-- ============================================================
-- ⓪ 检查（只读）
-- ============================================================
-- 下面三个函数都要有（没有 can_view_student_docs 说明 seed/student_docs_scope.sql 还没执行：先执行它再往下）
select proname from pg_proc where proname in ('is_admin', 'current_student_id', 'current_teacher_id', 'can_view_student_docs') order by 1;
-- 表还没建时这里返回 0 行；如果已经有同名表，先看看里面的规则有没有遗留的宽松策略（public all）
select * from pg_policies where tablename = 'student_interview_extras';

-- ============================================================
-- ① 建表
-- ============================================================
begin;

create table if not exists public.student_interview_extras (
  id                uuid primary key default gen_random_uuid(),
  student_id        text not null,
  row_key           text not null,                 -- 这道题属于哪一行答案：志望校 key，或 _common / _common@版本（不指定学校用 _common）
  item_key          text not null,                 -- 'x_' + 随机串；学生答案按这个 key 存进 riyu_submissions.sections
  q                 text not null,                 -- 题目文字
  teacher_note      text,                          -- 老师的补充要点（回答思路 / 要点），可空
  source_booking_id text,                          -- 来自哪次模拟面试（bookings.id），可空
  created_by        text,                          -- 老师名
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  archived          boolean not null default false, -- 不想要了就归档，不真删
  constraint student_interview_extras_uniq unique (student_id, row_key, item_key)
);
create index if not exists student_interview_extras_student_idx on public.student_interview_extras (student_id) where archived = false;
create index if not exists student_interview_extras_booking_idx on public.student_interview_extras (source_booking_id);

commit;
-- 回滚 ①：
-- drop table if exists public.student_interview_extras;

-- ============================================================
-- ② RLS（可重复执行：先清掉这张表现有的全部规则，再建新规则）
-- ============================================================
begin;

alter table public.student_interview_extras enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'student_interview_extras' loop
    execute format('drop policy if exists %I on public.student_interview_extras', r.policyname);
  end loop;
end $$;

-- 学生：只读自己的行
create policy sie_student_read on public.student_interview_extras for select to authenticated
  using (student_id = public.current_student_id());

-- 管理员 / 老师（能看这个学生文书的）：读写
create policy sie_staff_all on public.student_interview_extras for all to authenticated
  using (coalesce(public.is_admin(), false) or (public.current_teacher_id() is not null and public.can_view_student_docs(student_id)))
  with check (coalesce(public.is_admin(), false) or (public.current_teacher_id() is not null and public.can_view_student_docs(student_id)));

commit;
-- 回滚 ②（关掉 RLS；之后需要的话再 drop table）：
-- alter table public.student_interview_extras disable row level security;
-- drop policy if exists sie_student_read on public.student_interview_extras;
-- drop policy if exists sie_staff_all on public.student_interview_extras;

-- ============================================================
-- ③ 检查
-- ============================================================
select tablename, policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'student_interview_extras';
select relname, relrowsecurity from pg_class where oid = 'public.student_interview_extras'::regclass;
-- 用学生账号登录学习页：面试准备顶部应出现老师补充的题；用另一个学生登录看不到；学生在控制台试 PATCH teacher_note 应返回 0 行 / 403。

-- ============================================================
-- ④ 整体回滚（删表）
-- ============================================================
-- drop table if exists public.student_interview_extras;
