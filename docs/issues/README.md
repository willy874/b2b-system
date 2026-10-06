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
| 高 | 夏令時間開始當天，落在不存在時段的公告發送時間會提早一小時（前後端同一套算法） | [`announcement-dst-gap.md`](./announcement-dst-gap.md) | 2026-10-06（補公告的單元測試） |
| 中 | 稽核明細查無資料時回 400 `VALIDATION_FAILED`，其他資源都是 404 | [`audit-log-detail-not-found-status.md`](./audit-log-detail-not-found-status.md) | 2026-10-06（補稽核的單元測試） |
| 低 | 改密碼後的登出原因可能被 `session.revoked` 推播搶先，登入頁顯示通用訊息而不是「密碼已變更」 | [`password-change-signout-reason-race.md`](./password-change-signout-reason-race.md) | 2026-10-06（補 E2E） |
| 低 | 公告每日維護的 `requeued` 計數包含沒有入列的公告 | [`announcement-maintain-requeued-count.md`](./announcement-maintain-requeued-count.md) | 2026-10-06（補公告的單元測試） |
| 低 | 建立 API token 時，推播早於讀回剛建立的列 | [`api-token-create-publish-before-read.md`](./api-token-create-publish-before-read.md) | 2026-10-06（補 API token 的單元測試） |
| 低 | 資料夾的繼承設定沒有改變時仍推播一次更新 | [`file-folder-inheritance-noop-publish.md`](./file-folder-inheritance-noop-publish.md) | 2026-10-06（補檔案的單元測試） |
| 低 | Webhook 訂閱的 `url`、`consecutive_failures` 已由 `webhook_targets` 取代，下一次部署刪除 | [`webhook-legacy-columns.md`](./webhook-legacy-columns.md) | 2026-10-02（[`architecture/05-tenancy.md`](../architecture/05-tenancy.md) §13） |

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
2. 在上方 §1 的表格加一列。

## 3. 處理完之後

1. 刪除該問題的文件，以及 §1 表格的那一列。
2. 修正改變了行為或設定時，同步更新正式文件（例如 `architecture/`、`conventions/`）。
3. commit message 的內文提到問題的檔名，方便日後從 git 歷史找回脈絡。
