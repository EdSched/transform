-- 咨询台第 2 期：课程推荐规则表 + 让有「咨询」权限的老师能读套餐价目
-- 前提：已执行过咨询台第 1 期的 consult_leads / faq 建表，数据库里有 is_admin() 和 current_teacher_id()。可重复执行。
begin;

-- 1) 判断函数：老师有「咨询」权限（permissions.consult 为 true，布尔或字符串都认）
create or replace function public.can_consult() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin(), false) or exists (
    select 1 from public.teachers t
     where t.id = public.current_teacher_id()
       and lower(coalesce(t.permissions->>'consult', '')) = 'true')
$$;
grant execute on function public.can_consult() to anon, authenticated;

-- 2) 课程推荐规则：差距 -> 课程（课程名含任一关键词即算覆盖）
create table if not exists public.consult_rules (
  id         uuid primary key default gen_random_uuid(),
  gap        text not null,                 -- jp / en / plan / interview / written / specialty
  title      text not null,
  keywords   text[] not null default '{}',
  majors     text[] not null default '{}',  -- 空 = 全部专业
  sort       int not null default 0,
  published  boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.consult_rules enable row level security;
drop policy if exists "consult_rules read" on public.consult_rules;
create policy "consult_rules read" on public.consult_rules for select to authenticated using (public.can_consult());
drop policy if exists "consult_rules admin write" on public.consult_rules;
create policy "consult_rules admin write" on public.consult_rules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 3) 套餐价目：另加一条只读规则，让有「咨询」权限的老师也能读 price_packages（原有规则不动；VIP / TA 价目不开放）
drop policy if exists "pp_read_consult" on public.price_packages;
create policy "pp_read_consult" on public.price_packages for select to authenticated using (public.can_consult());

commit;

-- ── 回滚 ──
-- begin;
-- drop policy if exists "pp_read_consult" on public.price_packages;
-- drop table if exists public.consult_rules;
-- drop function if exists public.can_consult();
-- commit;
