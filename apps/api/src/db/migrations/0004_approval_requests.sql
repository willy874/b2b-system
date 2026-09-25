CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"subject_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"private_payload" jsonb,
	"requester_id" uuid,
	"requester_name" text NOT NULL,
	"reason" text,
	"reviewer_id" uuid,
	"reviewer_name" text,
	"review_comment" text,
	"reviewed_at" timestamp with time zone,
	"result_resource_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_reviewed_consistency" CHECK (("approval_requests"."status" = 'pending') = ("approval_requests"."reviewed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_pending_subject_key" ON "approval_requests" USING btree ("type","subject_key") WHERE "approval_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "approval_requests_status_created_idx" ON "approval_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "approval_requests_created_idx" ON "approval_requests" USING btree ("created_at" DESC NULLS LAST);