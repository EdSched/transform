-- 讲师介绍新增「特色亮点」（选填）
alter table public.teacher_profiles add column if not exists highlights text;

-- 回滚：
-- alter table public.teacher_profiles drop column if exists highlights;

-- 旧数据检查（只查询，不改数据）：专业名对不上任何专业的介绍行，请在管理端「讲师档案」里手动改
-- select p.id, p.name, p.subject, p.domain
-- from public.teacher_profiles p
-- where not exists (select 1 from public.majors m where m.label = trim(p.subject))
-- order by p.name;
