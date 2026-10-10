-- 学生查询码 / 姓名 与 student_login 自动同步
-- 在 Supabase SQL Editor 执行（合并前）。无论从页面、SQL、批量导入改 student_code / name，登录表都会跟着变。
-- 前提：student_login 上 student_id 唯一（页面原本就用 on_conflict=student_id upsert）。
-- 登录账号（auth.users）仍由 student_login 上原有的触发器自动建立，这里不动。

create or replace function public.sync_student_login()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 更新时查询码和姓名都没变 → 不用动
  if tg_op = 'UPDATE'
     and new.student_code is not distinct from old.student_code
     and new.name is not distinct from old.name then
    return new;
  end if;

  if coalesce(new.student_code, '') = '' then
    delete from public.student_login where student_id = new.id;
  else
    insert into public.student_login (student_id, name, code)
    values (new.id, coalesce(new.name, ''), new.student_code)
    on conflict (student_id) do update
      set name = excluded.name, code = excluded.code;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_student_login on public.students;
create trigger trg_sync_student_login
  after insert or update of student_code, name on public.students
  for each row execute function public.sync_student_login();

-- 一次性补齐（幂等，重复执行无害）
insert into public.student_login (student_id, name, code)
select id, coalesce(name, ''), student_code from public.students
where coalesce(student_code, '') <> ''
on conflict (student_id) do update set name = excluded.name, code = excluded.code;

-- 检查：应为 0 行
-- select s.id, s.name as 档案姓名, s.student_code as 档案码, l.name as 登录表姓名, l.code as 登录表码
-- from public.students s
-- left join public.student_login l on l.student_id = s.id
-- where (coalesce(s.student_code, '') <> '' and l.student_id is null)
--    or (l.student_id is not null and (l.code is distinct from s.student_code or l.name is distinct from s.name));

-- ───── 回滚 ─────
-- drop trigger if exists trg_sync_student_login on public.students;
-- drop function if exists public.sync_student_login();
