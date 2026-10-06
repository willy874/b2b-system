import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import type { JobQueue } from '@/core/jobs';

import type { WebhookDeliveryService } from '../webhook-delivery.service';
import { WEBHOOK_CLEANUP_JOB, WEBHOOK_DELIVER_JOB, WebhookJobs } from '../webhook.jobs';

type Handler = (data: unknown) => Promise<unknown>;

function setup() {
  const handlers = new Map<string, { handler: Handler; options: unknown }>();
  const jobs = {
    register: vi.fn((job: { name: string }, handler: Handler, options?: unknown) => {
      handlers.set(job.name, { handler, options });
    }),
  };
  const deliveries = {
    deliver: vi.fn(async () => ({ succeeded: true })),
    cleanup: vi.fn(async () => ({ deletedEvents: 0 })),
  };
  const config = { get: vi.fn(() => '15 5 * * *') };
  new WebhookJobs(
    deliveries as unknown as WebhookDeliveryService,
    jobs as unknown as JobQueue,
    config as unknown as ConfigService<Env, true>,
  ).onModuleInit();
  return { handlers, deliveries, config };
}

describe('WebhookJobs（docs/architecture/backend/17-webhook.md §9.2 D12、D16）', () => {
  it('投遞：每個租戶各自的工作，重試 8 次、指數退避上限 1 小時', () => {
    expect(WEBHOOK_DELIVER_JOB.options).toMatchObject({
      scope: 'tenant',
      retryLimit: 8,
      retryDelaySeconds: 60,
      retryDelayMaxSeconds: 3600,
    });
  });

  it('投遞的 handler 把工作資料原樣交給 deliver', async () => {
    const { handlers, deliveries } = setup();
    const data = { subscriptionId: 'wh-1', eventId: 'ev-1', targetId: 'tg-1' };
    await expect(handlers.get('webhook.deliver')?.handler(data)).resolves.toEqual({
      succeeded: true,
    });
    expect(deliveries.deliver).toHaveBeenCalledWith(data);
  });

  it('清理：同一個租戶同時只跑一個，依 WEBHOOK_CLEANUP_CRON 排程', async () => {
    const { handlers, deliveries, config } = setup();
    expect(WEBHOOK_CLEANUP_JOB.options).toMatchObject({ scope: 'tenant', exclusive: true });
    expect(handlers.get('webhook.cleanup')?.options).toEqual({ cron: '15 5 * * *' });
    expect(config.get).toHaveBeenCalledWith('WEBHOOK_CLEANUP_CRON', { infer: true });
    await handlers.get('webhook.cleanup')?.handler({});
    expect(deliveries.cleanup).toHaveBeenCalledTimes(1);
  });
});
