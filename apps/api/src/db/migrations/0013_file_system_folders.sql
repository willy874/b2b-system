CREATE TYPE "public"."file_folder_kind" AS ENUM('normal', 'shared', 'privateRoot', 'personal');--> statement-breakpoint
ALTER TYPE "public"."grant_subject_type" ADD VALUE 'everyone';--> statement-breakpoint
ALTER TABLE "file_folders" ADD COLUMN "kind" "file_folder_kind" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "file_folders" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_folders_singleton_kind_key" ON "file_folders" USING btree ("kind") WHERE "file_folders"."kind" IN ('shared', 'privateRoot') AND "file_folders"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "file_folders_personal_owner_key" ON "file_folders" USING btree ("owner_id") WHERE "file_folders"."kind" = 'personal' AND "file_folders"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_personal_has_owner" CHECK (("file_folders"."kind" = 'personal') = ("file_folders"."owner_id" IS NOT NULL));