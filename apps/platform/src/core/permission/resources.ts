/** 平台的資源（docs/architecture/iam/02-permission-catalog.md §8）；backstage 的這份是租戶的資源。 */
export const PermissionResource = {
  TENANT: 'tenant',
  PLATFORM_ADMIN: 'platformAdmin',
  PLATFORM_AUDIT_LOG: 'platformAuditLog',
  PLATFORM_JOB: 'platformJob',
  FEATURE_FLAG: 'featureFlag',
} as const;
export type PermissionResource = (typeof PermissionResource)[keyof typeof PermissionResource];
