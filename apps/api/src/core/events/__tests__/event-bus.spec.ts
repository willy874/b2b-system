import { describe, expect, it, vi } from 'vitest';

import { runWithRequestContext } from '@/core/http';
import { currentTenant, runInTenantContext } from '@/core/tenant/tenant-context';
import type { TenantContext } from '@/core/tenant/tenant-context';

import { DomainEvent } from '../domain-events';
import type { DomainEventPayloads } from '../domain-events';
import { DomainEventBus } from '../event-bus';

const revoked: DomainEventPayloads[typeof DomainEvent.SESSIONS_REVOKED] = {
  userIds: ['u1'],
  reason: 'AUTH_TOKEN_STALE',
};

function inTenant(id: string, fn: () => void): void {
  const context = {
    id,
    code: id,
    db: {},
    storageBucket: id,
    features: ['file', 'auditLog', 'job'],
    flags: {},
    featureParams: {},
  };
  runInTenantContext(context as unknown as TenantContext, fn);
}

/** 由測試決定何時放行的 promise：模擬被 DB 查詢卡住的 handler。 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

  describe('依租戶分開排隊', () => {
    it('一個租戶的 handler 卡住時，其他租戶的事件照常處理', async () => {
      const bus = new DomainEventBus();
      const gate = deferred();
      const otherTenantDone = deferred();
      bus.subscribe(DomainEvent.PERMISSIONS_CHANGED, () => gate.promise);
      bus.subscribe(DomainEvent.RESOURCE_CHANGED, () => otherTenantDone.resolve());

      inTenant('a', () => bus.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds: ['u1'] }));
      inTenant('b', () => bus.publish(DomainEvent.RESOURCE_CHANGED, { changes: [] }));

      // 租戶 a 還卡著，租戶 b 的事件已經處理完（否則這裡會逾時）
      await otherTenantDone.promise;
      gate.resolve();
      await bus.drain();
    });

    it('同一個租戶內仍依發佈順序處理', async () => {
      const bus = new DomainEventBus();
      const order: string[] = [];
      bus.subscribe(DomainEvent.PERMISSIONS_CHANGED, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        order.push('permissions');
      });
      bus.subscribe(DomainEvent.RESOURCE_CHANGED, () => {
        order.push('resource');
      });

      inTenant('a', () => {
        bus.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds: ['u1'] });
        bus.publish(DomainEvent.RESOURCE_CHANGED, { changes: [] });
      });
      await bus.drain();

      expect(order).toEqual(['permissions', 'resource']);
    });

    it('sessions.revoked 走優先通道：不排在同租戶卡住的事件之後', async () => {
      const bus = new DomainEventBus();
      const gate = deferred();
      const revokedDone = deferred();
      bus.subscribe(DomainEvent.PERMISSIONS_CHANGED, () => gate.promise);
      bus.subscribe(DomainEvent.SESSIONS_REVOKED, () => revokedDone.resolve());

      inTenant('a', () => {
        bus.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds: ['u1'] });
        bus.publish(DomainEvent.SESSIONS_REVOKED, revoked);
      });

      await revokedDone.promise;
      gate.resolve();
      await bus.drain();
    });

    it('handler 在發佈當下的租戶脈絡裡執行', async () => {
      const bus = new DomainEventBus();
      const seen: Array<string | undefined> = [];
      bus.subscribe(DomainEvent.RESOURCE_CHANGED, () => {
        seen.push(currentTenant()?.id);
      });

      inTenant('a', () => bus.publish(DomainEvent.RESOURCE_CHANGED, { changes: [] }));
      inTenant('b', () => bus.publish(DomainEvent.RESOURCE_CHANGED, { changes: [] }));
      bus.publish(DomainEvent.RESOURCE_CHANGED, { changes: [] });
      await bus.drain();

      expect(seen.toSorted()).toEqual(['a', 'b', undefined].toSorted());
    });

    it('drain 等所有租戶的佇列都處理完', async () => {
      const bus = new DomainEventBus();
      const handled: string[] = [];
      bus.subscribe(DomainEvent.RESOURCE_CHANGED, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        handled.push(currentTenant()?.id ?? '-');
      });

      inTenant('a', () => bus.publish(DomainEvent.RESOURCE_CHANGED, { changes: [] }));
      inTenant('b', () => bus.publish(DomainEvent.RESOURCE_CHANGED, { changes: [] }));
      await bus.drain();

      expect(handled.toSorted()).toEqual(['a', 'b']);
    });
  });

  describe('其他程序轉送來的事件（docs/architecture/06-external-api.md §9.2 D18）', () => {
    it('只交給以 { remote: true } 訂閱的 handler，meta 標上 remote', async () => {
      const bus = new DomainEventBus();
      const localOnly = vi.fn();
      const withRemote = vi.fn();
      bus.subscribe(DomainEvent.SESSIONS_REVOKED, localOnly);
      bus.subscribe(DomainEvent.SESSIONS_REVOKED, withRemote, { remote: true });

      bus.deliverRemote(DomainEvent.SESSIONS_REVOKED, revoked, { occurredAt: new Date() });
      await bus.drain();

      expect(localOnly).not.toHaveBeenCalled();
      expect(withRemote).toHaveBeenCalledWith(revoked, expect.objectContaining({ remote: true }));
    });

    it('本機發佈的事件兩種 handler 都收到', async () => {
      const bus = new DomainEventBus();
      const localOnly = vi.fn();
      const withRemote = vi.fn();
      bus.subscribe(DomainEvent.SESSIONS_REVOKED, localOnly);
      bus.subscribe(DomainEvent.SESSIONS_REVOKED, withRemote, { remote: true });

      bus.publish(DomainEvent.SESSIONS_REVOKED, revoked);
      await bus.drain();

      expect(localOnly).toHaveBeenCalledTimes(1);
      expect(withRemote).toHaveBeenCalledTimes(1);
    });

    it('在呼叫端的租戶脈絡裡處理', async () => {
      const bus = new DomainEventBus();
      const seen: Array<string | undefined> = [];
      bus.subscribe(DomainEvent.RESOURCE_CHANGED, () => void seen.push(currentTenant()?.id), {
        remote: true,
      });

      inTenant('a', () =>
        bus.deliverRemote(
          DomainEvent.RESOURCE_CHANGED,
          { changes: [] },
          { occurredAt: new Date() },
        ),
      );
      await bus.drain();

      expect(seen).toEqual(['a']);
    });
  });
});
