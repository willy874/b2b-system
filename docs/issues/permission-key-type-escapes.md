# 角色的權限選取以 `as never` 繞過 `PermissionKey` 的型別檢查

## 現況

角色的權限挑選把選取狀態宣告成 `Set<string>`，送出時用 `as never` 硬塞給 SDK 要求的 `PermissionKey[]`：

- `apps/backstage/src/features/role/pages/RoleCreate/page.tsx`：
  - L31 `useState<Set<string>>(new Set())`。
  - L57 `permissionKeys: [...selected] as never`。
- `features/role/pages/RoleDetailPermission/page.tsx`：
  - L28 把既有的權限轉成字串：`new Set<string>(… .map((item) => String(item.key)))`。
  - L32 `useState<Set<string>>()`。
  - L51 `body: { add: add as never, remove: remove as never }`。
- `features/role/hooks/useGrantablePermissions.ts` L25：`isGrantable: (key: string) => mine.has(key as never)`。
  `permissionSkillTree.ts`（L48、L72、L97）的 `isGrantable` 參數也是 `(key: string) => boolean`。

SDK 的型別要求的是權限鍵：

```ts
export interface CreateRoleRequest { …; permissionKeys: Array<PermissionKey>; }   // packages/api-sdk/src/generated/models.ts L1464–1468
export interface UpdateRolePermissionsRequest { add: Array<PermissionKey>; remove: Array<PermissionKey>; }   // L1541–1544
```

`as never` 可以指派給任何型別，所以任何字串陣列都能通過編譯。
它也不是 `any`，`.oxlintrc.json` 的 `typescript/no-explicit-any` 抓不到。

同一個 feature 的 `routes/pages.ts` L45、L50 另有 `(params as { roleId: string }).roleId`。這是 TanStack Router 在 `beforeLoad` 的型別限制，影響小，可以一起整理。

## 影響

- [`frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §3.1 的保證是「寫錯鍵或資源名稱在兩個 app 都會編譯失敗」。在角色權限這條最重要的寫入路徑上，這個保證失效。
- 情境：權限樹或目錄的資料來源改了，例如把群組節點的 id、或舊版的鍵放進選取。編譯不會擋，要等後端回 400 才發現。
- 目前選取的值都來自權限目錄的 `key`，所以實際送出的仍是合法的鍵。屬於型別安全的缺口，不是現有的錯誤。

## 修正方式

1. 在 `core/permission` 加一個型別守衛：

   ```ts
   const KEY_SET: ReadonlySet<string> = new Set(ALL_PERMISSION_KEYS);   // core/permission/enums.ts L10
   export const isPermissionKey = (value: string): value is PermissionKey => KEY_SET.has(value);
   ```

2. 選取狀態改成 `Set<PermissionKey>`：
   - `RoleCreate` L31、`RoleDetailPermission` L28、L32 不再轉成 `string`。
   - 樹狀挑選器回傳字串的地方，在邊界用 `isPermissionKey()` 收窄。
3. 拿掉 L57、L51、`useGrantablePermissions.ts` L25 的 `as never`。
   `isGrantable` 與 `permissionSkillTree.ts` 的參數型別改成 `PermissionKey`，或在函式內收窄。
4. 選做：在 oxlint 加規則擋 `as never`（或在 review 清單加上這一條）。

## 驗證方式

- `pnpm typecheck` 通過，`git grep "as never" -- apps/backstage/src apps/platform/src packages/web-core/src` 沒有結果。
- 角色的建立、權限編輯既有的頁面測試照過。
- 補 `isPermissionKey()` 的單元測試：目錄中的鍵為 true；任意字串、群組 id 為 false。
