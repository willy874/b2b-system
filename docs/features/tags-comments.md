# 標籤、留言、關注

- 優先度：P2
- 狀態：提案
- 依賴：站內通知（已完成，[`backend/15-notification.md`](../architecture/backend/15-notification.md)；留言、@提及、關注都要通知）
- 相關：[ADR-0025](../adr/0025-entity-revisions.md) D7（多型關聯的命名）、[`backend/13-trash.md`](../architecture/backend/13-trash.md)（刪除、還原與永久刪除）、[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

業務功能的每一種資源（文件、訂單、素材；現在只有檔案與資料夾）都會需要分類、討論、關注變更。
若每個功能各做一套，資料表與 UI 都會重複。

可以參考的既有模式：

- **資源授權已經是多型關聯**：權限圖 G3a 起存在 `relation_tuples`（`object_type` ＋ `object_id`，都是 text、無外鍵；
  舊的 `resource_grants` 用 Postgres enum `resource_type`，已在 G3b 刪除）。關係圖引擎（`core/authz`）是通用的，
  擁有者模組（`modules/file`）在模型裡宣告型別、提供結構邊與授權的讀寫、API（[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md) §10.1）。
- **模組把 handler 註冊進通用模組**：審批（`approvals.registerHandler`）、背景工作、系統設定都是這樣，通用模組不 import 業務模組。
- **前端的 feature 不能互相 import 元件**：共用 UI 要放 `components/`、`core/`，或經註冊表注入（[`conventions/07-layer-dependencies.md`](../conventions/07-layer-dependencies.md) §2.2）。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 多型關聯：`resource_type ＋ resource_id`（與稽核同一組命名） | 留言的富文本編輯器（先純文字 ＋ @提及） |
| 標籤：租戶內的標籤定義、指派、依標籤篩選 | 標籤階層 |
| 留言：新增、編輯、刪除、@提及 | 留言的附件 |
| 關注：關注資源，資源變更或有新留言時收到通知 | |
| 擁有者模組註冊資源類型與「能不能看／改」的判斷 | |
| 前端：留言面板、標籤選擇器放 `core/` 或 `components/`，feature 在自己的詳情頁嵌入 | |

## 初步構想

### 資料模型（租戶 DB）

```
tags            id, name, color(token 名稱), created_by, deleted_at   unique(lower(name)) where deleted_at is null
resource_tags   resource_type, resource_id, tag_id                     pk(resource_type, resource_id, tag_id)
comments        id, resource_type, resource_id, author_id, body, mentions uuid[], edited_at, deleted_at, created_at
watches         resource_type, resource_id, user_id, created_at        pk(resource_type, resource_id, user_id)
```

- `resource_type` 用 text ＋ 程式常數（見開放問題 2）。
- 標籤顏色存 Design Token 的名稱，不存色碼（前端規則 6）。

### 後端

- `modules/tag`、`modules/comment`、`modules/watch`（或合成一個 `modules/collaboration`），都不 import 業務模組。
- 擁有者模組在 `onModuleInit` 註冊資源類型：
  ```ts
  collaboration.registerResource({
    type: 'fileFolder',
    canView: (actor, ids) => ...,   // 批次判斷，列表用
    canEdit: (actor, id) => ...,
    describe: (ids) => ...,         // 通知用的名稱快照
  });
  ```
  權限跟著目標走：看得到目標才看得到留言與標籤；能改目標才能改標籤。留言本身再加「只有作者能改、刪」。
- 通知：@提及、關注的資源有新留言時，在同一個交易內呼叫通知模組（`NotificationService.notify()`，[`backend/15-notification.md`](../architecture/backend/15-notification.md) §3、§9）。
  關注的資源 **被修改** 時的通知由擁有者模組在自己的交易內觸發，不靠 `resource.changed`（事件不保證送達）。
- 推播：新增 `ChangeSource.comment`，受眾是「看得到目標的人」，由擁有者模組決定（和 `fileFolder` 的受眾一樣）。
- 目標被刪除：現在都是軟刪除，目標消失的情況很少；標籤、留言、關注保留，查詢時跟著目標的可見性過濾。
  永久刪除（[`backend/13-trash.md`](../architecture/backend/13-trash.md) 的 `trash.purge`，擁有者模組的 `TrashHandler.purge`）時由擁有者模組呼叫清理。

### 權限

- `tag:create`、`tag:update`、`tag:delete`（管理標籤定義）；指派標籤跟著目標的編輯權限
- 留言、關注：跟著目標的可見性，不另外開權限鍵

## 開放問題

1. 留言、標籤的權限都跟著目標，那目標模組的「能不能看」要多便宜？列表頁要一次判斷上百個目標，需要批次介面。
2. `resource_type` 要用 Postgres enum 還是 text（`relation_tuples`、稽核都是 text；舊的 `resource_grants` 是 enum）？enum 有資料庫層的保護，但每加一種資源就要一個 migration。
   這個決定也適用於版本歷史的 `revisions`（[`backend/14-revisions.md`](../architecture/backend/14-revisions.md)）。

   **結論**：text ＋ 程式常數（[ADR-0025](../adr/0025-entity-revisions.md) D7；[`backend/02-database.md`](../architecture/backend/02-database.md) §1 的例外）。
3. 標籤要全租戶共用一組，還是依資源類型分開？
4. 第一個接上的資源是檔案與資料夾嗎？還是等第一個業務資源？

## 歸檔去向

- `docs/architecture/backend/NN-collaboration.md`、`docs/architecture/frontend/` 對應章節
- `docs/rbac/02-permission-catalog.md`
