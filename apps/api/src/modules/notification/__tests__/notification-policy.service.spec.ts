import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { BroadcastHub, flushBroadcast } from '@/core/broadcast/__tests__/broadcast-hub';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';
import type { AuditService } from '@/modules/audit-log/audit.service';

import { NotificationEventCatalog } from '../notification-event.catalog';
import type { NotificationPolicyRepository } from '../notification-policy.repository';
import { NotificationPolicyService } from '../notification-policy.service';
import type { NotificationPreferenceRepository } from '../notification-preference.repository';
import { defineNotification } from '../notification.definition';

const PENDING = defineNotification('sample.pending', { category: 'sample', channels: ['inApp'] });
const RESULT = defineNotification('sample.result', {
  category: 'sample',
  channels: ['inApp', 'email'],
});
const QUIET = defineNotification('sample.quiet', {
  category: 'sample',
  channels: ['inApp'],
  defaultEnabled: false,
});
const SECURITY = defineNotification('sample.security', {
  category: 'security',
  channels: ['inApp'],
  mandatory: true,
});
const FILE_EVENT = defineNotification('file.happened', {
  category: 'file',
  channels: ['inApp'],
  feature: 'file',
});

const ACTOR = { id: 'admin-1', email: 'admin@example.com' } as AuthUser;
const UPDATED_AT = new Date('2026-10-01T00:00:00Z');

interface StoredRow {
  type: string;
  channel: string;
  enabled: boolean | null;
  allowUserOverride?: boolean;
}

function setup(
  rows: StoredRow[] = [],
  hub: BroadcastHub = new BroadcastHub(),
  optedOut: string[] = [],
) {
  const repo = {
    listAll: vi.fn(async () =>
      rows.map((row) => ({
        allowUserOverride: true,
        ...row,
        updatedAt: UPDATED_AT,
        updatedBy: null,
      })),
    ),
    upsert: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  const preferences = {
    findOptedOut: vi.fn(async (_type: string, _channel: string, ids: readonly string[]) =>
      ids.filter((id) => optedOut.includes(id)),
    ),
  };
  const catalog = new NotificationEventCatalog();
  catalog.register([PENDING, RESULT, QUIET, SECURITY, FILE_EVENT]);
  const audit = { record: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  // withTransaction(db, fn) 只呼叫 db.transaction(fn)
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const broadcast = hub.instance();
  const service = new NotificationPolicyService(
    db as unknown as Database,
    repo as unknown as NotificationPolicyRepository,
    preferences as unknown as NotificationPreferenceRepository,
    catalog,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
    broadcast,
  );
  return { service, repo, preferences, audit, events, broadcast };
}

function inTenant<T>(features: readonly TenantFeature[], fn: () => T): T {
  return runInTenantContext({ id: 't1', features } as unknown as TenantContext, fn);
}

async function errorOf(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('NotificationEventCatalog（docs/architecture/backend/16-notification-event.md §9.2 D2）', () => {
  it('重複登記同一個類型 → 啟動就失敗', () => {
    const catalog = new NotificationEventCatalog();
    catalog.register([PENDING]);
    expect(() => catalog.register([PENDING])).toThrow(/重複登記/);
  });

  it('沒有登記的類型 → get 拋錯，find 回 undefined', () => {
    const catalog = new NotificationEventCatalog();
    expect(() => catalog.get('sample.pending')).toThrow(/沒有登記/);
    expect(catalog.find('sample.pending')).toBeUndefined();
  });
});

describe('NotificationPolicyService.isEnabled（docs/architecture/backend/16-notification-event.md §3）', () => {
  it('沒有覆寫 → 事件的 defaultEnabled', async () => {
    const { service } = setup();
    expect(await service.isEnabled('sample.pending', 'inApp')).toBe(true);
    expect(await service.isEnabled('sample.quiet', 'inApp')).toBe(false);
  });

  it('有覆寫 → 覆寫值，管道各自獨立', async () => {
    const { service } = setup([{ type: 'sample.result', channel: 'email', enabled: false }]);
    expect(await service.isEnabled('sample.result', 'email')).toBe(false);
    expect(await service.isEnabled('sample.result', 'inApp')).toBe(true);
  });

  it('mandatory → 一律送出，殘留的覆寫值不生效（D4）', async () => {
    const { service } = setup([{ type: 'sample.security', channel: 'inApp', enabled: false }]);
    expect(await service.isEnabled('sample.security', 'inApp')).toBe(true);
  });

  it('沒有登記的類型、不支援的管道 → 拋錯（呼叫端的程式錯誤）', async () => {
    const { service } = setup();
    await expect(service.isEnabled('sample.unknown', 'inApp')).rejects.toThrow(/沒有登記/);
    await expect(service.isEnabled('sample.pending', 'email')).rejects.toThrow(/不支援管道/);
  });

  it('覆寫值整份快取：連續查詢只讀一次；傳入的 tx 用在重讀；invalidate 後重讀', async () => {
    const { service, repo } = setup();
    await service.isEnabled('sample.pending', 'inApp', 'tx' as never);
    await service.isEnabled('sample.result', 'email');
    expect(repo.listAll).toHaveBeenCalledTimes(1);
    expect(repo.listAll).toHaveBeenCalledWith('tx');
    service.invalidate();
    await service.isEnabled('sample.pending', 'inApp');
    expect(repo.listAll).toHaveBeenCalledTimes(2);
  });

  it('一個程序 invalidate，其他程序同一個租戶的快取也作廢（docs/architecture/01-system.md §4.4）', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [setup([], hub), setup([], hub)];
    for (const { service, broadcast } of [a, b]) {
      service.onModuleInit();
      // oxlint-disable-next-line no-await-in-loop -- 依序啟動兩個程序
      await broadcast.onApplicationBootstrap();
    }
    await inTenant([], () => b.service.isEnabled('sample.pending', 'inApp'));
    await runInTenantContext({ id: 't2', features: [] } as unknown as TenantContext, () =>
      b.service.isEnabled('sample.pending', 'inApp'),
    );

    await inTenant([], async () => a.service.invalidate());
    await flushBroadcast();

    await inTenant([], () => b.service.isEnabled('sample.pending', 'inApp'));
    await runInTenantContext({ id: 't2', features: [] } as unknown as TenantContext, () =>
      b.service.isEnabled('sample.pending', 'inApp'),
    );
    // t1 重新查一次；t2 仍命中
    expect(b.repo.listAll).toHaveBeenCalledTimes(3);
  });

  it('查詢期間被 invalidate()：回來的舊值不寫回快取，下一次重新查 DB', async () => {
    const { service, repo } = setup();
    let resolveStale: ((rows: unknown[]) => void) | undefined;
    repo.listAll.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve as (rows: unknown[]) => void;
        }) as never,
    );
    const loading = service.isEnabled(PENDING.type, 'inApp');
    // 修改的交易提交 → invalidate()；之後才回來的是修改前的值（開著）
    service.invalidate();
    resolveStale?.([]);
    await expect(loading).resolves.toBe(true);

    repo.listAll.mockResolvedValueOnce([
      {
        type: PENDING.type,
        channel: 'inApp',
        enabled: false,
        allowUserOverride: true,
        updatedAt: UPDATED_AT,
        updatedBy: null,
      },
    ] as never);
    await expect(service.isEnabled(PENDING.type, 'inApp')).resolves.toBe(false);
    expect(repo.listAll).toHaveBeenCalledTimes(2);
  });

  it('快取以租戶區分', async () => {
    const { service, repo } = setup();
    await inTenant([], () => service.isEnabled('sample.pending', 'inApp'));
    await runInTenantContext({ id: 't2', features: [] } as unknown as TenantContext, () =>
      service.isEnabled('sample.pending', 'inApp'),
    );
    expect(repo.listAll).toHaveBeenCalledTimes(2);
  });
});

describe('NotificationPolicyService.filterRecipients（docs/architecture/backend/16-notification-event.md §9.2 D14）', () => {
  const ALICE = 'alice';
  const BOB = 'bob';

  it('租戶開啟且允許個人調整 → 排除自己關掉的人，保留順序；一次查完', async () => {
    const { service, preferences } = setup([], new BroadcastHub(), [ALICE]);
    expect(
      await service.filterRecipients('sample.pending', 'inApp', [BOB, ALICE], 'tx' as never),
    ).toEqual([BOB]);
    expect(preferences.findOptedOut).toHaveBeenCalledTimes(1);
    expect(preferences.findOptedOut).toHaveBeenCalledWith(
      'sample.pending',
      'inApp',
      [BOB, ALICE],
      'tx',
    );
  });

  it('租戶關閉 → 誰都不送，不查個人設定', async () => {
    const { service, preferences } = setup(
      [{ type: 'sample.pending', channel: 'inApp', enabled: false }],
      new BroadcastHub(),
      [ALICE],
    );
    expect(await service.filterRecipients('sample.pending', 'inApp', [ALICE, BOB])).toEqual([]);
    expect(preferences.findOptedOut).not.toHaveBeenCalled();
  });

  it('租戶不允許個人調整、mandatory → 全部都送，關掉的人也收到', async () => {
    const { service, preferences } = setup(
      [{ type: 'sample.pending', channel: 'inApp', enabled: null, allowUserOverride: false }],
      new BroadcastHub(),
      [ALICE],
    );
    expect(await service.filterRecipients('sample.pending', 'inApp', [ALICE, BOB])).toEqual([
      ALICE,
      BOB,
    ]);
    expect(await service.filterRecipients('sample.security', 'inApp', [ALICE])).toEqual([ALICE]);
    expect(preferences.findOptedOut).not.toHaveBeenCalled();
  });

  it('沒有收件人 → 仍檢查類型有沒有登記', async () => {
    const { service } = setup();
    expect(await service.filterRecipients('sample.pending', 'inApp', [])).toEqual([]);
    await expect(service.filterRecipients('sample.unknown', 'inApp', [])).rejects.toThrow(
      /沒有登記/,
    );
  });
});

describe('NotificationPolicyService.list（docs/architecture/backend/16-notification-event.md §9.2 D9、D11）', () => {
  it('每個事件帶分類、mandatory 與每個管道的生效值、預設值、是否覆寫', async () => {
    const { service } = setup([{ type: 'sample.result', channel: 'email', enabled: false }]);
    const { items } = await inTenant(['file'], () => service.list());
    expect(items.map((item) => item.type)).toEqual([
      'sample.pending',
      'sample.result',
      'sample.quiet',
      'sample.security',
      'file.happened',
    ]);
    expect(items[1]).toEqual({
      type: 'sample.result',
      category: 'sample',
      mandatory: false,
      channels: [
        {
          channel: 'inApp',
          enabled: true,
          defaultEnabled: true,
          isOverridden: false,
          allowUserOverride: true,
          updatedAt: null,
        },
        {
          channel: 'email',
          enabled: false,
          defaultEnabled: true,
          isOverridden: true,
          allowUserOverride: true,
          updatedAt: UPDATED_AT.toISOString(),
        },
      ],
    });
  });

  it('mandatory 的殘留覆寫值不顯示成已覆寫', async () => {
    const { service } = setup([{ type: 'sample.security', channel: 'inApp', enabled: false }]);
    const { items } = await service.list();
    expect(items.find((item) => item.type === 'sample.security')?.channels[0]).toMatchObject({
      enabled: true,
      isOverridden: false,
      allowUserOverride: false,
    });
  });

  it('只覆寫了「允許個人調整」→ enabled 跟著預設、不算已覆寫，但 updatedAt 有值', async () => {
    const { service } = setup([
      { type: 'sample.pending', channel: 'inApp', enabled: null, allowUserOverride: false },
    ]);
    const { items } = await service.list();
    expect(items[0]?.channels[0]).toEqual({
      channel: 'inApp',
      enabled: true,
      defaultEnabled: true,
      isOverridden: false,
      allowUserOverride: false,
      updatedAt: UPDATED_AT.toISOString(),
    });
  });

  it('所屬 feature 沒有啟用 → 不列出', async () => {
    const { service } = setup();
    const { items } = await inTenant([], () => service.list());
    expect(items.map((item) => item.type)).not.toContain('file.happened');
  });
});

describe('NotificationPolicyService.update（docs/architecture/backend/16-notification-event.md §9.2 D9）', () => {
  it('寫入覆寫值與還原預設在同一個交易、一筆稽核；提交後失效快取並推給每個事件一則', async () => {
    const { service, repo, audit, events } = setup([
      { type: 'sample.result', channel: 'email', enabled: false },
    ]);
    await service.list(); // 先讀進快取
    repo.listAll.mockClear();

    await service.update(
      {
        changes: [
          { type: 'sample.pending', channel: 'inApp', enabled: false },
          { type: 'sample.result', channel: 'email', enabled: null },
          { type: 'sample.result', channel: 'inApp', enabled: false },
        ],
      },
      ACTOR,
    );

    const closed = { enabled: false, allowUserOverride: true };
    expect(repo.upsert).toHaveBeenCalledWith('sample.pending', 'inApp', closed, 'admin-1', 'tx');
    expect(repo.upsert).toHaveBeenCalledWith('sample.result', 'inApp', closed, 'admin-1', 'tx');
    expect(repo.remove).toHaveBeenCalledWith('sample.result', 'email', 'tx');
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      {
        action: 'notificationPolicy.update',
        resourceType: 'notificationPolicy',
        resourceName: 'sample.pending:inApp, sample.result:email, sample.result:inApp',
        changes: {
          before: {
            'sample.pending:inApp': { enabled: true, allowUserOverride: true },
            'sample.result:email': { enabled: false, allowUserOverride: true },
            'sample.result:inApp': { enabled: true, allowUserOverride: true },
          },
          after: {
            'sample.pending:inApp': { enabled: false, allowUserOverride: true },
            'sample.result:email': { enabled: true, allowUserOverride: true },
            'sample.result:inApp': { enabled: false, allowUserOverride: true },
          },
        },
      },
      'tx',
    );
    expect(events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [
        { resource: 'notificationPolicy', kind: 'update', id: 'sample.pending' },
        { resource: 'notificationPolicy', kind: 'update', id: 'sample.result' },
      ],
    });
    // 回傳的列表重新讀過（快取已失效）
    expect(repo.listAll).toHaveBeenCalledTimes(1);
  });

  it('允許個人調整：只改那一欄；enabled 與預設相同時存成 null；兩欄都回到預設就刪列（docs/architecture/backend/16-notification-event.md §9.2 D15）', async () => {
    const { service, repo, audit } = setup([
      { type: 'sample.result', channel: 'email', enabled: false },
      { type: 'sample.result', channel: 'inApp', enabled: null, allowUserOverride: false },
    ]);
    await service.update(
      {
        changes: [
          { type: 'sample.pending', channel: 'inApp', allowUserOverride: false },
          // 覆寫成與預設相同 → 不存值，但「不允許個人調整」還在
          { type: 'sample.result', channel: 'email', enabled: true, allowUserOverride: false },
          { type: 'sample.result', channel: 'inApp', allowUserOverride: true },
        ],
      },
      ACTOR,
    );
    expect(repo.upsert).toHaveBeenCalledWith(
      'sample.pending',
      'inApp',
      { enabled: null, allowUserOverride: false },
      'admin-1',
      'tx',
    );
    expect(repo.upsert).toHaveBeenCalledWith(
      'sample.result',
      'email',
      { enabled: null, allowUserOverride: false },
      'admin-1',
      'tx',
    );
    expect(repo.remove).toHaveBeenCalledWith('sample.result', 'inApp', 'tx');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          after: expect.objectContaining({
            'sample.pending:inApp': { enabled: true, allowUserOverride: false },
          }),
        }),
      }),
      'tx',
    );
  });

  it('與生效值相同、還原沒有覆寫的 → 略過；全部都沒變就不寫稽核、不推播', async () => {
    const { service, repo, audit, events } = setup();
    await service.update(
      {
        changes: [
          { type: 'sample.pending', channel: 'inApp', enabled: true },
          { type: 'sample.quiet', channel: 'inApp', enabled: false },
          { type: 'sample.result', channel: 'email', enabled: null },
          { type: 'sample.result', channel: 'inApp', allowUserOverride: true },
        ],
      },
      ACTOR,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('沒有登記的事件、不支援的管道、feature 沒有啟用 → NOTIFICATION_EVENT_NOT_FOUND，什麼都不寫', async () => {
    const { service, repo } = setup();
    for (const change of [
      { type: 'sample.unknown', channel: 'inApp' as const, enabled: false },
      { type: 'sample.pending', channel: 'email' as const, enabled: false },
      { type: 'file.happened', channel: 'inApp' as const, enabled: false },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- 逐一斷言每一種拒絕
      const error = await errorOf(
        inTenant([], () =>
          service.update(
            { changes: [{ type: 'sample.pending', channel: 'inApp', enabled: false }, change] },
            ACTOR,
          ),
        ),
      );
      expect(error.code).toBe('NOTIFICATION_EVENT_NOT_FOUND');
      expect(error.details).toEqual({ type: change.type, channel: change.channel });
    }
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('mandatory 的事件 → NOTIFICATION_EVENT_MANDATORY（D4）', async () => {
    const { service, repo } = setup();
    const error = await errorOf(
      service.update(
        { changes: [{ type: 'sample.security', channel: 'inApp', enabled: false }] },
        ACTOR,
      ),
    );
    expect(error.code).toBe('NOTIFICATION_EVENT_MANDATORY');
    expect(error.details).toEqual({ type: 'sample.security' });
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});

describe('NotificationPolicyService 快取的重新連線（docs/architecture/01-system.md §4.4）', () => {
  it('監聽連線斷線重接 → 清掉所有租戶的快取（斷線期間可能漏掉失效訊息）', async () => {
    const hub = new BroadcastHub();
    const { service, repo, broadcast } = setup([], hub);
    service.onModuleInit();
    await broadcast.onApplicationBootstrap();
    await inTenant([], () => service.isEnabled('sample.pending', 'inApp'));
    await inTenant([], () => service.isEnabled('sample.pending', 'inApp'));
    expect(repo.listAll).toHaveBeenCalledTimes(1);

    hub.reconnect();
    await flushBroadcast();

    await inTenant([], () => service.isEnabled('sample.pending', 'inApp'));
    expect(repo.listAll).toHaveBeenCalledTimes(2);
  });
});
