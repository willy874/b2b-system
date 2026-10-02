import { Global, Module } from '@nestjs/common';

import { JobQueue } from './job-queue';
import { JobStore } from './job-store';

/**
 * 全域提供 `JobQueue`（入列、註冊 handler）與 `JobStore`（管理頁查詢）。
 * 模組自己註冊 handler，`core/jobs` 不認識任何業務工作（docs/architecture/backend/10-jobs.md §9.2 D6）。
 */
@Global()
@Module({
  providers: [JobQueue, JobStore],
  exports: [JobQueue, JobStore],
})
export class JobsModule {}
