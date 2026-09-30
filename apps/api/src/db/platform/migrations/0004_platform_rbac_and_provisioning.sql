-- 平台 RBAC 與租戶佈建（docs/adr/0020-physical-tenant-isolation.md D5、D12）。drizzle-kit 產生後手動調整：
-- 在這之前建立的平台管理者都是 seed 建立的第一位管理者，升為 super-admin；之後新增的預設是唯讀的 auditor。
CREATE TYPE "public"."platform_admin_role" AS ENUM('super-admin', 'operator', 'auditor');--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "role" "platform_admin_role" DEFAULT 'auditor' NOT NULL;--> statement-breakpoint
UPDATE "platform_admins" SET "role" = 'super-admin';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "admin_email" "citext";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "admin_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "provision_error" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "provisioned_at" timestamp with time zone;