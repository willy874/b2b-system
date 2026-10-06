# 每筆租戶背景工作開始前，都全表掃描 `pgboss.job` 來判斷同時執行數

## 現況

`apps/api/src/core/jobs/job-queue.ts` 的 `execute()`（L326–351）在每一筆租戶工作執行前呼叫 `deferIfTenantBusy()`（L358–372，呼叫點 L334）。
它查 `apps/api/src/core/jobs/job-store.ts` 的 `activeAhead()`（L147–157）：

```sql
WITH me AS (
  SELECT started_on, id FROM pgboss.job WHERE id = $jobId AND state = 'active'
)
SELECT count(*)::int AS ahead FROM pgboss.job j, me
WHERE j.state = 'active' AND j.data->>'tenantId' = $tenantId
  AND (j.started_on, j.id) < (me.started_on, me.id)
```

- pg-boss 12.35.1 的工作表（`node_modules/.pnpm/pg-boss@12.35.1/node_modules/pg-boss/dist/plans.js`）：
  - 主鍵是 `(name, id)`（L872）。`me` 只用 `id` 查，PG17 用不上這個主鍵的前綴，只能把整個索引掃一遍。
  - job_i1～i12（L883–960）都是依 policy 或 state 的部分索引，沒有一個能服務 `state = 'active' AND data->>'tenantId' = …`。主查詢只能循序掃描。
- 佇列都是 `partition: false`（`plans.js` L81–90），所有佇列的工作都在同一張 `job_common`。
- `ensureQueue()`（`job-queue.ts` L374–394）沒設 `deleteAfterSeconds`，沿用預設 7 天（`plans.js` L84）。這張表放著 **所有租戶** 7 天內完成的工作。
- `JobStore` 用平台 DB 的連線池（`job-store.ts` L81 的 `PLATFORM_DB`，production 10 條）。
  OIDC 的 payload、租戶目錄、廣播的 `NOTIFY`、`/health/ready` 都用同一個池。
- 工作管理頁的 `counts()`（L107–127）、`list()`（L83–101）同樣只能全表掃描。
  backstage 的頁面每 10 秒重抓一次（`apps/backstage/src/features/job/pages/JobList/page.tsx` L16、L31、L42）。

量測（自起的 PG17 容器，Docker Desktop、8 核；`pgboss.job` 20 萬列、`job_common` 119 MB，3 個佇列、20 個租戶、12 筆 active）：

| 查詢 | 結果 |
| --- | --- |
| `activeAhead()` 的 `EXPLAIN ANALYZE` | 568 ms。Parallel Seq Scan on job_common，加上 job_common_pkey 的整個索引掃描，每個 active 列重掃一次（loops=4） |
| `activeAhead()`，熱快取平均 | 30 ms（約 90 core-ms） |
| `me` 改成 `name = … AND id = …` | 0.3 ms |
| `counts()` 的 `EXPLAIN ANALYZE` | 367 ms，Parallel Seq Scan |

## 影響

- 每一筆租戶工作都多一次全表掃描。成本隨「全平台 7 天內的工作量」線性成長，與這筆工作屬於哪個租戶無關。
- 工作量的主要來源：
  - `webhook.deliver`：每個事件 × 每個網址一筆，最多重試 8 次。
  - `announcement.eventDispatch`、`announcement.fanOut`：事件點每人各一筆。
  - 寄信，以及每個租戶每小時一次的 `file.maintenance`。
- 大量情境：一次 5,000 筆 webhook 投遞就是 5,000 次掃描。20 萬列時約 450 core-s 的平台 DB CPU。
- `webhook.deliver` 並行 10（`apps/api/src/modules/webhook/webhook.jobs.ts` L15–22），掃描期間每筆各佔一條平台連線，能把平台池佔滿。
  SSO 登入、租戶目錄未命中、快取失效的廣播都排在後面，所有租戶一起受影響。
- 工作管理頁開著的時候，每 10 秒再多兩次全表掃描。

## 修正方式

1. `me` 加上工作名稱：`WHERE name = $name AND id = $id AND state = 'active'`，走主鍵。
2. 計數改走索引（擇一，建議 a）：
   - a. 送出時帶 `group: { id: tenantId }`（pg-boss 12 的 `JobOptions.group`，`dist/types.d.ts` L480–500）。
     計數改成 `WHERE name = ANY($registered) AND group_id = $tenantId AND state = 'active'`，
     用上內建的 `job_i7 (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL`（`plans.js` L946）。
     `send()`（`job-queue.ts` L279–297）是唯一的送出點，outbox 搬移與排程展開都經過它。
   - b. 在 `pgboss.job` 另建 `((data->>'tenantId'), started_on, id) WHERE state = 'active'` 的部分索引。要注意 pg-boss 升級時表結構可能變動。
3. 高流量佇列的 `deleteAfterSeconds` 調短（例：1 天），讓表維持在小的範圍：
   `webhook.deliver`、`announcement.eventDispatch`、`announcement.fanOut`。在 `defineJob` 加這個選項，由 `ensureQueue()` 帶過去。
4. 工作管理頁的計數改用第 2 點的欄位加條件，或 pg-boss 自己的佇列統計。
5. 改完後在 [`05-tenancy.md`](../architecture/05-tenancy.md) §13.3 D9 與 [`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §3 補上計數的方式與保留天數。

## 驗證方式

- `apps/api/src/core/jobs/__tests__/job-store.spec.ts` 的「JobStore.activeAhead」：斷言 SQL 帶上 `name` 與 `group_id` 的條件。
- `apps/api/test/jobs.spec.ts` 的「租戶同時執行的上限 job.maxConcurrency」（L369）照常通過。
- 在測試 DB 的 `pgboss.job` 灌 20 萬到 100 萬列：`EXPLAIN` 只有 Index Scan，`activeAhead()` 小於 1 ms。
- 壓測 5,000 筆投遞，量平台連線池的等待時間。
