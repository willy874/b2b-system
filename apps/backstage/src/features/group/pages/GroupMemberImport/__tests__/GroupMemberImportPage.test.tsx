import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderRoute } from '@b2b-system/web-core/testing';
import { renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry, usePageAccess } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { GROUP_MEMBER_IMPORT_PAGE, registerGroupPagePermissions, Routes } from '../../..';
import zhTW from '../../../locales/zh_TW.json';

const { fetchColumns } = vi.hoisted(() => ({ fetchColumns: vi.fn() }));
vi.mock('@/apis/data-transfer/get-import-columns/fetcher', () => ({
  fetchImportColumnsQuery: fetchColumns,
}));

// jsdom 沒有 ResizeObserver（預覽表格用）
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const IMPORTER = ['group:read', 'group:update', 'user:read'] as PermissionKey[];
const routes = [Routes.GroupMemberImportRoute];

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerGroupPagePermissions();
  featureStore.setState({
    resolved: true,
    statuses: new Map([
      ['group', 'ready'],
      ['dataTransfer', 'ready'],
    ]),
  });
  fetchColumns.mockReset().mockResolvedValue({ items: [], readOnly: [] });
});

describe('群組成員匯入的頁面權限（docs/architecture/backend/22-data-transfer.md §12.2）', () => {
  it('有 group:read＋group:update＋user:read → 進得去，只有新增模式', async () => {
    usePermissionStore.setState({ permissions: new Set(IMPORTER), hydrated: true });
    expect(renderHook(() => usePageAccess('/group/import-members')).result.current).toMatchObject({
      page: GROUP_MEMBER_IMPORT_PAGE,
      gated: true,
      canAccess: true,
    });

    renderRoute(routes, '/group/import-members', IMPORTER);
    expect(
      await screen.findByTestId('group-member-import-page', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchColumns).toHaveBeenCalledWith(
        expect.objectContaining({ params: { type: 'groupMember', mode: 'create' } }),
      ),
    );
    expect(screen.queryByTestId('import-mode')).toBeNull();
  });

  it.each([
    ['沒有 user:read（挑不了成員）', ['group:read', 'group:update']],
    ['沒有 group:update', ['group:read', 'user:read']],
  ] as const)('%s → 403', (_, permissions) => {
    usePermissionStore.setState({
      permissions: new Set(permissions as readonly PermissionKey[]),
      hydrated: true,
    });
    expect(renderHook(() => usePageAccess('/group/import-members')).result.current).toMatchObject({
      page: GROUP_MEMBER_IMPORT_PAGE,
      gated: true,
      canAccess: false,
    });
  });

  it('權限未水合 → 還不能判斷（不閃現內容，也不閃 403）', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => usePageAccess('/group/import-members')).result.current).toMatchObject({
      page: GROUP_MEMBER_IMPORT_PAGE,
      hydrated: false,
      gated: true,
    });
  });
});

describe('GroupMemberImportPage', () => {
  it('網址帶 mode=update 也只用新增模式（移除成員在群組詳情做）', async () => {
    renderRoute(routes, '/group/import-members?mode=update', IMPORTER);
    await screen.findByTestId('group-member-import-page', undefined, { timeout: 5000 });
    await waitFor(() => expect(fetchColumns).toHaveBeenCalled());
    expect(fetchColumns).not.toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ mode: 'update' }) }),
    );
  });
});
