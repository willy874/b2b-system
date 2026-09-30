# 前端 04 — 路由

## 1. 為什麼是 code-based routing

TanStack Router 支援 file-based 與 code-based 兩種模式。本專案用
**code-based**，原因是 feature 必須 **擁有** 它的 route 物件：

- `permission.ts` 要 `routeBasePath(RoleListRoute)` 讀出 `/role` 來註冊權限
- `routes/external.ts` 要匯出 route 物件供別的 feature 連結
- `routes/pages.ts` 建立 route 但不綁元件，`index.tsx` 才用 `.update()` 綁 lazy 元件

file-based routing 把 route 的身分交給檔案系統，上述三件事都做不到。

---

## 2. Route 樹

```
RootRoute  (core/router/root.tsx)
│  component: app/Layout.tsx  → 依 matcher 決定套哪個 layout
│
├── /                              HomeRoute
│
├── /auth                          AuthRoute          （不套 Dashboard layout）
│   ├── login                      LoginRoute
│   ├── forgot-password            ForgotPasswordRoute
│   ├── reset-password             ResetPasswordRoute
│   ├── setup                      SetupRoute
│   └── register                   RegisterRoute      （申請帳號，需審批）
│
├── /profile                       ProfileRoute
├── /preference                    PreferenceRoute
├── /notification                  NotificationListRoute （站內通知；?filter=unread）
│
├── /user                          UserListRoute
│   ├── create                     UserCreateRoute        （對話框）
│   ├── $userId                    UserDetailRoute
│   │   └── role                   UserDetailRoleRoute    （角色指派子頁）
│   └── …
│
├── /role                          RoleListRoute
│   ├── create                     RoleCreateRoute        （對話框）
│   ├── create/$roleId             RoleCopyRoute          （以既有角色為範本）
│   └── $roleId                    RoleDetailRoute
│       ├── create                 RoleDetailCopyRoute
│       ├── permission             RoleDetailPermissionRoute
│       └── revision               RoleDetailRevisionRoute（版本紀錄，frontend/14-revisions.md）
│
├── /permission                    PermissionListRoute
├── /audit-log                     AuditLogListRoute
├── /approval                      ApprovalListRoute
│   └── $approvalId                ApprovalDetailRoute    （審核對話框）
│
└── (dev only)
    ├── /__router_devtools__
    └── /__query_devtools__
```

### 2.1 對話框即路由

「建立角色」是 `/role/create` 這個 **子路由**，不是列表頁裡的 `useState`。

好處：

- 可以直接分享／收藏一個開著對話框的網址
- 瀏覽器上一頁＝關閉對話框，符合直覺
- 列表頁在背後保持掛載（子路由的 `Outlet` 在列表頁內），不會重新抓資料

對話框本身又有子路由時（`/role/$roleId/permission`），`Outlet` 要放在 `Dialog`
**旁邊**，不能放進 `Dialog` 的 children：Base UI 的 Dialog 在 React 樹中巢狀時，
背後列表頁的 Select 觸發按鈕會陷入 ref 更新迴圈，整頁 `Maximum update depth exceeded`。

代價：子路由必須也宣告 `validateSearch: RoleSearchQuerySchema`，否則導覽進
對話框時列表的篩選條件會從網址消失。這是必須記住的一點。

**未儲存提醒**：關閉路由對話框（點遮罩、Esc、取消、上一頁）都是導覽，所以表單在 dirty 時呼叫
`useUnsavedChangesGuard(isDirty)`（`core/router`，TanStack Router 的 `useBlocker` ＋ `beforeunload`）即可攔下所有途徑。
儲存成功後的關閉帶 `ignoreBlocker: true`；session 結束導向登入頁時也略過。

### 2.2 `create/$roleId` 為何不掛在 `create` 之下

「以角色 X 為範本建立」如果做成 `RoleCreateRoute` 的子路由，TanStack Router 會
同時渲染 `create` 的元件（一般建立對話框）**和** 子路由的元件（複製對話框），
兩個對話框疊在一起。所以它是 `RoleListRoute` 的兩段式子路由。

---

## 3. 網址狀態：`validateSearch`

列表頁的分頁、篩選、排序全部放在網址，用 Zod 驗證：

```ts
// features/role/routes/model.ts
import { z } from "zod";

export const RoleSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(200).catch(20),
  keyword: z.string().trim().optional().catch(undefined),
  // 多欄排序 SortEntry[]；空陣列＝後端預設排序；不合法（白名單外、重複）時退回空陣列，不變成錯誤頁
  sort: sortSearchSchema(ROLE_SORT_FIELDS),
});

export type RoleSearchQuery = z.infer<typeof RoleSearchQuerySchema>;
```

`.catch()` 而非 `.default()`：使用者手改網址成 `?limit=abc` 時 **回退到預設值**
而不是丟出路由錯誤。列表頁不該因為一個壞參數就變成錯誤頁。

網址格式不用 TanStack Router 預設的 JSON，而是在 `createRouter` 換成
`core/router/search.ts` 的 `parseSearch` / `stringifySearch`：**重複的 key 就是陣列**，
值一律是字串（型別交給 `validateSearch` 的 `z.coerce`）。排序與後端 API 同格式——
`createdAt` 升冪、`-createdAt` 降冪：

```
/user?keyword=foo&sort=displayName&sort=-createdAt
```

元件拿到的 `search.sort` 仍是 `SortEntry[]`：`sortSearchSchema` 把 token 解析成物件，
`stringifySearch` 導覽時再把 `SortEntry` 轉回 token（`toSortToken`）。

每個列表另外定義一組預設查詢條件，列表路由用 `stripSearchParams` 把 **與預設值
（深層）相等** 的參數從網址拿掉——剛進列表頁的網址是 `/role`，而不是
`/role?offset=0&limit=20&sort=...`：

```ts
// features/role/routes/model.ts
export const DEFAULT_ROLE_SEARCH: RoleSearchQuery = {
  offset: 0,
  limit: 20,
  sort: [],
};

// features/role/routes/pages.ts
export const RoleListRoute = createRoute({
  // ...
  validateSearch: RoleSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_ROLE_SEARCH)] },
});
```

預設值必須和 schema 的 `.catch()` 回退值一致，否則被拿掉的參數讀回來會是另一個值。
search middleware 會套用到目的地路由鏈上的每一層，所以只需要掛在列表路由，
子路由（`create`、`$roleId`）自動套用。

讀寫：

```tsx
const search = RoleListRoute.useSearch();
const navigate = useNavigate({ from: RoleListRoute.fullPath });

navigate({ search: (prev) => ({ ...prev, offset: 0, keyword }) });
```

---

## 4. 權限守衛

### 4.1 為什麼守衛在 Layout 而不在每個 route 的 `beforeLoad`

兩個理由：

1. **權限集合是非同步水合的。** `beforeLoad` 執行時 `usePermissionStore` 可能
   還沒拿到 profile。在那裡判斷等於要處理「還不知道」這個第三態，每個 route 都
   要處理一次。
2. **403 應該是頁面內容，不是導向。** 使用者直接貼一個無權限的網址進來，看到
   「你沒有權限看這一頁」比被彈回首頁更能理解發生什麼事，網址也保留著方便
   請人開權限。

### 4.2 實作

```tsx
// app/Layout.tsx（摘要）
function Layout({ matchers }: LayoutProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { hydrated, gated, canAccess } = usePageAccess(pathname);

  // 未受管的路徑（/auth/*、devtools）→ 不等待水合，直接渲染
  if (!gated)
    return (
      <LayoutShell matchers={matchers}>
        <Outlet />
      </LayoutShell>
    );

  // 受管但權限還沒到 → 骨架屏（避免先閃 403 再閃內容）
  if (!hydrated)
    return (
      <LayoutShell matchers={matchers}>
        <PageSkeleton />
      </LayoutShell>
    );

  if (!canAccess)
    return (
      <LayoutShell matchers={matchers}>
        <ForbiddenPage />
      </LayoutShell>
    );

  return (
    <LayoutShell matchers={matchers}>
      <Outlet />
    </LayoutShell>
  );
}
```

`usePageAccess(pathname)` 的內部：

```
pathname '/role/abc/permission'
  → resolvePageKey()：掃註冊表，找 base path 前綴命中的頁面 → ROLE_PAGE
  → getPagePermission(ROLE_PAGE).rule → { access: ['role:read'], match: EVERY }
  → evaluateAccess(rule, canEvery, canSome)
  → { hydrated, page: ROLE_PAGE, gated: true, canAccess: boolean }
```

**未註冊的路徑回 `gated: false, canAccess: true`**（fail-open）。這是刻意的：
`/auth/login`、devtools 這些路徑本來就不該有權限規則，強行要求註冊只會製造噪音。
真正的防線在後端。

### 4.3 未登入的處理

這一層不是權限守衛的責任，而是 `SessionStore` 的：

```
任何請求 → 401 → 續期被伺服器拒絕，或收到終止類錯誤碼
  → 主後端的 SessionStore 判定 session 結束（latched，只觸發一次；網路錯誤、5xx 不算）
  → emit SESSION_ENDED
  → app 層監聽：清空 permission store、清空 query cache、
     navigate({ to: '/auth/login', search: { signedOut, reason, redirect: pathname + search } })
```

登入成功後讀 `search.redirect` 導回原本要去的頁面（含查詢字串）。`reason` 是 `endSession(reason)` 的原因，
登入頁以 `features/auth/sessionEnd.ts` 對到說明（逾時、帳號停用、憑證重用、密碼已變更…；自己登出不帶）。

### 4.4 404、錯誤頁與載入中

`app/plugin.ts` 的 `createRouter` 設定 `defaultNotFoundComponent: NotFoundPage`、`defaultErrorComponent: RouteErrorPage`、
`defaultPendingComponent: PageSkeleton`（`core/components/ErrorPage`）。部署新版後舊分頁 lazy 載入舊 chunk 失敗時，
`RouteErrorPage` 提示「系統已更新」並提供重新整理；403／404 有「回首頁」與「返回上一頁」。
權限水合失敗（`/auth/profile` 5xx、`TENANT_UNAVAILABLE`）時 Layout 顯示原因與重試，不停在骨架屏。

只有 **主後端**（`MAIN_BACKEND`）的 session 會觸發這個流程。其他後端的 session 結束
只中止該後端的請求，由使用它的 feature 自行訂閱 `getSessionStore('<後端>').events` 決定 UI
（例如顯示「重新連線」），不會把使用者登出整個 app（[05 §3.5](./05-data-layer.md)）。

---

## 5. 語系的 route-level 載入

```ts
export const RoleListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/role",
  loader: localeScopeLoader(ROLE_LOCALE_SCOPE), // ★
  // …
});
```

`localeScopeLoader(scope)` 回傳一個 loader，它 `await` 該 scope 底下所有已註冊
的語系包（由 feature 的 `plugin.ts` 用 `addResourceBundle(..., { scope })` 註冊）。

效果：`features/role/locales/*.json` **不在首屏 bundle 裡**，使用者第一次進入
`/role` 時才下載，且在頁面渲染前就已就緒（不會閃 i18n key）。

子路由不需要重複宣告——parent loader 已經跑過。

---

## 6. Route context：feature 內的事件匯流排

```ts
export const RoleDetailRoute = createRoute({
  getParentRoute: () => RoleListRoute,
  path: "$roleId",
  context: () => ({
    eventBus: new EventEmitter<{
      [RoleEvents.ROLE_UPDATED]: () => void;
      [RoleEvents.ROLE_PERMISSIONS_CHANGED]: () => void;
    }>(),
  }),
});
```

用途：詳情頁的工具列（父路由的元件）與權限子頁（子路由的元件）之間需要通訊，
但它們沒有 props 關係。透過 route context 的 event bus，子頁完成操作後
`emit`，工具列 `on` 之後重新整理，不需要把狀態提到共同祖先。

**生命週期天然正確**：route 卸載，context 跟著消失，不會洩漏。

---

## 7. `beforeLoad` 的合法用途

權限不走 `beforeLoad`，但以下情況走：

```ts
export const RoleDetailPermissionRoute = createRoute({
  getParentRoute: () => RoleDetailRoute,
  path: "permission",
  beforeLoad: async ({ params: { roleId } }) => {
    const role = await queryClient.ensureQueryData(getRoleDetailQueryOptions({ roleId }));
    // 業務規則：super-admin 沒有可編輯的權限
    if (role.slug === "super-admin") {
      throw redirect({ to: RoleDetailRoute.to, params: { roleId }, replace: true });
    }
  },
});
```

判準：**依賴「該筆資料的狀態」的守衛** 走 `beforeLoad`；
**依賴「使用者的權限」的守衛** 走 Layout 層。

`replace: true` 是必要的——否則使用者按上一頁會再次進入守衛，形成迴圈。

---

## 8. Layout matcher

```tsx
const matchers = [
  {
    component: LayoutComponents.Dashboard,
    includes: ["/", "/*path"],
    excludes: ["/auth/*path"],
  },
];
```

`app/Layout.tsx` 依當前 pathname 比對 matcher，決定套哪個 layout。
`/auth/*` 被排除，所以登入頁沒有側邊選單與頂部列。

新增 layout（例如未來編輯器要全螢幕無側欄）只要加一條 matcher，不必改任何
feature。

---

## 9. 側邊選單如何依權限過濾

```tsx
// app/layouts/SidebarNav.tsx
const TOP_ITEMS: NavItem[] = [{ pageKey: HOME_PAGE, to: "/", labelKey: "menu.home", icon: "home" }];

const MENU_GROUPS: NavGroup[] = [
  { key: "feature", labelKey: "menu.group.feature", items: [/* 檔案 */] },
  { key: "people", labelKey: "menu.group.people", items: [/* 使用者、角色、權限目錄 */] },
  { key: "system", labelKey: "menu.group.system", items: [/* 稽核日誌、審批、背景工作、外部 IdP */] },
];

function useMenuGroups(groups: NavGroup[]) {
  const { hydrated, canAccessPage } = usePageAccessChecker();
  return useMemo(
    () =>
      hydrated
        ? groups
            .map((g) => ({ ...g, items: g.items.filter((item) => canAccessPage(item.pageKey)) }))
            .filter((g) => g.items.length > 0)
        : [],
    [hydrated, canAccessPage, groups],
  );
}
```

選單是兩層：首頁固定在最上方，其餘頁面分在「功能管理／人員管理／系統管理」三個 **父選單**
底下，父選單的翻譯鍵是 `menu.group.<key>`。

- 分類內一個能進的頁面都沒有時，**連父選單一起隱藏**，不留空殼。
- 父選單是展開／收合的按鈕（`aria-expanded`），本身不是連結。**預設只展開當前頁面所在的分類**，
  其他分類收合；使用者手動展開／收合的狀態保留到「當前分類」改變為止，換到別的分類（或回首頁）時回到預設。
- 收合的子選單仍留在 DOM（`hidden`），所以「沒有權限就不渲染」與「收合」是兩件事——E2E 要點其他分類的
  子項前先用 `helpers/menu.ts` 的 `openMenuGroup()` 展開。
- 側邊欄收合成圖示欄時放不下父選單，子項全部列出、以分隔線標出分類邊界。

`usePageAccessChecker()` 回傳的是一個 **穩定的 predicate**，可以在 `filter`
迴圈裡呼叫（hook 不能在迴圈裡呼叫，所以不能用 `usePagePermission`）。

**未水合時回空陣列**，而不是顯示全部再消失——那個閃爍會洩漏「系統裡有哪些頁面」。

`MENU` 這張表是 `app/` 層唯一知道所有 feature 的地方，這是可接受的：它本來就是
組裝層。pageKey 從各 feature 的 `permission.ts` import。
