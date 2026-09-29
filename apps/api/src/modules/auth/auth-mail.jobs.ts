import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { TENANT_DB } from '@/core/database';
import type { Database } from '@/core/database';
import { JobQueue } from '@/core/jobs';
import type { JobContext } from '@/core/jobs';
import { MailService, toMailLocale } from '@/core/mail';
import { users } from '@/db/schema';
import type { AuthTokenPurpose } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';

import { ACTIVATION_MAIL_JOB, PASSWORD_RESET_MAIL_JOB } from './auth-mail.constants';
import type { AccountMailJobData } from './auth-mail.constants';
import {
  ACTIVATION_TTL_SECONDS,
  AuthTokenService,
  PASSWORD_RESET_TTL_SECONDS,
} from './auth-token.service';
import { accountLinkMail } from './mails/account-link.mail';
import type { AccountLinkPurpose } from './mails/account-link.mail';

interface AccountMailSpec {
  purpose: AccountLinkPurpose;
  tokenPurpose: AuthTokenPurpose;
  path: string;
  ttlSeconds: number;
  /** 寄出前再確認一次：入列之後狀態可能已經變了（例：使用者已經自行啟用） */
  shouldSend: (status: string) => boolean;
}

const SPECS = {
  activation: {
    purpose: 'activation',
    tokenPurpose: 'activation',
    path: '/setup',
    ttlSeconds: ACTIVATION_TTL_SECONDS,
    shouldSend: (status) => status === 'pending',
  },
  passwordReset: {
    purpose: 'passwordReset',
    tokenPurpose: 'password_reset',
    path: '/reset-password',
    ttlSeconds: PASSWORD_RESET_TTL_SECONDS,
    // 與 POST /auth/reset-password 一致：任何狀態都能重設（鎖定的會順帶解鎖）
    shouldSend: () => true,
  },
} as const satisfies Record<AccountLinkPurpose, AccountMailSpec>;

/** 啟用信與重設密碼信的背景工作；`UserService`、`AuthService` 入列，這裡寄出。 */
@Injectable()
export class AuthMailJobs implements OnModuleInit {
  private readonly logger = new Logger(AuthMailJobs.name);

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly tokens: AuthTokenService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(ACTIVATION_MAIL_JOB, (data, ctx) => this.send(SPECS.activation, data, ctx));
    this.jobs.register(PASSWORD_RESET_MAIL_JOB, (data, ctx) =>
      this.send(SPECS.passwordReset, data, ctx),
    );
  }

  async send(
    spec: AccountMailSpec,
    { userId }: AccountMailJobData,
    { id: jobId }: JobContext,
  ): Promise<{ messageId: string } | { skipped: string }> {
    const [user] = await this.db
      .select({
        email: users.email,
        displayName: users.displayName,
        locale: users.locale,
        status: users.status,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || user.deletedAt) return { skipped: 'user_not_found' };
    if (!spec.shouldSend(user.status)) return { skipped: `user_${user.status}` };

    // 每次寄出都簽新的：重試時前一封的連結跟著失效，信箱裡只有最後一封能用
    const { raw } = await this.tokens.issue(userId, spec.tokenPurpose);
    const { messageId } = await this.mail.send(
      user.email,
      accountLinkMail({
        purpose: spec.purpose,
        locale: toMailLocale(user.locale),
        displayName: user.displayName,
        link: this.mail.accountLink(spec.path, { token: raw }),
        validHours: spec.ttlSeconds / 3600,
      }),
    );
    // 只記「寄了哪一種信給誰」，不記內容與 token（docs/adr/0017-mail-delivery.md D8）
    await this.audit.record({
      action: 'mail.send',
      resourceType: 'user',
      resourceId: userId,
      resourceName: user.email,
      metadata: { template: `auth.${spec.purpose}`, jobId, messageId },
    });
    this.logger.log({ userId, template: spec.purpose, messageId }, '已寄出');
    return { messageId };
  }
}
