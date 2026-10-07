# 後端 15 — 站內通知

「有事等你處理」與「你的東西被動了」：每位收件人一筆、可以回頭看、有已讀／未讀。
決策見 §12；前端（鈴鐺、列表頁、route id 註冊表）見 [`../frontend/15-notification.md`](../frontend/15-notification.md)。
租戶可以關掉某些事件或管道：事件目錄與租戶的政策見 [`16-notification-event.md`](./16-notification-event.md)（[`backend/16-notification-event.md`](16-notification-event.md) §9）。

目前的類型與收件人見 §4 的表（新增類型時只改那裡）；平台管理者的類型見 §6.2。

---

## 1. 組成

```
db/schema/notifications.ts               notifications 表（租戶 DB）
db/migrations/0015_notifications.sql     建表與索引（純加法）
db/migrations/0028_notification_overview_idx.sql      通知總覽的兩個索引（純加法）
db/migrations/0029_notification_read_system_roles.sql 手寫：既有租戶的 admin 補 notification:read

modules/notification/                    通用模組：不 import 任何業務模組
├── notification.definition.ts          defineNotification()、notification()、NotificationInput、NotificationLink、NotificationChannel（純函式）
├── notification-event.catalog.ts       NotificationEventCatalog：擁有者登記事件（16-notification-event.md §1.2）
├── notification-policy.*.ts            租戶層的政策：判斷、快取、管理頁的讀寫（16-notification-event.md）
├── notification-event.controller.ts    GET／PATCH /notification-events
├── notification.batch.ts               prepareNotifications()：驗證、略過自己、去重、截斷（純函式）
├── notification.constants.ts           MAX_NOTIFICATION_RECIPIENTS（1000）、params 上限、分頁與清理的批次大小
├── notification.cursor.ts              keyset 游標的編碼與解碼
├── notification.repository.ts          批次寫入、列表、未讀數、已讀、保留清理的一批
├── notification.service.ts             NotificationService：notify()、list()、unreadCount()、markRead()、markAllRead()、cleanup()
├── notification.controller.ts          GET /notifications、GET /notifications/unread-count、POST /notifications/:id/read、POST /notifications/read-all
├── notification-overview.controller.ts GET /notifications/all（通知總覽，`notification:read`；§6.1）
├── notification-cleanup.job.ts         notification.cleanup 背景工作
├── notification.settings.ts            notification.retentionDays、notification.maxPerUser
└── dto/notification.dto.ts             ListNotificationSchema、Notification、NotificationLink、NotificationPage…

modules/approval/approval.notifications.ts   approval.pending、approval.result 的宣告與參數型別
modules/user/user.notifications.ts           user.rolesChanged 的宣告與參數型別
```

- **通知模組不認識業務**（D2）：類型、參數、收件人與連結都由擁有者模組決定，在自己的業務交易內呼叫 `notify()`。
  擁有者 import `NotificationModule` 使用 `NotificationService`，並從 `notification.definition.ts` 取純函式
  （[`../../coding-standards/07-layer-dependencies.md`](../../coding-standards/07-layer-dependencies.md) §3.2 註 2；🔒 `layer-dependencies.spec.ts`）。
- **不訂閱 `DomainEventBus`**：bus 是程序內、fire-and-forget、錯誤吞掉，也沒有「給誰」的語意（[`08-realtime.md`](./08-realtime.md) §7.2）。
  通知與業務寫入在同一個交易：業務成功，通知就一定在；rollback 時一起消失（與稽核同一條規則）。
- 平台管理者（apps/platform）的通知是另一份：表在平台 DB，規則見 §6.2。

---

## 2. `notifications` 表

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `recipient_id` | `uuid` → `users.id` `ON DELETE CASCADE` | 收件人。使用者只會軟刪除；被永久刪除（`trash.purge`）時通知一起刪掉 |
| `type` | `text` | `<模組>.<事件>`（camelCase，與 `defineJob` 同一種命名）；text ＋ 擁有者模組的常數，不用 Postgres enum（[`02-database.md`](./02-database.md) §1） |
| `params` | `jsonb` | 組句子用的名稱快照（純量與字串陣列，序列化後 ≤ 4 KiB）；不存整份資料，也不存權限相關的東西 |
| `link` | `jsonb NULL` | `{ route, params }`：前端的 route id ＋ 參數（D3，§4.1）；null＝只顯示文字 |
| `actor_id` | `uuid NULL` → `users.id` `ON DELETE SET NULL` | 觸發的人；null＝系統（匿名的註冊申請也是 null）。觸發者被永久刪除時通知保留、觸發者變成 null（與 `revisions.actor_id`、`created_by` 同一個規則，[`13-trash.md`](./13-trash.md) §4.2） |
| `read_at` | `timestamptz NULL` | 已讀時間；null＝未讀 |
| `source_id` | `uuid NULL`（無外鍵） | 產生它的來源：公告的發送紀錄（[`19-announcement.md`](./19-announcement.md) §2.3）；程式發出的通知為 null。`(source_id, recipient_id)` 部分唯一：同一個來源對同一個人只有一筆，`notify()` 遇到重複時略過（`ON CONFLICT DO NOTHING`） |
| `created_at` | `timestamptz` | |

索引（依查詢決定，**與 §12.2 D1 寫的單一索引不同**）：

| 索引 | 欄位 | 服務的查詢 |
| --- | --- | --- |
| `notifications_recipient_created_idx` | `(recipient_id, created_at, id)` | 列表（`ORDER BY created_at DESC, id DESC` 由反向掃描取得）、keyset 的列比較、清理的「每人超過上限」 |
| `notifications_recipient_unread_idx` | `(recipient_id, created_at, id) WHERE read_at IS NULL` | 未讀數、`unread=true` 的列表、全部已讀；只收未讀的列，索引很小 |
| `notifications_read_at_idx` | `(read_at) WHERE read_at IS NOT NULL` | 清理的「已讀超過 N 天」（跨所有收件人） |
| `notifications_created_idx` | `(created_at, id)` | 通知總覽不分收件人的列表（§6.1） |
| `notifications_type_created_idx` | `(type, created_at, id)` | 通知總覽依類型篩選 |

D1 的 `(recipient_id, read_at, created_at desc)` 讓「全部」的列表在 `read_at` 之後才排時間，要多一次排序；拆成全部與未讀兩個索引後，
兩種列表都直接照索引的順序讀。欄位用升冪：drizzle 的 `.desc()` 會產生 `DESC NULLS LAST`，與查詢預設的 `DESC`（NULLS FIRST）對不上而用不到索引的順序。

---

## 3. 寫入：`NotificationService.notify(input | input[], tx)`

### 3.1 宣告一種通知

擁有者模組在 `<name>.notifications.ts` 宣告類型與參數型別：

```ts
// modules/user/user.notifications.ts
export type UserRolesChangedParams = { added: string[]; removed: string[] };
export const USER_ROLES_CHANGED_NOTIFICATION = defineNotification<UserRolesChangedParams>(
  'user.rolesChanged',
  { category: 'user', channels: [NotificationChannel.IN_APP] },
);
export const USER_NOTIFICATIONS: readonly AnyNotificationType[] = [USER_ROLES_CHANGED_NOTIFICATION];
```

- 參數型別用 `type` 別名（`interface` 沒有隱含的索引簽章，不符合 `NotificationParams` 的約束）。
- 第二個參數是事件管理的中繼資料（分類、管道、預設、`mandatory`、所屬 feature；[`16-notification-event.md`](./16-notification-event.md) §1.1）。
  宣告之後還要在擁有者的 `*.module.ts` 以 `NotificationEventCatalog.register()` 登記，沒有登記的類型 `notify()` 會拋錯。
- `defineNotification()` 在模組載入時檢查名稱格式與中繼資料；`notification(kind, { params })` 以 `kind` 推導 `params` 的型別，
  **類型與參數配錯在編譯期就失敗**。

### 3.2 在業務交易內寫入

```ts
await withTransaction(this.db, async (tx) => {
  // … 業務寫入 ＋ 稽核
  await this.notifications.notify(
    notification(USER_ROLES_CHANGED_NOTIFICATION, {
      recipientId: id,
      actorId: actor.id,
      params: { added, removed },
      link: ACCOUNT_PROFILE_LINK,
    }),
    tx,
  );
});
```

`notify()` 依序：

| 步驟 | 規則 |
| --- | --- |
| 驗證 | 收件人與操作者是 uuid、類型與 route id 的格式、`params` 只有純量與字串陣列且 ≤ 4 KiB。不符是呼叫端的程式錯誤：拋 `Error`，業務交易一起失敗 |
| 略過自己 | 操作者就是收件人時不寫（D7）；`actorId` 為 null（系統）不算 |
| 去重 | 同一次呼叫裡「同一類型 ＋ 同一位收件人」只留第一筆；不同類型各自保留 |
| 截斷 | 超過 `MAX_NOTIFICATION_RECIPIENTS`（1000）時記 warn 並只寫前 1000 筆（D6）；業務照常成功 |
| 政策 | 每一種類型呼叫 `NotificationPolicyService.filterRecipients(type, 'inApp', 收件人, tx)`：租戶關掉的整批不寫、收件人自己關掉（租戶允許時）的略過；沒有登記進事件目錄的類型拋 `Error`（[`16-notification-event.md`](./16-notification-event.md) §3.1） |
| 寫入 | 一條 `INSERT … VALUES (…), (…)` 寫完 |
| 推播 | 以 `afterCommit(tx, …)` 登記：**交易提交後** 發一則 `resource.changed`，以 `perRecipient` 帶每位收件人自己的通知 id，listener 逐人推到各自的 user room（§7） |

- `tx` 必須是 `withTransaction` 開的交易：要登記提交後的推播，其他交易（含 savepoint）呼叫 `afterCommit` 會拋錯。
- 收件人由擁有者在寫入當下算好，是快照（D5）：之後權限變動 **不補發也不收回**；點進去照常經過頁面權限與 API 權限。

---

## 4. 第一批類型（D11）

| 類型 | 收件人 | `params` | `link` | 寫入點 |
| --- | --- | --- | --- | --- |
| `approval.pending` | 送出當下持有 `approval:review` 的可登入使用者（§5），不含申請人自己 | `approvalType`、`requesterName`（申請人的 email）、`subject`（handler 的一行摘要） | `approval.detail`（`{ approvalId }`） | `ApprovalService.submit()` 的交易內（註冊、資料夾存取申請都經過這裡） |
| `approval.result` | 申請人（`requester_id`）；匿名的註冊沒有收件人，只有結果信 | `approvalType`、`subject`、`status`（`approved` \| `rejected`） | handler 的 `resultLink()`；沒有就是 `approval.detail`（`{ approvalId }`） | `ApprovalService.approve()`／`reject()` 的交易內；既有的結果信照舊 |
| `user.rolesChanged` | 被指派或移除角色的人（`PUT /users/:id/roles`）；沒有實際增減時不通知 | `added`、`removed`（角色名稱） | `account.profile`（`{}`） | `UserService.replaceRoles()` 的交易內 |
| `announcement.published` | 公告受眾解析出的人（不含送出者） | `title` | `announcement.message`（`{ dispatchId }`） | `AnnouncementDispatchService.fanOut()` 每 500 人一個交易（帶 `sourceId`；[`19-announcement.md`](./19-announcement.md) §5） |
| `webhook.disabled` | webhook 連續失敗而自動停用時，當下持有 `webhook:update` 的人 | `webhookName`、`consecutiveFailures`、`url`（到達門檻的網址；[`architecture/05-tenancy.md`](../05-tenancy.md) §13 前寫入的沒有） | `webhook.detail`（`{ webhookId }`） | `WebhookDeliveryService.attempt()` 的交易內（觸發者是系統；[`17-webhook.md`](./17-webhook.md) §4） |

- `subject` 由各審批類型的 `ApprovalHandler.summarize(payload)` 提供（handler 在擁有資源的模組）：
  `user.register` 是申請人填的顯示名稱，`fileFolder.access` 是資料夾名稱。解析不了（舊資料）時是空字串。
- `fileFolder.access` 的 `resultLink()` 連到申請的資料夾（`file.folder`）：申請人通常沒有 `approval:read`，連到審批詳情只會看到 403。
- **不通知** 的操作：還原或刪除角色（[`backend/14-revisions.md`](14-revisions.md) §9 R3）時持有者的角色也跟著出現或消失，但那是角色層級的操作、可能一次影響上千人，
  第一版不發 `user.rolesChanged`；需要時由角色模組另定一種類型（例：`role.restored`）。
- `fileFolder.access` 的待審只通知 `approval:review` 的持有者（D11 的定義）；資料夾的管理者（在該資料夾有 `share`）也能在檔案管理器審核，
  但沒有 `approval:review` 的不會收到。之後要通知他們時由檔案模組算收件人（資料夾層級的 `share` 持有者）再呼叫 `notify()`。

### 4.1 route id

`link.route` 是前端的 route id（`<feature>.<頁面>`，可再多層；格式由 `notify()` 驗證）。前端的 feature 在 plugin 的 **同步階段**
以 `registerRouteLink()` 把 route id 登記成 route（`features/<name>/routeLinks.ts`，[`../frontend/15-notification.md`](../frontend/15-notification.md) §3）；
找不到的只顯示文字、不可點（D3）。已發出的 route id **不改名**：舊通知靠它連結。

| route id | 參數 | 前端的頁面 | 由誰使用 |
| --- | --- | --- | --- |
| `approval.detail` | `approvalId` | `/approval/$approvalId`（`ApprovalDetailRoute`，審核對話框疊在列表上） | `approval.pending`、`approval.result`（預設） |
| `file.folder` | `folderId` | `/file?folder=<folderId>`（`FileListRoute` 的 search 參數 `folder`） | `approval.result`（`fileFolder.access`） |
| `account.profile` | — | `/profile`（`ProfileRoute`） | `user.rolesChanged` |
| `announcement.message` | `dispatchId` | `/announcement/message/$dispatchId`（`AnnouncementMessageRoute`，收件人看全文；feature `announcement` 沒啟用時不登記） | `announcement.published` |
| `webhook.detail` | `webhookId` | `/webhook/$webhookId`（`WebhookDetailRoute`，詳情對話框疊在列表上；feature `webhook` 沒啟用時不登記） | `webhook.disabled` |

---

## 5. 收件人：持有某個權限的人

`PermissionService.findActiveUserIdsWithPermission(key)`（[`05-rbac.md`](./05-rbac.md) §4）回傳目前持有 `key` 的 **可登入** 使用者：
未刪除、`status = 'active'`（登入失敗鎖定中的仍算，鎖定會自己到期；停用、未啟用的不算），含 super-admin 與經由權限依賴樹帶來它的鍵。

兩段：

1. **反向查詢找候選**（`AuthzService.usersWithTenantRelations(relations)`，一條遞迴 CTE）：`relations` 是 `key`、目錄中所有（遞迴）帶來它的鍵
   （`implyingPermissions`）與 `superAdmin`。從租戶節點上這些關係的邊往主體展開，經由 `role#holder` 走到使用者；過期的邊、已刪除的角色不算
   ——與正向解析的主體閉包（`subjectClosures`）同一張圖、同樣的條件，方向相反，走 `relation_tuples_object_idx`。
2. **過濾與確認**：`users` 表去掉停用與刪除的人，再以授權用的正向解析（`getPermissionSets`，批次）確認每個人真的持有 `key`。
   反向查詢只負責縮小範圍；是否持有由同一個判斷器決定，模型之後改變（巢狀群組、新的關係）也不會算錯，頂多候選變多。

萬用字元主體（`user:*`）不展開：租戶型別的關係只允許 `role#holder` 當主體（`buildTenantType`），不會出現。

呼叫端在交易 **之前** 算好（不佔用交易的時間），在交易內寫入通知。

---

## 6. API（D9）

下表四個端點都是 `@Authenticated()`：只需要登入；每個端點都只看得到、改得到自己的。看所有人的通知是另一個端點（§6.1）。完整格式見 [`../iam/04-api.md`](../iam/04-api.md) §7.3。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/notifications?limit=&cursor=&unread=` | 新的在前；keyset 分頁（`limit` 1～100，預設 20）；`unread=true` 只列未讀。回 `{ items, nextCursor }`，不計總數 |
| GET | `/notifications/unread-count` | `{ count }` |
| POST | `/notifications/:id/read` | 標為已讀（已讀過的保留原本的時間），回傳該則通知；不是自己的與不存在的一樣回 `404 NOTIFICATION_NOT_FOUND` |
| POST | `/notifications/read-all` | 自己所有未讀的標為已讀，回 `{ updated }` |

- **keyset 而非 offset**（[`03-api-conventions.md`](./03-api-conventions.md) §2 的例外，與檔案列表同理）：通知會在捲動途中不斷新增在最前面，
  offset 會讓下一頁重複前一頁的最後幾筆。游標是上一頁最後一筆的 `created_at`（微秒精度，由資料庫格式化）＋ id，
  條件 `(created_at, id) < (…)`；格式不對回 `400 VALIDATION_FAILED`（`details.field: 'cursor'`）。時間只接受 encode 時的格式
  （UTC、毫秒或微秒，日期與時間的每一欄都存在；`core/http` 的 `isCursorTimestamp`）：V8 的 `Date.parse` 比 Postgres 寬鬆，
  `2026-02-30`、`2026`、`0` 都過得了它，進 SQL 時卻會讓 Postgres 拋錯、回 500。
- 每筆帶 `actor: { id, name } | null`（`users` 的 left join，被軟刪除的人照樣顯示名字）。
- 已讀與全部已讀 **不寫稽核**：使用者自己的狀態，量大、沒有稽核價值。

### 6.1 通知總覽（[`backend/19-announcement.md`](19-announcement.md) §9.2 D1、D2）

`GET /notifications/all`（`notification:read`）：租戶內 **所有人** 的通知，給管理者回答「到底有沒有送到」。

| 項目 | 規則 |
| --- | --- |
| 篩選 | `type`、`recipientId`、`actorId`、`unread=true`、`from`／`to`（ISO 8601，`from` 晚於 `to` 回 400）；可以組合 |
| 分頁 | 同 `/notifications`：keyset、`limit` 1～100（預設 20）、回 `{ items, nextCursor }`、不計總數 |
| 每一列 | `/notifications` 的欄位 ＋ `recipient: { id, name }`（`users` 的 inner join；收件人被軟刪除時照樣顯示名字，被永久刪除時通知已一起刪掉） |
| 權限 | `notification:read` 依賴 `user:read`（每一列都帶收件人）。只預設給 admin：`params` 帶申請人名稱、角色名稱等，auditor 不預設（D2） |
| 稽核 | 只讀，不寫稽核（與稽核日誌的列表相同） |
| 推播 | 沒有專屬的推播：通知只推給收件人（§7）。前端把總覽放在 `notification` 的 collection，自己的通知變化時跟著重抓，別人的要重新整理 |

### 6.2 平台管理者的通知（apps/platform）

平台管理者與租戶的使用者是兩份帳號（[`architecture/04-sso.md`](../04-sso.md) §1.1），通知也是兩份：
租戶的在各租戶 DB 的 `notifications`，平台的在平台 DB 的 `platform_notifications`（migration `db/platform/migrations/0013_platform_notifications.sql`）。

```
modules/platform-notification/            葉節點：只依賴 core、credential 的純函式與平台的權限目錄
├── platform-notification.constants.ts    PlatformNotificationType、route id、保留天數
├── platform-notification.repository.ts   寫入、收件人（某些角色的啟用中管理者）、列表、未讀數、已讀、清理的一批
├── platform-notification.service.ts      notify(adminIds)、notifyHolders(權限)、list、unreadCount、markRead、markAllRead、cleanup
├── platform-notification.controller.ts   /platform/notifications 的四個端點
└── platform-notification-cleanup.job.ts  platformNotification.cleanup（平台一份，排程同 NOTIFICATION_CLEANUP_CRON）
```

| 項目 | 平台的規則（與租戶不同的地方） |
| --- | --- |
| 類型 | `tenant.provisioned`、`tenant.provisionFailed`（收件人：角色有 `tenant:create` 的啟用中管理者；佈建在背景工作裡跑，建立的人多半已離開那一頁）；`platformAdmin.roleChanged`（收件人：被換角色的本人） |
| 寫入時機 | 業務完成 **之後**，失敗只記錄、不讓業務失敗：佈建已經完成，不能因為通知寫不進去而回報失敗。租戶的通知在業務交易內寫入（§3.2），平台的寫入點（背景工作、管理者管理）沒有共同的交易可以加入 |
| 欄位 | 沒有 `actor_id`、`source_id`：平台的通知都是系統發出的，也沒有公告 |
| API | `GET /platform/notifications?offset=&limit=&unread=`（**offset** 分頁、回 `{ items, pagination }`）、`GET /platform/notifications/unread-count`、`POST /platform/notifications/:id/read`（已讀過的不算錯；別人的與不存在的一樣 `404 NOTIFICATION_NOT_FOUND`）、`POST /platform/notifications/read-all`。都是 `@Authenticated()`，只在 apps/platform 的網域有效（`/platform/*`） |
| 分頁 | offset 而非 keyset：平台的通知只有佈建結果與換角色，一個人一年不到幾百則，捲動途中新增造成的重複可以接受 |
| 推播 | `platform.changed`（`platformNotification`，`adminIds` 是收件人），只推給收件人在 apps/platform 上的連線（[`08-realtime.md`](./08-realtime.md) §3.6） |
| 偏好 | 沒有事件管理與個人設定（[`16-notification-event.md`](./16-notification-event.md)）：類型少，都是要處理的事 |
| 保留 | 已讀超過 30 天、或建立超過 180 天的刪除（固定值，平台沒有系統設定） |
| 前端 | apps/platform 的 `features/notification`：頂列的鈴鐺（`registerHeaderTool`，order 400）與 `/notification` 列表頁；連結以 `@b2b-system/web-core/route-link` 的 route id（`tenant.detail`、`account.profile`）解析 |

---

## 7. 推播（D8）

`ChangeSource.NOTIFICATION`（`notification`，`packages/realtime`）。受眾只有收件人自己的 user room（`t:{tenantId}:user:{id}`），
沒有任何 perm room，也 **不** 讓 `auditLog:read` 的人重抓（`AudienceRule.recordsAudit: false`；通知不寫稽核）。見 [`08-realtime.md`](./08-realtime.md) §6.1。

| 時機 | payload | 受眾 |
| --- | --- | --- |
| 新通知（`notify()` 的交易提交後） | 每位收件人各收到一則：`{ resource: 'notification', kind: 'create', id: <他自己的通知 id> }`；一次超過 100 則時改推一筆不帶 id 的 | 收件人自己。一批只發 **一則** 領域事件，`perRecipient` 帶「收件人 → 他的通知 id」（[`08-realtime.md`](./08-realtime.md) §7.1） |
| 標為已讀 | `{ resource: 'notification', kind: 'update', id }`（帶 `origin`，發起的分頁略過） | 自己（其他裝置與分頁的未讀數跟著更新） |
| 全部已讀（有更新時） | `{ resource: 'notification', kind: 'update' }` | 自己 |
| 撤回公告的發送（`removeBySource`，[`19-announcement.md`](./19-announcement.md) §3） | 每位收件人各收到一則 `{ resource: 'notification', kind: 'delete', id }`（超過 100 則改推不帶 id 的） | 收件人自己；每刪一批發一則領域事件（`perRecipient`） |
| 保留清理的刪除 | 不推：被刪的都是列表最後面的舊通知，下次重抓就不見了 | — |

- 推播由 `afterCommit` 在交易提交時就發出，早於業務 service 在交易之後才發的 `permissions.changed` 與 `resource.changed`；
  兩者互不依賴（通知推到 user room，與 perm room 的同步無關）。
- payload 只帶 id，前端收到後讓通知列表與未讀數的 query 失效，稽核列表不動（[`../frontend/15-notification.md`](../frontend/15-notification.md) §6）。
- 一批（例：公告每 500 人一個交易）只發一則領域事件，不是每位收件人一則：每一則事件都要經平台 DB 轉送（[`08-realtime.md`](./08-realtime.md) §7.6），
  每人一則時發給上萬人的公告會讓同一個租戶的其他推播排在後面幾秒到十幾秒。

---

## 8. 保留與清除（D10）

| 項目 | 內容 |
| --- | --- |
| 工作 | `notification.cleanup`（`scope: 'tenant'`、`exclusive`），排程 `NOTIFICATION_CLEANUP_CRON`（預設 `0 5 * * *`，每天 05:00 UTC；空字串停用） |
| 設定 | `notification.retentionDays`（預設 30，1～365）、`notification.maxPerUser`（預設 500，10～5000）；[`12-settings.md`](./12-settings.md) §3 |
| 條件 | 刪除「已讀超過 `retentionDays` 天」的通知；再刪除「不在每人最新 `maxPerUser` 則內」的通知（不論已讀與否）。未讀的在上限內保留 |
| 分批 | 每批最多 1000 筆一條 `DELETE`（各自提交）；不滿一批就結束。中途失敗重跑只剩還沒刪的 |
| 結果 | 工作的 `output`：`{ retentionDays, maxPerUser, cutoff, deletedRead, deletedBeyondLimit }` |

- 「每人超過上限」以列表的順序排名（`row_number() OVER (PARTITION BY recipient_id ORDER BY created_at DESC, id DESC)`），被刪的一定是列表最後面的。
- 兩次排程之間一個人可能暫時超過上限；上限是保留政策，不是寫入時的檢查。
- 清除不寫稽核：保留政策的執行，不是誰的操作。

---

## 9. 加入一種新通知

1. 在擁有者模組的 `<name>.notifications.ts` 以 `defineNotification<Params>('<模組>.<事件>', { category, channels })` 宣告，`Params` 只放名稱快照；
   放進該模組的 `*_NOTIFICATIONS`，在 `*.module.ts` constructor 以 `NotificationEventCatalog.register()` 登記（[`16-notification-event.md`](./16-notification-event.md) §7）。
   同一個事件也寄信時，`channels` 加 `email`，寄信入列前呼叫 `notifications.isChannelEnabled(KIND, 'email', tx)`。
2. 收件人在擁有者模組算：持有某個權限的人用 `PermissionService.findActiveUserIdsWithPermission()`（§5）；在交易之前算好。
3. 在業務交易內（稽核之後）呼叫 `notifications.notify(notification(KIND, { … }), tx)`；擁有者的 module import `NotificationModule`。
4. 連結用既有的 route id（§4.1）；新的 route id 加進 §4.1 的表，前端的 feature 在 plugin 的同步階段註冊。
5. 前端：`features/notification` 的 `constants.ts`／`adapter.ts` 加這個類型（句子與事件管理頁的 `NOTIFICATION_EVENT_LABEL`）、兩個語系檔加句子與 `notification.event.*`（依 `type` 找 i18n key，字面量對照表，[`../frontend/15-notification.md`](../frontend/15-notification.md) §5）；新的 route id 由擁有頁面的 feature 登記。
6. 測試：寫入點的整合測試（收件人、參數、rollback 不留下）。

---

## 10. 錯誤碼

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `NOTIFICATION_NOT_FOUND` | 404 | 標為已讀的通知不存在、不是自己的、或已被保留清理刪除 |
| `VALIDATION_FAILED` | 400 | 游標格式不對（`details.field: 'cursor'`）、`limit` 超出範圍 |

---

## 11. 測試

| 對象 | 檔案 |
| --- | --- |
| 收件人（super-admin、依賴樹、排除沒有權限／停用／未啟用／刪除的人、已刪除的角色、過期的邊）；`notify` 與業務同一個交易（rollback 不留下）、略過自己；端點（只看自己的、新的在前、keyset 分頁不重複不漏且不受新通知影響、`unread` 篩選、未讀數、已讀保留原本的時間、別人的與不存在的 404、全部已讀、已讀不寫稽核、未登入 401）；三個寫入點（匿名註冊通知審核者且沒有結果通知、申請人有審核權限時不通知自己、駁回通知申請人、指派角色帶增減名稱、送同一組不通知）；保留清理依設定；外鍵（收件人刪除 CASCADE、觸發者 SET NULL） | `test/notifications.spec.ts` |
| 推播只到收件人的 user room、payload 是通知 id、稽核的讀者收不到；指派角色時通知早於 `userRole` | `test/realtime.spec.ts` |
| 受眾表：`notification` 只有 user room、不加 `auditLog:read` | `src/modules/realtime/__tests__/realtime.audience.spec.ts` |
| `notify` 在交易提交後才推播、rollback 不推、一批一則事件（500 人也是一則、每人只帶自己的 id）、全部略過時不寫、截斷與 warn、超過 100 則的推播、不是 `withTransaction` 的交易拋錯；游標錯誤、404、已讀的推播；清理的分批與設定、排程註冊 | `src/modules/notification/__tests__/notification.service.spec.ts` |
| `defineNotification` 的名稱格式、`params` 的編譯期檢查、`prepareNotifications`（略過自己、去重、截斷、各種不合格式）、游標的編碼與解碼 | `src/modules/notification/__tests__/notification.batch.spec.ts` |
| `findActiveUserIdsWithPermission` 的反向查詢帶的關係、以正向解析確認 | `src/modules/permission/__tests__/permission.service.spec.ts` |
| 審批送出與審核時的通知（收件人、參數、連結、`resultLink`、匿名沒有結果通知、重複送出不通知） | `src/modules/approval/__tests__/approval.service.spec.ts` |
| 通知總覽：未登入 401、一般使用者與 auditor 403、admin 看得到所有人的（新的在前、收件人與觸發者、軟刪除的收件人）、各種篩選與組合、跨收件人的 keyset 分頁、參數錯誤 400 | `test/notifications.spec.ts` |
| 端點的授權宣告 | `test/route-audit.spec.ts` |
| 平台管理者的通知（§6.2）：只有角色有 `tenant:create` 的人收到佈建結果、推播只到收件人、列表與未讀數、別人的通知 404、換角色通知本人、保留清理 | `test/platform-realtime.spec.ts` |

---

## 12. 設計決策：站內通知中心

> 原 ADR-0026，2026-10-01 決定；N1、N2 於 8c51ff5 合併。
> D4「第一版不做通知偏好」已由 [`backend/16-notification-event.md`](16-notification-event.md) §9 接續（租戶層的事件管理與個人設定，[`16-notification-event.md`](./16-notification-event.md)）；
> 管理者發送的公告沿用 D5、D6，以分批寫入繞過單次上限，見 [`backend/19-announcement.md`](19-announcement.md) §9.2 D9。

### 12.1 背景

使用者需要知道「有事等你處理」與「你的東西被動了」，但當時沒有能回頭看的地方：推播只送讓快取失效的訊號、
前端只有關掉就消失的 toast、會主動通知人的只有幾封信，審批送出時審核者什麼都收不到。
匯入匯出、標籤留言、Webhook、MFA、API Token 都會需要「通知某人」，所以這個機制要先定。

相關的既有決定與規格：[`backend/08-realtime.md`](08-realtime.md) §15（推播只送訊號）、[`backend/10-jobs.md`](10-jobs.md) §9（背景工作與 `job_outbox`）；
[`08-realtime.md`](./08-realtime.md) §6.1、§7、[`10-jobs.md`](./10-jobs.md)、[`12-settings.md`](./12-settings.md)、
[`../frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §6、[`../../coding-standards/07-layer-dependencies.md`](../../coding-standards/07-layer-dependencies.md) §3.2；
前端見 [`../frontend/15-notification.md`](../frontend/15-notification.md)。

### 12.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **租戶 DB 的 `notifications` 表，每位收件人一筆**：`id`、`recipient_id`（→ `users.id`，`ON DELETE CASCADE`）、`type`（`<模組>.<事件>`，與 `defineJob` 同一種命名）、`params jsonb`（組句子用的參數，名稱快照）、`link jsonb`（D3，可為 null）、`actor_id`（null＝系統）、`read_at`、`created_at`；索引 `(recipient_id, read_at, created_at desc)`（實作改成三個索引，見 §12.6）。平台管理者不適用 | 通知跟著租戶走；每人一筆讓已讀、刪除、保留都是單列操作。`params` 只放顯示需要的名稱，不存整份資料，也不存權限相關的東西 |
| D2 | **由擁有者模組在自己的業務交易內寫入**：`modules/notification` 提供 `NotificationService.notify(input \| input[], tx)`，寫入後在交易提交後發佈推播。通知模組 **不 import 業務模組**；通知類型與參數型別定義在擁有者模組的 `<name>.notifications.ts`。**不訂閱 `DomainEventBus`** | 與稽核同一條規則：業務寫入成功，通知就一定在。`DomainEventBus` 是程序內、fire-and-forget、錯誤吞掉，也沒有「給誰」的語意（`08-realtime.md` §7） |
| D3 | **連結存 route id ＋ 參數**（提案開放問題 1）：`link = { route: '<route id>', params: {...} }`。前端有一張 route id → route 物件的註冊表，feature 在 plugin 的 **同步階段** 註冊（與 `registerPagePermission` 同一種做法）；notification feature 不 import 其他 feature 的 route。找不到 route id 時只顯示文字、不可點 | 路由改名或搬移時舊通知不會壞；存路徑字串則每次改路由都要考慮歷史資料 |
| D4 | **第一版不做通知偏好**（提案開放問題 2；已由 [`backend/16-notification-event.md`](16-notification-event.md) §9 接續：租戶層的事件管理，個人層的形狀亦已定）：只有站內通知，既有的信（審批結果、啟用、重設密碼）照舊。之後要做時另加後端的偏好表，不沿用前端的 `web-core/preference` | 偏好需要後端的偏好表與設定頁，範圍會翻倍；第一批類型量少，還沒有「太吵」的問題 |
| D5 | **收件人由擁有者模組在寫入當下計算，是快照**（提案開放問題 3）：例如「審批待審」＝送出時持有 `approval:review` 的使用者（透過 `PermissionService` 查，不交給通知模組）。之後權限變動 **不補發也不收回**；點進去照常經過頁面權限與 API 權限，權限已被收回就是 403 | 補發或收回要訂閱權限變化並重算所有未處理的事件，複雜度遠高於價值；通知本身不授予任何權限 |
| D6 | **第一版不做廣播模型**（提案開放問題 4）：一律每位收件人一筆。`notify` 單次的收件人數有上限（常數，暫定 1000），超過時記 warn 並截斷——需要全租戶公告時再加「一筆廣播 ＋ 每人已讀表」 | 第一批類型的收件人都不多（審核者、申請人、被指派的人）；先不讓列表查詢合併兩個來源 |
| D7 | **操作者就是收件人時不通知**（例如自己改自己的角色）。`actor_id` 仍記錄，前端顯示「由誰觸發」 | 自己做的事不需要提醒自己 |
| D8 | **推播**：新增 `ChangeSource.NOTIFICATION`，`RealtimeAudience` 送到收件人的 user room（`t:{tenantId}:user:{id}`）；payload 照舊只帶 id，前端收到就讓 notification 的 query 失效 | 沿用既有的推播管線與「只送訊號」的規則（[`backend/08-realtime.md`](08-realtime.md) §15） |
| D9 | **API**（都是 `@Authenticated()`，只能看自己的，不新增權限鍵）：`GET /notifications`（keyset 分頁，`unread=true` 篩選）、`GET /notifications/unread-count`、`POST /notifications/:id/read`、`POST /notifications/read-all`。已讀與清除 **不寫稽核** | 看自己的通知只需要登入；已讀是使用者自己的狀態，量大、沒有稽核價值 |
| D10 | **保留**：背景工作 `notification.cleanup`（`scope: 'tenant'`，每天）刪除「已讀超過 N 天」與「每人超過上限的最舊通知」；系統設定 `notification.retentionDays`（預設 30）、`notification.maxPerUser`（預設 500） | 表不能無限成長；未讀的通知在上限內保留 |
| D11 | **第一批類型**：`approval.pending`（給送出當下有 `approval:review` 的人，不含申請人自己）、`approval.result`（給申請人；既有的結果信照舊）、`user.rolesChanged`（被指派或移除角色的人，`params` 帶增減的角色名稱） | 這三個是現有流程已經卡住的地方（審核者不知道有待審） |
| D12 | **前端**：新 feature `features/notification`：以 `registerHeaderTool` 放鈴鐺與未讀數，點開是 `Popover` 內的列表（沿用 `Select`／`Menu` 的虛擬捲動）與「全部已讀」；另有完整列表頁。句子依 `type` 找 i18n key（字面量，`06-literal-strings.md`）；未知的 `type` 顯示通用文字。未讀數由 query 取得，不存 localStorage | 伺服器資料的複本不放 localStorage（`frontend/09-state-and-storage.md` §4.2）；registry 與同步註冊是既有模式 |

### 12.3 分階段與不做

| 階段 | 內容 | 相容性 |
| --- | --- | --- |
| N1 後端 | `notifications` 表、`modules/notification`（service、repository、controller）、`ChangeSource.NOTIFICATION`、`notification.cleanup` 與設定、三個類型的寫入點 | 純加法 |
| N2 前端 | route id 註冊表、`features/notification`（鈴鐺、Popover、列表頁）、各 feature 註冊 route id | 純加法 |

不做：

- 通知偏好、寄信或其他管道（D4）；手機與桌面推送；通知彙整（digest）。
- 廣播模型（D6）；平台管理者（apps/platform）的通知。
- 權限變動後補發或收回通知（D5）。

### 12.4 代價

| 代價 | 緩解 |
| --- | --- |
| 每個需要通知的業務寫入多一次 INSERT（在交易內） | 收件人少；批次 INSERT 一次寫完 |
| 收件人是快照，權限收回後仍看得到通知的文字 | `params` 只放名稱，不含敏感資料；點進去照常檢查權限 |
| 每個 feature 要多註冊一次 route id | 註冊在 plugin 的同步階段，與頁面權限同一處，漏註冊只會讓連結不可點 |

### 12.5 評估過的方案

| 方案 | 不採用的理由 |
| --- | --- |
| 訂閱 `DomainEventBus` 產生通知 | 不保證送達、沒有收件人語意（D2） |
| 經 `job_outbox` 由背景工作寫入 | 保證送達，但多一跳延遲，且收件人的計算要在工作裡重做；在交易內直接寫入同樣保證一致 |
| 連結存路徑字串（D3 的替代） | 路由一改舊通知就壞 |
| 第一版就做廣播模型（D6 的替代） | 列表要合併兩個來源、已讀要兩種寫法；目前沒有需要它的類型 |

### 12.6 實作紀錄

與上面的決定不同、或決定沒寫到而實作時定下來的地方：

| 階段 | 項目 | 實作 |
| --- | --- | --- |
| N1 | 索引（D1） | 依查詢拆成三個：全部列表 `(recipient_id, created_at, id)`、未讀的部分索引、已讀過期清理的 `(read_at)`；登記在 `CLAUDE.md`「與文件不同的實作決定」（§2） |
| N1 | 已讀的推播（D8） | 標為已讀、全部已讀也推 `notification update` 給自己，其他裝置與分頁的未讀數跟著更新（發起的分頁以 `origin` 略過） |
| N1 | 不通知的操作（D11） | 刪除或還原角色時持有者的角色跟著消失或出現，但不發 `user.rolesChanged`（角色層級的操作、可能影響上千人） |
| N1 | `fileFolder.access` 的待審（D11） | 只通知 `approval:review` 的持有者；只在該資料夾有 `share` 的管理者也能審核但收不到 |
| N2 | route id 註冊表（D3） | `core/route-link`（現為 `@b2b-system/web-core/route-link`）：`registerRouteLink(id, { route, params?, search? })` 以對照表宣告「route 的參數 ← 連結參數」，登記時檢查 id 格式與 path 的 `$參數`；可啟用的 feature 卸載時撤回，連結變成不可點 |
| N2 | 稽核列表的失效（D8） | 前端依賴圖的 `derivesFromAnyChange` 改成可以排除來源，稽核列表排除 `notification`——與後端 `recordsAudit: false` 對稱；否則收到通知、按已讀都會重抓稽核列表 |
| N2 | 推播不可用時（D12） | 未讀數在推播斷線或停用時每 60 秒重抓一次 |
| N2 | 語系包（D12） | 鈴鐺在每一頁都看得到：按鈕的字放全域語系包，Popover 的內容由鈴鐺掛上時自己載入 feature 的 scope |
| N2 | 列表頁 | `/notification` 只需要登入（`access: []`），沒有側邊選單項目，入口是鈴鐺的「查看全部」 |
