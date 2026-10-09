import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import type { MfaSettingsCheck, MfaSettingValues } from '@/core/mfa';

import { MESSAGING_REQUEST_TIMEOUT_MS, MessagingDeliveryError } from './messaging-channel';
import type { InboundMessage, LinkInstructions, MessagingChannel } from './messaging-channel';

/** Crockford base32：沒有 I、L、O、U，口頭與手動輸入不易混淆。 */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

/** LINE 的 webhook（只用到文字訊息）。 */
export interface LineWebhookBody {
  events?: Array<{
    type?: string;
    replyToken?: string;
    source?: { type?: string; userId?: string };
    message?: { type?: string; text?: string };
  }>;
}

/**
 * LINE Messaging API（docs/architecture/backend/21-mfa.md §9.5）。使用者先加入官方帳號為好友，再傳送綁定碼；
 * webhook 以 channel secret 的 HMAC-SHA256 簽章（`X-Line-Signature`，對原始的請求本體）。
 * 驗證碼以 push message 送出（會計入官方帳號的訊息額度）。
 */
@Injectable()
export class LineChannel implements MessagingChannel {
  readonly id = 'line' as const;
  private readonly base: string;

  constructor(config: ConfigService<Env, true>) {
    this.base = config.get('MFA_LINE_API_URL', { infer: true }).replace(/\/$/, '');
  }

  /** `X-Line-Signature` = base64(HMAC-SHA256(channel secret, 原始本體))。 */
  static verifySignature(
    channelSecret: string,
    rawBody: Buffer,
    signature: string | undefined,
  ): boolean {
    if (!signature || !channelSecret) return false;
    const expected = createHmac('sha256', channelSecret).update(rawBody).digest();
    const given = Buffer.from(signature, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  newLinkCode(): string {
    let code = '';
    for (let index = 0; index < CODE_LENGTH; index += 1) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return `${code.slice(0, 4)}-${code.slice(4)}`;
  }

  normalizeLinkCode(text: string): string | null {
    const normalized = text
      .toUpperCase()
      .replace(/[\s-]/g, '')
      .replace(/O/g, '0')
      .replace(/[IL]/g, '1');
    const code = /([0-9A-HJKMNP-TV-Z]{8})$/.exec(normalized)?.[1];
    return code ? `${code.slice(0, 4)}-${code.slice(4)}` : null;
  }

  linkInstructions(settings: MfaSettingValues, code: string): LinkInstructions {
    const basicId = settings.botBasicId ?? '';
    return {
      linkUrl: `https://line.me/R/oaMessage/${encodeURIComponent(basicId)}/?${encodeURIComponent(code)}`,
      addFriendUrl: `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`,
      code,
      botName: basicId,
    };
  }

  async sendText(settings: MfaSettingValues, recipient: string, text: string): Promise<void> {
    const response = await this.call(settings, '/v2/bot/message/push', 'POST', {
      to: recipient,
      messages: [{ type: 'text', text }],
    });
    if (!response.ok) {
      throw new MessagingDeliveryError(`LINE push 失敗：${response.status}`);
    }
  }

  async reply(settings: MfaSettingValues, message: InboundMessage, text: string): Promise<void> {
    if (!message.replyToken) return this.sendText(settings, message.recipient, text);
    await this.call(settings, '/v2/bot/message/reply', 'POST', {
      replyToken: message.replyToken,
      messages: [{ type: 'text', text }],
    });
  }

  /** webhook 的事件 → 一對一聊天的文字訊息。 */
  parse(body: LineWebhookBody): InboundMessage[] {
    return (body.events ?? []).flatMap((event) => {
      const userId = event.source?.userId;
      if (
        event.type !== 'message' ||
        event.message?.type !== 'text' ||
        event.source?.type !== 'user' ||
        !userId ||
        !event.message.text
      ) {
        return [];
      }
      return [
        {
          recipient: userId,
          recipientName: null,
          text: event.message.text,
          replyToken: event.replyToken,
        },
      ];
    });
  }

  /** 顯示名稱（列表的提示）；取不到就算了。 */
  async displayNameOf(settings: MfaSettingValues, userId: string): Promise<string | null> {
    try {
      const response = await this.call(
        settings,
        `/v2/bot/profile/${encodeURIComponent(userId)}`,
        'GET',
      );
      if (!response.ok) return null;
      const profile = (await response.json()) as { displayName?: string };
      return profile.displayName ?? null;
    } catch {
      return null;
    }
  }

  async check(settings: MfaSettingValues, webhookUrl: string): Promise<MfaSettingsCheck> {
    let info: Response;
    try {
      info = await this.call(settings, '/v2/bot/info', 'GET');
    } catch {
      return { ok: false, reason: 'MFA_PROVIDER_UNREACHABLE' };
    }
    if (info.status === 401)
      return { ok: false, fields: { channelAccessToken: 'MFA_SETTING_REJECTED' } };
    if (!info.ok) return { ok: false, reason: 'MFA_PROVIDER_ERROR' };
    const bot = (await info.json().catch(() => ({}))) as { basicId?: string };
    if (!bot.basicId) return { ok: false, reason: 'MFA_PROVIDER_ERROR' };
    try {
      const hook = await this.call(settings, '/v2/bot/channel/webhook/endpoint', 'PUT', {
        endpoint: webhookUrl,
      });
      if (!hook.ok) return { ok: false, reason: 'MFA_MESSAGING_WEBHOOK_REJECTED' };
    } catch {
      return { ok: false, reason: 'MFA_PROVIDER_UNREACHABLE' };
    }
    return { ok: true, derived: { botBasicId: bot.basicId } };
  }

  private call(
    settings: MfaSettingValues,
    path: string,
    method: 'GET' | 'POST' | 'PUT',
    body?: object,
  ): Promise<Response> {
    return fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${settings.channelAccessToken ?? ''}`,
        ...(body && { 'content-type': 'application/json' }),
      },
      ...(body && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(MESSAGING_REQUEST_TIMEOUT_MS),
    });
  }
}
