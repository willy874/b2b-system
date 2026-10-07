# 儲存的檢視（列表的篩選、排序、欄位組合）

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §6.1（RichTable 的偏好）、`web-core/store/tableColumnSettings`、[`custom-fields.md`](./custom-fields.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

RichTable 的欄位順序、顯示與釘選已經依 `tableId` 存在偏好裡（`web-core/store/tableColumnSettings`，**只存 localStorage**，[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §6.1）。
但篩選條件與排序不會被記住，也不能存成多組、不能分享給同事、換裝置就不見。

業務功能上線後，「我負責的待處理訂單」「本月到期的合約」這種常用的組合每天都要重新點一次。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 把目前的篩選、排序、欄位組合存成具名的檢視，每張表多組 | 依檢視訂閱通知、排程寄送 |
| 個人檢視（存在伺服器、跨裝置）與共享檢視（整個租戶看得到） | 分享給特定人或群組 |
| 設定預設檢視；檢視的網址可以複製給同事 | 檢視的權限之外的資料遮蔽 |
| 所有 RichTable 都可用，feature 不必另外寫 | |

## 使用者故事

**作為客服主管，我希望把「未處理、指派給我組」的篩選存成檢視並分享，以便組員一點就到。**

- **Given** 我在使用者列表設定了篩選與排序
- **When** 我選「另存為共享檢視」並命名
- **Then** 組員在同一張表的檢視選單看到它；套用後的資料仍依各自的權限過濾

## 初步構想

- 資料模型（租戶 DB）：`saved_views`：`id`、`table_id`、`name`、`owner_id`、`shared`、`state`（jsonb：篩選、排序、欄位）、`version`、`deleted_at`。
- 後端：`modules/saved-view`（小型 CRUD）；`state` 由前端定義格式，後端只限制大小。
- 前端：`web-core` 的 RichTable 工具列加檢視選單；網址同步（`?view=<id>`）；欄位設定改成「目前檢視的一部分」，與現在的 localStorage 偏好的關係見開放問題 1。
- 權限：個人檢視只要登入；共享檢視的建立與修改要 `savedView:share`（或沿用該表所屬資源的 update 權限，見開放問題 2）。
- 稽核：只記共享檢視的增刪改。

## 開放問題

1. 現在 localStorage 的欄位偏好要遷移到伺服器嗎？還是「沒有選檢視時」維持本機偏好？
2. 共享檢視的權限：獨立權限鍵，還是每張表依資源決定？
3. `state` 的篩選格式在 feature 改版時可能失效（欄位被移除），套用時怎麼降級？
4. 兩個前端（backstage、apps/platform）都要嗎？apps/platform 是平台 DB，要另一張表。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/frontend/07-ui-system.md`（RichTable 章節）
- 後端：`docs/architecture/backend/` 的小節或併入設定類文件
