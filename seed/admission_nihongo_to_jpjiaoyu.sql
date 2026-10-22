-- 出愿数据里的「日本语教育」代号 nihongo → jpjiaoyu（nihongo 在正式专业表里是「日语」）
-- 只动出愿三张表：admission_majors / admission_schools / teacher_school_shares。
-- 学生、课程、老师、预约里的 nihongo 都是「日语」，不动。合格实绩 admission_results.subject 是另一套学科代号，不动。
-- 执行顺序：先跑「0. 先看」→ 跑「1. 备份」→ 跑「2. 修改」→ 对照「3. 检查」。合并 PR 前执行。

-- ── 0. 先看（只读）──
select 'admission_majors' t, key, label, domain from admission_majors where key in ('nihongo','jpjiaoyu');
select 'admission_schools' t, major, count(*) from admission_schools where major in ('nihongo','jpjiaoyu') group by major;
select 'teacher_school_shares' t, major, count(*) from teacher_school_shares where major in ('nihongo','jpjiaoyu') group by major;
-- 老师权限里出愿相关的 nihongo：这里分不清指「日语」还是「日本语教育」，不自动改，列出来人工看
select id, name, majors, permissions->'exclude_majors' as exclude_majors, permissions->'profile_skip_majors' as profile_skip_majors
from teachers
where majors @> array['nihongo']
   or permissions->'exclude_majors' ? 'nihongo'
   or permissions->'profile_skip_majors' ? 'nihongo';

-- ── 1. 备份（先把要改的行存起来，回滚按它来）──
create table if not exists backup_adm_nihongo_majors  as select * from admission_majors        where key   = 'nihongo';
create table if not exists backup_adm_nihongo_schools as select id  from admission_schools     where major = 'nihongo';
create table if not exists backup_adm_nihongo_shares  as select id  from teacher_school_shares where major = 'nihongo';
-- 若 jpjiaoyu 已有一行，合并时会删 nihongo 行；上面的 backup_adm_nihongo_majors 就是它的完整备份

-- ── 2. 修改 ──
begin;
  -- 专业表：jpjiaoyu 已有 → 保留 jpjiaoyu、删 nihongo；没有 → 把 nihongo 改名
  delete from admission_majors where key = 'nihongo' and exists (select 1 from admission_majors where key = 'jpjiaoyu');
  update admission_majors set key = 'jpjiaoyu' where key = 'nihongo';
  update admission_schools      set major = 'jpjiaoyu' where id in (select id from backup_adm_nihongo_schools);
  update teacher_school_shares  set major = 'jpjiaoyu' where id in (select id from backup_adm_nihongo_shares);
commit;

-- ── 3. 检查 ──
select key, label, domain from admission_majors where key in ('nihongo','jpjiaoyu');                 -- 应只剩 jpjiaoyu
select major, count(*) from admission_schools where major in ('nihongo','jpjiaoyu') group by major;    -- 应只有 jpjiaoyu，数量=改前 nihongo 数量(+原 jpjiaoyu 数量)
select major, count(*) from teacher_school_shares where major in ('nihongo','jpjiaoyu') group by major;

-- ══ 回滚 ══
-- begin;
--   -- 专业表：把 jpjiaoyu 改回 nihongo（若合并时删过 nihongo 行，则按备份补回）
--   update admission_majors set key = 'nihongo' where key = 'jpjiaoyu' and exists (select 1 from backup_adm_nihongo_majors) and not exists (select 1 from backup_adm_nihongo_majors b where b.key = 'jpjiaoyu');
--   insert into admission_majors select * from backup_adm_nihongo_majors b where not exists (select 1 from admission_majors m where m.key = 'nihongo');
--   update admission_schools     set major = 'nihongo' where id in (select id from backup_adm_nihongo_schools);
--   update teacher_school_shares set major = 'nihongo' where id in (select id from backup_adm_nihongo_shares);
-- commit;
-- 确认无误后可删备份表：drop table backup_adm_nihongo_majors, backup_adm_nihongo_schools, backup_adm_nihongo_shares;
