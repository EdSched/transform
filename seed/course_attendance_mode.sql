-- 课程「出席属性」：required 必出席（默认，现有课程全部是这个）/ elective 选修（出席另算）/ none 不记出席（占教室、展示用）
-- PR ① 合并前在 Supabase SQL Editor 执行
alter table public.courses add column if not exists attendance_mode text not null default 'required';

-- 回滚：
-- alter table public.courses drop column if exists attendance_mode;
