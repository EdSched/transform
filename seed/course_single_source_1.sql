-- 课程只留一份 · 第 1 步（PR-A）：数据库准备，页面一个都不改
-- 由 Sensis 在 Supabase SQL Editor 手动执行。按 ①→⑤ 的顺序，每一段单独跑；⑥ 是只读核对，跑完把结果给 Claude。
-- 回滚在文件最后。
--
-- 做什么：
--   ① 只属于排课的信息（合并上课、移出排课）补到管理端 courses 上（courses 已有的列不重复加）
--   ② 把现有值从 sched_courses 抄到 courses（用映射表对应；抄的时候关掉同步触发器，避免反向覆盖）
--   ③ 建视图 sched_course_v：从 courses 生成，列名/格式和 sched_courses 完全一样，id = courses.id（文本），另加 legacy_sched_id
--   ④ sched_bookings 加 course_ref（= courses.id），回填，并加一个自动补填的触发器（第 3 步退役）
--   ⑤ （可选，默认注释）清理排课里已知的孤课 605、960
--   ⑥ 只读核对
--
-- 已确认的前提（来自你贴的结果）：
--   · courses 读策略 = true，sched 账号可 update courses；sched_courses 读策略 = true → 视图公开读，和现在一样
--   · sched_bookings.course_id 是 bigint，没有外键；sched_course_id_map 主键是 sched_id
--   · 映射表里有 4 条孤儿（714/715/716/959，sched 一侧已不存在），另有 4 门课管理端已删（605/960/961/963，其中 961/963 排课里也已标删除）：
--     本文件只用两边都在的映射，孤儿不删

-- ============================================================
-- ① courses 补列（只加同步函数里没有对应的）
--    不加：est_students / skip_dates / skip_reasons / holiday_except / host_key / meeting_id / meeting_template_id
--         （courses 上本来就有，两个方向一直在同步）；sched_courses.category 对应 courses.domain，也不加。
--    注意：courses 上已经有 merge_group / merge_name / merge_order，但管理端代码里没有任何地方用它们，
--         为避免以后和管理端自己的含义撞车，排课的合并上课另存到 sched_merge_*。
-- ============================================================
alter table public.courses add column if not exists sched_merge_group text;
alter table public.courses add column if not exists sched_merge_name text;
alter table public.courses add column if not exists sched_merge_order integer;
alter table public.courses add column if not exists sched_removed_reason text;   -- 不为空 = 已移出排课（理由），第 4 步用
alter table public.courses add column if not exists sched_removed_at timestamptz;

-- ============================================================
-- ② 把 sched_courses 上只属于排课的值抄到 courses
--    app.course_sync = '1' 会让四个同步触发器直接跳过，所以这一步不会把 courses 的值反向推回排课
-- ============================================================
begin;
select set_config('app.course_sync', '1', true);

update public.courses c set
  sched_merge_group    = s.merge_group,
  sched_merge_name     = s.merge_name,
  sched_merge_order    = s.merge_order,
  sched_removed_reason = s.sched_removed_reason,
  sched_removed_at     = s.sched_removed_at
from public.sched_course_id_map m
join public.sched_courses s on s.id = m.sched_id
where m.course_id = c.id
  and (s.merge_group is not null or s.merge_name is not null or s.merge_order is not null or s.sched_removed_reason is not null);

commit;

-- ============================================================
-- ③ 视图 sched_course_v
--    列的顺序、名字、类型和 sched_courses 一致（id 变成文本，末尾多一列 legacy_sched_id）。
--    取值规则照四个同步函数：
--      category ← domain；mode ← delivery；meeting_link ← meeting_url；sessions ← total_sessions
--      start_time / end_time ← time_range 按 '-' 拆成两段（只取前两段，和同步函数一样）
--      term ← 首回日期的年份 || '年' || period（没有首回日期就是 period）
--      start_date ← start_date，没有就取单回最早一天，再没有取首回日期；end_date ← end_date，没有取单回最晚一天
--      major ← major_code_to_cn(major)
--      campus / mode / category / name 为空时的默认值，同「管理端新建 → 排课」那个同步函数（线上 / 线上 / 大学院文科 / 未命名课程）
--    没有对应物的列：weekday、note 给空；confirmed 给 true；deleted_at / deleted_by 给空（管理端删了就是真删了）
--    用视图所有者身份读（courses 本来就是公开读，没有新增暴露）
-- ============================================================
create or replace view public.sched_course_v as
select
  c.id                                                                    as id,
  coalesce(c.campus, '线上')                                              as campus,
  coalesce(c.domain, '大学院文科')                                        as category,
  coalesce(c.name, '未命名课程')                                          as name,
  c.teacher                                                               as teacher,
  null::integer                                                           as weekday,
  case when c.time_range like '%-%' then split_part(c.time_range, '-', 1) end as start_time,
  case when c.time_range like '%-%' then split_part(c.time_range, '-', 2) end as end_time,
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
  case when c.first_session_date is not null and c.period is not null
       then to_char(c.first_session_date, 'YYYY') || '年' || c.period
       else c.period end                                                  as term,
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
  m.sched_id                                                              as legacy_sched_id
from public.courses c
left join lateral (
  select min(cs.session_date) as min_d, max(cs.session_date) as max_d
  from public.course_sessions cs where cs.course_id = c.id
) d on true
left join public.sched_course_id_map m on m.course_id = c.id;

grant select on public.sched_course_v to anon, authenticated;

-- ============================================================
-- ④ sched_bookings.course_ref（= courses.id）
--    course_id（旧数字）原样保留，第 3 步才改名。
--    回填时临时关掉 sched_bookings 上的用户触发器（防撞触发器等），免得更新一个无关新列时被旧数据的重叠卡住；回填完马上恢复。
-- ============================================================
alter table public.sched_bookings add column if not exists course_ref text;
create index if not exists sched_bookings_course_ref_idx on public.sched_bookings (course_ref);

begin;
alter table public.sched_bookings disable trigger user;

update public.sched_bookings b set course_ref = m.course_id
from public.sched_course_id_map m
join public.courses c on c.id = m.course_id
where b.course_id = m.sched_id
  and b.course_ref is distinct from m.course_id;

alter table public.sched_bookings enable trigger user;
commit;

-- 第 2 步上线前，旧页面还在新建 course_id 的占用：这个触发器自动把 course_ref 补上（第 3 步退役）
create or replace function public.sched_bookings_fill_course_ref() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.course_id is not null and new.course_ref is null then
    select m.course_id into new.course_ref from public.sched_course_id_map m where m.sched_id = new.course_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_sched_bookings_fill_course_ref on public.sched_bookings;
create trigger trg_sched_bookings_fill_course_ref
  before insert or update of course_id on public.sched_bookings
  for each row execute function public.sched_bookings_fill_course_ref();

-- ============================================================
-- ⑤ （可选，默认注释）清理排课里已知的孤课：
--    605「社会科学共通课」：管理端已删，排课还活着，名下 2 条占用还在占教室/会议账号
--    960「9月纯艺设计班课表」：管理端已删，排课还活着，没有占用，已结课
--    961 / 963 排课里已标删除，不用管。确认要清理时，去掉下面的注释符再执行。
-- ============================================================
-- create table public.sched_bookings_orphan_backup_20261022 as
--   select * from public.sched_bookings where kind = 'course' and course_id = 605;
-- alter table public.sched_bookings_orphan_backup_20261022 enable row level security;   -- 不开任何策略 = 只有后台能看，备份不外露
--
-- begin;
-- select set_config('app.course_sync', '1', true);
-- delete from public.sched_bookings where kind = 'course' and course_id = 605;
-- update public.sched_courses set deleted_at = now(), deleted_by = '迁移清理' where id in (605, 960) and deleted_at is null;
-- commit;

-- ============================================================
-- ⑥ 只读核对（逐条执行，每条把结果给 Claude）
-- ============================================================

-- 6.1 排课里没删除、但映射不到管理端课程的（应该是 0；⑤ 清理前会有 605、960）
select s.id, s.name, s.start_date, s.end_date
from public.sched_courses s
left join public.sched_course_id_map m on m.sched_id = s.id
left join public.courses c on c.id = m.course_id
where s.deleted_at is null and c.id is null;

-- 6.2 排课里已标删除、但管理端课程还在的（它们换成读管理端后会重新出现在排课里，应该是 0）
select s.id, s.name, s.deleted_at, c.id as course_id
from public.sched_courses s
join public.sched_course_id_map m on m.sched_id = s.id
join public.courses c on c.id = m.course_id
where s.deleted_at is not null;

-- 6.3 管理端有、但没有映射的课（它们在排课里本来就看不到；换成读管理端后会新出现，应该是 0）
select c.id, c.name, c.start_date, c.end_date
from public.courses c
left join public.sched_course_id_map m on m.course_id = c.id
where m.sched_id is null;

-- 6.4 kind = 'course' 的占用里 course_ref 填不上的（应该是 0；⑤ 清理前会有 605 的 2 条）
select b.id, b.course_id, b.title, b.weekday, b.start_date, b.end_date, b.room_id
from public.sched_bookings b
where b.kind = 'course' and b.course_ref is null;

-- 6.5 视图里的课 vs sched_courses：第一步字段逐门比较，按列统计不一致的门数
with diff as (
  select v.id, v.name, s.id as sched_id, array_remove(array[
    case when v.name        is distinct from s.name        then 'name' end,
    case when v.campus      is distinct from s.campus      then 'campus' end,
    case when v.category    is distinct from s.category    then 'category' end,
    case when v.teacher     is distinct from s.teacher     then 'teacher' end,
    case when v.weekdays    is distinct from s.weekdays    then 'weekdays' end,
    case when v.start_time  is distinct from s.start_time  then 'start_time' end,
    case when v.end_time    is distinct from s.end_time    then 'end_time' end,
    case when v.start_date  is distinct from s.start_date  then 'start_date' end,
    case when v.end_date    is distinct from s.end_date    then 'end_date' end,
    case when v.sessions    is distinct from s.sessions    then 'sessions' end,
    case when v.mode        is distinct from s.mode        then 'mode' end,
    case when v.term        is distinct from s.term        then 'term' end,
    case when v.major       is distinct from s.major       then 'major' end,
    case when v.course_type is distinct from s.course_type then 'course_type' end,
    case when v.est_students is distinct from s.est_students then 'est_students' end,
    case when v.meeting_link is distinct from s.meeting_link then 'meeting_link' end,
    case when v.meeting_id  is distinct from s.meeting_id  then 'meeting_id' end,
    case when v.host_key    is distinct from s.host_key    then 'host_key' end,
    case when v.skip_dates  is distinct from s.skip_dates  then 'skip_dates' end,
    case when v.skip_reasons is distinct from s.skip_reasons then 'skip_reasons' end,
    case when v.holiday_except is distinct from s.holiday_except then 'holiday_except' end,
    case when v.merge_group is distinct from s.merge_group then 'merge_group' end
  ], null) as cols
  from public.sched_course_v v
  join public.sched_courses s on s.id = v.legacy_sched_id
  where s.deleted_at is null
)
select col, count(*) as n_courses
from diff, unnest(cols) as col
group by col
order by n_courses desc;

-- 6.6 同上，列出每门不一致的课（前 200 条）
with diff as (
  select v.id, v.name, s.id as sched_id, array_remove(array[
    case when v.name        is distinct from s.name        then 'name: ' || coalesce(s.name,'空') || ' → ' || coalesce(v.name,'空') end,
    case when v.campus      is distinct from s.campus      then 'campus: ' || coalesce(s.campus,'空') || ' → ' || coalesce(v.campus,'空') end,
    case when v.teacher     is distinct from s.teacher     then 'teacher: ' || coalesce(s.teacher,'空') || ' → ' || coalesce(v.teacher,'空') end,
    case when v.weekdays    is distinct from s.weekdays    then 'weekdays: ' || coalesce(s.weekdays,'空') || ' → ' || coalesce(v.weekdays,'空') end,
    case when v.start_time  is distinct from s.start_time  then 'start_time: ' || coalesce(s.start_time,'空') || ' → ' || coalesce(v.start_time,'空') end,
    case when v.end_time    is distinct from s.end_time    then 'end_time: ' || coalesce(s.end_time,'空') || ' → ' || coalesce(v.end_time,'空') end,
    case when v.start_date  is distinct from s.start_date  then 'start_date: ' || coalesce(s.start_date::text,'空') || ' → ' || coalesce(v.start_date::text,'空') end,
    case when v.end_date    is distinct from s.end_date    then 'end_date: ' || coalesce(s.end_date::text,'空') || ' → ' || coalesce(v.end_date::text,'空') end,
    case when v.mode        is distinct from s.mode        then 'mode: ' || coalesce(s.mode,'空') || ' → ' || coalesce(v.mode,'空') end,
    case when v.term        is distinct from s.term        then 'term: ' || coalesce(s.term,'空') || ' → ' || coalesce(v.term,'空') end,
    case when v.major       is distinct from s.major       then 'major: ' || coalesce(s.major,'空') || ' → ' || coalesce(v.major,'空') end,
    case when v.category    is distinct from s.category    then 'category: ' || coalesce(s.category,'空') || ' → ' || coalesce(v.category,'空') end,
    case when v.sessions    is distinct from s.sessions    then 'sessions: ' || coalesce(s.sessions::text,'空') || ' → ' || coalesce(v.sessions::text,'空') end,
    case when v.est_students is distinct from s.est_students then 'est_students: ' || coalesce(s.est_students::text,'空') || ' → ' || coalesce(v.est_students::text,'空') end,
    case when v.skip_dates  is distinct from s.skip_dates  then 'skip_dates 不同' end,
    case when v.holiday_except is distinct from s.holiday_except then 'holiday_except 不同' end,
    case when v.meeting_link is distinct from s.meeting_link then 'meeting_link 不同' end,
    case when v.meeting_id  is distinct from s.meeting_id  then 'meeting_id 不同' end
  ], null) as notes
  from public.sched_course_v v
  join public.sched_courses s on s.id = v.legacy_sched_id
  where s.deleted_at is null
)
select sched_id, id as course_id, name, notes from diff where cardinality(notes) > 0 order by sched_id limit 200;

-- 6.7 总数：视图行数 = courses 行数；视图里有映射的行数
select (select count(*) from public.sched_course_v) as view_rows,
       (select count(*) from public.courses) as courses_rows,
       (select count(*) from public.sched_course_v where legacy_sched_id is not null) as with_legacy_id;

-- ============================================================
-- ⑦ 补充（第一轮核对后加的）。①–④ 已执行过的不用重跑，从这里开始。
-- ============================================================

-- 7.A 清理已确认可删的孤课 605、960（管理端已删、排课里还活着）。先备份 605 的 2 条占用，再标删除。
create table if not exists public.sched_bookings_orphan_backup_20261022 as
  select * from public.sched_bookings where kind = 'course' and course_id = 605;
alter table public.sched_bookings_orphan_backup_20261022 enable row level security;   -- 不开任何策略 = 只有后台能看

begin;
select set_config('app.course_sync', '1', true);
delete from public.sched_bookings where kind = 'course' and course_id = 605;
update public.sched_courses set deleted_at = now(), deleted_by = '迁移清理' where id in (605, 960) and deleted_at is null;
commit;

-- 7.B 补漏：排课里有值、管理端是空的，抄到 courses（只填空的，管理端已有值的一律不动）。
--     原因：host_key 等列的同步只在「排课里改了一次之后」才会抄过去，以前填过的没抄，换成读管理端后这些值会"消失"。
begin;
select set_config('app.course_sync', '1', true);
update public.courses c set
  host_key       = case when nullif(c.host_key, '')       is null then nullif(s.host_key, '')       else c.host_key end,
  holiday_except = case when nullif(c.holiday_except, '') is null then nullif(s.holiday_except, '') else c.holiday_except end,
  skip_dates     = case when nullif(c.skip_dates, '')     is null then nullif(s.skip_dates, '')     else c.skip_dates end,
  skip_reasons   = case when nullif(c.skip_reasons, '')   is null then nullif(s.skip_reasons, '')   else c.skip_reasons end,
  meeting_url    = case when nullif(c.meeting_url, '')    is null then nullif(s.meeting_link, '')   else c.meeting_url end,
  meeting_id     = case when nullif(c.meeting_id, '')     is null then nullif(s.meeting_id, '')     else c.meeting_id end,
  course_type    = case when nullif(c.course_type, '')    is null then nullif(s.course_type, '')    else c.course_type end
from public.sched_course_id_map m
join public.sched_courses s on s.id = m.sched_id
where m.course_id = c.id and s.deleted_at is null;
commit;

-- 7.C 补完后还剩的"两边都有值、但不一样"的（这些要你判断以哪边为准；默认以管理端为准）
select s.id as sched_id, v.id as course_id, v.name, x.col, x.sched_val, x.course_val
from public.sched_course_v v
join public.sched_courses s on s.id = v.legacy_sched_id and s.deleted_at is null
cross join lateral (values
  ('host_key',       s.host_key,       v.host_key),
  ('holiday_except', s.holiday_except, v.holiday_except),
  ('skip_dates',     s.skip_dates,     v.skip_dates),
  ('skip_reasons',   s.skip_reasons,   v.skip_reasons),
  ('meeting_link',   s.meeting_link,   v.meeting_link),
  ('meeting_id',     s.meeting_id,     v.meeting_id),
  ('course_type',    s.course_type,    v.course_type),
  ('teacher',        s.teacher,        v.teacher),
  ('weekdays',       s.weekdays,       v.weekdays),
  ('term',           s.term,           v.term),
  ('start_date',     s.start_date::text, v.start_date::text),
  ('end_date',       s.end_date::text,   v.end_date::text)
) as x(col, sched_val, course_val)
where nullif(x.sched_val, '') is not null and nullif(x.course_val, '') is not null and x.sched_val <> x.course_val
order by x.col, s.id;

-- 7.D 管理端里「校区」和「授课形式」实际用了哪些值（管理端的校区是自由文本，排课只认 高马 / 市谷 / 线上；
--     看到结果后，Claude 会给视图加一个对应：例如 腾讯会议 → 线上）
select campus, delivery, count(*) as n from public.courses group by campus, delivery order by n desc;

-- ============================================================
-- 回滚（按相反顺序；视图和新列都是新增的，回滚不影响 sched_courses / courses 原有数据）
-- ============================================================
-- ⑤ 清理的回滚（如果执行过）：
--   begin;
--   select set_config('app.course_sync', '1', true);
--   insert into public.sched_bookings select * from public.sched_bookings_orphan_backup_20261022;
--   update public.sched_courses set deleted_at = null, deleted_by = null where id in (605, 960);
--   commit;
--   -- 确认无误后：drop table public.sched_bookings_orphan_backup_20261022;
-- ④：
--   drop trigger if exists trg_sched_bookings_fill_course_ref on public.sched_bookings;
--   drop function if exists public.sched_bookings_fill_course_ref();
--   drop index if exists public.sched_bookings_course_ref_idx;
--   alter table public.sched_bookings drop column if exists course_ref;
-- ③：
--   drop view if exists public.sched_course_v;
-- ①②：
--   alter table public.courses drop column if exists sched_merge_group;
--   alter table public.courses drop column if exists sched_merge_name;
--   alter table public.courses drop column if exists sched_merge_order;
--   alter table public.courses drop column if exists sched_removed_reason;
--   alter table public.courses drop column if exists sched_removed_at;
