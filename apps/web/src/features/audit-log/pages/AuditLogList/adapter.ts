import type { AuditLog, AuditLogSummary } from '@/shared/api-sdk';

/** 出現時需要特別標示的動作（refresh token 重用代表 token 可能外洩）。 */
const HIGH_RISK_ACTIONS = new Set(['auth.refresh.reuse_detected']);

export interface AuditLogRowVM {
  id: string;
  occurredAt: Date;
  actorEmail: string;
  action: string;
  isHighRisk: boolean;
  /** `resourceType · resourceName`；沒有名稱時只有類型 */
  resourceLabel: string;
  isSuccess: boolean;
  errorCode: string | null;
}

/** 展開列才取的明細（列表 API 不回 `changes` / `metadata`）。 */
export interface AuditLogDetailVM {
  changes: Record<string, unknown>;
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
    isSuccess: dto.result === 'success',
    errorCode: dto.errorCode,
  };
}

export function toAuditLogDetailVM(dto: AuditLog): AuditLogDetailVM {
  return {
    changes: dto.changes ?? {},
    metadata: dto.metadata ?? {},
  };
}
