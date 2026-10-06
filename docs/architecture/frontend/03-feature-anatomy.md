# 前端 03 — Feature 解剖與新增 SOP

## 1. 標準結構

以 `features/role/` 為完整範例：

```
features/role/
├── index.tsx                  ★ 對外唯一入口：綁定元件、匯出 Routes 與 plugin
├── plugin.ts                  ★ AppContext plugin factory
├── permission.ts              ★ 頁面權限宣告與註冊
├── locale.ts                  語系 scope 名稱常數
├── routeLinks.ts              （選用）把自己的頁面登記成 route id，供別的 feature 與後端連結
├── preference.ts              （選用）往偏好頁註冊分頁
│
├── routes/
│   ├── index.ts               re-export pages.ts 與 model.ts
│   ├── pages.ts               ★ 本 feature 擁有的 route 物件
│   └── model.ts               網址 search 參數的 Zod schema
│
├── pages/
│   ├── index.tsx              lazy 包裝：export const AsyncRoleListPage = lazyRouteComponent(...)
│   ├── RoleList/
│   │   ├── page.tsx           頁面組裝（版面、工具列、表格、對話框掛載點）
│   │   ├── models.ts          view model 型別
│   │   ├── adapter.ts         API DTO → view model
│   │   ├── constants.ts       欄位定義、預設值
│   │   ├── useRoleSearchFilter.tsx
│   │   └── components/
│   │       ├── RoleTable.tsx
│   │       ├── RoleFilter.tsx
│   │       └── RoleSortField.tsx
│   ├── RoleCreate/
│   │   ├── page.tsx
│   │   ├── RoleInformationForm.tsx
│   │   ├── RoleAssignPermissionForm.tsx
│   │   └── models.ts
│   ├── RoleDetail/
│   └── RoleDetailPermission/
│
├── components/                ★ 跨本 feature 多個頁面共用的業務元件
│   ├── PermissionPickerModal.tsx
│   ├── RoleBadge.tsx
│   └── index.ts
│
├── hooks/                     ★ 業務邏輯的主要棲地
│   ├── useRolePermission.ts   ← 本 feature 的權限 facade
│   ├── useRoleCreateMutation.ts
│   ├── useRoleUpdateMutation.ts
│   ├── useRoleDeleteMutation.ts
│   ├── useRoleDeleteModal.tsx
│   └── useGrantablePermissions.ts   ← 反提權過濾
│
├── enums/
│   └── role-action.ts         列表列可執行的動作
│
└── locales/
    ├── en_US.json
    └── zh_TW.json
```

---

## 2. 每個檔案的契約

### 2.1 `index.tsx` — 對外唯一入口

```tsx
import * as Pages from "./pages";
import * as Routes from "./routes";

Routes.RoleListRoute.update({ component: Pages.AsyncRoleListPage });
Routes.RoleCreateRoute.update({ component: Pages.AsyncRoleCreatePage });
Routes.RoleDetailRoute.update({ component: Pages.AsyncRoleDetailPage });
Routes.RoleDetailPermissionRoute.update({ component: Pages.AsyncRoleDetailPermissionPage });

export { Routes };
export { ROLE_CREATE_PAGE, ROLE_PAGE, registerRolePagePermissions } from "./permission";
export { appContextPlugin as roleFeaturePlugin } from "./plugin";
```

`index.tsx` 的讀者只有組裝層（`app/`、`main.tsx`）與測試，可以匯出的東西：

| 匯出 | 誰用 | 必要 |
| --- | --- | --- |
| `Routes`、`<name>FeaturePlugin` | `app/routes.tsx` 組 route tree、`main.tsx`（或 `app/features.ts` 的可啟用 feature 目錄）安裝 plugin | 🔒 每個 feature 都要有（`layer-dependencies.test.ts`） |
| 頁面鍵與註冊函式（`ROLE_PAGE`、`registerRolePagePermissions`） | 選單（`app/layouts/`）、完整性測試（`core/permission/__tests__/feature-registration.test.ts`） | 有頁面權限的 feature |
| 可啟用 feature 的代碼（`FILE_FEATURE`） | `app/features.ts` 的目錄（[02 §9](./02-plugin-system.md)） | 可關閉的 feature |
| app 組裝需要的 hook 與常數（auth 的 `useSyncPermissions`、`useLogoutMutation`，account 的 `useChangeLocale`） | `app/App.tsx`、`app/layouts/` | 視需要 |

**其他 feature 一律不 import 這裡**（見 §4）；`app/`、`main.tsx` 也只從這裡匯入，不深入 feature 的內部檔案（🔒 同一支測試）。

### 2.2 `permission.ts`

```ts
import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from "@/core/permission"; // app 的門面：權限機制（web-core）＋ 這個 app 的權限目錄
import { RoleListRoute } from "./routes";

/** 本 feature 在全域權限註冊表中的頁面識別碼 */
export const ROLE_PAGE = definePageKey("ROLE");

export function registerRolePagePermissions(): void {
  registerPagePermission(ROLE_PAGE, {
    route: routeBasePath(RoleListRoute), // '/role'
    rule: {
      resource: PermissionResource.ROLE, // 讓 hook 能派生 CRUD 能力
      access: [PermissionKey.RoleRead], // 進入頁面所需
      match: PermissionMatch.EVERY,
    },
  });
}
```

`routeBasePath()` 從 route 物件讀 `options.path`（而非 `route.to`，後者在
router 建立前是 `undefined`，而 plugin 註冊發生在那之前）。

### 2.3 `routes/pages.ts`

```ts
import { createRoute } from "@tanstack/react-router";
import { localeScopeLoader } from "@b2b-system/web-core/locales";
import { RootRoute } from "@b2b-system/web-core/router";
import { ROLE_LOCALE_SCOPE } from "../locale";
import { RoleSearchQuerySchema } from "./model";

export const RoleListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/role", // ★ 絕對路徑，直掛 RootRoute
  staticData: { titleKey: "menu.role" }, // 分頁標題「角色 · 產品名」（08-i18n.md §5）
  loader: localeScopeLoader(ROLE_LOCALE_SCOPE),
  validateSearch: RoleSearchQuerySchema,
});

export const RoleCreateRoute = createRoute({
  getParentRoute: () => RoleListRoute,
  path: "create",
  validateSearch: RoleSearchQuerySchema, // 對話框路由：保留列表的查詢條件
});

export const RoleDetailRoute = createRoute({
  getParentRoute: () => RoleListRoute,
  path: "$roleId",
});

export const RoleDetailPermissionRoute = createRoute({
  getParentRoute: () => RoleDetailRoute,
  path: "permission",
  // 系統角色沒有可編輯的權限 → 深連結直接擋掉
  beforeLoad: async ({ params: { roleId } }) => {
    const role = await queryClient.ensureQueryData(getRoleDetailQueryOptions({ roleId }));
    if (role.slug === "super-admin") {
      throw redirect({ to: RoleDetailRoute.to, params: { roleId }, replace: true });
    }
  },
});
```

**規則**：feature 的入口 route 必須直掛 `RootRoute` 且用絕對路徑——因為
`routeBasePath()` 依賴這一點。子路由用相對路徑。入口 route 帶 `staticData.titleKey`（完整字面量；
通常沿用選單的 `menu.*`），子路由（對話框）沒有時沿用上層；各 app 的 `locales.test.ts` 檢查每個 `titleKey` 都有翻譯。

### 2.4 `hooks/useRolePermission.ts` — 權限 facade

```ts
import { usePagePermission, usePermission, PermissionKey } from "@/core/permission";
import { ROLE_PAGE } from "../permission";

export function useRolePermission() {
  const page = usePagePermission(ROLE_PAGE);
  const { can } = usePermission();

  // 權限沒變時回傳同一個物件（列表的 rows 等 memo 以它或它的欄位為依賴）
  return useMemo(
    () => ({
      ...page, // canAccess/canCreate/canRead/canUpdate/canDelete
      /** 是否能進入權限子頁（role:read ＋ permission:read；沒有 role:grantPermission 時唯讀） */
      canManagePermission: page.canRead && can(PermissionKey.PermissionRead),
      /** 是否能授予／移除角色權限 */
      canGrantPermission: can(PermissionKey.RoleGrantPermission),
    }),
    [page, can],
  );
}
```

**頁面元件只呼叫這一個 hook**，不直接碰 `usePermission()`。好處：權限規則變了
只改一處，而且「這個 feature 有哪些權限概念」一眼看得完。
`usePagePermission()` 與 `usePermission()` 的參考在權限沒變時是穩定的（[`06-permission.md`](./06-permission.md) §5.1），
facade 以 `useMemo` 回傳，下游的 memo 才不會每次 render 都失效。

### 2.5 `pages/index.tsx` — lazy 邊界

```tsx
import { lazyRouteComponent } from "@tanstack/react-router";

export const AsyncRoleListPage = lazyRouteComponent(() => import("./RoleList/page"));
export const AsyncRoleCreatePage = lazyRouteComponent(() => import("./RoleCreate/page"));
export const AsyncRoleDetailPage = lazyRouteComponent(() => import("./RoleDetail/page"));
export const AsyncRoleDetailPermissionPage = lazyRouteComponent(
  () => import("./RoleDetailPermission/page"),
);
```

> **用 `lazyRouteComponent`，不用 React 的 `lazy`**：`lazyRouteComponent` 帶有
> `preload()`，Router 會在切換路由 **之前** 等 chunk 下載完（`defaultPreload: 'intent'`
> 也會在 hover 時先載）。`React.lazy` 沒有 `preload()`，Router 以為元件已就緒就
> commit，頁面在 render 時才 suspend；子 route 沒有自己的 Suspense 邊界，會被 root
> `<Outlet />` 的邊界接住，連同父頁面一起被隱藏——第一次點進子頁面（如
> `/user/create`）時整個列表頁會閃一下。

### 2.6 `pages/<Page>/adapter.ts` — DTO → View Model

```ts
export interface RoleRowVM {
  id: string;
  name: string;
  description: string; // 空值已正規化成 '-'
  isSystem: boolean;
  permissionCount: number;
  createdAt: Date; // 已轉 Date，時區交給顯示層
  canDelete: boolean; // ★ 已套用業務規則的衍生旗標
}

export function toRoleRowVM(dto: RoleListItem, perm: RolePermissionFacade): RoleRowVM {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description || "-",
    isSystem: dto.isSystem,
    permissionCount: dto.permissionCount,
    createdAt: new Date(dto.createdAt),
    canDelete: perm.canDelete && !dto.isSystem,
  };
}
```

**adapter 是後端契約變動的緩衝層。** 欄位改名、型別改變時，只有 adapter 要改，
表格與元件不動。

頁面以 `useMemo` 呼叫 adapter 時，依賴放 adapter 實際用到的值，不放整個 facade：

```ts
const { canDelete, canUpdate } = permission;
const rows = useMemo(
  () => (data?.items ?? []).map((role) => toRoleRowVM(role, { canDelete, canUpdate })),
  [data, canDelete, canUpdate],
);
```

`rows` 換新會讓 `useTableSelection()`、表格的 row model 跟著重建、每一列重繪；與資料、這幾個權限無關的重繪（查詢狀態、對話框）不該觸發它。

---

## 3. 業務邏輯放哪裡

| 邏輯類型          | 位置                                      | 例                      |
| ----------------- | ----------------------------------------- | ----------------------- |
| 純計算 / 判斷     | `hooks/` 裡的純函式或 `utils.ts`          | 「哪些權限可以授予」    |
| 需要 React 狀態   | `hooks/useXxx.ts`                         | `useRoleSearchFilter`   |
| 需要對話框 + 狀態 | `hooks/useXxxModal.tsx`                   | `useRoleDeleteModal`    |
| 需要打 API        | `hooks/useXxxMutation.ts`（包裝 `apis/`） | `useRoleCreateMutation` |
| 資料轉換          | `pages/<Page>/adapter.ts`                 | DTO → VM                |
| 渲染              | `pages/<Page>/components/*.tsx`           | `RoleTable`             |

**`page.tsx` 應該很薄**：它把 hook 的輸出接到元件的 props 上，不含條件分支的
業務規則。一個 `page.tsx` 超過 200 行通常代表有邏輯該搬進 hook。

### 3.1 `useXxxMutation` 的標準形狀

```ts
export function useRoleCreateMutation() {
  const toast = useToast(); // @b2b-system/web-core/notify：發到 eventBus，由 ToastHost（web-core/shell）渲染
  const { t } = useTranslation();

  return useMutation({
    ...getRoleCreateMutationOptions(),
    onSuccess: (role) => {
      // 只宣告後端改了什麼；要失效哪些 query 由依賴圖換算（05-data-layer.md §6.2）
      invalidateResources([{ resource: Resource.ROLE, kind: "create" }]);
      toast.success(t("role.create.success", { name: role.name }));
    },
    // 錯誤不在這裡吞掉：交給全域錯誤處理決定 toast，
    // 欄位層級錯誤由呼叫端的表單接手（見 05-data-layer.md §7）
  });
}
```

---

## 4. Feature 之間如何互動

**禁止** `import { something } from '@/features/user'`。三條合法途徑：

### 4.1 連結到別的 feature 的頁面 → route id（`web-core/route-link`）

擁有頁面的 feature 在 plugin 的 **同步** 階段把頁面登記成 route id；連結的一方只寫 id，不 import 對方的任何東西：

```ts
// features/user/routeLinks.ts（由 user 的 plugin.ts 呼叫）
registerRouteLink("user.detail", { route: UserDetailRoute, params: { userId: "userId" } });
```

```tsx
// features/role/pages/RoleDetail/components/RoleHolderSection.tsx
import { RouteLink } from "@b2b-system/web-core/route-link";

<RouteLink to="user.detail" params={{ userId }}>
  {user.displayName}
</RouteLink>;
```

- **渲染前就判斷能不能點**，不讓人點進 404／403（`useRouteLinkAccess()` 的四種狀態）：

  | 狀態 | 什麼時候 | `fallback="text"`（預設） | `fallback="hide"` |
  | --- | --- | --- | --- |
  | `ready` | 已登記，且目標頁不受管制或檢視者有權限 | 連結 | 連結 |
  | `unavailable` | id 沒登記（對方沒安裝、被停用）或缺參數 | 文字 | 不渲染 |
  | `pending` | 目標頁受管制，權限還沒水合 | 文字 | 不渲染 |
  | `forbidden` | 檢視者進不了目標頁 | 文字 | 不渲染 |

  權限與 route guard 是同一個判斷（`usePageAccess` 比對代入參數後的路徑）。名字本身有資訊（成員、持有人）用 `text`；
  純導覽的連結（「前往設定」）用 `hide`；要隱藏一整段（標題＋列表）時在外層呼叫 `useRouteLinkAccess()`。
  這只是體驗：頁面 guard 與 API 照常把關，而且只看得到「能不能進頁面」，看不到資料層級的權限。
- **`to` 必須寫完整的字面量**（`to="user.detail"`，不用變數或對照表）：執行期找不到 id 只會變成文字，
  打錯字、忘了登記、改名沒同步都靠 🔒 `app/__tests__/route-links.test.ts` 抓——它登記所有 feature 的 `routeLinks.ts`
  （含可啟用的），再掃原始碼裡的 `<RouteLink to>` 與 `useRouteLinkAccess()`。
- 不必知道對方的 search 格式：目標 route 的 `validateSearch` 會補上預設值。
- 同一張註冊表也是後端存的連結（站內通知的 `link`）的解析來源；規則見 [`15-notification.md`](./15-notification.md) §3。
  已被後端存下的 id 不改名；只給前端用的 id 可以隨頁面調整。
- 同一個 feature 內部的連結照常用自己的 route 物件（`RoleDetailRoute.to`），保留 TanStack 的型別檢查。

### 4.2 共用資料 → 走 `apis/`

角色詳情頁要顯示「持有此角色的使用者」，作法是用
`apis/role/get-role-users/query.ts`，**不是** import user feature 的東西。
`apis/` 是共享層，任何 feature 都能用。

### 4.3 共用 UI → 往上提

兩個 feature 都需要的業務元件，提到 app 的 `core/components/`；如果它不含業務語彙，
提到 `@b2b-system/ui`（`packages/ui`）；兩個 app 都要用、依賴語系或 store 的機制性元件放 `@b2b-system/web-core/components`。**不要**從 A feature import 到 B feature。

### 4.4 事件通知 → `eventBus`

```ts
// features/user 指派角色成功後
eventBus.emit(GlobalEvents.USER_ROLES_CHANGED, { userId });

// features/role 的詳情頁監聽，刷新它的使用者清單
useEffect(() => eventBus.on(GlobalEvents.USER_ROLES_CHANGED, refetch), []);
```

事件名稱定義在 `web-core/app/events.ts`（跨 feature）或
`features/<name>/enums/events.ts`（feature 內）。

---

## 5. 新增一個 feature 的 SOP

以新增 `features/session`（登入裝置管理）為例。

### Step 1 — 後端先行

1. 在 `docs/rbac/02-permission-catalog.md` 加上權限（`session:read` / `session:delete`）
2. `apps/api/src/db/seeds/permissions.ts` 加 seed
3. 實作 `apps/api/src/modules/session/`
4. `pnpm db:seed && pnpm sdk:generate`

### Step 2 — 前端 API 層

```
apis/session/
├── get-session-list/  { fetcher.ts, query.ts }
└── revoke-session/    { fetcher.ts, mutation.ts }
```

### Step 3 — 建立 feature 骨架

```bash
apps/backstage/src/features/session/
├── index.tsx
├── plugin.ts
├── permission.ts
├── locale.ts
├── routes/{index.ts,pages.ts,model.ts}
├── pages/{index.tsx,SessionList/page.tsx}
├── hooks/useSessionPermission.ts
└── locales/{en_US.json,zh_TW.json}
```

### Step 4 — 依序填入

| 順序 | 檔案                            | 內容                                                     |
| ---- | ------------------------------- | -------------------------------------------------------- |
| 1    | `locale.ts`                     | `export const SESSION_LOCALE_SCOPE = 'feature-session';` |
| 2    | `routes/model.ts`               | search 參數的 Zod schema                                 |
| 3    | `routes/pages.ts`               | `SessionListRoute`（`path: '/session'`，直掛 RootRoute） |
| 4    | `permission.ts`                 | `SESSION_PAGE` ＋ `registerSessionPagePermissions()`     |
| 5    | `plugin.ts`                     | 同步呼叫註冊；`onInit` 掛語系包                          |
| 6    | `hooks/useSessionPermission.ts` | 權限 facade                                              |
| 7    | `pages/SessionList/page.tsx`    | 頁面                                                     |
| 8    | `pages/index.tsx`               | `lazyRouteComponent` 匯出                                |
| 9    | `index.tsx`                     | `.update({ component })` ＋ 對外匯出                     |

### Step 5 — 接上 app

```diff
// main.tsx
+ import { sessionFeaturePlugin } from '@/features/session';
    .use(roleFeaturePlugin())
+   .use(sessionFeaturePlugin())
```

```diff
// app/routes.tsx
+ import { Routes as SessionRoutes } from '@/features/session';
  const routeTree = RootRoute.addChildren([
     RoleRoutes.RoleListRoute.addChildren([...]),
+    SessionRoutes.SessionListRoute,
  ]);
```

```diff
// app/layouts/DashboardLayout.tsx — 選單
+ { pageKey: SESSION_PAGE, to: SessionRoutes.SessionListRoute.to,
+   labelKey: 'menu.session', icon: DeviceIcon },
```

### Step 6 — 驗收清單

- [ ] `pnpm typecheck` 通過
- [ ] `core/permission/registry.test.ts` 通過（新 page key 已被涵蓋）
- [ ] 無權限的使用者看不到選單項，直接打網址也進不去（顯示 403 頁）
- [ ] 語系包在進入 `/session` 時才被下載（Network 面板確認）
- [ ] 註解掉 `main.tsx` 那一行後，app 仍能正常啟動（只是少了這個功能）
- [ ] 加上 `page.test.tsx` 與 MSW handler
- [ ] 更新 `docs/rbac/02-permission-catalog.md` §5 的頁面權限表

---

## 6. 反面教材

| ❌ 做法                                                       | ✅ 改成                                            |
| ------------------------------------------------------------- | -------------------------------------------------- |
| `import { UserStatusChip } from '@/features/user/components'` | 提到 `core/components/`，或在自己的 feature 裡重寫 |
| 在 `page.tsx` 直接 `fetch('/api/roles')`                      | 走 `apis/role/...`                                 |
| 在 `web-core/permission/constants.ts` 加 `ROLE_PAGE`          | feature 自己 `definePageKey()`                     |
| 語系包在 `plugin.ts` 不帶 `scope`                             | 帶上 scope，讓它隨路由載入                         |
| `routes/pages.ts` 直接 import 頁面元件                        | 在 `index.tsx` 用 `.update()` 綁 lazy 元件         |
| 一個 `role.api.ts` 放所有操作                                 | 一操作一資料夾                                     |
| 表格直接吃 API DTO                                            | 過 `adapter.ts` 轉 view model                      |
