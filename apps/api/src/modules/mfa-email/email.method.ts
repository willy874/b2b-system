import { randomInt, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { JobQueue } from '@/core/jobs';
import type { JobContext } from '@/core/jobs';
import { MailService, toMailLocale } from '@/core/mail';
import { mfaChallengesSent, mfaEmailDeliverySeconds } from '@/core/metrics';
import { MfaChallengeDelivery, MfaMethodRegistry } from '@/core/mfa';
import type {
  MfaAccount,
  MfaAccountContext,
  MfaChallenge,
  MfaChallengeStart,
  MfaEnrollmentStart,
  MfaFactor,
  MfaFactorSummary,
  MfaMethod,
  MfaMethodDefinition,
  MfaPurpose,
  MfaRealm,
  MfaVerifyResult,
} from '@/core/mfa';

import {
  EMAIL_CODE_DIGITS,
  EMAIL_CODE_RESEND_SECONDS,
  EMAIL_CODE_TTL_SECONDS,
  MFA_EMAIL_CODE_JOB,
  MFA_PLATFORM_EMAIL_CODE_JOB,
} from './email.constants';
import type { EmailCodeJobData } from './email.constants';
import { mfaEmailCodeMail } from './mails/mfa-email-code.mail';

const EmailVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});
type EmailVerifyPayload = z.infer<typeof EmailVerifySchema>;

/** 遮蔽的收件地址：`w***@example.com`（列表與登入頁的提示，不透露完整的 email）。 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/** 存在 challenge 狀態裡的是 HMAC(challengeId ‖ code)：6 位數的純雜湊在 DB 外洩時一秒可窮舉（§3）。 */
function codeHashOf(ctx: MfaAccountContext, challengeId: string, code: string): string {
  return ctx.secrets.hmac(`${challengeId}:${code}`);
}

/**
 * Email 驗證碼（docs/architecture/backend/21-mfa.md §9.2）：寄到帳號目前的 email、6 位數、10 分鐘。
 * 開始設定時就寄一封（確認收得到才算設定完成）。碼在寄信工作執行時才產生，重試換新的碼。
 *
 * 已知的弱點：與「忘記密碼」走同一個信箱，擋得住密碼外洩與撞庫，擋不住信箱被入侵（`assurance: 'inbox'`，N2、D16）。
 */
@Injectable()
export class EmailMfaMethod implements MfaMethod<EmailVerifyPayload>, OnModuleInit {
  private readonly logger = new Logger(EmailMfaMethod.name);

  readonly definition: MfaMethodDefinition = {
    id: 'email',
    // RFC 8176 沒有 email 的值；用 otp 會讓稽核分不出強度不同的兩種方式（D12）
    amr: 'email',
    realms: ['tenant', 'platform'],
    maxFactorsPerAccount: 1,
    challenge: 'server',
    enrollAt: 'anywhere',
    defaultEnabled: true,
    assurance: 'inbox',
  };

  readonly verifySchema = EmailVerifySchema;

  constructor(
    private readonly registry: MfaMethodRegistry,
    private readonly delivery: MfaChallengeDelivery,
    private readonly jobs: JobQueue,
    private readonly mail: MailService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
    this.jobs.register(MFA_EMAIL_CODE_JOB, (data, ctx) => this.send('tenant', data, ctx));
    this.jobs.register(MFA_PLATFORM_EMAIL_CODE_JOB, (data, ctx) =>
      this.send('platform', data, ctx),
    );
  }

  async beginEnrollment(ctx: MfaAccountContext): Promise<MfaEnrollmentStart> {
    return { publicData: { email: maskEmail(ctx.account.email) } };
  }

  /** 寫 challenge（還沒有碼），在同一個交易入列寄信工作；碼由工作產生。 */
  async startChallenge(
    ctx: MfaAccountContext,
    _factor: MfaFactor,
    challenge: { id: string; purpose: MfaPurpose },
  ): Promise<MfaChallengeStart> {
    const job = ctx.realm === 'tenant' ? MFA_EMAIL_CODE_JOB : MFA_PLATFORM_EMAIL_CODE_JOB;
    await ctx.enqueue(job, { accountId: ctx.account.id, challengeId: challenge.id });
    return {
      state: { purpose: challenge.purpose },
      expiresInSeconds: EMAIL_CODE_TTL_SECONDS,
      resendAfterSeconds: EMAIL_CODE_RESEND_SECONDS,
      hint: maskEmail(ctx.account.email),
    };
  }

  async verify(
    ctx: MfaAccountContext,
    _factor: MfaFactor,
    challenge: MfaChallenge | null,
    payload: EmailVerifyPayload,
  ): Promise<MfaVerifyResult> {
    const stored = challenge?.state.codeHash;
    // 還沒寄出（工作還在排隊）：碼不存在，任何輸入都不對
    if (!challenge || typeof stored !== 'string') return { ok: false, reason: 'invalid' };
    const given = Buffer.from(codeHashOf(ctx, challenge.id, payload.code), 'hex');
    const expected = Buffer.from(stored, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true };
  }

  describe(_factor: MfaFactor, account: MfaAccount): MfaFactorSummary {
    return { label: null, hint: maskEmail(account.email) };
  }

  /** 寄信工作：經框架的入口確認 challenge 仍有效、帳號仍可登入，產生碼、存 HMAC、寄出。 */
  async send(
    realm: MfaRealm,
    { accountId, challengeId }: EmailCodeJobData,
    { id: jobId }: JobContext,
  ): Promise<{ delivered: true } | { skipped: string }> {
    const result = await this.delivery.deliver(
      realm,
      accountId,
      challengeId,
      async (ctx, challenge) => {
        const code = String(randomInt(0, 10 ** EMAIL_CODE_DIGITS)).padStart(EMAIL_CODE_DIGITS, '0');
        const purpose = challenge.purpose;
        return {
          state: {
            purpose,
            codeHash: codeHashOf(ctx, challenge.id, code),
            sentAt: new Date().toISOString(),
          },
          send: async () => {
            await this.mail.send(
              ctx.account.email,
              mfaEmailCodeMail({
                locale: toMailLocale(ctx.account.locale),
                displayName: ctx.account.displayName,
                code,
                purpose,
                validMinutes: EMAIL_CODE_TTL_SECONDS / 60,
              }),
            );
          },
        };
      },
    );
    if (!result.delivered) {
      this.logger.log({ jobId, realm, challengeId, reason: result.reason }, '略過 MFA 驗證碼信');
      return { skipped: result.reason };
    }
    mfaChallengesSent.inc({ method: this.definition.id });
    mfaEmailDeliverySeconds.observe(result.challengeAgeMs / 1000);
    // 驗證碼信不寫 mail.send 的稽核：登入時每次都寄，稽核的 auth.login.* 已經記了第二步的結果
    return { delivered: true };
  }
}
