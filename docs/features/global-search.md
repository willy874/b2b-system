# 全域搜尋（⌘K）

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §6、[`frontend/06-permission.md`](../architecture/frontend/06-permission.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

功能變多之後，靠側邊選單找頁面、找資源會越來越慢。命令面板可以同時「跳到頁面」「找資料」「執行動作」。

現況：

- **選單是靜態的**：`app/layouts/SidebarNav.tsx` 的 `TOP_ITEMS`／`MENU_GROUPS` 陣列直接列出每個 feature 的 page key、`menu.*` 文案與圖示，
  依 `usePageAccessChecker` 過濾。頁面權限註冊表（`registerPagePermission`）只有規則與 route，**沒有名稱與圖示**。
- **沒有全域快捷鍵機制**：現有的 keydown 都是元件內的（檔案燈箱、檔案瀏覽器的全選、`Select`）。
- **後端搜尋只有各列表的 `keyword`**：使用者、角色、檔案、審批、租戶都是 `ILIKE`（`core/database/like.ts` 負責跳脫）；
  `pg_trgm` 已啟用，`files.name`、`users` 的 email／username／displayName 已有 trigram 索引。沒有彙整的搜尋端點。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| ⌘K 命令面板：頁面、最近造訪、資料、動作 | 全文檢索引擎（Elasticsearch 等） |
| 導覽註冊表：feature 在 plugin 同步階段註冊頁面的名稱與圖示，側邊選單與命令面板共用 | 附件內容搜尋 |
| 搜尋提供者註冊表：feature 註冊資料搜尋與動作 | 跨租戶搜尋 |
| 結果依權限過濾（頁面用權限註冊表；資料由後端過濾） | |
| 全域快捷鍵的最小機制（註冊、衝突偵測、輸入框內不觸發） | |

## 初步構想

### 前端

- **導覽註冊表**：把 `SidebarNav.tsx` 的靜態陣列改成 `registerNavItem({ pageKey, labelI18nKey, icon, group, order })`，
  在各 feature 的 `plugin.ts` 同步階段註冊（和 `registerPagePermission`、`registerHeaderTool` 同一種做法）。側邊選單與命令面板都讀它。
- **搜尋提供者**：`registerSearchProvider({ key, labelI18nKey, search: (q, signal) => Promise<Result[]> })`，
  各 feature 用自己的 `apis/` 實作。結果項目帶 route 物件，面板不 import feature。
- **動作**：`registerCommand({ key, labelI18nKey, pageKey?, run })`，`pageKey` 用來依權限隱藏。
- **最近造訪**：只存 route 的路徑與 page key（不存資料名稱等伺服器資料的複本），放 `createDictStorage`；
  顯示名稱時從導覽註冊表查（[`frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §4.2 不允許存伺服器資料與個資）。
- 面板用 `Dialog` ＋ `Select` 的 `searchable` 列表（虛擬捲動、`aria-activedescendant`），放 `core/command-palette/`。

### 後端

- 先 **不做彙整端點**：前端並行呼叫各 feature 的搜尋提供者，每個提供者用既有的列表 API 加 `keyword` 與小 `limit`。
- 資料量大或需要跨模組排序時，再考慮 `GET /search`（各模組註冊 searcher），見開放問題 1。

## 開放問題

1. 後端搜尋是一支彙整 API，還是前端並行呼叫各模組的列表 API？後者不必動後端，但每打一個字會發 N 個請求（要 debounce 與取消）。
2. 最近造訪要存前端還是後端？存前端就不跨裝置（可以用 `channel.relay` 同步，和偏好設定一樣）。
3. 把側邊選單改成註冊表要不要獨立先做？它本身就是 `02-plugin-system.md` §6 的註冊表模式，也讓選單不必改 `app/`。

## 歸檔去向

- `docs/architecture/frontend/NN-command-palette.md`
- `docs/architecture/frontend/02-plugin-system.md` §6（導覽註冊表）
