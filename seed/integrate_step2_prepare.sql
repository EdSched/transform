-- ============================================================
-- 整合第 2 步：管理端「资源管理」（嵌入排课系统）—— 准备 SQL（合并 PR 之前执行）
-- 整个文件一次性执行，可重复执行。不锁任何表；排课系统的数据、同步触发器都不动。
--
-- 只建一个函数 sched_session_role()：排课系统（嵌入管理端时）带着登录会话 token 调它，
-- 问「我是谁」——管理员 / 负责人老师（带 resource_perms）/ 都不是（返回 null）。
-- 前提：整合第 1 步的准备 SQL 已执行（teachers.resource_perms、current_teacher_id() 存在）。
--
-- 邮箱取法：没有找到名叫 jwt_email() 的函数，这里直接读 JWT 里的 email（auth.jwt()->>'email'），不依赖别的函数。
-- 想确认 is_admin() 本身怎么判断（只读，可选）：
--    select pg_get_functiondef('public.is_admin()'::regprocedure);
-- ============================================================
create or replace function public.sched_session_role()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_admin() then
      jsonb_build_object('kind', 'admin', 'email', coalesce(auth.jwt() ->> 'email', ''))
    when public.current_teacher_id() is not null then (
      select jsonb_build_object('kind', 'teacher', 'name', t.name, 'perms', to_jsonb(coalesce(t.resource_perms, '{}'::text[])))
      from public.teachers t
      where t.id = public.current_teacher_id()
    )
    else null
  end;
$$;
grant execute on function public.sched_session_role() to anon, authenticated;

-- ── 回滚 ──
-- drop function if exists public.sched_session_role();
