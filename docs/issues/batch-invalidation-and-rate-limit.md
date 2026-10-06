# 批次工作每完成一筆就失效並重抓，也不處理 429：大批次可能用光每人的限流額度

## 現況

佇列每完成一筆，執行的分頁就照單筆 mutation 的規則失效一次快取（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13.2 D7）：

- 上傳：`apps/backstage/src/features/file/batch.ts` 的 `runUpload()`（L65–86），成功後在 L81 失效：

  ```ts
  invalidateResources([{ resource: Resource.FILE, kind: 'create', id: stored.id }]);
  ```

  - 沒有帶 `refs.fileFolder`，`apis/resources.ts` L250 的 `scopedCollection` 用不上：`FILE_LIST`、`FILE_INFINITE_LIST` 以前綴整批失效。
  - 同時失效容量 `FILE_STORAGE_USAGE`（L247）；檔案管理頁上的容量顯示會跟著重抓。
- 刪除檔案（L107）、刪除資料夾（L118–121）。
- 使用者的啟用、停用、解鎖、刪除：`features/user/batch.ts` L35、L66、L79。
- 角色刪除 `features/role/batch.ts` L27；審批 `features/approval/batch.ts` L41。

失效之後，畫面上正在用的 query 立刻重抓：

- `packages/web-core/src/cache/AppQueryClient.ts` 的 `applyInvalidation()`（L77–85）呼叫 `invalidateQueries({ queryKey, refetchType: 'active' })`。
- TanStack Query 預設 `cancelRefetch: true`：前一次重抓還沒回來就取消，再送一次。被取消的請求已經送出，伺服器照樣計數。
- 無限捲動的檔案列表，每次重抓都從第 1 頁依序抓回所有已載入的頁。

一筆上傳至少 4 個 api 請求：

1. 登記：`apis/file/upload-file/fetcher.ts` L62。
2. 完成：L95。
3. 重抓檔案列表。
4. 重抓容量。

上傳一次 3 筆並行（`features/file/constants.ts` L69 `UPLOAD_CONCURRENCY = 3`）。

限流與失敗處理：

- 已登入的使用者，所有端點合計每分鐘 600 次（`apps/api/src/core/config/env.schema.ts` L112 `DEFAULT_RATE_LIMIT`）。
  同一個人在其他分頁因推播而做的重抓，也算在同一個額度。
- `packages/web-core/src/plugins/fetcher/retry.ts` 的 `isRetryable()`（L19–25）只重試冪等方法的 5xx 與網路錯誤。429 不重試。
- `packages/web-core/src/batch/BatchQueueHost.ts` 的 `settleItem()`（L255–275）把失敗記進 `job.failures`，接著立刻 `pump()` 下一筆。
  遇到 `RATE_LIMITED` 不會暫停或退避。
- `pnpm dev:e2e` 把 `DEFAULT_RATE_LIMIT` 調成 10000（`package.json` L14）。E2E 不會碰到這個上限。

設計時的前提和現在不同：

- 07 §13.4 的前提是「後台管理的批次量不大」，§13.2 D11 也寫「不設上限，量大只是時間長」。
- 後來上傳也併入同一個佇列（[`frontend/12-file-manager.md`](../architecture/frontend/12-file-manager.md) §14.2 D1），而資料夾上傳沒有數量上限。

## 影響

- 估算：小檔每筆約 0.3 秒、3 筆並行，每秒約完成 10 筆，也就是每秒約 40 個 api 請求。十幾秒內就會超過每分鐘 600 次。
- 超過之後，登記與完成都會回 429，每筆幾十毫秒就失敗。剩下的項目會很快被連續標成失敗，結果對話框列出大量 `RATE_LIMITED`。
  使用者只能等額度恢復後，重新選檔上傳失敗的部分。
- 批次刪除數百個檔案，或批次停用跨頁勾選的大量使用者，每筆是 1 個寫入加 1–3 個重抓，同樣可能碰到上限。
- 每一筆上傳結束都重抓一次容量（`GET /files/upload-policy`）。後端已改成讀單列的計數（O(1)，[`backend/09-file.md`](../architecture/backend/09-file.md) §5.0），但仍是一個計入限流的請求。
- 前提條件：會不會觸發 429，取決於檔案大小、網路與伺服器延遲。上面是估算，**還沒有用正式的限流值實際跑過**。
  大檔的上傳主要受頻寬限制，每秒完成的筆數低，比較不會碰到。

## 修正方式

1. 批次執行期間合併失效（建議先做）：
   - `invalidateResources()` 在批次的 `run` 裡呼叫時，先把 `ResourceChange` 收集起來。
   - 每秒最多套用一次，工作結束時再套用一次。
   - 可以沿用推播用的 `createKeyedThrottle`（`packages/web-shared/src/utils/keyedThrottle.ts`）。
2. `applyInvalidation()` 改成 `invalidateQueries(…, { cancelRefetch: false })`：已經在重抓的 query 不取消重送。
3. 上傳的變更帶目的地資料夾，只失效那個資料夾與不分資料夾的列表：
   - 寫法：`refs: { fileFolder: [folderId ?? ROOT_FOLDER] }`，`ROOT_FOLDER` 在 `features/file/pages/FileManager/folderTree.ts` L4。
   - 後端推播也是這樣帶：`apps/api/src/modules/file/file.constants.ts` L160、L175 的 `ROOT_FOLDER_REF`。
4. 佇列遇到 `RATE_LIMITED`：
   - 依 `details.retryAfterSeconds` 暫停整個工作，時間到再重送同一筆，不記為失敗。
   - 要改的地方：`BatchQueueHost` 的 `settleItem()`。分頁端的 `serializeBatchError()` 已經帶著 `details`。
5. 文件：07 §13.4 的取捨補上「每筆失效一次」與限流的關係，以及上傳併入佇列之後批次量的變化。

## 驗證方式

- `packages/web-core/src/batch/__tests__/BatchQueue.test.ts`：執行端回報 `RATE_LIMITED`（帶 `retryAfterSeconds`）時，該筆延後重送，不進 `failures`。
- 新增合併失效的測試：批次期間連續 100 筆變更，`invalidateQueries` 只被呼叫有限次；工作結束時一定會套用最後一次。
- 實跑：用預設的限流值（不要用 `pnpm dev:e2e`）上傳一個有 300 個小檔的資料夾，結果沒有 `RATE_LIMITED` 的失敗。
