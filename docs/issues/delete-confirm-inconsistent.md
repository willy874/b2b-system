# 刪除確認有兩種寫法，失敗後對話框關不關不一致

## 現況

`docs/architecture/frontend/07-ui-system.md` §3.11 說明 `useConfirm()`（`packages/ui/src/components/ConfirmDialog/`）就是為了取代
「每個要確認的地方自己維護待確認項目的 state 與一份 `<AlertDialog>`」，並規定 `onConfirm` 丟錯時 **對話框留著**，讓使用者重試或取消。

目前 backstage 兩種寫法並存（路徑相對 `apps/backstage/src/features/`）：

- `useConfirm()`：19 處（例：`comment/components/CommentItem.tsx:48-55`、`file/pages/FileManager/components/FileGrantRow.tsx:45-50`）。
- 自己維護 `pendingDelete`／`removing` ＋ `<AlertDialog>`：9 處，而且失敗後的行為分成兩派：

| 位置 | `<AlertDialog>` | 失敗後 |
| --- | --- | --- |
| `webhook/pages/WebhookList/page.tsx` | `:84-104` | 留著（`try/catch` 後 `return`） |
| `group/pages/GroupList/page.tsx` | `:174-204` | 留著 |
| `service-account/pages/ServiceAccountList/page.tsx` | `:115-139` | 留著 |
| `tag/pages/TagList/page.tsx` | `:156-176` | 留著 |
| `organization/pages/Organization/page.tsx` | `:229-255` | 留著 |
| `role/pages/RoleList/page.tsx` | `:187-221` | 留著；`ROLE_IN_USE` 時改寫 `pendingDelete.userCount`，對話框換成「強制刪除」的說明（`:205-218`） |
| `user/pages/UserList/page.tsx` | `:239-259` | **關閉**（`.catch(() => undefined)` 之後無條件 `setPendingDelete(undefined)`，`:252-256`） |
| `identity-provider/pages/IdentityProviderList/page.tsx` | `:179-192` | **關閉**（`.catch(showError)` 之後無條件 `setRemoving(undefined)`，`:187-190`） |
| `user/pages/UserDetail/components/UserIdentitySection.tsx` | `:106-124` | **關閉**（`.catch(() => undefined)`） |

前六處的程式註解都寫著「對話框留著讓使用者重試或取消」，後三處沒有說明為什麼不同。
IdP 那一處（含缺少 `tone="danger"`、確認文字）另有一份 [`identity-provider-delete-error-closes.md`](./identity-provider-delete-error-closes.md)，兩份可以一起修。

## 影響

- 使用者體驗不一致：刪除使用者、外部 IdP、外部身分失敗時對話框直接消失，只剩一個 toast；刪除群組、角色、服務帳號失敗時對話框留著可以重試。
- 每一處各寫一份 state、`<AlertDialog>` 的十幾個 props 與 `try/catch`，新頁面照抄時沒有規則可循，容易再多出第三種行為。

嚴重度低：兩種行為都不會造成錯誤的資料，只是體驗不一致與程式重複；但後三處與 §3.11 描述的 `useConfirm` 行為不同，修的時候一併對齊。

## 修正方式

不需要新的共用程式，改用既有的 `useConfirm()`（`@b2b-system/ui/ConfirmDialog`），分兩步：

1. **先對齊行為**：user、identity-provider、`UserIdentitySection` 三處改成失敗時留著對話框（與其他六處相同）。
   IdP 目前在 `catch` 裡呼叫 `showError`，改用 `useConfirm` 後錯誤交給 mutation 的 `onError`／全域處理（§3.11），要確認那個 mutation 有顯示錯誤。
2. **再換寫法**：沒有特殊互動的八處（webhook、group、service-account、tag、organization、user、identity-provider、`UserIdentitySection`）
   改成在 `onDelete` 裡呼叫 `confirm({ title, description, onConfirm: () => mutation.mutateAsync(...) })`，刪掉 `pendingDelete` state 與 `<AlertDialog>`；
   organization 刪除成功後的 `select(parentId)` 放在 `await confirm(...)` 回傳 `true` 之後。
   role 的「`ROLE_IN_USE` 後改成強制刪除」需要在同一個對話框裡改內容，`useConfirm` 做不到，保留 `<AlertDialog>`，在程式註解說明原因。
3. `docs/architecture/frontend/07-ui-system.md` §3.11 補一句：刪除確認一律用 `useConfirm`，只有確認中要改變對話框內容時才用宣告式的 `AlertDialog`。

## 驗證方式

- 三處（user、IdP、外部身分）補「刪除失敗時對話框仍在、可以再按一次」的頁面測試（MSW 回 409／500）。
- 換寫法的各頁既有測試通過；testid 用 `confirm({ 'data-testid': '<原本的 testid>' })` 保留，E2E 的刪除流程不必改。
- `grep -rln "pendingDelete" apps/backstage/src/features --include='*.tsx'` 只剩 role 與 file（file 的刪除是自己的 `FileDeleteDialog`，不在本問題範圍）。

（2026-10-10 backstage 各功能的優化分析發現。）
