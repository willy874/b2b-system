# ADR-0013 — 檔案管理器：上傳併入全域批次佇列、瀏覽器產生縮圖、keyset 分頁

- 狀態：**採用**（擴充 [ADR-0012](./0012-batch-queue-worker.md)）
- 日期：2026-09-27
- 相關：[`../architecture/frontend/12-file-manager.md`](../architecture/frontend/12-file-manager.md)、[`../architecture/backend/09-file.md`](../architecture/backend/09-file.md) §5、§6.1、§7.1

## 背景

檔案管理器要一次上傳多個檔案（包含數十 MB 的素材包）、在列表上顯示圖片預覽，並支援無限捲動。直接套用既有機制會遇到：

- **上傳要有自己的進度、取消與失敗清單**，而這些 [ADR-0012](./0012-batch-queue-worker.md) 的全域批次佇列都有；另做一套上傳佇列，
  AppHeader 就會有兩個「背景工作」面板，行為也會分歧。但佇列原本只認得「一筆成功或失敗」、一次只處理一筆，項目也只帶 id。
- **大檔單次 PUT**：失敗要整個重傳，進度只有一條；超過 5 GiB 物件儲存也不接受。
- **列表的圖片預覽**：直接用原圖，一頁 60 張 1–5 MB 的圖就是上百 MB；presigned 網址每次查詢都不同，重抓列表就全部重新下載。
- **無限捲動用 offset**：捲動途中有人上傳（插在前面）會讓下一頁重複，有人刪除則會漏掉。

## 決定

| # | 問題 | 決定 |
| --- | --- | --- |
| D1 | 上傳走哪個佇列 | **全域批次佇列**：上傳是一種批次操作（`file.upload`），每個檔案是一筆。進度、取消、結果彈窗、跨分頁接手全部沿用 |
| D2 | 一次處理幾筆 | 工作之間仍是堵塞式；**工作內可以並行**：`BatchJobInput.concurrency`（上限 6），上傳用 3。其他批次操作維持 1 |
| D3 | 位元組進度 | 操作以 `BatchRunContext.reportProgress` 回報處理中那一筆的進度（分頁端節流 200 ms），佇列記在 `BatchJob.progress` 並廣播；項目帶 `weight`（位元組）時整體進度依份量計算 |
| D4 | 取消 | 佇列對處理中的項目送 `abort`，分頁中止該筆的 `AbortSignal`；被中止的那一筆不算失敗。上傳被中止時放棄這次上傳（`DELETE /files/:id/upload`） |
| D5 | 檔案本身放哪裡 | 佇列項目要能跨 worker、跨分頁傳遞，只帶 id；檔案放進 `uploadSources`（本分頁記憶體 ＋ IndexedDB）。發起的分頁關掉時，接手的分頁從 IndexedDB 讀到同一個檔案 |
| D6 | 大檔 | 大於 `FILE_MULTIPART_THRESHOLD` 改用 S3 multipart upload：後端決定切法、各塊網址邊傳邊要，前端 4 塊並行、各塊重試 |
| D7 | 縮圖 | **瀏覽器在上傳時產生**（`core/file` 的縮圖產生器），與本體一起直傳；後端只確認存在與規格 |
| D8 | 下載網址的快取 | 簽章時間取整到 `FILE_URL_TTL / 2` 的倍數，時間窗內網址不變，並回 `Cache-Control: immutable` |
| D9 | 無限捲動 | keyset 游標（`nextCursor`）；游標帶排序條件與微秒精度的值 |
| D10 | 預覽與驗證的擴充 | `core/file` 的三個註冊表（預覽解析器、檔案驗證器、縮圖產生器）；內建項目由 `features/file` 在 plugin 的同步階段註冊 |

## 理由

- **一個佇列**：使用者只需要知道「背景有工作在跑」一件事；上傳與批次刪除彼此排隊，也不會同時搶頻寬與 API 配額。
- **並行只開在工作內**：上傳每筆彼此獨立、瓶頸在網路延遲，3 個並行幾乎是 3 倍快；ADR-0012 的「前一筆影響後一筆」
  顧慮（例：最後一位 super-admin）只存在於會互相影響的操作，它們維持一次一筆。
- **IndexedDB 而不是把 File 放進佇列**：佇列快照每次進度更新都要廣播給所有分頁，帶著檔案內容會把數百 MB 反覆 structured clone。
- **瀏覽器產生縮圖**：api 不必裝影像處理的原生套件、不佔 CPU，也不必把原圖從物件儲存讀回來；瀏覽器上傳前本來就持有檔案。
- **keyset 而不是 offset**：唯一在插入與刪除下仍然正確的分頁方式；搭配 (排序欄位, id) 索引，每一頁都是索引範圍掃描。

## 取捨

- **縮圖依賴上傳者的瀏覽器**：瀏覽器不支援的格式（HEIC 等）、其他管道寫入的檔案沒有縮圖，列表退回類型圖示。
  之後若需要，可以加一個伺服器端的補產生排程，不影響前端。
- **IndexedDB 不可用時不能跨分頁接手**：發起的分頁關掉後，接手的分頁拿不到檔案，該筆失敗並請使用者重傳。
- **分頁當掉時的殘留**：未完成的 multipart upload 與 `pending` 紀錄要靠排程清理（[backend 09 §9](../architecture/backend/09-file.md)）。
- **下載網址的剩餘效期縮短為 TTL/2–TTL**：前端依 `urlExpiresAt` 在失效前重抓。

## 後果

- `core/batch`：`BatchJobInput.concurrency`、`BatchJobItem.weight`、`BatchJob.progress`、`BatchOperation.run(itemId, { signal, reportProgress })`；
  協定新增 `progress`（分頁 → 佇列）與 `abort`（佇列 → 分頁）；`jobProgressRatio()` / `jobProgressAmount()`。既有操作只多收一個參數，行為不變。
- 後端：`files` 新增 `upload_id`、`has_thumbnail`、`version` 與排序／搜尋索引（`0007_file_manager.sql`，需要 `pg_trgm`）；
  端點 `GET /files/upload-policy`、`POST /files/:id/parts`、`DELETE /files/:id/upload`；`GET /files` 回 `FileListPage`（含 `nextCursor`）；
  錯誤碼 `FILE_UPLOAD_PART_INVALID`、`FILE_VERSION_CONFLICT`；環境變數 `FILE_MULTIPART_THRESHOLD`、`FILE_MULTIPART_PART_SIZE`。
- 前端：`core/file`（類型、擴充點）、`shared/storage/blobStore`、`features/file`。
