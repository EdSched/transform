-- 课程方案（带价格）：价目 3 张表 + 营业老师做好的方案 1 张表
-- 先确认这 3 个函数存在（应返回 3 行）：
--    select proname from pg_proc where proname in ('is_admin','current_teacher_id','is_domain_key');

create table if not exists public.price_packages (      -- 大课套餐
  id text primary key,
  track text not null,             -- 学部理科 / 学部文科 / 大学院文科 / 大学院理科 …
  name text not null,              -- EJU半年冲刺课程
  price_man_yen numeric not null,  -- 45（万日元）
  period text,                     -- 约六个月（物理、化学、生物3选2）
  included jsonb default '[]',     -- [{group,item,mark:'○'|'△'}]，只在后台查看，不输出到资料
  sort_order int default 0,
  active boolean default true
);
create table if not exists public.price_vip_rates (     -- VIP 单价
  id text primary key,
  track text not null,             -- 大学院文理科 / 学部文理科 / 语言类
  name text not null,
  yen_per_hour int not null,       -- 13000
  items jsonb default '[]',        -- 可选的授课内容
  sort_order int default 0,
  active boolean default true
);
create table if not exists public.price_ta_options (    -- TA 助教
  id text primary key,
  track text not null,
  name text not null,
  descr text,
  hours text,                      -- 10H+10H
  price_man_yen numeric not null,
  sort_order int default 0,
  active boolean default true
);
create table if not exists public.sales_plans (         -- 营业老师做好的方案（按学生保存）
  id text primary key,
  student_id text,                 -- 可以为空（还没建档的潜在学生）
  student_name text not null,
  track text,
  items jsonb not null,            -- 方案明细：[{kind:'package'|'vip'|'ta'|'other', name, yen, ...}]
  total_yen int not null,
  note text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists sales_plans_created_by_idx on public.sales_plans (created_by, updated_at desc);

-- RLS：价目表 读 = 管理员、登录老师、领域链接；写 = 管理员、领域链接。sales_plans 读写 = 管理员 + 登录老师
alter table public.price_packages  enable row level security;
alter table public.price_vip_rates enable row level security;
alter table public.price_ta_options enable row level security;
alter table public.sales_plans     enable row level security;

drop policy if exists pp_read  on public.price_packages;   drop policy if exists pp_write  on public.price_packages;
drop policy if exists pv_read  on public.price_vip_rates;  drop policy if exists pv_write  on public.price_vip_rates;
drop policy if exists pt_read  on public.price_ta_options; drop policy if exists pt_write  on public.price_ta_options;
drop policy if exists sp_all   on public.sales_plans;

create policy pp_read  on public.price_packages   for select using (is_admin() or current_teacher_id() is not null or is_domain_key());
create policy pp_write on public.price_packages   for all    using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
create policy pv_read  on public.price_vip_rates  for select using (is_admin() or current_teacher_id() is not null or is_domain_key());
create policy pv_write on public.price_vip_rates  for all    using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
create policy pt_read  on public.price_ta_options for select using (is_admin() or current_teacher_id() is not null or is_domain_key());
create policy pt_write on public.price_ta_options for all    using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
create policy sp_all   on public.sales_plans      for all    using (is_admin() or current_teacher_id() is not null) with check (is_admin() or current_teacher_id() is not null);

-- 接着执行 seed/pricing_seed.sql（初始数据）

-- ── 回滚 ──
-- drop table if exists public.sales_plans;
-- drop table if exists public.price_ta_options;
-- drop table if exists public.price_vip_rates;
-- drop table if exists public.price_packages;
