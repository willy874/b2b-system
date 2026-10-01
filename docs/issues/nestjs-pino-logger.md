# api 的應用程式日誌沒有經過 Pino

| 項目 | 內容 |
| --- | --- |
| 嚴重度 | 中：行為與規格不一致，目前不造成錯誤結果 |
| 範圍 | `apps/api` |
| 發現於 | 2026-10-01 升級 NestJS 12 時 |

## 1. 現況

[`conventions/03-backend.md`](../conventions/03-backend.md) §7 寫的是：用 `new Logger(Xxx.name)`（`@nestjs/common`），
**底層接 Pino**。實際上只有 HTTP 存取日誌走 Pino，應用程式日誌沒有：

- `apps/api/src/core/logger/logger.module.ts` 匯入了 `nestjs-pino` 的 `LoggerModule`，設定的是 `pinoHttp`，
  所以每個 HTTP 請求的存取日誌是 Pino 的 JSON，帶 `requestId`，也套用了 `redact`。
- `apps/api/src/main.ts:20` 以 `NestFactory.create(AppModule, { bufferLogs: false })` 建立應用程式，
  **沒有** 呼叫 `app.useLogger(app.get(Logger))`（`nestjs-pino` 的 `Logger`）。
- 因此 `new Logger(Xxx.name)` 的呼叫（`src/` 內約 38 處）走的是 Nest 內建的 `ConsoleLogger`。

## 2. 影響

- 應用程式日誌不是 JSON，**沒有 `requestId`**，無法和同一個請求的存取日誌、稽核紀錄對照。
- 正式環境的日誌收集若依 JSON 解析，這些行會變成無結構的文字。
- 日誌等級各走各的：`NODE_ENV=test` 時 `pinoHttp.level` 是 `silent`，但 `ConsoleLogger` 照樣輸出。
- `redact` 只作用在 Pino；應用程式日誌目前靠各呼叫端自己避免記錄敏感欄位
  （規則見 [`architecture/backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §5.1）。

## 3. 修正方式

1. `main.ts`：建立時改成 `bufferLogs: true`，建立後呼叫 `app.useLogger(app.get(Logger))`（從 `nestjs-pino` 匯入）。
   啟動期間的日誌會先暫存，等 Pino 接上後再輸出。
2. 確認既有呼叫的參數形狀在 Pino 下仍然正確。專案慣例是「物件在前、訊息在後」，例如 `logger.warn({ jobId }, 'retry')`；
   `nestjs-pino` 會把第一個物件併入日誌欄位，但要逐一確認沒有「訊息在前、物件在後」的寫法被當成 context。
3. 決定測試環境的等級：要讓應用程式日誌在測試中也靜音，還是保留 `warn` 以上方便除錯。
4. 檢查 `redact` 是否需要涵蓋應用程式日誌會出現的欄位，例如 `email`、`token`。
5. 修正後 `conventions/03-backend.md` §7 的描述就成立，不需要改文件；
   若第 3 步的決定與現在的說明不同，同步更新 [`architecture/backend/01-architecture.md`](../architecture/backend/01-architecture.md) 的 logger 說明。

## 4. 驗證方式

- `pnpm dev` 下觸發一個會寫應用程式日誌的流程（例如登入失敗），確認輸出是 Pino 格式，並帶有 `requestId`。
- 背景工作（pg-boss worker）裡的日誌沒有 HTTP 請求，確認 `requestId` 為空時不會出錯。
- `pnpm --filter @b2b-system/api test` 全過，測試輸出沒有多出大量日誌。
