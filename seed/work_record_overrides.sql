-- 工资页「手动修改」：新表 work_record_overrides（只存覆盖的字段，不动单回 / 课程 / 预约）
-- 执行：Supabase SQL Editor，合并前整份执行；可重复执行。前提：已执行过 work_records_approve.sql（需要里面的 can_read_work_record / can_approve_work_record）。

-- ① 建表（比最初方案多 teacher_name、domain 两列：访问规则要按老师和领域判断，和 work_records 一致）
create table if not exists public.work_record_overrides (
  source text not null,
  source_id text not null,
  fields jsonb not null,
  edited_by text,
  edited_at timestamptz not null default now(),
  teacher_name text,
  domain text,
  primary key (source, source_id)
);
alter table public.work_record_overrides add column if not exists teacher_name text;
alter table public.work_record_overrides add column if not exists domain text;

-- ② 访问规则：照 work_records 现有的复制一份
--    work_records 开了 RLS 才开；规则里只有 teacher_name / domain / status / source 这几个列名，新表有前三个，
--    规则里引用了新表没有的列（status、source='declare' 的老师自己申告那几条）就跳过——老师本人不需要读写这张表
do $$
declare r record; v_rls boolean; v_sql text; n int := 0;
begin
  if to_regprocedure('public.can_approve_work_record(text,text)') is null then
    raise exception '缺少 can_approve_work_record()，请先执行 work_records_approve.sql';
  end if;
  select relrowsecurity into v_rls from pg_class where oid = 'public.work_records'::regclass;
  if coalesce(v_rls, false) then
    execute 'alter table public.work_record_overrides enable row level security';
    for r in select * from pg_policies where schemaname = 'public' and tablename = 'work_records' loop
      if coalesce(r.qual, '') ~ '\mstatus\M' or coalesce(r.with_check, '') ~ '\mstatus\M' then continue; end if;   -- 老师本人的申告规则（含 status）不复制
      execute format('drop policy if exists %I on public.work_record_overrides', 'wro_' || r.policyname);
      v_sql := format('create policy %I on public.work_record_overrides as %s for %s to %s',
                      'wro_' || r.policyname, r.permissive, r.cmd, array_to_string(r.roles, ','));
      if r.qual is not null then v_sql := v_sql || ' using (' || replace(r.qual, 'work_records', 'work_record_overrides') || ')'; end if;
      if r.with_check is not null then v_sql := v_sql || ' with check (' || replace(r.with_check, 'work_records', 'work_record_overrides') || ')'; end if;
      execute v_sql; n := n + 1;
    end loop;
  end if;
  raise notice 'work_records RLS = %，复制了 % 条规则', coalesce(v_rls, false), n;
end $$;

-- 检查：应看到 wro_wr_select / wro_wr_approve_ins / wro_wr_approve_upd / wro_wr_approve_del 四条
select tablename, policyname, cmd from pg_policies where tablename in ('work_records', 'work_record_overrides') order by tablename, policyname;

-- ───────── 回滚 ─────────
-- drop table if exists public.work_record_overrides;
