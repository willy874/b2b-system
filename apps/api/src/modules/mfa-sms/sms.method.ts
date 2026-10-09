import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { AppException } from '@/core/errors';
import { JobQueue } from '@/core/jobs';
import type { JobContext } from '@/core/jobs';
import { mfaChallengesSent } from '@/core/metrics';
import {
  generateOtpCode,
  matchesOtpCode,
  MfaChallengeDelivery,
  mfaIssuerOf,
  MfaMethodRegistry,
  MfaMethodSettings,
  otpCodeHash,
} from '@/core/mfa';
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
  MfaSettingsCheck,
  MfaSettingValues,
  MfaVerifyResult,
} from '@/core/mfa';

import { SmsGateway } from './sms-gateway';
import {
  E164_PATTERN,
  isAllowedCountry,
  maskPhone,
  parseCountryCodes,
  smsCodeText,
} from './sms-text';
import {
  MFA_PLATFORM_SMS_CODE_JOB,
  MFA_SMS_CODE_JOB,
  SMS_CODE_RESEND_SECONDS,
  SMS_CODE_TTL_SECONDS,
  SMS_PROVIDERS,
} from './sms.constants';
import type { SmsCodeJobData } from './sms.constants';

const SmsVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});
type SmsVerifyPayload = z.infer<typeof SmsVerifySchema>;

/** 設定時輸入的手機號碼：E.164（前端把國內格式轉好再送）。 */
const SmsEnrollSchema = z.object({
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(E164_PATTERN, 'MFA_PHONE_INVALID')),
});
type SmsEnrollInput = z.infer<typeof SmsEnrollSchema>;

/**
 * 簡訊驗證碼（docs/architecture/backend/21-mfa.md §9.4）：設定時輸入手機號碼（加密存在因子的 `secret_encrypted`），
 * 6 位數、10 分鐘、60 秒重寄冷卻。供應商與金鑰是平台參數（§5.1），**填齊之前不能開啟**。
 *
 * 防灌量（SMS pumping）：只送到平台參數 `allowedCountryCodes` 列出的國碼；端點另有 `authMail` 的速率限制與每個因子的冷卻。
 * 已知的弱點：SIM 換卡、簡訊被攔截（`assurance: 'messaging'`）；要防釣魚與 SIM 換卡的帳號應該用 WebAuthn 或驗證器 App。
 */
@Injectable()
export class SmsMfaMethod implements MfaMethod<SmsVerifyPayload, SmsEnrollInput>, OnModuleInit {
  private readonly logger = new Logger(SmsMfaMethod.name);

  readonly definition: MfaMethodDefinition = {
    id: 'sms',
    // RFC 8176 的 `sms`：以簡訊送出的驗證碼
    amr: 'sms',
    realms: ['tenant', 'platform'],
    maxFactorsPerAccount: 2,
    challenge: 'server',
    enrollChallenge: 'immediate',
    enrollAt: 'anywhere',
    defaultEnabled: false,
    assurance: 'messaging',
    settings: {
      fields: [
        {
          key: 'provider',
          type: 'select',
          required: true,
          options: SMS_PROVIDERS,
          defaultValue: 'twilio',
        },
        {
          key: 'twilioAccountSid',
          type: 'text',
          required: true,
          requiredWhen: { key: 'provider', equals: 'twilio' },
          maxLength: 64,
        },
        {
          key: 'twilioAuthToken',
          type: 'secret',
          required: true,
          requiredWhen: { key: 'provider', equals: 'twilio' },
          maxLength: 128,
        },
        {
          key: 'twilioFrom',
          type: 'text',
          required: true,
          requiredWhen: { key: 'provider', equals: 'twilio' },
          maxLength: 64,
        },
        {
          key: 'webhookUrl',
          type: 'url',
          required: true,
          requiredWhen: { key: 'provider', equals: 'webhook' },
          maxLength: 2000,
        },
        {
          key: 'webhookSecret',
          type: 'secret',
          required: true,
          requiredWhen: { key: 'provider', equals: 'webhook' },
          maxLength: 256,
        },
        {
          key: 'allowedCountryCodes',
          type: 'text',
          required: true,
          defaultValue: '886',
          maxLength: 200,
        },
      ],
    },
  };

  readonly verifySchema = SmsVerifySchema;
  readonly enrollSchema = SmsEnrollSchema;

  constructor(
    private readonly registry: MfaMethodRegistry,
    private readonly settings: MfaMethodSettings,
    private readonly delivery: MfaChallengeDelivery,
    private readonly jobs: JobQueue,
    private readonly gateway: SmsGateway,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
    this.jobs.register(MFA_SMS_CODE_JOB, (data, ctx) => this.send('tenant', data, ctx));
    this.jobs.register(MFA_PLATFORM_SMS_CODE_JOB, (data, ctx) => this.send('platform', data, ctx));
  }

  async checkSettings(values: MfaSettingValues): Promise<MfaSettingsCheck> {
    if (parseCountryCodes(values.allowedCountryCodes).length === 0) {
      return { ok: false, fields: { allowedCountryCodes: 'MFA_SETTING_INVALID_FORMAT' } };
    }
    return this.gateway.check(values);
  }

  async beginEnrollment(
    _ctx: MfaAccountContext,
    input: SmsEnrollInput | undefined,
  ): Promise<MfaEnrollmentStart> {
    const phone = input?.phone ?? '';
    const allowed = parseCountryCodes(
      this.settings.require(this.definition.id).allowedCountryCodes,
    );
    if (!isAllowedCountry(phone, allowed)) {
      throw new AppException('VALIDATION_FAILED', {
        fields: { 'input.phone': 'MFA_PHONE_COUNTRY_NOT_ALLOWED' },
        allowedCountryCodes: allowed,
      });
    }
    return {
      secret: phone,
      config: { phoneMasked: maskPhone(phone) },
      publicData: { phone: maskPhone(phone) },
    };
  }

  /** 寫 challenge（還沒有碼），在同一個交易入列送簡訊的工作；碼由工作產生。 */
  async startChallenge(
    ctx: MfaAccountContext,
    factor: MfaFactor,
    challenge: { id: string; purpose: MfaPurpose },
  ): Promise<MfaChallengeStart> {
    const job = ctx.realm === 'tenant' ? MFA_SMS_CODE_JOB : MFA_PLATFORM_SMS_CODE_JOB;
    await ctx.enqueue(job, { accountId: ctx.account.id, challengeId: challenge.id });
    return {
      state: { purpose: challenge.purpose },
      expiresInSeconds: SMS_CODE_TTL_SECONDS,
      resendAfterSeconds: SMS_CODE_RESEND_SECONDS,
      hint: phoneHintOf(factor) ?? undefined,
    };
  }

  async verify(
    ctx: MfaAccountContext,
    _factor: MfaFactor,
    challenge: MfaChallenge | null,
    payload: SmsVerifyPayload,
  ): Promise<MfaVerifyResult> {
    return matchesOtpCode(ctx.secrets, challenge, payload.code)
      ? { ok: true }
      : { ok: false, reason: 'invalid' };
  }

  describe(factor: MfaFactor, _account: MfaAccount): MfaFactorSummary {
    return { label: factor.label, hint: phoneHintOf(factor) };
  }

  /** 送簡訊的工作：經框架的入口確認 challenge 仍有效、帳號仍可登入，產生碼、存 HMAC、送出。 */
  async send(
    realm: MfaRealm,
    { accountId, challengeId }: SmsCodeJobData,
    { id: jobId }: JobContext,
  ): Promise<{ delivered: true } | { skipped: string }> {
    const settings = this.settings.get(this.definition.id);
    if (!settings) return { skipped: 'not_configured' };
    const result = await this.delivery.deliver(
      realm,
      accountId,
      challengeId,
      async (ctx, challenge, factor) => {
        if (!factor.secretEncrypted) throw new Error('簡訊因子沒有手機號碼');
        const phone = ctx.secrets.decrypt(factor.secretEncrypted);
        const code = generateOtpCode();
        return {
          state: {
            ...challenge.state,
            codeHash: otpCodeHash(ctx.secrets, challenge.id, code),
            sentAt: new Date().toISOString(),
          },
          send: () =>
            this.gateway.send(settings, {
              to: phone,
              code,
              locale: ctx.account.locale,
              expiresInSeconds: SMS_CODE_TTL_SECONDS,
              text: smsCodeText({
                locale: ctx.account.locale,
                issuer: mfaIssuerOf(ctx.account),
                code,
                minutes: SMS_CODE_TTL_SECONDS / 60,
                purpose: challenge.purpose,
              }),
            }),
        };
      },
    );
    if (!result.delivered) {
      this.logger.log({ jobId, realm, challengeId, reason: result.reason }, '略過 MFA 驗證碼簡訊');
      return { skipped: result.reason };
    }
    mfaChallengesSent.inc({ method: this.definition.id });
    return { delivered: true };
  }
}

function phoneHintOf(factor: MfaFactor): string | null {
  return typeof factor.config.phoneMasked === 'string' ? factor.config.phoneMasked : null;
}
