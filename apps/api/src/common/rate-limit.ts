import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';

/**
 * `@Throttle()` 是 decorator，在 class 定義時就求值，早於 ConfigModule 載入 .env，
 * 所以這裡自己讀一次（冪等；已存在的環境變數不會被覆寫）。
 */
loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const toLimit = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** 登入 / 忘記密碼等敏感端點：預設 10 次 / 分 / IP。 */
export const AUTH_THROTTLE = {
  limit: toLimit(process.env.AUTH_RATE_LIMIT, 10),
  ttl: 60_000,
} as const;

/** `/auth/refresh` 比登入寬鬆（正常使用每 5 分鐘一次，多分頁會更頻繁）。 */
export const REFRESH_THROTTLE = {
  limit: AUTH_THROTTLE.limit * 3,
  ttl: 60_000,
} as const;

/** 註冊申請：與忘記密碼同級（每一筆都會進管理員的待審清單）。 */
export const REGISTER_THROTTLE = {
  limit: Math.max(3, Math.floor(AUTH_THROTTLE.limit / 3)),
  ttl: 60_000,
} as const;

/** 忘記密碼更嚴格。 */
export const FORGOT_PASSWORD_THROTTLE = {
  limit: Math.max(3, Math.floor(AUTH_THROTTLE.limit / 3)),
  ttl: 60_000,
} as const;
