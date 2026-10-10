import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Transaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DataTransferRegistry } from '@/modules/data-transfer/data-transfer-registry.service';
import { DATA_TRANSFER_EXPORT_PAGE_SIZE } from '@/modules/data-transfer/data-transfer.constants';
import type {
  AnyTransferResource,
  MatchResult,
  ResolvedRow,
  TransferContext,
} from '@/modules/data-transfer/data-transfer.types';
import type { PermissionService } from '@/modules/permission/permission.service';

import type { UserRepository, UserWithRoles } from '../user.repository';
import type { UserAfterCommit, UserService } from '../user.service';
import { UserTransferResource } from '../user.transfer';

const ACTOR: AuthUser = { id: 'actor-1', email: 'actor@example.com', status: 'active' };
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const TX = { name: 'tx' } as unknown as Transaction;

const ctx: TransferContext = {
  actor: ACTOR,
  locale: 'zh-TW',
  timezone: 'Asia/Taipei',
  signal: new AbortController().signal,
  can: () => true,
};

function userRow(overrides: Partial<UserWithRoles> = {}): UserWithRoles {
  return {
    id: U1,
    email: 'alice@example.com',
    username: 'alice',
    displayName: 'Alice',
    status: 'active',
    lockedUntil: null,
    version: 2,
    lastLoginAt: new Date('2026-10-02T00:00:00.000Z'),
    mfaEnabled: true,
    roles: [{ id: 'role-a', slug: 'agent', name: 'Agent', isSystem: false }],
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  } as UserWithRoles;
}

const EMPTY_AFTER: UserAfterCommit = { changes: [] };

function setup() {
  const repo = {
    searchForImport: vi.fn(
      async () =>
        [] as Array<{ id: string; email: string; username: string | null; displayName: string }>,
    ),
    searchActiveRoles: vi.fn(async () => [] as Array<{ id: string; name: string }>),
    exportCount: vi.fn(async () => 0),
    exportPage: vi.fn(async () => [] as UserWithRoles[]),
    findTakenValues: vi.fn(async () => new Set<string>()),
    findForImport: vi.fn(async () => [] as UserWithRoles[]),
    findActiveRolesByNames: vi.fn(
      async () => [] as Array<{ id: string; slug: string; name: string }>,
    ),
    findActiveRolesByIds: vi.fn(async () => [] as Array<{ id: string; name: string }>),
  };
  const users = {
    orgUnitScope: vi.fn(async (): Promise<string[] | undefined> => undefined),
    roleHolderScope: vi.fn(async (): Promise<string[] | undefined> => undefined),
    createInTx: vi.fn(async () => ({ user: { id: U1 }, after: EMPTY_AFTER })),
    updateInTx: vi.fn(async () => ({ after: EMPTY_AFTER })),
    replaceRolesInTx: vi.fn(async () => ({ after: EMPTY_AFTER })),
    runAfterCommit: vi.fn(async () => undefined),
  };
  const permissions = {
    assertRolesAssignable: vi.fn(
      async (_actorId: string, _roleIds: readonly string[]) => undefined,
    ),
  };
  const registry = new DataTransferRegistry();
  new UserTransferResource(
    registry,
    repo as unknown as UserRepository,
    users as unknown as UserService,
    permissions as unknown as PermissionService,
  ).onModuleInit();
  const resource = registry.find('user') as AnyTransferResource;
  return { repo, users, permissions, resource };
}

function column(resource: AnyTransferResource, key: string) {
  const found = resource.columns.find((item) => item.key === key);
  if (!found) throw new Error(`沒有欄位 ${key}`);
  return found;
}

function target(record: UserWithRoles): MatchResult<unknown> {
  return { id: record.id, label: record.email, version: record.version, record };
}

async function collect<T>(pages: AsyncIterable<readonly T[]>): Promise<T[][]> {
  const result: T[][] = [];
  for await (const page of pages) result.push([...page]);
  return result;
}

describe('UserTransferResource（docs/architecture/backend/22-data-transfer.md §2、§7.4、§7.5）', () => {
  describe('欄位', () => {
    it('匯出的值：狀態以顯示用狀態表示（鎖定中是 locked）、角色是名稱', () => {
      const { resource } = setup();
      const record = userRow({ lockedUntil: new Date(Date.now() + 60_000) });
      const values = Object.fromEntries(
        resource.columns.map((item) => [item.key, item.export?.get(record)]),
      );
      expect(values).toEqual({
        id: U1,
        email: 'alice@example.com',
        username: 'alice',
        displayName: 'Alice',
        status: 'locked',
        roles: ['Agent'],
        lastLoginAt: record.lastLoginAt,
        mfaEnabled: true,
        createdAt: record.createdAt,
      });
    });

    it('狀態只能在 active 與 inactive 之間轉換', () => {
      const { resource } = setup();
      expect(column(resource, 'status').import?.transitions).toEqual({
        active: ['inactive'],
        inactive: ['active'],
      });
    });

    it('Email 的自動完成回傳現有使用者的 Email', async () => {
      const { resource, repo } = setup();
      repo.searchForImport.mockResolvedValue([
        { id: U1, email: 'alice@example.com', username: 'alice', displayName: 'Alice' },
      ]);
      await expect(column(resource, 'email').import?.suggest?.('al', ctx)).resolves.toEqual([
        'alice@example.com',
      ]);
      expect(repo.searchForImport).toHaveBeenCalledWith('al', 20);
    });

    it('帳號的自動完成略過沒有帳號的人', async () => {
      const { resource, repo } = setup();
      repo.searchForImport.mockResolvedValue([
        { id: U1, email: 'alice@example.com', username: 'alice', displayName: 'Alice' },
        { id: U2, email: 'bob@example.com', username: null, displayName: 'Bob' },
      ]);
      await expect(column(resource, 'username').import?.suggest?.('', ctx)).resolves.toEqual([
        'alice',
      ]);
    });

    it('角色欄的搜尋回傳 { id, label }', async () => {
      const { resource, repo } = setup();
      repo.searchActiveRoles.mockResolvedValue([{ id: 'role-a', name: 'Agent' }]);
      await expect(column(resource, 'roles').reference?.search('ag', ctx)).resolves.toEqual([
        { id: 'role-a', label: 'Agent' },
      ]);
      expect(repo.searchActiveRoles).toHaveBeenCalledWith('ag', 20);
    });

    it('角色依序以名稱、代碼、id 解析（不分大小寫、去空白），沒對上的不出現', async () => {
      const { resource, repo } = setup();
      repo.findActiveRolesByNames.mockResolvedValue([
        { id: 'role-a', slug: 'agent', name: 'Agent' },
        { id: 'role-b', slug: 'team-lead', name: 'Lead' },
        { id: 'role-c', slug: 'auditor', name: 'Auditor' },
      ]);
      const resolved = await column(resource, 'roles').reference?.resolve(
        [' agent ', 'TEAM-LEAD', 'role-c', 'missing'],
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
    it('勾選的 id 直接當範圍，不展開部門', async () => {
      const { resource, repo, users } = setup();
      repo.exportCount.mockResolvedValue(2);
      await expect(resource.exporter!.count({ kind: 'ids', ids: [U1, U2] }, ctx)).resolves.toBe(2);
      expect(repo.exportCount).toHaveBeenCalledWith({ ids: [U1, U2] });
      expect(users.orgUnitScope).not.toHaveBeenCalled();
    });

    it('篩選條件的部門展開成部門 id', async () => {
      const { resource, repo, users } = setup();
      users.orgUnitScope.mockResolvedValue(['unit-1', 'unit-2']);
      await resource.exporter!.count(
        {
          kind: 'filter',
          filter: { keyword: 'al', orgUnitId: 'unit-1', includeDescendants: true },
        },
        ctx,
      );
      expect(users.orgUnitScope).toHaveBeenCalledWith({
        orgUnitId: 'unit-1',
        includeDescendants: true,
      });
      expect(repo.exportCount).toHaveBeenCalledWith({
        filter: { keyword: 'al', orgUnitIds: ['unit-1', 'unit-2'], roleHolderIds: undefined },
      });
    });

    it('角色篩選含經由群組持有：展開成持有者（與列表同一個判斷）', async () => {
      const { resource, repo, users } = setup();
      users.roleHolderScope.mockResolvedValue(['u-1']);
      await resource.exporter!.count(
        { kind: 'filter', filter: { roleId: ['r-1'], includeGroupRoles: true } },
        ctx,
      );
      expect(users.roleHolderScope).toHaveBeenCalledWith({
        roleId: ['r-1'],
        includeGroupRoles: true,
      });
      expect(repo.exportCount).toHaveBeenCalledWith({
        filter: { roleId: ['r-1'], orgUnitIds: undefined, roleHolderIds: ['u-1'] },
      });
    });

    it('部門展開的錯誤（例：組織 feature 關閉）原樣往外拋', async () => {
      const { resource, users } = setup();
      users.orgUnitScope.mockRejectedValue(new AppException('VALIDATION_FAILED'));
      await expect(
        resource.exporter!.count({ kind: 'filter', filter: { orgUnitId: 'unit-1' } }, ctx),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('依建立時間的 keyset 逐頁讀，最後一頁不滿一頁就停；範圍只展開一次', async () => {
      const { resource, repo, users } = setup();
      const full = Array.from({ length: DATA_TRANSFER_EXPORT_PAGE_SIZE }, (_, index) =>
        userRow({ id: `u-${index}`, createdAt: new Date(2026, 0, 1, 0, 0, index) }),
      );
      const last = full.at(-1)!;
      repo.exportPage.mockResolvedValueOnce(full).mockResolvedValueOnce([userRow({ id: 'tail' })]);

      const pages = await collect(resource.exporter!.iterate({ kind: 'filter', filter: {} }, ctx));

      expect(pages.map((page) => page.length)).toEqual([DATA_TRANSFER_EXPORT_PAGE_SIZE, 1]);
      expect(users.orgUnitScope).toHaveBeenCalledTimes(1);
      expect(repo.exportPage).toHaveBeenNthCalledWith(
        2,
        { filter: { orgUnitIds: undefined, roleHolderIds: undefined } },
        { createdAt: last.createdAt, id: last.id },
        DATA_TRANSFER_EXPORT_PAGE_SIZE,
      );
    });

    it('滿頁之後下一頁是空的：不輸出空頁就結束', async () => {
      const { resource, repo } = setup();
      const full = Array.from({ length: DATA_TRANSFER_EXPORT_PAGE_SIZE }, (_, index) =>
        userRow({ id: `u-${index}` }),
      );
      repo.exportPage.mockResolvedValueOnce(full).mockResolvedValueOnce([]);
      const pages = await collect(resource.exporter!.iterate({ kind: 'ids', ids: [U1] }, ctx));
      expect(pages).toHaveLength(1);
      expect(repo.exportPage).toHaveBeenCalledTimes(2);
    });

    it('範本的抽樣取全部使用者的第一頁', async () => {
      const { resource, repo } = setup();
      repo.exportPage.mockResolvedValue([userRow()]);
      await expect(resource.importer!.sampleRecords!(ctx, 3)).resolves.toHaveLength(1);
      expect(repo.exportPage).toHaveBeenCalledWith({ filter: {} }, null, 3);
    });
  });

  describe('比對與唯一值', () => {
    it.each([
      ['username', 'username'],
      ['email', 'email'],
      ['other', 'email'],
    ])('唯一欄 %s 以 repository 的 %s 查重複', async (columnKey, expected) => {
      const { resource, repo } = setup();
      repo.findTakenValues.mockResolvedValue(new Set(['x']));
      await expect(resource.importer!.findExisting!(columnKey, ['X'], ctx)).resolves.toEqual(
        new Set(['x']),
      );
      expect(repo.findTakenValues).toHaveBeenCalledWith(expected, ['X']);
    });

    it('以 Email 比對：key 是小寫 Email，帶上目前的角色 id 當 expected', async () => {
      const { resource, repo } = setup();
      const record = userRow({ email: 'Alice@Example.com' });
      repo.findForImport.mockResolvedValue([record]);

      const result = await resource.importer!.resolveTargets!('email', ['alice@example.com'], ctx);

      expect(repo.findForImport).toHaveBeenCalledWith('email', ['alice@example.com']);
      expect(result.get('alice@example.com')).toEqual([
        {
          id: U1,
          label: 'Alice@Example.com',
          version: 2,
          record,
          expected: { roleIds: ['role-a'] },
        },
      ]);
    });

    it('同一個 key 命中多筆時都列出', async () => {
      const { resource, repo } = setup();
      repo.findForImport.mockResolvedValue([
        userRow({ id: U1, email: 'a@example.com' }),
        userRow({ id: U2, email: 'A@example.com' }),
      ]);
      const result = await resource.importer!.resolveTargets!('email', ['a@example.com'], ctx);
      expect(result.get('a@example.com')?.map((match) => match.id)).toEqual([U1, U2]);
    });

    it('以 ID 比對：不是 uuid 的值不查詢', async () => {
      const { resource, repo } = setup();
      repo.findForImport.mockResolvedValue([userRow({ id: U1 })]);
      const result = await resource.importer!.resolveTargets!('id', [U1, 'nope'], ctx);
      expect(repo.findForImport).toHaveBeenCalledWith('id', [U1]);
      expect([...result.keys()]).toEqual([U1]);
    });

    it('手動指定目標：以 id 找，找不到的不出現', async () => {
      const { resource, repo } = setup();
      repo.findForImport.mockResolvedValue([userRow({ id: U1 })]);
      const found = await resource.importer!.findTargetsById!([U1, U2], ctx);
      expect([...found.keys()]).toEqual([U1]);
    });

    it('目標的下拉選單：說明是顯示名稱，有帳號時附在括號裡', async () => {
      const { resource, repo } = setup();
      repo.searchForImport.mockResolvedValue([
        { id: U1, email: 'alice@example.com', username: 'alice', displayName: 'Alice' },
        { id: U2, email: 'bob@example.com', username: null, displayName: 'Bob' },
      ]);
      await expect(resource.importer!.searchTargets!('', ctx)).resolves.toEqual([
        { id: U1, label: 'alice@example.com', description: 'Alice (alice)' },
        { id: U2, label: 'bob@example.com', description: 'Bob' },
      ]);
    });
  });

  describe('驗證', () => {
    it('沒有角色的列不檢查反提權', async () => {
      const { resource, permissions, repo } = setup();
      const issues = await resource.importer!.validateRows!(
        'create',
        [{ rowNo: 1, values: { email: 'a@example.com' } }],
        ctx,
      );
      expect(issues.size).toBe(0);
      expect(permissions.assertRolesAssignable).not.toHaveBeenCalled();
      expect(repo.findActiveRolesByIds).not.toHaveBeenCalled();
    });

    it('新增模式指派不能指派的角色 → roleNotAssignable，參數是角色名稱（查不到時用 id）', async () => {
      const { resource, permissions, repo } = setup();
      permissions.assertRolesAssignable.mockImplementation(async (_actor, ids) => {
        if (ids[0] !== 'role-ok') throw new AppException('AUTHZ_FORBIDDEN');
      });
      repo.findActiveRolesByIds.mockResolvedValue([{ id: 'role-a', name: 'Agent' }]);

      const issues = await resource.importer!.validateRows!(
        'create',
        [
          { rowNo: 2, values: { roles: ['role-a', 'role-ok', 'role-x'] } },
          { rowNo: 3, values: { roles: ['role-ok'] } },
        ],
        ctx,
      );

      expect(permissions.assertRolesAssignable).toHaveBeenCalledTimes(3);
      expect(repo.findActiveRolesByIds).toHaveBeenCalledWith(['role-a', 'role-x']);
      expect(issues.get(2)).toEqual([
        {
          column: 'roles',
          code: 'roleNotAssignable',
          params: { names: ['Agent', 'role-x'] },
          severity: 'error',
        },
      ]);
      expect(issues.has(3)).toBe(false);
    });

    it('修改模式沒改角色時，不能指派的角色不報錯', async () => {
      const { resource, permissions } = setup();
      permissions.assertRolesAssignable.mockRejectedValue(new AppException('AUTHZ_FORBIDDEN'));
      const issues = await resource.importer!.validateRows!(
        'update',
        [
          {
            rowNo: 4,
            values: { roles: ['role-a'], displayName: 'A' },
            target: target(userRow({ id: U2 })),
            changed: ['displayName'],
          },
        ],
        ctx,
      );
      expect(issues.size).toBe(0);
    });

    it('修改模式改了角色而有不能指派的角色 → roleNotAssignable', async () => {
      const { resource, permissions } = setup();
      permissions.assertRolesAssignable.mockRejectedValue(new AppException('AUTHZ_FORBIDDEN'));
      const issues = await resource.importer!.validateRows!(
        'update',
        [
          {
            rowNo: 5,
            values: { roles: ['role-a'] },
            target: target(userRow({ id: U2 })),
            changed: ['roles'],
          },
        ],
        ctx,
      );
      expect(issues.get(5)).toEqual([
        {
          column: 'roles',
          code: 'roleNotAssignable',
          params: { names: ['role-a'] },
          severity: 'error',
        },
      ]);
    });

    it('修改自己的狀態與角色 → 各一個 selfModify；改自己的其他欄位不算', async () => {
      const { resource } = setup();
      const self = userRow({ id: ACTOR.id });
      const rows: ResolvedRow[] = [
        {
          rowNo: 6,
          values: { status: 'inactive', roles: [], displayName: 'Me' },
          target: target(self),
          changed: ['status', 'roles', 'displayName'],
        },
        { rowNo: 7, values: { displayName: 'Me' }, target: target(self), changed: ['displayName'] },
        { rowNo: 8, values: { status: 'inactive' }, target: target(self) },
      ];
      const issues = await resource.importer!.validateRows!('update', rows, ctx);
      expect(issues.get(6)).toEqual([
        { column: 'status', code: 'selfModify', severity: 'error' },
        { column: 'roles', code: 'selfModify', severity: 'error' },
      ]);
      expect(issues.has(7)).toBe(false);
      expect(issues.has(8)).toBe(false);
    });

    it('新增模式不做 selfModify 檢查', async () => {
      const { resource } = setup();
      const issues = await resource.importer!.validateRows!(
        'create',
        [
          {
            rowNo: 9,
            values: { status: 'inactive' },
            target: target(userRow({ id: ACTOR.id })),
            changed: ['status'],
          },
        ],
        ctx,
      );
      expect(issues.size).toBe(0);
    });

    it('反提權檢查拋出非 AppException 的錯誤時原樣往外拋', async () => {
      const { resource, permissions } = setup();
      permissions.assertRolesAssignable.mockRejectedValue(new Error('db down'));
      await expect(
        resource.importer!.validateRows!('create', [{ rowNo: 1, values: { roles: ['r'] } }], ctx),
      ).rejects.toThrow('db down');
    });
  });

  describe('套用', () => {
    it('新增：沒有帳號、角色時不帶帳號、角色是空陣列', async () => {
      const { resource, users } = setup();
      const result = await resource.importer!.create!(
        { email: 'a@example.com', displayName: 'A' },
        ctx,
        TX,
      );
      expect(users.createInTx).toHaveBeenCalledWith(
        { email: 'a@example.com', displayName: 'A', roleIds: [] },
        ACTOR,
        TX,
      );
      expect(result).toEqual({ id: U1, after: [] });
    });

    it('新增：帶帳號與角色，副作用轉成權限失效與推播', async () => {
      const { resource, users } = setup();
      const change = { resource: 'user', kind: 'create', id: U1 } as const;
      users.createInTx.mockResolvedValue({
        user: { id: U1 },
        after: { permissionsChanged: [U1], changes: [change], affectedUserIds: [U1] },
      });

      const result = await resource.importer!.create!(
        { email: 'a@example.com', username: 'alice', displayName: 'A', roles: ['role-a'] },
        ctx,
        TX,
      );

      expect(users.createInTx).toHaveBeenCalledWith(
        { email: 'a@example.com', username: 'alice', displayName: 'A', roleIds: ['role-a'] },
        ACTOR,
        TX,
      );
      expect(result.after).toEqual([
        { kind: 'permissionsChanged', userIds: [U1] },
        { kind: 'resourceChanged', change, affectedUserIds: [U1] },
      ]);
    });

    it('修改：帳號、顯示名稱、狀態一次以 version 樂觀鎖更新；\\N 的帳號清空', async () => {
      const { resource, users } = setup();
      const result = await resource.importer!.update!(
        { id: U2, version: 5 },
        { username: null, displayName: 'Bob', status: 'inactive' },
        ctx,
        TX,
      );
      expect(users.updateInTx).toHaveBeenCalledWith(
        U2,
        { username: null, displayName: 'Bob', status: 'inactive', version: 5 },
        ACTOR,
        TX,
      );
      expect(users.replaceRolesInTx).not.toHaveBeenCalled();
      expect(result).toEqual({ id: U2, after: [] });
    });

    it('修改：只改角色時不更新欄位，整組取代並帶比對當下的角色當 expectedRoleIds', async () => {
      const { resource, users } = setup();
      await resource.importer!.update!(
        { id: U2, version: 5, expected: { roleIds: ['role-a'] } },
        { roles: ['role-b'] },
        ctx,
        TX,
      );
      expect(users.updateInTx).not.toHaveBeenCalled();
      expect(users.replaceRolesInTx).toHaveBeenCalledWith(
        U2,
        { roleIds: ['role-b'], expectedRoleIds: ['role-a'] },
        ACTOR,
        TX,
      );
    });

    it('修改：沒有 expected、角色值不是陣列時兩者都以空陣列送出', async () => {
      const { resource, users } = setup();
      await resource.importer!.update!({ id: U2, version: 5 }, { roles: null }, ctx, TX);
      expect(users.replaceRolesInTx).toHaveBeenCalledWith(
        U2,
        { roleIds: [], expectedRoleIds: [] },
        ACTOR,
        TX,
      );
    });

    it('修改：停用的副作用合併成一個以帳號為 key 的 custom 效果，執行時交給 UserService', async () => {
      const { resource, users } = setup();
      users.updateInTx.mockResolvedValue({
        after: { invalidateAccount: U2, sessionsRevoked: [U2], changes: [] },
      });

      const result = await resource.importer!.update!(
        { id: U2, version: 5 },
        { status: 'inactive' },
        ctx,
        TX,
      );

      const [effect] = result.after ?? [];
      expect(effect).toMatchObject({ kind: 'custom', key: `user.account:${U2}` });
      if (effect?.kind !== 'custom') throw new Error('應該是 custom 效果');
      await effect.run();
      expect(users.runAfterCommit).toHaveBeenCalledWith({
        invalidateAccount: U2,
        sessionsRevoked: [U2],
        changes: [],
      });
    });

    it.each([
      [{ sessionsRevoked: [U2], changes: [] }, `user.account:${U2}`],
      [{ invalidateAccount: U1, changes: [] }, `user.account:${U1}`],
    ])('副作用 %j 的 custom key 是 %s', async (after, key) => {
      const { resource, users } = setup();
      users.updateInTx.mockResolvedValue({ after });
      const result = await resource.importer!.update!(
        { id: U2, version: 1 },
        { displayName: 'B' },
        ctx,
        TX,
      );
      expect(result.after).toEqual([expect.objectContaining({ kind: 'custom', key })]);
    });

    it('空的 permissionsChanged 與 sessionsRevoked 不產生副作用', async () => {
      const { resource, users } = setup();
      users.replaceRolesInTx.mockResolvedValue({
        after: { permissionsChanged: [], sessionsRevoked: [], changes: [] },
      });
      const result = await resource.importer!.update!(
        { id: U2, version: 1 },
        { roles: [] },
        ctx,
        TX,
      );
      expect(result.after).toEqual([]);
    });

    it('修改：UserService 的錯誤（例：角色已被別人改過）原樣往外拋', async () => {
      const { resource, users } = setup();
      users.replaceRolesInTx.mockRejectedValue(new AppException('USER_ROLES_CONFLICT'));
      await expect(
        resource.importer!.update!({ id: U2, version: 1 }, { roles: ['r'] }, ctx, TX),
      ).rejects.toMatchObject({ code: 'USER_ROLES_CONFLICT' });
    });
  });
});
