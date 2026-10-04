-- ============================================================
-- 数据库上锁 第 3 批 · PR ② · 上锁 SQL（合并 PR 并测试新代码之后执行）
-- 锁 courses 和 slots 的「写」。整个文件一次性执行；任何前置检查不通过会整体回滚、什么都不改。
-- 前提：已执行 lock_batch3_2_prepare.sql（is_sched_user() 存在、同步触发器已是 security definer）。
--
-- courses：读 = 所有人（学生端 / 宣传页等匿名读取保持不变）
--          新增 / 删除 = is_staff()（管理员、领域访问链接、老师）
--          修改 = is_staff() 或 is_sched_user()（sched/meeting.html 改会议链接用口令身份）
-- slots：  读 = 所有人（新学生预约页登录前要看时间槽）
--          写 = is_staff()，不给匿名、不给口令用户
-- ============================================================

begin;

-- ── 前置检查 1：非 security definer 的函数里有写 courses / slots 的，匿名身份触发时会被拦住 ──
do $$
declare r record; bad text := '';
begin
  for r in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and not p.prosecdef
      and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(courses|slots)\y'
  loop
    bad := bad || format(E'\n  函数 %s()', r.proname);
  end loop;
  if bad <> '' then
    raise exception E'这些函数会写 courses / slots 但不是 security definer，请把这段发给 Claude 评估：%', bad;
  end if;
end $$;

-- ── 前置检查 2：辅助函数必须已存在 ──
do $$
begin
  if to_regprocedure('public.is_sched_user()') is null then
    raise exception '没有 is_sched_user()，请先执行 lock_batch3_2_prepare.sql';
  end if;
end $$;

-- ── 清掉 courses / slots 上所有旧规则（含 public insert/update/delete），再重建 ──
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('courses', 'slots')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ── courses ──
alter table public.courses enable row level security;
create policy "courses read"   on public.courses for select using (true);
create policy "courses insert" on public.courses for insert with check (public.is_staff());
create policy "courses update" on public.courses for update
  using (public.is_staff() or public.is_sched_user())
  with check (public.is_staff() or public.is_sched_user());
create policy "courses delete" on public.courses for delete using (public.is_staff());

-- ── slots ──
alter table public.slots enable row level security;
create policy "slots read"   on public.slots for select using (true);
create policy "slots insert" on public.slots for insert with check (public.is_staff());
create policy "slots update" on public.slots for update using (public.is_staff()) with check (public.is_staff());
create policy "slots delete" on public.slots for delete using (public.is_staff());

commit;

-- ── 验证（不登录 / 匿名公钥，浏览器地址栏或 curl）──
--  读：…/rest/v1/slots?select=id&limit=1        应返回数据
--  写：curl -X DELETE '…/rest/v1/slots?id=eq.0' -H 'apikey: <公钥>'   应报 401/403（或空结果），不会删任何东西
--  写：curl -X PATCH '…/rest/v1/courses?id=eq.0' -H 'apikey: <公钥>' -H 'Content-Type: application/json' -d '{"name":"x"}'
--      匿名应被拒绝（RLS 报错或影响 0 行）

-- ── 回滚（courses、slots 恢复成原来「RLS 关闭」的状态；slots 的公开规则一并恢复）──
-- drop policy if exists "courses read"   on public.courses;
-- drop policy if exists "courses insert" on public.courses;
-- drop policy if exists "courses update" on public.courses;
-- drop policy if exists "courses delete" on public.courses;
-- alter table public.courses disable row level security;
-- drop policy if exists "slots read"   on public.slots;
-- drop policy if exists "slots insert" on public.slots;
-- drop policy if exists "slots update" on public.slots;
-- drop policy if exists "slots delete" on public.slots;
-- create policy "public read slots"   on public.slots for select using (true);
-- create policy "public insert slots" on public.slots for insert with check (true);
-- create policy "public update slots" on public.slots for update using (true);
-- create policy "public delete slots" on public.slots for delete using (true);
-- alter table public.slots disable row level security;
