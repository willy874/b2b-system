import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import type { JobQueue, JobQueueCounts, JobRecord, JobStore } from '@/core/jobs';
import type { TenantDirectory, TenantRecord } from '@/core/tenant';
import type { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import { PlatformJobService } from '../platform-job.service';

const DEFINITIONS = [
  { name: 'auditLog.archive', cron: '30 3 * * *', scope: 'tenant' as const },
  { name: 'jobs.outboxSweep', cron: '*/10 * * * *', scope: 'platform' as const },
];
const NAMES = ['auditLog.archive', 'jobs.outboxSweep'];

const TENANTS: Record<string, Pick<TenantRecord, 'id' | 'code'>> = {
  t1: { id: 't1', code: 'acme' },
  t2: { id: 't2', code: 'globex' },
};

function record(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    name: 'auditLog.archive',
    tenantId: 't1',
    state: 'failed',
    data: {},
    output: { message: 'boom' },
    retryCount: 3,
    retryLimit: 3,
    createdOn: new Date('2026-10-01T00:00:00.000Z'),
    startAfter: new Date('2026-10-01T00:00:00.000Z'),
    startedOn: null,
    completedOn: null,
    ...overrides,
  };
}

describe('PlatformJobService（docs/architecture/backend/10-jobs.md §6、docs/architecture/05-tenancy.md §10.2 D23）', () => {
  let jobs: { definitions: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
  let store: {
    counts: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };
  let directory: { findByCode: ReturnType<typeof vi.fn>; findById: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let events: { publish: ReturnType<typeof vi.fn> };
  let service: PlatformJobService;

  beforeEach(() => {
    jobs = { definitions: vi.fn(() => DEFINITIONS), retry: vi.fn(async () => true) };
    store = {
      counts: vi.fn(async () => new Map<string, JobQueueCounts>()),
      list: vi.fn(async () => ({ items: [], total: 0 })),
      find: vi.fn(async () => record()),
    };
    directory = {
      findByCode: vi.fn(async (code: string) =>
        Object.values(TENANTS).find((tenant) => tenant.code === code),
      ),
      findById: vi.fn(async (id: string) => TENANTS[id]),
    };
    audit = { record: vi.fn(async () => {}) };
    events = { publish: vi.fn() };
    service = new PlatformJobService(
      jobs as unknown as JobQueue,
      store as unknown as JobStore,
      directory as unknown as TenantDirectory,
      audit as unknown as PlatformAuditService,
      events as unknown as DomainEventBus,
    );
  });

  describe('queues', () => {
    it('列出所有已註冊的工作（含平台工作與 scope），計數是所有租戶合計', async () => {
      const { items } = await service.queues();
      expect(store.counts).toHaveBeenCalledWith(undefined, NAMES);
      expect(items.map(({ name, scope, cron }) => ({ name, scope, cron }))).toEqual(DEFINITIONS);
      expect(items[0]).toMatchObject({ readyCount: 0, failedCount: 0, completedCount: 0 });
    });
  });

  describe('list：?tenant= 的擁有者篩選', () => {
    it('沒給 tenant → 看全部（tenantId undefined）', async () => {
      await service.list({ offset: 0, limit: 50 });
      expect(store.list).toHaveBeenCalledWith({
        tenantId: undefined,
        names: NAMES,
        offset: 0,
        limit: 50,
      });
    });

    it('tenant=platform（保留字）→ 只看平台工作（tenantId null），不查租戶目錄', async () => {
      await service.list({ offset: 0, limit: 50, tenant: 'platform' });
      expect(store.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null }));
      expect(directory.findByCode).not.toHaveBeenCalled();
    });

    it('tenant=<代碼> → 只看那個租戶', async () => {
      await service.list({ offset: 0, limit: 50, tenant: 'globex', state: 'failed' });
      expect(store.list).toHaveBeenCalledWith({
        tenantId: 't2',
        names: NAMES,
        offset: 0,
        limit: 50,
        state: 'failed',
      });
    });

    it('代碼不存在 → 空列表，不查詢工作表', async () => {
      const result = await service.list({ offset: 10, limit: 50, tenant: 'nope' });
      expect(result).toEqual({ items: [], pagination: { offset: 10, limit: 50, total: 0 } });
      expect(store.list).not.toHaveBeenCalled();
    });
  });

  describe('list：租戶代碼', () => {
    it('每筆帶 tenantId 與 tenantCode；平台工作兩者都是 null', async () => {
      store.list.mockResolvedValueOnce({
        items: [
          record({ id: 'a', tenantId: 't1' }),
          record({ id: 'b', tenantId: null, name: 'jobs.outboxSweep' }),
        ],
        total: 2,
      });
      const { items } = await service.list({ offset: 0, limit: 50 });
      expect(items.map(({ id, tenantId, tenantCode }) => ({ id, tenantId, tenantCode }))).toEqual([
        { id: 'a', tenantId: 't1', tenantCode: 'acme' },
        { id: 'b', tenantId: null, tenantCode: null },
      ]);
    });

    it('租戶已刪除（目錄找不到）→ 只有 tenantId，tenantCode 為 null', async () => {
      store.list.mockResolvedValueOnce({ items: [record({ tenantId: 'gone' })], total: 1 });
      const { items } = await service.list({ offset: 0, limit: 50 });
      expect(items[0]).toMatchObject({ tenantId: 'gone', tenantCode: null });
    });

    it('同一個租戶的多筆工作只查一次目錄', async () => {
      store.list.mockResolvedValueOnce({
        items: [record({ id: 'a' }), record({ id: 'b' }), record({ id: 'c', tenantId: 't2' })],
        total: 3,
      });
      await service.list({ offset: 0, limit: 50 });
      expect(directory.findById.mock.calls.map(([id]) => id).toSorted()).toEqual(['t1', 't2']);
    });
  });

  describe('findOne', () => {
    it('看得到任何租戶的工作，含 data、output 與租戶代碼', async () => {
      const job = await service.findOne('job-1');
      expect(store.find).toHaveBeenCalledWith(undefined, NAMES, 'job-1');
      expect(job).toMatchObject({ tenantCode: 'acme', data: {}, output: { message: 'boom' } });
    });

    it('查無 → JOB_NOT_FOUND', async () => {
      store.find.mockResolvedValueOnce(undefined);
      await expect(service.findOne('job-1')).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
    });
  });

  describe('retry', () => {
    it('failed → 重新排入、寫平台稽核 platformJob.retry、推播平台變更', async () => {
      await service.retry('job-1');
      expect(jobs.retry).toHaveBeenCalledWith('auditLog.archive', 'job-1');
      expect(audit.record).toHaveBeenCalledWith({
        action: 'platformJob.retry',
        resourceType: 'job',
        resourceId: 'job-1',
        metadata: { name: 'auditLog.archive', tenantId: 't1' },
      });
      expect(events.publish).toHaveBeenCalledWith(DomainEvent.PLATFORM_CHANGED, {
        changes: [{ resource: ChangeSource.PLATFORM_JOB, kind: ChangeKind.UPDATE, id: 'job-1' }],
      });
    });

    it('推播在稽核寫入之後', async () => {
      const order: string[] = [];
      audit.record.mockImplementationOnce(async () => {
        order.push('audit');
      });
      events.publish.mockImplementationOnce(() => order.push('publish'));
      await service.retry('job-1');
      expect(order).toEqual(['audit', 'publish']);
    });

    it.each(['created', 'retry', 'active', 'completed', 'cancelled'] as const)(
      '狀態是 %s → JOB_NOT_RETRYABLE，不重試、不寫稽核、不推播',
      async (state) => {
        store.find.mockResolvedValueOnce(record({ state }));
        await expect(service.retry('job-1')).rejects.toMatchObject({ code: 'JOB_NOT_RETRYABLE' });
        expect(jobs.retry).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
        expect(events.publish).not.toHaveBeenCalled();
      },
    );

    it('被別人搶先重試 → JOB_NOT_RETRYABLE，不寫稽核也不推播', async () => {
      jobs.retry.mockResolvedValueOnce(false);
      await expect(service.retry('job-1')).rejects.toMatchObject({ code: 'JOB_NOT_RETRYABLE' });
      expect(audit.record).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('查無 → JOB_NOT_FOUND', async () => {
      store.find.mockResolvedValueOnce(undefined);
      await expect(service.retry('job-1')).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
    });
  });
});
