-- 课程属性「大课」统一改叫「班课」（可选，不执行也能用：页面已经把旧的「大课」当班课显示和筛选）
-- 由 Sensis 在 Supabase SQL Editor 手动执行。

-- 先看有多少门（只读）
select course_type, count(*) from public.courses where course_type in ('大课','班课') group by 1;

-- 执行
update public.courses set course_type = '班课' where course_type = '大课';

-- 回滚（只在执行前记下上面第一条查询里「大课」的数量；回滚会把所有班课都改回大课，包括之后新建的，慎用）
-- update public.courses set course_type = '大课' where course_type = '班课';
