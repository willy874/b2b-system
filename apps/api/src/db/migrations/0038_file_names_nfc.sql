-- 檔名與資料夾名稱改存 NFC（FileNameSchema 的 .normalize('NFC')）：之前存進來的 NFD 名稱（macOS 的瀏覽器常送出）一併轉換，
-- 否則舊的「Cafe + U+0301」與新的「Café」在同一層會並存。
-- 已刪除的資料夾不受同層唯一索引約束，直接轉換；還原時照常檢查撞名。
UPDATE "file_folders" SET "name" = normalize("name", NFC)
WHERE "deleted_at" IS NOT NULL AND "name" IS NOT NFC NORMALIZED;--> statement-breakpoint
-- 未刪除的資料夾：轉換後會與同層其他資料夾撞名（不分大小寫）的保持原樣，不讓 migration 失敗；
-- 同層有多筆轉換後同名的，至多轉最早建立的一筆
WITH "candidates" AS (
  SELECT DISTINCT ON (coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), lower(normalize("name", NFC))) "id"
  FROM "file_folders"
  WHERE "deleted_at" IS NULL AND "name" IS NOT NFC NORMALIZED
  ORDER BY coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), lower(normalize("name", NFC)), "created_at", "id"
)
UPDATE "file_folders" AS "f" SET "name" = normalize("f"."name", NFC)
FROM "candidates" AS "c"
WHERE "f"."id" = "c"."id"
  AND NOT EXISTS (
    SELECT 1 FROM "file_folders" AS "s"
    WHERE "s"."deleted_at" IS NULL
      AND "s"."id" <> "f"."id"
      AND coalesce("s"."parent_id", '00000000-0000-0000-0000-000000000000'::uuid) = coalesce("f"."parent_id", '00000000-0000-0000-0000-000000000000'::uuid)
      AND lower("s"."name") = lower(normalize("f"."name", NFC))
  );--> statement-breakpoint
-- 檔名沒有唯一約束，全部轉換
UPDATE "files" SET "name" = normalize("name", NFC) WHERE "name" IS NOT NFC NORMALIZED;
