import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { JobQueue } from '@/core/jobs';

import { WATCH_NOTIFY_JOB } from './watch.job-types';
import { WatchService } from './watch.service';

/** 註冊 `watch.notify` 的 handler（由程式入列，沒有排程）。 */
@Injectable()
export class WatchJobs implements OnModuleInit {
  constructor(
    private readonly watches: WatchService,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.register(WATCH_NOTIFY_JOB, (data) => this.watches.notifyWatchers(data));
  }
}
