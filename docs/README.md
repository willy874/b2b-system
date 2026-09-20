# Game Editor — 架構文件

本目錄是 **Game Editor** 的架構規格書。目前專案尚未有主功能，第一階段只建置
**完整的 RBAC（Role-Based Access Control）能力與流程**，作為之後所有功能的地基。

> 狀態：**待確認（Draft）**。程式碼尚未開始撰寫。
> 本文件確認後才進入實作階段（見 [`roadmap.md`](./roadmap.md)）。
> 最後更新：2026-09-19

---

## 1. 這份文件在描述什麼

| 面向     | 決定                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------- |
| 前端架構 | **plugin-based AppContext ＋ feature-first 分層 ＋ 執行期權限註冊表**                          |
| 前端 UI  | **Base UI**（`@base-ui/react`）＋ 專案自有的 `components/` 封裝層                              |
| 後端     | **NestJS** + **Drizzle ORM** + **PostgreSQL**                                                  |
| 首期範圍 | 認證（登入／登出／Token 續期）、使用者、角色、權限、稽核日誌、個人帳號                         |
| 不在首期 | 任何遊戲編輯器本身的功能、資源層級作用域（見 [ADR-0006](./adr/0006-flat-permission-scope.md)） |

---

## 2. 閱讀路徑

**第一次讀（決策者 / Reviewer）**

1. [`00-overview.md`](./00-overview.md) — 目標、範圍、角色定義
2. [`01-technology-selection.md`](./01-technology-selection.md) — 技術選型與理由
3. [`02-architecture.md`](./02-architecture.md) — 系統全貌與資料流
4. [`rbac/01-domain-model.md`](./rbac/01-domain-model.md) — RBAC 領域模型
5. [`roadmap.md`](./roadmap.md) — 實作階段與驗收條件

**要寫前端**

1. [`03-repository-structure.md`](./03-repository-structure.md)
2. [`frontend/01-architecture.md`](./frontend/01-architecture.md)
3. [`frontend/02-plugin-system.md`](./frontend/02-plugin-system.md)
4. [`frontend/03-feature-anatomy.md`](./frontend/03-feature-anatomy.md) ← 新增 feature 的 SOP
5. [`frontend/06-permission.md`](./frontend/06-permission.md)

**要寫後端**

1. [`backend/01-architecture.md`](./backend/01-architecture.md)
2. [`backend/02-database.md`](./backend/02-database.md)
3. [`backend/03-api-conventions.md`](./backend/03-api-conventions.md)
4. [`backend/04-auth.md`](./backend/04-auth.md)
5. [`backend/05-rbac.md`](./backend/05-rbac.md)

---

## 3. 文件地圖

```
docs/
├── README.md                      ← 你在這裡
├── 00-overview.md                 專案總覽、範圍、使用者角色
├── 01-technology-selection.md     技術選型與評估
├── 02-architecture.md             系統架構、部署拓撲、端到端資料流
├── 03-repository-structure.md     monorepo 結構、命名與匯入慣例
├── roadmap.md                     分期實作計畫與驗收條件
│
├── frontend/
│   ├── README.md
│   ├── 01-architecture.md         分層（app / core / features / apis / components / shared / plugins）
│   ├── 02-plugin-system.md        AppContext、plugin 生命週期、註冊時序
│   ├── 03-feature-anatomy.md      feature 資料夾規格 ＋ 新增 feature SOP
│   ├── 04-routing.md              TanStack Router、route 樹、權限 guard
│   ├── 05-data-layer.md           apis/ fetcher ＋ query/mutation ＋ 快取策略
│   ├── 06-permission.md           前端權限：registry、hooks、UI gating
│   ├── 07-ui-system.md            Base UI、元件封裝層、Design Token
│   ├── 08-i18n.md                 語系分包與 scope loader
│   ├── 09-state-and-storage.md    store 分類、持久化、跨分頁同步
│   └── 10-testing.md              Vitest / Testing Library / MSW / Playwright
│
├── backend/
│   ├── README.md
│   ├── 01-architecture.md         NestJS 模組分層與相依方向
│   ├── 02-database.md             Drizzle schema 慣例、migration 流程
│   ├── 03-api-conventions.md      REST、分頁、排序、錯誤碼、驗證
│   ├── 04-auth.md                 登入、JWT、refresh rotation、重用偵測
│   ├── 05-rbac.md                 Guard / Decorator / 權限快取 / 反提權
│   ├── 06-audit-log.md            稽核日誌設計
│   └── 07-testing.md              單元 / 整合 / e2e 測試策略
│
├── rbac/
│   ├── 01-domain-model.md         實體、ER 圖、不變條件
│   ├── 02-permission-catalog.md   權限清單（resource × action）
│   ├── 03-flows.md                登入、授權檢查、角色指派、權限變更生效
│   ├── 04-api-spec.md             RBAC 相關 API 規格
│   └── 05-seed-and-bootstrap.md   預設角色與系統初始化
│
└── adr/                           架構決策紀錄（Architecture Decision Records）
    ├── 0001-plugin-based-app-context.md
    ├── 0002-base-ui-over-mui.md
    ├── 0003-drizzle-over-prisma.md
    ├── 0004-jwt-with-rotating-refresh-token.md
    ├── 0005-permission-resolved-server-side.md
    ├── 0006-flat-permission-scope.md
    └── 0007-openapi-generated-api-sdk.md
```

---

## 4. 文件慣例

- 全文以 **zh-TW** 撰寫；程式碼識別字、路由、權限鍵一律用 `code style` 原文。
- 權限一律寫成 `resource:action`（例如 `role:update`）。
- 使用者故事格式：**「作為 …，我希望 …，以便 …」** ＋ Given / When / Then。
- 任何「為什麼不選 X」的判斷放進 `adr/`，不要散落在規格內文。
- 檔案路徑用相對於 repo 根目錄的形式（`apps/web/src/...`）。

---

## 5. 同步規則（實作開始後生效）

以下三處必須永遠同步，任一處變更時必須同一批修改另外兩處：

1. `apps/web/src/features/<name>/` — 前端功能原始碼
2. `apps/api/src/modules/<name>/` — 後端模組原始碼
3. `docs/` 對應章節 — 規格文件

權限相關的變更額外必須同步：

- `docs/rbac/02-permission-catalog.md`（權限清單）
- `apps/api/src/db/seeds/permissions.ts`（權限種子資料）
- 前端 `features/<name>/permission.ts`（頁面權限註冊）
