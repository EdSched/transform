-- ============================================================
-- 排课系统教室占用 · 按月归档（PR2）
-- 在 Supabase SQL Editor 手动执行；合并上线前先执行。前提：已执行 sched_booking_log.sql。可重复执行。
--
-- 做了什么：
--   1. 建私有 Storage 桶 sched-archive，只有管理员能读/写/覆盖
--   2. RPC sched_archive_purge(p_month)：只允许管理员；只能清已过完的月份；
--      必须先有 p_month||'.xlsx' 在桶里（即前端「生成并保存」已成功）才允许清空
--      清空范围 = 前端导出的范围：非课程；once 且 booking_date 在该月，或 weekly 且 end_date <= 该月最后一天
--      清空时不逐行写操作记录，只写一条 archive 记录；操作记录本身不删
-- ============================================================

insert into storage.buckets (id, name, public)
values ('sched-archive', 'sched-archive', false)
on conflict (id) do update set public = false;

drop policy if exists "sched_archive read"   on storage.objects;
drop policy if exists "sched_archive insert" on storage.objects;
drop policy if exists "sched_archive update" on storage.objects;
create policy "sched_archive read"   on storage.objects for select using (bucket_id = 'sched-archive' and public.is_admin());
create policy "sched_archive insert" on storage.objects for insert with check (bucket_id = 'sched-archive' and public.is_admin());
create policy "sched_archive update" on storage.objects for update using (bucket_id = 'sched-archive' and public.is_admin()) with check (bucket_id = 'sched-archive' and public.is_admin());

create or replace function public.sched_archive_purge(p_month text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first date; v_last date; v_path text; v_n int; v_actor text; v_kind text;
begin
  if not public.is_admin() then raise exception '只有管理员可以归档清空'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception '月份格式应为 YYYY-MM'; end if;
  v_first := (p_month || '-01')::date;
  v_last  := (v_first + interval '1 month' - interval '1 day')::date;
  if v_first >= date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date then
    raise exception '只能归档已经过完的月份（本月不行）';
  end if;
  v_path := p_month || '.xlsx';
  if not exists (select 1 from storage.objects where bucket_id = 'sched-archive' and name = v_path) then
    raise exception '还没有保存归档文件 %，请先点「生成并保存」', v_path;
  end if;

  perform set_config('sched.archiving', '1', true);
  delete from public.sched_bookings b
  where b.kind is distinct from 'course'
    and ( (b.recurrence = 'once'   and b.booking_date between v_first and v_last)
       or (b.recurrence = 'weekly' and b.end_date <= v_last) );
  get diagnostics v_n = row_count;
  perform set_config('sched.archiving', '', true);

  select a.actor, a.actor_kind into v_actor, v_kind from public.sched_actor(null, null, null) a;
  insert into public.sched_booking_log (action, actor, actor_kind, snapshot)
  values ('archive', v_actor, v_kind, jsonb_build_object('month', p_month, 'count', v_n, 'path', v_path));
  return jsonb_build_object('month', p_month, 'count', v_n, 'path', v_path);
end $$;
revoke all on function public.sched_archive_purge(text) from public;
grant execute on function public.sched_archive_purge(text) to authenticated;

-- ============================================================
-- 回滚：
--   drop function if exists public.sched_archive_purge(text);
--   drop policy if exists "sched_archive read"   on storage.objects;
--   drop policy if exists "sched_archive insert" on storage.objects;
--   drop policy if exists "sched_archive update" on storage.objects;
--   -- 桶里有文件时先在 Storage 页面清空再删：delete from storage.buckets where id = 'sched-archive';
-- ============================================================
