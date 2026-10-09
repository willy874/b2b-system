import { randomBytes } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';

import type { Env } from '../../config';
import { validateEnv } from '../../config/env.schema';
import { CdnConfig } from '../cdn-config';

/** 金鑰環的兩把：`k2` 在前（簽發），`k1` 只驗證。 */
export const CDN_KEY_1 = randomBytes(48);
export const CDN_KEY_2 = randomBytes(48);
export const CDN_PURGE_SECRET = randomBytes(48);

/** 與執行時相同：環境變數先經過 validateEnv，再由 ConfigService 讀出。 */
export function cdnConfigOf(overrides: Record<string, string> = {}): CdnConfig {
  const env = validateEnv({
    PLATFORM_DATABASE_URL: 'postgres://u:p@db:5432/platform',
    JWT_SECRET: 'change-me-in-production-min-32-chars',
    FILE_STORAGE_ACCESS_KEY_ID: 'dev-access-key',
    FILE_STORAGE_SECRET_ACCESS_KEY: 'dev-secret-key',
    SUPER_ADMIN_EMAIL: 'admin@example.com',
    FILE_CDN_ENABLED: 'true',
    FILE_CDN_ORIGIN: 'https://cdn.example.test/',
    FILE_CDN_SIGNING_KEYS: `k2:${CDN_KEY_2.toString('base64')},k1:${CDN_KEY_1.toString('base64')}`,
    FILE_CDN_PURGE_URL: 'http://cdn-purge:8081',
    FILE_CDN_PURGE_SECRET: CDN_PURGE_SECRET.toString('base64'),
    ...overrides,
  });
  const config = { get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>;
  return new CdnConfig(config);
}
