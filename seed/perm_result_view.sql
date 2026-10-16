-- 合格实绩⑬：「合格实绩查询」单独开关 permissions.result_view
-- 把现在能看到老师端「合格实绩」的老师（promo 为真 且 result_admin 不为真）设为 result_view = true，迁移后显示状态不变。
-- promo 可能是布尔 true，也可能是字符串 "true"，两种都认。可重复执行。
update public.teachers t
set permissions = coalesce(t.permissions, '{}'::jsonb) || '{"result_view": true}'::jsonb
where lower(coalesce(t.permissions->>'promo', '')) = 'true'
  and lower(coalesce(t.permissions->>'result_admin', '')) <> 'true'
returning t.name;

-- 回滚（只撤销本次设置的 result_view；如需只回滚上面改动的老师，先记下 returning 的名单）：
-- update public.teachers set permissions = permissions - 'result_view' where permissions ? 'result_view' returning name;
