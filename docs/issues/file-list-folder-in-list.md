# 檔案列表與資料夾清單把資料夾 id 全部展開成 IN 清單，超過 65,534 個就失敗

## 現況

兩個常用的端點把資料夾 id 全部展開成 IN 清單。drizzle 的 `inArray` 每個 id 用一個綁定參數。

1. `GET /files`：
   - `apps/api/src/modules/file/file.service.ts` 的 `listScope()`（L554–564）。
     沒有全域 `file:read` 的人（系統角色 `member` 只有 `file:access`），範圍是 `ctx.readableFolderIds()`
     （`apps/api/src/modules/file/file-access.context.ts` L139–142），也就是所有讀得到的資料夾。
   - `apps/api/src/modules/file/file.repository.ts` 的 `list()`（L127–189）把它加進「頁面」與「count」兩條查詢：
     ```ts
     if (scope) conditions.push(inArray(files.folderId, [...scope.folderIds]));   // L140
     ```
   - 已指定 `folderId` 時，`listScope()` 已經先 `assertCan(…, 'read', folderId)`，這個 IN 條件是多餘的，但照樣帶上。
2. `GET /file-folders`：
   - `apps/api/src/modules/file/file-folder.service.ts` 的 `load()`（L86–103）把 **全部** 資料夾（含鎖住的、每個人的個人資料夾）交給 `tagsOf()`（L93–95）。
   - `apps/api/src/modules/tag/tag.repository.ts` 的 `tagsOf()`（L91–113）：`inArray(resourceTags.resourceId, [...resourceIds])`（L109）。

- postgres.js 遇到 65,534 個參數直接拋 `MAX_PARAMETERS_EXCEEDED`（`node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/connection.js` L186–187）。
- 共用資料夾授權給所有人（[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md) §12），整棵共用樹都在每個 member 的「讀得到」清單裡。
- 同一個 repo 的 `AnnouncementRepository.filterRecipients()`（`apps/api/src/modules/announcement/announcement.repository.ts` L461–483）已經為了這個上限分段查詢；這兩處沒有。

量測（自起的 PG17 容器，Docker Desktop、8 核；`files` 50 萬列）：查某個資料夾的第一頁加 count，IN 清單放 N 個讀得到的資料夾：

| N | 頁面＋count |
| --- | --- |
| 10 | 1.6 ms |
| 1,000 | 11.9 ms |
| 5,000 | 21.6 ms |
| 20,000 | 78.5 ms（光是規劃就 7.0 ms） |
| 65,534 | `MAX_PARAMETERS_EXCEEDED` |

## 影響

- 前提：共用樹，或授權給某人的資料夾很多。資料夾數隨使用成長；`GET /file-folders` 連別人的個人資料夾也算，至少一人一個。
- member 每次瀏覽檔案都付 O(讀得到的資料夾數) 的成本：5,000 個時是 10 個時的 13 倍。
  檔案列表是最頻繁的檔案請求，每次 `file` 推播都會重抓。
- 讀得到的資料夾到 65,534 個時，那個人的檔案列表全部回 500。
- 整個租戶的資料夾到 65,534 個時，所有人的 `GET /file-folders` 都回 500，檔案管理整個打不開。
- 這與 [`features/hardening-followups.md`](../features/hardening-followups.md) 延後的「個人資料夾不出現在別人的資料夾樹」不同：
  那一項談的是樹變大，這裡是會讓請求直接失敗的硬上限。

## 修正方式

1. `listScope()`：指定了 `folderId` 時不帶範圍（前面已經檢查過讀得到），只靠 `folder_id = $folderId`。
2. 不分資料夾的列表：範圍改成單一陣列參數，例如 ``sql`${files.folderId} = ANY(${ids}::uuid[])` ``，參數個數固定是 1。
   陣列本身仍隨 N 變大，但沒有參數上限，也省掉逐一綁定的成本。
3. `tagsOf()`：同樣改成 `= ANY($1::uuid[])`。
4. 改完後在 [`backend/09-file.md`](../architecture/backend/09-file.md) §11 補一句：範圍與批次讀取以陣列參數傳遞，不受參數個數上限影響。

## 驗證方式

- `apps/api/src/modules/file/__tests__/file.service.spec.ts`：指定 `folderId` 時，`repo.list` 收到的範圍是 undefined。
- `apps/api/test/file-access.spec.ts` 補大量資料夾的案例（例如 7 萬個資料夾，member 讀得到其中大部分）：
  `GET /files`、`GET /files?folderId=`、`GET /file-folders` 都回 200。
- 以 1,000 到 20,000 個讀得到的資料夾量 `GET /files` 的 p95：指定資料夾時與 N 無關；不分資料夾時明顯低於上表，65,534 個以上照常回應。
