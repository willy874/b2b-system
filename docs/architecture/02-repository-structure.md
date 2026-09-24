# Repository 結構

## 1. Monorepo 佈局

```
game-editor/
├── package.json                 root scripts、devDependencies
├── pnpm-workspace.yaml
├── tsconfig.base.json           共用 compilerOptions 與 path alias 基準
├── docker-compose.yml           postgres（本機開發）
├── lefthook.yml                 git hooks
├── .oxlintrc.json / .oxfmtrc.jsonc
├── .env.example
│
├── apps/
│   ├── web/                     @game-editor/web — React 前端
│   ├── api/                     @game-editor/api — NestJS 後端
│   └── e2e/                     @game-editor/e2e — Playwright
│
├── packages/
│   ├── api-sdk/                 @game-editor/api-sdk — 由 OpenAPI 產生的型別、zod schema 與 fetch client
│   └── utils/                   @game-editor/utils — 前後端共用的純函式
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
| `pnpm dev`                                     | `docker compose up -d postgres` ＋ 並行啟動 api 與 web   |
| `pnpm dev:api` / `pnpm dev:web`                | 單獨啟動                                                 |
| `pnpm build`                                   | 依序 `api-sdk` → `api` → `web`                           |
| `pnpm db:generate`                             | drizzle-kit 產生 migration                               |
| `pnpm db:migrate`                              | 套用 migration                                           |
| `pnpm db:seed`                                 | 灌入權限目錄與系統角色                                   |
| `pnpm db:studio`                               | drizzle-kit studio                                       |
| `pnpm sdk:generate`                            | 從 `apps/api/openapi.json` 產生 `packages/api-sdk/src/generated/` |
| `pnpm lint` / `pnpm format` / `pnpm typecheck` | 全 workspace                                             |
| `pnpm test`                                    | 全 workspace 單元測試                                    |
| `pnpm test:e2e`                                | Playwright                                               |

---

## 2. `apps/web` 內部結構

檔案佈局如下（各層職責見 [`frontend/01-architecture.md`](./frontend/01-architecture.md)）：

```
apps/web/src/
├── main.tsx                 AppContext plugin chain ＋ createRoot
├── index.css
│
├── app/                     App Shell（只組裝，不實作業務）
│   ├── App.tsx
│   ├── Layout.tsx           依 matcher 決定套哪個 layout
│   ├── GlobalProvider.tsx   Query / Router / Theme / Toast providers
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
│   ├── cache/               queryClient、跨分頁失效、store 持久化
│   ├── client/              HttpContext / FetcherContext / defineFetcher / 攔截器
│   ├── components/          機制性元件（ErrorPage、Empty、PermissionGate…）
│   ├── errors/              錯誤碼、例外型別、useErrorMessage
│   ├── locales/             i18n scope loader
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
│   └── home/
│
├── apis/                    與後端對話的唯一入口
│   ├── auth/
│   ├── user/
│   ├── role/
│   ├── permission/
│   └── audit-log/
│
├── components/              ★ Base UI 封裝層（設計系統元件）
│   ├── Button/  Input/  Select/  Dialog/  Table/  Toast/  Tooltip/ …
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
│   └── validation/          ZodValidationPipe、zod ↔ OpenAPI
│
├── common/                  跨模組的 decorator / guard（薄）
│   ├── decorators/          @Public @CurrentUser @RequirePermissions @Audit
│   ├── guards/              JwtAuthGuard、PermissionsGuard、ThrottlerGuard
│   └── types/
│
├── modules/                 ★ 業務模組
│   ├── auth/
│   ├── user/
│   ├── role/
│   ├── permission/
│   ├── audit-log/
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
DATABASE_URL=postgres://gameeditor:gameeditor@localhost:5432/game_editor
PORT=3000
NODE_ENV=development

JWT_SECRET=change-me-in-production
JWT_ACCESS_TTL=300                 # 秒
REFRESH_TOKEN_TTL=604800           # 秒（7 天）
REFRESH_COOKIE_NAME=refresh_token
REFRESH_COOKIE_PATH=/api/auth      # 瀏覽器看到的前綴（前端一律打 /api/*）
REFRESH_COOKIE_DOMAIN=localhost

ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2

PERMISSION_CACHE_TTL=60            # 秒
AUTH_RATE_LIMIT=10                 # /auth/* 每分鐘每 IP（E2E 需調高）
DEFAULT_RATE_LIMIT=120             # 其餘端點每分鐘每 IP
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_SECONDS=900

SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_PASSWORD=              # 留空則 seed 時隨機產生並印出一次

# ── apps/web（VITE_ 前綴才會進 bundle）─────────────────
VITE_API_BASE_URL=/api
VITE_ENABLE_MOCK=false
```

env 由 `core/config` 以 Zod schema 驗證，**缺少必要變數時啟動即失敗**，不容許
執行到一半才發現。
