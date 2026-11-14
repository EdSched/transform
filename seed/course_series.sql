-- 系列课：几门同专业的课「接续」或「同日分段」排，一次算日期、一次占教室
-- 由 Sensis 在 Supabase SQL Editor 手动执行；必须在系列课 PR 合并之前执行。回滚在文件最后。
--
-- 做什么：
--   1) 新表 course_series（系列：名字、排法 chain 接续 / split 同日分段、专业、框架）
--   2) courses 加 series_id / series_order
--   3) course_series 的 RLS：把 courses 现有的策略原样复制一份
--   4) 视图 sched_course_v：merge_group / merge_name / merge_order 改成系列（series_id / 系列名 / series_order），再加一列 series_mode；
--      其余列一个字没动。旧的 sched_merge_* 三列不删、不再使用（已确认没有课在用）。
--   5) course_templates 加 series_mode / series_members（系列模板）
--
-- ============================================================
-- 执行顺序
--   0) 先跑「A. 预检」，确认线上视图和 B.4 的写法一致（有出入先把结果给 Claude 看，不要直接跑 B）
--   1) 执行「B. 迁移」
--   2) 跑「C. 验证」
--   3) 合并 PR，等 CDN 约 10 分钟，用无痕窗口 + 强制刷新测试
-- ============================================================

-- ============================================================
-- A. 预检（只读）
-- ============================================================
-- A.1 线上视图现在的定义（对照 B.4：列的顺序、名字不能少；目前仓库里最新的写法在 seed/course_form_v2.sql）
select pg_get_viewdef('public.sched_course_v'::regclass, true);
-- A.2 旧的合并确实没人用（应返回空）
select sched_merge_name, count(*) from public.courses where sched_merge_group is not null group by 1;
-- A.3 courses 现有的 RLS 策略（B.3 会照着复制）
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname='public' and tablename='courses';

-- ============================================================
-- B. 迁移
-- ============================================================
begin;

-- B.1 系列表
create table if not exists public.course_series (
  id                 text primary key,
  name               text not null,
  mode               text not null default 'chain' check (mode in ('chain','split')),   -- chain 接续 / split 同日分段
  first_session_date date,
  weekdays           text,
  time_range         text,                   -- 接续：所有成员共用的上课时间；同日分段不用
  campus             text,
  holiday_except     text,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
-- major 列：类型照抄 courses.major（跟课程同样的格式）
do $do$
begin
  execute format('alter table public.course_series add column if not exists major %s',
    (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.courses'::regclass and a.attname = 'major' and not a.attisdropped));
end $do$;

-- B.2 courses 加两列
alter table public.courses add column if not exists series_id    text;
alter table public.courses add column if not exists series_order integer;
create index if not exists courses_series_id_idx on public.courses (series_id) where series_id is not null;

-- B.3 RLS：照 courses 现有策略复制一份
alter table public.course_series enable row level security;
do $do$
declare r record; cmd_sql text;
begin
  for r in select * from pg_policies where schemaname='public' and tablename='courses' loop
    cmd_sql := format('create policy %I on public.course_series as %s for %s to %s',
      replace(r.policyname, 'courses', 'course_series'), r.permissive, r.cmd, array_to_string(r.roles, ','));
    if r.qual is not null then cmd_sql := cmd_sql || ' using (' || r.qual || ')'; end if;
    if r.with_check is not null then cmd_sql := cmd_sql || ' with check (' || r.with_check || ')'; end if;
    execute cmd_sql;
  end loop;
end $do$;
grant select on public.course_series to anon, authenticated;
grant insert, update, delete on public.course_series to authenticated;

-- B.4 视图：以线上现在的定义为准（预检 A.1 的结果），只改 merge_* 三列、末尾加 series_mode
create or replace view public.sched_course_v as
select c.id,
  case when c.campus = '腾讯会议'::text then '线上'::text else coalesce(c.campus, '线上'::text) end as campus,
  coalesce(c.domain, '大学院文科'::text) as category,
  coalesce(c.name, '未命名课程'::text) as name,
  c.teacher,
  null::integer as weekday,
  t.st as start_time,
  t.et as end_time,
  coalesce(c.start_date, d.min_d, c.first_session_date) as start_date,
  coalesce(c.end_date, d.max_d) as end_date,
  c.total_sessions as sessions,
  c.est_students,
  coalesce(c.delivery, '线上'::text) as mode,
  c.meeting_url as meeting_link,
  true as confirmed,
  null::text as note,
  c.created_at,
  c.weekdays,
  case when c.first_session_date is not null and c.period is not null
       then (to_char(c.first_session_date::timestamp with time zone, 'YYYY'::text) || '年'::text) || c.period
       else c.period end as term,
  major_code_to_cn(c.major) as major,
  c.course_type,
  c.skip_dates,
  c.meeting_id,
  c.meeting_template_id,
  c.series_id as merge_group,
  sr.name as merge_name,
  c.series_order as merge_order,
  c.skip_reasons,
  c.holiday_except,
  null::timestamp with time zone as deleted_at,
  null::text as deleted_by,
  c.host_key,
  c.sched_removed_reason,
  c.sched_removed_at,
  m.sched_id as legacy_sched_id,
  c.time_range as class_time_range,
  sr.mode as series_mode
from courses c
  left join course_series sr on sr.id = c.series_id
  left join lateral ( select to_char(min(seg.s)::interval, 'HH24:MI'::text) as st,
          to_char(max(seg.e)::interval, 'HH24:MI'::text) as et
         from ( select trim(both from split_part(x.x, '-'::text, 1))::time without time zone as s,
                  trim(both from split_part(x.x, '-'::text, 2))::time without time zone as e
                 from regexp_split_to_table(regexp_replace(coalesce(c.time_range, ''::text), '[–~～]'::text, '-'::text, 'g'::text), '\s*[/／,，、]\s*'::text) x(x)
                where x.x ~ '^\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*$'::text) seg) t on true
  left join lateral ( select min(cs.session_date) as min_d,
          max(cs.session_date) as max_d
         from course_sessions cs
        where cs.course_id = c.id) d on true
  left join sched_course_id_map_legacy m on m.course_id = c.id;

grant select on public.sched_course_v to anon, authenticated;

-- B.5 系列模板
alter table public.course_templates add column if not exists series_mode    text;
alter table public.course_templates add column if not exists series_members jsonb;

commit;

-- ============================================================
-- C. 验证（只读）
-- ============================================================
select count(*) as series_table_ok from public.course_series;
select column_name from information_schema.columns where table_schema='public' and table_name='courses' and column_name in ('series_id','series_order');
select column_name from information_schema.columns where table_schema='public' and table_name='course_templates' and column_name in ('series_mode','series_members');
select policyname, cmd from pg_policies where schemaname='public' and tablename='course_series';
select id, name, merge_group, merge_name, merge_order, series_mode from public.sched_course_v limit 3;   -- 还没建系列时 merge_* / series_mode 全是空，正常

-- ============================================================
-- 回滚
-- 视图要先删再建（create or replace 不能改列）：用 seed/course_form_v2.sql 回滚段里的旧写法，
--   把其中 c.sched_merge_group / c.sched_merge_name / c.sched_merge_order 三行保留，并保留 class_time_range 一列（也就是 B.4 里去掉 series 的版本）
-- ============================================================
-- begin;
-- -- 1) 先把视图改回旧的合并写法（见上面说明，没有 series_mode 这一列）
-- -- 2) 再删新东西：
-- alter table public.course_templates drop column if exists series_mode;
-- alter table public.course_templates drop column if exists series_members;
-- alter table public.courses drop column if exists series_id;
-- alter table public.courses drop column if exists series_order;
-- drop table if exists public.course_series;
-- commit;
