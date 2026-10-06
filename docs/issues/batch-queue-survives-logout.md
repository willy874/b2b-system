# session 結束時批次佇列只取消、不清除，下一個登入的人看得到前一個人的批次項目與上傳暫存

## 現況

- `apps/backstage/src/plugins/app/batch-queue.ts` 的 `onInit`（L53）在 session 結束時只送 `cancel-all`：

  ```ts
  offSession = getSessionStore(options.backend).events.on('ended', () => client.cancelAll());
  ```

- `packages/web-core/src/batch/BatchQueueHost.ts`：
  - `cancel()`（L285–299）只把進行中的工作改成 `cancelled`。工作本身（`items[].label`、`failures`）都留著。
  - 已結束的工作最多保留 30 筆（`FINISHED_LIMIT`，L19；`trimFinished()`，L343–348）。
  - 已有 `clear-finished` 指令（L194–197，對應 `BatchQueueClient.clearFinished()`），但 session 結束時沒有呼叫。
- `packages/web-core/src/batch/BatchQueueClient.ts`：
  - `start()`（L138–150）加入時送 `snapshot-request`，向既有的佇列要快照。
  - `recompute()`（L278–283）合併所有佇列的工作，不區分是誰送出的。
  - 頂列的 `BatchQueueIndicator` 列出全部工作，展開可以看到失敗清單（名稱與原因）。
- 項目名稱（`label`）是個資或內容：
  - 使用者列表：`apps/backstage/src/features/user/pages/UserList/page.tsx`（L149），email。
  - 審批列表：`features/approval/pages/ApprovalList/page.tsx`（L93），申請人姓名。
  - 角色列表：`features/role/pages/RoleList/page.tsx`（L145），角色名稱。
  - 檔案上傳：`features/file/batch.ts` 的 `enqueueFileUploads()`（L139–160），檔名或資料夾內的相對路徑。
- 佇列跑在 SharedWorker 裡（`packages/web-core/src/batch/connect.ts`）。同源還有任何一個分頁開著，佇列就一直存在；換人後重新登入的分頁會連回同一個佇列。
- 上傳的檔案本體存在 IndexedDB（`features/file/upload/uploadSources.ts`，L7，資料庫 `b2b-system:blob:file-upload`）：
  - `runUpload()`（`features/file/batch.ts` L65–86）只在實際執行的項目的 `finally` 裡刪掉暫存（L82–85）。
  - 被取消、從沒執行的項目會留在 IndexedDB。要等之後某次啟動、而且已超過 24 小時，才會被 `prune()` 清掉（`features/file/plugin.ts` L49、`uploadSources.ts` L10）。

[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §6.2 與 §13.2 D12 只規定「session 結束時取消所有進行中的工作」，理由是之後每一筆都只會得到 401。已結束的工作與上傳暫存怎麼處理，兩處都沒有提到。

重現步驟：

1. 共用電腦上，A 開著兩個 backstage 分頁 X、Y。在 X 對 50 位使用者批次停用，或上傳一批檔案。
2. A 在 X 登出。兩個分頁都在 SPA 內回到登入頁，Y 仍連著 SharedWorker。
3. B 在 X 按「登入」，完成 SSO 回到 backstage。
4. B 打開頂列的佇列面板：看得到 A 的工作，展開失敗清單可以看到每一筆的 email 與原因。
5. A 沒上傳完的檔案內容仍在這台瀏覽器的 IndexedDB 裡。

## 影響

- 同一台瀏覽器的下一位使用者，看得到前一位使用者的操作紀錄與個資（email、姓名、檔名、路徑），最多 30 筆工作。B 不一定有 `user:read`。
- 違反 [`frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §3.3「登出後下一個人不能看到上一個人的資料」。同文件 §5「目前的頻道」表也註明 `batch-queue` 的項目名稱含 email。
- 前提：換人登入時，同源還有另一個分頁開著，SharedWorker 不會結束。
  只開一個分頁時，SharedWorker 會隨最後一個分頁離開而結束；但頁面被放進 bfcache 時是否保留，各瀏覽器不同，未實測。
- IndexedDB 裡的檔案不會出現在 app 畫面上，但用開發者工具讀得到，最久保留到「超過 24 小時後的下一次啟動」。
- 不會以 B 的身分繼續執行 A 的工作：`cancel-all` 已經讓它們停下。

## 修正方式

1. session 結束時清空佇列，擇一（建議 a）：
   - a. `BatchQueueHost` 加一個 `reset` 指令：取消進行中的工作（同 `cancel()`）、清空 `this.jobs`、廣播空快照。`batch-queue.ts` 的 `ended` 改呼叫 `client.reset()`，取代 `cancelAll()`。
   - b. 最小改法：在 `cancelAll()` 之後接著呼叫 `client.clearFinished()`。`cancel()` 已把工作改成 `cancelled`，不再算進行中，會被一起移除；執行中那幾筆的結果晚到時，`settleItem()` 找不到工作就略過。
2. 長期：`enqueue` 時在工作上記下擁有者（租戶＋使用者 id），`BatchQueueClient.recompute()` 只顯示目前使用者的工作。即使舊工作還在，換人後也看不到。
3. 上傳暫存：
   - `packages/web-shared/src/storage/blobStore.ts` 的 `BlobStore` 加 `clear()`，同時清記憶體與 IndexedDB。
   - file feature 在主 session `ended` 時呼叫 `uploadSources.clear()`。file 是可啟用的 feature，訂閱要隨 plugin 的 `onInit` 建立、卸載時解除。
4. 修正後在 07-ui-system.md §6.2 與 §13.2 D12 補一句：session 結束時清除佇列與上傳暫存。

## 驗證方式

- `packages/web-core/src/batch/__tests__/BatchQueue.test.ts`：用 `createFakeChannelHub()` 模擬兩個分頁。
  - 完成一個工作後送 `reset`（或 `cancel-all` 加 `clear-finished`），斷言兩個 client 的 `getJobs()` 都是空的。
  - 執行中那一筆的結果晚到時，不會把工作加回來。
- 新增 `apps/backstage/src/plugins/app/__tests__/batch-queue.test.ts`：注入假的 `connect`，呼叫主 session 的 `endSession()`，斷言送出清空佇列的指令。
- `packages/web-shared/src/storage/__tests__/blobStore.test.ts`：補 `clear()` 會清掉記憶體與 IndexedDB。
- `apps/backstage/src/features/file/__tests__/batch.test.ts`：session 結束後 `uploadSources` 為空。
