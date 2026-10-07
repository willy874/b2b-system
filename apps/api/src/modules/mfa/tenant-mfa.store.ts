import { SessionRevokedReason } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import { UserCacheService } from '@/core/cache';
import { afterCommit, TENANT_DB, withTransaction } from '@/core/database';
import type { Database, DbOrTx, Transaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { JobQueue } from '@/core/jobs';
import type { JobType } from '@/core/jobs';
import { requireTenant, TenantDirectory } from '@/core/tenant';
import type { UserRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PasswordHasher } from '@/modules/credential/password-hasher';
import { RefreshTokenService } from '@/modules/credential/refresh-token.service';
import { tenantAccountId } from '@/modules/oidc-provider/oidc-account';
import { UserAccountService } from '@/modules/user/user-account.service';
import { UserLoginService } from '@/modules/user/user-login.service';
import { isLoginLocked, userUpdated } from '@/modules/user/user.service';

import type {
  MfaAccountStore,
  MfaAuditInput,
  MfaAuditKind,
  MfaStoredAccount,
} from './mfa-account.store';
import { TenantMfaRepository } from './tenant-mfa.repository';

/** 稽核的動作與資源類型（docs/architecture/backend/21-mfa.md §12）。 */
const TENANT_AUDIT: Record<MfaAuditKind, { action: string; resourceType: string }> = {
  factorAdd: { action: 'mfa.factor.add', resourceType: 'auth' },
  factorRemove: { action: 'mfa.factor.remove', resourceType: 'auth' },
  recoveryRegenerate: { action: 'mfa.recoveryCodes.regenerate', resourceType: 'auth' },
  recoveryUse: { action: 'mfa.recoveryCode.use', resourceType: 'auth' },
  reset: { action: 'user.mfa.reset', resourceType: 'user' },
  loginFailure: { action: 'auth.login.failure', resourceType: 'auth' },
};

/**
 * 租戶使用者的 MFA 儲存（docs/architecture/backend/21-mfa.md D5）：租戶 DB 的 `users` 與 `mfa_*`。
 * 只能在租戶的脈絡裡用（請求或 `Tenancy.run`）。
 */
@Injectable()
export class TenantMfaStore implements MfaAccountStore<DbOrTx> {
  readonly realm = 'tenant' as const;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    readonly repo: TenantMfaRepository,
    private readonly users: UserAccountService,
    private readonly logins: UserLoginService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly passwords: PasswordHasher,
    private readonly audits: AuditService,
    private readonly jobs: JobQueue,
    private readonly events: DomainEventBus,
    private readonly userCache: UserCacheService,
    private readonly directory: TenantDirectory,
  ) {}

  async findAccount(accountId: string): Promise<MfaStoredAccount | undefined> {
    const user = await this.users.findAccountById(accountId);
    // 服務帳號沒有密碼、不能登入，也就沒有 MFA
    if (!user || user.kind !== 'human') return undefined;
    return this.toStored(user);
  }

  async verifyPassword(accountId: string, password: string): Promise<boolean> {
    const user = await this.users.findAccountById(accountId);
    if (!user?.passwordHash) return this.passwords.verifyAgainstDummy(password);
    return this.passwords.verify(user.passwordHash, password);
  }

  transaction<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    return withTransaction(this.db, fn);
  }

  async audit(input: MfaAuditInput, tx?: DbOrTx): Promise<void> {
    const { action, resourceType } = TENANT_AUDIT[input.kind];
    const actor = input.actor ?? { id: input.target.id, email: input.target.email };
    const entry = {
      action,
      resourceType,
      resourceId: input.target.id,
      ...(input.kind === 'reset' && { resourceName: input.target.email }),
      result: input.result ?? 'success',
      errorCode: input.errorCode ?? null,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: input.metadata,
    } as const;
    if (tx) await this.audits.record(entry, tx);
    else await this.audits.recordSafely(entry);
  }

  async enqueue<TData extends object>(
    type: JobType<TData>,
    data: TData,
    tx?: DbOrTx,
  ): Promise<void> {
    await this.jobs.enqueue(type, data, tx ? { tx: tx as Transaction } : {});
  }

  async revokeSessions(accountId: string, tx: DbOrTx): Promise<void> {
    await this.users.incrementTokenVersion(accountId, tx);
    await this.refreshTokens.revokeAllForUser(accountId, 'mfa_reset', tx);
    afterCommit(tx as Transaction, () => {
      this.userCache.invalidate(accountId);
      // 即時連線、IdP session 與還在第二步的互動一起結束（docs/architecture/04-sso.md §3.5）
      this.events.publish(DomainEvent.SESSIONS_REVOKED, {
        userIds: [accountId],
        reason: SessionRevokedReason.TOKEN_STALE,
      });
    });
  }

  async mfaStatusChanged(accountId: string): Promise<void> {
    this.userCache.invalidate(accountId);
    // 使用者列表的「MFA」欄
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [userUpdated(accountId, await this.users.listRoleSummaries(accountId))],
      affectedUserIds: [accountId],
    });
  }

  throttleScope(): string {
    return this.logins.throttleScope();
  }

  async recordLoginFailure(
    stored: MfaStoredAccount,
    ipPrefix: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const user = await this.users.findAccountById(stored.account.id);
    if (user) await this.logins.recordFailedAttempt(user, ipPrefix, metadata);
  }

  async completeLogin(
    stored: MfaStoredAccount,
    completion: { amr: string[]; mfaMethod?: string },
  ): Promise<void> {
    const user = await this.users.findAccountById(stored.account.id);
    if (user) await this.logins.completeLogin(user, completion);
  }

  oidcAccountId(accountId: string): string {
    return tenantAccountId(requireTenant().id, accountId);
  }

  private async toStored(user: UserRow): Promise<MfaStoredAccount> {
    const tenant = requireTenant();
    const record = await this.directory.findById(tenant.id);
    return {
      account: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        locale: user.locale,
        realm: 'tenant',
        tenant: { id: tenant.id, code: tenant.code, name: record?.name ?? tenant.code },
      },
      active: user.status === 'active' && user.deletedAt === null,
      locked: isLoginLocked(user),
      mfaEnabled: user.mfaEnabled,
    };
  }
}
