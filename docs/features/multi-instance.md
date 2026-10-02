# 多實例部署

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`../architecture/01-system.md`](../architecture/01-system.md) §4.2–§4.3（擴展前提）、[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §10.3、
  [`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §9（背景工作）、[`observability.md`](./observability.md)、[`hardening-followups.md`](./hardening-followups.md)、
  [`overview/03-roadmap.md`](../overview/03-roadmap.md)「Phase 1 之後」第 6、7 項、[`permission-graph.md`](./permission-graph.md) G3a（已做出 `core/broadcast`，權限快取第一個用）、
  [`architecture/06-external-api.md`](../architecture/06-external-api.md) §9 T0（對外 API 是第二個程序，D16、D18 會先把其餘快取的失效廣播與事件轉送做掉）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

api 目前假設只有一個程序服務所有租戶。[`01-system.md`](../architecture/01-system.md) §4.3 已經列出擴展的前提、並決定 **先不引入 Redis**
（背景工作選了 pg-boss，[`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §9）；[`08-realtime.md`](../architecture/backend/08-realtime.md) §10.3 已選定
`@socket.io/postgres-adapter`。這份提案是把那些前提做出來。

### 單一執行個體在 1000 人在線時的代價

- **部署即全員斷線**：每次部署或重啟，約 1000 條 WebSocket 同時重連，每條在冷快取下做使用者與權限查詢，接著每個分頁重抓畫面上的
  query；沒有滾動部署的可能。已先做的緩解：前端重連退避 2–30 秒加隨機（`REALTIME_RECONNECTION`）、每 IP 的 handshake 上限可調
  （`REALTIME_HANDSHAKES_PER_IP`，預設 1200/分）。
- **背景工作與 API 同一個 event loop**：pg-boss worker、排程、稽核封存、檔案維護、寄信都在 api 程序；影像變體更是在請求裡以程序內的
  limiter（`IMAGE_VARIANT_CONCURRENCY`）處理，不是背景工作。`JOBS_WORKER_ENABLED=false` 已經可以讓程序只入列不執行，**但現在不能拆**：
  工作裡發佈的領域事件（佈建完成的 `TENANT_ACTIVATED`、停用的 `SESSIONS_REVOKED`）只會送到 worker 自己的 Socket.io，api 上的使用者收不到。

### 程序內的狀態

| 項目 | 現在 | 要改成 |
| --- | --- | --- |
| 領域事件 → 推播 | **已完成**（[`architecture/06-external-api.md`](../architecture/06-external-api.md) §9 T0）：推播類事件經平台 DB 轉送，每個程序推給自己的連線（[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §7.6）；worker 發佈的事件也送得到 | — |
| 跨裝置中繼（`channel.relay`） | gateway 只轉給本節點的連線 | 跨節點：adapter 或另一條轉送（只限這個功能；伺服器端推播已經轉送，裝 adapter 的跨節點 emit 會重複） |
| 權限、使用者、租戶登記、資料夾樹、系統設定的快取 | **已完成**：失效經 `core/broadcast` 跨程序（權限快取隨權限圖 G3a，其餘隨 [`architecture/06-external-api.md`](../architecture/06-external-api.md) §9 T0；頻道見 [`01-system.md`](../architecture/01-system.md) §4.4） | — |
| feature flag 的全平台快取 | `FeatureFlagService` 本程序失效，其他程序最多晚 `TENANT_CACHE_TTL` 秒 | 接上同一個 `BroadcastService` |
| HTTP 速率限制 | `RateLimitGuard` 用 `@nestjs/throttler` 的記憶體 storage | 共享 storage（Postgres 實作 `ThrottlerStorage`）；否則上限變成 N 倍 |
| WebSocket 的 handshake、每人連線數、訊息限流 | gateway 記憶體（`realtime.rate-limit.ts`） | 共享，或接受「每實例」的語意並把上限除以實例數 |
| 連線預算 | 每個程序：平台池 ＋ pg-boss 4 條 ＋ 每個活躍租戶 `TENANT_POOL_MAX` | 預算乘上程序數；程序多時在前面加 PgBouncer（[`backend/02-database.md`](../architecture/backend/02-database.md) §6.2） |
| 影像處理 | 請求內、程序內 limiter | 改成背景工作，隨 worker 拆出 |
| nginx upstream | `api_backend` 固定一台 | 列出每個實例，或 `resolver` ＋ 變數化的 `proxy_pass`；WebSocket 不需要黏著（只用 websocket transport） |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| ~~失效廣播與事件轉送~~（已隨 [`architecture/06-external-api.md`](../architecture/06-external-api.md) §9 T0 完成；剩 feature flag 的全平台快取） | 跨區域部署 |
| 跨裝置中繼（`channel.relay`）跨實例 | Redis |
| 速率限制共享計數（Postgres） | |
| 影像變體改成背景工作 | |
| 拆出獨立的 worker 服務（`docker-compose.prod.yml`） | |
| 稽核日誌改成按月分區（roadmap 第 6 項；目前是熱表／冷表兩張） | |

## 初步構想

- 失效廣播 **已實作** 在 `core/broadcast`（`BroadcastService`）：`subscribe(channel, { onMessage, onReconnect })`、`publish(channel, payload)` 送 `NOTIFY`
  （best-effort，失敗只記錄），每個程序一條平台 DB 的 `LISTEN` 連線（postgres.js `listen`），重連時呼叫訂閱者的 `onReconnect` 讓它丟棄整個快取。
  自己送出的訊息也會收到，要能忽略或冪等（`AuthzRevision` 以單調遞增的 revision 判斷；其他快取用 `channel()`，信封帶送出的程序，自己送的直接略過）。
- `NOTIFY` 的 payload 上限 8000 位元組：只送 key，不送資料（`BroadcastService.publish` 超過會拋錯）。
- 共享速率限制：以 `unlogged table` ＋ `INSERT ... ON CONFLICT DO UPDATE` 計數，視窗到期由排程清理；登入端點的每一次請求多一次寫入，要壓測。
- 驗收：兩個 api 實例 ＋ 一個 worker，E2E 在實例 A 改權限、連在實例 B 的使用者即時收到並失效。
  （快取與推播的部分已由整合測試 `apps/api/test/cross-process.spec.ts` 以同一個測試程序內的兩個 Nest app 驗證。）

## 開放問題

1. 共享速率限制用 Postgres 撐得住嗎？登入端點在尖峰時的寫入量要先估；撐不住才考慮 Redis。
2. 稽核日誌分區要現在做，還是等熱表真的撐不住？分區會取代現在的熱表／冷表與 `archive_audit_logs()`，也牽涉冷表的保留期限（[`hardening-followups.md`](./hardening-followups.md)）。
3. 部署時要滾動更新，前提是 migration 一律對上一版相容（已是規則，[`backend/02-database.md`](../architecture/backend/02-database.md) §5.2）。要不要在 CI 加檢查？

## 歸檔去向

- `docs/architecture/01-system.md` §4（含設計決策）
- `docs/architecture/backend/08-realtime.md` §10.3、`backend/05-rbac.md` §5（快取失效）
