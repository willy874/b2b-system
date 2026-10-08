CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watches" (
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watches_resource_type_resource_id_user_id_pk" PRIMARY KEY("resource_type","resource_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_resource_created_idx" ON "comments" USING btree ("resource_type","resource_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "watches_user_idx" ON "watches" USING btree ("user_id");--> statement-breakpoint
-- 既有租戶的 admin 補上 comment:delete（與 0029、0044 同一個做法：seed 只在角色新建立時寫入權限；與 db/seeds/roles.ts 一致）。
-- 邊的形狀與 db/schema/relation-tuples.ts 的 rolePermissionTuple() 相同：tenant:self#<key>@role:<id>#holder。
INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', 'comment:delete', 'role', r.id::text, 'holder'
FROM roles r
WHERE r.slug = 'admin' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
