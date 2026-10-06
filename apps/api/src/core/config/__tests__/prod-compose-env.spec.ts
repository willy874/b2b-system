import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { validateEnv } from '../env.schema';

const COMPOSE_FILE = resolve(__dirname, '../../../../../../docker-compose.prod.yml');

const base64Key = () => randomBytes(32).toString('base64');

/**
 * 部署時 compose 從 env 檔取得的值（假值，但形狀與正式環境相同）。compose 裡以 `${NAME:?required}` 要求的變數
 * 都要列在這裡；漏列時測試直接指出是哪一個。
 */
const DEPLOYMENT_ENV: Record<string, string> = {
  POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
  POSTGRES_PLATFORM_PASSWORD: randomBytes(24).toString('hex'),
  POSTGRES_TENANT_PASSWORD: randomBytes(24).toString('hex'),
  POSTGRES_PROVISIONER_PASSWORD: randomBytes(24).toString('hex'),
  TENANT_SECRET_KEY: base64Key(),
  JWT_SECRET: randomBytes(48).toString('base64'),
  SUPER_ADMIN_EMAIL: 'admin@example.com',
  PLATFORM_ADMIN_EMAIL: 'platform@example.com',
  FILE_STORAGE_ACCESS_KEY_ID: randomBytes(12).toString('hex'),
  FILE_STORAGE_SECRET_ACCESS_KEY: randomBytes(24).toString('base64'),
  MAIL_SMTP_URL: 'smtps://user:password@smtp.example.com:465',
  MAIL_FROM: 'B2B System <no-reply@example.com>',
  PUBLIC_ORIGIN: 'https://app.example.com',
  PLATFORM_PUBLIC_ORIGIN: 'https://accounts.example.com',
  DEFAULT_TENANT_DOMAINS: 'app.example.com',
  OIDC_JWKS: JSON.stringify({
    keys: [
      {
        ...generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' }),
        use: 'sig',
        kid: 'test',
      },
    ],
  }),
  OIDC_COOKIE_KEYS: `${randomBytes(32).toString('base64')},${randomBytes(32).toString('base64')}`,
  IDP_SECRET_KEY: base64Key(),
  WEBHOOK_SECRET_KEY: base64Key(),
};

/** compose 的變數替換：`${NAME}`、`${NAME:-預設}`（可巢狀）、`${NAME:?訊息}`。 */
function interpolate(value: string, env: Record<string, string>): string {
  let result = '';
  let index = 0;
  while (index < value.length) {
    const start = value.indexOf('${', index);
    if (start < 0) return result + value.slice(index);
    result += value.slice(index, start);
    let depth = 0;
    let end = start;
    for (; end < value.length; end += 1) {
      if (value.startsWith('${', end)) depth += 1;
      else if (value[end] === '}' && --depth === 0) break;
    }
    const body = value.slice(start + 2, end);
    const [, name = '', operator, rest = ''] = /^(\w+)(?::([-?]))?([\s\S]*)$/.exec(body) ?? [];
    const current = env[name];
    if (operator === '-') result += current || interpolate(rest, env);
    else if (operator === '?') {
      if (!current)
        throw new Error(`compose 要求 ${name}，但測試的部署環境沒有提供：補進 DEPLOYMENT_ENV`);
      result += current;
    } else result += current ?? '';
    index = end + 1;
  }
  return result;
}

function serviceEnvironment(service: string): Record<string, string> {
  const compose = parse(readFileSync(COMPOSE_FILE, 'utf8'), { merge: true }) as {
    services: Record<string, { environment?: Record<string, string | number> }>;
  };
  const environment = compose.services[service]?.environment;
  if (!environment) throw new Error(`docker-compose.prod.yml 沒有 ${service} 的 environment`);
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [
      key,
      interpolate(String(value), DEPLOYMENT_ENV),
    ]),
  );
}

describe('docker-compose.prod.yml 給程序的環境變數（防止 production 起不來）', () => {
  it.each(['api', 'external-api'])(
    '%s 的 environment 通過 production 的環境變數驗證',
    (service) => {
      const env = serviceEnvironment(service);
      expect(env.NODE_ENV).toBe('production');
      expect(() => validateEnv(env)).not.toThrow();
    },
  );

  it('拿掉任一個 production 必填的金鑰就驗證失敗（這個測試真的會擋）', () => {
    const { WEBHOOK_SECRET_KEY: _removed, ...env } = serviceEnvironment('api');
    expect(() => validateEnv(env)).toThrow('WEBHOOK_SECRET_KEY');
  });
});
