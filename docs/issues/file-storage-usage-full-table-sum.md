# 檔案已用量每次都對整張 `files` 表加總，上傳登記與每次檔案變動都會觸發

## 現況

已用量由 `apps/api/src/modules/file/file.repository.ts` 的 `storageUsed()`（L199–206）計算，不帶任何條件：

```ts
if (tx) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('files:storage_quota'))`);
const [row] = await db
  .select({ used: sql<string>`coalesce(sum(${files.size}), 0)::text` })
  .from(files);
```

- `files` 上只有 `storage_key` 的唯一索引，加上幾個以 `deleted_at IS [NOT] NULL` 為條件的部分索引（`apps/api/src/db/migrations/0000_baseline.sql` L287–294、`0004_files_created_by_idx.sql`、`0013_file_deletion_id.sql`）。
  沒有一個能涵蓋「含回收桶、不帶條件」的 `SUM(size)`，只能循序掃描整張表。
- 呼叫點都在 `apps/api/src/modules/file/file.service.ts`：
  1. `getUploadPolicy()`（L102–113）：`GET /files/upload-policy` 每次都算一次。
  2. `createUpload()`（L173 起）先不上鎖算一次（L181）。
  3. 同一個 `createUpload()` 在 `insideFolder()` 的交易內再算一次（L192–193）。這次先取容量鎖，同一個租戶的所有上傳登記在這裡排成一列。
- `apps/api/src/modules/file/file-folder.service.ts` 的 `insideFolder()`（L111–121）：上傳到資料夾時，先取整個租戶的資料夾樹鎖（`lockTree()`），再取容量鎖、加總、INSERT。
  所以往資料夾上傳也和資料夾的建立、改名、移動、刪除排同一個隊。
- 對外 API 的 `POST /v1/files`（`apps/api/src/modules/file/external/file.external.service.ts` L95–99）走同一條路徑。

推播把 `getUploadPolicy()` 放大成「每次檔案變動 × 每個開著檔案管理的分頁」：

- `file` 的變更推給 `file:read`、`file:access`（`apps/api/src/modules/realtime/realtime.audience.ts` L25、L58）。系統角色 `member` 就有 `file:access`（`apps/api/src/db/seeds/roles.ts` L102–109）。
- 前端把用量的 query 放在 `file` 的 `collection`（`apps/backstage/src/apis/resources.ts` L247）。它不在 `scopedCollection` 裡，任何資料夾的檔案變動都會讓它失效。
- 用量顯示在檔案管理的側欄（`apps/backstage/src/features/file/pages/FileManager/components/FileFolderTree.tsx` L163），檔案管理開著就一直掛著。
- 結果：任何人上傳、改名、刪除一個檔案，每個開著檔案管理的可見分頁都會在 150–750 ms 後重抓 upload-policy
  （`packages/web-core/src/realtime/RealtimeCoordinator.ts` L68 的 `DEFAULT_APPLY_JITTER`），各觸發一次全表加總。

量測（自起的 PG17 容器，Docker Desktop、8 核；`files` 50 萬列、heap 130 MB，索引照 migration 建）：

| 情境 | 結果 |
| --- | --- |
| 單次加總，熱快取 | 30 ms；Parallel Seq Scan，用到 3 個程序 |
| 單次加總，冷快取 | 250–425 ms |
| 40 個加總同時執行（連線池 10 條） | 牆鐘 1.0 s，8 核全滿 |
| 12 個上傳登記同時執行（容量鎖＋加總，連線池 10 條） | 最後一個 394 ms 才完成；期間一條無關的查詢等了 66 ms 才拿到連線 |

## 影響

- 前提：租戶裡有幾十個人開著檔案管理，同時持續有人上傳。1000 人在線的租戶，上班時段就是這樣。
- 每次檔案變動，DB 要做「開著的分頁數」次全表掃描。100 個分頁、熱快取每次約 90 core-ms，合計約 9 core-s。
- 檔案數隨使用持續成長（含回收桶），成本跟著線性變大。到百萬列或快取變冷時，一次加總要 100–400 ms。
- 上傳登記被容量鎖排成一列，吞吐量是「1 ÷ 一次加總的時間」：50 萬列熱快取約每秒 30 個，百萬列或冷快取時每秒只剩幾個。
- 前端每人同時上傳 3 個（`apps/backstage/src/features/file/constants.ts` L69 的 `UPLOAD_CONCURRENCY`）。
  4 個人同時上傳，等鎖的交易就佔滿租戶的 10 條連線（`TENANT_POOL_MAX`），整個租戶的其他請求跟著排隊。
  佔滿的時間是「排隊的登記數 × 一次加總」：50 萬列熱快取約 0.4 秒，百萬列或冷快取時是好幾秒。
- 等鎖超過 `DB_STATEMENT_TIMEOUT_MS`（15 秒）的登記回 500。
- 資料夾的建立、改名、移動、刪除也排在上傳後面。

## 修正方式

1. 建議：改成計數，不再加總。
   - 租戶 DB 加一張只有一列的 `file_storage_usage(used_bytes)`。
   - 在 `FileRepository.create()`（加 `size`）、`markReady()`（大小有差時補差額）、`hardDelete()`（減 `size`）的同一個交易更新它。
     軟刪除、還原不動計數，與現在「含回收桶」的語意相同。
   - 登記時以一條 `UPDATE file_storage_usage SET used_bytes = used_bytes + $size WHERE used_bytes + $size <= $quota RETURNING used_bytes`
     同時檢查與佔用，沒有回列就是超過容量。列鎖取代 advisory lock 與加總，O(1)。
   - `file.maintenance` 每天以 `SUM(size)` 對帳一次，修正偏差。
2. 短期止血（可與 1 並行）：`getUploadPolicy()` 的已用量做每個租戶 5–10 秒的快取，同時的請求共用同一次查詢。
3. 前端（擇一配合）：用量不要隨每次 `file` 推播重抓。
   例如把 `FILE_STORAGE_USAGE_QUERY_KEY` 移出 `resources.ts` 的 `collection`，改在自己上傳完成、刪除之後重抓。
4. 改完後同步規格：[`05-tenancy.md`](../architecture/05-tenancy.md) §13.3 D8、[`backend/09-file.md`](../architecture/backend/09-file.md) §5.0 的用量算法。

## 驗證方式

- `apps/api/src/modules/file/__tests__/file.service.spec.ts` 的「FileService：檔案容量」：
  - 超過容量仍回 `FILE_STORAGE_QUOTA_EXCEEDED`，不登記、不開分塊上傳。
  - 登記成功後計數增加；登記失敗（資料夾已刪除）時計數不變。
- `apps/api/test/file-lifecycle.spec.ts` 補整合測試：建立、完成、放棄、刪除、還原、永久刪除之後，計數都等於 `SUM(size)`。
- 在 50 萬到 200 萬列的資料上看 `EXPLAIN`：upload-policy 與上傳登記都沒有 `Seq Scan on files`。
- 壓測 20 個同時登記：p95 與連線池的等待時間不隨檔案數成長。
