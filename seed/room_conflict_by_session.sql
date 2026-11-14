-- 教室冲突：数据库两条防撞触发器也按「单回」算
-- 由 Sensis 在 Supabase SQL Editor 手动执行；合并前执行（执行后旧页面也不受影响，只是课程占用不再被数据库拦）。
--
-- 做什么：
--   · sched_bookings_check_overlap（教室被占）、sched_bookings_check_teacher_dup（老师重复预约）：
--       1) 新写入的是课程占用（NEW.kind='course'）→ 两条都不拦，直接放行（课程冲突由页面提示）
--       2) 新写入的是其他占用（VIP、老师预约等）→ 检查已有占用时：
--            已有的是非课程占用：照现在，按记录里存的时间、周几规则
--            已有的是课程占用且这门课在 course_sessions 有单回：那一天有没休讲的单回才算占用，时间用那一回的 time_range
--              （多段取第一段开始～最后一段结束；9:00 补成 09:00）；
--              每周占用：manual_off_dates 有这天不算；同一门课这天另有没被驳回的临时占用，每周那条不算（算临时那条，时间仍按单回）；
--              临时占用：那天没有单回不算
--            已有的是课程占用但这门课没有任何单回（老课）：照现在的周几规则（含休讲日 courses.skip_dates）
--   · 老师重复预约的其他规则（allow_multi 放行、user_name 相同才算、pending/confirmed）一个都没改
--
-- ⚠ 两个触发器函数我是按 seed/course_single_source_3.sql 里的版本改的，只动了「新写入是课程就放行」和「课程那天几点到几点」两处。
--   执行前请先跑下面两句只读查询，把结果给 Claude 对一下库里现在的写法有没有和那个文件不一样的地方：
--     select tgname, tgenabled, pg_get_triggerdef(t.oid) from pg_trigger t where tgrelid = 'public.sched_bookings'::regclass and not tgisinternal;
--     select proname, pg_get_functiondef(p.oid) from pg_proc p where proname in ('sched_bookings_check_overlap', 'sched_bookings_check_teacher_dup');
--
-- 执行顺序：先 A（三个新函数），再 B（两个触发器函数）。检查语句在 C，回滚在最后。

-- ============================================================
-- A. 共用函数
-- ============================================================
begin;

-- A.1 这门课在 course_sessions 里有没有任何单回数据
create or replace function public.sched_course_has_sessions(cid text)
returns boolean
language sql stable
as $$
  select exists (select 1 from public.course_sessions cs where cs.course_id::text = cid)
$$;

-- A.2 这门课 d 这一天的开始/结束。当天没有（没休讲的）单回 → 不返回行；
--     有单回但 time_range 读不出两个时间 → 返回一行，s/e 为空（调用方回退到占用记录里的时间）
create or replace function public.sched_course_span_on(cid text, d date)
returns table(s time, e time)
language plpgsql stable
as $$
declare
  rec record;
  m   text[];
  a   time;
  z   time;
  v_s time;
  v_e time;
  hit boolean := false;
begin
  for rec in
    select cs.time_range
      from public.course_sessions cs
     where cs.course_id::text = cid
       and cs.session_date::date = d
       and coalesce(cs.is_cancelled, false) = false
  loop
    hit := true;
    select array_agg(x[1]) into m
      from regexp_matches(coalesce(rec.time_range, ''), '(\d{1,2}:\d{2})', 'g') as x;
    if m is not null and array_length(m, 1) >= 2 then
      a := lpad(m[1], 5, '0')::time;
      z := lpad(m[array_length(m, 1)], 5, '0')::time;
      v_s := least(v_s, a);      -- least/greatest 忽略空值
      v_e := greatest(v_e, z);
    end if;
  end loop;
  if hit then
    s := v_s; e := v_e;
    return next;
  end if;
end $$;

-- A.3 已有的一条占用 b，在 d 这天占不占、几点到几点（不占 → 不返回行）。两个触发器共用
create or replace function public.sched_booking_span_on(b public.sched_bookings, d date)
returns table(s time, e time)
language plpgsql stable
as $$
declare
  v_s  time;
  v_e  time;
  sk   text;
  hit  boolean;
begin
  -- ① 课程占用，且这门课有单回数据：按单回
  if b.kind = 'course' and b.course_id is not null and public.sched_course_has_sessions(b.course_id::text) then
    if b.recurrence = 'weekly' then
      if d::text = any (string_to_array(replace(coalesce(b.manual_off_dates::text, ''), ' ', ''), ',')) then
        return;
      end if;
      select exists (
        select 1 from public.sched_bookings o
         where o.id is distinct from b.id
           and o.kind = 'course'
           and o.course_id = b.course_id
           and o.recurrence = 'once'
           and o.booking_date::date = d
           and o.status is distinct from 'rejected'
      ) into hit;
      if hit then return; end if;            -- 这天另有临时占用，算临时那条
    else
      if b.booking_date is null or b.booking_date::date <> d then return; end if;
    end if;
    select x.s, x.e into v_s, v_e from public.sched_course_span_on(b.course_id::text, d) x;
    if not found then return; end if;        -- 那天没有单回
    v_s := coalesce(v_s, b.start_time::time);
    v_e := coalesce(v_e, b.end_time::time);
    if v_s is null or v_e is null then return; end if;
    s := v_s; e := v_e;
    return next;
    return;
  end if;

  -- ② 其他：照原来的写法（记录里的时间、周几规则、休讲日）
  if b.start_time is null or b.end_time is null then return; end if;
  if b.recurrence is distinct from 'weekly' then
    if b.booking_date is not null and b.booking_date::date = d then
      s := b.start_time::time; e := b.end_time::time;
      return next;
    end if;
    return;
  end if;
  if b.weekday is null
     or (b.weekday::int % 7) <> extract(dow from d)::int
     or d < coalesce(b.start_date::date, d)
     or d > coalesce(b.end_date::date, d) then
    return;
  end if;
  select c.skip_dates into sk from public.courses c where c.id = b.course_id;
  if sk is not null and d::text = any (string_to_array(replace(sk, ' ', ''), ',')) then
    return;
  end if;
  s := b.start_time::time; e := b.end_time::time;
  return next;
end $$;

-- ============================================================
-- B. 两个触发器函数（在现有函数上改：新写入是课程就放行；课程那天几点到几点换成共用函数）
-- ============================================================
create or replace function public.sched_bookings_check_overlap()
 returns trigger
 language plpgsql
as $function$
DECLARE
  d   date;
  v_s time;
  v_e time;
  hit record;
BEGIN
  -- 新写入的是课程占用：不拦（冲突由页面提示，允许「稍后调整另一门」）
  IF NEW.kind = 'course' THEN
    RETURN NEW;
  END IF;

  -- 不占教室 / 已驳回 / 周循环排课：不在此处检查
  IF NEW.room_id IS NULL OR NEW.booking_date IS NULL
     OR NEW.start_time IS NULL OR NEW.end_time IS NULL
     OR NEW.status NOT IN ('pending','confirmed')
     OR NEW.recurrence = 'weekly' THEN
    RETURN NEW;
  END IF;

  d := NEW.booking_date::date;
  v_s := NEW.start_time::time;
  v_e := NEW.end_time::time;

  -- 同一教室串行化：两人同一瞬间提交也只能过一个
  PERFORM pg_advisory_xact_lock(hashtext('sched_room_' || NEW.room_id::text));

  SELECT b.id, b.kind, b.title, b.user_name, b.status, x.s AS start_time, x.e AS end_time
    INTO hit
    FROM sched_bookings b
    CROSS JOIN LATERAL public.sched_booking_span_on(b, d) x
   WHERE b.id IS DISTINCT FROM NEW.id
     AND b.room_id = NEW.room_id
     AND b.status IN ('pending','confirmed')
     AND v_s < x.e AND x.s < v_e
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION '教室已被占用：% %-% %「%」%（记录#%）',
      d, hit.start_time, hit.end_time,
      CASE hit.status WHEN 'pending' THEN '待审批' ELSE '已确认' END,
      COALESCE(hit.title, hit.kind, '占用'),
      COALESCE(hit.user_name, ''),
      hit.id
      USING ERRCODE = 'exclusion_violation';
  END IF;

  RETURN NEW;
END $function$;

create or replace function public.sched_bookings_check_teacher_dup()
 returns trigger
 language plpgsql
as $function$
DECLARE
  d   date;
  v_s time;
  v_e time;
  nm  text;
  hit record;
BEGIN
  -- 新写入的是课程占用：不拦（课程占用是课程安排定的）
  IF NEW.kind = 'course' THEN
    RETURN NEW;
  END IF;

  nm := btrim(COALESCE(NEW.user_name, ''));
  IF nm = '' OR NEW.booking_date IS NULL
     OR NEW.start_time IS NULL OR NEW.end_time IS NULL
     OR NEW.status NOT IN ('pending','confirmed')
     OR NEW.recurrence = 'weekly'
     OR NEW.allow_multi IS TRUE THEN          -- 占用录入页确认过"再预约一间"的，放行
    RETURN NEW;
  END IF;

  d := NEW.booking_date::date;
  v_s := NEW.start_time::time;
  v_e := NEW.end_time::time;

  PERFORM pg_advisory_xact_lock(hashtext('sched_teacher_' || nm));

  SELECT b.id, b.kind, b.title, b.student_name, b.status, x.s AS start_time, x.e AS end_time, r.name AS room
    INTO hit
    FROM sched_bookings b
    CROSS JOIN LATERAL public.sched_booking_span_on(b, d) x
    LEFT JOIN sched_rooms   r ON r.id = b.room_id
   WHERE b.id IS DISTINCT FROM NEW.id
     AND btrim(COALESCE(b.user_name,'')) = nm
     AND b.status IN ('pending','confirmed')
     AND v_s < x.e AND x.s < v_e
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION '重复预约：% 在 % %-% 已有%「%」%（%，记录#%）',
      nm, d, hit.start_time, hit.end_time,
      CASE hit.status WHEN 'pending' THEN '待审批预约' ELSE '已确认预约' END,
      COALESCE(hit.title, hit.kind, '占用'),
      CASE WHEN hit.student_name IS NOT NULL THEN ' 学生:' || hit.student_name ELSE '' END,
      COALESCE(hit.room, '未指定教室'),
      hit.id
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END $function$;

commit;

-- ============================================================
-- C. 检查语句（只读，或在事务里回滚）
-- ============================================================
-- C.1 12/26《经营战略》那天几点到几点（期望 09:00-13:00；<课程id> 换成真实的）
-- select * from public.sched_course_span_on('<经营战略 课程id>', '2026-12-26');
-- C.2 那天在 E 教室，每条占用按新算法占几点（期望：经营战略 09:00-13:00，不是每周存的 10:00-15:00；经营学面谈 14:00-18:00）
-- select b.id, b.kind, b.title, b.recurrence, b.start_time as stored_start, b.end_time as stored_end, x.s, x.e
--   from public.sched_bookings b cross join lateral public.sched_booking_span_on(b, date '2026-12-26') x
--  where b.room_id = <E教室id> and b.status in ('pending','confirmed');
-- C.3 验收 3：课程占用不拦（事务里试一下再回滚，应该不报错）
-- begin;
-- insert into public.sched_bookings (room_id, kind, course_id, title, user_name, recurrence, booking_date, start_time, end_time, status, created_by)
-- values (<E教室id>, 'course', '<经营学面谈 课程id>', '经营学面谈', '田原', 'once', '2026-12-26', '14:00', '18:00', 'confirmed', 'admin');
-- rollback;
-- C.4 验收 4：非课程占用（VIP）：10:00 应被拦；14:00 因为《经营学面谈》14:00-18:00 也被拦（报「教室已被占用」，记录#指向经营学面谈）
-- begin;
-- insert into public.sched_bookings (room_id, kind, title, user_name, recurrence, booking_date, start_time, end_time, status, created_by)
-- values (<E教室id>, 'vip', 'VIP测试', '别的老师', 'once', '2026-12-26', '10:00', '11:00', 'confirmed', 'admin');   -- 应报错
-- rollback;
-- C.5 验收 5：田原老师 12/26 订 13:30 的房间（别的教室）：跟《经营战略》单回 09:00-13:00 不撞，应通过；订 14:00 跟《经营学面谈》14:00-18:00 撞，应报「重复预约」
-- begin;
-- insert into public.sched_bookings (room_id, kind, title, user_name, recurrence, booking_date, start_time, end_time, status, created_by)
-- values (<别的教室id>, 'vip', 'VIP测试', '田原', 'once', '2026-12-26', '13:30', '14:00', 'confirmed', 'admin');
-- rollback;

-- ============================================================
-- 回滚：把 seed/course_single_source_3.sql 里「B.4」两个 create or replace function 再执行一遍（恢复旧写法），然后：
-- ============================================================
-- drop function if exists public.sched_booking_span_on(public.sched_bookings, date);
-- drop function if exists public.sched_course_span_on(text, date);
-- drop function if exists public.sched_course_has_sessions(text);
