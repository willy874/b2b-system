# 後端 19 — 公告與排程通知

管理者寫一則訊息，立即或在指定的時間以站內通知發給指定的人、群組、角色或全租戶。
決策見 §9；前端見 [`../frontend/16-announcement.md`](../frontend/16-announcement.md)。
通知本身（`notifications` 表、`notify()`、推播、保留）見 [`15-notification.md`](./15-notification.md)。

> 範圍：§9 的 A1（通知總覽，[`15-notification.md`](./15-notification.md) §6.1）與 A2～A4（本文）。
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
- 可關閉的 feature `announcement`（§9.2 D20）：停用時端點回 `404 FEATURE_DISABLED`，已入列的工作回 `{ skipped: 'featureDisabled' }`，資料保留。

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

`AnnouncementAudienceResolver.includes(audience, userId)`：只判斷一個人在不在受眾裡（事件點的 `audience` 比對用，§5.3），
結果與「`resolve()` 的收件人含不含他」相同，但不展開整個受眾：

1. `all`，或直接被指定 → 在受眾裡（仍要可登入）。
2. 否則取他的主體閉包 `AuthzService.subjectClosure(userId)`（所屬的群組含巢狀、本人與群組持有的角色；已刪除的群組與角色、
   過期的邊不算——與 `usersInSubjectSets` 同一張圖的另一個方向），與受眾的 `group:<g>#member`、`role:<r>#holder` 取交集。
3. 最後確認他可登入（與上面 `resolve()` 第 3 點相同的條件）。

最多兩次查詢，與受眾大小無關（`test/announcements.spec.ts` 以真的關係圖比對兩者的結果一致）。

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
| `time` | 當地的 `HH:mm`：依 **租戶時區**（系統設定 `general.defaultTimezone`）換算成時刻，夏令時間依那一天的位移；不存在的時段（夏令時間開始時跳過的那一小時）順延（02:30 → 03:30），重複的時段（夏令時間結束）取較早的一次 |
| `startsOn`、`endsOn` | 第一天與最後一天（含），租戶時區的日曆日 |
| `maxOccurrences` | 最多發幾次（已建立的發送紀錄數，撤回的也算）；null＝不限 |

純函式、只在後端算；時區換算用 `Intl`（Node 24 沒有 `Temporal`，不另外引入套件），與前端 `@b2b-system/web-shared/date` 的 `zonedDateTime` 同一個兩次校正的做法。

### 5.2 每日維護（`announcement.maintenance`）

排程 `ANNOUNCEMENT_MAINTENANCE_CRON`（預設 `20 5 * * *`），同一個租戶同時只跑一個：

| 項目 | 內容 |
| --- | --- |
| 補排程 | 事件點除外，每則排程中的公告重算下一次（週期依目前的租戶時區；指定時間照存的時間）。與存的不同：更新 `next_run_at` 並入列（改了時區）；相同且在 25 小時內（含已經過了的）：再入列一筆（延遲工作遺失時補上）。重複的工作執行時對不上就略過 |
| 保留清理 | 刪除建立超過 `announcement.dispatchRetentionDays`（預設 365，30～3650）天、已經結束（`sent`／`failed`／`revoked`）的發送紀錄；每批 500 筆。通知不受影響，但收件人之後讀全文會 404 |
| 結果 | 工作的 `output`：`{ rescheduled, requeued, completed, retentionDays, deletedDispatches }`。`rescheduled`：`next_run_at` 有變動的則數；`requeued`：入列了發送工作的則數（含 `rescheduled`）；`completed`：週期的次數或結束日期已到、改成 `completed` 的則數（不入列）；`deletedDispatches`：清理掉的發送紀錄筆數 |


### 5.3 事件點

| 觸發點 | 擁有者 | 何時 | 比對（`scope`） |
| --- | --- | --- | --- |
| `user.activated` | `modules/user` | 完成啟用（`pending` → `active`，`emitStatusChanged`），或建立時就是 `active`（外部 IdP 首次登入、管理者直接設密碼；`createAccount`） | `audience`：那個人在公告的受眾裡（全租戶、指定的人、群組含巢狀、角色） |
| `user.roleAssigned` | `modules/user` | `PUT /users/:id/roles` 有新增的角色（移除不算；經由群組持有的角色不算） | `role`：新增的角色有一個是受眾裡的角色（受眾是全租戶時都算） |
| `group.memberAdded` | `modules/group` | `PATCH /groups/:id/members` 直接加入使用者（把群組加進群組時，底下的人不算） | `group`：加入的群組是受眾裡的群組（受眾是全租戶時都算） |

1. 擁有者在業務交易內（稽核之後）呼叫 `AnnouncementTriggerService.fire(TRIGGER, { userIds, groupId?, roleIds? }, tx)`：
   公告 feature 沒啟用時直接回；否則查出訂了這個觸發點、排程中的公告（`announcements_event_idx`），每則 × 每人入列一筆
   `announcement.eventDispatch`（交易內 outbox，`startAfter` = 現在＋`delayMinutes`）。沒有公告時成本是一次有索引的查詢。
   這些工作以一次 `JobQueue.enqueueMany` 寫進 outbox（一條多列 INSERT）：擁有者常在持有鎖的交易裡呼叫（例：群組的成員鎖），
   往返次數不隨「人數 × 公告數」成長（[`10-jobs.md`](./10-jobs.md) §4.1）。
2. 工作執行時：公告仍是排程中、仍訂著這個觸發點、而且比對成立，才建立只發給那個人的發送紀錄（`trigger_subject_id`）並入列分批寫入。
   比對在鎖住公告 **之前**：先不上鎖讀公告比對（`audience` 用 `includes`，§4），沒命中就不開交易；命中了才鎖住公告列、重新確認狀態，
   受眾在這之間被改過才在同一個交易裡以新的受眾再比對一次。交易內不另外取連線；
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

---

## 9. 設計決策：公告與排程通知

> 原 ADR-0031，2026-10-02 決定（提案的開放問題依建議確認）；A1～A5 於同日在 branch `feat/announcements` 完成。
> 實作時 D11 的時區改沿用 `general.defaultTimezone`、不引入 `date-fns`，D12～D14 的事件點改以 `announcement.eventDispatch` 入列並把觸發點改名為 `user.roleAssigned`，見 §9.5。

### 9.1 背景

站內通知只有程式發出的一種來源（擁有者模組在業務交易內呼叫 `notify()`），而且每個人只看得到自己的。
租戶管理者需要：

1. 查租戶內 **所有人** 收到過的通知（回答「我沒收到」）。
2. 自己寫訊息，發給指定的人、群組、角色或全租戶；時間可以是立即、指定時間、週期，或某個事件發生時。

限制：`notify()` 單次最多 1000 人（[`backend/15-notification.md`](15-notification.md) §12.2 D6）、必須在 `withTransaction` 的交易內；pg-boss 的 `cron` 以工作名稱註冊、只有 UTC，
不能當成每個租戶、每則公告各自的排程；租戶沒有專給排程用的時區設定；群組成員只存在 `relation_tuples`（巢狀）。

相關的既有決定：[`backend/15-notification.md`](15-notification.md) §12（站內通知；沿用 D5 的快照、D6 的「每人一筆」，以分批繞過單次上限）、
[`backend/16-notification-event.md`](16-notification-event.md) §9（事件目錄與租戶政策）、[`backend/10-jobs.md`](10-jobs.md) §9／[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D15（背景工作、交易內入列走 `job_outbox`）、
[`iam/01-model.md`](../iam/01-model.md) §9（群組與關係圖）、[`backend/14-revisions.md`](14-revisions.md) §9（軟刪除與回收桶）、
[`architecture/05-tenancy.md`](../05-tenancy.md) §12（可關閉的 feature）。通知總覽寫在 [`15-notification.md`](./15-notification.md) §6.1，前端見 [`../frontend/16-announcement.md`](../frontend/16-announcement.md)。

### 9.2 決定

#### 通知總覽

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **`GET /notifications/all`**（新權限 `notification:read`，依賴 `user:read`）：租戶內所有人的通知，篩選 `type`、`recipientId`、`actorId`、`sourceId`、時間、`unread`，keyset 分頁同 `/notifications`。`notifications` 加 `(created_at, id)`、`(type, created_at, id)` 兩個索引 | 既有索引都以 `recipient_id` 開頭，跨收件人的列表用不到 |
| D2 | **`notification:read` 只預設給 super-admin 與 admin**，auditor 不預設（提案問題 1） | 通知的 `params` 帶申請人名稱、角色名稱；admin 本來就從稽核日誌看得到同樣的資訊，auditor 的定位是唯讀稽核，不一定需要看到別人的收件匣 |

#### 公告的資料

| # | 決定 | 理由 |
| --- | --- | --- |
| D3 | **兩張表**：`announcements`（可編輯的定義：標題、純文字內文、受眾、觸發、狀態、`next_run_at`、`version`、軟刪除）與 `announcement_dispatches`（每次實際送出一筆：內容與受眾定義的快照、計畫時間、人數、狀態）。都在租戶 DB | 週期與事件點的公告會發很多次，每次的人數、已讀率、撤回要分開看；改公告不能影響已發出的內容 |
| D4 | **`notifications` 加 `source_id uuid NULL`**（不加外鍵）＋ 部分唯一索引 `(source_id, recipient_id) WHERE source_id IS NOT NULL`；公告的通知類型是 `announcement.published`，`params` 只放標題，全文經 `GET /me/announcement-messages/:dispatchId` 從發送紀錄讀（收件人要有該發送的通知，否則 404） | 唯一索引讓分批寫入可以重做而不重複，也讓撤回、已讀率以 `source_id` 查得到；`params` ≤ 4 KiB 的規則不變。不加外鍵：發送紀錄清掉後通知仍依自己的保留期存在 |
| D5 | **受眾**：`{ all, userIds, groupIds, roleIds }` 取聯集，只留可登入的使用者（同 `findActiveUserIdsWithPermission` 的條件）；群組與角色經 `AuthzService` 新增的反向展開（`usersInSubjectSets`）解析，含巢狀群組、排除過期邊與已刪除節點。**發送當下解析，是快照**（[`backend/15-notification.md`](15-notification.md) §12.2 D5） | 公告模組不自己查 `relation_tuples`；與正向解析同一張圖、同樣的條件 |
| D6 | **收件人上限**是系統設定 `announcement.maxRecipients`（預設 10000）；超過時該次發送 `failed`、詳情顯示原因，**不截斷**（提案問題 3） | 截斷會讓「誰沒收到」變成隨機；租戶規模真的更大時調設定即可 |
| D7 | **觸發**是 discriminated union：`immediate`、`once { at }`、`recurring { frequency: daily \| weekly \| monthly, interval, weekdays?, monthDay?: 1～28 \| 'last', time, startsOn, endsOn?, maxOccurrences? }`、`event { event, delayMinutes }`。**不收 cron 字串** | 畫面與驗證都簡單；不存在的日期（31 日、2 月 30 日）由選項本身排除 |

#### 排程

| # | 決定 | 理由 |
| --- | --- | --- |
| D8 | **每一次發送是一筆延遲工作** `announcement.dispatch`（`startAfter = next_run_at`，交易內入列走 outbox）。handler 鎖住公告，只在 `status = 'scheduled'` 且 `next_run_at` 等於工作上的時間時建立發送、算下一次並入列下一筆；否則 no-op | 不輪詢；編輯、暫停、刪除不必去 pg-boss 取消工作，舊工作自然失效 |
| D9 | **分批 fan-out**：另一個工作 `announcement.fanOut` 分頁解析受眾，每 500 人一個交易呼叫 `notify()`（`ON CONFLICT DO NOTHING`），完成後 `sent`。`notify()` 單次 1000 的上限不變 | 列表、未讀數、推播、保留清理、租戶政策全部沿用；重做安全（D4 的唯一索引） |
| D10 | **錯過的時間只補最近一次**：worker 停機後恢復，`next_run_at` 已過的只發一次，下一次直接跳到未來。每天的 `announcement.reconcile` 為 `scheduled` 卻沒有對應工作的公告重新入列 | 不讓停機後連發一串；佇列被清除也能自己恢復 |
| D11 | **租戶時區**：新系統設定 `system.timezone`（IANA 名稱，預設 `UTC`，提案問題 5）；週期依時區計算、含日光節約。改時區後重算所有 `scheduled` 公告的 `next_run_at`。計算只在後端（`announcement.recurrence.ts`，純函式），前端的「接下來 5 次」呼叫 `POST /announcements/recurrence-preview`（提案問題 4）。時區計算用 `date-fns` ＋ `@date-fns/tz`（Node 24 沒有 `Temporal`）（實作改沿用 `general.defaultTimezone`、以 `Intl` 計算，見 §9.5 A3） | 通用型後台不假設台灣；DST 與月底的邊界只有一份實作 |

#### 事件點

| # | 決定 | 理由 |
| --- | --- | --- |
| D12 | **事件點由擁有者模組登記**（`AnnouncementTriggerCatalog`，同事件目錄的模式），在自己的業務交易內呼叫 `announcementTriggers.fire(TRIGGER, { userIds }, tx)`；`fire()` 查快取中訂了這個觸發點的公告，每則入列一筆延遲工作。**不訂閱 `DomainEventBus`**（實作的工作名稱與快取見 §9.5 A4） | bus 不保證送達；沒有公告時成本是一次快取查詢 |
| D13 | **收件人是事件的使用者 ∩ 公告的受眾**（受眾為 `all` 時不限制）。同一則公告對同一個人 **只發一次**（`(announcement_id, trigger_subject_id)` 唯一），公告改內容也不重發（提案問題 6） | 被移出又加回群組不該再收一次歡迎訊息 |
| D14 | 第一批觸發點：`user.activated`、`group.memberAdded`、`user.rolesChanged`（實作改名為 `user.roleAssigned`，見 §9.5 A4） | 新人引導、加入部門、職務異動是最常見的三種 |

#### 權限、政策與生命週期

| # | 決定 | 理由 |
| --- | --- | --- |
| D15 | **權限鍵**：`announcement:read`、`create`、`update`、`delete`、`publish`（發送、排程、暫停／恢復、撤回）。`publish` 獨立於 `update`。預設：admin 全部、auditor 只有 `read` | 能寫草稿的人不一定能對全租戶發話 |
| D16 | **政策**：`announcement.published` 登記進事件目錄（category `announcement`、`inApp`、預設開、feature `announcement`），**預設不允許個人關掉**，租戶可自行打開；不設 `mandatory`（提案問題 8） | 公司公告不該被個人靜音，但租戶要能整個關掉 |
| D17 | **編輯已排程的公告**只影響之後的發送；不支援「編輯並重發給已收到的人」，要重發就撤回再發（提案問題 7）。**不記版本歷史**（提案問題 10） | 發送紀錄已有內容快照 |
| D18 | **撤回**刪除該發送的所有通知、對收件人推 `kind: 'delete'`；發送紀錄保留、狀態 `revoked`，管理者仍看得到全文（提案問題 11） | 收件人那邊消失；管理端留下「發過什麼」 |
| D19 | **軟刪除 ＋ 回收桶**（`TrashHandler`），還原後是 `paused`、不會自己開始發。發送紀錄隨公告永久刪除 CASCADE；另由 `announcement.dispatchRetentionDays`（預設 365）清理舊的發送紀錄（提案問題 12） | 公告是使用者編輯的內容，與角色、群組同一套 |
| D20 | **可關閉的 feature `announcement`**：停用時端點 `FEATURE_DISABLED`、排程的工作 no-op（`output = { skipped }`）、事件點不入列；資料保留 | 與 webhook（[`backend/17-webhook.md`](17-webhook.md) §9.2 D8）相同 |

不做：

- 管道 `email`（之後在事件目錄加管道；大量寄信的節流與退訂另開提案，提案問題 9）。
- 富文本、附件、多語系內容、排除名單、依屬性的動態受眾、自訂 cron、drip 序列、發送前的審批。
- 平台管理者對所有租戶的公告。
- 修改 `notify()` 的單次上限，或改成廣播模型。

### 9.3 實作階段

| 階段 | 內容 |
| --- | --- |
| A1 | 通知總覽（D1、D2）：索引、`GET /notifications/all`、`/notification/all` |
| A2 | 公告：資料表、`source_id`、受眾解析、`immediate`／`once`、fan-out、讀全文、撤回、回收桶、權限、feature |
| A3 | 週期：時區、`announcement.recurrence.ts`、暫停／恢復、`reconcile` |
| A4 | 事件點：`AnnouncementTriggerCatalog` 與第一批三個觸發點 |
| A5 | 歸檔：正式文件、刪除提案（提案的開放問題與結論併入上面的決定與實作紀錄） |

### 9.4 評估過的方案

- **每分鐘一個排程工作掃 `next_run_at`**（D8 的另一邊）：租戶排程會展開到每個租戶，每分鐘對每個租戶 DB 開連線，閒置租戶的連線池不會關。
- **每則公告註冊一個 pg-boss cron**：排程以工作名稱為 key、只有 UTC，要在平台 DB 動態增刪，租戶刪除時還要清。
- **廣播模型（一筆公告 ＋ 每人已讀表）**（D9 的另一邊）：[`backend/15-notification.md`](15-notification.md) §12.2 D6 已評估——列表要合併兩個來源、已讀兩種寫法、保留清理要兩套。
- **超過上限時截斷**（D6 的另一邊）：誰沒收到變成不可預期。
- **前後端各算一次週期**（D11 的另一邊）：DST 與月底的邊界會有兩份實作不一致。
- **以 `DomainEventBus` 觸發事件點**（D12 的另一邊）：不保證送達。

### 9.5 實作紀錄

| 項目 | 與上面的決定不同或補充的地方 |
| --- | --- |
| A1 | 前端頁面鍵 `NOTIFICATION_OVERVIEW_PAGE`、側邊選單「系統管理 › 通知總覽」；表格以「載入更多」接續 keyset，不顯示總數。租戶 migration `0028_notification_overview_idx`、`0029_notification_read_system_roles`（既有租戶的 admin 補鍵）。端點放在獨立的 `NotificationOverviewController`，與只需要登入的 `NotificationController` 分開 |
| A2 | 規格寫在本文與 [`../frontend/16-announcement.md`](../frontend/16-announcement.md)。與上面的決定不同或補充：撤回的端點是 `POST /announcements/:id/dispatches/:dispatchId/revoke`（掛在公告底下，與 webhook 的重送一致）；**草稿以外的公告修改要 `announcement:publish`**（路由宣告 update、service 另外檢查）、不能改成「立即」，已完成的不能改（D15、D17 的具體化）；受眾預覽要 `announcement:update`（不是 create）；暫停與恢復提前在 A2 做（只對 `once` 有意義，A3 套用到週期）；`defineNotification` 新增 `defaultAllowUserOverride`（D16 需要事件層級的預設）；發送紀錄的保留清理（D19 的 `dispatchRetentionDays`）與事件點的 `trigger_subject_id` 欄延到 A3、A4。租戶 migration `0030`、`0031`，平台 `0011` |
| A3 | 與 D10、D11、D19 不同或補充：**時區沿用既有的系統設定 `general.defaultTimezone`**（預設 `Asia/Taipei`，原本就是租戶層的預設時區），不另加 `system.timezone`——兩個時區設定會讓「顯示的時間」與「發送的時間」不一致；定義搬到 `core/settings/general.settings.ts` 讓公告模組讀得到。**不引入 `date-fns`／`@date-fns/tz`**：時區換算用 `Intl` 兩次校正（與前端 `@b2b-system/web-shared/date` 同一個做法），日曆運算在沒有時區的日期上做。`reconcile` 與發送紀錄的保留清理合成一個每日工作 `announcement.maintenance`（`ANNOUNCEMENT_MAINTENANCE_CRON`）；它也負責改了時區之後重算週期的下一次（不必在設定變更時另外掛勾子）。恢復排程時從現在起重算（暫停期間錯過的不補發）；週期沒有下一次時 `ANNOUNCEMENT_TRIGGER_IN_PAST` 帶 `details.reason: 'noOccurrence'` |
| A4 | 與 D12～D14 不同或補充：觸發點宣告時帶 **比對方式**（`scope`：`audience`／`group`／`role`），D14 的「加入的群組是受眾裡的群組」由 `group` 表達；第一批的 `user.rolesChanged` 改名為 **`user.roleAssigned`**（只算新增的角色，與既有的通知 `user.rolesChanged` 區分）；`user.activated` 也包含建立時就是 active 的帳號（外部 IdP 首次登入）。`fire()` 不快取，改以部分索引 `announcements_event_idx` 查詢；每則 × 每人入列一筆 `announcement.eventDispatch`（不是 D12 寫的 `announcement.dispatch`：事件點沒有 `next_run_at` 可比對），比對與「只發一次」在工作執行時判斷。端點 `GET /announcements/trigger-events`。租戶 migration `0032` |
