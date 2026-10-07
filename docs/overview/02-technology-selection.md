# 技術選型

這份文件回答「用了什麼、為什麼是它」。每一項的細節與被否決的方案，寫在對應規格最後的「設計決策」章節；這裡只留結論與一句理由。

選型的原則有三條：

1. **少一個服務就少一個故障點。** 佇列、跨程序廣播、權限關係圖都放在 PostgreSQL 上，沒有 Redis、沒有外部授權服務。
   只有在 Postgres 確定撐不住時才加元件（[`features/multi-instance.md`](../features/multi-instance.md)）。
2. **型別從一個地方來。** 資料表的型別來自 Drizzle schema，請求的型別來自 Zod schema，前端的 API 型別與權限鍵來自後端產生的 OpenAPI。
3. **前端架構沿用驗證過的設計。** plugin-based AppContext ＋ feature-first 分層 ＋ 執行期權限註冊表，來自一套規模相近、同樣以 RBAC 為核心的產品；重新發明沒有收益。

---

## 1. 總覽

| 層 | 選擇 | 版本 |
| --- | --- | --- |
| 執行環境 | Node.js | 24（`.nvmrc`） |
| 套件管理 | pnpm workspace | 10 |
| 語言 | TypeScript（strict） | 6.0 |
| 後端框架 | NestJS | 12 |
| ORM 與 migration | Drizzle ORM ＋ drizzle-kit | 0.45 ／ 0.31 |
| 資料庫 | PostgreSQL | 17 |
| 驗證 | Zod（後端經自訂 `ZodValidationPipe`；前端表單與網址參數也用） | 4 |
| API 文件與 SDK | `@nestjs/swagger` → `openapi.json` → `packages/api-sdk` | — |
| 身分 | `oidc-provider`（OpenID 認證過的 OIDC Provider）、`jose` | 9 ／ 6 |
| 密碼雜湊 | Argon2id（`@node-rs/argon2`） | — |
| 背景工作 | pg-boss（佇列放在平台 DB） | 12 |
| 即時推播 | Socket.io | 4 |
| 物件儲存 | S3 API（`@aws-sdk/client-s3`）；開發用自帶的 `apps/file-storage` | — |
| 影像處理 | sharp | 0.35 |
| 郵件 | nodemailer ＋ React Email 範本；開發用 Mailpit | — |
| 日誌 | Pino | 10 |
| 前端框架 | React | 19 |
| 前端建置 | Vite | 8 |
| 路由 | TanStack Router（code-based） | 1 |
| 伺服器狀態 | TanStack Query | 5 |
| 表格 | TanStack Table ＋ TanStack Virtual | 9 ／ 3 |
| 表單 | TanStack Form | 1 |
| UI 行為層 | Base UI（`@base-ui/react`） | 1.8 |
| 樣式 | UnoCSS（`preset-wind4`）＋ CSS 變數的 Design Token | 66 |
| 程式碼編輯器 | CodeMirror 6 | 6 |
| 圖與樹狀圖 | React Flow（`@xyflow/react`）＋ dagre | 12 ／ 3 |
| i18n | i18next（不用 react-i18next，自有 hook 薄封裝） | 26 |
| 單元與元件測試 | Vitest ＋ Testing Library ＋ MSW | 5 ／ 16 ／ 3 |
| 後端整合測試 | Vitest ＋ Testcontainers（PostgreSQL） | — |
| E2E | Playwright | 1.63 |
| 元件文件 | Storybook | 10 |
| Lint ／ Format ／ Git hook | oxlint ／ oxfmt ／ lefthook | — |

---

## 2. 後端

### 2.1 NestJS

- DI 容器與 `APP_GUARD` 讓「每個路由都要被授權」可以全域強制，不靠每個人記得加 guard。
  啟動時的路由稽核（`common/route-audit.ts`）也靠 Nest 的 metadata 掃描路由。
- Decorator metadata 是宣告式權限（`@RequirePermissions('role:update')`）最自然的載體。
- `@nestjs/swagger` 讓 OpenAPI 幾乎零成本，再餵給前端的 SDK 產生器。

### 2.2 Drizzle，而不是 Prisma／TypeORM

| 維度 | Drizzle | Prisma | TypeORM |
| --- | --- | --- | --- |
| Schema | TypeScript（就是程式碼） | 自有 DSL（`.prisma`） | class 上的 decorator |
| 型別 | 從 schema 推導，不必產生 | 要 `prisma generate` | 弱 |
| SQL 掌控度 | 高，貼近 SQL | 低 | 中 |
| 關係圖查詢（遞迴 CTE、`EXISTS`） | 直接寫 | 多半要 `$queryRaw` | 易踩坑 |
| 執行期負擔 | 純 JS | 另有 engine | 反射開銷 |

權限關係圖的解析是遞迴 CTE，回收桶與版本歷史依賴 partial unique index 與交易內的條件式更新，這些在 Drizzle 都是一句可讀的 SQL。
見 [`architecture/backend/02-database.md`](../architecture/backend/02-database.md)。

### 2.3 PostgreSQL 一個就好

Postgres 在這個專案身兼五職，每一項都省掉一個外部服務：

| 用途 | 做法 | 省掉的元件 |
| --- | --- | --- |
| 業務資料 | 每個租戶一個 database（[`architecture/05-tenancy.md`](../architecture/05-tenancy.md)） | — |
| 權限關係圖 | `relation_tuples` ＋ 遞迴 CTE（[`iam/01-model.md`](../architecture/iam/01-model.md) §9） | OpenFGA／SpiceDB |
| 佇列與排程 | pg-boss（[`architecture/backend/10-jobs.md`](../architecture/backend/10-jobs.md)） | Redis ＋ BullMQ |
| 跨程序廣播 | `LISTEN`／`NOTIFY`（[`architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §5.2） | Redis pub/sub |
| 稽核不可竄改 | DB 角色只有 INSERT／SELECT ＋ trigger（[`architecture/backend/06-audit-log.md`](../architecture/backend/06-audit-log.md)） | — |

最關鍵的一點是 **稽核、授權、業務寫入在同一個交易**。外部授權服務或外部佇列都會把它變成雙寫問題。

### 2.4 Zod，而不是 class-validator

`class-validator` 要寫一份型別、再寫一份 decorator。Zod 的 schema 同時是型別來源（`z.infer`）與執行期驗證，
前後端用同一套寫法；`core/validation/zod-openapi.ts` 讓 schema 直接出現在 Swagger 文件。

### 2.5 自己當 OIDC Provider

登入集中在 `apps/platform`，`apps/api` 用 `oidc-provider` 當 OIDC Provider，每個後台都是它的 client（授權碼 ＋ PKCE ＋ BFF）。
選它而不是自寫，是因為它通過 OpenID 認證，協定細節（PKCE、refresh、單一登出）不必自己對。
不用 Keycloak 之類的獨立 IdP，是因為租戶、使用者、稽核都在我們自己的資料庫，外部 IdP 又會變成兩份帳號。
見 [`architecture/04-sso.md`](../architecture/04-sso.md)。

---

## 3. 前端

### 3.1 為什麼採用這套架構

1. **Plugin-based AppContext**：`main.tsx` 用 `context.use(...).use(...).load()` 串起所有能力與 feature。
   新增或拿掉一個 feature 就是增刪一行，`core/` 不認識任何 feature；租戶停用某個功能時，plugin 也能在執行期卸載。
   見 [`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md)。
2. **Feature-first 分層**：每個 feature 自帶路由、頁面、hooks、語系包與權限宣告；跨 feature 的能力才往 `core/`、`@b2b-system/web-shared` 提。
3. **執行期權限註冊表**：`core/permission` 沒有一張列舉所有頁面的靜態表，每個 feature 在自己的 `permission.ts` 註冊。
4. **API 層與 UI 層解耦**：`src/apis/<domain>/<operation>/` 是唯一與後端對話的地方，頁面只認識 query options；
   mutation 之後由資源依賴圖決定要失效哪些查詢（[`frontend/05-data-layer.md`](../architecture/frontend/05-data-layer.md)）。

### 3.2 Base UI，而不是 MUI

| 維度 | MUI | Base UI |
| --- | --- | --- |
| 樣式 | 內建 Emotion 與主題系統 | 完全無樣式 |
| 可近性 | 良好 | 良好（焦點管理、ARIA、彈層定位是它唯一的產品） |
| bundle | 大 | 小，只有行為與狀態機 |
| 客製 | 要對抗既有樣式 | 從零寫，沒有對抗成本 |
| 與 UnoCSS | 兩套樣式引擎 | 直接給 `className` |

通用型後台的業務功能會長出大量非標準介面（關係圖、樹狀編輯器、差異檢視、檔案管理器），一套 opinionated 的設計系統在這裡是負擔。
代價是設計系統（`packages/ui/src/components/`）這層要自己寫完整的樣式；目前約 40 個元件，各有測試與 Storybook story。
Base UI 的 Select 無法虛擬捲動，所以 Select／Menu 改成 Popover 加自製列表（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.10）。

### 3.3 TanStack Router 用 code-based

feature 要 **自己擁有** route 物件（`features/role/routes/pages.ts`），因為 `permission.ts` 要從 route 物件讀 base path 註冊頁面權限、
通知要以 route id 產生連結（[`frontend/15-notification.md`](../architecture/frontend/15-notification.md)）。
file-based routing 把 route 的所有權交給檔案系統，feature 就無法自我描述。

### 3.4 狀態放哪裡

| 類型 | 去處 | 例 |
| --- | --- | --- |
| 伺服器狀態 | TanStack Query | 使用者列表、角色詳情 |
| 全域 UI 與會話 | `@b2b-system/web-shared/store` 的 signal store | 權限集合、側邊選單開合、語系、主題 |
| 網址狀態 | TanStack Router `validateSearch`（Zod） | 分頁、篩選、排序 |

權限集合放在 store 而不是 Query：幾乎每個元件都要 **同步** 讀它（`can(key)` 不能是非同步）。

### 3.5 主題

Design Token 分 seed／alias／component 三層，深色主題只覆寫 alias 層。`contrast.test.ts` 對兩個主題各驗 WCAG 對比，
`theme-init.js` 在首次繪製前決定主題，不閃白。見 [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §4。

---

## 4. 前後端契約

**後端是唯一事實來源。**

```
apps/api ──(@nestjs/swagger)──▶ openapi.json ──(codegen)──▶ packages/api-sdk ──▶ apps/backstage、apps/platform
                             └─▶ openapi.external.json（對外 API 的 /v1，給整合方）
```

權限鍵 `PermissionKey` 定義在後端，經 OpenAPI 傳到 `packages/api-sdk`，前端只做重新匯出，兩邊永遠不會對「有哪些權限」有分歧。
改動 controller、DTO 或權限鍵後，依 `CLAUDE.md`「常用指令」重新產生 OpenAPI 與 SDK。
見 [`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §12、[`architecture/06-external-api.md`](../architecture/06-external-api.md)。

---

## 5. 開發工具鏈

| 用途 | 工具 |
| --- | --- |
| Lint ／ Format | oxlint ／ oxfmt（比 ESLint、Prettier 快一個量級） |
| Git hook | lefthook（pre-commit：format ＋ lint staged 檔） |
| 型別檢查 | `tsc -b`（每個 package 各自的 project reference） |
| 本機服務 | `docker compose`：PostgreSQL 17、Mailpit（:8025） |
| Migration | `drizzle-kit generate`；平台 DB 與每個租戶 DB 由 `pnpm db:migrate` 一起套用 |
| API 文件 | `http://localhost:3000/docs`（Swagger UI，只在 dev） |
| 模擬外部 IdP | `pnpm dev:mock-idp`（:4455） |
| 功能導覽截圖 | `pnpm --filter @b2b-system/e2e tour`（[`05-feature-tour.md`](./05-feature-tour.md)） |
