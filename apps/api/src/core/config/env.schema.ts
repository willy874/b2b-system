import { z } from 'zod';

/**
 * 環境變數是啟動的前置條件：缺少或格式錯誤一律在 bootstrap 階段失敗，
 * 不容許執行到一半才發現（見 docs/architecture/backend/01-architecture.md §6）。
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),

  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.coerce.number().int().default(300),
  REFRESH_TOKEN_TTL: z.coerce.number().int().default(604800),
  REFRESH_COOKIE_NAME: z.string().default('refresh_token'),
  /**
   * Cookie 的 Path 必須是「瀏覽器看到的」refresh 端點前綴。
   * 前端一律打 `/api/*`（dev 由 Vite proxy、prod 由反向代理去掉前綴），
   * 因此這裡是 `/api/auth` 而不是 `/auth`。
   */
  REFRESH_COOKIE_PATH: z.string().default('/api/auth'),
  REFRESH_COOKIE_DOMAIN: z.string().default('localhost'),

  ARGON2_MEMORY_COST: z.coerce.number().int().default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().default(2),

  PERMISSION_CACHE_TTL: z.coerce.number().int().default(60),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().default(5),
  /** 速率限制（次 / 分 / IP）。E2E 會把 AUTH_RATE_LIMIT 調高，避免測試自己撞到 429。 */
  AUTH_RATE_LIMIT: z.coerce.number().int().default(10),
  DEFAULT_RATE_LIMIT: z.coerce.number().int().default(120),
  LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().default(900),

  /**
   * WebSocket handshake 允許的 `Origin`（逗號分隔）。`cors: false` 只代表不回 CORS 標頭，
   * 瀏覽器仍可跨站開 WebSocket，所以另外檢查（docs/architecture/backend/08-realtime.md §11）。
   */
  /**
   * Express 的 `trust proxy`：`false`（預設，直連）、`true`、代理跳數（`1`）、
   * 或子網路清單（`uniquelocal`、`10.0.0.0/8`）。HTTP throttler 與 WebSocket 的每 IP 限制
   * 都依它判定客戶端 IP；在 nginx 後面沒設的話，所有人會共用 nginx 那一個 IP 的額度。
   */
  TRUST_PROXY: z.string().default('false').transform(parseTrustProxy),

  REALTIME_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  SUPER_ADMIN_EMAIL: z.string().email(),
  // 留空 = 未設定：seed 時隨機產生並印出一次（docs/rbac/05-seed-and-bootstrap.md）。
  SUPER_ADMIN_PASSWORD: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(12).optional(),
  ),
});

export type Env = z.infer<typeof EnvSchema>;

/** 環境變數只能是字串；換成 Express `trust proxy` 接受的布林、跳數或子網路字串。 */
export function parseTrustProxy(value: string): boolean | number | string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'false') return false;
  if (trimmed === 'true') return true;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

/** 供 `ConfigModule.forRoot({ validate })` 使用；錯誤訊息明確指出缺哪一個。 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`環境變數驗證失敗：\n${issues}`);
  }
  return parsed.data;
}
