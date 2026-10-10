# Webhook 投遞的除錯

- 優先度：P2
- 狀態：提案
- 依賴：Webhook（[`backend/17-webhook.md`](../architecture/backend/17-webhook.md)：§3.2 信封與請求、§4 投遞與手動送出、§9.2 D3、D11、D17、§10.2 D16）
- 相關：[`list-filters-completion.md`](./list-filters-completion.md)（投遞紀錄的篩選——結果、網址——放進網址列，由那份提案統一處理，這裡不做）；
  E2E 的 webhook 接收端（[`frontend/10-testing.md`](../architecture/frontend/10-testing.md) 第 18 項）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

接收端的工程師對照「我們送了什麼」與「他們收到什麼」時，backstage 的投遞紀錄給的資訊和實際送出的請求對不上：

| 位置 | 現況 | 問題 |
| --- | --- | --- |
| `features/webhook/pages/WebhookDetail/components/WebhookDeliverySection.tsx:252-253` | 「內容」區塊顯示 `JSON.stringify({ type, data })` | 實際的 body 是信封 `{ id, type, version, occurredAt, tenant, data }`（§3.2、D3）。接收端驗簽用的是 **原始 body**，畫面上的 JSON 拿去算 HMAC 一定對不上；`tenant`、`version` 也看不到 |
| 同上，詳情對話框 | 沒有請求標頭 | 實際送出 `Content-Type`、`User-Agent`、`X-Webhook-Id`、`X-Webhook-Event`、`X-Webhook-Timestamp`、`X-Webhook-Signature`（D11，`apps/api/src/modules/webhook/webhook.signature.ts` 的 `webhookHeaders()`）。接收端說「時間戳太舊被拒」時，沒辦法查那一次送的時間戳 |
| `apps/api/src/db/schema/webhooks.ts` 的 `webhook_deliveries` | 存了狀態碼、耗時、回應開頭、`error` | 沒存送出時的 `X-Webhook-Timestamp`（`webhook-delivery.service.ts:133` 算完就丟）；`created_at` 是收到回應後才寫，差了整個請求的耗時，不能拿來重建簽章的輸入 |
| `WebhookDeliverySection.tsx:156-160` | 「重送」一按就同步送出 | 沒有確認：重送會讓接收端 **再收到一次同一個事件 id**（D17），接收端沒做冪等時會重複處理；誤按也收不回 |
| 詳情對話框 | 只有網址、事件 id、內容、回應 | 沒有 `attempt`、`trigger`（自動／手動）、`error` 的說明；列表欄位有，但打開詳情反而看不到 |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 詳情顯示 **完整信封**，與實際送出的 body 逐字相同（同一個序列化函式產生），附「複製 body」 | 事件內容的轉換範本、長期保存與重播（§9.3 不做） |
| 詳情顯示 **請求標頭**：`X-Webhook-Signature` 預設遮罩（`sha256=••••` ＋ 末 6 碼），可展開（開放問題 1） | 顯示或匯出簽章密鑰（D14：只在建立與輪替的回應出現一次） |
| `webhook_deliveries` 加 `request_timestamp`，讓標頭可以重建 | 儲存回應標頭、回應超過 1 KB 的部分（§4：回應只讀前 1 KB） |
| 重送前確認：顯示網址、事件 id、這是第幾次、「接收端會再收到同一個事件 id」的提醒 | 批次重送（一次重送某段時間的所有失敗；工作層的批次在 [`platform-job-management.md`](./platform-job-management.md)） |
| 詳情補上 `attempt`、`trigger`、`error` 代碼的說明（`TIMEOUT`、`BLOCKED`、`ECONNREFUSED`…） | 投遞紀錄的篩選進網址（[`list-filters-completion.md`](./list-filters-completion.md)） |
| 同一個事件的所有嘗試：詳情列出同一個 `eventId` 對同一個網址的歷次結果 | 依權限過濾事件、保證順序（§9.3 不做，D5、D10） |

## 使用者故事

**作為接收端的工程師，我希望看到這一次送出的原始 body 與標頭，以便自己算一次 HMAC 確認是哪一邊錯。**

- **Given** 接收端回 401「signature mismatch」，投遞紀錄是失敗
- **When** 我打開那一筆的詳情，複製 body，以 `X-Webhook-Timestamp` 與我手上的密鑰計算 `sha256=…`
- **Then** 算出來的與畫面上展開後的簽章相同，問題在接收端讀 body 的方式（例如被框架重新序列化）

**作為租戶管理員，我希望重送前知道對方會再收到同一個事件，以便不要誤觸造成重複處理。**

- **Given** 一筆 `user.created` 已經成功送達
- **When** 我按「重送」
- **Then** 確認框顯示「將再次送出事件 `<id>` 到 `<url>`（第 3 次）；接收端應以 `X-Webhook-Id` 去重」；取消則不送

## 初步構想

### 1. 後端

- **資料模型（租戶 DB）**：`webhook_deliveries.request_timestamp integer NULL`（Unix 秒，與標頭相同）。新增欄位，舊紀錄是 null；保留 30 天後自然全部有值，不回填。
- `WebhookDeliveryService.attempt()` 把 `timestamp`（`webhook-delivery.service.ts:133`）寫進 `values`。
- 信封的組裝抽成 `buildWebhookEnvelope(event, tenantCode)`（`webhook.signature.ts`），投遞與讀取共用，保證畫面上的 body 與送出的逐字相同（key 的順序也一樣）。
- `WebhookDeliverySchema` 加：
  - `body`：伺服器端以同一個函式序列化好的字串（不讓前端自己 `JSON.stringify`，避免順序或空白不同）。
  - `requestHeaders`：`Record<string, string>`；`X-Webhook-Signature` 由伺服器以 `subscription` 的密鑰 **重新計算**（`request_timestamp` ＋ body），只回遮罩後的值與 `signatureTail`；`request_timestamp` 為 null 時不回時間戳與簽章。
  - 開放問題 1 決定是否另有 `GET …/deliveries/:deliveryId/signature` 回完整簽章。
- `GET /webhooks/:id/deliveries/:deliveryId`（單筆，`webhook:read`）：詳情與「同一個事件的歷次嘗試」用；列表回應不帶 `body`／`requestHeaders`，維持精簡。
- 重送沿用 `POST …/redeliver`，不加參數。
- 改了 DTO：依 CLAUDE.md 重產 openapi 與 SDK。

### 2. 前端（`features/webhook`）

- 詳情對話框改成分段：概要（網址、事件、`attempt`、`trigger`、結果、耗時、時間）→ 請求（標頭表格 ＋ body 的 `<pre>`、複製）→ 回應（狀態碼或 `error` 的說明、回應開頭）→ 同一個事件的嘗試（小表格，點了切換）。
  詳情需要多一個請求：`apis/webhook/get-webhook-delivery/`。
- 重送改用 `useConfirm()`（`@b2b-system/ui/ConfirmDialog`，同一頁的 `WebhookSettingsSection.tsx` 已經這樣用）；詳情對話框裡也放「重送」，共用同一個確認。
- `error` 代碼的說明放 `locale.ts` 的 `webhook.delivery.error.<CODE>`；不認得的代碼顯示原值。
- 語系：兩個語系檔各補標頭欄位名、遮罩的說明、重送確認的文案。

### 3. 權限、稽核、推播

- 權限不變：讀詳情 `webhook:read`，重送 `webhook:update`（D6）。
- 稽核：沿用現況（重送不寫稽核，投遞紀錄本身就是紀錄）；看詳情不寫。
- 推播不變：`webhookDelivery create` 讓詳情的「歷次嘗試」重抓。

## 開放問題

1. **簽章要不要能看完整值？** 簽章是 `HMAC(secret, timestamp.body)`，知道它不能反推密鑰，也只對那一次的時間戳有效；接收端本來就收到了它。
   但 `auditor` 只有 `webhook:read`，讓他拿到可重放的完整請求（在接收端的時間容忍內）是否可接受？選項：A. 一律遮罩；B. 有 `webhook:update` 才能展開；C. 都能看。
2. **重算簽章 vs. 存下簽章**：重算要在讀取時解密密鑰；輪替密鑰後舊紀錄算出來的簽章就與當時送出的不同。要存 `signature` 欄（多 71 bytes／筆），還是輪替後的舊紀錄標示「密鑰已輪替，無法重現」？
3. 「複製成 curl」要不要做？方便接收端在本機重放，但等於把可用的簽章交出去，與問題 1 綁在一起。
4. 送測試事件（`POST /webhooks/:id/test`）的結果對話框要不要也顯示完整的請求？目前只有成功／失敗的計數。

## 設計決策

## 歸檔去向

完成後預計寫成：

- [`backend/17-webhook.md`](../architecture/backend/17-webhook.md)：§2 的 `request_timestamp`、§6 的單筆端點與 DTO、新增「設計決策：投遞的除錯」一節
- [`backend/17-webhook.md`](../architecture/backend/17-webhook.md) §7 前端的詳情對話框與重送確認
