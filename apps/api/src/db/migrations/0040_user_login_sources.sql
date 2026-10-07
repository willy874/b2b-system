CREATE TABLE "user_login_sources" (
	"user_id" uuid NOT NULL,
	"ip_prefix" text NOT NULL,
	"last_success_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_login_sources_user_id_ip_prefix_pk" PRIMARY KEY("user_id","ip_prefix")
);
--> statement-breakpoint
ALTER TABLE "user_login_sources" ADD CONSTRAINT "user_login_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_login_sources_last_success_idx" ON "user_login_sources" USING btree ("last_success_at");