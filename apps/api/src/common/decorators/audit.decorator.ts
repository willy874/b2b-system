import { SetMetadata } from '@nestjs/common';

export const AUDIT_METADATA = 'audit:metadata';

export interface AuditMetadataOptions {
  action: string;
  resourceType: string;
  /** 從哪個 param 取 resourceId，預設 `id`。 */
  resourceIdParam?: string;
}

/**
 * 單純 CRUD 的稽核可以宣告在 handler 上由 `AuditInterceptor` 寫入；
 * 需要 before/after 差異或交易一致性的，仍由 service 主動寫。
 */
export const Audit = (options: AuditMetadataOptions) => SetMetadata(AUDIT_METADATA, options);
