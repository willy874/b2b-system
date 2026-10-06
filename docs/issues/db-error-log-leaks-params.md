# 未處理的資料庫錯誤把整份查詢參數寫進日誌與背景工作的 output

## 現況

drizzle-orm 0.45.3 的查詢失敗時拋 `DrizzleQueryError`（`node_modules/drizzle-orm/errors.js`）。訊息與屬性都帶著所有參數：

```js
super(`Failed query: ${query}
params: ${params}`);
this.query = query;
this.params = params;
```

有三個地方把它原樣記錄下來：

1. HTTP 請求的未知錯誤：`apps/api/src/core/errors/http-exception.filter.ts`（L118–119）的 `this.logger.error({ err: exception, requestId }, 'Unhandled exception')`。
2. IdP 的錯誤：`apps/api/src/modules/oidc-provider/oidc-provider.service.ts`（L141）的 `provider.on('server_error', … this.logger.error({ err: error }, 'OIDC 錯誤'))`。adapter 的 DB 錯誤走這裡。
3. 背景工作：`apps/api/src/core/jobs/job-queue.ts` 的 `startWorker()`（L407–413）記一筆 warn 後重新拋出。
   - pg-boss 12.35.1 以 `serialize-error` 把錯誤存成工作的 `output`（`manager.js` 的 `mapCompletionDataArg()`），`params` 屬性也一起存。
   - 背景工作頁把 `output` 回給持有 `job:read` 的人（`apps/api/src/modules/job/job.service.ts` L116）。

`apps/api/src/core/logger/logger.module.ts` 只設定了 `req` 的 serializer（L44）。`err` 用 pino 預設的 serializer，訊息與所有可列舉的屬性（`query`、`params`、`cause`）都會輸出。

參數裡可能有的東西（舉例）：

- `apps/api/src/modules/auth/auth.service.ts` 的 `changePassword()`（L394–399）更新 `password_hash`：argon2 雜湊。
- `apps/api/src/modules/oidc-provider/oidc-payload.repository.ts` 的 `upsert()`（L26–40）：IdP 的 session id 與授權碼。
  - 外部登入的暫存也走這裡（`oidc-provider.service.ts` 的 `saveExternalLogin()`，L352–366），payload 含 `codeVerifier` 與 `nonce`。
- 各種寫入裡的 email、顯示名稱等個資。

## 影響

- 觸發條件是資料庫錯誤：`statement_timeout`（預設 15 秒）、連線中斷、DB 切換、deadlock、外鍵違反等。
  - 一般使用者很難刻意讓別人的查詢失敗。
  - 但維運事件發生時，會一次產生大量這種日誌。
- 日誌平台的存取範圍與保留期限通常比資料庫寬。
- 違反兩份規範：
  - [`conventions/03-backend.md`](../conventions/03-backend.md) §7「不記錄密碼、token」；
  - [`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §5.1 的敏感欄位清單。
- 背景工作的 `output` 讓租戶裡持有 `job:read` 的人（例：auditor）看得到同一個租戶裡其他人的資料。

## 修正方式

1. 在 `core/errors` 加一個共用的函式，例：`describeDbError(error)`。
   - 遇到有 `query` 與 `params` 的錯誤時，只留下：
     - `type`；
     - `query`：SQL 本文，參數是 `$1` 這類佔位，不含值；
     - `cause` 的 `code`、`constraint_name` 與 `message`。
   - `message` 換成不含 `params:` 那一段的版本。
2. LoggerModule 的 `pinoHttp.serializers` 加 `err`：先用 1. 的函式處理，其他錯誤沿用 `pino.stdSerializers.err`。
   - `new Logger(...)` 的應用程式日誌與請求日誌共用同一個 Pino（見 `logger.module.ts` 開頭的註解），所以上面 1.～3. 的日誌都會生效。
3. 背景工作：`JobQueue.startWorker()` 重新拋出之前，把這類錯誤換成只帶 SQL 與錯誤碼的錯誤。
   - 保留 `cause` 的 `code`，讓重試判斷與排查照常可用。
   - 這樣 pg-boss 存下的 `output` 就不含參數。

## 驗證方式

- `apps/api/src/core/logger/__tests__/`：新增 serializer 的測試。
  - 輸入：`new DrizzleQueryError('update "users" set "password_hash" = $1 where "id" = $2', ['$argon2id$secret', 'u1'], cause)`。
  - 斷言：序列化後找不到 `secret`；SQL 本文與 `cause.code` 還在。
- `apps/api/src/core/jobs/__tests__/job-queue.spec.ts`：handler 拋 `DrizzleQueryError` 時，交給 pg-boss 的錯誤不含參數。
- `apps/api/src/core/errors/__tests__/http-exception.filter.spec.ts`：未知的 DB 錯誤仍回 500，記錄的物件不含參數。
