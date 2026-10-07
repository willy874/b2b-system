import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import {
  base32Decode,
  DEFAULT_TOTP_OPTIONS,
  generateTotpSecret,
  mfaIssuerOf,
  MfaMethodRegistry,
  totpUri,
  verifyTotp,
} from '@/core/mfa';
import type {
  MfaAccount,
  MfaAccountContext,
  MfaEnrollmentStart,
  MfaFactor,
  MfaFactorSummary,
  MfaMethod,
  MfaMethodDefinition,
  MfaVerifyResult,
  TotpAlgorithm,
  TotpOptions,
} from '@/core/mfa';

const TotpVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6,8}$/),
});
type TotpVerifyPayload = z.infer<typeof TotpVerifySchema>;

/** 因子的 `config`：存設定時用的參數，之後改預設值也不影響已設定的人。 */
const TotpConfigSchema = z.object({
  algorithm: z.enum(['sha1', 'sha256', 'sha512']),
  digits: z.number().int().min(6).max(8),
  period: z.number().int().min(15).max(120),
});

function optionsOf(factor: MfaFactor): TotpOptions {
  const parsed = TotpConfigSchema.safeParse(factor.config);
  return parsed.success
    ? {
        algorithm: parsed.data.algorithm as TotpAlgorithm,
        digits: parsed.data.digits,
        period: parsed.data.period,
      }
    : DEFAULT_TOTP_OPTIONS;
}

/**
 * 驗證器 App（RFC 6238；docs/architecture/backend/21-mfa.md §9.1）：HMAC-SHA1、6 位數、30 秒，前後各容許 1 個時間步。
 * seed 只出現在設定的回應裡；之後以 `MFA_SECRET_KEY` 加密存放。重放由框架以回傳的時間步擋下。
 */
@Injectable()
export class TotpMfaMethod implements MfaMethod<TotpVerifyPayload>, OnModuleInit {
  readonly definition: MfaMethodDefinition = {
    id: 'totp',
    amr: 'otp',
    realms: ['tenant', 'platform'],
    maxFactorsPerAccount: 5,
    challenge: 'none',
    enrollAt: 'anywhere',
    defaultEnabled: true,
    assurance: 'possession',
  };

  readonly verifySchema = TotpVerifySchema;

  constructor(private readonly registry: MfaMethodRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async beginEnrollment(ctx: MfaAccountContext): Promise<MfaEnrollmentStart> {
    const secret = generateTotpSecret();
    const options = DEFAULT_TOTP_OPTIONS;
    return {
      secret,
      config: { ...options },
      publicData: {
        otpauthUri: totpUri({
          secret,
          issuer: mfaIssuerOf(ctx.account),
          accountName: ctx.account.email,
          options,
        }),
        // 無法掃描時手動輸入（每 4 個字元一組比較好抄）
        secret: secret.replace(/(.{4})/g, '$1 ').trim(),
        digits: options.digits,
        period: options.period,
      },
    };
  }

  async verify(
    ctx: MfaAccountContext,
    factor: MfaFactor,
    _challenge: null,
    payload: TotpVerifyPayload,
  ): Promise<MfaVerifyResult> {
    if (!factor.secretEncrypted) return { ok: false, reason: 'invalid' };
    const key = base32Decode(ctx.secrets.decrypt(factor.secretEncrypted));
    const counter = verifyTotp(key, payload.code, Date.now(), optionsOf(factor));
    if (counter === null) return { ok: false, reason: 'invalid' };
    // 同一個時間步（或更早的）已經用過：30 秒內同一個碼不能用兩次
    if (factor.lastUsedCounter !== null && counter <= factor.lastUsedCounter) {
      return { ok: false, reason: 'replayed' };
    }
    return { ok: true, counter };
  }

  describe(factor: MfaFactor, _account: MfaAccount): MfaFactorSummary {
    return { label: factor.label, hint: null };
  }
}
