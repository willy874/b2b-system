import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { defineJob, JobQueue } from '@/core/jobs';
import type { JobContext } from '@/core/jobs';
import { MAIL_JOB_OPTIONS, MailService, toMailLocale } from '@/core/mail';
import type { MfaAccount, MfaRealm } from '@/core/mfa';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import { mfaSecurityNoticeMail } from './mails/mfa-security-notice.mail';
import type { MfaAccountStore } from './mfa-account.store';
import type { MfaSecurityEvent } from './mfa-security-event';
import { PlatformMfaStore } from './platform-mfa.store';
import { TenantMfaStore } from './tenant-mfa.store';

/** 工作資料只有帳號與事件（docs/architecture/backend/11-mail.md §4）；帳號的 email 在寄出當下才讀。 */
export interface MfaSecurityNoticeJobData {
  accountId: string;
  event: MfaSecurityEvent;
}

export const MFA_SECURITY_NOTICE_JOB = defineJob<MfaSecurityNoticeJobData>(
  'mfa.securityNoticeMail',
  MAIL_JOB_OPTIONS,
);
export const MFA_PLATFORM_SECURITY_NOTICE_JOB = defineJob<MfaSecurityNoticeJobData>(
  'mfa.platformSecurityNoticeMail',
  { ...MAIL_JOB_OPTIONS, scope: 'platform' },
);

/** 安全通知信（docs/architecture/backend/21-mfa.md §7）：在呼叫端的交易內入列，回滾時不寄。 */
@Injectable()
export class MfaNotifier implements OnModuleInit {
  private readonly logger = new Logger(MfaNotifier.name);

  constructor(
    private readonly jobs: JobQueue,
    private readonly mail: MailService,
    private readonly tenantStore: TenantMfaStore,
    private readonly platformStore: PlatformMfaStore,
    private readonly audit: AuditService,
    private readonly platformAudit: PlatformAuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(MFA_SECURITY_NOTICE_JOB, (data, ctx) => this.send('tenant', data, ctx));
    this.jobs.register(MFA_PLATFORM_SECURITY_NOTICE_JOB, (data, ctx) =>
      this.send('platform', data, ctx),
    );
  }

  async securityChanged(
    store: MfaAccountStore,
    account: MfaAccount,
    event: MfaSecurityEvent,
    tx: unknown,
  ): Promise<void> {
    const job =
      store.realm === 'tenant' ? MFA_SECURITY_NOTICE_JOB : MFA_PLATFORM_SECURITY_NOTICE_JOB;
    await store.enqueue(job, { accountId: account.id, event }, tx);
  }

  async send(
    realm: MfaRealm,
    { accountId, event }: MfaSecurityNoticeJobData,
    { id: jobId }: JobContext,
  ): Promise<{ messageId: string } | { skipped: string }> {
    const store = realm === 'tenant' ? this.tenantStore : this.platformStore;
    const stored = await store.findAccount(accountId);
    if (!stored) return { skipped: 'account_not_found' };
    const { account } = stored;
    const { messageId } = await this.mail.send(
      account.email,
      mfaSecurityNoticeMail({
        locale: toMailLocale(account.locale),
        displayName: account.displayName,
        event,
      }),
    );
    // 只記「寄了哪一種信給誰」（docs/architecture/backend/11-mail.md §9.2 D8）
    const entry = {
      action: 'mail.send',
      resourceId: accountId,
      metadata: { template: `mfa.securityNotice.${event}`, jobId, messageId },
    };
    if (realm === 'tenant') {
      await this.audit.record({ ...entry, resourceType: 'user', resourceName: account.email });
    } else await this.platformAudit.record({ ...entry, resourceType: 'platformAdmin' });
    this.logger.log({ accountId, realm, event, messageId }, '已寄出 MFA 安全通知');
    return { messageId };
  }
}
