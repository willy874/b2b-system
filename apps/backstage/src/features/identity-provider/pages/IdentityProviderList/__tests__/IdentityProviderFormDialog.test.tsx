import { AppError } from '@b2b-system/web-core/errors';
import { renderInRouter } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import identityProviderZhTW from '../../../locales/zh_TW.json';
import { IdentityProviderFormDialog } from '../components/IdentityProviderFormDialog';

const { createProvider, updateProvider } = vi.hoisted(() => ({
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
}));
vi.mock('@/apis/identity-provider/create-identity-provider/fetcher', () => ({
  fetchCreateIdentityProviderMutation: createProvider,
}));
vi.mock('@/apis/identity-provider/update-identity-provider/fetcher', () => ({
  fetchUpdateIdentityProviderMutation: updateProvider,
}));

const PROVIDER = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Acme Azure AD',
  issuer: 'https://login.acme.test',
  clientId: 'b2b',
  scopes: 'openid email profile',
  enabled: true,
  unmatchedPolicy: 'reject' as const,
  domains: [{ domain: 'acme.test', ssoOnly: true }],
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
};

function renderDialog(provider?: typeof PROVIDER) {
  const onClose = vi.fn();
  renderInRouter(<IdentityProviderFormDialog open provider={provider} onClose={onClose} />);
  return onClose;
}

const dialog = () => screen.getByTestId('identity-provider-form-dialog');
const change = (testId: string, value: string) =>
  fireEvent.change(within(dialog()).getByTestId(testId), { target: { value } });
const submit = () => fireEvent.click(screen.getByTestId('identity-provider-form-submit'));

function fillRequired() {
  change('identity-provider-name-input', '  Okta  ');
  change('identity-provider-issuer-input', ' https://okta.example.com ');
  change('identity-provider-client-id-input', ' client ');
  change('identity-provider-client-secret-input', 's3cret');
}

beforeAll(() => initTestI18n(identityProviderZhTW));

beforeEach(() => {
  createProvider.mockReset().mockResolvedValue(PROVIDER);
  updateProvider.mockReset().mockResolvedValue(PROVIDER);
});

describe('IdentityProviderFormDialog（外部 IdP 連線的表單）', () => {
  it('新增：必填欄位沒填就送出 → 逐欄標出錯誤，不送出', async () => {
    renderDialog();
    await screen.findByTestId('identity-provider-form-dialog');
    change('identity-provider-scopes-input', 'email profile');
    submit();

    await screen.findByText('請輸入名稱');
    for (const message of [
      '請輸入完整的網址',
      '請輸入 Client ID',
      '請輸入 Client secret',
      '必須包含 openid',
    ]) {
      expect(screen.getByText(message)).toBeInTheDocument();
    }
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('新增：去掉空白、網域轉小寫後送出，成功後關閉', async () => {
    const onClose = renderDialog();
    await screen.findByTestId('identity-provider-form-dialog');
    fillRequired();
    change('identity-provider-scopes-input', ' openid   email ');
    fireEvent.click(screen.getByTestId('identity-provider-domain-add'));
    change('identity-provider-domain-input', ' Example.COM ');
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: '只允許 SSO' }));
    submit();

    await waitFor(() => expect(createProvider).toHaveBeenCalledTimes(1));
    expect(createProvider.mock.calls[0]![0]).toMatchObject({
      params: {
        name: 'Okta',
        issuer: 'https://okta.example.com',
        clientId: 'client',
        clientSecret: 's3cret',
        scopes: 'openid email',
        enabled: true,
        unmatchedPolicy: 'reject',
        domains: [{ domain: 'example.com', ssoOnly: true }],
      },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('網域格式不對或重複 → 標在那一列，不送出；移除後可以送出', async () => {
    renderDialog();
    await screen.findByTestId('identity-provider-form-dialog');
    fillRequired();
    fireEvent.click(screen.getByTestId('identity-provider-domain-add'));
    fireEvent.click(screen.getByTestId('identity-provider-domain-add'));
    fireEvent.click(screen.getByTestId('identity-provider-domain-add'));
    const inputs = within(dialog()).getAllByTestId('identity-provider-domain-input');
    fireEvent.change(inputs[0]!, { target: { value: 'acme.test' } });
    fireEvent.change(inputs[1]!, { target: { value: 'ACME.test' } });
    fireEvent.change(inputs[2]!, { target: { value: 'not a domain' } });
    submit();

    expect(await screen.findByText('網域重複')).toBeInTheDocument();
    expect(screen.getByText('網域格式不正確')).toBeInTheDocument();
    expect(createProvider).not.toHaveBeenCalled();

    const removes = within(dialog()).getAllByRole('button', { name: '移除網域' });
    fireEvent.click(removes[2]!);
    fireEvent.click(removes[1]!);
    submit();
    await waitFor(() => expect(createProvider).toHaveBeenCalledTimes(1));
    expect(createProvider.mock.calls[0]![0].params.domains).toEqual([
      { domain: 'acme.test', ssoOnly: false },
    ]);
  });

  it('找不到帳號時改成自動建立 → 顯示說明並送出', async () => {
    renderDialog();
    await screen.findByTestId('identity-provider-form-dialog');
    fillRequired();
    fireEvent.click(screen.getByTestId('identity-provider-policy-select'));
    fireEvent.click(await screen.findByRole('option', { name: '自動建立帳號（沒有任何角色）' }));
    expect(screen.getByText('只有上面登記的網域會自動建立帳號。')).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByTestId('identity-provider-enabled'));
    submit();
    await waitFor(() => expect(createProvider).toHaveBeenCalledTimes(1));
    expect(createProvider.mock.calls[0]![0].params).toMatchObject({
      unmatchedPolicy: 'auto_create',
      enabled: false,
    });
  });

  it('編輯：帶入目前的設定；secret 留空表示不變更', async () => {
    const onClose = renderDialog(PROVIDER);
    await screen.findByTestId('identity-provider-form-dialog');
    expect(within(dialog()).getByTestId('identity-provider-name-input')).toHaveValue(
      'Acme Azure AD',
    );
    expect(within(dialog()).getByTestId('identity-provider-domain-input')).toHaveValue('acme.test');
    change('identity-provider-name-input', 'Acme Entra ID');
    submit();

    await waitFor(() => expect(updateProvider).toHaveBeenCalledTimes(1));
    expect(updateProvider.mock.calls[0]![0]).toMatchObject({
      params: {
        id: PROVIDER.id,
        body: {
          name: 'Acme Entra ID',
          clientSecret: undefined,
          domains: [{ domain: 'acme.test', ssoOnly: true }],
        },
      },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('編輯時填了新的 secret → 一併送出；失敗時錯誤顯示在對話框', async () => {
    updateProvider.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    const onClose = renderDialog(PROVIDER);
    await screen.findByTestId('identity-provider-form-dialog');
    change('identity-provider-client-secret-input', 'rotated');
    submit();
    await waitFor(() => expect(updateProvider).toHaveBeenCalledTimes(1));
    expect(updateProvider.mock.calls[0]![0].params.body.clientSecret).toBe('rotated');
    expect(await screen.findByTestId('identity-provider-form-error')).not.toBeEmptyDOMElement();
    expect(onClose).not.toHaveBeenCalled();
  });
});
