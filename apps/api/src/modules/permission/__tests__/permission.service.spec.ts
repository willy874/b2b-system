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

describe('PermissionService.getPermissionSets（批次解析，docs/issues/01-performance.md PERF-08）', () => {
  function createBatchService(cached: Record<string, { keys: PermissionKey[] }> = {}) {
    const repo = {
      findPermissionKeysByUsers: vi.fn(async (ids: readonly string[]) =>
        ids.includes('u1') ? [{ userId: 'u1', key: 'user:read' as PermissionKey }] : [],
      ),
      findSuperAdminUserIds: vi.fn(async (ids: readonly string[]) =>
        ids.filter((id) => id === 'root'),
      ),
    };
    const cache = {
      get: vi.fn((id: string) =>
        cached[id] ? { permissions: new Set(cached[id].keys), isSuperAdmin: false } : undefined,
      ),
      set: vi.fn(),
    };
    const service = new PermissionService(
      repo as unknown as PermissionRepository,
      cache as unknown as PermissionCacheService,
    );
    return { service, repo, cache };
  }

  it('多人只查一次：每人一個集合，沒有角色的人是空集合，super-admin 有標記', async () => {
    const { service, repo } = createBatchService();

    const sets = await service.getPermissionSets(['u1', 'u2', 'root', 'u1']);

    expect(repo.findPermissionKeysByUsers).toHaveBeenCalledTimes(1);
    expect(repo.findPermissionKeysByUsers).toHaveBeenCalledWith(['u1', 'u2', 'root']);
    expect([...sets.keys()]).toEqual(['u1', 'u2', 'root']);
    expect([...sets.get('u1')!.permissions]).toEqual(['user:read']);
    expect(sets.get('u2')).toEqual({ permissions: new Set(), isSuperAdmin: false });
    expect(sets.get('root')?.isSuperAdmin).toBe(true);
  });

  it('快取命中的人不查 DB，查到的寫回快取', async () => {
    const { service, repo, cache } = createBatchService({ u1: { keys: ['role:read'] } });

    const sets = await service.getPermissionSets(['u1', 'u2']);

    expect(repo.findPermissionKeysByUsers).toHaveBeenCalledWith(['u2']);
    expect([...sets.get('u1')!.permissions]).toEqual(['role:read']);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith('u2', { permissions: new Set(), isSuperAdmin: false });
  });

  it('全部命中快取時不查 DB', async () => {
    const { service, repo } = createBatchService({ u1: { keys: [] } });
    await service.getPermissionSets(['u1']);
    expect(repo.findPermissionKeysByUsers).not.toHaveBeenCalled();
    expect(repo.findSuperAdminUserIds).not.toHaveBeenCalled();
  });

  it('超過一批的上限就分批查詢', async () => {
    const { service, repo } = createBatchService();
    const ids = Array.from({ length: 1200 }, (_, index) => `x${index}`);

    const sets = await service.getPermissionSets(ids);

    const batches = repo.findPermissionKeysByUsers.mock.calls.map(([batch]) => batch.length);
    expect(batches).toEqual([500, 500, 200]);
    expect(sets.size).toBe(1200);
  });
});
