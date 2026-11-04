-- 咨询台第 3 期：教授资料 + 教材・校区展示
-- 前提：已执行 seed/consult_phase2.sql（有 can_consult()）。可重复执行。
-- 图片 / PDF 文件传到已有的公开桶 admission-photos 的 consult/ 目录（管理员能写）；这两张表只存链接和文字。
begin;

create table if not exists public.consult_professors (   -- 教授资料
  id          uuid primary key default gen_random_uuid(),
  university  text not null,
  department  text,                 -- 研究科・専攻
  name        text not null,
  major       text,                 -- 对应的出愿专业代号（可空）
  research    text,                 -- 研究方向
  contact_req text,                 -- 联系要求（是否需要提前联系、怎么联系）
  source      text,                 -- 信息来源
  source_url  text,
  updated_on  date,                 -- 信息更新时间
  unconfirmed boolean not null default false,   -- 待确认
  notes       text,                 -- 内部备注（展示模式下隐藏）
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists consult_professors_univ_idx on public.consult_professors (university);
alter table public.consult_professors enable row level security;
drop policy if exists "consult_professors read" on public.consult_professors;
create policy "consult_professors read" on public.consult_professors for select to authenticated using (public.can_consult());
drop policy if exists "consult_professors admin write" on public.consult_professors;
create policy "consult_professors admin write" on public.consult_professors for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create table if not exists public.consult_media (        -- 教材・校区展示
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,        -- textbook 教材 / campus 校区
  title       text not null,
  caption     text,
  media_type  text not null default 'image',   -- image / video / pdf / link
  url         text not null,
  course_key  text,                 -- 教材：关联的课程名或专业关键词，方便筛选
  sort        int not null default 0,
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.consult_media enable row level security;
drop policy if exists "consult_media read" on public.consult_media;
create policy "consult_media read" on public.consult_media for select to authenticated using (public.can_consult());
drop policy if exists "consult_media admin write" on public.consult_media;
create policy "consult_media admin write" on public.consult_media for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

commit;

-- ── 回滚 ──
-- drop table if exists public.consult_media;
-- drop table if exists public.consult_professors;
