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
  /**
   * 瀏覽器看到的 api 位址（同源時是路徑前綴）。api 自己產生、要放進 `<img src>` 的網址
   * （影像 API，docs/architecture/backend/09-file.md §5.4）以它開頭；理由同 `REFRESH_COOKIE_PATH`。
   */
  API_PUBLIC_BASE_URL: z
    .string()
    .default('/api')
    .transform((value) => value.replace(/\/+$/, '')),

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

  /**
   * 物件儲存（S3 相容；本機是 apps/file-storage，正式環境可直接換成 S3）。
   * `ENDPOINT` 是 api 自己連線用的位址；`PUBLIC_ENDPOINT` 是瀏覽器看到的位址，
   * presigned URL 以它簽章——兩者的路徑前綴必須相同（docs/architecture/backend/09-file.md §3）。
   */
  FILE_STORAGE_ENDPOINT: z.string().url().default('http://127.0.0.1:9000/storage'),
  FILE_STORAGE_PUBLIC_ENDPOINT: z.string().url().default('http://localhost:5173/storage'),
  FILE_STORAGE_REGION: z.string().min(1).default('us-east-1'),
  FILE_STORAGE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, '必須符合 S3 bucket 命名規則')
    .default('b2b-system'),
  FILE_STORAGE_ACCESS_KEY_ID: z.string().min(3),
  FILE_STORAGE_SECRET_ACCESS_KEY: z.string().min(8),
  /** 單一檔案上限（位元組）。 */
  FILE_UPLOAD_MAX_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024),
  /** presigned 上傳 / 下載網址的有效秒數。 */
  FILE_URL_TTL: z.coerce.number().int().min(60).max(604_800).default(900),
  /**
   * 超過這個大小（位元組）改用分塊上傳（S3 multipart upload），瀏覽器可以逐塊追蹤進度、失敗只重傳那一塊。
   * 見 docs/architecture/backend/09-file.md §5.2。
   */
  FILE_MULTIPART_THRESHOLD: z.coerce
    .number()
    .int()
    .positive()
    .default(16 * 1024 * 1024),
  /** 分塊上傳的每塊大小（位元組）。S3 規定除了最後一塊都至少 5 MiB。 */
  FILE_MULTIPART_PART_SIZE: z.coerce
    .number()
    .int()
    .min(5 * 1024 * 1024)
    .max(5 * 1024 * 1024 * 1024)
    .default(8 * 1024 * 1024),
  /**
   * 登記後超過這個秒數仍未完成的上傳視為放棄：由維護排程清掉紀錄、分塊與已上傳的內容。
   * 至少要比 `FILE_URL_TTL` 長（大檔會邊傳邊要新的分塊網址，實際上傳時間可能遠超過一個 TTL）。
   * 見 docs/architecture/backend/09-file.md §9。
   */
  FILE_PENDING_TTL: z.coerce.number().int().min(60).default(86_400),
  /** 檔案維護排程（殘留清理、補產生影像變體）的 cron（UTC）；空字串停用。 */
  FILE_MAINTENANCE_CRON: z.string().trim().default('0 * * * *'),
  /** `true`：維護排程只偵測並記錄殘留，不刪除任何東西。 */
  FILE_MAINTENANCE_DRY_RUN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /**
   * 這個程序是否執行背景工作（worker ＋ 排程）。`false` 時仍可入列，由另一個以同一映像、
   * 設為 `true` 的容器執行（docs/adr/0016-background-jobs.md D4、D5）。
   */
  JOBS_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /**
   * 郵件寄送方式（docs/architecture/backend/11-mail.md）：`smtp` 經 nodemailer 寄出（本機寄給 Mailpit）；
   * `console` 只寫日誌（含連結），給測試與沒有收信工具的環境用。
   */
  MAIL_TRANSPORT: z.enum(['smtp', 'console']).default('console'),
  /** SMTP 連線網址，例：`smtp://localhost:1025`、`smtps://user:pass@smtp.example.com:465`。 */
  MAIL_SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().min(3).default('B2B System <no-reply@localhost>'),
  /** 瀏覽器看到的前端網址；信裡的連結（啟用、重設密碼）以它開頭。 */
  APP_PUBLIC_URL: z
    .string()
    .url()
    .default('http://localhost:5173')
    .transform((value) => value.replace(/\/+$/, '')),

  // ── SSO：apps/api 當 OIDC Provider（docs/adr/0019-sso-identity-platform.md）──────────
  /** apps/auth 的網址（瀏覽器看到的）：登入互動頁與第一方 client `auth` 的 redirect URI 以它開頭。 */
  AUTH_APP_URL: z
    .string()
    .url()
    .default('http://localhost:5175')
    .transform((value) => value.replace(/\/+$/, '')),
  /** OIDC issuer：apps/auth origin 底下的 `/api/oidc`（反向代理去掉 `/api` 後由本程序的 `/oidc` 處理）。 */
  OIDC_ISSUER: z
    .string()
    .url()
    .default('http://localhost:5175/api/oidc')
    .transform((value) => value.replace(/\/+$/, '')),
  /**
   * 簽 ID token 的私鑰（JWKS JSON：`{"keys":[…]}`）。沒設定時啟動時產生一把臨時金鑰（重啟後舊 token 失效），
   * **production 必填**；輪替時新舊金鑰並存（D11）。
   */
  OIDC_JWKS: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  /** 簽 IdP cookie 的金鑰，逗號分隔（第一把用來簽、全部都能驗，輪替時把新的放前面）。production 必填。 */
  OIDC_COOKIE_KEYS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .optional()
      .transform((value) =>
        value
          ?.split(',')
          .map((key) => key.trim())
          .filter(Boolean),
      ),
  ),

  /**
   * 加密外部 IdP client secret 的主金鑰（32 bytes，base64 或 base64url；ADR-0019 D11）。
   * 沒設定時（僅開發）由 `JWT_SECRET` 推導一把固定金鑰；**production 必填**。換金鑰要先以舊金鑰解開、再以新金鑰重新存入。
   */
  IDP_SECRET_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),

  /** 清除過期 IdP 狀態（`oidc_payloads`）的 cron（UTC）；空字串停用。 */
  OIDC_CLEANUP_CRON: z.string().trim().default('45 3 * * *'),

  /** 稽核日誌熱 → 冷搬移的 cron（UTC）；空字串停用（docs/architecture/backend/06-audit-log.md §8）。 */
  AUDIT_LOG_ARCHIVE_CRON: z.string().trim().default('30 3 * * *'),

  SUPER_ADMIN_EMAIL: z.string().email(),
  // 留空 = 未設定：seed 時隨機產生並印出一次（docs/rbac/05-seed-and-bootstrap.md）。
  SUPER_ADMIN_PASSWORD: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(12).optional(),
  ),
});

/** production 不接受開發用的預設值：沒有金鑰就不能簽 ID token 與 IdP cookie。 */
const ProductionEnvSchema = EnvSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  if (!env.OIDC_JWKS) {
    ctx.addIssue({ code: 'custom', path: ['OIDC_JWKS'], message: 'production 必須設定簽章金鑰' });
  }
  if (!env.OIDC_COOKIE_KEYS?.length) {
    ctx.addIssue({ code: 'custom', path: ['OIDC_COOKIE_KEYS'], message: 'production 必須設定' });
  }
  if (!env.IDP_SECRET_KEY) {
    ctx.addIssue({ code: 'custom', path: ['IDP_SECRET_KEY'], message: 'production 必須設定' });
  }
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
  const parsed = ProductionEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`環境變數驗證失敗：\n${issues}`);
  }
  return parsed.data;
}
