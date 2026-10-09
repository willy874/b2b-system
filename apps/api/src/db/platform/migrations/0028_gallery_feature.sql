ALTER TABLE "tenants" ALTER COLUMN "features" SET DEFAULT '{file,auditLog,job,trash,systemSetting,identityProvider,tenantSwitch,webhook,announcement,externalApi,group,dataTransfer,organization,approvalChain,gallery}'::text[];--> statement-breakpoint
-- docs/architecture/backend/26-gallery.md D3：圖片庫預設啟用；既有租戶一律啟用（與新租戶的預設相同）
UPDATE "tenants" SET "features" = array_append("features", 'gallery') WHERE NOT ('gallery' = ANY("features"));
