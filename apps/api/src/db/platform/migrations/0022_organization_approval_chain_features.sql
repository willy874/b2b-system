ALTER TABLE "tenants" ALTER COLUMN "features" SET DEFAULT '{file,auditLog,job,trash,systemSetting,identityProvider,tenantSwitch,webhook,announcement,externalApi,group,dataTransfer,organization,approvalChain}'::text[];--> statement-breakpoint
-- docs/architecture/backend/23-organization.md §10.2 D3、docs/architecture/backend/20-approval.md §10.2 D17（2026-10-08 改為預設啟用）：
-- 組織管理與多階段審批預設啟用；既有租戶一律啟用（與新租戶的預設相同）
UPDATE "tenants" SET "features" = array_append("features", 'organization') WHERE NOT ('organization' = ANY("features"));--> statement-breakpoint
UPDATE "tenants" SET "features" = array_append("features", 'approvalChain') WHERE NOT ('approvalChain' = ANY("features"));
