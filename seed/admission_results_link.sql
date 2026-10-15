-- ============================================================
-- 合格实绩①：合格实绩管理端填写的合格数据 → 反向记录到学生档案
-- 合并 PR 之前在 Supabase SQL Editor 执行；可重复执行；不改任何读写规则。
-- ============================================================
alter table public.admission_results add column if not exists student_id text;   -- 对应 students.id
alter table public.admission_results add column if not exists our_major  text;   -- 本校在籍专业（majors.key）

-- ── 回滚 ──
-- alter table public.admission_results drop column if exists our_major;
-- alter table public.admission_results drop column if exists student_id;
