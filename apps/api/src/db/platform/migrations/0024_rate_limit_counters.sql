-- 手改：UNLOGGED（drizzle 不支援）。計數當機後清空即可，換到的是不寫 WAL（docs/architecture/01-system.md §7 D6）
CREATE UNLOGGED TABLE "rate_limit_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_counters_reset_at_idx" ON "rate_limit_counters" USING btree ("reset_at");