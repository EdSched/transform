-- 老师端首页快捷卡片：teachers 加一个字段（合并 PR 之前执行；可重复执行）
-- 内容是数组，例如 [{"type":"tab","tab":"studentmgmt"},{"type":"student","id":"…","label":"张三"},{"type":"resource"}]
-- 老师自己保存：和保存昵称（display_name）一样，老师登录后直接更新自己那一行（teachers 表现有的规则已经允许；
-- 整合第 1 步的防提权触发器只拦 manage_scope / resource_perms，不影响这一列）。
alter table public.teachers add column if not exists home_shortcuts jsonb not null default '[]';

-- 回滚：
-- alter table public.teachers drop column if exists home_shortcuts;
