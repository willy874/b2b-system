# 標籤、留言、關注

- 優先度：P2
- 狀態：提案
- 依賴：[`notification-center.md`](./notification-center.md)（留言、@提及、關注都要通知）
- 相關：[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

內容編輯器上的每一種資源（關卡、素材、腳本）都會需要分類、討論、關注變更。
若每個功能各做一套，資料表與 UI 都會重複。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 多型關聯：`target_type ＋ target_id` 掛在任何實體上 | 留言的富文本編輯器（先純文字 ＋ @提及） |
| 標籤：建立、指派、依標籤篩選 | 標籤階層 |
| 留言：新增、編輯、刪除、@提及 | |
| 關注：關注實體，實體變更時收到通知 | |
| 前端通用元件：`features/<name>/components` 可以直接嵌入 | |

## 初步構想

- 權限跟著目標實體走：看得到目標才看得到留言；由目標的模組提供「能不能看」的判斷
- 模組註冊 `target_type`，`modules/comment` 不 import 其他模組
- 標籤屬於租戶：租戶 DB 已天然隔離（[`../architecture/05-tenancy.md`](../architecture/05-tenancy.md)）

## 開放問題

1. 多型關聯沒有外鍵，目標刪除時怎麼清理？（事件訂閱或排程掃描）
2. 資源授權（`resource_grants`）要不要也泛化成同一個多型模式？

## 歸檔去向

- `docs/architecture/backend/NN-tag-comment.md`、前端對應章節
