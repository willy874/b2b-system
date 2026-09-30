# 效能與容量檢查

> 掃描日期：2026-09-30 ・ 前提：1000 人同時在線 ・ 範圍：`apps/api`（core/database、core/tenant、core/cache、core/jobs、core/events、core/image、core/storage、core/mail、common/guards、common/auth、modules/auth、realtime、file、audit-log、user、role、permission、approval、health）、`apps/api/src/db`（schema、0000/0001 migration）、`apps/file-storage`（disk-store、list、object handler）、`apps/backstage`（queryClient、resources 依賴圖、RealtimeCoordinator、socketIoTransport、SessionStore、檔案列表 query、vite.config、9/29 的 `dist/` 產物）、`deploy/nginx.conf`、`deploy/nginx.auth.conf`、`docker-compose.prod.yml`、`apps/api/Dockerfile`、`apps/backstage/Dockerfile`。沒有實際壓測，數字都是依程式碼推估。

## 摘要

| ID | 嚴重度 | 標題 | 位置 |
| --- | --- | --- | --- |
| PERF-01 | P0 | 所有速率限制都以「每個 IP」計算，企業 NAT 後的 1000 人共用一份額度 | `apps/api/src/app.module.ts:57`、`common/rate-limit.ts:18`、`modules/realtime/realtime.constants.ts:18` |
| PERF-02 | P0 | nginx 沿用預設 `worker_connections 1024`，1000 條 WebSocket 經代理要 2000 個連線 | `deploy/nginx.conf`、`apps/backstage/Dockerfile:30` |
| PERF-03 | P1 | 連線預算：一個租戶只有 5 條連線、postgres 沒有調校 `max_connections`、沒有排隊逾時 | `core/tenant/tenancy.service.ts:196`、`core/config/env.schema.ts:27`、`docker-compose.prod.yml:7` |
| PERF-04 | P1 | `refresh_tokens` 沒有清理、家族無限成長，續期與登出的成本隨使用天數線性增加 | `modules/auth/refresh-token.repository.ts:111`、`db/schema/refresh-tokens.ts:38` |
| PERF-05 | P1 | 每個檔案請求都載入整棵資料夾樹（每位使用者一個個人資料夾） | `modules/file/file-access.service.ts:38`、`file-folder.repository.ts:40` |
| PERF-06 | P1 | 檔案變更的推播放大：所有檔案讀者重抓、無限捲動重抓全部頁、一次上傳推兩次 | `modules/realtime/realtime.audience.ts:45`、`apps/backstage/src/apis/resources.ts:140` |
| PERF-07 | P1 | 影像變體在 API 程序內整檔讀進記憶體處理，單次可達數百 MB | `modules/file/file-image.service.ts:167`、`core/image/sharp-image-processor.ts:16` |
| PERF-08 | P1 | 權限大量變更時，全域序列化的事件匯流排被逐人查詢卡住，所有租戶的推播一起延遲 | `core/events/event-bus.ts:35`、`realtime.audience.ts:89`、`file-system-folder.service.ts:155` |
| PERF-09 | P2 | 列表每一頁都 `count(*)`（稽核最長 90 天範圍、檔案游標分頁也算），offset 沒有上限 | `modules/audit-log/audit-log.repository.ts:67`、`file.repository.ts:120` |
| PERF-10 | P2 | 背景工作、排程、影像處理都在同一個 API 程序；寄信無 SMTP 連線池、並行 1 | `core/jobs/job-queue.ts:103`、`core/mail/smtp-mail-transport.ts:20` |
| PERF-11 | P2 | 單一執行個體：每次部署／重啟 1000 條連線同時重連，快取全冷 | `docker-compose.prod.yml:86`、`realtime.gateway.ts:120` |
| PERF-12 | P2 | 租戶網域快取沒有上限，未命中也在 throttler 之前查平台 DB | `core/tenant/tenant-directory.service.ts:38`、`tenant.middleware.ts:38` |
| PERF-13 | P2 | outbox 清掃每分鐘進入每一個租戶，所有租戶的連線池永遠不會閒置關閉 | `core/jobs/job-queue.ts:296`、`core/tenant/tenancy.service.ts:114` |
| PERF-14 | P2 | libuv threadpool 維持預設 4：argon2、sharp、DNS 查詢互相排隊 | `modules/auth/password.ts:12`、`core/image/sharp-image-processor.ts:43` |
| PERF-15 | P2 | nginx 對 api 沒有 upstream keepalive，每個 API 請求都開新的 TCP | `deploy/nginx.conf:58`、`deploy/nginx.auth.conf:34` |
| PERF-16 | P2 | 缺少容量相關的防護與指標：沒有 `statement_timeout`、pool 等待、event loop lag | `core/database/database.provider.ts:24`、`modules/health/health.service.ts:30` |
| PERF-17 | P3 | 稽核冷表沒有保留期限，且缺 `action` 索引 | `db/migrations/0000_baseline.sql:278` |
| PERF-18 | P3 | file-storage 的中繼資料全在記憶體，寫入後 List 要整桶重新排序、線性掃描 | `apps/file-storage/src/storage/disk-store.ts:197` |
| PERF-19 | P3 | 部分篩選欄位沒有索引（`files.created_by`、使用者關鍵字 `%kw%`） | `modules/file/file.repository.ts:110`、`modules/user/user.repository.ts:73` |
| PERF-20 | P3 | 容器沒有記憶體上限與 Node heap 設定；健康檢查只看 liveness | `docker-compose.prod.yml:47`、`apps/api/Dockerfile:39` |
| PERF-21 | P3 | 前端正式產物帶 sourcemap 與 MSW chunk | `apps/backstage/vite.config.ts:46` |

數量：P0 × 2、P1 × 6、P2 × 8、P3 × 5，共 21 項。

## 容量估算

**假設**（沒有實測，全部是推估；上線前應以壓測校正）：

- 1000 人同時在線，最壞情況是 **全部在同一個租戶**；租戶數另計。
- 每人一個瀏覽器、數個分頁；前端以 leader election 讓 **每個瀏覽器只開一條 WebSocket**（`RealtimeCoordinator`），續期以 Web Locks 跨分頁單飛（`SessionStore.ts:166`）。
- 活躍使用者平均每 10 秒一個 API 請求 → 穩態約 **100 rps**，尖峰（上班、整點、推播後的集體重抓）抓 **300–500 rps**。
- access token 5 分鐘 → 續期 1000 / 300 s ≈ **3.3 rps**，每次約 6 次 DB 往返（`findByHash`、`isFamilyRevoked`、`findAccountById`、交易內 `markUsed` ＋ `insert`）。

| 項目 | 估算 | 依據與結論 |
| --- | --- | --- |
| Socket.io 心跳 | 1000 / 25 s ≈ 40 ping/s | Socket.io 預設 `pingInterval 25s`；成本很低 |
| WebSocket 記憶體 | 約 30–60 MB | 每條連線含 engine.io 緩衝約 30–60 KB；每條連線加入 user / tenant / sid / perm room（super-admin 加入全部權限鍵），Set 項目數萬筆，可忽略 |
| 快取記憶體 | < 10 MB | `PermissionCacheService`、`UserCacheService` 各上限 10,000 筆（有上限，見「做得好的地方」） |
| 驗證熱路徑的 DB 查詢 | 約 33 + 33 qps | 使用者快取 TTL 30 s（1000/30），權限快取 TTL 60 s 每次 miss 2 條查詢（2×1000/60）；其餘是業務查詢 |
| 業務查詢 | 100 rps × 3–6 條 ≈ 300–600 qps | 檔案列表一次約 5 條（權限、資料夾樹、授權、列表、count），稽核列表 2 條含 90 天 `count(*)` |
| 單一租戶的連線需求 | 穩態 1–2 條，尖峰 10–20 條 | 以 Little's law：600 qps × 平均 2–5 ms ≈ 1.2–3 條；慢查詢（`count(*)` 100 ms 級、交易）與重連風暴時遠超過 `TENANT_POOL_MAX=5`（PERF-03） |
| Postgres 連線總數 | 10（平台）＋ 4（pg-boss）＋ 5 × 租戶數 | postgres 預設 `max_connections=100`、保留 3 → **約 17 個租戶** 就會打滿（PERF-03、PERF-13） |
| nginx 連線 | 1000 WS × 2 ＋ HTTP ≈ 2100+ | 預設每 worker 1024，`worker_processes auto`：2 核以下機器不夠（PERF-02） |
| 速率限制 | 1000 人 / 單一出口 IP | 全域 120 次/分、登入 10 次/分、續期 30 次/分、WS handshake 30 次/分 **每 IP**（PERF-01） |
| 登入尖峰（Argon2id 19 MiB、t=2） | 單次約 30–60 ms（待驗證），4 條 threadpool → 約 60–120 次/s | CPU 足夠；記憶體 4 × 19 MiB；真正的瓶頸是 PERF-01 的 10 次/分/IP |
| 影像處理尖峰記憶體 | 最壞約 1–2 GB（待驗證） | 原圖上限 128 MiB 整檔入記憶體、解碼上限 1 億像素，並行 2 且每張同時 render 兩個版本（PERF-07） |

## 詳細

### PERF-01 所有速率限制都以「每個 IP」計算，企業 NAT 後的 1000 人共用一份額度

- **嚴重度**：P0
- **狀態**：已修（fix/infra-tenancy）：已登入以「租戶＋使用者」計、未登入以 IP；登入類另以「帳號＋IP」、續期以 refresh session；各上限（含 WebSocket handshake）可由環境變數調整，預設值與估算在 backend/03-api-conventions.md §8。限流計數仍在記憶體（多實例見 docs/features/multi-instance.md）
- **位置**：
  [apps/api/src/app.module.ts:57-61](../../apps/api/src/app.module.ts#L57-L61)、
  [apps/api/src/common/rate-limit.ts:18-27](../../apps/api/src/common/rate-limit.ts#L18-L27)、
  [apps/api/src/core/config/env.schema.ts:75-76](../../apps/api/src/core/config/env.schema.ts#L75-L76)、
  [apps/api/src/modules/realtime/realtime.constants.ts:18-24](../../apps/api/src/modules/realtime/realtime.constants.ts#L18-L24)、
  [apps/api/src/modules/realtime/realtime.gateway.ts:230-233](../../apps/api/src/modules/realtime/realtime.gateway.ts#L230-L233)、
  [apps/api/src/modules/realtime/realtime.module.ts:26](../../apps/api/src/modules/realtime/realtime.module.ts#L26)
- **現況**：
  ```ts
  // app.module.ts：唯一的全域桶，ThrottlerGuard 預設以 req.ip 為 key
  { name: 'default', ttl: 60_000, limit: config.get('DEFAULT_RATE_LIMIT') }   // 預設 120
  // rate-limit.ts
  AUTH_THROTTLE = { limit: 10, ttl: 60_000 }         // 登入、SSO 互動
  REFRESH_THROTTLE = { limit: AUTH_THROTTLE.limit * 3 } // 30 次/分
  // realtime.constants.ts（寫死、不能用環境變數調）
  handshakesPerIp: 30, handshakeWindowMs: 60_000
  ```
  `TRUST_PROXY=uniquelocal` 會取到真實的客戶端 IP——對企業客戶來說就是公司的出口 NAT IP。
- **影響**：B2B 客戶的員工通常經由同一個（或少數幾個）出口 IP 連線。1000 人在同一個 IP 時：
  全站只剩 120 次/分（平均每人每 8 分鐘一次請求）；早上登入尖峰每分鐘只能登入 10 人；
  續期需要 1000/5 = 200 次/分，超過 30 次/分，85% 的續期拿到 429，接著 API 全部 401；
  服務重啟後的重連每分鐘只放行 30 條 WebSocket。這是在 1000 人時「一定會出事」的設定。
- **建議**：
  1. 全域桶改以「已驗證的使用者」為 key（自訂 `ThrottlerGuard.getTracker()`：有 `req.user` 用 `tenantId:userId`，沒有才用 IP），並把數值改成「每人」語意。
  2. 登入類端點改成「每帳號（email）＋ 每 IP」雙鍵：每帳號維持嚴格（暴力破解防護本來就有帳號鎖定），每 IP 放寬到數百次/分或可依租戶設定。
  3. `/auth/refresh` 以 refresh token 家族或使用者為 key（它本來就是一次性輪替，重放會被偵測），不以 IP。
  4. `REALTIME_LIMITS` 改由環境變數注入；handshake 以 IP 計的上限放寬到數千，或改以使用者計（`connectionsPerUser` 已存在）。
  5. 文件（`docs/architecture/01-system.md` §6）補上「NAT 情境」的設計假設。
- **驗收**：壓測腳本以同一個來源 IP 模擬 1000 個使用者（各自登入、每 5 分鐘續期、每 10 秒一個 API、各一條 WebSocket），30 分鐘內 429 比例 < 0.1%；同時以單一帳號暴力登入仍在第 5 次後鎖定。

### PERF-02 nginx 沿用預設 `worker_connections 1024`，1000 條 WebSocket 經代理要 2000 個連線

- **嚴重度**：P0
- **狀態**：已修（fix/infra-tenancy）：deploy/nginx.main.conf（worker_connections 8192、worker_rlimit_nofile 65535、multi_accept）、compose 的 ulimits
- **位置**：[apps/backstage/Dockerfile:29-30](../../apps/backstage/Dockerfile#L29-L30)、[deploy/nginx.conf:27-38](../../deploy/nginx.conf#L27-L38)
- **現況**：映像只覆蓋 `conf.d/default.conf`，主設定沿用 `nginx:1.27-alpine` 的預設（`worker_processes auto`、`events { worker_connections 1024; }`，待驗證映像內的實際值）。每條 WebSocket 在 nginx 佔兩個連線（client 端 ＋ upstream 端），`/storage/` 的大檔傳輸（`proxy_read_timeout 300s`）也長時間佔用。
- **影響**：1000 條 WebSocket ≈ 2000 個連線，再加上同時的 HTTP 請求。1 核的主機只有 1024，約 500 人就會出現 `worker_connections are not enough`、新連線被拒；2 核也只有約 2048，而且預設 `accept_mutex off` 讓連線在 worker 之間分布不均，單一 worker 先爆的機率很高。
- **建議**：提供自己的 `nginx.conf`（或 `conf.d` 之外的 `/etc/nginx/nginx.conf`）：`worker_rlimit_nofile 65535;`、`events { worker_connections 8192; multi_accept on; }`；compose 對 `backstage`、`auth` 設 `ulimits.nofile`。
- **驗收**：以 k6 / artillery 對 `/api/socket.io/` 建立 3000 條閒置 WebSocket 並維持 10 分鐘，nginx error log 沒有 `worker_connections are not enough`，`ss -s` 顯示連線數符合預期。

### PERF-03 連線預算：一個租戶只有 5 條連線、postgres 沒有調校 `max_connections`、沒有排隊逾時

- **嚴重度**：P1
- **狀態**：已修（fix/infra-tenancy）：TENANT_POOL_MAX 預設 10、平台池可設定、連線預算公式寫進 backend/02-database.md §6.2；compose 調校 postgres（max_connections、shared_buffers…、pg_stat_statements）。每個租戶各自覆寫池大小、PgBouncer 延後——預算公式寫明何時需要
- **位置**：
  [apps/api/src/core/config/env.schema.ts:27](../../apps/api/src/core/config/env.schema.ts#L27)、
  [apps/api/src/core/tenant/tenancy.service.ts:191-205](../../apps/api/src/core/tenant/tenancy.service.ts#L191-L205)、
  [apps/api/src/core/database/database.module.ts:25](../../apps/api/src/core/database/database.module.ts#L25)、
  [apps/api/src/core/jobs/job-queue.ts:103-112](../../apps/api/src/core/jobs/job-queue.ts#L103-L112)、
  [docker-compose.prod.yml:7-21](../../docker-compose.prod.yml#L7-L21)
- **現況**：`TENANT_POOL_MAX` 預設 5（每租戶），平台池 production 10，pg-boss 另開 4。`postgres` 服務沒有任何 `command: -c ...`，沿用 `max_connections=100`、`shared_buffers=128MB`。postgres.js 在池滿時無限期排隊（沒有 `connect_timeout` 以外的等待上限），也沒有 `statement_timeout`。
- **影響**：
  - 1000 人集中在一個租戶時，所有請求共用 5 條連線。穩態夠用，但一條 90 天範圍的 `count(*)`（PERF-09）、一個持有樹鎖的長交易（PERF-08）或重連風暴（PERF-11）就會讓其他請求在池裡排隊，延遲直接轉嫁到每一個 API（含驗證熱路徑的使用者查詢）。
  - 多租戶時：14 + 5 × 租戶數 ≤ 97 → 約 17 個活躍租戶就會打滿 `max_connections`，之後新租戶的第一條連線直接失敗（`too many clients`）。PERF-13 讓「活躍」等於「所有 active 租戶」。
  - 預設 `shared_buffers` 128 MB 對數個租戶 DB 的熱資料（users、roles、audit_logs 索引）偏小。
- **建議**：
  1. `TENANT_POOL_MAX` 預設提高到 10–20，並讓平台管理者能依租戶覆寫（大租戶給大池）。
  2. 在 postgres 前加 PgBouncer（transaction mode，ADR-0020 已預留），或至少把 `max_connections` 設到 `平台 + pg-boss + Σ租戶池 + 餘裕`。注意 transaction mode 不支援 session 級的 advisory lock；`pg_advisory_xact_lock`（交易級）可以用。
  3. postgres 以 `command` 設定 `shared_buffers`（記憶體 25%）、`effective_cache_size`、`work_mem`、`max_connections`；開 `pg_stat_statements`。
  4. 所有連線設 `statement_timeout`（例如 15 s；稽核匯出等例外另開）與 `idle_in_transaction_session_timeout`。
- **驗收**：壓測 500 rps（單一租戶）時，應用層的 pool 等待 p99 < 10 ms；`SELECT count(*) FROM pg_stat_activity` 在 30 個租戶時仍低於 `max_connections` 的 70%。

### PERF-04 `refresh_tokens` 沒有清理、家族無限成長，續期與登出的成本隨使用天數線性增加

- **嚴重度**：P1
- **位置**：
  [apps/api/src/modules/auth/refresh-token.repository.ts:94-142](../../apps/api/src/modules/auth/refresh-token.repository.ts#L94-L142)、
  [apps/api/src/modules/auth/refresh-rotation.ts:71](../../apps/api/src/modules/auth/refresh-rotation.ts#L71)、
  [apps/api/src/db/schema/refresh-tokens.ts:33-39](../../apps/api/src/db/schema/refresh-tokens.ts#L33-L39)
- **現況**：每次續期 `markUsed`（UPDATE）＋ 同家族 `insert` 一列；家族沒有絕對壽命（新 token 的 `expiresAt` 從現在起算 7 天，天天使用就永遠續下去）。schema 註解說 `refresh_tokens_expires_idx` 是「清理排程用」，但全 repo 沒有任何刪除 `refresh_tokens` 的程式（`grep '.delete('` 只有 outbox、role、grant 等）。`auth_tokens` 同樣沒有清理。
  ```ts
  // 每次續期都跑：family_id 索引找到整個家族，再逐列過濾 revoked_at
  .where(and(eq(refreshTokens.familyId, familyId), isNotNull(refreshTokens.revokedAt))).limit(1)
  // 登出／重用偵測：更新整個家族所有「尚未撤銷」的列（已使用但未撤銷的舊列也在內）
  .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
  ```
  `refresh_tokens_user_active_idx` 的條件是 `revoked_at IS NULL`，已使用（`used_at` 有值）的舊列也一直留在這個部分索引裡。
- **影響**：1000 人 × 每小時 12 次 × 每天 8 小時 ≈ 每天 10 萬列，一年約 2500 萬列（每個租戶）。單一家族每工作日多 ~100 列，一年 2 萬多列：`isFamilyRevoked` 每次續期都要掃整個家族；登出與 `revokeAllForUser`（停用使用者）一次更新上萬列並產生大量 dead tuple；表與索引膨脹拖慢 `findByHash`。
- **建議**：
  1. 新增每日清理工作（租戶範圍的 `defineJob`）：刪除 `expires_at < now() - 寬限` 或 `used_at < now() - 寬限` 且非家族最新一張的列；分批刪除（同 `archive_audit_logs` 的作法）。`auth_tokens` 一起清。
  2. 家族加上絕對壽命（例如 30 天，存 `family_created_at`），到期要求重新登入。
  3. 重用偵測只需要「上一張」：可改成續期時刪除（或只保留最近 N 張）已使用的舊列，`isFamilyRevoked` 改查「家族最新一列」。
  4. `refresh_tokens_user_active_idx` 條件改為 `revoked_at IS NULL AND used_at IS NULL`。
- **驗收**：在 100 萬列、單一家族 2 萬列的資料量下，`/auth/refresh` p99 < 20 ms；清理工作跑完後表的列數與 `pg_stat_user_tables.n_dead_tup` 穩定不成長。

### PERF-05 每個檔案請求都載入整棵資料夾樹（每位使用者一個個人資料夾）

- **嚴重度**：P1
- **位置**：
  [apps/api/src/modules/file/file-access.service.ts:38-55](../../apps/api/src/modules/file/file-access.service.ts#L38-L55)、
  [apps/api/src/modules/file/file-folder.repository.ts:40-51](../../apps/api/src/modules/file/file-folder.repository.ts#L40-L51)、
  [apps/api/src/modules/file/file-access.context.ts:137-141](../../apps/api/src/modules/file/file-access.context.ts#L137-L141)、
  [apps/api/src/modules/file/file.service.ts:104-118](../../apps/api/src/modules/file/file.service.ts#L104-L118)、
  [apps/api/src/modules/file/file.service.ts:442-452](../../apps/api/src/modules/file/file.service.ts#L442-L452)
- **現況**：`contextFor()`（檔案列表、詳情、上傳、移動…每個請求都呼叫）先 `listTreeNodes()`——`SELECT … FROM file_folders WHERE deleted_at IS NULL` 不帶任何條件——再查操作者的授權，在記憶體解析。系統為每位有檔案權限的使用者建立一個個人資料夾（`ensurePersonalFolders`），所以 1000 人的租戶至少有 1000+ 個資料夾節點。沒有全域 `file:read` 的人，列表還會帶 `folder_id IN (<所有讀得到的資料夾>)`。
- **影響**：每個檔案請求固定讀數千列、建數個 Map；在 PERF-06 的推播放大下（數百人同時重抓）變成每秒數十萬列的讀取與 GC 壓力，並佔住 PERF-03 的小連線池。資料夾越多越慢，成本與使用者數成正比。
- **建議**：
  1. 以「租戶 × 樹版本」快取資料夾結構（行程內記憶體即可）：結構寫入本來就在 `lockTree()` 裡，提交後遞增版本或直接失效；授權另以「租戶 × 使用者」快取，授權變更時失效（同權限快取的模式）。
  2. 或改為只載入需要的部分：列表只需要 `readableFolderIds`，可以用遞迴 CTE 由授權往下展開；單一資源只需要它的祖先鏈（`findAncestorIds` 已存在）。
  3. 個人資料夾不必出現在每個人的樹裡：一般使用者只需要自己的個人資料夾與被授權的節點。
- **驗收**：5000 個資料夾的租戶中，`GET /files` 的 DB 讀取列數 < 200、p95 < 50 ms；以 `pg_stat_statements` 確認 `listTreeNodes` 的呼叫次數遠低於檔案 API 的請求數。
- **狀態**：已修（fix/file）：建議 1——資料夾結構以租戶為 key 快取在程序內（`FileFolderTree`），結構寫入統一經 `write()` 在提交後失效；授權仍每次查（只有操作者本人與角色的列）。建議 3（個人資料夾不出現在別人的樹）延後——rbac/07 §5.1 規定別人的個人資料夾要列出但鎖住，需產品決策。快取只在本程序失效，api 水平擴展時要改跨程序通知（已寫進 backend/09 §11.1）

### PERF-06 檔案變更的推播放大：所有檔案讀者重抓、無限捲動重抓全部頁、一次上傳推兩次

- **嚴重度**：P1
- **位置**：
  [apps/api/src/modules/realtime/realtime.audience.ts:43-51](../../apps/api/src/modules/realtime/realtime.audience.ts#L43-L51)、
  [apps/api/src/modules/file/file.service.ts:300-302](../../apps/api/src/modules/file/file.service.ts#L300-L302)、
  [apps/api/src/modules/file/file-image.service.ts:215-217](../../apps/api/src/modules/file/file-image.service.ts#L215-L217)、
  [apps/backstage/src/apis/resources.ts:125-146](../../apps/backstage/src/apis/resources.ts#L125-L146)、
  [apps/backstage/src/apis/file/get-file-list/query.ts:41-59](../../apps/backstage/src/apis/file/get-file-list/query.ts#L41-L59)
- **現況**：`FILE` / `FILE_FOLDER` 的變更推給 `file:read` 與 `file:access` 兩個 perm room——在檔案功能開給全員的租戶裡就是所有人；前端把 `FILE_LIST` 與 `FILE_INFINITE_LIST` 整個 collection 失效。無限捲動的 query 沒有 `maxPages`，TanStack 失效時會依序重抓 **所有已載入的頁**。上傳完成推一次 `CREATE`，影像變體產生完再推一次 `UPDATE`。每一次寫入也讓所有 `audit-log:read` 的人重抓稽核列表（`derivesFromAnyChange`）。
  前端已有 150–750 ms 的 jitter、背景分頁不重抓（見「做得好的地方」），但只是分散時間，總量不變。
- **影響**：假設 200 人開著檔案管理器、每人平均捲了 3 頁，有人每秒上傳一張圖 → 每秒 2 個事件 × 200 人 × 3 頁 = 1200 次 `GET /files`，每次含 PERF-05 的整棵樹、列表、`count(*)`、每筆 2–3 個 presign。單一上傳者就能把 API 與連線池推到飽和。
- **建議**：
  1. 推播帶上 `folderId`（payload 已有 `id`，補 `refs.folder`），前端只失效「目前檢視的資料夾」相符的列表；別的資料夾的變更只標 stale、不重抓。
  2. 無限列表加 `maxPages`（例如 3），或變更時只重抓第一頁並把其他頁移除（`queryClient.setQueryData` 截斷 pages）。
  3. 同一檔案在短時間內的 `CREATE` 與變體 `UPDATE` 由後端合併（debounce 500 ms），或變體 `UPDATE` 只推給上傳者與正在看該資料夾的人。
  4. 後端為推播觸發的列表請求提供便宜的路徑（例如以 `If-None-Match` / 版本號回 304）。
- **驗收**：壓測 200 個檔案管理器分頁 ＋ 每秒 1 次上傳，`GET /files` 的 rps 與上傳 rps 的比值 < 20（目前推估約 1200）。
- **狀態**：已修（fix/file）：建議 1——推播帶 `refs.fileFolder`，前端依賴圖新增 `scopedCollection`，只重抓那個資料夾與不分資料夾的列表；建議 3——圖片的 create 等變體最多 3 秒，合併成一次推播。建議 2（`maxPages`）延後——游標只能往後、列表是虛擬捲動，丟掉前面的頁要有反向游標與捲動錨定，否則往上捲的內容會消失；建議 4（304）延後。`derivesFromAnyChange` 的稽核重抓屬 PERF-09／稽核範圍

### PERF-07 影像變體在 API 程序內整檔讀進記憶體處理，單次可達數百 MB

- **嚴重度**：P1
- **位置**：
  [apps/api/src/modules/file/file-image.service.ts:167-189](../../apps/api/src/modules/file/file-image.service.ts#L167-L189)、
  [apps/api/src/modules/file/file-image.service.ts:221-245](../../apps/api/src/modules/file/file-image.service.ts#L221-L245)、
  [apps/api/src/core/image/sharp-image-processor.ts:10-48](../../apps/api/src/core/image/sharp-image-processor.ts#L10-L48)、
  [apps/api/src/modules/file/file.constants.ts:58-61](../../apps/api/src/modules/file/file.constants.ts#L58-L61)
- **現況**：`readAll()` 把原圖串流整個讀成 Buffer（上限 `IMAGE_VARIANT_MAX_INPUT_SIZE = 128 MiB`），sharp 解碼上限 1 億像素（RGBA 約 400 MB），並以 `image.clone()` **同時** render preview 與 thumbnail；`IMAGE_VARIANT_CONCURRENCY = 2`。影像 API 第一次要求 AVIF / WebP 時也在請求路徑上即時轉檔（同一個 limiter）。這些都跑在服務 1000 條 WebSocket 的同一個 Node 程序。
- **影響**：幾張大圖同時上傳時，常駐記憶體可能瞬間增加 1–2 GB（待以實測確認；libvips 對 JPEG 有 shrink-on-load，最壞情況是 PNG / TIFF）。容器沒有記憶體上限（PERF-20）時會擠壓主機，有上限時會 OOM 重啟——所有使用者同時斷線並觸發 PERF-11 的重連風暴。AVIF `effort: 4` 的即時轉檔也會讓第一個請求等上數秒。
- **建議**：
  1. 影像處理移到背景工作（`defineJob`），由獨立的 worker 容器（`JOBS_WORKER_ENABLED=false` 的 api ＋ 一個 worker 執行個體）執行，並為 worker 設記憶體上限。
  2. 直接把 S3 串流 pipe 進 `sharp()`（它接受 Readable），或下載到暫存檔再以檔案路徑解碼，不要整檔 Buffer；兩個版本依序 render。
  3. 設 `sharp.concurrency()` 與 `sharp.cache()` 上限；降低 `limitInputPixels`（例如 5000 萬）或對超過門檻的圖只產縮圖。
  4. 非主格式的轉檔改為背景產生，請求路徑先回主格式。
- **驗收**：同時上傳 10 張 8000×8000 PNG，API 程序 RSS 增量 < 300 MB、同時段 WebSocket 心跳沒有逾時、一般 API p99 不受影響。
- **狀態**：已修（fix/file，部分）：原圖串流先寫暫存檔、libvips 從檔案逐列解碼，兩個版本依序 render，libvips 執行緒 2、快取 16 MB，`format=auto` 的未轉出格式改背景轉出（先回主格式、快取 30 秒）。移到獨立 worker 容器（建議 1）延後——要等背景工作能分開部署（PERF-10，基礎設施組）；`limitInputPixels` 維持 1 億（改為逐列解碼後尖峰不再與像素數成正比）；RSS 實測未做

### PERF-08 權限大量變更時，全域序列化的事件匯流排被逐人查詢卡住，所有租戶的推播一起延遲

- **嚴重度**：P1
- **位置**：
  [apps/api/src/core/events/event-bus.ts:27-39](../../apps/api/src/core/events/event-bus.ts#L27-L39)、
  [apps/api/src/modules/realtime/realtime.audience.ts:89-96](../../apps/api/src/modules/realtime/realtime.audience.ts#L89-L96)、
  [apps/api/src/modules/file/file-system-folder.service.ts:50-51](../../apps/api/src/modules/file/file-system-folder.service.ts#L50-L51)、
  [apps/api/src/modules/file/file-system-folder.service.ts:155-221](../../apps/api/src/modules/file/file-system-folder.service.ts#L155-L221)、
  [apps/api/src/modules/file/file-system-folder.service.ts:226-240](../../apps/api/src/modules/file/file-system-folder.service.ts#L226-L240)
- **現況**：`DomainEventBus` 只有一條 `this.queue = this.queue.then(...)`，**整個程序（所有租戶）** 的事件依序處理，每個 handler await 完才輪到下一個。`PERMISSIONS_CHANGED` 有兩個訂閱者：
  - `refreshAudience`：對每個有連線的使用者依序 `await getPermissionSet()`（快取剛失效，每人 2 條查詢）。
  - `ensurePersonalFolders(onlyEligible)`：`eligible()` 逐人查權限；接著在 `lockTree()` 的交易內，對每個缺個人資料夾的人依序 `hasSibling` → `create` → `grants.set` → `audit.record`（程式註解假設「受影響的人數有限」）。
- **影響**：把 `file:access` 加到一個有 1000 人的角色（或指派「全員」角色）時：約 2000 條權限查詢 ＋ 在同一個持有樹鎖的交易裡約 4000 次往返，粗估數秒到十幾秒。這段期間：所有租戶的 `resource.changed`、`session.revoked`（停用使用者的強制登出）都排在後面；樹鎖讓該租戶所有資料夾寫入等待；一條長交易佔住 PERF-03 的 5 條連線之一。
- **建議**：
  1. 事件匯流排依租戶（或依事件類型）分開排隊，至少讓 `session.revoked` 不被其他事件卡住。
  2. `refreshAudience` 以批次查詢取得多人的權限集合（一條 SQL `WHERE user_id = ANY($1)` group by user），並限制每批的並行數。
  3. `ensurePersonalFolders` 改成批次 SQL（一次 `INSERT … SELECT`、一次 grants、一次稽核），或改為「第一次進入檔案管理器時才建立」（lazy），把大量建立移到背景工作。
- **驗收**：對 1000 人的角色授予 `file:access`，同一時間另一租戶的 `resource.changed` 推播延遲 < 1 s；該操作的交易時間 < 1 s。
- **狀態**：已修（fix/role-events）——事件匯流排依租戶分開排隊、`sessions.revoked` 走優先通道；`refreshAudience` 與個人資料夾的資格篩選改用 `PermissionService.getPermissionSets` 批次查詢（每批兩條 SQL，refreshAudience 每批 200 人）。建議 3 的後半（`ensurePersonalFolders` 在樹鎖交易內逐人 `hasSibling`／`create`／`grants.set`／`audit.record`）屬檔案模組內部，未動，延後給檔案組改成批次 SQL 或 lazy 建立。

### PERF-09 列表每一頁都 `count(*)`，稽核最長 90 天範圍、檔案游標分頁也算，offset 沒有上限

- **嚴重度**：P2
- **狀態**：部分修正（fix/infra-tenancy）：稽核列表 offset 上限 10,000、total 最多數到 10,100（LIMIT 子查詢）。keyset 分頁、檔案游標分頁不回 total、其他列表的 offset 上限不在本組範圍，延後
- **位置**：
  [apps/api/src/modules/audit-log/audit-log.repository.ts:67-112](../../apps/api/src/modules/audit-log/audit-log.repository.ts#L67-L112)、
  [apps/api/src/modules/audit-log/dto/list-audit-log.dto.ts:9-18](../../apps/api/src/modules/audit-log/dto/list-audit-log.dto.ts#L9-L18)、
  [apps/api/src/modules/file/file.repository.ts:120-138](../../apps/api/src/modules/file/file.repository.ts#L120-L138)、
  [apps/api/src/modules/user/user.repository.ts:100-116](../../apps/api/src/modules/user/user.repository.ts#L100-L116)、
  [apps/api/src/core/http/pagination.ts:3-6](../../apps/api/src/core/http/pagination.ts#L3-L6)
- **現況**：稽核列表預設查「現在往前 90 天」，每一頁都並行跑 `count(*)`；跨冷熱表時兩張表各 count 一次。`offset` 只有 `min(0)`，沒有上限，深分頁要掃過 offset + limit 筆。檔案列表在 **游標分頁**（無限捲動）時也每頁重算 total。使用者、角色、審批列表同樣是 offset ＋ count。
- **影響**：1000 人的租戶每天數萬筆稽核（每次寫入、每次 403、登入登出），90 天約數百萬列；帶 `result`、`resourceType` 以外沒有索引的篩選時，count 要回表。每次稽核頁面開啟、翻頁、以及 PERF-06 的 `derivesFromAnyChange` 重抓都付一次這個成本。檔案的無限捲動每捲一頁就重算一次 total。
- **建議**：
  1. 稽核改為 keyset 分頁（`(occurred_at, id) < cursor`，索引已存在），total 改為「估計值」（`EXPLAIN` 的 rows 或 `pg_class.reltuples` 比例）或只在第一頁、且範圍 ≤ 7 天時精算。
  2. 檔案游標分頁時不回 total（或只在第一頁回）。
  3. `offset` 設上限（例如 10,000），超過改要求縮小範圍。
- **驗收**：300 萬列的稽核熱表，稽核列表第一頁與第 100 頁的 p95 都 < 100 ms；`pg_stat_statements` 中稽核 count 的總耗時占比下降。
- **狀態**：檔案列表部分已修（fix/file）：帶游標的頁不再 `count(*)`，`FileListPage.pagination.total` 改為 nullable（已重新產生 SDK）。稽核 keyset、offset 上限與其他列表不在檔案組

### PERF-10 背景工作、排程、影像處理都在同一個 API 程序；寄信無 SMTP 連線池、並行 1

- **嚴重度**：P2
- **狀態**：部分修正（fix/infra-tenancy）：SMTP 連線池（MAIL_SMTP_POOL_SIZE）、寄信工作每程序並行 5（defineJob 的 concurrency）。拆出 worker 容器延後——工作裡發佈的領域事件只送得到 worker 自己的 Socket.io，要先有跨程序的事件（docs/features/multi-instance.md 已補充）
- **位置**：
  [apps/api/src/core/config/env.schema.ts:163-166](../../apps/api/src/core/config/env.schema.ts#L163-L166)、
  [apps/api/src/core/jobs/job-queue.ts:103-112](../../apps/api/src/core/jobs/job-queue.ts#L103-L112)、
  [apps/api/src/core/jobs/job-queue.ts:361-379](../../apps/api/src/core/jobs/job-queue.ts#L361-L379)、
  [apps/api/src/core/mail/smtp-mail-transport.ts:18-27](../../apps/api/src/core/mail/smtp-mail-transport.ts#L18-L27)、
  [docker-compose.prod.yml:47-86](../../docker-compose.prod.yml#L47-L86)
- **現況**：`JOBS_WORKER_ENABLED` 預設 `true`，prod compose 只有一個 `api`，所以 pg-boss worker、cron、稽核封存、檔案維護（整桶列舉物件，`file-maintenance.service.ts:233`）、寄信都跟 REST ＋ WebSocket 共用 event loop。每種工作 `boss.work(name, { batchSize: 1 })`，本地並行 1。nodemailer `createTransport(url)` 沒有 `pool: true`，每封信重新建立 SMTP（含 TLS）連線；React Email 的 `render()` 在主執行緒。
- **影響**：批次邀請 / 大量審批結果信時吞吐約每秒 1–2 封（每封一次 SMTP 握手，待驗證），1000 封要 10 分鐘以上；封存、維護、渲染信件的 CPU 與 GC 直接反映在 API 延遲與 WebSocket 心跳上。
- **建議**：
  1. compose 拆出 `worker` 服務（同一個映像，`JOBS_WORKER_ENABLED=true`），`api` 設 `false`；兩者各自設記憶體上限。
  2. 寄信的 transport 設 `pool: true, maxConnections: 5`，mail 類工作設 `localConcurrency`（例如 5）。
  3. 影像處理一併移到 worker（PERF-07）。
- **驗收**：入列 1000 封信，完成時間 < 2 分鐘；同時間 API p99 不變。

### PERF-11 單一執行個體：每次部署／重啟 1000 條連線同時重連，快取全冷

- **嚴重度**：P2
- **狀態**：部分修正（fix/infra-tenancy）：前端重連退避改 2–30 秒加隨機、handshake 上限可調。多實例與滾動部署延後，前提已補進 docs/features/multi-instance.md
- **位置**：
  [docker-compose.prod.yml:86](../../docker-compose.prod.yml#L86)、
  [apps/api/src/modules/realtime/realtime.gateway.ts:120-132](../../apps/api/src/modules/realtime/realtime.gateway.ts#L120-L132)、
  [apps/api/src/modules/realtime/realtime.gateway.ts:159-163](../../apps/api/src/modules/realtime/realtime.gateway.ts#L159-L163)、
  [apps/backstage/src/core/realtime/socketIoTransport.ts:36-49](../../apps/backstage/src/core/realtime/socketIoTransport.ts#L36-L49)、
  [docs/architecture/01-system.md:254-262](../architecture/01-system.md)
- **現況**：compose 明確「單一執行個體」（權限快取、Socket.io room、throttler、handshake 計數都在記憶體；01-system.md §4.3 列了擴展的四個前提，目前都未具備）。前端 Socket.io client 用預設重連參數（1–5 s、randomization 0.5）；重連後 leader 發 `resync` 讓每個分頁重新驗證 query。
- **影響**：每次部署都中斷所有人，約 5 秒內 1000 條 handshake 同時進來，每條在冷快取下做使用者查詢 ＋ 2 條權限查詢 ＋ 加入 room，接著每個前景分頁整批重抓；與 PERF-01（30 次/分/IP 的 handshake 上限）疊加時，大部分人會在數分鐘內看不到推播。也沒有滾動部署的可能。
- **建議**：
  1. 短期：前端 `reconnectionDelay`、`reconnectionDelayMax` 拉大（例如 2 s / 30 s）並加大 randomization；`resync` 只重抓目前畫面上的 query（已是 active 才重抓，可再加 jitter）。
  2. 中期：完成 01-system.md §4.3 的四項（`@socket.io/postgres-adapter`、快取失效的 `LISTEN/NOTIFY`、throttler 改用共享儲存、nginx upstream 動態解析），跑 2 個以上 api 執行個體做滾動部署。
- **驗收**：部署期間（滾動更新）WebSocket 斷線比例 < 50% 且 30 秒內全部恢復；冷啟動時 1000 條重連的 handshake p99 < 1 s。

### PERF-12 租戶網域快取沒有上限，未命中也在 throttler 之前查平台 DB

- **嚴重度**：P2
- **狀態**：已修（fix/infra-tenancy）：三個快取改為有上限的 LRU，快照裡沒有的 Host 不查平台 DB，格式不對的 Host／代碼直接略過。nginx 對未知 Host 回 444 未做：客戶自訂網域是動態登記的，nginx 無法列舉
- **位置**：
  [apps/api/src/core/tenant/tenant-directory.service.ts:38-40](../../apps/api/src/core/tenant/tenant-directory.service.ts#L38-L40)、
  [apps/api/src/core/tenant/tenant-directory.service.ts:108-119](../../apps/api/src/core/tenant/tenant-directory.service.ts#L108-L119)、
  [apps/api/src/core/tenant/tenant.middleware.ts:38-56](../../apps/api/src/core/tenant/tenant.middleware.ts#L38-L56)、
  [apps/api/src/app.module.ts:95-98](../../apps/api/src/app.module.ts#L95-L98)
- **現況**：`byHost`、`byId`、`byCode` 是無上限的 `Map`，連「找不到」都快取；過期的項目只在同一個 key 再被查到時才覆寫，從不清掉。`TenantMiddleware` 對每個請求（含 `x-tenant` 標頭）解析租戶，middleware 在 `ThrottlerGuard` 之前執行。
- **影響**：送大量不同 `Host`（nginx 是 `server_name _`，任何 Host 都轉進來）或不同 `X-Tenant` 的請求，每個新值一次平台 DB 查詢、一筆永久的 Map 項目，不受速率限制。這是記憶體緩慢成長與平台 DB（池只有 10 條）的放大點。
- **建議**：未命中時先比對同步快照 `this.domains`（已每 `TENANT_CACHE_TTL` 秒整份載入），快照沒有就直接回「找不到」、不查 DB；三個 Map 改為有上限的 LRU；nginx 對未知 Host 回 444（或只接受 `*.<TENANT_BASE_DOMAIN>` 與已登記的自訂網域）。
- **驗收**：以 10 萬個隨機 Host 打 `/health/ready` 以外的端點，平台 DB 查詢數不增加、api heap 不成長。

### PERF-13 outbox 清掃每分鐘進入每一個租戶，所有租戶的連線池永遠不會閒置關閉

- **嚴重度**：P2
- **狀態**：已修（fix/infra-tenancy）：outbox 清掃預設改每 10 分鐘、租戶池閒置 30 秒關閉（TENANT_POOL_IDLE_TIMEOUT）。「只清掃有寫入的租戶」與「relay 移出交易」延後（目前頻率下影響已小）
- **位置**：
  [apps/api/src/core/config/env.schema.ts:171](../../apps/api/src/core/config/env.schema.ts#L171)、
  [apps/api/src/core/jobs/job-queue.ts:195-233](../../apps/api/src/core/jobs/job-queue.ts#L195-L233)、
  [apps/api/src/core/jobs/job-queue.ts:296-302](../../apps/api/src/core/jobs/job-queue.ts#L296-L302)、
  [apps/api/src/core/tenant/tenancy.service.ts:114-128](../../apps/api/src/core/tenant/tenancy.service.ts#L114-L128)、
  [apps/api/src/core/tenant/tenancy.service.ts:196-203](../../apps/api/src/core/tenant/tenancy.service.ts#L196-L203)
- **現況**：`JOBS_OUTBOX_SWEEP_CRON` 預設 `* * * * *`，`sweepOutboxes()` 以 `forEachActive` 依序進入 **每一個** active 租戶並開交易查 `job_outbox`；租戶池的 `idleTimeout` 是 60 秒，剛好與清掃週期相同。`relayOutbox` 在持有 outbox 列鎖的租戶交易內，依序對平台 DB 的 pg-boss `send()` 最多 100 次。
- **影響**：
  - 設計上「沒人用的租戶不佔連線」實際上不成立：每個租戶至少長期維持約 1 條連線，PERF-03 的連線預算以「所有 active 租戶」計。
  - 租戶數 N 時每分鐘 N 個交易，N 大時單輪清掃可能超過 60 秒而與下一輪重疊（`exclusive` 會擋掉重疊，但延遲整體補救）。
  - 跨 DB 的網路呼叫在租戶交易內，拖長交易時間。
- **建議**：清掃頻率改為 5–10 分鐘（它只是補救）；只清掃「最近有寫入」的租戶（例如 `afterCommit` 失敗時在平台 DB 記一筆待清掃的租戶 id）；`relayOutbox` 先在短交易內 `DELETE … RETURNING` 取出一批，送出失敗再放回，或用 pg-boss 的批次 `insert()`。
- **驗收**：50 個 active 但閒置的租戶，閒置 5 分鐘後 `pg_stat_activity` 中這些租戶 DB 的連線數為 0。

### PERF-14 libuv threadpool 維持預設 4：argon2、sharp、DNS 查詢互相排隊

- **嚴重度**：P2
- **狀態**：已修（fix/infra-tenancy）：映像與 compose 設 UV_THREADPOOL_SIZE=16。登入端點的 argon2 並行上限延後
- **位置**：
  [apps/api/src/modules/auth/password.ts:12-18](../../apps/api/src/modules/auth/password.ts#L12-L18)、
  [apps/api/src/core/image/sharp-image-processor.ts:43-51](../../apps/api/src/core/image/sharp-image-processor.ts#L43-L51)、
  [apps/api/Dockerfile:25-42](../../apps/api/Dockerfile#L25-L42)
- **現況**：`@node-rs/argon2` 的 `hash` / `verify` 與 sharp 的非同步操作都排進 libuv threadpool（待以文件確認 `@node-rs/argon2` 的實作細節）；`dns.lookup`（postgres.js 以主機名稱 `postgres` 建立新連線時）也用同一個池。Dockerfile 與 compose 都沒有設 `UV_THREADPOOL_SIZE`（預設 4）。
- **影響**：早上登入尖峰（每次驗證約數十 ms、帳號不存在時也跑 dummy hash）加上影像處理時，4 條執行緒被佔滿，新 DB 連線的 DNS 解析、檔案系統操作都要排隊，表現為看似無關的 API 延遲飆高。不會阻塞 event loop（這是做對的），但會互相拖慢。
- **建議**：api 容器設 `UV_THREADPOOL_SIZE=16`（依 CPU 數調整）；影像處理移出（PERF-07）；對登入端點做並行上限（例如同時最多 8 個 argon2 驗證）以保護其他請求。
- **驗收**：同時 50 個登入 ＋ 2 個影像處理時，`GET /users` 的 p99 與無負載時相差 < 50 ms。

### PERF-15 nginx 對 api 沒有 upstream keepalive，每個 API 請求都開新的 TCP

- **嚴重度**：P2
- **狀態**：已修（fix/infra-tenancy）：upstream api_backend ＋ keepalive、/api/ 清掉 Connection 標頭、gzip_proxied any；api 的 keepAliveTimeout 65 秒
- **位置**：[deploy/nginx.conf:57-66](../../deploy/nginx.conf#L57-L66)、[deploy/nginx.auth.conf:33-42](../../deploy/nginx.auth.conf#L33-L42)、[deploy/nginx.conf:15-17](../../deploy/nginx.conf#L15-L17)
- **現況**：`proxy_pass http://api:3000/;` 直接寫主機，沒有 `upstream { keepalive N; }`，也沒有清掉 `Connection` 標頭（`proxy_set_header Connection "";`）；因此 nginx → api 每個請求都新建 TCP。`gzip_proxied` 沒設（預設 `off`），前面若有會加 `Via` 標頭的 LB / CDN，API 回應與靜態檔不會被壓縮（待驗證實際 LB 行為）。
- **影響**：300–500 rps 尖峰時每秒數百次 TCP 建立／關閉、nginx 與 api 兩端累積大量 `TIME_WAIT`，增加延遲與 CPU；在容器的 ephemeral port 範圍內有耗盡風險。
- **建議**：
  ```nginx
  upstream api_backend { server api:3000; keepalive 64; }
  location /api/ { proxy_pass http://api_backend/; proxy_set_header Connection ""; ... }
  ```
  WebSocket 的 location 維持 `Connection "upgrade"`。加 `gzip_proxied any;`、`gzip_comp_level 5;`、`gzip_vary on;`。Node 端 `server.keepAliveTimeout` 要大於 nginx 的 `keepalive_timeout`（預設 Node 5 s，建議設 65 s）。
- **驗收**：壓測 300 rps 時 api 容器內 `ss -tan state time-wait | wc -l` 維持在數十以內；回應帶 `Content-Encoding: gzip`。

### PERF-16 缺少容量相關的防護與指標：沒有 `statement_timeout`、pool 等待、event loop lag

- **嚴重度**：P2
- **狀態**：部分修正（fix/infra-tenancy）：每條連線的 statement_timeout／idle_in_transaction_session_timeout／connect_timeout 可設定（integration test 驗證 pg_sleep 被中止）；postgres 開 pg_stat_statements 與 log_min_duration_statement。metrics 端點（event loop、池使用率、佇列深度）延後——需要選定監控方案
- **位置**：
  [apps/api/src/core/database/database.provider.ts:24-31](../../apps/api/src/core/database/database.provider.ts#L24-L31)、
  [apps/api/src/modules/health/health.service.ts:30-49](../../apps/api/src/modules/health/health.service.ts#L30-L49)、
  [apps/api/src/core/logger/logger.module.ts:17-35](../../apps/api/src/core/logger/logger.module.ts#L17-L35)
- **現況**：連線只設 `max`、`idle_timeout`、`connect_timeout`；沒有 `statement_timeout`、沒有查詢排隊的上限或逾時。沒有任何 metrics 端點（event loop lag、heap、連線池使用率與等待、各租戶連線數、WebSocket 連線數、pg-boss 佇列深度）。`/health/ready` 只 ping 平台 DB 與物件儲存。
- **影響**：本文所有容量問題在上線後只能從「使用者抱怨變慢」發現；一條失控的查詢可以無限期佔住 5 條連線之一。
- **建議**：每條連線 `connection: { statement_timeout: 15000, idle_in_transaction_session_timeout: 30000 }`（postgres.js 支援）；加 `prom-client`（或 OpenTelemetry）輸出 `eventLoopUtilization`、heap、`socket.io` 連線數、每個租戶池的 `client.options.max` 與忙碌數、pg-boss `getQueueSize`；postgres 開 `pg_stat_statements` 與 `log_min_duration_statement=500ms`。
- **驗收**：Grafana（或同等工具）可以看到上述指標；刻意執行 `SELECT pg_sleep(60)` 會在 15 秒被中止。

### PERF-17 稽核冷表沒有保留期限，且缺 `action` 索引

- **嚴重度**：P3
- **狀態**：部分修正（fix/infra-tenancy）：租戶 migration 0005 補冷表的 action 索引。保留期限（按月分區、DROP PARTITION）延後——需要先訂法規上的保留年限
- **位置**：[apps/api/src/db/migrations/0000_baseline.sql:274-280](../../apps/api/src/db/migrations/0000_baseline.sql#L274-L280)、[apps/api/src/modules/audit-log/audit-log.archive.ts:14-32](../../apps/api/src/modules/audit-log/audit-log.archive.ts#L14-L32)
- **現況**：熱表有 `audit_logs_action_idx`（`text_pattern_ops`），冷表只有 occurred / actor / resource 三個索引。封存只搬移不清除，冷表永遠成長。
- **影響**：查超過 90 天、以 `action` 前綴篩選的查詢在冷表只能用時間索引再過濾；冷表數年後的容量與備份時間持續增加。短期不影響 1000 人在線。
- **建議**：冷表補 `(action text_pattern_ops, occurred_at DESC)`；依法規訂保留年限，以月分區（`PARTITION BY RANGE (occurred_at)`）讓過期資料以 `DROP PARTITION` 清除。
- **驗收**：冷表 1000 萬列時，`action=role.*` 且範圍 90 天的查詢 p95 < 200 ms。

### PERF-18 file-storage 的中繼資料全在記憶體，寫入後 List 要整桶重新排序、線性掃描

- **嚴重度**：P3
- **位置**：
  [apps/file-storage/src/storage/disk-store.ts:197-201](../../apps/file-storage/src/storage/disk-store.ts#L197-L201)、
  [apps/file-storage/src/storage/disk-store.ts:288](../../apps/file-storage/src/storage/disk-store.ts#L288)、
  [apps/file-storage/src/storage/disk-store.ts:557](../../apps/file-storage/src/storage/disk-store.ts#L557)、
  [apps/file-storage/src/storage/disk-store.ts:569-595](../../apps/file-storage/src/storage/disk-store.ts#L569-L595)、
  [apps/file-storage/src/s3/list.ts:22-60](../../apps/file-storage/src/s3/list.ts#L22-L60)
- **現況**：啟動時逐一讀取每個物件的 JSON 載入記憶體；每次寫入或刪除把 `state.sorted` 設為 `undefined`，下一次 ListObjects 重新排序整個 bucket，`listPage` 再從頭線性比對 prefix。api 在刪除檔案（`deleteVariants` 以 prefix 列舉）與每小時的維護（整桶列舉三個前綴）都會呼叫 List。
- **影響**：物件數到數十萬時，每次刪檔都是 O(n log n) 的排序與 O(n) 掃描、啟動時間線性增加；上傳與刪除交錯時排序快取幾乎無效。資料本體有串流（見「做得好的地方」），所以不影響上傳下載吞吐。
- **建議**：正式環境以真正的 S3 / MinIO 取代（設計上已可替換）；若保留，改用有序結構（例如 sorted array ＋ 二分插入，或按 prefix 分組），`listPage` 以二分搜尋定位起點。
- **驗收**：50 萬物件的 bucket，交錯執行 PUT 與 `ListObjectsV2(prefix=variants/<id>/)` 時 p99 < 20 ms。
- **狀態**：已修（fix/file）：排序清單在寫入／刪除時以二分搜尋就地維持，`listPage` 以二分搜尋定位起點、離開 prefix 範圍就停。插入仍是 O(n) 陣列搬移；大量物件時正式環境仍建議換 S3／MinIO

### PERF-19 部分篩選欄位沒有索引（`files.created_by`、使用者關鍵字 `%kw%`）

- **嚴重度**：P3
- **位置**：
  [apps/api/src/modules/file/file.repository.ts:96-110](../../apps/api/src/modules/file/file.repository.ts#L96-L110)、
  [apps/api/src/modules/user/user.repository.ts:73-90](../../apps/api/src/modules/user/user.repository.ts#L73-L90)、
  [apps/api/src/db/migrations/0000_baseline.sql:287-294](../../apps/api/src/db/migrations/0000_baseline.sql#L287-L294)、
  [apps/api/src/db/migrations/0000_baseline.sql:313-316](../../apps/api/src/db/migrations/0000_baseline.sql#L313-L316)
- **現況**：檔案列表的 `uploaderId` 篩選（`files.created_by`）沒有索引；使用者列表的關鍵字以 `ILIKE '%kw%'` 比對 email / username / display_name 三欄，沒有 trigram 索引（`files.name` 有）。使用者列表是 `users LEFT JOIN user_roles LEFT JOIN roles GROUP BY users.id` 後才排序分頁。
- **影響**：使用者數在數千以內時都是毫秒級，1000 人不會出事；使用者或檔案數成長到數十萬後才會退化。
- **建議**：`files (created_by, created_at) WHERE deleted_at IS NULL`；`users` 三欄的 `gin_trgm_ops`（或合成一個 `search_text` 欄）；使用者列表先分頁再聚合角色（子查詢 `LIMIT` 後 join）。
- **驗收**：`EXPLAIN ANALYZE` 顯示上述查詢使用索引；10 萬使用者時關鍵字搜尋 p95 < 50 ms。
- **狀態**：部分已修（fix/role-events）——使用者關鍵字：`users` 的 email／username／display_name 加 `gin_trgm_ops` 部分索引（migration 0006），查詢運算式改成與索引一致（`username::text`，拿掉 `coalesce`），整合測試以 `EXPLAIN` 驗證三個索引都用得上。延後：`files (created_by, created_at)` 索引（檔案組）；使用者列表「先分頁再聚合角色」（目前規模下不必要）。
- **狀態**：`files.created_by` 部分已修（fix/file）：`files_created_by_created_at_idx`（created_by, created_at）WHERE deleted_at IS NULL，tenant migration `0004_files_created_by_idx`。使用者關鍵字 trigram 與先分頁再聚合不在檔案組

### PERF-20 容器沒有記憶體上限與 Node heap 設定；健康檢查只看 liveness

- **嚴重度**：P3
- **狀態**：已修（fix/infra-tenancy）：compose 每個服務設 mem_limit、api 的 NODE_OPTIONS=--max-old-space-size。健康檢查的 event loop lag 門檻延後（完全卡住時 HEALTHCHECK 的 3 秒逾時已會失敗）
- **位置**：[docker-compose.prod.yml:47-86](../../docker-compose.prod.yml#L47-L86)、[apps/api/Dockerfile:39-42](../../apps/api/Dockerfile#L39-L42)
- **現況**：compose 所有服務都沒有 `mem_limit` / `deploy.resources`；api 沒有 `NODE_OPTIONS=--max-old-space-size`。Docker `HEALTHCHECK` 打 `/health`（永遠 ok），不反映 DB、event loop 是否正常。
- **影響**：記憶體尖峰（PERF-07）時沒有明確的界線，可能拖垮同機的 postgres；event loop 卡死或 DB 斷線時容器仍被視為健康、不會被重啟。
- **建議**：api、worker、postgres、file-storage 各設記憶體上限，`--max-old-space-size` 設為上限的 70–75%；健康檢查維持 liveness，另加 event loop lag 門檻（例如 > 2 s 視為不健康）；LB 的 readiness 用 `/health/ready`。
- **驗收**：`docker stats` 顯示各服務有上限；以 `while(true){}` 的測試端點（僅測試環境）卡住 event loop 時，容器在數個健康檢查週期內被標為 unhealthy。

### PERF-21 前端正式產物帶 sourcemap 與 MSW chunk

- **嚴重度**：P3
- **狀態**：已修（fix/infra-tenancy）：正式 build 不產生 sourcemap（BUILD_SOURCEMAP=hidden 可選），MSW chunk 不再進產物。bundle 大小預算的 CI 檢查延後
- **位置**：[apps/backstage/vite.config.ts:46-49](../../apps/backstage/vite.config.ts#L46-L49)、[apps/backstage/src/main.tsx:42-45](../../apps/backstage/src/main.tsx#L42-L45)
- **現況**：`build.sourcemap: true`，所有 `.map` 由 nginx 公開提供（9/29 的 `dist/` 中 `index-*.js.map` 1.9 MB）。MSW（`browser-*.js` 約 430 KB）以動態 import 打包進產物，只有 `ENV.ENABLE_MOCK` 時才下載。入口 `index-*.js` 約 420 KB（未壓縮，gzip 後約 1/3，待以最新 build 驗證）。
- **影響**：對一般使用者的載入時間影響很小（`.map` 只有開 DevTools 才下載、MSW chunk 不會被載入），主要是產物體積與原始碼外流；入口 chunk 大小尚可。
- **建議**：正式環境 `sourcemap: 'hidden'`（上傳到錯誤追蹤服務而不公開）；以 `define` 讓 `ENV.ENABLE_MOCK` 在正式 build 為常數 `false`，讓 MSW 分支被 tree-shake；加 `rollup-plugin-visualizer` 與 bundle size 預算檢查（CI）。
- **驗收**：正式 build 的 `dist/assets` 沒有 `.map` 與 MSW chunk；入口 chunk gzip 後 < 150 KB。

## 已做得好的地方

以下已確認沒有問題，之後檢查可以略過：

- **權限與使用者快取有上限且以租戶區分**：`PermissionCacheService`、`UserCacheService` 都是 `租戶:使用者` 為 key、上限 10,000 筆、TTL 60 / 30 秒，寫入時主動失效（`core/cache/permission-cache.service.ts:20-55`、`user-cache.service.ts:16-47`）。驗證熱路徑在快取命中時 0 次 DB 查詢。
- **JWT 不帶權限、HS256 驗簽便宜**；`AccessTokenVerifier` 是 HTTP、handshake、`WsAuthGuard` 共用的單一實作（`common/auth/access-token.verifier.ts:64-108`）。
- **Argon2id 用原生非同步實作**（`@node-rs/argon2`），不阻塞 event loop；帳號不存在時的 dummy hash 只算一次（`modules/auth/password.ts:24-35`）。
- **前端推播協調**：每個瀏覽器只有 leader 分頁開 WebSocket（BroadcastChannel ＋ leader election）；推播後的重抓有 150–750 ms jitter 與 keyed throttle，背景分頁只標 stale 不重抓（`apps/backstage/src/core/realtime/RealtimeCoordinator.ts:68`、`:285-305`）；token 續期以 Web Locks 跨分頁單飛（`core/auth/SessionStore.ts:166-220`），429 / 5xx 不會結束 session。
- **Socket.io 只用 websocket 傳輸**（免 sticky session、無 long-polling 的 HTTP 負擔），frame 上限 16 KB、每連線訊息速率與每人連線數都有上限；room 以租戶區分，推播只送給持有對應權限的 perm room（`modules/realtime/realtime.rooms.ts`、`realtime.audience.ts`）。nginx 的 `proxy_read_timeout 60s` 大於心跳間隔。
- **檔案上傳下載不經過 api**：presigned URL 直傳 file-storage，nginx 對 `/storage/` 不緩衝、不限大小；file-storage 以串流寫入暫存檔再改名、讀取以 `createReadStream` 串流（`apps/file-storage/src/storage/disk-store.ts:212-216`、`:507-511`）。
- **presigned URL 的簽章時間對齊時間窗**（`stableSigningDate`），同一時間窗內網址不變、瀏覽器快取可命中；影像 API 回 302 並帶 `Cache-Control: private, max-age`、`Vary: Accept`，且 `@SkipThrottle()`（`modules/file/file.controller.ts:150-167`）。
- **影像變體有並行上限與去重**（同一檔案、同一格式只產生一次），sharp 有 `limitInputPixels`（`modules/file/file-image.service.ts:56-86`、`:228-244`）；問題只在記憶體用量與執行位置（PERF-07）。
- **稽核熱／冷分表**：查詢範圍強制 ≤ 90 天、列表不讀 jsonb 欄位、封存以每批 5000 筆的短交易搬移且 `SKIP LOCKED`（`modules/audit-log/audit-log.repository.ts:17-35`、`db/migrations/0001_functions_and_triggers.sql:135-167`）。
- **檔案列表支援 keyset 游標分頁**，排序欄位是白名單 enum 且都有對應的部分索引（`files_status_*_idx`、`files_folder_created_at_idx`、`files_name_trgm_idx`）。
- **主要熱查詢都有索引**：`user_roles` 以 `(user_id, role_id)` 為 PK、另有 `role_id` 索引；`refresh_tokens.token_hash` 唯一索引；`audit_logs` 的 actor / resource / action 複合索引都以 `occurred_at DESC` 結尾。
- **租戶的 migration 狀態檢查結果快取**，併發請求共用同一次檢查（`core/tenant/tenancy.service.ts:149-166`）；`TENANT_DB` 以 Proxy ＋ AsyncLocalStorage 實作，不用 REQUEST scope 重建 DI 鏈。
- **前端路由層級 code splitting**：每個頁面 `lazyRouteComponent(() => import(...))`、語系檔動態載入；長列表用 TanStack Virtual（`components/VirtualList`、`FileBrowser`）；nginx 對 `/assets/` 設 `immutable` 一年、`index.html` 設 `no-cache`。
- **跨租戶資料與推播隔離的 key 設計**（快取、room、pg-boss singletonKey 都帶租戶 id），讓單一程序服務多租戶時不會互相污染。
