import type { PermissionKey } from './permissions';

export interface RoleSeed {
  slug: string;
  name: string;
  description: string;
  isSystem: true;
  /** 角色只能含同範圍的權限鍵（docs/adr/0018-workspace-tenancy.md D3）。 */
  scope: 'platform' | 'workspace';
  /** `'*'` 代表隱含全集，不寫入 role_permissions。 */
  permissions: '*' | readonly PermissionKey[];
}

export const ROLE_SEED: readonly RoleSeed[] = [
  {
    slug: 'super-admin',
    name: '超級管理員',
    description: '系統最高權限，繞過所有權限檢查（含所有工作區）。不可刪除、不可調整權限。',
    isSystem: true,
    scope: 'platform',
    permissions: '*',
  },
  {
    slug: 'admin',
    name: '系統管理員',
    description: '管理使用者、角色、權限與工作區。看不到工作區裡的內容。',
    isSystem: true,
    scope: 'platform',
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
      'approval:read',
      'approval:review',
      'job:read',
      'job:retry',
      'workspace:create',
      'workspace:read',
      'workspace:update',
      'workspace:delete',
    ],
  },
  {
    slug: 'auditor',
    name: '稽核人員',
    description: '唯讀存取使用者、角色、工作區清單與稽核日誌。',
    isSystem: true,
    scope: 'platform',
    permissions: [
      'user:read',
      'role:read',
      'permission:read',
      'auditLog:read',
      'system:read',
      'approval:read',
      'job:read',
      'workspace:read',
    ],
  },
  {
    slug: 'member',
    name: '一般成員',
    description: '個人頁面。平台層級功能的權限掛載點；工作區內的權限由工作區角色決定。',
    isSystem: true,
    scope: 'platform',
    permissions: [],
  },
  {
    slug: 'workspace-admin',
    name: '工作區管理員',
    description: '管理工作區的成員與角色，存取工作區裡的所有檔案。',
    isSystem: true,
    scope: 'workspace',
    permissions: [
      'file:create',
      'file:read',
      'file:update',
      'file:delete',
      'file:share',
      // workspace-member 有 file:access：要持有它才能指派 workspace-member（反提權）
      'file:access',
      'workspaceMember:read',
      'workspaceMember:create',
      'workspaceMember:delete',
      'workspaceMember:assignRole',
    ],
  },
  {
    slug: 'workspace-member',
    name: '工作區成員',
    description: '進入檔案管理器；能看到、能做什麼由資料夾授權決定。',
    isSystem: true,
    scope: 'workspace',
    // 範圍由資料夾授權決定（docs/rbac/07-resource-grants.md）
    permissions: ['file:access', 'workspaceMember:read'],
  },
  {
    slug: 'workspace-viewer',
    name: '工作區檢視者',
    description: '唯讀存取工作區裡的所有檔案與成員清單。',
    isSystem: true,
    scope: 'workspace',
    permissions: ['file:read', 'workspaceMember:read'],
  },
] as const;

/** 建立工作區時指定的第一位管理員取得這個角色（docs/adr/0018-workspace-tenancy.md D13）。 */
export const WORKSPACE_ADMIN_SLUG = 'workspace-admin';
