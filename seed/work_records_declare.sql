-- ============================================================
-- 老师端「工资申告」：老师往 work_records 写 source='declare' 的记录
-- 不需要改数据库。
-- ============================================================

-- 只查看：work_records 有没有开 RLS、有哪些规则
select relname, relrowsecurity as rowsecurity from pg_class where oid = 'public.work_records'::regclass;
select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'work_records';

-- 已确认的现状（Sensis 执行结果）：已开 RLS，只有一条
--   staff_all | ALL | {public} | is_staff() | is_staff()
-- is_staff() = 管理员、领域访问链接、老师，所以老师已经可以新建 / 修改 / 撤回申告，不用再加规则。
-- （副作用：任何老师账号技术上都能改别人的工作记录，这是原来就有的状态，本次没有收紧。）
