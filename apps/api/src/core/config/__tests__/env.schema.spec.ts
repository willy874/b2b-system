import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { EnvSchema, isWeakSecret, listenHostOf, parseTrustProxy, validateEnv } from '../env.schema';

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

const secretKey = () => randomBytes(32).toString('base64');
const JWKS = JSON.stringify({
  keys: [
    {
      ...generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' }),
      use: 'sig',
      kid: 'test',
    },
  ],
});

describe('production 的金鑰與危險預設值', () => {
  const STRONG = 'Qm9vdHN0cmFwLXJhbmRvbS1rZXktZm9yLXRlc3RzLTEyMzQ1Njc4OTA=';
  const production = (overrides: Record<string, string> = {}) => ({
    NODE_ENV: 'production',
    PLATFORM_DATABASE_URL: 'postgres://u:p@db:5432/platform',
    JWT_SECRET: STRONG,
    JWT_SIGNING_KEYS: `t1:${randomBytes(48).toString('base64')}`,
    PLATFORM_JWT_SIGNING_KEYS: `p1:${randomBytes(48).toString('base64')}`,
    FILE_URL_SIGNING_KEY: randomBytes(48).toString('base64'),
    FILE_STORAGE_ACCESS_KEY_ID: 'prod-access-key',
    FILE_STORAGE_SECRET_ACCESS_KEY: 'x9Kq2mVb7LpR4sTw8YzA',
    MAIL_TRANSPORT: 'smtp',
    SUPER_ADMIN_EMAIL: 'admin@example.com',
    APP_PUBLIC_URL: 'https://app.example.com',
    PLATFORM_APP_URL: 'https://accounts.example.com',
    OIDC_ISSUER: 'https://accounts.example.com/api/oidc',
    OIDC_JWKS: JWKS,
    OIDC_COOKIE_KEYS: `${secretKey()},${secretKey()}`,
    IDP_SECRET_KEY: secretKey(),
    TENANT_SECRET_KEY: secretKey(),
    WEBHOOK_SECRET_KEY: secretKey(),
    MFA_SECRET_KEY: secretKey(),
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

  it.each(['JWT_SIGNING_KEYS', 'PLATFORM_JWT_SIGNING_KEYS', 'FILE_URL_SIGNING_KEY'])(
    '%s 沒設定（開發時由 JWT_SECRET 推導）→ 啟動失敗',
    (key) => {
      expect(() => validateEnv(production({ [key]: '' }))).toThrow(key);
    },
  );

  it('JWT_SECRET 在 production 是選填（只用來驗證過渡期的舊 token）', () => {
    expect(validateEnv(production({ JWT_SECRET: '' })).JWT_SECRET).toBeUndefined();
  });

  it.each([
    ['JWT_SIGNING_KEYS', 'no-kid-here', '格式'],
    ['JWT_SIGNING_KEYS', `bad kid!:${randomBytes(48).toString('base64')}`, 'kid'],
    ['JWT_SIGNING_KEYS', `k1:${randomBytes(16).toString('base64')}`, '32 bytes'],
    [
      'JWT_SIGNING_KEYS',
      `k1:${randomBytes(48).toString('base64')},k1:${randomBytes(48).toString('base64')}`,
      '重複',
    ],
    ['FILE_URL_SIGNING_KEY', randomBytes(16).toString('base64'), '32 bytes'],
  ])('%s 格式不對（%s）→ 啟動失敗', (key, value, message) => {
    expect(() => validateEnv(production({ [key]: value }))).toThrow(message);
  });

  it('租戶與平台的金鑰環共用同一把金鑰 → 啟動失敗', () => {
    const shared = randomBytes(48).toString('base64');
    expect(() =>
      validateEnv(
        production({ JWT_SIGNING_KEYS: `t1:${shared}`, PLATFORM_JWT_SIGNING_KEYS: `p1:${shared}` }),
      ),
    ).toThrow('PLATFORM_JWT_SIGNING_KEYS');
  });

  it('對外 API 的程序拿到 access token 的金鑰環 → 啟動失敗', () => {
    expect(() =>
      validateEnv(
        production({
          API_SURFACE: 'external',
          OIDC_JWKS: '',
          IDP_SECRET_KEY: '',
          WEBHOOK_SECRET_KEY: '',
          MFA_SECRET_KEY: '',
        }),
      ),
    ).toThrow('JWT_SIGNING_KEYS');
  });

  it.each(['IDP_SECRET_KEY', 'TENANT_SECRET_KEY', 'WEBHOOK_SECRET_KEY', 'MFA_SECRET_KEY'])(
    '%s 沒設定（開發時由 JWT_SECRET 推導）→ 啟動失敗',
    (key) => {
      expect(() => validateEnv(production({ [key]: '' }))).toThrow(key);
    },
  );

  it.each([
    ['TENANT_SECRET_KEY', Buffer.alloc(32).toString('base64'), '不同的位元組太少'],
    ['IDP_SECRET_KEY', randomBytes(16).toString('base64'), '32 bytes'],
    ['WEBHOOK_SECRET_KEY', 'webhook-key', '32 bytes'],
    ['MFA_SECRET_KEY', Buffer.alloc(32).toString('base64'), '不同的位元組太少'],
    ['OIDC_COOKIE_KEYS', 'a', '至少 32 字元'],
    ['OIDC_COOKIE_KEYS', `${secretKey()},secret`, '至少 32 字元'],
    ['OIDC_JWKS', '{"keys":[]}', '私鑰'],
    ['OIDC_JWKS', 'not json', 'JSON'],
  ])('%s 是弱值或格式錯誤 → 啟動失敗（%#）', (key, value, message) => {
    expect(() => validateEnv(production({ [key]: value }))).toThrow(
      new RegExp(`${key}: .*${message}`),
    );
  });

  it('OIDC_JWKS 只有公鑰 → 啟動失敗', () => {
    const { d: _d, ...publicKey } = JSON.parse(JWKS).keys[0];
    expect(() =>
      validateEnv(production({ OIDC_JWKS: JSON.stringify({ keys: [publicKey] }) })),
    ).toThrow(/OIDC_JWKS: .*私鑰/);
  });

  it.each([
    ['APP_PUBLIC_URL', 'http://example.com'],
    ['APP_PUBLIC_URL', 'https://acme.localhost:8080'],
    ['PLATFORM_APP_URL', 'https://localhost'],
    ['PLATFORM_APP_URL', 'https://127.0.0.1:8081'],
    ['OIDC_ISSUER', 'https://[::1]/api/oidc'],
  ])('%s=%s（不是瀏覽器看到的 https 網址）→ 啟動失敗', (key, value) => {
    expect(() => validateEnv(production({ [key]: value }))).toThrow(key);
  });

  it('OIDC_ISSUER 與 PLATFORM_APP_URL 不同源 → 啟動失敗', () => {
    expect(() =>
      validateEnv(production({ OIDC_ISSUER: 'https://idp.example.com/api/oidc' })),
    ).toThrow(/OIDC_ISSUER: .*PLATFORM_APP_URL/);
  });

  it('MAIL_TRANSPORT=console（會把啟用／重設連結寫進日誌）→ 啟動失敗', () => {
    expect(() => validateEnv(production({ MAIL_TRANSPORT: 'console' }))).toThrow('MAIL_TRANSPORT');
  });

  it('開發環境照常接受範例值與 localhost', () => {
    const env = production({
      NODE_ENV: 'development',
      JWT_SECRET: 'change-me-in-production-min-32-chars',
      APP_PUBLIC_URL: 'http://localhost:5173',
      OIDC_COOKIE_KEYS: 'a',
    });
    expect(validateEnv(env).NODE_ENV).toBe('development');
  });

  const external = (overrides: Record<string, string> = {}) =>
    production({
      API_SURFACE: 'external',
      OIDC_JWKS: '',
      OIDC_COOKIE_KEYS: '',
      IDP_SECRET_KEY: '',
      WEBHOOK_SECRET_KEY: '',
      MFA_SECRET_KEY: '',
      JWT_SIGNING_KEYS: '',
      PLATFORM_JWT_SIGNING_KEYS: '',
      ...overrides,
    });

  describe('對外 API 的程序（API_SURFACE=external，06-external-api.md §6）', () => {
    it('沒有 OIDC、外部 IdP、webhook 的金鑰也可以啟動', () => {
      expect(validateEnv(external()).API_SURFACE).toBe('external');
    });

    it('仍要求租戶連線字串的金鑰與平台 DB', () => {
      expect(() => validateEnv(external({ TENANT_SECRET_KEY: '' }))).toThrow('TENANT_SECRET_KEY');
      const { PLATFORM_DATABASE_URL: _removed, ...env } = external();
      expect(() => validateEnv(env)).toThrow('PLATFORM_DATABASE_URL');
    });

    it('給了金鑰就照樣檢查強度', () => {
      expect(() => validateEnv(external({ WEBHOOK_SECRET_KEY: 'short' }))).toThrow(
        'WEBHOOK_SECRET_KEY',
      );
    });
  });

  it('isWeakSecret', () => {
    expect(isWeakSecret('CHANGE-ME-please-0123456789')).toBe(true);
    expect(isWeakSecret('abababababababababababababababab')).toBe(true);
    expect(isWeakSecret(STRONG)).toBe(false);
  });
});

describe('listenHostOf（LISTEN_HOST）', () => {
  it.each([
    [{ NODE_ENV: 'development' as const }, '127.0.0.1'],
    [{ NODE_ENV: 'test' as const }, '127.0.0.1'],
    [{ NODE_ENV: 'production' as const }, undefined],
    [{ NODE_ENV: 'development' as const, LISTEN_HOST: '0.0.0.0' }, '0.0.0.0'],
  ])('%j → %j', (env, expected) => {
    expect(listenHostOf({ LISTEN_HOST: undefined, ...env })).toBe(expected);
  });
});

describe('FILE_URL_TTL（撤銷授權的延遲上限）', () => {
  const ttl = EnvSchema.shape.FILE_URL_TTL;

  it('預設 900 秒', () => {
    expect(ttl.parse(undefined)).toBe(900);
  });

  it('最長 1 小時：更長的網址在授權撤銷後仍可下載太久', () => {
    expect(ttl.parse('3600')).toBe(3600);
    expect(ttl.safeParse('3601').success).toBe(false);
    expect(ttl.safeParse('604800').success).toBe(false);
  });
});

describe('MONITORING_ENABLED（監控整套的開關，docs/architecture/08-monitoring.md §1.1）', () => {
  const flag = EnvSchema.shape.MONITORING_ENABLED;

  it('沒設定或留空時開啟', () => {
    expect(flag.parse(undefined)).toBe(true);
    expect(flag.parse('')).toBe(true);
  });

  it('true／false 之外的值啟動失敗', () => {
    expect(flag.parse('false')).toBe(false);
    expect(flag.parse('true')).toBe(true);
    expect(flag.safeParse('0').success).toBe(false);
    expect(flag.safeParse('off').success).toBe(false);
  });
});

describe('APP_ROLES 與 DEPLOYMENT_MODE（docs/features/multi-instance.md D5）', () => {
  const development = (overrides: Record<string, string> = {}) => ({
    PLATFORM_DATABASE_URL: 'postgres://u:p@db:5432/platform',
    JWT_SECRET: 'change-me-in-production-min-32-chars',
    FILE_STORAGE_ACCESS_KEY_ID: 'dev-access-key',
    FILE_STORAGE_SECRET_ACCESS_KEY: 'dev-secret-key',
    SUPER_ADMIN_EMAIL: 'admin@example.com',
    ...overrides,
  });

  it('預設是單體（all）、standalone', () => {
    const env = validateEnv(development());
    expect(env.APP_ROLES).toBe('all');
    expect(env.DEPLOYMENT_MODE).toBe('standalone');
  });

  it.each(['http', 'http,realtime', ' worker , http ', 'all'])('接受 %j', (value) => {
    expect(validateEnv(development({ APP_ROLES: value })).APP_ROLES).toBe(value);
  });

  it.each(['', 'api', 'http,all'])('拒絕 %j', (value) => {
    expect(() => validateEnv(development({ APP_ROLES: value }))).toThrow('APP_ROLES');
  });

  it('cluster：開發環境也要設定 OIDC 的金鑰（否則每個程序各自產生）', () => {
    expect(() => validateEnv(development({ DEPLOYMENT_MODE: 'cluster' }))).toThrow('OIDC_JWKS');
    expect(() => validateEnv(development({ DEPLOYMENT_MODE: 'cluster', OIDC_JWKS: JWKS }))).toThrow(
      'OIDC_COOKIE_KEYS',
    );
    expect(
      validateEnv(
        development({
          DEPLOYMENT_MODE: 'cluster',
          OIDC_JWKS: JWKS,
          OIDC_COOKIE_KEYS: secretKey(),
        }),
      ).DEPLOYMENT_MODE,
    ).toBe('cluster');
  });

  it('cluster 的對外 API 程序不要求 OIDC 的金鑰（它不簽 ID token）', () => {
    expect(
      validateEnv(development({ DEPLOYMENT_MODE: 'cluster', API_SURFACE: 'external' }))
        .DEPLOYMENT_MODE,
    ).toBe('cluster');
  });
});
