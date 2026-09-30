import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/common/types';
import type { AuthzService, TenantPermissions } from '@/core/authz';
import type { PermissionCacheService } from '@/core/cache';
import { permissionClosure } from '@/db/seeds/permissions';

import type { PermissionRepository } from '../permission.repository';
import { PermissionService } from '../permission.service';

/** 假的關係圖：每個人的明確鍵由 `keysOf` 決定，解析結果是它的依賴閉包。 */
function fakeAuthz(keysOf: (userId: string) => { keys: PermissionKey[]; isSuperAdmin: boolean }) {
  return {
    tenantPermissionsOf: vi.fn(async (ids: readonly string[]) => {
      return new Map<string, TenantPermissions>(
        ids.map((id) => {
          const { keys, isSuperAdmin } = keysOf(id);
          return [
            id,
            {
              explicit: new Set(keys),
              effective: permissionClosure(keys),
              isSuperAdmin,
              subjects: [`user:${id}`],
            },
          ];
        }),
      );
    }),
  };
}

const ALL_KEYS = ['user:read', 'user:assignRole', 'system:update'] as PermissionKey[];

function createService(actor: { keys: PermissionKey[]; isSuperAdmin: boolean }) {
  const repo = {
    findAllPermissionKeys: vi.fn().mockResolvedValue(ALL_KEYS),
    findPermissionKeysByRoles: vi.fn().mockResolvedValue([]),
    includesSuperAdminRole: vi.fn().mockResolvedValue(false),
  };
  const cache = { get: vi.fn(), set: vi.fn(), ticket: vi.fn(() => 0) };
  const service = new PermissionService(
    repo as unknown as PermissionRepository,
    cache as unknown as PermissionCacheService,
    fakeAuthz(() => actor) as unknown as AuthzService,
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

function createBatchService(cached: Record<string, { keys: PermissionKey[] }> = {}) {
  const authz = fakeAuthz((id) => ({
    keys: id === 'u1' ? ['user:read'] : [],
    isSuperAdmin: id === 'root',
  }));
  const cache = {
    get: vi.fn((id: string) =>
      cached[id] ? { permissions: new Set(cached[id].keys), isSuperAdmin: false } : undefined,
    ),
    set: vi.fn(),
    ticket: vi.fn(() => 0),
  };
  const service = new PermissionService(
    {} as PermissionRepository,
    cache as unknown as PermissionCacheService,
    authz as unknown as AuthzService,
  );
  return { service, authz, cache };
}

describe('PermissionService.getPermissionSets（批次解析）', () => {
  it('多人一次解析：每人一個集合，沒有角色的人是空集合，super-admin 有標記', async () => {
    const { service, authz } = createBatchService();

    const sets = await service.getPermissionSets(['u1', 'u2', 'root', 'u1']);

    expect(authz.tenantPermissionsOf).toHaveBeenCalledTimes(1);
    expect(authz.tenantPermissionsOf.mock.calls[0]?.[0]).toEqual(['u1', 'u2', 'root']);
    expect([...sets.keys()]).toEqual(['u1', 'u2', 'root']);
    expect([...sets.get('u1')!.permissions]).toEqual(['user:read']);
    expect(sets.get('u2')?.permissions).toEqual(new Set());
    expect(sets.get('root')?.isSuperAdmin).toBe(true);
  });

  it('權限是依賴樹的閉包：file:delete 帶來 file:update、file:read、file:access', async () => {
    const authz = fakeAuthz(() => ({ keys: ['file:delete'], isSuperAdmin: false }));
    const service = new PermissionService(
      {} as PermissionRepository,
      { get: vi.fn(), set: vi.fn(), ticket: vi.fn(() => 0) } as unknown as PermissionCacheService,
      authz as unknown as AuthzService,
    );
    const { permissions } = await service.getPermissionSet('u1');
    expect([...permissions].toSorted()).toEqual([
      'file:access',
      'file:delete',
      'file:read',
      'file:update',
    ]);
  });

  it('快取命中的人不查 DB，查到的寫回快取', async () => {
    const { service, authz, cache } = createBatchService({ u1: { keys: ['role:read'] } });

    const sets = await service.getPermissionSets(['u1', 'u2']);

    expect(authz.tenantPermissionsOf.mock.calls[0]?.[0]).toEqual(['u2']);
    expect([...sets.get('u1')!.permissions]).toEqual(['role:read']);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      'u2',
      expect.objectContaining({ permissions: new Set(), isSuperAdmin: false }),
      0,
    );
  });

  it('全部命中快取時不查 DB', async () => {
    const { service, authz } = createBatchService({ u1: { keys: [] } });
    await service.getPermissionSets(['u1']);
    expect(authz.tenantPermissionsOf).not.toHaveBeenCalled();
  });

  it('超過一批的上限就分批查詢', async () => {
    const { service, authz } = createBatchService();
    const ids = Array.from({ length: 1200 }, (_, index) => `x${index}`);

    const sets = await service.getPermissionSets(ids);

    const batches = authz.tenantPermissionsOf.mock.calls.map(([batch]) => batch.length);
    expect(batches).toEqual([500, 500, 200]);
    expect(sets.size).toBe(1200);
  });
});

describe('PermissionService.assertNoSelfLockout（docs/architecture/backend/05-rbac.md §8.4）', () => {
  const GUARDED = ['role:update', 'role:grantPermission'] as PermissionKey[];

  function createLockoutService(options: {
    keys: PermissionKey[];
    isSuperAdmin?: boolean;
    holdsRole?: boolean;
    otherRoleKeys?: PermissionKey[];
  }) {
    const { service, repo } = createService({
      keys: options.keys,
      isSuperAdmin: options.isSuperAdmin ?? false,
    });
    const extra = {
      userHasRole: vi.fn().mockResolvedValue(options.holdsRole ?? true),
      findPermissionKeysByUserExcludingRole: vi.fn().mockResolvedValue(options.otherRoleKeys ?? []),
    };
    Object.assign(repo, extra);
    return { service, repo: { ...repo, ...extra } };
  }

  it('移除自己角色上唯一來源的管理權限 → ROLE_SELF_LOCKOUT 帶出失去的權限', async () => {
    const { service } = createLockoutService({ keys: GUARDED });
    await expect(
      service.assertNoSelfLockout('actor', 'r1', ['role:update'], GUARDED),
    ).rejects.toMatchObject({
      code: 'ROLE_SELF_LOCKOUT',
      details: { lost: ['role:grantPermission'] },
    });
  });

  it('刪除（變成空集合）自己唯一的管理角色 → ROLE_SELF_LOCKOUT', async () => {
    const { service } = createLockoutService({ keys: GUARDED });
    await expect(service.assertNoSelfLockout('actor', 'r1', [], GUARDED)).rejects.toMatchObject({
      code: 'ROLE_SELF_LOCKOUT',
    });
  });

  it('剩下的鍵經依賴樹仍帶回被拿掉的權限 → 通過（role:delete 包含 role:update）', async () => {
    const { service } = createLockoutService({ keys: ['role:update', 'role:delete'] });
    await expect(
      service.assertNoSelfLockout('actor', 'r1', ['role:delete'], ['role:update']),
    ).resolves.toBeUndefined();
  });

  it('其他角色仍提供同樣的權限 → 通過', async () => {
    const { service } = createLockoutService({ keys: GUARDED, otherRoleKeys: GUARDED });
    await expect(service.assertNoSelfLockout('actor', 'r1', [], GUARDED)).resolves.toBeUndefined();
  });

  it('沒有持有這個角色 → 通過，不查其他角色', async () => {
    const { service, repo } = createLockoutService({ keys: GUARDED, holdsRole: false });
    await expect(service.assertNoSelfLockout('actor', 'r1', [], GUARDED)).resolves.toBeUndefined();
    expect(repo.findPermissionKeysByUserExcludingRole).not.toHaveBeenCalled();
  });

  it('本來就沒有那些管理權限 → 通過，不查角色', async () => {
    const { service, repo } = createLockoutService({ keys: ['user:read'] });
    await expect(service.assertNoSelfLockout('actor', 'r1', [], GUARDED)).resolves.toBeUndefined();
    expect(repo.userHasRole).not.toHaveBeenCalled();
  });

  it('super-admin 豁免', async () => {
    const { service, repo } = createLockoutService({ keys: [], isSuperAdmin: true });
    await expect(service.assertNoSelfLockout('actor', 'r1', [], GUARDED)).resolves.toBeUndefined();
    expect(repo.userHasRole).not.toHaveBeenCalled();
  });
});

describe('PermissionService.describeRolePermissions（技能樹用，docs/rbac/02-permission-catalog.md §9）', () => {
  const service = new PermissionService(
    {} as PermissionRepository,
    {} as PermissionCacheService,
    {} as AuthzService,
  );

  it('明確的鍵標 explicit；依賴樹帶出的標 implied 並列出來源，依目錄順序', () => {
    const effective = service.describeRolePermissions(['file:delete', 'file:read'], false);
    expect(effective).toEqual([
      { key: 'file:read', source: 'explicit', impliedBy: ['file:delete'] },
      { key: 'file:update', source: 'implied', impliedBy: ['file:delete'] },
      { key: 'file:delete', source: 'explicit', impliedBy: [] },
      { key: 'file:access', source: 'implied', impliedBy: ['file:delete', 'file:read'] },
    ]);
  });

  it('super-admin：全集、都算隱含', () => {
    const effective = service.describeRolePermissions([], true);
    expect(effective).toHaveLength(29);
    expect(effective.every((entry) => entry.source === 'implied')).toBe(true);
  });
});
