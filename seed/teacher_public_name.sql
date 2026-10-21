-- 老师「对外名称」统一：只保留 teachers.display_name 一个
-- 执行顺序：先执行本文件（合并 PR 之前），再合并上线。

-- 1) 迁移：display_name 为空、notes 不为空的老师，把 notes 复制到 display_name（先备份被改的行）
create table if not exists public.teachers_pubname_backup (
  id text primary key,
  old_display_name text,
  migrated_at timestamptz default now()
);

insert into public.teachers_pubname_backup (id, old_display_name)
select id::text, display_name from public.teachers
where coalesce(display_name,'')='' and coalesce(notes,'')<>''
on conflict (id) do nothing;

update public.teachers
set display_name = trim(notes)
where coalesce(display_name,'')='' and coalesce(notes,'')<>'';

-- 2) 只读：两边都有值但不一样的老师，请 Sensis 自己决定（不会自动处理）
select id, name, display_name as 老师自填昵称, notes as 管理端备注
from public.teachers
where coalesce(display_name,'')<>'' and coalesce(notes,'')<>'' and display_name<>notes;

-- ===== 回滚（把这次复制过去的值清空/恢复）=====
-- update public.teachers t
-- set display_name = nullif(b.old_display_name,'')
-- from public.teachers_pubname_backup b
-- where t.id::text = b.id;
-- drop table public.teachers_pubname_backup;
