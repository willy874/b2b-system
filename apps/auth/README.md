# apps/auth

全平台共用、**不分工作區** 的身分與租戶入口（[ADR-0019](../../docs/adr/0019-sso-identity-platform.md)）。
各產品（backstage、之後的編輯器）的登入都會經過這裡；平台層級的管理（租戶、外部 IdP 連線）也放在這裡。
規劃與交付順序見 [`docs/features/sso.md`](../../docs/features/sso.md)。

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

## 目前的內容（交付順序 2：IdP 與單一登出）

| 路徑 | 說明 |
| --- | --- |
| `features/login` | `/interaction/:uid`：**IdP 的登入互動頁**，所有產品的密碼登入都在這裡（D16）；`/error`：provider 的協定錯誤；`/login`、`/callback`：apps/auth 自己的頁面也經 SSO 登入；帳號流程 `/forgot-password`、`/reset-password`、`/setup`、`/register`、`/invitation`（從 backstage 搬過來） |
| `features/home` | `/`：目前登入的身分；之後放租戶管理與外部 IdP 連線管理的入口 |
| `app/` | 自己寫的 App Shell：`App.tsx`（沒有 session 時導向 `/login`；登出後停在「已登出」頁）、`Layout.tsx`（頁面權限守衛）、`layouts/PlatformLayout.tsx`（沒有工作區切換器） |

沒有推播、批次佇列、feature flag、MSW mock 與 Storybook；需要時再從 backstage 帶過來。

## 從 apps/backstage 複製的程式碼（D14）

這一版 **複製**、不抽 package。下列模組整個資料夾（含測試）複製自 `apps/backstage/src` 的同一路徑：

| 位置 | 模組 |
| --- | --- |
| `core/` | `app`、`auth`、`cache`、`client`、`errors`、`locales`、`notify`、`permission`、`realtime`、`router`、`store`、`theme` |
| `components/` | `AlertDialog`、`Button`、`Checkbox`、`ConfirmDialog`、`Empty`、`Field`、`Icon`、`Input`、`Menu`、`Skeleton`、`Spinner`、`Table`、`Toast`、`Tooltip`、`VirtualList`，以及 `slots.ts`、`useControllableState.ts`、`useLatestRef.ts`、`types.ts` |
| `shared/` | `EventEmitter`、`api-sdk`、`channel`、`constants`、`context`、`hooks`、`storage`、`store`、`utils`、`websocket-sdk` |
| `plugins/` | `fetcher/`；`app/` 的 `cache`、`event-bus`、`http-context`、`i18n`、`theme` |
| `apis/auth/` | `get-profile`、`login`、`logout`、`refresh` |
| 其他 | `themes/`、`assets/icons/`、`index.css`、`public/theme-init.js`、`test/`（setup 與假物件）、`app/GlobalProvider.tsx`、`ToastHost.tsx`、`ConfirmDialogHost.tsx`、`plugin.ts`、`layouts/ThemeMenu.tsx`、`app/locales/*.json` |
| `features/login` | `hooks/`（`useLogoutMutation`、`useSyncPermissions`、`useSsoCallbackMutation`）、`pages/AuthShell.tsx`、`pages/Login/page.tsx` 與 `pages/SsoCallback/page.tsx`（與 backstage `features/auth` 的同名頁面相同流程，改過文案鍵與路由）、`sso.ts`（client id 不同） |
| 帳號流程（搬移，backstage 已刪除） | `features/login/pages/{ForgotPassword,ResetPassword,Setup,Register,Invitation}`、`apis/auth/{forgot-password,reset-password,setup,register}`、`apis/workspace/{get-workspace-invitation-preview,accept-workspace-invitation,signup-workspace-invitation}`；只存在 apps/auth，不需要同步 |
| SSO 的瀏覽器端 | `core/auth/sso.ts`（PKCE、授權網址、verifier）、`apis/auth/sso-callback/`、`shared/constants/env.ts` 的 `OIDC_ISSUER` |

`core/realtime` 與 `components/Table` 目前沒有畫面用到，是被 `core/cache`、`core/store` 依賴而一起帶進來的。

與 backstage 不同的地方：

- `components/__tests__/design-system.test.ts` 拿掉「每個元件都有 story」：Storybook 只在 backstage。
- `components/__tests__/ref-forwarding.test.tsx`、`slots.test.tsx` 只留有複製的元件；`core/permission/__tests__/feature-registration.test.ts` 改成 apps/auth 的 feature 清單。
- CSS Module 的 class 前綴是 `ga-`（backstage 是 `ge-`），DevTools 裡分得出是哪個 app。

### 同步規則

- 在任一邊修改上表的檔案時，**同一批** 檢查另一邊要不要一起改；安全相關（`core/auth`（含 `sso.ts`）、`core/client`、`plugins/fetcher`）與 `app/App.tsx` 的 `SessionWatcher`（登出後不自動跳回 IdP，ADR-0019 D5）一律一起改。
- **新增錯誤碼**：除了 backstage 的 `ERROR_MESSAGE_KEY` 與語系檔，這裡的 `core/errors/errorMessageKey.ts`、`app/locales/*.json`、
  `app/__tests__/locales.test.ts` 的錯誤碼清單也要加。兩邊的測試各有一份清單，只更新 backstage 那份時這裡不會失敗，要靠 review。
- 出現第三個前端時，評估把上表抽成 `packages/`（ADR-0019 D14）。
