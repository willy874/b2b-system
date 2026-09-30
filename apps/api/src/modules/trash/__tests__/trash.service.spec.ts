import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser, PermissionKey } from '@/common/types';
import type { PermissionSet } from '@/core/cache';
import type { Env } from '@/core/config';
import type { Database, Transaction } from '@/core/database';
import { AppException } from '@/core/errors';
import type { JobQueue } from '@/core/jobs';
import type { SettingService } from '@/core/settings';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { PermissionService } from '@/modules/permission/permission.service';

import { TRASH_PURGE_JOB, TrashPurgeJob } from '../trash-purge.job';
import { TRASH_PURGE_BATCH_SIZE } from '../trash.constants';
import { TrashRegistry } from '../trash.registry';
import { TrashService } from '../trash.service';
import type { ExpiredTrashItem, TrashHandler } from '../trash.types';

const ACTOR: AuthUser = { id: 'actor-1', email: 'actor@example.com', status: 'active' };
const NOW = new Date('2026-10-31T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** 交易與 savepoint 都直接執行 callback：這裡測的是流程，交易語意在 test/trash.spec.ts。 */
const tx = {
  transaction: <T>(work: (savepoint: Transaction) => Promise<T>) => work(tx as never),
} as unknown as Transaction;
const db = { transaction: <T>(work: (t: Transaction) => Promise<T>) => work(tx) };

function expired(id: string): ExpiredTrashItem {
  return { id, name: `${id}@example.com`, deletedAt: new Date(NOW.getTime() - 40 * DAY_MS) };
}

/** 只帶 feature 清單的租戶脈絡：TrashService 只讀 `features`。 */
function inTenant<T>(features: readonly TenantFeature[], fn: () => Promise<T>): Promise<T> {
  return runInTenantContext({ features } as unknown as TenantContext, fn);
}

function fakeHandler(overrides: Partial<TrashHandler> = {}): TrashHandler {
  return {
    type: 'user',
    permission: 'user:delete',
    purgeOrder: 30,
    listDeleted: vi.fn(async () => ({
      items: [
        {
          id: 'u-1',
          name: 'Alice',
          description: 'alice@example.com',
          deletedAt: new Date('2026-10-01T00:00:00.000Z'),
          deletedBy: null,
        },
      ],
      total: 1,
    })),
    findExpired: vi.fn(async () => []),
    purge: vi.fn(async () => true),
    afterPurge: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('TrashService（docs/architecture/backend/13-trash.md）', () => {
  let registry: TrashRegistry;
  let permissionSet: PermissionSet;
  let audit: { record: ReturnType<typeof vi.fn>; recordSafely: ReturnType<typeof vi.fn> };
  let service: TrashService;

  function grant(...keys: PermissionKey[]): void {
    permissionSet = { permissions: new Set(keys), isSuperAdmin: false };
  }

  beforeEach(() => {
    registry = new TrashRegistry();
    grant();
    audit = { record: vi.fn(async () => {}), recordSafely: vi.fn(async () => {}) };
    const permissions = {
      getPermissionSet: vi.fn(async () => permissionSet),
    } as unknown as PermissionService;
    const settings = { get: vi.fn(async () => 30) } as unknown as SettingService;
    service = new TrashService(
      db as unknown as Database,
      registry,
      permissions,
      settings,
      audit as unknown as AuditService,
    );
  });

  describe('list', () => {
    it('有該類型的 <resource>:delete → 列出，purgeAt = 刪除時間 + 保留天數', async () => {
      service.registerHandler(fakeHandler());
      grant('user:delete');
      const result = await service.list({ type: 'user', offset: 0, limit: 20 }, ACTOR);
      expect(result.pagination.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: 'u-1',
        type: 'user',
        deletedAt: '2026-10-01T00:00:00.000Z',
        purgeAt: '2026-10-31T00:00:00.000Z',
      });
    });

    it('沒有該類型的權限 → AUTHZ_FORBIDDEN，並寫 authz.denied 稽核', async () => {
      const handler = fakeHandler();
      service.registerHandler(handler);
      grant('user:read');
      const denied = service.list({ type: 'user', offset: 0, limit: 20 }, ACTOR);
      await expect(denied).rejects.toBeInstanceOf(AppException);
      await expect(denied).rejects.toMatchObject({
        code: 'AUTHZ_FORBIDDEN',
        details: { required: ['user:delete'] },
      });
      expect(audit.recordSafely).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'authz.denied', result: 'failure' }),
      );
      expect(handler.listDeleted).not.toHaveBeenCalled();
    });

    it('super-admin 不需要逐一持有', async () => {
      service.registerHandler(fakeHandler());
      permissionSet = { permissions: new Set(), isSuperAdmin: true };
      await expect(
        service.list({ type: 'user', offset: 0, limit: 20 }, ACTOR),
      ).resolves.toBeDefined();
    });
  });

  describe('list：租戶 feature（docs/architecture/backend/13-trash.md §3）', () => {
    it('handler 所屬的 feature 停用 → FEATURE_DISABLED，不檢查權限也不寫 authz.denied', async () => {
      const handler = fakeHandler({ type: 'file', permission: 'file:delete', feature: 'file' });
      service.registerHandler(handler);
      grant();
      const listing = inTenant(['auditLog', 'job'], () =>
        service.list({ type: 'file', offset: 0, limit: 20 }, ACTOR),
      );
      await expect(listing).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
      expect(audit.recordSafely).not.toHaveBeenCalled();
      expect(handler.listDeleted).not.toHaveBeenCalled();
    });

    it('feature 啟用時照常列出；沒有 feature 的類型不受影響', async () => {
      service.registerHandler(
        fakeHandler({ type: 'file', permission: 'file:delete', feature: 'file' }),
      );
      service.registerHandler(fakeHandler());
      grant('file:delete', 'user:delete');
      await expect(
        inTenant(['file'], () => service.list({ type: 'file', offset: 0, limit: 20 }, ACTOR)),
      ).resolves.toBeDefined();
      await expect(
        inTenant([], () => service.list({ type: 'user', offset: 0, limit: 20 }, ACTOR)),
      ).resolves.toBeDefined();
    });

    it('feature 停用時到期永久刪除照常進行（保留期限是資料的規則）', async () => {
      const handler = fakeHandler({
        type: 'file',
        permission: 'file:delete',
        feature: 'file',
        findExpired: vi.fn(async () => [expired('f')]),
      });
      service.registerHandler(handler);
      const report = await inTenant([], () => service.purgeExpired(NOW));
      expect(report.purged).toEqual({ file: 1 });
    });
  });

  describe('purgeExpired', () => {
    it('每一列寫 <resource>.purge 稽核（actor 為 null、metadata 帶保留天數），提交後呼叫 afterPurge', async () => {
      const handler = fakeHandler({
        findExpired: vi.fn(async () => [expired('a'), expired('b')]),
      });
      service.registerHandler(handler);

      const report = await service.purgeExpired(NOW);
      expect(report).toEqual({
        retentionDays: 30,
        cutoff: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
        purged: { user: 2 },
        skipped: {},
      });
      expect(audit.record).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.purge',
          resourceType: 'user',
          resourceId: 'a',
          actorId: null,
          actorEmail: 'system',
          metadata: expect.objectContaining({ retentionDays: 30 }),
        }),
        expect.anything(),
      );
      expect(handler.afterPurge).toHaveBeenCalledWith(['a', 'b']);
    });

    it('外鍵違反的列略過（不寫稽核），同一批其他列照常刪除', async () => {
      const fkViolation = Object.assign(new Error('fk'), { code: '23503' });
      const handler = fakeHandler({
        findExpired: vi.fn(async () => [expired('a'), expired('b')]),
        purge: vi.fn(async (item: ExpiredTrashItem) => {
          if (item.id === 'a') throw fkViolation;
          return true;
        }),
      });
      service.registerHandler(handler);

      const report = await service.purgeExpired(NOW);
      expect(report).toMatchObject({ purged: { user: 1 }, skipped: { user: 1 } });
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(handler.afterPurge).toHaveBeenCalledWith(['b']);
    });

    it('其他錯誤往外拋（讓背景工作重試）', async () => {
      service.registerHandler(
        fakeHandler({
          findExpired: vi.fn(async () => [expired('a')]),
          purge: vi.fn(async () => {
            throw new Error('connection lost');
          }),
        }),
      );
      await expect(service.purgeExpired(NOW)).rejects.toThrow('connection lost');
    });

    it('一批滿了就從最後一筆的 id 之後取下一批（keyset），不滿就停', async () => {
      const full = Array.from({ length: TRASH_PURGE_BATCH_SIZE }, (_, index) =>
        expired(`id-${String(index).padStart(3, '0')}`),
      );
      const findExpired = vi
        .fn<TrashHandler['findExpired']>()
        .mockResolvedValueOnce(full)
        .mockResolvedValueOnce([expired('id-999')]);
      service.registerHandler(fakeHandler({ findExpired }));

      const report = await service.purgeExpired(NOW);
      expect(report.purged).toEqual({ user: TRASH_PURGE_BATCH_SIZE + 1 });
      expect(findExpired).toHaveBeenCalledTimes(2);
      expect(findExpired.mock.calls[1]?.[1]).toBe(full.at(-1)?.id);
    });
  });
});

describe('TrashRegistry', () => {
  it('同一類型註冊兩次 → 啟動失敗', () => {
    const registry = new TrashRegistry();
    registry.register(fakeHandler());
    expect(() => registry.register(fakeHandler())).toThrow(/已經註冊過/);
  });

  it('權限不在 TRASH_PERMISSIONS（路由宣告不到）→ 啟動失敗', () => {
    const registry = new TrashRegistry();
    expect(() => registry.register(fakeHandler({ permission: 'user:read' }))).toThrow(
      /TRASH_PERMISSIONS/,
    );
  });

  it('TRASH_RESOURCE_TYPES 有類型沒有 handler → 啟動失敗', () => {
    expect(() => new TrashRegistry().onApplicationBootstrap()).toThrow(/user/);
  });

  it('inPurgeOrder 依 purgeOrder 由小到大', () => {
    const registry = new TrashRegistry();
    registry.register(fakeHandler({ type: 'role', permission: 'role:delete', purgeOrder: 40 }));
    registry.register(fakeHandler({ purgeOrder: 30 }));
    expect(registry.inPurgeOrder().map((handler) => handler.type)).toEqual(['user', 'role']);
  });
});

describe('TrashPurgeJob', () => {
  it('以 TRASH_PURGE_CRON 註冊成 tenant 範圍的排程工作', () => {
    const jobs = { register: vi.fn() };
    const config = { get: vi.fn(() => '30 4 * * *') };
    const job = new TrashPurgeJob(
      {} as TrashService,
      jobs as unknown as JobQueue,
      config as unknown as ConfigService<Env, true>,
    );
    job.onModuleInit();
    expect(TRASH_PURGE_JOB.options.scope).toBe('tenant');
    expect(jobs.register).toHaveBeenCalledWith(TRASH_PURGE_JOB, expect.any(Function), {
      cron: '30 4 * * *',
    });
  });
});
