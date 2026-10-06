import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { defineJob, HIGH_VOLUME_RETENTION_SECONDS, JobQueue } from '@/core/jobs';

import { WebhookDeliveryService } from './webhook-delivery.service';
import type { WebhookDeliverJobData } from './webhook-delivery.service';

/**
 * 一次投遞（docs/architecture/backend/17-webhook.md §9.2 D12）：失敗由 pg-boss 指數退避重試 8 次（60 秒起、最多 1 小時，合計約 4 小時）。
 * 等待外部服務為主，並行調高；一次最多 10 秒（D11），`expireInSeconds` 留足餘裕。
 * 每個事件 × 每個網址一筆，結束後只在佇列留 1 天：結果另有投遞紀錄（`webhook_deliveries`）與重送。
 */
export const WEBHOOK_DELIVER_JOB = defineJob<WebhookDeliverJobData>('webhook.deliver', {
  scope: 'tenant',
  retryLimit: 8,
  retryDelaySeconds: 60,
  retryDelayMaxSeconds: 3600,
  expireInSeconds: 60,
  concurrency: 10,
  deleteAfterSeconds: HIGH_VOLUME_RETENTION_SECONDS,
});

/** 事件與投遞紀錄的保留清理（D16）；同一個租戶同時只跑一個。 */
export const WEBHOOK_CLEANUP_JOB = defineJob<Record<string, never>>('webhook.cleanup', {
  scope: 'tenant',
  exclusive: true,
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 30 * 60,
});

/** 註冊投遞與清理的 handler；清理依 `WEBHOOK_CLEANUP_CRON`（預設每天 05:15 UTC）。 */
@Injectable()
export class WebhookJobs implements OnModuleInit {
  constructor(
    private readonly deliveries: WebhookDeliveryService,
    private readonly jobs: JobQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(WEBHOOK_DELIVER_JOB, (data) => this.deliveries.deliver(data));
    this.jobs.register(WEBHOOK_CLEANUP_JOB, () => this.deliveries.cleanup(), {
      cron: this.config.get('WEBHOOK_CLEANUP_CRON', { infer: true }),
    });
  }
}
