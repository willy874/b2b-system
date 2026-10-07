import { Injectable } from '@nestjs/common';

import type { MfaAccountContext, MfaChallenge, MfaFactor, MfaRealm } from './mfa-method';

/** 方式在背景工作裡要做的事：產生要存的狀態（例：碼的 HMAC），以及存好之後的寄送。 */
export interface MfaDelivery {
  state: Record<string, unknown>;
  send: () => Promise<void>;
}

export type MfaDeliver = (
  ctx: MfaAccountContext,
  challenge: MfaChallenge,
  factor: MfaFactor,
) => Promise<MfaDelivery>;

/** 沒有寄送的原因：challenge 已用掉或過期、帳號已停用或刪除、因子已移除。 */
export type MfaDeliveryResult =
  | { delivered: true; challengeAgeMs: number }
  | { delivered: false; reason: string };

type DeliveryImpl = (
  realm: MfaRealm,
  accountId: string,
  challengeId: string,
  deliver: MfaDeliver,
) => Promise<MfaDeliveryResult>;

/**
 * 方式在背景工作裡讀寫 challenge 的入口（docs/architecture/backend/21-mfa.md §9.2、D5）：Email 驗證碼在 **寄出當下** 產生
 * （工作資料不含碼），要寫回 challenge 的狀態。方式不直接查 DB、也不依賴 `modules/mfa`：框架在啟動時以 `bind` 接上實作，
 * 方式的工作經這裡取得帳號的脈絡與 challenge。
 */
@Injectable()
export class MfaChallengeDelivery {
  private impl?: DeliveryImpl;

  bind(impl: DeliveryImpl): void {
    if (this.impl) throw new Error('MfaChallengeDelivery 已經接上實作');
    this.impl = impl;
  }

  deliver(
    realm: MfaRealm,
    accountId: string,
    challengeId: string,
    deliver: MfaDeliver,
  ): Promise<MfaDeliveryResult> {
    if (!this.impl) throw new Error('MFA 的框架（modules/mfa）沒有載入');
    return this.impl(realm, accountId, challengeId, deliver);
  }
}
