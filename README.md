# B2B System

一套 **通用型的多租戶 B2B 後台**。它不綁定任何業務領域，而是把每個後台都會重寫一次的基礎能力——
帳號與登入、權限、稽核、檔案、背景工作、通知——一次做好，讓之後的業務功能只要「接上去」。

規格在 [`docs/`](./docs/README.md)（單一事實來源），實作進度見 [`docs/overview/03-roadmap.md`](./docs/overview/03-roadmap.md)，
待製作的功能見 [`docs/features/`](./docs/features/README.md)。

## 已經有什麼

| 領域 | 內容 |
| --- | --- |
| 多租戶 | 每個租戶一個 database 與網域；平台管理者在 `apps/platform` 建立、佈建、停用、刪除租戶，並為每個租戶開關模組與 feature flag |
| 身分與登入 | `apps/api` 當 OIDC Provider、`apps/platform` 統一登入入口、外部 IdP（OIDC）與網域導向、單一登出；rotating refresh token 與重用偵測 |
| 權限 | 角色 × 權限鍵（`resource:action`）＋ 關係圖（ReBAC）：巢狀群組、資料夾層級授權與繼承、反提權、「為什麼能做 X」的說明 |
| 管理功能 | 使用者、角色、群組、權限目錄、審批（註冊需核准）、個人帳號、系統設定 |
| 稽核 | 所有寫入與授權決策的 append-only 紀錄，熱表 / 冷表自動搬移 |
| 資料保護 | 樂觀鎖（`version`）、回收桶與還原、版本歷史與還原到某一版 |
| 檔案 | S3 相容的物件儲存（`apps/file-storage`）、分塊上傳、圖片縮圖、檔案管理器 |
| 背景工作 | pg-boss 佇列、排程、重試與管理頁；交易內 enqueue（outbox） |
| 通知與即時 | 站內通知與事件管理（租戶層開關）、寄信（Mailpit 開發）、Socket.io 推播與跨程序廣播 |
| 前端骨架 | plugin-based AppContext、執行期權限註冊表、依權限過濾的選單、i18n（zh-TW / en-US）、Dark Mode、Base UI 設計系統與 Storybook |

業務功能（例如訂單、內容、專案）不在本 repo 的現有範圍；新增方式見下方「加一個業務功能」。

## 技術堆疊

| 層 | 選擇 |
| --- | --- |
| 前端 | React 19 + Vite 8 + TanStack Router / Query / Table / Form + Base UI + UnoCSS |
| 後端 | NestJS 12 + Drizzle ORM + PostgreSQL 17 + Zod + pg-boss + Socket.io |
| 工具 | pnpm workspace、TypeScript 6、oxlint / oxfmt、lefthook、Vitest 5、Playwright、Storybook |

## 專案結構

```
apps/backstage      租戶的後台（React；feature-first + plugin-based AppContext）
apps/platform           全平台共用的身分與租戶入口：登入互動頁、帳號流程、平台管理（React）
apps/api            後端（NestJS；modules / core / common / db），同時是 OIDC Provider
apps/file-storage   S3 相容的本機物件儲存
apps/e2e            Playwright
packages/api-sdk    由 OpenAPI 產生的型別與 client（後端是唯一事實來源）
packages/realtime   前後端共用的即時事件定義
docs/               架構規格（唯一事實來源，改程式必須同步改文件）
```

詳細佈局見 [`docs/architecture/02-repository-structure.md`](./docs/architecture/02-repository-structure.md)。

## 從零到跑起來

```bash
# 1. 需求：Node >= 24（`nvm use` 讀 `.nvmrc`）、pnpm 10、Docker（本機 PostgreSQL 與 Mailpit）
corepack enable

# 2. 安裝相依
pnpm install

# 3. 準備環境變數（JWT_SECRET 等金鑰請換成隨機值；各欄位說明見 .env.example 註解）
cp .env.example .env

# 4. 建表（平台 DB ＋ 每個租戶的 DB）＋ 灌入權限目錄、系統角色、初始 super-admin 與平台管理者
pnpm db:up
pnpm db:migrate
pnpm db:seed          # 首次會印出初始帳號的密碼（只印這一次）

# 5. 啟動：postgres + Mailpit + api + backstage + platform + file-storage
pnpm dev
```

| 服務 | 網址 |
| --- | --- |
| backstage（租戶後台） | http://localhost:5173 |
| platform（登入入口、平台管理） | http://localhost:5175 |
| api（Swagger 在 `/docs`，僅非 production） | http://localhost:3000 |
| file-storage | http://localhost:9000 |
| Mailpit（開發用收信匣） | http://localhost:8025 |

想要有資料可看：`pnpm db:seed:dev`（假使用者、自訂角色、群組與稽核日誌，固定亂數種子）。

## 常用指令

| 指令 | 作用 |
| --- | --- |
| `pnpm dev` | 先 build `packages/*`，再起全部服務 |
| `pnpm dev:api` / `dev:backstage` / `dev:platform` / `dev:storage` | 單獨啟動一個服務 |
| `pnpm dev:mock-idp` | 模擬的外部 IdP（:4455），開發外部 IdP 登入用 |
| `pnpm dev:e2e` | 以放寬的速率限制、寄信到 Mailpit 啟動 api（跑 E2E 時用） |
| `pnpm storybook` | 設計系統元件（:6006） |
| `pnpm build` | 依序建置 api-sdk → api → backstage → platform |
| `pnpm lint` / `format` / `format:check` / `typecheck` | 全 workspace 檢查 |
| `pnpm test` | 單元 ＋ 整合（後端整合測試用 Testcontainers 起 postgres） |
| `pnpm test:e2e` | Playwright（首次需 `pnpm --filter @b2b-system/e2e install:browsers`） |
| `pnpm db:up` / `db:down` | 啟停本機 PostgreSQL |
| `pnpm db:generate` / `db:migrate` / `db:seed` / `db:studio` | 資料庫 |
| `pnpm db:seed:dev` / `db:seed:e2e` | 假資料 / E2E 固定帳號（`e2e-*@dev.local`） |
| `pnpm db:reset` | 清空業務資料（保留 schema） |
| `pnpm db:drop-tenant <代碼> [--confirm]` | 清除已刪除租戶的 database、DB 角色與 bucket |
| `pnpm sdk:generate` | 由 `apps/api/openapi.json` 產生 `packages/api-sdk` |

改了 controller、DTO 或權限鍵之後：

```bash
pnpm --filter @b2b-system/api openapi:generate && pnpm exec oxfmt apps/api/openapi.json && pnpm sdk:generate
```

## 加一個業務功能

這個後台的用法是：在骨架上加 feature，權限、稽核、回收桶、通知等機制直接沿用。順序是

1. 在 [`docs/rbac/02-permission-catalog.md`](./docs/rbac/02-permission-catalog.md) 定義權限鍵，並加進 `apps/api/src/db/seeds/permissions.ts`
2. 後端 `apps/api/src/modules/<name>/`（controller / service / repository / dto）
3. 重新產生 OpenAPI 與 SDK
4. 前端 `apps/backstage/src/apis/` 與 `apps/backstage/src/features/<name>/`，在 `main.tsx` 掛上 plugin
5. 測試與文件同步

完整 SOP 見 [`docs/architecture/frontend/03-feature-anatomy.md`](./docs/architecture/frontend/03-feature-anatomy.md) §5；
要讓新資源支援資料夾式授權、回收桶、版本歷史或通知，分別看
[`docs/rbac/07-resource-grants.md`](./docs/rbac/07-resource-grants.md)、
[`docs/architecture/backend/13-trash.md`](./docs/architecture/backend/13-trash.md)、
[`14-revisions.md`](./docs/architecture/backend/14-revisions.md)、
[`15-notification.md`](./docs/architecture/backend/15-notification.md)。
寫程式規範見 [`docs/conventions/`](./docs/conventions/README.md)。

## 測試

```bash
pnpm test        # 單元 ＋ 整合
pnpm test:e2e    # Playwright：需要 api 已啟動，且 DB 有 E2E 帳號
```

E2E 的完整前置（Playwright 會自己起 backstage、platform 與模擬 IdP，已在跑的會沿用）：

```bash
pnpm dev:e2e         # 另一個終端機：api（放寬速率限制）
pnpm test:e2e
```

`pnpm test:e2e` 一開始會 `db:reset`，**清空** `PLATFORM_DATABASE_URL` 指向的資料庫與它登記的每個租戶 DB。
沒有明確指定 E2E 用的 DB 時它會拒絕執行：對暫用 DB 跑時 `export PLATFORM_DATABASE_URL=…`
（[`10-testing.md`](./docs/architecture/frontend/10-testing.md) §4.3）；確定要清空 `.env` 那一個時加上 `E2E_RESET_CONFIRM=<平台 database 名稱>`。
`db:reset`、`db:seed:dev`、`db:seed:e2e` 本身也會拒絕標記為 production 的平台 DB，不在本機的 DB 要加 `--confirm <平台 database 名稱>`。

## 部署

`docker-compose.prod.yml` 是最小可執行的拓撲：

```
backstage（nginx，:8080）─┬→ api（REST ＋ Socket.io ＋ OIDC）→ postgres
platform（nginx，:8081）──────┘                          └→ file-storage（S3 相容）
```

`migrate` 是一次性工作，migration 與冪等 seed 跑完才啟動 api。只有平台 DB 失敗會擋住 api；單一租戶失敗只列在 `migrate` 的日誌，
那個租戶回 503、其他租戶照常服務（[`05-tenancy.md`](./docs/architecture/05-tenancy.md) §10.2 D14）。
必填的環境變數（compose 會以 `:?required` 擋下）包含
`JWT_SECRET`、`TENANT_SECRET_KEY`、`IDP_SECRET_KEY`、`WEBHOOK_SECRET_KEY`、`OIDC_JWKS`、`OIDC_COOKIE_KEYS`、各組 `POSTGRES_*_PASSWORD`、
`FILE_STORAGE_ACCESS_KEY_ID` / `FILE_STORAGE_SECRET_ACCESS_KEY`、`MAIL_SMTP_URL`、`MAIL_FROM`、
`SUPER_ADMIN_EMAIL`、`PLATFORM_ADMIN_EMAIL`。`api` 與 `external-api` 拿到的變數能不能通過 production 的檢查，
由 `apps/api/src/core/config/__tests__/prod-compose-env.spec.ts` 守住。

`PLATFORM_ADMIN_PASSWORD` 留空時，第一位平台管理者建成 `pending`，`migrate` 的日誌印出一次性的設定連結（1 小時有效，不印密碼）；
過期時重新部署就會換發新的連結。有提供密碼時它必須符合密碼政策，否則 seed 失敗。

```bash
docker compose -f docker-compose.prod.yml up --build
```

- 映像：`apps/api/Dockerfile`、`apps/backstage/Dockerfile`、`apps/platform/Dockerfile`、`apps/file-storage/Dockerfile`；nginx 設定在 `deploy/`
- `REFRESH_COOKIE_PATH` 必須與反向代理對外的前綴一致（預設 `/api/auth`）
- 租戶的網域、佈建與部署細節見 [`docs/architecture/05-tenancy.md`](./docs/architecture/05-tenancy.md)，系統拓撲見 [`docs/architecture/01-system.md`](./docs/architecture/01-system.md) §4
