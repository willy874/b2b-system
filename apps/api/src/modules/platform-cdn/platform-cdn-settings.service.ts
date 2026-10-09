import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import { PLATFORM_DB, withTransaction } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import { AppException } from '@/core/errors';
import { JobStore } from '@/core/jobs';
import {
  CDN_MIN_URL_TTL,
  CDN_PURGE_JOB,
  CdnConfig,
  CdnPathResolver,
  CdnSettings,
  resolveCdnEffective,
} from '@/core/storage';
import type { CdnEffective, CdnResource, CdnStoredOverrides } from '@/core/storage';
import type { CdnSettingsRow } from '@/db/platform/schema';
import { PlatformAdminService } from '@/modules/platform-admin/platform-admin.service';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import { nodeProblemsOf } from './cdn-check';
import { CdnHealthService, kidsOf } from './cdn-health.service';
import type {
  CdnCheckResultDto,
  CdnOverviewDto,
  UpdateCdnSettingsDto,
} from './dto/platform-cdn.dto';
import { CDN_AUDIT_ACTION, CDN_RECENT_PURGES } from './platform-cdn.constants';
import { PlatformCdnRepository } from './platform-cdn.repository';

const OVERRIDE_FIELDS = [
  'state',
  'resources',
  'urlTtlCap',
  'purgeOnDelete',
  'purgeBatchSize',
] as const;
type OverrideField = (typeof OVERRIDE_FIELDS)[number];

/** 這次寫入之後 **新** 開始簽 CDN 網址的資源：執行期由關到開、或加入資源類型（開啟前要通過節點檢查，§17 D14）。 */
export function newlyServed(before: CdnEffective, after: CdnEffective): CdnResource[] {
  if (!after.serving) return [];
  const served = new Set(before.serving ? before.resources : []);
  return after.resources.filter((resource) => !served.has(resource));
}

/**
 * apps/platform 的 CDN 頁面（docs/architecture/backend/09-file.md §16.9～§16.12）：部署資訊、執行期的設定、邊緣狀態。
 *
 * - 寫入帶 `version`（樂觀鎖），稽核 `cdn.update` 在同一個交易內；提交後 `CdnSettings.changed()` 本機重讀並廣播（`cdn_settings`），
 *   各程序在幾秒內（最晚 `TENANT_CACHE_TTL`）改用新的生效值，不必重啟。
 * - 關閉不檢查；開啟或加入資源類型前必須通過節點檢查，不提供強制略過（§17 D14）。
 */
@Injectable()
export class PlatformCdnSettingsService {
  private readonly healthCheckCron: string | null;

  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDatabase,
    private readonly repo: PlatformCdnRepository,
    private readonly config: CdnConfig,
    private readonly settings: CdnSettings,
    private readonly health: CdnHealthService,
    private readonly resolver: CdnPathResolver,
    private readonly jobs: JobStore,
    private readonly admins: PlatformAdminService,
    private readonly audit: PlatformAuditService,
    env: ConfigService<Env, true>,
  ) {
    this.healthCheckCron = config.isDeployed
      ? env.get('FILE_CDN_HEALTH_CHECK_CRON', { infer: true }) || null
      : null;
  }

  /** 以 DB 為準（不讀快取）：別的執行個體剛改過，這裡也要看得到。 */
  async overview(): Promise<CdnOverviewDto> {
    const deployment = this.deploymentView();
    if (!this.config.isDeployed) {
      return {
        deployment,
        settings: null,
        effective: null,
        lastCheck: null,
        recentPurges: [],
        purgeTargets: [],
      };
    }
    const [row, purges] = await Promise.all([this.repo.find(), this.recentPurges()]);
    const effective = resolveCdnEffective(this.config.deploymentLimits, row);
    return {
      deployment,
      settings: await this.storedView(row),
      effective: {
        ...effective,
        issuedUrlsExpireAt:
          !effective.serving && row?.stateChangedAt
            ? new Date(row.stateChangedAt.getTime() + effective.urlTtlCap * 1000).toISOString()
            : null,
      },
      lastCheck: row?.lastCheck ?? null,
      recentPurges: purges,
      purgeTargets: this.resolver.registered(),
    };
  }

  /** 執行檢查（`cdn:read`）：10 秒內重複呼叫回上一次的結果。 */
  async check(): Promise<CdnCheckResultDto> {
    this.requireDeployed();
    return this.health.check();
  }

  async update(dto: UpdateCdnSettingsDto, actor: AuthUser): Promise<CdnOverviewDto> {
    this.requireDeployed();
    const limits = this.config.deploymentLimits;
    const current = await this.repo.find();
    if ((current?.version ?? 1) !== dto.version) {
      throw new AppException('CDN_SETTINGS_VERSION_CONFLICT', { current: current?.version ?? 1 });
    }
    const before = storedOf(current);
    const after: CdnStoredOverrides = { ...before };
    for (const field of OVERRIDE_FIELDS) {
      if (dto[field] !== undefined) Object.assign(after, { [field]: dto[field] });
    }
    this.validate(after, dto);
    const changed = OVERRIDE_FIELDS.filter((field) => !sameValue(before[field], after[field]));
    if (changed.length === 0) return this.overview();

    const effectiveBefore = resolveCdnEffective(limits, before);
    const effectiveAfter = resolveCdnEffective(limits, after);
    const opening = newlyServed(effectiveBefore, effectiveAfter);
    if (opening.length > 0) {
      // 開啟要看現在的狀態：不沿用 10 秒內的結果（剛修好的節點、或剛壞掉的節點都要反映出來）
      const result = await this.health.check({ reuseWithinMs: 0 });
      if (!result.ready) {
        throw new AppException('CDN_NOT_READY', {
          resources: opening,
          discovery: result.discovery,
          nodes: nodeProblemsOf(result),
        });
      }
    }

    const stateChanged = changed.includes('state');
    await withTransaction(this.db, async (tx) => {
      const saved = await this.repo.save(
        {
          ...after,
          stateChangedAt: stateChanged ? new Date() : (current?.stateChangedAt ?? null),
          stateChangedBy: stateChanged ? actor.id : (current?.stateChangedBy ?? null),
          updatedBy: actor.id,
        },
        dto.version,
        tx,
      );
      if (!saved) {
        throw new AppException('CDN_SETTINGS_VERSION_CONFLICT', {
          current: (await this.repo.find(tx))?.version ?? 1,
        });
      }
      await this.audit.record(
        {
          action: CDN_AUDIT_ACTION.UPDATE,
          resourceType: 'cdn',
          resourceId: null,
          actorId: actor.id,
          actorEmail: actor.email,
          metadata: {
            // 存放值，不是生效值（生效值會隨環境變數改變）
            before: pick(before, changed),
            after: pick(after, changed),
            severity: stateChanged ? 'high' : 'normal',
          },
        },
        tx,
      );
    });
    // 交易後才重讀並廣播：rollback 時其他程序不會讀到不存在的設定
    await this.settings.changed();
    return this.overview();
  }

  private validate(after: CdnStoredOverrides, dto: UpdateCdnSettingsDto): void {
    const limits = this.config.deploymentLimits;
    const fields: Record<string, string> = {};
    if (dto.resources?.some((resource) => !limits.resources.has(resource))) {
      // 部署沒有開放的資源不能選（環境變數縮小上限之後的舊值讀取時裁切，不在這裡擋）
      fields.resources = 'CDN_RESOURCE_NOT_DEPLOYED';
    }
    if (
      dto.urlTtlCap !== undefined &&
      dto.urlTtlCap !== null &&
      (dto.urlTtlCap < CDN_MIN_URL_TTL || dto.urlTtlCap > limits.maxUrlTtl)
    ) {
      fields.urlTtlCap = 'CDN_URL_TTL_OUT_OF_RANGE';
    }
    if (after.purgeOnDelete === true && dto.purgeOnDelete === true && !this.config.canPurge) {
      fields.purgeOnDelete = 'CDN_PURGE_NOT_CONFIGURED';
    }
    if (Object.keys(fields).length > 0) {
      throw new AppException('VALIDATION_FAILED', {
        fields,
        ...(fields.urlTtlCap && { min: CDN_MIN_URL_TTL, max: limits.maxUrlTtl }),
      });
    }
  }

  private requireDeployed(): void {
    if (!this.config.isDeployed) throw new AppException('CDN_NOT_DEPLOYED');
  }

  private deploymentView(): CdnOverviewDto['deployment'] {
    const deployment = this.config.deployment;
    const limits = this.config.deploymentLimits;
    return {
      deployed: Boolean(deployment),
      provider: deployment?.provider ?? null,
      origin: deployment?.origin ?? null,
      signingKid: deployment?.signingKeys.signing.kid ?? null,
      kids: deployment ? kidsOf(deployment) : [],
      resources: [...limits.resources],
      minUrlTtl: CDN_MIN_URL_TTL,
      maxUrlTtl: limits.maxUrlTtl,
      purgeConfigured: this.config.canPurge,
      purgeOnDelete: limits.purgeOnDelete,
      purgeBatchSize: limits.purgeBatchSize,
      healthCheckCron: this.healthCheckCron,
    };
  }

  private async storedView(
    row: CdnSettingsRow | undefined,
  ): Promise<NonNullable<CdnOverviewDto['settings']>> {
    const changedBy = row?.stateChangedBy
      ? await this.admins.findById(row.stateChangedBy).catch(() => undefined)
      : undefined;
    return {
      ...storedOf(row),
      stateChangedAt: row?.stateChangedAt?.toISOString() ?? null,
      stateChangedBy: row?.stateChangedBy
        ? { id: row.stateChangedBy, email: changedBy?.email ?? null }
        : null,
      version: row?.version ?? 1,
      updatedAt: row && row.version > 1 ? row.updatedAt.toISOString() : null,
    };
  }

  private async recentPurges(): Promise<CdnOverviewDto['recentPurges']> {
    const { items } = await this.jobs.list({
      tenantId: null,
      names: [CDN_PURGE_JOB.name],
      offset: 0,
      limit: CDN_RECENT_PURGES,
    });
    return items.map((job) => {
      const data = job.data ?? {};
      const paths = Array.isArray(data.paths) ? data.paths.length : 'all';
      const manual = data.manual as CdnOverviewDto['recentPurges'][number]['manual'] | undefined;
      return {
        id: job.id,
        state: job.state,
        createdOn: job.createdOn.toISOString(),
        completedOn: job.completedOn?.toISOString() ?? null,
        paths: data.all === true ? 'all' : paths,
        manual: manual ?? null,
      };
    });
  }
}

function storedOf(row: CdnSettingsRow | undefined): CdnStoredOverrides {
  return {
    state: row?.state ?? null,
    resources: row?.resources ?? null,
    urlTtlCap: row?.urlTtlCap ?? null,
    purgeOnDelete: row?.purgeOnDelete ?? null,
    purgeBatchSize: row?.purgeBatchSize ?? null,
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && [...a].toSorted().every((value, i) => value === [...b].toSorted()[i])
    );
  }
  return a === b;
}

function pick(
  values: CdnStoredOverrides,
  fields: readonly OverrideField[],
): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, values[field]]));
}
