-- 面试资料（PR-2）：マナー / 临机应对 / 态度 等，独立于题库的分类资料 interview_resources
-- 执行：Supabase SQL Editor，按 ①→②→③→④ 顺序。可重复执行。

-- ① 建表
create table if not exists public.interview_resources (
  id         text primary key,
  major_key  text,                          -- null = 所有专业通用
  category   text not null,                 -- manner | impromptu | attitude | other
  title      text not null,
  body       text default '',               -- Markdown（**粗体**、- 列表）
  files      jsonb default '[]',            -- [{name,url}]
  sort_order int default 0,
  published  boolean not null default true,
  updated_at timestamptz default now()
);
create index if not exists interview_resources_cat on public.interview_resources(category, sort_order);

-- ② 权限（同 interview_banks）：已公开的可读，写入和读未公开的只给管理员
alter table public.interview_resources enable row level security;
drop policy if exists ivr_read on public.interview_resources;
drop policy if exists ivr_admin_all on public.interview_resources;
create policy ivr_read on public.interview_resources for select using (published = true or public.is_admin());
create policy ivr_admin_all on public.interview_resources for all using (public.is_admin()) with check (public.is_admin());

-- ③ 临机应对 / 整体态度 草稿（published=false，在管理端审过再公开；已存在则不动）
insert into public.interview_resources (id, major_key, category, title, body, sort_order, published) values
('ivr-seed-impromptu-1', null, 'impromptu', '听不懂教授的问题时怎么办',
$b$- 先不要沉默，也不要猜着答。可以直接说：
- 「恐れ入りますが、もう一度お願いできますでしょうか。」
- 「申し訳ございません、○○の部分がうまく聞き取れませんでした。もう一度ゆっくりお願いできますでしょうか。」
- 听懂了一半时，复述确认再答：「○○についてのご質問、という理解でよろしいでしょうか。」
- 专业词没听懂：「○○という言葉の意味を、もう少し詳しくご説明いただけますでしょうか。」
- 要点：重复一次可以，**连续三次以上**要换成复述确认；语速放慢，别因为紧张抢答。$b$, 1, false),
('ivr-seed-impromptu-2', null, 'impromptu', '被问到答不上来 / 没准备过的问题',
$b$- 先说「少し考えてもよろしいでしょうか。」，停 3~5 秒再答，比立刻乱答好。
- 完全不会：「勉強不足で申し訳ございません。ただ、関連して○○については学んでおります。」然后说出自己知道的相关内容，再补一句入学后打算怎么补（「入学後は○○を通じて理解を深めたいと考えております。」）。
- 不要硬编数据或文献；不确定就说「確かな数字は覚えておりませんが」。$b$, 2, false),
('ivr-seed-impromptu-3', null, 'impromptu', '被追问、被质疑研究计划时',
$b$- 先承认对方指出的点有道理（「ご指摘のとおり、○○の点は課題だと認識しております。」），再说明自己的考虑和打算怎么处理。
- 不要和教授争辩，也不要一句话认输；用「ご指摘を踏まえて、○○の方法も検討したいと思います」收尾。$b$, 3, false),
('ivr-seed-attitude-1', null, 'attitude', '整体态度',
$b$- 声音比平时稍大，语速放慢；每题先给结论再展开；控制在 1~2 分钟。
- 看着提问的教授，轮流看向其他教授；回答完不要追加「以上です」之外的多余道歉。
- 没听懂、没准备到的地方保持自信——让教授看到你努力准备过，只是这一点不太熟。$b$, 1, false)
on conflict (id) do nothing;

-- ④ 检查
select category, count(*) as n, bool_or(published) as any_published from public.interview_resources group by category;

-- ───────── 回滚 ─────────
-- drop table public.interview_resources;
