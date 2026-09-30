import type { PlatformJobQueue, PlatformJobSummary } from '@/shared/api-sdk';

/** 頁面測試共用的工作。預設是某個租戶底下已失敗的工作。 */
export function jobFixture(overrides: Partial<PlatformJobSummary> = {}): PlatformJobSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'file.maintenance',
    state: 'failed',
    retryCount: 2,
    retryLimit: 2,
    createdOn: '2026-09-29T10:00:00.000Z',
    startAfter: '2026-09-29T10:00:00.000Z',
    startedOn: '2026-09-29T10:00:01.000Z',
    completedOn: '2026-09-29T10:00:02.000Z',
    tenantId: '44444444-4444-4444-8444-444444444444',
    tenantCode: 'acme',
    ...overrides,
  };
}

export function jobQueueFixture(overrides: Partial<PlatformJobQueue> = {}): PlatformJobQueue {
  return {
    name: 'file.maintenance',
    cron: '0 3 * * *',
    scope: 'tenant',
    readyCount: 0,
    deferredCount: 1,
    activeCount: 0,
    failedCount: 1,
    completedCount: 12,
    ...overrides,
  };
}
