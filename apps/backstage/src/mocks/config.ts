import { ENV } from '@/shared/constants';

export const MOCK_API_BASE = ENV.API_BASE_URL;

/** handler 依情境回不同的權限集合，才測得到 gating。 */
export const mockState = {
  permissions: [
    'user:create',
    'user:read',
    'user:update',
    'user:delete',
    'user:assignRole',
    'user:resetPassword',
    'user:resetMfa',
    'role:create',
    'role:read',
    'role:update',
    'role:delete',
    'role:grantPermission',
    'permission:read',
    'auditLog:read',
    'system:read',
    'system:update',
    'approval:read',
    'approval:review',
    'notification:read',
  ] as string[],
};

export function setMockPermissions(permissions: string[]): void {
  mockState.permissions = permissions;
}
