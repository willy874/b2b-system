# B2B System — 架構文件

本目錄是 **B2B System** 的架構規格書。B2B System 是一套 **通用型的多租戶 B2B 後台**：
不綁定任何業務領域，先把每個後台都需要的基礎能力（身分、權限、稽核、檔案、背景工作、通知）做成
會被強制使用的機制，之後的業務功能都建立在它上面。

> 狀態：Phase 0（RBAC 骨架）已完成，之後陸續加入 SSO、多租戶、群組與關係圖、回收桶與版本歷史、站內通知等通用機制。
> 進度見 [`overview/03-roadmap.md`](./overview/03-roadmap.md)，待製作的功能見 [`features/README.md`](./features/README.md)。
> 最後更新：2026-10-01

---

## 1. 這份文件在描述什麼

| 面向     | 決定                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------- |
| 定位     | 通用型後台骨架；業務功能以 feature（前端）＋ module（後端）的形式加上去，沿用既有的權限、稽核、回收桶、通知等機制 |
| 前端架構 | **plugin-based AppContext ＋ feature-first 分層 ＋ 執行期權限註冊表**                          |
| 前端 UI  | **Base UI**（`@base-ui/react`）＋ 專案自有的 `components/` 封裝層                              |
| 後端     | **NestJS** + **Drizzle ORM** + **PostgreSQL**                                                  |
| 租戶與身分 | 每個租戶一個 database 與網域；`apps/auth` 是全平台共用的登入入口，`apps/api` 當 OIDC Provider |
| 已有範圍 | 認證與 SSO、使用者、角色、群組、權限與關係圖、稽核日誌、個人帳號、審批、系統設定、檔案、背景工作、寄信、回收桶、版本歷史、站內通知 |
| 不在範圍 | 任何特定領域的業務功能；資源層級作用域目前只用在檔案管理器，新資源沿用同一套（見 [ADR-0015](./adr/0015-file-folder-access.md)、[`rbac/07-resource-grants.md`](./rbac/07-resource-grants.md)） |

---

## 2. 閱讀路徑

**第一次讀（決策者 / Reviewer）**

想先快速了解專案，讀 [`overview/04-introduction.md`](./overview/04-introduction.md)：各機制處理的邊際情況、與常見後台的差異，附截圖。

1. [`overview/01-overview.md`](./overview/01-overview.md) — 目標、範圍、角色定義
2. [`overview/02-technology-selection.md`](./overview/02-technology-selection.md) — 技術選型與理由
3. [`architecture/01-system.md`](./architecture/01-system.md) — 系統全貌與資料流
   （登入與身分見 [`architecture/04-sso.md`](./architecture/04-sso.md)；每個租戶一個 database 與網域見 [`architecture/05-tenancy.md`](./architecture/05-tenancy.md)）
4. [`rbac/01-domain-model.md`](./rbac/01-domain-model.md) — RBAC 領域模型與關係圖（§6.4）
5. [`overview/03-roadmap.md`](./overview/03-roadmap.md) — 實作階段與驗收條件

**開始寫程式之前（所有人）**

1. [`conventions/README.md`](./conventions/README.md) — 寫程式規範總覽
2. [`conventions/01-general.md`](./conventions/01-general.md) — TypeScript、命名、匯入、錯誤處理
3. [`conventions/05-git.md`](./conventions/05-git.md) — branch、commit、PR 檢查清單

**要寫前端**

1. [`architecture/02-repository-structure.md`](./architecture/02-repository-structure.md)
2. [`architecture/frontend/01-architecture.md`](./architecture/frontend/01-architecture.md)
3. [`architecture/frontend/02-plugin-system.md`](./architecture/frontend/02-plugin-system.md)
4. [`architecture/frontend/03-feature-anatomy.md`](./architecture/frontend/03-feature-anatomy.md) ← 新增 feature 的 SOP
5. [`architecture/frontend/06-permission.md`](./architecture/frontend/06-permission.md)
6. [`conventions/02-frontend.md`](./conventions/02-frontend.md)

**要寫後端**

1. [`architecture/backend/01-architecture.md`](./architecture/backend/01-architecture.md)
2. [`architecture/backend/02-database.md`](./architecture/backend/02-database.md)
3. [`architecture/backend/03-api-conventions.md`](./architecture/backend/03-api-conventions.md)
4. [`architecture/backend/04-auth.md`](./architecture/backend/04-auth.md)
5. [`architecture/backend/05-rbac.md`](./architecture/backend/05-rbac.md)
6. [`conventions/03-backend.md`](./conventions/03-backend.md)

---

## 3. 文件地圖

```
docs/
├── README.md                          ← 你在這裡
│
├── overview/                          為什麼做、做什麼、何時做
│   ├── 01-overview.md                 專案總覽、範圍、使用者角色
│   ├── 02-technology-selection.md     技術選型與評估
│   ├── 03-roadmap.md                  分期實作計畫與驗收條件
│   └── 04-introduction.md             專案介紹：邊際情況的處理、與常見後台的對照（截圖在 images/introduction/）
│
├── architecture/                      系統長什麼樣子（規格）
│   ├── 01-system.md                   系統架構、部署拓撲、端到端資料流
│   ├── 02-repository-structure.md     monorepo 結構、目錄佈局、環境變數
│   ├── 03-file-storage.md             apps/file-storage：S3 相容的本機檔案儲存
│   ├── 04-sso.md                      SSO：apps/api 當 OIDC Provider、apps/auth、外部 IdP、單一登出
│   ├── 05-tenancy.md                  租戶：每個租戶一個 database 與網域、佈建與生命週期、部署
│   │
│   ├── frontend/
│   │   ├── README.md
│   │   ├── 01-architecture.md         分層（app / core / features / apis / components / shared / plugins）
│   │   ├── 02-plugin-system.md        AppContext、plugin 生命週期、註冊時序
│   │   ├── 03-feature-anatomy.md      feature 資料夾規格 ＋ 新增 feature SOP
│   │   ├── 04-routing.md              TanStack Router、route 樹、權限 guard
│   │   ├── 05-data-layer.md           apis/ fetcher ＋ query/mutation ＋ 快取策略
│   │   ├── 06-permission.md           前端權限：registry、hooks、UI gating
│   │   ├── 07-ui-system.md            Base UI、元件封裝層、Design Token
│   │   ├── 08-i18n.md                 語系分包與 scope loader
│   │   ├── 09-state-and-storage.md    store 分類、持久化、跨分頁同步
│   │   ├── 10-testing.md              Vitest / Testing Library / MSW / Playwright
│   │   ├── 11-realtime.md             Socket.io、leader 分頁持有連線、推播 → 快取失效
│   │   ├── 12-file-manager.md         檔案管理器：排版、選取、上傳佇列、預覽擴充點
│   │   ├── 13-trash.md                回收桶頁：類型註冊表、權限、使用者、角色、檔案與資料夾的還原
│   │   ├── 14-revisions.md            版本紀錄：版本列表、與目前或前一版的差異、還原到某一版（角色）
│   │   └── 15-notification.md         站內通知：頂列鈴鐺、列表頁、route id 註冊表（core/route-link）、事件管理頁
│   │
│   └── backend/
│       ├── README.md
│       ├── 01-architecture.md         NestJS 模組分層與相依方向
│       ├── 02-database.md             Drizzle schema 慣例、migration 流程
│       ├── 03-api-conventions.md      REST、分頁、排序、錯誤碼、驗證
│       ├── 04-auth.md                 登入、JWT、refresh rotation、重用偵測、SSO 的後端部分
│       ├── 05-rbac.md                 Guard / Decorator / 關係圖引擎 / 權限快取與 revision 失效 / 反提權
│       ├── 06-audit-log.md            稽核日誌設計
│       ├── 07-testing.md              單元 / 整合 / e2e 測試策略
│       ├── 08-realtime.md             Socket.io gateway、room 與受眾、推播時機
│       ├── 09-file.md                 檔案模組：物件儲存抽象層、上傳流程（含分塊）、keyset 分頁
│       ├── 10-jobs.md                 背景工作：pg-boss 佇列、排程、重試、管理 API
│       ├── 11-mail.md                 郵件：傳輸層、範本、寄送流程、Mailpit
│       ├── 12-settings.md             系統設定：執行期可調的值（租戶 DB）、env 與設定的分工
│       ├── 13-trash.md                回收桶：TrashRegistry、還原端點、trash.purge 與外鍵處理
│       ├── 14-revisions.md            版本歷史：revisions、RevisionService、還原到某一版、revision.prune
│       ├── 15-notification.md         站內通知：notifications、NotificationService.notify、收件人計算、route id、notification.cleanup
│       └── 16-notification-event.md   事件管理：事件目錄、租戶層的開關、個人的通知設定
│
├── rbac/
│   ├── 01-domain-model.md             實體、ER 圖、不變條件、關係圖的組成與模型
│   ├── 02-permission-catalog.md       權限清單（resource × action）、權限依賴樹（§9）
│   ├── 03-flows.md                    登入、授權檢查、角色指派、權限變更生效
│   ├── 04-api-spec.md                 RBAC 相關 API 規格
│   ├── 05-seed-and-bootstrap.md       預設角色與系統初始化
│   ├── 06-approval.md                 審批：請求 → 核准 → 套用；使用者註冊
│   ├── 07-resource-grants.md          資源授權：資料夾層級（等級、繼承、擁有者規則；關係圖上的模型）
│   ├── 08-groups.md                   群組：巢狀成員、群組持有角色、反提權、資料夾授權給群組
│   └── 09-explain.md                  授權的說明：有效權限的來源、資料夾存取的路徑、遮蔽規則
│
├── conventions/                       寫程式時每天要遵守的規則
│   ├── README.md                      規則強度標記（🔒 工具 / 👀 Review）
│   ├── 01-general.md                  TypeScript、命名、匯入、註解、錯誤處理
│   ├── 02-frontend.md                 前端分層規則、feature / 元件 / hook / 樣式
│   ├── 03-backend.md                  後端分層規則、各層寫法、錯誤、DB
│   ├── 04-testing.md                  測試位置、命名、寫法、何時必寫
│   ├── 05-git.md                      branch、commit message、PR 檢查清單
│   ├── 06-literal-strings.md          i18n key / className / testid 不得以模板組成
│   └── 07-layer-dependencies.md       package 與資料夾的層級依賴矩陣
│
├── features/                          待製作功能的提案（完成後刪除、重寫成正式文件歸檔）
│   └── README.md                      清單、優先度、提案 → 歸檔的流程
│
└── adr/                               架構決策紀錄（Architecture Decision Records；見 §4 最後一條）
    ├── 0001-plugin-based-app-context.md
    ├── 0002-base-ui-over-mui.md
    ├── 0003-drizzle-over-prisma.md
    ├── 0004-jwt-with-rotating-refresh-token.md
    ├── 0005-permission-resolved-server-side.md
    ├── 0006-flat-permission-scope.md
    ├── 0007-openapi-generated-api-sdk.md
    ├── 0008-realtime-with-socket-io.md
    ├── 0009-table-batch-operations.md
    ├── 0010-self-built-json-editor.md
    ├── 0011-codemirror-json-editor.md
    ├── 0012-batch-queue-worker.md
    ├── 0013-file-manager-upload.md
    ├── 0014-server-image-variants.md
    ├── 0015-file-folder-access.md
    ├── 0016-background-jobs.md
    ├── 0017-mail-delivery.md
    ├── 0018-workspace-tenancy.md
    ├── 0019-sso-identity-platform.md
    ├── 0020-physical-tenant-isolation.md
    ├── 0021-runtime-feature-activation.md
    ├── 0022-feature-flags.md
    ├── 0023-react-flow-tree-editor.md
    ├── 0024-relationship-based-access-control.md
    ├── 0025-entity-revisions.md
    ├── 0026-notification-center.md
    ├── 0027-api-tokens-external-api.md
    └── 0028-notification-event-management.md
```

---

## 4. 文件慣例

- 全文以 **zh-TW** 撰寫；程式碼識別字、路由、權限鍵一律用 `code style` 原文。
- 權限一律寫成 `resource:action`（例如 `role:update`）。
- 使用者故事格式：**「作為 …，我希望 …，以便 …」** ＋ Given / When / Then。
- 任何「為什麼不選 X」的判斷放進 `adr/`，不要散落在規格內文。
- 分區原則：`overview/` 講目標與計畫、`architecture/` 講系統設計、`rbac/` 講領域規格、
  `conventions/` 講寫程式規則、`adr/` 講決策理由。新文件依此歸位。
- **還沒實作的功能** 寫在 `features/`，不要寫進上述分區；那些分區只描述已存在的系統。
  流程見 [`features/README.md`](./features/README.md)。
- 檔案路徑用相對於 repo 根目錄的形式（`apps/backstage/src/...`）。
- 舉例時用 **領域中立** 的名詞（專案、文件、訂單、素材），不要假設某個特定產業。
- `adr/` 是當時的決策紀錄，**不回頭改寫**。本專案早期的定位是遊戲內容編輯平台，部分 ADR 的「背景」
  仍以「遊戲編輯器」為例；那些理由同樣適用於任何會長出自訂資源與大量編輯介面的業務功能。
  決策本身若被推翻，寫新的 ADR 取代它。

---

## 5. 同步規則

以下三處必須永遠同步，任一處變更時必須同一批修改另外兩處：

1. `apps/backstage/src/features/<name>/`（平台層級的頁面在 `apps/auth/src/features/<name>/`）— 前端功能原始碼
2. `apps/api/src/modules/<name>/` — 後端模組原始碼
3. `docs/` 對應章節 — 規格文件

權限相關的變更額外必須同步：

- `docs/rbac/02-permission-catalog.md`（權限清單）
- `apps/api/src/db/seeds/permissions.ts`（權限種子資料）
- 前端 `features/<name>/permission.ts`（頁面權限註冊）
