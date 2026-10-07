import { renderRoute } from '@b2b-system/web-core/testing';
import { screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerUserPagePermissions, Routes } from '../../..';
import userZhTW from '../../../locales/zh_TW.json';

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

const routes = [Routes.UserImportRoute];

beforeAll(() => initTestI18n(userZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerUserPagePermissions();
  featureStore.setState({ resolved: true, statuses: new Map([['dataTransfer', 'ready']]) });
  fetchColumns.mockReset().mockResolvedValue({
    items: [
      {
        key: 'email',
        label: 'Email',
        kind: 'string',
        required: true,
        multiple: false,
        matchKey: 2,
        unique: true,
        nullable: false,
        hint: null,
        options: null,
        transitions: null,
      },
    ],
    readOnly: [],
  });
});

describe('UserImportPage（docs/architecture/backend/22-data-transfer.md §7.2）', () => {
  it('有 user:create → 可以切換新增與修改；顯示欄位說明', async () => {
    renderRoute(routes, '/user/import', [
      'user:read',
      'user:create',
      'user:update',
    ] as PermissionKey[]);
    expect(
      await screen.findByTestId('import-mode', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('import-guide')).toHaveTextContent('Email');
  });

  it('只有 user:update → 只有修改模式，不顯示切換', async () => {
    renderRoute(routes, '/user/import', ['user:read', 'user:update'] as PermissionKey[]);
    expect(
      await screen.findByTestId('import-workspace', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('import-mode')).toBeNull();
    expect(fetchColumns).toHaveBeenCalledWith(
      expect.objectContaining({ params: { type: 'user', mode: 'update' } }),
    );
  });
});
