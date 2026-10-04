-- ============================================================
-- 数据库上锁 第 3 批 · PR ① · 准备 SQL（合并 PR 之前执行）
-- 整个文件一次性执行，可重复执行。执行后旧代码照常能用（口令表这一步还没锁）。
--
-- 做了 1 件事：
--   resolve_sched_code(p_code)：用口令换角色记录，只返回这一个口令、且 active = true 的那一行。
--   新代码（sched/common.js 的 getRoleByCode / checkCode）改走它，不再直接读 sched_access_codes。
--   返回整行（id/code/role/label/perms/lead_cats/sort/active…），和以前 select=* 读到的一样，所以页面逻辑不变。
-- ============================================================

create or replace function public.resolve_sched_code(p_code text)
returns setof public.sched_access_codes
language sql
stable
security definer
set search_path = public
as $$
  select * from public.sched_access_codes
  where code = p_code and active = true
  limit 1;
$$;
revoke all on function public.resolve_sched_code(text) from public;
grant execute on function public.resolve_sched_code(text) to anon, authenticated;

-- ── 只读检查（可选）：列出所有引用 sched_access_codes 的数据库函数 ──
-- 把结果贴给 Claude；上锁文件里也有同样的自动检查（有「非 security definer」的函数会拒绝上锁）
select p.proname, p.prosecdef as is_security_definer, pg_get_functiondef(p.oid) as def
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ~* 'sched_access_codes';

-- ── 回滚 ──
-- drop function if exists public.resolve_sched_code(text);
