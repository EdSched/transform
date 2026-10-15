-- ============================================================
-- 合格实绩③：合格写真页「制作海报」
-- 合并 PR 之前在 Supabase SQL Editor 一次性执行；可重复执行。
-- 前提：数据库里已有 is_admin() 和 is_staff() 两个函数（没有会直接报错，什么都不改）。
--
-- 三张表：
--   pass_posters         海报（遮盖框、文字、筛选字段、网络版/缩略图链接）。不含原截图。
--   pass_poster_sources  海报用的「未遮盖原截图」链接，只有管理员能读写（老师读不到）
--   univ_en_names        大学英文名记忆
-- 读写规则：
--   pass_posters         读 = 管理员，或 老师/领域链接且这张海报已发布（web_url 不为空）；写 = 管理员
--   pass_poster_sources  读写 = 只有管理员
--   univ_en_names        读 = 管理员或老师；写 = 管理员
-- ============================================================
begin;

do $$
declare t text;
begin
  if to_regprocedure('public.is_admin()') is null or to_regprocedure('public.is_staff()') is null then
    raise exception '数据库里没有 is_admin() 或 is_staff()，请把这段发给 Claude 评估';
  end if;
  -- result_id 的类型跟 admission_results.id 保持一致（uuid 或 text 都行）
  select format_type(a.atttypid, a.atttypmod) into t
    from pg_attribute a
   where a.attrelid = 'public.admission_results'::regclass and a.attname = 'id' and not a.attisdropped;
  if t is null then raise exception '找不到 admission_results.id'; end if;
  execute format($f$
    create table if not exists public.pass_posters (
      id          uuid primary key default gen_random_uuid(),
      result_id   %s unique references public.admission_results(id) on delete cascade,
      result_kind text not null default 'grad',          -- grad = 大学院；以后做学部再用别的值
      student_id  text,
      masks       jsonb not null default '[]',           -- [{x,y,w,h,color}]，0–1 相对原图
      crop        jsonb,                                 -- {x,y,w,h} 相对原图；null = 整张
      fields      jsonb not null default '{}',           -- 海报上的文字
      univ text, dept text, spec text,                   -- 筛选用
      major text, domain text,                           -- 本校专业 key / 领域中文
      pass_year int, pass_month int,
      web_url     text,                                  -- 网络版 JPG（已遮盖）
      thumb_url   text,                                  -- 缩略图
      created_by  text,
      updated_at  timestamptz default now()
    )$f$, t);
end $$;

create table if not exists public.pass_poster_sources (
  poster_id uuid primary key references public.pass_posters(id) on delete cascade,
  src_url   text
);
create table if not exists public.univ_en_names (
  univ_ja text primary key,
  univ_en text not null
);

create index if not exists pass_posters_year_idx on public.pass_posters (pass_year);

alter table public.pass_posters        enable row level security;
alter table public.pass_poster_sources enable row level security;
alter table public.univ_en_names       enable row level security;

drop policy if exists "pass_posters read"  on public.pass_posters;
drop policy if exists "pass_posters write" on public.pass_posters;
create policy "pass_posters read"  on public.pass_posters for select
  using (public.is_admin() or (public.is_staff() and web_url is not null));
create policy "pass_posters write" on public.pass_posters for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "pass_poster_sources admin" on public.pass_poster_sources;
create policy "pass_poster_sources admin" on public.pass_poster_sources for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "univ_en_names read"  on public.univ_en_names;
drop policy if exists "univ_en_names write" on public.univ_en_names;
create policy "univ_en_names read"  on public.univ_en_names for select
  using (public.is_admin() or public.is_staff());
create policy "univ_en_names write" on public.univ_en_names for all
  using (public.is_admin()) with check (public.is_admin());

commit;

-- ── 回滚 ──
-- drop table if exists public.pass_poster_sources;
-- drop table if exists public.pass_posters;
-- drop table if exists public.univ_en_names;
