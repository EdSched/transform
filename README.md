# Transform Education 管理系统

唯新教育（Transform Education）内部管理平台。

## 文件结构

```
admin/
  index.html      管理端主界面（需密码登录）
  admin.css       管理端样式
  admin.js        管理端逻辑

teacher/
  index.html      老师端（课程排班 + 我的课表）
  teacher.css     老师端样式
  teacher.js      老师端逻辑

student/
  index.html      学生端（面谈预约）
  student.css     学生端样式
  student.js      学生端逻辑

shared/
  supabase.js     Supabase 客户端（sb() 函数）
  constants.js    公共常量和工具函数（MAJORS、期数、颜色等）
```

## 访问方式

| 页面 | URL | 说明 |
|------|-----|------|
| 管理端 | `/admin/` | 密码：`weixin$2026`，课程管理密码：`miyako!!` |
| 老师端 | `/teacher/?teacher=姓名` | 无需密码，链接即身份 |
| 学生端 | `/student/?major=keiei` | 按专业区分 |

## 专业代码

| 代码 | 专业 |
|------|------|
| keiei | 経営学 |
| keizai | 経済学 |
| shakai | 社会学 |
| shinpan | 新闻传播学 |
| fukushi | 社会福祉学 |

## 数据库

Supabase（东京节点）

主要数据表：`students` `bookings` `slots` `courses` `course_sessions` `session_records` `schedule_slots` `teacher_availability` `teachers` `attendance` `interview_records`
