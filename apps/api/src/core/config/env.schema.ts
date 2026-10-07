import { z } from 'zod';

import { MIN_SIGNING_KEY_BYTES, parseSigningKeys } from '../crypto/signing-keys';
import { isCidrList } from '../rate-limit/ip';

/** `FILE_STORAGE_PUBLIC_ENDPOINT` 裡代表「目前租戶的 origin」的佔位符。 */
export const TENANT_ORIGIN_PLACEHOLDER = '{tenantOrigin}';
/** `FILE_STORAGE_DOWNLOAD_ENDPOINT` 裡代表「目前租戶的代碼」的佔位符（每個租戶一個檔案子網域時用）。 */
export const TENANT_CODE_PLACEHOLDER = '{tenantCode}';

/**
 * 環境變數是啟動的前置條件：缺少或格式錯誤一律在 bootstrap 階段失敗，
 * 不容許執行到一半才發現（見 docs/architecture/backend/01-architecture.md §6）。
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * 這個程序是內部 api 還是對外 API（`main.external.ts` 在讀取任何設定之前固定成 `external`）。
   * production 要求哪些金鑰依它決定：對外 API 不載入 OIDC Provider、外部 IdP 的登入，也不投遞 webhook，
   * 不持有那些金鑰（docs/architecture/06-external-api.md §6）。
   */
  API_SURFACE: z.enum(['internal', 'external']).default('internal'),
  PORT: z.coerce.number().int().default(3000),
  /**
   * 監聽的位址（`listenHostOf()`）。沒設定時 production 聽所有介面（nginx 從另一個容器連進來），
   * 其他環境只聽 `127.0.0.1`：同一個網段的人連不到開發機的 api。要從其他機器連（例：手機測試）時設 `0.0.0.0`。
   */
  LISTEN_HOST: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  /**
   * 對外 API 的程序（`main.external.ts`）監聽的 port（docs/architecture/06-external-api.md §9.2 D9）。
   * 同一份 env 給兩個程序用，所以另開一個變數，不沿用 `PORT`。
   */
  EXTERNAL_API_PORT: z.coerce.number().int().default(3001),
  /**
   * Prometheus 抓 `/metrics` 的 port（docs/architecture/08-monitoring.md §2.1）：另開一個 HTTP server，不經過 Nest 的路由、
   * 租戶解析與限流，也不在 nginx 轉發的範圍。0 = 不開。對外 API 的程序用 `EXTERNAL_METRICS_PORT`（同 `EXTERNAL_API_PORT`）。
   */
  METRICS_PORT: z.coerce.number().int().min(0).max(65_535).default(9464),
  EXTERNAL_METRICS_PORT: z.coerce.number().int().min(0).max(65_535).default(9465),
  /**
   * 就緒檢查的 event loop 延遲門檻（毫秒；docs/architecture/08-monitoring.md §4）：最近一段時間的 p99 超過它時
   * `/health/ready` 回 `degraded`。0 = 不檢查。
   */
  HEALTH_EVENT_LOOP_LAG_MS: z.coerce.number().int().min(0).default(1000),
  /**
   * OpenTelemetry 的 trace 收件位址（OTLP/HTTP，例 `http://tempo:4318`；docs/architecture/08-monitoring.md §3）。
   * 沒設定 = 不載入 tracing。SDK 在 `src/instrumentation.ts` 讀 `process.env`（要早於任何 import），這裡只做格式驗證。
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  /** trace 的取樣率（0～1）；上游已帶取樣決定時沿用上游的（parent-based）。 */
  OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(1),
  /**
   * 平台 DB：租戶登記、IdP 的協定狀態、背景工作佇列（docs/architecture/05-tenancy.md §10.2 D1）。
   * 租戶 DB 的連線字串存在平台 DB 的 `tenants`，不在環境變數。
   */
  PLATFORM_DATABASE_URL: z.string().url(),
  /**
   * 加密租戶連線字串的主金鑰（32 bytes，base64；D4）。沒設定時（僅開發）由 `JWT_SECRET` 推導；
   * **production 必填**。seed 與 migration 腳本用同一把，換金鑰要重新加密每個租戶的連線字串。
   */
  TENANT_SECRET_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),
  /**
   * 每個租戶的連線池上限（D3）。連線預算：平台池 ＋ pg-boss（4）＋ 活躍租戶數 × 這個值（× api 程序數）
   * 要小於 postgres 的 `max_connections`（docs/architecture/backend/02-database.md §6.2）。
   */
  TENANT_POOL_MAX: z.coerce.number().int().min(1).default(10),
  /** 租戶連線池的閒置連線幾秒後關閉：沒人用的租戶不佔連線（要比 outbox 清掃的間隔短）。 */
  TENANT_POOL_IDLE_TIMEOUT: z.coerce.number().int().min(1).default(30),
  /** 平台 DB 的連線池上限；沒設定時 production 10、其他環境 3。 */
  PLATFORM_POOL_MAX: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().min(1).optional(),
  ),
  /** 建立 DB 連線的逾時（秒）。 */
  DB_CONNECT_TIMEOUT: z.coerce.number().int().min(1).default(10),
  /** 單一 SQL 語句的上限（毫秒；每條連線的 `statement_timeout`）；0 = 不限制。 */
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(15_000),
  /** 交易開著卻閒置的上限（毫秒；`idle_in_transaction_session_timeout`）；0 = 不限制。 */
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
  /** 網域 → 租戶的快取秒數。 */
  TENANT_CACHE_TTL: z.coerce.number().int().min(0).default(30),
  /**
   * 佈建租戶用的連線（D4、D12）：要有 `CREATEDB` 與 `CREATEROLE`，只在佈建時使用。新租戶的 database 與 DB 角色建在
   * 同一台伺服器上。沒設定時用 `PLATFORM_DATABASE_URL`（開發環境的帳號通常就是超級使用者）。
   */
  TENANT_PROVISIONING_DATABASE_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  /**
   * 新租戶預設網域的上層（D24）：租戶 `acme` 的網域是 `acme.<這個值>`。沒設定時取 `APP_PUBLIC_URL` 的 host
   * （開發環境是 `localhost:5173`，瀏覽器會把 `acme.localhost` 解析到本機）。
   */
  TENANT_BASE_DOMAIN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),

  /**
   * 舊的單一金鑰（docs/architecture/backend/04-auth.md §11）。開發環境必填：沒設定金鑰環與各種主金鑰時由它推導。
   * production 只用來驗證 **沒有 `kid`** 的舊 access token 與 v1 的縮圖網址（換成金鑰環的過渡期）；
   * 過渡期結束（`JWT_ACCESS_TTL` ＋ `FILE_URL_TTL` 之後）從環境拿掉，舊格式就一律被拒。
   */
  JWT_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
  /**
   * 租戶 access token 的金鑰環：`<kid>:<base64 金鑰>[,…]`，第一把簽發、全部都能驗證（HS256）。
   * 開發環境沒設定時由 `JWT_SECRET` 推導；**內部 api 的 production 必填**。對外 API 的程序不需要、也不該有。
   */
  JWT_SIGNING_KEYS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),
  /** 平台管理者 access token 的金鑰環（格式同 `JWT_SIGNING_KEYS`，必須是不同的金鑰）；**內部 api 的 production 必填**。 */
  PLATFORM_JWT_SIGNING_KEYS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),
  /**
   * 檔案縮圖網址的 HMAC 金鑰（32 bytes 以上，base64；docs/architecture/backend/09-file.md §5.4）。
   * 對外 API 的程序簽、內部 api 驗，所以兩個程序都要有；開發環境沒設定時由 `JWT_SECRET` 推導，**production 必填**。
   */
  FILE_URL_SIGNING_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),
  JWT_ACCESS_TTL: z.coerce.number().int().default(300),
  REFRESH_TOKEN_TTL: z.coerce.number().int().default(604800),
  /**
   * session 的絕對壽命（秒）：從登入起算，不論期間續期了幾次，超過就要重新登入（docs/architecture/backend/04-auth.md §2.6）。
   * 預設 30 天。
   */
  REFRESH_FAMILY_MAX_AGE: z.coerce.number().int().positive().default(2_592_000),
  /**
   * 重送寬限期（秒）：剛被用掉的 refresh token 在這段時間內再出示、而且它是家族的上一張，視為回應遺失而換發，
   * 不撤銷家族（04-auth.md §2.3）。0 停用。
   */
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
  REFRESH_COOKIE_NAME: z.string().default('refresh_token'),
  /**
   * Cookie 的 Path 必須是「瀏覽器看到的」refresh 端點前綴。
   * 前端一律打 `/api/*`（dev 由 Vite proxy、prod 由反向代理去掉前綴），
   * 因此這裡是 `/api/auth` 而不是 `/auth`。
   */
  REFRESH_COOKIE_PATH: z.string().default('/api/auth'),
  /** 平台管理者的 refresh cookie（apps/platform 的 origin，`/platform/auth/*`；docs/architecture/05-tenancy.md §10.2 D5）。 */
  PLATFORM_REFRESH_COOKIE_PATH: z.string().default('/api/platform/auth'),
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
  /**
   * argon2 同時執行的上限（每程序；docs/architecture/backend/04-auth.md §4.1）。4 個並行約佔 76 MiB，
   * 留下 threadpool（`UV_THREADPOOL_SIZE`）的其餘執行緒給 sharp、DNS、檔案 I/O。
   */
  ARGON2_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  /** 等待 argon2 名額的上限；超過立刻回 `503 AUTH_BUSY`。 */
  ARGON2_MAX_QUEUE: z.coerce.number().int().min(0).default(32),
  /** 等待 argon2 名額的逾時（毫秒）；超過回 `503 AUTH_BUSY`。 */
  ARGON2_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(1).default(3000),

  PERMISSION_CACHE_TTL: z.coerce.number().int().default(60),
  /**
   * 平台管理者的登入鎖定。租戶使用者改讀系統設定 `auth.loginMaxAttempts` / `auth.loginLockoutSeconds`
   * （docs/architecture/backend/12-settings.md §3）。
   */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().default(5),
  // 速率限制（次 / 分；docs/architecture/backend/03-api-conventions.md §8）。已登入的請求以使用者計，
  // 未登入以 IP 計；預設值按「1000 人共用一個 NAT 出口 IP」估算。E2E 會把 AUTH_RATE_LIMIT 調高。
  /** 每個已登入的使用者（所有端點合計）。 */
  DEFAULT_RATE_LIMIT: z.coerce.number().int().min(1).default(600),
  /** 每個 IP 的未登入請求（所有端點合計）。 */
  ANONYMOUS_RATE_LIMIT: z.coerce.number().int().min(1).default(3000),
  /** 對外 API：每把 API token 每分鐘（D13）。每個整合有自己的額度，不和本人的瀏覽器共用。 */
  EXTERNAL_RATE_LIMIT: z.coerce.number().int().min(1).default(600),
  /** 對外 API：每個 IP 每分鐘 **驗證失敗** 的次數；超過時之後的失敗回 429（猜 token、設定錯的腳本）。 */
  EXTERNAL_AUTH_FAILURE_RATE_LIMIT: z.coerce.number().int().min(1).default(30),
  /** 登入類端點：每個「帳號 ＋ IP」。忘記密碼、註冊是它的 1/3（至少 3）。 */
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  /** 登入類端點：每個 IP（整間公司的早上登入尖峰）。忘記密碼、註冊是它的 1/10。 */
  AUTH_IP_RATE_LIMIT: z.coerce.number().int().min(1).default(300),
  /**
   * 登入類端點：每個租戶（與平台的登入各自一個桶）每分鐘合計。一個租戶被攻擊時不拖垮其他租戶的登入；
   * 1200 足以應付 1000 人的公司集中在上班時間登入。平台可以對個別租戶以 feature 參數 `rateLimit.authPerMinute` 覆寫。
   */
  AUTH_TENANT_RATE_LIMIT: z.coerce.number().int().min(1).default(1200),
  /**
   * 豁免以 IP 計的限流的網段（逗號分隔的 IP 或 CIDR）：只給監控探針、內部服務。帳號、身分、租戶層級的限制照常；
   * 企業 NAT 的放寬改用租戶的 feature 參數 `rateLimit.trustedCidrs`（docs/architecture/backend/03-api-conventions.md §8）。
   */
  RATE_LIMIT_EXEMPT_CIDRS: z
    .string()
    .trim()
    .default('')
    .refine((value) => isCidrList(value), '逗號分隔的 IP 或 CIDR'),
  /** `/auth/refresh`：每個 refresh session。 */
  REFRESH_RATE_LIMIT: z.coerce.number().int().min(1).default(30),
  /** `/auth/refresh`：每個 IP（1000 人每 5 分鐘續期一次 ≈ 200 次 / 分，重啟後會集中）。 */
  REFRESH_IP_RATE_LIMIT: z.coerce.number().int().min(1).default(2000),
  /** WebSocket handshake：每個 IP（重新部署後整間公司同時重連）。 */
  REALTIME_HANDSHAKES_PER_IP: z.coerce.number().int().min(1).default(1200),
  /** WebSocket：每個使用者同時的連線數（所有裝置、所有分頁）。 */
  REALTIME_CONNECTIONS_PER_USER: z.coerce.number().int().min(1).default(20),
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
  /**
   * 可以含 `{tenantOrigin}`：換成目前租戶主要網域的 origin（協定沿用 `APP_PUBLIC_URL`）。每個租戶的 backstage 在自己的網域，
   * 瀏覽器只能直傳到同源的 `/storage`（CSP 的 `connect-src 'self'`；docs/architecture/05-tenancy.md §10.2 D2）。
   * 用真正的 S3 或 CDN 時填固定的網址。
   */
  FILE_STORAGE_PUBLIC_ENDPOINT: z
    .string()
    .default('{tenantOrigin}/storage')
    .refine(
      (value) => URL.canParse(value.replace(TENANT_ORIGIN_PLACEHOLDER, 'http://tenant.test')),
      'url',
    ),
  /**
   * 下載與預覽的 presigned 網址用的 endpoint（docs/architecture/backend/09-file.md §3.2）：獨立、不帶 cookie 的檔案網域，
   * 使用者上傳的內容就不會在租戶網域上被渲染。上傳仍用 `FILE_STORAGE_PUBLIC_ENDPOINT`（同源）。
   * 可以含 `{tenantOrigin}`、`{tenantCode}`（每個租戶一個子網域：`https://{tenantCode}.files.example.com/storage`）。
   * 留空 = 與 `FILE_STORAGE_PUBLIC_ENDPOINT` 相同（同源；production 啟動時記一次警告）。
   */
  FILE_STORAGE_DOWNLOAD_ENDPOINT: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .refine(
        (value) =>
          URL.canParse(
            value
              .replace(TENANT_ORIGIN_PLACEHOLDER, 'http://tenant.test')
              .replace(TENANT_CODE_PLACEHOLDER, 'tenant'),
          ),
        'url',
      )
      .optional(),
  ),
  FILE_STORAGE_REGION: z.string().min(1).default('us-east-1'),
  FILE_STORAGE_ACCESS_KEY_ID: z.string().min(3),
  FILE_STORAGE_SECRET_ACCESS_KEY: z.string().min(8),
  /**
   * 單一檔案上限（位元組）：這次部署允許的上限，也是系統設定 `file.uploadMaxSize` 的預設值；
   * 租戶只能在這以內調小（docs/architecture/backend/12-settings.md §2）。
   */
  FILE_UPLOAD_MAX_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024),
  /**
   * presigned 上傳 / 下載網址與影像網址的有效秒數。網址發出後到期前都有效，資料夾授權撤銷、帳號停用也收不回來，
   * 所以上限是 1 小時：撤銷的延遲不超過這個值（docs/architecture/iam/06-resource-grants.md §9）。
   */
  FILE_URL_TTL: z.coerce.number().int().min(60).max(3600).default(900),
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
   * 是否開放 `POST /auth/login`（以 email ＋ 密碼直接換 access token，保留給測試與腳本）。留空時 production 關閉、
   * 其他環境開啟；腳本改用 API token（docs/architecture/06-external-api.md §9.2 D15）。
   */
  DIRECT_LOGIN_ENABLED: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
  ),

  /**
   * 這個程序是否執行背景工作（worker ＋ 排程）。`false` 時仍可入列，由另一個以同一映像、
   * 設為 `true` 的容器執行（docs/architecture/backend/10-jobs.md §9.2 D4、D5）。
   */
  JOBS_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /**
   * 清掃租戶 outbox 的 cron（UTC）：交易提交後會立刻搬進佇列，這裡只補救搬移途中程序當掉的情況
   * （docs/architecture/05-tenancy.md §10.2 D15）。它會進入每個 active 租戶：間隔要比
   * `TENANT_POOL_IDLE_TIMEOUT` 長得多，閒置租戶的連線池才會真的關掉。空字串停用。
   */
  JOBS_OUTBOX_SWEEP_CRON: z.string().trim().default('*/10 * * * *'),
  /**
   * 郵件寄送方式（docs/architecture/backend/11-mail.md）：`smtp` 經 nodemailer 寄出（本機寄給 Mailpit）；
   * `console` 只寫日誌（含連結），給測試與沒有收信工具的環境用。
   */
  MAIL_TRANSPORT: z.enum(['smtp', 'console']).default('console'),
  /** SMTP 連線網址，例：`smtp://localhost:1025`、`smtps://user:pass@smtp.example.com:465`。 */
  MAIL_SMTP_URL: z.string().default('smtp://localhost:1025'),
  /** SMTP 連線池的連線數（同時寄出的信；docs/architecture/backend/11-mail.md §2）。 */
  MAIL_SMTP_POOL_SIZE: z.coerce.number().int().min(1).default(5),
  MAIL_FROM: z.string().min(3).default('B2B System <no-reply@localhost>'),
  /** 瀏覽器看到的前端網址；信裡的連結（啟用、重設密碼）以它開頭。 */
  APP_PUBLIC_URL: z
    .string()
    .url()
    .default('http://localhost:5173')
    .transform((value) => value.replace(/\/+$/, '')),

  // ── SSO：apps/api 當 OIDC Provider（docs/architecture/04-sso.md §12）──────────
  /** apps/platform 的網址（瀏覽器看到的）：登入互動頁與第一方 client `auth` 的 redirect URI 以它開頭。 */
  PLATFORM_APP_URL: z
    .string()
    .url()
    .default('http://localhost:5175')
    .transform((value) => value.replace(/\/+$/, '')),
  /** OIDC issuer：apps/platform origin 底下的 `/api/oidc`（反向代理去掉 `/api` 後由本程序的 `/oidc` 處理）。 */
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
   * 加密外部 IdP client secret 的主金鑰（32 bytes，base64 或 base64url；docs/architecture/04-sso.md §12.2 D11）。
   * 沒設定時（僅開發）由 `JWT_SECRET` 推導一把固定金鑰；**production 必填**。換金鑰要先以舊金鑰解開、再以新金鑰重新存入。
   */
  IDP_SECRET_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),

  /**
   * 加密 webhook 簽章密鑰的主金鑰（32 bytes，base64；docs/architecture/backend/17-webhook.md §9.2 D14）。
   * 沒設定時（僅開發）由 `JWT_SECRET` 推導；**production 必填**。換金鑰要先以舊金鑰解開、再以新金鑰重新存入。
   */
  WEBHOOK_SECRET_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),

  /** webhook 事件與投遞紀錄保留清理的 cron（UTC）；空字串停用（docs/architecture/backend/17-webhook.md §9.2 D16）。 */
  WEBHOOK_CLEANUP_CRON: z.string().trim().default('15 5 * * *'),

  /**
   * 公告的每日維護 cron（UTC）：補排程（遺失的延遲工作、改了時區後重算週期）與發送紀錄的保留清理；
   * 空字串停用（docs/architecture/backend/19-announcement.md §9.2 D10、D19）。
   */
  ANNOUNCEMENT_MAINTENANCE_CRON: z.string().trim().default('20 5 * * *'),

  /** 清除過期 IdP 狀態（`oidc_payloads`）的 cron（UTC）；空字串停用。 */
  OIDC_CLEANUP_CRON: z.string().trim().default('45 3 * * *'),

  /** 清除過期的 refresh token 與啟用／重設 token 的 cron（UTC）；空字串停用（docs/architecture/backend/04-auth.md §8）。 */
  AUTH_TOKEN_CLEANUP_CRON: z.string().trim().default('15 4 * * *'),
  /** 過期（或用過）的 token 保留幾天才刪除：留給安全事件調查（04-auth.md §8）。 */
  AUTH_TOKEN_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),

  /** 稽核日誌熱 → 冷搬移的 cron（UTC）；空字串停用（docs/architecture/backend/06-audit-log.md §8）。 */
  AUDIT_LOG_ARCHIVE_CRON: z.string().trim().default('30 3 * * *'),

  /** 回收桶到期永久刪除的 cron（UTC）；空字串停用。保留天數是系統設定 `trash.retentionDays`（docs/architecture/backend/13-trash.md §5）。 */
  TRASH_PURGE_CRON: z.string().trim().default('30 4 * * *'),

  /** 版本歷史保留清理的 cron（UTC）；空字串停用。保留條件是系統設定 `revision.keepVersions`、`revision.keepDays`（docs/architecture/backend/14-revisions.md §5）。 */
  REVISION_PRUNE_CRON: z.string().trim().default('45 4 * * *'),

  /** 站內通知保留清理的 cron（UTC）；空字串停用。保留條件是系統設定 `notification.retentionDays`、`notification.maxPerUser`（docs/architecture/backend/15-notification.md §6）。 */
  NOTIFICATION_CLEANUP_CRON: z.string().trim().default('0 5 * * *'),

  /**
   * 第一位平台管理者（apps/platform 的租戶管理）：`db:seed` 在平台 DB 沒有任何管理者時建立。
   * 密碼留空 = seed 時隨機產生並印出一次。
   */
  PLATFORM_ADMIN_EMAIL: z.string().email().optional(),
  PLATFORM_ADMIN_PASSWORD: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(12).optional(),
  ),

  SUPER_ADMIN_EMAIL: z.string().email(),
  // 留空 = 未設定：seed 時隨機產生並印出一次（docs/architecture/iam/05-bootstrap.md）。
  SUPER_ADMIN_PASSWORD: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(12).optional(),
  ),
});

/**
 * `.env.example` 與文件裡出現過的範例值：複製範例檔直接上線時，任何人都能用公開的值偽造 token
 * 或讀寫物件儲存。
 */
const EXAMPLE_SECRETS: ReadonlySet<string> = new Set([
  'change-me-in-production',
  'change-me-in-production-min-32-chars',
  'test-secret-that-is-long-enough-32ch',
  'b2b-system-dev',
  'b2b-system-dev-secret',
]);

/** 看起來不是隨機產生的金鑰：範例值、含 change-me、或不同的字元太少（例：32 個 a）。 */
export function isWeakSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    EXAMPLE_SECRETS.has(normalized) ||
    normalized.includes('change-me') ||
    normalized.includes('changeme') ||
    new Set(normalized).size < 10
  );
}

const WEAK_SECRET_MESSAGE =
  'production 不能用範例值或低熵的字串（請以 openssl rand -base64 48 之類產生）';

/**
 * SecretBox 的主金鑰（`core/crypto/secret-box.ts`）：base64 解開要是 32 bytes，而且不同的位元組夠多。
 * 隨機的 32 bytes 平均有 30 個不同的值；少於 16 個幾乎只會是手填的值（例：32 個 0x00）。
 */
function secretKeyProblem(value: string): string | undefined {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) return '必須是 32 bytes 的 base64（openssl rand -base64 32）';
  if (new Set(key).size < 16) {
    return '看起來不是隨機產生的（不同的位元組太少）；請以 openssl rand -base64 32 產生';
  }
  return undefined;
}

/** `OIDC_JWKS` 在啟動時就檢查形狀，不等到 oidc-provider 載入金鑰才失敗。 */
function jwksProblem(raw: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return '不是合法的 JSON';
  }
  const keys =
    typeof parsed === 'object' && parsed !== null ? (parsed as { keys?: unknown }).keys : undefined;
  if (!Array.isArray(keys)) return '必須是 {"keys":[…]} 形狀的 JWKS';
  const hasPrivateKey = keys.some(
    (key: unknown) =>
      typeof key === 'object' && key !== null && typeof (key as { d?: unknown }).d === 'string',
  );
  return hasPrivateKey ? undefined : '至少要有一把含私鑰（`d`）的金鑰，才能簽 ID token';
}

/** 瀏覽器在別台電腦上連不到的主機：production 的公開網址不能是它。 */
function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.startsWith('127.')
  );
}

/** 瀏覽器看到的網址：信件連結、presigned 網址、OIDC 的 redirect 都以它們開頭（production 的 redirect URI 只接受 https）。 */
const PUBLIC_URL_KEYS = ['APP_PUBLIC_URL', 'PLATFORM_APP_URL', 'OIDC_ISSUER'] as const;

/** production 不接受開發用的預設值：範例或低熵的金鑰、本機的公開網址、`console` 寄信。 */
const ProductionEnvSchema = EnvSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') {
    // 開發與測試：金鑰環、縮圖網址與各種主金鑰沒設定時都由它推導
    if (!env.JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: '開發環境必須設定（至少 32 字元）',
      });
    }
    for (const key of ['JWT_SIGNING_KEYS', 'PLATFORM_JWT_SIGNING_KEYS'] as const) {
      const value = env[key];
      const parsed = value ? parseSigningKeys(value) : undefined;
      if (typeof parsed === 'string')
        ctx.addIssue({ code: 'custom', path: [key], message: parsed });
    }
    return;
  }
  const issue = (key: keyof Env, message: string) =>
    ctx.addIssue({ code: 'custom', path: [key], message });
  // 對外 API 的程序不簽 ID token、不碰外部 IdP 與 webhook 的密鑰：不要求這些金鑰，給了才檢查（06-external-api.md §6）
  const internal = env.API_SURFACE === 'internal';

  if (env.JWT_SECRET !== undefined && isWeakSecret(env.JWT_SECRET)) {
    issue('JWT_SECRET', WEAK_SECRET_MESSAGE);
  }
  if (isWeakSecret(env.FILE_STORAGE_SECRET_ACCESS_KEY)) {
    issue('FILE_STORAGE_SECRET_ACCESS_KEY', WEAK_SECRET_MESSAGE);
  }
  // access token 的金鑰環只給內部 api：對外 API 的程序拿到金鑰環就能簽出任何人的 token（06-external-api.md §6）
  for (const key of ['JWT_SIGNING_KEYS', 'PLATFORM_JWT_SIGNING_KEYS'] as const) {
    const value = env[key];
    if (!internal) {
      if (value) issue(key, '對外 API 的程序不能持有 access token 的金鑰');
      continue;
    }
    const parsed = value ? parseSigningKeys(value) : 'production 必須設定';
    if (typeof parsed === 'string') issue(key, parsed);
  }
  if (env.JWT_SIGNING_KEYS && env.PLATFORM_JWT_SIGNING_KEYS) {
    const tenant = parseSigningKeys(env.JWT_SIGNING_KEYS);
    const platform = parseSigningKeys(env.PLATFORM_JWT_SIGNING_KEYS);
    if (typeof tenant !== 'string' && typeof platform !== 'string') {
      const tenantKeys = new Set([...tenant.byKid.values()].map((key) => key.toString('base64')));
      if ([...platform.byKid.values()].some((key) => tenantKeys.has(key.toString('base64')))) {
        issue('PLATFORM_JWT_SIGNING_KEYS', '不能與 JWT_SIGNING_KEYS 共用金鑰');
      }
    }
  }
  const fileUrlProblem = env.FILE_URL_SIGNING_KEY
    ? Buffer.from(env.FILE_URL_SIGNING_KEY, 'base64').length < MIN_SIGNING_KEY_BYTES
      ? `解開後至少要 ${MIN_SIGNING_KEY_BYTES} bytes（openssl rand -base64 48）`
      : undefined
    : 'production 必須設定';
  if (fileUrlProblem) issue('FILE_URL_SIGNING_KEY', fileUrlProblem);
  // access key id 不是祕密（常是短的識別字），只擋範例值
  if (EXAMPLE_SECRETS.has(env.FILE_STORAGE_ACCESS_KEY_ID)) {
    issue('FILE_STORAGE_ACCESS_KEY_ID', WEAK_SECRET_MESSAGE);
  }
  if (env.MAIL_TRANSPORT !== 'smtp') {
    // console 會把能登入的啟用／重設連結寫進日誌
    issue('MAIL_TRANSPORT', 'production 必須是 smtp');
  }

  const secretKeys = [
    ['TENANT_SECRET_KEY', true],
    ['IDP_SECRET_KEY', internal],
    ['WEBHOOK_SECRET_KEY', internal],
  ] as const;
  for (const [key, required] of secretKeys) {
    const value = env[key];
    const problem = value ? secretKeyProblem(value) : required ? 'production 必須設定' : undefined;
    if (problem) issue(key, problem);
  }

  if (env.OIDC_JWKS) {
    const problem = jwksProblem(env.OIDC_JWKS);
    if (problem) issue('OIDC_JWKS', problem);
  } else if (internal) {
    issue('OIDC_JWKS', 'production 必須設定簽章金鑰');
  }
  if (env.OIDC_COOKIE_KEYS?.length) {
    if (env.OIDC_COOKIE_KEYS.some((key) => key.length < 32 || isWeakSecret(key))) {
      issue('OIDC_COOKIE_KEYS', '每一把都要是至少 32 字元的隨機值（openssl rand -base64 32）');
    }
  } else if (internal) {
    issue('OIDC_COOKIE_KEYS', 'production 必須設定');
  }

  for (const key of PUBLIC_URL_KEYS) {
    const url = new URL(env[key]);
    if (url.protocol !== 'https:' || isLocalHost(url.hostname)) {
      issue(key, 'production 必須是瀏覽器看到的 https 網址，不能是 localhost');
    }
  }
  if (new URL(env.OIDC_ISSUER).origin !== new URL(env.PLATFORM_APP_URL).origin) {
    issue(
      'OIDC_ISSUER',
      '必須在 PLATFORM_APP_URL 的 origin 底下（例：<PLATFORM_APP_URL>/api/oidc）',
    );
  }
});

export type Env = z.infer<typeof EnvSchema>;

/** `app.listen()` 的位址：`undefined` 是 Node 的預設（所有介面）。 */
export function listenHostOf(env: Pick<Env, 'NODE_ENV' | 'LISTEN_HOST'>): string | undefined {
  return env.LISTEN_HOST ?? (env.NODE_ENV === 'production' ? undefined : '127.0.0.1');
}

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
