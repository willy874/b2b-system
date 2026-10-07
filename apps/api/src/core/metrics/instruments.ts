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
