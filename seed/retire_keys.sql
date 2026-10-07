-- ============================================================
-- 停用访问链接（access_keys）和排课口令（sched_access_codes）· PR ① 的 SQL
-- 在 Supabase SQL Editor 里按顺序执行；不删任何数据，只是停用，可随时回滚。
-- 顺序：先合并 PR（页面不再用钥匙/口令），再执行本文件第 2、3 步。
--
-- 为什么 active=false 就够让数据库也失效：
--   current_access_domain() 只认 active 的访问链接，current_sched_code() 只认启用中的口令，
--   停用后这两把钥匙登录得上也没有任何数据库权限。
-- Auth 账号（*@access.local / *@sched.local）选「封禁」而不是删除：
--   封禁 = 账号还在、只是不能登录，回滚时解除封禁即可；删除了就要靠触发器重建，更麻烦。
-- ============================================================

-- ── 1. 只读：合并前请 Sensis 对一遍，每把链接对应的人是否都已有老师账号 + 负责人范围 ──
select k as 链接编号, label as 备注, domains as 领域, majors as 专业, class_ids as 班级, is_admin, active as 启用中
from public.access_keys order by created_at;
-- 老师那边：有负责人范围（manage_scope 不为空）的老师
select id, name, manage_scope, resource_perms
from public.teachers
where manage_scope is not null and manage_scope <> '{}'::jsonb
order by name;

-- ── 2. 停用（不删数据）────────────────────────────────────────
update public.access_keys       set active = false where active is distinct from false;
update public.sched_access_codes set active = false where active is distinct from false;

-- ── 3. 封禁对应的 Auth 账号（不删）────────────────────────────
update auth.users
   set banned_until = 'infinity'
 where email like '%@access.local' or email like '%@sched.local';

-- ── 4. 检查（应该全是 0）──────────────────────────────────────
select (select count(*) from public.access_keys where active)        as 仍启用的访问链接,
       (select count(*) from public.sched_access_codes where active) as 仍启用的排课口令,
       (select count(*) from auth.users
         where (email like '%@access.local' or email like '%@sched.local')
           and (banned_until is null or banned_until < now()))       as 未封禁的钥匙账号;

-- ============================================================
-- 回滚（重新启用；先在执行第 2 步之前把第 1 步的结果存一份，回滚时就知道原来哪些是停用的）
-- 下面是「全部重新启用」。原本就停用的那几把请自己再停回去。
-- ============================================================
-- update auth.users set banned_until = null
--  where email like '%@access.local' or email like '%@sched.local';
-- update public.access_keys        set active = true;
-- update public.sched_access_codes set active = true;
