# Webhook 訂閱的舊欄位 `url`、`consecutive_failures` 待刪除

## 現況

[`backend/17-webhook.md`](../architecture/backend/17-webhook.md) §10.2 D12 把網址與連續失敗次數搬到 `webhook_targets`（租戶 migration `0033_webhook_targets`）。
依破壞性變更拆兩次部署的規則（[`../conventions/03-backend.md`](../conventions/03-backend.md) §5），這一次只改成：

- `webhook_subscriptions.url`：改成可為 null，`WebhookService.create()`／`update()` 雙寫第一個網址（`apps/api/src/modules/webhook/webhook.service.ts`），
  只給升版期間的舊程式碼讀。
- `webhook_subscriptions.consecutive_failures`：不再更新（`apps/api/src/db/schema/webhooks.ts` 的註解），讀取一律看 `webhook_targets`。

## 影響

沒有錯誤結果；兩個欄位只是多餘的資料。`consecutive_failures` 停在升版當下的值，直接查 DB 的人可能誤讀。

## 修正方式

[`architecture/05-tenancy.md`](../architecture/05-tenancy.md) §13 的變更部署到所有環境之後：

1. 拿掉 `WebhookService` 對 `url` 的雙寫（`url: urls[0]`）。
2. `db/schema/webhooks.ts` 刪除兩欄，`pnpm db:generate` 產生 `ALTER TABLE webhook_subscriptions DROP COLUMN url, DROP COLUMN consecutive_failures`。
3. 更新 [`../architecture/backend/17-webhook.md`](../architecture/backend/17-webhook.md) §2 的說明。

## 驗證方式

`pnpm typecheck`、`apps/api/test/webhooks.spec.ts`。
