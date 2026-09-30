# 可觀測性

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`multi-instance.md`](./multi-instance.md)、[`hardening-followups.md`](./hardening-followups.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

目前有結構化日誌（`core/logger`）與 RequestId，`/health` 只回應程序存活。
上線後需要回答「哪支 API 變慢」「物件儲存是否可用」「權限快取命中率多少」。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| readiness 檢查：資料庫、物件儲存 | 自建監控平台（只輸出標準格式） |
| `/metrics`（Prometheus 格式）：請求量、延遲、錯誤率、快取命中率 | |
| OpenTelemetry tracing：HTTP → service → DB | |
| 前端錯誤回報（未捕捉例外、API 失敗） | |
| 容量指標：event loop lag、連線池使用率與等待、背景工作佇列深度 | |
| 健康檢查加上 event loop lag 門檻（目前只看程序存活，完全卡住時靠 HEALTHCHECK 逾時） | |
| CI 的 bundle 大小預算 | |

## 開放問題

1. `/metrics` 的存取控制：只開在內網，還是要權限？
2. 前端錯誤回報要自建端點，還是接 Sentry 之類的服務？

## 歸檔去向

- `docs/architecture/01-system.md` 部署章節、`backend/01-architecture.md`
