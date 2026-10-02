# 留言、關注

- 優先度：P2
- 狀態：提案
- 依賴：站內通知（已完成，[`backend/15-notification.md`](../architecture/backend/15-notification.md)；留言、@提及、關注都要通知）
- 相關：[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §9.2 D7（多型關聯的命名）、[`backend/18-tag.md`](../architecture/backend/18-tag.md) §7（標籤：同一種「擁有者登記資源類型」的做法）、
  [`backend/13-trash.md`](../architecture/backend/13-trash.md)（刪除、還原與永久刪除）、[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。
> 原本的提案是「標籤、留言、關注」；標籤已於 2026-10-02 完成並歸檔（[`backend/18-tag.md`](../architecture/backend/18-tag.md) §7），這份只剩留言與關注。

## 背景

業務功能的每一種資源（文件、訂單、素材；現在是檔案、資料夾、使用者）都會需要討論與關注變更。若每個功能各做一套，資料表與 UI 都會重複。

可以沿用的既有模式：

- **標籤**（[`backend/18-tag.md`](../architecture/backend/18-tag.md) §7）：擁有者模組在 `onModuleInit` 向通用模組登記資源類型與「能不能改」的 resolver；讀取嵌在擁有者的回應裡；
  永久刪除時擁有者在 `TrashHandler.purge` 清掉多型關聯。留言與關注可以照同一個形狀做。
- **前端的 feature 不能互相 import 元件**：共用 UI 放 `core/components`（例：`TagAssignDialog`），資料由 feature 以 props 傳入。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 留言：新增、編輯、刪除、@提及 | 留言的富文本編輯器（先純文字 ＋ @提及）、留言的附件 |
| 關注：關注資源，資源變更或有新留言時收到通知 | |
| 擁有者模組登記資源類型與「能不能看／改」的判斷 | |
| 前端：留言面板放 `core/components`，feature 在自己的詳情嵌入 | |

## 初步構想

### 資料模型（租戶 DB）

```
comments   id, resource_type, resource_id, author_id, body, mentions uuid[], edited_at, deleted_at, created_at
watches    resource_type, resource_id, user_id, created_at        pk(resource_type, resource_id, user_id)
```

### 後端

- `modules/comment`、`modules/watch`（或合成 `modules/collaboration`），不 import 業務模組。
- 留言列表不同於標籤：一個資源可能有很多則、要分頁，**需要一支通用的讀取端點**，因此擁有者要提供「能不能看」的判斷（標籤不需要，因為嵌在擁有者的列表裡）。
- 權限跟著目標：看得到目標才看得到留言；留言本身只有作者能改、刪。
- 通知：@提及、關注的資源有新留言時，在同一個交易內呼叫 `NotificationService.notify()`。關注的資源 **被修改** 時的通知由擁有者在自己的交易內觸發，不靠 `resource.changed`（不保證送達）。
- 推播：新增 `ChangeSource.comment`，受眾是「看得到目標的人」，由擁有者決定。

## 開放問題

1. 通用的讀取端點要擁有者提供 `canView(actor, id)`；列表上要顯示「留言數」時需要批次版本，要多便宜？
2. `resource_type` 用 text ＋ 程式常數（已由 [`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §9.2 D7 決定）。
3. 第一個接上的資源是檔案嗎？檔案管理器沒有詳情頁，留言面板要放在 LightBox 的資訊欄。
4. 關注要不要自動加入（例：留言的人、被 @ 的人自動關注）？

## 歸檔去向

- `docs/architecture/backend/NN-comment.md`、`docs/architecture/frontend/` 對應章節
