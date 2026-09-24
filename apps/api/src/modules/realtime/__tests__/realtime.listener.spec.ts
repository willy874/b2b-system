import { describe, expect, it, vi } from 'vitest';

// 讓個別案例可以把受眾換成空集合；其餘案例走真實的對照表
vi.mock('../realtime.audience', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../realtime.audience')>();
  return { ...actual, resolveAudienceRooms: vi.fn(actual.resolveAudienceRooms) };
});

import { DomainEvent } from '@/core/events';
import type { DomainEventBus, DomainEventMeta } from '@/core/events';

import * as audienceModule from '../realtime.audience';
import type { RealtimeAudience } from '../realtime.audience';
import type { RealtimeGateway } from '../realtime.gateway';
import { RealtimeListener } from '../realtime.listener';

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

  const emits: Array<{ rooms: string | string[]; event: string; payload: unknown }> = [];
  const disconnected: string[] = [];
  const io = {
    sockets: {
      adapter: { rooms: new Map(Object.entries(openRooms).map(([r, n]) => [r, { size: n }])) },
    },
    to: (rooms: string | string[]) => ({
      emit: (event: string, payload: unknown) => emits.push({ rooms, event, payload }),
    }),
    in: (room: string) => ({ disconnectSockets: () => disconnected.push(room) }),
  };
  const audience = { refreshAudience: vi.fn().mockResolvedValue(undefined) };

  const listener = new RealtimeListener(
    bus as unknown as DomainEventBus,
    { server: io } as unknown as RealtimeGateway,
    audience as unknown as RealtimeAudience,
  );
  listener.onModuleInit();

  const fire = (type: string, payload: unknown, meta: Partial<DomainEventMeta> = {}) =>
    handlers.get(type)?.(payload, { occurredAt: new Date(), ...meta });

  return { listener, fire, emits, disconnected, audience, io, unsubscribe, bus };
}

describe('RealtimeListener（領域事件 → Socket.io）', () => {
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
    const { fire, audience, io } = setup();
    await fire(DomainEvent.PERMISSIONS_CHANGED, { userIds: ['u1', 'u2'] });
    expect(audience.refreshAudience).toHaveBeenCalledWith(io, ['u1', 'u2']);
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
      expect.arrayContaining(['perm:role:read', 'perm:auditLog:read', 'user:u1']),
    );
  });

  it('resource.changed 算不出任何受眾時不推（to([]) 會廣播給所有連線）', () => {
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

  it('gateway 尚未初始化（沒有 server）時什麼都不做', async () => {
    const handlers = new Map<string, Handler>();
    const listener = new RealtimeListener(
      {
        subscribe: (type: string, handler: Handler) => {
          handlers.set(type, handler);
          return () => {};
        },
      } as unknown as DomainEventBus,
      {} as RealtimeGateway,
      { refreshAudience: vi.fn() } as unknown as RealtimeAudience,
    );
    listener.onModuleInit();
    const meta = { occurredAt: new Date() };
    await expect(
      handlers.get(DomainEvent.PERMISSIONS_CHANGED)?.({ userIds: ['u1'] }, meta),
    ).resolves.toBeUndefined();
    expect(() =>
      handlers.get(DomainEvent.RESOURCE_CHANGED)?.(
        { changes: [{ resource: 'role', kind: 'create' }] },
        meta,
      ),
    ).not.toThrow();
  });
});
