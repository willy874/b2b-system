# admin、auditor、member 角色看不到「管理權限」入口，入口也用錯權限判斷

## 現況

角色詳情把所有系統角色的「管理權限」都藏起來：

- `apps/backstage/src/features/role/pages/RoleDetail/page.tsx`（L53、L87）：

  ```tsx
  const isSystem = role.data?.isSystem ?? false;
  {permission.canManagePermission && !isSystem && (
  ```

- 入口以 `role:update` 判斷：`apps/backstage/src/features/role/hooks/useRolePermission.ts`（L13）。

  ```ts
  canManagePermission: page.canUpdate && can(PermissionKey['permission:read']),
  ```

但其他地方都只擋 super-admin：

- 路由：`apps/backstage/src/features/role/routes/pages.ts` 的 `RoleDetailPermissionRoute.beforeLoad`（L43–55）只把 super-admin 導回詳情。
- 後端：`apps/api/src/modules/role/role.service.ts`（L201）只對 super-admin 回 `ROLE_SUPER_ADMIN_IMMUTABLE`。
- 權限頁本身以 `role:grantPermission` 決定能不能編輯：`RoleDetailPermission/page.tsx` L102 `readOnly={!permission.canGrantPermission}`。

規格：

- [`frontend/06-permission.md`](../architecture/frontend/06-permission.md) §7：角色詳情的權限分頁，進入要 `role:read` ＋ `permission:read`；增減權限要 `role:grantPermission` ＋ 非 super-admin。
- [`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §5：admin、auditor、member 可以改權限（仍受反提權限制）。

## 影響

- 想調整內建角色權限的管理者，例如讓所有 member 都有 `file:read`，在畫面上找不到入口。只能自己輸入網址 `/role/<id>/permission`，或另外建一個角色。
- 入口的權限判斷與頁面不一致：
  - 只有 `role:grantPermission`、沒有 `role:update` 的人看不到入口。
  - 只有 `role:update` 的人看得到入口，進去卻是唯讀。

## 修正方式

1. `RoleDetail/page.tsx` L87 的條件改成 `role.data?.slug !== 'super-admin'`，與路由、後端一致。
2. 入口條件改成規格的「`role:read` ＋ `permission:read`」。沒有 `role:grantPermission` 時，頁面本來就是唯讀（L102），按鈕文字可以改成「檢視權限」。
   `useRolePermission` 的 `canManagePermission` 依此修改。

## 驗證方式

`apps/backstage/src/features/role/pages/RoleDetail/__tests__/RoleDetailPage.test.tsx` 補：

- 系統角色 admin、member（`isSystem: true`，不是 super-admin），持有 `role:grantPermission`：顯示 `role-manage-permission-button`。
- super-admin：不顯示。
- 只有 `role:read` ＋ `permission:read`：顯示「檢視權限」，進去是唯讀。
