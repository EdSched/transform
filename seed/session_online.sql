-- 单回改成线上：course_sessions 加两列
-- 执行顺序：先「预览」，再「安装」，最后「验证」。出问题执行「回滚」。
--   delivery_set：这一回的上课方式是单独设过的（课程以后改上课方式时，这一回不会被改回去）
--   meeting_url ：这一回自备的腾讯会议链接（空 = 没有）

-- ① 预览（只读）：看看这两列现在有没有
select column_name from information_schema.columns
 where table_schema='public' and table_name='course_sessions' and column_name in ('delivery_set','meeting_url');

-- ② 安装
alter table public.course_sessions add column if not exists delivery_set boolean not null default false;
alter table public.course_sessions add column if not exists meeting_url  text;

-- ③ 验证：应返回 2 行；已有的回次 delivery_set 全是 false
select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='course_sessions' and column_name in ('delivery_set','meeting_url');
select count(*) filter (where delivery_set) as 已单独设过 from public.course_sessions;

-- ④ 回滚（会丢掉已经写进去的「线上」标记和链接，先确认没人用）
-- alter table public.course_sessions drop column if exists delivery_set;
-- alter table public.course_sessions drop column if exists meeting_url;
