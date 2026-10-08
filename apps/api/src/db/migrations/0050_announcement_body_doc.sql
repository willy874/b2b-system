-- 公告內文改成富文本（docs/architecture/backend/19-announcement.md §9.2 D22）：純加法。
-- body 留著當純文字（搜尋、字數、稽核，以及部署期間的舊版 api），新增 body_doc 存文件 JSON；
-- 部署期間舊版 api 寫入的列沒有 body_doc，讀取時以 body 補上，所以欄位不加 NOT NULL。
ALTER TABLE "announcement_dispatches" ADD COLUMN "body_doc" jsonb;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "body_doc" jsonb;--> statement-breakpoint
-- 回填：每一行一個段落、空行是空段落（與 @b2b-system/rich-text 的 plainTextToRichText 相同）
UPDATE "announcements" SET "body_doc" = (
  SELECT jsonb_build_object(
    'type', 'doc',
    'content', jsonb_agg(
      CASE WHEN line = '' THEN jsonb_build_object('type', 'paragraph')
      ELSE jsonb_build_object('type', 'paragraph', 'content',
        jsonb_build_array(jsonb_build_object('type', 'text', 'text', line)))
      END ORDER BY ord))
  FROM regexp_split_to_table("body", E'\r?\n') WITH ORDINALITY AS t(line, ord)
) WHERE "body_doc" IS NULL;--> statement-breakpoint
UPDATE "announcement_dispatches" SET "body_doc" = (
  SELECT jsonb_build_object(
    'type', 'doc',
    'content', jsonb_agg(
      CASE WHEN line = '' THEN jsonb_build_object('type', 'paragraph')
      ELSE jsonb_build_object('type', 'paragraph', 'content',
        jsonb_build_array(jsonb_build_object('type', 'text', 'text', line)))
      END ORDER BY ord))
  FROM regexp_split_to_table("body", E'\r?\n') WITH ORDINALITY AS t(line, ord)
) WHERE "body_doc" IS NULL;
