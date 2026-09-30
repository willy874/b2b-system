import { describe, expect, it, vi } from 'vitest';

import type { BroadcastService, BroadcastSubscriber } from '../../broadcast';
import type { PermissionCacheService } from '../../cache';
import { DomainEvent } from '../../events';
import type { DomainEventBus } from '../../events';
import type { Tenancy, TenantContext } from '../../tenant';
import { runInTenantContext } from '../../tenant/tenant-context';
import type { AuthzRepository } from '../authz.repository';
import { AUTHZ_REVISION_CHANNEL, AuthzRevision } from '../authz.revision';

function setup(revision = 7) {
  let subscriber: BroadcastSubscriber | undefined;
  const broadcast = {
    subscribe: vi.fn((_channel: string, s: BroadcastSubscriber) => {
      subscriber = s;
    }),
    publish: vi.fn(async () => undefined),
  };
  const cache = { invalidateTenant: vi.fn(), invalidateAll: vi.fn() };
  const events = { publish: vi.fn() };
  const repo = { currentRevision: vi.fn(async () => revision) };
  const tenancy = {
    run: vi.fn(async (id: string, fn: () => Promise<void>) =>
      runInTenantContext({ id } as unknown as TenantContext, fn),
    ),
  };
  const service = new AuthzRevision(
    repo as unknown as AuthzRepository,
    cache as unknown as PermissionCacheService,
    broadcast as unknown as BroadcastService,
    events as unknown as DomainEventBus,
    tenancy as unknown as Tenancy,
  );
  service.onModuleInit();
  const receive = (tenant: string, rev: number) =>
    subscriber!.onMessage(JSON.stringify({ tenant, revision: rev }));
  return {
    service,
    broadcast,
    cache,
    events,
    repo,
    tenancy,
    receive,
    subscriber: () => subscriber!,
  };
}

const inTenant = <T>(id: string, fn: () => T): T =>
  runInTenantContext({ id } as unknown as TenantContext, fn);

describe('AuthzRevision（docs/adr/0024-relationship-based-access-control.md D7、D8）', () => {
  it('changed：本機失效整個租戶、發 permissions.changed，再廣播 { tenant, revision }', async () => {
    const { service, cache, events, broadcast } = setup(7);
    await inTenant('t1', () => service.changed(['u1']));

    expect(cache.invalidateTenant).toHaveBeenCalledWith('t1');
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.PERMISSIONS_CHANGED, {
      userIds: ['u1'],
    });
    expect(broadcast.publish).toHaveBeenCalledWith(
      AUTHZ_REVISION_CHANNEL,
      JSON.stringify({ tenant: 't1', revision: 7 }),
    );
  });

  it('自己送出的廣播繞回來時略過', async () => {
    const { service, cache, receive } = setup(7);
    await inTenant('t1', () => service.changed());
    cache.invalidateTenant.mockClear();

    await receive('t1', 7);
    expect(cache.invalidateTenant).not.toHaveBeenCalled();
  });

  it('其他程序的較新 revision：失效那個租戶，並在它的脈絡裡發 permissions.changed（不帶名單）', async () => {
    const { cache, events, tenancy, receive } = setup();
    await receive('t2', 3);

    expect(cache.invalidateTenant).toHaveBeenCalledWith('t2');
    expect(tenancy.run).toHaveBeenCalledWith('t2', expect.any(Function));
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.PERMISSIONS_CHANGED, {});
  });

  it('同一個或更舊的 revision 只處理一次（亂序晚到的已被較新的涵蓋）', async () => {
    const { cache, receive } = setup();
    await receive('t2', 5);
    await receive('t2', 5);
    await receive('t2', 4);
    expect(cache.invalidateTenant).toHaveBeenCalledTimes(1);
    // 不同租戶各自計
    await receive('t3', 1);
    expect(cache.invalidateTenant).toHaveBeenCalledTimes(2);
  });

  it('格式不對的訊息略過', async () => {
    const { cache, subscriber } = setup();
    await subscriber().onMessage('not json');
    await subscriber().onMessage(JSON.stringify({ tenant: 1 }));
    expect(cache.invalidateTenant).not.toHaveBeenCalled();
  });

  it('租戶進不去（停用、維護中）：快取仍失效，不拋錯', async () => {
    const { cache, tenancy, receive } = setup();
    tenancy.run.mockRejectedValueOnce(new Error('TENANT_UNAVAILABLE'));
    await expect(receive('t2', 9)).resolves.toBeUndefined();
    expect(cache.invalidateTenant).toHaveBeenCalledWith('t2');
  });

  it('監聽連線重連（中間可能漏了）：整個權限快取丟掉', async () => {
    const { cache, subscriber } = setup();
    await subscriber().onReconnect?.();
    expect(cache.invalidateAll).toHaveBeenCalled();
  });

  it('讀不到 revision 時本機仍已失效，只是不廣播', async () => {
    const { service, cache, broadcast, repo } = setup();
    repo.currentRevision.mockRejectedValueOnce(new Error('boom'));
    await inTenant('t1', () => service.changed());
    expect(cache.invalidateTenant).toHaveBeenCalledWith('t1');
    expect(broadcast.publish).not.toHaveBeenCalled();
  });
});
