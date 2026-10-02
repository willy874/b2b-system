ALTER TABLE "tenants" ALTER COLUMN "features" SET DEFAULT '{file,auditLog,job,trash,systemSetting,identityProvider,tenantSwitch,webhook}'::text[];--> statement-breakpoint
-- ADR-0030 D8：webhook 是新功能，既有租戶一律啟用（與新租戶的預設相同）
UPDATE "tenants" SET "features" = array_append("features", 'webhook') WHERE NOT ('webhook' = ANY("features"));
