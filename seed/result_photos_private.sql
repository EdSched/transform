-- ============================================================
-- 合格实绩⑦（隐私）：未遮盖的合格截图改放私有桶，公开数据里不再有照片链接
-- 合并 PR 之前在 Supabase SQL Editor 一次性执行；可重复执行。
-- 合并后：管理端「合格写真」页点一次「迁移旧照片」。
--
-- 做了什么：
--  1. 新私有桶 admission-private：任何人只能往 grad/ ug/ 里「放」（收集页面不登录也要能传），
--     读 / 改 / 删只有管理员（is_admin()）。
--  2. 新表 result_photos：照片路径单独放，公开的结果表里不再有。
--     result_id 用 text（大学院 / 学部的记录编号类型不同，跟 pass_posters.result_id 一致）。
--     插入所有人可以（收集页面要写），读 / 改 / 删只有管理员。
--  3. 公开桶 admission-photos（海报、合格案例）：删掉「所有人可读」那条规则（别人不能再列文件清单，
--     /object/public/… 链接照常能打开）；INSERT 只允许登录的人、只能放 posters/ cases/；管理员全权限。
-- 前提：已有 is_admin() 函数、已执行 seed/pass_posters.sql。
-- 注意：本 PR 的 shared/supabase.js 已让 sbUpload 对 admission-photos 带登录身份（合格案例上传）；
--       执行本 SQL 后、PR 合并前，老师端上传案例图会暂时失败，请尽快合并。
-- ============================================================
begin;

-- ── 1. 私有桶 ──
insert into storage.buckets (id, name, public)
values ('admission-private', 'admission-private', false)
on conflict (id) do update set public = false;

drop policy if exists "admission_private insert" on storage.objects;
drop policy if exists "admission_private admin"  on storage.objects;
create policy "admission_private insert" on storage.objects for insert
  with check (bucket_id = 'admission-private' and (storage.foldername(name))[1] in ('grad', 'ug'));
create policy "admission_private admin" on storage.objects for all
  using (bucket_id = 'admission-private' and public.is_admin())
  with check (bucket_id = 'admission-private' and public.is_admin());

-- ── 2. result_photos ──
create table if not exists public.result_photos (
  id          uuid primary key default gen_random_uuid(),
  result_kind text not null check (result_kind in ('grad', 'ug')),
  result_id   text not null,
  path        text not null,            -- admission-private 里的路径，例 grad/169..._ab12.jpg
  created_at  timestamptz default now(),
  unique (result_kind, result_id)
);
alter table public.result_photos enable row level security;
drop policy if exists "result_photos insert" on public.result_photos;
drop policy if exists "result_photos admin"  on public.result_photos;
create policy "result_photos insert" on public.result_photos for insert with check (true);
create policy "result_photos admin"  on public.result_photos for all
  using (public.is_admin()) with check (public.is_admin());
-- 匿名要能 insert：确认表权限（RLS 仍然卡住读 / 改 / 删）
grant insert on public.result_photos to anon, authenticated;
grant select, update, delete on public.result_photos to authenticated;

-- ── 3. 收紧公开桶 admission-photos ──
-- 先看现状（可选）：select policyname, cmd, qual, with_check from pg_policies where schemaname='storage' and tablename='objects';
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'storage' and tablename = 'objects'
              and (coalesce(qual, '') like '%admission-photos%' or coalesce(with_check, '') like '%admission-photos%')
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

create policy "admission_photos insert" on storage.objects for insert
  with check (bucket_id = 'admission-photos' and auth.role() = 'authenticated'
              and (storage.foldername(name))[1] in ('posters', 'cases'));
create policy "admission_photos admin" on storage.objects for all
  using (bucket_id = 'admission-photos' and public.is_admin())
  with check (bucket_id = 'admission-photos' and public.is_admin());

commit;

-- ── 回滚 ──
-- begin;
-- drop policy if exists "admission_private insert" on storage.objects;
-- drop policy if exists "admission_private admin"  on storage.objects;
-- drop policy if exists "admission_photos insert"  on storage.objects;
-- drop policy if exists "admission_photos admin"   on storage.objects;
-- -- 恢复公开桶原来的宽松规则：
-- create policy "允许读取合格图片" on storage.objects for select using (bucket_id = 'admission-photos');
-- create policy "admission_photos insert anon" on storage.objects for insert with check (bucket_id = 'admission-photos');
-- -- 私有桶里还有照片时先在 Storage 页面清空，再删桶（或保留桶不删）：
-- -- delete from storage.objects where bucket_id = 'admission-private';   -- 会丢照片，谨慎
-- -- delete from storage.buckets where id = 'admission-private';
-- -- 迁移过的数据：result_photos 里记着路径，回滚前不要 drop 这张表
-- -- drop table if exists public.result_photos;
-- commit;
