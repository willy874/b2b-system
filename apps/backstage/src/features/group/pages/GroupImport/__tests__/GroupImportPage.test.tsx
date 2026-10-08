import { renderRoute } from '@b2b-system/web-core/testing';
import { screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerGroupPagePermissions, Routes } from '../../..';
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

describe('GroupImportPage、GroupMemberImportPage（docs/architecture/backend/22-data-transfer.md §12.2）', () => {
  it('群組：有 group:create → 可以切換新增與修改', async () => {
    renderRoute([Routes.GroupImportRoute], '/group/import', [
      'group:read',
      'group:create',
      'group:update',
    ] as PermissionKey[]);
    expect(
      await screen.findByTestId('group-import-page', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('import-mode')).toBeInTheDocument();
    expect(fetchColumns).toHaveBeenCalledWith(
      expect.objectContaining({ params: { type: 'group', mode: 'create' } }),
    );
  });

  it('群組成員：只有新增模式', async () => {
    renderRoute([Routes.GroupMemberImportRoute], '/group/import-members', [
      'group:read',
      'group:update',
      'user:read',
    ] as PermissionKey[]);
    expect(
      await screen.findByTestId('group-member-import-page', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('import-mode')).toBeNull();
    expect(fetchColumns).toHaveBeenCalledWith(
      expect.objectContaining({ params: { type: 'groupMember', mode: 'create' } }),
    );
  });
});
