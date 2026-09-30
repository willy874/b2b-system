-- 關係圖的版本號（docs/adr/0024-relationship-based-access-control.md D7、D8）。
-- 表由 drizzle-kit 產生；初始列與 trigger 為手寫。
--
-- relation_tuples 的每一條寫入語句（含 TRUNCATE）在同一個交易內讓 revision +1：
-- 寫入之間以這一列的鎖排隊，提交順序＝版本順序。程式在交易提交後讀取它，連同租戶代碼廣播給其他程序。
-- 以語句為單位（不是每列）：一次寫入多列只 +1；沒有影響任何列的語句也會 +1，只是多一次失效。

CREATE TABLE "authz_revision" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "authz_revision_single_row" CHECK ("authz_revision"."id")
);
--> statement-breakpoint

INSERT INTO "authz_revision" ("id", "revision") VALUES (true, 0) ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION authz_revision_bump() RETURNS trigger AS $$
BEGIN
  UPDATE authz_revision SET revision = revision + 1 WHERE id;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS relation_tuples_bump_revision ON relation_tuples;
--> statement-breakpoint

CREATE TRIGGER relation_tuples_bump_revision
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON relation_tuples
  FOR EACH STATEMENT EXECUTE FUNCTION authz_revision_bump();
