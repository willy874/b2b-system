# 版本歷史與軟刪除

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

遊戲內容編輯器幾乎一定會被要求「還原到上一版」「救回誤刪的東西」。
現在有兩個相近但不適用的機制：

- 稽核日誌記了前後差異，但它是給稽核用的：不可變、會封存到冷表、權限是 `auditLog:read`
- 檔案改名有樂觀鎖，但只在檔案模組內

**這個模式要在第一個編輯器功能開工前定好**，否則每個功能各做一套。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 通用的 `revisions` 模式：實體類型、id、版本號、快照 | 分支與合併 |
| 通用的樂觀鎖（`version` 欄位 ＋ `If-Match` 或 DTO 帶版本） | 多人即時共同編輯（CRDT） |
| 軟刪除 ＋ 回收桶頁面 ＋ 到期永久刪除 | |
| 前端的版本列表與差異檢視（沿用 `JsonDiff`） | |

## 初步構想

- 實體選擇性加入：repository 用一個 helper 寫入快照，不強迫所有表都有版本
- 快照在業務交易內寫入（和稽核同一條規則）
- 軟刪除：`deleted_at` ＋ 預設查詢排除；唯一索引要改成 partial index
- 永久刪除走排程（依賴 [`job-queue.md`](./job-queue.md)）

## 開放問題

1. 快照存整份，還是存差異？編輯器的資料可能很大
2. 軟刪除與既有的 cascade（例如刪除角色）怎麼共存？
3. 還原時若參照的東西已經不存在（例如資料夾被刪），怎麼處理？

## 歸檔去向

- `docs/adr/NNNN-entity-revisions.md`
- `docs/architecture/backend/02-database.md`（慣例章節）、`conventions/03-backend.md`
