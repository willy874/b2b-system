ALTER TABLE "file_folders" ADD COLUMN "deletion_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "deletion_id" uuid;--> statement-breakpoint
CREATE INDEX "file_folders_deletion_id_idx" ON "file_folders" USING btree ("deletion_id") WHERE "file_folders"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "files_deletion_id_idx" ON "files" USING btree ("deletion_id") WHERE "files"."deleted_at" IS NOT NULL;