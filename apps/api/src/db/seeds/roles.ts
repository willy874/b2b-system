import type { PermissionKey } from './permissions';

export interface RoleSeed {
  slug: string;
  name: string;
  description: string;
  isSystem: true;
  /** `'*'` 代表隱含全集，不寫入 role_permissions。 */
  permissions: '*' | readonly PermissionKey[];
}

export const ROLE_SEED: readonly RoleSeed[] = [
  {
    slug: 'super-admin',
    name: '超級管理員',
    description: '系統最高權限，繞過所有權限檢查。不可刪除、不可調整權限。',
    isSystem: true,
    permissions: '*',
  },
  {
    slug: 'admin',
    name: '系統管理員',
    description: '管理使用者、角色與權限。',
    isSystem: true,
    permissions: [
      'user:create',
      'user:read',
      'user:update',
      'user:delete',
      'user:assignRole',
      'user:resetPassword',
      'role:create',
      'role:read',
      'role:update',
      'role:delete',
      'role:grantPermission',
      'permission:read',
      'auditLog:read',
      'system:read',
    ],
  },
  {
    slug: 'auditor',
    name: '稽核人員',
    description: '唯讀存取使用者、角色與稽核日誌。',
    isSystem: true,
    permissions: ['user:read', 'role:read', 'permission:read', 'auditLog:read', 'system:read'],
  },
  {
    slug: 'member',
    name: '一般成員',
    description: '僅能存取個人頁面。未來功能的權限掛載點。',
    isSystem: true,
    permissions: [],
  },
] as const;
