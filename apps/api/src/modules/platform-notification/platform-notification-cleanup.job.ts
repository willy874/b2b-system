import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { defineJob, JobQueue } from '@/core/jobs';

import { PlatformNotificationService } from './platform-notification.service';

/** 平台通知的保留清理（docs/architecture/backend/15-notification.md §6.2）：平台 DB 只有一份，`scope: 'platform'`。 */
export const PLATFORM_NOTIFICATION_CLEANUP_JOB = defineJob<Record<string, never>>(
  'platformNotification.cleanup',
  { scope: 'platform', exclusive: true, retryLimit: 3, retryDelaySeconds: 300 },
);

/** 與租戶的通知清理同一個排程（`NOTIFICATION_CLEANUP_CRON`）。 */
@Injectable()
export class PlatformNotificationCleanupJob implements OnModuleInit {
  constructor(
    private readonly notifications: PlatformNotificationService,
    private readonly jobs: JobQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(PLATFORM_NOTIFICATION_CLEANUP_JOB, () => this.run(), {
      cron: this.config.get('NOTIFICATION_CLEANUP_CRON', { infer: true }),
    });
  }

  run(): Promise<{ deleted: number }> {
    return this.notifications.cleanup();
  }
}
