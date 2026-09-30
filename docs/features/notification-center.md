# 站內通知中心

- 優先度：P1
- 狀態：實作中（branch `feat/notification-center`；決定見 [ADR-0026](../adr/0026-notification-center.md)）
- 依賴：—
- 相關：[`tags-comments.md`](./tags-comments.md)、[`import-export.md`](./import-export.md)（完成通知）、[`webhooks.md`](./webhooks.md)（連續失敗停用時通知）、
  郵件（[`backend/11-mail.md`](../architecture/backend/11-mail.md)）、即時推播（[`backend/08-realtime.md`](../architecture/backend/08-realtime.md)）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

使用者需要知道「有事等你處理」或「你的東西被動了」，但現在沒有任何能回頭看的地方：

- **即時推播只送訊號**：`resource.changed` 只帶 id 讓快取失效，另外只有 `session.expired`／`session.revoked`／`channel.relay`
  （`packages/realtime/src/events.ts`）。使用者不在線上就什麼都收不到，也沒有已讀／未讀。
- **前端只有 toast**：`core/notify` 的 `useToast()` 經 eventBus 由 `app/ToastHost.tsx` 顯示，關掉就沒了。
- **會通知人的只有信**：`approval.resultMail`、啟用信、重設密碼信（[`backend/11-mail.md`](../architecture/backend/11-mail.md)）。
  審批送出時審核者不會收到任何提醒，只能自己去審批頁看。
- **領域事件沒有「誰做了什麼給誰」的語意**：`DomainEventBus` 只有 4 種事件（`resource.changed`、`permissions.changed`、`sessions.revoked`、
  `tenant.activated`），而且是程序內、fire-and-forget、錯誤吞掉（`core/events/event-bus.ts`）。拿它當通知來源，程序在發佈前後重啟就會掉通知。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 租戶 DB 的 `notifications` 表：收件人、類型、參數、連結、已讀時間 | 使用者自訂每種通知走哪些管道（第一版只有站內；既有的信照舊） |
| 由擁有者模組 **在業務交易內** 寫入通知（與稽核同一條規則） | 推送到手機、桌面通知 |
| 頂列的通知工具（`registerHeaderTool`）：未讀數、列表、全部已讀 | 通知彙整（digest） |
| 新通知經既有的使用者 room（`t:{tenantId}:user:{id}`）推到線上的人 | 平台管理者（apps/auth）的通知 |
| 第一批類型：審批待審（給有審核權限的人）、審批結果（給申請人）、角色被指派／移除 | |
| 已讀超過保留期限的通知由排程工作刪除 | |

## 初步構想

### 資料模型（租戶 DB）

```
notifications
  id            uuid pk
  recipient_id  uuid  → users.id（on delete cascade；使用者只會軟刪除，實務上由清理工作處理）
  type          text  例：approval.pending、approval.result、user.rolesChanged（<模組>.<事件>，與 defineJob 同一種命名）
  params        jsonb 組文字用的參數（名稱快照，不存整份資料）
  link          jsonb { route: <route id>, params: {...} } 或 null
  actor_id      uuid  null＝系統
  read_at       timestamptz null
  created_at    timestamptz
  index (recipient_id, read_at, created_at desc)
```

- 通知跟著租戶走：在租戶 DB，平台管理者不適用。
- `params` 只放顯示需要的東西。前端依 `type` 找 i18n key 組句子（key 必須是字面量，[`conventions/06-literal-strings.md`](../conventions/06-literal-strings.md)）。
- 不存權限相關的資料：點進去之後照常經過頁面權限與 API 權限；權限被收回時通知仍在，但點進去是 403。

### 後端

- `modules/notification/`：repository、`NotificationService`、controller。**不 import 其他模組**。
  - `notify(input | input[], tx)`：擁有者模組在自己的交易內呼叫，寫入通知並在 `afterCommit` 發佈事件。
  - 收件人要自己算（例如「有 `approval:review` 的人」），模組透過 `PermissionService` 查持有者，不交給通知模組。
- 產生通知的地方在擁有者模組：`modules/<name>/<name>.notifications.ts`（型別與參數定義），呼叫點在 service 的交易裡。
  **不訂閱 `DomainEventBus`**：事件不保證送達，也沒有收件人語意。
- 推播：新增 `ChangeSource.notification`，`RealtimeAudience` 把它送到收件人的 user room；前端收到就讓 `notification` 的 query 失效。
  payload 照舊只帶 id（[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §7）。
- API（都是 `@Authenticated()`，只能看自己的）：
  - `GET /notifications`（keyset 分頁，`unread=true` 篩選）、`GET /notifications/unread-count`
  - `POST /notifications/:id/read`、`POST /notifications/read-all`
- 保留：`notification.cleanup`（`scope: 'tenant'` 的排程工作，[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)），
  刪除已讀超過 N 天、或總數超過上限的舊通知。N 用系統設定（`defineSetting`，[`backend/12-settings.md`](../architecture/backend/12-settings.md)）。
- 稽核：已讀、刪除不寫稽核（使用者自己的東西，量大、沒有稽核價值）。

### 前端（backstage）

- `features/notification/`：`registerHeaderTool({ key: 'notification', ... })` 放鈴鐺與未讀數，
  點開是 `Popover` 內的虛擬列表（沿用 `Select`／`Menu` 同一套虛擬捲動）。另有一頁完整列表。
- 連結解析：`link.route` 對應到一張 **route id → route 物件** 的註冊表（feature 在 plugin 的同步階段註冊，
  和 `registerPagePermission` 同一種做法），避免 notification feature import 其他 feature 的 route。
  找不到 route id 時只顯示文字、不可點。
- 未讀數由 query 取得，不存 localStorage（伺服器資料的複本不能放，[`frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §4.2）。

### 權限

- 不新增權限鍵：看自己的通知只需要登入。

## 開放問題

1. 連結用「route id ＋ 參數」的註冊表，還是直接存路徑字串？前者能在改路由時不壞，但每個 feature 要多註冊一次。
   **結論**：route id ＋ 參數，feature 在 plugin 同步階段註冊；找不到 route id 只顯示文字。見 [ADR-0026](../adr/0026-notification-center.md) D3
2. 通知偏好（哪些類型也要寄信）要做嗎？要做的話需要後端的偏好表：現在的 `core/preference` 是前端 localStorage 的註冊表，
   伺服器端只有 `users.locale`／`users.timezone`。
   **結論**：第一版不做，既有的信照舊。見 [ADR-0026](../adr/0026-notification-center.md) D4
3. 審批待審的收件人是「當下有審核權限的人」的快照，之後權限變動不補發也不收回。這樣可以接受嗎？
   **結論**：可以。收件人是送出當下的快照，點進去照常檢查權限。見 [ADR-0026](../adr/0026-notification-center.md) D5
4. 大量收件人（例如全租戶公告）要不要改成「一筆廣播 ＋ 每人已讀表」？第一版的類型收件人都不多，可以先不做。
   **結論**：第一版不做，每位收件人一筆；單次收件人數設上限。見 [ADR-0026](../adr/0026-notification-center.md) D6

## 歸檔去向

- `docs/architecture/backend/NN-notification.md`、`docs/architecture/frontend/NN-notification.md`
- `backend/08-realtime.md` §6.1 的來源 → 受眾表
