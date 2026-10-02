# ADR-0031 — 公告與排程通知：每次發送一筆延遲工作，分批寫進既有的 `notifications`

- 狀態：**採用**（2026-10-02 確認；開放問題依提案中的建議，A1～A5 尚未實作）
- 日期：2026-10-02
- 相關：[ADR-0026](./0026-notification-center.md)（站內通知；本決定沿用 D5 的快照、D6 的「每人一筆」，以分批繞過單次上限）、
  [ADR-0028](./0028-notification-event-management.md)（事件目錄與租戶政策）、[ADR-0016](./0016-background-jobs.md)／[ADR-0020](./0020-physical-tenant-isolation.md) D15（背景工作、交易內入列走 `job_outbox`）、
  [ADR-0024](./0024-relationship-based-access-control.md)（群組與關係圖）、[ADR-0025](./0025-entity-revisions.md)（軟刪除與回收桶）、
  [ADR-0029](./0029-toggleable-platform-features.md)（可關閉的 feature）；
  提案 [`../features/announcements.md`](../features/announcements.md)

## 背景

站內通知只有程式發出的一種來源（擁有者模組在業務交易內呼叫 `notify()`），而且每個人只看得到自己的。
租戶管理者需要：

1. 查租戶內 **所有人** 收到過的通知（回答「我沒收到」）。
2. 自己寫訊息，發給指定的人、群組、角色或全租戶；時間可以是立即、指定時間、週期，或某個事件發生時。

限制：`notify()` 單次最多 1000 人（ADR-0026 D6）、必須在 `withTransaction` 的交易內；pg-boss 的 `cron` 以工作名稱註冊、只有 UTC，
不能當成每個租戶、每則公告各自的排程；租戶沒有時區設定；群組成員只存在 `relation_tuples`（巢狀）。

## 決定

### 通知總覽

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **`GET /notifications/all`**（新權限 `notification:read`，依賴 `user:read`）：租戶內所有人的通知，篩選 `type`、`recipientId`、`actorId`、`sourceId`、時間、`unread`，keyset 分頁同 `/notifications`。`notifications` 加 `(created_at, id)`、`(type, created_at, id)` 兩個索引 | 既有索引都以 `recipient_id` 開頭，跨收件人的列表用不到 |
| D2 | **`notification:read` 只預設給 super-admin 與 admin**，auditor 不預設（提案問題 1） | 通知的 `params` 帶申請人名稱、角色名稱；admin 本來就從稽核日誌看得到同樣的資訊，auditor 的定位是唯讀稽核，不一定需要看到別人的收件匣 |

### 公告的資料

| # | 決定 | 理由 |
| --- | --- | --- |
| D3 | **兩張表**：`announcements`（可編輯的定義：標題、純文字內文、受眾、觸發、狀態、`next_run_at`、`version`、軟刪除）與 `announcement_dispatches`（每次實際送出一筆：內容與受眾定義的快照、計畫時間、人數、狀態）。都在租戶 DB | 週期與事件點的公告會發很多次，每次的人數、已讀率、撤回要分開看；改公告不能影響已發出的內容 |
| D4 | **`notifications` 加 `source_id uuid NULL`**（不加外鍵）＋ 部分唯一索引 `(source_id, recipient_id) WHERE source_id IS NOT NULL`；公告的通知類型是 `announcement.published`，`params` 只放標題，全文經 `GET /me/announcement-messages/:dispatchId` 從發送紀錄讀（收件人要有該發送的通知，否則 404） | 唯一索引讓分批寫入可以重做而不重複，也讓撤回、已讀率以 `source_id` 查得到；`params` ≤ 4 KiB 的規則不變。不加外鍵：發送紀錄清掉後通知仍依自己的保留期存在 |
| D5 | **受眾**：`{ all, userIds, groupIds, roleIds }` 取聯集，只留可登入的使用者（同 `findActiveUserIdsWithPermission` 的條件）；群組與角色經 `AuthzService` 新增的反向展開（`usersInSubjectSets`）解析，含巢狀群組、排除過期邊與已刪除節點。**發送當下解析，是快照**（ADR-0026 D5） | 公告模組不自己查 `relation_tuples`；與正向解析同一張圖、同樣的條件 |
| D6 | **收件人上限**是系統設定 `announcement.maxRecipients`（預設 10000）；超過時該次發送 `failed`、詳情顯示原因，**不截斷**（提案問題 3） | 截斷會讓「誰沒收到」變成隨機；租戶規模真的更大時調設定即可 |
| D7 | **觸發**是 discriminated union：`immediate`、`once { at }`、`recurring { frequency: daily \| weekly \| monthly, interval, weekdays?, monthDay?: 1～28 \| 'last', time, startsOn, endsOn?, maxOccurrences? }`、`event { event, delayMinutes }`。**不收 cron 字串** | 畫面與驗證都簡單；不存在的日期（31 日、2 月 30 日）由選項本身排除 |

### 排程

| # | 決定 | 理由 |
| --- | --- | --- |
| D8 | **每一次發送是一筆延遲工作** `announcement.dispatch`（`startAfter = next_run_at`，交易內入列走 outbox）。handler 鎖住公告，只在 `status = 'scheduled'` 且 `next_run_at` 等於工作上的時間時建立發送、算下一次並入列下一筆；否則 no-op | 不輪詢；編輯、暫停、刪除不必去 pg-boss 取消工作，舊工作自然失效 |
| D9 | **分批 fan-out**：另一個工作 `announcement.fanOut` 分頁解析受眾，每 500 人一個交易呼叫 `notify()`（`ON CONFLICT DO NOTHING`），完成後 `sent`。`notify()` 單次 1000 的上限不變 | 列表、未讀數、推播、保留清理、租戶政策全部沿用；重做安全（D4 的唯一索引） |
| D10 | **錯過的時間只補最近一次**：worker 停機後恢復，`next_run_at` 已過的只發一次，下一次直接跳到未來。每天的 `announcement.reconcile` 為 `scheduled` 卻沒有對應工作的公告重新入列 | 不讓停機後連發一串；佇列被清除也能自己恢復 |
| D11 | **租戶時區**：新系統設定 `system.timezone`（IANA 名稱，預設 `UTC`，提案問題 5）；週期依時區計算、含日光節約。改時區後重算所有 `scheduled` 公告的 `next_run_at`。計算只在後端（`announcement.recurrence.ts`，純函式），前端的「接下來 5 次」呼叫 `POST /announcements/recurrence-preview`（提案問題 4）。時區計算用 `date-fns` ＋ `@date-fns/tz`（Node 24 沒有 `Temporal`） | 通用型後台不假設台灣；DST 與月底的邊界只有一份實作 |

### 事件點

| # | 決定 | 理由 |
| --- | --- | --- |
| D12 | **事件點由擁有者模組登記**（`AnnouncementTriggerCatalog`，同事件目錄的模式），在自己的業務交易內呼叫 `announcementTriggers.fire(TRIGGER, { userIds }, tx)`；`fire()` 查快取中訂了這個觸發點的公告，每則入列一筆延遲工作。**不訂閱 `DomainEventBus`** | bus 不保證送達；沒有公告時成本是一次快取查詢 |
| D13 | **收件人是事件的使用者 ∩ 公告的受眾**（受眾為 `all` 時不限制）。同一則公告對同一個人 **只發一次**（`(announcement_id, trigger_subject_id)` 唯一），公告改內容也不重發（提案問題 6） | 被移出又加回群組不該再收一次歡迎訊息 |
| D14 | 第一批觸發點：`user.activated`、`group.memberAdded`、`user.rolesChanged` | 新人引導、加入部門、職務異動是最常見的三種 |

### 權限、政策與生命週期

| # | 決定 | 理由 |
| --- | --- | --- |
| D15 | **權限鍵**：`announcement:read`、`create`、`update`、`delete`、`publish`（發送、排程、暫停／恢復、撤回）。`publish` 獨立於 `update`。預設：admin 全部、auditor 只有 `read` | 能寫草稿的人不一定能對全租戶發話 |
| D16 | **政策**：`announcement.published` 登記進事件目錄（category `announcement`、`inApp`、預設開、feature `announcement`），**預設不允許個人關掉**，租戶可自行打開；不設 `mandatory`（提案問題 8） | 公司公告不該被個人靜音，但租戶要能整個關掉 |
| D17 | **編輯已排程的公告**只影響之後的發送；不支援「編輯並重發給已收到的人」，要重發就撤回再發（提案問題 7）。**不記版本歷史**（提案問題 10） | 發送紀錄已有內容快照 |
| D18 | **撤回**刪除該發送的所有通知、對收件人推 `kind: 'delete'`；發送紀錄保留、狀態 `revoked`，管理者仍看得到全文（提案問題 11） | 收件人那邊消失；管理端留下「發過什麼」 |
| D19 | **軟刪除 ＋ 回收桶**（`TrashHandler`），還原後是 `paused`、不會自己開始發。發送紀錄隨公告永久刪除 CASCADE；另由 `announcement.dispatchRetentionDays`（預設 365）清理舊的發送紀錄（提案問題 12） | 公告是使用者編輯的內容，與角色、群組同一套 |
| D20 | **可關閉的 feature `announcement`**：停用時端點 `FEATURE_DISABLED`、排程的工作 no-op（`output = { skipped }`）、事件點不入列；資料保留 | 與 webhook（ADR-0030 D8）相同 |

### 不做

- 管道 `email`（之後在事件目錄加管道；大量寄信的節流與退訂另開提案，提案問題 9）。
- 富文本、附件、多語系內容、排除名單、依屬性的動態受眾、自訂 cron、drip 序列、發送前的審批。
- 平台管理者對所有租戶的公告。
- 修改 `notify()` 的單次上限，或改成廣播模型。

## 實作階段

| 階段 | 內容 |
| --- | --- |
| A1 | 通知總覽（D1、D2）：索引、`GET /notifications/all`、`/notification/all` |
| A2 | 公告：資料表、`source_id`、受眾解析、`immediate`／`once`、fan-out、讀全文、撤回、回收桶、權限、feature |
| A3 | 週期：`system.timezone`、`announcement.recurrence.ts`、暫停／恢復、`reconcile` |
| A4 | 事件點：`AnnouncementTriggerCatalog` 與第一批三個觸發點 |
| A5 | 歸檔：正式文件、刪除提案 |

## 實作紀錄

| 項目 | 與上面的決定不同或補充的地方 |
| --- | --- |
| A1 | 在 branch `feat/announcements` 完成。前端頁面鍵 `NOTIFICATION_OVERVIEW_PAGE`、側邊選單「系統管理 › 通知總覽」；表格以「載入更多」接續 keyset，不顯示總數。租戶 migration `0028_notification_overview_idx`、`0029_notification_read_system_roles`（既有租戶的 admin 補鍵）。端點放在獨立的 `NotificationOverviewController`，與只需要登入的 `NotificationController` 分開 |
| A2 | 在 branch `feat/announcements` 完成，規格寫在 [`backend/19-announcement.md`](../architecture/backend/19-announcement.md)、[`frontend/16-announcement.md`](../architecture/frontend/16-announcement.md)。與上面的決定不同或補充：撤回的端點是 `POST /announcements/:id/dispatches/:dispatchId/revoke`（掛在公告底下，與 webhook 的重送一致）；**草稿以外的公告修改要 `announcement:publish`**（路由宣告 update、service 另外檢查）、不能改成「立即」，已完成的不能改（D15、D17 的具體化）；受眾預覽要 `announcement:update`（不是 create）；暫停與恢復提前在 A2 做（只對 `once` 有意義，A3 套用到週期）；`defineNotification` 新增 `defaultAllowUserOverride`（D16 需要事件層級的預設）；發送紀錄的保留清理（D19 的 `dispatchRetentionDays`）與事件點的 `trigger_subject_id` 欄延到 A3、A4。租戶 migration `0030`、`0031`，平台 `0011` |

## 評估過的方案

- **每分鐘一個排程工作掃 `next_run_at`**（D8 的另一邊）：租戶排程會展開到每個租戶，每分鐘對每個租戶 DB 開連線，閒置租戶的連線池不會關。
- **每則公告註冊一個 pg-boss cron**：排程以工作名稱為 key、只有 UTC，要在平台 DB 動態增刪，租戶刪除時還要清。
- **廣播模型（一筆公告 ＋ 每人已讀表）**（D9 的另一邊）：ADR-0026 D6 已評估——列表要合併兩個來源、已讀兩種寫法、保留清理要兩套。
- **超過上限時截斷**（D6 的另一邊）：誰沒收到變成不可預期。
- **前後端各算一次週期**（D11 的另一邊）：DST 與月底的邊界會有兩份實作不一致。
- **以 `DomainEventBus` 觸發事件點**（D12 的另一邊）：不保證送達。
