import { inflateRawSync } from 'node:zlib';

import { beforeAll, describe, expect, it } from 'vitest';

import { createMockSamlIdp } from '../../../../scripts/mock-saml-idp';
import type { MockSamlIdp, MockSamlResponseInput } from '../../../../scripts/mock-saml-idp';
import { NodeSamlExternalClient } from '../external-saml.client';
import type { ExternalSamlProviderConfig, SamlServiceProvider } from '../external-saml.client';

const sp: SamlServiceProvider = {
  entityId: 'https://auth.example.com/api/oidc-interaction/external/saml/metadata/t-1/p-1',
  acsUrl: 'https://auth.example.com/api/oidc-interaction/external/saml/acs',
};

let idp: MockSamlIdp;
let provider: ExternalSamlProviderConfig;
const client = new NodeSamlExternalClient();

beforeAll(async () => {
  idp = await createMockSamlIdp('https://idp.example.com');
  provider = {
    entityId: idp.entityId,
    ssoUrl: idp.ssoUrl,
    certificates: [idp.certificate],
    nameIdFormat: 'persistent',
    emailAttribute: null,
    nameAttribute: null,
  };
});

function response(overrides: Partial<MockSamlResponseInput> = {}): string {
  return idp.buildResponse({
    inResponseTo: '_req-1',
    acsUrl: sp.acsUrl,
    audience: sp.entityId,
    nameId: 'persistent-id-1',
    email: 'alice@acme.com',
    name: 'Alice',
    ...overrides,
  });
}

describe('NodeSamlExternalClient（docs/architecture/04-sso.md §3.3.2）', () => {
  it('authorizationUrl：HTTP-Redirect 的 AuthnRequest，帶 RelayState，回傳 request ID', async () => {
    const { url, requestId } = await client.authorizationUrl(provider, sp, { relayState: 'st-1' });
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(idp.ssoUrl);
    expect(parsed.searchParams.get('RelayState')).toBe('st-1');
    const xml = inflateRawSync(
      Buffer.from(parsed.searchParams.get('SAMLRequest') ?? '', 'base64'),
    ).toString();
    expect(requestId).toMatch(/^_[0-9a-f]{40}$/);
    expect(xml).toContain(`ID="${requestId}"`);
    expect(xml).toContain(`AssertionConsumerServiceURL="${sp.acsUrl}"`);
    expect(xml).toContain(sp.entityId);
  });

  it('簽章正確的回應 → NameID 是 subject、email 屬性視為已驗證、取得名稱', async () => {
    await expect(
      client.validate(provider, sp, { samlResponse: response(), requestId: '_req-1' }),
    ).resolves.toEqual({
      subject: 'persistent-id-1',
      email: 'alice@acme.com',
      emailVerified: true,
      name: 'Alice',
    });
  });

  it('沒有 email 屬性 → email 是 null、未驗證（之後只能靠已連結的身分）', async () => {
    await expect(
      client.validate(provider, sp, {
        samlResponse: response({ email: null }),
        requestId: '_req-1',
      }),
    ).resolves.toMatchObject({ email: null, emailVerified: false });
  });

  it('指定的屬性名稱 → 只看那個屬性', async () => {
    await expect(
      client.validate({ ...provider, emailAttribute: 'mail' }, sp, {
        samlResponse: response(),
        requestId: '_req-1',
      }),
    ).resolves.toMatchObject({ email: null });
  });

  it.each([
    ['InResponseTo 不是這次的 request', { inResponseTo: '_other' }],
    ['沒有 InResponseTo（IdP 主動發起）', { inResponseTo: null }],
    ['Issuer 不是這個 IdP', { issuer: 'https://evil.example.com' }],
    ['Audience 不是我們', { audience: 'https://other-sp.example.com' }],
    ['assertion 已過期', { validForSeconds: -600 }],
    ['assertion 沒有簽章', { unsigned: true }],
    ['簽章後竄改內容', { tamperEmail: 'admin@acme.com' }],
  ] as const)('%s → 拒絕', async (_label, overrides) => {
    await expect(
      client.validate(provider, sp, {
        samlResponse: response(overrides),
        requestId: '_req-1',
      }),
    ).rejects.toThrow();
  });

  it('另一張憑證簽的 → 拒絕；輪替期間兩張都登記則接受', async () => {
    const other = await createMockSamlIdp('https://idp.example.com');
    const signedByOther = other.buildResponse({
      inResponseTo: '_req-1',
      acsUrl: sp.acsUrl,
      audience: sp.entityId,
      nameId: 'persistent-id-1',
      email: 'alice@acme.com',
    });
    await expect(
      client.validate(provider, sp, { samlResponse: signedByOther, requestId: '_req-1' }),
    ).rejects.toThrow();
    await expect(
      client.validate({ ...provider, certificates: [idp.certificate, other.certificate] }, sp, {
        samlResponse: signedByOther,
        requestId: '_req-1',
      }),
    ).resolves.toMatchObject({ subject: 'persistent-id-1' });
  });

  it('metadata：SP 的 entity ID、ACS、要求 assertion 簽章', () => {
    const xml = client.metadata(provider, sp);
    expect(xml).toContain(`entityID="${sp.entityId}"`);
    expect(xml).toContain(`Location="${sp.acsUrl}"`);
    expect(xml).toContain('WantAssertionsSigned="true"');
  });
});
