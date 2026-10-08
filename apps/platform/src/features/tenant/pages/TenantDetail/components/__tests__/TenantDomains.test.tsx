import { AppError } from '@b2b-system/web-core/errors';
import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformTenant } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import tenantZhTW from '../../../../locales/zh_TW.json';
import { tenantFixture } from '../../../../test-fixtures';
import { TenantDomains } from '../TenantDomains';

const { addDomain, removeDomain } = vi.hoisted(() => ({
  addDomain: vi.fn(),
  removeDomain: vi.fn(),
}));
vi.mock('@/apis/platform-tenant/add-tenant-domain/fetcher', () => ({
  fetchAddTenantDomainMutation: addDomain,
}));
vi.mock('@/apis/platform-tenant/remove-tenant-domain/fetcher', () => ({
  fetchRemoveTenantDomainMutation: removeDomain,
}));

function render(tenant: PlatformTenant = tenantFixture(), canUpdate = true) {
  return renderWithPermissions(<TenantDomains tenant={tenant} canUpdate={canUpdate} />, [
    'tenant:read',
    'tenant:update',
  ]);
}

function add(value: string) {
  fireEvent.change(screen.getByTestId('tenant-domain-input'), { target: { value } });
  fireEvent.click(screen.getByTestId('tenant-domain-add'));
}

const FORBIDDEN = new AppError('AUTHZ_FORBIDDEN', 403);

beforeAll(() => initTestI18n(tenantZhTW));

beforeEach(() => {
  addDomain.mockReset().mockImplementation(async () => tenantFixture());
  removeDomain.mockReset().mockImplementation(async () => tenantFixture());
});

describe('TenantDomains（租戶的網域）', () => {
  it('可以更新 → 有新增欄位、非主要網域有移除鈕', () => {
    render();
    expect(screen.getByTestId('tenant-domain-input')).toBeInTheDocument();
    expect(screen.getAllByTestId('tenant-domain-remove').map((el) => el.dataset.value)).toEqual([
      'portal.acme.test',
    ]);
  });

  it('不能更新 → 只列網域，沒有新增與移除', () => {
    render(tenantFixture(), false);
    expect(screen.getAllByTestId('tenant-domain')).toHaveLength(2);
    expect(screen.getByTestId('tenant-domain-primary')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-domain-input')).toBeNull();
    expect(screen.queryByTestId('tenant-domain-remove')).toBeNull();
  });

  it('新增：轉成小寫、去掉空白後送出，成功後清空輸入框', async () => {
    const tenant = tenantFixture();
    render(tenant);
    add('  Portal2.ACME.test  ');
    await waitFor(() => expect(addDomain).toHaveBeenCalled());
    expect(addDomain.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, body: { domain: 'portal2.acme.test' } },
    });
    await waitFor(() => expect(screen.getByTestId('tenant-domain-input')).toHaveValue(''));
    expect(await screen.findByTestId('toast')).toHaveTextContent(
      tenantZhTW.tenant.domain.addSuccess,
    );
  });

  it('可以帶埠號（開發環境的網域）', async () => {
    render();
    add('acme.localhost:5174');
    await waitFor(() => expect(addDomain).toHaveBeenCalled());
  });

  it.each([['not a domain'], ['-acme.test'], ['https://acme.test'], ['']])(
    '格式不正確（%j）→ 顯示錯誤、不送出',
    async (value) => {
      render();
      add(value);
      expect(await screen.findByTestId('field-error')).toHaveTextContent(
        tenantZhTW.tenant.error.domainInvalid,
      );
      expect(addDomain).not.toHaveBeenCalled();
    },
  );

  it('格式錯誤後改對再送出 → 錯誤消失', async () => {
    render();
    add('bad domain');
    await screen.findByTestId('field-error');
    add('ok.acme.test');
    await waitFor(() => expect(addDomain).toHaveBeenCalled());
    expect(screen.queryByText(tenantZhTW.tenant.error.domainInvalid)).toBeNull();
  });

  it('新增被後端拒絕（例：403、網域已被使用）→ 錯誤顯示在欄位上，輸入保留', async () => {
    addDomain.mockRejectedValue(FORBIDDEN);
    render();
    add('portal2.acme.test');
    expect(await screen.findByTestId('field-error')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-domain-input')).toHaveValue('portal2.acme.test');
  });

  it('確認移除 → 送出並關閉確認框', async () => {
    const tenant = tenantFixture();
    render(tenant);
    fireEvent.click(screen.getByTestId('tenant-domain-remove'));
    const dialog = await screen.findByTestId('tenant-domain-remove-dialog');
    expect(dialog).toHaveTextContent('portal.acme.test');
    fireEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(removeDomain).toHaveBeenCalled());
    expect(removeDomain.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, domain: 'portal.acme.test' },
    });
    await waitFor(() => expect(screen.queryByTestId('tenant-domain-remove-dialog')).toBeNull());
  });

  it('移除失敗（403）→ 提示錯誤，確認框留著可以重試', async () => {
    removeDomain.mockRejectedValueOnce(FORBIDDEN);
    render();
    fireEvent.click(screen.getByTestId('tenant-domain-remove'));
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    expect(await screen.findByTestId('toast')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-domain-remove-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(removeDomain).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('tenant-domain-remove-dialog')).toBeNull());
  });
});
