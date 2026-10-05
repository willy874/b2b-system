import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { registerTrashType, resetTrashRegistry } from '@/core/trash';
import type { TrashRestoreActionProps } from '@/core/trash';
import { initTestI18n } from '@/test/i18n';

import { registerTrashPagePermissions, Routes } from '../../..';
import trashZhTW from '../../../locales/zh_TW.json';

const { fetchTrash, restore } = vi.hoisted(() => ({ fetchTrash: vi.fn(), restore: vi.fn() }));
vi.mock('@/apis/trash/get-trash-list/fetcher', () => ({ fetchTrashListQuery: fetchTrash }));

const ITEM = {
  id: '55555555-5555-4555-8555-555555555555',
  type: 'user',
  name: 'Deleted Person',
  description: 'deleted@acme.test',
  deletedAt: '2026-09-30T00:00:00.000Z',
  deletedBy: { id: '66666666-6666-4666-8666-666666666666', name: 'Admin' },
  purgeAt: '2026-10-30T00:00:00.000Z',
};

/** 擁有者 feature 登記的還原操作：這裡用假的，只驗證回收桶頁有把列交給它。 */
function FakeRestoreAction({ item }: TrashRestoreActionProps) {
  return (
    <button type="button" data-testid="fake-restore" onClick={() => restore(item.id)}>
      restore
    </button>
  );
}

const routes = [Routes.TrashListRoute];

beforeAll(() => initTestI18n(trashZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerTrashPagePermissions();
  resetTrashRegistry();
  registerTrashType({
    type: 'user',
    order: 10,
    labelI18nKey: 'menu.user',
    permission: 'user:delete' as PermissionKey,
    RestoreAction: FakeRestoreAction,
  });
  fetchTrash.mockReset().mockResolvedValue({
    items: [ITEM],
    pagination: { offset: 0, limit: 20, total: 1 },
  });
  restore.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('回收桶頁（docs/architecture/frontend/13-trash.md）', () => {
  it('有 user:delete → 使用者分頁列出已刪除的人，每一列有擁有者提供的還原操作', async () => {
    renderRoute(routes, '/trash', ['user:read', 'user:delete'] as PermissionKey[]);
    expect(await screen.findByText('Deleted Person')).toBeInTheDocument();
    expect(screen.getByText('deleted@acme.test')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(fetchTrash.mock.calls[0]![0].params).toMatchObject({ type: 'user', offset: 0 });

    fireEvent.click(screen.getByTestId('fake-restore'));
    expect(restore).toHaveBeenCalledWith(ITEM.id);
  });

  it('沒有任何類型的刪除權限 → 沒有分頁、不查詢，顯示說明', async () => {
    renderRoute(routes, '/trash', ['user:read'] as PermissionKey[]);
    expect(await screen.findByTestId('trash-no-type')).toBeInTheDocument();
    expect(screen.queryByTestId('fake-restore')).toBeNull();
    expect(fetchTrash).not.toHaveBeenCalled();
  });

  it('權限未水合 → 不閃現分頁、還原操作或「沒有類型」的說明', async () => {
    renderRoute(routes, '/trash', 'unhydrated');
    expect(await screen.findByTestId('trash-page')).toBeInTheDocument();
    expect(screen.queryByTestId('trash-tabs')).toBeNull();
    expect(screen.queryByTestId('trash-no-type')).toBeNull();
    await waitFor(() => expect(fetchTrash).not.toHaveBeenCalled());
  });

  it('只有 role:delete → 進得去，只看到角色分頁（頁面權限是任一種 <resource>:delete）', async () => {
    registerTrashType({
      type: 'role',
      order: 20,
      labelI18nKey: 'menu.role',
      permission: 'role:delete' as PermissionKey,
      RestoreAction: FakeRestoreAction,
    });
    fetchTrash.mockResolvedValue({
      items: [{ ...ITEM, type: 'role', name: 'Deleted Role', description: null }],
      pagination: { offset: 0, limit: 20, total: 1 },
    });
    renderRoute(routes, '/trash', ['role:read', 'role:delete'] as PermissionKey[]);
    expect(await screen.findByText('Deleted Role')).toBeInTheDocument();
    expect(fetchTrash.mock.calls[0]![0].params.type).toBe('role');
  });

  it('只有 file:delete → 進得去，只看到檔案分頁（docs/architecture/backend/14-revisions.md §9 R4）', async () => {
    registerTrashType({
      type: 'file',
      order: 30,
      labelI18nKey: 'menu.file',
      permission: 'file:delete' as PermissionKey,
      RestoreAction: FakeRestoreAction,
    });
    fetchTrash.mockResolvedValue({
      items: [{ ...ITEM, type: 'file', name: 'hero.png', description: '/素材' }],
      pagination: { offset: 0, limit: 20, total: 1 },
    });
    renderRoute(routes, '/trash', ['file:read', 'file:delete'] as PermissionKey[]);
    expect(await screen.findByText('hero.png')).toBeInTheDocument();
    expect(screen.getByText('/素材')).toBeInTheDocument();
    expect(fetchTrash.mock.calls[0]![0].params.type).toBe('file');
  });

  it('網址上的類型看不到時改看第一個看得到的類型', async () => {
    renderRoute(routes, '/trash?type=role', ['user:delete'] as PermissionKey[]);
    expect(await screen.findByText('Deleted Person')).toBeInTheDocument();
    expect(fetchTrash.mock.calls[0]![0].params.type).toBe('user');
  });
});
