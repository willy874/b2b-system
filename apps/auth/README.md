# apps/auth

全平台共用、**不屬於任何租戶** 的身分入口（[ADR-0019](../../docs/adr/0019-sso-identity-platform.md)）。
各產品（backstage、之後建在骨架上的其他前端）的登入都會經過這裡；平台管理者（與租戶的帳號是兩份資料）也在這裡登入並管理租戶（[ADR-0020](../../docs/adr/0020-physical-tenant-isolation.md) D5、D12）。外部 IdP 連線屬於租戶，在 backstage 管理。
流程、端點與部署見 [`docs/architecture/04-sso.md`](../../docs/architecture/04-sso.md)。

- 只有前端（Vite ＋ React 19），後端 API 由 `apps/api` 提供，經自己 origin 的 `/api` 反向代理（D2）。
- **獨立的 origin**（dev `localhost:5175`、prod 例：`auth.example.com`）。**不使用跨域 cookie**：每個 cookie 都是 host-only，
  服務之間只以頂層跳轉（OIDC 授權碼、end-session）溝通；不用 iframe、靜默續期或 `postMessage`（D6）。
- 架構比照 `apps/backstage`（[`docs/architecture/frontend/`](../../docs/architecture/frontend/README.md)）：
  `main.tsx` 的 plugin chain → `app/` → `features/` → `apis/` → `core/` → `components/` → `shared/`，層級依賴規則相同
  （[`docs/conventions/07-layer-dependencies.md`](../../docs/conventions/07-layer-dependencies.md) §2）。

```bash
pnpm dev:auth        # 只啟動 apps/auth（:5175）；api 要另外啟動（pnpm dev 會一起啟動）
pnpm --filter @b2b-system/auth test
pnpm --filter @b2b-system/auth build
```

## 內容

| 路徑 | 說明 |
| --- | --- |
| `features/login` | `/interaction/:uid`：**IdP 的登入互動頁**，所有產品的密碼登入都在這裡（D16），顯示要登入的租戶；`/error`：provider 的協定錯誤；`/login`、`/callback`：apps/auth 自己的頁面經 SSO 登入（**只給平台管理者**，[ADR-0020](../../docs/adr/0020-physical-tenant-isolation.md) D5）；帳號流程 `/forgot-password`、`/reset-password`、`/setup`、`/register`（網址帶 `?tenant=`，以 `X-Tenant` 送給 api；完成後回到那個租戶的 backstage 登入。`/setup`、`/reset-password` 沒有 `?tenant=` 是平台管理者的連結，打 `/platform/auth/*`、完成後留在 apps/auth 登入）；`/enter`：**進入租戶**（輸入租戶代碼 → 前往那個租戶的 backstage 登入，D11；平台登入頁有連結） |
| `features/tenant` | `/tenant`、`/tenant/$id`：租戶的清單、建立（背景佈建）、詳情（網域、改名、停用／啟用、刪除、重試佈建、是否允許外部 IdP）；`tenant:*` 是 **平台** 的權限 |
| `features/platform-admin` | `/admin`：平台管理者的清單、新增（寄啟用信）、編輯（名稱、角色、停用）、寄設定密碼的連結 |
| `features/audit-log` | `/audit-log`：平台稽核（平台管理者做過的事；看不到租戶的稽核） |
| `features/job` | `/job`：所有租戶與平台自己的背景工作（backstage 的 `/job` 只看自己租戶的） |
| `features/home` | `/`：目前登入的平台管理者 |
| `app/` | 自己寫的 App Shell：`App.tsx`（沒有 session 時導向 `/login`；登出後停在「已登出」頁，帶上結束原因與原本的網址，見 `sessionRedirect.ts`）、`Layout.tsx`（頁面權限守衛）、`ErrorPages.tsx`（403／404、router 的預設錯誤頁與載入中；部署後舊 chunk 載入失敗提示重新整理）、`layouts/PlatformLayout.tsx` |

沒有推播、批次佇列、feature flag、MSW mock 與 Storybook；需要時再從 backstage 帶過來。

## 從 apps/backstage 複製的程式碼（D14）

這一版 **複製**、不抽 package。下列模組整個資料夾（含測試）複製自 `apps/backstage/src` 的同一路徑：

| 位置 | 模組 |
| --- | --- |
| `core/` | `app`、`auth`、`cache`、`client`、`errors`、`locales`、`notify`、`permission`、`realtime`、`router`、`store`、`theme` |
| `components/` | `AlertDialog`、`Button`、`Checkbox`、`ConfirmDialog`、`Dialog`、`Ellipsis`、`Empty`、`Field`、`Icon`、`Input`、`Menu`、`Pagination`、`Select`、`Skeleton`、`Spinner`、`Table`、`Toast`、`Tooltip`、`VirtualList`，以及 `slots.ts`、`useControllableState.ts`、`useLatestRef.ts`、`types.ts` |
| `shared/` | `EventEmitter`、`api-sdk`、`channel`、`constants`、`context`、`date`、`hooks`、`registry`、`storage`、`store`、`utils`、`websocket-sdk` |
| `plugins/` | `fetcher/`；`app/` 的 `cache`、`event-bus`、`http-context`、`i18n`、`theme` |
| `apis/auth/` | `get-profile`、`login`、`logout`、`refresh`（apps/auth 改打 `/platform/auth/*`：平台管理者的 session） |
| 其他 | `themes/`、`assets/icons/`、`index.css`、`public/theme-init.js`、`test/`（setup 與假物件）、`app/GlobalProvider.tsx`、`ToastHost.tsx`、`ConfirmDialogHost.tsx`、`plugin.ts`、`layouts/ThemeMenu.tsx`、`app/locales/*.json` |
| `features/login` | `hooks/`（`useLogoutMutation`、`useSyncPermissions`、`useSsoCallbackMutation`）、`pages/AuthShell.tsx`、`pages/Login/page.tsx` 與 `pages/SsoCallback/page.tsx`（與 backstage `features/auth` 的同名頁面相同流程，改過文案鍵與路由）、`sso.ts`（client id 不同） |
| 帳號流程（搬移，backstage 已刪除） | `features/login/pages/{ForgotPassword,ResetPassword,Setup,Register}`、`apis/auth/{forgot-password,reset-password,setup,register}`；只存在 apps/auth，不需要同步（`apis/auth/tenant.ts` 的 `X-Tenant`、`apis/tenant/lookup-tenant` 也是）。`apis/resources.ts` 是 apps/auth 自己的精簡版 |
| SSO 的瀏覽器端 | `core/auth/sso.ts`（PKCE、授權網址、verifier）、`apis/auth/sso-callback/`、`shared/constants/env.ts` 的 `OIDC_ISSUER` |

`core/feature`（執行期啟用 feature，[ADR-0021](../../docs/adr/0021-runtime-feature-activation.md)）只在 backstage；這裡只複製它依賴的機制（`shared/context` 的 `install` / `uninstall`、`shared/registry`、可訂閱的權限註冊表），apps/auth 沒有可啟用的 feature。

`core/realtime` 與 `components/Table` 目前沒有畫面用到，是被 `core/cache`、`core/store` 依賴而一起帶進來的。

與 backstage 不同的地方：

- `components/__tests__/design-system.test.ts` 拿掉「每個元件都有 story」：Storybook 只在 backstage。
- `components/__tests__/ref-forwarding.test.tsx`、`slots.test.tsx` 只留有複製的元件；`core/permission/__tests__/feature-registration.test.ts` 改成 apps/auth 的 feature 清單。
- CSS Module 的 class 前綴是 `ga-`（backstage 是 `ge-`），DevTools 裡分得出是哪個 app。
- `core/permission` 的 `enums.ts` 與 `constants.ts` 的 `PermissionResource` 是 **平台** 的權限目錄（api-sdk 的 `PlatformPermissionKey`，[`docs/rbac/02-permission-catalog.md`](../../docs/rbac/02-permission-catalog.md) §8）；
  其餘（hooks、registry、`evaluateAccess`）與 backstage 相同，同步時只比對這兩處以外的程式。權限由 `GET /platform/auth/profile` 的 `permissions` 水合。

### 同步規則

- 在任一邊修改上表的檔案時，**同一批** 檢查另一邊要不要一起改；安全相關（`core/auth`（含 `sso.ts`）、`core/client`、`plugins/fetcher`）與 `app/App.tsx` 的 `SessionWatcher`（登出後不自動跳回 IdP，ADR-0019 D5）一律一起改。
- **新增錯誤碼**：除了 backstage 的 `ERROR_MESSAGE_KEY` 與語系檔，這裡的 `core/errors/errorMessageKey.ts`、`app/locales/*.json` 也要加。
  兩邊的 `app/__tests__/locales.test.ts` 都直接讀後端的 `ALL_ERROR_CODES`，漏了任一邊都會失敗。
- 出現第三個前端時，評估把上表抽成 `packages/`（ADR-0019 D14）。
