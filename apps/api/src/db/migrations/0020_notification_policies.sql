CREATE TABLE "notification_policies" (
	"type" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "notification_policies_type_channel_pk" PRIMARY KEY("type","channel")
);
--> statement-breakpoint
ALTER TABLE "notification_policies" ADD CONSTRAINT "notification_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- 手動加上：與其他表一致由 trigger 維護 updated_at（0001_functions_and_triggers.sql 的 set_updated_at）
CREATE TRIGGER notification_policies_set_updated_at BEFORE UPDATE ON notification_policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
