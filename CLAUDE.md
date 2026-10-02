# CLAUDE.md

給在這個 repo 工作的 AI 助理與新進開發者的作業指南。
**`docs/` 是規格的單一事實來源**；這份檔案只講「怎麼動手」。

## 這個專案是什麼

B2B System 的 Phase 0：一套會被後續所有功能複用的 **RBAC 骨架**。
通用型多租戶後台：不綁定任何業務領域，業務功能以 feature＋module 的形式加在骨架上。範圍見 [`docs/overview/01-overview.md`](docs/overview/01-overview.md)。

## 先讀哪些文件

| 你要做什麼 | 先讀 |
| --- | --- |
| 任何事 | [`docs/README.md`](docs/README.md)、[`docs/architecture/01-system.md`](docs/architecture/01-system.md)、[`docs/conventions/01-general.md`](docs/conventions/01-general.md) |
| 前端 | `docs/architecture/frontend/01`→`03`→`06` |
| 租戶（每個租戶一個 database 與網域） | [`docs/architecture/05-tenancy.md`](docs/architecture/05-tenancy.md)（請求怎麼找到租戶、`Tenancy`、佈建與生命週期、部署） |
| 後端 | `docs/architecture/backend/01`→`03`→`05`；資料庫與租戶看 `02` §6（平台 DB、`TENANT_DB`）；樂觀鎖（`version`）看 `03` §11；檔案／物件儲存看 `09`；背景工作看 `10`；寄信看 `11`；系統設定看 `12`；回收桶與還原看 `13`；版本歷史看 `14`；站內通知看 `15`；事件管理（通知的租戶開關與個人設定）看 `16`；Webhook（對外事件、投遞、對外連線的 SSRF 防護）看 `17`；標籤（擁有者登記資源類型、指派、篩選）看 `18`；公告（排程發送站內通知）看 `19` |
| 對外 API、API token 的驗證 | [`docs/architecture/06-external-api.md`](docs/architecture/06-external-api.md)（獨立的程序；對外的 controller 標 `@ExternalApi()`、放 `modules/<name>/external/`） |
| 登入、SSO、apps/auth | [`docs/architecture/04-sso.md`](docs/architecture/04-sso.md)（§1.1 租戶與平台的身分範圍）、[`apps/auth/README.md`](apps/auth/README.md)（從 backstage 複製的程式碼與同步規則） |
| 權限相關 | [`docs/rbac/02-permission-catalog.md`](docs/rbac/02-permission-catalog.md)；群組看 [`docs/rbac/08-groups.md`](docs/rbac/08-groups.md)；「為什麼能做 X」看 [`docs/rbac/09-explain.md`](docs/rbac/09-explain.md)；反提權的通用規則看 `docs/architecture/backend/05-rbac.md` §4.1 |
| 挑下一個要做的功能 | [`docs/features/README.md`](docs/features/README.md)（待製作清單；完成後刪提案、寫正式文件歸檔） |
| 處理已知問題 | [`docs/issues/README.md`](docs/issues/README.md)（現有程式的問題與技術債；修完刪掉該份文件） |
| 寫程式規範 | [`docs/conventions/`](docs/conventions/README.md)（命名、TS、測試、commit、字面量、層級依賴）；寫或 review 程式碼前用 `best-practice` skill 載入 |

## 三處必須同步

任一處變更時，**同一批**修改另外兩處：

1. `apps/backstage/src/features/<name>/`（平台層級的頁面——平台管理者、之後的租戶管理、帳號流程——在 `apps/auth/src/features/<name>/`）
2. `apps/api/src/modules/<name>/`
3. `docs/` 對應章節

權限變更額外要同步：`docs/rbac/02-permission-catalog.md`、
`apps/api/src/db/seeds/permissions.ts`、前端 `features/<name>/permission.ts`、
兩個語系檔的 `permission.<resource>.<action>`。

## 不可違反的規則

以下是摘要；理由、正反例與哪些由工具強制，見 [`docs/conventions/`](docs/conventions/README.md)。

### 後端

1. `core/` 永遠不 import `modules/`。
2. Controller 不含業務邏輯，只做 HTTP ↔ DTO 與 `@RequirePermissions` 宣告。
3. Repository 不含業務判斷，只有 Drizzle 查詢。
4. 每個路由都要宣告 `@Public()` / `@Authenticated()` / `@RequirePermissions()`
   其中之一——沒宣告會讓 **程序啟動失敗**（`common/route-audit.ts`）。
5. Service 拋 `AppException(ErrorCode)`，不拋 `HttpException`。
6. 稽核寫入在交易 **內**；快取失效在交易 **後**；領域事件（`DomainEventBus`）在快取失效 **後** 發佈。
   Service 不直接碰 Socket.io，推播由 `modules/realtime` 訂閱事件處理。
7. 寫入角色的持有者或權限鍵（`relation_tuples`）後，交易提交後呼叫 `permissionService.permissionsChanged()`
   （整個租戶失效並廣播給其他程序，不必事先查出受影響的人；`docs/architecture/backend/05-rbac.md` §5.1）。

### 前端

1. `core/` 不 import `features/`；`shared/` 不 import 上層任何東西。
2. Feature 之間只能經由 `routes/external.ts`（route 物件）、`apis/`、或 eventBus。
3. 頁面權限在 plugin 的 **同步** 階段註冊，語系包在 `onInit`（非同步）階段。
4. 元件只透過 `apis/<domain>/<operation>/` 與後端對話，不直接 `fetch`。
5. `components/` 不出現業務名詞；業務元件放 `features/<name>/components/`。
6. 顏色一律走 Design Token（`themes/tokens.css`），不寫十六進位色碼。
7. Access token 只存在記憶體，不進 `localStorage`。

## 常用指令

```bash
pnpm dev            # 先 build packages/*（build:packages），再起 postgres + Mailpit(:8025) + api(:3000) + backstage(:5173) + auth(:5175) + file-storage(:9000)
pnpm dev:auth       # 單獨啟動 apps/auth（全平台共用的身分與租戶入口，:5175）；見 apps/auth/README.md
pnpm dev:e2e        # 以放寬的速率限制、寄信到 Mailpit 啟動 api（跑 E2E 時用）
pnpm dev:storage    # 單獨啟動 apps/file-storage（S3 相容，:9000）；api 端見 docs/architecture/backend/09-file.md
pnpm dev:mock-idp   # 模擬的外部 IdP（:4455，client b2b-mock／mock-secret）；外部 IdP 登入的開發與 E2E 用
pnpm dev:external-api  # 對外 API（:3001，只認 API token；docs/architecture/06-external-api.md）
pnpm typecheck      # tsc -b（全 workspace）
pnpm lint / pnpm format / pnpm format:check
pnpm test           # 單元 + 整合（後端整合測試會用 Testcontainers 起一個 postgres）
pnpm test:e2e       # Playwright（需要 api 與 backstage 已啟動）
pnpm db:migrate / db:seed / db:seed:dev / db:seed:e2e / db:reset
                    # 平台 DB ＋ 每個租戶的 DB（docs/architecture/backend/02-database.md §6.1）；seed:dev/e2e 只跑 SEED_TENANT（預設 default）
pnpm db:archive-audit-logs   # 稽核熱表 → 冷表搬移的手動補跑（平常由背景工作 auditLog.archive 每天跑）
pnpm db:drop-tenant <代碼> [--confirm]   # 清除 apps/auth 已刪除的租戶（database、DB 角色、bucket）；不加 --confirm 只列出
pnpm --filter @b2b-system/api openapi:generate && pnpm exec oxfmt apps/api/openapi.json apps/api/openapi.external.json && pnpm sdk:generate
                    # 改動 controller / DTO／權限鍵之後必跑；openapi.json 不經 oxfmt 會多出整份的格式 diff，pre-commit 也會擋
pnpm storybook      # 設計系統元件的 Storybook（:6006）；story 寫法見 docs/architecture/frontend/07-ui-system.md §9
```

## 新增一個功能的順序

1. `docs/rbac/02-permission-catalog.md` 加權限 →
   `apps/api/src/db/seeds/permissions.ts` 加 seed
2. 後端：`modules/<name>/`（controller / service / repository / dto）
3. `pnpm db:seed`，再依上方「常用指令」重新產生 openapi 與 SDK
4. 前端 API 層：`apis/<domain>/<operation>/`
5. 前端 feature：`locale.ts` → `routes/` → `permission.ts` → `plugin.ts` →
   `hooks/` → `pages/` → `index.tsx`
6. `main.tsx` 加一行 `.use(<name>FeaturePlugin())`；`app/routes.tsx` 接上 route
7. 測試：feature 的 hook 測試、頁面的三個權限案例、必要時補 E2E
8. 回頭更新 `docs/`；若功能來自 `docs/features/` 的提案，依該資料夾 README §3.3 歸檔並刪除提案

完整 SOP：[`docs/architecture/frontend/03-feature-anatomy.md`](docs/architecture/frontend/03-feature-anatomy.md) §5。

## 與文件不同的實作決定

這些是實作時發現文件寫法會出錯而調整的地方，已在程式碼註解說明：

| 項目 | 文件 | 實作 | 原因 |
| --- | --- | --- | --- |
| Refresh cookie 的 Path | `/auth` | `/api/auth`（`REFRESH_COOKIE_PATH`） | 瀏覽器看到的路徑帶 `/api` 前綴，設 `/auth` 會讓 cookie 永遠不被送出 |
| 速率限制 | 具名 throttler `auth` | 自製全域 `RateLimitGuard` ＋ 端點 `@RateLimit('auth' \| 'authMail' \| 'refresh')`；已登入以「租戶＋使用者」、未登入以 IP、登入以「email＋IP」計數 | `@nestjs/throttler` 的具名 throttler 會「同時」套用到所有路由，且只能以 IP 計數，企業 NAT 後整間公司共用額度 |
| 建立對話框的權限 | 沿用列表頁的 page key | `USER_CREATE` / `ROLE_CREATE` 各自註冊 | 才能讓 auditor 直接貼 `/user/create` 時看到 403 |
| `resolvePageKey` | 前綴命中 | 前綴命中取 **最長** | 有了上一列的子頁面規則之後才不會被父規則蓋掉 |
| `Select` / `Menu` 的底層 | Base UI `Select` / `Menu`（另有 `Combobox`） | Base UI `Popover` ＋ 自製列表（`aria-activedescendant`）＋ TanStack Virtual；`Combobox` 併入 `Select` 的 `searchable` | Base UI 的列表元件需要所有項目都在 DOM 上，無法虛擬捲動；見 `docs/architecture/frontend/07-ui-system.md` §3.10 |
| WebSocket 的 guard | 全域 guard 同時保護 HTTP 與 WS | 全域 guard（Nest 12 起也套用到 gateway）；ws 由 `WsAuthGuard`（`APP_GUARD`，排在 `JwtAuthGuard` 之後、`PermissionsGuard` 之前）認人，`RateLimitGuard`／`JwtAuthGuard`／`FeatureGuard`／`TransformInterceptor` 遇到 ws 直接放行；gateway 不 `@UseGuards` | class 層 guard 排在全域之後，會讓 `PermissionsGuard` 先於 `WsAuthGuard`；HTTP 的限流與 `{ data }` 信封不適用 ws，限流在 `realtime.rate-limit.ts`（`docs/architecture/backend/08-realtime.md` §4） |
| 軟刪除條件的位置 | ADR-0025 D8：`db/soft-delete.ts` | `db/schema/soft-delete.ts`（`@/db/schema`、`@/db/platform/schema` 匯出） | `isActiveRole()` 在 `db/schema/roles.ts` 要用它，而 `db/schema/` 只依賴同層 |
| `TrashHandler` 的形狀 | ADR-0025 D9：`purge(ids, tx)` | `findExpired(cutoff, afterId, limit)` ＋ 逐列 `purge(item, tx)`（每列一個 savepoint）＋ `afterPurge(ids)` | 一列因外鍵刪不掉時只略過它自己；keyset 讓略過的列不會在同一輪被重複取到；交易後的副作用（權限失效、推播）要與交易內的刪除分開 |
| 還原時唯一值衝突的 details | ADR-0025 D5：`details.conflictingId` | 使用者用 `details.conflictingUserId` | 依 D6 與使用者的錯誤碼；R3／R4 的角色、資料夾各自決定欄位名 |
| 還原到某一版的權限 | ADR-0025 D10：`role:update` ＋ 反提權 | 路由 `role:update`；權限鍵會改變時 service 另要 `role:grantPermission`（`403 AUTHZ_FORBIDDEN`） | 否則只有 `role:update` 的人能藉還原拿掉角色的權限鍵（改權限的端點要 `role:grantPermission`）；見 `14-revisions.md` §4.3 |
| `notifications` 的索引 | ADR-0026 D1：`(recipient_id, read_at, created_at desc)` | `(recipient_id, created_at, id)` ＋ 部分索引 `… WHERE read_at IS NULL` ＋ `(read_at) WHERE read_at IS NOT NULL` | 「全部」的列表不必在 `read_at` 之後再排序、keyset 以 id 收尾、清理的「已讀過期」跨收件人；升冪欄位由反向掃描服務 `DESC` 查詢。見 `docs/architecture/backend/15-notification.md` §2 |
