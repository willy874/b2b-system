CREATE TABLE "data_transfer_rows" (
	"transfer_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"source_row" integer,
	"raw" jsonb NOT NULL,
	"target_id" uuid,
	"target_version" integer,
	"target_expected" jsonb,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"outcome_error" jsonb,
	"changes" jsonb,
	"result_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_transfer_rows_transfer_id_row_no_pk" PRIMARY KEY("transfer_id","row_no"),
	CONSTRAINT "data_transfer_rows_outcome_check" CHECK ("data_transfer_rows"."outcome" IN ('pending', 'succeeded', 'failed', 'skipped', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "data_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" text NOT NULL,
	"type" text NOT NULL,
	"mode" text,
	"format" text NOT NULL,
	"status" text NOT NULL,
	"created_by" uuid NOT NULL,
	"locale" text NOT NULL,
	"timezone" text NOT NULL,
	"params" jsonb NOT NULL,
	"source_name" text,
	"output_key" text,
	"output_name" text,
	"output_size" bigint,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"succeeded_rows" integer DEFAULT 0 NOT NULL,
	"failed_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_details" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_transfers_direction_check" CHECK ("data_transfers"."direction" IN ('export', 'import')),
	CONSTRAINT "data_transfers_format_check" CHECK ("data_transfers"."format" IN ('csv', 'xlsx', 'sql')),
	CONSTRAINT "data_transfers_status_check" CHECK ("data_transfers"."status" IN ('queued', 'running', 'applying', 'completed', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "data_transfers_mode_check" CHECK (("data_transfers"."direction" = 'import' AND "data_transfers"."mode" IN ('create', 'update')) OR ("data_transfers"."direction" = 'export' AND "data_transfers"."mode" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "data_transfer_rows" ADD CONSTRAINT "data_transfer_rows_transfer_id_data_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."data_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_transfer_rows_outcome_idx" ON "data_transfer_rows" USING btree ("transfer_id","outcome");--> statement-breakpoint
CREATE INDEX "data_transfers_creator_idx" ON "data_transfers" USING btree ("created_by","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "data_transfers_expires_idx" ON "data_transfers" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "data_transfers_active_idx" ON "data_transfers" USING btree ("created_by") WHERE "data_transfers"."status" IN ('queued', 'running', 'applying');--> statement-breakpoint
-- 既有租戶的 admin、auditor 補上匯出權限（與 0043、0044 同一個做法：seed 只在角色新建立時寫入權限）。
-- 與 db/seeds/roles.ts 一致：admin 有 user:export、auditLog:export；auditor 有 auditLog:export（docs/architecture/backend/22-data-transfer.md §9.1）。
INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', p.key, 'role', r.id::text, 'holder'
FROM roles r
CROSS JOIN (VALUES ('user:export', 'admin'), ('auditLog:export', 'admin'), ('auditLog:export', 'auditor')) AS p(key, slug)
WHERE r.slug = p.slug AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
