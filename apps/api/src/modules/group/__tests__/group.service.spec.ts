import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Database } from '@/core/database';
import type { DomainEventBus } from '@/core/events';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { PermissionService } from '@/modules/permission/permission.service';

import type { GroupRepository } from '../group.repository';
import { GroupService } from '../group.service';

const ACTOR = { id: 'actor', email: 'actor@example.com' } as AuthUser;
const GROUP = {
  id: 'g1',
  name: '美術',
  description: null,
  version: 1,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  createdBy: null,
  updatedBy: null,
  deletedAt: null,
};

function createService() {
  const repo = {
    findById: vi.fn().mockResolvedValue(GROUP),
    withCounts: vi.fn().mockResolvedValue({ ...GROUP, memberCount: 0, roleCount: 0 }),
    lockActiveRow: vi.fn().mockResolvedValue(GROUP),
    lockMembership: vi.fn(),
    listMemberRefs: vi.fn().mockResolvedValue([]),
    addMembers: vi.fn(),
    removeMembers: vi.fn(),
    memberUserIds: vi.fn().mockResolvedValue([]),
    ancestors: vi.fn().mockResolvedValue([]),
    descendants: vi.fn().mockResolvedValue([]),
    findActiveUserIds: vi.fn(async (ids: string[]) => ids),
    findActiveGroupIds: vi.fn(async (ids: string[]) => ids),
    findActiveRoles: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, slug: id }))),
    listRoleIds: vi.fn().mockResolvedValue([]),
    addRoles: vi.fn(),
    removeRoles: vi.fn(),
    listRoles: vi.fn().mockResolvedValue([]),
  };
  const permissions = {
    getPermissionSet: vi.fn().mockResolvedValue({
      permissions: new Set(),
      isSuperAdmin: false,
      subjects: ['user:actor', 'user:*'],
    }),
    getPermissionSets: vi.fn(
      async (ids: string[]) => new Map(ids.map((id) => [id, { isSuperAdmin: false }])),
    ),
    assertRolesAssignable: vi.fn(),
    assertCanGrant: vi.fn(),
    permissionsChanged: vi.fn(),
  };
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const service = new GroupService(
    db as unknown as Database,
    repo as unknown as GroupRepository,
    permissions as unknown as PermissionService,
    { record: vi.fn() } as unknown as AuditService,
    { publish: vi.fn() } as unknown as DomainEventBus,
  );
  return { service, repo, permissions };
}

describe('GroupService.updateMembers（docs/adr/0024-relationship-based-access-control.md D11）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('加成員：以 group:G#member 詢問反提權（引擎展開上層群組與它們的角色），在交易內', async () => {
    await ctx.service.updateMembers('g1', { add: [{ type: 'user', id: 'u1' }], remove: [] }, ACTOR);
    expect(ctx.permissions.assertCanGrant).toHaveBeenCalledWith(
      'actor',
      [{ object: { type: 'group', id: 'g1' }, relation: 'member' }],
      'tx',
    );
    expect(ctx.repo.addMembers).toHaveBeenCalledWith(
      'g1',
      [{ type: 'user', id: 'u1' }],
      'actor',
      'tx',
    );
  });

  it('反提權失敗 → 不寫入', async () => {
    ctx.permissions.assertCanGrant.mockRejectedValue(
      Object.assign(new Error('escalation'), { code: 'AUTHZ_ESCALATION' }),
    );
    await expect(
      ctx.service.updateMembers('g1', { add: [{ type: 'user', id: 'u1' }], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'AUTHZ_ESCALATION' });
    expect(ctx.repo.addMembers).not.toHaveBeenCalled();
  });

  it('只移除成員：不做反提權檢查', async () => {
    await ctx.service.updateMembers('g1', { add: [], remove: [{ type: 'user', id: 'u1' }] }, ACTOR);
    expect(ctx.permissions.assertCanGrant).not.toHaveBeenCalled();
    expect(ctx.repo.removeMembers).toHaveBeenCalled();
  });

  it('不能把自己加進或移出群組 → AUTHZ_SELF_MODIFY', async () => {
    await expect(
      ctx.service.updateMembers('g1', { add: [{ type: 'user', id: 'actor' }], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'AUTHZ_SELF_MODIFY' });
    await expect(
      ctx.service.updateMembers('g1', { add: [], remove: [{ type: 'user', id: 'actor' }] }, ACTOR),
    ).rejects.toMatchObject({ code: 'AUTHZ_SELF_MODIFY' });
  });

  it('不能把自己所屬的群組加進群組 → AUTHZ_SELF_MODIFY', async () => {
    ctx.permissions.getPermissionSet.mockResolvedValue({
      permissions: new Set(),
      isSuperAdmin: false,
      subjects: ['user:actor', 'group:mine#member'],
    });
    await expect(
      ctx.service.updateMembers('g1', { add: [{ type: 'group', id: 'mine' }], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'AUTHZ_SELF_MODIFY' });
  });

  it('只有 super-admin 能改 super-admin 的成員資格 → AUTHZ_ESCALATION', async () => {
    ctx.permissions.getPermissionSets.mockResolvedValue(
      new Map([['root', { isSuperAdmin: true }]]),
    );
    await expect(
      ctx.service.updateMembers('g1', { add: [{ type: 'user', id: 'root' }], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'AUTHZ_ESCALATION', details: { target: 'root' } });
  });

  it('成員不存在 → USER_NOT_FOUND／GROUP_NOT_FOUND 帶出 id', async () => {
    ctx.repo.findActiveUserIds.mockResolvedValue([]);
    await expect(
      ctx.service.updateMembers('g1', { add: [{ type: 'user', id: 'ghost' }], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND', details: { ids: ['ghost'] } });
    ctx.repo.findActiveUserIds.mockImplementation(async (ids: string[]) => ids);
    ctx.repo.findActiveGroupIds.mockResolvedValue([]);
    await expect(
      ctx.service.updateMembers('g1', { add: [{ type: 'group', id: 'ghost' }], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND', details: { ids: ['ghost'] } });
  });

  it('把群組加進自己，或加進自己底下的群組 → GROUP_MEMBERSHIP_CYCLE', async () => {
    await expect(
      ctx.service.updateMembers('g1', { add: [{ type: 'group', id: 'g1' }], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_MEMBERSHIP_CYCLE' });
    // top 已經包含 g1：把 top 放進 g1 會形成循環
    ctx.repo.ancestors.mockResolvedValue([{ id: 'top', depth: 1 }]);
    await expect(
      ctx.service.updateMembers('g1', { add: [{ type: 'group', id: 'top' }], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_MEMBERSHIP_CYCLE', details: { groupId: 'top' } });
    expect(ctx.repo.addMembers).not.toHaveBeenCalled();
  });

  it('加入之後的鏈超過上限 → GROUP_NESTING_TOO_DEEP', async () => {
    // g1 上面有 2 層、child 下面有 3 層：2 + 3 + 2（g1 與 child）= 7 > 6
    ctx.repo.ancestors.mockResolvedValue([{ id: 'a2', depth: 2 }]);
    ctx.repo.descendants.mockResolvedValue([{ id: 'd3', depth: 3 }]);
    await expect(
      ctx.service.updateMembers('g1', { add: [{ type: 'group', id: 'child' }], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_NESTING_TOO_DEEP', details: { max: 6 } });
    // 剛好 6 層可以
    ctx.repo.descendants.mockResolvedValue([{ id: 'd2', depth: 2 }]);
    await expect(
      ctx.service.updateMembers('g1', { add: [{ type: 'group', id: 'child' }], remove: [] }, ACTOR),
    ).resolves.toBeDefined();
  });

  it('交易後以前後成員的聯集呼叫 permissionsChanged', async () => {
    ctx.repo.memberUserIds.mockResolvedValueOnce(['u-old']).mockResolvedValueOnce(['u-new']);
    await ctx.service.updateMembers(
      'g1',
      { add: [{ type: 'user', id: 'u-new' }], remove: [] },
      ACTOR,
    );
    expect(ctx.permissions.permissionsChanged).toHaveBeenCalledWith(['u-old', 'u-new']);
  });
});

describe('GroupService.updateRoles（docs/adr/0024-relationship-based-access-control.md D12）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('群組不能持有 super-admin → GROUP_SUPER_ADMIN_FORBIDDEN', async () => {
    await expect(
      ctx.service.updateRoles('g1', { add: ['super-admin'], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_SUPER_ADMIN_FORBIDDEN' });
    expect(ctx.repo.addRoles).not.toHaveBeenCalled();
  });

  it('加角色受指派角色的反提權限制', async () => {
    await ctx.service.updateRoles('g1', { add: ['r-editor'], remove: [] }, ACTOR);
    expect(ctx.permissions.assertRolesAssignable).toHaveBeenCalledWith('actor', ['r-editor']);
    expect(ctx.repo.addRoles).toHaveBeenCalledWith('g1', ['r-editor'], 'actor', 'tx');
  });

  it('角色不存在 → ROLE_NOT_FOUND 帶出 id', async () => {
    ctx.repo.findActiveRoles.mockResolvedValue([]);
    await expect(
      ctx.service.updateRoles('g1', { add: ['ghost'], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND', details: { ids: ['ghost'] } });
  });

  it('不能改自己所屬群組的角色 → AUTHZ_SELF_MODIFY', async () => {
    ctx.permissions.getPermissionSet.mockResolvedValue({
      permissions: new Set(),
      isSuperAdmin: false,
      subjects: ['user:actor', 'group:g1#member'],
    });
    await expect(
      ctx.service.updateRoles('g1', { add: [], remove: ['r-editor'] }, ACTOR),
    ).rejects.toMatchObject({ code: 'AUTHZ_SELF_MODIFY' });
  });
});
