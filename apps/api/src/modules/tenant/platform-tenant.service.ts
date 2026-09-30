import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { SecretBox, TENANT_SECRET_PURPOSE } from '@/core/crypto';
import { AppException } from '@/core/errors';
import { JobQueue } from '@/core/jobs';
import { isValidBucketName } from '@/core/storage/object-storage';
import { Tenancy, TenantDirectory } from '@/core/tenant';
import type { TenantStatus } from '@/db/platform/schema';
import { AuthService } from '@/modules/auth/auth.service';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type {
  CreateTenantDto,
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

  async list(): Promise<PlatformTenantListDto> {
    return { items: (await this.repo.list()).map(toDto), baseDomain: this.baseDomain };
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
    await this.revokeSessions(tenant);
    await this.transition(id, ['active'], { status: 'disabled' });
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
    if (tenant.status === 'active') await this.revokeSessions(tenant);
    await this.transition(id, ['active', 'disabled', 'failed'], {
      status: 'disabled',
      deletedAt: new Date(),
    });
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
  private async revokeSessions(tenant: TenantWithDomains): Promise<void> {
    try {
      await this.tenancy.run(tenant.id, () => this.auth.revokeAllSessions());
    } catch (error) {
      this.logger.warn({ err: error, tenant: tenant.code }, '停用租戶時無法撤銷 session');
    }
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
