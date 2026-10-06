import type { PermissionKey as AppPermissionKey } from './enums';
import type { PermissionResource as AppPermissionResource } from './resources';

/**
 * 權限的機制（hooks、頁面權限註冊表、`evaluateAccess`）在 `@b2b-system/web-core/permission`；
 * 這個 app 的權限目錄（`PermissionKey`、`PermissionResource`）在這裡，並登記給 package，
 * 讓 package 的型別收斂成這個 app 的鍵（`register.ts` 的說明）。
 * 本地的具名匯出優先於 `export *`，所以 `PermissionKey` 是這裡的常數物件。
 */
declare module '@b2b-system/web-core/permission/register' {
  interface PermissionRegister {
    key: AppPermissionKey;
    resource: AppPermissionResource;
  }
}

export * from '@b2b-system/web-core/permission';
export { ALL_PERMISSION_KEYS, isPermissionKey, PermissionKey } from './enums';
export { PermissionResource } from './resources';
