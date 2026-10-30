-- 面谈要完成并填好面谈记录才算工资：bookings 加「填写记录的日期」
-- 1) 加列
alter table public.bookings add column if not exists record_done_at timestamptz;

-- 2) 把以前已经填好记录的面谈补上日期（补成面谈当天），以前的月份不受影响
update public.bookings set record_done_at = (substr(coalesce(nullif(actual_time::text,''), slot_date::text),1,10) || ' 12:00:00+09')::timestamptz
where coalesce(type,'') <> 'vip' and status = 'completed' and daily_record is not null and record_done_at is null
  and substr(coalesce(nullif(actual_time::text,''), slot_date::text),1,10) ~ '^\d{4}-\d{2}-\d{2}$';

-- 3) 检查（应返回 0）
select count(*) from public.bookings where coalesce(type,'') <> 'vip' and status = 'completed' and daily_record is not null and record_done_at is null;

-- 回滚
-- alter table public.bookings drop column if exists record_done_at;
