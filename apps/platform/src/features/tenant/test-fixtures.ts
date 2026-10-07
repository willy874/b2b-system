import type { PlatformTenant, TenantFeatureParam } from '@/shared/api-sdk';

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
  integerParam('rateLimit.authPerMinute', null, 1200, 60, 100_000, 'perMinute'),
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
    featureParams: [...FEATURE_PARAMS],
    adminEmail: 'owner@acme.test',
    provisionError: null,
    provisionedAt: '2026-09-30T00:00:00.000Z',
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}
