/**
 * 各 app 的權限目錄不同（backstage 是租戶的、apps/platform 是平台的，docs/architecture/iam/02-permission-catalog.md），
 * 這個 package 只認得「某個字串型別」。app 以 module augmentation 登記自己的目錄，之後 `usePermission`、
 * `PagePermissionRule` 等型別在那個 app 裡就收斂成它的權限鍵：
 *
 * ```ts
 * declare module '@b2b-system/web-core/permission/register' {
 *   interface PermissionRegister {
 *     key: AppPermissionKey;
 *     resource: AppPermissionResource;
 *   }
 * }
 * ```
 *
 * 沒登記時（package 自己的型別檢查與測試）兩者都退回 `string`。
 */
// oxlint-disable-next-line typescript/no-empty-interface -- 給 app 以 declaration merging 擴充
export interface PermissionRegister {}

export type PermissionKey = PermissionRegister extends { key: infer K extends string } ? K : string;
export type PermissionResource = PermissionRegister extends { resource: infer R extends string }
  ? R
  : string;
