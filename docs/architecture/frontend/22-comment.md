# 前端 22 — 留言與關注

資源頁上的「留言」面板：關注、留言、@提及、編輯與刪除。後端、權限與決策見 [`../backend/24-comment.md`](../backend/24-comment.md)。

---

## 1. 組成

```
apis/comment/                        get-comment-list（無限捲動）、create-comment、update-comment、delete-comment、get-mentionable-users、types.ts
apis/watch/                          get-watch-state、watch-resource、unwatch-resource
core/resource-panel/                 資源頁的面板註冊表 ＋ <ResourcePanels>（§2）
features/comment/
├── constants.ts                     COMMENTABLE_RESOURCE_TYPES（後端已登記的資源類型）
├── panel.ts                         registerCommentPanel()：以 lazy() 登記面板
├── plugin.ts                        同步階段登記面板；onInit 登記語系包
├── hooks/                           useComments、useCommentMutations、useWatch、useMentionableUsers
├── components/                      CommentPanel、CommentItem、CommentEditor、WatchButton
└── routes/index.ts                  空的（沒有自己的頁面，§4）
```

---

## 2. 資源頁的面板（`core/resource-panel`）

留言面板要出現在別的 feature 的頁面上，但 feature 之間不能互相 import（[`03-feature-anatomy.md`](./03-feature-anatomy.md) §4）。
做法與偏好頁的分頁相同（[`02-plugin-system.md`](./02-plugin-system.md) §4.3）：

- 提供面板的 feature 在 plugin 的 **同步** 階段 `registerResourcePanel({ id, order, resourceTypes, Panel, localeScope })`；
  `Panel` 以 `lazy()` 登記，本體不進首屏。
- 擁有資源的頁面放 `<ResourcePanels resourceType="user" resourceId={userId} />`：依 `order` 列出適用於這個資源類型的面板，
  每個各包一層 `<Suspense>`（下載中顯示骨架），並在掛上時載入面板的語系 scope。
- 註冊表可訂閱：feature 在執行期安裝或卸載時，面板跟著出現或消失。沒有任何面板時不渲染東西。

| 頁面 | 位置 | 面板 |
| --- | --- | --- |
| 使用者詳情（`features/user`，`UserDetailPage`） | 對話框最下方 | 留言（`comment`，order 100） |

---

## 3. 留言面板

| 區塊 | 行為 |
| --- | --- |
| 標題列 | 「留言」＋ 關注鈕（`comment-watch-button`，`data-value` 是 `watching`／`idle`；滑過顯示關注人數）。按下切換關注 |
| 編輯器（`comment-editor`） | `textarea`（`comment-editor-body`，⌘／Ctrl + Enter 送出）＋「提及的人」多選（`comment-editor-mentions`）：可搜尋，候選由後端過濾成看得到資源的人；已選的人一直留在選項裡。空白不能送出。失敗時錯誤顯示在編輯器（`FormError`，`data-value` 是錯誤碼），內容保留；成功後清空 |
| 列表（`comment-list`） | 新的在前；每則（`comment-item`，`data-value` 是留言 id）顯示作者、相對時間（滑過顯示完整時間）、「已編輯」、內文（保留換行）、被提及的人（`@名稱`）。作者被永久刪除時顯示「已刪除的使用者」 |
| 操作選單（`comment-actions`） | 後端的 `canEdit`：編輯（在原地換成編輯器，帶 `version` 送出）；`canDelete`：刪除（先確認，`comment-delete-confirm`）。兩者都沒有就不顯示 |
| 載入更多（`comment-load-more`） | 還有較舊的留言時出現（keyset 游標） |

- 權限不在前端判斷：讀不到時後端回 403／404，面板顯示錯誤（`QueryError`）；能不能改、能不能刪是每則留言的 `canEdit`／`canDelete`。
- 快取：留言與關注都由推播與依賴圖更新（[`../backend/24-comment.md`](../backend/24-comment.md) §5）。新增、編輯、刪除後宣告 `Resource.COMMENT`，
  關注後宣告 `Resource.WATCH`；版本衝突時讓列表重抓，訊息交給編輯器。

---

## 4. 設計決策

| # | 決定 | 理由 |
| --- | --- | --- |
| F1 | 面板經 `core/resource-panel` 的註冊表掛到資源頁，不放成 `core/components` 的呈現元件 | 呈現元件要每個擁有者 feature 各自包一組 hooks（列表、新增、編輯、刪除、關注、候選）；註冊表讓 `features/comment` 擁有全部的資料存取，擁有者只放一個位置 |
| F2 | `features/comment` 沒有自己的頁面，`routes/index.ts` 是空的，仍匯出 `Routes` | 照 feature 的形狀（[`03-feature-anatomy.md`](./03-feature-anatomy.md) §2.1）；之後要做「我關注的項目」時頁面放這裡 |
| F3 | 提及用多選的選擇器，不做 `textarea` 裡游標位置的 `@` 自動完成 | 後端的提及是明確的清單（[`../backend/24-comment.md`](../backend/24-comment.md) §8.2 D6）；選擇器沿用 `Select` 的搜尋、鍵盤操作與無障礙行為 |
| F4 | 留言的 query 用 collection 失效（不以資源 id 精準失效） | 推播的 `id` 是留言 id，畫面上同時開著的留言列表通常只有一個；整批重抓已載入的頁數就夠了 |
