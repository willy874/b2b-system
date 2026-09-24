import { describe, expect, it, vi } from 'vitest';

import { runWithRequestContext } from '@/core/http';

import { DomainEvent } from '../domain-events';
import type { DomainEventPayloads } from '../domain-events';
import { DomainEventBus } from '../event-bus';

const revoked: DomainEventPayloads[typeof DomainEvent.SESSIONS_REVOKED] = {
  userIds: ['u1'],
  reason: 'AUTH_TOKEN_STALE',
};

describe('DomainEventBus', () => {
  it('依發佈順序處理：前一個事件的 handler await 完才輪到下一個', async () => {
    const bus = new DomainEventBus();
    const order: string[] = [];
    bus.subscribe(DomainEvent.PERMISSIONS_CHANGED, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      order.push('permissions');
    });
    bus.subscribe(DomainEvent.RESOURCE_CHANGED, () => {
      order.push('resource');
    });

    bus.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds: ['u1'] });
    bus.publish(DomainEvent.RESOURCE_CHANGED, { changes: [] });
    await bus.drain();

    expect(order).toEqual(['permissions', 'resource']);
  });

  it('publish 不等 handler：同步回傳時 handler 還沒執行', async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    bus.subscribe(DomainEvent.SESSIONS_REVOKED, handler);

    bus.publish(DomainEvent.SESSIONS_REVOKED, revoked);
    expect(handler).not.toHaveBeenCalled();
    await bus.drain();
    expect(handler).toHaveBeenCalledWith(revoked, expect.any(Object));
  });

  it('handler 拋錯被隔離：其他 handler 與後續事件照常處理，publish 不拋', async () => {
    const bus = new DomainEventBus();
    const after = vi.fn();
    const next = vi.fn();
    bus.subscribe(DomainEvent.SESSIONS_REVOKED, () => {
      throw new Error('boom');
    });
    bus.subscribe(DomainEvent.SESSIONS_REVOKED, after);
    bus.subscribe(DomainEvent.PERMISSIONS_CHANGED, next);

    expect(() => bus.publish(DomainEvent.SESSIONS_REVOKED, revoked)).not.toThrow();
    bus.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds: [] });
    await bus.drain();

    expect(after).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('metadata 在 publish 當下從請求 context 擷取', async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    bus.subscribe(DomainEvent.RESOURCE_CHANGED, handler);

    runWithRequestContext({ requestId: 'req-1', clientId: 'tab-1' }, () => {
      bus.publish(DomainEvent.RESOURCE_CHANGED, { changes: [] });
    });
    // context 結束後才處理，仍拿得到發佈當下的值
    await bus.drain();

    expect(handler).toHaveBeenCalledWith(
      { changes: [] },
      { occurredAt: expect.any(Date), requestId: 'req-1', clientId: 'tab-1' },
    );
  });

  it('沒有請求 context 時 metadata 只有 occurredAt', async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    bus.subscribe(DomainEvent.RESOURCE_CHANGED, handler);
    bus.publish(DomainEvent.RESOURCE_CHANGED, { changes: [] });
    await bus.drain();
    expect(handler.mock.calls[0]?.[1]).toMatchObject({ clientId: undefined, requestId: undefined });
  });

  it('unsubscribe 之後不再收到', async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe(DomainEvent.SESSIONS_REVOKED, handler);

    bus.publish(DomainEvent.SESSIONS_REVOKED, revoked);
    await bus.drain();
    unsubscribe();
    bus.publish(DomainEvent.SESSIONS_REVOKED, revoked);
    await bus.drain();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('drain 也等處理中衍生的新事件', async () => {
    const bus = new DomainEventBus();
    const nested = vi.fn();
    bus.subscribe(DomainEvent.PERMISSIONS_CHANGED, () => {
      bus.publish(DomainEvent.RESOURCE_CHANGED, { changes: [] });
    });
    bus.subscribe(DomainEvent.RESOURCE_CHANGED, nested);

    bus.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds: [] });
    await bus.drain();
    expect(nested).toHaveBeenCalledTimes(1);
  });
});
