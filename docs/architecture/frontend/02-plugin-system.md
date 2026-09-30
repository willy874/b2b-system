# 前端 02 — Plugin 系統

## 1. 為什麼是 plugin 而不是直接 import

一個典型的 React app 會這樣長：`App.tsx` 認識所有 provider，`routes.tsx` 認識
所有頁面，`i18n.ts` 認識所有語系包，`menu.ts` 認識所有選單項。加一個功能要改
五個核心檔案，刪一個功能要記得五個地方。

Plugin 架構把方向反過來：**核心提供插槽，功能自己插進去。**
`main.tsx` 裡的一行 `.use(roleFeaturePlugin())` 是角色功能與整個 app 的唯一接點。
註解掉那一行，角色功能就完整消失——路由、語系、權限、選單全部一起消失，
不留殘骸。

詳細取捨見 [ADR-0001](../../adr/0001-plugin-based-app-context.md)。

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
  state: StoreApi<Partial<State>>;      // @/shared/store 的 createStore，與 CoreContext.state 同一個
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

/** App 啟動後才安裝的 plugin 不能提供 attrs（ADR-0021 D3）。 */
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
// core/app/context.ts — app 專用的具體化
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
export function getAppContext(): AppContext; // 給 fetcher 等非 React 程式碼用
```

### 2.1 Declaration merging：plugin 如何擴充 context 型別

這是整個機制的關鍵技巧。plugin 在自己的檔案裡宣告它往 context 上加了什麼：

```ts
// plugins/app/i18n.ts
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

declare module '@/core/app/context' {
  interface AppPluginProperties {
    i18n: typeof i18nInstance;
    addResourceBundle: typeof addResourceBundle;
    changeLanguage: typeof changeLanguage;
  }
}
```

從此 `getAppContext().addResourceBundle(...)` 在任何地方都有完整型別。
**`core/app/context.ts` 完全不需要知道有 i18n 這個東西。**

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
（`shared/registry`）收集起來，卸載時一併撤回。feature 照舊呼叫 `registerXxx()`，
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

| Plugin              | `attrs` 提供                                  | `onInit` 做什麼                                                      |
| ------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| `cachePlugin`       | `queryClient`, `dictStorage`                  | `queryClient.start()`：開始收其他分頁的失效（`onDestroy` 時 `stop()`） |
| `eventBusPlugin`    | `eventBus`                                    | 建立全域 `EventEmitter<GlobalEventMap>`（事件與 payload 定義在 `core/app/events.ts`） |
| `i18nPlugin`        | `i18n`, `addResourceBundle`, `changeLanguage` | `i18next.init()`、載入 app 層語系包                                  |
| `httpContextPlugin` | `sessionStore`（主後端）                      | 依傳入的後端清單，每個後端建立一個 `SessionStore` 與 `<後端>:base` / `<後端>:auth` 兩個 HttpContext（30 秒逾時）並掛上攔截器鏈；某個 session 結束只中止該後端的 `auth` 請求；主 session 結束時一併結束其他後端的 session（[05 §3.3、§3.5](./05-data-layer.md)） |
| `componentPlugin`   | `componentRegistry`                           | 建立元件註冊表（讓 feature 覆寫核心元件）                            |

### 4.2 `plugins/fetcher/` — HTTP 攔截器

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
export function tableColumnSettingsPlugin(): AppPluginFactory {
  return (context) => {
    // 同步階段：往 core/preference 的註冊表插一個分頁
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

`features/account` 的偏好頁只做一件事：`getPreferenceSections()` 然後依 `order`
渲染。**拿掉 `main.tsx` 裡那一行，這個分頁就消失了。**

分頁要列出「有哪些表、各有哪些欄位」，但不能 import 各 feature。所以 `core/preference` 另有一份
**列表註冊表**：feature 在 plugin 的同步階段呼叫 `registerPreferenceTable({ id, labelI18nKey, columnLabelKeys, localeScope })`
（見各 feature 的 `preference.ts`），分頁用 `getPreferenceTables()` 列出，並用列表上同一個 `TableSettings` 調整。
`id` 與 `RichTable` 的 `settings.tableId` 相同，兩邊讀寫同一份 `core/store/tableColumnSettings`。
偏好頁的 route loader 是 `preferenceLocaleLoader()`：各分頁與各列表名稱所在的 scope 都會先載入。

### 4.4 頂列工具（`core/toolbar`）

頂列（Header）的工具（語言、主題切換……）也是註冊表：在 plugin 的同步階段呼叫
`registerHeaderTool({ key, order, labelI18nKey, icon, Component })`，頂列（`app/layouts/HeaderToolbar.tsx`）
與偏好頁的「頂列工具」區塊（`features/account/components/HeaderToolbarSettings.tsx`）都只讀註冊表，
**追加工具不必改這兩處**。內建工具在 `app/layouts/headerTools.ts` 登記，由 `app/plugin.ts` 呼叫；
屬於某個 feature 的工具在該 feature 的 plugin 登記。

| 項目 | 規則 |
| --- | --- |
| 使用者設定 | 偏好頁拖曳排序、開關顯示，立即生效；存在 `preference` dictStorage 的 `headerToolbar` 鍵（`useHeaderToolbarStore`），**只存本機**、跨分頁同步 |
| 存的內容 | `{ order, hidden }`；沒調整過是 `null`，照 `order` 欄位的預設順序全部顯示 |
| 新追加的工具 | 不在已存 `order` 裡的工具接在最後、預設顯示（`resolveHeaderTools`），不必遷移使用者的設定 |
| 移除的工具 | 已存設定裡找不到的 key 直接略過 |
| `key` | 存進設定的鍵，發佈後不要改名 |
| `labelI18nKey` | 放在全域語系包（`app/locales`），偏好頁之外的 scope 未必載入 |

內建工具依序是批次佇列（`batchQueue`，關掉只是不顯示按鈕，批次結果仍由 `BatchQueueNotifier` 彈出）、即時連線狀態（`realtimeStatus`，[11 §8.1](./11-realtime.md)）、語言（`language`）、主題（`theme`）。
帳號選單是身分入口，固定顯示在最右側，不在註冊表裡。

---

## 5. 一個 feature plugin 的標準形狀

```ts
// features/role/plugin.ts
import { LanguageNamespace, Languages } from "@/shared/constants/lang";
import type { AppPluginFactory } from "@/core/app";
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
declare module "@/core/locales" {
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

`core/` 的註冊表都用 `shared/registry` 的 `createRegistry(describe)` 建立：
一個可訂閱的 store（`entries` 是 `ReadonlyMap`，每次變更換新）＋ 註冊函式（回傳反註冊函式）＋ 讀取函式
＋ 測試用的 reset。可訂閱與可撤回是為了 App 啟動後才安裝或被移除的 feature
（[ADR-0021](../../adr/0021-runtime-feature-activation.md) D4）。

| 註冊表 | 位置 | 誰註冊 | 誰讀取（React 端訂閱的方式） |
| --- | --- | --- | --- |
| 頁面權限 | `core/permission/registry.ts` | 各 feature 的 `permission.ts` | 權限 hooks（`usePageAccess`、`usePageAccessChecker` 訂閱）、選單、Layout |
| 偏好分頁／列表 | `core/preference/registry.ts` | feature 或 `plugins/features/*` | 偏好頁（`usePreferenceSections`、`usePreferenceTables`） |
| 頂列工具 | `core/toolbar/registry.ts` | `app/plugin.ts` 或 feature | `useHeaderTools` |
| 批次操作 | `core/batch/operations.ts` | feature 的 `batch.ts` | 批次佇列（分頁向佇列宣告能執行的操作，§7） |
| 檔案預覽／驗證／縮圖 | `core/file/registry.ts` | `features/file` 或 plugin | 檔案管理器（使用時讀取，不訂閱） |
| 語系包 | `core/locales/i18n.ts`（`addResourceBundle`） | 各 plugin 的 `onInit` | route loader（`localeScopeLoader`） |

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

[ADR-0021](../../adr/0021-runtime-feature-activation.md)。平台管理者對每個租戶開關的 feature
（目前是 `file`、`auditLog`、`job`），登入後才依 `/auth/profile` 的 `features` 安裝；
清單改變時 api 推播 `resource.changed`（`tenantFeature`），profile 重新取得後自動安裝或卸載。

| 角色 | 位置 | 做什麼 |
| --- | --- | --- |
| catalog | `app/features.ts` 的 `FEATURE_CATALOG` | id → `{ plugin, routes }`；`satisfies Record<TenantFeature, …>` 對齊後端 |
| 安裝器 | `core/feature/FeatureActivator.ts` | 比對清單，`install` / `uninstall`；狀態寫進 `featureStore` |
| 同步 | `app/features.ts` 的 `useSyncFeatures()`（掛在 `SessionWatcher`） | 把 profile 的 `features` 交給安裝器 |
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
