import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerGroupPagePermissions, Routes } from '../../..';
import groupZhTW from '../../../locales/zh_TW.json';

const { fetchGroups, fetchGroup, fetchMembers, fetchRoles, fetchRoleOptions, updateMembers } =
  vi.hoisted(() => ({
    fetchGroups: vi.fn(),
    fetchGroup: vi.fn(),
    fetchMembers: vi.fn(),
    fetchRoles: vi.fn(),
    fetchRoleOptions: vi.fn(),
    updateMembers: vi.fn(),
  }));
vi.mock('@/apis/group/get-group-list/fetcher', () => ({ fetchGroupListQuery: fetchGroups }));
vi.mock('@/apis/group/get-group-detail/fetcher', () => ({ fetchGroupDetailQuery: fetchGroup }));
vi.mock('@/apis/group/get-group-members/fetcher', () => ({ fetchGroupMembersQuery: fetchMembers }));
vi.mock('@/apis/group/get-group-roles/fetcher', () => ({ fetchGroupRolesQuery: fetchRoles }));
vi.mock('@/apis/role/get-role-list/fetcher', () => ({ fetchRoleListQuery: fetchRoleOptions }));
vi.mock('@/apis/group/update-group-members/fetcher', () => ({
  fetchGroupMembersUpdateMutation: updateMembers,
}));

const GROUP = {
  id: 'g1',
  name: '美術',
  description: null,
  memberCount: 2,
  roleCount: 1,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const role = (id: string, slug: string) => ({
  id,
  slug,
  name: slug,
  description: null,
  isSystem: slug !== 'editor',
  permissionCount: 1,
  userCount: 0,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
const routes = [Routes.GroupListRoute.addChildren([Routes.GroupDetailRoute])];
const READER = ['group:read', 'user:read', 'role:read'] as PermissionKey[];

/** 某位成員的移除鈕（列以 `data-value` 定位）。 */
async function removeButton(id: string) {
  const buttons = await screen.findAllByTestId('group-member-remove', undefined, {
    timeout: 5000,
  });
  const button = buttons.find((element) => element.getAttribute('data-value') === id);
  if (!button) throw new Error(`找不到成員 ${id} 的移除鈕`);
  return button;
}

beforeAll(() => initTestI18n(groupZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerGroupPagePermissions();
  fetchGroups.mockReset().mockResolvedValue({ items: [GROUP], pagination: { total: 1 } });
  fetchGroup.mockReset().mockResolvedValue(GROUP);
  fetchMembers.mockReset().mockResolvedValue({
    items: [
      { type: 'user', id: 'u1', name: 'Alice', email: 'alice@example.com', status: 'active' },
      { type: 'group', id: 'g2', name: '角色設計', email: null, status: null },
    ],
    pagination: { total: 2 },
  });
  fetchRoles.mockReset().mockResolvedValue({
    roles: [{ id: 'r-editor', slug: 'editor', name: 'editor', isSystem: false }],
  });
  fetchRoleOptions.mockReset().mockResolvedValue({
    items: [role('r-root', 'super-admin'), role('r-editor', 'editor'), role('r-admin', 'admin')],
    pagination: { total: 3 },
  });
  updateMembers.mockReset().mockResolvedValue(GROUP);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('GroupDetailPage（docs/rbac/01-domain-model.md §9.3 D11、D12）', () => {
  it('列出使用者與巢狀群組兩種成員', async () => {
    renderRoute(routes, '/group/g1', READER);
    const members = await screen.findAllByTestId('group-member', undefined, { timeout: 5000 });
    expect(members.map((member) => member.getAttribute('data-value'))).toEqual(['u1', 'g2']);
  });

  it('有 group:assignRole → 角色下拉不含 super-admin（D12）', async () => {
    renderRoute(routes, '/group/g1', [...READER, 'group:assignRole'] as PermissionKey[]);
    fireEvent.click(await screen.findByTestId('group-role-select', undefined, { timeout: 5000 }));
    await screen.findByRole('listbox');
    const options = screen.getAllByTestId('select-item');
    expect(options.map((option) => option.getAttribute('data-value'))).toEqual([
      'r-editor',
      'r-admin',
    ]);
  });

  it('只能讀 → 角色是唯讀的 Chip，成員沒有加入與移除', async () => {
    renderRoute(routes, '/group/g1', READER);
    await screen.findAllByTestId('group-member', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('group-role-picker')).toBeNull();
    expect(screen.queryByTestId('group-member-add')).toBeNull();
    expect(screen.queryByTestId('group-member-remove')).toBeNull();
  });

  it('有 group:update → 每位成員都有移除，並出現加入列', async () => {
    renderRoute(routes, '/group/g1', [...READER, 'group:update'] as PermissionKey[]);
    expect(
      await screen.findAllByTestId('group-member-remove', undefined, { timeout: 5000 }),
    ).toHaveLength(2);
    expect(screen.getByTestId('group-member-add')).toBeInTheDocument();
  });

  describe('移除成員要先確認', () => {
    it('按取消：不送出', async () => {
      renderRoute(routes, '/group/g1', [...READER, 'group:update'] as PermissionKey[]);
      fireEvent.click(await removeButton('u1'));

      const confirm = await screen.findByTestId('group-member-remove-confirm');
      expect(confirm).toHaveTextContent('「Alice」不再取得這個群組的角色');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
      await waitFor(() => expect(screen.queryByTestId('group-member-remove-confirm')).toBeNull());
      expect(updateMembers).not.toHaveBeenCalled();
    });

    it('成員是群組：說明其中的成員也會失去角色；按確認才送出', async () => {
      renderRoute(routes, '/group/g1', [...READER, 'group:update'] as PermissionKey[]);
      fireEvent.click(await removeButton('g2'));

      const confirm = await screen.findByTestId('group-member-remove-confirm');
      expect(confirm).toHaveTextContent('其中的成員也一樣');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
      await waitFor(() => expect(updateMembers).toHaveBeenCalledTimes(1));
      expect(updateMembers.mock.calls[0]![0]).toMatchObject({
        params: { groupId: 'g1', body: { add: [], remove: [{ type: 'group', id: 'g2' }] } },
      });
    });
  });
});
