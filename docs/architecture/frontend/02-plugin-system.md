# 前端 02 — Plugin 系統

## 1. 為什麼是 plugin 而不是直接 import

一個典型的 React app 會這樣長：`App.tsx` 認識所有 provider，`routes.tsx` 認識
所有頁面，`i18n.ts` 認識所有語系包，`menu.ts` 認識所有選單項。加一個功能要改
五個核心檔案，刪一個功能要記得五個地方。

Plugin 架構把方向反過來：**核心提供插槽，功能自己插進去。**
`main.tsx` 裡的一行 `.use(roleFeaturePlugin())` 是角色功能與整個 app 的唯一接點。
註解掉那一行，角色功能就完整消失——路由、語系、權限、選單全部一起消失，
不留殘骸。

詳細取捨見 §8。

---

## 2. 型別骨架

```ts
// shared/context/type.ts — 通用、與 app 無關
export type PluginState = Record<string, unknown>;

export interface PluginEvents extends ListenerDict {
  init: () => void;
  destroy: () => void;
}

export interface PluginHooks {
  init: () => void;
  destroy: () => void;
}

/** plugin factory 收到的東西：狀態、事件、以及取得整個 context 的逃生口 */
export interface PluginContext<State, Events, Instance> {
  state: StoreApi<Partial<State>>;      // @b2b-system/web-shared/store 的 createStore，與 CoreContext.state 同一個
  prop: <K extends keyof State>(key: K, value?: State[K]) => State[K] | undefined; // 讀取會被追蹤
  watch: <T>(getter: (state) => T, callback: (value: T, previous: T) => void) => () => void; // plugin destroy 時自動停止
  on / emit / off: EventEmitter<Events>;
  clearup: (fn: () => void) => void;
  getInstance: () => Instance;
}

/** plugin factory 回傳的東西 */
export type PluginResults<Attrs, Hooks> = {
  name: string;                        // 唯一；同名會取代前一個
  attrs?: Partial<Attrs>;              // 掛到 context 上的能力
} & Partial<{
  onInit: () => void | Promise<void>;
  onDestroy: () => void;
}>;

/** App 啟動後才安裝的 plugin 不能提供 attrs（§9.2 D3）。 */
export type DynamicPluginFactory = (ctx: PluginContext) => Omit<PluginResults, 'attrs'> & { attrs?: never };

/** 容器（CoreContext）的生命週期方法，見 §3 */
use(factory): CoreContext;                  // 同步註冊
load(): Promise<CoreContext>;               // 初始化尚未初始化的；可重入
install(factory: DynamicPluginFactory): Promise<string>; // 執行期安裝，回傳 plugin 名稱
uninstall(name: string): void;              // 卸載並撤回註冊
pluginStatus(name): 'registered' | 'initializing' | 'ready' | 'failed' | undefined;
destroy(): void;
```

```ts
// web-core/app/context.ts — app 專用的具體化
export interface AppPluginProperties {} // 由各 plugin 用 declaration merging 擴充
export interface AppPluginHooks {}
export interface AppContextState {}
export interface AppContextEvents {}

export type AppContext = CoreContext<
  AppPluginProperties,
  AppPluginHooks,
  AppContextState,
  AppContextEvents
>;

export type AppPluginFactory = (
  ctx: AppPluginContext,
) => PluginResults<AppPluginProperties, AppPluginHooks>;

export function createAppContext(): AppContext;
// 沒有模組層級的 getter：plugin 經由 ctx.getInstance()、React 經由 useAppContext()（web-core/app/react.tsx）取得
```

### 2.1 Declaration merging：plugin 如何擴充 context 型別

這是整個機制的關鍵技巧。plugin 在自己的檔案裡宣告它往 context 上加了什麼：

```ts
// web-core/plugins/app/i18n.ts（app 的 plugins/app/i18n.ts 只傳入自己的語系包）
export function i18nPlugin(): AppPluginFactory {
  return (context) => ({
    name: 'i18n',
    attrs: {
      i18n: i18nInstance,
      addResourceBundle,
      changeLanguage,
    },
    onInit: async () => { await i18nInstance.init(...); },
  });
}

declare module '../../app/context' { // app 裡寫 '@b2b-system/web-core/app/context'
  interface AppPluginProperties {
    i18n: typeof i18nInstance;
    addResourceBundle: typeof addResourceBundle;
    changeLanguage: typeof changeLanguage;
  }
}
```

從此 `ctx.getInstance().addResourceBundle(...)`（plugin）與 `useAppContext().addResourceBundle(...)`（React）都有完整型別。
**`web-core/app/context.ts` 完全不需要知道有 i18n 這個東西。**
app 擴充時指向定義的檔案 `@b2b-system/web-core/app/context`；指向 `@b2b-system/web-core/app`（index）不會合併到同一個介面。

---

## 3. 生命週期

```
createAppContext()
  │
  ▼
.use(pluginA())          ← ① factory 被 **同步** 呼叫
  │                          回傳 { name, attrs, onInit, onDestroy }
  │                          attrs 立刻合併到 context 上
  │                        ★ 需要「render 前必定完成」的註冊寫在這裡
  │                          （頁面權限、偏好註冊、元件註冊）
  ▼
.use(pluginB())          ← 同上，依序
  │
  ▼
.load()                  ← ② 依註冊順序 **依序 await** 每個尚未初始化的 onInit
  │                          ★ 非同步初始化寫在這裡
  │                          （載入語系包、向後端問設定、開 BroadcastChannel）
  │                          可以重複呼叫：已初始化的不會重跑
  ▼
render
  ⋮
context.install(plugin)  ← ④ App 啟動後安裝（可啟用的 feature，§7）
  │                          同步執行 factory → 只 await 它自己的 onInit
  │                          onInit 失敗 → 自動卸載並把例外往外拋
context.uninstall(name)  ← ⑤ 卸載：onDestroy → 停止 watch → clearup → 撤回註冊
  ⋮
context.destroy()        ← ③ 逆向清理：逐一卸載每個 plugin（每一步各自 try/catch）
                             清空 plugin 表、清 store
```

factory 與 `onInit` **同步部分** 裡的註冊表登記，會被容器以 `collectRegistrations()`
（`@b2b-system/web-shared/registry`）收集起來，卸載時一併撤回。feature 照舊呼叫 `registerXxx()`，
不必自己保存回傳的反註冊函式。`onInit` 裡 `await` 之後才做的登記收不到，不要這樣寫。

### 3.1 兩個階段的分工（重要）

|            | `use()` 階段（同步）            | `load()` 階段（非同步）  |
| ---------- | ------------------------------- | ------------------------ |
| 時機       | 立刻                            | 全部 `use()` 之後        |
| 可否 await | ❌                              | ✅                       |
| 適合做     | 註冊到各種 registry、掛 `attrs` | I/O、網路、開通道        |
| 範例       | `registerRolePagePermissions()` | `addResourceBundle(...)` |

**為什麼權限註冊必須在同步階段**：`usePagePermission()` 用
`requirePagePermission()`，miss 時 **丟例外而非回傳 undefined**（不 fail-open）。
如果註冊發生在 `onInit`，那麼在 `load()` 完成前的任何 render 都會炸。放在同步
階段就從結構上排除了這個競態。

### 3.2 `onDestroy` 的必要性

plugin 常持有 context 摸不到的資源：`BroadcastChannel`、`setInterval`、
`window` 監聽器、`SharedWorker`。`destroy()` 會逐一呼叫它們的 `onDestroy`，
每一個各自 `try/catch`——**一個 plugin 清理失敗不能拖累其他 plugin**。

同名 plugin 重複 `use()` 時也會先呼叫舊的 `onDestroy` 再替換，讓 HMR 與測試
重建 context 不會累積洩漏。注意替換發生在新的 factory **執行之後**：新舊兩份若登記同一個
註冊表鍵，新的會先撞到「already registered」。要重新安裝就先 `uninstall()` 再 `install()`。

---

## 4. Plugin 目錄

### 4.1 `plugins/app/` — 基礎設施

實作在 `@b2b-system/web-core/plugins/app`；app 的 `src/plugins/app/index.ts` 是門面：轉出 package 的 plugin，
`i18n.ts` 以 `i18nPlugin({ locales })` 傳入自己的全域語系包，backstage 另有 `batch-queue.ts`。

| Plugin              | `attrs` 提供                                  | `onInit` 做什麼                                                      |
| ------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| `cachePlugin`       | `queryClient`, `dictStorage`                  | `queryClient.start()`：開始收其他分頁的失效（`onDestroy` 時 `stop()`） |
| `eventBusPlugin`    | `eventBus`                                    | 建立全域 `EventEmitter<GlobalEventMap>`（事件與 payload 定義在 `web-core/app/events.ts`） |
| `i18nPlugin`        | `i18n`, `addResourceBundle`, `changeLanguage` | `i18next.init()`、載入 app 層語系包                                  |
| `httpContextPlugin` | `sessionStore`（主後端）                      | 依傳入的後端清單，每個後端建立一個 `SessionStore` 與 `<後端>:base` / `<後端>:auth` 兩個 HttpContext（30 秒逾時）並掛上攔截器鏈；某個 session 結束只中止該後端的 `auth` 請求；主 session 結束時一併結束其他後端的 session（[05 §3.3、§3.5](./05-data-layer.md)） |
| `componentPlugin`   | `componentRegistry`                           | 建立元件註冊表（讓 feature 覆寫核心元件）                            |

### 4.2 `web-core/plugins/fetcher/` — HTTP 攔截器

這些不是 AppContext plugin，是 `HttpContext` 的攔截器，由 `httpContextPlugin`
組裝：

| 攔截器             | 職責                                               |
| ------------------ | -------------------------------------------------- |
| `auth.ts`          | `createAuthHeaderInterceptor(session)`：請求前 `ensureAccessToken()`，加上 `Authorization`；每次重放都會重跑 |
| `refresh-token.ts` | `createRefreshTokenInterceptor(session)`：401 → **強制**續期（被拒的 token 未到期也一樣；已被別的請求換新則沿用）→ 重放原請求；只結束自己綁定的 session |
| `retry.ts`         | 網路錯誤與 5xx 指數退避重試；只重試 `GET`/`HEAD`/`OPTIONS`，不重試 4xx 與中止 |
| `api-adapter.ts`   | 把後端錯誤信封轉成 `AppError`                      |

### 4.3 `plugins/features/` — 功能擴充

**這一類是這個架構最有價值的地方。** 它讓 A 功能擴充 B 功能，而 B 完全不需要
知道 A 存在。

例：偏好設定頁（屬於 `features/account`）需要有「表格欄位設定」分頁，而欄位
設定的知識屬於各個列表頁。作法：

```ts
// plugins/features/table-column-settings/plugin.ts
// 只有偏好頁會渲染：登記 lazy 元件，分頁本體（TableSettings 帶的 dnd-kit）不進首屏
const TableColumnsSection = lazy(() =>
  import('./TableColumnsSection').then((module) => ({ default: module.TableColumnsSection })),
);

export function tableColumnSettingsPlugin(): AppPluginFactory {
  return (context) => {
    // 同步階段：往 web-core/preference 的註冊表插一個分頁
    registerPreferenceSection({
      key: 'table-columns',
      order: 200,
      labelI18nKey: 'preference.tableColumns.title',
      Component: TableColumnsSection,
      localeScope: TABLE_COLUMN_SETTINGS_LOCALE_SCOPE, // 偏好頁的 loader 會一併載入
    });
    return {
      name: 'plugin-table-column-settings',
      onInit: async () => { await addResourceBundle(..., { scope: SCOPE }); },
    };
  };
}
```

`features/account` 的偏好頁只做一件事：放一個 `<PreferenceSections />`（`web-core/preference`，兩個 app 共用），它依 `order`
渲染註冊表裡的分頁。**拿掉 `main.tsx` 裡那一行，這個分頁就消失了。** 目前的分頁：`notification`（100，`features/notification`，
[`15-notification.md`](./15-notification.md) §10）、`table-columns`（200）。

分頁元件 **以 `lazy()` 登記**：註冊發生在 plugin 的同步階段，直接登記元件本體會把它和它用到的套件帶進首屏，
實際上只有偏好頁（本身是 lazy chunk）會渲染它。`PreferenceSections` 以 `<Suspense>` 包住每個分頁，下載中顯示骨架
（`preference-section-skeleton`），其他分頁照常顯示。頂列工具（§4.4）則不同：它們本來就在首屏渲染，直接登記元件。
首屏不該出現的模組由 backstage 的 `app/__tests__/entry-imports.test.ts` 檢查（沿著 `main.tsx` 的靜態 import 走一遍）。

分頁要列出「有哪些表、各有哪些欄位」，但不能 import 各 feature。所以 `web-core/preference` 另有一份
**列表註冊表**：feature 在 plugin 的同步階段呼叫 `registerPreferenceTable({ id, labelI18nKey, columnLabelKeys, localeScope })`
（見各 feature 的 `preference.ts`），分頁用 `getPreferenceTables()` 列出，並用列表上同一個 `TableSettings` 調整。
`id` 與 `RichTable` 的 `settings.tableId` 相同，兩邊讀寫同一份 `web-core/store/tableColumnSettings`。
偏好頁的 route loader 是 `preferenceLocaleLoader()`：各分頁與各列表名稱所在的 scope 都會先載入。
loader 只看得到進頁當下的註冊表：可啟用的 feature（§7、§9）在 profile 回來後才安裝，它的列表會晚一步出現在偏好頁，
所以頁面另外呼叫 `usePreferenceLocales()`，依註冊表的目前內容要求語系包（還沒登記的在登記時補載）；載完後 `useTranslation` 換新 `t`，
畫面跟著更新（否則直接打開 `/preference` 時只會看到語系 key，[`08-i18n.md`](./08-i18n.md) §2.2）。

### 4.4 頂列工具（`web-core/toolbar`）

頂列（Header）的工具（語言、主題切換……）也是註冊表：在 plugin 的同步階段呼叫
`registerHeaderTool({ key, order, labelI18nKey, icon, Component })`，頂列（`web-core/layout/HeaderToolbar.tsx`）
與偏好頁的「頂列工具」區塊（`web-core/layout/HeaderToolbarSettings.tsx`，由 `features/account` 放進偏好頁）都只讀註冊表，
**追加工具不必改這兩處**。內建工具在 `app/layouts/headerTools.ts` 登記，由 `app/plugin.ts` 呼叫；
屬於某個 feature 的工具在該 feature 的 plugin 登記。

| 項目 | 規則 |
| --- | --- |
| 使用者設定 | 偏好頁拖曳排序、開關顯示，立即生效；存在 `preference` dictStorage 的 `headerToolbar` 鍵（`useHeaderToolbarStore`），**只存本機**、跨分頁同步 |
| 存的內容 | `{ order, hidden }`；沒調整過是 `null`，照 `order` 欄位的預設順序全部顯示 |
| 新追加的工具 | 不在已存 `order` 裡的工具接在最後、預設顯示（`resolveHeaderTools`），不必遷移使用者的設定 |
| 移除的工具 | 已存設定裡找不到的 key 直接略過 |
| `key` | 存進設定的鍵，發佈後不要改名 |
| `labelI18nKey` | 放在全域語系包（web-core 的 `locales/resources` 或 app 的 `app/locales`），偏好頁之外的 scope 未必載入 |
| 放不下時 | 頂列從尾端把工具收進「更多」彈層，工具在彈層裡照常運作（[`07-ui-system.md`](./07-ui-system.md) §3.14）；偏好頁的順序因此也決定窄螢幕時誰先被收起 |

內建工具依序是批次佇列（`batchQueue`，關掉只是不顯示按鈕，批次結果仍由 `BatchQueueNotifier` 彈出）、即時連線狀態（`realtimeStatus`，[11 §8.1](./11-realtime.md)）、語言（`language`）、主題（`theme`）。
帳號選單是身分入口，固定顯示在最右側，不在註冊表裡。
feature 登記的工具：站內通知的鈴鐺（`notification`，order 400，[`15-notification.md`](./15-notification.md) §2）。

---

## 5. 一個 feature plugin 的標準形狀

```ts
// features/role/plugin.ts
import { LanguageNamespace, Languages } from "@b2b-system/web-shared/constants";
import type { AppPluginFactory } from "@b2b-system/web-core/app";
import { ROLE_LOCALE_SCOPE } from "./locale";
import { registerRolePagePermissions } from "./permission";
import { registerRolePreferences } from "./preference";

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段 ──────────────────────────────────────────
    registerRolePagePermissions(); // 權限註冊表
    registerRolePreferences(); // 偏好註冊表（若有）

    const app = context.getInstance();

    return {
      name: "app-role-feature-plugin",
      // ── 非同步階段 ──────────────────────────────────────
      onInit: async () => {
        await app.addResourceBundle(
          {
            [Languages.EN_US]: {
              [LanguageNamespace.TRANSLATE]: () => import("./locales/en_US.json"),
            },
            [Languages.ZH_TW]: {
              [LanguageNamespace.TRANSLATE]: () => import("./locales/zh_TW.json"),
            },
          },
          { scope: ROLE_LOCALE_SCOPE }, // ★ scope → 進入該 feature 時才真正載入
        );
      },
    };
  };
}

// 語系資源的型別
declare module "@b2b-system/web-core/locales" {
  interface LocaleResourceMap {
    feature_role: typeof import("./locales/en_US.json");
  }
}
```

`features/role/index.tsx` 則負責把頁面元件接到 route 上並對外匯出：

```tsx
import * as Pages from "./pages";
import * as Routes from "./routes";

Routes.RoleListRoute.update({ component: Pages.AsyncRoleListPage });
Routes.RoleCreateRoute.update({ component: Pages.AsyncRoleCreatePage });
// …

export { Routes };
export { appContextPlugin as roleFeaturePlugin } from "./plugin";
```

> **為什麼 route 與 component 分兩個檔案綁定**：`routes/pages.ts` 只建立 route
> 物件（不含元件），`permission.ts` 需要 import 它來讀 base path。若 route 檔
> 直接 import 頁面元件，會把整個頁面樹拉進 `main.tsx` 的同步 bundle，
> code splitting 就沒了。`index.tsx` 在最後用 `.update()` 補上 lazy 元件。

---

## 6. 註冊表（Registry）模式

`web-core` 與 `core/` 的註冊表都用 `@b2b-system/web-shared/registry` 的 `createRegistry(describe)` 建立：
一個可訂閱的 store（`entries` 是 `ReadonlyMap`，每次變更換新）＋ 註冊函式（回傳反註冊函式）＋ 讀取函式
＋ 測試用的 reset。可訂閱與可撤回是為了 App 啟動後才安裝或被移除的 feature
（§9.2 D4）。

| 註冊表 | 位置 | 誰註冊 | 誰讀取（React 端訂閱的方式） |
| --- | --- | --- | --- |
| 頁面權限 | `web-core/permission/registry.ts` | 各 feature 的 `permission.ts` | 權限 hooks（`usePageAccess`、`usePageAccessChecker` 訂閱）、選單、Layout |
| 偏好分頁／列表 | `web-core/preference/registry.ts` | feature 或 `plugins/features/*` | 偏好頁（`usePreferenceSections`、`usePreferenceTables`） |
| 回收桶類型 | `core/trash/registry.ts`（backstage） | 擁有資源的 feature 的 `trash.ts` | 回收桶頁（`useTrashTypes`；[`13-trash.md`](./13-trash.md) §2） |
| 頂列工具 | `web-core/toolbar/registry.ts` | `app/plugin.ts` 或 feature（例：`features/notification` 的鈴鐺） | `useHeaderTools` |
| route id（跨 feature 與後端存的連結） | `web-core/route-link/registry.ts` | 擁有頁面的 feature 的 `routeLinks.ts` | `<RouteLink>`、`useRouteLinkAccess`、`useRouteLinkResolver`（[`15-notification.md`](./15-notification.md) §3、[`03-feature-anatomy.md`](./03-feature-anatomy.md) §4.1） |
| 批次操作 | `web-core/batch/operations.ts` | feature 的 `batch.ts` | 批次佇列（分頁向佇列宣告能執行的操作，§7） |
| 檔案預覽／驗證／縮圖 | `core/file/registry.ts`（backstage） | `features/file` 或 plugin | 檔案管理器（使用時讀取，不訂閱） |
| 語系包 | `web-core/locales/i18n.ts`（`addResourceBundle`） | 各 plugin 的 `onInit` | route loader（`localeScopeLoader`） |

共同規則：

- **重複註冊 → 丟例外**，不靜默覆寫。反註冊之後可以再登記同一個鍵。
- **讀取時 miss → 丟例外**（`requireXxx`），不 fail-open。
- 讀取端在 React 裡 **一律訂閱**（`useStore(xxxRegistry.store, …)` 或模組提供的 hook），
  不在 render 時直接呼叫 `getXxx()`——feature 可能在畫面已經渲染之後才安裝。
- 提供 `resetXxxRegistry()` 供測試在每個 `beforeEach` 重建。
- 有一支測試斷言「註冊表的鍵集合」等於「所有 feature 匯出的鍵之聯集」
  （`core/permission/__tests__/feature-registration.test.ts`），另一支斷言可啟用的 feature
  安裝後多出自己的鍵、卸載後回到原狀、可以重新安裝（`app/__tests__/features.test.ts`），
  取代靜態表原本提供的編譯期完整性。

---

## 7. 可啟用的 feature（執行期安裝）

設計決策見 §9。平台管理者對每個租戶開關的 feature
（目前是 `file`、`auditLog`、`job`、`trash`、`system`（id `systemSetting`）、`identity-provider`（id `identityProvider`）、`webhook`、`announcement`，
以及沒有頁面、只控制帳號選單項目的 `tenantSwitch`；[`architecture/05-tenancy.md`](../05-tenancy.md) §12），登入後才依 `/auth/profile` 的 `features` 安裝；
清單改變時 api 推播 `resource.changed`（`tenantFeature`），profile 重新取得後自動安裝或卸載。

| 角色 | 位置 | 做什麼 |
| --- | --- | --- |
| catalog | `app/features.ts` 的 `FEATURE_CATALOG` | id → `{ plugin, routes, requires? }`；`satisfies Record<TenantFeature, …>` 對齊後端 |
| 安裝器 | `core/feature/FeatureActivator.ts` | 比對清單，`install` / `uninstall`；狀態寫進 `featureStore` |
| 同步 | `app/features.ts` 的 `useSyncFeatures()`（掛在 `app/App.tsx` 的 `ProfileSync`） | 把 profile 的 `features` 與 `flags` 交給安裝器 |
| route guard | 最上層 route 的 `beforeLoad: requireFeature(<ID>)` | 已安裝 → 通過；未定 → 等待；未啟用 → 404；安裝失敗 → 錯誤頁 |
| 第二道防線 | `app/Layout.tsx` 的 `useFeatureGate()` | 同上的判斷，避免「頁面權限還沒註冊」被當成不受管而放行 |

把一個常駐 feature 改成可啟用：

1. 後端在 `TENANT_FEATURES` 加 id，controller 標 `@RequireFeature('<id>')`
   （[`../backend/`](../backend/README.md)；平台層開關見 [`../05-tenancy.md`](../05-tenancy.md)）。
2. feature 的 `plugin.ts` 改回傳 `AppDynamicPluginFactory`（**不能** 有 `attrs`）。
3. 最上層 route 加 `beforeLoad: requireFeature(<ID>)`，`<ID>` 以常數從 `routes/pages.ts` 匯出。
4. `main.tsx` 拿掉它的 `.use()`，加進 `FEATURE_CATALOG`。
5. 側邊選單不用改：未註冊的頁面 `usePageAccessChecker` 回 `false`，項目自動隱藏。
6. `app/__tests__/features.test.ts` 的 `EXPECTED_PAGES` 加一列。

feature 被停用時：目前頁面屬於它就先導向首頁並 toast（`ignoreBlocker`），再卸載；
各分頁向批次佇列重新宣告能執行的操作，佇列取消使用那些操作、尚未結束的工作。

### 7.1 Feature flag

[`architecture/05-tenancy.md`](../05-tenancy.md) §11.2 D9；後端與平台管理見 [`../05-tenancy.md`](../05-tenancy.md) §5.2。
`/auth/profile` 的 `flags` 是目前生效為開的 key，由 `useSyncFeatures()` 與 `features` 一起交給安裝器，存進 `featureStore.flags`。

| 要擋的東西 | 做法 |
| --- | --- |
| feature 內的一塊 UI | `useFlag('<key>')`（`core/feature`）在渲染時判斷，flag 變更時自動更新；不影響註冊 |
| 整個 feature 還在試行 | 登記進 `FEATURE_CATALOG` 並宣告 `requires: { flag: '<key>' }`：flag 開才安裝、關掉就卸載，其餘（`requireFeature`、`useFeatureGate`、卸載前導回首頁）照舊。flag 移除時從 catalog 拿掉、改回 `main.tsx` 的 `.use()` |
| 可啟用 feature 裡的新版 | `requires: { feature: '<id>', flag: '<key>' }`：兩者都要成立 |

`requires` 省略時等於 `{ feature: <catalog 的 id> }`（§9 的行為）。前端的隱藏只是體驗，對應的端點要標 `@RequireFlag`。

---

## 8. 設計決策：Plugin-based AppContext

> 原 ADR-0001，2026-09-19 決定。其中「所有 plugin 在 `load()` 前同步 `use()`」的前提，後來由 §9（可啟用的 feature）修改。

### 8.1 背景

前端需要一個機制，決定「一個功能如何接進整個 app」。典型的 React app 會讓
`App.tsx` 認識所有 provider、`routes.tsx` 認識所有頁面、`i18n.ts` 認識所有語系
包、`menu.ts` 認識所有選單項。新增一個功能要改五個核心檔案；刪除一個功能要記得
五個地方，漏掉的會變成死碼。

### 8.2 決定

採用 plugin-based AppContext：

```ts
createAppContext()
  .use(cachePlugin())
  .use(i18nPlugin())
  .use(roleFeaturePlugin())
  .use(appContextPlugin())
  .load();
```

- Plugin factory 在 `use()` 時 **同步** 執行，回傳 `{ name, attrs, onInit, onDestroy }`
- `attrs` 透過 TypeScript declaration merging 擴充 `AppPluginProperties`，
  核心不需要認識任何 plugin 的型別
- 需要 I/O 的初始化放 `onInit`，由 `load()` 依序 await
- 各種註冊表（權限、偏好、元件）在同步階段被寫入

### 8.3 理由

1. **增刪一個功能 = 增刪一行。** 註解掉 `.use(roleFeaturePlugin())`，角色功能的
   路由、語系、權限、選單全部一起消失，不留殘骸。
2. **核心不認識功能。** `web-core/permission/registry.ts` 沒有列舉頁面的靜態表，
   每個 feature 註冊自己的。新增 feature 不需要改 `core/` 或 web-core 任何一行。
3. **功能可以擴充功能。** `plugins/features/*` 讓 A 功能往 B 功能的註冊表插東西，
   B 完全不知道 A 存在。偏好頁的分頁就是這樣做的。
4. **已驗證。** 這套機制已在一個承載 14 個 feature 的管理後台上實際運行過。

### 8.4 代價

| 代價 | 緩解 |
| --- | --- |
| 比直接 import 多一層間接，新人需要時間理解 | 本文件與 [`03-feature-anatomy.md`](./03-feature-anatomy.md) 的 SOP |
| 失去「靜態表的編譯期完整性」 | 用 `registry.test.ts` 斷言註冊鍵集合 = feature page key 聯集（§6） |
| `use()` 同步 / `load()` 非同步的分野需要記住 | 文件明確標示；權限註冊必須在同步階段（否則首次 render 會炸） |
| 註冊順序有隱含相依（`httpContextPlugin` 必須在 `cachePlugin` 之後） | `main.tsx` 加註解說明；未來可加宣告式相依檢查 |

### 8.5 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 直接 import ＋ 集中式註冊表 | 就是要避免的那個問題 |
| Module Federation | 為跨部署的微前端設計，這裡是單一部署，複雜度不成比例 |
| Nx / Turborepo 的 library boundary | 只管相依方向，不解決「功能如何自我註冊」 |
| React Context 疊套 | 巢狀地獄；無法表達非 render 期的註冊（權限必須在 render 前完成） |

---

## 9. 設計決策：feature 執行期啟用

> 原 ADR-0021，2026-09-30 決定。修改 §8（原 ADR-0001）「所有 plugin 在 `load()` 前同步 `use()`」的前提；
> 牽動 [`frontend/07-ui-system.md`](07-ui-system.md) §13（批次佇列的分派）、[`architecture/05-tenancy.md`](../05-tenancy.md) §10（啟用清單以租戶為單位）。
> 程式碼仍在同一份 build，啟用與停用可在 App 啟動後發生；規格見 §7。

### 9.1 背景

§8 的 plugin 容器原本假設 **所有 feature 在 App 啟動時就確定**：`main.tsx` 依序 `use()`、`load()` 一次、最後建立 router。
之後要支援「哪些 feature 可用，執行期才決定」（例：租戶買了哪些模組、某個模組被平台暫時關閉），
而決定的時間點可能在第一次 render 之後（登入後才知道、使用中被切換）。

決定當時，在 App 啟動後才 `context.use(xxxFeaturePlugin())` 會有以下問題（下表是當時的程式現況，D 欄以 P 編號引用）：

| # | 現象 |
| --- | --- |
| P1 | 晚到的 plugin 的 `onInit` 永遠不會執行（語系包沒有登記）；再呼叫一次 `load()` 會讓 **所有** plugin 的 `onInit` 重跑 |
| P2 | route 加不進去：`routeTree` 在模組載入時就用靜態 import 組好，router 只建一次 |
| P3 | **未註冊的路徑一律放行**：`usePageAccess` 對 `resolvePageKey()` miss 回 `canAccess: true`；route 比頁面權限先存在時頁面沒有保護 |
| P4 | 註冊表（頁面權限、頂列工具、偏好分頁與列表、批次操作）是模組層級的 `Map`，沒有訂閱；側邊選單是 `app/` 裡寫死的常數 |
| P5 | 註冊表沒有反註冊；同名 plugin 再 `use()` 時舊的被 destroy，但重新註冊會丟 `already registered` |
| P6 | 佇列把工作交給尚未載入該 feature 的分頁時，該筆直接記成失敗（`BatchOperation "…" 尚未註冊`） |
| P7 | `attrs` 以 `Object.assign` 掛上 context，不是響應式的，已經 render 的元件看不到 |

### 9.2 決定

**動態到什麼程度**

| 方案 | 結論 |
| --- | --- |
| A. 啟動時決定、之後變更就整頁重新載入 | 不採用：清單可能要登入後才知道（登入頁已經 render）；使用中切換會丟掉未儲存的表單與進行中的批次佇列；access token 只在記憶體，重新載入要再走一次續期 |
| **B. 程式碼在同一份 build；哪些 feature 啟用、何時啟用、何時停用在執行期決定** | **採用**：所有可能的 feature 在編譯期都已知，型別、路由型別、測試的完整性都還保得住；變動的只有「啟用狀態」 |
| C. 遠端載入不在 build 內的模組（Module Federation、import map） | 不採用（延後）：§8 已因單一部署而排除；需要跨部署的版本相容、共用依賴、CSP 與完整性驗證，複雜度不成比例。B 的設計不擋住之後往 C 走 |

**具體決定**

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **feature 分兩種**：**常駐**（沒有它 App 就不成立的）維持同步 `use()`；**可啟用** 的 feature 登記在 `app/features.ts` 的 `FEATURE_CATALOG`：`{ [id]: { plugin, routes } }`，以 `satisfies Record<TenantFeature, …>` 對齊後端的 id。catalog 是 `app/` 的一部分，仍是唯一認識所有 feature 的組裝層。程式碼照樣在主 bundle（route 物件本來就要靜態組進 route tree，頁面本來就是 lazy），這裡不做 dynamic import | 不把所有 feature 都改成動態；常駐的部分行為不變，改動集中在可啟用的那些 |
| D2 | **context 支援啟動後安裝與移除**：新增 `context.install(factory): Promise<void>` 與 `context.uninstall(name)`。`install` 同步執行 factory（註冊表寫入）後，立刻 await 這一個 plugin 的 `onInit`；每個 plugin 記錄狀態 `registered → initializing → ready \| failed`，`load()` 只初始化尚未初始化的（可重入）。`onInit` 失敗 → 自動 `uninstall`、記 log，**不影響其他 feature** | 解 P1；把「單一 plugin 的完整生命週期」變成可以單獨執行的單位 |
| D3 | **可啟用的 feature 不得提供 `attrs`**：型別上以 `DynamicFeaturePluginFactory`（結果沒有 `attrs`）限制；需要對外提供能力就走註冊表或 eventBus | 解 P7：`attrs` 的型別透過 declaration merging 永遠存在，執行期卻可能不存在，是型別說謊 |
| D4 | **註冊表改成可訂閱、可反註冊**：`core/*/registry.ts` 改用 `@b2b-system/web-shared/store` 的 store；`registerXxx()` 回傳反註冊函式，plugin 以 `clearup` 收集，`uninstall` 時自動執行。讀取端改用 `useStore` 訂閱（`useHeaderTools`、偏好頁、`TableColumnsSection`、權限 hooks）。**重複註冊仍丟例外**（§8 的規則不變）——有了反註冊，重新安裝不會再撞到 | 解 P4、P5 |
| D5 | **側邊選單維持 `app/` 的靜態表，項目依頁面權限是否已註冊來顯示**：`usePageAccessChecker` 對未註冊的頁面回 `false`，而權限註冊表可訂閱（D4）之後，feature 安裝或卸載時選單自動出現或消失。不另做選單註冊表 | 選單的分組與順序本來就是組裝層的決定；少一個註冊表，也少一個「feature 要記得登記」的地方 |
| D6 | **route 物件維持靜態，啟用與否在 route 上判斷**：`app/routes.tsx` 照舊 import 所有 feature 的 route 物件組成完整的 route tree，**不在執行期改 route tree**。可啟用 feature 的最上層 route **自己** 宣告 `beforeLoad: requireFeature(<ID>)`（`core/feature`；TanStack Router 不允許事後以 `route.update()` 補上 `beforeLoad`）：已安裝 → 通過；清單還沒到或安裝中 → **等待**；未啟用 → `notFound()`；安裝失敗 → 錯誤頁；沒有 session → 不擋（導向登入頁交給 `SessionWatcher`） | 解 P2。執行期重建 route tree（`router.update`）會讓 `Register` 的型別與執行期脫節、已經掛著的 match 失效；B 方案下所有 route 在編譯期都已知，沒有必要。等待是必要的：route 的 loader 會下載語系包，必須在 feature 安裝（登記語系包）之後才跑 |
| D7 | **權限檢查不再對「屬於 feature 的路徑」放行**：`usePageAccess` 的「未註冊 → 放行」只保留給明確列出的公開前綴（`/auth`、devtools）；其他未註冊的路徑視為 **未就緒**（顯示載入中，不渲染頁面）。在 D6 之下正常情況不會發生，這是第二道防線 | 解 P3：fail-open 是這次問題裡唯一的安全性缺口 |
| D8 | **啟用清單的來源**：平台 DB 的 `tenants.features`（可啟用 feature 的 id 陣列），由平台管理者在 apps/platform 的租戶詳情頁開關，與 `allowExternalIdp`（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D22）同一種平台層開關。api 在 `/auth/profile` 回傳 `features`，前端與權限一起水合（同一個 query），存進 `core/feature` 的 store。平台管理者變更時，api 對該租戶的所有連線推播 `resource.changed`（來源 `tenantFeature`），前端依資源依賴圖重新取得 profile。前端比對新舊清單，對新增的 `install`、對移除的 `uninstall` | 與權限同一個節奏（[`backend/05-rbac.md`](../backend/05-rbac.md) §11），不多一個請求、不多一種推播事件；決定「租戶買了哪些模組」的是平台，所以放平台 DB |
| D9 | **停用時正在看的頁面**：卸載 **前** 若目前路由屬於該 feature，先導向首頁並 toast 說明；未儲存提醒（`useUnsavedChangesGuard`）**不** 攔（`ignoreBlocker`），與 session 結束時的處理一致。查詢快取不另外清除：離開頁面後沒有觀察者，由 `gcTime` 回收 | 被停用的 feature 的頁面已經不能操作（api 也會拒絕，見 D11），留在原頁只會一直報錯；先離開再卸載，頁面才不會在權限註冊撤回後以「未註冊」的狀態重新渲染 |
| D10 | **批次佇列認不得的操作不判定失敗**：分頁連上佇列後宣告自己能執行的操作（`capabilities`），註冊表變動時重新宣告；佇列只把項目交給宣告支援的分頁，沒有分頁支援時該工作保持排隊（其他分頁安裝完成後接手）。分頁的操作 **減少**（feature 被卸載）時送 `cancel-operations`，佇列取消使用那些操作、尚未結束的工作（與使用者按取消相同，狀態 `cancelled`） | 解 P6。各分頁安裝的時間點不同（剛開的分頁要等 profile），不該因此讓工作失敗；卸載只會因為租戶停用了 feature，而那對所有分頁都成立 |
| D11 | **前端的啟用狀態不是存取控制**：api 以 `@RequireFeature('<id>')` 標在 controller 上，由全域 guard 判斷；未啟用回 `FEATURE_DISABLED`（**404**，不暴露功能存在，與 [`architecture/05-tenancy.md`](../05-tenancy.md) §11 的 `@RequireFlag` 相同）。該 feature 的背景工作照常執行（資料仍在，重新啟用後要是一致的） | 前端的隱藏只是體驗；與權限「由伺服器判定」（[`backend/05-rbac.md`](../backend/05-rbac.md) §11）同一個原則 |
| D12 | **完整性測試改寫**：`feature-registration.test.ts` 改為「對 catalog 裡每個 feature 執行 `install` 後，註冊的鍵集合 = 常駐 feature 的鍵 ∪ 該 feature 的鍵；`uninstall` 後回到常駐的集合」，並加上 install → uninstall → install 不丟例外的案例 | 保住 §8 用測試取代編譯期完整性的做法，並驗證 D4 的反註冊確實乾淨 |

### 9.3 流程

**啟動與登入**

```
bootstrap
  ├─ use(常駐 plugin …) → use(featureActivationPlugin) → use(appContextPlugin) → load()
  ├─ createRouter（完整 route tree，含可啟用 feature 的 route）
  └─ render
登入成功（session 建立）
  ├─ /auth/profile → { user, roles, permissions, features }
  ├─ useSyncPermissions：權限水合
  └─ useSyncFeatures：FeatureActivator.apply(features)
       └─ 對新增的 id：context.install(plugin)
            ├─ 同步：註冊權限、偏好、批次操作 → 各註冊表通知訂閱者，選單與頁面自動更新
            └─ onInit：登記語系包
```

**直接貼可啟用 feature 的網址**：`beforeLoad: requireFeature` 等待「清單已套用且該 feature 不在安裝中」→ 通過後才跑 route 的 loader（語系下載）與權限判斷；
清單套用後不在清單內 → 404。沒有 session 時不擋，照舊由 `SessionWatcher` 導向登入頁。
Layout 以 `useFeatureGate` 再擋一次（D7）：未定 → 骨架屏、未啟用 → 404、安裝失敗 → 錯誤頁。

**使用中被停用**：平台管理者改了清單 → api 對租戶的連線推 `resource.changed`（`tenantFeature`）→ 依賴圖讓 profile 重新取得
→ `FeatureActivator.apply()` → 目前頁面屬於被移除的 feature 就先導向首頁 → `context.uninstall(name)`
→ 撤回註冊（選單項目消失、偏好分頁消失、批次操作消失）→ 分頁向佇列重新宣告操作，佇列取消該 feature 的工作。

### 9.4 代價

| 代價 | 緩解 |
| --- | --- |
| 註冊表從 `Map` 改成 store，每個讀取端都要改成訂閱 | 共用的 `createRegistry()`（`@b2b-system/web-shared/registry`）；plugin 容器以 `collectRegistrations()` 包住 factory 與 `onInit`，feature 的註冊寫法完全不變 |
| 可啟用 feature 的程式碼仍在主 bundle 裡 | route 物件不含頁面元件，量很小；真正的頁面仍是 lazy |
| 「安裝中」多了一個狀態：選單項目與頁面會在登入後才出現 | 選單在權限水合前本來就是空的（`useMenuItems`），清單與權限並行取得，使用者看到的時間點不變 |
| 可啟用 feature 不能提供 `attrs` | 決定當時沒有 feature 提供 `attrs`；需要時走註冊表 |
| 前後端要各維護一份「feature id」 | feature id 由 api 定義成 enum，經 OpenAPI 產進 `@b2b-system/api-sdk`（與權限鍵同一個做法，[`backend/03-api-conventions.md`](../backend/03-api-conventions.md) §12），前端的 catalog 以型別檢查涵蓋所有 id |

### 9.5 原本待決、已定案的事項

1. **清單存在哪裡、誰能改**：只做平台層（平台 DB 的 `tenants.features`，apps/platform 設定），見 D8。租戶內自行開關（租戶管理者在 backstage 設定）這次不做；需要時在平台的「可用」之下再加一層「開啟」。新租戶與既有租戶預設啟用全部。
2. **可啟用的 feature**：當時定為 `file`、`auditLog`、`job`。其餘維持常駐：
   - `approval`：使用者註冊的審核（`user-registration.approval.ts`）依賴它，停用會讓核心流程壞掉。
   - `identity-provider`：已經由 `allowExternalIdp`（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D22）開關，不做第二套。
   - （後續：[`architecture/05-tenancy.md`](../05-tenancy.md) §12 把 `trash`、`systemSetting`、`identityProvider`、`tenantSwitch` 也改成可啟用，`allowExternalIdp` 併進清單；目前的清單見 §7。）
   - `auth`、`home`、`account`、`user`、`role`、`permission`、`system`：RBAC 骨架本身。
3. **使用者層級的啟用**：不做；「同一個租戶裡只有部分人可用」由權限表達。
4. **與 feature flag（[`architecture/05-tenancy.md`](../05-tenancy.md) §11）的關係**：這裡處理的是 **長期存在的模組**（商業上的開通），不會被移除；
   feature flag 處理的是 **會被移除的暫時開關**。flag 實作時沿用這裡的前端機制（`install` / `uninstall`、可訂閱的註冊表），不必再「只在讀取時判斷」（§7.1）。

### 9.6 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 啟動時一次取得清單、變更時整頁重新載入 | 見 §9.2「動態到什麼程度」A |
| 執行期重建 route tree（`router.update({ routeTree })`） | 型別與執行期脫節；已掛載的 match 會失效；B 方案下 route 在編譯期都已知，沒有必要 |
| 維持現狀，只在 UI 層依清單隱藏選單 | 路徑仍然可達（P3 的 fail-open 還在）；註冊表、語系、批次佇列的問題都沒解 |
| 每個 feature 各自讀 feature flag 決定要不要註冊 | 決定點散落在各 feature；啟用狀態變更時沒有人負責反註冊 |
