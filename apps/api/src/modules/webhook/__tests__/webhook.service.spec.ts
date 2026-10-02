import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { JobQueue } from '@/core/jobs';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';
import type { WebhookTargetRow } from '@/db/schema';
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

function target(overrides: Partial<WebhookTargetRow> = {}): WebhookTargetRow {
  return {
    id: 'tg-1',
    subscriptionId: 'wh-1',
    url: 'https://hooks.example.com/b2b',
    position: 0,
    consecutiveFailures: 0,
    lastDeliveryAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
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
    version: 3,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    createdBy: ACTOR.id,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    updatedBy: ACTOR.id,
    creator: { id: ACTOR.id, displayName: 'Admin' },
    targets: [target()],
    ...overrides,
  };
}

function setup() {
  const tx = { tx: true };
  const db = { transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    findActiveTargetsByEvent: vi.fn(
      async (): Promise<Array<{ subscriptionId: string; targetId: string }>> => [],
    ),
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
    distinctUrls: vi.fn(async (_tx: unknown, _exclude?: string): Promise<string[]> => []),
    replaceTargets: vi.fn(async () => undefined),
    resetTargetFailures: vi.fn(async () => undefined),
    create: vi.fn(async (values: object) => ({ ...subscription(), ...values })),
    update: vi.fn(async (_id: string, values: object) => ({ ...subscription(), ...values })),
    replaceSecret: vi.fn(async () => subscription()),
    delete: vi.fn(async () => true),
    findDelivery: vi.fn(
      async () => undefined as { eventId: string; targetId: string | null } | undefined,
    ),
    findEvent: vi.fn(async () => undefined as object | undefined),
  };
  const catalog = new WebhookEventCatalog();
  catalog.register([USER_CREATED, FILE_UPLOADED, WEBHOOK_PING_EVENT]);
  const deliveries = {
    attempt: vi.fn(async (_subscription: unknown, item: WebhookTargetRow) => ({
      id: `del-${item.id}`,
      eventId: 'ev-1',
      targetId: item.id,
      url: item.url,
      attempt: 1,
      trigger: 'manual',
      succeeded: true,
      responseStatus: 200,
      durationMs: 1,
      responseBody: 'ok',
      error: null,
      createdAt: new Date(),
      event: { type: 'webhook.ping', data: {}, occurredAt: new Date() },
      disabledSubscription: false,
    })),
  };
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

function inTenant<T>(
  fn: () => Promise<T>,
  features: TenantFeature[] = ['webhook', 'file'],
  featureParams: Record<string, number> = {},
) {
  return runInTenantContext(
    { id: 't1', code: 'acme', features, featureParams } as unknown as TenantContext,
    fn,
  );
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

describe('WebhookService.emit（docs/architecture/backend/17-webhook.md §9.2 D9）', () => {
  it('有訂閱：在同一個交易內寫一筆事件，每個訂閱的每個網址入列一筆投遞工作（docs/architecture/backend/17-webhook.md §10.2 D14）', async () => {
    const ctx = setup();
    ctx.repo.findActiveTargetsByEvent.mockResolvedValue([
      { subscriptionId: 'wh-1', targetId: 'tg-1' },
      { subscriptionId: 'wh-2', targetId: 'tg-2' },
    ]);
    await inTenant(() => ctx.service.emit(USER_CREATED, { userId: 'u1' }, ctx.tx as never));

    expect(ctx.repo.findActiveTargetsByEvent).toHaveBeenCalledWith('user.created', ctx.tx);
    expect(ctx.repo.insertEvent).toHaveBeenCalledWith(
      { type: 'user.created', version: 1, data: { userId: 'u1' } },
      ctx.tx,
    );
    expect(ctx.jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'webhook.deliver' }),
      { subscriptionId: 'wh-2', eventId: 'ev-1', targetId: 'tg-2' },
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
    ctx.repo.findActiveTargetsByEvent.mockResolvedValue([
      { subscriptionId: 'wh-1', targetId: 'tg-1' },
    ]);
    await inTenant(() => ctx.service.emit(USER_CREATED, { userId: 'u1' }, ctx.tx as never), []);
    expect(ctx.repo.findActiveTargetsByEvent).not.toHaveBeenCalled();
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
    const result = await inTenant(() =>
      ctx.service.create(
        { name: 'CI', urls: ['https://hooks.example.com/b2b'], events: ['user.created'] },
        ACTOR,
      ),
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
      inTenant(() =>
        ctx.service.create(
          { name: 'CI', urls: ['https://x.example.com'], events: ['user.created', 'webhook.ping'] },
          ACTOR,
        ),
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
      inTenant(() =>
        ctx.service.create(
          { name: 'CI', urls: ['https://10.0.0.1'], events: ['user.created'] },
          ACTOR,
        ),
      ),
      'WEBHOOK_URL_NOT_ALLOWED',
    );
  });

  it('已達訂閱上限 → WEBHOOK_LIMIT_REACHED（先鎖住再數）', async () => {
    const ctx = setup();
    ctx.repo.countAll.mockResolvedValue(WEBHOOK_MAX_SUBSCRIPTIONS);
    await expectCode(
      inTenant(() =>
        ctx.service.create(
          { name: 'CI', urls: ['https://x.example.com'], events: ['user.created'] },
          ACTOR,
        ),
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
      inTenant(() => ctx.service.update('wh-1', { name: 'x', version: 2 }, ACTOR)),
      'WEBHOOK_VERSION_CONFLICT',
      { current: 3 },
    );
  });

  it('啟用：失敗次數歸零、清掉停用原因（D13）', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(
      subscription({ status: 'disabled', disabledReason: 'failing', consecutiveFailures: 50 }),
    );
    await inTenant(() => ctx.service.update('wh-1', { status: 'active', version: 3 }, ACTOR));
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'wh-1',
      expect.objectContaining({ status: 'active', disabledReason: null }),
      3,
      ctx.tx,
    );
    expect(ctx.repo.resetTargetFailures).toHaveBeenCalledWith('wh-1', ctx.tx);
  });

  it('停用：原因記為 manual，寫稽核的狀態變化', async () => {
    const ctx = setup();
    ctx.repo.update.mockImplementation(async (_id: string, values: object) => ({
      ...subscription(),
      ...values,
    }));
    await inTenant(() => ctx.service.update('wh-1', { status: 'disabled', version: 3 }, ACTOR));
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
      inTenant(() => ctx.service.update('wh-1', { name: 'x', version: 3 }, ACTOR)),
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
    await expectCode(
      inTenant(() => ctx.service.sendTest('wh-1')),
      'WEBHOOK_DISABLED',
    );
    await expectCode(
      inTenant(() => ctx.service.redeliver('wh-1', 'd1')),
      'WEBHOOK_DISABLED',
    );
    expect(ctx.deliveries.attempt).not.toHaveBeenCalled();
  });

  it('重送的紀錄不存在或事件已被清理 → WEBHOOK_DELIVERY_NOT_FOUND', async () => {
    const ctx = setup();
    await expectCode(
      inTenant(() => ctx.service.redeliver('wh-1', 'd1')),
      'WEBHOOK_DELIVERY_NOT_FOUND',
    );
    ctx.repo.findDelivery.mockResolvedValue({ eventId: 'ev-gone', targetId: 'tg-1' });
    await expectCode(
      inTenant(() => ctx.service.redeliver('wh-1', 'd1')),
      'WEBHOOK_DELIVERY_NOT_FOUND',
    );
  });
});

describe('WebhookService：多個目標網址（docs/architecture/05-tenancy.md §13.3 D11～D16）', () => {
  const A = 'https://a.example.com/';
  const B = 'https://b.example.com/';

  it('建立：寫入每個網址、訂閱的 url 雙寫第一個', async () => {
    const ctx = setup();
    await inTenant(
      () => ctx.service.create({ name: 'CI', urls: [A, B], events: ['user.created'] }, ACTOR),
      undefined,
      { 'webhook.maxUrls': 5 },
    );
    expect(ctx.repo.create).toHaveBeenCalledWith(expect.objectContaining({ url: A }), ctx.tx);
    expect(ctx.repo.replaceTargets).toHaveBeenCalledWith('wh-1', [A, B], ctx.tx);
  });

  it('租戶不重複的網址數會超過 webhook.maxUrls → WEBHOOK_URL_LIMIT_REACHED（預設 1）', async () => {
    const ctx = setup();
    ctx.repo.distinctUrls.mockResolvedValue([A]);
    await expectCode(
      inTenant(() =>
        ctx.service.create({ name: 'CI', urls: [B], events: ['user.created'] }, ACTOR),
      ),
      'WEBHOOK_URL_LIMIT_REACHED',
      { max: 1 },
    );
    expect(ctx.repo.lockForCount).toHaveBeenCalledWith(ctx.tx);
    expect(ctx.repo.create).not.toHaveBeenCalled();
  });

  it('與其他訂閱同一個網址不另外計數', async () => {
    const ctx = setup();
    ctx.repo.distinctUrls.mockResolvedValue([A]);
    await inTenant(() =>
      ctx.service.create({ name: 'CI', urls: [A], events: ['user.created'] }, ACTOR),
    );
    expect(ctx.repo.create).toHaveBeenCalled();
  });

  it('已經超過上限的租戶仍能修改：數量沒有變多就放行', async () => {
    const ctx = setup();
    // 全租戶 2 個（超過預設的 1）；這個訂閱把 B 換成 A，變更後是 1 個
    ctx.repo.distinctUrls.mockImplementation(async (_tx, exclude) => (exclude ? [A] : [A, B]));
    await inTenant(() => ctx.service.update('wh-1', { urls: [A], version: 3 }, ACTOR));
    expect(ctx.repo.distinctUrls).toHaveBeenCalledWith(ctx.tx, 'wh-1');
    expect(ctx.repo.replaceTargets).toHaveBeenCalledWith('wh-1', [A], ctx.tx);
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'wh-1',
      expect.objectContaining({ url: A }),
      3,
      ctx.tx,
    );
  });

  it('修改網址寫稽核的 urls 變化', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.update('wh-1', { urls: [A], version: 3 }, ACTOR), undefined, {
      'webhook.maxUrls': 5,
    });
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webhook.update',
        changes: { before: { urls: ['https://hooks.example.com/b2b'] }, after: { urls: [A] } },
      }),
      ctx.tx,
    );
  });

  it('送測試事件送到每個網址，回傳每個網址的紀錄', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(
      subscription({ targets: [target(), target({ id: 'tg-2', url: B, position: 1 })] }),
    );
    const result = await inTenant(() => ctx.service.sendTest('wh-1'));
    expect(ctx.deliveries.attempt).toHaveBeenCalledTimes(2);
    expect(result.items.map((item) => item.url)).toEqual(['https://hooks.example.com/b2b', B]);
  });

  it('重送到同一個網址；網址已被移除 → WEBHOOK_DELIVERY_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.findEvent.mockResolvedValue({
      id: 'ev-1',
      type: 'user.created',
      version: 1,
      data: {},
      occurredAt: new Date(),
    });
    ctx.repo.findDelivery.mockResolvedValue({ eventId: 'ev-1', targetId: 'tg-1' });
    await inTenant(() => ctx.service.redeliver('wh-1', 'd1'));
    expect(ctx.deliveries.attempt.mock.calls[0]?.[1]).toMatchObject({ id: 'tg-1' });

    ctx.repo.findDelivery.mockResolvedValue({ eventId: 'ev-1', targetId: null });
    await expectCode(
      inTenant(() => ctx.service.redeliver('wh-1', 'd1')),
      'WEBHOOK_DELIVERY_NOT_FOUND',
    );
  });
});
