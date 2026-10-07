/**
 * 租戶資料的初始內容：權限目錄、系統角色、第一位管理員。`db:seed`（CLI）與租戶佈建（api 程序的背景工作）共用，
 * 所以這裡不讀 `.env`、不用 `console`，結果以回傳值交給呼叫端記錄（docs/coding-standards/07-layer-dependencies.md §3.2 註 1）。
 */
export type { PermissionCatalogResult, SystemRoleResult } from './catalog';
export { grantPermissions, seedPermissions, seedRoles } from './catalog';
export { recordRoleBaseline } from './role-baseline';
export { countSuperAdmins, seedTenantAdmin } from './tenant-admin';
