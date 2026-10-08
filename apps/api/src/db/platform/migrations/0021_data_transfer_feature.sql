ALTER TABLE "tenants" ALTER COLUMN "features" SET DEFAULT '{file,auditLog,job,trash,systemSetting,identityProvider,tenantSwitch,webhook,announcement,externalApi,group,dataTransfer}'::text[];--> statement-breakpoint
-- docs/architecture/backend/22-data-transfer.md §13 D17：匯入／匯出是新的 feature，預設啟用；既有租戶一律啟用（與新租戶的預設相同）
UPDATE "tenants" SET "features" = array_append("features", 'dataTransfer') WHERE NOT ('dataTransfer' = ANY("features"));
