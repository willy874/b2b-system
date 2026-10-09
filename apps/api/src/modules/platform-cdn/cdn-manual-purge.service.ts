import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import { JobQueue, JobStore } from '@/core/jobs';
import { CDN_PURGE_JOB, CdnConfig, CdnPathResolver } from '@/core/storage';
import type { CdnManualPurge } from '@/core/storage';
import { PlatformAdminService } from '@/modules/platform-admin/platform-admin.service';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type { CdnPurgeRequestDto, CdnPurgeResultDto } from './dto/platform-cdn.dto';
import { CDN_AUDIT_ACTION } from './platform-cdn.constants';

/** 還沒完成的工作狀態：同一時間只能有一筆這樣的「清空整個快取」。 */
const PENDING_STATES = ['created', 'retry', 'active'] as const;

/**
 * 手動清理（docs/architecture/backend/09-file.md §16.11）：路徑、資源（`CdnPathResolver`）或整個快取。排入 `cdn.purge`
 * （`manual` 帶著誰、清什麼），每個節點的結果在平台的背景工作列表看得到。
 *
 * 執行期關閉時照樣可以清理（§17 D13：邊緣還在、舊網址還有效）；部署層沒有 CDN 時 `409 CDN_NOT_DEPLOYED`。
 * 整個快取另要 `cdn:purgeAll`：路由只能宣告一組權限，所以由這裡檢查（拒絕時同樣寫 `authz.denied`）。
 */
@Injectable()
export class CdnManualPurgeService {
  constructor(
    private readonly config: CdnConfig,
    private readonly resolver: CdnPathResolver,
    private readonly queue: JobQueue,
    private readonly jobs: JobStore,
    private readonly admins: PlatformAdminService,
    private readonly audit: PlatformAuditService,
  ) {}

  async purge(dto: CdnPurgeRequestDto, actor: AuthUser): Promise<CdnPurgeResultDto> {
    if (!this.config.isDeployed) throw new AppException('CDN_NOT_DEPLOYED');
    if (!this.config.canPurge) {
      // 這個程序沒有清理端點：排進去的工作只會被略過
      throw new AppException('CDN_NOT_READY', {
        discovery: { ok: false, problem: 'purgeNotConfigured' },
      });
    }
    const { target } = dto;
    if (target.type === 'all') return this.purgeAll(actor);

    const resolved =
      target.type === 'paths'
        ? await this.resolver.pathsOf(target.tenantId, target.paths)
        : await this.resolver.resolve(target.tenantId, target.type, target.id);
    const manual: CdnManualPurge = {
      requestedBy: actor.id,
      tenantId: target.tenantId,
      target: target.type,
      ...(target.type !== 'paths' && { id: target.id }),
    };
    const size = this.config.purgeBatchSize();
    const jobIds: string[] = [];
    for (let start = 0; start < resolved.paths.length; start += size) {
      // oxlint-disable-next-line no-await-in-loop -- 批次數很少；依序入列讓回傳的 id 與批次對得上
      const id = await this.queue.enqueue(CDN_PURGE_JOB, {
        paths: resolved.paths.slice(start, start + size),
        manual,
      });
      if (id) jobIds.push(id);
    }
    await this.audit.record({
      action: CDN_AUDIT_ACTION.PURGE,
      resourceType: 'cdn',
      resourceId: target.tenantId,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: {
        tenantId: target.tenantId,
        target: target.type,
        ...(target.type !== 'paths' && { id: target.id }),
        paths: resolved.paths.length,
        jobIds,
        severity: 'normal',
      },
    });
    return { jobIds, paths: resolved.paths.length };
  }

  private async purgeAll(actor: AuthUser): Promise<CdnPurgeResultDto> {
    const permissions = await this.admins.permissionsOf(actor.id);
    if (!permissions.has('cdn:purgeAll')) {
      await this.audit.recordSafely({
        action: 'authz.denied',
        resourceType: 'authz',
        result: 'failure',
        actorId: actor.id,
        actorEmail: actor.email,
        errorCode: 'AUTHZ_FORBIDDEN',
        metadata: {
          route: 'POST /platform/cdn/purge',
          required: ['cdn:purgeAll'],
          missing: ['cdn:purgeAll'],
        },
      });
      throw new AppException('AUTHZ_FORBIDDEN', {
        required: ['cdn:purgeAll'],
        missing: ['cdn:purgeAll'],
      });
    }
    const { items } = await this.jobs.list({
      tenantId: null,
      names: [CDN_PURGE_JOB.name],
      state: [...PENDING_STATES],
      offset: 0,
      limit: 100,
    });
    const pending = items.find((job) => job.data?.all === true);
    if (pending) throw new AppException('CDN_PURGE_IN_PROGRESS', { jobId: pending.id });
    const id = await this.queue.enqueue(CDN_PURGE_JOB, {
      all: true,
      manual: { requestedBy: actor.id, tenantId: null, target: 'all' },
    });
    const jobIds = id ? [id] : [];
    await this.audit.record({
      action: CDN_AUDIT_ACTION.PURGE,
      resourceType: 'cdn',
      resourceId: null,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: { all: true, jobIds, severity: 'high' },
    });
    return { jobIds, paths: 'all' };
  }
}
