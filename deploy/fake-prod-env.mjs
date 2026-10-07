// 一次性的正式環境變數（deploy/smoke-test.sh 用）：每次執行都產生新的隨機金鑰，形狀與 deploy/prod.env.example 相同，
// 能通過 compose 的必填檢查與 api 的 production 驗證。只拿來測試，不要當成正式環境的值。
//
// 用法：node deploy/fake-prod-env.mjs > <檔案>
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';

const base64Key = () => randomBytes(32).toString('base64');
const hex = (bytes) => randomBytes(bytes).toString('hex');

const signingKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  format: 'jwk',
});

const env = {
  PUBLIC_ORIGIN: 'https://app.example.com',
  PLATFORM_PUBLIC_ORIGIN: 'https://accounts.example.com',
  DEFAULT_TENANT_DOMAINS: 'app.example.com',
  // 測試時前面沒有 LB：填文件用的網段（RFC 5737），nginx 不採用任何來源帶來的 X-Forwarded-For
  TRUSTED_PROXY_CIDRS: '192.0.2.0/24',
  POSTGRES_PASSWORD: hex(24),
  POSTGRES_PLATFORM_PASSWORD: hex(24),
  POSTGRES_TENANT_PASSWORD: hex(24),
  POSTGRES_PROVISIONER_PASSWORD: hex(24),
  JWT_SIGNING_KEYS: `t1:${randomBytes(48).toString('base64')}`,
  PLATFORM_JWT_SIGNING_KEYS: `p1:${randomBytes(48).toString('base64')}`,
  FILE_URL_SIGNING_KEY: randomBytes(48).toString('base64'),
  TENANT_SECRET_KEY: base64Key(),
  IDP_SECRET_KEY: base64Key(),
  WEBHOOK_SECRET_KEY: base64Key(),
  MFA_SECRET_KEY: base64Key(),
  OIDC_COOKIE_KEYS: `${base64Key()},${base64Key()}`,
  OIDC_JWKS: JSON.stringify({
    keys: [{ ...signingKey, alg: 'RS256', use: 'sig', kid: randomUUID() }],
  }),
  FILE_STORAGE_ACCESS_KEY_ID: hex(12),
  FILE_STORAGE_SECRET_ACCESS_KEY: base64Key(),
  APM_BACKSTAGE_PUBLIC_KEY: hex(16),
  APM_PLATFORM_PUBLIC_KEY: hex(16),
  APM_AUTH_TOKEN: hex(24),
  // 不會真的寄信：啟動時不連 SMTP
  MAIL_SMTP_URL: 'smtp://mail.invalid:25',
  MAIL_FROM: 'B2B System <no-reply@example.com>',
  PLATFORM_ADMIN_EMAIL: 'platform@example.com',
  SUPER_ADMIN_EMAIL: 'admin@example.com',
};

// compose 的 env 檔：含空白、引號或 JSON 的值以單引號包起來（值本身不含單引號）
const lines = Object.entries(env).map(([key, value]) =>
  /^[\w.:/@,+=-]*$/.test(value) ? `${key}=${value}` : `${key}='${value}'`,
);
process.stdout.write(`${lines.join('\n')}\n`);
