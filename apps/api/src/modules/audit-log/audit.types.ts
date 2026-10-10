import { RESOURCE_TYPE } from '@/core/resource';
import type { AuditChanges, AuditMetadata, AuditResult } from '@/db/schema';

/**
 * 租戶稽核的 `resource_type`（docs/architecture/backend/06-audit-log.md §7）：跨模組的資源類型，加上不是實體的分類
 * （登入、授權、系統設定、政策…）。`AuditInput` 以它限制型別，新增一種時這裡沒補就編譯失敗；
 * 稽核列表的篩選以 openapi 的 enum 給前端，前端的選項表也以它列舉。
 */
export const AUDIT_RESOURCE_TYPES = [
  ...Object.values(RESOURCE_TYPE),
  'auth',
  'authz',
  'auditLog',
  'dataTransfer',
  'identityProvider',
  'job',
  'mfaPolicy',
  'notificationPolicy',
  'setting',
] as const;

export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export interface AuditInput {
  action: string;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  resourceName?: string | null;
  result?: AuditResult;
  errorCode?: string | null;
  changes?: AuditChanges | null;
  metadata?: AuditMetadata;
  actorId?: string | null;
  actorEmail?: string;
}
