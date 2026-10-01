# B2B System

以 Web 為載體的遊戲內容編輯與管理平台。**Phase 0 只建置 RBAC 骨架**，
架構規格見 [`docs/`](./docs/README.md)，實作進度見 [`docs/overview/03-roadmap.md`](./docs/overview/03-roadmap.md)。

## 技術堆疊

| 層 | 選擇 |
| --- | --- |
| 前端 | React 19 + Vite 8 + TanStack Router/Query/Table/Form + Base UI + UnoCSS |
| 後端 | NestJS 11 + Drizzle ORM + PostgreSQL 17 + Zod |
| 工具 | pnpm workspace、TypeScript 6.0、oxlint / oxfmt、lefthook、Vitest、Playwright |

## 從零到跑起來

```bash
# 1. 需求：Node >= 24（`nvm use` 讀 `.nvmrc`）、pnpm 10、Docker（本機資料庫）
corepack enable

# 2. 安裝相依
pnpm install

# 3. 準備環境變數
cp .env.example .env    # JWT_SECRET 請換成 >= 32 字元的隨機值

# 4. 建表 ＋ 灌入權限目錄、系統角色與初始 super-admin
pnpm db:up
pnpm db:migrate
pnpm db:seed          # 首次會印出 super-admin 的密碼（只印這一次）

# 5. 啟動（postgres + api:3000 + backstage:5173）
pnpm dev
```

開啟 http://localhost:5173 。API 文件在 http://localhost:3000/docs（僅非 production）。

## 常用指令

| 指令 | 作用 |
| --- | --- |
| `pnpm dev` / `pnpm dev:api` / `pnpm dev:backstage` | 開發模式 |
| `pnpm build` | 依序建置 api-sdk → api → backstage |
| `pnpm lint` / `pnpm format` / `pnpm format:check` / `pnpm typecheck` | 全 workspace 檢查 |
| `pnpm test` | 單元測試（apps/api、apps/backstage） |
| `pnpm test:e2e` | Playwright（首次需 `pnpm --filter @b2b-system/e2e install:browsers`） |
| `pnpm db:up` / `pnpm db:down` | 啟停本機 PostgreSQL |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:studio` | 資料庫 |
| `pnpm db:seed:dev` | 50 位假使用者、5 個自訂角色、300 筆稽核日誌（固定亂數種子） |
| `pnpm db:seed:e2e` | E2E 用的固定帳號（`e2e-*@dev.local`，密碼 `E2E!Password123`） |
| `pnpm db:reset` | 清空所有業務資料（保留 schema） |
| `pnpm dev:e2e` | 以放寬的速率限制啟動 api（跑 E2E 前用這個代替 `pnpm dev:api`） |
| `pnpm sdk:generate` | 由 `apps/api/openapi.json` 產生 `packages/api-sdk` |

## 專案結構

```
apps/backstage     React 前端（feature-first + plugin-based AppContext）
apps/api     NestJS 後端（modules / core / common / db）
apps/e2e     Playwright
packages/api-sdk   由 OpenAPI 產生的型別與 client（後端是唯一事實來源）
docs/        架構規格（唯一事實來源，改程式必須同步改文件）
```

詳細佈局見 [`docs/architecture/02-repository-structure.md`](./docs/architecture/02-repository-structure.md)，寫程式規範見 [`docs/conventions/`](./docs/conventions/README.md)。

## 測試

```bash
pnpm test        # 單元 ＋ 整合（後端整合測試會用 Testcontainers 起一個 postgres）
pnpm test:e2e    # Playwright：需要 api 與 backstage 已啟動，且 DB 有 E2E 帳號
```

E2E 的完整前置：

```bash
pnpm db:reset && pnpm db:seed && pnpm db:seed:e2e
pnpm dev:e2e      # 另一個終端機：api（放寬速率限制）
pnpm dev:backstage      # 另一個終端機
pnpm test:e2e
```

## 部署

`docker-compose.prod.yml` 是最小可執行的拓撲：nginx（靜態檔 ＋ `/api` 反向代理）
→ api → postgres。

```bash
POSTGRES_PASSWORD=... JWT_SECRET=... SUPER_ADMIN_EMAIL=... \
  docker compose -f docker-compose.prod.yml up --build
```

- 前端映像：`apps/backstage/Dockerfile`（多階段 build → nginx，設定見 `deploy/nginx.conf`）
- 後端映像：`apps/api/Dockerfile`（多階段 build → `node dist/main.js`）
- `REFRESH_COOKIE_PATH` 必須與反向代理對外的前綴一致（預設 `/api/auth`）
