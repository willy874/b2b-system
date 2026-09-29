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
│   ├── realtime/                @b2b-system/realtime — Socket.io 事件合約（事件名稱、zod schema、型別）
│   └── utils/                   @b2b-system/utils — 前後端共用的純函式
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
│   └── job/
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
│   ├── cache/               PermissionCacheService（in-memory + TTL + 明確失效）
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
│   ├── oidc-provider/       oidc-provider 掛在 /oidc、oidc_payloads adapter
│   ├── identity-provider/   外部 IdP 連線、openid-client、帳號 ↔ 外部身分
│   ├── user/
│   ├── role/
│   ├── permission/
│   ├── audit-log/
│   ├── approval/
│   ├── file/                檔案轉介表、上傳流程、資料夾授權（docs/architecture/backend/09-file.md）
│   ├── resource-grant/      資源授權與等級解析（docs/rbac/07-resource-grants.md）
│   ├── job/                 背景工作的管理 API（docs/architecture/backend/10-jobs.md §6）
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

`.env.example`：

```bash
# ── apps/api ─────────────────────────────────────────
PLATFORM_DATABASE_URL=postgres://b2bsystem:b2bsystem@localhost:5432/b2b_platform
TENANT_SECRET_KEY=                 # 留空 = 由 JWT_SECRET 推導（production 必填）
DEFAULT_TENANT_CODE=default
DEFAULT_TENANT_DATABASE_URL=postgres://b2bsystem:b2bsystem@localhost:5432/b2b_system
DEFAULT_TENANT_DOMAINS=localhost:5173   # apps/auth（:5175）不屬於任何租戶
DEFAULT_TENANT_STORAGE_BUCKET=b2b-system # 預設租戶的 bucket（每個租戶一個）
PLATFORM_ADMIN_EMAIL=platform@example.com   # 第一位平台管理者（apps/auth 的登入）
PLATFORM_ADMIN_PASSWORD=
PORT=3000
NODE_ENV=development

JWT_SECRET=change-me-in-production
JWT_ACCESS_TTL=300                 # 秒
REFRESH_TOKEN_TTL=604800           # 秒（7 天）
REFRESH_COOKIE_NAME=refresh_token
REFRESH_COOKIE_PATH=/api/auth      # 瀏覽器看到的前綴（前端一律打 /api/*）
REFRESH_COOKIE_DOMAIN=localhost
API_PUBLIC_BASE_URL=/api            # 瀏覽器看到的 api 位址（影像 API 的網址以它開頭）

ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2

PERMISSION_CACHE_TTL=60            # 秒
AUTH_RATE_LIMIT=10                 # /auth/* 每分鐘每 IP（E2E 需調高）
DEFAULT_RATE_LIMIT=120             # 其餘端點每分鐘每 IP
TRUST_PROXY=false                  # Express trust proxy：反向代理後面設跳數或子網路（例：uniquelocal）
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_SECONDS=900

SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_PASSWORD=              # 留空則 seed 時隨機產生並印出一次

MAIL_TRANSPORT=smtp                 # smtp / console（backend/11-mail.md §2）
MAIL_SMTP_URL=smtp://localhost:1025 # 本機是 Mailpit
MAIL_FROM="B2B System <no-reply@localhost>"
APP_PUBLIC_URL=http://localhost:5173  # 信裡連結的開頭；也是第一方 client `backstage` 的 redirect URI 開頭
AUTH_APP_URL=http://localhost:5175     # apps/auth（IdP 的登入互動頁）
OIDC_ISSUER=http://localhost:5175/api/oidc
OIDC_JWKS=                             # 簽 ID token 的私鑰 JWKS；留空 = 臨時金鑰（production 必填）
OIDC_COOKIE_KEYS=                      # 簽 IdP cookie 的金鑰（production 必填）
OIDC_CLEANUP_CRON=45 3 * * *
IDP_SECRET_KEY=                        # 加密外部 IdP client secret 的金鑰（32 bytes base64）；留空 = 由 JWT_SECRET 推導（production 必填，ADR-0019 D11）

JOBS_WORKER_ENABLED=true            # 是否執行背景工作與排程；false 只入列（backend/10-jobs.md §5）
AUDIT_LOG_ARCHIVE_CRON=30 3 * * *   # 稽核熱 → 冷搬移的 cron（UTC）；留空停用

REALTIME_ALLOWED_ORIGINS=http://localhost:5173   # Socket.io handshake 的 Origin 白名單（逗號分隔）

# ── apps/file-storage（S3 相容的本機檔案儲存）────────────
FILE_STORAGE_HOST=127.0.0.1
FILE_STORAGE_PORT=9000
FILE_STORAGE_BASE_PATH=/storage              # Vite 以 /storage 轉發且不去掉前綴
FILE_STORAGE_DATA_DIR=.data                  # 相對於 apps/file-storage/
FILE_STORAGE_REGION=us-east-1
FILE_STORAGE_ACCESS_KEY_ID=b2b-system-dev
FILE_STORAGE_SECRET_ACCESS_KEY=b2b-system-dev-secret
FILE_STORAGE_ALLOWED_ORIGINS=http://localhost:5173   # presigned URL 直傳 / 下載的 CORS
FILE_STORAGE_MAX_OBJECT_SIZE=5368709120      # 位元組（預設 5 GiB）

# ── apps/api 連物件儲存（上面兩個 KEY 共用；docs/architecture/backend/09-file.md §8）
FILE_STORAGE_ENDPOINT=http://127.0.0.1:9000/storage
FILE_STORAGE_PUBLIC_ENDPOINT=http://localhost:5173/storage
FILE_UPLOAD_MAX_SIZE=104857600
FILE_URL_TTL=900
FILE_MULTIPART_THRESHOLD=16777216   # 超過改用分塊上傳
FILE_MULTIPART_PART_SIZE=8388608    # 每塊大小（≥ 5 MiB）
FILE_PENDING_TTL=86400              # 登記後超過這個秒數仍未完成的上傳，由維護排程清除
FILE_MAINTENANCE_CRON=0 * * * *     # 檔案維護排程的 cron（UTC）；留空停用
FILE_MAINTENANCE_DRY_RUN=false      # true：只偵測並記錄殘留，不刪除

# ── apps/backstage、apps/auth（VITE_ 前綴才會進 bundle；兩者各自讀自己目錄的 env）──
VITE_API_BASE_URL=/api
VITE_OIDC_ISSUER=http://localhost:5175/api/oidc   # SSO 的 issuer（兩個前端相同）
VITE_AUTH_APP_URL=http://localhost:5175            # backstage：帳號流程與平台管理在 apps/auth
VITE_ENABLE_MOCK=false
```

`apps/file-storage` 的變數說明見 [`03-file-storage.md`](./03-file-storage.md) §1；api 端的物件儲存變數見
[`backend/09-file.md`](./backend/09-file.md) §8。

env 由 `core/config` 以 Zod schema 驗證，**缺少必要變數時啟動即失敗**，不容許
執行到一半才發現。
