-- 课程出席属性改版：elective（选修）→ open（组内开放）
-- 选修不再是整门课的属性，而是按学生判断：本专业 = 必修，同专业组其他专业 = 选修（课程设为「组内开放」时）
-- 合并前在 Supabase SQL Editor 执行
update public.courses set attendance_mode = 'open' where attendance_mode = 'elective';

-- 回滚（会把所有「组内开放」的课都改回 elective，原来就是 open 的也会被改）：
-- update public.courses set attendance_mode = 'elective' where attendance_mode = 'open';
