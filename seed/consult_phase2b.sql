-- 咨询台第 2 期（下）：宣传册 / 讲师试讲视频 文件表
-- 前提：已执行 seed/consult_phase2.sql（有 can_consult()）。可重复执行。
-- 文件本身传到已有的公开桶 admission-photos 的 consult/ 目录（管理员能写，不用新建桶）；这张表只存链接。
begin;

create table if not exists public.consult_files (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,              -- brochure 宣传册 / trial 讲师试讲视频
  major      text,                       -- 宣传册对应的专业代号
  title      text not null,
  url        text not null,
  teacher    text,                       -- 试讲视频：老师姓名（和课程安排里的老师名匹配）
  keyword    text,                       -- 试讲视频：课程名关键词（空 = 这位老师的所有课程）
  sort       int not null default 0,
  published  boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.consult_files enable row level security;
drop policy if exists "consult_files read" on public.consult_files;
create policy "consult_files read" on public.consult_files for select to authenticated using (public.can_consult());
drop policy if exists "consult_files admin write" on public.consult_files;
create policy "consult_files admin write" on public.consult_files for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

commit;

-- ── 回滚 ──
-- drop table if exists public.consult_files;
