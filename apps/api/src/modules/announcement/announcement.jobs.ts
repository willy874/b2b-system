import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { JobQueue } from '@/core/jobs';

import { AnnouncementDispatchService } from './announcement-dispatch.service';
import { ANNOUNCEMENT_DISPATCH_JOB, ANNOUNCEMENT_FAN_OUT_JOB } from './announcement.job-types';

/** 註冊公告的兩種背景工作（docs/adr/0031-announcements.md D8、D9）；都由程式入列，沒有排程。 */
@Injectable()
export class AnnouncementJobs implements OnModuleInit {
  constructor(
    private readonly dispatches: AnnouncementDispatchService,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.register(ANNOUNCEMENT_DISPATCH_JOB, (data) => this.dispatches.runScheduled(data));
    this.jobs.register(ANNOUNCEMENT_FAN_OUT_JOB, (data) => this.dispatches.fanOut(data));
  }
}
