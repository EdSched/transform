-- 排教室整理 PR1：不需要排的课「移出排课」（只打标记，不删课，不碰管理端课程）
-- 全部由 Sensis 在 Supabase SQL Editor 手动执行，按 ①→②→③ 的顺序。回滚在文件最后。

-- ============================================================
-- ① 只读：打出四个同步触发器函数的定义，把结果贴给 Claude
--    要确认两件事：
--      a. 删掉一条 sched_courses 会不会连带删 courses
--      b. 更新 sched_courses 的哪些列会同步回 courses（是列出的几列，还是整行）
-- ============================================================
select p.proname, pg_get_functiondef(p.oid) as def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('sync_courses_to_sched','sync_new_course_to_sched','sync_sched_to_courses','sync_new_sched_to_course')
order by p.proname;

-- 顺便看这四个函数挂在哪些触发器上（触发时机 / 是否限定列）
select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as def
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and c.relname in ('sched_courses','courses')
order by c.relname, t.tgname;

-- ============================================================
-- ② 加两列（只在 sched_courses 上；courses 表没有这两列，所以不会被同步回管理端）
-- ============================================================
alter table public.sched_courses add column if not exists sched_removed_reason text;   -- 不为空 = 已移出排课（理由）
alter table public.sched_courses add column if not exists sched_removed_at timestamptz;

-- ============================================================
-- ③ 实测（会自动回滚，不留任何改动）：
--    A. 给一门课打上移出标记后，管理端那边改一下这门课、排课这边也改一下，标记还在不在
--    （已看过四个同步函数：只复制写明的列，不含 sched_removed_*，预期「还在」）
--    B. 删掉这条 sched_courses 后，courses 里这门课还在不在
--    结果会以「报错信息」的形式显示（报错 = 整段已回滚，正常现象），把那句话贴给 Claude 即可
-- ============================================================
do $$
declare
  v_sched bigint; v_course text; v_keep boolean; v_left_courses int; v_left_sessions int; v_del text := '删除成功';
begin
  -- 两张表靠 sched_course_id_map 对应（sched_courses.id 是数字，courses.id 是文本）
  select m.sched_id, m.course_id into v_sched, v_course
  from public.sched_course_id_map m
  join public.sched_courses sc on sc.id = m.sched_id
  join public.courses c on c.id = m.course_id
  where sc.deleted_at is null
  limit 1;
  if v_sched is null then raise exception '没找到可测试的课程'; end if;

  update public.sched_courses set sched_removed_reason = '__test__', sched_removed_at = now() where id = v_sched;
  update public.courses       set name = name where id = v_course;   -- 触发 courses → sched 同步
  update public.sched_courses set name = name where id = v_sched;    -- 触发 sched → courses 同步
  select (sched_removed_reason = '__test__') into v_keep from public.sched_courses where id = v_sched;

  begin
    delete from public.sched_courses where id = v_sched;
  exception when others then
    v_del := '删除被拦：' || sqlerrm;
  end;
  select count(*) into v_left_courses  from public.courses         where id = v_course;
  select count(*) into v_left_sessions from public.course_sessions where course_id = v_course;

  raise exception '实测结果（已回滚）：A 同步后移出标记%；B 删除 sched_courses：%，courses 剩 % 行、course_sessions 剩 % 行',
    case when v_keep then '还在（正常）' else '被清掉了（需要改触发器）' end, v_del, v_left_courses, v_left_sessions;
end $$;

-- ============================================================
-- 回滚（只在需要撤销时执行；已有「已移出」的课会恢复成普通课，因为标记列被删除）
-- ============================================================
-- alter table public.sched_courses drop column if exists sched_removed_reason;
-- alter table public.sched_courses drop column if exists sched_removed_at;
