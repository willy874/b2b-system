CREATE TABLE "tenant_storage_usage" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"used_bytes" bigint NOT NULL,
	"measured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_storage_usage" ADD CONSTRAINT "tenant_storage_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;