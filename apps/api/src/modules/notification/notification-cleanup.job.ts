import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { defineJob, JobQueue } from '@/core/jobs';

import { NotificationService } from './notification.service';
import type { NotificationCleanupReport } from './notification.service';

/**
 * 站內通知的保留清理（ADR-0026 D10）。每個租戶各跑一次（`scope: 'tenant'`）；同一個租戶同時只跑一個（`exclusive`）。
 * 中途失敗也安全：已提交的批次已經刪掉，重做時只剩還沒處理的列。
 */
export const NOTIFICATION_CLEANUP_JOB = defineJob<Record<string, never>>('notification.cleanup', {
  scope: 'tenant',
  exclusive: true,
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 30 * 60,
});

/** 依 `NOTIFICATION_CLEANUP_CRON`（預設每天 05:00 UTC）執行。 */
@Injectable()
export class NotificationCleanupJob implements OnModuleInit {
  constructor(
    private readonly notifications: NotificationService,
    private readonly jobs: JobQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(NOTIFICATION_CLEANUP_JOB, () => this.run(), {
      cron: this.config.get('NOTIFICATION_CLEANUP_CRON', { infer: true }),
    });
  }

  run(): Promise<NotificationCleanupReport> {
    return this.notifications.cleanup();
  }
}
