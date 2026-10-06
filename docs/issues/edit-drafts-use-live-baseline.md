# 編輯中的草稿以即時資料當基準，推播或重抓後會蓋掉別人同時做的變更

## 現況

編輯途中，React Query 的資料會被重抓：推播的 `resource.changed`、視窗重新取得焦點（`refetchOnWindowFocus`）都會觸發。
下面四處在送出時，拿「最新的伺服器資料」計算差異或版本，而不是用開始編輯時的快照：

1. 角色權限：`apps/backstage/src/features/role/pages/RoleDetailPermission/page.tsx`（L27–41）。
   - `initial` 跟著 `current.data` 變（L27–30）。
   - `add`／`remove` 對 `initial` 計算（L40–41），L51 送出。

   ```ts
   const selected = draft ?? initial;
   const add = [...selected].filter((key) => !initial.has(key));
   const remove = [...initial].filter((key) => !selected.has(key));
   ```

2. 群組角色：`apps/backstage/src/features/group/hooks/useGroupRoleDraft.ts` 的 `useGroupRoleDraft()`（L13–21）。
   - diff 對 `current`（即時）計算。
   - `GroupDetail/components/GroupRoleSection.tsx` 傳入 `roles.data?.roles`（L25–26），L70 送出 diff。
   - 檔頭註解（L4–5）寫「兩人同時編輯不會互相覆寫」，實際不成立。
   - `hooks/__tests__/useGroupRoleDraft.test.ts` 第三個案例重現了這個情境（`select` 之後 `current` 變成 `['r1', 'r9']`），但沒有斷言 diff。

3. 服務帳號角色：`apps/backstage/src/features/service-account/pages/ServiceAccountDetail/components/ServiceAccountRoleSection.tsx`。
   - L71 送出 `expectedRoleIds: current`。`current`（L34）來自 `account.data.roles`，是即時資料（`ServiceAccountDetail/page.tsx` L67）。
   - 後端 `apps/api/src/modules/service-account/service-account.service.ts`（L204）以它比對，不符回 409。比對的是送出當下的值，所以永遠相符。
   - 檔頭註解（L25–26）寫「帶上編輯開始時的角色」，實際不是。

4. 檔案改名：`apps/backstage/src/features/file/pages/FileManager/components/FileRenameDialog.tsx`。
   - L50 送出 `version: file.version`。
   - `file` 來自 `useRenameTarget.ts` 的 L20，是列表裡的即時項目；L8 的註解寫明是刻意的（「別人改名後版本號更新」）。

正確的做法已經在 `apps/backstage/src/features/user/pages/UserDetail/useUserRoleSelection.ts` 的 `useUserRoleSelection()`（L23–44）：

- 第一次修改時記下 `base`（L28–29）。
- 送出 `expectedRoleIds: draft.base`（L40）。
- 伺服器資料和 `base` 不同時 `isStale` 為 true（L32），頁面提示「資料已被他人修改」。

附帶的同類問題：`apps/backstage/src/core/components/Tag/TagAssignDialog.tsx`（L48–51）在 `value` 參考改變時，把使用者的選擇重設成伺服器的值。
`apps/backstage/src/features/user/pages/UserDetail/components/UserTagSection.tsx`（L47）傳的是即時的 `user.tags`，
所以別人改了這個人的標籤時，正在選的內容會被默默清掉。

規格：[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11 最後一段寫「編輯途中推播讓資料重抓，也不能換成最新的版本，否則等於默默覆寫」。
[`rbac/04-api-spec.md`](../rbac/04-api-spec.md) §3.3 說明差異語意的目的是「避免整批取代造成的競態覆寫」。[`rbac/08-groups.md`](../rbac/08-groups.md) §3、§5 也寫群組角色送差異。

重現（角色權限）：

1. A 打開某角色的「管理權限」，勾選一個新的鍵，此時建立草稿。
2. B 在另一台電腦拿掉同一個角色的 `user:delete` 並儲存。
3. 推播讓 A 的 `initial` 不再含 `user:delete`，但 A 的 `selected` 還有，所以 `add` 多了 `user:delete`。
4. A 按儲存，`user:delete` 被加了回去。A 沒看到任何提示，摘要只多算了一筆「新增」。

## 影響

- 同時編輯同一個角色、群組、服務帳號或檔案名稱的兩位管理者。
- 角色權限與群組角色：別人剛撤銷的權限會被加回來，剛加上的會被拿掉。這是權限資料錯誤，有安全影響。
- 服務帳號角色：409 檢查失效，後送出的整批取代先送出的。
- 檔案改名：別人的改名被覆寫，雙方都沒有看到衝突。
- 前提：A 建立草稿之後、送出之前，資料被重抓。推播越即時越容易發生；反而是推播斷線時，diff 才是對的。

## 修正方式

1. 草稿第一次修改時記下基準快照，形狀同 `useUserRoleSelection`：`{ base, selected }`。
   - 角色權限：`add`／`remove` 改對 `draft.base` 計算。`initial` 和 `base` 不同時，顯示「已被他人修改」與「丟棄草稿」。
   - `useGroupRoleDraft`：diff 改對 `base` 計算，另外回傳 `isStale`；修正檔頭註解。
   - `ServiceAccountRoleSection`：`expectedRoleIds` 改用 `draft.base`。409 時保留選擇並顯示 stale 提示，不要在 `.finally` 清掉草稿（L75）。
2. 檔案改名：開啟對話框時記下 `version`（和名稱），送出帶它。衝突時用 `VersionConflictAlert`（`core/components`）提供「重新載入」，只有按了重新載入才換成新的版本。一併修正 `useRenameTarget` 與 `FileRenameDialog` 的註解。
3. `TagAssignDialog`：只在開啟的那一刻（`open` 從 false 變 true）以 `value` 初始化。開啟中 `value` 改變時顯示提示，不要直接覆寫選擇。

## 驗證方式

- `apps/backstage/src/features/group/hooks/__tests__/useGroupRoleDraft.test.ts`：`select` 之後 rerender 新的 `current`，斷言 diff 只含自己的變更，`isStale` 為 true。
- `apps/backstage/src/features/role/pages/RoleDetailPermission/__tests__/RoleDetailPermissionPage.test.tsx`：勾選後以 `queryClient.setQueryData` 模擬推播，再按儲存，斷言送出的 `add`／`remove` 不含別人的變更。
- `apps/backstage/src/features/service-account/pages/ServiceAccountDetail/__tests__/ServiceAccountDetailPage.test.tsx`：修改角色後更新 detail 的快取，斷言送出的 `expectedRoleIds` 是修改前的角色。
- 新增 `apps/backstage/src/features/file/pages/FileManager/__tests__/FileRenameDialog.test.tsx`：開啟後更新列表資料再送出，斷言帶的是舊 `version`；回 409 時出現 `version-conflict-alert`。
