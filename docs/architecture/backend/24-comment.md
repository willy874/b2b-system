# 24 — 留言與關注

資源上的討論（留言、@提及）與「這個東西有變化時通知我」（關注）。決定與理由見 §8；前端的面板見 [`../frontend/22-comment.md`](../frontend/22-comment.md)。
做法與標籤相同（[`18-tag.md`](./18-tag.md)）：通用模組不認識業務，擁有者登記資源類型與「看不看得到」的判斷。

```
擁有者模組（user）
  ├─ onModuleInit：comments.registerResource({ resourceType, changeSource, feature?, resolveViewable, describe, filterViewers })
  ├─ 修改資源的業務交易內：watches.resourceChanged({ resourceType, resourceId, actorId }, tx)
  │                         └─ 有人關注 → 入列 watch.notify（outbox；同一個資源 60 秒內一次）
  └─ 永久刪除：TrashHandler.purge 內 comments.removeAllFor(resourceType, ids, tx)

GET／POST /comments/:resourceType/:resourceId、PATCH／DELETE /comments/:id、PUT／DELETE /watches/:resourceType/:resourceId
  └─ CommentService／WatchService → resolveViewable（擁有者判斷）→ 交易內寫入 ＋ 通知 → 交易後推播
```

---

## 1. 可以留言的資源

| 資源類型 | 看得到（讀留言、留言、關注） | 通知的名稱與連結 | 推播的 `refs` | 登記者 |
| --- | --- | --- | --- | --- |
| `user`（不含服務帳號） | `user:read` | 顯示名稱；`user.detail`（`{ userId }`） | `user` | `UserCommentResource` |
| `galleryItem` | `gallery:read`（整個圖片庫對它可見，[`26-gallery.md`](./26-gallery.md) D4）；處理完、沒刪除的圖 | 標題；`gallery.item`（`{ itemId }`，檢視器） | `galleryItem` | `GalleryCommentResource` |
| `approval` | 請求層級的可見性（[`20-approval.md`](./20-approval.md) §9.10：`approval:read`、申請人、任一關的候選人）；定案後照常可以留言 | handler 的 `summarize`；`approval.myDetail`（`{ approvalId }`） | `approval` | `ApprovalCommentResource` |

- 看不到或不存在的資源由擁有者回自己的錯誤（`USER_NOT_FOUND`、`403 AUTHZ_FORBIDDEN`；審批一律 `404 APPROVAL_NOT_FOUND`，不透露請求存在）。端點只宣告 `@Authenticated()`，所以權限鍵的判斷一律經
  `PermissionService.assertHasAll`（帶 `{ route, metadata }`），拒絕寫 `authz.denied`。
- **編輯** 只有作者本人；**刪除** 是作者本人，或持有 `comment:delete`（刪別人的留言，管理用；[`iam/02-permission-catalog.md`](../iam/02-permission-catalog.md) §2.20）。
  兩者都還要看得到資源。
- 所屬 feature 沒啟用時端點回 `404 FEATURE_DISABLED`、關注的通知不送；資料保留。`user`、`approval` 不屬於可關閉的 feature；`galleryItem` 屬於 `gallery`。

### 1.1 加入一種可以留言的資源

1. 擁有者模組 `imports` 加 `CommentModule`；新增 `<name>-comment.resource.ts`（`OnModuleInit`）呼叫 `CommentService.registerResource()`：
   `resolveViewable`（有操作者，拒絕要寫稽核）、`describe`（背景工作用，已不存在回 `undefined`）、`filterViewers`（批次判斷一群人看不看得到，
   提及的候選與通知的收件人都經過它）。
2. 會改變資源內容的寫入，在業務交易內（稽核之後）呼叫 `WatchService.resourceChanged()`；沒有實際改變時不呼叫。
3. `TrashHandler.purge` 在同一個交易內呼叫 `CommentService.removeAllFor()`（留言與關注一起清）。
4. 前端：`apis/comment/types.ts` 的 `CommentableResourceType`、`features/comment/constants.ts` 的 `COMMENTABLE_RESOURCE_TYPES`、
   擁有者的頁面放 `<ResourcePanels resourceType="…" resourceId={…} />`（[`../frontend/22-comment.md`](../frontend/22-comment.md) §2）；
   通知句子的資源名詞（`features/notification/constants.ts` 的 `RESOURCE_TYPE_LABEL_KEY`）。

---

## 2. 資料表（租戶 DB，migration `0048_comments`）

| 表 | 欄位 | 約束與索引 |
| --- | --- | --- |
| `comments` | `id`、`resource_type`、`resource_id`、`author_id`（→ `users` `SET NULL`）、`body`、`mentions uuid[]`、`version`、`edited_at`、`created_at` | 索引 `(resource_type, resource_id, created_at, id)`（列表的 keyset、清理）、`(author_id)`（永久刪除使用者時的 `SET NULL`） |
| `watches` | `resource_type`、`resource_id`、`user_id`（→ `users` CASCADE）、`created_at` | PK `(resource_type, resource_id, user_id)`；索引 `(user_id)` |

- 兩張表都沒有指向資源的外鍵（多型，[`14-revisions.md`](./14-revisions.md) §9.2 D7）。資源軟刪除時保留，還原後跟著回來；永久刪除時由擁有者清掉。
- 刪除留言是硬刪除（D5），沒有 `deleted_at`，不經 `notDeleted()`。
- `mentions` 沒有外鍵：被永久刪除的人讀取時自然不出現在 `mentions`。
- 同一支 migration 補上既有租戶 admin 的 `comment:delete`（與 0044 同一個做法）。

---

## 3. API

### 3.1 留言

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/comments/:resourceType/:resourceId?limit=&cursor=` | 登入 ＋ 看得到資源 | 新的在前；keyset 分頁（`limit` 1～100，預設 20），回 `{ items, nextCursor }`，不計總數 |
| POST | `/comments/:resourceType/:resourceId` | 登入 ＋ 看得到資源 | `{ body, mentionIds? }`；作者自動關注（D8）；回 `201` 一則留言 |
| GET | `/comments/:resourceType/:resourceId/mentionable?q=` | 登入 ＋ 看得到資源 | @提及的候選：顯示名稱或 email 包含 `q`、active 的一般使用者，再交給 `filterViewers`（最多 10 位） |
| PATCH | `/comments/:id` | 作者本人 ＋ 看得到資源 | `{ body, mentionIds?, version }`；`edited_at` 更新、`version` 遞增 |
| DELETE | `/comments/:id` | 作者本人，或 `comment:delete` ＋ 看得到資源 | 硬刪除，`204`；刪別人的寫稽核 `comment.delete` |

一則留言：`{ id, resourceType, resourceId, body, author, mentions, version, createdAt, editedAt, canEdit, canDelete }`。
`author`／`mentions` 是 `{ id, displayName, email }`（作者被永久刪除時 `author` 是 null）；`canEdit`／`canDelete` 是後端依目前的使用者算好的，
前端不自己判斷權限。

- `body`：去掉前後空白後 1～4000 字，純文字。`mentionIds` 最多 20 個、不可重複。
- 提及的人必須是 active 的一般使用者、而且看得到資源，否則 `422 COMMENT_MENTION_INVALID`（`details.userIds`）。
  編輯時只檢查 **新加入** 的人：原本提及的人之後停用或失去權限，不該讓作者改不了錯字。
- 游標同通知（`core/http` 的 `TimeIdCursor`：資料庫格式化的微秒時間 ＋ id）；格式不對回 `400 VALIDATION_FAILED`（`details.field: 'cursor'`）。

### 3.2 關注

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/watches/:resourceType/:resourceId` | 登入 ＋ 看得到資源 | `{ watching, watcherCount }` |
| PUT | `/watches/:resourceType/:resourceId` | 登入 ＋ 看得到資源 | 關注（已在關注時不變）；回同上 |
| DELETE | `/watches/:resourceType/:resourceId` | 登入 | 取消關注；**不** 檢查看不看得到，失去權限的人也能拿掉；回同上 |

### 3.3 錯誤碼

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `COMMENT_NOT_FOUND` | 404 | 留言不存在（含並行刪除） |
| `COMMENT_VERSION_CONFLICT` | 409 | `version` 不是目前的版本（`details.current`） |
| `COMMENT_RESOURCE_TYPE_UNKNOWN` | 404 | 資源類型沒有登記 |
| `COMMENT_MENTION_INVALID` | 422 | 提及的人不能被提及或看不到資源（`details.userIds`） |

不是作者卻要編輯：`403 AUTHZ_FORBIDDEN`（`details.reason: 'notAuthor'`），並寫 `authz.denied`。

---

## 4. 通知

| 類型 | 收件人 | `params` | 寫入點 |
| --- | --- | --- | --- |
| `comment.mentioned` | 被提及的人（看得到資源，不含作者自己） | `resourceType`、`resourceName`、`excerpt`（前 100 字） | 留言、編輯（只有新加入的人）的交易內 |
| `comment.created` | 關注者：看得到資源、不含作者、不含這則留言已經提及的人 | 同上 | 留言的交易內 |
| `watch.resourceUpdated` | 關注者：看得到資源、不含修改的人 | `resourceType`、`resourceName` | 背景工作 `watch.notify`（擁有者在業務交易內 `resourceChanged()` 入列） |

- 連結是擁有者給的 route id（使用者是 `user.detail`）。分類 `comment`（事件管理頁的「留言與關注」），只有站內通知管道。
- 收件人在交易之前算好（`filterViewers`），是快照：之後權限變動不補發也不收回（[`15-notification.md`](./15-notification.md) §3.2）。
- `watch.notify`：同一個資源 **60 秒內只入列一次**（`throttle`），連續修改只通知第一次；通知的名稱在工作執行時才讀，是修改後的名稱。
  沒有人關注時不入列。資源已不存在（含軟刪除）、資源類型沒登記或 feature 沒啟用時略過（`output.skipped`）。
- 使用者的寫入點：`UserService.updateInTx`（有任何欄位改變；匯入的套用也走這裡）、`replaceRolesInTx`（角色有增減）。

---

## 5. 推播

| 時機 | payload | 受眾 |
| --- | --- | --- |
| 新增、編輯、刪除留言 | `{ resource: 'comment', kind, id: <留言 id>, refs: { <擁有者的來源>: [<資源 id>] } }` | 沿用 `refs` 裡那個來源的受眾（使用者：`user:read`、`role:read`）；不讓稽核的讀者重抓 |
| 關注、取消關注（含留言時自動關注） | `{ resource: 'watch', kind: 'update', id: <資源 id> }` | 只推給本人（`affectedUserIds`） |

前端依賴圖：`comment` 的 collection 是 `COMMENT_LIST_QUERY_KEY`，衍生自 `user` 的 update／delete（嵌入作者與被提及者的名稱）；
`watch` 的 collection 是 `WATCH_STATE_QUERY_KEY`，衍生自 `comment` 的 create（作者自動關注、人數變了）。

---

## 6. 稽核

- `comment.delete`：只有刪 **別人** 的留言（`comment:delete`）才寫；`resource_type` 是 `comment`、`resourceName` 是所在資源的名稱、
  `metadata: { targetType, targetId, authorId }`。不記內文。
- 新增、編輯、刪除自己的留言與關注都不寫稽核（D4）。拒絕照常寫 `authz.denied`。

---

## 7. 測試

| 對象 | 檔案 |
| --- | --- |
| 留言（提及與通知、自動關注、讀取的權限與 `authz.denied`、不認得的類型、提及看不到的人、候選、keyset、只有作者能改、樂觀鎖、刪除的權限與稽核）；關注（看不到不能關注、取消不必看得到、修改時入列並通知）；永久刪除時清理 | `test/comments.spec.ts` |
| 登記、feature、列表的 `canEdit`／`canDelete`、游標、新增的通知收件人、提及驗證、編輯（作者、版本、只通知新加入的人）、刪除（權限、稽核）、候選、清理 | `src/modules/comment/__tests__/comment.service.spec.ts` |
| 關注的端點、`resourceChanged` 的入列與 throttle、`watch.notify` 的收件人與略過 | `src/modules/comment/__tests__/watch.service.spec.ts` |
| 推播受眾（`comment` 沿用 `refs` 的來源、`watch` 只給本人） | `src/modules/realtime/__tests__/realtime.audience.spec.ts` |
| 端點的授權宣告 | `test/route-audit.spec.ts` |
| 前端：面板（列表、空狀態、操作選單、新增與錯誤、提及、編輯、刪除、載入更多、關注）、`useWatch`、`ResourcePanels`、通知的句子 | `features/comment/**/__tests__`、`core/resource-panel/__tests__`、`features/notification/__tests__/adapter.test.ts` |
| E2E：留言並提及 → 作者自動關注 → 被提及的人收到通知、看得到但不能改 → 刪除；關注者收到 `comment.created`、`watch.resourceUpdated`，取消關注後不再收到；作者編輯（已編輯標示）、管理者刪除別人的留言 | `apps/e2e/tests/comment.spec.ts`（[`../frontend/10-testing.md`](../frontend/10-testing.md) §4.1 #26） |

---

## 8. 設計決策：留言與關注

> 原為 `docs/features/` 的提案「留言、關注」（「標籤、留言、關注」的後半；標籤已於 2026-10-02 完成），2026-10-08 實作並歸檔。

### 8.1 背景

業務功能的每一種資源（文件、訂單、素材；現在是使用者）都需要討論與關注變更。若每個功能各做一套，資料表、通知與 UI 都會重複。
標籤已經做出「擁有者登記資源類型、通用模組不認識業務」的形狀（[`18-tag.md`](./18-tag.md) §7），留言與關注照同一個形狀做；
不同的是留言要分頁、要一支通用的讀取端點，所以擁有者必須提供「看不看得到」的判斷。

提案的開放問題與結論：

1. 通用的讀取端點要擁有者提供 `canView`；列表要顯示留言數時要批次版本，要多便宜？
   **結論**：擁有者提供單筆的 `resolveViewable` 與批次的 `filterViewers`（一群人 × 一個資源，用在提及與通知的收件人）。
   這一版 **不** 在擁有者的列表顯示留言數（D12），不需要「一個人 × 多個資源」的批次判斷。
2. `resource_type` 用 text 還是 enum？**結論**：text ＋ 程式常數（[`14-revisions.md`](./14-revisions.md) §9.2 D7，標籤也照做）。
3. 第一個接上的資源是檔案嗎？**結論**：先接 **使用者**（D12）。檔案管理器沒有詳情頁，要先改 LightBox 的資訊欄；用最單純的詳情頁把通用的面板做出來，檔案第二個接。
4. 關注要不要自動加入？**結論**：留言的人自動關注；被 @ 的人只收到提及的通知、不自動關注（D8）。

### 8.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **一個模組 `modules/comment`** 放留言與關注（`CommentService`、`WatchService`、共用的 `CommentResourceRegistry`），表 `comments`、`watches`，權限 resource `comment` | 兩者共用同一份資源登記與「看不看得到」，關注的主要用途是收到新留言；拆成兩個模組會互相依賴 |
| D2 | **擁有者登記資源類型**：`registerResource({ resourceType, changeSource, feature?, resolveViewable, describe, filterViewers })`；通用模組不 import 業務模組 | 與標籤、審批、回收桶同一個模式（[`../../coding-standards/07-layer-dependencies.md`](../../coding-standards/07-layer-dependencies.md) §3.2） |
| D3 | **看得到資源就能讀留言、留言、關注**；不另設 `comment:read`／`comment:create` | 提案的原則「權限跟著目標」；討論是看資源的一部分，另設權限鍵只會讓管理者多一個要記得勾的地方 |
| D4 | **管理權限 `comment:delete`**：刪除別人的留言，預設給 `admin`，寫稽核 `comment.delete`。新增、編輯、刪自己的留言不寫稽核 | 刪別人的發言是管理行為，要留下紀錄；一般的留言數量多、不是安全事件，寫進稽核只會淹沒真正要查的事 |
| D5 | **刪除留言是硬刪除**，不進回收桶，沒有 `deleted_at` | 留言沒有要還原的需求；保留「已刪除」的佔位只在有回覆串時才有意義，這一版沒有回覆串 |
| D6 | **內文是純文字，被提及的人另外列在 `mentions`**（由候選端點挑選、最多 20 位）；不在內文裡放 `<@id>` 這類標記 | 純文字不必解析、不必處理改名；前端以多選的選擇器挑人，比游標位置的自動完成可靠。代價是內文裡的 `@名字` 只是文字 |
| D7 | **提及與通知只給看得到資源的人**：提及看不到的人回 `422`；關注者在送通知時再過濾一次 | 通知的參數帶資源名稱與留言摘要，送給看不到的人等於洩漏內容 |
| D8 | **留言的人自動關注**；被 @ 的人不自動關注 | 與 GitHub、Linear 的慣例一致：參與討論的人想知道後續；被提及一次不代表想追蹤整個資源 |
| D9 | **資源被修改的通知由擁有者在業務交易內宣告**（`resourceChanged()`），以背景工作 `watch.notify` 送出；同一個資源 60 秒內只入列一次 | 不靠 `DomainEventBus`（不保證送達）；入列走 outbox，與資料一起提交或回滾。收件人要逐人判斷權限，放在工作裡不佔用業務交易的時間（匯入的套用每列都會呼叫） |
| D10 | **永久刪除時清理**：擁有者的 `TrashHandler.purge` 在同一個交易內呼叫 `removeAllFor()`；軟刪除保留 | 與標籤相同（[`18-tag.md`](./18-tag.md) §7.2 D9） |
| D11 | **上限**：內文 4000 字、提及 20 人、列表每頁最多 100 則（預設 20） | 一則留言是討論，不是文件；通知的摘要只取前 100 字 |
| D12 | **第一批只接上使用者**；擁有者的列表 **不** 顯示留言數 | 見 §8.1 問題 1、3 |
| D13 | **推播**：留言推 `comment`（`refs` 帶所在的資源，受眾沿用那個來源的規則）；關注推 `watch` 只給本人 | 受眾等於資源的受眾，`realtime.audience.ts` 依 `refs` 的來源查表，不必每種資源各寫一條 |
| D14 | **不是可關閉的 feature**；所屬資源的 feature 沒啟用時端點回 `404 FEATURE_DISABLED` | 與標籤相同（[`18-tag.md`](./18-tag.md) §7.2 D12） |

不做（這一版）：

- 富文本、附件、回覆串（thread）、表情回應、留言的版本歷史。
- 「我關注的項目」列表頁、從通知以外的地方看到自己關注了什麼。
- 寄信管道（只有站內通知）。
- 擁有者列表上的留言數（D12）。

### 8.3 評估過的方案

- **內文裡放提及的標記**（`<@uuid>`，前端渲染成名字）：改名後顯示會跟著變，但編輯時要在純文字與標記之間轉換、游標位置的自動完成在 `textarea` 上不可靠；這一版選擇明確的清單（D6）。
- **訂閱 `resource.changed` 送「被修改」的通知**：不保證送達，也不知道誰改的、改了什麼；改由擁有者宣告（D9）。
- **在業務交易內直接寫「被修改」的通知**：收件人要逐人判斷權限（`getPermissionSets`），會佔用業務交易、交易內還要從連線池另取連線；匯入的套用每列都會呼叫。
- **被 @ 的人自動關注**：見 D8。
- **留言軟刪除、顯示「此留言已刪除」**：見 D5。

### 8.4 實作紀錄

| 項目 | 補充 |
| --- | --- |
| §3.1 | 通知列表的 keyset 游標搬到 `core/http`（`TimeIdCursor`），留言與通知共用；`notification.cursor.ts` 只剩別名 |
| D4 | 不是作者卻要編輯是資源層級的拒絕：`CommentService` 自己寫 `authz.denied`（`reason: 'notAuthor'`），與 `FileAccessService.deny` 同一個形狀 |
| D6 | 編輯時只驗證新加入的提及，見 §3.1 |
| D9 | 測試程序不跑 worker：整合測試確認 `watch.notify` 已入列，再直接呼叫 handler |
| 前端 | 面板經 `core/resource-panel` 的註冊表掛到使用者詳情；`features/comment` 沒有自己的頁面，`Routes` 是空的（[`../frontend/22-comment.md`](../frontend/22-comment.md) §4） |
