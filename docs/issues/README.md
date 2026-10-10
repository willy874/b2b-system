# 已知問題（Known Issues）

這個資料夾放 **已經存在、但還沒修的問題**：程式與文件不一致、測試環境的脆弱點、遷移後留下的過渡程式碼。
一個問題一份文件。它和 [`../features/`](../features/README.md) 的差別：

| | `features/` | `issues/` |
| --- | --- | --- |
| 內容 | 還沒做的 **新功能** | 現有程式 **已經存在的問題** |
| 做完之後 | 提案刪除，改寫成正式文件歸檔 | 文件刪除；修正若改變了行為，同步更新對應的正式文件 |

> 和 `features/` 一樣，這裡的內容不是規格。正式文件（`architecture/`、`coding-standards/`）描述的是「應該怎樣」；
> 程式碼沒做到時，在這裡記一筆，而不是把正式文件改成配合錯誤的現況。

---

## 1. 清單

| 嚴重度 | 問題 | 文件 | 發現於 |
| --- | --- | --- | --- |
| 中 | 稽核日誌的「資源」篩選只寫死 11 種，後端實際寫入的類型多出十幾種 | [audit-log-resource-filter.md](./audit-log-resource-filter.md) | 2026-10-10 backstage 優化分析 |
| 中 | 審批與圖片的留言、提及、關注通知把資源類型顯示成「項目」 | [comment-notification-resource-label.md](./comment-notification-resource-label.md) | 2026-10-10 backstage 優化分析 |
| 中 | MFA 政策頁：「不符合政策的人數」逐人查詢，「查看使用者」的範圍與人數不一致 | [mfa-policy-count-n-plus-1.md](./mfa-policy-count-n-plus-1.md) | 2026-10-10 backstage 優化分析 |
| 低 | 個人資料的「儲存」沒有修改也能送出 | [account-profile-save-not-dirty.md](./account-profile-save-not-dirty.md) | 2026-10-10 backstage 優化分析 |
| 低 | 通知總覽：決策 D1 的 `sourceId` 篩選沒有實作，詳細規格也沒寫 | [announcement-source-filter.md](./announcement-source-filter.md) | 2026-10-10 backstage 優化分析 |
| 低 | 審批流程的「儲存影響」確認排在前端驗證之前 | [approval-flow-validate-before-impact.md](./approval-flow-validate-before-impact.md) | 2026-10-10 backstage 優化分析 |
| 低 | 輸入中的留言離開頁面時沒有提醒，直接遺失 | [comment-draft-not-guarded.md](./comment-draft-not-guarded.md) | 2026-10-10 backstage 優化分析 |
| 低 | 「我的匯入匯出」不理會通知帶來的 `?transfer=<id>` | [data-transfer-highlight-param.md](./data-transfer-highlight-param.md) | 2026-10-10 backstage 優化分析 |
| 低 | 刪除確認有兩種寫法，失敗後對話框關不關不一致 | [delete-confirm-inconsistent.md](./delete-confirm-inconsistent.md) | 2026-10-10 backstage 優化分析 |
| 低 | 詳情頁的「載入中／查詢失敗／已刪除」骨架逐頁複製 | [detail-dialog-duplicated.md](./detail-dialog-duplicated.md) | 2026-10-10 backstage 優化分析 |
| 低 | 前端規格與實作的落差：路由樹、審批詳情、留言面板 | [frontend-docs-drift-routes-panels.md](./frontend-docs-drift-routes-panels.md) | 2026-10-10 backstage 優化分析 |
| 低 | 刪除外部 IdP 連線失敗時對話框仍被關掉 | [identity-provider-delete-error-closes.md](./identity-provider-delete-error-closes.md) | 2026-10-10 backstage 優化分析 |
| 低 | 列表頁「網址查詢條件」的 hook 逐頁複製 | [list-search-hooks-duplicated.md](./list-search-hooks-duplicated.md) | 2026-10-10 backstage 優化分析 |
| 低 | 前端幾處多餘的請求與重算 | [minor-frontend-perf.md](./minor-frontend-perf.md) | 2026-10-10 backstage 優化分析 |
| 低 | 列表頁的頁首、匯出／匯入按鈕、展開列與審批表格欄位各自複製 | [misc-duplicated-ui.md](./misc-duplicated-ui.md) | 2026-10-10 backstage 優化分析 |
| 低 | backstage 有頁面與 hook 沒有測試，E2E 只跑 Chromium | [missing-frontend-tests.md](./missing-frontend-tests.md) | 2026-10-10 backstage 優化分析 |
| 低 | 組織圖裡部門詳情的上層路徑會跳回清單 | [org-chart-path-link-view.md](./org-chart-path-link-view.md) | 2026-10-10 backstage 優化分析 |
| 低 | 換頁不回到頂端、返回列表時捲動位置不見 | [scroll-restoration.md](./scroll-restoration.md) | 2026-10-10 backstage 優化分析 |
| 低 | SSO 回呼頁的「重新登入」失敗時沒有任何反應 | [sso-callback-relogin-error.md](./sso-callback-relogin-error.md) | 2026-10-10 backstage 優化分析 |
| 低 | 標籤對話框重新載入時標籤已刪除就無聲關閉；標籤組的 feature 判斷寫死 | [tag-dialog-silent-close.md](./tag-dialog-silent-close.md) | 2026-10-10 backstage 優化分析 |
| 低 | 語系檔留著沒有被引用的 key，也沒有測試擋 | [unused-locale-keys.md](./unused-locale-keys.md) | 2026-10-10 backstage 優化分析 |
| 低 | 檔案管理與圖片庫的上傳、下載各寫一套 | [upload-and-download-duplicated.md](./upload-and-download-duplicated.md) | 2026-10-10 backstage 優化分析 |
| 低 | 使用者列表的「重設密碼」對未啟用的帳號實際寄的是啟用信 | [user-pending-reset-label.md](./user-pending-reset-label.md) | 2026-10-10 backstage 優化分析 |
| 低 | 使用者搜尋下拉與輸入去抖動各自實作 | [user-search-select-duplicated.md](./user-search-select-duplicated.md) | 2026-10-10 backstage 優化分析 |
| 低 | Webhook 設定以 events.join(',') 判斷修改，勾選順序不同會誤判 | [webhook-events-dirty-order.md](./webhook-events-dirty-order.md) | 2026-10-10 backstage 優化分析 |

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
2. 修正改變了行為或設定時，同步更新正式文件（例如 `architecture/`、`coding-standards/`）。
3. commit message 的內文提到問題的檔名，方便日後從 git 歷史找回脈絡。
