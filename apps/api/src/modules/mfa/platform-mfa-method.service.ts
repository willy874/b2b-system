import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import { PLATFORM_DB, withTransaction } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import { AppException } from '@/core/errors';
import { resolveToggle } from '@/core/feature-flags';
import { defineJob, JobQueue } from '@/core/jobs';
import { MfaMethodRegistry, MfaMethodSettings } from '@/core/mfa';
import { Tenancy, TenantDirectory } from '@/core/tenant';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type {
  MfaMethodImpactDto,
  MfaMethodSettingsDto,
  PlatformMfaMethodDto,
  UpdateMfaMethodSettingsDto,
  UpdatePlatformMfaMethodDto,
} from './dto/mfa.dto';
import { MfaAvailability } from './mfa-availability.service';
import { MfaMethodOverrideRepository } from './mfa-method-override.repository';
import { MfaMethodOverrideService } from './mfa-method-override.service';
import { MfaMethodSettingsService } from './mfa-method-settings.service';
import { methodInfoOf } from './mfa.service';
import { PlatformMfaRepository } from './platform-mfa.repository';
import { TenantMfaRepository } from './tenant-mfa.repository';

/** 每日統計各方式已設定的因子數（跨所有租戶，平台開關頁用；§5）。 */
export const MFA_FACTOR_STATS_JOB = defineJob<Record<string, never>>('mfa.factorStats', {
  exclusive: true,
  retryLimit: 2,
  retryDelaySeconds: 300,
  scope: 'platform',
});

/**
 * 平台管理者的 MFA 方式開關（docs/architecture/backend/21-mfa.md §5、D4）：全平台層的覆寫、影響人數、每日統計。
 * 租戶層的開關在 `PATCH /platform/tenants/:id` 的 `mfaMethods`（`tenant` 模組）。
 */
@Injectable()
export class PlatformMfaMethodService implements OnModuleInit {
  private readonly logger = new Logger(PlatformMfaMethodService.name);

  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDatabase,
    private readonly registry: MfaMethodRegistry,
    private readonly repo: MfaMethodOverrideRepository,
    private readonly overrides: MfaMethodOverrideService,
    private readonly availability: MfaAvailability,
    private readonly audit: PlatformAuditService,
    private readonly directory: TenantDirectory,
    private readonly tenancy: Tenancy,
    private readonly tenantFactors: TenantMfaRepository,
    private readonly platformFactors: PlatformMfaRepository,
    private readonly jobs: JobQueue,
    private readonly config: ConfigService<Env, true>,
    private readonly settings: MfaMethodSettingsService,
    private readonly settingsAccess: MfaMethodSettings,
  ) {}

  onModuleInit(): void {
    this.jobs.register(MFA_FACTOR_STATS_JOB, () => this.computeStats(), {
      cron: this.config.get('AUTH_TOKEN_CLEANUP_CRON', { infer: true }),
    });
  }

  async list(): Promise<{ items: PlatformMfaMethodDto[] }> {
    const [tenantOverrides, stats] = await Promise.all([
      this.repo.countTenantOverrides(),
      this.repo.listStats(),
    ]);
    const statsByMethod = new Map(stats.map((row) => [row.method, row]));
    const platformAdminMethods = this.availability.platformAdminMethodIds();
    return {
      items: this.registry.list().map((method) => {
        const { id, realms, defaultEnabled } = method.definition;
        const global = this.overrides.globalStateOf(id);
        const stat = statsByMethod.get(id);
        return {
          ...methodInfoOf(method),
          settings: this.settings.summaryOf(method),
          realms: [...realms],
          defaultEnabled,
          globalState: global ?? 'default',
          effective: resolveToggle(defaultEnabled, global, undefined),
          tenantOverrides: tenantOverrides.get(id) ?? { on: 0, off: 0 },
          stats: stat
            ? {
                tenantFactors: stat.tenantFactors,
                tenants: stat.tenants,
                platformFactors: stat.platformFactors,
                computedAt: stat.computedAt.toISOString(),
              }
            : null,
          // env 列了但參數還沒填齊時平台管理者實際上不能用
          platformAdminEnabled:
            platformAdminMethods.has(id) && this.settingsAccess.isConfigured(method),
        };
      }),
    };
  }

  async update(
    methodId: string,
    dto: UpdatePlatformMfaMethodDto,
    actor: AuthUser,
  ): Promise<PlatformMfaMethodDto> {
    const method = this.registry.get(methodId);
    if (!method) throw new AppException('MFA_METHOD_NOT_FOUND');
    // 必填的平台參數沒有填齊之前不能開啟（§5.1）；關閉、回到預設（需要參數的方式預設一律是關）都可以
    if (
      resolveToggle(
        method.definition.defaultEnabled,
        dto.state === 'default' ? undefined : dto.state,
        undefined,
      ) &&
      !this.settingsAccess.isConfigured(method)
    ) {
      throw new AppException('MFA_METHOD_NOT_CONFIGURED', { methods: [methodId] });
    }
    const before = this.overrides.globalStateOf(methodId) ?? 'default';
    await withTransaction(this.db, async (tx) => {
      await this.repo.setGlobal(methodId, dto.state === 'default' ? null : dto.state, actor.id, tx);
      await this.audit.record(
        {
          action: 'mfaMethod.update',
          resourceType: 'mfaMethod',
          resourceId: methodId,
          actorId: actor.id,
          actorEmail: actor.email,
          metadata: { before, after: dto.state, ...(dto.state === 'off' && { severity: 'high' }) },
        },
        tx,
      );
    });
    // 本機立即生效，再通知其他程序（不只靠 TTL）
    await this.overrides.changed();
    const item = (await this.list()).items.find((candidate) => candidate.id === methodId);
    if (!item) throw new AppException('MFA_METHOD_NOT_FOUND');
    return item;
  }

  // ── 平台參數（§5.1）──────────────────────────────────

  getSettings(methodId: string): MfaMethodSettingsDto {
    return this.settings.view(methodId);
  }

  saveSettings(
    methodId: string,
    dto: UpdateMfaMethodSettingsDto,
    actor: AuthUser,
  ): Promise<MfaMethodSettingsDto> {
    return this.settings.save(methodId, dto, actor);
  }

  async clearSettings(methodId: string, actor: AuthUser): Promise<MfaMethodSettingsDto> {
    const overrides = await this.repo.countTenantOverrides();
    return this.settings.clear(
      methodId,
      {
        globalOn: this.overrides.globalStateOf(methodId) === 'on',
        tenantsOn: overrides.get(methodId)?.on ?? 0,
        platformAdmins: this.availability.platformAdminMethodIds().has(methodId),
      },
      actor,
    );
  }

  /**
   * 關掉這個方式會被擋在門外的人數（§5）：只剩這種因子（或其他也不能用的）、沒有備用碼的人。在每個租戶的脈絡裡查
   * （docs/architecture/05-tenancy.md §12.5 的做法）；`tenantId` 有值時只看那個租戶。進不去的租戶略過並計數。
   */
  async impact(methodId: string, tenantId?: string): Promise<MfaMethodImpactDto> {
    if (!this.registry.get(methodId)) throw new AppException('MFA_METHOD_NOT_FOUND');
    const targets = tenantId
      ? [await this.directory.findById(tenantId)].filter((tenant) => tenant !== undefined)
      : await this.directory.listActive();
    if (tenantId && targets.length === 0) throw new AppException('TENANT_NOT_FOUND');
    let stranded = 0;
    let skipped = 0;
    for (const tenant of targets) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- 依序進每個租戶，不同時開一堆連線池
        stranded += await this.tenancy.run(tenant.id, async () => {
          const remaining = (await this.availability.methodsFor('tenant'))
            .map((method) => method.definition.id)
            .filter((id) => id !== methodId);
          return this.tenantFactors.countStranded(remaining);
        });
      } catch (error) {
        skipped += 1;
        this.logger.warn({ err: error, tenantId: tenant.id }, '計算 MFA 方式的影響時進不了租戶');
      }
    }
    return { stranded, tenants: targets.length - skipped, skippedTenants: skipped };
  }

  /** 每日統計：各租戶各方式的 active 因子數加總，加上平台管理者的。 */
  async computeStats(): Promise<{ tenants: number; skipped: number }> {
    const totals = new Map<string, { tenantFactors: number; tenants: number }>();
    const tenants = await this.directory.listActive();
    let skipped = 0;
    for (const tenant of tenants) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- 依序進每個租戶
        const counts = await this.tenancy.run(tenant.id, () =>
          this.tenantFactors.countActiveFactorsByMethod(),
        );
        for (const [method, count] of counts) {
          const total = totals.get(method) ?? { tenantFactors: 0, tenants: 0 };
          totals.set(method, {
            tenantFactors: total.tenantFactors + count,
            tenants: total.tenants + 1,
          });
        }
      } catch (error) {
        skipped += 1;
        this.logger.warn({ err: error, tenantId: tenant.id }, '統計 MFA 因子時進不了租戶');
      }
    }
    const platform = await this.platformFactors.countActiveFactorsByMethod();
    const methods = new Set([...totals.keys(), ...platform.keys()]);
    await this.repo.replaceStats(
      [...methods].map((method) => ({
        method,
        tenantFactors: totals.get(method)?.tenantFactors ?? 0,
        tenants: totals.get(method)?.tenants ?? 0,
        platformFactors: platform.get(method) ?? 0,
      })),
    );
    return { tenants: tenants.length - skipped, skipped };
  }
}
