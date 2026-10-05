import { AppError } from '@b2b-system/web-core/errors';
import { i18n, initI18n } from '@b2b-system/web-core/locales';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import type { FeatureFlag, PlatformTenant } from '@/shared/api-sdk';

import { registerTenantPagePermissions, Routes } from '../../..';
import tenantZhTW from '../../../locales/zh_TW.json';
import { FEATURE_PARAMS, tenantFixture } from '../../../test-fixtures';

const { getTenant, retry, disable, removeDomain, update, removeTenant, listFlags } = vi.hoisted(
  () => ({
    listFlags: vi.fn(),
    update: vi.fn(),
    removeTenant: vi.fn(),
    getTenant: vi.fn(),
    retry: vi.fn(),
    disable: vi.fn(),
    removeDomain: vi.fn(),
  }),
);
vi.mock('@/apis/platform-tenant/get-tenant/query', () => ({
  TENANT_DETAIL_QUERY_KEY: 'TENANT_DETAIL_QUERY_KEY',
  getTenantQueryOptions: (id: string) => ({
    queryKey: ['TENANT_DETAIL_QUERY_KEY', id],
    queryFn: () => getTenant(id),
  }),
}));
vi.mock('@/apis/platform-feature-flag/get-feature-flag-list/query', () => ({
  FEATURE_FLAG_LIST_QUERY_KEY: 'FEATURE_FLAG_LIST_QUERY_KEY',
  getFeatureFlagListQueryOptions: () => ({
    queryKey: ['FEATURE_FLAG_LIST_QUERY_KEY'],
    queryFn: listFlags,
  }),
}));
vi.mock('@/apis/platform-tenant/retry-tenant-provisioning/mutation', () => ({
  getRetryTenantProvisioningMutationOptions: () => ({ mutationFn: retry }),
}));
vi.mock('@/apis/platform-tenant/disable-tenant/mutation', () => ({
  getDisableTenantMutationOptions: () => ({ mutationFn: disable }),
}));
vi.mock('@/apis/platform-tenant/update-tenant/mutation', () => ({
  getUpdateTenantMutationOptions: () => ({ mutationFn: update }),
}));
vi.mock('@/apis/platform-tenant/delete-tenant/mutation', () => ({
  getDeleteTenantMutationOptions: () => ({ mutationFn: removeTenant }),
}));
vi.mock('@/apis/platform-tenant/remove-tenant-domain/mutation', () => ({
  getRemoveTenantDomainMutationOptions: () => ({ mutationFn: removeDomain }),
}));

const ALL: PermissionKey[] = ['tenant:read', 'tenant:create', 'tenant:update', 'tenant:delete'];

/** `search` 是網址的查詢字串（例：`?tab=features`）；預設停在概覽分頁。 */
function renderPage(
  tenant: PlatformTenant,
  permissions: PermissionKey[] | 'unhydrated',
  search = '',
) {
  getTenant.mockResolvedValue(tenant);
  return renderRoute(
    [Routes.TenantListRoute, Routes.TenantDetailRoute],
    `/tenant/${tenant.id}${search}`,
    permissions,
  ).router;
}

/** 某個 feature 的開關：固定的 testid 在列上，feature id 在 `data-value`（docs/conventions/06-literal-strings.md §3.3）。 */
async function featureToggle(feature: string): Promise<HTMLElement> {
  const rows = await screen.findAllByTestId('tenant-feature');
  const row = rows.find((el) => el.dataset.value === feature);
  if (!row) throw new Error(`找不到 feature ${feature}`);
  return within(row).getByTestId('tenant-feature-toggle');
}

/** 某個 flag 的選單：固定的 testid 在列上，key 在 `data-value`。 */
async function chooseFlag(key: string, choice: 'default' | 'on' | 'off') {
  const rows = await screen.findAllByTestId('tenant-flag');
  const row = rows.find((el) => el.dataset.value === key);
  if (!row) throw new Error(`找不到 flag ${key}`);
  await userEvent.click(within(row).getByTestId('tenant-flag-select'));
  // 語系包由 route loader 載入，測試裡是 key：以選項的 `data-value` 挑
  const option = (await screen.findAllByRole('option')).find((el) => el.dataset.value === choice);
  await userEvent.click(option!);
}

function featureFlagFixture(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    key: 'levelEditor.v2',
    description: '新版關卡編輯器',
    defaultEnabled: false,
    owner: 'content',
    removeBy: '2099-12-31',
    globalState: null,
    tenantOverrides: { on: 0, off: 0 },
    ...overrides,
  };
}

const FLAG_ADMIN: PermissionKey[] = [...ALL, 'featureFlag:read'];
const FEATURES_TAB = '?tab=features';
const FLAGS_TAB = '?tab=flags';

/** 分頁列上的分頁（`Tabs` 的固定 testid 是 `tab`，值在 `data-value`）。 */
function tabValues(): Array<string | undefined> {
  return within(screen.getByTestId('tenant-tabs'))
    .getAllByTestId('tab')
    .map((el) => el.dataset.value);
}

beforeEach(() => {
  listFlags.mockReset().mockResolvedValue({
    items: [
      featureFlagFixture(),
      featureFlagFixture({ key: 'user.bulkInvite', globalState: 'off' }),
    ],
  });
  resetPagePermissionRegistry();
  registerTenantPagePermissions();
  getTenant.mockReset();
  retry.mockReset();
  disable.mockReset();
  removeDomain.mockReset();
  update.mockReset();
  removeTenant.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('租戶詳情（docs/architecture/05-tenancy.md §10.2 D12、D13）', () => {
  it('啟用中、全部權限 → 停用、刪除、改名、網域管理；主要網域排第一', async () => {
    renderPage(tenantFixture(), ALL);
    expect(await screen.findByTestId('tenant-disable')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-remove')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-rename')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-enable')).toBeNull();
    expect(screen.queryByTestId('tenant-retry')).toBeNull();
    const domains = screen.getAllByTestId('tenant-domain').map((el) => el.dataset.value);
    expect(domains).toEqual(['acme.localhost:5173', 'portal.acme.test']);
    expect(screen.getByTestId('tenant-domain-input')).toBeInTheDocument();
  });

  it('只有 tenant:read → 沒有任何操作', async () => {
    renderPage(tenantFixture(), ['tenant:read']);
    expect(await screen.findByTestId('tenant-code')).toHaveTextContent('acme');
    for (const id of ['tenant-disable', 'tenant-remove', 'tenant-rename', 'tenant-domain-input']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.queryByTestId('tenant-domain-remove')).toBeNull();
  });

  it('權限未水合 → 不閃現任何操作', async () => {
    renderPage(tenantFixture(), 'unhydrated');
    expect(await screen.findByTestId('tenant-detail-page')).toBeInTheDocument();
    for (const id of ['tenant-disable', 'tenant-remove', 'tenant-rename', 'tenant-domain-input']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('標題列：麵包屑回到清單、名稱與狀態', async () => {
    const router = renderPage(tenantFixture(), ['tenant:read']);
    expect(await screen.findByTestId('tenant-name')).toHaveTextContent('Acme 股份有限公司');
    expect(screen.getByTestId('tenant-status')).toHaveAttribute('data-value', 'active');
    fireEvent.click(screen.getByTestId('tenant-back'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tenant'));
  });

  it('分頁：預設概覽（網址不帶 tab）；切換寫進網址', async () => {
    const router = renderPage(tenantFixture(), FLAG_ADMIN);
    expect(await screen.findByTestId('tenant-code')).toHaveTextContent('acme');
    expect(router.state.location.searchStr).toBe('');
    expect(tabValues()).toEqual(['overview', 'features', 'flags']);
    expect(screen.queryByTestId('tenant-feature')).toBeNull();

    const featuresTab = within(screen.getByTestId('tenant-tabs'))
      .getAllByTestId('tab')
      .find((el) => el.dataset.value === 'features');
    fireEvent.click(featuresTab!);
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'features' }));
    expect(await screen.findAllByTestId('tenant-feature')).toHaveLength(9);
    expect(screen.queryByTestId('tenant-domain')).toBeNull();
  });

  it('網址上不認得的分頁 → 回到概覽', async () => {
    renderPage(tenantFixture(), ALL, '?tab=nope');
    expect(await screen.findByTestId('tenant-tab-panel')).toHaveAttribute('data-value', 'overview');
  });

  it('租戶不存在（404）→ 說明原因並提供回到清單，沒有重試', async () => {
    getTenant.mockReset().mockRejectedValue(new AppError('TENANT_NOT_FOUND', 404));
    const router = renderRoute(
      [Routes.TenantListRoute, Routes.TenantDetailRoute],
      '/tenant/44444444-4444-4444-8444-444444444444',
      ALL,
    ).router;
    expect(await screen.findByTestId('tenant-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('query-error-retry')).toBeNull();
    fireEvent.click(screen.getByTestId('tenant-back'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tenant'));
  });

  it('佈建失敗 → 顯示原因與重試（需要 tenant:create）', async () => {
    const failed = tenantFixture({ status: 'failed', provisionError: 'connect ECONNREFUSED' });
    retry.mockResolvedValue({ ...failed, status: 'provisioning', provisionError: null });
    renderPage(failed, ALL);
    expect(await screen.findByTestId('tenant-provision-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tenant-retry'));
    await waitFor(() => expect(retry).toHaveBeenCalled());
    expect(retry.mock.calls[0]?.[0]).toEqual({ params: { id: failed.id } });
  });

  it('佈建中 → 沒有停用與刪除', async () => {
    renderPage(tenantFixture({ status: 'provisioning', provisionedAt: null }), ALL);
    expect(await screen.findByTestId('tenant-provisioning')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-disable')).toBeNull();
    expect(screen.queryByTestId('tenant-remove')).toBeNull();
  });

  it('停用要先確認', async () => {
    const tenant = tenantFixture();
    disable.mockResolvedValue({ ...tenant, status: 'disabled' });
    renderPage(tenant, ALL);
    fireEvent.click(await screen.findByTestId('tenant-disable'));
    expect(disable).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(disable).toHaveBeenCalled());
    expect(disable.mock.calls[0]?.[0]).toEqual({ params: { id: tenant.id } });
  });

  it('只剩一個網域時不能移除', async () => {
    renderPage(tenantFixture({ domains: ['acme.localhost:5173'] }), ALL);
    expect(await screen.findByTestId('tenant-domain')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-domain-remove')).toBeNull();
  });

  it('啟用的功能：每個 feature 一個開關，反映目前的清單（docs/architecture/frontend/02-plugin-system.md §9.2 D8）', async () => {
    renderPage(tenantFixture({ features: ['auditLog'] }), ALL, FEATURES_TAB);
    const rows = await screen.findAllByTestId('tenant-feature');
    expect(rows.map((el) => el.dataset.value)).toEqual([
      'file',
      'auditLog',
      'job',
      'trash',
      'systemSetting',
      'identityProvider',
      'tenantSwitch',
      'webhook',
      'announcement',
    ]);
    expect(await featureToggle('file')).toHaveAttribute('aria-checked', 'false');
    expect(await featureToggle('auditLog')).toHaveAttribute('aria-checked', 'true');
    expect(await featureToggle('job')).toHaveAttribute('aria-checked', 'false');
  });

  it('啟用的功能：打開直接送出完整清單（固定順序）', async () => {
    const tenant = tenantFixture({ features: ['job'] });
    update.mockResolvedValue({ ...tenant, features: ['file', 'job'] });
    renderPage(tenant, ALL, FEATURES_TAB);
    fireEvent.click(await featureToggle('file'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, body: { features: ['file', 'job'] } },
    });
    expect(screen.queryByTestId('tenant-feature-dialog')).toBeNull();
  });

  it('啟用的功能：關閉要先確認，取消就不送出；確認後送出去掉該 feature 的清單', async () => {
    const tenant = tenantFixture({ features: ['file', 'auditLog', 'job'] });
    update.mockResolvedValue({ ...tenant, features: ['auditLog', 'job'] });
    renderPage(tenant, ALL, FEATURES_TAB);
    const toggle = await featureToggle('file');

    fireEvent.click(toggle);
    expect(await screen.findByTestId('tenant-feature-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('tenant-feature-dialog')).toBeNull());
    expect(update).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, body: { features: ['auditLog', 'job'] } },
    });
  });

  it('啟用的功能：關閉外部 IdP 的確認框另外說明對登入的影響（docs/architecture/05-tenancy.md §12.2 D5）', async () => {
    await initI18n('zh-TW');
    i18n.addResourceBundle('zh-TW', 'translation', tenantZhTW, true, true);
    renderPage(tenantFixture(), ALL, FEATURES_TAB);
    fireEvent.click(await featureToggle('identityProvider'));
    expect(await screen.findByTestId('tenant-feature-dialog')).toBeInTheDocument();
    expect(screen.getByText(/沒有設定密碼的使用者要先重設密碼/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('tenant-feature-dialog')).toBeNull());
    fireEvent.click(await featureToggle('file'));
    expect(await screen.findByTestId('tenant-feature-dialog')).toBeInTheDocument();
    expect(screen.queryByText(/重設密碼/)).toBeNull();
  });

  it('啟用的功能：只有 tenant:read → 不能切換', async () => {
    renderPage(tenantFixture(), ['tenant:read'], FEATURES_TAB);
    await screen.findAllByTestId('tenant-feature');
    const toggles = screen.getAllByTestId('tenant-feature-toggle');
    expect(toggles).toHaveLength(9);
    for (const toggle of toggles) expect(toggle).toHaveAttribute('data-disabled');
  });

  it('佈建完成但後續步驟失敗 → 顯示提醒（不是佈建失敗），沒有重試', async () => {
    renderPage(tenantFixture({ provisionError: 'storageBucket: FILE_STORAGE_UNAVAILABLE' }), ALL);
    expect(await screen.findByTestId('tenant-provision-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-provision-error')).toBeNull();
    expect(screen.queryByTestId('tenant-retry')).toBeNull();
  });

  it('主要網域沒有移除鈕；其他網域移除前要確認，取消後網域還在', async () => {
    renderPage(tenantFixture(), ALL);
    expect(await screen.findByTestId('tenant-domain-primary')).toBeInTheDocument();
    const removeButtons = screen.getAllByTestId('tenant-domain-remove');
    expect(removeButtons.map((el) => el.dataset.value)).toEqual(['portal.acme.test']);

    fireEvent.click(removeButtons[0]!);
    expect(await screen.findByTestId('tenant-domain-remove-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('tenant-domain-remove-dialog')).toBeNull());
    expect(removeDomain).not.toHaveBeenCalled();
  });

  it('確認移除網域：送出中兩顆按鈕都停用，不會重複送出', async () => {
    const tenant = tenantFixture();
    let finish: (value: unknown) => void = () => undefined;
    removeDomain.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderPage(tenant, ALL);
    fireEvent.click(await screen.findByTestId('tenant-domain-remove'));
    const confirmButton = await screen.findByTestId('alert-dialog-confirm');
    fireEvent.click(confirmButton);
    // loading 的按鈕用 aria-disabled（保留焦點），取消鈕是原生 disabled
    await waitFor(() => expect(confirmButton).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByTestId('alert-dialog-cancel')).toBeDisabled();
    fireEvent.click(confirmButton);
    expect(removeDomain).toHaveBeenCalledTimes(1);
    expect(removeDomain.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, domain: 'portal.acme.test' },
    });
    finish({ ...tenant, domains: ['acme.localhost:5173'] });
    await waitFor(() => expect(screen.queryByTestId('tenant-domain-remove-dialog')).toBeNull());
  });

  it('刪除租戶要輸入租戶代碼才能確認', async () => {
    const tenant = tenantFixture();
    removeTenant.mockResolvedValue(undefined);
    const router = renderPage(tenant, ALL);
    fireEvent.click(await screen.findByTestId('tenant-remove'));
    const submit = await screen.findByTestId('tenant-remove-submit');
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId('tenant-remove-confirm-input'), {
      target: { value: 'acm' },
    });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(removeTenant).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('tenant-remove-confirm-input'), {
      target: { value: 'acme' },
    });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(removeTenant).toHaveBeenCalled());
    expect(removeTenant.mock.calls[0]?.[0]).toEqual({ params: { id: tenant.id } });
    // 刪除後回到清單
    await waitFor(() => expect(router.state.location.pathname).toBe('/tenant'));
    await waitFor(() => expect(router.state.status).toBe('idle'));
  });

  it('試行開關：沒有 featureFlag:read → 沒有這個分頁，網址指向它也回到概覽（docs/architecture/05-tenancy.md §11.2 D8）', async () => {
    renderPage(tenantFixture(), ALL, FLAGS_TAB);
    expect(await screen.findByTestId('tenant-disable')).toBeInTheDocument();
    expect(tabValues()).toEqual(['overview', 'features']);
    expect(screen.getByTestId('tenant-tab-panel')).toHaveAttribute('data-value', 'overview');
    expect(screen.getAllByTestId('tenant-domain')).toHaveLength(2);
    expect(screen.queryByTestId('tenant-flag')).toBeNull();
    expect(listFlags).not.toHaveBeenCalled();
  });

  it('試行開關：反映租戶的覆寫；全平台緊急關閉的 flag 標示出來', async () => {
    renderPage(tenantFixture({ flags: { 'levelEditor.v2': true } }), FLAG_ADMIN, FLAGS_TAB);
    await waitFor(() => expect(screen.getAllByTestId('tenant-flag')).toHaveLength(2));
    const killed = screen.getAllByTestId('tenant-flag-killed');
    expect(killed).toHaveLength(1);
    expect(killed[0]?.closest('li')?.dataset.value).toBe('user.bulkInvite');
  });

  it('試行開關：打開直接送出完整的覆寫表（docs/architecture/05-tenancy.md §11.2 D7）', async () => {
    const tenant = tenantFixture({ flags: { 'user.bulkInvite': false } });
    update.mockResolvedValue(tenant);
    renderPage(tenant, FLAG_ADMIN, FLAGS_TAB);

    await chooseFlag('levelEditor.v2', 'on');

    await waitFor(() =>
      expect(update.mock.calls[0]?.[0]).toEqual({
        params: {
          id: tenant.id,
          body: { flags: { 'user.bulkInvite': false, 'levelEditor.v2': true } },
        },
      }),
    );
  });

  it('試行開關：回到「依全平台」→ 從覆寫表移除', async () => {
    const tenant = tenantFixture({ flags: { 'levelEditor.v2': true } });
    update.mockResolvedValue(tenant);
    renderPage(tenant, FLAG_ADMIN, FLAGS_TAB);

    await chooseFlag('levelEditor.v2', 'default');

    await waitFor(() =>
      expect(update.mock.calls[0]?.[0]).toEqual({ params: { id: tenant.id, body: { flags: {} } } }),
    );
  });

  it('試行開關：關閉要先確認，取消就不送出', async () => {
    const tenant = tenantFixture();
    update.mockResolvedValue(tenant);
    renderPage(tenant, FLAG_ADMIN, FLAGS_TAB);

    await chooseFlag('levelEditor.v2', 'off');
    fireEvent.click(await screen.findByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('alert-dialog-confirm')).toBeNull());
    expect(update).not.toHaveBeenCalled();

    await chooseFlag('levelEditor.v2', 'off');
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() =>
      expect(update.mock.calls[0]?.[0]).toEqual({
        params: { id: tenant.id, body: { flags: { 'levelEditor.v2': false } } },
      }),
    );
  });

  it('試行開關：沒有 tenant:update → 看得到但不能切換', async () => {
    renderPage(tenantFixture(), ['tenant:read', 'featureFlag:read'], FLAGS_TAB);
    await waitFor(() => expect(screen.getAllByTestId('tenant-flag-select')).toHaveLength(2));
    for (const select of screen.getAllByTestId('tenant-flag-select')) {
      expect(select).toBeDisabled();
    }
  });

  describe('feature 參數（docs/architecture/05-tenancy.md §13）', () => {
    async function paramRow(key: string): Promise<HTMLElement> {
      const rows = await screen.findAllByTestId('tenant-param');
      const row = rows.find((el) => el.dataset.value === key);
      if (!row) throw new Error(`找不到參數 ${key}`);
      return row;
    }

    it('列在所屬 feature 下，顯示生效值與是否調整過', async () => {
      const tenant = tenantFixture({
        featureParams: FEATURE_PARAMS.map((param) =>
          param.key === 'file.storageQuotaMb' ? { ...param, value: 4096, overridden: true } : param,
        ),
      });
      renderPage(tenant, ALL, FEATURES_TAB);
      const row = await paramRow('file.storageQuotaMb');
      expect(row.closest('[data-testid="tenant-feature"]')).toHaveAttribute('data-value', 'file');
      expect(within(row).getByTestId('tenant-param-value')).toHaveTextContent('4,096');
      expect(within(row).getByTestId('tenant-param-overridden')).toBeInTheDocument();
      expect(
        within(await paramRow('webhook.maxUrls')).queryByTestId('tenant-param-overridden'),
      ).toBeNull();
    });

    it('有 tenant:update → 編輯後只送出這一個參數', async () => {
      const tenant = tenantFixture();
      update.mockResolvedValue(tenant);
      renderPage(tenant, ALL, FEATURES_TAB);
      fireEvent.click(within(await paramRow('webhook.maxUrls')).getByTestId('tenant-param-edit'));
      const dialog = await screen.findByTestId('tenant-param-dialog');
      fireEvent.change(within(dialog).getByTestId('tenant-param-input'), {
        target: { value: '5' },
      });
      fireEvent.click(within(dialog).getByTestId('tenant-param-submit'));
      await waitFor(() => expect(update).toHaveBeenCalled());
      expect(update.mock.calls[0]?.[0]).toEqual({
        params: { id: tenant.id, body: { featureParams: { 'webhook.maxUrls': 5 } } },
      });
    });

    it('超出範圍時不送出，提示允許的範圍', async () => {
      renderPage(tenantFixture(), ALL, FEATURES_TAB);
      fireEvent.click(
        within(await paramRow('job.maxConcurrency')).getByTestId('tenant-param-edit'),
      );
      const dialog = await screen.findByTestId('tenant-param-dialog');
      fireEvent.change(within(dialog).getByTestId('tenant-param-input'), {
        target: { value: '0' },
      });
      fireEvent.click(within(dialog).getByTestId('tenant-param-submit'));
      expect(
        await within(dialog).findByText(/tenant\.param\.rangeError|1～100/),
      ).toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();
    });

    it('調整過的參數可以恢復預設（送 null）', async () => {
      const tenant = tenantFixture({
        featureParams: FEATURE_PARAMS.map((param) =>
          param.key === 'job.maxConcurrency' ? { ...param, value: 3, overridden: true } : param,
        ),
      });
      update.mockResolvedValue(tenant);
      renderPage(tenant, ALL, FEATURES_TAB);
      fireEvent.click(
        within(await paramRow('job.maxConcurrency')).getByTestId('tenant-param-edit'),
      );
      fireEvent.click(await screen.findByTestId('tenant-param-reset'));
      await waitFor(() => expect(update).toHaveBeenCalled());
      expect(update.mock.calls[0]?.[0]).toEqual({
        params: { id: tenant.id, body: { featureParams: { 'job.maxConcurrency': null } } },
      });
    });

    it('只有 tenant:read → 看得到參數，沒有編輯', async () => {
      renderPage(tenantFixture(), ['tenant:read'], FEATURES_TAB);
      const row = await paramRow('file.storageQuotaMb');
      expect(within(row).queryByTestId('tenant-param-edit')).toBeNull();
    });
  });
});
