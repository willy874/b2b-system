import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Database } from '@/core/database';
import type { DomainEventBus } from '@/core/events';
import type { AnnouncementTriggerService } from '@/modules/announcement/announcement-trigger.service';
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
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listMembers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    findByName: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(GROUP),
    update: vi.fn().mockResolvedValue(GROUP),
    findVersion: vi.fn().mockResolvedValue(undefined),
    softDelete: vi.fn(),
    findDeletedById: vi.fn().mockResolvedValue({ ...GROUP, deletedAt: new Date(1000) }),
    exists: vi.fn().mockResolvedValue(false),
    restore: vi.fn().mockResolvedValue(GROUP),
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
    permissionsChanged: vi.fn(async () => {
      order.push('permissionsChanged');
    }),
  };
  /** 交易提交、權限失效、推播的先後（CLAUDE.md 後端規則 6、7）。 */
  const order: string[] = [];
  const db = {
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const result = await fn('tx');
      order.push('commit');
      return result;
    }),
  };
  const audit = {
    record: vi.fn(async () => {
      order.push('audit');
    }),
  };
  const events = {
    publish: vi.fn(() => {
      order.push('publish');
    }),
  };
  const announcementTriggers = { fire: vi.fn() };
  const service = new GroupService(
    db as unknown as Database,
    repo as unknown as GroupRepository,
    permissions as unknown as PermissionService,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
    announcementTriggers as unknown as AnnouncementTriggerService,
  );
  return { service, repo, permissions, announcementTriggers, audit, events, order };
}

describe('GroupService.updateMembers（docs/architecture/iam/01-model.md §9.3 D11）', () => {
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

  it('加成員 → 在交易內觸發公告的 group.memberAdded，只帶直接加入的使用者與這個群組（docs/architecture/backend/19-announcement.md §9.2 D14）', async () => {
    ctx.repo.descendants = vi.fn().mockResolvedValue([]);
    await ctx.service.updateMembers(
      'g1',
      {
        add: [
          { type: 'user', id: 'u1' },
          { type: 'group', id: 'g2' },
        ],
        remove: [],
      },
      ACTOR,
    );
    expect(ctx.announcementTriggers.fire).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'group.memberAdded' }),
      { userIds: ['u1'], groupId: 'g1' },
      'tx',
    );
  });

  it('只移除成員 → 不觸發公告', async () => {
    await ctx.service.updateMembers('g1', { add: [], remove: [{ type: 'user', id: 'u1' }] }, ACTOR);
    expect(ctx.announcementTriggers.fire).not.toHaveBeenCalled();
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

describe('GroupService.updateRoles（docs/architecture/iam/01-model.md §9.3 D12）', () => {
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
    expect(ctx.permissions.assertRolesAssignable).toHaveBeenCalledWith('actor', ['r-editor'], 'tx');
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

describe('GroupService 讀取（docs/architecture/iam/07-groups.md §3）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('list：日期轉成 ISO 字串、帶分頁資訊', async () => {
    ctx.repo.list.mockResolvedValue({
      items: [{ ...GROUP, memberCount: 3, roleCount: 1 }],
      total: 1,
    });
    await expect(ctx.service.list({ offset: 0, limit: 20, sort: [] })).resolves.toEqual({
      items: [
        {
          id: 'g1',
          name: '美術',
          description: null,
          memberCount: 3,
          roleCount: 1,
          version: 1,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
      pagination: { offset: 0, limit: 20, total: 1 },
    });
  });

  it('list：帶 membership（?userId= 的直接或經由巢狀所屬）時一併回傳', async () => {
    const membership = 'nested';
    ctx.repo.list.mockResolvedValue({
      items: [{ ...GROUP, memberCount: 0, roleCount: 0, membership }],
      total: 1,
    });
    const result = await ctx.service.list({ offset: 0, limit: 20, sort: [] });
    expect(result.items[0]).toMatchObject({ membership });
  });

  it('findOne：不存在 → GROUP_NOT_FOUND', async () => {
    ctx.repo.withCounts.mockResolvedValue(undefined);
    await expect(ctx.service.findOne('ghost')).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });
  });

  it('listMembers／listRoles：群組不存在 → GROUP_NOT_FOUND，不查成員與角色', async () => {
    ctx.repo.findById.mockResolvedValue(undefined);
    await expect(ctx.service.listMembers('ghost', { offset: 0, limit: 20 })).rejects.toMatchObject({
      code: 'GROUP_NOT_FOUND',
    });
    await expect(ctx.service.listRoles('ghost')).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });
    expect(ctx.repo.listMembers).not.toHaveBeenCalled();
    expect(ctx.repo.listRoles).not.toHaveBeenCalled();
  });

  it('listMembers：依 offset／limit 查詢並帶分頁資訊', async () => {
    ctx.repo.listMembers.mockResolvedValue({ items: [{ type: 'user', id: 'u1' }], total: 7 });
    await expect(ctx.service.listMembers('g1', { offset: 5, limit: 1 })).resolves.toEqual({
      items: [{ type: 'user', id: 'u1' }],
      pagination: { offset: 5, limit: 1, total: 7 },
    });
    expect(ctx.repo.listMembers).toHaveBeenCalledWith('g1', 5, 1);
  });
});

describe('GroupService.create（docs/architecture/iam/07-groups.md §4）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('名稱已被使用 → GROUP_NAME_DUPLICATE（details.field／value），不寫入', async () => {
    ctx.repo.findByName.mockResolvedValue({ ...GROUP, id: 'other' });
    await expect(ctx.service.create({ name: '美術' }, ACTOR)).rejects.toMatchObject({
      code: 'GROUP_NAME_DUPLICATE',
      details: { field: 'name', value: '美術' },
    });
    expect(ctx.repo.create).not.toHaveBeenCalled();
  });

  it('沒給說明存成 null，建立者與更新者都是操作者', async () => {
    await ctx.service.create({ name: '美術' }, ACTOR);
    expect(ctx.repo.create).toHaveBeenCalledWith(
      { name: '美術', description: null, createdBy: 'actor', updatedBy: 'actor' },
      'tx',
    );
  });

  it('稽核 group.create 在交易內、推播在提交後；不呼叫 permissionsChanged（新群組沒有成員）', async () => {
    await ctx.service.create({ name: '美術' }, ACTOR);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'group.create', resourceId: 'g1' }),
      'tx',
    );
    expect(ctx.order).toEqual(['audit', 'commit', 'publish']);
  });
});

describe('GroupService.update（docs/architecture/backend/14-revisions.md §9.2 D3）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('群組不存在 → GROUP_NOT_FOUND', async () => {
    ctx.repo.findById.mockResolvedValue(undefined);
    await expect(
      ctx.service.update('ghost', { name: 'x', version: 1 }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });
  });

  it('version 與目前不同 → GROUP_VERSION_CONFLICT 帶目前的 version，不寫入', async () => {
    await expect(ctx.service.update('g1', { name: 'x', version: 0 }, ACTOR)).rejects.toMatchObject({
      code: 'GROUP_VERSION_CONFLICT',
      details: { current: 1 },
    });
    expect(ctx.repo.update).not.toHaveBeenCalled();
  });

  it('只改大小寫不檢查撞名（撞到的是自己）', async () => {
    ctx.repo.findById.mockResolvedValue({ ...GROUP, name: 'Art' });
    ctx.repo.findByName.mockResolvedValue({ ...GROUP, name: 'Art' });
    await expect(
      ctx.service.update('g1', { name: 'ART', version: 1 }, ACTOR),
    ).resolves.toBeDefined();
    expect(ctx.repo.findByName).not.toHaveBeenCalled();
  });

  it('改成別人的名稱 → GROUP_NAME_DUPLICATE', async () => {
    ctx.repo.findByName.mockResolvedValue({ ...GROUP, id: 'other', name: '音樂' });
    await expect(
      ctx.service.update('g1', { name: '音樂', version: 1 }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_NAME_DUPLICATE', details: { value: '音樂' } });
  });

  it('條件式 UPDATE 沒命中且列已不在 → GROUP_NOT_FOUND', async () => {
    ctx.repo.update.mockResolvedValue(undefined);
    ctx.repo.findVersion.mockResolvedValue(undefined);
    await expect(
      ctx.service.update('g1', { description: 'x', version: 1 }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });
  });

  it('條件式 UPDATE 沒命中但列還在（被搶先改過）→ GROUP_VERSION_CONFLICT 帶最新的 version', async () => {
    ctx.repo.update.mockResolvedValue(undefined);
    ctx.repo.findVersion.mockResolvedValue(2);
    await expect(
      ctx.service.update('g1', { description: 'x', version: 1 }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_VERSION_CONFLICT', details: { current: 2 } });
    expect(ctx.audit.record).not.toHaveBeenCalled();
  });

  it('稽核只記有變的欄位；改名不呼叫 permissionsChanged', async () => {
    ctx.repo.update.mockResolvedValue({ ...GROUP, name: '設計' });
    await ctx.service.update('g1', { name: '設計', description: null, version: 1 }, ACTOR);
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'g1',
      { name: '設計', description: null, updatedBy: 'actor' },
      1,
      'tx',
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'group.update',
        resourceName: '設計',
        changes: { before: { name: '美術' }, after: { name: '設計' } },
      }),
      'tx',
    );
    expect(ctx.permissions.permissionsChanged).not.toHaveBeenCalled();
  });
});

describe('GroupService.remove（docs/architecture/iam/07-groups.md §4）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('群組不存在 → GROUP_NOT_FOUND', async () => {
    ctx.repo.findById.mockResolvedValue(undefined);
    await expect(ctx.service.remove('ghost', ACTOR)).rejects.toMatchObject({
      code: 'GROUP_NOT_FOUND',
    });
  });

  it('鎖列時已被別人刪除 → GROUP_NOT_FOUND，不軟刪除也不通知權限變更', async () => {
    ctx.repo.lockActiveRow.mockResolvedValue(undefined);
    await expect(ctx.service.remove('g1', ACTOR)).rejects.toMatchObject({
      code: 'GROUP_NOT_FOUND',
    });
    expect(ctx.repo.softDelete).not.toHaveBeenCalled();
    expect(ctx.permissions.permissionsChanged).not.toHaveBeenCalled();
  });

  it('稽核帶受影響人數；提交後才 permissionsChanged（帶刪除前的成員），再推播', async () => {
    ctx.repo.memberUserIds.mockResolvedValue(['u1', 'u2']);
    await ctx.service.remove('g1', ACTOR);
    expect(ctx.repo.softDelete).toHaveBeenCalledWith('g1', 'actor', 'tx');
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'group.delete', metadata: { affectedUserCount: 2 } }),
      'tx',
    );
    expect(ctx.permissions.permissionsChanged).toHaveBeenCalledWith(['u1', 'u2']);
    expect(ctx.events.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ affectedUserIds: ['u1', 'u2'] }),
    );
    expect(ctx.order).toEqual(['audit', 'commit', 'permissionsChanged', 'publish']);
  });
});

describe('GroupService.restore（docs/architecture/iam/07-groups.md §1.1、§4）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('不存在 → GROUP_NOT_FOUND；存在但沒被刪除 → GROUP_NOT_DELETED', async () => {
    ctx.repo.findDeletedById.mockResolvedValue(undefined);
    ctx.repo.exists.mockResolvedValue(false);
    await expect(ctx.service.restore('ghost', ACTOR)).rejects.toMatchObject({
      code: 'GROUP_NOT_FOUND',
    });
    ctx.repo.exists.mockResolvedValue(true);
    await expect(ctx.service.restore('g1', ACTOR)).rejects.toMatchObject({
      code: 'GROUP_NOT_DELETED',
    });
  });

  it('名稱已被別的群組使用 → GROUP_NAME_DUPLICATE 帶 conflictingGroupId', async () => {
    ctx.repo.findByName.mockResolvedValue({ ...GROUP, id: 'g9' });
    await expect(ctx.service.restore('g1', ACTOR)).rejects.toMatchObject({
      code: 'GROUP_NAME_DUPLICATE',
      details: { field: 'name', value: '美術', conflictingGroupId: 'g9' },
    });
    expect(ctx.repo.restore).not.toHaveBeenCalled();
  });

  it('在交易內被別人搶先還原 → GROUP_NOT_DELETED', async () => {
    ctx.repo.restore.mockResolvedValue(undefined);
    await expect(ctx.service.restore('g1', ACTOR)).rejects.toMatchObject({
      code: 'GROUP_NOT_DELETED',
    });
    expect(ctx.permissions.permissionsChanged).not.toHaveBeenCalled();
  });

  it('刪除期間結構形成循環（上層群組也在底下）→ GROUP_MEMBERSHIP_CYCLE 帶 groupId', async () => {
    ctx.repo.ancestors.mockResolvedValue([{ id: 'top', depth: 1 }]);
    ctx.repo.descendants.mockResolvedValue([{ id: 'top', depth: 1 }]);
    await expect(ctx.service.restore('g1', ACTOR)).rejects.toMatchObject({
      code: 'GROUP_MEMBERSHIP_CYCLE',
      details: { groupId: 'top' },
    });
    expect(ctx.audit.record).not.toHaveBeenCalled();
  });

  it('還原後的鏈超過上限 → GROUP_NESTING_TOO_DEEP；剛好 6 層可以', async () => {
    // 上 3 層 + 下 3 層 + 自己 1 = 7 > 6
    ctx.repo.ancestors.mockResolvedValue([{ id: 'a3', depth: 3 }]);
    ctx.repo.descendants.mockResolvedValue([{ id: 'd3', depth: 3 }]);
    await expect(ctx.service.restore('g1', ACTOR)).rejects.toMatchObject({
      code: 'GROUP_NESTING_TOO_DEEP',
      details: { max: 6 },
    });
    ctx.repo.descendants.mockResolvedValue([{ id: 'd2', depth: 2 }]);
    await expect(ctx.service.restore('g1', ACTOR)).resolves.toBeDefined();
  });

  it('反提權與加成員相同：在交易內以 group:G#member 詢問；拒絕時不寫稽核', async () => {
    ctx.permissions.assertCanGrant.mockRejectedValue(
      Object.assign(new Error('escalation'), { code: 'AUTHZ_ESCALATION' }),
    );
    await expect(ctx.service.restore('g1', ACTOR)).rejects.toMatchObject({
      code: 'AUTHZ_ESCALATION',
    });
    expect(ctx.permissions.assertCanGrant).toHaveBeenCalledWith(
      'actor',
      [{ object: { type: 'group', id: 'g1' }, relation: 'member' }],
      'tx',
    );
    expect(ctx.audit.record).not.toHaveBeenCalled();
  });

  it('稽核帶刪除時間；提交後以還原後的成員 permissionsChanged，再以 create 推播', async () => {
    ctx.repo.memberUserIds.mockResolvedValue(['u1']);
    await ctx.service.restore('g1', ACTOR);
    expect(ctx.repo.lockMembership).toHaveBeenCalledWith('tx');
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'group.restore',
        metadata: { deletedAt: new Date(1000).toISOString() },
      }),
      'tx',
    );
    expect(ctx.permissions.permissionsChanged).toHaveBeenCalledWith(['u1']);
    expect(ctx.events.publish).toHaveBeenCalledWith(expect.anything(), {
      changes: [{ resource: 'group', kind: 'create', id: 'g1' }],
      affectedUserIds: ['u1'],
    });
    expect(ctx.order).toEqual(['audit', 'commit', 'permissionsChanged', 'publish']);
  });
});

describe('GroupService.updateMembers 其他分支（docs/architecture/iam/07-groups.md §2）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('群組不存在 → GROUP_NOT_FOUND', async () => {
    ctx.repo.findById.mockResolvedValue(undefined);
    await expect(
      ctx.service.updateMembers('ghost', { add: [], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });
  });

  it('鎖列時群組已被刪除 → GROUP_NOT_FOUND，不寫入', async () => {
    ctx.repo.lockActiveRow.mockResolvedValue(undefined);
    await expect(
      ctx.service.updateMembers('g1', { add: [{ type: 'user', id: 'u1' }], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });
    expect(ctx.repo.addMembers).not.toHaveBeenCalled();
  });

  it('同一個成員重複出現只加一次', async () => {
    await ctx.service.updateMembers(
      'g1',
      {
        add: [
          { type: 'user', id: 'u1' },
          { type: 'user', id: 'u1' },
        ],
        remove: [],
      },
      ACTOR,
    );
    expect(ctx.repo.addMembers).toHaveBeenCalledWith(
      'g1',
      [{ type: 'user', id: 'u1' }],
      'actor',
      'tx',
    );
  });

  it('操作者是 super-admin → 可以改 super-admin 的成員資格（不查目標）', async () => {
    ctx.permissions.getPermissionSet.mockResolvedValue({
      permissions: new Set(),
      isSuperAdmin: true,
      subjects: ['user:actor'],
    });
    ctx.permissions.getPermissionSets.mockResolvedValue(
      new Map([['root', { isSuperAdmin: true }]]),
    );
    await expect(
      ctx.service.updateMembers('g1', { add: [{ type: 'user', id: 'root' }], remove: [] }, ACTOR),
    ).resolves.toBeDefined();
    expect(ctx.permissions.getPermissionSets).not.toHaveBeenCalled();
  });

  it('移出 super-admin 也受限 → AUTHZ_ESCALATION', async () => {
    ctx.permissions.getPermissionSets.mockResolvedValue(
      new Map([['root', { isSuperAdmin: true }]]),
    );
    await expect(
      ctx.service.updateMembers('g1', { add: [], remove: [{ type: 'user', id: 'root' }] }, ACTOR),
    ).rejects.toMatchObject({ code: 'AUTHZ_ESCALATION' });
    expect(ctx.repo.removeMembers).not.toHaveBeenCalled();
  });

  it('不能把自己所屬的群組移出群組 → AUTHZ_SELF_MODIFY', async () => {
    ctx.permissions.getPermissionSet.mockResolvedValue({
      permissions: new Set(),
      isSuperAdmin: false,
      subjects: ['user:actor', 'group:mine#member'],
    });
    await expect(
      ctx.service.updateMembers('g1', { add: [], remove: [{ type: 'group', id: 'mine' }] }, ACTOR),
    ).rejects.toMatchObject({ code: 'AUTHZ_SELF_MODIFY' });
  });

  it('加入與移出各寫一筆稽核（before／after 是成員清單）', async () => {
    ctx.repo.listMemberRefs
      .mockResolvedValueOnce([{ type: 'user', id: 'u-old' }])
      .mockResolvedValueOnce([{ type: 'user', id: 'u-new' }]);
    await ctx.service.updateMembers(
      'g1',
      { add: [{ type: 'user', id: 'u-new' }], remove: [{ type: 'user', id: 'u-old' }] },
      ACTOR,
    );
    const changes = {
      before: { members: [{ type: 'user', id: 'u-old' }] },
      after: { members: [{ type: 'user', id: 'u-new' }] },
    };
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'group.member.add',
        changes,
        metadata: { added: [{ type: 'user', id: 'u-new' }] },
      }),
      'tx',
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'group.member.remove',
        changes,
        metadata: { removed: [{ type: 'user', id: 'u-old' }] },
      }),
      'tx',
    );
  });

  it('permissionsChanged 在交易提交後、推播之前', async () => {
    await ctx.service.updateMembers('g1', { add: [{ type: 'user', id: 'u1' }], remove: [] }, ACTOR);
    expect(ctx.order).toEqual(['audit', 'commit', 'permissionsChanged', 'publish']);
  });
});

describe('GroupService.updateRoles 其他分支（docs/architecture/iam/07-groups.md §2.1、§4）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('群組不存在 → GROUP_NOT_FOUND', async () => {
    ctx.repo.findById.mockResolvedValue(undefined);
    await expect(
      ctx.service.updateRoles('ghost', { add: [], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });
  });

  it('反提權失敗 → 不寫入', async () => {
    ctx.permissions.assertRolesAssignable.mockRejectedValue(
      Object.assign(new Error('escalation'), { code: 'AUTHZ_ESCALATION' }),
    );
    await expect(
      ctx.service.updateRoles('g1', { add: ['r-admin'], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'AUTHZ_ESCALATION' });
    expect(ctx.repo.addRoles).not.toHaveBeenCalled();
  });

  it('鎖列時群組已被刪除 → GROUP_NOT_FOUND，不寫入', async () => {
    ctx.repo.lockActiveRow.mockResolvedValue(undefined);
    await expect(
      ctx.service.updateRoles('g1', { add: ['r-editor'], remove: [] }, ACTOR),
    ).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });
    expect(ctx.repo.addRoles).not.toHaveBeenCalled();
  });

  it('重複的角色 id 只處理一次；稽核 group.assignRole 帶前後的角色 id', async () => {
    ctx.repo.listRoleIds.mockResolvedValueOnce(['r-old']).mockResolvedValueOnce(['r-editor']);
    await ctx.service.updateRoles(
      'g1',
      { add: ['r-editor', 'r-editor'], remove: ['r-old', 'r-old'] },
      ACTOR,
    );
    expect(ctx.repo.addRoles).toHaveBeenCalledWith('g1', ['r-editor'], 'actor', 'tx');
    expect(ctx.repo.removeRoles).toHaveBeenCalledWith('g1', ['r-old'], 'tx');
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'group.assignRole',
        changes: { before: { roles: ['r-old'] }, after: { roles: ['r-editor'] } },
      }),
      'tx',
    );
  });

  it('提交後以群組底下的使用者 permissionsChanged，再推播；回傳最新的角色', async () => {
    ctx.repo.memberUserIds.mockResolvedValue(['u1']);
    ctx.repo.listRoles.mockResolvedValue([{ id: 'r-editor', name: '編輯' }]);
    await expect(
      ctx.service.updateRoles('g1', { add: ['r-editor'], remove: [] }, ACTOR),
    ).resolves.toEqual({ roles: [{ id: 'r-editor', name: '編輯' }] });
    expect(ctx.permissions.permissionsChanged).toHaveBeenCalledWith(['u1']);
    expect(ctx.order).toEqual(['audit', 'commit', 'permissionsChanged', 'publish']);
  });
});
