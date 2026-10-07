# 前端共用的 packages

兩個前端（`apps/backstage`、`apps/platform`）共用的程式全部放在 workspace package，app 只留自己的頁面、API、權限目錄與外框。
這份文件講整體怎麼切、程式該放哪、app 怎麼接上；各 package 的子路徑與細則見各自的 README。

> 2026-10-05 起。取代 [`../04-sso.md`](../04-sso.md) §12.2 D14 的「apps/platform 複製 backstage 的程式」。

---

## 1. 全貌

```
                    ┌──────────────────────┐   ┌──────────────────────┐
                    │    apps/backstage    │   │    apps/platform     │
                    │ features/ apis/ app/ │   │ features/ apis/ app/ │
                    │ core/（門面＋專屬）   │   │ core/permission      │
                    └──────────┬───────────┘   └──────────┬───────────┘
                               └──────────────┬───────────┘
                                              ▼
                              ┌───────────────────────────────┐
                              │  @b2b-system/web-core         │  機制層：AppContext、session、HTTP、快取、
                              │  packages/web-core            │  權限機制、i18n、推播、批次佇列、外框、RichTable
                              └───────┬───────────────┬───────┘
                                      ▼               │
                              ┌───────────────┐       │
                              │ @b2b-system/ui│       │        設計系統：元件、token、icons、UnoCSS 設定
                              └───────┬───────┘       │
                                      ▼               ▼
                              ┌───────────────────────────────┐
                              │  @b2b-system/web-shared       │  框架無關的工具：store、channel、registry、date…
                              └───────────────┬───────────────┘
                                              ▼
              ┌───────────────────────────┐   ┌──────────────────────────┐
              │ @b2b-system/error-codes   │   │ @b2b-system/realtime     │   前後端共用的契約（api 也依賴）
              └───────────────────────────┘   └──────────────────────────┘

  @b2b-system/api-sdk：只有 app 的 apis/ 與 core/permission/enums.ts 使用（產物，由 api 的 OpenAPI 產生）
```

前端只用 api-sdk 的 **主入口**：型別、URL builder（`getXxxUrl`）與 enum（`PermissionKey`…），執行期零 zod；請求由 `apis/` 的 fetcher 經 `HttpContext` 送出。
zod schema 與 SDK 自己的 fetch client 在 `@b2b-system/api-sdk/schemas`，前端不 import——它會把所有端點的 schema 在載入時建構、帶進首屏
（[`../backend/03-api-conventions.md`](../backend/03-api-conventions.md) §12.6）。

依賴只能往下：package 永遠不 import app，`web-shared` 不 import `ui`，`ui` 不 import `web-core`。
完整矩陣與檢查方式見 [`../../conventions/07-layer-dependencies.md`](../../conventions/07-layer-dependencies.md) §1、§2。

| Package | 位置 | 編譯 | 內容 | 細則 |
| --- | --- | --- | --- | --- |
| `@b2b-system/web-shared` | `packages/web-shared` | 只有原始碼 | 原 `src/shared/*`：`store`、`hooks`、`channel`、`context`、`registry`、`storage`、`date`、`utils`、`constants`、`EventEmitter` | [README](../../../packages/web-shared/README.md) |
| `@b2b-system/ui` | `packages/ui` | 只有原始碼 | 設計系統元件、`icons/`、`styles/`（token、全域樣式）、`uno.config.ts`、Storybook | [README](../../../packages/ui/README.md)、[`07-ui-system.md`](07-ui-system.md) |
| `@b2b-system/web-core` | `packages/web-core` | 只有原始碼 | 原 `core/` 兩個 app 共用的模組、`plugins/{fetcher,app}`、`shell`（providers）、`layout`（外框 `DashboardShell`、側欄、頂列工具）、`components`（錯誤頁、`AuthShell`、變更密碼…）、背景工作與稽核列表的展示元件（`job`、`audit-log`）、共用語系、測試輔助 | [README](../../../packages/web-core/README.md) |
| `@b2b-system/error-codes` | `packages/error-codes` | `tsc` → `dist/` | api 的 `ErrorCode`、`ALL_ERROR_CODES`、`statusOf` | [README](../../../packages/error-codes/README.md) |

匯入一律走子路徑，一個模組一個入口：`@b2b-system/web-shared/store`、`@b2b-system/ui/Button`、`@b2b-system/web-core/permission`。
package 內部用相對路徑，不用 `@/`。

---

## 2. 程式該放哪

由上往下問，第一個「是」就是答案：

| # | 問題 | 放這裡 |
| --- | --- | --- |
| 1 | 只有一個 app 用、或兩個 app 的行為／端點本來就不同？ | 該 app（`features/`、`apis/`、`app/`；backstage 專屬的機制放 `core/`，例：`core/{feature,file,permission-graph,trash}`） |
| 2 | 碰到某個 app 的 API、權限鍵、路由或業務名詞？ | 該 app；或把那一點改成參數／module augmentation 後放 web-core（§3） |
| 3 | 依賴 AppContext、session、i18n、全域 store、TanStack Query／Router？ | `@b2b-system/web-core` |
| 4 | 是畫面元件，只依賴 props 與 token（文案由 `ComponentLabelsHost` 或 props 傳入）？ | `@b2b-system/ui` |
| 5 | 不依賴 React 以外的任何框架、也不碰 DOM 以外的環境？ | `@b2b-system/web-shared` |
| 6 | 前後端都要用的常數或型別（錯誤碼、推播事件）？ | `@b2b-system/error-codes`、`@b2b-system/realtime` |

一段程式第一次被第二個前端需要時，**搬進 package，不要複製**；先把它對 app 的依賴改成參數。

---

## 3. app 怎麼接上 web-core

web-core 不認識任何 app。需要 app 的東西時只有三種管道：module augmentation、參數、app 的門面。

### 3.1 權限目錄（module augmentation）

package 只放權限的機制（hooks、頁面權限註冊表、`evaluateAccess`、`buildPermissionKey`）。
`PermissionKey`／`PermissionResource` 是 `web-core/permission/register.ts` 的條件型別：app 登記了就是 app 的鍵，沒登記（package 自己的型別檢查與測試）就是 `string`。

```ts
// apps/<app>/src/core/permission/index.ts
import type { PermissionKey as AppPermissionKey } from './enums';
import type { PermissionResource as AppPermissionResource } from './resources';

declare module '@b2b-system/web-core/permission/register' {
  interface PermissionRegister {
    key: AppPermissionKey;
    resource: AppPermissionResource;
  }
}

export * from '@b2b-system/web-core/permission';
export { ALL_PERMISSION_KEYS, PermissionKey } from './enums'; // 具名匯出優先於 export *
export { PermissionResource } from './resources';
```

app 的程式碼照舊從 `@/core/permission` 匯入。backstage 的目錄是租戶的、apps/platform 的是平台的（[`../../rbac/02-permission-catalog.md`](../../rbac/02-permission-catalog.md)）；
寫錯鍵或資源名稱在兩個 app 都會編譯失敗。

### 3.2 plugin 屬性（module augmentation）

plugin 往 `AppContext` 加屬性時擴充 `AppPluginProperties`，**指向定義它的檔案** `@b2b-system/web-core/app/context`：

```ts
declare module '@b2b-system/web-core/app/context' {
  interface AppPluginProperties {
    router: AppRouter;
  }
}
```

### 3.3 全域語系包（合併）

web-core 的 `src/locales/resources/{en_US,zh_TW}.json` 擁有它自己用到的區段：`common`、`error`、`validation`、`components`、`theme`、`language`、`realtime`、`layout`、`changePassword`、`job`（共用的部分）、`auditLog`（共用的部分）。
app 的 `src/app/locales/*.json` 只放自己的區段（`menu`、`app`、`permission`…）與少數覆寫。

app 的 `plugins/app/i18n.ts` 把自己的語系檔交給 web-core 的 `i18nPlugin({ locales })`，兩者以 `mergeLocaleImporters` 深層合併，**app 的鍵優先**。
測試由 app 的 `src/test/i18n.ts` 包一層 `initTestI18n(zhTW, …)`。字串該放哪見 [`08-i18n.md`](08-i18n.md)。

### 3.4 參數

| 位置 | 參數 | 原因 |
| --- | --- | --- |
| `GlobalProvider`（`web-core/shell`） | `profileQueryKey` | 權限與後端不一致時要重抓 profile；profile 的 query 屬於 app 的 `apis/` |
| `LanguageMenu`（`web-core/layout`） | `onChange` | backstage 切換語系時同步到帳號，apps/platform 不同步；app 的 `app/layouts/LanguageMenu.tsx` 包一層傳入自己的 `useChangeLocale` |
| `i18nPlugin`（`web-core/plugins/app`） | `locales` | §3.3 |
| `DocumentTitle`（`web-core/shell`） | `router`、`appNameKey` | 與 `SessionWatcher` 一樣放在 `RouterProvider` 之外；產品名各 app 不同（backstage `app.title`、apps/platform `app.documentTitle`） |
| `SessionWatcher`（`web-core/shell`） | `router`、`loginPath`、`isPublic` | 登入頁的路徑與不需要 session 的頁面各 app 不同（`app/sessionRedirect.ts`）；導向登入頁的參數（`loginSearchAfterSessionEnd`）兩個 app 相同，在 web-core。權限水合等 app 的同步 hook 不當參數傳（React 不允許把 hook 當成值傳遞），由 `app/App.tsx` 的 `ProfileSync` 元件呼叫 |
| `DashboardShell`（`web-core/layout`） | `brand`、`navTopItems`、`navGroups`、`userName`、`accountPages`、`accountActions`、`afterContent` | 選單只有 app 認識所有 feature；品牌下方那一行與帳號選單的項目各 app 不同（`app/layouts/DashboardLayout.tsx`、`navigation.ts`） |
| `ForbiddenPage` 等錯誤頁（`web-core/components`） | `variant` | 兩個 app 原本的外觀不同：backstage `centered`（預設）、apps/platform `compact`（`app/ErrorPages.tsx`） |
| `AuthShell`（`web-core/components`） | `brand` | 產品名是 app 的 `app.title`；各 app 的 `pages/AuthShell.tsx` 包一層傳入 |
| `useChangePasswordForm`（`web-core/components`） | `mutationOptions` | 端點不同（`/auth/*`、`/platform/auth/*`）；狀態留在頁面，未儲存提醒才能與其他表單合成一個 |
| `sessionEndMessageKey`（`web-core/auth`） | `keys` | 登入頁的字串屬於各 app 的登入 feature（`auth.login.*`、`login.*`） |
| `JobTable`、`JobDetailView`（`web-core/job`）、`AuditLogTable`（`web-core/audit-log`） | `extraColumns`、`onRetryJob`、`renderDetail`、`renderJson`、`settings` | 端點與明細的取得屬於 app；apps/platform 多一個租戶欄；JSON 的呈現兩邊原本就不同 |

### 3.5 app 的門面

| app 的檔案 | 作用 |
| --- | --- |
| `src/core/permission/index.ts` | 登記權限目錄並轉出 web-core 的權限機制（§3.1） |
| `src/plugins/app/index.ts` | `export * from '@b2b-system/web-core/plugins/app'` ＋ 自己的 `i18nPlugin`（backstage 另有 `batch-queue.ts`） |
| `src/test/i18n.ts` | 測試的語系：web-core 的共用字串 ＋ app 的語系檔 |
| `src/shared/{api-sdk,websocket-sdk}` | app 對 `@b2b-system/api-sdk`、`@b2b-system/realtime` 的唯一引用點 |
| `src/shared/constants/env.ts` | `import.meta.env`（每個 app 的環境變數不同） |

---

## 4. 編譯與工具

- **只有原始碼的 package**（web-shared、ui、web-core）：`exports` 直接指向 `src/*.ts`，由 app 自己的 Vite 編譯。
  所以 CSS Module 的 class 前綴、UnoCSS 掃描、svgr 都沿用 app 的設定；backstage 的前綴是 `ge-`、apps/platform 是 `ga-`。不必 build，改了立即生效（HMR）。
- **build 到 `dist/` 的 package**（error-codes、realtime、api-sdk）：api 在 Node 執行時要用。新 clone 或改了它們之後要 `pnpm build:packages`（`pnpm dev` 會先跑）。
- **型別檢查**：每個 package 是一個 TypeScript project reference（`composite`，宣告檔輸出到 `dist-types/`）；app 的 `tsconfig.json` 列出它依賴的 package。`pnpm typecheck`（`tsc -b`）依序檢查。
- **測試**：每個 package 有自己的 `vitest.config.ts`；`pnpm test` 會跑所有 package。只改一個 package 時：`pnpm --filter @b2b-system/<name> test`。
- **Storybook** 在 `packages/ui`（`pnpm storybook`）。
- **Lint**：`.oxlintrc.json` 的前端規則也套用到 `packages/{ui,web-core}/src/**`；web-shared 的 `context/`、`store/` 另禁止 import React。
- **分層**：`packages/web-core/src/__tests__/layer-dependencies.test.ts` 掃三個前端 package 與每個依賴 web-core 的 app（[`../../conventions/07-layer-dependencies.md`](../../conventions/07-layer-dependencies.md) §4）；
  同一個資料夾的 `comment-paths.test.ts` 檢查註解裡的路徑存在。
- **Dockerfile**：前端與 api 的映像在 `pnpm install` 之前逐一複製各 package 的 `package.json`；新增 package 時三個 Dockerfile 都要加。
- **依賴**：app 不重複宣告只在 package 裡用到的套件（例：i18next、socket.io-client、codemirror 由 package 帶進來）。

---

## 5. 仍各自一份的部分

這些不是複製，而是兩個 app 的行為或端點本來就不同；app 只留那個不同點，結構與畫面在 web-core：

| 部分 | app 留下的差異 | 共用的部分（web-core） |
| --- | --- | --- |
| `core/permission/{enums,resources}.ts` | 租戶的權限目錄 vs 平台的權限目錄 | 權限機制（§3.1） |
| `apis/auth/*` | backstage 打 `/auth/*`，apps/platform 打 `/platform/auth/*`（同樣結構） | `client`、`auth` |
| `app/App.tsx`、`app/sessionRedirect.ts` | 登入頁的路徑與不需要 session 的頁面（`isPublic`） | `shell` 的 `SessionWatcher`（清除資料、導向登入頁且不自動跳回 IdP，[`../04-sso.md`](../04-sso.md) §12.2 D5）與 `loginSearchAfterSessionEnd` |
| `app/layouts/`（`DashboardLayout.tsx`、`navigation.ts`、`headerTools.ts`） | 選單資料、品牌下方那一行（backstage 是目前租戶、apps/platform 是「平台」）、帳號選單的項目（切換租戶／進入租戶）、頂列工具 | `layout` 的 `DashboardShell`、`SideNav`（樣式是 CSS Module） |
| `app/ErrorPages.tsx`（apps/platform） | 錯誤頁的版面 `compact`、載入中用 spinner（backstage 直接用 web-core 的預設） | `components` 的錯誤頁、`isChunkLoadError` |
| `features/auth`、`features/login` | SSO client、登入頁的語系鍵（`sessionEnd.ts` 只剩語系鍵的表）、`AuthShell` 的產品名 | `auth` 的 `sessionEndMessageKey`、`LOGOUT_REASON`、`PASSWORD_CHANGED_REASON`；`components` 的 `AuthShell` |
| `features/account` | 個人資料打不同的端點、資料形狀不同（user／admin）；偏好是否同步到帳號 | `components` 的 `ChangePasswordSection`／`useChangePasswordForm`、`preference` 的分頁 |
| `features/job`、`features/audit-log` | 端點、adapter、篩選、明細的取得與 JSON 的呈現；apps/platform 的租戶欄 | `job`、`audit-log` 的列表、佇列卡片、列上的操作、明細的版面 |
| 其他 `features/*` | 各自的頁面；同名的（`notification`）打不同的端點 | — |
| `public/theme-init.js` | Vite 的 public 目錄屬於 app；內容相同，測試在各自的 `app/__tests__/theme-init.test.ts` | — |

修改上表的安全相關部分（`apis/auth/*`、`sessionRedirect.ts`）時，同一批檢查另一個 app（[`apps/platform/README.md`](../../../apps/platform/README.md)）。

新的複製由 🔒 `packages/web-core/src/__tests__/duplicated-code.test.ts` 擋下：兩個 app 的同名檔案都超過 30 行、行集合相似度超過 0.7 就失敗。
刻意留著的相似檔案登記在測試的 `KNOWN_SIMILAR`（附理由）；其中登入頁與 SSO 回呼頁只差語系鍵，是下一個可以搬進 web-core 的候選。

---

## 6. 加第三個前端

1. `apps/<name>/`：Vite ＋ React，`package.json` 依賴 `@b2b-system/{web-shared,ui,web-core}`，`tsconfig.json` 列出三個 reference；`uno.config.ts` 轉出 `@b2b-system/ui/uno.config`；`src/index.css` 只有 `@import '@b2b-system/ui/styles.css';`。
2. `src/core/permission/`：自己的權限目錄並登記（§3.1）。
3. `src/plugins/app/`：門面與 `i18nPlugin`（§3.5、§3.3）；`src/app/locales/*.json` 放自己的字串。
4. `src/apis/auth/`：自己的 session 端點；`App.tsx` 以 `GlobalProvider`（`profileQueryKey`）包住 router。
5. 根目錄 `tsconfig.json`、`pnpm dev` 的 filter、Dockerfile、`.oxlintrc.json` 的路徑加上這個 app。
   web-core 的分層與註解路徑測試以 `package.json` 依賴 web-core 判斷，自動納入；`src/` 底下的資料夾要是 [`07-layer-dependencies.md`](../../conventions/07-layer-dependencies.md) §2.2 矩陣裡的層。

---

## 7. 常見陷阱

| 症狀 | 原因與解法 |
| --- | --- |
| plugin 的屬性在 app 裡「不存在」、`AppPluginFactory` 不相容 | augmentation 指向了 `@b2b-system/web-core/app`（index）。要指向定義的檔案 `@b2b-system/web-core/app/context`（§3.2） |
| 登記權限目錄時 `'key' is referenced directly or indirectly in its own type annotation` | `declare module` 區塊裡的 `PermissionKey` 指到 package 自己的型別。app 的型別以別名匯入（`AppPermissionKey`） |
| package 的測試裡 `toBeInTheDocument` 等 matcher 型別不存在 | package 的 devDependencies 版本與其他 package 不同（例：多宣告了不同版本的 `@types/node`），pnpm 為它另裝一份 vitest，jest-dom 的型別擴充掛不上。對齊版本或拿掉多餘的依賴 |
| api 啟動時找不到 `@b2b-system/error-codes`、或新錯誤碼不存在 | build 到 `dist/` 的 package 沒有重建：`pnpm build:packages` |
| 新字串在畫面上顯示成 key | 字串放錯地方：web-core 用的放 `packages/web-core/src/locales/resources`，app 用的放 app 的 `app/locales`（兩個語系一起加） |

---

## 8. 設計決策：抽成四個 package、web-core 以登記與參數接上 app

> 2026-10-05 決定。取代 [`../04-sso.md`](../04-sso.md) §12.2 D14（「apps/platform 複製 backstage 的程式，出現第三個前端再評估」）。

### 8.1 背景

apps/platform 建立時複製了 backstage 的 `shared/`、`components/`、`themes/`、`core/`、`plugins/` 與測試輔助（約 3.4 萬行），靠 README 的同步規則維持一致。
一個月內兩邊已開始分岔（例：`plugins/app/i18n.ts` 的型別轉換不同、`errorMessageKey.ts` 的順序不同），新增錯誤碼要改三處，前端測試還得以相對路徑動態 import api 的原始碼才能拿到錯誤碼清單。
複製的部分絕大多數逐字相同；不同的只有權限目錄、`core/` 的翻譯放在各 app 的語系檔、少數直接依賴 app API 的地方。

### 8.2 決定

| # | 問題 | 決定 |
| --- | --- | --- |
| D1 | 切成幾個 package | 依現有的層級切：`web-shared`（原 `shared/`）、`ui`（原 `components/`＋`themes/`＋icons）、`web-core`（原兩個 app 共用的 `core/`、`plugins/`、providers、頂列工具、測試輔助）；錯誤碼另成 `error-codes` 給 api 與前端共用 |
| D2 | 前端 package 要不要 build | **不 build**，`exports` 指向原始碼，由 app 的 Vite 編譯。CSS Module、svgr、UnoCSS、class 前綴沿用 app 的設定，HMR 直接生效，也沒有 dist 過期的問題；型別以 project reference 檢查 |
| D3 | app 不同的權限目錄 | **module augmentation**（`PermissionRegister`，同 TanStack Router 的 `Register`）：package 型別在 app 裡收斂成 app 的鍵，沒登記時是 `string`。不採「兩個目錄的聯集」：會讓 backstage 接受平台的權限鍵 |
| D4 | `core/` 用到的翻譯 | 兩個 app 相同的區段搬進 web-core 的語系檔，載入時與 app 的深層合併、app 優先。不採「package 只用鍵、翻譯留在 app」：package 的測試會沒有字串可驗證，第三個前端也要再抄一份 |
| D5 | web-core 需要 app 的東西 | 只透過 augmentation（D3、plugin 屬性）、參數（`profileQueryKey`、`LanguageMenu` 的 `onChange`、`i18nPlugin` 的 `locales`）與 app 的門面；web-core 不 import `@/…`、不呼叫任何 app 的 API |
| D6 | 只有一個 app 用的機制 | 留在那個 app 的 `core/`（backstage 的 `feature`、`file`、`permission-graph`、`trash` 與五個元件）。第二個 app 需要時再搬進 web-core |
| D7 | 錯誤碼 | `@b2b-system/error-codes` build 到 `dist/`（api 在 Node 執行時要用）；前端的 `ERROR_MESSAGE_KEY` 以 `satisfies Record<ErrorCode, …>` 在編譯期檢查漏碼與多出的碼，翻譯完整性由 web-core 的測試檢查 |
| D8 | app 的 import 寫法 | 子路徑一個模組一個（`@b2b-system/web-core/store`），不經過整包的 barrel；app 保留 `@/core/permission`、`@/plugins/app` 兩個門面，原本的呼叫端不必改 |

### 8.3 代價

- 一個改動可能跨 package 與 app 兩處；但「兩邊要一起改」從靠 README 提醒變成編譯與測試直接擋。
- module augmentation 的路徑有陷阱（§7），寫錯時錯誤訊息不直覺。
- 依賴版本要在 package 之間對齊，否則 pnpm 會裝出兩份同名套件（§7）。
