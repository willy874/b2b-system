import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { parseSearch, RootRoute, stringifySearch } from '@/core/router';
import { usePermissionStore } from '@/core/store';
import { AllProviders } from '@/test/renderWithPermissions';

import { registerFeatureFlagPagePermissions, Routes } from '../../..';
import { featureFlagFixture } from '../../../test-fixtures';

const { listFlags, updateFlag, invalidateResources } = vi.hoisted(() => ({
  listFlags: vi.fn(),
  updateFlag: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/platform-feature-flag/get-feature-flag-list/query', () => ({
  FEATURE_FLAG_LIST_QUERY_KEY: 'FEATURE_FLAG_LIST_QUERY_KEY',
  getFeatureFlagListQueryOptions: () => ({
    queryKey: ['FEATURE_FLAG_LIST_QUERY_KEY'],
    queryFn: listFlags,
  }),
}));
vi.mock('@/apis/platform-feature-flag/update-feature-flag/mutation', () => ({
  getUpdateFeatureFlagMutationOptions: () => ({ mutationFn: updateFlag }),
}));
vi.mock('@/apis/resources', () => ({
  Resource: { FEATURE_FLAG: 'featureFlag' },
  invalidateResources,
}));

const TRIAL = featureFlagFixture();
const EXPIRED = featureFlagFixture({
  key: 'user.bulkInvite',
  removeBy: '2020-01-01',
  globalState: 'on',
});

function renderPage(permissions: PermissionKey[] | 'unhydrated', path = '/feature-flag') {
  usePermissionStore.setState(
    permissions === 'unhydrated'
      ? { permissions: new Set(), hydrated: false }
      : { permissions: new Set(permissions), hydrated: true },
  );
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.FeatureFlagListRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
    parseSearch,
    stringifySearch,
  });
  render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
}

/** 語系包由 route loader 載入，測試裡是 key：以選項的 `data-value` 挑，不依賴文字。 */
async function chooseGlobal(key: string, state: 'default' | 'on' | 'off') {
  const row = (await screen.findAllByTestId('feature-flag-global')).find((cell) =>
    cell.closest('tr')?.textContent?.includes(key),
  );
  await userEvent.click(within(row!).getByTestId('feature-flag-global-select'));
  const option = (await screen.findAllByRole('option')).find((el) => el.dataset.value === state);
  await userEvent.click(option!);
}

beforeEach(() => {
  resetPagePermissionRegistry();
  registerFeatureFlagPagePermissions();
  listFlags.mockReset().mockResolvedValue({ items: [TRIAL, EXPIRED] });
  updateFlag.mockReset();
  invalidateResources.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('試行開關（docs/architecture/05-tenancy.md §11.2 D8）', () => {
  it('列出目錄與全平台狀態；過了 removeBy 的標示已過期', async () => {
    renderPage(['featureFlag:read']);
    await waitFor(() => expect(screen.getAllByTestId('feature-flag-global')).toHaveLength(2));
    expect(
      screen.getAllByTestId('feature-flag-global').map((cell) => cell.getAttribute('data-value')),
    ).toEqual(['default', 'on']);
    expect(screen.getAllByTestId('feature-flag-expired').map((el) => el.dataset.value)).toEqual([
      'user.bulkInvite',
    ]);
  });

  it('有 featureFlag:update → 每列都有切換的選單', async () => {
    renderPage(['featureFlag:read', 'featureFlag:update']);
    await waitFor(() =>
      expect(screen.getAllByTestId('feature-flag-global-select')).toHaveLength(2),
    );
  });

  it('只有 featureFlag:read → 沒有切換的選單，全平台狀態以文字顯示', async () => {
    renderPage(['featureFlag:read']);
    await waitFor(() => expect(screen.getAllByTestId('feature-flag-global')).toHaveLength(2));
    expect(screen.queryByTestId('feature-flag-global-select')).toBeNull();
  });

  it('網址帶關鍵字 → 只列出 key、說明或負責人符合的 flag', async () => {
    renderPage(['featureFlag:read'], '/feature-flag?keyword=bulk');
    await waitFor(() =>
      expect(
        screen.getAllByTestId('feature-flag-global').map((cell) => cell.getAttribute('data-value')),
      ).toEqual(['on']),
    );
    expect(screen.getByTestId('table-search')).toHaveValue('bulk');
  });

  it('權限未水合 → 不閃現切換的選單', async () => {
    renderPage('unhydrated');
    expect(await screen.findByTestId('feature-flag-page')).toBeInTheDocument();
    await waitFor(() => expect(listFlags).toHaveBeenCalled());
    expect(screen.queryByTestId('feature-flag-global-select')).toBeNull();
  });

  it('有 featureFlag:update → 緊急關閉：確認後送出並失效列表', async () => {
    updateFlag.mockResolvedValue({ ...TRIAL, globalState: 'off' });
    renderPage(['featureFlag:read', 'featureFlag:update']);

    await chooseGlobal('levelEditor.v2', 'off');
    expect(updateFlag).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));

    await waitFor(() =>
      expect(updateFlag.mock.calls[0]?.[0]).toEqual({
        params: { key: 'levelEditor.v2', body: { state: 'off' } },
      }),
    );
    await waitFor(() =>
      expect(invalidateResources).toHaveBeenCalledWith([
        { resource: 'featureFlag', kind: 'update' },
      ]),
    );
  });

  it('取消確認 → 不送出', async () => {
    renderPage(['featureFlag:read', 'featureFlag:update']);
    await chooseGlobal('levelEditor.v2', 'on');
    fireEvent.click(await screen.findByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('alert-dialog-confirm')).toBeNull());
    expect(updateFlag).not.toHaveBeenCalled();
  });

  it('目錄是空的 → 顯示空狀態', async () => {
    listFlags.mockResolvedValue({ items: [] });
    renderPage(['featureFlag:read']);
    expect(await screen.findByTestId('feature-flag-table')).toBeInTheDocument();
    await waitFor(() => expect(listFlags).toHaveBeenCalled());
    expect(screen.queryAllByTestId('feature-flag-global')).toHaveLength(0);
  });
});
