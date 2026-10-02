# 17 — Webhook

事件發生時以 HTTP POST 通知外部系統（CI、聊天工具、客戶自己的服務）。決定與理由見 §9；
一個訂閱多個目標網址見 §10（D12～D16），租戶的網址數上限見 [`../05-tenancy.md`](../05-tenancy.md) §13.3 D11；
接收端回查細節用的 API token 與對外 API 見 [`../06-external-api.md`](../06-external-api.md)。

```
擁有者模組（user／approval／file）
  └─ 業務交易內：audit.record → webhooks.emit(EVENT, data, tx)
                                   ├─ 查訂閱這個事件的 active 訂閱的每個網址（webhook_targets）
                                   ├─ 寫一筆 webhook_events
                                   └─ 每個網址 JobQueue.enqueue(webhook.deliver, { subscriptionId, eventId, targetId }, { tx })  ← job_outbox
提交後 → pg-boss → webhook.deliver（worker）
  └─ 簽章 → 連線時綁定已驗證的位址 → POST 到那個網址 → 寫 webhook_deliveries → 這個網址成功歸零／失敗加一（到門檻停用整個訂閱）→ 失敗就拋出讓 pg-boss 重試
```

---

## 1. 模組

`modules/webhook/`。不 import 任何發出事件的業務模組（[`../../conventions/07-layer-dependencies.md`](../../conventions/07-layer-dependencies.md) §3.2）；
擁有者模組 import `WebhookModule`，在自己的 `*.module.ts` constructor 登記事件、在業務交易內呼叫 `WebhookService.emit()`。

| 檔案 | 內容 |
| --- | --- |
| `webhook.definition.ts` | `defineWebhookEvent<Data>(type, { version, feature?, subscribable? })`（純函式） |
| `webhook-event.catalog.ts` | `WebhookEventCatalog`：`register()`、可訂閱的清單、`emit()` 前的登記檢查 |
| `webhook.service.ts` | 訂閱的增刪改、密鑰輪替、送測試事件、重送、`emit()` |
| `webhook-delivery.service.ts` | 投遞（工作 handler 與同步送出共用的 `attempt()`）、自動停用、保留清理 |
| `webhook.transport.ts` | 對外連線的唯一出口：網址檢查、送出、密鑰加解密（整合測試以它換掉網路） |
| `webhook.signature.ts` | 密鑰產生、HMAC 簽章、請求標頭 |
| `webhook.jobs.ts` | `webhook.deliver`、`webhook.cleanup` |
| `webhook.notifications.ts` | 站內通知 `webhook.disabled` |
| `core/http/outbound.ts` | 位址檢查、`pinnedLookup`、`sendOutboundRequest`（§5；外部 IdP 也從這裡 import） |

整個功能是可關閉的 feature `webhook`（[`../05-tenancy.md`](../05-tenancy.md) §5.1）：停用時 `/webhooks` 回 `404 FEATURE_DISABLED`、
`emit()` 不查訂閱也不寫任何東西、已入列的投遞在執行時略過；訂閱與紀錄保留。

---

## 2. 資料表（租戶 DB，migration `0024_webhooks`、`0033_webhook_targets`）

| 表 | 欄位 | 說明 |
| --- | --- | --- |
| `webhook_subscriptions` | `name`、`events text[]`、`status`（`active`／`disabled`）、`disabled_reason`（`manual`／`failing`）、`secret_encrypted`、`last_delivery_at`、`version`、`created_by`／`updated_by`（→ `users` `SET NULL`）、時間 | 硬刪除、不進回收桶（D7）。部分 GIN 索引 `(events) WHERE status = 'active'` 給 `emit()`。`url`（可為 null）與 `consecutive_failures` 已由 `webhook_targets` 取代：`url` 為升版期間的舊程式碼雙寫第一個網址，兩欄都在下一次部署刪除 |
| `webhook_targets` | `subscription_id`（CASCADE）、`url`、`position`、`consecutive_failures`、`last_delivery_at`、`created_at`；`unique(subscription_id, url)` | 一個訂閱 1～10 個網址（§10.2 D12）。修改網址時沒變的列保留（id 與失敗次數不變），移除的刪掉 |
| `webhook_events` | `type`、`version`、`data jsonb`、`occurred_at` | 只在有訂閱時寫；`data` 只有 id 與列舉值（D3） |
| `webhook_deliveries` | `subscription_id`（CASCADE）、`event_id`（CASCADE）、`target_id`（→ `webhook_targets` `SET NULL`）、`url`（送出的網址快照）、`attempt`、`trigger`（`auto`／`manual`）、`succeeded`、`response_status`、`duration_ms`、`response_body`（前 1 KB）、`error`、`created_at` | 每一次嘗試一列；索引 `(subscription_id, created_at desc, id)`、`(target_id)`。網址被移除後紀錄保留，`target_id` 是 null |

- 訂閱的 `events` 存名稱：程式移除某個事件之後，讀取時濾掉（`toDto`），不讓請求失敗。
- `attempt` 是「這個事件對這個網址」的第幾次（以 `target_id` 計）。
- 密鑰以 `SecretBox`（AES-256-GCM）加密，主金鑰 `WEBHOOK_SECRET_KEY`；沒設定時（僅開發）由 `JWT_SECRET` 以 HKDF 推導，production 沒設定就不能啟動。

### 2.1 網址數上限（[`architecture/05-tenancy.md`](../05-tenancy.md) §13.3 D11）

整個租戶的訂閱裡 **不重複** 的網址數不能超過 feature 參數 `webhook.maxUrls`（預設 1，平台管理者設定；[`../05-tenancy.md`](../05-tenancy.md) §5.3）。
建立與修改網址時先 `LOCK TABLE webhook_subscriptions IN SHARE ROW EXCLUSIVE MODE`（所有改變網址的寫入都經過這裡），
再以「其他訂閱的網址 ∪ 這次的網址」計算：超過上限 **而且比變更前多** 才回 `409 WEBHOOK_URL_LIMIT_REACHED`（`details.max`）。
已經超過上限的租戶（升版前就有多個訂閱）仍能修改、刪除、減少網址；不同訂閱用同一個網址只算一次。
另外仍有一個租戶最多 50 個訂閱的固定上限（`WEBHOOK_LIMIT_REACHED`）。

---

## 3. 對外事件

### 3.1 目錄

| 事件 | 版本 | `data` | 發出點 | feature |
| --- | --- | --- | --- | --- |
| `user.created` | 1 | `{ userId }` | `UserService.createAccount()`：管理者建立、註冊審批通過、外部 IdP 首次登入 | — |
| `user.statusChanged` | 1 | `{ userId, status, previousStatus }` | 管理者改狀態（`PATCH /users/:id`）、解鎖（`status` 真的改變時）、完成啟用（`pending` → `active`）、重設密碼順帶解鎖（`locked` → `active`） | — |
| `user.deleted` | 1 | `{ userId }` | `UserService.remove()`（軟刪除） | — |
| `user.restored` | 1 | `{ userId }` | `UserService.restore()` | — |
| `approval.decided` | 1 | `{ approvalId, approvalType, decision }` | `ApprovalService.approve()`／`reject()` | — |
| `file.uploaded` | 1 | `{ fileId, folderId }` | `FileService.completeUpload()` | `file` |
| `webhook.ping` | 1 | `{ webhookId }` | 只由「送測試事件」發出；**不能訂閱** | — |

- 服務帳號（`users.kind = 'service'`）不經 `createAccount()`，不發 `user.*`。
- 登入失敗的自動鎖定只寫 `locked_until`、不改 `status`，不是 `user.statusChanged`。
- 版本：同一個版本只做相容的變更（加欄位）；不相容的變更改用新的事件名稱（D4）。已發布的名稱不改名。

### 3.2 信封與請求

```json
{ "id": "<事件 id>", "type": "user.created", "version": 1,
  "occurredAt": "2026-10-02T01:02:03.000Z", "tenant": "<租戶代碼>", "data": { "userId": "…" } }
```

| 標頭 | 值 |
| --- | --- |
| `Content-Type` | `application/json` |
| `User-Agent` | `b2b-system-webhook/1` |
| `X-Webhook-Id` | 事件 id：重送時不變，接收端以它去重 |
| `X-Webhook-Event` | 事件名稱 |
| `X-Webhook-Timestamp` | 送出當下的 Unix 秒數（每次嘗試都不同） |
| `X-Webhook-Signature` | `sha256=<hex(HMAC-SHA256(secret, "{timestamp}.{body}"))>` |

接收端：以原始 body 驗簽，再拒絕時間戳太舊（例：超過 5 分鐘）的請求。**不保證順序**（D10），以 `occurredAt` 與 `id` 判斷。

### 3.3 加入一個對外事件

1. 擁有者模組的 `<name>.webhooks.ts`：`defineWebhookEvent<Data>('<資源>.<過去式動詞>', { version: 1 })`，`Data` 只放 id 與列舉值；放進 `*_WEBHOOK_EVENTS`。
2. `*.module.ts`：`imports` 加 `WebhookModule`，constructor 注入 `WebhookEventCatalog` 並 `register(*_WEBHOOK_EVENTS)`。重複的名稱讓程序啟動失敗。
3. 在業務交易內（稽核之後）呼叫 `webhooks.emit(EVENT, data, tx)`。沒有登記的事件會拋錯，業務交易一起失敗。
4. 前端 `features/webhook/constants.ts` 的 `WEBHOOK_EVENT_LABEL` 加名稱與說明、兩個語系檔的 `webhook.event.*`（沒有的話畫面以事件名稱本身顯示）。
5. 更新 §3.1 的表；測試：擁有者的單元測試斷言 `emit` 的參數與 `tx`。

---

## 4. 投遞

| 項目 | 內容 |
| --- | --- |
| 工作 | `webhook.deliver`（`scope: 'tenant'`、並行 10、一次最多 60 秒）：`retryLimit` 8、60 秒起指數退避、最多 1 小時（合計約 4 小時）。資料 `{ subscriptionId, eventId, targetId }`；升版前入列、沒有 `targetId` 的送到訂閱的第一個網址 |
| 略過 | 租戶關掉 `webhook`、訂閱已刪除或停用、網址已被移除、事件已被清理：回 `{ skipped }`，不重試 |
| 成功 | 2xx。寫一筆 `succeeded = true`，這個網址的 `consecutive_failures` 歸零，網址與訂閱的 `last_delivery_at` 更新 |
| 失敗 | 其他狀態碼（含 3xx，不跟隨轉址）、逾時（10 秒）、連線失敗、被擋下。寫一筆 `succeeded = false`（沒收到回應時 `error` 是 `TIMEOUT`、`BLOCKED`、`ECONNREFUSED`…），這個網址的 `consecutive_failures` 加一，拋出 `WebhookDeliveryFailedError` 讓 pg-boss 重試 |
| 自動停用 | 任何一個網址的失敗次數到 **50**（`WEBHOOK_AUTO_DISABLE_AFTER_FAILURES`）而且訂閱仍是 `active`：以 `status = 'active'` 為條件把訂閱改成 `disabled`／`failing`、`version` 加一（並行的失敗只有一個改得到）；同一個交易寫稽核 `webhook.autoDisable`（沒有操作者，`metadata` 帶網址）並通知當下持有 `webhook:update` 的人（`webhook.disabled`，`params` 帶網址，連到 `webhook.detail`）。這一次不拋出，之後的重試看到停用就略過。重新啟用時所有網址歸零（§10.2 D15） |
| 工作的 `output` | `{ deliveryId, attempt, succeeded, responseStatus }`，不放 payload、網址與回應（`job:read` 的人看得到） |
| 推播 | 每一次嘗試推 `webhookDelivery create`（`refs.webhook`）；自動停用另推 `webhook update` |

**手動送出**（同步，在請求裡送、回傳這一次的投遞紀錄，D17）：

- `POST /webhooks/:id/test`：寫一筆 `webhook.ping` 事件後同時送到 **每個網址**，回傳 `{ items: 投遞紀錄[] }`。
- `POST /webhooks/:id/deliveries/:deliveryId/redeliver`：把那一筆紀錄的事件（事件 id 不變）送到 **同一個網址**，`attempt` 接續；
  網址已從訂閱移除回 `404 WEBHOOK_DELIVERY_NOT_FOUND`。
- 訂閱停用中回 `409 WEBHOOK_DISABLED`。手動的成功一樣讓失敗次數歸零；手動的失敗 **不** 計入門檻。

**保留**：`webhook.cleanup`（`WEBHOOK_CLEANUP_CRON`，預設 `15 5 * * *`）每批 1000 筆刪除超過 30 天的 `webhook_events`，投遞紀錄隨之 CASCADE；
`output` 是 `{ retentionDays, cutoff, deletedEvents }`。

---

## 5. 對外連線的防護（D15）

`core/http/outbound.ts`：

| 函式 | 用途 |
| --- | --- |
| `isBlockedAddress(address)` | 私有網段、loopback、link-local（含 `169.254.169.254`）、CGNAT、保留位址、IPv6 的 ULA／link-local；IPv4-mapped IPv6 以其 IPv4 判斷 |
| `assertPublicDestination(url)` | 解析後 **每一個** 位址都要公開；只檢查不綁定。給「儲存設定時及早告訴使用者」與外部 IdP（openid-client 只接受 fetch）用 |
| `pinnedLookup(resolve)` | 給 `http.request` 的 `lookup`：解析、檢查，把通過檢查的位址交給 socket。查詢與連線是同一次解析，DNS rebinding 沒有空窗 |
| `sendOutboundRequest(input)` | 不跟隨轉址、總逾時、回應只讀前 N 位元組；`blockPrivateNetworks` 時以 `pinnedLookup` 解析，字面 IP 另外檢查 |

- production（`NODE_ENV=production`）：網址只接受 `https`、儲存時檢查 DNS、投遞時綁定已驗證的位址。其他環境允許 `http` 與內網，才能打本機的接收端。
- 網址帶帳密一律拒絕（會出現在畫面與紀錄上；驗證來源請用簽章）。
- 外部 IdP 仍是「先查 DNS」（openid-client 的 `customFetch` 只能接 fetch），綁定位址是 [`../../features/hardening-followups.md`](../../features/hardening-followups.md) 的待辦。

---

## 6. API

都標 `@RequireFeature('webhook')`。權限見 [`../../rbac/02-permission-catalog.md`](../../rbac/02-permission-catalog.md) §2.13。

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/webhooks?offset=&limit=&keyword=&status=` | `webhook:read` | 列表（新的在前；`keyword` 比對名稱與任一網址）；每一筆帶 `targets`（網址、連續失敗、最後投遞），`consecutiveFailures` 是各網址的最大值 |
| GET | `/webhooks/events` | `webhook:read` | 可訂閱的事件：可訂閱、所屬 feature 已啟用 |
| POST | `/webhooks` | `webhook:create` | `{ name, urls, events }` → `{ secret, webhook }`；`secret` 只出現這一次。`urls` 1～10 個、不重複；一個租戶最多 50 個訂閱、網址數受 §2.1 限制 |
| GET | `/webhooks/:id` | `webhook:read` | |
| PATCH | `/webhooks/:id` | `webhook:update` | `{ name?, urls?, events?, status?, version }`；`urls` 是完整清單；啟用時所有網址的失敗次數歸零、停用原因清空；停用記為 `manual` |
| DELETE | `/webhooks/:id` | `webhook:delete` | 硬刪除，投遞紀錄一併刪除 |
| POST | `/webhooks/:id/rotate-secret` | `webhook:update` | → `{ secret, webhook }`；舊的立即失效，不遞增 `version` |
| POST | `/webhooks/:id/test` | `webhook:update` | 同步送出 `webhook.ping` 到每個網址，回傳 `WebhookTestResult`（`{ items }`） |
| GET | `/webhooks/:id/deliveries?offset=&limit=&succeeded=&targetId=` | `webhook:read` | 投遞紀錄（新的在前），帶事件的 `type`、`data`、`occurredAt` 與送出的 `targetId`、`url` |
| POST | `/webhooks/:id/deliveries/:deliveryId/redeliver` | `webhook:update` | 同步重送，回傳投遞紀錄 |

稽核：`webhook.create`、`webhook.update`（`diff` 名稱、網址清單 `urls`、事件、狀態）、`webhook.delete`、`webhook.rotateSecret`（不含密鑰）、`webhook.autoDisable`。投遞與手動送出不寫稽核，有自己的紀錄。

### 6.1 錯誤碼

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `WEBHOOK_NOT_FOUND` | 404 | 訂閱不存在 |
| `WEBHOOK_VERSION_CONFLICT` | 409 | `version` 不是目前的版本（`details.current`） |
| `WEBHOOK_URL_NOT_ALLOWED` | 400 | `details.reason`：`invalid`、`protocol`、`credentials`、`blocked`、`unresolvable` |
| `WEBHOOK_EVENT_UNKNOWN` | 400 | 訂閱了沒有登記或不能訂閱的事件（`details.events`） |
| `WEBHOOK_DISABLED` | 409 | 停用中送測試事件或重送 |
| `WEBHOOK_LIMIT_REACHED` | 409 | 已有 50 個訂閱（`details.max`）；建立時先鎖表再數 |
| `WEBHOOK_URL_LIMIT_REACHED` | 409 | 不重複的網址數會超過 `webhook.maxUrls` 而且比變更前多（`details.max`；§2.1） |
| `WEBHOOK_DELIVERY_NOT_FOUND` | 404 | 重送的紀錄不屬於這個訂閱、網址已從訂閱移除，或事件已被清理 |

---

## 7. 前端

`apps/backstage/src/features/webhook/`（可啟用的 feature，登入後依租戶的啟用清單安裝；`app/features.ts`）。

| 路由 | 頁面 | Page Key |
| --- | --- | --- |
| `/webhook` | 列表（名稱、第一個網址與「+N」、狀態、事件數、連續失敗、最後投遞；刪除） | `WEBHOOK`（`webhook:read`） |
| `/webhook/create` | 建立對話框：名稱、網址（`WebhookUrlsInput`，1～10 列，空白列不送出）、事件（多選）；成功後同一個對話框顯示密鑰與驗簽說明 | `WEBHOOK_CREATE` |
| `/webhook/$webhookId` | 詳情對話框：設定（每個網址與它的連續失敗；編輯、停用／啟用、輪替密鑰、送測試事件——多個網址時提示幾個成功、幾個失敗）、投遞紀錄（網址欄、依網址與成功／失敗篩選、檢視內容與回應、重送） | 沿用 `WEBHOOK` |

- route id `webhook.detail`（`webhookId`）在 plugin 的同步階段登記：`webhook.disabled` 的通知連到詳情。
- 依賴圖（`apis/resources.ts`）：`webhook` 的 entity 含詳情與該訂閱的投遞紀錄（`[WEBHOOK_DELIVERIES_QUERY_KEY, webhookId]`）；
  `webhookDelivery` 以 `refs.webhook` 衍生到 `webhook`；稽核列表不因 `webhookDelivery` 重抓。
- 編輯帶 `version`；衝突時表單顯示 `VersionConflictAlert`。

---

## 8. 測試

| 對象 | 檔案 |
| --- | --- |
| 多個網址：每個網址各送一次、依網址篩選、移除網址後紀錄保留快照；網址數上限（同一個網址不另外計數） | `test/webhooks.spec.ts` |
| 建立（密鑰只在回應、資料庫是密文、稽核不含密鑰）、未登記的事件、auditor 只能讀；建立使用者 → 真的投遞到本機接收端（簽章、payload 只有 id、紀錄）；500 記失敗與失敗次數；`user.statusChanged` 的前後狀態與只送給有訂閱的；送測試事件、重送（事件 id 不變、attempt 接續）、輪替後用新密鑰；樂觀鎖、停用後不能送也不入列；到門檻自動停用（稽核、通知）；硬刪除 CASCADE | `test/webhooks.spec.ts` |
| `emit`（同一個交易、每個網址一筆、沒有訂閱不寫、feature 關閉、未登記拋錯）、可訂閱清單、建立／更新／輪替／刪除、網址數上限（只擋變多）、測試送到每個網址、重送到同一個網址、各錯誤碼 | `src/modules/webhook/__tests__/webhook.service.spec.ts` |
| 信封與簽章、成功／失敗／沒有回應、到門檻停用（稽核、通知、不拋出）、略過的情況、手動不計入門檻、清理分批 | `src/modules/webhook/__tests__/webhook-delivery.service.spec.ts` |
| 網址檢查（production 與開發）、密鑰加解密、簽章的已知值、事件名稱格式、目錄 | `src/modules/webhook/__tests__/webhook.transport.spec.ts` |
| 位址檢查、`pinnedLookup`、`sendOutboundRequest`（綁定、字面 IP、逾時、不跟隨轉址、回應截斷） | `src/core/http/__tests__/outbound.spec.ts` |
| 發出點：審批核准／駁回、檔案上傳完成 | `approval.service.spec.ts`、`file.service.spec.ts` |
| 端點的授權與 feature 宣告 | `test/route-audit.spec.ts` |
| 前端：權限 facade、列表／詳情／建立的權限三案例、密鑰只顯示一次、送測試事件與重送、自動停用的說明；catalog 安裝與 route id | `features/webhook/**/__tests__`、`app/__tests__/features.test.ts` |

## 9. 設計決策：Webhook

> 原 ADR-0030，2026-10-02 決定（開放問題依提案中的建議；W0～W3 在 branch `feat/webhooks`）。一個訂閱多個目標網址、失敗次數改記在網址上，見 §10（§10.2 D12～D16）。

### 9.1 背景

外部系統（Slack、CI、客戶自己的系統）沒辦法得知「使用者被停用了」「審批通過了」「檔案上傳完成了」，只能輪詢。
API token 與對外 API（[`architecture/06-external-api.md`](../06-external-api.md) §9）解決了「外部來拉」，這份決定「我們主動推」。

`DomainEventBus` 不能當來源：程序內、fire-and-forget、handler 錯誤吞掉，而且它的事件是給快取失效與推播用的，
沒有業務語意。可靠的路已經存在：交易內 `JobQueue.enqueue(..., { tx })` 先寫租戶 DB 的 `job_outbox`，提交後搬進 pg-boss，
另有 `jobs.outboxSweep` 兜底（[`backend/10-jobs.md`](./10-jobs.md) §4.1）。

相關：[`backend/10-jobs.md`](10-jobs.md) §9（背景工作）、[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D15（交易內入列走 `job_outbox`）、[`backend/15-notification.md`](15-notification.md) §12／[`backend/16-notification-event.md`](16-notification-event.md) §9（通知；自動停用時通知）、[`architecture/06-external-api.md`](../06-external-api.md) §9（接收端以 API token 回查）、[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §9／[`architecture/05-tenancy.md`](../05-tenancy.md) §12（可關閉的 feature）。

### 9.2 決定

**對外事件**

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **對外事件定義在程式碼**：擁有者模組在 `<name>.webhooks.ts` 以 `defineWebhookEvent<Data>('user.created', { version: 1 })` 宣告，在 `*.module.ts` constructor 以 `WebhookEventCatalog.register([...])` 登記（與通知目錄同一個模式）。重複的名稱讓程序啟動失敗；`emit()` 遇到沒登記的事件拋 `Error` | 通用模組不 import 業務模組（`conventions/07-layer-dependencies.md` §3.2）；訂閱頁的事件清單從目錄來，不會漏列或列出發不出去的事件 |
| D2 | **第一批**：`user.created`、`user.statusChanged`、`user.deleted`、`user.restored`、`approval.decided`、`file.uploaded`，另有系統事件 `webhook.ping`（只由「送測試事件」發出，不能訂閱）。<br>提案的 `user.disabled` 改成 `user.statusChanged`（`{ userId, status, previousStatus }`）：停用、啟用、鎖定都需要，分成多個事件只會讓接收端多訂幾個 | 這幾個是現有模組裡「外部系統最常要跟著動」的狀態轉移；`statusChanged` 一個事件涵蓋所有狀態 |
| D3 | **payload 只帶識別資訊與必要欄位**：信封 `{ id, type, version, occurredAt, tenant: <代碼>, data }`；`data` 只有 id 與列舉值（例：`{ userId }`、`{ approvalId, approvalType, decision }`、`{ fileId, folderId }`），**不帶 email、名稱等個資**。接收端要細節時用 API token 經對外 API 回查 | 回查時套用 token 自己的權限與 scopes，webhook 不必另外做權限過濾（D5）；payload 外洩的影響小 |
| D4 | **版本**：同一個 `version` 只做相容的變更（加欄位）；不相容的變更改用新的事件名稱，舊事件並行一段時間後下線。訂閱不指定版本 | 一個事件一個版本最好推理；需要並行時兩個名稱就夠，不必在訂閱上加版本協商 |

**訂閱與權限**

| # | 決定 | 理由 |
| --- | --- | --- |
| D5 | **不依權限過濾事件**：訂閱只要 `webhook:create`，訂閱者收到租戶內所有符合類型的事件；檔案事件不看建立者對資料夾的存取 | 事件只帶 id（D3）；依建立者過濾要在投遞時重算每個訂閱的權限，而且建立者離職後訂閱的語意會變。能管 webhook 本來就是高權限 |
| D6 | **權限鍵**：`webhook:read`、`webhook:create`、`webhook:update`（改設定、停用／啟用、輪替密鑰、送測試事件、重送）、`webhook:delete`。預設角色：`admin` 全部、`auditor` 只有 `read` | 與服務帳號一樣的四個動作；重送與測試都是「讓它再送一次」，跟著 update |
| D7 | **租戶 DB 的 `webhook_subscriptions`**：`name`、`url`、`events text[]`、`status`（`active`／`disabled`）、`disabled_reason`（`manual`／`failing`）、`secret_encrypted`、`consecutive_failures`、`version`、建立者／修改者與時間。<br>**刪除是硬刪除**，投遞紀錄一併刪除；不進回收桶 | 訂閱是設定，不是業務資料；還原一個已經停止投遞的訂閱沒有意義（與服務帳號同一個判斷，[`architecture/06-external-api.md`](../06-external-api.md) §9）。`version` 照 `03-api-conventions.md` §11 做樂觀鎖 |
| D8 | **可關閉的 feature `webhook`**（[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §9／0029）：既有租戶以平台 migration 啟用，新租戶預設啟用。停用時 `/webhooks` 回 `404 FEATURE_DISABLED`、`emit()` 不入列、已入列的投遞略過；訂閱與紀錄保留 | 對外連線是租戶「買了什麼」的一部分；停用就不該再有流量出去 |

**發出與投遞**

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

### 9.3 不做

- 事件內容的轉換範本、長期保存與重播（只保留 30 天的紀錄）。
- 平台層級的 webhook（租戶建立、停用）。
- 保證送達的 `domain_events` outbox（`backend/08-realtime.md` §7.4）：推播漏掉只是畫面晚一點更新，維持兩條路。
- 依權限過濾事件（D5）、保證順序（D10）、輪替密鑰的寬限期（D14）。

### 9.4 實作階段

| 階段 | 內容 |
| --- | --- |
| W0 | `core/http/outbound.ts`：位址檢查、連線時綁定已驗證位址的 `lookup`；外部 IdP 改由這裡 import |
| W1 | 後端：資料表與 migration、`modules/webhook`（目錄、訂閱 CRUD、`emit()`、投遞工作、自動停用、清理）、擁有者模組發出第一批事件、權限、feature、通知 |
| W2 | backstage：`features/webhook`（列表、建立、詳情、投遞紀錄、重送） |
| W3 | 歸檔：正式文件、刪除提案 |

### 9.5 實作紀錄

| 項目 | 與上面的決定不同或補充的地方 |
| --- | --- |
| D2 | 加了 `user.restored`：從回收桶還原的使用者若沒有事件，接收端在 `user.deleted` 時做的處理就回不來 |
| D13 | 通知的對象從「建立者」改成「當下持有 `webhook:update` 的人」：建立者可能已離職或失去權限，能修好它的人才需要知道 |
| D15 | 位址檢查從 `modules/identity-provider/outbound-guard.ts` 搬到 `core/http/outbound.ts`，新增 `pinnedLookup` 與 `sendOutboundRequest`。外部 IdP 仍只「先查 DNS」：openid-client 的 `customFetch` 只接受 fetch，綁定位址留在 `hardening-followups.md` |
| D17 | 手動的失敗不計入自動停用的門檻（使用者正在除錯）；手動的成功一樣歸零 |
| 其他 | 一個租戶最多 50 個訂閱（`WEBHOOK_LIMIT_REACHED`，建立時鎖表再數）；`webhook.deliver` 並行 10；輪替密鑰不遞增 `version`（不是使用者編輯的欄位） |

### 9.6 評估過的方案

- **以 `DomainEventBus` 為來源**：不保證送達、沒有業務語意（背景）。
- **每個訂閱依建立者的權限過濾**（D5 的另一邊）：投遞時要重算權限，建立者被停用後訂閱的行為難以預期；事件只帶 id 已足夠。
- **以訂閱為 `singletonKey` 依序投遞**（D10 的另一邊）：一個卡住的接收端會擋住它所有的事件。
- **只存密鑰的雜湊**（D14 的另一邊）：簽章需要原始密鑰。
- **訂閱軟刪除並進回收桶**（D7 的另一邊）：還原後的訂閱不會補送刪除期間的事件，還原沒有意義。

## 10. 設計決策：一個訂閱多個目標網址

> 原 ADR-0033 的 D12～D16，2026-10-02 決定。同一份決定的 feature 參數（含租戶的網址數上限 `webhook.maxUrls`，D11）見 [`../05-tenancy.md`](../05-tenancy.md) §13。

### 10.1 背景

原本一個訂閱只能有一個網址（§9.2 D7），自動停用的失敗次數記在訂閱上（§9.2 D13）。2026-10-02 確認的產品需求：一個 Webhook 訂閱可以有 **多個目標網址**；整個租戶可通知的網址數由平台管理者以 feature 參數 `webhook.maxUrls` 設定（預設 1，見 §2.1）。

### 10.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D12 | **新表 `webhook_targets`**（租戶 migration 0033）：`id`、`subscription_id`（CASCADE）、`url`、`consecutive_failures`、`last_delivery_at`、`position`、`created_at`；`unique(subscription_id, url)`。既有訂閱的 `url` 搬成一筆。`webhook_subscriptions.url` 改成可為 null、繼續寫入第一個網址（雙寫），下一次部署再刪（`conventions/03-backend.md` §5 的破壞性變更拆兩次） | 失敗次數要跟著網址走：一個壞掉的網址不能被另一個正常的網址「歸零」而永遠不停用 |
| D13 | **API**：`url` 改成 `urls`（1–10 個、不重複、各自照 D15 檢查），回應的 `targets` 帶每個網址的連續失敗次數與最後投遞時間。修改網址時保留沒變的網址（id 與失敗次數不變），移除的網址刪除（投遞紀錄的 `target_id` 設為 null，保留 `url` 快照） | 一個訂閱 = 一組事件 ＋ 一個密鑰 ＋ 一組網址；要不同的事件或密鑰就建另一個訂閱 |
| D14 | **投遞**：`emit()` 為每個訂閱的每個網址入列一筆 `webhook.deliver`（`{ subscriptionId, eventId, targetId }`）；`webhook_deliveries` 加 `target_id`（SET NULL）與 `url`。網址已被移除的工作略過。升版前入列、沒有 `targetId` 的工作送到訂閱的第一個網址 | 每個網址獨立重試：一個慢的接收端不會擋住其他網址 |
| D15 | **自動停用**：失敗次數記在網址上；任何一個網址連續失敗到 50 次，整個訂閱停用（`failing`），通知與稽核帶那個網址。重新啟用時所有網址歸零 | 訂閱的狀態模型不變（只有訂閱能停用）；管理者看得到是哪個網址壞了，移除或修好它再啟用 |
| D16 | **手動送出**：送測試事件送到 **每個網址**，回傳 `{ items: 投遞紀錄[] }`；重送只送那一筆紀錄的網址，網址已被移除回 `404 WEBHOOK_DELIVERY_NOT_FOUND`。投遞紀錄可以依 `targetId` 篩選 | 測試是「這個訂閱通不通」；重送是「這一次再送一次」 |

### 10.3 不做

- 每個網址各自的事件或密鑰（D13）。

### 10.4 代價

| 代價 | 緩解 |
| --- | --- |
| Webhook API 的 `url` 改成 `urls`（不相容） | 前端同一批修改；對外 API 沒有 webhook 端點 |

### 10.5 實作紀錄

| 項目 | 補充 |
| --- | --- |
| D12 | `webhook_deliveries.url` 以 migration 回填後設為 NOT NULL；升版期間舊程式碼寫入的投遞紀錄會失敗並由 pg-boss 重試。舊欄位的刪除登記在 [`../../issues/webhook-legacy-columns.md`](../../issues/webhook-legacy-columns.md) |
