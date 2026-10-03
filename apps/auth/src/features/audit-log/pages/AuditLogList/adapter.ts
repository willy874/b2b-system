import type { PlatformAuditLog } from '@/shared/api-sdk';

export interface AuditLogRowVM {
  id: string;
  occurredAt: Date;
  actorEmail: string;
  action: string;
  resourceType: string;
  /** 資源 id；沒有特定資源（例：登入失敗）時是 `null` */
  resourceId: string | null;
  result: PlatformAuditLog['result'];
  isSuccess: boolean;
  errorCode: string | null;
  /** 展開列顯示的附加資訊；沒有時是 `null`（列表已帶，不必再向後端取） */
  metadata: Record<string, unknown> | null;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toAuditLogRowVM(dto: PlatformAuditLog): AuditLogRowVM {
  return {
    id: dto.id,
    occurredAt: new Date(dto.occurredAt),
    actorEmail: dto.actorEmail,
    action: dto.action,
    resourceType: dto.resourceType,
    resourceId: dto.resourceId,
    result: dto.result,
    isSuccess: dto.result === 'success',
    errorCode: dto.errorCode,
    metadata: dto.metadata,
  };
}
