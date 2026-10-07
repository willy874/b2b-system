CREATE TABLE "platform_admin_login_sources" (
	"admin_id" uuid NOT NULL,
	"ip_prefix" text NOT NULL,
	"last_success_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admin_login_sources_admin_id_ip_prefix_pk" PRIMARY KEY("admin_id","ip_prefix")
);
--> statement-breakpoint
ALTER TABLE "platform_admin_login_sources" ADD CONSTRAINT "platform_admin_login_sources_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_admin_login_sources_last_success_idx" ON "platform_admin_login_sources" USING btree ("last_success_at");