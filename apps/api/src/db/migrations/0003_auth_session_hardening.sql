ALTER TABLE "refresh_tokens" ADD COLUMN "family_created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_revoked_idx" ON "refresh_tokens" USING btree ("family_id") WHERE "refresh_tokens"."revoked_at" IS NOT NULL;--> statement-breakpoint
-- 手動加上（docs/architecture/backend/04-auth.md §3.3）：登入失敗的自動鎖定改成只寫 locked_until、不改 status。
-- 舊版鎖定留下的 status = locked 一律改回 active；locked_until 保留，還沒到期的照樣鎖到到期為止。
-- PATCH /users/:id 從來不接受 locked，所以這些列都是自動鎖定留下的。
UPDATE "users" SET "status" = 'active' WHERE "status" = 'locked';
