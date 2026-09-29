# 前端 03 — Feature 解剖與新增 SOP

## 1. 標準結構

以 `features/role/` 為完整範例：

```
features/role/
├── index.tsx                  ★ 對外唯一入口：綁定元件、匯出 Routes 與 plugin
├── plugin.ts                  ★ AppContext plugin factory
├── permission.ts              ★ 頁面權限宣告與註冊
├── locale.ts                  語系 scope 名稱常數
├── preference.ts              （選用）往偏好頁註冊分頁
│
├── routes/
│   ├── index.ts               re-export pages.ts ＋ 匯出 ExternalRoutes
│   ├── pages.ts               ★ 本 feature 擁有的 route 物件
│   ├── model.ts               網址 search 參數的 Zod schema
│   └── external.ts            ★ 跨 feature 連結時引用的「別人的」route
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
│   ├── events.ts              本 feature 的事件名稱
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
export { appContextPlugin as roleFeaturePlugin } from "./plugin";
```

**只能匯出這兩樣東西。** `app/routes.tsx` 用 `Routes`，`main.tsx` 用 plugin。
其他 feature 想用的東西一律不從這裡出去（見 §4）。

### 2.2 `permission.ts`

```ts
import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from "@/core/permission";
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
import { EventEmitter } from "@/shared/EventEmitter";
import { localeScopeLoader } from "@/core/locales";
import { RootRoute } from "@/core/router";
import { RoleEvents } from "../enums/events";
import { ROLE_LOCALE_SCOPE } from "../locale";
import { RoleSearchQuerySchema } from "./model";

export const RoleListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/role", // ★ 絕對路徑，直掛 RootRoute
  loader: localeScopeLoader(ROLE_LOCALE_SCOPE),
  validateSearch: RoleSearchQuerySchema,
  context: () => ({
    eventBus: new EventEmitter<{ [RoleEvents.ROLE_UPDATED]: () => void }>(),
  }),
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
`routeBasePath()` 依賴這一點。子路由用相對路徑。

### 2.4 `hooks/useRolePermission.ts` — 權限 facade

```ts
import { usePagePermission, usePermission, PermissionKey } from "@/core/permission";
import { ROLE_PAGE } from "../permission";

export function useRolePermission() {
  const page = usePagePermission(ROLE_PAGE);
  const { can } = usePermission();

  return {
    ...page, // canAccess/canCreate/canRead/canUpdate/canDelete
    /** 是否能進入權限管理子頁（需要能讀權限目錄） */
    canManagePermission: page.canUpdate && can(PermissionKey.PermissionRead),
    /** 是否能授予／移除角色權限 */
    canGrantPermission: can(PermissionKey.RoleGrantPermission),
  };
}
```

**頁面元件只呼叫這一個 hook**，不直接碰 `usePermission()`。好處：權限規則變了
只改一處，而且「這個 feature 有哪些權限概念」一眼看得完。

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
  const toast = useToast(); // @/core/notify：發到 eventBus，由 app/ToastHost 渲染
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

### 4.1 連結到別的 feature 的頁面 → `routes/external.ts`

```ts
// features/role/routes/external.ts
export { UserListRoute, UserDetailRoute } from "@/features/user/routes";
```

```tsx
// features/role/pages/RoleDetail/RoleUserList.tsx
import { ExternalRoutes } from "../../routes";

<Link to={ExternalRoutes.UserDetailRoute.to} params={{ userId }}>
  {user.displayName}
</Link>;
```

只引用 route 物件（等同引用一個字串路徑），不引用元件、hook 或型別。
**集中在一個檔案裡**，所以「這個 feature 依賴哪些別的 feature」一眼可見。

### 4.2 共用資料 → 走 `apis/`

角色詳情頁要顯示「持有此角色的使用者」，作法是用
`apis/role/get-role-users/query.ts`，**不是** import user feature 的東西。
`apis/` 是共享層，任何 feature 都能用。

### 4.3 共用 UI → 往上提

兩個 feature 都需要的業務元件，提到 `core/components/`；如果它不含業務語彙，
提到 `components/`。**不要**從 A feature import 到 B feature。

### 4.4 事件通知 → `eventBus`

```ts
// features/user 指派角色成功後
eventBus.emit(GlobalEvents.USER_ROLES_CHANGED, { userId });

// features/role 的詳情頁監聽，刷新它的使用者清單
useEffect(() => eventBus.on(GlobalEvents.USER_ROLES_CHANGED, refetch), []);
```

事件名稱定義在 `core/app/events.ts`（跨 feature）或
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
| 在 `core/permission/constants.ts` 加 `ROLE_PAGE`              | feature 自己 `definePageKey()`                     |
| 語系包在 `plugin.ts` 不帶 `scope`                             | 帶上 scope，讓它隨路由載入                         |
| `routes/pages.ts` 直接 import 頁面元件                        | 在 `index.tsx` 用 `.update()` 綁 lazy 元件         |
| 一個 `role.api.ts` 放所有操作                                 | 一操作一資料夾                                     |
| 表格直接吃 API DTO                                            | 過 `adapter.ts` 轉 view model                      |
