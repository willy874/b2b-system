import { describe, expect, it } from 'vitest';

import { isWeakSecret, parseTrustProxy, validateEnv } from '../env.schema';

describe('parseTrustProxy（TRUST_PROXY → Express trust proxy）', () => {
  it.each([
    ['', false],
    ['false', false],
    ['true', true],
    ['1', 1],
    [' 2 ', 2],
    ['uniquelocal', 'uniquelocal'],
    ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
  ])('%j → %j', (input, expected) => {
    expect(parseTrustProxy(input)).toBe(expected);
  });
});

describe('production 的金鑰與危險預設值（docs/issues/02-security.md SEC-10）', () => {
  const STRONG = 'Qm9vdHN0cmFwLXJhbmRvbS1rZXktZm9yLXRlc3RzLTEyMzQ1Njc4OTA=';
  const production = (overrides: Record<string, string> = {}) => ({
    NODE_ENV: 'production',
    PLATFORM_DATABASE_URL: 'postgres://u:p@db:5432/platform',
    JWT_SECRET: STRONG,
    FILE_STORAGE_ACCESS_KEY_ID: 'prod-access-key',
    FILE_STORAGE_SECRET_ACCESS_KEY: 'x9Kq2mVb7LpR4sTw8YzA',
    MAIL_TRANSPORT: 'smtp',
    SUPER_ADMIN_EMAIL: 'admin@example.com',
    OIDC_JWKS: '{"keys":[]}',
    OIDC_COOKIE_KEYS: 'cookie-key',
    IDP_SECRET_KEY: 'idp-key',
    TENANT_SECRET_KEY: 'tenant-key',
    ...overrides,
  });

  it('設定齊全、金鑰是隨機值時可以啟動', () => {
    expect(validateEnv(production()).NODE_ENV).toBe('production');
  });

  it.each([
    ['JWT_SECRET', 'change-me-in-production-min-32-chars'],
    ['JWT_SECRET', 'a'.repeat(40)],
    ['FILE_STORAGE_ACCESS_KEY_ID', 'b2b-system-dev'],
    ['FILE_STORAGE_SECRET_ACCESS_KEY', 'b2b-system-dev-secret'],
  ])('%s 是範例值或低熵（%s）→ 啟動失敗', (key, value) => {
    expect(() => validateEnv(production({ [key]: value }))).toThrow(key);
  });

  it('MAIL_TRANSPORT=console（會把啟用／重設連結寫進日誌）→ 啟動失敗', () => {
    expect(() => validateEnv(production({ MAIL_TRANSPORT: 'console' }))).toThrow('MAIL_TRANSPORT');
  });

  it('開發環境照常接受範例值', () => {
    const env = production({
      NODE_ENV: 'development',
      JWT_SECRET: 'change-me-in-production-min-32-chars',
    });
    expect(validateEnv(env).NODE_ENV).toBe('development');
  });

  it('isWeakSecret', () => {
    expect(isWeakSecret('CHANGE-ME-please-0123456789')).toBe(true);
    expect(isWeakSecret('abababababababababababababababab')).toBe(true);
    expect(isWeakSecret(STRONG)).toBe(false);
  });
});
