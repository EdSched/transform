-- 课程某一回的上课时间改了（日期没变）→ 数据库自己把这门课当天的「单日占用」的时间一起改掉
-- 不管是管理端、排课、教室占用录入还是以后新写的页面，只要改了 course_sessions.time_range 就生效。
-- 由 Sensis 在 Supabase SQL Editor 手动执行：先跑「预览」，再跑 A 安装，再按 C 验证。回滚在最后。
--
-- 背景：
--   · 每周占用：前端 linkCourseBookings 按每一回算时间，不用改库
--   · 单日占用（recurrence='once'，某一回换了教室）：自己存 start_time / end_time，以前没人跟着改 → 教室仍占着旧时间
--   本触发器补上这一块。
--
-- 规则（和 course_session_release_trigger.sql 一致，不会互相打架）：
--   触发：course_sessions 的 time_range 改了，并且 session_date 没变、这一回没休讲
--         （日期变了 / 休讲 / 删除：由 course_session_release_room 处理，这里不管）
--   动作：这门课这一天所有没休讲的单回，取最早开始～最晚结束；这一天的单日占用（kind=course, recurrence=once,
--         status<>'rejected'）的 start_time / end_time 改成它
--   撞教室：数据库防撞触发器不让改（新时间和别的占用重叠）→ 这条占用保持原样，往 sched_change_log 写一条
--         action='room_coord', reason='blocked'，总务首页出现「需要协调教室」（同一回没处理的旧提示标成「系统」已处理）
--   安全：security definer；任何异常都吞掉只报 notice，绝不会让改单回的操作失败

-- ============================================================
-- 预览（只读）：现在库里已经存在的「单日占用时间 ≠ 这一天单回时间」的记录（今天以后）
-- 装触发器不会自动改这些；排课「冲突检查」页的体检可以一键修复，或自己 update。
-- ============================================================
-- with ses as (
--   select q.cid, q.d, min(q.a[1]) as s, max(q.a[array_length(q.a, 1)]) as e
--   from (select cs.course_id::text as cid, cs.session_date::date as d,
--                array(select lpad(m[1], 5, '0') from regexp_matches(coalesce(cs.time_range, ''), '(\d{1,2}:\d{2})', 'g') as m) as a
--         from public.course_sessions cs where coalesce(cs.is_cancelled, false) = false) q
--   where array_length(q.a, 1) >= 2
--   group by q.cid, q.d
-- )
-- select b.id, b.course_id, b.booking_date, b.room_id, b.start_time, b.end_time, ses.s as 单回开始, ses.e as 单回结束
-- from public.sched_bookings b
-- join ses on ses.cid = b.course_id::text and ses.d = b.booking_date::date
-- where b.kind = 'course' and b.recurrence = 'once' and b.status <> 'rejected' and b.booking_date >= current_date
--   and (to_char(b.start_time::time, 'HH24:MI') <> ses.s or to_char(b.end_time::time, 'HH24:MI') <> ses.e)
-- order by b.booking_date;

-- ============================================================
-- A. 安装
-- ============================================================
begin;

create or replace function public.course_session_sync_once_time()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_s text;
  v_e text;
  v_day date;
  r record;
  v_room_name text;
  v_cname text;
  v_legacy int;
  v_span text;
  v_actor text;
begin
  begin
    if TG_OP <> 'UPDATE' then return NEW; end if;
    if NEW.time_range is not distinct from OLD.time_range then return NEW; end if;
    v_day := NEW.session_date::date;
    if v_day is distinct from OLD.session_date::date then return NEW; end if;     -- 日期变了：交给 course_session_release_room
    if coalesce(NEW.is_cancelled, false) then return NEW; end if;                 -- 休讲：同上

    -- 这门课这一天所有没休讲的单回：最早开始 ～ 最晚结束
    select min(q.a[1]), max(q.a[array_length(q.a, 1)]) into v_s, v_e
      from (select array(select lpad(m[1], 5, '0') from regexp_matches(coalesce(cs.time_range, ''), '(\d{1,2}:\d{2})', 'g') as m) as a
              from public.course_sessions cs
             where cs.course_id::text = NEW.course_id::text and cs.session_date::date = v_day
               and coalesce(cs.is_cancelled, false) = false) q
     where array_length(q.a, 1) >= 2;
    if v_s is null or v_e is null then return NEW; end if;                         -- 读不出时间：不动
    v_span := v_s || '-' || v_e;

    for r in
      select b.id, b.room_id from public.sched_bookings b
       where b.kind = 'course' and b.recurrence = 'once' and b.course_id::text = NEW.course_id::text
         and b.booking_date = v_day and b.status <> 'rejected'
         and (to_char(b.start_time::time, 'HH24:MI') <> v_s or to_char(b.end_time::time, 'HH24:MI') <> v_e)
    loop
      begin
        update public.sched_bookings set start_time = v_s::time, end_time = v_e::time where id = r.id;
      exception when others then
        -- 新时间和别的占用撞了（防撞触发器拦下）：这条占用保持原样，留提示给总务
        begin
          select ro.name into v_room_name from public.sched_rooms ro where ro.id = r.room_id;
          select c.name, c.legacy_sched_id into v_cname, v_legacy from public.sched_course_v c where c.id::text = NEW.course_id::text limit 1;
          v_actor := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '系统');
          update public.sched_change_log l set acked_by = '系统'
           where l.action = 'room_coord' and coalesce(l.acked_by, '') = ''
             and exists (select 1 from jsonb_array_elements(l.changes) c where c ->> 'session_id' = NEW.id::text);
          insert into public.sched_change_log (course_id, course_name, actor_role, actor_label, action, changes, acked_by)
          values (v_legacy, coalesce(v_cname, NEW.course_name, ''), 'admin', v_actor, 'room_coord',
            jsonb_build_array(jsonb_build_object(
              'field', 'room_coord', 'label', '第 ' || coalesce(NEW.session_number::text, '?') || ' 回',
              'num', NEW.session_number, 'session_id', NEW.id::text, 'course_uuid', NEW.course_id::text,
              'from', v_day::text || ' ' || coalesce(OLD.time_range, ''), 'to', v_day::text || ' ' || v_span,
              'date', v_day::text, 'time', v_span, 'room_name', coalesce(v_room_name, ''), 'room_id', r.room_id,
              'blocker', '新时间和别的占用重叠（' || sqlerrm || '）', 'reason', 'blocked',
              'note', '上课时间由 ' || coalesce(OLD.time_range, '') || ' 改为 ' || coalesce(NEW.time_range, ''), 'actor_name', v_actor)),
            '');
        exception when others then
          raise notice 'course_session_sync_once_time 写提示出错（已忽略）：%', sqlerrm;
        end;
      end;
    end loop;
  exception when others then
    raise notice 'course_session_sync_once_time 出错（已忽略，不影响改单回）：%', sqlerrm;
  end;
  return NEW;
end
$fn$;

drop trigger if exists trg_course_sessions_sync_once_time on public.course_sessions;
create trigger trg_course_sessions_sync_once_time
  after update of time_range on public.course_sessions
  for each row execute function public.course_session_sync_once_time();

commit;

-- ============================================================
-- C. 验证（在事务里试一把，最后 rollback，不会留下任何改动）
--    把 <单回 id> 换成一条「这一天有单日占用（单独换过教室）」的单回的 id；没有这种单回就先在「课程安排」里给某一回换个教室。
-- ============================================================
-- begin;
--   select b.id, b.booking_date, b.start_time, b.end_time from public.sched_bookings b
--    where b.kind = 'course' and b.recurrence = 'once'
--      and b.course_id::text = (select course_id::text from public.course_sessions where id = '<单回 id>')
--      and b.booking_date = (select session_date::date from public.course_sessions where id = '<单回 id>');     -- 改前
--   update public.course_sessions set time_range = '23:00-23:30' where id = '<单回 id>';                         -- 试改成一个不太会撞的时间
--   select b.id, b.booking_date, b.start_time, b.end_time from public.sched_bookings b
--    where b.kind = 'course' and b.recurrence = 'once'
--      and b.course_id::text = (select course_id::text from public.course_sessions where id = '<单回 id>')
--      and b.booking_date = (select session_date::date from public.course_sessions where id = '<单回 id>');     -- 改后：应该是 23:00 / 23:30
-- rollback;

-- ============================================================
-- 回滚（卸载触发器；已经被它改过时间的占用不会自动改回，但那些时间本来就该跟着这一回）
-- ============================================================
-- drop trigger if exists trg_course_sessions_sync_once_time on public.course_sessions;
-- drop function if exists public.course_session_sync_once_time();
