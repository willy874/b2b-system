# ADR-0026 — 站內通知中心：擁有者模組在業務交易內寫入、每位收件人一筆

- 狀態：**採用**（2026-10-01 實作並合併：N1、N2）
- 日期：2026-10-01
- 相關：規格 [`../architecture/backend/15-notification.md`](../architecture/backend/15-notification.md)、
  [`../architecture/frontend/15-notification.md`](../architecture/frontend/15-notification.md)；
  [ADR-0008](./0008-realtime-with-socket-io.md)（推播只送訊號）、[ADR-0016](./0016-background-jobs.md)（背景工作與 `job_outbox`）；
  規格 [`../architecture/backend/08-realtime.md`](../architecture/backend/08-realtime.md) §6.1、§7、
  [`../architecture/backend/10-jobs.md`](../architecture/backend/10-jobs.md)、[`../architecture/backend/12-settings.md`](../architecture/backend/12-settings.md)、
  [`../architecture/frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §6、
  [`../conventions/07-layer-dependencies.md`](../conventions/07-layer-dependencies.md) §3.2

## 背景

使用者需要知道「有事等你處理」與「你的東西被動了」，但現在沒有能回頭看的地方：推播只送讓快取失效的訊號、
前端只有關掉就消失的 toast、會主動通知人的只有幾封信，審批送出時審核者什麼都收不到（需求與現況見提案）。
匯入匯出、標籤留言、Webhook、MFA、API Token 都會需要「通知某人」，所以這個機制要先定。
（原本的提案已於實作完成時刪除，內容依實作結果改寫進上列兩份規格。）

## 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **租戶 DB 的 `notifications` 表，每位收件人一筆**：`id`、`recipient_id`（→ `users.id`，`ON DELETE CASCADE`）、`type`（`<模組>.<事件>`，與 `defineJob` 同一種命名）、`params jsonb`（組句子用的參數，名稱快照）、`link jsonb`（D3，可為 null）、`actor_id`（null＝系統）、`read_at`、`created_at`；索引 `(recipient_id, read_at, created_at desc)`。平台管理者不適用 | 通知跟著租戶走；每人一筆讓已讀、刪除、保留都是單列操作。`params` 只放顯示需要的名稱，不存整份資料，也不存權限相關的東西 |
| D2 | **由擁有者模組在自己的業務交易內寫入**：`modules/notification` 提供 `NotificationService.notify(input \| input[], tx)`，寫入後在交易提交後發佈推播。通知模組 **不 import 業務模組**；通知類型與參數型別定義在擁有者模組的 `<name>.notifications.ts`。**不訂閱 `DomainEventBus`** | 與稽核同一條規則：業務寫入成功，通知就一定在。`DomainEventBus` 是程序內、fire-and-forget、錯誤吞掉，也沒有「給誰」的語意（`08-realtime.md` §7） |
| D3 | **連結存 route id ＋ 參數**（提案開放問題 1）：`link = { route: '<route id>', params: {...} }`。前端有一張 route id → route 物件的註冊表，feature 在 plugin 的 **同步階段** 註冊（與 `registerPagePermission` 同一種做法）；notification feature 不 import 其他 feature 的 route。找不到 route id 時只顯示文字、不可點 | 路由改名或搬移時舊通知不會壞；存路徑字串則每次改路由都要考慮歷史資料 |
| D4 | **第一版不做通知偏好**（提案開放問題 2）：只有站內通知，既有的信（審批結果、啟用、重設密碼）照舊。之後要做時另加後端的偏好表，不沿用前端的 `core/preference` | 偏好需要後端的偏好表與設定頁，範圍會翻倍；第一批類型量少，還沒有「太吵」的問題 |
| D5 | **收件人由擁有者模組在寫入當下計算，是快照**（提案開放問題 3）：例如「審批待審」＝送出時持有 `approval:review` 的使用者（透過 `PermissionService` 查，不交給通知模組）。之後權限變動 **不補發也不收回**；點進去照常經過頁面權限與 API 權限，權限已被收回就是 403 | 補發或收回要訂閱權限變化並重算所有未處理的事件，複雜度遠高於價值；通知本身不授予任何權限 |
| D6 | **第一版不做廣播模型**（提案開放問題 4）：一律每位收件人一筆。`notify` 單次的收件人數有上限（常數，暫定 1000），超過時記 warn 並截斷——需要全租戶公告時再加「一筆廣播 ＋ 每人已讀表」 | 第一批類型的收件人都不多（審核者、申請人、被指派的人）；先不讓列表查詢合併兩個來源 |
| D7 | **操作者就是收件人時不通知**（例如自己改自己的角色）。`actor_id` 仍記錄，前端顯示「由誰觸發」 | 自己做的事不需要提醒自己 |
| D8 | **推播**：新增 `ChangeSource.NOTIFICATION`，`RealtimeAudience` 送到收件人的 user room（`t:{tenantId}:user:{id}`）；payload 照舊只帶 id，前端收到就讓 notification 的 query 失效 | 沿用既有的推播管線與「只送訊號」的規則（ADR-0008） |
| D9 | **API**（都是 `@Authenticated()`，只能看自己的，不新增權限鍵）：`GET /notifications`（keyset 分頁，`unread=true` 篩選）、`GET /notifications/unread-count`、`POST /notifications/:id/read`、`POST /notifications/read-all`。已讀與清除 **不寫稽核** | 看自己的通知只需要登入；已讀是使用者自己的狀態，量大、沒有稽核價值 |
| D10 | **保留**：背景工作 `notification.cleanup`（`scope: 'tenant'`，每天）刪除「已讀超過 N 天」與「每人超過上限的最舊通知」；系統設定 `notification.retentionDays`（預設 30）、`notification.maxPerUser`（預設 500） | 表不能無限成長；未讀的通知在上限內保留 |
| D11 | **第一批類型**：`approval.pending`（給送出當下有 `approval:review` 的人，不含申請人自己）、`approval.result`（給申請人；既有的結果信照舊）、`user.rolesChanged`（被指派或移除角色的人，`params` 帶增減的角色名稱） | 這三個是現有流程已經卡住的地方（審核者不知道有待審） |
| D12 | **前端**：新 feature `features/notification`：以 `registerHeaderTool` 放鈴鐺與未讀數，點開是 `Popover` 內的列表（沿用 `Select`／`Menu` 的虛擬捲動）與「全部已讀」；另有完整列表頁。句子依 `type` 找 i18n key（字面量，`06-literal-strings.md`）；未知的 `type` 顯示通用文字。未讀數由 query 取得，不存 localStorage | 伺服器資料的複本不放 localStorage（`frontend/09-state-and-storage.md` §4.2）；registry 與同步註冊是既有模式 |

## 分階段

| 階段 | 內容 | 相容性 |
| --- | --- | --- |
| N1 後端 | `notifications` 表、`modules/notification`（service、repository、controller）、`ChangeSource.NOTIFICATION`、`notification.cleanup` 與設定、三個類型的寫入點 | 純加法 |
| N2 前端 | route id 註冊表、`features/notification`（鈴鐺、Popover、列表頁）、各 feature 註冊 route id | 純加法 |

## 不做

- 通知偏好、寄信或其他管道（D4）；手機與桌面推送；通知彙整（digest）。
- 廣播模型（D6）；平台管理者（apps/auth）的通知。
- 權限變動後補發或收回通知（D5）。

## 代價

| 代價 | 緩解 |
| --- | --- |
| 每個需要通知的業務寫入多一次 INSERT（在交易內） | 收件人少；批次 INSERT 一次寫完 |
| 收件人是快照，權限收回後仍看得到通知的文字 | `params` 只放名稱，不含敏感資料；點進去照常檢查權限 |
| 每個 feature 要多註冊一次 route id | 註冊在 plugin 的同步階段，與頁面權限同一處，漏註冊只會讓連結不可點 |

## 評估過的方案

| 方案 | 不採用的理由 |
| --- | --- |
| 訂閱 `DomainEventBus` 產生通知 | 不保證送達、沒有收件人語意（D2） |
| 經 `job_outbox` 由背景工作寫入 | 保證送達，但多一跳延遲，且收件人的計算要在工作裡重做；在交易內直接寫入同樣保證一致 |
| 連結存路徑字串（D3 的替代） | 路由一改舊通知就壞 |
| 第一版就做廣播模型（D6 的替代） | 列表要合併兩個來源、已讀要兩種寫法；目前沒有需要它的類型 |

## 實作紀錄

與上面的決定不同、或決定沒寫到而實作時定下來的地方：

| 階段 | 項目 | 實作 |
| --- | --- | --- |
| N1 | 索引（D1） | 依查詢拆成三個：全部列表 `(recipient_id, created_at, id)`、未讀的部分索引、已讀過期清理的 `(read_at)`；登記在 `CLAUDE.md`「與文件不同的實作決定」（[`backend/15-notification.md`](../architecture/backend/15-notification.md) §2） |
| N1 | 已讀的推播（D8） | 標為已讀、全部已讀也推 `notification update` 給自己，其他裝置與分頁的未讀數跟著更新（發起的分頁以 `origin` 略過） |
| N1 | 不通知的操作（D11） | 刪除或還原角色時持有者的角色跟著消失或出現，但不發 `user.rolesChanged`（角色層級的操作、可能影響上千人） |
| N1 | `fileFolder.access` 的待審（D11） | 只通知 `approval:review` 的持有者；只在該資料夾有 `share` 的管理者也能審核但收不到 |
| N2 | route id 註冊表（D3） | `core/route-link`：`registerRouteLink(id, { route, params?, search? })` 以對照表宣告「route 的參數 ← 連結參數」，登記時檢查 id 格式與 path 的 `$參數`；可啟用的 feature 卸載時撤回，連結變成不可點 |
| N2 | 稽核列表的失效（D8） | 前端依賴圖的 `derivesFromAnyChange` 改成可以排除來源，稽核列表排除 `notification`——與後端 `recordsAudit: false` 對稱；否則收到通知、按已讀都會重抓稽核列表 |
| N2 | 推播不可用時（D12） | 未讀數在推播斷線或停用時每 60 秒重抓一次 |
| N2 | 語系包（D12） | 鈴鐺在每一頁都看得到：按鈕的字放全域語系包，Popover 的內容由鈴鐺掛上時自己載入 feature 的 scope |
| N2 | 列表頁 | `/notification` 只需要登入（`access: []`），沒有側邊選單項目，入口是鈴鐺的「查看全部」 |
