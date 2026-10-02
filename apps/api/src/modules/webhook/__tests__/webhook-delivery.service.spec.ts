import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@/core/database';
import type { DomainEventBus } from '@/core/events';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';
import type { WebhookEventRow, WebhookTargetRow } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { NotificationService } from '@/modules/notification/notification.service';
import type { PermissionService } from '@/modules/permission/permission.service';

import { WebhookDeliveryFailedError, WebhookDeliveryService } from '../webhook-delivery.service';
import { WEBHOOK_AUTO_DISABLE_AFTER_FAILURES } from '../webhook.constants';
import type { WebhookRepository, WebhookSubscriptionWithCreator } from '../webhook.repository';
import type { WebhookSendResult, WebhookTransport } from '../webhook.transport';

const SECRET = 'whsec_test';

function target(overrides: Partial<WebhookTargetRow> = {}): WebhookTargetRow {
  return {
    id: 'tg-1',
    subscriptionId: 'wh-1',
    url: 'https://hooks.example.com/b2b',
    position: 0,
    consecutiveFailures: 0,
    lastDeliveryAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function subscription(
  overrides: Partial<WebhookSubscriptionWithCreator> = {},
): WebhookSubscriptionWithCreator {
  return {
    id: 'wh-1',
    name: 'CI',
    url: 'https://hooks.example.com/b2b',
    events: ['user.created'],
    status: 'active',
    disabledReason: null,
    secretEncrypted: 'sealed',
    consecutiveFailures: 0,
    lastDeliveryAt: null,
    version: 1,
    createdAt: new Date(),
    createdBy: null,
    updatedAt: new Date(),
    updatedBy: null,
    creator: null,
    targets: [target()],
    ...overrides,
  };
}

const EVENT: WebhookEventRow = {
  id: 'ev-1',
  type: 'user.created',
  version: 1,
  data: { userId: 'u1' },
  occurredAt: new Date('2026-10-02T01:02:03Z'),
};

function received(status: number, body = 'ok'): WebhookSendResult {
  return { received: true, response: { status, body } };
}

function setup(sendResult: WebhookSendResult = received(200)) {
  const tx = { tx: true };
  const db = { transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    findById: vi.fn(async (): Promise<WebhookSubscriptionWithCreator | undefined> =>
      subscription(),
    ),
    findEvent: vi.fn(async (): Promise<WebhookEventRow | undefined> => EVENT),
    countAttempts: vi.fn(async () => 0),
    insertDelivery: vi.fn(async (values: object) => ({
      id: 'del-1',
      createdAt: new Date(),
      ...values,
    })),
    recordSuccess: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => ({ consecutiveFailures: 1, disabledNow: false })),
    deleteEventsBefore: vi.fn(async () => 0),
  };
  const transport = {
    decryptSecret: vi.fn(() => SECRET),
    send: vi.fn(
      async (_url: string, _headers: object, _body: string): Promise<WebhookSendResult> =>
        sendResult,
    ),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const notifications = { notify: vi.fn(async () => []) };
  const permissions = { findActiveUserIdsWithPermission: vi.fn(async () => ['admin-1']) };
  const events = { publish: vi.fn() };
  const service = new WebhookDeliveryService(
    db as unknown as Database,
    repo as unknown as WebhookRepository,
    transport as unknown as WebhookTransport,
    audit as unknown as AuditService,
    notifications as unknown as NotificationService,
    permissions as unknown as PermissionService,
    events as unknown as DomainEventBus,
  );
  const countAttemptsTarget = () =>
    (repo.countAttempts.mock.calls[0] as unknown[] | undefined)?.[0];
  return {
    service,
    repo,
    transport,
    audit,
    notifications,
    permissions,
    events,
    tx,
    countAttemptsTarget,
  };
}

function inTenant<T>(fn: () => Promise<T>, features: TenantFeature[] = ['webhook']) {
  return runInTenantContext({ id: 't1', code: 'acme', features } as unknown as TenantContext, fn);
}

const JOB = { subscriptionId: 'wh-1', eventId: 'ev-1', targetId: 'tg-1' };

describe('WebhookDeliveryService.deliver（docs/architecture/backend/17-webhook.md §9.2 D11～D13）', () => {
  it('送出信封與簽章：簽的是「時間戳.body」，事件 id 當作 X-Webhook-Id', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.deliver(JOB));

    const [url, headers, body] = ctx.transport.send.mock.calls[0] as unknown as [
      string,
      Record<string, string>,
      string,
    ];
    expect(url).toBe('https://hooks.example.com/b2b');
    expect(JSON.parse(body)).toEqual({
      id: 'ev-1',
      type: 'user.created',
      version: 1,
      occurredAt: '2026-10-02T01:02:03.000Z',
      tenant: 'acme',
      data: { userId: 'u1' },
    });
    const timestamp = headers['X-Webhook-Timestamp'];
    const expected = createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
    expect(headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Webhook-Id': 'ev-1',
      'X-Webhook-Event': 'user.created',
      'X-Webhook-Signature': `sha256=${expected}`,
    });
  });

  it('2xx：記一筆成功的紀錄、失敗次數歸零、推播投遞紀錄', async () => {
    const ctx = setup(received(204, ''));
    const output = await inTenant(() => ctx.service.deliver(JOB));
    expect(output).toMatchObject({ deliveryId: 'del-1', attempt: 1, succeeded: true });
    expect(ctx.repo.insertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        trigger: 'auto',
        succeeded: true,
        responseStatus: 204,
        targetId: 'tg-1',
        url: 'https://hooks.example.com/b2b',
      }),
      ctx.tx,
    );
    expect(ctx.repo.recordSuccess).toHaveBeenCalledWith('wh-1', 'tg-1', expect.any(Date), ctx.tx);
    expect(ctx.events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [
        { resource: 'webhookDelivery', kind: 'create', id: 'del-1', refs: { webhook: ['wh-1'] } },
      ],
    });
  });

  it('非 2xx（含 3xx）：記失敗、失敗次數加一，拋出讓 pg-boss 重試；第幾次接續之前的紀錄', async () => {
    const ctx = setup(received(302));
    ctx.repo.countAttempts.mockResolvedValue(2);
    await expect(inTenant(() => ctx.service.deliver(JOB))).rejects.toBeInstanceOf(
      WebhookDeliveryFailedError,
    );
    expect(ctx.repo.insertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 3, succeeded: false, responseStatus: 302 }),
      ctx.tx,
    );
    expect(ctx.countAttemptsTarget()).toBe('tg-1');
    expect(ctx.repo.recordFailure).toHaveBeenCalledWith(
      'wh-1',
      'tg-1',
      expect.any(Date),
      WEBHOOK_AUTO_DISABLE_AFTER_FAILURES,
      ctx.tx,
    );
  });

  it('沒有收到回應：記下原因代碼，狀態碼與回應是 null', async () => {
    const ctx = setup({ received: false, error: 'TIMEOUT' });
    await expect(inTenant(() => ctx.service.deliver(JOB))).rejects.toThrow('TIMEOUT');
    expect(ctx.repo.insertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ responseStatus: null, responseBody: null, error: 'TIMEOUT' }),
      ctx.tx,
    );
  });

  it('這次失敗讓它到達門檻：停用、寫稽核、通知持有 webhook:update 的人，不再拋出（D13）', async () => {
    const ctx = setup(received(500));
    ctx.repo.findById.mockResolvedValue(
      subscription({
        targets: [target({ consecutiveFailures: WEBHOOK_AUTO_DISABLE_AFTER_FAILURES - 1 })],
      }),
    );
    ctx.repo.recordFailure.mockResolvedValue({
      consecutiveFailures: WEBHOOK_AUTO_DISABLE_AFTER_FAILURES,
      disabledNow: true,
    });
    const output = await inTenant(() => ctx.service.deliver(JOB));

    expect(output).toMatchObject({ succeeded: false, disabledSubscription: true });
    expect(ctx.permissions.findActiveUserIdsWithPermission).toHaveBeenCalledWith('webhook:update');
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook.autoDisable', resourceId: 'wh-1' }),
      ctx.tx,
    );
    expect(ctx.notifications.notify).toHaveBeenCalledWith(
      [
        {
          type: 'webhook.disabled',
          recipientId: 'admin-1',
          actorId: null,
          params: {
            webhookName: 'CI',
            consecutiveFailures: WEBHOOK_AUTO_DISABLE_AFTER_FAILURES,
            url: 'https://hooks.example.com/b2b',
          },
          link: { route: 'webhook.detail', params: { webhookId: 'wh-1' } },
        },
      ],
      ctx.tx,
    );
    expect(ctx.events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: expect.arrayContaining([{ resource: 'webhook', kind: 'update', id: 'wh-1' }]),
    });
  });

  it('離門檻還遠：不查收件人', async () => {
    const ctx = setup(received(500));
    await expect(inTenant(() => ctx.service.deliver(JOB))).rejects.toThrow();
    expect(ctx.permissions.findActiveUserIdsWithPermission).not.toHaveBeenCalled();
    expect(ctx.audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ['訂閱已刪除', { subscription: undefined }, 'inactive'],
    ['訂閱已停用', { subscription: subscription({ status: 'disabled' }) }, 'inactive'],
    ['網址已從訂閱移除', { subscription: subscription({ targets: [] }) }, 'targetRemoved'],
    ['事件已被清理', { event: undefined }, 'eventExpired'],
  ])('%s：略過、不送出、不重試', async (_name, state, skipped) => {
    const ctx = setup();
    if ('subscription' in state) ctx.repo.findById.mockResolvedValue(state.subscription);
    if ('event' in state) ctx.repo.findEvent.mockResolvedValue(state.event);
    expect(await inTenant(() => ctx.service.deliver(JOB))).toEqual({ skipped });
    expect(ctx.transport.send).not.toHaveBeenCalled();
  });

  it('租戶關掉了 webhook：已入列的投遞也略過（D8）', async () => {
    const ctx = setup();
    expect(await inTenant(() => ctx.service.deliver(JOB), [])).toEqual({
      skipped: 'featureDisabled',
    });
    expect(ctx.transport.send).not.toHaveBeenCalled();
  });
});

describe('WebhookDeliveryService.deliver：多個目標網址（docs/architecture/backend/17-webhook.md §10.2 D14）', () => {
  it('送到工作指定的網址', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(
      subscription({
        targets: [target(), target({ id: 'tg-2', url: 'https://second.example.com/hook' })],
      }),
    );
    await inTenant(() => ctx.service.deliver({ ...JOB, targetId: 'tg-2' }));
    expect(ctx.transport.send.mock.calls[0]?.[0]).toBe('https://second.example.com/hook');
  });

  it('升版前入列、沒有 targetId 的工作送到第一個網址', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.deliver({ subscriptionId: 'wh-1', eventId: 'ev-1' }));
    expect(ctx.transport.send.mock.calls[0]?.[0]).toBe('https://hooks.example.com/b2b');
  });
});

describe('WebhookDeliveryService.attempt（手動，D17）', () => {
  it('手動的失敗不計入自動停用的門檻', async () => {
    const ctx = setup(received(500));
    const delivery = await inTenant(() =>
      ctx.service.attempt(subscription(), target(), EVENT, 'manual'),
    );
    expect(delivery).toMatchObject({ trigger: 'manual', succeeded: false });
    expect(ctx.repo.recordFailure).not.toHaveBeenCalled();
    expect(ctx.repo.recordSuccess).not.toHaveBeenCalled();
  });

  it('手動的成功一樣讓失敗次數歸零', async () => {
    const ctx = setup(received(200));
    await inTenant(() => ctx.service.attempt(subscription(), target(), EVENT, 'manual'));
    expect(ctx.repo.recordSuccess).toHaveBeenCalled();
  });
});

describe('WebhookDeliveryService.cleanup（D16）', () => {
  it('分批刪除超過 30 天的事件，不滿一批就結束', async () => {
    const ctx = setup();
    ctx.repo.deleteEventsBefore.mockResolvedValueOnce(1000).mockResolvedValueOnce(3);
    const report = await ctx.service.cleanup(new Date('2026-10-31T00:00:00Z'));
    expect(report).toEqual({
      retentionDays: 30,
      cutoff: '2026-10-01T00:00:00.000Z',
      deletedEvents: 1003,
    });
    expect(ctx.repo.deleteEventsBefore).toHaveBeenCalledTimes(2);
  });
});
