import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { registerGroupPagePermissions, Routes } from '../../..';
import groupZhTW from '../../../locales/zh_TW.json';

const { fetchGroups, deleteGroup } = vi.hoisted(() => ({
  fetchGroups: vi.fn(),
  deleteGroup: vi.fn(),
}));
vi.mock('@/apis/group/get-group-list/fetcher', () => ({ fetchGroupListQuery: fetchGroups }));
vi.mock('@/apis/group/delete-group/fetcher', () => ({ fetchGroupDeleteMutation: deleteGroup }));

const group = (id: string, name: string, memberCount: number) => ({
  id,
  name,
  description: null,
  memberCount,
  roleCount: 1,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
const MANAGER = ['group:read', 'group:create', 'group:delete'] as PermissionKey[];
const routes = [Routes.GroupListRoute];

beforeAll(() => initTestI18n(groupZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerGroupPagePermissions();
  fetchGroups.mockReset().mockResolvedValue({
    items: [group('g1', '美術', 3), group('g2', '企劃', 0)],
    pagination: { total: 2 },
  });
  deleteGroup.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('GroupListPage（docs/rbac/01-domain-model.md §9 G4）', () => {
  it('有 group:create／group:delete → 顯示建立與刪除', async () => {
    renderRoute(routes, '/group', MANAGER);
    await screen.findByText('美術', undefined, { timeout: 5000 });
    expect(screen.getByTestId('group-create-button')).toBeInTheDocument();
    expect(screen.getAllByTestId('group-delete-button')).toHaveLength(2);
  });

  it('只有 group:read → 看得到列表，沒有建立與刪除', async () => {
    renderRoute(routes, '/group', ['group:read'] as PermissionKey[]);
    await screen.findByText('美術', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('group-create-button')).toBeNull();
    expect(screen.queryByTestId('group-delete-button')).toBeNull();
  });

  it('權限未水合 → 不閃現操作按鈕', async () => {
    renderRoute(routes, '/group', 'unhydrated');
    await waitFor(() => expect(screen.queryByTestId('group-create-button')).toBeNull());
    expect(screen.queryByTestId('group-delete-button')).toBeNull();
  });

  it('刪除：確認框寫明直接成員數，確認後呼叫刪除', async () => {
    renderRoute(routes, '/group', MANAGER);
    await screen.findByText('美術', undefined, { timeout: 5000 });
    const row = screen.getByText('美術').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByTestId('group-delete-button'));
    const confirm = await screen.findByTestId('group-delete-confirm');
    expect(confirm).toHaveTextContent('3 個直接成員');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(deleteGroup).toHaveBeenCalledTimes(1));
    expect(deleteGroup.mock.calls[0]![0]).toMatchObject({ params: { groupId: 'g1' } });
  });
});
