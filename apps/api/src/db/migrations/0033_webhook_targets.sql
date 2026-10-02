-- Webhook 的多個目標網址（docs/adr/0033-feature-params-and-webhook-targets.md D12、D14）
CREATE TABLE "webhook_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"url" text NOT NULL,
	"position" integer NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_targets_subscription_url_key" UNIQUE("subscription_id","url")
);
--> statement-breakpoint
ALTER TABLE "webhook_targets" ADD CONSTRAINT "webhook_targets_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 既有訂閱的網址搬成第一個目標；失敗次數與最後投遞時間跟著搬
INSERT INTO "webhook_targets" ("subscription_id", "url", "position", "consecutive_failures", "last_delivery_at", "created_at")
SELECT "id", "url", 0, "consecutive_failures", "last_delivery_at", "created_at" FROM "webhook_subscriptions";--> statement-breakpoint
-- 舊欄位留著讓升版期間的舊程式碼讀（新程式碼雙寫第一個網址），下一次部署刪除
ALTER TABLE "webhook_subscriptions" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "target_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "url" text;--> statement-breakpoint
UPDATE "webhook_deliveries" AS d SET "target_id" = t."id", "url" = t."url"
FROM "webhook_targets" AS t WHERE t."subscription_id" = d."subscription_id";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "url" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_target_id_webhook_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."webhook_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_target_idx" ON "webhook_deliveries" USING btree ("target_id");
