-- 联系记录分类型：学习记录 / 联系未回复，并记录「算哪个月」（合并前执行）
alter table public.student_contact_logs add column if not exists kind text;       -- 'study' 学习记录 / 'no_reply' 联系未回复
alter table public.student_contact_logs add column if not exists for_month text;  -- 'YYYY-MM'：这条记录算哪个月
-- 旧的「已联系确认」记录一律当作「学习记录」，算它创建当月完成
update public.student_contact_logs
   set kind = coalesce(kind, 'study'),
       for_month = coalesce(for_month, to_char(created_at at time zone 'Asia/Tokyo', 'YYYY-MM'));

-- 回滚：
-- alter table public.student_contact_logs drop column if exists kind;
-- alter table public.student_contact_logs drop column if exists for_month;
