-- 0) 先确认下面 3 个函数都存在（应返回 3 行；少了哪个，先别往下执行，告诉我）
--    select proname from pg_proc where proname in ('is_admin','current_teacher_id','is_domain_key');

-- 1) 通用宣传内容表
create table if not exists public.promo_common (
  id text primary key,
  domain text not null,          -- 例：大学院文科
  title text not null,           -- 块标题，例：核心理念 研究 × 进路 × 素养提升
  body text,                     -- markdown（## 小标题、**粗体**、- 列表、| 表格 |）
  sort_order int default 0,
  published boolean default true,
  updated_at timestamptz default now()
);
create index if not exists promo_common_domain_idx on public.promo_common (domain, sort_order);
alter table public.promo_common enable row level security;
drop policy if exists pc_read  on public.promo_common;
drop policy if exists pc_write on public.promo_common;
create policy pc_read  on public.promo_common for select using (is_admin() or current_teacher_id() is not null or is_domain_key());
create policy pc_write on public.promo_common for all    using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());

-- 2) 再执行 seed/promo_common_seed_大学院文科.sql（初始数据 14 块）

-- ── 回滚 ──
-- drop table if exists public.promo_common;
