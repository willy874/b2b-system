# outbox 最舊的 100 列都是未註冊的工作時，`relayOutbox()` 永遠不會結束

## 現況

`apps/api/src/core/jobs/job-queue.ts` 的 `relayOutbox()`（L207–245）一批取 100 列，依 `created_at` 排序：

```ts
.orderBy(asc(jobOutbox.createdAt)).limit(OUTBOX_BATCH).for('update', { skipLocked: true });
// …
if (!registration) {
  // 工作已下線：留在 outbox 讓人處理，不能默默丟掉
  this.logger.error({ id: row.id, name: row.name }, 'outbox 裡的工作沒有註冊 handler');
  continue;
}
// …
return { size: rows.length, sent: sent.length };
// …
if (batch.size < OUTBOX_BATCH) return moved;
```

- 沒有註冊 handler 的列不送、不刪，但算進 `size`。留在 outbox 是刻意的（L223 的註解），問題在迴圈的結束條件。
  outbox 的機制見 [`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §4.1，那裡沒有提到未註冊的列怎麼處理。
- 最舊的 100 列都是這種時，每一輪都選到同一批：送出 0 筆、`size` 仍是 100，迴圈不會結束。每一輪再開一個交易、記 100 筆 error log。
- 呼叫的地方有兩個：
  1. `enqueue()` 的 `afterCommit`（L199）。`apps/api/src/core/database/transaction.ts` 的 `withTransaction()`（L52–67）在回傳前等它跑完（L62–65），那個請求永遠不會回應。
  2. `jobs.outboxSweep` 的 `sweepOutboxes()`（L308–314）。`Tenancy.forEachActive()`（`apps/api/src/core/tenant/tenancy.service.ts` L124–138）依序處理每個租戶：卡在這個租戶，後面的租戶都輪不到。
     工作 5 分鐘後逾時（L35–40），但 handler 沒有檢查 `signal`，JS 迴圈繼續跑；下一輪排程（10 分鐘後）又開一個新的迴圈。
- 現有測試 `apps/api/src/core/jobs/__tests__/job-queue.spec.ts` 的「沒有註冊 handler 的列留在 outbox：不送、不刪」（L681–687）只放 1 列，碰不到這個情況。

重現：

1. 某一版移除或改名了一種工作。
2. 上線時，某個租戶的 `job_outbox` 還有 100 列以上是舊名稱。平台 DB 或 pg-boss 暫時不可用、提交後的搬移失敗時，列就會累積。
3. 新版程序第一次搬移這個租戶的 outbox，進入無窮迴圈。

多個執行個體滾動部署時也會發生：舊版程序清掃到只有新版才註冊的工作。

## 影響

- 前提：同一個租戶的 outbox 有 100 列以上沒有註冊的工作。平常很少見，但一旦發生：
  - 熱迴圈每一輪 3 次往返，持續佔住一條租戶連線，log 被灌爆。
  - 這個租戶所有會入列的請求（建立使用者、上傳完成、改群組成員……）都卡住不回應。
  - 排在後面的已註冊工作永遠搬不出去：webhook、寄信、公告都停擺。
  - 清掃工作每 10 分鐘多一個不會結束的迴圈；排在這個租戶之後的租戶也不會被清掃。

## 修正方式

1. 建議：查詢只選已註冊的名稱，例如 `WHERE name = ANY($registeredNames)`。未註冊的列留在原處，不擋住其他列。
2. 每輪清掃另外數一次未註冊的列，有的話記一筆 warn（名稱、筆數），取代逐列的 error log。
3. 保險：一輪送出 0 筆（`sent === 0`）就結束迴圈。
4. `sweepOutboxes()` 檢查工作的 `signal`，逾時就停下來。

## 驗證方式

- `job-queue.spec.ts` 的「JobQueue.relayOutbox」補案例：
  - 第一批是 100 列沒有註冊的工作，而且同一批連續出現好幾次（`outboxDb()`（L245–257）會依序吐出每一批，用來模擬資料庫每次都選到它們）。
    斷言 `relayOutbox()` 會結束、交易次數有上限。
  - 100 列沒有註冊的、後面 1 列有註冊的：那 1 列照常送出。
- `apps/api/test/jobs.spec.ts` 補整合測試：在真的 `job_outbox` 寫 100 列不存在的工作名稱與 1 列已註冊的。
  `relayOutbox()` 回傳 1，佇列裡有那一筆工作。
