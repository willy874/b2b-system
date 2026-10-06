# 頁面權限守衛以大小寫比對路徑，router 卻不分大小寫，`/USER`、`/User/create` 不會顯示 403

## 現況

- 守衛在 Layout，拿網址上原樣的 `location.pathname` 去查頁面權限：
  - `apps/backstage/src/app/Layout.tsx` 的 `Layout()`（L37–42）
  - `apps/platform/src/app/Layout.tsx` 的 `Layout()`（L26–28）

  ```ts
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { hydrated, gated, canAccess } = usePageAccess(pathname);
  ```

- `packages/web-core/src/permission/registry.ts` 的 `resolvePageKey()`（L50–66）逐字比對：

  ```ts
  if (pathname !== route && !pathname.startsWith(`${route}/`)) continue;
  ```

- `packages/web-core/src/permission/hooks.ts` 的 `usePageAccess()`（L102–119）：找不到頁面鍵時回 `{ gated: false, canAccess: true }`（L107），Layout 直接渲染 `<Outlet />`。
- router 卻不分大小寫：
  - `apps/backstage/src/app/plugin.ts` 的 `createAppRouter()`（L12–25）、`apps/platform/src/app/plugin.ts` 的 `createAppRouter()`（L10–21）都沒有設 `caseSensitive`。
  - TanStack Router 預設不分大小寫（`@tanstack/router-core` 的 `processRouteTree(routeTree, caseSensitive = false)`）。

以專案使用的 `@tanstack/react-router` 實測（memory history 載入後讀 `router.state`）：

| 網址 | 命中的 route | `location.pathname`（守衛拿到的） | 最後一個 match 的 `pathname` | `resolvePageKey()` |
| --- | --- | --- | --- | --- |
| `/ROLE` | `/role` | `/ROLE` | `/role` | `undefined`（視為不受管） |
| `/User/create` | `/user` → `/user/create` | `/User/create` | `/user/create` | `undefined` |
| `/ROLE`（`caseSensitive: true`） | 只有 root，顯示 404 | — | — | — |

重現步驟：

1. 以 auditor 登入 backstage，直接開 `/User/create`：出現建立使用者的對話框。開 `/user/create` 則是 403 頁。
2. 以 member 開 `/ROLE`：出現角色列表的外框與工具列。資料請求被後端以 403 擋下，畫面跳出「權限已變更」的提示。

## 影響

- 沒有資料外洩：API 仍由後端的 `PermissionsGuard` 擋下（[`frontend/06-permission.md`](../architecture/frontend/06-permission.md) 開頭：前端的權限判斷只影響 UI）。
- 但前端守衛承諾的行為沒有做到：
  - CLAUDE.md「與文件不同的實作決定」中「建立對話框的權限」一列：auditor 直接貼 `/user/create` 要看到 403。改成 `/User/create` 就看不到。
  - 沒有權限的人看得到頁面骨架、工具列與按鈕，按下去才被後端拒絕。
- apps/platform 的平台管理頁（`/TENANT`、`/ADMIN`…）同理。
- 可啟用 feature 的頁面另有 route 的 `beforeLoad: requireFeature()`，feature 未啟用時仍是 404；已啟用時一樣會繞過頁面守衛。

## 修正方式

擇一（建議 1）：

1. 兩個 app 的 `createAppRouter()` 加 `caseSensitive: true`。大小寫不符的網址一律 404，router 與守衛的比對規則一致。
   目前所有 route 的靜態路徑都是小寫，不影響既有的連結與 `registerPagePermission` 的路徑。
2. Layout 改用 router 比對後的路徑，不用原始網址：`useRouterState({ select: (s) => s.matches.at(-1)?.pathname })`（`/USER` 比對後是 `/user`）。
   `useFeatureGate()`、backstage 的 `matchers` 與 apps/platform 的 `BARE_PREFIXES` 判斷也改用同一個值。

修正後在 [`frontend/04-routing.md`](../architecture/frontend/04-routing.md) §4 補一句：路徑比對分大小寫（或：守衛以比對後的路徑判斷）。

## 驗證方式

- `apps/backstage/src/app/__tests__/Layout.test.tsx`：以沒有 `user:read` 的權限渲染 `/USER`，斷言出現 `forbidden-page`（方案 1 則是 404）。
- apps/platform 補同樣的案例：`/TENANT`。
- `apps/e2e/tests/route-guard.spec.ts`：
  - 在「auditor 直接進入 /user/create 看到 403 頁」（L9–15）旁補 `/User/create`。
  - 在「member…直接打 /role 看到 403」（L17–24）旁補 `/ROLE`。
