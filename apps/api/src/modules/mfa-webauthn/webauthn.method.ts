import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { z } from 'zod';

import type { Env } from '@/core/config';
import { MfaMethodRegistry, MfaMethodSettings } from '@/core/mfa';
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
  MfaPasswordless,
  MfaPurpose,
  MfaSettingsCheck,
  MfaSettingValues,
  MfaVerifyResult,
} from '@/core/mfa';

/** 瀏覽器 API 的逾時與 challenge 的有效時間（使用者要找金鑰、按指紋）。 */
const CEREMONY_TIMEOUT_SECONDS = 5 * 60;
const USER_VERIFICATION = ['preferred', 'required', 'discouraged'] as const;
const ATTACHMENTS = ['any', 'platform', 'crossPlatform'] as const;
/** 通行金鑰取代密碼（docs/architecture/04-sso.md §3.6）：預設關閉，平台管理者在方式的參數開啟。 */
const PASSKEY_LOGIN = ['disabled', 'enabled'] as const;

/** `@simplewebauthn/browser` 的 `startRegistration`／`startAuthentication` 的結果；細節由函式庫驗證。 */
const CredentialResponseSchema = z
  .object({
    id: z.string().min(1).max(1024),
    rawId: z.string().min(1).max(1024),
    type: z.literal('public-key'),
    response: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const WebAuthnVerifySchema = z.object({ response: CredentialResponseSchema });
type WebAuthnVerifyPayload = z.infer<typeof WebAuthnVerifySchema>;

/** 因子的 `config`：憑證的公開資訊（公鑰不是機密）。 */
const CredentialConfigSchema = z.object({
  credentialId: z.string(),
  publicKey: z.string(),
  rpId: z.string(),
  transports: z.array(z.string()).optional(),
});

/**
 * challenge 的 `state`：這次要瀏覽器簽的 challenge 與 RP ID。通行金鑰登入（取代密碼）的狀態帶 `userVerification: 'required'`：
 * 只有「持有 ＋ 生物辨識或 PIN」才能取代「密碼 ＋ 第二因素」，不看平台參數的 `userVerification`。
 */
const CeremonyStateSchema = z.object({
  challenge: z.string(),
  rpId: z.string(),
  userVerification: z.literal('required').optional(),
});

const toBytes = (base64url: string) => new Uint8Array(Buffer.from(base64url, 'base64url'));

/**
 * WebAuthn（安全金鑰、通行金鑰；docs/architecture/backend/21-mfa.md §9.3）：唯一能防釣魚的方式——瀏覽器只會對註冊時的網域簽章，
 * 假冒的登入頁拿不到可用的回應。
 *
 * - 憑證綁 RP ID（預設是 apps/platform 的網域）：登入互動在 apps/platform，所以只能在那裡註冊（`enrollAt: 'idp'`，D14）。
 *   租戶的使用者從 backstage 以「重新登入並新增」的帳號動作進入（§7.1）；平台管理者直接在 apps/platform 的個人資料頁。
 * - 註冊與驗證都要伺服器先產生 challenge（`challenge: 'server'`），存在 `mfa_challenges.state`，用過即消耗。
 * - 驗證成功後公鑰與憑證 id 存進因子的 `config`；簽章計數存 `last_used_counter`（同步型的通行金鑰永遠是 0，不比較）。
 */
@Injectable()
export class WebAuthnMfaMethod implements MfaMethod<WebAuthnVerifyPayload>, OnModuleInit {
  private readonly logger = new Logger(WebAuthnMfaMethod.name);
  private readonly origin: string;
  private readonly host: string;

  readonly definition: MfaMethodDefinition = {
    id: 'webauthn',
    // RFC 8176：`hwk` 是持有的硬體金鑰；同步型的通行金鑰也用它（稽核另外記方式 id）
    amr: 'hwk',
    realms: ['tenant', 'platform'],
    maxFactorsPerAccount: 10,
    challenge: 'server',
    enrollChallenge: 'immediate',
    enrollAt: 'idp',
    defaultEnabled: false,
    assurance: 'phishingResistant',
    settings: {
      fields: [
        {
          key: 'rpName',
          type: 'text',
          required: true,
          defaultValue: 'B2B Platform',
          maxLength: 64,
        },
        { key: 'rpId', type: 'text', required: false, maxLength: 253 },
        {
          key: 'userVerification',
          type: 'select',
          required: true,
          options: USER_VERIFICATION,
          defaultValue: 'preferred',
        },
        {
          key: 'authenticatorAttachment',
          type: 'select',
          required: true,
          options: ATTACHMENTS,
          defaultValue: 'any',
        },
        // 不是必填：加這個欄位之前就儲存過參數的方式不能因此變成「沒填齊」而被關掉；沒有值 = disabled
        {
          key: 'passkeyLogin',
          type: 'select',
          required: false,
          options: PASSKEY_LOGIN,
          defaultValue: 'disabled',
        },
      ],
    },
  };

  readonly verifySchema = WebAuthnVerifySchema;

  /**
   * 通行金鑰取代密碼（docs/architecture/04-sso.md §3.6）：discoverable credential 的流程——不帶 `allowCredentials`，
   * 由瀏覽器列出這個網域的通行金鑰；回應帶憑證 id 與 user handle，框架以它們找出因子與帳號，再交給 `verify`。
   */
  readonly passwordless: MfaPasswordless<WebAuthnVerifyPayload> = {
    enabled: () => this.settings.get(this.definition.id)?.passkeyLogin === 'enabled',
    begin: async () => {
      const settings = this.settings.require(this.definition.id);
      const rpId = this.rpIdOf(settings);
      const options = await generateAuthenticationOptions({
        rpID: rpId,
        userVerification: 'required',
        timeout: CEREMONY_TIMEOUT_SECONDS * 1000,
      });
      return {
        state: { challenge: options.challenge, rpId, userVerification: 'required' },
        publicData: { options },
        expiresInSeconds: CEREMONY_TIMEOUT_SECONDS,
      };
    },
    locate: (payload) => {
      const userHandle = payload.response.response.userHandle;
      return {
        configKey: 'credentialId',
        value: payload.response.id,
        accountHandle: typeof userHandle === 'string' ? userHandle : null,
      };
    },
    accountHandle: (account) => Buffer.from(userHandleOf(account)).toString('base64url'),
  };

  constructor(
    private readonly registry: MfaMethodRegistry,
    private readonly settings: MfaMethodSettings,
    config: ConfigService<Env, true>,
  ) {
    const platform = new URL(config.get('PLATFORM_APP_URL', { infer: true }));
    this.origin = platform.origin;
    this.host = platform.hostname;
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** RP ID 必須是 apps/platform 的網域或它的上層網域（瀏覽器的規則），否則註冊一定失敗。 */
  async checkSettings(values: MfaSettingValues): Promise<MfaSettingsCheck> {
    const rpId = values.rpId?.toLowerCase();
    if (rpId && rpId !== this.host && !this.host.endsWith(`.${rpId}`)) {
      return { ok: false, fields: { rpId: 'MFA_WEBAUTHN_RPID_MISMATCH' } };
    }
    return { ok: true };
  }

  async beginEnrollment(): Promise<MfaEnrollmentStart> {
    // 註冊的 options 在 challenge 裡產生（要存 challenge），這裡沒有要先給的資料
    return { publicData: {} };
  }

  async startChallenge(
    ctx: MfaAccountContext,
    factor: MfaFactor,
    challenge: { id: string; purpose: MfaPurpose },
  ): Promise<MfaChallengeStart> {
    const settings = this.settings.require(this.definition.id);
    const userVerification = userVerificationOf(settings);
    if (challenge.purpose === 'enroll') {
      const rpId = this.rpIdOf(settings);
      const existing = await ctx.activeFactors(this.definition.id);
      const attachment = settings.authenticatorAttachment;
      const options = await generateRegistrationOptions({
        rpName: settings.rpName ?? 'B2B Platform',
        rpID: rpId,
        userName: ctx.account.email,
        // 同一個 email 在不同租戶是不同的帳號：user handle 以身分範圍與帳號 id 推導，不用 email
        userID: userHandleOf(ctx.account),
        userDisplayName: ctx.account.tenant
          ? `${ctx.account.displayName}（${ctx.account.tenant.name}）`
          : ctx.account.displayName,
        attestationType: 'none',
        timeout: CEREMONY_TIMEOUT_SECONDS * 1000,
        excludeCredentials: existing.flatMap((row) => {
          const credential = CredentialConfigSchema.safeParse(row.config);
          return credential.success
            ? [{ id: credential.data.credentialId, transports: credential.data.transports }]
            : [];
        }),
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification,
          ...(attachment === 'platform' && { authenticatorAttachment: 'platform' }),
          ...(attachment === 'crossPlatform' && { authenticatorAttachment: 'cross-platform' }),
        },
      });
      return {
        state: { challenge: options.challenge, rpId },
        expiresInSeconds: CEREMONY_TIMEOUT_SECONDS,
        resendAfterSeconds: 0,
        publicData: { options },
      };
    }

    const credential = CredentialConfigSchema.parse(factor.config);
    const options = await generateAuthenticationOptions({
      // 以註冊時的 RP ID 驗證：之後改了參數，舊的憑證仍綁在原本的網域
      rpID: credential.rpId,
      allowCredentials: [{ id: credential.credentialId, transports: credential.transports }],
      userVerification,
      timeout: CEREMONY_TIMEOUT_SECONDS * 1000,
    });
    return {
      state: { challenge: options.challenge, rpId: credential.rpId },
      expiresInSeconds: CEREMONY_TIMEOUT_SECONDS,
      resendAfterSeconds: 0,
      publicData: { options },
    };
  }

  async verify(
    _ctx: MfaAccountContext,
    factor: MfaFactor,
    challenge: MfaChallenge | null,
    payload: WebAuthnVerifyPayload,
  ): Promise<MfaVerifyResult> {
    const state = CeremonyStateSchema.safeParse(challenge?.state);
    if (!challenge || !state.success) return { ok: false, reason: 'expired' };
    const settings = this.settings.require(this.definition.id);
    const requireUserVerification =
      state.data.userVerification === 'required' || settings.userVerification === 'required';

    if (challenge.purpose === 'enroll') {
      try {
        const result = await verifyRegistrationResponse({
          response: payload.response as unknown as RegistrationResponseJSON,
          expectedChallenge: state.data.challenge,
          expectedOrigin: this.origin,
          expectedRPID: state.data.rpId,
          requireUserVerification,
        });
        if (!result.verified) return { ok: false, reason: 'invalid' };
        const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
          result.registrationInfo;
        return {
          ok: true,
          ...(credential.counter > 0 && { counter: credential.counter }),
          factorUpdate: {
            config: {
              credentialId: credential.id,
              publicKey: Buffer.from(credential.publicKey).toString('base64url'),
              rpId: state.data.rpId,
              transports: credential.transports ?? [],
              deviceType: credentialDeviceType,
              backedUp: credentialBackedUp,
              aaguid,
            },
          },
        };
      } catch (error) {
        this.logger.debug({ err: error }, 'WebAuthn 註冊的回應驗證失敗');
        return { ok: false, reason: 'invalid' };
      }
    }

    const credential = CredentialConfigSchema.safeParse(factor.config);
    if (!credential.success || payload.response.id !== credential.data.credentialId) {
      return { ok: false, reason: 'invalid' };
    }
    try {
      const result = await verifyAuthenticationResponse({
        response: payload.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: state.data.challenge,
        expectedOrigin: this.origin,
        expectedRPID: state.data.rpId,
        credential: {
          id: credential.data.credentialId,
          publicKey: toBytes(credential.data.publicKey),
          counter: factor.lastUsedCounter ?? 0,
          transports: credential.data.transports as AuthenticatorTransport[] | undefined,
        },
        requireUserVerification,
      });
      if (!result.verified) return { ok: false, reason: 'invalid' };
      // 同步型的通行金鑰計數永遠是 0：不交給框架比較（否則第二次登入就被當成重放）
      const counter = result.authenticationInfo.newCounter;
      return counter > 0 ? { ok: true, counter } : { ok: true };
    } catch (error) {
      this.logger.debug({ err: error }, 'WebAuthn 驗證的回應驗證失敗');
      return { ok: false, reason: 'invalid' };
    }
  }

  describe(factor: MfaFactor, _account: MfaAccount): MfaFactorSummary {
    return { label: factor.label, hint: null };
  }

  private rpIdOf(settings: MfaSettingValues): string {
    return settings.rpId?.toLowerCase() || this.host;
  }
}

function userVerificationOf(settings: MfaSettingValues): (typeof USER_VERIFICATION)[number] {
  const value = settings.userVerification;
  return USER_VERIFICATION.find((option) => option === value) ?? 'preferred';
}

/** 32 bytes 的 user handle：不含個資，同一個帳號每次相同（瀏覽器以它辨識「同一個人的通行金鑰」）。 */
function userHandleOf(account: MfaAccount): Uint8Array<ArrayBuffer> {
  const key = account.tenant ? `t:${account.tenant.id}:${account.id}` : `p:${account.id}`;
  return new Uint8Array(createHash('sha256').update(key).digest());
}
