# ADR-0016 — 後端工作佇列：pg-boss，worker 先跑在 api 程序內

- 狀態：**採用**
- 日期：2026-09-29
- 相關：[`../architecture/backend/10-jobs.md`](../architecture/backend/10-jobs.md)、[`../features/mailer.md`](../features/mailer.md)、
  [`../architecture/backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §6、§8、
  [`../architecture/backend/09-file.md`](../architecture/backend/09-file.md) §9、[ADR-0012](./0012-batch-queue-worker.md)

## 背景

後端沒有背景工作的機制：

- 稽核封存（`pnpm db:archive-audit-logs`）靠外部排程觸發，程式不知道它有沒有跑、跑成功沒
- 上傳殘留清理（`FileMaintenanceService`）是 api 內的 `setInterval`，失敗沒有紀錄可查
- 寄信（[`mailer.md`](../features/mailer.md)）、Webhook 投遞要重試，沒有地方放
- 大量匯出不能在 HTTP 請求內做完

ADR-0012 的前端批次佇列需要使用者開著分頁，不適合伺服器自己發起的工作。

## 決定

評估過的方案：

| 方案 | 結論 |
| --- | --- |
| **A. pg-boss**（Postgres 當佇列） | **採用** |
| B. BullMQ（Redis） | 不採用：多一個 Redis 要部署、備份、監控；入列無法與 Postgres 的業務交易一致 |
| C. 自製 outbox 表 ＋ 輪詢 | 不採用：重試、退避、排程、分散式鎖都要自己寫，pg-boss 已經做好 |
| D. 繼續用外部 cron | 不採用：只解決排程，不解決重試；執行結果仍然看不到 |

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | 佇列用 **pg-boss** | 不增加元件；工作與業務資料在同一個資料庫，備份與還原一致 |
| D2 | 入列在業務交易 **內** | 與「稽核寫入在交易內」同一條規則：資料提交了，工作一定在；交易回滾，工作也不存在 |
| D3 | 用 pg-boss 內建的 `fromDrizzle` adapter 把 Drizzle（`postgres.js`）的交易交給 pg-boss 的 `db` 選項 | pg-boss 內部用 `pg`；不經 adapter 的話入列會走另一條連線，D2 不成立。提案時打算自己寫，實作時發現 pg-boss 12 已內建 |
| D4 | worker 先跑在 api 程序內，以 `JOBS_WORKER_ENABLED`（預設 `true`）開關 | 單一實例、compose 部署；handler 需要 DI 裡的服務（`ObjectStorage`、`MailTransport`），同一個程序最省事 |
| D5 | 要分開時用 **同一個映像** 多起一個容器，不另開 `apps/worker` | 程式碼只有一份；api 容器設 `JOBS_WORKER_ENABLED=false` 就只處理 HTTP |
| D6 | 模組各自註冊 handler，`core/jobs` 不 import `modules/` | 與審批 handler 同一個模式；守住 `core/` 不依賴 `modules/` |
| D7 | 排程（cron）也交給 pg-boss，稽核封存與上傳殘留清理搬進來 | pg-boss 的排程有分散式鎖，多實例下同一個排程只跑一次 |
| D8 | `archive_audit_logs()` 改成 `SECURITY DEFINER`（擁有者是擁有資料表的 role）；加 `SET search_path = public, pg_temp` | 應用程式 role 不需要 `audit_logs` 的 `DELETE`（06-audit-log §6 第 2 道防線不變），只能透過函式做熱 → 冷搬移；熱表的刪除 trigger 本來就要求冷表有相同副本 |
| D9 | `pnpm db:archive-audit-logs` 保留作為手動補跑入口 | 排程出問題時仍能手動處理；呼叫同一個函式，行為一致 |
| D10 | 權限 `job:read`、`job:retry`；手動重試寫稽核，工作本身的執行紀錄留在佇列表 | 執行紀錄量大且會清除，不適合放進不可變的稽核 |

## 實作時的調整

| 項目 | 提案 | 實作 | 原因 |
| --- | --- | --- | --- |
| D3 的 adapter | 自己寫 | pg-boss 內建的 `fromDrizzle` | 已有現成、維護在上游 |
| D8 的 `EXECUTE` | 只授給應用程式 role | 維持預設的 `PUBLIC` | role 名稱依部署而定，migration 無法指名；拆分 role 的部署自行 `REVOKE` 後再 `GRANT`。呼叫端只能決定 cutoff 與批次大小，搬過去的紀錄仍查得到 |
| 管理頁的計數 | pg-boss 的 `getQueues()` | 直接數 `pgboss.job` | `getQueues()` 是監控迴圈寫入的快照，最多落後一分鐘；重試完看不到數字變 |
| 檔案維護的間隔 | `FILE_MAINTENANCE_INTERVAL`（秒） | `FILE_MAINTENANCE_CRON` | pg-boss 的排程是 cron；舊變數移除 |

## 取捨

| 代價 | 評估 |
| --- | --- |
| 佇列的讀寫壓力落在同一個 Postgres | 目前工作量（每天數百封信、每天一次封存）遠低於 pg-boss 的承載；量大時再評估 |
| handler 與 HTTP 共用 CPU（例：影像處理） | 會拖慢 API 時照 D5 拆成獨立容器，不必改程式 |
| `SECURITY DEFINER` 函式寫錯會變成提權的入口 | 函式只接受時間與批次大小、不組動態 SQL，並固定 `search_path`；整合測試證明沒有 DELETE 的 role 只能透過它搬移 |
| 管理頁直接讀 pg-boss 的表結構 | 只在 `core/jobs/job-store.ts` 一處；升級 pg-boss 時對照它的 migration |
| 引入 [`multi-instance.md`](../features/multi-instance.md) 的 Redis 後，可能想改用 BullMQ | 那時再開新 ADR；handler 介面在 `core/jobs`，換底層不影響模組 |
