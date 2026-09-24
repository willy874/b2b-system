// 由 api-sdk codegen 產生，請勿手動編輯。
// 來源：Game Editor API 0.0.0（OpenAPI 3.0.0）

export interface AuditLog {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceName: string | null;
  result: 'success' | 'failure';
  errorCode: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface CreateUserRequest {
  email: string;
  username?: string;
  displayName: string;
  roleIds: Array<string>;
}

export interface UpdateUserRequest {
  username?: string | null;
  displayName?: string;
  status?: 'pending' | 'active' | 'inactive';
  locale?: string;
  timezone?: string;
}

export interface ReplaceUserRolesRequest {
  roleIds: Array<string>;
}

export const UserStatus = {
  pending: 'pending',
  active: 'active',
  inactive: 'inactive',
  locked: 'locked',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export interface RoleSummary {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
}

export interface User {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
  status: UserStatus;
  roles: Array<RoleSummary>;
  locale: string;
  timezone: string;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRoles {
  roles: Array<RoleSummary>;
}

export const PermissionKey = {
  'user:create': 'user:create',
  'user:read': 'user:read',
  'user:update': 'user:update',
  'user:delete': 'user:delete',
  'user:assignRole': 'user:assignRole',
  'user:resetPassword': 'user:resetPassword',
  'role:create': 'role:create',
  'role:read': 'role:read',
  'role:update': 'role:update',
  'role:delete': 'role:delete',
  'role:grantPermission': 'role:grantPermission',
  'permission:read': 'permission:read',
  'auditLog:read': 'auditLog:read',
  'system:read': 'system:read',
  'system:update': 'system:update',
} as const;
export type PermissionKey = (typeof PermissionKey)[keyof typeof PermissionKey];

export interface Permission {
  id: string;
  key: PermissionKey;
  resource: string;
  action: string;
  nameI18nKey: string;
  description: string | null;
  sortOrder: number;
}

export interface PermissionGroup {
  resource: string;
  nameI18nKey: string;
  keys: Array<PermissionKey>;
}

export interface PermissionCatalog {
  items: Array<Permission>;
  groups: Array<PermissionGroup>;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface Session {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface Profile {
  user: {
    id: string;
    email: string;
    username: string | null;
    displayName: string;
    status: UserStatus;
    lastLoginAt: string | null;
    preferences: {
      locale: string;
      timezone: string;
    };
  };
  roles: Array<RoleSummary>;
  permissions: Array<PermissionKey>;
}

export interface UpdateProfileRequest {
  displayName?: string;
  preferences?: {
    locale?: string;
    timezone?: string;
  };
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface SetupRequest {
  token: string;
  password: string;
}

export interface CreateRoleRequest {
  name: string;
  description?: string;
  permissionKeys: Array<PermissionKey>;
}

export interface DuplicateRoleRequest {
  name?: string;
}

export interface Role {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCount: number;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RolePermissions {
  permissions: Array<Permission>;
}

export interface RoleHolder {
  id: string;
  email: string;
  displayName: string;
  status: 'pending' | 'active' | 'inactive' | 'locked';
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string | null;
}

export interface UpdateRolePermissionsRequest {
  add: Array<PermissionKey>;
  remove: Array<PermissionKey>;
}
