import { PlatformPermissionKey as ApiPermissionKey } from '@/shared/api-sdk';

/**
 * 整個 app 只有這個檔案為了權限而碰 api-sdk。
 * apps/auth 只給平台管理者用：權限鍵是 **平台** 的目錄（docs/rbac/02-permission-catalog.md §8、
 * 後端的 `PLATFORM_PERMISSION_SEED`），不是 backstage 的租戶目錄（docs/architecture/backend/03-api-conventions.md §12、docs/architecture/05-tenancy.md §10.2 D5）。
 */
export const PermissionKey = ApiPermissionKey;
export type PermissionKey = (typeof PermissionKey)[keyof typeof PermissionKey];

export const ALL_PERMISSION_KEYS = Object.values(PermissionKey) as PermissionKey[];
