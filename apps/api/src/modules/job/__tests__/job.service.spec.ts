import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { JobQueue, JobQueueCounts, JobRecord, JobStore } from '@/core/jobs';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';
import type { AuditService } from '@/modules/audit-log/audit.service';

import { JobService } from '../job.service';

const ACTOR: AuthUser = { id: 'u-1', email: 'admin@example.com', status: 'active' };
const TENANT = {
  id: 't1',
  code: 'acme',
  features: [],
  featureParams: {},
} as unknown as TenantContext;

function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenantContext(TENANT, fn);
}

const DEFINITIONS = [
  { name: 'auditLog.archive', cron: '30 3 * * *', scope: 'tenant' as const },
  { name: 'auth.activationMail', cron: null, scope: 'tenant' as const },
  { name: 'jobs.outboxSweep', cron: '*/10 * * * *', scope: 'platform' as const },
];
const TENANT_NAMES = ['auditLog.archive', 'auth.activationMail'];

function record(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    name: 'auth.activationMail',
    tenantId: 't1',
    state: 'failed',
    data: { userId: 'u-2' },
    output: { message: 'smtp down' },
    retryCount: 5,
    retryLimit: 5,
    createdOn: new Date('2026-10-01T00:00:00.000Z'),
    startAfter: new Date('2026-10-01T00:00:00.000Z'),
    startedOn: new Date('2026-10-01T00:00:01.000Z'),
    completedOn: null,
    ...overrides,
  };
}

describe('JobService（docs/architecture/backend/10-jobs.md §6）', () => {
  let jobs: { definitions: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
  let store: {
    counts: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: JobService;

  beforeEach(() => {
    jobs = { definitions: vi.fn(() => DEFINITIONS), retry: vi.fn(async () => true) };
    store = {
      counts: vi.fn(async () => new Map<string, JobQueueCounts>()),
      list: vi.fn(async () => ({ items: [], total: 0 })),
      find: vi.fn(async () => record()),
    };
    audit = { record: vi.fn(async () => {}) };
    service = new JobService(
      jobs as unknown as JobQueue,
      store as unknown as JobStore,
      audit as unknown as AuditService,
    );
  });

  describe('queues', () => {
    it('只列出租戶範圍的工作，以目前租戶計數', async () => {
      const result = await inTenant(() => service.queues());
      expect(result.items.map((item) => item.name)).toEqual(TENANT_NAMES);
      expect(store.counts).toHaveBeenCalledWith('t1', TENANT_NAMES);
    });

    it('帶出排程與各狀態的筆數；沒有計數的佇列補 0', async () => {
      const counted: JobQueueCounts = {
        readyCount: 1,
        deferredCount: 2,
        activeCount: 3,
        failedCount: 4,
        completedCount: 5,
      };
      store.counts.mockResolvedValueOnce(new Map([['auditLog.archive', counted]]));
      const { items } = await inTenant(() => service.queues());
      expect(items).toEqual([
        { name: 'auditLog.archive', cron: '30 3 * * *', ...counted },
        {
          name: 'auth.activationMail',
          cron: null,
          readyCount: 0,
          deferredCount: 0,
          activeCount: 0,
          failedCount: 0,
          completedCount: 0,
        },
      ]);
    });

    it('沒有租戶脈絡 → TENANT_NOT_FOUND', async () => {
      await expect(service.queues()).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
    });
  });

  describe('list', () => {
    it('以目前租戶與租戶工作的名稱查詢，篩選條件原樣帶入', async () => {
      const query = {
        offset: 0,
        limit: 20,
        name: ['auditLog.archive'],
        state: ['failed' as const],
      };
      await inTenant(() => service.list(query));
      expect(store.list).toHaveBeenCalledWith({ tenantId: 't1', names: TENANT_NAMES, ...query });
    });

    it('回傳摘要（不含 data / output），時間轉成 ISO 字串，帶分頁', async () => {
      store.list.mockResolvedValueOnce({ items: [record()], total: 41 });
      const result = await inTenant(() => service.list({ offset: 20, limit: 20 }));
      expect(result.pagination).toEqual({ offset: 20, limit: 20, total: 41 });
      expect(result.items[0]).toEqual({
        id: 'job-1',
        name: 'auth.activationMail',
        state: 'failed',
        retryCount: 5,
        retryLimit: 5,
        createdOn: '2026-10-01T00:00:00.000Z',
        startAfter: '2026-10-01T00:00:00.000Z',
        startedOn: '2026-10-01T00:00:01.000Z',
        completedOn: null,
      });
    });
  });

  describe('findOne', () => {
    it('含 data 與 output（失敗原因）', async () => {
      const job = await inTenant(() => service.findOne('job-1'));
      expect(job).toMatchObject({ data: { userId: 'u-2' }, output: { message: 'smtp down' } });
      expect(store.find).toHaveBeenCalledWith('t1', TENANT_NAMES, 'job-1');
    });

    it('查無（不存在、已清除、別的租戶、平台工作）→ JOB_NOT_FOUND', async () => {
      store.find.mockResolvedValueOnce(undefined);
      await expect(inTenant(() => service.findOne('job-1'))).rejects.toMatchObject({
        code: 'JOB_NOT_FOUND',
      });
    });
  });

  describe('retry', () => {
    it('failed → 重新排入、寫 job.retry 稽核，回傳最新狀態', async () => {
      store.find.mockResolvedValueOnce(record()).mockResolvedValueOnce(record({ state: 'retry' }));
      const result = await inTenant(() => service.retry('job-1', ACTOR));
      expect(jobs.retry).toHaveBeenCalledWith('auth.activationMail', 'job-1');
      expect(audit.record).toHaveBeenCalledWith({
        action: 'job.retry',
        resourceType: 'job',
        resourceId: 'job-1',
        resourceName: 'auth.activationMail',
        actorId: 'u-1',
        actorEmail: 'admin@example.com',
        changes: { before: { state: 'failed' }, after: { state: 'retry' } },
      });
      expect(result.state).toBe('retry');
    });

    it.each(['created', 'retry', 'active', 'completed', 'cancelled'] as const)(
      '狀態是 %s → JOB_NOT_RETRYABLE，不重試也不寫稽核',
      async (state) => {
        store.find.mockResolvedValueOnce(record({ state }));
        await expect(inTenant(() => service.retry('job-1', ACTOR))).rejects.toMatchObject({
          code: 'JOB_NOT_RETRYABLE',
        });
        expect(jobs.retry).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      },
    );

    it('被別人搶先重試（pg-boss 沒有更新到）→ JOB_NOT_RETRYABLE，不寫稽核', async () => {
      jobs.retry.mockResolvedValueOnce(false);
      await expect(inTenant(() => service.retry('job-1', ACTOR))).rejects.toMatchObject({
        code: 'JOB_NOT_RETRYABLE',
      });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('查無 → JOB_NOT_FOUND', async () => {
      store.find.mockResolvedValueOnce(undefined);
      await expect(inTenant(() => service.retry('job-1', ACTOR))).rejects.toMatchObject({
        code: 'JOB_NOT_FOUND',
      });
      expect(jobs.retry).not.toHaveBeenCalled();
    });

    it('稽核寫入失敗 → 錯誤往外拋（不吞例外）', async () => {
      audit.record.mockRejectedValueOnce(new Error('audit down'));
      await expect(inTenant(() => service.retry('job-1', ACTOR))).rejects.toThrow('audit down');
    });
  });
});
