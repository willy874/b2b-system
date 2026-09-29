import { Module } from '@nestjs/common';

import { JobController } from './job.controller';
import { JobService } from './job.service';

/** 背景工作的管理頁 API；佇列本身在 `core/jobs`，各種工作由擁有它的模組註冊。 */
@Module({
  controllers: [JobController],
  providers: [JobService],
})
export class JobModule {}
