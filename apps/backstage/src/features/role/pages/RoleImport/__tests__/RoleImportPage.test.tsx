import { renderRoute } from '@b2b-system/web-core/testing';
import { screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerRolePagePermissions, Routes } from '../../..';
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

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerRolePagePermissions();
  featureStore.setState({
    resolved: true,
    statuses: new Map([['dataTransfer', 'ready']]),
  });
  fetchColumns.mockReset().mockResolvedValue({ items: [], readOnly: [] });
});

describe('RoleImportPage（docs/architecture/backend/22-data-transfer.md §12.1）', () => {
  it('有 role:create → 可以切換新增與修改', async () => {
    renderRoute([Routes.RoleImportRoute], '/role/import', [
      'role:read',
      'role:create',
      'role:update',
    ] as PermissionKey[]);
    expect(
      await screen.findByTestId('role-import-page', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('import-mode')).toBeInTheDocument();
    expect(fetchColumns).toHaveBeenCalledWith(
      expect.objectContaining({ params: { type: 'role', mode: 'create' } }),
    );
  });

  it('只有 role:update → 只有修改模式', async () => {
    renderRoute([Routes.RoleImportRoute], '/role/import', [
      'role:read',
      'role:update',
    ] as PermissionKey[]);
    expect(
      await screen.findByTestId('role-import-page', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('import-mode')).toBeNull();
    expect(fetchColumns).toHaveBeenCalledWith(
      expect.objectContaining({ params: { type: 'role', mode: 'update' } }),
    );
  });
});
