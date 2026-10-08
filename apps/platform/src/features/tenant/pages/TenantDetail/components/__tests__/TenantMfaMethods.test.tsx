import { AppError } from '@b2b-system/web-core/errors';
import { mfaMethodRegistry, registerMfaMethod, totpMethod } from '@b2b-system/web-core/mfa';
import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformMfaMethod, PlatformTenant } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import tenantZhTW from '../../../../locales/zh_TW.json';
import { tenantFixture } from '../../../../test-fixtures';
import { TenantMfaMethods } from '../TenantMfaMethods';

const { listMethods, impact, update } = vi.hoisted(() => ({
  listMethods: vi.fn(),
  impact: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/apis/platform-mfa-method/get-mfa-method-list/fetcher', () => ({
  fetchMfaMethodListQuery: listMethods,
}));
vi.mock('@/apis/platform-mfa-method/get-mfa-method-impact/fetcher', () => ({
  fetchMfaMethodImpact: impact,
}));
vi.mock('@/apis/platform-tenant/update-tenant/fetcher', () => ({
  fetchUpdateTenantMutation: update,
}));

function methodFixture(overrides: Partial<PlatformMfaMethod> = {}): PlatformMfaMethod {
  return {
    id: 'totp',
    challenge: 'none',
    enrollAt: 'anywhere',
    assurance: 'possession',
    maxFactorsPerAccount: 5,
    realms: ['tenant', 'platform'],
    defaultEnabled: true,
    globalState: 'default',
    effective: true,
    tenantOverrides: { on: 0, off: 0 },
    stats: null,
    platformAdminEnabled: true,
    ...overrides,
  };
}

function render(tenant: PlatformTenant, canUpdate = true) {
  return renderWithPermissions(<TenantMfaMethods tenant={tenant} canUpdate={canUpdate} />, [
    'tenant:read',
    'tenant:update',
  ]);
}

async function row(id: string): Promise<HTMLElement> {
  const rows = await screen.findAllByTestId('tenant-mfa-method');
  const found = rows.find((el) => el.dataset.value === id);
  if (!found) throw new Error(`找不到方式 ${id}`);
  return found;
}

async function choose(id: string, choice: 'default' | 'on' | 'off') {
  await userEvent.click(within(await row(id)).getByTestId('tenant-mfa-method-select'));
  const option = (await screen.findAllByRole('option')).find((el) => el.dataset.value === choice);
  await userEvent.click(option!);
}

beforeAll(() => initTestI18n(tenantZhTW));

beforeEach(() => {
  registerMfaMethod(totpMethod);
  listMethods.mockReset().mockResolvedValue({
    items: [
      methodFixture(),
      methodFixture({ id: 'email', globalState: 'off' }),
      methodFixture({ id: 'platform-only', realms: ['platform'] }),
    ],
  });
  impact.mockReset().mockResolvedValue({ stranded: 0 });
  update.mockReset().mockImplementation(async ({ params }) => ({
    ...tenantFixture(),
    mfaMethods: params.body.mfaMethods,
  }));
});

afterEach(() => {
  mfaMethodRegistry.reset();
});

describe('TenantMfaMethods（租戶的 MFA 方式開關，docs/architecture/backend/21-mfa.md §5）', () => {
  it('只列租戶可用的方式；登記過的方式顯示名稱，沒登記的顯示 id；全平台關閉的標示出來', async () => {
    render(tenantFixture());
    const rows = await screen.findAllByTestId('tenant-mfa-method');
    expect(rows.map((el) => el.dataset.value)).toEqual(['totp', 'email']);
    expect(rows[0]).toHaveTextContent('驗證器 App');
    expect(rows[1]).toHaveTextContent('email');
    expect(rows[1]).toHaveTextContent(tenantZhTW.tenant.mfa.killed);
    expect(rows[0]).not.toHaveTextContent(tenantZhTW.tenant.mfa.killed);
  });

  it('選擇反映租戶的覆寫：沒覆寫是依全平台、true 是開、false 是關', async () => {
    render(tenantFixture({ mfaMethods: { email: false } }));
    expect(within(await row('totp')).getByTestId('tenant-mfa-method-select')).toHaveTextContent(
      tenantZhTW.tenant.flag.default,
    );
    expect(within(await row('email')).getByTestId('tenant-mfa-method-select')).toHaveTextContent(
      tenantZhTW.tenant.flag.off,
    );
  });

  it('打開直接送出完整的覆寫表，不需確認', async () => {
    const tenant = tenantFixture({ mfaMethods: { email: false } });
    render(tenant);
    await choose('totp', 'on');
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, body: { mfaMethods: { email: false, totp: true } } },
    });
    expect(impact).not.toHaveBeenCalled();
  });

  it('回到「依全平台」→ 從覆寫表移除', async () => {
    const tenant = tenantFixture({ mfaMethods: { totp: true } });
    render(tenant);
    await choose('totp', 'default');
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, body: { mfaMethods: {} } },
    });
  });

  it('選了目前的值 → 不送出', async () => {
    render(tenantFixture({ mfaMethods: { totp: true } }));
    await choose('totp', 'on');
    expect(update).not.toHaveBeenCalled();
  });

  it('關閉要先看這個租戶受影響的人數並確認；取消就不送出', async () => {
    const tenant = tenantFixture();
    impact.mockResolvedValue({ stranded: 2 });
    render(tenant);

    await choose('totp', 'off');
    const dialog = await screen.findByTestId('mfa-method-off-dialog');
    expect(impact).toHaveBeenCalledWith({ params: { id: 'totp', tenantId: tenant.id } });
    expect(dialog).toHaveTextContent('2 位使用者');
    fireEvent.click(within(dialog).getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('mfa-method-off-dialog')).toBeNull());
    expect(update).not.toHaveBeenCalled();

    await choose('totp', 'off');
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, body: { mfaMethods: { totp: false } } },
    });
  });

  it('打開被後端拒絕（403）→ 顯示錯誤提示', async () => {
    update.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    render(tenantFixture());
    await choose('totp', 'on');
    expect(await screen.findByTestId('toast')).toBeInTheDocument();
  });

  it('沒有 tenant:update → 看得到但不能切換', async () => {
    render(tenantFixture(), false);
    await row('totp');
    for (const select of screen.getAllByTestId('tenant-mfa-method-select')) {
      expect(select).toBeDisabled();
    }
  });
});
