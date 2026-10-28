-- 课程安排录入重整（第 1 步）：期数自动规则 + 排课按上课时间所有时间段的最早～最晚占教室
-- 由 Sensis 在 Supabase SQL Editor 手动执行；必须在 PR1（管理端表单）合并之前执行。回滚在文件最后。
--
-- 做什么：
--   1) courses 加一列 period_auto：这门课的期数是按「自动排期」规则算出来的（以后改日期会自动重算）
--   2) courses.period 允许为空：期数选「暂定（之后调整）」时存空
--   3) 视图 sched_course_v：
--        · start_time / end_time = 上课时间所有时间段里最早的开始～最晚的结束（10:00-12:00/13:00-15:00 → 10:00、15:00），排课按它占教室
--        · 多出一列 class_time_range = courses.time_range 原样（两段就是两段），排课用它显示准确的上课时间
--        · term：自动排期的课直接用算出来的期数（如 2027春夏期）；期数为空的显示「暂定」；其余和原来一样（年份 || '年' || period）
--      其余列一个字没动；已经建好的课、已经填好的期数都不受影响。
--
-- ============================================================
-- 执行顺序
--   0) 先跑「A. 预检」，确认线上视图和这里的写法一致（有出入先把结果给 Claude 看，不要直接跑 B）
--   1) 执行「B. 迁移」
--   2) 合并 PR1，等 CDN 约 10 分钟，用无痕窗口 + 强制刷新测试
-- ============================================================

-- ============================================================
-- A. 预检（只读）
-- ============================================================
-- A.1 线上视图现在的定义（对照下面 B.3 的写法，列的顺序、名字不能少）
select pg_get_viewdef('public.sched_course_v'::regclass, true);

-- A.2 有没有别的视图 / 函数依赖这个视图（有的话 B.3 的 create or replace 没问题，但回滚用的 drop view 会失败，到时再处理）
select distinct dependent.relname
from pg_depend d
join pg_rewrite r on r.oid = d.objid
join pg_class dependent on dependent.oid = r.ev_class
where d.refobjid = 'public.sched_course_v'::regclass and dependent.oid <> 'public.sched_course_v'::regclass;

-- ============================================================
-- B. 迁移
-- ============================================================
begin;

-- B.1 期数是不是按自动规则算出来的
alter table public.courses add column if not exists period_auto boolean not null default false;

-- B.2 期数选「暂定」时存空（原来如果已经允许为空，这句不会有任何变化）
alter table public.courses alter column period drop not null;

-- B.3 视图：start_time / end_time 取最早～最晚；多一列 class_time_range；term 认自动排期
--     旧的课程号对照表如果已经改名成 sched_course_id_map_legacy（课程只留一份·第 3 步执行过），自动用改名后的；没改名就用原来的
do $do$
declare
  map_tbl text := case when to_regclass('public.sched_course_id_map_legacy') is not null then 'sched_course_id_map_legacy' else 'sched_course_id_map' end;
begin
  execute replace($v$
create or replace view public.sched_course_v as
select
  c.id                                                                    as id,
  case when c.campus = '腾讯会议' then '线上' else coalesce(c.campus, '线上') end as campus,
  coalesce(c.domain, '大学院文科')                                        as category,
  coalesce(c.name, '未命名课程')                                          as name,
  c.teacher                                                               as teacher,
  null::integer                                                           as weekday,
  t.st                                                                    as start_time,
  t.en                                                                    as end_time,
  coalesce(c.start_date, d.min_d, c.first_session_date)                   as start_date,
  coalesce(c.end_date, d.max_d)                                           as end_date,
  c.total_sessions                                                        as sessions,
  c.est_students                                                          as est_students,
  coalesce(c.delivery, '线上')                                            as mode,
  c.meeting_url                                                           as meeting_link,
  true                                                                    as confirmed,
  null::text                                                              as note,
  c.created_at                                                            as created_at,
  c.weekdays                                                              as weekdays,
  case
    when c.period_auto and c.period_override is not null and c.period_override <> '' then c.period_override
    when c.first_session_date is not null and c.period is not null and c.period <> ''
      then to_char(c.first_session_date, 'YYYY') || '年' || c.period
    else coalesce(nullif(c.period, ''), '暂定')
  end                                                                     as term,
  public.major_code_to_cn(c.major)                                        as major,
  c.course_type                                                           as course_type,
  c.skip_dates                                                            as skip_dates,
  c.meeting_id                                                            as meeting_id,
  c.meeting_template_id                                                   as meeting_template_id,
  c.sched_merge_group                                                     as merge_group,
  c.sched_merge_name                                                      as merge_name,
  c.sched_merge_order                                                     as merge_order,
  c.skip_reasons                                                          as skip_reasons,
  c.holiday_except                                                        as holiday_except,
  null::timestamptz                                                       as deleted_at,
  null::text                                                              as deleted_by,
  c.host_key                                                              as host_key,
  c.sched_removed_reason                                                  as sched_removed_reason,
  c.sched_removed_at                                                      as sched_removed_at,
  m.sched_id                                                              as legacy_sched_id,
  c.time_range                                                            as class_time_range
from public.courses c
left join lateral (
  select min(cs.session_date) as min_d, max(cs.session_date) as max_d
  from public.course_sessions cs where cs.course_id = c.id
) d on true
left join lateral (
  -- 上课时间可能有多段（10:00-12:00/13:00-15:00）：最早的开始 ～ 最晚的结束
  select min(lpad(split_part(btrim(seg), '-', 1), 5, '0')) as st,
         max(lpad(split_part(btrim(seg), '-', 2), 5, '0')) as en
  from regexp_split_to_table(coalesce(c.time_range, ''), '[/／]') as seg
  where seg like '%-%'
) t on true
left join public.__MAP__ m on m.course_id = c.id;
  $v$, '__MAP__', map_tbl);
end $do$;

grant select on public.sched_course_v to anon, authenticated;

commit;

-- ============================================================
-- C. 验证（只读）
-- ============================================================
-- 两段时间的课：start_time 应是最早、end_time 应是最晚，class_time_range 是原样
select id, name, class_time_range, start_time, end_time, term
from public.sched_course_v where class_time_range like '%/%' limit 10;

-- ============================================================
-- 回滚（把视图改回原样，删掉新加的列）
-- 注意：视图要先删再建，因为 create or replace 不能少列；最后一行 join 的表名，用预检 A.1 里线上现在用的（sched_course_id_map 或 sched_course_id_map_legacy）
-- ============================================================
-- begin;
-- drop view public.sched_course_v;
-- create view public.sched_course_v as
-- select
--   c.id as id,
--   case when c.campus = '腾讯会议' then '线上' else coalesce(c.campus, '线上') end as campus,
--   coalesce(c.domain, '大学院文科') as category,
--   coalesce(c.name, '未命名课程') as name,
--   c.teacher as teacher,
--   null::integer as weekday,
--   case when c.time_range like '%-%' then split_part(c.time_range, '-', 1) end as start_time,
--   case when c.time_range like '%-%' then split_part(c.time_range, '-', 2) end as end_time,
--   coalesce(c.start_date, d.min_d, c.first_session_date) as start_date,
--   coalesce(c.end_date, d.max_d) as end_date,
--   c.total_sessions as sessions,
--   c.est_students as est_students,
--   coalesce(c.delivery, '线上') as mode,
--   c.meeting_url as meeting_link,
--   true as confirmed,
--   null::text as note,
--   c.created_at as created_at,
--   c.weekdays as weekdays,
--   case when c.first_session_date is not null and c.period is not null
--        then to_char(c.first_session_date, 'YYYY') || '年' || c.period
--        else c.period end as term,
--   public.major_code_to_cn(c.major) as major,
--   c.course_type as course_type,
--   c.skip_dates as skip_dates,
--   c.meeting_id as meeting_id,
--   c.meeting_template_id as meeting_template_id,
--   c.sched_merge_group as merge_group,
--   c.sched_merge_name as merge_name,
--   c.sched_merge_order as merge_order,
--   c.skip_reasons as skip_reasons,
--   c.holiday_except as holiday_except,
--   null::timestamptz as deleted_at,
--   null::text as deleted_by,
--   c.host_key as host_key,
--   c.sched_removed_reason as sched_removed_reason,
--   c.sched_removed_at as sched_removed_at,
--   m.sched_id as legacy_sched_id
-- from public.courses c
-- left join lateral (
--   select min(cs.session_date) as min_d, max(cs.session_date) as max_d
--   from public.course_sessions cs where cs.course_id = c.id
-- ) d on true
-- left join public.sched_course_id_map m on m.course_id = c.id;
-- grant select on public.sched_course_v to anon, authenticated;
-- alter table public.courses drop column if exists period_auto;
-- commit;
-- （courses.period 的「允许为空」不用改回去；如果原来是 not null 且确认没有空值，才执行：alter table public.courses alter column period set not null;）
