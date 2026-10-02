import { fireEvent, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { registerGroupPagePermissions, Routes } from '../../..';
import groupZhTW from '../../../locales/zh_TW.json';

const { fetchGroups, fetchGroup, fetchMembers, fetchRoles, fetchRoleOptions } = vi.hoisted(() => ({
  fetchGroups: vi.fn(),
  fetchGroup: vi.fn(),
  fetchMembers: vi.fn(),
  fetchRoles: vi.fn(),
  fetchRoleOptions: vi.fn(),
}));
vi.mock('@/apis/group/get-group-list/fetcher', () => ({ fetchGroupListQuery: fetchGroups }));
vi.mock('@/apis/group/get-group-detail/fetcher', () => ({ fetchGroupDetailQuery: fetchGroup }));
vi.mock('@/apis/group/get-group-members/fetcher', () => ({ fetchGroupMembersQuery: fetchMembers }));
vi.mock('@/apis/group/get-group-roles/fetcher', () => ({ fetchGroupRolesQuery: fetchRoles }));
vi.mock('@/apis/role/get-role-list/fetcher', () => ({ fetchRoleListQuery: fetchRoleOptions }));

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
});
