-- 平台管理者的登入失敗鎖定改成只寫 locked_until、不改 status（docs/architecture/backend/04-auth.md §3.3）：
-- 改了 status，任何知道 email 的人錯 N 次就能把線上的平台管理者踢下線。同租戶的 migration 0003。
-- 舊版鎖定留下的 status = locked 一律改回 active；locked_until 保留，還沒到期的照樣鎖到到期為止，
-- 管理介面顯示的 locked 改由 locked_until 推出。PATCH /platform/admins/:id 從來不接受 locked，所以這些列都是自動鎖定留下的。
UPDATE "platform_admins" SET "status" = 'active' WHERE "status" = 'locked';
