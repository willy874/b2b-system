import { Outlet } from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/core/errors';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { registerRolePagePermissions, Routes } from '../../..';
import roleZhTW from '../../../locales/zh_TW.json';

const { fetchRole, fetchRevisions, fetchRevision, revert } = vi.hoisted(() => ({
  fetchRole: vi.fn(),
  fetchRevisions: vi.fn(),
  fetchRevision: vi.fn(),
  revert: vi.fn(),
}));
vi.mock('@/apis/role/get-role-detail/fetcher', () => ({ fetchRoleDetailQuery: fetchRole }));
vi.mock('@/apis/role/get-role-revisions/fetcher', () => ({
  fetchRoleRevisionsQuery: fetchRevisions,
}));
vi.mock('@/apis/role/get-role-revision/fetcher', () => ({ fetchRoleRevisionQuery: fetchRevision }));
vi.mock('@/apis/role/revert-role-revision/fetcher', () => ({
  fetchRoleRevertRevisionMutation: revert,
}));

const ROLE_ID = '33333333-3333-4333-8333-333333333333';
const PATH = `/role/${ROLE_ID}/revision`;
const ROLE = {
  id: ROLE_ID,
  slug: 'editor',
  name: 'Editor',
  description: null,
  isSystem: false,
  permissionCount: 1,
  userCount: 0,
  version: 4,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z',
};
const READER = ['role:read'] as PermissionKey[];
const EDITOR = ['role:read', 'role:update'] as PermissionKey[];
const MANAGER = ['role:read', 'role:update', 'role:grantPermission'] as PermissionKey[];

const SUMMARIES = [
  {
    version: 3,
    createdAt: '2026-09-30T00:00:00.000Z',
    actor: { id: 'u', name: 'Alice' },
    tooLarge: false,
  },
  { version: 2, createdAt: '2026-09-29T00:00:00.000Z', actor: null, tooLarge: true },
  { version: 1, createdAt: '2026-09-28T00:00:00.000Z', actor: null, tooLarge: false },
];
const SNAPSHOTS: Record<number, unknown> = {
  3: { name: 'Editor', description: null, permissionKeys: ['user:read'] },
  2: null,
  1: { name: 'Writer', description: null, permissionKeys: ['auditLog:read'] },
};

// 列表與詳情換成只渲染子路由：這裡只測版本紀錄對話框本身
Routes.RoleListRoute.update({ component: Outlet });
Routes.RoleDetailRoute.update({ component: Outlet });
const routes = [
  Routes.RoleListRoute.addChildren([
    Routes.RoleDetailRoute.addChildren([Routes.RoleDetailRevisionRoute]),
  ]),
];

const item = (version: number) =>
  screen
    .getAllByTestId('role-revision-item')
    .find((element) => element.getAttribute('data-value') === String(version)) as HTMLElement;

beforeAll(() => initTestI18n(roleZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerRolePagePermissions();
  fetchRole.mockReset().mockResolvedValue(ROLE);
  fetchRevisions.mockReset().mockImplementation(({ params }: { params: { limit: number } }) =>
    Promise.resolve({
      items: SUMMARIES.slice(0, params.limit),
      pagination: { offset: 0, limit: params.limit, total: SUMMARIES.length },
    }),
  );
  fetchRevision.mockReset().mockImplementation(({ params }: { params: { version: number } }) =>
    Promise.resolve({
      ...SUMMARIES.find((summary) => summary.version === params.version),
      snapshot: SNAPSHOTS[params.version],
    }),
  );
  revert.mockReset().mockResolvedValue({ ...ROLE, name: 'Writer', version: 5 });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('版本紀錄頁（docs/architecture/frontend/14-revisions.md）', () => {
  it('列出版本（新的在前）：最新一版標「目前」、過大未保存的標出來、系統寫入的顯示「系統」', async () => {
    renderRoute(routes, PATH, READER);
    await waitFor(() => expect(screen.getAllByTestId('role-revision-item')).toHaveLength(3));
    expect(item(3)).toHaveTextContent('目前');
    expect(item(3)).toHaveTextContent('Alice');
    expect(item(2)).toHaveTextContent('過大未保存');
    expect(item(1)).toHaveTextContent('系統');
  });

  it('選一版 → 顯示與目前內容的差異', async () => {
    renderRoute(routes, PATH, READER);
    fireEvent.click(await waitFor(() => item(1)));
    const diff = await screen.findByTestId('role-revision-diff');
    await waitFor(() => expect(diff).toHaveTextContent('Writer'));
    expect(diff).toHaveTextContent('auditLog:read');
  });

  describe('還原到這一版（頁面的三個權限案例）', () => {
    it('只有 role:read → 看得到版本與差異，沒有還原按鈕', async () => {
      renderRoute(routes, PATH, READER);
      fireEvent.click(await waitFor(() => item(1)));
      await screen.findByTestId('role-revision-diff');
      expect(screen.queryByTestId('role-revision-revert')).not.toBeInTheDocument();
    });

    it('權限未水合 → 不閃現還原按鈕', async () => {
      renderRoute(routes, PATH, 'unhydrated');
      await waitFor(() => expect(fetchRevisions).toHaveBeenCalled());
      expect(screen.queryByTestId('role-revision-revert')).not.toBeInTheDocument();
    });

    it('有 role:update ＋ role:grantPermission → 確認後帶確認時的角色 version 送出', async () => {
      renderRoute(routes, PATH, MANAGER);
      fireEvent.click(await waitFor(() => item(1)));
      const button = await screen.findByTestId('role-revision-revert');
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);

      const confirm = await screen.findByTestId('role-revision-revert-confirm');
      expect(confirm).toHaveTextContent('第 1 版');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));

      await waitFor(() => expect(revert).toHaveBeenCalledTimes(1));
      expect(revert.mock.calls[0]![0]).toMatchObject({
        params: { roleId: ROLE_ID, version: 1, body: { version: 4 } },
      });
      expect(await screen.findByTestId('toast')).toHaveAttribute('data-value', 'success');
    });
  });

  it('最新一版、過大未保存的一版不能還原', async () => {
    renderRoute(routes, PATH, MANAGER);
    await waitFor(() =>
      expect(screen.getByTestId('role-revision-detail')).toHaveTextContent('這一版就是目前的內容'),
    );
    expect(screen.getByTestId('role-revision-revert')).toBeDisabled();

    fireEvent.click(item(2));
    await waitFor(() =>
      expect(screen.getByTestId('role-revision-detail')).toHaveTextContent('過大未保存'),
    );
    expect(screen.getByTestId('role-revision-revert')).toBeDisabled();
  });

  it('權限鍵會改變而沒有 role:grantPermission → 按鈕停用並說明', async () => {
    renderRoute(routes, PATH, EDITOR);
    fireEvent.click(await waitFor(() => item(1)));
    await waitFor(() =>
      expect(screen.getByTestId('role-revision-detail')).toHaveTextContent('授予角色權限'),
    );
    expect(screen.getByTestId('role-revision-revert')).toBeDisabled();
  });

  it('別人已改過角色 → 關閉確認框、顯示 VersionConflictAlert、不彈 toast；重新載入後消失', async () => {
    revert.mockRejectedValueOnce(new AppError('ROLE_VERSION_CONFLICT', 409, { current: 5 }));
    renderRoute(routes, PATH, MANAGER);
    fireEvent.click(await waitFor(() => item(1)));
    const button = await screen.findByTestId('role-revision-revert');
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(
      within(await screen.findByTestId('role-revision-revert-confirm')).getByTestId(
        'alert-dialog-confirm',
      ),
    );

    expect(await screen.findByTestId('version-conflict-alert')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId('role-revision-revert-confirm')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();

    fetchRole.mockResolvedValue({ ...ROLE, version: 5 });
    fireEvent.click(screen.getByTestId('version-conflict-reload'));
    await waitFor(() =>
      expect(screen.queryByTestId('version-conflict-alert')).not.toBeInTheDocument(),
    );
  });

  it('反提權（403 AUTHZ_ESCALATION）→ 提示這一版帶有自己沒有的權限', async () => {
    revert.mockRejectedValueOnce(
      new AppError('AUTHZ_ESCALATION', 403, { missing: ['auditLog:read'] }),
    );
    renderRoute(routes, PATH, MANAGER);
    fireEvent.click(await waitFor(() => item(1)));
    const button = await screen.findByTestId('role-revision-revert');
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(
      within(await screen.findByTestId('role-revision-revert-confirm')).getByTestId(
        'alert-dialog-confirm',
      ),
    );

    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveAttribute('data-value', 'error');
    expect(toast).toHaveTextContent('未持有的權限');
  });
});
