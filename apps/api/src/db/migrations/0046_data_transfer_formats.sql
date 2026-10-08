ALTER TABLE "data_transfers" DROP CONSTRAINT "data_transfers_format_check";--> statement-breakpoint
ALTER TABLE "data_transfer_rows" ADD COLUMN "target_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_format_check" CHECK ("data_transfers"."format" IN ('csv', 'xlsx', 'json', 'yaml', 'sql'));