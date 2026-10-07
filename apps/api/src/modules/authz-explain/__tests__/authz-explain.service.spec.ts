import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { AuthzService } from '@/core/authz';
import { createPermissionChecks } from '@/modules/permission/__tests__/permission-checks.fixture';

import type { AuthzExplainRepository } from '../authz-explain.repository';
import { AuthzExplainService } from '../authz-explain.service';

const ACTOR = { id: 'me', email: 'me@example.com' } as AuthUser;

function createService(actorKeys: string[], options: { isSuperAdmin?: boolean } = {}) {
  const repo = {
    userNames: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `U-${id}`]))),
    groupNames: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `G-${id}`]))),
    roleNames: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `R-${id}`]))),
  };
  const authz = {
    // 操作者直接所屬 group:mine、直接持有 role:own
    closurePaths: vi.fn(
      async () =>
        new Map([
          ['user:me', ['user:me']],
          ['group:mine#member', ['user:me', 'group:mine#member']],
          ['group:parent#member', ['user:me', 'group:mine#member', 'group:parent#member']],
          ['role:own#holder', ['user:me', 'role:own#holder']],
        ]),
    ),
    tenantSourcesOf: vi.fn(),
  };
  const { service: permissions, audit } = createPermissionChecks(() => ({
    permissions: new Set(actorKeys),
    isSuperAdmin: options.isSuperAdmin ?? false,
  }));
  const service = new AuthzExplainService(
    repo as unknown as AuthzExplainRepository,
    authz as unknown as AuthzService,
    permissions,
  );
  return { service, audit };
}

describe('AuthzExplainService.assertCanExplain（docs/architecture/iam/01-model.md §9 G4b）', () => {
  it('查自己：不需要任何權限', async () => {
    const { service } = createService([]);
    await expect(service.assertCanExplain(ACTOR, 'me', 'route')).resolves.toBeUndefined();
  });

  it('查別人：有 authz:explain 就可以', async () => {
    const { service } = createService(['authz:explain']);
    await expect(service.assertCanExplain(ACTOR, 'other', 'route')).resolves.toBeUndefined();
  });

  it('查別人、沒有 authz:explain → 403 AUTHZ_FORBIDDEN 並寫 authz.denied', async () => {
    const { service, audit } = createService(['user:read']);
    await expect(service.assertCanExplain(ACTOR, 'other', 'GET /x')).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
      details: { required: ['authz:explain'], missing: ['authz:explain'] },
    });
    expect(audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'authz.denied',
        metadata: {
          targetUserId: 'other',
          route: 'GET /x',
          required: ['authz:explain'],
          missing: ['authz:explain'],
        },
      }),
    );
  });
});

describe('AuthzExplainService.describePaths（D14 遮蔽）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService([]);
  });

  it('沒有讀取權：上層群組、別人的角色遮成型別；直接所屬的群組、直接持有的角色照樣顯示', async () => {
    const [nodes] = await ctx.service.describePaths(ACTOR, [
      [
        'user:me',
        'group:mine#member',
        'group:parent#member',
        'role:other#holder',
        'tenant:self#file:read',
      ],
    ]);
    expect(nodes).toEqual([
      { type: 'user', id: 'me', relation: '', name: 'U-me', hidden: false },
      { type: 'group', id: 'mine', relation: 'member', name: 'G-mine', hidden: false },
      { type: 'group', id: null, relation: 'member', name: null, hidden: true },
      { type: 'role', id: null, relation: 'holder', name: null, hidden: true },
      { type: 'tenant', id: 'self', relation: 'file:read', name: null, hidden: false },
    ]);
    const [own] = await ctx.service.describePaths(ACTOR, [['user:me', 'role:own#holder']]);
    expect(own?.[1]).toMatchObject({ id: 'own', name: 'R-own', hidden: false });
  });

  it('有 group:read／role:read／user:read：都顯示', async () => {
    const reader = createService(['group:read', 'role:read', 'user:read']);
    const [nodes] = await reader.service.describePaths(ACTOR, [
      ['user:alice', 'group:parent#member', 'role:other#holder'],
    ]);
    expect(nodes?.every((node) => !node.hidden)).toBe(true);
  });

  it('其他型別交給呼叫端的 resolver；沒有 resolver 或它沒回的節點當作讀不到', async () => {
    const resolver = vi.fn(
      async () => new Map([['fileFolder:a#viewer', { name: '素材', visible: true }]]),
    );
    const [nodes] = await ctx.service.describePaths(
      ACTOR,
      [['fileFolder:a#viewer', 'fileFolder:b#viewer', 'fileRoot:root#can_read']],
      resolver,
    );
    expect(resolver).toHaveBeenCalledWith(['fileFolder:a#viewer', 'fileFolder:b#viewer']);
    expect(nodes?.map((node) => [node.name, node.hidden])).toEqual([
      ['素材', false],
      [null, true],
      [null, false],
    ]);
  });
});
