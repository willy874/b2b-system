import { AppError } from '@b2b-system/web-core/errors';
import { RootRoute } from '@b2b-system/web-core/router';
import { renderRoute } from '@b2b-system/web-core/testing';
import { createRoute } from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformTenant } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import type { useTenantPermission } from '../../../../hooks/useTenantPermission';
import tenantZhTW from '../../../../locales/zh_TW.json';
import { TenantListRoute } from '../../../../routes';
import { tenantFixture } from '../../../../test-fixtures';
import { TenantDetailHeader } from '../TenantDetailHeader';

const { retry, disable, enable, update, removeTenant } = vi.hoisted(() => ({
  retry: vi.fn(),
  disable: vi.fn(),
  enable: vi.fn(),
  update: vi.fn(),
  removeTenant: vi.fn(),
}));
vi.mock('@/apis/platform-tenant/retry-tenant-provisioning/fetcher', () => ({
  fetchRetryTenantProvisioningMutation: retry,
}));
vi.mock('@/apis/platform-tenant/disable-tenant/fetcher', () => ({
  fetchDisableTenantMutation: disable,
}));
vi.mock('@/apis/platform-tenant/enable-tenant/fetcher', () => ({
  fetchEnableTenantMutation: enable,
}));
vi.mock('@/apis/platform-tenant/update-tenant/fetcher', () => ({
  fetchUpdateTenantMutation: update,
}));
vi.mock('@/apis/platform-tenant/delete-tenant/fetcher', () => ({
  fetchDeleteTenantMutation: removeTenant,
}));

type Permission = ReturnType<typeof useTenantPermission>;

const ALL: Permission = {
  hydrated: true,
  canAccess: true,
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
};
const READ_ONLY: Permission = { ...ALL, canCreate: false, canUpdate: false, canDelete: false };
/** 權限還沒水合時頁面級 facade 的值：`can*` 全是 false。 */
const UNHYDRATED: Permission = {
  hydrated: false,
  canAccess: false,
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canDelete: false,
};

const ACTIONS = [
  'tenant-rename',
  'tenant-retry',
  'tenant-disable',
  'tenant-enable',
  'tenant-remove',
];

/** 詳情放在 `/`，另有清單的 `/tenant`：刪除後導回清單。 */
function render(tenant: PlatformTenant, permission: Permission = ALL) {
  const detail = createRoute({
    getParentRoute: () => RootRoute,
    path: '/',
    component: () => <TenantDetailHeader tenant={tenant} permission={permission} />,
  });
  return renderRoute([detail, TenantListRoute], '/', ['tenant:read']);
}

const FORBIDDEN = new AppError('AUTHZ_FORBIDDEN', 403);

beforeAll(() => initTestI18n(tenantZhTW));

beforeEach(() => {
  for (const fn of [retry, disable, enable, update, removeTenant]) fn.mockReset();
});

describe('TenantDetailHeader（租戶詳情的標題列與操作）', () => {
  it('有權限 → 啟用中的租戶有改名、停用、刪除', async () => {
    render(tenantFixture());
    expect(await screen.findByTestId('tenant-rename')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-disable')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-remove')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-enable')).toBeNull();
    expect(screen.queryByTestId('tenant-retry')).toBeNull();
  });

  it('只能讀 → 沒有任何操作', async () => {
    render(tenantFixture({ status: 'failed' }), READ_ONLY);
    expect(await screen.findByTestId('tenant-name')).toHaveTextContent('Acme 股份有限公司');
    for (const id of ACTIONS) expect(screen.queryByTestId(id)).toBeNull();
  });

  it('權限未水合 → 不閃現任何操作', async () => {
    render(tenantFixture({ status: 'failed' }), UNHYDRATED);
    expect(await screen.findByTestId('tenant-name')).toBeInTheDocument();
    for (const id of ACTIONS) expect(screen.queryByTestId(id)).toBeNull();
  });

  it('已停用 → 有啟用、沒有停用；啟用直接送出', async () => {
    const tenant = tenantFixture({ status: 'disabled' });
    enable.mockResolvedValue({ ...tenant, status: 'active' });
    render(tenant);
    fireEvent.click(await screen.findByTestId('tenant-enable'));
    await waitFor(() => expect(enable).toHaveBeenCalled());
    expect(enable.mock.calls[0]?.[0]).toEqual({ params: { id: tenant.id } });
    expect(screen.queryByTestId('tenant-disable')).toBeNull();
    expect(await screen.findByTestId('toast')).toHaveTextContent(tenantZhTW.tenant.enable.success);
  });

  it('啟用被拒絕（403）→ 顯示錯誤提示', async () => {
    enable.mockRejectedValue(FORBIDDEN);
    render(tenantFixture({ status: 'disabled' }));
    fireEvent.click(await screen.findByTestId('tenant-enable'));
    expect(await screen.findByTestId('toast')).not.toHaveTextContent(
      tenantZhTW.tenant.enable.success,
    );
  });

  it('佈建失敗：沒有 tenant:create 就沒有重試；重試被拒絕顯示錯誤提示', async () => {
    retry.mockRejectedValue(FORBIDDEN);
    const failed = tenantFixture({ status: 'failed' });
    const { unmount } = render(failed, { ...ALL, canCreate: false });
    expect(await screen.findByTestId('tenant-remove')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-retry')).toBeNull();
    unmount();

    render(failed);
    fireEvent.click(await screen.findByTestId('tenant-retry'));
    await waitFor(() => expect(retry).toHaveBeenCalled());
    expect(await screen.findByTestId('toast')).toBeInTheDocument();
  });

  it('佈建中 → 不能刪除', async () => {
    render(tenantFixture({ status: 'provisioning' }));
    expect(await screen.findByTestId('tenant-rename')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-remove')).toBeNull();
  });

  it('停用：取消就不送出；確認後送出並關閉確認框', async () => {
    const tenant = tenantFixture();
    disable.mockResolvedValue({ ...tenant, status: 'disabled' });
    render(tenant);

    fireEvent.click(await screen.findByTestId('tenant-disable'));
    fireEvent.click(await screen.findByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('alert-dialog-confirm')).toBeNull());
    expect(disable).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('tenant-disable'));
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(disable).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByTestId('alert-dialog-confirm')).toBeNull());
  });

  it('停用被拒絕（403）→ 顯示錯誤提示並關閉確認框', async () => {
    disable.mockRejectedValue(FORBIDDEN);
    render(tenantFixture());
    fireEvent.click(await screen.findByTestId('tenant-disable'));
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    expect(await screen.findByTestId('toast')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('alert-dialog-confirm')).toBeNull());
  });
});

describe('RenameTenantDialog（改名）', () => {
  async function openRename(tenant = tenantFixture()) {
    const result = render(tenant);
    fireEvent.click(await screen.findByTestId('tenant-rename'));
    const dialog = await screen.findByTestId('tenant-rename-dialog');
    return { ...result, dialog, input: within(dialog).getByTestId('tenant-rename-input') };
  }

  it('打開時帶入目前的名稱；送出去掉前後空白後關閉', async () => {
    const tenant = tenantFixture();
    update.mockResolvedValue({ ...tenant, name: '新名稱' });
    const { input } = await openRename(tenant);
    expect(input).toHaveValue('Acme 股份有限公司');

    fireEvent.change(input, { target: { value: '  新名稱  ' } });
    fireEvent.click(screen.getByTestId('tenant-rename-submit'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, body: { name: '新名稱' } },
    });
    await waitFor(() => expect(screen.queryByTestId('tenant-rename-dialog')).toBeNull());
    expect(await screen.findByTestId('toast')).toHaveTextContent(tenantZhTW.tenant.rename.success);
  });

  it('名稱空白 → 顯示必填錯誤、不送出', async () => {
    const { input, dialog } = await openRename();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(await within(dialog).findByText(tenantZhTW.tenant.error.nameRequired)).toBeVisible();
    expect(update).not.toHaveBeenCalled();
  });

  it('後端拒絕（403）→ 錯誤顯示在欄位上，對話框留著', async () => {
    update.mockRejectedValue(FORBIDDEN);
    const { input, dialog } = await openRename();
    fireEvent.change(input, { target: { value: '新名稱' } });
    fireEvent.click(screen.getByTestId('tenant-rename-submit'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(await within(dialog).findByTestId('field-error')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-rename-dialog')).toBeInTheDocument();
  });

  it('沒改就取消 → 直接關閉；改了再取消 → 先確認放棄', async () => {
    await openRename();
    fireEvent.click(screen.getByTestId('tenant-rename-cancel'));
    await waitFor(() => expect(screen.queryByTestId('tenant-rename-dialog')).toBeNull());

    fireEvent.click(screen.getByTestId('tenant-rename'));
    const reopened = await screen.findByTestId('tenant-rename-input');
    // 重新打開時以目前的名稱重設
    expect(reopened).toHaveValue('Acme 股份有限公司');
    fireEvent.change(reopened, { target: { value: '改了' } });
    fireEvent.click(screen.getByTestId('tenant-rename-cancel'));
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(screen.queryByTestId('tenant-rename-dialog')).toBeNull());
    expect(update).not.toHaveBeenCalled();
  });
});

describe('DeleteTenantDialog（刪除要輸入租戶代碼）', () => {
  async function openRemove() {
    const result = render(tenantFixture());
    fireEvent.click(await screen.findByTestId('tenant-remove'));
    const input = await screen.findByTestId('tenant-remove-confirm-input');
    return { ...result, input };
  }

  it('代碼前後的空白不影響比對；在輸入框按 Enter 也能送出，完成後回到清單', async () => {
    removeTenant.mockResolvedValue(undefined);
    const { input, router } = await openRemove();
    fireEvent.change(input, { target: { value: ' acme ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(removeTenant).toHaveBeenCalledOnce());
    await waitFor(() => expect(router.state.location.pathname).toBe('/tenant'));
  });

  it('代碼不符時 Enter 不送出', async () => {
    const { input } = await openRemove();
    fireEvent.change(input, { target: { value: 'acm' } });
    fireEvent.submit(input.closest('form')!);
    expect(removeTenant).not.toHaveBeenCalled();
  });

  it('刪除被拒絕（403）→ 顯示錯誤提示，對話框留著', async () => {
    removeTenant.mockRejectedValue(FORBIDDEN);
    const { input } = await openRemove();
    fireEvent.change(input, { target: { value: 'acme' } });
    fireEvent.click(screen.getByTestId('tenant-remove-submit'));
    expect(await screen.findByTestId('toast')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-remove-dialog')).toBeInTheDocument();
  });

  it('取消後再打開，輸入框是空的', async () => {
    const { input } = await openRemove();
    fireEvent.change(input, { target: { value: 'acme' } });
    fireEvent.click(
      within(screen.getByTestId('tenant-remove-dialog')).getByRole('button', {
        name: '取消',
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('tenant-remove-dialog')).toBeNull());

    fireEvent.click(screen.getByTestId('tenant-remove'));
    expect(await screen.findByTestId('tenant-remove-confirm-input')).toHaveValue('');
    expect(screen.getByTestId('tenant-remove-submit')).toBeDisabled();
  });

  it('按 Esc 不會關閉（影響整個租戶，只能按取消離開）', async () => {
    const { input } = await openRemove();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByTestId('tenant-remove-dialog')).toBeInTheDocument();
  });

  it('送出中按 Esc 不會關閉', async () => {
    let finish: (value: unknown) => void = () => undefined;
    removeTenant.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { input } = await openRemove();
    fireEvent.change(input, { target: { value: 'acme' } });
    fireEvent.click(screen.getByTestId('tenant-remove-submit'));
    await waitFor(() => expect(removeTenant).toHaveBeenCalled());
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByTestId('tenant-remove-dialog')).toBeInTheDocument();
    finish(undefined);
  });
});
