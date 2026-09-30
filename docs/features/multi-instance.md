# 多實例部署

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`overview/03-roadmap.md`](../overview/03-roadmap.md)「Phase 1 之後」第 6、7 項、[ADR-0016](../adr/0016-background-jobs.md)（背景工作）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

api 目前假設只有一個程序：

- 權限快取、使用者快取在程序記憶體，失效只作用在本程序
- Socket.io 的 room 只在本程序，推播到不了連在其他實例的使用者
- 速率限制的計數在程序記憶體

水平擴展之前，這三件事都要改成共享的。

### 2026-09-30 檢查報告補充（docs/issues/01-performance.md PERF-10、PERF-11）

單一執行個體在 1000 人在線時的具體代價：

- **部署即全員斷線**：每次部署或重啟，約 1000 條 WebSocket 同時重連，每條在冷快取下做使用者與權限查詢，接著每個分頁重抓畫面上的
  query；沒有滾動部署的可能。已先做的緩解：前端重連退避改成 2–30 秒加隨機（`REALTIME_RECONNECTION`）、每 IP 的 handshake 上限可調
  （`REALTIME_HANDSHAKES_PER_IP`，預設 1200/分）。
- **背景工作與 API 同一個 event loop**：pg-boss worker、排程、稽核封存、檔案維護、影像處理、寄信都在 api 程序。compose 可以用同一個映像
  另起 `JOBS_WORKER_ENABLED=true` 的 worker、api 設 `false`，**但目前不能拆**：工作裡發佈的領域事件（佈建完成、影像變體產生、權限變更後的推播）
  只會送到 worker 自己的 Socket.io，api 上的使用者收不到——這與「Socket.io 跨實例」是同一個前提。已先做的緩解：SMTP 連線池、寄信工作並行 5
  （`MAIL_SMTP_POOL_SIZE`、`defineJob` 的 `concurrency`）、`UV_THREADPOOL_SIZE=16`。

拆 worker 與 `replicas > 1` 前要一起具備的（除了下表）：

| 項目 | 現在 | 要改成 |
| --- | --- | --- |
| 領域事件 → 推播 | 程序內的 `DomainEventBus` | 跨程序（`LISTEN/NOTIFY` 或 `@socket.io/postgres-adapter` 的 `serverSideEmit`），worker 發佈的事件也送得到 |
| 速率限制計數 | `RateLimitGuard` 用 `@nestjs/throttler` 的記憶體 storage | 共享 storage（Postgres／Redis 的 `ThrottlerStorage` 實作）；否則每個實例各算一份，上限變成 N 倍 |
| WebSocket 每 IP handshake、每人連線數 | gateway 記憶體裡的計數 | 同上，或接受「每實例」的語意並把上限除以實例數 |
| 租戶登記快取 | `TenantDirectory` 本程序失效，其他實例晚 `TENANT_CACHE_TTL` 秒 | 失效廣播（同一條 `LISTEN/NOTIFY`） |
| 連線預算 | 每個 api 程序各有平台池＋每租戶的池 | `max_connections` 的估算乘上程序數；程序多時在前面加 PgBouncer（backend/02-database.md §6.2） |
| nginx upstream | `api_backend` 固定一台 | 列出每個實例或 `resolver` ＋ 變數化的 `proxy_pass`；keepalive 照舊 |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 快取失效跨實例廣播 | 跨區域部署 |
| Socket.io adapter 跨實例 | |
| 速率限制共享計數 | |
| 稽核日誌分區表（roadmap 第 6 項；目前是熱表／冷表兩張） | |

## 初步構想

- 方案 A：引入 Redis（快取、Socket.io adapter、throttler storage 都有現成套件）
- 方案 B：先用 Postgres `LISTEN/NOTIFY` 廣播失效與推播，不增加元件

## 開放問題

1. Redis 或 Postgres？背景工作已選 pg-boss（[ADR-0016](../adr/0016-background-jobs.md)），不需要 Redis；
   pg-boss 的排程與取工作本來就支援多實例
2. 稽核日誌分區要現在做，還是等熱表真的撐不住？

## 歸檔去向

- `docs/adr/NNNN-multi-instance.md`、`docs/architecture/01-system.md` 部署拓撲
