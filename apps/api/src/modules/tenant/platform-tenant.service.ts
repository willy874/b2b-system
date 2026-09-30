import { randomBytes } from 'node:crypto';

import { SessionRevokedReason } from '@b2b-system/realtime';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { SecretBox, TENANT_SECRET_PURPOSE } from '@/core/crypto';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { JobQueue } from '@/core/jobs';
import { isValidBucketName } from '@/core/storage/object-storage';
import { Tenancy, TenantDirectory } from '@/core/tenant';
import type { TenantStatus } from '@/db/platform/schema';
import { AuthService } from '@/modules/auth/auth.service';
import { OidcProviderService } from '@/modules/oidc-provider/oidc-provider.service';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type {
  CreateTenantDto,
  ListPlatformTenantDto,
  PlatformTenantDto,
  PlatformTenantListDto,
  UpdateTenantDto,
} from './dto/platform-tenant.dto';
import { PlatformTenantRepository } from './platform-tenant.repository';
import type { TenantWithDomains } from './platform-tenant.repository';
import { TENANT_PROVISION_JOB, TenantProvisioner } from './tenant-provisioner';

/** 新租戶的 bucket：`b2b-{code}`；被用過（含刪除的租戶）就加上序號。 */
const BUCKET_PREFIX = 'b2b-';

function toDto(tenant: TenantWithDomains): PlatformTenantDto {
  return {
    id: tenant.id,
    code: tenant.code,
    name: tenant.name,
    status: tenant.status,
    domains: tenant.domains,
    storageBucket: tenant.storageBucket,
    allowExternalIdp: tenant.allowExternalIdp,
    adminEmail: tenant.adminEmail,
    provisionError: tenant.provisionError,
    provisionedAt: tenant.provisionedAt?.toISOString() ?? null,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}

/**
 * 平台管理者的租戶管理（docs/adr/0020-physical-tenant-isolation.md D12、D13）：建立並佈建、改名、網域、停用、刪除。
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
    private readonly auth: AuthService,
    private readonly oidc: OidcProviderService,
    private readonly events: DomainEventBus,
    private readonly audit: PlatformAuditService,
    config: ConfigService<Env, true>,
  ) {
    this.secrets = SecretBox.fromConfig(
      config.get('TENANT_SECRET_KEY', { infer: true }),
      config.get('JWT_SECRET', { infer: true }),
      TENANT_SECRET_PURPOSE,
    );
    this.baseDomain =
      config.get('TENANT_BASE_DOMAIN', { infer: true }) ??
      new URL(config.get('APP_PUBLIC_URL', { infer: true })).host;
    this.authHost = new URL(config.get('AUTH_APP_URL', { infer: true })).host.toLowerCase();
  }

  async list(query: ListPlatformTenantDto): Promise<PlatformTenantListDto> {
    const { items, total } = await this.repo.list(query);
    return {
      items: items.map(toDto),
      pagination: { offset: query.offset, limit: query.limit, total },
      baseDomain: this.baseDomain,
    };
  }

  async get(id: string): Promise<PlatformTenantDto> {
    return toDto(await this.getExisting(id));
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
    const created = await this.repo
      .create(
        {
          code: dto.code,
          name: dto.name,
          databaseUrlEncrypted: this.secrets.encrypt(databaseUrl),
          storageBucket: await this.nextBucket(dto.code),
          adminEmail: dto.adminEmail,
          adminName: dto.adminName ?? null,
        },
        domains,
      )
      .catch((error: unknown) => {
        // 同時建立同一個代碼或網域：唯一索引擋下
        if ((error as { code?: string }).code === '23505') {
          throw new AppException('TENANT_CODE_TAKEN');
        }
        throw error;
      });
    this.directory.invalidate();
    await this.audit.record({
      action: 'tenant.create',
      resourceType: 'tenant',
      resourceId: created.id,
      metadata: { code: created.code, name: created.name, domains, adminEmail: dto.adminEmail },
    });
    await this.startProvisioning(created.id);
    return this.get(created.id);
  }

  async update(id: string, dto: UpdateTenantDto): Promise<PlatformTenantDto> {
    const before = await this.getExisting(id);
    await this.repo.update(id, { name: dto.name, allowExternalIdp: dto.allowExternalIdp });
    // 外部 IdP 的開關在租戶脈絡裡判斷：立即生效（多個執行個體時最多晚 TENANT_CACHE_TTL 秒）
    this.directory.invalidate();
    await this.audit.record({
      action: 'tenant.update',
      resourceType: 'tenant',
      resourceId: id,
      metadata: {
        code: before.code,
        before: { name: before.name, allowExternalIdp: before.allowExternalIdp },
        after: {
          name: dto.name ?? before.name,
          allowExternalIdp: dto.allowExternalIdp ?? before.allowExternalIdp,
        },
      },
    });
    return this.get(id);
  }

  /** 佈建失敗後重試：每一步都冪等，已建好的 database 與角色會沿用。 */
  async retryProvisioning(id: string): Promise<PlatformTenantDto> {
    const tenant = await this.transition(id, ['failed'], { status: 'provisioning' });
    await this.audit.record({
      action: 'tenant.provision.retry',
      resourceType: 'tenant',
      resourceId: id,
      metadata: { code: tenant.code, previousError: tenant.provisionError },
    });
    await this.startProvisioning(id);
    return this.get(id);
  }

  /** 停用：網域回 503，撤銷所有 session（D13）。 */
  async disable(id: string): Promise<PlatformTenantDto> {
    const tenant = await this.getExisting(id);
    if (tenant.status !== 'active') throw new AppException('TENANT_STATUS_CONFLICT');
    // 先停用再收尾：停用之後就不會再有新的 session 產生
    await this.transition(id, ['active'], { status: 'disabled' });
    await this.endEverything(tenant);
    await this.audit.record({
      action: 'tenant.disable',
      resourceType: 'tenant',
      resourceId: id,
      metadata: { code: tenant.code },
    });
    return this.get(id);
  }

  async enable(id: string): Promise<PlatformTenantDto> {
    const tenant = await this.transition(id, ['disabled'], { status: 'active' });
    // 停用期間程序可能重啟過（啟動時只準備 active 的租戶）：補上每個租戶一份的初始資料
    await this.tenancy
      .run(id, async () => this.events.publish(DomainEvent.TENANT_ACTIVATED, {}))
      .catch((error: unknown) =>
        this.logger.warn({ err: error, tenant: tenant.code }, '重新啟用後無法進入租戶'),
      );
    await this.audit.record({
      action: 'tenant.enable',
      resourceType: 'tenant',
      resourceId: id,
      metadata: { code: tenant.code },
    });
    return this.get(id);
  }

  /**
   * 刪除 = 標記刪除並停用、釋出網域（D13）。database 與 bucket 留著，由另一個需要確認的手動步驟清除；
   * 代碼之後可以給新的租戶用（新的 database 與 bucket）。
   */
  async remove(id: string): Promise<void> {
    const tenant = await this.getExisting(id);
    if (tenant.status === 'provisioning') throw new AppException('TENANT_STATUS_CONFLICT');
    // 先停用、收尾，再標記刪除：刪除之後就找不到這個租戶，連不上它的 DB 撤銷 session
    await this.transition(id, ['active', 'disabled', 'failed'], { status: 'disabled' });
    await this.endEverything(tenant);
    await this.transition(id, ['disabled'], { status: 'disabled', deletedAt: new Date() });
    await this.repo.removeAllDomains(id);
    this.directory.invalidate();
    await this.audit.record({
      action: 'tenant.delete',
      resourceType: 'tenant',
      resourceId: id,
      metadata: { code: tenant.code, domains: tenant.domains, storageBucket: tenant.storageBucket },
    });
  }

  async addDomain(id: string, domain: string): Promise<PlatformTenantDto> {
    const tenant = await this.getExisting(id);
    if (tenant.domains.includes(domain)) return toDto(tenant);
    await this.assertDomainsAvailable([domain]);
    await this.repo.addDomain(id, domain).catch((error: unknown) => {
      if ((error as { code?: string }).code === '23505') {
        throw new AppException('TENANT_DOMAIN_TAKEN', { domains: [domain] });
      }
      throw error;
    });
    this.directory.invalidate();
    await this.audit.record({
      action: 'tenant.domain.add',
      resourceType: 'tenant',
      resourceId: id,
      metadata: { code: tenant.code, domain },
    });
    return this.get(id);
  }

  async removeDomain(id: string, domain: string): Promise<PlatformTenantDto> {
    const tenant = await this.getExisting(id);
    if (!tenant.domains.includes(domain)) return toDto(tenant);
    if (tenant.domains.length <= 1) throw new AppException('TENANT_LAST_DOMAIN');
    // 第一個是主要網域：信中的連結與「進入租戶」都導向它，移除後這些入口全部失效
    if (tenant.domains[0] === domain) throw new AppException('TENANT_PRIMARY_DOMAIN');
    await this.repo.removeDomain(id, domain);
    this.directory.invalidate();
    await this.audit.record({
      action: 'tenant.domain.remove',
      resourceType: 'tenant',
      resourceId: id,
      metadata: { code: tenant.code, domain },
    });
    return this.get(id);
  }

  // ── 內部 ─────────────────────────────────────────────

  private async getExisting(id: string): Promise<TenantWithDomains> {
    const tenant = await this.repo.findById(id);
    if (!tenant) throw new AppException('TENANT_NOT_FOUND');
    return tenant;
  }

  /** 條件式地改狀態：目前狀態不在 `from` 裡（或併發被改掉）就 `TENANT_STATUS_CONFLICT`。 */
  private async transition(
    id: string,
    from: readonly TenantStatus[],
    patch: { status: TenantStatus; deletedAt?: Date },
  ): Promise<TenantWithDomains> {
    const tenant = await this.getExisting(id);
    const updated = await this.repo.update(id, patch, from);
    if (!updated) throw new AppException('TENANT_STATUS_CONFLICT');
    this.directory.invalidate();
    return tenant;
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
  private async endEverything(tenant: TenantWithDomains): Promise<void> {
    const attempt = async (step: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        this.logger.warn({ err: error, tenant: tenant.code, step }, '停用租戶的收尾步驟失敗');
      }
    };
    await attempt('refreshTokens', () =>
      this.tenancy.runForMaintenance(tenant.id, () => this.auth.revokeAllSessions()),
    );
    await attempt('idpSessions', () => this.oidc.endTenantSessions(tenant.id));
    this.events.publish(DomainEvent.SESSIONS_REVOKED, {
      tenantIds: [tenant.id],
      reason: SessionRevokedReason.TENANT_UNAVAILABLE,
    });
    await attempt('pool', () => this.tenancy.evict(tenant.id));
  }

  private async assertDomainsAvailable(domains: string[]): Promise<void> {
    const taken = await this.repo.domainsTaken(domains);
    // apps/auth 的網域不屬於任何租戶（D2）
    if (domains.includes(this.authHost)) taken.push(this.authHost);
    if (taken.length) throw new AppException('TENANT_DOMAIN_TAKEN', { domains: taken });
  }

  private async nextBucket(code: string): Promise<string> {
    const base = `${BUCKET_PREFIX}${code}`;
    const used = await this.repo.bucketsLike(base);
    let bucket = base;
    for (let n = 2; used.has(bucket); n += 1) bucket = `${base}-${n}`;
    if (!isValidBucketName(bucket)) throw new AppException('VALIDATION_FAILED', { field: 'code' });
    return bucket;
  }
}
