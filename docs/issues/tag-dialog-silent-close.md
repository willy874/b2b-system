# 標籤對話框重新載入時標籤已刪除就無聲關閉；標籤組的 feature 判斷寫死

## 現況

`apps/backstage/src/features/tag/pages/TagList/page.tsx`：

- 第 58–63 行 `reloadEditing`：版本衝突後重抓列表，`setEditing(latest.items.find(...))`。標籤已被別人刪除時 `find` 回傳 `undefined`，對話框（第 133 行 `open={editing !== undefined}`）直接關掉，沒有任何提示；註解寫「已被刪除就關掉對話框」，但使用者不知道為什麼。
- 第 38–45 行：`TAG_SCOPE_FEATURE`（`constants.ts` 第 21–24 行）有用到，但每個 feature 各自 `useIsFeatureReady` 再以 `if (feature === TenantFeature.file)`、`if (feature === TenantFeature.gallery)` 對應，其餘一律 `return true`。之後 `TAG_SCOPE_FEATURE` 多登記一個標籤組時，這裡沒跟著加 `if` 就會在 feature 沒啟用時照樣顯示。`core/feature/useFeatureReadiness.ts` 已有給「選項各自屬於不同 feature」用的 `useFeatureReadiness()`。

## 影響

- 編輯中的標籤被別人刪掉時，對話框無預警消失，使用者以為按錯了。
- 新增標籤組時容易漏改，違反「未開放的 feature 一律隱藏」（`docs/architecture/05-tenancy.md` §15）。

嚴重度低：前者是回饋問題，後者目前兩個標籤組都正確。

## 修正方式

- `reloadEditing` 找不到時先 `toast` 一則「標籤已被刪除」再關閉（兩個語系檔加字串），或沿用 web-core 共用的「已被刪除」訊息（若有）。
- 標籤組改成：

  ```ts
  const isReady = useFeatureReadiness();
  const scopes = TAG_SCOPES.filter((scope) => isReady(TAG_SCOPE_FEATURE[scope] ?? null));
  ```

## 驗證方式

- `TagListPage` 測試補：更新回 409、重新載入時列表已沒有該標籤 → 對話框關閉並出現提示。
- 既有的「feature 沒啟用時不出現檔案／圖片庫分頁」測試照常通過。

（2026-10-10 backstage 各功能的優化分析發現。）
