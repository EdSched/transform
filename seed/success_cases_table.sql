-- 合格案例（success_cases）
-- 先确认这 3 个函数存在（应返回 3 行；前两批已确认过可跳过）：
--    select proname from pg_proc where proname in ('is_admin','current_teacher_id','is_domain_key');

create table if not exists public.success_cases (
  id text primary key,
  domain text not null,
  majors text[] default '{}',
  student_id text,               -- 关联的真实学生（可为空；只用于带出数据，不对外显示）
  alias text not null,           -- 对外显示的称呼，例：小A
  tagline text,                  -- 例：语校4月生·方向模糊
  background text,               -- 例：N1 130分 / TOEIC 700+ / 有兴趣但方向不清
  timeline jsonb default '[]',   -- [{period:'5月', content:'报名社会人文学系课程'}]
  result text,                   -- 例：筑波大学 · 一桥大学
  quote text,                    -- 学生感言
  works jsonb default '[]',      -- 作业展示：[{url, caption, feedback, src}]
  plan_files jsonb default '[]', -- 计划书 / 志望理由书（老师批改版）：[{url, name, note, src}]
  tags text[] default '{}',      -- 例：跨专业、零基础、专科
  published boolean default false,
  created_by text,
  updated_at timestamptz default now()
);
create index if not exists success_cases_domain_idx on public.success_cases (domain, updated_at desc);

-- RLS：读 = 管理员、登录老师、领域链接；写 = 管理员、领域链接、登录老师（前端按权限和领域控制）
alter table public.success_cases enable row level security;
drop policy if exists sc_read  on public.success_cases;
drop policy if exists sc_write on public.success_cases;
create policy sc_read  on public.success_cases for select using (is_admin() or current_teacher_id() is not null or is_domain_key());
create policy sc_write on public.success_cases for all    using (is_admin() or current_teacher_id() is not null or is_domain_key())
                                                          with check (is_admin() or current_teacher_id() is not null or is_domain_key());

-- ── 回滚 ──
-- drop table if exists public.success_cases;
