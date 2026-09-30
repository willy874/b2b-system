import type { PlatformAdmin, PlatformProfile } from '@/shared/api-sdk';

/** 頁面測試共用的平台管理者。 */
export function platformAdminFixture(overrides: Partial<PlatformAdmin> = {}): PlatformAdmin {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    email: 'operator@platform.test',
    displayName: '營運小明',
    role: 'operator',
    status: 'active',
    lastLoginAt: '2026-09-30T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 登入中的平台管理者（用來判斷「這一列是不是自己」）。 */
export function platformProfileFixture(admin: PlatformAdmin): PlatformProfile {
  return {
    admin: {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      status: admin.status,
      lastLoginAt: admin.lastLoginAt,
      role: admin.role,
    },
    permissions: [],
  };
}
