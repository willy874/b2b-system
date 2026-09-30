import type { PlatformTenant } from '@/shared/api-sdk';

type TenantStatus = PlatformTenant['status'];

export const TENANT_STATUS_LABEL_KEY = {
  provisioning: 'tenant.status.provisioning',
  active: 'tenant.status.active',
  disabled: 'tenant.status.disabled',
  failed: 'tenant.status.failed',
} as const satisfies Record<TenantStatus, string>;

/** 狀態點的顏色走 design token（CLAUDE.md 前端規則 6）。 */
export const TENANT_STATUS_DOT_CLASS = {
  provisioning: 'bg-[var(--color-warning)]',
  active: 'bg-[var(--color-success)]',
  disabled: 'bg-[var(--color-fg-muted)]',
  failed: 'bg-[var(--color-danger)]',
} as const satisfies Record<TenantStatus, string>;

export const TENANT_PAGE_SIZE_OPTIONS = [25, 50, 100];

/** 狀態篩選的「全部」：不帶 `status` 參數。 */
export const TENANT_STATUS_ALL = 'all';

/** 與後端 `TENANT_CODE_PATTERN` 相同：小寫英數與連字號，3–32 字元，開頭是字母。 */
export const TENANT_CODE_PATTERN = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

/** 與後端 `RESERVED_TENANT_CODES` 相同：會與部署用的子網域撞在一起。 */
export const RESERVED_TENANT_CODES: ReadonlySet<string> = new Set([
  'api',
  'auth',
  'www',
  'admin',
  'platform',
  'static',
  'storage',
  'mail',
]);

/** 與後端 `TenantDomainSchema` 相同：主機名稱，可以帶 port。 */
export const TENANT_DOMAIN_PATTERN =
  /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;
