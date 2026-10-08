import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { UserCacheService } from '@/core/cache';
import type { Database } from '@/core/database';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import { RESOURCE_TYPE } from '@/core/resource';
import type { ApiTokenService } from '@/modules/api-token/api-token.service';
import type { AuditService } from '@/modules/audit-log/audit.service';
import { SUPER_ADMIN_SLUG } from '@/modules/permission/permission.constants';
import type { PermissionService } from '@/modules/permission/permission.service';

import type { ServiceAccountRepository, ServiceAccountRow } from '../service-account.repository';
import { ServiceAccountService } from '../service-account.service';

const ACTOR = { id: 'actor', email: 'actor@example.com' } as AuthUser;
const ROLE_A = { id: 'r-a', slug: 'editor', name: '編輯', isSystem: false };
const ROLE_B = { id: 'r-b', slug: 'viewer', name: '檢視', isSystem: false };

function accountRow(overrides: Partial<ServiceAccountRow> = {}): ServiceAccountRow {
  return {
    id: 'sa1',
    displayName: 'CI bot',
    status: 'active',
    roles: [ROLE_A],
    activeTokenCount: 2,
    version: 3,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  } as ServiceAccountRow;
}

function createService() {
  /** 交易提交、稽核、快取失效、權限失效、推播的先後（CLAUDE.md 後端規則 6、7）。 */
  const order: string[] = [];
  const repo = {
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    findById: vi.fn().mockResolvedValue(accountRow()),
    create: vi.fn(),
    assignRoles: vi.fn(),
    update: vi.fn().mockResolvedValue(accountRow({ version: 4 })),
    findVersion: vi.fn().mockResolvedValue(undefined),
    softDelete: vi.fn(),
    lockForUpdate: vi.fn(),
    listRoles: vi.fn().mockResolvedValue([ROLE_A]),
    replaceRoles: vi.fn(),
    hasRoleSlug: vi.fn().mockResolvedValue(false),
    findActiveRolesByIds: vi.fn(async (ids: string[]) =>
      [ROLE_A, ROLE_B].filter((role) => ids.includes(role.id)),
    ),
  };
  const permissions = {
    assertRolesAssignable: vi.fn(),
    permissionsChanged: vi.fn(async () => {
      order.push('permissionsChanged');
    }),
    invalidateUser: vi.fn(() => {
      order.push('invalidateUser');
    }),
    getPermissionSet: vi.fn().mockResolvedValue({ permissions: new Set(), isSuperAdmin: false }),
  };
  const account = { id: 'sa1', kind: 'service' };
  const tokens = {
    requireAccount: vi.fn().mockResolvedValue(account),
    list: vi.fn().mockResolvedValue([{ id: 't1' }]),
    create: vi.fn().mockResolvedValue({ id: 't2', token: 'secret' }),
    revoke: vi.fn(),
    revokeAllInTransaction: vi.fn().mockResolvedValue(2),
  };
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
  const userCache = {
    invalidate: vi.fn(() => {
      order.push('userCache');
    }),
  };
  const events = {
    publish: vi.fn(() => {
      order.push('publish');
    }),
  };
  const service = new ServiceAccountService(
    db as unknown as Database,
    repo as unknown as ServiceAccountRepository,
    permissions as unknown as PermissionService,
    tokens as unknown as ApiTokenService,
    audit as unknown as AuditService,
    userCache as unknown as UserCacheService,
    events as unknown as DomainEventBus,
  );
  return { service, repo, permissions, tokens, account, audit, userCache, events, order };
}

/** 讓 `assertCanManage` 判定目標持有 super-admin、操作者不是 super-admin。 */
function targetIsSuperAdmin(ctx: ReturnType<typeof createService>): void {
  ctx.repo.hasRoleSlug.mockResolvedValue(true);
}

describe('ServiceAccountService（docs/architecture/06-external-api.md §9.2 D1、D4～D6、D14）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  describe('list／findOne', () => {
    it('列表：轉成 DTO 並帶分頁資訊', async () => {
      ctx.repo.list.mockResolvedValue({ items: [accountRow()], total: 1 });
      const result = await ctx.service.list({ offset: 0, limit: 20 } as never);
      expect(result).toEqual({
        items: [
          {
            id: 'sa1',
            name: 'CI bot',
            status: 'active',
            roles: [ROLE_A],
            activeTokenCount: 2,
            version: 3,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        pagination: { offset: 0, limit: 20, total: 1 },
      });
    });

    it.each([
      ['active', 'active'],
      ['inactive', 'inactive'],
      ['locked', 'inactive'],
      ['pending', 'inactive'],
    ])('users.status=%s → 服務帳號的狀態是 %s（只有 active／inactive）', async (raw, expected) => {
      ctx.repo.findById.mockResolvedValue(accountRow({ status: raw } as never));
      await expect(ctx.service.findOne('sa1')).resolves.toMatchObject({ status: expected });
    });

    it('不存在 → SERVICE_ACCOUNT_NOT_FOUND', async () => {
      ctx.repo.findById.mockResolvedValue(undefined);
      await expect(ctx.service.findOne('ghost')).rejects.toMatchObject({
        code: 'SERVICE_ACCOUNT_NOT_FOUND',
      });
    });
  });

  describe('create', () => {
    it('建立：先做反提權，寫入帳號、角色與稽核都在交易內，提交後才失效權限與推播', async () => {
      await ctx.service.create({ name: 'CI bot', roleIds: ['r-a'] }, ACTOR);

      expect(ctx.permissions.assertRolesAssignable).toHaveBeenCalledWith('actor', ['r-a']);
      const [values, tx] = ctx.repo.create.mock.calls[0]!;
      expect(tx).toBe('tx');
      expect(values).toMatchObject({
        displayName: 'CI bot',
        status: 'active',
        createdBy: 'actor',
        updatedBy: 'actor',
      });
      expect(values.email).toBe(`svc-${values.id}@service.invalid`);
      expect(ctx.repo.assignRoles).toHaveBeenCalledWith(values.id, ['r-a'], 'actor', 'tx');
      expect(ctx.audit.record).toHaveBeenCalledWith(
        {
          action: 'serviceAccount.create',
          resourceType: RESOURCE_TYPE.SERVICE_ACCOUNT,
          resourceId: values.id,
          resourceName: 'CI bot',
          changes: { after: { name: 'CI bot', roles: ['editor'] } },
        },
        'tx',
      );
      expect(ctx.permissions.permissionsChanged).toHaveBeenCalledWith([values.id]);
      expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
        changes: [
          { resource: ChangeSource.SERVICE_ACCOUNT, kind: ChangeKind.CREATE, id: values.id },
          { resource: ChangeSource.ROLE, kind: ChangeKind.UPDATE, id: 'r-a' },
        ],
      });
      expect(ctx.order).toEqual(['audit', 'commit', 'permissionsChanged', 'publish']);
      expect(ctx.repo.findById).toHaveBeenCalledWith(values.id);
    });

    it('沒有角色：不查角色、不失效權限，推播只帶服務帳號本身', async () => {
      await ctx.service.create({ name: 'bare', roleIds: [] }, ACTOR);
      expect(ctx.repo.findActiveRolesByIds).not.toHaveBeenCalled();
      expect(ctx.permissions.permissionsChanged).not.toHaveBeenCalled();
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ changes: { after: { name: 'bare', roles: [] } } }),
        'tx',
      );
      expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
        changes: [
          {
            resource: ChangeSource.SERVICE_ACCOUNT,
            kind: ChangeKind.CREATE,
            id: expect.any(String),
          },
        ],
      });
    });

    it('反提權失敗 → 不寫入', async () => {
      ctx.permissions.assertRolesAssignable.mockRejectedValue(
        Object.assign(new Error('escalation'), { code: 'AUTHZ_ESCALATION' }),
      );
      await expect(
        ctx.service.create({ name: 'x', roleIds: ['r-a'] }, ACTOR),
      ).rejects.toMatchObject({ code: 'AUTHZ_ESCALATION' });
      expect(ctx.repo.create).not.toHaveBeenCalled();
    });

    it('角色不存在或已刪除 → ROLE_NOT_FOUND，不寫入', async () => {
      await expect(
        ctx.service.create({ name: 'x', roleIds: ['r-a', 'ghost'] }, ACTOR),
      ).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
      expect(ctx.repo.create).not.toHaveBeenCalled();
    });

    it('重複的角色 id 以去重後的數量比對，不誤判為不存在', async () => {
      await ctx.service.create({ name: 'x', roleIds: ['r-a', 'r-a'] }, ACTOR);
      expect(ctx.repo.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('改名：只寫入有給的欄位，稽核只記改變的欄位，交易後失效快取再推播', async () => {
      ctx.repo.update.mockResolvedValue(accountRow({ displayName: 'Deploy bot', version: 4 }));
      await ctx.service.update('sa1', { name: 'Deploy bot', version: 3 }, ACTOR);

      expect(ctx.repo.update).toHaveBeenCalledWith(
        'sa1',
        { displayName: 'Deploy bot', updatedBy: 'actor' },
        3,
        false,
        'tx',
      );
      expect(ctx.audit.record).toHaveBeenCalledWith(
        {
          action: 'serviceAccount.update',
          resourceType: RESOURCE_TYPE.SERVICE_ACCOUNT,
          resourceId: 'sa1',
          resourceName: 'Deploy bot',
          changes: { before: { name: 'CI bot' }, after: { name: 'Deploy bot' } },
          metadata: undefined,
        },
        'tx',
      );
      expect(ctx.userCache.invalidate).toHaveBeenCalledWith('sa1');
      expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
        changes: [{ resource: ChangeSource.SERVICE_ACCOUNT, kind: ChangeKind.UPDATE, id: 'sa1' }],
      });
      expect(ctx.order).toEqual(['audit', 'commit', 'userCache', 'publish']);
    });

    it('停用 active 的帳號：要求 repository 讓 token 失效，稽核記下失效的 token 數（D5）', async () => {
      ctx.repo.update.mockResolvedValue(accountRow({ status: 'inactive', version: 4 }));
      await ctx.service.update('sa1', { status: 'inactive', version: 3 }, ACTOR);
      expect(ctx.repo.update).toHaveBeenCalledWith(
        'sa1',
        { status: 'inactive', updatedBy: 'actor' },
        3,
        true,
        'tx',
      );
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: { before: { status: 'active' }, after: { status: 'inactive' } },
          metadata: { tokensInvalidated: 2 },
        }),
        'tx',
      );
    });

    it('對已停用的帳號再停用：不算停用，不再讓 token 失效', async () => {
      ctx.repo.findById.mockResolvedValue(accountRow({ status: 'inactive' }));
      ctx.repo.update.mockResolvedValue(accountRow({ status: 'inactive' }));
      await ctx.service.update('sa1', { status: 'inactive', version: 3 }, ACTOR);
      expect(ctx.repo.update).toHaveBeenCalledWith('sa1', expect.anything(), 3, false, 'tx');
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: undefined }),
        'tx',
      );
    });

    it('啟用：不算停用', async () => {
      ctx.repo.findById.mockResolvedValue(accountRow({ status: 'inactive' }));
      await ctx.service.update('sa1', { status: 'active', version: 3 }, ACTOR);
      expect(ctx.repo.update).toHaveBeenCalledWith(
        'sa1',
        { status: 'active', updatedBy: 'actor' },
        3,
        false,
        'tx',
      );
    });

    it('不存在 → SERVICE_ACCOUNT_NOT_FOUND，不寫入', async () => {
      ctx.repo.findById.mockResolvedValue(undefined);
      await expect(
        ctx.service.update('ghost', { name: 'x', version: 1 }, ACTOR),
      ).rejects.toMatchObject({ code: 'SERVICE_ACCOUNT_NOT_FOUND' });
      expect(ctx.repo.update).not.toHaveBeenCalled();
    });

    it('目標持有 super-admin、操作者不是 → AUTHZ_ESCALATION，不寫入', async () => {
      targetIsSuperAdmin(ctx);
      await expect(
        ctx.service.update('sa1', { status: 'inactive', version: 3 }, ACTOR),
      ).rejects.toMatchObject({
        code: 'AUTHZ_ESCALATION',
        details: { role: SUPER_ADMIN_SLUG, target: 'sa1' },
      });
      expect(ctx.repo.hasRoleSlug).toHaveBeenCalledWith('sa1', SUPER_ADMIN_SLUG);
      expect(ctx.repo.update).not.toHaveBeenCalled();
    });

    it('目標持有 super-admin、操作者也是 super-admin → 可以改', async () => {
      targetIsSuperAdmin(ctx);
      ctx.permissions.getPermissionSet.mockResolvedValue({
        permissions: new Set(),
        isSuperAdmin: true,
      });
      await ctx.service.update('sa1', { status: 'inactive', version: 3 }, ACTOR);
      expect(ctx.permissions.getPermissionSet).toHaveBeenCalledWith('actor');
      expect(ctx.repo.update).toHaveBeenCalled();
    });

    it('條件式 UPDATE 沒命中、帳號還在 → SERVICE_ACCOUNT_VERSION_CONFLICT 帶目前版本，不寫稽核', async () => {
      ctx.repo.update.mockResolvedValue(undefined);
      ctx.repo.findVersion.mockResolvedValue(5);
      await expect(
        ctx.service.update('sa1', { name: 'x', version: 3 }, ACTOR),
      ).rejects.toMatchObject({
        code: 'SERVICE_ACCOUNT_VERSION_CONFLICT',
        details: { current: 5 },
      });
      expect(ctx.repo.findVersion).toHaveBeenCalledWith('sa1', 'tx');
      expect(ctx.audit.record).not.toHaveBeenCalled();
      expect(ctx.userCache.invalidate).not.toHaveBeenCalled();
      expect(ctx.events.publish).not.toHaveBeenCalled();
    });

    it('條件式 UPDATE 沒命中、帳號已被刪除 → SERVICE_ACCOUNT_NOT_FOUND', async () => {
      ctx.repo.update.mockResolvedValue(undefined);
      ctx.repo.findVersion.mockResolvedValue(undefined);
      await expect(
        ctx.service.update('sa1', { name: 'x', version: 3 }, ACTOR),
      ).rejects.toMatchObject({ code: 'SERVICE_ACCOUNT_NOT_FOUND' });
    });
  });

  describe('remove', () => {
    it('軟刪除並在同一交易撤銷全部 token，稽核記撤銷數；交易後失效快取與權限，推播帶持有的角色', async () => {
      ctx.repo.findById.mockResolvedValue(accountRow({ roles: [ROLE_A, ROLE_B] }));
      await ctx.service.remove('sa1', ACTOR);

      expect(ctx.repo.softDelete).toHaveBeenCalledWith('sa1', 'actor', 'tx');
      expect(ctx.tokens.revokeAllInTransaction).toHaveBeenCalledWith('sa1', 'actor', 'tx');
      expect(ctx.audit.record).toHaveBeenCalledWith(
        {
          action: 'serviceAccount.delete',
          resourceType: RESOURCE_TYPE.SERVICE_ACCOUNT,
          resourceId: 'sa1',
          resourceName: 'CI bot',
          changes: { before: { name: 'CI bot', status: 'active' } },
          metadata: { tokensRevoked: 2 },
        },
        'tx',
      );
      expect(ctx.userCache.invalidate).toHaveBeenCalledWith('sa1');
      expect(ctx.permissions.invalidateUser).toHaveBeenCalledWith('sa1');
      expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
        changes: [
          { resource: ChangeSource.SERVICE_ACCOUNT, kind: ChangeKind.DELETE, id: 'sa1' },
          { resource: ChangeSource.ROLE, kind: ChangeKind.UPDATE, id: 'r-a' },
          { resource: ChangeSource.ROLE, kind: ChangeKind.UPDATE, id: 'r-b' },
        ],
      });
      expect(ctx.order).toEqual(['audit', 'commit', 'userCache', 'invalidateUser', 'publish']);
    });

    it('不存在 → SERVICE_ACCOUNT_NOT_FOUND，不刪除', async () => {
      ctx.repo.findById.mockResolvedValue(undefined);
      await expect(ctx.service.remove('ghost', ACTOR)).rejects.toMatchObject({
        code: 'SERVICE_ACCOUNT_NOT_FOUND',
      });
      expect(ctx.repo.softDelete).not.toHaveBeenCalled();
    });

    it('目標持有 super-admin、操作者不是 → AUTHZ_ESCALATION，不刪除也不撤銷 token', async () => {
      targetIsSuperAdmin(ctx);
      await expect(ctx.service.remove('sa1', ACTOR)).rejects.toMatchObject({
        code: 'AUTHZ_ESCALATION',
      });
      expect(ctx.repo.softDelete).not.toHaveBeenCalled();
      expect(ctx.tokens.revokeAllInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('replaceRoles', () => {
    it('預期的角色相符 → 鎖列後整批取代，稽核記前後的 slug；提交後失效權限，推播帶新舊角色的聯集', async () => {
      const result = await ctx.service.replaceRoles(
        'sa1',
        { roleIds: ['r-b'], expectedRoleIds: ['r-a'] },
        ACTOR,
      );

      expect(ctx.permissions.assertRolesAssignable).toHaveBeenCalledWith('actor', ['r-b']);
      expect(ctx.repo.lockForUpdate).toHaveBeenCalledWith('sa1', 'tx');
      expect(ctx.repo.listRoles).toHaveBeenCalledWith('sa1', 'tx');
      expect(ctx.repo.replaceRoles).toHaveBeenCalledWith('sa1', ['r-b'], 'actor', 'tx');
      expect(ctx.audit.record).toHaveBeenCalledWith(
        {
          action: 'serviceAccount.assignRole',
          resourceType: RESOURCE_TYPE.SERVICE_ACCOUNT,
          resourceId: 'sa1',
          resourceName: 'CI bot',
          changes: { before: { roles: ['editor'] }, after: { roles: ['viewer'] } },
        },
        'tx',
      );
      expect(ctx.permissions.permissionsChanged).toHaveBeenCalledWith(['sa1']);
      expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
        changes: [
          { resource: ChangeSource.SERVICE_ACCOUNT, kind: ChangeKind.UPDATE, id: 'sa1' },
          { resource: ChangeSource.ROLE, kind: ChangeKind.UPDATE, id: 'r-a' },
          { resource: ChangeSource.ROLE, kind: ChangeKind.UPDATE, id: 'r-b' },
        ],
      });
      expect(ctx.order).toEqual(['audit', 'commit', 'permissionsChanged', 'publish']);
      // 回傳交易後重讀的角色
      expect(ctx.repo.listRoles).toHaveBeenLastCalledWith('sa1');
      expect(result).toEqual({ roles: [ROLE_A] });
    });

    it('角色不變時推播的角色 id 去重', async () => {
      await ctx.service.replaceRoles('sa1', { roleIds: ['r-a'], expectedRoleIds: ['r-a'] }, ACTOR);
      expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
        changes: [
          { resource: ChangeSource.SERVICE_ACCOUNT, kind: ChangeKind.UPDATE, id: 'sa1' },
          { resource: ChangeSource.ROLE, kind: ChangeKind.UPDATE, id: 'r-a' },
        ],
      });
    });

    it('清空角色：不查角色是否存在，稽核的 after 是空陣列', async () => {
      await ctx.service.replaceRoles('sa1', { roleIds: [], expectedRoleIds: ['r-a'] }, ACTOR);
      expect(ctx.repo.findActiveRolesByIds).not.toHaveBeenCalled();
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: { before: { roles: ['editor'] }, after: { roles: [] } },
        }),
        'tx',
      );
    });

    it.each([
      ['少了一個', [] as string[]],
      ['多了一個', ['r-a', 'r-b']],
      ['數量相同但不同', ['r-b']],
    ])(
      '預期的角色與目前的不同（%s）→ SERVICE_ACCOUNT_ROLES_CONFLICT 帶目前的角色 id，不寫入',
      async (_label, expectedRoleIds) => {
        await expect(
          ctx.service.replaceRoles('sa1', { roleIds: ['r-b'], expectedRoleIds }, ACTOR),
        ).rejects.toMatchObject({
          code: 'SERVICE_ACCOUNT_ROLES_CONFLICT',
          details: { currentRoleIds: ['r-a'] },
        });
        expect(ctx.repo.replaceRoles).not.toHaveBeenCalled();
        expect(ctx.audit.record).not.toHaveBeenCalled();
        expect(ctx.permissions.permissionsChanged).not.toHaveBeenCalled();
        expect(ctx.events.publish).not.toHaveBeenCalled();
      },
    );

    it('不存在 → SERVICE_ACCOUNT_NOT_FOUND', async () => {
      ctx.repo.findById.mockResolvedValue(undefined);
      await expect(
        ctx.service.replaceRoles('ghost', { roleIds: [], expectedRoleIds: [] }, ACTOR),
      ).rejects.toMatchObject({ code: 'SERVICE_ACCOUNT_NOT_FOUND' });
      expect(ctx.repo.replaceRoles).not.toHaveBeenCalled();
    });

    it('目標持有 super-admin、操作者不是 → AUTHZ_ESCALATION，不檢查可指派、不寫入', async () => {
      targetIsSuperAdmin(ctx);
      await expect(
        ctx.service.replaceRoles('sa1', { roleIds: [], expectedRoleIds: ['r-a'] }, ACTOR),
      ).rejects.toMatchObject({ code: 'AUTHZ_ESCALATION' });
      expect(ctx.permissions.assertRolesAssignable).not.toHaveBeenCalled();
      expect(ctx.repo.replaceRoles).not.toHaveBeenCalled();
    });

    it('反提權失敗 → 不開交易', async () => {
      ctx.permissions.assertRolesAssignable.mockRejectedValue(
        Object.assign(new Error('escalation'), { code: 'AUTHZ_ESCALATION' }),
      );
      await expect(
        ctx.service.replaceRoles('sa1', { roleIds: ['r-b'], expectedRoleIds: ['r-a'] }, ACTOR),
      ).rejects.toMatchObject({ code: 'AUTHZ_ESCALATION' });
      expect(ctx.repo.lockForUpdate).not.toHaveBeenCalled();
    });

    it('新角色不存在 → ROLE_NOT_FOUND，不開交易', async () => {
      await expect(
        ctx.service.replaceRoles('sa1', { roleIds: ['ghost'], expectedRoleIds: ['r-a'] }, ACTOR),
      ).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
      expect(ctx.repo.lockForUpdate).not.toHaveBeenCalled();
    });
  });

  describe('API token', () => {
    it('listTokens：以 service 類型取帳號（找不到時用 SERVICE_ACCOUNT_NOT_FOUND），回傳它的 token', async () => {
      await expect(ctx.service.listTokens('sa1')).resolves.toEqual({ items: [{ id: 't1' }] });
      expect(ctx.tokens.requireAccount).toHaveBeenCalledWith(
        'sa1',
        'service',
        'SERVICE_ACCOUNT_NOT_FOUND',
      );
      expect(ctx.tokens.list).toHaveBeenCalledWith(ctx.account);
    });

    it('createToken：交給 ApiTokenService 建立（反提權在那裡，D4）', async () => {
      const dto = { name: 'deploy', scopes: [] } as never;
      await expect(ctx.service.createToken('sa1', dto, ACTOR)).resolves.toEqual({
        id: 't2',
        token: 'secret',
      });
      expect(ctx.tokens.create).toHaveBeenCalledWith(ctx.account, dto, ACTOR);
    });

    it('createToken：目標持有 super-admin、操作者不是 → AUTHZ_ESCALATION，不建立', async () => {
      targetIsSuperAdmin(ctx);
      await expect(
        ctx.service.createToken('sa1', { name: 'x' } as never, ACTOR),
      ).rejects.toMatchObject({ code: 'AUTHZ_ESCALATION' });
      expect(ctx.tokens.create).not.toHaveBeenCalled();
    });

    it('revokeToken：以 service 類型取帳號後撤銷', async () => {
      await ctx.service.revokeToken('sa1', 't1', ACTOR);
      expect(ctx.tokens.requireAccount).toHaveBeenCalledWith(
        'sa1',
        'service',
        'SERVICE_ACCOUNT_NOT_FOUND',
      );
      expect(ctx.tokens.revoke).toHaveBeenCalledWith(ctx.account, 't1', ACTOR);
    });

    it('帳號不存在時 requireAccount 的錯誤原樣拋出，不撤銷', async () => {
      ctx.tokens.requireAccount.mockRejectedValue(
        Object.assign(new Error('nf'), { code: 'SERVICE_ACCOUNT_NOT_FOUND' }),
      );
      await expect(ctx.service.revokeToken('ghost', 't1', ACTOR)).rejects.toMatchObject({
        code: 'SERVICE_ACCOUNT_NOT_FOUND',
      });
      expect(ctx.tokens.revoke).not.toHaveBeenCalled();
    });
  });
});
