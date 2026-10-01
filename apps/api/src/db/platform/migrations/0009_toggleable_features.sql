ALTER TABLE "tenants" ALTER COLUMN "features" SET DEFAULT '{file,auditLog,job,trash,systemSetting,identityProvider,tenantSwitch}'::text[];--> statement-breakpoint
-- ADR-0029：回收桶、系統設定、切換租戶原本是常駐的，既有租戶一律啟用；外部 IdP 沿用 allow_external_idp 的值
UPDATE "tenants" SET "features" = array_cat(
	array_remove(array_remove(array_remove(array_remove("features", 'trash'), 'systemSetting'), 'identityProvider'), 'tenantSwitch'),
	CASE WHEN "allow_external_idp"
		THEN '{trash,systemSetting,identityProvider,tenantSwitch}'::text[]
		ELSE '{trash,systemSetting,tenantSwitch}'::text[]
	END
);--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "allow_external_idp";
