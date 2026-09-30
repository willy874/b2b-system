import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../env.schema';

// ConfigModule.forRoot 在載入模組時就驗證並快取環境變數：先設好 env，再動態載入
async function loadConfig(): Promise<ConfigService<Env, true>> {
  vi.resetModules();
  const { ConfigModule } = await import('../config.module');
  const moduleRef = await Test.createTestingModule({ imports: [ConfigModule] }).compile();
  return moduleRef.get(ConfigService);
}

describe('ConfigModule（.env 裡留空的選填變數）', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['OIDC_COOKIE_KEYS', 'TENANT_BASE_DOMAIN', 'TENANT_PROVISIONING_DATABASE_URL'] as const)(
    '%s= 取得 undefined（程式的 ?? 預設值才會生效），不是原始的空字串',
    async (key) => {
      vi.stubEnv('JWT_SECRET', 'test-secret-that-is-long-enough-32ch');
      vi.stubEnv(key, '');
      const config = await loadConfig();
      expect(config.get(key, { infer: true })).toBeUndefined();
    },
  );
});
