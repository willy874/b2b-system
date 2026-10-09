import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import type { MfaSettingsCheck, MfaSettingValues } from '@/core/mfa';

import { MESSAGING_REQUEST_TIMEOUT_MS, MessagingDeliveryError } from './messaging-channel';
import type { InboundMessage, LinkInstructions, MessagingChannel } from './messaging-channel';

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/** Telegram 的 webhook 收到的更新（只用到私訊的文字訊息）。 */
export interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { username?: string; first_name?: string };
  };
}

/**
 * Telegram Bot API（docs/architecture/backend/21-mfa.md §9.5）。Bot 不能主動找人：使用者先點 `t.me/<bot>?start=<綁定碼>`，
 * 按「開始」後 Bot 收到 `/start <綁定碼>`，才知道要送到哪個 chat。
 *
 * webhook 的 `secret_token` 由 Bot token 推導（`SHA-256('mfa-telegram-webhook:' ‖ token)`），不另外存：換 token 時跟著換，
 * 儲存參數時重新登記。
 */
@Injectable()
export class TelegramChannel implements MessagingChannel {
  readonly id = 'telegram' as const;
  private readonly base: string;

  constructor(config: ConfigService<Env, true>) {
    this.base = config.get('MFA_TELEGRAM_API_URL', { infer: true }).replace(/\/$/, '');
  }

  static webhookSecretOf(botToken: string): string {
    return createHash('sha256').update(`mfa-telegram-webhook:${botToken}`).digest('hex');
  }

  newLinkCode(): string {
    return randomBytes(18).toString('base64url');
  }

  normalizeLinkCode(text: string): string | null {
    const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})\s*$/.exec(text.trim());
    return match?.[1] ?? null;
  }

  linkInstructions(settings: MfaSettingValues, code: string): LinkInstructions {
    const bot = settings.botUsername ?? '';
    return {
      linkUrl: `https://t.me/${encodeURIComponent(bot)}?start=${encodeURIComponent(code)}`,
      code: `/start ${code}`,
      botName: `@${bot}`,
    };
  }

  async sendText(settings: MfaSettingValues, recipient: string, text: string): Promise<void> {
    const response = await this.call(settings.botToken ?? '', 'sendMessage', {
      chat_id: recipient,
      text,
      protect_content: true,
    });
    if (!response.ok) {
      throw new MessagingDeliveryError(`Telegram sendMessage 失敗：${response.description ?? ''}`);
    }
  }

  async reply(settings: MfaSettingValues, message: InboundMessage, text: string): Promise<void> {
    await this.sendText(settings, message.recipient, text);
  }

  /** webhook 的內容 → 私訊的文字訊息；其他（群組、貼圖、編輯）略過。 */
  parse(update: TelegramUpdate): InboundMessage | null {
    const message = update.message;
    const chatId = message?.chat?.id;
    if (!message?.text || chatId === undefined || message.chat?.type !== 'private') return null;
    return {
      recipient: String(chatId),
      recipientName: message.from?.username
        ? `@${message.from.username}`
        : (message.from?.first_name ?? null),
      text: message.text,
    };
  }

  async check(settings: MfaSettingValues, webhookUrl: string): Promise<MfaSettingsCheck> {
    const token = settings.botToken ?? '';
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
      return { ok: false, fields: { botToken: 'MFA_SETTING_INVALID_FORMAT' } };
    }
    let me: TelegramResponse<{ username?: string }>;
    try {
      me = await this.call(token, 'getMe', {});
    } catch {
      return { ok: false, reason: 'MFA_PROVIDER_UNREACHABLE' };
    }
    if (!me.ok || !me.result?.username) {
      return { ok: false, fields: { botToken: 'MFA_SETTING_REJECTED' } };
    }
    try {
      const hook = await this.call(token, 'setWebhook', {
        url: webhookUrl,
        secret_token: TelegramChannel.webhookSecretOf(token),
        allowed_updates: ['message'],
        drop_pending_updates: true,
      });
      if (!hook.ok) return { ok: false, reason: 'MFA_MESSAGING_WEBHOOK_REJECTED' };
    } catch {
      return { ok: false, reason: 'MFA_PROVIDER_UNREACHABLE' };
    }
    return { ok: true, derived: { botUsername: me.result.username } };
  }

  private async call<T>(token: string, method: string, body: object): Promise<TelegramResponse<T>> {
    const response = await fetch(`${this.base}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MESSAGING_REQUEST_TIMEOUT_MS),
    });
    return (await response.json().catch(() => ({ ok: false }))) as TelegramResponse<T>;
  }
}
