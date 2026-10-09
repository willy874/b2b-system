import { describe, expect, it } from 'vitest';

import { isEmailVerifiedForPreset, isIssuerAllowedForPreset } from '../oidc-presets';

const ENTRA_TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

describe('OIDC 範本的 issuer 格式（docs/architecture/04-sso.md §3.3.1）', () => {
  it.each([
    ['generic', 'https://anything.example.com/x', true],
    ['google', 'https://accounts.google.com', true],
    ['google', 'https://accounts.google.com/', false],
    ['microsoft', `https://login.microsoftonline.com/${ENTRA_TENANT}/v2.0`, true],
    ['microsoft', 'https://login.microsoftonline.com/common/v2.0', false],
    ['microsoft', 'https://login.microsoftonline.com/organizations/v2.0', false],
    ['microsoft', `https://login.microsoftonline.com/${ENTRA_TENANT}`, false],
    ['okta', 'https://acme.okta.com', true],
    ['okta', 'https://acme.okta.com/oauth2/aus1a2b3c', true],
    ['okta', 'http://acme.okta.com', false],
    ['keycloak', 'https://sso.acme.com/realms/staff', true],
    ['keycloak', 'https://sso.acme.com/auth/realms/staff', true],
    ['keycloak', 'https://sso.acme.com/staff', false],
  ] as const)('%s：%s → %s', (preset, issuer, expected) => {
    expect(isIssuerAllowedForPreset(preset, issuer)).toBe(expected);
  });
});

describe('OIDC 範本的 email 是否已驗證', () => {
  it('沒有 email 一律 false', () => {
    expect(isEmailVerifiedForPreset('generic', { email_verified: true }, null)).toBe(false);
  });

  it.each([
    ['generic：email_verified true', 'generic', { email_verified: true }, true],
    ['generic：字串 "true" 不算', 'generic', { email_verified: 'true' }, false],
    [
      'google：Workspace 帳號（hd 與網域相同）',
      'google',
      { email_verified: true, hd: 'acme.com' },
      true,
    ],
    ['google：一般 Gmail（沒有 hd）', 'google', { email_verified: true }, false],
    ['google：hd 是別的網域', 'google', { email_verified: true, hd: 'other.com' }, false],
    ['microsoft：xms_edov true', 'microsoft', { xms_edov: true }, true],
    ['microsoft：xms_edov 字串 true', 'microsoft', { xms_edov: 'true' }, true],
    ['microsoft：沒有 xms_edov', 'microsoft', {}, false],
    ['okta：email_verified true', 'okta', { email_verified: true }, true],
    ['keycloak：email_verified false', 'keycloak', { email_verified: false }, false],
  ] as const)('%s', (_label, preset, claims, expected) => {
    expect(isEmailVerifiedForPreset(preset, claims, 'alice@acme.com')).toBe(expected);
  });
});
