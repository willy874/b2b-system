# 通知收件匣與公告追蹤

- 優先度：P2
- 狀態：提案
- 依賴：站內通知（[`backend/15-notification.md`](../architecture/backend/15-notification.md) §6、§13；[`frontend/15-notification.md`](../architecture/frontend/15-notification.md)）；
  事件管理的分類（[`backend/16-notification-event.md`](../architecture/backend/16-notification-event.md)）；公告（[`backend/19-announcement.md`](../architecture/backend/19-announcement.md) §2.3、§3、D4；[`frontend/16-announcement.md`](../architecture/frontend/16-announcement.md)）；
  關注（[`backend/24-comment.md`](../architecture/backend/24-comment.md) §3.2；[`frontend/22-comment.md`](../architecture/frontend/22-comment.md) F2）
- 相關：[`../issues/announcement-source-filter.md`](../issues/announcement-source-filter.md)（通知總覽的 `sourceId` 篩選與規格的落差，先修）；[`list-filters-completion.md`](./list-filters-completion.md)（列表篩選進網址）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

通知中心第一版只解決「收到」；類型一多（審批、公告、留言、@提及、Webhook 停用、匯入匯出…），收件匣與發送端的追蹤都不夠用：

| 位置 | 現況 | 問題 |
| --- | --- | --- |
| `features/notification/pages/NotificationList/page.tsx:54-72` | 分頁只有「全部／未讀」 | 想只看審批或只看 @提及要一路往下捲；後端 `ListNotificationSchema`（`apps/api/src/modules/notification/dto/notification.dto.ts:8-16`）只收 `limit`、`cursor`、`unread` |
| 同一頁的 `NotificationList` | 一條不分段的長列表 | 沒有「今天／昨天／本週／更早」的分段，keyset 分頁捲到很後面才知道已經是上個月 |
| `features/notification/hooks/useDeleteNotification.ts` | 「不確認、不可復原」 | 列尾的刪除鍵與「前往」相鄰，誤按就沒了。後端是直接刪除、不寫稽核，這是刻意的（§13 D2），所以復原只能在前端延遲送出 |
| `features/notification/components/NotificationPreferenceSection.tsx` | 偏好平鋪成一長串 | `GET` 的回應已帶 `category`（`notification-preference.dto.ts:37`），事件管理頁（`pages/NotificationEventList/adapter.ts`）已依分類分組，個人偏好沒有 |
| `features/announcement/pages/AnnouncementDetail/adapter.ts:4-25` | 受眾只顯示「3 位使用者、2 個群組」 | 看不出是哪些人、哪些群組；`AnnouncementAudience` 只有 id |
| `pages/AnnouncementDetail/components/AnnouncementDispatchSection.tsx:88-94` | 每次發送只顯示「已讀 12／40」 | 追不到 **誰還沒讀**；通知總覽有 `sourceId` 的規格但前端沒有入口（見 issue） |
| `features/comment/components/WatchButton.tsx:23` | 關注人數只在按鈕的 `title` | 觸控裝置與螢幕閱讀器看不到 |
| `features/comment/routes/index.ts` | 空的（[`frontend/22-comment.md`](../architecture/frontend/22-comment.md) F2 預留） | 沒有「我關注的項目」，取消關注只能回到每個資源頁；[`backend/24-comment.md`](../architecture/backend/24-comment.md) §8.2「不做（這一版）」列了它 |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 收件匣依類型分類篩選（`category`），篩選進網址 | 全文搜尋通知內容（`params` 是名稱快照，不是內文） |
| 列表依日期分段（今天、昨天、本週、更早），純前端 | 通知彙整（digest）、手機與桌面推送（[`backend/15-notification.md`](../architecture/backend/15-notification.md) §12.3 不做） |
| 刪除一則後 toast「已刪除・復原」，數秒內可撤回 | 把刪除改成軟刪除或寫稽核（§13 D2 刻意直接刪除） |
| 個人偏好依 `category` 分組，與事件管理頁一致 | 改通知的寫入模型或廣播模型（§12.2 D6；[`19-announcement.md`](../architecture/backend/19-announcement.md) §9.2 不做） |
| 公告詳情列出受眾的名稱 | 依屬性的動態受眾、排除名單（19-announcement §9.2 不做） |
| 發送紀錄「未讀的人」清單，可匯出 | 對未讀的人「再提醒一次」（另一次發送即可；開放問題 5） |
| 「我關注的項目」頁、取消關注；關注人數顯示在按鈕上 | 留言的回覆串、表情回應（24-comment §8.2 不做） |

## 使用者故事

**作為一般員工，我希望只看「審批」類的通知，以便早上快速處理待審。**

- **Given** 收件匣有 60 則，其中 8 則是審批
- **When** 我在收件匣選「審批」
- **Then** 網址變成 `/notification?category=approval`，列表只剩那 8 則，依「今天／昨天／更早」分段；重新整理後篩選仍在

**作為公告的發送者，我希望知道誰還沒讀，以便私下提醒他們。**

- **Given** 「資安教育訓練」這次發送已讀 32／40
- **When** 我在發送紀錄點「未讀 8 人」
- **Then** 看到 8 個人的名字與部門；刪掉通知的人另列「已刪除」，不算未讀

**作為員工，我希望看到自己關注了哪些資源並一次取消，以便不再收到不相關的通知。**

## 初步構想

### 1. 收件匣（`features/notification`）

- **後端**：`ListNotificationSchema` 加 `category?: string`；repository 依通知類型的登記（`defineNotification` 的 `category`）展開成 `type IN (…)`，沿用索引
  `(recipient_id, created_at, id)`（同一個收件人的通知量不大，不另加索引；開放問題 2）。未讀數不分類。
- **前端**：`routes/` 的 search 加 `category`；`Tabs` 保留全部／未讀，旁邊加分類的 `Select`（選項來自 `GET /me/notification-preferences` 已有的分類，不另開端點）。
  日期分段在 `NotificationList` 的 adapter 依 `general.defaultTimezone` 計算，分段標題是 sticky header。
- **復原刪除**：`useDeleteNotification` 改成先從快取移除、顯示 `toast` 的「復原」動作，5 秒後才呼叫 `DELETE`；離開頁面或關閉分頁時立即送出（`pagehide`）。
  後端不變。批次刪除（全域批次佇列，§13 D3）照舊不提供復原，只在確認框說明。
- **偏好分組**：`NotificationPreferenceSection` 沿用事件管理頁 adapter 的分組函式（搬到 `features/notification/adapter.ts` 共用，同一個 feature 內）。

### 2. 公告追蹤（`features/announcement`、`modules/announcement`）

- `GET /announcements/:id` 的回應加 `audienceRefs: { users: [{ id, name }], groups: […], roles: […] }`：由 `AnnouncementService` 經 user／group／role 的 service 取名稱；
  已刪除的顯示「（已刪除）」。前端改用名稱的 Chip，超過 10 個收合。
- `GET /announcements/:id/dispatches/:dispatchId/recipients?read=false&offset=&limit=`（`announcement:read`）：以 `notifications.source_id` 查（D4 的部分唯一索引），
  回 `{ user: { id, name }, readAt }`。受眾快照與通知的差集是「已刪除通知或被清理」，另以 `deleted: true` 列出（只在發送紀錄保留期內算得出來；開放問題 4）。
- 發送紀錄的已讀欄改成可點，開對話框；「匯出 CSV」接匯入匯出的資源登記（[`backend/22-data-transfer.md`](../architecture/backend/22-data-transfer.md)）或先做前端產生（開放問題 6）。

### 3. 我關注的項目（`features/comment`、`modules/comment`）

- `GET /watches?resourceType=&cursor=`（登入）：自己關注的資源，經擁有者登記的解析器取名稱與 route id；看不到的資源（失去權限）照樣列出、只顯示類型與「無法存取」，讓人能取消。
- 頁面放 `features/comment/pages/WatchList`，入口在頂列帳號選單（`placement: 'account'`，與「我的匯入匯出」相同）。
- `WatchButton` 顯示「關注中・5」，數字獨立成 `aria-label` 的一部分。

### 4. 權限、稽核、推播

- 不新增權限鍵。未讀名單用 `announcement:read`（開放問題 3）。
- 稽核：都不寫（讀取與自己的狀態）。推播：`notification delete` 照舊在真的刪除時才推。

## 開放問題

1. 篩選以 `category` 還是 `type`？分類對使用者有意義，但一個分類裡的類型會隨 feature 開關變化；也可以兩者都收。
2. 分類篩選在未讀很少、某類很稀疏時會掃很多列（`type IN` 不在索引裡）。要不要加 `(recipient_id, type, created_at, id)`？先量測再說。
3. 「誰沒讀」是否等同監看員工？`announcement:read` 的預設持有者（見權限目錄）都看得到；要不要另一個權限（`announcement:readReceipts`），或只給該公告的建立者與 `announcement:update`？
4. 刪除通知的人目前算「沒收到」（§13 D2 的代價）。未讀名單要不要把「已刪除」與「未讀」分開？分開就要以受眾快照為準，而快照是解析前的定義、不是人名清單。
5. 對未讀的人再發一次：做成「以未讀名單為受眾建立新公告」的捷徑，還是不做？
6. 未讀名單的匯出要走匯入匯出框架（有權限、有紀錄）還是前端直接產生 CSV？
7. 復原的 5 秒內使用者在另一個分頁看到的仍是未刪除的通知（推播還沒發）；可以接受嗎？

## 設計決策

## 歸檔去向

完成後預計寫成：

- [`backend/15-notification.md`](../architecture/backend/15-notification.md) §6 的 `category`；[`frontend/15-notification.md`](../architecture/frontend/15-notification.md) 的分類、分段、復原、偏好分組
- [`backend/19-announcement.md`](../architecture/backend/19-announcement.md) §3 的受眾名稱與未讀名單；[`frontend/16-announcement.md`](../architecture/frontend/16-announcement.md)
- [`backend/24-comment.md`](../architecture/backend/24-comment.md) §3.2 的 `GET /watches`；[`frontend/22-comment.md`](../architecture/frontend/22-comment.md) 的「我關注的項目」，並把 §8.2 的「不做」移除
