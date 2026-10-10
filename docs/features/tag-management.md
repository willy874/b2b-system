# 標籤管理

- 優先度：P2
- 狀態：提案
- 依賴：標籤（[`backend/18-tag.md`](../architecture/backend/18-tag.md)：§1 標籤組、§3 API、§7.2 D5～D11）；route id（[`frontend/03-feature-anatomy.md`](../architecture/frontend/03-feature-anatomy.md) §4.1）；
  命令面板（[`frontend/18-command-palette.md`](../architecture/frontend/18-command-palette.md) §4）
- 相關：[`settings-navigation.md`](./settings-navigation.md)（同樣補 `search.ts`）；[`list-filters-completion.md`](./list-filters-completion.md)（各列表的篩選參數名稱）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

標籤管理頁（`features/tag/pages/TagList/page.tsx`）只能建、改名換色、刪除。用了幾個月之後，常見的整理動作做不到：

| 情境 | 現況 | 問題 |
| --- | --- | --- |
| 有人建了「合約」，另一人建了「合約書」，各自貼了一半的檔案 | 只能逐個資源改標籤，再刪掉其中一個 | 沒有合併；直接刪除會連指派一起 CASCADE 掉（§7.2 D4） |
| 在管理頁看到一個標籤，想知道它貼在哪 | 自己到使用者列表、檔案管理器、圖片庫去篩 | 管理頁沒有連結；三個列表的參數也不一致：使用者 `?tagId=`（`features/user/routes/model.ts:22`）、檔案 `?tag=`（`features/file/routes/model.ts:16`）、圖片庫 `?tag=`（`features/gallery/routes/model.ts:21`） |
| 一組有上百個標籤（上限 200，D11） | 管理頁是不分頁的表格 | 沒有搜尋，只能捲動或用瀏覽器的尋找 |
| 想從任何地方快速跳到某個標籤 | ⌘K 搜不到標籤 | `features/tag` 沒有 `search.ts`；現在登記的是 file、user、role、group、service-account、webhook、organization |

另外，檔案管理器的 `?tag=` 只篩 **目前資料夾**（`features/file/pages/FileManager/useFileManagerItems.ts:46` 一律帶 `folderId ?? 'root'`；後端 `GET /files` 不帶 `folderId` 時其實可以跨資料夾，`apps/api/src/modules/file/dto/list-file.dto.ts:24`），從標籤跳過去看到的不是「所有貼了它的檔案」。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 合併標籤：把 A 的指派搬到 B 後刪除 A，在一個交易內（§1） | 使用次數統計（[`backend/18-tag.md`](../architecture/backend/18-tag.md) §7.2 不做：計數會透露看不到的資源數量） |
| 從標籤跳到貼了它的資源：每種資源類型一個連結，經 route id（§2） | 標籤階層、依標籤授權、「全部符合」的篩選、依標籤組分開的管理權限（同上） |
| 管理頁的搜尋（名稱的部分比對，前端過濾） | 管理頁分頁（一組最多 200 個，D11） |
| 命令面板：搜尋標籤、「建立標籤」動作（§3） | 跨標籤組合併（`file` 組的標籤合併到 `user` 組） |
| | 合併的復原（合併後原標籤已硬刪除，與 D4 一致） |

## 使用者故事

**作為租戶管理員，我希望把「合約書」合併到「合約」，以便不必逐一重貼。**

- **Given** `file` 組有「合約」與「合約書」，各自貼在一些檔案與資料夾上
- **When** 我在「合約書」的選單按「合併到…」，選「合約」並確認
- **Then** 原本貼「合約書」的資源都改貼「合約」（兩個都有的只留一個），「合約書」消失；稽核記一筆 `tag.merge`；正在看檔案管理器的人列表自動更新

**作為管理員，我希望從標籤直接看到貼了它的使用者，以便確認分類是否正確。**

- **Given** `user` 組的「外包」
- **When** 我在管理頁那一列按「查看使用者」
- **Then** 進入使用者列表，篩選面板已選「外包」；我看不到的人本來就不會出現

## 初步構想

### 1. 合併（`modules/tag`）

- `POST /tags/:id/merge`，body `{ targetId, version, targetVersion }`；權限 `tag:delete`（會刪掉來源，D5 的 `delete` 包含 `update`）。
- 檢查：同一個標籤組（否則 `409 TAG_MERGE_SCOPE_MISMATCH`）、不能合併到自己、兩邊的 `version`（樂觀鎖，[`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11）。
- 交易內：`INSERT INTO resource_tags (tag_id = target, …) SELECT … FROM resource_tags WHERE tag_id = source ON CONFLICT DO NOTHING`，再刪除來源標籤（指派 CASCADE），目標的 `version` 加一。
  一個資源的標籤數不會變多（來源換成目標，或兩者合一），20 個的上限（D11）不必重查。
- 稽核：一筆 `tag.merge`（`resourceId` 是目標，`metadata` 帶來源的 id、名稱與搬移的指派數——數量是否寫進稽核見開放問題 2）。不逐資源寫 `tag.assign`。
- 推播：定義的變更推 `tag`（D10）。指派變了的資源原本由擁有者推自己的 update（D7）；合併可能動到上千個資源，改成在 `TagRegistry` 加 `onTagsMerged(resourceType)`，擁有者推一則「列表要重抓」的集合推播，不逐筆（開放問題 3）。
- 匯入匯出（`tag.transfer.ts`）不受影響。

### 2. 從標籤到資源（前端）

- 擁有者 feature 登記 route id，沿用 `user.listByMfa` 的寫法（`features/user/routeLinks.ts:9`）：
  `user.listByTag`（`UserListRoute`，`search: { tagId: 'tagId' }`）、`file.listByTag`、`gallery.listByTag`。
- `features/tag` 以 `constants.ts` 的「標籤組 → 資源類型 → route id」對照表在每一列放連結（`<RouteLink>`）；route id 沒有登記（feature 未啟用）時不顯示，`RouteLink` 本來就會處理。
- 參數名稱不在這裡統一（`tagId` vs `tag`），由 [`list-filters-completion.md`](./list-filters-completion.md) 決定；route id 讓 tag 不必知道。
- 檔案的連結進「不分資料夾」的檢視：檔案管理器沒有這個模式，需要新增（開放問題 1）。資料夾只能在前端篩，跨資料夾的資料夾清單不在範圍內。

### 3. 搜尋與命令面板（`features/tag`）

- 管理頁表格上方加 `SearchInput`，對目前標籤組的名稱做不分大小寫的部分比對；關鍵字進網址（`?keyword=`）。
- 新增 `features/tag/search.ts`：`registerSearchProvider({ key: 'tag', pageKey: TAG_PAGE, … })`，對每個看得到的標籤組呼叫 `GET /tags?scope=`，前端過濾，結果連到 `/tag?scope=<組>&keyword=<名稱>`；
  `registerPaletteCommand('tag.create')` 連到 `?mode=create`。`plugin.ts` 同步階段呼叫，`app/__tests__/navigation.test.ts` 的完整性檢查要加上 tag。
- 管理頁的列選單：「合併到…」（`TagMergeDialog`，`Select` 列出同組其他標籤）、「查看 <資源類型>」。

### 4. 權限

- 不新增權限鍵；合併用 `tag:delete`。同步 `docs/architecture/iam/02-permission-catalog.md` 的 `tag:delete` 說明與兩個語系檔的說明文字。
- 錯誤碼：`TAG_MERGE_SCOPE_MISMATCH`、`TAG_MERGE_SELF`（`packages/error-codes` ＋ `ERROR_MESSAGE_KEY` ＋ 語系檔）。

## 開放問題

1. 檔案的「查看檔案」要進哪裡？A. 檔案管理器新增「搜尋結果」模式（不分資料夾、只列檔案）；B. 只篩根目錄；C. 不提供檔案的連結。A 也是全域搜尋檔案時需要的模式。
2. 合併的確認框與稽核要不要顯示「搬移了 N 筆指派」？確認框若顯示，就是 §7.2 不做的「使用次數」從另一個門進來（操作者看得到數量，包括他看不到的資源）。傾向確認框不顯示、稽核的 `metadata` 記下（稽核本來就是 admin 看的）。
3. 合併後的推播：逐資源推（與指派一致，但可能上千則）、集合推播，還是只推 `tag` 讓前端依賴圖重抓所有帶標籤的列表？
4. 合併時兩個標籤顏色不同，保留目標的就好，還是讓使用者選？
5. 是否要「拆分」（把一個標籤的部分指派改成另一個）？目前看不到需求，傾向不做。

## 設計決策

## 歸檔去向

完成後預計寫成：

- [`backend/18-tag.md`](../architecture/backend/18-tag.md)：§3 的合併端點與錯誤碼、§5 的連結與搜尋、新增「設計決策：合併與導覽」一節
- [`frontend/18-command-palette.md`](../architecture/frontend/18-command-palette.md) §4 的登記清單加上標籤
