import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import type { Env } from '@/core/config';
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
  MfaSecretService,
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

import { ChannelLinkRepository } from './channel-link.repository';
import { LineChannel } from './line.channel';
import type { InboundMessage, MessagingChannel } from './messaging-channel';
import { LINK_INVALID_REPLY, LINKED_REPLY, messagingCodeText } from './messaging-text';
import {
  MESSAGING_CODE_RESEND_SECONDS,
  MESSAGING_CODE_TTL_SECONDS,
  MESSAGING_LINK_TTL_SECONDS,
  messagingCodeJobs,
} from './messaging.constants';
import type { MessagingCodeJobData } from './messaging.constants';
import { TelegramChannel } from './telegram.channel';

const MessagingVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});
type MessagingVerifyPayload = z.infer<typeof MessagingVerifySchema>;

/**
 * 通訊軟體驗證碼的共同流程（docs/architecture/backend/21-mfa.md §9.5）；Telegram、LINE 各一個子類別。
 *
 * 1. 開始設定：產生一次性的綁定碼（平台 DB 的 `mfa_channel_links` 只存它的 HMAC），回傳連結與綁定碼。
 * 2. 使用者在 App 裡把綁定碼傳給 Bot；Bot 的 webhook 以綁定碼找到這一列、記下收件對象（加密）。
 * 3. 使用者回到網頁請求驗證碼（`enrollChallenge: 'onRequest'`）：還沒綁定回 `409 MFA_CHANNEL_NOT_LINKED`。
 * 4. 輸入收到的碼：設定完成，收件對象搬進因子的 `secret_encrypted`。之後登入照 Email 的流程送碼。
 *
 * 綁定碼本身不能完成設定：收到碼的人必須回到 **同一個設定流程** 輸入驗證碼，所以別人拿到連結去綁定，只會讓設定無法完成。
 */
abstract class MessagingMfaMethod implements MfaMethod<MessagingVerifyPayload>, OnModuleInit {
  protected readonly logger = new Logger(this.constructor.name);
  abstract readonly definition: MfaMethodDefinition;
  readonly verifySchema = MessagingVerifySchema;
  private readonly jobs: ReturnType<typeof messagingCodeJobs>;
  private readonly webhookUrl: string;

  constructor(
    protected readonly channel: MessagingChannel,
    private readonly registry: MfaMethodRegistry,
    private readonly settings: MfaMethodSettings,
    private readonly secrets: MfaSecretService,
    private readonly delivery: MfaChallengeDelivery,
    private readonly queue: JobQueue,
    private readonly links: ChannelLinkRepository,
    config: ConfigService<Env, true>,
  ) {
    this.jobs = messagingCodeJobs(channel.id);
    // 對外的網址與 OIDC issuer 相同的 origin 與 api 前綴（例：https://auth.example.com/api）
    const issuer = new URL(config.get('OIDC_ISSUER', { infer: true }));
    const apiPrefix = issuer.pathname.replace(/\/oidc\/?$/, '');
    this.webhookUrl = `${issuer.origin}${apiPrefix}/mfa-channels/${channel.id}/webhook`;
  }

  onModuleInit(): void {
    this.registry.register(this);
    this.queue.register(this.jobs.tenant, (data, ctx) => this.send('tenant', data, ctx));
    this.queue.register(this.jobs.platform, (data, ctx) => this.send('platform', data, ctx));
  }

  /** 參數：以 token 呼叫 API 確認可用，並把 Bot 的 webhook 指向我們（§5.1）。 */
  checkSettings(values: MfaSettingValues): Promise<MfaSettingsCheck> {
    return this.channel.check(values, this.webhookUrl);
  }

  /** 目前的參數；方式關閉之後還在處理的 webhook 與工作會拿到 null。 */
  currentSettings(): MfaSettingValues | null {
    return this.settings.get(this.definition.id);
  }

  async beginEnrollment(ctx: MfaAccountContext): Promise<MfaEnrollmentStart> {
    const settings = this.settings.require(this.definition.id);
    const code = this.channel.newLinkCode();
    const link = await this.links.insert({
      channel: this.channel.id,
      codeHash: this.linkCodeHash(code),
      realm: ctx.realm,
      tenantId: ctx.account.tenant?.id ?? null,
      accountId: ctx.account.id,
      expiresAt: new Date(Date.now() + MESSAGING_LINK_TTL_SECONDS * 1000),
    });
    return {
      config: { linkId: link.id },
      publicData: {
        ...this.channel.linkInstructions(settings, code),
        expiresAt: link.expiresAt.toISOString(),
      },
    };
  }

  /**
   * 送出驗證碼：設定時送到剛綁定的對象（綁定還沒完成回 409），登入時送到因子存的對象。
   * 寫 challenge（還沒有碼）並在同一個交易入列送訊息的工作；碼由工作產生。
   */
  async startChallenge(
    ctx: MfaAccountContext,
    factor: MfaFactor,
    challenge: { id: string; purpose: MfaPurpose },
  ): Promise<MfaChallengeStart> {
    const state: Record<string, unknown> = { purpose: challenge.purpose };
    let hint = recipientNameOf(factor);
    if (challenge.purpose === 'enroll') {
      const linkId = typeof factor.config.linkId === 'string' ? factor.config.linkId : '';
      const link = await this.links.findOwned(linkId, {
        realm: ctx.realm,
        tenantId: ctx.account.tenant?.id ?? null,
        accountId: ctx.account.id,
      });
      if (!link || link.expiresAt.getTime() <= Date.now()) {
        throw new AppException('MFA_FACTOR_NOT_FOUND', { reason: 'linkExpired' });
      }
      if (!link.recipientEncrypted) throw new AppException('MFA_CHANNEL_NOT_LINKED');
      state.recipient = link.recipientEncrypted;
      state.recipientName = link.recipientName;
      hint = link.recipientName;
    }
    await ctx.enqueue(ctx.realm === 'tenant' ? this.jobs.tenant : this.jobs.platform, {
      accountId: ctx.account.id,
      challengeId: challenge.id,
    });
    return {
      state,
      expiresInSeconds: MESSAGING_CODE_TTL_SECONDS,
      resendAfterSeconds: MESSAGING_CODE_RESEND_SECONDS,
      ...(hint && { hint }),
    };
  }

  async verify(
    ctx: MfaAccountContext,
    _factor: MfaFactor,
    challenge: MfaChallenge | null,
    payload: MessagingVerifyPayload,
  ): Promise<MfaVerifyResult> {
    if (!matchesOtpCode(ctx.secrets, challenge, payload.code))
      return { ok: false, reason: 'invalid' };
    // 設定確認：收件對象從綁定搬進因子（之後的 challenge 不再查綁定）
    const recipient = challenge?.purpose === 'enroll' ? challenge.state.recipient : undefined;
    if (typeof recipient !== 'string') return { ok: true };
    const name = challenge?.state.recipientName;
    return {
      ok: true,
      factorUpdate: {
        secret: ctx.secrets.decrypt(recipient),
        config: { recipientName: typeof name === 'string' ? name : null },
      },
    };
  }

  describe(factor: MfaFactor, _account: MfaAccount): MfaFactorSummary {
    return { label: factor.label, hint: recipientNameOf(factor) };
  }

  /**
   * webhook 收到的訊息：是綁定碼就記下收件對象並回覆。不是綁定碼的訊息不回覆（Bot 可能也被拿來做別的事）。
   */
  async handleInbound(settings: MfaSettingValues, message: InboundMessage): Promise<void> {
    const code = this.channel.normalizeLinkCode(message.text);
    if (!code) return;
    const recipientName =
      message.recipientName ??
      (this.channel instanceof LineChannel
        ? await this.channel.displayNameOf(settings, message.recipient)
        : null);
    const linked = await this.links.link(this.channel.id, this.linkCodeHash(code), {
      encrypted: this.secrets.encrypt(message.recipient),
      name: recipientName,
    });
    try {
      await this.channel.reply(settings, message, linked ? LINKED_REPLY : LINK_INVALID_REPLY);
    } catch (error) {
      this.logger.warn({ err: error, channel: this.channel.id }, '回覆綁定結果失敗');
    }
  }

  /** 送訊息的工作：經框架的入口確認 challenge 仍有效、帳號仍可登入，產生碼、存 HMAC、送出。 */
  async send(
    realm: MfaRealm,
    { accountId, challengeId }: MessagingCodeJobData,
    { id: jobId }: JobContext,
  ): Promise<{ delivered: true } | { skipped: string }> {
    const settings = this.currentSettings();
    if (!settings) return { skipped: 'not_configured' };
    const result = await this.delivery.deliver(
      realm,
      accountId,
      challengeId,
      async (ctx, challenge, factor) => {
        const sealed =
          typeof challenge.state.recipient === 'string'
            ? challenge.state.recipient
            : factor.secretEncrypted;
        if (!sealed) throw new Error('通訊軟體的因子沒有收件對象');
        const recipient = ctx.secrets.decrypt(sealed);
        const code = generateOtpCode();
        return {
          state: {
            ...challenge.state,
            codeHash: otpCodeHash(ctx.secrets, challenge.id, code),
            sentAt: new Date().toISOString(),
          },
          send: () =>
            this.channel.sendText(
              settings,
              recipient,
              messagingCodeText({
                locale: ctx.account.locale,
                issuer: mfaIssuerOf(ctx.account),
                code,
                minutes: MESSAGING_CODE_TTL_SECONDS / 60,
              }),
            ),
        };
      },
    );
    if (!result.delivered) {
      this.logger.log({ jobId, realm, challengeId, reason: result.reason }, '略過 MFA 驗證碼訊息');
      return { skipped: result.reason };
    }
    mfaChallengesSent.inc({ method: this.definition.id });
    return { delivered: true };
  }

  /** 綁定碼只存 HMAC：DB 外洩時拿不到還沒用掉的綁定碼。 */
  private linkCodeHash(code: string): string {
    return this.secrets.hmac(`mfa-channel-link:${this.channel.id}:${code}`);
  }
}

function recipientNameOf(factor: MfaFactor): string | null {
  return typeof factor.config.recipientName === 'string' ? factor.config.recipientName : null;
}

/** Telegram 的驗證碼（§9.5）：Bot token 是平台參數，Bot 的 username 在儲存時自動取得。 */
@Injectable()
export class TelegramMfaMethod extends MessagingMfaMethod {
  readonly definition: MfaMethodDefinition = {
    id: 'telegram',
    // RFC 8176 沒有通訊軟體的值；與 Email 一樣用非登記值，稽核才分得出來（D12）
    amr: 'telegram',
    realms: ['tenant', 'platform'],
    maxFactorsPerAccount: 1,
    challenge: 'server',
    enrollChallenge: 'onRequest',
    enrollAt: 'anywhere',
    defaultEnabled: false,
    assurance: 'messaging',
    settings: {
      fields: [
        { key: 'botToken', type: 'secret', required: true, maxLength: 256 },
        // 儲存時以 getMe 取得，不必手填
        { key: 'botUsername', type: 'text', required: false, maxLength: 64 },
      ],
    },
  };

  constructor(
    channel: TelegramChannel,
    registry: MfaMethodRegistry,
    settings: MfaMethodSettings,
    secrets: MfaSecretService,
    delivery: MfaChallengeDelivery,
    queue: JobQueue,
    links: ChannelLinkRepository,
    config: ConfigService<Env, true>,
  ) {
    super(channel, registry, settings, secrets, delivery, queue, links, config);
  }
}

/** LINE 的驗證碼（§9.5）：channel access token 與 channel secret 是平台參數，官方帳號的 ID 在儲存時自動取得。 */
@Injectable()
export class LineMfaMethod extends MessagingMfaMethod {
  readonly definition: MfaMethodDefinition = {
    id: 'line',
    amr: 'line',
    realms: ['tenant', 'platform'],
    maxFactorsPerAccount: 1,
    challenge: 'server',
    enrollChallenge: 'onRequest',
    enrollAt: 'anywhere',
    defaultEnabled: false,
    assurance: 'messaging',
    settings: {
      fields: [
        { key: 'channelAccessToken', type: 'secret', required: true, maxLength: 512 },
        { key: 'channelSecret', type: 'secret', required: true, maxLength: 128 },
        { key: 'botBasicId', type: 'text', required: false, maxLength: 64 },
      ],
    },
  };

  constructor(
    channel: LineChannel,
    registry: MfaMethodRegistry,
    settings: MfaMethodSettings,
    secrets: MfaSecretService,
    delivery: MfaChallengeDelivery,
    queue: JobQueue,
    links: ChannelLinkRepository,
    config: ConfigService<Env, true>,
  ) {
    super(channel, registry, settings, secrets, delivery, queue, links, config);
  }
}
