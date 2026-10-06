import type { AuditLogRowVM } from '@b2b-system/web-core/audit-log';

import type { AuditLog, AuditLogSummary } from '@/shared/api-sdk';

/** 出現時需要特別標示的動作（refresh token 重用代表 token 可能外洩）。 */
const HIGH_RISK_ACTIONS = new Set(['auth.refresh.reuse_detected']);

/**
 * 變更前後（docs/architecture/backend/06-audit-log.md §5）。
 * 建立只有 `after`、刪除只有 `before`、沒有變更（如改密碼）兩者皆無；缺的一邊是 `undefined`。
 */
export interface AuditLogChangesVM {
  before: unknown;
  after: unknown;
}

/** 展開列才取的明細（列表 API 不回 `changes` / `metadata`）。 */
export interface AuditLogDetailVM {
  changes: AuditLogChangesVM;
  metadata: Record<string, unknown>;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toAuditLogRowVM(dto: AuditLogSummary): AuditLogRowVM {
  return {
    id: dto.id,
    occurredAt: new Date(dto.occurredAt),
    actorEmail: dto.actorEmail,
    action: dto.action,
    isHighRisk: HIGH_RISK_ACTIONS.has(dto.action),
    resourceLabel: dto.resourceName
      ? `${dto.resourceType} · ${dto.resourceName}`
      : dto.resourceType,
    result: dto.result,
    isSuccess: dto.result === 'success',
    errorCode: dto.errorCode,
  };
}

export function toAuditLogDetailVM(dto: AuditLog): AuditLogDetailVM {
  return {
    changes: { before: dto.changes?.before, after: dto.changes?.after },
    metadata: dto.metadata ?? {},
  };
}
