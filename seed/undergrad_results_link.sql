-- ============================================================
-- 合格实绩⑤：学部补齐（本校在籍专业 / 反向记录 / 合格写真 / 制作海报）
-- 合并 PR 之前在 Supabase SQL Editor 一次性执行；可重复执行；不改任何读写规则。
-- 前提：已执行 seed/pass_posters.sql（pass_posters 表存在）。
-- ============================================================
begin;

alter table public.undergrad_results add column if not exists student_id text;   -- 对应 students.id
alter table public.undergrad_results add column if not exists our_major  text;   -- 本校在籍专业（majors.key）
alter table public.undergrad_results add column if not exists photo_url  text;   -- 合格截图

-- pass_posters：去掉指向 admission_results 的外键 和 result_id 单独唯一，
-- 改成 (result_kind, result_id) 唯一；result_id 统一成 text，大学院 / 学部的记录编号类型不同也能共用。
do $$
declare c record; att smallint;
begin
  if to_regclass('public.pass_posters') is null then
    raise exception '没有 pass_posters 表，请先执行 seed/pass_posters.sql';
  end if;
  -- 外键（约束名查出来再删，不写死）
  for c in select conname from pg_constraint
            where conrelid = 'public.pass_posters'::regclass and contype = 'f'
              and confrelid = 'public.admission_results'::regclass
  loop
    execute format('alter table public.pass_posters drop constraint %I', c.conname);
  end loop;
  -- result_id 单独唯一的约束
  select attnum into att from pg_attribute
   where attrelid = 'public.pass_posters'::regclass and attname = 'result_id' and not attisdropped;
  for c in select conname from pg_constraint
            where conrelid = 'public.pass_posters'::regclass and contype = 'u'
              and array_length(conkey, 1) = 1 and conkey[1] = att
  loop
    execute format('alter table public.pass_posters drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.pass_posters alter column result_id type text using result_id::text;
create unique index if not exists pass_posters_kind_result_uq on public.pass_posters (result_kind, result_id);

commit;

-- ── 回滚 ──
-- 先确认没有学部海报（有的话先删：delete from public.pass_posters where result_kind <> 'grad';）
-- drop index if exists public.pass_posters_kind_result_uq;
-- -- 下面两行只在 admission_results.id 原本是 uuid 时：
-- alter table public.pass_posters alter column result_id type uuid using result_id::uuid;
-- alter table public.pass_posters add constraint pass_posters_result_id_key unique (result_id);
-- alter table public.pass_posters add constraint pass_posters_result_id_fkey
--   foreign key (result_id) references public.admission_results(id) on delete cascade;
-- alter table public.undergrad_results drop column if exists photo_url;
-- alter table public.undergrad_results drop column if exists our_major;
-- alter table public.undergrad_results drop column if exists student_id;
