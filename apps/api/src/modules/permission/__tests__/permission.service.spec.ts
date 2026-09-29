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
  const cache = { get: vi.fn(), set: vi.fn() };
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

function createScopedService(options: {
  platform: PermissionKey[];
  scoped: PermissionKey[];
  membership: { exists: boolean; isMember: boolean };
  isSuperAdmin?: boolean;
}) {
  const repo = {
    findPermissionKeysByUser: vi.fn().mockResolvedValue(options.platform),
    isSuperAdmin: vi.fn().mockResolvedValue(options.isSuperAdmin ?? false),
    findWorkspacePermissionKeys: vi.fn().mockResolvedValue(options.scoped),
    findMembership: vi.fn().mockResolvedValue(options.membership),
    findAllPermissionKeys: vi.fn().mockResolvedValue([]),
    findPermissionKeysByRoles: vi.fn().mockResolvedValue([]),
  };
  const cache = { get: vi.fn(), set: vi.fn() };
  const service = new PermissionService(
    repo as unknown as PermissionRepository,
    cache as unknown as PermissionCacheService,
  );
  return { service, repo, cache };
}

describe('PermissionService：工作區範圍（docs/adr/0018-workspace-tenancy.md D4、D5）', () => {
  it('成員：P(u, W) = 平台的鍵 ∪ 這個工作區的鍵，並以工作區為快取範圍', async () => {
    const { service, cache } = createScopedService({
      platform: ['user:read'],
      scoped: ['file:read'],
      membership: { exists: true, isMember: true },
    });
    const set = await service.getWorkspacePermissionSet('u1', 'w1');
    expect([...set.permissions].toSorted()).toEqual(['file:read', 'user:read']);
    expect(set.canEnter).toBe(true);
    expect(cache.set).toHaveBeenLastCalledWith('u1', set, 'w1');
  });

  it('不是成員：進不去，權限集合是空的', async () => {
    const { service } = createScopedService({
      platform: ['user:read'],
      scoped: [],
      membership: { exists: true, isMember: false },
    });
    const set = await service.getWorkspacePermissionSet('u1', 'w1');
    expect(set).toMatchObject({ canEnter: false });
    expect(set.permissions.size).toBe(0);
  });

  it('super-admin：工作區存在就進得去；不存在則否', async () => {
    const root = createScopedService({
      platform: [],
      scoped: [],
      membership: { exists: true, isMember: false },
      isSuperAdmin: true,
    });
    expect((await root.service.getWorkspacePermissionSet('u1', 'w1')).canEnter).toBe(true);
    const gone = createScopedService({
      platform: [],
      scoped: [],
      membership: { exists: false, isMember: false },
      isSuperAdmin: true,
    });
    expect((await gone.service.getWorkspacePermissionSet('u1', 'w1')).canEnter).toBe(false);
  });

  it('角色定義的反提權只比對平台範圍的鍵；指派到工作區時以該工作區的集合比對（D3）', async () => {
    const { service } = createScopedService({
      platform: ['role:grantPermission'],
      scoped: [],
      membership: { exists: true, isMember: true },
    });
    await expect(service.assertGrantable('u1', ['file:read'])).resolves.toBeUndefined();
    await expect(service.assertGrantable('u1', ['file:read'], 'w1')).rejects.toMatchObject({
      code: 'AUTHZ_ESCALATION',
      details: { missing: ['file:read'] },
    });
  });

  it('權限鍵的範圍與角色不符 → ROLE_SCOPE_MISMATCH', () => {
    const { service } = createScopedService({
      platform: [],
      scoped: [],
      membership: { exists: true, isMember: true },
    });
    expect(() => service.assertKeyScope(['file:read'], 'platform')).toThrow(
      expect.objectContaining({ code: 'ROLE_SCOPE_MISMATCH' }),
    );
    expect(() => service.assertKeyScope(['file:read'], 'workspace')).not.toThrow();
  });
});
