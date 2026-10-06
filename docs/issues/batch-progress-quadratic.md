# 批次進度的計算是 O(n²)，每次快照都要重算：上傳上千個檔案時畫面卡頓

## 現況

`packages/web-core/src/batch/activeQueue.ts` 的 `jobProgressAmount()`（L92–110）算整體進度時，每一個已完成的 id 都線性掃一次 `job.items`：

```ts
const weightOf = (id: string) =>
  weighted ? (job.items.find((item) => item.id === id)?.weight ?? 0) : 1;
const settled = [...job.succeeded, ...job.failures.map((failure) => failure.id)];
let done = settled.reduce((sum, id) => sum + weightOf(id), 0);
```

- 上傳的每個項目都帶 `weight`（檔案大小，`apps/backstage/src/features/file/batch.ts` L150），所以一定走 `find()` 這條路。
- 已完成 s 筆、共 n 筆時，一次計算是 O(s × n)。

這個函式在每次 render 都會被呼叫，而 render 很頻繁：

1. `BatchJobProgress.tsx` L50 在 render 時呼叫 `jobProgressAmount(job)`，沒有 memo。
2. 佇列每次收到進度就廣播完整快照：
   - `BatchQueueHost.ts` 的 `updateProgress()`（L277–283）呼叫 `broadcast()`。
   - `broadcast()`（L351–359）用 `structuredClone(this.jobs)` 複製全部工作，含最多 30 個已結束的工作（L19 `FINISHED_LIMIT`）。
3. 分頁端只對「每一項」節流 200 ms（`BatchQueueClient.ts` L81、L241–250）。上傳 3 筆並行，加上每筆完成時的廣播，每秒約 15 次以上快照。
4. 檔案管理頁在 **頁面層** 訂閱所有工作：
   - `FileManagerPage`（`features/file/pages/FileManager/page.tsx` L76）呼叫 `useFileActions()`。
   - `useFileActions()`（`useFileActions.ts` L28–31）呼叫 `useBatchJobs()`。
   - 所以每個快照都讓整個檔案管理頁重繪，`page.tsx` L135 的 `BatchProgressBar` 再對每個進行中的工作算一次 `jobProgressAmount()`。
   - 頂列佇列面板打開時（`BatchQueueIndicator.tsx` L69），每個工作也各算一次。

量測方式：把同一段演算法複製到 Node 24 執行，項目都帶 `weight`、90% 已完成，取 5 次平均：

| 項目數 | 一次 `jobProgressAmount()` |
| --- | --- |
| 500 | 0.9 ms |
| 2,000 | 12.5 ms |
| 5,000 | 35.5 ms |
| 10,000 | 133 ms |

另外，5,000 項的工作 `structuredClone` 一次約 2.3 ms，序列化成 JSON 約 600 KB。

## 影響

- 以每秒約 15 次快照估算：
  - 5,000 個檔案：上傳後段約一半的主執行緒時間花在這裡，捲動與點擊明顯延遲。
  - 10,000 個檔案：畫面接近凍結。
- 每次快照也讓整個 `FileManagerPage` 重繪：工具列、資料夾樹、選取列、主區塊的 props 都重新計算。
- 資料夾上傳沒有數量上限（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13.2 D11），拖進一個大資料夾就會遇到。
- 實際卡頓程度依裝置效能而定；上面是開發機上的 Node 量測，一般筆電會更慢。

## 修正方式

1. `jobProgressAmount()` 先建 `Map<id, weight>`，再加總，變成 O(n)。
   也可以由佇列在快照裡直接帶「已完成份量」與「總份量」，分頁不必自己算。
2. 不要在頁面層訂閱所有工作：
   - 把 `BatchProgressBar` 包成只負責進度的子元件，自己呼叫 `useBatchJobs()`。
   - `useFileActions()` 只回傳操作（刪除、移動、取消）。
   - 頁面需要「有沒有進行中的工作」時，用回傳布林值的 selector，避免每個快照都重繪整頁。
3. 選做：快照只帶有變動的工作，或在佇列端把快照節流到每秒約 4 次，減少分頁的反序列化與重繪。

## 驗證方式

- `packages/web-core/src/batch/__tests__/BatchQueue.test.ts` 的 `jobProgressRatio` 區塊（L382 起）：
  - 現有案例照過，確認結果不變。
  - 補一個 10,000 項的案例，斷言耗時在幾毫秒內，防止退回 O(n²)。
- 檔案管理頁：用 React Profiler 上傳 3,000 個小檔，`FileManagerPage` 每秒的 commit 次數應接近 0，只有進度元件更新。
