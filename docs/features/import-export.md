# 匯入／匯出框架

- 優先度：P2
- 狀態：提案
- 依賴：背景工作（已完成，[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)）
- 相關：[`overview/03-roadmap.md`](../overview/03-roadmap.md)「Phase 1 之後」第 4 項、[ADR-0012](../adr/0012-batch-queue-worker.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

大量建立使用者、匯出稽核日誌給外部稽核、搬移遊戲資料，都需要匯入匯出。
前端的批次佇列適合「幾百筆逐筆呼叫」，但大量資料的匯出需要在伺服器端產生檔案。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 模組註冊匯出器／匯入器（和審批 handler 同一個模式） | Excel 格式（先 CSV、JSON） |
| 匯出：背景工作產生檔案，完成後通知並提供下載 | 排程定期匯出 |
| 匯入：上傳 → 驗證預覽（逐列錯誤）→ 確認後執行 | |
| 第一批：使用者匯入、稽核日誌匯出 | |

## 初步構想

- 產出的檔案放物件儲存（`core/storage`），下載連結有時效
- 匯出受權限過濾：只匯出操作者看得到的資料
- 匯入逐列走和 API 相同的 service（不繞過業務規則與稽核）
- 完成通知依賴 [`notification-center.md`](./notification-center.md)

## 開放問題

1. 小量匯入要不要直接沿用前端批次佇列，只有大量才走後端？
2. 匯出檔案保留多久？

## 歸檔去向

- `docs/adr/NNNN-import-export.md`、`docs/architecture/backend/NN-import-export.md`
