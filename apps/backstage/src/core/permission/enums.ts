import { PermissionKey as ApiPermissionKey } from '@/shared/api-sdk';

/**
 * 整個 app 只有這個檔案為了權限而碰 api-sdk。
 * 後端的 `PERMISSION_SEED` 是唯一來源，這裡只是它的投影（docs/architecture/backend/03-api-conventions.md §12）。
 */
export const PermissionKey = ApiPermissionKey;
export type PermissionKey = (typeof PermissionKey)[keyof typeof PermissionKey];

export const ALL_PERMISSION_KEYS = Object.values(PermissionKey) as PermissionKey[];

const KEY_SET: ReadonlySet<string> = new Set(ALL_PERMISSION_KEYS);

/**
 * 字串是不是這個 app 的權限鍵。權限樹、下拉選單這類以字串為節點 id 的元件，回傳值在邊界以它收窄，
 * 不以轉型硬塞給 SDK 要求的 `PermissionKey[]`（寫錯的鍵在這裡被濾掉，而不是等後端回 400）。
 */
export const isPermissionKey = (value: string): value is PermissionKey => KEY_SET.has(value);
