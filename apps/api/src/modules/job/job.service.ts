import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { DRIZZLE, withTransaction } from '@/core/database';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import { paginated } from '@/core/http';
import type { PaginatedResult } from '@/core/http';
import { JobQueue, JobStore } from '@/core/jobs';
import type { JobQueueCounts, JobRecord } from '@/core/jobs';
import { AuditService } from '@/modules/audit-log/audit.service';

import type { JobDto, JobQueueListDto, JobSummaryDto, ListJobDto } from './dto/job.dto';

/**
 * 背景工作的管理（docs/architecture/backend/10-jobs.md §6）：看佇列、看工作、手動重試失敗的工作。
 * 只列出程式有註冊的工作；pg-boss 內部或已下線的佇列不出現。
 */
@Injectable()
export class JobService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly store: JobStore,
    private readonly audit: AuditService,
  ) {}

  async queues(): Promise<JobQueueListDto> {
    const definitions = this.jobs.definitions();
    const counts = await this.store.counts(definitions.map((definition) => definition.name));
    return {
      // counts 對每個名稱都有預設值；?? 只是讓型別知道
      items: definitions.map(({ name, cron }) =>
        Object.assign({ name, cron }, counts.get(name) ?? EMPTY_COUNTS),
      ),
    };
  }

  async list(query: ListJobDto): Promise<PaginatedResult<JobSummaryDto>> {
    const { items, total } = await this.store.list({ names: this.jobs.names(), ...query });
    return paginated(items.map(toSummaryDto), total, query);
  }

  async findOne(id: string): Promise<JobDto> {
    return toDto(await this.findOrThrow(id));
  }

  /**
   * 把重試用完的工作重新排入。只接受 `failed`：執行中或等待中的工作重試會重複執行，
   * 已完成、已取消的工作重試沒有意義。稽核與重試在同一個交易。
   */
  async retry(id: string, actor: AuthUser): Promise<JobDto> {
    const job = await this.findOrThrow(id);
    if (job.state !== 'failed') throw new AppException('JOB_NOT_RETRYABLE');
    await withTransaction(this.db, async (tx) => {
      // 以 state = 'failed' 為條件更新：兩個人同時按重試，後到的會落空
      const retried = await this.jobs.retry(job.name, job.id, tx);
      if (!retried) throw new AppException('JOB_NOT_RETRYABLE');
      await this.audit.record(
        {
          action: 'job.retry',
          resourceType: 'job',
          resourceId: job.id,
          resourceName: job.name,
          actorId: actor.id,
          actorEmail: actor.email,
          changes: { before: { state: 'failed' }, after: { state: 'retry' } },
        },
        tx,
      );
    });
    return this.findOne(id);
  }

  private async findOrThrow(id: string): Promise<JobRecord> {
    const job = await this.store.find(this.jobs.names(), id);
    if (!job) throw new AppException('JOB_NOT_FOUND');
    return job;
  }
}

const EMPTY_COUNTS: JobQueueCounts = {
  readyCount: 0,
  deferredCount: 0,
  activeCount: 0,
  failedCount: 0,
  completedCount: 0,
};

function toSummaryDto(job: JobRecord): JobSummaryDto {
  return {
    id: job.id,
    name: job.name,
    state: job.state,
    retryCount: job.retryCount,
    retryLimit: job.retryLimit,
    createdOn: job.createdOn.toISOString(),
    startAfter: job.startAfter.toISOString(),
    startedOn: job.startedOn?.toISOString() ?? null,
    completedOn: job.completedOn?.toISOString() ?? null,
  };
}

function toDto(job: JobRecord): JobDto {
  return { ...toSummaryDto(job), data: job.data, output: job.output };
}
