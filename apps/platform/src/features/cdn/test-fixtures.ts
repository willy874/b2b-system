import type { CdnCheckResult, CdnOverview } from '@/shared/api-sdk';

/** 頁面測試共用的檢查結果：一個正常的節點。 */
export function cdnCheckFixture(overrides: Partial<CdnCheckResult> = {}): CdnCheckResult {
  return {
    checkedAt: '2026-10-09T03:00:00Z',
    ready: true,
    discovery: { ok: true },
    nodes: [
      {
        address: '10.0.0.11',
        problems: [],
        kids: ['k2', 'k1'],
        missingKids: [],
        cache: { maxSize: '10g', inactive: '30d', valid: '30d' },
        build: 'abc123',
        startedAt: '2026-10-09T00:00:00Z',
      },
    ],
    publicUrl: { result: 'ok', status: 404 },
    signatureEnforced: { result: 'ok', status: 403 },
    ...overrides,
  };
}

/** 頁面測試共用的概況：部署了 CDN、沒有設定列（跟著環境變數）。 */
export function cdnOverviewFixture(overrides: Partial<CdnOverview> = {}): CdnOverview {
  return {
    deployment: {
      deployed: true,
      provider: 'nginx',
      origin: 'https://cdn.example.test',
      signingKid: 'k2',
      kids: ['k2', 'k1'],
      resources: ['fileVariant', 'imageAsset', 'galleryItem'],
      minUrlTtl: 300,
      maxUrlTtl: 86400,
      purgeConfigured: true,
      purgeOnDelete: true,
      purgeBatchSize: 100,
      healthCheckCron: '*/5 * * * *',
    },
    settings: {
      state: null,
      resources: null,
      urlTtlCap: null,
      purgeOnDelete: null,
      purgeBatchSize: null,
      stateChangedAt: null,
      stateChangedBy: null,
      version: 1,
      updatedAt: null,
    },
    effective: {
      serving: true,
      resources: ['fileVariant', 'imageAsset', 'galleryItem'],
      urlTtlCap: 86400,
      purgeOnDelete: true,
      purgeBatchSize: 100,
      clamped: { resources: [], urlTtlCap: false },
      issuedUrlsExpireAt: null,
    },
    lastCheck: cdnCheckFixture(),
    recentPurges: [],
    purgeTargets: ['fileVariant', 'imageAsset'],
    ...overrides,
  };
}

/** 這個部署沒有 CDN。 */
export function cdnNotDeployedFixture(): CdnOverview {
  const base = cdnOverviewFixture();
  return {
    ...base,
    deployment: {
      ...base.deployment,
      deployed: false,
      provider: null,
      origin: null,
      signingKid: null,
      kids: [],
      resources: [],
      purgeConfigured: false,
      healthCheckCron: null,
    },
    settings: null,
    effective: null,
    lastCheck: null,
    purgeTargets: [],
  };
}
