-- 角色的軟刪除與還原也讓關係圖的 revision +1（docs/adr/0025-entity-revisions.md D2、R3）。手寫 migration。
--
-- R3 起刪除角色不再刪持有者邊（還原時原本的持有者自動回來），刪除與還原都只改 roles.deleted_at、不寫 relation_tuples；
-- 但關係圖的主體閉包會排除已刪除的角色，deleted_at 的改變等於關係圖變了。沒有這個 trigger，
-- 其他程序收到的廣播 revision 沒有前進、會被當成舊訊息略過，已刪除角色的權限要等 TTL 才消失。
-- 函式 authz_revision_bump() 見 0009（AFTER trigger 回傳 NULL，列層級與語句層級都可用）。

DROP TRIGGER IF EXISTS roles_bump_authz_revision ON roles;
--> statement-breakpoint

CREATE TRIGGER roles_bump_authz_revision
  AFTER UPDATE OF deleted_at ON roles
  FOR EACH ROW
  WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION authz_revision_bump();
