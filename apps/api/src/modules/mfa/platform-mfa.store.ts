import { Inject, Injectable } from '@nestjs/common';

import { afterCommit, PLATFORM_DB, withTransaction } from '@/core/database';
import type { PlatformDatabase, PlatformDbOrTx, PlatformTransaction } from '@/core/database';
import { JobQueue } from '@/core/jobs';
import type { JobType } from '@/core/jobs';
import type { PlatformAdminRow } from '@/db/platform/schema';
import { platformAccountId } from '@/modules/oidc-provider/oidc-account';
import { PlatformAccountService } from '@/modules/platform-admin/platform-account.service';
import { PlatformAdminService } from '@/modules/platform-admin/platform-admin.service';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type {
  MfaAccountStore,
  MfaAuditInput,
  MfaAuditKind,
  MfaStoredAccount,
} from './mfa-account.store';
import { PlatformMfaRepository } from './platform-mfa.repository';

const PLATFORM_AUDIT: Record<MfaAuditKind, { action: string; resourceType: string }> = {
  factorAdd: { action: 'platformAdmin.mfa.factor.add', resourceType: 'platformAdmin' },
  factorRemove: { action: 'platformAdmin.mfa.factor.remove', resourceType: 'platformAdmin' },
  recoveryRegenerate: {
    action: 'platformAdmin.mfa.recoveryCodes.regenerate',
    resourceType: 'platformAdmin',
  },
  recoveryUse: { action: 'platformAdmin.mfa.recoveryCode.use', resourceType: 'platformAdmin' },
  reset: { action: 'platformAdmin.mfa.reset', resourceType: 'platformAdmin' },
  loginFailure: { action: 'platformAuth.login.failure', resourceType: 'platformAuth' },
};

function isLocked(admin: PlatformAdminRow): boolean {
  return admin.lockedUntil !== null && admin.lockedUntil.getTime() > Date.now();
}

/** 平台管理者的 MFA 儲存（docs/architecture/backend/21-mfa.md D5）：平台 DB 的 `platform_admins` 與 `platform_admin_mfa_*`。 */
@Injectable()
export class PlatformMfaStore implements MfaAccountStore<PlatformDbOrTx> {
  readonly realm = 'platform' as const;

  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDatabase,
    readonly repo: PlatformMfaRepository,
    private readonly admins: PlatformAdminService,
    private readonly accounts: PlatformAccountService,
    private readonly audits: PlatformAuditService,
    private readonly jobs: JobQueue,
  ) {}

  async findAccount(accountId: string): Promise<MfaStoredAccount | undefined> {
    const admin = await this.admins.findById(accountId);
    if (!admin) return undefined;
    return {
      account: {
        id: admin.id,
        email: admin.email,
        displayName: admin.displayName,
        // 平台管理者沒有語系偏好：信件用預設語系
        locale: 'zh-TW',
        realm: 'platform',
        tenant: null,
      },
      active: admin.status === 'active',
      locked: isLocked(admin),
      mfaEnabled: admin.mfaEnabled,
    };
  }

  verifyPassword(accountId: string, password: string): Promise<boolean> {
    return this.accounts.verifyPassword(accountId, password);
  }

  transaction<T>(fn: (tx: PlatformDbOrTx) => Promise<T>): Promise<T> {
    return withTransaction(this.db, fn);
  }

  async audit(input: MfaAuditInput, tx?: PlatformDbOrTx): Promise<void> {
    const { action, resourceType } = PLATFORM_AUDIT[input.kind];
    const actor = input.actor ?? { id: input.target.id, email: input.target.email };
    const entry = {
      action,
      resourceType,
      resourceId: input.target.id,
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
    tx?: PlatformDbOrTx,
  ): Promise<void> {
    // 平台工作不走 outbox：交易提交後才送出，回滾時不寄
    if (!tx) {
      await this.jobs.enqueue(type, data);
      return;
    }
    afterCommit(tx as PlatformTransaction, async () => {
      await this.jobs.enqueue(type, data);
    });
  }

  revokeSessions(accountId: string, tx: PlatformDbOrTx): Promise<void> {
    return this.accounts.endAllSessions(accountId, tx as PlatformTransaction);
  }

  async mfaStatusChanged(): Promise<void> {
    // 平台管理者的列表沒有推播
  }

  throttleScope(): string {
    return this.admins.throttleScope();
  }

  async recordLoginFailure(
    stored: MfaStoredAccount,
    ipPrefix: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const admin = await this.admins.findById(stored.account.id);
    if (admin) await this.admins.recordFailedAttempt(admin, ipPrefix, metadata);
  }

  async completeLogin(
    stored: MfaStoredAccount,
    completion: { amr: string[]; mfaMethod?: string },
  ): Promise<void> {
    const admin = await this.admins.findById(stored.account.id);
    if (admin) await this.admins.completeLogin(admin, completion);
  }

  oidcAccountId(accountId: string): string {
    return platformAccountId(accountId);
  }
}
