CREATE TABLE "platform_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" text NOT NULL,
	"params" jsonb NOT NULL,
	"link" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_notifications" ADD CONSTRAINT "platform_notifications_recipient_id_platform_admins_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_notifications_recipient_created_idx" ON "platform_notifications" USING btree ("recipient_id","created_at","id");--> statement-breakpoint
CREATE INDEX "platform_notifications_recipient_unread_idx" ON "platform_notifications" USING btree ("recipient_id","created_at","id") WHERE "platform_notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "platform_notifications_read_at_idx" ON "platform_notifications" USING btree ("read_at") WHERE "platform_notifications"."read_at" IS NOT NULL;