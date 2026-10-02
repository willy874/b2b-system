# 17 — Webhook

事件發生時以 HTTP POST 通知外部系統（CI、聊天工具、客戶自己的服務）。決定與理由見 [ADR-0030](../../adr/0030-webhooks.md)；
接收端回查細節用的 API token 與對外 API 見 [`../06-external-api.md`](../06-external-api.md)。

```
擁有者模組（user／approval／file）
  └─ 業務交易內：audit.record → webhooks.emit(EVENT, data, tx)
                                   ├─ 查訂閱這個事件的 active 訂閱（webhook_subscriptions）
                                   ├─ 寫一筆 webhook_events
                                   └─ 每個訂閱 JobQueue.enqueue(webhook.deliver, { subscriptionId, eventId }, { tx })  ← job_outbox
提交後 → pg-boss → webhook.deliver（worker）
  └─ 簽章 → 連線時綁定已驗證的位址 → POST → 寫 webhook_deliveries → 成功歸零／失敗加一（到門檻停用）→ 失敗就拋出讓 pg-boss 重試
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

## 2. 資料表（租戶 DB，migration `0024_webhooks`）

| 表 | 欄位 | 說明 |
| --- | --- | --- |
| `webhook_subscriptions` | `name`、`url`、`events text[]`、`status`（`active`／`disabled`）、`disabled_reason`（`manual`／`failing`）、`secret_encrypted`、`consecutive_failures`、`last_delivery_at`、`version`、`created_by`／`updated_by`（→ `users` `SET NULL`）、時間 | 硬刪除、不進回收桶（D7）。部分 GIN 索引 `(events) WHERE status = 'active'` 給 `emit()` |
| `webhook_events` | `type`、`version`、`data jsonb`、`occurred_at` | 只在有訂閱時寫；`data` 只有 id 與列舉值（D3） |
| `webhook_deliveries` | `subscription_id`（CASCADE）、`event_id`（CASCADE）、`attempt`、`trigger`（`auto`／`manual`）、`succeeded`、`response_status`、`duration_ms`、`response_body`（前 1 KB）、`error`、`created_at` | 每一次嘗試一列；索引 `(subscription_id, created_at desc, id)` |

- 訂閱的 `events` 存名稱：程式移除某個事件之後，讀取時濾掉（`toDto`），不讓請求失敗。
- 密鑰以 `SecretBox`（AES-256-GCM）加密，主金鑰 `WEBHOOK_SECRET_KEY`；沒設定時（僅開發）由 `JWT_SECRET` 以 HKDF 推導，production 沒設定就不能啟動。

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
| 工作 | `webhook.deliver`（`scope: 'tenant'`、並行 10、一次最多 60 秒）：`retryLimit` 8、60 秒起指數退避、最多 1 小時（合計約 4 小時） |
| 略過 | 租戶關掉 `webhook`、訂閱已刪除或停用、事件已被清理：回 `{ skipped }`，不重試 |
| 成功 | 2xx。寫一筆 `succeeded = true`，`consecutive_failures` 歸零、更新 `last_delivery_at` |
| 失敗 | 其他狀態碼（含 3xx，不跟隨轉址）、逾時（10 秒）、連線失敗、被擋下。寫一筆 `succeeded = false`（沒收到回應時 `error` 是 `TIMEOUT`、`BLOCKED`、`ECONNREFUSED`…），`consecutive_failures` 加一，拋出 `WebhookDeliveryFailedError` 讓 pg-boss 重試 |
| 自動停用 | 失敗次數到 **50**（`WEBHOOK_AUTO_DISABLE_AFTER_FAILURES`）而且仍是 `active`：同一條 UPDATE 改成 `disabled`／`failing`、`version` 加一；同一個交易寫稽核 `webhook.autoDisable`（沒有操作者）並通知當下持有 `webhook:update` 的人（`webhook.disabled`，連到 `webhook.detail`）。這一次不拋出，之後的重試看到停用就略過 |
| 工作的 `output` | `{ deliveryId, attempt, succeeded, responseStatus }`，不放 payload、網址與回應（`job:read` 的人看得到） |
| 推播 | 每一次嘗試推 `webhookDelivery create`（`refs.webhook`）；自動停用另推 `webhook update` |

**手動送出**（同步，在請求裡送、回傳這一次的投遞紀錄，D17）：

- `POST /webhooks/:id/test`：寫一筆 `webhook.ping` 事件後送出。
- `POST /webhooks/:id/deliveries/:deliveryId/redeliver`：送那一筆紀錄的事件（事件 id 不變），`attempt` 接續。
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
| GET | `/webhooks?offset=&limit=&keyword=&status=` | `webhook:read` | 列表（新的在前；`keyword` 比對名稱與網址） |
| GET | `/webhooks/events` | `webhook:read` | 可訂閱的事件：可訂閱、所屬 feature 已啟用 |
| POST | `/webhooks` | `webhook:create` | `{ name, url, events }` → `{ secret, webhook }`；`secret` 只出現這一次。一個租戶最多 50 個 |
| GET | `/webhooks/:id` | `webhook:read` | |
| PATCH | `/webhooks/:id` | `webhook:update` | `{ name?, url?, events?, status?, version }`；啟用時失敗次數歸零、停用原因清空；停用記為 `manual` |
| DELETE | `/webhooks/:id` | `webhook:delete` | 硬刪除，投遞紀錄一併刪除 |
| POST | `/webhooks/:id/rotate-secret` | `webhook:update` | → `{ secret, webhook }`；舊的立即失效，不遞增 `version` |
| POST | `/webhooks/:id/test` | `webhook:update` | 同步送出 `webhook.ping`，回傳投遞紀錄 |
| GET | `/webhooks/:id/deliveries?offset=&limit=&succeeded=` | `webhook:read` | 投遞紀錄（新的在前），帶事件的 `type`、`data`、`occurredAt` |
| POST | `/webhooks/:id/deliveries/:deliveryId/redeliver` | `webhook:update` | 同步重送，回傳投遞紀錄 |

稽核：`webhook.create`、`webhook.update`（`diff` 名稱、網址、事件、狀態）、`webhook.delete`、`webhook.rotateSecret`（不含密鑰）、`webhook.autoDisable`。投遞與手動送出不寫稽核，有自己的紀錄。

### 6.1 錯誤碼

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `WEBHOOK_NOT_FOUND` | 404 | 訂閱不存在 |
| `WEBHOOK_VERSION_CONFLICT` | 409 | `version` 不是目前的版本（`details.current`） |
| `WEBHOOK_URL_NOT_ALLOWED` | 400 | `details.reason`：`invalid`、`protocol`、`credentials`、`blocked`、`unresolvable` |
| `WEBHOOK_EVENT_UNKNOWN` | 400 | 訂閱了沒有登記或不能訂閱的事件（`details.events`） |
| `WEBHOOK_DISABLED` | 409 | 停用中送測試事件或重送 |
| `WEBHOOK_LIMIT_REACHED` | 409 | 已有 50 個訂閱（`details.max`）；建立時先鎖表再數 |
| `WEBHOOK_DELIVERY_NOT_FOUND` | 404 | 重送的紀錄不屬於這個訂閱，或事件已被清理 |

---

## 7. 前端

`apps/backstage/src/features/webhook/`（可啟用的 feature，登入後依租戶的啟用清單安裝；`app/features.ts`）。

| 路由 | 頁面 | Page Key |
| --- | --- | --- |
| `/webhook` | 列表（名稱、網址、狀態、事件數、連續失敗、最後投遞；刪除） | `WEBHOOK`（`webhook:read`） |
| `/webhook/create` | 建立對話框：名稱、網址、事件（多選）；成功後同一個對話框顯示密鑰與驗簽說明 | `WEBHOOK_CREATE` |
| `/webhook/$webhookId` | 詳情對話框：設定（編輯、停用／啟用、輪替密鑰、送測試事件）、投遞紀錄（成功／失敗篩選、檢視內容與回應、重送） | 沿用 `WEBHOOK` |

- route id `webhook.detail`（`webhookId`）在 plugin 的同步階段登記：`webhook.disabled` 的通知連到詳情。
- 依賴圖（`apis/resources.ts`）：`webhook` 的 entity 含詳情與該訂閱的投遞紀錄（`[WEBHOOK_DELIVERIES_QUERY_KEY, webhookId]`）；
  `webhookDelivery` 以 `refs.webhook` 衍生到 `webhook`；稽核列表不因 `webhookDelivery` 重抓。
- 編輯帶 `version`；衝突時表單顯示 `VersionConflictAlert`。

---

## 8. 測試

| 對象 | 檔案 |
| --- | --- |
| 建立（密鑰只在回應、資料庫是密文、稽核不含密鑰）、未登記的事件、auditor 只能讀；建立使用者 → 真的投遞到本機接收端（簽章、payload 只有 id、紀錄）；500 記失敗與失敗次數；`user.statusChanged` 的前後狀態與只送給有訂閱的；送測試事件、重送（事件 id 不變、attempt 接續）、輪替後用新密鑰；樂觀鎖、停用後不能送也不入列；到門檻自動停用（稽核、通知）；硬刪除 CASCADE | `test/webhooks.spec.ts` |
| `emit`（同一個交易、沒有訂閱不寫、feature 關閉、未登記拋錯）、可訂閱清單、建立／更新／輪替／刪除、各錯誤碼 | `src/modules/webhook/__tests__/webhook.service.spec.ts` |
| 信封與簽章、成功／失敗／沒有回應、到門檻停用（稽核、通知、不拋出）、略過的情況、手動不計入門檻、清理分批 | `src/modules/webhook/__tests__/webhook-delivery.service.spec.ts` |
| 網址檢查（production 與開發）、密鑰加解密、簽章的已知值、事件名稱格式、目錄 | `src/modules/webhook/__tests__/webhook.transport.spec.ts` |
| 位址檢查、`pinnedLookup`、`sendOutboundRequest`（綁定、字面 IP、逾時、不跟隨轉址、回應截斷） | `src/core/http/__tests__/outbound.spec.ts` |
| 發出點：審批核准／駁回、檔案上傳完成 | `approval.service.spec.ts`、`file.service.spec.ts` |
| 端點的授權與 feature 宣告 | `test/route-audit.spec.ts` |
| 前端：權限 facade、列表／詳情／建立的權限三案例、密鑰只顯示一次、送測試事件與重送、自動停用的說明；catalog 安裝與 route id | `features/webhook/**/__tests__`、`app/__tests__/features.test.ts` |
