-- 關係圖的邊（docs/adr/0024-relationship-based-access-control.md）。表由 drizzle-kit 產生；回填與同步的 trigger 在 0008。
CREATE TABLE "relation_tuples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"relation" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_relation" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "relation_tuples" ADD CONSTRAINT "relation_tuples_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relation_tuples_key" ON "relation_tuples" USING btree ("object_type","object_id","relation","subject_type","subject_id","subject_relation");--> statement-breakpoint
CREATE INDEX "relation_tuples_subject_idx" ON "relation_tuples" USING btree ("subject_type","subject_id","subject_relation");--> statement-breakpoint
CREATE INDEX "relation_tuples_object_idx" ON "relation_tuples" USING btree ("object_type","object_id","relation");