# 後端 16 — 事件管理（通知的租戶政策）

系統會發出哪些通知事件、各經由哪些管道送達，以及租戶的管理者決定哪些要送、哪些不送。
決策見 [ADR-0028](../../adr/0028-notification-event-management.md)；通知本身（寫入、收件人、推播、保留）見 [`15-notification.md`](./15-notification.md)；
前端的管理頁見 [`../frontend/15-notification.md`](../frontend/15-notification.md) §9。

目前只有 **租戶層**（E1、E2）。個人層（E3）的判斷式與資料形狀已在 ADR-0028 D14、D15 定好，尚未實作。

---

## 1. 組成

```
db/schema/notification-policies.ts            notification_policies 表（租戶 DB）
db/migrations/0020_notification_policies.sql  建表與 updated_at trigger（純加法）

modules/notification/
├── notification.definition.ts               defineNotification(type, meta)、NotificationChannel、AnyNotificationType
├── notification-event.catalog.ts            NotificationEventCatalog：擁有者模組登記事件（register / list / find / get）
├── notification-policy.repository.ts        覆寫值的讀寫
├── notification-policy.service.ts           NotificationPolicyService：isEnabled()、list()、update()、快取
├── notification-event.controller.ts         GET／PATCH /notification-events
└── dto/notification-event.dto.ts            NotificationEvent、NotificationEventList、UpdateNotificationEventsRequest

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

## 2. `notification_policies` 表

只存 **覆寫值**：沒有列 = 事件的 `defaultEnabled`；還原預設 = 刪掉那一列（與 `system_settings` 相同，[`12-settings.md`](./12-settings.md) §1.1）。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `type` | `text` | `<模組>.<事件>`，與 `notifications.type` 相同 |
| `channel` | `text` | `inApp` ｜ `email` |
| `enabled` | `boolean` | |
| `updated_at` | `timestamptz` | trigger `set_updated_at` 維護 |
| `updated_by` | `uuid NULL` → `users.id` `ON DELETE SET NULL` | |

PK `(type, channel)`。目錄上已經沒有的 `type`／`channel`（事件被移除、管道被拿掉）讀取時忽略；`mandatory` 事件殘留的列不生效。

---

## 3. 判斷：`NotificationPolicyService.isEnabled(type, channel, tx?)`

```
送出 = mandatory ∨ (覆寫值 ?? defaultEnabled)
```

- 事件沒有登記、或事件不支援這個管道 → 拋 `Error`（程式錯誤）。
- 覆寫值整份快取，key 是租戶 id（一個租戶最多「事件數 × 管道數」列）；寫入的交易提交後 `invalidate()`，另有 30 秒 TTL 當保險。
  多實例部署之前，其他執行個體最慢 30 秒後看到新值——與系統設定相同（[`../../features/multi-instance.md`](../../features/multi-instance.md)）。
- 在業務交易內呼叫時傳 `tx`：快取過期要重讀時沿用交易的連線，不在交易進行中另外佔一條。

### 3.1 站內通知：`notify()` 自己判斷

`NotificationService.notify()` 在整理收件人之前，對輸入裡的每一種類型查 `isEnabled(type, 'inApp', tx)`：
關閉的類型整批不寫、不推播；其他類型照寫。擁有者模組 **不必** 自己檢查（ADR-0028 D6）。

### 3.2 寄信：擁有者在入列前判斷

寄信的工作與範本屬於擁有者模組（[`11-mail.md`](./11-mail.md) §1），通知模組不代為入列，只提供判斷：

```ts
// modules/approval/approval.service.ts
const enabled = await this.notifications.isChannelEnabled(
  APPROVAL_RESULT_NOTIFICATION,
  NotificationChannel.EMAIL,
  tx,
);
if (enabled) await this.jobs.enqueue(APPROVAL_RESULT_MAIL_JOB, { approvalId }, { tx });
```

判斷的是 **入列當下** 的政策：已入列的信不撤回。

### 3.3 關閉只影響之後

已寫入的通知照常保留、可讀，照保留政策清除；重新開啟 **不補發** 關閉期間的事件（ADR-0028 D7）。

---

## 4. API（ADR-0028 D9、D10）

| 方法 | 路徑 | 授權 | 說明 |
| --- | --- | --- | --- |
| GET | `/notification-events` | `system:read` | 目前租戶看得到的事件（目錄的順序）與每個管道的生效值 |
| PATCH | `/notification-events` | `system:update` | `{ changes: [{ type, channel, enabled: boolean \| null }] }`；`null` = 還原預設；1～100 筆 |

沿用系統設定的權限：事件政策是租戶層的營運設定，關掉通知不提權，安全事件由 `mandatory` 擋住。完整格式見 [`../../rbac/04-api-spec.md`](../../rbac/04-api-spec.md) §7.4。

`PATCH` 的規則（`NotificationPolicyService.update`，形狀與 `PATCH /system/settings` 相同）：

1. 每筆先驗證，全部通過才寫入：沒有登記、所屬 feature 沒啟用、或事件不支援這個管道 → `404 NOTIFICATION_EVENT_NOT_FOUND`（`details.type`、`details.channel`）；
   `mandatory` 的事件 → `409 NOTIFICATION_EVENT_MANDATORY`（`details.type`）；同一個事件 ＋ 管道出現兩次 → `400 VALIDATION_FAILED`。
2. 與生效值相同的略過；還原一個沒有覆寫的也略過。全部都沒變就不寫稽核、不推播。
3. 一個交易內寫入所有修改，並寫 **一筆** 稽核：`notificationPolicy.update`、`resourceType: 'notificationPolicy'`、
   `resourceName` 是改到的 `<type>:<channel>`，`changes.before`／`changes.after` 是這些項目的生效值。
4. 交易後失效快取，再推 `resource.changed`：每個改到的事件一筆 `{ resource: 'notificationPolicy', kind: 'update', id: <type> }`，
   推給 `system:read` 的人（[`08-realtime.md`](./08-realtime.md) §6.1）。

---

## 5. 錯誤碼

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `NOTIFICATION_EVENT_NOT_FOUND` | 404 | 事件沒有登記、所屬 feature 沒啟用，或該事件不支援這個管道 |
| `NOTIFICATION_EVENT_MANDATORY` | 409 | 試圖修改不能關的事件 |
| `VALIDATION_FAILED` | 400 | `changes` 為空、超過 100 筆、重複的事件 ＋ 管道、不認得的管道 |

---

## 6. 加入一種事件

照 [`15-notification.md`](./15-notification.md) §9 加一種通知；與事件管理有關的是：

1. `defineNotification()` 帶中繼資料（§1.1）；能寄信的事件 `channels` 加 `email`，並在擁有者的寄信入列前呼叫 `isChannelEnabled()`（§3.2）。
2. 放進擁有者模組的 `*_NOTIFICATIONS` 陣列；模組第一次有通知時，在 `*.module.ts` constructor 呼叫 `NotificationEventCatalog.register()`（§1.2）。
3. 前端 `features/notification/constants.ts` 的 `NOTIFICATION_EVENT_LABEL` 加名稱、說明與收件人；新的分類加進 `NOTIFICATION_EVENT_CATEGORY_LABEL_KEY`；兩個語系檔的 `notification.event.*`。
4. 更新 §1.3 的目錄。

---

## 7. 測試

| 對象 | 檔案 |
| --- | --- |
| 授權（401／403、`system:read` 只能讀）、列表與預設值、關閉寫入覆寫與稽核、還原預設刪列、404 的各種情況、400；關掉 `approval.pending` 後審核者收不到、打開後恢復且不補發；關掉 `approval.result` 的 email 後不入列結果信、站內通知照常 | `test/notification-events.spec.ts` |
| 目錄（重複登記、沒有登記）；`isEnabled`（預設、覆寫、管道各自獨立、`mandatory`、程式錯誤、快取與 `tx`、租戶隔離）；`list`（生效值、`mandatory` 殘留的覆寫、feature 沒啟用不列出）；`update`（交易與稽核、推播、略過沒有變化的、404、409） | `src/modules/notification/__tests__/notification-policy.service.spec.ts` |
| `notify` 依政策略過關閉的類型、全部關閉不寫不推、沒有登記拋錯 | `src/modules/notification/__tests__/notification.service.spec.ts` |
| `defineNotification` 的中繼資料預設值與不合理的組合 | `src/modules/notification/__tests__/notification.batch.spec.ts` |
| 審批結果信在 email 關閉時不入列 | `src/modules/approval/__tests__/approval.service.spec.ts` |
| 端點的授權宣告 | `test/route-audit.spec.ts` |
