# 前端 06 — 權限

> 前端的權限判斷 **只影響 UI**。後端的 `PermissionsGuard` 才是安全邊界。
> 前端做這些是為了「不要讓使用者看到他按不動的按鈕」，不是為了防護。

---

## 1. 模組組成

```
packages/web-core/src/permission/      機制（兩個 app 共用；@b2b-system/web-core/permission）
├── register.ts     PermissionRegister — app 以 module augmentation 登記自己的權限目錄
├── constants.ts    PermissionAction / PageKey / PagePermissionRule /
│                   evaluateAccess / definePageKey / buildPermissionKey
├── registry.ts     ★ 執行期頁面註冊表
├── hooks.ts        usePermission / usePagePermission /
│                   usePageAccessChecker / usePageAccess
└── index.ts

apps/<app>/src/core/permission/        這個 app 的權限目錄
├── enums.ts        PermissionKey — 對 api-sdk 的唯一收斂點
├── resources.ts    PermissionResource
└── index.ts        登記給 web-core、轉出 web-core 的機制；app 的其他地方只從 @/core/permission import
```

```ts
// apps/<app>/src/core/permission/index.ts
declare module "@b2b-system/web-core/permission/register" {
  interface PermissionRegister {
    key: AppPermissionKey;
    resource: AppPermissionResource;
  }
}
export * from "@b2b-system/web-core/permission";
export { ALL_PERMISSION_KEYS, PermissionKey } from "./enums";
export { PermissionResource } from "./resources";
```

登記之後，web-core 的 `PermissionKey`／`PermissionResource` 型別（`usePermission`、`PagePermissionRule` 等）在那個 app 裡收斂成它的鍵；
沒登記時（package 自己的型別檢查與測試）是 `string`。backstage 是租戶的目錄，apps/platform 是平台的目錄。

---

## 2. `enums.ts` — 唯一的 SDK 接點

```ts
import { PermissionKey as ApiPermissionKey } from "@/shared/api-sdk";

export const PermissionKey = ApiPermissionKey;
export type PermissionKey = (typeof PermissionKey)[keyof typeof PermissionKey];
```

整個 app 只有這個檔案為了權限而碰 `api-sdk`。若後端的表示法有天跟我們想要的
內部表示法分歧，在這裡重新對應，下游一行都不用改。

---

## 3. `constants.ts`、`resources.ts` — 權限的代數

```ts
// web-core/permission/constants.ts
export const PermissionAction = {
  CREATE: "create",
  READ: "read",
  UPDATE: "update",
  DELETE: "delete",
} as const;

// apps/<app>/src/core/permission/resources.ts
export const PermissionResource = {
  USER: "user",
  ROLE: "role",
  PERMISSION: "permission",
  AUDIT_LOG: "auditLog",
  SYSTEM: "system",
} as const;

export function buildPermissionKey(
  resource: PermissionResource,
  action: PermissionAction,
): PermissionKey {
  return `${resource}:${action}` as PermissionKey;
}
```

`buildPermissionKey('auditLog', 'create')` 會產生一個後端從不核發的鍵——
這是可以的。權限集合裡永遠不會有它，所以該能力恆為 `false`。這讓
「從資源派生 CRUD 四個能力」可以對所有資源一致地做，不需要特例表。

### 3.1 `PageKey` — 品牌化字串

```ts
export type PageKey = string & { readonly __brand: "PageKey" };

export function definePageKey(key: string): PageKey {
  return key as PageKey;
}
```

web-core 只擁有 **形狀**，不擁有清單。`definePageKey('ROLE')` 由
`features/role/permission.ts` 呼叫。品牌型別讓隨手寫的字串沒辦法混進需要
`PageKey` 的位置。

### 3.2 `PagePermissionRule`

```ts
export interface PagePermissionRule {
  /** 這一頁治理的資源。有了它才能派生 canCreate/canRead/canUpdate/canDelete。
   *  屬於使用者自己的頁面（profile/preference）與永遠公開的頁面（home）不填。 */
  resource?: PermissionResource;
  /** 進入這一頁所需的權限鍵。空陣列 = 任何已登入使用者都能進。 */
  access: PermissionKey[];
  /** access 的判定方式 */
  match: PermissionMatch; // EVERY | SOME
}

export function evaluateAccess(rule, canEvery, canSome): boolean {
  if (rule.match === PermissionMatch.EVERY) return canEvery(rule.access);
  if (rule.match === PermissionMatch.SOME) return canSome(rule.access);
  throw new Error(`Unsupported permission match: ${rule.match}`);
}
```

明確列舉每個分支並在未知策略時 **丟例外**（而非 default false 或 default true）：
未來新增 match 模式時會大聲失敗，而不是靜默地把頁面全開或全關。

---

## 4. `registry.ts` — 執行期註冊表

```ts
const registry = new Map<PageKey, PageRegistration>();

export interface PageRegistration {
  rule: PagePermissionRule;
  /** 錨定這一頁的 base path。'/role' 會命中 '/role'、'/role/create'、'/role/$id/…'
   *  根路徑 '/' 只精確命中。以 routeBasePath() 從 route 物件取得。 */
  route: string;
}

export function registerPagePermission(page: PageKey, reg: PageRegistration): void {
  if (registry.has(page)) throw new Error(`Page permission already registered: ${page}`);
  for (const [existing, r] of registry) {
    if (r.route === reg.route) {
      throw new Error(`Route "${reg.route}" is already registered by page ${existing}`);
    }
  }
  registry.set(page, reg);
}

export function requirePagePermission(page: PageKey): PageRegistration {
  const reg = registry.get(page);
  if (!reg) {
    throw new Error(
      `Page permission not registered: ${page}. 請在擁有它的 feature 的 permission.ts 中註冊。`,
    );
  }
  return reg;
}

export function resolvePageKey(pathname: string): PageKey | undefined {
  // 命中多筆時取「最長」的 base path：`/user/create` 有自己的規則時，
  // 不應該被 `/user` 的規則蓋過去。
  let matched: { page: PageKey; length: number } | undefined;

  for (const [page, { route }] of registry) {
    if (route === "/") {
      if (pathname === "/") return page;
      continue;
    }
    if (pathname !== route && !pathname.startsWith(`${route}/`)) continue;
    if (!matched || route.length > matched.length) matched = { page, length: route.length };
  }

  return matched?.page;
}

/** 測試專用：讓每個 suite 能重建註冊表。正式程式從不解除註冊。 */
export function resetPagePermissionRegistry(): void {
  registry.clear();
}
```

### 4.1 三個設計決定

| 決定                                       | 理由                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **重複註冊丟例外**                         | 一頁只有一個擁有者；路由 base 必須唯一，否則 `resolvePageKey` 有歧義                              |
| **`requirePagePermission` miss 時丟例外**  | 所有呼叫點都在 plugin 註冊之後執行，miss 只可能是 feature 忘了註冊 → 應該大聲壞掉，不要 fail-open |
| **`resolvePageKey` miss 時回 `undefined`** | 路徑可能本來就不受管（`/auth/*`、devtools），guard 視為不受管即可                                 |

兩者看似矛盾，其實對應不同問題：前者是「頁面存在但沒註冊」（bug），
後者是「路徑不是受管頁面」（正常）。

### 4.2 靜態表的完整性去哪了

原本若有 `Record<PageKey, Rule>`，TypeScript 會在漏掉某頁時編譯失敗。換成
執行期註冊表後，這個保證由一支測試接手：

```ts
// apps/<app>/src/core/permission/__tests__/feature-registration.test.ts
it("註冊的頁面鍵集合等於所有 feature 匯出的頁面鍵之聯集", () => {
  resetPagePermissionRegistry();
  registerAllFeaturePagePermissions(); // 呼叫每個 feature 的註冊函式
  expect(new Set(getRegisteredPageKeys())).toEqual(
    new Set([
      HOME_PAGE,
      USER_PAGE,
      ROLE_PAGE,
      PERMISSION_PAGE,
      AUDIT_LOG_PAGE,
      PROFILE_PAGE,
      PREFERENCE_PAGE,
    ]),
  );
});
```

---

## 5. Hooks

### 5.1 `usePermission()` — 底層

```ts
const { hydrated, permissions, can, canEvery, canSome } = usePermission();
```

| 回傳             | 說明                                      |
| ---------------- | ----------------------------------------- |
| `hydrated`       | profile 是否已同步過至少一次              |
| `permissions`    | `Set<PermissionKey>`                      |
| `can(key)`       | 單一鍵                                    |
| `canEvery(keys)` | 全部持有                                  |
| `canSome(keys)`  | 至少一個；**空陣列回 `true`**（＝不設限） |

**大多數情況不該直接用它**，用下面的頁面級 hook 或 feature 的 facade。

**參考是穩定的**：權限集合沒變時，`usePermission()`、`usePagePermission()` 回傳同一個物件，`can`／`canEvery`／`canSome`、
`usePageAccessChecker().canAccessPage` 也是同一個函式，可以放進 `useMemo`／`useEffect` 的依賴。
feature 的 facade 照做（`useMemo` 包住回傳的物件，[`03-feature-anatomy.md`](./03-feature-anatomy.md) §2.4）；
列表的 `rows` 只依賴 adapter 用到的布林值（`[data, canDelete, canUpdate]`），不依賴整個 facade（同一份文件 §2.6）。

### 5.2 `usePagePermission(pageKey)` — 頁面級

```ts
const { hydrated, canAccess, canCreate, canRead, canUpdate, canDelete } =
  usePagePermission(ROLE_PAGE);
```

從 rule 的 `resource` 派生 CRUD 四個能力。沒有 `resource` 的頁面（profile、
preference、home）四個全為 `false`，但 `canAccess` 仍為 `true`。

### 5.3 `usePageAccessChecker()` — 供迴圈使用

```ts
const { hydrated, canAccessPage } = usePageAccessChecker();
const items = MENU.filter((m) => canAccessPage(m.pageKey));
```

`canAccessPage` 只在權限集合或頁面註冊表改變時換新。hook 不能在迴圈裡呼叫，所以選單過濾必須用這個。

### 5.4 `usePageAccess(pathname)` — 供 route guard 使用

```ts
const { hydrated, page, gated, canAccess } = usePageAccess(pathname);
```

從 **原始路徑字串** 解析。未註冊或無限制的路徑回
`{ gated: false, canAccess: true }`，讓 guard 不必等待權限水合就能渲染。

---

## 6. UI Gating 的三個層級

### 層級 1 — 選單

```tsx
const items = useMenuItems(); // 已過濾
```

無權限的項目 **不存在**。未水合時回空陣列，不閃爍。

### 層級 2 — 頁面

```tsx
// app/Layout.tsx
if (!gated) return <Outlet />;
if (!hydrated) return <PageSkeleton />;
if (!canAccess) return <ForbiddenPage />;
return <Outlet />;
```

### 層級 3 — 元素

```tsx
// 建立鈕：永遠不會有這個權限 → 不渲染
{permission.canCreate && <ButtonLink to={RoleCreateRoute.to}>{t("role.create.action")}</ButtonLink>}

// 批次刪除（features/role/pages/RoleList/useRoleBatchActions.ts）：
// 沒有 role:delete → hidden；有權限但選到的都是系統角色 → isEligible 全為 false，按鈕停用 ＋ tooltip
{
  id: "delete",
  hidden: !permission.hydrated || !permission.canDelete,
  isEligible: (row) => row.canDelete && row.userCount === 0,
  …
}
```

批次操作的完整寫法見 [`07-ui-system.md`](./07-ui-system.md) §6.2。

### 6.1 隱藏還是 disable？

| 情況                                                           | 作法                        | 理由                           |
| -------------------------------------------------------------- | --------------------------- | ------------------------------ |
| 使用者永遠不會有這個權限（例如 auditor 看刪除鍵）              | **隱藏**                    | 少一個噪音                     |
| 使用者有權限，但當下狀態不允許（選到的列都不適用、目標是系統角色） | **disable ＋ tooltip 說明** | 使用者需要知道為什麼           |
| 反提權導致某個權限不能授予                                     | **disable ＋ 說明**         | 隱藏會讓人以為系統沒有這個權限（技能樹上是 `locked` 節點，面板寫出原因） |

判準：**「為什麼不能按」對使用者有意義就 disable，沒意義就隱藏。**

### 6.2 `PermissionGate` 元件

宣告式的寫法，供巢狀較深的地方使用：

```tsx
// web-core/components/PermissionGate/PermissionGate.tsx
<PermissionGate require={[PermissionKey.RoleDelete]} match="every" fallback={null}>
  <DeleteButton />
</PermissionGate>
```

不要濫用：能用 `&&` 的地方就用 `&&`，`PermissionGate` 留給
「多個權限 ＋ 需要 fallback」的場合。

---

## 7. 各頁面的能力對照

| 頁面                  | 進入                             | 元素                                                                                                                                                         |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 使用者列表            | `user:read`                      | 建立鈕 → `user:create`；編輯 → `user:update`；刪除 → `user:delete` ＋ 非自己；重設密碼 → `user:resetPassword`；解鎖 → `user:update` ＋ `status === 'locked'` |
| 使用者詳情 · 角色分頁 | `user:read`                      | 編輯角色 → `user:assignRole` ＋ 非自己；可選角色清單受反提權過濾                                                                                             |
| 角色列表              | `role:read`                      | 建立 → `role:create`；複製 → `role:create`；編輯 → `role:update` ＋ 非系統角色；刪除 → `role:delete` ＋ 非系統角色                                           |
| 角色詳情 · 權限分頁   | `role:read` ＋ `permission:read` | 入口在角色詳情（系統角色也有，只有 super-admin 沒有）：有 `role:grantPermission` 時是「管理權限」，否則「檢視權限」、進去唯讀；增減權限 → `role:grantPermission` ＋ 非 super-admin；以 **技能樹** 挑選（點上層自動點亮前置、有上層時不能取消前置；未持有的鍵停用，§8） |
| 權限目錄              | `permission:read`                | 全唯讀；一覽表與 **樹狀圖** 兩種檢視、共用篩選（關鍵字、資源、是否持有），檢視、篩選與選取的權限都放在網址（[`iam/02-permission-catalog.md`](../iam/02-permission-catalog.md) §9.4） |
| 稽核日誌              | `auditLog:read`                  | 全唯讀                                                                                                                                                       |
| 檔案管理器            | `file:access` 或 `file:read`     | 資料夾層級授權：按鈕看後端回傳的 `capabilities`，不看全域權限鍵（[`12-file-manager.md`](./12-file-manager.md) §13）                                           |
| 個人資料 / 偏好       | 無                               | 全部可用（對象是自己）                                                                                                                                       |

---

## 8. super-admin 在前端沒有特例

後端的 `GET /auth/profile` 對 super-admin 回傳 **完整展開** 的權限鍵陣列
（全部 15 筆），因此前端完全不需要 `isSuperAdmin` 這樣的分支。

這個決定的價值：前端只有一個判斷方式（「你的集合裡有沒有這個鍵」）。
任何 `if (user.isSuperAdmin || can(...))` 都是一個未來會被漏掉的地方。

---

## 9. 測試

```tsx
// web-core/testing/renderWithPermissions.tsx
export function renderWithPermissions(ui: ReactElement, permissions: PermissionKey[] = []) {
  usePermissionStore.setState({ permissions: new Set(permissions), hydrated: true });
  return render(ui, { wrapper: AllProviders });
}
```

每個受權限影響的元件至少要有三個案例：

```tsx
describe("RoleListToolbar", () => {
  it("有 role:create 時顯示建立按鈕", () => {
    renderWithPermissions(<RoleListToolbar />, [PermissionKey.RoleRead, PermissionKey.RoleCreate]);
    expect(screen.getByRole("button", { name: "建立角色" })).toBeInTheDocument();
  });

  it("沒有 role:create 時不顯示建立按鈕", () => {
    renderWithPermissions(<RoleListToolbar />, [PermissionKey.RoleRead]);
    expect(screen.queryByRole("button", { name: "建立角色" })).not.toBeInTheDocument();
  });

  it("權限尚未水合時不閃現任何操作按鈕", () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    render(<RoleListToolbar />, { wrapper: AllProviders });
    expect(screen.queryByRole("button", { name: "建立角色" })).not.toBeInTheDocument();
  });
});
```

第三個案例常被忘記，但它對應一個真實的體驗缺陷：水合前若 `can()` 回 `false`
而 UI 直接渲染，使用者會看到按鈕在載入後突然出現；若 UI 用 `hydrated` 擋住，
就不會。

---

## 8. 權限依賴樹與角色權限的技能樹

- `GET /auth/profile` 的 `permissions` 已套用 **權限依賴樹的閉包**（[`iam/02-permission-catalog.md`](../iam/02-permission-catalog.md) §9）：
  只被授予 `file:delete` 的人，`can('file:read')` 也是 true。前端不需要自己展開，也不要再寫「有 A 或 B 就顯示」的特判。
- 角色的權限在 `features/role/components/PermissionSkillTree.tsx` 挑選（建立角色、管理角色權限兩個對話框）：
  - 主要入口是 **樹狀下拉選單**（設計系統的 `Select`，`multiple` ＋ `searchable` ＋ 群組；`data-testid="role-permission-select"`，
    選項 `role-permission-option`、`data-value` 是權限鍵）：每個資源一組、組內依技能樹由上而下的順序；值是亮著的鍵（明確 ＋ 已包含），
    已包含與無法授予的鍵停用並在選項下方寫出原因；勾群組等於勾整組可授予的鍵（只留沒被同批其他鍵帶出的，`selectSkills`）。
  - **技能樹** 預設收合（`Collapsible`，`role-permission-tree-toggle`），展開才掛上畫布；與下拉選單共用 `usePermissionSkillTree` 的狀態，
    任一邊改動另一邊同步，在下拉選單選的鍵會在技能樹上強調前置路徑並顯示在說明面板。
  - 版面：每個資源一組、基礎在上、由上而下讀（`TreeEditor` 的 `direction="TB"`、`groups`）；子能力是實線、跨資源的依賴是虛線。
  - 狀態：已授予（`explicit`）／已包含（`implied`，由上層帶出、鎖住）／可授予（`available`）／無法授予（`unavailable`，反提權）。
  - 互鎖：點上層 → 前置成為已包含；點已包含的（或還有上層的明確鍵）→ 擋下並念出「先取消包含它的 …」；只送出明確點選的鍵。
  - 規則是純函式（`features/role/hooks/permissionSkillTree.ts`），狀態在 `usePermissionSkillTree`；節點內是 `aria-pressed` 的按鈕
    （`data-testid="role-permission-node"`、`data-value` 是權限鍵、`data-state` 是狀態），鍵盤以 Tab 移動、Enter／Space 切換。
  - 目錄的依賴來自 `GET /permissions` 每一項的 `includes`／`requires`；super-admin 角色由 `GET /roles/:id/permissions` 的 `isSuperAdmin` 判斷、整棵唯讀。
- 已知：技能樹展開後關閉對話框時 React Flow 卸載，開發模式的 console 會出現一次 React 的 `flushSync` 警告，不影響功能。

