import { createHmac } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import {
  assertPublicDestination,
  BlockedDestinationError,
  OutboundRequestError,
  sendOutboundRequest,
} from '@/core/http';
import type { MfaSettingsCheck, MfaSettingValues } from '@/core/mfa';

import type { SmsProvider } from './sms.constants';

const REQUEST_TIMEOUT_MS = 10_000;
const TWILIO_SID_PATTERN = /^AC[0-9a-f]{32}$/i;
/** 寄件者：E.164 號碼、Messaging Service SID（`MG…`），或英數的寄件者名稱（最多 11 字元，部分國家可用）。 */
const TWILIO_FROM_PATTERN = /^(\+[1-9]\d{7,14}|MG[0-9a-f]{32}|[A-Za-z0-9 ]{1,11})$/i;

export interface SmsMessage {
  to: string;
  text: string;
  /** 自訂閘道可能要以範本送出（只帶碼）：另外附上。 */
  code: string;
  locale: string;
  expiresInSeconds: number;
}

/** 送出失敗：工作會重試；`permanent` 的失敗（號碼無效）重試也沒用，但碼本來就會過期，一樣交給重試上限。 */
export class SmsDeliveryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * 簡訊供應商（docs/architecture/backend/21-mfa.md §9.4）：
 * - **Twilio**：Messages API（Basic auth：Account SID ＋ Auth Token）。
 * - **webhook**：平台自己的簡訊閘道。POST JSON 到平台管理者填的網址，以 HMAC-SHA256 簽章
 *   （`X-B2B-Signature: v1=<hex>`，內容是 `<timestamp>.<body>`；`X-B2B-Timestamp` 是 Unix 秒），與對外 webhook 同樣的防護：
 *   production 只接受 https、不連私有網段、不跟隨轉址。
 */
@Injectable()
export class SmsGateway {
  private readonly twilioBase: string;
  private readonly production: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.twilioBase = config.get('MFA_TWILIO_API_URL', { infer: true }).replace(/\/$/, '');
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  async send(settings: MfaSettingValues, message: SmsMessage): Promise<void> {
    const provider = settings.provider as SmsProvider;
    if (provider === 'twilio') return this.sendTwilio(settings, message);
    return this.sendWebhook(settings, {
      type: 'mfa.code',
      to: message.to,
      text: message.text,
      code: message.code,
      locale: message.locale,
      expiresInSeconds: message.expiresInSeconds,
    });
  }

  /** 儲存參數前的檢查：Twilio 以金鑰讀取帳號；自訂閘道送一個 `ping`（要回 2xx）。 */
  async check(settings: MfaSettingValues): Promise<MfaSettingsCheck> {
    if (settings.provider === 'twilio') return this.checkTwilio(settings);
    return this.checkWebhook(settings);
  }

  // ── Twilio ─────────────────────────────────────────────

  private twilioAuth(settings: MfaSettingValues): string {
    const credentials = `${settings.twilioAccountSid}:${settings.twilioAuthToken}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  private async sendTwilio(settings: MfaSettingValues, message: SmsMessage): Promise<void> {
    const from = settings.twilioFrom ?? '';
    const form = new URLSearchParams({ To: message.to, Body: message.text });
    if (/^MG/i.test(from)) form.set('MessagingServiceSid', from);
    else form.set('From', from);
    const response = await fetch(
      `${this.twilioBase}/2010-04-01/Accounts/${encodeURIComponent(settings.twilioAccountSid ?? '')}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: this.twilioAuth(settings),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new SmsDeliveryError(
        `Twilio 回應 ${response.status}：${body.slice(0, 300)}`,
        response.status,
      );
    }
  }

  private async checkTwilio(settings: MfaSettingValues): Promise<MfaSettingsCheck> {
    const fields: Record<string, string> = {};
    if (!TWILIO_SID_PATTERN.test(settings.twilioAccountSid ?? '')) {
      fields.twilioAccountSid = 'MFA_SETTING_INVALID_FORMAT';
    }
    if (!TWILIO_FROM_PATTERN.test(settings.twilioFrom ?? '')) {
      fields.twilioFrom = 'MFA_SETTING_INVALID_FORMAT';
    }
    if (Object.keys(fields).length) return { ok: false, fields };
    let response: Response;
    try {
      response = await fetch(
        `${this.twilioBase}/2010-04-01/Accounts/${encodeURIComponent(settings.twilioAccountSid ?? '')}.json`,
        {
          headers: { authorization: this.twilioAuth(settings) },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      return { ok: false, reason: 'MFA_PROVIDER_UNREACHABLE' };
    }
    if (response.status === 401) {
      return { ok: false, fields: { twilioAuthToken: 'MFA_SETTING_REJECTED' } };
    }
    if (response.status === 404) {
      return { ok: false, fields: { twilioAccountSid: 'MFA_SETTING_REJECTED' } };
    }
    if (!response.ok) return { ok: false, reason: 'MFA_PROVIDER_ERROR' };
    return { ok: true };
  }

  // ── 自訂閘道 ───────────────────────────────────────────

  private async sendWebhook(settings: MfaSettingValues, payload: object): Promise<void> {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', settings.webhookSecret ?? '')
      .update(`${timestamp}.${body}`)
      .digest('hex');
    let response;
    try {
      response = await sendOutboundRequest({
        method: 'POST',
        url: new URL(settings.webhookUrl ?? ''),
        headers: {
          'content-type': 'application/json',
          'x-b2b-timestamp': timestamp,
          'x-b2b-signature': `v1=${signature}`,
        },
        body,
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxResponseBytes: 4096,
        blockPrivateNetworks: this.production,
      });
    } catch (error) {
      const code = error instanceof OutboundRequestError ? error.code : 'NETWORK';
      throw new SmsDeliveryError(`簡訊閘道連線失敗：${code}`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new SmsDeliveryError(`簡訊閘道回應 ${response.status}`, response.status);
    }
  }

  private async checkWebhook(settings: MfaSettingValues): Promise<MfaSettingsCheck> {
    const raw = settings.webhookUrl ?? '';
    if (!URL.canParse(raw)) return { ok: false, fields: { webhookUrl: 'MFA_SETTING_INVALID_URL' } };
    const url = new URL(raw);
    if (url.username || url.password || (this.production && url.protocol !== 'https:')) {
      return { ok: false, fields: { webhookUrl: 'MFA_SETTING_INVALID_URL' } };
    }
    if (this.production) {
      try {
        await assertPublicDestination(url);
      } catch (error) {
        if (error instanceof BlockedDestinationError) {
          return { ok: false, fields: { webhookUrl: 'MFA_SETTING_PRIVATE_ADDRESS' } };
        }
        return { ok: false, fields: { webhookUrl: 'MFA_SETTING_UNRESOLVABLE' } };
      }
    }
    try {
      await this.sendWebhook(settings, { type: 'ping' });
    } catch {
      return { ok: false, reason: 'MFA_PROVIDER_UNREACHABLE' };
    }
    return { ok: true };
  }
}
