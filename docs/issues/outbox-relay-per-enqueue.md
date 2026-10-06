# 同一個交易入列 N 筆工作，提交後就跑 N 次 outbox 搬移

## 現況

`apps/api/src/core/jobs/job-queue.ts` 的 `enqueue()`（L178–201）每次帶 `tx` 入列，都寫一列 outbox，並登記一次提交後的搬移：

```ts
afterCommit(options.tx, () => this.relayOutboxSafely());   // L199
```

- `apps/api/src/core/database/transaction.ts` 的 `withTransaction()`（L52–67）在回傳前依序執行每一個 hook（L62–65）。
- 第一個 hook 就把整個租戶的 outbox 搬完。其餘 N−1 個各開一個交易（BEGIN、`SELECT … FOR UPDATE SKIP LOCKED`、COMMIT），什麼都選不到。
- 搬移本身逐列送出（`relayOutbox()` 的 L228–236）：每列一次 `boss.send` 往返，而且是在持有 outbox 列 `FOR UPDATE` 的租戶交易裡。
  pg-boss 12 有批次的 `boss.insert(name, jobs[])`（`node_modules/.pnpm/pg-boss@12.35.1/node_modules/pg-boss/dist/index.d.ts` L36），
  `JobInsert` 也支援 `id`、`startAfter`、`singletonKey`、`singletonSeconds`（`dist/types.d.ts` L1061–1078）。

N 最大的來源：

- `apps/api/src/modules/announcement/announcement-trigger.service.ts` 的 `fire()`（L32–64）：每則訂閱了這個觸發點的公告 × 每位使用者，各入列一筆（L46–62）。
- `apps/api/src/modules/group/group.service.ts` 的 `updateMembers()`（L251 起）在交易內呼叫它（L297–301）。
  一次最多加 100 人（`group.constants.ts` L14 的 `GROUP_BATCH_LIMIT`），當時還持有整個租戶的成員鎖 `lockMembership()`（L264）。
- `apps/api/src/modules/webhook/webhook.service.ts` 的 `emit()`（L125–145）：每個訂閱的每個網址一筆（L135–143）。

## 影響

- 例：一次加 100 位成員，有 3 則以「加入群組」觸發的公告：
  - 成員鎖內有 300 次 outbox INSERT 的往返，這段期間同一個租戶的其他成員異動都在等鎖。
  - 提交後再 300 次逐列 `boss.send`，加上 299 個空交易，合計約 1,200 次往返，回應多出數百 ms 到 1 秒以上。
- 一般的寫入只入列一兩筆，影響很小。

## 修正方式

1. 每個交易只登記一次搬移：`enqueue()` 以 `WeakSet` 記下已經登記過的交易。
2. `fire()` 一次寫完：把同一個事件要入列的工作收集起來，以一條多列 INSERT 寫進 outbox（`JobQueue` 加一個批次入列的方法）。
3. `relayOutbox()` 依工作名稱分組，用 `boss.insert(name, jobs[])` 一次送出一批，outbox 的 id 照舊當工作 id。
   先確認 `insert()` 遇到相同 id 時與 `send()` 一樣略過：重搬的冪等靠它（[`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §4.1 第 3 點）。
4. 「搬移移出交易」已列在 [`features/hardening-followups.md`](../features/hardening-followups.md) 的容量表，可以一起做。

## 驗證方式

- `apps/api/src/core/jobs/__tests__/job-queue.spec.ts` 的「JobQueue.enqueue 帶 tx：outbox」（L599 起）：同一個交易入列 3 筆，提交後搬移只跑一次（`tenantDb.transaction` 只被呼叫 1 次）。
- 同一個檔案的「JobQueue.relayOutbox」（L675 起）：一批 100 列只呼叫一次批次送出，不是 100 次 `send`。
- `apps/api/src/modules/announcement/__tests__/announcement-trigger.service.spec.ts` 的「AnnouncementTriggerService.fire」：100 人 × 3 則公告，outbox 只寫一次。
- 量 `PATCH /groups/:id/members`（加 100 人、3 則事件點公告）的回應時間。
