import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { JobQueue } from '@/core/jobs';

import { AnnouncementDispatchService } from './announcement-dispatch.service';
import {
  ANNOUNCEMENT_DISPATCH_JOB,
  ANNOUNCEMENT_FAN_OUT_JOB,
  ANNOUNCEMENT_MAINTENANCE_JOB,
} from './announcement.job-types';

/**
 * 註冊公告的背景工作（docs/adr/0031-announcements.md D8～D10、D19）：排程與分批寫入由程式入列；
 * 每日維護依 `ANNOUNCEMENT_MAINTENANCE_CRON`（預設每天 05:20 UTC）。
 */
@Injectable()
export class AnnouncementJobs implements OnModuleInit {
  constructor(
    private readonly dispatches: AnnouncementDispatchService,
    private readonly jobs: JobQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(ANNOUNCEMENT_DISPATCH_JOB, (data) => this.dispatches.runScheduled(data));
    this.jobs.register(ANNOUNCEMENT_FAN_OUT_JOB, (data) => this.dispatches.fanOut(data));
    this.jobs.register(ANNOUNCEMENT_MAINTENANCE_JOB, () => this.dispatches.maintain(), {
      cron: this.config.get('ANNOUNCEMENT_MAINTENANCE_CRON', { infer: true }),
    });
  }
}
