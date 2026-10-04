-- 任务管理（PR ①）：任务模板 / 年度节点 / 完成记录 三张表 + 行级权限
-- 先确认这几个函数存在（应返回 3 行）：
--    select proname from pg_proc where proname in ('is_admin','is_staff','current_teacher_id');
-- 执行顺序：本文件 → 合并 PR → 在中枢「📋 任务管理」点「📥 导入初始模板」

create table if not exists public.task_templates (
  id text primary key,
  title text not null,
  detail text,
  role text,                 -- all_lead / subj_lead / lecturer / subj_ta / all_ta（空 = 未分配）
  role_tag text,             -- 对应的职能标签文字（全学科负责人 / 学科负责人 / 任课讲师 / 学科TA / 全学科TA）
  assign_by text not null default 'role',  -- feature = 跟功能走；role = 跟职能走
  requires text,             -- 跟功能走时对应的权限代号（例：homework、records_entry、tag:专业课老师）
  requires_label text,       -- 显示名（例：老师端功能 · 作业反馈）
  kind text not null,        -- auto / manual
  months int[] not null default '{}',   -- 哪几个月出现（1–12）
  when_text text,            -- 时间说明，例：每月 30 日前、开课前一个月
  check_key text,            -- 自动检测代号
  link text,                 -- 点击跳转到哪里（页面 / 板块）
  collab text,               -- 配合者
  domain text,               -- 适用领域（空 = 全部）
  source text,
  active boolean default true,
  sort_order int default 0
);
create table if not exists public.task_calendar (
  id text primary key, month int not null, track text, title text not null, domain text, sort_order int default 0
);
create table if not exists public.task_done (
  id text primary key,
  template_id text not null,
  period text not null,      -- 2026-10（按月）
  teacher_id text not null,
  done_at timestamptz default now(),
  note text
);
create unique index if not exists task_done_uniq on public.task_done (template_id, period, teacher_id);

alter table public.task_templates enable row level security;
alter table public.task_calendar  enable row level security;
alter table public.task_done      enable row level security;

drop policy if exists tt_read  on public.task_templates;  drop policy if exists tt_write  on public.task_templates;
drop policy if exists tc_read  on public.task_calendar;   drop policy if exists tc_write  on public.task_calendar;
drop policy if exists td_read  on public.task_done;       drop policy if exists td_write  on public.task_done;

-- 读取规则必须包含 is_admin()：网页写入时会把新行读回来显示（return=representation），
-- 读取规则不含 is_admin() 时，管理员写入会被判成违规（42501）。
create policy tt_read  on public.task_templates for select using (public.is_admin() or public.is_staff());
create policy tt_write on public.task_templates for all    using (public.is_admin()) with check (public.is_admin());
create policy tc_read  on public.task_calendar  for select using (public.is_admin() or public.is_staff());
create policy tc_write on public.task_calendar  for all    using (public.is_admin()) with check (public.is_admin());
create policy td_read  on public.task_done      for select using (public.is_admin() or public.is_staff() or teacher_id = public.current_teacher_id());
create policy td_write on public.task_done      for all
  using      (is_admin() or teacher_id = current_teacher_id())
  with check (is_admin() or teacher_id = current_teacher_id());

-- ── 回滚（整体删除；里面的数据会一起没有）──
-- drop table if exists public.task_done;
-- drop table if exists public.task_calendar;
-- drop table if exists public.task_templates;
