# 匯入／匯出框架

- 優先度：P2
- 狀態：提案
- 依賴：站內通知（已完成，[`backend/15-notification.md`](../architecture/backend/15-notification.md)；完成通知）、背景工作（已完成，[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)）
- 相關：[`overview/03-roadmap.md`](../overview/03-roadmap.md)「Phase 1 之後」第 4 項、[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13（前端批次佇列）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

大量建立使用者、把稽核日誌交給外部稽核、之後業務資料的搬移，都需要匯入匯出。現在：

- **沒有任何匯出**：稽核日誌只有 `GET /audit-logs`、`GET /audit-logs/:id`，整個 api 沒有產生 CSV 的地方。
- **前端批次佇列不適合大量**（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13）：它逐筆呼叫單筆 API、全域一次一筆、需要至少一個分頁開著。
  幾百筆沒問題，幾萬筆的匯出、需要整批驗證的匯入就不行。後端的批次端點已隨 [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13.6 被取代而移除。
- 零件都有：背景工作（pg-boss，交易內入列走 `job_outbox`）、每個租戶一個 bucket、有時效的下載連結（`presignDownload`，`FILE_URL_TTL` ≤ 1 小時）、
  模組把 handler 註冊進通用模組的模式（審批 handler、`JobQueue.register`、`SettingService.register`）。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 模組註冊匯出器／匯入器（和審批 handler 同一個模式） | Excel 格式（先 CSV、JSON） |
| 匯出：背景工作產生檔案放租戶 bucket，完成後通知並提供有時效的下載 | 排程定期匯出 |
| 匯入：上傳 → 背景驗證並產生預覽（逐列錯誤）→ 確認後背景執行 → 結果報告 | 跨租戶搬移（平台層級） |
| 匯出、匯入工作的列表頁（我的匯出／匯入） | |
| 第一批：使用者匯入（CSV）、稽核日誌匯出（CSV） | |

## 初步構想

### 後端

- `modules/data-transfer/`（名稱待定）：`transfers` 表（租戶 DB）記錄類型、狀態、建立者、檔案 key、筆數、錯誤摘要、到期時間。
- 註冊：擁有者模組實作 `Exporter`／`Importer` 並在 `onModuleInit` 呼叫 `transfers.register(this)`；
  `modules/data-transfer` 不 import 其他模組（[`conventions/07-layer-dependencies.md`](../conventions/07-layer-dependencies.md) §3.2）。
  - `Exporter`：`type`、`requiredPermissions`、`query(filter, actor)`（**以操作者的權限過濾**，逐頁回傳 async iterator）、`columns`
  - `Importer`：`type`、`requiredPermissions`、`schema`（Zod，逐列驗證）、`validate(rows)`（跨列與資料庫的檢查，例如 email 重複）、`apply(row, actor, tx)`
- 工作：`transfer.export`、`transfer.validateImport`、`transfer.applyImport`（`scope: 'tenant'`）。
  - 匯出以串流寫進物件儲存（`putObject` 的串流或 multipart），不整份放記憶體。
  - 匯入逐列（或小批次）走 **和 API 相同的 service**，每列一個交易、各自寫稽核，不繞過業務規則。
  - 工作資料與 `output` 只放 transfer id 與計數，不放個資（`job:read` 的人看得到，[`backend/11-mail.md`](../architecture/backend/11-mail.md) 的前例）。
- 檔案放租戶 bucket 的 `transfers/` 前綴；過期的檔案由排程清理（沿用 `file.maintenance` 的做法或另開工作）。
- 完成、失敗時通知建立者（`NotificationService.notify()`，[`backend/15-notification.md`](../architecture/backend/15-notification.md) §9）。

### 前端（backstage）

- 列表頁的「匯出」「匯入」按鈕由各 feature 提供；共用的上傳、預覽（逐列錯誤表）、進度 UI 放 `core/` 或 `components/`
  （feature 之間不能直接共用元件，[`conventions/07-layer-dependencies.md`](../conventions/07-layer-dependencies.md) §2.2）。
- 進度：transfer 的狀態變更經 realtime 推播（新增 `ChangeSource`），不輪詢。

### 權限與稽核

- 匯出、匯入的權限跟著資料走（匯出使用者＝`user:read`，匯入使用者＝`user:create`），另外要不要加獨立的 `export` 權限見開放問題 3。
- 稽核：`transfer.export`（篩選條件、筆數）、`transfer.import`（筆數、成功、失敗）；匯入的每一列另有各自的業務稽核。

## 開放問題

1. 小量匯入（例如 50 筆以內）要不要直接走前端批次佇列，只有大量才走後端？兩套 UI 會讓使用者困惑。
2. 匯出檔案保留多久？下載連結最長 1 小時，過期要重新取得連結，檔案本身要保留幾天？
3. 匯出要不要獨立權限（例如 `auditLog:export`）？能看列表不代表可以整批帶走。
4. 匯入的使用者要寄啟用信嗎？大量寄信要限速（寄信工作並行 5）。

## 歸檔去向

- `docs/architecture/backend/NN-import-export.md`（含設計決策）
- 前端的上傳與預覽元件：`docs/architecture/frontend/` 對應章節
