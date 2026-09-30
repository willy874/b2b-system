import type { PlatformAuditLog } from '@/shared/api-sdk';

/** `GET /platform/audit-logs` 的查詢條件；時間範圍預設且最多 90 天（後端決定）。 */
export interface PlatformAuditLogListParams {
  offset: number;
  limit: number;
  /** 完全相符；以 `.*` 結尾時是前綴（例：`tenant.*`）。 */
  action?: string;
  /** 部分相符。 */
  actorEmail?: string;
  resourceId?: string;
  result?: PlatformAuditLog['result'];
  /** ISO 8601。 */
  from?: string;
  to?: string;
}
