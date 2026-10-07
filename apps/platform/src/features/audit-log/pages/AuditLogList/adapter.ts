import type { AuditLogRowVM } from '@b2b-system/web-core/audit-log';

import type { PlatformAuditLog } from '@/shared/api-sdk';

/** 平台的列表已帶資源 id 與 metadata，展開列直接顯示（不必再向後端取）。 */
export interface PlatformAuditLogRowVM extends AuditLogRowVM {
  resourceType: string;
  /** 資源 id；沒有特定資源（例：登入失敗）時是 `null` */
  resourceId: string | null;
  /** 展開列顯示的附加資訊；沒有時是 `null` */
  metadata: Record<string, unknown> | null;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toAuditLogRowVM(dto: PlatformAuditLog): PlatformAuditLogRowVM {
  return {
    id: dto.id,
    occurredAt: new Date(dto.occurredAt),
    actorEmail: dto.actorEmail,
    action: dto.action,
    // 平台稽核沒有需要特別標示的動作
    isHighRisk: false,
    resourceLabel: dto.resourceType,
    resourceType: dto.resourceType,
    resourceId: dto.resourceId,
    result: dto.result,
    isSuccess: dto.result === 'success',
    errorCode: dto.errorCode,
    metadata: dto.metadata,
  };
}
