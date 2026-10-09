import { describe, expect, it } from 'vitest';

import {
  hasErrors,
  initialForm,
  isFormDirty,
  issuerOf,
  toCreateRequest,
  toUpdateRequest,
  validateForm,
} from '../adapter';
import { parseIdpMetadata } from '../samlMetadata';

const PEM_BODY = 'MIIC'.padEnd(200, 'A');

describe('外部 IdP 表單的 adapter（docs/architecture/04-sso.md §3.3）', () => {
  it.each([
    ['google', { issuer: 'ignored', directoryId: '' }, 'https://accounts.google.com'],
    [
      'microsoft',
      { issuer: '', directoryId: ' 72F988BF-86F1-41AF-91AB-2D7CD011DB47 ' },
      'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0',
    ],
    ['okta', { issuer: ' https://acme.okta.com ', directoryId: '' }, 'https://acme.okta.com'],
  ] as const)('issuerOf：%s', (preset, values, expected) => {
    expect(issuerOf({ preset, ...values })).toBe(expected);
  });

  it('編輯 Entra 的連線：從 issuer 取回目錄 ID', () => {
    const form = initialForm({
      id: 'p',
      name: 'Entra',
      protocol: 'oidc',
      preset: 'microsoft',
      issuer: 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0',
      clientId: 'c',
      scopes: 'openid',
      enabled: true,
      unmatchedPolicy: 'reject',
      domains: [],
      saml: null,
      createdAt: '',
      updatedAt: '',
    });
    expect(form.directoryId).toBe('72f988bf-86f1-41af-91ab-2d7cd011db47');
  });

  it.each([
    [
      'okta 的 issuer 不是 https',
      { preset: 'okta' as const, issuer: 'http://acme.okta.com' },
      'issuer',
    ],
    [
      'keycloak 少了 /realms/',
      { preset: 'keycloak' as const, issuer: 'https://sso.test/x' },
      'issuer',
    ],
  ])('validateForm：%s', (_label, values, field) => {
    const form = { ...initialForm(), name: 'x', clientId: 'c', clientSecret: 's', ...values };
    expect(validateForm(form, false)).toMatchObject({ [field]: true });
  });

  it('validateForm：SAML 只看 SAML 的欄位；憑證回報不對的位置', () => {
    const form = {
      ...initialForm(),
      protocol: 'saml' as const,
      name: 'Corp',
      entityId: 'urn:corp',
      ssoUrl: 'https://idp.test/sso',
      certificates: [PEM_BODY, 'nope'],
    };
    const errors = validateForm(form, false);
    expect(errors).toMatchObject({ entityId: false, ssoUrl: false, certificates: [1] });
    expect(errors.clientId).toBeUndefined();
    expect(hasErrors(errors)).toBe(true);
    expect(hasErrors(validateForm({ ...form, certificates: [PEM_BODY] }, false))).toBe(false);
  });

  it('送出：OIDC 不帶 SAML 的欄位、SAML 不帶 client；空的屬性名稱送 null；編輯時沒填 secret 不送', () => {
    const oidc = {
      ...initialForm(),
      name: ' A ',
      issuer: 'https://idp.test',
      clientId: 'c',
      clientSecret: 's',
    };
    expect(toCreateRequest(oidc)).not.toHaveProperty('entityId');
    expect(toUpdateRequest({ ...oidc, clientSecret: '' })).not.toHaveProperty('clientSecret');

    const saml = toCreateRequest({
      ...initialForm(),
      protocol: 'saml',
      name: 'Corp',
      entityId: ' urn:corp ',
      ssoUrl: 'https://idp.test/sso',
      certificates: [` ${PEM_BODY} `],
      emailAttribute: '  ',
    });
    expect(saml).toMatchObject({
      protocol: 'saml',
      entityId: 'urn:corp',
      certificates: [PEM_BODY],
      emailAttribute: null,
    });
    expect(saml).not.toHaveProperty('clientId');
  });

  it('isFormDirty：網域列的 key 不算改動', () => {
    const initial = initialForm();
    expect(isFormDirty({ ...initial }, initial)).toBe(false);
    expect(isFormDirty({ ...initial, name: 'x' }, initial)).toBe(true);
  });
});

const metadata = (descriptor: string) => `<?xml version="1.0"?>
<md:EntitiesDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata">
<md:EntityDescriptor entityID="https://idp.test/metadata">${descriptor}</md:EntityDescriptor>
</md:EntitiesDescriptor>`;
const key = (use: string | null, body: string) =>
  `<md:KeyDescriptor${use ? ` use="${use}"` : ''}><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${body}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`;

describe('parseIdpMetadata（瀏覽器解析 IdP 的 SAML metadata）', () => {
  const redirect =
    '<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.test/post"/><md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.test/redirect"/>';

  it('取 HTTP-Redirect 的網址與簽章憑證（略過只用來加密的、去掉重複）', () => {
    const result = parseIdpMetadata(
      metadata(
        `<md:IDPSSODescriptor>${key('signing', 'AAA')}${key(null, 'BBB')}${key('encryption', 'CCC')}${key('signing', 'AAA')}${redirect}</md:IDPSSODescriptor>`,
      ),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        entityId: 'https://idp.test/metadata',
        ssoUrl: 'https://idp.test/redirect',
        certificates: [
          '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----',
          '-----BEGIN CERTIFICATE-----\nBBB\n-----END CERTIFICATE-----',
        ],
      },
    });
  });

  it.each([
    ['不是 XML', '<not xml', 'invalidXml'],
    ['沒有 IdP 的描述（SP 的 metadata）', metadata('<md:SPSSODescriptor/>'), 'noIdpDescriptor'],
    [
      '只有 HTTP-POST',
      metadata(
        '<md:IDPSSODescriptor><md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.test/post"/></md:IDPSSODescriptor>',
      ),
      'noRedirectBinding',
    ],
  ])('%s → %s', (_label, xml, error) => {
    expect(parseIdpMetadata(xml)).toEqual({ ok: false, error });
  });
});
