import { usePagePermission } from '@/core/permission';

import { AUDIT_LOG_PAGE } from '../permission';

export function useAuditLogPermission() {
  return usePagePermission(AUDIT_LOG_PAGE);
}
