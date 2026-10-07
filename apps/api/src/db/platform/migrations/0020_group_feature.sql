ALTER TABLE "tenants" ALTER COLUMN "features" SET DEFAULT '{file,auditLog,job,trash,systemSetting,identityProvider,tenantSwitch,webhook,announcement,externalApi,group}'::text[];--> statement-breakpoint
-- docs/architecture/iam/07-groups.md §8：群組原本常駐，改為可由平台關閉；既有租戶一律啟用（行為不變，與新租戶的預設相同）
UPDATE "tenants" SET "features" = array_append("features", 'group') WHERE NOT ('group' = ANY("features"));
