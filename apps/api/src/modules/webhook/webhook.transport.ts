import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { SecretBox, WEBHOOK_SECRET_PURPOSE } from '@/core/crypto';
import { AppException } from '@/core/errors';
import {
  assertPublicDestination,
  BlockedDestinationError,
  OutboundRequestError,
  sendOutboundRequest,
} from '@/core/http';
import type { OutboundResponse } from '@/core/http';

import { WEBHOOK_DELIVERY_TIMEOUT_MS, WEBHOOK_RESPONSE_EXCERPT_BYTES } from './webhook.constants';

/** 一次投遞的結果：有收到回應（`status`），或沒有（`error` 是原因代碼）。 */
export type WebhookSendResult =
  | { received: true; response: OutboundResponse }
  | { received: false; error: string };

/**
 * webhook 對外連線的唯一出口（docs/adr/0030-webhooks.md D11、D15）：網址檢查、送出、密鑰的加解密。
 * production 擋私有位址並在連線時綁定已驗證的位址、只接受 https；其他環境允許 http 與內網，才能打本機的接收端
 * （與外部 IdP 的 `blockPrivateNetworks` 同一個判斷）。整合測試以假的 transport 取代它。
 */
@Injectable()
export class WebhookTransport {
  private readonly blockPrivateNetworks: boolean;
  private readonly secrets: SecretBox;

  constructor(config: ConfigService<Env, true>) {
    this.blockPrivateNetworks = config.get('NODE_ENV', { infer: true }) === 'production';
    this.secrets = SecretBox.fromConfig(
      config.get('WEBHOOK_SECRET_KEY', { infer: true }),
      config.get('JWT_SECRET', { infer: true }),
      WEBHOOK_SECRET_PURPOSE,
    );
  }

  encryptSecret(secret: string): string {
    return this.secrets.encrypt(secret);
  }

  decryptSecret(sealed: string): string {
    return this.secrets.decrypt(sealed);
  }

  /**
   * 儲存前檢查網址，不行就回 `WEBHOOK_URL_NOT_ALLOWED`（`details.reason`）。正規化後的網址（`URL.href`）才存進資料庫。
   * 這裡的 DNS 檢查只為了及早告訴使用者；真正的防線是投遞時綁定已驗證的位址（DNS 之後可能改指向內網）。
   */
  async normalizeUrl(raw: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new AppException('WEBHOOK_URL_NOT_ALLOWED', { reason: 'invalid' });
    }
    const allowedProtocol =
      url.protocol === 'https:' || (!this.blockPrivateNetworks && url.protocol === 'http:');
    if (!allowedProtocol) throw new AppException('WEBHOOK_URL_NOT_ALLOWED', { reason: 'protocol' });
    // 帳密會出現在投遞紀錄與畫面上；接收端要驗證來源請用簽章
    if (url.username || url.password) {
      throw new AppException('WEBHOOK_URL_NOT_ALLOWED', { reason: 'credentials' });
    }
    if (this.blockPrivateNetworks) {
      try {
        await assertPublicDestination(url);
      } catch (error) {
        const reason = error instanceof BlockedDestinationError ? 'blocked' : 'unresolvable';
        throw new AppException('WEBHOOK_URL_NOT_ALLOWED', { reason });
      }
    }
    return url.href;
  }

  /** 送出一次（不跟隨轉址、10 秒逾時、回應只讀前 1 KB）；連線層的失敗不拋出，回傳原因代碼。 */
  async send(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<WebhookSendResult> {
    try {
      const response = await sendOutboundRequest({
        method: 'POST',
        url: new URL(url),
        headers,
        body,
        timeoutMs: WEBHOOK_DELIVERY_TIMEOUT_MS,
        maxResponseBytes: WEBHOOK_RESPONSE_EXCERPT_BYTES,
        blockPrivateNetworks: this.blockPrivateNetworks,
      });
      return { received: true, response };
    } catch (error) {
      return {
        received: false,
        error: error instanceof OutboundRequestError ? error.code : 'REQUEST_FAILED',
      };
    }
  }
}
