-- ============================================================
-- 工作记录按领域分（PR：工作管理只算本领域 / VIP 课时进工作记录）
-- 合并 PR 之前执行；可重复执行。
-- ============================================================

-- 1. 加 domain 列：提交时写入这条记录所属领域；旧记录为空（只在管理员「全部」视角显示）
alter table public.work_records add column if not exists domain text;
create index if not exists work_records_domain_idx on public.work_records (domain);

-- 2.（只查看，不改任何东西）看看 work_records 现在有没有开 RLS、有哪些规则：
--    如果 rowsecurity = false 且没有策略 → 现在谁都能读写，管理模式的负责人不会被拦，不需要再做什么；
--    如果 rowsecurity = true → 把查询结果发给我，我按实际规则补「负责人按 domain 读 / 写 / 审核」的策略。
select relname, relrowsecurity as rowsecurity from pg_class where oid = 'public.work_records'::regclass;
select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'work_records';

-- ── 回滚 ──
-- drop index if exists public.work_records_domain_idx;
-- alter table public.work_records drop column if exists domain;
