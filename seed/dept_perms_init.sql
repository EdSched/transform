-- ============================================================
-- 美术部负责人 · 初始设定（PR ②；Sensis 执行，可重复执行）
-- 前提：已执行 dept_perms_prepare.sql。按姓名设置职位 / 管理范围 / 部门管理权限：
--   张曦炜：负责人，大学院美术 + 学部美术，部门管理权限 = 价目编辑 + 专业增删 + 宣传内容 + 本范围老师管理（全部四项）
--   张梦琰：负责人，大学院美术 + 学部美术，部门管理权限 = 宣传内容 + 本范围老师管理（不调价格；专业增删先不给）
--   尤一童：负责人，学部美术，不给部门管理权限
--   程斯  ：负责人，大学院美术 + 专业「表象」，不给部门管理权限
-- 管理范围里原有的班级（class_ids）保留不动。
-- ============================================================

-- 0. 只读：先确认 4 个人都能按姓名找到（应各 1 行；重名 / 找不到请先别往下执行）、「表象」专业代号
select name, id, position, manage_scope, dept_perms from public.teachers where name in ('张曦炜','张梦琰','尤一童','程斯') order by name;
select key, label, domain from public.majors where label like '%表象%';

-- 1. 设置
update public.teachers set
  position = 'lead',
  manage_scope = jsonb_build_object('domains', '["大学院美术","学部美术"]'::jsonb, 'majors', '[]'::jsonb, 'class_ids', coalesce(manage_scope->'class_ids', '[]'::jsonb)),
  dept_perms = '{pricing,majors,promo,teachers}'::text[]
where name = '张曦炜';

update public.teachers set
  position = 'lead',
  manage_scope = jsonb_build_object('domains', '["大学院美术","学部美术"]'::jsonb, 'majors', '[]'::jsonb, 'class_ids', coalesce(manage_scope->'class_ids', '[]'::jsonb)),
  dept_perms = '{promo,teachers}'::text[]
where name = '张梦琰';

update public.teachers set
  position = 'lead',
  manage_scope = jsonb_build_object('domains', '["学部美术"]'::jsonb, 'majors', '[]'::jsonb, 'class_ids', coalesce(manage_scope->'class_ids', '[]'::jsonb)),
  dept_perms = '{}'::text[]
where name = '尤一童';

-- 程斯的「表象」：专业代号按上面第 0 步查到的为准（下面按现有资料写的是 hyosho）
update public.teachers set
  position = 'lead',
  manage_scope = jsonb_build_object('domains', '["大学院美术"]'::jsonb, 'majors', '["hyosho"]'::jsonb, 'class_ids', coalesce(manage_scope->'class_ids', '[]'::jsonb)),
  dept_perms = '{}'::text[]
where name = '程斯';

-- 2. 检查
select name, position, manage_scope, dept_perms from public.teachers where name in ('张曦炜','张梦琰','尤一童','程斯') order by name;

-- ============================================================
-- 回滚：只清掉部门管理权限（职位 / 范围按你原来的设定自己改回去；执行第 0 步的结果请先留一份）
-- ============================================================
-- update public.teachers set dept_perms = '{}'::text[] where name in ('张曦炜','张梦琰','尤一童','程斯');
