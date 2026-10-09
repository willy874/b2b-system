import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** 執行期的開關（docs/architecture/backend/09-file.md §16.9）；null = 沒有覆寫，跟著環境變數（等於 `on`）。 */
export const cdnState = pgEnum('cdn_state', ['on', 'off']);

export type CdnState = (typeof cdnState.enumValues)[number];

/** 一個邊緣節點在檢查中被發現的問題（§16.10）。前三種之外的問題不擋開啟。 */
export type CdnNodeProblem =
  /** 連不上（連線被拒、DNS 之後的錯誤）。 */
  | 'unreachable'
  /** 超過 `FILE_CDN_PURGE_TIMEOUT_MS`。 */
  | 'timeout'
  /** `/_status` 回 403：清理密鑰與 api 的不同，清理會全部被拒。 */
  | 'purgeSecretRejected'
  /** `/_status` 的回應不是預期的形狀（不是這一版的邊緣）。 */
  | 'badResponse'
  /** 節點沒有 api 簽發中的 kid：api 簽出的網址會被這個節點拒絕。 */
  | 'signingKidMissing'
  /** api 其他可驗證的 kid 不在節點上（輪替中，只警告）。 */
  | 'verifyKidMissing';

/** 一個邊緣節點的檢查結果。 */
export interface CdnCheckNode {
  /** 清理端點解析出來的位址。 */
  address: string;
  problems: CdnNodeProblem[];
  /** 節點回報的金鑰 id（依金鑰環的順序）；連不上時是 null。 */
  kids: string[] | null;
  /** 節點沒有的 kid（api 的金鑰環減掉節點的）。 */
  missingKids: string[];
  cache: { maxSize: string; inactive: string; valid: string } | null;
  build: string | null;
  startedAt: string | null;
  /** 失敗的細節（狀態碼、錯誤訊息），給頁面與日誌。 */
  detail?: string;
}

/** 對外網址的檢查（項目 4）：以 api 的身分簽一個不存在的路徑，預期源站的 404。 */
export type CdnPublicUrlResult =
  | 'ok'
  /** 403 且帶 `X-CDN-Reject`：邊緣不接受 api 的簽章。 */
  | 'signatureRejected'
  /** 403 不帶 `X-CDN-Reject`：源站拒絕了回源（回源憑證不對）。 */
  | 'originAuthRejected'
  /** 502／504：邊緣連不到源站。 */
  | 'originUnreachable'
  /** api 所在的網路連不到對外網址。 */
  | 'unreachable'
  | 'unexpected';

/** 竄改的簽章要被拒（項目 5）：沒被拒是最嚴重的問題（任何人都能從快取讀到內容）。 */
export type CdnSignatureCheckResult = 'ok' | 'notEnforced' | 'unreachable' | 'unexpected';

/**
 * 一次檢查的結果（`CdnHealthService`，手動與定期共用）。存進 `cdn_settings.last_check`，頁面直接顯示。
 * 型別放在 schema 旁：`db/` 不 import `core/`，core 再轉出它。
 */
export interface CdnCheckResult {
  checkedAt: string;
  /** 開啟前必須通過的三項（每個節點連得到、清理密鑰正確、有簽發中的 kid）是否全部成立。 */
  ready: boolean;
  /** 找節點：沒有設定清理端點、或名稱解析失敗時沒有節點可檢查（`ready` 一定是 false）。 */
  discovery: { ok: boolean; problem?: 'purgeNotConfigured' | 'resolveFailed'; detail?: string };
  nodes: CdnCheckNode[];
  publicUrl: { result: CdnPublicUrlResult; status?: number; detail?: string };
  signatureEnforced: { result: CdnSignatureCheckResult; status?: number; detail?: string };
}

/**
 * CDN 的執行期設定（docs/architecture/backend/09-file.md §16.9）：只有一列（`id = 'default'`）。每個欄位 null = 沒有覆寫，
 * 跟著環境變數；沒有列 = 全部沒有覆寫，行為與只有環境變數時完全相同（§17 D12）。
 * 讀取時以環境變數的上限裁切（`resolveCdnEffective`），不改寫這裡的值。
 */
export const cdnSettings = pgTable(
  'cdn_settings',
  {
    id: text('id').primaryKey().default('default'),
    state: cdnState('state'),
    /** 允許的資源類型（⊆ `FILE_CDN_RESOURCES`）；不認得的值讀取時忽略。 */
    resources: text('resources').array(),
    /** 秒；300 ≤ 值 ≤ `FILE_CDN_MAX_URL_TTL`（超過的部分讀取時裁切）。 */
    urlTtlCap: integer('url_ttl_cap'),
    purgeOnDelete: boolean('purge_on_delete'),
    purgeBatchSize: integer('purge_batch_size'),
    /** 頁面顯示「誰在何時關掉」；關掉之後已發出的網址最晚何時過期由它與效期上限算出。 */
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }),
    /** 平台管理者；不設外鍵，管理者刪除後紀錄仍在。 */
    stateChangedBy: uuid('state_changed_by'),
    lastCheckAt: timestamp('last_check_at', { withTimezone: true }),
    lastCheck: jsonb('last_check').$type<CdnCheckResult>(),
    /** 樂觀鎖：沒有列時是 1，第一次寫入建立它（與 MFA 政策相同）；檢查的結果不遞增它。 */
    version: integer('version').notNull().default(1),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('cdn_settings_singleton', sql`${t.id} = 'default'`),
    check('cdn_settings_url_ttl_cap_check', sql`${t.urlTtlCap} BETWEEN 300 AND 86400`),
    check('cdn_settings_purge_batch_size_check', sql`${t.purgeBatchSize} BETWEEN 1 AND 1000`),
  ],
);

export type CdnSettingsRow = typeof cdnSettings.$inferSelect;
