# `usePermission()` 每次 render 都回傳新物件，下游的權限 memo 全部失效

## 現況

`packages/web-core/src/permission/hooks.ts` 的 `usePermission()`（L24–41）裡，`can`、`canEvery`、`canSome` 有 `useCallback`，但回傳的物件沒有 memo：

```ts
return { hydrated, permissions, can, canEvery, canSome };   // L40
```

下游把這個物件當成依賴，所以每次 render 都重算：

- `usePagePermission()`（L69–73）：`useMemo(…, [facade, rule])`，每次都產生新的結果。
- `usePageAccessChecker()`（L76–92）：`canAccessPage` 的 `useCallback` 依賴 `facade`（L89），每次 render 都換新。
  L75 的註解卻寫「回傳穩定的 predicate」。
- `usePageAccess()`（L102–119）：`useMemo` 依賴 `facade`（L118），每次都重算 `resolvePageKey()`。
  `<RouteLink>` 經 `useRouteLinkAccess()` 用到它，表格裡每個連結都要算一次。
- 選單：`web-core/layout/menu.ts` 的 `useMenuItems()`（L14–20）與兩個 app 的 `SidebarNav` 都依賴 `canAccessPage`，memo 也失效。

feature 的權限 facade 也每次產生新物件：

- 例如 `apps/backstage/src/features/role/hooks/useRolePermission.ts`（L6–20）展開 `...page` 後回傳新的物件。
- `useUserPermission`、`useApprovalPermission` 相同。

列表頁把 facade 放進 `rows` 的依賴，所以每次 render 都重建所有列：

- `features/role/pages/RoleList/page.tsx` L43–46：

  ```ts
  const rows = useMemo(
    () => (data?.items ?? []).map((role) => toRoleRowVM(role, permission)),
    [data, permission],
  );
  ```

- `features/approval/pages/ApprovalList/page.tsx` L40–43、`features/user/pages/UserList/page.tsx` L51–54 相同。
- 接著 `useTableSelection()`（`packages/ui/src/components/Table/useTableSelection.ts` L30 的 `byId`）、選取物件、`Table` 的 `data` 全部換新，TanStack Table 重算 row model，每一列重繪。

另外，`packages/web-core/src/auth/useSession.ts` 的 `useHasSession()`（L10–16）每次 render 都傳新的 subscribe 函式給 `useSyncExternalStore`，React 會在每次 render 時退訂再重新訂閱。

## 影響

- 列表頁任何一次重繪都會重建全部列並重繪整張表。觸發來源包括 query 狀態改變、mutation 進行中、語系包載入、權限水合。
  目前每頁最多 100 列，畫面上感覺不明顯，但成本是白花的。
- 有人依「回傳穩定的 predicate」的註解把 `canAccessPage` 放進 `useEffect` 的依賴時，effect 會在每次 render 都執行。
- 屬於效率與可讀性問題，目前不造成錯誤結果。

## 修正方式

1. `usePermission()` 用 `useMemo` 包住回傳物件，依賴 `hydrated`、`permissions` 與三個 callback。
   這樣 `usePagePermission`、`usePageAccessChecker`、`usePageAccess` 的 memo 都會生效。
2. feature 的 facade（`useRolePermission`、`useUserPermission`、`useApprovalPermission` 等）也用 `useMemo` 回傳。
3. adapter 的 memo 改依賴實際用到的布林值，例如 `[data, permission.canDelete]`，不依賴整個 facade。
4. `useHasSession()` 的 subscribe 改成 `useCallback`，或改成以 `session` 為鍵的穩定函式。
5. 修正 L75 的註解，使它與修正後的行為一致。

## 驗證方式

- `packages/web-core/src/permission/__tests__/` 新增 hook 測試（`renderHook` ＋ `rerender`）：權限沒變時，`usePermission()` 與 `usePageAccessChecker().canAccessPage` 前後是同一個參考；權限改變後才換新。
- `RoleList` 的頁面測試（或 hook 測試）：與資料、權限無關的 rerender 之後，`rows` 是同一個參考。
