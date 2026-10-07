import { Injectable } from '@nestjs/common';

import { AppException } from '../errors';
import { RateLimitStore } from './rate-limit-store';

/** 密碼錯誤的計數時間窗：15 分鐘內的錯誤次數。 */
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
/** 第幾次錯誤之後開始延遲（前兩次打錯不受影響）。 */
const FREE_FAILURES = 3;
/** 延遲的上限（秒）。 */
const MAX_DELAY_SECONDS = 60;

/** 第 `failures` 次錯誤之後，下一次嘗試要等的秒數：0（前兩次）、1、2、4…，上限 60。 */
export function loginDelaySeconds(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  return Math.min(MAX_DELAY_SECONDS, 2 ** (failures - FREE_FAILURES));
}

/**
 * 登入的漸進延遲（docs/architecture/backend/04-auth.md §3.4）：以「租戶或平台 × email × IP 前綴」計 15 分鐘內的密碼錯誤，
 * 第 3 次錯誤之後下一次嘗試要等 2^(n−3) 秒（上限 60）。等待期間的嘗試以 `429 RATE_LIMITED` 回應（帶 `retryAfterSeconds`），
 * **伺服器不 sleep**：睡著的請求仍佔著連線。訊息與一般限流相同，不透露「這個帳號存在而且正在被延遲」。
 * 未知的 email 一樣計數；成功登入清除。在驗證密碼（argon2）之前判斷，被延遲的請求不消耗 argon2。
 */
@Injectable()
export class LoginThrottle {
  constructor(private readonly store: RateLimitStore) {}

  async assertAllowed(scope: string, email: string, ipPrefix: string): Promise<void> {
    const record = await this.store.peek(this.keyOf(scope, email, ipPrefix));
    if (!record) return;
    const waitMs = record.lastAt + loginDelaySeconds(record.count) * 1000 - Date.now();
    if (waitMs > 0) {
      throw new AppException('RATE_LIMITED', { retryAfterSeconds: Math.ceil(waitMs / 1000) });
    }
  }

  async recordFailure(scope: string, email: string, ipPrefix: string): Promise<void> {
    await this.store.hit(this.keyOf(scope, email, ipPrefix), LOGIN_FAILURE_WINDOW_MS);
  }

  async reset(scope: string, email: string, ipPrefix: string): Promise<void> {
    await this.store.reset(this.keyOf(scope, email, ipPrefix));
  }

  private keyOf(scope: string, email: string, ipPrefix: string): string {
    return `login-failure:${scope}:${email.trim().toLowerCase()}:${ipPrefix}`;
  }
}
