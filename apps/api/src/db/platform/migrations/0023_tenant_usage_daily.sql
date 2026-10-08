CREATE TABLE "tenant_usage_daily" (
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"users_active" integer,
	"users_total" integer,
	"service_accounts" integer,
	"storage_used_bytes" bigint,
	"storage_quota_bytes" bigint,
	"last_login_at" timestamp with time zone,
	"snapshot_at" timestamp with time zone,
	"requests_internal" bigint DEFAULT 0 NOT NULL,
	"requests_external" bigint DEFAULT 0 NOT NULL,
	"jobs_executed" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "tenant_usage_daily_tenant_id_date_pk" PRIMARY KEY("tenant_id","date")
);
--> statement-breakpoint
ALTER TABLE "tenant_usage_daily" ADD CONSTRAINT "tenant_usage_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_usage_daily_date_idx" ON "tenant_usage_daily" USING btree ("date");