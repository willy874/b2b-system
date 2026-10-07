# 可觀測性

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`multi-instance.md`](./multi-instance.md)、
  [`../architecture/01-system.md`](../architecture/01-system.md) §5、[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §12

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

上線後要能回答「哪支 API 變慢」「哪個租戶的 DB 有問題」「佇列有沒有積壓」「權限快取命中率多少」。現在有的：

| 項目 | 現況 |
| --- | --- |
| 日誌 | `core/logger`（nestjs-pino）：結構化、帶 requestId；遮掉 authorization、cookie、`query.token`、`set-cookie`；`/health` 不記 |
| 存活 | `GET /health`：`{ status, uptime, timestamp }`；Dockerfile 的 HEALTHCHECK 每 30 秒打一次、逾時 3 秒 |
| 就緒 | `GET /health/ready`：平台 DB（`select 1`）與物件儲存（`ping`），回 `ok` 或 `degraded` |
| 即時推播 | 連線、斷線、拒絕的日誌欄位已定（`08-realtime.md` §12） |
| 背景工作 | 管理頁看得到每個佇列的計數與失敗的工作（backstage 看租戶的、apps/platform 看平台的） |

沒有的：任何指標（沒有 prom-client、OpenTelemetry、event loop 監測）、租戶 DB 與 pg-boss 的健康檢查、前端錯誤回報、bundle 大小預算。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| `/metrics`（Prometheus 格式）：請求量、延遲、錯誤率（依路由，不依租戶，避免基數爆炸） | 自建監控平台（只輸出標準格式） |
| 容量指標：event loop lag、平台池與租戶池的使用數與等待數、開著的租戶池數、pg-boss 佇列深度、WebSocket 連線數 | 依租戶的指標標籤（見開放問題 3） |
| 快取指標：權限快取、使用者快取、租戶目錄快取的命中率與大小 | |
| 就緒檢查補上 pg-boss；存活檢查加 event loop lag 門檻 | |
| OpenTelemetry tracing：HTTP → service → DB（span 帶租戶代碼） | |
| 前端錯誤回報（未捕捉例外、API 5xx），backstage 與 apps/platform 都要 | |
| CI 的 bundle 大小預算 | |

## 初步構想

- 指標收集放 `core/metrics`，其他 `core/` 元件（`core/cache`、`core/tenant`、`core/jobs`）提供計數，不反向依賴。
- `/metrics` 不經過 `TenantMiddleware` 的租戶解析、不經過速率限制；用 `@Public()` 並以網路層限制（見開放問題 1）。
- 租戶 DB 不放進就緒檢查：單一租戶 DB 掛掉不應該讓整個程序被 LB 摘掉（`Tenancy.enter` 已經會對那個租戶回 503）。改成指標
  「每個租戶最近一次連線失敗的時間」。

## 開放問題

1. `/metrics` 的存取控制：只開在內網（nginx 不轉發），還是要 token？
2. 前端錯誤回報要自建端點（寫進日誌），還是接 Sentry 之類的服務？接外部服務要處理個資與租戶網域的 CSP。
3. 要不要有依租戶的指標（例如每個租戶的請求量）？租戶多時標籤基數會很大，可以只在 tracing 與日誌帶租戶。

## 歸檔去向

- `docs/architecture/01-system.md` §5、`docs/architecture/backend/01-architecture.md`
