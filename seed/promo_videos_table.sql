-- 宣传视频：专业介绍 / 正课体验等（只存链接，不存文件）。先执行本文件，再执行 promo_videos_seed.sql
create table if not exists public.promo_videos (
  id text primary key,
  major text not null,            -- 专业代号，例 keiei
  kind text,                      -- intro 学科介绍 / lesson 正课体验 / other 其他
  title text not null,            -- 显示名，例 学科介绍
  url text not null,              -- 视频直链（mp4）
  duration text,                  -- 例 30 min
  sort_order int default 0,
  published boolean default true,
  updated_at timestamptz default now()
);
alter table public.promo_videos enable row level security;
drop policy if exists pv_read  on public.promo_videos;
drop policy if exists pv_write on public.promo_videos;
-- 对外宣传页没有登录，所以「已发布」的视频所有人可读
create policy pv_read  on public.promo_videos for select using (published is true or is_admin() or current_teacher_id() is not null or is_domain_key());
create policy pv_write on public.promo_videos for all using (is_admin() or is_domain_key()) with check (is_admin() or is_domain_key());
-- 回滚：drop table if exists public.promo_videos;
