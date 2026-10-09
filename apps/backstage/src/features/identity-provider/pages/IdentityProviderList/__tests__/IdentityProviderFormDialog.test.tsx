import { AppError } from '@b2b-system/web-core/errors';
import { renderInRouter } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IdentityProvider } from '@/shared/api-sdk';
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

const PROVIDER: IdentityProvider = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Acme Azure AD',
  protocol: 'oidc',
  preset: 'generic',
  issuer: 'https://login.acme.test',
  clientId: 'b2b',
  scopes: 'openid email profile',
  enabled: true,
  unmatchedPolicy: 'reject',
  domains: [{ domain: 'acme.test', ssoOnly: true }],
  saml: null,
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
};

/** 測試用的 PEM（內容不必是真的憑證：格式由後端檢查）。 */
const CERT_BODY = 'MIIC'.padEnd(200, 'A');
const PEM = `-----BEGIN CERTIFICATE-----\n${CERT_BODY}\n-----END CERTIFICATE-----`;

const SAML_PROVIDER: IdentityProvider = {
  ...PROVIDER,
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Corp ADFS',
  protocol: 'saml',
  issuer: 'https://adfs.corp.test/adfs/services/trust',
  clientId: null,
  saml: {
    ssoUrl: 'https://adfs.corp.test/adfs/ls/',
    certificates: [
      {
        pem: PEM,
        subject: 'CN=ADFS Signing',
        notAfter: '2027-01-01T00:00:00.000Z',
        fingerprint: 'AB:CD',
      },
    ],
    nameIdFormat: 'persistent',
    emailAttribute: null,
    nameAttribute: null,
    spEntityId: 'https://auth.test/api/oidc-interaction/external/saml/metadata/t/p',
  },
};

const METADATA = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.corp.test/metadata">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${CERT_BODY}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.corp.test/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

async function choose(testId: string, option: string) {
  fireEvent.click(within(dialog()).getByTestId(testId));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

function renderDialog(provider?: IdentityProvider) {
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
      '請輸入完整的網址（格式要符合所選的服務）',
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
          domains: [{ domain: 'acme.test', ssoOnly: true }],
        },
      },
    });
    expect(updateProvider.mock.calls[0]![0].params.body).not.toHaveProperty('clientSecret');
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

  it('範本 Microsoft Entra ID：以目錄 ID 組成 issuer；不是 GUID 時標出錯誤', async () => {
    renderDialog();
    await screen.findByTestId('identity-provider-form-dialog');
    await choose('identity-provider-preset-select', 'Microsoft Entra ID');
    change('identity-provider-name-input', 'Entra');
    change('identity-provider-directory-id-input', 'common');
    change('identity-provider-client-id-input', 'client');
    change('identity-provider-client-secret-input', 's3cret');
    submit();
    expect(await screen.findByText('請輸入目錄 ID（GUID）')).toBeInTheDocument();
    expect(createProvider).not.toHaveBeenCalled();

    change('identity-provider-directory-id-input', '72F988BF-86F1-41AF-91AB-2D7CD011DB47');
    submit();
    await waitFor(() => expect(createProvider).toHaveBeenCalledTimes(1));
    expect(createProvider.mock.calls[0]![0].params).toMatchObject({
      protocol: 'oidc',
      preset: 'microsoft',
      issuer: 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0',
    });
  });

  it('SAML：貼上 metadata 填入 entity ID、SSO 網址與憑證，送出 SAML 的欄位', async () => {
    renderDialog();
    await screen.findByTestId('identity-provider-form-dialog');
    await choose('identity-provider-protocol-select', 'SAML 2.0');
    change('identity-provider-name-input', 'Corp');
    fireEvent.click(within(dialog()).getByText('從 IdP 的 metadata 匯入'));
    change('identity-provider-metadata-input', METADATA);
    fireEvent.click(within(dialog()).getByTestId('identity-provider-metadata-apply'));
    expect(await screen.findByText('已填入 entity ID、SSO 網址與 1 張憑證')).toBeInTheDocument();
    expect(within(dialog()).getByTestId('identity-provider-entity-id-input')).toHaveValue(
      'https://idp.corp.test/metadata',
    );
    submit();

    await waitFor(() => expect(createProvider).toHaveBeenCalledTimes(1));
    const params = createProvider.mock.calls[0]![0].params;
    expect(params).toMatchObject({
      protocol: 'saml',
      name: 'Corp',
      entityId: 'https://idp.corp.test/metadata',
      ssoUrl: 'https://idp.corp.test/sso',
      nameIdFormat: 'persistent',
      emailAttribute: null,
    });
    expect(params.certificates).toHaveLength(1);
    expect(params).not.toHaveProperty('clientSecret');
  });

  it('SAML：metadata 沒有 HTTP-Redirect 的 SSO 網址 → 顯示原因，不改欄位', async () => {
    renderDialog();
    await screen.findByTestId('identity-provider-form-dialog');
    await choose('identity-provider-protocol-select', 'SAML 2.0');
    fireEvent.click(within(dialog()).getByText('從 IdP 的 metadata 匯入'));
    change('identity-provider-metadata-input', METADATA.replace('HTTP-Redirect', 'HTTP-POST'));
    fireEvent.click(within(dialog()).getByTestId('identity-provider-metadata-apply'));
    expect(await screen.findByText('IdP 沒有提供 HTTP-Redirect 的 SSO 網址')).toBeInTheDocument();
    expect(within(dialog()).getByTestId('identity-provider-entity-id-input')).toHaveValue('');
  });

  it('SAML：必填沒填、憑證不是 PEM → 標出錯誤，不送出', async () => {
    renderDialog();
    await screen.findByTestId('identity-provider-form-dialog');
    await choose('identity-provider-protocol-select', 'SAML 2.0');
    change('identity-provider-name-input', 'Corp');
    change('identity-provider-certificate-input', 'not a cert');
    submit();
    expect(await screen.findByText('請輸入 IdP 的 entity ID')).toBeInTheDocument();
    expect(screen.getByText('不是 PEM 格式的憑證')).toBeInTheDocument();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('編輯 SAML：協定不能換、顯示 SP entity ID 與憑證摘要；送出帶 protocol saml', async () => {
    renderDialog(SAML_PROVIDER);
    await screen.findByTestId('identity-provider-form-dialog');
    expect(screen.getByText('建立之後不能更換協定；要換請新增一個連線。')).toBeInTheDocument();
    expect(within(dialog()).getByTestId('identity-provider-sp-entity-id')).toHaveValue(
      SAML_PROVIDER.saml!.spEntityId,
    );
    expect(within(dialog()).getByTestId('identity-provider-certificate-summary')).toHaveTextContent(
      'AB:CD',
    );
    change('identity-provider-email-attribute-input', 'mail');
    submit();
    await waitFor(() => expect(updateProvider).toHaveBeenCalledTimes(1));
    expect(updateProvider.mock.calls[0]![0].params).toMatchObject({
      id: SAML_PROVIDER.id,
      body: {
        protocol: 'saml',
        entityId: SAML_PROVIDER.issuer,
        emailAttribute: 'mail',
        certificates: [PEM],
      },
    });
  });
});
