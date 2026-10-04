# 後端 16 — 事件管理（通知的租戶政策與個人設定）

系統會發出哪些通知事件、各經由哪些管道送達：租戶的管理者決定哪些要送、哪些允許個人關掉，使用者再在範圍內決定自己要不要收。
決策見 §9；通知本身（寫入、收件人、推播、保留）見 [`15-notification.md`](./15-notification.md)；
前端的管理頁與偏好頁的通知分頁見 [`../frontend/15-notification.md`](../frontend/15-notification.md) §9、§10。

---

## 1. 組成

```
db/schema/notification-policies.ts            notification_policies 表（租戶 DB）
db/schema/notification-preferences.ts         notification_preferences 表（租戶 DB，個人設定）
db/migrations/0020_notification_policies.sql  建表與 updated_at trigger（純加法）
db/migrations/0021_notification_preferences.sql  allow_user_override、enabled 可為 null、個人設定表（純加法）

modules/notification/
├── notification.definition.ts               defineNotification(type, meta)、NotificationChannel、AnyNotificationType
├── notification-event.catalog.ts            NotificationEventCatalog：擁有者模組登記事件（register / list / find / get）
├── notification-policy.repository.ts        覆寫值的讀寫
├── notification-policy.service.ts           NotificationPolicyService：filterRecipients()、isEnabled()、tenantPolicy()、list()、update()、快取
├── notification-event.controller.ts         GET／PATCH /notification-events
├── notification-preference.repository.ts    個人設定的讀寫、findOptedOut()（一次查完所有收件人）
├── notification-preference.service.ts       NotificationPreferenceService：自己的設定 list()、update()
├── notification-preference.controller.ts    GET／PATCH /me/notification-preferences
├── dto/notification-event.dto.ts            NotificationEvent、NotificationEventList、UpdateNotificationEventsRequest
└── dto/notification-preference.dto.ts       NotificationPreference、NotificationPreferenceList、UpdateNotificationPreferencesRequest

modules/approval/approval.notifications.ts   APPROVAL_NOTIFICATIONS（approval.pending、approval.result）
modules/user/user.notifications.ts           USER_NOTIFICATIONS（user.rolesChanged）
```

### 1.1 事件的定義

事件就是通知的 `type`。定義在擁有者模組的 `<name>.notifications.ts`，`defineNotification()` 的第二個參數是事件的中繼資料：

```ts
export const APPROVAL_RESULT_NOTIFICATION = defineNotification<ApprovalResultParams>(
  'approval.result',
  { category: 'approval', channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL] },
);
```

| 欄位 | 預設 | 說明 |
| --- | --- | --- |
| `category` | 必填 | 管理頁的分組（camelCase，通常是擁有者模組的名稱） |
| `channels` | 必填 | 這個事件 **能** 經由的管道：`inApp`（站內通知）、`email`（寄信）。不可為空或重複 |
| `defaultEnabled` | `true` | 租戶沒有覆寫時是否送出 |
| `mandatory` | `false` | 不能關（安全事件）：租戶的覆寫值不生效、`PATCH` 回 409。`mandatory` 卻 `defaultEnabled: false` 在載入時就失敗 |
| `feature` | — | 所屬的可啟用 feature（`TenantFeature`）：租戶沒啟用時不出現在管理頁，`PATCH` 視同沒有登記 |
| `defaultAllowUserOverride` | `true` | 租戶沒有覆寫時是否允許個人關掉。公告是 `false`（公司公告不該被個人靜音，[`backend/19-announcement.md`](19-announcement.md) §9.2 D16）；覆寫的列兩欄都等於預設值時刪除 |

格式不對（類型、分類、管道）在模組載入時就拋錯，不會等到第一次寫入。

### 1.2 登記

擁有者在自己的 `*.module.ts` constructor 登記，與 `SettingService.register()` 同一種做法；通知模組不認識任何業務模組：

```ts
@Module({ imports: [NotificationModule], … })
export class ApprovalModule {
  constructor(notificationEvents: NotificationEventCatalog) {
    notificationEvents.register(APPROVAL_NOTIFICATIONS);
  }
}
```

- 重複登記同一個類型讓程序啟動失敗。
- `notify()` 遇到 **沒有登記** 的類型拋 `Error`（呼叫端的程式錯誤，業務交易一起失敗）：發得出去的事件都在目錄上，管理頁不會漏列。

### 1.3 目前的目錄

| 事件 | 分類 | 管道 | 預設 | 擁有者 |
| --- | --- | --- | --- | --- |
| `approval.pending` | `approval` | `inApp` | 開 | `ApprovalModule` |
| `approval.result` | `approval` | `inApp`、`email`（既有的審核結果信 `approval.resultMail`） | 開 | `ApprovalModule` |
| `user.rolesChanged` | `user` | `inApp` | 開 | `UserModule` |
| `webhook.disabled` | `webhook` | `inApp` | 開（feature `webhook`） | `WebhookModule` |
| `announcement.published` | `announcement` | `inApp` | 開、預設不允許個人關閉（feature `announcement`） | `AnnouncementModule` |

**帳號流程的信不是事件**：啟用信、重設密碼信是完成流程必需的交易信，不進目錄、不受政策影響（§9.2 D3）。

---

## 2. 資料表

兩張表都只存 **覆寫值**（與 `system_settings` 相同，[`12-settings.md`](./12-settings.md) §1.1）；目錄上已經沒有的 `type`／`channel`
（事件被移除、管道被拿掉）讀取時忽略，`mandatory` 事件殘留的列不生效。

### 2.1 `notification_policies`（租戶層）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `type` | `text` | `<模組>.<事件>`，與 `notifications.type` 相同 |
| `channel` | `text` | `inApp` ｜ `email` |
| `enabled` | `boolean NULL` | `null`：跟著事件的 `defaultEnabled`（這一列只覆寫了 `allow_user_override`） |
| `allow_user_override` | `boolean`，預設 `true` | `false`：個人不能關（租戶要求每個人都收到） |
| `updated_at` | `timestamptz` | trigger `set_updated_at` 維護 |
| `updated_by` | `uuid NULL` → `users.id` `ON DELETE SET NULL` | |

PK `(type, channel)`。CHECK `notification_policies_has_override`：`enabled IS NOT NULL OR allow_user_override = false`
——兩欄都是預設的列不該存在，回到預設時刪掉那一列。

### 2.2 `notification_preferences`（個人）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `user_id` | `uuid` → `users.id` `ON DELETE CASCADE` | 使用者被永久刪除時一起刪 |
| `type`、`channel` | `text` | 同上 |
| `enabled` | `boolean` | 與租戶的生效值不同時才存一列；目前只會是 `false`（個人只能少收） |
| `updated_at` | `timestamptz` | trigger `set_updated_at` 維護 |

PK `(user_id, type, channel)`。租戶之後關掉或要求接收時，個人的列 **保留但不生效**；租戶再開放時恢復。

---

## 3. 判斷：`NotificationPolicyService`

```
送出 = mandatory ∨ (租戶開啟 ∧ (¬允許個人調整 ∨ 個人開啟))      （§9.2 D14）
租戶開啟 = 覆寫值 ?? defaultEnabled；允許個人調整 = 覆寫值 ?? true；個人開啟 = 個人覆寫 ?? 租戶開啟
```

| 方法 | 用途 |
| --- | --- |
| `filterRecipients(type, channel, recipientIds, tx?)` | 送達的判斷：回傳要送的收件人（保留順序）。租戶關閉回 `[]`；不允許個人調整或 `mandatory` 回全部；否則以一條 `WHERE user_id = ANY(…) AND type = … AND channel = … AND enabled = false` 排除自己關掉的人（D15） |
| `isEnabled(type, channel, tx?)` | 只看租戶層：收件人沒有帳號時用（匿名的註冊申請的結果信） |
| `tenantPolicy(type, channel, tx?)` | 租戶層的生效值 `{ enabled, allowUserOverride }`；個人設定判斷能不能調整 |

- 事件沒有登記、或事件不支援這個管道 → 拋 `Error`（程式錯誤）。
- 租戶的覆寫值整份快取，key 是租戶 id（一個租戶最多「事件數 × 管道數」列）；寫入的交易提交後 `invalidate()`：本程序立即失效，
  其他程序經廣播頻道 `notification_policy` 失效（[`../01-system.md`](../01-system.md) §4.4）；另有 30 秒 TTL 當保險。與系統設定相同。
  個人設定不快取：收件人每次不同，`notify()` 一種類型查一次。
- 在業務交易內呼叫時傳 `tx`：快取過期要重讀、查個人設定時沿用交易的連線，不在交易進行中另外佔一條。

### 3.1 站內通知：`notify()` 自己判斷

`NotificationService.notify()` 整理收件人（驗證、略過自己、去重、截斷）之後，對輸入裡的每一種類型呼叫
`filterRecipients(type, 'inApp', 收件人, tx)`，只寫留下來的。全部被略過的類型也會以空的收件人查一次：沒有登記的類型一律拋錯。
擁有者模組 **不必** 自己檢查（§9.2 D6）。

### 3.2 寄信：擁有者在入列前判斷

寄信的工作與範本屬於擁有者模組（[`11-mail.md`](./11-mail.md) §1），通知模組不代為入列，只提供判斷
（`NotificationService.filterRecipients()`／`isChannelEnabled()`）：

```ts
// modules/approval/approval.service.ts
const enabled = request.requesterId
  ? (await this.notifications.filterRecipients(
      APPROVAL_RESULT_NOTIFICATION, NotificationChannel.EMAIL, [request.requesterId], tx,
    )).length > 0
  : await this.notifications.isChannelEnabled(
      APPROVAL_RESULT_NOTIFICATION, NotificationChannel.EMAIL, tx,
    ); // 匿名的註冊申請：沒有帳號，只看租戶層
if (enabled) await this.jobs.enqueue(APPROVAL_RESULT_MAIL_JOB, { approvalId: request.id }, { tx });
```

判斷的是 **入列當下** 的設定：已入列的信不撤回。

### 3.3 關閉只影響之後

已寫入的通知照常保留、可讀，照保留政策清除；重新開啟 **不補發** 關閉期間的事件（§9.2 D7）。租戶與個人都一樣。

---

## 4. 租戶層 API（§9.2 D9、D10）

| 方法 | 路徑 | 授權 | 說明 |
| --- | --- | --- | --- |
| GET | `/notification-events` | `system:read` | 目前租戶看得到的事件（目錄的順序）與每個管道的 `enabled`、`defaultEnabled`、`isOverridden`、`allowUserOverride` |
| PATCH | `/notification-events` | `system:update` | `{ changes: [{ type, channel, enabled?: boolean \| null, allowUserOverride?: boolean }] }`；兩欄至少一個；`enabled: null` = 還原預設；1～100 筆 |

沿用系統設定的權限：事件政策是租戶層的營運設定，關掉通知不提權，安全事件由 `mandatory` 擋住。完整格式見 [`../../rbac/04-api-spec.md`](../../rbac/04-api-spec.md) §7.4。

`PATCH` 的規則（`NotificationPolicyService.update`，形狀與 `PATCH /system/settings` 相同）：

1. 每筆先驗證，全部通過才寫入：沒有登記、所屬 feature 沒啟用、或事件不支援這個管道 → `404 NOTIFICATION_EVENT_NOT_FOUND`（`details.type`、`details.channel`）；
   `mandatory` 的事件 → `409 NOTIFICATION_EVENT_MANDATORY`（`details.type`）；同一個事件 ＋ 管道出現兩次 → `400 VALIDATION_FAILED`。
2. 沒帶的欄位不改；`enabled` 與事件的預設值相同時存成 `null`（之後調整預設值時這個租戶才跟得上）；兩欄都回到預設時刪掉那一列。
   與目前相同的略過，全部都沒變就不寫稽核、不推播。
3. 一個交易內寫入所有修改，並寫 **一筆** 稽核：`notificationPolicy.update`、`resourceType: 'notificationPolicy'`、
   `resourceName` 是改到的 `<type>:<channel>`，`changes.before`／`changes.after` 是這些項目的生效值 `{ enabled, allowUserOverride }`。
4. 交易後失效快取，再推 `resource.changed`：每個改到的事件一筆 `{ resource: 'notificationPolicy', kind: 'update', id: <type> }`，
   推給 `system:read` 的人（[`08-realtime.md`](./08-realtime.md) §6.1）。

---

## 5. 個人設定（§9.2 D14、D15）

| 方法 | 路徑 | 授權 | 說明 |
| --- | --- | --- | --- |
| GET | `/me/notification-preferences` | `@Authenticated()` | 自己的設定：每個事件與管道的 `enabled`（會不會送給自己）、`isOverridden`、`lock` |
| PATCH | `/me/notification-preferences` | `@Authenticated()` | `{ changes: [{ type, channel, enabled: boolean \| null }] }`；`null` = 跟著租戶；1～100 筆 |

`lock` 是不能調整的原因，`null` 是可以調整：

| `lock` | 何時 | 顯示的 `enabled` |
| --- | --- | --- |
| `mandatory` | 安全事件 | `true` |
| `tenantDisabled` | 租戶關掉了這個管道（一律不送） | `false` |
| `tenantRequired` | 租戶不允許個人調整（每個人都收到） | `true` |

被鎖住時自己的覆寫不生效，`isOverridden` 也是 `false`。

`PATCH` 的規則（`NotificationPreferenceService.update`）：

1. 每筆先驗證，全部通過才寫入：沒有登記、所屬 feature 沒啟用、或事件不支援這個管道 → `404 NOTIFICATION_EVENT_NOT_FOUND`；
   被鎖住的管道給 `true`／`false` → `409 NOTIFICATION_PREFERENCE_LOCKED`（`details.type`、`details.channel`、`details.lock`）。
   還原（`null`）不論是否鎖住都可以。
2. 與租戶的生效值相同就不存（刪掉覆寫，跟著租戶）；與目前相同的略過。
3. 一個交易內寫入；**不寫稽核**：使用者自己的狀態，與已讀、個人資料相同。
4. 交易後推 `resource.changed`：每個改到的事件一筆 `{ resource: 'notificationPreference', kind: 'update', id: <type> }`，只推給本人
   （`affectedUserIds`，其他分頁與裝置跟著更新；不推給 `auditLog:read`）。

租戶政策改變時，推播只到 `system:read` 的人；其他使用者在下次打開偏好頁時重抓（前端的依賴圖讓 `notificationPolicy` 也失效個人設定）。

---

## 6. 錯誤碼

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `NOTIFICATION_EVENT_NOT_FOUND` | 404 | 事件沒有登記、所屬 feature 沒啟用，或該事件不支援這個管道（租戶層與個人設定都用） |
| `NOTIFICATION_EVENT_MANDATORY` | 409 | 租戶層試圖修改不能關的事件 |
| `NOTIFICATION_PREFERENCE_LOCKED` | 409 | 個人設定試圖修改被鎖住的管道（`details.lock`） |
| `VALIDATION_FAILED` | 400 | `changes` 為空、超過 100 筆、重複的事件 ＋ 管道、不認得的管道；租戶層的一筆兩欄都沒帶 |

---

## 7. 加入一種事件

照 [`15-notification.md`](./15-notification.md) §9 加一種通知；與事件管理有關的是：

1. `defineNotification()` 帶中繼資料（§1.1）；能寄信的事件 `channels` 加 `email`，並在擁有者的寄信入列前呼叫
   `filterRecipients()`（有帳號的收件人）或 `isChannelEnabled()`（沒有帳號）（§3.2）。
2. 放進擁有者模組的 `*_NOTIFICATIONS` 陣列；模組第一次有通知時，在 `*.module.ts` constructor 呼叫 `NotificationEventCatalog.register()`（§1.2）。
3. 前端 `features/notification/constants.ts` 的 `NOTIFICATION_EVENT_LABEL` 加名稱、說明與收件人；新的分類加進 `NOTIFICATION_EVENT_CATEGORY_LABEL_KEY`；
   兩個語系檔的 `notification.event.*`。管理頁與偏好頁的通知分頁共用這些文字。
4. 更新 §1.3 的目錄。

---

## 8. 測試

| 對象 | 檔案 |
| --- | --- |
| 授權（401／403、`system:read` 只能讀）、列表與預設值、關閉寫入覆寫與稽核、還原預設刪列、404 的各種情況、400；關掉 `approval.pending` 後審核者收不到、打開後恢復且不補發；關掉 `approval.result` 的 email 後不入列結果信、站內通知照常；個人設定（401、讀自己的、自己關掉後收不到通知也不入列結果信而別人照常、不寫稽核、租戶不允許調整時 409 且之前關掉的人照樣收到、租戶關掉時不能打開）；CHECK 約束、使用者永久刪除時個人設定一起刪 | `test/notification-events.spec.ts` |
| 目錄（重複登記、沒有登記）；`isEnabled`（預設、覆寫、管道各自獨立、`mandatory`、程式錯誤、快取與 `tx`、跨程序失效、租戶隔離）；`filterRecipients`（排除自己關掉的人、租戶關閉、不允許調整與 `mandatory`、空的收件人仍檢查登記）；`list`（生效值、`mandatory` 殘留的覆寫、只覆寫「允許個人調整」、feature 沒啟用不列出）；`update`（交易與稽核、只改其中一欄、與預設相同存 null、刪列、推播、略過沒有變化的、404、409） | `src/modules/notification/__tests__/notification-policy.service.spec.ts` |
| 個人設定：`list`（跟著租戶、自己的覆寫、三種 lock 與被鎖住時覆寫不生效）；`update`（寫列與推播給自己、回到租戶的值刪列、略過、409 帶原因而還原可以、404） | `src/modules/notification/__tests__/notification-preference.service.spec.ts` |
| `notify` 依租戶與個人設定略過（一種類型只查一次、只略過關掉的人）、全部關閉不寫不推、全部是自己仍檢查登記、沒有登記拋錯 | `src/modules/notification/__tests__/notification.service.spec.ts` |
| `defineNotification` 的中繼資料預設值與不合理的組合 | `src/modules/notification/__tests__/notification.batch.spec.ts` |
| 審批結果信：租戶關掉 email、有帳號的申請人自己關掉時不入列 | `src/modules/approval/__tests__/approval.service.spec.ts` |
| 端點的授權宣告 | `test/route-audit.spec.ts` |

---

## 9. 設計決策：事件管理

> 原 ADR-0028，2026-10-01 決定（確認過的問題 Q1～Q3 照預設，§9.6）；E1、E2 於 79d455f 合併，E3 於 717c9f5 合併。
> 取代 [`backend/15-notification.md`](15-notification.md) §12.2 D4「第一版不做通知偏好」（[`15-notification.md`](./15-notification.md) §12）。

### 9.1 背景

[`backend/15-notification.md`](15-notification.md) §12 讓擁有者模組在業務交易內呼叫 `NotificationService.notify()`，每位收件人一筆；D4 刻意不做偏好。
當時的類型只有三種，但接下來的 `import-export`、`tags-comments`、`webhooks`、`api-tokens`、`mfa` 都會加通知，
很快就會出現「這個租戶不需要這種通知」的情況，例如：

- 租戶用外部流程處理註冊審核，不希望審核者收到 `approval.pending`。
- 審批結果已經寄信，不想再多一則站內通知（或反過來，只要站內、不要信）。
- 之後的留言、關注通知量大，租戶想整類關掉。

唯一的做法是改程式。要的是一個 **事件管理** 的地方：列出系統會發出哪些事件、各經由哪些管道送達，
由租戶的管理者決定開或關；之後再讓使用者個人在租戶允許的範圍內調整。

這份決定處理 **租戶層** 的管理（E1、E2），並把 **個人層** 的形狀先定下來（E3），讓第一階段的資料模型與判斷點不必在 E3 重做。
「全租戶」指 **單一租戶內的所有使用者**（租戶 DB），不是平台管理者跨租戶統一設定；平台層的預設見 §9.3 的「不做」。

相關的既有決定與規格：[`backend/11-mail.md`](11-mail.md) §9（寄信一律經背景工作）、[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §9（可啟用的 feature）、
[`architecture/06-external-api.md`](../06-external-api.md) §9.2 D16（跨程序的快取失效）；[`15-notification.md`](./15-notification.md)、[`12-settings.md`](./12-settings.md)、[`11-mail.md`](./11-mail.md)、
前端 [`../frontend/15-notification.md`](../frontend/15-notification.md) §9、§10。

名詞：

| 名詞 | 意思 |
| --- | --- |
| 事件（event） | 一種會通知人的業務事件，就是通知的 `type`（`<模組>.<事件>`，例：`approval.pending`）。**不是** `DomainEventBus` 的事件 |
| 管道（channel） | 送達的方式：`inApp`（站內通知，[`backend/15-notification.md`](15-notification.md) §12）、`email`（經背景工作寄信，[`backend/11-mail.md`](11-mail.md) §9） |
| 政策（policy） | 某個事件在某個管道上是否送出。租戶層一份（E1），個人層每人一份（E3） |

### 9.2 決定

#### 事件目錄

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **事件定義在程式碼，資料庫只存覆寫值**（與系統設定同一個模式，`12-settings.md` §1）。`defineNotification()` 擴充成：<br>`defineNotification<Params>('approval.pending', { category: 'approval', channels: ['inApp'], defaultEnabled: true, mandatory: false, feature?: TenantFeature })`。<br>`channels` 是這個事件 **能** 經由的管道；`defaultEnabled` 是租戶沒有覆寫時的值；`mandatory` 見 D4；`feature` 是所屬的可啟用 feature（D11） | 事件是程式碼的一部分（收件人、參數、連結都由擁有者決定），清單不該由資料庫維護；沒有覆寫的租戶跟著程式的預設走，之後調整預設時才跟得上 |
| D2 | **擁有者模組登記自己的事件**：在 `*.module.ts` 的 constructor 呼叫 `notificationCatalog.register([...])`（與 `settings.register` 相同）。重複的 `type`、`channels` 為空、`mandatory` 卻 `defaultEnabled: false` 都讓程序啟動失敗。<br>`notify()` 遇到 **沒有登記** 的類型拋 `Error`（程式錯誤，業務交易一起失敗） | 通用模組不 import 業務模組（`07-layer-dependencies.md` §3.2）；登記與 `notify()` 的檢查一起保證「發得出去的事件都在目錄上」，管理頁不會漏列 |
| D3 | **第一批的目錄**：<br>• `approval.pending`：`inApp`<br>• `approval.result`：`inApp`、`email`（把既有的 `approval.resultMail` 納入管理）<br>• `user.rolesChanged`：`inApp`<br>三者都 `defaultEnabled: true`、`mandatory: false`——預設行為與當時完全相同。<br>**帳號流程的信不是事件**：啟用信、重設密碼信是使用者自己觸發、完成流程必需的交易信，不進目錄、不受政策影響 | 上線時沒有任何租戶的行為改變。關掉重設密碼信等於讓使用者無法重設密碼，這不是「要不要被通知」的問題 |
| D4 | **`mandatory` 的事件不能關**：租戶與個人都改不了，管理頁顯示鎖頭與原因。第一批沒有；保留給之後的安全事件（MFA 被停用、API Token 即將到期、新裝置登入） | 安全相關的提醒若能被關，就失去意義；機制先定，避免之後每個安全事件各自繞過政策 |

#### 租戶層的政策（E1）

| # | 決定 | 理由 |
| --- | --- | --- |
| D5 | **租戶 DB 的 `notification_policies` 表，只存覆寫值**：`type text`、`channel text`、`enabled boolean`、`updated_at`、`updated_by`（→ `users.id` `ON DELETE SET NULL`），PK `(type, channel)`。<br>沒有列 = `defaultEnabled`；還原預設 = 刪掉那一列。存了目錄上已經沒有的 `type`／`channel`（事件被移除）時忽略，不讓請求失敗 | 與 `system_settings` 一樣小、一樣好推理；(type, channel) 是自然鍵，不需要 uuid 與 `version`（整份政策以 PATCH 差異寫入，見 D9） |
| D6 | **在 `notify()` 內統一判斷，擁有者不必檢查**：`notify()` 依「類型 ＋ `inApp`」查政策，關閉時整批不寫、不推播（略過的筆數記 debug）。<br>寄信由擁有者在交易內以 `NotificationService.channelEnabled(kind, 'email')`（E3 起改為 `filterRecipients(kind, 'email', ids)`）決定要不要 `enqueue`；**在入列當下判斷**，已入列的信不撤回 | 判斷點只有一個，新增事件不會忘記檢查；寄信的工作與範本屬於擁有者模組（`11-mail.md` §1），通知模組不該代為入列，所以只提供判斷 |
| D7 | **關閉只影響之後**：已寫入的通知照常保留、可讀、照保留政策清除；重新開啟 **不補發** 關閉期間的事件 | 與 [`backend/15-notification.md`](15-notification.md) §12.2 D5「收件人是快照、不補發也不收回」同一個原則；補發需要記下所有被略過的事件 |
| D8 | **快取**：政策以租戶 id 為 key 整份快取（一個租戶最多「事件數 × 管道數」列），寫入的交易提交後 `invalidate()`，另有 30 秒 TTL；跨程序的失效接上 `core/broadcast`（[`architecture/06-external-api.md`](../06-external-api.md) §9.2 D16 的 T0 完成後即生效） | `notify()` 在業務交易內呼叫，不能每次多一個查詢；與系統設定、權限快取同一種做法 |

#### API 與權限

| # | 決定 | 理由 |
| --- | --- | --- |
| D9 | **API**（在 `modules/notification`）：<br>• `GET /notification-events`（`system:read`）：目錄 ＋ 生效值，每筆 `{ type, category, mandatory, feature, channels: [{ channel, enabled, defaultEnabled, isOverridden }] }`，另帶 `updatedAt`、`updatedBy`<br>• `PATCH /notification-events`（`system:update`）：`{ changes: [{ type, channel, enabled: boolean \| null }] }`，`null` = 還原預設；一次最多 100 筆。全部驗證通過才寫入：沒有登記的事件或該事件不支援的管道 → `404 NOTIFICATION_EVENT_NOT_FOUND`；`mandatory` 的事件 → `409 NOTIFICATION_EVENT_MANDATORY`；與生效值相同的略過。一個交易、**一筆** 稽核 `notificationPolicy.update`（`changes.before`／`after` 是改到的 `<type>:<channel>` 的生效值）；交易後失效快取，再推 `resource.changed`（新 `ChangeSource.NOTIFICATION_POLICY`）給 `system:read` 的人 | 形狀與 `PATCH /system/settings` 一致（差異寫入、`null` 還原、全有或全無、一筆稽核），前端的草稿與表單模式可以沿用 |
| D10 | **沿用 `system:read`／`system:update`，不新增權限鍵**（Q1） | 事件政策與系統設定同性質：租戶層的營運設定、值都安全（關掉通知不提權，`mandatory` 擋住安全事件），能改系統設定的人本來就能改通知的保留天數。多一組鍵只是讓角色設定多兩格 |
| D11 | **可啟用的 feature**：事件帶 `feature` 時，該 feature 沒有啟用就不出現在 `GET` 的結果裡，`PATCH` 視同沒有登記（404）。已存的覆寫值保留，重新啟用後照舊生效 | 與 [`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §9.2 D11 一致：未啟用的 feature 不暴露、資料保留 |

#### 前端（E2）

| # | 決定 | 理由 |
| --- | --- | --- |
| D12 | **頁面放在 `features/notification`**：路由 `/notification/events`，頁面權限 `NOTIFICATION_EVENT_PAGE`（`system:read`），側邊選單「系統管理 › 事件通知」。依 `category` 分組的表格：一列一個事件（名稱、說明、收件人說明），每個管道一個開關；有覆寫的顯示「已修改」與「恢復預設」；`mandatory` 的開關停用並有鎖頭與說明；沒有 `system:update` 時整頁唯讀。只送出改過的項目 | 後端在 `modules/notification`，前端對應同名 feature（CLAUDE.md「三處必須同步」）。不塞進系統設定頁：那頁是「一個 key 一個欄位」的表單，事件是「事件 × 管道」的矩陣，而且數量會隨功能成長 |
| D13 | **事件的名稱與說明在前端語系檔**：`notification.event.<type>.name`、`.description`、`.recipients`，key 寫在 `constants.ts` 的對照表（`06-literal-strings.md`）；分類用 `notification.eventCategory.<category>`。後端新增了前端還不認得的事件時，以 `type` 本身當名稱顯示，開關照常可用 | 與通知句子同一個做法（`frontend/15-notification.md` §5）；後端不送顯示文字 |

#### 個人層（E3）

| # | 決定 | 理由 |
| --- | --- | --- |
| D14 | **送達的判斷式**（E1 起就以這個形狀實作，E1 時個人層恆為「未覆寫」）：<br>`送出 = mandatory ∨ (租戶開啟 ∧ (¬租戶允許個人調整 ∨ 個人開啟))`<br>其中「個人開啟」沒有覆寫時等於租戶的生效值。租戶關掉的事件，**個人無法打開** | 租戶是上限，個人只能在上限內少收；「租戶強制、個人不能關」以「不允許個人調整」表達 |
| D15 | **E3 的資料與 API**：<br>• `notification_policies` 加 `allow_user_override boolean NOT NULL DEFAULT true`（純加法）<br>• 新表 `notification_preferences`：`user_id`（→ `users.id` `ON DELETE CASCADE`）、`type`、`channel`、`enabled`，PK `(user_id, type, channel)`，同樣只存覆寫值<br>• `GET`／`PATCH /me/notification-preferences`（`@Authenticated()`，只能改自己的；不能改的項目回 409）<br>• 頁面放在個人偏好頁的一個分頁<br>• `notify()` 以一條 `WHERE user_id = ANY($1) AND type = $2` 查收件人的偏好後過濾；不快取（收件人每次不同） | 先定形狀，E1 的表與判斷點就不必在 E3 改寫；個人偏好走後端，不沿用前端的 `core/preference`（[`backend/15-notification.md`](15-notification.md) §12.2 D4） |
| D16 | **E3 的實作紀錄補在這裡**（§9.7；D14、D15 的形狀沒有改變），前提是 D14、D15 的形狀不變；若要改（例：加「每日彙整」管道），另做決定 | 個人層的 UI 與 digest 等延伸需求當時還沒有明確的使用情境 |

### 9.3 分階段與不做

| 階段 | 內容 | 相容性 |
| --- | --- | --- |
| E1 後端 | `defineNotification` 的中繼資料與 `notificationCatalog.register`、三個既有事件登記（D3）、`notification_policies` 表與快取、`notify()` 的判斷、`approval.resultMail` 入列前的判斷、`GET`／`PATCH /notification-events`、稽核、`ChangeSource.NOTIFICATION_POLICY` | 純加法；沒有覆寫時行為與之前相同 |
| E2 前端 | `features/notification` 的事件通知頁、選單、語系、依賴圖（`notificationPolicy` 變更只失效這一頁） | 純加法 |
| E3 個人層 | D14、D15 | 純加法（加欄位、加表） |

不做：

- 平台層（apps/platform）替所有租戶設定預設：預設在程式碼，夠用；需要時再加平台 DB 的預設表，判斷式多一層。
- 依角色或群組設定（「只有某角色收到 X」）：收件人由擁有者計算（[`backend/15-notification.md`](15-notification.md) §12.2 D5），政策只決定「送不送」，不改「給誰」。
- 新的管道（手機推送、Slack、Webhook）與每日彙整；Webhook 是對外整合，有自己的訂閱模型（[`backend/17-webhook.md`](17-webhook.md) §9）。
- 帳號流程的信（D3）。
- 關閉期間的補發（D7）。

### 9.4 代價

| 代價 | 緩解 |
| --- | --- |
| 每個事件要多寫中繼資料並登記 | 與設定、背景工作同一個步驟；漏登記在第一次 `notify()` 就拋錯，整合測試會抓到 |
| `notify()` 多一次政策查詢 | 整份快取（D8），寫入時才失效 |
| 政策變更最慢 30 秒才在其他程序生效（T0 之前） | 關通知不是安全邊界；`mandatory` 的事件不受政策影響 |
| 寄信的判斷在擁有者那邊，可能漏寫 | 目前只有一封；[`15-notification.md`](./15-notification.md) §9「加入一種新通知」與本文 §7「加入一種事件」與目錄的 `channels` 一起列出步驟，`channels` 含 `email` 的事件以測試確認關閉時不入列 |

### 9.5 評估過的方案

| 方案 | 不採用的理由 |
| --- | --- |
| 存進 `system_settings`（key 例：`notification.event.approval.pending.inApp`） | 設定頁是靜態的 key 清單，事件 × 管道會讓它膨脹且隨功能變動；E3 的個人層也需要同形狀的表，分開後兩層一致 |
| 寫入後隱藏（照寫通知，列表時過濾） | 表照樣成長、未讀數要多一層判斷；關閉後再開會突然冒出舊通知 |
| 由擁有者模組自己檢查政策 | 每個寫入點都要記得檢查；判斷式在 E3 變複雜後更容易不一致（D6） |
| 新增 `notificationPolicy:read`／`update` 權限鍵 | 見 D10；若確認需要分開（Q1），只影響權限目錄與兩個路由宣告 |
| 只存租戶層的 `enabled`，E3 時再重新設計 | E3 會改動判斷點與表結構；先把判斷式定好成本很低（D14） |

### 9.6 確認過的問題

2026-10-01 確認，三題都採預設。

| # | 問題 | 結論 |
| --- | --- | --- |
| Q1 | 事件管理要不要獨立的權限鍵（例：只讓「通知管理員」改通知、不能改其他系統設定）？ | 不要，沿用 `system:read`／`system:update`（D10） |
| Q2 | 第一階段是否把 `approval.result` 的 **信** 一起納入管理？ | 納入：`approval.result` 有 `inApp`、`email` 兩個管道（D3） |
| Q3 | 管理頁放 `features/notification`（`/notification/events`）還是 `features/system`（`/system/notification-events`）？ | `features/notification`、`/notification/events`（D12），與後端模組同名 |

### 9.7 實作紀錄

與上面的決定不同、或決定沒寫到而實作時定下來的地方：

| 階段 | 項目 | 實作 |
| --- | --- | --- |
| E1 | 寄信的判斷（D6） | `NotificationService.isChannelEnabled(kind, channel, tx?)`（傳事件的定義，不是字串）；E3 再加 `filterRecipients` |
| E1 | `GET` 的形狀（D9） | `updatedAt` 放在每個管道上（覆寫是以「事件 ＋ 管道」為單位）；不回 `updatedBy`，與系統設定的 `GET` 相同 |
| E1 | 跨程序的失效（D8） | 與系統設定相同：本程序立即失效，其他程序經 `core/broadcast` 的頻道 `notification_policy`（[`architecture/06-external-api.md`](../06-external-api.md) §9 T0 已先上 main）；30 秒 TTL 當保險 |
| E1 | 判斷的位置 | `notify()` 對每一種類型都查政策（含之後會因「操作者自己」被略過的）：沒有登記的類型一律在這裡拋錯，不會因為剛好被略過而漏掉 |
| E1 | 交易內的查詢（D8） | `isEnabled(type, channel, tx)`：快取過期要重讀時沿用業務交易的連線 |
| E2 | 草稿（D12） | 有覆寫而切回預設值時送 `enabled: null`（還原預設），不留一筆與預設相同的覆寫；一整頁一份草稿、一次儲存 |
| E2 | 選單 | 「系統管理 › 事件通知」，排在系統設定之後（`menu-notification-event`） |
| E3 | `notification_policies.enabled`（D15） | 改成可為 `null`（跟著 `defaultEnabled`）：只覆寫「允許個人調整」時不必把 `enabled` 寫死成當下的預設值；加 CHECK `enabled IS NOT NULL OR allow_user_override = false`，兩欄都是預設的列不存在 |
| E3 | 租戶層的 `PATCH`（D9） | `changes` 的每筆帶 `enabled?`（`null` 還原）與 `allowUserOverride?`，至少一個；`enabled` 與預設相同時存成 `null`。稽核的值改成 `{ enabled, allowUserOverride }` |
| E3 | 個人層的 API（D15） | `GET`／`PATCH /me/notification-preferences`；每個管道回 `lock`（`mandatory`／`tenantDisabled`／`tenantRequired`／`null`），被鎖住時改值回 `409 NOTIFICATION_PREFERENCE_LOCKED`，還原（`null`）不受限 |
| E3 | 個人層的稽核與推播 | 不寫稽核（使用者自己的狀態，與已讀、個人資料相同）；推 `notificationPreference update` 只給本人 |
| E3 | 判斷的位置（D14） | `NotificationPolicyService.filterRecipients()` 是唯一的送達判斷；`notify()` 在驗證、略過自己、去重、截斷 **之後** 對每一種類型呼叫一次（E2 是在整理之前只看租戶層） |
| E3 | 寄信（D6） | 審批結果信：有帳號的申請人用 `filterRecipients()`；匿名的註冊申請沒有帳號，仍用 `isChannelEnabled()` 只看租戶層 |
| E3 | 個人設定頁（D15） | `features/notification` 以 `registerPreferenceSection`（`order: 100`）插進偏好頁，切換即儲存；租戶政策的推播只到 `system:read` 的人，其他人下次打開偏好頁時重抓 |
| E3 | 管理頁 | 每個管道多一個「允許個人關閉」的勾選，管道關閉時停用 |
