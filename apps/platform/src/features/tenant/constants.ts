import type { ChipTone } from '@b2b-system/ui/Chip';

import { TenantFeature } from '@/shared/api-sdk';
import type {
  PlatformTenant,
  TenantFeatureImpact,
  TenantFeatureParam,
  TenantFeatureParamKey,
} from '@/shared/api-sdk';

import type { TenantDetailTab } from './routes/model';

type TenantStatus = PlatformTenant['status'];

export const TENANT_STATUS_LABEL_KEY = {
  provisioning: 'tenant.status.provisioning',
  active: 'tenant.status.active',
  disabled: 'tenant.status.disabled',
  failed: 'tenant.status.failed',
} as const satisfies Record<TenantStatus, string>;

/** 狀態 Chip 的語意色（`Chip` 的 `tone`，顏色走 design token）。 */
export const TENANT_STATUS_TONE = {
  provisioning: 'warning',
  active: 'success',
  disabled: 'neutral',
  failed: 'danger',
} as const satisfies Record<TenantStatus, ChipTone>;

/** 詳情頁的分頁名稱。 */
export const TENANT_DETAIL_TAB_LABEL_KEY = {
  overview: 'tenant.tab.overview',
  features: 'tenant.tab.features',
  flags: 'tenant.tab.flags',
} as const satisfies Record<TenantDetailTab, string>;

export const TENANT_PAGE_SIZE_OPTIONS = [25, 50, 100];

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

/** 關閉 feature 會影響的項目（`GET /platform/tenants/:id/features/:feature/impact`）。 */
export const TENANT_FEATURE_IMPACT_LABEL_KEY = {
  identityProviderConnections: 'tenant.feature.impact.identityProviderConnections',
  ssoOnlyDomains: 'tenant.feature.impact.ssoOnlyDomains',
  passwordlessExternalUsers: 'tenant.feature.impact.passwordlessExternalUsers',
} as const satisfies Record<TenantFeatureImpact['items'][number]['key'], string>;

/**
 * feature 參數的名稱與說明（docs/architecture/05-tenancy.md §13.2 D1）。key 來自 api-sdk：
 * api 新增一個參數時，下面的 `satisfies` 會讓編譯失敗。
 */
export const TENANT_FEATURE_PARAM_LABEL_KEY = {
  'file.storageQuotaMb': 'tenant.param.file.storageQuotaMb',
  'auditLog.hotRetentionDays': 'tenant.param.auditLog.hotRetentionDays',
  'auditLog.retentionDays': 'tenant.param.auditLog.retentionDays',
  'job.maxConcurrency': 'tenant.param.job.maxConcurrency',
  'identityProvider.maxProviders': 'tenant.param.identityProvider.maxProviders',
  'webhook.maxUrls': 'tenant.param.webhook.maxUrls',
  'rateLimit.authPerMinute': 'tenant.param.rateLimit.authPerMinute',
} as const satisfies Record<TenantFeatureParamKey, string>;

export const TENANT_FEATURE_PARAM_DESCRIPTION_KEY = {
  'file.storageQuotaMb': 'tenant.param.file.storageQuotaMbDescription',
  'auditLog.hotRetentionDays': 'tenant.param.auditLog.hotRetentionDaysDescription',
  'auditLog.retentionDays': 'tenant.param.auditLog.retentionDaysDescription',
  'job.maxConcurrency': 'tenant.param.job.maxConcurrencyDescription',
  'identityProvider.maxProviders': 'tenant.param.identityProvider.maxProvidersDescription',
  'webhook.maxUrls': 'tenant.param.webhook.maxUrlsDescription',
  'rateLimit.authPerMinute': 'tenant.param.rateLimit.authPerMinuteDescription',
} as const satisfies Record<TenantFeatureParamKey, string>;

/** 值帶單位的寫法（`{{value}}`）。 */
export const TENANT_FEATURE_PARAM_UNIT_KEY = {
  days: 'tenant.param.unit.days',
  megabytes: 'tenant.param.unit.megabytes',
  count: 'tenant.param.unit.count',
  perMinute: 'tenant.param.unit.perMinute',
} as const satisfies Record<NonNullable<TenantFeatureParam['unit']>, string>;
