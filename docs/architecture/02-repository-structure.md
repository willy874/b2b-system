# Repository 結構

## 1. Monorepo 佈局

```
b2b-system/
├── package.json                 root scripts、devDependencies
├── pnpm-workspace.yaml
├── tsconfig.base.json           共用 compilerOptions 與 path alias 基準
├── docker-compose.yml           postgres、Mailpit（本機開發）；monitoring profile 是本機的監控（08-monitoring.md §7）
├── docker-compose.prod.yml      正式部署（01-system.md §4.2）
├── docker-compose.monitoring.yml 監控：疊在正式部署上的 Prometheus、Tempo、Grafana、postgres-exporter（08-monitoring.md §6）
├── deploy/                      nginx 設定、postgres 的初始化腳本、prod.env.example；monitoring/ 是 Prometheus、Tempo、Grafana 的設定與儀表板
├── lefthook.yml                 git hooks
├── .oxlintrc.json / .oxfmtrc.jsonc
├── .env.example
│
├── apps/
│   ├── backstage/               @b2b-system/backstage — React 前端（RBAC 管理後台）
│   ├── auth/                    @b2b-system/platform — 全平台共用的身分與租戶入口（React，[`architecture/04-sso.md`](04-sso.md) §12；見該目錄的 README）
│   ├── api/                     @b2b-system/api — NestJS 後端
│   ├── file-storage/            @b2b-system/file-storage — S3 相容的本機檔案儲存（見 03-file-storage.md）
│   ├── apm-service/             @b2b-system/apm-service — 模擬 Sentry API 的前端錯誤收件（見 07-apm-service.md）
│   └── e2e/                     @b2b-system/e2e — Playwright
│
├── packages/
│   ├── api-sdk/                 @b2b-system/api-sdk — 由 OpenAPI 產生：主入口是型別與 URL builder（零 zod），`/schemas` 是 zod schema 與 fetch client
│   ├── realtime/                @b2b-system/realtime — Socket.io 事件合約（事件名稱、zod schema、型別）
│   ├── error-codes/             @b2b-system/error-codes — ErrorCode 清單與 → HTTP status 對照（api 與前端共用；需 build）
│   ├── mail-components/         @b2b-system/mail-components — api 郵件範本用的 React Email 元件與 render（建置時打包，不帶 CLI 依賴；需 build）
│   ├── web-shared/              @b2b-system/web-shared — 前端的純工具：store、channel、context、registry、storage、date…（只有原始碼）
│   ├── ui/                      @b2b-system/ui — 設計系統元件、Design Token、圖示、共用的 UnoCSS 設定與 Storybook（只有原始碼）
│   └── web-core/                @b2b-system/web-core — 兩個前端共用的機制層：AppContext、session、client、快取、權限機制、i18n、外框、測試輔助（只有原始碼）
│
└── docs/                        本文件集
```

### 1.1 `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 1.2 root scripts

| script                                         | 作用                                                     |
| ---------------------------------------------- | -------------------------------------------------------- |
| `pnpm dev`                                     | `docker compose up -d postgres` ＋ Mailpit ＋ 並行啟動 api、backstage（:5173）、platform（:5175）、file-storage |
| `pnpm dev:api` / `pnpm dev:backstage` / `pnpm dev:platform` | 單獨啟動                                                 |
| `pnpm dev:e2e`                                 | 啟動 Mailpit，以放寬的速率限制、`MAIL_TRANSPORT=smtp` 啟動 api |
| `pnpm mail:up`                                 | `docker compose up -d mailpit`（SMTP :1025、網頁 :8025） |
| `pnpm monitoring:up` / `pnpm monitoring:down`  | 本機的監控：Prometheus（:9090）、Tempo（:4318）、postgres-exporter、Grafana（:3300）（[`08-monitoring.md`](./08-monitoring.md) §7） |
| `pnpm dev:storage`                             | 啟動 `apps/file-storage`（S3 相容，:9000）               |
| `pnpm dev:mock-idp`                            | 模擬的外部 IdP（:4455）；外部 IdP 登入的開發與 E2E 用（[`04-sso.md`](./04-sso.md) §10） |
| `pnpm build`                                   | 依序 `api-sdk` → `api` → `backstage` → `platform`                |
| `pnpm db:generate`                             | drizzle-kit 產生 migration                               |
| `pnpm db:migrate`                              | 套用 migration                                           |
| `pnpm db:seed`                                 | 灌入權限目錄與系統角色                                   |
| `pnpm db:studio`                               | drizzle-kit studio                                       |
| `pnpm sdk:generate`                            | 從 `apps/api/openapi.json` 產生 `packages/api-sdk/src/generated/` |
| `pnpm lint` / `pnpm format` / `pnpm typecheck` | 全 workspace                                             |
| `pnpm test`                                    | 全 workspace 單元測試                                    |
| `pnpm test:e2e`                                | Playwright                                               |
| `pnpm storybook` / `pnpm storybook:build`      | 設計系統元件的 Storybook（:6006）／輸出靜態站到 `packages/ui/storybook-static/` |

---

## 2. `apps/backstage` 內部結構

檔案佈局如下（各層職責見 [`frontend/01-architecture.md`](./frontend/01-architecture.md)）：

```
apps/backstage/src/
├── main.tsx                 AppContext plugin chain ＋ createRoot
├── index.css                只有 @import '@b2b-system/ui/styles.css'
│
├── app/                     App Shell（只組裝，不實作業務；providers 在 @b2b-system/web-core/shell）
│   ├── App.tsx              GlobalProvider ＋ SessionWatcher（web-core/shell）＋ 權限水合
│   ├── Layout.tsx           依 matcher 決定套哪個 layout
│   ├── plugin.ts            建立 router，掛到 AppContext；登記頂列工具、側欄的分類與命令面板
│   ├── features.ts          執行期啟用的 feature 清單
│   ├── routes.tsx           把各 feature 的 route 組成 route tree
│   ├── sessionRedirect.ts   不需要 session 的頁面（交給 web-core 的 SessionWatcher）
│   ├── layouts/
│   │   ├── DashboardLayout.tsx   把品牌與帳號選單的動作交給 web-core 的 DashboardShell（側欄、頂列、主內容、命令面板）
│   │   ├── headerTools.ts        頂列的內建工具
│   │   ├── LanguageMenu.tsx      把切換交給 web-core 的 LanguageMenu（同步到帳號）
│   │   └── index.ts
│   └── locales/{en_US,zh_TW}.json   這個 app 專屬的全域字串（共用的在 web-core）
│
├── core/                    app 的機制層（不認識任何 feature；共用的在 @b2b-system/web-core）
│   ├── components/          只有 backstage 用的元件（ApiToken、ExplainPath、Tag、VersionConflictAlert）
│   ├── feature/             執行期啟用 feature（docs/architecture/frontend/02-plugin-system.md §9）
│   ├── file/                檔案類型、預覽解析器／檔案驗證器／縮圖產生器的註冊表
│   ├── navigation/          側欄的分類（feature 的 navigation.ts 以它指定位置；docs/architecture/frontend/18-command-palette.md §2）
│   ├── permission/          ★ 這個 app 的權限目錄（enums、resources），登記給 web-core；轉出 web-core 的權限機制
│   ├── permission-graph/    權限依賴樹的閉包與畫布版面（docs/architecture/iam/02-permission-catalog.md §9）
│   └── trash/               回收桶的類型註冊表（docs/architecture/frontend/13-trash.md）
│
├── features/                ★ 業務功能，每個自給自足
│   ├── auth/
│   ├── user/
│   ├── role/
│   ├── permission/
│   ├── account/
│   ├── audit-log/
│   ├── approval/
│   ├── file/                檔案管理器（docs/architecture/frontend/12-file-manager.md）
│   ├── job/                 背景工作的管理頁（docs/architecture/backend/10-jobs.md §6）
│   ├── trash/               回收桶頁；各類型由擁有資源的 feature 登記（docs/architecture/frontend/13-trash.md）
│   ├── notification/        站內通知：頂列鈴鐺、列表頁（docs/architecture/frontend/15-notification.md）
│   └── home/
│
├── apis/                    與後端對話的唯一入口
│   ├── auth/
│   ├── user/
│   ├── role/
│   ├── permission/
│   ├── audit-log/
│   ├── approval/
│   ├── file/
│   ├── job/
│   ├── notification/
│   └── trash/
│
├── plugins/                 可插拔的能力（非業務、非核心）
│   ├── app/                 門面：轉出 @b2b-system/web-core/plugins/app，加上自己的 i18n（語系包）與 batch-queue
│   └── features/            擴充既有 feature 的小外掛（例如偏好頁的分頁）
│
├── shared/                  app 專屬的收斂點（其餘純工具在 @b2b-system/web-shared）
│   ├── api-sdk/             re-export packages/api-sdk（單一收斂點）
│   ├── websocket-sdk/       re-export packages/realtime（單一收斂點）
│   └── constants/           env（import.meta.env）
│
├── mocks/                   MSW handlers（dev 與測試共用）
└── test/                    setup.ts、i18n.ts（render 輔助在 @b2b-system/web-core/testing）
```

### 2.1 Path alias

`tsconfig.app.json`：

```json
{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
```

匯入一律用 `@/`，**禁止** `../../../`（超過一層）。

### 2.2 `apps/platform`

資料夾分層與上面相同（`main.tsx` → `app/` → `features/` → `apis/` → `core/` → `@b2b-system/web-core` → `@b2b-system/ui` → `@b2b-system/web-shared`）。
features 見 [`apps/platform/README.md`](../../apps/platform/README.md)；機制層、設計系統與純工具與 backstage 共用 `packages/web-core`、`packages/ui`、`packages/web-shared`
（[`architecture/04-sso.md`](04-sso.md) §12.2 D14），`core/` 只有平台的權限目錄。刻意各自一份的部分與同步規則見該 README，
路由與登入流程見 [`04-sso.md`](./04-sso.md) §6。

### 2.3 前端共用的 packages

`packages/web-shared`、`packages/ui` 與 `packages/web-core` 只有原始碼、不 build（`exports` 直接指向 `src/`），由各 app 自己的 Vite 編譯；
所以 CSS Module 的 class 前綴仍是各 app 自己的（backstage `ge-`、platform `ga-`）。`packages/error-codes` 與 `realtime` 一樣 build 到 `dist/`
（api 在 Node 執行時要用），新 clone 或改了它之後要 `pnpm build:packages`。各 package 的規則見各自的 README；
整體的分層、程式該放哪、app 怎麼接上 web-core 見 [`frontend/17-shared-packages.md`](./frontend/17-shared-packages.md)。

---

## 3. `apps/api` 內部結構

刻意與前端同構：`modules/` 對應 `features/`，`core/` 對應 `core/`。

```
apps/api/src/
├── main.ts                  bootstrap、Swagger、全域管線
├── instrumentation.ts       OpenTelemetry tracing；進入點第一個 import（08-monitoring.md §3）
├── app.module.ts            匯入 core 與所有 modules，註冊 APP_GUARD/FILTER/INTERCEPTOR
│
├── core/                    機制層（不認識任何 module）
│   ├── config/              @nestjs/config ＋ Zod 驗證 env
│   ├── database/            DrizzleModule、DB provider、交易輔助
│   ├── cache/               PermissionCacheService（in-memory + TTL + 明確失效，可整個租戶失效）
│   ├── authz/               關係圖權限引擎：模型、判斷器、relation_tuples、revision 失效（iam/01-model.md）
│   ├── broadcast/           程序之間的失效廣播：平台 DB 的 LISTEN／NOTIFY（docs/architecture/backend/05-rbac.md §5.1）
│   ├── errors/              ErrorCode enum、AppException、HttpExceptionFilter
│   ├── http/                TransformInterceptor、分頁 DTO、RequestId middleware
│   ├── logger/              Pino 設定
│   ├── metrics/             Prometheus 指標（prom-client）、給 Prometheus 的 /metrics server（08-monitoring.md §2）
│   ├── tracing/             手動 span（inSpan）、span 的租戶屬性、網址的遮蔽（08-monitoring.md §3）
│   ├── jobs/                背景工作佇列（pg-boss）：JobQueue、defineJob（docs/architecture/backend/10-jobs.md）
│   ├── mail/                寄信：MailTransport（smtp / console）、MailService（docs/architecture/backend/11-mail.md）
│   └── validation/          ZodValidationPipe、zod ↔ OpenAPI
│
├── common/                  跨模組的 decorator / guard（薄）
│   ├── decorators/          @Public @CurrentUser @RequirePermissions
│   ├── guards/              JwtAuthGuard、PermissionsGuard、ThrottlerGuard
│   └── types/
│
├── modules/                 ★ 業務模組
│   ├── auth/                登入、app session、SSO 的互動端點與 BFF、外部 IdP 登入（docs/architecture/04-sso.md）
│   ├── credential/          憑證的基礎設施：refresh／啟用／重設 token、密碼雜湊與政策、帳號連結信（葉節點）
│   ├── platform-admin/      平台管理者、平台端的帳號流程與 refresh token、平台稽核（平台 DB 的表都在這裡）
│   ├── tenant/              租戶的公開資訊、平台端的管理與佈建（docs/architecture/05-tenancy.md）
│   ├── oidc-provider/       oidc-provider 掛在 /oidc、oidc_payloads adapter
│   ├── identity-provider/   外部 IdP 連線、openid-client、帳號 ↔ 外部身分
│   ├── user/
│   ├── role/
│   ├── permission/
│   ├── audit-log/
│   ├── approval/
│   ├── file/                檔案轉介表、上傳流程、資料夾授權的讀寫與等級規則（docs/architecture/backend/09-file.md）
│   ├── job/                 背景工作的管理 API（docs/architecture/backend/10-jobs.md §6）
│   ├── trash/               回收桶：TrashRegistry、GET /trash、trash.purge（docs/architecture/backend/13-trash.md）
│   ├── revision/            版本歷史：RevisionService（寫入、讀取、保留清理）、revision.prune（docs/architecture/backend/14-revisions.md）
│   ├── notification/        站內通知：NotificationService.notify、GET /notifications、notification.cleanup（docs/architecture/backend/15-notification.md）
│   └── health/
│
└── db/
    ├── schema/              Drizzle 表定義（每張表一個檔 ＋ index.ts）
    ├── migrations/          drizzle-kit 產生，**進版控**
    ├── seeds/               permissions.ts / roles.ts / super-admin.ts
    └── relations.ts         Drizzle relations 宣告
```

### 3.1 一個 module 的標準檔案

以 `role` 為例：

```
modules/role/
├── role.module.ts
├── role.controller.ts       只做 HTTP ↔ DTO 轉換與 @RequirePermissions 宣告
├── role.service.ts          業務規則（系統角色保護、反提權、交易邊界）
├── role.repository.ts       只有 Drizzle 查詢，回傳 row 型別
├── dto/
│   ├── create-role.dto.ts   Zod schema ＋ z.infer 型別 ＋ OpenAPI 描述
│   ├── update-role.dto.ts
│   └── list-role.dto.ts
├── role.constants.ts        本模組的權限鍵常數、錯誤碼
└── __tests__/
    ├── role.service.spec.ts
    └── role.e2e-spec.ts
```

---

## 4. 命名與匯入慣例

已移到 [`coding-standards/01-general.md`](../coding-standards/01-general.md) §3–4。

---

## 5. 環境變數

`.env.example`（全文；改環境變數時兩邊一起改）：

```bash
# ── apps/api ─────────────────────────────────────────
# 資料庫（05-tenancy.md）：平台 DB 一個，每個租戶各一個 database
PLATFORM_DATABASE_URL=postgres://b2bsystem:b2bsystem@localhost:5432/b2b_platform   # 不存在時 db:migrate 會建立
TENANT_SECRET_KEY=                 # 加密租戶連線字串的金鑰（32 bytes base64）；留空 = 由 JWT_SECRET 推導（production 必填）
TENANT_POOL_MAX=10                 # 每個租戶的連線池上限（連線預算見 docs/architecture/backend/02-database.md §6.2）
TENANT_POOL_IDLE_TIMEOUT=30        # 租戶連線池的閒置連線幾秒後關閉
TENANT_CACHE_TTL=30                # 網域 → 租戶的快取秒數
PLATFORM_POOL_MAX=                 # 平台 DB 的連線池上限；留空 = production 10、其他 3
DB_CONNECT_TIMEOUT=10              # 建立連線的逾時（秒）
DB_STATEMENT_TIMEOUT_MS=15000      # 每條連線的 statement_timeout（毫秒）；0 = 不限制
DB_IDLE_IN_TRANSACTION_TIMEOUT_MS=30000   # 交易開著卻閒置的上限（毫秒）；0 = 不限制
# 佈建新租戶（apps/platform 的租戶管理）：要有 CREATEDB 與 CREATEROLE；留空 = 用 PLATFORM_DATABASE_URL
TENANT_PROVISIONING_DATABASE_URL=
# 新租戶的預設網域是 {code}.<這個值>；留空 = APP_PUBLIC_URL 的 host（開發：acme.localhost:5173）
TENANT_BASE_DOMAIN=
# 預設租戶：db:migrate 在平台 DB 登記它（還沒有租戶管理之前的唯一租戶；交付順序第 4 步起由 apps/platform 建立）
DEFAULT_TENANT_CODE=default
DEFAULT_TENANT_DATABASE_URL=postgres://b2bsystem:b2bsystem@localhost:5432/b2b_system
# 屬於預設租戶的網域（瀏覽器看到的 host，含 port）。apps/platform（:5175）不屬於任何租戶
DEFAULT_TENANT_DOMAINS=localhost:5173
# 預設租戶的物件儲存 bucket（每個租戶一個）；預設沿用租戶化之前共用的 b2b-system，既有檔案不必搬
DEFAULT_TENANT_STORAGE_BUCKET=b2b-system
# 第一位平台管理者（apps/platform 的登入；與租戶的帳號是兩份資料）：db:seed 在平台 DB 沒有管理者時建立
PLATFORM_ADMIN_EMAIL=platform@example.com
PLATFORM_ADMIN_PASSWORD=                      # 留空：開發時隨機產生並印出一次；production 建成 pending，只印一次性的設定連結
PORT=3000
EXTERNAL_API_PORT=3001             # 對外 API 的程序（pnpm dev:external-api；[`architecture/06-external-api.md`](06-external-api.md) §9.2 D9）
# 監控（docs/architecture/08-monitoring.md）：給 Prometheus 的 /metrics 另開一個 port（0 = 不開）；pnpm monitoring:up 起 Grafana（:3300）
METRICS_PORT=9464
EXTERNAL_METRICS_PORT=9465
HEALTH_EVENT_LOOP_LAG_MS=1000      # /health/ready 的 event loop 延遲門檻（毫秒，p99）；0 = 不檢查
OTEL_EXPORTER_OTLP_ENDPOINT=       # trace 送到哪裡（OTLP/HTTP）；留空 = 不送。本機 Tempo：http://localhost:4318
OTEL_TRACES_SAMPLER_ARG=1          # trace 的取樣率（0～1）
NODE_ENV=development
LISTEN_HOST=                       # 留空 = 開發只聽 127.0.0.1（同網段連不到）、production 聽所有介面；手機測試時設 0.0.0.0

JWT_SECRET=change-me-in-production-min-32-chars   # 開發必填：下面的金鑰環與各種主金鑰沒設時由它推導；production 只驗過渡期的舊 token（選填）
JWT_SIGNING_KEYS=                  # 租戶 access token 的金鑰環 <kid>:<base64>[,…]，第一把簽發；留空 = 由 JWT_SECRET 推導（production 必填）
PLATFORM_JWT_SIGNING_KEYS=         # 平台管理者 access token 的金鑰環（與上面不同的金鑰）；留空 = 由 JWT_SECRET 推導（production 必填）
FILE_URL_SIGNING_KEY=              # 縮圖網址的 HMAC 金鑰（base64，≥ 32 bytes）；留空 = 由 JWT_SECRET 推導（production 必填）
JWT_ACCESS_TTL=300                 # 秒
REFRESH_TOKEN_TTL=604800           # 秒（7 天）
REFRESH_FAMILY_MAX_AGE=2592000     # session 的絕對壽命（秒，30 天）：從登入起算，超過就要重新登入
REFRESH_REUSE_GRACE_SECONDS=30     # 剛用過的 refresh token 在這段時間內重送視為回應遺失、換發新的；0 停用
REFRESH_COOKIE_NAME=refresh_token
REFRESH_COOKIE_PATH=/api/auth    # 瀏覽器看到的前綴（前端一律打 /api/*）
PLATFORM_REFRESH_COOKIE_PATH=/api/platform/auth   # 平台管理者的 refresh cookie（apps/platform 的 origin）
API_PUBLIC_BASE_URL=/api         # 瀏覽器看到的 api 位址；影像 API 的網址以它開頭

ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2
ARGON2_MAX_CONCURRENCY=4           # argon2 同時執行的上限（每程序）
ARGON2_MAX_QUEUE=32                # 等待名額的上限；超過回 503 AUTH_BUSY
ARGON2_QUEUE_TIMEOUT_MS=3000       # 等待名額的逾時；超過回 503 AUTH_BUSY

PERMISSION_CACHE_TTL=60            # 秒
# 速率限制（次 / 分；docs/architecture/backend/03-api-conventions.md §8）：已登入以使用者計、未登入以 IP 計
DEFAULT_RATE_LIMIT=600             # 每個已登入的使用者（所有端點合計）
ANONYMOUS_RATE_LIMIT=3000          # 每個 IP 的未登入請求（1000 人共用一個 NAT 出口）
EXTERNAL_RATE_LIMIT=600            # 對外 API：每把 API token 每分鐘
EXTERNAL_AUTH_FAILURE_RATE_LIMIT=30  # 對外 API：每個 IP 每分鐘驗證失敗的次數，超過回 429
AUTH_RATE_LIMIT=10                 # 登入類端點：每個「帳號 ＋ IP」（E2E 需調高）；忘記密碼、註冊是 1/3
AUTH_IP_RATE_LIMIT=300             # 登入類端點：每個 IP；忘記密碼、註冊是 1/10
AUTH_TENANT_RATE_LIMIT=1200        # 登入類端點：每個租戶合計（平台的登入另一個桶）；租戶可由平台以 feature 參數覆寫
RATE_LIMIT_EXEMPT_CIDRS=           # 監控探針、內部服務的網段（逗號分隔的 CIDR）：豁免以 IP 計的限流，帳號層級的限制照常
REFRESH_RATE_LIMIT=30              # /auth/refresh：每個 refresh session
REFRESH_IP_RATE_LIMIT=2000         # /auth/refresh：每個 IP
REALTIME_HANDSHAKES_PER_IP=1200    # WebSocket handshake：每個 IP
REALTIME_CONNECTIONS_PER_USER=20   # WebSocket：每個使用者同時的連線數
TRUST_PROXY=false                  # 反向代理後面才設：跳數或子網路（例：uniquelocal）；限流依它判定客戶端 IP
LOGIN_MAX_ATTEMPTS=5               # 只用於平台管理者；租戶使用者的鎖定是系統設定 auth.loginMaxAttempts
LOGIN_LOCKOUT_SECONDS=900          # 同上（租戶：auth.loginLockoutSeconds）
DIRECT_LOGIN_ENABLED=              # POST /auth/login（email＋密碼直接換 token）；留空：production 關閉、其他開啟；腳本改用 API token（[`architecture/06-external-api.md`](06-external-api.md) §9.2 D15）

REALTIME_ALLOWED_ORIGINS=http://localhost:5173   # WebSocket handshake 允許的 Origin（逗號分隔）；同源（租戶自己的網域）一律允許

# 郵件（docs/architecture/backend/11-mail.md）：本機寄給 Mailpit（pnpm dev 會一起啟動），在 http://localhost:8025 看信
MAIL_TRANSPORT=smtp                # smtp：經 SMTP 寄出；console：只寫日誌（含連結），不寄出
MAIL_SMTP_URL=smtp://localhost:1025
MAIL_SMTP_POOL_SIZE=5              # SMTP 連線池的連線數（同時寄出的信）
MAIL_FROM="B2B System <no-reply@localhost>"
APP_PUBLIC_URL=http://localhost:5173   # 信裡連結的開頭（瀏覽器看到的前端網址）；也是第一方 client `backstage` 的 redirect URI 開頭

# ── SSO：apps/api 當 OIDC Provider（04-sso.md）
PLATFORM_APP_URL=http://localhost:5175            # apps/platform 的網址（登入互動頁）
OIDC_ISSUER=http://localhost:5175/api/oidc    # apps/platform origin 底下的 /api/oidc
OIDC_JWKS=                                    # 簽 ID token 的私鑰 JWKS JSON；留空 = 啟動時產生臨時金鑰（production 必填）
OIDC_COOKIE_KEYS=                             # 簽 IdP cookie 的金鑰，逗號分隔（production 必填）
OIDC_CLEANUP_CRON=45 3 * * *                  # 清除過期 IdP 狀態的 cron（UTC）；留空停用
AUTH_TOKEN_CLEANUP_CRON=15 4 * * *            # 清除過期 refresh token 與啟用／重設 token 的 cron（UTC）；留空停用
AUTH_TOKEN_RETENTION_DAYS=30                  # 過期或用過的 token 保留天數（安全事件調查用）
IDP_SECRET_KEY=                               # 加密外部 IdP client secret 的金鑰（32 bytes base64）；留空 = 由 JWT_SECRET 推導（production 必填）
WEBHOOK_SECRET_KEY=                           # 加密 webhook 簽章密鑰的金鑰（32 bytes base64）；留空 = 由 JWT_SECRET 推導（production 必填）
MFA_SECRET_KEY=                               # 加密 TOTP seed、Email 驗證碼 HMAC 的金鑰（32 bytes base64）；留空 = 由 JWT_SECRET 推導（production 必填；換金鑰 = 所有人重設 MFA）

SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_PASSWORD=              # 留空：開發時隨機產生並印出一次；production 建成 pending，只印一次性的啟用連結

JOBS_WORKER_ENABLED=true           # 這個程序是否執行背景工作與排程；false 只入列（docs/architecture/backend/10-jobs.md §5）
JOBS_OUTBOX_SWEEP_CRON=*/10 * * * *  # 補搬各租戶 job_outbox 的 cron（UTC）；間隔要遠大於 TENANT_POOL_IDLE_TIMEOUT；留空停用
AUDIT_LOG_ARCHIVE_CRON=30 3 * * *  # 稽核熱 → 冷搬移的 cron（UTC）；留空停用
TRASH_PURGE_CRON=30 4 * * *        # 回收桶到期永久刪除的 cron（UTC）；保留天數是系統設定 trash.retentionDays；留空停用
REVISION_PRUNE_CRON=45 4 * * *     # 版本歷史保留清理的 cron（UTC）；保留條件是系統設定 revision.keepVersions／keepDays；留空停用
NOTIFICATION_CLEANUP_CRON=0 5 * * *  # 站內通知保留清理的 cron（UTC）；保留條件是系統設定 notification.retentionDays／maxPerUser；留空停用
WEBHOOK_CLEANUP_CRON=15 5 * * *      # webhook 事件與投遞紀錄保留清理（30 天）的 cron（UTC）；留空停用
ANNOUNCEMENT_MAINTENANCE_CRON=20 5 * * *  # 公告的每日維護（補排程、發送紀錄保留清理）的 cron（UTC）；留空停用

# ── apps/file-storage（S3 相容的本機檔案儲存）────────────
FILE_STORAGE_HOST=127.0.0.1
FILE_STORAGE_PORT=9000
FILE_STORAGE_BASE_PATH=/storage              # Vite 以 /storage 轉發且不去掉前綴（presigned URL 的簽章涵蓋路徑）
FILE_STORAGE_DATA_DIR=.data                  # 相對於 apps/file-storage/
FILE_STORAGE_REGION=us-east-1
FILE_STORAGE_ACCESS_KEY_ID=b2b-system-dev
FILE_STORAGE_SECRET_ACCESS_KEY=b2b-system-dev-secret
FILE_STORAGE_ALLOWED_ORIGINS=http://localhost:5173   # presigned URL 直傳 / 下載的 CORS（逗號分隔，* 代表全部）
FILE_STORAGE_MAX_OBJECT_SIZE=134217728       # 位元組（128 MiB，與 api 的影像轉出上限相同；不設時 5 GiB，同 S3 單次 PutObject 上限）

# ── apps/api 連物件儲存（上面兩個 KEY 共用）─────────────────
FILE_STORAGE_ENDPOINT=http://127.0.0.1:9000/storage          # api 自己連線用
FILE_STORAGE_PUBLIC_ENDPOINT={tenantOrigin}/storage   # 瀏覽器看到的位址（presigned URL 以它簽章）；{tenantOrigin} = 目前租戶的網域
FILE_STORAGE_DOWNLOAD_ENDPOINT=    # 下載與預覽改由獨立的檔案網域提供（例 https://files.example.com/storage）；留空 = 同上（同源）
FILE_UPLOAD_MAX_SIZE=104857600     # 單一檔案上限（位元組，預設 100 MiB）；也是系統設定 file.uploadMaxSize 的上限與預設值
FILE_URL_TTL=900                   # presigned 上傳／下載網址的有效秒數（60–3600；也是撤銷授權的延遲上限）
FILE_MULTIPART_THRESHOLD=16777216  # 超過這個大小改用分塊上傳（位元組，預設 16 MiB）
FILE_MULTIPART_PART_SIZE=8388608   # 分塊上傳的每塊大小（位元組，預設 8 MiB；S3 下限 5 MiB）
FILE_PENDING_TTL=86400             # 登記後超過這個秒數仍未完成的上傳，由維護排程清除
FILE_MAINTENANCE_CRON=0 * * * *    # 檔案維護排程（殘留清理、補產生影像變體）的 cron（UTC）；留空停用
FILE_MAINTENANCE_DRY_RUN=false     # true：只偵測並記錄殘留，不刪除

# ── apps/backstage（VITE_ 前綴才會進 bundle）─────────────────
VITE_API_BASE_URL=/api
VITE_OIDC_ISSUER=http://localhost:5175/api/oidc   # SSO 的 issuer（backstage、apps/platform 相同）
VITE_PLATFORM_APP_URL=http://localhost:5175            # backstage：帳號流程與租戶管理在 apps/platform
VITE_ENABLE_MOCK=false

# ── 開發伺服器（只在 shell 設定：vite.config.ts 讀 process.env，不讀這個檔案）──
# 並行跑第二組環境（例：E2E 用暫用 DB，docs/architecture/frontend/10-testing.md §4.3）時換埠；預設 5173／5175／:3000
# BACKSTAGE_DEV_PORT=5273
# PLATFORM_DEV_PORT=5275
# DEV_API_PROXY_TARGET=http://localhost:3100
```

`apps/apm-service` 的變數（`APM_*`）見 [`07-apm-service.md`](./07-apm-service.md) §1；前端的 `VITE_APM_*`、`APP_RELEASE` 見
[`frontend/19-observability.md`](./frontend/19-observability.md) §8。
`apps/file-storage` 的變數說明見 [`03-file-storage.md`](./03-file-storage.md) §1；api 端的物件儲存變數見
[`backend/09-file.md`](./backend/09-file.md) §8。

env 由 `core/config` 以 Zod schema 驗證，**缺少必要變數時啟動即失敗**，不容許
執行到一半才發現。`NODE_ENV=production` 另外拒絕低熵的值與開發用的網址：

| 變數 | production 的檢查 |
| --- | --- |
| `JWT_SECRET`、`FILE_STORAGE_SECRET_ACCESS_KEY` | 不能是上面的範例值或低熵字串（含 `change-me`、不同字元少於 10 個）；`FILE_STORAGE_ACCESS_KEY_ID` 只擋範例值。`JWT_SECRET` 在 production 是選填（只驗過渡期的舊 token，[`backend/04-auth.md`](./backend/04-auth.md) §11 D7） |
| `JWT_SIGNING_KEYS`、`PLATFORM_JWT_SIGNING_KEYS` | 內部 api 必填、對外 API 的程序不能有；格式 `<kid>:<base64>[,…]`，每把至少 32 bytes、`kid` 不重複，兩組不能共用金鑰 |
| `FILE_URL_SIGNING_KEY` | 必填；base64 解開至少 32 bytes |
| `TENANT_SECRET_KEY`、`IDP_SECRET_KEY`、`WEBHOOK_SECRET_KEY`、`MFA_SECRET_KEY` | 必填；base64 解開要是 32 bytes，而且不同的位元組至少 16 個（擋 32 個 0x00 之類手填的值）。以 `openssl rand -base64 32` 產生 |
| `OIDC_COOKIE_KEYS` | 必填；每一把都要至少 32 字元，而且不是低熵字串 |
| `OIDC_JWKS` | 必填；要是 `{"keys":[…]}`，至少一把含私鑰（`d`） |
| `APP_PUBLIC_URL`、`PLATFORM_APP_URL`、`OIDC_ISSUER` | 必須是 `https:`，主機不能是 `localhost`、`*.localhost`、`127.*`、`::1`；`OIDC_ISSUER` 要與 `PLATFORM_APP_URL` 同源 |
| `MAIL_TRANSPORT` | 必須是 `smtp`（`console` 會把啟用／重設連結寫進日誌） |

對外 API 的程序（`API_SURFACE=external`，由 `main.external.ts` 固定）不要求 OIDC、外部 IdP、webhook 的金鑰，給了才檢查強度
（[`06-external-api.md`](./06-external-api.md) §6）。production 不再由 `JWT_SECRET` 推導這些金鑰：沒有金鑰的程序要加解密時直接失敗。
