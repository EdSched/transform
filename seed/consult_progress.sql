-- 咨询台：一项一页的进度（合并前执行）
alter table public.consult_leads add column if not exists progress jsonb;
-- 检查（应返回 1 行）：
-- select column_name from information_schema.columns where table_schema = 'public' and table_name = 'consult_leads' and column_name = 'progress';
-- 回滚：alter table public.consult_leads drop column if exists progress;
