# 後端 19 — 公告與排程通知

管理者寫一則訊息，立即或在指定的時間以站內通知發給指定的人、群組、角色或全租戶。
決策見 [ADR-0031](../../adr/0031-announcements.md)；前端見 [`../frontend/16-announcement.md`](../frontend/16-announcement.md)。
通知本身（`notifications` 表、`notify()`、推播、保留）見 [`15-notification.md`](./15-notification.md)。

> 範圍：ADR-0031 的 A1（通知總覽，[`15-notification.md`](./15-notification.md) §6.1）與 A2～A4（本文）。
> `trigger` 有 `immediate`、`once`、`recurring`、`event`。

---

## 1. 組成

```
db/schema/announcements.ts                  announcements、announcement_dispatches
db/migrations/0030_announcements.sql        兩張表、notifications.source_id ＋ 部分唯一索引（純加法）
db/migrations/0031_announcement_system_roles.sql  手寫：既有租戶的 admin 補 announcement:*、auditor 補 read
db/migrations/0032_announcement_event_triggers.sql  事件點：trigger_subject_id、唯一索引分成排程與事件兩種、事件查詢的索引
db/platform/migrations/0011_announcement_feature.sql  feature 預設值 ＋ 既有租戶啟用

modules/announcement/
├── announcement.controller.ts             /announcements（@RequireFeature('announcement')）
├── announcement-message.controller.ts     GET /me/announcement-messages/:dispatchId（只需要登入）
├── announcement.service.ts                CRUD、送出、暫停、恢復、刪除、還原、撤回、受眾預覽、讀全文
├── announcement-dispatch.service.ts       背景工作：排程時間到（runScheduled）、分批寫入（fanOut）
├── announcement.audience.ts               受眾 → 收件人（AnnouncementAudienceResolver）
├── announcement.triggers.ts               defineAnnouncementTrigger()、比對方式（純函式）
├── announcement-trigger.catalog.ts        AnnouncementTriggerCatalog：擁有者登記觸發點
├── announcement-trigger.service.ts        AnnouncementTriggerService.fire()：擁有者在業務交易內呼叫
├── announcement.scheduler.ts              下一次怎麼算（立即、指定時間、週期）、入列延遲工作
├── announcement.recurrence.ts             週期的日曆計算（純函式；Intl 換算時區）
├── announcement.job-types.ts              announcement.dispatch、announcement.eventDispatch、announcement.fanOut、announcement.maintenance
├── announcement.jobs.ts                   註冊四種工作
├── announcement-trash.handler.ts          回收桶
├── announcement.notifications.ts          announcement.published（預設不允許個人關閉）
├── announcement.settings.ts               announcement.maxRecipients、announcement.dispatchRetentionDays
└── announcement.repository.ts
```

- 不 import 其他業務模組：發送經由 `NotificationService.notify()`，受眾經由 `AuthzService.usersInSubjectSets()`（`core/authz`）。
  事件點反過來：擁有者（`modules/user`、`modules/group`）import 這個模組、登記觸發點、在業務交易內 `fire()`（§5.3）。
- 可關閉的 feature `announcement`（ADR-0031 D20）：停用時端點回 `404 FEATURE_DISABLED`，已入列的工作回 `{ skipped: 'featureDisabled' }`，資料保留。

---

## 2. 資料表

### 2.1 `announcements`

| 欄位 | 說明 |
| --- | --- |
| `title`、`body` | 標題（≤ 120）、純文字內文（≤ 5000） |
| `audience` | `jsonb`：`{ all, userIds, groupIds, roleIds }`（各 ≤ 200）；存定義，不存人名單 |
| `trigger` | `jsonb`：`{ kind: 'immediate' }`、`{ kind: 'once', at }`、週期 `{ kind: 'recurring', frequency, interval, weekdays?, monthDay?, time, startsOn, endsOn?, maxOccurrences? }`（§5.1），或事件點 `{ kind: 'event', event, delayMinutes }`（§5.3） |
| `status` | `draft` → `scheduled` ⇄ `paused` → `completed`（立即發送直接 `completed`；週期發完最後一次才 `completed`） |
| `next_run_at` | 排程中的下一次；不在排程中、或事件點（沒有時間表）為 null |
| `version` | 樂觀鎖：使用者的編輯與狀態操作遞增；背景發送改狀態不遞增 |
| `deleted_at` | 軟刪除（回收桶） |

### 2.2 `announcement_dispatches`

每一次實際送出一列：內容與受眾定義的 **快照**（之後改公告不影響）、`scheduled_for`、`status`
（`pending` → `sending` → `sent`／`failed`；任何時候都能 `revoked`）、`recipient_count`（實際寫入的通知數）、
`details`（略過的來源 `skipped`、失敗原因 `reason`）、`trigger_subject_id`（事件點：只發給這個人）。
排程的發送 `(announcement_id, scheduled_for) WHERE trigger_subject_id IS NULL` 唯一：同一個時間只發一次；
事件點 `(announcement_id, trigger_subject_id) WHERE trigger_subject_id IS NOT NULL` 唯一：同一個人只發一次。

### 2.3 `notifications.source_id`

公告產生的通知指向它的發送紀錄（沒有外鍵）。`(source_id, recipient_id) WHERE source_id IS NOT NULL` 唯一：
分批寫入重做時 `ON CONFLICT DO NOTHING` 略過已寫的人；撤回、已讀數也以它查。

---

## 3. 狀態與權限

| 操作 | 端點 | 權限 | 規則 |
| --- | --- | --- | --- |
| 建立草稿 | `POST /announcements` | `announcement:create` | 受眾可以空著 |
| 編輯 | `PATCH /announcements/:id` | `announcement:update` | 必帶 `version`。草稿以外（排程中、暫停中）另要 `announcement:publish`（service 檢查，`403 AUTHZ_FORBIDDEN`），且不能改成「立即」；已完成的不能改（`409 ANNOUNCEMENT_INVALID_STATE`）。排程中改了時間：重算 `next_run_at` 並入列新的延遲工作 |
| 送出 | `POST /announcements/:id/publish` | `announcement:publish` | 只限草稿；受眾不能空（`400 ANNOUNCEMENT_AUDIENCE_EMPTY`）；指定時間要在未來（`400 ANNOUNCEMENT_TRIGGER_IN_PAST`）。立即：在同一個交易建立發送並入列分批寫入，狀態 `completed`；指定時間：`scheduled` ＋ 延遲工作 |
| 暫停／恢復 | `POST /announcements/:id/pause`、`/resume` | `announcement:publish` | `scheduled` ⇄ `paused`；恢復時從現在起重算下一次（暫停期間錯過的不補發），沒有下一次 → 400 |
| 觸發點目錄 | `GET /announcements/trigger-events` | `announcement:read` | `{ items: [{ event, scope }] }`：所屬 feature 已啟用的觸發點 |
| 週期預覽 | `POST /announcements/recurrence-preview` | `announcement:update` | `{ trigger }` → `{ timeZone, occurrences }`（接下來最多 5 次，依租戶時區；前端不自己算） |
| 刪除 | `DELETE /announcements/:id` | `announcement:delete` | 軟刪除；排程中的改成 `paused`（還原後不會自己開始發） |
| 還原 | `POST /announcements/:id/restore` | `announcement:delete` | 另標 `@RequireFeature('trash')` |
| 受眾預覽 | `POST /announcements/audience-preview` | `announcement:update` | 回人數與略過的來源，不回名單 |
| 發送紀錄 | `GET /announcements/:id/dispatches` | `announcement:read` | 每列帶 `readCount`（目前還在的通知裡已讀的數量） |
| 撤回 | `POST /announcements/:id/dispatches/:dispatchId/revoke` | `announcement:publish` | 發送紀錄改 `revoked`（保留全文），刪除它的所有通知並推 `notification delete` 給收件人；再撤回 `409 ANNOUNCEMENT_DISPATCH_NOT_REVOCABLE` |
| 讀全文 | `GET /me/announcement-messages/:dispatchId` | 登入 | 只有收到的人看得到（否則 `404 ANNOUNCEMENT_MESSAGE_NOT_FOUND`），同時把那則通知標為已讀 |

每個人的操作都寫稽核：`announcement.create`／`update`／`publish`／`pause`／`resume`／`delete`／`restore`、
`announcementDispatch.revoke`（內文只記長度）。背景發送不寫稽核，發送紀錄就是紀錄。

---

## 4. 受眾

`AnnouncementAudienceResolver.resolve(audience)`：

1. 已刪除或不存在的群組、角色，與不可登入的指定使用者，列入 `skipped`。
2. `all`：所有可登入的使用者。否則：指定的人 ∪ `AuthzService.usersInSubjectSets([group:<g>#member, role:<r>#holder])`
   （與正向解析同一張圖、同樣的條件，沿巢狀群組與群組持有的角色往下展開）。
3. 只留可登入的使用者（未刪除、`active`、人）：與 `findActiveUserIdsWithPermission` 相同的條件；分段查詢（每段 5000 個 id）。

發送當下解析，是快照：之後才加入群組的人不會補收。寫入時 `notify()` 照常略過送出者自己，也照租戶的政策過濾。

---

## 5. 排程與發送

| 工作 | 入列 | 內容 |
| --- | --- | --- |
| `announcement.dispatch` | 送出、恢復、改時間的交易內（`startAfter = next_run_at`，走 `job_outbox`） | 鎖住公告；只在仍是 `scheduled` 且 `next_run_at` 等於工作上的 `runAt` 時建立發送、改成 `completed`、入列分批寫入；否則 `{ skipped: 'stale' }` |
| `announcement.fanOut` | 立即送出的交易內，或上一個工作裡 | 解析受眾；超過 `announcement.maxRecipients`（預設 10000）→ 那次發送 `failed`（不截斷）。否則每 500 人一個交易：鎖住發送紀錄、確認沒被撤回、`notify()`；完成後 `sent` ＋ `recipient_count` |

- 編輯、暫停、刪除都不去佇列取消工作：過時的工作在執行時發現對不上就略過（D8）。暫停後恢復到同一個時間時佇列裡有兩筆，
  先執行的發送並完成，後執行的看到 `completed` 略過。
- 分批寫入與撤回以發送紀錄的列鎖互斥：撤回提交後不會再有一批寫進去；先提交的那一批由撤回在之後刪掉。
- 重做安全：唯一索引略過已寫的人；已是 `sent`／`failed`／`revoked` 的發送直接略過。
- 週期：`announcement.dispatch` 建立這一次的發送後，從「這一次」與「現在」較晚的那一刻算下一次並入列；沒有了（過了結束日期、次數用完）就 `completed`。
  停機之後補發的只有那一次，中間錯過的不連發（D10）。

### 5.1 週期（`announcement.recurrence.ts`）

| 欄位 | 規則 |
| --- | --- |
| `frequency`、`interval` | 每 N 天／週／月（1～99）；週與月的間隔從 `startsOn` 所在的那一週（週日起）、那個月算起 |
| `weekdays` | `weekly` 必填：0（週日）～6，不重複 |
| `monthDay` | `monthly` 必填：1～28 或 `last`（不收 29～31：不存在的日期由選項本身排除） |
| `time` | 當地的 `HH:mm`：依 **租戶時區**（系統設定 `general.defaultTimezone`）換算成時刻，夏令時間依那一天的位移 |
| `startsOn`、`endsOn` | 第一天與最後一天（含），租戶時區的日曆日 |
| `maxOccurrences` | 最多發幾次（已建立的發送紀錄數，撤回的也算）；null＝不限 |

純函式、只在後端算；時區換算用 `Intl`（Node 24 沒有 `Temporal`，不另外引入套件），與前端 `shared/date` 的 `zonedDateTime` 同一個兩次校正的做法。

### 5.2 每日維護（`announcement.maintenance`）

排程 `ANNOUNCEMENT_MAINTENANCE_CRON`（預設 `20 5 * * *`），同一個租戶同時只跑一個：

| 項目 | 內容 |
| --- | --- |
| 補排程 | 事件點除外，每則排程中的公告重算下一次（週期依目前的租戶時區；指定時間照存的時間）。與存的不同：更新 `next_run_at` 並入列（改了時區）；相同且在 25 小時內（含已經過了的）：再入列一筆（延遲工作遺失時補上）。重複的工作執行時對不上就略過 |
| 保留清理 | 刪除建立超過 `announcement.dispatchRetentionDays`（預設 365，30～3650）天、已經結束（`sent`／`failed`／`revoked`）的發送紀錄；每批 500 筆。通知不受影響，但收件人之後讀全文會 404 |
| 結果 | 工作的 `output`：`{ rescheduled, requeued, retentionDays, deletedDispatches }` |


### 5.3 事件點

| 觸發點 | 擁有者 | 何時 | 比對（`scope`） |
| --- | --- | --- | --- |
| `user.activated` | `modules/user` | 完成啟用（`pending` → `active`，`emitStatusChanged`），或建立時就是 `active`（外部 IdP 首次登入、管理者直接設密碼；`createAccount`） | `audience`：那個人在公告的受眾裡（全租戶、指定的人、群組含巢狀、角色） |
| `user.roleAssigned` | `modules/user` | `PUT /users/:id/roles` 有新增的角色（移除不算；經由群組持有的角色不算） | `role`：新增的角色有一個是受眾裡的角色（受眾是全租戶時都算） |
| `group.memberAdded` | `modules/group` | `PATCH /groups/:id/members` 直接加入使用者（把群組加進群組時，底下的人不算） | `group`：加入的群組是受眾裡的群組（受眾是全租戶時都算） |

1. 擁有者在業務交易內（稽核之後）呼叫 `AnnouncementTriggerService.fire(TRIGGER, { userIds, groupId?, roleIds? }, tx)`：
   公告 feature 沒啟用時直接回；否則查出訂了這個觸發點、排程中的公告（`announcements_event_idx`），每則 × 每人入列一筆
   `announcement.eventDispatch`（交易內 outbox，`startAfter` = 現在＋`delayMinutes`）。沒有公告時成本是一次有索引的查詢。
2. 工作執行時：公告仍是排程中、仍訂著這個觸發點、而且比對成立，才建立只發給那個人的發送紀錄（`trigger_subject_id`）並入列分批寫入；
   唯一索引讓同一則公告對同一個人只發一次（移出又加回、重複事件都不重發）。工作的 `output`：`{ dispatchId }` 或 `{ skipped: 'stale' | 'notInAudience' | 'alreadySent' | 'featureDisabled' | 'unknownEvent' }`。
3. 事件點的公告送出後是 `scheduled`、`next_run_at` 為 null；暫停期間發生的事件不會補發（工作執行時看到不是排程中就略過）。每日維護不碰它。

**加入一個觸發點**：在擁有者模組的 `<name>.announcement-triggers.ts` 以 `defineAnnouncementTrigger('<模組>.<事件>', { scope, feature? })` 宣告，
在 `*.module.ts` import `AnnouncementModule` 並在 constructor 以 `AnnouncementTriggerCatalog.register()` 登記，在業務交易內呼叫 `fire()`；
前端在 `features/announcement/constants.ts` 的 `ANNOUNCEMENT_EVENT_LABEL` 加名稱與說明。已發布的名稱不改名：公告存的是它。

---

## 6. 通知

| 類型 | 收件人 | `params` | `link` |
| --- | --- | --- | --- |
| `announcement.published` | 受眾解析出的人（不含送出者） | `title` | `announcement.message`（`{ dispatchId }`） |

事件目錄：category `announcement`、管道 `inApp`、feature `announcement`、`defaultAllowUserOverride: false`
（租戶沒有覆寫時個人不能關掉，[`16-notification-event.md`](./16-notification-event.md) §1.1）。

---

## 7. 錯誤碼

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `ANNOUNCEMENT_NOT_FOUND` | 404 | 不存在或已刪除 |
| `ANNOUNCEMENT_VERSION_CONFLICT` | 409 | `version` 過時（`details.current`） |
| `ANNOUNCEMENT_INVALID_STATE` | 409 | 狀態不允許（`details.status`） |
| `ANNOUNCEMENT_TRIGGER_IN_PAST` | 400 | 指定的時間已過（`details.at`），或週期沒有下一次（`details.reason: 'noOccurrence'`：過了結束日期、次數用完） |
| `ANNOUNCEMENT_AUDIENCE_EMPTY` | 400 | 送出時沒有受眾 |
| `ANNOUNCEMENT_EVENT_UNKNOWN` | 400 | 事件點不在觸發點目錄上（或所屬 feature 沒啟用；`details.event`） |
| `ANNOUNCEMENT_NOT_DELETED` | 409 | 還原沒有被刪除的公告 |
| `ANNOUNCEMENT_DISPATCH_NOT_FOUND` | 404 | 發送紀錄不存在或不屬於這則公告 |
| `ANNOUNCEMENT_DISPATCH_NOT_REVOCABLE` | 409 | 已經撤回 |
| `ANNOUNCEMENT_MESSAGE_NOT_FOUND` | 404 | 讀全文：沒有收到、已撤回或已清除 |

---

## 8. 測試

| 對象 | 檔案 |
| --- | --- |
| 真 Postgres ＋ worker：權限（auditor 能看不能建、編輯者不能送出也不能改排程中的）、受眾預覽（巢狀群組、角色、停用的人、不存在的來源）、受眾空、立即發送（每人一則、不含送出者與停用的人、`source_id` 與連結）、分批寫入重做、讀全文（已讀、已讀數、沒收到 404）、已完成不能改、撤回（通知刪除、稽核、再撤回 409）、時間已過、排程（暫停、恢復、時間到發送）、改時間後舊工作 no-op、刪除進回收桶與還原、樂觀鎖、事件目錄的預設 | `test/announcements.spec.ts` |
| 週期預覽（租戶時區、次數上限、缺星期幾 400）、週期發送後排下一次與次數用完、同一個時間的舊工作略過、每日維護（改時區後重算、過期且結束的發送紀錄刪除） | `test/announcements.spec.ts` |
| 週期的日曆：每天、每 N 天、每 N 週的星期幾、每月某日與最後一天、夏令時間、結束日期、次數、不同時區 | `src/modules/announcement/__tests__/announcement.recurrence.spec.ts` |
| 事件點：觸發點目錄、不認得的事件 400、加入受眾裡的群組只發給他且只發一次（移出又加回不重發）、加入其他群組不發、被指派受眾裡的角色、建立就是 active 的帳號 | `test/announcements.spec.ts` |
| 加成員時以直接加入的使用者與那個群組觸發、只移除不觸發 | `src/modules/group/__tests__/group.service.spec.ts` |
| 反向展開 `usersInSubjectSets` | 經由上面的受眾案例 |
| `defaultAllowUserOverride`、`notification()` 帶 `sourceId` | `src/modules/notification/__tests__/notification.batch.spec.ts` |
| 端點的授權與 feature 宣告 | `test/route-audit.spec.ts` |
