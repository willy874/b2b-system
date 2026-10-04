import type { PlatformProfile, PlatformTenant } from '@/shared/api-sdk';

type PlatformRole = PlatformProfile['admin']['role'];
type TenantStatus = PlatformTenant['status'];

export const HOME_ROLE_LABEL_KEY = {
  'super-admin': 'home.role.superAdmin',
  operator: 'home.role.operator',
  auditor: 'home.role.auditor',
} as const satisfies Record<PlatformRole, string>;

/** 首頁的租戶概況依這個順序列出：需要處理的（失敗、佈建中）排在前面。 */
export const TENANT_OVERVIEW_STATUSES = [
  'failed',
  'provisioning',
  'active',
  'disabled',
] as const satisfies readonly TenantStatus[];

export const TENANT_OVERVIEW_LABEL_KEY = {
  failed: 'home.tenants.failed',
  provisioning: 'home.tenants.provisioning',
  active: 'home.tenants.active',
  disabled: 'home.tenants.disabled',
} as const satisfies Record<TenantStatus, string>;
