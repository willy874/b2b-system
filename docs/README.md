# B2B System — 架構文件

本目錄是 **B2B System** 的架構規格書。B2B System 是一套 **通用型的多租戶 B2B 後台**：
不綁定任何業務領域，先把每個後台都需要的基礎能力（身分、權限、稽核、檔案、背景工作、通知）做成
會被強制使用的機制，之後的業務功能都建立在它上面。

> 狀態：Phase 0（RBAC 骨架）已完成，之後陸續加入 SSO、多租戶、群組與關係圖、回收桶與版本歷史、站內通知、公告、Webhook、標籤等通用機制。
> 能力地圖見 [`overview/01-overview.md`](./overview/01-overview.md) §3，畫面見 [`overview/05-feature-tour.md`](./overview/05-feature-tour.md)，
> 時間軸見 [`overview/03-roadmap.md`](./overview/03-roadmap.md)，待製作的功能見 [`features/README.md`](./features/README.md)。
> 最後更新：2026-10-06

---

## 1. 這份文件在描述什麼

| 面向     | 決定                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------- |
| 定位     | 通用型後台骨架；業務功能以 feature（前端）＋ module（後端）的形式加上去，沿用既有的權限、稽核、回收桶、通知等機制 |
| 前端架構 | **plugin-based AppContext ＋ feature-first 分層 ＋ 執行期權限註冊表**                          |
| 前端 UI  | **Base UI**（`@base-ui/react`）＋ 專案自有的設計系統 `@b2b-system/ui`（`packages/ui`）                              |
| 後端     | **NestJS** + **Drizzle ORM** + **PostgreSQL**                                                  |
| 租戶與身分 | 每個租戶一個 database 與網域；`apps/platform` 是全平台共用的登入入口，`apps/api` 當 OIDC Provider |
| 已有範圍 | 認證與 SSO、使用者、角色、群組、權限與關係圖、服務帳號與 API token、稽核日誌、個人帳號、審批、系統設定、檔案、標籤、背景工作、寄信、回收桶、版本歷史、站內通知、公告、Webhook；平台的租戶與 feature 管理 |
| 不在範圍 | 任何特定領域的業務功能；資源層級作用域目前只用在檔案管理器，新資源沿用同一套（見 [`rbac/07-resource-grants.md`](rbac/07-resource-grants.md) §13、[`rbac/07-resource-grants.md`](./rbac/07-resource-grants.md)） |

---

## 2. 閱讀路徑

**第一次讀（決策者 / Reviewer）**

想先快速了解專案：看畫面讀 [`overview/05-feature-tour.md`](./overview/05-feature-tour.md)（每個功能的截圖與背後的規則）；
看設計讀 [`overview/04-introduction.md`](./overview/04-introduction.md)（各機制處理的邊際情況、與常見後台的差異）。

1. [`overview/01-overview.md`](./overview/01-overview.md) — 定位、能力地圖、角色、名詞
2. [`overview/02-technology-selection.md`](./overview/02-technology-selection.md) — 技術選型與理由
3. [`architecture/01-system.md`](./architecture/01-system.md) — 系統全貌與資料流
   （登入與身分見 [`architecture/04-sso.md`](./architecture/04-sso.md)；每個租戶一個 database 與網域見 [`architecture/05-tenancy.md`](./architecture/05-tenancy.md)）
4. [`rbac/01-domain-model.md`](./rbac/01-domain-model.md) — RBAC 領域模型與關係圖（§6.4）
5. [`overview/03-roadmap.md`](./overview/03-roadmap.md) — 現況、時間軸、Phase 0 的驗收基準

**開始寫程式之前（所有人）**

1. [`conventions/README.md`](./conventions/README.md) — 寫程式規範總覽
2. [`conventions/01-general.md`](./conventions/01-general.md) — TypeScript、命名、匯入、錯誤處理
3. [`conventions/05-git.md`](./conventions/05-git.md) — branch、commit、PR 檢查清單

**要寫前端**

1. [`architecture/02-repository-structure.md`](./architecture/02-repository-structure.md)
2. [`architecture/frontend/01-architecture.md`](./architecture/frontend/01-architecture.md)
3. [`architecture/frontend/02-plugin-system.md`](./architecture/frontend/02-plugin-system.md)
4. [`architecture/frontend/17-shared-packages.md`](./architecture/frontend/17-shared-packages.md) — 兩個前端共用的 packages、程式該放哪
5. [`architecture/frontend/03-feature-anatomy.md`](./architecture/frontend/03-feature-anatomy.md) ← 新增 feature 的 SOP
6. [`architecture/frontend/06-permission.md`](./architecture/frontend/06-permission.md)
7. [`conventions/02-frontend.md`](./conventions/02-frontend.md)

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
├── overview/                          為什麼做、做什麼、做到哪裡
│   ├── 01-overview.md                 專案總覽：定位、系統組成、能力地圖、角色、非功能需求、名詞
│   ├── 02-technology-selection.md     技術選型與理由
│   ├── 03-roadmap.md                  進度與路線：現況、時間軸、推翻過的決定、Phase 0 驗收基準
│   ├── 04-introduction.md             專案介紹：邊際情況的處理、與常見後台的對照
│   ├── 05-feature-tour.md             功能導覽：逐頁截圖與背後的規則（截圖由 apps/e2e/tour/ 產生，在 images/tour/）
│   └── images/tour/
│
├── architecture/                      系統長什麼樣子（規格）
│   ├── 01-system.md                   系統架構、部署拓撲、端到端資料流
│   ├── 02-repository-structure.md     monorepo 結構、目錄佈局、環境變數
│   ├── 03-file-storage.md             apps/file-storage：S3 相容的本機檔案儲存
│   ├── 04-sso.md                      SSO：apps/api 當 OIDC Provider、apps/platform、外部 IdP、單一登出
│   ├── 05-tenancy.md                  租戶：每個租戶一個 database 與網域、佈建與生命週期、部署
│   ├── 06-external-api.md             對外 API：獨立的程序與網域、API token 認證、路由的分界、限流
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
│   │   ├── 15-notification.md         站內通知：頂列鈴鐺、列表頁、通知總覽、route id 註冊表（web-core/route-link）、事件管理頁
│   │   ├── 16-announcement.md         公告：列表、建立、詳情與發送紀錄、收件人看全文
│   │   ├── 17-shared-packages.md      兩個前端共用的 packages：分層、程式放哪、app 怎麼接上 web-core
│   │   └── 18-command-palette.md      命令面板（⌘K）：頁面、最近造訪、資料搜尋、動作；選單註冊表；全域快捷鍵
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
│       ├── 16-notification-event.md   事件管理：事件目錄、租戶層的開關、個人的通知設定
│       ├── 17-webhook.md              Webhook：對外事件的目錄、訂閱、投遞與重試、簽章、SSRF 防護（core/http/outbound）
│       ├── 18-tag.md                  標籤：標籤組與資源類型的登記、指派、篩選、清理
│       └── 19-announcement.md         公告：受眾、立即與排程發送、撤回、讀全文
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
└── features/                          待製作功能的提案（完成後刪除、重寫成正式文件歸檔）
    └── README.md                      清單、優先度、提案 → 歸檔的流程
```

---

## 4. 文件慣例

- 全文以 **zh-TW** 撰寫；程式碼識別字、路由、權限鍵一律用 `code style` 原文。
- 權限一律寫成 `resource:action`（例如 `role:update`）。
- 使用者故事格式：**「作為 …，我希望 …，以便 …」** ＋ Given / When / Then。
- 任何「為什麼不選 X」的判斷寫進該規格最後的「設計決策」章節（見本節最後一條），不要散落在規格內文。
- 分區原則：`overview/` 講目標與計畫、`architecture/` 講系統設計、`rbac/` 講領域規格、
  `conventions/` 講寫程式規則。新文件依此歸位。
- **還沒實作的功能** 寫在 `features/`，不要寫進上述分區；那些分區只描述已存在的系統。
  流程見 [`features/README.md`](./features/README.md)。
- 檔案路徑用相對於 repo 根目錄的形式（`apps/backstage/src/...`）。
- 舉例時用 **領域中立** 的名詞（專案、文件、訂單、素材），不要假設某個特定產業。
- **設計決策跟著規格走**：每份規格最後有「`## N. 設計決策：<主題>`」章節，記錄背景、決定（`D1`、`D2`…）、
  理由與代價、評估過的方案、實作紀錄。程式碼與文件以「`<文件> §N.x Dn`」引用（例：`docs/architecture/backend/14-revisions.md §9.2 D3`）。
  - 決定的編號一經發布 **不重排、不重用**；被推翻的決定保留原文，在同一列或引述註明「已改為…，見 §…」，新的決定接續編號。
  - 實作時與決定不同的做法，寫進該章節的「實作紀錄」；根目錄 `CLAUDE.md`「與文件不同的實作決定」同步一列。
  - 2026-10-02 以前的決策原本是 `docs/adr/` 的獨立檔案（ADR-0001～0033），已併入各規格；章節開頭的「原 ADR-00NN」供對照 git 歷史。
    已套用的 migration（`*.sql`）不可修改，註解裡仍是舊的 `docs/adr/00NN-….md` 路徑，以「原 ADR-00NN」對照。
    部分早期決策的「背景」仍以「遊戲編輯器」為例，那些理由同樣適用於任何會長出自訂資源與大量編輯介面的業務功能。

---

## 5. 同步規則

以下三處必須永遠同步，任一處變更時必須同一批修改另外兩處：

1. `apps/backstage/src/features/<name>/`（平台層級的頁面在 `apps/platform/src/features/<name>/`）— 前端功能原始碼
2. `apps/api/src/modules/<name>/` — 後端模組原始碼
3. `docs/` 對應章節 — 規格文件

權限相關的變更額外必須同步：

- `docs/rbac/02-permission-catalog.md`（權限清單）
- `apps/api/src/db/seeds/permissions.ts`（權限種子資料）
- 前端 `features/<name>/permission.ts`（頁面權限註冊）
