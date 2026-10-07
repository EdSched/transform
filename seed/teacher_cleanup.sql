-- 老师数据清洗（PR ①，可选，和角色统合互不依赖）：
--   数组去重 / 学生管理旧子项 records → records_view + records_entry / schedule:true → "full" / 作业分配旧字段 homework_courses → homework_course_ids
-- 先备份再改；可以重复执行（备份表只在第一次建，之后不覆盖）；回滚见文件末尾
-- 提示：teachers 表有防提权触发器，在 SQL Editor（postgres）里执行不受影响

-- ── 0. 备份（teachers 的 permissions / tags / managed_by / domains）──
create table if not exists public.teachers_cleanup_backup as
  select id, name, permissions, tags, managed_by, domains, now() as backed_up_at from public.teachers;

-- ── 1. 小工具函数（执行完会删掉）──
create or replace function public._tc_dedupe_text(a text[]) returns text[] language sql immutable as $$
  select coalesce(array_agg(x order by o), '{}') from (select x, min(o) o from unnest(a) with ordinality u(x, o) group by x) s;
$$;
create or replace function public._tc_dedupe_jsonb(j jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (select x, min(o) o from jsonb_array_elements(j) with ordinality u(x, o) group by x) s;
$$;

-- ── 2. 数组去重：managed_by / domains ──
-- managed_by / domains 可能是 text[] 也可能是 jsonb，按实际类型处理
do $$
declare c text; ty text;
begin
  foreach c in array array['managed_by','domains'] loop
    select data_type into ty from information_schema.columns where table_schema='public' and table_name='teachers' and column_name=c;
    if ty = 'ARRAY' then
      execute format('update public.teachers set %1$I = public._tc_dedupe_text(%1$I) where %1$I is distinct from public._tc_dedupe_text(%1$I)', c);
    elsif ty = 'jsonb' then
      execute format($f$update public.teachers set %1$I = public._tc_dedupe_jsonb(%1$I) where jsonb_typeof(%1$I) = 'array' and %1$I is distinct from public._tc_dedupe_jsonb(%1$I)$f$, c);
    end if;
  end loop;
end $$;

-- ── 3. permissions 里的数组去重 ──
do $$
declare k text;
begin
  foreach k in array array['slot_types','booking_types','student_mgmt_items','vip_content','admission_majors','student_majors'] loop
    execute format($f$
      update public.teachers
      set permissions = jsonb_set(permissions, array[%L], public._tc_dedupe_jsonb(permissions->%L))
      where jsonb_typeof(permissions->%L) = 'array'
        and permissions->%L is distinct from public._tc_dedupe_jsonb(permissions->%L)
    $f$, k, k, k, k, k);
  end loop;
end $$;

-- ── 4. 学生管理旧子项 records → records_view + records_entry ──
update public.teachers
set permissions = jsonb_set(permissions, '{student_mgmt_items}',
  public._tc_dedupe_jsonb(
    (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(permissions->'student_mgmt_items') x where x <> '"records"')
    || '["records_view","records_entry"]'::jsonb))
where jsonb_typeof(permissions->'student_mgmt_items') = 'array'
  and (permissions->'student_mgmt_items') @> '["records"]'::jsonb;

-- ── 5. 排班旧值 schedule:true → "full" ──
update public.teachers
set permissions = jsonb_set(permissions, '{schedule}', '"full"'::jsonb)
where permissions->'schedule' = 'true'::jsonb;

-- ── 6. 作业分配：homework_courses（课程名）→ homework_course_ids（课程 id）──
-- 只转「全库里这个名字正好对应一门课」的；同名多门（不同期）或找不到的保留在 homework_courses 里，下面第 7 步列出
update public.teachers t
set permissions = (
  with names as (select n from jsonb_array_elements_text(t.permissions->'homework_courses') n),
  hit as (select n, (array_agg(c.id::text))[1] cid from names left join public.courses c on trim(c.name) = trim(n) group by n having count(c.id) = 1),
  miss as (select n from names where n not in (select n from hit))
  select (t.permissions - 'homework_courses')
    || jsonb_build_object('homework_course_ids',
         public._tc_dedupe_jsonb(coalesce(t.permissions->'homework_course_ids', '[]'::jsonb) || coalesce((select jsonb_agg(cid) from hit), '[]'::jsonb)))
    || case when exists (select 1 from miss)
         then jsonb_build_object('homework_courses', (select jsonb_agg(n) from miss)) else '{}'::jsonb end
)
where jsonb_typeof(t.permissions->'homework_courses') = 'array'
  and jsonb_array_length(t.permissions->'homework_courses') > 0;

-- ── 7. 没转成的作业课程名（贴给 Sensis：在老师编辑页「作业批改分配」里手动选）──
select name as 老师, permissions->'homework_courses' as 没对上的课程名
from public.teachers
where jsonb_typeof(permissions->'homework_courses') = 'array' and jsonb_array_length(permissions->'homework_courses') > 0
order by name;

drop function if exists public._tc_dedupe_text(text[]);
drop function if exists public._tc_dedupe_jsonb(jsonb);

-- ============================================================
-- 回滚：用备份表还原（只还原这几列）
-- ============================================================
-- update public.teachers t set permissions = b.permissions, tags = b.tags, managed_by = b.managed_by, domains = b.domains
--   from public.teachers_cleanup_backup b where b.id = t.id;
-- drop table if exists public.teachers_cleanup_backup;   -- 确认没问题以后再删
