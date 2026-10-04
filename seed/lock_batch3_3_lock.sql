-- ============================================================
-- 数据库上锁 第 3 批 · PR ③ · 上锁 SQL（Sensis 看过 PR 里的盘点表、并确认后再执行）
-- 其余 sched_* 表。整个文件一次性执行；任何前置检查不通过会整体回滚、什么都不改。
-- 前提：已执行 lock_batch3_2_prepare.sql（is_sched_user() 存在）、PR ② 已上锁并测试通过。
--
-- 规则（盘点依据见 PR 说明）：
--   A 类「公开可读、写入上锁」：sched_rooms / sched_courses / sched_bookings / sched_holidays / sched_timetable_templates
--       读 = 所有人（今日课表 today.html、教室看板、VIP 预约页 vip.html、课程表分享链接 ?t= 都要不登录读）
--       写 = is_staff() 或 is_sched_user()
--       sched_bookings 额外：匿名可新增「VIP 待确认」预约、可删除 VIP 预约（sched/vip.html 还在用，这是对现状的收紧，不是放开）
--   B 类「读写都上锁」：sched_meeting_accounts（含腾讯会议登录名和密码）/ sched_meeting_templates / sched_change_log / sched_course_id_map
--       读写 = is_staff() 或 is_sched_user()
-- ============================================================

begin;

-- ── 前置检查：非 security definer 的函数（多半是触发器）会读写上锁的表 → 匿名身份触发时会被拦住 ──
do $$
declare r record; bad text := '';
begin
  for r in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and not p.prosecdef
      and (
        p.prosrc ~* '(from|join|into|update)\s+(public\.)?(sched_meeting_accounts|sched_meeting_templates|sched_change_log|sched_course_id_map)\y'
        or p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(sched_rooms|sched_courses|sched_bookings|sched_holidays|sched_timetable_templates)\y'
      )
  loop
    bad := bad || format(E'\n  函数 %s()', r.proname);
  end loop;
  if bad <> '' then
    raise exception E'这些函数会读写要上锁的 sched_* 表但不是 security definer，请把这段发给 Claude 评估（不要强行上锁）：%', bad;
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.is_sched_user()') is null then
    raise exception '没有 is_sched_user()，请先执行 lock_batch3_2_prepare.sql';
  end if;
end $$;

-- ── 备份被删除的旧规则（留档用）──
create table if not exists public._policy_backup (
  tablename text, policyname text, cmd text, roles text, qual text, with_check text, saved_at timestamptz default now()
);
revoke all on public._policy_backup from anon, authenticated;
insert into public._policy_backup (tablename, policyname, cmd, roles, qual, with_check)
select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies
where schemaname = 'public' and tablename in ('sched_rooms','sched_courses','sched_bookings','sched_holidays','sched_timetable_templates',
                                              'sched_meeting_accounts','sched_meeting_templates','sched_change_log','sched_course_id_map');

-- ── 工具函数：一张表一次上锁（本事务内临时存在，提交后自动消失）──
create function pg_temp.sched_lock(t text, public_read boolean) returns void language plpgsql as $f$
declare r record;
begin
  if to_regclass('public.' || t) is null then raise notice '表 % 不存在，跳过', t; return; end if;
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
    execute format('drop policy %I on public.%I', r.policyname, t);
  end loop;
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy %I on public.%I for select using (%s)', t || ' read', t,
                 case when public_read then 'true' else 'public.is_staff() or public.is_sched_user()' end);
  execute format('create policy %I on public.%I for insert with check (public.is_staff() or public.is_sched_user())', t || ' insert', t);
  execute format('create policy %I on public.%I for update using (public.is_staff() or public.is_sched_user()) with check (public.is_staff() or public.is_sched_user())', t || ' update', t);
  execute format('create policy %I on public.%I for delete using (public.is_staff() or public.is_sched_user())', t || ' delete', t);
end $f$;

-- ── A 类：公开可读、写入上锁 ──
select pg_temp.sched_lock('sched_rooms', true);
select pg_temp.sched_lock('sched_courses', true);
select pg_temp.sched_lock('sched_holidays', true);
select pg_temp.sched_lock('sched_timetable_templates', true);
select pg_temp.sched_lock('sched_bookings', true);

-- sched_bookings：sched/vip.html（VIP 老师不登录自己预约）还要能新增「VIP 待确认」预约、取消自己的 VIP 预约
drop policy if exists "sched_bookings insert" on public.sched_bookings;
create policy "sched_bookings insert" on public.sched_bookings for insert
  with check (public.is_staff() or public.is_sched_user() or (kind = 'vip' and status = 'pending'));
drop policy if exists "sched_bookings delete" on public.sched_bookings;
create policy "sched_bookings delete" on public.sched_bookings for delete
  using (public.is_staff() or public.is_sched_user() or kind = 'vip');

-- ── B 类：读写都上锁 ──
select pg_temp.sched_lock('sched_meeting_accounts', false);
select pg_temp.sched_lock('sched_meeting_templates', false);
select pg_temp.sched_lock('sched_change_log', false);
select pg_temp.sched_lock('sched_course_id_map', false);

commit;

-- ── 验证（不登录 / 匿名公钥）──
--  …/rest/v1/sched_meeting_accounts?select=*     应返回 []
--  …/rest/v1/sched_rooms?select=id&limit=1        应返回数据（公开读）
--  匿名 PATCH/DELETE sched_rooms / sched_courses / sched_holidays：应被拒绝（影响 0 行或报错）

-- ── 回滚（每张表一段，只撤出问题的那张；撤销后该表恢复成不设防，和上锁前一样）──
-- drop policy if exists "sched_rooms read" on public.sched_rooms; drop policy if exists "sched_rooms insert" on public.sched_rooms; drop policy if exists "sched_rooms update" on public.sched_rooms; drop policy if exists "sched_rooms delete" on public.sched_rooms; alter table public.sched_rooms disable row level security;
-- drop policy if exists "sched_courses read" on public.sched_courses; drop policy if exists "sched_courses insert" on public.sched_courses; drop policy if exists "sched_courses update" on public.sched_courses; drop policy if exists "sched_courses delete" on public.sched_courses; alter table public.sched_courses disable row level security;
-- drop policy if exists "sched_holidays read" on public.sched_holidays; drop policy if exists "sched_holidays insert" on public.sched_holidays; drop policy if exists "sched_holidays update" on public.sched_holidays; drop policy if exists "sched_holidays delete" on public.sched_holidays; alter table public.sched_holidays disable row level security;
-- drop policy if exists "sched_timetable_templates read" on public.sched_timetable_templates; drop policy if exists "sched_timetable_templates insert" on public.sched_timetable_templates; drop policy if exists "sched_timetable_templates update" on public.sched_timetable_templates; drop policy if exists "sched_timetable_templates delete" on public.sched_timetable_templates; alter table public.sched_timetable_templates disable row level security;
-- drop policy if exists "sched_bookings read" on public.sched_bookings; drop policy if exists "sched_bookings insert" on public.sched_bookings; drop policy if exists "sched_bookings update" on public.sched_bookings; drop policy if exists "sched_bookings delete" on public.sched_bookings; alter table public.sched_bookings disable row level security;
-- drop policy if exists "sched_meeting_accounts read" on public.sched_meeting_accounts; drop policy if exists "sched_meeting_accounts insert" on public.sched_meeting_accounts; drop policy if exists "sched_meeting_accounts update" on public.sched_meeting_accounts; drop policy if exists "sched_meeting_accounts delete" on public.sched_meeting_accounts; alter table public.sched_meeting_accounts disable row level security;
-- drop policy if exists "sched_meeting_templates read" on public.sched_meeting_templates; drop policy if exists "sched_meeting_templates insert" on public.sched_meeting_templates; drop policy if exists "sched_meeting_templates update" on public.sched_meeting_templates; drop policy if exists "sched_meeting_templates delete" on public.sched_meeting_templates; alter table public.sched_meeting_templates disable row level security;
-- drop policy if exists "sched_change_log read" on public.sched_change_log; drop policy if exists "sched_change_log insert" on public.sched_change_log; drop policy if exists "sched_change_log update" on public.sched_change_log; drop policy if exists "sched_change_log delete" on public.sched_change_log; alter table public.sched_change_log disable row level security;
-- drop policy if exists "sched_course_id_map read" on public.sched_course_id_map; drop policy if exists "sched_course_id_map insert" on public.sched_course_id_map; drop policy if exists "sched_course_id_map update" on public.sched_course_id_map; drop policy if exists "sched_course_id_map delete" on public.sched_course_id_map; alter table public.sched_course_id_map disable row level security;
