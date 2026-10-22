-- 排教室推送给负责人确认：新表 sched_course_requests
-- 由 Sensis 在 Supabase SQL Editor 手动执行，合并前执行。回滚在文件最后。
--
-- 权限说明：数据库里没有"某个领域的负责人"这一层（courses 表的 RLS 也只分 is_staff() / is_sched_user()），
-- 所以这里照 courses 的做法：登录的管理端账号（is_staff）和排课口令账号（is_sched_user）可读、可新建、可更新，不开放删除。
-- "只有负责这门课的人才看到提示" 由管理端页面按 scopeCourse(c) + 管理模式的「课程」页开关过滤，和课程安排页现有的范围规则一致。

create table if not exists public.sched_course_requests (
  id           bigserial primary key,
  course_id    text not null,                       -- = courses.id
  domain       text,                                -- 推送时从课程抄一份，方便按范围查
  major        text[],
  issues       text[] not null,                     -- no_room 没有教室 / time_conflict 时间冲突 / capacity 容量不够 / other 其他
  message      text not null,                       -- 推送的说明（可编辑的自动文案）
  status       text not null default 'pending',     -- pending 待确认 / replied 已回复 / resolved 已解决 / withdrawn 已撤回
  reply        text,
  reply_action text,
  replied_by   text,
  replied_at   timestamptz,
  created_by   text,
  created_at   timestamptz default now(),
  resolved_at  timestamptz,
  constraint sched_course_requests_status_chk check (status in ('pending','replied','resolved','withdrawn'))
);
create index if not exists sched_course_requests_course_idx on public.sched_course_requests (course_id);
create index if not exists sched_course_requests_status_idx on public.sched_course_requests (status);

alter table public.sched_course_requests enable row level security;

drop policy if exists "sched_course_requests read"   on public.sched_course_requests;
drop policy if exists "sched_course_requests insert" on public.sched_course_requests;
drop policy if exists "sched_course_requests update" on public.sched_course_requests;

create policy "sched_course_requests read"   on public.sched_course_requests for select using (public.is_staff() or public.is_sched_user());
create policy "sched_course_requests insert" on public.sched_course_requests for insert with check (public.is_staff() or public.is_sched_user());
create policy "sched_course_requests update" on public.sched_course_requests for update using (public.is_staff() or public.is_sched_user()) with check (public.is_staff() or public.is_sched_user());

-- 检查：策略是否生效（应有 3 条）
-- select policyname, cmd from pg_policies where tablename = 'sched_course_requests';

-- ============================================================
-- 回滚
-- ============================================================
-- drop table if exists public.sched_course_requests;
