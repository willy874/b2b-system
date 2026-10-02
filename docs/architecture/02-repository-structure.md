# Repository 結構

## 1. Monorepo 佈局

```
b2b-system/
├── package.json                 root scripts、devDependencies
├── pnpm-workspace.yaml
├── tsconfig.base.json           共用 compilerOptions 與 path alias 基準
├── docker-compose.yml           postgres（本機開發）
├── lefthook.yml                 git hooks
├── .oxlintrc.json / .oxfmtrc.jsonc
├── .env.example
│
├── apps/
│   ├── backstage/               @b2b-system/backstage — React 前端（RBAC 管理後台）
│   ├── auth/                    @b2b-system/auth — 全平台共用的身分與租戶入口（React，ADR-0019；見該目錄的 README）
│   ├── api/                     @b2b-system/api — NestJS 後端
│   ├── file-storage/            @b2b-system/file-storage — S3 相容的本機檔案儲存（見 03-file-storage.md）
│   └── e2e/                     @b2b-system/e2e — Playwright
│
├── packages/
│   ├── api-sdk/                 @b2b-system/api-sdk — 由 OpenAPI 產生的型別、zod schema 與 fetch client
│   └── realtime/                @b2b-system/realtime — Socket.io 事件合約（事件名稱、zod schema、型別）
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
| `pnpm dev`                                     | `docker compose up -d postgres` ＋ Mailpit ＋ 並行啟動 api、backstage（:5173）、auth（:5175）、file-storage |
| `pnpm dev:api` / `pnpm dev:backstage` / `pnpm dev:auth` | 單獨啟動                                                 |
| `pnpm dev:e2e`                                 | 啟動 Mailpit，以放寬的速率限制、`MAIL_TRANSPORT=smtp` 啟動 api |
| `pnpm mail:up`                                 | `docker compose up -d mailpit`（SMTP :1025、網頁 :8025） |
| `pnpm dev:storage`                             | 啟動 `apps/file-storage`（S3 相容，:9000）               |
| `pnpm dev:mock-idp`                            | 模擬的外部 IdP（:4455）；外部 IdP 登入的開發與 E2E 用（[`04-sso.md`](./04-sso.md) §10） |
| `pnpm build`                                   | 依序 `api-sdk` → `api` → `backstage` → `auth`                  |
| `pnpm db:generate`                             | drizzle-kit 產生 migration                               |
| `pnpm db:migrate`                              | 套用 migration                                           |
| `pnpm db:seed`                                 | 灌入權限目錄與系統角色                                   |
| `pnpm db:studio`                               | drizzle-kit studio                                       |
| `pnpm sdk:generate`                            | 從 `apps/api/openapi.json` 產生 `packages/api-sdk/src/generated/` |
| `pnpm lint` / `pnpm format` / `pnpm typecheck` | 全 workspace                                             |
| `pnpm test`                                    | 全 workspace 單元測試                                    |
| `pnpm test:e2e`                                | Playwright                                               |
| `pnpm storybook` / `pnpm storybook:build`      | 設計系統元件的 Storybook（:6006）／輸出靜態站到 `apps/backstage/storybook-static/` |

---

## 2. `apps/backstage` 內部結構

檔案佈局如下（各層職責見 [`frontend/01-architecture.md`](./frontend/01-architecture.md)）：

```
apps/backstage/src/
├── main.tsx                 AppContext plugin chain ＋ createRoot
├── index.css
│
├── app/                     App Shell（只組裝，不實作業務）
│   ├── App.tsx
│   ├── Layout.tsx           依 matcher 決定套哪個 layout
│   ├── GlobalProvider.tsx   Query / Router / Theme / Toast providers
│   ├── ToastHost.tsx        唯一持有 toaster：eventBus 的 toast:show → 畫面
│   ├── ConfirmDialogHost.tsx 掛上 useConfirm()，以 t() 傳入預設按鈕文案
│   ├── plugin.ts            建立 router，掛到 AppContext
│   ├── routes.tsx           把各 feature 的 route 組成 route tree
│   ├── layouts/
│   │   ├── DashboardLayout.tsx   側邊選單 ＋ 頂部列 ＋ Outlet
│   │   └── index.ts
│   └── locales/{en_US,zh_TW}.json
│
├── core/                    跨 feature 的機制層（不認識任何 feature）
│   ├── app/                 AppContext 型別、createAppContext、React context
│   ├── auth/                SessionStore（token 生命週期、跨分頁單飛續期）
│   ├── batch/               全域批次佇列（SharedWorker 排程、進度條、AppHeader 面板、結果彈出）
│   ├── cache/               queryClient、跨分頁失效、store 持久化
│   ├── client/              HttpContext / FetcherContext / defineFetcher / 攔截器
│   ├── components/          機制性元件（ErrorPage、Empty、PermissionGate…）
│   ├── errors/              錯誤碼、例外型別、useErrorMessage
│   ├── file/                檔案類型、預覽解析器／檔案驗證器／縮圖產生器的註冊表
│   ├── locales/             i18n scope loader
│   ├── notify/              useToast()：把提示發到 eventBus
│   ├── permission/          ★ 權限註冊表、hooks、常數
│   ├── preference/          偏好設定註冊表（讓 feature 擴充偏好頁）
│   ├── route-link/          route id → route 的註冊表：後端存的連結（例：通知）由擁有頁面的 feature 登記（docs/architecture/frontend/15-notification.md §3）
│   ├── trash/               回收桶的類型註冊表（docs/architecture/frontend/13-trash.md）
│   ├── router/              RootRoute、Router Provider
│   └── store/               全域 store（permission / layout / timezone / locale）
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
├── components/              ★ Base UI 封裝層（設計系統元件）
│   ├── Button/  Input/  Select/  Dialog/  Table/  Toast/  Tooltip/ …
│   │   └── Xxx.stories.tsx  每個元件的 Storybook story（設定在 apps/backstage/.storybook/）
│   └── …
│
├── plugins/                 可插拔的能力（非業務、非核心）
│   ├── app/                 cache / event-bus / i18n / http-context / feature-flags
│   ├── fetcher/             auth 標頭、refresh、retry 攔截器
│   └── features/            擴充既有 feature 的小外掛（例如偏好頁的分頁）
│
├── shared/                  純工具與型別（不得依賴 core / features）
│   ├── api-sdk/             re-export packages/api-sdk（單一收斂點）
│   ├── constants/           env、lang、testid
│   ├── context/             通用 plugin context 實作
│   ├── store/               signal store 實作
│   ├── storage/             localStorage / dictStorage 封裝
│   ├── hooks/  date/  utils/  types/
│   └── EventEmitter/
│
├── themes/                  Design Token（seed / alias / component 三層 CSS 變數）
├── mocks/                   MSW handlers（dev 與測試共用）
└── test/                    測試 setup、render 輔助、fixture
```

### 2.1 Path alias

`tsconfig.app.json`：

```json
{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
```

匯入一律用 `@/`，**禁止** `../../../`（超過一層）。

### 2.2 `apps/auth`

資料夾分層與上面相同（`main.tsx` → `app/` → `features/` → `apis/` → `core/` → `components/` → `shared/`）。
features 是 `login`（IdP 互動頁、帳號流程）、`home`、`identity-provider`；`core/`、`components/`、`shared/`
大多從 backstage **複製**（ADR-0019 D14），複製清單與同步規則見 [`apps/auth/README.md`](../../apps/auth/README.md)，
路由與登入流程見 [`04-sso.md`](./04-sso.md) §6。

---

## 3. `apps/api` 內部結構

刻意與前端同構：`modules/` 對應 `features/`，`core/` 對應 `core/`。

```
apps/api/src/
├── main.ts                  bootstrap、Swagger、全域管線
├── app.module.ts            匯入 core 與所有 modules，註冊 APP_GUARD/FILTER/INTERCEPTOR
│
├── core/                    機制層（不認識任何 module）
│   ├── config/              @nestjs/config ＋ Zod 驗證 env
│   ├── database/            DrizzleModule、DB provider、交易輔助
│   ├── cache/               PermissionCacheService（in-memory + TTL + 明確失效，可整個租戶失效）
│   ├── authz/               關係圖權限引擎：模型、判斷器、relation_tuples、revision 失效（docs/adr/0024-relationship-based-access-control.md）
│   ├── broadcast/           程序之間的失效廣播：平台 DB 的 LISTEN／NOTIFY（docs/architecture/backend/05-rbac.md §5.1）
│   ├── errors/              ErrorCode enum、AppException、HttpExceptionFilter
│   ├── http/                TransformInterceptor、分頁 DTO、RequestId middleware
│   ├── logger/              Pino 設定
│   ├── jobs/                背景工作佇列（pg-boss）：JobQueue、defineJob（docs/architecture/backend/10-jobs.md）
│   ├── mail/                寄信：MailTransport（smtp / console）、MailService（docs/architecture/backend/11-mail.md）
│   └── validation/          ZodValidationPipe、zod ↔ OpenAPI
│
├── common/                  跨模組的 decorator / guard（薄）
│   ├── decorators/          @Public @CurrentUser @RequirePermissions @Audit
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

已移到 [`conventions/01-general.md`](../conventions/01-general.md) §3–4。

---

## 5. 環境變數

`.env.example`（全文；改環境變數時兩邊一起改）：

```bash
# ── apps/api ─────────────────────────────────────────
# 資料庫（docs/adr/0020-physical-tenant-isolation.md）：平台 DB 一個，每個租戶各一個 database
PLATFORM_DATABASE_URL=postgres://b2bsystem:b2bsystem@localhost:5432/b2b_platform   # 不存在時 db:migrate 會建立
TENANT_SECRET_KEY=                 # 加密租戶連線字串的金鑰（32 bytes base64）；留空 = 由 JWT_SECRET 推導（production 必填）
TENANT_POOL_MAX=10                 # 每個租戶的連線池上限（連線預算見 docs/architecture/backend/02-database.md §6.2）
TENANT_POOL_IDLE_TIMEOUT=30        # 租戶連線池的閒置連線幾秒後關閉
TENANT_CACHE_TTL=30                # 網域 → 租戶的快取秒數
PLATFORM_POOL_MAX=                 # 平台 DB 的連線池上限；留空 = production 10、其他 3
DB_CONNECT_TIMEOUT=10              # 建立連線的逾時（秒）
DB_STATEMENT_TIMEOUT_MS=15000      # 每條連線的 statement_timeout（毫秒）；0 = 不限制
DB_IDLE_IN_TRANSACTION_TIMEOUT_MS=30000   # 交易開著卻閒置的上限（毫秒）；0 = 不限制
# 佈建新租戶（apps/auth 的租戶管理）：要有 CREATEDB 與 CREATEROLE；留空 = 用 PLATFORM_DATABASE_URL
TENANT_PROVISIONING_DATABASE_URL=
# 新租戶的預設網域是 {code}.<這個值>；留空 = APP_PUBLIC_URL 的 host（開發：acme.localhost:5173）
TENANT_BASE_DOMAIN=
# 預設租戶：db:migrate 在平台 DB 登記它（還沒有租戶管理之前的唯一租戶；交付順序第 4 步起由 apps/auth 建立）
DEFAULT_TENANT_CODE=default
DEFAULT_TENANT_DATABASE_URL=postgres://b2bsystem:b2bsystem@localhost:5432/b2b_system
# 屬於預設租戶的網域（瀏覽器看到的 host，含 port）。apps/auth（:5175）不屬於任何租戶
DEFAULT_TENANT_DOMAINS=localhost:5173
# 預設租戶的物件儲存 bucket（每個租戶一個）；預設沿用租戶化之前共用的 b2b-system，既有檔案不必搬
DEFAULT_TENANT_STORAGE_BUCKET=b2b-system
# 第一位平台管理者（apps/auth 的登入；與租戶的帳號是兩份資料）：db:seed 在平台 DB 沒有管理者時建立
PLATFORM_ADMIN_EMAIL=platform@example.com
PLATFORM_ADMIN_PASSWORD=                      # 留空 = seed 時隨機產生並印出一次
PORT=3000
EXTERNAL_API_PORT=3001             # 對外 API 的程序（pnpm dev:external-api；ADR-0027 D9）
NODE_ENV=development

JWT_SECRET=change-me-in-production-min-32-chars
JWT_ACCESS_TTL=300                 # 秒
REFRESH_TOKEN_TTL=604800           # 秒（7 天）
REFRESH_FAMILY_MAX_AGE=2592000     # session 的絕對壽命（秒，30 天）：從登入起算，超過就要重新登入
REFRESH_REUSE_GRACE_SECONDS=30     # 剛用過的 refresh token 在這段時間內重送視為回應遺失、換發新的；0 停用
REFRESH_COOKIE_NAME=refresh_token
REFRESH_COOKIE_PATH=/api/auth    # 瀏覽器看到的前綴（前端一律打 /api/*）
PLATFORM_REFRESH_COOKIE_PATH=/api/platform/auth   # 平台管理者的 refresh cookie（apps/auth 的 origin）
REFRESH_COOKIE_DOMAIN=localhost
API_PUBLIC_BASE_URL=/api         # 瀏覽器看到的 api 位址；影像 API 的網址以它開頭

ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2

PERMISSION_CACHE_TTL=60            # 秒
# 速率限制（次 / 分；docs/architecture/backend/03-api-conventions.md §8）：已登入以使用者計、未登入以 IP 計
DEFAULT_RATE_LIMIT=600             # 每個已登入的使用者（所有端點合計）
ANONYMOUS_RATE_LIMIT=3000          # 每個 IP 的未登入請求（1000 人共用一個 NAT 出口）
EXTERNAL_RATE_LIMIT=600            # 對外 API：每把 API token 每分鐘
EXTERNAL_AUTH_FAILURE_RATE_LIMIT=30  # 對外 API：每個 IP 每分鐘驗證失敗的次數，超過回 429
AUTH_RATE_LIMIT=10                 # 登入類端點：每個「帳號 ＋ IP」（E2E 需調高）；忘記密碼、註冊是 1/3
AUTH_IP_RATE_LIMIT=300             # 登入類端點：每個 IP；忘記密碼、註冊是 1/10
REFRESH_RATE_LIMIT=30              # /auth/refresh：每個 refresh session
REFRESH_IP_RATE_LIMIT=2000         # /auth/refresh：每個 IP
REALTIME_HANDSHAKES_PER_IP=1200    # WebSocket handshake：每個 IP
REALTIME_CONNECTIONS_PER_USER=20   # WebSocket：每個使用者同時的連線數
TRUST_PROXY=false                  # 反向代理後面才設：跳數或子網路（例：uniquelocal）；限流依它判定客戶端 IP
LOGIN_MAX_ATTEMPTS=5               # 只用於平台管理者；租戶使用者的鎖定是系統設定 auth.loginMaxAttempts
LOGIN_LOCKOUT_SECONDS=900          # 同上（租戶：auth.loginLockoutSeconds）
DIRECT_LOGIN_ENABLED=              # POST /auth/login（email＋密碼直接換 token）；留空：production 關閉、其他開啟；腳本改用 API token（ADR-0027 D15）

REALTIME_ALLOWED_ORIGINS=http://localhost:5173   # WebSocket handshake 允許的 Origin（逗號分隔）；同源（租戶自己的網域）一律允許

# 郵件（docs/architecture/backend/11-mail.md）：本機寄給 Mailpit（pnpm dev 會一起啟動），在 http://localhost:8025 看信
MAIL_TRANSPORT=smtp                # smtp：經 SMTP 寄出；console：只寫日誌（含連結），不寄出
MAIL_SMTP_URL=smtp://localhost:1025
MAIL_SMTP_POOL_SIZE=5              # SMTP 連線池的連線數（同時寄出的信）
MAIL_FROM="B2B System <no-reply@localhost>"
APP_PUBLIC_URL=http://localhost:5173   # 信裡連結的開頭（瀏覽器看到的前端網址）；也是第一方 client `backstage` 的 redirect URI 開頭

# ── SSO：apps/api 當 OIDC Provider（docs/adr/0019-sso-identity-platform.md）
AUTH_APP_URL=http://localhost:5175            # apps/auth 的網址（登入互動頁）
OIDC_ISSUER=http://localhost:5175/api/oidc    # apps/auth origin 底下的 /api/oidc
OIDC_JWKS=                                    # 簽 ID token 的私鑰 JWKS JSON；留空 = 啟動時產生臨時金鑰（production 必填）
OIDC_COOKIE_KEYS=                             # 簽 IdP cookie 的金鑰，逗號分隔（production 必填）
OIDC_CLEANUP_CRON=45 3 * * *                  # 清除過期 IdP 狀態的 cron（UTC）；留空停用
AUTH_TOKEN_CLEANUP_CRON=15 4 * * *            # 清除過期 refresh token 與啟用／重設 token 的 cron（UTC）；留空停用
AUTH_TOKEN_RETENTION_DAYS=30                  # 過期或用過的 token 保留天數（安全事件調查用）
IDP_SECRET_KEY=                               # 加密外部 IdP client secret 的金鑰（32 bytes base64）；留空 = 由 JWT_SECRET 推導（production 必填）
WEBHOOK_SECRET_KEY=                           # 加密 webhook 簽章密鑰的金鑰（32 bytes base64）；留空 = 由 JWT_SECRET 推導（production 必填）

SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_PASSWORD=              # 留空則 seed 時隨機產生並印出一次

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
FILE_STORAGE_MAX_OBJECT_SIZE=5368709120      # 位元組（預設 5 GiB，與 S3 單次 PutObject 上限相同）

# ── apps/api 連物件儲存（上面兩個 KEY 共用）─────────────────
FILE_STORAGE_ENDPOINT=http://127.0.0.1:9000/storage          # api 自己連線用
FILE_STORAGE_PUBLIC_ENDPOINT={tenantOrigin}/storage   # 瀏覽器看到的位址（presigned URL 以它簽章）；{tenantOrigin} = 目前租戶的網域
FILE_UPLOAD_MAX_SIZE=104857600     # 單一檔案上限（位元組，預設 100 MiB）；也是系統設定 file.uploadMaxSize 的上限與預設值
FILE_URL_TTL=900                   # presigned 上傳／下載網址的有效秒數（60–3600；也是撤銷授權的延遲上限）
FILE_MULTIPART_THRESHOLD=16777216  # 超過這個大小改用分塊上傳（位元組，預設 16 MiB）
FILE_MULTIPART_PART_SIZE=8388608   # 分塊上傳的每塊大小（位元組，預設 8 MiB；S3 下限 5 MiB）
FILE_PENDING_TTL=86400             # 登記後超過這個秒數仍未完成的上傳，由維護排程清除
FILE_MAINTENANCE_CRON=0 * * * *    # 檔案維護排程（殘留清理、補產生影像變體）的 cron（UTC）；留空停用
FILE_MAINTENANCE_DRY_RUN=false     # true：只偵測並記錄殘留，不刪除

# ── apps/backstage（VITE_ 前綴才會進 bundle）─────────────────
VITE_API_BASE_URL=/api
VITE_OIDC_ISSUER=http://localhost:5175/api/oidc   # SSO 的 issuer（backstage、apps/auth 相同）
VITE_AUTH_APP_URL=http://localhost:5175            # backstage：帳號流程與租戶管理在 apps/auth
VITE_ENABLE_MOCK=false

# ── 開發伺服器（只在 shell 設定：vite.config.ts 讀 process.env，不讀這個檔案）──
# 並行跑第二組環境（例：E2E 用暫用 DB，docs/architecture/frontend/10-testing.md §4.3）時換埠；預設 5173／5175／:3000
# BACKSTAGE_DEV_PORT=5273
# AUTH_DEV_PORT=5275
# DEV_API_PROXY_TARGET=http://localhost:3100
```

`apps/file-storage` 的變數說明見 [`03-file-storage.md`](./03-file-storage.md) §1；api 端的物件儲存變數見
[`backend/09-file.md`](./backend/09-file.md) §8。

env 由 `core/config` 以 Zod schema 驗證，**缺少必要變數時啟動即失敗**，不容許
執行到一半才發現。
`NODE_ENV=production` 另外檢查：`JWT_SECRET`、`FILE_STORAGE_*` 不能是上面的範例值或低熵字串（含 `change-me`、不同字元少於 10 個），
`MAIL_TRANSPORT` 必須是 `smtp`（`console` 會把啟用／重設連結寫進日誌），OIDC 與加密金鑰必填。
