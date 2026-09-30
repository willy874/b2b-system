import type { PlatformAuditLog } from '@/shared/api-sdk';

type AuditLogResult = PlatformAuditLog['result'];

/** 查詢的時間範圍：後端預設且最多 90 天。 */
export const AUDIT_LOG_MAX_RANGE_DAYS = 90;

export const AUDIT_LOG_PAGE_SIZE_OPTIONS = [25, 50, 100];

export const AUDIT_LOG_RESULT_LABEL_KEY = {
  success: 'auditLog.result.success',
  failure: 'auditLog.result.failure',
} as const satisfies Record<AuditLogResult, string>;

/** 結果點的顏色走 design token（CLAUDE.md 前端規則 6）。 */
export const AUDIT_LOG_RESULT_DOT_CLASS = {
  success: 'bg-[var(--color-success)]',
  failure: 'bg-[var(--color-danger)]',
} as const satisfies Record<AuditLogResult, string>;

/** 結果篩選的「全部」：不帶 `result` 參數。 */
export const AUDIT_LOG_RESULT_ALL = 'all';
