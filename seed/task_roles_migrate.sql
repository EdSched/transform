-- 任务跟角色走（PR ②）：把任务模板的角色换成新角色
-- 前提：已执行 seed/teacher_roles_prepare.sql 和 teacher_roles_assign.sql（老师有 position / roles）
-- 任务管理目前是关闭状态（模板全部停用），这里只换对应关系，不开启；可以重复执行
-- 回滚：先执行下面「回滚」前的备份检查——本文件会先建备份表 task_templates_role_backup

create table if not exists public.task_templates_role_backup as
  select id, role, role_tag, now() as backed_up_at from public.task_templates;

-- 角色为空的教务教研本部 7 条（B01–B07）→ lead（要放在前面，后面的 update 会让别的行也变成 lead）
update public.task_templates set role = 'lead' where (role is null or role = '') and id in ('B01','B02','B03','B04','B05','B06','B07');

update public.task_templates set role = 'lead'   where role in ('all_lead', 'subj_lead');
update public.task_templates set role = 'senmon' where role = 'lecturer';
update public.task_templates set role = 'ta'     where role in ('subj_ta', 'all_ta');

-- role_tag 同步成新角色的中文名
update public.task_templates set role_tag = case role
  when 'lead' then '负责人' when 'senmon' then '专业课老师' when 'ta' then 'TA' when 'homeroom' then '班主任'
  when 'sales' then '营业' when 'liaison' then '对接' when 'soumu' then '总务' else role_tag end
where role in ('lead','senmon','ta','homeroom','sales','liaison','soumu');

select role, role_tag, count(*) from public.task_templates group by 1, 2 order by 1;

-- ============================================================
-- 回滚（用备份表还原）
-- ============================================================
-- update public.task_templates t set role = b.role, role_tag = b.role_tag from public.task_templates_role_backup b where b.id = t.id;
-- drop table if exists public.task_templates_role_backup;   -- 确认没问题以后再删
