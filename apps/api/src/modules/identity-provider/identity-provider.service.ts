import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import { IDP_SECRET_PURPOSE, SecretBox } from '@/core/crypto';
import type { Database, DbOrTx, Transaction } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException, constraintNameOf, isUniqueViolation } from '@/core/errors';
import { requireTenant } from '@/core/tenant';
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
 * 外部 IdP 連線（docs/adr/0019-sso-identity-platform.md D8–D11）：平台管理員的增刪改，
 * 以及登入時的查詢（網域導向、是否只允許 SSO、解密後的連線設定）。
 */
@Injectable()
export class IdentityProviderService {
  private readonly secrets: SecretBox;
  private readonly callback: string;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: IdentityProviderRepository,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.secrets = SecretBox.fromConfig(
      config.get('IDP_SECRET_KEY', { infer: true }),
      config.get('JWT_SECRET', { infer: true }),
      IDP_SECRET_PURPOSE,
    );
    const issuer = new URL(config.get('OIDC_ISSUER', { infer: true }));
    // 瀏覽器看到的 api 前綴（issuer 路徑去掉最後的 /oidc）＋ AuthModule 的固定 callback 路徑
    const apiPrefix = issuer.pathname.replace(/\/oidc$/, '');
    this.callback = `${issuer.origin}${apiPrefix}/oidc-interaction/external/callback`;
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
      allowed: this.allowed(),
    };
  }

  async create(dto: CreateIdentityProviderDto, actor: AuthUser): Promise<IdentityProviderDto> {
    this.assertAllowed();
    const id = await this.write(async (tx) => {
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
    // 平台關掉外部 IdP 時仍可以編輯、停用、刪除，只是不能再啟用
    if (dto.enabled) this.assertAllowed();
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
          metadata: clientSecret !== undefined ? { clientSecretRotated: true } : undefined,
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
   * 平台管理者是否允許這個租戶使用外部 IdP（docs/adr/0020-physical-tenant-isolation.md 開放問題 2）。
   * 關掉時：不能新增或啟用連線；登入時當作沒有連線（email 網域不會導向外部 IdP，只允許 SSO 的網域也回到密碼登入）。
   */
  private allowed(): boolean {
    return requireTenant().allowExternalIdp;
  }

  private assertAllowed(): void {
    if (!this.allowed()) throw new AppException('IDENTITY_PROVIDER_NOT_ALLOWED');
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
