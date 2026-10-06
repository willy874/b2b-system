-- `locked` 只是對外顯示的狀態（active 且 locked_until 還沒到期，docs/architecture/backend/04-auth.md §3.3），不再寫進 status。
-- 0003 已把舊值改回 active；之後沒有程式會寫入它，這裡再改一次只是讓約束一定加得上去。
UPDATE "users" SET "status" = 'active' WHERE "status" = 'locked';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_not_locked" CHECK ("users"."status" <> 'locked');
