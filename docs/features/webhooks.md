# Webhook

- 優先度：P2
- 狀態：提案
- 依賴：背景工作（已完成，[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)）
- 相關：[`api-tokens.md`](./api-tokens.md)（接收端回查細節）、站內通知（[`backend/15-notification.md`](../architecture/backend/15-notification.md)；訂閱被自動停用時通知）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

外部系統（Slack、CI、之後的遊戲伺服器）沒辦法得知「使用者被停用了」「審批通過了」「檔案上傳完成了」，只能輪詢。

內部已經有 `DomainEventBus`，但它 **不適合直接當 webhook 的來源**：

- 程序內、fire-and-forget、handler 錯誤吞掉（`core/events/event-bus.ts`）；程序在交易提交後、發佈前重啟，事件就沒了
- 只有 4 種事件，而且是給快取失效用的（`resource.changed` 只帶 id 和 `ChangeKind`，沒有「發生了什麼業務事件」的語意）
- 保證送達的升級路徑（`domain_events` outbox）在 [`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §7.4 寫了但沒有做

可靠的路已經存在：**交易內入列背景工作**。`JobQueue.enqueue(..., { tx })` 先寫租戶 DB 的 `job_outbox`，提交後搬進 pg-boss，
另有 `jobs.outboxSweep` 兜底（[`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §4.1）。寄信就是這樣做的。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 訂閱設定（租戶 DB）：URL、事件類型、啟用／停用、密鑰 | 事件內容的轉換範本 |
| 對外事件的目錄：名稱、版本、payload 型別，與內部領域事件分開定義 | 對外事件的長期保存與重播 |
| 擁有者模組在業務交易內發出對外事件（經 `job_outbox`） | 平台層級的 webhook（租戶建立、停用） |
| HMAC-SHA256 簽章、時間戳防重放、每次投遞的唯一 id | |
| 失敗重試（`defineJob` 的指數退避）、連續失敗自動停用 | |
| 投遞紀錄頁：狀態碼、耗時、回應摘要、手動重送 | |
| 投遞前擋內網位址（SSRF），連線時綁定已驗證的 IP | |

## 初步構想

### 發出事件

- 擁有者模組在交易內呼叫 `WebhookService.emit(event, payload, tx)`：
  - 查有訂閱這個事件的啟用中訂閱（可快取，訂閱變更時失效）
  - 每個訂閱入列一筆 `webhook.deliver` 工作（`scope: 'tenant'`，帶 `tx`）；沒有訂閱就什麼都不做
- `modules/webhook` 不 import 其他模組；事件目錄是型別與常數（`*.constants.ts`），擁有者模組 import 常數即可（[`conventions/07-layer-dependencies.md`](../conventions/07-layer-dependencies.md) §3.2）。
- 第一批候選（見開放問題 1）：`user.created`、`user.disabled`、`user.deleted`、`approval.decided`、`file.uploaded`。

### 投遞

- `webhook.deliver`：`retryLimit`、`retryDelaySeconds` 依 `defineJob` 設定（例如 8 次、60 秒起、上限 1 小時）。
- 每次嘗試寫一筆 `webhook_deliveries`（訂閱、事件 id、狀態碼、耗時、回應前 N 位元組、錯誤）；保留 N 天，排程清理。
- 連續失敗到門檻就把訂閱改成停用並通知建立者。
- 請求：`POST`、JSON、標頭 `X-Webhook-Id`、`X-Webhook-Event`、`X-Webhook-Timestamp`、`X-Webhook-Signature: sha256=<HMAC(secret, timestamp.body)>`；逾時 10 秒；不跟隨轉址。
- SSRF：解析 DNS 後拒絕私有、loopback、link-local 位址，並用那個 IP 連線（外部 IdP 目前只做到「先查 DNS」，見 [`hardening-followups.md`](./hardening-followups.md)，
  兩邊可以共用同一個 helper）。
- 工作的 `output` 對 `job:read` 的人可見，**不放 payload**（與寄信工作同一條規則，[`backend/11-mail.md`](../architecture/backend/11-mail.md)）；
  投遞細節看投遞紀錄頁。

### payload

- 只送識別資訊與必要欄位：`{ id, event, version, occurredAt, tenant: <代碼>, data: { ... } }`；敏感欄位不出去，接收端需要細節時用 [API token](./api-tokens.md) 回查。

### 權限與稽核

- `webhook:read`、`webhook:create`、`webhook:update`、`webhook:delete`；手動重送用 `webhook:update`
- 訂閱的建立、修改、刪除、密鑰輪替寫稽核；投遞不寫稽核（有自己的紀錄表）

## 開放問題

1. 第一批要對外公開哪些事件？每個事件的 payload 版本怎麼演進？
2. 訂閱要不要受權限過濾？例如建立者看不到的資料夾裡的檔案事件要不要送。不過濾就要規定「只有 `webhook:create` 的人能訂閱，且事件只帶 id」。
3. 同一個事件對同一個訂閱要保證順序嗎？pg-boss 預設不保證；需要的話以訂閱為 `singletonKey` 依序投遞，吞吐會下降。
4. 有 webhook 之後，要順便把 `domain_events` outbox 做起來，讓推播也保證送達嗎？還是維持兩條路？

## 歸檔去向

- `docs/architecture/backend/NN-webhook.md`、`docs/rbac/02-permission-catalog.md`
