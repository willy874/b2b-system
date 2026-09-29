# 後端工作佇列與排程

- 優先度：P1
- 狀態：規劃中
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

- 採用 **pg-boss**（用 Postgres 當佇列，不必多一個 Redis）；BullMQ（需要 Redis）不採用，見開放問題 1。
  選型與 worker 位置、封存權限的決定見 [ADR-0016](../adr/0016-background-jobs.md)
- 入列在業務交易 **內**（與資料一致），和稽核寫入同一條規則；pg-boss 可以接受外部交易
- 模組各自註冊 handler（和審批的 handler 同一個模式），`core/jobs` 不 import `modules/`
- 權限：`job:read`、`job:retry`
- 稽核：手動重試寫稽核；工作本身的執行紀錄放在佇列表，不進稽核

## 開放問題

1. pg-boss 或 BullMQ？若 [`multi-instance.md`](./multi-instance.md) 會引入 Redis，要不要一起考慮？

   **結論**：pg-boss。不必多一個 Redis；更關鍵的是能在業務交易 **內** 入列，
   與「稽核寫入在交易內」同一條規則，不會出現「資料建好了、工作沒排進去」。
   注意：pg-boss 內部用 `pg`，本專案的 Drizzle 用 `postgres.js`，要寫一個小 adapter 餵給 pg-boss 的 `db` 選項，
   才能讓入列加入現有交易；這點寫進 ADR。等 `multi-instance` 真的引入 Redis 再重新評估 BullMQ。
2. worker 跑在 api 程序內，還是獨立程序（`apps/worker`）？

   **結論**：先跑在 api 程序內，以 env `JOBS_WORKER_ENABLED`（預設 `true`）開關。
   目前是單一實例、compose 部署，`FileMaintenanceService` 也已經在 api 內跑（`backend/09-file.md` §9）；
   工作 handler 需要 DI 裡的 `ObjectStorage`、`MailTransport` 等服務，放在同一個程序最省事。
   將來要分開時，不另開 `apps/worker`：同一個映像多起一個容器，關掉 HTTP、只開 worker
   （api 容器設 `JOBS_WORKER_ENABLED=false`）。pg-boss 以 `SKIP LOCKED` 取工作、排程有分散式鎖，
   多個 worker 同時跑不會重複執行。

3. 封存腳本使用維運 role 的 `DATABASE_URL`，搬進佇列後權限怎麼處理？

   **結論**：`archive_audit_logs()` 改成 `SECURITY DEFINER`，由擁有資料表的 role（跑 migration 的 role）擁有，
   只把 `EXECUTE` 授給應用程式 role。
   應用程式 role 仍然沒有 `audit_logs` 的 `DELETE` 權限（`backend/06-audit-log.md` §6 第 2 道防線不變），
   只能透過這個函式做「熱 → 冷搬移」；而熱表的刪除 trigger 本來就要求冷表有完全相同的副本，函式也做不了別的事。
   函式要加 `SET search_path = public, pg_temp`，避免被同名物件劫持。
   `pnpm db:archive-audit-logs` 保留，作為手動補跑的入口（改成呼叫同一個函式，任一 role 都能跑）。
   冷表保留期滿的清理不在這次範圍，仍由維運 role 處理。

## 歸檔去向

- `docs/adr/NNNN-background-jobs.md`
- `docs/architecture/backend/NN-jobs.md`；更新 `06-audit-log.md` §8 的搬移方式
