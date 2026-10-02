ALTER TABLE "tenants" ALTER COLUMN "features" SET DEFAULT '{file,auditLog,job,trash,systemSetting,identityProvider,tenantSwitch,webhook,announcement}'::text[];--> statement-breakpoint
-- ADR-0031 D20：公告是新功能，既有租戶一律啟用（與新租戶的預設相同）
UPDATE "tenants" SET "features" = array_append("features", 'announcement') WHERE NOT ('announcement' = ANY("features"));
