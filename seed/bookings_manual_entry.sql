-- ============================================================
-- 教务补录预约（面谈 / VIP）：bookings 加三列 + 防改触发器
-- 合并 PR 之前执行；可重复执行。
--   manual_entry  是否教务补录（永久标记）
--   manual_reason 补录原因（必填，前端校验）
--   manual_by     操作人（邮箱或负责人姓名）
-- 只有管理员或负责人（bookings_is_manager()）能设置 / 修改这三列；学生、普通老师不能。
-- 前提：已执行 vip_self_booking.sql（有 bookings_is_manager / bookings_guard_review_cols）。
-- ============================================================

alter table public.bookings add column if not exists manual_entry boolean not null default false;
alter table public.bookings add column if not exists manual_reason text;
alter table public.bookings add column if not exists manual_by text;

-- 在原触发器函数上加「补录三列」的限制（其余逻辑与 vip_self_booking.sql 完全一致）
create or replace function public.bookings_guard_review_cols()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_priv boolean := false;
  v_teacher boolean := false;
begin
  v_priv := coalesce(public.is_admin(), false) or coalesce(public.bookings_is_manager(), false);
  v_teacher := (public.current_teacher_id() is not null);
  if current_user in ('anon', 'authenticated') and not v_priv then
    if tg_op = 'INSERT' then
      if new.admin_review is distinct from (case when new.self_booked then 'pending' else null end)
         or new.admin_review_by is not null or new.admin_review_at is not null or new.admin_review_note is not null then
        raise exception '审核状态只能由教务设置';
      end if;
      if new.teacher_ok and not v_teacher then
        raise exception '只有老师能确认预约';
      end if;
      if new.manual_entry or new.manual_reason is not null or new.manual_by is not null then
        raise exception '只有教务能补录预约';
      end if;
    else
      if new.admin_review is distinct from old.admin_review
         or new.admin_review_by is distinct from old.admin_review_by
         or new.admin_review_at is distinct from old.admin_review_at
         or new.admin_review_note is distinct from old.admin_review_note
         or new.self_booked is distinct from old.self_booked then
        raise exception '只有教务能修改审核状态';
      end if;
      if new.teacher_ok is distinct from old.teacher_ok and not v_teacher then
        raise exception '只有老师能确认预约';
      end if;
      if new.manual_entry is distinct from old.manual_entry
         or new.manual_reason is distinct from old.manual_reason
         or new.manual_by is distinct from old.manual_by then
        raise exception '只有教务能修改补录标记';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_guard_review_cols on public.bookings;
create trigger bookings_guard_review_cols
  before insert or update on public.bookings
  for each row execute function public.bookings_guard_review_cols();

-- ── 验收（可选）──
-- 以学生身份在控制台执行应报错「只有教务能修改补录标记」：
--   await sb('/rest/v1/bookings?id=eq.<自己的预约id>','PATCH',{manual_entry:true})

-- ── 回滚 ──
-- 1) 把 bookings_guard_review_cols() 恢复成 vip_self_booking.sql 里的原版本（重新执行该文件第 3b 段即可）
-- 2) alter table public.bookings drop column if exists manual_entry;
--    alter table public.bookings drop column if exists manual_reason;
--    alter table public.bookings drop column if exists manual_by;
