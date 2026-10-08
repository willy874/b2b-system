import type {
  PlatformTenant,
  PlatformTenantListItem,
  TenantFeatureParam,
  TenantUsage,
  TenantUsageSummary,
} from '@/shared/api-sdk';

import { TENANT_FEATURES } from './constants';

/** 與 api 的目錄相同的參數，都是預設值（docs/architecture/05-tenancy.md §13.2 D3）。 */
export const FEATURE_PARAMS: readonly TenantFeatureParam[] = [
  integerParam('file.storageQuotaMb', 'file', 2048, 1, 10_485_760, 'megabytes'),
  integerParam('auditLog.hotRetentionDays', 'auditLog', 90, 7, 3650, 'days'),
  {
    ...integerParam('auditLog.retentionDays', 'auditLog', 365, 365, 36_500, 'days'),
    foreverValue: -1,
  },
  integerParam('job.maxConcurrency', 'job', 10, 1, 100, 'count'),
  integerParam('identityProvider.maxProviders', 'identityProvider', 10, 1, 100, 'count'),
  integerParam('webhook.maxUrls', 'webhook', 1, 1, 500, 'count'),
  integerParam('dataTransfer.importMaxRows', 'dataTransfer', 5000, 100, 20_000, 'count'),
  integerParam('dataTransfer.importMaxSizeMb', 'dataTransfer', 10, 1, 50, 'megabytes'),
  integerParam('dataTransfer.exportMaxRows', 'dataTransfer', 100_000, 1000, 1_000_000, 'count'),
  integerParam('rateLimit.authPerMinute', null, 1200, 60, 100_000, 'perMinute'),
  {
    key: 'rateLimit.trustedCidrs',
    feature: null,
    type: 'string',
    value: '',
    defaultValue: '',
    overridden: false,
    unit: null,
    min: null,
    max: null,
    foreverValue: null,
    maxLength: 1000,
  },
];

function integerParam(
  key: TenantFeatureParam['key'],
  feature: TenantFeatureParam['feature'],
  value: number,
  min: number,
  max: number,
  unit: NonNullable<TenantFeatureParam['unit']>,
): TenantFeatureParam {
  return {
    key,
    feature,
    type: 'integer',
    value,
    defaultValue: value,
    overridden: false,
    unit,
    min,
    max,
    foreverValue: null,
    maxLength: null,
  };
}

/** 頁面測試共用的租戶。 */
export function tenantFixture(overrides: Partial<PlatformTenant> = {}): PlatformTenant {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    code: 'acme',
    name: 'Acme 股份有限公司',
    status: 'active',
    domains: ['acme.localhost:5173', 'portal.acme.test'],
    storageBucket: 'b2b-acme',
    features: [...TENANT_FEATURES],
    flags: {},
    mfaMethods: {},
    featureParams: [...FEATURE_PARAMS],
    adminEmail: 'owner@acme.test',
    provisionError: null,
    provisionedAt: '2026-09-30T00:00:00.000Z',
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

const MIB = 1024 * 1024;

/** 用量摘要：還沒彙總過（快照的量都是 `null`）。 */
export function emptyUsageSummary(): TenantUsageSummary {
  return {
    usersActive: null,
    usersTotal: null,
    serviceAccounts: null,
    storageUsedBytes: null,
    storageQuotaBytes: null,
    storageUsageRatio: null,
    recentRequests: 0,
    lastActivityAt: null,
    snapshotAt: null,
  };
}

/** 用量摘要：2048 MB 的配額用了 `ratio`。 */
export function usageSummaryFixture(
  overrides: Partial<TenantUsageSummary> = {},
  ratio = 0.25,
): TenantUsageSummary {
  return {
    usersActive: 12,
    usersTotal: 15,
    serviceAccounts: 2,
    storageUsedBytes: Math.round(2048 * ratio) * MIB,
    storageQuotaBytes: 2048 * MIB,
    storageUsageRatio: ratio,
    recentRequests: 4321,
    lastActivityAt: '2026-10-07T09:30:00.000Z',
    snapshotAt: '2026-10-08T06:05:00.000Z',
    ...overrides,
  };
}

/** 租戶清單的一列（租戶 ＋ 用量摘要）。 */
export function tenantListItemFixture(
  overrides: Partial<PlatformTenant> = {},
  usage: TenantUsageSummary = usageSummaryFixture(),
): PlatformTenantListItem {
  return { ...tenantFixture(overrides), usage };
}

/** 詳情頁的用量：近 `days` 天，最後一天有請求。 */
export function tenantUsageFixture(summary = usageSummaryFixture(), days = 30): TenantUsage {
  return {
    summary,
    warningRatio: 0.8,
    recentDays: 7,
    daily: Array.from({ length: days }, (_, index) => {
      const date = new Date(Date.UTC(2026, 8, 9 + index)).toISOString().slice(0, 10);
      const last = index === days - 1;
      return {
        date,
        usersActive: last ? summary.usersActive : null,
        usersTotal: last ? summary.usersTotal : null,
        serviceAccounts: last ? summary.serviceAccounts : null,
        storageUsedBytes: last ? summary.storageUsedBytes : null,
        storageQuotaBytes: last ? summary.storageQuotaBytes : null,
        requestsInternal: last ? 120 : 0,
        requestsExternal: last ? 30 : 0,
        jobsExecuted: last ? 4 : 0,
      };
    }),
  };
}
