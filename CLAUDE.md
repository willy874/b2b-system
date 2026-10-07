# CLAUDE.md

給在這個 repo 工作的 AI 助理與新進開發者的作業指南。
**`docs/` 是規格的單一事實來源**；這份檔案只講「怎麼動手」。

## 這個專案是什麼

B2B System 的 Phase 0：一套會被後續所有功能複用的 **RBAC 骨架**。
通用型多租戶後台：不綁定任何業務領域，業務功能以 feature＋module 的形式加在骨架上。範圍見 [`docs/overview/01-overview.md`](docs/overview/01-overview.md)。

## 先讀哪些文件

| 你要做什麼 | 先讀 |
| --- | --- |
| 任何事 | [`docs/README.md`](docs/README.md)、[`docs/architecture/01-system.md`](docs/architecture/01-system.md)、[`docs/coding-standards/01-general.md`](docs/coding-standards/01-general.md) |
| 前端 | `docs/architecture/frontend/01`→`03`→`06`；兩個前端共用的程式在 `packages/`（下方「Monorepo 結構」） |
| 改兩個前端共用的程式、判斷程式該放 app 還是 package、加第三個前端 | [`docs/architecture/frontend/17-shared-packages.md`](docs/architecture/frontend/17-shared-packages.md)（§2 程式放哪、§3 app 怎麼接上 web-core、§7 常見陷阱）；各 package 的 README |
| 租戶（每個租戶一個 database 與網域） | [`docs/architecture/05-tenancy.md`](docs/architecture/05-tenancy.md)（請求怎麼找到租戶、`Tenancy`、佈建與生命週期、部署） |
| 後端 | `docs/architecture/backend/01`→`03`→`05`；資料庫與租戶看 `02` §6（平台 DB、`TENANT_DB`）；樂觀鎖（`version`）看 `03` §11；檔案／物件儲存看 `09`；背景工作看 `10`；寄信看 `11`；系統設定看 `12`；回收桶與還原看 `13`；版本歷史看 `14`；站內通知看 `15`；事件管理（通知的租戶開關與個人設定）看 `16`；Webhook（對外事件、投遞、對外連線的 SSRF 防護）看 `17`；標籤（擁有者登記資源類型、指派、篩選）看 `18`；公告（排程發送站內通知）看 `19`；審批（申請 → 核准 → 套用）看 `20` |
| 前端錯誤回報、release、Web Vitals、bundle 預算 | [`docs/architecture/frontend/19-observability.md`](docs/architecture/frontend/19-observability.md)（機制在 `web-core/telemetry`）、[`docs/architecture/07-apm-service.md`](docs/architecture/07-apm-service.md)（收件服務） |
| api 的指標、tracing、健康檢查、Grafana／Prometheus／Tempo 的部署與告警 | [`docs/architecture/08-monitoring.md`](docs/architecture/08-monitoring.md)（指標清單在 `core/metrics/instruments.ts`，§2.4 加指標的方式；tracing 在 `src/instrumentation.ts`） |
| 對外 API、API token 的驗證 | [`docs/architecture/06-external-api.md`](docs/architecture/06-external-api.md)（獨立的程序；對外的 controller 標 `@ExternalApi()`、放 `modules/<name>/external/`） |
| 登入、SSO、apps/platform | [`docs/architecture/04-sso.md`](docs/architecture/04-sso.md)（§1.1 租戶與平台的身分範圍）、[`apps/platform/README.md`](apps/platform/README.md)（與 backstage 共用的 packages、刻意各自一份的部分與同步規則） |
| 權限相關 | [`docs/architecture/iam/02-permission-catalog.md`](docs/architecture/iam/02-permission-catalog.md)；群組看 [`docs/architecture/iam/07-groups.md`](docs/architecture/iam/07-groups.md)；「為什麼能做 X」看 [`docs/architecture/iam/08-explain.md`](docs/architecture/iam/08-explain.md)；反提權的通用規則看 `docs/architecture/backend/05-rbac.md` §4.1 |
| 挑下一個要做的功能 | [`docs/features/README.md`](docs/features/README.md)（待製作清單；完成後刪提案、寫正式文件歸檔） |
| 處理已知問題 | [`docs/issues/README.md`](docs/issues/README.md)（現有程式的問題與技術債；修完刪掉該份文件） |
| 寫程式規範 | [`docs/coding-standards/`](docs/coding-standards/README.md)（命名、TS、測試、commit、字面量、層級依賴）；寫或 review 程式碼前用 `best-practice` skill 載入 |

## Monorepo 結構

| 位置 | 內容 |
| --- | --- |
| `apps/api` | NestJS 後端（另有對外 API 的程序 `dev:external-api`） |
| `apps/backstage` | 租戶的後台（:5173） |
| `apps/platform` | 全平台共用的登入入口與平台管理（:5175） |
| `apps/file-storage` | 本機的 S3 相容物件儲存 |
| `apps/apm-service` | 模擬 Sentry API 的前端錯誤收件（事件、sourcemap、Web Vitals 指標；[`docs/architecture/07-apm-service.md`](docs/architecture/07-apm-service.md)） |
| `apps/e2e` | Playwright |
| `packages/web-core` | 兩個前端共用的機制層：AppContext、session、HTTP、快取、權限機制、i18n 與共用字串、推播、批次佇列、外框與側欄（選單註冊表）、命令面板與全域快捷鍵、錯誤回報（`@sentry/browser`）、`RichTable`、共用頁面元件（錯誤頁、改密碼、背景工作與稽核列表）、session 結束時的表單草稿（`form/`）、測試輔助 |
| `packages/ui` | 設計系統：元件、Design Token、icons、UnoCSS 設定、Storybook |
| `packages/web-shared` | 框架無關的前端工具：store、channel、registry、date… |
| `packages/error-codes` | api 與前端共用的錯誤碼（build 到 `dist/`） |
| `packages/mail-components` | api 郵件範本用的 React Email 元件與 `render`，建置時打包成單一檔案（build 到 `dist/`） |
| `packages/realtime` | 推播事件的契約（api 與前端共用，build 到 `dist/`） |
| `packages/api-sdk` | 由 api 的 OpenAPI 產生的前端 SDK（build 到 `dist/`） |

- 前端 package 只有原始碼，由 app 的 Vite 編譯；以子路徑匯入：`@b2b-system/web-core/store`、`@b2b-system/ui/Button`、`@b2b-system/web-shared/utils`。
- app 的權限目錄、plugin 屬性以 module augmentation 接上 web-core（`@b2b-system/web-core/permission/register`、`@b2b-system/web-core/app/context`），app 的程式照舊從 `@/core/permission`、`@/plugins/app` 匯入。
- 只有一個 app 用的程式留在 app；**第二個前端也需要時搬進 package，不要複製**（先把它對 app 的依賴改成參數）。

## 三處必須同步

任一處變更時，**同一批**修改另外兩處：

1. `apps/backstage/src/features/<name>/`（平台層級的頁面——平台管理者、之後的租戶管理、帳號流程——在 `apps/platform/src/features/<name>/`）
2. `apps/api/src/modules/<name>/`
3. `docs/` 對應章節

權限變更額外要同步：`docs/architecture/iam/02-permission-catalog.md`、
`apps/api/src/db/seeds/permissions.ts`、前端 `features/<name>/permission.ts`、
該 app 兩個語系檔（`app/locales/*.json`）的 `permission.<resource>.<action>`。
錯誤碼變更：`packages/error-codes` ＋ `packages/web-core` 的 `ERROR_MESSAGE_KEY` 與語系檔 `error.<CODE>`（app 不必改）。

## 不可違反的規則

以下是摘要；理由、正反例與哪些由工具強制，見 [`docs/coding-standards/`](docs/coding-standards/README.md)。

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

1. app 的 `core/` 與 `@b2b-system/web-core` 不 import `features/`；packages 不 import app（web-core 也不呼叫 app 的 API），下層 package 不 import 上層（`web-shared` ← `ui` ← `web-core`）。
2. Feature 之間只能經由 route id（`<RouteLink to="user.detail">`，`@b2b-system/web-core/route-link`）、`apis/`、或 eventBus。
3. 頁面權限在 plugin 的 **同步** 階段註冊，語系包在 `onInit`（非同步）階段。
4. 元件只透過 `apis/<domain>/<operation>/` 與後端對話，不直接 `fetch`。
5. 設計系統 `@b2b-system/ui`（`packages/ui`）不出現業務名詞；業務元件放 `features/<name>/components/`。
6. 顏色一律走 Design Token（`packages/ui/src/styles/tokens.css`），不寫十六進位色碼。
7. Access token 只存在記憶體，不進 `localStorage`。
8. 兩個前端都要用的程式放 `packages/`，不在 app 之間複製；package 內部用相對路徑，不用 `@/`。

## 常用指令

```bash
pnpm dev            # 先 build packages/*（build:packages），再起 postgres + Mailpit(:8025) + api(:3000) + backstage(:5173) + platform(:5175) + file-storage(:9000)
pnpm dev:platform       # 單獨啟動 apps/platform（全平台共用的身分與租戶入口，:5175）；見 apps/platform/README.md
pnpm dev:e2e        # 以放寬的速率限制、寄信到 Mailpit 啟動 api（跑 E2E 時用）
pnpm dev:storage    # 單獨啟動 apps/file-storage（S3 相容，:9000）；api 端見 docs/architecture/backend/09-file.md
pnpm dev:apm        # 單獨啟動 apps/apm-service（模擬 Sentry API，:9100）；前端預設不送出，要送時設 VITE_APM_*（docs/architecture/frontend/19-observability.md §8）
pnpm --filter @b2b-system/apm-service upload-sourcemaps --project backstage --release <commit> --dir apps/backstage/dist --delete
                    # 以 BUILD_SOURCEMAP=hidden 建置後把 .map 上傳到 apm-service（docs/architecture/07-apm-service.md §5）
pnpm bundle:check   # 建置兩個前端並檢查 bundle 預算（apps/*/bundle-budget.json；CI 的 bundle job 也跑）
pnpm dev:mock-idp   # 模擬的外部 IdP（:4455，client b2b-mock／mock-secret）；外部 IdP 登入的開發與 E2E 用
pnpm dev:external-api  # 對外 API（:3001，只認 API token；docs/architecture/06-external-api.md）
pnpm build:packages # build 到 dist/ 的 packages（error-codes、realtime、api-sdk、mail-components）；拉下新的 main 後先 pnpm install 再跑這個
pnpm typecheck      # tsc -b（全 workspace）
pnpm lint / pnpm format / pnpm format:check
pnpm test           # 單元 + 整合（後端整合測試會用 Testcontainers 起一個 postgres）
pnpm --filter @b2b-system/<app 或 package> test   # 只跑一個（例：web-core、ui、backstage）
pnpm --filter @b2b-system/api test:unit   # api 只跑單元測試（不需要 Docker）；整合測試是 test:integration
pnpm test:e2e       # Playwright（需要 api 與 backstage 已啟動）；會先 db:reset：要帶暫用 DB 的 PLATFORM_DATABASE_URL，或 E2E_RESET_CONFIRM=<平台 database 名稱>
pnpm db:migrate / db:seed / db:seed:dev / db:seed:e2e / db:reset
                    # 平台 DB ＋ 每個租戶的 DB（docs/architecture/backend/02-database.md §6.1）；seed:dev/e2e 只跑 SEED_TENANT（預設 default）
                    # reset／seed:dev／seed:e2e 拒絕標記為 production 的平台 DB，不在本機的 DB 要加 --confirm <平台 database 名稱>
pnpm db:archive-audit-logs   # 稽核熱表 → 冷表搬移的手動補跑（平常由背景工作 auditLog.archive 每天跑）
pnpm db:drop-tenant <代碼> [--confirm]   # 清除 apps/platform 已刪除的租戶（database、DB 角色、bucket）；不加 --confirm 只列出；db:migrate 登記的預設租戶另要 --database <名稱>
pnpm --filter @b2b-system/api cli:reset-super-admin (--tenant <代碼> | --platform) --email <email>
                    # 災難復原：super-admin 忘記密碼又收不到信時，簽發一次性的重設連結並寫稽核（docs/architecture/iam/05-bootstrap.md §7）；不在本機的 DB 要加 --confirm <平台 database 名稱>
pnpm --filter @b2b-system/api openapi:generate && pnpm exec oxfmt apps/api/openapi.json apps/api/openapi.external.json && pnpm sdk:generate
                    # 改動 controller / DTO／權限鍵之後必跑；openapi.json 不經 oxfmt 會多出整份的格式 diff，pre-commit 也會擋
pnpm storybook      # packages/ui 設計系統元件的 Storybook（:6006）；story 寫法見 docs/architecture/frontend/07-ui-system.md §9
sh deploy/check-nginx.sh / sh deploy/smoke-test.sh   # nginx 設定／正式 compose 整套建置啟動（需要 Docker；CI 的 deploy job 也跑）
sh deploy/check-monitoring.sh   # 監控設定：compose 疊加、Prometheus 規則、Grafana 儀表板（需要 Docker；CI 的 deploy job 也跑）
pnpm monitoring:up / monitoring:down   # 本機的 Prometheus（:9090）、Tempo（:4318）、Grafana（:3300）；api 的 /metrics 在 :9464，要看 trace 在 .env 設 OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
                    # 正式環境：docker compose --env-file deploy/prod.env -f docker-compose.prod.yml -f docker-compose.monitoring.yml up -d（docs/architecture/08-monitoring.md §6）
pnpm --filter @b2b-system/e2e tour   # 重拍 docs/overview/05-feature-tour.md 的截圖（會重置 DB，只對隔離環境跑；docs/architecture/frontend/10-testing.md §4.6）
```

## 新增一個功能的順序

1. `docs/architecture/iam/02-permission-catalog.md` 加權限 →
   `apps/api/src/db/seeds/permissions.ts` 加 seed
2. 後端：`modules/<name>/`（controller / service / repository / dto）
3. `pnpm db:seed`，再依上方「常用指令」重新產生 openapi 與 SDK
4. 前端 API 層：`apis/<domain>/<operation>/`
5. 前端 feature：`locale.ts` → `routes/` → `permission.ts` → `navigation.ts`（側欄的入口；選用的 `search.ts` 是命令面板的搜尋與動作）→
   `plugin.ts` → `hooks/` → `pages/` → `index.tsx`
6. `main.tsx` 加一行 `.use(<name>FeaturePlugin())`；`app/routes.tsx` 接上 route（選單不必改 `app/`）
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
| 軟刪除條件的位置 | [`backend/14-revisions.md`](docs/architecture/backend/14-revisions.md) §9.2 D8：`db/soft-delete.ts` | `db/schema/soft-delete.ts`（`@/db/schema`、`@/db/platform/schema` 匯出） | `isActiveRole()` 在 `db/schema/roles.ts` 要用它，而 `db/schema/` 只依賴同層 |
| `TrashHandler` 的形狀 | [`backend/14-revisions.md`](docs/architecture/backend/14-revisions.md) §9.2 D9：`purge(ids, tx)` | `findExpired(cutoff, afterId, limit)` ＋ 逐列 `purge(item, tx)`（每列一個 savepoint）＋ `afterPurge(ids)` | 一列因外鍵刪不掉時只略過它自己；keyset 讓略過的列不會在同一輪被重複取到；交易後的副作用（權限失效、推播）要與交易內的刪除分開 |
| 還原時唯一值衝突的 details | [`backend/14-revisions.md`](docs/architecture/backend/14-revisions.md) §9.2 D5：`details.conflictingId` | 使用者用 `details.conflictingUserId` | 依 D6 與使用者的錯誤碼；R3／R4 的角色、資料夾各自決定欄位名 |
| 還原到某一版的權限 | [`backend/14-revisions.md`](docs/architecture/backend/14-revisions.md) §9.2 D10：`role:update` ＋ 反提權 | 路由 `role:update`；權限鍵會改變時 service 另要 `role:grantPermission`（`403 AUTHZ_FORBIDDEN`） | 否則只有 `role:update` 的人能藉還原拿掉角色的權限鍵（改權限的端點要 `role:grantPermission`）；見 `14-revisions.md` §4.3 |
| `notifications` 的索引 | [`backend/15-notification.md`](docs/architecture/backend/15-notification.md) §12.2 D1：`(recipient_id, read_at, created_at desc)` | `(recipient_id, created_at, id)` ＋ 部分索引 `… WHERE read_at IS NULL` ＋ `(read_at) WHERE read_at IS NOT NULL` | 「全部」的列表不必在 `read_at` 之後再排序、keyset 以 id 收尾、清理的「已讀過期」跨收件人；升冪欄位由反向掃描服務 `DESC` 查詢。見 `docs/architecture/backend/15-notification.md` §2 |
| 公告週期的時區 | [`backend/19-announcement.md`](docs/architecture/backend/19-announcement.md) §9.2 D11：新增系統設定 `system.timezone`（預設 UTC），以 `date-fns` 計算 | 沿用既有的 `general.defaultTimezone`（定義搬到 `core/settings/general.settings.ts`），以 `Intl` 兩次校正計算 | 兩個時區設定會讓顯示的時間與發送的時間不一致；`Intl` 已足夠，不必引入套件。見 `docs/architecture/backend/19-announcement.md` §5.1 |
| 公告的事件點 | [`backend/19-announcement.md`](docs/architecture/backend/19-announcement.md) §9.2 D12、D14：入列 `announcement.dispatch`；第一批含 `user.rolesChanged` | 入列 `announcement.eventDispatch`（每則 × 每人一筆）；觸發點帶比對方式 `scope`；「被指派角色」名為 `user.roleAssigned` | 事件點沒有 `next_run_at` 可比對；`user.rolesChanged` 已是通知類型的名稱，而且這裡只算新增的角色。見 `19-announcement.md` §5.3 |
