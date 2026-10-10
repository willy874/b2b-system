# 角色詳情對只有 `role:read` 的人仍查權限鍵，403 後顯示「無」

## 現況

- `apps/backstage/src/features/role/pages/RoleDetail/page.tsx` 第 38–41 行：`getRolePermissionsQueryOptions` 的 `enabled` 是 `permission.canManagePermission || permission.canRead`。
- `apps/backstage/src/features/role/hooks/useRolePermission.ts`：`canManagePermission = page.canRead && can('permission:read')`，所以這個條件等於 `canRead`——只要能看角色就會送出請求。
- `apps/api/src/modules/role/role.controller.ts` 第 156–161 行：`GET /roles/:id/permissions` 要 `role:read` **與** `permission:read`（EVERY），與 `docs/architecture/backend/05-rbac.md` 第 781 行一致。
- `apps/backstage/src/features/role/pages/RoleDetail/components/RolePermissionSection.tsx` 第 21–29 行：`permissions` 是 `undefined` 或空陣列時都顯示 `common.none`（「無」），不分「沒有權限」「查詢失敗」「真的沒有」。

## 影響

只有 `role:read`、沒有 `permission:read` 的人（自訂角色很容易組出這種組合）打開角色詳情：

- 每次打開都送一個必定 403 的請求（全域的錯誤處理可能另外彈出提示）。
- 「權限」區塊顯示「無」，看起來像這個角色沒有任何權限——對管理或稽核的人是錯誤的資訊。

嚴重度中：沒有洩漏資料（後端擋住了），但畫面顯示與事實不符，且與規格（權限子頁要 `role:read` ＋ `permission:read`，`docs/architecture/iam/02-permission-catalog.md` 第 426 行）的判斷不一致。

## 修正方式

1. `enabled: permission.canManagePermission`（即 `role:read` ＋ `permission:read`）。
2. `RolePermissionSection` 加一個 `canView` 參數：不能看時不渲染這個區塊，或顯示「需要『檢視權限目錄』權限才能查看」；`rolePermissions.isError` 時顯示錯誤而不是「無」；`isPending` 時顯示骨架。
3. `docs/architecture/iam/02-permission-catalog.md` 第 56 行 `role:read` 的說明寫「角色列表與詳情、角色已授予的權限」，與端點實際要求不一致，一併改成「已授予的權限另要 `permission:read`」（或反過來放寬端點，但那是權限模型的決定，要另外討論）。

## 驗證方式

- 頁面測試（`RoleDetail` 的三個權限案例）：只有 `role:read` 時不送 `GET /roles/:id/permissions`、不顯示「無」；有 `role:read` ＋ `permission:read` 時列出權限；查詢失敗時顯示錯誤。
- E2E 不必加。

（2026-10-10 backstage 各功能的優化分析發現。）
