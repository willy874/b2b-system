-- 角色名稱不分大小寫唯一、使用者關鍵字的 trigram 索引、系統角色的軟刪除保護。
-- 索引由 drizzle-kit 產生；資料修補與 trigger 為手寫。

-- ── 角色名稱：先正規化、再處理大小寫衝突，最後才建不分大小寫的唯一索引 ──
DROP INDEX "roles_name_key";--> statement-breakpoint
-- 名稱統一成 NFC（API 之後也會正規化）；組合方式不同的「é」視為同一個名稱
UPDATE "roles" SET "name" = normalize("name", NFC) WHERE "name" IS NOT NFC NORMALIZED;--> statement-breakpoint
-- 既有資料若有只差大小寫的同名角色（例：`Admin` 與 `admin`）：最早建立的保留原名，
-- 其餘改名為「<原名> (<slug>)」。slug 在未刪除的角色中唯一，改名後不會再互相衝突；
-- 系統角色的 trigger 只擋 slug／is_system，改 name 不受影響。這是資料修補，不寫稽核。
UPDATE "roles" AS r
SET "name" = r."name" || ' (' || r."slug" || ')'
FROM (
  SELECT "id",
         row_number() OVER (PARTITION BY lower("name") ORDER BY "created_at", "id") AS rank
  FROM "roles"
  WHERE "deleted_at" IS NULL
) AS ranked
WHERE r."id" = ranked."id" AND ranked.rank > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_key" ON "roles" USING btree (lower("name")) WHERE "roles"."deleted_at" IS NULL;--> statement-breakpoint

-- ── 使用者列表的關鍵字（ILIKE '%…%'）──
CREATE INDEX "users_email_trgm_idx" ON "users" USING gin (("email"::text) gin_trgm_ops) WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "users_username_trgm_idx" ON "users" USING gin (("username"::text) gin_trgm_ops) WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "users_display_name_trgm_idx" ON "users" USING gin ("display_name" gin_trgm_ops) WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint

-- ── I7 系統角色保護：實際的刪除路徑是軟刪除（UPDATE deleted_at），也要擋 ──
CREATE OR REPLACE FUNCTION protect_system_roles() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'ROLE_SYSTEM_PROTECTED: cannot delete system role %', OLD.slug;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system THEN
    IF NEW.slug <> OLD.slug THEN
      RAISE EXCEPTION 'ROLE_SYSTEM_PROTECTED: cannot rename slug of system role %', OLD.slug;
    END IF;
    IF NEW.is_system <> OLD.is_system THEN
      RAISE EXCEPTION 'ROLE_SYSTEM_PROTECTED: cannot change is_system flag';
    END IF;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'ROLE_SYSTEM_PROTECTED: cannot delete system role %', OLD.slug;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;
