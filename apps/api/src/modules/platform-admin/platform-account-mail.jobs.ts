import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { JobQueue } from '@/core/jobs';
import type { JobContext } from '@/core/jobs';
import { DEFAULT_MAIL_LOCALE, MailService } from '@/core/mail';
import { accountLinkMail } from '@/modules/credential/mails/account-link.mail';

import {
  PLATFORM_ACCOUNT_MAIL_JOB,
  PLATFORM_ACTIVATION_TTL_SECONDS,
  PLATFORM_PASSWORD_RESET_TTL_SECONDS,
} from './platform-admin.constants';
import { PlatformAdminRepository } from './platform-admin.repository';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthTokenRepository } from './platform-auth-token.repository';

const SPECS = {
  activation: {
    tokenPurpose: 'activation',
    path: '/setup',
    ttlSeconds: PLATFORM_ACTIVATION_TTL_SECONDS,
    // 寄出前再確認一次：入列之後可能已經自行啟用
    shouldSend: (status: string) => status === 'pending',
  },
  passwordReset: {
    tokenPurpose: 'password_reset',
    path: '/reset-password',
    ttlSeconds: PLATFORM_PASSWORD_RESET_TTL_SECONDS,
    shouldSend: (status: string) => status !== 'inactive' && status !== 'pending',
  },
} as const;

/**
 * 平台管理者的啟用信與重設密碼信（同租戶的 `AuthMailJobs`）。平台工作沒有租戶脈絡，
 * `MailService.accountLink` 不會帶 `?tenant=`：apps/auth 的頁面據此走平台管理者的端點。
 */
@Injectable()
export class PlatformAccountMailJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobQueue,
    private readonly repo: PlatformAdminRepository,
    private readonly tokens: PlatformAuthTokenRepository,
    private readonly mail: MailService,
    private readonly audit: PlatformAuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(PLATFORM_ACCOUNT_MAIL_JOB, (data, ctx) => this.send(data, ctx));
  }

  async send(
    { adminId, purpose }: { adminId: string; purpose: 'activation' | 'passwordReset' },
    { id: jobId }: JobContext,
  ): Promise<{ messageId: string } | { skipped: string }> {
    const spec = SPECS[purpose];
    const admin = await this.repo.findById(adminId);
    if (!admin) return { skipped: 'admin_not_found' };
    if (!spec.shouldSend(admin.status)) return { skipped: `admin_${admin.status}` };

    // 每次寄出都簽新的：重試時前一封的連結跟著失效
    const { raw } = await this.tokens.issue(adminId, spec.tokenPurpose);
    const { messageId } = await this.mail.send(
      admin.email,
      accountLinkMail({
        purpose,
        // 平台管理者沒有語系偏好
        locale: DEFAULT_MAIL_LOCALE,
        displayName: admin.displayName,
        link: this.mail.accountLink(spec.path, { token: raw }),
        validHours: spec.ttlSeconds / 3600,
      }),
    );
    // 只記「寄了哪一種信給誰」，不記內容與 token（docs/adr/0017-mail-delivery.md D8）
    await this.audit.record({
      action: 'mail.send',
      resourceType: 'platformAdmin',
      resourceId: adminId,
      actorEmail: 'system',
      metadata: { template: `platformAdmin.${purpose}`, jobId, messageId },
    });
    return { messageId };
  }
}
