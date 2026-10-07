import type { INestApplication } from '@nestjs/common';

import { ipPrefixOf, LoginThrottle } from '@/core/rate-limit';
import { requireTenant } from '@/core/tenant';

import { inTestTenant } from './tenant';

/** supertest 從 loopback 送出：request 的 IP 可能是其中任何一種寫法；直接呼叫 service（沒有請求）時是 undefined。 */
const LOOPBACK_PREFIXES = [
  ...new Set(['127.0.0.1', '::ffff:127.0.0.1', '::1', undefined].map(ipPrefixOf)),
];

/**
 * 清掉這個 email 的登入漸進延遲（docs/architecture/backend/04-auth.md §3.4）：測帳號鎖定的檔案要連續送出錯誤密碼，
 * 第 3 次之後的嘗試會先被延遲擋下。`scope` 省略時是測試租戶，平台管理者傳 `'platform'`。
 */
export async function clearLoginDelay(
  app: INestApplication,
  email: string,
  scope?: string,
): Promise<void> {
  const throttle = app.get(LoginThrottle);
  const resolved = scope ?? (await inTestTenant(app, async () => requireTenant().id));
  await Promise.all(LOOPBACK_PREFIXES.map((prefix) => throttle.reset(resolved, email, prefix)));
}
