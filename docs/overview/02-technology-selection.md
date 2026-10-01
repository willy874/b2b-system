# 技術選型

選型的第一原則：**前端整體架構沿用一套已在規模相近、同樣以 RBAC 為核心的產品上
驗證過的設計**——plugin-based AppContext ＋ feature-first 分層 ＋ 執行期權限註冊表
——重新發明沒有收益。UI 函式庫則改用 Base UI。後端為全新選型。

---

## 1. 總覽

| 層         | 選擇                                                   | 版本基準         |
| ---------- | ------------------------------------------------------ | ---------------- |
| 套件管理   | pnpm workspace                                         | pnpm 10.x        |
| 語言       | TypeScript（strict）                                   | 6.0+             |
| 前端框架   | React                                                  | 19.x             |
| 前端建置   | Vite                                                   | 7.x / 8.x        |
| 前端路由   | TanStack Router（code-based）                          | 1.13x            |
| 前端資料層 | TanStack Query                                         | 5.x              |
| 前端表格   | TanStack Table + TanStack Virtual                      | 9.x / 3.x        |
| 前端表單   | TanStack Form                                          | 1.x              |
| 前端 UI    | **Base UI**（`@base-ui/react`）                         | 1.x              |
| 樣式       | UnoCSS（`preset-wind4`）＋ CSS 變數 Design Token       | 66.x             |
| 前端狀態   | 自有輕量 store（`shared/store`）＋ TanStack Query 快取 | —                |
| i18n       | i18next（無 react-i18next，自有 hook 薄封裝）          | 26.x             |
| 驗證       | Zod                                                    | 4.x              |
| 前端測試   | Vitest + Testing Library + MSW                         | 5.x / 16.x / 3.x |
| E2E        | Playwright                                             | 1.5x             |
| 後端框架   | **NestJS**                                             | 12.x             |
| 後端 ORM   | **Drizzle ORM** + drizzle-kit                          | 0.44+            |
| 資料庫     | **PostgreSQL**                                         | 16 / 17          |
| 後端驗證   | Zod（透過自訂 `ZodValidationPipe`）                    | 4.x              |
| API 文件   | `@nestjs/swagger` → OpenAPI 3.0 → 產生前端 SDK         | 12.x             |
| 密碼雜湊   | Argon2id（`@node-rs/argon2`）                          | —                |
| 後端測試   | Vitest + Testcontainers（PostgreSQL）                  | —                |
| 程式碼風格 | oxlint + oxfmt                                         | —                |

---

## 2. 前端

### 2.1 為什麼採用這套架構

它有四個值得保留的核心決定：

1. **Plugin-based AppContext**
   `main.tsx` 把所有能力（快取、事件匯流排、i18n、HTTP、各 feature）串成
   `context.use(...).use(...).load()`。新增或拿掉一個 feature 就是增刪一行，
   `core/` 不需要認識任何 feature。詳見
   [ADR-0001](../adr/0001-plugin-based-app-context.md)。

2. **Feature-first 分層**
   每個 feature 是自給自足的資料夾：自己的路由、頁面、hooks、語系包、
   權限宣告。跨 feature 的共用能力才往 `core/` 或 `shared/` 提。

3. **執行期權限註冊表**
   `core/permission/registry.ts` 沒有一張列舉所有頁面的靜態表；每個 feature
   在自己的 `permission.ts` 註冊。核心不認識功能，功能也不必改核心。

4. **API 層與 UI 層完全解耦**
   `src/apis/<domain>/<operation>/{fetcher,query|mutation}.ts` 是唯一與後端
   對話的地方；頁面只認識 query options，不認識 HTTP。

### 2.2 為什麼是 Base UI 而不是 MUI

| 維度           | MUI                        | Base UI                                 |
| -------------- | -------------------------- | --------------------------------------- |
| 樣式           | 內建 Emotion + theme 系統  | **完全無樣式（unstyled）**              |
| 可近性         | 良好                       | 良好（同團隊，ARIA 行為是它唯一的產品） |
| bundle         | 大（含樣式引擎與整套設計） | 小，只有行為與狀態機                    |
| 客製成本       | 需要對抗既有樣式           | 從零寫，但沒有對抗成本                  |
| 與 UnoCSS 搭配 | 衝突（兩套樣式引擎）       | **天然契合**（`className` 直接給）      |

B2B System 會有大量非標準 UI（畫布、屬性面板、時間軸），一套 opinionated 的
設計系統在這種場景是負擔而不是助力。Base UI 提供的是 **行為與可近性**，
外觀完全由我們的 Design Token 決定。詳見
[ADR-0002](../adr/0002-base-ui-over-mui.md)。

> 影響：`apps/backstage/src/components/` 這層封裝會比搭配 MUI 時更重要也更厚。搭 MUI 時
> `components/Select` 只是 MUI Select 的薄包裝；我們的 `components/Select` 會是
> Base UI primitive ＋ 我們自己的完整樣式。這是有意的成本。

### 2.3 為什麼 TanStack Router 用 code-based 而非 file-based

Feature 需要 **自己擁有** 它的 route 物件（`features/role/routes/pages.ts`），
因為 `permission.ts` 要從 route 物件讀出 base path 來註冊。file-based routing
會把 route 的所有權交給檔案系統，feature 就無法自我描述。

### 2.4 狀態管理

三類狀態，三個去處，不混用：

| 類型               | 去處                                    | 例                                 |
| ------------------ | --------------------------------------- | ---------------------------------- |
| 伺服器狀態         | TanStack Query                          | 使用者列表、角色詳情               |
| 全域 UI / 會話狀態 | `shared/store` 建立的 signal store      | 權限集合、側邊選單開合、語系、時區 |
| 網址狀態           | TanStack Router `validateSearch`（Zod） | 分頁、篩選、排序                   |

**權限集合放在 store 而不是 Query**：它是整個 App 的前置條件，幾乎每個元件都要
讀，且需要同步讀取（`can(key)` 不能是非同步）。

---

## 3. 後端

### 3.1 為什麼是 NestJS

- DI 容器與模組邊界讓「權限 Guard 必須被套用」這種橫切關注點可以用
  `APP_GUARD` 全域強制，而不是靠每個開發者記得加。
- Decorator metadata（`Reflector`）是宣告式權限（`@RequirePermissions('role:update')`）
  最自然的載體。
- 與 `@nestjs/swagger` 的整合讓 OpenAPI 幾乎零成本，進而餵給前端 SDK 產生器。

### 3.2 為什麼是 Drizzle 而不是 Prisma / TypeORM

| 維度          | Drizzle                        | Prisma                       | TypeORM            |
| ------------- | ------------------------------ | ---------------------------- | ------------------ |
| Schema 定義   | TypeScript（就是程式碼）       | 自有 DSL（`.prisma`）        | Decorator on class |
| 型別推導      | 從 schema 直接推導，零產生步驟 | 需要 `prisma generate`       | 弱                 |
| SQL 掌控度    | 高，貼近 SQL                   | 低（查詢引擎在 Rust binary） | 中                 |
| RBAC 常見查詢 | 多表 join + `EXISTS` 好寫      | 巢狀 include 會 N+1          | 易踩坑             |
| 執行期負擔    | 純 JS，無額外 binary           | Rust engine binary           | 反射開銷           |

RBAC 的核心查詢是「給我這個 user 透過所有 role 間接持有的 permission key 集合」，
那是一個三表 join + distinct。Drizzle 讓這段是一句可讀的 SQL；Prisma 需要
兩次查詢或一段 `$queryRaw`。詳見 [ADR-0003](../adr/0003-drizzle-over-prisma.md)。

### 3.3 為什麼是 PostgreSQL

- `citext` / `CHECK` / partial index / `gen_random_uuid()` 這些 RBAC 會用到的
  東西都是原生能力。
- 稽核日誌之後要做時間分區（`PARTITION BY RANGE`），Postgres 原生支援。
- 未來若加上資源作用域，`jsonb` + GIN index 可以在不改表結構的前提下先跑。

### 3.4 驗證：Zod 而非 class-validator

NestJS 預設的 `class-validator` 依賴 decorator metadata，型別與驗證是兩份宣告。
Zod 讓 schema 同時是型別來源（`z.infer`）與執行期驗證，且與前端共用同一套心智
模型（前端的 `validateSearch` 也是 Zod）。透過自訂 `ZodValidationPipe` 接進
NestJS，再用 `zod-openapi` 讓 schema 自動出現在 Swagger 文件裡。

---

## 4. 前後端契約

**後端是唯一事實來源。**

```
apps/api  ──(@nestjs/swagger)──▶  openapi.json
                                       │
                                       ▼ (packages/api-sdk/codegen)
                            packages/api-sdk  ──▶  apps/backstage
```

`PermissionKey` 這個 enum 定義在後端，經由 OpenAPI 傳到 `packages/api-sdk`，
前端的 `core/permission/enums.ts` 只是對它做一層重新匯出，確保前後端永遠不會對
「有哪些權限」有分歧。詳見
[ADR-0007](../adr/0007-openapi-generated-api-sdk.md)。

---

## 5. 主題

Phase 0 **只做 Light Mode**，但 Design Token 一開始就分成 seed / alias / component
三層，dark 模式只需要新增一份 alias 對照表即可補上。取捨在於：雙模式的製作與
驗證（對比度）成本高，先把可延伸性做出來、不急著做第二套值。

---

## 6. 開發工具鏈

| 用途       | 工具                                                      |
| ---------- | --------------------------------------------------------- |
| Lint       | `oxlint`（比 ESLint 快一個量級，規則覆蓋足夠）            |
| Format     | `oxfmt`                                                   |
| Git hook   | `lefthook`（pre-commit：format + lint staged 檔）         |
| 本機資料庫 | `docker compose up postgres`                              |
| Migration  | `drizzle-kit generate` / `drizzle-kit migrate`            |
| API 文件   | `http://localhost:3000/docs`（Swagger UI，僅 dev）        |
| 型別檢查   | `tsc -b --noEmit`（每個 package 各自的 tsconfig project） |
