CREATE TYPE "public"."file_status" AS ENUM('pending', 'ready');--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"etag" text,
	"status" "file_status" DEFAULT 'pending' NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "files_size_non_negative" CHECK ("files"."size" >= 0),
	CONSTRAINT "files_ready_confirmed" CHECK ("files"."status" = 'pending' OR ("files"."etag" IS NOT NULL AND "files"."uploaded_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "files_storage_key_key" ON "files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "files_status_created_at_idx" ON "files" USING btree ("status","created_at") WHERE "files"."deleted_at" IS NULL;--> statement-breakpoint
-- updated_at 自動更新（函式定義在 0001_triggers.sql）
DROP TRIGGER IF EXISTS files_set_updated_at ON files;--> statement-breakpoint
CREATE TRIGGER files_set_updated_at BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
