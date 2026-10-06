# @b2b-system/web-core

backstage 與 apps/platform 共用的 **前端機制層**：AppContext 與 plugin、session、HTTP client 與攔截器、快取、權限機制、i18n、推播、批次佇列、路由、全域 store，
以及外框（providers、頂列工具）與列表頁的 `RichTable`。在分層裡位於 `@b2b-system/ui` 之上、app 之下（[`docs/conventions/07-layer-dependencies.md`](../../docs/conventions/07-layer-dependencies.md) §2）。
整體的設計與決策（為什麼這樣切、程式該放哪、陷阱）見 [`docs/architecture/frontend/17-shared-packages.md`](../../docs/architecture/frontend/17-shared-packages.md)。

只有原始碼、不 build：由各 app 自己的 Vite 編譯。`exports` 是 `"./*": "./src/*/index.ts"`，另外單獨開放
`./app/context`、`./permission/register`（給 module augmentation 指向定義的檔案）與 `./locales/resources/*.json`。

## 匯入

一個模組一個子路徑，對應 `src/<module>/index.ts`：

```ts
import { useLocaleStore } from '@b2b-system/web-core/store';
import { defineAuthFetcher } from '@b2b-system/web-core/client';
import { RichTable } from '@b2b-system/web-core/components';
import { renderWithPermissions } from '@b2b-system/web-core/testing'; // 只給測試
```

| 子路徑 | 內容 |
| --- | --- |
| `app` | `AppContext` 型別、`createAppContext()`、React bridge、跨 feature 的事件（`events.ts`） |
| `auth` | `SessionStore`（token 生命週期、跨分頁單飛續期）、`signOut`（先結束前端、再撤銷後端；回傳後端是否完成）、SSO 的瀏覽器端（`sso.ts`：PKCE、授權網址、end-session 網址） |
| `batch` | 全域批次佇列（SharedWorker 排程、進度條、頂列面板、結果彈出） |
| `cache` | `queryClient`（`AppQueryClient`）、依賴圖引擎（`resourceGraph`）、跨分頁失效 |
| `client` | `HttpContext`／`FetcherContext`／`defineFetcher`／攔截器鏈 |
| `components` | 錯誤頁：`ErrorPage`（外框；`variant` 由 app 決定：backstage `centered`、apps/platform `compact`）、`ForbiddenPage`、`NotFoundPage`、`UnexpectedErrorPage`、`RouteErrorPage`（router 的 `defaultErrorComponent`；舊 chunk 載入失敗提示重新整理）、`isChunkLoadError`；`AuthShell`（登入等不套外框的頁面，產品名由 app 傳入）、`PageSkeleton`、`PermissionGate`、`QueryError`、`RichTable` |
| `errors` | `AppError`、`ErrorCodes`、`ERROR_MESSAGE_KEY`、`useErrorMessage()` 等 |
| `layout` | 頂列：`HeaderToolbar`、`ThemeMenu`、`LanguageMenu`（`onChange` 由 app 傳入）、`RealtimeStatusIndicator`；偏好頁的 `HeaderToolbarSettings`；選單型別 |
| `locales` | i18n、scope loader、`useTranslation`、Zod 錯誤訊息、`CORE_LOCALES` 與合併工具 |
| `notify` | `useToast()` |
| `permission` | 權限的機制：hooks、頁面權限註冊表、`evaluateAccess`、`buildPermissionKey`；權限目錄由 app 登記（下方） |
| `plugins/app` | 基礎設施 plugin：cache、event-bus、http-context、i18n、realtime、theme |
| `plugins/fetcher` | 攔截器：auth 標頭、refresh、retry、client-id、api-adapter |
| `preference`、`toolbar` | 偏好頁分頁（以 `lazy()` 登記，由 `PreferenceSections` 以 `<Suspense>` 渲染）與可自訂欄位的表、頂列工具的註冊表 |
| `route-link` | route id 的註冊表、`<RouteLink>`（渲染前檢查目標頁的權限）、`useRouteLinkAccess`、`useRouteLinkResolver` |
| `realtime` | 推播的連線、協調者、`useRealtimeEvent()`；只有 `socketIoTransport.ts` import `socket.io-client` |
| `router` | `RootRoute`、搜尋參數、`useUnsavedChangesGuard`（路由）、`useDialogUnsavedGuard`（以 state 開關的對話框）、路由的 `staticData.titleKey`（`findTitleKey`） |
| `shell` | `GlobalProvider`（`profileQueryKey` 由 app 傳入）、`SessionWatcher`（session 結束時清掉使用者的資料並導向登入頁；登入頁路徑與公開頁面由 app 傳入）、`ToastHost`、`ConfirmDialogHost`、`ComponentLabelsHost`、`DocumentTitle`（「頁面 · 產品名」，`router` 與產品名的鍵由 app 傳入） |
| `store` | 全域 store：`permission`、`layout`、`preference`（語系、時區、主題、頂列工具）、`tableColumnSettings` |
| `theme` | `THEME_OPTIONS`、`resolveTheme()`／`applyTheme()` |
| `testing` | `renderWithPermissions`／`AllProviders`、`renderRoute`（回傳 `router` 與 `queryClient`）、`renderInRouter`（單一元件放進只有 `/` 的路由）、`fakeBatchQueue`、`initTestI18n`、語系檔的檢查（`localeKeySet`、`pluralProblems`、`hasLocaleKey`、`findFullWidthPunctuation`） |

## app 怎麼接上

**權限目錄**：package 只認得字串；app 在 `src/core/permission/index.ts` 登記自己的目錄，`PermissionKey`／`PermissionResource` 在那個 app 裡就收斂成它的鍵（沒登記時是 `string`）。
app 的程式碼照舊從 `@/core/permission` 匯入。

```ts
declare module '@b2b-system/web-core/permission/register' {
  interface PermissionRegister {
    key: AppPermissionKey;
    resource: AppPermissionResource;
  }
}
export * from '@b2b-system/web-core/permission';
export { ALL_PERMISSION_KEYS, PermissionKey } from './enums';
export { PermissionResource } from './resources';
```

**plugin 屬性**：擴充 `AppPluginProperties` 時指向定義的檔案 `@b2b-system/web-core/app/context`（指向 `/app` 的 index 不會合併）。

**全域語系包**：package 的 `src/locales/resources/{en_US,zh_TW}.json` 擁有 `common`、`error`、`validation`、`components`、`theme`、`language`、`realtime`、`layout`；
app 的 `plugins/app/i18n.ts` 以 `i18nPlugin({ locales })` 傳入自己的 `app/locales/*.json`，兩者深層合併、app 的鍵優先。
測試由 app 的 `src/test/i18n.ts` 包一層 `initTestI18n(zhTW, …)`。

**plugins**：app 的 `src/plugins/app/index.ts` 是門面（`export * from '@b2b-system/web-core/plugins/app'` ＋ 自己的 `i18nPlugin`；backstage 另有 `batch-queue.ts`）。

## 規則

- **不認識任何 app**：不 import `@/…`、`api-sdk` 產生的端點或任何 app 的 API；需要 app 的東西時由參數或 module augmentation 傳入（例：`profileQueryKey`、`LanguageMenu` 的 `onChange`）。
- **不出現業務名詞**：只放兩個 app 都用的機制；只有一個 app 用的留在該 app 的 `core/`（例：backstage 的 `core/{feature,file,permission-graph,trash}`）。
- 只依賴 `@b2b-system/ui`、`@b2b-system/web-shared`、`@b2b-system/error-codes`、`@b2b-system/realtime` 與第三方套件。
- 這裡的元件用到的字串放 `src/locales/resources/*.json`，兩個語系一起加。
- **新增錯誤碼**：碼加在 `@b2b-system/error-codes`；這裡的 `errors/errorMessageKey.ts` 加一列（`satisfies Record<ErrorCode, …>`，漏了編譯失敗）、兩個語系檔加 `error.<CODE>`（🔒 `locales/__tests__/resources.test.ts`）。app 不必改。
- 層級規則與 app 相同（`.oxlintrc.json` 也套用到 `packages/web-core/src/**`）；package 內部用相對路徑。

## 測試

```bash
pnpm --filter @b2b-system/web-core test
pnpm --filter @b2b-system/web-core typecheck
```
