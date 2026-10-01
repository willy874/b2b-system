# 後端 16 — 事件管理（通知的租戶政策與個人設定）

系統會發出哪些通知事件、各經由哪些管道送達：租戶的管理者決定哪些要送、哪些允許個人關掉，使用者再在範圍內決定自己要不要收。
決策見 [ADR-0028](../../adr/0028-notification-event-management.md)；通知本身（寫入、收件人、推播、保留）見 [`15-notification.md`](./15-notification.md)；
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

**帳號流程的信不是事件**：啟用信、重設密碼信是完成流程必需的交易信，不進目錄、不受政策影響（ADR-0028 D3）。

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
送出 = mandatory ∨ (租戶開啟 ∧ (¬允許個人調整 ∨ 個人開啟))      （ADR-0028 D14）
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
擁有者模組 **不必** 自己檢查（ADR-0028 D6）。

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

已寫入的通知照常保留、可讀，照保留政策清除；重新開啟 **不補發** 關閉期間的事件（ADR-0028 D7）。租戶與個人都一樣。

---

## 4. 租戶層 API（ADR-0028 D9、D10）

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

## 5. 個人設定（ADR-0028 D14、D15）

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
