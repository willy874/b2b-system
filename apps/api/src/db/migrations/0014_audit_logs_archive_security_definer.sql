-- 手寫 migration：稽核封存改由應用程式的背景工作執行（docs/adr/0016-background-jobs.md D8）
--
-- 以函式擁有者（擁有資料表、跑 migration 的 role）的權限執行：應用程式的 role 不需要 audit_logs 的
-- DELETE，只能透過這個函式做「熱 → 冷搬移」；熱表的刪除 trigger 仍要求冷表有完全相同的副本
-- （0003 的 audit_logs_guard_delete），函式也做不了別的事。
--
-- 固定 search_path：SECURITY DEFINER 函式若沿用呼叫端的 search_path，呼叫端可以建立同名的
-- 表或函式來劫持它。
--
-- EXECUTE 維持 PostgreSQL 的預設（PUBLIC）：role 的名稱依部署而定，migration 無法指名。
-- 把應用程式與維運拆成不同 role 的部署，可自行 REVOKE ... FROM PUBLIC 後只 GRANT 給應用程式的 role。
-- 呼叫端能決定的只有 cutoff 與批次大小；搬到冷表的紀錄仍可查詢（06-audit-log.md §7.2），不會遺失。
ALTER FUNCTION archive_audit_logs(timestamptz, integer)
  SECURITY DEFINER
  SET search_path = public, pg_temp;
