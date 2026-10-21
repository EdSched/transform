-- 老师「对外名称」和「昵称」重新分开
--   真名     teachers.name          管理员填    内部系统
--   对外名称 teachers.public_name   管理员填    营业、宣传（宣传页、资料包、课程担当等）
--   昵称     teachers.display_name  老师自己填  学生端（预约时间槽、VIP 学生页、作业批改人等）
-- 没填时：学生端 昵称 → 对外名称 → 真名；营业/宣传 对外名称 → 真名
-- 执行顺序：先执行本文件（合并 PR 之前），再合并上线。

alter table public.teachers add column if not exists public_name text;

-- 1) 对外名称：notes 一直就是宣传名，复制到 public_name（只处理 notes 不为空、public_name 为空的）
create table if not exists public.teachers_pubname_split_backup (
  id text primary key,
  old_public_name text,
  migrated_at timestamptz default now()
);
insert into public.teachers_pubname_split_backup (id, old_public_name)
select id::text, public_name from public.teachers
where coalesce(notes,'')<>'' and coalesce(public_name,'')=''
on conflict (id) do nothing;

update public.teachers
set public_name = trim(notes)
where coalesce(notes,'')<>'' and coalesce(public_name,'')='';

-- 2) 昵称还原：上次迁移（teachers_pubname_backup）复制过去、老师之后没改过的（display_name = trim(notes)），
--    还原成迁移前的值（一般是空）。老师已经自己改过的，不动。
--    如果库里没有 teachers_pubname_backup（上次迁移没留下备份），这一步自动跳过，改看下面第 3 步的候选名单自己定。
create table if not exists public.teachers_pubname_split_backup2 (
  id text primary key,
  restored_from text,          -- 还原前的 display_name
  restored_to text,            -- 还原后的值
  migrated_at timestamptz default now()
);
do $$
begin
  if to_regclass('public.teachers_pubname_backup') is not null then
    insert into public.teachers_pubname_split_backup2 (id, restored_from, restored_to)
    select t.id::text, t.display_name, nullif(b.old_display_name, '')
    from public.teachers t
    join public.teachers_pubname_backup b on b.id = t.id::text
    where t.display_name = trim(t.notes)
    on conflict (id) do nothing;

    update public.teachers t
    set display_name = b2.restored_to
    from public.teachers_pubname_split_backup2 b2
    where t.id::text = b2.id and t.display_name = b2.restored_from;
  else
    raise notice '没有 teachers_pubname_backup，跳过昵称还原；请看第 3 步的候选名单';
  end if;
end $$;

-- 3) 只读核对 A（没有备份表时用）：昵称和备注完全一样的老师——可能是上次迁移复制过去的，也可能是老师自己填的，请自己判断
--    要清空某位老师的昵称：update public.teachers set display_name = null where id = '这里填 id';
select id, name as 真名, display_name as 昵称, notes as 备注
from public.teachers
where coalesce(display_name,'')<>'' and display_name = trim(notes);

-- 4) 只读核对 B：每位老师的真名、对外名称、昵称、备注
select id, name as 真名, public_name as 对外名称, display_name as 昵称, notes as 备注
from public.teachers
order by name;

-- ===== 回滚 =====
-- -- 还原昵称（第 2 步还原掉的值设回去）
-- update public.teachers t set display_name = b2.restored_from
-- from public.teachers_pubname_split_backup2 b2 where t.id::text = b2.id and t.display_name is not distinct from b2.restored_to;
-- -- 清空这次复制出来的对外名称
-- update public.teachers t set public_name = nullif(b.old_public_name, '')
-- from public.teachers_pubname_split_backup b where t.id::text = b.id;
-- drop table public.teachers_pubname_split_backup2;
-- drop table public.teachers_pubname_split_backup;
-- -- 需要的话再删列：alter table public.teachers drop column public_name;
