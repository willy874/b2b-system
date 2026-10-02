# ADR-0030 — Webhook：擁有者在交易內發出對外事件，經 `job_outbox` 投遞，連線時綁定已驗證的 IP

- 狀態：**採用**（2026-10-02；開放問題依提案中的建議，W0～W3 在 branch `feat/webhooks`）
- 日期：2026-10-02
- 相關：[ADR-0016](./0016-background-jobs.md)（背景工作）、[ADR-0020](./0020-physical-tenant-isolation.md) D15（交易內入列走 `job_outbox`）、
  [ADR-0026](./0026-notification-center.md)／[ADR-0028](./0028-notification-event-management.md)（通知；自動停用時通知建立者）、
  [ADR-0027](./0027-api-tokens-external-api.md)（接收端以 API token 回查）、[ADR-0021](./0021-runtime-feature-activation.md)／[ADR-0029](./0029-toggleable-platform-features.md)（可關閉的 feature）；
  實作後的規格 [`../architecture/backend/17-webhook.md`](../architecture/backend/17-webhook.md)

## 背景

外部系統（Slack、CI、客戶自己的系統）沒辦法得知「使用者被停用了」「審批通過了」「檔案上傳完成了」，只能輪詢。
API token 與對外 API（ADR-0027）解決了「外部來拉」，這份決定「我們主動推」。

`DomainEventBus` 不能當來源：程序內、fire-and-forget、handler 錯誤吞掉，而且它的事件是給快取失效與推播用的，
沒有業務語意。可靠的路已經存在：交易內 `JobQueue.enqueue(..., { tx })` 先寫租戶 DB 的 `job_outbox`，提交後搬進 pg-boss，
另有 `jobs.outboxSweep` 兜底（[`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §4.1）。

## 決定

### 對外事件

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **對外事件定義在程式碼**：擁有者模組在 `<name>.webhooks.ts` 以 `defineWebhookEvent<Data>('user.created', { version: 1 })` 宣告，在 `*.module.ts` constructor 以 `WebhookEventCatalog.register([...])` 登記（與通知目錄同一個模式）。重複的名稱讓程序啟動失敗；`emit()` 遇到沒登記的事件拋 `Error` | 通用模組不 import 業務模組（`conventions/07-layer-dependencies.md` §3.2）；訂閱頁的事件清單從目錄來，不會漏列或列出發不出去的事件 |
| D2 | **第一批**：`user.created`、`user.statusChanged`、`user.deleted`、`user.restored`、`approval.decided`、`file.uploaded`，另有系統事件 `webhook.ping`（只由「送測試事件」發出，不能訂閱）。<br>提案的 `user.disabled` 改成 `user.statusChanged`（`{ userId, status, previousStatus }`）：停用、啟用、鎖定都需要，分成多個事件只會讓接收端多訂幾個 | 這幾個是現有模組裡「外部系統最常要跟著動」的狀態轉移；`statusChanged` 一個事件涵蓋所有狀態 |
| D3 | **payload 只帶識別資訊與必要欄位**：信封 `{ id, type, version, occurredAt, tenant: <代碼>, data }`；`data` 只有 id 與列舉值（例：`{ userId }`、`{ approvalId, approvalType, decision }`、`{ fileId, folderId }`），**不帶 email、名稱等個資**。接收端要細節時用 API token 經對外 API 回查 | 回查時套用 token 自己的權限與 scopes，webhook 不必另外做權限過濾（D5）；payload 外洩的影響小 |
| D4 | **版本**：同一個 `version` 只做相容的變更（加欄位）；不相容的變更改用新的事件名稱，舊事件並行一段時間後下線。訂閱不指定版本 | 一個事件一個版本最好推理；需要並行時兩個名稱就夠，不必在訂閱上加版本協商 |

### 訂閱與權限

| # | 決定 | 理由 |
| --- | --- | --- |
| D5 | **不依權限過濾事件**：訂閱只要 `webhook:create`，訂閱者收到租戶內所有符合類型的事件；檔案事件不看建立者對資料夾的存取 | 事件只帶 id（D3）；依建立者過濾要在投遞時重算每個訂閱的權限，而且建立者離職後訂閱的語意會變。能管 webhook 本來就是高權限 |
| D6 | **權限鍵**：`webhook:read`、`webhook:create`、`webhook:update`（改設定、停用／啟用、輪替密鑰、送測試事件、重送）、`webhook:delete`。預設角色：`admin` 全部、`auditor` 只有 `read` | 與服務帳號一樣的四個動作；重送與測試都是「讓它再送一次」，跟著 update |
| D7 | **租戶 DB 的 `webhook_subscriptions`**：`name`、`url`、`events text[]`、`status`（`active`／`disabled`）、`disabled_reason`（`manual`／`failing`）、`secret_encrypted`、`consecutive_failures`、`version`、建立者／修改者與時間。<br>**刪除是硬刪除**，投遞紀錄一併刪除；不進回收桶 | 訂閱是設定，不是業務資料；還原一個已經停止投遞的訂閱沒有意義（與服務帳號同一個判斷，ADR-0027）。`version` 照 `03-api-conventions.md` §11 做樂觀鎖 |
| D8 | **可關閉的 feature `webhook`**（ADR-0021／0029）：既有租戶以平台 migration 啟用，新租戶預設啟用。停用時 `/webhooks` 回 `404 FEATURE_DISABLED`、`emit()` 不入列、已入列的投遞略過；訂閱與紀錄保留 | 對外連線是租戶「買了什麼」的一部分；停用就不該再有流量出去 |

### 發出與投遞

| # | 決定 | 理由 |
| --- | --- | --- |
| D9 | **擁有者在業務交易內呼叫 `WebhookService.emit(event, data, tx)`**（稽核之後）：查有訂閱這個事件的 `active` 訂閱；有的話寫一筆 `webhook_events`（id、type、version、data、occurred_at），每個訂閱入列一筆 `webhook.deliver`（`{ subscriptionId, eventId }`，帶 `tx`）。沒有訂閱就什麼都不寫 | 事件與業務資料一起提交或一起回滾；工作資料只放 id（`job:read` 的人看得到工作資料與 `output`，`11-mail.md` 的前例） |
| D10 | **不保證順序**；接收端以 `occurredAt` 與事件 `id` 去重、排序 | 以訂閱為 `singletonKey` 依序投遞會讓一個慢的接收端擋住自己所有的事件，吞吐也下降；主流服務（Stripe、GitHub）都不保證順序 |
| D11 | **請求**：`POST`、`Content-Type: application/json`、`User-Agent: b2b-system-webhook/1`、`X-Webhook-Id`（事件 id，重送時不變）、`X-Webhook-Event`、`X-Webhook-Timestamp`（秒）、`X-Webhook-Signature: sha256=<hex(HMAC-SHA256(secret, "{timestamp}.{body}"))>`。逾時 10 秒、不跟隨轉址、回應只讀前 1 KB。2xx 視為成功，其他（含 3xx、逾時、連線失敗）都是失敗 | 時間戳進簽章，接收端可拒絕過舊的請求（防重放）；事件 id 讓接收端冪等 |
| D12 | **重試**：`webhook.deliver` 失敗就拋出，由 pg-boss 指數退避（8 次、60 秒起、最多 1 小時；合計約 4 小時）。**每次嘗試寫一筆 `webhook_deliveries`**（訂閱、事件、第幾次、觸發方式 `auto`／`manual`、成功或失敗、狀態碼、耗時、回應摘要、錯誤） | 用既有的背景工作就有重試、逾時、管理頁；逐次紀錄讓租戶看得到每一次發生了什麼 |
| D13 | **連續失敗自動停用**：成功時 `consecutive_failures` 歸零，失敗時加一；到 50 次就改成 `disabled`（`disabled_reason = 'failing'`），寫稽核 `webhook.autoDisable`（沒有操作者），並通知停用當下持有 `webhook:update` 的人（站內通知 `webhook.disabled`，可由事件管理關掉）。之後的投遞看到訂閱已停用就略過 | 壞掉的接收端不該無限佔用佇列；50 次大約是 6 個事件各自用完重試，不會因為一次短暫故障就停 |
| D14 | **密鑰**：建立與輪替時由伺服器產生（`whsec_` ＋ 32 bytes base64url），**只在回應出現一次**；資料庫以 `SecretBox` 加密存放（新的主金鑰 `WEBHOOK_SECRET_KEY`，沒設定時與 IdP 一樣由 `JWT_SECRET` 推導，只限開發）。輪替立即生效，不保留舊密鑰 | 投遞時要算 HMAC，不能只存雜湊；寬限期要同時送兩個簽章，第一版先不做 |
| D15 | **SSRF**：連線前解析 DNS，任何一個位址是私有、loopback、link-local、保留位址就拒絕，**並用那個已驗證的位址連線**（`core/http/outbound.ts`，以 `lookup` 選項綁定，查詢與連線之間沒有空窗）。建立與修改時也檢查一次，立即回 `WEBHOOK_URL_NOT_ALLOWED`。production 只接受 `https`；其他環境允許 `http` 與內網（與外部 IdP 的 `blockPrivateNetworks` 相同的判斷），才能打本機的接收端 | 解析與連線分開做會被 DNS rebinding 繞過；外部 IdP 原本的「先查 DNS」搬到同一個檔案，之後改成同一種綁定（`hardening-followups.md`） |
| D16 | **保留**：`webhook_events` 與 `webhook_deliveries` 保留 30 天，由每天的 `webhook.cleanup` 刪除 | 投遞紀錄是除錯用的，不是稽核；稽核另外有訂閱的變更 |
| D17 | **重送**：投遞紀錄頁可以對某個事件手動重送一次（`trigger = 'manual'`），不論訂閱的失敗次數；訂閱停用時不能重送。**送測試事件**：入列一筆 `webhook.ping` | 接收端修好之後要能補送；手動的送出不計入自動停用的門檻以外的任何規則 |

### 不做

- 事件內容的轉換範本、長期保存與重播（只保留 30 天的紀錄）。
- 平台層級的 webhook（租戶建立、停用）。
- 保證送達的 `domain_events` outbox（`backend/08-realtime.md` §7.4）：推播漏掉只是畫面晚一點更新，維持兩條路。
- 依權限過濾事件（D5）、保證順序（D10）、輪替密鑰的寬限期（D14）。

## 實作階段

| 階段 | 內容 |
| --- | --- |
| W0 | `core/http/outbound.ts`：位址檢查、連線時綁定已驗證位址的 `lookup`；外部 IdP 改由這裡 import |
| W1 | 後端：資料表與 migration、`modules/webhook`（目錄、訂閱 CRUD、`emit()`、投遞工作、自動停用、清理）、擁有者模組發出第一批事件、權限、feature、通知 |
| W2 | backstage：`features/webhook`（列表、建立、詳情、投遞紀錄、重送） |
| W3 | 歸檔：正式文件、刪除提案 |

## 實作紀錄

| 項目 | 與上面的決定不同或補充的地方 |
| --- | --- |
| D2 | 加了 `user.restored`：從回收桶還原的使用者若沒有事件，接收端在 `user.deleted` 時做的處理就回不來 |
| D13 | 通知的對象從「建立者」改成「當下持有 `webhook:update` 的人」：建立者可能已離職或失去權限，能修好它的人才需要知道 |
| D15 | 位址檢查從 `modules/identity-provider/outbound-guard.ts` 搬到 `core/http/outbound.ts`，新增 `pinnedLookup` 與 `sendOutboundRequest`。外部 IdP 仍只「先查 DNS」：openid-client 的 `customFetch` 只接受 fetch，綁定位址留在 `hardening-followups.md` |
| D17 | 手動的失敗不計入自動停用的門檻（使用者正在除錯）；手動的成功一樣歸零 |
| 其他 | 一個租戶最多 50 個訂閱（`WEBHOOK_LIMIT_REACHED`，建立時鎖表再數）；`webhook.deliver` 並行 10；輪替密鑰不遞增 `version`（不是使用者編輯的欄位） |

## 評估過的方案

- **以 `DomainEventBus` 為來源**：不保證送達、沒有業務語意（背景）。
- **每個訂閱依建立者的權限過濾**（D5 的另一邊）：投遞時要重算權限，建立者被停用後訂閱的行為難以預期；事件只帶 id 已足夠。
- **以訂閱為 `singletonKey` 依序投遞**（D10 的另一邊）：一個卡住的接收端會擋住它所有的事件。
- **只存密鑰的雜湊**（D14 的另一邊）：簽章需要原始密鑰。
- **訂閱軟刪除並進回收桶**（D7 的另一邊）：還原後的訂閱不會補送刪除期間的事件，還原沒有意義。
