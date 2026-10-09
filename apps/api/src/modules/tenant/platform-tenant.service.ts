import { randomBytes } from 'node:crypto';

import { ChangeKind, ChangeSource, SessionRevokedReason } from '@b2b-system/realtime';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { SecretBox, TENANT_SECRET_PURPOSE } from '@/core/crypto';
import type { PlatformTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import {
  FeatureFlagService,
  pickKnownOverrides,
  toFeatureFlagOverrides,
} from '@/core/feature-flags';
import type { FeatureFlagDefinition } from '@/core/feature-flags';
import { JobQueue } from '@/core/jobs';
import { MfaMethodRegistry, MfaMethodSettings } from '@/core/mfa';
import { isValidBucketName } from '@/core/storage/object-storage';
import {
  findTenantFeatureParam,
  resolveTenantFeatureParam,
  Tenancy,
  TENANT_FEATURE_IMPACT_KEYS,
  TENANT_FEATURE_PARAMS,
  TenantDirectory,
  TenantFeatureImpacts,
  tenantFeatureParamProblem,
  toTenantFeatureParamOverrides,
  toTenantFeatures,
} from '@/core/tenant';
import type {
  TenantFeature,
  TenantFeatureParamDefinition,
  TenantFeatureParamOverrides,
  TenantFeatureParamValue,
} from '@/core/tenant';
import { usageDate, usageDateDaysBefore } from '@/core/usage';
import type { TenantStatus } from '@/db/platform/schema';
import { RefreshTokenService } from '@/modules/credential/refresh-token.service';
import { OidcProviderService } from '@/modules/oidc-provider/oidc-provider.service';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type {
  CreateTenantDto,
  ListPlatformTenantDto,
  PlatformTenantDto,
  PlatformTenantListDto,
  TenantFeatureImpactDto,
  TenantFeatureParamDto,
  UpdateTenantDto,
} from './dto/platform-tenant.dto';
import { PlatformTenantRepository } from './platform-tenant.repository';
import type { TenantWithDomains } from './platform-tenant.repository';
import { TENANT_PROVISION_JOB, TenantProvisioner } from './tenant-provisioner';
import { TENANT_USAGE_RECENT_DAYS, TENANT_USAGE_WARNING_RATIO } from './tenant-usage.constants';
import { toUsageSummary } from './tenant-usage.service';

/** 新租戶的 bucket：`b2b-{code}`；被用過（含刪除的租戶）就加上序號。 */
const BUCKET_PREFIX = 'b2b-';

/** 只留註冊表裡能給租戶用的方式，依註冊表的順序（同 `pickKnownOverrides`）。 */
function knownMfaMethods(
  overrides: Readonly<Record<string, boolean>>,
  registry: MfaMethodRegistry,
): Record<string, boolean> {
  return Object.fromEntries(
    registry
      .list('tenant')
      .map((method) => method.definition.id)
      .filter((id) => overrides[id] !== undefined)
      .map((id) => [id, overrides[id] as boolean]),
  );
}

function toDto(
  tenant: TenantWithDomains,
  flagCatalog: readonly FeatureFlagDefinition[],
  registry: MfaMethodRegistry,
): PlatformTenantDto {
  return {
    id: tenant.id,
    code: tenant.code,
    name: tenant.name,
    status: tenant.status,
    domains: tenant.domains,
    storageBucket: tenant.storageBucket,
    features: toTenantFeatures(tenant.features),
    flags: pickKnownOverrides(toFeatureFlagOverrides(tenant.flags), flagCatalog),
    mfaMethods: knownMfaMethods(toFeatureFlagOverrides(tenant.mfaMethods), registry),
    featureParams: toFeatureParamDtos(toTenantFeatureParamOverrides(tenant.featureParams)),
    adminEmail: tenant.adminEmail,
    provisionError: tenant.provisionError,
    provisionedAt: tenant.provisionedAt?.toISOString() ?? null,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}

const FEATURE_PARAMS: readonly TenantFeatureParamDefinition[] = TENANT_FEATURE_PARAMS;

/** 目錄上每個參數一項，帶生效值與定義（docs/architecture/05-tenancy.md §13.2 D3）。 */
function toFeatureParamDtos(overrides: TenantFeatureParamOverrides): TenantFeatureParamDto[] {
  return FEATURE_PARAMS.map((param) => {
    const isInteger = param.type === 'integer';
    return {
      key: param.key as TenantFeatureParamDto['key'],
      feature: param.feature,
      type: param.type,
      value: resolveTenantFeatureParam(param, overrides),
      defaultValue: param.defaultValue,
      overridden: overrides[param.key] !== undefined,
      unit: isInteger ? param.unit : null,
      min: isInteger ? param.min : null,
      max: isInteger ? param.max : null,
      foreverValue: isInteger ? (param.foreverValue ?? null) : null,
      maxLength: isInteger ? null : param.maxLength,
    };
  });
}

/** 兩張覆寫表是否相同（兩者都已依目錄的順序整理）。 */
function sameOverrides(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 把要改的參數套到現有的覆寫表上（docs/architecture/05-tenancy.md §13.2 D3）：`null` 或等於預設值的刪掉（只存覆寫值），其餘依目錄驗證。
 * 回傳依目錄順序整理過的新表；任何一項不合法就整批拒絕。
 */
function mergeFeatureParams(
  before: TenantFeatureParamOverrides,
  patch: Readonly<Partial<Record<string, TenantFeatureParamValue | null>>>,
): Record<string, TenantFeatureParamValue> {
  const next: Record<string, TenantFeatureParamValue> = { ...before };
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    const param = findTenantFeatureParam(key);
    if (!param) {
      fields[`featureParams.${key}`] = 'unknown feature param';
      continue;
    }
    if (value === null || value === undefined || value === param.defaultValue) {
      delete next[key];
      continue;
    }
    const problem = tenantFeatureParamProblem(param, value);
    if (problem) fields[`featureParams.${key}`] = problem;
    else next[key] = value;
  }
  if (Object.keys(fields).length) throw new AppException('VALIDATION_FAILED', { fields });
  return { ...toTenantFeatureParamOverrides(next) };
}

/**
 * 平台管理者的租戶管理（docs/architecture/05-tenancy.md §10.2 D12、D13）：建立並佈建、改名、網域、停用、刪除。
 * 只碰平台 DB 的登記；租戶內的資料只在佈建（`TenantProvisioner`）與停用時撤銷 session 時碰到。
 */
@Injectable()
export class PlatformTenantService {
  private readonly logger = new Logger(PlatformTenantService.name);
  private readonly secrets: SecretBox;
  private readonly baseDomain: string;
  private readonly authHost: string;

  constructor(
    private readonly repo: PlatformTenantRepository,
    private readonly provisioner: TenantProvisioner,
    private readonly jobs: JobQueue,
    private readonly tenancy: Tenancy,
    private readonly directory: TenantDirectory,
    private readonly refreshTokens: RefreshTokenService,
    private readonly oidc: OidcProviderService,
    private readonly events: DomainEventBus,
    private readonly audit: PlatformAuditService,
    private readonly flags: FeatureFlagService,
    private readonly impacts: TenantFeatureImpacts,
    private readonly mfaMethods: MfaMethodRegistry,
    private readonly mfaMethodSettings: MfaMethodSettings,
    config: ConfigService<Env, true>,
  ) {
    this.secrets = SecretBox.fromConfig(
      config.get('TENANT_SECRET_KEY', { infer: true }),
      config.get('JWT_SECRET', { infer: true }) ?? null,
      TENANT_SECRET_PURPOSE,
    );
    this.baseDomain =
      config.get('TENANT_BASE_DOMAIN', { infer: true }) ??
      new URL(config.get('APP_PUBLIC_URL', { infer: true })).host;
    this.authHost = new URL(config.get('PLATFORM_APP_URL', { infer: true })).host.toLowerCase();
  }

  async list(query: ListPlatformTenantDto): Promise<PlatformTenantListDto> {
    const recentFrom = usageDateDaysBefore(usageDate(), TENANT_USAGE_RECENT_DAYS - 1);
    const { items, total } = await this.repo.list({ ...query, recentFrom });
    return {
      items: items.map((item) =>
        Object.assign(toDto(item, this.flags.catalog, this.mfaMethods), {
          usage: toUsageSummary(item.usage),
        }),
      ),
      pagination: { offset: query.offset, limit: query.limit, total },
      baseDomain: this.baseDomain,
      usageRecentDays: TENANT_USAGE_RECENT_DAYS,
      usageWarningRatio: TENANT_USAGE_WARNING_RATIO,
    };
  }

  async get(id: string): Promise<PlatformTenantDto> {
    return toDto(await this.getExisting(id), this.flags.catalog, this.mfaMethods);
  }

  /**
   * 關閉 `feature` 會影響的數量：進入那個租戶，以擁有 feature 的模組登記的計數計算（`TenantFeatureImpacts`）。
   * 不看租戶狀態（停用的租戶也能改 feature）；進不了租戶的 DB 時回 `available: false`，確認框只顯示一般的說明。
   */
  async featureImpact(id: string, feature: TenantFeature): Promise<TenantFeatureImpactDto> {
    await this.getExisting(id);
    const counter = this.impacts.counterOf(feature);
    if (!counter) return { feature, available: true, items: [] };
    try {
      const counts = await this.tenancy.runForMaintenance(id, counter);
      return {
        feature,
        available: true,
        items: TENANT_FEATURE_IMPACT_KEYS.flatMap((key) => {
          const value = counts[key];
          return value === undefined ? [] : [{ key, count: value }];
        }),
      };
    } catch (error) {
      if (error instanceof AppException && error.code === 'TENANT_UNAVAILABLE') {
        return { feature, available: false, items: [] };
      }
      throw error;
    }
  }

  /** 登記租戶（`provisioning`）並把佈建交給背景工作；回應時 database 還沒建好。 */
  async create(dto: CreateTenantDto): Promise<PlatformTenantDto> {
    if (await this.repo.codeTaken(dto.code)) throw new AppException('TENANT_CODE_TAKEN');
    const domains = [...new Set([`${dto.code}.${this.baseDomain}`, ...dto.domains])];
    await this.assertDomainsAvailable(domains);

    const suffix = randomBytes(4).toString('hex');
    const databaseName = `tenant_${dto.code.replaceAll('-', '_')}_${suffix}`;
    const databaseUrl = this.provisioner.tenantDatabaseUrl(
      databaseName,
      randomBytes(24).toString('hex'),
    );
    const storageBucket = await this.nextBucket(dto.code);
    const created = await this.repo
      .transaction(async (tx) => {
        const row = await this.repo.create(
          {
            code: dto.code,
            name: dto.name,
            databaseUrlEncrypted: this.secrets.encrypt(databaseUrl),
            storageBucket,
            adminEmail: dto.adminEmail,
            adminName: dto.adminName ?? null,
          },
          domains,
          tx,
        );
        await this.audit.record(
          {
            action: 'tenant.create',
            resourceType: 'tenant',
            resourceId: row.id,
            metadata: { code: row.code, name: row.name, domains, adminEmail: dto.adminEmail },
          },
          tx,
        );
        return row;
      })
      .catch((error: unknown) => {
        // 同時建立同一個代碼或網域：唯一索引擋下
        if ((error as { code?: string }).code === '23505') {
          throw new AppException('TENANT_CODE_TAKEN');
        }
        throw error;
      });
    this.directory.invalidate();
    this.changed(ChangeKind.CREATE, created.id);
    await this.startProvisioning(created.id);
    return this.get(created.id);
  }

  async update(id: string, dto: UpdateTenantDto): Promise<PlatformTenantDto> {
    const before = await this.getExisting(id);
    const beforeFeatures = toTenantFeatures(before.features);
    // 存成 `TENANT_FEATURES` 的順序：比較、稽核的 before/after 都不受送出順序影響
    const features = dto.features && toTenantFeatures(dto.features);
    const featuresChanged =
      features !== undefined && features.join(',') !== beforeFeatures.join(',');
    const beforeFlags = pickKnownOverrides(
      toFeatureFlagOverrides(before.flags),
      this.flags.catalog,
    );
    const flags = dto.flags && this.knownFlagOverrides(dto.flags);
    const flagsChanged = flags !== undefined && !sameOverrides(flags, beforeFlags);
    const beforeParams = toTenantFeatureParamOverrides(before.featureParams);
    const featureParams = dto.featureParams && mergeFeatureParams(beforeParams, dto.featureParams);
    const beforeMfa = knownMfaMethods(toFeatureFlagOverrides(before.mfaMethods), this.mfaMethods);
    const mfaMethods = dto.mfaMethods && this.knownMfaMethodOverrides(dto.mfaMethods);
    await this.repo.transaction(async (tx) => {
      await this.repo.update(
        id,
        { name: dto.name, features, flags, featureParams, mfaMethods },
        undefined,
        tx,
      );
      await this.audit.record(
        {
          action: 'tenant.update',
          resourceType: 'tenant',
          resourceId: id,
          metadata: {
            code: before.code,
            before: {
              name: before.name,
              features: beforeFeatures,
              flags: beforeFlags,
              featureParams: beforeParams,
              mfaMethods: beforeMfa,
            },
            after: {
              name: dto.name ?? before.name,
              features: features ?? beforeFeatures,
              flags: flags ?? beforeFlags,
              featureParams: featureParams ?? beforeParams,
              mfaMethods: mfaMethods ?? beforeMfa,
            },
          },
        },
        tx,
      );
    });
    // 啟用的 feature（含外部 IdP）在租戶脈絡裡判斷：立即生效（多個執行個體時最多晚 TENANT_CACHE_TTL 秒）
    this.directory.invalidate();
    // 失效之後才通知：前端收到後重新取得的 profile 已經是新的清單（docs/architecture/frontend/02-plugin-system.md §9.2 D8）
    // flag 的變更走同一個事件：前端同樣是重新取得 profile（docs/architecture/05-tenancy.md §11.2 D7）
    if (featuresChanged || flagsChanged) {
      this.events.publish(DomainEvent.TENANT_FEATURES_CHANGED, { tenantId: id });
    }
    this.changed(ChangeKind.UPDATE, id);
    return this.get(id);
  }

  /**
   * 送來的覆寫表只接受目錄裡的 key（docs/architecture/05-tenancy.md §11.2 D1），依目錄的順序存：比較、稽核的 before/after 不受送出順序影響。
   * DB 裡殘留的舊 key（flag 已移除）不在目錄裡，整張表取代時自然被清掉。
   */
  private knownFlagOverrides(overrides: Record<string, boolean>): Record<string, boolean> {
    const unknown = Object.keys(overrides).filter((key) => !this.flags.has(key));
    if (unknown.length) {
      throw new AppException('VALIDATION_FAILED', {
        fields: Object.fromEntries(unknown.map((key) => [`flags.${key}`, 'unknown feature flag'])),
      });
    }
    return pickKnownOverrides(overrides, this.flags.catalog);
  }

  /** MFA 方式的租戶層開關只接受註冊表裡能給租戶用的方式（docs/architecture/backend/21-mfa.md §5）。 */
  private knownMfaMethodOverrides(overrides: Record<string, boolean>): Record<string, boolean> {
    const unknown = Object.keys(overrides).filter(
      (id) => !this.mfaMethods.get(id)?.definition.realms.includes('tenant'),
    );
    if (unknown.length) {
      throw new AppException('VALIDATION_FAILED', {
        fields: Object.fromEntries(unknown.map((id) => [`mfaMethods.${id}`, 'unknown MFA method'])),
      });
    }
    // 需要平台參數的方式在填齊之前不能對租戶開啟（§5.1）；關閉或回到預設都可以
    const unconfigured = Object.entries(overrides)
      .filter(([id, on]) => {
        const method = this.mfaMethods.get(id);
        return on && method !== undefined && !this.mfaMethodSettings.isConfigured(method);
      })
      .map(([id]) => id);
    if (unconfigured.length) {
      throw new AppException('MFA_METHOD_NOT_CONFIGURED', { methods: unconfigured });
    }
    return knownMfaMethods(overrides, this.mfaMethods);
  }

  /**
   * 佈建失敗後重試：每一步都冪等，已建好的 database 與角色會沿用。
   * 佈建途中程序被重啟的租戶（逾時仍在 `provisioning`）先改成 `failed`，一樣可以重試。
   */
  async retryProvisioning(id: string): Promise<PlatformTenantDto> {
    await this.provisioner.failStaleProvisioning();
    const tenant = await this.transitionAudited(
      id,
      ['failed'],
      { status: 'provisioning' },
      (t) => ({
        action: 'tenant.provision.retry',
        metadata: { code: t.code, previousError: t.provisionError },
      }),
    );
    this.directory.invalidate();
    this.changed(ChangeKind.UPDATE, id);
    await this.startProvisioning(tenant.id);
    return this.get(id);
  }

  /** 停用：網域回 503，撤銷所有 session（D13）。 */
  async disable(id: string): Promise<PlatformTenantDto> {
    const tenant = await this.getExisting(id);
    if (tenant.status !== 'active') throw new AppException('TENANT_STATUS_CONFLICT');
    // 先停用再收尾：停用之後就不會再有新的 session 產生
    await this.transitionAudited(id, ['active'], { status: 'disabled' }, (t) => ({
      action: 'tenant.disable',
      metadata: { code: t.code },
    }));
    this.directory.invalidate();
    await this.recordCleanup(tenant, 'tenant.disable', await this.endEverything(tenant));
    this.changed(ChangeKind.UPDATE, id);
    return this.get(id);
  }

  async enable(id: string): Promise<PlatformTenantDto> {
    const tenant = await this.transitionAudited(id, ['disabled'], { status: 'active' }, (t) => ({
      action: 'tenant.enable',
      metadata: { code: t.code },
    }));
    this.directory.invalidate();
    // 停用期間程序可能重啟過（啟動時只準備 active 的租戶）：補上每個租戶一份的初始資料
    await this.tenancy
      .run(id, async () => this.events.publish(DomainEvent.TENANT_ACTIVATED, {}))
      .catch((error: unknown) =>
        this.logger.warn({ err: error, tenant: tenant.code }, '重新啟用後無法進入租戶'),
      );
    this.changed(ChangeKind.UPDATE, id);
    return this.get(id);
  }

  /**
   * 刪除 = 標記刪除並停用、釋出網域（D13）。database 與 bucket 留著，由另一個需要確認的手動步驟清除；
   * 代碼之後可以給新的租戶用（新的 database 與 bucket）。
   */
  async remove(id: string): Promise<void> {
    // 佈建途中程序被重啟的租戶先改成 failed，才能刪除
    await this.provisioner.failStaleProvisioning();
    const tenant = await this.getExisting(id);
    if (tenant.status === 'provisioning') throw new AppException('TENANT_STATUS_CONFLICT');
    // 先停用、收尾，再標記刪除：刪除之後就找不到這個租戶，連不上它的 DB 撤銷 session
    await this.transition(id, ['active', 'disabled', 'failed'], { status: 'disabled' });
    this.directory.invalidate();
    const failedSteps = await this.endEverything(tenant);
    // 標記刪除、釋出網域與稽核同一個交易：不會留下「已刪除但網域還佔著」的中間狀態
    await this.repo.transaction(async (tx) => {
      await this.transition(id, ['disabled'], { status: 'disabled', deletedAt: new Date() }, tx);
      await this.repo.removeAllDomains(id, tx);
      await this.audit.record(
        {
          action: 'tenant.delete',
          resourceType: 'tenant',
          resourceId: id,
          metadata: {
            code: tenant.code,
            domains: tenant.domains,
            storageBucket: tenant.storageBucket,
            ...(failedSteps.length && { cleanupFailed: failedSteps }),
          },
        },
        tx,
      );
    });
    this.directory.invalidate();
    this.changed(ChangeKind.DELETE, id);
  }

  async addDomain(id: string, domain: string): Promise<PlatformTenantDto> {
    const tenant = await this.getExisting(id);
    if (tenant.domains.includes(domain)) return toDto(tenant, this.flags.catalog, this.mfaMethods);
    await this.assertDomainsAvailable([domain]);
    await this.repo
      .transaction(async (tx) => {
        if (!(await this.repo.lock(id, tx))) throw new AppException('TENANT_NOT_FOUND');
        await this.repo.addDomain(id, domain, tx);
        await this.audit.record(
          {
            action: 'tenant.domain.add',
            resourceType: 'tenant',
            resourceId: id,
            metadata: { code: tenant.code, domain },
          },
          tx,
        );
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === '23505') {
          throw new AppException('TENANT_DOMAIN_TAKEN', { domains: [domain] });
        }
        throw error;
      });
    this.directory.invalidate();
    this.changed(ChangeKind.UPDATE, id);
    return this.get(id);
  }

  async removeDomain(id: string, domain: string): Promise<PlatformTenantDto> {
    const tenant = await this.getExisting(id);
    if (!tenant.domains.includes(domain)) return toDto(tenant, this.flags.catalog, this.mfaMethods);
    // 「至少留一個網域」要在鎖住租戶之後、同一個交易裡數：兩個請求同時各移除一個時，後到的要看到前一個的結果
    await this.repo.transaction(async (tx) => {
      if (!(await this.repo.lock(id, tx))) throw new AppException('TENANT_NOT_FOUND');
      if ((await this.repo.countDomains(id, tx)) <= 1) {
        throw new AppException('TENANT_LAST_DOMAIN');
      }
      // 第一個是主要網域：信中的連結與「進入租戶」都導向它，移除後這些入口全部失效
      if (tenant.domains[0] === domain) throw new AppException('TENANT_PRIMARY_DOMAIN');
      if (!(await this.repo.removeDomain(id, domain, tx))) return;
      await this.audit.record(
        {
          action: 'tenant.domain.remove',
          resourceType: 'tenant',
          resourceId: id,
          metadata: { code: tenant.code, domain },
        },
        tx,
      );
    });
    this.directory.invalidate();
    this.changed(ChangeKind.UPDATE, id);
    return this.get(id);
  }

  // ── 內部 ─────────────────────────────────────────────

  /** 推給 apps/platform 上的平台管理者（docs/architecture/backend/08-realtime.md §3.6）；在交易與快取失效之後呼叫。 */
  private changed(kind: ChangeKind, id: string): void {
    this.events.publish(DomainEvent.PLATFORM_CHANGED, {
      changes: [{ resource: ChangeSource.PLATFORM_TENANT, kind, id }],
    });
  }

  private async getExisting(id: string): Promise<TenantWithDomains> {
    const tenant = await this.repo.findById(id);
    if (!tenant) throw new AppException('TENANT_NOT_FOUND');
    return tenant;
  }

  /**
   * 條件式地改狀態：目前狀態不在 `from` 裡（或併發被改掉）就 `TENANT_STATUS_CONFLICT`。
   * 快取的失效由呼叫端在交易 **之後** 做（CLAUDE.md 後端規則 6）。
   */
  private async transition(
    id: string,
    from: readonly TenantStatus[],
    patch: { status: TenantStatus; deletedAt?: Date },
    tx?: PlatformTransaction,
  ): Promise<TenantWithDomains> {
    const tenant = await this.getExisting(id);
    const updated = await this.repo.update(id, patch, from, tx);
    if (!updated) throw new AppException('TENANT_STATUS_CONFLICT');
    return tenant;
  }

  /** 改狀態與平台稽核在同一個交易：稽核寫不進去，狀態也不會變。 */
  private async transitionAudited(
    id: string,
    from: readonly TenantStatus[],
    patch: { status: TenantStatus },
    audit: (tenant: TenantWithDomains) => { action: string; metadata: Record<string, unknown> },
  ): Promise<TenantWithDomains> {
    return this.repo.transaction(async (tx) => {
      const tenant = await this.transition(id, from, patch, tx);
      const { action, metadata } = audit(tenant);
      await this.audit.record({ action, resourceType: 'tenant', resourceId: id, metadata }, tx);
      return tenant;
    });
  }

  /** 收尾步驟有失敗時補一筆稽核（狀態已經改好，收尾可以重做）。 */
  private async recordCleanup(
    tenant: TenantWithDomains,
    action: string,
    failedSteps: string[],
  ): Promise<void> {
    if (!failedSteps.length) return;
    await this.audit.recordSafely({
      action: `${action}.cleanup`,
      resourceType: 'tenant',
      resourceId: tenant.id,
      result: 'failure',
      metadata: { code: tenant.code, failedSteps },
    });
  }

  private async startProvisioning(id: string): Promise<void> {
    try {
      await this.jobs.enqueue(TENANT_PROVISION_JOB, { tenantId: id });
    } catch (error) {
      // 沒排進佇列就停在 failed，讓平台管理者可以重試（不會卡在「佈建中」）
      this.logger.error({ err: error, tenantId: id }, '佈建工作入列失敗');
      await this.repo.update(id, { status: 'failed', provisionError: '佈建工作入列失敗，請重試' }, [
        'provisioning',
      ]);
    }
  }

  /** 撤銷租戶的所有 session；租戶的 DB 連不上時不擋停用（停用後網域一律 503，session 也用不了）。 */
  /**
   * 停用、刪除之後的收尾（D13）：撤銷租戶的 app session、結束它的帳號在 IdP 的 session 與 grant
   * （重新啟用後不能靠舊的 IdP session 直接登回來）、斷掉它的即時連線、關掉連線池。
   * 每一步各自獨立：租戶的 DB 連不上時仍然結束 IdP session 與連線（停用後網域一律 503，app session 本來就用不了）。
   */
  private async endEverything(tenant: TenantWithDomains): Promise<string[]> {
    const failed: string[] = [];
    const attempt = async (step: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        this.logger.warn({ err: error, tenant: tenant.code, step }, '停用租戶的收尾步驟失敗');
        failed.push(step);
      }
    };
    await attempt('refreshTokens', () =>
      this.tenancy.runForMaintenance(tenant.id, () =>
        this.refreshTokens.revokeAll('tenant_disabled'),
      ),
    );
    await attempt('idpSessions', () => this.oidc.endTenantSessions(tenant.id));
    this.events.publish(DomainEvent.SESSIONS_REVOKED, {
      tenantIds: [tenant.id],
      reason: SessionRevokedReason.TENANT_UNAVAILABLE,
    });
    await attempt('pool', () => this.tenancy.evict(tenant.id));
    return failed;
  }

  private async assertDomainsAvailable(domains: string[]): Promise<void> {
    const taken = await this.repo.domainsTaken(domains);
    // apps/platform 的網域不屬於任何租戶（D2）
    if (domains.includes(this.authHost)) taken.push(this.authHost);
    if (taken.length) throw new AppException('TENANT_DOMAIN_TAKEN', { domains: taken });
  }

  private async nextBucket(code: string): Promise<string> {
    const base = `${BUCKET_PREFIX}${code}`;
    const used = await this.repo.bucketsLike(base);
    let bucket = base;
    for (let n = 2; used.has(bucket); n += 1) bucket = `${base}-${n}`;
    if (!isValidBucketName(bucket)) {
      throw new AppException('VALIDATION_FAILED', {
        fields: { code: 'derives an invalid storage bucket name' },
      });
    }
    return bucket;
  }
}
