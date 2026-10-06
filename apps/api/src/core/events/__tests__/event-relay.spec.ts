import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { describe, expect, it, vi } from 'vitest';

import { runWithRequestContext } from '@/core/http';
import type { Tenancy } from '@/core/tenant/tenancy.service';
import { currentTenant, runInTenantContext } from '@/core/tenant/tenant-context';
import type { TenantContext } from '@/core/tenant/tenant-context';

import { BroadcastHub, flushBroadcast } from '../../broadcast/__tests__/broadcast-hub';
import { DomainEvent } from '../domain-events';
import type { DomainEventMeta } from '../domain-events';
import { DomainEventBus } from '../event-bus';
import { DOMAIN_EVENT_CHANNEL, DomainEventRelay } from '../event-relay';
import type { DomainEventRelayOptions } from '../event-relay';

function tenantContext(id: string): TenantContext {
  return { id } as unknown as TenantContext;
}

/** 停用的租戶 `Tenancy.run` 會拋錯（TENANT_UNAVAILABLE）。 */
function fakeTenancy(unavailable: readonly string[] = []): Tenancy {
  return {
    run: vi.fn(async (id: string, fn: () => Promise<unknown>) => {
      if (unavailable.includes(id)) throw new Error('TENANT_UNAVAILABLE');
      return runInTenantContext(tenantContext(id), fn);
    }),
  } as unknown as Tenancy;
}

const relays = new Map<DomainEventBus, DomainEventRelay>();

/** 扮演一個程序：自己的 bus、廣播與轉送，已初始化並開始監聽。 */
async function processOn(
  hub: BroadcastHub,
  tenancy: Tenancy = fakeTenancy(),
  options?: DomainEventRelayOptions,
) {
  const bus = new DomainEventBus();
  const broadcast = hub.instance();
  const relay = new DomainEventRelay(bus, broadcast, tenancy, options);
  relay.onModuleInit();
  await broadcast.onApplicationBootstrap();
  relays.set(bus, relay);
  return { bus, relay, broadcast };
}

/** 等兩邊的 bus、轉送的送出佇列與廣播都處理完：A 的轉送 → 廣播 → B 的 bus。 */
async function settle(...buses: DomainEventBus[]): Promise<void> {
  await Promise.all(buses.map((bus) => bus.drain()));
  await Promise.all(buses.map((bus) => relays.get(bus)?.idle()));
  await flushBroadcast();
  await Promise.all(buses.map((bus) => bus.drain()));
}

/** 測試用的 uuid：`prefix` 區分種類（使用者、通知），`index` 是序號。 */
function uuidOf(prefix: number, index: number): string {
  return `0000000${prefix}-0000-4000-8000-${`${index}`.padStart(12, '0')}`;
}

const fileCreated = {
  changes: [{ resource: ChangeSource.FILE, kind: ChangeKind.CREATE, id: 'f1' }],
};

describe('DomainEventRelay（docs/architecture/06-external-api.md §9.2 D18）', () => {
  it('A 程序發佈的資源變更，B 程序以 remote 訂閱的 handler 在同一個租戶脈絡裡收到', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [await processOn(hub), await processOn(hub)];
    const seen: Array<{ tenant?: string; meta: DomainEventMeta }> = [];
    b.bus.subscribe(
      DomainEvent.RESOURCE_CHANGED,
      (_payload, meta) => void seen.push({ tenant: currentTenant()?.id, meta }),
      { remote: true },
    );

    runInTenantContext(tenantContext('t1'), () =>
      runWithRequestContext({ requestId: 'req-1', clientId: 'tab-1' }, () =>
        a.bus.publish(DomainEvent.RESOURCE_CHANGED, fileCreated),
      ),
    );
    await settle(a.bus, b.bus);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.tenant).toBe('t1');
    // clientId 跟著過去：發起的分頁收到推播時略過
    expect(seen[0]?.meta).toMatchObject({ remote: true, clientId: 'tab-1', requestId: 'req-1' });
  });

  it('B 程序只收本機事件的 handler（寫資料庫的副作用）收不到', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [await processOn(hub), await processOn(hub)];
    const localOnly = vi.fn();
    b.bus.subscribe(DomainEvent.SESSIONS_REVOKED, localOnly);

    runInTenantContext(tenantContext('t1'), () =>
      a.bus.publish(DomainEvent.SESSIONS_REVOKED, { userIds: ['u1'], reason: 'AUTH_TOKEN_STALE' }),
    );
    await settle(a.bus, b.bus);

    expect(localOnly).not.toHaveBeenCalled();
  });

  it('發佈的程序自己不會再收到一次；收到的程序也不會再轉送出去', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [await processOn(hub), await processOn(hub)];
    const onA = vi.fn();
    a.bus.subscribe(DomainEvent.RESOURCE_CHANGED, onA, { remote: true });

    runInTenantContext(tenantContext('t1'), () =>
      a.bus.publish(DomainEvent.RESOURCE_CHANGED, fileCreated),
    );
    await settle(a.bus, b.bus);

    expect(onA).toHaveBeenCalledTimes(1);
    expect(hub.messages(DOMAIN_EVENT_CHANNEL)).toHaveLength(1);
  });

  it('平台層級（沒有租戶脈絡）的事件不進租戶，直接交給 bus', async () => {
    const tenancy = fakeTenancy();
    const hub = new BroadcastHub();
    const [a, b] = [await processOn(hub), await processOn(hub, tenancy)];
    const handler = vi.fn();
    b.bus.subscribe(DomainEvent.TENANT_FEATURES_CHANGED, handler, { remote: true });

    a.bus.publish(DomainEvent.TENANT_FEATURES_CHANGED, { tenantId: 't9' });
    await settle(a.bus, b.bus);

    expect(handler).toHaveBeenCalledWith({ tenantId: 't9' }, expect.anything());
    expect(tenancy.run).not.toHaveBeenCalled();
  });

  it('租戶已停用（進不去）：略過，不拋錯', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [await processOn(hub), await processOn(hub, fakeTenancy(['t1']))];
    const handler = vi.fn();
    b.bus.subscribe(DomainEvent.RESOURCE_CHANGED, handler, { remote: true });

    runInTenantContext(tenantContext('t1'), () =>
      a.bus.publish(DomainEvent.RESOURCE_CHANGED, fileCreated),
    );
    await settle(a.bus, b.bus);

    expect(handler).not.toHaveBeenCalled();
  });

  it('放不進一則廣播的資源變更：拿掉個別 id 退化成整個來源，受影響的人分批', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [await processOn(hub), await processOn(hub)];
    const received: unknown[] = [];
    b.bus.subscribe(DomainEvent.RESOURCE_CHANGED, (payload) => void received.push(payload), {
      remote: true,
    });
    const ids = Array.from(
      { length: 100 },
      (_, index) => `00000000-0000-4000-8000-${`${index}`.padStart(12, '0')}`,
    );
    const users = Array.from({ length: 200 }, (_, index) => `user-${`${index}`.padStart(31, '0')}`);

    runInTenantContext(tenantContext('t1'), () =>
      a.bus.publish(DomainEvent.RESOURCE_CHANGED, {
        changes: ids.map((id) => ({ resource: ChangeSource.FILE, kind: ChangeKind.UPDATE, id })),
        affectedUserIds: users,
      }),
    );
    await settle(a.bus, b.bus);

    expect(received).toEqual([
      {
        changes: [{ resource: ChangeSource.FILE, kind: ChangeKind.UPDATE }],
        affectedUserIds: users.slice(0, 150),
      },
      {
        changes: [{ resource: ChangeSource.FILE, kind: ChangeKind.UPDATE }],
        affectedUserIds: users.slice(150),
      },
    ]);
  });

  it('放得進一則廣播、但超過合約的 100 筆：轉送前退化成整個來源，接收端仍收得到', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [await processOn(hub), await processOn(hub)];
    const received: unknown[] = [];
    b.bus.subscribe(DomainEvent.RESOURCE_CHANGED, (payload) => void received.push(payload), {
      remote: true,
    });
    // 101 筆短 id 的變更約 4 KB：放得進一則 NOTIFY
    const changes = Array.from({ length: 101 }, (_, index) => ({
      resource: ChangeSource.FILE,
      kind: ChangeKind.UPDATE,
      id: `f${index}`,
    }));

    runInTenantContext(tenantContext('t1'), () =>
      a.bus.publish(DomainEvent.RESOURCE_CHANGED, { changes, affectedUserIds: ['u1'] }),
    );
    await settle(a.bus, b.bus);

    expect(hub.messages(DOMAIN_EVENT_CHANNEL)).toHaveLength(1);
    expect(received).toEqual([
      {
        changes: [{ resource: ChangeSource.FILE, kind: ChangeKind.UPDATE }],
        affectedUserIds: ['u1'],
      },
    ]);
  });

  it('perRecipient：放得進就原樣一則；500 人的對照拆成有上限的幾則，每個人仍只帶自己的 id（docs/architecture/backend/08-realtime.md §7.6）', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [await processOn(hub), await processOn(hub)];
    const received: Array<{ perRecipient?: Array<{ userId: string; changes: unknown[] }> }> = [];
    b.bus.subscribe(DomainEvent.RESOURCE_CHANGED, (payload) => void received.push(payload), {
      remote: true,
    });
    const perRecipient = Array.from({ length: 500 }, (_, index) => ({
      userId: uuidOf(1, index),
      changes: [
        { resource: ChangeSource.NOTIFICATION, kind: ChangeKind.CREATE, id: uuidOf(2, index) },
      ],
    }));

    runInTenantContext(tenantContext('t1'), () =>
      a.bus.publish(DomainEvent.RESOURCE_CHANGED, { changes: [], perRecipient }),
    );
    await settle(a.bus, b.bus);

    // 一個人約 130 位元組，一則 NOTIFY 放得下約 60 人：500 人是 9 則左右，不是 500 則
    const messages = hub.messages(DOMAIN_EVENT_CHANNEL);
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.length).toBeLessThanOrEqual(10);
    for (const [, payload] of hub.sent) expect(Buffer.byteLength(payload)).toBeLessThan(8000);
    const delivered = received.flatMap((payload) => payload.perRecipient ?? []);
    expect(delivered).toEqual(perRecipient);
  });

  it('一個人的變更自己就放不進一則：只有他的那一筆退化成不帶 id 的', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [await processOn(hub), await processOn(hub)];
    const received: Array<{ perRecipient?: unknown[] }> = [];
    b.bus.subscribe(DomainEvent.RESOURCE_CHANGED, (payload) => void received.push(payload), {
      remote: true,
    });
    const many = Array.from({ length: 100 }, (_, index) => ({
      resource: ChangeSource.NOTIFICATION,
      kind: ChangeKind.CREATE,
      id: `00000000-0000-4000-8000-${`${index}`.padStart(12, '0')}`,
    }));
    const small = [{ resource: ChangeSource.NOTIFICATION, kind: ChangeKind.CREATE, id: 'n-small' }];

    runInTenantContext(tenantContext('t1'), () =>
      a.bus.publish(DomainEvent.RESOURCE_CHANGED, {
        changes: [],
        perRecipient: [
          { userId: 'heavy', changes: many },
          { userId: 'light', changes: small },
        ],
      }),
    );
    await settle(a.bus, b.bus);

    expect(received.flatMap((payload) => payload.perRecipient ?? [])).toEqual([
      {
        userId: 'heavy',
        changes: [{ resource: ChangeSource.NOTIFICATION, kind: ChangeKind.CREATE }],
      },
      { userId: 'light', changes: small },
    ]);
  });

  it('轉送不讓 bus 的佇列等 NOTIFY：平台 DB 很慢時，同一個租戶的下一則事件照樣先處理', async () => {
    const hub = new BroadcastHub();
    const a = await processOn(hub);
    // 讓 NOTIFY 卡住，直到測試放行
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const notify = vi.spyOn(a.broadcast, 'publish').mockImplementation(() => blocked);
    const handled: string[] = [];
    a.bus.subscribe(DomainEvent.RESOURCE_CHANGED, ({ changes }) => {
      handled.push(changes[0]?.id ?? '');
    });

    runInTenantContext(tenantContext('t1'), () => {
      a.bus.publish(DomainEvent.RESOURCE_CHANGED, fileCreated);
      a.bus.publish(DomainEvent.RESOURCE_CHANGED, {
        changes: [{ resource: ChangeSource.FILE, kind: ChangeKind.CREATE, id: 'f2' }],
      });
    });
    await a.bus.drain();

    expect(handled).toEqual(['f1', 'f2']);
    // 同一條佇列依序送：第一則還沒送完，第二則還在排隊
    expect(notify).toHaveBeenCalledTimes(1);
    release?.();
    await a.relay.idle();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('只送不收（對外 API，EventsModule.sendOnly()）：照樣轉送出去，但不監聽、收不到別人轉送的', async () => {
    const hub = new BroadcastHub();
    const sender = await processOn(hub, fakeTenancy(), { receive: false });
    const receiver = await processOn(hub);
    const atSender = vi.fn();
    const atReceiver = vi.fn();
    sender.bus.subscribe(DomainEvent.RESOURCE_CHANGED, atSender, { remote: true });
    receiver.bus.subscribe(DomainEvent.RESOURCE_CHANGED, atReceiver, { remote: true });

    runInTenantContext(tenantContext('t1'), () =>
      sender.bus.publish(DomainEvent.RESOURCE_CHANGED, fileCreated),
    );
    runInTenantContext(tenantContext('t1'), () =>
      receiver.bus.publish(DomainEvent.RESOURCE_CHANGED, fileCreated),
    );
    await settle(sender.bus, receiver.bus);

    // 接收端收到送出端轉送的；送出端只有自己本機發佈的那一次
    expect(atReceiver).toHaveBeenCalledTimes(2);
    expect(atSender).toHaveBeenCalledTimes(1);
  });

  it('平台的變更放不進一則廣播：同樣退化成整個來源，收件人分批（docs/architecture/backend/08-realtime.md §3.6）', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [await processOn(hub), await processOn(hub)];
    const received: unknown[] = [];
    b.bus.subscribe(DomainEvent.PLATFORM_CHANGED, (payload) => void received.push(payload), {
      remote: true,
    });
    const ids = Array.from(
      { length: 100 },
      (_, index) => `00000000-0000-4000-8000-${`${index}`.padStart(12, '0')}`,
    );
    const admins = Array.from(
      { length: 200 },
      (_, index) => `admin-${`${index}`.padStart(30, '0')}`,
    );
    // 平台的事件沒有租戶脈絡
    a.bus.publish(DomainEvent.PLATFORM_CHANGED, {
      changes: ids.map((id) => ({
        resource: ChangeSource.PLATFORM_NOTIFICATION,
        kind: ChangeKind.CREATE,
        id,
      })),
      adminIds: admins,
    });
    await settle(a.bus, b.bus);

    const coarse = [{ resource: ChangeSource.PLATFORM_NOTIFICATION, kind: ChangeKind.CREATE }];
    expect(received).toEqual([
      { changes: coarse, adminIds: admins.slice(0, 150) },
      { changes: coarse, adminIds: admins.slice(150) },
    ]);
  });

  it('格式不對的訊息（不同版本）直接略過', async () => {
    const hub = new BroadcastHub();
    const b = await processOn(hub);
    const handler = vi.fn();
    b.bus.subscribe(DomainEvent.RESOURCE_CHANGED, handler, { remote: true });
    // 另一個程序送出未知格式的 payload
    const other = hub.instance();
    const publish = other.channel(DOMAIN_EVENT_CHANNEL, { parse: () => null, onMessage: vi.fn() });
    await other.onApplicationBootstrap();

    await publish({ type: 'resource.changed', tenant: null, payload: { changes: 'x' } });
    await settle(b.bus);

    expect(handler).not.toHaveBeenCalled();
  });

  it('撤銷連線的名單放不進一則廣播：每種名單各自分批，原因帶在每一則', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [await processOn(hub), await processOn(hub)];
    const received: unknown[] = [];
    b.bus.subscribe(DomainEvent.SESSIONS_REVOKED, (payload) => void received.push(payload), {
      remote: true,
    });
    const users = Array.from({ length: 250 }, (_, index) => `user-${`${index}`.padStart(31, '0')}`);
    const sessions = Array.from({ length: 20 }, (_, index) => `sid-${index}`);

    runInTenantContext(tenantContext('t1'), () =>
      a.bus.publish(DomainEvent.SESSIONS_REVOKED, {
        userIds: users,
        idpSessionUids: sessions,
        reason: 'AUTH_TOKEN_STALE',
      }),
    );
    await settle(a.bus, b.bus);

    expect(received).toEqual([
      { reason: 'AUTH_TOKEN_STALE', userIds: users.slice(0, 150) },
      { reason: 'AUTH_TOKEN_STALE', userIds: users.slice(150) },
      { reason: 'AUTH_TOKEN_STALE', idpSessionUids: sessions },
    ]);
  });

  it('放得進一則廣播的事件原樣送出一則', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [await processOn(hub), await processOn(hub)];
    a.bus.publish(DomainEvent.TENANT_FEATURES_CHANGED, { tenantId: 't9' });
    await settle(a.bus, b.bus);

    expect(hub.messages(DOMAIN_EVENT_CHANNEL)).toEqual([
      expect.objectContaining({
        type: DomainEvent.TENANT_FEATURES_CHANGED,
        tenant: null,
        payload: { tenantId: 't9' },
      }),
    ]);
  });

  it.each([
    ['permissions.changed（AuthzRevision 自己廣播）', DomainEvent.PERMISSIONS_CHANGED, {}],
    ['tenant.activated（寫資料庫，整個系統做一次）', DomainEvent.TENANT_ACTIVATED, {}],
  ] as const)('不轉送 %s', async (_name, type, payload) => {
    const hub = new BroadcastHub();
    const a = await processOn(hub);
    runInTenantContext(tenantContext('t1'), () => a.bus.publish(type, payload));
    await settle(a.bus);
    expect(hub.messages(DOMAIN_EVENT_CHANNEL)).toEqual([]);
  });

  it('信封正確但 payload 不符合該事件的格式 → 略過', async () => {
    const hub = new BroadcastHub();
    const b = await processOn(hub);
    const handler = vi.fn();
    b.bus.subscribe(DomainEvent.SESSIONS_REVOKED, handler, { remote: true });
    const other = hub.instance();
    const publish = other.channel(DOMAIN_EVENT_CHANNEL, { parse: () => null, onMessage: vi.fn() });
    await other.onApplicationBootstrap();

    await publish({
      type: DomainEvent.SESSIONS_REVOKED,
      tenant: null,
      payload: { userIds: ['u1'], reason: 'NOT_A_REASON' },
      occurredAt: new Date().toISOString(),
    });
    await settle(b.bus);

    expect(handler).not.toHaveBeenCalled();
  });

  it('onModuleDestroy 之後本機的事件不再轉送', async () => {
    const hub = new BroadcastHub();
    const a = await processOn(hub);
    a.relay.onModuleDestroy();

    runInTenantContext(tenantContext('t1'), () =>
      a.bus.publish(DomainEvent.RESOURCE_CHANGED, fileCreated),
    );
    await settle(a.bus);

    expect(hub.messages(DOMAIN_EVENT_CHANNEL)).toEqual([]);
  });
});
