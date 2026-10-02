import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { JobQueue } from '@/core/jobs';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';
import type { AuditService } from '@/modules/audit-log/audit.service';

import type { WebhookDeliveryService } from '../webhook-delivery.service';
import { WebhookEventCatalog } from '../webhook-event.catalog';
import { WEBHOOK_MAX_SUBSCRIPTIONS, WEBHOOK_PING_EVENT } from '../webhook.constants';
import { defineWebhookEvent } from '../webhook.definition';
import type { WebhookRepository, WebhookSubscriptionWithCreator } from '../webhook.repository';
import { WebhookService } from '../webhook.service';
import type { WebhookTransport } from '../webhook.transport';

const ACTOR = { id: 'admin-1', email: 'admin@example.com' } as AuthUser;
const USER_CREATED = defineWebhookEvent<{ userId: string }>('user.created', { version: 1 });
const FILE_UPLOADED = defineWebhookEvent<{ fileId: string }>('file.uploaded', {
  version: 2,
  feature: 'file',
});

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
    version: 3,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    createdBy: ACTOR.id,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    updatedBy: ACTOR.id,
    creator: { id: ACTOR.id, displayName: 'Admin' },
    ...overrides,
  };
}

function setup() {
  const tx = { tx: true };
  const db = { transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    findActiveIdsByEvent: vi.fn(async (): Promise<string[]> => []),
    insertEvent: vi.fn(async () => ({
      id: 'ev-1',
      type: 'user.created',
      version: 1,
      data: {},
      occurredAt: new Date(),
    })),
    findById: vi.fn(async (): Promise<WebhookSubscriptionWithCreator | undefined> =>
      subscription(),
    ),
    lockForCount: vi.fn(async () => undefined),
    countAll: vi.fn(async () => 0),
    create: vi.fn(async (values: object) => ({ ...subscription(), ...values })),
    update: vi.fn(async (_id: string, values: object) => ({ ...subscription(), ...values })),
    replaceSecret: vi.fn(async () => subscription()),
    delete: vi.fn(async () => true),
    findDelivery: vi.fn(async () => undefined as { eventId: string } | undefined),
    findEvent: vi.fn(async () => undefined as object | undefined),
  };
  const catalog = new WebhookEventCatalog();
  catalog.register([USER_CREATED, FILE_UPLOADED, WEBHOOK_PING_EVENT]);
  const deliveries = { attempt: vi.fn() };
  const transport = {
    normalizeUrl: vi.fn(async (url: string) => new URL(url).href),
    encryptSecret: vi.fn((secret: string) => `sealed(${secret})`),
  };
  const jobs = { enqueue: vi.fn(async () => 'job-1') };
  const audit = { record: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  const service = new WebhookService(
    db as unknown as Database,
    repo as unknown as WebhookRepository,
    catalog,
    deliveries as unknown as WebhookDeliveryService,
    transport as unknown as WebhookTransport,
    jobs as unknown as JobQueue,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
  );
  return { service, repo, deliveries, transport, jobs, audit, events, tx };
}

function inTenant<T>(fn: () => Promise<T>, features: TenantFeature[] = ['webhook', 'file']) {
  return runInTenantContext({ id: 't1', code: 'acme', features } as unknown as TenantContext, fn);
}

async function expectCode(promise: Promise<unknown>, code: string, details?: object) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
  if (details) expect((error as AppException).details).toMatchObject(details);
}

describe('WebhookService.emit（docs/adr/0030-webhooks.md D9）', () => {
  it('有訂閱：在同一個交易內寫一筆事件，每個訂閱入列一筆投遞工作', async () => {
    const ctx = setup();
    ctx.repo.findActiveIdsByEvent.mockResolvedValue(['wh-1', 'wh-2']);
    await inTenant(() => ctx.service.emit(USER_CREATED, { userId: 'u1' }, ctx.tx as never));

    expect(ctx.repo.findActiveIdsByEvent).toHaveBeenCalledWith('user.created', ctx.tx);
    expect(ctx.repo.insertEvent).toHaveBeenCalledWith(
      { type: 'user.created', version: 1, data: { userId: 'u1' } },
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'webhook.deliver' }),
      { subscriptionId: 'wh-2', eventId: 'ev-1' },
      { tx: ctx.tx },
    );
  });

  it('沒有訂閱：不寫事件、不入列', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.emit(USER_CREATED, { userId: 'u1' }, ctx.tx as never));
    expect(ctx.repo.insertEvent).not.toHaveBeenCalled();
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('租戶關掉了 webhook：連訂閱都不查（D8）', async () => {
    const ctx = setup();
    ctx.repo.findActiveIdsByEvent.mockResolvedValue(['wh-1']);
    await inTenant(() => ctx.service.emit(USER_CREATED, { userId: 'u1' }, ctx.tx as never), []);
    expect(ctx.repo.findActiveIdsByEvent).not.toHaveBeenCalled();
    expect(ctx.jobs.enqueue).not.toHaveBeenCalled();
  });

  it('沒有登記的事件是程式錯誤：拋錯讓業務交易一起失敗（D1）', async () => {
    const ctx = setup();
    const stray = defineWebhookEvent<{ id: string }>('role.created', { version: 1 });
    await expect(
      inTenant(() => ctx.service.emit(stray, { id: 'r1' }, ctx.tx as never)),
    ).rejects.toThrow('沒有登記');
  });
});

describe('WebhookService.listEvents', () => {
  it('只列可訂閱、所屬 feature 已啟用的事件（webhook.ping 不能訂閱）', async () => {
    const ctx = setup();
    expect(await inTenant(async () => ctx.service.listEvents(), ['webhook'])).toEqual({
      items: [{ type: 'user.created', version: 1 }],
    });
    expect(await inTenant(async () => ctx.service.listEvents())).toEqual({
      items: [
        { type: 'user.created', version: 1 },
        { type: 'file.uploaded', version: 2 },
      ],
    });
  });
});

describe('WebhookService.create', () => {
  it('產生密鑰、加密存放、寫稽核；回應帶一次明文密鑰', async () => {
    const ctx = setup();
    const result = await ctx.service.create(
      { name: 'CI', url: 'https://hooks.example.com/b2b', events: ['user.created'] },
      ACTOR,
    );
    expect(result.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(ctx.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        secretEncrypted: `sealed(${result.secret})`,
        createdBy: ACTOR.id,
      }),
      ctx.tx,
    );
    const audited = ctx.audit.record.mock.calls[0] as unknown as [{ changes: object }];
    expect(audited[0]).toMatchObject({ action: 'webhook.create', resourceType: 'webhook' });
    expect(JSON.stringify(audited[0].changes)).not.toContain(result.secret);
    expect(ctx.events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [{ resource: 'webhook', kind: 'create', id: 'wh-1' }],
    });
  });

  it('訂閱沒有登記或不能訂閱的事件 → WEBHOOK_EVENT_UNKNOWN', async () => {
    const ctx = setup();
    await expectCode(
      ctx.service.create(
        { name: 'CI', url: 'https://x.example.com', events: ['user.created', 'webhook.ping'] },
        ACTOR,
      ),
      'WEBHOOK_EVENT_UNKNOWN',
      { events: ['webhook.ping'] },
    );
    expect(ctx.repo.create).not.toHaveBeenCalled();
  });

  it('網址不能用時把 transport 的錯誤原樣拋出', async () => {
    const ctx = setup();
    ctx.transport.normalizeUrl.mockRejectedValue(
      new AppException('WEBHOOK_URL_NOT_ALLOWED', { reason: 'blocked' }),
    );
    await expectCode(
      ctx.service.create({ name: 'CI', url: 'https://10.0.0.1', events: ['user.created'] }, ACTOR),
      'WEBHOOK_URL_NOT_ALLOWED',
    );
  });

  it('已達訂閱上限 → WEBHOOK_LIMIT_REACHED（先鎖住再數）', async () => {
    const ctx = setup();
    ctx.repo.countAll.mockResolvedValue(WEBHOOK_MAX_SUBSCRIPTIONS);
    await expectCode(
      ctx.service.create(
        { name: 'CI', url: 'https://x.example.com', events: ['user.created'] },
        ACTOR,
      ),
      'WEBHOOK_LIMIT_REACHED',
      { max: WEBHOOK_MAX_SUBSCRIPTIONS },
    );
    expect(ctx.repo.lockForCount).toHaveBeenCalledWith(ctx.tx);
  });
});

describe('WebhookService.update', () => {
  it('版本不符 → WEBHOOK_VERSION_CONFLICT（帶目前版本）', async () => {
    const ctx = setup();
    await expectCode(
      ctx.service.update('wh-1', { name: 'x', version: 2 }, ACTOR),
      'WEBHOOK_VERSION_CONFLICT',
      { current: 3 },
    );
  });

  it('啟用：失敗次數歸零、清掉停用原因（D13）', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(
      subscription({ status: 'disabled', disabledReason: 'failing', consecutiveFailures: 50 }),
    );
    await ctx.service.update('wh-1', { status: 'active', version: 3 }, ACTOR);
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'wh-1',
      expect.objectContaining({ status: 'active', disabledReason: null, consecutiveFailures: 0 }),
      3,
      ctx.tx,
    );
  });

  it('停用：原因記為 manual，寫稽核的狀態變化', async () => {
    const ctx = setup();
    ctx.repo.update.mockImplementation(async (_id: string, values: object) => ({
      ...subscription(),
      ...values,
    }));
    await ctx.service.update('wh-1', { status: 'disabled', version: 3 }, ACTOR);
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'wh-1',
      expect.objectContaining({ status: 'disabled', disabledReason: 'manual' }),
      3,
      ctx.tx,
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webhook.update',
        changes: { before: { status: 'active' }, after: { status: 'disabled' } },
      }),
      ctx.tx,
    );
  });

  it('條件式 UPDATE 沒命中（讀到之後被改過）→ 以交易內重讀的版本回 409', async () => {
    const ctx = setup();
    ctx.repo.update.mockResolvedValue(undefined as never);
    ctx.repo.findById
      .mockResolvedValueOnce(subscription())
      .mockResolvedValueOnce(subscription({ version: 4 }));
    await expectCode(
      ctx.service.update('wh-1', { name: 'x', version: 3 }, ACTOR),
      'WEBHOOK_VERSION_CONFLICT',
      { current: 4 },
    );
  });
});

describe('WebhookService：其他操作', () => {
  it('輪替密鑰：寫稽核（不含密鑰）、回傳新的明文密鑰', async () => {
    const ctx = setup();
    const result = await ctx.service.rotateSecret('wh-1', ACTOR);
    expect(ctx.repo.replaceSecret).toHaveBeenCalledWith(
      'wh-1',
      `sealed(${result.secret})`,
      ACTOR.id,
      ctx.tx,
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook.rotateSecret' }),
      ctx.tx,
    );
  });

  it('刪除：硬刪除並寫稽核', async () => {
    const ctx = setup();
    await ctx.service.remove('wh-1');
    expect(ctx.repo.delete).toHaveBeenCalledWith('wh-1', ctx.tx);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook.delete' }),
      ctx.tx,
    );
  });

  it('找不到 → WEBHOOK_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(undefined);
    await expectCode(ctx.service.findOne('missing'), 'WEBHOOK_NOT_FOUND');
  });

  it('停用中不能送測試事件或重送 → WEBHOOK_DISABLED（D17）', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(subscription({ status: 'disabled' }));
    await expectCode(ctx.service.sendTest('wh-1'), 'WEBHOOK_DISABLED');
    await expectCode(ctx.service.redeliver('wh-1', 'd1'), 'WEBHOOK_DISABLED');
    expect(ctx.deliveries.attempt).not.toHaveBeenCalled();
  });

  it('重送的紀錄不存在或事件已被清理 → WEBHOOK_DELIVERY_NOT_FOUND', async () => {
    const ctx = setup();
    await expectCode(ctx.service.redeliver('wh-1', 'd1'), 'WEBHOOK_DELIVERY_NOT_FOUND');
    ctx.repo.findDelivery.mockResolvedValue({ eventId: 'ev-gone' });
    await expectCode(ctx.service.redeliver('wh-1', 'd1'), 'WEBHOOK_DELIVERY_NOT_FOUND');
  });
});
