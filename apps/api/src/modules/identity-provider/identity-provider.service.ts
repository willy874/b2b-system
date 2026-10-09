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
import type { IdentityProviderInsert, UserIdentityRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';

import type {
  CreateIdentityProviderDto,
  IdentityProviderDto,
  IdentityProviderListDto,
  SamlSettingsDto,
  UpdateIdentityProviderDto,
  UserIdentityListDto,
} from './dto/identity-provider.dto';
import type { ExternalProviderConfig } from './external-oidc.client';
import type { ExternalSamlProviderConfig, SamlServiceProvider } from './external-saml.client';
import { ExternalSamlClient } from './external-saml.client';
import type { ProviderWithDomains } from './identity-provider.repository';
import { IdentityProviderRepository } from './identity-provider.repository';
import { isIssuerAllowedForPreset } from './oidc-presets';
import { describeCertificate, normalizeCertificate, SamlStoredConfigSchema } from './saml-config';
import type { SamlStoredConfig } from './saml-config';

/** 稽核只記得到的欄位：client secret 絕不進稽核。 */
const AUDIT_FIELDS = [
  'name',
  'protocol',
  'preset',
  'issuer',
  'clientId',
  'scopes',
  'enabled',
  'unmatchedPolicy',
] as const;

/** 登入時的連線設定：依協定不同。 */
export type ProviderLoginConfig =
  | { protocol: 'oidc'; provider: ProviderWithDomains; config: ExternalProviderConfig }
  | {
      protocol: 'saml';
      provider: ProviderWithDomains;
      config: ExternalSamlProviderConfig;
      sp: SamlServiceProvider;
    };

function pick(row: Partial<ProviderWithDomains>): Record<string, unknown> {
  const fields = Object.fromEntries(
    AUDIT_FIELDS.filter((key) => key in row).map((key) => [key, row[key]]),
  );
  const saml = row.protocol === 'saml' ? SamlStoredConfigSchema.safeParse(row.config) : undefined;
  if (!saml?.success) return fields;
  // 憑證只記指紋：PEM 很長，指紋足以辨識換了哪一張
  const { certificates, ...rest } = saml.data;
  return {
    ...fields,
    ...rest,
    certificates: certificates.map((pem) => describeCertificate(pem).fingerprint),
  };
}

/** `alice@Acme.com` → `acme.com`；不是 email 時回傳 undefined。 */
export function domainOf(email: string): string | undefined {
  const at = email.lastIndexOf('@');
  return at > 0 && at < email.length - 1 ? email.slice(at + 1).toLowerCase() : undefined;
}

/**
 * 外部 IdP 連線（docs/architecture/04-sso.md §12.2 D8–D11、§12.6）：租戶管理員的增刪改（OIDC、SAML 2.0），
 * 登入時的查詢（網域導向、是否只允許 SSO、解密後的連線設定），以及帳號的外部身分。
 */
@Injectable()
export class IdentityProviderService implements OnModuleInit {
  private readonly secrets: SecretBox;
  /** 瀏覽器看到的 api 開頭（例：`https://auth.example.com/api`）。 */
  private readonly apiBase: string;
  private readonly callback: string;
  private readonly samlAcs: string;
  private readonly production: boolean;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: IdentityProviderRepository,
    private readonly audit: AuditService,
    private readonly impacts: TenantFeatureImpacts,
    private readonly permissions: PermissionService,
    private readonly saml: ExternalSamlClient,
    config: ConfigService<Env, true>,
  ) {
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
    this.secrets = SecretBox.fromConfig(
      config.get('IDP_SECRET_KEY', { infer: true }),
      // production 不推導：對外 API 的程序不持有這把金鑰（docs/architecture/06-external-api.md §6）
      this.production ? null : (config.get('JWT_SECRET', { infer: true }) ?? null),
      IDP_SECRET_PURPOSE,
    );
    const issuer = new URL(config.get('OIDC_ISSUER', { infer: true }));
    // 瀏覽器看到的 api 前綴（issuer 路徑去掉最後的 /oidc）＋ AuthModule 的固定 callback 路徑
    this.apiBase = `${issuer.origin}${issuer.pathname.replace(/\/oidc$/, '')}`;
    this.callback = `${this.apiBase}/oidc-interaction/external/callback`;
    this.samlAcs = `${this.apiBase}/oidc-interaction/external/saml/acs`;
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

  /** 登記在外部 IdP 的 redirect URI：所有 OIDC 連線共用一個（外部 IdP 大多要求完全相符，不能帶互動 id）。 */
  callbackUrl(): string {
    return this.callback;
  }

  /** SAML 的 Assertion Consumer Service：所有 SAML 連線共用一個，以 RelayState 找回登入狀態。 */
  samlAcsUrl(): string {
    return this.samlAcs;
  }

  /**
   * 我們這一端（SP）在某個 SAML 連線的識別。entity ID 就是 SP metadata 的網址（IdP 可以直接匯入）；
   * 帶租戶 id 與連線 id：固定的 metadata 端點不在租戶網域上，要從路徑知道是哪個租戶。上線後不能改。
   */
  serviceProviderOf(providerId: string, tenantId = requireTenant().id): SamlServiceProvider {
    return {
      entityId: `${this.apiBase}/oidc-interaction/external/saml/metadata/${tenantId}/${providerId}`,
      acsUrl: this.samlAcs,
    };
  }

  // ── 租戶管理員 ───────────────────────────────────────────

  async list(): Promise<IdentityProviderListDto> {
    return {
      items: (await this.repo.list()).map((row) => this.toDto(row)),
      callbackUrl: this.callback,
      samlAcsUrl: this.samlAcs,
    };
  }

  async create(dto: CreateIdentityProviderDto, actor: AuthUser): Promise<IdentityProviderDto> {
    const values = this.valuesForCreate(dto);
    const id = await this.write(async (tx) => {
      const max = tenantFeatureParam(IDENTITY_PROVIDER_MAX_PROVIDERS_PARAM);
      if ((await this.repo.lockAndCount(tx)) >= max) {
        throw new AppException('IDENTITY_PROVIDER_LIMIT_REACHED', { max });
      }
      const row = await this.repo.create(
        { ...values, createdBy: actor.id, updatedBy: actor.id },
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
    if (dto.protocol !== before.protocol) {
      throw new AppException('IDENTITY_PROVIDER_PROTOCOL_MISMATCH', {
        protocol: before.protocol,
      });
    }
    const values = this.valuesForUpdate(before, dto);
    const secretRotated = dto.protocol === 'oidc' && dto.clientSecret !== undefined;
    await this.write(async (tx) => {
      const updated = await this.repo.update(id, { ...values, updatedBy: actor.id }, tx);
      if (!updated) throw new AppException('IDENTITY_PROVIDER_NOT_FOUND');
      if (dto.domains) await this.repo.replaceDomains(id, dto.domains, tx);
      // 換了 issuer（SAML 是 IdP 的 entity ID）或 client：舊的 subject 可能來自另一個 IdP，已連結的身分全部作廢，
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
            before: { ...pick(before), ...(dto.domains && { domains: before.domains }) },
            after: { ...pick(updated), ...(dto.domains && { domains: dto.domains }) },
          },
          // 只記「換過 secret」，不記內容
          metadata:
            secretRotated || identityChanged
              ? {
                  ...(secretRotated && { clientSecretRotated: true }),
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

  /** 這個 email 的網域只允許 SSO（密碼登入、通行金鑰、忘記密碼都不接受）。 */
  async isSsoOnly(email: string): Promise<boolean> {
    return (await this.discover(email))?.ssoOnly ?? false;
  }

  /** 啟用中的連線與解密後的設定；不存在或已停用時回傳 undefined。 */
  async loginConfig(id: string): Promise<ProviderLoginConfig | undefined> {
    if (!this.allowed()) return undefined;
    const provider = await this.repo.findById(id);
    if (!provider?.enabled) return undefined;
    if (provider.protocol === 'saml') {
      return {
        protocol: 'saml',
        provider,
        config: this.samlConfigOf(provider),
        sp: this.serviceProviderOf(provider.id),
      };
    }
    if (!provider.clientId || !provider.clientSecretEncrypted) return undefined;
    return {
      protocol: 'oidc',
      provider,
      config: {
        issuer: provider.issuer,
        clientId: provider.clientId,
        clientSecret: this.secrets.decrypt(provider.clientSecretEncrypted),
        scopes: provider.scopes,
        preset: provider.preset,
      },
    };
  }

  /**
   * 某個 SAML 連線的 SP metadata（XML）：停用中的連線也提供（先在 IdP 設定好再啟用）；不存在、已刪除、
   * 不是 SAML、或租戶的 feature 關閉時拋 `IDENTITY_PROVIDER_NOT_FOUND`。
   */
  async serviceProviderMetadata(providerId: string): Promise<string> {
    if (!this.allowed()) throw new AppException('IDENTITY_PROVIDER_NOT_FOUND');
    const provider = await this.repo.findById(providerId);
    if (provider?.protocol !== 'saml') throw new AppException('IDENTITY_PROVIDER_NOT_FOUND');
    return this.saml.metadata(this.samlConfigOf(provider), this.serviceProviderOf(provider.id));
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

  /** 管理員檢視一個人連結的外部身分（docs/architecture/04-sso.md §3.3.4）。 */
  async listOfUser(userId: string): Promise<UserIdentityListDto> {
    if (!(await this.repo.userExists(userId))) throw new AppException('USER_NOT_FOUND');
    const rows = await this.repo.listIdentitiesOfUser(userId);
    return {
      items: rows.map((row) => ({
        id: row.id,
        providerId: row.providerId,
        providerName: row.providerName,
        protocol: row.protocol,
        providerDeleted: row.providerDeleted,
        subject: row.subject,
        email: row.email,
        linkedAt: row.linkedAt.toISOString(),
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * 管理員解除一個外部身分的連結（連錯了人、員工換了 IdP 帳號）。之後這個外部身分下一次登入會重新走帳號對應（§3.3）。
   * 反提權：目標持有 super-admin（含經由群組）時，操作者也必須持有——super-admin 不會被自動連結，
   * 解除之後只能以密碼登入，只允許 SSO 的網域等於被鎖在門外（與 MFA 重設的規則相同）。
   */
  async unlinkOfUser(actor: AuthUser, userId: string, identityId: string): Promise<void> {
    const identity = await this.repo.findIdentityOfUser(userId, identityId);
    if (!identity) throw new AppException('USER_IDENTITY_NOT_FOUND');
    const [target, self] = await Promise.all([
      this.permissions.getPermissionSet(userId),
      this.permissions.getPermissionSet(actor.id),
    ]);
    if (target.isSuperAdmin && !self.isSuperAdmin) {
      throw new AppException('AUTHZ_ESCALATION', { role: 'super-admin', target: userId });
    }
    await withTransaction(this.db, async (tx) => {
      if (!(await this.repo.deleteIdentityOfUser(userId, identityId, tx))) {
        throw new AppException('USER_IDENTITY_NOT_FOUND');
      }
      await this.audit.record(
        {
          action: 'userIdentity.unlink',
          resourceType: 'user',
          resourceId: userId,
          resourceName: identity.userEmail,
          metadata: { providerId: identity.providerId, identityId, email: identity.email },
        },
        tx,
      );
    });
  }

  // ── 內部 ─────────────────────────────────────────────────

  private toDto(row: ProviderWithDomains): IdentityProviderDto {
    return {
      id: row.id,
      name: row.name,
      protocol: row.protocol,
      preset: row.preset,
      issuer: row.issuer,
      clientId: row.clientId,
      scopes: row.scopes,
      enabled: row.enabled,
      unmatchedPolicy: row.unmatchedPolicy,
      domains: row.domains,
      saml: row.protocol === 'saml' ? this.samlDtoOf(row) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private samlDtoOf(row: ProviderWithDomains): SamlSettingsDto {
    const config = SamlStoredConfigSchema.parse(row.config);
    return {
      ssoUrl: config.ssoUrl,
      certificates: config.certificates.map(describeCertificate),
      nameIdFormat: config.nameIdFormat,
      emailAttribute: config.emailAttribute,
      nameAttribute: config.nameAttribute,
      spEntityId: this.serviceProviderOf(row.id).entityId,
    };
  }

  private samlConfigOf(provider: ProviderWithDomains): ExternalSamlProviderConfig {
    const config = SamlStoredConfigSchema.parse(provider.config);
    return { entityId: provider.issuer, ...config };
  }

  private valuesForCreate(
    dto: CreateIdentityProviderDto,
  ): Omit<IdentityProviderInsert, 'createdBy' | 'updatedBy'> {
    const common = {
      name: dto.name,
      enabled: dto.enabled,
      unmatchedPolicy: dto.unmatchedPolicy,
    };
    if (dto.protocol === 'oidc') {
      this.assertIssuer(dto.preset, dto.issuer);
      return {
        ...common,
        protocol: 'oidc',
        preset: dto.preset,
        issuer: dto.issuer,
        clientId: dto.clientId,
        clientSecretEncrypted: this.secrets.encrypt(dto.clientSecret),
        scopes: dto.scopes,
      };
    }
    return {
      ...common,
      protocol: 'saml',
      preset: 'generic',
      issuer: dto.entityId,
      config: this.samlStoredConfig({
        ssoUrl: dto.ssoUrl,
        certificates: dto.certificates,
        nameIdFormat: dto.nameIdFormat,
        emailAttribute: dto.emailAttribute,
        nameAttribute: dto.nameAttribute,
      }),
    };
  }

  private valuesForUpdate(
    before: ProviderWithDomains,
    dto: UpdateIdentityProviderDto,
  ): Partial<IdentityProviderInsert> {
    const common = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      ...(dto.unmatchedPolicy !== undefined && { unmatchedPolicy: dto.unmatchedPolicy }),
    };
    if (dto.protocol === 'oidc') {
      const preset = dto.preset ?? before.preset;
      const issuer = dto.issuer ?? before.issuer;
      if (dto.preset !== undefined || dto.issuer !== undefined) this.assertIssuer(preset, issuer);
      return {
        ...common,
        ...(dto.preset !== undefined && { preset: dto.preset }),
        ...(dto.issuer !== undefined && { issuer: dto.issuer }),
        ...(dto.clientId !== undefined && { clientId: dto.clientId }),
        ...(dto.scopes !== undefined && { scopes: dto.scopes }),
        ...(dto.clientSecret !== undefined && {
          clientSecretEncrypted: this.secrets.encrypt(dto.clientSecret),
        }),
      };
    }
    const current = SamlStoredConfigSchema.parse(before.config);
    const samlChanged =
      dto.ssoUrl !== undefined ||
      dto.certificates !== undefined ||
      dto.nameIdFormat !== undefined ||
      dto.emailAttribute !== undefined ||
      dto.nameAttribute !== undefined;
    return {
      ...common,
      ...(dto.entityId !== undefined && { issuer: dto.entityId }),
      ...(samlChanged && {
        config: this.samlStoredConfig({
          ssoUrl: dto.ssoUrl ?? current.ssoUrl,
          certificates: dto.certificates ?? current.certificates,
          nameIdFormat: dto.nameIdFormat ?? current.nameIdFormat,
          emailAttribute:
            dto.emailAttribute !== undefined ? dto.emailAttribute : current.emailAttribute,
          nameAttribute:
            dto.nameAttribute !== undefined ? dto.nameAttribute : current.nameAttribute,
        }),
      }),
    };
  }

  /** 範本有固定的 issuer 格式（例：Entra 必須是單一目錄的端點）。 */
  private assertIssuer(preset: ProviderWithDomains['preset'], issuer: string): void {
    if (!isIssuerAllowedForPreset(preset, issuer)) {
      throw new AppException('IDENTITY_PROVIDER_ISSUER_INVALID', { preset });
    }
  }

  /** 憑證正規化成 PEM、SSO 網址在 production 必須是 https（AuthnRequest 帶在網址上）。 */
  private samlStoredConfig(input: SamlStoredConfig): Record<string, unknown> {
    const certificates = input.certificates.map((raw, index) => {
      const pem = normalizeCertificate(raw);
      if (!pem)
        throw new AppException('IDENTITY_PROVIDER_CERTIFICATE_INVALID', { position: index + 1 });
      return pem;
    });
    if (this.production && !input.ssoUrl.startsWith('https://')) {
      throw new AppException('VALIDATION_FAILED', { fields: { ssoUrl: 'https required' } });
    }
    return {
      ...input,
      certificates,
      emailAttribute: input.emailAttribute || null,
      nameAttribute: input.nameAttribute || null,
    };
  }

  private async getExisting(id: string): Promise<ProviderWithDomains> {
    const row = await this.repo.findById(id);
    if (!row) throw new AppException('IDENTITY_PROVIDER_NOT_FOUND');
    return row;
  }

  private async getDto(id: string): Promise<IdentityProviderDto> {
    return this.toDto(await this.getExisting(id));
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
