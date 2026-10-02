# 公告與排程通知（站內通知的管理端）

- 優先度：P2
- 狀態：實作中（branch：`feat/announcements`；決定見 [ADR-0031](../adr/0031-announcements.md)，已採用；A1 通知總覽、A2 公告已完成）
- 依賴：站內通知（已完成，[`backend/15-notification.md`](../architecture/backend/15-notification.md)）、事件管理（已完成，[`backend/16-notification-event.md`](../architecture/backend/16-notification-event.md)）、
  背景工作（已完成，[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)）、群組（已完成，[`rbac/08-groups.md`](../rbac/08-groups.md)）、
  可關閉的 feature（已完成，[ADR-0029](../adr/0029-toggleable-platform-features.md)）
- 相關：[ADR-0026](../adr/0026-notification-center.md) D5（收件人是快照）、D6（不做廣播模型、單次上限 1000）；[ADR-0028](../adr/0028-notification-event-management.md)（租戶政策與個人設定）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

站內通知目前只有 **程式發出** 的一種來源：擁有者模組在業務交易內呼叫 `NotificationService.notify()`（[`backend/15-notification.md`](../architecture/backend/15-notification.md) §3）。
因此有兩個缺口：

1. **管理者看不到全貌**：`GET /notifications` 只回自己的（§6）。「某則審核通知到底有沒有送到誰」「這個人最近收到哪些通知」沒有地方查；
   事件管理頁（`/notification/events`）只能開關，看不到實際送出的量。
2. **管理者不能自己發**：租戶要通知「下週六系統維護」「請在月底前完成年度權限複核」，只能在系統外另行聯絡。
   需要的是：寫一則訊息 → 選對象（指定的人、群組、角色、全租戶）→ 選時間（立即、指定時間、週期、某個事件發生時）。

既有零件與限制：

- 每位收件人一筆、單次 `notify()` 最多 1000 人、超過截斷（ADR-0026 D6）——全租戶公告會撞到上限。
- `notify()` 必須在 `withTransaction` 開的交易內呼叫，推播在提交後（§3.2）。
- 背景工作支援延遲執行（`EnqueueOptions.startAfter`，`core/jobs/job-queue.ts`），交易內入列走 `job_outbox`；
  但 pg-boss 的 `cron` 是 **以工作名稱** 註冊、UTC、全租戶共用，不能當成每個租戶、每則公告各自的排程。
- 群組的成員只存在 `relation_tuples`（巢狀），展開成使用者要經由 `core/authz`。
- 租戶 **沒有時區設定**（目前所有排程都是 UTC）；週期性的「每週一 09:00」需要一個時區。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 通知總覽：管理者檢視租戶內 **所有人** 的站內通知（篩選類型、收件人、觸發者、時間、已讀） | 修改或刪除程式發出的通知 |
| 公告：標題 ＋ 純文字內文，收件人在站內閱讀全文 | 富文本、Markdown、附件、圖片 |
| 受眾：指定使用者、群組（含巢狀）、角色、全租戶，取聯集；發送前預覽人數 | 排除名單、依屬性（部門、建立日期）篩選的動態受眾 |
| 觸發：立即、指定時間、週期（每天／每週／每月，含結束條件）、事件點（某事件發生時通知該事件的使用者，可延遲） | 自訂 cron 字串；「事件發生後每隔 N 天重複」的序列（drip） |
| 每次實際發送留一筆發送紀錄：內容快照、人數、已讀數、狀態；可撤回 | 管道 `email`（之後在事件目錄加管道即可，見開放問題 9） |
| 草稿、暫停／恢復排程、軟刪除與還原、樂觀鎖、稽核 | 審批流程（發送前要另一人核准） |
| 租戶時區（系統設定），週期依時區計算（含日光節約） | 平台管理者對所有租戶發公告（apps/auth） |
| 可由平台關閉的 feature `announcement`（ADR-0029） | 多語系內容（一則公告一種語言） |

## 使用者故事

**作為租戶管理者，我希望查到某位使用者收到過哪些通知、是否已讀，以便回答「我沒收到通知」的詢問。**

- **Given** 我持有 `notification:read`
- **When** 在「通知總覽」篩選收件人＝王小明、類型＝`approval.pending`
- **Then** 看到每一則的時間、觸發者、已讀時間；點開看到通知的參數與連結

**作為租戶管理者，我希望在指定時間通知「財務群組」系統維護，以便他們提前存檔。**

- **Given** 我持有 `announcement:create` 與 `announcement:publish`，「財務」群組底下還有「應付」子群組
- **When** 建立公告、受眾選「財務」、觸發選「2026-10-10 18:00（租戶時區）」並送出排程
- **Then** 到時間後「財務」與「應付」所有可登入的成員各收到一則通知；公告詳情出現一筆發送紀錄（人數、已讀率）

**作為租戶管理者，我希望每月 1 日 09:00 提醒所有主管做權限複核，持續到年底。**

- **Given** 受眾＝角色「主管」，觸發＝每月、1 日、09:00、結束於 2026-12-31
- **When** 每到 1 日 09:00
- **Then** 依 **當下** 持有該角色的人發送（快照，ADR-0026 D5）；年底後公告自動變成「已結束」

**作為租戶管理者，我希望新帳號啟用後隔天收到「新手指南」。**

- **Given** 觸發＝事件 `user.activated`、延遲 1 天
- **When** 有人完成帳號啟用
- **Then** 24 小時後那個人收到這則公告；同一人不會因重複事件收到兩次

**作為收件人，我點通知後看到公告全文；管理者撤回後，通知從我的列表消失。**

## 初步構想

### 名詞

| 名詞 | 意思 |
| --- | --- |
| 公告（announcement） | 管理者編輯的定義：內容、受眾、觸發方式、狀態。可編輯、有 `version` |
| 發送（dispatch） | 一次實際送出：內容與受眾的 **快照**、計畫時間、實際時間、人數、狀態。一則立即／指定時間的公告有一筆；週期與事件點的有多筆 |
| 通知（notification） | 既有的 `notifications` 列，每位收件人一筆；公告產生的通知類型是 `announcement.published`，`source_id` 指向發送 |

### 資料模型（全部在租戶 DB）

```
announcements
  id, title (≤ 120), body (純文字 ≤ 5000), audience jsonb, trigger jsonb,
  status ('draft' | 'scheduled' | 'paused' | 'completed'),
  next_run_at timestamptz NULL,             -- 週期／指定時間的下一次；事件點與草稿為 null
  created_by, updated_by, version, created_at, updated_at, deleted_at
  index (next_run_at) where status = 'scheduled' and deleted_at is null

announcement_dispatches
  id, announcement_id → announcements (ON DELETE CASCADE),
  scheduled_for timestamptz,                -- 計畫的發送時間（週期的某一次；事件點的是事件時間＋延遲）
  title, body,                              -- 內容快照：之後改公告不影響已發出的
  audience jsonb,                           -- 受眾快照（定義，不是人名單）
  trigger_subject_id uuid NULL,             -- 事件點：觸發的使用者
  status ('pending' | 'sending' | 'sent' | 'failed' | 'revoked'),
  recipient_count int, started_at, finished_at, revoked_at, revoked_by
  unique (announcement_id, scheduled_for) where trigger_subject_id is null     -- 同一次週期只發一次
  unique (announcement_id, trigger_subject_id) where trigger_subject_id is not null   -- 同一個人只收一次（開放問題 6）

notifications（既有，純加法）
  + source_id uuid NULL                     -- 公告的 dispatch id；程式發出的通知為 null
  + unique (source_id, recipient_id) where source_id is not null
  + index (created_at, id)、(type, created_at, id)    -- 通知總覽（跨收件人）
```

- `audience`：`{ all: boolean, userIds: uuid[], groupIds: uuid[], roleIds: uuid[] }`，各陣列有上限（例：各 200）。
- `trigger`（discriminated union，Zod）：

  | `kind` | 欄位 | `next_run_at` |
  | --- | --- | --- |
  | `immediate` | — | 送出時直接建立發送 |
  | `once` | `at` | `at` |
  | `recurring` | `frequency: daily \| weekly \| monthly`、`interval`（每 N 天／週／月）、`weekdays`（weekly）、`monthDay`（monthly，1～28 或 `last`）、`time`（`HH:mm`）、`startsOn`、`endsOn?`、`maxOccurrences?` | 依租戶時區算出的下一次 |
  | `event` | `event`（事件目錄的 key，見下）、`delayMinutes`（0～30 天） | null |

  週期 **不收 cron 字串**：畫面好做、驗證容易、`monthDay: 31` 這類邊界由選項本身排除。
- `notifications.source_id` 不加外鍵：發送紀錄被清理後通知仍可保留到通知自己的保留期（與 `type` 不用 enum 同理）。
  部分唯一索引讓分批寫入可以 **重做而不重複**（`ON CONFLICT DO NOTHING`）。

### 後端

```
modules/announcement/
├── announcement.notifications.ts       ANNOUNCEMENT_PUBLISHED_NOTIFICATION（category 'announcement'、inApp、feature 'announcement'）
├── announcement.triggers.ts            AnnouncementTriggerCatalog：擁有者模組登記可觸發的事件
├── announcement.recurrence.ts          nextOccurrence(trigger, after, timeZone)（純函式，單元測試覆蓋 DST、月底）
├── announcement.audience.ts            受眾 → 可登入的使用者 id（分頁的 async iterator）
├── announcement.service.ts             CRUD、publish、pause／resume、revoke、預覽人數
├── announcement-dispatch.job.ts        announcement.dispatch（延遲工作）、announcement.reconcile（每天補排程）
├── announcement.controller.ts
├── announcement-message.controller.ts  收件人讀全文（@Authenticated）
└── announcement.trash.ts               TrashHandler
modules/notification/
└── notification-admin.controller.ts    通知總覽（notification:read）
```

**排程機制：每一次發送是一筆延遲工作**（不輪詢）

1. 公告進入 `scheduled`（送出、恢復、編輯觸發）時，在同一個交易內算出 `next_run_at`，並
   `jobs.enqueue(ANNOUNCEMENT_DISPATCH_JOB, { announcementId, runAt, version }, { tx, startAfter: runAt })`。
2. handler 開交易、`SELECT … FOR UPDATE` 公告，**只在** `status = 'scheduled'`、`next_run_at = runAt` 時繼續——
   編輯或暫停過的公告，舊的工作自然變成 no-op（不需要去 pg-boss 取消）。
3. 建立 `announcement_dispatches`（`pending`，唯一索引擋重複）、算下一次並入列下一筆工作、沒有下一次就 `completed`；提交。
4. 另一個工作 `announcement.fanOut`（每個發送一筆）：分頁解析受眾，每 500 人一個交易呼叫 `notify()`（`source_id` = dispatch id）；
   重做時唯一索引略過已寫的人。全部完成後 `sent` ＋ `recipient_count`。
5. `announcement.reconcile`（每天，`scope: 'tenant'`）：`scheduled` 但 pg-boss 裡沒有對應工作（例：佇列被清除）的公告重新入列。

錯過的時間（worker 停機數小時）：恢復後 **只補發最近一次**，中間錯過的不連發（`next_run_at` 直接跳到未來）。

**為什麼不用其他做法**

| 做法 | 不採用的原因 |
| --- | --- |
| 每分鐘一個排程工作掃 `next_run_at <= now()` | 排程租戶工作會展開到 **每個** 租戶，每分鐘對每個租戶 DB 開連線，閒置租戶的連線池永遠不會關（[`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §4.1 第 2 點的同一個顧慮） |
| 每則公告註冊一個 pg-boss cron | pg-boss 的排程以工作名稱為 key、只有 UTC，且要在平台 DB 動態增刪排程；租戶刪除時還要清掉 |
| 廣播模型（一筆公告 ＋ 每人已讀表） | ADR-0026 D6 已評估：列表要合併兩個來源、已讀兩種寫法。分批 fan-out 讓列表、未讀數、推播、保留清理全部沿用 |

**受眾解析**（`announcement.audience.ts`）

- `userIds` ∪ 群組成員 ∪ 角色持有者 ∪（`all` 時）全部使用者，最後只留 **可登入** 的（未刪除、`status = 'active'`，與 [`backend/15-notification.md`](../architecture/backend/15-notification.md) §5 相同）。
- 群組與角色要沿關係圖反向展開：在 `AuthzService` 加 `usersInSubjectSets(subjects)`（`group:<g>#member`、`role:<r>#holder` → 使用者，
  同 `usersWithTenantRelations` 的遞迴 CTE、相同的過期邊與已刪除節點條件），不在公告模組自己查 `relation_tuples`。
- 已刪除的群組、角色在解析時略過；發送紀錄記下略過了哪些（`details`），詳情頁顯示。
- 發送是快照：之後才加入群組的人不會補收。

**事件點**（`announcement.triggers.ts`）

- 與事件目錄（`NotificationEventCatalog`）同一種做法：擁有者模組登記觸發點，在自己的業務交易內呼叫
  `announcementTriggers.fire(USER_ACTIVATED_TRIGGER, { userIds: [id] }, tx)`。不訂閱 `DomainEventBus`（不保證送達）。
- `fire()` 只做一件事：查出這個觸發點上 `scheduled` 的公告（快取，公告異動時失效），每則入列一筆 `announcement.dispatch`
  （`startAfter` = 現在＋延遲），走 outbox。沒有公告時成本是一次快取查詢。
- 收件人是 **事件的使用者**，再與公告的受眾取交集（受眾為 `all` 時不限制）——例：「財務群組的新人啟用時」。
- 第一批觸發點：`user.activated`（完成帳號啟用）、`group.memberAdded`（被加進群組；受眾的群組就是被加入的群組時才算）、
  `user.rolesChanged`（被指派角色）。

**政策**：`announcement.published` 登記進事件目錄（category `announcement`、管道 `inApp`、預設開、feature `announcement`）。
租戶可以整個關掉公告的站內通知；是否允許個人關掉由既有的 `allowUserOverride` 決定（開放問題 8）。

**收件人讀全文**：`GET /me/announcement-messages/:dispatchId`（`@Authenticated()`）只有在 `notifications` 有 `source_id = :dispatchId`、收件人是自己的列時回傳，
否則 `404 ANNOUNCEMENT_MESSAGE_NOT_FOUND`。同時把那則通知標為已讀。通知的 `params` 只放標題（名稱快照、≤ 4 KiB 的規則不變），全文從發送紀錄讀。

**撤回**：`POST /announcement-dispatches/:id/revoke` 刪除該發送的所有通知（依 `source_id`，分批）、狀態 `revoked`；
對收件人推 `{ resource: 'notification', kind: 'delete' }`（超過 100 人推不帶 id 的一則）。未讀數跟著下降。

### API

| Method | Path | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/notifications/all` | `notification:read` | 通知總覽：`type`、`recipientId`、`actorId`、`sourceId`、`from`／`to`、`unread`；keyset 分頁（同 `/notifications`） |
| GET | `/announcements` | `announcement:read` | 列表：`status`、觸發種類、關鍵字 |
| POST | `/announcements` | `announcement:create` | 建立草稿 |
| GET／PATCH／DELETE | `/announcements/:id` | `read`／`update`／`delete` | PATCH 必帶 `version`；`scheduled` 的公告改內容或受眾只影響之後的發送 |
| POST | `/announcements/:id/publish` | `announcement:publish` | 草稿 → 立即發送或 `scheduled` |
| POST | `/announcements/:id/pause`、`/resume` | `announcement:publish` | 暫停／恢復排程（恢復時重算 `next_run_at`） |
| POST | `/announcements/:id/restore` | `announcement:delete` | 回收桶還原（還原後是 `paused`，不會自己開始發） |
| POST | `/announcements/recurrence-preview` | `announcement:create` | 觸發設定 → 接下來 5 次的時間（租戶時區） |
| POST | `/announcements/audience-preview` | `announcement:create` | 受眾 → `{ count, skipped }`（不回名單） |
| GET | `/announcements/:id/dispatches` | `announcement:read` | 發送紀錄（人數、已讀數、狀態） |
| POST | `/announcement-dispatches/:id/revoke` | `announcement:publish` | 撤回 |
| GET | `/me/announcement-messages/:dispatchId` | 登入即可 | 收件人讀全文 |
| GET | `/announcement-triggers` | `announcement:read` | 可用的事件點（目錄，依啟用的 feature 過濾） |

### 前端（backstage）

- `features/announcement`（feature `announcement`）
  - `/announcement`：列表（狀態、觸發、下一次時間、最近一次的已讀率）
  - `/announcement/create`、`/announcement/$announcementId`：編輯（標題、內文、受眾選擇器、觸發設定）＋ 發送紀錄分頁
  - 受眾選擇器：使用者、群組、角色三個 `Select`（`searchable`、多選）＋「全租戶」開關，下方即時顯示預覽人數
  - 觸發設定：四個選項的分段控制；週期顯示「接下來 5 次」的預覽（由 `recurrence-preview` 回傳，前端不自己算）
  - route link `announcement.message`（`{ dispatchId }`）→ `/announcement/message/$dispatchId`：收件人看全文的頁面，**不要求** `announcement:read`
- `features/notification` 加 `/notification/all`（`notification:read`）：通知總覽表格，沿用既有的通知句子（`adapter.ts`）呈現每一列
- 時區：系統設定頁多一個 `system.timezone`；所有排程時間以租戶時區顯示並標註

### 權限

| 鍵 | 說明 | 依賴 |
| --- | --- | --- |
| `notification:read` | 檢視租戶內所有人的站內通知（總覽） | `user:read`（要看得到收件人） |
| `announcement:read` | 檢視公告與發送紀錄 | |
| `announcement:create` | 建立草稿、預覽受眾 | `announcement:read`、`user:read`、`group:read`、`role:read`（受眾選擇器） |
| `announcement:update` | 編輯公告 | `announcement:read` |
| `announcement:delete` | 刪除、還原 | `announcement:update` |
| `announcement:publish` | 發送、排程、暫停／恢復、撤回 | `announcement:update` |

`publish` 獨立於 `update`：能寫草稿的人不一定能對全租戶發話。預設角色：super-admin 全部、admin 全部、auditor 只有兩個 `read`。

### 稽核與推播

- 稽核（交易內）：`announcement.create`／`update`／`delete`／`restore`／`publish`／`pause`／`resume`、`announcementDispatch.revoke`。
  系統執行的發送不寫稽核，發送紀錄本身就是紀錄。
- 推播：通知沿用既有的 `resource.changed`（`notification`）；公告與發送紀錄的變更加 `ChangeSource.ANNOUNCEMENT`，受眾是 `announcement:read` 的 perm room。

### 分期

| 步驟 | 內容 |
| --- | --- |
| A1 | 通知總覽（`notification:read`、`/notification/all`、`notifications` 的兩個索引） |
| A2 | 公告：資料表、受眾解析、`immediate`／`once`、分批 fan-out、讀全文、撤回、回收桶 |
| A3 | 週期：`system.timezone`、`announcement.recurrence.ts`、暫停／恢復、`reconcile` |
| A4 | 事件點：`AnnouncementTriggerCatalog` 與第一批三個觸發點 |

A1 與公告無關，可以先做先上。

## 開放問題

2026-10-02 全部採用建議；決定整理在 [ADR-0031](../adr/0031-announcements.md)。

1. **總覽看得到別人通知的參數，算不算洩漏？** 例如 `approval.pending` 的 `subject` 是申請人的顯示名稱、`user.rolesChanged` 帶角色名稱。
   建議：`notification:read` 只給 super-admin 與 admin（他們本來就看得到稽核日誌裡的同樣資訊），auditor 不預設給。

   結論：採用建議（ADR-0031 D2）。
2. **是否修改 ADR-0026 D6？** 本提案維持「每人一筆」，只是讓公告以分批 fan-out 繞過單次 1000 的上限，`notify()` 本身的上限不變。
   需要一份新 ADR 說明「公告為什麼不走廣播模型」，並在 ADR-0026 標註。

   結論：不修改 D6；在 ADR-0031 D9 與「評估過的方案」說明，歸檔時在 ADR-0026 的相關欄標註。
3. **一則公告的收件人上限？** 分批後技術上沒有上限，但 5 萬人的租戶一次寫 5 萬列、推 5 萬則。建議：上限做成系統設定 `announcement.maxRecipients`（預設 10000），超過時發送失敗並在詳情顯示原因，不截斷。

   結論：採用建議（ADR-0031 D6）。
4. **週期的計算放哪？** 前端也要顯示「接下來 5 次」。建議：只在後端算（`POST /announcements/recurrence-preview`），避免兩份實作在 DST 與月底的邊界不一致。
   另外，Node 24 的 `Temporal` 是否可用，或要引入 `date-fns-tz`／`@js-temporal/polyfill`？

   結論：只在後端算（`POST /announcements/recurrence-preview`）。Node 24.21 沒有 `Temporal`（已確認），用 `date-fns` ＋ `@date-fns/tz`（ADR-0031 D11）。
5. **租戶時區的預設值？** 通用型後台不應假設台灣。建議：預設 `UTC`，租戶建立時（apps/auth 的佈建）可填；改時區後已排程的公告重算 `next_run_at`。

   結論：系統設定 `system.timezone`，預設 `UTC`；這一版不在佈建時填（ADR-0031 D11）。
6. **事件點的重複事件**：同一個人被移出又加回群組，要不要再收一次？建議：同一則公告對同一個人只發一次（唯一索引），公告改版（編輯內容）也不重發。

   結論：採用建議（ADR-0031 D13）。
7. **編輯已排程的公告**：改內容只影響之後的發送（快照）；改觸發時重算 `next_run_at`、舊工作變 no-op。要不要另外支援「編輯並重發給已收到的人」？建議不做，撤回後再發一次即可。

   結論：採用建議（ADR-0031 D17）。
8. **個人能不能關掉公告？** 建議：事件目錄的 `announcement.published` 預設 `allowUserOverride = false`（公司公告不該被個人靜音），租戶可自行打開；
   不設 `mandatory`，否則租戶也關不掉。

   結論：採用建議（ADR-0031 D16）。
9. **要不要同時寄信？** 第一版只有 `inApp`。之後加 `email` 管道時，大量寄信要走 `MAIL_JOB_OPTIONS` 的節流，並需要退訂連結——另開提案。

   結論：第一版只有 `inApp`（ADR-0031「不做」）。
10. **公告要不要有版本歷史**（`RevisionService.record`，[`backend/14-revisions.md`](../architecture/backend/14-revisions.md)）？發送紀錄已有內容快照，建議不做。

   結論：不做（ADR-0031 D17）。
11. **撤回之後，已讀全文的人怎麼辦？** 撤回會刪通知，收件人之後打開舊連結得到 404。是否保留發送紀錄的全文給管理者查？建議保留（狀態 `revoked`），只刪通知。

   結論：採用建議（ADR-0031 D18）。
12. **發送紀錄的保留期？** 建議跟著公告：公告永久刪除（回收桶到期）時 CASCADE；另設 `announcement.dispatchRetentionDays`（預設 365）清理舊的週期發送。

   結論：採用建議（ADR-0031 D19）。

## 歸檔去向

完成後預計寫成：

- [`docs/adr/0031-announcements.md`](../adr/0031-announcements.md)（排程以延遲工作實作、分批 fan-out 而非廣播模型、受眾快照、事件點的登記方式）
- `docs/architecture/backend/18-announcement.md`；`15-notification.md` 補 `source_id`、通知總覽、`kind: 'delete'` 的推播；`10-jobs.md` 的工作表；`12-settings.md` 的 `system.timezone`
- `docs/architecture/frontend/16-announcement.md`；`frontend/15-notification.md` 補總覽頁
- `docs/rbac/02-permission-catalog.md`（`notification:read`、`announcement:*`）
