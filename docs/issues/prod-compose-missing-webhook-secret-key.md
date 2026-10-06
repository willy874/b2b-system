# prod compose 沒有傳 `WEBHOOK_SECRET_KEY`，api 與對外 API 在 production 起不來

## 現況

`apps/api/src/core/config/env.schema.ts` 的 `ProductionEnvSchema`（L383–421）在 `NODE_ENV=production` 時要求 `WEBHOOK_SECRET_KEY`（L415–417）：

```ts
if (!env.WEBHOOK_SECRET_KEY) {
  ctx.addIssue({ code: 'custom', path: ['WEBHOOK_SECRET_KEY'], message: 'production 必須設定' });
}
```

`docker-compose.prod.yml` 沒有傳這個變數：

- api 的 environment（`&api-environment`，L87–146）裡沒有它。最後三個金鑰是 L144–146 的 `OIDC_JWKS`、`OIDC_COOKIE_KEYS`、`IDP_SECRET_KEY`。
- `external-api` 以 `<<: *api-environment`（L165）沿用同一份，所以也沒有。
- compose 沒有 `env_file`。根目錄的 `.env` 只用來替換 `${…}`，不會注入容器。

文件也漏列：

- [README](../../README.md)「部署」的必填清單（L148–151）。
- [`01-system.md`](../architecture/01-system.md) §4.2（L234）。
- [`04-sso.md`](../architecture/04-sso.md) §7 的表格。

這條必填檢查隨 webhook 加入（`369b0d36`，[`backend/17-webhook.md`](../architecture/backend/17-webhook.md) §9.2 D14），當時 compose 沒有同步。

重現：

1. 取 compose 給 api 的 40 個 key，全部填上有效的假值，設 `NODE_ENV=production`。
2. 呼叫 `validateEnv()`。
3. 唯一的錯誤是 `WEBHOOK_SECRET_KEY: production 必須設定`。

## 影響

照 README 執行 `docker compose -f docker-compose.prod.yml up --build`，結果如下：

- migrate 會成功；api 與 external-api 則在驗證環境變數時失敗，因為 `restart: unless-stopped` 而反覆重啟。
- 依賴它們的服務都起不來：backstage（L251–253）與 platform（L276–278）在等 `api: service_healthy`，external-gateway（L207–209）在等 `external-api: service_healthy`。
- 從 10-02 起，文件提供的 production 部署路徑完全不能用。
- 目前沒有任何自動檢查會跑這個組合（見 [`no-ci-pipeline.md`](./no-ci-pipeline.md)）。

## 修正方式

1. compose 的 api environment 在 L146 之後加上：

   ```yaml
   WEBHOOK_SECRET_KEY: ${WEBHOOK_SECRET_KEY:?required}
   ```

   external-api 會經 merge 自動取得。
2. 補文件：README 的必填清單、01-system.md §4.2、04-sso.md §7。`TENANT_SECRET_KEY` 也一併補進 01-system.md 與 04-sso.md 的清單。
   也可以只在 [`02-repository-structure.md`](../architecture/02-repository-structure.md) §5 列一份完整清單，其他地方連過去，避免幾份清單再分歧。
3. 加一個防止再漏的檢查（擇一，建議 a）：
   - a. 在 `apps/api/src/core/config/__tests__/` 新增測試：解析 `docker-compose.prod.yml`，取 `api` 與 `external-api` 的 environment key，以假值組成 env 跑 `validateEnv()`，必須通過。
   - b. 在 CI 以假值跑 `docker compose -f docker-compose.prod.yml up`，等 api 變成 healthy。

## 驗證方式

- 上面的測試通過；故意拿掉 `WEBHOOK_SECRET_KEY` 時會失敗。
- `docker compose -f docker-compose.prod.yml config` 的輸出裡，`api` 與 `external-api` 都有這個變數。
- 以假值起整組服務，api 與 external-api 都變成 healthy。
