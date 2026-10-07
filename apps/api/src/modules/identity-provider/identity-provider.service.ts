import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import { IDP_SECRET_PURPOSE, SecretBox } from '@/core/crypto';
import type { Database, DbOrTx, Transaction } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException, constraintNameOf, isUniqueViolation } from '@/core/errors';
import {
  IDENTITY_PROVIDER_MAX_PROVIDERS_PARAM,
  requireTenant,
  TenantFeatureImpacts,
  tenantFeatureParam,
} from '@/core/tenant';
import type { IdentityProviderRow, UserIdentityRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';

import type {
  CreateIdentityProviderDto,
  IdentityProviderDto,
  IdentityProviderListDto,
  UpdateIdentityProviderDto,
} from './dto/identity-provider.dto';
import type { ExternalProviderConfig } from './external-oidc.client';
import type { ProviderWithDomains } from './identity-provider.repository';
import { IdentityProviderRepository } from './identity-provider.repository';

/** 稽核只記得到的欄位：client secret 絕不進稽核。 */
const AUDIT_FIELDS = [
  'name',
  'issuer',
  'clientId',
  'scopes',
  'enabled',
  'unmatchedPolicy',
] as const;

function toDto(row: ProviderWithDomains): IdentityProviderDto {
  return {
    id: row.id,
    name: row.name,
    issuer: row.issuer,
    clientId: row.clientId,
    scopes: row.scopes,
    enabled: row.enabled,
    unmatchedPolicy: row.unmatchedPolicy,
    domains: row.domains,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function pick(row: Partial<IdentityProviderRow>): Record<string, unknown> {
  return Object.fromEntries(AUDIT_FIELDS.filter((key) => key in row).map((key) => [key, row[key]]));
}

/** `alice@Acme.com` → `acme.com`；不是 email 時回傳 undefined。 */
export function domainOf(email: string): string | undefined {
  const at = email.lastIndexOf('@');
  return at > 0 && at < email.length - 1 ? email.slice(at + 1).toLowerCase() : undefined;
}

/**
 * 外部 IdP 連線（docs/architecture/04-sso.md §12.2 D8–D11）：平台管理員的增刪改，
 * 以及登入時的查詢（網域導向、是否只允許 SSO、解密後的連線設定）。
 */
@Injectable()
export class IdentityProviderService implements OnModuleInit {
  private readonly secrets: SecretBox;
  private readonly callback: string;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: IdentityProviderRepository,
    private readonly audit: AuditService,
    private readonly impacts: TenantFeatureImpacts,
    config: ConfigService<Env, true>,
  ) {
    this.secrets = SecretBox.fromConfig(
      config.get('IDP_SECRET_KEY', { infer: true }),
      // production 不推導：對外 API 的程序不持有這把金鑰（docs/architecture/06-external-api.md §6）
      config.get('NODE_ENV', { infer: true }) === 'production'
        ? null
        : config.get('JWT_SECRET', { infer: true }),
      IDP_SECRET_PURPOSE,
    );
    const issuer = new URL(config.get('OIDC_ISSUER', { infer: true }));
    // 瀏覽器看到的 api 前綴（issuer 路徑去掉最後的 /oidc）＋ AuthModule 的固定 callback 路徑
    const apiPrefix = issuer.pathname.replace(/\/oidc$/, '');
    this.callback = `${issuer.origin}${apiPrefix}/oidc-interaction/external/callback`;
  }

  onModuleInit(): void {
    // 平台管理者關閉這個 feature 前，確認框列出受影響的連線與使用者（docs/architecture/05-tenancy.md §12）
    this.impacts.register('identityProvider', async () => {
      const impact = await this.repo.countImpact();
      return {
        identityProviderConnections: impact.connections,
        ssoOnlyDomains: impact.ssoOnlyDomains,
        passwordlessExternalUsers: impact.passwordlessUsers,
      };
    });
  }

  /** 登記在外部 IdP 的 redirect URI：所有連線共用一個（外部 IdP 大多要求完全相符，不能帶互動 id）。 */
  callbackUrl(): string {
    return this.callback;
  }

  // ── 平台管理員 ───────────────────────────────────────────

  async list(): Promise<IdentityProviderListDto> {
    return {
      items: (await this.repo.list()).map(toDto),
      callbackUrl: this.callback,
    };
  }

  async create(dto: CreateIdentityProviderDto, actor: AuthUser): Promise<IdentityProviderDto> {
    const id = await this.write(async (tx) => {
      const max = tenantFeatureParam(IDENTITY_PROVIDER_MAX_PROVIDERS_PARAM);
      if ((await this.repo.lockAndCount(tx)) >= max) {
        throw new AppException('IDENTITY_PROVIDER_LIMIT_REACHED', { max });
      }
      const row = await this.repo.create(
        {
          name: dto.name,
          issuer: dto.issuer,
          clientId: dto.clientId,
          clientSecretEncrypted: this.secrets.encrypt(dto.clientSecret),
          scopes: dto.scopes,
          enabled: dto.enabled,
          unmatchedPolicy: dto.unmatchedPolicy,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        tx,
      );
      await this.repo.replaceDomains(row.id, dto.domains, tx);
      await this.audit.record(
        {
          action: 'identityProvider.create',
          resourceType: 'identityProvider',
          resourceId: row.id,
          resourceName: row.name,
          changes: { after: { ...pick(row), domains: dto.domains } },
        },
        tx,
      );
      return row.id;
    });
    return this.getDto(id);
  }

  async update(
    id: string,
    dto: UpdateIdentityProviderDto,
    actor: AuthUser,
  ): Promise<IdentityProviderDto> {
    const before = await this.getExisting(id);
    await this.write(async (tx) => {
      const { clientSecret, domains, ...fields } = dto;
      const updated = await this.repo.update(
        id,
        {
          ...fields,
          ...(clientSecret !== undefined && {
            clientSecretEncrypted: this.secrets.encrypt(clientSecret),
          }),
          updatedBy: actor.id,
        },
        tx,
      );
      if (!updated) throw new AppException('IDENTITY_PROVIDER_NOT_FOUND');
      if (domains) await this.repo.replaceDomains(id, domains, tx);
      // 換了 issuer 或 client：舊的 subject 可能來自另一個 IdP，已連結的身分全部作廢，
      // 否則改指向自架 IdP 就能沿用別人的連結登入
      const identityChanged =
        updated.issuer !== before.issuer || updated.clientId !== before.clientId;
      const identitiesCleared = identityChanged
        ? await this.repo.deleteIdentitiesOfProvider(id, tx)
        : 0;
      await this.audit.record(
        {
          action: 'identityProvider.update',
          resourceType: 'identityProvider',
          resourceId: id,
          resourceName: updated.name,
          changes: {
            before: { ...pick(before), ...(domains && { domains: before.domains }) },
            after: { ...pick(updated), ...(domains && { domains }) },
          },
          // 只記「換過 secret」，不記內容
          metadata:
            clientSecret !== undefined || identityChanged
              ? {
                  ...(clientSecret !== undefined && { clientSecretRotated: true }),
                  ...(identityChanged && { identitiesCleared, severity: 'high' }),
                }
              : undefined,
        },
        tx,
      );
    });
    return this.getDto(id);
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    const existing = await this.getExisting(id);
    await withTransaction(this.db, async (tx) => {
      if (!(await this.repo.softDelete(id, actor.id, tx))) {
        throw new AppException('IDENTITY_PROVIDER_NOT_FOUND');
      }
      await this.audit.record(
        {
          action: 'identityProvider.delete',
          resourceType: 'identityProvider',
          resourceId: id,
          resourceName: existing.name,
          changes: { before: { ...pick(existing), domains: existing.domains } },
        },
        tx,
      );
    });
  }

  // ── 登入時 ───────────────────────────────────────────────

  /** home realm discovery：email 網域有啟用中的連線時回傳它。 */
  async discover(
    email: string,
  ): Promise<{ id: string; name: string; ssoOnly: boolean } | undefined> {
    const domain = domainOf(email);
    if (!domain || !this.allowed()) return undefined;
    const found = await this.repo.findByDomain(domain);
    if (!found?.provider.enabled) return undefined;
    return { id: found.provider.id, name: found.provider.name, ssoOnly: found.ssoOnly };
  }

  /** 這個 email 的網域只允許 SSO（密碼登入、忘記密碼都不接受）。 */
  async isSsoOnly(email: string): Promise<boolean> {
    return (await this.discover(email))?.ssoOnly ?? false;
  }

  /** 啟用中的連線與解密後的設定；不存在或已停用時回傳 undefined。 */
  async loginConfig(
    id: string,
  ): Promise<{ provider: ProviderWithDomains; config: ExternalProviderConfig } | undefined> {
    if (!this.allowed()) return undefined;
    const provider = await this.repo.findById(id);
    if (!provider?.enabled) return undefined;
    return {
      provider,
      config: {
        issuer: provider.issuer,
        clientId: provider.clientId,
        clientSecret: this.secrets.decrypt(provider.clientSecretEncrypted),
        scopes: provider.scopes,
      },
    };
  }

  /**
   * 平台管理者是否為這個租戶啟用外部 IdP（`identityProvider`，docs/architecture/05-tenancy.md §12.2 D5）。
   * 關掉時管理端點由 `@RequireFeature` 回 404；登入時當作沒有連線（email 網域不會導向外部 IdP，
   * 只允許 SSO 的網域也回到密碼登入）。連線與外部身分的連結都保留，重新啟用後照舊。
   */
  private allowed(): boolean {
    return requireTenant().features.includes('identityProvider');
  }

  // ── 外部身分（帳號 ↔ 外部 IdP 的 subject，D8）──────────────────

  findIdentity(providerId: string, subject: string): Promise<UserIdentityRow | undefined> {
    return this.repo.findIdentity(providerId, subject);
  }

  /** 連結外部身分（呼叫端在同一個交易內寫稽核）。 */
  linkIdentity(
    values: { userId: string; providerId: string; subject: string; email: string | null },
    tx?: DbOrTx,
  ): Promise<void> {
    return this.repo.linkIdentity(values, tx);
  }

  /**
   * 刪除一個人的所有外部身分連結（刪除帳號時，在同一個交易內）。`(provider, subject)` 唯一：
   * 連結留著的話，同 email 重建的帳號就再也連不上同一個外部身分。
   */
  async unlinkUser(userId: string, tx: DbOrTx): Promise<number> {
    return this.repo.deleteIdentitiesOfUser(userId, tx);
  }

  /** 刪除單一連結（例：連結指向的帳號已被刪除）。 */
  unlinkIdentity(id: string): Promise<void> {
    return this.repo.deleteIdentity(id);
  }

  touchIdentity(id: string): Promise<void> {
    return this.repo.touchIdentity(id);
  }

  // ── 內部 ─────────────────────────────────────────────────

  private async getExisting(id: string): Promise<ProviderWithDomains> {
    const row = await this.repo.findById(id);
    if (!row) throw new AppException('IDENTITY_PROVIDER_NOT_FOUND');
    return row;
  }

  private async getDto(id: string): Promise<IdentityProviderDto> {
    return toDto(await this.getExisting(id));
  }

  /** 名稱的唯一索引與網域的主鍵：衝突時回業務錯誤而不是 500。 */
  private async write<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      return await withTransaction(this.db, work);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(
          constraintNameOf(error) === 'identity_provider_domains_pkey'
            ? 'IDENTITY_PROVIDER_DOMAIN_TAKEN'
            : 'IDENTITY_PROVIDER_NAME_DUPLICATE',
        );
      }
      throw error;
    }
  }
}
