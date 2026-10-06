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
import { createPermissionChecks } from '@/modules/permission/__tests__/permission-checks.fixture';

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
    const { service: permissions } = createPermissionChecks(() => permissionSet, audit);
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

/** 保留天數可調的 TrashService；回傳的 audit 與 settings 讓測試觀察。 */
function buildService(options: { retentionDays?: number; permissions?: PermissionSet } = {}) {
  const registry = new TrashRegistry();
  const audit = { record: vi.fn(async () => {}), recordSafely: vi.fn(async () => {}) };
  const { service: permissionService } = createPermissionChecks(
    () => options.permissions ?? { permissions: new Set<PermissionKey>(), isSuperAdmin: false },
    audit,
  );
  const settings = { get: vi.fn(async () => options.retentionDays ?? 30) };
  const service = new TrashService(
    db as unknown as Database,
    registry,
    permissionService,
    settings as unknown as SettingService,
    audit as unknown as AuditService,
  );
  return { service, audit, settings };
}

describe('TrashService.list：補充（docs/architecture/backend/13-trash.md、14-revisions.md §9.2 D10）', () => {
  const allowed = { permissions: new Set<PermissionKey>(['user:delete']), isSuperAdmin: false };

  it('沒註冊的類型 → 拋錯（DTO 的 enum 與註冊一致，只會是程式錯誤）', async () => {
    const { service } = buildService({ permissions: allowed });
    await expect(service.list({ type: 'role', offset: 0, limit: 20 }, ACTOR)).rejects.toThrow(
      /沒有註冊 handler/,
    );
  });

  it('查詢條件（分頁、關鍵字）原樣交給 handler', async () => {
    const { service } = buildService({ permissions: allowed });
    const handler = fakeHandler();
    service.registerHandler(handler);
    const query = { type: 'user' as const, offset: 20, limit: 10, keyword: 'ali' };
    await service.list(query, ACTOR);
    expect(handler.listDeleted).toHaveBeenCalledWith(query);
  });

  it('purgeAt 依目前的保留天數設定計算；刪除者原樣帶出', async () => {
    const { service } = buildService({ permissions: allowed, retentionDays: 7 });
    service.registerHandler(
      fakeHandler({
        listDeleted: vi.fn(async () => ({
          items: [
            {
              id: 'u-1',
              name: 'Alice',
              description: null,
              deletedAt: new Date('2026-10-01T00:00:00.000Z'),
              deletedBy: { id: 'u-9', name: 'Bob' },
            },
          ],
          total: 1,
        })),
      }),
    );
    const { items } = await service.list({ type: 'user', offset: 0, limit: 20 }, ACTOR);
    expect(items[0]).toEqual({
      id: 'u-1',
      type: 'user',
      name: 'Alice',
      description: null,
      deletedAt: '2026-10-01T00:00:00.000Z',
      deletedBy: { id: 'u-9', name: 'Bob' },
      purgeAt: '2026-10-08T00:00:00.000Z',
    });
  });

  it('拒絕時的 authz.denied 稽核帶路由、類型、所需與缺少的權限', async () => {
    const { service, audit } = buildService();
    service.registerHandler(fakeHandler());
    await expect(service.list({ type: 'user', offset: 0, limit: 20 }, ACTOR)).rejects.toThrow();
    expect(audit.recordSafely).toHaveBeenCalledWith({
      action: 'authz.denied',
      result: 'failure',
      actorId: 'actor-1',
      actorEmail: 'actor@example.com',
      resourceType: 'authz',
      errorCode: 'AUTHZ_FORBIDDEN',
      metadata: {
        route: 'GET /trash',
        type: 'user',
        required: ['user:delete'],
        missing: ['user:delete'],
      },
    });
  });

  it('沒有租戶脈絡（例：腳本）→ 不判斷 feature，照權限列出', async () => {
    const { service } = buildService({
      permissions: { permissions: new Set<PermissionKey>(['file:delete']), isSuperAdmin: false },
    });
    service.registerHandler(
      fakeHandler({ type: 'file', permission: 'file:delete', feature: 'file' }),
    );
    await expect(
      service.list({ type: 'file', offset: 0, limit: 20 }, ACTOR),
    ).resolves.toMatchObject({ pagination: { total: 1 } });
  });
});

describe('TrashService.purgeExpired：補充（docs/architecture/backend/14-revisions.md §9.2 D11）', () => {
  it('沒有到期的列 → 報告為空、不開交易、不呼叫 afterPurge；第一批從頭取（afterId 為 null）', async () => {
    const { service, audit } = buildService();
    const handler = fakeHandler();
    service.registerHandler(handler);
    const report = await service.purgeExpired(NOW);
    expect(report).toMatchObject({ purged: {}, skipped: {} });
    expect(handler.findExpired).toHaveBeenCalledExactlyOnceWith(
      new Date(NOW.getTime() - 30 * DAY_MS),
      null,
      TRASH_PURGE_BATCH_SIZE,
    );
    expect(handler.afterPurge).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('截止時間依保留天數設定計算', async () => {
    const { service } = buildService({ retentionDays: 1 });
    const handler = fakeHandler();
    service.registerHandler(handler);
    const report = await service.purgeExpired(NOW);
    expect(report.retentionDays).toBe(1);
    expect(report.cutoff).toBe('2026-10-30T00:00:00.000Z');
    expect(handler.findExpired).toHaveBeenCalledWith(
      new Date(report.cutoff),
      null,
      expect.any(Number),
    );
  });

  it('handler.purge 回傳 false（已不在、已被還原）→ 算略過、不寫稽核', async () => {
    const { service, audit } = buildService();
    const handler = fakeHandler({
      findExpired: vi.fn(async () => [expired('a'), expired('b')]),
      purge: vi.fn(async (item: ExpiredTrashItem) => item.id === 'b'),
    });
    service.registerHandler(handler);
    const report = await service.purgeExpired(NOW);
    expect(report).toMatchObject({ purged: { user: 1 }, skipped: { user: 1 } });
    expect(audit.record).toHaveBeenCalledOnce();
    expect(handler.afterPurge).toHaveBeenCalledWith(['b']);
  });

  it('一批全部略過 → 不呼叫 afterPurge，報告只有 skipped', async () => {
    const { service } = buildService();
    const handler = fakeHandler({
      findExpired: vi.fn(async () => [expired('a')]),
      purge: vi.fn(async () => false),
    });
    service.registerHandler(handler);
    const report = await service.purgeExpired(NOW);
    expect(report).toMatchObject({ purged: {}, skipped: { user: 1 } });
    expect(handler.afterPurge).not.toHaveBeenCalled();
  });

  it('稽核帶 resourceName 與原本的刪除時間，寫在同一個 savepoint', async () => {
    const { service, audit } = buildService();
    const item = expired('a');
    service.registerHandler(fakeHandler({ findExpired: vi.fn(async () => [item]) }));
    await service.purgeExpired(NOW);
    expect(audit.record).toHaveBeenCalledWith(
      {
        action: 'user.purge',
        resourceType: 'user',
        resourceId: 'a',
        resourceName: 'a@example.com',
        actorId: null,
        actorEmail: 'system',
        metadata: { retentionDays: 30, deletedAt: item.deletedAt.toISOString() },
      },
      tx,
    );
  });

  it('稽核寫入失敗（非外鍵錯誤）→ 往外拋，不呼叫 afterPurge（刪除與稽核同生共死）', async () => {
    const { service, audit } = buildService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    const handler = fakeHandler({ findExpired: vi.fn(async () => [expired('a')]) });
    service.registerHandler(handler);
    await expect(service.purgeExpired(NOW)).rejects.toThrow('audit down');
    expect(handler.afterPurge).not.toHaveBeenCalled();
  });

  it('多種類型依 purgeOrder 逐類處理（檔案先於使用者），報告分類計數', async () => {
    const { service } = buildService();
    const order: string[] = [];
    const track = (type: string, items: ExpiredTrashItem[]) =>
      vi.fn(async () => {
        order.push(type);
        return items;
      });
    service.registerHandler(
      fakeHandler({ purgeOrder: 30, findExpired: track('user', [expired('u')]) }),
    );
    service.registerHandler(
      fakeHandler({
        type: 'file',
        permission: 'file:delete',
        purgeOrder: 10,
        findExpired: track('file', [expired('f1'), expired('f2')]),
      }),
    );
    service.registerHandler(
      fakeHandler({
        type: 'role',
        permission: 'role:delete',
        purgeOrder: 40,
        findExpired: track('role', []),
      }),
    );
    const report = await service.purgeExpired(NOW);
    expect(order).toEqual(['file', 'user', 'role']);
    expect(report.purged).toEqual({ file: 2, user: 1 });
  });

  it('一批剛好滿而下一批是空的 → 取兩次後停止', async () => {
    const { service } = buildService();
    const full = Array.from({ length: TRASH_PURGE_BATCH_SIZE }, (_, index) =>
      expired(`id-${index}`),
    );
    const findExpired = vi
      .fn<TrashHandler['findExpired']>()
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([]);
    const handler = fakeHandler({ findExpired });
    service.registerHandler(handler);
    const report = await service.purgeExpired(NOW);
    expect(findExpired).toHaveBeenCalledTimes(2);
    expect(report.purged).toEqual({ user: TRASH_PURGE_BATCH_SIZE });
    expect(handler.afterPurge).toHaveBeenCalledOnce();
  });

  it('每一批提交後各呼叫一次 afterPurge，帶那一批刪掉的 id', async () => {
    const { service } = buildService();
    const full = Array.from({ length: TRASH_PURGE_BATCH_SIZE }, (_, index) =>
      expired(`id-${index}`),
    );
    const handler = fakeHandler({
      findExpired: vi
        .fn<TrashHandler['findExpired']>()
        .mockResolvedValueOnce(full)
        .mockResolvedValueOnce([expired('last')]),
    });
    service.registerHandler(handler);
    await service.purgeExpired(NOW);
    expect(handler.afterPurge).toHaveBeenCalledTimes(2);
    expect(handler.afterPurge).toHaveBeenLastCalledWith(['last']);
  });
});

describe('TrashPurgeJob.run', () => {
  it('執行 TrashService.purgeExpired 並回傳報告（存成工作的 output）', async () => {
    const report = { retentionDays: 30, cutoff: NOW.toISOString(), purged: {}, skipped: {} };
    const purgeExpired = vi.fn(async () => report);
    const job = new TrashPurgeJob(
      { purgeExpired } as unknown as TrashService,
      { register: vi.fn() } as unknown as JobQueue,
      { get: vi.fn() } as unknown as ConfigService<Env, true>,
    );
    await expect(job.run()).resolves.toBe(report);
  });

  it('註冊的 handler 就是 run（排程觸發時執行永久刪除）', async () => {
    const purgeExpired = vi.fn(async () => ({}));
    const register = vi.fn();
    new TrashPurgeJob(
      { purgeExpired } as unknown as TrashService,
      { register } as unknown as JobQueue,
      { get: vi.fn(() => '') } as unknown as ConfigService<Env, true>,
    ).onModuleInit();
    const registered = register.mock.calls[0]?.[1] as () => Promise<unknown>;
    await registered();
    expect(purgeExpired).toHaveBeenCalledOnce();
  });

  it('TRASH_PURGE_JOB 是 exclusive（同一個租戶同時只跑一個）', () => {
    expect(TRASH_PURGE_JOB.options.exclusive).toBe(true);
  });
});
