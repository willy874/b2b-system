import { Module } from '@nestjs/common';

import { JobController } from './job.controller';
import { JobService } from './job.service';
import { PlatformJobController } from './platform-job.controller';
import { PlatformJobService } from './platform-job.service';

/**
 * 背景工作的管理頁 API：租戶的後台（`/jobs`，只看自己的）與平台的監控（`/platform/jobs`，全部）。
 * 佇列本身在 `core/jobs`，各種工作由擁有它的模組註冊。
 */
@Module({
  controllers: [JobController, PlatformJobController],
  providers: [JobService, PlatformJobService],
})
export class JobModule {}
