-- groups 的 trigger（手寫 migration）：軟刪除與還原讓關係圖的 revision +1、updated_at 自動更新。
--
-- revision：docs/adr/0024-relationship-based-access-control.md D11、D12。
-- 刪除群組不刪成員與持有角色的邊（休眠，還原時一起回來），刪除與還原都只改 groups.deleted_at、不寫 relation_tuples；
-- 但主體閉包會排除已刪除的群組，deleted_at 的改變等於關係圖變了。理由與角色相同（0012）：沒有這個 trigger，
-- 其他程序收到的廣播 revision 沒有前進、會被當成舊訊息略過。函式 authz_revision_bump() 見 0009。

DROP TRIGGER IF EXISTS groups_bump_authz_revision ON groups;
--> statement-breakpoint

CREATE TRIGGER groups_bump_authz_revision
  AFTER UPDATE OF deleted_at ON groups
  FOR EACH ROW
  WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION authz_revision_bump();
--> statement-breakpoint

-- updated_at 由 trigger 維護（與 users、roles 相同，docs/architecture/backend/02-database.md §3.3；函式見 0001）
DROP TRIGGER IF EXISTS groups_set_updated_at ON groups;
--> statement-breakpoint

CREATE TRIGGER groups_set_updated_at BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
