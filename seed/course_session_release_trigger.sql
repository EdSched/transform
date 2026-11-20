-- 课程某一回改期 / 休讲 / 删除后，数据库自己释放那一回原来的教室占用，并留提示（不管是管理端、排课、教室占用录入还是以后新写的页面）
-- 由 Sensis 在 Supabase SQL Editor 手动执行。先看「预览」，再执行 A，最后按 C 验证。回滚在最后。
--
-- 规则（和前端 srmReleaseOldTemps 一致，一天只留一组占用）：
--   触发：course_sessions 的某一回 ① 日期改了 ② 从上课变成休讲 ③ 被删除
--   前提：那门课在「原日期」已经没有别的没休讲的单回
--   动作：1) 删掉那门课原日期的临时占用（kind=course, recurrence=once）
--         2) 每周占用里为那天让位记下的日期（manual_off_dates）还回去（只有真的删了临时占用才还）
--         3) 如果是「改期」且删掉了临时占用（即原来那天用的是单独换的教室）：往 sched_change_log 写一条
--            action='room_coord', reason='released'：总务首页出现「原 X 教室已释放，请确认或重新安排」；
--            同一回没处理的旧提示标成「系统」已处理。休讲 / 删除不写提示（那一回已经不用教室）。
--   安全：函数 security definer（课程安排的使用者本来没有写 sched_bookings 的权限）；任何异常都吞掉只报 notice，
--         绝不会让改单回的操作失败。时间只改、日期没变：不动（占用的时间本来就按单回算）。

-- ============================================================
-- 预览（只读）：现在库里已经存在的遗留占用（改期 / 休讲后没人删的，今天以后）。装触发器不会自动清这些，
-- 清它们用 seed/room_coord_cleanup.sql 的 C 段或排课首页「查看并清理」。
-- ============================================================
-- select b.id, b.course_id, b.booking_date, b.room_id from public.sched_bookings b
-- where b.kind='course' and b.recurrence='once' and b.status<>'rejected' and b.booking_date>=current_date
--   and exists (select 1 from public.course_sessions cs where cs.course_id::text=b.course_id::text)
--   and not exists (select 1 from public.course_sessions cs where cs.course_id::text=b.course_id::text
--                   and cs.session_date::date=b.booking_date and coalesce(cs.is_cancelled,false)=false);

-- ============================================================
-- A. 安装
-- ============================================================
begin;

create or replace function public.course_session_release_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old_date date;
  v_new_date date;
  v_moved boolean := false;
  v_cancel boolean := false;
  v_n int := 0;
  v_room_id bigint;
  v_room_name text;
  v_cname text;
  v_legacy int;
  v_m text[];
  v_span text := '';
  v_actor text;
begin
  begin
    v_old_date := OLD.session_date::date;
    if TG_OP = 'DELETE' then
      v_cancel := true;
    else
      v_new_date := NEW.session_date::date;
      v_moved := v_new_date is distinct from v_old_date;
      v_cancel := coalesce(NEW.is_cancelled, false) and not coalesce(OLD.is_cancelled, false);
    end if;
    -- 原来就是休讲的回，没有占用可释放
    if coalesce(OLD.is_cancelled, false) then return coalesce(NEW, OLD); end if;
    if not (v_moved or v_cancel) then return coalesce(NEW, OLD); end if;

    -- 原日期这门课还有别的没休讲的单回：占用还在用，不动
    if exists (select 1 from public.course_sessions cs
               where cs.course_id::text = OLD.course_id::text and cs.session_date::date = v_old_date
                 and coalesce(cs.is_cancelled, false) = false and cs.id::text <> OLD.id::text) then
      return coalesce(NEW, OLD);
    end if;

    -- 1) 删掉原日期的临时占用
    with del as (
      delete from public.sched_bookings b
       where b.kind = 'course' and b.recurrence = 'once' and b.course_id::text = OLD.course_id::text
         and b.booking_date = v_old_date and b.status <> 'rejected'
      returning b.room_id
    )
    select count(*), max(room_id) into v_n, v_room_id from del;

    if v_n > 0 then
      -- 2) 每周占用为这一天让位的记录还回去
      update public.sched_bookings w
         set manual_off_dates = nullif(array_to_string(array_remove(string_to_array(coalesce(w.manual_off_dates, ''), ','), v_old_date::text), ','), '')
       where w.kind = 'course' and w.recurrence = 'weekly' and w.course_id::text = OLD.course_id::text
         and coalesce(w.manual_off_dates, '') like '%' || v_old_date::text || '%';

      -- 3) 改期 → 留提示
      if v_moved and TG_OP = 'UPDATE' and not coalesce(NEW.is_cancelled, false) then
        select r.name into v_room_name from public.sched_rooms r where r.id = v_room_id;
        select c.name, c.legacy_sched_id into v_cname, v_legacy from public.sched_course_v c where c.id::text = OLD.course_id::text limit 1;
        select array_agg(x[1]) into v_m from regexp_matches(coalesce(NEW.time_range, ''), '(\d{1,2}:\d{2})', 'g') as x;
        if v_m is not null and array_length(v_m, 1) >= 2 then
          v_span := lpad(v_m[1], 5, '0') || '-' || lpad(v_m[array_length(v_m, 1)], 5, '0');
        end if;
        v_actor := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '系统');
        update public.sched_change_log l set acked_by = '系统'
         where l.action = 'room_coord' and coalesce(l.acked_by, '') = ''
           and exists (select 1 from jsonb_array_elements(l.changes) c where c ->> 'session_id' = OLD.id::text);
        insert into public.sched_change_log (course_id, course_name, actor_role, actor_label, action, changes, acked_by)
        values (v_legacy, coalesce(v_cname, NEW.course_name, ''), 'admin', v_actor, 'room_coord',
          jsonb_build_array(jsonb_build_object(
            'field', 'room_coord', 'label', '第 ' || coalesce(OLD.session_number::text, '?') || ' 回',
            'num', OLD.session_number, 'session_id', OLD.id::text, 'course_uuid', OLD.course_id::text,
            'from', v_old_date::text || ' ' || coalesce(OLD.time_range, ''), 'to', v_new_date::text || ' ' || v_span,
            'date', v_new_date::text, 'time', v_span, 'room_name', coalesce(v_room_name, ''), 'room_id', v_room_id,
            'blocker', '', 'reason', 'released', 'actor_name', v_actor)),
          '');
      end if;
    end if;
  exception when others then
    raise notice 'course_session_release_room 出错（已忽略，不影响改单回）：%', sqlerrm;
  end;
  return coalesce(NEW, OLD);
end
$fn$;

drop trigger if exists trg_course_sessions_release_room on public.course_sessions;
create trigger trg_course_sessions_release_room
  after update of session_date, is_cancelled or delete on public.course_sessions
  for each row execute function public.course_session_release_room();

commit;

-- ============================================================
-- C. 验证（在事务里试一把，最后 rollback，不会留下任何改动）
--    把下面的 <某门课的单回 id> 换成一条有「单独换教室（临时占用）」的单回；没有就跳过，看 notice 里没有报错即可。
-- ============================================================
-- begin;
--   update public.course_sessions set session_date = (session_date::date + 7)::text::date where id = '<某门课的单回 id>';   -- 按 session_date 的实际类型调整
--   select * from public.sched_bookings where course_id::text = (select course_id::text from public.course_sessions where id = '<某门课的单回 id>') and recurrence = 'once';
--   select * from public.sched_change_log order by created_at desc limit 3;
-- rollback;

-- ============================================================
-- 回滚（卸载触发器；已经被它删掉的占用不会自动恢复，但那些占用本来就是遗留的）
-- ============================================================
-- drop trigger if exists trg_course_sessions_release_room on public.course_sessions;
-- drop function if exists public.course_session_release_room();
