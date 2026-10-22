-- 课程只留一份 · 第 3 步（PR-C）：退役旧的同步和旧表
-- 由 Sensis 在 Supabase SQL Editor 手动执行；一定要按文件里"执行顺序"来，回滚在文件最后。
--
-- 做什么：
--   · 删掉四个同步触发器（四个函数先留着）和 course_ref 自动补填触发器
--   · sched_courses → sched_courses_legacy，sched_course_id_map → sched_course_id_map_legacy，只读（去掉写入策略），作备份，不删
--   · sched_bookings：course_id 改名 course_id_legacy（旧数字号），course_ref 改名 course_id（= 管理端课程 id）；
--     再临时加一个生成列 course_ref（= course_id），让还没刷新到新代码的旧页面继续读得到（过渡用，见最后的第 3b 步）
--   · 视图 sched_course_v 不用改（它引用的表会跟着改名）；legacy_sched_id 仍然能查到旧课程的旧号
--
-- ============================================================
-- 执行顺序（页面有 10 分钟左右 CDN 延迟，所以先执行 SQL，再合并代码）：
--   1) 先跑下面「A. 预检」的只读查询，把结果给 Claude 看，确认没有别的东西依赖旧表/旧列
--   2) 挑一个没人在排课的时间，执行「B. 迁移」
--   3) 马上合并 PR-C 的代码，等约 10 分钟，用无痕窗口 + 强制刷新
--   4) 这段时间里（SQL 执行后、新代码生效前），旧页面上"新排教室 / 改占用"会报错，读取和查看不受影响——请这段时间别排课
--   5) 新代码稳定后，执行「C. 第 3b 步」去掉过渡用的生成列
-- ============================================================

-- ============================================================
-- A. 预检（只读，逐条执行，结果给 Claude）
-- ============================================================

-- A.1 有没有函数 / 触发器函数引用了这些表或列
select p.proname, left(p.prosrc, 200) as src_head
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.prosrc ilike '%sched_courses%' or p.prosrc ilike '%sched_course_id_map%' or p.prosrc ilike '%course_id%' or p.prosrc ilike '%course_ref%')
order by p.proname;

-- A.2 有没有视图引用
select viewname, left(definition, 300) as def_head
from pg_views
where schemaname = 'public' and (definition ilike '%sched_courses%' or definition ilike '%sched_course_id_map%' or definition ilike '%course_ref%')
  and viewname <> 'sched_course_v';

-- A.3 有没有别的表的外键指向旧表
select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid) as def
from pg_constraint
where confrelid in ('public.sched_courses'::regclass, 'public.sched_course_id_map'::regclass);

-- A.4 sched_bookings / sched_courses 上现有的全部触发器
select c.relname as tbl, t.tgname, pg_get_triggerdef(t.oid) as def
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal and c.relname in ('sched_bookings', 'sched_courses', 'sched_course_id_map', 'courses')
order by c.relname, t.tgname;

-- A.5 策略里有没有用到 course_id
select tablename, policyname, qual, with_check from pg_policies
where schemaname = 'public' and (qual ilike '%course_id%' or with_check ilike '%course_id%' or qual ilike '%sched_courses%' or with_check ilike '%sched_courses%');

-- ============================================================
-- B. 迁移（一个事务；任何一步报错整体回滚）
-- ============================================================
begin;

-- B.1 删同步触发器（函数先留着，回滚要用）
drop trigger if exists trg_sync_courses_to_sched    on public.courses;
drop trigger if exists trg_sync_new_course_to_sched on public.courses;
drop trigger if exists trg_sync_sched_to_courses    on public.sched_courses;
drop trigger if exists trg_sync_new_sched_to_course on public.sched_courses;
drop trigger if exists trg_sched_bookings_fill_course_ref on public.sched_bookings;
drop function if exists public.sched_bookings_fill_course_ref();

-- B.2 旧表改名并改成只读（去掉写入策略，保留读取）
alter table public.sched_courses       rename to sched_courses_legacy;
alter table public.sched_course_id_map rename to sched_course_id_map_legacy;
drop policy if exists "sched_courses insert" on public.sched_courses_legacy;
drop policy if exists "sched_courses update" on public.sched_courses_legacy;
drop policy if exists "sched_courses delete" on public.sched_courses_legacy;
drop policy if exists "sched_course_id_map insert" on public.sched_course_id_map_legacy;
drop policy if exists "sched_course_id_map update" on public.sched_course_id_map_legacy;
drop policy if exists "sched_course_id_map delete" on public.sched_course_id_map_legacy;

-- B.3 sched_bookings：course_ref 变成 course_id
alter table public.sched_bookings rename column course_id  to course_id_legacy;
alter table public.sched_bookings rename column course_ref to course_id;
-- 过渡用：让旧页面里还在 select course_ref 的查询继续有效（第 3b 步删除）
alter table public.sched_bookings add column course_ref text generated always as (course_id) stored;

-- B.4 两个防撞触发器函数原来连的是 sched_courses（只用 c.skip_dates 判断休讲日），改成连管理端课程 courses；
--     其余逻辑一个字没动。注意：必须在上面的列改名之后执行（连接条件变成文本对文本）。
create or replace function public.sched_bookings_check_overlap()
 returns trigger
 language plpgsql
as $function$
DECLARE
  d   date;
  s   time;
  e   time;
  hit record;
BEGIN
  -- 不占教室 / 已驳回 / 周循环排课：不在此处检查
  IF NEW.room_id IS NULL OR NEW.booking_date IS NULL
     OR NEW.start_time IS NULL OR NEW.end_time IS NULL
     OR NEW.status NOT IN ('pending','confirmed')
     OR NEW.recurrence = 'weekly' THEN
    RETURN NEW;
  END IF;

  d := NEW.booking_date::date;
  s := NEW.start_time::time;
  e := NEW.end_time::time;

  -- 同一教室串行化：两人同一瞬间提交也只能过一个
  PERFORM pg_advisory_xact_lock(hashtext('sched_room_' || NEW.room_id::text));

  SELECT b.id, b.kind, b.title, b.user_name, b.status, b.start_time, b.end_time
    INTO hit
    FROM sched_bookings b
    LEFT JOIN public.courses c ON c.id = b.course_id
   WHERE b.id IS DISTINCT FROM NEW.id
     AND b.room_id = NEW.room_id
     AND b.status IN ('pending','confirmed')
     AND b.start_time IS NOT NULL AND b.end_time IS NOT NULL
     AND s < b.end_time::time AND b.start_time::time < e
     AND (
       -- 对方也是单日占用：同一天
       ( b.recurrence IS DISTINCT FROM 'weekly' AND b.booking_date::date = d )
       OR
       -- 对方是排课循环：日期在区间内、周几相同、当天不是休讲日
       ( b.recurrence = 'weekly'
         AND b.weekday IS NOT NULL
         AND (b.weekday::int % 7) = EXTRACT(DOW FROM d)::int
         AND d >= COALESCE(b.start_date::date, d)
         AND d <= COALESCE(b.end_date::date, d)
         AND NOT ( c.skip_dates IS NOT NULL
                   AND d::text = ANY(string_to_array(replace(c.skip_dates,' ',''), ',')) )
       )
     )
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
  s   time;
  e   time;
  nm  text;
  hit record;
BEGIN
  nm := btrim(COALESCE(NEW.user_name, ''));
  IF nm = '' OR NEW.booking_date IS NULL
     OR NEW.start_time IS NULL OR NEW.end_time IS NULL
     OR NEW.status NOT IN ('pending','confirmed')
     OR NEW.recurrence = 'weekly'
     OR NEW.allow_multi IS TRUE THEN          -- 占用录入页确认过"再预约一间"的，放行
    RETURN NEW;
  END IF;

  d := NEW.booking_date::date;
  s := NEW.start_time::time;
  e := NEW.end_time::time;

  PERFORM pg_advisory_xact_lock(hashtext('sched_teacher_' || nm));

  SELECT b.id, b.kind, b.title, b.student_name, b.status, b.start_time, b.end_time, r.name AS room
    INTO hit
    FROM sched_bookings b
    LEFT JOIN public.courses c ON c.id = b.course_id
    LEFT JOIN sched_rooms   r ON r.id = b.room_id
   WHERE b.id IS DISTINCT FROM NEW.id
     AND btrim(COALESCE(b.user_name,'')) = nm
     AND b.status IN ('pending','confirmed')
     AND b.start_time IS NOT NULL AND b.end_time IS NOT NULL
     AND s < b.end_time::time AND b.start_time::time < e
     AND (
       ( b.recurrence IS DISTINCT FROM 'weekly' AND b.booking_date::date = d )
       OR
       ( b.recurrence = 'weekly'
         AND b.weekday IS NOT NULL
         AND (b.weekday::int % 7) = EXTRACT(DOW FROM d)::int
         AND d >= COALESCE(b.start_date::date, d)
         AND d <= COALESCE(b.end_date::date, d)
         AND NOT ( c.skip_dates IS NOT NULL
                   AND d::text = ANY(string_to_array(replace(c.skip_dates,' ',''), ',')) )
       )
     )
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

-- B.5 检查（只读）：课程占用都有新 course_id；旧表都还在
select count(*) filter (where kind = 'course' and course_id is null) as course_bookings_without_id,
       count(*) filter (where kind = 'course') as course_bookings
from public.sched_bookings;
select (select count(*) from public.sched_courses_legacy) as legacy_courses,
       (select count(*) from public.sched_course_id_map_legacy) as legacy_map,
       (select count(*) from public.sched_course_v) as view_rows;

-- ============================================================
-- C. 第 3b 步：新代码稳定后（旧页面缓存都过期了），去掉过渡用的生成列
-- ============================================================
-- alter table public.sched_bookings drop column if exists course_ref;

-- ============================================================
-- 回滚（若已执行 3b，先补回 course_ref 再按下面做；回滚后要把 PR-C 的代码也回退）
-- ============================================================
-- begin;
-- alter table public.sched_bookings drop column if exists course_ref;
-- alter table public.sched_bookings rename column course_id to course_ref;
-- alter table public.sched_bookings rename column course_id_legacy to course_id;
-- alter table public.sched_courses_legacy       rename to sched_courses;
-- alter table public.sched_course_id_map_legacy rename to sched_course_id_map;
-- create policy "sched_courses insert" on public.sched_courses for insert with check (is_staff() or is_sched_user());
-- create policy "sched_courses update" on public.sched_courses for update using (is_staff() or is_sched_user()) with check (is_staff() or is_sched_user());
-- create policy "sched_courses delete" on public.sched_courses for delete using (is_staff() or is_sched_user());
-- create policy "sched_course_id_map insert" on public.sched_course_id_map for insert with check (is_staff() or is_sched_user());
-- create policy "sched_course_id_map update" on public.sched_course_id_map for update using (is_staff() or is_sched_user()) with check (is_staff() or is_sched_user());
-- create policy "sched_course_id_map delete" on public.sched_course_id_map for delete using (is_staff() or is_sched_user());
-- create trigger trg_sync_courses_to_sched    after update on public.courses       for each row execute function public.sync_courses_to_sched();
-- create trigger trg_sync_new_course_to_sched after insert on public.courses       for each row execute function public.sync_new_course_to_sched();
-- create trigger trg_sync_sched_to_courses    after update on public.sched_courses for each row execute function public.sync_sched_to_courses();
-- create trigger trg_sync_new_sched_to_course after insert on public.sched_courses for each row execute function public.sync_new_sched_to_course();
-- create or replace function public.sched_bookings_fill_course_ref() returns trigger language plpgsql security definer set search_path = public as $f$
-- begin
--   if new.course_id is not null and new.course_ref is null then
--     select m.course_id into new.course_ref from public.sched_course_id_map m where m.sched_id = new.course_id;
--   end if;
--   return new;
-- end $f$;
-- create trigger trg_sched_bookings_fill_course_ref before insert or update of course_id on public.sched_bookings
--   for each row execute function public.sched_bookings_fill_course_ref();
-- -- 防撞函数改回连 sched_courses（先执行上面的改名回滚，再执行）：
-- create or replace function public.sched_bookings_check_overlap()
--  returns trigger
--  language plpgsql
-- as $function$
-- DECLARE
--   d   date;
--   s   time;
--   e   time;
--   hit record;
-- BEGIN
--   -- 不占教室 / 已驳回 / 周循环排课：不在此处检查
--   IF NEW.room_id IS NULL OR NEW.booking_date IS NULL
--      OR NEW.start_time IS NULL OR NEW.end_time IS NULL
--      OR NEW.status NOT IN ('pending','confirmed')
--      OR NEW.recurrence = 'weekly' THEN
--     RETURN NEW;
--   END IF;
--
--   d := NEW.booking_date::date;
--   s := NEW.start_time::time;
--   e := NEW.end_time::time;
--
--   -- 同一教室串行化：两人同一瞬间提交也只能过一个
--   PERFORM pg_advisory_xact_lock(hashtext('sched_room_' || NEW.room_id::text));
--
--   SELECT b.id, b.kind, b.title, b.user_name, b.status, b.start_time, b.end_time
--     INTO hit
--     FROM sched_bookings b
--     LEFT JOIN sched_courses c ON c.id = b.course_id
--    WHERE b.id IS DISTINCT FROM NEW.id
--      AND b.room_id = NEW.room_id
--      AND b.status IN ('pending','confirmed')
--      AND b.start_time IS NOT NULL AND b.end_time IS NOT NULL
--      AND s < b.end_time::time AND b.start_time::time < e
--      AND (
--        -- 对方也是单日占用：同一天
--        ( b.recurrence IS DISTINCT FROM 'weekly' AND b.booking_date::date = d )
--        OR
--        -- 对方是排课循环：日期在区间内、周几相同、当天不是休讲日
--        ( b.recurrence = 'weekly'
--          AND b.weekday IS NOT NULL
--          AND (b.weekday::int % 7) = EXTRACT(DOW FROM d)::int
--          AND d >= COALESCE(b.start_date::date, d)
--          AND d <= COALESCE(b.end_date::date, d)
--          AND NOT ( c.skip_dates IS NOT NULL
--                    AND d::text = ANY(string_to_array(replace(c.skip_dates,' ',''), ',')) )
--        )
--      )
--    LIMIT 1;
--
--   IF FOUND THEN
--     RAISE EXCEPTION '教室已被占用：% %-% %「%」%（记录#%）',
--       d, hit.start_time, hit.end_time,
--       CASE hit.status WHEN 'pending' THEN '待审批' ELSE '已确认' END,
--       COALESCE(hit.title, hit.kind, '占用'),
--       COALESCE(hit.user_name, ''),
--       hit.id
--       USING ERRCODE = 'exclusion_violation';
--   END IF;
--
--   RETURN NEW;
-- END $function$;
--
-- create or replace function public.sched_bookings_check_teacher_dup()
--  returns trigger
--  language plpgsql
-- as $function$
-- DECLARE
--   d   date;
--   s   time;
--   e   time;
--   nm  text;
--   hit record;
-- BEGIN
--   nm := btrim(COALESCE(NEW.user_name, ''));
--   IF nm = '' OR NEW.booking_date IS NULL
--      OR NEW.start_time IS NULL OR NEW.end_time IS NULL
--      OR NEW.status NOT IN ('pending','confirmed')
--      OR NEW.recurrence = 'weekly'
--      OR NEW.allow_multi IS TRUE THEN          -- 占用录入页确认过"再预约一间"的，放行
--     RETURN NEW;
--   END IF;
--
--   d := NEW.booking_date::date;
--   s := NEW.start_time::time;
--   e := NEW.end_time::time;
--
--   PERFORM pg_advisory_xact_lock(hashtext('sched_teacher_' || nm));
--
--   SELECT b.id, b.kind, b.title, b.student_name, b.status, b.start_time, b.end_time, r.name AS room
--     INTO hit
--     FROM sched_bookings b
--     LEFT JOIN sched_courses c ON c.id = b.course_id
--     LEFT JOIN sched_rooms   r ON r.id = b.room_id
--    WHERE b.id IS DISTINCT FROM NEW.id
--      AND btrim(COALESCE(b.user_name,'')) = nm
--      AND b.status IN ('pending','confirmed')
--      AND b.start_time IS NOT NULL AND b.end_time IS NOT NULL
--      AND s < b.end_time::time AND b.start_time::time < e
--      AND (
--        ( b.recurrence IS DISTINCT FROM 'weekly' AND b.booking_date::date = d )
--        OR
--        ( b.recurrence = 'weekly'
--          AND b.weekday IS NOT NULL
--          AND (b.weekday::int % 7) = EXTRACT(DOW FROM d)::int
--          AND d >= COALESCE(b.start_date::date, d)
--          AND d <= COALESCE(b.end_date::date, d)
--          AND NOT ( c.skip_dates IS NOT NULL
--                    AND d::text = ANY(string_to_array(replace(c.skip_dates,' ',''), ',')) )
--        )
--      )
--    LIMIT 1;
--
--   IF FOUND THEN
--     RAISE EXCEPTION '重复预约：% 在 % %-% 已有%「%」%（%，记录#%）',
--       nm, d, hit.start_time, hit.end_time,
--       CASE hit.status WHEN 'pending' THEN '待审批预约' ELSE '已确认预约' END,
--       COALESCE(hit.title, hit.kind, '占用'),
--       CASE WHEN hit.student_name IS NOT NULL THEN ' 学生:' || hit.student_name ELSE '' END,
--       COALESCE(hit.room, '未指定教室'),
--       hit.id
--       USING ERRCODE = 'unique_violation';
--   END IF;
--
--   RETURN NEW;
-- END $function$;
--
-- commit;
