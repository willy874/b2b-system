# 公告每日維護的 `requeued` 計數包含沒有入列的公告

## 現況

`apps/api/src/modules/announcement/announcement-dispatch.service.ts` 的 `maintain()`（L133–138）用 `reconcile()` 的結果計數：

```ts
if (outcome === 'rescheduled') rescheduled += 1;
if (outcome !== 'unchanged') requeued += 1;
```

`reconcile()`（L154–189）在兩種情況回 `'rescheduled'`：

- 週期的次數用完（`expected` 為 undefined）：改成 `completed`，**沒有入列**（L172–174）。
- 時間不同：更新 `next_run_at` 並入列（L176–179）。

所以次數用完的公告也被算進 `requeued`。
[`backend/19-announcement.md`](../architecture/backend/19-announcement.md) §5.2 只列了工作 output 的欄位，沒有定義兩個數字各算什麼。

## 影響

只影響 `announcement.maintenance` 工作的 output 和日誌（「公告的每日維護完成」）。排程和發送本身都正確。
看工作頁面的人會以為入列的工作比實際多。

## 修正方式

`reconcile()` 多回一個結果 `'completed'`，代表次數用完而結束：

- `rescheduled`：只算 `next_run_at` 有變動的。
- `requeued`：只算真的呼叫了 `scheduler.enqueue` 的。
- 結束的公告照樣要 `publish(id)`，讓列表更新。

要不要把 `completed` 也放進 output，順便在 19-announcement.md 寫清楚每個欄位算什麼，由處理的人決定。

## 驗證方式

`announcement-dispatch.service.spec.ts` 的 `maintain` 測試：次數用完的公告不計入 `requeued`。
