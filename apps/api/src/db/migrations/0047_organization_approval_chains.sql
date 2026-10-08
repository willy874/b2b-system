CREATE TYPE "public"."approval_step_status" AS ENUM('waiting', 'active', 'approved', 'rejected', 'skipped', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."approval_status" ADD VALUE 'withdrawn';--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"reviewer_name" text NOT NULL,
	"decision" text NOT NULL,
	"via" text NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decisions_decision" CHECK ("approval_decisions"."decision" IN ('approve', 'reject'))
);
--> statement-breakpoint
CREATE TABLE "approval_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"allow_repeat_approver" boolean DEFAULT false NOT NULL,
	"steps" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "approval_step_assignees" (
	"step_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_step_assignees_step_id_user_id_pk" PRIMARY KEY("step_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"assignee" jsonb NOT NULL,
	"required_mode" text NOT NULL,
	"required_approvals" smallint,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "approval_step_status" NOT NULL,
	"shortage" text,
	"close_reason" text,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "approval_steps_required_mode" CHECK ("approval_steps"."required_mode" IN ('count', 'all') AND ("approval_steps"."required_mode" = 'all' OR "approval_steps"."required_approvals" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "org_unit_members" (
	"unit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_manager" boolean DEFAULT false NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "org_unit_members_unit_id_user_id_pk" PRIMARY KEY("unit_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"code" "citext",
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "flow_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "flow_version" integer;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "allow_repeat_approver" boolean;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "current_step" smallint;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "resubmitted_from" uuid;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_step_id_approval_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."approval_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_step_assignees" ADD CONSTRAINT "approval_step_assignees_step_id_approval_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."approval_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_step_assignees" ADD CONSTRAINT "approval_step_assignees_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_step_assignees" ADD CONSTRAINT "approval_step_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_members" ADD CONSTRAINT "org_unit_members_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_members" ADD CONSTRAINT "org_unit_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_org_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_step_reviewer_key" ON "approval_decisions" USING btree ("step_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "approval_decisions_request_idx" ON "approval_decisions" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_flows_type_key" ON "approval_flows" USING btree ("type");--> statement-breakpoint
CREATE INDEX "approval_step_assignees_user_idx" ON "approval_step_assignees" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_steps_request_ordinal_key" ON "approval_steps" USING btree ("request_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_steps_one_active_key" ON "approval_steps" USING btree ("request_id") WHERE "approval_steps"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "org_unit_members_primary_key" ON "org_unit_members" USING btree ("user_id") WHERE "org_unit_members"."is_primary";--> statement-breakpoint
CREATE INDEX "org_unit_members_user_idx" ON "org_unit_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_sibling_name_key" ON "org_units" USING btree (coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name")) WHERE "org_units"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_code_key" ON "org_units" USING btree ("code") WHERE "org_units"."deleted_at" IS NULL AND "org_units"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "org_units_parent_idx" ON "org_units" USING btree ("parent_id","sort_order");--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_resubmitted_from_approval_requests_id_fk" FOREIGN KEY ("resubmitted_from") REFERENCES "public"."approval_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_requester_idx" ON "approval_requests" USING btree ("requester_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- 既有租戶的系統角色補上組織管理與多階段審批的權限鍵（與 0044 同一個做法：seed 只在角色新建立時寫入權限）。
-- 與 db/seeds/roles.ts 一致；邊的形狀與 db/schema/relation-tuples.ts 的 rolePermissionTuple() 相同：tenant:self#<key>@role:<id>#holder。
INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', p.key, 'role', r.id::text, 'holder'
FROM roles r
CROSS JOIN (VALUES
  ('orgUnit:create'), ('orgUnit:read'), ('orgUnit:update'), ('orgUnit:delete'),
  ('approval:override'), ('approvalFlow:read'), ('approvalFlow:update')
) AS p(key)
WHERE r.slug = 'admin' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO relation_tuples (object_type, object_id, relation, subject_type, subject_id, subject_relation)
SELECT 'tenant', 'self', p.key, 'role', r.id::text, 'holder'
FROM roles r
CROSS JOIN (VALUES ('orgUnit:read'), ('approvalFlow:read')) AS p(key)
WHERE r.slug = 'auditor' AND r.is_system AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
