import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { PermissionSet } from '@/core/cache';
import type { Transaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DataTransferRegistry } from '@/modules/data-transfer/data-transfer-registry.service';
import { DATA_TRANSFER_EXPORT_PAGE_SIZE } from '@/modules/data-transfer/data-transfer.constants';
import type {
  AnyTransferResource,
  ExportScope,
  MatchResult,
  ResolvedRow,
  TransferContext,
} from '@/modules/data-transfer/data-transfer.types';
import type { PermissionService } from '@/modules/permission/permission.service';

import type { GroupExportRow, GroupMembershipRow, GroupRepository } from '../group.repository';
import type { GroupAfterCommit, GroupService } from '../group.service';
import { GroupTransferResource } from '../group.transfer';

const ACTOR: AuthUser = { id: 'actor-1', email: 'actor@example.com', status: 'active' };
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const G3 = '33333333-3333-4333-8333-333333333333';
const TX = { name: 'tx' } as unknown as Transaction;

const ctx: TransferContext = {
  actor: ACTOR,
  locale: 'zh-TW',
  timezone: 'Asia/Taipei',
  signal: new AbortController().signal,
  can: () => true,
};

function groupRow(overrides: Partial<GroupExportRow> = {}): GroupExportRow {
  return {
    id: G1,
    name: 'Support',
    description: null,
    version: 3,
    memberCount: 2,
    roleCount: 1,
    roles: [{ id: 'role-a', name: 'Agent' }],
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  } as GroupExportRow;
}

function membershipRow(overrides: Partial<GroupMembershipRow> = {}): GroupMembershipRow {
  return {
    groupId: G1,
    groupName: 'Support',
    type: 'user',
    memberId: 'user-1',
    member: 'alice@example.com',
    memberName: 'Alice',
    ...overrides,
  };
}

const EMPTY_AFTER: GroupAfterCommit = { changes: [], affectedUserIds: [] };

function setup(options: { permissionSet?: PermissionSet } = {}) {
  const permissionSet: PermissionSet = options.permissionSet ?? {
    permissions: new Set(),
    isSuperAdmin: false,
    subjects: [],
  };
  const repo = {
    searchForImport: vi.fn(
      async () => [] as Array<{ id: string; name: string; description: string | null }>,
    ),
    searchActiveRoles: vi.fn(async () => [] as Array<{ id: string; name: string }>),
    searchActiveUsers: vi.fn(async () => [] as Array<{ id: string; email: string }>),
    exportCount: vi.fn(async () => 0),
    exportMemberCount: vi.fn(async () => 0),
    exportPage: vi.fn(
      async (_scope: unknown, _after: unknown, _limit: number) => [] as GroupExportRow[],
    ),
    exportMembers: vi.fn(async () => [] as GroupMembershipRow[]),
    findTakenNames: vi.fn(async () => new Set<string>()),
    findForImport: vi.fn(async () => [] as GroupExportRow[]),
    findActiveRolesByNames: vi.fn(
      async () => [] as Array<{ id: string; slug: string; name: string }>,
    ),
    findActiveGroupsByNames: vi.fn(async () => [] as Array<{ id: string; name: string }>),
    findActiveUsersByEmails: vi.fn(async () => [] as Array<{ id: string; email: string }>),
    findActiveRoles: vi.fn(async () => [] as Array<{ id: string; slug: string }>),
    findExistingMemberships: vi.fn(async () => new Set<string>()),
  };
  const groups = {
    createInTx: vi.fn(async () => ({ group: { id: G1 }, after: EMPTY_AFTER })),
    updateInTx: vi.fn(async () => ({ after: EMPTY_AFTER })),
    updateRolesInTx: vi.fn(async () => ({ after: EMPTY_AFTER })),
    replaceRolesInTx: vi.fn(async () => ({ after: EMPTY_AFTER })),
    updateMembersInTx: vi.fn(async () => ({ after: EMPTY_AFTER })),
  };
  const permissions = {
    assertRolesAssignable: vi.fn(
      async (_actorId: string, _roleIds: readonly string[]) => undefined,
    ),
    assertCanGrant: vi.fn(
      async (_actorId: string, _grants: ReadonlyArray<{ object: { id: string } }>) => undefined,
    ),
    getPermissionSet: vi.fn(async () => permissionSet),
    getPermissionSets: vi.fn(async () => new Map<string, PermissionSet>()),
  };
  const registry = new DataTransferRegistry();
  new GroupTransferResource(
    registry,
    repo as unknown as GroupRepository,
    groups as unknown as GroupService,
    permissions as unknown as PermissionService,
  ).onModuleInit();
  const group = registry.find('group') as AnyTransferResource;
  const member = registry.find('groupMember') as AnyTransferResource;
  return { repo, groups, permissions, group, member };
}

function column(resource: AnyTransferResource, key: string) {
  const found = resource.columns.find((item) => item.key === key);
  if (!found) throw new Error(`沒有欄位 ${key}`);
  return found;
}

function target(record: GroupExportRow, expected?: Record<string, unknown>): MatchResult<unknown> {
  return { id: record.id, label: record.name, version: record.version, record, expected };
}

async function collect<T>(pages: AsyncIterable<readonly T[]>): Promise<T[][]> {
  const result: T[][] = [];
  for await (const page of pages) result.push([...page]);
  return result;
}

describe('GroupTransferResource 群組（docs/architecture/backend/22-data-transfer.md §12.2）', () => {
  describe('登記與欄位', () => {
    it('登記 group 與 groupMember 兩種資源，都屬於 group feature', () => {
      const { group, member } = setup();
      expect(group.feature).toBe('group');
      expect(member.feature).toBe('group');
      expect(group.importer?.modes).toHaveProperty('create');
      expect(group.importer?.modes).toHaveProperty('update');
      expect(Object.keys(member.importer?.modes ?? {})).toEqual(['create']);
    });

    it('匯出的值：id、名稱、說明、角色名稱、直接成員數、建立時間', () => {
      const { group } = setup();
      const record = groupRow({
        description: '客服',
        roles: [
          { id: 'role-a', name: 'Agent' },
          { id: 'role-b', name: 'Lead' },
        ],
      });
      const values = Object.fromEntries(
        group.columns.map((item) => [item.key, item.export?.get(record)]),
      );
      expect(values).toEqual({
        id: G1,
        name: 'Support',
        description: '客服',
        roles: ['Agent', 'Lead'],
        memberCount: 2,
        createdAt: record.createdAt,
      });
    });

    it('名稱的自動完成回傳現有群組的名稱', async () => {
      const { group, repo } = setup();
      repo.searchForImport.mockResolvedValue([
        { id: G1, name: 'Support', description: null },
        { id: G2, name: 'Sales', description: null },
      ]);
      await expect(column(group, 'name').import?.suggest?.('s', ctx)).resolves.toEqual([
        'Support',
        'Sales',
      ]);
      expect(repo.searchForImport).toHaveBeenCalledWith('s', 20);
    });

    it('角色欄的搜尋回傳 { id, label }', async () => {
      const { group, repo } = setup();
      repo.searchActiveRoles.mockResolvedValue([{ id: 'role-a', name: 'Agent' }]);
      await expect(column(group, 'roles').reference?.search('ag', ctx)).resolves.toEqual([
        { id: 'role-a', label: 'Agent' },
      ]);
    });
  });

  describe('角色參照的解析', () => {
    it('依序以名稱、代碼、id 比對（不分大小寫、去空白），沒對上的不出現', async () => {
      const { group, repo } = setup();
      repo.findActiveRolesByNames.mockResolvedValue([
        { id: 'role-a', slug: 'agent', name: 'Agent' },
        { id: 'role-b', slug: 'team-lead', name: 'Lead' },
        { id: 'role-c', slug: 'auditor', name: 'Auditor' },
      ]);
      const resolved = await column(group, 'roles').reference?.resolve(
        [' AGENT ', 'team-lead', 'role-c', 'missing'],
        ctx,
      );
      expect(resolved).toEqual(
        new Map([
          ['agent', { id: 'role-a', label: 'Agent' }],
          ['team-lead', { id: 'role-b', label: 'Lead' }],
          ['role-c', { id: 'role-c', label: 'Auditor' }],
        ]),
      );
    });
  });

  describe('匯出', () => {
    it('依建立時間的 keyset 逐頁讀，最後一頁不滿一頁就停', async () => {
      const { group, repo } = setup();
      const full = Array.from({ length: DATA_TRANSFER_EXPORT_PAGE_SIZE }, (_, index) =>
        groupRow({ id: `g-${index}`, createdAt: new Date(2026, 0, 1, 0, 0, index) }),
      );
      const last = full.at(-1)!;
      repo.exportPage.mockResolvedValueOnce(full).mockResolvedValueOnce([groupRow({ id: 'tail' })]);
      const scope: ExportScope<unknown> = { kind: 'filter', filter: { keyword: 'sup' } };

      const pages = await collect(group.exporter!.iterate(scope, ctx));

      expect(pages.map((page) => page.length)).toEqual([DATA_TRANSFER_EXPORT_PAGE_SIZE, 1]);
      expect(repo.exportPage).toHaveBeenNthCalledWith(
        1,
        { filter: { keyword: 'sup' } },
        null,
        DATA_TRANSFER_EXPORT_PAGE_SIZE,
      );
      expect(repo.exportPage).toHaveBeenNthCalledWith(
        2,
        { filter: { keyword: 'sup' } },
        { createdAt: last.createdAt, id: last.id },
        DATA_TRANSFER_EXPORT_PAGE_SIZE,
      );
    });

    it('滿頁之後下一頁是空的：不輸出空頁就結束', async () => {
      const { group, repo } = setup();
      const full = Array.from({ length: DATA_TRANSFER_EXPORT_PAGE_SIZE }, (_, index) =>
        groupRow({ id: `g-${index}` }),
      );
      repo.exportPage.mockResolvedValueOnce(full).mockResolvedValueOnce([]);
      const pages = await collect(group.exporter!.iterate({ kind: 'ids', ids: [G1] }, ctx));
      expect(pages).toHaveLength(1);
      expect(repo.exportPage).toHaveBeenCalledTimes(2);
      expect(repo.exportPage.mock.calls[0]?.[0]).toEqual({ ids: [G1] });
    });

    it.each([
      [{ kind: 'ids', ids: [G1, G2] }, { ids: [G1, G2] }],
      [{ kind: 'filter', filter: { roleId: 'role-a' } }, { filter: { roleId: 'role-a' } }],
    ] as const)('筆數：範圍 %j → repository 的 %j', async (scope, expected) => {
      const { group, repo } = setup();
      repo.exportCount.mockResolvedValue(7);
      await expect(group.exporter!.count(scope, ctx)).resolves.toBe(7);
      expect(repo.exportCount).toHaveBeenCalledWith(expected);
    });

    it('範本的抽樣取全部群組的第一頁', async () => {
      const { group, repo } = setup();
      repo.exportPage.mockResolvedValue([groupRow()]);
      await expect(group.importer!.sampleRecords!(ctx, 5)).resolves.toHaveLength(1);
      expect(repo.exportPage).toHaveBeenCalledWith({ filter: {} }, null, 5);
    });
  });

  describe('修改模式的比對', () => {
    it('以名稱比對：key 是小寫名稱，同名多筆都列出，帶上目前的角色 id 當 expected', async () => {
      const { group, repo } = setup();
      const a = groupRow({ id: G1, name: 'Support' });
      const b = groupRow({ id: G2, name: 'support', roles: [] });
      repo.findForImport.mockResolvedValue([a, b]);

      const result = await group.importer!.resolveTargets!('name', ['Support'], ctx);

      expect(repo.findForImport).toHaveBeenCalledWith('name', ['Support']);
      expect(result.get('support')).toEqual([
        { id: G1, label: 'Support', version: 3, record: a, expected: { roleIds: ['role-a'] } },
        { id: G2, label: 'support', version: 3, record: b, expected: { roleIds: [] } },
      ]);
    });

    it('以 ID 比對：不是 uuid 的值不查詢', async () => {
      const { group, repo } = setup();
      repo.findForImport.mockResolvedValue([groupRow({ id: G1 })]);
      const result = await group.importer!.resolveTargets!('id', [G1, 'not-a-uuid'], ctx);
      expect(repo.findForImport).toHaveBeenCalledWith('id', [G1]);
      expect([...result.keys()]).toEqual([G1]);
    });

    it('手動指定目標：以 id 找，每個 id 取第一筆', async () => {
      const { group, repo } = setup();
      repo.findForImport.mockResolvedValue([groupRow({ id: G1 })]);
      const found = await group.importer!.findTargetsById!([G1, G2], ctx);
      expect([...found.keys()]).toEqual([G1]);
      expect(found.get(G1)?.id).toBe(G1);
    });

    it('目標的下拉選單：有說明才帶 description', async () => {
      const { group, repo } = setup();
      repo.searchForImport.mockResolvedValue([
        { id: G1, name: 'Support', description: '客服' },
        { id: G2, name: 'Sales', description: null },
      ]);
      await expect(group.importer!.searchTargets!('s', ctx)).resolves.toEqual([
        { id: G1, label: 'Support', description: '客服' },
        { id: G2, label: 'Sales' },
      ]);
    });

    it('新增模式的重複名稱交給 repository 查', async () => {
      const { group, repo } = setup();
      repo.findTakenNames.mockResolvedValue(new Set(['support']));
      await expect(group.importer!.findExisting!('name', ['Support'], ctx)).resolves.toEqual(
        new Set(['support']),
      );
    });
  });

  describe('驗證', () => {
    it('沒有任何列帶角色（或修改模式沒改角色）時不查角色與權限', async () => {
      const { group, repo, permissions } = setup();
      const rows: ResolvedRow[] = [
        { rowNo: 1, values: { name: 'A' } },
        { rowNo: 2, values: { roles: ['role-a'] }, target: target(groupRow()), changed: [] },
      ];
      const issues = await group.importer!.validateRows!('update', rows, ctx);
      expect(issues.size).toBe(0);
      expect(repo.findActiveRoles).not.toHaveBeenCalled();
      expect(permissions.assertRolesAssignable).not.toHaveBeenCalled();
    });

    it('super-admin 角色 → superAdminForbidden，且不拿它去檢查是否可指派', async () => {
      const { group, repo, permissions } = setup();
      repo.findActiveRoles.mockResolvedValue([
        { id: 'role-sa', slug: 'super-admin' },
        { id: 'role-a', slug: 'agent' },
      ]);
      const issues = await group.importer!.validateRows!(
        'create',
        [{ rowNo: 2, values: { name: 'A', roles: ['role-sa', 'role-a'] } }],
        ctx,
      );
      expect(issues.get(2)).toEqual([
        { column: 'roles', code: 'superAdminForbidden', severity: 'error' },
      ]);
      expect(permissions.assertRolesAssignable).toHaveBeenCalledTimes(1);
      expect(permissions.assertRolesAssignable).toHaveBeenCalledWith(ACTOR.id, ['role-a']);
    });

    it('不能指派的角色 → roleNotAssignable，參數是角色名稱（查不到名稱時用 id）', async () => {
      const { group, repo, permissions } = setup();
      repo.findActiveRoles.mockResolvedValue([
        { id: 'role-a', slug: 'agent' },
        { id: 'role-x', slug: 'x' },
      ]);
      repo.findActiveRolesByNames.mockResolvedValue([
        { id: 'role-a', slug: 'agent', name: 'Agent' },
      ]);
      permissions.assertRolesAssignable.mockRejectedValue(new AppException('AUTHZ_FORBIDDEN'));

      const issues = await group.importer!.validateRows!(
        'create',
        [{ rowNo: 3, values: { name: 'A', roles: ['role-a', 'role-x'] } }],
        ctx,
      );

      expect(issues.get(3)).toEqual([
        {
          column: 'roles',
          code: 'roleNotAssignable',
          params: { names: ['Agent', 'role-x'] },
          severity: 'error',
        },
      ]);
    });

    it('修改模式只看新增的角色：目前已持有、但自己不能指派的角色不算提權', async () => {
      const { group, repo, permissions } = setup();
      repo.findActiveRoles.mockResolvedValue([{ id: 'role-a', slug: 'agent' }]);
      permissions.assertRolesAssignable.mockRejectedValue(new AppException('AUTHZ_FORBIDDEN'));
      const record = groupRow({ id: G2, roles: [{ id: 'role-a', name: 'Agent' }] });

      const issues = await group.importer!.validateRows!(
        'update',
        [{ rowNo: 4, values: { roles: ['role-a'] }, target: target(record), changed: ['roles'] }],
        ctx,
      );

      expect(issues.size).toBe(0);
    });

    it('修改自己所屬（含巢狀）群組的角色 → selfModify，不再做其他角色檢查', async () => {
      const { group, repo } = setup({
        permissionSet: {
          permissions: new Set(),
          isSuperAdmin: false,
          subjects: [
            'user:actor-1',
            `group:${G2}#member`,
            'role:role-a#holder',
            `group:${G3}#owner`,
          ],
        },
      });
      repo.findActiveRoles.mockResolvedValue([{ id: 'role-sa', slug: 'super-admin' }]);

      const issues = await group.importer!.validateRows!(
        'update',
        [
          {
            rowNo: 5,
            values: { roles: ['role-sa'] },
            target: target(groupRow({ id: G2 })),
            changed: ['roles'],
          },
          {
            rowNo: 6,
            values: { roles: ['role-sa'] },
            target: target(groupRow({ id: G3 })),
            changed: ['roles'],
          },
        ],
        ctx,
      );

      expect(issues.get(5)).toEqual([{ column: 'roles', code: 'selfModify', severity: 'error' }]);
      // G3 只是 owner 關係，不算「所屬」
      expect(issues.get(6)).toEqual([
        { column: 'roles', code: 'superAdminForbidden', severity: 'error' },
      ]);
    });

    it('權限集合沒有 subjects 時視為不屬於任何群組', async () => {
      const { group, permissions } = setup();
      permissions.getPermissionSet.mockResolvedValue({
        permissions: new Set(),
        isSuperAdmin: false,
      });
      const issues = await group.importer!.validateRows!(
        'update',
        [{ rowNo: 7, values: { roles: [] }, target: target(groupRow()), changed: ['roles'] }],
        ctx,
      );
      expect(issues.size).toBe(0);
    });

    it('反提權檢查拋出非 AppException 的錯誤時原樣往外拋', async () => {
      const { group, permissions } = setup();
      permissions.assertRolesAssignable.mockRejectedValue(new Error('db down'));
      await expect(
        group.importer!.validateRows!('create', [{ rowNo: 1, values: { roles: ['role-a'] } }], ctx),
      ).rejects.toThrow('db down');
    });
  });

  describe('套用', () => {
    it('新增：建立群組（有說明才帶）並合併權限失效與推播的副作用；沒有角色不指派', async () => {
      const { group, groups } = setup();
      const change = { resource: 'group', kind: 'create', id: G1 } as const;
      groups.createInTx.mockResolvedValue({
        group: { id: G1 },
        after: { changes: [change], affectedUserIds: ['u1'], permissionsChanged: ['u1'] },
      });

      const result = await group.importer!.create!({ name: 'Support' }, ctx, TX);

      expect(groups.createInTx).toHaveBeenCalledWith({ name: 'Support' }, ACTOR, TX);
      expect(groups.updateRolesInTx).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: G1,
        after: [
          { kind: 'permissionsChanged', userIds: ['u1'] },
          { kind: 'resourceChanged', change, affectedUserIds: ['u1'] },
        ],
      });
    });

    it('新增：帶說明與角色時，建立後在同一個交易指派角色', async () => {
      const { group, groups } = setup();
      const change = { resource: 'group', kind: 'update', id: G1 } as const;
      groups.updateRolesInTx.mockResolvedValue({
        after: { changes: [change], affectedUserIds: [] },
      });

      const result = await group.importer!.create!(
        { name: 'Support', description: '客服', roles: ['role-a'] },
        ctx,
        TX,
      );

      expect(groups.createInTx).toHaveBeenCalledWith(
        { name: 'Support', description: '客服' },
        ACTOR,
        TX,
      );
      expect(groups.updateRolesInTx).toHaveBeenCalledWith(
        G1,
        { add: ['role-a'], remove: [] },
        ACTOR,
        TX,
      );
      expect(result.after).toEqual([{ kind: 'resourceChanged', change, affectedUserIds: [] }]);
    });

    it('新增：角色是空陣列時不指派', async () => {
      const { group, groups } = setup();
      await group.importer!.create!({ name: 'Support', roles: [] }, ctx, TX);
      expect(groups.updateRolesInTx).not.toHaveBeenCalled();
    });

    it('修改：說明以 version 樂觀鎖更新，\\N（null）清空', async () => {
      const { group, groups } = setup();
      const result = await group.importer!.update!(
        { id: G1, version: 4 },
        { description: null },
        ctx,
        TX,
      );
      expect(groups.updateInTx).toHaveBeenCalledWith(
        G1,
        { description: null, version: 4 },
        ACTOR,
        TX,
      );
      expect(groups.replaceRolesInTx).not.toHaveBeenCalled();
      expect(result).toEqual({ id: G1, after: [] });
    });

    it('修改：角色整組取代，帶比對當下的角色當 expectedRoleIds', async () => {
      const { group, groups } = setup();
      await group.importer!.update!(
        { id: G1, version: 4, expected: { roleIds: ['role-a'] } },
        { description: '新說明', roles: ['role-b'] },
        ctx,
        TX,
      );
      expect(groups.updateInTx).toHaveBeenCalledWith(
        G1,
        { description: '新說明', version: 4 },
        ACTOR,
        TX,
      );
      expect(groups.replaceRolesInTx).toHaveBeenCalledWith(
        G1,
        { roleIds: ['role-b'], expectedRoleIds: ['role-a'] },
        ACTOR,
        TX,
      );
    });

    it('修改：沒有 expected 時不帶 expectedRoleIds；角色值不是陣列時視為清空', async () => {
      const { group, groups } = setup();
      await group.importer!.update!({ id: G1, version: 4 }, { roles: null }, ctx, TX);
      expect(groups.updateInTx).not.toHaveBeenCalled();
      expect(groups.replaceRolesInTx).toHaveBeenCalledWith(G1, { roleIds: [] }, ACTOR, TX);
    });

    it('修改：GroupService 的錯誤（例：版本衝突）原樣往外拋', async () => {
      const { group, groups } = setup();
      groups.replaceRolesInTx.mockRejectedValue(new AppException('GROUP_VERSION_CONFLICT'));
      await expect(
        group.importer!.update!({ id: G1, version: 1 }, { roles: ['role-a'] }, ctx, TX),
      ).rejects.toMatchObject({ code: 'GROUP_VERSION_CONFLICT' });
    });
  });
});

describe('GroupTransferResource 群組成員（docs/architecture/backend/22-data-transfer.md §12.2）', () => {
  describe('欄位與參照', () => {
    it('匯出的值：使用者列只填「使用者」，群組列只填「成員群組」', () => {
      const { member } = setup();
      const values = (row: GroupMembershipRow) =>
        Object.fromEntries(member.columns.map((item) => [item.key, item.export?.get(row)]));
      expect(values(membershipRow())).toEqual({
        group: 'Support',
        user: 'alice@example.com',
        memberGroup: null,
        memberName: 'Alice',
      });
      expect(
        values(
          membershipRow({ type: 'group', memberId: G2, member: 'Sales', memberName: 'Sales' }),
        ),
      ).toEqual({ group: 'Support', user: null, memberGroup: 'Sales', memberName: 'Sales' });
    });

    it.each(['group', 'memberGroup'])('%s 以名稱或 id 解析群組', async (key) => {
      const { member, repo } = setup();
      repo.findActiveGroupsByNames.mockResolvedValue([
        { id: G1, name: 'Support' },
        { id: G2, name: 'Sales' },
      ]);
      const resolved = await column(member, key).reference?.resolve([' support ', G2, 'nope'], ctx);
      expect(resolved).toEqual(
        new Map([
          ['support', { id: G1, label: 'Support' }],
          [G2, { id: G2, label: 'Sales' }],
        ]),
      );
    });

    it('使用者以 Email 或 id 解析', async () => {
      const { member, repo } = setup();
      repo.findActiveUsersByEmails.mockResolvedValue([
        { id: 'user-1', email: 'Alice@Example.com' },
        { id: 'user-2', email: 'bob@example.com' },
      ]);
      const resolved = await column(member, 'user').reference?.resolve(
        ['alice@example.com', 'user-2', 'nobody@example.com'],
        ctx,
      );
      expect(resolved).toEqual(
        new Map([
          ['alice@example.com', { id: 'user-1', label: 'Alice@Example.com' }],
          ['user-2', { id: 'user-2', label: 'bob@example.com' }],
        ]),
      );
    });

    it.each([
      ['group', 'searchForImport'],
      ['memberGroup', 'searchForImport'],
      ['user', 'searchActiveUsers'],
    ] as const)('%s 的下拉選單以 %s 搜尋', async (key, method) => {
      const { member, repo } = setup();
      repo.searchForImport.mockResolvedValue([{ id: G1, name: 'Support', description: null }]);
      repo.searchActiveUsers.mockResolvedValue([{ id: 'user-1', email: 'alice@example.com' }]);
      const options = await column(member, key).reference?.search('a', ctx);
      expect(repo[method]).toHaveBeenCalledWith('a', 20);
      expect(options).toEqual(
        key === 'user'
          ? [{ id: 'user-1', label: 'alice@example.com' }]
          : [{ id: G1, label: 'Support' }],
      );
    });
  });

  describe('匯出', () => {
    it.each([
      [{ kind: 'ids', ids: [G1] }, { groupIds: [G1] }],
      [{ kind: 'filter', filter: { groupId: G2 } }, { groupIds: [G2] }],
      [{ kind: 'filter', filter: {} }, {}],
    ] as const)('範圍 %j → repository 的 %j', async (scope, expected) => {
      const { member, repo } = setup();
      repo.exportMemberCount.mockResolvedValue(3);
      await expect(member.exporter!.count(scope, ctx)).resolves.toBe(3);
      expect(repo.exportMemberCount).toHaveBeenCalledWith(expected);
    });

    it('依群組名稱的 keyset 逐頁讀', async () => {
      const { member, repo } = setup();
      const full = Array.from({ length: DATA_TRANSFER_EXPORT_PAGE_SIZE }, (_, index) =>
        membershipRow({ memberId: `user-${index}` }),
      );
      repo.exportMembers.mockResolvedValueOnce(full).mockResolvedValueOnce([]);

      const pages = await collect(member.exporter!.iterate({ kind: 'filter', filter: {} }, ctx));

      expect(pages).toHaveLength(1);
      expect(repo.exportMembers).toHaveBeenNthCalledWith(
        2,
        {},
        {
          groupName: 'Support',
          groupId: G1,
          type: 'user',
          memberId: `user-${DATA_TRANSFER_EXPORT_PAGE_SIZE - 1}`,
        },
        DATA_TRANSFER_EXPORT_PAGE_SIZE,
      );
    });

    it('第一頁不滿一頁就只讀一次', async () => {
      const { member, repo } = setup();
      repo.exportMembers.mockResolvedValue([membershipRow()]);
      const pages = await collect(member.exporter!.iterate({ kind: 'ids', ids: [G1] }, ctx));
      expect(pages).toEqual([[membershipRow()]]);
      expect(repo.exportMembers).toHaveBeenCalledTimes(1);
    });
  });

  describe('驗證', () => {
    it('「使用者」與「成員群組」都沒填 → required', async () => {
      const { member, repo } = setup();
      const issues = await member.importer!.validateRows!(
        'create',
        [{ rowNo: 1, values: { group: G1 } }],
        ctx,
      );
      expect(issues.get(1)).toEqual([{ column: 'user', code: 'required', severity: 'error' }]);
      expect(repo.findExistingMemberships).not.toHaveBeenCalled();
    });

    it('兩個都填 → exactlyOne', async () => {
      const { member } = setup();
      const issues = await member.importer!.validateRows!(
        'create',
        [{ rowNo: 2, values: { group: G1, user: 'user-1', memberGroup: G2 } }],
        ctx,
      );
      expect(issues.get(2)).toEqual([
        {
          column: 'memberGroup',
          code: 'exactlyOne',
          params: { names: ['user', 'memberGroup'] },
          severity: 'error',
        },
      ]);
    });

    it('把群組放進自己 → membershipCycle', async () => {
      const { member } = setup();
      const issues = await member.importer!.validateRows!(
        'create',
        [{ rowNo: 3, values: { group: G1, memberGroup: G1 } }],
        ctx,
      );
      expect(issues.get(3)).toEqual([
        { column: 'memberGroup', code: 'membershipCycle', severity: 'error' },
      ]);
    });

    it('群組沒有解析成 id（已由欄位檢查報錯）時略過這一列', async () => {
      const { member, repo } = setup();
      const issues = await member.importer!.validateRows!(
        'create',
        [{ rowNo: 4, values: { user: 'user-1' } }],
        ctx,
      );
      expect(issues.size).toBe(0);
      expect(repo.findExistingMemberships).not.toHaveBeenCalled();
    });

    it('已經是直接成員 → alreadyExists，參數是填的值', async () => {
      const { member, repo } = setup();
      repo.findExistingMemberships.mockResolvedValue(new Set([`${G1}:user:user-1`]));
      const issues = await member.importer!.validateRows!(
        'create',
        [{ rowNo: 5, values: { group: G1, user: 'user-1' } }],
        ctx,
      );
      expect(repo.findExistingMemberships).toHaveBeenCalledWith([
        expect.objectContaining({ groupId: G1, member: { type: 'user', id: 'user-1' } }),
      ]);
      expect(issues.get(5)).toEqual([
        { column: 'user', code: 'alreadyExists', params: { value: 'user-1' }, severity: 'error' },
      ]);
    });

    it('把自己、或自己所屬的群組放進群組 → selfModify', async () => {
      const { member } = setup({
        permissionSet: {
          permissions: new Set(),
          isSuperAdmin: false,
          subjects: [`group:${G3}#member`],
        },
      });
      const issues = await member.importer!.validateRows!(
        'create',
        [
          { rowNo: 6, values: { group: G1, user: ACTOR.id } },
          { rowNo: 7, values: { group: G1, memberGroup: G3 } },
        ],
        ctx,
      );
      expect(issues.get(6)).toEqual([{ column: 'user', code: 'selfModify', severity: 'error' }]);
      expect(issues.get(7)).toEqual([
        { column: 'memberGroup', code: 'selfModify', severity: 'error' },
      ]);
    });

    it('加入後取得自己沒有的權限（D11）→ escalation；每個群組只檢查一次', async () => {
      const { member, permissions } = setup();
      permissions.assertCanGrant.mockImplementation(async (_actor, grants) => {
        const [grant] = grants;
        if (grant?.object.id === G1) throw new AppException('AUTHZ_FORBIDDEN');
      });
      const issues = await member.importer!.validateRows!(
        'create',
        [
          { rowNo: 8, values: { group: G1, user: 'user-1' } },
          { rowNo: 9, values: { group: G1, memberGroup: G2 } },
          { rowNo: 10, values: { group: G2, user: 'user-2' } },
        ],
        ctx,
      );
      expect(permissions.assertCanGrant).toHaveBeenCalledTimes(2);
      expect(permissions.assertCanGrant).toHaveBeenCalledWith(ACTOR.id, [
        { object: { type: 'group', id: G1 }, relation: 'member' },
      ]);
      expect(issues.get(8)).toEqual([{ column: 'group', code: 'escalation', severity: 'error' }]);
      expect(issues.get(9)).toEqual([{ column: 'group', code: 'escalation', severity: 'error' }]);
      expect(issues.has(10)).toBe(false);
    });

    it('不是 super-admin 的人把 super-admin 加進群組 → escalation', async () => {
      const { member, permissions } = setup();
      permissions.getPermissionSets.mockResolvedValue(
        new Map([
          ['user-sa', { permissions: new Set(), isSuperAdmin: true }],
          ['user-1', { permissions: new Set(), isSuperAdmin: false }],
        ]),
      );
      const issues = await member.importer!.validateRows!(
        'create',
        [
          { rowNo: 11, values: { group: G1, user: 'user-sa' } },
          { rowNo: 12, values: { group: G2, user: 'user-sa' } },
          { rowNo: 13, values: { group: G1, user: 'user-1' } },
          { rowNo: 14, values: { group: G1, user: 'user-unknown' } },
        ],
        ctx,
      );
      expect(permissions.getPermissionSets).toHaveBeenCalledWith([
        'user-sa',
        'user-1',
        'user-unknown',
      ]);
      expect(issues.get(11)).toEqual([{ column: 'group', code: 'escalation', severity: 'error' }]);
      expect(issues.get(12)).toEqual([{ column: 'group', code: 'escalation', severity: 'error' }]);
      expect(issues.has(13)).toBe(false);
      expect(issues.has(14)).toBe(false);
    });

    it('super-admin 操作時不查對象的權限集合', async () => {
      const { member, permissions } = setup({
        permissionSet: { permissions: new Set(), isSuperAdmin: true, subjects: [] },
      });
      const issues = await member.importer!.validateRows!(
        'create',
        [{ rowNo: 15, values: { group: G1, user: 'user-sa' } }],
        ctx,
      );
      expect(permissions.getPermissionSets).not.toHaveBeenCalled();
      expect(issues.size).toBe(0);
    });

    it('只有成員群組時不查 super-admin', async () => {
      const { member, permissions } = setup();
      await member.importer!.validateRows!(
        'create',
        [{ rowNo: 16, values: { group: G1, memberGroup: G2 } }],
        ctx,
      );
      expect(permissions.getPermissionSets).not.toHaveBeenCalled();
    });

    it('權限檢查拋出非 AppException 的錯誤時原樣往外拋', async () => {
      const { member, permissions } = setup();
      permissions.assertCanGrant.mockRejectedValue(new Error('db down'));
      await expect(
        member.importer!.validateRows!(
          'create',
          [{ rowNo: 1, values: { group: G1, user: 'user-1' } }],
          ctx,
        ),
      ).rejects.toThrow('db down');
    });
  });

  describe('套用', () => {
    it.each([
      [
        { group: G1, user: 'user-1' },
        { type: 'user', id: 'user-1' },
      ],
      [
        { group: G1, memberGroup: G2 },
        { type: 'group', id: G2 },
      ],
    ])('新增 %j：在同一個交易加成員', async (values, subject) => {
      const { member, groups } = setup();
      groups.updateMembersInTx.mockResolvedValue({
        after: { changes: [], affectedUserIds: [], permissionsChanged: ['user-1'] },
      });
      const result = await member.importer!.create!(values, ctx, TX);
      expect(groups.updateMembersInTx).toHaveBeenCalledWith(
        G1,
        { add: [subject], remove: [] },
        ACTOR,
        TX,
      );
      expect(result).toEqual({
        id: G1,
        after: [{ kind: 'permissionsChanged', userIds: ['user-1'] }],
      });
    });

    it('沒有成員時拋 VALIDATION_FAILED', async () => {
      const { member, groups } = setup();
      await expect(member.importer!.create!({ group: G1 }, ctx, TX)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(groups.updateMembersInTx).not.toHaveBeenCalled();
    });
  });
});
