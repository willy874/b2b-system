import { describe, expect, it, vi } from 'vitest';

// perm room 帶租戶（docs/architecture/05-tenancy.md §10.2 D17）：固定在租戶 t1
vi.mock('@/core/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/tenant')>()),
  requireTenant: () => ({ id: 't1' }),
}));

// 讓個別案例可以把受眾換成空集合；其餘案例走真實的對照表
vi.mock('../realtime.audience', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../realtime.audience')>();
  return { ...actual, resolveAudienceRooms: vi.fn(actual.resolveAudienceRooms) };
});

import { DomainEvent } from '@/core/events';
import type { DomainEventBus, DomainEventMeta } from '@/core/events';

import * as audienceModule from '../realtime.audience';
import type { RealtimeAudience } from '../realtime.audience';
import { RealtimeListener } from '../realtime.listener';
import { RealtimePublisher } from '../realtime.publisher';

type Handler = (payload: unknown, meta: DomainEventMeta) => unknown;

function setup(openRooms: Record<string, number> = {}, usersInRoom: Record<string, string[]> = {}) {
  const handlers = new Map<string, Handler>();
  const unsubscribe = vi.fn();
  const bus = {
    subscribe: vi.fn((type: string, handler: Handler) => {
      handlers.set(type, handler);
      return unsubscribe;
    }),
  };

  const emits: Array<{ rooms: string | readonly string[]; event: string; payload: unknown }> = [];
  const disconnected: string[] = [];
  const publisher = new (class extends RealtimePublisher {
    emit(rooms: string | readonly string[], event: string, payload?: unknown): void {
      emits.push({ rooms, event, payload });
    }
    countConnections(room: string): number {
      return openRooms[room] ?? 0;
    }
    connectedUserIds(room: string): string[] {
      return usersInRoom[room] ?? [];
    }
    moveRooms(): void {}
    disconnect(room: string): void {
      disconnected.push(room);
    }
  })();
  const audience = { refreshAudience: vi.fn().mockResolvedValue(undefined) };

  const listener = new RealtimeListener(
    bus as unknown as DomainEventBus,
    publisher,
    audience as unknown as RealtimeAudience,
  );
  listener.onModuleInit();

  const fire = (type: string, payload: unknown, meta: Partial<DomainEventMeta> = {}) =>
    handlers.get(type)?.(payload, { occurredAt: new Date(), ...meta });

  return { listener, fire, emits, disconnected, audience, unsubscribe, bus };
}

describe('RealtimeListener（領域事件 → 推播）', () => {
  it('啟動時訂閱五個事件，關閉時全部取消', () => {
    const { listener, bus, unsubscribe } = setup();
    expect(bus.subscribe.mock.calls.map(([type]) => type).toSorted()).toEqual(
      [
        DomainEvent.PERMISSIONS_CHANGED,
        DomainEvent.RESOURCE_CHANGED,
        DomainEvent.SESSIONS_REVOKED,
        DomainEvent.TENANT_FEATURES_CHANGED,
        DomainEvent.PLATFORM_CHANGED,
      ].toSorted(),
    );
    listener.onModuleDestroy();
    expect(unsubscribe).toHaveBeenCalledTimes(5);
  });

  it('permissions.changed → 這個租戶在本機的所有連線重算 room，不看事件帶的名單', async () => {
    const { fire, audience } = setup({}, { 't:t1': ['u1', 'u2', 'u3'] });
    await fire(DomainEvent.PERMISSIONS_CHANGED, { userIds: ['u1'] });
    expect(audience.refreshAudience).toHaveBeenCalledWith(['u1', 'u2', 'u3']);
  });

  it('resource.changed → 推到受眾 room，origin 取自 meta.clientId', () => {
    const { fire, emits } = setup();
    const changes = [{ resource: 'rolePermission', kind: 'update', id: 'r1' }];
    fire(DomainEvent.RESOURCE_CHANGED, { changes, affectedUserIds: ['u1'] }, { clientId: 'tab-1' });

    expect(emits).toHaveLength(1);
    expect(emits[0]).toMatchObject({
      event: 'resource.changed',
      payload: { changes, origin: 'tab-1' },
    });
    expect(emits[0]?.rooms).toEqual(
      expect.arrayContaining(['t:t1:perm:role:read', 't:t1:perm:auditLog:read', 't:t1:user:u1']),
    );
  });

  it('resource.changed 算不出任何受眾時不推', () => {
    const { fire, emits } = setup();
    vi.mocked(audienceModule.resolveAudienceRooms).mockReturnValueOnce([]);
    fire(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: 'userCredential', kind: 'update', id: 'u1' }],
    });
    expect(emits).toEqual([]);
  });

  it('resource.changed 沒有 clientId 時不帶 origin', () => {
    const { fire, emits } = setup();
    fire(DomainEvent.RESOURCE_CHANGED, { changes: [{ resource: 'role', kind: 'create' }] });
    expect(emits[0]?.payload).toEqual({ changes: [{ resource: 'role', kind: 'create' }] });
  });

  it('sessions.revoked → 先推 session.revoked 再斷線；沒有連線的人略過', () => {
    const { fire, emits, disconnected } = setup({ 't:t1:user:u1': 2 });
    fire(DomainEvent.SESSIONS_REVOKED, { userIds: ['u1', 'u2'], reason: 'AUTH_ACCOUNT_DISABLED' });

    expect(emits).toEqual([
      {
        rooms: 't:t1:user:u1',
        event: 'session.revoked',
        payload: { reason: 'AUTH_ACCOUNT_DISABLED' },
      },
    ]);
    expect(disconnected).toEqual(['t:t1:user:u1']);
  });

  it('單一登出只撤銷同一個 IdP session 的連線，不動同一個人的其他裝置（docs/architecture/04-sso.md §12.2 D5）', () => {
    const { fire, emits, disconnected } = setup({ 't:t1:user:u1': 3, 'sid:s1': 1 });
    fire(DomainEvent.SESSIONS_REVOKED, { idpSessionUids: ['s1'], reason: 'AUTH_REFRESH_REVOKED' });

    expect(emits).toEqual([
      { rooms: 'sid:s1', event: 'session.revoked', payload: { reason: 'AUTH_REFRESH_REVOKED' } },
    ]);
    expect(disconnected).toEqual(['sid:s1']);
  });

  it('租戶停用 → 撤銷整個租戶的連線（docs/architecture/05-tenancy.md §10.2 D13）', () => {
    const { fire, emits, disconnected } = setup({ 't:t2': 5 });
    fire(DomainEvent.SESSIONS_REVOKED, { tenantIds: ['t2'], reason: 'TENANT_UNAVAILABLE' });

    expect(emits).toEqual([
      { rooms: 't:t2', event: 'session.revoked', payload: { reason: 'TENANT_UNAVAILABLE' } },
    ]);
    expect(disconnected).toEqual(['t:t2']);
  });

  it('租戶的 feature 變更 → 對整個租戶的 room 推 tenantFeature update，不帶 origin（docs/architecture/frontend/02-plugin-system.md §9.2 D8）', () => {
    const { fire, emits, disconnected } = setup({ 't:t2': 2 });
    fire(DomainEvent.TENANT_FEATURES_CHANGED, { tenantId: 't2' }, { clientId: 'platform-tab' });

    expect(emits).toEqual([
      {
        rooms: 't:t2',
        event: 'resource.changed',
        payload: { changes: [{ resource: 'tenantFeature', kind: 'update' }] },
      },
    ]);
    expect(disconnected).toEqual([]);
  });

  it('平台的變更 → 推給所有平台管理者的連線，origin 取自 meta.clientId（docs/architecture/backend/08-realtime.md §3.6）', () => {
    const { fire, emits } = setup();
    fire(
      DomainEvent.PLATFORM_CHANGED,
      { changes: [{ resource: 'platformTenant', kind: 'update', id: 'x' }] },
      { clientId: 'tab-1' },
    );

    expect(emits).toEqual([
      {
        rooms: ['platform'],
        event: 'resource.changed',
        payload: {
          changes: [{ resource: 'platformTenant', kind: 'update', id: 'x' }],
          origin: 'tab-1',
        },
      },
    ]);
  });

  it('平台的變更指定收件人 → 只推給那些平台管理者（站內通知）', () => {
    const { fire, emits } = setup();
    fire(DomainEvent.PLATFORM_CHANGED, {
      changes: [{ resource: 'platformNotification', kind: 'create' }],
      adminIds: ['a1', 'a2', 'a1'],
    });

    expect(emits[0]?.rooms).toEqual(['platform:admin:a1', 'platform:admin:a2']);
  });

  it('平台管理者停用 → 撤銷他在 apps/platform 上的連線', () => {
    const { fire, emits, disconnected } = setup({ 'platform:admin:a1': 1 });
    fire(DomainEvent.SESSIONS_REVOKED, {
      platformAdminIds: ['a1'],
      reason: 'AUTH_ACCOUNT_DISABLED',
    });

    expect(emits).toEqual([
      {
        rooms: 'platform:admin:a1',
        event: 'session.revoked',
        payload: { reason: 'AUTH_ACCOUNT_DISABLED' },
      },
    ]);
    expect(disconnected).toEqual(['platform:admin:a1']);
  });
});
