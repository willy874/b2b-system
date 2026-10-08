import { renderRoute } from '@b2b-system/web-core/testing';
import { screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerOrganizationPagePermissions, Routes } from '../../..';
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

describe('OrgUnitImportPage、OrgUnitMemberImportPage（docs/architecture/backend/22-data-transfer.md §12.3）', () => {
  it('部門：有 orgUnit:create → 可以切換新增與修改', async () => {
    renderRoute([Routes.OrgUnitImportRoute], '/organization/import', [
      'orgUnit:read',
      'orgUnit:create',
      'orgUnit:update',
    ] as PermissionKey[]);
    expect(
      await screen.findByTestId('org-unit-import-page', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('import-mode')).toBeInTheDocument();
    expect(fetchColumns).toHaveBeenCalledWith(
      expect.objectContaining({ params: { type: 'orgUnit', mode: 'create' } }),
    );
  });

  it('部門成員：新增與修改都可以', async () => {
    renderRoute([Routes.OrgUnitMemberImportRoute], '/organization/import-members', [
      'orgUnit:read',
      'orgUnit:update',
      'user:read',
    ] as PermissionKey[]);
    expect(
      await screen.findByTestId('org-unit-member-import-page', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('import-mode')).toBeInTheDocument();
    expect(fetchColumns).toHaveBeenCalledWith(
      expect.objectContaining({ params: { type: 'orgUnitMember', mode: 'create' } }),
    );
  });
});
