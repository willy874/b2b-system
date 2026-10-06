import { SetMetadata } from '@nestjs/common';

import type { Env } from '@/core/config';

/**
 * 速率限制（docs/architecture/backend/03-api-conventions.md §8）。
 *
 * 前提是 B2B：一間公司的上千人常共用一個 NAT 出口 IP，所以 **已登入的請求以使用者（含租戶）計**，
 * 只有未登入的請求才以 IP 計。登入類端點另外以「帳號 ＋ IP」計，續期以 refresh session 計；
 * 這兩種端點的 IP 桶只是防濫用的上限，數值按「整間公司在同一個 IP」估算。
 */

/** 所有桶的時間窗：固定 60 秒，上限都是「每分鐘幾次」。 */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * 端點的限流類別；沒標的端點走一般規則（使用者或 IP）。
 * - `auth`：登入、SSO 回呼、帳號流程的 token 端點、租戶代碼查詢、已登入時驗證目前密碼的端點（改密碼）
 * - `authMail`：會寄信或進待審清單的端點（忘記密碼、註冊）
 * - `refresh`：以 refresh cookie 續期
 */
export type RateLimitPolicy = 'auth' | 'authMail' | 'refresh';

export const RATE_LIMIT_POLICY = 'rateLimit:policy';

/** 標記端點的限流類別（取代 `@Throttle()`，數值由環境變數決定，見 `rateLimitSettingsOf`）。 */
export const RateLimit = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT_POLICY, policy);

/** 每分鐘的上限（次）。 */
export interface RateLimitSettings {
  /** 已登入：每個使用者（所有端點合計）。 */
  user: number;
  /** 未登入：每個 IP（所有端點合計）。 */
  anonymous: number;
  /** `auth`：每個「帳號 ＋ IP」；已登入的請求（沒有 email）改以身分計。 */
  authAccount: number;
  /** `auth`：每個 IP。 */
  authIp: number;
  /** `authMail`：每個「帳號 ＋ IP」。 */
  authMailAccount: number;
  /** `authMail`：每個 IP。 */
  authMailIp: number;
  /** `refresh`：每個 refresh session（cookie）。 */
  refreshSession: number;
  /** `refresh`：每個 IP。 */
  refreshIp: number;
}

export type RateLimitEnv = Pick<
  Env,
  | 'DEFAULT_RATE_LIMIT'
  | 'ANONYMOUS_RATE_LIMIT'
  | 'AUTH_RATE_LIMIT'
  | 'AUTH_IP_RATE_LIMIT'
  | 'REFRESH_RATE_LIMIT'
  | 'REFRESH_IP_RATE_LIMIT'
>;

/**
 * 環境變數 → 各桶的上限。IP 桶不會比「帳號 ＋ IP」桶嚴格（整間公司不該比單一帳號先被擋）；
 * 寄信類端點是登入類的 1/3（帳號）與 1/10（IP），至少 3 次。
 */
export function rateLimitSettingsOf(env: RateLimitEnv): RateLimitSettings {
  const authAccount = env.AUTH_RATE_LIMIT;
  const authIp = Math.max(env.AUTH_IP_RATE_LIMIT, authAccount);
  const authMailAccount = Math.max(3, Math.floor(authAccount / 3));
  return {
    user: env.DEFAULT_RATE_LIMIT,
    anonymous: env.ANONYMOUS_RATE_LIMIT,
    authAccount,
    authIp,
    authMailAccount,
    authMailIp: Math.max(authMailAccount, Math.floor(authIp / 10)),
    refreshSession: env.REFRESH_RATE_LIMIT,
    refreshIp: Math.max(env.REFRESH_IP_RATE_LIMIT, env.REFRESH_RATE_LIMIT),
  };
}

/** 從請求取出、用來決定計數對象的資訊。 */
export interface RateLimitSubject {
  /** 客戶端 IP（IPv6 已正規化成子網路）。 */
  ip: string;
  /** 已驗簽的身分：`t:{tenantId}:{userId}` 或 `p:{adminId}`。 */
  principal?: string;
  /** 登入類端點的帳號：`{tenantId | platform}:{email（小寫）}`。 */
  account?: string;
  /** 續期端點的 refresh cookie 雜湊。 */
  session?: string;
}

export interface RateLimitBucket {
  /** 桶的種類（日誌、測試用）；計數的 key 是 `{name}:{key}`。 */
  name: string;
  key: string;
  limit: number;
}

/** 一個請求要計入哪些桶；任何一個超過就回 429。 */
export function rateLimitBucketsOf(
  policy: RateLimitPolicy | undefined,
  subject: RateLimitSubject,
  settings: RateLimitSettings,
): RateLimitBucket[] {
  const { ip, account, session, principal } = subject;
  switch (policy) {
    case 'auth':
    case 'authMail': {
      const [accountLimit, ipLimit] =
        policy === 'auth'
          ? [settings.authAccount, settings.authIp]
          : [settings.authMailAccount, settings.authMailIp];
      const buckets: RateLimitBucket[] = [{ name: `${policy}-ip`, key: ip, limit: ipLimit }];
      if (account) {
        buckets.push({ name: `${policy}-account`, key: `${account}|${ip}`, limit: accountLimit });
      } else if (principal) {
        // 已登入、body 沒有 email（改密碼）：以身分計，不分 IP——拿到 token 的人換 IP 也一樣受限
        buckets.push({ name: `${policy}-principal`, key: principal, limit: accountLimit });
      }
      return buckets;
    }
    case 'refresh': {
      const buckets: RateLimitBucket[] = [
        { name: 'refresh-ip', key: ip, limit: settings.refreshIp },
      ];
      if (session) {
        buckets.push({ name: 'refresh-session', key: session, limit: settings.refreshSession });
      }
      return buckets;
    }
    default:
      return principal
        ? [{ name: 'user', key: principal, limit: settings.user }]
        : [{ name: 'anonymous', key: ip, limit: settings.anonymous }];
  }
}

/** 登入類請求的帳號：body 的 `email`（格式不對就不計帳號桶，交給 IP 桶與 DTO 驗證）。 */
export function accountOf(body: unknown, scope: string): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const email = (body as { email?: unknown }).email;
  if (typeof email !== 'string') return undefined;
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 255) return undefined;
  return `${scope}:${normalized}`;
}
