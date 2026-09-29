import { PermissionKey as ApiPermissionKey } from '@/shared/api-sdk';

/**
 * 整個 app 只有這個檔案為了權限而碰 api-sdk。
 * 後端的 `PERMISSION_SEED` 是唯一來源，這裡只是它的投影（ADR-0007）。
 */
export const PermissionKey = ApiPermissionKey;
export type PermissionKey = (typeof PermissionKey)[keyof typeof PermissionKey];

export const ALL_PERMISSION_KEYS = Object.values(PermissionKey) as PermissionKey[];
