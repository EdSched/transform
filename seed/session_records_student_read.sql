-- 学生端「我的出席」要读自己的 session_records（PR ② 合并前执行）
-- 1) 先看这张表有没有开 RLS：
--    select relrowsecurity from pg_class where oid = 'public.session_records'::regclass;
--    结果是 false（没开）→ 学生本来就读得到，不需要做任何事，下面的 DO 块也不会改动任何东西。
-- 2) 已开 RLS 时，给学生加一条「只能读自己的出席记录」（保留管理员 is_admin()）；没开 RLS 则跳过。
do $$
begin
  if (select relrowsecurity from pg_class where oid = 'public.session_records'::regclass) then
    drop policy if exists "student read own records" on public.session_records;
    create policy "student read own records" on public.session_records for select to authenticated
      using (public.is_admin() or student_id = split_part(auth.jwt()->>'email', '@', 1));
  end if;
end $$;

-- 回滚：
-- drop policy if exists "student read own records" on public.session_records;
