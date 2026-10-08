import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/common/types';
import type { AuthzRevision, AuthzService, TenantPermissions } from '@/core/authz';
import type { PermissionCacheService } from '@/core/cache';
import type { DbOrTx } from '@/core/database';
import { runWithRequestContext } from '@/core/http';
import type { PermissionRow } from '@/db/schema';
import { permissionClosure } from '@/db/seeds/permissions';
import type { AuditService } from '@/modules/audit-log/audit.service';

import type { PermissionRepository } from '../permission.repository';
import { PermissionService } from '../permission.service';

/** 假的關係圖：每個人的明確鍵由 `keysOf` 決定，解析結果是它的依賴閉包；主體閉包預設只有本人。 */
function fakeAuthz(
  keysOf: (userId: string) => {
    keys: PermissionKey[];
    isSuperAdmin: boolean;
    subjects?: string[];
  },
) {
  return {
    /** 要授予的目標帶來的租戶能力；各測試自己設定（引擎的展開另有整合測試 test/groups.spec.ts）。 */
    grantedCapabilities: vi.fn().mockResolvedValue([]),
    tenantPermissionsOf: vi.fn(async (ids: readonly string[]) => {
      return new Map<string, TenantPermissions>(
        ids.map((id) => {
          const { keys, isSuperAdmin, subjects = [] } = keysOf(id);
          return [
            id,
            {
              explicit: new Set(keys),
              effective: permissionClosure(keys),
              isSuperAdmin,
              subjects: [`user:${id}`, ...subjects],
            },
          ];
        }),
      );
    }),
  };
}

/** 失效與廣播另有整合測試（test/authz-revision.spec.ts）。 */
const REVISION = { changed: vi.fn() } as unknown as AuthzRevision;
/** 只用到 `assertHasAll`／`assertHasAny` 的案例另外建自己的稽核假物件。 */
const NO_AUDIT = {} as AuditService;

const ALL_KEYS = ['user:read', 'user:assignRole', 'system:update'] as PermissionKey[];

function createService(actor: {
  keys: PermissionKey[];
  isSuperAdmin: boolean;
  subjects?: string[];
}) {
  const repo = { findAllPermissionKeys: vi.fn().mockResolvedValue(ALL_KEYS) };
  const cache = { get: vi.fn(), set: vi.fn(), ticket: vi.fn(() => 0) };
  const authz = fakeAuthz(() => actor);
  const audit = { recordSafely: vi.fn(async () => undefined) };
  const service = new PermissionService(
    repo as unknown as PermissionRepository,
    cache as unknown as PermissionCacheService,
    authz as unknown as AuthzService,
    REVISION,
    audit as unknown as AuditService,
  );
  return { service, repo, authz, audit };
}

const TENANT = { type: 'tenant', id: 'self' };
/** 角色帶來的租戶能力（`grantedCapabilities` 的回傳）。 */
const capabilities = (...relations: string[]) =>
  relations.map((relation) => ({ object: TENANT, relation }));

describe('PermissionService.assertRolesAssignable（docs/architecture/backend/05-rbac.md §4.1）', () => {
  let admin: ReturnType<typeof createService>;

  beforeEach(() => {
    admin = createService({ keys: ['user:read', 'user:assignRole'], isSuperAdmin: false });
  });

  it('角色帶的權限都已持有 → 通過；以 role#holder 詢問引擎', async () => {
    admin.authz.grantedCapabilities.mockResolvedValue(capabilities('user:read'));
    await expect(admin.service.assertRolesAssignable('actor', ['r1'])).resolves.toBeUndefined();
    expect(admin.authz.grantedCapabilities).toHaveBeenCalledWith(
      [{ object: { type: 'role', id: 'r1' }, relation: 'holder' }],
      { tx: undefined },
    );
  });

  it('角色帶有未持有的權限 → AUTHZ_ESCALATION 帶出缺少的權限', async () => {
    admin.authz.grantedCapabilities.mockResolvedValue(capabilities('user:read', 'system:update'));
    await expect(admin.service.assertRolesAssignable('actor', ['r1'])).rejects.toMatchObject({
      code: 'AUTHZ_ESCALATION',
      details: { missing: ['system:update'] },
    });
  });

  it('非 super-admin 指派 super-admin 角色 → AUTHZ_ESCALATION 帶出 role 與缺少的全集', async () => {
    admin.authz.grantedCapabilities.mockResolvedValue(capabilities('superAdmin'));
    await expect(admin.service.assertRolesAssignable('actor', ['sa'])).rejects.toMatchObject({
      code: 'AUTHZ_ESCALATION',
      details: { role: 'super-admin', missing: ['system:update'] },
    });
  });

  it('持有目錄中每個權限鍵，仍不能指派 super-admin 角色', async () => {
    const holder = createService({ keys: ALL_KEYS, isSuperAdmin: false });
    holder.authz.grantedCapabilities.mockResolvedValue(capabilities('superAdmin'));
    await expect(holder.service.assertRolesAssignable('actor', ['sa'])).rejects.toMatchObject({
      code: 'AUTHZ_ESCALATION',
      details: { role: 'super-admin', missing: [] },
    });
  });

  it('super-admin 可以指派 super-admin 角色', async () => {
    const root = createService({ keys: [], isSuperAdmin: true });
    root.authz.grantedCapabilities.mockResolvedValue(capabilities('superAdmin'));
    await expect(root.service.assertRolesAssignable('actor', ['sa'])).resolves.toBeUndefined();
  });

  it('空的角色清單不查詢任何東西', async () => {
    await admin.service.assertRolesAssignable('actor', []);
    expect(admin.authz.grantedCapabilities).not.toHaveBeenCalled();
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
    REVISION,
    NO_AUDIT,
  );
  return { service, authz, cache };
}

describe('PermissionService.getPermissionSet（交易內，docs/architecture/backend/02-database.md §6.2）', () => {
  it('帶 tx、快取沒命中：以同一個交易查，不寫回快取（可能含這個交易自己的寫入）', async () => {
    const cache = { get: vi.fn(), set: vi.fn(), ticket: vi.fn(() => 0) };
    const authz = fakeAuthz(() => ({
      keys: ['user:read'] as PermissionKey[],
      isSuperAdmin: false,
    }));
    const service = new PermissionService(
      {} as PermissionRepository,
      cache as unknown as PermissionCacheService,
      authz as unknown as AuthzService,
      REVISION,
      NO_AUDIT,
    );
    const tx = { name: 'tx' } as unknown as DbOrTx;
    const { permissions } = await service.getPermissionSet('u1', tx);
    expect(permissions.has('user:read')).toBe(true);
    expect(authz.tenantPermissionsOf).toHaveBeenCalledWith(['u1'], { withDependencies: true, tx });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('帶 tx、快取命中：直接用快取，不查', async () => {
    const cached = { permissions: new Set(['user:read']), isSuperAdmin: false, subjects: [] };
    const cache = { get: vi.fn(() => cached), set: vi.fn(), ticket: vi.fn(() => 0) };
    const authz = fakeAuthz(() => ({ keys: [], isSuperAdmin: false }));
    const service = new PermissionService(
      {} as PermissionRepository,
      cache as unknown as PermissionCacheService,
      authz as unknown as AuthzService,
      REVISION,
      NO_AUDIT,
    );
    await expect(service.getPermissionSet('u1', { name: 'tx' } as unknown as DbOrTx)).resolves.toBe(
      cached,
    );
    expect(authz.tenantPermissionsOf).not.toHaveBeenCalled();
  });
});

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
      REVISION,
      NO_AUDIT,
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

describe('PermissionService.assertHasAll／assertHasAny（service 層的權限判斷，docs/architecture/backend/05-rbac.md §3.1）', () => {
  const ACTOR = { id: 'actor', email: 'actor@example.com' };
  const CONTEXT = { route: 'POST /approvals/:id/approve', metadata: { approvalId: 'a1' } };

  it('全部都有 → 放行，不寫稽核', async () => {
    const { service, audit } = createService({
      keys: ['user:read', 'user:assignRole'],
      isSuperAdmin: false,
    });
    await expect(
      service.assertHasAll(ACTOR, ['user:read', 'user:assignRole'], CONTEXT),
    ).resolves.toBeUndefined();
    expect(audit.recordSafely).not.toHaveBeenCalled();
  });

  it('缺少 → 寫 authz.denied（route、required、missing 與呼叫端的 metadata），再拋 AUTHZ_FORBIDDEN { required, missing }', async () => {
    const { service, audit } = createService({ keys: ['user:read'], isSuperAdmin: false });
    await expect(
      service.assertHasAll(ACTOR, ['user:read', 'system:update'], CONTEXT),
    ).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
      details: { required: ['user:read', 'system:update'], missing: ['system:update'] },
    });
    expect(audit.recordSafely).toHaveBeenCalledWith({
      action: 'authz.denied',
      result: 'failure',
      actorId: 'actor',
      actorEmail: 'actor@example.com',
      resourceType: 'authz',
      errorCode: 'AUTHZ_FORBIDDEN',
      metadata: {
        approvalId: 'a1',
        route: 'POST /approvals/:id/approve',
        required: ['user:read', 'system:update'],
        missing: ['system:update'],
      },
    });
  });

  it('super-admin → 放行，不寫稽核', async () => {
    const { service, audit } = createService({ keys: [], isSuperAdmin: true });
    await expect(service.assertHasAll(ACTOR, ['system:update'], CONTEXT)).resolves.toBeUndefined();
    expect(audit.recordSafely).not.toHaveBeenCalled();
  });

  it('依賴樹帶來的鍵也算（user:assignRole 包含 user:read）', async () => {
    const { service } = createService({ keys: ['user:assignRole'], isSuperAdmin: false });
    await expect(service.assertHasAll(ACTOR, ['user:read'], CONTEXT)).resolves.toBeUndefined();
  });

  it('assertHasAny：有任一個就放行；一個都沒有 → missing 是全部', async () => {
    const reader = createService({ keys: ['user:read'], isSuperAdmin: false });
    await expect(
      reader.service.assertHasAny(ACTOR, ['system:update', 'user:read'], CONTEXT),
    ).resolves.toBeUndefined();

    const nobody = createService({ keys: [], isSuperAdmin: false });
    await expect(
      nobody.service.assertHasAny(ACTOR, ['system:update', 'user:read'], CONTEXT),
    ).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
      details: {
        required: ['system:update', 'user:read'],
        missing: ['system:update', 'user:read'],
      },
    });
    expect(nobody.audit.recordSafely).toHaveBeenCalledTimes(1);
  });

  it('沒有要求任何權限 → 放行，不查權限', async () => {
    const { service, authz } = createService({ keys: [], isSuperAdmin: false });
    await expect(service.assertHasAll(ACTOR, [], CONTEXT)).resolves.toBeUndefined();
    expect(authz.tenantPermissionsOf).not.toHaveBeenCalled();
  });
});

describe('PermissionService.assertNoSelfLockout（docs/architecture/backend/05-rbac.md §8.4）', () => {
  const GUARDED = ['role:update', 'role:grantPermission'] as PermissionKey[];
  const R1 = 'role:r1#holder';
  const R2 = 'role:r2#holder';

  /**
   * `subjects` 是 actor 的主體閉包（直接持有的角色與經由群組持有的角色都在裡面，形狀相同）；
   * `otherRoleKeys` 是閉包裡其他角色帶的鍵。
   */
  function createLockoutService(options: {
    keys: PermissionKey[];
    isSuperAdmin?: boolean;
    subjects?: string[];
    otherRoleKeys?: PermissionKey[];
  }) {
    const { service, repo, authz } = createService({
      keys: options.keys,
      isSuperAdmin: options.isSuperAdmin ?? false,
      subjects: options.subjects ?? [R1],
    });
    const extra = {
      findPermissionKeysOfRoles: vi.fn().mockResolvedValue(options.otherRoleKeys ?? []),
    };
    Object.assign(repo, extra);
    return { service, repo: { ...repo, ...extra }, authz };
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

  it('只經由群組持有這個角色（閉包裡有 role:r1#holder、也有群組）也算持有 → ROLE_SELF_LOCKOUT', async () => {
    const { service } = createLockoutService({
      keys: GUARDED,
      subjects: ['group:g1#member', R1],
    });
    await expect(service.assertNoSelfLockout('actor', 'r1', [], GUARDED)).rejects.toMatchObject({
      code: 'ROLE_SELF_LOCKOUT',
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

  it('閉包裡的其他角色（直接或經由群組）仍提供同樣的權限 → 通過；只查這個角色以外的', async () => {
    const { service, repo } = createLockoutService({
      keys: GUARDED,
      subjects: [R1, 'group:g1#member', R2],
      otherRoleKeys: GUARDED,
    });
    await expect(service.assertNoSelfLockout('actor', 'r1', [], GUARDED)).resolves.toBeUndefined();
    expect(repo.findPermissionKeysOfRoles).toHaveBeenCalledWith(['r2'], undefined);
  });

  it('在交易內（鎖住角色列之後）呼叫：權限與其他角色的鍵都以同一個交易查', async () => {
    const { service, repo, authz } = createLockoutService({
      keys: GUARDED,
      subjects: [R1, R2],
      otherRoleKeys: GUARDED,
    });
    const tx = { name: 'tx' } as unknown as DbOrTx;
    await expect(
      service.assertNoSelfLockout('actor', 'r1', [], GUARDED, tx),
    ).resolves.toBeUndefined();
    expect(authz.tenantPermissionsOf).toHaveBeenCalledWith(['actor'], {
      withDependencies: true,
      tx,
    });
    expect(repo.findPermissionKeysOfRoles).toHaveBeenCalledWith(['r2'], tx);
  });

  it('沒有持有這個角色 → 通過，不查其他角色', async () => {
    const { service, repo } = createLockoutService({ keys: GUARDED, subjects: [R2] });
    await expect(service.assertNoSelfLockout('actor', 'r1', [], GUARDED)).resolves.toBeUndefined();
    expect(repo.findPermissionKeysOfRoles).not.toHaveBeenCalled();
  });

  it('本來就沒有那些管理權限 → 通過，不查角色', async () => {
    const { service, repo } = createLockoutService({ keys: ['user:read'] });
    await expect(service.assertNoSelfLockout('actor', 'r1', [], GUARDED)).resolves.toBeUndefined();
    expect(repo.findPermissionKeysOfRoles).not.toHaveBeenCalled();
  });

  it('super-admin 豁免', async () => {
    const { service, repo } = createLockoutService({ keys: [], isSuperAdmin: true });
    await expect(service.assertNoSelfLockout('actor', 'r1', [], GUARDED)).resolves.toBeUndefined();
    expect(repo.findPermissionKeysOfRoles).not.toHaveBeenCalled();
  });
});

describe('PermissionService.describeRolePermissions（技能樹用，docs/architecture/iam/02-permission-catalog.md §9）', () => {
  const service = new PermissionService(
    {} as PermissionRepository,
    {} as PermissionCacheService,
    {} as AuthzService,
    REVISION,
    NO_AUDIT,
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
    expect(effective).toHaveLength(72);
    expect(effective.every((entry) => entry.source === 'implied')).toBe(true);
  });
});

describe('PermissionService.findActiveUserIdsWithPermission（docs/architecture/backend/15-notification.md §12.2 D5）', () => {
  /** 候選來自反向查詢；每個人的權限由假的關係圖決定（正向解析）。 */
  function createHolderService(
    candidates: string[],
    active: string[],
    keysOf: Record<string, { keys: PermissionKey[]; isSuperAdmin: boolean }>,
  ) {
    const authz = {
      ...fakeAuthz((id) => keysOf[id] ?? { keys: [], isSuperAdmin: false }),
      usersWithTenantRelations: vi.fn(async (_relations: readonly string[]) => candidates),
    };
    const repo = { filterActiveUserIds: vi.fn(async () => active) };
    const cache = { get: vi.fn(), set: vi.fn(), ticket: vi.fn(() => 0) };
    const service = new PermissionService(
      repo as unknown as PermissionRepository,
      cache as unknown as PermissionCacheService,
      authz as unknown as AuthzService,
      REVISION,
      NO_AUDIT,
    );
    return { service, authz, repo };
  }

  it('反向查詢帶上權限鍵、帶來它的鍵與 superAdmin', async () => {
    const { service, authz } = createHolderService([], [], {});
    await service.findActiveUserIdsWithPermission('user:read');
    const relations = authz.usersWithTenantRelations.mock.calls[0]?.[0];
    expect(relations).toEqual(
      expect.arrayContaining(['user:read', 'user:update', 'user:create', 'superAdmin']),
    );
    expect(relations).not.toContain('role:read');
  });

  it('只留下可登入的人，再以正向解析確認：直接持有、依賴樹帶來、super-admin 都算', async () => {
    const { service, repo } = createHolderService(
      ['direct', 'implied', 'root', 'stale', 'inactive'],
      ['direct', 'implied', 'root', 'stale'],
      {
        direct: { keys: ['user:read'], isSuperAdmin: false },
        implied: { keys: ['user:update'], isSuperAdmin: false },
        root: { keys: [], isSuperAdmin: true },
        // 候選查詢之後權限剛被拿掉：以正向解析為準
        stale: { keys: ['role:read'], isSuperAdmin: false },
      },
    );
    await expect(service.findActiveUserIdsWithPermission('user:read')).resolves.toEqual([
      'direct',
      'implied',
      'root',
    ]);
    expect(repo.filterActiveUserIds).toHaveBeenCalledWith([
      'direct',
      'implied',
      'root',
      'stale',
      'inactive',
    ]);
  });
});

/** 其餘公開方法用的完整假物件：快取可預先放值，repository 每個方法各自設定。 */
function createFullService(
  options: {
    cached?: Record<string, { keys: PermissionKey[]; isSuperAdmin?: boolean }>;
    loaded?: { keys: PermissionKey[]; isSuperAdmin: boolean };
  } = {},
) {
  const { cached = {}, loaded = { keys: [], isSuperAdmin: false } } = options;
  const repo = {
    findAllPermissionKeys: vi.fn().mockResolvedValue(ALL_KEYS),
    findIdsByKeys: vi.fn(),
    listCatalog: vi.fn(),
  };
  const cache = {
    get: vi.fn((id: string) => {
      const entry = cached[id];
      return entry
        ? { permissions: new Set(entry.keys), isSuperAdmin: entry.isSuperAdmin ?? false }
        : undefined;
    }),
    set: vi.fn(),
    ticket: vi.fn(() => 7),
    invalidate: vi.fn(),
  };
  const authz = {
    ...fakeAuthz(() => loaded),
    usersInSubjectSets: vi.fn().mockResolvedValue(['u1', 'u2']),
  };
  const revision = { changed: vi.fn().mockResolvedValue(undefined) };
  const service = new PermissionService(
    repo as unknown as PermissionRepository,
    cache as unknown as PermissionCacheService,
    authz as unknown as AuthzService,
    revision as unknown as AuthzRevision,
    NO_AUDIT,
  );
  return { service, repo, cache, authz, revision };
}

describe('PermissionService.getPermissionSet（快取，docs/architecture/backend/07-testing.md §8 權限快取）', () => {
  it('快取沒命中：查詢前取票，查到的連同票寫回快取', async () => {
    const { service, cache, authz } = createFullService({
      loaded: { keys: ['role:update'], isSuperAdmin: false },
    });
    const value = await service.getPermissionSet('u1');
    expect(authz.tenantPermissionsOf).toHaveBeenCalledWith(['u1'], {
      withDependencies: true,
      tx: undefined,
    });
    expect(cache.set).toHaveBeenCalledWith('u1', value, 7);
    expect(cache.ticket.mock.invocationCallOrder[0]).toBeLessThan(
      authz.tenantPermissionsOf.mock.invocationCallOrder[0] as number,
    );
    expect(value.permissions).toBeInstanceOf(Set);
    expect([...value.permissions].toSorted()).toEqual(['role:read', 'role:update']);
  });
});

const withToken = <T>(fn: () => Promise<T>, scopes?: string[], userId = 'u1') =>
  runWithRequestContext(
    {
      requestId: 'r1',
      apiToken: { id: 'tok', userId, scopes: scopes ? new Set(scopes) : undefined },
    },
    fn,
  );

describe('PermissionService：API token 限縮權限（docs/architecture/06-external-api.md §9.2 D3）', () => {
  it('token 的擁有者：權限與 scopes 取交集，標 tokenScoped', async () => {
    const { service } = createFullService({ cached: { u1: { keys: ['user:read', 'role:read'] } } });
    const value = await withToken(() => service.getPermissionSet('u1'), ['user:read', 'file:read']);
    expect([...value.permissions]).toEqual(['user:read']);
    expect(value).toMatchObject({ isSuperAdmin: false, tokenScoped: true });
  });

  it('super-admin 透過 token 也只剩 scopes，不再是 super-admin', async () => {
    const { service } = createFullService({ cached: { u1: { keys: [], isSuperAdmin: true } } });
    const value = await withToken(() => service.getPermissionSet('u1'), ['file:read']);
    expect([...value.permissions]).toEqual(['file:read']);
    expect(value.isSuperAdmin).toBe(false);
  });

  it('問的不是 token 的擁有者、或 token 沒有 scopes：權限跟著帳號', async () => {
    const { service } = createFullService({
      cached: { u2: { keys: ['user:read', 'role:read'] }, u1: { keys: ['role:read'] } },
    });
    const other = await withToken(() => service.getPermissionSet('u2'), ['user:read']);
    expect([...other.permissions]).toEqual(['user:read', 'role:read']);
    const unscoped = await withToken(() => service.getPermissionSet('u1'));
    expect(unscoped.tokenScoped).toBeUndefined();
  });

  it('批次解析也套用 token 的 scopes', async () => {
    const { service } = createFullService({
      cached: { u1: { keys: ['user:read', 'role:read'] } },
      loaded: { keys: ['role:read'], isSuperAdmin: false },
    });
    const sets = await withToken(() => service.getPermissionSets(['u1', 'u9']), ['role:read']);
    expect([...(sets.get('u1')?.permissions ?? [])]).toEqual(['role:read']);
    expect([...(sets.get('u9')?.permissions ?? [])]).toEqual(['role:read']);
  });
});

describe('PermissionService.getEffectivePermissionKeys（/auth/profile）', () => {
  it('super-admin 展開成目錄全集', async () => {
    const { service } = createFullService({ cached: { root: { keys: [], isSuperAdmin: true } } });
    await expect(service.getEffectivePermissionKeys('root')).resolves.toEqual(ALL_KEYS);
  });

  it('一般使用者是解析後的鍵', async () => {
    const { service, repo } = createFullService({ cached: { u1: { keys: ['user:read'] } } });
    await expect(service.getEffectivePermissionKeys('u1')).resolves.toEqual(['user:read']);
    expect(repo.findAllPermissionKeys).not.toHaveBeenCalled();
  });
});

describe('PermissionService.assertGrantable／assertCanGrant（反提權，docs/architecture/backend/05-rbac.md §4.1）', () => {
  it('授予自己沒有的權限 → AUTHZ_ESCALATION，missing 依目錄順序', async () => {
    const { service, authz } = createFullService({ cached: { actor: { keys: ['user:read'] } } });
    authz.grantedCapabilities.mockResolvedValue(capabilities('system:update', 'user:read'));
    await expect(
      service.assertGrantable('actor', ['system:update', 'user:read']),
    ).rejects.toMatchObject({ code: 'AUTHZ_ESCALATION', details: { missing: ['system:update'] } });
    expect(authz.grantedCapabilities).toHaveBeenCalledWith(
      [
        { object: { type: 'tenant', id: 'self' }, relation: 'system:update' },
        { object: { type: 'tenant', id: 'self' }, relation: 'user:read' },
      ],
      { tx: undefined },
    );
  });

  it('全部已持有 → 通過；在交易內呼叫時把 tx 傳給引擎', async () => {
    const { service, authz } = createFullService({ cached: { actor: { keys: ['user:read'] } } });
    authz.grantedCapabilities.mockResolvedValue(capabilities('user:read'));
    const tx = {} as DbOrTx;
    await expect(service.assertGrantable('actor', ['user:read'], tx)).resolves.toBeUndefined();
    expect(authz.grantedCapabilities).toHaveBeenCalledWith(expect.any(Array), { tx });
  });

  it('super-admin 豁免，不展開能力', async () => {
    const { service, authz } = createFullService({
      cached: { root: { keys: [], isSuperAdmin: true } },
    });
    await expect(service.assertGrantable('root', ['system:update'])).resolves.toBeUndefined();
    expect(authz.grantedCapabilities).not.toHaveBeenCalled();
  });

  it('空陣列不觸發檢查', async () => {
    const { service, cache } = createFullService();
    await expect(service.assertGrantable('actor', [])).resolves.toBeUndefined();
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('能力不在租戶上（資料夾的 can_*）是程式錯誤，直接拋出', async () => {
    const { service, authz } = createFullService({ cached: { actor: { keys: [] } } });
    authz.grantedCapabilities.mockResolvedValue([
      { object: { type: 'folder', id: 'f1' }, relation: 'can_read' },
    ]);
    await expect(service.assertGrantable('actor', ['file:read'])).rejects.toThrow(
      'assertCanGrant 只比對租戶上的能力：folder#can_read',
    );
  });
});

describe('PermissionService.filterGrantable（角色複製）', () => {
  it('只留下 actor 持有的，其餘列為略過', async () => {
    const { service } = createFullService({ cached: { actor: { keys: ['user:read'] } } });
    await expect(service.filterGrantable('actor', ['user:read', 'system:update'])).resolves.toEqual(
      { granted: ['user:read'], skipped: ['system:update'] },
    );
  });

  it('super-admin 全部可授予', async () => {
    const { service } = createFullService({ cached: { root: { keys: [], isSuperAdmin: true } } });
    await expect(service.filterGrantable('root', ['system:update'])).resolves.toEqual({
      granted: ['system:update'],
      skipped: [],
    });
  });
});

describe('PermissionService.assertKeysExist', () => {
  it('全部存在 → 回傳 key → id', async () => {
    const { service, repo } = createFullService();
    const found = new Map([['user:read', 'p1']]);
    repo.findIdsByKeys.mockResolvedValue(found);
    await expect(service.assertKeysExist(['user:read'])).resolves.toBe(found);
  });

  it('有不存在的鍵 → PERMISSION_UNKNOWN 帶出不存在的鍵', async () => {
    const { service, repo } = createFullService();
    repo.findIdsByKeys.mockResolvedValue(new Map([['user:read', 'p1']]));
    await expect(service.assertKeysExist(['user:read', 'nope:x'])).rejects.toMatchObject({
      code: 'PERMISSION_UNKNOWN',
      details: { unknown: ['nope:x'] },
    });
  });
});

const row = (key: string): PermissionRow => {
  const [resource = '', action = ''] = key.split(':');
  return {
    id: `id-${key}`,
    key,
    resource,
    action,
    nameI18nKey: `permission.${resource}.${action}`,
    description: null,
    sortOrder: 0,
    createdAt: new Date(0),
  };
};

describe('PermissionService.getCatalog（docs/architecture/iam/02-permission-catalog.md）', () => {
  it('每列帶上依賴樹的 includes／requires（沒有依賴的是空陣列），並依資源分組', async () => {
    const { service, repo } = createFullService();
    repo.listCatalog.mockResolvedValue([
      row('user:read'),
      row('user:assignRole'),
      row('role:read'),
    ]);
    const catalog = await service.getCatalog();
    expect(
      catalog.items.map(({ key, includes, requires }) => ({ key, includes, requires })),
    ).toEqual([
      { key: 'user:read', includes: [], requires: [] },
      { key: 'user:assignRole', includes: ['user:read'], requires: ['role:read'] },
      { key: 'role:read', includes: [], requires: [] },
    ]);
    expect(catalog.groups).toEqual([
      {
        resource: 'user',
        nameI18nKey: 'permission.resource.user',
        keys: ['user:read', 'user:assignRole'],
      },
      { resource: 'role', nameI18nKey: 'permission.resource.role', keys: ['role:read'] },
    ]);
  });
});

describe('PermissionService：失效與持有者查詢（docs/architecture/backend/05-rbac.md §5.1）', () => {
  it('invalidateUser 清掉那個人的快取', () => {
    const { service, cache } = createFullService();
    service.invalidateUser('u1');
    expect(cache.invalidate).toHaveBeenCalledWith('u1');
  });

  it('permissionsChanged 交給 AuthzRevision（整個租戶失效並廣播）', async () => {
    const { service, revision } = createFullService();
    await service.permissionsChanged(['u1']);
    expect(revision.changed).toHaveBeenCalledWith(['u1']);
  });

  it('findUserIdsHoldingRole 以 role#holder 反查（含經由群組持有）', async () => {
    const { service, authz } = createFullService();
    const tx = {} as DbOrTx;
    await expect(service.findUserIdsHoldingRole('r1', tx)).resolves.toEqual(['u1', 'u2']);
    expect(authz.usersInSubjectSets).toHaveBeenCalledWith(
      [{ type: 'role', id: 'r1', relation: 'holder' }],
      { tx },
    );
  });
});
