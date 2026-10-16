-- 角色模板 · 范围规则可设置 + 「检查全部老师」保持原状
-- 合并 PR 前在 Supabase SQL Editor 执行；可重复执行；回滚见文件末尾

-- ── 1. teachers：记录「这位老师现在的差异是确认过的」{miss:[…], extra:[…]} ──
alter table public.teachers add column if not exists role_diff_ack jsonb;

-- ── 2. 对接、营业带上两个范围开关的当前值（迁移后效果不变） ──
--   对接：看全部领域的学生 = 是；出愿 = 否    营业：学生 = 是；出愿 = 是
--   其他角色：缺开关的补成 false；已经有值的不动
update public.role_templates set defaults = defaults
  || jsonb_build_object('see_all_students', true,  'see_all_admission', false) where key = 'liaison';
update public.role_templates set defaults = defaults
  || jsonb_build_object('see_all_students', true,  'see_all_admission', true)  where key = 'sales';
update public.role_templates set defaults =
  jsonb_build_object('see_all_students', false, 'see_all_admission', false, 'needs_manage_scope', false) || defaults
  where key not in ('liaison', 'sales');
-- 负责人需要设管理范围（和 seed 一致）
update public.role_templates set defaults = defaults || '{"needs_manage_scope": true}'::jsonb where key = 'lead';
-- 自定义职位 / 角色（c_ 开头）如果用了老的写法，同样补齐三个开关（上面最后一条 update 已覆盖）

-- 检查：select key, defaults->'see_all_students' s, defaults->'see_all_admission' a, defaults->'needs_manage_scope' n from public.role_templates order by sort;

-- ── 回滚 ──
-- alter table public.teachers drop column if exists role_diff_ack;
-- 两个开关本来就在 seed 里，回滚只需要把中枢里改过的角色改回去；不需要删字段
