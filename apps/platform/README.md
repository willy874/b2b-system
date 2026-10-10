# apps/platform

全平台共用、**不屬於任何租戶** 的身分入口（[`architecture/04-sso.md`](../../docs/architecture/04-sso.md) §12）。
各產品（backstage、之後建在骨架上的其他前端）的登入都會經過這裡；平台管理者（與租戶的帳號是兩份資料）也在這裡登入並管理租戶（[`architecture/05-tenancy.md`](../../docs/architecture/05-tenancy.md) §10.2 D5、D12）。外部 IdP 連線屬於租戶，在 backstage 管理。
流程、端點與部署見 [`docs/architecture/04-sso.md`](../../docs/architecture/04-sso.md)。

- 只有前端（Vite ＋ React 19），後端 API 由 `apps/api` 提供，經自己 origin 的 `/api` 反向代理（D2）。
- **獨立的 origin**（dev `localhost:5175`、prod 例：`auth.example.com`）。**不使用跨域 cookie**：每個 cookie 都是 host-only，
  服務之間只以頂層跳轉（OIDC 授權碼、end-session）溝通；不用 iframe、靜默續期或 `postMessage`（D6）。
- 架構比照 `apps/backstage`（[`docs/architecture/frontend/`](../../docs/architecture/frontend/README.md)）：
  `main.tsx` 的 plugin chain → `app/` → `features/` → `apis/` → `core/`（權限目錄的門面）→ `@b2b-system/web-core` → `@b2b-system/ui` → `@b2b-system/web-shared`，層級依賴規則相同
  （[`docs/coding-standards/07-layer-dependencies.md`](../../docs/coding-standards/07-layer-dependencies.md) §2）。

```bash
pnpm dev:platform        # 只啟動 apps/platform（:5175）；api 要另外啟動（pnpm dev 會一起啟動）
pnpm --filter @b2b-system/platform test
pnpm --filter @b2b-system/platform build
```

## 內容

| 路徑 | 說明 |
| --- | --- |
| `features/login` | `/interaction/:uid`：**IdP 的登入互動頁**，所有產品的密碼登入都在這裡（D16），顯示要登入的租戶；`/error`：provider 的協定錯誤；`/login`、`/callback`：apps/platform 自己的頁面經 SSO 登入（**只給平台管理者**，[`architecture/05-tenancy.md`](../../docs/architecture/05-tenancy.md) §10.2 D5）；帳號流程 `/forgot-password`、`/reset-password`、`/setup`、`/register`（網址帶 `?tenant=`，以 `X-Tenant` 送給 api；完成後回到那個租戶的 backstage 登入。`/setup`、`/reset-password` 沒有 `?tenant=` 是平台管理者的連結，打 `/platform/auth/*`、完成後留在 apps/platform 登入）；`/enter`：**進入租戶**（輸入租戶代碼 → 前往那個租戶的 backstage 登入，D11；平台登入頁有連結） |
| `features/tenant` | `/tenant`、`/tenant/$id?tab=`：租戶的清單（`RichTable`，含用量欄位與排序；上方是所有租戶合計的儲存止水線，[`docs/architecture/backend/25-image.md`](../../docs/architecture/backend/25-image.md) §12）、建立（背景佈建）、詳情（麵包屑；概覽／用量／功能／試行開關／多重驗證分頁：網域、改名、停用／啟用、刪除、重試佈建、用量的摘要與近 30 天（[`docs/architecture/05-tenancy.md`](../../docs/architecture/05-tenancy.md) §5.4）、啟用的 feature 與參數、flag 的租戶覆寫）；`tenant:*` 是 **平台** 的權限 |
| `features/platform-admin` | `/admin`：平台管理者的清單、新增（寄啟用信）、編輯（名稱、角色、停用）、寄設定密碼的連結 |
| `features/feature-flag` | `/feature-flag`：試行開關的目錄與全平台覆寫 |
| `features/audit-log` | `/audit-log`：平台稽核（平台管理者做過的事；看不到租戶的稽核） |
| `features/job` | `/job`：所有租戶與平台自己的背景工作（backstage 的 `/job` 只看自己租戶的） |
| `features/cdn` | `/cdn`：CDN 的部署資訊（環境變數，唯讀）、執行期的設定（啟用、資源類型、效期、自動清理、批次；開啟前的節點檢查不過時在開關旁列出問題）、邊緣節點的狀態與「執行檢查」、手動清理與最近的 `cdn.purge`（[`docs/architecture/backend/09-file.md`](../../docs/architecture/backend/09-file.md) §16.12）；`cdn:*` 是平台的權限 |
| `features/home` | `/`：目前登入的平台管理者、各狀態的租戶數 |
| `features/account` | `/profile`、`/preference`：個人資料（改名、角色與權限、變更密碼）、偏好設定（只存在瀏覽器） |
| `features/notification` | `/notification` 與頂列的鈴鐺：平台的站內通知（[`backend/15-notification.md`](../../docs/architecture/backend/15-notification.md) §6.2） |
| `app/` | 自己寫的 App Shell：`App.tsx`（掛上 web-core 的 `SessionWatcher`：沒有 session 時導向 `/login`；登出後停在「已登出」頁，帶上結束原因與原本的網址，見 `sessionRedirect.ts`）、`Layout.tsx`（頁面權限守衛；登入相關頁面不套外框）、`ErrorPages.tsx`（把 web-core 的 403／404、router 預設錯誤頁接成 `compact` 版面；載入中的 spinner）、`layouts/`（`DashboardLayout` 把品牌與帳號選單的動作交給 web-core 的 `DashboardShell`；頂列工具在 `headerTools.ts`）；側欄的分類在 `core/navigation/`，頁面的入口由各 feature 的 `navigation.ts` 登記（[`docs/architecture/frontend/18-command-palette.md`](../../docs/architecture/frontend/18-command-palette.md) §2） |

有即時推播（平台管理者的連線，[`backend/08-realtime.md`](../../docs/architecture/backend/08-realtime.md) §3.6）。
沒有批次佇列的畫面、執行期啟用的 feature 與 MSW mock；需要時再從 backstage 帶過來（Storybook 在 `packages/ui`）。

## 與 backstage 共用的 packages

分工、app 怎麼接上 web-core、程式該放哪見 [`docs/architecture/frontend/17-shared-packages.md`](../../docs/architecture/frontend/17-shared-packages.md)。

兩個前端 import 同一份 workspace package，不再複製程式碼（[`architecture/04-sso.md`](../../docs/architecture/04-sso.md) §12.2 D14 的兩次更新）：

| package | 內容 |
| --- | --- |
| `@b2b-system/web-core` | 機制層：AppContext、session、HTTP client 與攔截器（`plugins/fetcher`）、基礎設施 plugin（`plugins/app`）、快取、權限機制、i18n 與共用字串、推播、批次佇列、路由、全域 store、外框（`shell`、`layout`）、`RichTable` 等元件、測試輔助（[README](../../packages/web-core/README.md)） |
| `@b2b-system/ui` | 設計系統元件、Design Token、圖示 |
| `@b2b-system/web-shared` | 純工具：store、channel、context、registry、storage、date |
| `@b2b-system/error-codes` | 錯誤碼清單；前端的翻譯與 `ERROR_MESSAGE_KEY` 在 web-core |

`src/index.css` 只 `@import '@b2b-system/ui/styles.css'`；`uno.config.ts` 轉出 `@b2b-system/ui/uno.config`。
package 的原始碼由這個 app 的 Vite 編譯，CSS Module 的 class 前綴是 `ga-`（backstage 是 `ge-`），DevTools 裡分得出是哪個 app。

## 刻意各自一份的部分

| 位置 | 說明 |
| --- | --- |
| `core/permission/` | `enums.ts`、`resources.ts` 是 **平台** 的權限目錄（api-sdk 的 `PlatformPermissionKey`，[`iam/02-permission-catalog.md`](../../docs/architecture/iam/02-permission-catalog.md) §8），`index.ts` 以 module augmentation 登記給 web-core；機制在 `@b2b-system/web-core/permission`。權限由 `GET /platform/auth/profile` 的 `permissions` 水合 |
| `apis/auth/` | 與 backstage 同結構，端點不同：打 `/platform/auth/*`（平台管理者的 session）。帳號流程（`forgot-password`、`reset-password`、`setup`、`register`）與 `tenant.ts` 的 `X-Tenant` 只在這裡 |
| `app/` | `App.tsx`、`Layout.tsx`、`ErrorPages.tsx`（把 web-core 的錯誤頁接成 `compact` 版面）、`plugin.ts`、`i18n.ts`（把自己的語系包交給 web-core 的 `i18nPlugin`）、`sessionRedirect.ts`（只有 `isPublic`）、`layouts/`（`DashboardLayout` 的品牌與帳號選單、`headerTools.ts`；選單由 feature 登記、分類在 `core/navigation/`；外框本身是 web-core 的 `DashboardShell`；`LanguageMenu.tsx` 只把切換交給 web-core 的 `LanguageMenu`，不同步到帳號）、`app/locales/*.json`（只有 app 專屬的區段與少數覆寫，例：`changePassword.hint`、`auditLog.expand`／`collapse` 的措辭） |
| `features/` | `account`（打 `/platform/auth/*`，偏好不同步到帳號、沒有 API token 與權限來源；改密碼是 web-core 的 `ChangePasswordSection`）、`notification`（打 `/platform/notifications`，offset 分頁、不用虛擬捲動）、`login`（`sso.ts` 的 client id 與 backstage 不同；`AuthShell`、session 結束原因的對照在 web-core）、`job`／`audit-log`（列表與明細的版面在 web-core 的 `job`、`audit-log`，這裡只有端點、adapter、篩選與租戶欄）等，都是這個 app 的功能 |
| `shared/` | `api-sdk`、`websocket-sdk` 的收斂點；`constants/env.ts`（含 `OIDC_ISSUER`） |
| `public/theme-init.js` | Vite 的 public 目錄，兩邊各一份（測試在 `app/__tests__/theme-init.test.ts`） |
| `test/` | `setup.ts`；`i18n.ts` 包 web-core 的 `initTestI18n`，加上自己的 `app/locales/zh_TW.json` |

`core/feature`（執行期啟用 feature）、`core/file`、`core/trash` 等只在 backstage：apps/platform 沒有可啟用的 feature、檔案與回收桶。
web-core 的批次佇列（`batchQueuePlugin`、頂列的佇列按鈕、`BatchQueueNotifier`）與 backstage 相同；目前只有通知列表有批次操作（標為已讀、刪除）。佇列以 origin 區分，與 backstage 的佇列互不相通。

### 同步規則

- 修 web-core 就是兩邊一起修；改完兩個 app 都要跑測試與 build。
- 兩個 app 的同名檔案太像（超過 30 行、行集合相似度超過 0.7）時，web-core 的 `src/__tests__/duplicated-code.test.ts` 會失敗：把差異改成參數搬進 web-core，真的要留兩份就在測試的 `KNOWN_SIMILAR` 寫明理由（[`docs/architecture/frontend/17-shared-packages.md`](../../docs/architecture/frontend/17-shared-packages.md) §5）。
- 安全相關的 app 程式仍要兩邊一起看：`app/sessionRedirect.ts`（交給 `SessionWatcher` 的登入頁路徑與公開頁面）、`apis/auth/*`（結構相同、端點不同）。
  `SessionWatcher`（session 結束時清資料、導向登入頁且不自動跳回 IdP，[`architecture/04-sso.md`](../../docs/architecture/04-sso.md) §12.2 D5）在 `@b2b-system/web-core/shell`，兩個 app 共用。
- `vite.config.ts` 的 vendor chunk 分組（`build.rolldownOptions.output.codeSplitting.groups`）兩個 app 各一份、內容相同，改一邊就改另一邊；規則與理由在 [`docs/architecture/frontend/19-observability.md`](../../docs/architecture/frontend/19-observability.md) §7.2。
- 新增錯誤碼只動 `@b2b-system/error-codes` 與 web-core（[`packages/error-codes/README.md`](../../packages/error-codes/README.md)），這個 app 不必改。
