import { TenantFeature } from '@/shared/api-sdk';
import type { PlatformTenant, TenantFeatureParam, TenantFeatureParamKey } from '@/shared/api-sdk';

type TenantStatus = PlatformTenant['status'];

export const TENANT_STATUS_LABEL_KEY = {
  provisioning: 'tenant.status.provisioning',
  active: 'tenant.status.active',
  disabled: 'tenant.status.disabled',
  failed: 'tenant.status.failed',
} as const satisfies Record<TenantStatus, string>;

/** 狀態點的顏色走 design token（CLAUDE.md 前端規則 6）。 */
export const TENANT_STATUS_DOT_CLASS = {
  provisioning: 'bg-[var(--color-warning)]',
  active: 'bg-[var(--color-success)]',
  disabled: 'bg-[var(--color-fg-muted)]',
  failed: 'bg-[var(--color-danger)]',
} as const satisfies Record<TenantStatus, string>;

export const TENANT_PAGE_SIZE_OPTIONS = [25, 50, 100];

/** 狀態篩選的「全部」：不帶 `status` 參數。 */
export const TENANT_STATUS_ALL = 'all';

/** 與後端 `TENANT_CODE_PATTERN` 相同：小寫英數與連字號，3–32 字元，開頭是字母。 */
export const TENANT_CODE_PATTERN = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

/** 與後端 `RESERVED_TENANT_CODES` 相同：會與部署用的子網域撞在一起。 */
export const RESERVED_TENANT_CODES: ReadonlySet<string> = new Set([
  'api',
  'auth',
  'www',
  'admin',
  'platform',
  'static',
  'storage',
  'mail',
]);

/** 與後端 `TenantDomainSchema` 相同：主機名稱，可以帶 port。 */
export const TENANT_DOMAIN_PATTERN =
  /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

/**
 * 可由平台管理者開關的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D8），依 api 的 `TENANT_FEATURES` 順序。
 * 值來自 api-sdk：api 新增一個 id 時，下面兩張表的 `satisfies` 會讓編譯失敗。
 */
export const TENANT_FEATURES: readonly TenantFeature[] = Object.values(TenantFeature);

export const TENANT_FEATURE_LABEL_KEY = {
  file: 'tenant.feature.file',
  auditLog: 'tenant.feature.auditLog',
  job: 'tenant.feature.job',
  trash: 'tenant.feature.trash',
  systemSetting: 'tenant.feature.systemSetting',
  identityProvider: 'tenant.feature.identityProvider',
  tenantSwitch: 'tenant.feature.tenantSwitch',
  webhook: 'tenant.feature.webhook',
  announcement: 'tenant.feature.announcement',
} as const satisfies Record<TenantFeature, string>;

export const TENANT_FEATURE_DESCRIPTION_KEY = {
  file: 'tenant.feature.fileDescription',
  auditLog: 'tenant.feature.auditLogDescription',
  job: 'tenant.feature.jobDescription',
  trash: 'tenant.feature.trashDescription',
  systemSetting: 'tenant.feature.systemSettingDescription',
  identityProvider: 'tenant.feature.identityProviderDescription',
  tenantSwitch: 'tenant.feature.tenantSwitchDescription',
  webhook: 'tenant.feature.webhookDescription',
  announcement: 'tenant.feature.announcementDescription',
} as const satisfies Record<TenantFeature, string>;

/**
 * 關閉時確認框額外的警告：影響超出「看不到頁面」的 feature 才有（docs/architecture/05-tenancy.md §12.2 D5）。
 */
export const TENANT_FEATURE_DISABLE_WARNING_KEY: Partial<Record<TenantFeature, string>> = {
  identityProvider: 'tenant.feature.identityProviderDisableWarning',
  webhook: 'tenant.feature.webhookDisableWarning',
  announcement: 'tenant.feature.announcementDisableWarning',
};

/**
 * feature 參數的名稱與說明（docs/architecture/05-tenancy.md §13.2 D1）。key 來自 api-sdk：
 * api 新增一個參數時，下面的 `satisfies` 會讓編譯失敗。
 */
export const TENANT_FEATURE_PARAM_LABEL_KEY = {
  'file.storageQuotaMb': 'tenant.param.file.storageQuotaMb',
  'auditLog.hotRetentionDays': 'tenant.param.auditLog.hotRetentionDays',
  'job.maxConcurrency': 'tenant.param.job.maxConcurrency',
  'identityProvider.maxProviders': 'tenant.param.identityProvider.maxProviders',
  'webhook.maxUrls': 'tenant.param.webhook.maxUrls',
} as const satisfies Record<TenantFeatureParamKey, string>;

export const TENANT_FEATURE_PARAM_DESCRIPTION_KEY = {
  'file.storageQuotaMb': 'tenant.param.file.storageQuotaMbDescription',
  'auditLog.hotRetentionDays': 'tenant.param.auditLog.hotRetentionDaysDescription',
  'job.maxConcurrency': 'tenant.param.job.maxConcurrencyDescription',
  'identityProvider.maxProviders': 'tenant.param.identityProvider.maxProvidersDescription',
  'webhook.maxUrls': 'tenant.param.webhook.maxUrlsDescription',
} as const satisfies Record<TenantFeatureParamKey, string>;

/** 值帶單位的寫法（`{{value}}`）。 */
export const TENANT_FEATURE_PARAM_UNIT_KEY = {
  days: 'tenant.param.unit.days',
  megabytes: 'tenant.param.unit.megabytes',
  count: 'tenant.param.unit.count',
} as const satisfies Record<NonNullable<TenantFeatureParam['unit']>, string>;
