import { describe, expect, it, vi } from 'vitest';

// perm room 帶租戶（docs/adr/0020-physical-tenant-isolation.md D17）：固定在租戶 t1
vi.mock('@/core/tenant', () => ({ requireTenant: () => ({ id: 't1' }) }));

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

function setup(openRooms: Record<string, number> = {}) {
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
  it('啟動時訂閱三個事件，關閉時全部取消', () => {
    const { listener, bus, unsubscribe } = setup();
    expect(bus.subscribe.mock.calls.map(([type]) => type).toSorted()).toEqual(
      [
        DomainEvent.PERMISSIONS_CHANGED,
        DomainEvent.RESOURCE_CHANGED,
        DomainEvent.SESSIONS_REVOKED,
      ].toSorted(),
    );
    listener.onModuleDestroy();
    expect(unsubscribe).toHaveBeenCalledTimes(3);
  });

  it('permissions.changed → 同步這些人的 room', async () => {
    const { fire, audience } = setup();
    await fire(DomainEvent.PERMISSIONS_CHANGED, { userIds: ['u1', 'u2'] });
    expect(audience.refreshAudience).toHaveBeenCalledWith(['u1', 'u2']);
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
      expect.arrayContaining(['t:t1:perm:role:read', 't:t1:perm:auditLog:read', 'user:u1']),
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
    const { fire, emits, disconnected } = setup({ 'user:u1': 2 });
    fire(DomainEvent.SESSIONS_REVOKED, { userIds: ['u1', 'u2'], reason: 'AUTH_ACCOUNT_DISABLED' });

    expect(emits).toEqual([
      { rooms: 'user:u1', event: 'session.revoked', payload: { reason: 'AUTH_ACCOUNT_DISABLED' } },
    ]);
    expect(disconnected).toEqual(['user:u1']);
  });

  it('單一登出只撤銷同一個 IdP session 的連線，不動同一個人的其他裝置（docs/adr/0019-sso-identity-platform.md D5）', () => {
    const { fire, emits, disconnected } = setup({ 'user:u1': 3, 'sid:s1': 1 });
    fire(DomainEvent.SESSIONS_REVOKED, { idpSessionUids: ['s1'], reason: 'AUTH_REFRESH_REVOKED' });

    expect(emits).toEqual([
      { rooms: 'sid:s1', event: 'session.revoked', payload: { reason: 'AUTH_REFRESH_REVOKED' } },
    ]);
    expect(disconnected).toEqual(['sid:s1']);
  });
});
