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

/** 扮演一個程序：自己的 bus、廣播與轉送，已初始化並開始監聽。 */
async function processOn(hub: BroadcastHub, tenancy: Tenancy = fakeTenancy()) {
  const bus = new DomainEventBus();
  const broadcast = hub.instance();
  const relay = new DomainEventRelay(bus, broadcast, tenancy);
  relay.onModuleInit();
  await broadcast.onApplicationBootstrap();
  return { bus, relay };
}

/** 等兩邊的 bus 與廣播都處理完：A 的轉送 → 廣播 → B 的 bus。 */
async function settle(...buses: DomainEventBus[]): Promise<void> {
  await Promise.all(buses.map((bus) => bus.drain()));
  await flushBroadcast();
  await Promise.all(buses.map((bus) => bus.drain()));
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
});
