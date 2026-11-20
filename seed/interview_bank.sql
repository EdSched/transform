-- 面试题库（PR-1）：按专业一套题库 interview_banks
-- 执行：Supabase SQL Editor，按 ①→②→③→④ 顺序分段执行。可重复执行，只新增，不改不删旧数据（writing_guides 里旧的 grad_interview 行原样保留）。

-- ① 先看 writing_guides 现有权限思路（只读，结果发我核对；新表照它的思路：已公开内容可读，写入只给管理员）
select policyname, cmd, roles, qual, with_check from pg_policies where tablename in ('writing_guides', 'riyu_submissions');
-- 同时确认 riyu_submissions 有没有 check / 唯一约束（学生的共用答案行 school_key='_common' 要能写进去）
select conrelid::regclass as tbl, conname, contype, pg_get_constraintdef(oid) as def
  from pg_constraint where conrelid = 'public.riyu_submissions'::regclass and contype in ('c', 'u');
-- 如果上面第二个查询有 school_key / kind 相关的 check 约束，把结果发我，我给放行语句；没有就不用管。

-- ② 建表（一个专业一行；整库的章节题目存在 chapters 这一个 jsonb 里）
create table if not exists public.interview_banks (
  major_key    text primary key,            -- 专业代码（经济学是 keizai；学部专业带 gakubu_ 前缀；也可以是专业组 key，如 shakai_group）
  title        text not null default '面试稿',
  intro        text default '',             -- 顶部说明（支持 **粗体**、- 列表）
  standard     text default '',             -- 本专业「面试稿标准」：长度、语言、必答范围，学生页顶部显示
  chapters     jsonb not null default '[]', -- [{key,title,intro,scope:'school|common',type:'qa|keywords|ask',items:[{key,q,tips,example,required,tags,keywords?,hidden?,gone?,manual?}]}]
  manual_files jsonb default '[]',          -- 统一手册 [{name,url}]
  ref_files    jsonb default '[]',
  published    boolean not null default false,   -- 默认隐藏，导入检查完再公开
  updated_at   timestamptz default now()
);

-- ③ 权限：已公开的题库，学生 / 老师（含未登录的链接）都能读；写入、读未公开的只给管理员
alter table public.interview_banks enable row level security;
drop policy if exists ivb_read on public.interview_banks;
drop policy if exists ivb_admin_all on public.interview_banks;
create policy ivb_read on public.interview_banks for select using (published = true or public.is_admin());
create policy ivb_admin_all on public.interview_banks for all using (public.is_admin()) with check (public.is_admin());

-- ④ 检查
select major_key, published, jsonb_array_length(chapters) as chapters from public.interview_banks;

-- ───────── 回滚 ─────────
-- drop table public.interview_banks;
-- （riyu_submissions 里学生写的答案不受影响；回滚前不要删它）
