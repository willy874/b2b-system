import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerGroupPagePermissions, Routes } from '../../..';
import groupZhTW from '../../../locales/zh_TW.json';

const {
  fetchGroups,
  fetchGroup,
  fetchMembers,
  fetchRoles,
  fetchRoleOptions,
  updateMembers,
  updateGroup,
} = vi.hoisted(() => ({
  updateGroup: vi.fn(),
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
vi.mock('@/apis/group/update-group/fetcher', () => ({ fetchGroupUpdateMutation: updateGroup }));
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
  updateGroup.mockReset().mockResolvedValue({ ...GROUP, version: 2 });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('GroupDetailPage（docs/architecture/iam/01-model.md §9.3 D11、D12）', () => {
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

  describe('成員的分頁與查詢失敗（docs/architecture/frontend/07-ui-system.md §6.1）', () => {
    it('成員查詢失敗 → 顯示錯誤與重試，標題仍是群組的成員數，不顯示「無」', async () => {
      fetchMembers.mockRejectedValueOnce(new AppError('INTERNAL_ERROR', 500));
      renderRoute(routes, '/group/g1', READER);
      expect(
        await screen.findByTestId('group-member-error', undefined, { timeout: 5000 }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('group-member-list')).not.toBeInTheDocument();

      fireEvent.click(
        within(screen.getByTestId('group-member-error')).getByTestId('query-error-retry'),
      );
      expect(await screen.findAllByTestId('group-member')).toHaveLength(2);
    });

    it('成員超過一頁 → 有分頁與搜尋，換頁帶 offset、搜尋帶 keyword 並回到第一頁', async () => {
      fetchGroup.mockResolvedValue({ ...GROUP, memberCount: 120 });
      fetchMembers.mockResolvedValue({
        items: [
          { type: 'user', id: 'u1', name: 'Alice', email: 'alice@example.com', status: 'active' },
        ],
        pagination: { total: 120 },
      });
      renderRoute(routes, '/group/g1', READER);
      const pagination = await screen.findByTestId('group-member-pagination', undefined, {
        timeout: 5000,
      });
      fireEvent.click(within(pagination).getByTestId('pagination-next'));
      await waitFor(() =>
        expect(fetchMembers).toHaveBeenLastCalledWith(
          expect.objectContaining({ params: expect.objectContaining({ offset: 50, limit: 50 }) }),
        ),
      );

      fireEvent.change(screen.getByTestId('group-member-search'), { target: { value: 'bob' } });
      await waitFor(() =>
        expect(fetchMembers).toHaveBeenLastCalledWith(
          expect.objectContaining({
            params: expect.objectContaining({ offset: 0, keyword: 'bob' }),
          }),
        ),
      );
    });

    it('刪到最後一頁沒有成員 → 退回上一頁，不停在空頁', async () => {
      fetchGroup.mockResolvedValue({ ...GROUP, memberCount: 51 });
      fetchMembers.mockImplementation(({ params }: { params: { offset: number } }) =>
        Promise.resolve(
          params.offset === 0
            ? {
                items: [{ type: 'user', id: 'u1', name: 'Alice', email: 'a@x', status: 'active' }],
                pagination: { total: 50 },
              }
            : { items: [], pagination: { total: 50 } },
        ),
      );
      fetchMembers.mockResolvedValueOnce({
        items: [{ type: 'user', id: 'u1', name: 'Alice', email: 'a@x', status: 'active' }],
        pagination: { total: 51 },
      });
      renderRoute(routes, '/group/g1', READER);
      const pagination = await screen.findByTestId('group-member-pagination', undefined, {
        timeout: 5000,
      });
      fireEvent.click(within(pagination).getByTestId('pagination-next'));
      await waitFor(() =>
        expect(fetchMembers).toHaveBeenLastCalledWith(
          expect.objectContaining({ params: expect.objectContaining({ offset: 0 }) }),
        ),
      );
      expect(await screen.findByTestId('group-member')).toHaveAttribute('data-value', 'u1');
    });
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

  describe('基本資料（GroupBasicSection）', () => {
    const EDITOR = [...READER, 'group:update'] as PermissionKey[];

    async function openEditor() {
      renderRoute(routes, '/group/g1', EDITOR);
      fireEvent.click(await screen.findByTestId('group-edit-button', undefined, { timeout: 5000 }));
      return screen.findByTestId('group-edit-form');
    }

    it('只能讀 → 沒有編輯按鈕', async () => {
      renderRoute(routes, '/group/g1', READER);
      await screen.findByText('Alice', undefined, { timeout: 5000 });
      expect(screen.queryByTestId('group-edit-button')).toBeNull();
    });

    it('編輯：開啟時帶入目前的名稱與說明並聚焦名稱，送出開始編輯時的版本', async () => {
      const form = await openEditor();
      const name = within(form).getByTestId('group-name-edit-input');
      expect(name).toHaveValue('美術');
      expect(name).toHaveFocus();

      fireEvent.change(name, { target: { value: '美術部' } });
      fireEvent.change(form.querySelector('textarea')!, {
        target: { value: '負責視覺' },
      });
      fireEvent.click(within(form).getByTestId('group-save-button'));

      await waitFor(() => expect(updateGroup).toHaveBeenCalledTimes(1));
      expect(updateGroup.mock.calls[0]![0]).toMatchObject({
        params: { groupId: 'g1', body: { name: '美術部', description: '負責視覺', version: 1 } },
      });
      await waitFor(() => expect(screen.queryByTestId('group-edit-form')).toBeNull());
    });

    it('名稱空白不能儲存；取消回到檢視', async () => {
      const form = await openEditor();
      fireEvent.change(within(form).getByTestId('group-name-edit-input'), {
        target: { value: '  ' },
      });
      expect(within(form).getByTestId('group-save-button')).toBeDisabled();
      fireEvent.click(within(form).getByRole('button', { name: '取消' }));
      expect(screen.queryByTestId('group-edit-form')).toBeNull();
      expect(updateGroup).not.toHaveBeenCalled();
    });

    it('同名 → 以 toast 顯示錯誤，輸入保留', async () => {
      updateGroup.mockRejectedValue(new AppError('GROUP_NAME_DUPLICATE', 409));
      const form = await openEditor();
      fireEvent.change(within(form).getByTestId('group-name-edit-input'), {
        target: { value: '程式' },
      });
      fireEvent.click(within(form).getByTestId('group-save-button'));
      expect(await screen.findByText('已有同名的群組（名稱不分大小寫）。')).toBeInTheDocument();
      expect(screen.getByTestId('group-name-edit-input')).toHaveValue('程式');
    });

    it('版本衝突 → 重新載入後以最新的內容與版本為基礎', async () => {
      updateGroup.mockRejectedValueOnce(new AppError('GROUP_VERSION_CONFLICT', 409));
      const form = await openEditor();
      fireEvent.click(within(form).getByTestId('group-save-button'));
      await screen.findByTestId('version-conflict-alert');

      fetchGroup.mockResolvedValue({ ...GROUP, name: '視覺', description: '新說明', version: 3 });
      fireEvent.click(screen.getByTestId('version-conflict-reload'));
      await waitFor(() => expect(screen.getByTestId('group-name-edit-input')).toHaveValue('視覺'));

      fireEvent.click(screen.getByTestId('group-save-button'));
      await waitFor(() => expect(updateGroup).toHaveBeenCalledTimes(2));
      expect(updateGroup.mock.calls[1]![0]).toMatchObject({
        params: { body: { name: '視覺', description: '新說明', version: 3 } },
      });
    });

    it('重新載入失敗 → 以 toast 顯示錯誤', async () => {
      updateGroup.mockRejectedValueOnce(new AppError('GROUP_VERSION_CONFLICT', 409));
      const form = await openEditor();
      fireEvent.click(within(form).getByTestId('group-save-button'));
      await screen.findByTestId('version-conflict-alert');

      fetchGroup.mockRejectedValue(new AppError('GROUP_NOT_FOUND', 404));
      fireEvent.click(screen.getByTestId('version-conflict-reload'));
      expect(await screen.findByText('找不到這個群組，可能已被刪除。')).toBeInTheDocument();
    });
  });
});
