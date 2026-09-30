import { Injectable } from '@nestjs/common';

import { AppException } from '@/core/errors';
import { paginated } from '@/core/http';
import type { PaginatedResult } from '@/core/http';
import { JobQueue, JobStore } from '@/core/jobs';
import type { JobOwnerFilter, JobQueueCounts, JobRecord } from '@/core/jobs';
import { TenantDirectory } from '@/core/tenant';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type {
  ListPlatformJobDto,
  PlatformJobDto,
  PlatformJobQueueListDto,
  PlatformJobSummaryDto,
} from './dto/job.dto';

/** `tenant=platform` 只看平台工作（`platform` 是保留字，不會是租戶代碼）。 */
const PLATFORM_OWNER = 'platform';

const EMPTY_COUNTS: JobQueueCounts = {
  readyCount: 0,
  deferredCount: 0,
  activeCount: 0,
  failedCount: 0,
  completedCount: 0,
};

/**
 * 平台的背景工作監控（apps/auth，docs/adr/0020-physical-tenant-isolation.md D23、D15）：
 * 佇列是全平台共用的，這裡看得到每個租戶與平台自己的工作。租戶的後台（`JobService`）只看自己租戶的。
 * 重試寫平台稽核。
 */
@Injectable()
export class PlatformJobService {
  constructor(
    private readonly jobs: JobQueue,
    private readonly store: JobStore,
    private readonly directory: TenantDirectory,
    private readonly audit: PlatformAuditService,
  ) {}

  async queues(): Promise<PlatformJobQueueListDto> {
    const definitions = this.jobs.definitions();
    const counts = await this.store.counts(
      undefined,
      definitions.map((definition) => definition.name),
    );
    return {
      items: definitions.map(({ name, cron, scope }) =>
        Object.assign({ name, cron, scope }, counts.get(name) ?? EMPTY_COUNTS),
      ),
    };
  }

  async list(query: ListPlatformJobDto): Promise<PaginatedResult<PlatformJobSummaryDto>> {
    const { tenant, ...filter } = query;
    const owner = await this.ownerOf(tenant);
    if (owner === 'none') return paginated([], 0, query);
    const { items, total } = await this.store.list({
      tenantId: owner,
      names: this.names(),
      ...filter,
    });
    const codes = await this.tenantCodes(items);
    return paginated(
      items.map((job) => toSummaryDto(job, codes)),
      total,
      query,
    );
  }

  async findOne(id: string): Promise<PlatformJobDto> {
    const job = await this.findOrThrow(id);
    const codes = await this.tenantCodes([job]);
    return { ...toSummaryDto(job, codes), data: job.data, output: job.output };
  }

  /** 只接受 `failed`（同租戶的重試）；以 state 為條件，兩個人同時按時後到的會落空。 */
  async retry(id: string): Promise<PlatformJobDto> {
    const job = await this.findOrThrow(id);
    if (job.state !== 'failed') throw new AppException('JOB_NOT_RETRYABLE');
    const retried = await this.jobs.retry(job.name, job.id);
    if (!retried) throw new AppException('JOB_NOT_RETRYABLE');
    await this.audit.record({
      action: 'platformJob.retry',
      resourceType: 'job',
      resourceId: job.id,
      metadata: { name: job.name, tenantId: job.tenantId },
    });
    return this.findOne(id);
  }

  private names(): string[] {
    return this.jobs.definitions().map((definition) => definition.name);
  }

  /** 查詢的 `tenant` → 工作的擁有者；代碼不存在時什麼都不回（`none`）。 */
  private async ownerOf(tenant: string | undefined): Promise<JobOwnerFilter | 'none'> {
    if (!tenant) return undefined;
    if (tenant === PLATFORM_OWNER) return null;
    const record = await this.directory.findByCode(tenant);
    return record?.id ?? 'none';
  }

  private async findOrThrow(id: string): Promise<JobRecord> {
    const job = await this.store.find(undefined, this.names(), id);
    if (!job) throw new AppException('JOB_NOT_FOUND');
    return job;
  }

  private async tenantCodes(jobs: JobRecord[]): Promise<Map<string, string>> {
    const ids = [...new Set(jobs.map((job) => job.tenantId).filter((id) => id !== null))];
    const records = await Promise.all(ids.map((id) => this.directory.findById(id)));
    return new Map(records.filter((record) => record !== undefined).map((r) => [r.id, r.code]));
  }
}

function toSummaryDto(job: JobRecord, codes: Map<string, string>): PlatformJobSummaryDto {
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
    tenantId: job.tenantId,
    tenantCode: job.tenantId ? (codes.get(job.tenantId) ?? null) : null,
  };
}
