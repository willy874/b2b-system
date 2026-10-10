import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderRoute } from '@b2b-system/web-core/testing';
import { renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry, usePageAccess } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { ORG_UNIT_MEMBER_IMPORT_PAGE, registerOrganizationPagePermissions, Routes } from '../../..';
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

const IMPORTER = ['orgUnit:read', 'orgUnit:update', 'user:read'] as PermissionKey[];
const routes = [Routes.OrgUnitMemberImportRoute];

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerOrganizationPagePermissions();
  featureStore.setState({
    resolved: true,
    statuses: new Map([
      ['organization', 'ready'],
      ['dataTransfer', 'ready'],
    ]),
  });
  fetchColumns.mockReset().mockResolvedValue({ items: [], readOnly: [] });
});

describe('部門成員匯入的頁面權限（docs/architecture/backend/22-data-transfer.md §12.3）', () => {
  it('有 orgUnit:read＋orgUnit:update＋user:read → 進得去，可以切換新增與修改', async () => {
    usePermissionStore.setState({ permissions: new Set(IMPORTER), hydrated: true });
    expect(
      renderHook(() => usePageAccess('/organization/import-members')).result.current,
    ).toMatchObject({ page: ORG_UNIT_MEMBER_IMPORT_PAGE, gated: true, canAccess: true });

    renderRoute(routes, '/organization/import-members', IMPORTER);
    expect(
      await screen.findByTestId('org-unit-member-import-page', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('import-mode')).toBeInTheDocument();
  });

  it.each([
    ['沒有 user:read（挑不了成員）', ['orgUnit:read', 'orgUnit:update']],
    ['沒有 orgUnit:update', ['orgUnit:read', 'user:read']],
  ] as const)('%s → 403', (_, permissions) => {
    usePermissionStore.setState({
      permissions: new Set(permissions as readonly PermissionKey[]),
      hydrated: true,
    });
    expect(
      renderHook(() => usePageAccess('/organization/import-members')).result.current,
    ).toMatchObject({ page: ORG_UNIT_MEMBER_IMPORT_PAGE, gated: true, canAccess: false });
  });

  it('權限未水合 → 還不能判斷（不閃現內容，也不閃 403）', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(
      renderHook(() => usePageAccess('/organization/import-members')).result.current,
    ).toMatchObject({ page: ORG_UNIT_MEMBER_IMPORT_PAGE, hydrated: false, gated: true });
  });
});

describe('OrgUnitMemberImportPage', () => {
  it('網址帶 mode=update → 以修改模式取欄位（以匯出的 ID 修改主管、主要部門與職稱）', async () => {
    renderRoute(routes, '/organization/import-members?mode=update', IMPORTER);
    await screen.findByTestId('org-unit-member-import-page', undefined, { timeout: 5000 });
    await waitFor(() =>
      expect(fetchColumns).toHaveBeenCalledWith(
        expect.objectContaining({ params: { type: 'orgUnitMember', mode: 'update' } }),
      ),
    );
  });
});
