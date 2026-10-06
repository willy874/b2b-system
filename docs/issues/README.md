# 已知問題（Known Issues）

這個資料夾放 **已經存在、但還沒修的問題**：程式與文件不一致、測試環境的脆弱點、遷移後留下的過渡程式碼。
一個問題一份文件。它和 [`../features/`](../features/README.md) 的差別：

| | `features/` | `issues/` |
| --- | --- | --- |
| 內容 | 還沒做的 **新功能** | 現有程式 **已經存在的問題** |
| 做完之後 | 提案刪除，改寫成正式文件歸檔 | 文件刪除；修正若改變了行為，同步更新對應的正式文件 |

> 和 `features/` 一樣，這裡的內容不是規格。正式文件（`architecture/`、`conventions/`）描述的是「應該怎樣」；
> 程式碼沒做到時，在這裡記一筆，而不是把正式文件改成配合錯誤的現況。

---

## 1. 清單

| 嚴重度 | 問題 | 文件 | 發現於 |
| --- | --- | --- | --- |
| 中 | 批次逐筆失效重抓且不處理 429，大批次可能用光限流額度 | [`batch-invalidation-and-rate-limit.md`](./batch-invalidation-and-rate-limit.md) | 2026-10-06（全面檢測：效能） |
| 中 | 批次進度計算為 O(n²)，大量上傳時每個快照都重算造成卡頓 | [`batch-progress-quadratic.md`](./batch-progress-quadratic.md) | 2026-10-06（全面檢測：效能） |
| 中 | api-sdk 無法 tree-shake，兩個前端首屏帶著全部 zod schema | [`api-sdk-not-tree-shakable.md`](./api-sdk-not-tree-shakable.md) | 2026-10-06（全面檢測：效能） |
| 中 | backstage 首屏帶進頁面專用程式，約多 50 KB gzip | [`backstage-entry-bundle-bloat.md`](./backstage-entry-bundle-bloat.md) | 2026-10-06（全面檢測：效能） |
| 中 | 放在 Field 裡的 Select 沒有連上欄位標籤與錯誤訊息 | [`select-not-linked-to-field-label.md`](./select-not-linked-to-field-label.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 登入頁等表單的送出錯誤沒有 role="alert"，報讀器不會念出 | [`form-errors-missing-alert-role.md`](./form-errors-missing-alert-role.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 帳號存的語系與時區沒被套用，偏好頁時區只有 4 個 | [`account-preferences-not-applied.md`](./account-preferences-not-applied.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 日期選擇器、TreeEditor、Spinner 的預設文案沒跟著語系 | [`ui-component-default-labels-not-localized.md`](./ui-component-default-labels-not-localized.md) | 2026-10-06（全面檢測：使用者體驗） |
| 中 | 警告色與成功色按鈕的白字對比不足，測試只要求 3:1 | [`button-color-contrast.md`](./button-color-contrast.md) | 2026-10-06（全面檢測：使用者體驗） |
| 低 | api 映像帶著 react-email 的 CLI 依賴 | [`docker-image-and-context-hygiene.md`](./docker-image-and-context-hygiene.md) | 2026-10-06（全面檢測：部署） |
| 低 | usePermission 每次回傳新物件，權限相關的 memo 全部失效 | [`use-permission-unstable-reference.md`](./use-permission-unstable-reference.md) | 2026-10-06（全面檢測：效能） |
| 低 | useTranslation 在任何語系包載入時都讓所有元件重繪 | [`use-translation-extra-rerenders.md`](./use-translation-extra-rerenders.md) | 2026-10-06（全面檢測：效能） |
| 低 | 英文介面：html lang 固定中文、沒有複數形、寫死全形標點 | [`i18n-english-polish.md`](./i18n-english-polish.md) | 2026-10-06（全面檢測：使用者體驗） |
| 低 | 資料夾授權到期日與公告的「今天」用瀏覽器時區 | [`dates-use-browser-timezone.md`](./dates-use-browser-timezone.md) | 2026-10-06（全面檢測：使用者體驗） |
| 低 | 頂列的即時連線狀態只靠顏色區分 | [`realtime-status-color-only.md`](./realtime-status-color-only.md) | 2026-10-06（全面檢測：使用者體驗） |
| 低 | 兩個前端仍有大量複製的程式，且已開始分岔 | [`duplicated-code-between-apps.md`](./duplicated-code-between-apps.md) | 2026-10-06（全面檢測：可讀性） |
| 低 | 前端架構文件與實作不符（分層強制、匯出約定、不存在的項目） | [`frontend-docs-drift.md`](./frontend-docs-drift.md) | 2026-10-06（全面檢測：可讀性） |
| 低 | 前端的死碼與過時的註解 | [`frontend-dead-code-and-stale-comments.md`](./frontend-dead-code-and-stale-comments.md) | 2026-10-06（全面檢測：可讀性） |
| 低 | 超過 400 行的元件與超過 200 行的 page.tsx | [`oversized-frontend-components.md`](./oversized-frontend-components.md) | 2026-10-06（全面檢測：可讀性） |

嚴重度：

| 嚴重度 | 意思 |
| --- | --- |
| 高 | 影響正確性或安全，要優先處理 |
| 中 | 行為與規格不一致，但目前不造成錯誤結果 |
| 低 | 開發體驗或程式整潔，可以穿插處理 |

---

## 2. 新增一筆

1. 新增 `<kebab-case>.md`，結構：**現況 → 影響 → 修正方式 → 驗證方式**。
   現況要寫到檔案與行號層級，讓處理的人不必重新調查。
2. 在上方 §1 的表格加一列（表格只剩「目前沒有已知問題」時取代它）。

## 3. 處理完之後

1. 刪除該問題的文件，以及 §1 表格的那一列。
2. 修正改變了行為或設定時，同步更新正式文件（例如 `architecture/`、`conventions/`）。
3. commit message 的內文提到問題的檔名，方便日後從 git 歷史找回脈絡。
