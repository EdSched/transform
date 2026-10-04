-- ============================================================
-- 数据库上锁 第 3 批 · PR ① · 上锁 SQL（合并 PR 并测试新代码之后执行）
-- 只锁 sched_access_codes：只有管理员（is_admin()）能读写；排课系统用口令登录走 rpc/resolve_sched_code（security definer，不受影响）。
-- 前提：已执行 lock_batch3_1_prepare.sql；第 1 批的 is_admin() 存在。整个文件一次性执行，出错整体回滚。
-- ============================================================

begin;

-- 前置检查：读 sched_access_codes 的函数必须是 security definer，否则锁表后会读空
do $$
declare r record; bad text := '';
begin
  for r in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and not p.prosecdef and p.prokind = 'f'
      and p.prosrc ~* 'sched_access_codes'
  loop
    bad := bad || format(E'\n  函数 %s()', r.proname);
  end loop;
  if bad <> '' then
    raise exception E'这些函数读取 sched_access_codes 但不是 security definer，请先处理：%', bad;
  end if;
end $$;

-- 清掉旧规则（含公开的 all 规则）
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'sched_access_codes'
  loop
    execute format('drop policy %I on public.sched_access_codes', r.policyname);
  end loop;
end $$;

alter table public.sched_access_codes enable row level security;
create policy "admin all" on public.sched_access_codes for all to anon, authenticated
  using (public.is_admin()) with check (public.is_admin());

commit;

-- ── 验证（不登录 / 匿名公钥）：应返回 []，而不是口令列表
--   curl 'https://vwntezfvqbrkeovnseku.supabase.co/rest/v1/sched_access_codes?select=*' -H 'apikey: <publishable key>'
-- ── 验证（RPC 仍可用）：用一个真实口令，应返回 1 行
--   curl -X POST 'https://vwntezfvqbrkeovnseku.supabase.co/rest/v1/rpc/resolve_sched_code' -H 'apikey: <key>' -H 'Content-Type: application/json' -d '{"p_code":"<口令>"}'

-- ── 回滚 ──
-- drop policy if exists "admin all" on public.sched_access_codes;
-- alter table public.sched_access_codes disable row level security;
