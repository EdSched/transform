-- ============================================================
-- 数据库上锁 第 3 批 · PR ③ · 只读诊断（不改任何东西）
-- 整段粘进 SQL Editor 运行，把结果表（全部行）复制给 Claude。
-- 内容：所有 sched_% 表的 RLS 状态 / 现有规则 / 挂在上面的触发器（含是否 security definer）
-- ============================================================
select 'table' as kind, c.relname as name, 'rls_enabled=' || c.relrowsecurity as info
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'sched\_%'
union all
select 'policy', tablename || ' / ' || policyname,
       cmd || ' roles=' || roles::text || ' using=' || coalesce(qual,'') || ' check=' || coalesce(with_check,'')
from pg_policies where schemaname = 'public' and tablename like 'sched\_%'
union all
select 'trigger', t.tgrelid::regclass::text,
       t.tgname || ' → ' || p.proname || '  [security_definer=' || p.prosecdef || ']'
from pg_trigger t join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal and t.tgrelid::regclass::text like 'sched\_%'
union all
select 'function', p.proname, '[security_definer=' || p.prosecdef || '] 引用: ' ||
       (select string_agg(distinct m[1], ', ') from regexp_matches(p.prosrc, '(sched_[a-z_]+)', 'g') as m)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ~* 'sched_[a-z_]+'
order by 1, 2;
