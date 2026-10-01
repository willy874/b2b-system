CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_type_channel_pk" PRIMARY KEY("user_id","type","channel")
);
--> statement-breakpoint
ALTER TABLE "notification_policies" ALTER COLUMN "enabled" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD COLUMN "allow_user_override" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 手動加上：與其他表一致由 trigger 維護 updated_at（0001_functions_and_triggers.sql 的 set_updated_at）
CREATE TRIGGER notification_preferences_set_updated_at BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- 手動加上：只存覆寫值，兩個欄位都是預設（enabled 跟著事件、允許個人調整）的列不該存在（ADR-0028 D5、D15）
ALTER TABLE notification_policies ADD CONSTRAINT notification_policies_has_override
  CHECK (enabled IS NOT NULL OR allow_user_override = false);
