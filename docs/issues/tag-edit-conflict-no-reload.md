# 編輯標籤遇到版本衝突時沒有「重新載入」，再按儲存一直回 409

## 現況

- `apps/backstage/src/features/tag/pages/TagList/page.tsx`
  - `editing`（L55）是按「編輯」當下那一列的快照。
  - 送出時帶 `version: editing.version`（L169）。
- 衝突時，`useTagUpdateMutation()`（`apps/backstage/src/features/tag/hooks/useTagMutations.ts` L34–38）只讓標籤列表重抓，`editing` 不會跟著更新。
- `apps/backstage/src/features/tag/pages/TagList/components/TagFormDialog.tsx` 的 `submit()`（L47–58）只把錯誤字串顯示在對話框裡：
  「這個標籤已經被其他人修改，請重新載入後再編輯。」對話框沒有重新載入的按鈕。
- 其他可編輯的實體（使用者、角色、群組、服務帳號、Webhook、公告）衝突時都用 `VersionConflictAlert` 提供「重新載入」，
  例：`apps/backstage/src/features/user/pages/UserDetail/components/UserBasicSection.tsx` 的 `reload()`（L70–81）。

規格：[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11 最後一段：衝突時表單以 `VersionConflictAlert` 說明，並提供「重新載入」。

重現：

1. A 打開某個標籤的編輯對話框。
2. B 改了同一個標籤的顏色。
3. A 按儲存，回 409，看到「請重新載入後再編輯」。
4. A 再按一次儲存，還是 409。只能關掉對話框重開，剛輸入的名稱也沒了。

## 影響

- 同時編輯同一個標籤的管理者。照著提示做也解不開，只能關掉再重開。
- 不會寫入錯誤的資料（後端擋下了），屬於流程卡住、行為與規格不符。

## 修正方式

1. `TagFormDialog` 在 `isVersionConflict(error)` 時顯示 `VersionConflictAlert`（`apps/backstage/src/core/components`），不要只顯示字串。
2. 「重新載入」：從列表快取取出最新的那一筆（或重抓列表），更新 `editing`（含 `version`），並以它重設表單。做法比照 `UserBasicSection` 的 `reload()`。

## 驗證方式

`apps/backstage/src/features/tag/pages/TagList/__tests__/TagListPage.test.tsx` 補：

- 第一次 PATCH 回 `TAG_VERSION_CONFLICT`：對話框出現 `version-conflict-alert`。
- 按 `version-conflict-reload` 之後再儲存：送出的是新的 `version`，儲存成功。
