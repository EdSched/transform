-- ══════════════════════════════════════════════════════════════
-- 把「备注」里错放的毕业论文移到「毕业论文」列
-- 在 Supabase SQL Editor 里分段执行：先只跑【第一段】看清单，确认无误再跑【第二段】。
-- ══════════════════════════════════════════════════════════════

-- ───── 第一段：只查询（不改任何数据）─────
-- 列出 thesis 为空、notes 不为空的学生。请逐行看 notes 是不是毕业论文；
-- 如果有些 notes 其实是别的备注，把它们的 id 加到第二段的 excluded_ids 里排除。
select id, name, major, status, notes
from students
where coalesce(btrim(thesis), '') = ''
  and coalesce(btrim(notes), '') <> ''
order by major, name;


-- ───── 第二段：执行移动（确认第一段清单后再跑）─────
-- ① 先备份到 _students_notes_backup（同一学生重复执行不会覆盖第一次的备份）
create table if not exists _students_notes_backup (
  id text primary key,
  name text,
  notes text,
  thesis text,
  backed_up_at timestamptz default now()
);

-- 需要排除的学生 id（备注不是论文的）写在这里，例如 array['1730000000000-abcd']；没有就保持空数组
with excluded as (select array[]::text[] as ids)
insert into _students_notes_backup (id, name, notes, thesis)
select s.id, s.name, s.notes, s.thesis
from students s, excluded e
where coalesce(btrim(s.thesis), '') = ''
  and coalesce(btrim(s.notes), '') <> ''
  and not (s.id = any(e.ids))
on conflict (id) do nothing;

-- ② 把 notes 移到 thesis，notes 清空
with excluded as (select array[]::text[] as ids)
update students s
set thesis = s.notes,
    notes  = null
from excluded e
where coalesce(btrim(s.thesis), '') = ''
  and coalesce(btrim(s.notes), '') <> ''
  and not (s.id = any(e.ids))
  and s.id in (select id from _students_notes_backup);

-- 核对：应该看到刚才移动的学生 thesis 有内容、notes 为空
select s.id, s.name, s.thesis, s.notes
from students s join _students_notes_backup b on b.id = s.id
order by s.name;


-- ───── 回滚（从备份表恢复；只恢复备份里那些学生）─────
-- update students s
-- set notes = b.notes,
--     thesis = b.thesis
-- from _students_notes_backup b
-- where s.id = b.id;
-- 确认无误后可删除备份表：drop table _students_notes_backup;
