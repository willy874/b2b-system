import { AppError } from '@b2b-system/web-core/errors';
import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';

import { registerCdnPagePermissions, Routes } from '../../..';
import { cdnNotDeployedFixture, cdnOverviewFixture } from '../../../test-fixtures';

const { getOverview, updateSettings, checkCdn, purgeCdn, listTenants, invalidateResources } =
  vi.hoisted(() => ({
    getOverview: vi.fn(),
    updateSettings: vi.fn(),
    checkCdn: vi.fn(),
    purgeCdn: vi.fn(),
    listTenants: vi.fn(),
    invalidateResources: vi.fn(),
  }));
vi.mock('@/apis/platform-cdn/get-cdn-overview/query', () => ({
  CDN_OVERVIEW_QUERY_KEY: 'CDN_OVERVIEW_QUERY_KEY',
  getCdnOverviewQueryOptions: () => ({
    queryKey: ['CDN_OVERVIEW_QUERY_KEY'],
    queryFn: getOverview,
  }),
}));
vi.mock('@/apis/platform-cdn/update-cdn-settings/mutation', () => ({
  getUpdateCdnSettingsMutationOptions: () => ({ mutationFn: updateSettings }),
}));
vi.mock('@/apis/platform-cdn/check-cdn/mutation', () => ({
  getCheckCdnMutationOptions: () => ({ mutationFn: checkCdn }),
}));
vi.mock('@/apis/platform-cdn/purge-cdn/mutation', () => ({
  getPurgeCdnMutationOptions: () => ({ mutationFn: purgeCdn }),
}));
vi.mock('@/apis/platform-tenant/get-tenant-list/query', () => ({
  TENANT_LIST_QUERY_KEY: 'TENANT_LIST_QUERY_KEY',
  getTenantListQueryOptions: () => ({ queryKey: ['TENANT_LIST_QUERY_KEY'], queryFn: listTenants }),
}));
vi.mock('@/apis/resources', () => ({
  Resource: { CDN: 'cdn', PLATFORM_JOB: 'platformJob' },
  invalidateResources,
}));

const READ: PermissionKey[] = ['cdn:read'];
const OPERATOR: PermissionKey[] = ['cdn:read', 'cdn:update', 'cdn:purge', 'tenant:read'];
const SUPER_ADMIN: PermissionKey[] = [...OPERATOR, 'cdn:purgeAll'];

function renderPage(permissions: PermissionKey[] | 'unhydrated') {
  usePermissionStore.setState(
    permissions === 'unhydrated'
      ? { permissions: new Set(), hydrated: false }
      : { permissions: new Set(permissions), hydrated: true },
  );
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.CdnRoute]),
    history: createMemoryHistory({ initialEntries: ['/cdn'] }),
    parseSearch,
    stringifySearch,
  });
  render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
}

/** Base UI 的開關與勾選框以 `data-disabled` 表示停用（不是原生的 disabled）。 */
const isDisabled = (element: HTMLElement | undefined) => element?.hasAttribute('data-disabled');

/** 選單的選項（語系包由 route loader 載入，測試裡是 key：以 `data-value` 挑）。 */
async function targetOptions(): Promise<string[]> {
  await userEvent.click(await screen.findByTestId('cdn-purge-type'));
  return (await screen.findAllByRole('option')).map((option) => option.dataset.value ?? '');
}

beforeEach(() => {
  resetPagePermissionRegistry();
  registerCdnPagePermissions();
  getOverview.mockReset().mockResolvedValue(cdnOverviewFixture());
  updateSettings.mockReset().mockResolvedValue(cdnOverviewFixture());
  checkCdn.mockReset();
  purgeCdn.mockReset();
  listTenants.mockReset().mockResolvedValue({ items: [], total: 0 });
  invalidateResources.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('CDN 頁面（docs/architecture/backend/09-file.md §16.12）', () => {
  it('auditor（只有 cdn:read）→ 唯讀：設定的開關停用、沒有清理表單，仍可執行檢查', async () => {
    renderPage(READ);
    expect(isDisabled(await screen.findByTestId('cdn-serving'))).toBe(true);
    expect(screen.getByTestId('cdn-check')).toBeEnabled();
    expect(screen.queryByTestId('cdn-purge-form')).toBeNull();
    expect(screen.queryByTestId('cdn-url-ttl-save')).toBeNull();
  });

  it('operator（cdn:update、cdn:purge）→ 可以改設定與清理，但目標沒有「整個快取」', async () => {
    renderPage(OPERATOR);
    expect(isDisabled(await screen.findByTestId('cdn-serving'))).toBe(false);
    expect(screen.getByTestId('cdn-purge-form')).toBeInTheDocument();
    expect(await targetOptions()).toEqual(['paths', 'fileVariant', 'imageAsset']);
  });

  it('super-admin（另有 cdn:purgeAll）→ 目標可以選整個快取', async () => {
    renderPage(SUPER_ADMIN);
    expect(await targetOptions()).toEqual(['paths', 'fileVariant', 'imageAsset', 'all']);
  });

  it('權限未水合 → 不閃現操作的控制項', async () => {
    renderPage('unhydrated');
    expect(isDisabled(await screen.findByTestId('cdn-serving'))).toBe(true);
    expect(screen.queryByTestId('cdn-purge-form')).toBeNull();
  });

  it('這個部署沒有 CDN → 只有部署區塊與說明，沒有設定、節點與清理', async () => {
    getOverview.mockResolvedValue(cdnNotDeployedFixture());
    renderPage(SUPER_ADMIN);
    expect(await screen.findByTestId('cdn-not-deployed')).toBeInTheDocument();
    expect(screen.queryByTestId('cdn-settings')).toBeNull();
    expect(screen.queryByTestId('cdn-nodes')).toBeNull();
    expect(screen.queryByTestId('cdn-purge')).toBeNull();
  });

  it('關閉：確認後送出 state off 與目前的 version', async () => {
    renderPage(OPERATOR);
    await userEvent.click(await screen.findByTestId('cdn-serving'));
    expect(updateSettings).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() =>
      expect(updateSettings.mock.calls[0]?.[0]).toEqual({ params: { version: 1, state: 'off' } }),
    );
  });

  it('開啟被節點檢查擋下（409 CDN_NOT_READY）→ 開關旁列出每個節點的問題', async () => {
    getOverview.mockResolvedValue(
      cdnOverviewFixture({
        settings: { ...cdnOverviewFixture().settings!, state: 'off', version: 3 },
        effective: { ...cdnOverviewFixture().effective!, serving: false },
      }),
    );
    updateSettings.mockRejectedValue(
      new AppError('CDN_NOT_READY', 409, {
        nodes: [{ address: '10.0.0.12', problems: ['signingKidMissing'] }],
        discovery: { ok: true },
      }),
    );
    renderPage(OPERATOR);
    await userEvent.click(await screen.findByTestId('cdn-serving'));
    expect(updateSettings.mock.calls[0]?.[0]).toEqual({ params: { version: 3, state: 'on' } });
    expect(await screen.findByTestId('cdn-not-ready')).toBeInTheDocument();
    const problem = await screen.findByTestId('cdn-node-problem-item');
    expect(problem.dataset.value).toBe('signingKidMissing');
    expect(screen.getByTestId('cdn-node-problem').dataset.value).toBe('10.0.0.12');
  });

  it('版本衝突 → 不顯示節點問題，重抓頁面', async () => {
    updateSettings.mockRejectedValue(
      new AppError('CDN_SETTINGS_VERSION_CONFLICT', 409, { current: 2 }),
    );
    renderPage(OPERATOR);
    const resources = await screen.findAllByTestId('cdn-resource');
    await userEvent.click(resources.find((el) => el.dataset.value === 'imageAsset')!);
    await waitFor(() =>
      expect(updateSettings.mock.calls[0]?.[0]).toEqual({
        params: { version: 1, resources: ['fileVariant', 'galleryItem'] },
      }),
    );
    await waitFor(() =>
      expect(invalidateResources).toHaveBeenCalledWith([{ resource: 'cdn', kind: 'update' }]),
    );
    expect(screen.queryByTestId('cdn-not-ready')).toBeNull();
  });

  it('部署沒有開放的資源類型 → 勾選框停用', async () => {
    getOverview.mockResolvedValue(
      cdnOverviewFixture({
        deployment: { ...cdnOverviewFixture().deployment, resources: ['fileVariant'] },
        effective: { ...cdnOverviewFixture().effective!, resources: ['fileVariant'] },
      }),
    );
    renderPage(OPERATOR);
    const resources = await screen.findAllByTestId('cdn-resource');
    expect(isDisabled(resources.find((el) => el.dataset.value === 'imageAsset'))).toBe(true);
    expect(isDisabled(resources.find((el) => el.dataset.value === 'fileVariant'))).toBe(false);
  });

  it('邊緣節點：顯示每個節點的 kid 與問題；執行檢查', async () => {
    checkCdn.mockResolvedValue({});
    renderPage(READ);
    const node = await screen.findByTestId('cdn-node');
    expect(node.dataset.value).toBe('10.0.0.11');
    expect(node.textContent).toContain('k2, k1');
    await userEvent.click(screen.getByTestId('cdn-check'));
    await waitFor(() => expect(checkCdn).toHaveBeenCalled());
  });
});
