-- 学生管理 / 出願数据可见范围改规则（合并前执行）：
--   新规则（见 shared/constants.js 的 teacherScope）：营业/对接看全部；其他人 = 负责专业 ∪（没设负责专业时的负责领域）∪ 负责人管理范围 ∪ 班主任范围，再减去 permissions.exclude_majors。
--   旧的 permissions.student_majors / admission_majors 不再使用。
--   本文件：对「按新规则范围变大」的老师，把多出来的专业写进 permissions.exclude_majors，保证上线后谁的可见范围都不会突然变大。
--   「变小」的老师不改（通常是负责专业没设全，去老师管理里补），列在预览结果里让 Sensis 决定。
-- 班主任负责的班级（role_scope.homeroom.class_ids）按学生判断，无法用专业排除；这些学生是新规则下新增可见的，预览里单独标出。
--
-- 用法：
--   1. 先整段执行「第 0～2 步」（备份 + 建临时计算函数）。
--   2. 执行第 3 步的预览查询（只读），把结果贴给 Sensis 看。
--   3. 确认后执行第 4 步（写入 exclude_majors）。
--   4. 第 5 步清理函数。
-- 可以重复执行（备份表只在第一次建；exclude_majors 只会增加、不会覆盖手填的值）。

-- ── 0. 备份 ──
create table if not exists public.teachers_scope_backup as
  select id, name, permissions, now() as backed_up_at from public.teachers;

-- ── 1. 小工具 ──
-- jsonb / text[] / 单个字符串 → text[]
create or replace function public._sc_arr(j jsonb) returns text[] language sql immutable as $$
  select case
    when j is null then '{}'::text[]
    when jsonb_typeof(j) = 'array' then coalesce((select array_agg(x) from jsonb_array_elements_text(j) x), '{}'::text[])
    when jsonb_typeof(j) = 'string' then array[j #>> '{}']
    else '{}'::text[] end;
$$;
-- 分组（major_groups，如 shakai_group）展开成组内专业（需先执行 seed/major_groups.sql）
create or replace function public._sc_expand(a text[]) returns text[] language sql stable as $$
  select coalesce(array_agg(distinct k), '{}'::text[]) from (
    select unnest(case when exists (select 1 from public.major_groups g where g.key = x)
                       then coalesce((select array_agg(m.key) from public.majors m where m.group_key = x), '{}'::text[])
                       else array[x] end) k
    from unnest(a) x
  ) s where k is not null and k <> '';
$$;
-- 领域 → 专业（专业表 + 出愿专业表）
create or replace function public._sc_dom_majors(doms text[]) returns text[] language sql stable as $$
  select coalesce(array_agg(distinct k), '{}'::text[]) from (
    select key k from public.majors where domain = any(doms)
    union select key from public.admission_majors where domain = any(doms)
  ) s;
$$;

-- ── 2. 计算函数：每位老师「现在能看」vs「新规则能看」 ──
drop function if exists public._scope_calc();
create function public._scope_calc()
returns table (
  tid text, tname text, pos text, roles text,
  stu_all_old boolean, stu_all_new boolean, adm_all_old boolean, adm_all_new boolean,
  stu_old text[], stu_new text[], adm_old text[], adm_new text[],
  grow text[], stu_shrink text[], adm_shrink text[], hr_classes int, conflict text[]
) language plpgsql stable as $$
declare
  r record;
  tags text[]; own text[]; mb text[]; dm text[]; ms jsonb; hr jsonb; perm jsonb;
  adm_keys text[]; adm_doms text[]; base text[];
  rng text[]; g_stu text[]; g_adm text[]; stu_on boolean; adm_on boolean;
begin
  select coalesce(array_agg(key), '{}') into adm_keys from public.admission_majors;
  for r in select * from public.teachers order by name loop
    tid := r.id::text; tname := r.name; pos := r.position; roles := array_to_string(coalesce(r.roles, '{}'), ',');
    perm := coalesce(r.permissions, '{}'::jsonb);
    tags := public._sc_arr(to_jsonb(r.tags));
    own := public._sc_expand(public._sc_arr(to_jsonb(r.majors)));
    mb := public._sc_arr(to_jsonb(r.managed_by));
    dm := public._sc_arr(to_jsonb(r.domains));
    ms := to_jsonb(r.manage_scope); hr := r.role_scope -> 'homeroom';
    hr_classes := coalesce(jsonb_array_length(case when jsonb_typeof(hr -> 'class_ids') = 'array' then hr -> 'class_ids' end), 0);
    stu_all_new := (coalesce(r.position, '') in ('sales', 'liaison')) or ('营业老师' = any(tags));
    adm_all_new := (coalesce(r.position, '') = 'sales') or ('营业老师' = any(tags));
    stu_all_old := stu_all_new;
    adm_all_old := adm_all_new;

    -- 旧：学生管理 = student_majors，没设用 majors；都空 = 全部
    base := public._sc_expand(public._sc_arr(perm -> 'student_majors'));
    if coalesce(array_length(base, 1), 0) = 0 then base := own; end if;
    if not stu_all_old and coalesce(array_length(base, 1), 0) = 0 then stu_all_old := true; end if;
    stu_old := case when stu_all_old then '{}' else base end;

    -- 旧：出願数据 = admission_majors，没设用 majors；只保留出愿专业且属于老师所在领域（managed_by，没设则取 majors 的领域）
    base := public._sc_arr(perm -> 'admission_majors');
    if coalesce(array_length(base, 1), 0) = 0 then base := own; end if;
    if coalesce(array_length(mb, 1), 0) > 0 then adm_doms := mb;
    else select coalesce(array_agg(distinct domain), '{}') into adm_doms from public.majors where key = any(own) and domain is not null; end if;
    adm_old := case when adm_all_old then '{}' else
      coalesce((select array_agg(k) from unnest(base) k where k = any(adm_keys) and k = any(public._sc_dom_majors(adm_doms))), '{}') end;

    -- 新：负责专业 ∪（没设负责专业时：负责领域）∪ 负责人管理范围 ∪ 班主任范围
    rng := own;
    if coalesce(array_length(own, 1), 0) = 0 then rng := rng || public._sc_dom_majors(case when coalesce(array_length(dm, 1), 0) > 0 then dm else mb end); end if;   -- 负责领域(domains)，空则退回隶属领域(managed_by)
    if coalesce(r.position, '') = 'lead' and ms is not null and jsonb_typeof(ms) = 'object' then
      rng := rng || public._sc_dom_majors(public._sc_arr(ms -> 'domains')) || public._sc_expand(public._sc_arr(ms -> 'majors'));
    end if;
    if 'homeroom' = any(coalesce(r.roles, '{}')) and hr is not null then
      rng := rng || public._sc_dom_majors(public._sc_arr(hr -> 'domains')) || public._sc_expand(public._sc_arr(hr -> 'majors'));
    end if;
    rng := public._sc_expand(rng);
    stu_new := case when stu_all_new then '{}' else rng end;
    adm_new := case when adm_all_new then '{}' else coalesce((select array_agg(k) from unnest(rng) k where k = any(adm_keys)), '{}') end;

    -- 功能没开的一侧不用管（没开学生管理就不看学生范围，没开出愿查询就不看出愿范围）
    stu_on := coalesce(perm ->> 'student_mgmt', 'false') = 'true';
    adm_on := coalesce(perm ->> 'admission_query', 'false') = 'true';
    -- 变多：新范围里有、旧范围里没有的专业（旧的是「全部」时只可能变少）
    g_stu := '{}'; g_adm := '{}';
    if stu_on and not stu_all_new and not stu_all_old then g_stu := coalesce((select array_agg(k) from unnest(stu_new) k where not k = any(stu_old)), '{}'); end if;
    if adm_on and not adm_all_new and not adm_all_old then g_adm := coalesce((select array_agg(k) from unnest(adm_new) k where not k = any(adm_old)), '{}'); end if;
    grow := coalesce((select array_agg(distinct k) from unnest(g_stu || g_adm) k), '{}');
    -- 变少
    stu_shrink := case when not stu_on or stu_all_new then '{}' when stu_all_old then array['(原来是全部)'] else coalesce((select array_agg(k) from unnest(stu_old) k where not k = any(stu_new)), '{}') end;
    adm_shrink := case when not adm_on or adm_all_new then '{}' when adm_all_old then array['(原来是全部)'] else coalesce((select array_agg(k) from unnest(adm_old) k where not k = any(adm_new)), '{}') end;
    -- 冲突：排除是两边共用的；某专业只在一侧变多，排除它会让另一侧原本能看的变少
    conflict := coalesce((select array_agg(distinct k) from unnest(grow) k where
      (k = any(g_adm) and not k = any(g_stu) and stu_on and (stu_all_old or k = any(stu_old)))
      or (k = any(g_stu) and not k = any(g_adm) and adm_on and k = any(adm_old))), '{}');
    return next;
  end loop;
end $$;

-- ── 3. 预览（只读）：每位老师 现在能看 vs 新规则能看 ──
-- 状态：变多（会被写进 exclude_majors）/ 变少（不改，Sensis 决定）/ 变多+变少 / 不变
select tname as 老师, pos as 职位, roles as 角色,
  case when stu_all_old then '全部' else array_to_string(stu_old, '、') end as 学生_现在,
  case when stu_all_new then '全部' else array_to_string(stu_new, '、') end as 学生_新规则,
  case when adm_all_old then '全部' else array_to_string(adm_old, '、') end as 出愿_现在,
  case when adm_all_new then '全部' else array_to_string(adm_new, '、') end as 出愿_新规则,
  array_to_string(grow, '、') as 多出来的_将写入排除,
  array_to_string(stu_shrink || adm_shrink, '、') as 变少的_不处理,
  array_to_string(conflict, '、') as 冲突_排除后另一侧会变少,
  hr_classes as 班主任班级数_新增可见学生,
  case when coalesce(array_length(grow, 1), 0) > 0 and coalesce(array_length(stu_shrink || adm_shrink, 1), 0) > 0 then '变多+变少'
       when coalesce(array_length(grow, 1), 0) > 0 then '变多'
       when coalesce(array_length(stu_shrink || adm_shrink, 1), 0) > 0 then '变少'
       else '不变' end as 状态
from public._scope_calc()
order by 状态 desc, 老师;

-- ── 4. 写入：把变多的专业写进 permissions.exclude_majors（只增不减，不覆盖手填） ──
update public.teachers t
set permissions = jsonb_set(coalesce(t.permissions, '{}'::jsonb), '{exclude_majors}',
  (select coalesce(jsonb_agg(distinct k), '[]'::jsonb)
   from unnest(public._sc_arr(coalesce(t.permissions, '{}'::jsonb) -> 'exclude_majors') || c.grow) k))
from public._scope_calc() c
where c.tid = t.id::text and coalesce(array_length(c.grow, 1), 0) > 0;

-- 执行后可再跑一次第 3 步的预览核对（「多出来的」应该仍列出，因为它只比较旧字段；真正生效范围 = 新范围 − exclude_majors）。

-- ── 5. 清理计算函数 ──
-- drop function if exists public._scope_calc();
-- drop function if exists public._sc_dom_majors(text[]);
-- drop function if exists public._sc_expand(text[]);
-- drop function if exists public._sc_arr(jsonb);

-- ══ 回滚 ══
-- 只撤销本文件写入的 exclude_majors（其它字段不动）：
-- update public.teachers t set permissions = case
--     when b.permissions ? 'exclude_majors' then jsonb_set(t.permissions, '{exclude_majors}', b.permissions -> 'exclude_majors')
--     else t.permissions - 'exclude_majors' end
--   from public.teachers_scope_backup b where b.id = t.id;
-- drop table if exists public.teachers_scope_backup;
