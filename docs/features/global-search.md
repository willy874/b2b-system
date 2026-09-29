# 全域搜尋（⌘K）

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`frontend/06-permission.md`](../architecture/frontend/06-permission.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

功能變多之後，靠側邊選單找頁面、找資源會越來越慢。命令面板同時可以放「跳到頁面」與「執行動作」。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| ⌘K 命令面板：頁面、最近造訪、動作 | 全文檢索引擎（Elasticsearch 等） |
| feature 在 plugin 註冊搜尋提供者 | 附件內容搜尋 |
| 結果依權限過濾（前端註冊表 ＋ 後端查詢） | |
| 後端搜尋 API：各模組提供自己的搜尋 | |

## 初步構想

- 註冊方式與頁面權限註冊表相同：plugin 的同步階段註冊
- 頁面項目直接取自 route 與權限註冊表，不另外維護
- 後端先用 Postgres `pg_trgm`；資料量大再評估

## 開放問題

1. 後端搜尋是一支彙整 API，還是前端並行呼叫各模組的搜尋？
2. 最近造訪存在前端（`localStorage`）還是後端？

## 歸檔去向

- `docs/architecture/frontend/NN-command-palette.md`
