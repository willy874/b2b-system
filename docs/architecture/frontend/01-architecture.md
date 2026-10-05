# 前端 01 — 架構

## 1. 七層

```
┌──────────────────────────────────────────────────────────────┐
│ 7  app/         App Shell。只組裝，不實作業務                  │
│                 Layout、route tree、全域 Provider              │
├──────────────────────────────────────────────────────────────┤
│ 6  features/    業務功能。每個自給自足                          │
│                 routes · pages · components · hooks · enums   │
│                 permission.ts · plugin.ts · locales/          │
├──────────────────────────────────────────────────────────────┤
│ 5  apis/        與後端對話的唯一入口                            │
│                 <domain>/<operation>/{fetcher,query|mutation} │
├──────────────────────────────────────────────────────────────┤
│ 4  components/  設計系統。Base UI ＋ 我們的樣式                 │
│                 不含任何業務語彙                               │
├──────────────────────────────────────────────────────────────┤
│ 3  plugins/     可插拔能力。非核心、非業務                      │
│                 app/（i18n、cache…） fetcher/（攔截器）        │
├──────────────────────────────────────────────────────────────┤
│ 2  core/        機制層。跨 feature，但不認識任何 feature        │
│                 permission · auth · client · router · cache   │
├──────────────────────────────────────────────────────────────┤
│ 1  shared/      純工具與型別。不依賴上面任何一層                 │
│                 store · storage · EventEmitter · utils        │
└──────────────────────────────────────────────────────────────┘
```

**相依只能由上往下。** 唯一例外是 `plugins/features/*`：它們是「擴充某個
feature 的小外掛」，允許依賴那個 feature 的公開介面（見
[`02-plugin-system.md`](./02-plugin-system.md) §6）。

---

## 2. 每一層的職責與界線

### 2.1 `shared/` — 純工具

**可以有**：`EventEmitter`、signal store 實作與跨分頁同步、同步頻道與傳輸層（`shared/channel`：BroadcastChannel / localStorage / WebSocket / SharedWorker / Service Worker）、`localStorage` 封裝、日期工具、
型別工具、env 常數、`cn()`。

**不可以有**：任何 `import` 自 `core/`、`features/`、`components/`；任何 React
元件（hook 可以，只要它不碰業務）。

判斷標準：**把這個檔案複製到另一個專案，它能不能直接跑？** 不行就不屬於 `shared/`。

#### `shared/api-sdk/index.ts` — 單一收斂點

```ts
// 整個 app 對 packages/api-sdk 的唯一引用點
export * from "@b2b-system/api-sdk";
```

好處：SDK 換產生器、改套件名、或需要對某個型別做本地修補時，只改這一個檔。

### 2.2 `core/` — 機制層

`core/` 回答的是「這個 app 如何運作」，不是「這個 app 在做什麼」。

| 模組              | 職責                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `core/app`        | `AppContext` 型別、`createAppContext()`、React context bridge       |
| `core/batch`      | 全域批次佇列：SharedWorker（不支援時 dedicated worker）逐筆排程、分頁以單筆 API 執行、Channel 廣播進度；`BatchAction` 型別、`registerBatchOperation`、進度條、AppHeader 面板、結束時的彈出（[07 §6.2](./07-ui-system.md)、[`frontend/07-ui-system.md`](07-ui-system.md) §13）；工作內並行、位元組進度、中止（[`frontend/12-file-manager.md`](12-file-manager.md) §14） |
| `core/file`       | 檔案類型判斷（圖示）、檔案管理的擴充點：預覽解析器、檔案驗證器、縮圖產生器的註冊表（[12 §6](./12-file-manager.md)） |
| `core/auth`       | `SessionStore`：token 生命週期、跨分頁單飛續期、終止判定            |
| `core/cache`      | `queryClient` 實例、跨分頁失效廣播、store 持久化                    |
| `core/client`     | `HttpContext` / `FetcherContext` / `defineFetcher` / 攔截器鏈       |
| `core/components` | 機制性元件：`ErrorPage`、`Empty`、`PermissionGate`、`Suspense` 封裝、`RichTable`（列表頁表格：`Table` ＋ `Pagination`，表頭放 `FilterBar` 與 `TableSettings` 兩個下拉面板） |
| `core/errors`     | 錯誤碼常數、`AppError` 型別、`useErrorMessage()`                    |
| `core/locales`    | i18n scope 註冊與 route loader                                      |
| `core/notify`     | `useToast()`：發 `GlobalEvents.TOAST_SHOW` 到 eventBus，由 `app/ToastHost` 渲染 |
| `core/permission` | ★ 權限註冊表、常數、hooks                                           |
| `core/permission-graph` | 權限依賴樹的閉包、前置路徑與版面（角色技能樹、權限目錄共用；與 `core/permission` 分開，才不會把樹狀圖套件帶進首屏） |
| `core/preference` | 偏好設定註冊表（讓 feature 往偏好頁掛分頁）、列表註冊表（可自訂欄位的表） |
| `core/router`     | `RootRoute`、`RouterProvider` 封裝                                  |
| `core/store`      | 全域 store：`permission`、`layout`、`timezone`、`locale`、`theme`、`tableColumnSettings` |
| `core/theme`      | 主題選項表（`THEME_OPTIONS`）、`resolveTheme()` / `applyTheme()`（[07 §4.4](./07-ui-system.md)） |

**鐵則**：`core/` 內任何檔案 `grep -r "features/"` 必須是零結果。
這條規則由一個 lint 規則與 CI 檢查強制。

### 2.3 `components/` — 設計系統

**可以有**：`Button`、`Input`、`Dialog`、`Table`、`Toast`、`Tooltip`…

**不可以有**：`RoleTable`、`UserStatusChip` 這種帶業務語彙的東西——那些屬於
`features/<name>/components/`。

判斷標準：**這個元件的 props 裡有沒有出現業務名詞？** 有就不屬於這層。

### 2.4 `apis/` — 通訊層

```
apis/
├── auth/
│   ├── login/            { fetcher.ts, mutation.ts }
│   ├── refresh/          { fetcher.ts }
│   ├── get-profile/      { fetcher.ts, query.ts }
│   └── logout/           { fetcher.ts, mutation.ts }
├── user/
│   ├── get-user-list/    { fetcher.ts, query.ts }
│   ├── get-user-detail/  { fetcher.ts, query.ts }
│   ├── create-user/      { fetcher.ts, mutation.ts }
│   ├── update-user/      { fetcher.ts, mutation.ts }
│   ├── delete-user/      { fetcher.ts, mutation.ts }
│   └── assign-user-roles/{ fetcher.ts, mutation.ts }
├── role/    …
├── permission/ get-permission-list/
└── audit-log/  get-audit-log-list/
```

**一個資料夾＝一個後端操作。** 不把同一個資源的所有操作塞進一個 `role.api.ts`，
因為那會讓每個只用到列表的頁面都把建立、刪除的程式碼一起打包進去。

詳見 [`05-data-layer.md`](./05-data-layer.md)。

### 2.5 `features/` — 業務功能

見 [`03-feature-anatomy.md`](./03-feature-anatomy.md)。

### 2.6 `plugins/` — 可插拔能力

見 [`02-plugin-system.md`](./02-plugin-system.md)。

### 2.7 `app/` — 組裝層

`app/` 裡 **不應該出現任何業務邏輯**。它做三件事：

1. `routes.tsx` — 把各 feature 匯出的 route 物件組成 route tree
2. `Layout.tsx` / `layouts/` — 決定哪些路徑套哪個 layout
3. `GlobalProvider.tsx` — 套上 Query / Router / Theme / Toast providers

---

## 3. 一個畫面的完整路徑

以「進入角色列表頁」為例：

```
使用者點側邊選單「角色」
  │
  ▼ app/layouts/DashboardLayout.tsx
    選單項目由 useMenuItems() 產生，已用 usePageAccessChecker() 過濾掉無權限項
  │
  ▼ router.navigate({ to: '/role' })
  │
  ▼ features/role/routes/pages.ts — RoleListRoute
    ├─ validateSearch: RoleSearchQuerySchema (Zod) → 解析網址參數
    └─ loader: localeScopeLoader(ROLE_LOCALE_SCOPE) → 載入本 feature 語系包
  │
  ▼ app/Layout.tsx 的權限守衛
    usePageAccess('/role') → resolvePageKey → ROLE_PAGE → 規則 role:read
      ├─ 未水合 → 顯示 loading
      ├─ 無權限 → 顯示 403 頁
      └─ 有權限 → 渲染 Outlet
  │
  ▼ features/role/pages/RoleList/page.tsx（lazy）
    ├─ usePagePermission(ROLE_PAGE) → { canCreate, canUpdate, canDelete }
    ├─ useRoleSearchFilter()        → 從 route search 取出查詢條件
    ├─ useQuery(getRoleListQueryOptions({ params }))
    │     │
    │     ▼ apis/role/get-role-list/fetcher.ts
    │       defineAuthFetcher → core/client HttpContext('main:auth')
    │         ├─ plugins/fetcher/auth.ts        加上 Authorization
    │         ├─ plugins/fetcher/refresh-token.ts 401 → 強制續期 → 重放
    │         └─ plugins/fetcher/retry.ts        網路錯誤／5xx 退避重試（僅冪等方法）
    │              │
    │              ▼ packages/api-sdk → fetch('/api/roles?...')
    │
    ├─ adapter.ts  API 回應 → view model
    └─ components/RoleTable.tsx
          └─ components/Table（Base UI ＋ TanStack Table）
```

---

## 4. 啟動時序

```
main.tsx
  │
  ├─ (dev) 視 VITE_ENABLE_MOCK 啟動 MSW worker
  │
  ├─ const context = createAppContext()
  │
  ├─ context
  │    .use(cachePlugin())        ┐
  │    .use(eventBusPlugin())     │ 基礎設施，必須最先
  │    .use(i18nPlugin())         │
  │    .use(httpContextPlugin())  ┘
  │    .use(authFeaturePlugin())  ┐
  │    .use(userFeaturePlugin())  │ 每個 feature 的 plugin factory
  │    .use(roleFeaturePlugin())  │ ★ 在此 **同步** 註冊頁面權限
  │    .use(permissionFeaturePlugin())
  │    .use(accountFeaturePlugin())
  │    .use(auditLogFeaturePlugin())
  │    .use(homeFeaturePlugin())  ┘
  │    .use(appContextPlugin())     ★ 最後：建立 router（此時所有 route 已存在）
  │
  ├─ .load()                        依序 await 每個 plugin 的 onInit（非同步初始化）
  │
  ├─ .then(() => hydrateLocale(context.dictStorage))
  ├─ .then(() => hydrateTimezone(context.dictStorage))
  │
  └─ .then(() => createRoot(#root).render(<App context={context} />))
```

**關鍵時序保證**：

- 頁面權限在 `use()` 期間 **同步** 註冊完成 → 第一次 render 時
  `requirePagePermission()` 絕不會 miss。
- router 在最後一個 plugin 建立 → 所有 feature 的 route 物件都已存在。
- 偏好（語系、時區）在 render 前水合 → 不會有「先閃英文再變中文」。

---

## 5. Lint 強制的相依規則

`.oxlintrc.json` 中以 `no-restricted-imports` 設定：

| 從                  | 不可 import                                              |
| ------------------- | -------------------------------------------------------- |
| `src/shared/**`     | `@/core/*`, `@/features/*`, `@/components/*`, `@/apis/*` |
| `src/core/**`       | `@/features/*`, `@/app/*`                                |
| `src/components/**` | `@/features/*`, `@/apis/*`                               |
| `src/features/a/**` | `@/features/b/*`                                         |
| 任何地方            | `../../../*`（三層以上相對路徑）                         |

CI 另有一支腳本檢查 `features/*/index.tsx` 是否都匯出了 `Routes` 與
`<name>FeaturePlugin`，避免漏接。
