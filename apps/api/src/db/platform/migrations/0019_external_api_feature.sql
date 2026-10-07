ALTER TABLE "tenants" ALTER COLUMN "features" SET DEFAULT '{file,auditLog,job,trash,systemSetting,identityProvider,tenantSwitch,webhook,announcement,externalApi}'::text[];--> statement-breakpoint
-- docs/architecture/06-external-api.md：對外 API 原本常駐，改為可由平台關閉；既有租戶一律啟用（行為不變，與新租戶的預設相同）
UPDATE "tenants" SET "features" = array_append("features", 'externalApi') WHERE NOT ('externalApi' = ANY("features"));
