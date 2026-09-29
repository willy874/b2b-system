# 後端工作佇列與排程

- 優先度：P1
- 狀態：提案
- 依賴：—
- 相關：[`mailer.md`](./mailer.md)、[`webhooks.md`](./webhooks.md)、[`import-export.md`](./import-export.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

後端目前沒有背景工作的機制：

- 稽核封存（`pnpm db:archive-audit-logs`）與上傳殘留清理靠外部排程觸發，程式不知道它有沒有跑、跑成功沒
- 寄信、Webhook 投遞這類「要重試」的工作，沒有地方放
- 審批逾期作廢（[`rbac/06-approval.md`](../rbac/06-approval.md) §1 的「不做」）需要定時掃描
- 大量匯出不能在 HTTP 請求內做完

前端已有批次佇列（[ADR-0012](../adr/0012-batch-queue-worker.md)），但那是「使用者開著分頁時逐筆呼叫 API」，
不適合伺服器端自己發起的工作。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| `core/jobs`：註冊工作類型、入列、重試（指數退避）、失敗保留 | 工作流程編排（DAG、多步驟相依） |
| 排程（cron）工作，把現有的封存與清理搬進來 | 跨語言的 worker |
| 管理頁：看佇列狀態、失敗的工作、手動重試 | |
| 同一個工作不重複執行（多實例下也成立） | |

## 初步構想

- 候選：**pg-boss**（用 Postgres 當佇列，不必多一個 Redis）、BullMQ（需要 Redis）
- 入列在業務交易 **內**（與資料一致），和稽核寫入同一條規則；pg-boss 可以接受外部交易
- 模組各自註冊 handler（和審批的 handler 同一個模式），`core/jobs` 不 import `modules/`
- 權限：`job:read`、`job:retry`
- 稽核：手動重試寫稽核；工作本身的執行紀錄放在佇列表，不進稽核

## 開放問題

1. pg-boss 或 BullMQ？若 [`multi-instance.md`](./multi-instance.md) 會引入 Redis，要不要一起考慮？
2. worker 跑在 api 程序內，還是獨立程序（`apps/worker`）？
3. 封存腳本使用維運 role 的 `DATABASE_URL`，搬進佇列後權限怎麼處理？

## 歸檔去向

- `docs/adr/NNNN-background-jobs.md`
- `docs/architecture/backend/NN-jobs.md`；更新 `06-audit-log.md` §8 的搬移方式
