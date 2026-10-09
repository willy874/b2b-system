import { Counter, Histogram } from 'prom-client';

import { metricsRegistry, ObservedGauge } from './registry';

/**
 * api 的指標，唯一的一份清單（docs/architecture/08-monitoring.md §2.2）。
 * 標籤只用值域有限的東西（路由樣板、快取名稱、工作名稱、錯誤碼）；**不放租戶**：租戶多時時間序列會爆量，
 * 依租戶看要用 trace 與日誌（§2.3）。
 */

const registers = [metricsRegistry];

/** 秒；涵蓋快取命中（數毫秒）到逾時邊緣（DB_STATEMENT_TIMEOUT_MS 預設 15 秒）。 */
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
/** 秒；背景工作從數十毫秒（寄一封信）到數分鐘（稽核封存）。 */
const JOB_BUCKETS = [0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 300, 900];

export const httpRequestDuration = new Histogram({
  name: 'http_server_request_duration_seconds',
  help: 'HTTP 請求的處理時間（依方法、路由樣板、狀態碼）',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: LATENCY_BUCKETS,
  registers,
});

export const cacheLookups = new Counter({
  name: 'api_cache_lookups_total',
  help: '程序內快取的查詢（hit／miss）',
  labelNames: ['cache', 'result'] as const,
  registers,
});

export const cacheEntries = new ObservedGauge({
  name: 'api_cache_entries',
  help: '程序內快取目前的筆數',
  labelNames: ['cache'] as const,
});

export const tenantPoolsOpen = new ObservedGauge({
  name: 'api_tenant_pools_open',
  help: '開著的租戶連線池數（每個租戶第一次用到時建立）',
});

export const tenantUnavailable = new Counter({
  name: 'api_tenant_unavailable_total',
  help: '進入租戶被拒（inactive：停用或佈建中；maintenance：migration 落後或 DB 連不上）',
  labelNames: ['reason'] as const,
  registers,
});

export const dbTransactionDuration = new Histogram({
  name: 'api_db_transaction_duration_seconds',
  help: '`withTransaction` 的交易從開始到提交或回滾的時間',
  labelNames: ['outcome'] as const,
  buckets: LATENCY_BUCKETS,
  registers,
});

export const jobsProcessed = new Counter({
  name: 'api_jobs_processed_total',
  help: '背景工作的執行結果（completed、failed、skipped：租戶無法使用、deferred：租戶的同時執行數已滿）',
  labelNames: ['job', 'result'] as const,
  registers,
});

export const jobDuration = new Histogram({
  name: 'api_job_duration_seconds',
  help: '背景工作 handler 的執行時間',
  labelNames: ['job'] as const,
  buckets: JOB_BUCKETS,
  registers,
});

export const jobQueueDepth = new ObservedGauge({
  name: 'api_job_queue_depth',
  help: '佇列各狀態的筆數（pg-boss 監控迴圈的快照，最多落後約一分鐘）',
  labelNames: ['job', 'state'] as const,
});

export const outboxRelayFailures = new Counter({
  name: 'api_job_outbox_relay_failures_total',
  help: '交易提交後搬移 outbox 失敗（等定期清掃補救）',
  registers,
});

export const tenantUsageFlushFailures = new Counter({
  name: 'api_tenant_usage_flush_failures_total',
  help: '租戶用量的計數寫入平台 DB 失敗（這一輪的請求數、背景工作數遺失，docs/architecture/05-tenancy.md §14.2 D3）',
  registers,
});

export const realtimeConnections = new ObservedGauge({
  name: 'api_realtime_connections',
  help: '這個程序上的 WebSocket 連線數',
});

export const realtimeHandshakeRejected = new Counter({
  name: 'api_realtime_handshake_rejected_total',
  help: 'WebSocket handshake 被拒（依錯誤碼）',
  labelNames: ['code'] as const,
  registers,
});

export const rateLimited = new Counter({
  name: 'api_rate_limited_total',
  help: '被速率限制擋下的 HTTP 請求（依計數的桶）',
  labelNames: ['bucket'] as const,
  registers,
});

/**
 * 速率限制計數的儲存（`RateLimitStore`）每次操作的時間：共享實作（Postgres）換成 Valkey 的依據
 * （docs/architecture/01-system.md §7 D10：`hit` 的 p99 > 5 ms）。
 */
export const rateLimitStoreDuration = new Histogram({
  name: 'api_rate_limit_store_duration_seconds',
  help: '速率限制計數的儲存操作時間（依實作、操作）',
  labelNames: ['store', 'op'] as const,
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.5],
  registers,
});

export const rateLimitStoreFailures = new Counter({
  name: 'api_rate_limit_store_failures_total',
  help: '速率限制計數的儲存失敗（依政策放行或拒絕；docs/architecture/01-system.md §7 D6）',
  labelNames: ['outcome'] as const,
  registers,
});

export const limiterActive = new ObservedGauge({
  name: 'api_limiter_active',
  help: '程序內並行上限（argon2、影像處理）正在執行的工作數',
  labelNames: ['limiter'] as const,
});

export const limiterWaiting = new ObservedGauge({
  name: 'api_limiter_waiting',
  help: '程序內並行上限正在排隊的工作數',
  labelNames: ['limiter'] as const,
});

export const limiterRejected = new Counter({
  name: 'api_limiter_rejected_total',
  help: '並行上限的等待名額已滿或等待逾時',
  labelNames: ['limiter', 'reason'] as const,
  registers,
});

/** MFA 的驗證（docs/architecture/backend/21-mfa.md §12）：`purpose` 是 login／enroll，`result` 是 ok 或失敗的原因。 */
export const mfaVerifications = new Counter({
  name: 'api_mfa_verifications_total',
  help: 'MFA 驗證碼的驗證次數（依方式、用途、結果）',
  labelNames: ['method', 'purpose', 'result'] as const,
  registers,
});

/** 伺服器發出的 MFA challenge（Email 驗證碼信）。 */
export const mfaChallengesSent = new Counter({
  name: 'api_mfa_challenges_sent_total',
  help: '寄出的 MFA 驗證碼（依方式）',
  labelNames: ['method'] as const,
  registers,
});

/** Email 驗證碼從入列（challenge 建立）到寄出的秒數；p95 超過 60 秒告警（docs/architecture/backend/21-mfa.md §12）。 */
export const mfaEmailDeliverySeconds = new Histogram({
  name: 'api_mfa_email_delivery_seconds',
  help: 'Email 驗證碼從入列到寄出的秒數',
  buckets: [1, 2, 5, 10, 20, 30, 60, 120, 300],
  registers,
});

/**
 * 匯入匯出處理的列數（docs/architecture/backend/22-data-transfer.md §9.6）：`direction` 是 export／import，
 * `type` 是登記的資源類型（數量有限），`result` 是 succeeded／failed／skipped。
 */
export const dataTransferRows = new Counter({
  name: 'api_data_transfer_rows_total',
  help: '匯入匯出處理的列數（依方向、資源類型、結果）',
  labelNames: ['direction', 'type', 'result'] as const,
  registers,
});

/** 匯出寫出、匯入分析讀進的位元組數。 */
export const dataTransferBytes = new Counter({
  name: 'api_data_transfer_bytes_total',
  help: '匯出寫出與匯入分析讀進的位元組數（依方向、格式）',
  labelNames: ['direction', 'format'] as const,
  registers,
});

/** 匯入分析在 worker thread 解析檔案的秒數（§7.3）。 */
export const dataTransferParseDuration = new Histogram({
  name: 'api_data_transfer_parse_duration_seconds',
  help: '匯入分析解析檔案的秒數（依格式）',
  labelNames: ['format'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers,
});

/**
 * 儲存的止水線（docs/architecture/backend/25-image.md §12 D8）：所有租戶最近一次量到的已用量合計與上限（位元組）。
 * 每個程序回報的是同一個平台 DB 的數字，查詢取 `max`。
 */
export const storageTotalUsed = new ObservedGauge({
  name: 'api_storage_total_used_bytes',
  help: '所有租戶最近一次量到的已用量合計（位元組）',
});

export const storageTotalLimit = new ObservedGauge({
  name: 'api_storage_total_limit_bytes',
  help: '儲存的止水線（位元組；0 = 不啟用）',
});

/** 上傳時的止水線檢查：allowed、blocked（超過）、stale（彙總過舊而放行）。 */
export const storageTotalChecks = new Counter({
  name: 'api_storage_total_checks_total',
  help: '上傳時的止水線檢查（依結果）',
  labelNames: ['result'] as const,
  registers,
});

/**
 * 圖片庫的處理（`gallery.process`，docs/architecture/backend/26-gallery.md §11）：一次處理的秒數，
 * `step` 是 `original`（寫原檔、讀 EXIF）或 `variants`（產生一個版本的變體），`result` 是 ok／failed。
 */
export const galleryProcessDuration = new Histogram({
  name: 'api_gallery_process_duration_seconds',
  help: '圖片庫處理一張圖的秒數（依步驟、結果）',
  labelNames: ['step', 'result'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  registers,
});

/** 圖片庫處理失敗的張數（依原因：notImage、typeNotAllowed、tooLarge、missing）。 */
export const galleryProcessFailures = new Counter({
  name: 'api_gallery_process_failures_total',
  help: '圖片庫處理失敗的張數（依原因）',
  labelNames: ['reason'] as const,
  registers,
});

/**
 * 邊緣快取的清理（docs/architecture/backend/09-file.md §16.6）：每個節點的每一次清理請求一筆。
 * `timeout` 是超過 `FILE_CDN_PURGE_TIMEOUT_MS`、`error` 是連不上或回應不是 200。標籤不帶節點位址（會隨擴縮改變）。
 */
export const cdnPurgeRequests = new Counter({
  name: 'api_cdn_purge_requests_total',
  help: '送到邊緣節點的清理請求（依結果：ok、error、timeout）',
  labelNames: ['result'] as const,
  registers,
});

/** 清理成功的路徑數（每筆工作全部節點都成功後才算；`--all` 不計）。 */
export const cdnPurgePaths = new Counter({
  name: 'api_cdn_purge_paths_total',
  help: '已從所有邊緣節點清掉的路徑數',
  registers,
});

/**
 * 清理沒做成（§16.6）：`schedule` 是入列失敗、`final` 是 `cdn.purge` 用完重試仍失敗。
 * 兩者都不影響刪除本身；被刪掉的圖會在網址的剩餘效期內仍讀得到。
 */
export const cdnPurgeFailures = new Counter({
  name: 'api_cdn_purge_failures_total',
  help: '邊緣快取的清理沒有完成（schedule：入列失敗；final：重試用完）',
  labelNames: ['stage'] as const,
  registers,
});

/**
 * 邊緣節點的狀態（docs/architecture/backend/09-file.md §16.10）：最近一次 `cdn.healthCheck`（或手動檢查）的結果，
 * 由執行那次檢查的程序回報、15 分鐘內有效。`node` 是清理端點解析出來的位址：數量就是邊緣的實例數，
 * 是 §8 標籤規則的例外（值域由部署決定、不隨租戶或請求增加）。告警以 `max by (node)` 合併多個程序的回報。
 */
export const cdnEdgeUp = new ObservedGauge({
  name: 'api_cdn_edge_up',
  help: '邊緣節點在最近一次檢查時是否連得到、清理密鑰被接受（1／0）',
  labelNames: ['node'] as const,
});

/** 節點缺少 api 簽發中的 kid（1）：api 簽出的網址會被這個節點拒絕。 */
export const cdnEdgeKidMismatch = new ObservedGauge({
  name: 'api_cdn_edge_kid_mismatch',
  help: '邊緣節點缺少 api 簽發中的 kid（1／0）',
  labelNames: ['node'] as const,
});

/**
 * 檢查沒有通過的項目（每次檢查、每個沒通過的項目加一）：`node`（連不上）、`purgeSecret`、`kid`、`publicUrl`、
 * `signatureEnforced`（竄改的簽章沒被拒——最嚴重，立即告警）、`discovery`（沒有節點可檢查）。
 */
export const cdnCheckFailures = new Counter({
  name: 'api_cdn_check_failures_total',
  help: 'CDN 邊緣檢查沒有通過的項目',
  labelNames: ['item'] as const,
  registers,
});
