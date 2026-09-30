import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/common/types';
import type { PermissionCacheService } from '@/core/cache';

import type { PermissionRepository } from '../permission.repository';
import { PermissionService } from '../permission.service';

const ALL_KEYS = ['user:read', 'user:assignRole', 'system:update'] as PermissionKey[];

function createService(actor: { keys: PermissionKey[]; isSuperAdmin: boolean }) {
  const repo = {
    findPermissionKeysByUser: vi.fn().mockResolvedValue(actor.keys),
    isSuperAdmin: vi.fn().mockResolvedValue(actor.isSuperAdmin),
    findAllPermissionKeys: vi.fn().mockResolvedValue(ALL_KEYS),
    findPermissionKeysByRoles: vi.fn().mockResolvedValue([]),
    includesSuperAdminRole: vi.fn().mockResolvedValue(false),
  };
  const cache = { get: vi.fn(), set: vi.fn(), ticket: vi.fn(() => 0) };
  const service = new PermissionService(
    repo as unknown as PermissionRepository,
    cache as unknown as PermissionCacheService,
  );
  return { service, repo };
}

describe('PermissionService.assertRolesAssignable（docs/architecture/backend/05-rbac.md §4.1）', () => {
  let admin: ReturnType<typeof createService>;

  beforeEach(() => {
    admin = createService({ keys: ['user:read', 'user:assignRole'], isSuperAdmin: false });
  });

  it('角色帶的權限都已持有 → 通過', async () => {
    admin.repo.findPermissionKeysByRoles.mockResolvedValue(['user:read']);
    await expect(admin.service.assertRolesAssignable('actor', ['r1'])).resolves.toBeUndefined();
  });

  it('角色帶有未持有的權限 → AUTHZ_ESCALATION 帶出缺少的權限', async () => {
    admin.repo.findPermissionKeysByRoles.mockResolvedValue(['system:update']);
    await expect(admin.service.assertRolesAssignable('actor', ['r1'])).rejects.toMatchObject({
      code: 'AUTHZ_ESCALATION',
      details: { missing: ['system:update'] },
    });
  });

  it('非 super-admin 指派 super-admin 角色 → AUTHZ_ESCALATION 帶出 role 與缺少的全集', async () => {
    admin.repo.includesSuperAdminRole.mockResolvedValue(true);
    await expect(admin.service.assertRolesAssignable('actor', ['sa'])).rejects.toMatchObject({
      code: 'AUTHZ_ESCALATION',
      details: { role: 'super-admin', missing: ['system:update'] },
    });
  });

  it('持有目錄中每個權限鍵，仍不能指派 super-admin 角色', async () => {
    const holder = createService({ keys: ALL_KEYS, isSuperAdmin: false });
    holder.repo.includesSuperAdminRole.mockResolvedValue(true);
    await expect(holder.service.assertRolesAssignable('actor', ['sa'])).rejects.toMatchObject({
      code: 'AUTHZ_ESCALATION',
      details: { role: 'super-admin', missing: [] },
    });
  });

  it('super-admin 可以指派 super-admin 角色', async () => {
    const root = createService({ keys: [], isSuperAdmin: true });
    root.repo.includesSuperAdminRole.mockResolvedValue(true);
    await expect(root.service.assertRolesAssignable('actor', ['sa'])).resolves.toBeUndefined();
  });

  it('空的角色清單不查詢任何東西', async () => {
    await admin.service.assertRolesAssignable('actor', []);
    expect(admin.repo.includesSuperAdminRole).not.toHaveBeenCalled();
  });
});
