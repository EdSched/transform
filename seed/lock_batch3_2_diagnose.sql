-- ============================================================
-- 数据库上锁 第 3 批 · PR ② · 只读诊断（不改任何东西）
-- 整段粘进 SQL Editor 运行，把结果表（全部行）复制给 Claude。
-- 内容：access_keys 自动建 Auth 账号的触发器 / sched_courses↔courses 同步触发器 / courses、slots 现有规则 / 身份辅助函数
-- ============================================================
select 'trigger' as kind, t.tgrelid::regclass::text as name,
       t.tgname || ' → ' || p.proname || '  [security_definer=' || p.prosecdef || ']' as info
from pg_trigger t join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and t.tgrelid::regclass::text in ('access_keys','sched_courses','courses','course_sessions','sched_course_id_map','course_original_schedule','slots','sched_access_codes')
union all
select 'function', p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and (p.oid in (select t.tgfoid from pg_trigger t
                 where not t.tgisinternal
                   and t.tgrelid::regclass::text in ('access_keys','sched_courses','courses','course_sessions','sched_course_id_map','course_original_schedule','slots'))
       or p.proname in ('is_admin','is_staff','is_domain_key','current_teacher_id','current_student_id','current_access_domain')
       or p.prosrc ~* 'auth\.users')
union all
select 'policy', tablename || ' / ' || policyname,
       cmd || ' roles=' || roles::text || ' using=' || coalesce(qual,'') || ' check=' || coalesce(with_check,'')
from pg_policies where schemaname = 'public' and tablename in ('courses','slots')
union all
select 'rls', relname, 'rls_enabled=' || relrowsecurity
from pg_class where relnamespace = 'public'::regnamespace and relname in ('courses','slots','sched_access_codes')
order by 1, 2;
